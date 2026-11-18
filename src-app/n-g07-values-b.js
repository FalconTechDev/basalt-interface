// Clean-room property values (g07, part B): the value-type registry and the
// base classes AnyValue / Value / ScalarValue with the simple scalars.
// Internal helpers are flat-scope names shared by the n-g07-values-* modules.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

let ng07Host = null;
function ng07H(h) { ng07Host = ng07Host || h; return ng07Host; }
const ng07ClsB = {};
function ng07OnceB(key, build) { return (ng07ClsB[key] ??= build()); }

// ------------------------------------------------------------------ types

const ng07Types = {};
function ng07ValueType(name, icon) {
  return (ng07Types[name] ??= { type: name, icon: icon || "lucide-box" });
}

function ng07Err(msg) {
  const f = env().gm && env().gm.formulas;
  return f && f[msg] ? f[msg]() : msg;
}

// ------------------------------------------------------------- AnyValue

function ng07BuildAnyValue() {
  function AnyValue() {}
  AnyValue.prototype.type = ng07ValueType("any");
  AnyValue.prototype.icon = "lucide-box";
  AnyValue.prototype.isTruthy = function () { return false; };
  AnyValue.prototype.equals = function (other) { return this === other; };
  AnyValue.prototype.looseEquals = function (other) { return this.equals(other); };
  AnyValue.prototype.toString = function () { return ""; };
  AnyValue.prototype.renderTo = function (el, renderer) {
    const text = this.toString();
    if (el && typeof el.setText === "function") el.setText(text);
    else if (el) el.textContent = text;
  };
  AnyValue.prototype.keys = function () { return []; };
  AnyValue.prototype.objectAccess = function (key) {
    throw new Error(ng07Err("msgErrorInvalidObjectAccess"));
  };
  AnyValue.equals = function (a, b) { return a ? (b ? a.equals(b) : false) : !b; };
  AnyValue.looseEquals = function (a, b) { return a ? (b ? a.looseEquals(b) : false) : !b; };
  return AnyValue;
}
export function s08AnyValue(host) { ng07H(host); return ng07OnceB("AnyValue", ng07BuildAnyValue); }

// ---------------------------------------------------------------- Value

function ng07BuildValue() {
  function Value() {}
  inherit(Value, s08AnyValue(ng07Host));
  return Value;
}
export function s08Value(host) { ng07H(host); return ng07OnceB("Value", ng07BuildValue); }

// ---------------------------------------------------------- ScalarValue

function ng07BuildScalarValue() {
  function ScalarValue(data) { this.data = data; }
  inherit(ScalarValue, s08Value(ng07Host));
  ScalarValue.prototype.toString = function () { return this.data === undefined || this.data === null ? "" : String(this.data); };
  ScalarValue.prototype.isTruthy = function () { return !!this.data; };
  ScalarValue.prototype.equals = function (other) { return other instanceof s08ScalarValue(ng07Host) && this.data === other.data; };
  ScalarValue.prototype.looseEquals = ScalarValue.prototype.equals;
  return ScalarValue;
}
export function s08ScalarValue(host) { ng07H(host); return ng07OnceB("ScalarValue", ng07BuildScalarValue); }
