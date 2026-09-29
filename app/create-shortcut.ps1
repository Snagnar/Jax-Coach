# Creates (or updates) the "Jax Coach" shortcut on the desktop and in the Start menu.
#   -NoDesktop: Start menu only (the installer's "Desktop shortcut" box unticked)
param([switch]$NoDesktop)
$root = Split-Path -Parent $PSScriptRoot
$sh = New-Object -ComObject WScript.Shell
$dirs = @([Environment]::GetFolderPath('Programs'))
if (-not $NoDesktop) { $dirs = @([Environment]::GetFolderPath('Desktop')) + $dirs }
foreach ($dir in $dirs) {
  $l = $sh.CreateShortcut((Join-Path $dir 'Jax Coach.lnk'))
  $l.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $l.Arguments = '"' + (Join-Path $root 'Jax Coach.vbs') + '"'
  $l.WorkingDirectory = $root
  $l.IconLocation = (Join-Path $PSScriptRoot 'jax-coach.ico') + ',0'
  $l.Description = 'Jax Coach: live coaching, game reports and matchup prep'
  $l.Save()
  Write-Host "Shortcut: $($l.FullName)"
}
