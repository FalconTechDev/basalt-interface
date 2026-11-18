// Clean-room formula engine (g07, part B): the recursive-descent parser that
// turns formula text into the parsed-JSON form consumed by the AST builders.
import { env } from "./env.js";

const ng07Prec = { "||": 1, "&&": 2, "==": 3, "!=": 3, "===": 3, "!==": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

function ng07Unescape(text) {
  return text.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e) => {
    if (e[0] === "u") return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === "x") return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'", "/": "/" }[e] ?? e;
  });
}

function ng07ParseTokens(tokens, text) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isOp = (t, ...ops) => t && t.kind === "op" && ops.includes(t.text);
  const fail = (msg) => { throw new Error(msg); };

  function parsePrimary() {
    const t = next();
    if (!t) fail("Unexpected end of formula");
    if (t.kind === "number") return { type: "literal", kind: "number", value: parseFloat(t.text) };
    if (t.kind === "string") {
      const raw = t.text;
      const quote = raw[0];
      const inner = raw.slice(1, -1);
      const value = quote === '"' ? JSON.parse(raw) : ng07Unescape(inner);
      return { type: "literal", kind: "string", value };
    }
    if (t.kind === "regex") {
      const m = /^\/(.*)\/([a-z]*)$/.exec(t.text);
      return { type: "literal", kind: "regex", pattern: m ? m[1] : t.text, flags: m ? m[2] : "" };
    }
    if (t.kind === "ident") {
      if (t.text === "true") return { type: "literal", kind: "boolean", value: true };
      if (t.text === "false") return { type: "literal", kind: "boolean", value: false };
      if (t.text === "null") return { type: "literal", kind: "null", value: null };
      return { type: "identifier", name: t.text };
    }
    if (isOp(t, "(")) {
      const inner = parseExpr(0);
      if (!isOp(next(), ")")) fail("Expected )");
      return { type: "paren", value: inner };
    }
    if (isOp(t, "[")) {
      const elements = [];
      if (!isOp(peek(), "]")) {
        for (;;) {
          elements.push(parseExpr(0));
          if (isOp(peek(), ",")) { next(); continue; }
          break;
        }
      }
      if (!isOp(next(), "]")) fail("Expected ]");
      return { type: "array", elements };
    }
    if (isOp(t, "-")) return { type: "unary", op: "-", arg: parsePrimary() };
    if (isOp(t, "!")) return { type: "unary", op: "!", arg: parsePrimary() };
    fail(`Unexpected token ${t.text}`);
  }

  function parsePostfix() {
    let node = parsePrimary();
    for (;;) {
      const t = peek();
      if (isOp(t, ".")) {
        next();
        const p = next();
        if (!p || p.kind !== "ident") fail("Expected property name after .");
        node = { type: "member", object: node, property: p.text };
      } else if (isOp(t, "[")) {
        next();
        const index = parseExpr(0);
        if (!isOp(next(), "]")) fail("Expected ]");
        node = { type: "index", object: node, index };
      } else if (isOp(t, "(")) {
        next();
        const args = [];
        if (!isOp(peek(), ")")) {
          for (;;) {
            args.push(parseExpr(0));
            if (isOp(peek(), ",")) { next(); continue; }
            break;
          }
        }
        if (!isOp(next(), ")")) fail("Expected )");
        node = { type: "call", object: node, args };
      } else break;
    }
    return node;
  }

  function parseExpr(minPrec) {
    let left = parsePostfix();
    for (;;) {
      const t = peek();
      if (!t || t.kind !== "op" || !(t.text in ng07Prec)) break;
      const prec = ng07Prec[t.text];
      if (prec < minPrec) break;
      next();
      const right = parseExpr(prec + 1);
      left = { type: "binary", op: t.text, left, right };
    }
    return left;
  }

  const result = parseExpr(0);
  if (pos < tokens.length) fail(`Unexpected token ${tokens[pos].text}`);
  return result;
}

/** `PK` — parse formula text; never throws: empty/invalid/expression JSON. */
export function s09ParseFormula(text) {
  const src = String(text === undefined || text === null ? "" : text);
  if (src.trim() === "") return { type: "empty" };
  const lex = ng07Tokenize(src);
  if (lex.error) return { type: "invalid", rawValue: src, parseError: lex.error };
  try {
    return { type: "expression", node: ng07ParseTokens(lex.tokens, src) };
  } catch (e) {
    return { type: "invalid", rawValue: src, parseError: e && e.message ? e.message : String(e) };
  }
}

/** `IK` — true when `text` is exactly one identifier. */
export function s09IsIdentifierName(text) {
  const parsed = s09ParseFormula(text);
  return parsed.type === "expression" && parsed.node.type === "identifier";
}
