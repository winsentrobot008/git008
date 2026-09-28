# 激活 deepseek-harness 子项目 venv，并锁定隔离的 DSH_HOME。
# 用法（从任意目录）：  . D:\git008\tools\deepseek-harness\scripts\activate.ps1
$subprojectRoot = Split-Path -Parent $PSScriptRoot

. "$subprojectRoot\venv\Scripts\Activate.ps1"

$env:DSH_HOME = Join-Path $subprojectRoot "config\dsh-home"

Write-Host "deepseek-harness 子项目环境已激活" -ForegroundColor Green
Write-Host "  子项目根目录 : $subprojectRoot"
Write-Host "  Python       : $((Get-Command python).Source)"
Write-Host "  DSH_HOME     : $env:DSH_HOME"
Write-Host "  自检命令     : python scripts\verify_init.py"