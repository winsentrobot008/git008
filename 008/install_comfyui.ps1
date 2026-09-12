# 008 - install ComfyUI Portable (NVIDIA) to C:\ComfyUI, then force low-VRAM launch flags
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$dest = "C:\ComfyUI"
if ($dest -ne "C:\ComfyUI") { throw "refusing unexpected destination: $dest" }
$work = Join-Path $env:TEMP "comfyui_dl"
New-Item -ItemType Directory -Force -Path $work | Out-Null

# --- resolve + download (skipped if archive already present) ---
$archive = Get-ChildItem -LiteralPath $work -Filter "*.7z" -ErrorAction SilentlyContinue |
    Sort-Object Length -Descending | Select-Object -First 1
if (-not $archive) {
    $headers = @{ "User-Agent" = "008-installer" }
    if ($env:GITHUB_TOKEN) { $headers["Authorization"] = "Bearer $env:GITHUB_TOKEN" }
    $api = "https://api.github.com/repos/comfyanonymous/ComfyUI/releases/latest"
    Write-Host "Resolving latest ComfyUI release..."
    $rel = Invoke-RestMethod -Uri $api -Headers $headers -TimeoutSec 60
    Write-Host "  tag: $($rel.tag_name)"
    $asset = $rel.assets | Where-Object { $_.name -like "*windows_portable*nvidia*.7z" } | Select-Object -First 1
    if (-not $asset) { $asset = $rel.assets | Where-Object { $_.name -like "*windows_portable*.7z" } | Select-Object -First 1 }
    if (-not $asset) { throw "no Windows portable asset in $($rel.tag_name)" }
    Write-Host "  asset: $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)"
    $target = Join-Path $work $asset.name
    & curl.exe -L --fail --retry 3 --retry-delay 3 --max-time 5400 -o $target $asset.browser_download_url
    if ($LASTEXITCODE -ne 0) { throw "download failed (curl exit $LASTEXITCODE)" }
    $archive = Get-Item -LiteralPath $target
} else {
    Write-Host "Reusing archive: $($archive.Name) ($([math]::Round($archive.Length / 1MB, 1)) MB)"
}

# --- extract (skipped if staging already populated) ---
$staging = Join-Path $work "extract"
$root = Join-Path $staging "ComfyUI_windows_portable"
if (-not (Test-Path -LiteralPath (Join-Path $root "python_embeded\python.exe"))) {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    Write-Host "Extracting (this takes a few minutes)..."
    & tar.exe -xf $archive.FullName -C $staging
    if ($LASTEXITCODE -ne 0) { throw "tar extraction failed (exit $LASTEXITCODE)" }
} else {
    Write-Host "Reusing extracted staging tree"
}

if (-not (Test-Path -LiteralPath (Join-Path $root "ComfyUI\main.py"))) { throw "staging tree incomplete" }

# --- copy into place with robocopy (handles >260 char paths) ---
Write-Host "Copying to $dest with robocopy..."
& robocopy.exe $root $dest /E /NFL /NDL /NJH /NJS /R:1 /W:1 /MT:8 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }
Write-Host "  robocopy exit $LASTEXITCODE (0-7 = success)"

$py = Join-Path $dest "python_embeded\python.exe"
if (-not (Test-Path -LiteralPath $py)) { throw "python_embeded\python.exe missing after copy" }
if (-not (Test-Path -LiteralPath (Join-Path $dest "ComfyUI\main.py"))) { throw "ComfyUI\main.py missing after copy" }

# --- force low-VRAM flags on the launcher ---
$batPath = Join-Path $dest "run_nvidia_gpu.bat"
if (Test-Path -LiteralPath $batPath) {
    $bat = [System.IO.File]::ReadAllText($batPath)
    $bat = $bat -replace "--preview-method\s+\S+", ""
    $bat = $bat -replace "--lowvram", ""
    $lines = $bat -split "`r?`n"
    $patched = $lines | ForEach-Object {
        if ($_ -match "main\.py") { (($_ -replace "\s+$", "") + " --lowvram --preview-method auto") } else { $_ }
    }
    [System.IO.File]::WriteAllText($batPath, ($patched -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "--- run_nvidia_gpu.bat (patched) ---"
    Get-Content -LiteralPath $batPath | Where-Object { $_ -match "python" }
} else {
    Write-Warning "run_nvidia_gpu.bat not found - skipping flag patch"
}

Write-Host "--- verification ---"
& $py -c "import sys; print('embedded python', sys.version.split()[0])"
& $py -c "import torch; print('torch', torch.__version__, '| cuda_available', torch.cuda.is_available())"
Write-Host "install_comfyui: DONE"