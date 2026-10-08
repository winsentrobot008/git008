<#
.SYNOPSIS
  方案 A：把本机 008 Video Factory Studio 通过 Cloudflare Tunnel 绑定到 video.008ai.online

.DESCRIPTION
  宿主机完成 `cloudflared tunnel login` 授权后，本脚本一键完成：
    1. 定位 cloudflared（PATH / 显式绝对路径 / 环境变量推导）
    2. 校验授权证书 cert.pem
    3. 确保隧道存在（不存在则创建；账号下已有单个隧道则复用）
    4. 绑定 DNS 路由 video.008ai.online
    5. 生成 deploy/cloudflared.local.yml（含 tunnel id，已 gitignore）

  注意：cloudflared 会把日志/版本警告写到 stderr，脚本内部已按文本处理，
        不依赖 $ErrorActionPreference 的终止行为（Windows PowerShell 5.1 兼容）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File products/008-video-factory/scripts/setup_tunnel.ps1
  powershell -ExecutionPolicy Bypass -File ...\setup_tunnel.ps1 -Run
#>
[CmdletBinding()]
param(
    [string]$Hostname = "video.008ai.online",
    [int]$Port = 8787,
    [string]$TunnelName = "008-video",
    [string]$CloudflaredPath = "",
    [switch]$Run
)

$ErrorActionPreference = "Stop"
$ProductRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$CloudflaredHome = Join-Path $env:USERPROFILE ".cloudflared"
$LocalConfig = Join-Path $ProductRoot "deploy\cloudflared.local.yml"
$script:CfExe = $null
$script:CfExit = 0

function Find-Cloudflared {
    param([string]$Explicit)
    if ($Explicit -and (Test-Path $Explicit)) { return $Explicit }

    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # 显式绝对路径优先：本机 $env:ProgramFiles(x86) 指向 D:\，与 winget 实际安装位置（C:\）不一致
    $literals = @(
        "C:\Program Files (x86)\cloudflared\cloudflared.exe",
        "C:\Program Files\cloudflared\cloudflared.exe",
        "C:\cloudflared\cloudflared.exe"
    )
    $derived = @()
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA, $env:USERPROFILE)) {
        if ($base) { $derived += (Join-Path $base "cloudflared\cloudflared.exe") }
    }
    foreach ($p in ($literals + $derived)) { if ($p -and (Test-Path $p)) { return $p } }
    return $null
}

# cloudflared 日志走 stderr；这里统一按文本收集，避免 5.1 下变成终止性错误
function Invoke-Cf {
    param([string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lines = & $script:CfExe @Arguments 2>&1 | ForEach-Object { $_.ToString() }
        $script:CfExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
    return ($lines -join "`n")
}

function Get-CfTunnels {
    $text = Invoke-Cf @("tunnel", "list", "--output", "json")
    $start = $text.IndexOf("[")
    $end = $text.LastIndexOf("]")
    if ($start -lt 0 -or $end -le $start) { return @() }
    try { return @($text.Substring($start, $end - $start + 1) | ConvertFrom-Json) }
    catch { Write-Host "[tunnel] 解析隧道列表失败，按“无隧道”处理" -ForegroundColor Yellow; return @() }
}

Write-Host "[tunnel] 目标：https://$Hostname -> http://127.0.0.1:$Port"

$cf = Find-Cloudflared -Explicit $CloudflaredPath
if (-not $cf) {
    Write-Host "[tunnel] 未检测到 cloudflared，请先安装（任选其一）：" -ForegroundColor Yellow
    Write-Host "         winget install --id Cloudflare.cloudflared -e"
    Write-Host "         或用 -CloudflaredPath 指定 cloudflared.exe 绝对路径"
    exit 3
}
$script:CfExe = $cf
Write-Host "[tunnel] cloudflared: $cf"

$certPath = Join-Path $CloudflaredHome "cert.pem"
if (-not (Test-Path $certPath)) {
    Write-Host "[tunnel] 尚未授权（缺少 $certPath）。" -ForegroundColor Yellow
    Write-Host "         请先执行一次（需浏览器登录）： cloudflared tunnel login"
    exit 4
}

$tunnels = Get-CfTunnels
$tunnel = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1

# 指定名字不存在但账号下只有一个隧道时直接复用，避免重复建隧道
if (-not $tunnel -and @($tunnels).Count -eq 1) {
    $tunnel = @($tunnels)[0]
    $TunnelName = $tunnel.name
    Write-Host "[tunnel] 未找到指定名称，复用现有隧道 '$TunnelName'（id=$($tunnel.id)）" -ForegroundColor Yellow
}

if (-not $tunnel) {
    Write-Host "[tunnel] 隧道 '$TunnelName' 不存在，正在创建 ..."
    Invoke-Cf @("tunnel", "create", $TunnelName) | Out-Null
    if ($script:CfExit -ne 0) { Write-Host "[tunnel] 创建失败（exit=$script:CfExit）。" -ForegroundColor Red; exit 5 }
    $tunnels = Get-CfTunnels
    $tunnel = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
}
if (-not $tunnel) { Write-Host "[tunnel] 无法读取隧道 id，请检查 cloudflared 输出。" -ForegroundColor Red; exit 6 }
Write-Host "[tunnel] tunnel id: $($tunnel.id)"

$credFile = Join-Path $CloudflaredHome "$($tunnel.id).json"
if (-not (Test-Path $credFile)) {
    Write-Host "[tunnel] 警告：未找到凭据文件 $credFile" -ForegroundColor Yellow
} else {
    Write-Host "[tunnel] 凭据文件已就绪（仅校验存在性，不读取/不回显内容）"
}

Write-Host "[tunnel] 绑定 DNS 路由 $Hostname ..."
$dnsOut = Invoke-Cf @("tunnel", "route", "dns", $TunnelName, $Hostname)
if ($script:CfExit -ne 0 -and $dnsOut -notmatch "already configured") {
    Write-Host "[tunnel] DNS 绑定返回非 0（记录已存在时可忽略）：$dnsOut" -ForegroundColor Yellow
} elseif ($dnsOut -match "already configured") {
    Write-Host "[tunnel] DNS 路由已存在，无需重复创建"
} else {
    Write-Host "[tunnel] DNS 路由创建成功"
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

$originUrls = @("http://127.0.0.1:$Port")
Write-Host ""
Write-Host "下一步：" -ForegroundColor Green
Write-Host "  [1] 启动本机服务：$ProductRoot\start_web.bat"
Write-Host "  [2] 若隧道未在运行：`"$cf`" tunnel --config `"$LocalConfig`" run"
Write-Host "  访问：https://$Hostname"
Write-Host ""

if ($Run) {
    Write-Host "[tunnel] 前台拉起隧道（Ctrl+C 停止）..." -ForegroundColor Green
    & $script:CfExe tunnel --config $LocalConfig run
}
exit 0