@echo off
REM ============================================================
REM  Start the FC web app
REM  Serves d:\project\fc on port 8088 (frontend + SQLite API).
REM  This PC  : http://localhost:8088
REM  LAN users: http://%COMPUTERNAME%:8088  (or your LAN IP)
REM ============================================================
REM
REM  Modified: killed both stale processes and started ONE fresh server.
REM  Verified against the live port:
REM    real-img: 200 image/png
REM    nxb-doc:  200 application/pdf
REM    index:    200
REM
REM  NOTE: never run two server.py instances on :8088 - a second listener
REM  splits /uploads/ traffic between the old (crashing) and new server,
REM  leaving half the images broken. Only one python.exe should hold :8088.
REM ============================================================
set PORT=8088
set PYTHON="C:\Users\ng\AppData\Local\Programs\Python\Python311\python.exe"

echo Starting FC server on port %PORT% (the Project A app is on :4500, do NOT use that) ...
echo This PC  : http://localhost:8088
echo LAN users: http://%COMPUTERNAME%:8088
echo (others can also use your LAN IP, e.g. http://192.168.31.31:8088)
echo.
echo Press CTRL+C to stop.
echo.

REM Start server in background, wait for it to boot, then open browser
start "" /B %PYTHON% "%~dp0server.py"

REM Give the server a moment to start listening
timeout /t 2 /nobreak >nul

REM Explicitly open the FC app (NOT the other project on :4500).
start "" "http://localhost:8088"

REM Keep this window open (server runs in background above)
echo Server is running. Close this window or press CTRL+C to stop.
pause >nul
