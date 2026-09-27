import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { BaseDecoder } from "./base-decoder-class";
import { EncapsulatedUncompressedDecoder } from "./Encapsulated-Uncompressed-decoder.class";
import { JPEG2000Decoder } from "./JPEG-2000-decoder.class";
import { JPEGBaselineDecoder, JPEGRetiredProcessesDecoder } from "./JPEG-Baseline-decoder.class";
import { JPEGLosslessDecoder } from "./JPEG-Lossless-decoder.class";
import { JPEGLSDecoder } from "./JPEG-LS-decoder.class";
import { RLEDecoder } from "./RLE-decoder.class";
import { UncompressedDecoder } from "./Uncompressed-decoder.class";

/**
 * Qué decoder usa una imagen. Es lo que viaja al Worker de decodificación (decode.worker.ts) para que cree allí el
 * mismo decoder que en el hilo principal (las clases no se pueden mandar en un postMessage).
 */
export type DecoderKind = 'native' | 'encapsulated-raw' | 'rle' | 'jpeg-baseline' | 'jpeg-retired' | 'jpeg-lossless' |
    'jpeg-ls' | 'jpeg2000' | 'htj2k';

export function createDecoder(kind: DecoderKind, reader: DCMFileReader): BaseDecoder {
    switch (kind) {
        case 'native': return new UncompressedDecoder(reader);
        case 'encapsulated-raw': return new EncapsulatedUncompressedDecoder(reader);
        case 'rle': return new RLEDecoder(reader);
        case 'jpeg-baseline': return new JPEGBaselineDecoder(reader);
        case 'jpeg-retired': return new JPEGRetiredProcessesDecoder(reader);
        case 'jpeg-lossless': return new JPEGLosslessDecoder(reader);
        case 'jpeg-ls': return new JPEGLSDecoder(reader);
        case 'jpeg2000': return new JPEG2000Decoder(reader);
        case 'htj2k': return new JPEG2000Decoder(reader, true);
    }
}

/** Decoders que van al Worker: los de compresión. Los nativos solo copian bytes; mandarlos costaría más. */
export function decodesInWorker(kind: DecoderKind): boolean {
    return kind != 'native' && kind != 'encapsulated-raw';
}
