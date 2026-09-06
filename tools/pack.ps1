# 打包分发用 zip：单文件版 + 源码版
# 用法: powershell -NoProfile -File tools/pack.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd'
$dist = Join-Path $root 'dist'
$out  = Join-Path $dist "pack-单文件-$stamp.zip"
$out2 = Join-Path $dist "pack-源码版-$stamp.zip"

# 先清掉旧包（Compress-Archive 不会覆盖）
Get-ChildItem $dist -Filter 'pack-*.zip' -File -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item $_.FullName -Force
}

$html = Get-ChildItem $dist -Filter '*.html' | Select-Object -First 1
if (-not $html) { throw 'dist 下没有 HTML 产物，请先运行 node tools/build.mjs' }

Compress-Archive -LiteralPath $html.FullName -DestinationPath $out -CompressionLevel Optimal
Compress-Archive -Path (Join-Path $root 'dist-src/*') -DestinationPath $out2 -CompressionLevel Optimal

Get-Item $out, $out2 | ForEach-Object {
    "{0,-34} {1,8:N2} MB" -f $_.Name, ($_.Length / 1MB)
}