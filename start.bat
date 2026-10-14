@echo off
REM ============================================================
REM  Start the FC web app (auto-picks a free port)
REM  The Project A app is on :4500 - do NOT use that port.
REM
REM  Windows (Hyper-V/WSL) reserves shifting TCP ranges each boot,
REM  so a fixed port can be refused (WinError 10013) even when it
REM  looks free. server.py therefore tries 8099, then a spread of
REM  fallback ports, and writes the winner to data\port.txt.
REM  This script waits for that file and opens the browser on the
REM  real port. Check exclusions with:
REM    netsh interface ipv4 show excludedportrange protocol=tcp
REM
REM  NOTE: never run two server.py instances at once - a second
REM  listener splits /uploads/ traffic between the old (crashing)
REM  and new server, leaving half the images broken. Only one
REM  python.exe should hold the port.
REM ============================================================
set PYTHON="C:\Users\ng\AppData\Local\Programs\Python\Python311\python.exe"

echo Starting FC server (Project A is on :4500, do NOT use that) ...
echo.

REM Remove yesterday's port file so we never read a stale value
if exist "%~dp0data\port.txt" del "%~dp0data\port.txt"

REM Start server in background (it picks the port and writes data\port.txt)
start "" /B %PYTHON% "%~dp0server.py"

REM Poll for data\port.txt for up to ~6 seconds
set PORT=
for /L %%i in (1,1,30) do (
  if not defined PORT (
    if exist "%~dp0data\port.txt" (
      set /p PORT=<"%~dp0data\port.txt"
    ) else (
      ping -n 2 127.0.0.1 >nul
    )
  )
)

if not defined PORT (
  echo.
  echo [ERROR] The server did not start. Read the Python traceback above.
  echo         Likely cause: every candidate port is in a Windows-excluded
  echo         range. Check:  netsh interface ipv4 show excludedportrange
  pause >nul
  exit /b 1
)

echo Server is running on port %PORT%.
echo   This PC  : http://localhost:%PORT%
echo   LAN users: http://%COMPUTERNAME%:%PORT%
echo.

start "" "http://localhost:%PORT%"

echo Close this window or press CTRL+C to stop.
pause >nul
