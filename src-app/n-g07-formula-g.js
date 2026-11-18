// Clean-room formula engine (g07, part G): FormulaText and the lezer-tree
// adapter (best effort — the evaluator uses the hand-written parser).
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07FmlClsG = {};
function ng07FmlOnceG(key, build) { return (ng07FmlClsG[key] ??= build()); }

const ng07ParsedKinds = new Set(["empty", "invalid", "expression"]);

/** `FK` — syntax tree / parsed JSON -> parsed JSON for the AST builders. */
export function s09TreeToParsed(node, text) {
  if (!node) return { type: "empty" };
  // already parsed JSON (or a FormulaText-like wrapper)
  if (typeof node === "object" && ng07ParsedKinds.has(node.type)) return node;
  if (node.formula && typeof node.formula === "object") return node.formula.parsed || node.formula;
  const src = s09NodeText(node, text);
  const err = s09FindErrorNode(node);
  if (err) return { type: "invalid", rawValue: src, parseError: "Syntax error" };
  // lezer trees are only produced by external callers; re-parse the covered text
  return s09ParseFormula(src);
}

// ------------------------------------------------------------ FormulaText

function ng07BuildFormulaText() {
  function FormulaText(text) {
    if (text && typeof text === "object" && text.parsed && typeof text.parsed === "object") {
      this.parsed = text.parsed;
      this.text = text.parsed.rawValue !== undefined ? String(text.parsed.rawValue) : "";
    } else if (text && typeof text === "object" && typeof text.type === "string") {
      this.parsed = text;
      this.text = text.rawValue !== undefined ? String(text.rawValue) : "";
    } else {
      this.text = text === undefined || text === null ? "" : String(text);
      this.parsed = s09ParseFormula(this.text);
    }
    this.formula = s09FormulaNode(ng07Host).fromParsedResult(this.parsed);
  }
  FormulaText.prototype.toString = function () { return this.text; };
  FormulaText.prototype.test = function (ctx) {
    try { return !!this.formula.test(ctx); } catch (e) { return false; }
  };
  FormulaText.prototype.getValue = function (ctx) {
    try {
      const v = this.formula.getValue(ctx);
      return v === undefined || v === null ? s08NullValue(ng07Host).value : v;
    } catch (e) {
      return new (s08ErrorValue(ng07Host))(e && e.message ? e.message : String(e));
    }
  };
  return FormulaText;
}
export function s09FormulaText(host) { ng07H(host); return ng07FmlOnceG("FormulaText", ng07BuildFormulaText); }
