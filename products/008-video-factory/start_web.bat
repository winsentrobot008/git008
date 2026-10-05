@echo off
rem ============================================================
rem 008 Video Factory Studio - FastAPI + WebSocket web UI
rem Double-click this file to launch the studio in your browser.
rem ============================================================
setlocal
cd /d "%~dp0"

set "VENV_PY=%USERPROFILE%\.agent-reach-venv\Scripts\python.exe"
if exist "%VENV_PY%" (
    set "PY=%VENV_PY%"
) else (
    set "PY=python"
)

"%PY%" -c "import fastapi, uvicorn" 1>nul 2>nul
if errorlevel 1 (
    echo [web] fastapi/uvicorn missing, installing ...
    "%PY%" -m pip install fastapi uvicorn
)

echo [web] launching 008 Video Factory Studio on http://127.0.0.1:8787
"%PY%" scripts\serve_web.py %*
endlocal