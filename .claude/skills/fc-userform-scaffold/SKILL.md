---
name: fc-userform-scaffold
description: Generate a Create wizard + View table for a new "userform" (data entry form) in the FC web app, following the exact Customer pattern. Use whenever the user wants to add a new form/page to FC — e.g. "add a Development form", "make a Vendor create/view", "scaffold a new userform", "new entity with create and view", or any request to extend the FC app with another left-nav entry that has a two-step create wizard and a searchable table. This covers the Dummy data-fill button, the Company→Member two-step wizard, the flat View table with per-column fuzzy search, edit modal, remove, and Excel export.
---

# FC Userform Scaffold

The FC app (`d:\project\fc`) is a small Python web app: `server.py` serves a SQLite API plus the
static frontend under `static/`. Every "userform" (a business entity the user can create and browse)
follows one pattern, first established by **Customer** (`customer-create` / `customer-view` in the
left nav). When the user wants another form — Development, Vendor, anything — reproduce that pattern
rather than inventing a new one. Consistency is the whole point: the nav, the wizard, the table, the
Dummy button, and the export should all look and behave identically across forms.

## The Customer pattern at a glance

- **Left nav** (`static/index.html`): a collapsible `<div class="group" data-group="X">` containing
  two `<a class="nav-item" data-target="X-create">Create</a>` / `X-view`.
- **Router** (`static/js/app.js`): `labels["X-create"]`, `labels["X-view"]` entries; `renderPanel()`
  branches on the target and calls `renderXCreate()` / `await renderXView()`.
- **Create wizard** (`renderXCreate`): two-step subtab flow — *Parent* (e.g. Company) → *Child*
  (e.g. Member). Each step has a **Dummy** button that fills plausible random values.
- **View table** (`renderXView`): fetches a flat list, flattens parent+children to rows, renders a
  grid with a fuzzy per-column search row, an edit modal, a row-remove action, and an **Export Excel**
  (CSV with BOM) button.
- **Backend** (`server.py`): tables for parent + child, CRUD endpoints, and a `GET /api/<plural>`
  flat-list endpoint for the View page.

Read [references/pattern.md](references/pattern.md) for the exact field model, function signatures,
and the data shape the View fetches. Read it before writing code so the new form matches Customer
field-for-field.

## How to scaffold a new userform

1. **Clarify the entity.** Confirm the parent/child names and the fields. For Customer the model is
   `Company (name, email_suffix)` → `Member (name, email_prefix, title, tel)`. A new form almost
   always has the same shape: one parent header record + many child rows. Ask the user for:
   - parent label + fields (with types: text / email-prefix / tel)
   - child label + fields
   - the API resource name (plural, lowercase, e.g. `developments`)
   If the user just says "add a Development form", default to mirroring Customer's field set unless
   they specify otherwise.

2. **Run the generator.** Use [scripts/generate_userform.py](scripts/generate_userform.py) — it emits
   all four pieces (nav HTML, `app.js` functions, backend API stubs, SQL schema) from a single entity
   description so you never hand-copy the Customer code. Example:

   ```bash
   python .claude/skills/fc-userform-scaffold/scripts/generate_userform.py \
     --parent Development --child Task \
     --parent-fields "name:text" "email_suffix:text" \
     --child-fields "name:text" "email_prefix:text" "title:text" "tel:text" \
     --resource developments
   ```

   The script prints labeled code blocks. It does **not** edit files (keeps the user in control); you
   paste the blocks into the right places. See the script's `--help` for the full option set and the
   `escapeHtml` / `fetchJson` / `fuzzyMatch` helpers it assumes already exist in `app.js`.

3. **Wire it in.** Insert the generated nav `<div class="group">` into `static/index.html` (after the
   Customer group). Add the `labels` entries and `renderPanel()` branches in `static/js/app.js`. Append
   the generated functions to `app.js`. Add the backend tables/endpoints to `server.py` and register
   them in the `Handler._route` router.

4. **Verify.** Start the server (`start.bat` or `python server.py`) and confirm: nav entry appears,
   Create wizard opens with working Dummy buttons on both steps, a record can be saved, View shows it,
   fuzzy search + export work. Delete any scratch test files afterward (see FC `CLAUDE.md`).

## Things to preserve exactly

- The **Dummy** button on *every* step — users rely on it to fill the form fast.
- Two-step subtab wizard with the `locked`/`done`/active states from `style.css`.
- Fuzzy `subsequence` search (see `fuzzyMatch` in `app.js`), not substring.
- CSV export with the UTF-8 BOM (`"﻿"` prefix) so Excel opens it correctly.
- `escapeHtml` on every value injected into `innerHTML`.

## Notes / limitations

- The current `server.py` hardcodes the companies/members schema. The generated backend stubs are a
  starting point — adapt the column names to the new tables. Don't break the existing Customer endpoints.
- Keep new functions in the same imperative style as the Customer code; don't introduce a framework.
