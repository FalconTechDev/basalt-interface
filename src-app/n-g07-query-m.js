// Clean-room query model (g07, part M): the Query class — YAML round-trip,
// views, filters, formulas, summaries, property configs.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07QryClsM = {};
function ng07QryOnceM(key, build) { return (ng07QryClsM[key] ??= build()); }

function ng07QErrM(key) { const b = env().gm && env().gm.plugins && env().gm.plugins.bases; return b && b[key] ? b[key]() : key; }
function ng07YamlParse(text) {
  try { return env().mA ? env().mA(text) : (typeof text === "object" ? text : null); }
  catch (e) { return null; }
}
function ng07YamlStringify(obj) {
  try { return env().vA ? env().vA(obj) : JSON.stringify(obj, null, 2); }
  catch (e) { return JSON.stringify(obj, null, 2); }
}
function ng07DefaultViewName() {
  const b = env().gm && env().gm.plugins && env().gm.plugins.bases;
  if (b && b.labelDefaultView) { try { return b.labelDefaultView(); } catch (e) {} }
  return "All";
}

function ng07BuildQuery() {
  function Query() {
    this.views = new Ng07IdList();
    this.filters = null;
    this.formulas = {};
    this.summaryFormulas = {};
    this.properties = {};
    this.newItemFolder = "";
    this.newItemTemplate = "";
    this.unrecognizedData = {};
    this.saveFn = null;
  }

  Query.parse = function (data) {
    const q = new Query();
    const d = data && typeof data === "object" ? data : {};
    const known = new Set(["views", "filters", "display", "properties", "formulas", "summaries", "newItemFolder", "newItemTemplate"]);
    for (const k of Object.keys(d)) if (!known.has(k)) q.unrecognizedData[k] = d[k];
    if (d.filters !== undefined) q.filters = s09DeserializeFilter(d.filters);
    if (d.properties && typeof d.properties === "object") {
      for (const [id, cfg] of Object.entries(d.properties)) {
        q.properties[id] = s09PropertyConfig(ng07Host).deserialize(cfg, id, q);
      }
    }
    if (d.formulas && typeof d.formulas === "object") {
      for (const [name, text] of Object.entries(d.formulas)) q.formulas[name] = new (env().DK)(text === undefined ? "" : String(text));
    }
    if (d.summaries && typeof d.summaries === "object") {
      for (const [k, v] of Object.entries(d.summaries)) q.summaryFormulas[k] = v;
    }
    if (typeof d.newItemFolder === "string") q.newItemFolder = d.newItemFolder;
    if (typeof d.newItemTemplate === "string") q.newItemTemplate = d.newItemTemplate;
    if (Array.isArray(d.views)) {
      for (let i = 0; i < d.views.length; i++) q.views.push(s09DeserializeView(q, d.views[i], i));
    }
    if (!q.views.length) q.views.push(new (s09View(ng07Host))(q, "table", ng07DefaultViewName()));
    return q;
  };

  Query.fromString = function (text) {
    const data = ng07YamlParse(text);
    if (!data || typeof data !== "object") return Query.parse({});
    return Query.parse(data);
  };

  Query.prototype.toString = function () { return ng07YamlStringify(this.getSerializable()); };
  Query.prototype.save = function () { if (this.saveFn) this.saveFn(this); };

  Query.prototype.getSerializable = function () {
    const out = {};
    const f = s09SerializeFilter(this.filters);
    out.filters = f === undefined ? {} : f;
    out.formulas = {};
    for (const [k, v] of Object.entries(this.formulas)) out.formulas[k] = v.toString();
    out.summaries = { ...this.summaryFormulas };
    out.properties = {};
    for (const [id, cfg] of Object.entries(this.properties)) {
      const s = cfg.serialize();
      if (s !== undefined) out.properties[id] = s;
    }
    out.views = this.views.map((v) => v.serialize());
    if (this.newItemFolder) out.newItemFolder = this.newItemFolder;
    if (this.newItemTemplate) out.newItemTemplate = this.newItemTemplate;
    Object.assign(out, this.unrecognizedData || {});
    return out;
  };

  Query.prototype.getAll = function () { return this.views[0] ? this.views[0].getAll() : []; };
  Query.prototype.getView = function (view) {
    let files = ng07AppFiles(env().app);
    const ctx = new (s09FilterContext(ng07Host))(env().app, view.filters || this.filters, this.formulas);
    const combined = view.filters && this.filters
      ? s09FilterBase(ng07Host).and(view.filters, this.filters)
      : (view.filters || this.filters);
    ctx.filter = combined;
    files = files.filter((f) => {
      try { return ctx.test(f); } catch (e) { return true; }
    });
    // sort by view order
    const order = view.getOrder ? view.getOrder() : s09DefaultOrder;
    const sort = view.getSort ? view.getSort() : s09DefaultSort;
    const keyOf = (f, pid) => {
      const fc = new (s09FileContext(ng07Host))(ctx, f);
      const v = fc.getValue(pid);
      return v && typeof v.toString === "function" ? v.toString() : "";
    };
    files.sort((a, b) => {
      for (const s of sort) {
        const ka = keyOf(a, s.property), kb = keyOf(b, s.property);
        const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
        if (cmp) return s.direction === "DESC" ? -cmp : cmp;
      }
      return 0;
    });
    const limit = view.getLimit ? view.getLimit() : 0;
    if (limit > 0) files = files.slice(0, limit);
    return files;
  };
  Query.prototype.clone = function () {
    return Query.parse(this.getSerializable());
  };
  Query.prototype.getViewConfig = function (name) {
    if (!name) return this.views[0] || null;
    return this.views.find((v) => v.name === name) || null;
  };

  Query.prototype.getPropertyConfig = function (id) {
    if (!this.properties[id]) this.properties[id] = new (s09PropertyConfig(ng07Host))(this, id);
    return this.properties[id];
  };
  Query.prototype.removePropertyConfig = function (id) { delete this.properties[id]; this.save(); };
  Query.prototype.setGlobalFilters = function (filters) {
    this.filters = filters && typeof filters === "object" && !filters.filters && !filters.rule ? s09DeserializeFilter(filters) : (filters || null);
    this.save();
  };
  Query.prototype.getGlobalFilters = function () { return this.filters; };
  Query.prototype.setViewFilters = function (viewOrName, filters) {
    const view = typeof viewOrName === "string" ? this.getViewConfig(viewOrName) : viewOrName;
    if (!view) return;
    view.filters = filters && typeof filters === "object" && !filters.filters && !filters.rule ? s09DeserializeFilter(filters) : filters;
    this.save();
  };
  Query.prototype.setFormulas = function (formulas) {
    this.formulas = {};
    for (const [k, v] of Object.entries(formulas || {})) this.formulas[k] = new (env().DK)(String(v));
    this.save();
  };
  Query.prototype.setSummaryFormula = function (name, formula) {
    this.summaryFormulas[name] = formula; this.save();
  };
  Query.prototype.getSummaryFormula = function (name) { return this.summaryFormulas[name]; };
  Query.prototype.deleteSummaryFormula = function (name) {
    if (this.summaryFormulas) delete this.summaryFormulas[name];
    this.save();
  };
  Query.prototype.renameSummaryFormula = function (oldName, newName) {
    if (this.summaryFormulas && oldName in this.summaryFormulas) {
      this.summaryFormulas[newName] = this.summaryFormulas[oldName];
      delete this.summaryFormulas[oldName];
    }
    this.save();
  };
  Query.prototype.delete = Query.prototype.deleteSummaryFormula;
  Query.prototype.rename = Query.prototype.renameSummaryFormula;
  Query.prototype.removeFormula = function (name) {
    delete this.formulas[name];
    const pid = "formula." + name;
    delete this.properties[pid];
    for (const v of this.views) {
      if (v.order) v.order = v.order.filter((p) => p !== pid);
      if (v.sort) v.sort = v.sort.filter((s) => s.property !== pid);
      if (v.summaries) v.summaries.delete(pid);
      if (v.groupBy && typeof v.groupBy.serialize === "function" && String(v.groupBy.serialize()).includes(pid)) v.groupBy = null;
    }
    this.save();
  };
  return Query;
}
export function s09Query(host) { ng07H(host); return ng07QryOnceM("Query", ng07BuildQuery); }
