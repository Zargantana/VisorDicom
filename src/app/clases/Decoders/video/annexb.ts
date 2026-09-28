/** Familias de vídeo de las Transfer Syntaxes de vídeo (PS3.5 8.2.5-8.2.8). */
export type VideoFamily = 'h264' | 'hevc';

/** Una unidad de acceso (un frame) del flujo: bytes [start, end) con sus start codes, en orden de decodificación. */
export interface AccessUnit {
    start: number;
    end: number;
    /** Se puede empezar a decodificar aquí (IDR). */
    key: boolean;
}

export interface VideoStreamInfo {
    family: VideoFamily;
    /** Cadena de códec para WebCodecs (p. ej. "avc1.64001F", "hvc1.1.6.L93.B0"); vacía si no hay SPS. */
    codec: string;
    units: AccessUnit[];
    /**
     * Configuración del decodificador (caja avcC o hvcC de un MP4, `Mp4`): con ella cada unidad lleva sus NAL con la
     * longitud delante, no con start codes, y va así a WebCodecs.
     */
    description?: Uint8Array;
    /** Milisegundos por frame que dice el contenedor (MP4), si los dice. */
    frameMs?: number;
}

interface Nal {
    /** Posición del start code (con el cero inicial si es de 4 bytes). */
    sc: number;
    start: number;
    end: number;
}

/**
 * Flujo H.264 o HEVC en formato Annex B (start codes 00 00 01), que es como va en el Pixel Data de las Transfer
 * Syntaxes de vídeo: un único flujo repartido en fragmentos sin relación con los frames (PS3.5 8.2.5-8.2.8). Lo parte
 * en unidades de acceso (una por frame, ITU-T H.264 7.4.1.2.3 y H.265 7.4.2.4.4), marca las IDR y saca del SPS la
 * cadena de códec que pide WebCodecs. Sin DOM: se prueba en Node.
 */
export class AnnexB {

    public static parse(data: Uint8Array, family: VideoFamily): VideoStreamInfo {
        const nals = AnnexB.nals(data);
        return family == 'h264' ? AnnexB.parseH264(data, nals) : AnnexB.parseHevc(data, nals);
    }

    /** NAL units: posición del start code y del contenido (sin los ceros del final, que son del siguiente start code). */
    public static nals(data: Uint8Array): Nal[] {
        const out: Nal[] = [];
        const n = data.length;
        let current: Nal | null = null;
        for (let i = 0; i + 2 < n;) {
            if (data[i + 2] > 1) {
                i += 3;
            } else if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1) {
                const sc = i > 0 && data[i - 1] == 0 ? i - 1 : i;
                if (current) {
                    current.end = AnnexB.trimZeros(data, current.start, sc);
                    out.push(current);
                }
                current = { sc, start: i + 3, end: n };
                i += 3;
            } else {
                i++;
            }
        }
        if (current) {
            current.end = AnnexB.trimZeros(data, current.start, n);
            out.push(current);
        }
        return out.filter(nal => nal.end > nal.start);
    }

    private static trimZeros(data: Uint8Array, start: number, end: number): number {
        while (end > start && data[end - 1] == 0) {
            end--;
        }
        return end;
    }

    private static parseH264(data: Uint8Array, nals: Nal[]): VideoStreamInfo {
        const units: AccessUnit[] = [];
        let codec = '';
        let current: { start: number; key: boolean; vcl: boolean } | null = null;
        for (const nal of nals) {
            const type = data[nal.start] & 0x1f;
            const vcl = type >= 1 && type <= 5;
            // Empiezan unidad: un slice con first_mb_in_slice = 0 (ue(v) = 0 si el primer bit es 1) o, antes del
            // primer slice, AUD, SPS, PPS, SEI y 14-18
            const starts = vcl ? (data[nal.start + 1] & 0x80) != 0 : (type >= 6 && type <= 9) || (type >= 14 && type <= 18);
            if (current && current.vcl && starts) {
                units.push({ start: current.start, end: nal.sc, key: current.key });
                current = null;
            }
            current ??= { start: nal.sc, key: false, vcl: false };
            if (type == 7 && !codec && nal.end - nal.start >= 4) {
                // avc1.PPCCLL: profile_idc, constraint_set flags y level_idc (los tres primeros bytes del SPS)
                codec = 'avc1.' + [1, 2, 3].map(k => data[nal.start + k].toString(16).padStart(2, '0')).join('').toUpperCase();
            }
            if (vcl) {
                current.vcl = true;
                current.key ||= type == 5;
            }
        }
        if (current?.vcl) {
            units.push({ start: current.start, end: data.length, key: current.key });
        }
        AnnexB.extendToNext(units, data.length);
        return { family: 'h264', codec, units };
    }

    private static parseHevc(data: Uint8Array, nals: Nal[]): VideoStreamInfo {
        const units: AccessUnit[] = [];
        let codec = '';
        let current: { start: number; key: boolean; vcl: boolean } | null = null;
        for (const nal of nals) {
            const type = (data[nal.start] >> 1) & 0x3f;
            const vcl = type < 32;
            // first_slice_segment_in_pic_flag: primer bit tras la cabecera de 2 bytes. No VCL que empiezan unidad:
            // VPS, SPS, PPS, AUD, SEI de prefijo y 41-44, 48-55
            const starts = vcl ? (data[nal.start + 2] & 0x80) != 0
                : (type >= 32 && type <= 35) || type == 39 || (type >= 41 && type <= 44) || (type >= 48 && type <= 55);
            if (current && current.vcl && starts) {
                units.push({ start: current.start, end: nal.sc, key: current.key });
                current = null;
            }
            current ??= { start: nal.sc, key: false, vcl: false };
            if (type == 33 && !codec) {
                codec = AnnexB.hevcCodec(data.subarray(nal.start, nal.end));
            }
            if (vcl) {
                current.vcl = true;
                // IDR (19, 20). Una CRA o BLA solo al principio: tras ellas el decodificador descarta las RASL y la
                // cuenta de frames ya no cuadraría
                current.key ||= type == 19 || type == 20 || (units.length == 0 && type >= 16 && type <= 21);
            }
        }
        if (current?.vcl) {
            units.push({ start: current.start, end: data.length, key: current.key });
        }
        AnnexB.extendToNext(units, data.length);
        return { family: 'hevc', codec, units };
    }

    /** Cada unidad llega hasta donde empieza la siguiente (así viajan también los NAL finales, p. ej. fin de secuencia). */
    private static extendToNext(units: AccessUnit[], length: number): void {
        for (let k = 0; k < units.length; k++) {
            units[k].end = k + 1 < units.length ? units[k + 1].start : length;
        }
        if (units.length) {
            units[0].start = 0; // lo que va antes del primer frame (parámetros) viaja con él
        }
    }

    /** Cadena de códec HEVC desde el profile_tier_level del SPS. */
    private static hevcCodec(nal: Uint8Array): string {
        const rbsp = AnnexB.unescape(nal.subarray(2, Math.min(nal.length, 2 + 32)));
        if (rbsp.length < 13) {
            return '';
        }
        // tras sps_video_parameter_set_id, sps_max_sub_layers_minus1 y temporal_id_nesting
        return AnnexB.hevcCodecString('hvc1', rbsp.subarray(1));
    }

    /**
     * <hvc1|hev1>.<espacio><perfil>.<compatibilidad invertida>.<L|H><nivel>.<restricciones> (ISO/IEC 14496-15 E.3)
     * desde los 12 bytes de la parte general del profile_tier_level (los mismos que lleva la caja hvcC tras su primer
     * byte).
     */
    public static hevcCodecString(prefix: string, p: Uint8Array): string {
        if (p.length < 12) {
            return '';
        }
        const space = p[0] >> 6, tier = (p[0] >> 5) & 1, profile = p[0] & 0x1f;
        let compat = ((p[1] << 24) | (p[2] << 16) | (p[3] << 8) | p[4]) >>> 0;
        let reversed = 0;
        for (let k = 0; k < 32; k++) {
            reversed = ((reversed << 1) | (compat & 1)) >>> 0;
            compat >>>= 1;
        }
        const constraints = Array.from(p.subarray(5, 11));
        while (constraints.length && constraints[constraints.length - 1] == 0) {
            constraints.pop();
        }
        const level = p[11];
        return [prefix, (space ? String.fromCharCode(64 + space) : '') + profile, reversed.toString(16).toUpperCase(),
            (tier ? 'H' : 'L') + level, ...constraints.map(c => c.toString(16).toUpperCase())].join('.');
    }

    /** Quita los bytes de prevención de emulación (00 00 03 → 00 00). */
    private static unescape(bytes: Uint8Array): Uint8Array {
        const out: number[] = [];
        for (let i = 0; i < bytes.length; i++) {
            if (i >= 2 && bytes[i] == 3 && bytes[i - 1] == 0 && bytes[i - 2] == 0 && out.length >= 2 && out[out.length - 1] == 0 && out[out.length - 2] == 0) {
                continue;
            }
            out.push(bytes[i]);
        }
        return Uint8Array.from(out);
    }
}
