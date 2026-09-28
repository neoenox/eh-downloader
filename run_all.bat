@echo off
rem ============================================================
rem  All-in-one launcher (run_all.mjs)
rem  Download -> convert (WebP to PNG/JPEG) -> open in viewer
rem
rem  Usage:
rem    run_all.bat                          interactive mode (asks URL)
rem    run_all.bat <URL|urls.txt>           download + convert + view
rem    run_all.bat --from <folder>          convert + view downloaded folder
rem    run_all.bat --open-only <folder>     just open the viewer
rem    run_all.bat <URL> --format jpeg --del ... extra options are passed through
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
  echo sharp is not installed. Installing for conversion and thumbnails...
  npm install sharp --no-fund --no-audit
  if errorlevel 1 (
    echo [WARN] Failed to install sharp. Conversion will be skipped, viewer still works.
  )
)

if not "%~1"=="" (
  node run_all.mjs %*
  goto ret
)

echo Enter gallery URL or list file path (e.g. urls.txt):
set /p TARGET=^>
if "%TARGET%"=="" (
  echo No input. Aborted.
  pause
  exit /b 1
)
echo Output format - 1=PNG, 2=JPEG (Enter=PNG):
set /p FMT=^>
if "%FMT%"=="2" (
  node run_all.mjs "%TARGET%" --format jpeg --quality 90
) else (
  node run_all.mjs "%TARGET%" --format png
)

:ret
set EC=%errorlevel%
echo.
echo Exit code: %EC%
if not "%EC%"=="0" pause
exit /b %EC%
