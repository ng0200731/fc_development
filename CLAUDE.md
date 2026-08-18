# FC Project

A small Python web app (frontend + SQLite API) served by `server.py` on port 8088.

## Project layout
- `server.py` — main web server (frontend + SQLite API)
- `fc.db` — SQLite database
- `data/` — runtime data (gitignored)
- `static/` — frontend assets
- `start.bat` — launches the server on port 8088 and opens the browser
- `check_db.py` — one-off DB inspection script (see below)

## Important rule: test scripts are temporary
Any scratch/test `.py` file (e.g. `check_db.py`, ad-hoc debugging scripts) is **temporary**.
- Once it has served its purpose (verified, debugged, answered the question), **delete it** — do not leave it in the repo.
- Do not rely on these files being present; they are not part of the shipped app.
- If a test script turns out to be genuinely useful long-term, convert it into a proper module under a clear name and intent, or move it out of the project root.

## Running
Use `start.bat` to start the server (Windows). The server runs in the background and opens `http://localhost:8088`.
