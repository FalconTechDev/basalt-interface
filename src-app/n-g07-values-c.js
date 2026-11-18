// Clean-room property values (g07, part C): String/Null/Number/Boolean scalars.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07ClsC = {};
function ng07OnceC(key, build) { return (ng07ClsC[key] ??= build()); }

// ------------------------------------------------------------ StringValue

function ng07BuildStringValue() {
  function StringValue(data) { s08ScalarValue(ng07Host).call(this, String(data)); }
  inherit(StringValue, s08ScalarValue(ng07Host));
  StringValue.prototype.type = ng07ValueType("text", "lucide-type");
  StringValue.prototype.objectAccess = function (key) {
    if (key === "length") return new (s08NumberValue(ng07Host))(this.data.length);
    return s08AnyValue(ng07Host).prototype.objectAccess.call(this, key);
  };
  StringValue.prototype.keys = function () { return ["length"]; };
  return StringValue;
}
export function s08StringValue(host) { ng07H(host); return ng07OnceC("StringValue", ng07BuildStringValue); }

// ------------------------------------------------------------- NullValue

function ng07BuildNullValue() {
  function NullValue() {
    if (NullValue._sealed) throw new Error("Use NullValue.value");
    s08Value(ng07Host).call(this);
  }
  inherit(NullValue, s08Value(ng07Host));
  NullValue.prototype.type = ng07ValueType("Null", "lucide-ban");
  NullValue.prototype.isTruthy = function () { return false; };
  NullValue.prototype.equals = function (other) { return other instanceof NullValue; };
  NullValue.prototype.looseEquals = NullValue.prototype.equals;
  NullValue.prototype.toString = function () { return ""; };
  NullValue.prototype.objectAccess = function () { return NullValue.value; };
  const inst = new NullValue();
  NullValue.value = inst;
  NullValue._sealed = true;
  return NullValue;
}
export function s08NullValue(host) { ng07H(host); return ng07OnceC("NullValue", ng07BuildNullValue); }

// ------------------------------------------------------------ NumberValue

function ng07BuildNumberValue() {
  function NumberValue(data) { s08ScalarValue(ng07Host).call(this, Number(data)); }
  inherit(NumberValue, s08ScalarValue(ng07Host));
  NumberValue.prototype.type = ng07ValueType("number", "lucide-hash");
  NumberValue.prototype.renderTo = function (el, renderer) {
    const text = !isFinite(this.data) && !isNaN(this.data) ? "∞" : this.toString();
    if (el && typeof el.setText === "function") el.setText(text);
    else if (el) el.textContent = text;
  };
  return NumberValue;
}
export function s08NumberValue(host) { ng07H(host); return ng07OnceC("NumberValue", ng07BuildNumberValue); }

// ----------------------------------------------------------- BooleanValue

function ng07BuildBooleanValue() {
  function BooleanValue(data) { s08ScalarValue(ng07Host).call(this, !!data); }
  inherit(BooleanValue, s08ScalarValue(ng07Host));
  BooleanValue.prototype.type = ng07ValueType("checkbox", "lucide-check-square");
  BooleanValue.prototype.toString = function () { return this.data ? "true" : "false"; };
  BooleanValue.prototype.renderTo = function (el, renderer) {
    if (el && typeof el.empty === "function") el.empty();
    const input = (el && el.doc ? el.doc : document).createElement("input");
    input.type = "checkbox";
    input.checked = this.data;
    input.disabled = true;
    input.className = "metadata-input";
    if (el) el.appendChild(input);
  };
  return BooleanValue;
}
export function s08BooleanValue(host) { ng07H(host); return ng07OnceC("BooleanValue", ng07BuildBooleanValue); }
