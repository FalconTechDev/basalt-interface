// Vault path and link-text helpers. Vault paths always use "/" and never start or end with one.

const NBSP_RUN = / | /g;

/** Last segment of a path ("a/b/c.md" -> "c.md"). */
export function lastSegment(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

/** Everything before the last "/" ("" when there is none). */
export function parentPath(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** True when any segment of the path starts with a dot. */
export function isHiddenPath(path) {
  for (let p = path; p; p = parentPath(p)) {
    if (lastSegment(p).startsWith(".")) return true;
  }
  return false;
}

// A dot counts as an extension separator only when it is neither first nor last.
function extensionDot(text) {
  const dot = text.lastIndexOf(".");
  return dot <= 0 || dot === text.length - 1 ? -1 : dot;
}

/** File name without its extension ("a/b/c.tar.gz" -> "c.tar"). */
export function baseName(path) {
  const name = lastSegment(path);
  const dot = extensionDot(name);
  return dot < 0 ? name : name.slice(0, dot);
}

/** The whole string without its extension (the dot is searched in the full path). */
export function withoutExtension(path) {
  const dot = extensionDot(path);
  return dot < 0 ? path : path.slice(0, dot);
}

/** Lower-cased extension, "" when there is none. */
export function extensionOf(path) {
  const dot = extensionDot(path);
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

/** name + "." + ext, or just the name when the extension is empty. */
export function joinNameExt(name, ext) {
  return ext ? name + "." + ext : name;
}

/** Collapse repeated separators (\ counts as /) and trim them; the empty result is "/". */
export function collapseSlashes(path) {
  const tidy = path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  return tidy === "" ? "/" : tidy;
}

/** Non-breaking spaces become plain spaces. */
export function plainSpaces(text) {
  return text.replace(NBSP_RUN, " ");
}

/** The vault-path normaliser exposed to plugins as normalizePath. */
export function normalizePath(path) {
  return plainSpaces(collapseSlashes(path)).normalize("NFC");
}

/** Display name of a path: file name, without ".md" for notes. */
export function displayName(path) {
  const name = lastSegment(path);
  return extensionOf(name) === "md" ? baseName(name) : name;
}

/** Path without the ".md" extension when it is a note. */
export function withoutMd(path) {
  return extensionOf(lastSegment(path)) === "md" ? withoutExtension(path) : path;
}

/** Drops a trailing ".md" (3 characters) from notes only. */
export function dropMdSuffix(path) {
  return extensionOf(lastSegment(path)) === "md" ? path.substring(0, path.length - 3) : path;
}

/** Path of a file-like object, stripped of ".md" for notes. */
export function fileLinkPath(file) {
  return file.extension === "md" ? withoutExtension(file.path) : file.path;
}

/** The text a suggestion/bookmark target resolves to. */
export function targetText(item) {
  switch (item.type) {
    case "file":
    case "alias": return withoutMd(item.file.path);
    case "unresolved": return item.linktext;
    case "bookmark": return item.bookmarkPath;
    default: return "";
  }
}

/** True for the four files that make up a plugin folder. */
export function isPluginFileName(name) {
  return name === "manifest.json" || name === "main.js" || name === "styles.css" || name === "data.json";
}

/** Path plus suffix. */
export function pathWith(file, suffix) {
  return file.path + suffix;
}

// ---- link text ("note#heading") ----

/** The part of a link before "#". */
export function linkPath(link) {
  const hash = link.indexOf("#");
  return hash < 0 ? link : link.substring(0, hash);
}

/** Splits "note#sub" into { path, subpath }, subpath keeps its "#". */
export function parseLinktext(link) {
  const hash = link.indexOf("#");
  return hash < 0 ? { path: link, subpath: "" } : { path: link.substring(0, hash), subpath: link.substring(hash) };
}

/** "footnote" | "block" | "heading" for a subpath, null when empty. */
export function subpathKind(subpath) {
  if (!subpath) return null;
  if (subpath.startsWith("#[^")) return "footnote";
  if (subpath.startsWith("#^")) return "block";
  return "heading";
}

/** True for relative links and links without a scheme (no ":"). */
export function isLocalLink(href) {
  return href.startsWith("./") || href.startsWith("../") || href.indexOf(":") === -1;
}

/** Link destination of a markdown link body: "<a b>" or the first word. */
export function linkDestination(body) {
  const text = body.trim();
  if (text.startsWith("<")) {
    const close = text.indexOf(">");
    if (close !== -1) return text.substring(1, close);
  }
  const space = /\s/.exec(text);
  return space ? text.substring(0, space.index) : text;
}

/** decodeURI that leaves malformed input alone. */
export function safeDecodeUri(text) {
  try { return decodeURI(text); } catch (_) { return text; }
}

/** Percent-encodes backslashes, control characters and spaces only. */
export function escapeLinkChars(text) {
  return text.replace(/[\\\x00\x08\x0B\x0C\x0E-\x1F ]/g, (ch) => encodeURIComponent(ch));
}

/** Text of the first ATX heading in a string, null if none. */
export function firstHeadingText(text) {
  const hit = text.match(/^#{1,6} (.*)/m);
  return hit === null ? null : hit[1];
}

/** "#a#b" -> "a > b". */
export function headingTrail(subpath) {
  return subpath.split("#").filter((part) => !!part).join(" > ").trim();
}

/** Normalises a link target: nbsp -> space, trimmed, NFC. */
export function tidyLinkTarget(text) {
  return text.replace(/ /g, " ").trim().normalize("NFC");
}
