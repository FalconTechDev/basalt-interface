// ng06 query result processing: GroupEntries (one group of grouped data) and
// QueryData (sorted/limited/grouped view of the raw entry list with summary
// aggregates). Replaces s25-bases-toolbar.js's c$/u$ classes.
import { env } from "./env.js";
import { s09DefaultSort } from "./s09-query.js";
import { ng06DefaultSort } from "./n-g06-shared.js";

/** One group of grouped query data: entries plus the optional group key. */
export function ng06DefineGroupEntries() {
  function GroupEntries(entries, key) {
    this.entries = entries || [];
    this.key = key;
  }
  GroupEntries.prototype.hasKey = function () {
    const key = this.key;
    if (key == null) return false;
    try {
      if (typeof key.isTruthy === "function" && !key.isTruthy()) return false;
    } catch (e) { /* not a value */ }
    return !env().gW.equals(key, env().bW.value);
  };
  return GroupEntries;
}

/** Processed result set: stable multi-key sort, limit, grouping and summary values. */
export function ng06DefineQueryData(host) {
  function QueryData(app, config, allProperties, data) {
    this.app = app;
    this.config = config;
    this.allProperties = allProperties;
    this.data = data || [];
    this.highlights = null;
    this.summaryCache = new WeakMap();
    this._grouped = null;
    this._properties = null;
    if (config) {
      this.applySort(this.data);
      this.applyLimit(this.data);
    }
  }

  /** Value used for sorting/grouping comparisons; unreadable values yield null. */
  function ng06EntryValue(entry, property) {
    try {
      const v = entry.getValue(property);
      return v == null || v === env().bW.value ? null : v;
    } catch (e) { return null; }
  }

  /** Category rank helpers for the typed comparisons. */
  function ng06IsBool(v) { return v instanceof env().MW; }
  function ng06IsNum(v) { return v instanceof env().EW; }
  function ng06IsDate(v) { return v instanceof env().LW; }
  function ng06IsDuration(v) { return v instanceof env().OW; }
  function ng06Truthy(v) {
    if (v == null) return false;
    try { if (typeof v.isTruthy === "function") return !!v.isTruthy(); } catch (e) {}
    return !!v;
  }
  function ng06DisplayString(v) {
    if (v == null) return "";
    if ((v instanceof env().BW || v instanceof env().RW) && v.display != null) return String(v.display);
    try { return v.toString(); } catch (e) { return ""; }
  }

  /** Compares two sort values per the spec ordering; negative/positive/0. */
  function ng06CompareValues(a, b) {
    const an = a == null, bn = b == null;
    if (an && bn) return 0;
    if (ng06IsBool(a) || ng06IsBool(b)) return (ng06Truthy(a) ? 1 : 0) - (ng06Truthy(b) ? 1 : 0);
    if (an !== bn) return an ? 1 : -1; // null sorts after non-null
    if (ng06IsNum(a) && ng06IsNum(b)) return a.data - b.data;
    if (ng06IsDate(a) && ng06IsDate(b)) return a.date.getTime() - b.date.getTime();
    if (ng06IsDuration(a) && ng06IsDuration(b)) return a.getMilliseconds() - b.getMilliseconds();
    return env().ub(ng06DisplayString(a), ng06DisplayString(b));
  }

  QueryData.prototype.applySort = function (data) {
    const config = this.config;
    if (!config) return data;
    const known = new Set(this.allProperties || []);
    let specs = (config.getSort() || []).filter((s) => s && s.property && known.has(s.property));
    if (specs.length === 0) specs = ng06DefaultSort;
    const cache = new Map();
    const valueOf = (entry, prop) => {
      const key = entry.file ? entry.file.path + "" + prop : prop;
      if (!cache.has(key)) cache.set(key, ng06EntryValue(entry, prop));
      return cache.get(key);
    };
    const decorated = data.map((entry, index) => ({ entry, index }));
    decorated.sort((x, y) => {
      for (const spec of specs) {
        let av, bv;
        try { av = valueOf(x.entry, spec.property); } catch (e) { av = null; }
        try { bv = valueOf(y.entry, spec.property); } catch (e) { bv = null; }
        let cmp;
        try { cmp = ng06CompareValues(av, bv); } catch (e) { cmp = 0; }
        if (cmp !== 0) return spec.direction === "DESC" ? -cmp : cmp;
      }
      return x.index - y.index;
    });
    for (let i = 0; i < data.length; i++) data[i] = decorated[i].entry;
    return data;
  };

  QueryData.prototype.applyLimit = function (data) {
    const limit = this.config && this.config.getLimit ? this.config.getLimit() : 0;
    if (limit > 0 && data.length > limit) data.length = limit;
    return data;
  };

  /** Groups `data` by the view's groupBy property (first-seen order, sorted keys, keyless last). */
  QueryData.prototype.groupData = function () {
    const config = this.config;
    const GroupEntries = host.s25GroupSet;
    const data = this.data;
    if (!config || !config.groupBy || !config.groupBy.property) {
      return [new GroupEntries(data)];
    }
    const prop = config.groupBy.property;
    const direction = config.groupBy.direction === "DESC" ? -1 : 1;
    const groups = [];
    for (const entry of data) {
      let key = null;
      try {
        const v = entry.getValue(prop);
        key = v == null || v === env().bW.value ? env().bW.value : v;
      } catch (e) { key = env().bW.value; }
      let group = null;
      for (const g of groups) {
        try { if (env().gW.looseEquals(g.key, key)) { group = g; break; } } catch (e) { /* keep looking */ }
      }
      if (!group) { group = new GroupEntries([], key); groups.push(group); }
      group.entries.push(entry);
    }
    const keyed = [], keyless = [];
    for (const g of groups) (g.hasKey() ? keyed : keyless).push(g);
    keyed.sort((a, b) => {
      let cmp;
      try {
        const av = a.key, bv = b.key;
        if (av instanceof env().EW && bv instanceof env().EW) cmp = av.data - bv.data;
        else cmp = env().ub(ng06DisplayString(av), ng06DisplayString(bv));
      } catch (e) { cmp = 0; }
      return cmp * direction;
    });
    return keyed.concat(keyless);
  };

  Object.defineProperty(QueryData.prototype, "groupedData", {
    get() {
      if (!this._grouped) this._grouped = this.groupData();
      return this._grouped;
    },
    enumerable: false, configurable: true,
  });

  Object.defineProperty(QueryData.prototype, "properties", {
    get() {
      if (this._properties) return this._properties;
      const config = this.config, all = this.allProperties;
      if (!config || !all) return (this._properties = []);
      const order = config.getOrder() || [];
      const known = new Set(all);
      const out = [];
      for (const prop of order) {
        let id = prop;
        if (id.startsWith("note.")) {
          try {
            const info = this.app.metadataTypeManager.getPropertyInfo(id.slice(5));
            if (info && info.name && info.name !== id.slice(5)) id = "note." + info.name;
          } catch (e) { /* keep id */ }
        }
        if (known.has(id) && !out.includes(id)) out.push(id);
      }
      return (this._properties = out);
    },
    enumerable: false, configurable: true,
  });

  /** Aggregate value for `property` over `entries` under summary `index`; memoised per entries array. */
  QueryData.prototype.getSummaryValue = function (queryController, entries, property, index) {
    let byEntries = this.summaryCache.get(entries);
    if (!byEntries) this.summaryCache.set(entries, (byEntries = new Map()));
    const memoKey = property + "" + index;
    if (byEntries.has(memoKey)) return byEntries.get(memoKey);
    let result = env().bW.value;
    try {
      const query = queryController.query;
      let type = null;
      const values = [];
      for (const entry of entries) {
        let v = null;
        try { v = entry.getValue(property); } catch (e) { v = null; }
        if (v != null && v !== env().bW.value) {
          values.push(v);
          if (!type) type = v.constructor;
        }
      }
      if (type && query) {
        const formula = query.getSummaryFormula(type, index);
        if (formula) {
          const ctx = new (host.s13SummaryValues)(this.app, values);
          const value = formula.getValue(ctx);
          if (value != null && !(value instanceof env().yW)) result = value;
        }
      }
    } catch (e) { result = env().bW.value; }
    byEntries.set(memoKey, result);
    return result;
  };

  return QueryData;
}
