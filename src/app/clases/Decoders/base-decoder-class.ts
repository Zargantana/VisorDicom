import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter } from "../DCM/DCM-interpreter.class";
import { FrameBytes, PixelDataAccess } from "../DCM/pixel-data-access";

/**
 * Un decoder convierte UN frame del Pixel Data en muestras (ArrayBuffer de bytes little endian o TypedArray), que luego
 * pinta ColorFactory. Los bytes del frame los da PixelDataAccess (en memoria o leídos del fichero por rangos):
 *  - Transfer Syntax nativas      (encapsulated = false) -> píxeles del frame (troceo por FrameSize)
 *  - Transfer Syntax encapsuladas (encapsulated = true)  -> un bitstream por frame (fragmentos unidos, sin BOT)
 */
export abstract class BaseDecoder {
    protected interpret: DCMInterpreter;

    /** true si la libreria ya entrega RGB (JPEG baseline hace YCbCr->RGB, JPEG 2000 invierte la MCT). */
    public outputIsRGB: boolean = false;

    /** Qué frames espera: bitstreams del Pixel Data encapsulado (true) o píxeles nativos (false). */
    public readonly encapsulated: boolean = true;

    constructor(protected reader: DCMFileReader) {
        this.interpret = new DCMInterpreter(reader);
    }

    /** Decodifica un frame. Puede lanzar CodecRequiredError si hace falta un códec bajo demanda aún no cargado. */
    public abstract decodeFrame(frame: FrameBytes, index: number): any;

    /**
     * Todos los frames de golpe, de forma síncrona (camino antiguo): solo con el fichero entero en memoria
     * (DCMFile con fullRead, descargados del portal). El visor usa ImageDCM, que pide frame a frame.
     */
    public Decode(): any[] {
        const access = PixelDataAccess.for(this.reader);
        const count = access.memoryFrameCount(this.encapsulated);
        const frames: any[] = [];
        for (let i = 0; i < count; i++) {
            const bytes = access.getFrameSync(i, this.encapsulated);
            if (!bytes) {
                throw new Error('Pixel Data no cargado en memoria: usa ImageDCM.prepare()');
            }
            frames.push(this.decodeFrame(bytes, i));
        }
        return frames;
    }

    /** string binario (1 char = 1 byte) -> Uint8Array; un Uint8Array se devuelve tal cual. */
    protected static toBytes(value: string | Uint8Array): Uint8Array {
        if (value instanceof Uint8Array) {
            return value;
        }
        const buffer = new Uint8Array(value.length);
        for (let j = 0; j < value.length; j++) {
            buffer[j] = value.charCodeAt(j);
        }
        return buffer;
    }
}
