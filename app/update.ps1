# Jax Coach updater: the latest version is the main branch on GitHub.
#   -Check   prints JSON: the build you run (app\build.json), the newest commit on GitHub, whether an update is there
#   -Apply   clones main into %TEMP%, builds the installer from it, then hands over to -Finish (run from %TEMP%)
#   -Finish  closes Jax Coach (tray, server, voice, agent runs) and runs that installer with /auto: your settings,
#            keys, history, archive and playbooks stay, only the app files are replaced; it starts Jax Coach again
# Needs git and access to the repository (the same access you use to pull or push).
# Progress goes to logs\update.log and logs\update-status.json (the page shows it).
param([switch]$Check, [switch]$Apply, [switch]$Finish, [string]$Setup = '')
$ErrorActionPreference = 'Stop'
# -Finish runs from a copy in %TEMP% and gets the install folder from the environment: the installer refuses to run
# while any PowerShell has the install folder in its command line
$Root = if ($env:JAXCOACH_ROOT) { $env:JAXCOACH_ROOT } else { Split-Path -Parent $PSScriptRoot }
$LogDir = Join-Path $Root 'logs'
$BuildInfo = Join-Path $Root 'app\build.json'
$Work = Join-Path $env:TEMP 'JaxCoachUpdate'
New-Item -ItemType Directory -Force $LogDir | Out-Null

function Log([string]$m) { Add-Content -Path (Join-Path $LogDir 'update.log') -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $m) -Encoding UTF8 }
function Set-Status([string]$state, [string]$message) {
  Log "$state $message"
  $j = [ordered]@{ state = $state; message = $message; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path $LogDir 'update-status.json'), $j)
}
function Get-Build { if (Test-Path $BuildInfo) { Get-Content $BuildInfo -Raw | ConvertFrom-Json } else { $null } }
function Find-Git {
  $g = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($g) { return $g.Source }
  foreach ($p in @("$env:ProgramFiles\Git\cmd\git.exe", "${env:ProgramFiles(x86)}\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe")) { if (Test-Path $p) { return $p } }
  throw 'Updating needs Git (git-scm.com), with access to the Jax Coach repository.'
}
# git with a time limit and without prompts (a prompt would hang a hidden window)
function Invoke-Git([string[]]$argv, [int]$timeoutSec = 60, [string]$cwd = $env:TEMP) {
  $psi = New-Object Diagnostics.ProcessStartInfo (Find-Git)
  $psi.Arguments = ($argv | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.WorkingDirectory = $cwd
  $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
  $p = [Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync(); $err = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($timeoutSec * 1000)) { try { $p.Kill() } catch {}; throw "git $($argv[0]) took too long (no network or no access to the repository?)" }
  if ($p.ExitCode -ne 0) { throw "git $($argv[0]) failed: $($err.Result.Trim())" }
  return $out.Result.Trim()
}
function Get-Latest($b) {
  $line = Invoke-Git @('ls-remote', $b.repo, "refs/heads/$($b.branch)") 30
  if (-not $line) { throw "Branch $($b.branch) not found in $($b.repo)." }
  return ($line -split '\s+')[0]
}
function Test-InGame {
  $port = 8787
  try { $c = Get-Content (Join-Path $Root 'config.json') -Raw | ConvertFrom-Json; if ($c.port) { $port = [int]$c.port } } catch {}
  try { return (Invoke-WebRequest -UseBasicParsing "http://localhost:$port/api/live" -TimeoutSec 4).Content -match '"activePlayer"' } catch { return $false }
}

# ---------------- -Check ----------------
if ($Check) {
  $b = Get-Build
  $out = [ordered]@{ current = $b; latest = $null; available = $false; error = $null }
  try {
    if (-not $b -or -not $b.repo) { throw 'This copy has no build information (a development copy): update it with git pull.' }
    $out.latest = Get-Latest $b
    $out.available = $out.latest -ne $b.commit
  } catch { $out.error = $_.Exception.Message }
  $out | ConvertTo-Json -Compress -Depth 4
  exit 0
}

# ---------------- -Apply: download and build while Jax Coach keeps running ----------------
if ($Apply) {
  try {
    if (Test-InGame) { throw 'You are in a game. Update after it.' }
    $b = Get-Build
    if (-not $b -or -not $b.repo) { throw 'This copy has no build information (a development copy): update it with git pull.' }
    Set-Status 'downloading' 'Downloading the latest version from GitHub...'
    # a process started from the old folder can keep it locked: then use a fresh one (old ones are cleaned up later)
    if (Test-Path $Work) { try { Remove-Item $Work -Recurse -Force -ErrorAction Stop } catch { $Work = Join-Path $env:TEMP ('JaxCoachUpdate-' + (Get-Date -Format 'yyyyMMddHHmmss')) } }
    Get-ChildItem $env:TEMP -Directory -Filter 'JaxCoachUpdate-*' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -ne $Work } | ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Force $Work | Out-Null
    $src = Join-Path $Work 'src'
    Invoke-Git @('clone', '--depth', '1', '--branch', $b.branch, $b.repo, $src) 180 | Out-Null
    $new = Invoke-Git @('log', '-1', '--format=%H|%cI|%s') 20 $src
    $sha, $date, $subject = $new -split '\|', 3
    if ($sha -eq $b.commit -and -not $b.dirty) { Set-Status 'current' 'Already up to date.'; exit 0 }
    # a local build newer than GitHub (made from unpushed changes) is not replaced by an older one
    if ($b.commitDate -and ([DateTimeOffset]::Parse($date) -lt [DateTimeOffset]::Parse($b.commitDate))) {
      Set-Status 'current' "Your version is newer than the one on GitHub ($($sha.Substring(0, 7)))."; exit 0
    }
    Set-Status 'building' "Preparing $($sha.Substring(0, 7)): $subject"
    $bo = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $src 'installer\build.ps1') 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Building the installer failed: $($bo | Select-Object -Last 3 | Out-String)" }
    $exe = Join-Path $src 'dist\JaxCoachSetup.exe'
    if (-not (Test-Path $exe)) { throw 'The installer was not built.' }
    # hand over to a copy outside the install folder, which closes Jax Coach and runs the installer
    $finisher = Join-Path $Work 'finish.ps1'
    Copy-Item (Join-Path $src 'app\update.ps1') $finisher -Force
    Set-Status 'installing' 'Closing Jax Coach and installing the update...'
    $env:JAXCOACH_ROOT = $Root
    Start-Process powershell.exe -WindowStyle Hidden -WorkingDirectory $env:TEMP -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$finisher`"", '-Finish', '-Setup', "`"$exe`"")
    exit 0
  } catch { Set-Status 'failed' $_.Exception.Message; exit 1 }
}

# ---------------- -Finish: close Jax Coach, run the installer ----------------
if ($Finish) {
  try {
    Start-Sleep -Seconds 1
    $needle = $Root.TrimEnd('\') + '\'
    $mine = { param($p) $p.ProcessId -ne $PID -and $p.CommandLine -and $p.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
    for ($i = 0; $i -lt 10; $i++) {
      $procs = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pythonw.exe' OR Name='python.exe'" | Where-Object { & $mine $_ })
      if (-not $procs.Count) { break }
      foreach ($p in $procs) { Log "closing $($p.Name) $($p.ProcessId)"; Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Milliseconds 800
    }
    $setupArgs = @("/auto", "/novoice", "/noclaude", "/close")
    $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Jax Coach.lnk'
    if (-not (Test-Path $desktop)) { $setupArgs += "/nodesktop" }
    Log "running $Setup $($setupArgs -join " ")"
    Start-Process $Setup -ArgumentList $setupArgs -WorkingDirectory $env:TEMP
    Set-Status 'done' 'The installer is running; Jax Coach starts again when it is done.'
  } catch { Set-Status 'failed' $_.Exception.Message; exit 1 }
}
