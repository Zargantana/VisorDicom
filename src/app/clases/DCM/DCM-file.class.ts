import { Observable } from "rxjs";

export const DICOM_LABEL = "DICM";
export const VR_UL = "UL";
export const LITTLE_ENDIANT_FIRST_KNOWN_TAG_BYTE = 2; //BE = 0
export const DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1.99';
/**
 * Tope de FileReader.readAsBinaryString: la longitud maxima de un string en V8 (2^29 - 24 caracteres; Chrome y Edge).
 * Por encima, result es null SIN evento de error. Firefox y Safari tienen otros limites, por eso se comprueba ademas el
 * resultado vacio. Plan para superarlo: documentation/plan-carga-ficheros-grandes.md (lectura por trozos con File.slice).
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

export class DCMFile {

    // public static HIGH_PRIOR = 0;

    private freader: FileReader;
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
    public rawData: string = '';
    public length: number = 0;
    public length$: Observable<number> = new Observable<number>((subscriber) =>  {
        this.lengthSubscriber = subscriber;
        subscriber.next(0);
    });
    public isDCM: boolean | null = null;
    /** true si el dataset venia en Deflated Explicit VR LE y ya se ha inflado en rawData. */
    public inflated: boolean = false;
    /** true desde que empieza la lectura (el cargador encola los ficheros y solo lee unos pocos a la vez). */
    public started: boolean = false;
    /** Motivo, para el usuario, cuando readStatus es ERROR (p. ej. fichero mayor que el tope del navegador). */
    public readError: string = '';
    public isDCM$: Observable<boolean | null> = new Observable<boolean | null>((subscriber) =>  {
        this.isDCMSubscriber = subscriber;
        subscriber.next(this.isDCM);
    });

    public static downloadedDCMFile(value: string): DCMFile {
      var file = new File([], 'emptyFile');
      var dcmFile = new DCMFile(file);
      dcmFile.rawData = value;
      dcmFile.length = value.length;
      dcmFile.isDCM = true;
      dcmFile.readStatus = FILEREAD_STATUS.SUCCESS;
      return dcmFile;
    }

    constructor(public file: File) {
        this.freader = new FileReader();
        this.addListeners();
    }
    
    public readContents(): void {
        this.resetReadResults();
        this.started = true;
        let sliced = this.file.slice(0, HEAD_BYTES);
        this.freader.readAsBinaryString(sliced);
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

    private readCompleteFile(): void {
        this.freader.readAsBinaryString(this.file);
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
        this.length = 0;
        this.lengthSubscriber?.next(this.length);
        this.isDCM = null;
        this.isDCMSubscriber?.next(this.isDCM);
    }

    private addListeners(): void {
        this.freader.onloadstart = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
        this.freader.onload = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
        this.freader.onloadend = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
        this.freader.onprogress = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
        this.freader.onerror = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
        this.freader.onabort = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
    }

    public handleEvent(event: any) {
        // if (DCMFile.HIGH_PRIOR && !this.isDCM) {
        //     setTimeout(() => this.handleEvent(event), 100);
        //     return;
        // }
        //console.log(`${event.type}: ${event.loaded} bytes transferred\n`);
        this.length = event.loaded;
        this.lengthSubscriber?.next(this.length);
        
        if (event.type === "loadend") {
            //console.log('Read Ended.');
            this.rawData = this.freader.result?this.freader.result.toString():'';
            this.length = this.rawData.length;
            this.lengthSubscriber?.next(this.length);
            if (this.isDCM) {
                if (this.rawData.length == 0 && this.file.size > 0) {
                    // El navegador no ha devuelto nada (ni error): el fichero no cabe en un string.
                    this.failRead(`no se ha podido cargar entero en memoria (${this.sizeMB} MB); ` +
                        'el navegador no admite ficheros tan grandes en esta versión del visor');
                    return;
                }
                // DCMFile.HIGH_PRIOR--;
                this.inflateIfDeflated()
                    .catch((error) => console.warn('No se pudo inflar ' + this.file.name + ': ' + error))
                    .then(() => {
                        this.readStatus = FILEREAD_STATUS.SUCCESS;
                        this.readStatusSubscriber?.next(this.readStatus);
                        this.readStatusTrkSubscriber?.next(this.readStatus);
                    });
            } else {
                this.isDCM = this.isDICOMFile();
                if (this.isDCM) {
                    // DCMFile.HIGH_PRIOR++;
                    if (this.file.size > MAX_BINARY_STRING_BYTES) {
                        // Ni se intenta: en Chrome y Edge readAsBinaryString devolveria null tras leerlo entero.
                        this.failRead(`${this.sizeMB} MB: demasiado grande para esta versión del visor ` +
                            `(tope de ${Math.floor(MAX_BINARY_STRING_BYTES / 1048576)} MB por fichero)`);
                    } else {
                        this.readCompleteFile();
                    }
                } else {
                    this.readStatus = FILEREAD_STATUS.SUCCESS;
                    this.readStatusSubscriber?.next(this.readStatus);
                    this.readStatusTrkSubscriber?.next(this.readStatus);
                }
            }
        } else if (event.type === "error") {
            console.log('Read Error.');
            this.readStatus = FILEREAD_STATUS.ERROR;
            this.readStatusSubscriber?.next(this.readStatus);
            this.readStatusTrkSubscriber?.next(this.readStatus);
        } else if (event.type === "abort") {
            console.log('Read Abort.');
            this.readStatus = FILEREAD_STATUS.ABORT;
            this.readStatusSubscriber?.next(this.readStatus);
            this.readStatusTrkSubscriber?.next(this.readStatus);
        }
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
        const stream = new Blob([compressed]).stream().pipeThrough(new Decompression('deflate-raw'));
        // Se lee por trozos en lugar de new Response(stream).arrayBuffer(): PS3.5 A.5 permite un byte nulo de
        // relleno tras el stream deflate (pydicom lo escribe) y el DecompressionStream de Chrome lo considera
        // "junk" y falla DESPUES de haber entregado todo el dataset. Si ya hay datos, se aceptan.
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
            if (total === 0) throw error;
            console.debug('Deflate: datos tras el final del stream (relleno) en ' + this.file.name + ': ' + error);
        }
        const inflated = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { inflated.set(chunk, offset); offset += chunk.length; }
        this.rawData = this.rawData.substring(0, meta.end) + DCMFile.bytesToBinaryString(inflated);
        this.length = this.rawData.length;
        this.inflated = true;
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
