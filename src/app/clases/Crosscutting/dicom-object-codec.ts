import { DCMFile } from "../DCM/DCM-file.class";

/**
 * Como se sube un fichero DICOM a S3: el File original (Blob) tal cual, sin copias ni conversiones, con
 * Content-Type application/dicom. El objeto es el DICOM byte a byte.
 *
 * El visor trabaja con "binary strings" (1 char = 1 byte): NUNCA se envia un string (XHR y fetch lo codifican en
 * UTF-8 y cada byte >= 0x80 pasa a ocupar 2), ni se lee una respuesta con .text() (decodifica UTF-8).
 */
export class DicomObjectCodec {
    /** Media type registrado para ficheros DICOM Part 10 (PS3.18). */
    public static readonly CONTENT_TYPE = 'application/dicom';

    /**
     * Body del PUT a partir de un fichero leido por el visor: el File original si existe (cero copias; son los bytes
     * exactos del CD, aunque rawData se haya inflado), si no, los bytes de rawData.
     */
    public static uploadBodyFor(source: DCMFile): Blob | Uint8Array {
        if (source.file && source.file.size > 0) {
            return source.file;
        }
        return DicomObjectCodec.binaryStringToBytes(source.rawData);
    }

    /** Garantiza un Body binario: un string se interpreta como binary string (nunca se envia como texto). */
    public static asBinaryBody(body: Blob | ArrayBuffer | ArrayBufferView | string): Blob | Uint8Array {
        if (typeof body === 'string') {
            return DicomObjectCodec.binaryStringToBytes(body);
        }
        if (body instanceof ArrayBuffer) {
            return new Uint8Array(body);
        }
        if (ArrayBuffer.isView(body)) {
            return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
        }
        return body;
    }

    public static binaryStringToBytes(value: string): Uint8Array {
        const bytes = new Uint8Array(value.length);
        for (let i = 0; i < value.length; i++) {
            bytes[i] = value.charCodeAt(i);
        }
        return bytes;
    }
}
