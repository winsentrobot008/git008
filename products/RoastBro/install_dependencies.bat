@echo off
chcp 65001 >nul
title RoastBro 环境依赖一键安装
setlocal enabledelayedexpansion

echo ============================================
echo   RoastBro 环境依赖一键安装脚本
echo ============================================
echo.
echo 本脚本将自动安装以下依赖：
echo   1. FFmpeg（视频字幕硬烧录引擎）
echo   2. TTS + PyTorch（AI 配音生成）
echo   3. Whisper（视频语音识别）
echo.

:: ── 检查管理员权限 ──────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  某些操作需要管理员权限才能修改 PATH。
    echo    请右键选择「以管理员身份运行」本脚本。
    echo.
)

:: ══════════════════════════════════════════════
::  1. 安装 FFmpeg
:: ══════════════════════════════════════════════
echo.
echo [1/3] 🎬 安装 FFmpeg...
echo.

:: 先检查是否已存在
where ffmpeg >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('where ffmpeg') do set FFMPEG_PATH=%%i
    echo ✅ FFmpeg 已安装: !FFMPEG_PATH!
) else (
    echo   尝试使用 winget 安装 FFmpeg...
    winget install ffmpeg 2>nul
    if !errorlevel! equ 0 (
        echo ✅ FFmpeg 安装成功！
    ) else (
        echo.
        echo ⚠️  winget 安装失败，尝试手动下载 FFmpeg...
        echo.
        
        :: 下载 FFmpeg
        set FFMPEG_URL=https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
        set FFMPEG_ZIP=%TEMP%\ffmpeg.zip
        set FFMPEG_DIR=%LOCALAPPDATA%\RoastBro\ffmpeg
        
        echo   下载 FFmpeg 中（约 50MB）...
        mkdir "%FFMPEG_DIR%" 2>nul
        curl -L -o "%FFMPEG_ZIP%" "%FFMPEG_URL%" --progress-bar
        
        if exist "%FFMPEG_ZIP%" (
            echo   解压中...
            powershell -Command "Expand-Archive -Path '%FFMPEG_ZIP%' -DestinationPath '%TEMP%\ffmpeg_extract' -Force" >nul
            
            :: 找到 ffmpeg.exe
            for /r "%TEMP%\ffmpeg_extract" %%f in (ffmpeg.exe) do (
                copy "%%f" "%FFMPEG_DIR%\ffmpeg.exe" >nul
                goto :ffmpeg_copied
            )
            :ffmpeg_copied
            
            del "%FFMPEG_ZIP%" 2>nul
            rmdir /s /q "%TEMP%\ffmpeg_extract" 2>nul
            
            :: 添加到 PATH
            setx PATH "%PATH%;%FFMPEG_DIR%" >nul
            echo ✅ FFmpeg 已安装到: %FFMPEG_DIR%
            echo   已在用户 PATH 中添加该目录。
            echo   如果调用失败，请在 Dashboard 「⚙️ 工厂运维调优」中手动指定路径。
        ) else (
            echo ❌ FFmpeg 下载失败！请手动安装：
            echo    https://ffmpeg.org/download.html
        )
    )
)

:: ══════════════════════════════════════════════
::  2. 安装 TTS
:: ══════════════════════════════════════════════
echo.
echo [2/3] 🗣️ 安装 TTS + PyTorch...
echo.

python -c "import TTS" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ TTS 已安装
) else (
    echo   安装 PyTorch（CPU 版）...
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
    if !errorlevel! neq 0 (
        echo ⚠️  PyTorch 安装遇到问题，请手动执行:
        echo    pip install torch torchvision torchaudio
    )
    
    echo   安装 TTS...
    pip install TTS
    if !errorlevel! equ 0 (
        echo ✅ TTS 安装成功！
    ) else (
        echo ❌ TTS 安装失败！请手动执行:
        echo    pip install TTS
    )
)

:: ══════════════════════════════════════════════
::  3. 安装 Whisper
:: ══════════════════════════════════════════════
echo.
echo [3/3] 🧠 安装 Whisper（视频语音识别）...
echo.

python -c "import whisper" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Whisper 已安装
) else (
    pip install openai-whisper
    if !errorlevel! equ 0 (
        echo ✅ Whisper 安装成功！
    ) else (
        echo ⚠️  Whisper 安装遇到问题，请手动执行:
        echo    pip install openai-whisper
    )
)

:: ══════════════════════════════════════════════
::  完成
:: ══════════════════════════════════════════════
echo.
echo ============================================
echo   🎉 RoastBro 环境安装完成！
echo ============================================
echo.
echo 请重启 Dashboard 以加载新依赖：
echo   streamlit run dashboard/app.py
echo.
echo 如果 FFmpeg PATH 未生效，可在 Dashboard 中：
echo   ⚙️ 工厂运维调优 → 🌐 网络与代理 → 下方 FFmpeg 路径
echo.
pause
