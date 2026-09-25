import { LUTInformation, PhotometricInterpretationType } from "../DCM/DCM-interpreter.class";
import { BaseColor, PixelSamples } from "./base-color.class";

/**
 * MONOCHROME1 / MONOCHROME2 (PS3.3 C.11, "grayscale pipeline"):
 *
 *   stored value --(BitsStored/signo)--> --(Modality LUT: slope/intercept)--> --(VOI: ventana | VOI LUT | auto min/max)-->
 *   --(Presentation: MONOCHROME1 se invierte)--> gris 0..255 en R=G=B
 *
 * Como el valor almacenado es entero y acotado, se precalcula una tabla valor->gris para el rango
 * [min, max] del frame y cada pixel es un simple acceso (antes se recalculaba todo por pixel).
 */
export class Monochorme2Color extends BaseColor {

    protected pixelDataBufferTo32BitBuffer(data: Uint8ClampedArray, buffer: any): void {
        const pixeldata: PixelSamples = this.toSamples(buffer, this.reader.BitsAllocated || 16, !!this.reader.PixelRepresentation);
        const count = Math.min(pixeldata.length, data.length >> 2);
        if (count == 0) {
            return;
        }

        // Rango de valores almacenados del frame
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < count; i++) {
            const v = this.storedValue(pixeldata[i]);
            if (v < min) min = v;
            if (v > max) max = v;
        }

        const invert = this.interpret.getPhotometricInterpretation() == PhotometricInterpretationType.MONOCHROME1;
        const toGray = this.buildGrayFunction(min, max);
        const lutSize = max - min + 1;

        if (lutSize <= (1 << 20)) {
            const lut = new Uint8ClampedArray(lutSize);
            for (let v = min; v <= max; v++) {
                const g = toGray(v);
                lut[v - min] = invert ? 255 - g : g;
            }
            for (let i = 0, j = 0; i < count; i++, j += 4) {
                const g = lut[this.storedValue(pixeldata[i]) - min];
                data[j] = g;
                data[j + 1] = g;
                data[j + 2] = g;
            }
        } else { // 32 bits con rango enorme: sin tabla
            for (let i = 0, j = 0; i < count; i++, j += 4) {
                let g = toGray(this.storedValue(pixeldata[i]));
                g = invert ? 255 - g : g;
                data[j] = g;
                data[j + 1] = g;
                data[j + 2] = g;
            }
        }
    }

    /** Devuelve la funcion "valor almacenado -> gris 0..255" segun lo que traiga el fichero. */
    private buildGrayFunction(minStored: number, maxStored: number): (stored: number) => number {
        const selected = this.selectedWindow;
        if (this.windowCount > 0) { // VOI por ventana (Window Center/Width)
            const func = this.VOIwindow.VOIfunction;
            return (v) => this.applyVOIWindow(this.applyRescale(v), selected, func);
        }
        if (this.VOIwindow.LUT.entries > 0 && this.VOIwindow.LUT.LUTData.length) { // VOI LUT (0028,3006)
            const lut = this.readVOILUT(this.VOIwindow.LUT);
            let lutMin = Infinity, lutMax = -Infinity;
            for (let i = 0; i < lut.length; i++) {
                if (lut[i] < lutMin) lutMin = lut[i];
                if (lut[i] > lutMax) lutMax = lut[i];
            }
            const range = Math.max(1, lutMax - lutMin);
            const first = this.VOIwindow.LUT.firstStoredPixelValueMapped;
            return (v) => {
                const m = Math.round(this.applyRescale(v));
                const index = Math.min(Math.max(m - first, 0), lut.length - 1);
                return ((lut[index] - lutMin) * 255) / range;
            };
        }
        // Sin ventana ni LUT:
        //  - <= 8 bits almacenados: rango completo (identidad 0..255), como US/XA en gris. Estable en cine.
        //  - > 8 bits: auto-ventana con el min/max del frame (antes se usaba 2^BitsAllocated y un MR de
        //    12 bits sin ventana salia practicamente negro).
        const bitsStored = this.reader.BitsStored || this.reader.BitsAllocated || 8;
        if (bitsStored <= 8) {
            const signed = !!this.reader.PixelRepresentation;
            minStored = signed ? -(1 << (bitsStored - 1)) : 0;
            maxStored = signed ? (1 << (bitsStored - 1)) - 1 : (1 << bitsStored) - 1;
        }
        const a = this.applyRescale(minStored), b = this.applyRescale(maxStored);
        const lo = Math.min(a, b), range = Math.max(Math.abs(b - a), 1e-9);
        return (v) => ((this.applyRescale(v) - lo) * 255) / range;
    }

    private readVOILUT(LUT: LUTInformation): Uint8Array | Uint16Array {
        const bytes = BaseColor.stringToBytes(LUT.LUTData);
        if (LUT.bitPerEntry > 8) {
            const words = new Uint16Array(bytes.length >> 1);
            const LE = this.reader.isLittleEndian;
            for (let i = 0; i < words.length; i++) {
                words[i] = LE ? (bytes[2 * i] | (bytes[2 * i + 1] << 8)) : ((bytes[2 * i] << 8) | bytes[2 * i + 1]);
            }
            return words;
        }
        return bytes;
    }
}
