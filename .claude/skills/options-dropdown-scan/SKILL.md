---
name: options-dropdown-scan
description: Manage the FC "Settings / Options" dropdown system and avoid the recurring mistake of inventing or mirroring dropdowns that the forms do not actually render. Use whenever the user asks about Settings / Options, dropdown option lists, adding a new managed dropdown, the "Refresh" scan, which dropdowns exist per level (Customer / Development / Enquiry), or reports that a level "has the wrong dropdowns". Also use before adding any new opt(level,name) call site or extending _OPTION_GROUP_DEFS / OPTION_GROUPS, so the managed sets stay in sync with the forms.
---

# FC Options / Dropdown Scan

The FC app keeps selectable dropdown values (currency, payment term, shipment term,
product type, fabric, folding, …) in the `options` table (`data/fc.db`) and exposes them
through **Settings / Options** in the left nav. The values are rendered into the forms via
the `opt(level, name)` helper in `static/js/app.js`. This skill encodes two things:

1. **The mistake to avoid** — deciding which dropdowns exist by assumption or by copying
   another level, instead of reading the actual forms.
2. **The Refresh scan** — a button in Settings / Options that discovers every dropdown the
   forms really render and lets the user register any that aren't yet managed.

## The cardinal rule: scan the forms, never invent

A managed dropdown set is identified by a `(level, name)` pair, e.g.
`("customer", "currency")`. **A set should exist only if a form actually renders it via
`opt("customer", "currency")`.** Never add a set just because another level has a similar
one.

Concrete cases that bit us:

- **Do not mirror Customer onto Enquiry.** Customer has `currency`, `payment_term`,
  `shipment_term`. Enquiry does **not** — Enquiry / Create renders only Company & Member
  plus Images/Documents, with zero `<select>` dropdowns. So Enquiry's managed set is empty.
- **Do not keep a set the form no longer uses.** Enquiry / Edit still shows a Product type
  `<select>`, but it is wired to `opt("development", "product_type")` (the same domain),
  not to an enquiry-specific set. So there is no `("enquiry", "product_type")` group.
- **The truth lives in the code, not in memory.** Before changing which `(level, name)`
  pairs are managed, grep `static/js/app.js` for `opt("..."` and read what each Create /
  Edit / View function actually calls. The Settings / Options "Refresh" button does exactly
  this automatically (see below).

### Source of truth (in code)

- `static/js/app.js` — `opt(level, name)` returns `OPTION_SETS["level:name"]`. Every
  `<select>` populated from a managed list calls `opt(...)`. **This list is the canonical
  set of dropdowns that exist.**
- `static/js/app.js` — `OPTION_GROUPS` (and the server's `_OPTION_GROUP_DEFS`) are the
  *registry* of managed groups. They must be a subset of what `opt(...)` is called with.
- `server.py` — `_OPTION_GROUP_SEED` seeds the groups; `_OPTION_GROUP_DEFS` is the live,
  mutable dict loaded from the `option_groups` table at startup; the `options` table holds
  the actual values per `(level, name)`.

## The Refresh scan (Settings / Options)

The Settings / Options panel has two parts:

1. **Manage a dropdown** — pick a level + dropdown, then add / rename / delete / reorder
   values (unchanged behavior, DB-backed).
2. **Scan forms for dropdowns** — a "↻ Refresh — scan all levels" button plus a Level
   filter and a Search box.

How the scan works (so you can debug or extend it):

- It fetches `js/app.js` (no cache) and runs a regex for
  `opt("level", "name")` call sites. This is a genuine scan of the live form code — it
  cannot drift into inventing dropdowns, because it only reports what the forms render.
- It also fetches `GET /api/options/groups` (the server's managed set) and diffs the two.
- Each discovered dropdown is shown in a table with a **Status** of `managed` or `new`.
  `new` rows have an **Add** button.
- Clicking **Add** calls `POST /api/options/groups` with `{level, name, label}`. The server
  persists the group in the `option_groups` table and adds it to the live
  `_OPTION_GROUP_DEFS`, so it survives a restart and immediately appears in the
  "Manage a dropdown" dropdowns. The frontend also calls `registerOptionGroup(...)`
  so the UI updates without a reload.
- The Level `<select>` and Search `<input>` filter the table client-side (no re-fetch).

### When to run the scan

- After adding a new `opt(level, name)` `<select>` to any form — to surface the new
  dropdown for registration.
- When the user suspects a dropdown is missing or "wrong" for a level — the scan shows the
  ground truth, diffed against what's managed.
- Before manually editing `_OPTION_GROUP_DEFS` / `OPTION_GROUPS` or seeding new groups — let
  the scan confirm what the forms need first.

## Product type factory (per-type Fabric / Folding overrides)

Settings / Options also has a **Product type factory (Development)** card. This is
*not* an `opt(level, name)` managed set — it is a separate DB table (`product_type_factory`)
that overrides the Development → Fabric and Development → Folding lists **per product type**.
A product type with no rows in `product_type_factory` falls back to the global
Development Fabric/Folding lists (rendered by `fabricOptionsFor`/`foldingOptionsFor` in
`static/js/app.js`, which read the live `PRODUCT_TYPE_FACTORY` map, then
`PRODUCT_TYPE_FACTORY_SEED`, then `opt("development", …)`).

The card lets you pick a Development product type and edit its Fabric / Folding option
lists independently — add / rename / delete / reorder — via the API below. These changes
are what drive the product-type-aware dropdowns in Development / Create (material popup)
and Development / Edit.

### API surface (server.py)

- `GET    /api/product-type-factory` — `{ "<product_type>": { "fabric": [{id,value}], "folding": [{id,value}] }, … }`.
- `POST   /api/product-type-factory` — add `{ product_type, kind: "fabric"|"folding", value }` (409 if duplicate, 400 if kind invalid).
- `PUT    /api/product-type-factory/reorder` — `{ product_type, kind, orderedValues:[...] }` re-packs positions.
- `PUT    /api/product-type-factory/<id>` — rename `{ value }` (409 on clash).
- `DELETE /api/product-type-factory/<id>` — delete + re-pack positions.

Frontend pulls this into `PRODUCT_TYPE_FACTORY` via `loadProductTypeFactory()` at startup;
`fabricOptionsFor(product, current)` / `foldingOptionsFor(product, current)` consume it.

## Checklist before changing the managed sets

1. Grep `static/js/app.js` for `opt("LEVEL"` and list every `name` used there.
2. Confirm each `(level, name)` you intend to manage is actually rendered by a form — if
   not, that's a sign you're mirroring/inventing; stop and re-check with the user.
3. Update the registry in **both** places: server (`_OPTION_GROUP_SEED` so fresh DBs seed
   it; `_OPTION_GROUP_DEFS` is rebuilt from `option_groups`) and frontend
   (`OPTION_GROUPS`, rebuilt by `loadOptions()`).
4. If it's a brand-new dropdown, the user can simply click **Refresh → Add** in Settings /
   Options; no code edit to the registry is needed because the API persists it.
5. Restart the server (`start.bat` or `python server.py`) so `init_db()` reloads the
   `option_groups` table into `_OPTION_GROUP_DEFS`.
