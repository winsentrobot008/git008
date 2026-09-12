# 008 - resolve and download a public SD1.5 single-file base checkpoint for AnimateDiff
$ErrorActionPreference = "Continue"
$dest = "C:\ComfyUI\ComfyUI\models\checkpoints"

$repos = @("Yntec/GhostMix", "Lykon/dreamshaper-8", "stable-diffusion-v1-5/stable-diffusion-v1-5")
$pick = $null
foreach ($r in $repos) {
    Write-Host "Probing $r ..."
    try {
        $info = Invoke-RestMethod -Uri "https://huggingface.co/api/models/$r" -TimeoutSec 45
    } catch {
        Write-Host "  api failed: $($_.Exception.Message)"
        continue
    }
    $files = $info.siblings | Where-Object { $_.rfilename -like "*.safetensors" -and $_.rfilename -notmatch "/" }
    if (-not $files) {
        $nested = ($info.siblings | Where-Object { $_.rfilename -like "*.safetensors" } | Select-Object -First 3 | ForEach-Object { $_.rfilename }) -join ", "
        Write-Host "  no root-level .safetensors (nested only: $nested)"
        continue
    }
    $files | ForEach-Object { Write-Host "  candidate: $($_.rfilename)" }
    $pick = @{ repo = $r; file = $files[0].rfilename }
    break
}

if (-not $pick) {
    Write-Host "NO_BASE_MODEL_RESOLVED"
    exit 0
}

$url = "https://huggingface.co/$($pick.repo)/resolve/main/$($pick.file)"
$target = Join-Path $dest $pick.file
Write-Host "Downloading $url"
& curl.exe -L --fail --retry 2 --retry-delay 3 --max-time 3600 -C - -o $target $url 2>&1 | Select-Object -Last 1
if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $target)) {
    Write-Host ("OK " + [math]::Round((Get-Item -LiteralPath $target).Length / 1MB, 1) + " MB -> $target")
} else {
    Write-Host "FAILED (exit $LASTEXITCODE) manual: $url"
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
}