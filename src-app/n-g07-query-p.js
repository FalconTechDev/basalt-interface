// Clean-room query model (g07, part P): helper functions — value type names,
// property refs, frontmatter filters, display values, summary evaluation,
// widget defaults and the property suggester.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07QryClsP = {};
function ng07QryOnceP(key, build) { return (ng07QryClsP[key] ??= build()); }

const ng07WidgetByClass = new Map();
function ng07RegisterWidgets() {
  if (ng07WidgetByClass.size) return;
  const e = env();
  const pairs = [
    [e.EW, "number"], [e.CW, "text"], [e.MW, "boolean"], [e.LW, "date"],
    [e.SW, "list"], [e.AW, "tags"], [e.DW, "tags"], [e.OW, "object"],
    [e.BW, "link"], [e.yW, "error"], [e.bW, "null"], [e.NW, "file"],
    [e.PW, "regexp"], [s08TagValue(ng07Host), "tag"],
    [s08RelativeDateValue(ng07Host), "date"], [s08IconValue(ng07Host), "icon"],
    [s08UrlValue(ng07Host), "url"], [s08ImageValue(ng07Host), "image"],
    [s08DurationValue(ng07Host), "duration"], [s08LinkValue(ng07Host), "link"],
    [s08FileValue(ng07Host), "file"], [s08ObjectValue(ng07Host), "object"],
    [s08ListValue(ng07Host), "list"], [s08StringValue(ng07Host), "text"],
    [s08NumberValue(ng07Host), "number"], [s08BooleanValue(ng07Host), "checkbox"],
    [s08NullValue(ng07Host), "null"], [s08DateValue(ng07Host), "date"],
  ];
  for (const [cls, name] of pairs) if (cls) ng07WidgetByClass.set(cls, name);
}

/** `OY` — widget type name for a value (accepts value object or type string). */
export function s09ValueTypeName(value) {
  ng07RegisterWidgets();
  if (typeof value === "string") {
    const direct = ng07WidgetByClass.size ? [...ng07WidgetByClass.values()].includes(value) : true;
    return direct ? value : value;
  }
  if (value && value.constructor) {
    const hit = ng07WidgetByClass.get(value.constructor);
    if (hit) return hit;
    if (typeof value.type === "string" && value.type) return value.type;
  }
  return "unknown";
}

const ng07IdentRe = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `LY` — property id -> formula reference text. */
export function s09PropertyToRef(id) {
  const pid = String(id || "");
  if (pid === "file.file") return "file";
  if (pid.startsWith("file.")) return pid.slice(5);
  if (pid.startsWith("formula.")) return pid;
  if (pid.startsWith("note.")) {
    const name = pid.slice(5);
    return ng07IdentRe.test(name) ? name : JSON.stringify(name);
  }
  const dot = pid.indexOf(".");
  if (dot > 0) return pid;
  return ng07IdentRe.test(pid) ? pid : JSON.stringify(pid);
}

/** `kY` — true for front-matter (note.*) custom properties, excluding file props and aliases. */
export function s09IsCustomProperty(property, query) {
  const pid = typeof property === "string" ? property : property && property.propertyId;
  if (!pid || !String(pid).startsWith("note.")) return false;
  if (s09FileProperties.includes(pid)) return false;
  if (query) {
    const cfg = query.properties && query.properties[pid];
    if (cfg && cfg.type === "aliases") return false;
  }
  return true;
}

/** `NY` — formula AST node -> {type,name,isThis} property reference (throws on unsupported). */
export function s09FormulaPropertyRef(node) {
  if (!node) throw new Error("Invalid formula node");
  const t = node.type;
  if (t === "ident") {
    const id = String(node.id || node.name || "");
    if (id === "this") return { type: "this", name: "this", isThis: true };
    if (id === "file") return { type: "file", name: "file", isThis: false };
    if (id === "formula") return { type: "formula", name: "formula", isThis: false };
    return { type: "note", name: id, isThis: false };
  }
  if (t === "objectAccess" || t === "object") {
    const base = node.object || node.array;
    const idx = node.index !== undefined ? node.index : node.key;
    const baseRef = base && base.type === "ident" ? String(base.id || base.name || "") : "";
    const key = idx && (idx.type === "primitive" ? String(idx.value) : String(idx.id || idx.name || ""));
    if (baseRef === "note") return { type: "note", name: key, isThis: false };
    if (baseRef === "file") return { type: "file", name: key, isThis: false };
    if (baseRef === "formula") return { type: "formula", name: key, isThis: false };
    if (baseRef === "this") return { type: "this", name: key, isThis: true };
    if (!baseRef && key) return { type: "note", name: key, isThis: false };
  }
  throw new Error("Unsupported formula node for property reference");
}

// `PY` (s09FiltersToFrontmatter) lives in n-g07-query-q.js with the real impl.
