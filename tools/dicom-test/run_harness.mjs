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
const outDir = path.join(here, 'out');
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
  for (const [file, globalName] of [['openjpegjs_decode.js', 'OpenJPEGJS'], ['libjpegturbojs_decode.js', 'libjpegturbojs_decode']]) {
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
const files = fs.readdirSync(outDir).filter(f => f.endsWith('.dcm')).sort();
for (const f of files) {
  const bin = fs.readFileSync(path.join(outDir, f)).toString('latin1');
  const variants = [0, 1, 2];
  for (const w of variants) {
    let r;
    try { r = await renderBinaryString(bin, w); }
    catch (e) { r = { error: 'THROW ' + (e?.message ?? e), rgba: [] }; }
    if (w > 0 && !(r.windows > w)) continue; // solo renderizamos ventanas que existen
    const key = w === 0 ? f : `${f}#w${w}`;
    summary[key] = { rows: r.rows, cols: r.cols, frames: r.frames, ts: r.ts, tsName: r.tsName,
                     windows: r.windows, windowCount: r.windowCount, decodedFrames: r.rgba.length, error: r.error };
    r.rgba.forEach((buf, k) => fs.writeFileSync(path.join(renderDir, `${key}.f${k}.rgba`), Buffer.from(buf.buffer)));
  }
}
fs.writeFileSync(path.join(renderDir, 'render.json'), JSON.stringify(summary, null, 1));
for (const [k, v] of Object.entries(summary)) {
  console.log(`${k.padEnd(38)} ${String(v.rows)}x${String(v.cols)} fr=${v.frames} dec=${v.decodedFrames} win=${v.windows} ${v.error ? 'ERR ' + v.error : ''}`);
}
