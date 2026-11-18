// Clean-room formula engine (g07, part E): unary/binary operator nodes.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07FmlClsE = {};
function ng07FmlOnceE(key, build) { return (ng07FmlClsE[key] ??= build()); }

function ng07FmlErrE(key) { const f = env().gm && env().gm.formulas; return f && f[key] ? f[key]() : key; }
const ng07Null = () => s08NullValue(ng07Host).value;
const ng07Bool = (b) => new (s08BooleanValue(ng07Host))(b);
const ng07Num = (n) => new (s08NumberValue(ng07Host))(n);

function ng07Numeric(v) {
  if (v instanceof s08NumberValue(ng07Host)) return v.data;
  if (v instanceof s08BooleanValue(ng07Host)) return v.data ? 1 : 0;
  return NaN;
}

// -------------------------------------------------------------- NotNode

function ng07BuildNotNode() {
  function NotNode(expr) { s09FormulaNode(ng07Host).call(this); this.expr = expr; }
  inherit(NotNode, s09FormulaNode(ng07Host));
  NotNode.prototype.type = "unary";
  NotNode.prototype.getValue = function (ctx) { return ng07Bool(!this.expr.getValue(ctx).isTruthy()); };
  return NotNode;
}
export function s09NotNode(host) { ng07H(host); return ng07FmlOnceE("NotNode", ng07BuildNotNode); }

// ---------------------------------------------------------- NegateNode

function ng07BuildNegateNode() {
  function NegateNode(expr) { s09FormulaNode(ng07Host).call(this); this.expr = expr; }
  inherit(NegateNode, s09FormulaNode(ng07Host));
  NegateNode.prototype.type = "unary";
  NegateNode.prototype.getValue = function (ctx) {
    const v = this.expr.getValue(ctx);
    if (v instanceof s08NullValue(ng07Host)) return v;
    if (v instanceof s08NumberValue(ng07Host)) return ng07Num(-v.data);
    if (v instanceof s08DurationValue(ng07Host)) {
      return s08DurationValue(ng07Host).fromMilliseconds(-v.getMilliseconds());
    }
    throw new Error(ng07FmlErrE("msgErrorTypeError"));
  };
  return NegateNode;
}
export function s09NegateNode(host) { ng07H(host); return ng07FmlOnceE("NegateNode", ng07BuildNegateNode); }

// ---------------------------------------------------------- CompareNode

function ng07BuildCompareNode() {
  function CompareNode(op, left, right) { s09FormulaNode(ng07Host).call(this); this.op = op; this.left = left; this.right = right; }
  inherit(CompareNode, s09FormulaNode(ng07Host));
  CompareNode.prototype.type = "binary";
  CompareNode.prototype.getValue = function (ctx) {
    const a = this.left.getValue(ctx), b = this.right.getValue(ctx);
    const op = this.op;
    if (op === "==") return ng07Bool(a.looseEquals(b));
    if (op === "!=") return ng07Bool(!a.looseEquals(b));
    if (op === "===") return ng07Bool(a.equals(b));
    if (op === "!==") return ng07Bool(!a.equals(b));
    if (a instanceof s08NullValue(ng07Host) || b instanceof s08NullValue(ng07Host)) return ng07Null();
    let cmp = 0;
    const an = ng07Numeric(a), bn = ng07Numeric(b);
    if (!isNaN(an) && !isNaN(bn)) cmp = an - bn;
    else if (a instanceof s08DateValue(ng07Host) && b instanceof s08DateValue(ng07Host)) cmp = a.date.getTime() - b.date.getTime();
    else if (a instanceof s08DurationValue(ng07Host) && b instanceof s08DurationValue(ng07Host)) cmp = a.getMilliseconds() - b.getMilliseconds();
    else cmp = a.toString().localeCompare(b.toString());
    switch (op) {
      case "<": return ng07Bool(cmp < 0);
      case "<=": return ng07Bool(cmp <= 0);
      case ">": return ng07Bool(cmp > 0);
      case ">=": return ng07Bool(cmp >= 0);
    }
    return ng07Null();
  };
  return CompareNode;
}
export function s09CompareNode(host) { ng07H(host); return ng07FmlOnceE("CompareNode", ng07BuildCompareNode); }

// -------------------------------------------------------------- MathNode

function ng07BuildMathNode() {
  function MathNode(op, left, right) { s09FormulaNode(ng07Host).call(this); this.op = op; this.left = left; this.right = right; }
  inherit(MathNode, s09FormulaNode(ng07Host));
  MathNode.prototype.type = "binary";
  MathNode.prototype.getValue = function (ctx) {
    const a = this.left.getValue(ctx), b = this.right.getValue(ctx);
    if (a instanceof s08NullValue(ng07Host) || b instanceof s08NullValue(ng07Host)) return ng07Null();
    // date arithmetic: date - date -> duration, date +/- duration -> date
    if (a instanceof s08DateValue(ng07Host) && b instanceof s08DateValue(ng07Host) && this.op === "-") {
      return s08DurationValue(ng07Host).fromMilliseconds(b.date.getTime() - a.date.getTime());
    }
    if (a instanceof s08DateValue(ng07Host) && b instanceof s08DurationValue(ng07Host) && (this.op === "+" || this.op === "-")) {
      const ms = b.getMilliseconds();
      return new (s08DateValue(ng07Host))(new Date(a.date.getTime() + (this.op === "+" ? ms : -ms)));
    }
    if (this.op === "+" && (a instanceof s08StringValue(ng07Host) || b instanceof s08StringValue(ng07Host))) {
      return new (s08StringValue(ng07Host))(a.toString() + b.toString());
    }
    const an = ng07Numeric(a), bn = ng07Numeric(b);
    if (isNaN(an) || isNaN(bn)) throw new Error(ng07FmlErrE("msgErrorTypeError"));
    switch (this.op) {
      case "+": return ng07Num(an + bn);
      case "-": return ng07Num(an - bn);
      case "*": return ng07Num(an * bn);
      case "/": return ng07Num(bn === 0 ? (an === 0 ? NaN : an > 0 ? Infinity : -Infinity) : an / bn);
      case "%": return ng07Num(an % bn);
    }
    return ng07Null();
  };
  return MathNode;
}
export function s09MathNode(host) { ng07H(host); return ng07FmlOnceE("MathNode", ng07BuildMathNode); }
