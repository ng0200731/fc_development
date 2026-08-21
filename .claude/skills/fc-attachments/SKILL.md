---
name: fc-attachments
description: Implement and debug file attachment (image + document) save/fetch in the FC web app — the Part 4 "Documents" + image upload flow. Use whenever the user reports that attachments can't be saved, don't appear on reload, don't show in Development / View, or vanish after Edit; or when adding/extending any file-upload, drag-drop, paste, or attachment-display feature to FC (Create, View, Edit, Dummy). Covers the server /api/uploads + /uploads/ serve endpoints, the SQLite name-only storage model, and the assetUrl resolution rule.
---

# FC Attachments — save & fetch for images and documents

FC stores **attachments as name-only strings in SQLite** and keeps the actual bytes on disk under
`data/uploads/`. The number-one recurring bug is treating a dropped file as a `blob:` URL or a bare
filename: those don't survive a save→reload→edit round-trip. This skill nails the correct pattern.

## The storage model (read this first)

- **DB never holds file bytes.** `developments` has two JSON-string columns:
  - `image_names` — array of strings. A user-uploaded image looks like `"uploads/<uuid>__<orig>"`;
    a Dummy/sample image looks like `"M16921-900x650.jpg"` (no `uploads/` prefix).
  - `doc_names` — array of strings, always `"uploads/<uuid>__<orig>"`.
- **Bytes live on disk** at `data/uploads/<uuid>__<sanitized-original>`. `data/` is gitignored.
- **The `<uuid>__<orig>` prefix** is the dedup/safety marker; strip it for display with `displayName`.
- Column presence is guarded by `_DEV_MISSING_COLUMNS` / `_ensure_dev_columns()` migration in
  `server.py` — don't assume `doc_names` exists on old DBs without the guard.

## Server side (`server.py`)

Two pieces already exist; reuse them, don't re-implement:

1. **`POST /api/uploads`** → `api_upload_file(handler)`. Reads `multipart/form-data`, field
   `file`. Saves to `UPLOADS_DIR` as `<uuid4().hex>__<sanitized>`, returns
   `{"path": "uploads/...", "name": "<orig>", "url": "/uploads/..."}` (HTTP 201).
   - `UPLOADS_DIR = os.path.join(BASE_DIR, "data", "uploads")` (created at startup).
   - `_sanitize_filename` strips `/ \` and `..` to prevent traversal.
2. **`GET /uploads/<rest>`** → `serve_upload(handler, rel)`. `safe_upload_path(rel)` aborts (404)
   if the resolved path escapes `UPLOADS_DIR`. Serves with extension-based `Content-Type` and
   `Cache-Control: public, max-age=3600`. PDFs/docs served inline so `<a download>` works.

Front-end upload: `fetch(API + "/api/uploads", { method: "POST", body: FormData(file) })`.

## Front-end resolution rule (the part people get wrong)

There is **one** resolver. `assetUrl(name)`:
```js
function assetUrl(name) {
  if (!name) return "";
  if (name.startsWith("uploads/")) return API + "/" + name;   // user bytes
  return API + "/sample-images/" + name;                      // legacy Dummy/sample
}
```
Use `assetUrl` for **every** image `<img src>` and document `<a href>` in View and Edit seeding.
Do **NOT** use `imageUrl` for documents, and do **NOT** pass bare `blob:` URLs through `buildDevelopmentPayload`.

## The correct create→save→fetch→edit flow

### Create / drag-drop / paste (images)
- `addImageFile(file)`: show optimistic `blob:` thumb with `uploading:true`, then `uploadImageFile`
  calls `/api/uploads`, and on success rewrites the entry to `{ name: data.path, url: data.url, uploading:false }`.
- Only then does `buildDevelopmentPayload()` pick up `image_names: devState.images.map(i => i.name)`
  — which is now the `uploads/...` path, not a `blob:`.

### Documents (drag-drop in Part 4)
- `addDocFiles(fileList)` **must upload**, not store the File object:
  ```js
  const r = await uploadFile(f);
  docs.push({ id, name: r.path, url: API + r.path, file: f, uploading: false });
  ```
- `renderDocList()` shows `formatBytes(d.file.size)` while editing, or `"saved"` when `file` is null
  (reloaded/edited rows have no bytes). Show an `uploading…` badge while the POST is in flight.

### View (`paintDevelopmentView`)
- Images: `<img class="dev-thumb-sm" src="${assetUrl(n)}" …>` for each `image_names`.
- Documents: clickable download links, not plain spans:
  ```js
  (r.doc_names||[]).map(n =>
    `<a class="doc-tag" href="${assetUrl(n)}" target="_blank" rel="noopener" download title="${escapeHtml(n)}">📄 ${escapeHtml(n)}</a>`)
  ```

### Edit (`editDevelopmentInCreate`)
- Seed `devState.images` from `rec.image_names` with `url: assetUrl(n)`.
- Seed `devState.docs` from `rec.doc_names` with `file: null` (bytes gone after reload; shows
  `"saved"`). Re-saving re-links to the already-persisted `/uploads/...` file — no re-upload needed.
- **Never** resolve saved names through `ensureImagePool()`/`findInPool()` — that only knows sample
  images and would return `""` for `uploads/...` paths (the classic "attachment disappears on edit" bug).

## CSS
- `.doc-tag` is now an `<a>`: give it link color, `text-decoration:none`, hover border/background,
  and `:visited` keeps the same color (see `static/css/style.css` `.doc-tag`).
- `.thumb-badge.uploading` styles the `uploading…` pill on image thumbs and doc rows.

## Debugging checklist (when user says "can't fetch attachment")
1. Is the file actually on disk? `ls data/uploads/`. If missing → upload endpoint failed (check
   `buildDevelopmentPayload` was given `uploads/...` names, not `blob:` or orig filename).
2. Is the DB column storing `uploads/...`? `curl localhost:8088/api/developments/<id>` and inspect
   `image_names` / `doc_names`. Bare filenames or `blob:` = wrong payload.
3. Does `GET /uploads/<rest>` return 200? 404 = path escaped sandbox (traversal guard) or wrong rel.
4. Is the View using `assetUrl`? A `blob:`/sample-only resolver won't load `uploads/...`.
5. On Edit, are images/docs seeded via `assetUrl`, not `findInPool`?

## Hard rules
- No browser automation / Playwright (CLAUDE.md forbids it). Verify at API level with `curl`.
- No `window.alert`/`confirm`/`prompt` — use in-page `openConfirmModal`.
- Test scripts are temporary — delete any scratch `.py` after verifying.
