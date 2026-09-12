# 008 - install ComfyUI portable CUDA 12.6 build (driver 560.x compatible) into C:\ComfyUI
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$dest = "C:\ComfyUI"
if ($dest -ne "C:\ComfyUI") { throw "refusing unexpected destination: $dest" }
$work = Join-Path $env:TEMP "comfyui_dl"
New-Item -ItemType Directory -Force -Path $work | Out-Null

$archive = Join-Path $work "ComfyUI_windows_portable_nvidia_cu126.7z"
if (-not (Test-Path -LiteralPath $archive) -or (Get-Item -LiteralPath $archive).Length -lt 100MB) {
    Write-Host "Resolving cu126 asset..."
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/comfyanonymous/ComfyUI/releases/latest" -Headers @{ "User-Agent" = "008-installer" } -TimeoutSec 60
    $asset = $rel.assets | Where-Object { $_.name -eq "ComfyUI_windows_portable_nvidia_cu126.7z" } | Select-Object -First 1
    if (-not $asset) { throw "cu126 asset not found in $($rel.tag_name)" }
    & curl.exe -L --fail --retry 3 --retry-delay 3 --max-time 5400 -o $archive $asset.browser_download_url
    if ($LASTEXITCODE -ne 0) { throw "download failed (curl exit $LASTEXITCODE)" }
} else {
    Write-Host "Reusing $([math]::Round((Get-Item -LiteralPath $archive).Length / 1MB, 1)) MB archive"
}

# --- extract to staging (Windows bsdtar has no -s rewrite support) ---
$staging = Join-Path $work "extract126"
$root = Join-Path $staging "ComfyUI_windows_portable"
if (-not (Test-Path -LiteralPath (Join-Path $root "python_embeded\python.exe"))) {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    Write-Host "Extracting cu126 build (a few minutes)..."
    & tar.exe -xf $archive -C $staging
    if ($LASTEXITCODE -ne 0) { throw "tar extraction failed (exit $LASTEXITCODE)" }
} else {
    Write-Host "Reusing extracted staging tree"
}
if (-not (Test-Path -LiteralPath (Join-Path $root "ComfyUI\main.py"))) { throw "staging tree incomplete" }

# --- ensure destination exists, then copy with robocopy ---
if (-not (Test-Path -LiteralPath $dest)) { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
Write-Host "Copying into $dest ..."
& robocopy.exe $root $dest /E /NFL /NDL /NJH /NJS /R:1 /W:1 /MT:8 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }
Write-Host "  robocopy exit $LASTEXITCODE (0-7 = success)"

$py = Join-Path $dest "python_embeded\python.exe"
if (-not (Test-Path -LiteralPath $py)) { throw "python_embeded\python.exe missing" }
if (-not (Test-Path -LiteralPath (Join-Path $dest "ComfyUI\main.py"))) { throw "ComfyUI\main.py missing" }

# --- force low-VRAM flags on the launcher ---
$batPath = Join-Path $dest "run_nvidia_gpu.bat"
$bat = [System.IO.File]::ReadAllText($batPath)
$bat = $bat -replace "--preview-method\s+\S+", ""
$bat = $bat -replace "--lowvram", ""
$lines = $bat -split "`r?`n"
$patched = $lines | ForEach-Object {
    if ($_ -match "main\.py") { (($_ -replace "\s+$", "") + " --lowvram --preview-method auto") } else { $_ }
}
[System.IO.File]::WriteAllText($batPath, ($patched -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "--- run_nvidia_gpu.bat ---"
Get-Content -LiteralPath $batPath | Where-Object { $_ -match "python" }

# --- keep model folders the project expects ---
foreach ($sub in @("checkpoints", "animatediff", "vae", "clip_vision", "loras")) {
    $p = Join-Path $dest "models\$sub"
    if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

Write-Host "--- verification ---"
& $py -c "import sys; print('embedded python', sys.version.split()[0])"
& $py -c "import torch; print('torch', torch.__version__, '| cuda_available', torch.cuda.is_available(), '| devices', torch.cuda.device_count())"
Write-Host "install_comfyui_cu126: DONE"