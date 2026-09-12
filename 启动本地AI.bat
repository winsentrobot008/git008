@echo off
chcp 65001 >nul
title 本地 AI 快捷启动面板

echo ============================================
echo           本地 AI 快捷启动面板
echo ============================================
echo.

tasklist | findstr /i "ollama.exe" >nul
if %errorlevel% neq 0 (
    echo [信息] 正在启动 Ollama 后台服务...
    start "" "ollama" serve
    timeout /t 3 >nul
) else (
    echo [成功] Ollama 后台服务正常运行中。
)

echo.
echo 请选择你要启动的服务：
echo [1] 启动 OpenCode (编程 Agent)
echo [2] 启动 OpenClaw (自动化管家)
echo [3] 进入 Qwen2.5-Coder 命令行对话
echo [4] 退出
echo.

set /p choice=请输入数字 (1-4) 后按回车: 

if "%choice%"=="1" (
    ollama launch opencode
) else if "%choice%"=="2" (
    ollama launch openclaw
) else if "%choice%"=="3" (
    ollama run qwen2.5-coder:7b
) else if "%choice%"=="4" (
    exit
)
pause