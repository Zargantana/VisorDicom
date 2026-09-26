// Prueba con las cabeceras REALES de producción: abre https://visordicom.es en Chrome y carga por la interfaz, uno a
// uno (como run_browser_csp_test.mjs: el visor enseña un estudio cada vez), unos ficheros de la batería: HTJ2K, JPEG
// progresivo, JPEG de 12 bits, JPEG-LS, Big Endian con secuencia y dos rechazos (Sectra opaco y J2K con SIZ corrupto).
// Comprueba que no hay violaciones de CSP ni errores de JavaScript, que cada imagen se pinta o enseña su cartel, y
// qué códecs de assets/codecs se descargan. La captura del último fichero queda en out/production.png.
// Uso: PLAYWRIGHT_MODULE=<package.json con playwright> node tools/dicom-test/browser-csp/check_production.mjs [url] [fichero...]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const outDir = path.join(root, 'tools', 'dicom-test', 'out');
const args = process.argv.slice(2);
const url = args.length && /^https?:/.test(args[0]) ? args.shift() : 'https://visordicom.es';
const names = args.length ? args : ['t22_jpegls_signed16_2win.dcm', 't24_htj2k_lossless_12.dcm', 't33_jpeg_prog_rgb.dcm', 't50_jpeg_prog12_gray.dcm',
  't64_sectra_ls_opaque.dcm', 't74_ct_evbe_sq_defined.dcm', 't75_j2k_bad_siz.dcm'];
const missing = names.filter(n => !fs.existsSync(path.join(outDir, n)));
if (missing.length) console.warn('No están en out/ (¿batería sin generar?):', missing.join(', '));
const files = names.filter(n => !missing.includes(n));
if (!files.length) throw new Error('No hay ficheros: genera la batería (gen_test_dicoms.py)');
const expectsCartel = n => /sectra|bad_siz/.test(n);

const require = createRequire(process.env.PLAYWRIGHT_MODULE || path.join(root, 'package.json'));
let chromium;
for (const name of ['playwright', 'playwright-core']) { try { chromium = require(name).chromium; break; } catch { /* siguiente */ } }
const browser = process.env.CHROMIUM ? await chromium.launch({ executablePath: process.env.CHROMIUM }) : await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const problems = [];
const codecs = new Set();
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`));
});
page.on('pageerror', e => problems.push('JS: ' + String(e).slice(0, 160)));
page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 160)); });
page.on('response', r => { if (r.url().includes('/assets/codecs/')) codecs.add(`${path.basename(new URL(r.url()).pathname)} ${r.status()} ${r.headers()['content-type'] || ''}`); });

let fails = 0;
for (const name of files) {
  await page.goto(url + '/file-loader', { waitUntil: 'networkidle' });
  await page.locator('input#file').setInputFiles(path.join(outDir, name));
  await page.waitForFunction(() => { const b = document.querySelector('button.loader-view'); return !!b && !b.disabled; }, null, { timeout: 60000 });
  await page.locator('button.loader-view').click();
  const ok = await page.waitForFunction(() => [...document.querySelectorAll('img')]
    .some(i => i.src.startsWith('data:image') || i.hasAttribute('data-unsupported')), null, { timeout: 90000 }).then(() => true).catch(() => false);
  const state = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].filter(i => i.src.startsWith('data:image') || i.hasAttribute('data-unsupported'));
    const cartel = imgs.map(i => i.getAttribute('data-unsupported')).find(Boolean) || '';
    return { painted: imgs.filter(i => !i.hasAttribute('data-unsupported')).length, cartel, csp: window.__csp.splice(0) };
  });
  problems.push(...state.csp.map(v => `CSP (${name}): ${v}`));
  let verdict;
  if (!ok) verdict = 'FAIL (ni imagen ni cartel en 90 s)';
  else if (expectsCartel(name)) verdict = state.cartel ? `PASS (cartel: ${state.cartel.slice(0, 70)}…)` : 'FAIL (se esperaba el cartel y se pintó una imagen)';
  else verdict = state.painted ? 'PASS (imagen pintada)' : `FAIL (cartel inesperado: ${state.cartel.slice(0, 70)})`;
  if (verdict.startsWith('FAIL')) fails++;
  console.log(`${verdict.startsWith('PASS') ? 'PASS' : 'FAIL'}  ${name.padEnd(36)} ${verdict}`);
}
await page.screenshot({ path: path.join(outDir, 'production.png'), fullPage: true });
await browser.close();
console.log(`códecs descargados: ${codecs.size ? [...codecs].join(' · ') : 'ninguno'}`);
if (problems.length) console.log(`PROBLEMAS:\n  ${problems.join('\n  ')}`);
console.log(`${fails + problems.length} FAIL / ${files.length} ficheros (cabeceras reales de ${url})`);
process.exit(fails + problems.length ? 1 : 0);
