#!/usr/bin/env node
/*
 * Mide el visor con estudios pesados (ver gen_big_files.py): cuánto tarda en leer y en pintar la primera imagen,
 * y cuánta memoria residente añade el proceso renderer de Chromium. Sirve de línea base para la carga por
 * File.slice y para comprobar que no empeora.
 *
 *   node tools/dicom-test/big-files/measure_big_files.mjs [dist] <fichero-o-carpeta> [...]
 *
 * Además comprueba el límite de FileReader.readAsBinaryString (lo que usa DCMFile hoy) con cada fichero suelto.
 * La memoria se lee con `ps` (Linux/macOS). Requiere playwright (PLAYWRIGHT_MODULE=<package.json donde esté>)
 * y Chromium (CHROMIUM=<ruta>; por defecto /opt/pw-browsers/chromium).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
let args = process.argv.slice(2);
const dist = args.length && fs.existsSync(path.join(args[0], 'index.html')) ? path.resolve(args.shift()) : path.join(root, 'dist/ready-doctor-web');
if (!args.length) {
  const big = path.join(here, '..', 'out', 'big');
  args = fs.existsSync(big) ? fs.readdirSync(big).map((x) => path.join(big, x)) : [];
}
const require = createRequire(process.env.PLAYWRIGHT_MODULE || path.join(root, 'package.json'));
const { chromium } = require('playwright');

const types = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let file = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html'); // fallback SPA
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(0);
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const MB = (bytes) => Math.round(bytes / 2 ** 20);

/** Memoria residente (MB) de los procesos renderer de Chromium. */
function rendererRSS() {
  let kb = 0;
  for (const line of execSync('ps -eo rss,args').toString().split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m && /chrom/i.test(m[2]) && m[2].includes('--type=renderer')) kb += +m[1];
  }
  return Math.round(kb / 1024);
}
const sizeOf = (p) => fs.statSync(p).isDirectory()
  ? fs.readdirSync(p).reduce((s, x) => s + fs.statSync(path.join(p, x)).size, 0) : fs.statSync(p).size;

// 1) Límite de FileReader.readAsBinaryString (DCMFile lee así el fichero entero)
for (const f of args.filter((p) => fs.statSync(p).isFile())) {
  const page = await browser.newPage();
  await page.setContent('<input type=file id=f>');
  await page.setInputFiles('#f', f);
  const r = await page.evaluate(() => new Promise((resolve) => {
    const reader = new FileReader(); const t0 = performance.now();
    reader.onloadend = () => resolve({ length: reader.result ? reader.result.length : null,
      error: reader.error ? reader.error.name : null, ms: Math.round(performance.now() - t0) });
    reader.readAsBinaryString(document.getElementById('f').files[0]);
  }));
  console.log(`readAsBinaryString ${path.basename(f)} (${MB(sizeOf(f))} MB): ` +
    (r.length === null ? `SIN RESULTADO (error: ${r.error ?? 'ninguno'})` : `${MB(r.length)} MB en ${r.ms} ms`));
  await page.close();
}

// 2) La app: lectura, primera imagen y memoria del renderer
for (const f of args) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().split('\n')[0].slice(0, 120)); });
  await page.goto(origin + '/');
  await page.waitForTimeout(800);
  for (const label of ['Encontrar imágenes', 'Unos ficheros']) {
    const link = page.getByText(label).first();
    if (await link.count()) { await link.click().catch(() => {}); await page.waitForTimeout(400); }
  }
  if (!(await page.locator('input#file').count())) { await page.goto(origin + '/file-loader'); await page.waitForTimeout(800); }
  const rss0 = rendererRSS();
  const t0 = Date.now();
  await page.setInputFiles('input#file', fs.statSync(f).isDirectory() ? fs.readdirSync(f).map((x) => path.join(f, x)) : f);
  const read = await page.waitForFunction(() => { const b = document.querySelector('button.loader-view'); return !!b && !b.disabled; },
    null, { timeout: 180000 }).then(() => true).catch(() => false);
  const msRead = Date.now() - t0;
  const rss1 = rendererRSS();
  if (read) await page.locator('button.loader-view').click().catch(() => {});
  const painted = read && await page.waitForFunction(() => [...document.querySelectorAll('basic-image-viewer img')]
    .some((i) => i.src.startsWith('data:image') && !i.hasAttribute('data-unsupported')), null, { timeout: 180000 })
    .then(() => true).catch(() => false);
  const msPaint = Date.now() - t0;
  await page.waitForTimeout(3000);
  const rss2 = rendererRSS();
  console.log(`${path.basename(f)} (${MB(sizeOf(f))} MB): ` +
    `lectura ${read ? msRead + ' ms' : 'NO'}, primera imagen ${painted ? msPaint + ' ms' : 'NO'}, ` +
    `renderer +${rss1 - rss0} MB tras leer, +${rss2 - rss0} MB tras pintar` + (errors.length ? `, errores: ${errors.slice(0, 2).join(' | ')}` : ''));
  await page.close();
}
await browser.close();
server.close();
