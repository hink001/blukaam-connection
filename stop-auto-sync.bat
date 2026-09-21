@echo off
title BluKaam Connection - Stop Auto-Sync
echo Stopping BluKaam Connection Auto-Sync background processes...

powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*auto-sync.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host 'Stopped process' $_.ProcessId }"

echo.
echo Auto-sync has been stopped.
ping 127.0.0.1 -n 3 >nul
