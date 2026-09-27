@echo off
rem ============================================================
rem  AnonBuddy Skin - Windows one-click launcher
rem
rem  Closes WorkBuddy, reopens it with the CDP debug port and
rem  injects the skin. It also makes sure the auto-skin watcher
rem  task is running.
rem
rem  The app path is DISCOVERED at runtime (scripts\workbuddy-path.ps1),
rem  so a fresh clone works on any machine - no drive letters to edit.
rem  Override with the WORKBUDDY_EXE environment variable if needed.
rem
rem  Kept pure ASCII on purpose: cmd.exe reads batch files with the OEM
rem  code page, so non-ASCII text can corrupt parsing on some systems.
rem
rem  Optional arguments are forwarded to scripts\restart-and-skin.ps1,
rem  e.g.  apply-ai.cmd -Theme miku-488137 -Port 9333
rem ============================================================
setlocal
set "ROOT=%~dp0"

rem WorkBuddy may be running elevated; a non-elevated process cannot
rem stop it. Re-launch ourselves with administrator rights if needed.
fltmc >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator rights...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ============================================
echo    WorkBuddy Skin - one click
echo    WorkBuddy will be closed and reopened.
echo    Save your work first.
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\restart-and-skin.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo Done. WorkBuddy should now show the theme button.
) else (
  echo Finished with exit code %RC%.
)
echo Log: %ROOT%restart-skin.log
echo.
pause
