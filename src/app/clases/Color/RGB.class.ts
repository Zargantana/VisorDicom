import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter } from "../DCM/DCM-interpreter.class";
import { BaseColor } from "./base-color.class";

export class RGBColor extends BaseColor {
    
    protected pixelDataStringTo32BitBuffer(data: Uint8ClampedArray, pixelData: string) {
        switch(this.reader.BitsAllocated) {
            case 8: {
                this.RGB8str(data, pixelData);
                break;
            }
            case 16:{
                const neoPixDat = new Uint8Array(pixelData.length);
                for(let i = 0; i < pixelData.length; i++) {
                    neoPixDat[i] = pixelData.charCodeAt(i);
                }
                this.pixelDataBufferTo32BitBuffer(data, neoPixDat);
                break;
            }
            default: {
                break;
            }
        }
    }

    protected pixelDataBufferTo32BitBuffer(data: Uint8ClampedArray, buffer: any): void {
        let pixelData: any;
        switch(this.reader.BitsAllocated) {
            case 8: {
                pixelData = new Uint8Array(buffer);
                switch (this.reader.SamplesPerPixel) {
                    case 1: {
                        this.RGB8buf(data, pixelData);
                        break;
                    }
                    case 3: {
                        this.RGB8buf3Samples(data, pixelData);
                        break;
                    }
                }
                break;
            }
            case 16:{
                pixelData = new Uint16Array(buffer);
                switch (this.reader.SamplesPerPixel) {
                    case 1: {
                        this.RGB16buf(data, pixelData);
                        break;
                    }
                    case 3: {
                        this.RGB16buf3Samples(data, pixelData);
                        break;
                    }
                }
                break;
            }
            default: {
                break;
            }

        }
    }

    private RGB8str(data: Uint8ClampedArray, pixelData: string) {
        for (let i = 0, j = 0; i < pixelData.length; i++, j++) {
            data[j++] = Math.floor((((pixelData.charCodeAt(i) & 0xE0) >> 5) * 255) / 7);
            data[j++] = Math.floor((((pixelData.charCodeAt(i) & 0x1C) >> 2) * 255) / 7);
            data[j++] = Math.floor(((pixelData.charCodeAt(i) & 0x03) * 255) / 3);
        }
    }

    private RGB8buf(data: Uint8ClampedArray, pixelData: Uint8Array) {
        for (let i = 0, j = 0; i < pixelData.length; i++, j++) {
            data[j++] = Math.floor((((pixelData[i] & 0xE0) >> 5) * 255) / 7);
            data[j++] = Math.floor((((pixelData[i] & 0x1C) >> 2) * 255) / 7);
            data[j++] = Math.floor(((pixelData[i] & 0x03) * 255) / 3);
        }
    }

    private RGB16buf(data: Uint8ClampedArray, pixelData: Uint8Array) {
        for (let i = 0, j = 0; i < pixelData.length; i++, j++) {
            data[j++] = Math.floor((((pixelData[i] & 0xF800) >> 11) * 255) / 0x1F);
            data[j++] = Math.floor((((pixelData[i] & 0x7E0) >> 5) * 255) / 0x3F);
            data[j++] = Math.floor(((pixelData[i] & 0x1F) * 255) / 0x1F);
        }
    }

    private RGB8buf3Samples(data: Uint8ClampedArray, pixelData: Uint8Array) {
        for (let i = 0, j = 0; i < pixelData.length; j++) {
            data[j++] = pixelData[i++];
            data[j++] = pixelData[i++];
            data[j++] = pixelData[i++];
        }
    }

    private RGB16buf3Samples(data: Uint8ClampedArray, pixelData: Uint8Array) {
        for (let i = 0, j = 0; i < pixelData.length; j++) {
            data[j++] = pixelData[i++] >> 8;
            data[j++] = pixelData[i++] >> 8;
            data[j++] = pixelData[i++] >> 8;
        }
    }
}