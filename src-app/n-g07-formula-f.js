// Clean-room formula engine (g07, part F): property/array access and call
// nodes — function and method resolution with argument checking.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07FmlClsF = {};
function ng07FmlOnceF(key, build) { return (ng07FmlClsF[key] ??= build()); }

function ng07FmlErrF(key) { const f = env().gm && env().gm.formulas; return f && f[key] ? f[key]() : key; }
const ng07FmlNull = () => s08NullValue(ng07Host).value;

function ng07AccessKey(node, ctx) {
  // member syntax stores an identifier/primitive node; use its literal name
  if (node && node.type === "identifier") return node.id;
  if (node && node.type === "literal") return String(node.value);
  const v = node.getValue(ctx);
  if (v instanceof s08StringValue(ng07Host)) return v.data;
  if (v instanceof s08NumberValue(ng07Host)) return String(v.data);
  return v.toString();
}

// -------------------------------------------------------- ObjectAccessNode

function ng07BuildObjectAccessNode() {
  function ObjectAccessNode(object, index) { s09FormulaNode(ng07Host).call(this); this.object = object; this.index = index; }
  inherit(ObjectAccessNode, s09FormulaNode(ng07Host));
  ObjectAccessNode.prototype.type = "member";
  ObjectAccessNode.prototype.getValue = function (ctx) {
    const obj = this.object.getValue(ctx);
    if (obj instanceof s08NullValue(ng07Host)) return obj;
    const key = ng07AccessKey(this.index, ctx);
    if (typeof obj.objectAccess !== "function") throw new Error(ng07FmlErrF("msgErrorInvalidObjectAccess"));
    return obj.objectAccess(key);
  };
  return ObjectAccessNode;
}
export function s09ObjectAccessNode(host) { ng07H(host); return ng07FmlOnceF("ObjectAccessNode", ng07BuildObjectAccessNode); }

// -------------------------------------------------------- ArrayAccessNode

function ng07BuildArrayAccessNode() {
  function ArrayAccessNode(array, index) { s09FormulaNode(ng07Host).call(this); this.array = array; this.index = index; }
  inherit(ArrayAccessNode, s09FormulaNode(ng07Host));
  ArrayAccessNode.prototype.type = "index";
  ArrayAccessNode.prototype.getValue = function (ctx) {
    const arr = this.array.getValue(ctx);
    if (arr instanceof s08NullValue(ng07Host)) return arr;
    const idx = this.index.getValue(ctx);
    const bad = () => { throw new Error(ng07FmlErrF("msgErrorInvalidArrayAccess")); };
    if (arr instanceof s08ListValue(ng07Host)) {
      if (!(idx instanceof s08NumberValue(ng07Host))) bad();
      let i = Math.trunc(idx.data);
      const n = arr.length();
      if (i < 0) i += n;
      return i >= 0 && i < n ? arr.get(i) : ng07FmlNull();
    }
    if (arr instanceof s08ObjectValue(ng07Host)) {
      if (!(idx instanceof s08StringValue(ng07Host))) bad();
      return arr.objectAccess(idx.data);
    }
    if (arr instanceof s08StringValue(ng07Host)) {
      if (!(idx instanceof s08NumberValue(ng07Host))) bad();
      let i = Math.trunc(idx.data);
      const n = arr.data.length;
      if (i < 0) i += n;
      return i >= 0 && i < n ? new (s08StringValue(ng07Host))(arr.data[i]) : ng07FmlNull();
    }
    bad();
  };
  return ArrayAccessNode;
}
export function s09ArrayAccessNode(host) { ng07H(host); return ng07FmlOnceF("ArrayAccessNode", ng07BuildArrayAccessNode); }

// --------------------------------------------------------------- CallNode

function ng07SpecTypeOk(spec, value) {
  const types = spec && spec.type;
  if (!types || !types.length) return true;
  for (const t of types) {
    if (t === "any" || t === "value") return true;
    if (typeof t === "function" && value instanceof t) return true;
    if (typeof t === "string" && value && value.type && (value.type.type === t || value.type === t)) return true;
  }
  return false;
}

function ng07CheckArgs(fn, args) {
  const params = fn.params || [];
  const required = params.filter((p) => !p.optional && !p.variadic);
  if (args.length < required.length) throw new Error(ng07FmlErrF("msgErrorNotEnoughArguments"));
  const last = params[params.length - 1];
  const open = last && last.variadic;
  if (!open && args.length > params.length) throw new Error(ng07FmlErrF("msgErrorTooManyArguments"));
  for (let i = 0; i < args.length; i++) {
    const spec = params[Math.min(i, params.length - 1)];
    if (spec && spec.optional && args[i] instanceof s08NullValue(ng07Host)) continue;
    if (spec && !ng07SpecTypeOk(spec, args[i])) throw new Error(ng07FmlErrF("msgErrorTypeError"));
  }
}

function ng07Invoke(fn, ctx, args) {
  if (typeof fn.applyWithContext === "function") return fn.applyWithContext(ctx, args);
  if (typeof fn.apply === "function") return fn.apply.call(fn, args);
  if (typeof fn === "function") return fn.apply(fn, args);
  throw new Error(ng07FmlErrF("msgErrorInvalidFunction"));
}

function ng07BuildCallNode() {
  function CallNode(object, args) { s09FormulaNode(ng07Host).call(this); this.object = object; this.args = args || []; }
  inherit(CallNode, s09FormulaNode(ng07Host));
  CallNode.prototype.type = "call";

  CallNode.prototype.getValue = function (ctx) {
    // `if(cond, a, b)` is a lazy special form
    if (this.object && this.object.type === "identifier" && String(this.object.id).toLowerCase() === "if") {
      const cond = this.args[0] ? this.args[0].getValue(ctx) : ng07FmlNull();
      const branch = cond.isTruthy() ? this.args[1] : this.args[2];
      return branch ? branch.getValue(ctx) : ng07FmlNull();
    }
    const resolved = this.resolveCallable(ctx);
    const argValues = this.args.map((a) => a.getValue(ctx));
    if (resolved.subject !== undefined) argValues.unshift(resolved.subject);
    const fn = resolved.fn;
    ng07CheckArgs(fn, resolved.subject !== undefined ? argValues.slice(1) : argValues);
    let out = ng07Invoke(fn, ctx, argValues);
    if (out && typeof out.isTruthy !== "function") {
      try { out = s08JsToValue(out); } catch (e) { out = new (s08ErrorValue(ng07Host))(e && e.message ? e.message : String(e)); }
    }
    return out;
  };

  CallNode.prototype.resolveCallable = function (ctx) {
    const obj = this.object;
    // global function: `name(...)`
    if (obj && obj.type === "identifier") {
      const name = obj.id;
      const q = env().QW;
      let fn = q && typeof q.findGlobal === "function" ? q.findGlobal(name) : undefined;
      if (!fn) fn = ng07FuncRegistry.findGlobal(name);
      if (!fn) throw new Error(ng07FmlErrF("msgErrorInvalidFunction") + ": " + name);
      return { fn };
    }
    // method call: `subject.name(...)`
    if (obj && obj.type === "member") {
      const subject = obj.object.getValue(ctx);
      if (subject instanceof s08NullValue(ng07Host)) return { fn: { params: [], apply: () => ng07FmlNull() }, subject: undefined, nullSubject: true };
      const key = ng07AccessKey(obj.index, ctx);
      const q = env().QW;
      let fn = q && typeof q.findForValue === "function" ? q.findForValue(subject, key) : undefined;
      if (!fn) fn = ng07FuncRegistry.findForValue(subject, key);
      if (!fn) throw new Error(ng07FmlErrF("msgErrorInvalidInstanceFunction") + ": " + key);
      return { fn, subject };
    }
    throw new Error(ng07FmlErrF("msgErrorInvalidFunction"));
  };
  return CallNode;
}
export function s09CallNode(host) { ng07H(host); return ng07FmlOnceF("CallNode", ng07BuildCallNode); }
