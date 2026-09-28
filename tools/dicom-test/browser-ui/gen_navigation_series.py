#!/usr/bin/env python3
"""
Estudios sintéticos para probar la navegación del visor (run_navigation_test.mjs): un paciente con
  - estudio 1, CT: series 1 (12 imágenes) y 2 (15)   -> visor de pila (scroll viewer)
  - estudio 2, XA: serie 3 (30 imágenes)              -> visor de lista con la lista de miniaturas larga
  - estudio 3, XA: series 7 (3) y 4 (5)               -> una modalidad con dos series (se leen antes las de la 7)
Sin PHI. Uso: python3 tools/dicom-test/browser-ui/gen_navigation_series.py [carpeta]   (por defecto out/navigation)
"""
import os
import shutil
import sys

import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "out", "navigation")
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)


def image(prefix, modality, study, series, number, instance, date, description):
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2" if modality == "CT" else "1.2.840.10008.5.1.4.1.1.12.1"
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID = ds.file_meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.PatientName, ds.PatientID = "Navegacion^Prueba", "NAV-001"
    ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
    ds.StudyDate, ds.StudyDescription, ds.Modality = date, description, modality
    ds.SeriesNumber, ds.InstanceNumber = number, instance
    ds.Rows = ds.Columns = 64
    ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, "MONOCHROME2"
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 12, 11, 0
    pixels = np.full((64, 64), (instance * 97 + number * 500) % 4000, np.uint16)
    pixels[instance % 64, :] = 4000
    ds.WindowCenter, ds.WindowWidth = 2000, 4000
    ds.PixelData = pixels.tobytes()
    ds.save_as(os.path.join(OUT, f"{prefix}_{modality}_s{number}_{instance:03d}.dcm"), enforce_file_format=True)


ct, xa2, xa3 = generate_uid(), generate_uid(), generate_uid()
s1, s2, s3, s7, s4 = (generate_uid() for _ in range(5))
for i in range(1, 13):
    image("a", "CT", ct, s1, 1, i, "20260101", "CT uno")
for i in range(1, 16):
    image("a", "CT", ct, s2, 2, i, "20260101", "CT uno")
for i in range(1, 31):
    image("b", "XA", xa2, s3, 3, i, "20260102", "XA dos")
for i in range(1, 4):
    image("c", "XA", xa3, s7, 7, i, "20260103", "XA tres")   # "c" < "d": la serie 7 se lee antes que la 4
for i in range(1, 6):
    image("d", "XA", xa3, s4, 4, i, "20260103", "XA tres")
print(f"{len(os.listdir(OUT))} ficheros en {OUT}")
