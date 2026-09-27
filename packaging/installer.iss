; Inno Setup script for the Font-tastic installer.
; Built by:  python packaging/build_exe.py --installer   (passes AppVersion and the folders)
; By hand:   ISCC /DAppVersion=0.9.0 /DSourceDir=..\dist\Font-tastic /DOutputDir=..\dist packaging\installer.iss

#ifndef AppVersion
  #error Pass /DAppVersion=x.y.z
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\Font-tastic"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

#define AppName "Font-tastic"
#define AppExe "Font-tastic.exe"
#define ProgId "Fonttastic.Project"

[Setup]
; Keep this AppId for every release: it's how upgrades and the uninstaller find the install.
AppId={{6E0F3C2A-8B1D-4F5E-9A47-3D2C1B0E9F81}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Font-tastic
AppPublisherURL=https://github.com/BurritoInSpace/Font-Tastic
AppSupportURL=https://github.com/BurritoInSpace/Font-Tastic/issues
AppUpdatesURL=https://github.com/BurritoInSpace/Font-Tastic/releases
; Per-user install: no administrator rights needed ({autopf} is the user's Programs folder).
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=Font-tastic-{#AppVersion}-setup
SetupIconFile=fonttastic.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesAssociations=yes
CloseApplications=yes
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppName} installer

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "fileassoc"; Description: "Open .fonttastic &project files with Font-tastic"; GroupDescription: "Files:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; A new version replaces the bundled libraries wholesale, so nothing stale is left behind.
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; Double-clicking a .fonttastic file opens it (for this user only).
Root: HKA; Subkey: "Software\Classes\.fonttastic"; ValueType: string; ValueName: ""; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: fileassoc
Root: HKA; Subkey: "Software\Classes\{#ProgId}"; ValueType: string; ValueName: ""; ValueData: "Font-tastic project"; Flags: uninsdeletekey; Tasks: fileassoc
Root: HKA; Subkey: "Software\Classes\{#ProgId}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppExe},0"; Tasks: fileassoc
Root: HKA; Subkey: "Software\Classes\{#ProgId}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: fileassoc

[Run]
Filename: "{app}\{#AppExe}"; Description: "Start Font-tastic"; Flags: nowait postinstall skipifsilent

[Code]
{ The window is drawn by Microsoft Edge WebView2. It's part of Windows 11 and
  current Windows 10; if it's missing, say where to get it (setup continues). }
function WebView2Installed(): Boolean;
var
  Version: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  Result := Result and (Version <> '') and (Version <> '0.0.0.0');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ErrorCode: Integer;
begin
  if (CurStep = ssPostInstall) and not WizardSilent() and not WebView2Installed() then
  begin
    if MsgBox('Font-tastic needs the Microsoft Edge WebView2 Runtime, which isn''t installed on this computer.' + #13#10#13#10 +
              'Open Microsoft''s download page now? (Choose the "Evergreen Bootstrapper".)',
              mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;
end;
