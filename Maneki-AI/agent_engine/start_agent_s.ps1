# start_agent_s.ps1
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force
$venv = ".\.venv\Scripts\Activate.ps1"
if (Test-Path $venv) { & $venv } else { Write-Host "Warning: .venv not found." }
Start-Process -FilePath "python" -ArgumentList "-m uvicorn app_ready:app --host 127.0.0.1 --port 8000" -WindowStyle Hidden
$readyFile = Join-Path (Get-Location) "agent_s.ready"
$timeout = 60
$elapsed = 0
while (-not (Test-Path $readyFile) -and $elapsed -lt $timeout) { Start-Sleep -Seconds 1; $elapsed += 1 }
if (Test-Path $readyFile) {
    Write-Host "=== AGENT-S STARTED SUCCESSFULLY ==="
    Write-Host "Log file: agent_s_startup.log"
    Get-Content agent_s_startup.log -Tail 50
    exit 0
} else {
    Write-Host "!!! AGENT-S did not become ready within $timeout seconds."
    Write-Host "Check agent_s_startup.log for errors."
    if (Test-Path agent_s_startup.log) { Get-Content agent_s_startup.log -Tail 200 }
    exit 2
}
