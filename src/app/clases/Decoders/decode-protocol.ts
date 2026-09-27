import { DecoderKind } from "./decoder-factory";

/**
 * Mensajes entre el hilo principal (DecodePool) y el Worker de decodificación (decode.worker.ts). Solo tipos y
 * constantes: el Worker no puede importar decode-pool.ts (crearía otro Worker dentro).
 */

/** Hilo principal -> Worker: decodifica un frame. */
export interface DecodeRequest {
    id: number;
    /** DCMFile.id: el Worker guarda un decoder por fichero. */
    fileId: number;
    /** Cabecera del fichero hasta el valor del Pixel Data; solo la primera vez (o si el Worker la pide). */
    header?: string;
    /** El dataset venía deflated y la cabecera ya está inflada (DCMFile.inflated). */
    inflated?: boolean;
    kind: DecoderKind;
    frame: number;
    /** Bitstream (encapsulado) o bytes del frame; se transfiere (no se copia). */
    bytes: Uint8Array;
    bitOffset: number;
    /** document.baseURI del visor: de ahí salen las rutas de assets/libs y assets/codecs. */
    baseURI: string;
}

/** Worker -> hilo principal. */
export type DecodeResponse =
    | { type: 'ready' }
    | { type: 'done'; id: number; data: any; isRGB: boolean }
    /** needHeader: el Worker ya no tiene el decoder de ese fichero; hay que repetir con la cabecera. */
    | { type: 'error'; id: number; message: string; needHeader?: boolean; fatal?: boolean };

/**
 * Librerías de src/libs (en el visor van en scripts.js, que el Worker no tiene) que necesita cada decoder. angular.json
 * las copia a assets/libs; el Worker las carga con importScripts la primera vez.
 */
export const WORKER_LIBS: Partial<Record<DecoderKind, string[]>> = {
    'jpeg-baseline': ['jpeg-baseline.js'],
    'jpeg-retired': ['jpeg-baseline.js'],
    'jpeg-lossless': ['lossless.js'],
    'jpeg-ls': ['jpeg-ls.js'],
    'jpeg2000': ['jpx.js'],
};

export const LIBS_BASE_PATH = 'assets/libs/';

/** Ficheros (cabecera + decoders) que guarda cada Worker, los últimos usados. DecodePool lleva la misma cuenta. */
export const WORKER_MAX_FILES = 16;
