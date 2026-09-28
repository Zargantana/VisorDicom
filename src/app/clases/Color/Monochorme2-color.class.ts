import { LUTInformation, PaletteColorLookupTableData, PhotometricInterpretationType } from "../DCM/DCM-interpreter.class";
import { BaseColor, ManualWindow, PixelSamples } from "./base-color.class";

/**
 * MONOCHROME1 / MONOCHROME2 (PS3.3 C.11, "grayscale pipeline"):
 *
 *   stored value --(BitsStored/signo)--> --(Modality LUT: slope/intercept)--> --(VOI: ventana | VOI LUT | auto min/max)-->
 *   --(Presentation: MONOCHROME1 o Presentation LUT Shape INVERSE se invierten)--> gris 0..255 en R=G=B
 *
 * Además: Pixel Padding (relleno en negro, fuera de la auto-ventana) y Supplemental Palette (valores en color).
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

        const padding = this.interpret.getPixelPaddingRange();
        const { lo, hi, min, max } = this.frameRange(pixeldata, count, padding);

        const photometric = this.interpret.getPhotometricInterpretation();
        // MONOCHROME1 ya implica inversión; Presentation LUT Shape INVERSE solo se aplica a MONOCHROME2
        // (en DX, MONOCHROME1 lleva INVERSE por definición y no debe invertirse dos veces).
        const invert = photometric == PhotometricInterpretationType.MONOCHROME1 ||
            (photometric == PhotometricInterpretationType.MONOCHROME2 && this.interpret.getPresentationLUTShape() == 'INVERSE');
        const toGray = this.buildGrayFunction(min, max);
        const palette = this.supplementalPalette(photometric);

        /** Valor almacenado -> [r, g, b] */
        const colorOf = (v: number): [number, number, number] => {
            if (padding && v >= padding[0] && v <= padding[1]) {
                return [0, 0, 0];
            }
            if (palette && palette[0].contains(v)) { // Supplemental Palette: fuera del pipeline de grises
                return [palette[0].LookupForInputValue(v), palette[1].LookupForInputValue(v), palette[2].LookupForInputValue(v)];
            }
            let g = toGray(v);
            g = invert ? 255 - g : g;
            return [g, g, g];
        };

        const lutSize = hi - lo + 1;
        if (lutSize <= (1 << 20)) {
            const r = new Uint8ClampedArray(lutSize);
            const g = palette ? new Uint8ClampedArray(lutSize) : r;
            const b = palette ? new Uint8ClampedArray(lutSize) : r;
            for (let v = lo; v <= hi; v++) {
                const c = colorOf(v);
                r[v - lo] = c[0];
                if (palette) {
                    g[v - lo] = c[1];
                    b[v - lo] = c[2];
                }
            }
            for (let i = 0, j = 0; i < count; i++, j += 4) {
                const k = this.storedValue(pixeldata[i]) - lo;
                data[j] = r[k];
                data[j + 1] = g[k];
                data[j + 2] = b[k];
            }
        } else { // 32 bits con rango enorme: sin tabla
            for (let i = 0, j = 0; i < count; i++, j += 4) {
                const c = colorOf(this.storedValue(pixeldata[i]));
                data[j] = c[0];
                data[j + 1] = c[1];
                data[j + 2] = c[2];
            }
        }
    }

    /**
     * Rango de valores almacenados del frame: total (lo..hi, para indexar la tabla) y sin el relleno (min..max, para la
     * auto-ventana). Pixel Padding (0028,0120/0121) es el relleno fuera del campo de visión: se pinta negro y no cuenta
     * para la auto-ventana (si no, un CT con relleno a -2000/-3024 quedaría sin contraste).
     */
    private frameRange(pixeldata: PixelSamples, count: number, padding: [number, number] | null):
            { lo: number; hi: number; min: number; max: number } {
        let lo = Infinity, hi = -Infinity, min = Infinity, max = -Infinity;
        for (let i = 0; i < count; i++) {
            const v = this.storedValue(pixeldata[i]);
            if (v < lo) lo = v;
            if (v > hi) hi = v;
            if (padding && v >= padding[0] && v <= padding[1]) {
                continue;
            }
            if (v < min) min = v;
            if (v > max) max = v;
        }
        if (min === Infinity) { // todo es relleno
            min = lo;
            max = hi;
        }
        return { lo, hi, min, max };
    }

    /**
     * La ventana que se está aplicando a este frame, en unidades de modalidad: el punto de partida al ajustar el
     * contraste con el ratón. La manual; si no, la del fichero; con VOI LUT, su dominio de entrada; sin ninguna, la
     * auto-ventana (o el rango completo con 8 bits o menos).
     */
    public currentWindow(buffer: any): ManualWindow {
        if (this.manualWindow) {
            return { ...this.manualWindow };
        }
        if (this.windowCount > 0) {
            const i = this.selectedWindow;
            return { center: this.VOIwindow.WindowCenter[i], width: this.VOIwindow.WindowWidth[i] };
        }
        if (this.VOIwindow.LUT.entries > 0 && this.VOIwindow.LUT.LUTData.length) {
            const first = this.firstMappedValue();
            const n = this.VOIwindow.LUT.entries;
            return { center: first + (n - 1) / 2, width: n };
        }
        const bitsStored = this.reader.BitsStored || this.reader.BitsAllocated || 8;
        let minStored: number, maxStored: number;
        if (bitsStored <= 8) {
            const signed = !!this.reader.PixelRepresentation;
            minStored = signed ? -(1 << (bitsStored - 1)) : 0;
            maxStored = signed ? (1 << (bitsStored - 1)) - 1 : (1 << bitsStored) - 1;
        } else {
            const pixeldata = this.toSamples(typeof buffer === 'string' ? BaseColor.stringToBytes(buffer).buffer : buffer,
                this.reader.BitsAllocated || 16, !!this.reader.PixelRepresentation);
            const range = this.frameRange(pixeldata, pixeldata.length, this.interpret.getPixelPaddingRange());
            minStored = range.min;
            maxStored = range.max;
        }
        const a = this.applyRescale(minStored), b = this.applyRescale(maxStored);
        return { center: (a + b) / 2, width: Math.max(1, Math.abs(b - a)) };
    }

    /**
     * Supplemental Palette Color LUT (PS3.3 C.7.6.19): imagen MONOCHROME2 con Pixel Presentation (0008,9205)
     * COLOR o MIXED y LUTs de paleta. Los valores dentro de la LUT (desde el "primer valor mapeado") se pintan en
     * color; el resto sigue el pipeline de grises. Típico en mapas de flujo/perfusión superpuestos.
     */
    private supplementalPalette(photometric: PhotometricInterpretationType): PaletteColorLookupTableData[] | null {
        if (photometric != PhotometricInterpretationType.MONOCHROME2) {
            return null;
        }
        const presentation = this.interpret.getPixelPresentation();
        if (presentation != 'COLOR' && presentation != 'MIXED') {
            return null;
        }
        const tables = this.interpret.getPaletteColorLookupTables();
        return tables.length == 3 ? tables : null;
    }

    /** Devuelve la funcion "valor almacenado -> gris 0..255" segun lo que traiga el fichero. */
    private buildGrayFunction(minStored: number, maxStored: number): (stored: number) => number {
        if (this.manualWindow) { // ventana del usuario: manda sobre la del fichero, la VOI LUT y la auto-ventana
            const { center, width } = this.manualWindow;
            return (v) => BaseColor.linearWindow(this.applyRescale(v), center, width);
        }
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
            const first = this.firstMappedValue();
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

    /**
     * Primer valor mapeado de la VOI LUT (PS3.3 C.11.2.1.1): US o SS según la entrada de la LUT. Es con signo si esa
     * entrada puede ser negativa: la salida del rescale o, sin rescale, el píxel con Pixel Representation = 1. Entonces
     * 63488 es -2048 (OFFIS vlut_09/vlut_10); antes se tomaba sin signo y la imagen salía negra.
     */
    private firstMappedValue(): number {
        const bits = this.reader.BitsStored || this.reader.BitsAllocated || 16;
        const signedPixels = !!this.reader.PixelRepresentation;
        const lowest = signedPixels ? -(2 ** (bits - 1)) : 0;
        const highest = signedPixels ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
        const signedInput = Math.min(this.applyRescale(lowest), this.applyRescale(highest)) < 0;
        let first = this.VOIwindow.LUT.firstStoredPixelValueMapped;
        if (signedInput && first >= 0x8000) {
            first -= 0x10000;
        }
        return first;
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
