' Launch quietly; development dependencies can be installed with npm install.
Option Explicit
Dim shell, fso, root, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
command = "node.exe " & Chr(34) & root & "\scripts\launch.cjs" & Chr(34)
shell.Run command, 0, False
