@echo off
title Chuti Leave Management System Launcher
cls
echo =========================================================
echo       Chuti Leave Management System - Admin Launcher
echo =========================================================
echo.
echo Checking system environment...

:: 1. Check Node.js installation
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not detected on this system!
    echo.
    echo To run this application, please follow these steps:
    echo 1. Open your web browser and go to: https://nodejs.org
    echo 2. Download and install the "LTS" version.
    echo 3. Once installed, restart your computer and double-click this launcher again.
    echo.
    echo Press any key to exit...
    pause >nul
    exit
)
echo - Node.js is installed.

:: 2. Check and install dependencies if node_modules is missing
if not exist node_modules (
    echo.
    echo [INFO] First time setup detected!
    echo Installing required files. This may take a few minutes. Please wait...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Installation failed! Please check your internet connection.
        pause
        exit
    )
    echo [SUCCESS] Setup completed!
)

:: 3. Detect local network IP Address
set LOCAL_IP=localhost
node -e "const os = require('os'); const interfaces = os.networkInterfaces(); for (const dev in interfaces) { for (const details of interfaces[dev]) { if (details.family === 'IPv4' && !details.internal) { console.log(details.address); process.exit(0); } } } console.log('localhost');" > temp_ip.txt
set /p LOCAL_IP=<temp_ip.txt
del temp_ip.txt

echo.
echo =========================================================
echo Startup Options:
echo =========================================================
echo [1] Start System (Recommended - Normal Mode)
echo [2] Update/Rebuild System (Run this if you got a new version)
echo [3] Developer Mode (For coding)
echo =========================================================
set /p mode="Select an option (1, 2, or 3) [Default is 1]: "
if "%mode%"=="" set mode=1

if "%mode%"=="3" (
    echo.
    echo Starting server in Developer Mode...
    echo.
    echo ---------------------------------------------------------
    echo Chuti Leave Management System is starting!
    echo Access URLs:
    echo - Local computer:    http://localhost:3000
    echo - Network Access:    http://%LOCAL_IP%:3000
    echo ---------------------------------------------------------
    start http://localhost:3000
    call npm run dev-lan
) else if "%mode%"=="2" (
    echo.
    echo [INFO] Rebuilding the system... This will take a few minutes.
    call npm run build
    echo.
    echo [SUCCESS] Build complete! Starting server...
    echo.
    echo ---------------------------------------------------------
    echo Chuti Leave Management System is ready!
    echo Access URLs:
    echo - Local computer:    http://localhost:3000
    echo - Network Access:    http://%LOCAL_IP%:3000
    echo ---------------------------------------------------------
    start http://localhost:3000
    call npm run start-lan
) else (
    :: Mode 1: Start Normal System
    echo.
    if not exist .next (
        echo [INFO] First time startup: Building the system for speed...
        echo Please wait, this will take a few minutes...
        call npm run build
    )
    
    echo.
    echo Starting server...
    echo.
    echo ---------------------------------------------------------
    echo Chuti Leave Management System is ready!
    echo Access URLs:
    echo - Local computer:    http://localhost:3000
    echo - Network Access:    http://%LOCAL_IP%:3000
    echo ---------------------------------------------------------
    start http://localhost:3000
    call npm run start-lan
)
