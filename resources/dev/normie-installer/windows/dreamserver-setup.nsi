; ============================================================================
; DreamServer Windows Installer — NSIS Script
; ============================================================================
; Builds a self-contained .exe that:
;   1. Shows a welcome page with DreamServer branding
;   2. Extracts the PowerShell installer to temp
;   3. Runs it elevated (handles WSL2, Docker Desktop, and DreamServer setup)
;
; Build: makensis dreamserver-setup.nsi
; Output: DreamServer-Setup.exe
;
; The .exe is a thin wrapper — the PowerShell script does all the work,
; and that script downloads the latest installer code from GitHub.
; This .exe should rarely need rebuilding.
; ============================================================================

!include "MUI2.nsh"
!include "FileFunc.nsh"

; ── Metadata ──────────────────────────────────────────────────────────────────
Name "DreamServer"
OutFile "DreamServer-Setup.exe"
InstallDir "$TEMP\DreamServer-Setup"
RequestExecutionLevel admin
Unicode true

; Version info embedded in the .exe (shows in file properties)
VIProductVersion "2.0.0.0"
VIAddVersionKey "ProductName" "DreamServer"
VIAddVersionKey "CompanyName" "Light Heart Labs"
VIAddVersionKey "LegalCopyright" "Apache 2.0"
VIAddVersionKey "FileDescription" "DreamServer Local AI Stack Installer"
VIAddVersionKey "FileVersion" "2.0.0"
VIAddVersionKey "ProductVersion" "2.0.0"

; ── UI Configuration ─────────────────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"

; Welcome page text
!define MUI_WELCOMEPAGE_TITLE "Install DreamServer"
!define MUI_WELCOMEPAGE_TEXT "This will set up DreamServer on your computer.$\r$\n$\r$\nDreamServer is a complete local AI stack — LLM chat, voice, agents, workflows, and image generation. No cloud, no subscriptions.$\r$\n$\r$\nThe installer will:$\r$\n  1. Enable WSL2 (may require a reboot)$\r$\n  2. Install Docker Desktop$\r$\n  3. Download and configure DreamServer$\r$\n$\r$\nThis process takes 10-30 minutes depending on your internet speed.$\r$\n$\r$\nClick Install to begin."

; Finish page
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open DreamServer in browser"
!define MUI_FINISHPAGE_RUN_FUNCTION "OpenDreamServer"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "View troubleshooting guide"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION "OpenTroubleshooting"

; ── Pages ─────────────────────────────────────────────────────────────────────
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; ── Language ──────────────────────────────────────────────────────────────────
!insertmacro MUI_LANGUAGE "English"

; ── Functions ─────────────────────────────────────────────────────────────────
Function OpenDreamServer
    ExecShell "open" "http://localhost:3000"
FunctionEnd

Function OpenTroubleshooting
    ExecShell "open" "https://github.com/Light-Heart-Labs/DreamServer/blob/main/dream-server/docs/WINDOWS-TROUBLESHOOTING-GUIDE.md"
FunctionEnd

; Check Windows version on init
Function .onInit
    ; Require Windows 10 build 19041+
    ; ReadRegStr checks the CurrentBuild
    ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
    ${If} $0 < 19041
        MessageBox MB_OK|MB_ICONSTOP "DreamServer requires Windows 10 version 2004 or later.$\r$\n$\r$\nYour build: $0$\r$\nRequired: 19041+$\r$\n$\r$\nPlease update Windows first."
        Abort
    ${EndIf}
FunctionEnd

; ── Install Section ───────────────────────────────────────────────────────────
Section "Install"
    SetOutPath $INSTDIR

    ; Extract the PowerShell installer scripts
    File "..\dreamserver-setup.ps1"
    File "..\dreamserver-setup.bat"

    ; Show what we're doing
    DetailPrint "Starting DreamServer setup..."
    DetailPrint "This will configure WSL2, Docker, and DreamServer."
    DetailPrint ""

    ; Run the PowerShell installer
    ; -ExecutionPolicy Bypass: needed since the script isn't signed
    ; -File: runs the extracted .ps1
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\dreamserver-setup.ps1"'
    Pop $0

    ${If} $0 == "0"
        DetailPrint ""
        DetailPrint "DreamServer setup completed successfully!"
    ${ElseIf} $0 == "3010"
        ; 3010 = reboot required (standard Windows installer code)
        DetailPrint ""
        DetailPrint "A reboot is needed. Setup will resume after restart."
        SetRebootFlag true
    ${Else}
        DetailPrint ""
        DetailPrint "Setup exited with code: $0"
        DetailPrint "Check the output above for details."
        DetailPrint "You can re-run this installer to try again."
    ${EndIf}

    ; Clean up extracted files (but not if reboot is pending)
    ${IfNot} ${RebootFlag}
        Delete "$INSTDIR\dreamserver-setup.ps1"
        Delete "$INSTDIR\dreamserver-setup.bat"
        RMDir "$INSTDIR"
    ${EndIf}
SectionEnd
