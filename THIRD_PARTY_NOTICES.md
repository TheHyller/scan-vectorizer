# Third-party software

Scan Vectorizer is only the "glue": its own source code (MIT, see `LICENSE`)
drives several **separate external programs** as child processes. None of those
programs are included in this repository — `get_tools.ps1` downloads them onto
your machine at build time. Each carries its own license and copyright, listed
below. If you ever distribute a build that **bundles** these programs (e.g. the
PyInstaller `.exe`), you are responsible for complying with their terms.

| Component | Used for | License | Source |
|-----------|----------|---------|--------|
| **Poppler** (`pdftoppm`) | render PDF → bitmap | GNU GPL-2.0-or-later | https://poppler.freedesktop.org · Windows build: https://github.com/oschwartz10612/poppler-windows |
| **potrace** & **mkbitmap** | bitmap → vector trace; pre-clean | GNU GPL-2.0-or-later | https://potrace.sourceforge.net |
| **Tesseract OCR** | optional OCR text layer | Apache License 2.0 | https://github.com/tesseract-ocr/tesseract · Windows build: https://github.com/UB-Mannheim/tesseract |
| **tessdata_fast** (`eng`, `slk`, `osd`) | OCR language data | Apache License 2.0 | https://github.com/tesseract-ocr/tessdata_fast |

## Python packages (PyPI)

| Package | License |
|---------|---------|
| ezdxf | MIT |
| pypdf | BSD-3-Clause |
| numpy | BSD-3-Clause |
| pillow | MIT-CMU (HPND) |
| PyInstaller *(build only)* | GPL-2.0-with-exception (its bootloader exception lets you ship the produced exe under your own terms) |

Full license texts are included in the [`licenses/`](licenses/) folder:
[`GPL-2.0.txt`](licenses/GPL-2.0.txt) (Poppler, potrace/mkbitmap) and
[`Apache-2.0.txt`](licenses/Apache-2.0.txt) (Tesseract, tessdata).

## What this means for distribution

- **Running it yourself / sharing the source:** nothing third-party is in this
  repository — `get_tools.ps1` downloads the tools per-user — so the source carries
  no obligations beyond the MIT [`LICENSE`](LICENSE).
- **Sharing a built binary** (e.g. the GitHub Release `.exe`/installer): it
  **embeds** the tools above, including the **GPL** components. That's permitted, and
  this project complies — see below.

## GPL compliance for the bundled binaries

The binaries published under **Releases** bundle **unmodified upstream builds** of
the following GPL programs. Their full license is in
[`licenses/GPL-2.0.txt`](licenses/GPL-2.0.txt), and their **corresponding source
code** is available at the upstream sites below.

| Program (bundled version) | Corresponding source |
|---|---|
| **Poppler 26.02.0** (`pdftoppm` + DLLs) | https://poppler.freedesktop.org/ (release tarballs) · Windows-build packaging: https://github.com/oschwartz10612/poppler-windows (release `v26.02.0-0`) |
| **potrace / mkbitmap 1.16** | https://potrace.sourceforge.net/#downloading (`potrace-1.16.tar.gz`) |

**Written offer (GPL-2.0 §3b).** For three years from the date a binary is
distributed, the author will also provide a complete machine-readable copy of the
corresponding source code for the GPL programs above, on a physical medium or via a
download link, for no more than the cost of distribution — request it by opening an
issue on this repository.

The bundled binaries are unmodified; this project does not patch Poppler or potrace.
**Tesseract** and the language data are **Apache-2.0** (see
[`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt)) — no source-offer obligation,
notice included.

> Prefer not to deal with any of this? **Publish the source only** and let users
> build their own with `build_exe.ps1` / `build_installer.ps1` (which download the
> tools onto their machine) — then you distribute no third-party binaries at all.
