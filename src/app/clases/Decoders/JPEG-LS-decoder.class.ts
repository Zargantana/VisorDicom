import { BaseDecoder } from "./base-decoder-class";
import { CodecLoader } from "./codec-loader";
import { decodeWithEmscripten } from "./emscripten-codecs";

declare var JpegLS: any;

/**
 * JPEG-LS lossless / near-lossless con CharLS.js (src/libs/jpeg-ls.js, global `JpegLS`, CharLS 1.x).
 * Lo que ese build rechaza (p. ej. precisiones que no son 8 ni 16 bits, como los 7 bits del juego de pruebas de
 * JPEG-LS) se reintenta con CharLS 2.x (assets/codecs/charlsjs_decode.js, carga bajo demanda).
 */
export class JPEGLSDecoder extends BaseDecoder {
    public Decode(): any[] {
        return this.interpret.getEncapsulatedFrames().map(frame => {
            const bytes = BaseDecoder.toBytes(frame);
            try {
                return new JpegLS().decodeJPEGLS(bytes, !!this.reader.PixelRepresentation).pixelData;
            } catch (error) {
                if (CodecLoader.isUnavailable('charls')) {
                    throw error;
                }
                return decodeWithEmscripten('charls', 'JpegLSDecoder', bytes).data; // lanza CodecRequiredError hasta cargarse
            }
        });
    }
}
