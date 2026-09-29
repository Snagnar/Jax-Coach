# Jax Coach desktop launcher: starts the server without a console window, shows a tray icon
# (click: open Jax Coach, right-click: menu / quit) and opens the app in your default browser.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root 'logs'
$IconPath = Join-Path $PSScriptRoot 'jax-coach.ico'

$port = 8787
try { $c = Get-Content (Join-Path $Root 'config.json') -Raw | ConvertFrom-Json; if ($c.port) { $port = [int]$c.port } } catch {}
$Url = "http://localhost:$port/"
function Test-Up { try { (Invoke-WebRequest -UseBasicParsing "$($Url)api/config" -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }
function Open-App { Start-Process $Url }

# one tray icon only: a second click on the shortcut just opens the page
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\JaxCoachTray', [ref]$createdNew)
if (-not $createdNew -or (Test-Up)) { Open-App; exit }

New-Item -ItemType Directory -Force $LogDir | Out-Null
function Start-Server {
  $env:JAXCOACH_NO_BROWSER = '1'
  $script:Server = Start-Process powershell.exe -PassThru -WindowStyle Hidden `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $Root 'server.ps1')`"") `
    -RedirectStandardOutput (Join-Path $LogDir 'server.log') -RedirectStandardError (Join-Path $LogDir 'server-errors.log')
}
function Stop-Server { if ($script:Server -and -not $script:Server.HasExited) { try { Stop-Process -Id $script:Server.Id -Force } catch {} } }
function Wait-Up { for ($i = 0; $i -lt 40; $i++) { if (Test-Up) { return $true }; Start-Sleep -Milliseconds 400 }; return $false }

Start-Server
$ok = Wait-Up

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = New-Object System.Drawing.Icon($IconPath, [System.Windows.Forms.SystemInformation]::SmallIconSize)
$tray.Text = 'Jax Coach'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$mOpen = $menu.Items.Add('Open Jax Coach'); $mOpen.Font = New-Object System.Drawing.Font($mOpen.Font, [System.Drawing.FontStyle]::Bold)
$mOpen.add_Click({ Open-App })
$mRestart = $menu.Items.Add('Restart server')
$mRestart.add_Click({
  Stop-Server; Start-Sleep -Milliseconds 600; Start-Server
  if (Wait-Up) { $tray.ShowBalloonTip(2500, 'Jax Coach', 'Server restarted.', 'Info') }
  else { $tray.ShowBalloonTip(5000, 'Jax Coach', 'The server did not come back. See "Show log".', 'Warning') }
})
$mLog = $menu.Items.Add('Show log')
$mLog.add_Click({ $f = Join-Path $LogDir 'server-errors.log'; if (-not (Test-Path $f) -or (Get-Item $f).Length -eq 0) { $f = Join-Path $LogDir 'server.log' }; Start-Process notepad.exe "`"$f`"" })
$null = $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$mQuit = $menu.Items.Add('Quit Jax Coach')
$mQuit.add_Click({ Stop-Server; $tray.Visible = $false; $tray.Dispose(); [System.Windows.Forms.Application]::Exit() })
$tray.ContextMenuStrip = $menu
$tray.add_MouseClick({ if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Open-App } })
$tray.Visible = $true

# if the server stops on its own, say so (once) and offer the restart
$watch = New-Object System.Windows.Forms.Timer
$watch.Interval = 5000
$watch.add_Tick({
  if ($script:Server.HasExited -and -not $script:warned) {
    $script:warned = $true; $tray.Text = 'Jax Coach (server stopped)'
    $tray.ShowBalloonTip(6000, 'Jax Coach', 'The server stopped. Right-click the icon: Restart server.', 'Warning')
  } elseif (-not $script:Server.HasExited) { $script:warned = $false; $tray.Text = 'Jax Coach (running)' }
})
$watch.Start()

if ($ok) {
  $tray.Text = 'Jax Coach (running)'
  Open-App
  $tray.ShowBalloonTip(3500, 'Jax Coach is running', 'Click this icon to open it again. Right-click to quit.', 'Info')
} else {
  $tray.ShowBalloonTip(6000, 'Jax Coach', 'The server did not start. Right-click the icon: Show log.', 'Warning')
}

[System.Windows.Forms.Application]::Run()
Stop-Server
$mutex.ReleaseMutex()
