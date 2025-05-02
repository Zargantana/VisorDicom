import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter, PhotometricInterpretationType } from "../DCM/DCM-interpreter.class";
import { Monochorme2Color } from "./Monochorme2-color.class";
import { PaletteColor } from "./palette-color.class";
import { RGBColor } from "./RGB.class";

export class ColorFactory {
    interpret: any;

    constructor(private reader: DCMFileReader) {
        this.interpret = new DCMInterpreter(this.reader);
    }
    
    public pixelDataTo32BitBuffer(data: Uint8ClampedArray, frame: any): void {
        switch (this.interpret.getPhotometricInterpretation()) {
          case PhotometricInterpretationType.PALETTE_COLOR: {
            let colorInterpret = new PaletteColor(this.reader);
            colorInterpret.pixelDataTo32BitBuffer(data, frame);
            break;
          }
          case PhotometricInterpretationType.MONOCHROME1:
          case PhotometricInterpretationType.MONOCHROME2: {
            let colorInterpret = new Monochorme2Color(this.reader);
            colorInterpret.pixelDataTo32BitBuffer(data, frame);
            break;
          }
          default: {
            let colorInterpret = new RGBColor(this.reader);
            colorInterpret.pixelDataTo32BitBuffer(data, frame);
          }
        } 
        //TODO: YBRs, el RGB de verdad, y mas bytes o menos.
    }
}