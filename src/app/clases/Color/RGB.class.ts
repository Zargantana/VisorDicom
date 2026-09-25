import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { PhotometricInterpretationType } from "../DCM/DCM-interpreter.class";
import { BaseColor } from "./base-color.class";

/**
 * Color "directo": RGB, YBR_FULL, YBR_FULL_422 (y, por compatibilidad, 1 muestra empaquetada 3-3-2 / 5-6-5).
 *
 * Los decoders entregan SIEMPRE las muestras entrelazadas (R G B R G B...): la Planar Configuration nativa
 * se normaliza en UncompressedDecoder y RLE se reentrelaza al decodificar.
 * Si el decoder ya convirtio a RGB (JPEG baseline hace YCbCr->RGB, JPEG 2000 invierte la MCT) se pasa
 * colorAlreadyRGB = true y no se vuelve a convertir.
 */
export class RGBColor extends BaseColor {

    constructor(reader: DCMFileReader, windowIndex: number = 0, private colorAlreadyRGB: boolean = false) {
        super(reader, windowIndex);
    }

    protected pixelDataBufferTo32BitBuffer(data: Uint8ClampedArray, buffer: any): void {
        const bits = this.reader.BitsAllocated || 8;
        const samples = this.toSamples(buffer, bits, false);
        const shift = bits > 8 ? (this.reader.BitsStored || bits) - 8 : 0; // 16 bits -> 8 bits de mayor peso
        const pixels = data.length >> 2;
        const photometric = this.interpret.getPhotometricInterpretation();

        if (this.reader.SamplesPerPixel == 1) {
            if (bits == 8) {
                this.RGB8buf(data, samples as Uint8Array);
            } else {
                this.RGB16buf(data, samples as Uint16Array);
            }
            return;
        }

        if (!this.colorAlreadyRGB && photometric == PhotometricInterpretationType.YBR_FULL_422
            && samples.length < pixels * 3) {
            // Nativo 4:2:2 -> por cada 2 pixeles: Y1 Y2 Cb Cr
            for (let p = 0, i = 0, j = 0; p < pixels && i + 3 < samples.length; p += 2, i += 4) {
                const cb = samples[i + 2] >> shift, cr = samples[i + 3] >> shift;
                j = this.putYBR(data, j, samples[i] >> shift, cb, cr);
                if (p + 1 < pixels) {
                    j = this.putYBR(data, j, samples[i + 1] >> shift, cb, cr);
                }
            }
            return;
        }

        const isYBR = !this.colorAlreadyRGB &&
            (photometric == PhotometricInterpretationType.YBR_FULL || photometric == PhotometricInterpretationType.YBR_FULL_422);
        const count = Math.min(pixels, Math.floor(samples.length / 3));
        for (let p = 0, i = 0, j = 0; p < count; p++, i += 3) {
            const a = samples[i] >> shift, b = samples[i + 1] >> shift, c = samples[i + 2] >> shift;
            if (isYBR) {
                j = this.putYBR(data, j, a, b, c);
            } else {
                data[j] = a;
                data[j + 1] = b;
                data[j + 2] = c;
                j += 4;
            }
        }
    }

    /** YBR_FULL -> RGB (PS3.3 C.7.6.3.1.2, coeficientes CCIR 601 de rango completo). */
    private putYBR(data: Uint8ClampedArray, j: number, y: number, cb: number, cr: number): number {
        data[j] = y + 1.402 * (cr - 128);
        data[j + 1] = y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128);
        data[j + 2] = y + 1.772 * (cb - 128);
        return j + 4;
    }

    // Legado: 1 muestra por pixel sin Photometric reconocible -> se interpreta como color empaquetado.
    private RGB8buf(data: Uint8ClampedArray, pixelData: Uint8Array) {
        for (let i = 0, j = 0; i < pixelData.length && j < data.length; i++, j++) {
            data[j++] = Math.floor((((pixelData[i] & 0xE0) >> 5) * 255) / 7);
            data[j++] = Math.floor((((pixelData[i] & 0x1C) >> 2) * 255) / 7);
            data[j++] = Math.floor(((pixelData[i] & 0x03) * 255) / 3);
        }
    }

    private RGB16buf(data: Uint8ClampedArray, pixelData: Uint16Array) {
        for (let i = 0, j = 0; i < pixelData.length && j < data.length; i++, j++) {
            data[j++] = Math.floor((((pixelData[i] & 0xF800) >> 11) * 255) / 0x1F);
            data[j++] = Math.floor((((pixelData[i] & 0x7E0) >> 5) * 255) / 0x3F);
            data[j++] = Math.floor(((pixelData[i] & 0x1F) * 255) / 0x1F);
        }
    }
}
