// Clean-room query model (g07, part J): conjunction/and/or/not filters and
// YAML (de)serialization helpers.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07QryClsJ = {};
function ng07QryOnceJ(key, build) { return (ng07QryClsJ[key] ??= build()); }

// ------------------------------------------------------- ConjunctionFilter

function ng07BuildConjunction() {
  function ConjunctionFilter(conjunction, filters) {
    s09FilterBase(ng07Host).call(this);
    this.conjunction = conjunction;
    this.filters = (filters || []).filter(Boolean);
  }
  inherit(ConjunctionFilter, s09FilterBase(ng07Host));
  ConjunctionFilter.prototype.getFilters = function () { return this.filters.slice(); };
  ConjunctionFilter.prototype.setFilters = function (filters) { this.filters = (filters || []).filter(Boolean); };
  ConjunctionFilter.prototype.serialize = function () {
    const inner = this.filters.map((f) => f.serialize());
    if (this.filters.length === 1) return inner[0];
    return inner.length === 0 ? {} : { [this.conjunction]: inner };
  };
  ConjunctionFilter.prototype.test = function (ctx) {
    const tests = this.filters.map((f) => () => f.test(ctx));
    if (this.conjunction === "and") return tests.every((t) => t());
    return tests.some((t) => t());
  };
  ConjunctionFilter.prototype.hasError = function () { return this.filters.some((f) => f.hasError()); };
  ConjunctionFilter.prototype.optimize = function () {
    const flat = [];
    for (const f of this.filters) {
      const opt = f.optimize();
      if (opt && opt instanceof s09ConjunctionFilter(ng07Host) && opt.conjunction === this.conjunction && !(opt instanceof s09NotFilter(ng07Host))) {
        flat.push(...opt.filters);
      } else flat.push(opt);
    }
    this.filters = flat;
    if (this.filters.length === 0) return null;
    if (this.filters.length === 1) return this.filters[0];
    return this;
  };
  ConjunctionFilter.prototype.getFilterRulesWithNegation = function (negated) {
    const out = [];
    for (const f of this.filters) {
      const flip = this.conjunction === "or" ? !negated : negated;
      out.push(...f.getFilterRulesWithNegation(flip));
    }
    return out;
  };
  return ConjunctionFilter;
}
export function s09ConjunctionFilter(host) { ng07H(host); return ng07QryOnceJ("ConjunctionFilter", ng07BuildConjunction); }

function ng07BuildAnd() {
  function AndFilter(filters) { s09ConjunctionFilter(ng07Host).call(this, "and", filters); }
  inherit(AndFilter, s09ConjunctionFilter(ng07Host));
  return AndFilter;
}
export function s09AndFilter(host) { ng07H(host); return ng07QryOnceJ("AndFilter", ng07BuildAnd); }

function ng07BuildOr() {
  function OrFilter(filters) { s09ConjunctionFilter(ng07Host).call(this, "or", filters); }
  inherit(OrFilter, s09ConjunctionFilter(ng07Host));
  return OrFilter;
}
export function s09OrFilter(host) { ng07H(host); return ng07QryOnceJ("OrFilter", ng07BuildOr); }

function ng07BuildNot() {
  function NotFilter(filters) {
    s09ConjunctionFilter(ng07Host).call(this, "and", filters);
    this.conjunction = "not";
  }
  inherit(NotFilter, s09ConjunctionFilter(ng07Host));
  NotFilter.prototype.test = function (ctx) {
    return !this.filters.some((f) => f.test(ctx));
  };
  return NotFilter;
}
export function s09NotFilter(host) { ng07H(host); return ng07QryOnceJ("NotFilter", ng07BuildNot); }

// ------------------------------------------------------------- deserialize

/** `Hy` — YAML filter data -> FilterBase tree (throws localized error). */
export function s09DeserializeFilter(data) {
  if (data === null || data === undefined) return null;
  if (typeof data === "string") return new (s09RuleFilter(ng07Host))(data);
  if (typeof data === "object" && !Array.isArray(data)) {
    // parsed formula JSON -> rule filter
    if (typeof data.type === "string" && !("and" in data) && !("or" in data) && !("not" in data)) {
      return new (s09RuleFilter(ng07Host))(data);
    }
    const keys = Object.keys(data);
    if (keys.length === 1) {
      const k = keys[0];
      if (k === "and" || k === "or") {
        const inner = data[k];
        const list = Array.isArray(inner) ? inner : [inner];
        const filters = list.map(s09DeserializeFilter).filter(Boolean);
        return new (k === "and" ? s09AndFilter(ng07Host) : s09OrFilter(ng07Host))(filters);
      }
      if (k === "not") {
        const inner = data.not;
        const list = Array.isArray(inner) ? inner : [inner];
        return new (s09NotFilter(ng07Host))(list.map(s09DeserializeFilter).filter(Boolean));
      }
    }
  }
  throw new Error(ng07ErrKey("invalidFilterSyntax"));
}

/** `gy` — FilterBase -> YAML data. */
export function s09SerializeFilter(filter) {
  if (!filter) return undefined;
  const out = filter.serialize();
  return out && typeof out === "object" && Object.keys(out).length === 0 ? undefined : out;
}
