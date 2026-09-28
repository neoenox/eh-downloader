@echo off
rem ============================================================
rem  Image viewer launcher (image_viewer.mjs)
rem
rem  Usage:
rem    viewer.bat                       interactive mode (asks folder)
rem    viewer.bat <folder>              view the folder in a browser
rem    viewer.bat <folder> --recursive  extra options are passed through
rem    viewer.bat <folder> --port 9000
rem
rem  sharp (thumbnail generation) is auto-installed on first run.
rem  Launch with --no-thumbs to skip this and use the plain viewer.
rem
rem  NOTE: keep this file ASCII-only. cmd.exe parses .bat files in the
rem        ANSI code page, so non-ASCII text gets corrupted.
rem ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found. Please install Node.js.
  pause
  exit /b 1
)

if "%~1"=="--no-thumbs" goto plain
if "%~2"=="--no-thumbs" goto plain

if not exist node_modules\sharp (
  echo sharp is not installed. Installing for thumbnails...
  npm install sharp --no-fund --no-audit
  if errorlevel 1 (
    echo [WARN] Failed to install sharp. Starting viewer without thumbnails.
  )
)

:plain
if not "%~1"=="" (
  node image_viewer.mjs %*
  goto ret
)

echo Enter folder to view (empty = current directory):
set /p TARGET=^>
node image_viewer.mjs "%TARGET%"

:ret
set EC=%errorlevel%
echo.
echo Exit code: %EC%
if not "%EC%"=="0" pause
exit /b %EC%
