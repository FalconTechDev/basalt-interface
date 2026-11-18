// Clean-room app helpers (g07, part C): formula AST <-> property reference
// conversion, editable-target detection and the table-range probe.
import { env } from "./env.js";

const ng07ROOTS = new Set(["note", "formula", "file", "this"]);

function ng07NodeField(node, name) {
  return node && typeof node === "object" ? node[name] : undefined;
}

/** Dotted property reference for an identifier / access chain, or null. */
function ng07RefOf(node) {
  const type = ng07NodeField(node, "type");
  if (type === "ident" || type === "Identifier") {
    const id = ng07NodeField(node, "id") ?? ng07NodeField(node, "name");
    return typeof id === "string" ? id : null;
  }
  if (type === "objectAccess" || type === "ObjectAccess" || type === "arrayAccess" || type === "ArrayAccess") {
    const base = ng07RefOf(ng07NodeField(node, "object") ?? ng07NodeField(node, "array"));
    if (base === null) return null;
    const index = ng07NodeField(node, "index");
    const itype = ng07NodeField(index, "type");
    let key = null;
    if (itype === "ident" || itype === "Identifier") key = ng07NodeField(index, "id") ?? ng07NodeField(index, "name");
    else {
      const value = ng07NodeField(index, "value");
      if (typeof value === "string") key = value;
      else if (typeof value === "number") key = String(value);
    }
    if (typeof key !== "string" || key === "") return null;
    return base + "." + key;
  }
  return null;
}

/** `TX` — AST node -> property id text ("note.score", "file.name", "this", ...). */
export function s10FormulaIdentifier(node, host) {
  const ref = ng07RefOf(node);
  if (ref === null) throw new Error("Unsupported formula node for identifier");
  return ref;
}

function ng07ArgText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value.data === "string") return value.data;
  if (value.data !== undefined && typeof value.data !== "object") return String(value.data);
  throw new Error("Cannot convert formula argument to link text");
}

const ng07Wiki = (target, alias) => (alias ? `[[${target}|${alias}]]` : `[[${target}]]`);

/** `DX` — call args -> "[[target]]" / "[[target|alias]]", plain string, or string[]. */
export function s10FormulaLinktext(args, host) {
  const list = Array.isArray(args) ? args : [args];
  const out = [];
  for (const arg of list) {
    if (Array.isArray(arg) || (arg && Array.isArray(arg.data))) {
      const items = Array.isArray(arg) ? arg : arg.data;
      for (const item of items) out.push(ng07Wiki(ng07ArgText(item)));
      continue;
    }
    const text = ng07ArgText(arg);
    if (text === "") continue;
    if (/^\[\[.*\]\]$/.test(text)) { out.push(text); continue; }
    out.push(list.length === 1 ? ng07Wiki(text) : text);
  }
  if (out.length === 1) return out[0];
  if (out.length === 2 && list.length === 2) return ng07Wiki(out[0].replace(/^\[\[|\]\]$/g, ""), out[1]);
  return out;
}

/** `M$` — is `node` (or its ancestor) an editable text target? */
export function s10IsEditableTarget(node, host) {
  if (!node) return false;
  if (node.isContentEditable === true) return true;
  const el = typeof node.closest === "function" ? node : node.parentElement;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest(".metadata-container, .inline-title, input, textarea, [contenteditable]");
}

/** `Q$` — does the syntax tree over [from,to] contain a HyperMD-table node? */
export function s10RangeInTable(tree, from, to, host) {
  if (!tree || typeof tree.iterate !== "function") return false;
  let found = false;
  tree.iterate({
    from, to,
    enter(nodeRef) {
      const name = nodeRef.name || (nodeRef.type && nodeRef.type.name) || "";
      if (name.indexOf("HyperMD-table") !== -1 || name === "Table") { found = true; return false; }
    },
  });
  return found;
}
