@echo off
rem ============================================================
rem 008 Video Factory - Streamlit local control panel
rem Double-click this file to open the panel in your browser.
rem ============================================================
setlocal
cd /d "%~dp0"

set "VENV_PY=%USERPROFILE%\.agent-reach-venv\Scripts\python.exe"
if exist "%VENV_PY%" (
    set "PY=%VENV_PY%"
) else (
    set "PY=python"
)

"%PY%" -c "import streamlit" 1>nul 2>nul
if errorlevel 1 (
    echo [gui] streamlit missing, installing ...
    "%PY%" -m pip install streamlit
)

echo [gui] launching 008 Video Factory control panel ...
"%PY%" -m streamlit run gui.py --server.headless true
endlocal