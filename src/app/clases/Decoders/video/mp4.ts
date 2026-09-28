import { AccessUnit, AnnexB, VideoFamily, VideoStreamInfo } from "./annexb";

interface Box {
    type: string;
    start: number;
    end: number;
    /** Donde empieza el contenido (tras el tamaño y el tipo, y el tamaño de 64 bits si lo hay). */
    body: number;
}

/**
 * Vídeo en un contenedor MP4 (ISO/IEC 14496-12 y 14496-15) dentro del Pixel Data. Las Transfer Syntaxes de vídeo
 * esperan el flujo elemental (Annex B, `AnnexB`), pero hay equipos que guardan el .mp4 entero (a veces sin Number of
 * Frames ni Frame Time en la cabecera). Se leen las tablas de muestras de la primera pista de vídeo
 * (moov/trak/mdia/minf/stbl): cada muestra es un frame, en orden de decodificación, con sus NAL precedidos de su
 * longitud; la configuración (avcC o hvcC) va a WebCodecs como `description`. `moov` puede ir antes o después de
 * `mdat`. No lee MP4 fragmentados (moof), que dejan vacías las tablas de `moov`. Sin DOM: se prueba en Node.
 */
export class Mp4 {

    /** Empieza por una caja `ftyp`. */
    public static is(data: Uint8Array): boolean {
        return data.length >= 12 && Mp4.fourcc(data, 4) == 'ftyp';
    }

    public static parse(data: Uint8Array, family: VideoFamily): VideoStreamInfo {
        const empty: VideoStreamInfo = { family, codec: '', units: [] };
        const moov = Mp4.children(data, 0, data.length).find(b => b.type == 'moov');
        if (!moov) {
            return empty;
        }
        for (const trak of Mp4.children(data, moov.body, moov.end).filter(b => b.type == 'trak')) {
            const mdia = Mp4.child(data, trak, 'mdia');
            const hdlr = mdia && Mp4.child(data, mdia, 'hdlr');
            const minf = mdia && Mp4.child(data, mdia, 'minf');
            const stbl = minf && Mp4.child(data, minf, 'stbl');
            // hdlr: versión y flags, pre_defined y handler_type
            if (mdia && hdlr && stbl && Mp4.fourcc(data, hdlr.body + 8) == 'vide') {
                return Mp4.track(data, family, mdia, stbl) ?? empty;
            }
        }
        return empty;
    }

    private static track(data: Uint8Array, family: VideoFamily, mdia: Box, stbl: Box): VideoStreamInfo | null {
        const stsd = Mp4.child(data, stbl, 'stsd');
        const stsz = Mp4.child(data, stbl, 'stsz') ?? Mp4.child(data, stbl, 'stz2');
        const stsc = Mp4.child(data, stbl, 'stsc');
        const stco = Mp4.child(data, stbl, 'stco') ?? Mp4.child(data, stbl, 'co64');
        if (!stsd || !stsz || !stsc || !stco) {
            return null;
        }
        // stsd: versión y flags, número de entradas y la primera (VisualSampleEntry: 78 bytes antes de sus cajas)
        const entry = Mp4.children(data, stsd.body + 8, stsd.end)[0];
        if (!entry) {
            return null;
        }
        const config = Mp4.children(data, entry.body + 78, entry.end).find(b => b.type == 'avcC' || b.type == 'hvcC');
        if (!config) {
            return null;
        }
        const description = data.slice(config.body, config.end);
        const codec = config.type == 'avcC'
            // avc1.PPCCLL: AVCProfileIndication, profile_compatibility y AVCLevelIndication
            ? entry.type + '.' + [1, 2, 3].map(k => (description[k] ?? 0).toString(16).padStart(2, '0')).join('').toUpperCase()
            : AnnexB.hevcCodecString(entry.type, description.subarray(1, 13));

        const sizes = Mp4.sampleSizes(data, stsz);
        const offsets = Mp4.table(data, stco, stco.type == 'co64' ? 8 : 4);
        const chunks = Mp4.stsc(data, stsc);
        const stss = Mp4.child(data, stbl, 'stss');
        const keys = stss ? new Set(Mp4.table(data, stss, 4)) : null; // sin stss, todas son de sincronización
        const units: AccessUnit[] = [];
        let sample = 0;
        for (let c = 0, e = 0; c < offsets.length && sample < sizes.length; c++) {
            while (e + 1 < chunks.length && chunks[e + 1].first <= c + 1) {
                e++;
            }
            let offset = offsets[c];
            for (let k = 0; k < (chunks[e]?.perChunk ?? 0) && sample < sizes.length; k++, sample++) {
                const end = offset + sizes[sample];
                if (end > data.length) {
                    return { family, codec, units, description, frameMs: Mp4.frameMs(data, mdia, stbl) }; // fichero cortado
                }
                units.push({ start: offset, end, key: keys ? keys.has(sample + 1) : true });
                offset = end;
            }
        }
        return { family, codec, units, description, frameMs: Mp4.frameMs(data, mdia, stbl) };
    }

    /** Duración media de un frame (stts) en la escala de tiempo de la pista (mdhd). */
    private static frameMs(data: Uint8Array, mdia: Box, stbl: Box): number | undefined {
        const mdhd = Mp4.child(data, mdia, 'mdhd');
        const stts = Mp4.child(data, stbl, 'stts');
        if (!mdhd || !stts) {
            return undefined;
        }
        const timescale = Mp4.u32(data, mdhd.body + (data[mdhd.body] == 1 ? 20 : 12));
        let samples = 0, ticks = 0;
        for (let i = 0, n = Mp4.u32(data, stts.body + 4); i < n; i++) {
            const count = Mp4.u32(data, stts.body + 8 + i * 8), delta = Mp4.u32(data, stts.body + 12 + i * 8);
            samples += count;
            ticks += count * delta;
        }
        return timescale && samples && ticks ? ticks / samples / timescale * 1000 : undefined;
    }

    /** stsz (tamaño fijo o uno por muestra) o stz2 (campos de 4, 8 o 16 bits). */
    private static sampleSizes(data: Uint8Array, box: Box): number[] {
        const sizes: number[] = [];
        if (box.type == 'stsz') {
            const fixed = Mp4.u32(data, box.body + 4), count = Mp4.u32(data, box.body + 8);
            for (let i = 0; i < count; i++) {
                sizes.push(fixed || Mp4.u32(data, box.body + 12 + i * 4));
            }
            return sizes;
        }
        const bits = data[box.body + 7], count = Mp4.u32(data, box.body + 8), at = box.body + 12;
        for (let i = 0; i < count; i++) {
            sizes.push(bits == 16 ? (data[at + i * 2] << 8) | data[at + i * 2 + 1]
                : bits == 8 ? data[at + i] : (data[at + (i >> 1)] >> ((i & 1) ? 0 : 4)) & 0x0f);
        }
        return sizes;
    }

    private static stsc(data: Uint8Array, box: Box): { first: number; perChunk: number }[] {
        const out: { first: number; perChunk: number }[] = [];
        for (let i = 0, n = Mp4.u32(data, box.body + 4); i < n; i++) {
            out.push({ first: Mp4.u32(data, box.body + 8 + i * 12), perChunk: Mp4.u32(data, box.body + 12 + i * 12) });
        }
        return out;
    }

    /** Tabla de una FullBox: número de entradas y los valores (de 4 u 8 bytes). */
    private static table(data: Uint8Array, box: Box, width: 4 | 8): number[] {
        const out: number[] = [];
        for (let i = 0, n = Mp4.u32(data, box.body + 4); i < n; i++) {
            out.push(width == 8 ? Mp4.u64(data, box.body + 8 + i * 8) : Mp4.u32(data, box.body + 8 + i * 4));
        }
        return out;
    }

    private static child(data: Uint8Array, parent: Box, type: string): Box | undefined {
        return Mp4.children(data, parent.body, parent.end).find(b => b.type == type);
    }

    private static children(data: Uint8Array, start: number, end: number): Box[] {
        const out: Box[] = [];
        for (let p = start; p + 8 <= end;) {
            let size = Mp4.u32(data, p), body = p + 8;
            if (size == 1) {
                if (p + 16 > end) {
                    break;
                }
                size = Mp4.u64(data, p + 8);
                body = p + 16;
            } else if (size == 0) {
                size = end - p; // hasta el final
            }
            if (size < body - p || p + size > end) {
                break; // caja rota o cortada
            }
            out.push({ type: Mp4.fourcc(data, p + 4), start: p, end: p + size, body });
            p += size;
        }
        return out;
    }

    private static fourcc(data: Uint8Array, at: number): string {
        return String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]);
    }

    private static u32(data: Uint8Array, at: number): number {
        return ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
    }

    private static u64(data: Uint8Array, at: number): number {
        return Mp4.u32(data, at) * 2 ** 32 + Mp4.u32(data, at + 4);
    }
}
