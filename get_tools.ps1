# get_tools.ps1 -- download portable copies of the external programs that
# scan_vectorizer needs into a local "tools\" folder, so the app (and the
# bundled .exe) can run without installing anything system-wide.
#
#   tools\poppler\bin\pdftoppm.exe        (+ DLLs)        -- Poppler
#   tools\potrace\potrace.exe                             -- potrace
#   tools\tesseract\tesseract.exe         (+ DLLs)        -- Tesseract OCR
#   tools\tesseract\tessdata\{eng,slk,osd}.traineddata   -- OCR languages
#
# Re-run with -Force to re-download everything.
#
# Usage:  .\get_tools.ps1            (skips tools already present)
#         .\get_tools.ps1 -Force

param([switch]$Force)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location -Path $PSScriptRoot

$tools = Join-Path $PSScriptRoot "tools"
$tmp   = Join-Path $PSScriptRoot ".tooltmp"
New-Item -ItemType Directory -Force -Path $tools, $tmp | Out-Null

function Get-File($url, $dest) {
    Write-Host "  downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

# ---------------------------------------------------------------- Poppler ----
$popplerBin = Join-Path $tools "poppler\bin\pdftoppm.exe"
if ($Force -or -not (Test-Path $popplerBin)) {
    Write-Host "[Poppler]"
    $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/oschwartz10612/poppler-windows/releases/latest' -Headers @{ 'User-Agent' = 'ps' }
    $asset = $rel.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
    $zip = Join-Path $tmp $asset.name
    Get-File $asset.browser_download_url $zip
    $ex = Join-Path $tmp "poppler_x"
    Remove-Item $ex -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $zip -DestinationPath $ex -Force
    $pp = Get-ChildItem $ex -Recurse -Filter pdftoppm.exe | Select-Object -First 1
    if (-not $pp) { throw "pdftoppm.exe not found in Poppler zip" }
    $library = Split-Path (Split-Path $pp.FullName -Parent) -Parent   # ...\Library
    $destP = Join-Path $tools "poppler"
    Remove-Item $destP -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item $library $destP -Recurse -Force                          # -> tools\poppler\bin\pdftoppm.exe
    Write-Host "  ok -> $popplerBin"
} else { Write-Host "[Poppler] already present, skipping" }

# ---------------------------------------------------------------- potrace ----
$potraceExe = Join-Path $tools "potrace\potrace.exe"
if ($Force -or -not (Test-Path $potraceExe)) {
    Write-Host "[potrace]"
    $zip = Join-Path $tmp "potrace.zip"
    Get-File 'https://potrace.sourceforge.net/download/1.16/potrace-1.16.win64.zip' $zip
    $ex = Join-Path $tmp "potrace_x"
    Remove-Item $ex -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $zip -DestinationPath $ex -Force
    $pe = Get-ChildItem $ex -Recurse -Filter potrace.exe | Select-Object -First 1
    if (-not $pe) { throw "potrace.exe not found in potrace zip" }
    $destP = Join-Path $tools "potrace"
    New-Item -ItemType Directory -Force -Path $destP | Out-Null
    Copy-Item $pe.FullName (Join-Path $destP "potrace.exe") -Force
    # mkbitmap (same zip) preprocesses scans for much cleaner tracing
    $mk = Get-ChildItem $ex -Recurse -Filter mkbitmap.exe | Select-Object -First 1
    if ($mk) { Copy-Item $mk.FullName (Join-Path $destP "mkbitmap.exe") -Force }
    Write-Host "  ok -> $potraceExe"
} else { Write-Host "[potrace] already present, skipping" }

# -------------------------------------------------------------- Tesseract ----
# Tesseract has no official portable zip. We try a no-admin silent install into
# our temp dir; if that doesn't land (NSIS ignores /D when an install is already
# registered, and may want elevation), we copy from an existing install instead.
# Either way we keep only the exe, its DLLs and tessdata (the training tools and
# docs are dropped to keep the bundle smaller).
$tessExe = Join-Path $tools "tesseract\tesseract.exe"
if ($Force -or -not (Test-Path $tessExe)) {
    Write-Host "[Tesseract]"
    $setupUrl = 'https://digi.bib.uni-mannheim.de/tesseract/tesseract-ocr-w64-setup-5.4.0.20240606.exe'
    $setup = Join-Path $tmp "tesseract-setup.exe"
    Get-File $setupUrl $setup
    $tdest = Join-Path $tmp "tess_install"            # no spaces (NSIS /D requirement)
    Remove-Item $tdest -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  silent install -> $tdest"
    Start-Process -FilePath $setup -ArgumentList "/S /D=$tdest" -Wait

    $tessSrc = $null
    if (Test-Path (Join-Path $tdest "tesseract.exe")) {
        $tessSrc = $tdest
    } else {
        Write-Host "  not in temp; looking for an existing install ..."
        $cands = @()
        $cmd = Get-Command tesseract -ErrorAction SilentlyContinue
        if ($cmd) { $cands += (Split-Path $cmd.Source -Parent) }
        $cands += (Join-Path $env:ProgramFiles 'Tesseract-OCR')
        if (${env:ProgramFiles(x86)}) { $cands += (Join-Path ${env:ProgramFiles(x86)} 'Tesseract-OCR') }
        $tessSrc = $cands | Where-Object { Test-Path (Join-Path $_ 'tesseract.exe') } | Select-Object -First 1
    }
    if (-not $tessSrc) {
        throw "Could not obtain Tesseract. Run the UB-Mannheim setup once, then re-run this script."
    }

    $destT  = Join-Path $tools "tesseract"
    $destTd = Join-Path $destT "tessdata"
    Remove-Item $destT -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $destTd | Out-Null
    Copy-Item (Join-Path $tessSrc 'tesseract.exe') $destT -Force
    Copy-Item (Join-Path $tessSrc '*.dll') $destT -Force
    $srcTd = Join-Path $tessSrc 'tessdata'
    # configs + the glyphless font are required for PDF / txt output
    Copy-Item (Join-Path $srcTd 'configs')     $destTd -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $srcTd 'tessconfigs') $destTd -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $srcTd 'pdf.ttf')     $destTd -Force -ErrorAction SilentlyContinue
    Get-ChildItem $srcTd -Filter *.traineddata -ErrorAction SilentlyContinue |
        ForEach-Object { Copy-Item $_.FullName $destTd -Force }
    Write-Host "  ok -> $tessExe (from $tessSrc)"
} else { Write-Host "[Tesseract] already present, skipping" }

# ensure the OCR languages we care about (download from tessdata_fast)
$tessdata = Join-Path $tools "tesseract\tessdata"
New-Item -ItemType Directory -Force -Path $tessdata | Out-Null
foreach ($lang in 'eng', 'slk', 'osd') {
    $f = Join-Path $tessdata "$lang.traineddata"
    if ($Force -or -not (Test-Path $f)) {
        Get-File "https://github.com/tesseract-ocr/tessdata_fast/raw/main/$lang.traineddata" $f
    }
}

# ---------------------------------------------------------------- verify -----
Write-Host "`nVerifying:"
& $popplerBin -v 2>&1 | Select-Object -First 1
& $potraceExe --version 2>&1 | Select-Object -First 1
& $tessExe --version 2>&1 | Select-Object -First 1
Write-Host "Installed languages:" (& $tessExe --tessdata-dir $tessdata --list-langs 2>&1 | Select-Object -Skip 1) -join ", "
if (Test-Path (Join-Path $tools 'potrace\mkbitmap.exe')) { Write-Host "mkbitmap: present" }

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "`nDone. Tools are in: $tools"
