// Clean-room query model (g07, part Q): constants, display conversion,
// summary evaluation, frontmatter extraction and widget defaults.
import { env } from "./env.js";

/** `rY` — unique sentinel for formula-evaluation loop detection. */
export const s09FormulaLoopSentinel = Symbol("ng07FormulaLoop");

/** `yY` — default sort order. */
export const s09DefaultSort = [{ property: "file.name", direction: "ASC" }];

/** `bY` — default column order. */
export const s09DefaultOrder = ["file.name"];

/** `wY` — built-in file property ids. */
export const s09FileProperties = [
  "file.file", "file.name", "file.basename", "file.fullname", "file.path",
  "file.folder", "file.ext", "file.ctime", "file.mtime", "file.size",
  "file.links", "file.backlinks", "file.embeds", "file.tags",
];

/** `vY` — display labels for file properties ({propertyId: labelFn}). */
export function s09FilePropLabels() {
  const e = env();
  const gm = e.gm || {};
  const nouns = gm.nouns || {};
  const label = (key) => () => (nouns[key] ? nouns[key]() : key);
  return {
    "file.name": label("fileName"), "file.path": label("filePath"),
    "file.folder": label("folder"), "file.size": label("fileSize"),
    "file.mtime": label("fileMtime"), "file.ctime": label("fileCtime"),
  };
}

const ng07QryClsQ = {};
function ng07QryOnceQ(key, build) { return (ng07QryClsQ[key] ??= build()); }

// ------------------------------------------------------- s09ValueToDisplay

/** `BY` — value -> JS display value for front-matter/cell serialization. */
export function s09ValueToDisplay(app, value, fileCtx) {
  const e = env();
  if (value === null || value === undefined || value instanceof e.bW) return null;
  if (value instanceof e.EW || value instanceof e.NW || value instanceof e.MW) return value.data;
  if (value instanceof e.LW || value instanceof s08RelativeDateValue(ng07Host)) return value.printDate ? value.printDate() : String(value);
  if (value instanceof e.OW) return value.getMilliseconds ? value.getMilliseconds() : String(value);
  if (value instanceof e.BW) { // link
    const target = value.resolve ? value.resolve() : value.target || value.data;
    return value.display ? `[[${target}|${value.display}]]` : `[[${target}]]`;
  }
  if (value instanceof e.SW || (value && value.isList && value.isList())) {
    return (value.toArray ? value.toArray() : []).map((v) => s09ValueToDisplay(app, v, fileCtx));
  }
  if (value instanceof e.AW || (value && value.isObject && value.isObject())) {
    const out = {};
    for (const k of value.keys ? value.keys() : []) out[k] = s09ValueToDisplay(app, value.get ? value.get(k) : value.objectAccess(k), fileCtx);
    return out;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object" && value.file) return `[[${value.file.path}]]`;
  if (typeof value.toString === "function") return value.toString();
  return String(value);
}

// --------------------------------------------------- s09EvalSummaryFormulas

/** `RY` — evaluate summary formulas for `file` in `ctx`; returns display values. */
export function s09EvalSummaryFormulas(app, ctx, formulas, file) {
  const e = env();
  const out = {};
  const fctx = file ? new (s09FileContext(ng07Host))(ctx, file) : ctx;
  const results = fctx && fctx.formulaResults ? fctx.formulaResults : null;
  for (const [name, text] of Object.entries(formulas || {})) {
    try {
      const v = s08FormulaValue(fctx || ctx, String(text));
      out[name] = s09ValueToDisplay(app, v instanceof e.yW ? null : v, fctx);
    } catch (err) { out[name] = null; }
  }
  return out;
}

// ---------------------------------------------- s09FiltersToFrontmatter (FY)

function ng07RuleParts(ruleText) {
  // crude parse: "<lhs> <op> <rhs>" or "fn(args)"
  const m = /^(.+?)\s*(==|!=|<=|>=|<|>|=|contains|startsWith|endsWith|isEmpty|hasTag|inFolder|hasProperty)\s*(.*)$/.exec(String(ruleText || "").trim());
  if (!m) return null;
  return { lhs: m[1].trim(), op: m[2], rhs: m[3].trim() };
}

/** `FY` — extract frontmatter defaults implied by global+view filters. */
export function s09FiltersToFrontmatter(app, query, view, fileCtx) {
  const out = { frontmatter: {}, folder: "" };
  const collect = (filter) => {
    if (!filter) return;
    const rules = filter.getFilterRulesWithNegation ? filter.getFilterRulesWithNegation(false) : [];
    for (const r of rules) {
      if (r.negated) continue;
      const text = r.rule && r.rule.serialize ? r.rule.serialize() : String(r.rule || "");
      const parts = ng07RuleParts(text);
      if (!parts) continue;
      const fmKey = parts.lhs.replace(/^note\./, "").replace(/^"|"$/g, "");
      const unquote = (s) => {
        const t = String(s || "").trim();
        if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
          try { return JSON.parse(t); } catch (e) { return t.slice(1, -1); }
        }
        return t;
      };
      if (parts.op === "isEmpty") { out.frontmatter[fmKey] = ""; continue; }
      if (parts.op === "==" || parts.op === "=") {
        if (parts.lhs === "file.folder") out.folder = unquote(parts.rhs);
        else out.frontmatter[fmKey] = unquote(parts.rhs);
      } else if (parts.op === "hasTag") {
        const tag = unquote(parts.rhs).replace(/^#/, "");
        const cur = out.frontmatter.tags;
        out.frontmatter.tags = Array.isArray(cur) ? [...cur, tag] : cur ? [cur, tag] : [tag];
      } else if (parts.op === "inFolder") {
        out.folder = unquote(parts.rhs);
      } else if (parts.op === "hasProperty") {
        out.frontmatter[fmKey] = null;
      } else if (["contains", "startsWith", "endsWith", "containsAny", "containsAll"].includes(parts.op)) {
        const val = unquote(parts.rhs);
        out.frontmatter[fmKey] = parts.op === "containsAll" || Array.isArray(val) ? val : [val];
      }
    }
  };
  collect(query && query.filters);
  if (view) collect(view.filters);
  // order note properties become null keys when absent
  if (view && Array.isArray(view.order || view.getOrder && view.getOrder())) {
    const order = view.order || view.getOrder();
    for (const pid of order) {
      if (String(pid).startsWith("note.")) {
        const key = String(pid).slice(5);
        if (!(key in out.frontmatter)) out.frontmatter[key] = null;
      }
    }
  }
  return out;
}

// ------------------------------------------------- s09DefaultValueForWidget

/** `AY` — empty value for a property widget type. */
export function s09DefaultValueForWidget(widget) {
  const e = env();
  switch (widget) {
    case "number": return new e.EW(0);
    case "text": case "multitext": case "url": return new e.CW("");
    case "checkbox": case "boolean": return new e.MW(false);
    case "date": case "datetime": return new e.LW(0);
    case "list": case "tags": return new e.SW([]);
    case "file": return new e.NW(null);
    case "link": return new e.BW(null, null, "");
    default: return e.bW.value;
  }
}

// ------------------------------------------------------- PropertySuggest

function ng07BuildPropSuggest() {
  function PropertySuggest(controller, containerEl) {
    this.controller = controller;
    this.app = controller && controller.app;
    this.containerEl = containerEl;
    this.value = "";
    this.filter = null;
    this.onSelectCb = null;
    this.onOpenCb = null;
    this.onCloseCb = null;
    this.placeholder = "";
    this.clearable = false;
    this._open = false;
    this._build();
  }
  PropertySuggest.prototype._build = function () {
    const wrap = document.createElement("div");
    wrap.className = "bases-property-suggest";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "metadata-property-value";
    wrap.appendChild(input);
    const list = document.createElement("div");
    list.className = "bases-property-suggest-list suggest-container";
    list.style.display = "none";
    wrap.appendChild(list);
    if (this.containerEl) this.containerEl.appendChild(wrap);
    this.inputEl = input;
    this.listEl = list;
    this.buttonEl = wrap;
    this.iconEl = document.createElement("div");
    this.iconEl.className = "bases-property-suggest-icon";
    wrap.appendChild(this.iconEl);
    input.addEventListener("input", () => { this.value = input.value; this._show(); });
    input.addEventListener("focus", () => this._show());
    input.addEventListener("blur", () => setTimeout(() => this._hide(), 150));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { const first = list.querySelector(".suggest-item"); if (first) first.click(); e.preventDefault(); }
      if (e.key === "Escape") this._hide();
    });
  };
  PropertySuggest.prototype._items = function () {
    let props = [];
    try { props = this.controller && typeof this.controller.getProperties === "function" ? this.controller.getProperties() : []; } catch (e) { props = []; }
    const q = String(this.value || "").toLowerCase();
    return props.filter((id) => {
      if (this.filter && !this.filter(id)) return false;
      if (!q) return true;
      return String(id).toLowerCase().includes(q) || s09PropertyToRef(id).toLowerCase().includes(q);
    });
  };
  PropertySuggest.prototype._show = function () {
    const items = this._items();
    this.listEl.innerHTML = "";
    for (const id of items.slice(0, 50)) {
      const el = document.createElement("div");
      el.className = "suggest-item";
      el.textContent = s09PropertyToRef(id);
      el.addEventListener("mousedown", (e) => { e.preventDefault(); this._pick(id); });
      this.listEl.appendChild(el);
    }
    this.listEl.style.display = items.length ? "" : "none";
    if (items.length && !this._open) { this._open = true; if (this.onOpenCb) this.onOpenCb(); }
  };
  PropertySuggest.prototype._hide = function () {
    this.listEl.style.display = "none";
    if (this._open) { this._open = false; if (this.onCloseCb) this.onCloseCb(); }
  };
  PropertySuggest.prototype._pick = function (id) {
    this.value = id;
    if (this.inputEl) this.inputEl.value = s09PropertyToRef(id);
    this._hide();
    if (this.onSelectCb) this.onSelectCb({ value: id });
  };
  PropertySuggest.prototype.setPlaceholder = function (p) { this.placeholder = p || ""; if (this.inputEl) this.inputEl.placeholder = this.placeholder; return this; };
  PropertySuggest.prototype.filterProperties = function (fn) { this.filter = typeof fn === "function" ? fn : null; return this; };
  PropertySuggest.prototype.setClearable = function (v) { this.clearable = !!v; return this; };
  PropertySuggest.prototype.setValueById = function (id) {
    this.value = String(id || "");
    if (this.inputEl) this.inputEl.value = this.value ? s09PropertyToRef(this.value) : "";
    return this;
  };
  PropertySuggest.prototype.setValue = function (v) { return this.setValueById(v); };
  PropertySuggest.prototype.getValue = function () { return this.value; };
  PropertySuggest.prototype.onSelect = function (cb) { this.onSelectCb = cb; return this; };
  PropertySuggest.prototype.onOpen = function (cb) { this.onOpenCb = cb; return this; };
  PropertySuggest.prototype.onClose = function (cb) { this.onCloseCb = cb; return this; };
  PropertySuggest.prototype.hide = function () { this._hide(); };
  PropertySuggest.prototype.focus = function () { if (this.inputEl) this.inputEl.focus(); return this; };
  return PropertySuggest;
}
export function s09PropertySuggest(host) { ng07H(host); return ng07QryOnceQ("PropertySuggest", ng07BuildPropSuggest); }
