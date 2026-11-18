// Clean-room query model (g07, part O): FileContext and EvalContext.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07ClsO = {};
function ng07OnceO(key, build) { return (ng07ClsO[key] ??= build()); }

// ------------------------------------------------------------- FileContext

function ng07BuildFileCtx() {
  function FileContext(ctx, file) {
    this.ctx = ctx;
    this.app = ctx && ctx.app ? ctx.app : env().app;
    this.file = file;
    this.formulas = (ctx && ctx.formulas) || {};
    this.frontmatter = ng07Frontmatter(this.app, file);
    this.note = new (env().AW)(this.frontmatter);
    this.implicit = new (env().NW)(this.app, file);
    this.fileValue = this.implicit;
    this.formulaResults = new (s09FormulaResults(ng07Host))(this, this.formulas);
    this._formulaValue = new (s09FormulasValue(ng07Host))(this.formulaResults);
    this._this = new (s09ThisFileValue(ng07Host))(this.app, file);
    this._fm = this.frontmatter;
  }
  FileContext.FILE_PROPERTIES = [
    "file.file", "file.name", "file.basename", "file.fullname", "file.path",
    "file.folder", "file.ext", "file.ctime", "file.mtime", "file.size",
    "file.links", "file.backlinks", "file.embeds", "file.tags",
  ];
  FileContext.prototype.keys = function () {
    const out = Object.keys(this._fm || {});
    for (const k of ["this", "note", "file", "formula"]) if (!out.includes(k)) out.push(k);
    return out;
  };
  FileContext.prototype.getByIdentifier = function (ident) {
    const id = String(ident);
    const lower = id.toLowerCase();
    if (lower === "this") {
      return this.ctx && this.ctx.localFile === this.file ? this._this : env().bW.value;
    }
    if (lower === "note") return this.note;
    if (lower === "file" || lower === "implicit") return this.implicit;
    if (lower === "formula") return this._formulaValue;
    // frontmatter property, case-insensitive
    for (const k of Object.keys(this.frontmatter || {})) {
      if (k.toLowerCase() === lower) {
        try { return this.note.objectAccess(k); } catch (e) { return env().bW.value; }
      }
    }
    return env().bW.value;
  };
  FileContext.prototype.getValue = function (propertyId) {
    const id = String(propertyId || "");
    if (id.startsWith("file.")) {
      const fv = this.implicit;
      return fv && typeof fv.objectAccess === "function" ? fv.objectAccess(id.slice(5)) : env().bW.value;
    }
    if (id.startsWith("note.")) return this.note.objectAccess ? this.note.objectAccess(id.slice(5)) : env().bW.value;
    const dot = id.indexOf(".");
    if (dot < 0) return this.getByIdentifier(id);
    const head = id.slice(0, dot);
    const rest = id.slice(dot + 1);
    const base = this.getByIdentifier(head);
    if (base === env().bW.value || base === null || base === undefined) return env().bW.value;
    if (typeof base.objectAccess === "function") return base.objectAccess(rest);
    return env().bW.value;
  };
  FileContext.prototype.getPropertyKeys = function () { return Object.keys(this.frontmatter || {}); };
  FileContext.prototype.getRawProperty = function (name) { return this.frontmatter ? this.frontmatter[name] : undefined; };
  FileContext.prototype.getFile = function () { return this.file; };
  return FileContext;
}
export function s09FileContext(host) { ng07H(host); return ng07OnceO("FileContext", ng07BuildFileCtx); }

// --------------------------------------------------------------- EvalContext

function ng07BuildEvalCtx() {
  function EvalContext(app, formulas) {
    this.app = app;
    this.formulas = formulas || {};
    this._cache = new Map();
    this._results = new (s09FormulaResults(ng07Host))(this, this.formulas);
    this._formulaValue = new (s09FormulasValue(ng07Host))(this._results);
  }
  EvalContext.prototype.keys = function () { return ["note", "file", "this", "formula"]; };
  EvalContext.prototype.getByIdentifier = function (ident) {
    const id = String(ident);
    const lower = id.toLowerCase();
    if (this._cache.has(lower)) return this._cache.get(lower);
    let value;
    if (lower === "formula") value = this._formulaValue;
    else if (lower === "file" || lower === "this") {
      const file = this.app && this.app.workspace ? this.app.workspace.getActiveFile() : null;
      value = file ? new (env().NW)(this.app, file) : env().bW.value;
    } else if (lower === "note") {
      value = new (env().AW)({});
    } else {
      // custom property default — Null unless declared
      value = env().bW.value;
    }
    this._cache.set(lower, value);
    return value;
  };
  EvalContext.prototype.getPropertyDefault = function (name) { return this.getByIdentifier(name); };
  EvalContext.prototype.evaluateFormula = function (text) {
    try {
      const t = new (env().DK)(String(text));
      if (t.formula instanceof env().RK) return env().bW.value;
      return t.getValue(this);
    } catch (e) { return env().bW.value; }
  };
  EvalContext.prototype.evaluateIdent = function (text) {
    const v = this.evaluateFormula(text);
    return v === undefined ? env().bW.value : v;
  };
  return EvalContext;
}
export function s09EvalContext(host) { ng07H(host); return ng07OnceO("EvalContext", ng07BuildEvalCtx); }
