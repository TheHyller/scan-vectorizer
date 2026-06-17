; Inno Setup script for Scan Vectorizer.
; Produces dist\ScanVectorizer-Setup.exe: a per-user installer (no admin/UAC)
; with Start Menu + optional desktop shortcut and an uninstaller.
; Build it with build_installer.ps1 (which also makes the onedir app first).

#define MyAppName "Scan Vectorizer"
; version can be overridden from the build script:  iscc /DMyAppVersion=1.0.1 installer.iss
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppPublisher "Branislav Hyll"
#define MyAppExeName "ScanVectorizer.exe"

[Setup]
AppId={{B7E2C1A4-3F5D-4A6B-8C9E-0D1F2A3B4C5D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\ScanVectorizer
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; per-user install -> no administrator rights / UAC prompt needed
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=ScanVectorizer-Setup
SetupIconFile=scan_vectorizer.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "dist\ScanVectorizer\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; remove the per-user tool cache + log the app creates at runtime, and any
; leftover runtime files in the install dir, so uninstall leaves nothing behind
Type: filesandordirs; Name: "{localappdata}\ScanVectorizer"
Type: filesandordirs; Name: "{app}"
