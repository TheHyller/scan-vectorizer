# Build ScanVectorizer.exe (Windows, windowed / no console).
#
# Run once from PowerShell:   .\build_exe.ps1
# Output:                     dist\ScanVectorizer.exe
#
# This produces a SELF-CONTAINED exe: Python, the Python packages, AND the
# external tools (Poppler / potrace / Tesseract + eng/slk OCR data) are all
# bundled inside. Nothing needs to be installed to run it.
#
# You only need Python 3.9+ to *build* it. The script will:
#   1. fetch the external tools into tools\ (via get_tools.ps1) if missing,
#   2. generate the app icon if missing,
#   3. build the single-file exe with PyInstaller in a throwaway venv.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# 1. external tools must be staged so they can be bundled
if (-not (Test-Path "tools\poppler\bin\pdftoppm.exe") -or
    -not (Test-Path "tools\potrace\potrace.exe") -or
    -not (Test-Path "tools\potrace\mkbitmap.exe") -or
    -not (Test-Path "tools\tesseract\tesseract.exe")) {
    Write-Host "Tools missing -> running get_tools.ps1 ..."
    & (Join-Path $PSScriptRoot "get_tools.ps1")
}

$venv = Join-Path $PSScriptRoot ".build-venv"
$py   = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Host "Creating build venv ..."
    python -m venv $venv
}

Write-Host "Installing build dependencies ..."
& $py -m pip install --upgrade pip
& $py -m pip install -r requirements.txt pyinstaller

# 2. app icon (generated with Pillow; build-time only)
if (-not (Test-Path "scan_vectorizer.ico")) {
    Write-Host "Generating app icon ..."
    & $py -m pip install pillow
    & $py make_icon.py
}

# 3. pack the tools into a single zip. Bundling the tool DLLs loose makes
#    PyInstaller flatten them into the onefile temp root, which crashes the child
#    tools; shipping a zip (extracted to a cache at runtime) avoids that and makes
#    launches faster.
Write-Host "Packing tools into tools.zip ..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path tools.zip) { Remove-Item tools.zip -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory((Resolve-Path 'tools').Path, (Join-Path $PSScriptRoot 'tools.zip'))

# 4. build the bundled exe
Write-Host "Building ScanVectorizer.exe (bundling tools.zip, this is a big build) ..."
& $py -m PyInstaller --noconfirm --clean --onefile --windowed `
    --icon scan_vectorizer.ico `
    --add-data "tools.zip;." `
    --name ScanVectorizer scan_vectorizer.py

Write-Host ""
Write-Host "Done -> $(Join-Path $PSScriptRoot 'dist\ScanVectorizer.exe')"
