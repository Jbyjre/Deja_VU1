@echo off
rem Deja Vu1: double-click to start the dashboard. Close this window to stop it.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py -3 start.py) else (python start.py)
if errorlevel 1 (
  echo.
  echo Deja Vu1 couldn't start. It needs Python 3.8 or newer: https://www.python.org/downloads/
  echo When installing, tick "Add python.exe to PATH".
)
pause
