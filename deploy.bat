@echo off
title BluKaam Connection - Instant Deploy
echo ========================================================
echo   Deploying BluKaam Connection to GitHub, Render & Pages
echo ========================================================
cd /d "%~dp0"

git add .
set TIMESTAMP=%date% %time%
git commit -m "Update: %TIMESTAMP%"
git push origin main

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo  SUCCESS: Code pushed to GitHub!
    echo  Render: https://blukaam-connection.onrender.com
    echo  GitHub Pages: https://hink001.github.io/blukaam-connection/
    echo ========================================================
) else (
    echo.
    echo [ERROR] Git push failed. Please check your connection.
)

timeout /t 5
