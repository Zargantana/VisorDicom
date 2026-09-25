import { PaletteColorLookupTables } from "../DCM/DCM-interpreter.class";
import { BaseColor } from "./base-color.class";

/**
 * PALETTE COLOR (PS3.3 C.7.6.3.1.5-6): cada pixel es un indice (8 o 16 bits) a tres LUT
 * Red/Green/Blue (0028,1201-1203) descritas por (0028,1101-1103) [entradas, primer valor, bits].
 * No soporta todavia las "Segmented Palette" (0028,1221-1223).
 */
export class PaletteColor extends BaseColor {

    protected pixelDataBufferTo32BitBuffer(data: Uint8ClampedArray, buffer: any): void {
        const tables = this.interpret.getPaletteColorLookupTables();
        if (tables.length < 3) {
            return;
        }
        const indexes = this.toSamples(buffer, this.reader.BitsAllocated || 8, false);
        const count = Math.min(indexes.length, data.length >> 2);
        for (let i = 0, j = 0; i < count; i++, j += 4) {
            const index = this.storedValue(indexes[i]);
            data[j] = tables[PaletteColorLookupTables.RED].LookupForInputValue(index);
            data[j + 1] = tables[PaletteColorLookupTables.GREEN].LookupForInputValue(index);
            data[j + 2] = tables[PaletteColorLookupTables.BLUE].LookupForInputValue(index);
        }
    }
}
