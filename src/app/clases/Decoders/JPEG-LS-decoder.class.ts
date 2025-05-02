import { BaseDecoder } from "./base-decoder-class";

declare var JpegLS: any;

export class JPEGLSDecoder extends BaseDecoder {
    
    public Decode(): string[] {
        let decodedPixelData: string[] = [];
        let pixelData = this.interpret.getPixelDatas();
        if (pixelData.length > 1) {
            for(let i = 1; i < pixelData.length; i++) {
                var decoder = new JpegLS();
                let buffer = new Uint8Array(pixelData[i].length);
                for (let j = 0; j < pixelData[i].length; j++) {
                    buffer[j] = pixelData[i].charCodeAt(j);
                }
                
                let decoded = decoder.decodeJPEGLS(buffer);
                decodedPixelData.push(decoded.pixelData);
            }
        } else if (pixelData.length) {
            var decoder = new JpegLS();
            let buffer = new Uint8Array(pixelData[0].length);
            for (let j = 0; j < pixelData[0].length; j++) {
                buffer[j] = pixelData[0].charCodeAt(j);
            }
            
            let decoded = decoder.decodeJPEGLS(buffer);
            decodedPixelData.push(decoded.pixelData);
        }
        return decodedPixelData;
    }
}