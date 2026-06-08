; Custom NSIS hooks for HorseMD.
; Adds an "Open with HorseMD" entry to the right-click menu of folders, so a
; whole directory can be opened as a workspace straight from Explorer.
;
; Written under HKCU\Software\Classes (per-user) so it works without admin
; rights, matching the per-user install. The app's main process accepts a
; directory path on argv and opens it as a folder (see extractArgs).

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
