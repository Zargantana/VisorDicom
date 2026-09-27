#!/usr/bin/env node
/*
 * Mide el visor con estudios pesados (ver gen_big_files.py): cuánto tarda en leer y en pintar la primera imagen,
 * cuánta memoria residente añade el proceso renderer de Chromium y, en uso (cine o rueda), cuántas imágenes por
 * segundo pinta y si la memoria se queda acotada por la caché de frames (FrameCache).
 *
 *   node tools/dicom-test/big-files/measure_big_files.mjs [dist] <fichero-o-carpeta> [...]
 *
 * Además comprueba el límite de FileReader.readAsBinaryString con cada fichero suelto (el visor ya no lo usa para
 * los ficheros locales: lee la cabecera por bloques y el Pixel Data por rangos; sirve de referencia).
 * MEASURE_NO_USAGE=1 salta la fase de uso.
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
let chromium;
for (const name of ['playwright', 'playwright-core']) { try { chromium = require(name).chromium; break; } catch { /* siguiente */ } }

const types = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let file = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html'); // fallback SPA
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(0);
const origin = 'http://127.0.0.1:' + server.address().port;
// CHROMIUM=<ruta> (Linux: /opt/pw-browsers/chromium por defecto); en Windows sin CHROMIUM se usa el Chrome instalado
const browser = process.env.CHROMIUM || process.platform !== 'win32'
  ? await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--js-flags=--expose-gc'] })
  : await chromium.launch({ channel: 'chrome', args: ['--js-flags=--expose-gc'] });
const MB = (bytes) => Math.round(bytes / 2 ** 20);

/** Memoria residente (MB) de los procesos renderer de Chromium (ps en Linux/macOS, WMI en Windows). */
function rendererRSS() {
  if (process.platform === 'win32') {
    const ps = 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*--type=renderer*\' -and ($_.Name -eq \'chrome.exe\' -or $_.Name -like \'*chrom*\' -or $_.Name -eq \'msedge.exe\') } | Measure-Object -Property WorkingSetSize -Sum | Select-Object -ExpandProperty Sum';
    const out = execSync(`powershell -NoProfile -Command "${ps}"`).toString().trim();
    return Math.round((+out || 0) / 2 ** 20);
  }
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
  const page = await browser.newPage({ locale: 'es-ES' });
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
  // locale es-ES: la interfaz sale en el idioma del navegador y la prueba busca los textos en español
  const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1100, height: 760 } });
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
  // Leído = aparece una serie en el selector del cargador (desde 2026-09-27 no hay botón "Ver imágenes")
  const read = await page.locator('images-loader findings-table td.ft-view').first().waitFor({ timeout: 180000 }).then(() => true).catch(() => false);
  const msRead = Date.now() - t0;
  const rss1 = rendererRSS();
  // Aviso del cargador (F0 del plan): con más de ≈512 MiB tiene que salir un motivo, no un TypeError
  const notice = read ? '' : await page.locator('.loader-errors').innerText({ timeout: 2000 }).catch(() => '');
  if (notice) errors.unshift('aviso: ' + notice.replace(/\s+/g, ' ').trim().slice(0, 160));
  if (read) await page.locator('images-loader findings-table td.ft-view').first().click().catch(() => {});
  // Pintada = el <canvas> del visor lleva data-painted (desde 2026-09-27) o, en versiones anteriores, el <img> un data: URL
  const painted = read && await page.waitForFunction(() => [...document.querySelectorAll('basic-image-viewer canvas, basic-image-viewer img')]
    .some((e) => e.tagName == 'CANVAS' ? e.hasAttribute('data-painted') : (e.src || '').startsWith('data:image') && !e.hasAttribute('data-unsupported')),
    null, { timeout: 180000 }).then(() => true).catch(() => false);
  const msPaint = Date.now() - t0;
  await page.waitForTimeout(3000);
  const rss2 = rendererRSS();
  // 3) Uso: cine 8 s en un multiframe (clic en la imagen) o 300 pasos de rueda en una serie. La memoria tiene que
  //    quedarse acotada (caché de frames con presupuesto) y el visor tiene que seguir pintando.
  let usage = '';
  if (painted && !process.env.MEASURE_NO_USAGE) {
    // Imágenes pintadas: el canvas cuenta sus pintadas en data-paint-count; con <img>, cada cambio de src
    await page.evaluate(() => {
      const w = window;
      const canvas = document.querySelector('basic-image-viewer canvas[data-painted]');
      if (canvas) {
        const base = +(canvas.getAttribute('data-paint-count') || 0);
        w.__paintCount = () => +(canvas.getAttribute('data-paint-count') || 0) - base;
      } else {
        w.__paints = 0;
        new MutationObserver(() => { w.__paints++; }).observe(document.querySelector('basic-image-viewer img'), { attributes: true, attributeFilter: ['src'] });
        w.__paintCount = () => w.__paints;
      }
    });
    const area = page.locator('basic-image-viewer .clickable').first();
    const tu = Date.now();
    if (fs.statSync(f).isFile()) {
      await area.click();                                   // reproducir
      await page.waitForTimeout(8000);
      await area.click();                                   // pausa
    } else {
      const box = await area.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 300; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(30); }
      await page.waitForTimeout(1500);
    }
    const secs = (Date.now() - tu) / 1000;
    const paints = await page.evaluate(() => window.__paintCount());
    await page.waitForTimeout(1500);
    const rss3 = rendererRSS();
    // Tras recoger la basura (Chromium con --js-flags=--expose-gc): lo que de verdad queda retenido
    await page.evaluate(() => { for (let i = 0; i < 3; i++) window.gc?.(); });
    for (const worker of page.workers()) await worker.evaluate(() => { for (let i = 0; i < 3; i++) self.gc?.(); }).catch(() => {});
    await page.waitForTimeout(1500);
    const rss4 = rendererRSS();
    usage = `; uso (${fs.statSync(f).isFile() ? 'cine 8 s' : '300 pasos de rueda'}): ${paints} imágenes pintadas ` +
      `(${(paints / secs).toFixed(1)}/s), renderer +${rss3 - rss0} MB, +${rss4 - rss0} MB tras recoger basura` +
      `, Workers de decodificación: ${page.workers().length}`;
  }
  console.log(`${path.basename(f)} (${MB(sizeOf(f))} MB): ` +
    `lectura ${read ? msRead + ' ms' : 'NO'}, primera imagen ${painted ? msPaint + ' ms' : 'NO'}, ` +
    `renderer +${rss1 - rss0} MB tras leer, +${rss2 - rss0} MB tras pintar${usage}` + (errors.length ? `, errores: ${errors.slice(0, 2).join(' | ')}` : ''));
  await page.close();
}
await browser.close();
server.close();
