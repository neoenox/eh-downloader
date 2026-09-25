@echo off
rem ============================================================
rem  WebP -> PNG/JPEG converter launcher (convert_images.mjs)
rem
rem  Usage:
rem    convert.bat                          interactive mode (asks folder)
rem    convert.bat <folder>                 convert to PNG
rem    convert.bat <folder> --format jpeg --quality 90 ... passthrough
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

if not exist node_modules\sharp (
  echo sharp is not installed. Installing...
  npm install sharp --no-fund --no-audit
  if errorlevel 1 (
    echo [ERROR] Failed to install sharp.
    pause
    exit /b 1
  )
)

if "%~1"=="" goto interactive
node convert_images.mjs %*
goto ret

:interactive
echo Enter folder containing WebP files:
set /p TARGET=^> 
if "%TARGET%"=="" (
  echo No input. Aborted.
  pause
  exit /b 1
)
echo Output format - 1=PNG, 2=JPEG ^(Enter=PNG^):
set /p FMT=^> 
if "%FMT%"=="2" (
  node convert_images.mjs "%TARGET%" --format jpeg --quality 90
) else (
  node convert_images.mjs "%TARGET%" --format png
)

:ret
set EC=%errorlevel%
echo.
echo Exit code: %EC%
pause
exit /b %EC%
