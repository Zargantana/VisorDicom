import { BaseDecoder } from "./base-decoder-class";

/**
 * RLE Lossless (1.2.840.10008.1.2.5, PS3.5 Annex G).
 * Cada frame: cabecera de 64 bytes (UL little endian: numero de segmentos + 15 offsets) y hasta 15 segmentos
 * PackBits. Hay un segmento por (muestra, byte), con el byte MAS significativo primero:
 *   8 bits mono -> 1 segmento; 16 bits mono -> 2 (MSB, LSB); RGB 8 bits -> 3 (R, G, B).
 * Se reentrelaza a pixeles little endian R G B R G B... (lo que esperan las clases de color).
 */
export class RLEDecoder extends BaseDecoder {

    public Decode(): ArrayBuffer[] {
        return this.interpret.getEncapsulatedFrames().map(frame => this.decodeFrame(BaseDecoder.toBytes(frame)));
    }

    private read32(data: Uint8Array, at: number): number {
        return (data[at] | (data[at + 1] << 8) | (data[at + 2] << 16) | (data[at + 3] << 24)) >>> 0;
    }

    private decodeFrame(data: Uint8Array): ArrayBuffer {
        const bytesAllocated = Math.max(1, this.reader.BitsAllocated >> 3);
        const samples = this.reader.SamplesPerPixel || 1;
        const pixelCount = this.reader.Rows * this.reader.Columns;
        const stride = samples * bytesAllocated;
        const out = new Uint8Array(pixelCount * stride);

        const numberOfSegments = Math.min(this.read32(data, 0), 15);
        for (let s = 0; s < numberOfSegments; s++) {
            const start = this.read32(data, 4 * (s + 1));
            const end = (s + 1 < numberOfSegments) ? this.read32(data, 4 * (s + 2)) : data.length;
            const sample = Math.trunc(s / bytesAllocated);
            const byteIndex = s % bytesAllocated;                  // 0 = MSB
            const first = sample * bytesAllocated + (bytesAllocated - 1 - byteIndex); // posicion little endian
            this.unpackBits(data, start, end, out, first, stride, pixelCount);
        }
        return out.buffer;
    }

    private unpackBits(data: Uint8Array, start: number, end: number, out: Uint8Array, first: number, stride: number, count: number) {
        let i = start;
        let written = 0;
        let pos = first;
        while (i < end && written < count) {
            const n = data[i++];
            if (n < 128) {              // literal: n + 1 bytes
                for (let k = 0; k <= n && i < end && written < count; k++, written++, pos += stride) {
                    out[pos] = data[i++];
                }
            } else if (n > 128) {       // repeticion: 257 - n veces el siguiente byte
                const value = data[i++];
                for (let k = 0; k < 257 - n && written < count; k++, written++, pos += stride) {
                    out[pos] = value;
                }
            }                            // n == 128: no-op
        }
    }
}
