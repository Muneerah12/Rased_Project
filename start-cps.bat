@echo off
chcp 65001 >nul
title Rasid CPS
cd /d "%~dp0"

rem Starts the CPS backend on all interfaces (port 8001) so a NODE-04 ESP32 on
rem the same Wi-Fi can send to http://<this PC's IP>:8001, then starts Rasid.

if not exist "CPS-Project\.env" (
  echo Missing CPS-Project\.env - copy it in first. See NODE04_TEAMMATE_SETUP.md
  pause & exit /b 1
)
if not exist "server\.env" (
  echo Missing server\.env - copy it in first. See NODE04_TEAMMATE_SETUP.md
  pause & exit /b 1
)

cd CPS-Project
if not exist "backend\.venv\Scripts\python.exe" (
  echo [1/3] Creating CPS Python environment...
  py -3 -m venv backend\.venv 2>nul || python -m venv backend\.venv
)
if not exist "backend\.venv\installed.ok" (
  echo [1/3] Installing CPS requirements - first run only...
  backend\.venv\Scripts\python -m pip install -r backend\requirements.txt || goto :fail
  echo ok> "backend\.venv\installed.ok"
)

netsh advfirewall firewall show rule name="NODE-04 CPS 8001" >nul 2>&1
if errorlevel 1 (
  echo [2/3] Allowing port 8001 in Windows Firewall - approve the admin prompt...
  powershell -NoProfile -Command "Start-Process netsh -Verb RunAs -Wait -ArgumentList 'advfirewall firewall add rule name=\"NODE-04 CPS 8001\" dir=in action=allow protocol=TCP localport=8001'"
)

echo [3/3] Starting CPS backend on port 8001 and Rasid on 8010
start "CPS backend :8001" backend\.venv\Scripts\python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8001
cd ..
echo.
echo This PC's addresses - put the Wi-Fi one in the ESP32 BACKEND_URL:
ipconfig | findstr /c:"IPv4"
echo.
call start.bat
exit /b 0

:fail
echo Installing CPS requirements failed. Check the internet connection and Python 3.10+.
pause
