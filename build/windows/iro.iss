; Windows installer for the free panel. Keep AppName, AppVersion and PluginId the same as plugin/product.json (Inno Setup 6: https://jrsoftware.org/isinfo.php).
; NOT TESTED YET: build and try it on a Windows PC with Resolve Studio before selling there.
;   iscc build\windows\iro.iss      -> dist\IRO-<version>-Setup.exe
; Unsigned, Windows SmartScreen shows "Windows protected your PC": people click More info › Run anyway.
;
; Like the Mac installer, it does not ship Blackmagic's WorkflowIntegration.node: it copies
; the one from the customer's own Resolve Studio install.

#define AppName "IRO"
#define AppVersion "1.0.0"
#define PluginId "com.thiseniola.iro"

[Setup]
AppId={{6E4C3B7A-2F1D-4B8E-9C55-5A9E7D2C1F08}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=thiseniola
DefaultDirName={commonappdata}\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\{#PluginId}
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputDir=..\..\dist
OutputBaseFilename=IRO-{#AppVersion}-Setup
; dist\LICENSE.txt is written (with the name filled in) by build/build_mac.sh.
LicenseFile=..\..\dist\LICENSE.txt
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName} for DaVinci Resolve

[Files]
Source: "..\..\plugin\*"; DestDir: "{app}"; Excludes: "WorkflowIntegration.node,.DS_Store"; Flags: recursesubdirs ignoreversion
; Blackmagic's binary from the installed Resolve Studio (checked in InitializeSetup).
Source: "{commonpf}\Blackmagic Design\DaVinci Resolve\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node"; DestDir: "{app}"; Flags: external ignoreversion

[Messages]
FinishedLabel=Open DaVinci Resolve Studio and choose Workspace > Workflow Integrations > {#AppName}.

[Code]
function InitializeSetup(): Boolean;
begin
  Result := FileExists(ExpandConstant('{commonpf}\Blackmagic Design\DaVinci Resolve\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node'));
  if not Result then
    MsgBox('{#AppName} is a panel for DaVinci Resolve Studio 18 or later, and it was not found on this PC. Install Resolve Studio first, then run this installer again.', mbCriticalError, MB_OK);
end;
