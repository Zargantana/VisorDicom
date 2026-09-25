import { DCMFile } from "../DCM/DCM-file.class";

/**
 * Como se guarda un fichero DICOM como objeto S3 (y como se lee de vuelta).
 *
 * El problema historico: el visor trabaja con "binary strings" (1 char = 1 byte). Si se le pasa un string JS
 * como Body a aws-sdk, lo codifica en UTF-8 (cada byte >= 0x80 pasa a ocupar 2) y al descargar
 * `Body.toString()` vuelve a decodificar UTF-8: el DICOM se corrompe en los dos sentidos. Se evito
 * subiendo `btoa(...)` (solo ASCII), a costa de +33 % de almacenamiento y transferencia y dos conversiones.
 *
 * Ahora:
 *  - Subida: el File original (Blob) tal cual, sin copias ni conversiones -> el objeto S3 es un DICOM Part 10
 *    valido, byte a byte, con Content-Type application/dicom.
 *  - Descarga: los bytes del Body se pasan a binary string sin decodificar texto.
 *  - Compatibilidad: si el objeto es de los antiguos (base64) se detecta y se decodifica automaticamente,
 *    asi que conviven objetos nuevos y viejos sin migracion obligatoria.
 */
export class DicomObjectCodec {
    /** Media type registrado para ficheros DICOM Part 10 (PS3.18). */
    public static readonly CONTENT_TYPE = 'application/dicom';

    /**
     * Body para PutObject/ManagedUpload a partir de un fichero leido por el visor:
     * el File original si existe (cero copias; son los bytes exactos del CD, aunque rawData se haya inflado),
     * si no, los bytes de rawData.
     */
    public static uploadBodyFor(source: DCMFile): Blob | Uint8Array {
        if (source.file && source.file.size > 0) {
            return source.file;
        }
        return DicomObjectCodec.binaryStringToBytes(source.rawData);
    }

    /** Garantiza un Body binario: un string se interpreta como binary string (NUNCA se deja a aws-sdk). */
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

    /**
     * Body de GetObject (en el navegador aws-sdk v2 entrega un Buffer, subclase de Uint8Array) -> binary string.
     * Objetos antiguos subidos en base64 se detectan y se decodifican.
     */
    public static fromS3Body(body: any): string {
        let bytes: Uint8Array;
        if (body instanceof Uint8Array) {
            bytes = body;
        } else if (body instanceof ArrayBuffer) {
            bytes = new Uint8Array(body);
        } else if (typeof body === 'string') {
            bytes = DicomObjectCodec.binaryStringToBytes(body);
        } else {
            return '';
        }

        if (!DicomObjectCodec.isPart10(bytes) && DicomObjectCodec.looksLikeBase64(bytes)) {
            try {
                const decoded = atob(DicomObjectCodec.bytesToBinaryString(bytes).replace(/[\r\n]/g, ''));
                if (DicomObjectCodec.isPart10String(decoded)) {
                    return decoded; // objeto antiguo (base64)
                }
            } catch {
                // no era base64 valido: se devuelve tal cual
            }
        }
        return DicomObjectCodec.bytesToBinaryString(bytes);
    }

    /** Preambulo de 128 bytes + "DICM" (PS3.10 7.1). */
    public static isPart10(bytes: Uint8Array): boolean {
        return bytes.length >= 132 &&
            bytes[128] == 0x44 && bytes[129] == 0x49 && bytes[130] == 0x43 && bytes[131] == 0x4D;
    }

    private static isPart10String(value: string): boolean {
        return value.length >= 132 && value.substring(128, 132) == 'DICM';
    }

    /** Heuristica: los primeros KB solo contienen el alfabeto base64 (un DICOM binario nunca cumple esto). */
    private static looksLikeBase64(bytes: Uint8Array): boolean {
        const n = Math.min(bytes.length, 4096);
        if (n < 176) { // base64 de 132 bytes
            return false;
        }
        for (let i = 0; i < n; i++) {
            const c = bytes[i];
            const ok = (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39)
                || c == 0x2B || c == 0x2F || c == 0x3D || c == 0x0A || c == 0x0D;
            if (!ok) {
                return false;
            }
        }
        return true;
    }

    public static binaryStringToBytes(value: string): Uint8Array {
        const bytes = new Uint8Array(value.length);
        for (let i = 0; i < value.length; i++) {
            bytes[i] = value.charCodeAt(i);
        }
        return bytes;
    }

    public static bytesToBinaryString(bytes: Uint8Array): string {
        return DCMFile.bytesToBinaryString(bytes);
    }
}
