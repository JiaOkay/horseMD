; Custom NSIS hooks for HorseMD.
;
; 1) Adds an "Open with HorseMD" entry to the right-click menu of folders, so a
;    whole directory can be opened as a workspace straight from Explorer.
; 2) Makes uninstall SURGICAL: it removes only the files we installed, so a file
;    the user saved inside the install folder (e.g. a Markdown note next to the
;    app) is preserved instead of being wiped by a blanket "RMDir /r $INSTDIR".
;
; Registry entries are written under HKCU\Software\Classes (per-user) so they
; work without admin rights, matching the per-user install.

!macro customInstall
  ; Right-clicking a folder
  WriteRegStr HKCU "Software\Classes\Directory\shell\HorseMD" "" "Open with HorseMD"
  WriteRegStr HKCU "Software\Classes\Directory\shell\HorseMD" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\HorseMD\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; Right-clicking the empty background inside a folder
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\HorseMD" "" "Open with HorseMD"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\HorseMD" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\HorseMD\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%V"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\HorseMD"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\HorseMD"
!macroend

; Replaces electron-builder's default "RMDir /r $INSTDIR". Defining this macro
; takes over file removal entirely, so we must also keep the stock behaviour for
; the in-place UPDATE path (clean slate, no stale files between versions).
!macro customRemoveFiles
  ${if} ${isUpdated}
    ; Overwrite-install / update: keep the stock clean-slate removal.
    CreateDirectory "$PLUGINSDIR\old-install"
    Push ""
    Call un.atomicRMDir
    Pop $R0
    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"
      Push ""
      Call un.restoreFiles
      Pop $R0
      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${endif}
    RMDir /r $INSTDIR
  ${else}
    ; Real uninstall: delete ONLY the files we shipped. Anything the user added
    ; to the folder (notes, etc.) is left untouched, and the final non-recursive
    ; RMDir removes the folder only if it ends up empty.
    Delete "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    Delete "$INSTDIR\${UNINSTALL_FILENAME}"
    Delete "$INSTDIR\*.dll"
    Delete "$INSTDIR\*.pak"
    Delete "$INSTDIR\*.bin"
    Delete "$INSTDIR\*.dat"
    Delete "$INSTDIR\vk_swiftshader_icd.json"
    Delete "$INSTDIR\LICENSE.electron.txt"
    Delete "$INSTDIR\LICENSES.chromium.html"
    RMDir /r "$INSTDIR\locales"
    RMDir /r "$INSTDIR\resources"
    RMDir /r "$INSTDIR\swiftshader"
    RMDir "$INSTDIR"
  ${endif}
!macroend
