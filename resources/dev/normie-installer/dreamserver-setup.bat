@echo off
:: ============================================================================
:: DreamServer — Windows One-Click Installer
:: ============================================================================
:: Double-click this file to install DreamServer.
:: It will request administrator privileges and handle everything:
::   1. Enable WSL2
::   2. Install Docker Desktop
::   3. Install DreamServer
::
:: This file is just a launcher. All logic lives in dreamserver-setup.ps1.
:: ============================================================================

title DreamServer Setup

:: Check if running as admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   DreamServer needs administrator privileges to set up WSL2 and Docker.
    echo   Requesting elevation...
    echo.
    powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
    exit /b
)

:: Run the PowerShell installer
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%dreamserver-setup.ps1"

:: Keep window open so user can see results
echo.
pause
