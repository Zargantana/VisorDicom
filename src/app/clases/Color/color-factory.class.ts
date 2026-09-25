import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter, PhotometricInterpretationType } from "../DCM/DCM-interpreter.class";
import { Monochorme2Color } from "./Monochorme2-color.class";
import { PaletteColor } from "./palette-color.class";
import { RGBColor } from "./RGB.class";

/**
 * Elige la conversion a RGBA segun Photometric Interpretation (0028,0004):
 *   PALETTE COLOR             -> PaletteColor
 *   MONOCHROME1 / MONOCHROME2 -> Monochorme2Color (MONOCHROME1 se invierte tras la VOI)
 *   resto (RGB, YBR_*...)     -> RGBColor
 */
export class ColorFactory {
    interpret: DCMInterpreter;

    constructor(private reader: DCMFileReader) {
        this.interpret = new DCMInterpreter(this.reader);
    }
    
    /**
     * @param windowIndex     ventana VOI (Window Center/Width) a usar en imagenes monocromo. 0 = la primera.
     * @param colorAlreadyRGB el decoder ya entrega RGB (JPEG baseline / JPEG 2000): no convertir YBR otra vez.
     */
    public pixelDataTo32BitBuffer(data: Uint8ClampedArray, frame: any, windowIndex: number = 0, colorAlreadyRGB: boolean = false): void {
        switch (this.interpret.getPhotometricInterpretation()) {
          case PhotometricInterpretationType.PALETTE_COLOR: {
            new PaletteColor(this.reader, windowIndex).pixelDataTo32BitBuffer(data, frame);
            break;
          }
          case PhotometricInterpretationType.MONOCHROME1:
          case PhotometricInterpretationType.MONOCHROME2: {
            new Monochorme2Color(this.reader, windowIndex).pixelDataTo32BitBuffer(data, frame);
            break;
          }
          default: {
            new RGBColor(this.reader, windowIndex, colorAlreadyRGB).pixelDataTo32BitBuffer(data, frame);
          }
        } 
    }
}
