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

// Dropdown option sets for the Company step of Customer / Create.
const CURRENCIES = ["USD", "RMB", "HKD"];
const PAYMENT_TERMS = ["COD", "credit 30 days", "credit 45 days"];
const SHIPMENT_TERMS = ["Ex Work", "Door 2 Door", "FOB", "CIF"];

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
    // leaving any edit session when navigating via the sidebar
    devEditMode = false;
    devEditId = null;
    openTab(item.dataset.target);
  });
});

function openTab(target) {
  // editing an existing development only applies while on the Create screen
  if (target !== "development-create") { devEditMode = false; devEditId = null; }
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
    label.textContent = (target === "development-create" && devEditMode) ? "edit" : (labels[target] || target);
    tab.appendChild(label);
    if (target === "development-create" && devEditMode) tab.classList.add("edit-mode");

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
  if (activeTarget === "development-create") {
    await renderDevelopmentCreate();
    return;
  }
  if (activeTarget === "development-view") {
    await renderDevelopmentView();
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
      <div class="field">
        <label for="cmp-currency">Currency</label>
        <select id="cmp-currency">
          <option value="">— select —</option>
          ${CURRENCIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="cmp-payment">Payment term</label>
        <select id="cmp-payment">
          <option value="">— select —</option>
          ${PAYMENT_TERMS.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="cmp-shipment">Shipment term</label>
        <select id="cmp-shipment">
          <option value="">— select —</option>
          ${SHIPMENT_TERMS.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
        </select>
      </div>
      <div class="actions">
        <button class="btn ghost" id="cmp-dummy" type="button">Dummy</button>
        <button class="btn primary" id="cmp-next" type="button" disabled>Next</button>
      </div>
    </div>
  `;

  const nameEl   = panel.querySelector("#cmp-name");
  const suffixEl = panel.querySelector("#cmp-suffix");
  const currEl   = panel.querySelector("#cmp-currency");
  const payEl    = panel.querySelector("#cmp-payment");
  const shipEl   = panel.querySelector("#cmp-shipment");
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
    currEl.value   = d.currency;
    payEl.value    = d.payment;
    shipEl.value   = d.shipment;
    validateCompany();
  });

  panel.querySelector("#cmp-next").addEventListener("click", () => {
    if (!nameEl.value.trim() || !suffixEl.value.trim()) return;
    showMemberStep(
      nameEl.value.trim(),
      suffixEl.value.trim().replace(/^@/, ""),
      currEl.value,
      payEl.value,
      shipEl.value,
    );
  });

  validateCompany();
}

function showMemberStep(companyName, emailSuffix, currency, paymentTerm, shipmentTerm) {
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
  panel.dataset.cmpCurrency = currency || "";
  panel.dataset.cmpPayment = paymentTerm || "";
  panel.dataset.cmpShipment = shipmentTerm || "";

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
        openCustomerPostSaveModal();
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
// Development / Create  (upper part)
//   - company fuzzy search (>=3 letters) -> link to customer view
//   - member dropdown (members of the selected company)
//   - product type dropdown
// ---------------------------------------------------------------------------

// Persistent state for the Development / Create tab. Hoisted to module scope so
// switching to another mini-tab and back does NOT lose what the user entered
// (company / member / product / dimensions / pasted images / dropped docs).
let devState = {
  companyId: "",
  companyName: "",
  memberId: "",
  memberName: "",
  item: "",
  product: "",
  // Part 3 details (persisted so tab switches keep them)
  height: "",
  width: "",
  raisedHeight: "",
  noOfColor: "",
  pantones: [],   // [{ value, color }]  one entry per color
  images: [],   // [{ id, name, url }]
  docs: [],     // [{ id, name, file }]
};

// Pool of sample images (from C:\Users\ng\Desktop\canvas_source) used by the
// Dummy button and the Development / View image column. Fetched once.
let devImagePool = null;   // [{ name, url }]
let devImagePoolLoading = null;

// When editing an existing development, the Create screen is reused pre-filled
// and the mini-tab shows "edit" (red background / black text).
let devEditMode = false;
let devEditId = null;

// Reference to the current Development/Create save-state updater so the
// module-level image thumbnail renderer can re-evaluate Save gating after a
// removal. The renderer is shared with the Dummy flow and cannot otherwise
// reach renderDevelopmentCreate()'s updateSaveState closure.
let devSaveStateFn = null;

// One-time cache of the company master list so we don't refetch on every repaint.
let devCompaniesCache = null;

// Pantone datasets — loaded once from static files.
// Two catalogs are wired in (per the project doc):
//   • fhi-tcx   -> pantone-numbers.json      (Fashion + Home TCX, keys like "11-0103")
//   • solid-c   -> pantone-solid-coated.json  (Solid Coated, keys like "Cool Gray 1 C", "100 C")
const PANTONE_CATALOGS = [
  { type: "TCX", file: "/pantone-numbers.json" },
  { type: "C",   file: "/pantone-solid-coated.json" },
];
// type suffix token -> catalog type (used to boost/score when the user hints it)
const PANTONE_TYPE_HINTS = { tcx: "TCX", tpg: "TPG", c: "C", u: "U" };

// catalog type code -> full human-readable name shown in the UI
const PANTONE_TYPE_NAMES = {
  TCX: "Fashion + Home TCX",
  TPG: "Fashion + Home TPG",
  C:   "Solid Coated",
  U:   "Solid Uncoated",
};
const pantoneTypeName = (t) => PANTONE_TYPE_NAMES[t] || t;

let pantoneData = null;        // [{ code, name, hex, type }]

// Load the Pantone catalogs once (no-op if already cached).
async function ensurePantoneData() {
  if (pantoneData) return;
  pantoneData = [];
  for (const cat of PANTONE_CATALOGS) {
    try {
      const raw = await fetchJson(API + cat.file);
      let map = raw;
      if (Array.isArray(raw)) {
        map = {};
        raw.forEach((e) => { map[e.code || e.name] = e; });
      }
      for (const [code, v] of Object.entries(map)) {
        pantoneData.push({ code, name: v.name || code, hex: v.hex, type: cat.type });
      }
    } catch (err) {
      // catalog unavailable — skip
    }
  }
}

// Fetch the image pool once (sample images from canvas_source). Returns
// [{ name, url }] where url points at the server's /sample-images/<rel> route.
async function ensureImagePool() {
  if (devImagePool) return devImagePool;
  if (devImagePoolLoading) return devImagePoolLoading;
  devImagePoolLoading = (async () => {
    try {
      const data = await fetchJson(API + "/api/sample-images");
      devImagePool = (data.files || []).map((f) => ({
        name: f,
        url: "/sample-images/" + f,
      }));
    } catch (err) {
      devImagePool = [];
    }
    return devImagePool;
  })();
  return devImagePoolLoading;
}

// Resolve a stored image name (as kept in developments.image_names) to a
// servable URL. Sample images live under /sample-images/<rel>; user-uploaded
// images are stored with an "uploads/" prefix and served from /uploads/<rest>.
function imageUrl(name) {
  if (!name) return "";
  if (name.startsWith("uploads/")) return API + "/" + name;
  return API + "/sample-images/" + encodeURI(name);
}

// Reset the persistent development state (used by Reset button + post-save
// "continue with same customer" path that only clears parts 2+).
function resetDevState() {
  devState.companyId = "";
  devState.companyName = "";
  devState.memberId = "";
  devState.memberName = "";
  devState.item = "";
  devState.product = "";
  devState.height = "";
  devState.width = "";
  devState.raisedHeight = "";
  devState.noOfColor = "";
  devState.pantones = [];
  devState.images = [];
  devState.docs = [];
}

// Build the development payload from current devState + DOM inputs.
function buildDevelopmentPayload() {
  const itemEl = panel.querySelector("#dev-item");
  const productEl = panel.querySelector("#dev-product");
  const memberEl = panel.querySelector("#dev-member");
  const companyName = devState.companyName;
  const item = (itemEl ? itemEl.value.trim() : devState.item) || devState.item;
  const product = (productEl ? productEl.value : devState.product) || devState.product;
  if (!companyName || !item || !product || devState.images.length < 1) return null;
  const memberName = memberEl && memberEl.value
    ? memberEl.options[memberEl.selectedIndex]?.textContent || ""
    : "";
  return {
    company_id: devState.companyId ? Number(devState.companyId) : null,
    company_name: companyName,
    member_id: devState.memberId ? Number(devState.memberId) : null,
    member_name: memberName || null,
    item_name: item,
    product_type: product,
    height: devState.height || null,
    width: devState.width || null,
    raised_height: devState.raisedHeight || null,
    no_of_color: devState.noOfColor ? Number(devState.noOfColor) : null,
    pantones: devState.pantones.filter((p) => p && p.value).map((p) => ({ value: p.value, color: p.color })),
    image_names: devState.images.map((i) => i.name),
    doc_names: devState.docs.map((d) => d.name),
  };
}

// Centered confirm modal (replaces window.confirm). onConfirm runs on "Yes".
function openConfirmModal(title, message, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:420px">
      <h3>${escapeHtml(title)}</h3>
      <p class="muted">${escapeHtml(message)}</p>
      <div class="actions modal-actions">
        <button class="btn ghost" id="cf-cancel" type="button">Cancel</button>
        <button class="btn primary" id="cf-ok" type="button">Yes</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#cf-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector("#cf-ok").addEventListener("click", () => {
    overlay.remove();
    onConfirm();
  });
}

// Centered post-create modal for Customer / Create: go to Customer / View,
// or stay and create another customer.
function openCustomerPostSaveModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:440px">
      <h3>Customer created</h3>
      <p class="muted">What would you like to do next?</p>
      <div class="actions modal-actions">
        <button class="btn ghost" id="cps-keep" type="button">Keep creating new customer</button>
        <button class="btn primary" id="cps-view" type="button">Go to Customer / View</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#cps-view").addEventListener("click", () => {
    overlay.remove();
    openTab("customer-view");
  });
  overlay.querySelector("#cps-keep").addEventListener("click", () => {
    overlay.remove();
    renderCustomerCreate();
  });
}

// Centered post-save modal: continue with the same customer, or go to View.
function openPostSaveModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:440px">
      <h3>Development saved</h3>
      <p class="muted">Continue with the same customer?</p>
      <div class="actions modal-actions">
        <button class="btn ghost" id="ps-view" type="button">No — go to Development / View</button>
        <button class="btn primary" id="ps-continue" type="button">Yes, same customer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#ps-view").addEventListener("click", () => {
    overlay.remove();
    openTab("development-view");
  });
  overlay.querySelector("#ps-continue").addEventListener("click", () => {
    overlay.remove();
    // keep Part 1 (company/member), clear the rest
    const keepCompanyId = devState.companyId;
    const keepCompanyName = devState.companyName;
    const keepMemberId = devState.memberId;
    resetDevState();
    devState.companyId = keepCompanyId;
    devState.companyName = keepCompanyName;
    devState.memberId = keepMemberId;
    renderDevelopmentCreate();
  });
}

// Fill every field with random data + 4 random images. `ctx` carries the
// element references + helpers from renderDevelopmentCreate().
async function fillDummyDevelopment(ctx) {
  const { searchEl, hiddenEl, memberEl, productEl, itemEl, companies,
          selectCompany, loadMembers, updateNextState, updateSaveState, updateUnlock } = ctx;
  try {
    // 1) random company
    const pool = companies && companies.length ? companies : (devCompaniesCache || []);
    if (!pool.length) {
      openConfirmModal("No companies", "There are no companies in the customer database yet. Create one first.", () => {});
      return;
    }
    const comp = rnd(pool);
    selectCompany(Number(comp.id), comp.name);
    await loadMembers(Number(comp.id));
    const memberOpts = [...memberEl.querySelectorAll("option")].filter((o) => o.value !== "");
    if (memberOpts.length) {
      const m = rnd(memberOpts);
      memberEl.value = m.value;
      devState.memberId = m.value;
    }

    // 2) item name + product type
    const ITEMS = ["Spring Patch", "Logo Badge", "Care Label", "Brand Tab", "Woven Emblem",
                   "Silicone Grip", "Heat Transfer", "Glitter Transfer", "Reflective Tape"];
    itemEl.value = rnd(ITEMS) + " " + (Math.floor(Math.random() * 900) + 100);
    devState.item = itemEl.value;
    const pt = rnd(PRODUCT_TYPES);
    productEl.value = pt;
    devState.product = pt;

    // 3) Part 3 details — set BEFORE rendering so inputs show the values
    if (pt === "raised silicon label") {
      devState.height = (Math.random() * 40 + 10).toFixed(1);
      devState.width = (Math.random() * 40 + 10).toFixed(1);
      devState.raisedHeight = (Math.random() * 3 + 0.5).toFixed(1);
      devState.noOfColor = String(Math.floor(Math.random() * 4) + 1);
      devState.pantones = [];
      for (let i = 0; i < Number(devState.noOfColor); i++) {
        devState.pantones.push({ value: "19-" + (Math.floor(Math.random() * 400) + 100) + " TCX", color: "#888888" });
      }
    } else {
      devState.height = (Math.random() * 40 + 10).toFixed(1);
      devState.width = (Math.random() * 40 + 10).toFixed(1);
      devState.raisedHeight = "";
      devState.noOfColor = "";
      devState.pantones.length = 0;
    }

    // 4) single image from the pool (a development requires exactly one image)
    const images = await ensureImagePool();
    // Clear in place (length = 0) rather than reassigning — the Render closure
    // captured `devState.images` by reference, so a reassignment would orphan
    // it and break later add/remove/reattach Save-gating.
    devState.images.length = 0;
    if (images && images.length) {
      const s = images[Math.floor(Math.random() * images.length)];
      devState.images.push({ id: "img-" + Date.now() + "-0", name: s.name, url: s.url });
    }

    // single synchronized render pass
    updateNextState();
    updateUnlock();          // renders Part 3 from current devState
    renderDevImageThumbs();  // draws the single image thumbnail
    updateSaveState();       // enables Save (>=1 image)
  } catch (err) {
    openConfirmModal("Dummy failed", String(err && err.message ? err.message : err), () => {});
  }
}

// Shared thumbnail renderer for the Development / Create image dropzone.
// After removing an image it re-evaluates Save gating (via devSaveStateFn).
function renderDevImageThumbs() {
  const imageThumbs = panel.querySelector("#dev-image-thumbs");
  if (!imageThumbs) return;
  const imageDrop = panel.querySelector("#dev-image-drop");
  if (devState.images.length) imageDrop.classList.add("has-items");
  else imageDrop.classList.remove("has-items");
  imageThumbs.innerHTML = devState.images.map((img) => `
    <div class="thumb" data-id="${img.id}">
      <img src="${img.url}" alt="${escapeHtml(img.name)}" />
      <div class="thumb-name">${escapeHtml(img.name)}</div>
      <button class="icon-btn danger thumb-rm" data-rm="${img.id}" title="Remove">✕</button>
    </div>`).join("");
  imageThumbs.querySelectorAll("[data-rm]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.dataset.rm;
      const i = devState.images.findIndex((x) => x.id === id);
      if (i >= 0) {
        openConfirmModal(
          "Remove image?",
          "Remove this image from the development?",
          () => {
            // Only remove after the user confirms "Yes".
            const j = devState.images.findIndex((x) => x.id === id);
            if (j >= 0) {
              devState.images.splice(j, 1);
              if (typeof devSaveStateFn === "function") devSaveStateFn();
              renderDevImageThumbs();
            }
          }
        );
      }
    });
  });
}

// Strip "PANTONE", suffixes (C/U/TCX/TPG/TPN), spaces, slashes — keep code chars.
function normalizePantone(s) {
  return (s || "").toLowerCase()
    .replace(/pantone/g, "")
    .replace(/[^a-z0-9-]/g, "")
    .trim();
}

// Detect an explicit catalog hint in the query (e.g. "cool gray 1 c" -> "C").
function detectPantoneHint(q) {
  const tokens = (q.toLowerCase().replace(/pantone/g, "").match(/[a-z]+/g) || []);
  for (const t of tokens) {
    if (PANTONE_TYPE_HINTS[t]) return PANTONE_TYPE_HINTS[t];
  }
  return null;
}

// Resolve a user query to a list of matching entries (best first), each tagged
// with its catalog type. Exact code -> exact name -> scored fuzzy (catalog-hint
// boost, then start-with, then shortest).
function findPantoneMatches(query, limit = 8) {
  if (!pantoneData) return [];
  const q = (query || "").trim();
  if (!q) return [];

  const norm = normalizePantone(q);
  const lower = q.toLowerCase().replace(/pantone/g, "").trim();
  const hint = detectPantoneHint(q);
  const results = [];
  const seen = new Set();
  const normKey = (code) =>
    code.toLowerCase().replace(/pantone/g, "").replace(/\s+/g, "").replace(/[^a-z0-9-]/g, "");

  // 1) exact code match across all catalogs (by normalized key)
  if (norm) {
    for (const e of pantoneData) {
      if (normKey(e.code) === norm && !seen.has(e.code + e.type)) {
        results.push(e); seen.add(e.code + e.type);
      }
    }
  }

  // 2) exact name match (case-insensitive)
  const byName = pantoneData.find((e) => e.name.toLowerCase() === lower && !seen.has(e.code + e.type));
  if (byName) { results.push(byName); seen.add(byName.code + byName.type); }

  // 3) fuzzy name matches, ranked with a small score
  const fuzzy = pantoneData
    .filter((e) => !seen.has(e.code + e.type) && fuzzyMatch(e.name, lower))
    .sort((a, b) => {
      const score = (e) => {
        let s = 0;
        if (hint && e.type === hint) s += 100;
        if (e.name.toLowerCase().startsWith(lower)) s += 10;
        s -= e.name.length * 0.1;
        return s;
      };
      return score(b) - score(a);
    })
    .slice(0, limit - results.length);

  return results.concat(fuzzy);
}

async function renderDevelopmentCreate() {
  panel.innerHTML = `
    <h2>${devEditMode ? "Development / Edit" : "Development / Create"}</h2>

    <div class="actions create-actions">
      ${devEditMode ? '<button class="btn ghost" id="dev-back" type="button">← Back</button>' : ''}
      <button class="btn ghost" id="dev-dummy" type="button">Dummy</button>
      <button class="btn primary" id="dev-save" type="button" disabled>${devEditMode ? "Update" : "Save"}</button>
    </div>

    <div class="dev-2col">
      <!-- Parts 1 + 2 + 3 stacked in one card -->
      <div class="dev-part" id="dev-main">
        <h3 class="subhead part-head">
          1 · Company &amp; Member
          <button class="icon-btn" id="dev-refresh" type="button" title="Refresh customer database">⟳</button>
        </h3>

        <div class="dim-row">
          <div class="field" id="dev-company-field">
            <div class="combobox" id="dev-company-wrap">
              <input id="dev-company" type="text" autocomplete="off"
                     placeholder="Type ≥ 3 letters to search…" disabled />
              <input type="hidden" id="dev-company-id" />
              <ul class="combobox-list" id="dev-company-list" role="listbox" hidden></ul>
            </div>
          </div>

          <div class="field" id="dev-member-field">
            <select id="dev-member" disabled>
              <option value="">— select a company first —</option>
            </select>
          </div>
        </div>

        <h3 class="subhead">2 · Item &amp; Product Type</h3>
        <div class="dim-row">
          <div class="field">
            <label for="dev-item">Item name</label>
            <input id="dev-item" type="text" placeholder="e.g. Spring Collection Patch" autocomplete="off" />
          </div>
          <div class="field">
            <label for="dev-product">Product type</label>
            <select id="dev-product" disabled>
              <option value="">— select —</option>
              ${PRODUCT_TYPES.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
            </select>
          </div>
        </div>

        <h3 class="subhead">3 · Details</h3>
        <div id="dev-part3-body"></div>
      </div>

      <!-- 4th part: image + documents (locked until part 1 + part 2 are complete) -->
      <div class="dev-part locked" id="dev-part4">
        <h3 class="subhead">4 · Image</h3>

        <div class="dropzone" id="dev-image-drop" tabindex="0">
          <div class="drop-region">
            <span class="drop-icon">🖼️</span>
            <p class="muted small drop-hint">Drop or paste <strong>one</strong> image here.<br/>A new image replaces the current one.</p>
          </div>
          <div class="thumb-grid" id="dev-image-thumbs"></div>
        </div>

        <h4 class="subhead">Documents</h4>
        <div class="dropzone" id="dev-doc-drop" tabindex="0">
          <div class="drop-region">
            <span class="drop-icon">📁</span>
            <p class="muted small drop-hint">Drag &amp; drop multiple files here.</p>
          </div>
          <div class="file-list" id="dev-doc-list"></div>
        </div>
      </div>
    </div>
  `;

  const part1 = panel.querySelector("#dev-main");
  const part2 = panel.querySelector("#dev-product");
  const searchEl = panel.querySelector("#dev-company");
  const hiddenEl = panel.querySelector("#dev-company-id");
  const listEl   = panel.querySelector("#dev-company-list");
  const memberEl = panel.querySelector("#dev-member");
  const productEl = panel.querySelector("#dev-product");
  const itemEl = panel.querySelector("#dev-item");
  const saveBtn = panel.querySelector("#dev-save");
  const dummyBtn = panel.querySelector("#dev-dummy");

  // --- Part 4 unlock when part 1 AND part 2 are complete ---
  const part3Body = panel.querySelector("#dev-part3-body");
  const part3 = part3Body;
  const part4 = panel.querySelector("#dev-part4");

  const updateUnlock = () => {
    // In edit mode the record is already complete, so trust restored state and
    // unlock immediately instead of waiting for the async member load.
    const allDone = (hiddenEl.value !== "" && memberEl.value !== "" && devState.product) || devEditMode;
    part4.classList.toggle("locked", !allDone);
    // Part 3 (details) is always visible; only Part 4 (image/docs) is gated.
    renderPart3();
  };

  // enable search once we have the company list
  let companies = [];
  try {
    if (devCompaniesCache) {
      companies = devCompaniesCache;
    } else {
      companies = await fetchJson(API + "/api/companies");
      devCompaniesCache = companies;
    }
  } catch (err) {
    searchEl.placeholder = "Failed to load companies: " + err.message;
    searchEl.disabled = true;
    return;
  }
  searchEl.disabled = false;

  // restore product selection
  if (devState.product) productEl.value = devState.product;
  // restore item name
  if (devState.item) itemEl.value = devState.item;

  // In edit mode, the record is already fully valid: don't blank the company/
  // member dropdowns while the async member load is still resolving. Seed the
  // company hidden field + search box AND the member dropdown synchronously so
  // Part 2 (product) stays enabled and the Save/Update button unlocks without
  // waiting on the network. Without this, updateNextState()/updateSaveState()
  // see an empty company and keep Save disabled — the edit appears to do nothing.
  if (devEditMode && devState.companyId && devState.memberId) {
    hiddenEl.value = devState.companyId;
    searchEl.value = devState.companyName;
    memberEl.innerHTML = `<option value="${devState.memberId}">${escapeHtml(devState.memberName || devState.memberId)}</option>`;
    memberEl.value = devState.memberId;
    memberEl.disabled = false;
  }

  // refresh = re-fetch latest companies + members from the customer database
  panel.querySelector("#dev-refresh").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.classList.add("spinning");
    const prevId = hiddenEl.value;
    try {
      companies = await fetchJson(API + "/api/companies");
      devCompaniesCache = companies;
      // if a company was chosen, reload its members so the list is current
      if (prevId !== "") {
        const stillThere = companies.some((c) => String(c.id) === String(prevId));
        if (stillThere) {
          await loadMembers(Number(prevId));
        } else {
          resetCompanySelection();
        }
      }
      // re-run the current search to refresh matches
      const q = searchEl.value.trim().toLowerCase();
      const matches = companies.filter((c) => fuzzyMatch(c.name, q)).slice(0, 12);
      renderOptions(matches);
      listEl.hidden = false;
      updateNextState();
    } catch (err) {
      alert("Refresh failed: " + err.message);
    } finally {
      btn.disabled = false;
      btn.classList.remove("spinning");
    }
  });

  // -- helpers --
  const updateNextState = () => {
    const part1Done = hiddenEl.value !== "" && memberEl.value !== "";
    // unlock part 2 once part 1 is complete
    part2.disabled = !part1Done;
    productEl.disabled = !part1Done;
    updateUnlock();
    updateSaveState();   // company/member change affects Save gating
  };

  // Track item name input into devState and re-evaluate Save gating.
  itemEl.addEventListener("input", () => {
    devState.item = itemEl.value.trim();
    updateSaveState();
  });

  // ---- Part 3 dynamic body (depends on product type) ----
  const renderPart3 = () => {
    ensurePantoneData();   // load the TCX dataset (no-op if already cached)
    if (devState.product === "raised silicon label") {
      renderRaisedSiliconLabel();
    } else {
      // default: just height + width
      part3Body.innerHTML = `
        <div class="dim-row">
          <div class="field">
            <label for="dev-height">Height (mm)</label>
            <input id="dev-height" type="number" min="0" step="0.1" placeholder="0.0" autocomplete="off" />
          </div>
          <div class="field">
            <label for="dev-width">Width (mm)</label>
            <input id="dev-width" type="number" min="0" step="0.1" placeholder="0.0" autocomplete="off" />
          </div>
        </div>`;
      bindDimInputs();
    }
  };

  const bindDimInputs = () => {
    const h = part3Body.querySelector("#dev-height");
    const w = part3Body.querySelector("#dev-width");
    if (h) { h.value = devState.height; h.addEventListener("input", () => { devState.height = h.value; updateSaveState(); }); }
    if (w) { w.value = devState.width;  w.addEventListener("input",  () => { devState.width  = w.value; updateSaveState(); }); }
  };

  const renderRaisedSiliconLabel = () => {
    part3Body.innerHTML = `
      <div class="dim-row">
        <div class="field">
          <label for="dev-height">Height (mm)</label>
          <input id="dev-height" type="number" min="0" step="0.1" placeholder="0.0" autocomplete="off" />
        </div>
        <div class="field">
          <label for="dev-width">Width (mm)</label>
          <input id="dev-width" type="number" min="0" step="0.1" placeholder="0.0" autocomplete="off" />
        </div>
      </div>
      <div class="dim-row">
        <div class="field">
          <label for="dev-raised-height">Raised height (mm)</label>
          <input id="dev-raised-height" type="number" min="0" step="0.1" placeholder="0.0" autocomplete="off" />
        </div>
        <div class="field">
          <label for="dev-no-of-color">No. of color</label>
          <input id="dev-no-of-color" type="number" min="1" step="1" placeholder="0" autocomplete="off" />
        </div>
      </div>
      <div id="dev-pantone-wrap"></div>
    `;

    bindDimInputs();
    const rh = part3Body.querySelector("#dev-raised-height");
    const nc = part3Body.querySelector("#dev-no-of-color");
    if (rh) { rh.value = devState.raisedHeight; rh.addEventListener("input", () => { devState.raisedHeight = rh.value; updateSaveState(); }); }
    if (nc) {
      nc.value = devState.noOfColor;
      // update only the pantone rows (not the whole body) to keep focus
      nc.addEventListener("input", () => {
        devState.noOfColor = nc.value;
        renderPantoneRows();
        updateSaveState();
      });
    }
    renderPantoneRows();
  };

  // re-render only the pantone input rows (keeps focus on the No. of color field)
  const renderPantoneRows = () => {
    const wrap = part3Body.querySelector("#dev-pantone-wrap");
    if (!wrap) return;
    const n = parseInt(devState.noOfColor, 10);
    if (!isNaN(n) && n > 0) {
      while (devState.pantones.length < n) devState.pantones.push({ value: "", color: "#000000" });
      if (devState.pantones.length > n) devState.pantones.length = n;
    }
    if ((parseInt(devState.noOfColor, 10) || 0) <= 0) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = devState.pantones.map((p, i) => `
      <div class="pantone-row">
        <div class="field pantone-code">
          <label for="dev-pantone-${i}">Pantone #${i + 1}</label>
          <input id="dev-pantone-${i}" type="text" class="pantone-input"
                 data-idx="${i}" value="${escapeHtml(p.value)}"
                 placeholder="code (11-0103) or name (egret)" autocomplete="off" />
          <div class="pantone-match" id="dev-pantone-match-${i}"></div>
        </div>
      </div>`).join("");
    // Build + fill the match display for row i from a query string.
    // Used both on live typing and when restoring state after a tab switch.
    const showPantoneMatch = (i, query) => {
      const matchEl = wrap.querySelector("#dev-pantone-match-" + i);
      if (!matchEl) return;
      const matches = findPantoneMatches(query);
      if (!matches.length) {
        matchEl.innerHTML = `<span class="muted small">No match</span>`;
        return;
      }
      const top = matches[0];
      if (devState.pantones[i]) devState.pantones[i].color = "#" + top.hex;

      matchEl.innerHTML =
        `<div class="pantone-top">` +
          `<span class="swatch" style="background:#${escapeHtml(top.hex)}"></span>` +
          `<span class="muted small">${escapeHtml(top.code)} · ${escapeHtml(top.name)} · ` +
          `<span class="pantone-type" title="${escapeHtml(pantoneTypeName(top.type))}">${escapeHtml(pantoneTypeName(top.type))}</span> · #${escapeHtml(top.hex)}</span>` +
        `</div>` +
        (matches.length > 1
          ? `<div class="pantone-similar">similar: ` +
            matches.slice(1).map((m) =>
              `<span class="pantone-chip" data-code="${escapeHtml(m.code)}" ` +
              `title="${escapeHtml(m.code)} · ${escapeHtml(m.name)} · ${escapeHtml(pantoneTypeName(m.type))}">` +
                `<span class="swatch sm" style="background:#${escapeHtml(m.hex)}"></span>` +
                `${escapeHtml(m.name)} ` +
                `<span class="pantone-type" title="${escapeHtml(pantoneTypeName(m.type))}">${escapeHtml(pantoneTypeName(m.type))}</span></span>`
            ).join("") +
            `</div>`
          : "");

      // clicking a similar chip fills the input with that code and shows the
      // chosen color as plain text + square swatch below
      matchEl.querySelectorAll(".pantone-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const inp = wrap.querySelector("#dev-pantone-" + i);
          if (inp) inp.value = chip.dataset.code;
          if (devState.pantones[i]) devState.pantones[i].value = chip.dataset.code;
          const chosen = findPantoneMatches(chip.dataset.code)[0];
          matchEl.innerHTML = chosen
            ? `<div class="pantone-top">` +
              `<span class="swatch" style="background:#${escapeHtml(chosen.hex)}"></span>` +
              `<span class="muted small">${escapeHtml(chosen.code)} · ${escapeHtml(chosen.name)} · ` +
              `<span class="pantone-type" title="${escapeHtml(pantoneTypeName(chosen.type))}">${escapeHtml(pantoneTypeName(chosen.type))}</span> · #${escapeHtml(chosen.hex)}</span>` +
              `</div>`
            : "";
        });
      });
    };

    wrap.querySelectorAll(".pantone-input").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = Number(inp.dataset.idx);
        if (!devState.pantones[i]) return;
        devState.pantones[i].value = inp.value;
        showPantoneMatch(i, inp.value);
        updateSaveState();
      });
    });

    // restore any previously-typed matches (so they survive a tab switch)
    devState.pantones.forEach((p, i) => {
      if (p && p.value) showPantoneMatch(i, p.value);
    });
  };

  const resetCompanySelection = () => {
    hiddenEl.value = "";
    memberEl.value = "";
    memberEl.disabled = true;
    memberEl.innerHTML = `<option value="">— select a company first —</option>`;
    devState.companyId = "";
    devState.companyName = "";
    devState.memberId = "";
    updateNextState();
  };

  const loadMembers = async (companyId, restoreMemberId) => {
    try {
      const comp = await fetchAnchoredCompany(companyId);
      const members = comp.members || [];
      memberEl.innerHTML = members.length
        ? `<option value="">— select a member —</option>` +
          members.map((m) =>
            `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("")
        : `<option value="">— no members —</option>`;
      memberEl.disabled = !members.length;
      // restore previously selected member if it still exists
      if (restoreMemberId != null && members.some((m) => String(m.id) === String(restoreMemberId))) {
        memberEl.value = String(restoreMemberId);
      }
    } catch (err) {
      memberEl.innerHTML = `<option value="">— load failed —</option>`;
      memberEl.disabled = true;
    }
    updateNextState();
  };

  // -- typeahead --
  const renderOptions = (matches) => {
    if (!matches.length) {
      listEl.innerHTML = `<li class="combobox-empty">No matches</li>`;
    } else {
      listEl.innerHTML = matches.map((c, i) =>
        `<li class="combobox-item" role="option" data-id="${c.id}" data-name="${escapeHtml(c.name)}" data-idx="${i}">` +
        `${escapeHtml(c.name)}</li>`).join("");
      listEl.querySelectorAll(".combobox-item").forEach((li) => {
        li.addEventListener("click", () => selectCompany(Number(li.dataset.id), li.dataset.name));
      });
      // auto-highlight the first match so Enter/Tab can accept it immediately
      listEl.querySelectorAll(".combobox-item").forEach((it, i) => {
        it.classList.toggle("active", i === 0);
      });
    }
    listEl.hidden = false;
  };

  const selectCompany = (id, name) => {
    hiddenEl.value = id;
    searchEl.value = name;
    listEl.hidden = true;
    memberEl.value = "";
    devState.companyId = String(id);
    devState.companyName = name;
    devState.memberId = "";
    loadMembers(id);
    updateNextState();
  };

  searchEl.addEventListener("input", () => {
    const q = searchEl.value.trim().toLowerCase();
    hiddenEl.value = "";
    memberEl.value = "";
    memberEl.disabled = true;
    memberEl.innerHTML = `<option value="">— select a company first —</option>`;
    devState.companyId = "";
    devState.companyName = "";
    devState.memberId = "";
    if (q.length < 3) {
      listEl.hidden = true;
      updateNextState();
      return;
    }
    const matches = companies.filter((c) => fuzzyMatch(c.name, q)).slice(0, 12);
    renderOptions(matches);
    updateNextState();
  });

  searchEl.addEventListener("blur", () => {
    // delay so click on option registers
    setTimeout(() => { listEl.hidden = true; }, 120);
  });

  searchEl.addEventListener("keydown", (e) => {
    if (listEl.hidden) return;
    const items = [...listEl.querySelectorAll(".combobox-item")];
    if (!items.length) return;
    const active = listEl.querySelector(".combobox-item.active");
    let idx = items.indexOf(active);
    if (idx < 0) idx = 0;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      idx = Math.min(items.length - 1, idx + 1);
      items.forEach((it) => it.classList.remove("active"));
      if (items[idx]) { items[idx].classList.add("active"); items[idx].scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      idx = Math.max(0, idx - 1);
      items.forEach((it) => it.classList.remove("active"));
      if (items[idx]) { items[idx].classList.add("active"); items[idx].scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "Enter" || e.key === "Tab") {
      // accept the highlighted (or first) match without moving focus away
      e.preventDefault();
      const pick = items[idx] || items[0];
      if (pick) selectCompany(Number(pick.dataset.id), pick.dataset.name);
    } else if (e.key === "Escape") {
      listEl.hidden = true;
    }
  });

  memberEl.addEventListener("change", () => {
    devState.memberId = memberEl.value;
    updateNextState();
  });
  productEl.addEventListener("change", () => {
    devState.product = productEl.value;
    updateNextState();
  });

  // Part 3 (Details) validation: every visible Details field must be filled
  // before Save/Update is allowed.
  //   • Height + Width are always required.
  //   • For "raised silicon label": Raised height + No. of color are required.
  //   • When No. of color > 1, every Pantone code must be filled and be
  //     meaningful — its length must be greater than 1 (reject single-char stubs).
  const part3Valid = () => {
    const h = (devState.height || "").trim();
    const w = (devState.width || "").trim();
    if (h.length === 0 || w.length === 0) return false;   // height + width always required

    if (devState.product === "raised silicon label") {
      const rh = (devState.raisedHeight || "").trim();
      if (rh.length === 0) return false;                   // raised height required

      const n = parseInt(devState.noOfColor, 10);
      if (!n || n < 1) return false;                       // no. of color required (>= 1)

      if (n >= 1) {
        // every shown Pantone row needs a non-trivial code (length must be > 1).
        // Pantone #1 is shown as soon as no. of color >= 1, so it must be filled.
        for (const p of devState.pantones) {
          const v = (p && (p.value || "") || "").trim().length;
          if (v <= 1) return false;
        }
      }
    }
    return true;
  };

  // Save gating: every required field filled AND at least one image present.
  const updateSaveState = () => {
    const allFilled = hiddenEl.value !== "" && memberEl.value !== "" &&
                      devState.item && devState.product &&
                      devState.images.length >= 1 &&
                      part3Valid();
    saveBtn.disabled = !allFilled;
    saveBtn.classList.toggle("active", allFilled);
  };

  // initial unlock check (covers restored state on tab switch)
  updateNextState();
  updateSaveState();
  devSaveStateFn = updateSaveState;   // let the shared image renderer re-gate Save

  // ===== 4th part: image dropzone + documents =====
  const imageDrop = panel.querySelector("#dev-image-drop");
  const imageThumbs = panel.querySelector("#dev-image-thumbs");
  const docDrop = panel.querySelector("#dev-doc-drop");
  const docList = panel.querySelector("#dev-doc-list");

  // use the persisted stores so pasted images / dropped docs survive tab switches
  const images = devState.images;
  const docs = devState.docs;

  const isImageFile = (f) => f && f.type && f.type.startsWith("image/");

  const renderImageThumbs = () => {
    if (!images.length) {
      imageThumbs.innerHTML = "";
      imageDrop.classList.remove("has-items");
      return;
    }
    imageDrop.classList.add("has-items");
    imageThumbs.innerHTML = images.map((img) => `
      <div class="thumb" data-id="${img.id}">
        <img src="${img.url}" alt="${escapeHtml(img.name)}" />
        <div class="thumb-name">${escapeHtml(img.name)}</div>
        ${img.uploading ? '<span class="thumb-badge uploading">uploading…</span>' : ''}
        <button class="icon-btn danger thumb-rm" data-rm="${img.id}" title="Remove">✕</button>
      </div>`).join("");
    imageThumbs.querySelectorAll("[data-rm]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.rm;
        const idx = images.findIndex((x) => x.id === id);
        if (idx >= 0) {
          openConfirmModal(
            "Remove image?",
            "Remove this image from the development?",
            () => {
              // Only remove after the user confirms "Yes".
              const j = images.findIndex((x) => x.id === id);
              if (j >= 0) {
                if (images[j].url && images[j].url.startsWith("blob:")) {
                  URL.revokeObjectURL(images[j].url);
                }
                images.splice(j, 1);
                renderImageThumbs();
                updateSaveState();   // re-gate Save now that an image is gone
              }
            }
          );
        }
      });
    });
  };

  const addImageFile = (file) => {
    if (!isImageFile(file)) return;
    // Only one image is allowed — a new attachment replaces the previous one.
    if (images.length) URL.revokeObjectURL(images[0].url);
    const localUrl = URL.createObjectURL(file);
    // Optimistically show the dropped image, then upload it so the development
    // is linked to a persisted file (served from /uploads/... on reload).
    const id = "img-" + Date.now() + "-0";
    images.length = 0;
    images.push({ id, name: file.name, url: localUrl, uploading: true });
    renderImageThumbs();
    updateSaveState();
    uploadImageFile(file, id);
  };

  // Upload a dropped/pasted image to /api/uploads and link it to the dev sequence.
  const uploadImageFile = async (file, id) => {
    const entry = images.find((x) => x.id === id);
    if (!entry) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await fetchJson(API + "/api/uploads", { method: "POST", body: fd });
      // Store the server path so the saved development references the upload.
      entry.name = data.path;          // e.g. "uploads/<uuid>__<file>"
      entry.url = data.url;            // e.g. "/uploads/<uuid>__<file>"
      entry.uploading = false;
      renderImageThumbs();
      updateSaveState();
    } catch (err) {
      if (entry) entry.uploading = false;
      openConfirmModal("Upload failed", "Could not upload image: " + err.message, () => {});
    }
  };

  // drag & drop for images
  ["dragenter", "dragover"].forEach((ev) =>
    imageDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      imageDrop.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    imageDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === "dragleave" && imageDrop.contains(e.relatedTarget)) return;
      imageDrop.classList.remove("dragover");
    })
  );
  imageDrop.addEventListener("drop", (e) => {
    // Only one image is allowed — take just the first dropped file.
    const first = [...(e.dataTransfer?.files || [])].find(isImageFile);
    if (first) addImageFile(first);
  });

  // Ctrl+V paste image (only one image is allowed — take the first pasted)
  imageDrop.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { addImageFile(f); e.preventDefault(); break; }
      }
    }
  });

  // ---- documents ----
  const renderDocList = () => {
    if (!docs.length) {
      docList.innerHTML = "";
      docDrop.classList.remove("has-items");
      return;
    }
    docDrop.classList.add("has-items");
    docList.innerHTML = docs.map((d) => `
      <div class="doc-row" data-id="${d.id}">
        <span class="doc-icon">📄</span>
        <input class="doc-name" data-id="${d.id}" type="text" value="${escapeHtml(d.name)}" />
        <span class="doc-size muted small">${d.file ? formatBytes(d.file.size) : "saved"}</span>
        ${d.uploading ? '<span class="thumb-badge uploading">uploading…</span>' : ''}
        <button class="icon-btn danger doc-rm" data-rm="${d.id}" title="Remove">✕</button>
      </div>`).join("");
    docList.querySelectorAll(".doc-rm").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.rm;
        const idx = docs.findIndex((x) => x.id === id);
        if (idx >= 0) { docs.splice(idx, 1); renderDocList(); }
      });
    });
    docList.querySelectorAll(".doc-name").forEach((inp) => {
      inp.addEventListener("input", () => {
        const d = docs.find((x) => x.id === inp.dataset.id);
        if (d) d.name = inp.value;
      });
    });
  };

  // Documents are never stored as blob URLs — they're uploaded to /api/uploads
  // so they survive a save + reload + edit. Seed an optimistic row, then swap
  // the name to the server path once the upload resolves.
  const addDocFiles = async (fileList) => {
    for (const f of fileList) {
      const id = "doc-" + Date.now() + "-" + docs.length;
      const entry = { id, name: f.name, file: f, uploading: true };
      docs.push(entry);
      renderDocList();
      try {
        const r = await uploadFile(f);
        entry.name = r.path;            // "uploads/<uuid>__<file>"
        entry.url = API + r.path;       // servable from /uploads/...
        entry.uploading = false;
      } catch (err) {
        entry.uploading = false;
        openConfirmModal("Upload failed", "Could not upload document: " + err.message, () => {});
      }
      renderDocList();
    }
  };

  ["dragenter", "dragover"].forEach((ev) =>
    docDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      docDrop.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    docDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === "dragleave" && docDrop.contains(e.relatedTarget)) return;
      docDrop.classList.remove("dragover");
    })
  );
  docDrop.addEventListener("drop", (e) => {
    addDocFiles(e.dataTransfer?.files || []);
  });

  renderImageThumbs();
  renderDocList();

  updateNextState();
  updateSaveState();

  // ===== Action buttons: Dummy / Save =====

  dummyBtn.addEventListener("click", () => fillDummyDevelopment({
    searchEl, hiddenEl, memberEl, productEl, itemEl, listEl, companies,
    selectCompany, loadMembers, updateNextState, updateSaveState, updateUnlock,
  }));

  // In edit mode, "Back" discards the edit and returns to Development / View
  // (no save). Only shown when devEditMode is on.
  const backBtn = panel.querySelector("#dev-back");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      devEditMode = false;
      devEditId = null;
      resetDevState();
      openTab("development-view");
    });
  }

  saveBtn.addEventListener("click", async () => {
    if (saveBtn.disabled) return;
    const payload = buildDevelopmentPayload();
    if (!payload) {
      openConfirmModal("Cannot save", "Please fill company, member, item, product type, and at least one image.", () => {});
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    const verb = devEditMode ? "Update" : "Save";
    try {
      if (devEditMode && devEditId != null) {
        await fetchJson(API + `/api/developments/${devEditId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        devEditMode = false;
        devEditId = null;
        openTab("development-view");
      } else {
        await fetchJson(API + "/api/developments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        openPostSaveModal();
      }
    } catch (err) {
      saveBtn.textContent = verb;
      saveBtn.disabled = false;
      openConfirmModal(verb + " failed", "Could not save development: " + err.message, () => {});
    }
  });

}

// ---------------------------------------------------------------------------
// Development / View
// ---------------------------------------------------------------------------

let devViewData = [];        // raw rows from /api/developments
let devViewFilters = {};      // {company, member, item, product, ...}
let devViewSelected = new Set(); // selected keys: "d:<id>"

// Build a short Part-3 details summary for the View's Details column.
function devDetailsSummary(d) {
  const parts = [];
  if (d.height || d.width) {
    parts.push(`${(d.height || "?")} × ${(d.width || "?")} mm`);
  }
  if (d.raised_height) parts.push(`raised ${d.raised_height} mm`);
  if (d.no_of_color) {
    const cols = (d.pantones || []).filter((p) => p && p.value).map((p) => p.value);
    parts.push(`${d.no_of_color} color${Number(d.no_of_color) > 1 ? "s" : ""}` + (cols.length ? ` (${cols.join(", ")})` : ""));
  }
  return parts.join(" · ");
}

async function renderDevelopmentView() {
  panel.innerHTML = '<h2>Development / View</h2><p class="empty">Loading…</p>';
  devViewSelected.clear();
  try {
    devViewData = await fetchJson(API + "/api/developments");
    if (!devViewData.length) {
      panel.innerHTML = '<h2>Development / View</h2><p class="empty">No developments saved yet.</p>';
      return;
    }
    paintDevelopmentView();
  } catch (err) {
    panel.innerHTML = `<h2>Development / View</h2><p class="empty">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

function paintDevelopmentView() {
  const cols = [
    { key: "company_name", label: "Company" },
    { key: "member_name", label: "Member" },
    { key: "item_name", label: "Item" },
    { key: "product_type", label: "Product Type" },
    { key: "image", label: "Image" },
    { key: "documents", label: "Documents" },
    { key: "created_at", label: "Created" },
    { key: "updated_at", label: "Updated" },
    { key: "details", label: "Details" },
  ];

  // image / documents / details are rendered specially and not column-searched
  const searchCols = cols.filter(
    (c) => c.key !== "image" && c.key !== "documents" && c.key !== "details"
  );

  const shown = devViewData.filter((r) =>
    searchCols.every((c) => fuzzyMatch(r[c.key], devViewFilters[c.key]))
  );

  const allKeys = shown.map((r) => "d:" + r.id);
  const allChecked = allKeys.length > 0 && allKeys.every((k) => devViewSelected.has(k));

  const searchRow = cols.map((c) => {
    if (c.key === "image" || c.key === "documents" || c.key === "details") {
      return `<th class="search-th"></th>`;
    }
    return `<th class="search-th">
       <input class="col-search" data-key="${c.key}" type="text"
              placeholder="Search ${c.label}…" value="${escapeHtml(devViewFilters[c.key] || "")}" />
     </th>`;
  }).join("") + `<th class="search-th actions-th"></th>`;

  const body = shown.map((r) => {
    const checked = devViewSelected.has("d:" + r.id);
    const imgs = (r.image_names || []).slice(0, 3);
    const thumbs = imgs.length
      ? `<div class="dev-thumbs">` + imgs.map((n) =>
          `<img class="dev-thumb-sm" src="${assetUrl(n)}" alt="${escapeHtml(n)}" title="${escapeHtml(n)}" />`).join("") + `</div>`
      : `<span class="muted">—</span>`;
    const docs = (r.doc_names || []).map((n) =>
      `<a class="doc-tag" href="${assetUrl(n)}" target="_blank" rel="noopener" download title="${escapeHtml(n)}">📄 ${escapeHtml(displayName(n))}</a>`).join("");
    const docLinks = docs || `<span class="muted">—</span>`;
    return `
      <tr class="${checked ? "selected" : ""}">
        <td>
          <label class="cb-cell">
            <input type="checkbox" class="row-select" data-key="d:${r.id}" ${checked ? "checked" : ""} />
          </label>
        </td>
        <td>${escapeHtml(r.company_name)}</td>
        <td>${escapeHtml(r.member_name || "—")}</td>
        <td>${escapeHtml(r.item_name)}</td>
        <td>${escapeHtml(r.product_type)}</td>
        <td class="cell-imgs">${thumbs}</td>
        <td class="cell-docs">${docLinks}</td>
        <td>${escapeHtml(r.created_at)}</td>
        <td>${escapeHtml(r.updated_at)}</td>
        <td class="details-cell">${escapeHtml(devDetailsSummary(r))}</td>
        <td class="row-actions">
          <button class="icon-btn" data-edit="${r.id}" title="Edit">✎</button>
          <button class="icon-btn danger" data-del="${r.id}" title="Delete">🗑</button>
        </td>
      </tr>`;
  }).join("") || `<tr><td colspan="11" class="muted">No matches.</td></tr>`;

  panel.innerHTML = `
    <div class="view-head">
      <h2>Development / View</h2>
      <div class="view-actions">
        <button class="btn ghost" id="dev-export" type="button">Export Excel</button>
      </div>
    </div>

    <div class="batch-bar" id="batch-bar">
      <label class="cb-cell">
        <input type="checkbox" id="select-all" ${allChecked ? "checked" : ""} />
        <span>Select all (${allKeys.length})</span>
      </label>
      <span class="muted batch-count" id="batch-count">${devViewSelected.size} selected</span>
      <button class="btn danger" id="batch-delete" type="button" disabled>Delete selected</button>
    </div>

    <table class="grid dev-grid" id="development-grid">
      <thead>
        <tr class="head-row">
          <th></th>
          ${cols.map((c) => `<th>${c.label}</th>`).join("")}
          <th class="actions-th">Actions</th>
        </tr>
        <tr class="search-row"><th></th>${searchRow}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;

  // per-column fuzzy search
  panel.querySelectorAll(".col-search").forEach((inp) => {
    inp.addEventListener("input", () => {
      devViewFilters[inp.dataset.key] = inp.value;
      const cursor = inp.selectionStart;
      paintDevelopmentView();
      const same = panel.querySelector(`.col-search[data-key="${inp.dataset.key}"]`);
      if (same) { same.focus(); same.setSelectionRange(cursor, cursor); }
    });
  });

  panel.querySelector("#dev-export").addEventListener("click", () =>
    exportDevelopmentExcel(shown));

  // --- batch selection ---
  const selectAll = panel.querySelector("#select-all");
  const batchDelete = panel.querySelector("#batch-delete");
  const batchCount = panel.querySelector("#batch-count");

  const syncBatchUI = () => {
    batchCount.textContent = devViewSelected.size + " selected";
    batchDelete.disabled = devViewSelected.size === 0;
    selectAll.checked = allKeys.length > 0 && allKeys.every((k) => devViewSelected.has(k));
  };

  panel.querySelectorAll(".row-select").forEach((cb) => {
    cb.addEventListener("change", () => {
      const key = cb.dataset.key;
      if (cb.checked) devViewSelected.add(key);
      else devViewSelected.delete(key);
      panel.querySelectorAll(`.row-select[data-key="${key}"]`).forEach((sib) => {
        sib.checked = cb.checked;
        const tr = sib.closest("tr");
        if (tr) tr.classList.toggle("selected", cb.checked);
      });
      syncBatchUI();
    });
  });

  selectAll.addEventListener("change", () => {
    if (selectAll.checked) allKeys.forEach((k) => devViewSelected.add(k));
    else allKeys.forEach((k) => devViewSelected.delete(k));
    panel.querySelectorAll(".row-select").forEach((cb) => {
      cb.checked = selectAll.checked;
      const tr = cb.closest("tr");
      if (tr) tr.classList.toggle("selected", selectAll.checked);
    });
    syncBatchUI();
  });

  batchDelete.addEventListener("click", batchDeleteDevelopments);

  panel.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => editDevelopmentInCreate(Number(b.dataset.edit)));
  });
  panel.querySelectorAll("[data-del]").forEach((b) => {
    b.addEventListener("click", () => deleteDevelopment(Number(b.dataset.del)));
  });
}

async function batchDeleteDevelopments() {
  const keys = [...devViewSelected];
  if (!keys.length) return;
  const ids = keys.filter((k) => k.startsWith("d:")).map((k) => Number(k.slice(2)));
  if (!ids.length) return;
  openConfirmModal(
    "Delete developments?",
    `Delete ${ids.length} development${ids.length === 1 ? "" : "s"} permanently?`,
    async () => {
      const btn = panel.querySelector("#batch-delete");
      if (btn) { btn.disabled = true; btn.textContent = "Deleting…"; }
      let failed = 0;
      for (const id of ids) {
        try { await fetchJson(API + `/api/developments/${id}`, { method: "DELETE" }); }
        catch (err) { failed++; }
      }
      if (failed) openConfirmModal("Partial failure", `${failed} deletion(s) failed.`, () => {});
      devViewSelected.clear();
      await renderDevelopmentView();
    }
  );
}

async function deleteDevelopment(id) {
  const rec = devViewData.find((r) => r.id === id);
  const label = rec ? `${rec.company_name} / ${rec.item_name}` : `#${id}`;
  openConfirmModal(
    "Delete development?",
    `Delete "${label}" permanently?`,
    async () => {
      try {
        await fetchJson(API + `/api/developments/${id}`, { method: "DELETE" });
        devViewSelected.delete("d:" + id);
        await renderDevelopmentView();
      } catch (err) {
        openConfirmModal("Delete failed", err.message, () => {});
      }
    }
  );
}

// Load an existing development into the Create screen (pre-filled) and switch
// the mini-tab to "edit" (red background / black text). Reuses devState so the
// Create renderer restores every field, then the Update button PUTs the record.
async function editDevelopmentInCreate(id) {
  let rec;
  try {
    rec = await fetchJson(API + `/api/developments/${id}`);
  } catch (err) {
    openConfirmModal("Load failed", err.message, () => {});
    return;
  }

  // seed the persistent state from the record
  resetDevState();
  devState.companyId = rec.company_id != null ? String(rec.company_id) : "";
  devState.companyName = rec.company_name || "";
  devState.memberId = rec.member_id != null ? String(rec.member_id) : "";
  devState.memberName = rec.member_name || "";
  devState.item = rec.item_name || "";
  devState.product = rec.product_type || "";

  // Part 3 details
  devState.height = rec.height != null ? String(rec.height) : "";
  devState.width = rec.width != null ? String(rec.width) : "";
  devState.raisedHeight = rec.raised_height != null ? String(rec.raised_height) : "";
  devState.noOfColor = rec.no_of_color != null ? String(rec.no_of_color) : "";
  devState.pantones = Array.isArray(rec.pantones) ? rec.pantones.map((p) => ({ value: p.value || "", color: p.color || "#000000" })) : [];

  // images — resolve each saved name to its servable URL (sample or upload).
  devState.images = (rec.image_names || []).map((n) => ({
    id: "eimg-" + n,
    name: n,
    url: assetUrl(n),
  }));

  // documents — seed from saved doc_names. The bytes are gone after a reload,
  // so we keep just the name (file: null → shows "saved"). They re-link to the
  // persisted /uploads/ file when edited/saved again.
  devState.docs = (rec.doc_names || []).map((name, i) => ({
    id: "edoc-" + rec.id + "-" + i,
    name,
    file: null,
  }));

  devEditMode = true;
  devEditId = rec.id;
  openTab("development-create");
}

// Edit modal for a development record. Prefilled with all fields + images.
async function openDevEditModal(id) {
  let rec;
  try {
    rec = await fetchJson(API + `/api/developments/${id}`);
  } catch (err) {
    openConfirmModal("Load failed", err.message, () => {});
    return;
  }

  // local editable image list (seeded from saved names -> pool urls)
  const pool = await ensureImagePool();
  const findInPool = (name) => pool.find((p) => p.name === name);
  const editImages = (rec.image_names || []).map((n) => {
    const hit = findInPool(n);
    return { id: "eimg-" + Math.random().toString(36).slice(2), name: n, url: hit ? hit.url : "" };
  });

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:620px">
      <h3>Edit development</h3>
      <div class="field">
        <label>Company</label>
        <input id="ed-company" type="text" value="${escapeHtml(rec.company_name)}" />
      </div>
      <div class="field">
        <label>Member</label>
        <input id="ed-member" type="text" value="${escapeHtml(rec.member_name || "")}" />
      </div>
      <div class="dim-row">
        <div class="field">
          <label for="ed-item">Item name</label>
          <input id="ed-item" type="text" value="${escapeHtml(rec.item_name)}" />
        </div>
        <div class="field">
          <label for="ed-product">Product type</label>
          <select id="ed-product">
            ${PRODUCT_TYPES.map((p) =>
              `<option value="${escapeHtml(p)}" ${p === rec.product_type ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="dim-row">
        <div class="field">
          <label for="ed-height">Height (mm)</label>
          <input id="ed-height" type="number" step="0.1" value="${escapeHtml(rec.height ?? "")}" />
        </div>
        <div class="field">
          <label for="ed-width">Width (mm)</label>
          <input id="ed-width" type="number" step="0.1" value="${escapeHtml(rec.width ?? "")}" />
        </div>
      </div>
      <div class="dim-row">
        <div class="field">
          <label for="ed-raised">Raised height (mm)</label>
          <input id="ed-raised" type="number" step="0.1" value="${escapeHtml(rec.raised_height ?? "")}" />
        </div>
        <div class="field">
          <label for="ed-nocolor">No. of color</label>
          <input id="ed-nocolor" type="number" step="1" value="${escapeHtml(rec.no_of_color ?? "")}" />
        </div>
      </div>

      <h4 class="subhead">Images</h4>
      <div class="dropzone" id="ed-image-drop" tabindex="0">
        <div class="drop-region">
          <span class="drop-icon">🖼️</span>
          <p class="muted small drop-hint">Drag &amp; drop images here,<br/>or press <strong>Ctrl+V</strong> to paste.</p>
        </div>
        <div class="thumb-grid" id="ed-image-thumbs"></div>
      </div>

      <div class="actions modal-actions">
        <button class="btn ghost" id="ed-cancel" type="button">Cancel</button>
        <button class="btn primary" id="ed-save" type="button">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const renderEditThumbs = () => {
    const wrap = overlay.querySelector("#ed-image-thumbs");
    const drop = overlay.querySelector("#ed-image-drop");
    if (editImages.length) drop.classList.add("has-items");
    else drop.classList.remove("has-items");
    wrap.innerHTML = editImages.map((img) => `
      <div class="thumb" data-id="${img.id}">
        ${img.url ? `<img src="${img.url}" alt="${escapeHtml(img.name)}" />` : `<div class="thumb-name">${escapeHtml(img.name)}</div>`}
        <div class="thumb-name">${escapeHtml(img.name)}</div>
        <button class="icon-btn danger thumb-rm" data-rm="${img.id}" title="Remove">✕</button>
      </div>`).join("");
    wrap.querySelectorAll("[data-rm]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.rm;
        const i = editImages.findIndex((x) => x.id === id);
        if (i >= 0) {
          openConfirmModal(
            "Remove image?",
            "Remove this image from the development?",
            () => {
              // Only remove after the user confirms "Yes".
              const j = editImages.findIndex((x) => x.id === id);
              if (j >= 0) { editImages.splice(j, 1); renderEditThumbs(); }
            }
          );
        }
      });
    });
  };
  renderEditThumbs();

  // drag & drop + paste inside the modal
  const dropEl = overlay.querySelector("#ed-image-drop");
  const isImg = (f) => f && f.type && f.type.startsWith("image/");
  const addFile = (file) => {
    if (!isImg(file)) return;
    // Only one image is allowed — a new attachment replaces the previous one.
    editImages.splice(0, editImages.length, {
      id: "eimg-" + Math.random().toString(36).slice(2),
      name: file.name,
      url: URL.createObjectURL(file),
    });
    renderEditThumbs();
  };
  ["dragenter", "dragover"].forEach((ev) => dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) => dropEl.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && dropEl.contains(e.relatedTarget)) return;
    dropEl.classList.remove("dragover");
  }));
  dropEl.addEventListener("drop", (e) => [...(e.dataTransfer?.files || [])].forEach(addFile));
  dropEl.addEventListener("paste", (e) => {
    for (const it of (e.clipboardData?.items || [])) {
      if (it.kind === "file" && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) addFile(f); }
    }
  });

  overlay.querySelector("#ed-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector("#ed-save").addEventListener("click", async () => {
    const company_name = overlay.querySelector("#ed-company").value.trim();
    const item_name = overlay.querySelector("#ed-item").value.trim();
    const product_type = overlay.querySelector("#ed-product").value;
    if (!company_name || !item_name || !product_type) {
      openConfirmModal("Missing fields", "Company, item name, and product type are required.", () => {});
      return;
    }
    const payload = {
      company_id: rec.company_id,
      company_name,
      member_id: rec.member_id,
      member_name: overlay.querySelector("#ed-member").value.trim() || null,
      item_name,
      product_type,
      height: overlay.querySelector("#ed-height").value || null,
      width: overlay.querySelector("#ed-width").value || null,
      raised_height: overlay.querySelector("#ed-raised").value || null,
      no_of_color: overlay.querySelector("#ed-nocolor").value || null,
      pantones: rec.pantones || [],
      image_names: editImages.map((i) => i.name),
    };
    const saveBtn = overlay.querySelector("#ed-save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await fetchJson(API + `/api/developments/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      overlay.remove();
      await renderDevelopmentView();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      openConfirmModal("Save failed", err.message, () => {});
    }
  });
}

function exportDevelopmentExcel(rows) {
  const headers = ["Company", "Member", "Item", "Product Type", "Created", "Updated", "Details", "Images"];
  const lines = [headers.join(",")];
  rows.forEach((r) => {
    const cells = [
      r.company_name, r.member_name || "", r.item_name, r.product_type,
      r.created_at, r.updated_at, devDetailsSummary(r),
      (r.image_names || []).join("; "),
    ].map(csvCell);
    lines.push(cells.join(","));
  });
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "developments.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Fetch a single company with its members (reuses /api/companies/<id>).
async function fetchAnchoredCompany(id) {
  return fetchJson(API + `/api/companies/${id}`);
}

// ---------------------------------------------------------------------------
// Customer / View
// ---------------------------------------------------------------------------

// View state
let viewCustomers = [];      // raw data from /api/customers
let viewFilters = {};         // {company, name, email, title, tel}
let viewSelected = new Set(); // selected keys: "c:<companyId>" or "m:<memberId>"

async function renderCustomerView() {
  panel.innerHTML = '<h2>Customer / View</h2><p class="empty">Loading…</p>';
  viewSelected.clear();
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
  // One flat row per member (company rows with no members get a single row too).
  const cols = [
    { key: "company", label: "Company Name" },
    { key: "name", label: "Member Name" },
    { key: "email", label: "Member Email" },
    { key: "title", label: "Title" },
    { key: "tel", label: "Tel" },
  ];

  const rows = [];
  viewCustomers.forEach((c) => {
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

  const shown = rows.filter((r) =>
    cols.every((c) => fuzzyMatch(r[c.key], viewFilters[c.key]))
  );

  // Batch delete works at the COMPANY level: each selected member row maps to
  // its company, and deleting the company removes it + all its members.
  const companyIds = [...new Set(shown.map((r) => r.companyId))];
  const allKeys = companyIds.map((id) => "c:" + id);
  const allChecked = allKeys.length > 0 && allKeys.every((k) => viewSelected.has(k));

  const searchRow = cols.map((c) =>
    `<th class="search-th">
       <input class="col-search" data-key="${c.key}" type="text"
              placeholder="Search ${c.label}…" value="${escapeHtml(viewFilters[c.key] || "")}" />
     </th>`
  ).join("") + `<th class="search-th actions-th"></th>`;

  const body = shown.map((r) => {
    const checked = viewSelected.has("c:" + r.companyId);
    const editBtn = r.memberId != null
      ? `<button class="icon-btn" data-edit="${r.companyId}" title="Edit">✎</button>
         <button class="icon-btn danger" data-del-company="${r.companyId}" title="Delete company">🗑</button>`
      : `<button class="icon-btn" data-edit="${r.companyId}" title="Edit company">✎</button>
         <button class="icon-btn danger" data-del-company="${r.companyId}" title="Delete company">🗑</button>`;
    return `
      <tr class="${checked ? "selected" : ""}">
        <td>
          <label class="cb-cell">
            <input type="checkbox" class="row-select" data-key="c:${r.companyId}" ${checked ? "checked" : ""} />
          </label>
        </td>
        <td>${escapeHtml(r.company)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td>${escapeHtml(r.title)}</td>
        <td>${escapeHtml(r.tel)}</td>
        <td class="row-actions">${editBtn}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="7" class="muted">No matches.</td></tr>`;

  panel.innerHTML = `
    <div class="view-head">
      <h2>Customer / View</h2>
      <div class="view-actions">
        <button class="btn ghost" id="export-xlsx" type="button">Export Excel</button>
      </div>
    </div>

    <div class="batch-bar" id="batch-bar">
      <label class="cb-cell">
        <input type="checkbox" id="select-all" ${allChecked ? "checked" : ""} />
        <span>Select all (${allKeys.length})</span>
      </label>
      <span class="muted batch-count" id="batch-count">${viewSelected.size} selected</span>
      <button class="btn danger" id="batch-delete" type="button" disabled>Delete selected</button>
    </div>

    <table class="grid" id="customer-grid">
      <thead>
        <tr class="head-row">
          <th></th>
          ${cols.map((c) => `<th>${c.label}</th>`).join("")}
          <th class="actions-th">Actions</th>
        </tr>
        <tr class="search-row"><th></th>${searchRow}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;

  // per-column fuzzy search
  panel.querySelectorAll(".col-search").forEach((inp) => {
    inp.addEventListener("input", () => {
      viewFilters[inp.dataset.key] = inp.value;
      const cursor = inp.selectionStart;
      paintView();
      const same = panel.querySelector(`.col-search[data-key="${inp.dataset.key}"]`);
      if (same) { same.focus(); same.setSelectionRange(cursor, cursor); }
    });
  });

  panel.querySelector("#export-xlsx").addEventListener("click", () => exportExcel(shown));

  // --- batch selection (company-level) ---
  const selectAll = panel.querySelector("#select-all");
  const batchDelete = panel.querySelector("#batch-delete");
  const batchCount = panel.querySelector("#batch-count");

  const syncBatchUI = () => {
    batchCount.textContent = viewSelected.size + " selected";
    batchDelete.disabled = viewSelected.size === 0;
    selectAll.checked = allKeys.length > 0 && allKeys.every((k) => viewSelected.has(k));
  };

  panel.querySelectorAll(".row-select").forEach((cb) => {
    cb.addEventListener("change", () => {
      const key = cb.dataset.key;
      const companyId = key.slice(2);
      if (cb.checked) viewSelected.add(key);
      else viewSelected.delete(key);
      // sync sibling rows of the same company
      panel.querySelectorAll(`.row-select[data-key="${key}"]`).forEach((sib) => {
        sib.checked = cb.checked;
        const tr = sib.closest("tr");
        if (tr) tr.classList.toggle("selected", cb.checked);
      });
      syncBatchUI();
    });
  });

  selectAll.addEventListener("change", () => {
    if (selectAll.checked) allKeys.forEach((k) => viewSelected.add(k));
    else allKeys.forEach((k) => viewSelected.delete(k));
    panel.querySelectorAll(".row-select").forEach((cb) => {
      cb.checked = selectAll.checked;
      const tr = cb.closest("tr");
      if (tr) tr.classList.toggle("selected", selectAll.checked);
    });
    syncBatchUI();
  });

  batchDelete.addEventListener("click", () => batchDeleteSelected());

  panel.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => openEditModal(Number(b.dataset.edit)));
  });
  panel.querySelectorAll("[data-del-company]").forEach((b) => {
    b.addEventListener("click", () => deleteCompany(Number(b.dataset.delCompany)));
  });
}

// helper: are all selectable company keys currently selected?

async function deleteCompany(companyId) {
  const company = viewCustomers.find((c) => c.id === companyId);
  const name = company ? company.name : ("#" + companyId);
  const count = company ? (company.members || []).length : 0;
  if (!confirm(`Delete company "${name}"${count ? ` and its ${count} member(s)` : ""}?`)) return;
  try {
    await fetchJson(API + `/api/companies/${companyId}`, { method: "DELETE" });
    viewSelected.delete("c:" + companyId);
    await renderCustomerView();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

// Unified batch delete: companies only (each company takes its members with it).
async function batchDeleteSelected() {
  const keys = [...viewSelected];
  if (!keys.length) return;
  const companyIds = keys.filter((k) => k.startsWith("c:")).map((k) => Number(k.slice(2)));
  const total = companyIds.length;
  if (!confirm(`Delete ${total} compan${total === 1 ? "y" : "ies"} and all their members?`)) return;
  const btn = panel.querySelector("#batch-delete");
  if (btn) { btn.disabled = true; btn.textContent = "Deleting…"; }
  let failed = 0;
  for (const id of companyIds) {
    try { await fetchJson(API + `/api/companies/${id}`, { method: "DELETE" }); }
    catch (err) { failed++; }
  }
  if (failed) alert(`${failed} deletion(s) failed.`);
  viewSelected.clear();
  await renderCustomerView();
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
  const headers = ["Company Name", "Member Name", "Member Email", "Title", "Tel"];
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

// ---------------------------------------------------------------------------
// Attachment helpers: upload + asset URL resolution (Part 4 files)
// ---------------------------------------------------------------------------

// Resolve a stored path -> a servable URL.
//   "uploads/..."  -> same-origin /uploads/...   (user-dropped image/doc bytes)
//   anything else  -> /sample-images/...          (legacy sample / Dummy image)
function assetUrl(name) {
  if (!name) return "";
  if (name.startsWith("uploads/")) return API + "/" + name;
  return API + "/sample-images/" + name;
}

// Strip the embedded "<uuid>__" prefix (and any path) so uploaded files show
// their original filename; sample paths show just the basename.
function displayName(name) {
  if (!name) return "";
  const base = name.indexOf("/") >= 0 ? name.split("/").pop() : name;
  return base.replace(/^[^_]*__/, "");
}

// Upload a single File to the server, returning { path, name, url }.
// Used for user-dropped images and ALL documents (replacing blob-URL storage).
async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(API + "/api/uploads", { method: "POST", body: form });
  if (!res.ok) throw new Error("upload failed: " + res.status);
  const data = await res.json();
  return data; // { path, name, url }
}

