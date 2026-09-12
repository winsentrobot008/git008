#Requires -Version 5.1
<#
setup.ps1 — projects/mcp-bridge 初始化脚本
1) 在 projects/mcp-bridge 下创建独立 Python 虚拟环境 .venv
2) 克隆 https://github.com/xyTom/coding-tools-mcp.git 到 vendor/coding-tools-mcp
3) 使用 .venv 自动安装依赖（pip install -e .）
#>
$ErrorActionPreference = "Stop"

$root      = $PSScriptRoot
$venvDir   = Join-Path $root ".venv"
$vendorDir = Join-Path $root "vendor"
$repoDir   = Join-Path $vendorDir "coding-tools-mcp"
$repoUrl   = "https://github.com/xyTom/coding-tools-mcp.git"

Write-Host "[setup] mcp-bridge root = $root"

# ── 1) 创建 Python 虚拟环境 ────────────────────────────────────────────
$venvPython = Join-Path $venvDir "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "[setup] 创建虚拟环境 .venv ..."
    python -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw "[setup] 创建虚拟环境失败（请确认 python 已安装并在 PATH 中）" }
} else {
    Write-Host "[setup] .venv 已存在，跳过创建"
}

# ── 2) 克隆 coding-tools-mcp ──────────────────────────────────────────
if (-not (Test-Path $repoDir)) {
    New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null
    Write-Host "[setup] 克隆 $repoUrl ..."
    git clone --depth 1 $repoUrl $repoDir
    if ($LASTEXITCODE -ne 0) { throw "[setup] git clone 失败" }
} else {
    Write-Host "[setup] vendor/coding-tools-mcp 已存在，执行 git pull 更新"
    Push-Location $repoDir
    try { git pull --ff-only } catch { Write-Warning "[setup] git pull 失败（忽略，继续安装）" }
    Pop-Location
}

# ── 3) 安装依赖（pip install -e .） ───────────────────────────────────
Write-Host "[setup] 升级 pip ..."
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "[setup] pip 升级失败" }

Write-Host "[setup] pip install -e vendor/coding-tools-mcp ..."
& $venvPython -m pip install -e $repoDir
if ($LASTEXITCODE -ne 0) { throw "[setup] pip install -e . 失败" }

Write-Host ""
Write-Host "[setup] ✔ 初始化完成：.venv 就绪，coding-tools-mcp 已安装"
Write-Host "[setup] 下一步："
Write-Host "        本地启动   : .\projects\mcp-bridge\start-local.ps1"
Write-Host "        公网穿透   : .\projects\mcp-bridge\start-tunnel.ps1"
