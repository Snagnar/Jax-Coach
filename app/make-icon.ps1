# Draws the Jax Coach icon (Jax's lamppost on a violet tile) and writes app\jax-coach.ico
# with 16-256 px sizes. Small sizes are stored as classic bitmaps, 128/256 as PNG.
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'jax-coach.ico'

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}

function Draw-Logo([int]$s) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([System.Drawing.Color]::Transparent)
  $small = $s -le 24
  $m = if ($small) { 0 } else { $s * 0.04 }
  $tile = New-RoundRect $m $m ($s - 2 * $m) ($s - 2 * $m) ($s * 0.22)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.PointF(0, 0)), (New-Object System.Drawing.PointF($s, $s)),
    [System.Drawing.Color]::FromArgb(255, 52, 38, 102), [System.Drawing.Color]::FromArgb(255, 16, 13, 30))
  $g.FillPath($bg, $tile)
  if (-not $small) { $g.DrawPath((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(140, 150, 120, 255), [Math]::Max(1, $s * 0.012))), $tile) }

  # Jax's weapon: a street lamp. Post on the left, curved top, lantern hanging on the right.
  $px = $s * 0.38; $top = $s * 0.30; $hx = $s * 0.66
  $lw = if ($small) { $s * 0.30 } else { $s * 0.20 }; $lh = if ($small) { $s * 0.26 } else { $s * 0.19 }
  $ly = $top + $(if ($small) { $s * 0.05 } else { $s * 0.08 })               # lantern top
  $glowC = New-Object System.Drawing.PointF($hx, ($ly + $lh / 2))
  if (-not $small) {
    $glow = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gr = $s * 0.30; $glow.AddEllipse($glowC.X - $gr, $glowC.Y - $gr, 2 * $gr, 2 * $gr)
    $pb = New-Object System.Drawing.Drawing2D.PathGradientBrush($glow)
    $pb.CenterColor = [System.Drawing.Color]::FromArgb(170, 255, 214, 120); $pb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 214, 120))
    $g.FillPath($pb, $glow)
  }
  $w = if ($small) { $s * 0.13 } else { $s * 0.075 }
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 190, 168, 255), $w)
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $post = New-Object System.Drawing.Drawing2D.GraphicsPath
  $post.AddLine($px, ($s * 0.86), $px, $top)
  $r = ($hx - $px) / 2
  $post.AddArc($px, ($top - $r), (2 * $r), (2 * $r), 180, 180)              # the curved top
  $post.AddLine($hx, $top, $hx, $ly)                                        # the hanger
  $g.DrawPath($pen, $post)
  if (-not $small) { $g.DrawLine($pen, ($px - $s * 0.12), ($s * 0.86), ($px + $s * 0.12), ($s * 0.86)) }   # foot
  # the lantern
  $gold = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 245, 206, 110))
  $lantern = New-RoundRect ($hx - $lw / 2) $ly $lw $lh ($lw * 0.28)
  $g.FillPath($gold, $lantern)
  if (-not $small) {
    $g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 255, 248, 222))), ($hx - $lw * 0.22), ($ly + $lh * 0.2), ($lw * 0.44), ($lh * 0.5))
    $cap = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 150, 120, 60), [Math]::Max(1, $s * 0.018))
    $g.DrawPath($cap, $lantern)
  }
  $g.Dispose()
  return $bmp
}

function Get-Dib([System.Drawing.Bitmap]$bmp) {
  $s = $bmp.Width
  $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
  $data = $bmp.LockBits($rect, 'ReadOnly', [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $px = New-Object byte[] ($data.Stride * $s)
  [Runtime.InteropServices.Marshal]::Copy($data.Scan0, $px, 0, $px.Length)
  $bmp.UnlockBits($data)
  $ms = New-Object IO.MemoryStream; $bw = New-Object IO.BinaryWriter($ms)
  $maskRow = [int]([Math]::Ceiling($s / 32.0) * 4)
  $bw.Write([int]40); $bw.Write([int]$s); $bw.Write([int]($s * 2)); $bw.Write([int16]1); $bw.Write([int16]32)
  $bw.Write([int]0); $bw.Write([int]($s * $s * 4 + $maskRow * $s)); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0)
  for ($y = $s - 1; $y -ge 0; $y--) { $bw.Write($px, $y * $data.Stride, $s * 4) }   # bottom-up BGRA
  $bw.Write((New-Object byte[] ($maskRow * $s)))                                      # AND mask (alpha does the work)
  $bw.Flush(); return , $ms.ToArray()     # the comma keeps PowerShell from unrolling the bytes
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$images = New-Object System.Collections.Generic.List[byte[]]
foreach ($s in $sizes) {
  $bmp = Draw-Logo $s
  if ($s -ge 128) { $ms = New-Object IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $images.Add($ms.ToArray()) }
  else { $images.Add([byte[]](Get-Dib $bmp)) }
  if ($s -eq 256) { $bmp.Save((Join-Path $PSScriptRoot 'jax-coach.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  $bmp.Dispose()
}
$fs = [IO.File]::Create($out); $bw = New-Object IO.BinaryWriter($fs)
$bw.Write([int16]0); $bw.Write([int16]1); $bw.Write([int16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $len = $images[$i].Length
  $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s })); $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))
  $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([int16]1); $bw.Write([int16]32); $bw.Write([int]$len); $bw.Write([int]$offset)
  $offset += $len
}
foreach ($img in $images) { $bw.Write($img) }
$bw.Close()
Write-Host "Icon written: $out"
