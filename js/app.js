// App logic: left-nav clicks open a mini tab in the right panel.
// Both the clicked nav item and its tab stay highlighted together.

const API = ""; // same origin

// ---------------------------------------------------------------------------
// Robust JSON fetch: rejects with a clear, actionable error when the response
// is not JSON (e.g. a static-only server or file:// returning an HTML page).
// ---------------------------------------------------------------------------
async function fetchJson(url, opts) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (netErr) {
    throw new Error("network error — is the FC server running? (" + netErr.message + ")");
  }
  const ct = res.headers.get("Content-Type") || "";
  if (!res.ok) {
    throw new Error("server returned " + res.status + " " + res.statusText);
  }
  if (!ct.includes("application/json")) {
    throw new Error(
      "API not reachable — got '" + (ct || "unknown") +
      "' instead of JSON. Make sure server.py is running, not a static file server."
    );
  }
  return res.json();
}

const labels = {
  "customer-create": "Customer / Create",
  "customer-view":   "Customer / View",
  "development-create": "Development / Create",
  "development-view":   "Development / View",
};

const sidebar = document.getElementById("sidebar");
const tabsEl  = document.getElementById("tabs");
const panel   = document.getElementById("panel");

const openTabs = new Set();
let activeTarget = null;

// --- Collapsible 1st-level groups ---
sidebar.querySelectorAll(".group-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    btn.closest(".group").classList.toggle("collapsed");
  });
});

// --- 2nd-level nav clicks ---
sidebar.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    openTab(item.dataset.target);
  });
});

function openTab(target) {
  openTabs.add(target);
  activeTarget = target;
  renderTabs();
  renderPanel();
  highlightNav();
}

function closeTab(target) {
  openTabs.delete(target);
  if (activeTarget === target) {
    activeTarget = openTabs.size ? [...openTabs][openTabs.size - 1] : null;
  }
  renderTabs();
  renderPanel();
  highlightNav();
}

function renderTabs() {
  tabsEl.innerHTML = "";
  openTabs.forEach((target) => {
    const tab = document.createElement("div");
    tab.className = "tab" + (target === activeTarget ? " active" : "");
    tab.setAttribute("role", "tab");

    const label = document.createElement("span");
    label.textContent = labels[target] || target;
    tab.appendChild(label);

    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "×";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(target);
    });
    tab.appendChild(close);

    tab.addEventListener("click", () => {
      activeTarget = target;
      renderTabs();
      renderPanel();
      highlightNav();
    });

    tabsEl.appendChild(tab);
  });
}

async function renderPanel() {
  if (!activeTarget) {
    panel.innerHTML = '<p class="empty">Select an item from the left menu.</p>';
    return;
  }

  if (activeTarget === "customer-create") {
    renderCustomerCreate();
    return;
  }
  if (activeTarget === "customer-view") {
    await renderCustomerView();
    return;
  }

  panel.innerHTML =
    `<h2>${labels[activeTarget] || activeTarget}</h2>` +
    `<p>This is the <strong>${activeTarget}</strong> view.</p>`;
}

function highlightNav() {
  sidebar.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.target === activeTarget);
  });
}

// ---------------------------------------------------------------------------
// Customer / Create  — two-step wizard (Company -> Member)
// ---------------------------------------------------------------------------

function renderCustomerCreate() {
  panel.innerHTML = `
    <h2>Customer / Create</h2>
    <div class="subtabs" id="createSubtabs" role="tablist">
      <button class="subtab active" data-step="company" role="tab">Company</button>
      <button class="subtab locked" data-step="member" role="tab" disabled>Member</button>
    </div>

    <!-- COMPANY STEP -->
    <div class="subpanel" id="step-company">
      <div class="field">
        <label for="cmp-name">Company name</label>
        <input id="cmp-name" type="text" placeholder="Acme Inc." autocomplete="off" />
      </div>
      <div class="field">
        <label for="cmp-suffix">Company email suffix <span class="hint">(no “@”)</span></label>
        <div class="input-affix">
          <span class="at">@</span>
          <input id="cmp-suffix" type="text" placeholder="acme.com" autocomplete="off" />
        </div>
      </div>
      <div class="actions">
        <button class="btn ghost" id="cmp-dummy" type="button">Dummy</button>
        <button class="btn primary" id="cmp-next" type="button" disabled>Next</button>
      </div>
    </div>
  `;

  const nameEl   = panel.querySelector("#cmp-name");
  const suffixEl = panel.querySelector("#cmp-suffix");
  const nextBtn  = panel.querySelector("#cmp-next");

  const validateCompany = () => {
    const ok = nameEl.value.trim() && suffixEl.value.trim();
    nextBtn.disabled = !ok;
  };
  nameEl.addEventListener("input", validateCompany);
  suffixEl.addEventListener("input", validateCompany);

  panel.querySelector("#cmp-dummy").addEventListener("click", () => {
    const d = dummyCompany();
    nameEl.value   = d.name;
    suffixEl.value = d.suffix;
    validateCompany();
  });

  panel.querySelector("#cmp-next").addEventListener("click", () => {
    if (!nameEl.value.trim() || !suffixEl.value.trim()) return;
    showMemberStep(nameEl.value.trim(), suffixEl.value.trim().replace(/^@/, ""));
  });

  validateCompany();
}

function showMemberStep(companyName, emailSuffix) {
  const subtabs = panel.querySelector("#createSubtabs");
  subtabs.querySelector('[data-step="company"]').classList.add("done");
  const memberTab = subtabs.querySelector('[data-step="member"]');
  memberTab.classList.remove("locked");
  memberTab.disabled = false;

  subtabs.querySelectorAll(".subtab").forEach((t) => {
    t.classList.toggle("active", t.dataset.step === "member");
    t.onclick = () => {
      subtabs.querySelectorAll(".subtab").forEach((x) => x.classList.toggle("active", x === t));
      panel.querySelector("#step-company").style.display = t.dataset.step === "company" ? "" : "none";
      panel.querySelector("#step-member").style.display = t.dataset.step === "member" ? "" : "none";
    };
  });

  // Store company info on the panel element
  panel.dataset.cmpName = companyName;
  panel.dataset.cmpSuffix = emailSuffix;

  let memberSec = panel.querySelector("#step-member");
  if (!memberSec) {
    memberSec = document.createElement("div");
    memberSec.className = "subpanel";
    memberSec.id = "step-member";
    memberSec.innerHTML = `
      <p class="ctx">Company: <strong>${escapeHtml(companyName)}</strong>
         (email suffix <strong>@${escapeHtml(emailSuffix)}</strong>)</p>
      <div class="member-list" id="mbr-list"></div>
      <div class="member-form">
        <h3 class="subhead">Add member</h3>
        <div class="field">
          <label for="mbr-name">Name</label>
          <input id="mbr-name" type="text" placeholder="Jane Doe" autocomplete="off" />
        </div>
        <div class="field">
          <label for="mbr-prefix">Email prefix <span class="hint">(suffix follows company)</span></label>
          <div class="input-affix">
            <input id="mbr-prefix" type="text" placeholder="jane.doe" autocomplete="off" />
            <span class="suffix">@${escapeHtml(emailSuffix)}</span>
          </div>
        </div>
        <div class="field">
          <label for="mbr-title">Title</label>
          <input id="mbr-title" type="text" placeholder="Engineer" autocomplete="off" />
        </div>
        <div class="field">
          <label for="mbr-tel">Tel</label>
          <input id="mbr-tel" type="text" placeholder="+1 555 0100" autocomplete="off" />
        </div>
        <div class="actions">
          <button class="btn ghost" id="mbr-dummy" type="button">Dummy</button>
          <button class="btn" id="mbr-add" type="button" disabled>Add member</button>
        </div>
      </div>
      <div class="actions create-final">
        <button class="btn ghost" id="cmp-reset" type="button">Reset</button>
        <button class="btn primary" id="cmp-create" type="button" disabled>Create customer</button>
      </div>
    `;
    // Insert after the company subpanel
    panel.querySelector("#step-company").after(memberSec);

    const nameEl   = memberSec.querySelector("#mbr-name");
    const prefixEl = memberSec.querySelector("#mbr-prefix");
    const titleEl  = memberSec.querySelector("#mbr-title");
    const telEl    = memberSec.querySelector("#mbr-tel");
    const addBtn   = memberSec.querySelector("#mbr-add");
    const createBtn = memberSec.querySelector("#cmp-create");
    const listEl   = memberSec.querySelector("#mbr-list");

    // pending members for this company
    const pending = [];

    const validateMemberForm = () => {
      const ok = nameEl.value.trim() && prefixEl.value.trim() &&
                 titleEl.value.trim() && telEl.value.trim();
      addBtn.disabled = !ok;
    };
    [nameEl, prefixEl, titleEl, telEl].forEach((el) => el.addEventListener("input", validateMemberForm));

    const renderMemberList = () => {
      if (!pending.length) {
        listEl.innerHTML = '<p class="muted small">No members added yet.</p>';
      } else {
        listEl.innerHTML = pending.map((m, i) => `
          <div class="member-row">
            <span><strong>${escapeHtml(m.name)}</strong>
              <span class="muted">${escapeHtml(m.email_prefix)}@${escapeHtml(emailSuffix)}</span></span>
            <span class="muted">${escapeHtml(m.title)} · ${escapeHtml(m.tel)}</span>
            <button class="icon-btn danger" data-rm="${i}" title="Remove">✕</button>
          </div>`).join("");
        listEl.querySelectorAll("[data-rm]").forEach((b) => {
          b.addEventListener("click", () => {
            pending.splice(Number(b.dataset.rm), 1);
            renderMemberList();
            updateCreateBtn();
          });
        });
      }
      updateCreateBtn();
    };

    const updateCreateBtn = () => { createBtn.disabled = pending.length === 0; };

    memberSec.querySelector("#mbr-dummy").addEventListener("click", () => {
      const d = dummyMember();
      nameEl.value   = d.name;
      prefixEl.value = d.prefix;
      titleEl.value  = d.title;
      telEl.value    = d.tel;
      validateMemberForm();
    });

    addBtn.addEventListener("click", () => {
      if (addBtn.disabled) return;
      pending.push({
        name: nameEl.value.trim(),
        email_prefix: prefixEl.value.trim(),
        title: titleEl.value.trim(),
        tel: telEl.value.trim(),
      });
      nameEl.value = prefixEl.value = titleEl.value = telEl.value = "";
      validateMemberForm();
      renderMemberList();
      nameEl.focus();
    });

    memberSec.querySelector("#cmp-reset").addEventListener("click", renderCustomerCreate);

    createBtn.addEventListener("click", async () => {
      if (createBtn.disabled) return;
      createBtn.disabled = true;
      createBtn.textContent = "Creating…";
      try {
        await saveCustomerWithMembers(companyName, emailSuffix, pending);
        createBtn.textContent = "Created ✓";
        setTimeout(renderCustomerCreate, 800);
      } catch (err) {
        createBtn.textContent = "Create failed — retry";
        createBtn.disabled = false;
        alert("Create failed: " + err.message);
      }
    });

    renderMemberList();
  }

  panel.querySelector("#step-company").style.display = "none";
  memberSec.style.display = "";
  validateMemberStep();
}

function validateMemberStep() {
  const sec = panel.querySelector("#step-member");
  if (!sec) return;
  const ok = sec.querySelector("#mbr-name").value.trim() &&
             sec.querySelector("#mbr-prefix").value.trim() &&
             sec.querySelector("#mbr-title").value.trim() &&
             sec.querySelector("#mbr-tel").value.trim();
  const addBtn = sec.querySelector("#mbr-add");
  if (addBtn) addBtn.disabled = !ok;
}

// ---------------------------------------------------------------------------
// Customer / View
// ---------------------------------------------------------------------------

// View state
let viewCustomers = [];      // raw data from /api/customers
let viewFilters = {};         // {company, name, email, title, tel}

async function renderCustomerView() {
  panel.innerHTML = '<h2>Customer / View</h2><p class="empty">Loading…</p>';
  try {
    viewCustomers = await fetchJson(API + "/api/customers");
    if (!viewCustomers.length) {
      panel.innerHTML = '<h2>Customer / View</h2><p class="empty">No customers saved yet.</p>';
      return;
    }
    paintView();
  } catch (err) {
    panel.innerHTML = `<h2>Customer / View</h2><p class="empty">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

// flatten companies -> customer rows (one row per member)
function flattenRows(customers) {
  const rows = [];
  customers.forEach((c) => {
    const members = c.members && c.members.length ? c.members : [null];
    members.forEach((m) => {
      rows.push({
        companyId: c.id,
        company: c.name,
        emailSuffix: c.email_suffix,
        memberId: m ? m.id : null,
        name: m ? m.name : "",
        email: m ? m.email_prefix + "@" + c.email_suffix : "",
        title: m ? m.title : "",
        tel: m ? m.tel : "",
      });
    });
  });
  return rows;
}

function fuzzyMatch(text, q) {
  if (!q) return true;
  text = (text || "").toLowerCase();
  q = q.toLowerCase().trim();
  if (!q) return true;
  // subsequence fuzzy match
  let i = 0;
  for (const ch of text) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

function paintView() {
  const rows = flattenRows(viewCustomers);
  const cols = [
    { key: "company", label: "Company" },
    { key: "name", label: "Member" },
    { key: "email", label: "Email" },
    { key: "title", label: "Title" },
    { key: "tel", label: "Tel" },
  ];

  const filtered = rows.filter((r) =>
    cols.every((c) => fuzzyMatch(r[c.key], viewFilters[c.key]))
  );

  const filtersActive = Object.values(viewFilters).some((v) => v && v.trim());
  const shown = filtersActive ? filtered : rows;

  const searchRow = cols.map((c) =>
    `<th class="search-th">
       <input class="col-search" data-key="${c.key}" type="text"
              placeholder="Search ${c.label}…" value="${escapeHtml(viewFilters[c.key] || "")}" />
     </th>`
  ).join("") +
    `<th class="search-th actions-th"></th>`;

  const body = shown.map((r) => {
    const editBtn = r.memberId != null
      ? `<button class="icon-btn" data-edit="${r.companyId}" title="Edit">✎</button>
         <button class="icon-btn danger" data-remove="${r.memberId}" title="Remove member">🗑</button>`
      : `<button class="icon-btn" data-edit="${r.companyId}" title="Edit company">✎</button>`;
    return `
      <tr>
        <td>${escapeHtml(r.company)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td>${escapeHtml(r.title)}</td>
        <td>${escapeHtml(r.tel)}</td>
        <td class="row-actions">${editBtn}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">No matches.</td></tr>`;

  panel.innerHTML = `
    <div class="view-head">
      <h2>Customer / View</h2>
      <button class="btn ghost" id="export-xlsx" type="button">Export Excel</button>
    </div>
    <table class="grid" id="customer-grid">
      <thead>
        <tr class="head-row">${cols.map((c) => `<th>${c.label}</th>`).join("")}<th></th></tr>
        <tr class="search-row">${searchRow}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;

  // per-column fuzzy search
  panel.querySelectorAll(".col-search").forEach((inp) => {
    inp.addEventListener("input", () => {
      viewFilters[inp.dataset.key] = inp.value;
      paintView();
    });
  });

  panel.querySelector("#export-xlsx").addEventListener("click", () => exportExcel(shown));

  panel.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => openEditModal(Number(b.dataset.edit)));
  });
  panel.querySelectorAll("[data-remove]").forEach((b) => {
    b.addEventListener("click", () => removeMember(Number(b.dataset.remove)));
  });
}

// ---------------------------------------------------------------------------
// Edit modal (company + members)
// ---------------------------------------------------------------------------

function openEditModal(companyId) {
  const company = viewCustomers.find((c) => c.id === companyId);
  if (!company) return;
  const members = company.members || [];

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>Edit customer</h3>
      <div class="field">
        <label for="ed-name">Company name</label>
        <input id="ed-name" type="text" value="${escapeHtml(company.name)}" />
      </div>
      <div class="field">
        <label for="ed-suffix">Email suffix <span class="hint">(no “@”)</span></label>
        <div class="input-affix">
          <span class="at">@</span>
          <input id="ed-suffix" type="text" value="${escapeHtml(company.email_suffix)}" />
        </div>
      </div>

      <h4 class="subhead">Members</h4>
      <div class="member-list" id="ed-members"></div>

      <div class="member-form">
        <div class="field">
          <label for="ed-m-name">Name</label>
          <input id="ed-m-name" type="text" placeholder="Jane Doe" />
        </div>
        <div class="field">
          <label for="ed-m-prefix">Email prefix</label>
          <input id="ed-m-prefix" type="text" placeholder="jane.doe" />
        </div>
        <div class="field">
          <label for="ed-m-title">Title</label>
          <input id="ed-m-title" type="text" placeholder="Engineer" />
        </div>
        <div class="field">
          <label for="ed-m-tel">Tel</label>
          <input id="ed-m-tel" type="text" placeholder="+1 555 0100" />
        </div>
        <div class="actions">
          <button class="btn" id="ed-m-add" type="button" disabled>Add member</button>
        </div>
      </div>

      <div class="actions modal-actions">
        <button class="btn ghost" id="ed-cancel" type="button">Cancel</button>
        <button class="btn primary" id="ed-save" type="button">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const suffix = () => overlay.querySelector("#ed-suffix").value.trim().replace(/^@/, "");

  const renderMembers = () => {
    const list = overlay.querySelector("#ed-members");
    if (!members.length) {
      list.innerHTML = '<p class="muted small">No members.</p>';
    } else {
      list.innerHTML = members.map((m) => `
        <div class="member-row">
          <span><strong>${escapeHtml(m.name)}</strong>
            <span class="muted">${escapeHtml(m.email_prefix)}@${escapeHtml(company.email_suffix)}</span></span>
          <span class="muted">${escapeHtml(m.title)} · ${escapeHtml(m.tel)}</span>
          <button class="icon-btn danger" data-del="${m.id}" title="Remove">✕</button>
        </div>`).join("");
      list.querySelectorAll("[data-del]").forEach((b) => {
        b.addEventListener("click", () => {
          const id = Number(b.dataset.del);
          members.splice(members.findIndex((m) => m.id === id), 1);
          renderMembers();
        });
      });
    }
  };
  renderMembers();

  const v = () => {
    const ok = overlay.querySelector("#ed-m-name").value.trim() &&
               overlay.querySelector("#ed-m-prefix").value.trim() &&
               overlay.querySelector("#ed-m-title").value.trim() &&
               overlay.querySelector("#ed-m-tel").value.trim();
    overlay.querySelector("#ed-m-add").disabled = !ok;
  };
  ["#ed-m-name", "#ed-m-prefix", "#ed-m-title", "#ed-m-tel"].forEach((s) =>
    overlay.querySelector(s).addEventListener("input", v));

  overlay.querySelector("#ed-m-add").addEventListener("click", () => {
    if (overlay.querySelector("#ed-m-add").disabled) return;
    members.push({
      id: "new-" + Date.now(),
      name: overlay.querySelector("#ed-m-name").value.trim(),
      email_prefix: overlay.querySelector("#ed-m-prefix").value.trim(),
      title: overlay.querySelector("#ed-m-title").value.trim(),
      tel: overlay.querySelector("#ed-m-tel").value.trim(),
    });
    ["#ed-m-name", "#ed-m-prefix", "#ed-m-title", "#ed-m-tel"].forEach((s) => overlay.querySelector(s).value = "");
    v();
    renderMembers();
  });

  overlay.querySelector("#ed-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector("#ed-save").addEventListener("click", async () => {
    const name = overlay.querySelector("#ed-name").value.trim();
    const suf = suffix();
    if (!name || !suf) { alert("Company name and email suffix are required."); return; }
    const saveBtn = overlay.querySelector("#ed-save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await apiPutCompany(companyId, name, suf);
      for (const m of members) {
        if (typeof m.id === "string" && m.id.startsWith("new-")) {
          await apiAddMember(companyId, m);
        } else {
          await apiPutMember(m.id, m);
        }
      }
      overlay.remove();
      await renderCustomerView();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      alert("Save failed: " + err.message);
    }
  });
}

async function removeMember(memberId) {
  if (!confirm("Remove this member?")) return;
  try {
    await fetchJson(API + `/api/members/${memberId}`, { method: "DELETE" });
    await renderCustomerView();
  } catch (err) {
    alert("Remove failed: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function saveCustomerWithMembers(companyName, emailSuffix, members) {
  const cRes = await fetchJson(API + "/api/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: companyName, email_suffix: emailSuffix }),
  });
  const company = cRes;
  for (const m of members) {
    await fetchJson(API + `/api/companies/${company.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(m),
    });
  }
  return company;
}

async function apiPutCompany(companyId, name, emailSuffix) {
  return fetchJson(API + `/api/companies/${companyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email_suffix: emailSuffix }),
  });
}

async function apiAddMember(companyId, member) {
  return fetchJson(API + `/api/companies/${companyId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(member),
  });
}

async function apiPutMember(memberId, member) {
  return fetchJson(API + `/api/members/${memberId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(member),
  });
}

// ---------------------------------------------------------------------------
// Dummy data generators
// ---------------------------------------------------------------------------

const FIRST = ["Jane", "John", "Alice", "Bob", "Carol", "David", "Emma", "Frank", "Grace", "Henry"];
const LAST  = ["Doe", "Smith", "Lee", "Brown", "Wong", "Garcia", "Kim", "Patel", "Nguyen", "Chen"];
const COMP  = ["Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Hooli", "Soylent", "Vehement", "Pied"];
const SUFFIX = ["acme.com", "globex.io", "initech.co", "umbrella.net", "stark.com", "hooli.com"];
const TITLE = ["Engineer", "Manager", "Director", "Designer", "Analyst", "CTO", "CEO", "Sales Lead", "PM"];

// deterministic-ish pseudo random (Math.random is fine in browser)
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

function dummyCompany() {
  const name = rnd(COMP) + " " + rnd(["Inc", "LLC", "Corp", "Group", "Labs"]);
  return { name, suffix: rnd(SUFFIX) };
}

function dummyMember() {
  const first = rnd(FIRST);
  const last = rnd(LAST);
  return {
    name: first + " " + last,
    prefix: (first + "." + last).toLowerCase(),
    title: rnd(TITLE),
    tel: "+" + (Math.floor(Math.random() * 90) + 10) + " " +
         (Math.floor(Math.random() * 900) + 100) + " " +
         (Math.floor(Math.random() * 9000) + 1000),
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------------------------------------------------------------------------
// Export to Excel (CSV, opens in Excel)
// ---------------------------------------------------------------------------

function exportExcel(rows) {
  const headers = ["Company", "Member", "Email", "Title", "Tel"];
  const lines = [headers.join(",")];
  rows.forEach((r) => {
    const cells = [r.company, r.name, r.email, r.title, r.tel].map(csvCell);
    lines.push(cells.join(","));
  });
  const csv = "﻿" + lines.join("\r\n"); // BOM for Excel UTF-8
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "customers.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  v = v == null ? "" : String(v);
  if (/[",\r\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}
