# Cut a new release: build the installer + portable exe, tag the commit, and
# publish a GitHub release with both binaries attached.
#
#   .\release.ps1 -Version 1.0.1
#
# Requirements: a clean (committed) working tree, gh authenticated
# (`gh auth login`), and Python 3.9+. Run from this folder.

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Notes = ""
)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
$tag = "v$Version"
Write-Host "=== Releasing $tag ==="

# release from a committed state only
if (git status --porcelain) {
    throw "Working tree has uncommitted changes -- commit or stash them first."
}

# 1. build both artifacts (installer embeds the version)
& "$PSScriptRoot\build_installer.ps1" -Version $Version
& "$PSScriptRoot\build_exe.ps1"
$setup = Join-Path $PSScriptRoot "dist\ScanVectorizer-Setup.exe"
$exe   = Join-Path $PSScriptRoot "dist\ScanVectorizer.exe"
if (-not (Test-Path $setup) -or -not (Test-Path $exe)) { throw "Build did not produce both binaries." }

# 2. tag + push the tag
git tag -a $tag -m "Scan Vectorizer $Version"
git push origin $tag

# 3. publish the GitHub release
$gh = Join-Path $env:LOCALAPPDATA "Programs\gh\bin\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }
if (-not $Notes) {
    $Notes = "Self-contained Windows build (installer + portable exe). Scanned PDF -> " +
             "SVG / DXF / vectorized PDF with optional OCR (English + Slovak). Bundles " +
             "unmodified GPL (Poppler, potrace) + Apache (Tesseract) tools; see licenses/ " +
             "and THIRD_PARTY_NOTICES.md."
}
& $gh release create $tag $setup $exe --title "Scan Vectorizer $Version" --notes $Notes

Write-Host "`nReleased $tag -> https://github.com/TheHyller/scan-vectorizer/releases/tag/$tag"
