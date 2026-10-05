@echo off
title BluKaam - Firebase Deploy
echo ========================================================
echo   BluKaam Connection - Deploying to Firebase Hosting
echo ========================================================
echo.
call npx --yes firebase-tools deploy --only hosting
echo.
pause
