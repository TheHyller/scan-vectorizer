@echo off
rem Build ScanVectorizer.exe (Windows, windowed / no console).
rem Double-click this file, or run it from a command prompt.
rem
rem Produces a SELF-CONTAINED dist\ScanVectorizer.exe with Python, the Python
rem packages, and the external tools (Poppler/potrace/Tesseract + eng/slk)
rem all bundled inside -- nothing needs to be installed to run it.
rem
rem All the work is in build_exe.ps1; this just launches it. Needs Python 3.9+.

setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_exe.ps1"
if errorlevel 1 (
    echo.
    echo Build FAILED. See the messages above.
) else (
    echo.
    echo Done -^> dist\ScanVectorizer.exe
)
pause
