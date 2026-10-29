@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 20.19 或更高版本，然后重新打开本文件。
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo 正在安装归位 Lab 所需依赖...
  call npm install
  if errorlevel 1 exit /b 1
)
if not exist "dist\index.html" (
  echo 正在准备归位 Lab 界面...
  call npm run build
  if errorlevel 1 exit /b 1
)
echo.
echo 请在浏览器打开 http://localhost:4317
echo 保持此窗口开启，按 Ctrl+C 可以停止服务。
echo.
call npm start
pause
