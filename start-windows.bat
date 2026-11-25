@echo off
rem Deja Vu1: double-click to start the dashboard. It stops by itself 5 minutes after its last page closes, and never starts with the computer.
rem It runs on Python 3.8 or newer. When Python is missing, this file offers to install it with winget, Windows' own installer.
setlocal
cd /d "%~dp0"
set "PY="
py -3 -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>nul && set "PY=python"
if not defined PY for /d %%d in ("%LOCALAPPDATA%\Programs\Python\Python3*" "%ProgramFiles%\Python3*") do if exist "%%~d\python.exe" set PY="%%~d\python.exe"
set "WG="
if not defined PY where winget >nul 2>nul && set "WG=1"
if not defined PY if defined WG (
  echo.
  echo Deja Vu1 runs on Python, a free program from python.org, and Python isn't on this computer yet.
  echo Windows can install it for you now with winget, its own installer. Nothing else is installed.
  choice /c YN /m "Install Python 3.12 now"
)
if not defined PY if defined WG if not errorlevel 2 (
  winget install -e --id Python.Python.3.12
  for /d %%d in ("%LOCALAPPDATA%\Programs\Python\Python3*" "%ProgramFiles%\Python3*") do if exist "%%~d\python.exe" set PY="%%~d\python.exe"
)
if not defined PY (
  echo.
  echo Deja Vu1 couldn't start: it needs Python 3.8 or newer, and Python isn't on this computer yet.
  echo 1. Open https://www.python.org/downloads/ and press the yellow Download button.
  echo 2. Run the file it downloads. On its first page, tick "Add python.exe to PATH", then press Install Now.
  echo 3. Double-click this file again.
  pause
  exit /b 1
)
rem Since 0.15.0 Deja Vu1 runs apart from this window: closing it doesn't stop Deja Vu1.
%PY% start.py
if errorlevel 1 (
  echo.
  echo Deja Vu1 couldn't start. The reason is printed above. Its notes are in backend\data\logs.
)
pause
