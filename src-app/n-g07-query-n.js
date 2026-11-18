// Clean-room query model (g07, part N): evaluation contexts — FilterContext,
// FileContext, FormulaResults, ThisFileValue, FormulasValue, EvalContext.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07QryClsN = {};
function ng07QryOnceN(key, build) { return (ng07QryClsN[key] ??= build()); }

function ng07AppFiles(app) {
  try {
    const vault = app && app.vault;
    if (vault && typeof vault.getMarkdownFiles === "function") return vault.getMarkdownFiles();
  } catch (e) { /* noop */ }
  try {
    const a = env().app;
    if (a && a.vault && typeof a.vault.getMarkdownFiles === "function") return a.vault.getMarkdownFiles();
  } catch (e) { /* noop */ }
  return [];
}
function ng07Frontmatter(app, file) {
  try {
    const cache = app && app.metadataCache ? app.metadataCache : (env().app && env().app.metadataCache);
    const fm = cache && typeof cache.getFileCache === "function" ? cache.getFileCache(file) : null;
    return (fm && fm.frontmatter) || {};
  } catch (e) { return {}; }
}

// ---------------------------------------------------------- FormulaResults

function ng07BuildFormulaResults() {
  function FormulaResults(ctx, formulas) {
    this.ctx = ctx;
    this.formulas = formulas || {};
    this.cachedFormulaOutputs = new Map();
    this.evaluating = new Set();
  }
  FormulaResults.prototype.getFormulaValue = function (name) {
    const key = String(name).toLowerCase();
    if (this.cachedFormulaOutputs.has(key)) return this.cachedFormulaOutputs.get(key);
    if (this.evaluating.has(key)) {
      const gm = env().gm || {};
      const msg = gm.formulas && gm.formulas.msgErrorInfiniteLoop ? gm.formulas.msgErrorInfiniteLoop() : "Infinite loop in formula";
      throw new Error(msg);
    }
    let formula = null;
    for (const [k, v] of Object.entries(this.formulas || {})) {
      if (String(k).toLowerCase() === key) { formula = v; break; }
    }
    if (!formula) return env().bW.value;
    this.evaluating.add(key);
    let value;
    try {
      value = formula instanceof env().DK ? formula.getValue(this.ctx) : s08FormulaValue(this.ctx, String(formula));
    } catch (e) {
      value = new (s08ErrorValue(ng07Host))(e && e.message ? e.message : String(e));
    }
    this.evaluating.delete(key);
    this.cachedFormulaOutputs.set(key, value);
    return value;
  };
  return FormulaResults;
}
export function s09FormulaResults(host) { ng07H(host); return ng07QryOnceN("FormulaResults", ng07BuildFormulaResults); }

// ---------------------------------------------------------- ThisFileValue

function ng07BuildThisFile() {
  function ThisFileValue(app, file, entry) {
    this.app = app;
    this.file = file;
    this.entry = entry || null;
    this._fileValue = new (env().NW)(app, file);
  }
  ThisFileValue.prototype.toString = function () { return this.file ? this.file.path : ""; };
  ThisFileValue.prototype.objectAccess = function (key) { return this._fileValue.objectAccess(key); };
  ThisFileValue.prototype.equals = function (other) { return other instanceof ThisFileValue && other.file === this.file; };
  return ThisFileValue;
}
export function s09ThisFileValue(host) { ng07H(host); return ng07QryOnceN("ThisFileValue", ng07BuildThisFile); }

// ----------------------------------------------------------- FormulasValue

function ng07BuildFormulasValue() {
  function FormulasValue(results) { this.results = results; }
  FormulasValue.prototype.keys = function () { return this.results ? Object.keys(this.results.formulas) : []; };
  FormulasValue.prototype.objectAccess = function (key) {
    const v = this.results.getFormulaValue(key);
    if (v instanceof env().yW) throw new Error(v.message);
    return v;
  };
  FormulasValue.prototype.toString = function () { return ""; };
  return FormulasValue;
}
export function s09FormulasValue(host) { ng07H(host); return ng07QryOnceN("FormulasValue", ng07BuildFormulasValue); }

// ------------------------------------------------------------ FilterContext

function ng07BuildFilterCtx() {
  function FilterContext(app, filter, formulas, file) {
    this.app = app;
    this.filter = filter;
    this.formulas = formulas || {};
    this.localFile = file || null;
    this.localUsed = false;
    this._fileCtx = null;
  }
  Object.defineProperty(FilterContext.prototype, "local", {
    get() { return this.localFile; },
    set(v) { this.localFile = v; this.regenerateLocal(); },
  });
  FilterContext.prototype.regenerateLocal = function () {
    this.localUsed = false;
    this._fileCtx = this.localFile ? new (s09FileContext(ng07Host))(this, this.localFile) : null;
  };
  FilterContext.prototype.getLocalFileContext = function () {
    if (!this._fileCtx && this.localFile) this.regenerateLocal();
    return this._fileCtx;
  };
  FilterContext.prototype.test = function (file) {
    const ctx = file ? new (s09FileContext(ng07Host))(this, file) : this.getLocalFileContext();
    if (!ctx || !this.filter) return true;
    try { return !!this.filter.test(ctx); } catch (e) { return false; }
  };
  return FilterContext;
}
export function s09FilterContext(host) { ng07H(host); return ng07QryOnceN("FilterContext", ng07BuildFilterCtx); }
