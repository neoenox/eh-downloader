@echo off
rem ============================================================
rem  Checksum verification tool for eh-viewer / eh-runall exes
rem
rem  Usage:
rem    verify_checksums.bat              verify every .sha256 next to this script
rem    verify_checksums.bat <folder>     verify sidecars in the given folder
rem
rem  Exit code 0 = all files match, 1 = any mismatch/missing file.
rem  (ASCII only: cmd.exe parses .bat files in the ANSI code page.)
rem ============================================================
setlocal
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] PowerShell not found. Use: certutil -hashfile eh-viewer.exe SHA256
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify_checksums.ps1" %*
set EC=%errorlevel%
echo.
echo Exit code: %EC%
if not "%EC%"=="0" pause
exit /b %EC%
