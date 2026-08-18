// App logic: left-nav clicks open a mini tab in the right panel.
// Both the clicked nav item and its tab stay highlighted together.

const API = ""; // same origin

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
        <button class="btn primary" id="mbr-save" type="button" disabled>Save</button>
      </div>
    `;
    // Insert after the company subpanel
    panel.querySelector("#step-company").after(memberSec);

    const nameEl   = memberSec.querySelector("#mbr-name");
    const prefixEl = memberSec.querySelector("#mbr-prefix");
    const titleEl  = memberSec.querySelector("#mbr-title");
    const telEl    = memberSec.querySelector("#mbr-tel");
    const saveBtn  = memberSec.querySelector("#mbr-save");

    const validateMember = () => {
      const ok = nameEl.value.trim() && prefixEl.value.trim() &&
                 titleEl.value.trim() && telEl.value.trim();
      saveBtn.disabled = !ok;
    };
    [nameEl, prefixEl, titleEl, telEl].forEach((el) => el.addEventListener("input", validateMember));

    memberSec.querySelector("#mbr-dummy").addEventListener("click", () => {
      const d = dummyMember();
      nameEl.value   = d.name;
      prefixEl.value = d.prefix;
      titleEl.value  = d.title;
      telEl.value    = d.tel;
      validateMember();
    });

    memberSec.querySelector("#mbr-save").addEventListener("click", async () => {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        await saveCustomer(companyName, emailSuffix, {
          name: nameEl.value.trim(),
          email_prefix: prefixEl.value.trim(),
          title: titleEl.value.trim(),
          tel: telEl.value.trim(),
        });
        saveBtn.textContent = "Saved ✓";
        setTimeout(() => {
          // reset the whole create panel for a fresh entry
          renderCustomerCreate();
        }, 800);
      } catch (err) {
        saveBtn.textContent = "Save failed — retry";
        saveBtn.disabled = false;
        alert("Save failed: " + err.message);
      }
    });
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
  sec.querySelector("#mbr-save").disabled = !ok;
}

// ---------------------------------------------------------------------------
// Customer / View
// ---------------------------------------------------------------------------

async function renderCustomerView() {
  panel.innerHTML = '<h2>Customer / View</h2><p class="empty">Loading…</p>';
  try {
    const res = await fetch(API + "/api/customers");
    const customers = await res.json();
    if (!customers.length) {
      panel.innerHTML = '<h2>Customer / View</h2><p class="empty">No customers saved yet.</p>';
      return;
    }
    const rows = customers.map((c) => {
      const members = (c.members || []).map((m) => `
        <tr>
          <td>${escapeHtml(m.name)}</td>
          <td>${escapeHtml(m.email_prefix)}@${escapeHtml(c.email_suffix)}</td>
          <td>${escapeHtml(m.title)}</td>
          <td>${escapeHtml(m.tel)}</td>
        </tr>`).join("") || `<tr><td colspan="4" class="muted">No members</td></tr>`;
      return `
        <div class="card">
          <div class="card-head">
            <strong>${escapeHtml(c.name)}</strong>
            <span class="muted">@${escapeHtml(c.email_suffix)}</span>
          </div>
          <table class="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Title</th><th>Tel</th></tr></thead>
            <tbody>${members}</tbody>
          </table>
        </div>`;
    }).join("");
    panel.innerHTML = `<h2>Customer / View</h2>${rows}`;
  } catch (err) {
    panel.innerHTML = `<h2>Customer / View</h2><p class="empty">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function saveCustomer(companyName, emailSuffix, member) {
  const cRes = await fetch(API + "/api/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: companyName, email_suffix: emailSuffix }),
  });
  if (!cRes.ok) throw new Error("create company failed");
  const company = await cRes.json();

  const mRes = await fetch(API + `/api/companies/${company.id}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(member),
  });
  if (!mRes.ok) throw new Error("create member failed");
  return mRes.json();
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
