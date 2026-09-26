import { BaseDecoder } from "./base-decoder-class";
import { decodeWithEmscripten } from "./emscripten-codecs";

declare var JpegImage: any;

/**
 * JPEG Baseline (Process 1, 8 bits) y JPEG Extended (Process 2 & 4, 8/12 bits) con src/libs/jpeg-baseline.js
 * (JpegImage, derivado de pdf.js; con 3 componentes convierte YCbCr -> RGB).
 * Si JpegImage no puede con un frame de 8 bits (marcadores raros, aritmetico mal etiquetado...), se reintenta con
 * libjpeg-turbo (asm.js, carga bajo demanda), que tambien entrega RGB.
 */
export class JPEGBaselineDecoder extends BaseDecoder {
    public override outputIsRGB: boolean = true;

    public Decode(): any[] {
        return this.interpret.getEncapsulatedFrames().map(frame => {
            const bytes = BaseDecoder.toBytes(frame);
            try {
                const decoder = new JpegImage();
                decoder.parse(bytes);
                return (this.reader.BitsAllocated > 8)
                    ? decoder.getData16(decoder.width, decoder.height)
                    : decoder.getData(decoder.width, decoder.height);
            } catch (error) {
                if (this.reader.BitsAllocated > 8) {
                    throw error; // el build de libjpeg-turbo es de 8 bits
                }
                return decodeWithEmscripten('libjpeg-turbo', 'JPEGDecoder', bytes).data;
            }
        });
    }
}

/**
 * Procesos JPEG retirados de 8 bits que JpegImage no cubre o cubre mal, con libjpeg-turbo:
 *   .52 Extended aritmetico (3 & 5), .53/.54 Spectral Selection (6 & 8 / 7 & 9),
 *   .55/.56 Full Progression (10 & 12 / 11 & 13), .58 Lossless aritmetico (15).
 * Con mas de 8 bits (procesos 5, 8, 9, 12, 13) se intenta JpegImage, que entiende el progresivo Huffman de 12 bits.
 */
export class JPEGRetiredProcessesDecoder extends BaseDecoder {
    public override outputIsRGB: boolean = true;

    public Decode(): any[] {
        return this.interpret.getEncapsulatedFrames().map(frame => {
            const bytes = BaseDecoder.toBytes(frame);
            if (this.reader.BitsAllocated <= 8) {
                return decodeWithEmscripten('libjpeg-turbo', 'JPEGDecoder', bytes).data;
            }
            const decoder = new JpegImage();
            decoder.parse(bytes);
            return decoder.getData16(decoder.width, decoder.height);
        });
    }
}

