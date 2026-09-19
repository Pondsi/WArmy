// Detached launcher for WArmy Electron UI (physical host)
// Usage: wscript.exe launch-warmy.vbs
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
' script lives in packages/app-shell/scripts → go up to app-shell
appShell = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
electron = appShell & "\node_modules\electron\dist\electron.exe"
mainJs = appShell & "\dist\electron-main.js"
shell.CurrentDirectory = appShell
shell.Environment("Process")("WARMY_UPDATE_FEED_URL") = "https://api.github.com/repos/Pondsi/WArmy/releases/latest"
If fso.FileExists(electron) And fso.FileExists(mainJs) Then
  shell.Run """" & electron & """ """ & mainJs & """", 1, False
  WScript.Echo "launched " & electron & " " & mainJs
Else
  WScript.Echo "missing artifacts electron=" & electron & " main=" & mainJs
  WScript.Quit 1
End If
