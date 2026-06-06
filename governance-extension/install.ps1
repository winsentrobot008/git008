# Install Cline Governance Extension for VS Code
# Run: powershell -ExecutionPolicy Bypass -File install.ps1

$extDir = "$env:USERPROFILE\.vscode\extensions\cline-governance.cline-governance-center-2.0.0"
Write-Host "🏛️ Installing Cline 治理中心 extension..." -ForegroundColor Cyan

# Create target
New-Item -ItemType Directory -Force -Path $extDir | Out-Null

# Copy all files except this script
Get-ChildItem -Path $PSScriptRoot -Exclude "install.ps1" | Copy-Item -Destination $extDir -Recurse -Force

Write-Host "✅ Extension installed to: $extDir" -ForegroundColor Green
Write-Host "👉 Restart VS Code to load the extension" -ForegroundColor Yellow
Write-Host "👉 Click the 🏛️ icon in the Activity Bar (left sidebar) to open 治理中心" -ForegroundColor Yellow