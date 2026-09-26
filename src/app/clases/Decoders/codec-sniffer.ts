import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter } from "../DCM/DCM-interpreter.class";
import { BaseDecoder } from "./base-decoder-class";
import { EncapsulatedUncompressedDecoder } from "./Encapsulated-Uncompressed-decoder.class";
import { JPEG2000Decoder } from "./JPEG-2000-decoder.class";
import { JPEGBaselineDecoder, JPEGRetiredProcessesDecoder } from "./JPEG-Baseline-decoder.class";
import { JPEGLosslessDecoder } from "./JPEG-Lossless-decoder.class";
import { JPEGLSDecoder } from "./JPEG-LS-decoder.class";
import { RLEDecoder } from "./RLE-decoder.class";
import { UncompressedDecoder } from "./Uncompressed-decoder.class";

export interface SniffedCodec {
    /** Qué se ha reconocido en el Pixel Data (para el log y la pantalla de información). */
    name: string;
    decoder: BaseDecoder;
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
 */
export function sniffPixelData(reader: DCMFileReader): SniffedCodec | null {
    const interpret = new DCMInterpreter(reader);
    const items = interpret.getPixelDatas();
    const frameBytes = (reader.Rows * reader.Columns * (reader.SamplesPerPixel || 1) * reader.BitsAllocated) / 8;
    const fits = (length: number, expected: number) => expected > 0 && (length == expected || length == expected + 1);

    if (items.length == 1) {
        // Nativo (VL definida)
        return fits(items[0].length, frameBytes * Math.max(1, reader.Frames || 1))
            ? { name: 'sin comprimir (nativo)', decoder: new UncompressedDecoder(reader) }
            : null;
    }
    const frames = interpret.getEncapsulatedFrames();
    if (frames.length == 0 || frames[0].length < 4) {
        return null;
    }
    const s = frames[0];
    const b = (i: number) => s.charCodeAt(i) & 0xFF;
    const u32 = (i: number) => (b(i) | (b(i + 1) << 8) | (b(i + 2) << 16) | (b(i + 3) << 24)) >>> 0;

    if (b(0) == 0xFF && b(1) == 0xD8) {
        switch (jpegFrameMarker(s)) {
            case 0xC0: return { name: 'JPEG baseline', decoder: new JPEGBaselineDecoder(reader) };
            case 0xC1: return { name: 'JPEG extendido', decoder: new JPEGBaselineDecoder(reader) };
            case 0xC3: return { name: 'JPEG lossless', decoder: new JPEGLosslessDecoder(reader) };
            case 0xC2: return { name: 'JPEG progresivo', decoder: new JPEGRetiredProcessesDecoder(reader) };
            case 0xC9: return { name: 'JPEG aritmético', decoder: new JPEGRetiredProcessesDecoder(reader) };
            case 0xCA: return { name: 'JPEG progresivo aritmético', decoder: new JPEGRetiredProcessesDecoder(reader) };
            case 0xCB: return { name: 'JPEG lossless aritmético', decoder: new JPEGRetiredProcessesDecoder(reader) };
            case 0xF7: return { name: 'JPEG-LS', decoder: new JPEGLSDecoder(reader) };
        }
        return null; // JPEG jerárquico o cabecera rota
    }
    if (b(0) == 0xFF && b(1) == 0x4F && b(2) == 0xFF && b(3) == 0x51) {
        const ht = (((b(6) << 8) | b(7)) & 0x4000) != 0; // Rsiz, bit 14: HTJ2K (ISO/IEC 15444-15)
        return { name: ht ? 'HTJ2K' : 'JPEG 2000', decoder: new JPEG2000Decoder(reader, ht) };
    }
    const segments = u32(0);
    const expectedSegments = (reader.SamplesPerPixel || 1) * Math.ceil(reader.BitsAllocated / 8);
    if (s.length > 64 && segments == expectedSegments && segments <= 15 && u32(4) == 64) {
        return { name: 'RLE', decoder: new RLEDecoder(reader) };
    }
    if (frames.every(f => fits(f.length, frameBytes))) {
        return { name: 'sin comprimir (encapsulado)', decoder: new EncapsulatedUncompressedDecoder(reader) };
    }
    return null;
}

/** Primer marcador SOF de un JPEG (C0-CF salvo DHT/JPG/DAC, o F7 = SOF55 de JPEG-LS); null si no lo hay. */
function jpegFrameMarker(s: string): number | null {
    const b = (i: number) => s.charCodeAt(i) & 0xFF;
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
