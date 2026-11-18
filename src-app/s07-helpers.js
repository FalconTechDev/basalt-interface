// s07 helpers: small application-scope utilities — document position conversion, the
// _handlers event trio used by the CM5-compat facade, the IME-composition dispatch fix,
// cursor restore after undo/redo, embed URL detection, the external-embed iframe,
// the macOS writing-tools formatting menu, outline HTML sections, file-explorer sort
// comparators, search match segment rendering and the lazy-embed weak maps.

import { env } from "./env.js";

// ---------- document position helpers (CM6 Text <-> {line, ch}) ----------

/** Offset of a 0-based {line, ch} position in a CM6 Text; clamps like the original. */
export function s07posToOffset(doc, pos) {
  const ch = pos.ch;
  const line = pos.line + 1;
  if (line < 1) return 0;
  if (line > doc.lines) return doc.length;
  const l = doc.line(line);
  return Math.min(l.from + Math.max(0, ch), l.to);
}

/** {line, ch} of an offset in a CM6 Text, or null when out of range. */
export function s07offsetToPos(doc, offset) {
  if (offset < 0 || offset > doc.length) return null;
  const l = doc.lineAt(offset);
  return { line: l.number - 1, ch: offset - l.from };
}

// ---------- _handlers event trio (targets without addEventListener) ----------

/** Remove one listener; falls back to the `_handlers` map on non-DOM targets. */
export function s07removeHandler(target, type, fn) {
  if (target.removeEventListener) target.removeEventListener(type, fn, false);
  else {
    const map = target._handlers;
    const list = map && map[type];
    if (list) {
      const at = list.indexOf(fn);
      if (at > -1) map[type] = list.slice(0, at).concat(list.slice(at + 1));
    }
  }
}

/** Add one listener; stores it in `_handlers` when there is no addEventListener. */
export function s07addHandler(target, type, fn) {
  if (target.addEventListener) target.addEventListener(type, fn, false);
  else {
    const map = target._handlers || (target._handlers = {});
    map[type] = (map[type] || []).concat(fn);
  }
}

// ---------- editor facade glue ----------

/**
 * Dispatch a CM6 transaction spec through the facade, rewriting a pending
 * "input.type.compose(.start)" user event while an IME composition is in flight.
 */
export function s07cm6Dispatch(facade, spec) {
  const view = facade.cm6;
  if (view.state.readOnly) return;
  let userEvent = "input.type.compose";
  if (facade.curOp && !facade.curOp.lastChange) userEvent = "input.type.compose.start";
  if (spec.annotations && Array.isArray(spec.annotations)) {
    try {
      spec.annotations.some((a) => {
        if (a.value == "input") a.value = userEvent;
      });
    } catch (e) {
      console.error(e);
    }
  } else spec.userEvent = userEvent;
  return view.dispatch(spec);
}

/** Re-dispatch the cursor position recorded at the start of an undo/redo op. */
export function s07cm6RestoreCursor(facade, undo) {
  if (facade.curOp) facade.curOp.$changeStart = undefined;
  (undo ? env().nF : env().iF)(facade.cm6);
  const start = facade.curOp == null ? void 0 : facade.curOp.$changeStart;
  if (start != null) facade.cm6.dispatch({ selection: { anchor: start } });
}

// ---------- embed URL detection ----------

const S07_YOUTUBE_RE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)(?:\/(?:[\w\-]+\?(?:.*?\&)*v=|embed\/|v\/)?)([\w\-]+)(?:\??&?(?:t|start)=([0-9]+))?(?:\S+)?$/;
const S07_TWEET_RE = /^(?:https?:\/\/)?(?:mobile\.)?(?:twitter|x)\.com\/.+\/(\d+)/;

export const s07youtubeRe = S07_YOUTUBE_RE;
export const s07tweetRe = S07_TWEET_RE;

/** Privacy-enhanced YouTube embed URL, or a theme-aware Twitter embed URL, else null. */
export function s07embedUrlFor(text) {
  if (!text || typeof text != "string") return null;
  let m = text.match(S07_YOUTUBE_RE);
  if (m) {
    let url = "https://www.youtube-nocookie.com/embed/" + m[1];
    if (m[2]) url += "?start=" + m[2];
    return url;
  }
  m = text.match(S07_TWEET_RE);
  if (m) {
    const dark = document.body.hasClass("theme-dark");
    return "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=".concat(dark ? "dark" : "light", "&id=").concat(m[1]);
  }
  return null;
}

// ---------- external embed iframe ----------

/** Sandboxed iframe for externally hosted embeds (tweets resize themselves via framemessage). */
export function s07externalEmbed(url) {
  const frame = env().createEl("iframe", "external-embed mod-receives-events");
  frame.setAttr("sandbox", "allow-forms allow-presentation allow-same-origin allow-popups-to-escape-sandbox allow-scripts allow-modals allow-popups");
  frame.setAttr("allow", "fullscreen");
  frame.setAttr("frameborder", "0");
  frame.setAttr("referrerpolicy", "strict-origin-when-cross-origin");
  frame.src = url;
  if (url.contains("platform.twitter.com")) {
    frame.setAttr("scrolling", "no");
    frame.addEventListener("framemessage", (e) => {
      const detail = e.detail;
      if (detail) {
        const tw = detail.data && detail.data["twttr.embed"];
        if (tw && tw.method === "twttr.private.resize") {
          const height = tw.params[0].height;
          if (Number.isNumber(height)) frame.style.height = String(Math.min(1e3, height)) + "px";
        }
      }
    });
    env().Iz(frame.win);
    frame.onWindowMigrated(() => env().Iz(frame.win));
  }
  return frame;
}

// ---------- macOS writing-tools formatting menu ----------

/** Registers the bold/italic/... formatting submenu on a native context menu. */
export function s07writingToolsMenu(menu, editor, state, section) {
  const fmt = env().gm.interface.formatting;
  menu.setShowMacWritingTools(true);
  menu.addSections([section + ".basic", section + ".advanced", section + ".danger"]);
  menu.addItem((item) => {
    item.setSection(section).setTitle(fmt.labelFormatting()).setIcon("lucide-paintbrush").setSubmenu()
      .addItem((sub) => sub.setSection(section + ".basic").setTitle(fmt.toggleBold()).setChecked(state.bold).setIcon("lucide-bold").onClick(() => editor.toggleMarkdownFormatting("bold")))
      .addItem((sub) => sub.setSection(section + ".basic").setTitle(fmt.toggleItalics()).setChecked(state.italic).setIcon("lucide-italic").onClick(() => editor.toggleMarkdownFormatting("italic")))
      .addItem((sub) => sub.setSection(section + ".basic").setTitle(fmt.toggleStrikethrough()).setChecked(state.strikethrough).setIcon("lucide-strikethrough").onClick(() => editor.toggleMarkdownFormatting("strikethrough")))
      .addItem((sub) => sub.setSection(section + ".basic").setTitle(fmt.toggleHighlight()).setChecked(state.highlight).setIcon("lucide-highlighter").onClick(() => editor.toggleMarkdownFormatting("highlight")))
      .addItem((sub) => sub.setSection(section + ".advanced").setTitle(fmt.toggleCode()).setChecked(state.code).setIcon("lucide-code-2").onClick(() => editor.toggleMarkdownFormatting("code")))
      .addItem((sub) => sub.setSection(section + ".advanced").setTitle(fmt.toggleMath()).setChecked(state.math).setIcon("lucide-sigma").onClick(() => editor.toggleMarkdownFormatting("math")))
      .addItem((sub) => sub.setSection(section + ".advanced").setTitle(fmt.toggleComments()).setChecked(state.comment).setIcon("lucide-percent").onClick(() => editor.toggleComment()))
      .addItem((sub) => sub.setSection(section + ".danger").setTitle(fmt.clear()).setIcon("lucide-eraser").onClick(() => editor.clearMarkdownFormatting()));
  });
}

// ---------- outline / table-of-contents HTML ----------

/**
 * Renders the top-level blocks of a markdown document to HTML sections for the
 * outline: each entry is { html, pos, level } plus the parsed frontmatter.
 */
export function s07outlineHtml(markdown) {
  const ast = env().Kx(markdown);
  const definitions = { definitions: env().oT(ast) };
  const sections = [];
  const children = ast.children;
  const frontmatter = env().$x(ast);
  ast.children = [null];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    let level = 7;
    if (child.type === "heading") level = child.depth || 1;
    env().jC(child, ["checklist", "listItem", "code"], (node) => {
      const data = node.data || (node.data = {});
      const props = data.hProperties || (data.hProperties = {});
      props["data-line"] = String(node.position.start.line - child.position.start.line);
    });
    ast.children[0] = child;
    const html = env().Zx(ast, definitions);
    sections.push({ html, pos: env().hT(child.position), level });
  }
  return { sections, frontmatter };
}

// ---------- file explorer sorting ----------

/** Sort-order key pairs offered by the file explorer setting. */
export const s07sortOrderPairs = [
  ["alphabetical", "alphabeticalReverse"],
  ["byModifiedTime", "byModifiedTimeReverse"],
  ["byCreatedTime", "byCreatedTimeReverse"],
];

/** Basename/stat comparators used when no locale sort order is configured. */
export function s07fileSortComparators() {
  const alphabetical = (a, b) => env().ub(a.basename, b.basename);
  const byModifiedTime = (a, b) => b.stat.mtime - a.stat.mtime;
  const byCreatedTime = (a, b) => b.stat.ctime - a.stat.ctime;
  return {
    alphabetical,
    alphabeticalReverse: (a, b) => -alphabetical(a, b),
    byModifiedTime,
    byModifiedTimeReverse: (a, b) => -byModifiedTime(a, b),
    byCreatedTime,
    byCreatedTimeReverse: (a, b) => -byCreatedTime(a, b),
  };
}

/** Localized label comparators from the fileExplorer strings. */
export function s07labelSortComparators() {
  const labels = env().gm.plugins.fileExplorer;
  return {
    alphabetical: labels.labelSortAToZ,
    alphabeticalReverse: labels.labelSortZToA,
    byModifiedTime: labels.labelSortNewToOld,
    byModifiedTimeReverse: labels.labelSortOldToNew,
    byCreatedTime: labels.labelSortCreatedNewToOld,
    byCreatedTimeReverse: labels.labelSortCreatedOldToNew,
  };
}

// ---------- search match segment rendering ----------

const S07_PARA_BREAK_RE = /\r?\n\r?\n/y;
export const s07paraBreakRe = S07_PARA_BREAK_RE;

/**
 * Renders `text` into `el`, wrapping the [start, end) match ranges (clipped to
 * that window) in spans with the search-result-file-matched-text class.
 */
export function s07renderMatchSegments(el, text, start, end, ranges) {
  const paint = (matched, from, to) => {
    const piece = text.substring(from, to);
    if (matched) el.createSpan({ cls: "search-result-file-matched-text", text: piece });
    else el.createSpan({ text: piece });
  };
  let cursor = start;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    let rFrom = range[0];
    if (rFrom >= end) break;
    let rTo = range[1];
    if (rTo < start) continue;
    if (rFrom < start) rFrom = start;
    if (rTo > end) rTo = end;
    if (rFrom > cursor) paint(false, cursor, rFrom);
    paint(true, rFrom, rTo);
    cursor = rTo;
  }
  if (cursor < end) paint(false, cursor, end);
}

// ---------- search field keys ----------

export const s07searchKeyFilepath = "filepath";
export const s07searchResultKeys = ["filename", "filepath", "content", "propertyName", "tag"];

// ---------- lazy-embed caches ----------

/** No-op constructor used as the identity key for per-document search caches. */
export function s07sentinelKey() {}

class S07WeakMapBox {
  constructor() { this.map = new WeakMap(); }
  get(key) { return this.map.get(key); }
  set(key, value) { this.map.set(key, value); return this; }
  has(key) { return this.map.has(key); }
  delete(key) { return this.map.delete(key); }
}

let s07weakMapSeq = 0;

/** WeakMap-shaped fallback for environments without window.WeakMap. */
class S07WeakMapPolyfill {
  constructor() { this._ = "_weakmap_" + s07weakMapSeq++; }
  get(key) { return this.has(key) ? key[this._] : undefined; }
  set(key, value) { Object.defineProperty(key, this._, { configurable: true, value }); return this; }
  has(key) { return Object.hasOwnProperty.call(key, this._); }
  delete(key) { return this.has(key) && delete key[this._]; }
}

export const s07weakMapBox = S07WeakMapBox;
export const s07weakMapPolyfill = S07WeakMapPolyfill;

/** The weak-map factory the embed caches are built from. */
export function s07weakMapFactory() {
  return window.WeakMap ? new S07WeakMapBox() : new S07WeakMapPolyfill();
}

/** Windows that already got the framemessage bridge (see Iz). */
export const s07loadedWindows = new WeakSet();

/** Mermaid flowchart defaults applied on top of the library defaults. */
export const s07mermaidFlowConfig = { progressiveRender: true, asyncParse: true, listBullet: true };

// ---------- embed value + section-tree helpers ----------

/**
 * Fill `el` with an embed attribute value: unwraps single quotes, JSON-decodes
 * double-quoted strings, renders inline `<svg` markup at icon size, otherwise
 * sets the plain text.
 */
export function s07embedAttrValue(el, raw) {
  let value = raw;
  if (value.startsWith("'") && value.endsWith("'")) {
    value = value.substring(1, value.length - 1).replace(/\'/g, "'");
  } else if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (String.isString(parsed)) value = parsed;
    } catch (e) {}
  }
  if (value.startsWith("<svg")) {
    const node = env().xL(value).firstChild;
    if (node && node.instanceOf(SVGSVGElement)) {
      node.setAttrs({ width: 16, height: 16, fill: "currentColor", stroke: "currentColor" });
      el.empty();
      el.appendChild(node);
    }
  } else {
    env().tv(el, value);
  }
}

/** Call `cb` for every `<li>` that contains a nested `<ul>`/`<ol>`. */
export function s07forEachNestedItem(root, cb) {
  const items = root.findAll("li");
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const nested = item.findAll("ul, ol");
    if (nested && nested.length > 0) cb(item);
  }
}

/** Call `cb` with the first child when it is a heading element. */
export function s07ifFirstHeading(el, cb) {
  const first = el.firstChild;
  if (first && first.instanceOf(HTMLHeadingElement)) cb(first);
}

/** Invoke every function in `fns` with the given arguments. */
export function s07callAll(fns, ...args) {
  if (!fns) return;
  for (let i = 0; i < fns.length; i++) fns[i].apply(fns, args);
}

/** Invoke the `_handlers[type]` listeners of a non-DOM event target. */
export function s07emitStored(target, type, ...args) {
  const list = target._handlers?.[type];
  if (!list) return;
  for (let i = 0; i < list.length; i++) list[i].apply(list, args);
}

/** Leading list marker text of a line ("- ", "1. ", "> - [ ] "), or null. */
export function s07leadingListMarker(text) {
  const m = env().aP.exec(text);
  return m && m[0] ? m[0] : null;
}

/** Indentation prefix a continued list item should get at `offset`. */
export function s07listMarkerIndent(doc, offset) {
  const m = doc.lineAt(offset).text.match(env().aP);
  if (!m) return "";
  const quote = m[1] ?? "";
  const marker = m[3] ?? "";
  return quote + " ".repeat(marker.length);
}

/** Structural equality of two RangeSets of possibly different lengths. */
export function s07rangeSetsEqual(a, b) {
  if (a.length === b.length) return a.eq(b);
  return a.length < b.length ? b.slice(0, a.length).eq(a) : a.slice(0, b.length).eq(b);
}
