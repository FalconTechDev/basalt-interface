// g01 clean-room: shared small helpers for the CLI modules (ng01 prefix, flat scope).
import { env } from "./env.js";
import { lastSegment, parentPath, baseName, extensionOf, withoutExtension, normalizePath } from "./path.js";

/** Locale-aware collator used for every sorted listing (usage: sort, sensitivity: base, numeric). */
export const ng01Collator = new Intl.Collator(undefined, { usage: "sort", sensitivity: ng01BaseSensitivity(), numeric: true });
function ng01BaseSensitivity() { return "base"; }

export function ng01Compare(a, b) { return ng01Collator.compare(a, b); }

/** Renders a flag spec map as the usage options string: `key=value`/`key`, `[...]` unless required. */
export function ng01DescribeOptions(flags) {
  if (!flags) return "";
  const parts = [];
  for (const key of Object.keys(flags)) {
    const f = flags[key];
    if (!f) continue;
    const name = f.value ? key + "=" + f.value : key;
    parts.push(f.required ? name : "[" + name + "]");
  }
  return parts.join(" ");
}

/** `content` arg unescaping: \\n and \\t sequences become real characters. */
export function ng01UnescapeContent(text) {
  return String(text).replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

/** Pads `s` to `n` chars with spaces on the right. */
export function ng01PadEnd(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
/** Pads `s` to `n` chars with spaces on the left. */
export function ng01PadStart(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }

/** HH:MM:SS local time for a timestamp (ms). */
export function ng01Clock(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

/** YYYY-MM-DD HH:mm:ss for a timestamp (ms) via moment when present. */
export function ng01Stamp(ts) {
  if (typeof window !== "undefined" && window.moment) return window.moment(ts).format("YYYY-MM-DD HH:mm:ss");
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

/** Splits `text` into lines, dropping the trailing empty fragment after a final newline. */
export function ng01Lines(text) {
  const parts = String(text).split("\n");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Normalises a folder filter: strips trailing slashes; matches `<folder>/...` paths (and the folder itself). */
export function ng01FolderPrefix(folder) {
  if (!folder) return "";
  folder = String(folder).replace(/\/+$/, "");
  return folder;
}

/** True when vault path `p` sits inside folder `f` ("f" or "f/..."). */
export function ng01InFolder(p, f) {
  if (!f) return true;
  return p === f || p.startsWith(f + "/");
}

/** Sorted copy of an array of strings. */
export function ng01Sorted(list) { return list.slice().sort(ng01Compare); }

/** key<TAB>value lines joined by newline (the house style for small info reports). */
export function ng01Kv(pairs) {
  return pairs.map((p) => p[0] + "\t" + p[1]).join("\n");
}

/** Current webContents on desktop, or null. */
export function ng01WebContents() {
  if (typeof window === "undefined" || !window.electron) return null;
  try {
    const remote = window.electron.remote;
    return remote && remote.getCurrentWebContents ? remote.getCurrentWebContents() : null;
  } catch (e) { return null; }
}

/** True when the vault adapter is the desktop filesystem adapter. */
export function ng01IsFsAdapter(app) {
  const adapter = app && app.vault && app.vault.adapter;
  return !!(adapter && typeof adapter.getBasePath === "function");
}
