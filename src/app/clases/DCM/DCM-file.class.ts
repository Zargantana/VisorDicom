import { Observable } from "rxjs";

export const DICOM_LABEL = "DICM";
export const VR_UL = "UL";
export const LITTLE_ENDIANT_FIRST_KNOWN_TAG_BYTE = 2; //BE = 0
export const DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1.99';

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
        let sliced = this.file.slice(0,132);
        this.freader.readAsBinaryString(sliced);
    }

    private readCompleteFile(): void {
        this.freader.readAsBinaryString(this.file);
    }

    //TODO: Evitar reconocer un DICOMDIR como fichero DICOM.
    private isDICOMFile(): boolean {
        let DICOMLabel = this.rawData.substring(128, 132);
        //console.log('Label found: ' + DICOMLabel);
        //console.log('Id DICOM: ' + (DICOMLabel == DICOM_LABEL));
        const result = (DICOMLabel == DICOM_LABEL);
        this.isDCMSubscriber?.next(result);
        return result;
    }

    private resetReadResults(): void {
        this.readStatus = FILEREAD_STATUS.NONE;
        this.readStatusSubscriber?.next(this.readStatus);
        this.readStatusTrkSubscriber?.next(this.readStatus);
        this.rawData = '';
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
                    this.readCompleteFile();
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
        if (this.inflated || this.rawData.length <= 132) {
            return;
        }
        const meta = DCMFile.scanFileMetaInformation(this.rawData);
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
    public static scanFileMetaInformation(raw: string): { transferSyntax: string, end: number } | null {
        const u16 = (at: number) => raw.charCodeAt(at) | (raw.charCodeAt(at + 1) << 8);
        const u32 = (at: number) => (u16(at) + u16(at + 2) * 65536);
        let pos = 132;
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
        return (pos > 132) ? { transferSyntax, end: pos } : null;
    }

    public static bytesToBinaryString(bytes: Uint8Array): string {
        let result = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            result += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as any);
        }
        return result;
    }
}
