import { ElementRef } from "@angular/core";
import { TRANSFER_SYNTAX, TX_Map } from "src/app/dictionaries/transfer-syntaxes";
import { ColorFactory } from "../Color/color-factory.class";
import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { BaseDecoder } from "../Decoders/base-decoder-class";
import { JPEG2000Decoder } from "../Decoders/JPEG-2000-decoder.class";
import { JPEGBaselineDecoder } from "../Decoders/JPEG-Baseline-decoder.class";
import { JPEGLosslessDecoder } from "../Decoders/JPEG-Lossless-decoder.class";
import { JPEGLSDecoder } from "../Decoders/JPEG-LS-decoder.class";
import { RLEDecoder } from "../Decoders/RLE-decoder.class";
import { UncompressedDecoder } from "../Decoders/Uncompressed-decoder.class";

export class ImageDCM  {

    public currentFrame: number = 0;
    public frames: number;
    private rawFrames: any[] | null = null;

    constructor(public reader: DCMFileReader) {
        this.frames = reader.Frames;
    }

    private clearDCMImpairValue(value: string): string {
        if ((value.length % 2 == 0) && (value.charCodeAt(value.length - 1) == 0x00)) {
            return value.substring(0, value.length - 1);
        }
        return value;
    }

    public NextFrame() {
        this.currentFrame = (++this.currentFrame) % this.reader.Frames;
    }

    public FrameBefore() {
        if ((--this.currentFrame) < 0) {
            this.currentFrame = this.reader.Frames - 1; 
        }
        this.currentFrame = this.currentFrame % this.reader.Frames;
    }

    private preloadImageFrames() {        
        let deco: BaseDecoder | null = null;
        let txMap: TX_Map = new TX_Map();
        switch (txMap.get(this.clearDCMImpairValue(this.reader.TransferSyntax))) {
            case TRANSFER_SYNTAX.Explicit_VR_Little_Endian: 
            case TRANSFER_SYNTAX.Explicit_VR_Big_Endian:
            case TRANSFER_SYNTAX.Implicit_VR_Endian: {
                deco = new UncompressedDecoder(this.reader);
                break;
            }
            case TRANSFER_SYNTAX.RLE_Lossless: {
                    deco = new RLEDecoder(this.reader);
                    break;
            }
            case TRANSFER_SYNTAX.JPEG_Baseline_Process_2_4:
            case TRANSFER_SYNTAX.JPEG_Baseline_Process_1: {
                deco = new JPEGBaselineDecoder(this.reader);
                break;
            }
            case TRANSFER_SYNTAX.JPEG_Lossless_Nonhierarchical_First_Order_Prediction_Processes_14_Selection_Value_1: 
            case TRANSFER_SYNTAX.JPEG_Lossless_Nonhierarchical_Processes_14: {
                deco = new JPEGLosslessDecoder(this.reader);
                break;
            }
            case TRANSFER_SYNTAX.JPEG_2000_Image_Compression_Lossless_Only:
            case TRANSFER_SYNTAX.JPEG_2000_Image_Compression: {
                deco = new JPEG2000Decoder(this.reader);
                break;
            }
            case TRANSFER_SYNTAX.JPEG_LS_Lossless_Image_Compression:
            case TRANSFER_SYNTAX.JPEG_LS_Lossy_Near_Lossless_Image_Compression: {
                deco = new JPEGLSDecoder(this.reader);
                break;
            }

        }
        if (deco) {
            this.rawFrames = deco.Decode();
        }
    }

    public paintImage(imageDisplay: ElementRef<HTMLImageElement>) {
        if (!this.rawFrames) {
            this.preloadImageFrames();
        }
        if (this.rawFrames) {
            this.createImageData(this.rawFrames[this.currentFrame % this.rawFrames.length], imageDisplay.nativeElement);
        }
    }

    private createImageData(frame: any, imageDisplay: HTMLImageElement): any {
        if (this.reader) {
    
          var canvas = document.createElement("canvas");
          canvas.width = this.reader.Columns;
          canvas.height = this.reader.Rows;
          var ctx = canvas.getContext("2d");
          if (ctx)
          {
            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, this.reader.Columns, this.reader.Rows);
            
            let result: ImageData = ctx.getImageData(0, 0, this.reader.Columns, this.reader.Rows);
            let data: Uint8ClampedArray = result.data;
    
            let colorFractory = new ColorFactory(this.reader);
            colorFractory.pixelDataTo32BitBuffer(data, frame);
            
            ctx.putImageData(result, 0, 0); 
          }
    
          imageDisplay.src = canvas.toDataURL("image/png");
        }
    }
}