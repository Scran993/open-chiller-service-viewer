@echo off
set "HERE=%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%HERE%tools\start-viewer.ps1" -Port 8766 -StartPage register-explorer.html
