@echo off
chcp 65001 >nul
setlocal
set "REPO=C:\Users\aoogoost\git008"
set "COMFY=C:\ComfyUI"

echo [008] Checking ComfyUI install...
if not exist "%COMFY%\run_nvidia_gpu.bat" (
    echo [008] ERROR: %COMFY%\run_nvidia_gpu.bat not found.
    echo [008] Run:  powershell -ExecutionPolicy Bypass -File "%REPO%\008\install_comfyui_cu126.ps1"
    exit /b 1
)

echo [008] Launching ComfyUI (low-VRAM mode)...
start "ComfyUI 008" /D "%COMFY%" cmd /c ""%COMFY%\run_nvidia_gpu.bat""

echo [008] Waiting 30s for the server to come up...
timeout /t 30 /nobreak >nul

echo [008] Activating project venv...
call "%REPO%\.venv\Scripts\activate.bat"
if errorlevel 1 (
    echo [008] ERROR: cannot activate %REPO%\.venv
    exit /b 1
)

pushd "%REPO%"
echo [008] ComfyUI reachability check:
python -c "from products.RoastBro.tools._comfyui.client import ComfyUIClient; c=ComfyUIClient(); print('ComfyUI reachable:', c.is_available())"
if errorlevel 1 echo [008] check failed - see error above (server still starting? try again in 30s)
popd

echo [008] Done. ComfyUI UI: http://127.0.0.1:8188
endlocal