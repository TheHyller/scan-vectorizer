@echo off
rem Build the Windows installer (dist\ScanVectorizer-Setup.exe).
rem Double-click this, or run it from a command prompt. Needs Python 3.9+;
rem the Inno Setup compiler is fetched automatically if missing.

setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_installer.ps1"
if errorlevel 1 (
    echo.
    echo Installer build FAILED. See the messages above.
) else (
    echo.
    echo Done -^> dist\ScanVectorizer-Setup.exe
)
pause
