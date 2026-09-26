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

# --- t74: Big Endian con una secuencia de longitud definida y un OB privado antes del Pixel Data --------------
#     Las longitudes de 4 bytes en BE se leían con las mitades intercambiadas (0x00000188 -> 0x01880000), así que el
#     lector se saltaba el resto del fichero. t05 no lo veía porque su único elemento largo era el Pixel Data final.
ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2")
set_mono16(ds, stored, signed=False)
ds.WindowCenter = 40
ds.WindowWidth = 400
ref = Dataset()
ref.ReferencedSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
ref.ReferencedSOPInstanceUID = "1.2.826.0.1.3680043.8.498.1.2.3.4.5.6.7.8.9"
ds.SourceImageSequence = Sequence([ref])
ds.SourceImageSequence.is_undefined_length = False
ds.add_new((0x0009, 0x0010), "LO", "VISORDICOM TEST")
ds.add_new((0x0009, 0x1001), "OB", bytes(range(256)) + bytes(44))   # 300 = 0x12C bytes
ds.PixelData = stored.astype(">u2").tobytes()
try:
    save(ds, "t74_ct_evbe_sq_defined.dcm", ExplicitVRBigEndian)
    expect("t74_ct_evbe_sq_defined.dcm", rows=R, cols=C, frames=1, windows=1, kind="ct")
except Exception as e:  # pragma: no cover
    print("t74 skipped:", e)

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

# --- t75: el mismo J2K con la cabecera SIZ corrupta: los bytes de un delimitador de secuencia (FFFE,E0DD) dentro del
# codestream, como JPEG2000-embedded-sequence-delimiter.dcm de pydicom-data (Rsiz = FEFF, Xsiz = DDE00100). OpenJPEG
# rechaza la cabecera y jpx.js NO debe reservar memoria según un Xsiz de 3.700 millones (tumbaba el proceso con 4 GB):
# rechazo controlado con motivo.
cs = bytearray(b.getvalue())
assert cs[:4] == b"\xff\x4f\xff\x51"
cs[6:10] = b"\xfe\xff\xdd\xe0"
ds.PixelData = encapsulate([bytes(cs)])
ds["PixelData"].is_undefined_length = True
ds["PixelData"].VR = "OB"
save(ds, "t75_j2k_bad_siz.dcm", JPEG2000Lossless)
expect("t75_j2k_bad_siz.dcm", rows=R, cols=C, frames=1, windows=1, kind="expect_fail", reason_contains="JPEG 2000: ")

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


# =============================================================================================================
# Transfer Syntaxes ampliadas (HTJ2K, JPEG 2000 Part 2, procesos JPEG retirados, lossless 12/16 bits, 12 bits).
# Requieren `pip install imagecodecs` (y opcionalmente `cjpeg` de libjpeg-turbo, y gcc + libopenjp2-dev para t27).
# La "verdad" se guarda en out/ref/<fichero>.npy: el array original si es sin pérdida, o lo que decodifica
# imagecodecs (libjpeg-turbo/OpenJPEG/OpenJPH nativos) si es con pérdida. check_render.py la usa si existe.
# =============================================================================================================
import shutil
import subprocess
import tempfile

REF = os.path.join(OUT, "ref")
os.makedirs(REF, exist_ok=True)

# UIDs conocidos por pydicom con la misma longitud, para guardar y parchear el meta header (como t15).
_SAME_LENGTH_PLACEHOLDER = {22: "1.2.840.10008.1.2.4.50", 23: "1.2.840.10008.1.2.4.100"}


def save_encapsulated(ds, name, ts_uid, codestreams, ref):
    ds.PixelData = encapsulate(codestreams)
    ds["PixelData"].is_undefined_length = True
    ds["PixelData"].VR = "OB"
    placeholder = _SAME_LENGTH_PLACEHOLDER[len(ts_uid)]
    ds.file_meta.TransferSyntaxUID = UID(placeholder)
    path = os.path.join(OUT, name)
    ds.save_as(path, enforce_file_format=True, implicit_vr=False, little_endian=True)
    if placeholder != ts_uid:
        raw = open(path, "rb").read().replace(placeholder.encode(), ts_uid.encode(), 1)
        open(path, "wb").write(raw)
    np.save(os.path.join(REF, name + ".npy"), np.asarray(ref))


def image_ds(modality, rows, cols, samples, photometric, bits, stored, signed, frames=1):
    ds = base_ds(modality, "1.2.840.10008.5.1.4.1.1.7")
    ds.SamplesPerPixel = samples
    ds.PhotometricInterpretation = photometric
    if samples == 3:
        ds.PlanarConfiguration = 0
    ds.Rows, ds.Columns = rows, cols
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = bits, stored, stored - 1
    ds.PixelRepresentation = 1 if signed else 0
    if frames > 1:
        ds.NumberOfFrames = frames
    return ds


try:
    import imagecodecs as ic
except ImportError:  # pragma: no cover
    ic = None
    print("imagecodecs no instalado: se omiten los casos t24-t36 (pip install imagecodecs)")

if ic is not None:
    g12 = np.tile(np.linspace(0, 4095, C).astype(np.uint16), (R, 1))
    g12[10:20, 10:30] = 3000
    hu = ct_hu()

    # --- t24: HTJ2K lossless 12 bits (.201) ---------------------------------------------------------------
    cs = ic.htj2k_encode(g12, reversible=True)
    ds = image_ds("MR", R, C, 1, "MONOCHROME2", 16, 12, False)
    ds.WindowCenter, ds.WindowWidth = 2048, 4096
    save_encapsulated(ds, "t24_htj2k_lossless_12.dcm", "1.2.840.10008.1.2.4.201", [cs], g12)
    expect("t24_htj2k_lossless_12.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref")

    # --- t25: HTJ2K lossless RGB con RCT (.202 "RPCL") ------------------------------------------------------
    cs = ic.htj2k_encode(rgb, reversible=True)
    ds = image_ds("XC", R, C, 3, "YBR_RCT", 8, 8, False)
    save_encapsulated(ds, "t25_htj2k_rpcl_rgb.dcm", "1.2.840.10008.1.2.4.202", [cs], rgb)
    expect("t25_htj2k_rpcl_rgb.dcm", rows=R, cols=C, frames=1, windows=0, kind="ref")

    # --- t26: HTJ2K con pérdida, CT 16 bits con 2 ventanas (.203) -------------------------------------------
    stored = (hu + 1024).astype(np.uint16)
    cs = ic.htj2k_encode(stored, reversible=False, level=40)
    ds = image_ds("CT", R, C, 1, "MONOCHROME2", 16, 16, False)
    ds.RescaleIntercept, ds.RescaleSlope = -1024, 1
    ds.WindowCenter, ds.WindowWidth = [40, -600], [400, 1500]
    save_encapsulated(ds, "t26_htj2k_lossy_ct.dcm", "1.2.840.10008.1.2.4.203", [cs], ic.htj2k_decode(cs))
    expect("t26_htj2k_lossy_ct.dcm", rows=R, cols=C, frames=1, windows=2, kind="ref")

    # --- t27: JPEG 2000 Part 2 con MCT por matriz (.93): FALLO ESPERADO -------------------------------------
    # Ni OpenJPEG (2.5.0/2.5.4) ni jpx.js decodifican la MCT por matriz de Part 2. El visor debe rechazarlo
    # con un aviso (sin colores falsos ni excepciones). El codestream lo genera j2k-part2/j2k_part2_mct.c
    # (opj_set_MCT); el opj_compress de las distros no acepta -m.
    part2_src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "j2k-part2", "j2k_part2_mct.c")
    if shutil.which("gcc") and os.path.exists("/usr/include/openjpeg-2.5/openjpeg.h"):
        with tempfile.TemporaryDirectory() as tmp:
            exe = os.path.join(tmp, "j2k_part2_mct")
            subprocess.run(["gcc", "-O2", "-I/usr/include/openjpeg-2.5", part2_src, "-lopenjp2", "-o", exe],
                           check=True, capture_output=True)
            ppm = os.path.join(tmp, "in.ppm")
            open(ppm, "wb").write(b"P6\n%d %d\n255\n" % (C, R) + rgb.tobytes())
            j2k = os.path.join(tmp, "out.j2k")
            subprocess.run([exe, ppm, j2k], check=True, capture_output=True)
            cs = open(j2k, "rb").read()
        ds = image_ds("XC", R, C, 3, "RGB", 8, 8, False)
        save_encapsulated(ds, "t27_j2k_part2_mct.dcm", "1.2.840.10008.1.2.4.93", [cs], rgb)
        expect("t27_j2k_part2_mct.dcm", rows=R, cols=C, frames=1, windows=0, kind="expect_fail")
    else:
        print("gcc/libopenjp2-dev no disponibles: se omite t27 (JPEG 2000 Part 2 MCT, fallo esperado)")

    # --- t28: JPEG 2000 lossless RGB con RCT (.90) -----------------------------------------------------------
    cs = ic.jpeg2k_encode(rgb, codecformat="j2k", reversible=True, mct=True)
    ds = image_ds("XC", R, C, 3, "YBR_RCT", 8, 8, False)
    save_encapsulated(ds, "t28_j2k_rgb_rct.dcm", "1.2.840.10008.1.2.4.90", [cs], rgb)
    expect("t28_j2k_rgb_rct.dcm", rows=R, cols=C, frames=1, windows=0, kind="ref")

    # --- t29: JPEG Lossless SV1 12 bits (.70) ----------------------------------------------------------------
    cs = ic.jpeg8_encode(g12, lossless=True, predictor=1, bitspersample=12)
    ds = image_ds("CR", R, C, 1, "MONOCHROME2", 16, 12, False)
    ds.WindowCenter, ds.WindowWidth = 2048, 4096
    save_encapsulated(ds, "t29_jpegll_sv1_12.dcm", "1.2.840.10008.1.2.4.70", [cs], g12)
    expect("t29_jpegll_sv1_12.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref")

    # --- t30: JPEG Lossless proceso 14, predictor 6, 16 bits CON SIGNO (.57) -------------------------------
    cs = ic.jpeg8_encode(hu.view(np.uint16), lossless=True, predictor=6, bitspersample=16)
    ds = image_ds("CT", R, C, 1, "MONOCHROME2", 16, 16, True)
    ds.WindowCenter, ds.WindowWidth = 40, 400
    save_encapsulated(ds, "t30_jpegll_p6_16s.dcm", "1.2.840.10008.1.2.4.57", [cs], hu)
    expect("t30_jpegll_p6_16s.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref")

    # --- t31: JPEG Extended 12 bits (.51) --------------------------------------------------------------------
    cs = ic.jpeg8_encode(g12, level=95, bitspersample=12)
    ds = image_ds("XA", R, C, 1, "MONOCHROME2", 16, 12, False)
    ds.WindowCenter, ds.WindowWidth = 2048, 4096
    save_encapsulated(ds, "t31_jpeg_ext12.dcm", "1.2.840.10008.1.2.4.51", [cs], ic.jpeg8_decode(cs))
    expect("t31_jpeg_ext12.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref")

    # --- t32-t36: procesos JPEG retirados de 8 bits (cjpeg de libjpeg-turbo) ------------------------------------
    if shutil.which("cjpeg"):
        spectral = "0: 0-0, 0, 0;\n0: 1-9, 0, 0;\n0: 10-63, 0, 0;\n"   # spectral selection sin aproximación sucesiva
        cases = [
            ("t32_jpeg_arith_rgb.dcm", "1.2.840.10008.1.2.4.52", rgb, ["-arithmetic", "-sample", "2x1"]),
            ("t33_jpeg_prog_rgb.dcm", "1.2.840.10008.1.2.4.55", rgb, ["-progressive", "-sample", "2x1"]),
            ("t34_jpeg_prog_arith_gray.dcm", "1.2.840.10008.1.2.4.56", g8, ["-progressive", "-arithmetic"]),
            ("t35_jpeg_spectral_gray.dcm", "1.2.840.10008.1.2.4.53", g8, ["-scans", "SCANS"]),
            ("t36_jpeg_spectral_arith_gray.dcm", "1.2.840.10008.1.2.4.54", g8, ["-scans", "SCANS", "-arithmetic"]),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            scans = os.path.join(tmp, "scans.txt")
            open(scans, "w").write(spectral)
            for name, ts_uid, src, args in cases:
                pnm = os.path.join(tmp, "in.pnm")
                if src.ndim == 3:
                    open(pnm, "wb").write(b"P6\n%d %d\n255\n" % (C, R) + src.tobytes())
                else:
                    open(pnm, "wb").write(b"P5\n%d %d\n255\n" % (C, R) + src.tobytes())
                out_jpg = os.path.join(tmp, "out.jpg")
                cmd = ["cjpeg", "-quality", "95"] + [scans if a == "SCANS" else a for a in args] + ["-outfile", out_jpg, pnm]
                subprocess.run(cmd, check=True, capture_output=True)
                cs = open(out_jpg, "rb").read()
                if src.ndim == 3:
                    ds = image_ds("XC", R, C, 3, "YBR_FULL_422", 8, 8, False)
                else:
                    ds = image_ds("XA", R, C, 1, "MONOCHROME2", 8, 8, False)
                save_encapsulated(ds, name, ts_uid, [cs], ic.jpeg8_decode(cs))
                expect(name, rows=R, cols=C, frames=1, windows=0, kind="ref")
    else:
        print("cjpeg no disponible: se omiten t32-t36 (procesos JPEG retirados)")

    # --- t50-t52: JPEG de 12 bits progresivo y aritmético (cjpeg 3.x de libjpeg-turbo, -precision 12) ----------
    #     Los decodifica el build de 12 bits de libjpeg-turbo (assets/codecs/libjpegturbo12js.js).
    cjpeg12 = False
    if shutil.which("cjpeg"):
        ver = subprocess.run(["cjpeg", "-version"], capture_output=True, text=True)
        cjpeg12 = "libjpeg-turbo version 3" in (ver.stdout + ver.stderr) or "libjpeg-turbo version 4" in (ver.stdout + ver.stderr)
    if cjpeg12:
        cases = [
            ("t50_jpeg_prog12_gray.dcm", "1.2.840.10008.1.2.4.55", ["-progressive"]),                # proceso 12
            ("t51_jpeg_arith12_gray.dcm", "1.2.840.10008.1.2.4.52", ["-arithmetic"]),                # proceso 5
            ("t52_jpeg_prog_arith12_gray.dcm", "1.2.840.10008.1.2.4.56", ["-progressive", "-arithmetic"]),  # proceso 13
            ("t53_jpeg_spectral12_gray.dcm", "1.2.840.10008.1.2.4.53", ["-scans", "SCANS"]),         # proceso 8
            ("t54_jpeg_spectral_arith12_gray.dcm", "1.2.840.10008.1.2.4.54", ["-scans", "SCANS", "-arithmetic"]),  # proceso 9
        ]
        spectral12 = "0: 0-0, 0, 0;\n0: 1-9, 0, 0;\n0: 10-63, 0, 0;\n"
        with tempfile.TemporaryDirectory() as tmp:
            pgm = os.path.join(tmp, "in12.pgm")
            # PGM de 16 bits (maxval 4095): muestras big-endian
            open(pgm, "wb").write(b"P5\n%d %d\n4095\n" % (C, R) + g12.astype(">u2").tobytes())
            scans12 = os.path.join(tmp, "scans12.txt")
            open(scans12, "w").write(spectral12)
            for name, ts_uid, args in cases:
                out_jpg = os.path.join(tmp, "out12.jpg")
                subprocess.run(["cjpeg", "-precision", "12", "-quality", "95"] + [scans12 if a == "SCANS" else a for a in args] + ["-outfile", out_jpg, pgm], check=True, capture_output=True)
                cs = open(out_jpg, "rb").read()
                ds = image_ds("XA", R, C, 1, "MONOCHROME2", 16, 12, False)
                ds.WindowCenter, ds.WindowWidth = 2048, 4096
                save_encapsulated(ds, name, ts_uid, [cs], ic.jpeg8_decode(cs))
                expect(name, rows=R, cols=C, frames=1, windows=1, kind="ref")
    else:
        print("cjpeg 3.x no disponible: se omiten t50-t54 (JPEG 12 bits progresivo, aritmético y espectral)")


# =============================================================================================================
# Modelos de color y presentación de grises ampliados (t40-t47). La verdad de los modelos "a mano"
# (YBR_PARTIAL, HSV, CMYK, ARGB) se calcula aquí de forma independiente (numpy/colorsys) y va a out/ref.
# =============================================================================================================
import colorsys


def native_color(name, photometric, samples_array, spp, ref, planar=0, bits=8):
    ds = base_ds("XC", "1.2.840.10008.5.1.4.1.1.7")
    ds.SamplesPerPixel = spp
    ds.PhotometricInterpretation = photometric
    ds.PlanarConfiguration = planar
    ds.Rows, ds.Columns = R, C
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = bits, bits, bits - 1, 0
    ds.PixelData = samples_array.tobytes()
    save(ds, name, ExplicitVRLittleEndian)
    np.save(os.path.join(REF, name + ".npy"), np.asarray(ref))
    expect(name, rows=R, cols=C, frames=1, windows=0, kind="ref")


rgbf = rgb.astype(np.float64)
# --- t40: YBR_PARTIAL_422 nativo (retirado): BT.601 rango parcial, croma promediada por pares -----------------
Yp = 16 + (65.481 * rgbf[..., 0] + 128.553 * rgbf[..., 1] + 24.966 * rgbf[..., 2]) / 255
Cbp = 128 + (-37.797 * rgbf[..., 0] - 74.203 * rgbf[..., 1] + 112.0 * rgbf[..., 2]) / 255
Crp = 128 + (112.0 * rgbf[..., 0] - 93.786 * rgbf[..., 1] - 18.214 * rgbf[..., 2]) / 255
Yq = np.clip(np.round(Yp), 0, 255).reshape(-1)
cbq = np.clip(np.round((Cbp.reshape(-1)[0::2] + Cbp.reshape(-1)[1::2]) / 2), 0, 255)
crq = np.clip(np.round((Crp.reshape(-1)[0::2] + Crp.reshape(-1)[1::2]) / 2), 0, 255)
packed = np.stack([Yq[0::2], Yq[1::2], cbq, crq], axis=1).astype(np.uint8)
yy = 1.1644 * (Yq - 16)
cbf, crf = np.repeat(cbq, 2) - 128, np.repeat(crq, 2) - 128
ref40 = np.stack([yy + 1.5960 * crf, yy - 0.3918 * cbf - 0.8130 * crf, yy + 2.0172 * cbf], axis=1)
native_color("t40_native_ybr_partial_422.dcm", "YBR_PARTIAL_422", packed, 3,
             np.clip(np.round(ref40), 0, 255).astype(np.uint8).reshape(R, C, 3))

# --- t41: HSV nativo (retirado): H 0..255 = 0..360 grados ------------------------------------------------------
hsv = np.zeros_like(rgb)
for yy_ in range(R):
    for xx_ in range(C):
        h_, s_, v_ = colorsys.rgb_to_hsv(*(rgbf[yy_, xx_] / 255))
        hsv[yy_, xx_] = [min(255, int(h_ * 256)), int(round(s_ * 255)), int(round(v_ * 255))]
ref41 = np.zeros_like(rgb)
for yy_ in range(R):
    for xx_ in range(C):
        r_, g_, b_ = colorsys.hsv_to_rgb(hsv[yy_, xx_, 0] / 256, hsv[yy_, xx_, 1] / 255, hsv[yy_, xx_, 2] / 255)
        ref41[yy_, xx_] = np.clip(np.round(np.array([r_, g_, b_]) * 255), 0, 255)
native_color("t41_native_hsv.dcm", "HSV", hsv, 3, ref41)

# --- t42: CMYK nativo (retirado) --------------------------------------------------------------------------------
cmy = 255 - rgb.astype(np.int32)
k = cmy.min(axis=2, keepdims=True)
cmyk = np.concatenate([cmy - k, k], axis=2).astype(np.uint8)
ref42 = np.clip(np.round((255 - cmyk[..., :3].astype(np.float64)) * (255 - cmyk[..., 3:4].astype(np.float64)) / 255), 0, 255)
native_color("t42_native_cmyk.dcm", "CMYK", cmyk, 4, ref42.astype(np.uint8))

# --- t43: ARGB nativo (retirado) con Planar Configuration 1 (4 planos): A se ignora ---------------------------
argb = np.concatenate([np.full((R, C, 1), 128, np.uint8), rgb], axis=2)
native_color("t43_native_argb_planar.dcm", "ARGB", np.moveaxis(argb, -1, 0).copy(), 4, rgb, planar=1)

# --- t44: PALETTE COLOR con LUT SEGMENTADA (discreto + lineal + indirecto) ------------------------------------
ds = base_ds("NM", "1.2.840.10008.5.1.4.1.1.20")
ds.SamplesPerPixel = 1
ds.PhotometricInterpretation = "PALETTE COLOR"
ds.Rows, ds.Columns = R, C
ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
ds.PixelData = np.tile(np.linspace(0, 255, C).astype(np.uint8), (R, 1)).tobytes()
# rojo: discreto [0], lineal hasta 65535 en 255 pasos -> 256 entradas
red = [0, 1, 0, 1, 255, 65535]
# verde: discreto [0, 30000], lineal 126 -> 65535, indirecto: copia 1 segmento desde la entrada 0 (discreto [0, 30000]),
#        lineal 126 -> 0  => 2 + 126 + 2 + 126 = 256 entradas
green = [0, 2, 0, 30000, 1, 126, 65535, 2, 1, 0, 0, 1, 126, 0]
# azul: discreto de 256 valores decrecientes
blue = [0, 256] + [int(v) for v in np.linspace(65535, 0, 256)]
for tag_desc, tag_data, seg in [((0x0028, 0x1101), (0x0028, 0x1221), red), ((0x0028, 0x1102), (0x0028, 0x1222), green),
                                ((0x0028, 0x1103), (0x0028, 0x1223), blue)]:
    ds.add_new(tag_desc, "US", [256, 0, 16])
    ds.add_new(tag_data, "OW", np.array(seg, "<u2").tobytes())
save(ds, "t44_segmented_palette.dcm", ExplicitVRLittleEndian)
expect("t44_segmented_palette.dcm", rows=R, cols=C, frames=1, windows=0, kind="palette_segmented")

# --- t45: Supplemental Palette: MONOCHROME2 + Pixel Presentation MIXED + LUT desde el valor 1000 ------------------
sup = np.tile(np.linspace(0, 999, C).astype(np.uint16), (R, 1))
sup[20:44, 20:60] = (1000 + np.tile(np.linspace(0, 255, 40).astype(np.uint16), (24, 1)))
ds = base_ds("MR", "1.2.840.10008.5.1.4.1.1.4")
set_mono16(ds, sup, signed=False, slope=1.0, intercept=0.0)
del ds.RescaleType
ds.PixelPresentation = "MIXED"
ds.WindowCenter, ds.WindowWidth = 500, 1000
lut_hot_r = np.clip(np.arange(256) * 3, 0, 255).astype(np.uint16) * 257
lut_hot_g = np.clip(np.arange(256) * 3 - 255, 0, 255).astype(np.uint16) * 257
lut_hot_b = np.clip(np.arange(256) * 3 - 510, 0, 255).astype(np.uint16) * 257
for d, t, lut in [((0x0028, 0x1101), (0x0028, 0x1201), lut_hot_r), ((0x0028, 0x1102), (0x0028, 0x1202), lut_hot_g),
                  ((0x0028, 0x1103), (0x0028, 0x1203), lut_hot_b)]:
    ds.add_new(d, "US", [256, 1000, 16])
    ds.add_new(t, "OW", lut.astype("<u2").tobytes())
ds.PixelData = sup.tobytes()
save(ds, "t45_supplemental_palette.dcm", ExplicitVRLittleEndian)
expect("t45_supplemental_palette.dcm", rows=R, cols=C, frames=1, windows=1, kind="supplemental")

# --- t46: MONOCHROME2 con Presentation LUT Shape INVERSE ------------------------------------------------------
ds = base_ds("DX", "1.2.840.10008.5.1.4.1.1.1.1")
g12b = np.tile(np.linspace(0, 4095, C).astype(np.uint16), (R, 1))
set_mono16(ds, g12b, signed=False, slope=1.0, intercept=0.0)
del ds.RescaleType
ds.BitsStored, ds.HighBit = 12, 11
ds.PresentationLUTShape = "INVERSE"
ds.WindowCenter, ds.WindowWidth = 2048, 4096
ds.PixelData = g12b.tobytes()
save(ds, "t46_mono2_presentation_inverse.dcm", ExplicitVRLittleEndian)
expect("t46_mono2_presentation_inverse.dcm", rows=R, cols=C, frames=1, windows=1, kind="inverse")

# --- t47: CT con Pixel Padding Value (-2000) y SIN ventana: el relleno no entra en la auto-ventana ------------------
pad = ct_hu().astype(np.int16)
yy_, xx_ = np.mgrid[0:R, 0:C]
pad[(yy_ - R / 2) ** 2 / (R / 2) ** 2 + (xx_ - C / 2) ** 2 / (C / 2) ** 2 > 1] = -2000
ds = base_ds("CT", "1.2.840.10008.5.1.4.1.1.2")
set_mono16(ds, pad, signed=True, slope=1.0, intercept=0.0)
ds.PixelPaddingValue = -2000
ds.PixelData = pad.tobytes()
save(ds, "t47_ct_pixel_padding_nowin.dcm", ExplicitVRLittleEndian)
expect("t47_ct_pixel_padding_nowin.dcm", rows=R, cols=C, frames=1, windows=0, kind="padding")

# =============================================================================================================
# Transfer Syntax privadas y retiradas (t60-t73). UIDs de dicom3tools (transyn.tpl), GDCM y DCMTK.
#  - t60-t63: decodificables (GE con píxeles Big Endian, Philips CT-private-ELE, Papyrus 3, PixelMed raw).
#  - t64-t65: compresión propietaria sin decodificador público (Sectra) y TS desconocida: rechazo con motivo.
#  - t66-t73: TS privada ficticia (raíz 2.25 = UUID) con un códec estándar dentro: el visor lo reconoce por el
#    contenido del Pixel Data (codec-sniffer.ts). t73 además es Implicit VR (el parser detecta la VR).
# =============================================================================================================
def save_private(ds, name, ts_uid, implicit, ref=None, pixel_data=None, fragments=None):
    ds.file_meta.TransferSyntaxUID = UID(ts_uid)
    if fragments is not None:
        ds.PixelData = encapsulate(fragments)
        ds["PixelData"].is_undefined_length = True
        ds["PixelData"].VR = "OB"
    else:
        ds.PixelData = pixel_data
        ds["PixelData"].VR = "OW" if ds.BitsAllocated > 8 else "OB"
    ds.save_as(os.path.join(OUT, name), enforce_file_format=True, implicit_vr=implicit, little_endian=True)
    if ref is not None:
        np.save(os.path.join(REF, name + ".npy"), np.asarray(ref))


def ct_private(modality="CT"):
    ds = image_ds(modality, R, C, 1, "MONOCHROME2", 16, 16, True)
    ds.RescaleSlope, ds.RescaleIntercept = 1, 0
    ds.WindowCenter, ds.WindowWidth = 40, 400
    return ds


hu_p = ct_hu()
FAKE_TS = generate_uid(prefix=None)  # 2.25.<UUID>: privada y única, no es de ningún fabricante

# --- t60: GE privada: cabecera Implicit VR LE, Pixel Data en Big Endian (1.2.840.113619.5.2) -------------------
save_private(ct_private(), "t60_ge_private_be_pixels.dcm", "1.2.840.113619.5.2", True, hu_p,
             pixel_data=hu_p.astype(">i2").tobytes())
expect("t60_ge_private_be_pixels.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref")
# --- t61: Philips CT-private-ELE: Explicit VR LE nativa (1.3.46.670589.33.1.4.1) ----------------------------------
save_private(ct_private(), "t61_philips_ct_private_ele.dcm", "1.3.46.670589.33.1.4.1", False, hu_p,
             pixel_data=hu_p.astype("<i2").tobytes())
expect("t61_philips_ct_private_ele.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref")
# --- t62: Papyrus 3 Implicit VR Little Endian (retirada, 1.2.840.10008.1.20) --------------------------------------
# pydicom la cree explícita: se graba como 1.2.840.10008.1.2 (+ relleno NUL = 18 bytes) y se parchea el UID.
save_private(ct_private(), "t62_papyrus3_implicit.dcm", ImplicitVRLittleEndian, True, hu_p,
             pixel_data=hu_p.astype("<i2").tobytes())
_path = os.path.join(OUT, "t62_papyrus3_implicit.dcm")
_raw = open(_path, "rb").read()
assert _raw.count(b"1.2.840.10008.1.2\x00") >= 1
open(_path, "wb").write(_raw.replace(b"1.2.840.10008.1.2\x00", b"1.2.840.10008.1.20", 1))
expect("t62_papyrus3_implicit.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref")
# --- t63: PixelMed Encapsulated Raw LE (1.3.6.1.4.1.5962.300.2), 3 frames --------------------------------------
frames3 = np.stack([hu_p, hu_p // 2, -hu_p]).astype(np.int16)
ds = ct_private()
ds.NumberOfFrames = 3
save_private(ds, "t63_pixelmed_encaps_raw_3f.dcm", "1.3.6.1.4.1.5962.300.2", False, frames3,
             fragments=[f.astype("<i2").tobytes() for f in frames3])
expect("t63_pixelmed_encaps_raw_3f.dcm", rows=R, cols=C, frames=3, windows=1, kind="ref")

# --- t64: Sectra Compression LS con un bitstream opaco: rechazo controlado y el motivo nombra a Sectra ---------
rng = np.random.default_rng(64)
save_private(ct_private(), "t64_sectra_ls_opaque.dcm", "1.2.752.24.3.7.7", False,
             fragments=[rng.integers(0, 256, 3000, dtype=np.uint8).tobytes()])
expect("t64_sectra_ls_opaque.dcm", rows=R, cols=C, frames=1, windows=1, kind="expect_fail", reason_contains="Sectra")
# --- t65: TS desconocida con bitstream opaco: rechazo con el UID en el motivo ----------------------------------
save_private(ct_private(), "t65_unknown_ts_opaque.dcm", FAKE_TS, False,
             fragments=[rng.integers(0, 256, 3000, dtype=np.uint8).tobytes()])
expect("t65_unknown_ts_opaque.dcm", rows=R, cols=C, frames=1, windows=1, kind="expect_fail", reason_contains=FAKE_TS)

# --- t66-t73: códec estándar bajo una TS privada ficticia: se reconoce por el contenido -------------------------
# t66: RLE 16 bits con signo
rle_planes = [hu_p.view(np.uint16).astype(">u2").view(np.uint8).reshape(R, C, 2)[..., k].tobytes() for k in (0, 1)]
save_private(ct_private(), "t66_sniff_rle.dcm", FAKE_TS, False, hu_p, fragments=[rle_frame(rle_planes)])
expect("t66_sniff_rle.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref", decoded_by="RLE")
# t67: JPEG baseline RGB (con pérdida)
rgb_p = np.zeros((R, C, 3), np.uint8)
rgb_p[..., 0] = np.linspace(0, 255, C).astype(np.uint8)[None, :]
rgb_p[..., 1] = 120
rgb_p[..., 2] = np.linspace(255, 0, R).astype(np.uint8)[:, None]
jb_p = jpeg_bytes(rgb_p, "RGB")
ds = image_ds("XC", R, C, 3, "YBR_FULL_422", 8, 8, False)
save_private(ds, "t67_sniff_jpeg_baseline_rgb.dcm", FAKE_TS, False, np.array(Image.open(io.BytesIO(jb_p)).convert("RGB")),
             fragments=[jb_p])
expect("t67_sniff_jpeg_baseline_rgb.dcm", rows=R, cols=C, frames=1, windows=0, kind="ref", decoded_by="JPEG baseline",
       lossy=True)
# t68: sin comprimir, nativo, Implicit VR (el parser tiene que detectar la VR sin conocer la TS)
save_private(ct_private(), "t68_sniff_raw_implicit.dcm", FAKE_TS, True, hu_p, pixel_data=hu_p.astype("<i2").tobytes())
expect("t68_sniff_raw_implicit.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref", decoded_by="sin comprimir (nativo)")

if ic is not None:
    # t69: JPEG lossless (proceso 14, SV1), 16 bits con signo
    cs = ic.jpeg8_encode(hu_p.view(np.uint16), lossless=True, predictor=1, bitspersample=16)
    save_private(ct_private(), "t69_sniff_jpeg_lossless.dcm", FAKE_TS, False, hu_p, fragments=[cs])
    expect("t69_sniff_jpeg_lossless.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref", decoded_by="JPEG lossless")
    # t70: JPEG-LS lossless, 16 bits con signo
    cs = ic.jpegls_encode(hu_p.view(np.uint16), level=0)
    save_private(ct_private(), "t70_sniff_jpegls.dcm", FAKE_TS, False, hu_p, fragments=[cs])
    expect("t70_sniff_jpegls.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref", decoded_by="JPEG-LS")
    # t71: JPEG 2000 lossless, 16 bits con signo
    cs = ic.jpeg2k_encode(hu_p, codecformat="j2k", reversible=True)
    save_private(ct_private(), "t71_sniff_j2k.dcm", FAKE_TS, False, hu_p, fragments=[cs])
    expect("t71_sniff_j2k.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref", decoded_by="JPEG 2000")
    # t72: HTJ2K lossless 12 bits
    g12_p = np.tile(np.linspace(0, 4095, C).astype(np.uint16), (R, 1))
    cs = ic.htj2k_encode(g12_p, reversible=True)
    ds = image_ds("MR", R, C, 1, "MONOCHROME2", 16, 12, False)
    ds.WindowCenter, ds.WindowWidth = 2048, 4096
    save_private(ds, "t72_sniff_htj2k.dcm", FAKE_TS, False, g12_p, fragments=[cs])
    expect("t72_sniff_htj2k.dcm", rows=R, cols=C, frames=1, windows=1, kind="ref", decoded_by="HTJ2K")
else:
    print("imagecodecs no instalado: se omiten t69-t72 (códec estándar bajo TS privada)")

# t73: JPEG progresivo 8 bits (proceso retirado: libjpeg-turbo bajo demanda); lo codifica Pillow
g8_p = np.tile(np.linspace(0, 255, C).astype(np.uint8), (R, 1))
_b = io.BytesIO()
Image.fromarray(g8_p, "L").save(_b, "JPEG", quality=95, progressive=True)
ds = image_ds("XC", R, C, 1, "MONOCHROME2", 8, 8, False)
save_private(ds, "t73_sniff_jpeg_progressive.dcm", FAKE_TS, False, np.array(Image.open(io.BytesIO(_b.getvalue()))),
             fragments=[_b.getvalue()])
expect("t73_sniff_jpeg_progressive.dcm", rows=R, cols=C, frames=1, windows=0, kind="ref",
       decoded_by="JPEG progresivo", lossy=True)

with open(os.path.join(OUT, "expected.json"), "w") as fh:
    json.dump(EXPECTED, fh, indent=1)
print("generated", len(os.listdir(OUT)), "files in", OUT)
