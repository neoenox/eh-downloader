@echo off
rem ============================================================
rem  Single-exe builder (build_exe.mjs) - Node.js SEA based
rem
rem  Usage:
rem    build.bat                 build dist\eh-viewer.exe (viewer only, with sharp)
rem    build.bat --runall        build dist\eh-runall.exe (all-in-one: DL+convert+view)
rem    build.bat --no-sharp      build without thumbnails
rem
rem  Requirements: Node.js 20+ (node.exe is used as the runtime base)
rem  Output exe needs NO Node.js on the target machine.
rem
rem  NOTE: keep this file ASCII-only. cmd.exe parses .bat files in the
rem        ANSI code page, so non-ASCII text gets corrupted.
rem ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found. Please install Node.js 20 or later.
  pause
  exit /b 1
)

if not exist node_modules\esbuild (
  echo dev dependencies are missing. Installing...
  npm install --no-fund --no-audit
  if errorlevel 1 (
    echo [ERROR] Failed to install dev dependencies.
    pause
    exit /b 1
  )
)

node build_exe.mjs %*

set EC=%errorlevel%
echo.
echo Exit code: %EC%
if not "%EC%"=="0" pause
exit /b %EC%
