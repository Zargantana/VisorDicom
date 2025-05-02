import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter } from "../DCM/DCM-interpreter.class";
import { BaseDecoder } from "./base-decoder-class";

export class RLEDecoder extends BaseDecoder {
    private numberOfSegments: number = 0;
    private offsets: number[] = [];

    public Decode(): string[] {
        let decodedPixelData: string[] = [];
        let pixelData = this.interpret.getPixelDatas();
        if (pixelData.length > 1) {
            for(let i = 1; i < pixelData.length; i++) {
                decodedPixelData.push(this._decode(pixelData[i]));
            }
        } else if (pixelData.length) {
            decodedPixelData.push(this._decode(pixelData[0]));
        }
        return decodedPixelData;
    }

    private read32BitsNumber(raw: string, LE: boolean): number {
        let result = (raw.charCodeAt(LE?3:2) * 256 + raw.charCodeAt(LE?2:3)) * 256 * 256;
        result += raw.charCodeAt(LE?1:0) * 256 + raw.charCodeAt(LE?0:1);
        return result;
    }

    private _decode(pixelData: string): string {
        
        this.numberOfSegments = this.read32BitsNumber(pixelData, this.reader.isLittleEndian); 
        
        for (let i = 0; i < 15; i++) {
            this.offsets[i] = this.read32BitsNumber(pixelData.substring(Int32Array.BYTES_PER_ELEMENT * (i + 1)), this.reader.isLittleEndian);
        }

        let bytesAllocated = (this.reader.BitsAllocated / 8);
        let pixelCount = this.reader.Columns * this.reader.Rows;
        let decodedData = '';
        for (let s = 0; s < this.numberOfSegments; s++) {
            let pos, offset;
            const sample = Math.trunc(s / bytesAllocated);
            const sabyte = Math.trunc(s % bytesAllocated);
            if (this.reader.PlannarConfiguration == 0) {
              pos = sample * bytesAllocated;
              offset = this.reader.SamplesPerPixel * bytesAllocated;
            } else {
              pos = sample * bytesAllocated * pixelCount;
              offset = bytesAllocated;
            }
            pos += bytesAllocated - sabyte - 1;
            decodedData += this._decodeSegment(pixelData, s, pos, offset);
        }

        return decodedData;
    }

    private _getSegmentLength(segment: number, pixelData: string) {
        const offset = this.offsets[segment];
        if (segment < this.numberOfSegments - 1) {
          const next = this.offsets[segment + 1];
          return next - offset;
        }
        return pixelData.length - offset;
    }

    private _decodeSegment(pixelData: string, segment: number, start: number, sampleOffset: number): string {
        if (segment < 0 || segment >= this.numberOfSegments) {
          throw new Error('Segment number out of range');
        }
        const offset = this.offsets[segment];
        const length = this._getSegmentLength(segment, pixelData);
        return this.__decode(start, sampleOffset, pixelData, offset, length);
    }

    private _uncomplement(val: number, bitWidth: number) {
        const isNegative = val & (1 << (bitWidth - 1));
        const boundary = 1 << bitWidth;
        const minVal = -boundary;
        const mask = boundary - 1;
    
        return isNegative ? minVal + (val & mask) : val;
    }

    //TODO: Dificilmente va a trabajar con un sampleOffset de mas de 1
    private __decode(start: number, sampleOffset: number, rleData: string, offset: number, count: number): string {
        let buffer: string = '';
        let pos = start;
        const end = offset + count;
        let bytesAllocated = (this.reader.BitsAllocated / 8);
        let pixelCount = this.reader.Columns * this.reader.Rows;
        const bufferLength = pixelCount * bytesAllocated;
    
        for (let i = offset; i < end && pos < bufferLength; ) {
            const control = this._uncomplement(rleData.charCodeAt(i++), 8);
            if (control >= 0) {
                let length = control + 1;
                if (end - i < length) {
                    throw new Error('RLE literal run exceeds input buffer length');
                }
                if (pos + (length - 1) * sampleOffset >= bufferLength) {
                    throw new Error('RLE literal run exceeds output buffer length');
                }
                if (sampleOffset === 1) {
                for (let j = 0; j < length; ++j, ++i, ++pos) {
                    buffer += rleData[i];
                }
                } else {
                    while (length-- > 0) {
                        buffer += rleData[i++];
                        pos += sampleOffset;
                    }
                }
            } else if (control >= -127) {
                let length = -control;
                if (pos + (length - 1) * sampleOffset >= bufferLength) {
                    throw new Error('RLE repeat run exceeds output buffer length');
                }
                const b = rleData[i++];
                if (sampleOffset === 1) {
                    while (length-- >= 0) {
                        buffer += b;
                        pos++
                    }
                } else { 
                    while (length-- >= 0) {
                        buffer += b;
                        pos += sampleOffset;
                    }
                }
            }
            if (i + 1 >= end) {
                break;
            }
        }  
        return buffer; 
    }   
}