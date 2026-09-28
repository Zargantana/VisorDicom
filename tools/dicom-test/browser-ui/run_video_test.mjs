#!/usr/bin/env node
/*
 * Vídeo H.264/HEVC en el visor (doc 06 V2), en un navegador con WebCodecs y esos códecs (Chrome o Edge; el Chromium de
 * Playwright no trae H.264 ni HEVC). Compara cada frame pintado con los de PyAV (out/video_ref, mismos frames
 * decodificados por FFmpeg) y recorre el vídeo hacia delante, hacia atrás (vuelve a empezar desde la IDR anterior),
 * dando la vuelta y en cine.
 *   python3 tools/dicom-test/gen_test_dicoms.py          (necesita PyAV: pip install av)
 *   npx ng build --configuration production
 *   CHROMIUM=<chrome.exe o msedge> PLAYWRIGHT_MODULE=<package.json con playwright> node tools/dicom-test/browser-ui/run_video_test.mjs [dist]
 * HEVC depende del equipo (decodificación por hardware): si el navegador no lo decodifica, se comprueba que el visor
 * lo explica. t98 mide 320x240: el decodificador por hardware de Chrome en Windows no admite menos. MPEG-2: rechazo
 * controlado siempre.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const dist = path.resolve(process.argv[2] || path.join(root, 'dist/ready-doctor-web'));
const out = path.join(here, '..', 'out');
const refDir = path.join(out, 'video_ref');
const require = createRequire(process.env.PLAYWRIGHT_MODULE || path.join(root, 'package.json'));
let chromium;
for (const name of ['playwright', 'playwright-core']) { try { chromium = require(name).chromium; break; } catch { /* siguiente */ } }

const types = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let file = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(0);
const base = `http://localhost:${server.address().port}`; // localhost: contexto seguro (WebCodecs lo exige)
const browser = process.env.CHROMIUM || process.platform !== 'win32'
  ? await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' })
  : await chromium.launch({ channel: 'chrome' });

let fails = 0, checks = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
}

const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// El mismo criterio que VideoStreamDecoder.supports(): por hardware o por software, con el tamaño de cada fichero ("sin
// preferencia" no vale: Chrome contesta que sí a HEVC pequeños que su decodificador por hardware rechaza)
const support = await page.goto(base + '/reader').then(() => page.evaluate(async () => {
  const s = async (codec, codedWidth, codedHeight) => {
    if (typeof VideoDecoder === 'undefined') return false;
    for (const hardwareAcceleration of ['prefer-hardware', 'prefer-software']) {
      if ((await VideoDecoder.isConfigSupported({ codec, codedWidth, codedHeight, hardwareAcceleration })).supported) return true;
    }
    return false;
  };
  return { h264: await s('avc1.64000B', 160, 120), hevc: await s('hvc1.1.6.L60.90', 320, 240) };
}));
console.log(`navegador: ${await browser.version()}  H.264=${support.h264} HEVC=${support.hevc}`);

/** Frame pintado ahora: índice (data-painted "fichero:frame") y RGB del canvas. */
async function painted() {
  return page.evaluate(() => {
    const c = document.querySelector('basic-image-viewer canvas.viewer-image');
    const token = c?.getAttribute('data-painted');
    if (!c || !token) return { frame: -1, unsupported: c?.getAttribute('data-unsupported') ?? null };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const rgb = new Array(c.width * c.height * 3);
    for (let i = 0, j = 0; j < d.length; i += 3, j += 4) { rgb[i] = d[j]; rgb[i + 1] = d[j + 1]; rgb[i + 2] = d[j + 2]; }
    return { frame: +token.split(':')[1], width: c.width, height: c.height, rgb };
  });
}
async function waitFrame(frame) {
  await page.waitForFunction((f) => (document.querySelector('basic-image-viewer canvas.viewer-image')?.getAttribute('data-painted') ?? '').endsWith(':' + f), frame, { timeout: 15000 }).catch(() => {});
  return painted();
}
function compare(name, got) {
  if (got.frame < 0) return { mean: 255, max: 255 };
  const ref = fs.readFileSync(path.join(refDir, `${name}.f${got.frame}.rgb`));
  let sum = 0, max = 0;
  for (let i = 0; i < ref.length; i++) { const d = Math.abs(ref[i] - got.rgb[i]); sum += d; if (d > max) max = d; }
  return { mean: sum / ref.length, max };
}

// t96b y t98b: el .mp4 entero en el Pixel Data (Mp4), como en algunos equipos
const files = ['t96_video_h264.dcm', 't96b_video_h264_mp4.dcm', 't97_video_h264_fragmentable.dcm', 't98_video_hevc.dcm',
  't98b_video_hevc_mp4.dcm', 't99_video_mpeg2.dcm'];
const next = () => page.locator('basic-image-viewer button:has(i.fa-forward-step)').first().click();
const before = () => page.locator('basic-image-viewer button:has(i.fa-backward-step)').first().click();

for (const name of files) {
  // Un vídeo cada vez: el visor empieza en el frame 0 y no hay restos del anterior en el canvas
  await page.goto(base + '/file-loader');
  await page.waitForTimeout(800);
  await page.setInputFiles('input#file', [path.join(out, name)]);
  await page.waitForFunction(() => /Listo:/.test(document.querySelector('images-loader')?.textContent ?? ''), null, { timeout: 60000 });
  await page.locator('images-loader findings-table td.ft-view').first().click();
  await page.waitForFunction(() => { const c = document.querySelector('basic-image-viewer canvas.viewer-image'); return c?.hasAttribute('data-painted') || c?.hasAttribute('data-unsupported'); }, null, { timeout: 30000 }).catch(() => {});
  const first = await painted();
  const family = name.includes('mpeg2') ? 'mpeg2' : name.includes('hevc') ? 'hevc' : 'h264';
  if (family === 'mpeg2' || (family === 'hevc' && !support.hevc) || (family === 'h264' && !support.h264)) {
    const expected = family === 'mpeg2' ? 'MPEG-2' : family === 'hevc' ? 'HEVC' : 'H.264';
    check(`${name}: el visor explica que no puede (${expected})`, (first.unsupported ?? '').includes(expected), first.unsupported);
    continue;
  }
  const frames = fs.readdirSync(refDir).filter((f) => f.startsWith(name + '.f')).length;
  const diffs = [];
  let got = first;
  diffs.push({ ...compare(name, got), frame: got.frame });
  // Adelante hasta el final y una vuelta (vuelve al 0: nuevo comienzo desde la primera IDR)
  for (let k = 1; k <= frames; k++) {
    await next();
    got = await waitFrame(k % frames);
    diffs.push({ ...compare(name, got), frame: got.frame });
  }
  // Hacia atrás: del 0 al último (salto a la última IDR) y dos más atrás (reinicio desde la IDR anterior)
  for (const k of [frames - 1, frames - 2, frames - 3]) {
    await before();
    got = await waitFrame(k);
    diffs.push({ ...compare(name, got), frame: got.frame });
  }
  const order = diffs.map((d) => d.frame).join(',');
  const expectedOrder = [...Array.from({ length: frames + 1 }, (_, k) => k % frames), frames - 1, frames - 2, frames - 3].join(',');
  const worstMean = Math.max(...diffs.map((d) => d.mean)), worstMax = Math.max(...diffs.map((d) => d.max));
  check(`${name}: recorre los ${frames} frames adelante, atrás y dando la vuelta`, order === expectedOrder, order);
  check(`${name}: cada frame es el de FFmpeg (media < 3, máximo < 64)`, worstMean < 3 && worstMax < 64, `media ${worstMean.toFixed(2)}, máximo ${worstMax}`);
  // Cine: al pulsar la imagen se reproduce (cambia el frame pintado varias veces en 1 s)
  const canvas = page.locator('basic-image-viewer canvas.viewer-image');
  const paintsBefore = +(await canvas.getAttribute('data-paint-count'));
  await canvas.click();
  await page.waitForTimeout(1000);
  await canvas.click();
  const paintsAfter = +(await canvas.getAttribute('data-paint-count'));
  check(`${name}: en cine se pintan frames seguidos (25 fps)`, paintsAfter - paintsBefore >= 10, `${paintsAfter - paintsBefore} pintados en 1 s`);
}
check('sin errores de JavaScript', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
server.close();
console.log(`\n${fails} FAIL / ${checks} comprobaciones (vídeo)`);
process.exit(fails ? 1 : 0);
