[English version](docs/README_ENG.md)

# VisorDicom

VisorDicom es un visor web de imágenes DICOM desarrollado en Angular 21. Este proyecto es completamente open source y está diseñado para visualizar imágenes DICOM directamente desde un navegador web. Es el núcleo de visualización de [https://visordicom.es](https://visordicom.es), alojado en el cloud de AWS.

Las imágenes se leen y se decodifican en el propio navegador: no se suben a ningún servidor.

## Características

- Abre ficheros sueltos, carpetas o un CD/DVD entero: detecta los DICOM por su contenido, sin necesidad de DICOMDIR.
- Organiza lo encontrado en paciente, estudio, modalidad y serie.
- Visor de pila con la rueda del ratón para CT, MR y PT, y visor de lista con reproducción (cine) para ecografía, angiografía y multiframe.
- Selector de ventana VOI cuando el fichero trae varias (por ejemplo "ABDOMEN" y "PULMÓN" en un CT).
- Transfer Syntaxes: Implicit y Explicit VR Little Endian, Explicit VR Big Endian, Deflated, Encapsulated Uncompressed, RLE Lossless, JPEG Baseline, JPEG-LS y JPEG 2000. JPEG Lossless y JPEG Extended también están implementados, pendientes de validar con estudios reales.
- Color y escala de grises según el estándar: MONOCHROME1 y MONOCHROME2, PALETTE COLOR, RGB, YBR_FULL y YBR_FULL_422, rescale, VOI LINEAR, LINEAR_EXACT y SIGMOID.
- Código completamente abierto y personalizable.

## Integración

Si deseas integrar este visor en tu proyecto, puedes enviarme un correo a [zargantana.reader@gmail.com](mailto:zargantana.reader@gmail.com) para negociar los detalles. Eres libre de llevarte el código y reescribirlo como desees, siempre haciendo referencia al autor original, **Zargantana**.

## Licencia

Este proyecto está licenciado bajo la licencia [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0). Puedes usarlo, modificarlo y distribuirlo libremente, siempre y cuando se haga referencia al autor original.

## Documentación Adicional

- **Conformance Statement**: Este proyecto incluye un [Conformance Statement](src/assets/ConformanceStatement.pdf) que detalla las capacidades y limitaciones del visor. La fuente LaTeX está en [docs/ConformanceStatement.tex](docs/ConformanceStatement.tex).
- **Release Notes**: Puedes consultar las [Notas de la Versión](src/assets/ReleaseNotes.txt) para obtener información sobre el desarrollo previo a este repositorio.
- **Batería de regresión DICOM**: [tools/dicom-test](tools/dicom-test/README.md) genera ficheros DICOM sintéticos, sin datos de pacientes, y compara píxel a píxel lo que pinta el visor con lo que dicta el estándar.

## Desarrollo

Requiere Node.js 20.19 o superior (22 o 24 recomendados).

```bash
npm ci
```

### Servidor de Desarrollo

Ejecuta `ng serve` para iniciar un servidor de desarrollo. Navega a `http://localhost:4200/`. La aplicación se recargará automáticamente al realizar cambios en los archivos fuente.

### Construcción

Ejecuta `ng build` para construir el proyecto. Los artefactos de construcción se almacenarán en el directorio `dist/`.

### Pruebas

Cualquier cambio en `src/app/clases` debe pasar la batería de regresión, que tiene que acabar en `0 FAIL`:

```bash
pip install pydicom numpy pillow pyjpegls
python tools/dicom-test/gen_test_dicoms.py
node tools/dicom-test/run_harness.mjs
python tools/dicom-test/check_render.py
```

## Contribuciones

Las contribuciones son bienvenidas. Si deseas colaborar, abre un issue o envía un pull request.

## Contacto

Para cualquier consulta o integración, puedes contactarme en [zargantana.reader@gmail.com](mailto:zargantana.reader@gmail.com).

---
**Autor Original**: Zargantana
