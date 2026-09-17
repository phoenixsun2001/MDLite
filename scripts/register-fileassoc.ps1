# 为 MDLite 注册 .md/.markdown 文件关联（当前用户级，无需管理员）
# 用法: powershell -ExecutionPolicy Bypass -File register-fileassoc.ps1 [-ExePath <MDLite.exe 完整路径>]
param(
    [string]$ExePath = ""
)

if (-not $ExePath) {
    $candidates = @(
        (Join-Path $PSScriptRoot "..\src-tauri\target\release\mdlite.exe"),
        (Join-Path $PSScriptRoot "..\dist\mdlite.exe")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $ExePath = (Resolve-Path $c).Path; break }
    }
}
if (-not $ExePath -or -not (Test-Path $ExePath)) {
    Write-Error "未找到 mdlite.exe，请用 -ExePath 指定路径"
    exit 1
}

$ProgId = "MDLite.Document"
$base = "HKCU:\Software\Classes"

New-Item -Path "$base\$ProgId" -Force | Out-Null
Set-ItemProperty -Path "$base\$ProgId" -Name "(Default)" -Value "Markdown 文档 (MDLite)"
New-Item -Path "$base\$ProgId\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "$base\$ProgId\DefaultIcon" -Name "(Default)" -Value "$ExePath,0"
New-Item -Path "$base\$ProgId\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$base\$ProgId\shell\open\command" -Name "(Default)" -Value "`"$ExePath`" `"%1`""

foreach ($ext in @(".md", ".markdown", ".mdown", ".mkd")) {
    New-Item -Path "$base\$ext\OpenWithProgids" -Force | Out-Null
    Set-ItemProperty -Path "$base\$ext\OpenWithProgids" -Name $ProgId -Value "" -Type String
}

Write-Host "已注册: $ExePath"
Write-Host "下一步: 在任意 .md 文件上 右键 → 打开方式 → 选择 MDLite → 勾选『始终』"
Write-Host "撤销:  powershell -ExecutionPolicy Bypass -File unregister-fileassoc.ps1"
