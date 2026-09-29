# Sets up the local voice (Kokoro-82M) in this folder: uv, a private Python 3.12, kokoro-onnx and the model files.
# Nothing is installed system-wide; delete voice\.venv, voice\python, voice\bin and voice\models to remove it again.
# Safe to run again: finished parts are skipped. Downloads about 420 MB (about 550 MB on disk).
#   powershell -ExecutionPolicy Bypass -File voice\setup-voice.ps1
# Output lines "STEP n/4 ..." and "PROGRESS p" (0-100) are read by the installer.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$V = $PSScriptRoot
$Uv = Join-Path $V 'bin\uv.exe'
$Py = Join-Path $V '.venv\Scripts\python.exe'
$ModelUrl = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0'
$Models = @(
  @{ Name = 'kokoro-v1.0.onnx'; MinBytes = 300MB; From = 40; To = 90 },
  @{ Name = 'voices-v1.0.bin';  MinBytes = 25MB;  From = 90; To = 97 }
)

function Progress([int]$p) { Write-Output "PROGRESS $p" }

# download to a .part file first, so a broken download is never mistaken for a finished one
function Get-File($url, $out, [int]$from, [int]$to) {
  $req = [Net.HttpWebRequest]::Create($url)
  $req.UserAgent = 'JaxCoach-setup'
  $res = $req.GetResponse()
  $total = $res.ContentLength
  $in = $res.GetResponseStream()
  $part = "$out.part"
  $fs = [IO.File]::Create($part)
  try {
    $buf = New-Object byte[] 262144
    $done = 0L; $last = -1
    while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
      $fs.Write($buf, 0, $n); $done += $n
      if ($total -gt 0) {
        $p = [int]($from + ($to - $from) * $done / $total)
        if ($p -ne $last) { Progress $p; $last = $p }
      }
    }
  } finally { $fs.Close(); $in.Close(); $res.Close() }
  Move-Item -Force $part $out
}

# runs a program, passes its output (stderr too, as plain text) on, and returns its exit code;
# PowerShell 5.1 would otherwise turn stderr lines into errors when the installer reads our output
function Invoke-Native([scriptblock]$cmd, [switch]$Quiet) {
  $ErrorActionPreference = 'Continue'
  & $cmd 2>&1 | ForEach-Object { if (-not $Quiet) { Write-Host "$_" } }
  return $LASTEXITCODE
}
function Check([int]$code, $what) { if ($code -ne 0) { throw "$what failed (exit code $code)" } }

try {
  Write-Output 'STEP 1/4 Getting uv (Python installer)'
  Progress 1
  if (-not (Test-Path $Uv)) {
    New-Item -ItemType Directory -Force (Join-Path $V 'bin') | Out-Null
    $zip = Join-Path $V 'bin\uv.zip'
    Get-File 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' $zip 1 5
    Expand-Archive $zip -DestinationPath (Join-Path $V 'bin') -Force -ErrorAction Stop
    Remove-Item $zip
  } else { Write-Output 'uv is already there.' }
  Progress 5

  Write-Output 'STEP 2/4 Installing a private Python 3.12 and kokoro-onnx'
  $env:UV_PYTHON_INSTALL_DIR = Join-Path $V 'python'
  $env:UV_CACHE_DIR = Join-Path $V '.uv-cache'
  $env:UV_PYTHON_PREFERENCE = 'only-managed'
  $env:UV_NO_PROGRESS = '1'
  if (-not (Test-Path $Py)) {
    Check (Invoke-Native { & $Uv venv --python 3.12 (Join-Path $V '.venv') }) 'Creating the Python environment'
  }
  Progress 20
  $have = (Invoke-Native { & $Py -c 'import kokoro_onnx' } -Quiet) -eq 0
  if (-not $have) {
    Check (Invoke-Native { & $Uv pip install --python $Py --link-mode copy 'kokoro-onnx==0.6.1' }) 'Installing kokoro-onnx'
  } else { Write-Output 'kokoro-onnx is already installed.' }
  if (Test-Path $env:UV_CACHE_DIR) { Remove-Item -Recurse -Force $env:UV_CACHE_DIR -ErrorAction SilentlyContinue }
  Progress 40

  Write-Output 'STEP 3/4 Downloading the voice model (about 340 MB)'
  New-Item -ItemType Directory -Force (Join-Path $V 'models') | Out-Null
  foreach ($m in $Models) {
    $out = Join-Path $V "models\$($m.Name)"
    if ((Test-Path $out) -and (Get-Item $out).Length -ge $m.MinBytes) { Write-Output "$($m.Name) is already there."; continue }
    Write-Output "Downloading $($m.Name)..."
    Get-File "$ModelUrl/$($m.Name)" $out $m.From $m.To
  }
  Progress 97

  Write-Output 'STEP 4/4 Checking'
  Check (Invoke-Native { & $Py -c "import kokoro_onnx, onnxruntime; print('kokoro-onnx ok, onnxruntime', onnxruntime.__version__)" }) 'Loading kokoro-onnx'
  Progress 100
  Write-Output 'The local voice is ready. Restart Jax Coach to use it.'
  exit 0
} catch {
  Write-Output "ERROR $($_.Exception.Message)"
  exit 1
}
