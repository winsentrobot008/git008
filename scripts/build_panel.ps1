# 重新编译 AI 控制面板：AIFactoryPanel.cs -> AI控制面板.exe
# 用法： powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_panel.ps1
[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
$source    = Join-Path $scriptDir 'AIFactoryPanel.cs'
$target    = if ([string]::IsNullOrWhiteSpace($OutputPath)) { Join-Path $scriptDir 'AI控制面板.exe' } else { $OutputPath }
$staging   = $target + '.staging'
$legacy    = $target + '.old'

if (-not (Test-Path -LiteralPath $source)) { throw "未找到源码：$source" }

$csc = @(
    (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw '未找到 csc.exe（需要 .NET Framework 4.x）。' }
$references = @('System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll') |
    ForEach-Object { '/reference:' + $_ }
$arguments = @('/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', ('/out:' + $staging)) + $references + @($source)

& $csc $arguments
if ($LASTEXITCODE -ne 0) { throw "编译失败，csc 退出码 $LASTEXITCODE。" }
if (-not (Test-Path -LiteralPath $staging)) { throw "编译未产生输出：$staging" }

$replaced = $false
try { Copy-Item -LiteralPath $staging -Destination $target -Force; $replaced = $true } catch { }

if (-not $replaced) {
    # 面板正在运行时无法覆盖：Windows 允许重命名运行中的 exe，先改名再写入新版本。
    if (Test-Path -LiteralPath $legacy) { Remove-Item -LiteralPath $legacy -Force -ErrorAction SilentlyContinue }
    Move-Item -LiteralPath $target -Destination $legacy -Force
    Copy-Item -LiteralPath $staging -Destination $target -Force
    Write-Host "旧面板仍在运行，已把旧文件改名为 $legacy（关闭旧面板后可删除）。" -ForegroundColor Yellow
}

Remove-Item -LiteralPath $staging -Force -ErrorAction SilentlyContinue
$info = Get-Item -LiteralPath $target
Write-Host ("已生成 {0}（{1} 字节）" -f $info.FullName, $info.Length) -ForegroundColor Green
