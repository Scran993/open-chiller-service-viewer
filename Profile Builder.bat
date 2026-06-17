@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-viewer.ps1" -StartPage "profile-builder.html"
endlocal
