/*
 * Punto de entrada del harness de regresion (se empaqueta con esbuild, ver run_harness.mjs).
 * Ejecuta el MISMO codigo del visor (parser, interprete, decoders, color) sin Angular ni canvas.
 */
import { DCMFile, FILEREAD_STATUS } from 'src/app/clases/DCM/DCM-file.class';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { DCMInterpreter } from 'src/app/clases/DCM/DCM-interpreter.class';
import { ImageDCM } from 'src/app/clases/Images/image-DCM.class';

/**
 * Renderiza un DICOM con el MISMO camino que el navegador: el fichero entra como Blob (en Node, fs.openAsBlob) y
 * DCMFile lee la cabecera por bloques y el Pixel Data por rangos (DCMFile.partial). Con `bin` (string binario) se
 * usa el camino en memoria de los ficheros descargados del portal.
 *
 * @param maxFramesOut 0 = renderiza todos los frames; N > 0 = solo el primero, el central y el último (hasta N), para
 *   multiframes grandes (tomosíntesis, cine largos): se decodifican SOLO esos. `decoded` es el total de frames.
 */
export async function renderDicom(input: { blob?: Blob; name?: string; bin?: string; headerChunk?: number },
                                  windowIndex: number = 0, maxFramesOut: number = 0) {
  let file: DCMFile;
  if (input.headerChunk) {
    DCMFile.headerChunkBytes = input.headerChunk;              // bloque pequeño: fuerza la lectura por rangos
  }
  if (input.blob) {
    file = new DCMFile(new File([input.blob], input.name ?? 'fichero.dcm'));
    await file.load();
  } else {
    file = DCMFile.downloadedDCMFile(input.bin ?? '');
    await file.inflateIfDeflated();
  }
  if (file.readStatus == FILEREAD_STATUS.ERROR) {
    return { rgba: [], decoded: 0, error: undefined, unsupportedReason: file.readError, readFailed: true };
  }
  const reader = new DCMFileReader(file);
  const image = new ImageDCM(reader);
  const voi = new DCMInterpreter(reader).getVOIData();
  const result: any = {
    rows: reader.Rows, cols: reader.Columns, frames: reader.Frames,
    ts: reader.TransferSyntax.replace(/\0/g, '').trim(), tsName: reader.TransferSyntaxName,
    windows: Math.min(voi.WindowCenter.length, voi.WindowWidth.length),
    windowCount: image.windowCount,
    rgba: [] as Uint8ClampedArray[], error: undefined as string | undefined,
    decoded: 0, written: undefined as number[] | undefined, partial: file.partial,
    // ¿Lo reconoce el cargador como DICOM? (con preámbulo o, sin él, un dataset que se deja leer)
    isDicom: input.bin !== undefined ? DCMFile.datasetOffset(input.bin) !== null : !!file.isDCM,
    noFileMeta: reader.noFileMeta,
    // Textos que enseña el visor, ya decodificados con (0008,0005): check_render.py los compara con pydicom
    text: {
      PatientName: reader.PatientName, PatientID: reader.PatientId,
      StudyDescription: reader.StudyDescription, SeriesDescription: reader.SeriesDescription,
      charset: reader.SpecificCharacterSet.join('\\'),
    },
  };
  try {
    image.selectedWindow = windowIndex;
    await image.prepare(0);                                   // decoder, códecs bajo demanda y primer frame
    let selected: number[] | null = null;
    if (maxFramesOut > 0 && image.frames > maxFramesOut) {
      selected = [...new Set([0, Math.floor(image.frames / 2), image.frames - 1])].slice(0, maxFramesOut);
      result.written = selected;
    }
    const wanted = selected ?? Array.from({ length: image.frames }, (_, f) => f);
    for (const f of wanted) {
      if (f >= image.frames) break;                           // el fichero tenía menos frames de los que decía
      if (!(await image.prepare(f))) break;
      const rgba = image.renderFrameRGBA(f);
      if (rgba) result.rgba.push(rgba);
    }
    if (image.failed) {
      result.rgba = [];                                       // como antes: si un frame falla, la imagen no se ve
      result.written = undefined;
    }
    result.decoded = image.failed ? 0 : (selected ? image.frames : result.rgba.length);
  } catch (e: any) {
    result.error = String(e?.message ?? e);
  }
  result.unsupportedReason = image.unsupportedReason ?? undefined; // por qué no se puede mostrar (si no se puede)
  result.decodedBy = image.decodedBy ?? undefined;                 // códec reconocido por contenido (TS privadas)
  return result;
}

/** Compatibilidad: el camino en memoria con un string binario. */
export function renderBinaryString(bin: string, windowIndex: number = 0, maxFramesOut: number = 0) {
  return renderDicom({ bin }, windowIndex, maxFramesOut);
}
