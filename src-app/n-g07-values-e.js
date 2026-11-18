// Clean-room property values (g07, part E): ObjectValue — front-matter and
// property maps with lazy per-key coercion.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { keyIgnoringCase } from "./text.js";

const ng07ClsE = {};
function ng07OnceE(key, build) { return (ng07ClsE[key] ??= build()); }

function ng07LooksLikeValue(v) {
  return v && typeof v === "object" && typeof v.isTruthy === "function" && typeof v.equals === "function";
}

function ng07BuildObjectValue() {
  function ObjectValue(entries, evaluator) {
    s08Value(ng07Host).call(this);
    this._raw = entries && typeof entries === "object" ? { ...entries } : {};
    this.lazyEvaluator = evaluator || null;
    this._cache = {};
  }
  inherit(ObjectValue, s08Value(ng07Host));
  ObjectValue.prototype.type = ng07ValueType("object", "lucide-braces");
  ObjectValue.prototype.evaluator = function () { return this.lazyEvaluator || s08JsToValue; };
  ObjectValue.prototype.valuesRaw = function () { return this._raw; };
  ObjectValue.prototype.keys = function () { return Object.keys(this._raw); };
  ObjectValue.prototype.isEmpty = function () { return Object.keys(this._raw).length === 0; };
  ObjectValue.prototype.get = function (key) {
    if (!ng07Has(this._raw, key)) return s08NullValue(ng07Host).value;
    if (!(key in this._cache)) {
      const raw = this._raw[key];
      this._cache[key] = ng07LooksLikeValue(raw) ? raw : this.evaluator()(raw);
    }
    return this._cache[key];
  };
  ObjectValue.prototype.getInsensitive = function (key) {
    const found = keyIgnoringCase(this._raw, key);
    return ng07Has(this._raw, found) ? this.get(found) : s08NullValue(ng07Host).value;
  };
  ObjectValue.prototype.objectAccess = function (key) { return this.getInsensitive(String(key)); };
  ObjectValue.prototype.toString = function () {
    return this.keys().map((k) => `${k}: ${this.get(k).toString()}`).join(", ");
  };
  ObjectValue.prototype.isTruthy = function () { return !this.isEmpty(); };
  ObjectValue.prototype.equals = function (other) {
    if (!(other instanceof ObjectValue)) return false;
    const a = this.keys(), b = other.keys();
    if (a.length !== b.length) return false;
    return a.every((k) => {
      const ok = keyIgnoringCase(other._raw, k);
      return ok !== undefined && this.get(k).equals(other.get(ok));
    });
  };
  ObjectValue.prototype.looseEquals = ObjectValue.prototype.equals;
  ObjectValue.fromFrontMatter = function (app, file, frontmatter) {
    const obj = new ObjectValue({}, null);
    obj.lazyEvaluator = (raw) => ng07FrontmatterValue(app, file, raw);
    for (const key of Object.keys(frontmatter || {})) obj._raw[key] = frontmatter[key];
    return obj;
  };
  return ObjectValue;
}
export function s08ObjectValue(host) { ng07H(host); return ng07OnceE("ObjectValue", ng07BuildObjectValue); }

function ng07Has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

/** Front-matter coercion: tags, links, urls and dates get their own value types. */
function ng07FrontmatterValue(app, file, raw) {
  if (raw === null || raw === undefined) return s08NullValue(ng07Host).value;
  if (Array.isArray(raw)) return new (s08ListValue(ng07Host))(raw.slice(), (v) => ng07FrontmatterValue(app, file, v));
  if (typeof raw === "object" && !(raw instanceof Date) && !ng07LooksLikeValue(raw)) {
    return new ObjectValue({ ...raw }, (v) => ng07FrontmatterValue(app, file, v));
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (/^\[\[.+\]\]$/.test(t)) {
      try { return s08LinkValue(ng07Host).parseFromString ? s08LinkValue(ng07Host).parseFromString(app, t, file && file.path) : s08JsToValue(t); } catch (e) { /* fall through */ }
    }
    if (/^https?:\/\//i.test(t)) return new (s08UrlValue(ng07Host))(t);
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
      const d = s08DateValue(ng07Host).parseFromString(t);
      if (d) return d;
    }
    return s08JsToValue(raw);
  }
  return s08JsToValue(raw);
}
