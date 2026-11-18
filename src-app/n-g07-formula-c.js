// Clean-room formula engine (g07, part C): the AST node base classes —
// FormulaNode, InvalidNode, EmptyNode, Primitive/Regexp/Ident/Paren/Array.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07FmlClsC = {};
function ng07FmlOnceC(key, build) { return (ng07FmlClsC[key] ??= build()); }

function ng07FmlErrKey(key) {
  const f = env().gm && env().gm.formulas;
  return f && f[key] ? f[key]() : key;
}

// ------------------------------------------------------------ FormulaNode

function ng07BuildFormulaNode() {
  function FormulaNode() {}
  FormulaNode.prototype.type = "formula";
  FormulaNode.prototype.test = function (ctx) {
    const v = this.getValue(ctx);
    return !!(v && typeof v.isTruthy === "function" ? v.isTruthy() : v);
  };
  FormulaNode.fromParsedResult = function (parsed) {
    if (!parsed || parsed.type === "empty") return new (s09EmptyNode(ng07Host))();
    if (parsed.type === "invalid") return new (s09InvalidNode(ng07Host))(parsed.rawValue, parsed.parseError);
    if (parsed.type === "expression") return s09NodeFromJson(parsed.node);
    return new (s09InvalidNode(ng07Host))(String(parsed), "Unknown parse result");
  };
  FormulaNode.parse = function (text) { return FormulaNode.fromParsedResult(s09ParseFormula(text)); };
  return FormulaNode;
}
export function s09FormulaNode(host) { ng07H(host); return ng07FmlOnceC("FormulaNode", ng07BuildFormulaNode); }

/** parsed-JSON -> AST node (flat-scope helper shared by the node builders). */
function s09NodeFromJson(j) {
  switch (j.type) {
    case "literal":
      if (j.kind === "regex") return new (s09RegexpNode(ng07Host))(j.pattern, j.flags);
      return new (s09PrimitiveNode(ng07Host))(j.value);
    case "identifier": return new (s09IdentNode(ng07Host))(j.name);
    case "array": return new (s09ArrayNode(ng07Host))(j.elements.map(s09NodeFromJson));
    case "paren": return new (s09ParenNode(ng07Host))(s09NodeFromJson(j.value));
    case "unary":
      return j.op === "!" ? new (s09NotNode(ng07Host))(s09NodeFromJson(j.arg)) : new (s09NegateNode(ng07Host))(s09NodeFromJson(j.arg));
    case "binary":
      if (["==", "!=", "===", "!==", "<", "<=", ">", ">="].includes(j.op)) {
        return new (s09CompareNode(ng07Host))(j.op, s09NodeFromJson(j.left), s09NodeFromJson(j.right));
      }
      return new (s09MathNode(ng07Host))(j.op, s09NodeFromJson(j.left), s09NodeFromJson(j.right));
    case "member": {
      const prop = j.property;
      const idx = /^[A-Za-z_][A-Za-z0-9_]*$/.test(prop) ? new (s09IdentNode(ng07Host))(prop) : new (s09PrimitiveNode(ng07Host))(prop);
      return new (s09ObjectAccessNode(ng07Host))(s09NodeFromJson(j.object), idx);
    }
    case "index": return new (s09ArrayAccessNode(ng07Host))(s09NodeFromJson(j.object), s09NodeFromJson(j.index));
    case "call": return new (s09CallNode(ng07Host))(s09NodeFromJson(j.object), j.args.map(s09NodeFromJson));
    default: return new (s09InvalidNode(ng07Host))(JSON.stringify(j), "Unsupported node");
  }
}

// ------------------------------------------------------------- InvalidNode

function ng07BuildInvalidNode() {
  function InvalidNode(text, error) {
    s09FormulaNode(ng07Host).call(this);
    this.text = text === undefined ? "" : String(text);
    this.error = error || null;
  }
  inherit(InvalidNode, s09FormulaNode(ng07Host));
  InvalidNode.prototype.type = "invalid";
  InvalidNode.prototype.getErrorMessage = function () { return this.error || ng07FmlErrKey("msgErrorInvalidFormula"); };
  InvalidNode.prototype.getValue = function () { return s08NullValue(ng07Host).value; };
  InvalidNode.prototype.test = function () { return false; };
  return InvalidNode;
}
export function s09InvalidNode(host) { ng07H(host); return ng07FmlOnceC("InvalidNode", ng07BuildInvalidNode); }

// -------------------------------------------------------------- EmptyNode

function ng07BuildEmptyNode() {
  function EmptyNode() { s09FormulaNode(ng07Host).call(this); }
  inherit(EmptyNode, s09FormulaNode(ng07Host));
  EmptyNode.prototype.type = "empty";
  EmptyNode.prototype.getValue = function () { return s08NullValue(ng07Host).value; };
  return EmptyNode;
}
export function s09EmptyNode(host) { ng07H(host); return ng07FmlOnceC("EmptyNode", ng07BuildEmptyNode); }
