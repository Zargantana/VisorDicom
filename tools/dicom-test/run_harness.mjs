#!/usr/bin/env node
/*
 * Harness de regresion del pipeline DICOM del visor.
 *   1) python3 tools/dicom-test/gen_test_dicoms.py
 *   2) node tools/dicom-test/run_harness.mjs            -> escribe tools/dicom-test/out/render/*.rgba + render.json
 *   3) python3 tools/dicom-test/check_render.py          -> compara con la verdad de pydicom y genera contact sheet
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
// DICOM_TEST_OUT: otra carpeta de entrada/salida (p. ej. out_real, con ficheros reales de real/fetch_real_files.py)
const outDir = process.env.DICOM_TEST_OUT ? path.resolve(process.env.DICOM_TEST_OUT) : path.join(here, 'out');
const renderDir = path.join(outDir, 'render');
fs.mkdirSync(renderDir, { recursive: true });

// Stubs minimos de DOM que usa DCMFile en su constructor.
globalThis.FileReader = class { readAsBinaryString() {} };
globalThis.print = (...a) => console.log(...a); globalThis.printErr = (...a) => console.error(...a); // CharLS (emscripten) en modo "shell"
globalThis.File = class { constructor(parts, name) { this.name = name; this.size = 0; } slice() { return this; } };

// Librerias de codecs que en Angular se cargan como <script> globales (angular.json -> scripts).
for (const lib of ['src/libs/lossless.js',
                   'src/libs/jpeg-baseline.js', 'src/libs/jpeg-ls.js', 'src/libs/jpx.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, lib), 'utf8'), { filename: lib });
}
// Códecs bajo demanda (src/assets/codecs): en el navegador los carga CodecLoader con un <script>; aquí se registra
// el mismo global (factoría emscripten) para que CodecLoader lo encuentre sin DOM.
{
  const { createRequire } = await import('node:module');
  const requireFromRoot = createRequire(path.join(root, 'package.json'));
  for (const [file, globalName] of [['openjpegjs_decode.js', 'OpenJPEGJS'], ['libjpegturbojs_decode.js', 'libjpegturbojs_decode'], ['libjpegturbo12js.js', 'libjpegturbo12js'], ['charlsjs_decode.js', 'CharLS']]) {
    const codec = path.join(root, 'src/assets/codecs', file);
    if (fs.existsSync(codec)) globalThis[globalName] = requireFromRoot(codec);
  }
}

const bundle = path.join(renderDir, 'harness.bundle.cjs');
await build({
  entryPoints: [path.join(here, 'harness-entry.ts')], bundle: true, platform: 'node', format: 'cjs',
  outfile: bundle, logLevel: 'error', tsconfig: path.join(root, 'tsconfig.json'),
  external: ['@angular/core'],
});
const { createRequire } = await import('node:module');
const { renderBinaryString } = createRequire(import.meta.url)(bundle);

const summary = {};
// DICOM_TEST_FILTER: expresión regular para procesar solo algunos ficheros; DICOM_TEST_VERBOSE=1 avisa por stderr
// antes de cada fichero (para saber cuál revienta si el proceso se queda sin memoria)
const filter = process.env.DICOM_TEST_FILTER ? new RegExp(process.env.DICOM_TEST_FILTER) : null;
// DICOM_TEST_MANIFEST: JSON {clave: {path}} (real/scan_corpus.py) para procesar ficheros de cualquier carpeta sin
// copiarlos; las salidas llevan la clave. DICOM_TEST_MAX_MB (480): los mayores se marcan como el visor (tope del
// string del navegador) sin leerlos. DICOM_TEST_MAX_FRAMES_OUT (0 = todos): en multiframes grandes solo se
// renderizan y guardan el primer frame, el central y el último (writtenFrames). DICOM_TEST_MAX_WINDOWS (3).
const manifest = process.env.DICOM_TEST_MANIFEST ? JSON.parse(fs.readFileSync(process.env.DICOM_TEST_MANIFEST, 'utf8')) : null;
const entries = manifest
  ? Object.entries(manifest).filter(([k]) => !filter || filter.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ name: k, file: v.path ?? v, frames: v.frames, modality: v.modality }))
  : fs.readdirSync(outDir).filter(f => f.endsWith('.dcm') && (!filter || filter.test(f))).sort().map(f => ({ name: f, file: path.join(outDir, f) }));
const maxMB = +(process.env.DICOM_TEST_MAX_MB || 480);
const maxFramesOut = +(process.env.DICOM_TEST_MAX_FRAMES_OUT || 0);
// DICOM_TEST_SKIP_MULTIFRAME="frames,MB": los multiframes con MÁS frames y MÁS MB que eso (láminas de patología por
// tiles: miles de frames JPEG) se marcan como fuera del alcance sin decodificarlos; el visor decodifica todos los
// frames de golpe y con ellos tarda minutos. Solo con manifiesto (el número de frames sale del inventario).
const skipMultiframe = (process.env.DICOM_TEST_SKIP_MULTIFRAME || '').split(',').map(Number);
const skipFrames = skipMultiframe.length === 2 && skipMultiframe.every(n => n > 0) ? skipMultiframe : null;
// DICOM_TEST_SKIP_SM_FRAMES=N: microscopía (modalidad SM, láminas completas) con más de N frames también es TILES,
// sea cual sea el tamaño: sus tiles J2K de 2k×2k tardan segundos cada uno.
const skipSmFrames = +(process.env.DICOM_TEST_SKIP_SM_FRAMES || 0);
const maxWindows = Math.max(1, Math.min(3, +(process.env.DICOM_TEST_MAX_WINDOWS || 3)));
// DICOM_TEST_RESUME=1: conserva render.json y salta las claves ya hechas (real/run_corpus.py relanza el harness si un
// fichero tumba el proceso). render/inprogress.txt dice qué clave se estaba procesando.
const summaryPath = path.join(renderDir, 'render.json');
const inProgress = path.join(renderDir, 'inprogress.txt');
if (process.env.DICOM_TEST_RESUME && fs.existsSync(summaryPath)) Object.assign(summary, JSON.parse(fs.readFileSync(summaryPath, 'utf8')));
const done = new Set(Object.keys(summary).map(k => k.split('#w')[0]));
const t0 = Date.now();
let sinceFlush = 0;
for (const { name: f, file, frames, modality } of entries) {
  if (done.has(f)) continue;
  if (process.env.DICOM_TEST_VERBOSE) console.error(`> ${f}`);
  if (manifest) fs.writeFileSync(inProgress, f);
  if (manifest && ++sinceFlush >= 10) { fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 1)); sinceFlush = 0; }
  const mb = fs.statSync(file).size / 1048576;
  if ((skipFrames && frames > skipFrames[0] && mb > skipFrames[1]) || (skipSmFrames && modality === 'SM' && frames > skipSmFrames)) {
    summary[f] = { frames, decodedFrames: 0, windows: 0, skippedTiles: true,
                   unsupportedReason: `multiframe de ${frames} frames y ${Math.round(mb)} MB (lámina por tiles): fuera del alcance de esta versión del visor, que decodifica todos los frames de golpe` };
    continue;
  }
  if (mb > maxMB) {
    summary[f] = { frames: undefined, decodedFrames: 0, windows: 0,
                   unsupportedReason: `fichero de ${Math.round(mb)} MB: supera el tope de ${maxMB} MB por fichero de esta versión del visor (string del navegador)`,
                   skippedBig: true };
    continue;
  }
  const bin = fs.readFileSync(file).toString('latin1');
  const variants = [0, 1, 2].slice(0, maxWindows);
  for (const w of variants) {
    let r;
    const tf = Date.now();
    try { r = await renderBinaryString(bin, w, maxFramesOut); }
    catch (e) { r = { error: 'THROW ' + (e?.message ?? e), rgba: [], written: [] }; }
    if (w > 0 && !(r.windows > w)) continue; // solo renderizamos ventanas que existen
    const key = w === 0 ? f : `${f}#w${w}`;
    summary[key] = { rows: r.rows, cols: r.cols, frames: r.frames, ts: r.ts, tsName: r.tsName,
                     windows: r.windows, windowCount: r.windowCount, decodedFrames: r.decoded ?? r.rgba.length, error: r.error,
                     unsupportedReason: r.unsupportedReason, decodedBy: r.decodedBy, ms: Date.now() - tf };
    if (r.written) summary[key].writtenFrames = r.written;
    r.rgba.forEach((buf, i) => fs.writeFileSync(path.join(renderDir, `${key}.f${r.written ? r.written[i] : i}.rgba`), Buffer.from(buf.buffer)));
  }
}
if (manifest) console.error(`harness: ${entries.length} ficheros en ${Math.round((Date.now() - t0) / 1000)} s`);
if (fs.existsSync(inProgress)) fs.unlinkSync(inProgress);
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 1));
for (const [k, v] of Object.entries(summary)) {
  console.log(`${k.padEnd(38)} ${String(v.rows)}x${String(v.cols)} fr=${v.frames} dec=${v.decodedFrames} win=${v.windows} ${v.decodedBy ? '[' + v.decodedBy + '] ' : ''}${v.error ? 'ERR ' + v.error : ''}`);
}
