#!/usr/bin/env node
/*
 * Prueba de "CD completo" en el navegador: sirve el build de producción, entra en "Selecciona la unidad o carpeta",
 * carga una carpeta entera (subcarpetas incluidas, como un CD con DICOMDIR), espera a que el cargador termine y
 * compara lo que dice ("Listo: N DICOM entre M ficheros") y el árbol de la tabla de hallazgos (pacientes, estudios,
 * series, imágenes) con lo que calcula pydicom (expected_tree.py). Luego pulsa "Ver imágenes" y espera la primera
 * imagen. Mide tiempos y memoria del renderer (Windows: WMI; Linux/macOS: ps).
 *
 *   PLAYWRIGHT_MODULE=<package.json con playwright> node tools/dicom-test/real/cd_browser_test.mjs <carpeta> [dist] [--python <python con pydicom>]
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const args = process.argv.slice(2);
const pyIdx = args.indexOf('--python');
const python = pyIdx >= 0 ? args.splice(pyIdx, 2)[1] : 'python';
const folder = path.resolve(args[0]);
const dist = path.resolve(args[1] || path.join(root, 'dist/ready-doctor-web'));
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('No hay build en ' + dist);
const require = createRequire(process.env.PLAYWRIGHT_MODULE || path.join(root, 'package.json'));
let chromium;
for (const name of ['playwright', 'playwright-core']) { try { chromium = require(name).chromium; break; } catch { /* siguiente */ } }

const expected = JSON.parse(execFileSync(python, [path.join(here, 'expected_tree.py'), folder], { maxBuffer: 1 << 26 }).toString());
console.log(`pydicom: ${expected.dicomFound} DICOM · ${expected.patients} pacientes · ${expected.studies} estudios · ${expected.series} series · ${expected.images} imágenes`);

const types = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.pdf': 'application/pdf' };
const server = http.createServer((req, res) => {
  let file = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(0);
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = process.env.CHROMIUM || process.platform !== 'win32'
  ? await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' })
  : await chromium.launch({ channel: 'chrome' });

function rendererRSS() {
  try {
    if (process.platform === 'win32') {
      const ps = 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*--type=renderer*\' -and ($_.Name -like \'*chrom*\' -or $_.Name -eq \'msedge.exe\') } | Measure-Object -Property WorkingSetSize -Sum | Select-Object -ExpandProperty Sum';
      return Math.round((+execSync(`powershell -NoProfile -Command "${ps}"`).toString().trim() || 0) / 2 ** 20);
    }
    let kb = 0;
    for (const line of execSync('ps -eo rss,args').toString().split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (m && /chrom/i.test(m[2]) && m[2].includes('--type=renderer')) kb += +m[1];
    }
    return Math.round(kb / 1024);
  } catch { return 0; }
}

const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('JS: ' + String(e).slice(0, 160)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
await page.goto(origin + '/dir-loader', { waitUntil: 'networkidle' });
const rss0 = rendererRSS();
const t0 = Date.now();
await page.locator('input#dirPicker').setInputFiles(folder); // carpeta entera (webkitdirectory)
const doneRe = /Listo: (\d+) DICOM entre (\d+) ficheros/;
const finished = await page.waitForFunction(re => re.test(document.querySelector('.loader-status')?.textContent || ''), doneRe, { timeout: 900000 })
  .then(() => true).catch(() => false);
const msLoad = Date.now() - t0;
const status = (await page.locator('.loader-status').textContent().catch(() => '')).replace(/\s+/g, ' ').trim();
const m = status.match(doneRe);
const notices = await page.locator('.loader-errors').innerText({ timeout: 1000 }).catch(() => '');
const rss1 = rendererRSS();
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); };
check('el cargador termina', finished, `${status} en ${Math.round(msLoad / 1000)} s`);
if (m) check('DICOM encontrados = ficheros con preámbulo DICM', +m[1] === expected.dicomFound, `${m[1]} vs ${expected.dicomFound}`);
if (notices) console.log('avisos del cargador: ' + notices.replace(/\s+/g, ' ').trim().slice(0, 300));

// "Ver imágenes" y la tabla de hallazgos (árbol completo)
await page.locator('button.loader-view').click({ timeout: 10000 }).catch(() => {});
const t1 = Date.now();
const painted = await page.waitForFunction(() => [...document.querySelectorAll('basic-image-viewer img')]
  .some(i => i.src.startsWith('data:image') && !i.hasAttribute('data-unsupported')), null, { timeout: 300000 }).then(() => true).catch(() => false);
const msPaint = Date.now() - t1;
await page.waitForTimeout(1500);
// Hay dos tablas de hallazgos: la rama seleccionada (una serie) y el árbol completo (plegado con d-none, pero en el
// DOM): se cuenta la que más series tenga
const tree = await page.evaluate(() => {
  const text = el => (el.textContent || '').trim();
  let best = null;
  for (const table of document.querySelectorAll('findings-table')) {
    const patients = [...table.querySelectorAll('div')].filter(d => /^Id: /.test(text(d)) && d.classList.contains('selectable')).length;
    const studies = table.querySelectorAll('.col-2.selectable').length;
    const seriesRows = [...table.querySelectorAll('.row.clickable.selectable')];
    const images = seriesRows.reduce((s, r) => s + (+text(r.children[1]) || 0), 0);
    const t = { patients, studies, series: seriesRows.length, images };
    if (!best || t.series > best.series) best = t;
  }
  return best;
});
const rss2 = rendererRSS();
check('la primera imagen se pinta', painted, `${Math.round(msPaint / 1000)} s`);
if (tree) {
  check('pacientes', tree.patients === expected.patients, `${tree.patients} vs ${expected.patients}`);
  check('estudios', tree.studies === expected.studies, `${tree.studies} vs ${expected.studies}`);
  check('series', tree.series === expected.series, `${tree.series} vs ${expected.series}`);
  check('imágenes clasificadas', tree.images === expected.images, `${tree.images} vs ${expected.images}`);
} else check('tabla de hallazgos visible', false);
check('sin errores de JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`memoria del renderer: +${rss1 - rss0} MB tras leer, +${rss2 - rss0} MB tras pintar (base ${rss0} MB)`);
await page.screenshot({ path: path.join(root, 'tools', 'dicom-test', 'out', 'cd_browser_test.png'), fullPage: false }).catch(() => {});
await browser.close();
server.close();
const fails = results.filter(x => !x).length;
console.log(`${fails} FAIL / ${results.length} comprobaciones (${path.basename(folder)})`);
process.exit(fails ? 1 : 0);
