import { BaseDecoder } from "./base-decoder-class";

declare var JpegImage: any;

/**
 * JPEG Baseline (Process 1, 8 bits) y JPEG Extended (Process 2 & 4, 12 bits) con src/libs/jpeg-baseline.js
 * (JpegImage, derivado de pdf.js). Con 3 componentes la libreria convierte YCbCr -> RGB.
 */
export class JPEGBaselineDecoder extends BaseDecoder {
    public override outputIsRGB: boolean = true;

    public Decode(): any[] {
        return this.interpret.getEncapsulatedFrames().map(frame => {
            const decoder = new JpegImage();
            decoder.parse(BaseDecoder.toBytes(frame));
            return (this.reader.BitsAllocated > 8)
                ? decoder.getData16(decoder.width, decoder.height)
                : decoder.getData(decoder.width, decoder.height);
        });
    }
}
