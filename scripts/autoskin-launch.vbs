' AnonBuddy Skin - silent launcher.
'
' Point a shortcut at this file (via wscript.exe) instead of at WorkBuddy.exe.
' One double-click then does everything: start WorkBuddy with the CDP port open,
' wait for the renderer, inject the skin. No console window flashes, and nothing
' stays resident afterwards.
'
' Why a .vbs: wscript.exe is present on every Windows install and can run a
' child process with its window hidden and without waiting. A .bat would flash a
' console; a resident watcher script would sit in memory forever. This does the
' job with neither cost.
'
' Extra arguments are passed straight through to launch-and-skin.ps1, so the
' shortcut can carry e.g.:
'   -WorkBuddyExe "D:\path\WorkBuddy.exe" -Port 9334
' Both editions live side by side, so the shortcut is what picks which one.
'
' Keep this file ASCII-only.

Option Explicit

Dim shell, fso, here, ps1, cmd, i, args

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(here, "launch-and-skin.ps1")

If Not fso.FileExists(ps1) Then
  MsgBox "launch-and-skin.ps1 not found next to this launcher:" & vbCrLf & ps1, _
         16, "AnonBuddy Skin"
  WScript.Quit 1
End If

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"

' Pass through any arguments the shortcut supplies.
For i = 0 To WScript.Arguments.Count - 1
  args = WScript.Arguments(i)
  If InStr(args, " ") > 0 Then args = """" & args & """"
  cmd = cmd & " " & args
Next

' 0 = hidden window, False = do not wait for it to finish.
shell.Run cmd, 0, False
