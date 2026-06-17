# Build the Windows installer:  dist\ScanVectorizer-Setup.exe
#
# Produces a per-user installer (no admin/UAC) with Start Menu + desktop
# shortcuts and an uninstaller. It builds the app as a fast-launching "onedir"
# bundle (instant start, unlike the one-file portable exe) and wraps it with
# Inno Setup. Run once:   .\build_installer.ps1   (or double-click build_installer.bat)
#
# Needs Python 3.9+. The free Inno Setup compiler is fetched automatically if
# it isn't already installed.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# 1. external tools staged + packed into tools.zip (same as the portable build)
if (-not (Test-Path "tools\poppler\bin\pdftoppm.exe") -or
    -not (Test-Path "tools\potrace\potrace.exe") -or
    -not (Test-Path "tools\potrace\mkbitmap.exe") -or
    -not (Test-Path "tools\tesseract\tesseract.exe")) {
    Write-Host "Tools missing -> running get_tools.ps1 ..."
    & (Join-Path $PSScriptRoot "get_tools.ps1")
}
Write-Host "Packing tools into tools.zip ..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path tools.zip) { Remove-Item tools.zip -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory((Resolve-Path 'tools').Path, (Join-Path $PSScriptRoot 'tools.zip'))

# 2. build venv + dependencies
$venv = Join-Path $PSScriptRoot ".build-venv"
$py   = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $py)) { python -m venv $venv }
& $py -m pip install --upgrade pip
& $py -m pip install -r requirements.txt pyinstaller
if (-not (Test-Path "scan_vectorizer.ico")) { & $py -m pip install pillow; & $py make_icon.py }

# 3. build the fast-launching onedir app -> dist\ScanVectorizer\
Write-Host "Building onedir app ..."
& $py -m PyInstaller --noconfirm --clean --onedir --windowed `
    --icon scan_vectorizer.ico --add-data "tools.zip;." `
    --name ScanVectorizer scan_vectorizer.py

# 4. find (or fetch) the Inno Setup compiler
function Find-ISCC {
    $c = @(
        (Join-Path $PSScriptRoot ".innosetup\ISCC.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
    )
    $c | Where-Object { Test-Path $_ } | Select-Object -First 1
}
$iscc = Find-ISCC
if (-not $iscc) {
    Write-Host "Inno Setup not found -> fetching (per-user, no admin) ..."
    $dl = Join-Path $PSScriptRoot ".inno_dl"
    New-Item -ItemType Directory -Force -Path $dl | Out-Null
    winget download --id JRSoftware.InnoSetup --source winget `
        --accept-package-agreements --accept-source-agreements --download-directory $dl 2>&1 | Out-Null
    $exe = Get-ChildItem $dl -Recurse -Filter '*.exe' | Select-Object -First 1
    $dir = Join-Path $PSScriptRoot ".innosetup"
    Start-Process -FilePath $exe.FullName -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART","/CURRENTUSER","/DIR=$dir" -Wait
    Remove-Item $dl -Recurse -Force -ErrorAction SilentlyContinue
    $iscc = Find-ISCC
}
if (-not $iscc) { throw "Could not obtain the Inno Setup compiler (ISCC.exe). Install Inno Setup, then re-run." }

# 5. compile the installer
Write-Host "Compiling installer with $iscc ..."
& $iscc "installer.iss"

Write-Host ""
Write-Host "Done -> $(Join-Path $PSScriptRoot 'dist\ScanVectorizer-Setup.exe')"
