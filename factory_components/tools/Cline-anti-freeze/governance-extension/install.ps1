# Install Cline Governance Center v3.1.0 for VS Code
# Run: powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = "Stop"

$profileRoot = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$extensionsRoot = Join-Path $profileRoot ".vscode\extensions"
$old = Join-Path $extensionsRoot "cline-governance.cline-governance-center-3.0.0"
$target = Join-Path $extensionsRoot "codex-governance-center-3.1.0"

# Safety: only touch exact paths inside the VS Code extensions directory
$extPrefix = $extensionsRoot.TrimEnd('\') + '\'
foreach ($p in @($old, $target)) {
    if (-not $p.StartsWith($extPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refused: path outside extensions dir: $p"
    }
}

Write-Host "Installing Cline Governance Center v3.1.0 ..." -ForegroundColor Cyan

# Remove previous versions (exact paths, governance extension only)
foreach ($p in @($old, $target)) {
    if (Test-Path -LiteralPath $p) {
        Remove-Item -LiteralPath $p -Recurse -Force
        Write-Host "  Removed: $p" -ForegroundColor DarkGray
    }
}

New-Item -ItemType Directory -Force -Path $target | Out-Null

# Copy extension files (package.json / extension.js / media)
Copy-Item -Path (Join-Path $PSScriptRoot "package.json") -Destination $target -Force
Copy-Item -Path (Join-Path $PSScriptRoot "extension.js") -Destination $target -Force
Copy-Item -Path (Join-Path $PSScriptRoot "media") -Destination $target -Recurse -Force

Write-Host "OK: Extension installed to $target" -ForegroundColor Green
Write-Host "Next: Developer: Reload Window in VS Code to load v3.1.0" -ForegroundColor Yellow
Write-Host "Open the governance panel from the Activity Bar icon." -ForegroundColor Yellow
