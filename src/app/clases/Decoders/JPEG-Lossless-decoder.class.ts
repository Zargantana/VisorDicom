import { BaseDecoder } from "./base-decoder-class";

declare var jpeg: any;

/** JPEG Lossless Process 14 (y Selection Value 1) con jpeg-lossless-decoder-js (global `jpeg`). */
export class JPEGLosslessDecoder extends BaseDecoder {
    public Decode(): any[] {
        return this.interpret.getEncapsulatedFrames().map(frame =>
            new jpeg.lossless.Decoder().decompress(BaseDecoder.toBytes(frame)));
    }
}
