import { BaseDecoder } from "./base-decoder-class";
import { CodecRequiredError } from "./codec-loader";
import { decodeWithEmscripten } from "./emscripten-codecs";

declare var jpeg: any;

/**
 * JPEG Lossless Process 14 (cualquier predictor, 1.2.840.10008.1.2.4.57) y su Selection Value 1 (.70) con
 * jpeg-lossless-decoder-js (src/libs/lossless.js, global `jpeg`), de 2 a 16 bits.
 * Si falla un frame de 8 bits se reintenta con libjpeg-turbo 3 (asm.js), que tambien decodifica lossless (SOF3).
 */
export class JPEGLosslessDecoder extends BaseDecoder {
    public Decode(): any[] {
        return this.interpret.getEncapsulatedFrames().map(frame => {
            const bytes = BaseDecoder.toBytes(frame);
            try {
                return new jpeg.lossless.Decoder().decompress(bytes);
            } catch (error) {
                if (this.reader.BitsAllocated > 8 || error instanceof CodecRequiredError) {
                    throw error;
                }
                return decodeWithEmscripten('libjpeg-turbo', 'JPEGDecoder', bytes).data;
            }
        });
    }
}
