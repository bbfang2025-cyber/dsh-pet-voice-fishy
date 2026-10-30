@echo off
chcp 65001 >nul
title 升级「大肥鱼语音」到最新版
echo.
echo 正在把「大肥鱼语音」升级到 GitHub 最新版...
echo.
set PROFILE=%USERPROFILE%\.dsh\profiles\desktop
if not exist "%PROFILE%\package.json" (
  echo [X] 没找到 DSH desktop profile：%PROFILE%
  echo     请先安装并启动过 DSH，再双击本脚本。
  pause
  exit /b 1
)
cd /d "%PROFILE%"
call pnpm add github:bbfang2025-cyber/dsh-pet-voice-fishy --registry=https://registry.npmmirror.com
if errorlevel 1 (
  echo.
  echo [X] 升级失败：请确认已安装 Node.js 18+ 与 pnpm；也可以手动执行：
  echo     cd /d "%PROFILE%"
  echo     pnpm add github:bbfang2025-cyber/dsh-pet-voice-fishy
  pause
  exit /b 1
)
echo.
echo [OK] 升级完成！请【完全退出 DSH，再重新打开】（只刷新页面不生效）。
pause
