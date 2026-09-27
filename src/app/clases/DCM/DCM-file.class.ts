import { Observable } from "rxjs";
import { DCMFileReader } from "./DCM-file-reader.class";

export const DICOM_LABEL = "DICM";
export const VR_UL = "UL";
export const LITTLE_ENDIANT_FIRST_KNOWN_TAG_BYTE = 2; //BE = 0
export const DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1.99';
/**
 * La longitud maxima de un string en V8 (2^29 - 24 caracteres; Chrome y Edge). Solo limita lo que se lee ENTERO en
 * rawData: Deflated Explicit VR LE (hay que inflar el dataset entero) y la pantalla de test (fullRead). El resto se lee
 * por rangos: la cabecera por bloques hasta el Pixel Data y cada frame cuando hace falta (ver readHeader).
 */
export const MAX_BINARY_STRING_BYTES = (1 << 29) - 24;
/**
 * Bytes que se leen al principio para decidir si un fichero es DICOM: el preámbulo y "DICM" (132) o, sin preámbulo,
 * los primeros elementos del dataset (ver DCMFile.sniffDataset).
 */
export const HEAD_BYTES = 2048;
/** VRs con longitud de 4 bytes en Explicit VR (PS3.5 tabla 7.1-1); copia local para no importar el lector (ciclo). */
const LONG_VRS = ['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'SV', 'UC', 'UN', 'UR', 'UT', 'UV'];
const VRS = ['AE', 'AS', 'AT', 'CS', 'DA', 'DS', 'DT', 'FD', 'FL', 'IS', 'LO', 'LT', 'OB', 'OD', 'OF', 'OL', 'OV', 'OW',
    'PN', 'SH', 'SL', 'SQ', 'SS', 'ST', 'SV', 'TM', 'UC', 'UI', 'UL', 'UN', 'UR', 'US', 'UT', 'UV'];

/** Codificación de un dataset deducida de sus primeros elementos (ficheros sin File Meta Information). */
export interface DatasetEncoding { explicit: boolean; littleEndian: boolean; }

export enum FILEREAD_STATUS {
    NONE = 0,
    SUCCESS = 1,
    ERROR = 2,
    ABORT = 3
}

/** Primer bloque de cabecera que se lee (se amplía x4 hasta llegar al Pixel Data). */
export const HEADER_CHUNK_BYTES = 256 * 1024;

/** Acceso por rangos a los bytes de un fichero (File, Blob o, en Node, fs.openAsBlob). */
export interface ByteSource {
    readonly size: number;
    read(offset: number, length: number): Promise<Uint8Array>;
}

/** File o Blob: cada lectura es un slice().arrayBuffer(); nunca se carga el fichero entero. */
export class BlobSource implements ByteSource {
    constructor(private blob: Blob) {}

    public get size(): number {
        return this.blob.size;
    }

    public async read(offset: number, length: number): Promise<Uint8Array> {
        const start = Math.max(0, offset), end = Math.min(this.blob.size, offset + length);
        if (end <= start) {
            return new Uint8Array(0);
        }
        return new Uint8Array(await this.blob.slice(start, end).arrayBuffer());
    }
}

export class DCMFile {

    // public static HIGH_PRIOR = 0;
    private static nextId = 1;
    /** Primer bloque de cabecera (bytes). La batería lo baja para forzar la lectura por rangos en ficheros pequeños. */
    public static headerChunkBytes: number = HEADER_CHUNK_BYTES;

    /** Identificador único del fichero (clave de la caché de frames decodificados). */
    public readonly id: number = DCMFile.nextId++;

    private readStatusSubscriber: any;
    private readStatusTrkSubscriber: any;
    private isDCMSubscriber: any;
    private lengthSubscriber: any;

    public readStatus$: Observable<FILEREAD_STATUS> = new Observable<FILEREAD_STATUS>((subscriber) => {
        this.readStatusSubscriber = subscriber;
        subscriber.next(FILEREAD_STATUS.NONE);
    });
    public readStatusTrk$: Observable<FILEREAD_STATUS> = new Observable<FILEREAD_STATUS>((subscriber) => {
        this.readStatusTrkSubscriber = subscriber;
        subscriber.next(FILEREAD_STATUS.NONE);
    });

    public readStatus: FILEREAD_STATUS = FILEREAD_STATUS.NONE;
    /**
     * Contenido como "binary string" (1 char = 1 byte). Con `partial` = true es SOLO la cabecera (hasta donde empieza
     * el valor del Pixel Data): el Pixel Data se lee por rangos con readRange() cuando se va a ver un frame.
     */
    public rawData: string = '';
    public length: number = 0;
    public length$: Observable<number> = new Observable<number>((subscriber) =>  {
        this.lengthSubscriber = subscriber;
        subscriber.next(0);
    });
    public isDCM: boolean | null = null;
    /** true si el dataset venia en Deflated Explicit VR LE y ya se ha inflado en rawData. */
    public inflated: boolean = false;
    /** true si rawData tiene solo la cabecera y el Pixel Data se lee del fichero bajo demanda. */
    public partial: boolean = false;
    /** true desde que empieza la lectura (el cargador encola los ficheros y solo lee unos pocos a la vez). */
    public started: boolean = false;
    /** Motivo, para el usuario, cuando readStatus es ERROR (p. ej. fichero mayor que el tope del navegador). */
    public readError: string = '';
    public isDCM$: Observable<boolean | null> = new Observable<boolean | null>((subscriber) =>  {
        this.isDCMSubscriber = subscriber;
        subscriber.next(this.isDCM);
    });

    /** Bytes del fichero por rangos; null en los descargados del portal (todo está ya en rawData). */
    public readonly source: ByteSource | null;

    public static downloadedDCMFile(value: string): DCMFile {
      var file = new File([], 'emptyFile');
      var dcmFile = new DCMFile(file);
      (dcmFile as any).source = null;
      dcmFile.rawData = value;
      dcmFile.length = value.length;
      dcmFile.isDCM = true;
      dcmFile.readStatus = FILEREAD_STATUS.SUCCESS;
      return dcmFile;
    }

    /**
     * @param fullRead lee el fichero entero en rawData (como antes de la lectura por trozos): la pantalla de test lo
     *   usa porque llama a los decoders de forma síncrona. Tope: MAX_BINARY_STRING_BYTES.
     */
    constructor(public file: File, private fullRead: boolean = false) {
        this.source = new BlobSource(file);
    }

    public readContents(): void {
        this.resetReadResults();
        this.started = true;
        this.load().catch((error) => this.failRead(String((error as any)?.message ?? error)));
    }

    /** Lee (asíncrono) lo necesario para clasificar y ver el fichero; emite readStatus$ al terminar. */
    public async load(): Promise<void> {
        const source = this.source!;
        // Lo justo para decidir si es DICOM: preámbulo + "DICM" o, sin preámbulo, los primeros elementos (sniffDataset)
        const head = await source.read(0, Math.min(source.size, HEAD_BYTES));
        this.rawData = DCMFile.bytesToBinaryString(head);
        this.setLength(this.rawData.length);
        this.isDCM = this.isDICOMFile();
        if (!this.isDCM) {
            this.succeed();
            return;
        }
        if (this.fullRead) {
            await this.readWhole();
        } else {
            await this.readHeader();
        }
        if (this.readStatus == FILEREAD_STATUS.ERROR) {
            return;
        }
        await this.inflateIfDeflated().catch((error) => console.warn('No se pudo inflar ' + this.file.name + ': ' + error));
        this.succeed();
    }

    /**
     * Cabecera por bloques: 256 KB, x4 cada vez, hasta que el Pixel Data del dataset raíz empieza dentro del bloque.
     * Se corta rawData justo donde empieza su valor (partial). Si el fichero cabe entero en el bloque, o no tiene
     * Pixel Data, o es Deflated (hay que inflar el dataset entero), queda completo en rawData.
     */
    private async readHeader(): Promise<void> {
        const source = this.source!;
        let size = Math.min(source.size, Math.max(256, DCMFile.headerChunkBytes));
        for (;;) {
            if (size > MAX_BINARY_STRING_BYTES) {
                this.failRead(`${this.sizeMB} MB sin Pixel Data en los primeros ${Math.floor(MAX_BINARY_STRING_BYTES / 1048576)} MB: ` +
                    'cabecera demasiado grande para el navegador');
                return;
            }
            const bytes = await source.read(0, size);
            this.rawData = DCMFile.bytesToBinaryString(bytes);
            this.setLength(this.rawData.length);
            if (size >= source.size) {
                this.partial = false;
                return;
            }
            const meta = DCMFile.scanFileMetaInformation(this.rawData, DCMFile.datasetOffset(this.rawData) ?? 132);
            if (meta?.transferSyntax === DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN) {
                await this.readWhole(); // deflate: no se puede leer por rangos
                return;
            }
            const cut = DCMFile.pixelDataValueStart(this);
            if (cut >= 0) {
                // String NUEVO con solo la cabecera: un substring de V8 retendría el bloque leído entero (256 KB o más
                // por fichero; en un CD de 600 cortes, ~150 MB de memoria sin usar).
                this.rawData = DCMFile.bytesToBinaryString(bytes.subarray(0, cut));
                this.setLength(cut);
                this.partial = true;
                return;
            }
            size = Math.min(source.size, size * 4);
        }
    }

    /** Fichero entero en rawData (Deflate, pantalla de test). */
    private async readWhole(): Promise<void> {
        const source = this.source!;
        if (source.size > MAX_BINARY_STRING_BYTES) {
            // En Chrome y Edge un string no puede pasar de ~512 MB
            this.failRead(`${this.sizeMB} MB: demasiado grande para leerlo entero en el navegador ` +
                `(tope de ${Math.floor(MAX_BINARY_STRING_BYTES / 1048576)} MB por fichero en esta Transfer Syntax)`);
            return;
        }
        this.rawData = DCMFile.bytesToBinaryString(await source.read(0, source.size));
        this.setLength(this.rawData.length);
        this.partial = false;
    }

    /**
     * Posición (en el fichero) donde empieza el VALOR del Pixel Data (7FE0,0010) del dataset raíz, si su cabecera está
     * entera en rawData; -1 si no. Usa el parser de siempre sobre el bloque leído.
     */
    private static pixelDataValueStart(file: DCMFile): number {
        const info = new DCMFileReader(file).pixelDataInfo;
        return (info && info.valueOffset <= file.rawData.length) ? info.valueOffset : -1;
    }

    /** Bytes [offset, offset + length) del fichero: por rangos del File o, si todo está en memoria, de rawData. */
    public async readRange(offset: number, length: number): Promise<Uint8Array> {
        if (this.source && this.partial) {
            return this.source.read(offset, length);
        }
        const end = Math.min(this.rawData.length, offset + length);
        const out = new Uint8Array(Math.max(0, end - offset));
        for (let i = 0; i < out.length; i++) {
            out[i] = this.rawData.charCodeAt(offset + i);
        }
        return out;
    }

    /** Tamaño real del fichero (con partial, rawData es solo la cabecera). */
    public get size(): number {
        return (this.source && this.partial) ? this.source.size : this.rawData.length;
    }

    private setLength(length: number): void {
        this.length = length;
        this.lengthSubscriber?.next(this.length);
    }

    private succeed(): void {
        this.readStatus = FILEREAD_STATUS.SUCCESS;
        this.readStatusSubscriber?.next(this.readStatus);
        this.readStatusTrkSubscriber?.next(this.readStatus);
    }

    /** Fallo controlado: guarda el motivo, lo deja en la consola y avisa a los suscriptores con ERROR. */
    private failRead(reason: string): void {
        this.readError = `${this.file.name}: ${reason}`;
        console.warn(this.readError);
        this.rawData = '';
        this.readStatus = FILEREAD_STATUS.ERROR;
        this.readStatusSubscriber?.next(this.readStatus);
        this.readStatusTrkSubscriber?.next(this.readStatus);
    }

    private get sizeMB(): number {
        return Math.round(this.file.size / 1048576);
    }

    /** DICOM con preámbulo y "DICM" o, sin preámbulo, un dataset que se deja leer (ACR-NEMA, datasets crudos). */
    private isDICOMFile(): boolean {
        const result = DCMFile.datasetOffset(this.rawData) !== null;
        this.isDCMSubscriber?.next(result);
        return result;
    }

    /**
     * Dónde empieza el dataset (o el File Meta Information):
     * - 132: preámbulo de 128 bytes + "DICM" (PS3.10 7.1), lo normal;
     * - 4: "DICM" sin el preámbulo (algunos programas lo quitan);
     * - 0: sin preámbulo ni "DICM" (ACR-NEMA 2.0, datasets escritos tal cual por MESA y otros): se acepta si los primeros
     *   elementos forman un dataset (sniffDataset).
     * null si no parece DICOM.
     */
    public static datasetOffset(raw: string): number | null {
        if (raw.length >= 132 && raw.substring(128, 132) == DICOM_LABEL) {
            return 132;
        }
        if (raw.startsWith(DICOM_LABEL) && DCMFile.sniffDataset(raw, 4)) {
            return 4;
        }
        return DCMFile.sniffDataset(raw, 0) ? 0 : null;
    }

    /**
     * ¿Hay un dataset en `start`? Se prueban Little y Big Endian, VR explícita e implícita, y vale la primera lectura en la
     * que los elementos tienen sentido: primer grupo 0000, 0002 u 0008 (identificación), etiquetas en orden creciente, VR
     * válidas (en explícita) y longitudes que caben. Hacen falta tres elementos, o dos si el siguiente ya no cabe en los
     * bytes leídos. Un fichero que no es DICOM (texto, imagen, ejecutable) no pasa de ahí. El grupo 0002 va en Explicit VR
     * Little Endian (en algunos datasets de MESA, en VR implícita); si lo hay, basta con él: la TS del dataset la dice él.
     */
    public static sniffDataset(raw: string, start: number): DatasetEncoding | null {
        for (const littleEndian of [true, false]) {
            for (const explicit of [true, false]) {
                if (DCMFile.parsesAs(raw, start, explicit, littleEndian)) {
                    return { explicit, littleEndian };
                }
            }
        }
        return null;
    }

    private static parsesAs(raw: string, start: number, explicit: boolean, le: boolean): boolean {
        const b = (at: number) => raw.charCodeAt(at);
        const u16 = (at: number, little: boolean) => little ? (b(at) | (b(at + 1) << 8)) : ((b(at) << 8) | b(at + 1));
        const u32 = (at: number, little: boolean) => little
            ? u16(at, true) + u16(at + 2, true) * 65536
            : u16(at, false) * 65536 + u16(at + 2, false);
        let pos = start;
        let count = 0;
        let last = -1;
        while (pos + 8 <= raw.length) {
            if (u16(pos, true) == 0x0002 && !le) {
                return false; // el grupo 0002 va en Little Endian (a veces, mal escrito, en VR implícita)
            }
            const little = le;
            const group = u16(pos, little);
            const element = u16(pos + 2, little);
            if (count == 0 && group != 0x0000 && group != 0x0002 && group != 0x0008) {
                return false;
            }
            if (count > 0 && last >>> 16 == 0x0002 && group != 0x0002) {
                return count >= 2; // File Meta Information completo: el dataset sigue con su propia TS
            }
            const tag = group * 65536 + element;
            if (tag <= last || group == 0xFFFE) {
                return false;
            }
            let header = 8;
            let length: number;
            if (explicit) {
                const vr = raw.substring(pos + 4, pos + 6);
                if (!VRS.includes(vr)) {
                    return false;
                }
                if (LONG_VRS.includes(vr)) {
                    if (pos + 12 > raw.length) {
                        break;
                    }
                    length = u32(pos + 8, little);
                    header = 12;
                } else {
                    length = u16(pos + 6, little);
                }
            } else {
                length = u32(pos + 4, little);
            }
            count++;
            last = tag;
            if (length == 0xFFFFFFFF) {
                return count >= 2; // secuencia de longitud indefinida: lo que había antes ya cuadraba
            }
            if (length > 0x7FFFFFFF) {
                return false;
            }
            pos += header + length;
            if (count >= 3) {
                return true;
            }
        }
        return count >= 2 && pos >= raw.length;
    }

    private resetReadResults(): void {
        this.readStatus = FILEREAD_STATUS.NONE;
        this.readStatusSubscriber?.next(this.readStatus);
        this.readStatusTrkSubscriber?.next(this.readStatus);
        this.rawData = '';
        this.readError = '';
        this.partial = false;
        this.inflated = false;
        this.length = 0;
        this.lengthSubscriber?.next(this.length);
        this.isDCM = null;
        this.isDCMSubscriber?.next(this.isDCM);
    }

    public isLittleEndian(): boolean {
        let firstKnownTagByte = this.rawData.charCodeAt(132);
        //console.log('Little Endian: ' + (firstKnownTagByte == LITTLE_ENDIANT_FIRST_KNOWN_TAG_BYTE));
        return (firstKnownTagByte == LITTLE_ENDIANT_FIRST_KNOWN_TAG_BYTE);
    }

    /**
     * Deflated Explicit VR Little Endian (1.2.840.10008.1.2.1.99, PS3.5 A.5): el File Meta Information (grupo 0002)
     * va en claro y TODO lo que sigue es un stream "deflate" crudo (RFC 1951, sin cabecera zlib).
     * Se infla con DecompressionStream('deflate-raw') del navegador (Chrome 103+, Safari 16.4+, Firefox 113+)
     * y rawData queda como un Explicit VR Little Endian normal (el TS del meta header no se toca).
     */
    public async inflateIfDeflated(): Promise<void> {
        const start = DCMFile.datasetOffset(this.rawData);
        if (this.inflated || start === null || this.rawData.length <= start) {
            return;
        }
        const meta = DCMFile.scanFileMetaInformation(this.rawData, start);
        if (!meta || meta.transferSyntax !== DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN) {
            return;
        }
        const Decompression = (globalThis as any).DecompressionStream;
        if (!Decompression) {
            console.warn('Este navegador no soporta DecompressionStream: no se puede leer Deflated Explicit VR LE.');
            return;
        }
        const compressed = new Uint8Array(this.rawData.length - meta.end);
        for (let i = 0; i < compressed.length; i++) {
            compressed[i] = this.rawData.charCodeAt(meta.end + i);
        }
        // Tras el stream deflate puede haber bytes de más: el byte nulo de relleno de PS3.5 A.5 (pydicom lo escribe si la
        // longitud es impar) o un trailer gzip de 8 bytes (CRC32 + tamaño; visto en image_dfl.dcm de pydicom). El
        // DecompressionStream de Chrome los toma por basura y da error, y al dar error DESCARTA los trozos inflados que
        // aún no se habían leído: en un fichero grande se perdía el final de la imagen. Se prueba entero y quitando de
        // 1 a 8 bytes del final: quitar de más deja el stream incompleto (error), así que el primero que infla sin
        // error es el bueno. Si ninguno, lo que se haya podido inflar (como antes).
        let inflated: Uint8Array | null = null;
        let firstError: any = null;
        for (const trim of [0, 1, 8, 2, 3, 4, 5, 6, 7]) {
            if (trim >= compressed.length) {
                continue;
            }
            try {
                inflated = await DCMFile.inflateRaw(Decompression, compressed.subarray(0, compressed.length - trim), false);
                break;
            } catch (error) {
                firstError ??= error;
            }
        }
        if (!inflated) {
            inflated = await DCMFile.inflateRaw(Decompression, compressed, true);
            console.debug('Deflate: stream dañado o con datos de más en ' + this.file.name + ': ' + firstError);
        }
        this.rawData = this.rawData.substring(0, meta.end) + DCMFile.bytesToBinaryString(inflated);
        this.length = this.rawData.length;
        this.inflated = true;
    }

    /** Infla un stream deflate crudo. Con `partial`, si falla a medias devuelve lo inflado hasta ahí (si hay algo). */
    private static async inflateRaw(Decompression: any, compressed: Uint8Array, partial: boolean): Promise<Uint8Array> {
        const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new Decompression('deflate-raw'));
        const reader = (stream as ReadableStream<Uint8Array>).getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) { chunks.push(value); total += value.length; }
            }
        } catch (error) {
            if (!partial || total === 0) throw error;
        }
        const inflated = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { inflated.set(chunk, offset); offset += chunk.length; }
        return inflated;
    }

    /** Recorre el grupo 0002 (siempre Explicit VR LE) y devuelve el TS y el offset donde empieza el dataset. */
    public static scanFileMetaInformation(raw: string, start: number = 132): { transferSyntax: string, end: number } | null {
        const u16 = (at: number) => raw.charCodeAt(at) | (raw.charCodeAt(at + 1) << 8);
        const u32 = (at: number) => (u16(at) + u16(at + 2) * 65536);
        let pos = start;
        let transferSyntax = '';
        while (pos + 8 <= raw.length && u16(pos) == 0x0002) {
            const element = u16(pos + 2);
            const vr = raw.substring(pos + 4, pos + 6);
            const long = ['OB', 'OW', 'OF', 'SQ', 'UT', 'UN', 'UC', 'UR', 'OD', 'OL', 'OV', 'SV', 'UV'].includes(vr);
            const vl = long ? u32(pos + 8) : u16(pos + 6);
            const header = long ? 12 : 8;
            if (element == 0x0010) {
                transferSyntax = raw.substring(pos + header, pos + header + vl).replace(/\0/g, '').trim();
            }
            pos += header + vl;
        }
        return (pos > start) ? { transferSyntax, end: pos } : null;
    }

    public static bytesToBinaryString(bytes: Uint8Array): string {
        let result = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            result += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as any);
        }
        return result;
    }
}
