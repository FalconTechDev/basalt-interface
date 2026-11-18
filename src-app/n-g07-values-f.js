// Clean-room property values (g07, part F): RegExp, Date, RelativeDate and
// Duration values.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07ClsF = {};
function ng07OnceF(key, build) { return (ng07ClsF[key] ??= build()); }

// ------------------------------------------------------------ RegExpValue

function ng07BuildRegExpValue() {
  function RegExpValue(regexp) {
    s08Value(ng07Host).call(this);
    this.data = regexp instanceof RegExp ? regexp : new RegExp(String(regexp));
  }
  inherit(RegExpValue, s08Value(ng07Host));
  RegExpValue.prototype.type = ng07ValueType("regexp", "lucide-regex");
  RegExpValue.prototype.toString = function () { return this.data.toString(); };
  RegExpValue.prototype.isTruthy = function () { return true; };
  RegExpValue.prototype.equals = function (other) { return other instanceof RegExpValue && String(this.data) === String(other.data); };
  RegExpValue.prototype.looseEquals = RegExpValue.prototype.equals;
  return RegExpValue;
}
export function s08RegExpValue(host) { ng07H(host); return ng07OnceF("RegExpValue", ng07BuildRegExpValue); }

// -------------------------------------------------------------- DateValue

const ng07DateOnly = /^\d{4}-\d{2}-\d{2}$/;

function ng07BuildDateValue() {
  function DateValue(date, dateOnly) {
    s08ScalarValue(ng07Host).call(this, date instanceof Date ? date : new Date(date));
    this.dateOnlyFlag = !!dateOnly;
  }
  inherit(DateValue, s08ScalarValue(ng07Host));
  DateValue.prototype.type = ng07ValueType("date", "lucide-calendar");
  Object.defineProperty(DateValue.prototype, "date", { get() { return this.data; } });
  Object.defineProperty(DateValue.prototype, "time", { get() { return this.data; } });
  DateValue.prototype.getTime = function () { return this.data.getTime(); };
  DateValue.prototype.printDate = function () {
    return this.dataOnly
      ? this.data.toLocaleDateString()
      : this.data.toLocaleString();
  };
  DateValue.prototype.dateOnly = function () { return new DateValue(new Date(this.data.getFullYear(), this.data.getMonth(), this.data.getDate()), true); };
  DateValue.prototype.printTime = function () { return this.data.toLocaleTimeString(); };
  DateValue.prototype.relative = function () {
    const diff = Date.now() - this.data.getTime();
    const r = new (s08RelativeDateValue(ng07Host))(this.data);
    return r;
  };
  DateValue.prototype.toString = function () { return this.printDate(); };
  DateValue.prototype.isTruthy = function () { return !isNaN(this.data.getTime()); };
  DateValue.prototype.equals = function (other) {
    return other instanceof DateValue && this.data.getTime() === other.data.getTime() && this.dateOnlyFlag === other.dateOnlyFlag;
  };
  DateValue.prototype.looseEquals = function (other) {
    if (!(other instanceof DateValue)) return false;
    if (this.dateOnlyFlag || other.dateOnlyFlag) {
      const a = new Date(this.data.getFullYear(), this.data.getMonth(), this.data.getDate()).getTime();
      const b = new Date(other.data.getFullYear(), other.data.getMonth(), other.data.getDate()).getTime();
      return a === b;
    }
    return this.data.getTime() === other.data.getTime();
  };
  DateValue.parseFromString = function (text) {
    if (typeof text !== "string") return null;
    const t = text.trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (m) return new DateValue(new Date(+m[1], +m[2] - 1, +m[3]), true);
    m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(t);
    if (m) return new DateValue(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)), false);
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : new DateValue(d, ng07DateOnly.test(t));
  };
  return DateValue;
}
export function s08DateValue(host) { ng07H(host); return ng07OnceF("DateValue", ng07BuildDateValue); }
