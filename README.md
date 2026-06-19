# Scan Vectorizer

Turn a **scanned PDF** (a flat raster image, e.g. from a wide-format / plotter
scanner) into clean, resolution-independent vector files — **fully offline**, on
your own machine.

[![release](https://img.shields.io/github/v/release/TheHyller/scan-vectorizer?label=download)](https://github.com/TheHyller/scan-vectorizer/releases/latest)
![license](https://img.shields.io/badge/license-MIT-blue)
![platform](https://img.shields.io/badge/app-Windows-0078D6)
![python](https://img.shields.io/badge/python-3.9%2B-3776AB)

| Output | What it's for |
|--------|---------------|
| **vectorized PDF** | scalable; prints sharp at any size |
| **SVG** | edit in Illustrator / Inkscape |
| **DXF** | open in AutoCAD / any CAD; simplified, scaled to **millimetres** (save as `.dwg` from your CAD if you need DWG) |
| **searchable PDF + `.txt`** *(optional, OCR)* | search/select the text; any Tesseract language (Slovak `slk` included); optional 90° pass for **vertical labels** |

> **Scan Vectorizer is a wrapper, not a new engine.** The heavy lifting is done by
> **[Poppler](https://poppler.freedesktop.org)** (PDF → image),
> **[potrace](https://potrace.sourceforge.net)** + **mkbitmap** (tracing, by Peter
> Selinger), and **[Tesseract](https://github.com/tesseract-ocr/tesseract)** (OCR).
> This project is the glue: a GUI/CLI, de-noising, mm-scaled bold-lined DXF, a
> vertical-label OCR pass, and a one-file Windows build. See [Credits](#credits).

---

## Contents
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Usage](#usage) · [Options](#options)
- [Build the Windows app](#build-the-windows-app)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits) · [Licensing](#licensing)

---

## How it works

```
pdftoppm (grayscale)  →  denoise (de-grain)  →  mkbitmap (clean threshold)  →  potrace (trace)
   →  Douglas–Peucker simplify + mm rescale + line width  →  DXF / SVG / PDF
   →  Tesseract glyphless text layer  →  searchable PDF + .txt
```

Thresholding the **antialiased grayscale** (instead of a hard 1-bit render) gives
solid, smooth strokes instead of speckled/broken ones, and the DXF lines get a
real width so CAD shows them bold rather than as faint hairlines.

Need a **`.dwg`**? Every CAD app opens the DXF directly — use **File → Save As →
.dwg** there.

---

## Quick start

**⬇️ Download:** grab the latest **installer** (`ScanVectorizer-Setup.exe`) or
**portable** exe from the [**Releases page**](https://github.com/TheHyller/scan-vectorizer/releases/latest)
— self-contained, nothing else to install.

Or **build it yourself** — an installer or a portable exe (both self-contained); see
[Build the Windows app](#build-the-windows-app).

**From source:**

```bash
pip install -r requirements.txt          # ezdxf, pypdf, numpy, pillow
python scan_vectorizer.py                # opens the window
# or drive it from the command line:
python scan_vectorizer.py myscan.pdf
```

From source you also need the external programs on your `PATH` (or staged into a
local `tools\` folder by `get_tools.ps1`). On Windows the easiest path is:

```powershell
.\get_tools.ps1        # downloads Poppler, potrace+mkbitmap, Tesseract (+slk)
```

or install them yourself:

```powershell
choco install poppler tesseract     # potrace + mkbitmap: potrace.sourceforge.net
```
```bash
# macOS:  brew install poppler potrace tesseract tesseract-lang
# Linux:  sudo apt install poppler-utils potrace tesseract-ocr tesseract-ocr-slk
```

Verify everything is found:

```bash
python scan_vectorizer.py --check
```

---

## Usage

### Window (no command line)
```bash
python scan_vectorizer.py
```
Pick a PDF, tick the formats, choose an output folder, click **Convert**. The
window has:
- format checkboxes — **PDF / SVG / DXF / OCR**;
- a **Line quality** panel — a **Detail level** preset (Detail / Balanced /
  Compact) plus fine controls (Denoise, Despeckle, Smoothing, Threshold, CAD line
  width, Upscale 2×, Bridge small gaps);
- an **OCR language** selector (default `slk+eng`; installed languages listed);
- **Also catch vertical labels (90° OCR pass)**;
- **Check tools & languages** — confirms the tools and `eng`/`slk` are present.

### Command line
```bash
python scan_vectorizer.py myscan.pdf                       # PDF + SVG + DXF (balanced)
python scan_vectorizer.py myscan.pdf --preset detail       # keep thin/faint lines
python scan_vectorizer.py myscan.pdf --preset compact      # smallest files
python scan_vectorizer.py myscan.pdf --ocr --lang slk+eng  # + searchable PDF & text
python scan_vectorizer.py myscan.pdf --vertical            # + 90° pass for vertical labels
```

### Options
| Flag | Default | Meaning |
|------|---------|---------|
| `-f, --formats` | `pdf,svg,dxf` | any subset of `pdf,svg,dxf` |
| `--ocr` | off | also write `_searchable.pdf` and `_ocr_text.txt` |
| `--vertical` | off | extra 90° OCR pass for vertical labels (implies `--ocr`); alias `--ocr-rotated` |
| `--lang` | `slk+eng` | OCR language(s); e.g. `eng`, `ces`, `deu+eng` |
| `--preset` | `balanced` | **detail** (keeps thin/faint lines, bigger files), **balanced**, or **compact** (smallest). Sets the knobs below — override any individually. |
| `--dpi` | *preset* | trace resolution (detail 500 / balanced 350 / compact 250) |
| `--denoise` | *preset* | blur (px) to remove scan grain; **`0` keeps thin lines**, `1.5`–`2` for grainy scans |
| `--threshold` | *preset* | black/white cut 0..1 (lower keeps more faint detail) |
| `--smooth` | *preset* | corner smoothing 0..1.3 (lower = sharper corners) |
| `--line-width` | *preset* | **DXF line width in mm** (bold in CAD); `0` = hairline |
| `--simplify` | *preset* | DXF point-thinning tolerance in px (higher = smaller DXF) |
| `--turd` | *preset* | despeckle: drop specks up to this many px |
| `--filter` | `0` | high-pass for **uneven/blotchy** scans; `0` = off; try `20`+ (can hollow thick strokes) |
| `--upscale` | `1` | upscale before tracing — smoother edges, slower, bigger files |
| `--connect` | off | bridge small gaps in broken lines (morphological close) |
| `--ocr-dpi` | `400` | OCR render resolution (small text reads better higher) |
| `--psm` | `11` | Tesseract layout mode (`11` = sparse, good for drawings) |
| `--check` | – | check that all tools/languages are present and exit |

Outputs are named after the input (`myscan_vectorized.dxf`, …). Multi-page PDFs
get one combined vector/searchable PDF and one file **per page** for SVG/DXF.

---

## Build the Windows app

Make a standalone app that runs with **nothing installed**. You only need
Python 3.9+ to *build* it once. Two builds are available:

### Installer (recommended for end users)
```powershell
.\build_installer.ps1      # or double-click build_installer.bat
```
Produces **`dist\ScanVectorizer-Setup.exe`** — a **per-user** installer (no admin /
UAC) that adds **Start Menu + desktop shortcuts** and an entry in *Apps & features*
with a clean uninstaller. It installs a fast-launching folder build, so the app
opens instantly. The free Inno Setup compiler is fetched automatically if needed.

### Portable single exe
```powershell
.\build_exe.ps1            # or double-click build_exe.bat
```
Produces a single **`dist\ScanVectorizer.exe`** you can copy anywhere and
double-click — no install. (It unpacks bundled tools to a cache on first launch,
so the very first run is a little slower.)

Both builds automatically stage the external tools (`get_tools.ps1`), generate the
icon, pack `tools.zip`, and bundle everything with PyInstaller. On first run the app
unpacks its tools to `%LOCALAPPDATA%\ScanVectorizer\tools` (one-time). Refresh the
staged tools anytime with `.\get_tools.ps1 -Force`.

### Cutting a release (maintainer)
With a clean committed tree and `gh` authenticated, one command builds both
artifacts, tags the commit, and publishes a GitHub Release with the binaries:
```powershell
.\release.ps1 -Version 1.0.1
```
(It stamps the version into the installer, pushes tag `v1.0.1`, and uploads
`ScanVectorizer-Setup.exe` + `ScanVectorizer.exe`.)

> ⚠️ The built `.exe` bundles **GPL** tools (Poppler, potrace) — see
> [Licensing](#licensing) before redistributing it.

---

## Limitations

- **Outline tracing, not a redrawn CAD model.** Every line becomes a thin *closed
  outline* (two edges), not a centerline, and text becomes letter-shaped polygons —
  not editable CAD text. `--line-width` gives those outlines a real width so CAD
  shows bold lines, but it's still an **underlay to trace over**, not parametric
  geometry. For that, redraw it (or use dedicated software such as Scan2CAD).
- **DXF scale** is **millimetres at paper size** (1 unit = 1 mm of the sheet).
  Apply the drawing's plot scale from the titleblock for real-world dimensions.
- **OCR quality.** Upright text reads well (diacritics included). Rotated text,
  dimensions on lines, and dense symbol clusters are only partly captured; the
  searchable PDF is the best way to read text in place.

---

## Troubleshooting

- **"Missing dependencies"** → `python scan_vectorizer.py --check`; install/stage
  whatever shows `MISS` (`get_tools.ps1` on Windows).
- **Thin/faint lines or fine detail dropping out** → use **`--preset detail`** (or
  the **Detail** level in the window). It turns off de-noising, raises dpi, and lowers
  the threshold so faint thin strokes survive — at the cost of bigger files.
- **Lines too faint in CAD** → raise `--line-width` (e.g. `0.4`); `0` = hairlines.
- **Faint lines dropping out / gaps** → lower `--threshold` (e.g. `0.45`); for
  blotchy backgrounds try `--filter 20`.
- **Jagged lines / huge DXF** → both come from tracing **scan grain**. Raise
  **Denoise** (`--denoise 1.5`), use **250–300 dpi** (not 500), and raise
  `--simplify`/`--turd`. (That roughly halved the sample sheet's DXF, 11.6 → 5.3 MB.)
- **No Slovak characters in OCR** → ensure `slk.traineddata` is present, pass
  `--lang slk+eng`.
- **Vertical labels missed** → add `--vertical` (or tick it in the window).

---

## Credits

Scan Vectorizer is glue code — these projects do the actual work, and deserve the
credit:

- **[Poppler](https://poppler.freedesktop.org)** (`pdftoppm`) — renders the PDF page to an image.
- **[potrace & mkbitmap](https://potrace.sourceforge.net)** by **Peter Selinger** — the raster→vector tracing and pre-cleaning that this whole tool is built around.
- **[Tesseract OCR](https://github.com/tesseract-ocr/tesseract)** + **[tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast)** — the OCR text layer.
- Python libraries: **[ezdxf](https://ezdxf.mozman.at)** (DXF authoring), **[pypdf](https://github.com/py-pdf/pypdf)** (PDF assembly), **[NumPy](https://numpy.org)** (geometry), **[Pillow](https://python-pillow.org)** (de-noising), and **[PyInstaller](https://pyinstaller.org)** (the Windows build).

Their licenses are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

---

## Licensing

The **source code of Scan Vectorizer is MIT-licensed** (see [`LICENSE`](LICENSE)).
It is a thin wrapper: it only *drives* the external programs above as separate
child processes — it does not link them — so this code is independent of their
licenses.

The external tools aren't in this repository (`get_tools.ps1` downloads them) and
carry their own licenses: **Poppler** and **potrace/mkbitmap** are **GPL**,
**Tesseract** (+ `tessdata_fast`) is **Apache-2.0** — full texts in
[`licenses/`](licenses/). The binaries under **Releases** bundle *unmodified* upstream
builds and comply (corresponding-source links + written offer in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md#gpl-compliance-for-the-bundled-binaries)).

---

## Repository layout

```
scan_vectorizer.py         # the whole application (GUI + CLI)
get_tools.ps1              # downloads/stages Poppler, potrace+mkbitmap, Tesseract
build_exe.ps1 / .bat       # build the portable single-exe
build_installer.ps1 / .bat # build the Windows installer (Setup.exe)
installer.iss              # Inno Setup script for the installer
release.ps1                # build + tag + publish a GitHub release
make_icon.py               # generates scan_vectorizer.ico (build-time)
make_testpdf.py            # makes a small synthetic Slovak test scan (dev helper)
requirements.txt           # Python deps
scan_vectorizer.ico        # app icon
LICENSE  ·  THIRD_PARTY_NOTICES.md  ·  .gitignore
```
