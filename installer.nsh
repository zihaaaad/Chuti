; installer.nsh — Custom NSIS script fragments for the Chuti installer
; These are injected by electron-builder into the generated NSIS script.

; Show a welcome message on the installer's first page
!define MUI_WELCOMEPAGE_TITLE "Welcome to Chuti Setup"
!define MUI_WELCOMEPAGE_TEXT "Chuti is a simple, offline-first Leave Management System.$\r$\n$\r$\nThis wizard will guide you through the installation.$\r$\n$\r$\nClick Next to continue."

; Ensure VC++ Redistributables check is skipped (we bundle our own Node.js via Electron)
!macro customInit
  ; Nothing extra needed at init
!macroend

!macro customInstall
  ; Create the AppData config directory so the app can write its config on first run
  CreateDirectory "$APPDATA\Chuti"
!macroend

!macro customUnInstall
  ; Offer to remove user data on uninstall
  MessageBox MB_YESNO "Do you want to remove your Chuti data folder (database, backups, and uploads)?$\r$\nClick No to keep your data." IDNO skipDataRemoval
    ; Read config.json to find the user's data folder
    ; We only remove the AppData config dir — user data folder is their choice
    RMDir /r "$APPDATA\Chuti"
  skipDataRemoval:
!macroend
