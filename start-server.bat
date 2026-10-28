@echo off
title ChatNova Server Launcher
color 0B
echo ========================================================
echo        ChatNova Real-Time Messaging Platform
echo ========================================================
echo.
echo Checking Node.js installation...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in your PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b
)

echo Starting ChatNova backend server on port 3000...
echo.
echo Tip: Ensure MySQL is running in your XAMPP Control Panel.
echo Opening http://localhost:3000 in your browser...
echo.
timeout /t 2 >nul
start "" http://localhost:3000
node server.js
pause
