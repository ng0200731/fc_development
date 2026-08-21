#!/usr/bin/env node
// FC project compliance gate (PreToolUse hook).
// Enforces the hard rules from d:\project\fc\CLAUDE.md that a hook can
// mechanically block, so they hold even if the model drifts:
//   1. No browser automation / Playwright / Puppeteer / jsdom / Selenium / headless.
//   2. No ad-hoc test scripts (test_* / tmp_* / check_*) are *run* unless the
//      user explicitly opts in with the --fc-allow-test marker.
//   3. No native browser pop-ups (window.alert / window.confirm / window.prompt).
//
// Escape hatch: append "--fc-allow-test" to a Bash command to bypass rules 1+2
// (for a user-explicitly-requested test). Rule 3 (pop-ups) is never bypassed.

import { readFileSync } from "node:fs";

function readStdin() {
  try {
    const raw = readFileSync(0, "utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {}; // malformed input — fail open
  }
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function allow() {
  process.stdout.write(JSON.stringify({ decision: "approve" }));
  process.exit(0);
}

const input = readStdin();
const tool = input.tool_name || "";
const bypass = (input.tool_input?.command || "").includes("--fc-allow-test");

// --- Rule 1 + 2: Bash commands ----------------------------------------------
if (tool === "Bash") {
  const cmd = input.tool_input?.command || "";

  const automation = /\b(playwright|puppeteer|selenium|webdriver|jsdom|headless)\b|npx\s+(?:[-a-z]+\s+)*playwright/i;
  if (!bypass && automation.test(cmd)) {
    block(
      "FC rule violated — browser automation / Playwright / jsdom is never allowed " +
      "unless you explicitly ask. Open the app yourself to verify. " +
      "(If you really meant to run a test, re-run with the '--fc-allow-test' marker.)"
    );
  }

  // Running scratch test scripts (test_*.py, tmp_*.mjs/js/py, check_*.py).
  const testRun = /(?:^|[\s;"&|`]|node\s+|python3?\s+|deno\s+|bun\s+)(?:["./\\]*)?(test_|tmp_|check_)[^\s"'`;&|]*\.(?:mjs|js|py)\b/i;
  if (!bypass && testRun.test(cmd)) {
    block(
      "FC rule violated — do not run ad-hoc test scripts (test_/tmp_/check_*.{mjs,js,py}). " +
      "Deliver code + explanation; let the user verify in their browser. " +
      "(User-explicit test? re-run with the '--fc-allow-test' marker.)"
    );
  }

  allow();
}

// --- Rule 3: native pop-ups in Write/Edit -----------------------------------
if (tool === "Write" || tool === "Edit") {
  const newText = input.tool_input?.new_string || input.tool_input?.content || "";
  const popup = /\bwindow\.(alert|confirm|prompt)\s*\(/;
  if (popup.test(newText)) {
    block(
      "FC rule violated — never use window.alert / window.confirm / window.prompt. " +
      "Surface messages inside the page UI (inline banner, toast, or in-page modal). " +
      "No escape hatch: pop-ups are disallowed in this project."
    );
  }
  allow();
}

allow();
