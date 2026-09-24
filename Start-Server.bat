@echo off
title Employee Attendance & Overtime Tracker - Server
color 0B

echo =====================================================================
echo    EMPLOYEE ATTENDANCE & PAYROLL SERVER (LAPTOP LOCAL SERVER)
echo =====================================================================
echo.
echo Checking Node.js installation...
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js is not found in your PATH!
    echo Please install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

echo Starting Server...
echo Database stored in: attendance.db
echo.
echo Opening browser in 2 seconds...
start "" timeout /t 2 /nobreak >nul & start http://localhost:5000

echo.
node server.js

pause
