// Clean-room property values (g07, part A): shared helpers and the base of the
// value hierarchy — AnyValue, Value, ScalarValue and the simple scalars.
import { env } from "./env.js";
import { inherit, methods } from "./inherit.js";

const ng07Cls = {};
function ng07Once(key, build) { return (ng07Cls[key] ??= build()); }

// ------------------------------------------------------------------ helpers

/** `zW` — coerce a raw JS value into a property value (lazy for arrays/objects). */
export function s08JsToValue(value) {
  if (value === null || value === undefined || typeof value === "function") return env().bW.value;
  if (typeof value === "string") return new (env().CW)(value);
  if (typeof value === "number") return new (env().EW)(value);
  if (typeof value === "boolean") return new (env().MW)(value);
  if (value instanceof Date) return new (env().LW)(new Date(value.getTime()));
  if (Array.isArray(value)) return new (env().SW)(value.slice(), s08JsToValue);
  if (typeof value === "object") return new (env().AW)({ ...value }, s08JsToValue);
  throw new Error(`Value type is unsupported: ${typeof value}`);
}

/** `ZW` — glob-ish pattern -> regex source fragment for object key matching. */
export function s08KeyGlob(pattern) {
  return String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
}

/** `WU` — shallow copy preserving nested references and the prototype. */
export function s08ShallowClone(value) {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === "object") return { ...value };
  return value;
}

/** `QG` — DOM childNodes linked list -> plain array. */
export function s08ChildArray(node) {
  const out = [];
  for (let child = node && node.firstChild; child; child = child.nextSibling) out.push(child);
  return out;
}

/** `ZG` — evaluate a formula string in `ctx`; Null on parse/eval failure. */
export function s08FormulaValue(ctx, source) {
  try {
    const text = new (env().DK)(source);
    const value = text.getValue(ctx);
    return value instanceof env().yW ? env().bW.value : value;
  } catch (e) {
    return env().bW.value;
  }
}

/** `Jq` — tag range {open,close} around `pos` inside `wrapper`, if any. */
export function s08TagRange(wrapper, pos) {
  const tags = wrapper && wrapper.querySelectorAll ? wrapper.querySelectorAll(".tag") : [];
  for (const tag of tags) {
    const r = tag.rangePos ? tag.rangePos() : null;
    if (r && pos >= r.from && pos <= r.to) return { open: r.from, close: r.to };
  }
  return undefined;
}

// ------------------------------------------------------------- param specs

/** `WW` — variadic parameter spec. */
export function s08VariadicParam(name, ...types) { return [{ name, type: types, variadic: true }]; }
/** `UW` — optional parameter spec. */
export function s08OptionalParam(name, ...types) { return { name, type: types, optional: true }; }
/** `_W` — parameter rendered through a custom widget. */
export function s08CustomWidgetParam(name, widget, ...types) { return { name, type: types, customWidget: widget }; }
/** `jW` — plain typed parameter spec. */
export function s08TypedParam(name, ...types) { return { name, type: types }; }
