// Clean-room formula glue (g07, part J): the function registry and the
// FormulaFunc / FormulaMethod / SelfFunc bases.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07ClsJ = {};
function ng07OnceJ(key, build) { return (ng07ClsJ[key] ??= build()); }

// ---------------------------------------------------------- FuncRegistry

function ng07BuildFuncRegistry() {
  function FuncRegistry() {
    this.global = new Map();
    this.instance = new Map();
  }
  FuncRegistry.prototype._key = (name) => String(name).toLowerCase();
  FuncRegistry.prototype.addForType = function (type, name, fn) {
    if (!this.instance.has(type)) this.instance.set(type, new Map());
    this.instance.get(type).set(this._key(name), fn);
  };
  FuncRegistry.prototype.removeForType = function (type, name) {
    const m = this.instance.get(type);
    if (m) m.delete(this._key(name));
  };
  FuncRegistry.prototype.addGlobal = function (name, fn) { this.global.set(this._key(name), fn); };
  FuncRegistry.prototype.removeGlobal = function (name) { this.global.delete(this._key(name)); };
  FuncRegistry.prototype._ctorsOf = function (value) {
    const ctors = [];
    let proto = value;
    while (proto && proto.constructor && proto.constructor !== Object) {
      if (!ctors.includes(proto.constructor)) ctors.push(proto.constructor);
      proto = Object.getPrototypeOf(proto);
    }
    return ctors;
  };
  FuncRegistry.prototype.findForValue = function (value, name) {
    const key = this._key(name);
    for (const ctor of this._ctorsOf(value)) {
      const m = this.instance.get(ctor);
      if (m && m.has(key)) return m.get(key);
    }
    return undefined;
  };
  FuncRegistry.prototype.getAllForValue = function (value) {
    const out = new Map();
    for (const ctor of this._ctorsOf(value)) {
      const m = this.instance.get(ctor);
      if (m) for (const [k, v] of m) if (!out.has(k)) out.set(k, v);
    }
    return [...out.values()];
  };
  FuncRegistry.prototype.findGlobal = function (name) { return this.global.get(this._key(name)); };
  FuncRegistry.prototype.getAllGlobal = function () { return [...this.global.values()]; };
  return FuncRegistry;
}
export function s08FuncRegistry(host) { ng07H(host); return ng07OnceJ("FuncRegistry", ng07BuildFuncRegistry); }

/** Shared registry instance used by the clean-room formula evaluator. */
export const ng07FuncRegistry = new (ng07BuildFuncRegistry())();

// Built-in zero-arg globals.
ng07FuncRegistry.addGlobal("now", () => new Date());
ng07FuncRegistry.addGlobal("today", () => {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
});

// ----------------------------------------------------------- FormulaFunc

function ng07BuildFormulaFunc() {
  function FormulaFunc(name, params, docString) {
    this.name = name;
    this.params = params || [];
    this.docString = typeof docString === "string" ? docString : undefined;
    if (typeof params === "function") { this._impl = params; this.params = []; }
    else if (typeof docString === "function") this._impl = docString;
    this.ctx = undefined;
  }
  FormulaFunc.prototype.apply = function (args) {
    if (this._impl) return this._impl.apply(this, args || []);
    throw new Error(`Formula function ${this.name} is not implemented`);
  };
  FormulaFunc.prototype.operate = function (args) { return this.apply(args); };
  FormulaFunc.prototype.applyWithContext = function (ctx, args) {
    this.ctx = ctx;
    try { return this.apply(args || []); }
    finally { this.ctx = undefined; }
  };
  FormulaFunc.prototype.serialize = function (args) {
    const parts = (args || []).map((a) => (a && typeof a.serialize === "function" ? a.serialize() : a && a.toString ? a.toString() : String(a)));
    return `${this.name}(${parts.join(", ")})`;
  };
  return FormulaFunc;
}
export function s08FormulaFunc(host) { ng07H(host); return ng07OnceJ("FormulaFunc", ng07BuildFormulaFunc); }

// ---------------------------------------------------------- FormulaMethod

function ng07BuildFormulaMethod() {
  function FormulaMethod(name, params, docString) {
    s08FormulaFunc(ng07Host).call(this, name, params, docString);
  }
  inherit(FormulaMethod, s08FormulaFunc(ng07Host));
  FormulaMethod.prototype.apply = function (args) {
    const list = args || [];
    const subject = list.length ? list[0] : s08NullValue(ng07Host).value;
    const rest = list.slice(1);
    if (this._impl) return this._impl.call(this, subject, rest);
    return s08BooleanValue(ng07Host) ? new (s08BooleanValue(ng07Host))(false) : false;
  };
  return FormulaMethod;
}
export function s08FormulaMethod(host) { ng07H(host); return ng07OnceJ("FormulaMethod", ng07BuildFormulaMethod); }

// -------------------------------------------------------------- SelfFunc

function ng07BuildSelfFunc() {
  function SelfFunc(name, operate, params) {
    s08FormulaFunc(ng07Host).call(this, name, params || []);
    this._operate = operate;
  }
  inherit(SelfFunc, s08FormulaFunc(ng07Host));
  SelfFunc.prototype.apply = function (args) {
    const nums = (args || []).map((a) => (a && typeof a.data === "number" ? a.data : NaN));
    return new (s08NumberValue(ng07Host))(this._operate.apply(this, nums));
  };
  return SelfFunc;
}
export function s08SelfFunc(host) { ng07H(host); return ng07OnceJ("SelfFunc", ng07BuildSelfFunc); }
