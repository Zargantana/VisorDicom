import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { PhotometricInterpretationType } from "../DCM/DCM-interpreter.class";
import { BaseColor } from "./base-color.class";

/**
 * Color "directo": RGB, YBR_FULL, YBR_FULL_422, YBR_PARTIAL_422/420, YBR_ICT/RCT y los retirados HSV, ARGB y CMYK
 * (y, por compatibilidad, 1 muestra empaquetada 3-3-2 / 5-6-5).
 * YBR_RCT llega siempre convertido (la inversa reversible la aplica el decoder JPEG 2000); si no, se pinta tal cual.
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
        const shift = bits > 8 ? (this.reader.BitsStored || bits) - 8 : 0; // 16 o 32 bits -> 8 bits de mayor peso
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

        const is422 = photometric == PhotometricInterpretationType.YBR_FULL_422 || photometric == PhotometricInterpretationType.YBR_PARTIAL_422;
        if (!this.colorAlreadyRGB && is422 && samples.length < pixels * 3) {
            // Nativo 4:2:2 -> por cada 2 pixeles: Y1 Y2 Cb Cr
            const partial = photometric == PhotometricInterpretationType.YBR_PARTIAL_422;
            // >>> y no >>: con 32 bits el bit alto haria negativa la muestra
            for (let p = 0, i = 0, j = 0; p < pixels && i + 3 < samples.length; p += 2, i += 4) {
                const cb = samples[i + 2] >>> shift, cr = samples[i + 3] >>> shift;
                j = partial ? this.putYBRPartial(data, j, samples[i] >>> shift, cb, cr) : this.putYBR(data, j, samples[i] >>> shift, cb, cr);
                if (p + 1 < pixels) {
                    j = partial ? this.putYBRPartial(data, j, samples[i + 1] >>> shift, cb, cr) : this.putYBR(data, j, samples[i + 1] >>> shift, cb, cr);
                }
            }
            return;
        }

        // Conversión por píxel según el modelo (si el decoder no entregó ya RGB)
        let convert: (data: Uint8ClampedArray, j: number, a: number, b: number, c: number, d: number) => number = this.putRGB;
        if (!this.colorAlreadyRGB) {
            switch (photometric) {
                case PhotometricInterpretationType.YBR_FULL:
                case PhotometricInterpretationType.YBR_FULL_422:
                case PhotometricInterpretationType.YBR_ICT:   // ICT = mismos coeficientes que YBR_FULL (sin MCT aplicada)
                    convert = (d, j, y, cb, cr) => this.putYBR(d, j, y, cb, cr);
                    break;
                case PhotometricInterpretationType.YBR_PARTIAL_422:
                case PhotometricInterpretationType.YBR_PARTIAL_420:
                    convert = (d, j, y, cb, cr) => this.putYBRPartial(d, j, y, cb, cr);
                    break;
                case PhotometricInterpretationType.HSV:
                    convert = this.putHSV;
                    break;
                case PhotometricInterpretationType.CMYK:
                    convert = this.putCMYK;
                    break;
                case PhotometricInterpretationType.ARGB:
                    convert = (d, j, a, r, g, b) => this.putRGB(d, j, r, g, b, 0); // A se ignora (ver doc)
                    break;
            }
        }
        const spp = Math.max(3, this.reader.SamplesPerPixel || 3);
        const count = Math.min(pixels, Math.floor(samples.length / spp));
        for (let p = 0, i = 0, j = 0; p < count; p++, i += spp) {
            j = convert(data, j, samples[i] >>> shift, samples[i + 1] >>> shift, samples[i + 2] >>> shift,
                        spp > 3 ? samples[i + 3] >>> shift : 0);
        }
    }

    private putRGB(data: Uint8ClampedArray, j: number, r: number, g: number, b: number, _unused: number): number {
        data[j] = r;
        data[j + 1] = g;
        data[j + 2] = b;
        return j + 4;
    }

    /** YBR_PARTIAL_4xx -> RGB (PS3.3 C.7.6.3.1.2): Y en [16,235], Cb/Cr en [16,240]. */
    private putYBRPartial(data: Uint8ClampedArray, j: number, y: number, cb: number, cr: number): number {
        const yy = 1.1644 * (y - 16);
        data[j] = yy + 1.5960 * (cr - 128);
        data[j + 1] = yy - 0.3918 * (cb - 128) - 0.8130 * (cr - 128);
        data[j + 2] = yy + 2.0172 * (cb - 128);
        return j + 4;
    }

    /** HSV (retirado) -> RGB. Muestras de 8 bits: H 0..255 = 0..360 grados, S y V 0..255. */
    private putHSV(data: Uint8ClampedArray, j: number, h: number, s: number, v: number, _unused: number): number {
        const hue = (h / 256) * 6, sat = s / 255;
        const sector = Math.floor(hue) % 6, f = hue - Math.floor(hue);
        const p = v * (1 - sat), q = v * (1 - sat * f), t = v * (1 - sat * (1 - f));
        const rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][sector];
        data[j] = rgb[0];
        data[j + 1] = rgb[1];
        data[j + 2] = rgb[2];
        return j + 4;
    }

    /** CMYK (retirado) -> RGB: R = (255 - C)(255 - K)/255, etc. */
    private putCMYK(data: Uint8ClampedArray, j: number, c: number, m: number, y: number, k: number): number {
        data[j] = (255 - c) * (255 - k) / 255;
        data[j + 1] = (255 - m) * (255 - k) / 255;
        data[j + 2] = (255 - y) * (255 - k) / 255;
        return j + 4;
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
