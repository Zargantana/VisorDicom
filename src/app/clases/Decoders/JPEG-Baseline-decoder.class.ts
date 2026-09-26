import { BaseDecoder } from "./base-decoder-class";
import { CodecLoader } from "./codec-loader";
import { decodeWithEmscripten } from "./emscripten-codecs";

declare var JpegImage: any;

/**
 * JPEG Baseline (Process 1, 8 bits) y JPEG Extended (Process 2 & 4, 8/12 bits) con src/libs/jpeg-baseline.js
 * (JpegImage, derivado de pdf.js; con 3 componentes convierte YCbCr -> RGB).
 * Si JpegImage no puede con un frame (marcadores raros, aritmetico mal etiquetado...), se reintenta con libjpeg-turbo
 * (asm.js, carga bajo demanda): el build de 8 bits o el de 12 bits segun BitsAllocated. Los dos entregan RGB.
 * Con 12 bits se prefiere libjpeg-turbo (misma IDCT que las referencias) y JpegImage queda de reserva.
 */
export class JPEGBaselineDecoder extends BaseDecoder {
    public override outputIsRGB: boolean = true;

    public Decode(): any[] {
        return this.interpret.getEncapsulatedFrames().map(frame => {
            const bytes = BaseDecoder.toBytes(frame);
            if (this.reader.BitsAllocated > 8 && !CodecLoader.isUnavailable('libjpeg-turbo-12')) {
                return decodeWithEmscripten('libjpeg-turbo-12', 'JPEGDecoder', bytes).data; // lanza CodecRequiredError hasta cargarse
            }
            try {
                const decoder = new JpegImage();
                decoder.parse(bytes);
                decoder.colorTransform = JPEGBaselineDecoder.wantsColorTransform(decoder, this.reader.PhotometricInterpretation);
                return (this.reader.BitsAllocated > 8)
                    ? decoder.getData16(decoder.width, decoder.height)
                    : decoder.getData(decoder.width, decoder.height);
            } catch (error) {
                const codec = (this.reader.BitsAllocated > 8) ? 'libjpeg-turbo-12' : 'libjpeg-turbo';
                return decodeWithEmscripten(codec, 'JPEGDecoder', bytes).data;
            }
        });
    }

    /**
     * Si hay que deshacer la transformacion YCbCr de un JPEG de 3 componentes (PS3.5 8.2.1 y la nota tecnica de
     * Adobe): manda el APP14 de Adobe (transform 0 = RGB tal cual, 1 = YCbCr); sin el, un APP0 JFIF implica YCbCr;
     * y sin marcadores decide la Photometric Interpretation del DICOM: RGB = sin transformar, YBR_* = YCbCr.
     * JpegImage por defecto transforma siempre, y eso tenia los JPEG RGB de DCMTK/GDCM en colores falsos.
     */
    public static wantsColorTransform(decoder: any, photometric: string): boolean {
        // Un APP14 recortado (sin el byte de transformacion) no dice nada: se ignora, como hace libjpeg
        if (decoder.adobe && typeof decoder.adobe.transformCode === 'number') {
            return decoder.adobe.transformCode != 0;
        }
        if (decoder.jfif) {
            return true;
        }
        const pi = (photometric || '').replace(/\0/g, '').trim().toUpperCase();
        return !pi.startsWith('RGB');
    }
}

/**
 * Procesos JPEG retirados que JpegImage no cubre o cubre mal, con libjpeg-turbo:
 *   .52 Extended aritmetico (3 & 5), .53/.54 Spectral Selection (6 & 8 / 7 & 9),
 *   .55/.56 Full Progression (10 & 12 / 11 & 13), .58 Lossless aritmetico (15).
 * Hasta 8 bits, el build de 8 bits; con 12 bits (procesos 5, 8, 9, 12, 13), el build de 12 bits (WITH12BIT), que es
 * el unico que decodifica el progresivo y el aritmetico de 12 bits. Si ese build no esta disponible, se intenta
 * JpegImage, que entiende el progresivo Huffman de 12 bits.
 */
export class JPEGRetiredProcessesDecoder extends BaseDecoder {
    public override outputIsRGB: boolean = true;

    public Decode(): any[] {
        return this.interpret.getEncapsulatedFrames().map(frame => {
            const bytes = BaseDecoder.toBytes(frame);
            if (this.reader.BitsAllocated <= 8) {
                return decodeWithEmscripten('libjpeg-turbo', 'JPEGDecoder', bytes).data;
            }
            if (!CodecLoader.isUnavailable('libjpeg-turbo-12')) {
                // Lanza CodecRequiredError hasta que ImageDCM.prepare() cargue el codec y reintente
                return decodeWithEmscripten('libjpeg-turbo-12', 'JPEGDecoder', bytes).data;
            }
            const decoder = new JpegImage();
            decoder.parse(bytes);
            decoder.colorTransform = JPEGBaselineDecoder.wantsColorTransform(decoder, this.reader.PhotometricInterpretation);
            return decoder.getData16(decoder.width, decoder.height);
        });
    }
}

