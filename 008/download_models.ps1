# 008 - download the models the local pipeline needs into C:\ComfyUI\ComfyUI\models
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$root = "C:\ComfyUI\ComfyUI\models"
$repo = "C:\Users\aoogoost\git008"

# --- HF token: read from .env if present, never printed ---
$token = $null
$envFile = Join-Path $repo ".env"
if (Test-Path -LiteralPath $envFile) {
    foreach ($line in [System.IO.File]::ReadAllLines($envFile)) {
        if ($line -match "^\s*(HF_TOKEN|HUGGINGFACE_TOKEN|HUGGING_FACE_HUB_TOKEN)\s*=\s*(\S+)\s*$") {
            $token = $Matches[2].Trim('"').Trim("'")
            break
        }
    }
}
if (-not $token -and $env:HF_TOKEN) { $token = $env:HF_TOKEN }
Write-Host ("HF token: " + $(if ($token) { "found (not shown)" } else { "NOT found" }))

$jobs = @(
    @{ name = "AnimateDiff motion module"; url = "https://huggingface.co/guoyww/animatediff/resolve/main/mm_sd_v15_v2.ckpt";
       dest = "$root\animatediff\mm_sd_v15_v2.ckpt"; min = 500MB },
    @{ name = "SVD-XT (img2vid)"; url = "https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt/resolve/main/svd_xt.safetensors";
       dest = "$root\checkpoints\svd_xt.safetensors"; min = 5000MB },
    @{ name = "SD1.5 base for AnimateDiff (DreamShaper 8)"; url = "https://huggingface.co/Lykon/dreamshaper-8/resolve/main/DreamShaper_8.safetensors";
       dest = "$root\checkpoints\DreamShaper_8.safetensors"; min = 1000MB }
)

$results = @()
foreach ($j in $jobs) {
    Write-Host ""
    Write-Host "=== $($j.name) ==="
    $dir = Split-Path -Parent $j.dest
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

    if ((Test-Path -LiteralPath $j.dest) -and ((Get-Item -LiteralPath $j.dest).Length -gt $j.min)) {
        $mb = [math]::Round((Get-Item -LiteralPath $j.dest).Length / 1MB, 1)
        Write-Host "already present ($mb MB) - skipping"
        $results += "SKIP  $($j.name) -> $($j.dest) ($mb MB)"
        continue
    }

    $args = @("-L", "--fail", "--retry", "2", "--retry-delay", "3", "--max-time", "3600", "-C", "-", "-o", $j.dest)
    if ($token) { $args += @("-H", "Authorization: Bearer $token") }
    $args += $j.url
    & curl.exe @args 2>&1 | Select-Object -Last 1
    $code = $LASTEXITCODE

    if ($code -eq 0 -and (Test-Path -LiteralPath $j.dest) -and ((Get-Item -LiteralPath $j.dest).Length -gt $j.min)) {
        $mb = [math]::Round((Get-Item -LiteralPath $j.dest).Length / 1MB, 1)
        Write-Host "OK ($mb MB)"
        $results += "OK    $($j.name) -> $($j.dest) ($mb MB)"
    } else {
        $size = if (Test-Path -LiteralPath $j.dest) { (Get-Item -LiteralPath $j.dest).Length } else { 0 }
        Write-Host "FAILED (curl exit $code, got $size bytes)"
        if (Test-Path -LiteralPath $j.dest) { Remove-Item -LiteralPath $j.dest -Force -ErrorAction SilentlyContinue }
        $results += "FAIL  $($j.name) -> manual: $($j.url)"
    }
}

Write-Host ""
Write-Host "=== MODEL DOWNLOAD SUMMARY ==="
$results | ForEach-Object { Write-Host $_ }