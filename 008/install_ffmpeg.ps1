# 008 - install FFmpeg (full build, NVENC + libass) to C:\ffmpeg
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$dest = "C:\ffmpeg"
if ($dest -ne "C:\ffmpeg") { throw "refusing unexpected destination: $dest" }
$bin  = Join-Path $dest "bin"
$work = Join-Path $env:TEMP "ffmpeg_dl"

$urls = @(
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.7z",
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.zip"
)

New-Item -ItemType Directory -Force -Path $work | Out-Null

$archive = $null
foreach ($u in $urls) {
    $out = Join-Path $work ([IO.Path]::GetFileName($u))
    Write-Host "Downloading $u"
    & curl.exe -L --fail --retry 3 --retry-delay 2 --max-time 900 -o $out $u
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $out) -and (Get-Item -LiteralPath $out).Length -gt 10MB) {
        $archive = $out
        Write-Host "  OK: $([math]::Round((Get-Item -LiteralPath $out).Length / 1MB, 1)) MB"
        break
    }
    Write-Host "  failed (curl exit $LASTEXITCODE)"
}
if (-not $archive) { throw "All download URLs failed" }

$staging = Join-Path $work "extract"
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

Write-Host "Extracting with bsdtar..."
& tar.exe -xf $archive -C $staging
if ($LASTEXITCODE -ne 0) { throw "tar extraction failed (exit $LASTEXITCODE)" }

$root = Get-ChildItem -LiteralPath $staging -Directory | Select-Object -First 1
if (-not $root) { throw "unexpected archive layout" }
Write-Host "Extracted: $($root.Name)"

if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path (Join-Path $root.FullName "*") -Destination $dest -Recurse -Force

if (-not (Test-Path -LiteralPath (Join-Path $bin "ffmpeg.exe"))) { throw "ffmpeg.exe missing after copy" }

$env:Path = "$bin;$env:Path"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$bin*") {
    $newPath = if ([string]::IsNullOrEmpty($userPath)) { $bin } else { "$userPath;$bin" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "Added $bin to user PATH (new shells only)"
} else {
    Write-Host "$bin already on user PATH"
}

Write-Host "--- verification ---"
& (Join-Path $bin "ffmpeg.exe") -version | Select-Object -First 1
& (Join-Path $bin "ffmpeg.exe") -hide_banner -encoders | Select-String -Pattern "nvenc"
& (Join-Path $bin "ffprobe.exe") -version | Select-Object -First 1
Write-Host "install_ffmpeg: DONE"