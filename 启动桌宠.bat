@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts\launch.cjs
if errorlevel 1 pause
