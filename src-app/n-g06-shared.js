// ng06 shared helpers for the Bases clean-room modules: i18n shortcuts, DOM
// conveniences and small predicates used across the feature.
import { env } from "./env.js";
import { floatOr } from "./text.js";
import { s13BasesI18n, s13BasesCardsI18n, s13BasesListI18n, s13BasesTableI18n, s13ViewCards, s13ViewList, s13ViewTable } from "./s13-consts.js";

export const ng06T = () => s13BasesI18n();
export const ng06CardsT = () => s13BasesCardsI18n();
export const ng06ListT = () => s13BasesListI18n();
export const ng06TableT = () => s13BasesTableI18n();

/** createDiv/createEl/createSpan/tv bound lazily through env(). */
export const ng06Div = (...a) => env().createDiv(...a);
export const ng06El = (...a) => env().createEl(...a);
export const ng06Span = (...a) => env().createSpan(...a);
export const ng06Icon = (el, icon) => env().tv(el, icon);

/** Forbidden characters in view names (they would break wikilinks). */
export const ng06ViewNameChars = ["#", ":", "|", "^", "%%", "[[", "]]"].join(" ");
export const ng06ViewNamePattern = /[#:|^%[\]\r\n\\]/;
export const ng06BasesViewType = "bases";
export const ng06DefaultSort = [{ property: "file.name", direction: "ASC" }];
export const ng06FileExplorerStrings = () => env().gm.plugins.fileExplorer;

/** Thin wrappers kept for parity with the module contract (internal helpers). */

/** Number-or-fallback read of a CSS custom property / config value. */
export function ng06Num(value, fallback) {
  const n = typeof value === "string" ? floatOr(value, NaN) : value;
  return Number.isFinite(n) ? n : fallback;
}

/** Debounced microtask/timeout scheduler used by the virtualized views. */
export function ng06Idle(fn, ms = 10) {
  return new Promise((resolve) => {
    const run = () => { fn(); resolve(); };
    if (typeof requestIdleCallback === "function" && ms <= 0) requestIdleCallback(run);
    else setTimeout(run, ms);
  });
}

/** True when `value` is one of the empty-value sentinels the views treat as blank. */
export function ng06IsEmptyValue(value, host) {
  const { bW, SW, CW, AW } = host || env();
  if (value == null || value === bW.value) return true;
  try {
    if (value instanceof SW && value.length() === 0) return true;
    if (value instanceof CW && value.data === "") return true;
    if (value instanceof AW && value.keys().length === 0) return true;
  } catch (e) { /* not a value */ }
  return false;
}

export { s13ViewCards, s13ViewList, s13ViewTable };
