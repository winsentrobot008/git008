[CmdletBinding()]
param(
    [string]$Workspace,
    [int]$Port,
    [string]$Mode
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TokenFile = Join-Path $ScriptDir ".token"

if (Test-Path $TokenFile) {
    $AuthToken = (Get-Content $TokenFile -Raw).Trim()
} else {
    $AuthToken = [guid]::NewGuid().ToString("N")
    $AuthToken | Set-Content $TokenFile -NoNewline
}

if (-not (Get-Command "cloudflared" -ErrorAction SilentlyContinue)) {
    Write-Warning "[mcp-bridge] cloudflared is not installed on this system."
    Write-Host "[mcp-bridge] Please install it first by running: winget install --id Cloudflare.cloudflared"
    exit 1
}

$ConfigFile = Join-Path $ScriptDir "config.json"
if (Test-Path $ConfigFile) { $Config = Get-Content $ConfigFile -Raw | ConvertFrom-Json } else { $Config = [PSCustomObject]@{} }
if (-not $Port) { $Port = if ($Config.port) { $Config.port } else { 8765 } }

$VenvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"
$Listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $Listening) {
    Write-Host "[mcp-bridge] Starting background MCP server..."
    Start-Process -FilePath $VenvPython -ArgumentList "-m", "coding_tools_mcp.server", "--workspace", "C:/Users/aoogoost/Desktop/Projekt/git008", "--host", "127.0.0.1", "--port", "$Port", "--permission-mode", "safe", "--auth-token", "$AuthToken" -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

Write-Host "================================================================"
Write-Host "[mcp-bridge] Bearer Token: $AuthToken"
Write-Host "[mcp-bridge] Starting Cloudflare Tunnel..."
Write-Host "================================================================"

cloudflared tunnel --url "http://127.0.0.1:$Port"
