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
# DICOM_TEST_OUT: otra carpeta (p. ej. out_real, con ficheros reales); expected.json puede estar vacío
OUT = os.path.abspath(os.environ.get("DICOM_TEST_OUT") or os.path.join(HERE, "out"))
REN = os.path.join(OUT, "render")
summary = json.load(open(os.path.join(REN, "render.json"), encoding="utf-8"))  # el harness escribe UTF-8 (motivos con acentos)
# DICOM_TEST_MANIFEST: {clave: {path}} (real/scan_corpus.py); las claves de render.json son las del manifiesto y los
# ficheros están donde diga "path"
MANIFEST = json.load(open(os.environ["DICOM_TEST_MANIFEST"], encoding="utf-8")) if os.environ.get("DICOM_TEST_MANIFEST") else {}


def source_path(name):
    m = MANIFEST.get(name)
    return (m["path"] if isinstance(m, dict) else m) if m else os.path.join(OUT, name)


def read_ds(path, **kw):
    """dcmread que también abre los ficheros sin preámbulo ni File Meta Information (ACR-NEMA, datasets crudos), como
    el visor: la Transfer Syntax implícita sale de cómo los ha leído pydicom. Con "DICM" al principio y sin los 128
    bytes del preámbulo, pydicom se pierde: se le da el fichero sin esas cuatro letras."""
    with open(path, "rb") as fh:
        head = fh.read(4)
    if head == b"DICM":
        import io
        path = io.BytesIO(open(path, "rb").read()[4:])
    ds = pydicom.dcmread(path, force=True, **kw)
    fm = getattr(ds, "file_meta", None)
    if fm is None or "TransferSyntaxUID" not in fm:
        from pydicom.dataset import FileMetaDataset
        from pydicom.uid import ExplicitVRBigEndian, ExplicitVRLittleEndian, ImplicitVRLittleEndian
        implicit, little = ds.original_encoding
        ds.file_meta = fm if fm is not None else FileMetaDataset()
        ds.file_meta.TransferSyntaxUID = ImplicitVRLittleEndian if implicit else (ExplicitVRLittleEndian if little else ExplicitVRBigEndian)
    return ds


# Textos que enseña el visor (nombre, ID, descripciones) frente a pydicom, que decodifica con (0008,0005)
TEXT_TAGS = (("PatientName", 0x00100010), ("PatientID", 0x00100020), ("StudyDescription", 0x00081030), ("SeriesDescription", 0x0008103E))


def expected_texts(path):
    """Lo que pydicom da para cada texto. Sin juego de caracteres declarado (o con ISO_IR 6), el visor lee como UTF-8
    los bytes de 8 bits que lo son (muchos programas escriben UTF-8 sin declararlo); pydicom los deja en Latin-1: en ese
    caso la verdad es el UTF-8."""
    ds = read_ds(path, stop_before_pixels=True)
    cs = ds.get("SpecificCharacterSet")
    cs = [str(v).strip() for v in (cs if isinstance(cs, pydicom.multival.MultiValue) else [cs])] if cs is not None else []
    undeclared = not cs or cs[0] in ("", "ISO_IR 6") and len(cs) == 1
    out = {}
    for kw, tag in TEXT_TAGS:
        if tag not in ds:
            out[kw] = ""
            continue
        raw = ds.get_item(tag).value
        value = None
        if undeclared and isinstance(raw, (bytes, bytearray)) and any(b >= 0x80 for b in raw):
            try:
                value = bytes(raw).decode("utf-8")
            except UnicodeDecodeError:
                value = None
        if value is None:
            v = ds[tag].value
            value = "\\".join(str(x) for x in v) if isinstance(v, pydicom.multival.MultiValue) else ("" if v is None else str(v))
        out[kw] = value.strip(" \0").replace("\0", "").strip()
    return out


# Cine de los multiframe (src/app/clases/Images/cine.ts), escrito aparte: si el visor y esto no coinciden, falla
CINE_FPS = {"XA": 15, "RF": 15, "US": 30, "IVUS": 30, "ES": 30, "XC": 30}
CINE_DEFAULT_FPS = 10
CINE_STACK = {"CT", "MR", "PT", "NM", "MG", "OPT", "IVOCT", "SEG", "RTDOSE", "SM"}


def expected_cine(path, frames):
    """Qué debe hacer el visor con un multiframe: {play, stack, frameTimeMs}. Tiempos del dataset raíz por este orden:
    Frame Time, media de Frame Time Vector (sin el primer valor), Recommended Display Frame Rate y Cine Rate; si no
    hay, los fps de la modalidad. Las modalidades de cortes sin tiempos no se reproducen."""
    ds = read_ds(path, stop_before_pixels=True)

    def values(keyword):
        try:
            v = ds.get(keyword)
        except Exception:  # noqa: BLE001  (valor ilegible: como si no viniera)
            return []
        if v is None or v == "":
            return []
        out = []
        for x in (v if isinstance(v, pydicom.multival.MultiValue) else [v]):
            try:
                out.append(float(x))
            except (TypeError, ValueError):
                pass
        return [x for x in out if np.isfinite(x)]

    first = lambda kw: (values(kw) or [0])[0]  # noqa: E731
    gaps = [x for x in values("FrameTimeVector")[1:] if x > 0]
    file_ms = 0.0
    for ms in (first("FrameTime"), sum(gaps) / len(gaps) if gaps else 0,
               1000 / first("RecommendedDisplayFrameRate") if first("RecommendedDisplayFrameRate") > 0 else 0,
               1000 / first("CineRate") if first("CineRate") > 0 else 0):
        if ms > 0:
            file_ms = ms
            break
    modality = str(ds.get("Modality", "") or "").strip(" \0").upper()
    ms = file_ms or 1000 / CINE_FPS.get(modality, CINE_DEFAULT_FPS)
    stack = frames > 1 and modality in CINE_STACK and not file_ms
    return {"play": frames > 1 and not stack, "stack": stack, "frameTimeMs": min(2000.0, max(10.0, ms))}


def voi_linear(x, c, w):
    # PS3.3 C.11.2.1.2.1 (LINEAR)
    if w <= 1:
        return np.where(x < c - 0.5, 0, 255)
    lo, hi = c - 0.5 - (w - 1) / 2, c - 0.5 + (w - 1) / 2
    y = ((x - (c - 0.5)) / (w - 1) + 0.5) * 255
    return np.where(x <= lo, 0, np.where(x > hi, 255, y))


def voi_window(x, c, w, func):
    """Ventana VOI con la función (0028,1056), como base-color.applyVOIWindow: LINEAR, LINEAR_EXACT o SIGMOID."""
    func = (func or "LINEAR").upper()
    if func == "SIGMOID":
        return 255 / (1 + np.exp(-4 * (x - c) / (w or 1)))
    if func == "LINEAR_EXACT":
        return np.clip(((x - c) / (w or 1) + 0.5) * 255, 0, 255)
    return voi_linear(x, c, w)


def first_value(v, index=0):
    """DS multivalor (WindowCenter) -> float del índice pedido (o el primero); None si está vacío ("" en el fichero)."""
    if v is None:
        return None
    vals = [x for x in (list(v) if isinstance(v, pydicom.multival.MultiValue) else [v]) if x not in (None, "")]
    if not vals:
        return None
    return float(vals[index if index < len(vals) else 0])


def voi_lut_gray(x, item, signed_input):
    """VOI LUT Sequence como la aplica el visor (Monochorme2Color.buildGrayFunction): índice = round(valor) - first,
    recortado; gris normalizado con el mínimo y máximo de la propia LUT. El primer valor mapeado es con signo (SS) si
    la entrada de la LUT puede ser negativa (PS3.3 C.11.2.1.1): `signed_input`."""
    n, first, bits = (int(v) for v in item.LUTDescriptor)
    data = item.LUTData
    if isinstance(data, (bytes, bytearray)):
        lut = np.frombuffer(data, "<u2" if bits > 8 else "u1").astype(np.float64)
    else:
        lut = np.array([int(v) for v in data], np.float64)
    if signed_input and first > 32767:
        first -= 65536
    lo, hi = lut.min(), lut.max()
    idx = np.clip(np.round(x).astype(np.int64) - first, 0, len(lut) - 1)
    return (lut[idx] - lo) * 255 / max(1, hi - lo)


def expected_frames(path, win, indices=None, manual=None):
    """Frames esperados (RGB 0..255). Con `indices` (writtenFrames del harness en multiframes grandes) solo se
    decodifican esos frames con pydicom, frame a frame: una lámina de 5.000 tiles o una tomosíntesis de 700 MB no
    hace falta decodificarla entera para comparar tres frames."""
    ds = read_ds(path)
    ts = str(ds.file_meta.TransferSyntaxUID)
    nf = int(getattr(ds, "NumberOfFrames", 1) or 1)
    ref = os.path.join(OUT, "ref", os.path.basename(path) + ".npy")
    if os.path.exists(ref):  # TS que pydicom no decodifica: verdad guardada por gen_test_dicoms.py
        arr = np.load(ref)
        frames = arr if nf > 1 else arr[None, ...]
    elif ts == "1.2.840.10008.1.2.1.98":  # pydicom no la conoce: frames nativos encapsulados
        from pydicom.encaps import generate_frames
        raw = b"".join(generate_frames(ds.PixelData, number_of_frames=nf))
        dt = np.int16 if ds.PixelRepresentation else np.uint16
        frames = np.frombuffer(raw, dt).reshape(ds.Rows, ds.Columns)[None, ...]
    elif indices is not None and nf > 1:
        from pydicom.pixels import pixel_array as decode_frame
        frames = [decode_frame(ds, index=k) for k in indices if k < nf]
    else:
        try:
            arr = ds.pixel_array
        except Exception:
            # JPEG Extended de 12 bits (.51): pylibjpeg no lo decodifica; libjpeg-turbo 3 (imagecodecs) sí
            if ts not in ("1.2.840.10008.1.2.4.50", "1.2.840.10008.1.2.4.51"):
                raise
            import imagecodecs
            from pydicom.encaps import generate_frames
            arr = np.stack([imagecodecs.jpeg_decode(f) for f in generate_frames(ds.PixelData, number_of_frames=nf)])
            arr = arr if nf > 1 else arr[0]
        frames = arr if nf > 1 else arr[None, ...]
    if indices is not None and not (isinstance(frames, list)):
        frames = [frames[k] for k in indices if k < len(frames)]
    pi = ds.PhotometricInterpretation
    # Multiframe mejorado: ventana y rescale en los Shared Functional Groups (el visor los encuentra con
    # searchTopLevelFirst cuando no están en el dataset raíz) y, por frame, en los Per-Frame Functional Groups (el
    # visor aplica los del frame si la raíz del dataset no trae ventana propia)
    root_has_window = "WindowCenter" in ds
    voi_func = str(ds.get("VOILUTFunction", "")) or None
    shared = ds.get("SharedFunctionalGroupsSequence")
    shared = shared[0] if shared else None
    # (las secuencias pueden estar presentes pero vacías: DISCIMG)
    if shared is not None and "WindowCenter" not in ds and shared.get("FrameVOILUTSequence") and "WindowCenter" in shared.FrameVOILUTSequence[0]:
        ds.WindowCenter = shared.FrameVOILUTSequence[0].WindowCenter
        ds.WindowWidth = shared.FrameVOILUTSequence[0].get("WindowWidth")
        voi_func = voi_func or (str(shared.FrameVOILUTSequence[0].get("VOILUTFunction", "")) or None)
    if shared is not None and "RescaleSlope" not in ds and shared.get("PixelValueTransformationSequence") and "RescaleSlope" in shared.PixelValueTransformationSequence[0]:
        ds.RescaleSlope = shared.PixelValueTransformationSequence[0].RescaleSlope
        ds.RescaleIntercept = shared.PixelValueTransformationSequence[0].get("RescaleIntercept", 0)
    per_frame = ds.get("PerFrameFunctionalGroupsSequence")

    def frame_params(k):
        """(wc, ww, func, slope, intercept) del frame k, con la misma prioridad que el visor."""
        wc = ds.get("WindowCenter"); ww = ds.get("WindowWidth"); func = voi_func
        slope = float(ds.get("RescaleSlope", 1)); intercept = float(ds.get("RescaleIntercept", 0))
        g = per_frame[k] if per_frame is not None and k < len(per_frame) else None
        if g is not None:
            v = g.get("FrameVOILUTSequence")
            if v and not root_has_window and first_value(v[0].get("WindowCenter")) is not None:
                wc, ww = v[0].WindowCenter, v[0].get("WindowWidth")
                func = str(v[0].get("VOILUTFunction", "")) or func
            t = g.get("PixelValueTransformationSequence")
            if t:
                slope = float(t[0].get("RescaleSlope", slope)) or slope
                intercept = float(t[0].get("RescaleIntercept", intercept))
        return wc, ww, func, slope, intercept
    # pydicom 3.0 lee la LUT de paleta no segmentada (OW) siempre en little endian; con Explicit VR Big Endian las
    # palabras van al revés (PS3.3 C.7.6.3.1.6): se corrigen una vez, antes del bucle, para que la verdad siga el
    # endian del dataset (la privada de GE solo tiene los píxeles en BE; la LUT va con la cabecera, LE).
    if pi == "PALETTE COLOR" and ts == "1.2.840.10008.1.2.2":
        for c in ("Red", "Green", "Blue", "Alpha"):
            t = c + "PaletteColorLookupTableData"
            if t in ds and int(ds[c + "PaletteColorLookupTableDescriptor"][2]) > 8:
                ds[t].value = np.frombuffer(ds[t].value, ">u2").astype("<u2").tobytes()
    outs = []
    frame_numbers = list(indices) if indices is not None else list(range(len(frames)))
    for k, fr in zip(frame_numbers, frames):
        wc, ww, func, slope, intercept = frame_params(k)
        if pi in ("MONOCHROME1", "MONOCHROME2"):
            x = fr.astype(np.float64) * slope + intercept
            # Pixel Padding (0028,0120/0121): negro y fuera de la auto-ventana
            padmask = np.zeros(fr.shape, bool)
            if "PixelPaddingValue" in ds:
                p0 = int(ds.PixelPaddingValue)
                p1 = int(ds.get("PixelPaddingRangeLimit", p0))
                padmask = (fr >= min(p0, p1)) & (fr <= max(p0, p1))
            wcv, wwv = first_value(wc, win), first_value(ww, win)
            if manual is not None:  # ventana del usuario (variante "#m"): LINEAR, manda sobre el fichero
                y = voi_linear(x, float(manual[0]), float(manual[1]))
            elif wcv is not None and wwv is not None:
                y = voi_window(x, wcv, wwv, func)
            elif "VOILUTSequence" in ds:  # VOI LUT (0028,3010) como la aplica el visor
                bs = int(getattr(ds, "BitsStored", ds.BitsAllocated))
                lo, hi = (-(1 << (bs - 1)), (1 << (bs - 1)) - 1) if ds.PixelRepresentation else (0, (1 << bs) - 1)
                y = voi_lut_gray(x, ds.VOILUTSequence[0], min(lo * slope + intercept, hi * slope + intercept) < 0)
            else:
                bs = int(getattr(ds, "BitsStored", ds.BitsAllocated))
                if bs <= 8:  # identidad sobre el rango completo
                    mn, mx = (-(1 << (bs - 1)), (1 << (bs - 1)) - 1) if ds.PixelRepresentation else (0, (1 << bs) - 1)
                    mn = mn * slope + intercept
                    mx = mx * slope + intercept
                else:        # auto-ventana min/max del frame (sin el relleno)
                    xv = x[~padmask] if (~padmask).any() else x
                    mn, mx = xv.min(), xv.max()
                y = (x - mn) * 255 / max(mx - mn, 1e-9)  # 1e-9 como el visor: un PET con slope 3e-7 no es negro
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
            elif ds.BitsAllocated == 32:
                rgb = rgb / 16843009   # 2^32-1 -> 255
        outs.append(np.clip(np.round(rgb), 0, 255).astype(np.uint8))
    return outs


EXPECTED = json.load(open(os.path.join(OUT, "expected.json"), encoding="utf-8"))
# DICOM_TEST_FILTER: solo esas claves; el resultado se fusiona con el check.json anterior (para repetir unos pocos
# ficheros de un corpus sin volver a comparar los miles restantes)
import re
FILTER = re.compile(os.environ["DICOM_TEST_FILTER"]) if os.environ.get("DICOM_TEST_FILTER") else None
# DICOM_TEST_ONLY_NEW=1: solo las claves que aún no están en check.json (tras borrar de render.json y check.json las
# que se quieren repetir), fusionando el resultado
ONLY_NEW = bool(os.environ.get("DICOM_TEST_ONLY_NEW"))
PREVIOUS = json.load(open(os.path.join(REN, "check.json"), encoding="utf-8")) if (ONLY_NEW or FILTER) and os.path.exists(os.path.join(REN, "check.json")) else {}

rows = []
tiles = []
fails = 0
for key, meta in summary.items():
    manual_variant = key.endswith("#m")
    name, _, w = (key[:-2] if manual_variant else key).partition("#w")
    win = int(w) if w else 0
    if FILTER and not FILTER.search(name):
        continue
    if ONLY_NEW and key in PREVIOUS:
        continue
    path = source_path(name)
    exp_meta = EXPECTED.get(name, {})
    if not w and not manual_variant and meta.get("text") is not None:
        # Textos (juego de caracteres): fila propia "<fichero>#text", para que un fallo de texto no tape el de píxeles
        try:
            exp_text = expected_texts(path)
            bad = [f"{k}: {meta['text'].get(k, '')!r} != {v!r}" for k, v in exp_text.items() if (meta["text"].get(k) or "") != v]
            if bad:
                fails += 1
                rows.append((name + "#text", "FAIL", ("texto distinto: " + "; ".join(bad))[:300]))
            elif any(ord(ch) > 127 for v in exp_text.values() for ch in v):
                rows.append((name + "#text", "PASS", ("texto: " + " | ".join(v for v in exp_text.values() if v))[:120]))
        except Exception as e:  # noqa: BLE001
            rows.append((name + "#text", "SKIP", f"sin verdad de texto: {e}"[:90]))
    if not w and not manual_variant and meta.get("cine") is not None:
        # Multiframe: cine o frame a frame, y la velocidad (fila "<fichero>#cine")
        try:
            got, exp = meta["cine"], expected_cine(path, meta.get("frames") or 1)
            if got.get("play") != exp["play"] or got.get("stack") != exp["stack"] \
                    or abs((got.get("frameTimeMs") or 0) - exp["frameTimeMs"]) > 0.01:
                fails += 1
                rows.append((name + "#cine", "FAIL", f"cine distinto: {got} != {exp}"[:300]))
            else:
                how = f"cine a {exp['frameTimeMs']:.1f} ms/frame" if exp["play"] else "frame a frame, sin cine"
                rows.append((name + "#cine", "PASS", how))
        except Exception as e:  # noqa: BLE001
            rows.append((name + "#cine", "SKIP", f"sin verdad de cine: {e}"[:90]))
    if exp_meta.get("kind") == "video":
        # Vídeo H.264/HEVC: en Node no hay WebCodecs; se comprueba el troceo del flujo en frames (unidades de acceso),
        # las IDR y la cadena de códec, y que el visor lo explica sin romperse. Los píxeles, en Chrome/Edge
        # (browser-ui/run_video_test.mjs).
        video = meta.get("video") or {}
        reason = meta.get("unsupportedReason") or ""
        ok = video.get("family") == exp_meta["family"] and video.get("frames") == exp_meta["units"] \
            and video.get("keys") == exp_meta["keys"] and (video.get("codec") or "").startswith(exp_meta["codec_prefix"]) \
            and (meta["decodedFrames"] == exp_meta["units"] or "WebCodecs" in reason) \
            and not (meta.get("error") or "").startswith("THROW")
        fails += 0 if ok else 1
        rows.append((key, "PASS" if ok else "FAIL",
                     f"vídeo {video.get('codec')}: {video.get('frames')} frames, {video.get('keys')} IDR" if ok else f"vídeo: {meta}"[:300]))
        continue
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
    if not exp_meta and meta["decodedFrames"] == 0 and meta.get("unsupportedReason") and not (meta.get("error") or "").startswith("THROW"):
        # Fichero real sin expectativa: el visor lo rechaza de forma controlada y explica por qué (p. ej. Float Pixel Data)
        rows.append((key, "SKIP", ("rechazo controlado: " + meta["unsupportedReason"])[:90])); continue
    # writtenFrames: el harness solo guardó algunos frames (multiframe grande); se comparan esos y pydicom solo
    # decodifica esos
    written = meta.get("writtenFrames")
    try:
        exp = expected_frames(path, win, written, exp_meta.get("manual") if manual_variant else None)
    except Exception as e:
        if os.environ.get("DICOM_TEST_VERBOSE"):
            import traceback
            traceback.print_exc()
        rows.append((key, "SKIP", f"sin verdad pydicom: {e}"[:70])); continue
    got = []
    for k in (written if written is not None else range(meta["decodedFrames"])):
        buf = np.fromfile(os.path.join(REN, f"{key}.f{k}.rgba"), np.uint8)
        if meta["rows"] and buf.size == meta["rows"] * meta["cols"] * 4:
            got.append(buf.reshape(meta["rows"], meta["cols"], 4)[..., :3])
    status, detail = "PASS", ""
    lossy = exp_meta.get("lossy") or \
        (meta.get("ts") or "").split(".")[-1] in ("50", "51", "52", "53", "54", "55", "56", "81", "91", "93", "203")
    # Con pérdida, el submuestreo de croma de cada decodificador (libjpeg "fancy upsampling" vs pdf.js) da picos de
    # hasta ~80 en bordes de color aislados con una media casi nula; por eso el máximo es holgado y la media, estricta.
    # En ecografías reales 4:2:2 los picos aislados llegan a ~150 con media < 1: si la media es casi nula, el máximo
    # no cuenta (un error de color sistemático dispara la media).
    tol_max, tol_mean = (90, 4.0) if lossy else (3, 0.6)
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
            if mean > tol_mean or (mx > tol_max and not (lossy and mean <= 3.0)):
                status = "FAIL"
    fails += status == "FAIL"
    rows.append((key, status, detail))
    e0 = exp[0]
    g0 = got[0] if got and got[0].shape == e0.shape else np.zeros_like(e0)
    # Los ficheros reales pueden ser grandes: en la hoja de contactos se reducen a 160 px de ancho
    if e0.shape[1] > 160:
        f = 160 / e0.shape[1]
        size = (160, max(1, int(e0.shape[0] * f)))
        e0 = np.asarray(Image.fromarray(e0).resize(size))
        g0 = np.asarray(Image.fromarray(g0).resize(size))
    tiles.append((key, status, np.concatenate([e0, np.full((e0.shape[0], 4, 3), 128, np.uint8), g0], axis=1)))

for r in rows:
    print(f"{r[1]:5s} {r[0]:40s} {r[2]}")
print(f"\n{fails} FAIL / {len(rows)} casos")
# Resultado por caso, para informes (real/report_corpus.py); con filtro se fusiona con lo anterior
check_path = os.path.join(REN, "check.json")
results = {r[0]: {"status": r[1], "detail": r[2]} for r in rows}
if (FILTER or ONLY_NEW) and PREVIOUS:
    merged = dict(PREVIOUS)
    merged.update(results)
    results = merged
json.dump(results, open(check_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)

# contact sheet (con un corpus grande, solo los fallos)
tiles = [t for t in tiles if "t01_ct_evle_2win_0" not in t[0] or t[0].startswith("t01_ct_evle_2win_01")]
if len(tiles) > 300:
    tiles = [t for t in tiles if t[1] == "FAIL"]
if not tiles:
    sys.exit(1 if fails else 0)
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
