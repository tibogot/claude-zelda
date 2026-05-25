/**
 * inspector.js
 * Custom dark inspector panel (v2-editor / arborist style) that drop-in
 * replaces Tweakpane in the ambient-fx editor.
 *
 * Exports:
 *  - mountInspector(parentEl, title) → returns a "rootFolder" shim. Append
 *    sections to it via .addFolder(...), .addBinding(...) etc.
 *  - The folder shim mimics the subset of Tweakpane API used by the FX
 *    modules: addBinding (bool/number/color), addBlade({view:"separator"}),
 *    addButton({title}), addFolder({title,expanded}). All return objects
 *    with `.on("change"|"click", cb)` chaining.
 *  - Bonus widget: folder.addTexturePicker({...}) — built-in texture
 *    thumbnails + "Load Custom PNG / JPG" file upload, with auto B&W-mask
 *    detection signalled back to the FX via the onTextureMode callback.
 */

const CSS = `
:root {
  --insp-bg-darkest: #1a1a1a;
  --insp-bg-dark: #222;
  --insp-bg-panel: #2a2a2a;
  --insp-bg-item: #333;
  --insp-bg-hover: #3a3a3a;
  --insp-bg-input: #1e1e1e;
  --insp-border: #3c3c3c;
  --insp-border-light: #4a4a4a;
  --insp-text: #ccc;
  --insp-text-dim: #888;
  --insp-text-bright: #e0e0e0;
  --insp-accent: #4a9eff;
  --insp-font: "Segoe UI", system-ui, -apple-system, sans-serif;
  --insp-font-mono: "Cascadia Code", "Fira Code", Consolas, monospace;
  --insp-radius: 4px;
}
.insp-panel {
  position: fixed;
  top: 8px; right: 8px;
  z-index: 20;
  width: 320px;
  max-height: calc(100vh - 16px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--insp-bg-panel);
  border: 1px solid var(--insp-border);
  border-radius: 6px;
  font-family: var(--insp-font);
  font-size: 13px;
  color: var(--insp-text);
  user-select: none;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.insp-panel .panel-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  min-height: 36px;
  background: var(--insp-bg-dark);
  border-bottom: 1px solid var(--insp-border);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--insp-text-bright);
  flex-shrink: 0;
}
.insp-scroll {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
}
.insp-scroll::-webkit-scrollbar { width: 8px; }
.insp-scroll::-webkit-scrollbar-thumb {
  background: var(--insp-border);
  border-radius: 4px;
}
.insp-section {
  border-bottom: 1px solid var(--insp-border);
}
.insp-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--insp-text-dim);
}
.insp-section-header:hover { background: var(--insp-bg-hover); }
.insp-section-header .insp-arrow {
  width: 14px; height: 14px;
  transition: transform 0.15s;
  flex-shrink: 0;
}
.insp-section-header.collapsed .insp-arrow { transform: rotate(-90deg); }
.insp-section-body {
  padding: 6px 12px 10px;
}
.insp-section-body.hidden { display: none; }
/* Nested folders compactify */
.insp-section-body .insp-section {
  border: 1px solid var(--insp-border);
  border-radius: var(--insp-radius);
  margin: 4px 0;
  background: var(--insp-bg-dark);
}
.insp-section-body .insp-section:last-child { border-bottom: 1px solid var(--insp-border); }
.insp-section-body .insp-section-header { padding: 5px 8px; }
.insp-section-body .insp-section-body { padding: 4px 8px 8px; }
.insp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  min-height: 26px;
}
.insp-label {
  width: 108px;
  min-width: 108px;
  font-size: 11px;
  color: var(--insp-text-dim);
  text-align: right;
  padding-right: 4px;
  line-height: 1.2;
}
.insp-value {
  flex: 1;
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
}
.insp-input {
  flex: 1;
  height: 22px;
  background: var(--insp-bg-input);
  border: 1px solid var(--insp-border);
  border-radius: var(--insp-radius);
  padding: 0 6px;
  color: var(--insp-text);
  font-size: 12px;
  font-family: var(--insp-font-mono);
  outline: none;
  min-width: 0;
}
.insp-input:focus { border-color: var(--insp-accent); }
.insp-color-wrap {
  display: flex; align-items: center; gap: 6px; flex: 1;
}
.insp-color {
  width: 22px; height: 22px;
  border-radius: var(--insp-radius);
  border: 1px solid var(--insp-border);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}
.insp-color::-webkit-color-swatch-wrapper { padding: 0; }
.insp-color::-webkit-color-swatch { border: none; border-radius: 2px; }
.insp-hex {
  width: auto;
  font-size: 11px;
  color: var(--insp-text-dim);
  font-family: var(--insp-font-mono);
}
.insp-slider-wrap {
  flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0;
}
.insp-num {
  width: 72px; height: 22px;
  flex-shrink: 0;
  box-sizing: border-box;
  background: var(--insp-bg-input);
  border: 1px solid var(--insp-border);
  border-radius: var(--insp-radius);
  padding: 0 5px;
  color: var(--insp-text);
  font-size: 11px;
  font-family: var(--insp-font-mono);
  text-align: right;
  outline: none;
}
.insp-num:focus { border-color: var(--insp-accent); }
.insp-num::-webkit-outer-spin-button,
.insp-num::-webkit-inner-spin-button {
  -webkit-appearance: none; margin: 0;
}
.insp-num[type="number"] {
  appearance: textfield;
  -moz-appearance: textfield;
}
.insp-slider {
  flex: 1; height: 4px;
  -webkit-appearance: none; appearance: none;
  background: var(--insp-bg-input);
  border-radius: 2px;
  outline: none;
  min-width: 0;
}
.insp-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--insp-accent);
  cursor: pointer;
}
.insp-toggle {
  width: 14px; height: 14px;
  border: 1px solid var(--insp-border-light);
  border-radius: 3px;
  background: var(--insp-bg-input);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  padding: 0;
  color: transparent;
}
.insp-toggle.checked {
  background: var(--insp-accent);
  border-color: var(--insp-accent);
  color: white;
}
.insp-toggle svg { width: 10px; height: 10px; }
.insp-btn {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 26px;
  margin-top: 4px;
  background: var(--insp-bg-item);
  border: 1px solid var(--insp-border);
  border-radius: var(--insp-radius);
  color: var(--insp-text-dim);
  cursor: pointer;
  font-size: 11px;
  font-family: var(--insp-font);
}
.insp-btn:hover {
  background: var(--insp-bg-hover);
  color: var(--insp-text);
  border-color: var(--insp-border-light);
}
.insp-separator {
  height: 1px;
  background: var(--insp-border);
  margin: 6px 0;
}
.insp-info {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 0; min-height: 26px;
}
.insp-info-label {
  width: 108px; min-width: 108px;
  font-size: 11px;
  color: var(--insp-text-dim);
  text-align: right; padding-right: 4px;
}
.insp-info-value {
  flex: 1;
  font-size: 12px;
  color: var(--insp-text);
  font-family: var(--insp-font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insp-select {
  flex: 1;
  height: 22px;
  background: var(--insp-bg-input);
  border: 1px solid var(--insp-border);
  border-radius: var(--insp-radius);
  color: var(--insp-text);
  font-size: 12px;
  font-family: var(--insp-font);
  padding: 0 6px;
  outline: none;
}
.insp-select:focus { border-color: var(--insp-accent); }
.insp-tex-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.35px;
  color: var(--insp-text-dim);
  padding: 2px 0 6px;
}
.insp-tex-gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 0 8px;
}
.insp-tex-item {
  display: flex; flex-direction: column;
  align-items: center; gap: 3px;
  width: 56px;
}
.insp-tex-item img {
  width: 52px; height: 52px;
  object-fit: cover;
  border-radius: var(--insp-radius);
  border: 2px solid var(--insp-border);
  cursor: pointer;
  opacity: 0.75;
  background: var(--insp-bg-input);
  transition: opacity 0.15s, border-color 0.15s;
}
.insp-tex-item img:hover {
  opacity: 1;
  border-color: var(--insp-border-light);
}
.insp-tex-item img.active {
  border-color: var(--insp-accent);
  opacity: 1;
  box-shadow: 0 0 0 1px var(--insp-accent);
}
.insp-tex-caption {
  font-size: 9px;
  line-height: 1.2;
  font-family: var(--insp-font-mono);
  color: var(--insp-text-dim);
  text-align: center;
  max-width: 56px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}
.insp-tex-current {
  display: flex; gap: 6px;
  font-size: 10px;
  color: var(--insp-text-dim);
  padding: 2px 0 4px;
  font-family: var(--insp-font-mono);
}
.insp-tex-current b {
  color: var(--insp-text);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;

let _stylesInjected = false;
function _injectStyles() {
  if (_stylesInjected) return;
  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-id", "insp-styles");
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);
  _stylesInjected = true;
}

const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const ARROW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="insp-arrow"><polyline points="6 9 12 15 18 9"></polyline></svg>';

function _fmt(v, step) {
  if (step >= 1) return String(Math.round(v));
  const d = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(v).toFixed(d);
}

function _clampSnap(v, min, max, step) {
  if (!Number.isFinite(v)) return min;
  const n = Math.round((v - min) / step);
  let out = min + n * step;
  const stepStr = String(step);
  let decimals = 0;
  if (stepStr.includes(".")) decimals = stepStr.split(".")[1].length;
  else if (stepStr.includes("e-")) decimals = 8;
  if (decimals > 0) out = Number(out.toFixed(decimals));
  return Math.min(max, Math.max(min, out));
}

// ─── Primitive widgets ─────────────────────────────────────────────────────

function _section(parent, title, expanded = true) {
  const sec = document.createElement("div");
  sec.className = "insp-section";
  const hdr = document.createElement("div");
  hdr.className = "insp-section-header" + (expanded ? "" : " collapsed");
  hdr.innerHTML = ARROW_SVG + " " + title;
  const body = document.createElement("div");
  body.className = "insp-section-body" + (expanded ? "" : " hidden");
  hdr.addEventListener("click", () => {
    hdr.classList.toggle("collapsed");
    body.classList.toggle("hidden");
  });
  sec.appendChild(hdr);
  sec.appendChild(body);
  parent.appendChild(sec);
  return { section: sec, body };
}

function _slider(parent, obj, key, opts) {
  const { label, min, max, step = 0.01, onChange } = opts;
  const row = document.createElement("div");
  row.className = "insp-row";
  const cur = obj[key];
  row.innerHTML = `<span class="insp-label">${label}</span><div class="insp-value"><div class="insp-slider-wrap"><input type="range" class="insp-slider" min="${min}" max="${max}" step="${step}" value="${cur}"><input type="number" class="insp-num" min="${min}" max="${max}" step="${step}" value="${_fmt(cur, step)}"></div></div>`;
  const sl = row.querySelector(".insp-slider");
  const num = row.querySelector(".insp-num");
  const sync = () => { num.value = _fmt(obj[key], step); };
  sl.addEventListener("input", () => {
    obj[key] = parseFloat(sl.value);
    sync();
    onChange?.({ value: obj[key] });
  });
  num.addEventListener("change", () => {
    const raw = String(num.value).trim();
    if (raw === "" || raw === "-" || raw === "." || raw === "-.") { sync(); return; }
    let v = parseFloat(raw);
    if (!Number.isFinite(v)) { sync(); return; }
    v = _clampSnap(v, min, max, step);
    obj[key] = v;
    sl.value = String(v);
    sync();
    onChange?.({ value: obj[key] });
  });
  num.addEventListener("keydown", (e) => { if (e.key === "Enter") num.blur(); });
  num.addEventListener("wheel", (e) => {
    if (document.activeElement === num) e.preventDefault();
  }, { passive: false });
  parent.appendChild(row);
  return { refresh() { sl.value = obj[key]; sync(); } };
}

function _color(parent, obj, key, opts) {
  const { label, onChange } = opts;
  const row = document.createElement("div");
  row.className = "insp-row";
  row.innerHTML = `<span class="insp-label">${label}</span><div class="insp-value"><div class="insp-color-wrap"><input type="color" class="insp-color" value="${obj[key]}"><span class="insp-hex">${obj[key]}</span></div></div>`;
  const inp = row.querySelector(".insp-color");
  const hex = row.querySelector(".insp-hex");
  inp.addEventListener("input", () => {
    obj[key] = inp.value;
    hex.textContent = inp.value;
    onChange?.({ value: obj[key] });
  });
  parent.appendChild(row);
  return { refresh() { inp.value = obj[key]; hex.textContent = obj[key]; } };
}

function _toggle(parent, obj, key, opts) {
  const { label, onChange } = opts;
  const row = document.createElement("div");
  row.className = "insp-row";
  row.innerHTML = `<span class="insp-label">${label}</span><div class="insp-value"><button type="button" class="insp-toggle ${obj[key] ? "checked" : ""}">${CHECK_SVG}</button></div>`;
  const btn = row.querySelector(".insp-toggle");
  btn.addEventListener("click", () => {
    obj[key] = !obj[key];
    btn.classList.toggle("checked", obj[key]);
    onChange?.({ value: obj[key] });
  });
  parent.appendChild(row);
  return { refresh() { btn.classList.toggle("checked", !!obj[key]); } };
}

function _select(parent, obj, key, opts) {
  const { label, options, onChange } = opts;
  const row = document.createElement("div");
  row.className = "insp-row";
  const opts2 = Object.entries(options)
    .map(([k, v]) => `<option value="${v}" ${v === obj[key] ? "selected" : ""}>${k}</option>`)
    .join("");
  row.innerHTML = `<span class="insp-label">${label}</span><div class="insp-value"><select class="insp-select">${opts2}</select></div>`;
  const sel = row.querySelector(".insp-select");
  sel.addEventListener("change", () => {
    obj[key] = sel.value;
    onChange?.({ value: obj[key] });
  });
  parent.appendChild(row);
  return { refresh() { sel.value = obj[key]; } };
}

function _button(parent, opts) {
  const { title, onClick } = opts;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "insp-btn";
  btn.textContent = title;
  btn.addEventListener("click", () => onClick?.());
  parent.appendChild(btn);
  return btn;
}

function _separator(parent) {
  const div = document.createElement("div");
  div.className = "insp-separator";
  parent.appendChild(div);
}

function _info(parent, label, getValue) {
  const row = document.createElement("div");
  row.className = "insp-info";
  const valSpan = document.createElement("span");
  valSpan.className = "insp-info-value";
  valSpan.textContent = getValue();
  row.innerHTML = `<span class="insp-info-label">${label}</span>`;
  row.appendChild(valSpan);
  parent.appendChild(row);
  return { refresh() { valSpan.textContent = getValue(); } };
}

// ─── Texture picker ─────────────────────────────────────────────────────────
// Embeds a built-in thumbnail gallery + "Load Custom PNG / JPG" button +
// current-selection indicator. Reports back via callbacks.

function _texturePicker(parent, opts) {
  const {
    label = "Texture",
    builtins = [],
    getCurrentPath = () => "",
    getCurrentName = () => "",
    onBuiltinSelect,
    onCustomLoad,
  } = opts;

  const lbl = document.createElement("div");
  lbl.className = "insp-tex-label";
  lbl.textContent = label;
  parent.appendChild(lbl);

  const gallery = document.createElement("div");
  gallery.className = "insp-tex-gallery";
  parent.appendChild(gallery);

  const imgs = [];
  function syncActive() {
    const p = getCurrentPath();
    imgs.forEach((img, i) => {
      img.classList.toggle("active", builtins[i].path === p);
    });
    current.refresh();
  }

  builtins.forEach((t) => {
    const wrap = document.createElement("div");
    wrap.className = "insp-tex-item";
    const img = document.createElement("img");
    img.src = t.path;
    img.title = t.name;
    img.alt = t.name;
    img.addEventListener("click", () => {
      onBuiltinSelect?.(t.path, t.name);
      // Optimistically mark active; FX will confirm via getCurrentPath next frame.
      imgs.forEach((im) => im.classList.remove("active"));
      img.classList.add("active");
      current.refresh();
    });
    wrap.appendChild(img);
    const cap = document.createElement("div");
    cap.className = "insp-tex-caption";
    cap.textContent = t.name;
    wrap.appendChild(cap);
    gallery.appendChild(wrap);
    imgs.push(img);
  });

  // Currently-loaded indicator (shows custom file names too).
  const current = _info(parent, "Loaded", () => {
    const path = getCurrentPath();
    const name = getCurrentName();
    if (name) return name;
    if (path) {
      const parts = path.split("/");
      return parts[parts.length - 1];
    }
    return "(none)";
  });

  _button(parent, {
    title: "Load Custom PNG / JPG",
    onClick: () => {
      const i = document.createElement("input");
      i.type = "file";
      i.accept = "image/*";
      i.onchange = () => {
        const file = i.files && i.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          onCustomLoad?.(ev.target.result, file.name);
          imgs.forEach((im) => im.classList.remove("active"));
          current.refresh();
        };
        reader.readAsDataURL(file);
      };
      i.click();
    },
  });

  syncActive();
  return { refresh: syncActive };
}

// ─── Folder shim (Tweakpane-compatible subset) ──────────────────────────────

function _makeFolder(body, sectionEl) {
  const folder = {
    body, // raw DOM for custom widgets

    addBinding(obj, key, opts = {}) {
      const value = obj[key];
      const changeCbs = [];
      const trigger = (ev) => changeCbs.forEach((cb) => cb(ev));

      if (typeof value === "boolean") {
        _toggle(body, obj, key, { label: opts.label || key, onChange: trigger });
      } else if (typeof value === "number") {
        _slider(body, obj, key, {
          label: opts.label || key,
          min: opts.min ?? 0,
          max: opts.max ?? 1,
          step: opts.step ?? 0.01,
          onChange: trigger,
        });
      } else if (typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value)) {
        _color(body, obj, key, { label: opts.label || key, onChange: trigger });
      } else if (opts.options) {
        _select(body, obj, key, {
          label: opts.label || key,
          options: opts.options,
          onChange: trigger,
        });
      } else {
        // Fallback: read-only-ish info row showing the value.
        _info(body, opts.label || key, () => String(obj[key]));
      }

      return {
        on(evt, cb) {
          if (evt === "change") changeCbs.push(cb);
          return this;
        },
      };
    },

    addBlade(opts) {
      if (opts?.view === "separator") _separator(body);
      return {};
    },

    addButton(opts) {
      let clickCb = null;
      _button(body, {
        title: opts.title,
        onClick: () => clickCb?.(),
      });
      return {
        on(evt, cb) {
          if (evt === "click") clickCb = cb;
          return this;
        },
      };
    },

    addFolder(opts) {
      const { section, body: subBody } = _section(
        body,
        opts?.title || "Folder",
        opts?.expanded !== false
      );
      return _makeFolder(subBody, section);
    },

    addTexturePicker(opts) {
      return _texturePicker(body, opts);
    },

    addInfo(label, getValue) {
      return _info(body, label, getValue);
    },

    dispose() {
      if (sectionEl && sectionEl.parentElement) sectionEl.remove();
    },
  };
  return folder;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function mountInspector(parent, title = "Inspector") {
  _injectStyles();
  const panel = document.createElement("div");
  panel.className = "insp-panel";
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = title;
  const scroll = document.createElement("div");
  scroll.className = "insp-scroll";
  panel.appendChild(header);
  panel.appendChild(scroll);
  parent.appendChild(panel);

  // Root behaves like a folder whose body is the scroll container.
  const root = _makeFolder(scroll, null);
  root.headerEl = header;
  root.panelEl = panel;
  return root;
}
