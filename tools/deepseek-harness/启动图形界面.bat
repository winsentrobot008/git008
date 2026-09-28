@echo off
chcp 65001 >nul
title deepseek-harness 图形界面
setlocal
cd /d "%~dp0"

set "VENV_PY=%~dp0venv\Scripts\python.exe"
set "APP=%~dp0webui\app.py"

if not exist "%VENV_PY%" (
  echo [错误] 未找到子项目虚拟环境：%VENV_PY%
  echo         请先在本目录执行： python -m venv venv
  pause
  exit /b 1
)

if not exist "%APP%" (
  echo [错误] 未找到界面脚本：%APP%
  pause
  exit /b 1
)

rem 依赖自检：缺失时自动安装到本子项目 venv，不污染全局 Python
"%VENV_PY%" -c "import gradio" >nul 2>nul
if errorlevel 1 (
  echo [初始化] 首次运行，正在向子项目 venv 安装 Web UI 依赖（约 1-2 分钟）...
  "%VENV_PY%" -m pip install --disable-pip-version-check -r "%~dp0requirements-webui.txt"
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络或 pip 配置后重试。
    pause
    exit /b 1
  )
)

echo [启动] 正在启动图形界面，浏览器会自动打开...
echo        配置来源：%~dp0.env （控制面板切换本地/云端后无需改这里）
echo        关闭本窗口或按 Ctrl+C 即退出。
echo.
"%VENV_PY%" "%APP%"

echo.
echo [提示] 图形界面已退出。
pause
endlocal