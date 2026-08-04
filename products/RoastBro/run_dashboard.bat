@echo off
title RoastBro Control Panel v3.5 — Global Bilingual Content Factory
cd /d %~dp0
cls
echo =====================================================
echo   🔥 RoastBro — Global Bilingual Content Factory
echo   🌍 Dashboard v3.5 / CN + EN Pipeline
echo   📡 git008 Governance — Connected
echo =====================================================
echo.
echo Starting Streamlit dashboard...
echo.
streamlit run dashboard/app.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Streamlit failed to start. Trying python -m streamlit...
    python -m streamlit run dashboard/app.py
)
pause
