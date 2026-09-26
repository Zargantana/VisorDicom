#!/usr/bin/env python3
"""
Pasa un corpus inventariado (scan_corpus.py) por el harness del visor y por la comparación con pydicom, y escribe el
informe. Relanza el harness si un fichero tumba el proceso de Node (memoria): ese fichero queda como CRASH y se sigue.

    python tools/dicom-test/real/run_corpus.py [--out tools/dicom-test/out_corpus] [--filter regex] [--fresh]
        [--max-mb 480] [--frames-out 3] [--windows 2] [--heap-mb 8192]
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "..", "out_corpus"))
    ap.add_argument("--filter", default="")
    ap.add_argument("--fresh", action="store_true", help="empieza de cero (borra render.json)")
    ap.add_argument("--max-mb", default="480")
    ap.add_argument("--frames-out", default="3")
    ap.add_argument("--windows", default="2")
    ap.add_argument("--heap-mb", default="8192")
    ap.add_argument("--skip-multiframe", default="", help="'frames,MB': multiframes con más de ambos (láminas por tiles) se marcan fuera del alcance sin decodificar")
    ap.add_argument("--skip-sm-frames", default="", help="microscopía (SM) con más de N frames: fuera del alcance (tiles J2K de segundos cada uno)")
    ap.add_argument("--max-restarts", type=int, default=40)
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    render = os.path.join(out, "render")
    os.makedirs(render, exist_ok=True)
    summary_path = os.path.join(render, "render.json")
    if args.fresh and os.path.exists(summary_path):
        os.remove(summary_path)

    env = dict(os.environ, DICOM_TEST_OUT=out, DICOM_TEST_MANIFEST=os.path.join(out, "manifest.json"),
               DICOM_TEST_MAX_MB=args.max_mb, DICOM_TEST_MAX_FRAMES_OUT=args.frames_out,
               DICOM_TEST_MAX_WINDOWS=args.windows, DICOM_TEST_RESUME="1", DICOM_TEST_VERBOSE="1")
    if args.filter:
        env["DICOM_TEST_FILTER"] = args.filter
    if args.skip_multiframe:
        env["DICOM_TEST_SKIP_MULTIFRAME"] = args.skip_multiframe
    if args.skip_sm_frames:
        env["DICOM_TEST_SKIP_SM_FRAMES"] = args.skip_sm_frames
    harness = [ "node", f"--max-old-space-size={args.heap_mb}", os.path.join(ROOT, "tools", "dicom-test", "run_harness.mjs")]
    log = open(os.path.join(out, "harness.log"), "a", encoding="utf-8", errors="replace")
    for attempt in range(args.max_restarts + 1):
        print(f"harness (intento {attempt + 1})…", flush=True)
        r = subprocess.run(harness, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        if r.returncode == 0:
            break
        inprog = os.path.join(render, "inprogress.txt")
        key = open(inprog, encoding="utf-8").read().strip() if os.path.exists(inprog) else ""
        print(f"  el harness terminó con código {r.returncode} procesando {key or '?'}: se anota como CRASH y se sigue", flush=True)
        if not key:
            break
        summary = json.load(open(summary_path, encoding="utf-8")) if os.path.exists(summary_path) else {}
        summary[key] = {"decodedFrames": 0, "windows": 0, "error": f"CRASH: el proceso de Node terminó con código {r.returncode} (memoria)"}
        json.dump(summary, open(summary_path, "w", encoding="utf-8"), indent=1)
        os.remove(inprog)
    log.close()

    print("check_render…", flush=True)
    with open(os.path.join(out, "check.log"), "w", encoding="utf-8", errors="replace") as chk:
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "dicom-test", "check_render.py")], cwd=ROOT, env=env, stdout=chk, stderr=subprocess.STDOUT)
    print("informe…", flush=True)
    subprocess.run([sys.executable, os.path.join(HERE, "report_corpus.py"), "--out", out], cwd=ROOT)


if __name__ == "__main__":
    main()
