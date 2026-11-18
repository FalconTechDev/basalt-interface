// Clean-room property values (g07, part G): RelativeDateValue and
// DurationValue (ISO-8601 / human duration parsing).
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07ClsG = {};
function ng07OnceG(key, build) { return (ng07ClsG[key] ??= build()); }

// ------------------------------------------------------- RelativeDateValue

function ng07BuildRelativeDateValue() {
  function RelativeDateValue(date) {
    s08Value(ng07Host).call(this);
    this.date = date instanceof Date ? date : new Date(date);
    this._inner = new (s08DateValue(ng07Host))(this.date);
  }
  inherit(RelativeDateValue, s08Value(ng07Host));
  RelativeDateValue.prototype.type = ng07ValueType("date", "lucide-clock");
  RelativeDateValue.prototype.data = undefined;
  Object.defineProperty(RelativeDateValue.prototype, "data", { get() { return this._inner.data; } });
  RelativeDateValue.prototype.toString = function () {
    const diff = Date.now() - this.date.getTime();
    const abs = Math.abs(diff);
    const units = [["year", 31536000000], ["month", 2592000000], ["week", 604800000], ["day", 86400000], ["hour", 3600000], ["minute", 60000]];
    for (const [name, ms] of units) {
      if (abs >= ms) {
        const n = Math.round(abs / ms);
        const t = env().gm.formulas ? env().gm.formulas["relative" + name[0].toUpperCase() + name.slice(1) + "s"] : null;
        return (diff >= 0 ? (t ? t({ count: n }) : `${n} ${name}s ago`) : (t ? t({ count: n }) : `in ${n} ${name}s`));
      }
    }
    return "just now";
  };
  RelativeDateValue.prototype.isTruthy = function () { return true; };
  RelativeDateValue.prototype.equals = function (other) { return other instanceof RelativeDateValue && this.date.getTime() === other.date.getTime(); };
  RelativeDateValue.prototype.looseEquals = RelativeDateValue.prototype.equals;
  return RelativeDateValue;
}
export function s08RelativeDateValue(host) { ng07H(host); return ng07OnceG("RelativeDateValue", ng07BuildRelativeDateValue); }

// ---------------------------------------------------------- DurationValue

const ng07ISO = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;
const ng07HUMAN = /(?:(\d+(?:\.\d+)?)\s*(years?|yrs?|y))?|(?:(\d+(?:\.\d+)?)\s*(months?|mos?|mo))?|(?:(\d+(?:\.\d+)?)\s*(weeks?|w))?|(?:(\d+(?:\.\d+)?)\s*(days?|d))?|(?:(\d+(?:\.\d+)?)\s*(hours?|hrs?|h))?|(?:(\d+(?:\.\d+)?)\s*(minutes?|mins?|m))?|(?:(\d+(?:\.\d+)?)\s*(seconds?|secs?|s))?/gi;

function ng07BuildDurationValue() {
  function DurationValue(parts) {
    s08Value(ng07Host).call(this);
    const p = parts || {};
    this.years = p.years || 0; this.months = p.months || 0; this.weeks = p.weeks || 0;
    this.days = p.days || 0; this.hours = p.hours || 0; this.minutes = p.minutes || 0;
    this.seconds = p.seconds || 0; this.milliseconds = p.milliseconds || 0;
  }
  inherit(DurationValue, s08Value(ng07Host));
  DurationValue.prototype.type = ng07ValueType("duration", "lucide-timer");
  DurationValue.prototype.getMilliseconds = function () {
    return (((((this.years * 365 + this.months * 30 + this.weeks * 7 + this.days) * 24 + this.hours) * 60 + this.minutes) * 60 + this.seconds) * 1000) + this.milliseconds;
  };
  DurationValue.prototype.addToDate = function (date) {
    const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
    d.setFullYear(d.getFullYear() + this.years, d.getMonth() + this.months, d.getDate() + this.weeks * 7 + this.days);
    d.setHours(d.getHours() + this.hours, d.getMinutes() + this.minutes, d.getSeconds() + this.seconds, d.getMilliseconds() + this.milliseconds);
    return d;
  };
  DurationValue.prototype.toString = function () {
    const parts = [];
    const push = (n, u) => { if (n) parts.push(`${n}${u}`); };
    push(this.years, "y"); push(this.months, "mo"); push(this.weeks, "w"); push(this.days, "d");
    push(this.hours, "h"); push(this.minutes, "m"); push(this.seconds, "s"); push(this.milliseconds, "ms");
    return parts.join(" ") || "0s";
  };
  DurationValue.prototype.isTruthy = function () { return this.getMilliseconds() !== 0; };
  DurationValue.prototype.equals = function (other) {
    return other instanceof DurationValue && ["years","months","weeks","days","hours","minutes","seconds","milliseconds"].every((k) => this[k] === other[k]);
  };
  DurationValue.prototype.looseEquals = function (other) {
    return other instanceof DurationValue && Math.abs(this.getMilliseconds() - other.getMilliseconds()) < 1;
  };
  DurationValue.fromMilliseconds = function (ms) {
    ms = Math.round(ms);
    const p = { milliseconds: ms % 1000 };
    let rest = Math.floor(ms / 1000);
    p.seconds = rest % 60; rest = Math.floor(rest / 60);
    p.minutes = rest % 60; rest = Math.floor(rest / 60);
    p.hours = rest % 24; rest = Math.floor(rest / 24);
    p.days = rest % 7; rest = Math.floor(rest / 7);
    p.weeks = rest % 52; p.years = Math.floor(rest / 52);
    return new DurationValue(p);
  };
  DurationValue.parseFromString = function (text) {
    if (typeof text !== "string") return null;
    const t = text.trim();
    const iso = ng07ISO.exec(t);
    if (iso && t.toUpperCase().startsWith("P")) {
      return new DurationValue({
        years: +iso[1] || 0, months: +iso[2] || 0, weeks: +iso[3] || 0, days: +iso[4] || 0,
        hours: +iso[5] || 0, minutes: +iso[6] || 0, seconds: parseFloat(iso[7] || 0),
      });
    }
    const p = {};
    let matched = false, m;
    ng07HUMAN.lastIndex = 0;
    while ((m = ng07HUMAN.exec(t))) {
      const n = parseFloat(m[1] || m[3] || m[5] || m[7] || m[9] || m[11] || m[13] || m[15] || 0);
      const u = (m[2] || m[4] || m[6] || m[8] || m[10] || m[12] || m[14] || m[16] || "").toLowerCase();
      if (!u) continue;
      matched = true;
      if (u.startsWith("y")) p.years = (p.years || 0) + n;
      else if (u.startsWith("mo")) p.months = (p.months || 0) + n;
      else if (u === "w" || u.startsWith("week")) p.weeks = (p.weeks || 0) + n;
      else if (u.startsWith("d")) p.days = (p.days || 0) + n;
      else if (u.startsWith("h")) p.hours = (p.hours || 0) + n;
      else if (u.startsWith("m")) p.minutes = (p.minutes || 0) + n;
      else if (u.startsWith("s")) p.seconds = (p.seconds || 0) + n;
    }
    return matched ? new DurationValue(p) : null;
  };
  return DurationValue;
}
export function s08DurationValue(host) { ng07H(host); return ng07OnceG("DurationValue", ng07BuildDurationValue); }
