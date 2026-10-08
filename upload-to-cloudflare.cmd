@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
call npm.cmd ci
if errorlevel 1 (
  pause
  exit /b 1
)
call npm.cmd run deploy
pause
