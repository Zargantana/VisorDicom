import { ElementRef } from "@angular/core";
import { TRANSFER_SYNTAX, TX_Map } from "src/app/dictionaries/transfer-syntaxes";
import { ColorFactory } from "../Color/color-factory.class";
import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter } from "../DCM/DCM-interpreter.class";
import { BaseDecoder } from "../Decoders/base-decoder-class";
import { EncapsulatedUncompressedDecoder } from "../Decoders/Encapsulated-Uncompressed-decoder.class";
import { JPEG2000Decoder } from "../Decoders/JPEG-2000-decoder.class";
import { JPEGBaselineDecoder, JPEGRetiredProcessesDecoder } from "../Decoders/JPEG-Baseline-decoder.class";
import { CodecLoader, CodecRequiredError } from "../Decoders/codec-loader";
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
    private decodeFailed: boolean = false;
    private preparing: Promise<void> | null = null;
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
            // Procesos JPEG retirados (aritmetico, progresivo, lossless aritmetico): libjpeg-turbo bajo demanda
            case TRANSFER_SYNTAX.JPEG_Extended_Processes_3_5:
            case TRANSFER_SYNTAX.JPEG_Spectral_Selection_Nonhierarchical_Processes_6_8:
            case TRANSFER_SYNTAX.JPEG_Spectral_Selection_Nonhierarchical_Processes_7_9:
            case TRANSFER_SYNTAX.JPEG_Full_Progression_Nonhierarchical_Processes_10_12:
            case TRANSFER_SYNTAX.JPEG_Full_Progression_Nonhierarchical_Processes_11_13:
            case TRANSFER_SYNTAX.JPEG_Lossless_Nonhierarchical_Processes_15:
                return new JPEGRetiredProcessesDecoder(this.reader);
            case TRANSFER_SYNTAX.JPEG_Lossless_Nonhierarchical_First_Order_Prediction_Processes_14_Selection_Value_1:
            case TRANSFER_SYNTAX.JPEG_Lossless_Nonhierarchical_Processes_14:
                return new JPEGLosslessDecoder(this.reader);
            case TRANSFER_SYNTAX.JPEG_2000_Image_Compression_Lossless_Only:
            case TRANSFER_SYNTAX.JPEG_2000_Image_Compression:
            case TRANSFER_SYNTAX.JPEG_2000_Part_2_Multicomponent_Image_Compression_Lossless_Only:
            case TRANSFER_SYNTAX.JPEG_2000_Part_2_Multicomponent_Image_Compression:
                return new JPEG2000Decoder(this.reader);
            case TRANSFER_SYNTAX.HTJ2K_Lossless_Only:
            case TRANSFER_SYNTAX.HTJ2K_RPCL_Lossless_Only:
            case TRANSFER_SYNTAX.HTJ2K:
                return new JPEG2000Decoder(this.reader, true);
            case TRANSFER_SYNTAX.JPEG_LS_Lossless_Image_Compression:
            case TRANSFER_SYNTAX.JPEG_LS_Lossy_Near_Lossless_Image_Compression:
                return new JPEGLSDecoder(this.reader);
        }
        console.warn('Transfer Syntax sin decoder: ' + this.reader.TransferSyntax + ' (' + this.reader.TransferSyntaxName + ')');
        return null;
    }

    /** Decodifica todos los frames. Puede lanzar CodecRequiredError si hace falta un códec aún no cargado. */
    private preloadImageFrames() {
        if (this.decodeFailed) {
            return;
        }
        const deco = this.createDecoder();
        if (deco) {
            this.rawFrames = deco.Decode();
            this.decoderOutputIsRGB = deco.outputIsRGB;
        }
    }

    /**
     * Deja la imagen decodificada, cargando antes (asíncrono) los códecs bajo demanda que pida el decoder
     * (OpenJPEG para JPEG 2000/HTJ2K, libjpeg-turbo para procesos JPEG retirados). Devuelve false si no se puede.
     */
    public async prepare(): Promise<boolean> {
        for (let attempt = 0; attempt < 3 && !this.rawFrames && !this.decodeFailed; attempt++) {
            try {
                this.preloadImageFrames();
                if (!this.rawFrames) {
                    break; // TS sin decoder
                }
            } catch (error) {
                if (error instanceof CodecRequiredError && !CodecLoader.isUnavailable(error.codec)) {
                    try {
                        await CodecLoader.load(error.codec);
                        continue;
                    } catch {
                        // el decoder usará su alternativa (si la tiene) en el siguiente intento
                        continue;
                    }
                }
                this.decodeFailed = true;
                console.warn('No se pudo decodificar ' + (this.reader.SOPInstanceUID || 'la imagen') +
                    ' (' + this.reader.TransferSyntaxName + '): ' + ((error as any)?.message ?? error));
            }
        }
        return !!this.rawFrames && this.rawFrames.length > 0;
    }

    /** RGBA (Rows x Columns x 4) del frame indicado con la ventana seleccionada. null si no se puede decodificar (aún). */
    public renderFrameRGBA(frameIndex: number = this.currentFrame): Uint8ClampedArray | null {
        if (!this.rawFrames) {
            try {
                this.preloadImageFrames();
            } catch (error) {
                if (!(error instanceof CodecRequiredError)) {
                    this.decodeFailed = true;
                    console.warn('No se pudo decodificar ' + (this.reader.SOPInstanceUID || 'la imagen') +
                        ' (' + this.reader.TransferSyntaxName + '): ' + ((error as any)?.message ?? error));
                }
                return null;
            }
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
        } else if (!this.rawFrames && !this.decodeFailed && !this.preparing) {
            // Falta un códec bajo demanda: se carga y se repinta cuando esté (los visores no cambian).
            this.preparing = this.prepare().then((ok) => {
                this.preparing = null;
                if (ok) {
                    this.paintImage(imageDisplay);
                }
            });
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
