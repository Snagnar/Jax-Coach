' Starts Jax Coach without any console window (tray icon + browser). The desktop shortcut points here.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\app\JaxCoach.ps1""", 0, False
