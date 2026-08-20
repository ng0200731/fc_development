# FC Project

A small Python web app (frontend + SQLite API) served by `server.py` on port 8088.

## Project layout (the hierarchy)
```
fc/
├── server.py        # main web server: serves static/ frontend + SQLite REST API
├── start.bat        # launches server on :8088 and opens the browser
├── .gitignore
├── static/          # the web frontend (this is what the browser loads)
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── pantone-*.json/.csv   # color data, fetched at runtime
└── data/            # runtime data (gitignored)
    └── fc.db        # THE live SQLite database (server reads this)
```
- `server.py` serves files from `static/` and reads `data/fc.db`.
- `data/` is gitignored, so the DB is never committed — only `static/` and source files are.
- The frontend (HTML/CSS/JS) lives entirely under `static/`; the root holds only the
  server, launcher, and docs. No generated/scratch artifacts belong at the root.

## Important rule: test scripts are temporary
Any scratch/test `.py` file (ad-hoc debugging scripts) is **temporary**.
- Once it has served its purpose (verified, debugged, answered the question), **delete it** — do not leave it in the repo.
- Do not rely on these files being present; they are not part of the shipped app.
- If a test script turns out to be genuinely useful long-term, convert it into a proper module under a clear name and intent, or move it out of the project root.

## Running
Use `start.bat` to start the server (Windows). The server runs in the background and opens `http://localhost:8088`.

## Never use Playwright (or other browser automation)
Do **not** use Playwright (or similar browser-automation tools) to test the app, unless explicitly told to do so.
- You are not expected to verify the UI by driving a browser.
- The user tests the app themselves in their own browser.
- Do the verification you can at the code/API level (e.g. `curl` against the REST API, inspecting responses) without a headless browser.
