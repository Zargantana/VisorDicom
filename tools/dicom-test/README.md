# Batería de regresión DICOM (sintética, sin PHI)

Ejecuta el **mismo código TypeScript del visor** (parser → decoders → color) en Node sobre ficheros DICOM
generados con pydicom, y compara el RGBA resultante con la "verdad" calculada con pydicom + numpy según
PS3.3 C.11 (Modality LUT → VOI → Presentation).

```bash
pip install pydicom numpy pillow pyjpegls   # pyjpegls es opcional (caso t22, JPEG-LS)
npm ci                                      # esbuild viene con @angular-devkit

python3 tools/dicom-test/gen_test_dicoms.py   # → tools/dicom-test/out/*.dcm + expected.json
node    tools/dicom-test/run_harness.mjs      # → out/render/<fichero>[#wN].f<frame>.rgba + render.json
python3 tools/dicom-test/check_render.py      # → PASS/FAIL por caso + out/render/contact_sheet.png (izq. esperado, dcha. visor)
```

`check_render.py` devuelve un código de salida distinto de 0 si algún caso falla. `out/` está en `.gitignore`.

## Piezas

| Fichero | Qué hace |
|---|---|
| `gen_test_dicoms.py` | Genera un caso por cada situación del estándar que ha dado guerra (ver la tabla) |
| `harness-entry.ts` | Punto de entrada que se empaqueta con esbuild. Usa `ImageDCM.renderFrameRGBA()` (o el camino antiguo si no existe, para medir `main`) |
| `run_harness.mjs` | Stubs mínimos de DOM (`FileReader`, `File`, `print` para CharLS), carga los codecs globales de `src/libs` y renderiza cada fichero con cada ventana VOI (`#w1`, `#w2`…) |
| `check_render.py` | Verdad con pydicom (`pixel_array`, `apply_color_lut`, fórmula VOI LINEAR) y tolerancias (±3 lossless; más holgada para JPEG con pérdida) |

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

## Añadir un caso

1. Añade el fichero en `gen_test_dicoms.py` (función `save()` + `expect()`).
2. Si pydicom no sabe decodificarlo, añade la verdad a mano en `expected_frames()` de `check_render.py`.
3. Ejecuta los tres comandos. Si el visor falla, arréglalo y vuelve a ejecutar.

## Prueba DICOM ↔ S3 en navegador (`s3-body/`)

> Solo en ReadyDoctor: prueba servicios del portal. `tools/sync-to-visordicom.ps1` no la copia a VisorDicom.

`run_s3_body_test.mjs`:
1. Empaqueta con esbuild los servicios **reales** `UploadS3Service`/`DownloadS3Service` + `aws-sdk` (build de navegador).
2. Los ejecuta en Chromium con S3 **simulado** mediante `page.route` (PUT, GET y multipart). No toca AWS.
3. Comprueba que el objeto guardado es **idéntico byte a byte** al fichero original (incluido un fichero de más de 6 MiB, que va por multipart) y que el `Content-Type` es `application/dicom`.
4. Comprueba que la descarga devuelve el mismo *binary string* y que los objetos **antiguos en base64** se siguen leyendo.

```bash
python3 tools/dicom-test/gen_test_dicoms.py
# Playwright: en la raíz, o indicar dónde está instalado con PLAYWRIGHT_MODULE=<ruta a su package.json>
node tools/dicom-test/s3-body/run_s3_body_test.mjs
```

