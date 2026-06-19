#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Branislav Hyll. See LICENSE and THIRD_PARTY_NOTICES.md.
"""
Scan Vectorizer
===============
Turn a scanned PDF (a flat raster image, e.g. from a wide-format scanner) into
clean, resolution-independent vector files:

    * vectorized PDF   (scalable, prints sharp at any size)
    * SVG              (editable in Illustrator / Inkscape)
    * DXF              (opens in AutoCAD / any CAD; simplified, scaled to mm)
    * optional: a searchable PDF + a .txt dump, via OCR (any Tesseract language)
    * optional: an extra 90-degree OCR pass to also catch vertical labels

This is a WRAPPER, not a new engine: the real work is done by separate programs
driven as child processes -- Poppler (pdftoppm) renders, potrace + mkbitmap do the
raster->vector tracing, and Tesseract does the OCR. This module is the glue: a
GUI/CLI, grain de-noising, mm-scaled and bold-lined DXF, the vertical-label pass,
the searchable-PDF text layer, and the one-file build. Those tools carry their own
licenses (see THIRD_PARTY_NOTICES.md); this code is MIT.

It runs fully offline.

Run with NO arguments to open a simple window (pick a file, tick formats, Convert).
Run with a file path for the command line. See --help and --check.

Dependencies
------------
External programs (must be on PATH):
    pdftoppm   -> from Poppler            (Win: `choco install poppler` / `scoop install poppler`;
                                            mac: `brew install poppler`;
                                            Linux: `apt install poppler-utils`)
    potrace    -> potrace                 (Win: `choco install potrace` or potrace.sourceforge.net;
                                            mac: `brew install potrace`;
                                            Linux: `apt install potrace`)
    tesseract  -> Tesseract OCR (only if you use --ocr)
                                          (Win: UB-Mannheim installer, tick "Slovak";
                                            mac: `brew install tesseract tesseract-lang`;
                                            Linux: `apt install tesseract-ocr tesseract-ocr-slk`)

Python packages:
    pip install ezdxf pypdf numpy
"""

import argparse, glob, math, os, shutil, subprocess, sys, tempfile, threading, queue
from pathlib import Path

# A --windowed PyInstaller exe has no console, so sys.stdout / sys.stderr are None
# and a stray print() would crash. Redirect them to a log file in the per-user data
# folder (%LOCALAPPDATA%\ScanVectorizer -- writable, and NOT inside the install dir
# so an uninstall stays clean), falling back to TEMP, then to the null device.
if sys.stdout is None or sys.stderr is None:
    _logf = None
    if getattr(sys, "frozen", False):
        _logdirs = []
        if os.environ.get("LOCALAPPDATA"):
            _logdirs.append(os.path.join(os.environ["LOCALAPPDATA"], "ScanVectorizer"))
        _logdirs.append(tempfile.gettempdir())
        for _d in _logdirs:
            try:
                os.makedirs(_d, exist_ok=True)
                _logf = open(os.path.join(_d, "ScanVectorizer.log"), "w", encoding="utf-8", buffering=1)
                break
            except Exception:
                _logf = None
    if _logf is None:
        _logf = open(os.devnull, "w")
    if sys.stdout is None:
        sys.stdout = _logf
    if sys.stderr is None:
        sys.stderr = _logf

# --------------------------------------------------------------------------- #
#  Dependency handling
# --------------------------------------------------------------------------- #
EXT_TOOLS = {
    "pdftoppm": "Poppler  (poppler-utils)",
    "potrace":  "potrace",
}
OCR_TOOLS = {
    "tesseract": "Tesseract OCR (+ language data, e.g. Slovak 'slk')",
}
PY_LIBS = ("ezdxf", "pypdf", "numpy")

# Quality presets -- the capture-vs-size/smoothness trade-off in one knob.
# "detail" keeps thin faint lines (no de-noising, high dpi, low threshold, hairlines);
# "compact" favours small files (de-noise + lower dpi + aggressive thinning).
PRESETS = {
    "detail":   {"dpi": 500, "denoise": 0.0, "threshold": 0.45, "alphamax": 1.0, "simplify": 0.3, "turd": 1, "line_width": 0.0},
    "balanced": {"dpi": 350, "denoise": 0.4, "threshold": 0.50, "alphamax": 1.2, "simplify": 0.6, "turd": 2, "line_width": 0.2},
    "compact":  {"dpi": 250, "denoise": 1.2, "threshold": 0.50, "alphamax": 1.2, "simplify": 1.5, "turd": 6, "line_width": 0.3},
}


# Hide the console windows that bundled child tools would otherwise flash when
# this runs as a --windowed PyInstaller exe.
_NO_WINDOW = 0x08000000 if os.name == "nt" else 0   # CREATE_NO_WINDOW


_TOOLS_ROOT = None


def _tools_root():
    """Folder holding the external tools (poppler / potrace / tesseract).

    From source: the 'tools' folder next to this script.
    Frozen (PyInstaller): the tools are shipped as 'tools.zip' inside the exe and
    extracted ONCE to a per-user cache. This is deliberate -- if the tool DLLs are
    bundled loose, PyInstaller flattens them into the onefile temp (_MEIPASS) root
    and the child tools then crash (access violation). Running them from a clean
    cache folder avoids that and makes every launch after the first fast.
    Re-extracted only when the bundled zip changes."""
    global _TOOLS_ROOT
    if _TOOLS_ROOT:
        return _TOOLS_ROOT
    if getattr(sys, "frozen", False):
        zip_path = os.path.join(getattr(sys, "_MEIPASS", ""), "tools.zip")
        if os.path.isfile(zip_path):
            import zipfile
            base = os.path.join(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir(),
                                "ScanVectorizer")
            dest = os.path.join(base, "tools")
            stamp = os.path.join(base, "tools.stamp")
            tag = str(os.path.getsize(zip_path))
            try:
                fresh = (os.path.isdir(dest) and os.path.isfile(stamp)
                         and open(stamp, encoding="utf-8").read().strip() == tag)
            except Exception:
                fresh = False
            if not fresh:
                shutil.rmtree(dest, ignore_errors=True)
                os.makedirs(base, exist_ok=True)
                with zipfile.ZipFile(zip_path) as z:
                    z.extractall(dest)
                with open(stamp, "w", encoding="utf-8") as f:
                    f.write(tag)
            _TOOLS_ROOT = dest
            return dest
        for b in (os.path.dirname(sys.executable), getattr(sys, "_MEIPASS", "")):
            if b and os.path.isdir(os.path.join(b, "tools")):
                _TOOLS_ROOT = os.path.join(b, "tools")
                return _TOOLS_ROOT
    _TOOLS_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools")
    return _TOOLS_ROOT


def _bundled_tool(name):
    """Absolute path to a tool inside the bundled tools folder, or None."""
    rel = {
        "pdftoppm":  os.path.join("poppler", "bin", "pdftoppm.exe"),
        "potrace":   os.path.join("potrace", "potrace.exe"),
        "mkbitmap":  os.path.join("potrace", "mkbitmap.exe"),
        "tesseract": os.path.join("tesseract", "tesseract.exe"),
    }.get(name)
    if not rel:
        return None
    p = os.path.join(_tools_root(), rel)
    return p if os.path.isfile(p) else None


def _bundled_tessdata():
    """Path to the bundled Tesseract tessdata folder, or None."""
    td = os.path.join(_tools_root(), "tesseract", "tessdata")
    return td if os.path.isdir(td) else None


def resolve_tool(name):
    """Find a tool: prefer the bundled copy, then fall back to PATH."""
    return _bundled_tool(name) or shutil.which(name)


def have(name):
    return resolve_tool(name)


def list_ocr_langs():
    """Return the list of OCR language codes Tesseract has installed (e.g.
    ['eng', 'slk', ...]). Returns [] if Tesseract is missing or can't be queried."""
    t = resolve_tool("tesseract")
    if not t:
        return []
    cmd = [t, "--list-langs"]
    td = _bundled_tessdata()
    if td:
        cmd = [t, "--tessdata-dir", td, "--list-langs"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           stdin=subprocess.DEVNULL, creationflags=_NO_WINDOW)
    except Exception:
        return []
    out = r.stdout or r.stderr or ""
    langs = []
    for line in out.splitlines():
        s = line.strip()
        # the first line is a header ("List of available languages..."); skip it,
        # skip the orientation/script model, and skip anything with spaces.
        if not s or " " in s or s.lower() == "osd":
            continue
        langs.append(s)
    return langs


def check_deps(need_ocr=False, log=print):
    """Return list of (name, hint) for everything that is missing."""
    missing = []
    tools = dict(EXT_TOOLS)
    if need_ocr:
        tools.update(OCR_TOOLS)
    for t, hint in tools.items():
        p = have(t)
        log(f"  [{'ok ' if p else 'MISS'}] {t:10s} {p or '-- install: ' + hint}")
        if not p:
            missing.append((t, hint))
    # mkbitmap is optional: present -> high-quality preprocessing; absent -> plain -mono
    mk = resolve_tool("mkbitmap")
    log(f"  [{'ok ' if mk else 'opt '}] {'mkbitmap':10s} "
        f"{mk or '(optional: cleaner tracing; ships with potrace)'}")
    for mod in PY_LIBS:
        try:
            __import__(mod)
            log(f"  [ok ] python:{mod}")
        except Exception:
            log(f"  [MISS] python:{mod}  -- pip install {mod}")
            missing.append((mod, f"pip install {mod}"))
    return missing


# --------------------------------------------------------------------------- #
#  Core helpers
# --------------------------------------------------------------------------- #
def _run(cmd, log):
    log("      $ " + " ".join((os.path.basename(c) if i == 0 else c) for i, c in enumerate(cmd)))
    r = subprocess.run(cmd, capture_output=True, text=True,
                       stdin=subprocess.DEVNULL, creationflags=_NO_WINDOW)
    if r.returncode != 0:
        raise RuntimeError(f"{os.path.basename(cmd[0])} failed (exit {r.returncode}): "
                           f"{(r.stderr or r.stdout).strip()[:400] or '(no output)'}")
    return r


def ensure_writable(path, log=print):
    """Return a path we can actually write. If the target exists and is locked
    (e.g. the previous output is still open in a viewer), fall back to
    name_2.ext, name_3.ext, ... instead of crashing with PermissionError."""
    p = Path(path)
    cand, i = p, 2
    while True:
        try:
            if cand.exists():
                with open(cand, "ab"):
                    pass
            if cand != p:
                log(f"      (note: {p.name} was open/locked -> writing {cand.name} instead)")
            return str(cand)
        except PermissionError:
            cand = p.with_name(f"{p.stem}_{i}{p.suffix}")
            i += 1
            if i > 50:
                raise


def render(pdf, page, dpi, mode, tmp, log):
    """Render one PDF page to a bitmap. mode='mono' -> .pbm, mode='gray' -> .png"""
    pre = os.path.join(tmp, f"{mode}_{page}")
    flag = "-mono" if mode == "mono" else "-png"
    extra = [] if mode == "mono" else ["-gray"]
    pdftoppm = resolve_tool("pdftoppm") or "pdftoppm"
    _run([pdftoppm, flag, *extra, "-r", str(dpi), "-f", str(page), "-l", str(page), pdf, pre], log)
    ext = "pbm" if mode == "mono" else "png"
    files = glob.glob(pre + f"*.{ext}")
    if not files:
        raise RuntimeError("pdftoppm produced no image (is the PDF valid?)")
    return files[0]


def render_rotated(pdf, page, dpi, tmp, log):
    """Render one PDF page turned 90 degrees clockwise to a gray PNG, so that
    text that runs vertically on the sheet becomes horizontal for OCR.

    We add 90 to the page's /Rotate in a one-page temp PDF; pdftoppm honours
    /Rotate, so the rendered bitmap is already rotated. Output goes into its own
    sub-folder so its 'gray_1' name never collides with the upright render."""
    from pypdf import PdfReader, PdfWriter
    sub = os.path.join(tmp, f"rotpass_{page}")
    os.makedirs(sub, exist_ok=True)
    reader = PdfReader(pdf)
    pg = reader.pages[page - 1]
    pg.rotate(90)                       # cumulative, clockwise (PDF /Rotate)
    writer = PdfWriter()
    writer.add_page(pg)
    rot_pdf = os.path.join(sub, "rotated.pdf")
    with open(rot_pdf, "wb") as f:
        writer.write(f)
    return render(rot_pdf, 1, dpi, "gray", sub, log)


def render_gray_pnm(pdf, page, dpi, tmp, log):
    """Render one page to a grayscale PGM (pdftoppm -gray, no -png) -- the format
    mkbitmap consumes for preprocessing."""
    pre = os.path.join(tmp, f"graypnm_{page}")
    pdftoppm = resolve_tool("pdftoppm") or "pdftoppm"
    _run([pdftoppm, "-gray", "-r", str(dpi), "-f", str(page), "-l", str(page), pdf, pre], log)
    files = glob.glob(pre + "*.pgm")
    if not files:
        raise RuntimeError("pdftoppm produced no PGM (is the PDF valid?)")
    return files[0]


def _close_gaps(pbm, log, radius=1):
    """Morphological close (dilate then erode the black strokes) to bridge small
    breaks. Uses Pillow; silently skips if Pillow is unavailable."""
    try:
        from PIL import Image, ImageFilter
    except Exception:
        log("      (bridge-gaps skipped: Pillow not available)")
        return
    sz = 2 * radius + 1
    im = Image.open(pbm).convert("L")
    im = im.filter(ImageFilter.MinFilter(sz))    # grow black (dilate)
    im = im.filter(ImageFilter.MaxFilter(sz))    # shrink back (erode) -> close
    im.point(lambda v: 0 if v < 128 else 255).convert("1").save(pbm)


def _denoise_pgm(pgm, radius, log):
    """Gaussian-blur the grayscale render to wash out scan grain BEFORE
    thresholding. Grain (halftone/photocopy texture) on stroke edges is what
    potrace otherwise traces as jagged serrations + thousands of extra vertices,
    so a mild blur makes lines smoother AND the output much smaller. Pillow only;
    returns the original path if Pillow is missing or radius<=0."""
    if not radius or radius <= 0:
        return pgm
    try:
        from PIL import Image, ImageFilter
    except Exception:
        log("      (denoise skipped: Pillow not available)")
        return pgm
    out = pgm[:-4] + "_dn.pgm"
    Image.open(pgm).convert("L").filter(ImageFilter.GaussianBlur(radius)).save(out)
    return out


def prep_bitmap(pdf, page, dpi, tmp, log, threshold=0.5, filt=0, scale=1, connect=False, denoise=1.0):
    """Produce a clean bilevel PBM for potrace plus the effective DPI.

    Renders grayscale, optionally denoises (Gaussian blur to remove scan grain --
    big win for smoothness and file size), then thresholds with mkbitmap (smooth
    solid strokes, no speckled edges like pdftoppm -mono), with optional upscaling.
    `filt`>0 enables a high-pass filter for uneven/blotchy backgrounds (off by
    default: it can hollow thick strokes on clean scans). Falls back to
    pdftoppm -mono if mkbitmap is missing."""
    mk = resolve_tool("mkbitmap")
    if not mk:
        return render(pdf, page, dpi, "mono", tmp, log), dpi
    pgm = render_gray_pnm(pdf, page, dpi, tmp, log)
    pgm = _denoise_pgm(pgm, denoise, log)
    pbm = os.path.join(tmp, f"clean_{page}.pbm")
    cmd = [mk]
    cmd += (["-f", str(filt)] if filt and filt > 0 else ["-n"])   # -n = no high-pass
    cmd += ["-s", str(scale), "-t", str(threshold), "-o", pbm, pgm]
    _run(cmd, log)
    if connect:
        _close_gaps(pbm, log)
    return pbm, dpi * scale


def trace(bitmap, out_path, backend, dpi, turd, log, alphamax=1.2, opttol=0.2):
    """Vectorize a bilevel bitmap with potrace. backend in {svg,pdf,dxf}.
    alphamax controls corner smoothing, opttol the curve optimisation."""
    potrace = resolve_tool("potrace") or "potrace"
    _run([potrace, "-b", backend, "-r", str(dpi), "-t", str(turd),
          "-a", str(alphamax), "-O", str(opttol), "-o", out_path, bitmap], log)
    return out_path


def _dp(points, eps):
    """Iterative Douglas-Peucker polyline simplification (numpy-accelerated)."""
    import numpy as np
    n = len(points)
    if n < 3:
        return points
    P = np.asarray(points, float)
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        s, e = stack.pop()
        if e <= s + 1:
            continue
        x1, y1 = P[s]; x2, y2 = P[e]
        dx, dy = x2 - x1, y2 - y1
        seg = P[s + 1:e]
        d2 = dx * dx + dy * dy
        if d2 == 0:
            dist = np.hypot(seg[:, 0] - x1, seg[:, 1] - y1)
        else:
            dist = np.abs(dy * seg[:, 0] - dx * seg[:, 1] + x2 * y1 - y2 * x1) / math.sqrt(d2)
        k = int(dist.argmax())
        if dist[k] > eps:
            idx = s + 1 + k
            keep[idx] = True
            stack.append((s, idx)); stack.append((idx, e))
    return [tuple(P[i]) for i in range(n) if keep[i]]


def simplify_dxf(raw_path, out_path, dpi, eps_px, log, line_width=0.3):
    """Read potrace's raw (pixel-unit) DXF, simplify, rescale px->mm, write R2000.

    potrace emits zero-width *outline* polylines, which CAD draws as faint
    hairlines. Giving them a real width (`line_width` mm, group code 43) makes the
    lines render bold in CAD and visually fuses each line's two outline edges
    into one solid stroke. Set line_width=0 for plain hairlines."""
    import ezdxf
    from ezdxf import units as U
    src = ezdxf.readfile(raw_path)
    msp = src.modelspace()
    out = ezdxf.new(dxfversion="R2000")
    out.units = U.MM
    out.header["$INSUNITS"] = 4      # millimetres
    out.header["$MEASUREMENT"] = 1   # metric
    try:
        out.layers.add("TRACE", color=7)
    except Exception:
        out.layers.new("TRACE", dxfattribs={"color": 7})
    omsp = out.modelspace()
    attribs = {"layer": "TRACE"}
    if line_width and line_width > 0:
        attribs["const_width"] = float(line_width)
    scale = 25.4 / dpi               # pixels @ dpi  ->  millimetres of the sheet
    n_in = n_out = n_ent = 0
    for e in msp:
        t = e.dxftype()
        if t == "POLYLINE":
            pts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
            closed = bool(e.is_closed)
        elif t == "LWPOLYLINE":
            pts = [(p[0], p[1]) for p in e.get_points("xy")]
            closed = bool(e.closed)
        else:
            continue
        if len(pts) < 2:
            continue
        n_in += len(pts)
        s = _dp(pts, eps_px)
        if len(s) < 2:
            continue
        s = [(x * scale, y * scale) for x, y in s]
        omsp.add_lwpolyline(s, close=closed, dxfattribs=attribs)
        n_out += len(s); n_ent += 1
    out.saveas(out_path)
    pct = (100.0 * n_out / n_in) if n_in else 0
    log(f"      DXF: {n_ent} polylines, {n_in}->{n_out} vertices ({pct:.0f}%), units = mm")


def ocr_page(png, dpi, lang, psm, log):
    """OCR a page image -> (text_only_pdf_path, txt_path). Uses Tesseract's
    glyphless text-only PDF (handles any Unicode, incl. Slovak diacritics).
    Outputs are written next to the input image, so the upright and rotated
    passes (which live in different temp sub-folders) never collide."""
    base = os.path.join(os.path.dirname(png), "ocr_" + Path(png).stem)
    tesseract = resolve_tool("tesseract") or "tesseract"
    cmd = [tesseract, png, base, "-l", lang, "--psm", str(psm), "--dpi", str(dpi)]
    td = _bundled_tessdata()
    if td:
        cmd += ["--tessdata-dir", td]
    cmd += ["-c", "textonly_pdf=1", "pdf", "txt"]
    _run(cmd, log)
    return base + ".pdf", base + ".txt"


def build_searchable_page(vector_pdf_path, up_text_pdf, rot_text_pdf=None):
    """Overlay invisible OCR text onto the vector page and return the merged page.

    The upright text layer is scaled to the vector page. If a rotated (90 deg CW)
    text layer is supplied, it is mapped back onto the upright page so vertical
    labels become selectable in place.

    Geometry: rendering the page 90 deg CW sends an upright point (x, y) to
    (x', y') = (y, W - x). Inverting, with the rotated text page sized (rw, rh)
    standing for (H, W), gives  x = bw - y'*bw/rh ,  y = x'*bh/rw , i.e. the
    affine ctm = (0, bh/rw, -(bw/rh), 0, bw, 0)."""
    from pypdf import PdfReader, Transformation
    vp = PdfReader(vector_pdf_path).pages[0]
    bw, bh = float(vp.mediabox.width), float(vp.mediabox.height)

    up = PdfReader(up_text_pdf).pages[0]
    tw, th = float(up.mediabox.width), float(up.mediabox.height)
    if tw and th and (abs(bw - tw) > 0.5 or abs(bh - th) > 0.5):
        up.add_transformation(Transformation().scale(bw / tw, bh / th))
    vp.merge_page(up)

    if rot_text_pdf:
        rp = PdfReader(rot_text_pdf).pages[0]
        rw, rh = float(rp.mediabox.width), float(rp.mediabox.height)
        if rw and rh:
            rp.add_transformation(Transformation((0.0, bh / rw, -(bw / rh), 0.0, bw, 0.0)))
            vp.merge_page(rp)
    return vp


# --------------------------------------------------------------------------- #
#  Pipeline
# --------------------------------------------------------------------------- #
def process_pdf(pdf, outdir, formats, do_ocr=False, ocr_rotated=False, dpi=300, ocr_dpi=400,
                lang="slk+eng", psm=11, eps_px=0.6, turd=2,
                threshold=0.5, filt=0, upscale=1, alphamax=1.2, opttol=0.2, connect=False,
                denoise=0.4, line_width=0.2, log=print):
    from pypdf import PdfReader, PdfWriter
    pdf = str(pdf)
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    stem = Path(pdf).stem
    npages = len(PdfReader(pdf).pages)
    multi = npages > 1
    want = {f: (f in formats) for f in ("pdf", "svg", "dxf")}
    need_vecpdf = want["pdf"] or do_ocr
    produced = []

    log(f"Input : {pdf}")
    log(f"Pages : {npages}   Trace DPI: {dpi}   Formats: {','.join(f for f in want if want[f]) or '(none)'}"
        + (f"   OCR: {lang} @ {ocr_dpi}dpi" if do_ocr else "")
        + ("  + vertical (90 deg) pass" if (do_ocr and ocr_rotated) else ""))

    with tempfile.TemporaryDirectory() as tmp:
        pages = []
        for p in range(1, npages + 1):
            log(f"  Page {p}/{npages}: rendering + cleaning (mkbitmap) + tracing ...")
            clean, eff_dpi = prep_bitmap(pdf, p, dpi, tmp, log, threshold, filt, upscale, connect, denoise)
            info = {}

            if want["svg"]:
                svg_out = ensure_writable(
                    outdir / (f"{stem}_vectorized_p{p}.svg" if multi else f"{stem}_vectorized.svg"), log)
                trace(clean, svg_out, "svg", eff_dpi, turd, log, alphamax, opttol)
                produced.append(Path(svg_out)); log(f"      -> {Path(svg_out).name}")

            if want["dxf"]:
                raw = os.path.join(tmp, f"raw_{p}.dxf")
                trace(clean, raw, "dxf", eff_dpi, turd, log, alphamax, opttol)
                dxf_out = ensure_writable(
                    outdir / (f"{stem}_vectorized_p{p}.dxf" if multi else f"{stem}_vectorized.dxf"), log)
                simplify_dxf(raw, dxf_out, eff_dpi, eps_px, log, line_width)
                produced.append(Path(dxf_out)); log(f"      -> {Path(dxf_out).name}")

            if need_vecpdf:
                vp = os.path.join(tmp, f"vec_{p}.pdf")
                trace(clean, vp, "pdf", eff_dpi, turd, log, alphamax, opttol)
                info["vec"] = vp

            if do_ocr:
                log(f"  Page {p}/{npages}: OCR ({lang}) ...")
                png = render(pdf, p, ocr_dpi, "gray", tmp, log)
                tpdf, ttxt = ocr_page(png, ocr_dpi, lang, psm, log)
                info["text_pdf"] = tpdf
                info["txt"] = open(ttxt, encoding="utf-8", errors="replace").read()

                if ocr_rotated:
                    log(f"  Page {p}/{npages}: OCR vertical (90 deg, {lang}) ...")
                    rpng = render_rotated(pdf, p, ocr_dpi, tmp, log)
                    rtpdf, rttxt = ocr_page(rpng, ocr_dpi, lang, psm, log)
                    info["rot_text_pdf"] = rtpdf
                    info["rot_txt"] = open(rttxt, encoding="utf-8", errors="replace").read()

            pages.append(info)

        if want["pdf"]:
            w = PdfWriter()
            for info in pages:
                w.append(info["vec"])
            pdf_out = ensure_writable(outdir / f"{stem}_vectorized.pdf", log)
            with open(pdf_out, "wb") as f:
                w.write(f)
            produced.append(Path(pdf_out)); log(f"  -> {Path(pdf_out).name}")

        if do_ocr:
            w = PdfWriter()
            for info in pages:
                w.add_page(build_searchable_page(info["vec"], info["text_pdf"],
                                                 info.get("rot_text_pdf")))
            sp_out = ensure_writable(outdir / f"{stem}_vectorized_searchable.pdf", log)
            with open(sp_out, "wb") as f:
                w.write(f)
            produced.append(Path(sp_out)); log(f"  -> {Path(sp_out).name}")

            txt_out = ensure_writable(outdir / f"{stem}_ocr_text.txt", log)
            with open(txt_out, "w", encoding="utf-8") as f:
                for i, info in enumerate(pages, 1):
                    if multi:
                        f.write(f"\n----- Page {i} -----\n")
                    f.write(info.get("txt", "") or "")
                    if info.get("rot_txt"):
                        f.write("\n---- vertical / 90 deg text ----\n")
                        f.write(info["rot_txt"])
            produced.append(Path(txt_out)); log(f"  -> {Path(txt_out).name}")

    return [str(p) for p in produced]


# --------------------------------------------------------------------------- #
#  GUI  (tkinter — ships with standard Python on Windows/macOS/most Linux)
# --------------------------------------------------------------------------- #
def launch_gui():
    try:
        import tkinter as tk
        from tkinter import ttk, filedialog, messagebox, scrolledtext
    except Exception as e:
        print("Tkinter is not available:", e)
        print("Use the command line instead, e.g.:\n  python scan_vectorizer.py myscan.pdf --ocr")
        return

    root = tk.Tk()
    root.title("Scan Vectorizer")
    root.geometry("860x600")
    pad = {"padx": 8, "pady": 4}
    st = {"input": None, "busy": False, "q": queue.Queue()}

    # ---- input file ----
    frm_in = ttk.LabelFrame(root, text="1. Input PDF (a scan)")
    frm_in.pack(fill="x", **pad)
    lbl_in = ttk.Label(frm_in, text="No file selected", width=70)
    lbl_in.pack(side="left", **pad)

    def pick_input():
        f = filedialog.askopenfilename(title="Choose a scanned PDF",
                                       filetypes=[("PDF files", "*.pdf *.PDF"), ("All files", "*.*")])
        if f:
            st["input"] = f
            lbl_in.config(text=f)
            if not out_var.get():
                out_var.set(str(Path(f).resolve().parent))
    ttk.Button(frm_in, text="Browse...", command=pick_input).pack(side="right", **pad)

    # ---- options ----
    frm_opt = ttk.LabelFrame(root, text="2. Output formats & options")
    frm_opt.pack(fill="x", **pad)
    pdf_v = tk.BooleanVar(value=True)
    svg_v = tk.BooleanVar(value=True)
    dxf_v = tk.BooleanVar(value=True)
    ocr_v = tk.BooleanVar(value=False)
    ttk.Checkbutton(frm_opt, text="PDF (vector)", variable=pdf_v).grid(row=0, column=0, sticky="w", **pad)
    ttk.Checkbutton(frm_opt, text="SVG", variable=svg_v).grid(row=0, column=1, sticky="w", **pad)
    ttk.Checkbutton(frm_opt, text="DXF (CAD, mm)", variable=dxf_v).grid(row=0, column=2, sticky="w", **pad)
    ttk.Checkbutton(frm_opt, text="OCR -> searchable PDF + text", variable=ocr_v).grid(row=0, column=3, columnspan=2, sticky="w", **pad)

    ttk.Label(frm_opt, text="Trace DPI:").grid(row=1, column=0, sticky="e", **pad)
    dpi_v = tk.IntVar(value=300)
    ttk.Spinbox(frm_opt, from_=150, to=600, increment=50, width=6, textvariable=dpi_v).grid(row=1, column=1, sticky="w", **pad)
    ttk.Label(frm_opt, text="OCR DPI:").grid(row=1, column=2, sticky="e", **pad)
    ocrdpi_v = tk.IntVar(value=400)
    ttk.Spinbox(frm_opt, from_=200, to=600, increment=50, width=6, textvariable=ocrdpi_v).grid(row=1, column=3, sticky="w", **pad)
    ttk.Label(frm_opt, text="OCR language(s):").grid(row=2, column=0, sticky="e", **pad)
    lang_v = tk.StringVar(value="slk+eng")
    lang_values = ["slk+eng", "slk", "eng", "ces+eng", "deu+eng"]
    for code in list_ocr_langs():            # add whatever Tesseract actually has
        if code not in lang_values:
            lang_values.append(code)
    lang_cb = ttk.Combobox(frm_opt, textvariable=lang_v, width=12, values=lang_values)
    lang_cb.grid(row=2, column=1, sticky="w", **pad)

    vert_v = tk.BooleanVar(value=False)
    ttk.Checkbutton(frm_opt, text="Also catch vertical labels (90 deg OCR pass)",
                    variable=vert_v).grid(row=2, column=2, columnspan=3, sticky="w", **pad)

    # ---- line quality (preset + fine controls) ----
    frm_q = ttk.LabelFrame(root, text="2b. Line quality")
    frm_q.pack(fill="x", **pad)
    thr_v = tk.DoubleVar(value=0.5)
    smooth_v = tk.DoubleVar(value=1.2)
    turd_v = tk.IntVar(value=2)
    denoise_v = tk.DoubleVar(value=0.4)
    lw_v = tk.DoubleVar(value=0.2)
    simplify_v = tk.DoubleVar(value=0.6)
    upscale_v = tk.BooleanVar(value=False)
    connect_v = tk.BooleanVar(value=False)
    preset_v = tk.StringVar(value="Balanced")
    _PRESET_MAP = {"Detail (max)": "detail", "Balanced": "balanced", "Compact (small)": "compact"}

    def apply_preset(*_):
        p = PRESETS[_PRESET_MAP.get(preset_v.get(), "balanced")]
        dpi_v.set(p["dpi"]); denoise_v.set(p["denoise"]); thr_v.set(p["threshold"])
        smooth_v.set(p["alphamax"]); turd_v.set(p["turd"]); lw_v.set(p["line_width"])
        simplify_v.set(p["simplify"])

    ttk.Label(frm_q, text="Detail level:").grid(row=0, column=0, sticky="e", **pad)
    cb_preset = ttk.Combobox(frm_q, textvariable=preset_v, values=list(_PRESET_MAP), state="readonly", width=14)
    cb_preset.grid(row=0, column=1, columnspan=2, sticky="w", **pad)
    cb_preset.bind("<<ComboboxSelected>>", apply_preset)
    ttk.Label(frm_q, text="Detail = keep thin/faint lines (bigger files)").grid(row=0, column=3, columnspan=3, sticky="w", **pad)

    ttk.Label(frm_q, text="Denoise:").grid(row=1, column=0, sticky="e", **pad)
    ttk.Spinbox(frm_q, from_=0.0, to=4.0, increment=0.25, width=6, textvariable=denoise_v).grid(row=1, column=1, sticky="w", **pad)
    ttk.Label(frm_q, text="Despeckle:").grid(row=1, column=2, sticky="e", **pad)
    ttk.Spinbox(frm_q, from_=0, to=20, increment=1, width=6, textvariable=turd_v).grid(row=1, column=3, sticky="w", **pad)
    ttk.Label(frm_q, text="Smoothing:").grid(row=1, column=4, sticky="e", **pad)
    ttk.Spinbox(frm_q, from_=0.0, to=1.3, increment=0.1, width=6, textvariable=smooth_v).grid(row=1, column=5, sticky="w", **pad)
    ttk.Label(frm_q, text="Threshold:").grid(row=2, column=0, sticky="e", **pad)
    ttk.Spinbox(frm_q, from_=0.1, to=0.9, increment=0.05, width=6, textvariable=thr_v).grid(row=2, column=1, sticky="w", **pad)
    ttk.Label(frm_q, text="CAD line width (mm):").grid(row=2, column=2, columnspan=2, sticky="e", **pad)
    ttk.Spinbox(frm_q, from_=0.0, to=2.0, increment=0.05, width=6, textvariable=lw_v).grid(row=2, column=4, sticky="w", **pad)
    ttk.Checkbutton(frm_q, text="Upscale 2x (smoother, slower)", variable=upscale_v).grid(row=3, column=0, columnspan=3, sticky="w", **pad)
    ttk.Checkbutton(frm_q, text="Bridge small gaps", variable=connect_v).grid(row=3, column=3, columnspan=3, sticky="w", **pad)
    apply_preset()   # seed the controls from the default (Balanced) preset

    # ---- output folder ----
    frm_out = ttk.LabelFrame(root, text="3. Output folder")
    frm_out.pack(fill="x", **pad)
    out_var = tk.StringVar(value="")
    ttk.Entry(frm_out, textvariable=out_var).pack(side="left", fill="x", expand=True, **pad)

    def pick_out():
        d = filedialog.askdirectory(title="Choose output folder")
        if d:
            out_var.set(d)
    ttk.Button(frm_out, text="Browse...", command=pick_out).pack(side="right", **pad)

    # ---- log ----
    log_box = scrolledtext.ScrolledText(root, height=16, font=("Consolas", 9))
    log_box.pack(fill="both", expand=True, **pad)

    def ui_log(msg):
        st["q"].put(str(msg))

    def drain():
        try:
            while True:
                line = st["q"].get_nowait()
                log_box.insert("end", line + "\n")
                log_box.see("end")
        except queue.Empty:
            pass
        root.after(120, drain)

    # ---- run ----
    def worker():
        try:
            do_ocr = ocr_v.get() or vert_v.get()   # ticking "vertical" implies OCR
            fmts = [f for f, v in (("pdf", pdf_v), ("svg", svg_v), ("dxf", dxf_v)) if v.get()]
            if not fmts and not do_ocr:
                ui_log("Nothing to do: pick at least one format or OCR."); return
            miss = check_deps(need_ocr=do_ocr, log=ui_log)
            crit = [t for t, _ in miss]
            if crit:
                ui_log("ERROR: missing dependencies: " + ", ".join(crit))
                ui_log("Install them (see header of this script), then try again.")
                return
            produced = process_pdf(st["input"], out_var.get() or str(Path(st["input"]).parent),
                                   fmts, do_ocr=do_ocr, ocr_rotated=vert_v.get(),
                                   dpi=dpi_v.get(), ocr_dpi=ocrdpi_v.get(),
                                   lang=lang_v.get().strip() or "eng",
                                   threshold=thr_v.get(), alphamax=smooth_v.get(),
                                   turd=turd_v.get(), eps_px=simplify_v.get(),
                                   upscale=(2 if upscale_v.get() else 1),
                                   connect=connect_v.get(), denoise=denoise_v.get(),
                                   line_width=lw_v.get(), log=ui_log)
            ui_log("\nDONE. Created:")
            for f in produced:
                ui_log("   " + f)
        except Exception as e:
            ui_log("\nERROR: " + str(e))
        finally:
            st["busy"] = False
            root.after(0, lambda: btn.config(state="normal", text="Convert"))

    def start():
        if st["busy"]:
            return
        if not st["input"]:
            messagebox.showwarning("No file", "Choose an input PDF first."); return
        log_box.delete("1.0", "end")
        st["busy"] = True
        btn.config(state="disabled", text="Working...")
        threading.Thread(target=worker, daemon=True).start()

    def check_now():
        def w():
            ui_log("\nDependency check:")
            check_deps(need_ocr=True, log=ui_log)
            langs = list_ocr_langs()
            ui_log("Installed OCR languages: " + (", ".join(langs) if langs
                   else "(could not query tesseract)"))
            for need in ("eng", "slk"):
                ui_log(f"  {need}: {'OK' if need in langs else 'MISSING -- install this language'}")
        threading.Thread(target=w, daemon=True).start()

    frm_btn = ttk.Frame(root)
    frm_btn.pack(**pad)
    ttk.Button(frm_btn, text="Check tools & languages", command=check_now).pack(side="left", **pad)
    btn = ttk.Button(frm_btn, text="Convert", command=start)
    btn.pack(side="left", **pad)

    ui_log("Ready. Pick a scanned PDF, choose formats, then Convert.")
    ui_log("Tip: DXF opens in AutoCAD; 'Save As .dwg' there if you need .dwg.")
    _installed = list_ocr_langs()
    if _installed:
        _missing = [l for l in ("eng", "slk") if l not in _installed]
        if _missing:
            ui_log("Note: Tesseract is missing language(s): " + ", ".join(_missing)
                   + " -- install them if you need that OCR language.")
    drain()
    root.mainloop()


# --------------------------------------------------------------------------- #
#  CLI
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(
        description="Vectorize scanned PDFs to PDF/SVG/DXF (+ optional OCR). "
                    "Run with no input to open the GUI.")
    ap.add_argument("input", nargs="?", help="input scanned PDF (omit to open the GUI)")
    ap.add_argument("-o", "--out", help="output folder (default: same folder as the input)")
    ap.add_argument("-f", "--formats", default="pdf,svg,dxf",
                    help="comma list from pdf,svg,dxf (default: all three)")
    ap.add_argument("--ocr", action="store_true",
                    help="also produce a searchable PDF + .txt via OCR")
    ap.add_argument("--vertical", "--ocr-rotated", dest="vertical", action="store_true",
                    help="extra 90-degree OCR pass to also catch vertical labels (implies --ocr)")
    ap.add_argument("--lang", default="slk+eng", help="OCR language(s) (default: slk+eng)")
    ap.add_argument("--ocr-dpi", type=int, default=400, help="OCR render resolution (default: 400)")
    ap.add_argument("--psm", type=int, default=11, help="Tesseract page-seg mode (default: 11 = sparse)")
    # --- trace quality ---
    ap.add_argument("--preset", choices=list(PRESETS), default="balanced",
                    help="quality preset: detail (keeps thin/faint lines, bigger files), "
                         "balanced (default), or compact (smallest)")
    # these override the preset when given (default = whatever the preset sets)
    ap.add_argument("--dpi", type=int, help="trace resolution (preset default; detail=500)")
    ap.add_argument("--denoise", type=float,
                    help="blur radius (px) to remove scan grain; 0 = off (keeps thin lines), "
                         "1.5-2 for grainy scans (preset default)")
    ap.add_argument("--threshold", type=float,
                    help="black/white threshold 0..1 (lower keeps more faint detail)")
    ap.add_argument("--smooth", dest="alphamax", type=float,
                    help="corner smoothing 0..1.3 (lower = sharper)")
    ap.add_argument("--simplify", type=float, help="DXF point-thinning tolerance in px (higher = smaller)")
    ap.add_argument("--turd", type=int, help="despeckle size (drop specks up to N px)")
    ap.add_argument("--line-width", dest="line_width", type=float,
                    help="DXF line width in mm (bold in CAD); 0 = hairline")
    ap.add_argument("--filter", dest="filt", type=int, default=0,
                    help="mkbitmap high-pass strength for UNEVEN scans; 0 = off "
                         "(default: 0; try 20+ for blotchy backgrounds)")
    ap.add_argument("--upscale", type=int, default=1,
                    help="mkbitmap upscale factor for smoother edges (default: 1)")
    ap.add_argument("--connect", action="store_true",
                    help="bridge small gaps in lines (morphological close; needs Pillow)")
    ap.add_argument("--gui", action="store_true", help="force the GUI")
    ap.add_argument("--check", action="store_true", help="check dependencies and exit")
    args = ap.parse_args()

    # fill any preset-controlled flag the user didn't set from the chosen preset
    _p = PRESETS[args.preset]
    for _k in ("dpi", "denoise", "threshold", "alphamax", "simplify", "turd", "line_width"):
        if getattr(args, _k) is None:
            setattr(args, _k, _p[_k])

    if args.check:
        print("Dependency check:")
        miss = check_deps(need_ocr=True)
        langs = list_ocr_langs()
        print("\nInstalled OCR languages:", ", ".join(langs) if langs
              else "(could not query tesseract)")
        for need in ("eng", "slk"):
            ok = need in langs
            print(f"  {need}: {'OK' if ok else 'MISSING -- install this language for it to work'}")
        print("\nAll dependencies present." if not miss
              else "\nMissing: " + ", ".join(t for t, _ in miss))
        return

    if args.vertical:
        args.ocr = True

    if args.gui or not args.input:
        return launch_gui()

    fmts = [x.strip().lower() for x in args.formats.split(",") if x.strip()]
    bad = [f for f in fmts if f not in ("pdf", "svg", "dxf")]
    if bad:
        print("Unknown format(s):", ", ".join(bad)); sys.exit(2)

    miss = check_deps(need_ocr=args.ocr, log=lambda *_: None)
    if miss:
        print("Missing dependencies:", ", ".join(t for t, _ in miss))
        print("Run  python", os.path.basename(__file__), "--check  for install hints.")
        sys.exit(2)

    outdir = args.out or str(Path(args.input).resolve().parent)
    produced = process_pdf(args.input, outdir, fmts, do_ocr=args.ocr,
                           ocr_rotated=args.vertical, dpi=args.dpi,
                           ocr_dpi=args.ocr_dpi, lang=args.lang, psm=args.psm,
                           eps_px=args.simplify, turd=args.turd,
                           threshold=args.threshold, filt=args.filt, upscale=args.upscale,
                           alphamax=args.alphamax, connect=args.connect, denoise=args.denoise,
                           line_width=args.line_width, log=print)
    print("\nDone. Output folder:", outdir)
    for f in produced:
        print("  -", f)


if __name__ == "__main__":
    main()
