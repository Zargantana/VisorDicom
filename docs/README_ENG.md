# VisorDicom

VisorDicom is a web-based DICOM image viewer developed in Angular 21. This project is completely open source and designed to view DICOM images directly from a web browser. It is the viewing core of [https://visordicom.es](https://visordicom.es), hosted on the AWS cloud.

Images are read and decoded in the browser itself: nothing is uploaded to any server.

## Features

- Opens single files, folders or a whole CD/DVD: DICOM files are detected by their content, no DICOMDIR needed.
- Organizes what it finds by patient, study, modality and series.
- Stack viewer with mouse-wheel scrolling for CT, MR and PT, and list viewer with cine playback for ultrasound, angiography and multiframe.
- VOI window selector when the file carries several windows (for example "ABDOMEN" and "LUNG" in a CT).
- Transfer Syntaxes: Implicit and Explicit VR Little Endian, Explicit VR Big Endian, Deflated, Encapsulated Uncompressed, RLE Lossless, JPEG Baseline, JPEG-LS and JPEG 2000. JPEG Lossless and JPEG Extended are implemented too, pending validation with real studies.
- Color and grayscale as the standard defines them: MONOCHROME1 and MONOCHROME2, PALETTE COLOR, RGB, YBR_FULL and YBR_FULL_422, rescale, VOI LINEAR, LINEAR_EXACT and SIGMOID.
- Completely open source and customizable.

## Integration

If you'd like to integrate this viewer into your project, please email me at [zargantana.reader@gmail.com](mailto:zargantana.reader@gmail.com) to discuss the details. Feel free to take the code and rewrite it as you wish, always referring to the original author, **Zargantana**.

## License

This project is licensed under the [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) license. You may freely use, modify, and distribute it, as long as the original author is credited.

## Additional Documentation

- **Conformance Statement**: This project includes a [Conformance Statement](../src/assets/ConformanceStatement.pdf) that details the viewer's capabilities and limitations. Its LaTeX source is [ConformanceStatement.tex](ConformanceStatement.tex).
- **Release Notes**: You can refer to the [Release Notes](../src/assets/ReleaseNotes.txt) for information about development prior to this repository.
- **DICOM regression suite**: [tools/dicom-test](../tools/dicom-test/README.md) generates synthetic DICOM files, with no patient data, and compares pixel by pixel what the viewer paints with what the standard requires.

## Development

Requires Node.js 20.19 or later (22 or 24 recommended).

```bash
npm ci
```

### Development Server

Run `ng serve` to start a development server. Navigate to `http://localhost:4200/`. The application will automatically reload when you make changes to the source files.

### Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

### Tests

Any change in `src/app/clases` must pass the regression suite, which has to end with `0 FAIL`:

```bash
pip install pydicom numpy pillow pyjpegls
python tools/dicom-test/gen_test_dicoms.py
node tools/dicom-test/run_harness.mjs
python tools/dicom-test/check_render.py
```

## Contributions

Contributions are welcome. If you'd like to contribute, please open an issue or submit a pull request.

## Contact

For any questions or integration requests, please contact me at [zargantana.reader@gmail.com](mailto:zargantana.reader@gmail.com).

---
**Original Author**: Zargantana
