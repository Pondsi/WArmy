; Keep the user data folder when uninstalling or upgrading.
; WArmy stores its data in <install dir>\WArmyData. The default NSIS uninstaller
; removes the whole install directory, so this macro walks the top level and
; removes every entry except WArmyData. No rename or temporary move is needed,
; and a locked data folder can never be deleted by this macro.
!macro customRemoveFiles
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
