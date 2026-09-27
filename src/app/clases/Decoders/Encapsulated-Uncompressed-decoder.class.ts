import { FrameBytes } from "../DCM/pixel-data-access";
import { BaseDecoder } from "./base-decoder-class";
import { UncompressedDecoder } from "./Uncompressed-decoder.class";

/**
 * 1.2.840.10008.1.2.1.98 Encapsulated Uncompressed Explicit VR Little Endian (PS3.5 A.4.11):
 * pixel data SIN comprimir pero encapsulado en items (un frame por fragmento), para poder acceder
 * a un frame sin leer el resto. Cada frame se trata igual que uno nativo.
 */
export class EncapsulatedUncompressedDecoder extends UncompressedDecoder {
    public override readonly encapsulated: boolean = true;

    public override decodeFrame(frame: FrameBytes): ArrayBuffer {
        return this.normalize(BaseDecoder.toBytes(frame.data)).buffer as ArrayBuffer;
    }
}
