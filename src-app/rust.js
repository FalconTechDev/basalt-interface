// Functions whose work is done by app-core (Rust). Each one checks that the input is something WebAssembly can carry
// exactly (well-formed UTF-16, finite numbers, plain digits) and otherwise runs the equivalent JS from text.js / path.js.
import { core } from "./core.js";
import { formatBytes, isOlderVersion, plainHeading, linkSafeHeading } from "./text.js";
import { normalizePath } from "./path.js";
import { fuzzyMatchJs } from "./search.js";

const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** formatBytes through app-core. */
export function formatBytesRs(bytes) {
  if (typeof bytes === "number" && Number.isFinite(bytes) && bytes < 1e18) {
    const out = core.call("format_bytes", [String(bytes)]);
    if (out !== null) return out;
  }
  return formatBytes(bytes);
}

/** normalizePath through app-core (the Unicode NFC step stays in the host). */
export function normalizePathRs(path) {
  if (typeof path === "string" && !loneSurrogate.test(path)) {
    const out = core.call("collapse_path", [path]);
    if (out !== null) return out.normalize("NFC");
  }
  return normalizePath(path);
}

/** Heading text for matching, through app-core. */
export function plainHeadingRs(heading) {
  if (typeof heading === "string" && !loneSurrogate.test(heading)) {
    const out = core.call("plain_heading", [heading]);
    if (out !== null) return out;
  }
  return plainHeading(heading);
}

/** Heading text for links, through app-core. */
export function linkSafeHeadingRs(heading) {
  if (typeof heading === "string" && !loneSurrogate.test(heading)) {
    const out = core.call("link_safe_heading", [heading]);
    if (out !== null) return out;
  }
  return linkSafeHeading(heading);
}

const plainVersion = /^[0-9]{1,15}(\.[0-9]{1,15})*$/;

/** isOlderVersion through app-core. */
export function isOlderVersionRs(current, latest) {
  if (typeof current === "string" && typeof latest === "string" && plainVersion.test(current) && plainVersion.test(latest)) {
    const out = core.call("is_older_version", [current, latest]);
    if (out !== null) return out === "1";
  }
  return isOlderVersion(current, latest);
}

const lonePatternAny = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const lone = { test: (s) => (s.isWellFormed ? !s.isWellFormed() : lonePatternAny.test(s)) };

function parseResult(line) {
  if (line === "-") return null;
  if (line === "0") return { score: 0, matches: [] };
  const parts = line.split(";");
  return { score: parseFloat(parts[0]), matches: parts.slice(1).map((p) => { const [a, b] = p.split(","); return [+a, +b]; }) };
}

/** Matches many texts against one prepared query in a single WebAssembly call; same results as fuzzyMatchJs for each. */
export function fuzzyMatchMany(prepared, texts) {
  if (texts.length === 0) return [];
  if (!core.ready() || lone.test(prepared.query) || prepared.fuzzy.some((c) => lone.test(c)) || texts.some((t) => lone.test(t))) {
    return texts.map((t) => fuzzyMatchJs(prepared, t));
  }
  const reply = core.call("fuzzy", [prepared.query, String(prepared.tokens.length), ...prepared.tokens, String(prepared.fuzzy.length), ...prepared.fuzzy, ...texts]);
  if (reply === null) return texts.map((t) => fuzzyMatchJs(prepared, t));
  return reply.split("\n").map(parseResult);
}

/** One text against a prepared query (WebAssembly when it can). */
export function fuzzyMatch(prepared, text) {
  return fuzzyMatchMany(prepared, [text])[0];
}
