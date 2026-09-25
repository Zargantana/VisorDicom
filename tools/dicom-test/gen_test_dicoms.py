#!/usr/bin/env python3
"""
Generador de DICOM sinteticos (sin PHI) para la bateria de regresion del visor.

Uso:
    pip install pydicom numpy pillow
    python3 tools/dicom-test/gen_test_dicoms.py [carpeta_salida]   (por defecto tools/dicom-test/out)

Cada fichero ejercita un caso concreto del parser / decoders / pipeline de color
(ver tools/dicom-test/README.md). Tambien escribe expected.json con los valores
esperados que usa run_harness.mjs para comparar.
"""
import io
import json
import os
import sys

import numpy as np
from PIL import Image
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.encaps import encapsulate
from pydicom.sequence import Sequence
from pydicom.uid import (UID, ExplicitVRLittleEndian, ImplicitVRLittleEndian,
                         ExplicitVRBigEndian, DeflatedExplicitVRLittleEndian,
                         JPEGBaseline8Bit, JPEG2000Lossless, RLELossless,
                         generate_uid)

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)

STUDY_CT = generate_uid()
SERIES_CT = generate_uid()
EXPECTED = {}

R, C = 64, 80  # no cuadrado: detecta filas/columnas cruzadas


def base_ds(modality, sop_class="1.2.840.10008.5.1.4.1.1.7", study=None, series=None, inst=1, series_no=1):
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.MediaStorageSOPClassUID = sop_class
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.file_meta.ImplementationClassUID = generate_uid()
    ds.SOPClassUID = sop_class
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.PatientName = "TEST^SYNTHETIC"
    ds.PatientID = "SYNTH-001"
    ds.PatientBirthDate = "19700101"
    ds.PatientSex = "O"
    ds.StudyDate = "20260925"
    ds.StudyDescription = "SYNTHETIC REGRESSION"
    ds.Modality = modality
    ds.StudyInstanceUID = study or generate_uid()
    ds.SeriesInstanceUID = series or generate_uid()
    ds.SeriesNumber = series_no
    ds.InstanceNumber = inst
    return ds


def ct_hu(shift=0):
    """Rampa horizontal -1000..1000 HU + un disco a 300 HU + un cuadrado a -700 HU."""
    x = np.linspace(-1000, 1000, C)
    img = np.tile(x, (R, 1))
    yy, xx = np.mgrid[0:R, 0:C]
    img[(yy - R // 2) ** 2 + (xx - C // 3 - shift) ** 2 < 100] = 300
    img[5:15, C - 20:C - 8] = -700
    return img.round().astype(np.int16)


def set_mono16(ds, stored, signed, slope=1.0, intercept=-1024.0):
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.Rows, ds.Columns = stored.shape[-2], stored.shape[-1]
    ds.BitsAllocated = 16
    ds.BitsStored = 12 if not signed else 16
    ds.HighBit = ds.BitsStored - 1
    ds.PixelRepresentation = 1 if signed else 0
    ds.RescaleIntercept = intercept
    ds.RescaleSlope = slope
    ds.RescaleType = "HU"


def save(ds, name, ts, **kw):
    ds.file_meta.TransferSyntaxUID = ts
    path = os.path.join(OUT, name)
    implicit = ts == ImplicitVRLittleEndian
    little = ts != ExplicitVRBigEndian
    ds.save_as(path, enforce_file_format=True, implicit_vr=implicit, little_endian=little)
    return path


def expect(name, **kw):
    EXPECTED[name] = kw


# --- t01: CT Explicit VR LE, 2 ventanas (slider visible) -------------------------------
for i in range(12):  # serie de 12 imagenes -> activa scroll viewer (CT > 10)
    hu = ct_hu(shift=i)
    stored = (hu + 1024).astype(np.uint16)
    ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2", STUDY_CT, SERIES_CT, inst=i + 1)
    set_mono16(ds, stored, signed=False)
    ds.WindowCenter = [40, -600]
    ds.WindowWidth = [400, 1500]
    ds.WindowCenterWidthExplanation = ["ABDOMEN", "PULMON"]
    ds.PixelData = stored.tobytes()
    save(ds, f"t01_ct_evle_2win_{i + 1:02d}.dcm", ExplicitVRLittleEndian)
expect("t01_ct_evle_2win_01.dcm", rows=R, cols=C, frames=1, windows=2, kind="ct")

# --- t02: CT Implicit VR LE, 1 ventana (slider oculto), signed ---------------------------
hu = ct_hu()
stored = (hu + 1024).astype(np.int16)
ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2")
set_mono16(ds, stored, signed=True)
ds.WindowCenter = 40
ds.WindowWidth = 400
ds.PixelData = stored.tobytes()
save(ds, "t02_ct_ivle_1win.dcm", ImplicitVRLittleEndian)
expect("t02_ct_ivle_1win.dcm", rows=R, cols=C, frames=1, windows=1, kind="ct")

# --- t03: MR Implicit, sin ventana (auto min/max), 12 bits ------------------------------
mr = np.tile(np.linspace(0, 3000, C), (R, 1)).astype(np.uint16)
ds = base_ds("MR", "1.2.840.10008.5.1.4.1.1.4")
set_mono16(ds, mr, signed=False, slope=1.0, intercept=0.0)
del ds.RescaleType
ds.PixelData = mr.tobytes()
save(ds, "t03_mr_ivle_nowin.dcm", ImplicitVRLittleEndian)
expect("t03_mr_ivle_nowin.dcm", rows=R, cols=C, frames=1, windows=0, kind="mr_auto")

# --- t04: CT Deflated Explicit VR LE, 3 ventanas, slope fraccional ----------------------
hu = ct_hu()
stored = ((hu + 1024) * 2).astype(np.uint16)  # slope 0.5
ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2")
set_mono16(ds, stored, signed=False, slope=0.5, intercept=-1024.0)
ds.WindowCenter = [40, -600, 400]
ds.WindowWidth = [400, 1500, 1800]
ds.WindowCenterWidthExplanation = ["ABDOMEN", "PULMON", "HUESO"]
ds.PixelData = stored.tobytes()
save(ds, "t04_ct_deflate_3win.dcm", DeflatedExplicitVRLittleEndian)
expect("t04_ct_deflate_3win.dcm", rows=R, cols=C, frames=1, windows=3, kind="ct")

# --- t05: CT Explicit VR Big Endian (retirado) -------------------------------------------
hu = ct_hu()
stored = (hu + 1024).astype(np.uint16)
ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2")
set_mono16(ds, stored, signed=False)
ds.WindowCenter = 40
ds.WindowWidth = 400
ds.PixelData = stored.astype(">u2").tobytes()
try:
    save(ds, "t05_ct_evbe.dcm", ExplicitVRBigEndian)
    expect("t05_ct_evbe.dcm", rows=R, cols=C, frames=1, windows=1, kind="ct")
except Exception as e:  # pragma: no cover
    print("t05 skipped:", e)

# --- t06: US RGB nativo multiframe (5 frames, planar 0) ---------------------------------
frames = []
for f in range(5):
    rgb = np.zeros((R, C, 3), np.uint8)
    rgb[..., 0] = np.linspace(0, 255, C).astype(np.uint8)[None, :]
    rgb[..., 1] = np.linspace(0, 255, R).astype(np.uint8)[:, None]
    rgb[..., 2] = 40 * f
    frames.append(rgb)
arr = np.stack(frames)
ds = base_ds("US", "1.2.840.10008.5.1.4.1.1.3.1")
ds.SamplesPerPixel = 3
ds.PhotometricInterpretation = "RGB"
ds.PlanarConfiguration = 0
ds.Rows, ds.Columns = R, C
ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
ds.NumberOfFrames = 5
ds.FrameTime = 40
ds.PixelData = arr.tobytes()
save(ds, "t06_us_rgb_native_5f.dcm", ExplicitVRLittleEndian)
expect("t06_us_rgb_native_5f.dcm", rows=R, cols=C, frames=5, windows=0, kind="rgb_frames", blue_step=40)

# --- t07: CR MONOCHROME1 (hay que invertir) ---------------------------------------------
cr = np.tile(np.linspace(0, 4095, C), (R, 1)).astype(np.uint16)
ds = base_ds("CR", "1.2.840.10008.5.1.4.1.1.1")
set_mono16(ds, cr, signed=False, slope=1.0, intercept=0.0)
del ds.RescaleType
ds.PhotometricInterpretation = "MONOCHROME1"
ds.WindowCenter = 2048
ds.WindowWidth = 4096
ds.PixelData = cr.tobytes()
save(ds, "t07_cr_mono1.dcm", ExplicitVRLittleEndian)
expect("t07_cr_mono1.dcm", rows=R, cols=C, frames=1, windows=1, kind="mono1_ramp")


def jpeg_bytes(img, mode):
    b = io.BytesIO()
    Image.fromarray(img, mode).save(b, "JPEG", quality=95)
    return b.getvalue()


# --- t08: JPEG Baseline 1 frame partido en 3 fragmentos ---------------------------------
rgb = np.zeros((R, C, 3), np.uint8)
rgb[..., 0] = 200
rgb[..., 1] = np.linspace(0, 255, C).astype(np.uint8)[None, :]
rgb[..., 2] = 50
jb = jpeg_bytes(rgb, "RGB")
third = (len(jb) // 3) & ~1
frags = [jb[:third], jb[third:2 * third], jb[2 * third:]]
ds = base_ds("XC", "1.2.840.10008.5.1.4.1.1.77.1.4")
ds.SamplesPerPixel = 3
ds.PhotometricInterpretation = "YBR_FULL_422"
ds.PlanarConfiguration = 0
ds.Rows, ds.Columns = R, C
ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
# Item vacio = BOT; luego 3 fragmentos del mismo frame
from pydicom.encaps import itemize_fragment
data = itemize_fragment(b"") + b"".join(itemize_fragment(f if len(f) % 2 == 0 else f + b"\x00") for f in frags)
ds.PixelData = data
ds["PixelData"].is_undefined_length = True
ds["PixelData"].VR = "OB"
save(ds, "t08_jpeg_baseline_3frag.dcm", JPEGBaseline8Bit)
expect("t08_jpeg_baseline_3frag.dcm", rows=R, cols=C, frames=1, windows=0, kind="rgb_const_r", r=200)

# --- t09: JPEG Baseline multiframe gris, 4 frames, cada frame en 2 fragmentos + BOT -------
fr_bytes = []
for f in range(4):
    g = np.full((R, C), 30 + 60 * f, np.uint8)
    g[:, : C // 4] = 255
    fr_bytes.append(jpeg_bytes(g, "L"))
ds = base_ds("XA", "1.2.840.10008.5.1.4.1.1.12.1")
ds.SamplesPerPixel = 1
ds.PhotometricInterpretation = "MONOCHROME2"
ds.Rows, ds.Columns = R, C
ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
ds.NumberOfFrames = 4
ds.FrameTime = 66.6
ds.PixelData = encapsulate(fr_bytes, fragments_per_frame=2, has_bot=True)
ds["PixelData"].is_undefined_length = True
ds["PixelData"].VR = "OB"
save(ds, "t09_jpeg_mf_2frag_bot.dcm", JPEGBaseline8Bit)
expect("t09_jpeg_mf_2frag_bot.dcm", rows=R, cols=C, frames=4, windows=0, kind="gray_frames", base=30, step=60)


def rle_encode_bytes(b):
    """PackBits simple (solo literales de hasta 128 bytes) - valido segun PS3.5 Annex G."""
    out = bytearray()
    i = 0
    while i < len(b):
        n = min(128, len(b) - i)
        out.append(n - 1)
        out += b[i:i + n]
        i += n
    if len(out) % 2:
        out.append(0x80)  # no-op
    return bytes(out)


def rle_frame(planes):
    segs = [rle_encode_bytes(p) for p in planes]
    header = [len(segs)] + [0] * 15
    off = 64
    for k, s in enumerate(segs):
        header[k + 1] = off
        off += len(s)
    return np.array(header, "<u4").tobytes() + b"".join(segs)


def rle_file(name, arr, photometric, samples, bits, expected):
    ds = base_ds("US" if samples == 3 else "CT", "1.2.840.10008.5.1.4.1.1.7")
    ds.SamplesPerPixel = samples
    ds.PhotometricInterpretation = photometric
    if samples == 3:
        ds.PlanarConfiguration = 1  # tipico en RLE
    ds.Rows, ds.Columns = R, C
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = bits, bits, bits - 1, 0
    planes = []
    if samples == 1 and bits == 8:
        planes = [arr.tobytes()]
    elif samples == 1 and bits == 16:
        planes = [(arr >> 8).astype(np.uint8).tobytes(), (arr & 0xFF).astype(np.uint8).tobytes()]
    elif samples == 3:
        planes = [arr[..., k].tobytes() for k in range(3)]
    ds.PixelData = encapsulate([rle_frame(planes)])
    ds["PixelData"].is_undefined_length = True
    ds["PixelData"].VR = "OB"
    if bits == 16:
        ds.WindowCenter, ds.WindowWidth = 2048, 4096
    return ds


# --- t10/t11/t12: RLE 8 bits mono, 16 bits mono, RGB ------------------------------------
g8 = np.tile(np.linspace(0, 255, C).astype(np.uint8), (R, 1))
ds = rle_file("t10", g8, "MONOCHROME2", 1, 8, None)
save(ds, "t10_rle_mono8.dcm", RLELossless)
expect("t10_rle_mono8.dcm", rows=R, cols=C, frames=1, windows=0, kind="ramp8")
g16 = np.tile(np.linspace(0, 4095, C).astype(np.uint16), (R, 1))
ds = rle_file("t11", g16, "MONOCHROME2", 1, 16, None)
save(ds, "t11_rle_mono16.dcm", RLELossless)
expect("t11_rle_mono16.dcm", rows=R, cols=C, frames=1, windows=1, kind="ramp16_win")
ds = rle_file("t12", rgb, "RGB", 3, 8, None)
save(ds, "t12_rle_rgb.dcm", RLELossless)
expect("t12_rle_rgb.dcm", rows=R, cols=C, frames=1, windows=0, kind="rgb_const_r", r=200)

# --- t13: PALETTE COLOR nativo 8 bits ----------------------------------------------------
idx = np.tile(np.linspace(0, 255, C).astype(np.uint8), (R, 1))
ds = base_ds("US", "1.2.840.10008.5.1.4.1.1.6.1")
ds.SamplesPerPixel = 1
ds.PhotometricInterpretation = "PALETTE COLOR"
ds.Rows, ds.Columns = R, C
ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
lut_r = (np.arange(256) * 257).astype("<u2")           # rojo rampa
lut_g = np.zeros(256, "<u2")                            # verde 0
lut_b = ((255 - np.arange(256)) * 257).astype("<u2")    # azul rampa inversa
ds.RedPaletteColorLookupTableDescriptor = [256, 0, 16]
ds.GreenPaletteColorLookupTableDescriptor = [256, 0, 16]
ds.BluePaletteColorLookupTableDescriptor = [256, 0, 16]
ds.RedPaletteColorLookupTableData = lut_r.tobytes()
ds.GreenPaletteColorLookupTableData = lut_g.tobytes()
ds.BluePaletteColorLookupTableData = lut_b.tobytes()
ds.PixelData = idx.tobytes()
save(ds, "t13_palette_native.dcm", ExplicitVRLittleEndian)
expect("t13_palette_native.dcm", rows=R, cols=C, frames=1, windows=0, kind="palette_ramp")
# misma imagen en Implicit VR: los OW de la LUT se leen con la VR del diccionario
save(ds, "t13b_palette_native_implicit.dcm", ImplicitVRLittleEndian)
expect("t13b_palette_native_implicit.dcm", rows=R, cols=C, frames=1, windows=0, kind="palette_ramp")

# --- t14: JPEG 2000 lossless 16 bits -----------------------------------------------------
b = io.BytesIO()
Image.fromarray(g16.astype(np.uint16)).save(b, "JPEG2000", irreversible=False, no_jp2=True)
ds = base_ds("MR", "1.2.840.10008.5.1.4.1.1.4")
set_mono16(ds, g16, signed=False, slope=1.0, intercept=0.0)
del ds.RescaleType
ds.BitsStored, ds.HighBit = 12, 11
ds.WindowCenter, ds.WindowWidth = 2048, 4096
ds.PixelData = encapsulate([b.getvalue()])
ds["PixelData"].is_undefined_length = True
ds["PixelData"].VR = "OB"
save(ds, "t14_j2k_lossless_16.dcm", JPEG2000Lossless)
expect("t14_j2k_lossless_16.dcm", rows=R, cols=C, frames=1, windows=1, kind="ramp16_win")

# --- t15: Encapsulated Uncompressed Explicit VR LE (1.2.840.10008.1.2.1.98) -------------
ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2")
hu = ct_hu()
stored = (hu + 1024).astype(np.uint16)
set_mono16(ds, stored, signed=False)
ds.WindowCenter, ds.WindowWidth = 40, 400
ds.PixelData = encapsulate([stored.tobytes()])
ds["PixelData"].is_undefined_length = True
ds["PixelData"].VR = "OB"
p = save(ds, "t15_encaps_uncompressed.dcm", JPEGBaseline8Bit)  # UID de igual longitud...
raw = open(p, "rb").read().replace(b"1.2.840.10008.1.2.4.50", b"1.2.840.10008.1.2.1.98", 1)
open(p, "wb").write(raw)  # ...y se parchea en el meta header
expect("t15_encaps_uncompressed.dcm", rows=R, cols=C, frames=1, windows=1, kind="ct")

# --- t16: CT con Icon Image Sequence (longitud indefinida) DESPUES de los atributos ------
hu = ct_hu()
stored = (hu + 1024).astype(np.uint16)
ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2")
set_mono16(ds, stored, signed=False)
ds.WindowCenter, ds.WindowWidth = 40, 400
icon = Dataset()
icon.SamplesPerPixel = 1
icon.PhotometricInterpretation = "MONOCHROME2"
icon.Rows, icon.Columns = 16, 16
icon.BitsAllocated, icon.BitsStored, icon.HighBit, icon.PixelRepresentation = 8, 8, 7, 0
icon.PixelData = bytes(256)
icon.is_undefined_length_sequence_item = True  # item de longitud indefinida: se recorre "aplanado"
ds.IconImageSequence = Sequence([icon])
ds["IconImageSequence"].is_undefined_length = True
ds.PixelData = stored.tobytes()
save(ds, "t16_ct_icon_sequence.dcm", ExplicitVRLittleEndian)
expect("t16_ct_icon_sequence.dcm", rows=R, cols=C, frames=1, windows=1, kind="ct")

# --- t17: Implicit VR con secuencia PRIVADA de longitud indefinida ----------------------
ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2")
set_mono16(ds, stored, signed=False)
ds.WindowCenter, ds.WindowWidth = 40, 400
blk = ds.private_block(0x0029, "SYNTH PRIVATE", create=True)
inner = Dataset()
inner.add_new(0x00291010, "LO", "private value")
inner.is_undefined_length_sequence_item = True
blk.add_new(0x20, "SQ", Sequence([inner]))
ds[0x00291020].is_undefined_length = True
ds.PixelData = stored.tobytes()
save(ds, "t17_ivle_private_undef_sq.dcm", ImplicitVRLittleEndian)
expect("t17_ivle_private_undef_sq.dcm", rows=R, cols=C, frames=1, windows=1, kind="ct")

# --- t18: Explicit VR con elementos UT / UC / UR (longitud de 4 bytes) -------------------
ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2")
set_mono16(ds, stored, signed=False)
ds.WindowCenter, ds.WindowWidth = 40, 400
ds.add_new(0x0040A160, "UT", "texto largo " * 10)       # Text Value (UT)
ds.add_new(0x00080119, "UC", "LONGCODE")                 # Long Code Value (UC)
ds.add_new(0x00080120, "UR", "http://example.org/x")     # URN Code Value (UR)
ds.PixelData = stored.tobytes()
save(ds, "t18_evle_ut_uc_ur.dcm", ExplicitVRLittleEndian)
expect("t18_evle_ut_uc_ur.dcm", rows=R, cols=C, frames=1, windows=1, kind="ct")

# --- t19: RLE YBR_FULL (tipico en US) ------------------------------------------------------
from pydicom.pixels import convert_color_space
ybr = convert_color_space(rgb, "RGB", "YBR_FULL")
ds = rle_file("t19", ybr, "YBR_FULL", 3, 8, None)
save(ds, "t19_rle_ybr_full.dcm", RLELossless)
expect("t19_rle_ybr_full.dcm", rows=R, cols=C, frames=1, windows=0, kind="rgb")

# --- t20: YBR_FULL_422 nativo (Y1 Y2 Cb Cr por cada 2 pixeles) -------------------------------
ybr = convert_color_space(rgb, "RGB", "YBR_FULL").astype(np.int32)
y = ybr[..., 0].reshape(-1)
cb = ((ybr[..., 1].reshape(-1)[0::2] + ybr[..., 1].reshape(-1)[1::2]) // 2)
cr = ((ybr[..., 2].reshape(-1)[0::2] + ybr[..., 2].reshape(-1)[1::2]) // 2)
packed = np.stack([y[0::2], y[1::2], cb, cr], axis=1).astype(np.uint8).tobytes()
ds = base_ds("US", "1.2.840.10008.5.1.4.1.1.6.1")
ds.SamplesPerPixel = 3
ds.PhotometricInterpretation = "YBR_FULL_422"
ds.PlanarConfiguration = 0
ds.Rows, ds.Columns = R, C
ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
ds.PixelData = packed
save(ds, "t20_native_ybr_full_422.dcm", ExplicitVRLittleEndian)
expect("t20_native_ybr_full_422.dcm", rows=R, cols=C, frames=1, windows=0, kind="rgb")

# --- t21: RGB nativo con Planar Configuration = 1 (RRR..GGG..BBB) ----------------------------
ds = base_ds("US", "1.2.840.10008.5.1.4.1.1.6.1")
ds.SamplesPerPixel = 3
ds.PhotometricInterpretation = "RGB"
ds.PlanarConfiguration = 1
ds.Rows, ds.Columns = R, C
ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
ds.PixelData = np.moveaxis(rgb, -1, 0).tobytes()
save(ds, "t21_native_rgb_planar1.dcm", ExplicitVRLittleEndian)
expect("t21_native_rgb_planar1.dcm", rows=R, cols=C, frames=1, windows=0, kind="rgb")

# --- t14b: JPEG 2000 lossless con varios tiles ---------------------------------------------
b = io.BytesIO()
Image.fromarray(g16.astype(np.uint16)).save(b, "JPEG2000", irreversible=False, no_jp2=True, tile_size=(32, 32))
ds = base_ds("MR", "1.2.840.10008.5.1.4.1.1.4")
set_mono16(ds, g16, signed=False, slope=1.0, intercept=0.0)
del ds.RescaleType
ds.BitsStored, ds.HighBit = 12, 11
ds.WindowCenter, ds.WindowWidth = 2048, 4096
ds.PixelData = encapsulate([b.getvalue()])
ds["PixelData"].is_undefined_length = True
ds["PixelData"].VR = "OB"
save(ds, "t14b_j2k_lossless_tiles.dcm", JPEG2000Lossless)
expect("t14b_j2k_lossless_tiles.dcm", rows=R, cols=C, frames=1, windows=1, kind="ramp16_win")

# --- t22: JPEG-LS lossless 16 bits con signo (si hay encoder) --------------------------------
try:
    import jpeg_ls
    from pydicom.uid import JPEGLSLossless
    hu = ct_hu()
    ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2")
    set_mono16(ds, hu, signed=True, slope=1.0, intercept=0.0)
    ds.BitsStored, ds.HighBit = 16, 15
    ds.WindowCenter, ds.WindowWidth = [40, -600], [400, 1500]
    ds.PixelData = hu.tobytes()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.compress(JPEGLSLossless, encoding_plugin="pyjpegls")
    save(ds, "t22_jpegls_signed16_2win.dcm", JPEGLSLossless)
    expect("t22_jpegls_signed16_2win.dcm", rows=R, cols=C, frames=1, windows=2, kind="ct")
except Exception as e:  # pragma: no cover
    print("t22 skipped:", e)

# --- t23: CT 12 bits CON SIGNO dentro de 16 (bits altos sin extender) --------------------------
hu = ct_hu()
stored12 = (hu.astype(np.int32) & 0x0FFF).astype(np.uint16)  # complemento a 2 en 12 bits, bits 12-15 a cero
ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2")
set_mono16(ds, hu, signed=True, slope=1.0, intercept=0.0)
ds.BitsStored, ds.HighBit = 12, 11
ds.WindowCenter, ds.WindowWidth = 40, 400
ds.PixelData = stored12.tobytes()
save(ds, "t23_ct_signed12_in16.dcm", ExplicitVRLittleEndian)
expect("t23_ct_signed12_in16.dcm", rows=R, cols=C, frames=1, windows=1, kind="ct")

with open(os.path.join(OUT, "expected.json"), "w") as fh:
    json.dump(EXPECTED, fh, indent=1)
print("generated", len(os.listdir(OUT)), "files in", OUT)
