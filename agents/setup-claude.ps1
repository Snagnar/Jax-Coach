# Installs Claude Code (Anthropic's command-line agent) for the research agents, if it isn't there yet.
# Uses Anthropic's official installer. Signing in happens once, in the app (Playbook tab > Sign in).
# Prints "STEP ..." lines for the setup program.
$ErrorActionPreference = 'Continue'
$exe = Join-Path $HOME '.local\bin\claude.exe'
$found = (Test-Path $exe) -or [bool](Get-Command claude -ErrorAction SilentlyContinue)
if ($found) { Write-Host 'STEP Claude Code is already installed'; exit 0 }
Write-Host 'STEP Installing Claude Code (Anthropic''s official installer)'
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $script = (New-Object Net.WebClient).DownloadString('https://claude.ai/install.ps1')
  Invoke-Expression $script
} catch { Write-Host "ERROR Claude Code could not be installed: $($_.Exception.Message)"; exit 1 }
if (Test-Path $exe) { Write-Host 'STEP Claude Code installed. Sign in once in Jax Coach: Playbook tab > Sign in.'; exit 0 }
Write-Host 'ERROR Claude Code was not found after installing'
exit 1
