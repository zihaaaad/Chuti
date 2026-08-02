Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$rect = New-Object System.Drawing.Rectangle(0, 0, 256, 256)
$color1 = [System.Drawing.Color]::FromArgb(46, 139, 87)
$color2 = [System.Drawing.Color]::FromArgb(26, 86, 52)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $color1, $color2, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)

# Draw Rounded Rectangle (rx = 60 / 256 px to match SVG rx="120" / 512 px)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 60
$path.AddArc(0, 0, $r*2, $r*2, 180, 90)
$path.AddArc(256 - $r*2, 0, $r*2, $r*2, 270, 90)
$path.AddArc(256 - $r*2, 256 - $r*2, $r*2, $r*2, 0, 90)
$path.AddArc(0, 256 - $r*2, $r*2, $r*2, 90, 90)
$path.CloseAllFigures()

$g.FillPath($brush, $path)

# Draw letter C with Segoe UI (highly crisp and modern font on Windows)
$font = New-Object System.Drawing.Font("Segoe UI", 150, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center

# Slight offset to visual center the letter C perfectly
$rectF = New-Object System.Drawing.RectangleF(-5, 5, 266, 256)
$g.DrawString("C", $font, $textBrush, $rectF, $format)

$bmp.Save("E:\Development\Chuti\public\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
