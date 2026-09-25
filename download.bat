@echo off
rem ============================================================
rem  E-Hentai gallery downloader launcher (eh_download.mjs)
rem
rem  Usage:
rem    download.bat                        interactive mode (asks URL)
rem    download.bat <URL>                  single gallery
rem    download.bat urls.txt              batch mode via URL list file
rem    download.bat <URL|list> --parallel 3  ... extra options are passed through
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

if "%~1"=="" goto interactive
node eh_download.mjs %*
goto ret

:interactive
echo Enter gallery URL or list file path ^(e.g. urls.txt^):
set /p TARGET=^> 
if "%TARGET%"=="" (
  echo No input. Aborted.
  pause
  exit /b 1
)
node eh_download.mjs "%TARGET%"

:ret
set EC=%errorlevel%
echo.
echo Exit code: %EC%
pause
exit /b %EC%
