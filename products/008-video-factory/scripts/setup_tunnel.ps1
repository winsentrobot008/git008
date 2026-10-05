<#
.SYNOPSIS
  方案 A：把本机 008 Video Factory Studio 通过 Cloudflare Tunnel 绑定到 video.008ai.online

.DESCRIPTION
  宿主机完成 `cloudflared tunnel login` 授权后，本脚本一键完成：
    1. 检查 cloudflared 与授权证书（cert.pem）
    2. 确保隧道存在（不存在则创建）
    3. 读取凭据文件（~/.cloudflared/<tunnel-id>.json）
    4. 绑定 DNS 路由 video.008ai.online
    5. 生成 deploy/cloudflared.local.yml（含真实 tunnel id，已 gitignore）

.EXAMPLE
  pwsh -File products/008-video-factory/scripts/setup_tunnel.ps1
  pwsh -File products/008-video-factory/scripts/setup_tunnel.ps1 -Run
#>
[CmdletBinding()]
param(
    [string]$Hostname = "video.008ai.online",
    [int]$Port = 8787,
    [string]$TunnelName = "008-video-factory",
    [switch]$Run
)

$ErrorActionPreference = "Stop"
$ProductRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$CloudflaredHome = Join-Path $env:USERPROFILE ".cloudflared"
$LocalConfig = Join-Path $ProductRoot "deploy\cloudflared.local.yml"

function Find-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        (Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe"),
        (Join-Path $env:LOCALAPPDATA "cloudflared\cloudflared.exe"),
        (Join-Path $env:USERPROFILE "cloudflared\cloudflared.exe")
    )
    foreach ($p in $candidates) { if ($p -and (Test-Path $p)) { return $p } }
    return $null
}

Write-Host "[tunnel] 目标：https://$Hostname -> http://127.0.0.1:$Port"

$cf = Find-Cloudflared
if (-not $cf) {
    Write-Host "[tunnel] 未检测到 cloudflared，请先安装（任选其一）：" -ForegroundColor Yellow
    Write-Host "         winget install --id Cloudflare.cloudflared -e"
    Write-Host "         或下载 cloudflared-windows-amd64.exe 放入 PATH："
    Write-Host "         https://github.com/cloudflare/cloudflared/releases/latest"
    exit 3
}
Write-Host "[tunnel] cloudflared: $cf"

$certPath = Join-Path $CloudflaredHome "cert.pem"
if (-not (Test-Path $certPath)) {
    Write-Host "[tunnel] 尚未授权（缺少 $certPath）。" -ForegroundColor Yellow
    Write-Host "         请在宿主机执行一次（需浏览器登录 Cloudflare 账号）："
    Write-Host "           cloudflared tunnel login"
    Write-Host "         授权完成后再运行本脚本。"
    exit 4
}

$tunnels = @()
$raw = & $cf tunnel list --output json 2>$null
if ($raw) { $tunnels = @($raw | ConvertFrom-Json) }
$tunnel = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1

if (-not $tunnel) {
    Write-Host "[tunnel] 隧道 '$TunnelName' 不存在，正在创建 ..."
    & $cf tunnel create $TunnelName
    if ($LASTEXITCODE -ne 0) { Write-Host "[tunnel] 创建失败，退出。" -ForegroundColor Red; exit 5 }
    $raw = & $cf tunnel list --output json 2>$null
    if ($raw) { $tunnels = @($raw | ConvertFrom-Json) }
    $tunnel = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
}
if (-not $tunnel) { Write-Host "[tunnel] 仍无法读取隧道 id，请检查 cloudflared 输出。" -ForegroundColor Red; exit 6 }
Write-Host "[tunnel] tunnel id: $($tunnel.id)"

$credFile = Join-Path $CloudflaredHome "$($tunnel.id).json"
if (-not (Test-Path $credFile)) {
    Write-Host "[tunnel] 警告：未找到凭据文件 $credFile" -ForegroundColor Yellow
} else {
    Write-Host "[tunnel] 凭据文件就绪（已读取，不打印内容）"
}

Write-Host "[tunnel] 绑定 DNS 路由 $Hostname ..."
& $cf tunnel route dns $TunnelName $Hostname
if ($LASTEXITCODE -ne 0) {
    Write-Host "[tunnel] DNS 绑定返回非 0（记录已存在时可忽略，请以 Cloudflare 控制台为准）。" -ForegroundColor Yellow
}

$credYaml = $credFile.Replace("\", "/")
$yaml = @"
# 自动生成：本机隧道配置（含 tunnel id，禁止入仓；已由 .gitignore 覆盖）
# 生成时间：$(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
tunnel: $($tunnel.id)
credentials-file: $credYaml

ingress:
  - hostname: $Hostname
    service: http://127.0.0.1:$Port
  - service: http_status:404
"@
New-Item -ItemType Directory -Force -Path (Split-Path $LocalConfig) | Out-Null
[IO.File]::WriteAllText($LocalConfig, $yaml, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[tunnel] 已生成 $LocalConfig"

Write-Host ""
Write-Host "下一步（两个终端）：" -ForegroundColor Green
Write-Host "  [1] 启动本机服务：$ProductRoot\start_web.bat"
Write-Host "  [2] 拉起隧道：    `"$cf`" tunnel --config `"$LocalConfig`" run"
Write-Host "  之后访问：        https://$Hostname"
Write-Host ""

if ($Run) {
    Write-Host "[tunnel] 前台拉起隧道（Ctrl+C 停止）..." -ForegroundColor Green
    & $cf tunnel --config $LocalConfig run
}
exit 0