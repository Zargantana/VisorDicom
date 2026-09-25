import { ElementRef } from "@angular/core";
import { TRANSFER_SYNTAX, TX_Map } from "src/app/dictionaries/transfer-syntaxes";
import { ColorFactory } from "../Color/color-factory.class";
import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter } from "../DCM/DCM-interpreter.class";
import { BaseDecoder } from "../Decoders/base-decoder-class";
import { EncapsulatedUncompressedDecoder } from "../Decoders/Encapsulated-Uncompressed-decoder.class";
import { JPEG2000Decoder } from "../Decoders/JPEG-2000-decoder.class";
import { JPEGBaselineDecoder } from "../Decoders/JPEG-Baseline-decoder.class";
import { JPEGLosslessDecoder } from "../Decoders/JPEG-Lossless-decoder.class";
import { JPEGLSDecoder } from "../Decoders/JPEG-LS-decoder.class";
import { RLEDecoder } from "../Decoders/RLE-decoder.class";
import { UncompressedDecoder } from "../Decoders/Uncompressed-decoder.class";

/** Una ventana VOI (0028,1050/1051/1055) tal y como se ofrece en el visor. */
export interface VOIWindowOption {
    center: number;
    width: number;
    explanation: string;
}

/**
 * Imagen DICOM "pintable": decodifica una vez (cache de frames en rawFrames) y convierte a RGBA
 * en cada pintado con la ventana VOI seleccionada.
 */
export class ImageDCM  {

    public currentFrame: number = 0;
    public frames: number;
    /** Indice de la ventana VOI a aplicar (0 = la primera definida en el fichero). */
    public selectedWindow: number = 0;
    private rawFrames: any[] | null = null;
    private decoderOutputIsRGB: boolean = false;
    private _windows: VOIWindowOption[] | null = null;

    constructor(public reader: DCMFileReader) {
        this.frames = reader.Frames;
    }

    /** Ventanas VOI definidas en el fichero (vacio si no hay Window Center/Width). */
    public get windows(): VOIWindowOption[] {
        if (!this._windows) {
            const voi = new DCMInterpreter(this.reader).getVOIData();
            const count = Math.min(voi.WindowCenter.length, voi.WindowWidth.length);
            this._windows = [];
            for (let i = 0; i < count; i++) {
                this._windows.push({
                    center: voi.WindowCenter[i],
                    width: voi.WindowWidth[i],
                    explanation: voi.WindowDescription[i] ?? ''
                });
            }
        }
        return this._windows;
    }

    public get windowCount(): number {
        return this.windows.length;
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

    /** Transfer Syntax -> decoder. null = TS sin soporte (se registra en consola). */
    private createDecoder(): BaseDecoder | null {
        let txMap: TX_Map = new TX_Map();
        switch (txMap.getClean(this.reader.TransferSyntax)) {
            case TRANSFER_SYNTAX.Explicit_VR_Little_Endian:
            case TRANSFER_SYNTAX.Explicit_VR_Big_Endian:
            case TRANSFER_SYNTAX.Deflated_Explicit_VR_Little_Endian: // ya inflado al leer el fichero (DCMFile)
            case TRANSFER_SYNTAX.Implicit_VR_Endian:
                return new UncompressedDecoder(this.reader);
            case TRANSFER_SYNTAX.Encapsulated_Uncompressed_Explicit_VR_Little_Endian:
                return new EncapsulatedUncompressedDecoder(this.reader);
            case TRANSFER_SYNTAX.RLE_Lossless:
                return new RLEDecoder(this.reader);
            case TRANSFER_SYNTAX.JPEG_Baseline_Process_2_4:
            case TRANSFER_SYNTAX.JPEG_Baseline_Process_1:
                return new JPEGBaselineDecoder(this.reader);
            case TRANSFER_SYNTAX.JPEG_Lossless_Nonhierarchical_First_Order_Prediction_Processes_14_Selection_Value_1:
            case TRANSFER_SYNTAX.JPEG_Lossless_Nonhierarchical_Processes_14:
                return new JPEGLosslessDecoder(this.reader);
            case TRANSFER_SYNTAX.JPEG_2000_Image_Compression_Lossless_Only:
            case TRANSFER_SYNTAX.JPEG_2000_Image_Compression:
                return new JPEG2000Decoder(this.reader);
            case TRANSFER_SYNTAX.JPEG_LS_Lossless_Image_Compression:
            case TRANSFER_SYNTAX.JPEG_LS_Lossy_Near_Lossless_Image_Compression:
                return new JPEGLSDecoder(this.reader);
        }
        console.warn('Transfer Syntax sin decoder: ' + this.reader.TransferSyntax + ' (' + this.reader.TransferSyntaxName + ')');
        return null;
    }

    private preloadImageFrames() {
        const deco = this.createDecoder();
        if (deco) {
            this.rawFrames = deco.Decode();
            this.decoderOutputIsRGB = deco.outputIsRGB;
        }
    }

    /** RGBA (Rows x Columns x 4) del frame indicado con la ventana seleccionada. null si no se puede decodificar. */
    public renderFrameRGBA(frameIndex: number = this.currentFrame): Uint8ClampedArray | null {
        if (!this.rawFrames) {
            this.preloadImageFrames();
        }
        if (!this.rawFrames || this.rawFrames.length == 0) {
            return null;
        }
        const data = new Uint8ClampedArray(this.reader.Columns * this.reader.Rows * 4);
        for (let i = 3; i < data.length; i += 4) {
            data[i] = 255; // opaco (antes: fillRect negro)
        }
        new ColorFactory(this.reader).pixelDataTo32BitBuffer(
            data, this.rawFrames[frameIndex % this.rawFrames.length], this.selectedWindow, this.decoderOutputIsRGB);
        return data;
    }

    public paintImage(imageDisplay: ElementRef<HTMLImageElement>) {
        const rgba = this.renderFrameRGBA(this.currentFrame);
        if (rgba) {
            this.createImageData(rgba, imageDisplay.nativeElement);
        }
    }

    private createImageData(rgba: Uint8ClampedArray, imageDisplay: HTMLImageElement): void {
        var canvas = document.createElement("canvas");
        canvas.width = this.reader.Columns;
        canvas.height = this.reader.Rows;
        var ctx = canvas.getContext("2d");
        if (ctx) {
            const result: ImageData = ctx.createImageData(this.reader.Columns, this.reader.Rows);
            result.data.set(rgba);
            ctx.putImageData(result, 0, 0);
        }
        imageDisplay.src = canvas.toDataURL("image/png");
    }
}
