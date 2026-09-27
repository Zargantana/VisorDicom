# Batería de regresión DICOM (sintética, sin PHI)

Ejecuta el **mismo código TypeScript del visor** (parser → decoders → color) en Node sobre ficheros DICOM
generados con pydicom, y compara el RGBA resultante con la "verdad" calculada con pydicom + numpy según
PS3.3 C.11 (Modality LUT → VOI → Presentation).

```bash
pip install pydicom numpy pillow pyjpegls imagecodecs   # pyjpegls (t22) e imagecodecs (t24-t36) son opcionales
npm ci                                                  # esbuild viene con @angular-devkit; Node 20+ (fs.openAsBlob)

python3 tools/dicom-test/gen_test_dicoms.py   # → tools/dicom-test/out/*.dcm + expected.json
node    tools/dicom-test/run_harness.mjs      # → out/render/<fichero>[#wN].f<frame>.rgba + render.json
python3 tools/dicom-test/check_render.py      # → PASS/FAIL por caso + out/render/contact_sheet.png (izq. esperado, dcha. visor)
```

`check_render.py` devuelve un código de salida distinto de 0 si algún caso falla. `out/` está en `.gitignore`.

El harness lee cada fichero **como el navegador**: entra como `Blob` (`fs.openAsBlob`), `DCMFile` lee la cabecera por
bloques hasta el Pixel Data y cada frame por rangos (`render.json` lo dice en `partial`). Dos variables cambian el camino:

| Variable | Qué hace |
|---|---|
| `DICOM_TEST_HEADER_CHUNK=600` | Primer bloque de cabecera de 600 bytes en vez de 256 KB. Los ficheros de la batería son pequeños y cabrían enteros en el primer bloque (en memoria); así se prueba de verdad la lectura por rangos del Pixel Data (índice de frames, BOT, EOT, fragmentos). Conviene pasarla con varios valores (512, 700, 1100…) tras tocar `DCM-file.class.ts` o `pixel-data-access.ts` |
| `DICOM_TEST_INMEMORY=1` | El camino antiguo en memoria (string binario), el de los objetos antiguos en base64 del portal y la pantalla de test |

La decodificación va siempre en el hilo principal: en Node no hay `Worker` (el pool de Workers del visor, `DecodePool`,
se prueba en el navegador; ver abajo).

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
| `harness-entry.ts` | Punto de entrada que se empaqueta con esbuild. `renderDicom()`: el fichero como `Blob` (o string con `DICOM_TEST_INMEMORY`), `ImageDCM.prepare(f)` y `renderFrameRGBA(f)` frame a frame |
| `run_harness.mjs` | `print` para CharLS (`File` y `Blob` son los de Node 20+), carga los codecs globales de `src/libs`, registra los códecs bajo demanda de `src/assets/codecs` como globales (en Node no hay `<script>`) y renderiza cada fichero con cada ventana VOI (`#w1`, `#w2`…) |
| `check_render.py` | Verdad con pydicom (`pixel_array`, `apply_color_lut`, fórmula VOI LINEAR) y tolerancias (±3 lossless; más holgada para JPEG con pérdida). Si existe `out/ref/<fichero>.npy`, esa es la verdad (TS que pydicom no decodifica). `kind="expect_fail"`: pasa si el visor no decodifica ningún frame y no lanza (con `reason_contains`, además, el motivo que enseña el visor tiene que contenerlo). `decoded_by`: el códec que el visor tiene que reconocer por el contenido. `lossy`: tolerancia de compresión con pérdida |
| `j2k-part2/j2k_part2_mct.c` | Genera un codestream J2K **Part 2** con MCT por matriz (`opj_set_MCT`) para t27 |
| `browser-csp/run_browser_csp_test.mjs` | Prueba en Chromium del build de producción con la CSP de producción (ver abajo) |
| `big-files/gen_big_files.py` + `big-files/measure_big_files.mjs` | Estudios sintéticos pesados y medidor en Chromium (en Windows, canal `chrome` y memoria por WMI). No forman parte de la batería (tardan y ocupan disco). Ver "Ficheros grandes" abajo |
| `real/fetch_real_files.py` | Ficheros DICOM **reales** (ver abajo) |

## Ficheros reales (pydicom y pydicom-data)

Los mismos harness y comprobación sirven para ficheros reales, sin expectativas escritas a mano: `check_render.py`
compara con pydicom cuando pydicom sabe decodificarlos y marca `SKIP` (no `FAIL`) cuando el visor los rechaza de forma
controlada con motivo (SR, RTSTRUCT, waveform, Float Pixel Data…) o cuando pydicom no puede dar la verdad.

```bash
python tools/dicom-test/real/fetch_real_files.py          # → tools/dicom-test/out_real/real_*.dcm (175: los 158 de pydicom y pydicom-data, que se descarga a ~/.pydicom/data, y sus 17 de juegos de caracteres)
DICOM_TEST_OUT=tools/dicom-test/out_real node tools/dicom-test/run_harness.mjs
DICOM_TEST_OUT=tools/dicom-test/out_real python tools/dicom-test/check_render.py
```

Otras variables del harness: `DICOM_TEST_FILTER=<regex>` (solo esos ficheros) y `DICOM_TEST_VERBOSE=1` (traza de cada
fichero).

**Textos.** El harness guarda también los textos que enseña el visor ya decodificados con (0008,0005) (nombre, ID,
descripciones) y si el cargador reconoce el fichero como DICOM (`isDicom`: con preámbulo o sin él). `check_render.py`
compara esos textos con pydicom en una fila propia, `<fichero>#text` (sale en la lista solo si hay caracteres no ASCII
o si difieren). Sin juego declarado, la verdad es el UTF-8 cuando los bytes lo son (el visor lo reconoce; pydicom los
deja en Latin-1). Los ficheros sin preámbulo ni grupo 0002 se leen con `force=True` y la Transfer Syntax que deduce
pydicom.

**Cine.** En los multiframe, el harness guarda qué hará el visor (`cine`: reproducir o pasar frame a frame, y los ms por
frame) y `check_render.py` lo compara, en la fila `<fichero>#cine`, con la misma regla escrita en Python a partir de
las etiquetas que lee pydicom (Frame Time, Frame Time Vector, Recommended Display Frame Rate, Cine Rate y la modalidad).

### Un corpus entero (carpetas anidadas, CD, archivos comprimidos)

Para pasar por el visor todos los ficheros de un árbol de carpetas sin copiarlos (ficheros sin extensión, DICOMDIR,
`.zip`/`.tar`/`.tar.bz2`):

```bash
python tools/dicom-test/real/scan_corpus.py <carpeta> --out tools/dicom-test/out_corpus --extract   # inventario + manifest.json
python tools/dicom-test/real/run_corpus.py            # harness (por manifiesto, reanudable) + check_render + out_corpus/report.md
node tools/dicom-test/real/cd_browser_test.mjs <carpeta de un CD> --python <python con pydicom>   # carga por carpeta en Chrome
```

`classify_corpus.mjs <carpeta>` monta el árbol paciente → estudio → modalidad → serie con el clasificador del visor en
Node (sin navegador) y lo compara con pydicom; sirve para cualquier carpeta y para `out/`.

`run_corpus.py` usa `DICOM_TEST_MANIFEST` (clave → ruta), `DICOM_TEST_MAX_MB` (con `--max-mb N`: los mayores se marcan
BIG sin probarlos; por defecto ninguno, el visor ya no tiene el tope de ≈512 MB del string), `DICOM_TEST_MAX_FRAMES_OUT` (3: en multiframes grandes solo se
guardan y comparan el primer frame, el central y el último, `writtenFrames`; pydicom solo decodifica esos),
`DICOM_TEST_MAX_WINDOWS` (2), `DICOM_TEST_RESUME` (si un fichero tumba Node, queda como CRASH y se relanza) y, con
`--skip-multiframe frames,MB`, `DICOM_TEST_SKIP_MULTIFRAME` (las láminas de patología por tiles, con miles de frames,
se marcan TILES sin decodificarlas: el visor las enseña como un cine de tiles, no como una lámina). El informe agrupa por carpeta, Transfer
Syntax y modalidad, y lista FAIL, CRASH, BIG y los motivos de los SKIP. `cd_browser_test.mjs` carga la carpeta entera
por la interfaz ("Selecciona la unidad o carpeta"), compara el recuento del cargador y el árbol paciente → estudio →
serie de la tabla de hallazgos con `expected_tree.py` (pydicom) y mide tiempos y memoria. El juego trae muestras NEMA WG04 (US1/RG1/RG3/MR2/693 en J2K y HTJ2K), Big Endian de todos los tipos (SC
8/16/32 bits, paleta, RLE), JPEG de DCMTK y GDCM, Siemens con overlays, Aloka US, multiframe mejorado (`eCT_Supplemental`),
mapas paramétricos en coma flotante, juegos de caracteres (árabe, hebreo, ruso, griego, japonés, coreano, chino), etc.
Estado el 2026-09-27: **0 FAIL de 195 casos**, con los textos de los ficheros de juegos de caracteres iguales a pydicom. Sigue sin
haber muestras públicas de las TS privadas (GE DLX, Papyrus, Sectra): `gdcmData` de SourceForge no se deja descargar en
crudo (403), hay que bajarlo a mano.

## Casos

| Caso | Qué ejercita |
|---|---|
| t01 (×12) | Serie CT Explicit VR LE con 2 ventanas "ABDOMEN\PULMON" (selector de ventana, scroll viewer) |
| t02 | CT Implicit VR, 1 ventana, con signo |
| t03 | MR 12 bits sin ventana (auto min/max) |
| t04 | **Deflated** Explicit VR LE, 3 ventanas, slope 0.5 (DS con decimales) |
| t90, t90b | **Deflated** de 512x512 con ruido y bytes tras el stream deflate: el byte nulo de relleno de PS3.5 A.5 (t90) y un trailer gzip de 8 bytes (t80b, como `image_dfl.dcm` de pydicom). El `DecompressionStream` de Chrome da error con esos bytes y descartaba lo inflado sin leer (se perdía el final de la imagen); t04 es tan pequeño que no lo destapa. En Node pasan siempre: el fallo solo se ve en la prueba en navegador |
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
| t78 | **Multiframe mejorado** con functional groups de **longitud definida** (Siemens, Toshiba): rescale compartido y ventana distinta en cada frame (SIGMOID, LINEAR_EXACT). El lector entra en las secuencias de longitud definida y el pintado usa la ventana y el rescale del frame |
| t79 | **VOI LUT Sequence** (0028,3010) de longitud definida en una CR MONOCHROME1 de 12 bits: LUT normalizada por su mínimo y máximo, buscada dentro de la secuencia (no en la Modality LUT) |
| t89 | VOI LUT con **primer valor mapeado negativo** (descriptor US 63488 = -2048) en un CT de 12 bits con signo sin rescale (PS3.3 C.11.2.1.1: SS si la entrada de la LUT puede ser negativa). Antes salía negra |
| t80-t84 | **Specific Character Set** (0008,0005): UTF-8 (ISO_IR 192), Latin-1 (ISO_IR 100), japonés con ISO 2022 (`\ISO 2022 IR 87`, nombre con los tres grupos), coreano con ISO 2022 (`\ISO 2022 IR 149`) y griego (ISO_IR 126). Los textos se comparan con pydicom (`#text`) |
| t85 | UTF-8 **sin declarar** (0008,0005): el visor lo lee como UTF-8 porque los bytes lo son |
| t86-t88 | DICOM **sin preámbulo**: dataset crudo en Implicit VR LE sin grupo 0002 (ACR-NEMA 2.0, MESA); grupo 0002 sin los 128 bytes ni "DICM"; "DICM" al principio sin los 128 bytes. Forman una serie de tres cortes, para subirlos juntos al portal (`E2E_FILES`) |
| t91-t95 | **Cine de los multiframe** (`Images/cine.ts`, fila `#cine`): MR sin tiempos (cortes: sin play, el clic pasa de frame), XA sin tiempos (15 fps, los de su modalidad), US con solo Frame Time Vector, NM con Recommended Display Frame Rate (cine porque el fichero lo pide) y OT con solo Cine Rate |
| t77 | JPEG Baseline con **bytes de relleno 0xFF** delante de SOS y EOI (ISO 10918-1 B.1.1.2; las miniaturas "DicomObjects" de las láminas 3DHISTECH): el decoder los quita antes de JpegImage/libjpeg-turbo |
| t76 (×2) | **Mismo estudio con dos Study Date distintas** (pasa en CD reales): el clasificador agrupa por Study Instance UID. Lo comprueba `real/classify_corpus.mjs tools/dicom-test/out` (árbol del visor frente a pydicom), que conviene pasar tras tocar `classifier-DCM.class.ts` |

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
- en los rechazos (`expect_fail`), que el visor pinta el cartel "Imagen no disponible" con el motivo (atributo `data-unsupported` del `<canvas>`, que también va en `title`).

El visor pinta en un `<canvas>` con `putImageData` (antes, un PNG en `data:` URL por frame en un `<img>`; las pruebas
aceptan los dos para poder pasarse contra producción antes de desplegar). Atributos del canvas: `data-painted`
(`<id del fichero>:<frame>` pintado), `data-paint-count` (pintadas) y `data-unsupported` (motivo del cartel).

`[Worker]` al final de la línea: el frame se ha decodificado en el pool de Workers (`DecodePool`, JPEG, JPEG-LS,
JPEG 2000, HTJ2K y RLE; lo nativo se queda en el hilo principal). Para comprobar la vuelta al hilo principal cuando los
Workers no pueden arrancar: `CSP="<la de producción con worker-src 'none'>" CSP_ALLOW=worker node run_browser_csp_test.mjs`
(`CSP_ALLOW=<regex>` tolera las violaciones que casen). Con `DICOM_TEST_OUT=tools/dicom-test/out_real` y el patrón
`real_` se pasan los ficheros reales: sin `expected.json`, espera el cartel donde el harness no decodificó nada y salta
(SKIP) los que no son imagen (Rows = 0: DICOMDIR, RTSTRUCT, SR…).

Hay que pasarla si cambian los códecs, la forma de cargarlos o la CSP. Chromium: `CHROMIUM=<ruta>` (por defecto `/opt/pw-browsers/chromium`; en Windows sirve el `chrome.exe` de Chrome o el `msedge.exe` de Edge: la prueba se pasa en los dos).

`browser-csp/check_production.mjs` hace lo mismo contra la web desplegada (`https://visordicom.es`, cabeceras reales de CloudFront) con los ficheros de `out/` que se le indiquen.

## Ficheros grandes

```bash
python3 tools/dicom-test/big-files/gen_big_files.py [--2gb]      # → tools/dicom-test/out/big/ (≈4,5 GB; con --2gb, +2 GB)
npx ng build --configuration production
PLAYWRIGHT_MODULE=<package.json con playwright> node tools/dicom-test/big-files/measure_big_files.mjs [dist] [ficheros o carpetas]
```

Casos: XA nativos de 1000 frames (250 MB) y 2200 frames (550 MB), CT de 600 cortes (carpeta, 300 MB), XA JPEG baseline
1024x1024 de 3000 frames (≈1,5 GB) con y sin Basic Offset Table, y con `--2gb` un XA nativo de 8000 frames (2 GB). Todo
se escribe en *streaming* (no hace falta tener el fichero en memoria para generarlo).

El medidor abre cada fichero (o carpeta) por la interfaz y da: lectura, primera imagen y memoria del renderer tras leer
y tras pintar; luego una fase de uso (cine 8 s en un fichero, 300 pasos de rueda en una carpeta; `MEASURE_NO_USAGE=1`
la salta) con imágenes pintadas por segundo, memoria antes y después de recoger basura (Chromium con `--expose-gc`,
también en los Workers) y cuántos Workers de decodificación hay. La memoria tiene que quedarse cerca del presupuesto de
la caché de frames (`FrameCache`: 256 MB en PC, 128 MB en móvil) más los Workers. También prueba
`FileReader.readAsBinaryString` con cada fichero (≈512 MiB de tope en Chromium: a partir de ahí devuelve `null` sin
error), como referencia: el visor ya no lo usa.

Referencia (Linux, Chromium, 4 núcleos, 2026-09-27):

| Fichero | Primera imagen | Uso | Memoria tras el uso |
|---|---|---|---|
| CT 600 cortes (carpeta) | ≈1 s | rueda, 10 imágenes/s | +208 MB |
| XA nativo 250 MB / 550 MB / 2 GB | ≈0,25 s | cine 29,8 imágenes/s (FrameTime 33 ms) | +80 MB |
| XA JPEG 1024x1024, 3000 frames (1,5 GB) | ≈0,4 s | cine 28 imágenes/s, 3 Workers | +303 MB (caché llena) |

## Añadir un caso

1. Añade el fichero en `gen_test_dicoms.py` (función `save()` + `expect()`; `save_encapsulated()` si la TS es encapsulada).
2. Si pydicom no sabe decodificarlo, guarda la verdad en `out/ref/<fichero>.npy` (lo hace `save_encapsulated()`) o añádela a mano en `expected_frames()` de `check_render.py`.
3. Ejecuta los tres comandos. Si el visor falla, arréglalo y vuelve a ejecutar.


