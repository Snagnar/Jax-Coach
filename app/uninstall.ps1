# Removes Jax Coach (Windows Settings > Apps > Jax Coach > Uninstall runs this).
# Asks first; your game history and settings are only deleted if you say so.
Add-Type -AssemblyName System.Windows.Forms
$root = Split-Path -Parent $PSScriptRoot
$MB = [System.Windows.Forms.MessageBox]

if ($MB::Show("Remove Jax Coach from`n$root ?", 'Uninstall Jax Coach', 'OKCancel', 'Question') -ne 'OK') { exit }
$keepData = $MB::Show("Keep your game history and settings (history, config.json)?`n`nYes: keep them in the folder.`nNo: delete everything.",
  'Uninstall Jax Coach', 'YesNo', 'Question') -eq 'Yes'

# stop the tray app, the server and the voice helper if they run from this folder
$me = $PID
Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pythonw.exe' OR Name='python.exe' OR Name='wscript.exe'" |
  Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -and $_.CommandLine.Contains($root) } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
Start-Sleep -Milliseconds 800

foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $lnk = Join-Path $dir 'Jax Coach.lnk'
  if (Test-Path $lnk) { Remove-Item -Force $lnk }
}
Remove-Item -Recurse -Force 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JaxCoach' -ErrorAction SilentlyContinue

Set-Location $env:TEMP
$keep = if ($keepData) { @('history', 'config.json') } else { @() }
Get-ChildItem -Force $root | Where-Object { $keep -notcontains $_.Name } |
  ForEach-Object { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue }
if (-not $keepData) { Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue }

$left = if ($keepData) { "`n`nYour history and settings are still in $root." } else { '' }
$MB::Show("Jax Coach was removed.$left", 'Uninstall Jax Coach', 'OK', 'Information') | Out-Null
