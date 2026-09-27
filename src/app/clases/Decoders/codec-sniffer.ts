import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DecoderKind } from "./decoder-factory";

export interface SniffedCodec {
    /** Qué se ha reconocido en el Pixel Data (para el log y la pantalla de información). */
    name: string;
    /** El decoder que le corresponde (ver createDecoder). */
    kind: DecoderKind;
}

/**
 * Decodificación "por contenido" para Transfer Syntax privadas o desconocidas.
 *
 * Hay fabricantes que meten un códec estándar bajo un UID propio, y ficheros cuya TS se ha perdido o está mal
 * escrita. En vez de rendirse por el UID se mira el Pixel Data:
 *  - encapsulado: la cabecera del primer fragmento. JPEG (SOI FFD8; el marcador SOF dice el proceso: baseline,
 *    extendido, lossless, progresivo, aritmético o JPEG-LS), JPEG 2000 (SOC+SIZ FF4F FF51; el bit 14 del Rsiz
 *    marca HTJ2K), RLE (cabecera de 64 bytes de PS3.5 G) o sin comprimir (cada frame mide exactamente lo que
 *    dicen Rows, Columns, Samples y BitsAllocated).
 *  - nativo: si mide exactamente lo esperado, se lee como Explicit VR Little Endian sin comprimir.
 * Si no se reconoce nada devuelve null y el visor explica por qué no puede mostrar la imagen.
 *
 * @param nativeLength longitud del valor del Pixel Data nativo (null si es encapsulado)
 * @param firstFrame   bitstream del primer frame si es encapsulado (se lee solo ese; no hace falta el fichero entero)
 */
export function sniffPixelData(reader: DCMFileReader, nativeLength: number | null, firstFrame: Uint8Array | string | null): SniffedCodec | null {
    const frameBytes = (reader.Rows * reader.Columns * (reader.SamplesPerPixel || 1) * reader.BitsAllocated) / 8;
    const fits = (length: number, expected: number) => expected > 0 && (length == expected || length == expected + 1);

    if (nativeLength !== null) {
        // Nativo (VL definida)
        return fits(nativeLength, frameBytes * Math.max(1, reader.Frames || 1))
            ? { name: 'sin comprimir (nativo)', kind: 'native' }
            : null;
    }
    if (!firstFrame || firstFrame.length < 4) {
        return null;
    }
    const s = firstFrame;
    const b = typeof s === 'string' ? (i: number) => s.charCodeAt(i) & 0xFF : (i: number) => s[i] ?? 0;
    const u32 = (i: number) => (b(i) | (b(i + 1) << 8) | (b(i + 2) << 16) | (b(i + 3) << 24)) >>> 0;

    if (b(0) == 0xFF && b(1) == 0xD8) {
        switch (jpegFrameMarker(s)) {
            case 0xC0: return { name: 'JPEG baseline', kind: 'jpeg-baseline' };
            case 0xC1: return { name: 'JPEG extendido', kind: 'jpeg-baseline' };
            case 0xC3: return { name: 'JPEG lossless', kind: 'jpeg-lossless' };
            case 0xC2: return { name: 'JPEG progresivo', kind: 'jpeg-retired' };
            case 0xC9: return { name: 'JPEG aritmético', kind: 'jpeg-retired' };
            case 0xCA: return { name: 'JPEG progresivo aritmético', kind: 'jpeg-retired' };
            case 0xCB: return { name: 'JPEG lossless aritmético', kind: 'jpeg-retired' };
            case 0xF7: return { name: 'JPEG-LS', kind: 'jpeg-ls' };
        }
        return null; // JPEG jerárquico o cabecera rota
    }
    if (b(0) == 0xFF && b(1) == 0x4F && b(2) == 0xFF && b(3) == 0x51) {
        const ht = (((b(6) << 8) | b(7)) & 0x4000) != 0; // Rsiz, bit 14: HTJ2K (ISO/IEC 15444-15)
        return { name: ht ? 'HTJ2K' : 'JPEG 2000', kind: ht ? 'htj2k' : 'jpeg2000' };
    }
    const segments = u32(0);
    const expectedSegments = (reader.SamplesPerPixel || 1) * Math.ceil(reader.BitsAllocated / 8);
    if (s.length > 64 && segments == expectedSegments && segments <= 15 && u32(4) == 64) {
        return { name: 'RLE', kind: 'rle' };
    }
    if (fits(s.length, frameBytes)) {
        return { name: 'sin comprimir (encapsulado)', kind: 'encapsulated-raw' };
    }
    return null;
}

/** Primer marcador SOF de un JPEG (C0-CF salvo DHT/JPG/DAC, o F7 = SOF55 de JPEG-LS); null si no lo hay. */
function jpegFrameMarker(s: Uint8Array | string): number | null {
    const b = typeof s === 'string' ? (i: number) => s.charCodeAt(i) & 0xFF : (i: number) => s[i] ?? 0;
    let pos = 2;
    while (pos + 4 <= s.length) {
        if (b(pos) != 0xFF) {
            return null;
        }
        const marker = b(pos + 1);
        if (marker == 0xFF) {                                    // relleno
            pos++;
            continue;
        }
        if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { // TEM y RSTn: sin longitud
            pos += 2;
            continue;
        }
        if ((marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC) || marker == 0xF7) {
            return marker;
        }
        if (marker == 0xDA || marker == 0xD9) {                  // SOS o EOI antes del SOF
            return null;
        }
        pos += 2 + ((b(pos + 2) << 8) | b(pos + 3));
    }
    return null;
}
