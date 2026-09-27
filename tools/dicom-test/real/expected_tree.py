#!/usr/bin/env python3
"""
Lo que un CD/carpeta debería dar en el visor, calculado con pydicom: los ficheros que el cargador reconoce como DICOM
(con preámbulo o sin él: dicom_sniff.py, la misma regla que el visor), y el árbol paciente → estudio → modalidad →
serie → imágenes que monta classifierDCM (por PatientID, StudyInstanceUID, Modality y SeriesInstanceUID; los DICOMDIR
no se clasifican, ni lo que no tiene SOP Class ni imagen).

    python tools/dicom-test/real/expected_tree.py <carpeta>   -> JSON por stdout (lo lee cd_browser_test.mjs)
"""
import io
import json
import os
import sys

import pydicom

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dicom_sniff import HEAD_BYTES, dataset_offset  # noqa: E402

root = os.path.abspath(sys.argv[1])
found = 0
tree = {}
SKIP_DIRS = {"render", "ref", "big"}  # salidas del harness en out/
for dirpath, dirnames, files in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for name in files:
        path = os.path.join(dirpath, name)
        try:
            with open(path, "rb") as f:
                head = f.read(HEAD_BYTES)
        except OSError:
            continue
        start = dataset_offset(head)
        if start is None:
            continue
        found += 1
        try:
            src = io.BytesIO(open(path, "rb").read()[4:]) if start == 4 else path   # "DICM" sin preámbulo
            ds = pydicom.dcmread(src, stop_before_pixels=True, force=True)
        except Exception:  # noqa: BLE001
            continue
        # DICOMDIR: la SOP class solo va en el meta header (0002,0002); el dataset no lleva (0008,0016)
        meta_sop = str(getattr(ds, "file_meta", {}).get("MediaStorageSOPClassUID", "")) if hasattr(ds, "file_meta") else ""
        sop = str(ds.get("SOPClassUID", ""))
        if "1.2.840.10008.1.3.10" in (sop, meta_sop):
            continue
        if not (sop or meta_sop) and not ds.get("Rows"):
            continue   # sin SOP Class ni imagen: el clasificador no lo mete
        pat = str(ds.get("PatientID", ""))
        stu = str(ds.get("StudyInstanceUID", ""))
        mod = str(ds.get("Modality", ""))
        ser = str(ds.get("SeriesInstanceUID", ""))
        tree.setdefault(pat, {}).setdefault(stu, {}).setdefault(mod, {}).setdefault(ser, 0)
        tree[pat][stu][mod][ser] += 1

studies = sum(len(s) for s in tree.values())
modalities = sum(len(m) for s in tree.values() for m in s.values())
series = sum(len(x) for s in tree.values() for m in s.values() for x in m.values())
images = sum(n for s in tree.values() for m in s.values() for x in m.values() for n in x.values())
print(json.dumps({"folder": root, "dicomFound": found, "patients": len(tree), "studies": studies, "modalities": modalities,
                  "series": series, "images": images,
                  "seriesSizes": sorted([n for s in tree.values() for m in s.values() for x in m.values() for n in x.values()], reverse=True)}))
