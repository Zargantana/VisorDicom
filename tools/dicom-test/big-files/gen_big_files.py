#!/usr/bin/env python3
"""
Ficheros DICOM sintéticos GRANDES (sin PHI) para medir memoria y tiempos del visor con estudios pesados.
No se versionan: se generan donde se diga (por defecto tools/dicom-test/out/big, ignorado por git).

  python3 tools/dicom-test/big-files/gen_big_files.py [carpeta] [--2gb]

  xa_1000f_250MB.dcm        XA multiframe nativo 512x512x8 bits, 1000 frames (~250 MB)
  xa_2200f_550MB.dcm        igual con 2200 frames (~550 MB): más que el tope de string de V8 (~512 MiB)
  ct600/                    serie CT de 600 cortes 512x512x16 bits (~300 MB): muchos ficheros medianos, como un CD
  xa_jpeg_3000f_bot.dcm     XA JPEG baseline 1024x1024 con ruido, 3000 frames (~600 MB) y Basic Offset Table
  xa_jpeg_3000f_nobot.dcm   el mismo sin BOT: el visor tiene que recorrer las cabeceras de los items
  xa_8000f_2GB.dcm          (solo con --2gb) XA nativo de 8000 frames, ~2 GB

Los grandes se escriben por trozos (cabecera con pydicom y Pixel Data a continuación): no hace falta tener el
fichero entero en memoria.
"""
import io
import os
import struct
import sys

import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
OUT = ARGS[0] if ARGS else os.path.join(os.path.dirname(__file__), "..", "out", "big")
os.makedirs(OUT, exist_ok=True)


def dataset(sop_class, modality, rows, cols, bits, signed, study, series):
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.MediaStorageSOPClassUID = sop_class
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.SOPClassUID = sop_class
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.PatientName, ds.PatientID = "BIG^SYNTHETIC", "BIG-001"
    ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
    ds.Modality = modality
    ds.Rows, ds.Columns, ds.SamplesPerPixel = rows, cols, 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = ds.BitsStored = bits
    ds.HighBit = bits - 1
    ds.PixelRepresentation = 1 if signed else 0
    return ds


def header_bytes(ds):
    """El dataset sin Pixel Data, como fichero DICOM (preámbulo, meta y dataset) en Explicit VR LE."""
    buf = io.BytesIO()
    ds.save_as(buf, enforce_file_format=True, implicit_vr=False, little_endian=True)
    return buf.getvalue()


def xa_multiframe(name, frames, rows=512, cols=512):
    """XA nativo, escrito por trozos: cabecera + (7FE0,0010) OB con longitud + frames uno tras otro."""
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        return
    ds = dataset("1.2.840.10008.5.1.4.1.1.12.1", "XA", rows, cols, 8, False, generate_uid(), generate_uid())
    ds.NumberOfFrames, ds.FrameTime = frames, 33.3
    base = np.tile(np.linspace(0, 255, cols).astype(np.uint8), (rows, 1))
    with open(path, "wb") as out:
        out.write(header_bytes(ds))
        out.write(b"\xe0\x7f\x10\x00OB\x00\x00" + struct.pack("<I", rows * cols * frames))
        for f in range(frames):  # cada frame desplazado: el cine se ve moverse
            out.write(np.roll(base, f * 4, axis=1).tobytes())


def xa_jpeg_multiframe(name, frames, with_bot, rows=1024, cols=1024):
    """XA JPEG baseline encapsulado, un fragmento por frame, con o sin Basic Offset Table (escrito por trozos)."""
    from PIL import Image
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        return
    ds = dataset("1.2.840.10008.5.1.4.1.1.12.1", "XA", rows, cols, 8, False, generate_uid(), generate_uid())
    ds.file_meta.TransferSyntaxUID = "1.2.840.10008.1.2.4.50"
    ds.NumberOfFrames, ds.FrameTime = frames, 33.3
    rng = np.random.default_rng(7)
    noise = rng.integers(0, 60, (rows, cols), dtype=np.uint8)  # textura: frames de ~200 KB como una escopia real
    base = np.tile(np.linspace(0, 190, cols).astype(np.uint8), (rows, 1))
    with open(path, "wb") as out:
        out.write(header_bytes(ds))
        out.write(b"\xe0\x7f\x10\x00OB\x00\x00\xff\xff\xff\xff")
        bot_pos = out.tell()
        out.write(b"\xfe\xff\x00\xe0" + struct.pack("<I", 4 * frames if with_bot else 0))
        if with_bot:
            out.write(b"\x00" * (4 * frames))
        first = out.tell()
        offsets = []
        for f in range(frames):
            frame = np.roll(base, f * 3, axis=1) + np.roll(noise, f, axis=0)
            jpg = io.BytesIO()
            Image.fromarray(frame, "L").save(jpg, "JPEG", quality=92)
            data = jpg.getvalue()
            if len(data) % 2:
                data += b"\x00"
            offsets.append(out.tell() - first)
            out.write(b"\xfe\xff\x00\xe0" + struct.pack("<I", len(data)) + data)
        out.write(b"\xfe\xff\xdd\xe0\x00\x00\x00\x00")
        if with_bot:
            out.seek(bot_pos + 8)
            out.write(struct.pack("<%dI" % frames, *offsets))


def ct_series(folder, slices=600):
    path = os.path.join(OUT, folder)
    if os.path.isdir(path) and len(os.listdir(path)) == slices:
        return
    os.makedirs(path, exist_ok=True)
    study, series = generate_uid(), generate_uid()
    base = np.tile(np.linspace(0, 2000, 512), (512, 1)).astype(np.int16)
    for i in range(slices):
        ds = dataset("1.2.840.10008.5.1.4.1.1.2", "CT", 512, 512, 16, True, study, series)
        ds.SeriesNumber, ds.InstanceNumber = 1, i + 1
        ds.RescaleSlope, ds.RescaleIntercept = 1, -1024
        ds.WindowCenter, ds.WindowWidth = 40, 400
        ds.PixelData = np.roll(base, i, axis=1).tobytes()
        ds.save_as(os.path.join(path, f"ct_{i:04d}.dcm"), enforce_file_format=True, implicit_vr=False, little_endian=True)


xa_multiframe("xa_1000f_250MB.dcm", 1000)
xa_multiframe("xa_2200f_550MB.dcm", 2200)
ct_series("ct600")
xa_jpeg_multiframe("xa_jpeg_3000f_bot.dcm", 3000, True)
xa_jpeg_multiframe("xa_jpeg_3000f_nobot.dcm", 3000, False)
if "--2gb" in sys.argv:
    xa_multiframe("xa_8000f_2GB.dcm", 8000)
for entry in sorted(os.listdir(OUT)):
    full = os.path.join(OUT, entry)
    size = sum(os.path.getsize(os.path.join(full, x)) for x in os.listdir(full)) if os.path.isdir(full) else os.path.getsize(full)
    print(f"{entry:24} {size / 2**20:8.0f} MB")
