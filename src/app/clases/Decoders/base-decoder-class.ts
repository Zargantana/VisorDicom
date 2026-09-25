import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter } from "../DCM/DCM-interpreter.class";

/**
 * Un decoder convierte el Pixel Data de UN fichero en un array con un elemento por frame
 * (ArrayBuffer de bytes little endian o TypedArray de muestras), que luego pinta ColorFactory.
 *  - Transfer Syntax nativas     -> interpret.getFramesData()        (troceo por FrameSize)
 *  - Transfer Syntax encapsuladas -> interpret.getEncapsulatedFrames() (un bitstream por frame, sin BOT)
 */
export abstract class BaseDecoder {
    protected interpret: DCMInterpreter;

    /** true si la libreria ya entrega RGB (JPEG baseline hace YCbCr->RGB, JPEG 2000 invierte la MCT). */
    public outputIsRGB: boolean = false;

    constructor(protected reader: DCMFileReader) {
        this.interpret = new DCMInterpreter(reader);
    }

    public abstract Decode(): any[];

    /** string binario (1 char = 1 byte) -> Uint8Array */
    protected static toBytes(value: string): Uint8Array {
        const buffer = new Uint8Array(value.length);
        for (let j = 0; j < value.length; j++) {
            buffer[j] = value.charCodeAt(j);
        }
        return buffer;
    }
}
