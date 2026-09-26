#!/usr/bin/env python3
"""Reúne ficheros DICOM *reales* (no sintéticos) para pasarlos por el mismo harness que la batería:
los que trae pydicom y los externos de pydicom-data (se descargan con pydicom a ~/.pydicom/data): entre ellos hay
muestras del juego NEMA WG04 (US1/RG1/RG3/MR2/693 en J2K, JPEG-LS, RLE...), ficheros de fabricante (Siemens con
overlays, Aloka US, GDCM), Modality/VOI LUT en secuencia, mapas paramétricos en coma flotante, Deflate, Big Endian,
conversiones YBR de DCMTK, etc. Se copian a la carpeta de salida con el prefijo `real_`.

    python tools/dicom-test/real/fetch_real_files.py [carpeta_salida]   (por defecto tools/dicom-test/out_real)

Después:  DICOM_TEST_OUT=<carpeta> node tools/dicom-test/run_harness.mjs && DICOM_TEST_OUT=<carpeta> python tools/dicom-test/check_render.py
"""
import json
import os
import shutil
import sys

import pydicom.data as pdata
from pydicom.data import get_testdata_file, get_testdata_files

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, "..", "out_real")
os.makedirs(OUT, exist_ok=True)

names = set()
for f in get_testdata_files():
    if f.lower().endswith(".dcm"):
        names.add(os.path.basename(f))
hashes = json.load(open(os.path.join(os.path.dirname(pdata.__file__), "hashes.json")))
names |= {k for k in hashes if k.lower().endswith(".dcm")}

copied, missing = 0, []
for name in sorted(names):
    try:
        src = get_testdata_file(name)
    except Exception as e:  # noqa: BLE001
        missing.append(f"{name}: {e}")
        continue
    if not src or not os.path.isfile(src):
        missing.append(name)
        continue
    dst = os.path.join(OUT, "real_" + name)
    if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(src):
        shutil.copyfile(src, dst)
    copied += 1

# expected.json vacío: check_render compara con pydicom cuando puede y marca SKIP cuando no
exp = os.path.join(OUT, "expected.json")
if not os.path.exists(exp):
    json.dump({}, open(exp, "w"))
print(f"{copied} ficheros reales en {OUT}" + (f"; sin conseguir: {len(missing)}" if missing else ""))
for m in missing:
    print("  ", m)
