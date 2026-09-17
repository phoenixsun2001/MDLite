# 移除 MDLite 的文件关联注册
$ProgId = "MDLite.Document"
$base = "HKCU:\Software\Classes"

foreach ($ext in @(".md", ".markdown", ".mdown", ".mkd")) {
    $p = "$base\$ext\OpenWithProgids"
    if (Test-Path $p) {
        Remove-ItemProperty -Path $p -Name $ProgId -ErrorAction SilentlyContinue
    }
}
if (Test-Path "$base\$ProgId") {
    Remove-Item -Path "$base\$ProgId" -Recurse -Force
}
Write-Host "已移除 MDLite 文件关联。"
