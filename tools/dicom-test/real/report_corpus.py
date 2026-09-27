#!/usr/bin/env python3
"""Informe del corpus: cruza inventory.jsonl + manifest.json + render/render.json + render/check.json -> report.md"""
import argparse
import json
import os
import re
from collections import Counter, defaultdict


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out_corpus"))
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    manifest = json.load(open(os.path.join(out, "manifest.json"), encoding="utf-8"))
    render = json.load(open(os.path.join(out, "render", "render.json"), encoding="utf-8"))
    check_path = os.path.join(out, "render", "check.json")
    check = json.load(open(check_path, encoding="utf-8")) if os.path.exists(check_path) else {}
    inventory = [json.loads(l) for l in open(os.path.join(out, "inventory.jsonl"), encoding="utf-8")]
    by_rel = {r["rel"]: r for r in inventory}

    def status_of(key):
        """Estado final de un fichero (clave sin #w ni #text): FAIL manda; luego CRASH, BIG, TILES, SIN_META, SKIP, PASS,
        PENDIENTE. Las filas "#text" (textos decodificados frente a pydicom) cuentan como las de píxeles."""
        keys = [k for k in check if k.split("#")[0] == key]
        meta = render.get(key)
        inv = by_rel.get(manifest[key]["rel"], {})
        if meta is None:
            return "PENDIENTE", "sin procesar"
        if (meta.get("error") or "").startswith("CRASH"):
            return "CRASH", meta["error"]
        if meta.get("skippedBig"):
            return "BIG", meta.get("unsupportedReason", "")
        if meta.get("skippedTiles"):
            return "TILES", meta.get("unsupportedReason", "")
        # Sin preámbulo "DICM" (ACR-NEMA, datasets crudos): desde el 2026-09-27 el cargador los reconoce si sus primeros
        # elementos forman un dataset (DCMFile.sniffDataset); SIN_META queda para los que ni así (isDicom del harness)
        if not inv.get("part10", True) and not meta.get("isDicom"):
            return "SIN_META", "sin preámbulo DICM y sin un dataset reconocible: el cargador no lo reconoce como DICOM"
        if not keys:
            return "PENDIENTE", "sin comparar"
        sts = [check[k]["status"] for k in keys]
        det = "; ".join(f"{k.split('#', 1)[1] if '#' in k else 'w0'}: {check[k]['detail']}" for k in keys)
        if "FAIL" in sts:
            return "FAIL", det
        if all(s == "SKIP" for s in sts):
            return "SKIP", det
        return "PASS", det

    rows = []
    for key, m in manifest.items():
        st, det = status_of(key)
        inv = by_rel.get(m["rel"], {})
        top = m["rel"].replace("\\", "/").split("/")[0]
        rows.append({"key": key, "rel": m["rel"], "top": top, "mb": m["mb"], "ts": inv.get("ts_name", m.get("ts", "")),
                     "modality": m.get("modality", ""), "frames": m.get("frames", 1), "status": st, "detail": det,
                     "ms": (render.get(key) or {}).get("ms"), "decodedBy": (render.get(key) or {}).get("decodedBy")})
    order = ["PASS", "SKIP", "SIN_META", "BIG", "TILES", "CRASH", "FAIL", "PENDIENTE"]
    tot = Counter(r["status"] for r in rows)
    lines = ["# Corpus de imágenes reales: resultado del visor", "",
             f"Imágenes: {len(rows)} · " + " · ".join(f"{s}: {tot.get(s, 0)}" for s in order), "",
             "PASS = píxeles iguales a pydicom (±3, o tolerancia de compresión con pérdida). SKIP = rechazo controlado con motivo o sin verdad "
             "de pydicom. SIN_META = sin preámbulo DICM ni dataset reconocible (el cargador del visor no los reconoce). "
             "Los textos (nombre, ID, descripciones) se comparan también con pydicom. BIG = mayor que el tope de la versión actual "
             "(string del navegador). TILES = lámina de patología por tiles (miles de frames), fuera del alcance. CRASH = tumbó el proceso de "
             "Node. FAIL = se pinta pero distinto de pydicom, o error.", ""]

    def table(title, group):
        lines.extend([f"## {title}", "", "| Grupo | Imágenes | " + " | ".join(order) + " |", "|---|---|" + "---|" * len(order)])
        g = defaultdict(list)
        for r in rows:
            g[group(r)].append(r)
        for name, rs in sorted(g.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            c = Counter(r["status"] for r in rs)
            lines.append(f"| {name} | {len(rs)} | " + " | ".join(str(c.get(s, 0)) for s in order) + " |")
        lines.append("")

    table("Por carpeta de primer nivel", lambda r: r["top"])
    table("Por Transfer Syntax", lambda r: r["ts"] or "?")
    table("Por modalidad", lambda r: r["modality"] or "?")

    for st in ("FAIL", "CRASH"):
        rs = [r for r in rows if r["status"] == st]
        if rs:
            lines += [f"## {st} ({len(rs)})", ""]
            for r in rs:
                lines.append(f"- `{r['rel']}` · {r['mb']} MB · {r['ts']} · {r['modality']} · {r['frames']} frames: {r['detail'][:300]}")
            lines.append("")
    rs = [r for r in rows if r["status"] == "SKIP"]
    if rs:
        lines += [f"## SKIP ({len(rs)}): motivos", ""]
        reasons = Counter(re.sub(r"\d+", "N", r["detail"].split(": ", 1)[-1][:90]) for r in rs)
        for reason, n in reasons.most_common():
            lines.append(f"- {n} × {reason}")
        lines += ["", "<details><summary>Lista completa</summary>", ""]
        for r in rs:
            lines.append(f"- `{r['rel']}` · {r['ts']} · {r['modality']}: {r['detail'][:200]}")
        lines += ["", "</details>", ""]
    for st in ("BIG", "TILES"):
        rs = [r for r in rows if r["status"] == st]
        if rs:
            lines += [f"## {st} ({len(rs)})", ""] + [f"- `{r['rel']}` · {r['mb']} MB · {r['ts']} · {r['frames']} frames" for r in rs] + [""]
    sniffed = [r for r in rows if r.get("decodedBy")]
    if sniffed:
        lines += [f"## Reconocidos por el contenido (TS privada o desconocida) ({len(sniffed)})", ""] + \
                 [f"- `{r['rel']}` · {r['ts']} → {r['decodedBy']} · {r['status']}" for r in sniffed] + [""]
    slow = sorted([r for r in rows if r.get("ms")], key=lambda r: -r["ms"])[:15]
    if slow:
        lines += ["## Los 15 más lentos en el harness (decodificación de todos los frames en Node)", ""] + \
                 [f"- {round(r['ms'] / 1000, 1)} s · `{r['rel']}` · {r['mb']} MB · {r['frames']} frames · {r['ts']}" for r in slow] + [""]
    open(os.path.join(out, "report.md"), "w", encoding="utf-8").write("\n".join(lines))
    print("\n".join(lines[:3]))
    print(f"informe: {os.path.join(out, 'report.md')}")


if __name__ == "__main__":
    main()
