#!/usr/bin/env python3
"""
Inventario de un corpus de ficheros DICOM reales (carpetas anidadas, ficheros sin extensión, DICOMDIR, archivos
comprimidos) y manifiesto para pasar TODOS por el harness del visor sin copiarlos.

    python tools/dicom-test/real/scan_corpus.py <raíz> [--out tools/dicom-test/out_corpus] [--extract]

Escribe en <out>:
  inventory.jsonl   una línea por fichero (ruta, tamaño, si es DICOM, TS, SOP class, modalidad, dimensiones, frames…)
  inventory.md      resumen por carpeta de primer nivel, modalidad y Transfer Syntax
  manifest.json     {clave: {path, mb, ...}} solo los candidatos a imagen (Rows, Columns y BitsAllocated), para
                    DICOM_TEST_MANIFEST en run_harness.mjs y check_render.py
  expected.json     vacío (check_render compara con pydicom cuando puede)
Con --extract, los .zip / .tar / .tar.bz2 se extraen en <out>/extracted/<archivo>/ y se inventarían también.
"""
import argparse
import json
import os
import re
import sys
import tarfile
import zipfile
from collections import Counter, defaultdict

import pydicom
from pydicom.uid import UID

SKIP_EXT = {".txt", ".xml", ".xls", ".xlsx", ".docx", ".doc", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".db", ".htm",
            ".html", ".json", ".exe", ".dll", ".ini", ".lnk", ".md", ".csv", ".log", ".bat", ".ps1", ".py", ".js"}
ARCHIVE_EXT = {".zip", ".tar", ".bz2", ".gz", ".tgz", ".7z", ".rar"}


def is_part10(path):
    try:
        with open(path, "rb") as f:
            head = f.read(132)
        return len(head) == 132 and head[128:132] == b"DICM"
    except OSError:
        return False


def read_header(path):
    """Cabecera sin Pixel Data. Con force=True para los ficheros sin preámbulo (Part 10 sin meta, dumps ACR-NEMA)."""
    return pydicom.dcmread(path, stop_before_pixels=True, force=True)


def looks_like_dicom(ds):
    keys = ("SOPClassUID", "Modality", "Rows", "PatientID", "StudyInstanceUID", "SeriesInstanceUID", "SOPInstanceUID")
    return sum(1 for k in keys if k in ds) >= 3


def uid_name(uid):
    try:
        return UID(str(uid)).name
    except Exception:  # noqa: BLE001
        return str(uid)


def inspect(path, rel, size):
    rec = {"rel": rel, "path": path, "mb": round(size / 1048576, 2), "part10": is_part10(path), "dicom": False}
    try:
        ds = read_header(path)
    except Exception as e:  # noqa: BLE001
        rec["error"] = f"pydicom: {str(e)[:120]}"
        return rec
    if not rec["part10"] and not looks_like_dicom(ds):
        return rec
    rec["dicom"] = True
    meta = getattr(ds, "file_meta", None)
    ts = str(meta.TransferSyntaxUID) if meta is not None and "TransferSyntaxUID" in meta else ""
    rec["ts"] = ts
    rec["ts_name"] = uid_name(ts) if ts else "(sin meta: implícita LE por defecto)"
    sop = str(ds.get("SOPClassUID", ""))
    # DICOMDIR: la SOP class solo va en el meta header (0002,0002); el dataset no lleva (0008,0016)
    meta_sop = str(meta.get("MediaStorageSOPClassUID", "")) if meta is not None else ""
    if not sop and meta_sop:
        sop = meta_sop
    rec["sop"] = sop
    rec["sop_name"] = uid_name(sop) if sop else "(sin SOP class)"
    rec["dicomdir"] = sop == "1.2.840.10008.1.3.10"
    rec["modality"] = str(ds.get("Modality", ""))
    for k, key in (("Rows", "rows"), ("Columns", "cols"), ("BitsAllocated", "bits"), ("BitsStored", "stored"),
                   ("SamplesPerPixel", "spp"), ("PixelRepresentation", "signed")):
        v = ds.get(k)
        if v is not None:
            try:
                rec[key] = int(v)
            except (TypeError, ValueError):
                rec[key] = str(v)
    rec["frames"] = int(ds.get("NumberOfFrames", 1) or 1)
    rec["photometric"] = str(ds.get("PhotometricInterpretation", ""))
    rec["manufacturer"] = str(ds.get("Manufacturer", ""))[:40]
    rec["image"] = bool(rec.get("rows") and rec.get("cols") and rec.get("bits")) and not rec["dicomdir"]
    return rec


def extract_archives(root, out_dir):
    """Extrae los archivos comprimidos (una vez) y devuelve las carpetas resultantes."""
    dirs = []
    for dirpath, _, files in os.walk(root):
        for name in files:
            ext = os.path.splitext(name)[1].lower()
            if ext not in (".zip", ".tar", ".bz2", ".gz", ".tgz"):
                continue
            src = os.path.join(dirpath, name)
            dst = os.path.join(out_dir, "extracted", re.sub(r"[^A-Za-z0-9_.-]+", "_", os.path.relpath(src, root)))
            if os.path.isdir(dst) and os.listdir(dst):
                dirs.append(dst)
                continue
            os.makedirs(dst, exist_ok=True)
            try:
                if ext == ".zip":
                    with zipfile.ZipFile(src) as z:
                        z.extractall(dst)
                else:
                    with tarfile.open(src) as t:
                        t.extractall(dst)
                print(f"extraído {os.path.relpath(src, root)} -> {dst}")
                dirs.append(dst)
            except Exception as e:  # noqa: BLE001
                print(f"no se pudo extraer {src}: {e}")
    return dirs


def sanitize(s, n):
    s = re.sub(r"[^A-Za-z0-9_.-]+", "_", s).strip("_")
    return s[:n] if len(s) > n else s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out_corpus"))
    ap.add_argument("--extract", action="store_true")
    args = ap.parse_args()
    root = os.path.abspath(args.root)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    roots = [root]
    if args.extract:
        roots += extract_archives(root, out)

    records = []
    for base in roots:
        for dirpath, _, files in os.walk(base):
            if base == root and os.path.abspath(dirpath).startswith(os.path.join(out, "")):
                continue
            for name in sorted(files):
                path = os.path.join(dirpath, name)
                ext = os.path.splitext(name)[1].lower()
                if base == root:
                    rel = os.path.relpath(path, root)
                else:
                    rel = "extracted/" + os.path.relpath(path, os.path.join(out, "extracted"))
                size = os.path.getsize(path)
                if ext in SKIP_EXT or ext in ARCHIVE_EXT:
                    records.append({"rel": rel, "path": path, "mb": round(size / 1048576, 2), "dicom": False, "skipped_ext": ext})
                    continue
                rec = inspect(path, rel, size)
                records.append(rec)
                if len(records) % 200 == 0:
                    print(f"  {len(records)} ficheros…", file=sys.stderr)

    with open(os.path.join(out, "inventory.jsonl"), "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    manifest = {}
    for i, r in enumerate(records):
        if r.get("image"):
            parts = r["rel"].replace("\\", "/").split("/")
            folder = sanitize(parts[-2], 40) if len(parts) > 1 else "raiz"
            key = f"{i:04d}__{folder}__{sanitize(parts[-1], 60)}"
            manifest[key] = {"path": r["path"], "rel": r["rel"], "mb": r["mb"], "ts": r.get("ts", ""),
                             "modality": r.get("modality", ""), "frames": r.get("frames", 1)}
    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    exp = os.path.join(out, "expected.json")
    if not os.path.exists(exp):
        json.dump({}, open(exp, "w"))

    # Resumen
    top = lambda r: r["rel"].replace("\\", "/").split("/")[0]  # noqa: E731
    dicom = [r for r in records if r.get("dicom")]
    lines = [f"# Inventario de {root}", "",
             f"Ficheros: {len(records)} · DICOM: {len(dicom)} · imágenes (candidatas al harness): {len(manifest)} · "
             f"DICOMDIR: {sum(1 for r in dicom if r.get('dicomdir'))} · no DICOM: {len(records) - len(dicom)}", ""]
    lines += ["## Por carpeta de primer nivel", "", "| Carpeta | Ficheros | DICOM | Imágenes | MB | Modalidades | Transfer Syntaxes |", "|---|---|---|---|---|---|---|"]
    by_top = defaultdict(list)
    for r in records:
        by_top[top(r)].append(r)
    for t, rs in sorted(by_top.items()):
        ds_ = [r for r in rs if r.get("dicom")]
        mods = Counter(r.get("modality") or "?" for r in ds_)
        tss = Counter(r.get("ts_name") or "?" for r in ds_)
        lines.append(f"| {t} | {len(rs)} | {len(ds_)} | {sum(1 for r in ds_ if r.get('image'))} | {round(sum(r['mb'] for r in rs))} | "
                     f"{', '.join(f'{m} ({n})' for m, n in mods.most_common())} | {', '.join(f'{x} ({n})' for x, n in tss.most_common())} |")
    lines += ["", "## Transfer Syntaxes (todas las carpetas)", ""]
    for x, n in Counter(r.get("ts_name") for r in dicom).most_common():
        lines.append(f"- {x}: {n}")
    lines += ["", "## SOP classes", ""]
    for x, n in Counter(r.get("sop_name") for r in dicom).most_common():
        lines.append(f"- {x}: {n}")
    errs = [r for r in records if r.get("error")]
    if errs:
        lines += ["", "## pydicom no pudo leer la cabecera", ""] + [f"- {r['rel']}: {r['error']}" for r in errs]
    big = [r for r in dicom if r["mb"] > 480]
    if big:
        lines += ["", "## Mayores de 480 MB (fuera del tope de string del navegador)", ""] + [f"- {r['rel']}: {r['mb']} MB" for r in big]
    open(os.path.join(out, "inventory.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("\n".join(lines[:12]))
    print(f"\n{len(manifest)} imágenes en {os.path.join(out, 'manifest.json')}")


if __name__ == "__main__":
    main()
