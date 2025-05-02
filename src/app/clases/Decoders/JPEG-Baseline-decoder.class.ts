import { BaseDecoder } from "./base-decoder-class";

declare var JpegImage: any;

export class JPEGBaselineDecoder extends BaseDecoder {
    
    public Decode(): string[] {
        let decodedPixelData: string[] = [];
        let pixelData = this.interpret.getPixelDatas();
        if (pixelData.length > 1) {
            for(let i = 1; i < pixelData.length; i++) {
                var decoder = new JpegImage();
                let buffer = new Uint8Array(pixelData[i].length);
                for (let j = 0; j < pixelData[i].length; j++) {
                    buffer[j] = pixelData[i].charCodeAt(j);
                }
                decoder.parse(buffer);
                let width = decoder.width;
                let height = decoder.height;

                let decoded;
                if (this.reader.BitsAllocated === 8) {
                    decoded = decoder.getData(width, height);
                } else if (this.reader.BitsAllocated === 16) {
                    decoded = decoder.getData16(width, height);
                }
                decodedPixelData.push(decoded);
            }
        } else if (pixelData.length) {
            var decoder = new JpegImage();
            let buffer = new Uint8Array(pixelData[0].length);
            for (let j = 0; j < pixelData[0].length; j++) {
                buffer[j] = pixelData[0].charCodeAt(j);
            }
            decoder.parse(buffer);
            let width = decoder.width;
            let height = decoder.height;

            let decoded;
            if (this.reader.BitsAllocated === 8) {
                decoded = decoder.getData(width, height);
            } else if (this.reader.BitsAllocated === 16) {
                decoded = decoder.getData16(width, height);
            }
            decodedPixelData.push(decoded);
        }
        return decodedPixelData;
    }
}