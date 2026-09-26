import { BaseDecoder } from "./base-decoder-class";
import { CodecLoader, CodecRequiredError } from "./codec-loader";
import { decodeWithEmscripten } from "./emscripten-codecs";

declare var JpxImage: any;

/**
 * Familia JPEG 2000:
 *   1.2.840.10008.1.2.4.90 / .91   JPEG 2000 Part 1 (lossless / lossy)
 *   1.2.840.10008.1.2.4.92 / .93   JPEG 2000 Part 2 multi-component (MCT por matriz)
 *   1.2.840.10008.1.2.4.201-.203   HTJ2K (High-Throughput JPEG 2000, ISO/IEC 15444-15)
 *
 * Decodificador principal: OpenJPEG 2.5 (asm.js, src/assets/codecs, carga bajo demanda). Soporta Part 1, la MCT de
 * Part 2 y HTJ2K, e invierte la transformacion de color (YBR_ICT/YBR_RCT -> RGB).
 * Alternativa para Part 1/2 si OpenJPEG no esta disponible o falla: src/libs/jpx.js (pdf.js, solo Part 1).
 *
 * Limitacion conocida: la MCT por matriz de Part 2 (marcadores MCT/MCC/MCO, Rsiz = PART2 | EXT_MCT) NO la
 * decodifica OpenJPEG (ni 2.5.0 ni 2.5.4: "Invalid multiple component transformation") ni jpx.js. Esos
 * codestreams se rechazan con un aviso en vez de pintar colores falsos. Los Part 2 sin esa MCT si se ven.
 */
export class JPEG2000Decoder extends BaseDecoder {
    public override outputIsRGB: boolean = true;

    /** @param htj2k true para las TS HTJ2K: sin alternativa (jpx.js no entiende los bloques HT). */
    constructor(reader: any, private htj2k: boolean = false) {
        super(reader);
    }

    public Decode(): any[] {
        const frames = this.interpret.getEncapsulatedFrames();
        const useJpx = !this.htj2k && CodecLoader.isUnavailable('openjpeg');
        return frames.map(frame => {
            const bytes = BaseDecoder.toBytes(frame);
            if (JPEG2000Decoder.usesPart2ArrayMCT(bytes)) {
                throw new Error('JPEG 2000 Part 2 con transformación multicomponente por matriz (MCT): no soportado');
            }
            if (useJpx) {
                return this.decodeWithJpx(bytes);
            }
            try {
                return decodeWithEmscripten('openjpeg', 'J2KDecoder', bytes).data;
            } catch (error) {
                if (error instanceof CodecRequiredError || this.htj2k) {
                    throw error;
                }
                console.warn('OpenJPEG no pudo decodificar el frame; se intenta con jpx.js', error);
                return this.decodeWithJpx(bytes);
            }
        });
    }

    /** SOC (FF4F) + SIZ (FF51): Rsiz con el bit de Part 2 (0x8000) y la extension MCT (0x0100). */
    public static usesPart2ArrayMCT(bytes: Uint8Array): boolean {
        if (bytes.length < 8 || bytes[0] != 0xFF || bytes[1] != 0x4F || bytes[2] != 0xFF || bytes[3] != 0x51) {
            return false;
        }
        const rsiz = (bytes[6] << 8) | bytes[7];
        return (rsiz & 0x8000) != 0 && (rsiz & 0x0100) != 0;
    }

    private decodeWithJpx(bytes: Uint8Array): any {
        const decoder = new JpxImage();
        decoder.parse(bytes);
        return this.assembleTiles(decoder);
    }

    /** jpx.js decodifica por tiles: se recomponen en la imagen completa. */
    private assembleTiles(decoder: any): any {
        const tiles: any[] = decoder.tiles ?? [];
        if (tiles.length <= 1) {
            return tiles[0]?.items;
        }
        const components = decoder.componentsCount || 1;
        const width = decoder.width, height = decoder.height;
        const left0 = Math.min(...tiles.map(t => t.left)), top0 = Math.min(...tiles.map(t => t.top));
        const out = new (tiles[0].items.constructor)(width * height * components);
        for (const tile of tiles) {
            for (let y = 0; y < tile.height; y++) {
                const src = y * tile.width * components;
                const dst = ((tile.top - top0 + y) * width + (tile.left - left0)) * components;
                out.set(tile.items.subarray(src, src + tile.width * components), dst);
            }
        }
        return out;
    }
}
