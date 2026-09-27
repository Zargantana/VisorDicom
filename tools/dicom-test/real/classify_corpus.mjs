#!/usr/bin/env node
/*
 * Clasifica una carpeta (CD) con el código del visor en Node y lo compara con pydicom (expected_tree.py).
 *   node tools/dicom-test/real/classify_corpus.mjs <carpeta> [--python <python con pydicom>]
 * Solo entran los ficheros que reconoce el cargador del visor (con preámbulo "DICM" o sin él: DCMFile.datasetOffset).
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const args = process.argv.slice(2);
const pyIdx = args.indexOf('--python');
const python = pyIdx >= 0 ? args.splice(pyIdx, 2)[1] : 'python';
const folder = path.resolve(args[0]);

globalThis.FileReader = class { readAsBinaryString() {} };
globalThis.File = class { constructor(parts, name) { this.name = name; this.size = 0; } slice() { return this; } };
globalThis.print = () => {}; globalThis.printErr = () => {};
for (const lib of ['src/libs/lossless.js', 'src/libs/jpeg-baseline.js', 'src/libs/jpeg-ls.js', 'src/libs/jpx.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, lib), 'utf8'), { filename: lib });
}
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const bundle = path.join(root, 'tools', 'dicom-test', 'out', 'classify.bundle.cjs');
fs.mkdirSync(path.dirname(bundle), { recursive: true });
await build({ entryPoints: [path.join(here, 'classify-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle,
  logLevel: 'error', tsconfig: path.join(root, 'tsconfig.json'), external: ['@angular/core'] });
const { classifyAll, isDicomHead } = createRequire(import.meta.url)(bundle);

const files = [];
// render/, ref/ y big/ son salidas del harness (out/): no forman parte de un "CD"
const SKIP_DIRS = new Set(['render', 'ref', 'big']);
const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); } else files.push(p); } };
walk(folder);
const dicom = [];
for (const p of files.sort()) {
  const fd = fs.openSync(p, 'r'); const head = Buffer.alloc(2048); const n = fs.readSync(fd, head, 0, 2048, 0); fs.closeSync(fd);
  if (isDicomHead(head.toString('latin1', 0, n))) dicom.push({ name: path.relative(folder, p), bin: fs.readFileSync(p).toString('latin1') });
}
const t0 = Date.now();
const r = await classifyAll(dicom);
const expected = JSON.parse(execFileSync(python, [path.join(here, 'expected_tree.py'), folder], { maxBuffer: 1 << 26 }).toString());
console.log(`visor : ${dicom.length} DICOM · ${r.patients} pacientes · ${r.studies} estudios · ${r.modalities} modalidades · ${r.series} series · ${r.images} imágenes (${Date.now() - t0} ms)`);
console.log(`pydicom: ${expected.dicomFound} DICOM · ${expected.patients} pacientes · ${expected.studies} estudios · ${expected.modalities} modalidades · ${expected.series} series · ${expected.images} imágenes`);
console.log('pacientes del visor:', r.patientIds);
if (r.skipped.length) console.log(`sin tags (el lector no leyó nada): ${r.skipped.length}: ${r.skipped.slice(0, 5).join(', ')}`);
if (r.empty.length) console.log('ramas vacías:', r.empty.slice(0, 10).join(' | '));
if (r.branchZeroError) console.log('SeriesBranchZero lanza:', r.branchZeroError);
for (const e of r.errors.slice(0, 20)) console.log(`ERROR ${e.name}: ${e.error}`);
const ok = r.patients === expected.patients && r.studies === expected.studies && r.series === expected.series && r.images === expected.images && !r.errors.length && !r.branchZeroError;
console.log(ok ? 'OK: el árbol coincide con pydicom' : 'FAIL: el árbol no coincide');
process.exit(ok ? 0 : 1);
