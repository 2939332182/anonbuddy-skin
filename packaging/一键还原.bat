@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AnonBuddy Skin - 还原

echo.
echo   正在把 WorkBuddy 还原成官方界面...
echo.
pause

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\pause.ps1"

echo.
echo   [OK] 已还原。
echo.
pause