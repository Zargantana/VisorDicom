/*
 * Worker de decodificación (lo arranca DecodePool; ver decode-pool.ts). Decodifica frames comprimidos fuera del hilo
 * de la interfaz, con los MISMOS decoders que el hilo principal: por cada fichero crea un DCMFileReader con su
 * cabecera (hasta el Pixel Data) y el decoder que le toque (createDecoder). Los bytes del frame llegan transferidos y
 * las muestras decodificadas vuelven transferidas.
 *
 * Es un Worker clásico (no de módulo) para poder usar importScripts: las librerías de src/libs se sirven en
 * assets/libs y los códecs bajo demanda en assets/codecs, todo del mismo origen (CSP script-src 'self').
 */
import { DCMFile } from '../DCM/DCM-file.class';
import { DCMFileReader } from '../DCM/DCM-file-reader.class';
import { BaseDecoder } from './base-decoder-class';
import { CodecLoader, CodecRequiredError } from './codec-loader';
import { DecodeRequest, DecodeResponse, LIBS_BASE_PATH, WORKER_LIBS, WORKER_MAX_FILES } from './decode-protocol';
import { createDecoder, DecoderKind } from './decoder-factory';

const scope: any = self;

interface FileContext {
    reader: DCMFileReader;
    decoders: Map<DecoderKind, BaseDecoder>;
}

/** Decoders por fichero, los últimos WORKER_MAX_FILES usados (la cabecera de un multiframe mejorado puede ocupar MB). */
const files = new Map<number, FileContext>();
const loadedLibs = new Set<string>();

function post(message: DecodeResponse, transfer: Transferable[] = []): void {
    scope.postMessage(message, transfer);
}

function contextFor(request: DecodeRequest): FileContext | null {
    let context = files.get(request.fileId);
    if (context) {
        files.delete(request.fileId); // al final: recién usado
    } else {
        if (request.header === undefined) {
            return null;
        }
        const file = DCMFile.downloadedDCMFile(request.header);
        file.inflated = !!request.inflated;
        file.partial = true;                                   // sin el valor del Pixel Data: llega frame a frame
        context = { reader: new DCMFileReader(file), decoders: new Map() };
    }
    files.set(request.fileId, context);
    for (const oldest of files.keys()) {
        if (files.size <= WORKER_MAX_FILES) {
            break;
        }
        files.delete(oldest);
    }
    return context;
}

/** Librerías de src/libs que pide el decoder. Si no se pueden cargar, el Worker no sirve (fatal). */
function loadLibs(kind: DecoderKind, baseURI: string): void {
    for (const lib of WORKER_LIBS[kind] ?? []) {
        if (!loadedLibs.has(lib)) {
            scope.importScripts(new URL(LIBS_BASE_PATH + lib, baseURI).href);
            loadedLibs.add(lib);
        }
    }
}

/** Lo que se puede transferir sin romper nada: el buffer entero de la vista (si no, se copia antes). */
function transferable(data: any): { data: any; transfer: Transferable[] } {
    if (data instanceof ArrayBuffer) {
        return { data, transfer: [data] };
    }
    if (ArrayBuffer.isView(data)) {
        const view = data as ArrayBufferView & { slice?: () => any };
        const own = view.byteOffset == 0 && view.byteLength == view.buffer.byteLength ? view : (view as any).slice();
        return { data: own, transfer: [own.buffer] };
    }
    return { data, transfer: [] };                              // Array normal: se copia
}

async function decode(request: DecodeRequest): Promise<void> {
    CodecLoader.baseURI ??= request.baseURI;
    try {
        loadLibs(request.kind, request.baseURI);
    } catch (error) {
        post({ type: 'error', id: request.id, fatal: true, message: 'Worker sin librerías: ' + ((error as any)?.message ?? error) });
        return;
    }
    const context = contextFor(request);
    if (!context) {
        post({ type: 'error', id: request.id, needHeader: true, message: 'sin cabecera' });
        return;
    }
    let decoder = context.decoders.get(request.kind);
    if (!decoder) {
        decoder = createDecoder(request.kind, context.reader);
        context.decoders.set(request.kind, decoder);
    }
    const frame = { data: request.bytes, bitOffset: request.bitOffset };
    // Igual que ImageDCM.decodeOne: si el decoder pide un códec bajo demanda, se carga y se reintenta
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const result = transferable(decoder.decodeFrame(frame, request.frame));
            post({ type: 'done', id: request.id, data: result.data, isRGB: decoder.outputIsRGB }, result.transfer);
            return;
        } catch (error) {
            if (error instanceof CodecRequiredError && !CodecLoader.isUnavailable(error.codec)) {
                await CodecLoader.load(error.codec).catch(() => { /* el decoder usará su alternativa */ });
                continue;
            }
            post({ type: 'error', id: request.id, message: (error as any)?.message ?? String(error) });
            return;
        }
    }
    post({ type: 'error', id: request.id, message: 'no se pudo cargar el códec' });
}

scope.addEventListener('message', (event: MessageEvent<DecodeRequest>) => {
    decode(event.data).catch((error) => post({ type: 'error', id: event.data.id, message: String(error?.message ?? error) }));
});
post({ type: 'ready' });
