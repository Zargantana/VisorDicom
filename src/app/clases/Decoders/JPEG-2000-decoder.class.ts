import { BaseDecoder } from "./base-decoder-class";

declare var JpxImage: any;

/**
 * JPEG 2000 (lossless / lossy) con src/libs/jpx.js (OHIF image-JPEG2000, derivado de pdf.js).
 * La libreria decodifica por tiles: se recomponen todos en la imagen completa (antes solo se usaba tiles[0]).
 */
export class JPEG2000Decoder extends BaseDecoder {
    public override outputIsRGB: boolean = true;

    public Decode(): any[] {
        return this.interpret.getEncapsulatedFrames().map(frame => {
            const decoder = new JpxImage();
            decoder.parse(BaseDecoder.toBytes(frame));
            return this.assembleTiles(decoder);
        });
    }

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
