param()
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Size($p) {
  if (Test-Path $p -PathType Leaf) { return (Get-Item $p).Length }
  return (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
}
function Cnt($p) {
  if (Test-Path $p -PathType Leaf) { return 1 }
  return (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue).Count
}

$rows = @(
  @('README.md',        '必需',  '上传', '项目说明'),
  @('src',              '必需',  '上传', '可维护源码 shell/player/data'),
  @('tools',            '必需',  '上传', '构建脚本，缺了无法重建'),
  @('package.json',     '必需',  '上传', '声明 devDependency'),
  @('package-lock.json','建议',  '上传', '锁版本保证可复现'),
  @('方程式',            '素材',  '上传', '289张原图 + md勘误，溯源依据'),
  @('网页',              '数据源','上传', 'skill产出的32个原始HTML，重建数据源'),
  @('dist',             '产物',  '上传', '单文件HTML + 2个zip，即开即用'),
  @('dist-src',         '产物',  '可选', '与 src+tools 重复，可构建生成'),
  @('_vendor',          '产物',  '可选', '下载的依赖，可 fetch-vendor 重建'),
  @('_smoke',           '临时',  '不传', '测试脚本+截图，含本机绝对路径'),
  @('node_modules',     '依赖',  '不传', '17.7MB，应 gitignore'),
  @('_diff',            '临时',  '不传', '已删')
)

Write-Output '=== 上传必要性审查 ==='
'{0,-20} {1,-6} {2,-5} {3,10} {4,6}  {5}' -f '路径','类别','建议','大小','文件数','理由'
Write-Output ('-' * 96)
$up=0; $skip=0
foreach ($r in $rows) {
  $p = Join-Path $root $r[0]
  if (-not (Test-Path $p)) { continue }
  $sz = Size $p; $c = Cnt $p
  if ($r[2] -eq '不传') { $skip += $sz } else { $up += $sz }
  '{0,-20} {1,-6} {2,-5} {3,10} {4,6}  {5}' -f $r[0],$r[1],$r[2],("{0:N2} MB" -f ($sz/1MB)),$c,$r[3]
}
Write-Output ('-' * 96)
$opt = (Size (Join-Path $root 'dist-src')) + (Size (Join-Path $root '_vendor'))
'{0,-20} {1,-6} {2,-5} {3,10}' -f '必传合计','','',("{0:N2} MB" -f (($up-$opt)/1MB))
'{0,-20} {1,-6} {2,-5} {3,10}' -f '可选合计','','',("{0:N2} MB" -f ($opt/1MB))
'{0,-20} {1,-6} {2,-5} {3,10}' -f '排除合计','','',("{0:N2} MB" -f ($skip/1MB))
''
Write-Output '=== 建议 .gitignore ==='
Write-Output '  node_modules/'
Write-Output '  _smoke/'
Write-Output '  _diff/'