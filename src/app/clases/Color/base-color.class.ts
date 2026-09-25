import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter, RescaleParameters, VOIData, VOIFunction } from "../DCM/DCM-interpreter.class";

export type PixelSamples = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array;

/**
 * Base de las conversiones "pixel data decodificado -> RGBA de 8 bits" (buffer de un ImageData de canvas).
 *
 * El pixel data puede llegar en varias formas segun el decoder:
 *  - string binario (1 char = 1 byte)             -> datos nativos antiguos / test-screen
 *  - ArrayBuffer (bytes en little endian)         -> UncompressedDecoder, RLEDecoder, JPEG-Lossless
 *  - TypedArray de muestras (Uint8/Uint16/Int16..) -> JPEG baseline, JPEG-LS, JPEG 2000
 * toSamples() lo normaliza a un TypedArray de muestras segun BitsAllocated y PixelRepresentation.
 */
export abstract class BaseColor {
    protected bytesPerPixel: number;
    protected interpret: DCMInterpreter;
    protected VOIwindow: VOIData;
    protected RescaleParams: RescaleParameters;

    /**
     * @param windowIndex ventana VOI a aplicar (0028,1050/1051 son multivalor). Por defecto la primera.
     */
    constructor(protected reader: DCMFileReader, protected windowIndex: number = 0) {
        this.bytesPerPixel = reader.BitsAllocated / 8;
        this.interpret = new DCMInterpreter(reader);
        this.RescaleParams = this.interpret.getRescaleParameters();
        this.VOIwindow = this.interpret.getVOIData();
    }

    /** Numero de ventanas VOI utilizables (pares Center/Width). */
    public get windowCount(): number {
        return Math.min(this.VOIwindow.WindowCenter.length, this.VOIwindow.WindowWidth.length);
    }

    /** Ventana efectiva: la pedida, acotada a las que existen. */
    protected get selectedWindow(): number {
        const count = this.windowCount;
        if (count == 0) {
            return 0;
        }
        return Math.min(Math.max(0, Math.trunc(this.windowIndex || 0)), count - 1);
    }

    public pixelDataTo32BitBuffer(data: Uint8ClampedArray, pixelData: any) {
        if ((pixelData instanceof ArrayBuffer) || ArrayBuffer.isView(pixelData)) {
            this.pixelDataBufferTo32BitBuffer(data, pixelData);
        } else {
            this.pixelDataStringTo32BitBuffer(data, pixelData);
        }
    }

    protected pixelDataStringTo32BitBuffer(data: Uint8ClampedArray, pixelData: string): void {
        this.pixelDataBufferTo32BitBuffer(data, BaseColor.stringToBytes(pixelData).buffer);
    }

    protected abstract pixelDataBufferTo32BitBuffer(data: Uint8ClampedArray, buffer: any): void;

    public static stringToBytes(value: string): Uint8Array {
        const bytes = new Uint8Array(value.length);
        for (let i = 0; i < value.length; i++) {
            bytes[i] = value.charCodeAt(i);
        }
        return bytes;
    }

    /**
     * Normaliza cualquier forma de pixel data a un TypedArray de muestras de BitsAllocated bits.
     *  - ArrayBuffer / Uint8Array con muestras > 8 bits: son BYTES little endian -> se reinterpretan.
     *  - TypedArray con el mismo tamano de elemento: conversion elemento a elemento (Uint16 -> Int16 reinterpreta el signo).
     */
    protected toSamples(pixelData: ArrayBuffer | ArrayBufferView, bitsAllocated: number, signed: boolean): PixelSamples {
        const bytesPerSample = bitsAllocated > 16 ? 4 : (bitsAllocated > 8 ? 2 : 1);
        const ctor: any = bytesPerSample == 4 ? (signed ? Int32Array : Uint32Array)
            : bytesPerSample == 2 ? (signed ? Int16Array : Uint16Array)
            : (signed ? Int8Array : Uint8Array);
        if (pixelData instanceof ArrayBuffer) {
            const usable = pixelData.byteLength - (pixelData.byteLength % bytesPerSample);
            return new ctor(pixelData, 0, usable / bytesPerSample);
        }
        const view = pixelData as any;
        if (view.BYTES_PER_ELEMENT == 1 && bytesPerSample > 1) {
            const bytes: Uint8Array = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
            const usable = bytes.byteLength - (bytes.byteLength % bytesPerSample);
            return new ctor(bytes.buffer, 0, usable / bytesPerSample);
        }
        return new ctor(view);
    }

    /**
     * Enmascara a BitsStored y extiende el signo (p.ej. 12 bits con signo dentro de 16).
     * Idempotente si el decoder ya entrego los valores con el signo extendido.
     */
    protected storedValue(value: number): number {
        const bitsStored = this.reader.BitsStored;
        if (!bitsStored || bitsStored >= this.reader.BitsAllocated || bitsStored >= 32) {
            return value;
        }
        const mask = (1 << bitsStored) - 1;
        let v = value & mask;
        if (this.reader.PixelRepresentation && (v & (1 << (bitsStored - 1)))) {
            v -= (1 << bitsStored);
        }
        return v;
    }

    /** Modality LUT lineal (PS3.3 C.11.1): valor de modalidad = stored * slope + intercept (p.ej. HU en CT). */
    protected applyRescale(pixel: number): number {
        return (pixel * this.RescaleParams.Slope) + this.RescaleParams.Intercept;
    }

    /**
     * VOI LUT por ventana (PS3.3 C.11.2.1.2): devuelve 0..255.
     *  LINEAR       : y = ((x - (c - 0.5)) / (w - 1) + 0.5)          con recorte en c - 0.5 -/+ (w - 1)/2
     *  LINEAR_EXACT : y = (x - c) / w + 0.5                          con recorte
     *  SIGMOID      : y = 1 / (1 + exp(-4 (x - c) / w))
     */
    protected applyVOIWindow(pixel: number, selected: number, VOIfunc: VOIFunction): number {
        const c = this.VOIwindow.WindowCenter[selected];
        const w = this.VOIwindow.WindowWidth[selected];
        let y: number;
        if (VOIfunc == VOIFunction.SIGMOID) {
            y = 1 / (1 + Math.exp(-4 * (pixel - c) / (w || 1)));
        } else if (VOIfunc == VOIFunction.LINEAR_EXACT) {
            y = (pixel - c) / (w || 1) + 0.5;
        } else {
            if (w <= 1) {
                return pixel < c - 0.5 ? 0 : 255;
            }
            y = (pixel - (c - 0.5)) / (w - 1) + 0.5;
        }
        return y <= 0 ? 0 : (y >= 1 ? 255 : y * 255);
    }
}
