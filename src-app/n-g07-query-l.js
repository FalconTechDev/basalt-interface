// Clean-room query model (g07, part L): DeserializeView and the View class.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07QryClsL = {};
function ng07QryOnceL(key, build) { return (ng07QryClsL[key] ??= build()); }

function ng07QErrL(key) { const b = env().gm && env().gm.plugins && env().gm.plugins.bases; return b && b[key] ? b[key]() : key; }

// ---------------------------------------------------------- DeserializeView

/** `Cy` — YAML view object -> View (validates type/name; throws localized). */
export function s09DeserializeView(query, data, index) {
  const raw = data && typeof data === "object" ? data : {};
  const type = typeof raw.type === "string" ? raw.type : "";
  if (!["table", "cards", "list"].includes(type)) {
    throw new Error(ng07QErrL("unknownViewType"));
  }
  const name = typeof raw.name === "string" && raw.name ? raw.name : ng07QErrL("unnamedView");
  const view = new (s09View(ng07Host))(query, type, name);
  if (raw.filters !== undefined) view.filters = s09DeserializeFilter(raw.filters) || view.filters;
  if (raw.groupBy !== undefined) view.groupBy = s09DeserializeFilter(raw.groupBy);
  if (raw.order) view.setOrder(Array.isArray(raw.order) ? raw.order : [raw.order]);
  if (raw.sort) {
    if (typeof raw.sort === "string") view.setSortProperty(raw.sort, raw.sortDirection || "ASC");
    else if (Array.isArray(raw.sort)) view.setSortProperty(raw.sort);
    else view.setSortProperty([raw.sort]);
  }
  if (raw.limit !== undefined) view.setLimit(raw.limit);
  if (raw.summaries && typeof raw.summaries === "object") {
    for (const [k, v] of Object.entries(raw.summaries)) {
      if (v === "Average" || v === "Min" || v === "Max" || v === "Sum" || v === "Count") {
        view.setSummaryKey(k, v);
      }
    }
  }
  if (raw.data && typeof raw.data === "object") view.data = raw.data;
  return view;
}

// --------------------------------------------------------------- View

// Array subclass with the mutation helpers the Bases UI expects (.remove/.has).
class Ng07IdList extends Array {
  remove(item) { const i = this.indexOf(item); if (i >= 0) this.splice(i, 1); return this; }
  has(item) { return this.includes(item); }
}

function ng07BuildView() {
  function View(query, type, name) {
    this.query = query;
    this.type = type;
    this.name = name;
    this.filters = null;
    this.order = null;
    this.sort = null;
    this.limit = 0;
    this.summaries = new Map();
    this.groupBy = null;
    this.data = {};
  }
  View.prototype.getViewName = function () { return this.name; };
  View.prototype.setViewName = function (name) { this.name = name; if (this.query) this.query.save(); };
  View.prototype.getAll = function () { return this.query ? this.query.getAll() : []; };
  View.prototype.get = function () { return this.query ? this.query.getView(this) : this.getAll(); };
  View.prototype.getAsPropertyId = function (id) { return String(id || ""); };
  View.prototype.getEvaluatedFormula = function () { return null; };
  View.prototype.getDisplayName = function (propertyId) {
    if (propertyId === undefined || propertyId === null) return this.name;
    if (this.query) {
      const cfg = this.query.getPropertyConfig(propertyId);
      if (cfg && cfg.displayName) return cfg.displayName;
    }
    const labels = s09FilePropLabels();
    const fn = labels[propertyId];
    if (fn) return fn();
    const i = String(propertyId || "").indexOf(".");
    return i >= 0 ? String(propertyId).slice(i + 1) : String(propertyId || "");
  };
  View.prototype.set = function (key, value) {
    if (key === "order" || key === "sort" || key === "limit" || key === "groupBy" || key === "filters") {
      if (key === "order") this.setOrder(value);
      else if (key === "sort") this.setSortProperty(value);
      else if (key === "limit") this.setLimit(value);
      else if (key === "groupBy") this.setGroupBy(value);
      else this.filters = value;
    } else {
      this.data[key] = value;
    }
    if (this.query) this.query.save();
  };

  View.prototype.getOrder = function () {
    const raw = this.order && this.order.length ? this.order : s09DefaultOrder;
    // note.* front-matter columns appear only when explicitly configured
    return new Ng07IdList(...raw.filter((p) => !s09IsCustomProperty(p, this.query) || (this.query && this.query.properties && this.query.properties[p])));
  };
  View.prototype.setOrder = function (order) { this.order = order ? order.slice() : null; if (this.query) this.query.save(); };
  View.prototype.getSort = function () {
    if (this.sort && this.sort.length) return this.sort.map((s) => ({ property: s.property, direction: s.direction }));
    return [{ property: "file.name", direction: "ASC" }];
  };
  View.prototype.setSortProperty = function (sort, direction) {
    if (typeof sort === "string") {
      this.sort = [{ property: sort, direction: direction || "ASC" }];
    } else {
      this.sort = Array.isArray(sort) ? sort.map((s) => ({ property: s.property, direction: s.direction || "ASC" })) : null;
    }
    if (this.query) this.query.save();
  };
  View.prototype.getLimit = function () { return this.limit || 0; };
  View.prototype.setLimit = function (limit) { this.limit = Math.max(0, limit | 0); if (this.query) this.query.save(); };
  View.prototype.getGroupBy = function () { return this.groupBy; };
  View.prototype.setGroupBy = function (groupBy) { this.groupBy = groupBy || null; if (this.query) this.query.save(); };
  View.prototype.getPropertyConfig = function (id) { return this.query ? this.query.getPropertyConfig(id) : null; };
  View.prototype.getSummaryKey = function (propId) { return this.summaries.get(propId) || null; };
  View.prototype.setSummaryKey = function (propId, key) {
    if (!key) this.summaries.delete(propId); else this.summaries.set(propId, key);
    if (this.query) this.query.save();
  };
  View.prototype.clone = function () {
    const v = new View(this.query, this.type, this.name);
    v.filters = this.filters; v.order = this.order && this.order.slice();
    v.sort = this.sort && this.sort.map((s) => ({ ...s }));
    v.limit = this.limit; v.groupBy = this.groupBy;
    v.summaries = new Map(this.summaries); v.data = { ...this.data };
    return v;
  };
  View.prototype.serialize = function () {
    const out = { type: this.type, name: this.name };
    const f = s09SerializeFilter(this.filters);
    if (f !== undefined) out.filters = f;
    if (this.groupBy) { const g = s09SerializeFilter(this.groupBy); if (g !== undefined) out.groupBy = g; }
    out.order = this.order && this.order.length ? this.order.slice() : s09DefaultOrder.slice();
    if (this.summaries.size) {
      out.summaries = {};
      for (const [k, v] of this.summaries) out.summaries[k] = v;
    }
    out.sort = this.getSort();
    out.limit = this.getLimit();
    if (this.data && Object.keys(this.data).length) out.data = this.data;
    return out;
  };
  return View;
}
export function s09View(host) { ng07H(host); return ng07QryOnceL("View", ng07BuildView); }
