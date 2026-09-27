@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AnonBuddy Skin

echo.
echo   ============================================
echo     AnonBuddy Skin   WorkBuddy 换肤
echo   ============================================
echo.
echo   接下来会重启 WorkBuddy 并注入皮肤，
echo   手头没保存的东西记得先存一下。
echo.
pause

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\apply.ps1"

echo.
echo   ============================================
echo   如果上面显示成功，去 WorkBuddy 右上角
echo   找那颗浮动按钮，点开就能换主题。
echo.
echo   没成功的话，先跑 scripts\find-workbuddy.ps1
echo   看看 WorkBuddy 装在哪，再把路径告诉 apply.ps1。
echo   ============================================
echo.
pause