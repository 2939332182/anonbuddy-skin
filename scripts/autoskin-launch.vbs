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
' It runs scripts/launch-and-skin.mjs. Extra arguments are passed straight
' through, so a shortcut can carry e.g.:
'   --prefer cn --port 9334
' or --exe "D:\path\WorkBuddy.exe". Both editions can live side by side, and the
' shortcut is what picks which one.
'
' Keep this file ASCII-only.

Option Explicit

Dim shell, fso, here, target, nodeExe, cmd, i, arg

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
target = fso.BuildPath(here, "launch-and-skin.mjs")

If Not fso.FileExists(target) Then
  MsgBox "launch-and-skin.mjs not found next to this launcher:" & vbCrLf & target, _
         16, "AnonBuddy Skin"
  WScript.Quit 1
End If

nodeExe = FindNode()
If nodeExe = "" Then
  MsgBox "Node.js not found." & vbCrLf & vbCrLf & _
         "Install Node.js 20+ , or run WorkBuddy once so it unpacks the copy " & _
         "it ships with (~/.workbuddy-ai/binaries/node/versions).", _
         16, "AnonBuddy Skin"
  WScript.Quit 1
End If

cmd = """" & nodeExe & """ """ & target & """"

' Pass through any arguments the shortcut supplies.
For i = 0 To WScript.Arguments.Count - 1
  arg = WScript.Arguments(i)
  If InStr(arg, " ") > 0 Then arg = """" & arg & """"
  cmd = cmd & " " & arg
Next

' 0 = hidden window, False = do not wait for it to finish.
shell.Run cmd, 0, False

' Locate node.exe: PATH first, then the copy WorkBuddy unpacks for itself
' (international .workbuddy-ai / China .workbuddy).
Function FindNode()
  Dim probe, line, roots, i, root, folder, sub_

  ' 1) whatever is on PATH
  On Error Resume Next
  Set probe = shell.Exec("cmd /c where node.exe 2>nul")
  If Err.Number = 0 Then
    If Not probe.StdOut.AtEndOfStream Then
      line = Trim(probe.StdOut.ReadLine())
      If line <> "" Then
        FindNode = line
        Exit Function
      End If
    End If
  End If
  Err.Clear
  On Error GoTo 0

  ' 2) the copy WorkBuddy ships with
  roots = Array(".workbuddy-ai", ".workbuddy")
  For i = 0 To UBound(roots)
    root = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\" & roots(i) & _
           "\binaries\node\versions"
    If fso.FolderExists(root) Then
      For Each folder In fso.GetFolder(root).SubFolders
        If fso.FileExists(folder.Path & "\node.exe") Then
          FindNode = folder.Path & "\node.exe"
          Exit Function
        End If
      Next
    End If
  Next

  FindNode = ""
End Function
