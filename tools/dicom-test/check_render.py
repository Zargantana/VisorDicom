#!/usr/bin/env python3
"""
Compara lo que pinta el pipeline del visor (run_harness.mjs -> out/render) con la "verdad"
calculada con pydicom + numpy siguiendo PS3.3 C.11 (Modality LUT -> VOI LUT -> Presentation).
Genera out/render/contact_sheet.png (izquierda: esperado, derecha: visor).
"""
import json, os, sys
import numpy as np
import pydicom
from pydicom.pixels import apply_color_lut
from PIL import Image, ImageDraw

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "out")
REN = os.path.join(OUT, "render")
summary = json.load(open(os.path.join(REN, "render.json")))


def voi_linear(x, c, w):
    # PS3.3 C.11.2.1.2.1 (LINEAR)
    lo, hi = c - 0.5 - (w - 1) / 2, c - 0.5 + (w - 1) / 2
    y = ((x - (c - 0.5)) / (w - 1) + 0.5) * 255
    return np.where(x <= lo, 0, np.where(x > hi, 255, y))


def expected_frames(path, win):
    ds = pydicom.dcmread(path)
    ts = str(ds.file_meta.TransferSyntaxUID)
    ref = os.path.join(OUT, "ref", os.path.basename(path) + ".npy")
    if os.path.exists(ref):  # TS que pydicom no decodifica: verdad guardada por gen_test_dicoms.py
        arr = np.load(ref)
    elif ts == "1.2.840.10008.1.2.1.98":  # pydicom no la conoce: frames nativos encapsulados
        from pydicom.encaps import generate_frames
        nf = int(getattr(ds, "NumberOfFrames", 1))
        raw = b"".join(generate_frames(ds.PixelData, number_of_frames=nf))
        dt = np.int16 if ds.PixelRepresentation else np.uint16
        arr = np.frombuffer(raw, dt).reshape(ds.Rows, ds.Columns)
    else:
        arr = ds.pixel_array
    nf = int(getattr(ds, "NumberOfFrames", 1) or 1)
    pi = ds.PhotometricInterpretation
    frames = arr if nf > 1 else arr[None, ...]
    outs = []
    for fr in frames:
        if pi in ("MONOCHROME1", "MONOCHROME2"):
            x = fr.astype(np.float64) * float(getattr(ds, "RescaleSlope", 1)) + float(getattr(ds, "RescaleIntercept", 0))
            # Pixel Padding (0028,0120/0121): negro y fuera de la auto-ventana
            padmask = np.zeros(fr.shape, bool)
            if "PixelPaddingValue" in ds:
                p0 = int(ds.PixelPaddingValue)
                p1 = int(ds.get("PixelPaddingRangeLimit", p0))
                padmask = (fr >= min(p0, p1)) & (fr <= max(p0, p1))
            wc = ds.get("WindowCenter"); ww = ds.get("WindowWidth")
            if wc is not None:
                wcs = list(wc) if isinstance(wc, pydicom.multival.MultiValue) else [wc]
                wws = list(ww) if isinstance(ww, pydicom.multival.MultiValue) else [ww]
                y = voi_linear(x, float(wcs[win]), float(wws[win]))
            else:
                bs = int(getattr(ds, "BitsStored", ds.BitsAllocated))
                if bs <= 8:  # identidad sobre el rango completo
                    mn, mx = (-(1 << (bs - 1)), (1 << (bs - 1)) - 1) if ds.PixelRepresentation else (0, (1 << bs) - 1)
                    mn = mn * float(getattr(ds, "RescaleSlope", 1)) + float(getattr(ds, "RescaleIntercept", 0))
                    mx = mx * float(getattr(ds, "RescaleSlope", 1)) + float(getattr(ds, "RescaleIntercept", 0))
                else:        # auto-ventana min/max del frame (sin el relleno)
                    xv = x[~padmask] if (~padmask).any() else x
                    mn, mx = xv.min(), xv.max()
                y = (x - mn) * 255 / max(mx - mn, 1)
            if pi == "MONOCHROME1" or (pi == "MONOCHROME2" and str(ds.get("PresentationLUTShape", "")).upper() == "INVERSE"):
                y = 255 - y
            y = np.where(padmask, 0, y)
            rgb = np.repeat(y[..., None], 3, axis=2)
            # Supplemental Palette (MONOCHROME2 + Pixel Presentation COLOR/MIXED): valores de la LUT en color
            if pi == "MONOCHROME2" and str(ds.get("PixelPresentation", "")).upper() in ("COLOR", "MIXED") \
                    and "RedPaletteColorLookupTableDescriptor" in ds:
                first = int(ds.RedPaletteColorLookupTableDescriptor[1])
                luts = [np.frombuffer(ds[t].value, "<u2") for t in ("RedPaletteColorLookupTableData",
                        "GreenPaletteColorLookupTableData", "BluePaletteColorLookupTableData")]
                inside = (fr >= first) & (fr < first + len(luts[0]))
                idx = np.clip(fr.astype(np.int64) - first, 0, len(luts[0]) - 1)
                for c in range(3):
                    rgb[..., c] = np.where(inside, luts[c][idx] >> 8, rgb[..., c])
        elif pi == "PALETTE COLOR":
            rgb = apply_color_lut(fr, ds).astype(np.float64) / 257
        else:
            rgb = fr.astype(np.float64)
            if ds.BitsAllocated == 16:
                rgb = rgb / 257
        outs.append(np.clip(np.round(rgb), 0, 255).astype(np.uint8))
    return outs


EXPECTED = json.load(open(os.path.join(OUT, "expected.json")))

rows = []
tiles = []
fails = 0
for key, meta in summary.items():
    name, _, w = key.partition("#w")
    win = int(w) if w else 0
    path = os.path.join(OUT, name)
    exp_meta = EXPECTED.get(name, {})
    if exp_meta.get("kind") == "expect_fail":
        # Debe fallar de forma controlada: sin frames decodificados y sin excepción que tumbe el visor. Con
        # reason_contains, además, el motivo que enseña el visor tiene que mencionarlo (p. ej. "Sectra").
        reason = meta.get("unsupportedReason") or ""
        ok = meta["decodedFrames"] == 0 and not (meta.get("error") or "").startswith("THROW") \
            and exp_meta.get("reason_contains", "") in reason
        fails += 0 if ok else 1
        rows.append((key, "PASS" if ok else "FAIL",
                     ("rechazo controlado: " + reason)[:90] if ok else f"se esperaba rechazo: {meta}"))
        continue
    try:
        exp = expected_frames(path, win)
    except Exception as e:
        rows.append((key, "SKIP", f"sin verdad pydicom: {e}"[:70])); continue
    got = []
    for k in range(meta["decodedFrames"]):
        buf = np.fromfile(os.path.join(REN, f"{key}.f{k}.rgba"), np.uint8)
        if meta["rows"] and buf.size == meta["rows"] * meta["cols"] * 4:
            got.append(buf.reshape(meta["rows"], meta["cols"], 4)[..., :3])
    status, detail = "PASS", ""
    lossy = exp_meta.get("lossy") or \
        (meta.get("ts") or "").split(".")[-1] in ("50", "51", "52", "53", "54", "55", "56", "81", "91", "93", "203")
    tol_max, tol_mean = (60, 4.0) if lossy else (3, 0.6)
    if meta.get("error"):
        status, detail = "FAIL", "error: " + meta["error"]
    elif exp_meta.get("decoded_by") and meta.get("decodedBy") != exp_meta["decoded_by"]:
        # TS privada con códec estándar dentro: tiene que reconocerse por el contenido
        status, detail = "FAIL", f"códec reconocido {meta.get('decodedBy')!r} != {exp_meta['decoded_by']!r}"
    elif len(got) != len(exp):
        status, detail = "FAIL", f"frames decodificados {len(got)} != {len(exp)}"
    else:
        diffs = [np.abs(g.astype(int) - e.astype(int)) for g, e in zip(got, exp) if g.shape == e.shape]
        if len(diffs) != len(exp):
            status, detail = "FAIL", "dimensiones distintas"
        else:
            mx = max(d.max() for d in diffs); mean = max(d.mean() for d in diffs)
            detail = f"maxdiff={mx} meandiff={mean:.2f}"
            if mx > tol_max or mean > tol_mean:
                status = "FAIL"
    fails += status == "FAIL"
    rows.append((key, status, detail))
    e0 = exp[0]
    g0 = got[0] if got and got[0].shape == e0.shape else np.zeros_like(e0)
    tiles.append((key, status, np.concatenate([e0, np.full((e0.shape[0], 4, 3), 128, np.uint8), g0], axis=1)))

for r in rows:
    print(f"{r[1]:5s} {r[0]:40s} {r[2]}")
print(f"\n{fails} FAIL / {len(rows)} casos")

# contact sheet
tiles = [t for t in tiles if "t01_ct_evle_2win_0" not in t[0] or t[0].startswith("t01_ct_evle_2win_01")]
W = max(t[2].shape[1] for t in tiles) + 10
H = sum(t[2].shape[0] + 18 for t in tiles) + 10
sheet = Image.new("RGB", (W + 260, H), (40, 40, 40))
d = ImageDraw.Draw(sheet)
y = 5
for key, st, img in tiles:
    sheet.paste(Image.fromarray(img), (5, y + 14))
    d.text((5, y), f"{st} {key}", fill=(120, 255, 120) if st == "PASS" else (255, 110, 110))
    y += img.shape[0] + 18
sheet.save(os.path.join(REN, "contact_sheet.png"))
sys.exit(1 if fails else 0)
