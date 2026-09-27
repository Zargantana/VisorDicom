import { ElementRef } from "@angular/core";
import { cleanUID, TRANSFER_SYNTAX, TX_Map, TXTranslator } from "src/app/dictionaries/transfer-syntaxes";
import { ColorFactory } from "../Color/color-factory.class";
import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter } from "../DCM/DCM-interpreter.class";
import { FrameBytes, MissingFrameError, PixelDataAccess } from "../DCM/pixel-data-access";
import { BaseDecoder } from "../Decoders/base-decoder-class";
import { CodecLoader, CodecRequiredError } from "../Decoders/codec-loader";
import { SniffedCodec, sniffPixelData } from "../Decoders/codec-sniffer";
import { DecodePool, WorkerUnavailableError } from "../Decoders/decode-pool";
import { createDecoder, DecoderKind, decodesInWorker } from "../Decoders/decoder-factory";
import { FrameCache } from "./frame-cache";

/** Una ventana VOI (0028,1050/1051/1055) tal y como se ofrece en el visor. */
export interface VOIWindowOption {
    center: number;
    width: number;
    explanation: string;
}

/**
 * Imagen DICOM "pintable". Decodifica frame a frame y bajo demanda: pide a PixelDataAccess los bytes del frame (del
 * fichero, por rangos, o de memoria), lo decodifica (si está comprimido, en el pool de Workers DecodePool) y lo guarda
 * en la caché global FrameCache (con presupuesto). En cada pintado convierte a RGBA con la ventana VOI seleccionada.
 * Mientras se ve un multiframe, precarga los frames siguientes para el cine.
 */
export class ImageDCM  {

    public currentFrame: number = 0;
    /** Frames de la imagen (Number of Frames; menos si el fichero resulta tener menos). */
    public frames: number;
    /** Indice de la ventana VOI a aplicar (0 = la primera definida en el fichero). */
    public selectedWindow: number = 0;
    /** Precargar los frames siguientes al pintar (cine). Las miniaturas lo desactivan. */
    public prefetch: boolean = true;
    private decodeFailed: boolean = false;
    private decoder: BaseDecoder | null | undefined = undefined;
    private decoderKind: DecoderKind | null = null;
    private decoderPromise: Promise<BaseDecoder | null> | null = null;
    private pending = new Map<number, Promise<boolean>>();
    private prefetchTarget: number = -1;
    private prefetching: boolean = false;
    private _windows: VOIWindowOption[] | null = null;
    /** Por qué no se puede mostrar la imagen (TS sin soporte, compresión propietaria, error del códec). null si se puede. */
    public unsupportedReason: string | null = null;
    /** Con TS privada o desconocida: el códec reconocido por el contenido del Pixel Data (p. ej. 'JPEG-LS'). */
    public decodedBy: string | null = null;
    private placeholderURL: string | null = null;
    /** Resultado del reconocimiento por contenido (undefined = aún no se ha mirado). */
    private sniffed: SniffedCodec | null | undefined = undefined;
    private readonly access: PixelDataAccess;
    /** Último frame pedido para cada elemento: una decodificación que acaba tarde no pinta encima de otra imagen. */
    private static requested = new WeakMap<HTMLElement, string>();

    constructor(public reader: DCMFileReader) {
        this.frames = Math.max(1, reader.Frames || 1);
        this.access = PixelDataAccess.for(reader);
    }

    private get fileId(): number {
        return this.reader.sourceFile.id;
    }

    /** true si la imagen no se puede decodificar (el motivo está en unsupportedReason). */
    public get failed(): boolean {
        return this.decodeFailed;
    }

    /** Ventanas VOI definidas en el fichero (vacio si no hay Window Center/Width). */
    public get windows(): VOIWindowOption[] {
        if (!this._windows) {
            const voi = new DCMInterpreter(this.reader).getVOIData();
            const count = Math.min(voi.WindowCenter.length, voi.WindowWidth.length);
            this._windows = [];
            for (let i = 0; i < count; i++) {
                this._windows.push({
                    center: voi.WindowCenter[i],
                    width: voi.WindowWidth[i],
                    explanation: voi.WindowDescription[i] ?? ''
                });
            }
        }
        return this._windows;
    }

    public get windowCount(): number {
        return this.windows.length;
    }

    public NextFrame() {
        this.currentFrame = (this.currentFrame + 1) % this.frames;
    }

    public FrameBefore() {
        this.currentFrame = (this.currentFrame - 1 + this.frames) % this.frames;
    }

    /** Índice de frame dentro de [0, frames) (como antes: se da la vuelta). */
    private frameIndex(frame: number): number {
        const n = Math.max(1, this.frames);
        return ((frame % n) + n) % n;
    }

    /** Decoder según la Transfer Syntax; null si la TS no está en la tabla (privada, desconocida o sin decoder). */
    private kindForTS(): DecoderKind | null {
        let txMap: TX_Map = new TX_Map();
        switch (txMap.getClean(this.reader.TransferSyntax)) {
            case TRANSFER_SYNTAX.Explicit_VR_Little_Endian:
            case TRANSFER_SYNTAX.Explicit_VR_Big_Endian:
            case TRANSFER_SYNTAX.Deflated_Explicit_VR_Little_Endian: // ya inflado al leer el fichero (DCMFile)
            case TRANSFER_SYNTAX.Implicit_VR_Endian:
            // Retirada y privadas nativas: Papyrus 3 (Implicit VR LE), GE (Implicit VR LE con píxeles Big Endian,
            // que invierte UncompressedDecoder) y Philips CT-private-ELE (Explicit VR LE)
            case TRANSFER_SYNTAX.Papyrus_3_Implicit_VR_Little_Endian:
            case TRANSFER_SYNTAX.GE_Private_Implicit_VR_LE_Big_Endian_Pixels:
            case TRANSFER_SYNTAX.Philips_Private_CT_Explicit_VR_LE:
                return 'native';
            case TRANSFER_SYNTAX.Encapsulated_Uncompressed_Explicit_VR_Little_Endian:
            case TRANSFER_SYNTAX.PixelMed_Private_Encapsulated_Raw_LE: // la precursora privada de la 1.2.1.98
                return 'encapsulated-raw';
            case TRANSFER_SYNTAX.RLE_Lossless:
                return 'rle';
            case TRANSFER_SYNTAX.JPEG_Baseline_Process_2_4:
            case TRANSFER_SYNTAX.JPEG_Baseline_Process_1:
                return 'jpeg-baseline';
            // Procesos JPEG retirados (aritmetico, progresivo, lossless aritmetico): libjpeg-turbo bajo demanda
            case TRANSFER_SYNTAX.JPEG_Extended_Processes_3_5:
            case TRANSFER_SYNTAX.JPEG_Spectral_Selection_Nonhierarchical_Processes_6_8:
            case TRANSFER_SYNTAX.JPEG_Spectral_Selection_Nonhierarchical_Processes_7_9:
            case TRANSFER_SYNTAX.JPEG_Full_Progression_Nonhierarchical_Processes_10_12:
            case TRANSFER_SYNTAX.JPEG_Full_Progression_Nonhierarchical_Processes_11_13:
            case TRANSFER_SYNTAX.JPEG_Lossless_Nonhierarchical_Processes_15:
                return 'jpeg-retired';
            case TRANSFER_SYNTAX.JPEG_Lossless_Nonhierarchical_First_Order_Prediction_Processes_14_Selection_Value_1:
            case TRANSFER_SYNTAX.JPEG_Lossless_Nonhierarchical_Processes_14:
                return 'jpeg-lossless';
            case TRANSFER_SYNTAX.JPEG_2000_Image_Compression_Lossless_Only:
            case TRANSFER_SYNTAX.JPEG_2000_Image_Compression:
            case TRANSFER_SYNTAX.JPEG_2000_Part_2_Multicomponent_Image_Compression_Lossless_Only:
            case TRANSFER_SYNTAX.JPEG_2000_Part_2_Multicomponent_Image_Compression:
                return 'jpeg2000';
            case TRANSFER_SYNTAX.HTJ2K_Lossless_Only:
            case TRANSFER_SYNTAX.HTJ2K_RPCL_Lossless_Only:
            case TRANSFER_SYNTAX.HTJ2K:
                return 'htj2k';
            case TRANSFER_SYNTAX.JPEG_LS_Lossless_Image_Compression:
            case TRANSFER_SYNTAX.JPEG_LS_Lossy_Near_Lossless_Image_Compression:
                return 'jpeg-ls';
        }
        return null;
    }

    /** El decoder de la imagen (una vez): por TS o, si la TS no está en la tabla, por el contenido del Pixel Data. */
    private ensureDecoder(): Promise<BaseDecoder | null> {
        this.decoderPromise ??= this.resolveDecoder().then((deco) => (this.decoder = deco));
        return this.decoderPromise;
    }

    private async resolveDecoder(): Promise<BaseDecoder | null> {
        const byTS = this.kindForTS();
        if (byTS) {
            this.decoderKind = byTS;
            return createDecoder(byTS, this.reader);
        }
        // TS privada, desconocida o sin decoder: se mira el contenido del Pixel Data (ver codec-sniffer); del
        // encapsulado basta con el primer frame, que se lee solo.
        const uid = cleanUID(this.reader.TransferSyntax);
        const name = this.reader.TransferSyntaxName == 'Unknown TX' ? 'Transfer Syntax desconocida' : this.reader.TransferSyntaxName;
        if (this.sniffed === undefined) {
            let first: Uint8Array | string | null = null;
            const nativeLength = this.access.nativeLength;
            if (this.access.present && nativeLength === null) {
                try {
                    first = (await this.access.getFrame(0, true)).data;
                } catch {
                    first = null;
                }
            }
            this.sniffed = this.access.present ? sniffPixelData(this.reader, nativeLength, first) : null;
            if (this.sniffed) {
                this.decodedBy = this.sniffed.name;
                console.info(name + ' (' + uid + '): el Pixel Data es ' + this.sniffed.name + '; se decodifica como tal.');
            }
        }
        if (this.sniffed) {
            this.decoderKind = this.sniffed.kind;
            return createDecoder(this.sniffed.kind, this.reader);
        }
        this.unsupportedReason = TXTranslator.proprietaryNote(uid) ?? (TXTranslator.isKnown(uid)
            ? 'El visor aún no decodifica esta Transfer Syntax: ' + name + ' (' + uid + ').'
            : 'Transfer Syntax desconocida (' + uid + ') y el Pixel Data no corresponde a ningún códec estándar.');
        console.warn('Transfer Syntax sin decoder: ' + uid + ' (' + name + '). ' + this.unsupportedReason);
        return null;
    }

    /** Marca la imagen como no decodificable (una sola vez) y guarda el motivo para enseñarlo. */
    private fail(error: any) {
        if (this.decodeFailed && this.unsupportedReason) {
            return;
        }
        this.decodeFailed = true;
        const message = (error as any)?.message ?? String(error);
        this.unsupportedReason = 'No se pudo decodificar (' + this.reader.TransferSyntaxName + '): ' + message;
        console.warn('No se pudo decodificar ' + (this.reader.SOPInstanceUID || 'la imagen') +
            ' (' + this.reader.TransferSyntaxName + '): ' + message);
    }

    /** Frames que hay de verdad (en memoria, el troceo de siempre; leyendo por rangos, Number of Frames). */
    private availableFrames(deco: BaseDecoder): number {
        if (this.access.inMemory) {
            return this.access.memoryFrameCount(deco.encapsulated);
        }
        return this.access.present ? this.access.frameCount : 0;
    }

    /** Motivo cuando no hay ningún frame: mapas paramétricos en coma flotante o Pixel Data vacío. */
    private noFramesError(): Error {
        // Mapas paramétricos: Float Pixel Data (7FE0,0008) o Double Float Pixel Data (7FE0,0009) en vez de (7FE0,0010)
        const floatPixels = this.reader.readed_tags.some(t => t.TagHigh == 0x7FE0 && (t.TagLow == 0x0008 || t.TagLow == 0x0009) && t.depth == 0);
        return new Error(floatPixels
            ? 'la imagen usa Float o Double Float Pixel Data (mapa paramétrico en coma flotante), que el visor no soporta'
            : 'el Pixel Data no contiene ningún frame');
    }

    /**
     * Deja decodificado el frame indicado (por defecto el actual): lee sus bytes, carga antes (asíncrono) los códecs
     * bajo demanda que pida el decoder (OpenJPEG, libjpeg-turbo, CharLS) y lo guarda en FrameCache. false si no se puede.
     */
    public prepare(frame: number = this.currentFrame): Promise<boolean> {
        if (this.decodeFailed) {
            return Promise.resolve(false);
        }
        const f = this.frameIndex(frame);
        if (FrameCache.has(this.fileId, f)) {
            return Promise.resolve(true);
        }
        let pending = this.pending.get(f);
        if (!pending) {
            pending = this.decodeOne(f).finally(() => this.pending.delete(f));
            this.pending.set(f, pending);
        }
        return pending;
    }

    private async decodeOne(f: number): Promise<boolean> {
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const deco = await this.ensureDecoder();
                if (!deco) {
                    this.decodeFailed = true; // sin decoder: el motivo ya está en unsupportedReason
                    return false;
                }
                const available = this.availableFrames(deco);
                if (available == 0) {
                    this.fail(this.noFramesError());
                    return false;
                }
                if (this.access.inMemory && available < this.frames) {
                    this.frames = available; // como antes: si hay menos frames, se da la vuelta sobre los que hay
                    f = this.frameIndex(f);
                }
                const bytes = await this.access.getFrame(f, deco.encapsulated);
                const decoded = await this.decodeBytes(deco, bytes, f);
                FrameCache.put(this.fileId, f, decoded.data, decoded.isRGB);
                return true;
            } catch (error) {
                if (error instanceof CodecRequiredError && !CodecLoader.isUnavailable(error.codec)) {
                    try {
                        await CodecLoader.load(error.codec);
                    } catch {
                        // el decoder usará su alternativa (si la tiene) en el siguiente intento
                    }
                    continue;
                }
                if (error instanceof MissingFrameError && f > 0) {
                    // El fichero tiene menos frames de los que dice Number of Frames: se ven los que hay
                    this.frames = Math.min(this.frames, f);
                    return false;
                }
                this.fail(error);
                return false;
            }
        }
        return false;
    }

    /**
     * Decodifica los bytes de un frame: los comprimidos en el pool de Workers (DecodePool), fuera del hilo de la
     * interfaz y varios a la vez; los nativos, o si no hay Workers, aquí mismo.
     */
    private async decodeBytes(deco: BaseDecoder, bytes: FrameBytes, f: number): Promise<{ data: any; isRGB: boolean }> {
        if (this.decoderKind && decodesInWorker(this.decoderKind) && DecodePool.enabled) {
            try {
                return await DecodePool.decode(this.reader.sourceFile, () => this.workerHeader(), this.decoderKind, bytes, f);
            } catch (error) {
                if (!(error instanceof WorkerUnavailableError)) {
                    throw error;
                }
                // Sin Workers (no arrancan: CSP, navegador, ficheros de assets/libs ausentes): en el hilo principal
            }
        }
        return { data: deco.decodeFrame(bytes, f), isRGB: deco.outputIsRGB };
    }

    /** La cabecera (hasta el valor del Pixel Data) que necesita el Worker para crear el mismo decoder. */
    private workerHeader(): string {
        const file = this.reader.sourceFile;
        if (file.partial) {
            return file.rawData;
        }
        const info = this.reader.pixelDataInfo;
        return info ? file.rawData.substring(0, info.valueOffset) : file.rawData;
    }

    /** RGBA (Rows x Columns x 4) del frame indicado con la ventana seleccionada. null si aún no está decodificado. */
    public renderFrameRGBA(frameIndex: number = this.currentFrame): Uint8ClampedArray | null {
        const f = this.frameIndex(frameIndex);
        const decoded = FrameCache.get(this.fileId, f);
        if (!decoded) {
            return null;
        }
        const data = new Uint8ClampedArray(this.reader.Columns * this.reader.Rows * 4);
        for (let i = 3; i < data.length; i += 4) {
            data[i] = 255; // opaco (antes: fillRect negro)
        }
        new ColorFactory(this.reader).pixelDataTo32BitBuffer(data, decoded.data, this.selectedWindow, decoded.isRGB, f);
        return data;
    }

    /**
     * Pinta el frame actual en el <canvas> (o en un <img>, como antes). Si aún no está decodificado lo prepara
     * (asíncrono) y pinta al terminar, salvo que entretanto se haya pedido otro frame u otra imagen para ese elemento.
     *
     * En un <canvas> se pinta con putImageData, sin generar un PNG por frame: con <img> y data: URL el navegador
     * guarda cada imagen decodificada (medido: +277 MB tras 240 frames de cine, frente a +21 MB en canvas).
     */
    public paintImage(imageDisplay: ElementRef<HTMLImageElement | HTMLCanvasElement>) {
        const element = imageDisplay.nativeElement;
        const f = this.frameIndex(this.currentFrame);
        const token = this.fileId + ':' + f;
        ImageDCM.requested.set(element, token);
        const rgba = this.renderFrameRGBA(f);
        if (rgba) {
            if (ImageDCM.isCanvas(element)) {
                this.paintCanvas(rgba, element, token);
            } else {
                this.createImageData(rgba, element as HTMLImageElement);
            }
            this.prefetchAfter(f);
            return;
        }
        if (this.decodeFailed) {
            this.paintUnsupported(element);
            return;
        }
        this.prepare(f).then((ok) => {
            if (ImageDCM.requested.get(element) !== token) {
                return;
            }
            if (ok) {
                this.paintImage(imageDisplay);
            } else if (this.decodeFailed) {
                this.paintUnsupported(element);
            }
        });
    }

    /**
     * Cine: decodifica por detrás los frames que vienen después de `f`, cediendo el hilo entre tanda y tanda. Cuántos,
     * según el presupuesto de la caché y el tamaño del frame (entre 1 y 16). Con el pool de Workers, tantos a la vez
     * como Workers; si no, de uno en uno.
     */
    private prefetchAfter(f: number): void {
        if (!this.prefetch || this.frames <= 1 || this.decodeFailed) {
            return;
        }
        this.prefetchTarget = f;
        if (this.prefetching) {
            return;
        }
        this.prefetching = true;
        const frameBytes = Math.max(1, this.reader.Rows * this.reader.Columns * (this.reader.SamplesPerPixel || 1) *
            Math.max(1, Math.ceil((this.reader.BitsAllocated || 8) / 8)));
        const depth = Math.max(1, Math.min(16, Math.floor(FrameCache.budget / 4 / frameBytes), this.frames - 1));
        (async () => {
            try {
                for (;;) {
                    const parallel = this.decoderKind && decodesInWorker(this.decoderKind) && DecodePool.enabled ? DecodePool.size : 1;
                    const next: number[] = [];
                    for (let k = 1; k <= depth && next.length < parallel; k++) {
                        const candidate = this.frameIndex(this.prefetchTarget + k);
                        if (!FrameCache.has(this.fileId, candidate) && !next.includes(candidate)) {
                            next.push(candidate);
                        }
                    }
                    if (next.length == 0 || !(await Promise.all(next.map((n) => this.prepare(n)))).every(Boolean)) {
                        break;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 0)); // deja pintar entre tanda y tanda
                }
            } finally {
                this.prefetching = false;
            }
        })();
    }

    private static isCanvas(element: HTMLElement): element is HTMLCanvasElement {
        return element.tagName == 'CANVAS';
    }

    /** RGBA al <canvas> (tamaño interno = Columns x Rows; el visor lo escala con CSS). */
    private paintCanvas(rgba: Uint8ClampedArray, canvas: HTMLCanvasElement, token: string): void {
        const cols = this.reader.Columns, rows = this.reader.Rows;
        if (canvas.width != cols || canvas.height != rows) {
            canvas.width = cols;
            canvas.height = rows;
        }
        canvas.getContext('2d')?.putImageData(new ImageData(rgba as any, cols, rows), 0, 0);
        if (canvas.hasAttribute('data-unsupported')) { // el mismo canvas antes enseñó un cartel
            canvas.removeAttribute('data-unsupported');
            canvas.removeAttribute('title');
        }
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'DICOM');
        canvas.setAttribute('data-painted', token); // para las pruebas: qué fichero y frame hay pintado
        canvas.setAttribute('data-paint-count', String(+(canvas.getAttribute('data-paint-count') ?? 0) + 1));
    }

    /**
     * Cartel en lugar de la imagen cuando no se puede decodificar: el motivo (p. ej. "Compresión privada de Sectra…")
     * y la TS. Mismas proporciones que la imagen para no descolocar el visor. En un <canvas> se dibuja en él; en un
     * <img> se genera una vez como PNG y se reutiliza.
     */
    private paintUnsupported(imageDisplay: HTMLImageElement | HTMLCanvasElement): void {
        const reason = this.unsupportedReason ?? 'No se pudo decodificar la imagen.';
        if (ImageDCM.isCanvas(imageDisplay)) {
            this.drawPlaceholder(imageDisplay);
            imageDisplay.removeAttribute('data-painted');
            imageDisplay.title = reason;
            imageDisplay.setAttribute('role', 'img');
            imageDisplay.setAttribute('aria-label', 'Imagen no disponible: ' + reason);
            imageDisplay.setAttribute('data-unsupported', reason);
            return;
        }
        if (!this.placeholderURL && typeof document !== 'undefined') {
            const canvas = document.createElement('canvas');
            this.drawPlaceholder(canvas);
            this.placeholderURL = canvas.toDataURL('image/png');
        }
        if (this.placeholderURL) {
            imageDisplay.src = this.placeholderURL;
            imageDisplay.title = reason;                       // el motivo también al pasar el ratón
            imageDisplay.alt = 'Imagen no disponible: ' + reason;
            imageDisplay.setAttribute('data-unsupported', reason);
        }
    }

    /** Dibuja el cartel en `canvas` (le da el tamaño: el de la imagen, con al menos 640 px de ancho). */
    private drawPlaceholder(canvas: HTMLCanvasElement): void {
        const cols = this.reader.Columns || 512, rows = this.reader.Rows || 512;
        const scale = Math.max(1, 640 / cols);
        canvas.width = Math.round(cols * scale);
        canvas.height = Math.round(rows * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
            const w = canvas.width, h = canvas.height;
            const font = Math.max(12, Math.round(w / 30));
            ctx.fillStyle = '#1b1b1b';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#8a8a8a';
            ctx.lineWidth = 2;
            ctx.strokeRect(1, 1, w - 2, h - 2);
            const lines: [string, string, number][] = [];
            const wrap = (text: string, color: string, size: number) => {
                ctx.font = size + 'px sans-serif';
                let line = '';
                for (const word of text.split(' ')) {
                    const test = line ? line + ' ' + word : word;
                    if (ctx.measureText(test).width > w * 0.86 && line) {
                        lines.push([line, color, size]);
                        line = word;
                    } else {
                        line = test;
                    }
                }
                if (line) {
                    lines.push([line, color, size]);
                }
            };
            wrap('Imagen no disponible', '#ffffff', Math.round(font * 1.3));
            wrap(this.unsupportedReason ?? 'No se pudo decodificar la imagen.', '#e0e0e0', font);
            wrap('Transfer Syntax: ' + cleanUID(this.reader.TransferSyntax), '#9a9a9a', Math.round(font * 0.8));
            const lineHeight = (size: number) => Math.round(size * 1.45);
            let y = (h - lines.reduce((sum, l) => sum + lineHeight(l[2]), 0)) / 2;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            for (const [text, color, size] of lines) {
                ctx.font = size + 'px sans-serif';
                ctx.fillStyle = color;
                ctx.fillText(text, w / 2, y);
                y += lineHeight(size);
            }
        }
    }

    private createImageData(rgba: Uint8ClampedArray, imageDisplay: HTMLImageElement): void {
        var canvas = document.createElement("canvas");
        canvas.width = this.reader.Columns;
        canvas.height = this.reader.Rows;
        var ctx = canvas.getContext("2d");
        if (ctx) {
            const result: ImageData = ctx.createImageData(this.reader.Columns, this.reader.Rows);
            result.data.set(rgba);
            ctx.putImageData(result, 0, 0);
        }
        imageDisplay.src = canvas.toDataURL("image/png");
        if (imageDisplay.hasAttribute('data-unsupported')) { // el mismo <img> antes enseñó un cartel
            imageDisplay.removeAttribute('data-unsupported');
            imageDisplay.removeAttribute('title');
            imageDisplay.removeAttribute('alt');
        }
    }
}
