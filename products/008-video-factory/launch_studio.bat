@echo off
title 008 Video Factory Studio Launcher
color 0A
echo ===================================================
echo   008 Video Factory Studio - Starting Services...
echo ===================================================

:: 1. Check if backend is already running on port 8787
netstat -ano | findstr LISTENING | findstr /C:":8787 " >nul
if %errorlevel% equ 0 (
    echo [INFO] Web backend is already running on port 8787.
) else (
    echo [1/3] Starting FastAPI Backend ^(RTX 3060 / NVENC^)...
    start /B "" "%USERPROFILE%\.agent-reach-venv\Scripts\python.exe" "%~dp0scripts\serve_web.py" >nul 2>&1
)

:: 2. Check and start Cloudflare Tunnel
echo [2/3] Connecting Cloudflare Tunnel (video.008ai.online)...
start /B "" "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --config "%~dp0deploy\cloudflared.local.yml" run >nul 2>&1

:: 3. Wait for initialization
timeout /t 3 /nobreak >nul

:: 4. Launch Local Web UI in default browser
echo [3/3] Opening Studio Interface...
start "" "http://127.0.0.1:8787"

echo ===================================================
echo   All systems operational!
echo   - Local Access: http://127.0.0.1:8787
echo   - Mobile Remote: https://video.008ai.online
echo ===================================================
timeout /t 3 >nul
