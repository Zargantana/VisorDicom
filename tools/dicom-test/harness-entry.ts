/*
 * Punto de entrada del harness de regresion (se empaqueta con esbuild, ver run_harness.mjs).
 * Ejecuta el MISMO codigo del visor (parser, interprete, decoders, color) sin Angular ni canvas.
 */
import { DCMFile } from 'src/app/clases/DCM/DCM-file.class';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { DCMInterpreter } from 'src/app/clases/DCM/DCM-interpreter.class';
import { ImageDCM } from 'src/app/clases/Images/image-DCM.class';
import { ColorFactory } from 'src/app/clases/Color/color-factory.class';

/**
 * @param maxFramesOut 0 = renderiza todos los frames; N > 0 = solo el primero, el central y el último (hasta N), para
 *   multiframes grandes (tomosíntesis, cine largos) sin escribir gigas de RGBA. `decoded` es el total decodificado.
 */
export async function renderBinaryString(bin: string, windowIndex: number = 0, maxFramesOut: number = 0) {
  const file = DCMFile.downloadedDCMFile(bin);
  const anyFile = file as any;
  if (typeof anyFile.inflateIfDeflated === 'function') {
    await anyFile.inflateIfDeflated();
  }
  const reader = new DCMFileReader(file);
  const image = new ImageDCM(reader) as any;
  const voi = new DCMInterpreter(reader).getVOIData();
  const result: any = {
    rows: reader.Rows, cols: reader.Columns, frames: reader.Frames,
    ts: reader.TransferSyntax.replace(/\0/g, '').trim(), tsName: reader.TransferSyntaxName,
    windows: Math.min(voi.WindowCenter.length, voi.WindowWidth.length),
    windowCount: typeof image.windowCount === 'number' ? image.windowCount : undefined,
    rgba: [] as Uint8ClampedArray[], error: undefined as string | undefined,
    decoded: 0, written: undefined as number[] | undefined,
  };
  try {
    if (typeof image.renderFrameRGBA === 'function') {       // codigo nuevo
      image.selectedWindow = windowIndex;
      if (typeof image.prepare === 'function') {
        await image.prepare();                                  // carga códecs bajo demanda si hacen falta
      }
      const first = image.renderFrameRGBA(0);
      const decoded: number = image.rawFrames?.length ?? 0;
      result.decoded = decoded;
      let selected: number[] | null = null;
      if (maxFramesOut > 0 && decoded > maxFramesOut) {
        selected = [...new Set([0, Math.floor(decoded / 2), decoded - 1])].slice(0, maxFramesOut);
        result.written = selected;
      }
      for (let f = 0; f < decoded; f++) {
        if (selected && !selected.includes(f)) continue;
        result.rgba.push(f == 0 ? first : image.renderFrameRGBA(f));
      }
    } else {                                                  // codigo original (linea base)
      image.preloadImageFrames();
      const raw: any[] = image.rawFrames ?? [];
      for (let f = 0; f < raw.length; f++) {
        const data = new Uint8ClampedArray(reader.Rows * reader.Columns * 4);
        for (let i = 3; i < data.length; i += 4) data[i] = 255;
        new ColorFactory(reader).pixelDataTo32BitBuffer(data, raw[f], windowIndex);
        result.rgba.push(data);
      }
    }
  } catch (e: any) {
    result.error = String(e?.message ?? e);
  }
  result.unsupportedReason = image.unsupportedReason ?? undefined; // por qué no se puede mostrar (si no se puede)
  result.decodedBy = image.decodedBy ?? undefined;                 // códec reconocido por contenido (TS privadas)
  return result;
}
