import { BaseDecoder } from "./base-decoder-class";

declare var jpeg: any;

export class JPEGLosslessDecoder extends BaseDecoder {
    
    public Decode(): string[] {
        let decodedPixelData: string[] = [];
        let pixelData = this.interpret.getPixelDatas();
        if (pixelData.length > 1) {
            for(let i = 1; i < pixelData.length; i++) {
                var decoder = new jpeg.lossless.Decoder();
                let buffer = new Uint8Array(pixelData[i].length);
                for (let j = 0; j < pixelData[i].length; j++) {
                    buffer[j] = pixelData[i].charCodeAt(j);
                }
                decodedPixelData.push(decoder.decompress(buffer));
            }
        } else if (pixelData.length) {
            var decoder = new jpeg.lossless.Decoder();
            let buffer = new Uint8Array(pixelData[0].length);
            for (let j = 0; j < pixelData[0].length; j++) {
                buffer[j] = pixelData[0].charCodeAt(j);
            }
            decodedPixelData.push(decoder.decompress(buffer));
        }
        return decodedPixelData;
    }
}