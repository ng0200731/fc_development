# The Customer pattern (reference)

This is the canonical userform in the FC app. New forms must match it field-for-field and
function-for-function so the UI stays consistent.

## Field model (Customer)

```
Company (parent)
  ├─ name           TEXT  — company name
  └─ email_suffix   TEXT  — domain, no "@" (e.g. acme.com)

Member (child, 0..N per company)
  ├─ name           TEXT
  ├─ email_prefix   TEXT  — local part; full email = prefix + "@" + company.email_suffix
  ├─ title          TEXT
  └─ tel            TEXT
```

Generalize: **parent** has `name` + one "suffix"-style field (email domain or equivalent);
**child** has `name` + `email_prefix` + a few detail fields (`title`, `tel`, …).

## View data shape

`GET /api/customers` returns:
```json
[
  {
    "id": 1,
    "name": "Acme Inc",
    "email_suffix": "acme.com",
    "created_at": "2026-08-18T10:00:00",
    "members": [
      {"id": 1, "company_id": 1, "name": "Jane Doe",
       "email_prefix": "jane.doe", "title": "Engineer", "tel": "+1 555 0100",
       "created_at": "..."}
    ]
  }
]
```

`flattenRows()` turns that into one row per child (a parent with no children still yields one row
with empty child fields). The grid columns are then: `company, name, email, title, tel`.

## Frontend functions (in `app.js`)

| Function | Purpose |
|---|---|
| `renderCustomerCreate()` | Injects the two-step wizard (parent subtab first, child subtab `locked`). |
| `showMemberStep(name, suffix)` | Unlocks the child subtab, stores parent info on `panel.dataset`, builds the child form + pending list. |
| `renderCustomerView()` | `fetchJson("/api/customers")`, then `paintView()`. |
| `flattenRows(customers)` | parent+children → flat rows. |
| `paintView()` | Renders the grid, per-column search inputs, edit buttons, export button. |
| `openEditModal(companyId)` | Modal editing parent + children; save PUTs company and each member. |
| `removeMember(memberId)` | DELETE + refresh. |
| `saveCustomerWithMembers(...)` | POST company, then POST each member. |
| `apiPutCompany` / `apiAddMember` / `apiPutMember` | thin fetch wrappers. |
| `dummyCompany()` / `dummyMember()` | random plausible values. |
| `exportExcel(rows)` | CSV with BOM → download. |

## Shared helpers (already in `app.js`, reuse them)

- `fetchJson(url, opts)` — rejects with a clear error if the response isn't JSON.
- `escapeHtml(s)` — escape `& < > " '` before putting anything in `innerHTML`.
- `fuzzyMatch(text, q)` — case-insensitive **subsequence** match (not substring).
- `labels` map — `data-target` → display label.
- `API` constant (empty string = same origin).

## Backend (in `server.py`)

- `init_db()` creates `companies` and `members` tables.
- Endpoints: `POST /api/companies`, `GET /api/companies`, `GET /api/companies/<id>`,
  `PUT /api/companies/<id>`, `POST /api/companies/<id>/members`, `GET /api/customers`,
  `PUT /api/members/<id>`, `DELETE /api/members/<id>`.
- `json_response`, `read_json_body`, `db()`, `now_iso()` are shared helpers.
- The `Handler._route()` method maps paths→handlers; add new routes there.
