import { AccessUnit, VideoStreamInfo } from "./annexb";

/** Lo que el decodificador necesita de la imagen: dónde dejar cada frame y si ya está. */
export interface VideoFrameSink {
    has(index: number): boolean;
    /** RGB entrelazado (Columns x Rows x 3) del frame `index` (orden de presentación). */
    put(index: number, rgb: Uint8Array): void;
}

/**
 * Decodifica un flujo H.264/HEVC frame a frame con WebCodecs (VideoDecoder), que traen Chrome y Edge: sin códecs en
 * JavaScript ni cambios en la CSP. Es un decodificador por imagen que avanza en orden; para ir a un frame anterior (o
 * saltar lejos) vuelve a empezar desde la IDR anterior a ese frame. Los frames salen en orden de presentación (el
 * decodificador reordena las B); tras empezar en la IDR k, el n-ésimo frame que sale es el k + n (GOP cerrado).
 * Cada frame se convierte a RGB (I420 y NV12 aquí, con la matriz YCbCr → RGB del flujo; el resto, con un canvas) y va
 * a la caché.
 */
export class VideoStreamDecoder {
    /** Unidades que se adelantan al frame pedido como mucho (margen para el reordenado de las B). */
    private static readonly LOOKAHEAD = 12;

    public static get available(): boolean {
        return typeof (globalThis as any).VideoDecoder !== 'undefined' && typeof (globalThis as any).EncodedVideoChunk !== 'undefined';
    }

    /**
     * true si el navegador decodifica ese códec con ese tamaño. Se pregunta por hardware y por software: "sin
     * preferencia" no vale, porque Chrome en Windows contesta que sí a un HEVC de 160x120 que su decodificador por
     * hardware rechaza después (no admite menos de 320x240) y no tiene HEVC por software (2026-09-28, Chrome 153).
     */
    public static async supports(codec: string, width: number, height: number): Promise<boolean> {
        if (!VideoStreamDecoder.available || !codec) {
            return false;
        }
        for (const hardwareAcceleration of ['prefer-hardware', 'prefer-software']) {
            try {
                const support = await (globalThis as any).VideoDecoder.isConfigSupported({ codec, codedWidth: width, codedHeight: height, hardwareAcceleration });
                if (support?.supported) {
                    return true;
                }
            } catch { /* se prueba la otra */ }
        }
        return false;
    }

    /**
     * YCbCr 4:2:0 de 8 bits (I420: planos Y, U y V; NV12: Y y UV entrelazados) → RGB entrelazado, con la matriz y el
     * rango del flujo y el croma por vecino más próximo, como FFmpeg. No usa `drawImage`: Edge pinta el NV12 de su
     * decodificador por hardware con otra interpolación del croma y se aparta de FFmpeg (media 7, picos de 64 en los
     * bordes) aunque los planos sean los mismos (media 1, máximo 3). Sin matriz declarada, BT.709.
     */
    public static yuv420ToRGB(data: Uint8Array, layout: { offset: number; stride: number }[], nv12: boolean, width: number, height: number,
                              colorSpace?: { matrix?: string | null; fullRange?: boolean | null } | null): Uint8Array {
        const [kr, kb] = colorSpace?.matrix == 'bt470bg' || colorSpace?.matrix == 'smpte170m' ? [0.299, 0.114]
            : colorSpace?.matrix == 'bt2020-ncl' ? [0.2627, 0.0593] : [0.2126, 0.0722];
        const kg = 1 - kr - kb;
        const full = !!colorSpace?.fullRange;
        const yScale = full ? 1 : 255 / 219, yOffset = full ? 0 : 16, cScale = full ? 1 : 255 / 224;
        const Y = new Float32Array(256), crR = new Float32Array(256), cbG = new Float32Array(256), crG = new Float32Array(256), cbB = new Float32Array(256);
        for (let v = 0; v < 256; v++) {
            const c = (v - 128) * cScale;
            Y[v] = (v - yOffset) * yScale;
            crR[v] = 2 * (1 - kr) * c;
            cbG[v] = 2 * kb * (1 - kb) / kg * c;
            crG[v] = 2 * kr * (1 - kr) / kg * c;
            cbB[v] = 2 * (1 - kb) * c;
        }
        const clamp = (x: number) => x <= 0 ? 0 : x >= 255 ? 255 : Math.round(x);
        const rgb = new Uint8Array(width * height * 3);
        const yPlane = layout[0], uPlane = layout[1], vPlane = layout[2];
        for (let y = 0, k = 0; y < height; y++) {
            const yRow = yPlane.offset + y * yPlane.stride;
            const uRow = uPlane.offset + (y >> 1) * uPlane.stride;
            const vRow = nv12 ? uRow + 1 : vPlane.offset + (y >> 1) * vPlane.stride;
            for (let x = 0; x < width; x++, k += 3) {
                const l = Y[data[yRow + x]];
                const cb = nv12 ? data[uRow + (x >> 1) * 2] : data[uRow + (x >> 1)];
                const cr = nv12 ? data[vRow + (x >> 1) * 2] : data[vRow + (x >> 1)];
                rgb[k] = clamp(l + crR[cr]);
                rgb[k + 1] = clamp(l - cbG[cb] - crG[cr]);
                rgb[k + 2] = clamp(l + cbB[cb]);
            }
        }
        return rgb;
    }

    private decoder: any = null;
    /** Siguiente unidad que se manda (orden de decodificación). */
    private next = 0;
    /** Frame (orden de presentación) que corresponde a la primera salida desde el último reinicio. */
    private base = 0;
    private produced = 0;
    /** Tras un flush el decodificador pide una IDR: se reinicia en la siguiente petición. */
    private needsReset = true;
    private chain: Promise<void> = Promise.resolve();
    private error: any = null;
    /** Cada reinicio cambia de generación (va en el timestamp): un frame que salga tarde de antes se descarta. */
    private generation = 0;
    private static readonly GENERATION_US = 1e10;
    private wake: (() => void) | null = null;
    private canvas: any = null;
    /** Frames que ya salieron del decodificador y se están pasando a RGB (`copyTo` es asíncrono). */
    private converting = new Set<Promise<void>>();

    constructor(private stream: Uint8Array, private info: VideoStreamInfo, private width: number, private height: number,
                private frameMicros: number, private sink: VideoFrameSink) { }

    public get frameCount(): number {
        return this.info.units.length;
    }

    /** Deja decodificado (en el sink) el frame `f`; las peticiones se atienden de una en una. */
    public decodeUntil(f: number): Promise<void> {
        const run = this.chain.catch(() => undefined).then(() => this.run(f));
        this.chain = run;
        return run;
    }

    public close(): void {
        try {
            this.decoder?.close();
        } catch { /* ya cerrado */ }
        this.decoder = null;
    }

    private keyBefore(f: number): number {
        const units = this.info.units;
        for (let k = Math.min(f, units.length - 1); k > 0; k--) {
            if (units[k].key) {
                return k;
            }
        }
        return 0;
    }

    private async run(f: number): Promise<void> {
        if (f < 0 || f >= this.frameCount || this.sink.has(f)) {
            return;
        }
        const key = this.keyBefore(f);
        const nextOut = this.base + this.produced;
        if (this.needsReset || !this.decoder || this.decoder.state == 'closed' || f < nextOut || key > this.next) {
            this.reset(key);
        }
        const units = this.info.units;
        let waits = 0;
        while (!this.sink.has(f)) {
            if (this.error) {
                const error = this.error;
                this.error = null;
                this.needsReset = true;
                throw error;
            }
            if (this.next < units.length && this.next <= f + VideoStreamDecoder.LOOKAHEAD) {
                this.decoder.decode(this.chunk(this.next, units[this.next]));
                this.next++;
                waits = 0;
                if (this.decoder.decodeQueueSize > 3) {
                    await this.event();
                }
                continue;
            }
            // Ya no se manda más: las salidas llegan asíncronas; se esperan un poco antes de vaciar el decodificador
            const before = this.produced;
            if (this.next < units.length && waits < 5) {
                await this.event();
                waits = this.produced > before ? 0 : waits + 1;
                continue;
            }
            // Final del flujo (o el decodificador retiene frames): flush saca lo que falte y después pide una IDR
            await this.decoder.flush();
            await Promise.all([...this.converting]);
            this.needsReset = true;
            if (!this.sink.has(f)) {
                throw new Error('el vídeo no ha dado el frame ' + (f + 1) + ' (' + this.produced + ' frames desde la IDR ' + (this.base + 1) + ')');
            }
        }
    }

    private reset(key: number): void {
        const VideoDecoderCtor = (globalThis as any).VideoDecoder;
        if (!this.decoder || this.decoder.state == 'closed') {
            this.decoder = new VideoDecoderCtor({
                output: (frame: any) => this.onFrame(frame),
                error: (e: any) => {
                    this.error = e ?? new Error('error del decodificador de vídeo');
                    this.notify();
                },
            });
            this.decoder.addEventListener?.('dequeue', () => this.notify());
        } else {
            this.decoder.reset();
        }
        // Con description (MP4: avcC o hvcC), las unidades van con la longitud de cada NAL delante; sin ella, Annex B
        this.decoder.configure({ codec: this.info.codec, codedWidth: this.width, codedHeight: this.height, optimizeForLatency: true,
            ...(this.info.description ? { description: this.info.description } : {}) });
        this.generation++;
        this.next = key;
        this.base = key;
        this.produced = 0;
        this.needsReset = false;
        this.error = null;
    }

    private chunk(index: number, unit: AccessUnit): any {
        const EncodedVideoChunkCtor = (globalThis as any).EncodedVideoChunk;
        return new EncodedVideoChunkCtor({
            type: unit.key || index == this.base ? 'key' : 'delta',
            timestamp: this.generation * VideoStreamDecoder.GENERATION_US + Math.round(index * this.frameMicros),
            data: this.stream.subarray(unit.start, unit.end),
        });
    }

    private onFrame(frame: any): void {
        if (Math.floor(frame.timestamp / VideoStreamDecoder.GENERATION_US) != this.generation) {
            frame.close(); // de antes del último reinicio
            return;
        }
        const index = this.base + this.produced++;
        if (index >= this.frameCount || this.sink.has(index)) {
            frame.close();
            this.notify();
            return;
        }
        const job: Promise<void> = this.toRGB(frame)
            .then((rgb) => {
                if (!this.sink.has(index)) {
                    this.sink.put(index, rgb);
                }
            })
            .catch((e) => { this.error ??= e; })
            .finally(() => {
                frame.close();
                this.converting.delete(job);
                this.notify();
            });
        this.converting.add(job);
    }

    /** VideoFrame → RGB entrelazado del tamaño de la imagen DICOM (Columns x Rows). */
    private async toRGB(frame: any): Promise<Uint8Array> {
        const w = this.width, h = this.height;
        const rect = frame.visibleRect;
        if ((frame.format == 'I420' || frame.format == 'NV12') && rect?.width == w && rect?.height == h && frame.colorSpace?.matrix != 'rgb') {
            try {
                const data = new Uint8Array(frame.allocationSize());
                const layout = await frame.copyTo(data);
                return VideoStreamDecoder.yuv420ToRGB(data, layout, frame.format == 'NV12', w, h, frame.colorSpace);
            } catch { /* frame sin acceso a los planos: se pinta en el canvas */ }
        }
        if (!this.canvas) {
            this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
        }
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(frame, 0, 0, w, h);
        const rgba: Uint8ClampedArray = ctx.getImageData(0, 0, w, h).data;
        const rgb = new Uint8Array(w * h * 3);
        for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
            rgb[i] = rgba[j];
            rgb[i + 1] = rgba[j + 1];
            rgb[i + 2] = rgba[j + 2];
        }
        return rgb;
    }

    /** Espera a que salga un frame, se libere la cola o haya un error (o 200 ms, por si el navegador no avisa). */
    private event(): Promise<void> {
        return new Promise<void>((resolve) => {
            const timer = setTimeout(() => { this.wake = null; resolve(); }, 200);
            this.wake = () => { clearTimeout(timer); this.wake = null; resolve(); };
        });
    }

    private notify(): void {
        this.wake?.();
    }
}
