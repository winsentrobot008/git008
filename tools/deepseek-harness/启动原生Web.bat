@echo off
chcp 65001 >nul
title deepseek-harness 原生 Web 界面（方案 A）
setlocal
cd /d "%~dp0"

set "VENV_PY=%~dp0venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
  echo [错误] 未找到子项目虚拟环境：%VENV_PY%
  echo         请先在本目录执行： python -m venv venv
  pause
  exit /b 1
)

echo [启动] 正在启动原生 Web 界面（dsh web，无需 Node/pnpm）...
echo        路由来源：%~dp0config\route.env
echo        浏览器会自动打开；关闭本窗口或按 Ctrl+C 即退出。
echo.
"%VENV_PY%" -u "%~dp0launch_native_web.py" %*

echo.
echo [提示] 原生 Web 界面已退出。
pause
endlocal