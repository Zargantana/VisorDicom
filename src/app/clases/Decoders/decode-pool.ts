import { DCMFile } from "../DCM/DCM-file.class";
import { FrameBytes } from "../DCM/pixel-data-access";
import { DecodeRequest, DecodeResponse, WORKER_MAX_FILES } from "./decode-protocol";
import { DecoderKind } from "./decoder-factory";

/** Los Workers no están disponibles (no arrancan, no hay Worker o no cargan sus librerías): decodificar aquí. */
export class WorkerUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WorkerUnavailableError';
    }
}

interface Pending {
    request: DecodeRequest;
    header: () => string;
    resolve: (value: { data: any; isRGB: boolean }) => void;
    reject: (error: Error) => void;
}

class PoolWorker {
    public ready = false;
    public inFlight = new Map<number, Pending>();
    /**
     * Ficheros cuya cabecera tiene, en el mismo orden LRU que el Worker (los mensajes se procesan en orden de
     * envío): así se sabe cuándo hay que volver a mandarla sin preguntar.
     */
    public files = new Set<number>();

    public touch(fileId: number): boolean {
        const known = this.files.delete(fileId);
        this.files.add(fileId);
        for (const oldest of this.files) {
            if (this.files.size <= WORKER_MAX_FILES) {
                break;
            }
            this.files.delete(oldest);
        }
        return known;
    }

    constructor(public worker: Worker) { }
}

/**
 * Pool de Workers de decodificación (decode.worker.ts). Los frames comprimidos (JPEG, JPEG-LS, JPEG 2000, HTJ2K,
 * RLE) se decodifican fuera del hilo de la interfaz y varios a la vez: la interfaz no se congela con un J2K de medio
 * segundo por corte y el cine de un JPEG de 1024x1024 no queda limitado por un solo núcleo.
 *
 * Si los Workers no arrancan (navegador sin Worker, CSP sin worker-src, falta assets/libs), el pool se desactiva y
 * ImageDCM decodifica en el hilo principal como antes. En Node (harness) no hay Worker: siempre en el hilo principal.
 */
export class DecodePool {
    /** false: todo en el hilo principal. */
    public static enabled: boolean = typeof Worker !== 'undefined' && typeof document !== 'undefined';
    /** Workers: núcleos - 1, entre 1 y 4; 2 en móvil (cada uno lleva sus códecs, con su propia memoria). */
    public static size: number = DecodePool.defaultSize();
    /** Sin trabajo durante este tiempo, se cierran los Workers y se libera su memoria. */
    public static idleMs: number = 60000;

    private static workers: PoolWorker[] = [];
    private static nextId = 1;
    private static idleTimer: any = null;

    private static defaultSize(): number {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        const cores = nav?.hardwareConcurrency || 2;
        const mobile = !!nav && /iPhone|iPad|iPod|Android/i.test(nav.userAgent ?? '');
        return Math.max(1, Math.min(mobile ? 2 : 4, cores - 1));
    }

    /**
     * Decodifica un frame en un Worker. Rechaza con WorkerUnavailableError si no hay Workers (entonces hay que
     * decodificar en el hilo principal) o con el Error del decoder si el frame no se puede decodificar.
     */
    public static decode(file: DCMFile, header: () => string, kind: DecoderKind, frame: FrameBytes, index: number): Promise<{ data: any; isRGB: boolean }> {
        if (!DecodePool.enabled) {
            return Promise.reject(new WorkerUnavailableError('pool desactivado'));
        }
        let target: PoolWorker;
        try {
            target = DecodePool.pick(file.id);
        } catch (error) {
            DecodePool.disable('no arranca: ' + ((error as any)?.message ?? error));
            return Promise.reject(new WorkerUnavailableError('no arranca'));
        }
        // Una copia propia de los bytes (se transfiere: el original puede ser una vista de otro buffer en uso)
        const bytes = typeof frame.data === 'string' ? DecodePool.stringToBytes(frame.data) : frame.data.slice();
        const request: DecodeRequest = {
            id: DecodePool.nextId++, fileId: file.id, inflated: file.inflated, kind, frame: index, bytes,
            bitOffset: frame.bitOffset, baseURI: document.baseURI,
        };
        return new Promise((resolve, reject) => {
            DecodePool.send(target, { request, header, resolve, reject });
        });
    }

    /** Workers vivos (para las pruebas y la pantalla de información). */
    public static get running(): number {
        return DecodePool.workers.length;
    }

    /** El Worker con menos trabajo; a igualdad, el que ya tiene la cabecera del fichero. Crea Workers hasta `size`. */
    private static pick(fileId: number): PoolWorker {
        const idle = DecodePool.workers.find((w) => w.inFlight.size == 0);
        if (!idle && DecodePool.workers.length < DecodePool.size) {
            return DecodePool.spawn();
        }
        let best = DecodePool.workers[0];
        for (const w of DecodePool.workers) {
            const load = w.inFlight.size - (w.files.has(fileId) ? 0.5 : 0);
            const bestLoad = best.inFlight.size - (best.files.has(fileId) ? 0.5 : 0);
            if (load < bestLoad) {
                best = w;
            }
        }
        return best;
    }

    private static spawn(): PoolWorker {
        // Worker clásico (sin type: 'module'): usa importScripts para las librerías y los códecs
        const pw = new PoolWorker(new Worker(new URL('./decode.worker', import.meta.url)));
        pw.worker.onmessage = (event: MessageEvent<DecodeResponse>) => DecodePool.onMessage(pw, event.data);
        pw.worker.onerror = (event: ErrorEvent) => {
            event.preventDefault?.();
            DecodePool.onWorkerError(pw, event.message || 'error del Worker');
        };
        DecodePool.workers.push(pw);
        return pw;
    }

    private static send(target: PoolWorker, pending: Pending): void {
        clearTimeout(DecodePool.idleTimer);
        const request = pending.request;
        if (!target.touch(request.fileId)) {
            request.header = pending.header();
        }
        target.inFlight.set(request.id, pending);
        target.worker.postMessage(request, [request.bytes.buffer]);
    }

    private static onMessage(pw: PoolWorker, message: DecodeResponse): void {
        if (message.type == 'ready') {
            pw.ready = true;
            return;
        }
        const pending = pw.inFlight.get(message.id);
        if (!pending) {
            return;
        }
        pw.inFlight.delete(message.id);
        if (message.type == 'done') {
            pending.resolve({ data: message.data, isRGB: message.isRGB });
        } else if (message.needHeader) {
            // No debería pasar (el LRU de files es el del Worker). Los bytes ya se transfirieron: este frame, aquí.
            pw.files.delete(pending.request.fileId);
            pending.reject(new WorkerUnavailableError('el Worker no tenía la cabecera'));
        } else if (message.fatal) {
            DecodePool.disable(message.message);
            pending.reject(new WorkerUnavailableError(message.message));
        } else {
            pending.reject(new Error(message.message));
        }
        DecodePool.armIdleTimer();
    }

    /**
     * Error de un Worker. Antes de 'ready' es que no arranca (script no encontrado, CSP): se desactiva el pool y todo
     * vuelve al hilo principal. Después, ha caído decodificando (p. ej. sin memoria): sus frames fallan con ese motivo
     * y se quita del pool (se creará otro si hace falta).
     */
    private static onWorkerError(pw: PoolWorker, message: string): void {
        if (!pw.ready) {
            DecodePool.disable('no arranca: ' + message);
            return;
        }
        DecodePool.remove(pw);
        for (const pending of pw.inFlight.values()) {
            pending.reject(new Error('el decodificador (Worker) ha fallado: ' + message));
        }
        pw.inFlight.clear();
    }

    private static disable(reason: string): void {
        if (DecodePool.enabled) {
            console.warn('Decodificación en el hilo principal (sin Workers): ' + reason);
        }
        DecodePool.enabled = false;
        for (const pw of [...DecodePool.workers]) {
            DecodePool.remove(pw);
            for (const pending of pw.inFlight.values()) {
                pending.reject(new WorkerUnavailableError(reason));
            }
            pw.inFlight.clear();
        }
    }

    private static remove(pw: PoolWorker): void {
        pw.worker.terminate();
        DecodePool.workers = DecodePool.workers.filter((w) => w !== pw);
    }

    private static armIdleTimer(): void {
        if (DecodePool.workers.some((w) => w.inFlight.size > 0)) {
            return;
        }
        clearTimeout(DecodePool.idleTimer);
        DecodePool.idleTimer = setTimeout(() => {
            if (DecodePool.workers.every((w) => w.inFlight.size == 0)) {
                for (const pw of [...DecodePool.workers]) {
                    DecodePool.remove(pw);
                }
            }
        }, DecodePool.idleMs);
    }

    private static stringToBytes(value: string): Uint8Array {
        const bytes = new Uint8Array(value.length);
        for (let i = 0; i < value.length; i++) {
            bytes[i] = value.charCodeAt(i);
        }
        return bytes;
    }
}
