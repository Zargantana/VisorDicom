import { LUTInformation } from "../DCM/DCM-interpreter.class";
import { BaseColor } from "./base-color.class";

export class Monochorme2Color extends BaseColor {
    
    protected pixelDataBufferTo32BitBuffer(data: Uint8ClampedArray, buffer: any): void {
        let pixeldata: any;
        switch (this.reader.BitsAllocated) {
            case 8: {
                if (this.reader.PixelRepresentation) {
                    pixeldata = new Int8Array(buffer); 
                } else {
                    pixeldata = new Uint8Array(buffer); 
                }
                break;
            }
            case 16: 
            default: {
                if (this.reader.PixelRepresentation) {
                    pixeldata = new Int16Array(buffer); 
                } else {
                    pixeldata = new Uint16Array(buffer); 
                }
                break;
            }        
        }
        
        if (this.RescaleParams.Intercept != 0 || this.RescaleParams.Slope != 1) {
            let BufferCopy = [];
            for (let i = 0; i < pixeldata.length; i++) {
                BufferCopy.push(this.applyRescale(pixeldata[i]));
            }
            pixeldata = BufferCopy;
        } 

        if (this.VOIwindow.WindowCenter.length) { //WINDOW
            for (let i = 0, j = 0; i < pixeldata.length; i++, j++) {
                let pixel: number = pixeldata[i]; 
                
                pixel = this.applyVOIWindow(pixel, 0, this.VOIwindow.VOIfunction);
                
                data[j++] = pixel; 
                data[j++] = pixel; 
                data[j++] = pixel; 
            }
        } else if (this.VOIwindow.LUT.entries > 0) {//LUT
            const LUTData = new Uint8Array(this.VOIwindow.LUT.LUTData.length);
            for(let i = 0; i < this.VOIwindow.LUT.LUTData.length; i++) {
                LUTData[i] = this.VOIwindow.LUT.LUTData.charCodeAt(i);
            }
            let LUTDataBuffer: any;
            switch (this.VOIwindow.LUT.bitPerEntry) {
                case 16: {
                    LUTDataBuffer = new Uint16Array(LUTData.buffer);
                    break;
                }
                default :
                    LUTDataBuffer = LUTData;
            }
            for (let i = 0, j = 0; i < pixeldata.length; i++, j++) {
                let pixel: number = pixeldata[i]; 
                let mask = this.getMask();
                pixel = mask & pixel;
                pixel = this.getLUTPixelValue(LUTDataBuffer, this.VOIwindow.LUT, pixel);

                let range = LUTDataBuffer[LUTDataBuffer.length - 1] - LUTDataBuffer[0];
                pixel = ((pixel - LUTDataBuffer[0])*255)/range;

                data[j++] = pixel; 
                data[j++] = pixel; 
                data[j++] = pixel; 
            }        
        } else { //NO LUT NO WINDOW
            for (let i = 0, j = 0; i < pixeldata.length; i++, j++) {
                let pixel: number = pixeldata[i]; 
                let mask = this.getMask();
                pixel = mask & pixel;
                
                pixel =  (pixel*255)/mask;
                
                data[j++] = pixel; 
                data[j++] = pixel; 
                data[j++] = pixel; 
            }
        }
    }   
    
    private getLUTPixelValue(LUTDataBuffer: any, LUTData: LUTInformation, pixel: number): number {
        let result: number = 0;
        if (pixel < LUTData.firstStoredPixelValueMapped) {
            result = LUTDataBuffer[0];
        } else if (pixel >= LUTData.firstStoredPixelValueMapped + LUTData.entries){
            result = LUTDataBuffer[LUTData.entries -1];
        } else {
            result = LUTDataBuffer[pixel - LUTData.firstStoredPixelValueMapped];
        }
        return result;
    }

    private getMask(): number {
        let result: number = 0;
        for(let i = 0; i < this.reader.BitsAllocated; i++) {
            result = (result << 1) + 1;
        }
        return result;
    }

    protected pixelDataStringTo32BitBuffer(data: Uint8ClampedArray, pixelData: string): void {
        const neoPixDat = new Uint8Array(pixelData.length);
        for(let i = 0; i < pixelData.length; i++) {
            neoPixDat[i] = pixelData.charCodeAt(i);
        }
        this.pixelDataBufferTo32BitBuffer(data, neoPixDat.buffer);
    }
}