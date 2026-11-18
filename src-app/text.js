// Plain string helpers: byte sizes, case conversion, quote/indent measuring, URL encoding, property ids, versions.

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

// "12,345" style grouping followed by a fixed number of decimals. The integer part comes from the
// rounded number, the decimals from the unrounded one (so 1.999 prints "2.00"); kept on purpose.
function groupedNumber(value, decimals) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = String(parseInt(abs.toFixed(decimals), 10));
  const lead = whole.length > 3 ? whole.length % 3 : 0;
  let out = sign + (lead ? whole.substr(0, lead) + "," : "") + whole.substr(lead).replace(/(\d{3})(?=\d)/g, "$1,");
  if (decimals) out += "." + Math.abs(abs - Math.floor(abs)).toFixed(decimals).slice(2);
  return out;
}

/** 1536 -> "1.50 KB"; non-positive sizes are "0 B". */
export function formatBytes(bytes) {
  if (bytes <= 0) return "0 B";
  let unit = BYTE_UNITS.length - 1;
  for (let i = 0; i < BYTE_UNITS.length; i++) {
    if (bytes < Math.pow(1024, i + 1)) { unit = i; break; }
  }
  const scaled = bytes / Math.pow(1024, unit);
  return groupedNumber(scaled, unit === 0 ? 0 : 2) + " " + BYTE_UNITS[unit];
}

/** camelCase / snake_1 -> kebab-case ("fooBar_2" -> "foo-bar-2"). */
export function toKebab(name) {
  return name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/_[0-9]/g, (c) => "-" + c.substring(1));
}

/** Cuts a string to `max` characters including the ellipsis. */
export function ellipsize(text, max) {
  return text.length <= max ? text : text.slice(0, max - 1).trim() + "…";
}

/** Makes sure the text ends with an empty line (two newlines). */
export function endWithBlankLine(text) {
  const endsNl = text.charAt(text.length - 1) === "\n";
  const blankBefore = text.charAt(text.length - 2) === "\n";
  if (!endsNl) return text + "\n\n";
  return blankBefore ? text : text + "\n";
}

/** Squeezes every run of newlines (and the spaces after them) into one newline. */
export function squeezeNewlines(text) {
  return text ? text.replace(/(\n+\s*)+/g, "\n") : "";
}

/** Escapes "|" for markdown table cells. */
export function escapeTablePipes(text) {
  return text.replace(/\|/g, "\\|");
}

/** Adds a leading "#" when missing. */
export function withHash(tag) {
  return tag.charAt(0) === "#" ? tag : "#" + tag;
}

/** A single short line: not blank, no line break, and not a long sentence. */
export function isShortLine(text) {
  if (text.trim().length === 0) return false;
  if (text.includes("\n")) return false;
  return !(text.length > 100 && text.includes(" "));
}

const isStringLike = (v) => typeof v === "string" || v instanceof String;

/** Property value -> array of strings, or null when there is nothing. */
export function toStringList(value) {
  if (value === null || value === "") return null;
  if (Array.isArray(value)) {
    const items = value.filter((v) => v != null).map((v) => String(v));
    return items.length > 0 ? items : null;
  }
  return isStringLike(value) ? [value] : [String(value)];
}

/** "" and [] become null, everything else passes through. */
export function emptyToNull(value) {
  return value === "" || (Array.isArray(value) && value.length === 0) ? null : value;
}

/** 'a, "b c"' -> ["a", "b c"] (quotes dropped, blanks removed). */
export function parseCommaList(text) {
  return text.replace(/["]/g, "").split(",").map((s) => s.trim()).filter((s) => s);
}

/** Inverse of parseCommaList: items with spaces get quoted. */
export function formatCommaList(items) {
  return items.map((s) => (s.includes(" ") ? '"' + s + '"' : s)).join(", ");
}

/** Number of ">" characters. */
export function countQuoteMarks(text) {
  return (text.match(/>/g) || []).length;
}

/** Nesting depth of a quoted/indented line: a leading ">" then tabs and 4-space groups. */
export function quoteIndentDepth(line) {
  let depth = 0;
  const eatIndent = () => {
    while (line.startsWith("\t")) { line = line.substring(1); depth++; }
    while (line.startsWith("    ")) { line = line.substring(4); depth++; }
  };
  if (line.startsWith(">")) {
    line = line.substring(1);
    eatIndent();
    if (line.startsWith(" ")) line = line.substring(1);
  }
  eatIndent();
  return depth;
}

/** Removes every whitespace-delimited word containing `part` (which is used as a regex source). */
export function dropWordsContaining(text, part) {
  return text.replace(new RegExp("\\s?[^\\s]*" + part + "[^\\s]*", "g"), "");
}

/** Form-style decoding: "+" is a space. */
export function formDecode(text) {
  return decodeURIComponent(text.replace(/\+/g, "%20"));
}

/** Form-style encoding: spaces become "+". */
export function formEncode(text) {
  return encodeURIComponent(text).replace(/%20/g, "+");
}

/** Encodes every piece of a path (split on `sep`, default "/") with formEncode. */
export function formEncodePath(text, sep = "/") {
  return text.split(sep).map(formEncode).join(sep);
}

/** Lines of a text; a final empty line caused by a trailing newline is dropped. */
export function linesOf(text) {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** True when the text has an ASCII letter. */
export function hasLatinLetter(text) {
  return /[a-z]/i.test(text);
}

/** "300x200" or "300" -> {x, y}; y is 0 when absent, null when it is not a size. */
export function parseImageSize(text) {
  const hit = text.match(/^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/);
  return hit ? { x: parseInt(hit[1]), y: hit[2] ? parseInt(hit[2]) : 0 } : null;
}

/** parseInt that answers null for empty / non numeric input. */
export function intOrNull(text) {
  if (!text) return null;
  const n = parseInt(text);
  return Number.isNaN(n) ? null : n;
}

/** parseFloat with a fallback. */
export function floatOr(text, fallback) {
  const n = parseFloat(text);
  return isNaN(n) ? fallback : n;
}

/** Joins two optional class strings. */
export function joinClasses(a, b) {
  if (!a) return b;
  return b ? a + " " + b : a;
}

/** 9, 99, 999 ... the smallest all-nines number that is not below the argument. */
export function ninesAtLeast(n) {
  let nines = 9;
  while (nines < n) nines = nines * 10 + 9;
  return nines;
}

/** Number of "\n" in text strictly before offset `end`. */
export function newlinesBefore(text, end) {
  let count = 0;
  for (let at = 0; at < end && (at = text.indexOf("\n", at)) !== -1 && !(at >= end); ) { at++; count++; }
  return count;
}

/** Start and end offsets of the 0-based line number `line`. */
export function lineBounds(text, line) {
  let at = -1;
  for (let i = 0; i < line; i++) at = text.indexOf("\n", at + 1);
  const start = at + 1;
  const stop = text.indexOf("\n", start);
  return { start, end: stop !== -1 ? stop : text.length };
}

/** "KeyA" -> "A", other key names stay. */
export function keyLabel(code) {
  return code.startsWith("Key") && code.length === 4 ? code.charAt(3) : code;
}

/** Hotkey record. */
export function makeHotkey(modifiers, key) {
  return { modifiers, key };
}

/** Case-insensitive lookup of an own property value, null when missing. */
export function valueIgnoringCase(obj, name) {
  const wanted = name.toLowerCase();
  for (const k in obj) if (obj.hasOwnProperty(k) && k.toLowerCase() === wanted) return obj[k];
  return null;
}

/** The existing key of `obj` that matches `name` ignoring case (or `name` itself). */
export function keyIgnoringCase(obj, name) {
  if (Object.hasOwn(obj, name)) return name;
  const wanted = name.toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === wanted) return k;
  return name;
}

/** "1.2.10" -> [1,2,10]; null when any part is not a number. */
export function parseVersion(text) {
  if (!text || typeof text !== "string") return null;
  let ok = true;
  const parts = text.split(".").map((p) => {
    const n = parseInt(p);
    if (isNaN(n)) ok = false;
    return n;
  });
  return ok ? parts : null;
}

function versionLess(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return a.length < b.length;
}

/** True when `current` is older than `latest`; unparsable `latest` is never newer, unparsable `current` always older. */
export function isOlderVersion(current, latest) {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  return !!b && (!a || versionLess(a, b));
}

/** Severity rank used to pick the worst diagnostic. */
export function severityRank(severity) {
  return severity == "error" ? 4 : severity == "warning" ? 3 : severity == "info" ? 2 : 1;
}

/** The most severe level in a list of diagnostics ("hint" for none). */
export function worstSeverity(diagnostics) {
  let worst = "hint";
  let rank = 1;
  for (const d of diagnostics) {
    const r = severityRank(d.severity);
    if (r > rank) { rank = r; worst = d.severity; }
  }
  return worst;
}

/** Chrome version out of a user agent string, "N/A" if absent. */
export function chromeVersion(userAgent) {
  const hit = userAgent.match(/Chrome\/([\d.]+)/i);
  return hit ? hit[1] : "N/A";
}

/** Splits "file.name" property ids into {type, name}; unknown prefixes mean a note property. */
export function parsePropertyId(id) {
  const dot = id.indexOf(".");
  if (dot === -1) return { type: "note", name: id };
  const prefix = id.slice(0, dot);
  if (prefix !== "note" && prefix !== "formula" && prefix !== "file") return { type: "note", name: id };
  return { type: prefix, name: id.slice(dot + 1) };
}

/** "type.name". */
export function propertyId(type, name) {
  return `${type}.${name}`;
}

/** Short form of a property id: "note.x" -> "x", "file.file" -> "file". */
export function shortPropertyId(id) {
  if (id.length > 5 && id.startsWith("note.")) {
    const rest = id.substring(5);
    const head = rest.split(".")[0];
    return ["file", "formula", "note"].includes(head) ? id : rest;
  }
  return id === "file.file" ? "file" : id;
}

/** Long form of a property id: the opposite of shortPropertyId. */
export function longPropertyId(id) {
  if (id.startsWith("note.") || id.startsWith("formula.") || id.startsWith("file.")) return id;
  return id === "file" ? "file.file" : "note." + id;
}

/** `name`, or `name 2`, `name 3` ... the first one that is not in the set. */
export function uniqueName(taken, name) {
  let candidate = name;
  for (let n = 2; taken.has(candidate); n++) candidate = name + " " + n;
  return candidate;
}

/** Remove everything the heading/link checker treats as punctuation, squeeze spaces. */
const HEADING_PUNCT = /[!"#$%&()*+,.:;<=>?@^`{|}~\/\[\]\\\r\n]/g;
const LINK_HEADING_PUNCT = /([:#|^\\\r\n]|%%|\[\[|]])/g;

/** Heading text as used for matching: punctuation removed, spaces squeezed. */
export function plainHeading(heading) {
  return heading.replace(HEADING_PUNCT, " ").replace(/\s+/g, " ").trim();
}

/** Heading text as used inside links: only link-breaking characters removed. */
export function linkSafeHeading(heading) {
  return heading.replace(LINK_HEADING_PUNCT, " ").replace(/\s+/g, " ").trim();
}

/** "--flag=value" help text for a CLI option table. */
export function describeCliOptions(options) {
  if (!options) return "";
  const entries = Object.entries(options);
  if (entries.length === 0) return "";
  return entries.map(([key, opt]) => {
    const text = opt.value ? `${key}=${opt.value}` : key;
    return opt.required ? text : `[${text}]`;
  }).join(" ");
}
