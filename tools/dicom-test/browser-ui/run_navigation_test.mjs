#!/usr/bin/env node
/*
 * Navegación del visor en Chromium con el build de producción: lo que la batería de píxeles no ve.
 *   python3 tools/dicom-test/browser-ui/gen_navigation_series.py
 *   npx ng build --configuration production
 *   PLAYWRIGHT_MODULE=<package.json con playwright> node tools/dicom-test/browser-ui/run_navigation_test.mjs [dist] [carpeta]
 *
 * Comprueba (fallos antiguos de ReleaseNotes.txt, doc 06 V4):
 *   B0001  al cambiar de serie en el visor de pila, el puntero vuelve a la primera imagen ("1 / 15", no "10 / 15");
 *   B0008  al cambiar de estudio, la lista de miniaturas del visor de lista vuelve arriba;
 *   B0010  pulsar una modalidad con varias series abre la primera serie de la tabla (aunque se lea antes la otra).
 * Y el contraste con el ratón (doc 06 V1): arrastre con el botón izquierdo y el derecho, el clic que sigue a arrastrar,
 * la ventana manual al pasar de imagen, el botón de volver, los presets de TC y qué pasa al cambiar de serie.
 * Y el visor táctil (doc 06 V3) en un móvil emulado: pasar de imagen con un dedo, pellizcar, desplazar con zoom, doble
 * toque, contraste con dos dedos y deslizar en la lista.
 * Chromium: CHROMIUM=<ruta> (por defecto /opt/pw-browsers/chromium; en Windows sin CHROMIUM, el Chrome instalado).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const args = process.argv.slice(2);
const dist = path.resolve(args[0] || path.join(root, 'dist/ready-doctor-web'));
const folder = path.resolve(args[1] || path.join(here, '..', 'out', 'navigation'));
const require = createRequire(process.env.PLAYWRIGHT_MODULE || path.join(root, 'package.json'));
let chromium;
for (const name of ['playwright', 'playwright-core']) { try { chromium = require(name).chromium; break; } catch { /* siguiente */ } }

const types = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let file = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html'); // fallback SPA
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(0);
const browser = process.env.CHROMIUM || process.platform !== 'win32'
  ? await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' })
  : await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let fails = 0, checks = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
}

await page.goto(`http://127.0.0.1:${server.address().port}/file-loader`);
await page.waitForTimeout(800);
await page.setInputFiles('input#file', fs.readdirSync(folder).sort().map((f) => path.join(folder, f)));
await page.waitForFunction(() => /Listo:/.test(document.querySelector('images-loader')?.textContent ?? ''), null, { timeout: 60000 });
const table = page.locator('images-loader findings-table').first();
const rows = await table.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
check('la tabla tiene las 5 series (CT 1 y 2, XA 3, XA 4 y 7)', rows.length === 5, rows.join(' | '));

const pointer = () => page.locator('basic-image-viewer small').filter({ hasText: /\(\s*\d+\s*\/\s*\d+\s*\)/ }).first().innerText();
const header = () => page.locator('basic-image-viewer small').filter({ hasText: /#/ }).first().innerText();
const backToTable = async () => { await page.locator('button.loader-view').first().click(); await page.waitForTimeout(400); };
const openRow = async (i) => { await table.locator('tbody tr').nth(i).locator('td.ft-view').click(); await page.waitForTimeout(1200); };

// B0001: serie CT 1 (12 imágenes), diez imágenes más abajo con la rueda; luego la serie CT 2 (15)
await openRow(0);
const box = await page.locator('basic-image-viewer canvas.viewer-image').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 9; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(150); }
await page.waitForTimeout(600);
const before = await pointer();
await backToTable();
await openRow(1);
const after = await pointer();
check('B0001: la rueda avanza en la serie CT 1', /\(\s*10\s*\/\s*12\s*\)/.test(before), before);
check('B0001: al abrir la serie CT 2 el puntero vuelve a la primera imagen', /\(\s*1\s*\/\s*15\s*\)/.test(after), `${after} · ${await header()}`);

// B0008: estudio XA 2 (30 miniaturas), lista desplazada hasta abajo; luego el estudio XA 3
await backToTable();
await openRow(2);
const list = () => page.locator('list-image-viewer .overflow-auto').first();
await list().evaluate((el) => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(300);
const scrolled = await list().evaluate((el) => el.scrollTop);
await backToTable();
await openRow(3);
await page.waitForTimeout(400);
const top = await list().evaluate((el) => el.scrollTop);
check('B0008: la lista de miniaturas del estudio XA 2 se puede desplazar', scrolled > 0, `scrollTop ${scrolled}`);
check('B0008: al abrir el estudio XA 3 la lista vuelve arriba', top === 0, `scrollTop ${top}`);

// B0010: la modalidad XA del estudio 3 (series 4 y 7; la 7 se lee antes): abre la serie 4, la primera de la tabla
await backToTable();
const modality = table.locator('td.ft-mod');
await modality.nth((await modality.count()) - 1).click();
await page.waitForTimeout(1200);
const opened = await header();
check('B0010: pulsar la modalidad XA del estudio 3 abre la serie 4 (primera de la tabla)', /Serie:?\s*#4\b/.test(opened), opened);

// V1 (doc 06): contraste con el ratón y presets de TC, en la serie CT 1
await backToTable();
await openRow(0);
const canvasBox = await page.locator('basic-image-viewer canvas.viewer-image').boundingBox();
const cx = canvasBox.x + canvasBox.width / 2, cy = canvasBox.y + canvasBox.height / 2;
const label = () => page.locator('basic-image-viewer .window-label').first().innerText().catch(() => '');
const centerGray = () => page.evaluate(() => {
  const c = document.querySelector('basic-image-viewer canvas[data-painted]');
  return c ? c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 4), 1, 1).data[0] : -1;
});
const dragBy = async (dx, dy, button = 'left') => {
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button });
  for (let i = 1; i <= 10; i++) { await page.mouse.move(cx + (dx * i) / 10, cy + (dy * i) / 10); await page.waitForTimeout(20); }
  await page.mouse.up({ button });
  await page.waitForTimeout(300);
};
const initialLabel = await label();
const gray0 = await centerGray();
check('V1: la serie CT ofrece la ventana del fichero y los 5 presets de TC', /\/\s*6\b/.test(await page.locator('basic-image-viewer .window-selector small').first().innerText().catch(() => '')), initialLabel);
await dragBy(0, -60);                                  // hacia arriba: centro más bajo, imagen más clara
const gray1 = await centerGray();
const manualLabel = await label();
check('V1: arrastrar en vertical cambia el brillo (etiqueta "Manual")', /Manual/.test(manualLabel) && gray1 > gray0, `${manualLabel} · gris ${gray0} -> ${gray1}`);
check('V1: soltar tras arrastrar no cuenta como clic (no pasa a pantalla completa)', await page.evaluate(() => !document.fullscreenElement));
await page.mouse.move(cx, cy);
await page.mouse.wheel(0, 100);
await page.waitForTimeout(800);
check('V1: la ventana manual se mantiene al pasar de imagen en la serie', /Manual/.test(await label()), `${await pointer()} · ${await label()}`);
await dragBy(-80, 0, 'right');                         // botón derecho, hacia la izquierda: menos anchura, más contraste
check('V1: el botón derecho también ajusta (anchura)', /Manual/.test(await label()) && (await label()) !== manualLabel, await label());
await page.locator('basic-image-viewer .window-reset').first().click();
await page.waitForTimeout(400);
check('V1: el botón de volver recupera la ventana del estudio', (await label()) === initialLabel, await label());
await page.locator('basic-image-viewer .window-range').first().evaluate((el) => { el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(400);
const presetLabel = await label();
check('V1: el selector ofrece el preset de pulmón (C -600 / W 1500)', /-600.*1500/.test(presetLabel), presetLabel);
await dragBy(40, 0);
await backToTable();
await openRow(1);
const otherSeries = await label();
check('V1: en otra serie CT se olvida la ventana arrastrada y se conserva el preset', !/Manual/.test(otherSeries) && /-600.*1500/.test(otherSeries), otherSeries);
await backToTable();
await openRow(3);
check('V1: en XA (sin presets y con una sola ventana) no se ve el selector', (await page.locator('basic-image-viewer .window-selector').count()) === 0);

check('sin errores de JavaScript', errors.length === 0, errors.slice(0, 2).join(' | '));

// V3 (doc 06): visor táctil en un móvil emulado (multitoque por CDP: los toques llegan como Pointer Events)
const mobile = await browser.newContext({ locale: 'es-ES', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const tpage = await mobile.newPage();
const terrors = [];
tpage.on('pageerror', (e) => terrors.push(e.message));
const cdp = await mobile.newCDPSession(tpage);
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });   // Playwright deja 1
const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p[0], y: p[1], id })) });
const gesture = async (from, to, steps = 8) => {           // from/to: [[x, y], ...] (uno o dos dedos)
  for (let k = 1; k <= from.length; k++) await touch('touchStart', from.slice(0, k));   // un touchStart por dedo nuevo
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', from.map((p, k) => [p[0] + ((to[k][0] - p[0]) * i) / steps, p[1] + ((to[k][1] - p[1]) * i) / steps]));
    await tpage.waitForTimeout(16);
  }
  await touch('touchEnd', []);
  await tpage.waitForTimeout(250);
};
const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); };
await tpage.goto(`http://127.0.0.1:${server.address().port}/file-loader`);
await tpage.waitForTimeout(800);
await tpage.setInputFiles('input#file', fs.readdirSync(folder).sort().map((f) => path.join(folder, f)));
await tpage.waitForFunction(() => /Listo:/.test(document.querySelector('images-loader')?.textContent ?? ''), null, { timeout: 60000 });
const ttable = tpage.locator('images-loader findings-table').first();
await ttable.locator('tbody tr').nth(0).locator('td.ft-view').click();
await tpage.waitForTimeout(1500);
const mobileWidth = await tpage.evaluate(() => ({ vw: innerWidth, sw: document.documentElement.scrollWidth,
  bar: Math.round(document.querySelector('basic-image-viewer .viewer-bar').getBoundingClientRect().width) }));
check('V1/V3: en el móvil, la barra del visor de TC (con el selector de ventana) cabe en la pantalla', mobileWidth.bar <= mobileWidth.vw && mobileWidth.sw <= mobileWidth.vw, JSON.stringify(mobileWidth));
const tb = await tpage.locator('basic-image-viewer canvas.viewer-image').boundingBox();
const [tx, ty] = [tb.x + tb.width / 2, tb.y + tb.height / 2];
const tpointer = () => tpage.locator('basic-image-viewer small').filter({ hasText: /\(\s*\d+\s*\/\s*\d+\s*\)/ }).first().innerText();
const transform = () => tpage.locator('basic-image-viewer canvas.viewer-image').evaluate((c) => c.style.transform || '');
await gesture([[tx, ty - 60]], [[tx, ty + 40]]);           // un dedo, 100 px hacia abajo: 3 imágenes
await tpage.waitForTimeout(600);
check('V3: un dedo hacia abajo pasa de imagen (30 px cada una)', /\(\s*4\s*\/\s*12\s*\)/.test(await tpointer()), await tpointer());
await gesture([[tx - 50, ty], [tx + 50, ty]], [[tx - 125, ty], [tx + 125, ty]]);   // pellizco: 100 -> 250 px
const zoomed = await transform();
check('V3: pellizcar amplía la imagen', /scale\(2\.[45]/.test(zoomed), zoomed);
await gesture([[tx, ty]], [[tx + 60, ty + 40]]);            // un dedo con zoom: desplaza, no cambia de imagen
const panned = await transform();
check('V3: con zoom, un dedo desplaza la imagen sin cambiar de imagen', /translate\(60px, 40px\)/.test(panned) && /\(\s*4\s*\/\s*12\s*\)/.test(await tpointer()), `${panned} · ${await tpointer()}`);
await tap(tx, ty); await tpage.waitForTimeout(80); await tap(tx, ty);
await tpage.waitForTimeout(500);
check('V3: doble toque vuelve a ajustar la imagen', (await transform()) === '', await transform());
await gesture([[tx - 40, ty], [tx + 40, ty]], [[tx - 40, ty - 70], [tx + 40, ty - 70]]);   // dos dedos juntos hacia arriba
const tlabel = await tpage.locator('basic-image-viewer .window-label').first().innerText().catch(() => '');
check('V3: dos dedos juntos ajustan el contraste', /Manual/.test(tlabel), tlabel);
await tpage.locator('button.loader-view').first().click();
await tpage.waitForTimeout(400);
await ttable.locator('tbody tr').nth(2).locator('td.ft-view').click();   // XA de 30 imágenes de un frame
await tpage.waitForTimeout(1500);
const lb = await tpage.locator('basic-image-viewer canvas.viewer-image').boundingBox();
await gesture([[lb.x + lb.width / 2 - 40, lb.y + lb.height / 2]], [[lb.x + lb.width / 2 + 30, lb.y + lb.height / 2]]);   // 70 px
await tpage.waitForTimeout(600);
const theader = await tpage.locator('basic-image-viewer small').filter({ hasText: /#/ }).first().innerText();
check('V3: en la lista, deslizar pasa a la imagen siguiente (dos, con 70 px)', /Imagen:?\s*#3\b/.test(theader), theader);
const maxTitle = () => tpage.locator('basic-image-viewer button').filter({ has: tpage.locator('.fa-expand, .fa-compress') }).first().getAttribute('title');
const lx = lb.x + lb.width / 2, ly = lb.y + lb.height / 2;
await tap(lx, ly); await tpage.waitForTimeout(80); await tap(lx, ly);
await tpage.waitForTimeout(600);
check('V3: el doble toque no hace el clic (no maximiza)', (await maxTitle()) === 'Pantalla completa', await maxTitle());
await tap(lx, ly);
await tpage.waitForTimeout(700);
check('V3: un toque hace el clic de siempre (aquí, maximizar)', (await maxTitle()) === 'Salir de pantalla completa', await maxTitle());
check('V3: sin errores de JavaScript en el móvil', terrors.length === 0, terrors.slice(0, 2).join(' | '));
await mobile.close();

console.log(`\n${fails} FAIL / ${checks} comprobaciones (navegación)`);
await browser.close();
server.close();
process.exitCode = fails ? 1 : 0;
