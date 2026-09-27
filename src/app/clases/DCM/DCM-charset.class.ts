/**
 * Specific Character Set (0008,0005): de los bytes de un valor de texto (SH, LO, ST, LT, PN, UC, UT) a texto Unicode.
 *
 * Los datos DICOM viajan como "binary string" (1 carácter = 1 byte, Latin-1): sin decodificar, un nombre en UTF-8
 * ("Müller") sale como "MÃ¼ller" y uno en japonés sale ilegible. PS3.3 C.12.1.1.2 y PS3.5 6.1:
 *
 * - Sin (0008,0005) o con "ISO_IR 6": repertorio básico (ASCII). Muchos ficheros llevan igualmente bytes de 8 bits sin
 *   declararlo: si forman UTF-8 válido se leen como UTF-8 (en Latin-1 real esa combinación es casi imposible); si no,
 *   como Latin-1, que es lo que hacía el visor.
 * - Un solo juego sin extensiones ("ISO_IR 100", "ISO_IR 192", "GB18030"…): todo el valor con ese juego.
 * - Con extensiones ISO 2022 ("ISO 2022 IR 6\ISO 2022 IR 87", "\ISO 2022 IR 149"…): las secuencias de escape (ESC)
 *   cambian el juego G0 (bytes de 7 bits: ASCII o JIS X 0208/0212 de dos bytes) o el G1 (bytes con el bit alto:
 *   ISO 8859-x, katakana, KS X 1001, GB 2312). Se vuelve al juego inicial en los fines de línea, tabuladores, el
 *   separador de valores "\" y, en los nombres (PN), en "^" y "=" (PS3.5 6.1.2.5.3).
 *
 * Usa TextDecoder (navegadores y Node con ICU completo). Si una etiqueta no existe, esos bytes se dejan en Latin-1.
 */
type G0 = 'ascii' | 'jis0208' | 'jis0212';
interface Designation { g0?: G0; g1?: string; }

const KATAKANA = 'katakana'; // JIS X 0201: bytes A1-DF = katakana de ancho medio (U+FF61…U+FF9F)

export class DicomCharset {

    /** Juegos sin extensiones de código (valor 1 de (0008,0005)) -> etiqueta de TextDecoder. */
    private static readonly SINGLE: Record<string, string> = {
        'ISO_IR 100': 'iso-8859-1', 'ISO_IR 101': 'iso-8859-2', 'ISO_IR 109': 'iso-8859-3', 'ISO_IR 110': 'iso-8859-4',
        'ISO_IR 144': 'iso-8859-5', 'ISO_IR 127': 'iso-8859-6', 'ISO_IR 126': 'iso-8859-7', 'ISO_IR 138': 'iso-8859-8',
        'ISO_IR 148': 'iso-8859-9', 'ISO_IR 203': 'iso-8859-15', 'ISO_IR 166': 'windows-874', 'ISO_IR 13': KATAKANA,
        'ISO_IR 192': 'utf-8', 'GB18030': 'gb18030', 'GBK': 'gbk',
    };

    /** Juegos con extensiones ISO 2022: lo que designan al empezar el valor (si son el valor 1). */
    private static readonly EXTENSIONS: Record<string, Designation> = {
        'ISO 2022 IR 6': { g0: 'ascii' },
        'ISO 2022 IR 100': { g0: 'ascii', g1: 'iso-8859-1' }, 'ISO 2022 IR 101': { g0: 'ascii', g1: 'iso-8859-2' },
        'ISO 2022 IR 109': { g0: 'ascii', g1: 'iso-8859-3' }, 'ISO 2022 IR 110': { g0: 'ascii', g1: 'iso-8859-4' },
        'ISO 2022 IR 144': { g0: 'ascii', g1: 'iso-8859-5' }, 'ISO 2022 IR 127': { g0: 'ascii', g1: 'iso-8859-6' },
        'ISO 2022 IR 126': { g0: 'ascii', g1: 'iso-8859-7' }, 'ISO 2022 IR 138': { g0: 'ascii', g1: 'iso-8859-8' },
        'ISO 2022 IR 148': { g0: 'ascii', g1: 'iso-8859-9' }, 'ISO 2022 IR 203': { g0: 'ascii', g1: 'iso-8859-15' },
        'ISO 2022 IR 166': { g0: 'ascii', g1: 'windows-874' },
        'ISO 2022 IR 13': { g0: 'ascii', g1: KATAKANA },       // G0 = JIS X 0201 romano (se trata como ASCII, igual que pydicom)
        'ISO 2022 IR 87': { g0: 'jis0208' }, 'ISO 2022 IR 159': { g0: 'jis0212' },
        'ISO 2022 IR 149': { g1: 'euc-kr' }, 'ISO 2022 IR 58': { g1: 'gbk' },
    };

    /** Secuencias de escape (lo que sigue a ESC) -> designación. Las más largas primero. */
    private static readonly ESCAPES: [string, Designation][] = [
        ['$(D', { g0: 'jis0212' }], ['$)C', { g1: 'euc-kr' }], ['$)A', { g1: 'gbk' }],
        ['$B', { g0: 'jis0208' }], ['$@', { g0: 'jis0208' }],
        ['(B', { g0: 'ascii' }], ['(J', { g0: 'ascii' }], [')I', { g1: KATAKANA }],
        ['-A', { g1: 'iso-8859-1' }], ['-B', { g1: 'iso-8859-2' }], ['-C', { g1: 'iso-8859-3' }], ['-D', { g1: 'iso-8859-4' }],
        ['-L', { g1: 'iso-8859-5' }], ['-G', { g1: 'iso-8859-6' }], ['-F', { g1: 'iso-8859-7' }], ['-H', { g1: 'iso-8859-8' }],
        ['-M', { g1: 'iso-8859-9' }], ['-T', { g1: 'windows-874' }], ['-b', { g1: 'iso-8859-15' }],
    ];

    private static readonly decoders = new Map<string, TextDecoder | null>();

    /** Valor de (0008,0005) -> lista de términos normalizados ("" = repertorio básico en el valor 1). */
    public static parse(value: string | undefined | null): string[] {
        if (!value) {
            return [];
        }
        return value.replace(/\0/g, '').split('\\').map(t => DicomCharset.normalize(t));
    }

    /** Variantes que se ven en ficheros reales ("ISO-IR 192", "ISO_IR_100", "UTF-8") -> término del estándar. */
    private static normalize(term: string): string {
        const t = term.trim().toUpperCase();
        if (t === 'UTF-8' || t === 'UTF8') {
            return 'ISO_IR 192';
        }
        let m = /^ISO[-_ ]?2022[-_ ]?IR[-_ ]?(\d+)$/.exec(t);
        if (m) {
            return `ISO 2022 IR ${+m[1]}`;
        }
        m = /^ISO[-_ ]?IR[-_ ]?(\d+)$/.exec(t);
        return m ? `ISO_IR ${+m[1]}` : t;
    }

    /**
     * Decodifica un valor (binary string, tal cual viene del fichero) con los juegos de (0008,0005).
     * @param isPN nombres de persona: "^" y "=" también devuelven al juego inicial.
     */
    public static decode(raw: string, charsets: string[] = [], isPN: boolean = false): string {
        if (!raw || !/[\x80-\xff\x1b]/.test(raw)) {
            return raw; // solo ASCII: igual con cualquier juego
        }
        const first = charsets[0] ?? '';
        const hasEscape = raw.indexOf('\x1b') >= 0;
        if (!hasEscape || first === 'ISO_IR 192' || first === 'GB18030' || first === 'GBK') {
            const single = DicomCharset.SINGLE[first];
            if (single) {
                return DicomCharset.decodeBytes(raw, single);
            }
            if (!DicomCharset.EXTENSIONS[first] || first === 'ISO 2022 IR 6') {
                // Repertorio básico (o término desconocido) con bytes de 8 bits: UTF-8 si lo es; si no, Latin-1
                return DicomCharset.tryUtf8(raw) ?? raw;
            }
        }
        return DicomCharset.decodeIso2022(raw, first, isPN);
    }

    private static decodeIso2022(raw: string, first: string, isPN: boolean): string {
        const initial: Designation = DicomCharset.EXTENSIONS[first] ?? (DicomCharset.SINGLE[first] ? { g0: 'ascii', g1: DicomCharset.SINGLE[first] } : { g0: 'ascii' });
        let g0: G0 = initial.g0 ?? 'ascii';
        let g1: string | undefined = initial.g1;
        let out = '';
        let i = 0;
        const n = raw.length;
        const code = (k: number) => raw.charCodeAt(k);
        while (i < n) {
            const c = code(i);
            if (c === 0x1b) {
                const esc = DicomCharset.ESCAPES.find(([seq]) => raw.startsWith(seq, i + 1));
                if (esc) {
                    if (esc[1].g0) { g0 = esc[1].g0; }
                    if (esc[1].g1) { g1 = esc[1].g1; }
                    i += 1 + esc[0].length;
                } else {
                    i++; // escape desconocido: se descarta
                }
                continue;
            }
            if (c >= 0x80) {
                let j = i;
                while (j < n && code(j) >= 0x80) { j++; }
                out += DicomCharset.decodeHigh(raw.substring(i, j), g1);
                i = j;
                continue;
            }
            if (g0 !== 'ascii' && c >= 0x21 && c < 0x7f) {
                // JIS X 0208/0212 en 7 bits: parejas de bytes -> EUC-JP (bit alto; 0x8F delante para JIS X 0212)
                let j = i;
                let euc = '';
                while (j + 1 < n && code(j) >= 0x21 && code(j) < 0x7f && code(j + 1) >= 0x21 && code(j + 1) < 0x7f) {
                    euc += (g0 === 'jis0212' ? '\x8f' : '') + String.fromCharCode(code(j) | 0x80, code(j + 1) | 0x80);
                    j += 2;
                }
                if (j > i) {
                    out += DicomCharset.decodeBytes(euc, 'euc-jp');
                    i = j;
                    continue;
                }
            }
            out += raw[i];
            if (c === 0x0a || c === 0x0d || c === 0x0c || c === 0x09 || c === 0x5c || (isPN && (c === 0x5e || c === 0x3d))) {
                g0 = initial.g0 ?? 'ascii';
                g1 = initial.g1;
            }
            i++;
        }
        return out;
    }

    /** Bytes con el bit alto en el juego G1 activo (sin G1: Latin-1, como antes). */
    private static decodeHigh(run: string, g1: string | undefined): string {
        if (!g1) {
            return run;
        }
        return DicomCharset.decodeBytes(run, g1);
    }

    private static decodeBytes(raw: string, label: string): string {
        if (label === KATAKANA) {
            let s = '';
            for (let k = 0; k < raw.length; k++) {
                const b = raw.charCodeAt(k);
                s += (b >= 0xa1 && b <= 0xdf) ? String.fromCharCode(0xff61 + b - 0xa1) : raw[k];
            }
            return s;
        }
        const decoder = DicomCharset.decoder(label);
        if (!decoder) {
            return raw;
        }
        return decoder.decode(DicomCharset.bytes(raw));
    }

    /** UTF-8 estricto; null si los bytes no lo son. */
    private static tryUtf8(raw: string): string | null {
        const key = 'utf-8/fatal';
        if (!DicomCharset.decoders.has(key)) {
            try {
                DicomCharset.decoders.set(key, new TextDecoder('utf-8', { fatal: true }));
            } catch {
                DicomCharset.decoders.set(key, null);
            }
        }
        const decoder = DicomCharset.decoders.get(key);
        if (!decoder) {
            return null;
        }
        try {
            return decoder.decode(DicomCharset.bytes(raw));
        } catch {
            return null;
        }
    }

    private static decoder(label: string): TextDecoder | null {
        if (!DicomCharset.decoders.has(label)) {
            try {
                DicomCharset.decoders.set(label, new TextDecoder(label));
            } catch {
                DicomCharset.decoders.set(label, null); // etiqueta que este navegador no conoce
            }
        }
        return DicomCharset.decoders.get(label) ?? null;
    }

    private static bytes(raw: string): Uint8Array {
        const out = new Uint8Array(raw.length);
        for (let k = 0; k < raw.length; k++) {
            out[k] = raw.charCodeAt(k) & 0xff;
        }
        return out;
    }
}
