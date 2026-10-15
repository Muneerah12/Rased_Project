@echo off
chcp 65001 >nul
title Rasid AI
cd /d "%~dp0server"

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Creating Python environment...
  py -3 -m venv .venv 2>nul || python -m venv .venv
)
call ".venv\Scripts\activate.bat"

if not exist ".venv\installed.ok" (
  echo [2/3] Installing requirements - first run only, takes a few minutes...
  python -m pip install --upgrade pip
  python -m pip install -r requirements.txt || goto :fail
  echo ok> ".venv\installed.ok"
)

if not exist ".env" copy ".env.example" ".env" >nul

echo [3/3] Starting Rasid on http://localhost:8010
start "" cmd /c "timeout /t 4 >nul & start http://localhost:8010"
python -m uvicorn main:app --host 0.0.0.0 --port 8010
pause
exit /b 0

:fail
echo.
echo Installing requirements failed. Check the internet connection and Python 3.10+ then run start.bat again.
pause
