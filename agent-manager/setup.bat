@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ============================================================================
rem  MAOTANG one-command setup (Windows)
rem  Installs local dependencies, downloads the open-source quantized 0.5B SLM,
rem  verifies its SHA-256 and launches the offline-first AI manager.
rem  For macOS / Linux use setup.sh.
rem ============================================================================

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "REPO_ROOT=%SCRIPT_DIR%\.."
set "MANIFEST=%SCRIPT_DIR%\config\model.json"
set "MODEL_DIR=%SCRIPT_DIR%\models"
set "MANAGER=%SCRIPT_DIR%\src\agent-manager.mjs"

set "DRY_RUN=0"
set "SKIP_MODEL=0"
set "NO_NATIVE=0"
set "LAUNCH=1"
set "RPC="
set "EXTRA="
set "HAVE_NODE=0"
set "NPM_OPTIONAL="
set "NEED_DOWNLOAD=1"
set "FILE_HASH="
set "JSON_VALUE="

:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--dry-run" (
  set "DRY_RUN=1"
  shift
  goto parse
)
if /i "%~1"=="--skip-model" (
  set "SKIP_MODEL=1"
  shift
  goto parse
)
if /i "%~1"=="--no-native" (
  set "NO_NATIVE=1"
  shift
  goto parse
)
if /i "%~1"=="--no-launch" (
  set "LAUNCH=0"
  shift
  goto parse
)
if /i "%~1"=="--model-dir" (
  if "%~2"=="" (
    echo [error] --model-dir requires a path
    exit /b 2
  )
  set "MODEL_DIR=%~2"
  shift
  shift
  goto parse
)
if /i "%~1"=="--rpc" (
  if "%~2"=="" (
    echo [error] --rpc requires a url
    exit /b 2
  )
  set "RPC=%~2"
  set "EXTRA=!EXTRA! --rpc %~2"
  shift
  shift
  goto parse
)
if /i "%~1"=="-h" goto usage
if /i "%~1"=="--help" goto usage
set "EXTRA=!EXTRA! %~1"
shift
goto parse

:usage
echo Usage: setup.bat [--dry-run] [--skip-model] [--no-native] [--no-launch]
echo                  [--model-dir PATH] [--rpc URL] [manager args...]
echo.
echo Environment: MAOTANG_RPC_URL, MAOTANG_MODEL_PATH, MAOTANG_MODE, MAOTANG_THREADS
exit /b 0

:parsed
call :json_field filename
set "MODEL_FILE=%JSON_VALUE%"
call :json_field url
set "MODEL_URL=%JSON_VALUE%"
call :json_field sha256
set "MODEL_SHA=%JSON_VALUE%"

if "%MODEL_FILE%"=="" (
  echo [error] cannot read %MANIFEST%
  exit /b 1
)
set "MODEL_PATH=%MODEL_DIR%\%MODEL_FILE%"
set "MAOTANG_MODEL_PATH=%MODEL_PATH%"
if not "%RPC%"=="" set "MAOTANG_RPC_URL=%RPC%"

echo.
echo == Checking prerequisites
where node >nul 2>nul
if not errorlevel 1 set "HAVE_NODE=1"
if "%HAVE_NODE%"=="0" (
  echo   [warn] Node.js not found on PATH. Need Node.js 20 or newer.
  if "%DRY_RUN%"=="0" (
    echo   [error] Install Node.js 20 or newer and re-run.
    exit /b 1
  )
) else (
  for /f "delims=" %%V in ('node -p "process.versions.node"') do set "NODE_VERSION=%%V"
  echo   node !NODE_VERSION!
)

echo.
echo == Installing local dependencies
if "%NO_NATIVE%"=="1" set "NPM_OPTIONAL=--omit=optional"
if "%DRY_RUN%"=="1" (
  echo   [dry-run] npm --prefix "%REPO_ROOT%\agent-client" install !NPM_OPTIONAL!
  echo   [dry-run] npm --prefix "%REPO_ROOT%\agent-client" run build
  echo   [dry-run] npm --prefix "%SCRIPT_DIR%" install !NPM_OPTIONAL!
) else (
  call :npm_run "%REPO_ROOT%\agent-client" install
  if errorlevel 1 exit /b 1
  call :npm_run "%REPO_ROOT%\agent-client" run build
  if errorlevel 1 exit /b 1
  call :npm_run "%SCRIPT_DIR%" install
  if errorlevel 1 exit /b 1
)

echo.
echo == Fetching the open-source quantized SLM
echo   model:  %MODEL_FILE%
echo   source: %MODEL_URL%
echo   sha256: %MODEL_SHA%
if "%SKIP_MODEL%"=="1" (
  echo   skipped with --skip-model
  goto after_model
)
if "%DRY_RUN%"=="1" (
  echo   [dry-run] download to %MODEL_PATH% and verify sha256
  goto after_model
)
if not exist "%MODEL_DIR%" mkdir "%MODEL_DIR%"
if exist "%MODEL_PATH%" (
  call :sha256_of "%MODEL_PATH%"
  if /i "!FILE_HASH!"=="%MODEL_SHA%" (
    echo   already present and verified
    set "NEED_DOWNLOAD=0"
  )
)
if "!NEED_DOWNLOAD!"=="1" (
  call :download "%MODEL_URL%" "%MODEL_PATH%.part"
  if errorlevel 1 (
    echo   [error] download failed
    exit /b 1
  )
  call :sha256_of "%MODEL_PATH%.part"
  if /i not "!FILE_HASH!"=="%MODEL_SHA%" (
    echo   [error] sha256 mismatch for the downloaded model
    del /q "%MODEL_PATH%.part" >nul 2>nul
    exit /b 1
  )
  move /y "%MODEL_PATH%.part" "%MODEL_PATH%" >nul
  echo   downloaded and verified
)

:after_model
echo.
echo == Launching the AI manager
if "%LAUNCH%"=="0" (
  echo   skipped with --no-launch
  echo   start later with: node "%MANAGER%"
  exit /b 0
)
if "%DRY_RUN%"=="1" (
  echo   [dry-run] node "%MANAGER%" !EXTRA!
  exit /b 0
)
node "%MANAGER%" !EXTRA!
exit /b %ERRORLEVEL%

rem --------------------------------------------------------------------------
rem  Subroutines
rem --------------------------------------------------------------------------

:json_field
set "JSON_VALUE="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$m = ConvertFrom-Json -InputObject (Get-Content -Raw -LiteralPath '%MANIFEST%'); [Console]::Out.Write($m.%~1)"`) do set "JSON_VALUE=%%A"
goto :eof

:sha256_of
set "FILE_HASH="
for /f "skip=1 delims=" %%A in ('certutil -hashfile "%~1" SHA256 2^>nul') do (
  if not defined FILE_HASH set "FILE_HASH=%%A"
)
set "FILE_HASH=%FILE_HASH: =%"
goto :eof

:download
where curl.exe >nul 2>nul
if not errorlevel 1 (
  curl.exe -L --fail --retry 3 --output "%~2" "%~1"
  goto :eof
)
echo   curl.exe not found, falling back to PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%~1' -OutFile '%~2'"
goto :eof

:npm_run
set "NPM_DIR=%~1"
set "NPM_CMD=%~2"
set "NPM_EXTRA=%~3"
if "%NPM_EXTRA%"=="" (
  npm --prefix "%NPM_DIR%" %NPM_CMD%
) else (
  npm --prefix "%NPM_DIR%" %NPM_CMD% %NPM_EXTRA%
)
goto :eof
