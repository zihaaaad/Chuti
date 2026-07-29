Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$rect = New-Object System.Drawing.Rectangle(0, 0, 256, 256)
$color1 = [System.Drawing.Color]::FromArgb(46, 139, 87)
$color2 = [System.Drawing.Color]::FromArgb(26, 86, 52)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $color1, $color2, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
$g.FillEllipse($brush, 0, 0, 256, 256)
$font = New-Object System.Drawing.Font("Arial", 160, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$rectF = New-Object System.Drawing.RectangleF(0, 0, 256, 256)
$g.DrawString("C", $font, $textBrush, $rectF, $format)
$bmp.Save("E:\Development\Chuti\public\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
