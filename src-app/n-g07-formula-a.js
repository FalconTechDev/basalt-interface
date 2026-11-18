// Clean-room formula engine (g07, part A): i18n tables, syntax-node helpers
// and the hand-written tokenizer for the formula language.
import { env } from "./env.js";

/** `TK` declarator — localized formula error strings (`gm.formulas`). */
export function s09Formulas() { return env().gm.formulas; }

/** `eY`/`cY` declarator — the `gm.plugins.bases` i18n table. */
export function s09BasesStrings() { return env().gm.plugins.bases; }

/** `LK` — text covered by a syntax node ({from,to} over the source string). */
export function s09NodeText(node, text) {
  if (!node) return "";
  if (typeof node.from === "number" && typeof node.to === "number") return text.slice(node.from, node.to);
  if (typeof node.text === "string") return node.text;
  return "";
}

/** `OK` — first error/⚠ node in a syntax tree, or null. */
export function s09FindErrorNode(node) {
  if (!node) return null;
  const name = node.name || (node.type && node.type.name) || "";
  if (name === "⚠" || name === "ERROR" || node.type && node.type.isError) return node;
  if (typeof node.iterate === "function") {
    let found = null;
    node.iterate({ enter(n) { const nm = n.name || ""; if (nm === "⚠" || nm === "ERROR") { found = n; return false; } } });
    return found;
  }
  return null;
}

// ------------------------------------------------------------- tokenizer

const ng07TokenSpec = [
  ["number", /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/],
  ["string", /^"(?:[^"\\]|\\.)*"/],
  ["string", /^'(?:[^'\\]|\\.)*'/],
  ["regex", /^\/(?:[^\/\\\n]|\\.)+\/[a-z]*/],
  ["op", /^(?:==|!=|<=|>=|&&|\|\||\+|-|\*|\/|%|<|>|!|\.|,|\(|\)|\[|\])/],
  ["ident", /^[A-Za-z_][A-Za-z0-9_]*/],
  ["space", /^\s+/],
];

function ng07Tokenize(text) {
  const tokens = [];
  let i = 0;
  const prev = () => tokens.length ? tokens[tokens.length - 1] : null;
  while (i < text.length) {
    const rest = text.slice(i);
    let matched = null;
    for (const [kind, re] of ng07TokenSpec) {
      // '/' starts a regex only where a value is expected
      if (kind === "regex") {
        const p = prev();
        const ok = p === null || (p.kind === "op" && p.text !== ")" && p.text !== "]") || (p.kind === "ident" && /^(return|typeof|in|of)$/.test(p.text));
        if (!ok) continue;
      }
      const m = re.exec(rest);
      if (m) { matched = { kind, text: m[0], pos: i }; i += m[0].length; break; }
    }
    if (!matched) return { error: `Unexpected character at ${i}` };
    if (matched.kind === "space") continue;
    tokens.push(matched);
  }
  return { tokens };
}
