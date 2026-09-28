@echo off
chcp 65001 >nul
title deepseek-harness 轻量 Web 界面（方案 B）
setlocal
cd /d "%~dp0"

set "VENV_PY=%~dp0venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
  echo [错误] 未找到子项目虚拟环境：%VENV_PY%
  echo         请先在本目录执行： python -m venv venv
  pause
  exit /b 1
)

rem 依赖自检：缺失时自动安装到本子项目 venv（不污染全局 Python）
"%VENV_PY%" -c "import gradio, openai" >nul 2>nul
if errorlevel 1 (
  echo [初始化] 首次运行，正在向子项目 venv 安装依赖（约 1-2 分钟）...
  "%VENV_PY%" -m pip install --disable-pip-version-check -r "%~dp0requirements-webui.txt"
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络或 pip 配置后重试。
    pause
    exit /b 1
  )
)

echo [启动] 正在启动轻量 Web 界面（Gradio + openai）...
echo        路由来源：%~dp0config\route.env
echo        浏览器会自动打开；关闭本窗口或按 Ctrl+C 即退出。
echo.
"%VENV_PY%" -u "%~dp0web_ui.py" %*

echo.
echo [提示] 轻量 Web 界面已退出。
pause
endlocal