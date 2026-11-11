; Removes the "open on wake" scheduled task (desktop/lib/autostart.js) when the app is uninstalled.
; On an update the old copy is uninstalled first; the new version puts the task back the first time it starts.
!macro customUnInstall
  nsExec::Exec 'schtasks.exe /Delete /TN "SkinMatrix Till (open on wake)" /F'
!macroend
