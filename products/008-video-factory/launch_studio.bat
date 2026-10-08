@echo off
setlocal EnableExtensions
title 008 Video Factory Studio Launcher
color 0A
echo ===================================================
echo   008 Video Factory Studio - Starting Services...
echo ===================================================

:: Stage 1 - ComfyUI local backend (port 8188 only).
:: Deliberately scoped to 8188: never touches the AI control
:: panel (llama-server / port 8001).
call :ensure_comfyui

:: Stage 2 - FastAPI backend (port 8787)
netstat -ano | findstr LISTENING | findstr /C:":8787 " >nul
if %errorlevel% equ 0 (
    echo [INFO] Web backend is already running on port 8787.
) else (
    echo [2/4] Starting FastAPI Backend ^(RTX 3060 / NVENC^)...
    start /B "" "%USERPROFILE%\.agent-reach-venv\Scripts\python.exe" "%~dp0scripts\serve_web.py" >nul 2>&1
)

:: Stage 3 - Cloudflare Tunnel
echo [3/4] Connecting Cloudflare Tunnel (video.008ai.online)...
start /B "" "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --config "%~dp0deploy\cloudflared.local.yml" run >nul 2>&1

:: Stage 4 - let services settle, then open the Web UI
timeout /t 3 /nobreak >nul
echo [4/4] Opening Studio Interface...
start "" "http://127.0.0.1:8787"

echo ===================================================
echo   All systems operational!
echo   - Local Access:   http://127.0.0.1:8787
echo   - Mobile Remote:  https://video.008ai.online
echo   - ComfyUI Backend: http://127.0.0.1:8188
echo ===================================================
timeout /t 3 >nul
exit /b 0


:: =====================================================================
:: ComfyUI startup guard - binds 8188 only, leaves 8001 untouched.
:: =====================================================================
:ensure_comfyui
netstat -ano | findstr LISTENING | findstr /C:":8188 " >nul
if %errorlevel% equ 0 (
    echo [1/4] [INFO] ComfyUI backend is already running on port 8188.
    exit /b 0
)

set "COMFY="
if defined COMFYUI_ROOT if exist "%COMFYUI_ROOT%\ComfyUI\main.py" set "COMFY=%COMFYUI_ROOT%"
if not defined COMFY if exist "%~dp0..\..\runtime_data\comfyui\ComfyUI\main.py" set "COMFY=%~dp0..\..\runtime_data\comfyui"
if not defined COMFY if exist "D:\ComfyUI\ComfyUI\main.py" set "COMFY=D:\ComfyUI"

if not defined COMFY (
    echo [1/4] [WARN] ComfyUI not found ^(set COMFYUI_ROOT or install to runtime_data\comfyui^).
    echo [1/4] [WARN] Studio stays on the FFmpeg backend until ComfyUI is available.
    exit /b 0
)

echo [INFO] Starting ComfyUI backend on port 8188 ^(RTX 3060 VRAM^)...
if exist "%COMFY%\python_embeded\python.exe" goto comfy_embedded
if exist "%COMFY%\run_nvidia_gpu.bat" goto comfy_portable
echo [1/4] [WARN] No ComfyUI entry point found under %COMFY%.
exit /b 0

:comfy_embedded
start "ComfyUI 8188" /D "%COMFY%" /B "%COMFY%\python_embeded\python.exe" -s "ComfyUI\main.py" --windows-standalone-build --lowvram --preview-method auto --listen 127.0.0.1 --port 8188 >"%COMFY%\comfyui_launcher_stdout.log" 2>&1
echo [1/4] [INFO] ComfyUI warming up in background ^(first start can take minutes^).
echo [1/4] [INFO] Log: %COMFY%\comfyui_launcher_stdout.log
exit /b 0

:comfy_portable
start "ComfyUI 8188" /D "%COMFY%" cmd /c ""%COMFY%\run_nvidia_gpu.bat""
echo [1/4] [INFO] ComfyUI starting in its own console ^(first start can take minutes^).
exit /b 0
