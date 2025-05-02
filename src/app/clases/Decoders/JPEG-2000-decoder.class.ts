import { BaseDecoder } from "./base-decoder-class";

declare var JpxImage: any;

export class JPEG2000Decoder extends BaseDecoder {
    
    public Decode(): string[] {
        let decodedPixelData: string[] = [];
        let pixelData = this.interpret.getPixelDatas();
        if (pixelData.length > 1) {
            for(let i = 1; i < pixelData.length; i++) {
                var decoder = new JpxImage();
                let buffer = new Uint8Array(pixelData[i].length);
                for (let j = 0; j < pixelData[i].length; j++) {
                    buffer[j] = pixelData[i].charCodeAt(j);
                }
                decoder.parse(buffer);
                let decoded = decoder.tiles[0].items;
                decodedPixelData.push(decoded);
            }
        } else if (pixelData.length) {
            var decoder = new JpxImage();
            let buffer = new Uint8Array(pixelData[0].length);
            for (let j = 0; j < pixelData[0].length; j++) {
                buffer[j] = pixelData[0].charCodeAt(j);
            }
            decoder.parse(buffer);
            let decoded = decoder.tiles[0].items;
            decodedPixelData.push(decoded);
        }
        return decodedPixelData;
    }
}