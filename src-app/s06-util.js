// s06 utility replacements: editor positions, frontmatter helpers, table-cell
// helpers, link/tag suggestion helpers and small comparators.
// Dependencies that still live in the inherited bundle are reached through
// env() (manifest envBind names) or the trailing `host` argument that
// manifest entries with "host": true receive; helpers already rewritten are
// called by their own names.
import { env } from "./env.js";

// ---- shared regular expressions / constants (also spliced back as declarators) ----

/** Matches a leading blockquote marker `> ` (with up to two spaces of indent). */
export const s06BlockquoteRe = /^\s{0,3}>(\s*)/;
/** Matches a `#tag` at the end of a line (used by the tag suggest trigger). */
export const s06TagRe = /(^|\s)#[^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]*$/g;
/** Matches a whole `[[link|alias]]` / `[[link]]` wikilink. */
export const s06WikiLinkRe = /^(!?\[\[)(.*?)(\|(.*))?(]])$/;
/** Matches a footnote reference `#1234`. */
export const s06FootnoteRefRe = /^#\d+$/;
/** Matches a leading list marker or blockquote (used by line classification). */
export const s06ListMarkerRe = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/;
/** Matches a leading heading marker. */
export const s06HeadingRe = /^([>\s]*)(#{1,6} )?(.*)/;
/** ISO-like date+time accepted by the date properties. */
export const s06DateTimeRe = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/;
/** ISO-like date accepted by the date properties. */
export const s06DateRe = /^\d{4}-[01]\d-[0-3]\d$/;
/** moment.js formats tried for datetime property values, most specific first. */
export const s06DateTimeFormats = ["YYYY-MM-DD[T]HH:mm:ss", "YYYY-MM-DD[T]HH:mm", "YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm"];
/** moment.js formats tried for date property values. */
export const s06DateFormats = ["YYYY-MM-DD"];
/** HTML comment that marks generated/managed blocks in file contents. */
export const s06CommentPrefix = "<!-- basalt -->";
/** Input rules that turn CJK bracket pairs into wikilink brackets. */
export const s06CjkBrackets = [
  { regex: /(！)?【【$/, replace: (m) => (m[1] ? "![[" : "[[") },
  { regex: /】】$/, replace: () => "]]" },
  { regex: /【【$/, replace: () => "[[" },
];
/** Empty suggestion result shared by suggest flows. */
export const s06EmptySuggestion = { type: "none", matches: null, score: 0 };

// ---- editor positions ({line, ch} <-> offsets in a CodeMirror doc) ----

/** Builds a position object. */
export function s06Pos(line, ch = 0) { return { line, ch }; }

/** Position equality on line and ch only. */
export function s06PosEq(a, b) { return a.line === b.line && a.ch === b.ch; }

/** Position shifted by `ch` columns on the same line. */
export function s06PosAdd(pos, ch) { return { line: pos.line, ch: pos.ch + ch }; }

/** Offset of a {line, ch} position inside a CodeMirror doc; negative `ch` counts from line end, missing `ch` means line end. */
export function s06PosToOffset(doc, pos) {
  if (pos.line < 0) return 0;
  const lineNo = pos.line + 1;
  if (lineNo > doc.lines) return doc.length;
  const line = doc.line(lineNo);
  if (!isFinite(pos.ch)) return line.to;
  return pos.ch < 0 ? line.from + Math.max(0, line.length + pos.ch) : line.from + pos.ch;
}

/** {line, ch} of an offset inside a CodeMirror doc (clamped to the doc). */
export function s06OffsetToPos(doc, offset) {
  offset = Math.clamp(offset, 0, doc.length);
  const line = doc.lineAt(offset);
  return { line: line.number - 1, ch: offset - line.from };
}

// ---- small pure helpers ----

/** Visual width of the blockquote prefix of a line (4-space groups inside the marker collapse). */
export function s06QuotePrefixWidth(text) {
  const m = text.match(s06BlockquoteRe);
  if (!m) return 0;
  let indent = m[1];
  while (indent.startsWith("    ")) indent = indent.substring(4);
  const width = m[0].length - m[1].length;
  return indent.startsWith(" ") ? width + 1 : width;
}

/** Sets `value` at `path` inside `obj`, creating arrays/objects along the way; mutates `obj` and `path`. */
export function s06SetPath(obj, path, value) {
  while (obj && path.length) {
    const key = path.shift();
    if (Array.isArray(obj)) {
      const index = parseInt(key);
      if (isNaN(index) || index < 0 || index >= obj.length) return;
      if (!(path.length > 0)) { obj[index] = value; return; }
      obj = obj[index];
    } else {
      if (typeof obj !== "object") return;
      if (!(path.length > 0)) { obj[key] = value; return; }
      obj = obj[key];
    }
  }
}

/** Deep-merges `source` into `target`: arrays concatenate+dedupe, plain objects recurse, other values overwrite. */
export function s06MergeDeep(target, source) {
  if (Object.keys(source).length === 0) return;
  for (const key in source) {
    if (!source.hasOwnProperty(key)) continue;
    const oldVal = target.hasOwnProperty(key) ? target[key] : undefined;
    const newVal = source[key];
    if (oldVal) {
      if (Array.isArray(oldVal) && Array.isArray(newVal)) target[key] = oldVal.concat(newVal).unique();
      else if (typeof oldVal === "object" && newVal !== null && typeof newVal === "object") s06MergeDeep(oldVal, newVal);
      else if (newVal !== null) target[key] = newVal;
    } else target[key] = newVal;
  }
}

// ---- frontmatter helpers ----

/** Serializes a frontmatter object to a `---\n...\n---\n` block (empty object -> ""). */
export function s06FrontmatterBlock(data) {
  let out = "";
  if (data && Object.keys(data).length > 0) {
    const body = env().vA(data).trim();
    out = "---\n".concat(body, "\n---\n");
  }
  return out;
}

/** Splits file text into {content, frontmatter} at the frontmatter block. */
export function s06ParseFrontmatter(text) {
  const info = env().Xx(text);
  const content = text.slice(info.contentStart);
  let frontmatter = {};
  if (info.frontmatter) frontmatter = env().mA(info.frontmatter);
  return { content, frontmatter };
}

/** Returns `text` with its body only, prefixed by the serialized frontmatter `data`. */
export function s06WithFrontmatter(text, data) {
  const block = s06FrontmatterBlock(data);
  const info = env().Xx(text);
  return block + text.slice(info.contentStart);
}

/** Lets `mutate` edit the parsed frontmatter object, then rewrites the file's frontmatter block. */
export function s06UpdateFrontmatter(text, mutate) {
  const info = env().Xx(text);
  const data = info.exists ? env().mA(info.frontmatter) : {};
  const obj = data && typeof data === "object" ? data : {};
  mutate(obj);
  if (Object.keys(obj).length === 0) return info.exists ? text.slice(info.contentStart) : text;
  const block = env().vA(obj);
  return info.exists ? text.slice(0, info.from) + block + text.slice(info.to) : "---\n" + block + "---\n" + text;
}

// ---- table helpers ----

/** True when `el` is a table header row (`<thead>` context and only `<th>` children). */
export function s06IsHeaderRow(el) {
  if (!el) return false;
  const parent = el.parentNode;
  if (parent.nodeName === "THEAD") return true;
  const firstOfKind = parent.firstChild === el &&
    (parent.nodeName === "TABLE" ||
      (parent.nodeName === "TBODY" &&
        (!parent.previousSibling ||
          (parent.previousSibling.nodeName === "THEAD" && /^\s*$/i.test(parent.previousSibling.textContent)))));
  return firstOfKind && Array.prototype.every.call(el.childNodes, (child) => child.nodeName === "TH");
}

/** Converts a list of offsets into {line, ch} positions by scanning newlines. */
export function s06OffsetsToPositions(text, offsets) {
  let line = 0, lineStart = 0, nl = text.indexOf("\n"), out = [];
  for (let k = 0; k < offsets.length; k++) {
    const offset = offsets[k];
    while (nl < offset) {
      if (nl === -1) { nl = text.length; break; }
      line++; lineStart = nl + 1; nl = text.indexOf("\n", lineStart);
    }
    out.push({ line, ch: offset - lineStart });
  }
  return out;
}

/** Extra columns a `<td>` spans (colspan - 1, 0 when absent/invalid). */
export function s06Colspan(cell) {
  const raw = cell.getAttribute("colspan");
  if (!raw) return 0;
  const n = parseInt(raw);
  return isNaN(n) ? 0 : Math.max(0, n - 1);
}

/** `filler` repeated for each extra column the cell spans. */
export function s06ColspanRepeat(cell, filler) {
  return filler.repeat(s06Colspan(cell));
}

// ---- table cell text <-> markdown escaping (produces a CodeMirror ChangeSet) ----

const S06_CELL_BREAK_RE = /(\r?\n|\\*\|)/g;
const S06_CELL_CODE_RE = /(`+)[^`]+\1/g;
const S06_CELL_ESCAPED_RE = /(\\+\||<br>)/gi;

/** Escapes raw newlines/pipes in cell `text` for markdown; returns {result, changes}. */
export function s06EscapeTableCell(text) {
  const changes = [];
  const length = text.length;
  let delta = 0;
  const matches = Array.from(text.matchAll(S06_CELL_BREAK_RE));
  for (let k = 0; k < matches.length; k++) {
    const m = matches[k], token = m[1], at = m.index, size = token.length;
    const isPipe = token[token.length - 1] === "|";
    let insertAt = at, insertSize = size, insert;
    if (isPipe) {
      const bs = token.match(/^(\\+)/);
      if (bs && bs[1].length % 2 === 1) continue;
      if (bs) { insertAt = at + size - 1; insertSize = 1; }
      insert = "\\|";
    } else {
      insert = "<br>";
    }
    const pos = insertAt + delta;
    text = text.substring(0, pos) + insert + text.substring(pos + insertSize);
    delta -= insertSize - insert.length;
    changes.push({ from: insertAt, to: insertAt + insertSize, insert });
  }
  return { result: text, changes: env().re.of(changes, length) };
}

/** Replaces `<br>`/escaped-pipe/code-span markers inside cell `text`; returns {result, changes}. */
export function s06UnescapeTableCell(text) {
  const changes = [];
  const length = text.length;
  let delta = 0;
  const codeSpans = Array.from(text.matchAll(S06_CELL_CODE_RE));
  const apply = (m) => {
    const token = m[1], at = m.index, size = token.length;
    let from = at, span = size, insert;
    if (token.toLowerCase() !== "<br>") {
      const bs = token.match(/^(\\+)/);
      if (bs && bs[1].length % 2 === 0) return;
      if (bs) { from = at + span - 2; span = 2; }
      insert = "|";
    } else {
      if (codeSpans.some((s) => s.index < m.index && s.index + s[0].length > at + span)) return;
      insert = "\n";
    }
    const pos = from + delta;
    text = text.substring(0, pos) + insert + text.substring(pos + span);
    delta -= span - insert.length;
    changes.push({ from, to: from + span, insert });
  };
  const escaped = Array.from(text.matchAll(S06_CELL_ESCAPED_RE));
  for (let k = 0; k < escaped.length; k++) apply(escaped[k]);
  return { result: text, changes: env().re.of(changes, length) };
}

// ---- search/suggestion helpers ----

/** Tries `matchFn` on the basename first, then the whole text (score -1 on fallback). */
export function s06MatchBasenameFirst(matchFn, text) {
  const base = lastSegment(text);
  let hit = matchFn(base);
  if (hit) {
    shiftRanges(hit.matches, text.length - base.length);
    return hit;
  }
  hit = matchFn(text);
  if (hit) hit.score -= 1;
  return hit;
}

/** Comparator: higher score first. */
export function s06CompareScoreDesc(a, b) { return b.score - a.score; }

/** Comparator: shorter path first. */
export function s06ComparePathLength(a, b) { return a.path.length - b.path.length; }

// ---- platform / view helpers ----

/** True when an iOS "open in Files" drop should be honoured for this dataTransfer. */
export function s06HasIosFilesDrop(dataTransfer) {
  for (let i = 0; i < dataTransfer.items.length; i++) {
    if (dataTransfer.items[i].kind === "file") return true;
  }
  return env().Yl.isIosApp && dataTransfer.types.indexOf("Files") !== -1;
}

/** True when `view` exposes a properties metadata editor. */
export function s06HasMetadataEditor(view, host) {
  return view && typeof view === "object" && Object.hasOwn(view, "metadataEditor") && view.metadataEditor instanceof host.MetadataEditor;
}

/** The metadata editor of the workspace's active editor or active leaf view, when visible. */
export function s06ActivePropertiesEditor(workspace, host) {
  const editor = workspace.activeEditor;
  if (s06HasMetadataEditor(editor, host) && editor.canShowProperties()) return editor.metadataEditor;
  const leaf = workspace.activeLeaf;
  const view = leaf === null || leaf === undefined ? undefined : leaf.view;
  return s06HasMetadataEditor(view, host) && view.canShowProperties() ? view.metadataEditor : null;
}

/** Sanitizes `html` through DOMPurify and imports the result as a DOM node. */
export function s06SanitizeHtml(html, host) {
  return document.importNode(host.s06Purify.sanitize(html, host.s06PurifyConfig), true);
}

// ---- link text helpers ----

/** Turns a drop/link target into markdown link texts (file(s), link, heading, bookmarks). */
export function s06DropLinkTexts(app, target, sourcePath, embed, host) {
  const fileManager = app.fileManager, vault = app.vault;
  const linkFor = (file, subpath, alias) => {
    const md = fileManager.generateMarkdownLink(file, sourcePath, subpath, alias);
    return embed && host.isImageExtension(file.extension) ? "!" + md : md;
  };
  if (target.type === "file") return [linkFor(target.file)];
  if (target.type === "files") {
    const out = [];
    for (let i = 0; i < target.files.length; i++) {
      const f = target.files[i];
      if (f instanceof host.TFile) out.push(linkFor(f));
    }
    return out;
  }
  if (target.type === "link") {
    if (target.file) {
      const subpath = parseLinktext(target.linktext).subpath;
      return [linkFor(target.file, subpath)];
    }
    return [target.linktext];
  }
  if (target.type === "heading") {
    const subpath = "#" + linkSafeHeading(target.heading.heading);
    return [linkFor(target.file, subpath)];
  }
  if (target.type === "bookmarks") {
    const out = [];
    for (let i = 0; i < target.items.length; i++) {
      const item = target.items[i].item;
      if (item.type === "file") {
        const file = vault.getAbstractFileByPath(item.path);
        if (file instanceof host.TFile) out.push(linkFor(file, item.subpath, item.title));
      }
    }
    return out;
  }
  return [];
}

/** Rewrites the link inside a {original, link} pair to `newLink`, preserving alias/format. */
export function s06RewriteLink(pair, newLink, host) {
  const original = pair.original, link = pair.link;
  const wiki = original.match(s06WikiLinkRe);
  let result;
  if (wiki) {
    const bang = wiki[1], inner = wiki[2], pipe = wiki[4], tail = wiki[5];
    let alias = pipe === undefined ? "" : pipe;
    if (alias) {
      const sep = /\\\|/.test(original) ? "\\|" : "|";
      if (inner.contains("/")) {
        const trimmed = alias.trim();
        if (baseName(inner) === trimmed) alias = baseName(linkPath(newLink));
      }
      result = bang + newLink + sep + alias + tail;
    } else result = bang + newLink + tail;
  } else {
    const md = original.match(host.s06MdLinkPattern);
    const safe = !md || !md[5].startsWith("<") ? escapeLinkChars(newLink) : "<" + newLink + ">";
    if (md) {
      let text = md[2];
      const display = plainSpaces(text).trim();
      const oldPath = linkPath(link);
      if (display === displayName(oldPath)) text = displayName(linkPath(newLink));
      else if (display.contains("/") && display === withoutMd(oldPath)) text = withoutMd(linkPath(newLink));
      result = md[1] + text + md[3] + safe + (md[6] !== null && md[6] !== undefined ? md[6] : "") + md[8];
    } else {
      result = "[](".concat(safe, ")");
      if (original.startsWith("!")) result = "!" + result;
    }
  }
  return result;
}

/** Computes the link update for a resolved link whose target paths changed. */
export function s06LinkChangeFor(resolved, metadataCache, host) {
  const reference = resolved.reference, sourceFile = resolved.sourceFile;
  const resolvedPaths = resolved.resolvedPaths;
  const sourcePath = sourceFile.path;
  const parsed = parseLinktext(reference.link);
  const linkPathPart = parsed.path, subpath = parsed.subpath;
  const destPaths = metadataCache.getLinkpathDest(linkPathPart, sourcePath).map((d) => d.path);
  const same = destPaths.length !== 0 && s06ArraysEqual(resolvedPaths, destPaths);
  if (same) return undefined;
  const wasWiki = s06WikiLinkRe.test(reference.original);
  const newLink = metadataCache.fileToLinktext(resolved.resolvedFile, sourcePath, wasWiki) + subpath;
  if (reference.link === newLink) return undefined;
  return { sourcePath, reference, change: s06RewriteLink(reference, newLink, host) };
}

function s06ArraysEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; ++i) if (a[i] !== b[i]) return false;
  return true;
}

/** {path, subpath} a link/suggestion item points at. */
export function s06LinkTarget(item) {
  let parsed, path = "", subpath = "";
  if (item.type === "block") { path = item.file.path; subpath = "#^" + item.node.id; }
  else if (item.type === "heading") { path = item.file.path; subpath = "#" + linkSafeHeading(item.heading); }
  else if (item.type === "file" || item.type === "alias") { path = item.file.path; }
  else if (item.type === "linktext") { parsed = parseLinktext(item.path); path = parsed.path; subpath = parsed.subpath; }
  return { path, subpath };
}

/** Tag suggestions for `query` from the metadata cache (prefix `#` included when `withHash`). */
export function s06TagSuggestions(metadataCache, query, withHash, host) {
  if (withHash === undefined) withHash = false;
  query = query.toLowerCase();
  let tags = Object.keys(metadataCache.getTags());
  if (!withHash) tags = tags.map((t) => t.slice(1));
  const prepared = prepareQuery(query);
  tags.sort(host.compareStrings);
  const out = [];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (query === "" || (query === "#" && withHash)) out.push({ tag, score: 0, matches: null });
    else {
      const hit = fuzzyMatchJs(prepared, tag.toLowerCase());
      if (hit) out.push({ tag, score: hit.score, matches: hit.matches });
    }
  }
  out.sort(s06CompareScoreDesc);
  return out;
}
