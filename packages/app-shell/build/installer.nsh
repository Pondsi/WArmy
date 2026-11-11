; WARMY installer hooks — R162 (D3: overwrite behaviour + incremental-update base seed)
;
; Three jobs:
;   1. customInit      — make "install over a running/old install" actually work.
;   2. customInstall   — seed the installer itself as the base for the next delta update.
;   3. customRemoveFiles — keep WArmyData (user data) on uninstall/upgrade.
;
; WArmy stores its runtime data in <install dir>\WArmyData. Everything else in the
; install directory is program files and may be replaced/removed freely.

; ---------------------------------------------------------------------------
; 1) Overwrite behaviour.
;
; Real-world defect (R161): double-clicking the new installer while the old app
; was running did NOT replace it — the running WARMY.exe holds its own exe/dll
; handles, so the copy silently fails and the user keeps the old build without
; any error. electron-builder's own CHECK_APP_RUNNING only fires later (inside
; the install section) and pops a modal the user can cancel.
;
; So: kill the process tree up front, then drop the previous version's
; `resources` directory. NSIS only overwrites files with matching names, which
; means directories that an older version shipped but the new one no longer
; ships would linger forever — that is exactly how old and new product files
; end up mixed in one install directory.
;
; WArmyData is NEVER touched here.
; ---------------------------------------------------------------------------
!macro customInit
  ; /T takes the children with it (the memory service runs on the bundled node.exe
  ; spawned by WARMY.exe). No broad "node.exe" kill — that would take out unrelated
  ; processes on the user's machine.
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  Pop $0
  ; give the OS a moment to release the file handles
  Sleep 500
  RMDir /r "$INSTDIR\resources"
  ; previous version's delta base: re-seeded below with the current version
  RMDir /r "$INSTDIR\WArmyData\updates\base"
!macroend

; ---------------------------------------------------------------------------
; 2) Incremental-update base seed.
;
; The in-app updater (src/updater.ts + src/update-blocks.ts) downloads only the
; 64 KiB blocks whose sha256 changed, using HTTP Range requests against the new
; installer and copying the unchanged blocks out of a local base installer.
; Without a base the very first update would have to pull the whole ~234 MB.
; Seeding the installer here means the first update is already incremental.
;
; Cost: one extra copy of the installer (~234 MB) under WArmyData\updates\base.
; It is reclaimed automatically: once a newer update has been downloaded and
; verified, the updater promotes that artifact to the base and deletes this seed.
; To opt out manually, delete <install dir>\WArmyData\updates\base.
; ---------------------------------------------------------------------------
!macro customInstall
  CreateDirectory "$INSTDIR\WArmyData\updates\base"
  ClearErrors
  CopyFiles /SILENT "$EXEPATH" "$INSTDIR\WArmyData\updates\base\WArmy-Setup-${VERSION}.exe"
  ; A failed seed must never fail the install: the updater falls back to a full
  ; download when it cannot find a base, so this is strictly an optimisation.
  ClearErrors
!macroend

; ---------------------------------------------------------------------------
; 3) Uninstall / upgrade: keep the user data folder.
;
; The default NSIS uninstaller removes the whole install directory, so this macro
; walks the top level and removes every entry except WArmyData. No rename or
; temporary move is needed, and a locked data folder can never be deleted by it.
;
; WArmyData\updates is the one exception: it holds only downloaded installers and
; the delta base (app-generated cache, ~234 MB), never user data. Leaving it behind
; after an uninstall would strand a quarter of a gigabyte on disk.
; ---------------------------------------------------------------------------
!macro customRemoveFiles
  RMDir /r "$INSTDIR\WArmyData\updates"
  FindFirst $0 $1 "$INSTDIR\*.*"
  warmy_un_loop:
    StrCmp $1 "" warmy_un_done
    StrCmp $1 "." warmy_un_next
    StrCmp $1 ".." warmy_un_next
    StrCmp $1 "WArmyData" warmy_un_next
    RMDir /r "$INSTDIR\$1"
    Delete "$INSTDIR\$1"
  warmy_un_next:
    FindNext $0 $1
    Goto warmy_un_loop
  warmy_un_done:
  FindClose $0
  RMDir "$INSTDIR"
!macroend