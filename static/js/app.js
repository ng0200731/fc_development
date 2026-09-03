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
  "customer-edit":   "Customer / Edit",
  "development-create": "Development / Create",
  "development-view":   "Development / View",
  "development-edit":   "Development / Edit",
  "enquiry-create": "Enquiry / Create",
  "enquiry-view":   "Enquiry / View",
  "enquiry-edit":   "Enquiry / Edit",
  "setting-options": "Settings / Options",
};

// Selectable product types for the Development form.
const PRODUCT_TYPES = [
  "woven label",
  "printed label",
  "screen print label",
  "hang tag",
  "raised silicon label",
  "heat transfer label",
  "leather patch",
  "embroidery patch",
];

// Fabric options for the Material dropdown.
const FABRIC_OPTIONS = ["polyester", "nylon", "cotton"];

// Folding options for the Material dropdown (screen print label only).
const FOLDING_OPTIONS = ["loop fold", "end fold", "straight cut", "mitre fold", "Manhattan Fold", "Asymmetrical Fold"];

// --- Managed dropdown option sets (Settings / Options) ----------------------
// OPTION_GROUPS (the registry of which sets exist per level and their human
// labels) and OPTION_SETS (the live value cache) are BOTH populated by
// loadOptions() from the API, so they always agree with the server — including
// any group discovered by a Refresh scan and registered at runtime. The
// hardcoded arrays near the top of this file remain as seed/fallback defaults.

// level:name -> [ "value", ... ]  (ordered by position)
let OPTION_SETS = {};

// Mirror of the backend's _OPTION_GROUP_DEFS: which groups exist per level and
// their human labels. Rebuilt by loadOptions() from /api/options so the
// Settings UI and the Refresh scan always agree with the server.
let OPTION_GROUPS = {};

// The active form registers its image adder so Ctrl+V works even when the
// dropzone itself does not have focus. Text pasted into fields is left alone.
let activeImagePasteTarget = null;
document.addEventListener("paste", (e) => {
  // Look for an image in the clipboard first. Fields in these forms are plain
  // text (no inline images), so an image paste always goes to the image zone,
  // while a pure-text paste is left alone (even when a text field has focus).
  let imgHit = null;
  for (const item of (e.clipboardData?.items || [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) { imgHit = item; break; }
  }
  if (!imgHit) return;
  const target = activeImagePasteTarget;
  if (!target || !target.drop || !document.body.contains(target.drop)) return;
  // When focus is inside the dropzone itself, its own handler already dealt
  // with the paste — don't double-add.
  if (e.target && e.target.closest && e.target.closest(".dropzone")) return;
  const file = imgHit.getAsFile();
  if (file) { e.preventDefault(); target.add(file); }
});

// Fetch all managed option sets from the API into the cache. Also refreshes
// OPTION_GROUPS (the groups registry) so newly-registered groups show up.
async function loadOptions() {
  try {
    const data = await fetchJson(API + "/api/options");
    OPTION_SETS = {};
    OPTION_GROUPS = {};
    for (const level of Object.keys(data)) {
      OPTION_GROUPS[level] = [];
      for (const g of data[level]) {
        OPTION_SETS[level + ":" + g.name] = g.values.map((v) => v.value);
        OPTION_GROUPS[level].push({ name: g.name, label: g.label });
      }
    }
  } catch (e) {
    // Leave caches empty; forms fall back to the hardcoded arrays.
    console.warn("loadOptions failed:", e.message);
  }
}

// Load the product-type factory map (Development -> Fabric/Folding per product
// type) from the DB-backed API. Empty until the fetch completes; forms then
// fall back to PRODUCT_TYPE_FACTORY_SEED, then to the global Development lists.
async function loadProductTypeFactory() {
  try {
    const data = await fetchJson(API + "/api/product-type-factory");
    PRODUCT_TYPE_FACTORY = data || {};
    // Mirror each kind's input_type into PRODUCT_TYPE_FACTORY_TYPES so
    // listKindInputType() can fetch it without touching the options map.
    // Shape: { [product]: { [kind]: 'dropdown' | 'radio' | 'text' | 'textarea' } }
    PRODUCT_TYPE_FACTORY_TYPES = {};
    for (const product of Object.keys(PRODUCT_TYPE_FACTORY)) {
      const kinds = PRODUCT_TYPE_FACTORY[product] || {};
      PRODUCT_TYPE_FACTORY_TYPES[product] = {};
      for (const kind of Object.keys(kinds)) {
        const arr = kinds[kind];
        // Each option row carries the same input_type for a given kind; take
        // it from the first row and fall back to 'dropdown'.
        const t = (arr && arr.length && arr[0] && arr[0].input_type) || "dropdown";
        PRODUCT_TYPE_FACTORY_TYPES[product][kind] = t;
      }
    }
  } catch (e) {
    console.warn("loadProductTypeFactory failed:", e.message);
    PRODUCT_TYPE_FACTORY = {};
    PRODUCT_TYPE_FACTORY_TYPES = {};
  }
}

// Manually register a group in the frontend registry (e.g. after a scan finds a
// new dropdown and the API confirms it). Kept in sync with the backend so the
// Settings dropdowns switch to the new group immediately.
function registerOptionGroup(level, name, label) {
  const groups = (OPTION_GROUPS[level] = OPTION_GROUPS[level] || []);
  if (!groups.some((g) => g.name === name)) {
    groups.push({ name, label: label || name });
  }
}

// Return the option values for a (level, name) set, or [] if not loaded.
function opt(level, name) {
  return OPTION_SETS[level + ":" + name] || [];
}

// Map each folding option to its preview image (served under static/folding/).
// The filename is derived directly from the folding value ("<value>.png"), so
// any folding option added in Settings / Options that has a matching artwork
// file shows its preview automatically. If no file exists the preview simply
// hides itself (see foldingImage + onerror handlers below).
function foldingImage(value) {
  if (!value) return null;
  return "folding/" + encodeURIComponent(value) + ".png";
}
const FOLDING_IMAGES = {
  "loop fold": "folding/loop fold.png",
  "end fold": "folding/end fold.png",
  "straight cut": "folding/straight cut.png",
  "mitre fold": "folding/mitre fold.png",
  "Manhattan Fold": "folding/Manhattan Fold.png",
  "Asymmetrical Fold": "folding/Asymmetrical Fold.png",
};

// Build a short summary of a screen-print material spec for badges / view cells.
function materialSummary(mat) {
  if (!mat) return "";
  const parts = [];
  if (mat.recycle) parts.push(mat.recycle === "recycle" ? "recycle" : "non-recycle");
  if (mat.fabric) parts.push(mat.fabric);
  if (mat.edge) parts.push(mat.edge === "slit" ? "slit edge" : "woven edge");
  if (mat.folding) parts.push(mat.folding);
  // Any extra per-product-type lists stored under mat.lists.
  if (mat.lists && typeof mat.lists === "object") {
    for (const k of Object.keys(mat.lists)) {
      if (mat.lists[k]) parts.push(`${k}: ${mat.lists[k]}`);
    }
  }
  return parts.join(" · ");
}

// Build a short summary of the Special spec for badges / view cells.
function specialSummary(spec) {
  if (!spec) return "";
  if (spec.variable) return spec.variable === "variable" ? "variable" : "non variable";
  return "";
}

// Refresh the Material (part 4) badge + hint line and the Special (part 5) badge
// directly from devState. Uses document.querySelector so it works from any panel
// (only one dev panel is mounted at a time) and is independent of closure scope.
function refreshDevExtras() {
  const matBadge = document.querySelector("#dev-material-badge");
  const specBadge = document.querySelector("#dev-special-badge");

  if (matBadge) {
    const ms = materialSummary(devState.material);
    matBadge.textContent = ms ? ms : "TBA";
    matBadge.classList.toggle("filled", !!ms);
  }
  if (specBadge) {
    const ss = specialSummary(devState.special);
    specBadge.textContent = ss ? ss : "TBA";
    specBadge.classList.toggle("filled", !!ss);
  }
}

// Refresh the Colors (part 3) badge from devState — shows "N colors" once at
// least one Pantone code has been entered, otherwise "TBA". Split-color
// products (Front/Back) show the combined total across both sides.
// Re-render the Part 6 (Remark) list from devState.remake. Used by the
// product-type reset so any existing remarks are cleared from the DOM.
function refreshDevRemarks() {
  const listEl = document.querySelector("#dev-remake-list");
  if (!listEl) return;
  const remake = devState.remake || [];
  if (!remake.length) {
    listEl.innerHTML = `<li class="remake-empty muted small">No remarks yet.</li>`;
    return;
  }
  listEl.innerHTML = remake.map((note, i) => `
    <li class="remake-item">
      <span class="remake-text">${escapeHtml(note)}</span>
      <button type="button" class="icon-btn danger remake-rm" data-idx="${i}" title="Remove">✕</button>
    </li>`).join("");
  listEl.querySelectorAll(".remake-rm").forEach((b) => {
    b.addEventListener("click", () => {
      const i = Number(b.dataset.idx);
      if (i >= 0 && i < devState.remake.length) {
        devState.remake.splice(i, 1);
        refreshDevRemarks();
        if (typeof updateSaveState === "function") updateSaveState();
      }
    });
  });
}

// Refresh the Colors (part 3) badge from devState — shows "N colors" once at
// least one Pantone code has been entered, otherwise "TBA". Split-color
// products (Front/Back) show the combined total across both sides.
function refreshDevColorsBadge() {
  const badge = document.querySelector("#dev-colors-badge");
  if (!badge) return;
  const split = isSplitColorProduct(devState.product);
  let n = 0;
  let hasPantone = false;
  if (split && devState.colorSides) {
    for (const side of [devState.colorSides.front, devState.colorSides.back]) {
      if (!side) continue;
      const m = parseInt(side.noOfColor, 10);
      if (m > 0) n += m;
      if (Array.isArray(side.pantones) && side.pantones.some((p) => p && (p.value || "").trim())) hasPantone = true;
    }
  } else {
    n = devState.noOfColor ? Number(devState.noOfColor) : 0;
    hasPantone = Array.isArray(devState.pantones) && devState.pantones.some((p) => p && (p.value || "").trim());
  }
  if (n > 0 && hasPantone) {
    badge.textContent = `${n} color${n > 1 ? "s" : ""}`;
    badge.classList.add("filled");
  } else {
    badge.textContent = "TBA";
    badge.classList.remove("filled");
  }
}

// Reset Part 3 (Colors / Pantone), Part 4 (Material), Part 5 (Special) and
// Part 6 (Remark) back to blank. Used when the product type changes, because
// those sections are product-specific.
function resetProductParts() {
  devState.colorSides = null;
  devState.noOfColor = "";
  devState.pantones = [];
  devState.material = null;
  devState.special = null;
  devState.remake = [];
  // Reflect the cleared state in the DOM: badges back to TBA, remarks list empty.
  // Defer to next frame so the panel (and its badge/remark nodes) is mounted.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => { refreshDevColorsBadge(); refreshDevExtras(); refreshDevRemarks(); });
  } else {
    refreshDevColorsBadge(); refreshDevExtras(); refreshDevRemarks();
  }
}

// Pick the first valid fabric / folding for a product per PRODUCT_TYPE_FACTORY,
// falling back to the full development list. Used to seed sensible Material
// defaults when a product type is selected (and product-specific defaults are
// applied). Returns null when the product has no factory entry.
// Pick the first valid fabric / folding for a product per PRODUCT_TYPE_FACTORY,
// falling back to the full development list. Returns a plain string (the value),
// or null when the product has no factory entry. Used to seed sensible Material
// defaults when a product type is selected.
function firstFactoryFabric(product) {
  const f = (PRODUCT_TYPE_FACTORY && PRODUCT_TYPE_FACTORY[product]) || PRODUCT_TYPE_FACTORY_SEED[product];
  const list = (f && f.fabric && f.fabric.length) ? ptfStringList(f.fabric) : [];
  if (list.length) return list[0];
  const all = opt("development", "fabric");
  return all.length ? all[0] : null;
}
function firstFactoryFolding(product) {
  const f = (PRODUCT_TYPE_FACTORY && PRODUCT_TYPE_FACTORY[product]) || PRODUCT_TYPE_FACTORY_SEED[product];
  const list = (f && f.folding && f.folding.length) ? ptfStringList(f.folding) : [];
  if (list.length) return list[0];
  const all = opt("development", "folding");
  return all.length ? all[0] : null;
}

// For screen print label / printed label, seed Material + Special with dummy
// defaults so the green summary words appear immediately (no need to open the
// popup first). Other product types keep Material as TBA.
function seedScreenPrintDefaults() {
  // Screen print / printed label get fixed Material defaults (incl. the factory
  // fabric + folding for that product type). Other product types leave Material
  // as TBA unless they have a factory set, in which case we seed the first valid
  // fabric / folding so the popup opens pre-scoped.
  const product = devState.product;
  if (isScreenPrintProduct(product)) {
    if (!devState.material || typeof devState.material !== "object" || !devState.material.recycle) {
      devState.material = { recycle: "recycle", fabric: "polyester", edge: "slit", folding: "loop fold" };
    }
    if (!devState.special || typeof devState.special !== "object" || !devState.special.variable) {
      devState.special = { variable: "variable" };
    }
  } else if (hasProductTypeFactory(product)) {
    const fb = firstFactoryFabric(product);
    const ff = firstFactoryFolding(product);
    if (fb || ff) {
      devState.material = {
        recycle: null,
        fabric: fb || null,
        edge: null,
        folding: ff || null,
      };
    }
  }
  refreshDevExtras();
}

// True when any product-specific section (Parts 3–6) already holds data, so a
// product-type change would discard real work worth warning about.
function productPartsHaveData() {
  return !!(
    (devState.colorSides && (devState.colorSides.front || devState.colorSides.back)) ||
    devState.noOfColor || (devState.pantones && devState.pantones.length) ||
    devState.material || devState.special || (devState.remake && devState.remake.length)
  );
}

// Shared handler for the product-type <select> change. Changing the product
// resets Parts 3–6 and reminds the user (in-page modal, no native alert). If
// the user cancels, the select reverts to the previous product.
function onProductTypeChanged(prodEl) {
  const prevProduct = devState.product;
  const newProduct = prodEl.value;
  if (newProduct === prevProduct) return;

  const apply = () => {
    prodEl.value = newProduct;        // reflect the new choice in the dropdown
    devState.product = newProduct;
    // Reset Parts 3–6 to nothing. The user explicitly agreed to discard them, so
    // we do NOT re-seed any Material/Special defaults — everything stays blank
    // until the new product type is configured from scratch.
    resetProductParts();
    // `updateNextState`/`updateSaveState` are render-local closures (Create/Edit)
    // and are NOT in scope here — calling them would be a no-op. Re-run the
    // current render's gating via the module-level alias so Save re-evaluates
    // after the reset and goes inactive (Parts 3–6 are now empty).
    if (typeof devSaveStateFn === "function") devSaveStateFn();
  };

  // No data yet → just apply quietly.
  if (!productPartsHaveData()) { apply(); return; }

  // Revert the <select> so the visible value stays old until confirmed; the
  // confirm modal's cancel path then leaves it untouched.
  prodEl.value = prevProduct;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:440px">
      <h3>Product type changed</h3>
      <p class="muted">Changing the product type will reset these sections to empty:</p>
      <ul class="muted small" style="margin:6px 0 0 18px; line-height:1.7;">
        <li>Part 3 — Colors / Pantone</li>
        <li>Part 4 — Material</li>
        <li>Part 5 — Special</li>
        <li>Part 6 — Remark</li>
      </ul>
      <div class="actions modal-actions">
        <button class="btn ghost" id="pt-cancel" type="button">Cancel</button>
        <button class="btn primary" id="pt-ok" type="button">Reset &amp; continue</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#pt-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#pt-ok").addEventListener("click", () => { overlay.remove(); apply(); });
}



// Render one Pantone row for the Colors popup (editable) from a saved/blank
// pantone object. Mirrors the inline Create/Edit layout. `i` is the 0-based
// index, `onChange` is called with (i, value) after each keystroke.
function colorPantoneRowHtml(i, p, matched) {
  const val = p && p.value ? p.value : (matched && matched.code ? matched.code : "");
  return `
    <div class="pantone-row">
      <div class="field pantone-code">
        <label for="cp-pantone-${i}">Pantone #${i + 1}</label>
        <input id="cp-pantone-${i}" type="text" class="pantone-input"
               data-idx="${i}" value="${escapeHtml(val)}"
               placeholder="code (11-0103) or name (egret)" autocomplete="off" />
        <div class="pantone-match" id="cp-pantone-match-${i}">${colorMatchHtml(matched)}</div>
      </div>
    </div>`;
}

// Build the match status line for a Pantone value (swatch + code/name, or
// "No match"). Returns an HTML string (no surrounding row wrapper).
function colorMatchHtml(matched) {
  if (!matched) return `<span class="muted small">No match</span>`;
  return `<div class="pantone-top">` +
    `<span class="swatch" style="background:#${escapeHtml(matched.hex)}"></span>` +
    `<span class="muted small">${escapeHtml(matched.code)} · ${escapeHtml(matched.name)} · ` +
    `<span class="pantone-type" title="${escapeHtml(pantoneTypeName(matched.type))}">${escapeHtml(pantoneTypeName(matched.type))}</span> · #${escapeHtml(matched.hex)}</span>` +
    `</div>`;
}

// Resolve a single Pantone value to its best match (or null if none).
function matchSinglePantone(value) {
  const matches = findPantoneMatches(value || "");
  return matches.length ? matches[0] : null;
}

// Wire a Pantone text input with a fuzzy-suggestion dropdown. On every
// keystroke the matching catalog entries are listed below the field; clicking
// an entry fills the input and the underlying state via `setValue`. `get`/`set`
// are already index-bound accessors for this row's pantone object. `onChange`
// fires after any keystroke or selection.
function bindPantoneAutofill(input, matchEl, get, set, onChange) {
  const field = input.closest(".field") || input.parentElement;
  let dd = field.querySelector(".pantone-dd");
  if (!dd) {
    dd = document.createElement("div");
    dd.className = "pantone-dd";
    field.appendChild(dd);
  }
  const renderMatch = (value) => {
    if (!matchEl) return;
    matchEl.innerHTML = colorMatchHtml(value ? matchSinglePantone(value) : null);
  };
  const closeDd = () => { if (dd) { dd.innerHTML = ""; dd.style.display = "none"; } };
  // Show ALL fuzzy matches (the dropdown scrolls). A higher cap keeps even
  // short queries from truncating the suggestion list.
  const openDd = (matches) => {
    if (!dd || !matches.length) { closeDd(); return; }
    dd.innerHTML = matches.map((m, idx) =>
      `<div class="pantone-dd-item" data-code="${escapeHtml(m.code)}" data-name="${escapeHtml(m.name)}">` +
        `<span class="swatch sm" style="background:#${escapeHtml(m.hex)}"></span>` +
        `<span class="pantone-dd-code">${escapeHtml(m.code)}</span>` +
        `<span class="pantone-dd-name">${escapeHtml(m.name)}</span>` +
        `<span class="pantone-type" title="${escapeHtml(pantoneTypeName(m.type))}">${escapeHtml(pantoneTypeName(m.type))}</span>` +
      `</div>`).join("");
    dd.style.display = "block";
    dd.querySelectorAll(".pantone-dd-item").forEach((item) => {
      // Clicking anywhere on the row (swatch, code, name, type) fills the field.
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();   // keep focus / avoid blur race
        const code = item.dataset.code;
        input.value = code;
        set(code);
        renderMatch(code);
        closeDd();
        if (onChange) onChange();
      });
    });
  };
  input.addEventListener("input", () => {
    const v = input.value;
    set(v);
    renderMatch(v);
    openDd(findPantoneMatches(v, 999));
    if (onChange) onChange();
  });
  input.addEventListener("focus", () => {
    const v = input.value;
    // Empty field on focus => show the entire catalog so the user can browse
    // and click any Pantone to fill the input.
    if (!v.trim()) {
      if (pantoneData && pantoneData.length) openDd(pantoneData.slice(0, 999));
    } else {
      openDd(findPantoneMatches(v, 999));
    }
  });
  input.addEventListener("blur", () => { setTimeout(closeDd, 120); });
  renderMatch(get());
}

// Build a single editable color side (No. of color + Pantone rows) inside a
// container element. Returns nothing; wires its own inputs. `side` is the
// working { noOfColor, pantones } object; `onChange` fires after each edit.
function renderColorSide(container, side, onChange) {
  const sync = () => {
    const n = parseInt(side.noOfColor, 10);
    if (!isNaN(n) && n > 0) {
      while (side.pantones.length < n) side.pantones.push({ value: "", color: "#000000" });
      if (side.pantones.length > n) side.pantones.length = n;
    }
  };
  sync();

  container.innerHTML = `
    <div class="field">
      <label>No. of color</label>
      <input type="number" min="1" step="1" placeholder="0" autocomplete="off"
             class="cs-nocolor" value="${escapeHtml(side.noOfColor || "")}" />
    </div>
    <div class="cs-pantone-wrap"></div>`;

  const wrap = container.querySelector(".cs-pantone-wrap");
  const nc = container.querySelector(".cs-nocolor");

  const renderRows = () => {
    sync();
    if ((parseInt(side.noOfColor, 10) || 0) <= 0) {
      wrap.innerHTML = "";
      if (onChange) onChange();
      return;
    }
    wrap.innerHTML = side.pantones.map((p, i) => {
      const matched = p && p.value ? matchSinglePantone(p.value) : null;
      return colorPantoneRowHtml(i, p, matched);
    }).join("");

    wrap.querySelectorAll(".pantone-input").forEach((inp) => {
      const i = Number(inp.dataset.idx);
      if (!side.pantones[i]) return;
      const matchEl = wrap.querySelector("#cp-pantone-match-" + i);
      bindPantoneAutofill(
        inp,
        matchEl,
        () => side.pantones[i].value,
        (v) => { side.pantones[i].value = v; const m = v ? matchSinglePantone(v) : null; side.pantones[i].color = m ? "#" + m.hex : "#000000"; },
        () => { if (onChange) onChange(); }
      );
    });
    if (onChange) onChange();
  };

  nc.addEventListener("input", () => { side.noOfColor = nc.value; renderRows(); });
  renderRows();
}

// Open the editable "Colors / Pantone" popup (Material-like). When the active
// product type is split-color (Front/Back) the popup shows two side-by-side
// sets; otherwise a single set. `getState`/`setState` read/write devState;
// `onChange` re-runs Save/Update gating + badge.
async function openColorsPopup(getState, setState, onChange) {
  const state = getState();
  const split = isSplitColorProduct(state.product);
  await ensurePantoneData();

  // Deep-clone one color side from persisted state (or empty).
  const cloneColorSide = (s) => ({
    noOfColor: (s && s.noOfColor) || "",
    pantones: Array.isArray(s && s.pantones)
      ? s.pantones.map((p) => ({ value: (p && p.value) || "", color: (p && p.color) || "#000000" }))
      : [],
  });

  // Working copy so Cancel discards edits.
  const work = split
    ? {
        front: cloneColorSide(state.colorSides && state.colorSides.front),
        back: cloneColorSide(state.colorSides && state.colorSides.back),
      }
    : {
        noOfColor: state.noOfColor || "",
        pantones: (state.pantones || []).map((p) => ({ value: (p && p.value) || "", color: (p && p.color) || "#000000" })),
      };

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:${split ? "760px" : "480px"}">
      <h3>Colors / Pantone</h3>
      ${split ? `
      <div class="color-sides">
        <div class="color-side">
          <h4 class="subhead">Front</h4>
          <div class="cs-body" data-side="front"></div>
        </div>
        <div class="color-side">
          <h4 class="subhead">Back</h4>
          <div class="cs-body" data-side="back"></div>
        </div>
      </div>` : `
      <div class="field">
        <label for="cp-no-of-color">No. of color</label>
        <input id="cp-no-of-color" type="number" min="1" step="1" placeholder="0" autocomplete="off" value="${escapeHtml(work.noOfColor)}" />
      </div>
      <div id="cp-pantone-wrap"></div>`}
      <div class="actions modal-actions">
        <button class="btn ghost" id="cp-cancel" type="button">Cancel</button>
        <button class="btn primary" id="cp-save" type="button">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  if (split) {
    overlay.querySelector('[data-side="front"]')._side = work.front;
    overlay.querySelector('[data-side="back"]')._side = work.back;
    renderColorSide(overlay.querySelector('[data-side="front"]'), work.front, () => {});
    renderColorSide(overlay.querySelector('[data-side="back"]'), work.back, () => {});
  } else {
    const wrap = overlay.querySelector("#cp-pantone-wrap");
    const nc = overlay.querySelector("#cp-no-of-color");

    const renderRows = () => {
      const sync = () => {
        const n = parseInt(work.noOfColor, 10);
        if (!isNaN(n) && n > 0) {
          while (work.pantones.length < n) work.pantones.push({ value: "", color: "#000000" });
          if (work.pantones.length > n) work.pantones.length = n;
        }
      };
      sync();
      if ((parseInt(work.noOfColor, 10) || 0) <= 0) {
        wrap.innerHTML = "";
        return;
      }
      wrap.innerHTML = work.pantones.map((p, i) => {
        const matched = p && p.value ? matchSinglePantone(p.value) : null;
        return colorPantoneRowHtml(i, p, matched);
      }).join("");

      wrap.querySelectorAll(".pantone-input").forEach((inp) => {
        const i = Number(inp.dataset.idx);
        if (!work.pantones[i]) return;
        const matchEl = wrap.querySelector("#cp-pantone-match-" + i);
        bindPantoneAutofill(
          inp,
          matchEl,
          () => work.pantones[i].value,
          (v) => { work.pantones[i].value = v; const m = v ? matchSinglePantone(v) : null; work.pantones[i].color = m ? "#" + m.hex : "#000000"; },
          () => {}
        );
      });
    };

    nc.addEventListener("input", () => { work.noOfColor = nc.value; renderRows(); });
    renderRows();
  }

  overlay.querySelector("#cp-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#cp-save").addEventListener("click", () => {
    if (split) {
      setState({ colorSides: { front: work.front, back: work.back } });
    } else {
      setState({ noOfColor: work.noOfColor || "", pantones: work.pantones.map((p) => ({ value: (p.value || "").trim(), color: p.color })) });
    }
    refreshDevColorsBadge();
    if (typeof onChange === "function") onChange();
    overlay.remove();
  });
}

// Centered image lightbox. Opens a single image in a modal that only closes via
// the (✕) button — clicking the dark overlay does NOT dismiss it (matches the
// project rule that development popups only close on the explicit close button).
function openImageLightbox(url, name) {
  if (!url) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay image-lightbox";
  overlay.innerHTML = `
    <div class="image-lightbox-inner" role="dialog" aria-modal="true" aria-label="${escapeHtml(name || "Image preview")}">
      <button class="image-lightbox-close" type="button" title="Close" aria-label="Close">✕</button>
      <img class="image-lightbox-img" src="${escapeHtml(url)}" alt="${escapeHtml(name || "")}" />
      ${name ? `<div class="image-lightbox-caption">${escapeHtml(name)}</div>` : ""}
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".image-lightbox-close").addEventListener("click", () => overlay.remove());
  // Close on Escape for keyboard users (still NOT on outside click).
  const onKey = (e) => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
}

// Open a read-only "Colors / Pantone" popup from a saved Development/Enquiry
// record (used by the View screen's Details cell click). Split-color products
// (Front/Back) render two sections; others render the single No. of color +
// Pantone list from the saved record.
function openColorsViewPopup(rec) {
  const split = isSplitColorProduct(rec.product_type);
  const sides = rec.color_sides;
  ensurePantoneData();   // best-effort; matches show "No match" if data not yet loaded

  const sideHtml = (label, side) => {
    const n = side && side.noOfColor ? Number(side.noOfColor) : 0;
    const pantones = (side && Array.isArray(side.pantones)) ? side.pantones : [];
    return `
      <h4 class="subhead">${label}</h4>
      <div class="field">
        <label>No. of color</label>
        <div class="readonly-value">${n > 0 ? escapeHtml(String(n)) : "—"}</div>
      </div>
      ${n > 0 && pantones.length ? pantones.map((p, i) => {
        const matched = (p && p.value) ? matchSinglePantone(p.value) : null;
        return `
          <div class="pantone-row">
            <div class="field pantone-code">
              <label>Pantone #${i + 1}</label>
              <div class="readonly-value">${escapeHtml((p && p.value) || "—")}</div>
              <div class="pantone-match">${colorMatchHtml(matched)}</div>
            </div>
          </div>`;
      }).join("") : `<p class="muted small">No colors recorded.</p>`}`;
  };

  const singleHtml = () => {
    const n = rec.no_of_color ? Number(rec.no_of_color) : 0;
    const pantones = Array.isArray(rec.pantones) ? rec.pantones : [];
    return `
      <div class="field">
        <label>No. of color</label>
        <div class="readonly-value">${n > 0 ? escapeHtml(String(n)) : "—"}</div>
      </div>
      <div id="cpv-pantone-wrap">
        ${n > 0 && pantones.length ? pantones.map((p, i) => {
          const matched = (p && p.value) ? matchSinglePantone(p.value) : null;
          return `
            <div class="pantone-row">
              <div class="field pantone-code">
                <label>Pantone #${i + 1}</label>
                <div class="readonly-value">${escapeHtml((p && p.value) || "—")}</div>
                <div class="pantone-match">${colorMatchHtml(matched)}</div>
              </div>
            </div>`;
        }).join("") : `<p class="muted small">No colors recorded.</p>`}
      </div>`;
  };

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:${split ? "760px" : "480px"}">
      <h3>Colors / Pantone</h3>
      ${split
        ? `<div class="color-sides">
             <div class="color-side">${sideHtml("Front", sides && sides.front)}</div>
             <div class="color-side">${sideHtml("Back", sides && sides.back)}</div>
           </div>`
        : singleHtml()}
      <div class="actions modal-actions">
        <button class="btn primary" id="cpv-close" type="button">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#cpv-close").addEventListener("click", () => overlay.remove());
}

// "screen print label" and "printed label" share the full Material popup
// (recycle / fabric / edge / folding). A product type that has a per-type
// Fabric/Folding override in the Product type factory also opens the full
// Material popup (so its factory options are editable there). Everything else
// keeps the generic "TBA" material stub.
const isScreenPrintProduct = (p) => p === "screen print label" || p === "printed label";

// True when the product type has a Fabric or Folding override in the Product
// type factory (live map, then the seed fallback).
const hasProductTypeFactory = (p) => {
  const f = (PRODUCT_TYPE_FACTORY && PRODUCT_TYPE_FACTORY[p]) || PRODUCT_TYPE_FACTORY_SEED[p];
  return !!(f && ((f.fabric && f.fabric.length) || (f.folding && f.folding.length)));
};

// True when a product's Material form is defined entirely by its configured
// custom lists (non fabric/folding) — e.g. Jacron with only a "thickness"
// text field. Such products show ONLY their lists (no legacy Recycle / Fabric /
// Edge / Folding fields) in both the Create popup and the Edit panel.
const usesFactoryOnlyMaterial = (p) => {
  const lists = listsForProduct(p);
  return lists.some((k) => k !== "fabric" && k !== "folding") && !isScreenPrintProduct(p);
};
// All product types show the "No. of color" + Pantone-row layout (same as
// "raised silicon label"). "heat transfer label" behaves like "raised silicon
// label" for color but has no "Raised height" field — see needsRaisedHeight().
// (isColorLabelProduct is kept only for reference; the colour layout is now
// universal, so callers use needsRaisedHeight() directly instead.)
const isColorLabelProduct = () => true;

// Only "raised silicon label" additionally needs a "Raised height" field.
const needsRaisedHeight = (p) => p === "raised silicon label";

// Product types whose color popup is split into a Front side and a Back side,
// each with its own "No. of color" + Pantone rows. All other product types
// keep the single-set color layout (one No. of color + Pantone rows).
const SPLIT_COLOR_PRODUCTS = ["screen print label", "printed label", "hang tag"];
const isSplitColorProduct = (p) => SPLIT_COLOR_PRODUCTS.includes(p);

// ---------------------------------------------------------------------------
// Product type "factory": defines which fabric / folding options are valid for
// each product type. Development / Create's Material popup filters its Fabric and
// Folding <select>s by the currently-selected product type using this map. Only
// product types listed here get a narrowed set; everything else falls back to the
// full development fabric / folding lists (from Settings / Options).
//
// Example: "screen print label" and "printed label" each have their own unique
// fabric + folding combo, so choosing one restricts the Material dropdowns to
// just those values.
// ---------------------------------------------------------------------------
// Live, DB-backed product-type factory map. Loaded from /api/product-type-factory
// by loadProductTypeFactory(); the const below is only the seed/fallback used
// before the first fetch. Shape: { "<product_type>": { fabric:[...], folding:[...] } }.
const PRODUCT_TYPE_FACTORY_SEED = {
  "screen print label": {
    fabric: ["polyester", "nylon"],
    folding: ["loop fold", "end fold", "straight cut"],
  },
  "printed label": {
    fabric: ["cotton"],
    folding: ["mitre fold", "Manhattan Fold"],
  },
};
let PRODUCT_TYPE_FACTORY = {};

// Per-kind input-type for each product type's PTF lists. Populated from
// /api/product-type-factory alongside PRODUCT_TYPE_FACTORY. Used by
// `listKindInputType` below so the Material popup can render dropdown / radio /
// text / textarea fields per the kind's configured type. Defaults to
// 'dropdown' (the legacy behavior) for any kind that has no entry here.
let PRODUCT_TYPE_FACTORY_TYPES = {};

// The live DB map (PRODUCT_TYPE_FACTORY, from loadProductTypeFactory) stores
// each kind as [{id, value}], while PRODUCT_TYPE_FACTORY_SEED stores plain
// strings. Normalize either shape to an array of strings for the dropdowns.
function ptfStringList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => (typeof x === "string" ? x : (x && x.value) || "")).filter(Boolean);
}

// Ordered list of the list-names that apply to a product type. Uses the live
// PTF map when the product has any factory lists, otherwise the global
// Development list names (defaulting to fabric/folding). Excludes the
// "__placeholder__" empty-list marker.
// Ordered list of list-names for a product type. Only Fabric/Folding (and any
// user-added lists stored in PRODUCT_TYPE_FACTORY) are factory lists; global
// development options like product_type / recycle / edge are never included.
function listsForProduct(product) {
  const f = PRODUCT_TYPE_FACTORY && PRODUCT_TYPE_FACTORY[product];
  if (f === undefined) return ["fabric", "folding"];
  const names = Object.keys(f);
  // Exclude the internal placeholder-only marker; if a list has only a
  // placeholder it's treated as empty and falls back at the option level.
  return names;
}

// The configured input type for a list kind, or 'dropdown' if unset / unknown.
// Drives how the Material popup renders that kind's field:
//   dropdown → <select>           radio → <input type="radio"> group
//   text     → <input type="text">  textarea → <textarea>
function listKindInputType(product, kind) {
  const map = PRODUCT_TYPE_FACTORY_TYPES && PRODUCT_TYPE_FACTORY_TYPES[product];
  const t = map && map[kind];
  if (t === "radio" || t === "text" || t === "textarea") return t;
  return "dropdown";
}

// Options valid for an arbitrary list name of a product type, with fallback to
// the global Development list of the same name. `current` (already-chosen value)
// is prepended if it isn't in the set so a saved selection stays visible.
function listOptionsFor(product, kind, current) {
  const f = (PRODUCT_TYPE_FACTORY && PRODUCT_TYPE_FACTORY[product]) || {};
  const raw = (f[kind] || []).filter((v) => v.value !== "__placeholder__");
  const list = raw.length
    ? ptfStringList(raw)
    : opt("development", kind).slice();
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

// Fabric options valid for a given product type. `current` (optional) is the
// value already chosen — if it isn't in the factory set (e.g. an older record)
// it's prepended so the saved selection stays visible. Resolution order:
//   1. live PTF map (DB-backed, loaded by loadProductTypeFactory)
//   2. PRODUCT_TYPE_FACTORY_SEED fallback
//   3. global Development -> Fabric list (from Settings / Options)
// An explicitly-empty factory list (a product type with a row but no values for
// that kind) counts as "no override" and falls back to the global list.
function fabricOptionsFor(product, current) {
  const f = (PRODUCT_TYPE_FACTORY && PRODUCT_TYPE_FACTORY[product]) || PRODUCT_TYPE_FACTORY_SEED[product];
  const list = (f && Array.isArray(f.fabric) && f.fabric.length)
    ? ptfStringList(f.fabric)
    : opt("development", "fabric").slice();
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

// Folding options valid for a given product type — same contract as above.
function foldingOptionsFor(product, current) {
  const f = (PRODUCT_TYPE_FACTORY && PRODUCT_TYPE_FACTORY[product]) || PRODUCT_TYPE_FACTORY_SEED[product];
  const list = (f && Array.isArray(f.folding) && f.folding.length)
    ? ptfStringList(f.folding)
    : opt("development", "folding").slice();
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

// For a split color spec (Front + Back) the gating rule is: the TOTAL number of
// colors across both sides must be > 1 (i.e. at least 2), and every Pantone row
// that has been entered must carry a non-trivial code (length > 1). We do NOT
// require both sides to individually have colors — a single side with 2+ colors
// (or 1 color on each side) is enough. This matches the badge, which already
// sums both sides ("2 colors"), and matches the user's expectation that a
// "printed label" with 2 colors is valid without forcing a Back side.
const splitColorsValid = (sides) => {
  if (!sides) return false;
  let total = 0;
  let allEnteredValid = true;
  for (const side of [sides.front, sides.back]) {
    if (!side) continue;
    const n = parseInt(side.noOfColor, 10);
    if (n > 0) total += n;
    for (const p of (side.pantones || [])) {
      const v = (p && (p.value || "") || "").trim().length;
      // An entered stub (exactly 1 char) is invalid; empty rows are allowed.
      if (v > 0 && v <= 1) allEnteredValid = false;
    }
  }
  return total >= 1 && allEnteredValid;   // at least 1 color total
};

// Parse the `color_sides` signature string (from a saved record) back into the
// { front:{noOfColor,pantones}, back:{noOfColor,pantones} } object shape.
const parseColorSidesString = (sig) => {
  if (!sig || typeof sig !== "string") return null;
  const out = { front: { noOfColor: "", pantones: [] }, back: { noOfColor: "", pantones: [] } };
  const parts = sig.split(";");
  for (const part of parts) {
    const m = part.match(/^([FB]):(.*)$/);
    if (!m) continue;
    const side = m[1] === "F" ? out.front : out.back;
    const body = m[2];
    const idx = body.indexOf("|");
    if (idx === -1) { side.noOfColor = body; continue; }
    side.noOfColor = body.slice(0, idx);
    const codes = body.slice(idx + 1).split(",");
    side.pantones = codes.map((c) => ({ value: c, color: c ? "#000000" : "" }));
  }
  return out;
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
    // Opening Development / Create from the sidebar starts a FRESH, blank
    // create on the Create tab. The red "edit" mini-tab is a SEPARATE tab
    // that keeps its own session (devEditMode / devEditState) untouched — so
    // the red tab stays exactly as it was, and Create is a brand-new draft.
    if (item.dataset.target === "development-create") {
      resetDevState();   // clear only the Create draft, leave the edit alone
    }
    if (item.dataset.target === "enquiry-create") {
      resetEnquiryState();   // clear the Enquiry draft for a fresh create
    }
    // Only the Customer edit session (its own tab) is cleared here.
    custEditMode = false;
    custEditId = null;
    custOriginal = null;
    openTab(item.dataset.target);
  });
});

function openTab(target) {
  // A Development edit session is parked on its own "development-edit" mini-tab
  // (devEditMode stays on so its state/tab survive a re-open of Create/View).
  // The Customer edit session has its own tab and is cleared anywhere else.
  if (target !== "customer-edit") { custEditMode = false; custEditId = null; custOriginal = null; }
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
  // Closing the red "edit" mini-tab ends the edit session; the Create tab is
  // independent and is NOT affected. (Closing Create does not touch the edit.)
  if (target === "development-edit") {
    devEditMode = false;
    devEditId = null;
    devOriginal = null;
    Object.assign(devEditState, blankDevState());
  }
  if (target === "enquiry-edit") {
    enquiryEditMode = false;
    enquiryEditId = null;
    enquiryOriginal = null;
    Object.assign(enquiryEditState, blankEnquiryState());
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
  const editingDev = (target === "development-edit" && devEditMode);
  const editingCust = (target === "customer-edit" && custEditMode);
  const editingEnq = (target === "enquiry-edit" && enquiryEditMode);
  label.textContent = editingDev ? "edit" : editingCust ? "customer edit" : editingEnq ? "edit" : (labels[target] || target);
  tab.appendChild(label);
  if (editingDev || editingCust || editingEnq) tab.classList.add("edit-mode");

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
  if (activeTarget === "customer-edit") {
    await renderCustomerEdit();
    return;
  }
  if (activeTarget === "development-create") {
    await renderDevelopmentCreate();
    return;
  }
  if (activeTarget === "development-edit") {
    await renderDevelopmentEdit();
    return;
  }
  if (activeTarget === "development-view") {
    await renderDevelopmentView();
    return;
  }
  if (activeTarget === "enquiry-create") {
    renderEnquiryCreate();
    return;
  }
  if (activeTarget === "enquiry-view") {
    await renderEnquiryView();
    return;
  }
  if (activeTarget === "enquiry-edit") {
    await renderEnquiryEdit();
    return;
  }
  if (activeTarget === "setting-options") {
    await renderSettingsOptions();
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
// Settings / Options — manage the dropdown option lists (DB-backed, shared per
// level). Pick a level, pick which dropdown, then add / rename / delete /
// reorder the option values. All changes persist and feed back into forms.
// ---------------------------------------------------------------------------

async function renderSettingsOptions() {
  // Make sure the cache + group registry are current before we build the UI.
  await loadOptions();

  const groupDefs = OPTION_GROUPS;
  const levels = Object.keys(groupDefs);
  const levelOpts = levels
    .map((l) => `<option value="${l}">${escapeHtml(l[0].toUpperCase() + l.slice(1))}</option>`)
    .join("");

  panel.innerHTML = `
    <h2>Settings / Options</h2>
    <p class="muted small">Manage the dropdown lists used in the forms. Changes are saved to the database and apply to all Create/View screens.</p>

    <div class="opt-card">
      <h3 class="subhead">Manage a dropdown</h3>
      <div class="opt-controls">
        <div class="field">
          <label for="opt-level">Level</label>
          <select id="opt-level">${levelOpts}</select>
        </div>
        <div class="field">
          <label for="opt-dropdown">Dropdown</label>
          <select id="opt-dropdown"></select>
        </div>
      </div>
      <div class="opt-add-row">
        <input id="opt-new" type="text" placeholder="New option value" autocomplete="off" />
        <button class="btn primary" id="opt-add" type="button">Add</button>
      </div>
      <div id="opt-msg" class="opt-msg"></div>
      <ul class="opt-list" id="opt-list"></ul>
    </div>

    <div class="opt-card">
      <h3 class="subhead">Scan forms for dropdowns</h3>
      <p class="muted small">Scans every Create / Edit / View form for <code>opt(level, name)</code> dropdowns. Any dropdown the forms use but that is not yet managed is listed below with an "Add" button.</p>
      <div class="opt-scan-controls">
        <button class="btn" id="opt-scan" type="button">↻ Refresh — scan all levels</button>
        <div class="field">
          <label for="opt-scan-level">Level</label>
          <select id="opt-scan-level">
            <option value="">All levels</option>
            ${levels.map((l) => `<option value="${l}">${escapeHtml(l[0].toUpperCase() + l.slice(1))}</option>`).join("")}
          </select>
        </div>
        <div class="field opt-scan-search">
          <label for="opt-scan-search-input">Search</label>
          <input id="opt-scan-search-input" type="text" placeholder="Filter dropdowns…" autocomplete="off" />
        </div>
      </div>
      <div id="opt-scan-msg" class="opt-msg"></div>
      <table class="opt-scan-table">
        <thead>
          <tr><th>Level</th><th>Dropdown</th><th>Status</th><th></th></tr>
        </thead>
        <tbody id="opt-scan-body"></tbody>
      </table>
    </div>

    <div class="opt-card">
      <h3 class="subhead">Product type factory (Development)</h3>
      <p class="muted small">Override the dropdown lists <em>per product type</em>. Each product type starts <strong>empty</strong> — add the named lists you need (e.g. Fabric, Folding, Thickness, Finish). Each list can hold its own options (or be a free-text / textarea field). Product types with no override fall back to the global Development lists.</p>
      <div class="opt-controls">
        <div class="field">
          <label for="ptf-product">Product type</label>
          <select id="ptf-product"></select>
        </div>
      </div>
      <div class="ptf-lists" id="ptf-lists"><!-- list blocks injected here --></div>
      <div class="ptf-add-list-row">
        <input type="text" id="ptf-new-list" placeholder="New list name (e.g. Material, Finish, GSM)" autocomplete="off" />
        <button class="btn primary" type="button" id="ptf-add-list">Add list</button>
      </div>
    </div>
  `;

  const levelEl = panel.querySelector("#opt-level");
  const dropdownEl = panel.querySelector("#opt-dropdown");
  const newEl = panel.querySelector("#opt-new");
  const addBtn = panel.querySelector("#opt-add");
  const msgEl = panel.querySelector("#opt-msg");
  const listEl = panel.querySelector("#opt-list");

  const scanBtn = panel.querySelector("#opt-scan");
  const scanLevelEl = panel.querySelector("#opt-scan-level");
  const scanSearchEl = panel.querySelector("#opt-scan-search-input");
  const scanMsgEl = panel.querySelector("#opt-scan-msg");
  const scanBody = panel.querySelector("#opt-scan-body");

  // The most recent scan result, retained so the level filter / search can
  // re-render without re-fetching the source file.
  let scanItems = [];

  function showMsg(text, isErr) {
    msgEl.textContent = text || "";
    msgEl.classList.toggle("err", !!isErr);
    msgEl.classList.toggle("ok", !isErr && !!text);
  }

  function groupsFor(level) {
    return OPTION_GROUPS[level] || [];
  }

  function fillDropdowns(level) {
    dropdownEl.innerHTML = groupsFor(level)
      .map((g) => `<option value="${escapeHtml(g.name)}">${escapeHtml(g.label)}</option>`)
      .join("");
  }

  function renderList(level, name) {
    const values = opt(level, name);
    if (!values.length) {
      listEl.innerHTML = `<li class="opt-empty muted small">No options yet — add one above.</li>`;
      return;
    }
    listEl.innerHTML = values
      .map((v, i) => `
        <li class="opt-item" data-value="${escapeHtml(v)}" data-idx="${i}">
          <button class="icon-btn opt-up" data-idx="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>▲</button>
          <button class="icon-btn opt-down" data-idx="${i}" title="Move down" ${i === values.length - 1 ? "disabled" : ""}>▼</button>
          <span class="opt-value" data-idx="${i}" title="Click to rename">${escapeHtml(v)}</span>
          <button class="icon-btn danger opt-del" data-idx="${i}" title="Delete">✕</button>
        </li>`).join("");

    listEl.querySelectorAll(".opt-up").forEach((b) =>
      b.addEventListener("click", () => moveItem(level, name, Number(b.dataset.idx), -1)));
    listEl.querySelectorAll(".opt-down").forEach((b) =>
      b.addEventListener("click", () => moveItem(level, name, Number(b.dataset.idx), +1)));
    listEl.querySelectorAll(".opt-del").forEach((b) =>
      b.addEventListener("click", () => deleteItem(level, name, Number(b.dataset.idx))));
    listEl.querySelectorAll(".opt-value").forEach((s) =>
      s.addEventListener("click", () => startRename(level, name, Number(s.dataset.idx), s)));
  }

  async function moveItem(level, name, idx, dir) {
    const values = opt(level, name).slice();
    const j = idx + dir;
    if (j < 0 || j >= values.length) return;
    [values[idx], values[j]] = [values[j], values[idx]];
    try {
      await fetchJson(API + "/api/options/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, name, orderedValues: values }),
      });
      await loadOptions();
      renderList(level, name);
    } catch (e) {
      showMsg("Reorder failed: " + e.message, true);
    }
  }

  async function deleteItem(level, name, idx) {
    const values = opt(level, name);
    const value = values[idx];
    try {
      const data = await fetchJson(API + "/api/options");
      let oid = null;
      for (const lvl of Object.keys(data)) {
        for (const g of data[lvl]) {
          for (const v of g.values) {
            if (lvl === level && g.name === name && v.value === value) oid = v.id;
          }
        }
      }
      if (oid == null) { showMsg("Option not found.", true); return; }
      await fetchJson(API + "/api/options/" + oid, { method: "DELETE" });
      await loadOptions();
      renderList(level, name);
      showMsg("Deleted.");
    } catch (e) {
      showMsg("Delete failed: " + e.message, true);
    }
  }

  function startRename(level, name, idx, spanEl) {
    const values = opt(level, name);
    const oldVal = values[idx];
    const input = document.createElement("input");
    input.type = "text";
    input.className = "opt-rename-input";
    input.value = oldVal;
    spanEl.replaceWith(input);
    input.focus();
    input.select();
    function commit() {
      const newVal = input.value.trim();
      if (newVal && newVal !== oldVal) renameItem(level, name, oldVal, newVal);
      else renderList(level, name);
    }
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { input.blur(); }
      else if (e.key === "Escape") { renderList(level, name); }
    });
  }

  async function renameItem(level, name, oldVal, newVal) {
    try {
      const data = await fetchJson(API + "/api/options");
      let oid = null;
      for (const lvl of Object.keys(data)) {
        for (const g of data[lvl]) {
          for (const v of g.values) {
            if (lvl === level && g.name === name && v.value === oldVal) oid = v.id;
          }
        }
      }
      if (oid == null) { showMsg("Option not found.", true); return; }
      await fetchJson(API + "/api/options/" + oid, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newVal }),
      });
      await loadOptions();
      renderList(level, name);
      showMsg("Renamed.");
    } catch (e) {
      showMsg("Rename failed: " + (e.message || "value may already exist"), true);
      renderList(level, name);
    }
  }

  async function addItem(level, name, value) {
    try {
      await fetchJson(API + "/api/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, name, value }),
      });
      await loadOptions();
      renderList(level, name);
      newEl.value = "";
      showMsg("Added.");
    } catch (e) {
      showMsg("Add failed: " + (e.message || "value may already exist"), true);
    }
  }

  function onLevelChange() {
    const level = levelEl.value;
    fillDropdowns(level);
    renderList(level, dropdownEl.value);
  }

  levelEl.addEventListener("change", onLevelChange);
  dropdownEl.addEventListener("change", () => renderList(levelEl.value, dropdownEl.value));
  addBtn.addEventListener("click", () => {
    const value = newEl.value.trim();
    if (!value) { showMsg("Enter a value first.", true); return; }
    addItem(levelEl.value, dropdownEl.value, value);
  });
  newEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addBtn.click();
  });

  // --- Scan: discover every dropdown the forms actually render ----------------

  // Humanise an opt() name like "product_type" -> "Product type".
  function humanize(name) {
    return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Parse the actual app.js source for OPTION call sites. This is a genuine scan
  // of the live form code — it reflects what the forms render, not a hardcoded
  // mirror, so it can never drift into inventing dropdowns.
  async function discoverFormDropdowns() {
    const src = await (await fetch("js/app.js", { cache: "no-store" })).text();
    const re = /opt\(\s*["']([a-z]+)["']\s*,\s*["']([a-z0-9_]+)["']\s*\)/g;
    const found = new Map(); // "level:name" -> {level, name}
    let m;
    while ((m = re.exec(src)) !== null) {
      const level = m[1];
      const name = m[2];
      found.set(level + ":" + name, { level, name });
    }
    return [...found.values()];
  }

  function renderScan() {
    const lvlFilter = (scanLevelEl.value || "").toLowerCase();
    const q = (scanSearchEl.value || "").trim().toLowerCase();
    const rows = scanItems.filter((it) => {
      if (lvlFilter && it.level !== lvlFilter) return false;
      if (q) {
        const hay = (it.level + " " + it.name + " " + humanize(it.name)).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (!scanItems.length) {
      scanBody.innerHTML = `<tr><td colspan="4" class="opt-empty muted small">Click "Refresh — scan all levels" to discover the dropdowns used by the forms.</td></tr>`;
      return;
    }
    if (!rows.length) {
      scanBody.innerHTML = `<tr><td colspan="4" class="opt-empty muted small">No dropdowns match the current filter.</td></tr>`;
      return;
    }

    scanBody.innerHTML = rows
      .map((it) => {
        const label = humanize(it.name);
        if (it.managed) {
          return `<tr data-level="${escapeHtml(it.level)}" data-name="${escapeHtml(it.name)}">
            <td><span class="opt-lvl">${escapeHtml(it.level)}</span></td>
            <td>${escapeHtml(label)} <span class="muted small">(${escapeHtml(it.name)})</span></td>
            <td><span class="opt-tag ok">managed</span></td>
            <td></td>
          </tr>`;
        }
        return `<tr data-level="${escapeHtml(it.level)}" data-name="${escapeHtml(it.name)}">
          <td><span class="opt-lvl">${escapeHtml(it.level)}</span></td>
          <td>${escapeHtml(label)} <span class="muted small">(${escapeHtml(it.name)})</span></td>
          <td><span class="opt-tag new">new</span></td>
          <td><button class="btn small opt-add-group" type="button" data-level="${escapeHtml(it.level)}" data-name="${escapeHtml(it.name)}">Add</button></td>
        </tr>`;
      })
      .join("");

    scanBody.querySelectorAll(".opt-add-group").forEach((b) =>
      b.addEventListener("click", () => registerFound(b.dataset.level, b.dataset.name)));
  }

  async function registerFound(level, name) {
    try {
      await fetchJson(API + "/api/options/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, name, label: humanize(name) }),
      });
      registerOptionGroup(level, name, humanize(name));
      await loadOptions();
      fillDropdowns(levelEl.value);
      scanMsgEl.textContent = `Added ${humanize(name)} (${level}) to managed dropdowns.`;
      scanMsgEl.classList.remove("err");
      scanMsgEl.classList.add("ok");
      await runScan();
    } catch (e) {
      scanMsgEl.textContent = "Add failed: " + e.message;
      scanMsgEl.classList.add("err");
      scanMsgEl.classList.remove("ok");
    }
  }

  async function runScan() {
    scanMsgEl.textContent = "Scanning forms…";
    scanMsgEl.classList.remove("err", "ok");
    try {
      const [forms, managed] = await Promise.all([
        discoverFormDropdowns(),
        fetchJson(API + "/api/options/groups"),
      ]);
      const managedKeys = new Set(managed.map((g) => g.level + ":" + g.name));
      scanItems = forms.map((f) => ({
        level: f.level,
        name: f.name,
        managed: managedKeys.has(f.level + ":" + f.name),
      }));
      scanItems.sort((a, b) => (a.level + a.name).localeCompare(b.level + b.name));
      const newCount = scanItems.filter((i) => !i.managed).length;
      renderScan();
      scanMsgEl.textContent = newCount
        ? `Scan complete — ${scanItems.length} dropdown(s) found, ${newCount} new.`
        : `Scan complete — ${scanItems.length} dropdown(s) found, all managed.`;
      scanMsgEl.classList.add("ok");
      scanMsgEl.classList.remove("err");
    } catch (e) {
      scanMsgEl.textContent = "Scan failed: " + e.message;
      scanMsgEl.classList.add("err");
      scanMsgEl.classList.remove("ok");
    }
  }

  scanBtn.addEventListener("click", runScan);
  scanLevelEl.addEventListener("change", renderScan);
  scanSearchEl.addEventListener("input", renderScan);

  fillDropdowns(levelEl.value);
  renderList(levelEl.value, dropdownEl.value);
  renderScan();

  // --- Product type factory: per-type Fabric/Folding overrides ----------------
  const ptfProductEl = panel.querySelector("#ptf-product");
  const ptfProductTypes = opt("development", "product_type");
  ptfProductEl.innerHTML = ptfProductTypes
    .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
    .join("");

  // Message helper scoped to a kind. Falls back to the panel's first message
  // slot when called with an empty kind (e.g. Add-list called with no name
  // typed) so the user still sees the warning instead of a silent crash.
  function ptfShowMsg(kind, text, isErr) {
    const sel = kind
      ? `[data-ptf-msg="${cssEscape(kind)}"]`
      : `[data-ptf-msg]:first-of-type`;
    const el = panel.querySelector(sel);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("err", !!isErr);
    el.classList.toggle("ok", !isErr && !!text);
  }

  // Resolve the live PTF map for a product + kind as an array of {id,value}.
  // A list row carrying the placeholder value means "empty list" — normalize
  // it to an empty array so the UI shows the fallback hint instead.
  function ptfValues(product, kind) {
    const f = (PRODUCT_TYPE_FACTORY && PRODUCT_TYPE_FACTORY[product]) || {};
    const vals = (f[kind] || []).slice();
    return vals.filter((v) => v.value !== "__placeholder__");
  }

  // The ordered list of list-names for a product type (factory kinds if any,
  // otherwise the default fabric/folding pair). Only Fabric/Folding (and
  // user-added lists) are managed per product type — global development options
  // like product_type / recycle / edge are NOT factory lists and must never
  // appear here as deletable blocks.
  function ptfListNames(product) {
    const f = PRODUCT_TYPE_FACTORY && PRODUCT_TYPE_FACTORY[product];
    // Only fall back to Fabric/Folding when the product type is entirely
    // absent from the factory map. Once a product type has been seeded (even
    // with an empty {} object), its real list names drive rendering — so
    // deleting the last list leaves it empty instead of resurrecting Fabric/Folding.
    // An uninitialized product has no override blocks. Fabric and Folding
    // still fall back to global options in the Material popup, but they must
    // not appear here as editable factory lists until the user adds them.
    if (f === undefined) return [];
    return Object.keys(f);
  }

  // Render the whole set of list blocks for the currently-selected product.
  function ptfRenderAll() {
    const product = ptfProductEl.value;
    const container = panel.querySelector("#ptf-lists");
    const names = ptfListNames(product);
    container.innerHTML = names.map((kind, li) => {
      const curType = listKindInputType(product, kind);
      const showAddRow = curType === "dropdown" || curType === "radio";
      return `
      <div class="ptf-kind" data-kind="${escapeHtml(kind)}">
        <div class="ptf-kind-head">
          <button class="icon-btn opt-up" data-list-idx="${li}" title="Move list up" ${li === 0 ? "disabled" : ""}>▲</button>
          <button class="icon-btn opt-down" data-list-idx="${li}" title="Move list down" ${li === names.length - 1 ? "disabled" : ""}>▼</button>
          <span class="ptf-kind-name" data-list-name="${escapeHtml(kind)}" title="Click to rename list">${escapeHtml(kind)}</span>
          <label class="ptf-type-label" for="ptf-type-${cssEscape(kind)}">type</label>
          <select class="ptf-type-select" id="ptf-type-${cssEscape(kind)}" data-list-type="${escapeHtml(kind)}" title="Input type used in Material popup">
            <option value="dropdown" ${curType === "dropdown" ? "selected" : ""}>dropdown</option>
            <option value="radio" ${curType === "radio" ? "selected" : ""}>radio</option>
            <option value="text" ${curType === "text" ? "selected" : ""}>text</option>
            <option value="textarea" ${curType === "textarea" ? "selected" : ""}>textarea</option>
          </select>
          <button class="icon-btn danger ptf-del-list" data-list-name="${escapeHtml(kind)}" title="Delete list">✕</button>
        </div>
        ${showAddRow ? `
        <div class="opt-add-row">
          <input type="text" placeholder="New ${escapeHtml(kind)} option" autocomplete="off" data-ptf-new="${escapeHtml(kind)}" />
          <button class="btn primary" type="button" data-ptf-add="${escapeHtml(kind)}">Add</button>
        </div>` : `
        <p class="hint ptf-type-note">Free input — type "${escapeHtml(curType)}" in Settings doesn't use options.</p>`}
        <div class="opt-msg" data-ptf-msg="${escapeHtml(kind)}"></div>
        <p class="hint opt-factory-hint" data-ptf-hint="${escapeHtml(kind)}"></p>
        <ul class="opt-list" data-ptf-list="${escapeHtml(kind)}"></ul>
      </div>`;
    }).join("");
    names.forEach((kind) => ptfRenderList(kind));

    // Per-list Add buttons + Enter-to-add.
    container.querySelectorAll("[data-ptf-add]").forEach((b) =>
      b.addEventListener("click", () => ptfAddItem(b.dataset.ptfAdd)));
    container.querySelectorAll("[data-ptf-new]").forEach((i) =>
      i.addEventListener("keydown", (e) => { if (e.key === "Enter") ptfAddItem(i.dataset.ptfNew); }));
    // List reorder (▲▼ on the list header).
    container.querySelectorAll("[data-list-idx]").forEach((b) =>
      b.addEventListener("click", () => ptfMoveList(Number(b.dataset.listIdx), b.classList.contains("opt-up") ? -1 : +1)));
    // List delete.
    container.querySelectorAll(".ptf-del-list").forEach((b) =>
      b.addEventListener("click", () => ptfDeleteList(b.dataset.listName)));
    // List rename (click the name).
    container.querySelectorAll(".ptf-kind-name").forEach((s) =>
      s.addEventListener("click", () => ptfStartRenameList(s.dataset.listName, s)));
    // Per-list input-type selector.
    container.querySelectorAll("[data-list-type]").forEach((sel) =>
      sel.addEventListener("change", () => ptfSetListType(sel.dataset.listType, sel.value)));
  }

  async function ptfSetListType(kind, inputType) {
    const product = ptfProductEl.value;
    try {
      await fetchJson(API + "/api/product-type-factory/list/type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_type: product, kind, input_type: inputType }),
      });
      await loadProductTypeFactory();
      // Re-render the list block so its visual state matches the new type
      // (e.g. a radio kind with no options now hides its add-row).
      ptfRenderList(kind);
      ptfShowMsg(kind, "Type set to " + inputType + ".");
    } catch (e) {
      ptfShowMsg(kind, "Set type failed: " + (e.message || "unknown error"), true);
      // Reload to revert the <select> to the authoritative server state.
      await loadProductTypeFactory();
      ptfRenderAll();
    }
  }

  function ptfRenderList(kind) {
    const product = ptfProductEl.value;
    const listEl = panel.querySelector(`[data-ptf-list="${cssEscape(kind)}"]`);
    if (!listEl) return;
    const hintEl = panel.querySelector(`[data-ptf-hint="${cssEscape(kind)}"]`);
    const values = ptfValues(product, kind);
    const globalVals = opt("development", kind);

    if (!values.length) {
      listEl.innerHTML = `<li class="opt-empty muted small">No override — uses global Development → ${escapeHtml(kind[0].toUpperCase() + kind.slice(1))}: ${escapeHtml(globalVals.join(", "))}</li>`;
    } else {
      listEl.innerHTML = values
        .map((v, i) => `
          <li class="opt-item" data-ptf-id="${v.id}" data-idx="${i}">
            <button class="icon-btn opt-up" data-idx="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>▲</button>
            <button class="icon-btn opt-down" data-idx="${i}" title="Move down" ${i === values.length - 1 ? "disabled" : ""}>▼</button>
            <span class="opt-value" data-idx="${i}" title="Click to rename">${escapeHtml(v.value)}</span>
            <button class="icon-btn danger opt-del" data-idx="${i}" title="Delete">✕</button>
          </li>`).join("");
    }
    if (hintEl) hintEl.textContent = `Global default: ${escapeHtml(globalVals.join(", "))}`;

    listEl.querySelectorAll(".opt-up").forEach((b) =>
      b.addEventListener("click", () => ptfMoveItem(kind, Number(b.dataset.idx), -1)));
    listEl.querySelectorAll(".opt-down").forEach((b) =>
      b.addEventListener("click", () => ptfMoveItem(kind, Number(b.dataset.idx), +1)));
    listEl.querySelectorAll(".opt-del").forEach((b) =>
      b.addEventListener("click", () => ptfDeleteItem(kind, Number(b.dataset.idx))));
    listEl.querySelectorAll(".opt-value").forEach((s) =>
      s.addEventListener("click", () => ptfStartRename(kind, Number(s.dataset.idx), s)));
  }

  function ptfOrderedValues(kind) {
    return ptfValues(ptfProductEl.value, kind).map((v) => v.value);
  }

  async function ptfAddItem(kind) {
    const product = ptfProductEl.value;
    const input = panel.querySelector(`[data-ptf-new="${cssEscape(kind)}"]`);
    const value = input.value.trim();
    if (!value) { ptfShowMsg(kind, "Enter a value first.", true); return; }
    try {
      await fetchJson(API + "/api/product-type-factory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_type: product, kind, value }),
      });
      await loadProductTypeFactory();
      input.value = "";
      ptfRenderAll();
      ptfShowMsg(kind, "Added.");
    } catch (e) {
      ptfShowMsg(kind, "Add failed: " + (e.message || "value may already exist"), true);
    }
  }

  async function ptfMoveItem(kind, idx, dir) {
    const values = ptfOrderedValues(kind);
    const j = idx + dir;
    if (j < 0 || j >= values.length) return;
    [values[idx], values[j]] = [values[j], values[idx]];
    try {
      await fetchJson(API + "/api/product-type-factory/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_type: ptfProductEl.value, kind, orderedValues: values }),
      });
      await loadProductTypeFactory();
      ptfRenderList(kind);
    } catch (e) {
      ptfShowMsg(kind, "Reorder failed: " + e.message, true);
    }
  }

  async function ptfDeleteItem(kind, idx) {
    const values = ptfValues(ptfProductEl.value, kind);
    const target = values[idx];
    if (!target) return;
    try {
      await fetchJson(API + "/api/product-type-factory/" + target.id, { method: "DELETE" });
      await loadProductTypeFactory();
      ptfRenderAll();
      ptfShowMsg(kind, "Deleted.");
    } catch (e) {
      ptfShowMsg(kind, "Delete failed: " + e.message, true);
    }
  }

  function ptfStartRename(kind, idx, spanEl) {
    const values = ptfValues(ptfProductEl.value, kind);
    const oldVal = values[idx] ? values[idx].value : "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "opt-rename-input";
    input.value = oldVal;
    spanEl.replaceWith(input);
    input.focus();
    input.select();
    function commit() {
      const newVal = input.value.trim();
      if (newVal && newVal !== oldVal) ptfRenameItem(kind, values[idx].id, newVal);
      else ptfRenderList(kind);
    }
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      else if (e.key === "Escape") ptfRenderList(kind);
    });
  }

  async function ptfRenameItem(kind, id, newVal) {
    try {
      await fetchJson(API + "/api/product-type-factory/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newVal }),
      });
      await loadProductTypeFactory();
      ptfRenderList(kind);
      ptfShowMsg(kind, "Renamed.");
    } catch (e) {
      ptfShowMsg(kind, "Rename failed: " + (e.message || "value may already exist"), true);
      ptfRenderList(kind);
    }
  }

  // --- List-level operations: add / rename / delete / reorder a whole list ---

  async function ptfAddList() {
    const product = ptfProductEl.value;
    const input = panel.querySelector("#ptf-new-list");
    const kind = input.value.trim();
    if (!kind) { ptfShowMsg(kind, "Enter a list name first.", true); return; }
    try {
      await fetchJson(API + "/api/product-type-factory/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_type: product, kind }),
      });
      await loadProductTypeFactory();
      input.value = "";
      ptfRenderAll();
    } catch (e) {
      ptfShowMsg(kind, "Add list failed: " + (e.message || "name may already exist"), true);
    }
  }

  async function ptfDeleteList(kind) {
    const product = ptfProductEl.value;
    const count = ptfValues(product, kind).length;
    openConfirmModal(
      "Delete list?",
      `Delete the "${kind}" list${count ? ` and its ${count} option(s)` : ""} for "${product}"?`,
      async () => {
        try {
          await fetchJson(API + "/api/product-type-factory/list", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ product_type: product, kind }),
          });
          await loadProductTypeFactory();
          ptfRenderAll();
          ptfShowMsg(kind, `Deleted "${kind}".`);
        } catch (e) {
          ptfShowMsg(kind, "Delete list failed: " + e.message, true);
        }
      },
      { danger: true, okLabel: "Yes, delete" }
    );
  }

  async function ptfMoveList(idx, dir) {
    const product = ptfProductEl.value;
    const names = ptfListNames(product);
    const j = idx + dir;
    if (j < 0 || j >= names.length) return;
    [names[idx], names[j]] = [names[j], names[idx]];
    try {
      await fetchJson(API + "/api/product-type-factory/reorder-lists", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_type: product, orderedKinds: names }),
      });
      await loadProductTypeFactory();
      ptfRenderAll();
    } catch (e) {
      ptfShowMsg(names[idx], "Reorder lists failed: " + e.message, true);
    }
  }

  function ptfStartRenameList(oldKind, spanEl) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "opt-rename-input";
    input.value = oldKind;
    input.dataset.renaming = "1";        // marker: an in-flight rename owns this row
    spanEl.replaceWith(input);
    // Defer focus/select so the click that opened us doesn't immediately steal
    // focus back (some browsers fire blur synchronously during the same tick).
    requestAnimationFrame(() => { input.focus(); input.select(); });

    let done = false;
    async function commit() {
      if (done) return;
      done = true;
      const newKind = input.value.trim();
      if (!newKind || newKind === oldKind) {
        ptfRenderAll();
        return;
      }
      await ptfRenameList(oldKind, newKind);
    }
    function cancel() {
      if (done) return;
      done = true;
      ptfRenderAll();
    }
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
  }

  async function ptfRenameList(oldKind, newKind) {
    const product = ptfProductEl.value;
    // Clear any stale rename marker left in the DOM before the network call —
    // otherwise the row's "rename input" gets orphaned when loadProductTypeFactory
    // finishes and ptfRenderAll replaces the panel.
    try {
      await fetchJson(API + "/api/product-type-factory/list", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_type: product, oldKind, newKind }),
      });
      await loadProductTypeFactory();
      ptfRenderAll();
      // Show a confirmation anchored to the renamed list so the user sees the
      // name change actually took effect (vs. silently snapping back).
      ptfShowMsg(newKind, `Renamed "${oldKind}" → "${newKind}".`);
    } catch (e) {
      ptfShowMsg(oldKind, "Rename list failed: " + (e.message || "name may already exist"), true);
      await loadProductTypeFactory();
      ptfRenderAll();
    }
  }

  panel.querySelector("#ptf-add-list").addEventListener("click", ptfAddList);
  panel.querySelector("#ptf-new-list").addEventListener("keydown", (e) => {
    if (e.key === "Enter") ptfAddList();
  });
  ptfProductEl.addEventListener("change", () => ptfRenderAll());
  ptfRenderAll();
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
      <button class="subtab locked" data-step="shipto" role="tab" disabled>Ship to</button>
      <button class="subtab locked" data-step="project" role="tab" disabled>Project</button>
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
          ${opt("customer","currency").map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="cmp-payment">Payment term</label>
        <select id="cmp-payment">
          <option value="">— select —</option>
          ${opt("customer","payment_term").map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="cmp-shipment">Shipment term</label>
        <select id="cmp-shipment">
          <option value="">— select —</option>
          ${opt("customer","shipment_term").map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
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

  // the project tab is freely accessible once the company exists; the ship-to
  // tab is also unlocked, but a modal only appears after a ship-to save.
  const unlockLaterTabs = () => {
    ["shipto", "project"].forEach((step) => {
      const tab = subtabs.querySelector(`[data-step="${step}"]`);
      if (tab) { tab.classList.remove("locked"); tab.disabled = false; }
    });
  };

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
        <button class="btn primary" id="mbr-next" type="button" disabled>Next</button>
      </div>
    `;
    // Insert after the company subpanel
    panel.querySelector("#step-company").after(memberSec);

    const nameEl   = memberSec.querySelector("#mbr-name");
    const prefixEl = memberSec.querySelector("#mbr-prefix");
    const titleEl  = memberSec.querySelector("#mbr-title");
    const telEl    = memberSec.querySelector("#mbr-tel");
    const addBtn   = memberSec.querySelector("#mbr-add");
    const nextBtn  = memberSec.querySelector("#mbr-next");
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

    // Member step: at least one member must be added before leaving the step.
    const updateCreateBtn = () => { nextBtn.disabled = pending.length === 0; };

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

    nextBtn.addEventListener("click", async () => {
      if (nextBtn.disabled) return;
      nextBtn.disabled = true;
      nextBtn.textContent = "Creating…";
      try {
        const company = await saveCustomerWithMembers(
          companyName, emailSuffix, pending,
          {
            currency: panel.dataset.cmpCurrency || "",
            payment_term: panel.dataset.cmpPayment || "",
            shipment_term: panel.dataset.cmpShipment || "",
          },
        );
        panel.dataset.cmpId = String(company.id);
        subtabs.querySelector('[data-step="member"]').classList.add("done");
        unlockLaterTabs();
        showShipToStep(company.id, companyName, emailSuffix);
        showProjectStep(company.id, companyName, emailSuffix);
        nextBtn.textContent = "Created ✓";
        // After creating the company, jump straight to the Ship to tab
        // (no post-save modal). The modal appears once a ship-to address is saved.
        switchCreateTab("shipto");
      } catch (err) {
        nextBtn.textContent = "Create failed — retry";
        nextBtn.disabled = false;
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

// Switch the Customer / Create subtab (company/member/shipto/project) and
// show only the matching panel. Shared by create-finish + the ship-to save flow.
function switchCreateTab(step) {
  const subtabs = panel.querySelector("#createSubtabs");
  if (!subtabs) return;
  subtabs.querySelectorAll(".subtab").forEach((t) => {
    t.classList.toggle("active", t.dataset.step === step);
    t.onclick = () => {
      // Only allow jumping to a step whose prerequisites are satisfied.
      // Company -> always; Member -> company filled; Ship to / Project -> company created.
      const target = t.dataset.step;
      if (target === "member" && !panel.dataset.cmpName) return;
      if ((target === "shipto" || target === "project") && !panel.dataset.cmpId) return;
      subtabs.querySelectorAll(".subtab").forEach((x) => x.classList.toggle("active", x === t));
      ["company", "member", "shipto", "project"].forEach((s) => {
        const sec = panel.querySelector("#step-" + s);
        if (sec) sec.style.display = t.dataset.step === s ? "" : "none";
      });
    };
  });
  ["company", "member", "shipto", "project"].forEach((s) => {
    const sec = panel.querySelector("#step-" + s);
    if (sec) sec.style.display = step === s ? "" : "none";
  });
}

// ---------------------------------------------------------------------------
// Customer / Create — Ship to step (multiple addresses + default)
// ---------------------------------------------------------------------------

function showShipToStep(companyId, companyName, emailSuffix) {
  let sec = panel.querySelector("#step-shipto");
  if (sec) return; // already built
  sec = document.createElement("div");
  sec.className = "subpanel";
  sec.id = "step-shipto";
  sec.style.display = "none";
  sec.innerHTML = `
    <p class="ctx">Company: <strong>${escapeHtml(companyName)}</strong>
       (email suffix <strong>@${escapeHtml(emailSuffix)}</strong>)</p>
    <div class="ship-list" id="ship-list"></div>
    <div class="member-form">
      <h3 class="subhead">Add ship-to address</h3>
      <div class="field">
        <label for="ship-addr">Address</label>
        <textarea id="ship-addr" rows="3" placeholder="Full shipping address…" autocomplete="off"></textarea>
      </div>
      <div class="actions">
        <button class="btn" id="ship-add" type="button" disabled>Add address</button>
      </div>
    </div>
    <div class="actions create-final">
      <button class="btn ghost" id="ship-back" type="button">Back</button>
      <button class="btn primary" id="ship-next" type="button">Next</button>
    </div>
  `;
  panel.querySelector("#step-member").after(sec);

  sec.querySelector("#ship-back").addEventListener("click", () => {
    switchCreateTab("member");
  });
  sec.querySelector("#ship-next").addEventListener("click", () => {
    switchCreateTab("project");
  });

  const listEl = sec.querySelector("#ship-list");
  const addrEl = sec.querySelector("#ship-addr");
  const addBtn = sec.querySelector("#ship-add");

  const renderShipList = (rows) => {
    if (!rows.length) {
      listEl.innerHTML = '<p class="muted small">No ship-to addresses yet.</p>';
      return;
    }
    listEl.innerHTML = rows.map((s) => `
      <div class="member-row ${s.is_default ? "default-row" : ""}">
        <span>
          <strong>${escapeHtml(s.address)}</strong>
          ${s.is_default ? '<span class="badge default-badge">default</span>' : ""}
        </span>
        <span class="muted">
          ${s.is_default ? "" : `<button class="btn tiny" data-default="${s.id}" title="Set as default">Set default</button>`}
          <button class="icon-btn danger" data-rm="${s.id}" title="Remove">✕</button>
        </span>
      </div>`).join("");
    listEl.querySelectorAll("[data-default]").forEach((b) => {
      b.addEventListener("click", async () => {
        try {
          await fetchJson(API + `/api/ship-to/${b.dataset.default}/default`, { method: "PUT" });
          const rows = await fetchJson(API + `/api/ship-to/${companyId}`);
          renderShipList(rows);
        } catch (err) { alert("Set default failed: " + err.message); }
      });
    });
    listEl.querySelectorAll("[data-rm]").forEach((b) => {
      b.addEventListener("click", async () => {
        try {
          await fetchJson(API + `/api/ship-to/${b.dataset.rm}`, { method: "DELETE" });
          const rows = await fetchJson(API + `/api/ship-to/${companyId}`);
          renderShipList(rows);
        } catch (err) { alert("Remove failed: " + err.message); }
      });
    });
  };

  addrEl.addEventListener("input", () => {
    addBtn.disabled = !addrEl.value.trim();
  });

  addBtn.addEventListener("click", async () => {
    if (addBtn.disabled) return;
    const address = addrEl.value.trim();
    try {
      await fetchJson(API + `/api/ship-to/${companyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      addrEl.value = "";
      addBtn.disabled = true;
      const rows = await fetchJson(API + `/api/ship-to/${companyId}`);
      renderShipList(rows);
    } catch (err) { alert("Add failed: " + err.message); }
  });

  fetchJson(API + `/api/ship-to/${companyId}`)
    .then(renderShipList)
    .catch(() => renderShipList([]));
}

// ---------------------------------------------------------------------------
// Customer / Create — Project step (unique project names per company)
// ---------------------------------------------------------------------------

function showProjectStep(companyId, companyName, emailSuffix) {
  let sec = panel.querySelector("#step-project");
  if (sec) return; // already built
  sec = document.createElement("div");
  sec.className = "subpanel";
  sec.id = "step-project";
  sec.style.display = "none";
  sec.innerHTML = `
    <p class="ctx">Company: <strong>${escapeHtml(companyName)}</strong>
       (email suffix <strong>@${escapeHtml(emailSuffix)}</strong>)</p>
    <div class="proj-list" id="proj-list"></div>
    <div class="member-form">
      <h3 class="subhead">Add project</h3>
      <div class="field">
        <label for="proj-name">Project name</label>
        <input id="proj-name" type="text" placeholder="e.g. Spring 2026 Collection" autocomplete="off" />
      </div>
      <div class="actions">
        <button class="btn" id="proj-add" type="button" disabled>Add project</button>
      </div>
    </div>
    <div class="actions create-final">
      <button class="btn ghost" id="proj-back" type="button">Back</button>
      <button class="btn primary" id="proj-done" type="button">Created ✓</button>
    </div>
  `;
  panel.querySelector("#step-shipto").after(sec);

  sec.querySelector("#proj-back").addEventListener("click", () => {
    switchCreateTab("shipto");
  });
  sec.querySelector("#proj-done").addEventListener("click", () => {
    openCustomerPostSaveModal();
  });

  // Project step is optional — but the modal helper needs to exist. Reuse the
  // post-create modal (the only one removed earlier) by re-adding it here.
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

  const listEl = sec.querySelector("#proj-list");
  const nameEl = sec.querySelector("#proj-name");
  const addBtn = sec.querySelector("#proj-add");

  const renderProjList = (rows) => {
    if (!rows.length) {
      listEl.innerHTML = '<p class="muted small">No projects yet.</p>';
      return;
    }
    listEl.innerHTML = rows.map((p) => `
      <div class="member-row">
        <span><strong>${escapeHtml(p.name)}</strong></span>
        <span class="muted">
          <button class="icon-btn danger" data-rm="${p.id}" title="Remove">✕</button>
        </span>
      </div>`).join("");
    listEl.querySelectorAll("[data-rm]").forEach((b) => {
      b.addEventListener("click", async () => {
        try {
          await fetchJson(API + `/api/projects/${b.dataset.rm}`, { method: "DELETE" });
          const rows = await fetchJson(API + `/api/projects/${companyId}`);
          renderProjList(rows);
        } catch (err) { alert("Remove failed: " + err.message); }
      });
    });
  };

  nameEl.addEventListener("input", () => {
    addBtn.disabled = !nameEl.value.trim();
  });

  addBtn.addEventListener("click", async () => {
    if (addBtn.disabled) return;
    const name = nameEl.value.trim();
    try {
      const res = await fetchJson(API + `/api/projects/${companyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.error) { alert(res.error); return; }
      nameEl.value = "";
      addBtn.disabled = true;
      const rows = await fetchJson(API + `/api/projects/${companyId}`);
      renderProjList(rows);
    } catch (err) {
      if (err.message.includes("409")) {
        alert("A project with this name already exists for this company.");
      } else {
        alert("Add failed: " + err.message);
      }
    }
  });

  fetchJson(API + `/api/projects/${companyId}`)
    .then(renderProjList)
    .catch(() => renderProjList([]));
}

// ---------------------------------------------------------------------------
// Development / Create  (upper part)
//   - company fuzzy search (>=3 letters) -> link to customer view
//   - member dropdown (members of the selected company)
//   - product type dropdown
// ---------------------------------------------------------------------------

// Persistent state for the Development forms. There are TWO independent copies:
//   • devCreateState — the Create tab's working draft
//   • devEditState   — the Edit tab's working copy (seeded from a saved record)
// `devState` is a mutable binding that points at whichever one is currently
// active, so the Create and Edit tabs each keep their own data and can be
// switched between freely without clobbering each other.
function blankDevState() {
  return {
    companyId: "",
    companyName: "",
    memberId: "",
    memberName: "",
    projectId: "",
    projectName: "",
    item: "",
    product: "",
    // Part 3 details
    height: "",
    width: "",
    raisedHeight: "",
    noOfColor: "",
    pantones: [],   // [{ value, color }]  one entry per color
    // Split-color (Front/Back) state for screen print label / printed label / hang tag.
    // `null` means "not applicable"; an object means the product uses the split layout.
    colorSides: null,   // { front: { noOfColor, pantones }, back: { noOfColor, pantones } }
    // Part 4 material / Part 5 special (TBA — popup details, stored as JSON)
    material: null, // [{ ... }]  (placeholder structure, TBA)
    special: null,  // [{ ... }]  (placeholder structure, TBA)
    // Part 6 remark — array of free-text strings (stored in DB `remake` column)
    remake: [],     // ["note 1", "note 2"]
    images: [],   // [{ id, name, url }]
    docs: [],     // [{ id, name, file }]
  };
}
const devCreateState = blankDevState();
const devEditState   = blankDevState();
let devState = devCreateState;

// Persistent state for the Enquiry forms. Enquiry is now structurally identical
// to Development — it carries the same Part 1–4 fields (company/member/project,
// item + product type, Part-3 details, image + documents). The ONLY behavioural
// difference is that Enquiry's Part-4 image supports MULTIPLE images (Development
// replaces the single image). We keep one Create draft (enquiryCreateState) and
// one Edit working copy (enquiryEditState), exactly like Development.
function blankEnquiryState() {
  return {
    companyId: "",
    companyName: "",
    memberId: "",
    memberName: "",
    projectId: "",
    projectName: "",
    item: "",
    product: "",
    // Part 3 details
    height: "",
    width: "",
    raisedHeight: "",
    noOfColor: "",
    pantones: [],   // [{ value, color }]  one entry per color
    // Split-color (Front/Back) state for screen print label / printed label / hang tag.
    // `null` means "not applicable"; an object means the product uses the split layout.
    colorSides: null,   // { front: { noOfColor, pantones }, back: { noOfColor, pantones } }
    // Free-text notes captured on Enquiry / Create ("Part 2 · Notes"). Persisted
    // to the `notes` column of the `enquiries` table and required to save.
    notes: "",
    images: [],   // [{ id, name, url }] — MULTIPLE images allowed (unlike Development)
    docs: [],     // [{ id, name, file }]
  };
}
const enquiryCreateState = blankEnquiryState();
let enqSaveStateFn = null;

// Enquiry / Edit — a SEPARATE screen from Create (own function + state),
// mirroring how Development keeps its Edit tab independent of Create.
const enquiryEditState = blankEnquiryState();
let enquiryEditMode = false;
let enquiryEditId = null;
let enquiryOriginal = null;   // snapshot of the record being edited (for dirty-check)

// Pool of sample images (from C:\Users\ng\Desktop\canvas_source) used by the
// Dummy button and the Development / View image column. Fetched once.
let devImagePool = null;   // [{ name, url }]
let devImagePoolLoading = null;

// When editing an existing development, the Create screen is reused pre-filled
// and the mini-tab shows "edit" (red background / black text).
let devEditMode = false;
let devEditId = null;
let devOriginal = null;   // snapshot of the record being edited (for dirty-check)

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

// Documents are always stored under /uploads/. A new upload is stored as
// "uploads/<uuid>__<file>"; legacy records stored only the bare original
// (e.g. "NXB30922CY074.pdf"). Either way it resolves under /uploads/, so we
// strip any "uploads/" prefix and always point at /uploads/. The server's
// best-effort resolver handles the legacy name → on-disk file mapping.
function docUrl(name) {
  if (!name) return "";
  const bare = name.startsWith("uploads/") ? name.slice("uploads/".length) : name;
  return API + "/uploads/" + encodeURI(bare);
}

// Clear the Create tab's working draft. The Edit tab uses its own separate
// state (devEditState) so a fresh Create never inherits edit data.
function resetDevState() {
  const s = devCreateState;
  s.companyId = "";
  s.companyName = "";
  s.memberId = "";
  s.memberName = "";
  s.projectId = "";
  s.projectName = "";
  s.item = "";
  s.product = "";
  s.height = "";
  s.width = "";
  s.raisedHeight = "";
  s.noOfColor = "";
  s.pantones = [];
  s.colorSides = null;
  s.material = null;   // Part 4 (TBA)
  s.special = null;    // Part 5 (TBA)
  s.remake = [];       // Part 6 (array of strings)
  s.images = [];
  s.docs = [];
}

// Build the development payload from current devState + DOM inputs.
function buildDevelopmentPayload() {
  const itemEl = panel.querySelector("#dev-item");
  const productEl = panel.querySelector("#dev-product");
  const memberEl = panel.querySelector("#dev-member");
  const companyName = devState.companyName;
  const item = (itemEl ? itemEl.value.trim() : devState.item) || devState.item;
  const product = (productEl ? productEl.value : devState.product) || devState.product;
  if (!companyName || !item || !product) return null;
  // Part 4 image is REQUIRED to save/update on both Create and Edit (enforced
  // by updateSaveState). Documents remain optional and never block Save/Update.
  const memberName = memberEl && memberEl.value
    ? memberEl.options[memberEl.selectedIndex]?.textContent || ""
    : "";
  return {
    company_id: devState.companyId ? Number(devState.companyId) : null,
    company_name: companyName,
    member_id: devState.memberId ? Number(devState.memberId) : null,
    member_name: memberName || null,
    project_id: devState.projectId ? Number(devState.projectId) : null,
    project_name: devState.projectName || null,
    item_name: item,
    product_type: product,
    height: devState.height || null,
    width: devState.width || null,
    raised_height: devState.raisedHeight || null,
    no_of_color: devState.noOfColor ? Number(devState.noOfColor) : null,
    pantones: devState.pantones.filter((p) => p && p.value).map((p) => ({ value: p.value, color: p.color })),
    color_sides: isSplitColorProduct(product) ? devState.colorSides || null : null,
    image_names: devState.images.map((i) => i.name),
    doc_names: devState.docs.map((d) => d.name),
    material: devState.material,
    special: devState.special,
    remake: devState.remake,
  };
}

// Centered confirm modal (replaces window.confirm). onConfirm runs on "Yes".
function openConfirmModal(title, message, onConfirm, opts) {
  const danger = !!(opts && opts.danger);
  const okLabel = (opts && opts.okLabel) || (danger ? "Yes, delete" : "Yes");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:420px">
      <h3>${escapeHtml(title)}</h3>
      <p class="muted">${escapeHtml(message)}</p>
      <div class="actions modal-actions">
        <button class="btn ghost" id="cf-cancel" type="button">Cancel</button>
        <button class="btn ${danger ? "danger" : "primary"}" id="cf-ok" type="button">${escapeHtml(okLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#cf-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#cf-ok").addEventListener("click", () => {
    overlay.remove();
    onConfirm();
  });
  // Click on backdrop (outside the modal box) also cancels — feels natural
  // for a centered overlay, and matches the global "no native pop-ups" rule.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function showToast(message, isError) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " toast-error" : "");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
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
    resetDevState();   // clear the Create draft entirely (incl. company/member/project)
    renderDevelopmentCreate();   // re-render so Create is blank when they return
    openTab("development-view");
  });
  overlay.querySelector("#ps-continue").addEventListener("click", () => {
    overlay.remove();
    // keep Part 1 (company/member/project) on the Create tab, clear the rest
    const keepCompanyId = devCreateState.companyId;
    const keepCompanyName = devCreateState.companyName;
    const keepMemberId = devCreateState.memberId;
    const keepMemberName = devCreateState.memberName;
    const keepProjectId = devCreateState.projectId;
    const keepProjectName = devCreateState.projectName;
    resetDevState();
    devCreateState.companyId = keepCompanyId;
    devCreateState.companyName = keepCompanyName;
    devCreateState.memberId = keepMemberId;
    devCreateState.memberName = keepMemberName;
    devCreateState.projectId = keepProjectId;
    devCreateState.projectName = keepProjectName;
    renderDevelopmentCreate();
  });
}

// Fill every field with random data + 4 random images. `ctx` carries the
// element references + helpers from renderDevelopmentCreate().
async function fillDummyDevelopment(ctx) {
  const { searchEl, hiddenEl, memberEl, projectEl, productEl, itemEl, heightEl, widthEl, companies,
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
    // pick a saved project for this company if one exists (optional)
    const projOpts = [...projectEl.querySelectorAll("option")].filter((o) => o.value !== "");
    if (projOpts.length) {
      const p = rnd(projOpts);
      projectEl.value = p.value;
      devState.projectId = p.value;
      devState.projectName = p.textContent;
    }

    // 2) item name + product type
    const ITEMS = ["Spring Patch", "Logo Badge", "Care Label", "Brand Tab", "Woven Emblem",
                   "Silicone Grip", "Heat Transfer", "Glitter Transfer", "Reflective Tape"];
    itemEl.value = rnd(ITEMS) + " " + (Math.floor(Math.random() * 900) + 100);
    devState.item = itemEl.value;
    const pt = rnd(opt("development","product_type"));
    productEl.value = pt;
    devState.product = pt;

    // 3) Part 3 details — set BEFORE rendering so inputs show the values.
    // Every product type now gets No. of color + Pantones (like raised
    // silicon label). Only "raised silicon label" additionally gets Raised height.
    // Split-color products (screen print label / printed label / hang tag) get
    // Front + Back sides instead of a single No. of color set.
    devState.height = (Math.random() * 40 + 10).toFixed(1);
    devState.width = (Math.random() * 40 + 10).toFixed(1);
    if (heightEl) heightEl.value = devState.height;
    if (widthEl) widthEl.value = devState.width;
    devState.raisedHeight = needsRaisedHeight(pt) ? (Math.random() * 3 + 0.5).toFixed(1) : "";
    if (isSplitColorProduct(pt)) {
      const mkSide = () => {
        const n = String(Math.floor(Math.random() * 4) + 1);
        const pantones = [];
        for (let i = 0; i < Number(n); i++) {
          pantones.push({ value: "19-" + (Math.floor(Math.random() * 400) + 100) + " TCX", color: "#888888" });
        }
        return { noOfColor: n, pantones };
      };
      devState.colorSides = { front: mkSide(), back: mkSide() };
      devState.noOfColor = "";
      devState.pantones = [];
    } else {
      devState.noOfColor = String(Math.floor(Math.random() * 4) + 1);
      devState.pantones = [];
      for (let i = 0; i < Number(devState.noOfColor); i++) {
        devState.pantones.push({ value: "19-" + (Math.floor(Math.random() * 400) + 100) + " TCX", color: "#888888" });
      }
      devState.colorSides = null;
    }

    // 4) single image from the pool (attachments are optional — but the Dummy
    //    flow still seeds one so the record has a thumbnail)
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
    // Reflect all seeded popups in the badges immediately (green words appear in
    // the panel, not just inside the popup after clicking Save):
    seedScreenPrintDefaults();   // dummy Material/Special for screen print / printed label
    refreshDevColorsBadge();     // Part 3 colors
    refreshDevRemarks();         // Part 6 remark list
    updateSaveState();           // enables Save (>=1 image)
  } catch (err) {
    openConfirmModal("Dummy failed", String(err && err.message ? err.message : err), () => {});
  }
}

// Fill every field with random data + 2–4 random images. On the Create screen
// (no Part 2/3) it only fills company/member/project; on the Edit screen it also
// fills item/product/Part-3 details just like Development. Always seeds MULTIPLE
// images (Enquiry supports >1 image).
async function fillDummyEnquiry(ctx) {
  const { searchEl, hiddenEl, memberEl, headupEl, productEl, itemEl, notesEl, companies,
          selectCompany, loadMembers, updateNextState, updateSaveState, updateUnlock,
          renderImageThumbs } = ctx;
  try {
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
    // headup is a free-text field — seed with a sample heads-up note so the
    // dummy row shows the column populated.
    if (headupEl) {
      const HEADUP_TEMPLATES = [
        "Rush — customer needs sample by Friday.",
        "Watch out for the metallic gold finish on the logo.",
        "Existing customer — use prior quote as reference.",
        "Confirm backing thickness before quoting.",
      ];
      headupEl.value = rnd(HEADUP_TEMPLATES);
      devState.projectId = "";
      devState.projectName = headupEl.value.trim();
    }

    // Fill Notes (Part 2) so the required-to-save gate passes for the dummy row.
    if (notesEl) {
      const NOTE_TEMPLATES = [
        "Customer wants a metallic gold finish on the logo; soft enamel sample preferred.",
        "Need 2-day production lead time. Pantone must match the swatch exactly.",
        "Confirm edge stitching matches existing label — see attached reference image.",
        "Quote required with both standard and premium backing options.",
        "Customer asked for eco-friendly material alternatives where possible.",
      ];
      notesEl.value = rnd(NOTE_TEMPLATES);
      devState.notes = notesEl.value;
    }

    // Only fill item/product/Part-3 when the Create screen has them (Edit does;
    // Create does not — Part 2/3 were removed there).
    if (itemEl && productEl) {
      const ITEMS = ["Spring Patch", "Logo Badge", "Care Label", "Brand Tab", "Woven Emblem",
                     "Silicone Grip", "Heat Transfer", "Glitter Transfer", "Reflective Tape"];
      itemEl.value = rnd(ITEMS) + " " + (Math.floor(Math.random() * 900) + 100);
      devState.item = itemEl.value;
      const pt = rnd(opt("development","product_type"));
      productEl.value = pt;
      devState.product = pt;

      // Every product type now gets No. of color + Pantones (like raised
      // silicon label). Only "raised silicon label" additionally gets Raised height.
      // Split-color products get Front + Back sides.
      devState.height = (Math.random() * 40 + 10).toFixed(1);
      devState.width = (Math.random() * 40 + 10).toFixed(1);
      devState.raisedHeight = needsRaisedHeight(pt) ? (Math.random() * 3 + 0.5).toFixed(1) : "";
      if (isSplitColorProduct(pt)) {
        const mkSide = () => {
          const n = String(Math.floor(Math.random() * 4) + 1);
          const pantones = [];
          for (let i = 0; i < Number(n); i++) {
            pantones.push({ value: "19-" + (Math.floor(Math.random() * 400) + 100) + " TCX", color: "#888888" });
          }
          return { noOfColor: n, pantones };
        };
        devState.colorSides = { front: mkSide(), back: mkSide() };
        devState.noOfColor = "";
        devState.pantones = [];
      } else {
        devState.noOfColor = String(Math.floor(Math.random() * 4) + 1);
        devState.pantones = [];
        for (let i = 0; i < Number(devState.noOfColor); i++) {
          devState.pantones.push({ value: "19-" + (Math.floor(Math.random() * 400) + 100) + " TCX", color: "#888888" });
        }
        devState.colorSides = null;
      }
    }

    // MULTIPLE images (2–4) so Enquiry's multi-image dropzone is exercised.
    const images = await ensureImagePool();
    devState.images.length = 0;
    if (images && images.length) {
      const count = Math.min(images.length, 2 + Math.floor(Math.random() * 3));
      const picked = [...images].sort(() => Math.random() - 0.5).slice(0, count);
      picked.forEach((s, i) => {
        devState.images.push({ id: "enq-img-" + Date.now() + "-" + i, name: s.name, url: s.url });
      });
    }

    updateNextState();
    updateUnlock();
    renderImageThumbs();   // draw the seeded images in Part 4
    updateSaveState();
  } catch (err) {
    openConfirmModal("Dummy failed", String(err && err.message ? err.message : err), () => {});
  }
}

// Wire the Part 4 (Material) / Part 5 (Special) popup buttons and the Part 6
// (Remark) list editor. `state` is the active devState (Create or Edit);
// `updateSaveState` re-evaluates Save/Update gating after a remark change.
function wireExtraParts(root, state, updateSaveState) {
  // Build the extra-list (non fabric/folding) <select> blocks for a product type.
  // `cur` is the saved material object; `cur.lists` holds selections by list name.
  function materialExtraListFields(product, cur) {
    const extra = listsForProduct(product).filter((k) => k !== "fabric" && k !== "folding");
    if (!extra.length) return "";
    const lists = (cur && cur.lists) || {};
    return extra.map((kind) => {
      const value = lists[kind] || "";
      const id = "mat-" + cssEscape(kind);
      const label = escapeHtml(kind[0].toUpperCase() + kind.slice(1));
      const type = listKindInputType(product, kind);
      if (type === "radio") {
        const opts = listOptionsFor(product, kind, value);
        if (!opts.length) {
          // No options configured for this radio kind — fall back to a free-
          // text input so the field is still usable until options are added.
          return `
            <div class="field">
              <label for="${id}">${label}</label>
              <input id="${id}" type="text" autocomplete="off" value="${escapeHtml(value)}" placeholder="(add options in Settings)"/>
            </div>`;
        }
        return `
          <div class="field">
            <label class="radio-label">${label}</label>
            <div class="radio-row" id="${id}-row">
              ${opts.map((o) => `
                <label class="radio-opt">
                  <input type="radio" name="${id}" value="${escapeHtml(o)}" ${value === o ? "checked" : ""}/> ${escapeHtml(o)}
                </label>`).join("")}
            </div>
          </div>`;
      }
      if (type === "textarea") {
        return `
          <div class="field">
            <label for="${id}">${label}</label>
            <textarea id="${id}" rows="3" placeholder="…">${escapeHtml(value)}</textarea>
          </div>`;
      }
      if (type === "text") {
        return `
          <div class="field">
            <label for="${id}">${label}</label>
            <input id="${id}" type="text" autocomplete="off" value="${escapeHtml(value)}" placeholder="…"/>
          </div>`;
      }
      // default: dropdown (existing behavior)
      return `
        <div class="field">
          <label for="${id}">${label}</label>
          <select id="${id}">
            <option value="">— select —</option>
            ${listOptionsFor(product, kind, value).map((f) =>
              `<option value="${escapeHtml(f)}" ${value === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
          </select>
        </div>`;
    }).join("");
  }

  function materialExtraListValues(overlay, product, cur) {
    const extra = listsForProduct(product).filter((k) => k !== "fabric" && k !== "folding");
    if (!extra.length) return undefined;
    const lists = {};
    for (const kind of extra) {
      const id = "mat-" + cssEscape(kind);
      const type = listKindInputType(product, kind);
      let v = null;
      if (type === "radio") {
        const checked = overlay.querySelector(`input[name="${id}"]:checked`);
        v = checked ? (checked.value || null) : null;
      } else if (type === "text" || type === "textarea") {
        const el = overlay.querySelector("#" + id);
        const raw = el ? (el.value || "") : "";
        v = raw.trim() || null;
      } else {
        // dropdown
        const sel = overlay.querySelector("#" + id);
        v = sel ? (sel.value || null) : null;
      }
      if (!v && cur && cur.lists) v = cur.lists[kind] || null;
      if (v) lists[kind] = v;
    }
    return lists;
  }

  // --- Material & Special popups ---
  const openMaterialPopup = async () => {
    // Always re-pull the factory map so Part 4 reflects the latest Settings /
    // Options edits (the in-memory map is only loaded at startup otherwise).
    await loadProductTypeFactory();
    // A product with configured factory lists defines its complete Material
    // form. For example, Jacron with only a `thickness` list must show only
    // Thickness — not the legacy Recycle/Fabric/Edge/Folding fields. Every
    // product except printed / screen print label uses the product-type
    // factory as its complete Material form. An unconfigured product renders an
    // intentionally blank popup; each list added in Settings → Options → Product
    // type factory becomes a dynamic Material field. Printed / screen print label
    // keep the legacy Recycle/Fabric/Edge/Folding form below.
    const factoryOnly = !isScreenPrintProduct(devState.product);
    const cur = devState.material && typeof devState.material === "object" ? devState.material : (factoryOnly ? {} : {
      recycle: "recycle",
      fabric: "polyester",
      edge: "slit",
      folding: "loop fold",
    });
    const extra = materialExtraListFields(devState.product, cur);
    const standardMaterialFields = factoryOnly ? "" : `
        <div class="field">
          <label class="radio-label">Recycle</label>
          <div class="radio-row" id="mat-recycle-row">
            <label class="radio-opt"><input type="radio" name="mat-recycle" value="recycle" ${cur.recycle === "recycle" ? "checked" : ""}/> recycle</label>
            <label class="radio-opt"><input type="radio" name="mat-recycle" value="non-recycle" ${cur.recycle === "non-recycle" ? "checked" : ""}/> non recycle</label>
          </div>
        </div>

        <div class="field">
          <label for="mat-fabric">Fabric</label>
          <select id="mat-fabric">
            <option value="">— select —</option>
            ${fabricOptionsFor(devState.product, cur.fabric).map((f) => `<option value="${escapeHtml(f)}" ${cur.fabric === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
          </select>
          <span class="hint" id="mat-fabric-hint"></span>
        </div>

        <div class="field">
          <label class="radio-label">Edge</label>
          <div class="radio-row" id="mat-edge-row">
            <label class="radio-opt"><input type="radio" name="mat-edge" value="slit" ${cur.edge === "slit" ? "checked" : ""}/> slit edge</label>
            <label class="radio-opt"><input type="radio" name="mat-edge" value="woven" ${cur.edge === "woven" ? "checked" : ""}/> woven edge</label>
          </div>
        </div>

        <div class="field">
          <label for="mat-folding">Folding</label>
          <div class="folding-row">
            <select id="mat-folding">
              <option value="">— select —</option>
              ${foldingOptionsFor(devState.product, cur.folding).map((f) => `<option value="${escapeHtml(f)}" ${cur.folding === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
            </select>
            <img id="mat-folding-img" class="folding-preview" alt="" ${cur.folding && foldingImage(cur.folding) ? `src="${foldingImage(cur.folding)}" onerror="this.style.display='none'"` : ""} style="${cur.folding && foldingImage(cur.folding) ? "" : "display:none;"}"/>
          </div>
          <span class="hint" id="mat-folding-hint"></span>
        </div>`;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:480px">
        <h3>Material</h3>

        ${standardMaterialFields}
        ${extra}

        <div class="actions modal-actions">
          <button class="btn ghost" id="mat-clear" type="button">Clear</button>
          <button class="btn primary" id="mat-save" type="button">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const fabricSelect = overlay.querySelector("#mat-fabric");
    const foldingSelect = overlay.querySelector("#mat-folding");
    const foldingImg = overlay.querySelector("#mat-folding-img");
    const fabricHint = overlay.querySelector("#mat-fabric-hint");
    const foldingHint = overlay.querySelector("#mat-folding-hint");

    // Keep the Fabric / Folding dropdowns narrowed to the chosen product type.
    // If the currently-saved value is no longer valid for the product, show a
    // hint and reset that field to "— select —" so the user picks a valid one.
    const syncMaterialForProduct = (product) => {
      if (factoryOnly) return;
      const validFabric = fabricOptionsFor(product, null);
      fabricSelect.innerHTML = `<option value="">— select —</option>` +
        validFabric.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
      const validFolding = foldingOptionsFor(product, null);
      foldingSelect.innerHTML = `<option value="">— select —</option>` +
        validFolding.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
      // Preserve a previously-saved value only if it's still valid here.
      const keepFabric = cur.fabric && validFabric.includes(cur.fabric) ? cur.fabric : "";
      const keepFolding = cur.folding && validFolding.includes(cur.folding) ? cur.folding : "";
      fabricSelect.value = keepFabric;
      foldingSelect.value = keepFolding;
      fabricHint.textContent = validFabric.length ? `Options for ${escapeHtml(product)}` : "";
      foldingHint.textContent = validFolding.length ? `Options for ${escapeHtml(product)}` : "";
    };
    syncMaterialForProduct(devState.product);

    const close = () => overlay.remove();
    overlay.querySelector("#mat-save").addEventListener("click", () => {
      const recycle = overlay.querySelector('input[name="mat-recycle"]:checked')?.value || null;
      const fabric = fabricSelect ? (fabricSelect.value || null) : null;
      const edge = overlay.querySelector('input[name="mat-edge"]:checked')?.value || null;
      const folding = foldingSelect ? (foldingSelect.value || null) : null;
      const lists = materialExtraListValues(overlay, devState.product, cur);
      devState.material = factoryOnly ? { lists: lists || {} } : { recycle, fabric, edge, folding };
      if (lists) devState.material.lists = lists;
      refreshDevExtras();
      if (typeof updateSaveState === "function") updateSaveState();
      close();
    });
    overlay.querySelector("#mat-clear").addEventListener("click", () => {
      devState.material = null;
      refreshDevExtras();
      if (typeof updateSaveState === "function") updateSaveState();
      close();
    });

    if (foldingSelect) foldingSelect.addEventListener("change", () => {
      const imgSrc = foldingImage(foldingSelect.value);
      if (imgSrc) {
        foldingImg.src = imgSrc;
        foldingImg.style.display = "";
      } else {
        foldingImg.removeAttribute("src");
        foldingImg.style.display = "none";
      }
    });
  };

  const openTbaPopup = (title) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:480px">
        <h3>${escapeHtml(title)}</h3>
        <p class="muted">Details to be confirmed (TBA).</p>
        <div class="actions modal-actions">
          <button class="btn primary" id="tba-close" type="button">Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#tba-close").addEventListener("click", () => overlay.remove());
  };

  const openSpecialPopup = () => {
    const cur = devState.special && typeof devState.special === "object" ? devState.special : { variable: "variable" };
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:480px">
        <h3>Special</h3>

        <div class="field">
          <label class="radio-label">Variable</label>
          <div class="radio-row" id="spec-variable-row">
            <label class="radio-opt"><input type="radio" name="spec-variable" value="variable" ${cur.variable === "variable" ? "checked" : ""}/> variable</label>
            <label class="radio-opt"><input type="radio" name="spec-variable" value="non-variable" ${cur.variable === "non-variable" ? "checked" : ""}/> non variable</label>
          </div>
        </div>

        <div class="actions modal-actions">
          <button class="btn ghost" id="spec-clear" type="button">Clear</button>
          <button class="btn primary" id="spec-save" type="button">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector("#spec-save").addEventListener("click", () => {
      const variable = overlay.querySelector('input[name="spec-variable"]:checked')?.value || null;
      devState.special = variable ? { variable } : null;
      refreshDevExtras();
      if (typeof updateSaveState === "function") updateSaveState();
      close();
    });
    overlay.querySelector("#spec-clear").addEventListener("click", () => {
      devState.special = null;
      refreshDevExtras();
      if (typeof updateSaveState === "function") updateSaveState();
      close();
    });
  };

  const matBtn = root.querySelector("#dev-material-btn");
  const specBtn = root.querySelector("#dev-special-btn");

  // The Material/Special badges + hint now live in refreshDevExtras() (module-
  // level, document-scoped). Wire the buttons + product-change hook to it.
  if (matBtn) {
    // Bind once; decide at CLICK time because devState.product is empty when the
    // panel first mounts (Create tab). Always open the full Material popup —
    // even for product types without a Product type factory override — so the
    // user can fill in the base Recycle / Fabric / Edge / Folding fields. When
    // there's no product-specific override, the Fabric / Folding <select>s
    // fall back to the global Development lists.
    matBtn.addEventListener("click", () => {
      openMaterialPopup();
    });
  }
  if (specBtn) {
    specBtn.addEventListener("click", openSpecialPopup);
  }

  // --- Colors / Pantone popup (Part 3) — editable like Material ---
  const colorsBtn = root.querySelector("#dev-colors-btn");
  if (colorsBtn) {
    colorsBtn.addEventListener("click", () => {
      openColorsPopup(
        () => state,
        (next) => {
          if (next.colorSides && Object.keys(next.colorSides).length) {
            state.colorSides = next.colorSides;
            state.noOfColor = "";
            state.pantones = [];
          } else {
            state.colorSides = null;
            state.noOfColor = next.noOfColor;
            state.pantones = next.pantones;
          }
          refreshDevColorsBadge();
        },
        () => { if (typeof updateSaveState === "function") updateSaveState(); }
      );
    });
  }
  // Seed green defaults + repaint badges/hint when product changes or on mount.
  const prodEl = root.querySelector("#dev-product");
  if (prodEl) prodEl.addEventListener("change", () => onProductTypeChanged(prodEl));
  seedScreenPrintDefaults();
  refreshDevColorsBadge();

  // --- Remark: array of free-text strings, add one per entry ---
  const listEl = root.querySelector("#dev-remake-list");
  const inputEl = root.querySelector("#dev-remake-input");
  const addBtn = root.querySelector("#dev-remake-add");

  const renderRemarkList = () => {
    if (!listEl) return;
    if (!state.remake || !state.remake.length) {
      listEl.innerHTML = `<li class="remake-empty muted small">No remarks yet.</li>`;
      return;
    }
    listEl.innerHTML = state.remake.map((note, i) => `
      <li class="remake-item">
        <span class="remake-text">${escapeHtml(note)}</span>
        <button type="button" class="icon-btn danger remake-rm" data-idx="${i}" title="Remove">✕</button>
      </li>`).join("");
    listEl.querySelectorAll(".remake-rm").forEach((b) => {
      b.addEventListener("click", () => {
        const i = Number(b.dataset.idx);
        if (i >= 0 && i < state.remake.length) {
          state.remake.splice(i, 1);
          renderRemarkList();
          if (typeof updateSaveState === "function") updateSaveState();
        }
      });
    });
  };

  const addRemarkItem = () => {
    if (!inputEl) return;
    const v = inputEl.value.trim();
    if (!v) return;
    if (!Array.isArray(state.remake)) state.remake = [];
    state.remake.push(v);
    inputEl.value = "";
    renderRemarkList();
    if (typeof updateSaveState === "function") updateSaveState();
    inputEl.focus();
  };

  if (addBtn) addBtn.addEventListener("click", addRemarkItem);
  if (inputEl) {
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addRemarkItem(); }
    });
  }

  renderRemarkList();
}
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

// Safely parse a JSON string into an array; returns [] on any failure.
function safeJsonParse(v) {
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
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
function findPantoneMatches(query, limit = 999) {
  if (!pantoneData) return [];
  const q = (query || "").trim();
  if (!q) return [];

  const norm = normalizePantone(q);
  const lower = q.toLowerCase().replace(/pantone/g, "").replace(/\s+/g, " ").trim();
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

  // 3) fuzzy match across CODE, NAME and TYPE (so "co" finds code 16-1422 cork,
  //    "tcx"/"tcp" in the type, etc.). Ranked by a small score, all returned.
  const fuzzy = pantoneData
    .filter((e) => {
      if (seen.has(e.code + e.type)) return false;
      const hay = (e.code + " " + e.name + " " + (pantoneTypeName(e.type) || e.type)).toLowerCase()
        .replace(/pantone/g, "").replace(/\s+/g, " ");
      // match the whole query as a subsequence against code+name+type
      return fuzzyMatch(hay, lower) || (norm && normKey(e.code).includes(norm));
    })
    .sort((a, b) => {
      const score = (e) => {
        let s = 0;
        const hay = (e.code + " " + e.name + " " + (pantoneTypeName(e.type) || e.type)).toLowerCase()
          .replace(/pantone/g, "").replace(/\s+/g, " ");
        if (hint && e.type === hint) s += 100;
        if (e.name.toLowerCase().startsWith(lower)) s += 20;
        if (e.code.toLowerCase().includes(lower)) s += 15;
        if (e.name.toLowerCase().includes(lower)) s += 10;
        s -= e.name.length * 0.1;
        return s;
      };
      return score(b) - score(a);
    })
    .slice(0, limit - results.length);

  return results.concat(fuzzy);
}

// Fill a pantone row with a chosen code and render it as the selected match.
// Shared by the top-match click and the "similar" chip clicks so the first
// suggestion is selectable just like the others.
function applyPantoneSelection(matchEl, wrap, i, code, updateSaveState) {
  const inp = wrap.querySelector('.pantone-input[data-idx="' + i + '"]');
  if (inp) inp.value = code;
  if (devState.pantones[i]) {
    devState.pantones[i].value = code;
    const chosen = findPantoneMatches(code)[0];
    devState.pantones[i].color = chosen ? "#" + chosen.hex : "#000000";
  }
  const chosen = findPantoneMatches(code)[0];
  matchEl.innerHTML = chosen
    ? `<div class="pantone-top">` +
      `<span class="swatch" style="background:#${escapeHtml(chosen.hex)}"></span>` +
      `<span class="muted small">${escapeHtml(chosen.code)} · ${escapeHtml(chosen.name)} · ` +
      `<span class="pantone-type" title="${escapeHtml(pantoneTypeName(chosen.type))}">${escapeHtml(pantoneTypeName(chosen.type))}</span> · #${escapeHtml(chosen.hex)}</span>` +
      `</div>`
    : "";
  updateSaveState();
}

// Clear the Enquiry Create draft (blank new page on the right frame).
function resetEnquiryState() {
  const s = enquiryCreateState;
  s.companyId = "";
  s.companyName = "";
  s.memberId = "";
  s.memberName = "";
  s.projectId = "";
  s.projectName = "";
  s.noOfColor = "";
  s.pantones = [];
  s.colorSides = null;
  s.images = [];
}

// Build the enquiry payload from current devState (the active Enquiry draft —
// either enquiryCreateState on Create or enquiryEditState on Edit). Create no
// longer has Part 2/3 (item/product/details), so those fields are only required
// when the corresponding inputs are present on the page (i.e. on Edit). The
// payload still always includes the columns (empty/null) so the schema stays
// consistent; only company is unconditionally required.
function buildEnquiryPayload() {
  const itemEl = panel.querySelector("#enq-item");
  const productEl = panel.querySelector("#enq-product");
  const memberEl = panel.querySelector("#enq-member");
  const notesEl = panel.querySelector("#enq-notes");
  const companyName = devState.companyName;
  const item = (itemEl ? itemEl.value.trim() : devState.item) || devState.item || "";
  const product = (productEl ? productEl.value : devState.product) || devState.product || "";
  const notes = (notesEl ? notesEl.value.trim() : (devState.notes || "").trim());
  // company is always required; item/product only when the screen has them.
  // Notes are required on Enquiry / Create only — Enquiry / Edit leaves the
  // field optional so existing rows predating the column can still be updated.
  if (!companyName) return null;
  if (itemEl && !item) return null;
  if (productEl && !product) return null;
  if (notesEl && !notes && !itemEl) return null;
  const memberName = memberEl && memberEl.value
    ? memberEl.options[memberEl.selectedIndex]?.textContent || ""
    : "";
  return {
    company_id: devState.companyId ? Number(devState.companyId) : null,
    company_name: companyName,
    member_id: devState.memberId ? Number(devState.memberId) : null,
    member_name: memberName || null,
    project_id: devState.projectId ? Number(devState.projectId) : null,
    project_name: devState.projectName || null,
    item_name: item || null,
    product_type: product || null,
    height: devState.height || null,
    width: devState.width || null,
    raised_height: devState.raisedHeight || null,
    no_of_color: devState.noOfColor ? Number(devState.noOfColor) : null,
    pantones: devState.pantones.filter((p) => p && p.value).map((p) => ({ value: p.value, color: p.color })),
    color_sides: isSplitColorProduct(product) ? devState.colorSides || null : null,
    image_names: devState.images.map((i) => i.name),
    doc_names: devState.docs.map((d) => d.name),
    material: devState.material,
    special: devState.special,
    remake: devState.remake,
    notes: notes || null,
  };
}

async function renderEnquiryCreate() {
  // Enquiry / Create keeps ONLY Part 1 (Company & Member) + Part 4 (Images +
  // Documents). Part 2 (Item & Product Type) and Part 3 (Details) are removed
  // from Create per request — the ONLY remaining field beyond the customer is the
  // multi-image dropzone. Save posts to /api/enquiries.
  devState = enquiryCreateState;

  panel.innerHTML = `
    <h2>Enquiry / Create</h2>

    <div class="actions create-actions">
      <button class="btn ghost" id="enq-dummy" type="button">Dummy</button>
      <button class="btn primary" id="enq-save" type="button" disabled>Save</button>
    </div>

    <div class="dev-2col">
      <div class="dev-part" id="enq-main">
        <h3 class="subhead part-head">
          1 · Company &amp; Member
          <button class="icon-btn" id="enq-refresh" type="button" title="Refresh customer database">⟳</button>
        </h3>

        <div class="field-stack">
          <div class="field" id="enq-company-field">
            <label for="enq-company">Company</label>
            <div class="combobox" id="enq-company-wrap">
              <input id="enq-company" type="text" autocomplete="off"
                     placeholder="Type ≥ 3 letters to search…" disabled />
              <input type="hidden" id="enq-company-id" />
              <ul class="combobox-list" id="enq-company-list" role="listbox" hidden></ul>
            </div>
          </div>

          <div class="field" id="enq-member-field">
            <label for="enq-member">Member</label>
            <select id="enq-member" disabled>
              <option value="">— select a company first —</option>
            </select>
          </div>

          <div class="field" id="enq-headup-field">
            <label for="enq-headup">headup <span class="hint">(optional)</span></label>
            <input id="enq-headup" type="text" autocomplete="off"
                   placeholder="e.g. Any quick heads-up for the team" />
          </div>
        </div>

        <h3 class="subhead">
          <span class="part-icon" aria-hidden="true">📝</span>2 · Notes <span class="req-mark">required</span>
        </h3>
        <div class="field notes-field" id="enq-notes-field">
          <label for="enq-notes">Notes <span class="field-hint">— what the customer asked for, references, anything the team should know</span></label>
          <textarea id="enq-notes" rows="4"
                    placeholder="e.g. Customer wants a metallic gold finish on the logo; soft enamel sample preferred."
                    autocomplete="off" maxlength="2000"></textarea>
          <div class="field-meta">
            <span class="field-hint-line">📌 Visible to the whole team</span>
            <span class="char-count" id="enq-notes-count">0 / 2000</span>
          </div>
        </div>
      </div>

      <!-- 4th part: images (multiple) + documents. -->
      <div class="dev-part" id="enq-part4">
        <h3 class="subhead">4 · Images <span class="req-mark">required</span></h3>

        <div class="dropzone" id="enq-image-drop" tabindex="0">
          <div class="drop-region">
            <span class="drop-icon">🖼️</span>
            <p class="muted small drop-hint">Drop or paste images here — required to save.<br/>You can add more than one image.</p>
          </div>
          <div class="thumb-grid" id="enq-image-thumbs"></div>
        </div>

        <h4 class="subhead">Documents <span class="req-mark optional">optional</span></h4>
        <div class="dropzone" id="enq-doc-drop" tabindex="0">
          <div class="drop-region">
            <span class="drop-icon">📁</span>
            <p class="muted small drop-hint">Drag &amp; drop multiple files here.</p>
          </div>
          <div class="file-list" id="enq-doc-list"></div>
        </div>
      </div>
    </div>
  `;

  const part1 = panel.querySelector("#enq-main");
  const searchEl = panel.querySelector("#enq-company");
  const hiddenEl = panel.querySelector("#enq-company-id");
  const listEl   = panel.querySelector("#enq-company-list");
  const memberEl = panel.querySelector("#enq-member");
  const headupEl = panel.querySelector("#enq-headup");
  const notesEl  = panel.querySelector("#enq-notes");
  const notesCountEl = panel.querySelector("#enq-notes-count");
  const saveBtn = panel.querySelector("#enq-save");
  const dummyBtn = panel.querySelector("#enq-dummy");

  // Restore any draft Notes text so the textarea survives tab switches and the
  // post-save "save & same customer" reuse keeps the same notes for the next row.
  if (notesEl && devState.notes) notesEl.value = devState.notes;

  // Auto-grow + live char counter (initial paint refreshes both for restored text).
  wireNotesTextarea(notesEl, notesCountEl, {
    onChange: () => { devState.notes = notesEl.value; updateSaveState(); },
  });

  const part4 = panel.querySelector("#enq-part4");

  const updateUnlock = () => {
    part4.classList.remove("locked");
  };

  // enable search once we have the company list
  // Fetch companies but NEVER bail out on failure — bailing here would skip
  // every later step (form population, Back/Reset/Update wiring) and the user
  // would see an empty Edit screen with a dead Back button.
  let companies = [];
  let companiesLoadFailed = false;
  try {
    if (devCompaniesCache) {
      companies = devCompaniesCache;
    } else {
      companies = await fetchJson(API + "/api/companies");
      devCompaniesCache = companies;
    }
  } catch (err) {
    companiesLoadFailed = true;
    searchEl.placeholder = "Failed to load companies: " + err.message;
    searchEl.disabled = true;
    companies = [];   // input handler filters an empty list (no crash)
  }
  if (!companiesLoadFailed) searchEl.disabled = false;

  // When the Create draft still carries a company/member/project (e.g. after a
  // "same customer" post-save), repopulate the dropdowns so Part 1 stays filled
  // and the next record can inherit the same customer/member/project.
  if (devState.companyId && devState.memberId) {
    hiddenEl.value = devState.companyId;
    searchEl.value = devState.companyName;
    memberEl.innerHTML = `<option value="${devState.memberId}">${escapeHtml(devState.memberName || devState.memberId)}</option>`;
    memberEl.value = devState.memberId;
    memberEl.disabled = false;
    // headup is a free-text field — mirror the saved projectName string.
    headupEl.value = devState.projectName || "";
    loadMembers(Number(devState.companyId), devState.memberId);
  }

  // refresh = re-fetch latest companies + members from the customer database
  panel.querySelector("#enq-refresh").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.classList.add("spinning");
    const prevId = hiddenEl.value;
    try {
      companies = await fetchJson(API + "/api/companies");
      devCompaniesCache = companies;
      if (prevId !== "") {
        const stillThere = companies.some((c) => String(c.id) === String(prevId));
        if (stillThere) {
          await loadMembers(Number(prevId), devState.memberId || undefined);
        } else {
          resetCompanySelection();
        }
      }
      updateNextState();
    } catch (err) {
      openConfirmModal("Refresh failed", err.message, () => {});
    } finally {
      btn.disabled = false;
      btn.classList.remove("spinning");
    }
  });

  // -- helpers --
  const updateNextState = () => {
    const part1Done = hiddenEl.value !== "" && memberEl.value !== "";
    updateUnlock();
    updateSaveState();   // company/member change affects Save gating
  };

  const resetCompanySelection = () => {
    hiddenEl.value = "";
    memberEl.value = "";
    memberEl.disabled = true;
    memberEl.innerHTML = `<option value="">— select a company first —</option>`;
    devState.companyId = "";
    devState.companyName = "";
    devState.memberId = "";
    devState.projectId = "";
    devState.projectName = "";
    updateNextState();
  };

  async function loadMembers(companyId, restoreMemberId, restoreProjectId) {
    try {
      const comp = await fetchAnchoredCompany(companyId);
      const members = comp.members || [];
      memberEl.innerHTML = members.length
        ? `<option value="">— select a member —</option>` +
          members.map((m) =>
            `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("")
        : `<option value="">— no members —</option>`;
      memberEl.disabled = !members.length;
      if (restoreMemberId != null && members.some((m) => String(m.id) === String(restoreMemberId))) {
        memberEl.value = String(restoreMemberId);
      }
      // headup is a free-text field — no select to populate. Just keep the
      // current value (or restore one if provided).
      headupEl.value = devState.projectName || "";
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
    devState.projectId = "";
    devState.projectName = "";
    loadMembers(id, null, null);
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
    devState.projectId = "";
    devState.projectName = "";
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
  headupEl.addEventListener("input", () => {
    // headup is a free-text field — store it in projectName, leave projectId
    // empty (no association with a saved Project row).
    devState.projectId = "";
    devState.projectName = headupEl.value.trim();
    updateSaveState();
  });
  // Notes textarea is wired through wireNotesTextarea() above — its onChange
  // already mirrors the value into devState and re-evaluates updateSaveState.

  // Save gating: Part 1 complete AND Part 2 Notes filled AND at least one image
  // attached. Part 2/3 fields are removed from Create, so only company + member
  // + notes + image are required. Documents stay optional and never gate Save.
  // Images are required (>=1) to save.
  const updateSaveState = () => {
    const hasImage = devState.images.length >= 1;
    const notesFilled = (notesEl ? notesEl.value.trim() : (devState.notes || "").trim()) !== "";
    const allFilled = hiddenEl.value !== "" && memberEl.value !== "" && notesFilled && hasImage;
    const canSave = allFilled;
    saveBtn.disabled = !canSave;
    saveBtn.classList.toggle("active", canSave);
  };

  // initial unlock check (covers restored state on tab switch)
  updateNextState();
  updateSaveState();
  enqSaveStateFn = updateSaveState;   // let the shared image renderer re-gate Save

  // ===== 4th part: image dropzone (multiple) + documents =====
  const imageDrop = panel.querySelector("#enq-image-drop");
  const imageThumbs = panel.querySelector("#enq-image-thumbs");
  const docDrop = panel.querySelector("#enq-doc-drop");
  const docList = panel.querySelector("#enq-doc-list");

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
            "Remove this image from the enquiry?",
            () => {
              const j = images.findIndex((x) => x.id === id);
              if (j >= 0) {
                if (images[j].url && images[j].url.startsWith("blob:")) {
                  URL.revokeObjectURL(images[j].url);
                }
                images.splice(j, 1);
                renderImageThumbs();
                updateSaveState();
              }
            }
          );
        }
      });
    });
  };

  const addImageFile = (file) => {
    if (!isImageFile(file)) return;
    // Enquiry allows MULTIPLE images — each dropped/pasted file is appended
    // (Development REPLACES the single image here).
    const localUrl = URL.createObjectURL(file);
    const id = "enq-img-" + Date.now() + "-" + images.length;
    images.push({ id, name: file.name, url: localUrl, uploading: true });
    renderImageThumbs();
    updateSaveState();
    uploadImageFile(file, id);
  };

  const uploadImageFile = async (file, id) => {
    const entry = images.find((x) => x.id === id);
    if (!entry) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await fetchJson(API + "/api/uploads", { method: "POST", body: fd });
      entry.name = data.path;
      entry.url = data.url;
      entry.uploading = false;
      renderImageThumbs();
      updateSaveState();
    } catch (err) {
      if (entry) entry.uploading = false;
      openConfirmModal("Upload failed", "Could not upload image: " + err.message, () => {});
    }
  };

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
    // Enquiry allows MULTIPLE images — add every dropped image file.
    const files = [...(e.dataTransfer?.files || [])].filter(isImageFile);
    files.forEach((f) => addImageFile(f));
  });

  imageDrop.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { addImageFile(f); e.preventDefault(); }
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
    docList.innerHTML = docs.map((d) => {
      const downloadUrl = d.name ? docUrl(d.name) : (d.url || "");
      const dlLink = downloadUrl
        ? `<a class="doc-dl" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener" download title="Download ${escapeHtml(displayName(d.name))}">⬇ Download attached doc</a>`
        : "";
      return `
      <div class="doc-row" data-id="${d.id}">
        <span class="doc-icon">📄</span>
        <input class="doc-name" data-id="${d.id}" type="text" value="${escapeHtml(d.name)}" />
        <span class="doc-size muted small">${d.file ? formatBytes(d.file.size) : "saved"}</span>
        ${d.uploading ? '<span class="thumb-badge uploading">uploading…</span>' : ''}
        ${dlLink}
        <button class="icon-btn danger doc-rm" data-rm="${d.id}" title="Remove">✕</button>
      </div>`;
    }).join("");
    docList.querySelectorAll(".doc-rm").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.rm;
        const idx = docs.findIndex((x) => x.id === id);
        if (idx >= 0) { docs.splice(idx, 1); renderDocList(); updateSaveState(); }
      });
    });
    docList.querySelectorAll(".doc-name").forEach((inp) => {
      inp.addEventListener("input", () => {
        const d = docs.find((x) => x.id === inp.dataset.id);
        if (d) { d.name = inp.value; updateSaveState(); }
      });
    });
    updateSaveState();
  };

  const addDocFiles = async (fileList) => {
    for (const f of fileList) {
      const id = "enq-doc-" + Date.now() + "-" + docs.length;
      const entry = { id, name: f.name, file: f, uploading: true };
      docs.push(entry);
      renderDocList();
      try {
        const r = await uploadFile(f);
        entry.name = r.path;
        entry.url = API + r.path;
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
  dummyBtn.addEventListener("click", () => fillDummyEnquiry({
    searchEl, hiddenEl, memberEl, headupEl, notesEl, listEl, companies,
    selectCompany, loadMembers, updateNextState, updateSaveState, updateUnlock,
    renderImageThumbs,
  }));

  saveBtn.addEventListener("click", async () => {
    if (saveBtn.disabled) return;
    const payload = buildEnquiryPayload();
    if (!payload) {
      openConfirmModal("Cannot save", "Please fill company, member, notes, and add at least one image.", () => {});
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await fetchJson(API + "/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      saveBtn.textContent = "Saved ✓";
      openEnquiryPostSaveModal();
    } catch (err) {
      saveBtn.textContent = "Save";
      saveBtn.disabled = false;
      openConfirmModal("Save failed", "Could not save enquiry: " + err.message, () => {});
    }
  });

}

// ---------------------------------------------------------------------------
// Enquiry / Edit — a SEPARATE screen from Create (own function + state).
//   Loads an existing record (pre-filled), shows a red "edit" mini-tab, and
//   PUTs changes back via Update. Structurally IDENTICAL to Development / Edit
//   (Parts 1–4, dirty-check gating, Back/Reset), with the same single
//   behavioural difference as Create: the Part-4 image supports MULTIPLE images.
// ---------------------------------------------------------------------------

async function renderEnquiryEdit() {
  // Point the module-level alias at enquiryEditState so shared helpers operate
  // on the Enquiry edit draft.
  devState = enquiryEditState;

  panel.innerHTML = `
    <h2>Enquiry / Edit</h2>

    <div class="actions create-actions">
      <button class="btn ghost" id="enq-back" type="button">← Back</button>
      <button class="btn ghost" id="enq-dummy" type="button">Dummy</button>
      <button class="btn primary" id="enq-save" type="button" disabled>Update</button>
      <button class="btn primary enq-reset-spacer" id="enq-reset" type="button" disabled>Reset</button>
    </div>

    <div class="dev-2col">
      <div class="dev-part" id="enq-main">
        <h3 class="subhead part-head">
          1 · Company &amp; Member
          <button class="icon-btn" id="enq-refresh" type="button" title="Refresh customer database">⟳</button>
        </h3>

        <div class="field-stack">
          <div class="field" id="enq-company-field">
            <label for="enq-company">Company</label>
            <div class="combobox" id="enq-company-wrap">
              <input id="enq-company" type="text" autocomplete="off"
                     placeholder="Type ≥ 3 letters to search…" disabled />
              <input type="hidden" id="enq-company-id" />
              <ul class="combobox-list" id="enq-company-list" role="listbox" hidden></ul>
            </div>
          </div>

          <div class="field" id="enq-member-field">
            <label for="enq-member">Member</label>
            <select id="enq-member" disabled>
              <option value="">— select a company first —</option>
            </select>
          </div>

          <div class="field" id="enq-headup-field">
            <label for="enq-headup">headup <span class="hint">(optional)</span></label>
            <input id="enq-headup" type="text" autocomplete="off"
                   placeholder="e.g. Any quick heads-up for the team" />
          </div>
        </div>

        <h3 class="subhead">
          <span class="part-icon" aria-hidden="true">📝</span>2 · Notes <span class="req-mark optional">optional</span>
        </h3>
        <div class="field notes-field" id="enq-notes-field">
          <label for="enq-notes">Notes <span class="field-hint">— what the customer asked for, references, anything the team should know</span></label>
          <textarea id="enq-notes" rows="4"
                    placeholder="e.g. Customer wants a metallic gold finish on the logo; soft enamel sample preferred."
                    autocomplete="off" maxlength="2000">${escapeHtml(devState.notes || "")}</textarea>
          <div class="field-meta">
            <span class="field-hint-line">📌 visible to the whole team</span>
            <span class="char-count" id="enq-notes-count">0 / 2000</span>
          </div>
        </div>
      </div>

      <div class="dev-part" id="enq-part4">
        <h3 class="subhead">4 · Images <span class="req-mark">required</span></h3>

        <div class="dropzone" id="enq-image-drop" tabindex="0">
          <div class="drop-region">
            <span class="drop-icon">🖼️</span>
            <p class="muted small drop-hint">Drop or paste images here — required to save.<br/>You can add more than one image.</p>
          </div>
          <div class="thumb-grid" id="enq-image-thumbs"></div>
        </div>

        <h4 class="subhead">Documents <span class="req-mark optional">optional</span></h4>
        <div class="dropzone" id="enq-doc-drop" tabindex="0">
          <div class="drop-region">
            <span class="drop-icon">📁</span>
            <p class="muted small drop-hint">Drag &amp; drop multiple files here.</p>
          </div>
          <div class="file-list" id="enq-doc-list"></div>
        </div>
      </div>
    </div>
  `;

  const part1 = panel.querySelector("#enq-main");
  const searchEl = panel.querySelector("#enq-company");
  const hiddenEl = panel.querySelector("#enq-company-id");
  const listEl   = panel.querySelector("#enq-company-list");
  const memberEl = panel.querySelector("#enq-member");
  const headupEl = panel.querySelector("#enq-headup");
  const saveBtn = panel.querySelector("#enq-save");
  const dummyBtn = panel.querySelector("#enq-dummy");
  const resetBtn = panel.querySelector("#enq-reset");

  const part4 = panel.querySelector("#enq-part4");
  const notesEl = panel.querySelector("#enq-notes");
  const notesCountEl = panel.querySelector("#enq-notes-count");

  // Auto-grow + live char counter. Edit's onChange still mirrors into devState
  // and re-evaluates the dirty-check so the Update button wakes up. The Update
  // gate is NOT strict on notes (existing rows predating the column can stay
  // empty); the gate is enforced only on Create.
  wireNotesTextarea(notesEl, notesCountEl, {
    onChange: () => { devState.notes = notesEl.value; updateSaveState(); },
  });

  const updateUnlock = () => {
    part4.classList.remove("locked");
  };

  // Fetch companies but NEVER bail out on failure — bailing here would skip
  // every later step (form population, Back/Reset/Update wiring) and the user
  // would see an empty Edit screen with a dead Back button.
  let companies = [];
  let companiesLoadFailed = false;
  try {
    if (devCompaniesCache) {
      companies = devCompaniesCache;
    } else {
      companies = await fetchJson(API + "/api/companies");
      devCompaniesCache = companies;
    }
  } catch (err) {
    companiesLoadFailed = true;
    searchEl.placeholder = "Failed to load companies: " + err.message;
    searchEl.disabled = true;
    companies = [];   // input handler filters an empty list (no crash)
  }
  if (!companiesLoadFailed) searchEl.disabled = false;

  // The record is already fully valid: seed company/member/project dropdowns
  // synchronously so Part 1 stays filled and Update unlocks without waiting on
  // the network load.
  if (devState.companyId && devState.memberId) {
    hiddenEl.value = devState.companyId;
    searchEl.value = devState.companyName;
    memberEl.innerHTML = `<option value="${devState.memberId}">${escapeHtml(devState.memberName || devState.memberId)}</option>`;
    memberEl.value = devState.memberId;
    memberEl.disabled = false;
    // headup is a free-text field — mirror the saved projectName string.
    headupEl.value = devState.projectName || "";
    loadMembers(Number(devState.companyId), devState.memberId);
  }

  panel.querySelector("#enq-refresh").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.classList.add("spinning");
    const prevId = hiddenEl.value;
    try {
      companies = await fetchJson(API + "/api/companies");
      devCompaniesCache = companies;
      if (prevId !== "") {
        const stillThere = companies.some((c) => String(c.id) === String(prevId));
        if (stillThere) {
          await loadMembers(Number(prevId), devState.memberId || undefined);
        } else {
          resetCompanySelection();
        }
      }
      updateNextState();
    } catch (err) {
      openConfirmModal("Refresh failed", err.message, () => {});
    } finally {
      btn.disabled = false;
      btn.classList.remove("spinning");
    }
  });

  const updateNextState = () => {
    const part1Done = hiddenEl.value !== "" && memberEl.value !== "";
    updateUnlock();
    updateSaveState();
  };

  // Notes (Part 2 in Enquiry Edit, no-op elsewhere). Captured into devState so
  // buildEnquiryPayload sends it and the dirty-check picks up edits. Update is
  // NOT gated on notes here — existing rows predating the field can be left
  // empty; Create is the only place where notes is required. The textarea is
  // wired by wireNotesTextarea() at the top of this function (its onChange
  // mirrors devState and triggers updateSaveState), so no listener is needed
  // here.

  const resetCompanySelection = () => {
    hiddenEl.value = "";
    memberEl.value = "";
    memberEl.disabled = true;
    memberEl.innerHTML = `<option value="">— select a company first —</option>`;
    devState.companyId = "";
    devState.companyName = "";
    devState.memberId = "";
    devState.projectId = "";
    devState.projectName = "";
    updateNextState();
  };

  async function loadMembers(companyId, restoreMemberId, restoreProjectId) {
    try {
      const comp = await fetchAnchoredCompany(companyId);
      const members = comp.members || [];
      memberEl.innerHTML = members.length
        ? `<option value="">— select a member —</option>` +
          members.map((m) =>
            `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("")
        : `<option value="">— no members —</option>`;
      memberEl.disabled = !members.length;
      if (restoreMemberId != null && members.some((m) => String(m.id) === String(restoreMemberId))) {
        memberEl.value = String(restoreMemberId);
      }
      // headup is a free-text field — no select to populate. Just keep the
      // current value (or restore one if provided).
      headupEl.value = devState.projectName || "";
    } catch (err) {
      memberEl.innerHTML = `<option value="">— load failed —</option>`;
      memberEl.disabled = true;
    }
    updateNextState();
  }

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
    devState.projectId = "";
    devState.projectName = "";
    loadMembers(id, null, null);
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
    devState.projectId = "";
    devState.projectName = "";
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
  headupEl.addEventListener("input", () => {
    // headup is a free-text field — store it in projectName, leave projectId
    // empty (no association with a saved Project row).
    devState.projectId = "";
    devState.projectName = headupEl.value.trim();
    updateSaveState();
  });
  // Part 3 (Details) was removed from Enquiry / Edit to mirror Enquiry / Create
  // — no Part 3 validation here. Update is gated on Part 1 + Notes + Images
  // (Notes optional — old records predating the column stay updatable).

  // Compare the current editable fields against the originally-loaded record.
  // Update only enables (and Reset only matters) once something actually changed.
  // Enquiry / Edit mirrors Enquiry / Create: only Part 1, Notes, Images and
  // Documents — Item / Product Type / Details were dropped from Create, so an
  // Edit of a Create-saved record must round-trip without those fields.
  const currentSignature = () => ({
    company_id: devState.companyId ? Number(devState.companyId) : null,
    member_id: devState.memberId ? Number(devState.memberId) : null,
    // headup is free text — compare by the trimmed name so the dirty check
    // doesn't false-alarm when project_id was dropped on schema change.
    project_name: (devState.projectName || "").trim(),
    image_names: devState.images.map((i) => i.name).sort(),
    doc_names: devState.docs.map((d) => d.name).sort(),
    notes: (devState.notes || "").trim(),
  });

  const sigEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isDirty = () => !enquiryOriginal || !sigEq(currentSignature(), {
    company_id: enquiryOriginal.company_id != null ? Number(enquiryOriginal.company_id) : null,
    member_id: enquiryOriginal.member_id != null ? Number(enquiryOriginal.member_id) : null,
    project_name: (enquiryOriginal.project_name || "").trim(),
    image_names: (enquiryOriginal.image_names || []).slice().sort(),
    doc_names: (enquiryOriginal.doc_names || []).slice().sort(),
    notes: (enquiryOriginal.notes || "").trim(),
  });

  // Save gating for the Edit tab: company + member + at least one image present,
// AND a real change detected (so removing an image activates Update, but
// removing ALL images disables it again). Notes is optional here — existing
// rows predating the column stay updatable; Enquiry / Create is the only place
// that requires it. Enquiry / Edit mirrors Enquiry / Create's fields exactly:
// Part 1 (Company & Member), Part 2 (Notes — optional), Part 4 (Images +
// Documents).
  const updateSaveState = () => {
    const hasImage = devState.images.length >= 1;
    const allFilled = hiddenEl.value !== "" && memberEl.value !== "" && hasImage;
    const dirty = isDirty();
    const canSave = allFilled && dirty;
    saveBtn.disabled = !canSave;
    saveBtn.classList.toggle("active", canSave);
    resetBtn.disabled = !dirty;
    resetBtn.classList.toggle("active", dirty);
  };

  updateNextState();
  updateSaveState();
  enqSaveStateFn = updateSaveState;   // let the shared image renderer re-gate Save

  // ===== 4th part: image dropzone (multiple) + documents =====
  const imageDrop = panel.querySelector("#enq-image-drop");
  const imageThumbs = panel.querySelector("#enq-image-thumbs");
  const docDrop = panel.querySelector("#enq-doc-drop");
  const docList = panel.querySelector("#enq-doc-list");

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
            "Remove this image from the enquiry?",
            () => {
              const j = images.findIndex((x) => x.id === id);
              if (j >= 0) {
                if (images[j].url && images[j].url.startsWith("blob:")) {
                  URL.revokeObjectURL(images[j].url);
                }
                images.splice(j, 1);
                renderImageThumbs();
                updateSaveState();
              }
            }
          );
        }
      });
    });
  };

  const addImageFile = (file) => {
    if (!isImageFile(file)) return;
    // Enquiry allows MULTIPLE images — each dropped/pasted file is appended
    // (Development REPLACES the single image here).
    const localUrl = URL.createObjectURL(file);
    const id = "enq-img-" + Date.now() + "-" + images.length;
    images.push({ id, name: file.name, url: localUrl, uploading: true });
    renderImageThumbs();
    updateSaveState();
    uploadImageFile(file, id);
  };

  const uploadImageFile = async (file, id) => {
    const entry = images.find((x) => x.id === id);
    if (!entry) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await fetchJson(API + "/api/uploads", { method: "POST", body: fd });
      entry.name = data.path;
      entry.url = data.url;
      entry.uploading = false;
      renderImageThumbs();
      updateSaveState();
    } catch (err) {
      if (entry) entry.uploading = false;
      openConfirmModal("Upload failed", "Could not upload image: " + err.message, () => {});
    }
  };

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
    // Enquiry allows MULTIPLE images — add every dropped image file.
    const files = [...(e.dataTransfer?.files || [])].filter(isImageFile);
    files.forEach((f) => addImageFile(f));
  });

  imageDrop.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { addImageFile(f); e.preventDefault(); }
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
    docList.innerHTML = docs.map((d) => {
      const downloadUrl = d.name ? docUrl(d.name) : (d.url || "");
      const dlLink = downloadUrl
        ? `<a class="doc-dl" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener" download title="Download ${escapeHtml(displayName(d.name))}">⬇ Download attached doc</a>`
        : "";
      return `
      <div class="doc-row" data-id="${d.id}">
        <span class="doc-icon">📄</span>
        <input class="doc-name" data-id="${d.id}" type="text" value="${escapeHtml(d.name)}" />
        <span class="doc-size muted small">${d.file ? formatBytes(d.file.size) : "saved"}</span>
        ${d.uploading ? '<span class="thumb-badge uploading">uploading…</span>' : ''}
        ${dlLink}
        <button class="icon-btn danger doc-rm" data-rm="${d.id}" title="Remove">✕</button>
      </div>`;
    }).join("");
    docList.querySelectorAll(".doc-rm").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.rm;
        const idx = docs.findIndex((x) => x.id === id);
        if (idx >= 0) { docs.splice(idx, 1); renderDocList(); updateSaveState(); }
      });
    });
    docList.querySelectorAll(".doc-name").forEach((inp) => {
      inp.addEventListener("input", () => {
        const d = docs.find((x) => x.id === inp.dataset.id);
        if (d) { d.name = inp.value; updateSaveState(); }
      });
    });
    updateSaveState();
  };

  const addDocFiles = async (fileList) => {
    for (const f of fileList) {
      const id = "enq-doc-" + Date.now() + "-" + docs.length;
      const entry = { id, name: f.name, file: f, uploading: true };
      docs.push(entry);
      renderDocList();
      try {
        const r = await uploadFile(f);
        entry.name = r.path;
        entry.url = API + r.path;
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

  // ===== Action: Dummy =====
  if (dummyBtn) {
    dummyBtn.addEventListener("click", () => fillDummyEnquiry({
      searchEl, hiddenEl, memberEl, headupEl, notesEl, listEl, companies,
      selectCompany, loadMembers, updateNextState, updateSaveState, updateUnlock,
      renderImageThumbs,
    }));
  }

  // ===== Action: Back =====
  const backBtn = panel.querySelector("#enq-back");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      // Always return the user to the Enquiry / View page. Reset the edit draft
      // and pin View as the active tab, even if Edit was the only tab open —
      // closeTab on its own would leave activeTarget=null (no panel rendered)
      // if View was never registered.
      enquiryEditMode = false;
      enquiryEditId = null;
      enquiryOriginal = null;
      Object.assign(enquiryEditState, blankEnquiryState());
      openTabs.delete("enquiry-edit");
      if (!openTabs.has("enquiry-view")) openTabs.add("enquiry-view");
      activeTarget = "enquiry-view";
      renderTabs();
      renderPanel();    // dispatches to renderEnquiryView()
      highlightNav();
    });
  }

  // ===== Action: Reset =====
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (!enquiryOriginal) return;
      const s = enquiryEditState;
      s.companyId = enquiryOriginal.company_id != null ? String(enquiryOriginal.company_id) : "";
      s.companyName = enquiryOriginal.company_name || "";
      s.memberId = enquiryOriginal.member_id != null ? String(enquiryOriginal.member_id) : "";
      s.memberName = enquiryOriginal.member_name || "";
      // headup mirrors project_name — clear the id (no association) and restore
      // the saved text.
      s.projectId = "";
      s.projectName = enquiryOriginal.project_name || "";
      // Item / Product Type / Details are NOT part of Enquiry / Edit (mirrors
      // Create) — keep their state at the blank values regardless.
      s.item = "";
      s.product = "";
      s.height = "";
      s.width = "";
      s.raisedHeight = "";
      s.noOfColor = "";
      s.pantones = [];
      s.colorSides = null;
      s.images = (enquiryOriginal.image_names || []).map((n) => ({ id: "eimg-" + n, name: n, url: assetUrl(n) }));
      s.docs = (enquiryOriginal.doc_names || []).map((name, i) => ({ id: "edoc-" + enquiryEditId + "-" + i, name, file: null }));
      s.notes = enquiryOriginal.notes || "";
      renderEnquiryEdit();   // re-render with restored data
    });
  }

  // ===== Action: Update =====
  saveBtn.addEventListener("click", async () => {
    if (saveBtn.disabled) return;
    const payload = buildEnquiryPayload();
    if (!payload) {
      openConfirmModal("Cannot save", "Please fill company, member, and add at least one image.", () => {});
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Updating…";
    try {
      await fetchJson(API + `/api/enquiries/${enquiryEditId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      enquiryEditMode = false;
      enquiryEditId = null;
      enquiryOriginal = null;
      Object.assign(enquiryEditState, blankEnquiryState());
      saveBtn.textContent = "Updated ✓";
      if (openTabs.has("enquiry-edit")) openTabs.delete("enquiry-edit");
      openTab("enquiry-view");
    } catch (err) {
      saveBtn.textContent = "Update";
      saveBtn.disabled = false;
      openConfirmModal("Update failed", "Could not save enquiry: " + err.message, () => {});
    }
  });
}

// ---------------------------------------------------------------------------
// Development / Edit  — a SEPARATE screen from Create (own function + state).
//   Loads an existing record (pre-filled), shows a red "edit" mini-tab, and
//   PUTs changes back via Update. Shares NO code with renderEnquiryCreate.
// ---------------------------------------------------------------------------

function openEnquiryPostSaveModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:440px">
      <h3>Enquiry saved</h3>
      <p class="muted">Continue with the same customer?</p>
      <div class="actions modal-actions">
        <button class="btn ghost" id="enq-view" type="button">No — go to Enquiry / View</button>
        <button class="btn primary" id="enq-continue" type="button">Yes, same customer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#enq-view").addEventListener("click", () => { overlay.remove(); openTab("enquiry-view"); });
  overlay.querySelector("#enq-continue").addEventListener("click", () => {
    overlay.remove();
    const keep = { companyId: enquiryCreateState.companyId, companyName: enquiryCreateState.companyName,
                   memberId: enquiryCreateState.memberId, memberName: enquiryCreateState.memberName,
                   projectId: enquiryCreateState.projectId, projectName: enquiryCreateState.projectName,
                   item: enquiryCreateState.item, product: enquiryCreateState.product,
                   height: enquiryCreateState.height, width: enquiryCreateState.width,
                   raisedHeight: enquiryCreateState.raisedHeight, noOfColor: enquiryCreateState.noOfColor,
                   pantones: enquiryCreateState.pantones.slice(),
                   images: enquiryCreateState.images.slice(), docs: enquiryCreateState.docs.slice() };
    resetEnquiryState();
    Object.assign(enquiryCreateState, keep);
    renderEnquiryCreate();
  });
}


async function renderDevelopmentCreate() {
  // The Create tab reads/writes ONLY its own state object (devCreateState).
  // The Edit tab is a completely separate function (renderDevelopmentEdit)
  // and shares no code or state with this one.
  // Point the module-level alias at devCreateState so shared helpers
  // (buildDevelopmentPayload, fillDummyDevelopment, renderDevImageThumbs)
  // operate on the correct state.
  devState = devCreateState;

  panel.innerHTML = `
    <h2>Development / Create</h2>

    <div class="actions create-actions">
      <button class="btn ghost" id="dev-dummy" type="button">Dummy</button>
      <button class="btn primary" id="dev-save" type="button" disabled>Save</button>
    </div>

    <div class="dev-2col">
      <div class="dev-col-left">
      <!-- Parts 1 + 2 + 3 stacked in one card -->
      <div class="dev-part" id="dev-main">
        <h3 class="subhead part-head">
          1 · Company &amp; Member
          <button class="icon-btn" id="dev-refresh" type="button" title="Refresh customer database">⟳</button>
        </h3>

        <div class="part1-grid">
          <div class="field" id="dev-company-field">
            <label for="dev-company">Company</label>
            <div class="combobox" id="dev-company-wrap">
              <input id="dev-company" type="text" autocomplete="off"
                     placeholder="Type ≥ 3 letters to search…" disabled />
              <input type="hidden" id="dev-company-id" />
              <ul class="combobox-list" id="dev-company-list" role="listbox" hidden></ul>
            </div>
          </div>

          <div class="field" id="dev-member-field">
            <label for="dev-member">Member</label>
            <select id="dev-member" disabled>
              <option value="">— select a company first —</option>
            </select>
          </div>
        </div>

        <div class="field" id="dev-project-field">
          <label for="dev-project">Project <span class="hint">(optional)</span></label>
          <select id="dev-project" disabled>
            <option value="">No project</option>
          </select>
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
              ${opt("development","product_type").map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="dim-row">
          <div class="field">
            <label for="dev-height">Height (mm) <span class="req-mark">required</span></label>
            <input id="dev-height" type="number" min="0" step="0.1" placeholder="0.0" autocomplete="off" />
          </div>
          <div class="field">
            <label for="dev-width">Width (mm) <span class="req-mark">required</span></label>
            <input id="dev-width" type="number" min="0" step="0.1" placeholder="0.0" autocomplete="off" />
          </div>
        </div>

      </div>

      <!-- 3 (colors) pill button, opened like Material -->
      <div class="dev-part dev-part-extra" id="dev-colors-part">
        <h3 class="subhead part-head">3 · Colors / Pantone</h3>
        <div class="field">
          <button type="button" class="pill-btn" id="dev-colors-btn">
            Color details <span class="pill-badge" id="dev-colors-badge">TBA</span>
          </button>
        </div>
      </div>

      <!-- 4 (material) · 5 (special) · 6 (remark) stacked below Part 3 details -->
      <div class="dev-part dev-part-extra" id="dev-part-extra">
        <h3 class="subhead part-head">4 · Material</h3>
        <div class="field">
          <button type="button" class="pill-btn" id="dev-material-btn">
            Material details <span class="pill-badge" id="dev-material-badge">TBA</span>
          </button>
        </div>

        <h3 class="subhead part-head">5 · Special</h3>
        <div class="field">
          <button type="button" class="pill-btn" id="dev-special-btn">
            Special details <span class="pill-badge" id="dev-special-badge">TBA</span>
          </button>
        </div>

        <h3 class="subhead part-head">6 · Remark</h3>
        <div class="field">
          <div class="remake-input-row">
            <input id="dev-remake-input" type="text" autocomplete="off" placeholder="Type a remark, then press Add…" />
            <button type="button" class="btn ghost" id="dev-remake-add">Add</button>
          </div>
          <ul class="remake-list" id="dev-remake-list"></ul>
        </div>
      </div>
      </div><!-- /dev-col-left -->

      <div class="dev-col-right">
      <!-- 7th part: image + documents. -->
      <div class="dev-part" id="dev-part4">
        <h3 class="subhead">7 · Image <span class="req-mark">required</span></h3>

        <div class="dropzone" id="dev-image-drop" tabindex="0">
          <div class="drop-region">
            <span class="drop-icon">🖼️</span>
            <p class="muted small drop-hint">Drop or paste an image here — required to save.<br/>A new image replaces the current one.</p>
          </div>
          <div class="thumb-grid" id="dev-image-thumbs"></div>
        </div>

        <h4 class="subhead">Documents <span class="req-mark optional">optional</span></h4>
        <div class="dropzone" id="dev-doc-drop" tabindex="0">
          <div class="drop-region">
            <span class="drop-icon">📁</span>
            <p class="muted small drop-hint">Drag &amp; drop multiple files here.</p>
          </div>
          <div class="file-list" id="dev-doc-list"></div>
        </div>
      </div>
      </div><!-- /dev-col-right -->
    </div>
  `;

  const part1 = panel.querySelector("#dev-main");
  const part2 = panel.querySelector("#dev-product");
  const searchEl = panel.querySelector("#dev-company");
  const hiddenEl = panel.querySelector("#dev-company-id");
  const listEl   = panel.querySelector("#dev-company-list");
  const memberEl = panel.querySelector("#dev-member");
  const projectEl = panel.querySelector("#dev-project");
  const productEl = panel.querySelector("#dev-product");
  const itemEl = panel.querySelector("#dev-item");
  const heightEl = panel.querySelector("#dev-height");
  const widthEl = panel.querySelector("#dev-width");
  const saveBtn = panel.querySelector("#dev-save");
  const dummyBtn = panel.querySelector("#dev-dummy");

  // --- Part 4 unlock when part 1 AND part 2 are complete ---
  const part3Body = null;
  const part3 = null;
  const part4 = panel.querySelector("#dev-part4");

  const updateUnlock = () => {
    // Part 4 stays unlocked (always available) — only its image requirement
    // gates Save/Update. Documents there are optional; the image is required.
    part4.classList.remove("locked");
    renderPart3();
  };

  // enable search once we have the company list
  // Fetch companies but NEVER bail out on failure — bailing here would skip
  // every later step (form population, Back/Reset/Update wiring) and the user
  // would see an empty Edit screen with a dead Back button.
  let companies = [];
  let companiesLoadFailed = false;
  try {
    if (devCompaniesCache) {
      companies = devCompaniesCache;
    } else {
      companies = await fetchJson(API + "/api/companies");
      devCompaniesCache = companies;
    }
  } catch (err) {
    companiesLoadFailed = true;
    searchEl.placeholder = "Failed to load companies: " + err.message;
    searchEl.disabled = true;
    companies = [];   // input handler filters an empty list (no crash)
  }
  if (!companiesLoadFailed) searchEl.disabled = false;

  // restore product selection
  if (devState.product) productEl.value = devState.product;
  // restore item name
  if (devState.item) itemEl.value = devState.item;
  if (heightEl && devState.height) heightEl.value = devState.height;
  if (widthEl && devState.width) widthEl.value = devState.width;

  // refresh the Colors badge from restored state (runs after the panel mounts)
  refreshDevColorsBadge();

  // When the Create draft still carries a company/member/project (e.g. after a
  // "same customer" post-save), repopulate the dropdowns so Part 1 stays filled
  // and the next record can inherit the same customer/member/project.
  if (devState.companyId && devState.memberId) {
    hiddenEl.value = devState.companyId;
    searchEl.value = devState.companyName;
    memberEl.innerHTML = `<option value="${devState.memberId}">${escapeHtml(devState.memberName || devState.memberId)}</option>`;
    memberEl.value = devState.memberId;
    memberEl.disabled = false;
    if (devState.projectId) {
      projectEl.innerHTML = `<option value="${devState.projectId}">${escapeHtml(devState.projectName || devState.projectId)}</option>`;
      projectEl.value = devState.projectId;
      projectEl.disabled = false;
    }
    loadMembers(Number(devState.companyId), devState.memberId, devState.projectId);
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
          // keep the currently-selected member if it still exists in the
          // customer database (don't reset it on refresh)
          await loadMembers(Number(prevId), devState.memberId || undefined, devState.projectId || undefined);
        } else {
          resetCompanySelection();
        }
      }
      // silent refresh: update the data only, don't re-open/pop the search list
      // or auto-highlight any company name.
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

  // Part 2 dimensions: bind Height/Width inputs to devState so the value is
  // captured by the Create payload (no gating change — these remain optional).
  if (heightEl) {
    heightEl.addEventListener("input", () => {
      devState.height = heightEl.value;
      updateSaveState();
    });
  }
  if (widthEl) {
    widthEl.addEventListener("input", () => {
      devState.width = widthEl.value;
      updateSaveState();
    });
  }

  // ---- Part 3 dynamic body (depends on product type) ----
  // The inline Height/Width/No.of.color/Pantone rows were moved into the
  // "3 · Colors / Pantone" popup (openColorsPopup). There is nothing to render
  // inline any more, so this is a no-op kept for the unlock pipeline.
  const renderPart3 = () => {
    ensurePantoneData();   // load the TCX dataset (no-op if already cached)
  };

  const bindDimInputs = () => {};

  const renderRaisedSiliconLabel = () => {
    // Replaced by the Colors/Pantone popup — no inline inputs render here.
  };

  const renderPantoneRows = () => {
    // Replaced by the Colors/Pantone popup.
  };

  const resetCompanySelection = () => {
    hiddenEl.value = "";
    memberEl.value = "";
    memberEl.disabled = true;
    memberEl.innerHTML = `<option value="">— select a company first —</option>`;
    devState.companyId = "";
    devState.companyName = "";
    devState.memberId = "";
    devState.projectId = "";
    devState.projectName = "";
    updateNextState();
  };

  async function loadMembers(companyId, restoreMemberId, restoreProjectId) {
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
      // populate the project dropdown from this company's saved projects
      const projects = comp.projects || [];
      projectEl.innerHTML = `<option value="">No project</option>` +
        (projects.length
          ? projects.map((p) =>
              `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")
          : "");
      projectEl.disabled = false;
      // restore previously selected project if it still exists in the customer DB
      const wantProject = restoreProjectId != null ? String(restoreProjectId) : (devState.projectId || "");
      if (wantProject && projects.some((p) => String(p.id) === wantProject)) {
        projectEl.value = wantProject;
        const hit = projects.find((p) => String(p.id) === wantProject);
        devState.projectId = wantProject;
        devState.projectName = hit.name;
      } else {
        devState.projectId = "";
        devState.projectName = "";
      }
    } catch (err) {
      memberEl.innerHTML = `<option value="">— load failed —</option>`;
      memberEl.disabled = true;
      projectEl.innerHTML = `<option value="">No project</option>`;
      projectEl.disabled = false;
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
    devState.projectId = "";
    devState.projectName = "";
    loadMembers(id, null, null);
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
    devState.projectId = "";
    devState.projectName = "";
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
  projectEl.addEventListener("change", () => {
    // Project is optional; store the selected id + name (or clear both).
    if (projectEl.value) {
      devState.projectId = projectEl.value;
      devState.projectName = projectEl.options[projectEl.selectedIndex]?.textContent || "";
    } else {
      devState.projectId = "";
      devState.projectName = "";
    }
    updateSaveState();
  });
  productEl.addEventListener("change", () => {
    onProductTypeChanged(productEl);
  });

  // Part 3 (Colors / Pantone) validation: the height/width/raised-height fields
  // were moved into the Colors/Pantone popup, so only No. of color + its Pantone
  // codes are validated here now (mirrors the old "raised silicon label" rule).
  //   • No. of color must be >= 1.
  //   • When No. of color >= 1, every Pantone row must have a code of length > 1
  //     (reject single-char stubs).
  const part3Valid = () => {
    // Split-color products require BOTH Front and Back sides to be valid.
    // Other product types keep the single No. of color + Pantone-row validation.
    if (isSplitColorProduct(devState.product)) {
      return splitColorsValid(devState.colorSides);
    }

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
    return true;
  };

  // Build the current record signature (the meaningful editable fields) so we
  // can compare it against the originally-loaded record and only enable Update
  // when something actually changed.
  const currentSignature = () => ({
    company_id: devState.companyId ? Number(devState.companyId) : null,
    member_id: devState.memberId ? Number(devState.memberId) : null,
    project_id: devState.projectId ? Number(devState.projectId) : null,
    item_name: (devState.item || "").trim(),
    product_type: devState.product || "",
    height: devState.height ? Number(devState.height) : null,
    width: devState.width ? Number(devState.width) : null,
    raised_height: devState.raisedHeight ? Number(devState.raisedHeight) : null,
    no_of_color: devState.noOfColor ? Number(devState.noOfColor) : null,
    pantones: devState.pantones.filter((p) => p && p.value).map((p) => ({ value: p.value.trim(), color: p.color })),
    color_sides: isSplitColorProduct(devState.product) ? (devState.colorSides || null) : null,
    image_names: devState.images.map((i) => i.name).sort(),
    doc_names: devState.docs.map((d) => d.name).sort(),
  });

  const sigEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isDirty = () => !devOriginal || !sigEq(currentSignature(), {
    company_id: devOriginal.company_id != null ? Number(devOriginal.company_id) : null,
    member_id: devOriginal.member_id != null ? Number(devOriginal.member_id) : null,
    project_id: devOriginal.project_id != null ? Number(devOriginal.project_id) : null,
    item_name: (devOriginal.item_name || "").trim(),
    product_type: devOriginal.product_type || "",
    height: devOriginal.height != null ? Number(devOriginal.height) : null,
    width: devOriginal.width != null ? Number(devOriginal.width) : null,
    raised_height: devOriginal.raised_height != null ? Number(devOriginal.raised_height) : null,
    no_of_color: devOriginal.no_of_color != null ? Number(devOriginal.no_of_color) : null,
    pantones: (devOriginal.pantones || []).map((p) => ({ value: (p.value || "").trim(), color: p.color })),
    color_sides: isSplitColorProduct(devOriginal.product_type) ? (devOriginal.color_sides || null) : null,
    image_names: (devOriginal.image_names || []).slice().sort(),
    doc_names: (devOriginal.doc_names || []).slice().sort(),
    material: devOriginal.material,
    special: devOriginal.special,
    remake: (devOriginal.remake || []).slice().sort(),
  });

  // Save gating: Parts 1–3 valid AND at least one image attached. The image
  // (Part 4) is REQUIRED to save or update on both Create and Edit; documents
  // stay optional. In edit mode the button is "Update" and must reflect a real
  // change — so an existing image alone does NOT enable Update unless something
  // else also changed (i.e. isDirty() is true).
  const updateSaveState = () => {
    // Image is a required field: at least one attachment must be present to
    // save or update. Documents are optional and never gate Save/Update.
    // Height + Width are REQUIRED — both must be filled in (any non-empty
    // numeric value, treated as mm) before Save / Update becomes active.
    const hasImage = devState.images.length >= 1;
    const heightOk = !!(devState.height && !Number.isNaN(Number(devState.height)) && Number(devState.height) >= 0);
    const widthOk  = !!(devState.width  && !Number.isNaN(Number(devState.width))  && Number(devState.width)  >= 0);
    const allFilled = hiddenEl.value !== "" && memberEl.value !== "" &&
                      devState.item && devState.product &&
                      heightOk && widthOk &&
                      part3Valid() && hasImage;
    const canSave = allFilled;
    saveBtn.disabled = !canSave;
    saveBtn.classList.toggle("active", canSave);
  };

  // initial unlock check (covers restored state on tab switch)
  updateNextState();
  updateSaveState();
  devSaveStateFn = updateSaveState;   // let the shared image renderer re-gate Save

  // ===== Part 4/5/6: material popup + special popup + remark list =====
  wireExtraParts(panel, devState, updateSaveState);

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
        <img class="create-thumb-img" src="${img.url}" alt="${escapeHtml(img.name)}" data-full="${escapeHtml(img.url)}" data-name="${escapeHtml(img.name)}" />
        <div class="thumb-name">${escapeHtml(img.name)}</div>
        ${img.uploading ? '<span class="thumb-badge uploading">uploading…</span>' : ''}
        <button class="icon-btn danger thumb-rm" data-rm="${img.id}" title="Remove">✕</button>
      </div>`).join("");
    imageThumbs.querySelectorAll(".create-thumb-img").forEach((im) => {
      im.addEventListener("click", () => openImageLightbox(im.dataset.full, im.dataset.name));
    });
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

  // Register this form as the active image paste target (Ctrl+V works anywhere).
  activeImagePasteTarget = { drop: imageDrop, add: addImageFile };

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
    docList.innerHTML = docs.map((d) => {
      // Documents always resolve under /uploads/ (server handles legacy
      // bare-name → on-disk mapping), so render a download link for any saved doc.
      const downloadUrl = d.name ? docUrl(d.name) : (d.url || "");
      const dlLink = downloadUrl
        ? `<a class="doc-dl" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener" download title="Download ${escapeHtml(displayName(d.name))}">⬇ Download attached doc</a>`
        : "";
      return `
      <div class="doc-row" data-id="${d.id}">
        <span class="doc-icon">📄</span>
        <input class="doc-name" data-id="${d.id}" type="text" value="${escapeHtml(d.name)}" />
        <span class="doc-size muted small">${d.file ? formatBytes(d.file.size) : "saved"}</span>
        ${d.uploading ? '<span class="thumb-badge uploading">uploading…</span>' : ''}
        ${dlLink}
        <button class="icon-btn danger doc-rm" data-rm="${d.id}" title="Remove">✕</button>
      </div>`;
    }).join("");
    docList.querySelectorAll(".doc-rm").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.rm;
        const idx = docs.findIndex((x) => x.id === id);
        if (idx >= 0) { docs.splice(idx, 1); renderDocList(); updateSaveState(); }
      });
    });
    docList.querySelectorAll(".doc-name").forEach((inp) => {
      inp.addEventListener("input", () => {
        const d = docs.find((x) => x.id === inp.dataset.id);
        if (d) { d.name = inp.value; updateSaveState(); }
      });
    });
    // A doc add/remove/rename changes the dirty signature — re-evaluate now so
    // the Update button lights up whenever Part 4 actually changed.
    updateSaveState();
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
    searchEl, hiddenEl, memberEl, projectEl, productEl, itemEl, heightEl, widthEl, listEl, companies,
    selectCompany, loadMembers, updateNextState, updateSaveState, updateUnlock,
  }));

  saveBtn.addEventListener("click", async () => {
    if (saveBtn.disabled) return;
    const payload = buildDevelopmentPayload();
    if (!payload) {
      openConfirmModal("Cannot save", "Please fill company, member, item, product type, Height (mm), and Width (mm).", () => {});
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await fetchJson(API + "/api/developments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      saveBtn.textContent = "Saved ✓";
      openPostSaveModal();
    } catch (err) {
      saveBtn.textContent = "Save";
      saveBtn.disabled = false;
      openConfirmModal("Save failed", "Could not save development: " + err.message, () => {});
    }
  });

}

// ---------------------------------------------------------------------------
// Development / Edit  — a SEPARATE screen from Create (own function + state).
//   Loads an existing record (pre-filled), shows a red "edit" mini-tab, and
//   PUTs changes back via Update. Shares NO code with renderDevelopmentCreate.
// ---------------------------------------------------------------------------

async function renderDevelopmentEdit() {
  // The Edit tab reads/writes ONLY its own state object. The Create tab uses
  // devCreateState and is never touched here.
  // Point the module-level alias at devEditState so shared helpers
  // (buildDevelopmentPayload, fillDummyDevelopment, renderDevImageThumbs)
  // operate on the correct state.
  devState = devEditState;

  panel.innerHTML = `
    <h2>Development / Edit</h2>

    <div class="actions create-actions">
      <button class="btn ghost" id="dev-back" type="button">← Back</button>
      <button class="btn ghost" id="dev-dummy" type="button">Dummy</button>
      <button class="btn primary" id="dev-save" type="button" disabled>Update</button>
      <button class="btn primary dev-reset-spacer" id="dev-reset" type="button" disabled>Reset</button>
    </div>

    <div class="dev-2col">
      <div class="dev-col-left">
      <div class="dev-part" id="dev-main">
        <h3 class="subhead part-head">
          1 · Company &amp; Member
          <button class="icon-btn" id="dev-refresh" type="button" title="Refresh customer database">⟳</button>
        </h3>

        <div class="part1-grid">
          <div class="field" id="dev-company-field">
            <label for="dev-company">Company</label>
            <div class="combobox" id="dev-company-wrap">
              <input id="dev-company" type="text" autocomplete="off"
                     placeholder="Type ≥ 3 letters to search…" disabled />
              <input type="hidden" id="dev-company-id" />
              <ul class="combobox-list" id="dev-company-list" role="listbox" hidden></ul>
            </div>
          </div>

          <div class="field" id="dev-member-field">
            <label for="dev-member">Member</label>
            <select id="dev-member" disabled>
              <option value="">— select a company first —</option>
            </select>
          </div>
        </div>

        <div class="field" id="dev-project-field">
          <label for="dev-project">Project <span class="hint">(optional)</span></label>
          <select id="dev-project" disabled>
            <option value="">No project</option>
          </select>
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
              ${opt("development","product_type").map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="dim-row">
          <div class="field">
            <label for="dev-height">Height (mm) <span class="req-mark">required</span></label>
            <input id="dev-height" type="number" min="0" step="0.1" placeholder="0.0" autocomplete="off" />
          </div>
          <div class="field">
            <label for="dev-width">Width (mm) <span class="req-mark">required</span></label>
            <input id="dev-width" type="number" min="0" step="0.1" placeholder="0.0" autocomplete="off" />
          </div>
        </div>

      </div>

      <!-- 3 (colors) pill button, opened like Material -->
      <div class="dev-part dev-part-extra" id="dev-colors-part">
        <h3 class="subhead part-head">3 · Colors / Pantone</h3>
        <div class="field">
          <button type="button" class="pill-btn" id="dev-colors-btn">
            Color details <span class="pill-badge" id="dev-colors-badge">TBA</span>
          </button>
        </div>
      </div>

      <!-- 4 (material) · 5 (special) · 6 (remark) stacked below Part 3 details -->
      <div class="dev-part dev-part-extra" id="dev-part-extra">
        <h3 class="subhead part-head">4 · Material</h3>
        <div class="field">
          <button type="button" class="pill-btn" id="dev-material-btn">
            Material details <span class="pill-badge" id="dev-material-badge">TBA</span>
          </button>
        </div>

        <h3 class="subhead part-head">5 · Special</h3>
        <div class="field">
          <button type="button" class="pill-btn" id="dev-special-btn">
            Special details <span class="pill-badge" id="dev-special-badge">TBA</span>
          </button>
        </div>

        <h3 class="subhead part-head">6 · Remark</h3>
        <div class="field">
          <div class="remake-input-row">
            <input id="dev-remake-input" type="text" autocomplete="off" placeholder="Type a remark, then press Add…" />
            <button type="button" class="btn ghost" id="dev-remake-add">Add</button>
          </div>
          <ul class="remake-list" id="dev-remake-list"></ul>
        </div>
      </div>
      </div><!-- /dev-col-left -->

      <div class="dev-col-right">
      <!-- 7th part: image + documents. -->
      <div class="dev-part" id="dev-part4">
        <h3 class="subhead">7 · Image <span class="req-mark">required</span></h3>

        <div class="dropzone" id="dev-image-drop" tabindex="0">
          <div class="drop-region">
            <span class="drop-icon">🖼️</span>
            <p class="muted small drop-hint">Drop or paste an image here — required to save.<br/>A new image replaces the current one.</p>
          </div>
          <div class="thumb-grid" id="dev-image-thumbs"></div>
        </div>

        <h4 class="subhead">Documents <span class="req-mark optional">optional</span></h4>
        <div class="dropzone" id="dev-doc-drop" tabindex="0">
          <div class="drop-region">
            <span class="drop-icon">📁</span>
            <p class="muted small drop-hint">Drag &amp; drop multiple files here.</p>
          </div>
          <div class="file-list" id="dev-doc-list"></div>
        </div>
      </div>
      </div><!-- /dev-col-right -->
    </div>
  `;

  const part1 = panel.querySelector("#dev-main");
  const part2 = panel.querySelector("#dev-product");
  const searchEl = panel.querySelector("#dev-company");
  const hiddenEl = panel.querySelector("#dev-company-id");
  const listEl   = panel.querySelector("#dev-company-list");
  const memberEl = panel.querySelector("#dev-member");
  const projectEl = panel.querySelector("#dev-project");
  const productEl = panel.querySelector("#dev-product");
  const itemEl = panel.querySelector("#dev-item");
  const heightEl = panel.querySelector("#dev-height");
  const widthEl = panel.querySelector("#dev-width");
  const saveBtn = panel.querySelector("#dev-save");
  const dummyBtn = panel.querySelector("#dev-dummy");
  const resetBtn = panel.querySelector("#dev-reset");

  const part3Body = null;
  const part3 = null;
  const part4 = panel.querySelector("#dev-part4");

  const updateUnlock = () => {
    part4.classList.remove("locked");
    renderPart3();
  };

  // Fetch companies but NEVER bail out on failure — bailing here would skip
  // every later step (form population, Back/Reset/Update wiring) and the user
  // would see an empty Edit screen with a dead Back button.
  let companies = [];
  let companiesLoadFailed = false;
  try {
    if (devCompaniesCache) {
      companies = devCompaniesCache;
    } else {
      companies = await fetchJson(API + "/api/companies");
      devCompaniesCache = companies;
    }
  } catch (err) {
    companiesLoadFailed = true;
    searchEl.placeholder = "Failed to load companies: " + err.message;
    searchEl.disabled = true;
    companies = [];   // input handler filters an empty list (no crash)
  }
  if (!companiesLoadFailed) searchEl.disabled = false;

  if (devState.product) productEl.value = devState.product;
  if (devState.item) itemEl.value = devState.item;
  if (heightEl && devState.height) heightEl.value = devState.height;
  if (widthEl && devState.width) widthEl.value = devState.width;

  // refresh the Colors badge from the loaded record (runs after the panel mounts)
  refreshDevColorsBadge();

  // The record is already fully valid: seed company/member/project dropdowns
  // synchronously so Part 2 stays enabled and Update unlocks without waiting on
  // the network load (which would otherwise make the edit appear to do nothing).
  if (devState.companyId && devState.memberId) {
    hiddenEl.value = devState.companyId;
    searchEl.value = devState.companyName;
    memberEl.innerHTML = `<option value="${devState.memberId}">${escapeHtml(devState.memberName || devState.memberId)}</option>`;
    memberEl.value = devState.memberId;
    memberEl.disabled = false;
    if (devState.projectId) {
      projectEl.innerHTML = `<option value="${devState.projectId}">${escapeHtml(devState.projectName || devState.projectId)}</option>`;
      projectEl.value = devState.projectId;
      projectEl.disabled = false;
    }
    loadMembers(Number(devState.companyId), devState.memberId, devState.projectId);
  }

  panel.querySelector("#dev-refresh").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.classList.add("spinning");
    const prevId = hiddenEl.value;
    try {
      companies = await fetchJson(API + "/api/companies");
      devCompaniesCache = companies;
      if (prevId !== "") {
        const stillThere = companies.some((c) => String(c.id) === String(prevId));
        if (stillThere) {
          await loadMembers(Number(prevId), devState.memberId || undefined, devState.projectId || undefined);
        } else {
          resetCompanySelection();
        }
      }
      updateNextState();
    } catch (err) {
      alert("Refresh failed: " + err.message);
    } finally {
      btn.disabled = false;
      btn.classList.remove("spinning");
    }
  });

  const updateNextState = () => {
    const part1Done = hiddenEl.value !== "" && memberEl.value !== "";
    part2.disabled = !part1Done;
    productEl.disabled = !part1Done;
    updateUnlock();
    updateSaveState();
  };

  itemEl.addEventListener("input", () => {
    devState.item = itemEl.value.trim();
    updateSaveState();
  });

  // Part 2 dimensions: bind Height/Width inputs to devState so the value is
  // captured by the payload (no gating change — these remain optional).
  if (heightEl) {
    heightEl.addEventListener("input", () => {
      devState.height = heightEl.value;
      updateSaveState();
    });
  }
  if (widthEl) {
    widthEl.addEventListener("input", () => {
      devState.width = widthEl.value;
      updateSaveState();
    });
  }

  // ---- Part 3 dynamic body (depends on product type) ----
  // The inline Height/Width/No.of.color/Pantone rows were moved into the
  // "3 · Colors / Pantone" popup (openColorsPopup). There is nothing to render
  // inline any more, so this is a no-op kept for the unlock pipeline.
  const renderPart3 = () => {
    ensurePantoneData();   // load the TCX dataset (no-op if already cached)
  };

  const bindDimInputs = () => {};

  const renderRaisedSiliconLabel = () => {
    // Replaced by the Colors/Pantone popup — no inline inputs render here.
  };

  const renderPantoneRows = () => {
    // Replaced by the Colors/Pantone popup.
  };

  const resetCompanySelection = () => {
    hiddenEl.value = "";
    memberEl.value = "";
    memberEl.disabled = true;
    memberEl.innerHTML = `<option value="">— select a company first —</option>`;
    devState.companyId = "";
    devState.companyName = "";
    devState.memberId = "";
    devState.projectId = "";
    devState.projectName = "";
    updateNextState();
  };

  async function loadMembers(companyId, restoreMemberId, restoreProjectId) {
    try {
      const comp = await fetchAnchoredCompany(companyId);
      const members = comp.members || [];
      memberEl.innerHTML = members.length
        ? `<option value="">— select a member —</option>` +
          members.map((m) =>
            `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("")
        : `<option value="">— no members —</option>`;
      memberEl.disabled = !members.length;
      if (restoreMemberId != null && members.some((m) => String(m.id) === String(restoreMemberId))) {
        memberEl.value = String(restoreMemberId);
      }
      const projects = comp.projects || [];
      projectEl.innerHTML = `<option value="">No project</option>` +
        (projects.length
          ? projects.map((p) =>
              `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")
          : "");
      projectEl.disabled = false;
      const wantProject = restoreProjectId != null ? String(restoreProjectId) : (devState.projectId || "");
      if (wantProject && projects.some((p) => String(p.id) === wantProject)) {
        projectEl.value = wantProject;
        const hit = projects.find((p) => String(p.id) === wantProject);
        devState.projectId = wantProject;
        devState.projectName = hit.name;
      } else {
        devState.projectId = "";
        devState.projectName = "";
      }
    } catch (err) {
      memberEl.innerHTML = `<option value="">— load failed —</option>`;
      memberEl.disabled = true;
      projectEl.innerHTML = `<option value="">No project</option>`;
      projectEl.disabled = false;
    }
    updateNextState();
  };

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
    devState.projectId = "";
    devState.projectName = "";
    loadMembers(id, null, null);
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
    devState.projectId = "";
    devState.projectName = "";
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
  projectEl.addEventListener("change", () => {
    if (projectEl.value) {
      devState.projectId = projectEl.value;
      devState.projectName = projectEl.options[projectEl.selectedIndex]?.textContent || "";
    } else {
      devState.projectId = "";
      devState.projectName = "";
    }
    updateSaveState();
  });
  productEl.addEventListener("change", () => {
    onProductTypeChanged(productEl);
  });

  // Part 3 (Colors / Pantone) validation: the height/width/raised-height fields
  // were moved into the Colors/Pantone popup, so only No. of color + its Pantone
  // codes are validated here now (mirrors the old "raised silicon label" rule).
  //   • No. of color must be >= 1.
  //   • When No. of color >= 1, every Pantone row must have a code of length > 1
  //     (reject single-char stubs).
  const part3Valid = () => {
    // Split-color products require BOTH Front and Back sides to be valid.
    if (isSplitColorProduct(devState.product)) {
      return splitColorsValid(devState.colorSides);
    }

    const n = parseInt(devState.noOfColor, 10);
    if (!n || n < 1) return false;                       // no. of color required (>= 1)

    if (n >= 1) {
      for (const p of devState.pantones) {
        const v = (p && (p.value || "") || "").trim().length;
        if (v <= 1) return false;
      }
    }
    return true;
  };

  // Compare the current editable fields against the originally-loaded record.
  // Update only enables (and Reset only matters) once something actually changed.
  const currentSignature = () => ({
    company_id: devState.companyId ? Number(devState.companyId) : null,
    member_id: devState.memberId ? Number(devState.memberId) : null,
    project_id: devState.projectId ? Number(devState.projectId) : null,
    item_name: (devState.item || "").trim(),
    product_type: devState.product || "",
    height: devState.height ? Number(devState.height) : null,
    width: devState.width ? Number(devState.width) : null,
    raised_height: devState.raisedHeight ? Number(devState.raisedHeight) : null,
    no_of_color: devState.noOfColor ? Number(devState.noOfColor) : null,
    pantones: devState.pantones.filter((p) => p && p.value).map((p) => ({ value: p.value.trim(), color: p.color })),
    color_sides: isSplitColorProduct(devState.product) ? (devState.colorSides || null) : null,
    image_names: devState.images.map((i) => i.name).sort(),
    doc_names: devState.docs.map((d) => d.name).sort(),
    material: devState.material,
    special: devState.special,
    remake: devState.remake.slice().sort(),
  });

  const sigEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isDirty = () => !devOriginal || !sigEq(currentSignature(), {
    company_id: devOriginal.company_id != null ? Number(devOriginal.company_id) : null,
    member_id: devOriginal.member_id != null ? Number(devOriginal.member_id) : null,
    project_id: devOriginal.project_id != null ? Number(devOriginal.project_id) : null,
    item_name: (devOriginal.item_name || "").trim(),
    product_type: devOriginal.product_type || "",
    height: devOriginal.height != null ? Number(devOriginal.height) : null,
    width: devOriginal.width != null ? Number(devOriginal.width) : null,
    raised_height: devOriginal.raised_height != null ? Number(devOriginal.raised_height) : null,
    no_of_color: devOriginal.no_of_color != null ? Number(devOriginal.no_of_color) : null,
    pantones: (devOriginal.pantones || []).map((p) => ({ value: (p.value || "").trim(), color: p.color })),
    color_sides: devOriginal.color_sides
      ? (typeof devOriginal.color_sides === "string" ? parseColorSidesString(devOriginal.color_sides) : devOriginal.color_sides)
      : null,
    image_names: (devOriginal.image_names || []).slice().sort(),
    doc_names: (devOriginal.doc_names || []).slice().sort(),
    material: devOriginal.material,
    special: devOriginal.special,
    remake: (devOriginal.remake || []).slice().sort(),
  });

  // Save gating for the Edit tab: all required fields filled AND a real change
  // detected (an existing image alone does NOT enable Update).
  const updateSaveState = () => {
    const hasImage = devState.images.length >= 1;
    // Height + Width are REQUIRED — both must be filled in before Update is
    // active. The dirty check (below) already detects changes vs. the loaded
    // record, so changing either field naturally enables the Update button.
    const heightOk = !!(devState.height && !Number.isNaN(Number(devState.height)) && Number(devState.height) >= 0);
    const widthOk  = !!(devState.width  && !Number.isNaN(Number(devState.width))  && Number(devState.width)  >= 0);
    const allFilled = hiddenEl.value !== "" && memberEl.value !== "" &&
                      devState.item && devState.product &&
                      heightOk && widthOk &&
                      part3Valid() && hasImage;
    const dirty = isDirty();
    const canSave = allFilled && dirty;
    saveBtn.disabled = !canSave;
    saveBtn.classList.toggle("active", canSave);
    // Header Reset is always available while editing — it restores the record
    // to its originally-loaded state (reverting even a product-type change).
    resetBtn.disabled = !devOriginal;
    resetBtn.classList.toggle("active", dirty);
  };

  updateNextState();
  updateSaveState();
  devSaveStateFn = updateSaveState;

  // ===== Part 4/5/6: material popup + special popup + remark list =====
  wireExtraParts(panel, devState, updateSaveState);
  const imageDrop = panel.querySelector("#dev-image-drop");
  const imageThumbs = panel.querySelector("#dev-image-thumbs");
  const docDrop = panel.querySelector("#dev-doc-drop");
  const docList = panel.querySelector("#dev-doc-list");

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
        <img class="create-thumb-img" src="${img.url}" alt="${escapeHtml(img.name)}" data-full="${escapeHtml(img.url)}" data-name="${escapeHtml(img.name)}" />
        <div class="thumb-name">${escapeHtml(img.name)}</div>
        ${img.uploading ? '<span class="thumb-badge uploading">uploading…</span>' : ''}
        <button class="icon-btn danger thumb-rm" data-rm="${img.id}" title="Remove">✕</button>
      </div>`).join("");
    imageThumbs.querySelectorAll(".create-thumb-img").forEach((im) => {
      im.addEventListener("click", () => openImageLightbox(im.dataset.full, im.dataset.name));
    });
    imageThumbs.querySelectorAll("[data-rm]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.rm;
        const idx = images.findIndex((x) => x.id === id);
        if (idx >= 0) {
          openConfirmModal(
            "Remove image?",
            "Remove this image from the development?",
            () => {
              const j = images.findIndex((x) => x.id === id);
              if (j >= 0) {
                if (images[j].url && images[j].url.startsWith("blob:")) {
                  URL.revokeObjectURL(images[j].url);
                }
                images.splice(j, 1);
                renderImageThumbs();
                updateSaveState();
              }
            }
          );
        }
      });
    });
  };

  const addImageFile = (file) => {
    if (!isImageFile(file)) return;
    if (images.length) URL.revokeObjectURL(images[0].url);
    const localUrl = URL.createObjectURL(file);
    const id = "img-" + Date.now() + "-0";
    images.length = 0;
    images.push({ id, name: file.name, url: localUrl, uploading: true });
    renderImageThumbs();
    updateSaveState();
    uploadImageFile(file, id);
  };

  // Register this form as the active image paste target (Ctrl+V works anywhere).
  activeImagePasteTarget = { drop: imageDrop, add: addImageFile };

  const uploadImageFile = async (file, id) => {
    const entry = images.find((x) => x.id === id);
    if (!entry) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await fetchJson(API + "/api/uploads", { method: "POST", body: fd });
      entry.name = data.path;
      entry.url = data.url;
      entry.uploading = false;
      renderImageThumbs();
      updateSaveState();
    } catch (err) {
      if (entry) entry.uploading = false;
      openConfirmModal("Upload failed", "Could not upload image: " + err.message, () => {});
    }
  };

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
    const first = [...(e.dataTransfer?.files || [])].find(isImageFile);
    if (first) addImageFile(first);
  });

  imageDrop.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { addImageFile(f); e.preventDefault(); break; }
      }
    }
  });

  const renderDocList = () => {
    if (!docs.length) {
      docList.innerHTML = "";
      docDrop.classList.remove("has-items");
      return;
    }
    docDrop.classList.add("has-items");
    docList.innerHTML = docs.map((d) => {
      // Documents always resolve under /uploads/ (server handles legacy
      // bare-name → on-disk mapping), so render a download link for any saved doc.
      const downloadUrl = d.name ? docUrl(d.name) : (d.url || "");
      const dlLink = downloadUrl
        ? `<a class="doc-dl" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener" download title="Download ${escapeHtml(displayName(d.name))}">⬇ Download attached doc</a>`
        : "";
      return `
      <div class="doc-row" data-id="${d.id}">
        <span class="doc-icon">📄</span>
        <input class="doc-name" data-id="${d.id}" type="text" value="${escapeHtml(d.name)}" />
        <span class="doc-size muted small">${d.file ? formatBytes(d.file.size) : "saved"}</span>
        ${d.uploading ? '<span class="thumb-badge uploading">uploading…</span>' : ''}
        ${dlLink}
        <button class="icon-btn danger doc-rm" data-rm="${d.id}" title="Remove">✕</button>
      </div>`;
    }).join("");
    docList.querySelectorAll(".doc-rm").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.rm;
        const idx = docs.findIndex((x) => x.id === id);
        if (idx >= 0) { docs.splice(idx, 1); renderDocList(); updateSaveState(); }
      });
    });
    docList.querySelectorAll(".doc-name").forEach((inp) => {
      inp.addEventListener("input", () => {
        const d = docs.find((x) => x.id === inp.dataset.id);
        if (d) { d.name = inp.value; updateSaveState(); }
      });
    });
    updateSaveState();
  };

  const addDocFiles = async (fileList) => {
    for (const f of fileList) {
      const id = "doc-" + Date.now() + "-" + docs.length;
      const entry = { id, name: f.name, file: f, uploading: true };
      docs.push(entry);
      renderDocList();
      try {
        const r = await uploadFile(f);
        entry.name = r.path;
        entry.url = API + r.path;
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

  // ===== Action buttons: Dummy / Update / Reset / Back =====

  dummyBtn.addEventListener("click", () => fillDummyDevelopment({
    searchEl, hiddenEl, memberEl, projectEl, productEl, itemEl, heightEl, widthEl, listEl, companies,
    selectCompany, loadMembers, updateNextState, updateSaveState, updateUnlock,
  }));

  // Back: discard the edit, clear only the Edit state, return to View.
  const backBtn = panel.querySelector("#dev-back");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      devEditMode = false;
      devEditId = null;
      devOriginal = null;
      Object.assign(devEditState, blankDevState());
      openTab("development-view");
    });
  }

  // Reset: restore every field to the originally-loaded record. Always enabled
  // while editing (even with no unsaved changes, so a product-type change can be
  // fully reverted). Requires an in-page confirm — never a native alert.
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (!devOriginal) return;
      openConfirmModal(
        "Reset record?",
        "This will discard all changes and restore the record to its originally loaded state, including the product type and Parts 3–6.",
        () => {
          const s = devEditState;
          s.companyId = devOriginal.company_id != null ? String(devOriginal.company_id) : "";
          s.companyName = devOriginal.company_name || "";
          s.memberId = devOriginal.member_id != null ? String(devOriginal.member_id) : "";
          s.memberName = devOriginal.member_name || "";
          s.projectId = devOriginal.project_id != null ? String(devOriginal.project_id) : "";
          s.projectName = devOriginal.project_name || "";
          s.item = devOriginal.item_name || "";
          s.product = devOriginal.product_type || "";
          s.height = devOriginal.height != null ? String(devOriginal.height) : "";
          s.width = devOriginal.width != null ? String(devOriginal.width) : "";
          s.raisedHeight = devOriginal.raised_height != null ? String(devOriginal.raised_height) : "";
          s.noOfColor = devOriginal.no_of_color != null ? String(devOriginal.no_of_color) : "";
          s.pantones = Array.isArray(devOriginal.pantones) ? devOriginal.pantones.map((p) => ({ value: p.value || "", color: p.color || "#000000" })) : [];
          s.colorSides = isSplitColorProduct(devOriginal.product_type) && devOriginal.color_sides
            ? (typeof devOriginal.color_sides === "string"
                ? parseColorSidesString(devOriginal.color_sides)
                : (devOriginal.color_sides || null))
            : null;
          s.images = (devOriginal.image_names || []).map((n) => ({ id: "eimg-" + n, name: n, url: assetUrl(n) }));
          s.docs = (devOriginal.doc_names || []).map((name, i) => ({ id: "edoc-" + devEditId + "-" + i, name, file: null }));
          s.material = devOriginal.material != null ? devOriginal.material : null;
          s.special = devOriginal.special != null ? devOriginal.special : null;
          s.remake = Array.isArray(devOriginal.remake) ? devOriginal.remake.slice() : [];
          renderDevelopmentEdit();   // re-render with restored data
        }
      );
    });
  }

  saveBtn.addEventListener("click", async () => {
    if (saveBtn.disabled) return;
    const payload = buildDevelopmentPayload();
    if (!payload) {
      openConfirmModal("Cannot save", "Please fill company, member, item, product type, Height (mm), and Width (mm).", () => {});
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    const verb = "Update";
    try {
      await fetchJson(API + `/api/developments/${devEditId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      devEditMode = false;
      devEditId = null;
      devOriginal = null;
      Object.assign(devEditState, blankDevState());
      saveBtn.textContent = "Updated ✓";
      if (openTabs.has("development-edit")) openTabs.delete("development-edit");
      openTab("development-view");
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
  if (needsRaisedHeight(d.product_type) && d.raised_height) parts.push(`raised ${d.raised_height} mm`);
  // Split-color products (screen print label / printed label / hang tag) store
  // their colors under `color_sides` (Front + Back); others use no_of_color/pantones.
  const sides = d.color_sides;
  if (sides && (sides.front || sides.back)) {
    for (const label of ["front", "back"]) {
      const side = sides[label];
      if (!side) continue;
      const n = side.noOfColor ? Number(side.noOfColor) : 0;
      if (!n) continue;
      const cols = (side.pantones || []).filter((p) => p && p.value).map((p) => p.value);
      parts.push(`${label.charAt(0).toUpperCase() + label.slice(1)} ${n} color${n > 1 ? "s" : ""}` + (cols.length ? ` (${cols.join(", ")})` : ""));
    }
  } else if (d.no_of_color) {
    const cols = (d.pantones || []).filter((p) => p && p.value).map((p) => p.value);
    parts.push(`${d.no_of_color} color${Number(d.no_of_color) > 1 ? "s" : ""}` + (cols.length ? ` (${cols.join(", ")})` : ""));
  }
  return parts.join(" · ");
}

async function renderDevelopmentView() {
  panel.innerHTML = '<h2>Development / View</h2><p class="empty">Loading…</p>';
  devViewSelected.clear();
  try {
    // On load, also pull the full customer database (companies/members/projects)
    // so any project changes made in Customer / View are reflected here too.
    const [devs, companies] = await Promise.all([
      await fetchJson(API + "/api/developments"),
      (async () => { try { return await fetchJson(API + "/api/companies"); } catch { return null; } })(),
    ]);
    devViewData = devs;
    if (companies) devCompaniesCache = companies;
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
    { key: "status", label: "Status" },
    { key: "image", label: "Image" },
    { key: "documents", label: "Documents" },
    { key: "material", label: "Material" },
    { key: "special", label: "Special" },
    { key: "height", label: "Height (mm)" },
    { key: "width", label: "Width (mm)" },
    { key: "remark", label: "Remark" },
    { key: "created_at", label: "Created" },
    { key: "updated_at", label: "Updated" },
    { key: "details", label: "Details" },
  ];

  // image / documents / details / material / special / remark are rendered
  // specially and not column-searched
  const specialKeys = new Set(["image", "documents", "details", "material", "special", "remark"]);
  const searchCols = cols.filter((c) => !specialKeys.has(c.key));

  const shown = devViewData.filter((r) =>
    searchCols.every((c) => fuzzyMatch(r[c.key], devViewFilters[c.key]))
  );

  const allKeys = shown.map((r) => "d:" + r.id);
  const allChecked = allKeys.length > 0 && allKeys.every((k) => devViewSelected.has(k));

  const searchRow = cols.map((c) => {
    if (specialKeys.has(c.key)) {
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
          `<img class="dev-thumb-sm dev-view-thumb" src="${assetUrl(n)}" alt="${escapeHtml(n)}" title="${escapeHtml(n)}" data-full="${escapeHtml(assetUrl(n))}" data-name="${escapeHtml(n)}" />`).join("") + `</div>`
      : `<span class="muted">—</span>`;
    const docs = (r.doc_names || []).map((n) =>
      `<a class="doc-tag" href="${docUrl(n)}" target="_blank" rel="noopener" download title="${escapeHtml(n)}">📄 ${escapeHtml(displayName(n))}</a>`).join("");
    const docLinks = docs || `<span class="muted">—</span>`;
    const materialSummaryText = r.material ? materialSummary(r.material) : "";
    const materialCell = materialSummaryText
      ? `<span class="pill-badge filled">${escapeHtml(materialSummaryText)}</span>`
      : `<span class="muted">—</span>`;
    const specialSummaryText = r.special ? specialSummary(r.special) : "";
    const specialCell = specialSummaryText
      ? `<span class="pill-badge filled">${escapeHtml(specialSummaryText)}</span>`
      : `<span class="muted">—</span>`;
    const remarkArr = Array.isArray(r.remake) ? r.remake
      : (typeof r.remake === "string" && r.remake ? safeJsonParse(r.remake) : []) || [];
    const remarkCell = (remarkArr && remarkArr.length)
      ? `<ul class="remake-list compact">` + remarkArr.map((n) =>
          `<li>${escapeHtml(n)}</li>`).join("") + `</ul>`
      : `<span class="muted">—</span>`;
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
        <td>${r.status ? `<button type="button" class="link-btn followup-status-btn" data-status="${r.id}" title="View follow-up history">${escapeHtml(r.status)}</button>` : `<span class="muted">—</span>`}</td>
        <td class="cell-imgs">${thumbs}</td>
        <td class="cell-docs">${docLinks}</td>
        <td>${materialCell}</td>
        <td>${specialCell}</td>
        <td>${r.height != null && r.height !== "" ? escapeHtml(String(r.height)) : `<span class="muted">—</span>`}</td>
        <td>${r.width != null && r.width !== "" ? escapeHtml(String(r.width)) : `<span class="muted">—</span>`}</td>
        <td>${remarkCell}</td>
        <td>${escapeHtml(r.created_at)}</td>
        <td>${escapeHtml(r.updated_at)}</td>
        <td class="details-cell"><button type="button" class="link-btn dev-details-btn" data-details="${r.id}" title="View color &amp; Pantone details">${escapeHtml(devDetailsSummary(r))}</button></td>
        <td class="row-actions">
          <button class="icon-btn" data-followup="${r.id}" title="Follow Up">📌</button>
          <button class="icon-btn" data-edit="${r.id}" title="Edit">✎</button>
          <button class="icon-btn danger" data-del="${r.id}" title="Delete">🗑</button>
        </td>
      </tr>`;
  }).join("") || `<tr><td colspan="17" class="muted">No matches.</td></tr>`;

  panel.innerHTML = `
    <div class="view-head">
      <h2>Development / View</h2>
      <div class="view-actions">
        <button class="btn ghost" id="dev-refresh" type="button" title="Refresh all customer database">⟳ Refresh</button>
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

  panel.querySelector("#dev-export").addEventListener("click", async () => {
    // Only export the checked rows. If nothing is ticked, do nothing and tell
    // the user — keeps the file deterministic instead of silently exporting
    // every record.
    const ids = [...devViewSelected]
      .filter((k) => k.startsWith("d:"))
      .map((k) => Number(k.slice(2)))
      .filter((n) => Number.isFinite(n));
    if (!ids.length) {
      openConfirmModal(
        "Nothing selected",
        "Tick the rows you want to export, then click Export Excel again.",
        () => {}
      );
      return;
    }
    try {
      const a = document.createElement("a");
      a.href = API + "/api/export/developments?ids=" + encodeURIComponent(ids.join(","));
      a.download = "developments.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      openConfirmModal("Export failed", err.message, () => {});
    }
  });

  const refreshBtn = panel.querySelector("#dev-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      const btn = refreshBtn;
      btn.disabled = true;
      btn.classList.add("spinning");
      try {
        // refresh the company master list cache so the Create screen's data is
        // also current on next open
        devCompaniesCache = await fetchJson(API + "/api/companies");
        viewCustomers = await fetchJson(API + "/api/customers");
        devViewData = await fetchJson(API + "/api/developments");
        paintDevelopmentView();
      } catch (err) {
        openConfirmModal("Refresh failed", err.message, () => {});
      } finally {
        btn.disabled = false;
        btn.classList.remove("spinning");
      }
    });
  }

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

  // Click any thumbnail in the Image column to open it in the centered lightbox.
  // (Only the thumbnail itself triggers the popup — its parent cell still
  // contains the row-select checkbox, which must keep working on click.)
  panel.querySelectorAll(".dev-view-thumb").forEach((img) => {
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      openImageLightbox(img.dataset.full, img.dataset.name);
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

  panel.querySelectorAll("[data-followup]").forEach((b) => {
    b.addEventListener("click", () => openFollowUpModal(Number(b.dataset.followup)));
  });
  panel.querySelectorAll("[data-status]").forEach((b) => {
    b.addEventListener("click", () => openFollowUpHistory(Number(b.dataset.status)));
  });
  panel.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => editDevelopmentInCreate(Number(b.dataset.edit)));
  });
  panel.querySelectorAll("[data-del]").forEach((b) => {
    b.addEventListener("click", () => deleteDevelopment(Number(b.dataset.del)));
  });
  panel.querySelectorAll("[data-details]").forEach((b) => {
    b.addEventListener("click", () => {
      const rec = devViewData.find((r) => r.id === Number(b.dataset.details));
      if (rec) openColorsViewPopup(rec);
    });
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
    },
    { danger: true }
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
    },
    { danger: true }
  );
}

// Clicking a Development status opens a two-column history popup: "Status" and
// "Created time". The initial "Created" row and one row per Follow Up are
// listed; clicking a Follow Up row opens the read-only detail popup.
async function openFollowUpHistory(devId) {
  const rec = devViewData.find((r) => r.id === devId) || {};
  let followups;
  try {
    followups = await fetchJson(API + `/api/developments/${devId}/followups`);
  } catch (err) {
    openConfirmModal("Load failed", err.message, () => {});
    return;
  }

  // Rows: the development's initial creation, then one per Follow Up.
  const rows = [{ status: "Created", time: rec.created_at || "", followup: null }];
  (followups || []).forEach((f) => rows.push({ status: f.category || "—", time: f.created_at || "", followup: f }));

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal followup-history-modal" role="dialog" aria-modal="true">
      <h3>Status History</h3>
      <p class="muted small">${escapeHtml(rec.item_name || "Development")} · ${escapeHtml(rec.company_name || "")}</p>
      <table class="followup-history-grid">
        <thead>
          <tr><th>Status</th><th>Created time</th></tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr class="${row.followup ? "fu-history-clickable" : "fu-history-plain"}">
              <td>${row.followup
                ? `<button type="button" class="link-btn followup-status-btn" data-fuid="${row.followup.id}" title="View follow-up details">${escapeHtml(row.status)}</button>`
                : `<span class="status-badge">${escapeHtml(row.status)}</span>`}</td>
              <td>${escapeHtml(row.time || "—")}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="actions modal-actions">
        <button class="btn primary" type="button" id="fu-history-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("#fu-history-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll("[data-fuid]").forEach((b) => {
    b.addEventListener("click", () => {
      const f = (followups || []).find((x) => x.id === Number(b.dataset.fuid));
      if (f) openFollowUpDetail(f);
    });
  });
}

// Read-only detail popup styled like the Follow Up form, showing one Follow
// Up's saved Category, Notes, Images and Documents.
function openFollowUpDetail(f) {
  const imgs = (f.image_names || []).map((n) =>
    `<img class="dev-thumb-sm create-thumb-img fud-thumb" src="${escapeHtml(assetUrl(n))}" alt="${escapeHtml(displayName(n))}" data-full="${escapeHtml(assetUrl(n))}" data-name="${escapeHtml(displayName(n))}" />`
  ).join("");
  const docs = (f.doc_names || []).map((n) =>
    `<a class="doc-tag" href="${escapeHtml(docUrl(n))}" target="_blank" rel="noopener" download title="${escapeHtml(n)}">📄 ${escapeHtml(displayName(n))}</a>`
  ).join("");

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal followup-modal" role="dialog" aria-modal="true">
      <h3>Follow Up Details <span class="muted small">${escapeHtml(f.created_at || "")}</span></h3>
      <div class="followup-frames">
        <div class="followup-frame">
          <label class="field-label">Category</label>
          <div class="fud-value"><span class="status-badge">${escapeHtml(f.category || "—")}</span></div>
          <label class="field-label">Notes</label>
          <div class="fud-note">${f.note ? escapeHtml(f.note) : `<span class="muted">No notes.</span>`}</div>
        </div>
        <div class="followup-frame">
          <label class="field-label">Images</label>
          ${imgs ? `<div class="dev-thumbs">${imgs}</div>` : `<span class="muted">—</span>`}
          <label class="field-label">Attachments</label>
          ${docs ? `<div class="followup-history-docs">${docs}</div>` : `<span class="muted">—</span>`}
        </div>
      </div>
      <div class="actions modal-actions">
        <button class="btn primary" type="button" id="fud-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("#fud-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll(".fud-thumb").forEach((img) => {
    img.addEventListener("click", () => openImageLightbox(img.dataset.full, img.dataset.name));
  });
}

// Follow Up modal: record a follow-up (managed option, note, images, docs)
// against a development. Images/docs are uploaded to /api/uploads immediately;
// only the returned "uploads/..." paths are persisted so they survive reloads.
async function openFollowUpModal(devId) {
  let rec = null;
  try {
    rec = await fetchJson(API + `/api/developments/${devId}`);
  } catch (err) {
    openConfirmModal("Load failed", err.message, () => {});
    return;
  }

  const images = [];   // { id, name, url, uploading }
  const docs = [];     // { id, name, url, file, uploading }
  const previousImagePasteTarget = activeImagePasteTarget;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal followup-modal" role="dialog" aria-modal="true">
      <h3>Follow Up · ${escapeHtml(rec.item_name || "")} <span class="muted small">${escapeHtml(rec.company_name || "")}</span></h3>
      <div class="followup-frames">
        <div class="followup-frame">
          <label class="field-label" for="fu-category">Category</label>
          <select id="fu-category" class="fu-input">
            ${opt("development", "follow_up").map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}
          </select>
          <label class="field-label" for="fu-note">Notes</label>
          <textarea id="fu-note" class="fu-input fu-note" placeholder="Enter follow-up notes…"></textarea>
        </div>
        <div class="followup-frame">
          <label class="field-label">Images</label>
          <div class="dropzone" id="fu-img-drop" tabindex="0">
            <div class="drop-region">
              <div class="drop-icon">🖼️</div>
              <p class="drop-hint">Drop images here, paste (Ctrl+V), or <button type="button" class="link-btn" id="fu-img-browse">browse</button></p>
            </div>
            <div class="thumb-grid" id="fu-img-thumbs"></div>
            <input type="file" id="fu-img-input" accept="image/*" multiple hidden />
          </div>
          <label class="field-label">Attachments</label>
          <div class="dropzone" id="fu-doc-drop">
            <div class="drop-region">
              <div class="drop-icon">📎</div>
              <p class="drop-hint">Drop documents here or <button type="button" class="link-btn" id="fu-doc-browse">browse</button></p>
            </div>
            <div id="fu-doc-list"></div>
            <input type="file" id="fu-doc-input" multiple hidden />
          </div>
        </div>
      </div>
      <div class="actions modal-actions">
        <button class="btn ghost" id="fu-cancel" type="button">Cancel</button>
        <button class="btn primary" id="fu-save" type="button">Save Follow Up</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const imageDrop = overlay.querySelector("#fu-img-drop");
  const imageThumbs = overlay.querySelector("#fu-img-thumbs");
  const isImageFile = (file) => file && file.type && file.type.startsWith("image/");
  const docDrop = overlay.querySelector("#fu-doc-drop");
  const docList = overlay.querySelector("#fu-doc-list");
  const saveBtn = overlay.querySelector("#fu-save");
  const closeModal = () => {
    overlay.remove();
    activeImagePasteTarget = previousImagePasteTarget;
  };

  const canSave = () => images.every((x) => !x.uploading) && docs.every((x) => !x.uploading);
  const refreshSave = () => { saveBtn.disabled = !canSave(); };

  const renderImageThumbs = () => {
    if (!images.length) {
      imageThumbs.innerHTML = "";
      imageDrop.classList.remove("has-items");
      return;
    }
    imageDrop.classList.add("has-items");
    imageThumbs.innerHTML = images.map((img) => `
      <div class="thumb" data-id="${img.id}">
        <img class="create-thumb-img" src="${img.url}" alt="${escapeHtml(img.name)}" data-full="${escapeHtml(img.url)}" data-name="${escapeHtml(img.name)}" />
        <div class="thumb-name">${escapeHtml(img.name)}</div>
        ${img.uploading ? '<span class="thumb-badge uploading">uploading…</span>' : ''}
        <button class="icon-btn danger thumb-rm" data-rm="${img.id}" title="Remove">✕</button>
      </div>`).join("");
    imageThumbs.querySelectorAll(".create-thumb-img").forEach((im) => {
      im.addEventListener("click", () => openImageLightbox(im.dataset.full, im.dataset.name));
    });
    imageThumbs.querySelectorAll("[data-rm]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.rm;
        const idx = images.findIndex((x) => x.id === id);
        if (idx >= 0) {
          if (images[idx].url && images[idx].url.startsWith("blob:")) URL.revokeObjectURL(images[idx].url);
          images.splice(idx, 1);
          renderImageThumbs();
          refreshSave();
        }
      });
    });
  };

  const addImageFile = (file) => {
    if (!isImageFile(file)) return;
    const id = "fu-img-" + Date.now() + "-" + images.length;
    images.push({ id, name: file.name, url: URL.createObjectURL(file), uploading: true });
    renderImageThumbs();
    uploadImageFile(file, id);
    refreshSave();
  };

  activeImagePasteTarget = { drop: imageDrop, add: addImageFile };

  const uploadImageFile = async (file, id) => {
    const entry = images.find((x) => x.id === id);
    if (!entry) return;
    try {
      const data = await uploadFile(file);
      entry.name = data.path;          // "uploads/<uuid>__<file>"
      entry.url = API + data.path;
      entry.uploading = false;
    } catch (err) {
      entry.uploading = false;
      openConfirmModal("Upload failed", "Could not upload image: " + err.message, () => {});
    }
    renderImageThumbs();
    refreshSave();
  };

  // image drag & drop, paste, browse (multiple images allowed)
  ["dragenter", "dragover"].forEach((ev) =>
    imageDrop.addEventListener(ev, (e) => { e.preventDefault(); imageDrop.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    imageDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === "dragleave" && imageDrop.contains(e.relatedTarget)) return;
      imageDrop.classList.remove("dragover");
    })
  );
  imageDrop.addEventListener("drop", (e) => { [...(e.dataTransfer?.files || [])].forEach(addImageFile); });
  imageDrop.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        addImageFile(it.getAsFile());
        e.preventDefault();
      }
    }
  });
  overlay.querySelector("#fu-img-browse").addEventListener("click", () => overlay.querySelector("#fu-img-input").click());
  overlay.querySelector("#fu-img-input").addEventListener("change", (e) => {
    [...(e.target.files || [])].forEach(addImageFile);
    e.target.value = "";
  });

  const renderDocList = () => {
    if (!docs.length) {
      docList.innerHTML = "";
      docDrop.classList.remove("has-items");
      return;
    }
    docDrop.classList.add("has-items");
    docList.innerHTML = docs.map((d) => {
      const downloadUrl = d.name ? docUrl(d.name) : (d.url || "");
      return `
      <div class="doc-row" data-id="${d.id}">
        <span class="doc-icon">📄</span>
        <span class="doc-name">${escapeHtml(displayName(d.name))}</span>
        <span class="doc-size muted small">${d.file ? formatBytes(d.file.size) : "saved"}</span>
        ${d.uploading ? '<span class="thumb-badge uploading">uploading…</span>' : ''}
        ${downloadUrl ? `<a class="doc-dl" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener" download title="Download ${escapeHtml(displayName(d.name))}">⬇</a>` : ""}
        <button class="icon-btn danger doc-rm" data-rm="${d.id}" title="Remove">✕</button>
      </div>`;
    }).join("");
    docList.querySelectorAll(".doc-rm").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.rm;
        const idx = docs.findIndex((x) => x.id === id);
        if (idx >= 0) { docs.splice(idx, 1); renderDocList(); refreshSave(); }
      });
    });
  };

  const addDocFiles = async (fileList) => {
    for (const f of fileList) {
      const id = "fu-doc-" + Date.now() + "-" + docs.length;
      const entry = { id, name: f.name, file: f, uploading: true };
      docs.push(entry);
      renderDocList();
      refreshSave();
      try {
        const r = await uploadFile(f);
        entry.name = r.path;          // "uploads/<uuid>__<file>"
        entry.url = API + r.path;
        entry.uploading = false;
      } catch (err) {
        entry.uploading = false;
        openConfirmModal("Upload failed", "Could not upload document: " + err.message, () => {});
      }
      renderDocList();
      refreshSave();
    }
  };

  // document drag & drop + browse (multiple documents allowed)
  ["dragenter", "dragover"].forEach((ev) =>
    docDrop.addEventListener(ev, (e) => { e.preventDefault(); docDrop.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    docDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === "dragleave" && docDrop.contains(e.relatedTarget)) return;
      docDrop.classList.remove("dragover");
    })
  );
  docDrop.addEventListener("drop", (e) => addDocFiles(e.dataTransfer?.files || []));
  overlay.querySelector("#fu-doc-browse").addEventListener("click", () => overlay.querySelector("#fu-doc-input").click());
  overlay.querySelector("#fu-doc-input").addEventListener("change", (e) => {
    addDocFiles(e.target.files || []);
    e.target.value = "";
  });

  overlay.querySelector("#fu-cancel").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  saveBtn.addEventListener("click", async () => {
    if (!canSave()) return;
    const payload = {
      category: overlay.querySelector("#fu-category").value || null,
      note: overlay.querySelector("#fu-note").value.trim() || null,
      image_names: images.map((x) => x.name),
      doc_names: docs.map((x) => x.name),
    };
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await fetchJson(API + `/api/developments/${devId}/followups`, { method: "POST", body: JSON.stringify(payload) });
      showToast("Follow up saved");
      closeModal();
      renderDevelopmentView();   // re-fetch so the Status column shows the new category
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Follow Up";
      openConfirmModal("Save failed", err.message, () => {});
    }
  });

  renderImageThumbs();
  renderDocList();
  refreshSave();
}

// Load an existing development into the Create screen (pre-filled) and switch
// the mini-tab to "edit" (red background / black text). Reuses devEditState so
// the Create renderer restores every field, then the Update button PUTs the
// record. The Edit tab keeps its OWN state separate from the Create tab.
async function editDevelopmentInCreate(id) {
  let rec;
  try {
    rec = await fetchJson(API + `/api/developments/${id}`);
  } catch (err) {
    openConfirmModal("Load failed", err.message, () => {});
    return;
  }

  // seed the Edit tab's own state from the record (never the Create draft)
  const s = devEditState;
  s.companyId = rec.company_id != null ? String(rec.company_id) : "";
  s.companyName = rec.company_name || "";
  s.memberId = rec.member_id != null ? String(rec.member_id) : "";
  s.memberName = rec.member_name || "";
  s.projectId = rec.project_id != null ? String(rec.project_id) : "";
  s.projectName = rec.project_name || "";
  s.item = rec.item_name || "";
  s.product = rec.product_type || "";

  // Part 3 details
  s.height = rec.height != null ? String(rec.height) : "";
  s.width = rec.width != null ? String(rec.width) : "";
  s.raisedHeight = rec.raised_height != null ? String(rec.raised_height) : "";
  s.noOfColor = rec.no_of_color != null ? String(rec.no_of_color) : "";
  s.pantones = Array.isArray(rec.pantones) ? rec.pantones.map((p) => ({ value: p.value || "", color: p.color || "#000000" })) : [];
  s.colorSides = isSplitColorProduct(rec.product_type) && rec.color_sides
    ? (typeof rec.color_sides === "string" ? parseColorSidesString(rec.color_sides) : (rec.color_sides || null))
    : null;

  // Part 4/5/6 — material & special (TBA structures) + remark (array of strings).
  s.material = rec.material != null ? rec.material : null;
  s.special = rec.special != null ? rec.special : null;
  s.remake = Array.isArray(rec.remake) ? rec.remake.slice() : [];

  // images — resolve each saved name to its servable URL (sample or upload).
  s.images = (rec.image_names || []).map((n) => ({
    id: "eimg-" + n,
    name: n,
    url: assetUrl(n),
  }));

  // documents — seed from saved doc_names. The bytes are gone after a reload,
  // so we keep just the name (file: null → shows "saved"). They re-link to the
  // persisted /uploads/ file when edited/saved again.
  s.docs = (rec.doc_names || []).map((name, i) => ({
    id: "edoc-" + rec.id + "-" + i,
    name,
    file: null,
  }));

  devEditMode = true;
  devEditId = rec.id;
  devOriginal = rec;   // keep the pristine record for dirty comparison
  openTab("development-edit");
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

  // Re-pull the factory map so Part 4 (Material) reflects the latest Settings /
  // Options edits before we render the Fabric/Folding dropdowns.
  await loadProductTypeFactory();

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
            ${opt("development","product_type").map((p) =>
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
      ${isSplitColorProduct(rec.product_type) ? `
      <div class="dim-row" style="grid-template-columns:1fr 1fr;">
        <div class="field">
          <label for="ed-nocolor-front">No. of color — Front</label>
          <input id="ed-nocolor-front" type="number" step="1" value="${escapeHtml((rec.color_sides && rec.color_sides.front && rec.color_sides.front.noOfColor) ?? "")}" />
        </div>
        <div class="field">
          <label for="ed-nocolor-back">No. of color — Back</label>
          <input id="ed-nocolor-back" type="number" step="1" value="${escapeHtml((rec.color_sides && rec.color_sides.back && rec.color_sides.back.noOfColor) ?? "")}" />
        </div>
      </div>
      ` : needsRaisedHeight(rec.product_type) ? `
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
      ` : `
      <div class="dim-row">
        <div class="field">
          <label for="ed-nocolor">No. of color</label>
          <input id="ed-nocolor" type="number" step="1" value="${escapeHtml(rec.no_of_color ?? "")}" />
        </div>
      </div>
      `}

      <h4 class="subhead">Images</h4>
      <div class="dropzone" id="ed-image-drop" tabindex="0">
        <div class="drop-region">
          <span class="drop-icon">🖼️</span>
          <p class="muted small drop-hint">Drag &amp; drop images here,<br/>or press <strong>Ctrl+V</strong> to paste.</p>
        </div>
        <div class="thumb-grid" id="ed-image-thumbs"></div>
      </div>

      <h4 class="subhead">Material</h4>
      ${(isScreenPrintProduct(rec.product_type) || hasProductTypeFactory(rec.product_type) || usesFactoryOnlyMaterial(rec.product_type)) ? `
      ${usesFactoryOnlyMaterial(rec.product_type) ? "" : `
      <div class="field">
        <label class="radio-label">Recycle</label>
        <div class="radio-row" id="ed-mat-recycle-row">
          <label class="radio-opt"><input type="radio" name="ed-mat-recycle" value="recycle" ${rec.material && rec.material.recycle === "recycle" ? "checked" : ""}/> recycle</label>
          <label class="radio-opt"><input type="radio" name="ed-mat-recycle" value="non-recycle" ${rec.material && rec.material.recycle === "non-recycle" ? "checked" : ""}/> non recycle</label>
        </div>
      </div>
      <div class="field">
        <label for="ed-mat-fabric">Fabric</label>
        <select id="ed-mat-fabric">
          <option value="">— select —</option>
          ${fabricOptionsFor(rec.product_type, rec.material && rec.material.fabric).map((f) => `<option value="${escapeHtml(f)}" ${rec.material && rec.material.fabric === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
        </select>
        <span class="hint">${hasProductTypeFactory(rec.product_type) ? `Options for ${escapeHtml(rec.product_type)}` : ""}</span>
      </div>
      <div class="field">
        <label class="radio-label">Edge</label>
        <div class="radio-row" id="ed-mat-edge-row">
          <label class="radio-opt"><input type="radio" name="ed-mat-edge" value="slit" ${rec.material && rec.material.edge === "slit" ? "checked" : ""}/> slit edge</label>
          <label class="radio-opt"><input type="radio" name="ed-mat-edge" value="woven" ${rec.material && rec.material.edge === "woven" ? "checked" : ""}/> woven edge</label>
        </div>
      </div>
      <div class="field">
        <label for="ed-mat-folding">Folding</label>
        <div class="folding-row">
          <select id="ed-mat-folding">
            <option value="">— select —</option>
            ${foldingOptionsFor(rec.product_type, rec.material && rec.material.folding).map((f) => `<option value="${escapeHtml(f)}" ${rec.material && rec.material.folding === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
          </select>
          <img id="ed-mat-folding-img" class="folding-preview" alt="" ${rec.material && rec.material.folding && foldingImage(rec.material.folding) ? `src="${foldingImage(rec.material.folding)}" onerror="this.style.display='none'"` : ""} style="${rec.material && rec.material.folding && foldingImage(rec.material.folding) ? "" : "display:none;"}"/>
        </div>
        <span class="hint">${hasProductTypeFactory(rec.product_type) ? `Options for ${escapeHtml(rec.product_type)}` : ""}</span>
      </div>
      `}
      ${materialExtraListFields(rec.product_type, rec.material)}
      ` : `
      <div class="field">
        <p class="muted small">Material details to be confirmed (TBA).</p>
      </div>
      `}

      <h4 class="subhead">Special</h4>
      <div class="field">
        <label class="radio-label">Variable</label>
        <div class="radio-row" id="ed-spec-variable-row">
          <label class="radio-opt"><input type="radio" name="ed-spec-variable" value="variable" ${rec.special && rec.special.variable === "variable" ? "checked" : ""}/> variable</label>
          <label class="radio-opt"><input type="radio" name="ed-spec-variable" value="non-variable" ${rec.special && rec.special.variable === "non-variable" ? "checked" : ""}/> non variable</label>
        </div>
      </div>

      <h4 class="subhead">Remark</h4>
      <div class="field">
        <div class="remake-input-row">
          <input id="ed-remark-input" type="text" autocomplete="off" placeholder="Type a remark, then press Add…" />
          <button type="button" class="btn ghost" id="ed-remark-add">Add</button>
        </div>
        <ul class="remake-list" id="ed-remark-list"></ul>
      </div>

      <h4 class="subhead">Documents <span class="req-mark optional">optional</span></h4>
      <div class="dropzone" id="ed-doc-drop" tabindex="0">
        <div class="drop-region">
          <span class="drop-icon">📁</span>
          <p class="muted small drop-hint">Drag &amp; drop multiple files here.</p>
        </div>
        <div class="file-list" id="ed-doc-list"></div>
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
        ${img.url ? `<img class="edit-thumb-img" src="${img.url}" alt="${escapeHtml(img.name)}" data-full="${escapeHtml(img.url)}" data-name="${escapeHtml(img.name)}" />` : `<div class="thumb-name">${escapeHtml(img.name)}</div>`}
        <div class="thumb-name">${escapeHtml(img.name)}</div>
        <button class="icon-btn danger thumb-rm" data-rm="${img.id}" title="Remove">✕</button>
      </div>`).join("");
    wrap.querySelectorAll(".edit-thumb-img").forEach((im) => {
      im.addEventListener("click", () => openImageLightbox(im.dataset.full, im.dataset.name));
    });
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

  // ---- Documents list with download links (reuses the same model/helpers) ----
  const docDrop = overlay.querySelector("#ed-doc-drop");
  const docList = overlay.querySelector("#ed-doc-list");
  // Seed from saved doc_names; bytes are gone after a reload, but the persisted
  // /uploads/ path still resolves to a downloadable file.
  const editDocs = (rec.doc_names || []).map((name, i) => ({
    id: "edoc-" + id + "-" + i,
    name,
    file: null,
  }));

  const renderEditDocList = () => {
    if (!editDocs.length) {
      docList.innerHTML = "";
      docDrop.classList.remove("has-items");
      return;
    }
    docDrop.classList.add("has-items");
    docList.innerHTML = editDocs.map((d) => {
      const downloadUrl = d.name && d.name.startsWith("uploads/")
        ? assetUrl(d.name)
        : (d.url || "");
      const dlLink = downloadUrl
        ? `<a class="doc-dl" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener" download title="Download ${escapeHtml(displayName(d.name))}">⬇ Download attached doc</a>`
        : "";
      return `
      <div class="doc-row" data-id="${d.id}">
        <span class="doc-icon">📄</span>
        <span class="doc-name-text">${escapeHtml(displayName(d.name))}</span>
        ${d.uploading ? '<span class="thumb-badge uploading">uploading…</span>' : ''}
        ${dlLink}
        <button class="icon-btn danger doc-rm" data-rm="${d.id}" title="Remove">✕</button>
      </div>`;
    }).join("");
    docList.querySelectorAll(".doc-rm").forEach((b) => {
      b.addEventListener("click", () => {
        const idx = editDocs.findIndex((x) => x.id === b.dataset.rm);
        if (idx >= 0) editDocs.splice(idx, 1);
        renderEditDocList();
      });
    });
  };
  renderEditDocList();

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

  // Documents can also be added by dropping files into the doc zone.
  const docDropEl = overlay.querySelector("#ed-doc-drop");
  const addDocFile = async (file) => {
    const entry = { id: "edoc-" + id + "-" + editDocs.length, name: file.name, file, uploading: true };
    editDocs.push(entry);
    renderEditDocList();
    try {
      const r = await uploadFile(file);
      entry.name = r.path;
      entry.url = API + r.path;
      entry.uploading = false;
    } catch (err) {
      entry.uploading = false;
      openConfirmModal("Upload failed", "Could not upload document: " + err.message, () => {});
    }
    renderEditDocList();
  };
  ["dragenter", "dragover"].forEach((ev) => docDropEl.addEventListener(ev, (e) => { e.preventDefault(); docDropEl.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) => docDropEl.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && docDropEl.contains(e.relatedTarget)) return;
    docDropEl.classList.remove("dragover");
  }));
  docDropEl.addEventListener("drop", (e) => { [...(e.dataTransfer?.files || [])].forEach((f) => { if (f.type && !f.type.startsWith("image/")) addDocFile(f); }); });

  // ---- Remark list (array of free-text strings, stored in DB `remake`) ----
  const remarkInput = overlay.querySelector("#ed-remark-input");
  const remarkAddBtn = overlay.querySelector("#ed-remark-add");
  const remarkList = overlay.querySelector("#ed-remark-list");
  const editRemarks = Array.isArray(rec.remake) ? rec.remake.slice() : [];
  const renderRemarks = () => {
    if (!editRemarks.length) {
      remarkList.innerHTML = `<li class="remake-empty muted small">No remarks yet.</li>`;
      return;
    }
    remarkList.innerHTML = editRemarks.map((note, i) => `
      <li class="remake-item">
        <span class="remake-text">${escapeHtml(note)}</span>
        <button type="button" class="icon-btn danger remark-rm" data-idx="${i}" title="Remove">✕</button>
      </li>`).join("");
    remarkList.querySelectorAll(".remark-rm").forEach((b) => {
      b.addEventListener("click", () => {
        const i = Number(b.dataset.idx);
        if (i >= 0 && i < editRemarks.length) {
          editRemarks.splice(i, 1);
          renderRemarks();
        }
      });
    });
  };
  const addRemark = () => {
    const v = remarkInput.value.trim();
    if (!v) return;
    editRemarks.push(v);
    remarkInput.value = "";
    renderRemarks();
  };
  if (remarkAddBtn) remarkAddBtn.addEventListener("click", addRemark);
  if (remarkInput) remarkInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addRemark(); }
  });
  renderRemarks();

  const edFoldingSelect = overlay.querySelector("#ed-mat-folding");
  const edFoldingImg = overlay.querySelector("#ed-mat-folding-img");
  const edFabricSelect = overlay.querySelector("#ed-mat-fabric");
  if (edFoldingSelect && edFoldingImg) {
    edFoldingSelect.addEventListener("change", () => {
      const imgSrc = foldingImage(edFoldingSelect.value);
      if (imgSrc) {
        edFoldingImg.src = imgSrc;
        edFoldingImg.style.display = "";
      } else {
        edFoldingImg.removeAttribute("src");
        edFoldingImg.style.display = "none";
      }
    });
  }
  // When the product type changes in the Edit modal, re-scope the Fabric /
  // Folding dropdowns to that product's factory set. A previously-saved value
  // that's no longer valid for the new product is reset to "— select —".
  const edProductSelect = overlay.querySelector("#ed-product");
  if (edProductSelect && edFabricSelect && edFoldingSelect) {
    edProductSelect.addEventListener("change", () => {
      const product = edProductSelect.value;
      const validFabric = fabricOptionsFor(product, null);
      const validFolding = foldingOptionsFor(product, null);
      const curFabric = edFabricSelect.value;
      const curFolding = edFoldingSelect.value;
      edFabricSelect.innerHTML = `<option value="">— select —</option>` +
        validFabric.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
      edFoldingSelect.innerHTML = `<option value="">— select —</option>` +
        validFolding.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
      edFabricSelect.value = validFabric.includes(curFabric) ? curFabric : "";
      const keepFolding = validFolding.includes(curFolding) ? curFolding : "";
      edFoldingSelect.value = keepFolding;
      const imgSrc = foldingImage(keepFolding);
      if (imgSrc) {
        edFoldingImg.src = imgSrc;
        edFoldingImg.style.display = "";
      } else {
        edFoldingImg.removeAttribute("src");
        edFoldingImg.style.display = "none";
      }
    });
  }

  overlay.querySelector("#ed-cancel").addEventListener("click", () => overlay.remove());

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
      raised_height: needsRaisedHeight(product_type) ? overlay.querySelector("#ed-raised")?.value || null : null,
      no_of_color: isSplitColorProduct(product_type) ? null : overlay.querySelector("#ed-nocolor").value || null,
      pantones: isSplitColorProduct(product_type) ? [] : (rec.pantones || []),
      color_sides: isSplitColorProduct(product_type) ? {
        front: { noOfColor: overlay.querySelector("#ed-nocolor-front")?.value || "", pantones: (rec.color_sides && rec.color_sides.front && rec.color_sides.front.pantones) || [] },
        back: { noOfColor: overlay.querySelector("#ed-nocolor-back")?.value || "", pantones: (rec.color_sides && rec.color_sides.back && rec.color_sides.back.pantones) || [] },
      } : null,
      image_names: editImages.map((i) => i.name),
      doc_names: editDocs.map((d) => d.name),
      material: (isScreenPrintProduct(product_type) || hasProductTypeFactory(product_type) || usesFactoryOnlyMaterial(product_type)) ? {
        recycle: overlay.querySelector('input[name="ed-mat-recycle"]:checked')?.value || null,
        fabric: overlay.querySelector("#ed-mat-fabric")?.value || null,
        edge: overlay.querySelector('input[name="ed-mat-edge"]:checked')?.value || null,
        folding: overlay.querySelector("#ed-mat-folding")?.value || null,
        ...(() => {
          const lists = materialExtraListValues(overlay, product_type, rec.material);
          return lists ? { lists } : {};
        })(),
      } : (rec.material != null ? rec.material : null),
      special: {
        variable: overlay.querySelector('input[name="ed-spec-variable"]:checked')?.value || null,
      },
      remake: editRemarks.slice().sort(),
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
// Enquiry / View
// ---------------------------------------------------------------------------

let enqViewData = [];
let enqViewFilters = {};
let enqViewSelected = new Set();

async function renderEnquiryView() {
  panel.innerHTML = '<h2>Enquiry / View</h2><p class="empty">Loading…</p>';
  enqViewSelected.clear();
  try {
    const [enqs, companies] = await Promise.all([
      await fetchJson(API + "/api/enquiries"),
      (async () => { try { return await fetchJson(API + "/api/companies"); } catch { return null; } })(),
    ]);
    enqViewData = enqs;
    if (companies) devCompaniesCache = companies;
    if (!enqViewData.length) {
      panel.innerHTML = '<h2>Enquiry / View</h2><p class="empty">No enquiries saved yet.</p>';
      return;
    }
    paintEnquiryView();
  } catch (err) {
    panel.innerHTML = `<h2>Enquiry / View</h2><p class="empty">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

function paintEnquiryView() {
  // Enquiry / View mirrors Development / View exactly: same columns, same
  // rendering helpers (devDetailsSummary for Details, assetUrl/docUrl for media).
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

  const shown = enqViewData.filter((r) =>
    searchCols.every((c) => fuzzyMatch(r[c.key], enqViewFilters[c.key]))
  );

  const allKeys = shown.map((r) => "e:" + r.id);
  const allChecked = allKeys.length > 0 && allKeys.every((k) => enqViewSelected.has(k));

  const searchRow = cols.map((c) => {
    if (c.key === "image" || c.key === "documents" || c.key === "details") {
      return `<th class="search-th"></th>`;
    }
    return `<th class="search-th">
       <input class="col-search" data-key="${c.key}" type="text"
              placeholder="Search ${c.label}…" value="${escapeHtml(enqViewFilters[c.key] || "")}" />
     </th>`;
  }).join("") + `<th class="search-th actions-th"></th>`;

  const body = shown.map((r) => {
    const checked = enqViewSelected.has("e:" + r.id);
    const imgs = (r.image_names || []).slice(0, 3);
    const thumbs = imgs.length
      ? `<div class="dev-thumbs">` + imgs.map((n) =>
          `<img class="dev-thumb-sm" src="${assetUrl(n)}" alt="${escapeHtml(n)}" title="${escapeHtml(n)}" />`).join("") + `</div>`
      : `<span class="muted">—</span>`;
    const docs = (r.doc_names || []).map((n) =>
      `<a class="doc-tag" href="${docUrl(n)}" target="_blank" rel="noopener" download title="${escapeHtml(n)}">📄 ${escapeHtml(displayName(n))}</a>`).join("");
    const docLinks = docs || `<span class="muted">—</span>`;
    return `
      <tr class="${checked ? "selected" : ""}">
        <td>
          <label class="cb-cell">
            <input type="checkbox" class="row-select" data-key="e:${r.id}" ${checked ? "checked" : ""} />
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
      <h2>Enquiry / View</h2>
      <div class="view-actions">
        <button class="btn ghost" id="enq-refresh" type="button" title="Refresh customer database">⟳ Refresh</button>
        <button class="btn ghost" id="enq-export" type="button">Export Excel</button>
      </div>
    </div>

    <div class="batch-bar" id="batch-bar">
      <label class="cb-cell">
        <input type="checkbox" id="select-all" ${allChecked ? "checked" : ""} />
        <span>Select all (${allKeys.length})</span>
      </label>
      <span class="muted batch-count" id="batch-count">${enqViewSelected.size} selected</span>
      <button class="btn danger" id="batch-delete" type="button" disabled>Delete selected</button>
    </div>

    <table class="grid dev-grid" id="enquiry-grid">
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

  panel.querySelectorAll(".col-search").forEach((inp) => {
    inp.addEventListener("input", () => {
      enqViewFilters[inp.dataset.key] = inp.value;
      const cursor = inp.selectionStart;
      paintEnquiryView();
      const same = panel.querySelector(`.col-search[data-key="${inp.dataset.key}"]`);
      if (same) { same.focus(); same.setSelectionRange(cursor, cursor); }
    });
  });

  const refreshBtn = panel.querySelector("#enq-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.classList.add("spinning");
      try {
        devCompaniesCache = await fetchJson(API + "/api/companies");
        enqViewData = await fetchJson(API + "/api/enquiries");
        paintEnquiryView();
      } catch (err) {
        openConfirmModal("Refresh failed", err.message, () => {});
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove("spinning");
      }
    });
  }

  const enqExportBtn = panel.querySelector("#enq-export");
  if (enqExportBtn) {
    enqExportBtn.addEventListener("click", async () => {
      try {
        const a = document.createElement("a");
        a.href = API + "/api/export/enquiries";
        a.download = "enquiries.xlsx";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        openConfirmModal("Export failed", err.message, () => {});
      }
    });
  }

  const selectAll = panel.querySelector("#select-all");
  const batchDelete = panel.querySelector("#batch-delete");
  const batchCount = panel.querySelector("#batch-count");

  const syncBatchUI = () => {
    batchCount.textContent = enqViewSelected.size + " selected";
    batchDelete.disabled = enqViewSelected.size === 0;
    selectAll.checked = allKeys.length > 0 && allKeys.every((k) => enqViewSelected.has(k));
  };

  panel.querySelectorAll(".row-select").forEach((cb) => {
    cb.addEventListener("change", () => {
      const key = cb.dataset.key;
      if (cb.checked) enqViewSelected.add(key);
      else enqViewSelected.delete(key);
      panel.querySelectorAll(`.row-select[data-key="${key}"]`).forEach((sib) => {
        sib.checked = cb.checked;
        const tr = sib.closest("tr");
        if (tr) tr.classList.toggle("selected", cb.checked);
      });
      syncBatchUI();
    });
  });

  selectAll.addEventListener("change", () => {
    if (selectAll.checked) allKeys.forEach((k) => enqViewSelected.add(k));
    else allKeys.forEach((k) => enqViewSelected.delete(k));
    panel.querySelectorAll(".row-select").forEach((cb) => {
      cb.checked = selectAll.checked;
      const tr = cb.closest("tr");
      if (tr) tr.classList.toggle("selected", selectAll.checked);
    });
    syncBatchUI();
  });

  batchDelete.addEventListener("click", batchDeleteEnquiries);

  panel.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => editEnquiryInEdit(Number(b.dataset.edit)));
  });
  panel.querySelectorAll("[data-del]").forEach((b) => {
    b.addEventListener("click", () => deleteEnquiry(Number(b.dataset.del)));
  });
}

async function batchDeleteEnquiries() {
  const keys = [...enqViewSelected];
  if (!keys.length) return;
  const ids = keys.filter((k) => k.startsWith("e:")).map((k) => Number(k.slice(2)));
  if (!ids.length) return;
  openConfirmModal(
    "Delete enquiries?",
    `Delete ${ids.length} enquir${ids.length === 1 ? "y" : "ies"} permanently?`,
    async () => {
      const btn = panel.querySelector("#batch-delete");
      if (btn) { btn.disabled = true; btn.textContent = "Deleting…"; }
      let failed = 0;
      for (const id of ids) {
        try { await fetchJson(API + `/api/enquiries/${id}`, { method: "DELETE" }); }
        catch (err) { failed++; }
      }
      if (failed) openConfirmModal("Partial failure", `${failed} deletion(s) failed.`, () => {});
      enqViewSelected.clear();
      await renderEnquiryView();
    },
    { danger: true }
  );
}

async function deleteEnquiry(id) {
  const rec = enqViewData.find((r) => r.id === id);
  const label = rec ? `${rec.company_name}${rec.project_name ? " / " + rec.project_name : ""}` : `#${id}`;
  openConfirmModal(
    "Delete enquiry?",
    `Delete "${label}" permanently?`,
    async () => {
      try {
        await fetchJson(API + `/api/enquiries/${id}`, { method: "DELETE" });
        enqViewSelected.delete("e:" + id);
        await renderEnquiryView();
      } catch (err) {
        openConfirmModal("Delete failed", err.message, () => {});
      }
    },
    { danger: true }
  );
}

// Load an existing enquiry into the Enquiry / Edit tab (its own state +
// mini-tab), mirroring editDevelopmentInCreate for Development.
async function editEnquiryInEdit(id) {
  let rec;
  try {
    rec = await fetchJson(API + `/api/enquiries/${id}`);
  } catch (err) {
    openConfirmModal("Load failed", err.message, () => {});
    return;
  }

  // seed the Edit tab's own state from the record (never the Create draft)
  const s = enquiryEditState;
  s.companyId = rec.company_id != null ? String(rec.company_id) : "";
  s.companyName = rec.company_name || "";
  s.memberId = rec.member_id != null ? String(rec.member_id) : "";
  s.memberName = rec.member_name || "";
  // headup is a free-text field — show whatever name was previously saved.
  // (Old project_id associations are dropped; only the name string is kept.)
  s.projectId = "";
  s.projectName = rec.project_name || "";
  s.item = rec.item_name || "";
  s.product = rec.product_type || "";
  s.height = rec.height != null ? String(rec.height) : "";
  s.width = rec.width != null ? String(rec.width) : "";
  s.raisedHeight = rec.raised_height != null ? String(rec.raised_height) : "";
  s.noOfColor = rec.no_of_color != null ? String(rec.no_of_color) : "";
  s.pantones = Array.isArray(rec.pantones)
    ? rec.pantones.map((p) => ({ value: p.value || "", color: p.color || "#000000" }))
    : [];
  s.colorSides = isSplitColorProduct(rec.product_type) && rec.color_sides
    ? (typeof rec.color_sides === "string" ? parseColorSidesString(rec.color_sides) : (rec.color_sides || null))
    : null;

  // images — resolve each saved name to its servable URL
  s.images = (rec.image_names || []).map((n) => ({
    id: "eimg-" + n,
    name: n,
    url: assetUrl(n),
  }));

  // documents — bare names resolve under /uploads/ on the server
  s.docs = (rec.doc_names || []).map((name, i) => ({
    id: "edoc-" + rec.id + "-" + i,
    name,
    file: null,
  }));

  enquiryEditMode = true;
  enquiryEditId = rec.id;
  enquiryOriginal = rec;   // keep the pristine record for dirty comparison
  openTab("enquiry-edit");
}

// ---------------------------------------------------------------------------
// Customer / View
// ---------------------------------------------------------------------------

// View state
let viewCustomers = [];      // raw data from /api/customers
let viewFilters = {};         // {company, name, email, title, tel}
let viewSelected = new Set(); // selected keys: "c:<companyId>" or "m:<memberId>"

// Customer / Edit session state (mirrors the Development edit model).
// `custEdit` holds the working copy (every edit goes here); `custOriginal`
// holds the pristine record so each section's Reset restores only itself and
// the dirty-state is computed per section.
let custEditMode = false;
let custEditId = null;
let custOriginal = null;     // pristine { name, email_suffix, currency, payment_term, shipment_term, members[], ship_to[], projects[] }
let custEdit = {
  name: "",
  emailSuffix: "",
  currency: "",
  payment: "",
  shipment: "",
  members: [],    // [{ id, name, email_prefix, title, tel, _new? }]
  shipTo: [],     // [{ id, address, is_default }]
  projects: [],   // [{ id, name }]
};

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
    { key: "currency", label: "Currency" },
    { key: "payment_term", label: "Payment Term" },
    { key: "shipment_term", label: "Shipment Term" },
    { key: "ship_to", label: "Ship To" },
    { key: "projects", label: "Projects" },
  ];

  const rows = [];
  viewCustomers.forEach((c) => {
    const members = c.members && c.members.length ? c.members : [null];
    const shipTo = (c.ship_to || []).map((s) => s.address).join(" | ");
    const projects = (c.projects || []).map((p) => p.name).join(", ");
    members.forEach((m) => {
      rows.push({
        companyId: c.id,
        company: c.name,
        emailSuffix: c.email_suffix,
        currency: c.currency || "",
        payment_term: c.payment_term || "",
        shipment_term: c.shipment_term || "",
        shipTo,
        projects,
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
         <button class="icon-btn danger" data-del-member="${r.memberId}" title="Delete member">🗑</button>`
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
        <td>${escapeHtml(r.currency)}</td>
        <td>${escapeHtml(r.payment_term)}</td>
        <td>${escapeHtml(r.shipment_term)}</td>
        <td>${escapeHtml(r.shipTo)}</td>
        <td>${escapeHtml(r.projects)}</td>
        <td class="row-actions">${editBtn}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="12" class="muted">No matches.</td></tr>`;

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

  panel.querySelector("#export-xlsx").addEventListener("click", async () => {
    try {
      const a = document.createElement("a");
      a.href = API + "/api/export/customers";
      a.download = "customers.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      openConfirmModal("Export failed", err.message, () => {});
    }
  });

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
    b.addEventListener("click", () => openCustomerEdit(Number(b.dataset.edit)));
  });
  panel.querySelectorAll("[data-del-company]").forEach((b) => {
    b.addEventListener("click", () => deleteCompany(Number(b.dataset.delCompany)));
  });
  panel.querySelectorAll("[data-del-member]").forEach((b) => {
    b.addEventListener("click", () => removeMember(Number(b.dataset.delMember)));
  });
}

// helper: are all selectable company keys currently selected?

async function deleteCompany(companyId) {
  const company = viewCustomers.find((c) => c.id === companyId);
  const name = company ? company.name : ("#" + companyId);
  const count = company ? (company.members || []).length : 0;
  openConfirmModal(
    "Delete company",
    `Delete company "${name}"${count ? ` and its ${count} member(s)` : ""}?`,
    async () => {
      try {
        await fetchJson(API + `/api/companies/${companyId}`, { method: "DELETE" });
        viewSelected.delete("c:" + companyId);
        await renderCustomerView();
      } catch (err) {
        showToast("Delete failed: " + err.message, true);
      }
    }
  );
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
// Customer / Edit  — mini-tab (red "customer edit")
//   Loads the saved customer and exposes four sections (Company / Member /
//   Ship to / Project). Each section has its own Update (commits only that
//   section) and Reset (restores only that section from custOriginal).
// ---------------------------------------------------------------------------

// Load a saved customer into the edit session and open the red mini-tab.
async function openCustomerEdit(companyId) {
  let rec;
  try {
    rec = await fetchJson(API + `/api/companies/${companyId}`);
  } catch (err) {
    openConfirmModal("Load failed", err.message, () => {});
    return;
  }
  custOriginal = {
    name: rec.name || "",
    email_suffix: rec.email_suffix || "",
    currency: rec.currency || "",
    payment_term: rec.payment_term || "",
    shipment_term: rec.shipment_term || "",
    members: (rec.members || []).map((m) => ({ ...m })),
    ship_to: (rec.ship_to || []).map((s) => ({ ...s })),
    projects: (rec.projects || []).map((p) => ({ ...p })),
  };
  seedCustEditFromOriginal();
  custEditMode = true;
  custEditId = rec.id;
  openTab("customer-edit");
}

// Copy custOriginal -> custEdit (fresh working copy, no shared references).
function seedCustEditFromOriginal() {
  custEdit = {
    name: custOriginal.name,
    emailSuffix: custOriginal.email_suffix,
    currency: custOriginal.currency,
    payment: custOriginal.payment_term,
    shipment: custOriginal.shipment_term,
    members: custOriginal.members.map((m) => ({ id: m.id, name: m.name, email_prefix: m.email_prefix, title: m.title, tel: m.tel })),
    shipTo: custOriginal.ship_to.map((s) => ({ id: s.id, address: s.address, is_default: !!s.is_default })),
    projects: custOriginal.projects.map((p) => ({ id: p.id, name: p.name })),
  };
}

// Render the whole Customer / Edit screen (subtabs + 4 sections).
async function renderCustomerEdit() {
  if (!custEditMode || custEditId == null) {
    panel.innerHTML = '<h2>Customer / Edit</h2><p class="empty">Open a customer from Customer / View to edit it.</p>';
    return;
  }
  const companyId = custEditId;

  panel.innerHTML = `
    <h2>Customer / Edit</h2>
    <p class="ctx">Editing: <strong>${escapeHtml(custEdit.name)}</strong>
       <span class="muted">(email suffix @${escapeHtml(custEdit.emailSuffix)})</span></p>

    <div class="subtabs" id="custSubtabs" role="tablist">
      <button class="subtab active" data-step="company" role="tab">Company</button>
      <button class="subtab" data-step="member" role="tab">Member</button>
      <button class="subtab" data-step="shipto" role="tab">Ship to</button>
      <button class="subtab" data-step="project" role="tab">Project</button>
    </div>

    <div class="subpanel" id="cust-company"></div>
    <div class="subpanel" id="cust-member" style="display:none"></div>
    <div class="subpanel" id="cust-shipto" style="display:none"></div>
    <div class="subpanel" id="cust-project" style="display:none"></div>
  `;

  const subtabs = panel.querySelector("#custSubtabs");
  const switchTab = (step) => {
    subtabs.querySelectorAll(".subtab").forEach((t) =>
      t.classList.toggle("active", t.dataset.step === step));
    ["company", "member", "shipto", "project"].forEach((s) => {
      const sec = panel.querySelector("#cust-" + s);
      if (sec) sec.style.display = s === step ? "" : "none";
    });
  };
  subtabs.querySelectorAll(".subtab").forEach((t) => {
    t.addEventListener("click", () => switchTab(t.dataset.step));
  });

  renderCustCompanySection(companyId);
  renderCustMemberSection(companyId);
  renderCustShipToSection(companyId);
  renderCustProjectSection(companyId);

  switchTab("company");
}

// --- Company section ---------------------------------------------------------
function renderCustCompanySection(companyId) {
  const sec = panel.querySelector("#cust-company");
  if (!sec) return;
  sec.innerHTML = `
    <div class="field">
      <label for="ce-name">Company name</label>
      <input id="ce-name" type="text" value="${escapeHtml(custEdit.name)}" autocomplete="off" />
    </div>
    <div class="field">
      <label for="ce-suffix">Company email suffix <span class="hint">(no “@”)</span></label>
      <div class="input-affix">
        <span class="at">@</span>
        <input id="ce-suffix" type="text" value="${escapeHtml(custEdit.emailSuffix)}" autocomplete="off" />
      </div>
    </div>
    <div class="field">
      <label for="ce-currency">Currency</label>
      <select id="ce-currency">
        <option value="">— select —</option>
        ${opt("customer","currency").map((c) => `<option value="${escapeHtml(c)}" ${c === custEdit.currency ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label for="ce-payment">Payment term</label>
      <select id="ce-payment">
        <option value="">— select —</option>
        ${opt("customer","payment_term").map((p) => `<option value="${escapeHtml(p)}" ${p === custEdit.payment ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label for="ce-shipment">Shipment term</label>
      <select id="ce-shipment">
        <option value="">— select —</option>
        ${opt("customer","shipment_term").map((s) => `<option value="${escapeHtml(s)}" ${s === custEdit.shipment ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
      </select>
    </div>
    <div class="actions create-final">
      <button class="btn ghost" id="ce-reset" type="button">Reset</button>
      <button class="btn primary" id="ce-update" type="button">Update</button>
    </div>
  `;

  const nameEl = sec.querySelector("#ce-name");
  const suffixEl = sec.querySelector("#ce-suffix");
  const currEl = sec.querySelector("#ce-currency");
  const payEl = sec.querySelector("#ce-payment");
  const shipEl = sec.querySelector("#ce-shipment");
  const updateBtn = sec.querySelector("#ce-update");
  const resetBtn = sec.querySelector("#ce-reset");

  const isDirty = () =>
    nameEl.value.trim() !== custEdit.name ||
    suffixEl.value.trim().replace(/^@/, "") !== custEdit.emailSuffix ||
    currEl.value !== custEdit.currency ||
    payEl.value !== custEdit.payment ||
    shipEl.value !== custEdit.shipment;
  const refreshState = () => { updateBtn.disabled = !isDirty(); resetBtn.disabled = !isDirty(); };
  [nameEl, suffixEl, currEl, payEl, shipEl].forEach((el) => el.addEventListener("input", refreshState));
  refreshState();

  resetBtn.addEventListener("click", () => {
    nameEl.value = custEdit.name;
    suffixEl.value = custEdit.emailSuffix;
    currEl.value = custEdit.currency;
    payEl.value = custEdit.payment;
    shipEl.value = custEdit.shipment;
    refreshState();
  });

  updateBtn.addEventListener("click", async () => {
    if (updateBtn.disabled) return;
    const name = nameEl.value.trim();
    const suffix = suffixEl.value.trim().replace(/^@/, "");
    if (!name || !suffix) { openConfirmModal("Missing", "Company name and email suffix are required.", () => {}); return; }
    updateBtn.disabled = true;
    updateBtn.textContent = "Updating…";
    try {
      await apiPutCompany(companyId, name, suffix, {
        currency: currEl.value || null,
        payment_term: payEl.value || null,
        shipment_term: shipEl.value || null,
      });
      custEdit.name = name;
      custEdit.emailSuffix = suffix;
      custEdit.currency = currEl.value;
      custEdit.payment = payEl.value;
      custEdit.shipment = shipEl.value;
      custOriginal.name = name;
      custOriginal.email_suffix = suffix;
      custOriginal.currency = currEl.value;
      custOriginal.payment_term = payEl.value;
      custOriginal.shipment_term = shipEl.value;
      updateBtn.textContent = "Updated ✓";
      refreshState();
    } catch (err) {
      updateBtn.textContent = "Update";
      updateBtn.disabled = false;
      openConfirmModal("Update failed", err.message, () => {});
    }
  });
}

// --- Member section ----------------------------------------------------------
function renderCustMemberSection(companyId) {
  const sec = panel.querySelector("#cust-member");
  if (!sec) return;

  const renderMemberList = () => {
    const listEl = sec.querySelector("#cem-list");
    if (!custEdit.members.length) {
      listEl.innerHTML = '<p class="muted small">No members.</p>';
    } else {
      listEl.innerHTML = custEdit.members.map((m, i) => `
        <div class="member-row">
          <span><strong data-f="name" data-i="${i}">${escapeHtml(m.name)}</strong>
            <span class="muted" data-f="email" data-i="${i}">${escapeHtml(m.email_prefix)}@${escapeHtml(custEdit.emailSuffix)}</span></span>
          <span class="muted">
            <span data-f="title" data-i="${i}">${escapeHtml(m.title)}</span> ·
            <span data-f="tel" data-i="${i}">${escapeHtml(m.tel)}</span>
          </span>
          <button class="icon-btn danger" data-rm="${i}" title="Remove">✕</button>
        </div>`).join("");
      listEl.querySelectorAll("[data-rm]").forEach((b) => {
        b.addEventListener("click", () => {
          const i = Number(b.dataset.rm);
          const m = custEdit.members[i];
          // confirm only for already-saved members (persisted delete)
          const doRemove = () => { custEdit.members.splice(i, 1); renderMemberList(); refreshState(); };
          if (typeof m.id === "number" || (typeof m.id !== "string" || !m.id.startsWith("new-"))) {
            openConfirmModal("Remove member?", "Remove this member from the company?", doRemove);
          } else {
            doRemove();
          }
        });
      });
    }
    refreshState();
  };

  const refreshState = () => {
    const names = custEdit.members.map((m) => `${m.name}|${m.email_prefix}|${m.title}|${m.tel}`).join(";");
    const origNames = custOriginal.members.map((m) => `${m.name}|${m.email_prefix}|${m.title}|${m.tel}`).join(";");
    const dirty = names !== origNames ||
      custEdit.members.length !== custOriginal.members.length ||
      custEdit.members.some((m) => typeof m.id === "string" && m.id.startsWith("new-")) ||
      custEdit.members.some((m) => {
        if (typeof m.id !== "number") return false;
        const o = custOriginal.members.find((x) => x.id === m.id);
        return !o || o.name !== m.name || o.email_prefix !== m.email_prefix || o.title !== m.title || o.tel !== m.tel;
      });
    sec.querySelector("#cem-update").disabled = !dirty;
    sec.querySelector("#cem-reset").disabled = !dirty;
  };

  sec.innerHTML = `
    <div class="member-list" id="cem-list"></div>
    <div class="member-form">
      <h3 class="subhead">Add member</h3>
      <div class="field">
        <label for="cem-name">Name</label>
        <input id="cem-name" type="text" placeholder="Jane Doe" autocomplete="off" />
      </div>
      <div class="field">
        <label for="cem-prefix">Email prefix <span class="hint">(suffix follows company)</span></label>
        <div class="input-affix">
          <input id="cem-prefix" type="text" placeholder="jane.doe" autocomplete="off" />
          <span class="suffix">@${escapeHtml(custEdit.emailSuffix)}</span>
        </div>
      </div>
      <div class="field">
        <label for="cem-title">Title</label>
        <input id="cem-title" type="text" placeholder="Engineer" autocomplete="off" />
      </div>
      <div class="field">
        <label for="cem-tel">Tel</label>
        <input id="cem-tel" type="text" placeholder="+1 555 0100" autocomplete="off" />
      </div>
      <div class="actions">
        <button class="btn" id="cem-add" type="button" disabled>Add member</button>
      </div>
    </div>
    <div class="actions create-final">
      <button class="btn ghost" id="cem-reset" type="button">Reset</button>
      <button class="btn primary" id="cem-update" type="button">Update</button>
    </div>
  `;

  const nameEl = sec.querySelector("#cem-name");
  const prefixEl = sec.querySelector("#cem-prefix");
  const titleEl = sec.querySelector("#cem-title");
  const telEl = sec.querySelector("#cem-tel");
  const addBtn = sec.querySelector("#cem-add");

  const validateAdd = () => {
    addBtn.disabled = !(nameEl.value.trim() && prefixEl.value.trim() && titleEl.value.trim() && telEl.value.trim());
  };
  [nameEl, prefixEl, titleEl, telEl].forEach((el) => el.addEventListener("input", validateAdd));

  addBtn.addEventListener("click", () => {
    if (addBtn.disabled) return;
    custEdit.members.push({
      id: "new-" + Date.now(),
      name: nameEl.value.trim(),
      email_prefix: prefixEl.value.trim(),
      title: titleEl.value.trim(),
      tel: telEl.value.trim(),
    });
    nameEl.value = prefixEl.value = titleEl.value = telEl.value = "";
    validateAdd();
    renderMemberList();
  });

  // inline edit of a member field on click (name/title/tel/prefix)
  sec.querySelector("#cem-list").addEventListener("click", (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const i = Number(e.target.dataset.i);
    const m = custEdit.members[i];
    if (!m || f === "email") return;
    const cur = m[f];
    openInlineEdit(e.target, cur, (val) => {
      m[f] = val.trim();
      renderMemberList();
    });
  });

  sec.querySelector("#cem-reset").addEventListener("click", () => {
    custEdit.members = custOriginal.members.map((m) => ({ id: m.id, name: m.name, email_prefix: m.email_prefix, title: m.title, tel: m.tel }));
    nameEl.value = prefixEl.value = titleEl.value = telEl.value = "";
    validateAdd();
    renderMemberList();
  });

  sec.querySelector("#cem-update").addEventListener("click", async () => {
    const btn = sec.querySelector("#cem-update");
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Updating…";
    try {
      // delete removed (saved) members
      const origIds = custOriginal.members.filter((m) => typeof m.id === "number").map((m) => m.id);
      const curIds = custEdit.members.filter((m) => typeof m.id === "number").map((m) => m.id);
      for (const id of origIds) {
        if (!curIds.includes(id)) {
          await fetchJson(API + `/api/members/${id}`, { method: "DELETE" });
        }
      }
      // add new + put edited
      for (const m of custEdit.members) {
        if (typeof m.id === "string" && m.id.startsWith("new-")) {
          const created = await apiAddMember(companyId, m);
          m.id = created.id;
        } else if (typeof m.id === "number") {
          await apiPutMember(m.id, m);
        }
      }
      const fresh = await fetchJson(API + `/api/companies/${companyId}`);
      custOriginal.members = (fresh.members || []).map((m) => ({ ...m }));
      custEdit.members = custOriginal.members.map((m) => ({ id: m.id, name: m.name, email_prefix: m.email_prefix, title: m.title, tel: m.tel }));
      btn.textContent = "Updated ✓";
      renderMemberList();
    } catch (err) {
      btn.textContent = "Update";
      btn.disabled = false;
      openConfirmModal("Update failed", err.message, () => {});
    }
  });

  renderMemberList();
}

// Inline edit: replace the clicked element's text with an input, commit on blur/Enter.
function openInlineEdit(target, currentValue, onCommit) {
  if (target.querySelector("input")) return;
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentValue;
  input.style.width = "100%";
  target.textContent = "";
  target.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    onCommit(input.value);
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { done = true; }
  });
}

// --- Ship to section ---------------------------------------------------------
function renderCustShipToSection(companyId) {
  const sec = panel.querySelector("#cust-shipto");
  if (!sec) return;

  const refreshState = () => {
    const cur = custEdit.shipTo.map((s) => `${s.id}:${s.address}:${s.is_default ? 1 : 0}`).join(";");
    const orig = custOriginal.ship_to.map((s) => `${s.id}:${s.address}:${s.is_default ? 1 : 0}`).join(";");
    const dirty = cur !== orig ||
      custEdit.shipTo.length !== custOriginal.ship_to.length ||
      custEdit.shipTo.some((s) => typeof s.id === "string" && s.id.startsWith("new-"));
    sec.querySelector("#ces-update").disabled = !dirty;
    sec.querySelector("#ces-reset").disabled = !dirty;
  };

  const renderShipList = () => {
    const listEl = sec.querySelector("#ces-list");
    if (!custEdit.shipTo.length) {
      listEl.innerHTML = '<p class="muted small">No ship-to addresses yet.</p>';
    } else {
      listEl.innerHTML = custEdit.shipTo.map((s, i) => `
        <div class="member-row ${s.is_default ? "default-row" : ""}">
          <span>
            <strong data-i="${i}">${escapeHtml(s.address)}</strong>
            ${s.is_default ? '<span class="badge default-badge">default</span>' : ""}
          </span>
          <span class="muted">
            ${s.is_default ? "" : `<button class="btn tiny" data-default="${i}" title="Set as default">Set default</button>`}
            <button class="icon-btn danger" data-rm="${i}" title="Remove">✕</button>
          </span>
        </div>`).join("");
      listEl.querySelectorAll("[data-default]").forEach((b) => {
        b.addEventListener("click", () => {
          const i = Number(b.dataset.default);
          custEdit.shipTo.forEach((s, idx) => { s.is_default = idx === i; });
          renderShipList();
        });
      });
      listEl.querySelectorAll("[data-rm]").forEach((b) => {
        b.addEventListener("click", () => {
          const i = Number(b.dataset.rm);
          const s = custEdit.shipTo[i];
          const doRemove = () => { custEdit.shipTo.splice(i, 1); renderShipList(); refreshState(); };
          if (typeof s.id === "number" || (typeof s.id !== "string" || !s.id.startsWith("new-"))) {
            openConfirmModal("Remove address?", "Remove this ship-to address from the company?", doRemove);
          } else {
            doRemove();
          }
        });
      });
      listEl.querySelectorAll("strong[data-i]").forEach((el) => {
        el.addEventListener("click", () => {
          const i = Number(el.dataset.i);
          openInlineEdit(el, custEdit.shipTo[i].address, (val) => {
            const v = val.trim();
            if (v) custEdit.shipTo[i].address = v;
            renderShipList();
          });
        });
      });
    }
    refreshState();
  };

  sec.innerHTML = `
    <div class="ship-list" id="ces-list"></div>
    <div class="member-form">
      <h3 class="subhead">Add ship-to address</h3>
      <div class="field">
        <label for="ces-addr">Address</label>
        <textarea id="ces-addr" rows="3" placeholder="Full shipping address…" autocomplete="off"></textarea>
      </div>
      <div class="actions">
        <button class="btn" id="ces-add" type="button" disabled>Add address</button>
      </div>
    </div>
    <div class="actions create-final">
      <button class="btn ghost" id="ces-reset" type="button">Reset</button>
      <button class="btn primary" id="ces-update" type="button">Update</button>
    </div>
  `;

  const addrEl = sec.querySelector("#ces-addr");
  const addBtn = sec.querySelector("#ces-add");
  addrEl.addEventListener("input", () => { addBtn.disabled = !addrEl.value.trim(); });

  addBtn.addEventListener("click", () => {
    if (addBtn.disabled) return;
    const address = addrEl.value.trim();
    custEdit.shipTo.push({ id: "new-" + Date.now(), address, is_default: false });
    addrEl.value = "";
    addBtn.disabled = true;
    renderShipList();
  });

  sec.querySelector("#ces-reset").addEventListener("click", () => {
    custEdit.shipTo = custOriginal.ship_to.map((s) => ({ id: s.id, address: s.address, is_default: !!s.is_default }));
    addrEl.value = "";
    addBtn.disabled = true;
    renderShipList();
  });

  sec.querySelector("#ces-update").addEventListener("click", async () => {
    const btn = sec.querySelector("#ces-update");
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Updating…";
    try {
      const origIds = custOriginal.ship_to.filter((s) => typeof s.id === "number").map((s) => s.id);
      const curIds = custEdit.shipTo.filter((s) => typeof s.id === "number").map((s) => s.id);
      const newOnes = [];
      for (const s of custEdit.shipTo) {
        if (typeof s.id === "string" && s.id.startsWith("new-")) {
          const created = await fetchJson(API + `/api/ship-to/${companyId}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: s.address }),
          });
          newOnes.push(created.id != null ? created.id : created);
        }
      }
      for (const id of origIds) {
        if (!curIds.includes(id)) {
          await fetchJson(API + `/api/ship-to/${id}`, { method: "DELETE" });
        }
      }
      // set default if any flagged
      const def = custEdit.shipTo.find((s) => s.is_default);
      if (def) {
        const defId = typeof def.id === "number" ? def.id : newOnes[0];
        if (defId != null) await fetchJson(API + `/api/ship-to/${defId}/default`, { method: "PUT" });
      }
      const fresh = await fetchJson(API + `/api/companies/${companyId}`);
      custOriginal.ship_to = (fresh.ship_to || []).map((s) => ({ ...s }));
      custEdit.shipTo = custOriginal.ship_to.map((s) => ({ id: s.id, address: s.address, is_default: !!s.is_default }));
      btn.textContent = "Updated ✓";
      renderShipList();
    } catch (err) {
      btn.textContent = "Update";
      btn.disabled = false;
      openConfirmModal("Update failed", err.message, () => {});
    }
  });

  renderShipList();
}

// --- Project section ---------------------------------------------------------
function renderCustProjectSection(companyId) {
  const sec = panel.querySelector("#cust-project");
  if (!sec) return;

  const refreshState = () => {
    const cur = custEdit.projects.map((p) => `${p.id}:${p.name}`).join(";");
    const orig = custOriginal.projects.map((p) => `${p.id}:${p.name}`).join(";");
    const dirty = cur !== orig ||
      custEdit.projects.length !== custOriginal.projects.length ||
      custEdit.projects.some((p) => typeof p.id === "string" && p.id.startsWith("new-"));
    sec.querySelector("#cep-update").disabled = !dirty;
    sec.querySelector("#cep-reset").disabled = !dirty;
  };

  const renderProjList = () => {
    const listEl = sec.querySelector("#cep-list");
    if (!custEdit.projects.length) {
      listEl.innerHTML = '<p class="muted small">No projects yet.</p>';
    } else {
      listEl.innerHTML = custEdit.projects.map((p, i) => `
        <div class="member-row">
          <span><strong data-i="${i}">${escapeHtml(p.name)}</strong></span>
          <span class="muted">
            <button class="icon-btn danger" data-rm="${i}" title="Remove">✕</button>
          </span>
        </div>`).join("");
      listEl.querySelectorAll("[data-rm]").forEach((b) => {
        b.addEventListener("click", () => {
          const i = Number(b.dataset.rm);
          const p = custEdit.projects[i];
          const doRemove = () => { custEdit.projects.splice(i, 1); renderProjList(); refreshState(); };
          if (typeof p.id === "number" || (typeof p.id !== "string" || !p.id.startsWith("new-"))) {
            openConfirmModal("Remove project?", "Remove this project from the company?", doRemove);
          } else {
            doRemove();
          }
        });
      });
      listEl.querySelectorAll("strong[data-i]").forEach((el) => {
        el.addEventListener("click", () => {
          const i = Number(el.dataset.i);
          openInlineEdit(el, custEdit.projects[i].name, (val) => {
            const v = val.trim();
            if (v) custEdit.projects[i].name = v;
            renderProjList();
          });
        });
      });
    }
    refreshState();
  };

  sec.innerHTML = `
    <div class="proj-list" id="cep-list"></div>
    <div class="member-form">
      <h3 class="subhead">Add project</h3>
      <div class="field">
        <label for="cep-name">Project name</label>
        <input id="cep-name" type="text" placeholder="e.g. Spring 2026 Collection" autocomplete="off" />
      </div>
      <div class="actions">
        <button class="btn" id="cep-add" type="button" disabled>Add project</button>
      </div>
    </div>
    <div class="actions create-final">
      <button class="btn ghost" id="cep-reset" type="button">Reset</button>
      <button class="btn primary" id="cep-update" type="button">Update</button>
    </div>
  `;

  const nameEl = sec.querySelector("#cep-name");
  const addBtn = sec.querySelector("#cep-add");
  nameEl.addEventListener("input", () => { addBtn.disabled = !nameEl.value.trim(); });

  addBtn.addEventListener("click", async () => {
    if (addBtn.disabled) return;
    const name = nameEl.value.trim();
    addBtn.disabled = true;
    nameEl.value = "";
    custEdit.projects.push({ id: "new-" + Date.now(), name });
    renderProjList();
  });

  sec.querySelector("#cep-reset").addEventListener("click", () => {
    custEdit.projects = custOriginal.projects.map((p) => ({ id: p.id, name: p.name }));
    nameEl.value = "";
    addBtn.disabled = true;
    renderProjList();
  });

  sec.querySelector("#cep-update").addEventListener("click", async () => {
    const btn = sec.querySelector("#cep-update");
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Updating…";
    try {
      const origIds = custOriginal.projects.filter((p) => typeof p.id === "number").map((p) => p.id);
      const curIds = custEdit.projects.filter((p) => typeof p.id === "number").map((p) => p.id);
      for (const id of origIds) {
        if (!curIds.includes(id)) {
          await fetchJson(API + `/api/projects/${id}`, { method: "DELETE" });
        }
      }
      for (const p of custEdit.projects) {
        if (typeof p.id === "string" && p.id.startsWith("new-")) {
          const created = await fetchJson(API + `/api/projects/${companyId}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: p.name }),
          });
          p.id = created.id != null ? created.id : created;
        }
      }
      const fresh = await fetchJson(API + `/api/companies/${companyId}`);
      custOriginal.projects = (fresh.projects || []).map((p) => ({ ...p }));
      custEdit.projects = custOriginal.projects.map((p) => ({ id: p.id, name: p.name }));
      btn.textContent = "Updated ✓";
      renderProjList();
    } catch (err) {
      btn.textContent = "Update";
      btn.disabled = false;
      openConfirmModal("Update failed", err.message, () => {});
    }
  });

  renderProjList();
}

async function removeMember(memberId) {
  openConfirmModal(
    "Delete member",
    "Delete 1 member?",
    async () => {
      try {
        await fetchJson(API + `/api/members/${memberId}`, { method: "DELETE" });
        await renderCustomerView();
      } catch (err) {
        showToast("Remove failed: " + err.message, true);
      }
    }
  );
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function saveCustomerWithMembers(companyName, emailSuffix, members, companyExtra = {}) {
  const cRes = await fetchJson(API + "/api/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: companyName,
      email_suffix: emailSuffix,
      currency: companyExtra.currency || null,
      payment_term: companyExtra.payment_term || null,
      shipment_term: companyExtra.shipment_term || null,
    }),
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

async function apiPutCompany(companyId, name, emailSuffix, extra = {}) {
  return fetchJson(API + `/api/companies/${companyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      email_suffix: emailSuffix,
      currency: extra.currency || null,
      payment_term: extra.payment_term || null,
      shipment_term: extra.shipment_term || null,
    }),
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
  return {
    name,
    suffix: rnd(SUFFIX),
    currency: rnd(opt("customer","currency")),
    payment: rnd(opt("customer","payment_term")),
    shipment: rnd(opt("customer","shipment_term")),
  };
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

// Wire a notes textarea: keeps the line counter ("N / max") in sync, colours
// it warn/over as the limit approaches/exceeds, and auto-grows the textarea up
// to a sensible max-height as the user types. `onChange` (optional) fires on
// every input so callers can run their own devState updates / Save re-eval.
function wireNotesTextarea(notesEl, countEl, opts) {
  if (!notesEl) return;
  const max = Number(notesEl.getAttribute("maxlength")) || 2000;
  const onChange = (opts && opts.onChange) || function () {};
  const grow = () => {
    notesEl.style.height = "auto";
    notesEl.style.height = Math.min(notesEl.scrollHeight, 320) + "px";
  };
  const updateCount = () => {
    if (!countEl) return;
    const n = notesEl.value.length;
    countEl.textContent = `${n} / ${max}`;
    countEl.classList.toggle("warn", n >= max * 0.9 && n < max);
    countEl.classList.toggle("over", n >= max);
  };
  notesEl.addEventListener("input", () => {
    grow();
    updateCount();
    onChange();
  });
  // Initial paint — important when the textarea is restored from draft state
  // (post-save "same customer") or prefilled with the existing note on Edit.
  grow();
  updateCount();
}

// Escape a value for use inside a CSS attribute selector (list names may hold
// spaces or special characters). Global so it can be used by both the Settings
// factory card and the Material popup builders.
function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, "\\$&");
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
  // Percent-encode spaces, "&", parentheses, etc. so the browser sends a
  // valid request that the server can decode back to the real on-disk file.
  if (name.startsWith("uploads/")) return API + "/" + encodeURI(name);
  return API + "/sample-images/" + encodeURI(name);
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

// ---------------------------------------------------------------------------
// View tabs refresh on demand only: when the page is landed on, after a
// delete, and after returning from an Edit save. There is no periodic
// auto-refresh timer, so a View stays put while you read it.
// ---------------------------------------------------------------------------

// Populate the managed dropdown-option cache once at startup so every form
// renders from the DB-backed sets. If the fetch fails, forms fall back to the
// hardcoded seed arrays declared near the top of this file.
loadOptions();
// Load the per-product-type Fabric/Folding factory map (Settings / Options).
loadProductTypeFactory();
