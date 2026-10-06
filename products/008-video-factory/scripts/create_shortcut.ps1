<#
  008 Video Factory Studio - desktop shortcut creator.

  Resolves the real Desktop folder (follows OneDrive / folder redirection),
  then creates "008 Video Factory Studio.lnk" pointing at launch_studio.bat
  with the product root as the working directory.

  Usage:
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create_shortcut.ps1
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create_shortcut.ps1 -DesktopPath D:\Users\Desktop
#>
[CmdletBinding()]
param(
    [string]$ShortcutName = '008 Video Factory Studio',
    [string]$DesktopPath = ''
)

$ErrorActionPreference = 'Stop'

$ProductRoot = Split-Path -Parent $PSScriptRoot
$Target = Join-Path $ProductRoot 'launch_studio.bat'

if (-not (Test-Path -LiteralPath $Target)) {
    throw "[shortcut] launcher not found: $Target"
}

if ([string]::IsNullOrWhiteSpace($DesktopPath)) {
    # DesktopDirectory is the shell's real desktop (NOT DesktopFolder, which is virtual).
    $DesktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
    if ([string]::IsNullOrWhiteSpace($DesktopPath)) {
        $DesktopPath = Join-Path $env:USERPROFILE 'Desktop'
    }
}

if (-not (Test-Path -LiteralPath $DesktopPath)) {
    New-Item -ItemType Directory -Force -Path $DesktopPath | Out-Null
}

$LnkPath = Join-Path $DesktopPath ($ShortcutName + '.lnk')

$shell = New-Object -ComObject WScript.Shell
try {
    $lnk = $shell.CreateShortcut($LnkPath)
    $lnk.TargetPath = $Target
    $lnk.WorkingDirectory = $ProductRoot
    $lnk.WindowStyle = 1
    $lnk.Description = '008 Video Factory Studio - start backend + Cloudflare tunnel and open the Web UI'
    $lnk.Save()
} finally {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
}

Write-Host "[shortcut] desktop : $DesktopPath"
Write-Host "[shortcut] created : $LnkPath"
Write-Host "[shortcut] target  : $Target"
Write-Host "[shortcut] start-in: $ProductRoot"
