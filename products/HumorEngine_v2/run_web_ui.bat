@echo off
chcp 65001 >nul
title HumorEngine_v2 Web UI Launcher

:: ================================================================
::  HumorEngine_v2 — One-Click Web UI Launcher (Windows)
:: ================================================================

cls
echo.
echo  ================================================================
echo        __  __                        _____       _        ___
echo       ^|  \/  ^|                      ^|  __ \     ^| ^|      ^|__ \
echo       ^| \  / ^|  _   _   _ __    ___ ^| ^|__) ^|   ^| ^|   ___   ^| ^|
echo       ^| ^|\/^| ^| ^| ^| ^| ^| ^| '_ \  / _ \^|  _  /   ^| ^|  / _ \  ^| ^|
echo       ^| ^|  ^| ^| ^| ^|_^| ^| ^| ^| ^| ^|^|  __/^| ^| \ \   ^| ^| ^| (_) ^| ^| ^|
echo       ^|_^|  ^|_^|  \__,_^| ^|_^| ^|_^| \___^|^|_^|  \_\  ^|_^|  \___/ ^|___^|
echo  ================================================================
echo         High-Intellect Humor Generation — Web UI
echo  ================================================================
echo.
echo  [INFO] Checking Python environment...
echo.

:: Check if Python is available
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Python not found! Please install Python 3.10+ first.
    echo  [INFO]  Download from: https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

:: Display Python version
python --version

:: Ensure required packages are installed
echo.
echo  [INFO] Checking required packages...
python -c "import gradio" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  [INFO] Installing gradio...
    pip install gradio
)
python -c "import requests" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  [INFO] Installing requests...
    pip install requests
)

echo.
echo  [INFO] All dependencies satisfied.
echo.
echo  [INFO] Starting HumorEngine_v2 Web UI server...
echo  [INFO] Local URL: http://127.0.0.1:7860
echo.
echo  ================================================================
echo         Press Ctrl+C in this window to stop the server.
echo  ================================================================
echo.

:: Change to the script's own directory
cd /d "%~dp0"

:: Launch the Web UI
python src/web_ui.py

:: If the script exits (Ctrl+C or error), pause so the CEO can read logs
echo.
echo  [INFO] Server stopped.
echo  [INFO] Press any key to close this window...
pause
