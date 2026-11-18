// Clean-room property values (g07, part D): ListValue and the tag values.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07ClsD = {};
function ng07OnceD(key, build) { return (ng07ClsD[key] ??= build()); }

function ng07CoerceList(raw, evaluator) {
  const ev = evaluator || s08JsToValue;
  return raw.map((item) => (item && typeof item === "object" && item.constructor && item.constructor.name.endsWith("Value")) ? item : ev(item));
}

// ------------------------------------------------------------- ListValue

function ng07BuildListValue() {
  function ListValue(elements, evaluator) {
    s08Value(ng07Host).call(this);
    this._raw = Array.isArray(elements) ? elements.slice() : [];
    this.lazyEvaluator = evaluator || null;
    this._cache = null;
  }
  inherit(ListValue, s08Value(ng07Host));
  ListValue.prototype.type = ng07ValueType("multitext", "lucide-list");
  ListValue.prototype.evaluator = function () { return this.lazyEvaluator || s08JsToValue; };
  Object.defineProperty(ListValue.prototype, "data", {
    get() {
      if (!this._cache) this._cache = ng07CoerceList(this._raw, this.evaluator());
      return this._cache;
    },
  });
  ListValue.prototype.length = function () { return this.data.length; };
  ListValue.prototype.get = function (index) { return this.data[index]; };
  ListValue.prototype.toString = function () { return this.data.map((v) => v.toString()).join(", "); };
  ListValue.prototype.isTruthy = function () { return this.data.length > 0; };
  ListValue.prototype.equals = function (other) {
    if (!(other instanceof ListValue)) return false;
    const a = this.data, b = other.data;
    return a.length === b.length && a.every((v, i) => v.equals(b[i]));
  };
  ListValue.prototype.looseEquals = function (other) {
    const a = this.data;
    if (other instanceof ListValue) {
      const b = other.data;
      return a.length === b.length && a.every((v, i) => v.looseEquals(b[i]));
    }
    if (a.length === 1) return a[0].looseEquals(other);
    return false;
  };
  ListValue.prototype.keys = function () { return ["length"]; };
  ListValue.prototype.objectAccess = function (key) {
    if (key === "length") return new (s08NumberValue(ng07Host))(this.data.length);
    return s08AnyValue(ng07Host).prototype.objectAccess.call(this, key);
  };
  ListValue.prototype.includes = function (value) {
    return this.data.some((v) => v.equals(value) || v.looseEquals(value));
  };
  ListValue.prototype.getNumbers = function () { return this.data.filter((v) => v instanceof s08NumberValue(ng07Host)).map((v) => v.data); };
  ListValue.prototype.getDates = function () { return this.data.filter((v) => v instanceof s08DateValue(ng07Host)).map((v) => v.date); };
  ListValue.prototype.slice = function (a, b) { return new ListValue(this.data.slice(a, b), this.evaluator()); };
  ListValue.prototype.concat = function (other) { return new ListValue([...this.data, ...(other instanceof ListValue ? other.data : [other])], this.evaluator()); };
  ListValue.prototype.reverse = function () { return new ListValue([...this.data].reverse(), this.evaluator()); };
  ListValue.prototype.flatten = function () {
    const out = [];
    for (const v of this.data) if (v instanceof ListValue) out.push(...v.data); else out.push(v);
    return new ListValue(out, this.evaluator());
  };
  ListValue.prototype.unique = function () {
    const out = [];
    for (const v of this.data) if (!out.some((u) => u.equals(v))) out.push(v);
    return new ListValue(out, this.evaluator());
  };
  ListValue.prototype.compare = function (other, loose) {
    const b = other instanceof ListValue ? other.data : [other];
    const n = Math.min(this.data.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = this.data[i], y = b[i];
      const xs = x.toString(), ys = y.toString();
      if (xs !== ys) return xs < ys ? -1 : 1;
    }
    return this.data.length - b.length;
  };
  ListValue.prototype.sort = function () {
    return new ListValue([...this.data].sort((x, y) => x.toString().localeCompare(y.toString())), this.evaluator());
  };
  ListValue.prototype.sum = function () { return new (s08NumberValue(ng07Host))(this.getNumbers().reduce((a, b) => a + b, 0)); };
  ListValue.prototype.mean = function () { const n = this.getNumbers(); return new (s08NumberValue(ng07Host))(n.length ? n.reduce((a, b) => a + b, 0) / n.length : NaN); };
  ListValue.prototype.median = function () { const n = this.getNumbers().sort((a, b) => a - b); if (!n.length) return new (s08NumberValue(ng07Host))(NaN); const m = n.length >> 1; return new (s08NumberValue(ng07Host))(n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2); };
  ListValue.prototype.min = function () { const n = this.getNumbers(); return new (s08NumberValue(ng07Host))(n.length ? Math.min(...n) : NaN); };
  ListValue.prototype.max = function () { const n = this.getNumbers(); return new (s08NumberValue(ng07Host))(n.length ? Math.max(...n) : NaN); };
  ListValue.prototype.stddev = function () {
    const n = this.getNumbers(); if (n.length < 2) return new (s08NumberValue(ng07Host))(0);
    const mean = n.reduce((a, b) => a + b, 0) / n.length;
    return new (s08NumberValue(ng07Host))(Math.sqrt(n.reduce((a, b) => a + (b - mean) ** 2, 0) / (n.length - 1)));
  };
  ListValue.prototype.earliest = function () { const d = this.getDates(); return d.length ? new (s08DateValue(ng07Host))(new Date(Math.min(...d.map((x) => x.getTime())))) : s08NullValue(ng07Host).value; };
  ListValue.prototype.latest = function () { const d = this.getDates(); return d.length ? new (s08DateValue(ng07Host))(new Date(Math.max(...d.map((x) => x.getTime())))) : s08NullValue(ng07Host).value; };
  ListValue.prototype.join = function (sep) { return new (s08StringValue(ng07Host))(this.data.map((v) => v.toString()).join(sep === undefined ? ", " : String(sep))); };
  return ListValue;
}
export function s08ListValue(host) { ng07H(host); return ng07OnceD("ListValue", ng07BuildListValue); }

// --------------------------------------------------------------- TagValue

function ng07BuildTagValue() {
  function TagValue(tag) { s08ScalarValue(ng07Host).call(this, ng07NormalizeTag(tag)); }
  inherit(TagValue, s08ScalarValue(ng07Host));
  TagValue.prototype.type = ng07ValueType("tags", "lucide-tag");
  TagValue.prototype.tagMatches = function (other) {
    const a = String(this.data).toLowerCase(), b = String(other && other.data !== undefined ? other.data : other).toLowerCase();
    return a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
  };
  TagValue.prototype.renderTo = function (el, renderer) {
    if (renderer && typeof renderer.renderTag === "function") { renderer.renderTag(el, this.data); return; }
    s08AnyValue(ng07Host).prototype.renderTo.call(this, el, renderer);
  };
  return TagValue;
}
export function s08TagValue(host) { ng07H(host); return ng07OnceD("TagValue", ng07BuildTagValue); }

function ng07NormalizeTag(tag) {
  let t = String(tag || "").trim();
  if (t.startsWith("#")) t = t.slice(1);
  return t;
}

// -------------------------------------------------------------- TagsValue

function ng07BuildTagsValue() {
  function TagsValue(tags) {
    s08Value(ng07Host).call(this);
    this._tags = (Array.isArray(tags) ? tags : [tags]).map((t) => new (s08TagValue(ng07Host))(t));
  }
  inherit(TagsValue, s08Value(ng07Host));
  TagsValue.prototype.type = ng07ValueType("tags", "lucide-tags");
  Object.defineProperty(TagsValue.prototype, "data", { get() { return this._tags.map((t) => t.data); } });
  TagsValue.prototype.length = function () { return this._tags.length; };
  TagsValue.prototype.get = function (i) { return this._tags[i]; };
  TagsValue.prototype.toString = function () { return this._tags.map((t) => "#" + t.data).join(", "); };
  TagsValue.prototype.isTruthy = function () { return this._tags.length > 0; };
  TagsValue.prototype.includes = function (tag) {
    const t = tag instanceof s08TagValue(ng07Host) ? tag : new (s08TagValue(ng07Host))(tag);
    return this._tags.some((x) => x.tagMatches(t));
  };
  TagsValue.prototype.keys = function () { return ["length"]; };
  TagsValue.prototype.objectAccess = function (key) {
    if (key === "length") return new (s08NumberValue(ng07Host))(this._tags.length);
    return s08AnyValue(ng07Host).prototype.objectAccess.call(this, key);
  };
  TagsValue.prototype.equals = function (other) {
    return other instanceof TagsValue && this._tags.length === other._tags.length && this._tags.every((t, i) => t.equals(other._tags[i]));
  };
  TagsValue.prototype.looseEquals = TagsValue.prototype.equals;
  return TagsValue;
}
export function s08TagsValue(host) { ng07H(host); return ng07OnceD("TagsValue", ng07BuildTagsValue); }
