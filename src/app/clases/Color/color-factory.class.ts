import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter, PhotometricInterpretationType } from "../DCM/DCM-interpreter.class";
import { ManualWindow } from "./base-color.class";
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
     * @param frameIndex      indice del frame (multiframe mejorado: ventana y rescale propios del frame).
     * @param manualWindow    ventana del usuario (ratón o preset); solo en monocromo.
     */
    public pixelDataTo32BitBuffer(data: Uint8ClampedArray, frame: any, windowIndex: number = 0, colorAlreadyRGB: boolean = false, frameIndex?: number,
                                  manualWindow: ManualWindow | null = null): void {
        switch (this.interpret.getPhotometricInterpretation()) {
          case PhotometricInterpretationType.PALETTE_COLOR: {
            new PaletteColor(this.reader, windowIndex, frameIndex).pixelDataTo32BitBuffer(data, frame);
            break;
          }
          case PhotometricInterpretationType.MONOCHROME1:
          case PhotometricInterpretationType.MONOCHROME2: {
            const gray = new Monochorme2Color(this.reader, windowIndex, frameIndex);
            gray.manualWindow = manualWindow;
            gray.pixelDataTo32BitBuffer(data, frame);
            break;
          }
          default: {
            new RGBColor(this.reader, windowIndex, colorAlreadyRGB, frameIndex).pixelDataTo32BitBuffer(data, frame);
          }
        }
    }

    /** true si la imagen es monocromo: la única en la que tiene sentido ajustar la ventana (contraste y brillo). */
    public get grayscale(): boolean {
        const pi = this.interpret.getPhotometricInterpretation();
        return pi == PhotometricInterpretationType.MONOCHROME1 || pi == PhotometricInterpretationType.MONOCHROME2;
    }

    /** Ventana aplicada a un frame monocromo (ver Monochorme2Color.currentWindow); null si no es monocromo. */
    public currentWindow(frame: any, windowIndex: number = 0, frameIndex?: number, manualWindow: ManualWindow | null = null): ManualWindow | null {
        if (!this.grayscale) {
            return null;
        }
        const gray = new Monochorme2Color(this.reader, windowIndex, frameIndex);
        gray.manualWindow = manualWindow;
        return gray.currentWindow(frame);
    }
}
