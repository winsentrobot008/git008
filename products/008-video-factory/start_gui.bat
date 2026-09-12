@echo off
rem ============================================================
rem 008 Video Factory - Streamlit local control panel
rem Double-click this file to open the panel in your browser.
rem ============================================================
setlocal
cd /d "%~dp0"

where streamlit >nul 2>nul
if errorlevel 1 (
    echo [gui] streamlit not found on PATH, trying python -m streamlit ...
    python -m streamlit run products\008-video-factory\gui.py --server.headless true
) else (
    streamlit run products\008-video-factory\gui.py --server.headless true
)

endlocal
