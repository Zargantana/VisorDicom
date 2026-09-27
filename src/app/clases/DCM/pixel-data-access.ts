import { DCMFile } from "./DCM-file.class";
import { DCMFileReader } from "./DCM-file-reader.class";
import { DCMInterpreter } from "./DCM-interpreter.class";

/**
 * Bytes de un frame tal y como los espera un decoder: el bitstream (encapsulado) o los píxeles (nativo).
 * `bitOffset` solo cuenta con BitsAllocated = 1: el frame empieza en ese bit de `data` (los frames de 1 bit van seguidos
 * a nivel de bit, PS3.5 8.2).
 */
export interface FrameBytes {
    data: Uint8Array | string;
    bitOffset: number;
}

/** El frame pedido no existe (el fichero tiene menos fragmentos de los que dice Number of Frames). */
export class MissingFrameError extends Error {
    constructor(public frame: number) {
        super('no existe el frame ' + (frame + 1));
        this.name = 'MissingFrameError';
    }
}

/**
 * Acceso a los frames del Pixel Data (7FE0,0010) de un fichero, SIN tenerlo entero en memoria.
 *
 *  - Si el fichero está entero en rawData (descargado del portal, Deflate, ficheros pequeños, pantalla de test) se usa
 *    el troceo de siempre (DCMInterpreter.getFramesData / getEncapsulatedFrames), en memoria y síncrono.
 *  - Si no (DCMFile.partial), cada frame se lee del fichero con DCMFile.readRange():
 *      · nativo: offset = inicio del valor + i × FrameSize (con 1 bit, por bits);
 *      · encapsulado: con la Extended Offset Table (7FE0,0001/0002) o la Basic Offset Table si son válidas, o
 *        recorriendo las cabeceras de los items (8 bytes cada una) de forma perezosa, solo hasta el frame pedido.
 *
 * Hay un acceso por fichero (se comparte entre los lectores del mismo DCMFile).
 */
export class PixelDataAccess {
    private static byFile = new WeakMap<DCMFile, PixelDataAccess>();

    public static for(reader: DCMFileReader): PixelDataAccess {
        const file = reader.sourceFile;
        let access = PixelDataAccess.byFile.get(file);
        if (!access) {
            access = new PixelDataAccess(reader);
            PixelDataAccess.byFile.set(file, access);
        }
        return access;
    }

    private memoryNative: string[] | null = null;
    private memoryEncapsulated: string[] | null = null;
    private index: EncapsulatedIndex | null = null;

    private constructor(private reader: DCMFileReader) {}

    private get file(): DCMFile {
        return this.reader.sourceFile;
    }

    private get info() {
        return this.reader.pixelDataInfo;
    }

    /** El fichero tiene Pixel Data (7FE0,0010) en el dataset raíz. */
    public get present(): boolean {
        return !!this.info;
    }

    /** Pixel Data encapsulado (longitud indefinida: BOT + fragmentos). */
    public get encapsulated(): boolean {
        return this.info?.length === null;
    }

    /** Longitud del valor del Pixel Data nativo (null si es encapsulado o no hay). */
    public get nativeLength(): number | null {
        const info = this.info;
        return info && info.length !== null ? info.length : null;
    }

    /** Todo el fichero está en memoria (rawData): se puede trocear de forma síncrona. */
    public get inMemory(): boolean {
        return !this.file.partial;
    }

    /** Número de frames que se pueden pedir (Number of Frames, mínimo 1; 0 si no hay Pixel Data). */
    public get frameCount(): number {
        if (!this.present && !this.inMemory) {
            return 0;
        }
        return Math.max(1, this.reader.Frames || 1);
    }

    /** Frame en memoria (solo si inMemory); null si no hay. `encapsulatedFrames` = el decoder espera bitstreams. */
    public getFrameSync(frame: number, encapsulatedFrames: boolean): FrameBytes | null {
        if (!this.inMemory) {
            return null;
        }
        const interpret = new DCMInterpreter(this.reader);
        if (this.reader.BitsAllocated == 1 && !encapsulatedFrames && (this.reader.Frames || 1) > 1) {
            const pixels = this.reader.Rows * this.reader.Columns * (this.reader.SamplesPerPixel || 1);
            const all = interpret.getPixelDatas()[0];
            return all === undefined ? null : { data: all, bitOffset: frame * pixels };
        }
        if (encapsulatedFrames) {
            this.memoryEncapsulated ??= interpret.getEncapsulatedFrames();
            const data = this.memoryEncapsulated[frame];
            return data === undefined ? null : { data, bitOffset: 0 };
        }
        this.memoryNative ??= interpret.getFramesData();
        const data = this.memoryNative[frame];
        return data === undefined ? null : { data, bitOffset: 0 };
    }

    /** Número de frames que hay de verdad en memoria (el troceo de siempre puede dar menos que Number of Frames). */
    public memoryFrameCount(encapsulatedFrames: boolean): number {
        if (!this.inMemory) {
            return this.frameCount;
        }
        const interpret = new DCMInterpreter(this.reader);
        if (this.reader.BitsAllocated == 1 && !encapsulatedFrames && (this.reader.Frames || 1) > 1) {
            return interpret.getPixelDatas().length ? this.reader.Frames : 0;
        }
        if (encapsulatedFrames) {
            this.memoryEncapsulated ??= interpret.getEncapsulatedFrames();
            return this.memoryEncapsulated.length;
        }
        this.memoryNative ??= interpret.getFramesData();
        return this.memoryNative.length;
    }

    /** Bytes del frame `frame` (0 = primero). Lanza MissingFrameError si el fichero no lo tiene. */
    public async getFrame(frame: number, encapsulatedFrames: boolean): Promise<FrameBytes> {
        if (this.inMemory) {
            const bytes = this.getFrameSync(frame, encapsulatedFrames);
            if (!bytes) {
                throw new MissingFrameError(frame);
            }
            return bytes;
        }
        const info = this.info;
        if (!info) {
            throw new MissingFrameError(frame);
        }
        if (info.length === null) {
            // Encapsulado: el bitstream del frame (los decoders "nativos" también lo aceptan: es lo que hacía antes)
            this.index ??= new EncapsulatedIndex(this.file, info.valueOffset, this.frameCount, this.onePerFrame(), this.extendedOffsetTable());
            return { data: await this.index.frame(frame), bitOffset: 0 };
        }
        return this.nativeFrame(frame, info.valueOffset, info.length);
    }

    private async nativeFrame(frame: number, valueOffset: number, length: number): Promise<FrameBytes> {
        const frames = Math.max(1, this.reader.Frames || 1);
        if (frame < 0 || frame >= frames) {
            throw new MissingFrameError(frame);
        }
        if (this.reader.BitsAllocated == 1 && frames > 1) {
            const pixels = this.reader.Rows * this.reader.Columns * (this.reader.SamplesPerPixel || 1);
            const firstBit = frame * pixels;
            const start = Math.floor(firstBit / 8), end = Math.min(length, Math.ceil((firstBit + pixels) / 8));
            return { data: await this.file.readRange(valueOffset + start, end - start), bitOffset: firstBit - start * 8 };
        }
        if (frames == 1) {
            return { data: await this.file.readRange(valueOffset, length), bitOffset: 0 };
        }
        const size = this.reader.FrameSize;
        const start = frame * size;
        if (start >= length) {
            throw new MissingFrameError(frame);
        }
        return { data: await this.file.readRange(valueOffset + start, Math.min(size, length - start)), bitOffset: 0 };
    }

    /** RLE y los sin comprimir encapsulados llevan exactamente un fragmento por frame (PS3.5 A.4.2 y A.4.11). */
    private onePerFrame(): boolean {
        const ts = (this.reader.TransferSyntax || '').replace(/\0/g, '').trim();
        return ts == '1.2.840.10008.1.2.5' || ts == '1.2.840.10008.1.2.1.98' || ts == '1.3.6.1.4.1.5962.300.2';
    }

    /** Extended Offset Table (7FE0,0001) y sus longitudes (7FE0,0002), del dataset raíz; null si no están. */
    private extendedOffsetTable(): { offsets: number[]; lengths: number[] } | null {
        const tags = this.reader.readed_tags;
        const offsets = tags.find(t => t.TagHigh == 0x7FE0 && t.TagLow == 0x0001 && t.depth == 0)?.Value;
        const lengths = tags.find(t => t.TagHigh == 0x7FE0 && t.TagLow == 0x0002 && t.depth == 0)?.Value;
        if (!offsets || !lengths) {
            return null;
        }
        const read64 = (raw: string) => {
            const out: number[] = [];
            for (let i = 0; i + 8 <= raw.length; i += 8) {
                let value = 0;
                for (let b = 7; b >= 0; b--) {
                    value = value * 256 + raw.charCodeAt(i + b);
                }
                out.push(value);
            }
            return out;
        };
        return { offsets: read64(offsets), lengths: read64(lengths) };
    }
}

/** Un item (FFFE,E000) del Pixel Data encapsulado: dónde empieza su cabecera y su valor, cuánto mide. */
interface Fragment {
    tagPos: number;
    valueOffset: number;
    length: number;
    /** El valor empieza por un marcador de inicio de codestream: JPEG (SOI FFD8) o JPEG 2000 (SOC FF4F). */
    starts: boolean;
}

/**
 * Índice perezoso del Pixel Data encapsulado de un fichero que NO está en memoria (PS3.5 A.4). Reglas, en este orden
 * (las mismas que DCMInterpreter.getEncapsulatedFrames aplica en memoria):
 *   1. Extended Offset Table válida: un fragmento por frame, lectura directa.
 *   2. Un solo frame: todos los fragmentos.
 *   3. Basic Offset Table válida: el frame va de BOT[i] a BOT[i+1] (el último, hasta el delimitador).
 *   4. RLE / sin comprimir encapsulado: un fragmento por frame.
 *   5. Marcadores: un frame empieza en cada fragmento que empieza por SOI/SOC (si el primero no, uno por frame).
 * Las cabeceras se leen por ventanas y solo hasta donde hace falta.
 */
class EncapsulatedIndex {
    private static readonly WINDOW = 64 * 1024;
    private initialized: Promise<void> | null = null;
    private bot: number[] = [];
    private firstFragmentPos = 0;
    private fragments: Fragment[] = [];
    private scanPos = 0;
    private scanDone = false;
    private window: { start: number; bytes: Uint8Array } | null = null;

    constructor(private file: DCMFile, private valueOffset: number, private frames: number, private onePerFrame: boolean,
                private eot: { offsets: number[]; lengths: number[] } | null) {}

    public async frame(i: number): Promise<Uint8Array> {
        this.initialized ??= this.init();
        await this.initialized;
        if (i < 0 || i >= this.frames) {
            throw new MissingFrameError(i);
        }
        if (this.eot && this.eot.offsets.length == this.frames && this.eot.lengths.length == this.frames) {
            const direct = await this.readItemAt(this.firstFragmentPos + this.eot.offsets[i], this.eot.lengths[i]);
            if (direct) {
                return direct;
            }
        }
        if (this.frames == 1) {
            await this.scanUntil(() => false);
            if (!this.fragments.length) {
                throw new MissingFrameError(0);
            }
            return this.readFragments(this.fragments);
        }
        if (this.validBot()) {
            const start = this.firstFragmentPos + this.bot[i];
            const end = i + 1 < this.frames ? this.firstFragmentPos + this.bot[i + 1] : Infinity;
            const fromBot = await this.fragmentsBetween(start, end);
            if (fromBot.length) {
                return this.readFragments(fromBot);
            }
        }
        const group = await this.frameFragments(i);
        if (!group.length) {
            throw new MissingFrameError(i);
        }
        return this.readFragments(group);
    }

    /** Lee el item de la Basic Offset Table (primer item) y deja el cursor en el primer fragmento. */
    private async init(): Promise<void> {
        const header = await this.file.readRange(this.valueOffset, 8);
        const tag = this.itemTag(header, 0);
        if (tag != 'item') {
            this.firstFragmentPos = this.valueOffset;
            this.scanPos = this.valueOffset;
            this.scanDone = true; // no hay items: Pixel Data encapsulado vacío o roto
            return;
        }
        const botLength = this.u32(header, 4);
        if (botLength > 0 && botLength <= 64 * 1024 * 1024) {
            const table = await this.file.readRange(this.valueOffset + 8, botLength);
            for (let p = 0; p + 4 <= table.length; p += 4) {
                this.bot.push(this.u32(table, p));
            }
        }
        this.firstFragmentPos = this.valueOffset + 8 + botLength;
        this.scanPos = this.firstFragmentPos;
    }

    private validBot(): boolean {
        if (this.bot.length != this.frames || this.bot[0] != 0) {
            return false;
        }
        for (let k = 1; k < this.bot.length; k++) {
            if (this.bot[k] <= this.bot[k - 1]) {
                return false;
            }
        }
        return true;
    }

    /** Fragmentos del frame i con las reglas 4 y 5 (recorriendo lo necesario). */
    private async frameFragments(i: number): Promise<Fragment[]> {
        if (this.onePerFrame) {
            await this.scanUntil(() => this.fragments.length > i);
            return this.fragments[i] ? [this.fragments[i]] : [];
        }
        await this.scanUntil(() => this.fragments.length > 0);
        if (this.fragments.length && !this.fragments[0].starts) {
            // Sin marcadores de inicio (codestream desconocido): uno por frame
            await this.scanUntil(() => this.fragments.length > i);
            return this.fragments[i] ? [this.fragments[i]] : [];
        }
        // Inicio del frame i y del i+1 por marcadores
        const startIndex = (k: number) => {
            let seen = -1;
            for (let f = 0; f < this.fragments.length; f++) {
                if (f == 0 || this.fragments[f].starts) {
                    seen++;
                    if (seen == k) {
                        return f;
                    }
                }
            }
            return -1;
        };
        await this.scanUntil(() => startIndex(i + 1) >= 0);
        const first = startIndex(i);
        if (first < 0) {
            return [];
        }
        const next = startIndex(i + 1);
        return this.fragments.slice(first, next >= 0 ? next : this.fragments.length);
    }

    /** Recorre cabeceras de items desde scanPos hasta que `enough()` o el delimitador (FFFE,E0DD) o el final. */
    private async scanUntil(enough: () => boolean): Promise<void> {
        while (!this.scanDone && !enough()) {
            const fragment = await this.readFragmentHeader(this.scanPos);
            if (!fragment) {
                this.scanDone = true;
                break;
            }
            this.fragments.push(fragment);
            this.scanPos = fragment.valueOffset + fragment.length;
        }
    }

    /** Fragmentos (items) entre dos posiciones, para la regla de la BOT. [] si en `start` no hay un item. */
    private async fragmentsBetween(start: number, end: number): Promise<Fragment[]> {
        const result: Fragment[] = [];
        let pos = start;
        while (pos < end) {
            const fragment = await this.readFragmentHeader(pos);
            if (!fragment) {
                break;
            }
            result.push(fragment);
            pos = fragment.valueOffset + fragment.length;
        }
        return result;
    }

    /** Cabecera de item en `pos` (y los 2 primeros bytes de su valor); null si es el delimitador, basura o el final. */
    private async readFragmentHeader(pos: number): Promise<Fragment | null> {
        if (pos + 8 > this.file.size) {
            return null;
        }
        const bytes = await this.bytesAt(pos, 10);
        if (bytes.length < 8 || this.itemTag(bytes, 0) != 'item') {
            return null;
        }
        const length = this.u32(bytes, 4);
        if (length == 0xFFFFFFFF || pos + 8 + length > this.file.size) {
            return null;
        }
        const starts = bytes.length >= 10 && bytes[8] == 0xFF && (bytes[9] == 0xD8 || bytes[9] == 0x4F);
        return { tagPos: pos, valueOffset: pos + 8, length, starts };
    }

    /** Un item completo en `pos` con la longitud esperada (Extended Offset Table); null si no cuadra. */
    private async readItemAt(pos: number, length: number): Promise<Uint8Array | null> {
        const header = await this.file.readRange(pos, 8);
        if (header.length < 8 || this.itemTag(header, 0) != 'item' || this.u32(header, 4) != length) {
            return null;
        }
        return this.file.readRange(pos + 8, length);
    }

    private async readFragments(fragments: Fragment[]): Promise<Uint8Array> {
        if (fragments.length == 1) {
            return this.file.readRange(fragments[0].valueOffset, fragments[0].length);
        }
        const parts = await Promise.all(fragments.map(f => this.file.readRange(f.valueOffset, f.length)));
        const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
        let offset = 0;
        for (const part of parts) {
            out.set(part, offset);
            offset += part.length;
        }
        return out;
    }

    /**
     * Bytes [pos, pos + n) pasando por una ventana de 64 KB: con fragmentos pequeños una sola lectura trae muchas
     * cabeceras; con fragmentos grandes se lee lo justo en cada salto.
     */
    private async bytesAt(pos: number, n: number): Promise<Uint8Array> {
        const w = this.window;
        if (w && pos >= w.start && pos + n <= w.start + w.bytes.length) {
            return w.bytes.subarray(pos - w.start, pos - w.start + n);
        }
        // Si el último fragmento ya no cabía en una ventana, los siguientes tampoco suelen caber: lectura mínima
        const last = this.fragments.length ? this.fragments[this.fragments.length - 1].length : 0;
        const size = last > EncapsulatedIndex.WINDOW ? 16 : EncapsulatedIndex.WINDOW;
        const bytes = await this.file.readRange(pos, Math.max(size, n));
        this.window = { start: pos, bytes };
        return bytes.subarray(0, n);
    }

    private itemTag(b: Uint8Array, at: number): 'item' | 'delimiter' | null {
        if (b[at] != 0xFE || b[at + 1] != 0xFF) {
            return null;
        }
        const element = b[at + 2] | (b[at + 3] << 8);
        return element == 0xE000 ? 'item' : (element == 0xE0DD ? 'delimiter' : null);
    }

    private u32(b: Uint8Array, at: number): number {
        return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
    }
}
