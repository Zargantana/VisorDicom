import { BaseDecoder } from "./base-decoder-class";

/**
 * Transfer Syntax nativas: Implicit VR LE, Explicit VR LE, Explicit VR BE (retirada), Deflated Explicit VR LE
 * (ya inflado por DCMFile.inflateIfDeflated), Papyrus 3 y las privadas nativas de GE y Philips.
 * Devuelve un ArrayBuffer little endian, entrelazado, por frame.
 */
export class UncompressedDecoder extends BaseDecoder {
    public Decode(): any[] {
        // Nativo: getFramesData ya trocea por FrameSize; TODOS los frames son imagen (no hay BOT que saltar).
        return this.interpret.getFramesData().map(frame => this.normalize(BaseDecoder.toBytes(frame)).buffer);
    }

    /** Deja el frame como lo esperan las clases de color: little endian, 1 muestra por byte si 1 bit, RGB entrelazado. */
    protected normalize(bytes: Uint8Array): Uint8Array {
        const bitsAllocated = this.reader.BitsAllocated;
        // Explicit VR Big Endian y privada de GE (1.2.840.113619.5.2): palabras de 16/32 bits en orden inverso.
        if (!this.reader.isPixelDataLittleEndian && bitsAllocated > 8) {
            const size = bitsAllocated > 16 ? 4 : 2;
            for (let i = 0; i + size <= bytes.length; i += size) {
                for (let a = i, b = i + size - 1; a < b; a++, b--) {
                    const t = bytes[a]; bytes[a] = bytes[b]; bytes[b] = t;
                }
            }
        }
        // 1 bit por pixel (PS3.5 8.1.1: el primer pixel en el bit menos significativo).
        if (bitsAllocated == 1) {
            const pixels = this.reader.Rows * this.reader.Columns * (this.reader.SamplesPerPixel || 1);
            const unpacked = new Uint8Array(pixels);
            for (let p = 0; p < pixels; p++) {
                unpacked[p] = (bytes[p >> 3] >> (p & 7)) & 1;
            }
            return unpacked;
        }
        // Planar Configuration 1 (RRR..GGG..BBB, o 4 planos en ARGB/CMYK) -> entrelazado (RGBRGB..).
        const spp = this.reader.SamplesPerPixel;
        if (spp > 1 && this.reader.PlannarConfiguration == 1) {
            const bytesPerSample = Math.max(1, bitsAllocated >> 3);
            const plane = this.reader.Rows * this.reader.Columns * bytesPerSample;
            const interleaved = new Uint8Array(plane * spp);
            for (let p = 0, o = 0; p < plane; p += bytesPerSample) {
                for (let s = 0; s < spp; s++) {
                    for (let b = 0; b < bytesPerSample; b++) {
                        interleaved[o++] = bytes[s * plane + p + b];
                    }
                }
            }
            return interleaved;
        }
        return bytes;
    }
}
