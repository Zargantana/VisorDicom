/*
 * Punto de entrada del harness de regresion (se empaqueta con esbuild, ver run_harness.mjs).
 * Ejecuta el MISMO codigo del visor (parser, interprete, decoders, color) sin Angular ni canvas.
 */
import { DCMFile } from 'src/app/clases/DCM/DCM-file.class';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { DCMInterpreter } from 'src/app/clases/DCM/DCM-interpreter.class';
import { ImageDCM } from 'src/app/clases/Images/image-DCM.class';
import { ColorFactory } from 'src/app/clases/Color/color-factory.class';

export async function renderBinaryString(bin: string, windowIndex: number = 0) {
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
  };
  try {
    if (typeof image.renderFrameRGBA === 'function') {       // codigo nuevo
      image.selectedWindow = windowIndex;
      const first = image.renderFrameRGBA(0);
      const decoded: number = image.rawFrames?.length ?? 0;
      for (let f = 0; f < decoded; f++) {
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
  return result;
}
