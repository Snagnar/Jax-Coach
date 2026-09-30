# Builds dist\JaxCoachSetup.exe: packs the app files into app.zip and compiles Installer.cs around it with the
# C# compiler that ships with Windows (.NET Framework 4.x). No SDK or extra tools needed.
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1 [-Version 1.0.1]
param([string]$Version = (Get-Content (Join-Path $PSScriptRoot 'version.txt') -Raw).Trim())
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$Root = Split-Path -Parent $PSScriptRoot
$Obj = Join-Path $PSScriptRoot 'obj'
$Dist = Join-Path $Root 'dist'
New-Item -ItemType Directory -Force $Obj, $Dist | Out-Null

# what goes in: the app, never your settings, keys, history, caches or the downloaded voice
$include = @('server.ps1', 'README.md', 'LICENSE', 'Jax Coach.vbs', 'Create desktop shortcut.bat', 'Start Jax Coach.bat',
  'Install local voice.bat', 'app\*', 'data\*', 'data\champions\*\*', 'agents\*', 'agents\prompts\*', 'public\*', 'voice\*.py', 'voice\*.ps1')
$files = foreach ($pat in $include) { Get-ChildItem (Join-Path $Root $pat) -File -ErrorAction SilentlyContinue }
$files = $files | Sort-Object FullName -Unique

# app\build.json: the commit this was built from, so the updater can compare it with GitHub (only in the installer)
$git = { param([string[]]$a) try { $o = & git -C $Root @a 2>$null; if ($LASTEXITCODE -eq 0) { "$o".Trim() } else { '' } } catch { '' } }
$build = [ordered]@{
  version = $Version; commit = (& $git @('rev-parse', 'HEAD')); commitDate = (& $git @('log', '-1', '--format=%cI'))
  dirty = [bool](& $git @('status', '--porcelain')); repo = (& $git @('remote', 'get-url', 'origin'))
  branch = $(if (($br = & $git @('rev-parse', '--abbrev-ref', 'HEAD')) -and $br -ne 'HEAD') { $br } else { 'main' }); builtAt = (Get-Date).ToString('o')
}
$buildJson = Join-Path $Obj 'build.json'
[IO.File]::WriteAllText($buildJson, ($build | ConvertTo-Json -Compress))

$zipPath = Join-Path $Obj 'app.zip'
if (Test-Path $zipPath) { Remove-Item $zipPath }
$zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($Root.Length + 1).Replace('\', '/')
    if ($rel -eq 'app/build.json') { continue }
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, 'Optimal')
  }
  [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $buildJson, 'app/build.json', 'Optimal')
} finally { $zip.Dispose() }
[IO.File]::WriteAllText((Join-Path $Obj 'version.txt'), $Version)
Write-Host ("Packed {0} files ({1:N0} KB)" -f @($files).Count, ((Get-Item $zipPath).Length / 1KB))

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$out = Join-Path $Dist 'JaxCoachSetup.exe'
& $csc /nologo /target:winexe /optimize+ /platform:anycpu `
  "/out:$out" `
  "/win32icon:$(Join-Path $Root 'app\jax-coach.ico')" `
  "/win32manifest:$(Join-Path $PSScriptRoot 'app.manifest')" `
  "/resource:$zipPath,app.zip" `
  "/resource:$(Join-Path $Root 'app\jax-coach.ico'),icon.ico" `
  "/resource:$(Join-Path $Obj 'version.txt'),version.txt" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Management.dll `
  (Join-Path $PSScriptRoot 'Installer.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
Write-Host ("Built {0} ({1:N0} KB), version {2}, commit {3}{4}" -f $out, ((Get-Item $out).Length / 1KB), $Version, "$($build.commit)".Substring(0, [Math]::Min(7, "$($build.commit)".Length)), $(if ($build.dirty) { ' + local changes' } else { '' }))
