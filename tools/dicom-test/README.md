# Batería de regresión DICOM (sintética, sin PHI)

Ejecuta el **mismo código TypeScript del visor** (parser → decoders → color) en Node sobre ficheros DICOM
generados con pydicom, y compara el RGBA resultante con la "verdad" calculada con pydicom + numpy según
PS3.3 C.11 (Modality LUT → VOI → Presentation).

```bash
pip install pydicom numpy pillow pyjpegls imagecodecs   # pyjpegls (t22) e imagecodecs (t24-t36) son opcionales
npm ci                                                  # esbuild viene con @angular-devkit

python3 tools/dicom-test/gen_test_dicoms.py   # → tools/dicom-test/out/*.dcm + expected.json
node    tools/dicom-test/run_harness.mjs      # → out/render/<fichero>[#wN].f<frame>.rgba + render.json
python3 tools/dicom-test/check_render.py      # → PASS/FAIL por caso + out/render/contact_sheet.png (izq. esperado, dcha. visor)
```

`check_render.py` devuelve un código de salida distinto de 0 si algún caso falla. `out/` está en `.gitignore`.

**Dependencias opcionales.** Si falta una herramienta, `gen_test_dicoms.py` omite sus casos y lo dice en la salida. Un `0 FAIL` con casos omitidos **no prueba** esas TS:

| Herramienta | Casos | Instalación |
|---|---|---|
| `pyjpegls` | t22 (JPEG-LS) | `pip install pyjpegls` (en Windows, Python 3.12) |
| `imagecodecs` (libjpeg-turbo, OpenJPEG y OpenJPH nativos) | t24-t31 (HTJ2K, J2K RGB, JPEG lossless 12/16 bits, JPEG 12 bits) | `pip install imagecodecs` |
| `cjpeg` de libjpeg-turbo | t32-t36 (JPEG aritmético, progresivo, *spectral selection*) | `apt install libjpeg-turbo-progs`; en Windows viene con libjpeg-turbo |
| `gcc` + `libopenjp2-dev` | t27 (J2K Part 2 con MCT por matriz: **fallo esperado**) | `apt install gcc libopenjp2-7-dev`. Compila `j2k-part2/j2k_part2_mct.c`: el `opj_compress` de las distros no acepta `-m` |

## Piezas

| Fichero | Qué hace |
|---|---|
| `gen_test_dicoms.py` | Genera un caso por cada situación del estándar que ha dado guerra (ver la tabla) |
| `harness-entry.ts` | Punto de entrada que se empaqueta con esbuild. Usa `ImageDCM.renderFrameRGBA()` (o el camino antiguo si no existe, para medir `main`) |
| `run_harness.mjs` | Stubs mínimos de DOM (`FileReader`, `File`, `print` para CharLS), carga los codecs globales de `src/libs`, registra los códecs bajo demanda de `src/assets/codecs` como globales (en Node no hay `<script>`) y renderiza cada fichero con cada ventana VOI (`#w1`, `#w2`…). Llama a `ImageDCM.prepare()` antes de pintar |
| `check_render.py` | Verdad con pydicom (`pixel_array`, `apply_color_lut`, fórmula VOI LINEAR) y tolerancias (±3 lossless; más holgada para JPEG con pérdida). Si existe `out/ref/<fichero>.npy`, esa es la verdad (TS que pydicom no decodifica). `kind="expect_fail"`: pasa si el visor no decodifica ningún frame y no lanza (con `reason_contains`, además, el motivo que enseña el visor tiene que contenerlo). `decoded_by`: el códec que el visor tiene que reconocer por el contenido. `lossy`: tolerancia de compresión con pérdida |
| `j2k-part2/j2k_part2_mct.c` | Genera un codestream J2K **Part 2** con MCT por matriz (`opj_set_MCT`) para t27 |
| `browser-csp/run_browser_csp_test.mjs` | Prueba en Chromium del build de producción con la CSP de producción (ver abajo) |
| `big-files/gen_big_files.py` + `big-files/measure_big_files.mjs` | Estudios sintéticos pesados (XA de 250 y 550 MB, CT de 600 cortes) y medidor de tiempos y memoria del renderer en Chromium (en Windows, canal `chrome` y memoria por WMI): línea base para la carga por trozos. No forman parte de la batería (tardan y ocupan disco). Con el XA de 550 MB imprime el `aviso:` del cargador (tope de ≈512 MiB por fichero) |
| `real/fetch_real_files.py` | Ficheros DICOM **reales** (ver abajo) |

## Ficheros reales (pydicom y pydicom-data)

Los mismos harness y comprobación sirven para ficheros reales, sin expectativas escritas a mano: `check_render.py`
compara con pydicom cuando pydicom sabe decodificarlos y marca `SKIP` (no `FAIL`) cuando el visor los rechaza de forma
controlada con motivo (SR, RTSTRUCT, waveform, Float Pixel Data…) o cuando pydicom no puede dar la verdad.

```bash
python tools/dicom-test/real/fetch_real_files.py          # → tools/dicom-test/out_real/real_*.dcm (158 ficheros; descarga pydicom-data a ~/.pydicom/data)
DICOM_TEST_OUT=tools/dicom-test/out_real node tools/dicom-test/run_harness.mjs
DICOM_TEST_OUT=tools/dicom-test/out_real python tools/dicom-test/check_render.py
```

Otras variables del harness: `DICOM_TEST_FILTER=<regex>` (solo esos ficheros) y `DICOM_TEST_VERBOSE=1` (traza de cada
fichero). El juego trae muestras NEMA WG04 (US1/RG1/RG3/MR2/693 en J2K y HTJ2K), Big Endian de todos los tipos (SC
8/16/32 bits, paleta, RLE), JPEG de DCMTK y GDCM, Siemens con overlays, Aloka US, multiframe mejorado (`eCT_Supplemental`),
mapas paramétricos en coma flotante, etc. Estado el 2026-09-26: **0 FAIL, 132 PASS, 29 SKIP** de 163 casos. Sigue sin
haber muestras públicas de las TS privadas (GE DLX, Papyrus, Sectra): `gdcmData` de SourceForge no se deja descargar en
crudo (403), hay que bajarlo a mano.

## Casos

| Caso | Qué ejercita |
|---|---|
| t01 (×12) | Serie CT Explicit VR LE con 2 ventanas "ABDOMEN\PULMON" (selector de ventana, scroll viewer) |
| t02 | CT Implicit VR, 1 ventana, con signo |
| t03 | MR 12 bits sin ventana (auto min/max) |
| t04 | **Deflated** Explicit VR LE, 3 ventanas, slope 0.5 (DS con decimales) |
| t05 | Explicit VR **Big Endian** |
| t06 | US **RGB nativo multiframe** (5 frames) |
| t07 | CR **MONOCHROME1** |
| t08 | JPEG Baseline, 1 frame en **3 fragmentos** |
| t09 | JPEG Baseline, 4 frames × 2 fragmentos con **BOT** |
| t10 / t11 / t12 | RLE mono 8 bits / **16 bits** / **RGB** |
| t13 / t13b | **PALETTE COLOR** nativo (Explicit / **Implicit** VR) |
| t14 / t14b | JPEG 2000 lossless 16 bits / **multi-tile** |
| t15 | **Encapsulated Uncompressed** (1.2.840.10008.1.2.1.98) |
| t16 | **Icon Image Sequence** de longitud indefinida (no debe pisar Rows/Cols) |
| t17 | **Secuencia privada** de longitud indefinida en Implicit VR |
| t18 | VR de 4 bytes de longitud: **UT/UC/UR** |
| t19 / t20 / t21 | RLE **YBR_FULL** / **YBR_FULL_422** nativo / RGB **Planar Configuration 1** |
| t22 | **JPEG-LS** 16 bits con signo, 2 ventanas (si está pyjpegls) |
| t23 | CT **12 bits con signo** dentro de 16 (extensión de signo) |
| t24 / t25 / t26 | **HTJ2K** lossless 12 bits (.201) / RPCL RGB con RCT (.202) / con pérdida, CT con 2 ventanas (.203) |
| t27 | J2K **Part 2** con MCT por matriz (.93): **fallo esperado**, el visor debe rechazarlo sin lanzar |
| t28 | J2K lossless **RGB con RCT** (.90) |
| t29 / t30 | JPEG lossless **SV1 12 bits** (.70) / **predictor 6, 16 bits con signo** (.57) |
| t31 | JPEG Extended **12 bits** (.51) |
| t32 / t33 / t34 | JPEG **aritmético** RGB (.52) / **progresivo** RGB (.55) / progresivo aritmético gris (.56) |
| t35 / t36 | JPEG ***spectral selection*** Huffman (.53) / aritmético (.54) |
| t40 | **YBR_PARTIAL_422** nativo |
| t41 / t42 / t43 | **HSV** / **CMYK** / **ARGB** con Planar Configuration 1 |
| t44 | **Paleta segmentada** (opcodes discreto, lineal e indirecto) |
| t45 | **Supplemental Palette** (MONOCHROME2, Pixel Presentation MIXED, *first mapped* 1000) |
| t46 | MONOCHROME2 con Presentation LUT Shape **INVERSE** |
| t47 | CT con **Pixel Padding** −2000 sin ventana (negro y fuera de la auto-ventana) |
| t60 / t61 / t62 / t63 | TS **privadas y retiradas** decodificables: GE Implicit VR LE con píxeles **Big Endian** (1.2.840.113619.5.2), Philips CT-private-ELE (1.3.46.670589.33.1.4.1), **Papyrus 3** (1.2.840.10008.1.20) y PixelMed Encapsulated Raw con 3 frames (1.3.6.1.4.1.5962.300.2) |
| t64 / t65 | **Sectra Compression LS** (1.2.752.24.3.7.7) y una TS desconocida con un *bitstream* opaco: rechazo con motivo (`reason_contains`) |
| t66-t73 | **Códec estándar bajo una TS privada ficticia** (raíz 2.25): RLE, JPEG baseline RGB, sin comprimir en Implicit VR (el parser detecta la VR), JPEG lossless, JPEG-LS, JPEG 2000, HTJ2K y JPEG progresivo. El visor lo reconoce por el contenido (`codec-sniffer.ts`, `decoded_by`) |
| t74 | CT **Explicit VR Big Endian** con una secuencia de longitud definida y un OB privado antes del Pixel Data (las longitudes de 4 bytes en BE se leían con las mitades cambiadas) |
| t75 | J2K con la **cabecera SIZ corrupta** (bytes de un delimitador FFFE,E0DD dentro del codestream, como en pydicom-data): rechazo con motivo; jpx.js no debe reservar memoria según un Xsiz absurdo |

Los casos encapsulados con TS que pydicom no sabe escribir (HTJ2K…) se guardan con un UID conocido de la misma longitud y luego se parchea el *meta header* (`save_encapsulated()`).

## Prueba en navegador con la CSP de producción

```bash
npx ng build --configuration production
PLAYWRIGHT_MODULE=<package.json donde esté playwright> node tools/dicom-test/browser-csp/run_browser_csp_test.mjs [dist/ready-doctor-web] [regex de ficheros]
```

Sirve el `dist` con las mismas cabeceras de seguridad que producción (CSP, `nosniff`, Referrer-Policy) y *fallback* SPA, carga cada `.dcm` de `out/` por la UI ("Encontrar imágenes" → "Unos ficheros."), y comprueba:
- que la imagen se pinta y que sus píxeles son **iguales** a los del harness (`out/render/<fichero>.f0.rgba`);
- que no hay violaciones de CSP ni errores de página;
- qué códecs de `assets/codecs` se descargan y con qué `Content-Type`;
- en los rechazos (`expect_fail`), que el visor pinta el cartel "Imagen no disponible" con el motivo (atributo `data-unsupported` del `<img>`, que también va en `title`).

Hay que pasarla si cambian los códecs, la forma de cargarlos o la CSP. Chromium: `CHROMIUM=<ruta>` (por defecto `/opt/pw-browsers/chromium`; en Windows sirve el `chrome.exe` de Chrome o el `msedge.exe` de Edge: la prueba se pasa en los dos).

`browser-csp/check_production.mjs` hace lo mismo contra la web desplegada (`https://visordicom.es`, cabeceras reales de CloudFront) con los ficheros de `out/` que se le indiquen.

## Añadir un caso

1. Añade el fichero en `gen_test_dicoms.py` (función `save()` + `expect()`; `save_encapsulated()` si la TS es encapsulada).
2. Si pydicom no sabe decodificarlo, guarda la verdad en `out/ref/<fichero>.npy` (lo hace `save_encapsulated()`) o añádela a mano en `expected_frames()` de `check_render.py`.
3. Ejecuta los tres comandos. Si el visor falla, arréglalo y vuelve a ejecutar.


