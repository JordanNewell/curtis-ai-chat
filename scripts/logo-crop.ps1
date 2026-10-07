# Crop the Curtis "C" logo to a centered square, downscale, compress.
# Pipeline: assets/logo-source.jpg (master) -> this script -> assets/logo-square.jpg
#           -> scripts/inline-logo.mjs -> src/styles.css data URI.
# When the designer's final master lands, replace logo-source.jpg and re-run both.
param(
    [string]$In = "$PSScriptRoot\..\assets\logo-source.jpg",
    [string]$Out = "$PSScriptRoot\..\assets\logo-square.jpg",
    [int]$Size = 288,
    # Derive a light variant from this (dark) source. Placeholder workflow:
    # derive. Designer-master workflow: run the script a second time on the
    # light master with -Out logo-square-light.jpg -NoDeriveLight.
    [switch]$NoDeriveLight
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile($In)

# Downscale probe copy for fast bbox scanning.
$pw = 144; $ph = [int](144 * $src.Height / $src.Width)
$probe = New-Object System.Drawing.Bitmap($pw, $ph)
$g = [System.Drawing.Graphics]::FromImage($probe)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, $pw, $ph)

$minx = $pw; $miny = $ph; $maxx = -1; $maxy = -1
$maxLum = -1; $maxPixel = $null
for ($y = 0; $y -lt $ph; $y++) {
    for ($x = 0; $x -lt $pw; $x++) {
        $c = $probe.GetPixel($x, $y)
        $lum = [int]$c.R + [int]$c.G + [int]$c.B
        if ($lum -gt $maxLum) { $maxLum = $lum; $maxPixel = $c }
        if ($lum -gt 90) {
            if ($x -lt $minx) { $minx = $x }
            if ($x -gt $maxx) { $maxx = $x }
            if ($y -lt $miny) { $miny = $y }
            if ($y -gt $maxy) { $maxy = $y }
        }
    }
}
$g.Dispose(); $probe.Dispose()

if ($maxx -lt 0) { throw 'No non-black pixels found' }

# Map bbox back to source pixels.
$sx = $src.Width / $pw; $sy = $src.Height / $ph
$bx = $minx * $sx; $by = $miny * $sy
$bw = ($maxx - $minx + 1) * $sx; $bh = ($maxy - $miny + 1) * $sy

# Square crop: bbox + 16% padding per side, centered on bbox center, clamped.
$side = [Math]::Max($bw, $bh) * 1.32
$cx = $bx + $bw / 2; $cy = $by + $bh / 2
$cx0 = [Math]::Max(0, [Math]::Min($src.Width - $side, $cx - $side / 2))
$cy0 = [Math]::Max(0, [Math]::Min($src.Height - $side, $cy - $side / 2))
$side = [Math]::Min($side, [Math]::Min($src.Width, $src.Height))

Write-Host ("bbox: {0:N0}x{1:N0} at ({2:N0},{3:N0})  crop side: {4:N0}  brightest: #{5:X2}{6:X2}{7:X2}" -f $bw, $bh, $bx, $by, $side, $maxPixel.R, $maxPixel.G, $maxPixel.B)

# Crop, resize, save JPEG.
$crop = New-Object System.Drawing.Bitmap([int]$side, [int]$side)
$gc = [System.Drawing.Graphics]::FromImage($crop)
$gc.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gc.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $crop.Width, $crop.Height)), (New-Object System.Drawing.Rectangle([int]$cx0, [int]$cy0, [int]$side, [int]$side)), [System.Drawing.GraphicsUnit]::Pixel)
$gc.Dispose()

$out2 = New-Object System.Drawing.Bitmap($Size, $Size)
$gr = [System.Drawing.Graphics]::FromImage($out2)
$gr.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gr.DrawImage($crop, 0, 0, $Size, $Size)
$gr.Dispose(); $crop.Dispose(); $src.Dispose()

$jcodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]82)

# Pixel remap on the 288px master, via LockBits (288*3 bytes/row is 4-aligned,
# so Stride has no padding):
#  - dark master: snap near-black background to NEWELL soft black #0A0A0A
#  - light master: lift dark pixels toward warm off-white #F5F5F3, keep the
#    green mark (per-pixel lerp keyed to brightness) — theme-light variant.
$rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
$bmpData = $out2.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$bytes = New-Object byte[] ($bmpData.Stride * $Size)
[System.Runtime.InteropServices.Marshal]::Copy($bmpData.Scan0, $bytes, 0, $bytes.Length)
$light = New-Object byte[] ($bytes.Length)
for ($i = 0; $i -lt $bytes.Length; $i += 3) {
    # Format24bppRgb layout is B,G,R per pixel.
    $b = [int]$bytes[$i]; $g = [int]$bytes[$i + 1]; $r = [int]$bytes[$i + 2]
    $mx = [Math]::Max($r, [Math]::Max($g, $b))
    if ($mx -lt 30) { $bytes[$i] = 10; $bytes[$i + 1] = 10; $bytes[$i + 2] = 10 }
    $k = $mx / 255.0
    $light[$i]     = [byte]($b + (245 - $b) * (1 - $k))
    $light[$i + 1] = [byte]($g + (245 - $g) * (1 - $k))
    $light[$i + 2] = [byte]($r + (245 - $r) * (1 - $k))
}
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $bmpData.Scan0, $bytes.Length)
$out2.UnlockBits($bmpData)

$out2.Save($Out, $jcodec, $ep)
$out2.Dispose()

$lightOut = $Out -replace '\.jpg$', '-light.jpg'
if (-not $NoDeriveLight) {
    $lightBmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $ld = $lightBmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    [System.Runtime.InteropServices.Marshal]::Copy($light, 0, $ld.Scan0, $light.Length)
    $lightBmp.UnlockBits($ld)
    $lightBmp.Save($lightOut, $jcodec, $ep)
    $lightBmp.Dispose()
}

$bytesOut = (Get-Item $Out).Length
Write-Host ("wrote {0}  {1:N0} bytes" -f $Out, $bytesOut)
if (-not $NoDeriveLight) {
    Write-Host ("wrote {0}  {1:N0} bytes" -f $lightOut, (Get-Item $lightOut).Length)
}
