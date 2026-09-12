[CmdletBinding()]
param(
    [string]$Workspace,
    [int]$Port,
    [string]$Mode,
    [string]$AuthToken
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigFile = Join-Path $ScriptDir "config.json"

if (Test-Path $ConfigFile) {
    $Config = Get-Content $ConfigFile -Raw | ConvertFrom-Json
} else {
    $Config = [PSCustomObject]@{}
}

if (-not $Workspace) { $Workspace = if ($Config.workspace) { $Config.workspace } else { (Split-Path -Parent (Split-Path -Parent $ScriptDir)) } }
if (-not $Port) { $Port = if ($Config.port) { $Config.port } else { 8765 } }
if (-not $Mode) { $Mode = if ($Config.mode) { $Config.mode } else { "safe" } }

$VenvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    Write-Error "[mcp-bridge] Python venv not found. Run setup.ps1 first."
    exit 1
}

$ArgsList = @("--workspace", $Workspace, "--host", "127.0.0.1", "--port", $Port, "--permission-mode", $Mode)
if ($AuthToken) {
    $ArgsList += @("--auth-token", $AuthToken)
}

Write-Host "[mcp-bridge] Starting coding-tools-mcp..."
Write-Host "[mcp-bridge] Workspace: $Workspace"
Write-Host "[mcp-bridge] Port: $Port | Mode: $Mode"

& $VenvPython -m coding_tools_mcp.server @ArgsList
