import { BaseDecoder } from "./base-decoder-class";

declare var JpegLS: any;

/** JPEG-LS lossless / near-lossless con CharLS.js (src/libs/jpeg-ls.js, global `JpegLS`). */
export class JPEGLSDecoder extends BaseDecoder {
    public Decode(): any[] {
        return this.interpret.getEncapsulatedFrames().map(frame =>
            new JpegLS().decodeJPEGLS(BaseDecoder.toBytes(frame), !!this.reader.PixelRepresentation).pixelData);
    }
}
