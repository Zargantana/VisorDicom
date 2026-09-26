import { CodecLoader, CodecName } from "./codec-loader";

/** Resultado de un decoder emscripten de Cornerstone (J2KDecoder de OpenJPEG, JPEGDecoder de libjpeg-turbo). */
export interface DecodedFrame {
    width: number;
    height: number;
    bitsPerSample: number;
    componentCount: number;
    isSigned: boolean;
    /** Muestras entrelazadas (R G B R G B... si hay 3 componentes). */
    data: Uint8Array | Int8Array | Uint16Array | Int16Array;
}

/**
 * Decodifica un bitstream con un códec emscripten ya cargado (CodecLoader.require lanza CodecRequiredError si no).
 * API común de los códecs de Cornerstone: getEncodedBuffer(n).set(bytes); decode(); getFrameInfo(); getDecodedBuffer().
 * El buffer decodificado vive en el heap del módulo: se copia antes de liberar el decoder (delete()).
 */
export function decodeWithEmscripten(codec: CodecName, className: string, bytes: Uint8Array): DecodedFrame {
    const module = CodecLoader.require(codec);
    const decoder = new module[className]();
    try {
        decoder.getEncodedBuffer(bytes.length).set(bytes);
        decoder.decode();
        const info = decoder.getFrameInfo();
        if (!info.width || !info.height || !info.componentCount) {
            // Los decoders de Cornerstone no lanzan si falla la cabecera: devuelven 0x0 (visto con JPEG 2000 Part 2 MCT).
            throw new Error(codec + ': no se pudo leer la cabecera del bitstream');
        }
        const raw: Uint8Array = decoder.getDecodedBuffer().slice();
        let data: DecodedFrame['data'];
        if (info.bitsPerSample > 8) {
            data = info.isSigned ? new Int16Array(raw.buffer, 0, raw.length >> 1) : new Uint16Array(raw.buffer, 0, raw.length >> 1);
        } else {
            data = info.isSigned ? new Int8Array(raw.buffer) : raw;
        }
        return { width: info.width, height: info.height, bitsPerSample: info.bitsPerSample,
                 componentCount: info.componentCount, isSigned: info.isSigned, data };
    } finally {
        if (typeof decoder.delete === 'function') {
            decoder.delete();
        }
    }
}
