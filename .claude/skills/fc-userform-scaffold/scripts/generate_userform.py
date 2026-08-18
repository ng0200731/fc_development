#!/usr/bin/env python3
"""
Generate the four code blocks needed to add a new "userform" to the FC app,
mirroring the existing Customer Create/View pattern.

The script does NOT edit any project files — it prints labeled code blocks that
you paste into the right places (static/index.html, static/js/app.js, server.py).
This keeps the user in control and lets the model adapt the output before applying.

Usage
-----
  python generate_userform.py \
      --parent Development --child Task \
      --parent-fields "name:text" "email_suffix:text" \
      --child-fields "name:text" "email_prefix:text" "title:text" "tel:text" \
      --resource developments

Options
-------
  --parent NAME        Parent (header) entity label, e.g. "Development".
  --child NAME         Child entity label, e.g. "Task".
  --parent-fields K:T   One or more "field:type" where type is text|email_suffix.
  --child-fields K:T    Same for the child. email_prefix is rendered with a suffix affix.
  --resource NAME      Plural lowercase API resource, e.g. "developments".
  --group KEY           Nav group key (default: lowercased parent).
  --db-parent TABLE    Parent DB table (default: lowercased parent + "s").
  --db-child TABLE     Child DB table (default: lowercased child + "s").

Assumptions (already present in the FC app, do NOT regenerate):
  - app.js defines: fetchJson, escapeHtml, fuzzyMatch, labels (map), API (const),
    and the word pools FIRST, LAST, TITLE, COMP, SUFFIX.
  - style.css defines: .group, .nav-item, .subtabs, .subtab, .subpanel, .field,
    .input-affix, .grid, .col-search, .modal-overlay, .icon-btn, .btn, etc.
"""

import argparse
import io
import sys

EMAIL_SUFFIX_TYPE = "email_suffix"   # parent: rendered with "@" prefix affix
EMAIL_PREFIX_TYPE = "email_prefix"   # child: rendered with "@<suffix>" suffix affix


def camel(s):
    parts = s.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def pascal(s):
    return s[0].upper() + s[1:] if s else s


def parse_fields(specs):
    out = []
    for spec in specs:
        if ":" not in spec:
            sys.exit(f"Bad field spec '{spec}' — expected field:type")
        name, ftype = spec.split(":", 1)
        out.append({"name": name, "type": ftype, "camel": camel(name), "pascal": pascal(name)})
    return out


def el_var(prefix, field):
    """JS const name for a field's element, e.g. cmpNameEl / mbrEmailPrefixEl."""
    return prefix + field["pascal"] + "El"


def parent_name_field(pf):
    for f in pf:
        if f["name"] == "name":
            return f
    return pf[0]


def suffix_field(pf):
    for f in pf:
        if f["type"] == EMAIL_SUFFIX_TYPE:
            return f
    return pf[-1]


def child_fields_except_name(cf):
    return [f for f in cf if f["name"] != "name"]


# ---------------------------------------------------------------------------
# 1. Left-nav HTML (paste into static/index.html, after the Customer group)
# ---------------------------------------------------------------------------
def nav_html(group, parent, child):
    g, p = group, parent.lower()
    return f"""  <div class="group" data-group="{g}">
    <button class="group-toggle" aria-expanded="true">
      <span class="caret">&#9662;</span> {pascal(g)}
    </button>
    <ul class="group-items">
      <li><a class="nav-item" data-target="{p}-create" href="#">Create</a></li>
      <li><a class="nav-item" data-target="{p}-view" href="#">View</a></li>
    </ul>
  </div>"""


# ---------------------------------------------------------------------------
# 2. app.js: labels + renderPanel branches
# ---------------------------------------------------------------------------
def app_js_labels(parent):
    p = parent.lower()
    return f"""  "{p}-create": "{pascal(parent)} / Create",
  "{p}-view":   "{pascal(parent)} / View","""


def app_js_branches(parent):
    p = parent.lower()
    return f"""  if (activeTarget === "{p}-create") {{
    render{pascal(parent)}Create();
    return;
  }}
  if (activeTarget === "{p}-view") {{
    await render{pascal(parent)}View();
    return;
  }}"""


# ---------------------------------------------------------------------------
# Field row markup for the create wizard
# ---------------------------------------------------------------------------
def js_field_input(field, with_suffix_affix=None):
    name, ftype = field["name"], field["type"]
    cid = "cmp-" + name if field.get("is_parent") else "mbr-" + name
    label = name.replace("_", " ").capitalize()
    if ftype == EMAIL_SUFFIX_TYPE:
        return f"""      <div class="field">
        <label for="{cid}">{label} <span class="hint">(no "@")</span></label>
        <div class="input-affix">
          <span class="at">@</span>
          <input id="{cid}" type="text" placeholder="{label}" autocomplete="off" />
        </div>
      </div>"""
    if ftype == EMAIL_PREFIX_TYPE:
        return f"""      <div class="field">
        <label for="{cid}">Email prefix <span class="hint">(suffix follows parent)</span></label>
        <div class="input-affix">
          <input id="{cid}" type="text" placeholder="jane.doe" autocomplete="off" />
          <span class="suffix">@{with_suffix_affix}</span>
        </div>
      </div>"""
    return f"""      <div class="field">
        <label for="{cid}">{label}</label>
        <input id="{cid}" type="text" placeholder="{label}" autocomplete="off" />
      </div>"""


def dummy_value_expr(field):
    """A JS expression producing a plausible dummy value for one child field."""
    c = field["camel"]
    if field["name"] == "name":
        return "first + \" \" + last"
    if field["type"] == EMAIL_PREFIX_TYPE:
        return "(first + \".\" + last).toLowerCase()"
    if field["name"] == "title":
        return "rnd(TITLE)"
    if field["name"] == "tel":
        return "\"+\\\" + (Math.floor(Math.random()*90)+10) + \" \" + (Math.floor(Math.random()*900)+100) + \" \" + (Math.floor(Math.random()*9000)+1000)"
    if field["type"] == EMAIL_SUFFIX_TYPE:
        return "rnd(SUFFIX)"
    return "rnd(TITLE)"


# ---------------------------------------------------------------------------
# 3. app.js: Create wizard + View functions
# ---------------------------------------------------------------------------
def js_create(parent, child, parent_fields, child_fields):
    P, p = pascal(parent), parent.lower()
    c, C = child.lower(), pascal(child)
    pf, cf = parent_fields, child_fields
    pname = parent_name_field(pf)
    suf = suffix_field(pf)
    cfields = child_fields_except_name(cf)

    parent_inputs = "\n".join("      " + js_field_input(dict(f, is_parent=True)) for f in pf)
    parent_consts = "\n".join(
        f'  const {el_var("cmp", f)} = panel.querySelector("#cmp-{f["name"]}");' for f in pf
    )
    parent_validate = " && ".join(f'{el_var("cmp", f)}.value.trim()' for f in pf)
    parent_dummy_assign = "\n".join(
        f'    {el_var("cmp", f)}.value = d.{f["camel"]};' for f in pf
    )
    parent_data_props = ",\n        ".join(
        f'{f["name"]}: {el_var("cmp", f)}.value.trim()' for f in pf
    )

    child_inputs = "\n".join("        " + js_field_input(f, f"${{escapeHtml(parentData.{suf['camel']})}}") for f in cf)
    child_consts = "\n".join(
        f'    const {el_var("mbr", f)} = childSec.querySelector("#mbr-{f["name"]}");' for f in cf
    )
    child_validate = " && ".join(f'{el_var("mbr", f)}.value.trim()' for f in cf)
    child_dummy_assign = "\n".join(
        f'      {el_var("mbr", f)}.value = d.{f["camel"]};' for f in cf
    )
    child_push_props = ",\n        ".join(
        f'{f["name"]}: {el_var("mbr", f)}.value.trim()' for f in cf
    )
    child_clear = " = ".join(el_var("mbr", f) + ".value" for f in cf) + ' = ""'

    # flatten row fields: company (= parent name), suffix, then each child field
    row_props = f'        company: it.{pname["camel"]},\n        suffix: it.{suf["camel"]},'
    child_row_props = "\n".join(
        f'        {f["name"]}: ch ? ch.{f["name"]} : "",' for f in cf
    )
    # view columns
    cols = [{"key": "company", "label": pname["pascal"]}]
    cols += [{"key": f["name"], "label": f["pascal"]} for f in cfields]
    col_defs = ",\n".join(f'    {{ key: "{x["key"]}", label: "{x["label"]}" }}' for x in cols)
    body_tds = "".join(f'\n        <td>${{escapeHtml(r.{x["key"]})}}</td>' for x in cols)

    # dummy child return props
    dummy_child_props = ",\n    ".join(
        f'{f["camel"]}: {dummy_value_expr(f)}' for f in cf
    )
    dummy_parent_props = ",\n    ".join(
        (f'{f["camel"]}: rnd(COMP) + " " + rnd(["Inc","LLC","Corp","Group","Labs"])' if f["name"] == "name"
         else f'{f["camel"]}: rnd(SUFFIX)')
        for f in pf
    )

    # modal parent field rows + save props
    modal_fields = "\n".join(
        f'''      <div class="field">
        <label for="ed-{f['name']}">{f['name'].replace('_',' ').capitalize()}</label>
        <input id="ed-{f['name']}" type="text" value="${{escapeHtml(item.{f['camel']})}}" />
      </div>''' for f in pf
    )
    save_props = ", ".join(
        f'{f["name"]}: overlay.querySelector("#ed-{f["name"]}").value.trim()' for f in pf
    )

    return f"""// ---------------------------------------------------------------------------
// {P} / Create  — two-step wizard (Parent -> Child)
// ---------------------------------------------------------------------------

function render{P}Create() {{
  panel.innerHTML = `
    <h2>{P} / Create</h2>
    <div class="subtabs" id="createSubtabs" role="tablist">
      <button class="subtab active" data-step="parent" role="tab">Parent</button>
      <button class="subtab locked" data-step="child" role="tab" disabled>Child</button>
    </div>

    <!-- PARENT STEP -->
    <div class="subpanel" id="step-parent">
{parent_inputs}
      <div class="actions">
        <button class="btn ghost" id="cmp-dummy" type="button">Dummy</button>
        <button class="btn primary" id="cmp-next" type="button" disabled>Next</button>
      </div>
    </div>
  `;

{parent_consts}
  const nextBtn = panel.querySelector("#cmp-next");

  const validateParent = () => {{
    nextBtn.disabled = !({parent_validate});
  }};
  [{", ".join(el_var("cmp", f) for f in pf)}].forEach((el) => el.addEventListener("input", validateParent));

  panel.querySelector("#cmp-dummy").addEventListener("click", () => {{
    const d = dummy{P}();
{parent_dummy_assign}
    validateParent();
  }});

  panel.querySelector("#cmp-next").addEventListener("click", () => {{
    if (!({parent_validate})) return;
    const parentData = {{
        {parent_data_props}
    }};
    show{C}Step(parentData);
  }});

  validateParent();
}}

function show{C}Step(parentData) {{
  const subtabs = panel.querySelector("#createSubtabs");
  subtabs.querySelector('[data-step="parent"]').classList.add("done");
  const childTab = subtabs.querySelector('[data-step="child"]');
  childTab.classList.remove("locked");
  childTab.disabled = false;

  subtabs.querySelectorAll(".subtab").forEach((t) => {{
    t.classList.toggle("active", t.dataset.step === "child");
    t.onclick = () => {{
      subtabs.querySelectorAll(".subtab").forEach((x) => x.classList.toggle("active", x === t));
      panel.querySelector("#step-parent").style.display = t.dataset.step === "parent" ? "" : "none";
      panel.querySelector("#step-child").style.display = t.dataset.step === "child" ? "" : "none";
    }};
  }});

  panel.dataset.parent = JSON.stringify(parentData);

  let childSec = panel.querySelector("#step-child");
  if (!childSec) {{
    childSec = document.createElement("div");
    childSec.className = "subpanel";
    childSec.id = "step-child";
    childSec.innerHTML = `
      <p class="ctx">Parent: <strong>${{escapeHtml(parentData.{pname['camel']})}}</strong>
         (email suffix <strong>@${{escapeHtml(parentData.{suf['camel']})}}</strong>)</p>
      <div class="member-list" id="mbr-list"></div>
      <div class="member-form">
        <h3 class="subhead">Add {child}</h3>
{child_inputs}
        <div class="actions">
          <button class="btn ghost" id="mbr-dummy" type="button">Dummy</button>
          <button class="btn" id="mbr-add" type="button" disabled>Add {child}</button>
        </div>
      </div>
      <div class="actions create-final">
        <button class="btn ghost" id="cmp-reset" type="button">Reset</button>
        <button class="btn primary" id="cmp-create" type="button" disabled>Create {p}</button>
      </div>
    `;
    panel.querySelector("#step-parent").after(childSec);

{child_consts}
    const addBtn = childSec.querySelector("#mbr-add");
    const createBtn = childSec.querySelector("#cmp-create");
    const listEl = childSec.querySelector("#mbr-list");

    const pending = [];

    const validateChildForm = () => {{
      addBtn.disabled = !({child_validate});
    }};
    [{", ".join(el_var("mbr", f) for f in cf)}].forEach((el) => el.addEventListener("input", validateChildForm));

    const renderMemberList = () => {{
      if (!pending.length) {{
        listEl.innerHTML = '<p class="muted small">No {c}s added yet.</p>';
      }} else {{
        listEl.innerHTML = pending.map((m, i) => `
          <div class="member-row">
            <span><strong>${{escapeHtml(m.name)}}</strong></span>
            <button class="icon-btn danger" data-rm="${{i}}" title="Remove">&#10005;</button>
          </div>`).join("");
        listEl.querySelectorAll("[data-rm]").forEach((b) => {{
          b.addEventListener("click", () => {{
            pending.splice(Number(b.dataset.rm), 1);
            renderMemberList();
            updateCreateBtn();
          }});
        }});
      }}
      updateCreateBtn();
    }};

    const updateCreateBtn = () => {{ createBtn.disabled = pending.length === 0; }};

    childSec.querySelector("#mbr-dummy").addEventListener("click", () => {{
      const d = dummy{C}();
{child_dummy_assign}
      validateChildForm();
    }});

    addBtn.addEventListener("click", () => {{
      if (addBtn.disabled) return;
      pending.push({{
        {child_push_props}
      }});
      {child_clear};
      validateChildForm();
      renderMemberList();
      {el_var("mbr", cf[0])}.focus();
    }});

    childSec.querySelector("#cmp-reset").addEventListener("click", render{P}Create);

    createBtn.addEventListener("click", async () => {{
      if (createBtn.disabled) return;
      createBtn.disabled = true;
      createBtn.textContent = "Creating…";
      try {{
        await save{P}With{C}s(parentData, pending);
        createBtn.textContent = "Created &#10003;";
        setTimeout(render{P}Create, 800);
      }} catch (err) {{
        createBtn.textContent = "Create failed — retry";
        createBtn.disabled = false;
        alert("Create failed: " + err.message);
      }}
    }});

    renderMemberList();
  }}

  panel.querySelector("#step-parent").style.display = "none";
  childSec.style.display = "";
}}

// ---------------------------------------------------------------------------
// {P} / View
// ---------------------------------------------------------------------------

let view{P}s = [];
let view{P}Filters = {{}};

async function render{P}View() {{
  panel.innerHTML = '<h2>{P} / View</h2><p class="empty">Loading…</p>';
  try {{
    view{P}s = await fetchJson(API + "/api/{p}s");
    if (!view{P}s.length) {{
      panel.innerHTML = '<h2>{P} / View</h2><p class="empty">No {p}s saved yet.</p>';
      return;
    }}
    paint{P}View();
  }} catch (err) {{
    panel.innerHTML = `<h2>{P} / View</h2><p class="empty">Failed to load: ${{escapeHtml(err.message)}}</p>`;
  }}
}}

function flatten{P}Rows(items) {{
  const rows = [];
  items.forEach((it) => {{
    const children = it.{c}s && it.{c}s.length ? it.{c}s : [null];
    children.forEach((ch) => {{
      rows.push({{
{row_props}
        childId: ch ? ch.id : null,
{child_row_props}
      }});
    }});
  }});
  return rows;
}}

function paint{P}View() {{
  const rows = flatten{P}Rows(view{P}s);
  const cols = [
{col_defs}
  ];

  const filtered = rows.filter((r) =>
    cols.every((c) => fuzzyMatch(r[c.key], view{P}Filters[c.key]))
  );
  const filtersActive = Object.values(view{P}Filters).some((v) => v && v.trim());
  const shown = filtersActive ? filtered : rows;

  const searchRow = cols.map((c) =>
    `<th class="search-th">
       <input class="col-search" data-key="${{c.key}}" type="text"
              placeholder="Search ${{c.label}}…" value="${{escapeHtml(view{P}Filters[c.key] || "")}}" />
     </th>`).join("") +
    `<th class="search-th actions-th"></th>`;

  const body = shown.map((r) => `
      <tr>
{body_tds}
        <td class="row-actions">
          <button class="icon-btn" data-edit="${{r.id}}" title="Edit">&#9998;</button>
          ${{ r.childId != null ? `<button class="icon-btn danger" data-remove="${{r.childId}}" title="Remove">&#128465;</button>` : "" }}
        </td>
      </tr>`).join("") || `<tr><td colspan="${{cols.length+1}}" class="muted">No matches.</td></tr>`;

  panel.innerHTML = `
    <div class="view-head">
      <h2>{P} / View</h2>
      <button class="btn ghost" id="export-xlsx" type="button">Export Excel</button>
    </div>
    <table class="grid" id="{p}-grid">
      <thead>
        <tr class="head-row">${{cols.map((c) => `<th>${{c.label}}</th>`).join("")}}<th></th></tr>
        <tr class="search-row">${{searchRow}}</tr>
      </thead>
      <tbody>${{body}}</tbody>
    </table>
  `;

  panel.querySelectorAll(".col-search").forEach((inp) => {{
    inp.addEventListener("input", () => {{
      view{P}Filters[inp.dataset.key] = inp.value;
      paint{P}View();
    }});
  }});
  panel.querySelector("#export-xlsx").addEventListener("click", () => exportExcel(shown));
  panel.querySelectorAll("[data-edit]").forEach((b) => {{
    b.addEventListener("click", () => open{P}EditModal(Number(b.dataset.edit)));
  }});
  panel.querySelectorAll("[data-remove]").forEach((b) => {{
    b.addEventListener("click", () => remove{P}{C}(Number(b.dataset.remove)));
  }});
}}

function open{P}EditModal(id) {{
  const item = view{P}s.find((x) => x.id === id);
  if (!item) return;
  const children = item.{c}s || [];
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>Edit {p}</h3>
{modal_fields}
      <h4 class="subhead">{C}s</h4>
      <div class="member-list" id="ed-children"></div>
      <div class="actions modal-actions">
        <button class="btn ghost" id="ed-cancel" type="button">Cancel</button>
        <button class="btn primary" id="ed-save" type="button">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const renderChildren = () => {{
    const list = overlay.querySelector("#ed-children");
    if (!children.length) list.innerHTML = '<p class="muted small">No {c}s.</p>';
    else list.innerHTML = children.map((ch) => `
        <div class="member-row"><span><strong>${{escapeHtml(ch.name)}}</strong></span>
        <button class="icon-btn danger" data-del="${{ch.id}}" title="Remove">&#10005;</button></div>`).join("");
    list.querySelectorAll("[data-del]").forEach((b) => {{
      b.addEventListener("click", () => {{
        const cid = Number(b.dataset.del);
        children.splice(children.findIndex((ch) => ch.id === cid), 1);
        renderChildren();
      }});
    }});
  }};
  renderChildren();
  overlay.querySelector("#ed-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {{ if (e.target === overlay) overlay.remove(); }});
  overlay.querySelector("#ed-save").addEventListener("click", async () => {{
    const saveBtn = overlay.querySelector("#ed-save");
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {{
      await apiPut{P}(id, {{ {save_props} }});
      overlay.remove();
      await render{P}View();
    }} catch (err) {{
      saveBtn.disabled = false; saveBtn.textContent = "Save";
      alert("Save failed: " + err.message);
    }}
  }});
}}

async function remove{P}{C}(childId) {{
  if (!confirm("Remove this {c}?")) return;
  try {{
    await fetchJson(API + `/api/{c}s/${{childId}}`, {{ method: "DELETE" }});
    await render{P}View();
  }} catch (err) {{ alert("Remove failed: " + err.message); }}
}}

async function save{P}With{C}s(parentData, children) {{
  const res = await fetchJson(API + "/api/{p}s", {{
    method: "POST",
    headers: {{ "Content-Type": "application/json" }},
    body: JSON.stringify(parentData),
  }});
  for (const ch of children) {{
    await fetchJson(API + `/api/{p}s/${{res.id}}/{c}s`, {{
      method: "POST",
      headers: {{ "Content-Type": "application/json" }},
      body: JSON.stringify(ch),
    }});
  }}
  return res;
}}

async function apiPut{P}(id, data) {{
  return fetchJson(API + `/api/{p}s/${{id}}`, {{
    method: "PUT",
    headers: {{ "Content-Type": "application/json" }},
    body: JSON.stringify(data),
  }});
}}

// ---- Dummy generators ----
function dummy{P}() {{
  return {{
    {dummy_parent_props}
  }};
}}
function dummy{C}() {{
  const first = rnd(FIRST), last = rnd(LAST);
  return {{
    {dummy_child_props}
  }};
}}"""


# ---------------------------------------------------------------------------
# 4. Backend stubs (server.py)
# ---------------------------------------------------------------------------
def backend(parent, child, parent_fields, child_fields, db_parent, db_child, resource):
    p, c = parent.lower(), child.lower()
    pf_cols = ", ".join(f["name"] + " TEXT NOT NULL" for f in parent_fields)
    cf_cols = ", ".join(
        (f["name"] + " INTEGER NOT NULL REFERENCES {}(id) ON DELETE CASCADE".format(db_parent)
         if f["name"] == db_parent + "_id"
         else f["name"] + " TEXT NOT NULL")
        for f in child_fields
    )
    pf_insert_cols = ", ".join(f["name"] for f in parent_fields)
    pf_ph = ", ".join("?" for _ in parent_fields)
    cf_insert_cols = ", ".join(f["name"] for f in child_fields if f["name"] != "created_at")
    cf_ph = ", ".join("?" for f in child_fields if f["name"] != "created_at")
    pf_vals = ", ".join('(data.get("{}") or "").strip()'.format(f["name"]) for f in parent_fields)
    cf_vals = ", ".join('(data.get("{}") or "").strip()'.format(f["name"])
                        for f in child_fields if f["name"] != "created_at")

    return f"""# --- {pascal(parent)} schema (add to init_db) ---
cur.execute(\"\"\"
    CREATE TABLE IF NOT EXISTS {db_parent} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        {pf_cols},
        created_at TEXT NOT NULL
    )
\"\"\")
cur.execute(\"\"\"
    CREATE TABLE IF NOT EXISTS {db_child} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        {db_parent}_id INTEGER NOT NULL REFERENCES {db_parent}(id) ON DELETE CASCADE,
        {cf_cols},
        created_at TEXT NOT NULL
    )
\"\"\")

# --- {pascal(parent)} API handlers (add near the other api_* funcs) ---
def api_create_{p}(handler):
    data = read_json_body(handler)
    conn = db(); cur = conn.cursor()
    cur.execute("INSERT INTO {db_parent} ({pf_insert_cols}, created_at) VALUES ({pf_ph}, ?)",
                ({pf_vals}, now_iso()))
    pid = cur.lastrowid; conn.commit(); conn.close()
    return json_response(handler, {{"id": pid}}, 201)

def api_list_{p}s(handler):
    conn = db()
    rows = conn.execute("SELECT * FROM {db_parent} ORDER BY id DESC").fetchall()
    out = []
    for it in rows:
        ch = conn.execute("SELECT * FROM {db_child} WHERE {db_parent}_id = ? ORDER BY id", (it["id"],)).fetchall()
        d = dict(it); d["{c}s"] = [dict(x) for x in ch]; out.append(d)
    conn.close()
    return json_response(handler, out)

def api_add_{c}(handler, pid):
    data = read_json_body(handler)
    conn = db(); cur = conn.cursor()
    cur.execute("INSERT INTO {db_child} ({cf_insert_cols}, created_at) VALUES ({cf_ph}, ?)",
                ({cf_vals}, now_iso()))
    conn.commit(); conn.close()
    return json_response(handler, {{"ok": True}}, 201)

# --- Router additions (inside Handler._route) ---
# if path == "/api/{p}s" and method == "POST": api_create_{p}(self); return True
# if path == "/api/{p}s" and method == "GET":  api_list_{p}s(self); return True
# if path.startswith("/api/{c}s/") and rest.isdigit() and method == "DELETE":
#     api_delete_{c}(self, int(rest)); return True
# /api/{p}s/<id>/{c}s  -> POST api_add_{c}"""


def main():
    for _s in ("stdout", "stderr"):
        _stream = getattr(sys, _s)
        if _stream.encoding and _stream.encoding.lower() not in ("utf-8", "utf8"):
            setattr(sys, _s, io.TextIOWrapper(_stream.buffer, encoding="utf-8", errors="replace"))

    ap = argparse.ArgumentParser(description="Generate FC userform scaffold code blocks.")
    ap.add_argument("--parent", required=True)
    ap.add_argument("--child", required=True)
    ap.add_argument("--parent-fields", nargs="+", required=True)
    ap.add_argument("--child-fields", nargs="+", required=True)
    ap.add_argument("--resource", required=True, help="plural lowercase API resource")
    ap.add_argument("--group", default=None)
    ap.add_argument("--db-parent", default=None)
    ap.add_argument("--db-child", default=None)
    args = ap.parse_args()

    group = args.group or args.parent.lower()
    db_parent = args.db_parent or (args.parent.lower() + "s")
    db_child = args.db_child or (args.child.lower() + "s")

    pf = parse_fields(args.parent_fields)
    cf = parse_fields(args.child_fields)

    blocks = [
        ("1. static/index.html — paste after the Customer group", nav_html(group, args.parent, args.child)),
        ("2. static/js/app.js — labels map (near other labels)", app_js_labels(args.parent)),
        ("3. static/js/app.js — renderPanel branches", app_js_branches(args.parent)),
        ("4. static/js/app.js — Create + View functions (append)", js_create(args.parent, args.child, pf, cf)),
        ("5. server.py — schema, handlers, router notes", backend(args.parent, args.child, pf, cf, db_parent, db_child, args.resource)),
    ]
    for title, code in blocks:
        print("=" * 78)
        print(title)
        print("=" * 78)
        print(code)
        print()


if __name__ == "__main__":
    main()
