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
        // jpx.js (pdf.js) se fia de la cabecera: con un SIZ corrupto reserva memoria segun Xsiz*Ysiz y tumba la
        // pestaña (fichero de pydicom-data con un delimitador de secuencia falso dentro del codestream). Antes de
        // dejarle el bitstream se comprueba que la cabecera es coherente con el dataset.
        const problem = this.codestreamProblem(bytes);
        if (problem) {
            throw new Error('JPEG 2000: ' + problem);
        }
        const decoder = new JpxImage();
        decoder.parse(bytes);
        return this.assembleTiles(decoder);
    }

    /**
     * Comprueba el marcador SIZ (ISO/IEC 15444-1 A.5.1) del codestream, crudo o envuelto en cajas JP2 (se busca
     * SOC+SIZ en los primeros 64 KB). Devuelve el motivo si no es un codestream JPEG 2000 coherente con Rows,
     * Columns y un numero razonable de componentes, tiles y bits; null si todo cuadra.
     */
    private codestreamProblem(bytes: Uint8Array): string | null {
        let soc = -1;
        for (let i = 0, end = Math.min(bytes.length, 65536) - 4; i <= end; i++) {
            if (bytes[i] == 0xFF && bytes[i + 1] == 0x4F && bytes[i + 2] == 0xFF && bytes[i + 3] == 0x51) {
                soc = i;
                break;
            }
        }
        if (soc < 0) {
            return 'no se encuentra el inicio del codestream (SOC + SIZ)';
        }
        const p = soc + 4;
        if (p + 38 > bytes.length) {
            return 'cabecera SIZ truncada';
        }
        const u16 = (o: number) => (bytes[o] << 8) | bytes[o + 1];
        const u32 = (o: number) => bytes[o] * 16777216 + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3];
        const lsiz = u16(p), csiz = u16(p + 36);
        const xsiz = u32(p + 4), ysiz = u32(p + 8), xosiz = u32(p + 12), yosiz = u32(p + 16);
        const xtsiz = u32(p + 20), ytsiz = u32(p + 24), xtosiz = u32(p + 28), ytosiz = u32(p + 32);
        if (csiz < 1 || csiz > 4 || lsiz != 38 + 3 * csiz || p + lsiz > bytes.length + 2) {
            return `cabecera SIZ inválida (Csiz = ${csiz}, Lsiz = ${lsiz})`;
        }
        const width = xsiz - xosiz, height = ysiz - yosiz;
        if (width != this.reader.Columns || height != this.reader.Rows) {
            return `el codestream mide ${width}×${height} y el dataset dice ${this.reader.Columns}×${this.reader.Rows}`;
        }
        if (xtsiz == 0 || ytsiz == 0 || xtosiz > xosiz || ytosiz > yosiz || xtosiz + xtsiz <= xosiz || ytosiz + ytsiz <= yosiz) {
            return 'tiles inválidos en la cabecera SIZ';
        }
        if (Math.ceil((xsiz - xtosiz) / xtsiz) * Math.ceil((ysiz - ytosiz) / ytsiz) > 65535) {
            return 'demasiados tiles en la cabecera SIZ';
        }
        for (let c = 0; c < csiz; c++) {
            const ssiz = bytes[p + 38 + 3 * c], xrsiz = bytes[p + 39 + 3 * c], yrsiz = bytes[p + 40 + 3 * c];
            if ((ssiz & 0x7F) + 1 > 16 || xrsiz == 0 || yrsiz == 0) {
                return `componente ${c} inválido en la cabecera SIZ`;
            }
        }
        return null;
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
