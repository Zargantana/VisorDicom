import { BaseDecoder } from "./base-decoder-class";

declare var jpeg: any;

export class UncompressedDecoder extends BaseDecoder {
    public Decode(): any[] {
        let decodedPixelData: any[] = [];
        let pixelData = this.interpret.getFramesData();
        if (pixelData.length > 1) {
            for(let i = 1; i < pixelData.length; i++) {
                let buffer = new Uint8Array(pixelData[i].length);
                for (let j = 0; j < pixelData[i].length; j++) {
                    buffer[j] = pixelData[i].charCodeAt(j);
                }
                decodedPixelData.push(buffer.buffer);
            }
        } else {
            let buffer = new Uint8Array(pixelData[0].length);
            for (let j = 0; j < pixelData[0].length; j++) {
                buffer[j] = pixelData[0].charCodeAt(j);
            }
            decodedPixelData.push(buffer.buffer);
        }
        return decodedPixelData;
    }
}