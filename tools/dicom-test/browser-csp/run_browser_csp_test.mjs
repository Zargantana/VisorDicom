#!/usr/bin/env node
/*
 * Prueba en Chromium del build de producción con las MISMAS cabeceras de seguridad que sirve visordicom.es
 * (CSP estricta: script-src 'self' + hash, sin 'wasm-unsafe-eval' ni eval): carga cada DICOM de la batería por la UI
 * y comprueba
 *   - que no hay violaciones de CSP ni errores de página,
 *   - qué códecs bajo demanda se descargan (assets/codecs) y con qué Content-Type,
 *   - que la imagen se pinta y que sus píxeles son IGUALES a los del harness (out/render/<fichero>.f0.rgba).
 *
 * Uso (tras gen_test_dicoms.py, run_harness.mjs y `ng build --configuration production`):
 *   node tools/dicom-test/browser-csp/run_browser_csp_test.mjs [dist/ready-doctor-web] [patrón]
 * Requiere playwright (PLAYWRIGHT_MODULE=<package.json donde esté instalado>) y Chromium
 * (CHROMIUM=<ruta>; por defecto /opt/pw-browsers/chromium).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const outDir = path.resolve(here, '..', 'out');
const dist = path.resolve(process.argv[2] || path.join(root, 'dist/ready-doctor-web'));
const pattern = new RegExp(process.argv[3] || '^t(0[1-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9])_.*\\.dcm$');
const require = createRequire(process.env.PLAYWRIGHT_MODULE || path.join(root, 'package.json'));
const { chromium } = require('playwright');

// Cabeceras de producción de visordicom.es (si cambian allí, cámbialas aquí). Única diferencia: producción añade a
// connect-src el origen S3 del bucket de estudios del portal, que el visor no usa (los códecs van por script-src).
// Para probar otra política: CSP="<política>" node run_browser_csp_test.mjs ...
const CSP = process.env.CSP || "default-src 'self'; script-src 'self' 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://*.visordicom.es; " +
  "worker-src 'self' blob:; manifest-src 'self'; frame-src 'self' https://*.visordicom.es; frame-ancestors 'self' https://*.visordicom.es; " +
  "form-action 'self' https://*.visordicom.es; base-uri 'self'; object-src 'none'";
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.md': 'text/markdown', '.pdf': 'application/pdf', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let p = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(dist) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const origin = `http://127.0.0.1:${server.address().port}`;
const expected = JSON.parse(fs.readFileSync(path.join(outDir, 'expected.json'), 'utf8'));
const files = fs.readdirSync(outDir).filter((f) => pattern.test(f)).sort();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
let fails = 0;
for (const name of files) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const problems = [];
  const codecs = [];
  page.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) problems.push('CSP: ' + t.slice(0, 160)); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.url().includes('/assets/codecs/')) codecs.push(`${path.basename(r.url())} ${r.status()} ${r.headers()['content-type']}`); });
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) =>
    console.error(`Refused to (securitypolicyviolation) ${e.violatedDirective} ${e.blockedURI}`)));
  await page.goto(origin + '/');
  await page.waitForTimeout(600);
  for (const label of ['Encontrar imágenes', 'Unos ficheros.']) {
    const link = page.getByText(label).first();
    if (await link.count()) { await link.click().catch(() => {}); await page.waitForTimeout(400); }
  }
  if (!(await page.locator('input#file').count())) { await page.goto(origin + '/file-loader'); await page.waitForTimeout(600); }
  const expectFail = expected[name]?.kind === 'expect_fail';
  let pixels = null;
  try {
    await page.setInputFiles('input#file', path.join(outDir, name), { timeout: 10000 });
  } catch {
    problems.push('la app no arrancó (sin input#file)');
  }
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('basic-image-viewer img')].some((i) => i.src.startsWith('data:image')),
      null, { timeout: expectFail ? 4000 : 20000 });
    pixels = await page.evaluate(async () => {
      const img = [...document.querySelectorAll('basic-image-viewer img')].find((i) => i.src.startsWith('data:image'));
      const im = new Image(); im.src = img.src; await im.decode();
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
      return { w: c.width, h: c.height, data: Array.from(ctx.getImageData(0, 0, c.width, c.height).data) };
    });
  } catch { /* sin imagen */ }
  let verdict;
  if (expectFail) {
    verdict = pixels ? 'FAIL (se esperaba rechazo)' : 'PASS (rechazo controlado)';
  } else if (!pixels) {
    verdict = 'FAIL (no se pintó)';
  } else {
    const refFile = path.join(outDir, 'render', `${name}.f0.rgba`);
    const ref = fs.existsSync(refFile) ? fs.readFileSync(refFile) : null;
    let maxdiff = -1;
    if (ref && ref.length === pixels.data.length) {
      maxdiff = 0;
      for (let i = 0; i < ref.length; i++) maxdiff = Math.max(maxdiff, Math.abs(ref[i] - pixels.data[i]));
    }
    verdict = maxdiff === 0 ? 'PASS (píxeles = harness)' : `FAIL (maxdiff ${maxdiff})`;
  }
  if (problems.length) verdict = 'FAIL (' + problems.join(' | ') + ')';
  fails += verdict.startsWith('PASS') ? 0 : 1;
  console.log(`${verdict.startsWith('PASS') ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${verdict}${codecs.length ? '  códecs: ' + codecs.join(', ') : ''}`);
  await page.close();
}
await browser.close();
server.close();
console.log(`\n${fails} FAIL / ${files.length} ficheros (CSP de producción)`);
process.exit(fails ? 1 : 0);
