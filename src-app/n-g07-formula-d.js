// Clean-room formula engine (g07, part D): leaf AST nodes and the values
// contexts used by summary formulas.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07FmlClsD = {};
function ng07FmlOnceD(key, build) { return (ng07FmlClsD[key] ??= build()); }

// ----------------------------------------------------------- PrimitiveNode

function ng07BuildPrimitiveNode() {
  function PrimitiveNode(value) { s09FormulaNode(ng07Host).call(this); this.value = value; }
  inherit(PrimitiveNode, s09FormulaNode(ng07Host));
  PrimitiveNode.prototype.type = "literal";
  PrimitiveNode.prototype.getValue = function () { return s08JsToValue(this.value); };
  PrimitiveNode.prototype.test = function (ctx) { return this.getValue(ctx).isTruthy(); };
  return PrimitiveNode;
}
export function s09PrimitiveNode(host) { ng07H(host); return ng07FmlOnceD("PrimitiveNode", ng07BuildPrimitiveNode); }

// ------------------------------------------------------------ RegexpNode

function ng07BuildRegexpNode() {
  function RegexpNode(pattern, flags) {
    s09FormulaNode(ng07Host).call(this);
    this.pattern = pattern; this.flags = flags || "";
    try { this.regexp = new RegExp(pattern, flags); } catch (e) { this.regexp = null; }
  }
  inherit(RegexpNode, s09FormulaNode(ng07Host));
  RegexpNode.prototype.type = "regexp";
  RegexpNode.prototype.getValue = function () {
    return this.regexp ? new (s08RegExpValue(ng07Host))(this.regexp) : new (s08ErrorValue(ng07Host))("Invalid regex");
  };
  return RegexpNode;
}
export function s09RegexpNode(host) { ng07H(host); return ng07FmlOnceD("RegexpNode", ng07BuildRegexpNode); }

// --------------------------------------------------------------- IdentNode

function ng07BuildIdentNode() {
  function IdentNode(id) { s09FormulaNode(ng07Host).call(this); this.id = id; }
  inherit(IdentNode, s09FormulaNode(ng07Host));
  IdentNode.prototype.type = "identifier";
  IdentNode.prototype.getValue = function (ctx) {
    if (!ctx || typeof ctx.getByIdentifier !== "function") return s08NullValue(ng07Host).value;
    const v = ctx.getByIdentifier(this.id);
    return v === undefined || v === null ? s08NullValue(ng07Host).value : v;
  };
  return IdentNode;
}
export function s09IdentNode(host) { ng07H(host); return ng07FmlOnceD("IdentNode", ng07BuildIdentNode); }

// --------------------------------------------------------------- ParenNode

function ng07BuildParenNode() {
  function ParenNode(value) { s09FormulaNode(ng07Host).call(this); this.value = value; }
  inherit(ParenNode, s09FormulaNode(ng07Host));
  ParenNode.prototype.type = "paren";
  ParenNode.prototype.getValue = function (ctx) { return this.value.getValue(ctx); };
  return ParenNode;
}
export function s09ParenNode(host) { ng07H(host); return ng07FmlOnceD("ParenNode", ng07BuildParenNode); }

// --------------------------------------------------------------- ArrayNode

function ng07BuildArrayNode() {
  function ArrayNode(elements) { s09FormulaNode(ng07Host).call(this); this.elements = elements || []; }
  inherit(ArrayNode, s09FormulaNode(ng07Host));
  ArrayNode.prototype.type = "array";
  ArrayNode.prototype.getValue = function (ctx) {
    return new (s08ListValue(ng07Host))(this.elements.map((e) => e.getValue(ctx)));
  };
  return ArrayNode;
}
export function s09ArrayNode(host) { ng07H(host); return ng07FmlOnceD("ArrayNode", ng07BuildArrayNode); }

// ---------------------------------------------------------- ValuesContext

function ng07BuildValuesContext() {
  function ValuesContext(app, values) {
    this.app = app;
    this.values = values || [];
    this._list = null;
  }
  ValuesContext.prototype.keys = function () { return ["values"]; };
  ValuesContext.prototype.getByIdentifier = function (id) {
    if (String(id).toLowerCase() === "values") {
      if (!this._list) this._list = new (s08ListValue(ng07Host))(this.values);
      return this._list;
    }
    return s08NullValue(ng07Host).value;
  };
  return ValuesContext;
}
export function s09ValuesContext(host) { ng07H(host); return ng07FmlOnceD("ValuesContext", ng07BuildValuesContext); }

function ng07BuildEmptyValuesContext() {
  function EmptyValuesContext(app) { this.app = app; this._list = null; }
  EmptyValuesContext.prototype.keys = function () { return ["values"]; };
  EmptyValuesContext.prototype.getByIdentifier = function (id) {
    if (String(id).toLowerCase() === "values") {
      if (!this._list) this._list = new (s08ListValue(ng07Host))([]);
      return this._list;
    }
    return s08NullValue(ng07Host).value;
  };
  return EmptyValuesContext;
}
export function s09EmptyValuesContext(host) { ng07H(host); return ng07FmlOnceD("EmptyValuesContext", ng07BuildEmptyValuesContext); }
