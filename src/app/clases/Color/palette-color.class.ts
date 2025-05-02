import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter, PaletteColorLookupTables } from "../DCM/DCM-interpreter.class";
import { BaseColor } from "./base-color.class";

export class PaletteColor extends BaseColor {
    
    protected pixelDataStringTo32BitBuffer(data: Uint8ClampedArray, pixelData: string) {
        let RGBLookupColorTables = this.interpret.getPaletteColorLookupTables();
        for (let i = 0, j = 0; i < pixelData.length; i++, j++) {
            let red = pixelData.charCodeAt(i);
            let green = pixelData.charCodeAt(i);
            let blue = pixelData.charCodeAt(i);

            data[j++] = RGBLookupColorTables[PaletteColorLookupTables.RED].LookupForInputValue(red);
            data[j++] = RGBLookupColorTables[PaletteColorLookupTables.GREEN].LookupForInputValue(green);
            data[j++] = RGBLookupColorTables[PaletteColorLookupTables.BLUE].LookupForInputValue(blue);
        }
    }

    protected pixelDataBufferTo32BitBuffer(data: Uint8ClampedArray, buffer: any): void {}
}