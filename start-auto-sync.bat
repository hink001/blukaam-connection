@echo off
title BluKaam Connection - Auto-Sync Watcher
echo Starting Auto-Sync for BluKaam Connection...
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0auto-sync.ps1"
pause
