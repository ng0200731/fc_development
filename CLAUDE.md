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

## Don't test unless explicitly asked
I (Claude) should **focus on coding, not testing**. The user tests the app themselves in their own browser.
- **Do not** run end-to-end / UI reproduction tests (jsdom, Playwright, browser automation, test scripts) to verify behavior — unless the user explicitly asks me to test.
- When fixing a bug or implementing a feature, deliver the code change and explain what was changed. The user will verify the result themselves.
- This applies to **all** projects, not just this one (e.g. Pantone validation, edit-mode gating, etc.).
- A fix is considered done when the code is written and reasoned through — not when a test passes.

## Never use Playwright (or other browser automation)
Do **not** use Playwright (or similar browser-automation tools) to test the app, unless explicitly told to do so.
- You are not expected to verify the UI by driving a browser.
- The user tests the app themselves in their own browser.
- Do the verification you can at the code/API level (e.g. `curl` against the REST API, inspecting responses) without a headless browser.

## No browser pop-ups
Never use native browser pop-ups (`window.alert`, `window.confirm`, `window.prompt`, or blocking modal dialogs) in the frontend.
- Surface messages, confirmations, and prompts inside the page UI (e.g. inline banners, toasts, in-page modals built from DOM elements).
- This keeps the app consistent, avoids blocking the page thread, and lets the user interact with content normally.

## Warnings and test output must be copyable
Any warning, error, or test/diagnostic output shown to the user must be **selectable and copyable** — never trapped inside a non-selectable element or native dialog.
- Render warnings/test results as text in the page (a panel, console-style box, or log area) that the user can highlight and copy.
- Do not rely on `window.alert`/`confirm`, images of text, or canvas-rendered text for anything the user may need to copy.
