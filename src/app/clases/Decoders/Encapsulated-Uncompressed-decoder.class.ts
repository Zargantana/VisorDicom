import { BaseDecoder } from "./base-decoder-class";
import { UncompressedDecoder } from "./Uncompressed-decoder.class";

/**
 * 1.2.840.10008.1.2.1.98 Encapsulated Uncompressed Explicit VR Little Endian (PS3.5 A.4.11):
 * pixel data SIN comprimir pero encapsulado en items (un frame por fragmento), para poder acceder
 * a un frame sin leer el resto. Cada frame se trata igual que uno nativo.
 */
export class EncapsulatedUncompressedDecoder extends UncompressedDecoder {
    public override Decode(): any[] {
        return this.interpret.getEncapsulatedFrames().map(frame => this.normalize(BaseDecoder.toBytes(frame)).buffer);
    }
}
