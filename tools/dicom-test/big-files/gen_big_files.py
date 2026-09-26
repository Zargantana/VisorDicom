#!/usr/bin/env python3
"""
Ficheros DICOM sintéticos GRANDES (sin PHI) para medir memoria y tiempos del visor con estudios pesados.
No se versionan: se generan donde se diga (por defecto tools/dicom-test/out/big, ignorado por git).

  python3 tools/dicom-test/big-files/gen_big_files.py [carpeta]

  xa_1000f_250MB.dcm  XA multiframe 512x512x8 bits, 1000 frames (~250 MB): cabe en un string de V8
  xa_2200f_550MB.dcm  igual con 2200 frames (~550 MB): supera el límite de string de V8 (~512 MiB)
  ct600/              serie CT de 600 cortes 512x512x16 bits (~300 MB): muchos ficheros medianos, como un CD
"""
import os
import sys

import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "out", "big")
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


def xa_multiframe(name, frames, rows=512, cols=512):
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        return
    ds = dataset("1.2.840.10008.5.1.4.1.1.12.1", "XA", rows, cols, 8, False, generate_uid(), generate_uid())
    ds.NumberOfFrames, ds.FrameTime = frames, 33.3
    base = np.tile(np.linspace(0, 255, cols).astype(np.uint8), (rows, 1))
    buf = bytearray(rows * cols * frames)
    for f in range(frames):  # cada frame desplazado: el cine se ve moverse
        buf[f * rows * cols:(f + 1) * rows * cols] = np.roll(base, f * 4, axis=1).tobytes()
    ds.PixelData = bytes(buf)
    ds.save_as(path, enforce_file_format=True, implicit_vr=False, little_endian=True)


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
for entry in sorted(os.listdir(OUT)):
    full = os.path.join(OUT, entry)
    size = sum(os.path.getsize(os.path.join(full, x)) for x in os.listdir(full)) if os.path.isdir(full) else os.path.getsize(full)
    print(f"{entry:24} {size / 2**20:8.0f} MB")
