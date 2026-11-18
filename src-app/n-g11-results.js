// g11 clean-room: search result helpers and the virtualised results list.
// FileQueue paces files through an async iterator; SearchResults owns an
// InfinityScroll of SearchFileResult rows, each expandable into SearchMatchResult /
// SearchPropertyResult rows. DOM hooks use the contract class names from the spec.

import { methods } from "./inherit.js";
import { env } from "./env.js";
import { ng15MakeTreePusher,ng15MountChildren,ng15MarkItemCollapsed,ng15NextVisibleTreeItem,ng15PrevVisibleTreeItem,ng15LastVisibleTreeItem,ng15AnimateCollapse,ng15ExpandFromZero } from "./n-g15-tree.js";
import { debounceCall } from "./timing.js";
import { lastSegment,extensionOf } from "./path.js";

export const ng11SearchViewClasses = {};
let ng11Host = null;
function H() { return ng11Host; }
function ng11BindHost(host) { if (host) ng11Host = host; return ng11Host; }

// ---- small helpers --------------------------------------------------------------------------------

let ng11Collator = null;
function ng11TextCollator() {
  if (!ng11Collator) ng11Collator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });
  return ng11Collator;
}

/** Locale-aware, case-insensitive, numeric-aware text comparison. */
export function ng11CompareSearchText(a, b) {
  return ng11TextCollator().compare(a, b);
}

const NG11_RESULT_KEYS = ["filename", "filepath", "content", "propertyName", "tag"];

/** Total number of matches a result object carries (ranges + property rows). */
export function ng11CountSearchMatches(match) {
  if (!match) return 0;
  let count = 0;
  for (const key of NG11_RESULT_KEYS) count += (match[key] || []).length;
  for (const key of Object.keys(match)) {
    if (key.startsWith("canvas-") && Array.isArray(match[key])) count += match[key].length;
  }
  count += (match.properties || []).length;
  return count;
}

/** Fills `el` with child spans covering [from,to); matched ranges get the highlight class. */
export function ng11RenderMatchRanges(el, text, from, to, matches) {
  el.empty();
  let pos = from;
  const list = (matches || []).slice().sort((a, b) => a[0] - b[0]);
  for (const [s0, e0] of list) {
    const s = Math.max(s0, from), e = Math.min(e0, to);
    if (e <= s || s < pos) continue;
    if (s > pos) el.createSpan({ text: text.substring(pos, s) });
    el.createSpan({ cls: "search-result-file-matched-text", text: text.substring(s, e) });
    pos = e;
  }
  if (pos < to) el.createSpan({ text: text.substring(pos, to) });
}

/** Index of `offset` inside sorted {position:{start,end}} records; preferEnd picks the later on ties. */
export function ng11IndexOfPositionOffset(list, offset, preferEnd) {
  if (!list || !list.length) return 0;
  const startOf = (it) => (it.position ? it.position.start.offset : it.start.offset);
  const endOf = (it) => (it.position ? it.position.end.offset : it.end.offset);
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (startOf(list[mid]) < offset) lo = mid + 1; else hi = mid;
  }
  if (preferEnd && lo > 0 && endOf(list[lo - 1]) >= offset) return lo - 1;
  return lo;
}

/** Prevents the middle mouse button from starting a drag-selection on `el`. */
export function ng11PreventMiddleClick(el) {
  el.addEventListener("mousedown", (event) => {
    if (event.button === 1) event.preventDefault();
  });
}

/**
 * Line-bounded window around `range` ([s,e)) expanding up to `maxDist` chars each way.
 * Returns [start, end, clipStart, clipEnd].
 */
export function ng11ContextLineBounds(content, range, maxDist = 100) {
  const rs = Array.isArray(range) ? range[0] : range.start;
  const re = Array.isArray(range) ? range[1] : range.end;
  let start = rs, end = re;
  while (start > 0 && content[start - 1] !== "\n" && rs - start < maxDist) start--;
  while (end < content.length && content[end] !== "\n" && end - re < maxDist) end++;
  let clipStart = false, clipEnd = false;
  if (start > 0 && content[start - 1] !== "\n") { clipStart = true; start = Math.max(0, rs - maxDist); }
  if (end < content.length && content[end] !== "\n") { clipEnd = true; end = Math.min(content.length, re + maxDist); }
  return [start, end, clipStart, clipEnd];
}

// ---- sort orders ---------------------------------------------------------------------------------

const ng11ByName = (a, b) => ng11CompareSearchText(a.basename || a.name, b.basename || b.name);
const ng11ByMtime = (a, b) => (b.stat && b.stat.mtime || 0) - (a.stat && a.stat.mtime || 0);
const ng11ByCtime = (a, b) => (b.stat && b.stat.ctime || 0) - (a.stat && a.stat.ctime || 0);

/** Sort-key -> comparator over TFile-like items. */
export const ng11SearchSortOrders = {
  alphabetical: ng11ByName,
  alphabeticalReverse: (a, b) => -ng11ByName(a, b),
  byModifiedTime: ng11ByMtime,
  byModifiedTimeReverse: (a, b) => -ng11ByMtime(a, b),
  byCreatedTime: ng11ByCtime,
  byCreatedTimeReverse: (a, b) => -ng11ByCtime(a, b),
};

export const ng11SearchSortGroups = [
  ["alphabetical", "alphabeticalReverse"],
  ["byModifiedTime", "byModifiedTimeReverse"],
  ["byCreatedTime", "byCreatedTimeReverse"],
];

const NG11_SORT_LABELS = {
  alphabetical: "labelSortAToZ",
  alphabeticalReverse: "labelSortZToA",
  byModifiedTime: "labelSortNewToOld",
  byModifiedTimeReverse: "labelSortOldToNew",
  byCreatedTime: "labelSortCreatedNewToOld",
  byCreatedTimeReverse: "labelSortCreatedOldToNew",
};

/** Display label for a sort key (file-explorer i18n table). */
export function ng11SearchSortLabel(key) {
  const table = H().t.plugins.fileExplorer;
  return table[NG11_SORT_LABELS[key] || "labelSortAToZ"]();
}

/** Comparator for `order` (unknown -> alphabetical). */
export function ng11SortOrderComparator(order) {
  return ng11SearchSortOrders[order] || ng11SearchSortOrders.alphabetical;
}

// ---- visibility / clipboard / pacing ---------------------------------------------------------------

/** Hides or shows `el`, optionally animating the collapse/expand. */
export async function ng11ToggleElementVisibility(el, hide, animate) {
  if (hide) {
    if (animate) await ng15AnimateCollapse(el);
    el.hide();
  } else {
    el.show();
    if (animate) await ng15ExpandFromZero(el);
  }
}

/** Writes `text` to the clipboard (async Clipboard API with execCommand fallback). */
export async function ng11CopyTextToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (e) { /* fall through */ }
  const area = createEl("textarea");
  area.style.cssText = "position:fixed;opacity:0";
  area.value = text;
  activeDocument.body.appendChild(area);
  area.select();
  try { activeDocument.execCommand("copy"); } catch (e) { /* noop */ }
  area.remove();
}

/**
 * Yields every item of `iterable`; every `batchSize` items, when more than `duration` ms
 * elapsed since the last checkpoint, calls `beforePause(now)` and idles up to `maxDelay` ms.
 */
export async function* ng11BatchedIteration(iterable, options = {}) {
  const batchSize = options.batchSize ?? 10;
  const duration = options.duration ?? 5;
  const maxDelay = options.maxDelay ?? 100;
  const beforePause = options.beforePause;
  let last = performance.now();
  let count = 0;
  for await (const item of iterable) {
    yield item;
    count++;
    const now = performance.now();
    if (count >= batchSize) {
      count = 0;
      if (now - last > duration) {
        last = now;
        if (beforePause) await beforePause(now);
        await new Promise((r) => setTimeout(r, maxDelay));
      }
    }
  }
}

// ---- FileQueue -------------------------------------------------------------------------------------

/**
 * Async-iterable work queue shared by search, graph filtering and publish snippets.
 * Items are yielded one at a time; the consumer drives the pace. `runnable` reports
 * running while items exist and cancelled after cancel().
 */
export function ng11DefineFileQueue(host) {
  ng11BindHost(host);
  function FileQueue(options = {}) {
    this.items = [];
    this._wake = null;
    this._running = false;
    this._cancelled = false;
    this._cancelNotified = false;
    this.options = options;
    const self = this;
    this.runnable = {
      start() {
        if (self._cancelled || self._running) return;
        self._running = true;
        if (self.options.onStart) self.options.onStart();
      },
      stop() {
        if (!self._running) return;
        self._running = false;
        if (self.options.onStop) self.options.onStop();
      },
      cancel() { self.cancel(); },
      isRunning() { return self._running; },
      isCancelled() { return self._cancelled; },
    };
  }
  const proto = FileQueue.prototype;

  proto.add = function (item) {
    this.items.push(item);
    this.notify();
  };
  proto.addList = function (list) {
    for (const item of list) this.items.push(item);
    this.notify();
  };
  proto.remove = function (item) {
    let i;
    while ((i = this.items.indexOf(item)) >= 0) this.items.splice(i, 1);
  };
  proto.clear = function () {
    this.items = [];
  };
  /** Wakes a sleeping consumer (resolved on a macrotask so adds batch). */
  proto.notify = function () {
    if (this._wake) {
      const wake = this._wake;
      this._wake = null;
      setTimeout(wake, 0);
    }
  };
  proto.cancel = function () {
    if (this._cancelled) return;
    this._cancelled = true;
    this.notify();
    if (!this._cancelNotified) {
      this._cancelNotified = true;
      if (this.options.onCancel) this.options.onCancel();
    }
  };

  proto._waitForItems = function () {
    return new Promise((resolve) => { this._wake = resolve; });
  };

  proto.generator = async function* () {
    const self = this;
    for (;;) {
      while (self.items.length > 0) {
        if (self._cancelled) return;
        self.runnable.start();
        const item = self.items.shift();
        yield item;
      }
      if (self._cancelled) return;
      self.runnable.stop();
      await self._waitForItems();
    }
  };

  ng11SearchViewClasses.FileQueue = FileQueue;
  return FileQueue;
}

// ---- runSearchOverFiles -----------------------------------------------------------------------------

/**
 * Streams `queue.generator()` through `callback(file, content)`. Skips user-ignored and
 * unsupported files; reads content (cachedRead, errors -> "") only for md/canvas when
 * `requiredInputs.content`; honours queue cancellation and `options.beforePause`.
 */
export async function ng11RunSearchOverFiles(app, requiredInputs, queue, callback, options = {}) {
  const needContent = !!(requiredInputs && requiredInputs.content);
  for await (const file of ng11BatchedIteration(queue.generator(), options)) {
    if (queue.runnable.isCancelled()) return;
    if (!file || typeof file.path !== "string") continue;
    if (app.metadataCache.isUserIgnored(file.path)) continue;
    if (!app.metadataCache.isSupportedFile(file)) continue;
    let content = "";
    const ext = file.extension || "";
    if (needContent && (ext === "md" || ext === "canvas")) {
      try { content = await app.vault.cachedRead(file); }
      catch (e) { console.log(e); content = ""; }
    }
    await callback(file, content);
  }
}

// ---- item plumbing -----------------------------------------------------------------------------------

function ng11ItemInfo() {
  return { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
}

function ng11IsModEvent(event) {
  return !!(event && (event.metaKey || event.ctrlKey));
}

function ng11OpenFile(app, file, event, eState) {
  const leaf = app.workspace.getLeaf(ng11IsModEvent(event));
  leaf.openFile(file, { eState });
}

function ng11OpenLink(app, linktext, sourcePath, event, eState) {
  const leaf = app.workspace.getLeaf(ng11IsModEvent(event));
  leaf.openLinkText(linktext, sourcePath, { eState });
}

// ---- match context windows ----------------------------------------------------------------------------

/** Wider context window for extraContext: surrounding block-ish region (~1000 chars). */
function ng11DisplayWindow(content, range) {
  const [rs, re] = range;
  let start = Math.max(0, rs - 500), end = Math.min(content.length, re + 500);
  // prefer snapping outward to blank lines / headings
  const prevBreak = content.lastIndexOf("\n\n", rs);
  if (prevBreak >= 0 && rs - prevBreak < 600) start = Math.min(start, prevBreak + 2);
  const nextBreak = content.indexOf("\n\n", re);
  if (nextBreak >= 0 && nextBreak - re < 600) end = Math.max(end, nextBreak);
  return [start, end];
}

/** Content match windows: merged contextLineBounds, or wider display windows with extraContext. */
function ng11MatchWindows(item, content) {
  const ranges = ((item.result || {}).content || []).slice().sort((a, b) => a[0] - b[0]);
  if (!ranges.length) return [];
  const windows = [];
  if (item.extraContext) {
    for (const r of ranges) {
      const [s, e] = ng11DisplayWindow(content, r);
      windows.push({ start: s, end: e, matches: [[r[0], r[1]]] });
    }
    return windows;
  }
  let cur = null;
  for (const r of ranges) {
    const [s, e, cs, ce] = ng11ContextLineBounds(content, r);
    const m = [Math.max(r[0], s), Math.min(r[1], e)];
    if (cur && s <= cur.end) {
      cur.end = Math.max(cur.end, e);
      cur.clipEnd = cur.clipEnd || ce;
      cur.matches.push(m);
    } else {
      if (cur) windows.push(cur);
      cur = { start: s, end: e, clipStart: cs, clipEnd: ce, matches: [m] };
    }
  }
  if (cur) windows.push(cur);
  return windows;
}

// ---- SearchMatchResult --------------------------------------------------------------------------------

function SearchMatchResult(parentDom, content, cache, start, end, matches) {
  this.parentDom = parentDom;
  this.content = content;
  this.cache = cache;
  this.start = start;
  this.end = end;
  this.matches = matches;
  this.mutateEState = null;
  this.onMatchRender = null;
  this.info = ng11ItemInfo();
  this.el = createDiv("search-result-file-match tappable");
  this.el.addEventListener("click", (e) => this.onResultClick(e));
  this.el.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
  this.el.addEventListener("contextmenu", (e) => this.onResultContextMenu(e));
}
methods(SearchMatchResult, {
  onResultClick(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    const eState = { match: { content: this.content, matches: this.matches } };
    if (this.mutateEState) this.mutateEState(eState);
    ng11OpenFile(this.parentDom.app, this.parentDom.file, event, eState);
  },
  onResultContextMenu(event) {
    if (this.parentDom.onResultContextMenu) this.parentDom.onResultContextMenu(event, this);
  },
  onFocusEnter() { if (this.parentDom.setFocusedItem) this.parentDom.setFocusedItem(this); },
  onFocusExit() {},
  toggleShowMoreContextButtons() {},
  showMoreBefore() {},
  showMoreAfter() {},
  getPrevPos() { return this.start; },
  getNextPos() { return this.end; },
  render(before, after) {
    const el = this.el;
    const from = typeof before === "number" ? before : this.start;
    const to = typeof after === "number" ? after : this.end;
    ng11RenderMatchRanges(el, this.content, from, to, this.matches);
    if (from > this.start) el.prepend(createSpan({ cls: "search-result-file-match-ellipsis", text: "..." }));
    if (to < this.end) el.appendChild(createSpan({ cls: "search-result-file-match-ellipsis", text: "..." }));
    if (this.onMatchRender) this.onMatchRender(this.matches[0], el);
    if (this.parentDom.invalidateScroller) this.parentDom.invalidateScroller();
  },
  onRender() { this.render(); },
});

// ---- SearchPropertyResult --------------------------------------------------------------------------------

function SearchPropertyResult(parentDom, cache, matches) {
  this.parentDom = parentDom;
  this.cache = cache;
  this.matches = matches;
  this.onMatchRender = null;
  this.info = ng11ItemInfo();
  this.el = createDiv("search-result-file-match tappable");
  this.el.addEventListener("click", (e) => this.onResultClick(e));
  this.el.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
}
methods(SearchPropertyResult, {
  onResultClick(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    ng11OpenFile(this.parentDom.app, this.parentDom.file, event, { propertyMatches: this.matches });
  },
  render() {
    const el = this.el;
    el.empty();
    const frontmatter = this.cache && this.cache.frontmatter;
    for (const m of this.matches) {
      const raw = frontmatter ? frontmatter[m.key] : undefined;
      const values = Array.isArray(raw) ? raw : [raw];
      const row = el.createDiv();
      row.createSpan({ text: m.key + ": " });
      const valEl = row.createSpan();
      const text = values.map((v) => (v === undefined || v === null ? "" : String(v))).join(" ");
      ng11RenderMatchRanges(valEl, text, 0, text.length, m.pos ? [m.pos] : []);
    }
  },
  onRender() { this.render(); },
});

// ---- SearchFileResult -------------------------------------------------------------------------------------

function SearchFileResult(app, parentDom, file, result, content, showTitle = true) {
  this.app = app;
  this.parentDom = parentDom;
  this.file = file;
  this.result = result || {};
  this.content = content || "";
  this.showTitle = showTitle;
  this.collapsible = false;
  this.collapsed = false;
  this.extraContext = false;
  this.separateMatches = false;
  this.info = ng11ItemInfo();
  this._rendered = false;
  this._cache = null;
  this.onChildRender = null;

  this.el = createDiv("tree-item search-result");
  this.selfEl = this.el.createDiv("tree-item-self search-result-file-title is-clickable");
  this.coverEl = this.selfEl;
  this.collapseEl = this.selfEl.createDiv("tree-item-icon collapse-icon");
  this.collapseEl.hide();
  H().setIcon(this.collapseEl, "right-triangle");
  this.collapseEl.addEventListener("click", (e) => this.onCollapseClick(e));
  this.innerEl = this.selfEl.createDiv("tree-item-inner");
  this.innerTextEl = this.innerEl.createDiv("tree-item-inner-text");
  this.flairEl = this.selfEl.createDiv("tree-item-flair-outer").createSpan("tree-item-flair");
  this.childrenEl = this.el.createDiv("tree-item-children search-result-file-matches");
  this.vChildren = new (H().TreeChildren)(this);
  this.pusherEl = ng15MakeTreePusher();

  this._buildTitle();
  this._wireEvents();
}
methods(SearchFileResult, {
  _buildTitle() {
    const result = this.result;
    const file = this.file;
    const name = file.name;
    const pathRanges = (result.filepath || []).slice();
    const nameRanges = (result.filename || []).slice();
    if (pathRanges.length) {
      const offset = file.path.length - name.length;
      for (const r of nameRanges) pathRanges.push([r[0] + offset, r[1] + offset]);
      pathRanges.sort((a, b) => a[0] - b[0]);
      ng11RenderMatchRanges(this.innerTextEl, file.path, 0, file.path.length, pathRanges);
    } else if (nameRanges.length) {
      let text = name;
      const last = nameRanges[nameRanges.length - 1];
      if (file.basename && extensionOf(name) === "md" && last && last[1] <= file.basename.length) text = file.basename;
      ng11RenderMatchRanges(this.innerTextEl, text, 0, text.length, nameRanges.map((r) => [r[0], Math.min(r[1], text.length)]));
    } else {
      this.innerTextEl.setText(file.basename && extensionOf(name) === "md" ? file.basename : name);
    }
    this._updateFlair();
  },
  _updateFlair() {
    const result = this.result;
    const count = ng11CountSearchMatches(result)
      - (result.filename ? result.filename.length : 0)
      - (result.filepath ? result.filepath.length : 0);
    this.flairEl.setText(count > 0 ? String(count) : "");
  },
  _wireEvents() {
    const selfEl = this.selfEl;
    ng11PreventMiddleClick(selfEl);
    selfEl.addEventListener("click", (e) => this.onResultClick(e));
    selfEl.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
    selfEl.addEventListener("contextmenu", (e) => this.onResultContextMenu(e));
    selfEl.addEventListener("mouseover", (e) => this.onResultMouseover(e));
    selfEl.addEventListener("dragstart", (e) => {
      if (this.app.dragManager) this.app.dragManager.dragFile(e, this.file);
    });
  },
  onCollapseClick(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.setCollapse(!this.collapsed, true);
  },
  onResultClick(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.defaultPrevented) return;
    const result = this.result;
    const eState = {
      match: { content: result.content || [], matches: result.content || [] },
      propertyMatches: result.properties || [],
    };
    ng11OpenFile(this.app, this.file, event, eState);
  },
  onResultMouseover(event) {
    const app = this.app;
    if (!app.workspace.trigger) return;
    const first = (this.result.content || [])[0];
    const state = {};
    if (first) {
      const before = this.content.slice(0, first[0]);
      state.scroll = before.split("\n").length;
    }
    app.workspace.trigger("hover-link", {
      event, source: "search", hoverParent: this.el, targetEl: this.selfEl,
      linktext: this.file.path, state,
    });
  },
  onResultContextMenu(event, child) {
    event.preventDefault();
    const app = this.app;
    const menu = new (H().Menu)().addSections(["title", "open", "action-primary", "action", "info", "view", "system", "", "danger"]);
    if (app.workspace.handleLinkContextMenu) app.workspace.handleLinkContextMenu(menu, this.file.path, "");
    if (!child) {
      menu.addItem((item) => item
        .setSection("danger")
        .setTitle(H().t.interface.menu.deleteFile())
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(() => app.fileManager.promptForDeletion(this.file)));
    }
    menu.showAtMouseEvent(event);
  },
  setCollapsible(collapsible) {
    this.collapsible = collapsible;
    this.collapseEl.toggle(collapsible);
  },
  setCollapse(collapsed, animate) {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    ng15MarkItemCollapsed(this.el, collapsed);
    ng15MountChildren(this.childrenEl, this.el, collapsed, animate).then(() => {
      if (this.parentDom && this.parentDom.infinityScroll) this.parentDom.infinityScroll.invalidate(this, true);
    });
  },
  setExtraContext(extra) {
    if (this.extraContext === extra) return;
    this.extraContext = extra;
    this.invalidate();
  },
  invalidate() {
    this._rendered = false;
    this.vChildren.clear();
    this.childrenEl.empty();
    if (this.parentDom && this.parentDom.infinityScroll) this.parentDom.infinityScroll.invalidate(this, true);
  },
  onRender() {
    if (!this._rendered) this.renderContentMatches();
  },
  renderContentMatches() {
    this._rendered = true;
    const C = ng11SearchViewClasses;
    this.vChildren.clear();
    this.childrenEl.empty();
    if (!this._cache && this.app.metadataCache && this.file.extension === "md") {
      this._cache = this.app.metadataCache.getFileCache(this.file);
    }
    // property rows first, grouped by key
    const byKey = new Map();
    for (const m of this.result.properties || []) {
      if (!byKey.has(m.key)) byKey.set(m.key, []);
      byKey.get(m.key).push(m);
    }
    for (const matches of byKey.values()) {
      const prop = new C.SearchPropertyResult(this, this._cache, matches);
      this._addChild(prop);
    }
    // canvas text nodes
    const canvasKeys = Object.keys(this.result).filter((k) => k.startsWith("canvas-"));
    if (canvasKeys.length && this.content) {
      try {
        const json = JSON.parse(this.content);
        const nodes = (json.nodes || []).filter((n) => n.type === "text")
          .sort((a, b) => (a.y - b.y) || (a.x - b.x));
        for (const node of nodes) {
          const ranges = this.result["canvas-" + node.id];
          if (!ranges || !ranges.length) continue;
          const text = node.text || "";
          const pseudo = { result: { content: ranges }, extraContext: this.extraContext };
          for (const w of ng11MatchWindows(pseudo, text)) {
            const m = new C.SearchMatchResult(this, text, null, w.start, w.end, w.matches);
            m.mutateEState = (eState) => { eState.match.nodeId = node.id; };
            this._addChild(m);
          }
        }
      } catch (e) { /* not json */ }
    }
    // regular content matches
    for (const w of ng11MatchWindows(this, this.content)) {
      this._addChild(new C.SearchMatchResult(this, this.content, this._cache, w.start, w.end, w.matches));
    }
    const hasMatches = this.vChildren.hasChildren();
    if (hasMatches) this.setCollapsible(true);
    this._updateFlair();
    if (this.collapsed) this.setCollapse(true, false);
    if (this.parentDom && this.parentDom.infinityScroll) this.parentDom.infinityScroll.invalidate(this, true);
  },
  _addChild(child) {
    this.vChildren.addChild(child);
    this.childrenEl.appendChild(child.el);
    child.render();
    if (this.onChildRender) this.onChildRender(child);
  },
});

// ---- SearchResults ---------------------------------------------------------------------------------------

function SearchResults(app, el, emptyText, scrollParent) {
  this.app = app;
  this.el = el;
  this.emptyText = emptyText;
  this.sortOrder = "alphabetical";
  this.collapseAll = false;
  this.extraContext = false;
  this.vChildren = new (H().TreeChildren)(this);
  this.resultDomLookup = new Map();
  this.focusedItem = null;
  this.working = false;
  this._changedQueued = false;

  this.emptyStateEl = el.createDiv("search-empty-state");
  this.emptyStateEl.setText(emptyText || "");
  this.childrenEl = el.createDiv("search-results-children");
  this.pusherEl = ng15MakeTreePusher();
  this.info = ng11ItemInfo();
  this.coverEl = null;

  this.infinityScroll = new (H().InfinityScroll)(scrollParent || el);
  this.infinityScroll.rootEl = this;
  this.infinityScroll.setWidth = false;
  this._onChange = debounceCall(() => this.changed(), 0);
}
methods(SearchResults, {
  changed() {
    const children = this.vChildren.children;
    const cmp = ng11SortOrderComparator(this.sortOrder);
    children.sort((a, b) => cmp(a.file, b.file));
    if (children.length === 0 && !this.working) this.emptyStateEl.show();
    else this.emptyStateEl.hide();
    this.infinityScroll.queueCompute();
  },
  addResult(file, result, content, showTitle = true) {
    const existing = this.resultDomLookup.get(file.path);
    if (existing) {
      existing.result = result;
      existing.content = content || "";
      existing._rendered = false;
      existing.invalidate();
      this._onChange();
      return existing;
    }
    const C = ng11SearchViewClasses;
    const item = new C.SearchFileResult(this.app, this, file, result, content, showTitle);
    item.collapsed = this.collapseAll;
    item.extraContext = this.extraContext;
    this.vChildren.addChild(item);
    this.childrenEl.appendChild(item.el);
    this.resultDomLookup.set(file.path, item);
    this._onChange();
    return item;
  },
  removeResult(file) {
    const item = this.resultDomLookup.get(file.path);
    if (!item) return;
    this.resultDomLookup.delete(file.path);
    this.vChildren.removeChild(item);
    item.el.detach();
    this._onChange();
  },
  getResult(file) { return this.resultDomLookup.get(file.path) || null; },
  emptyResults() {
    for (const item of this.vChildren.children.slice()) {
      this.vChildren.removeChild(item);
      item.el.detach();
    }
    this.resultDomLookup.clear();
    this.focusedItem = null;
    this._onChange();
  },
  getFiles() { return this.vChildren.children.map((c) => c.file); },
  getMatchCount() {
    let count = 0;
    for (const item of this.vChildren.children) count += ng11CountSearchMatches(item.result);
    return count;
  },
  setCollapseAll(collapsed) {
    this.collapseAll = collapsed;
    for (const item of this.vChildren.children) item.setCollapse(collapsed, false);
  },
  setExtraContext(extra) {
    this.extraContext = extra;
    for (const item of this.vChildren.children) item.setExtraContext(extra);
    this.infinityScroll.invalidateAll();
  },
  setFocusedItem(item) {
    if (this.focusedItem === item) return;
    if (this.focusedItem && this.focusedItem.selfEl) this.focusedItem.selfEl.removeClass("has-focus");
    this.focusedItem = item;
    if (item && item.selfEl) {
      item.selfEl.addClass("has-focus");
      this.infinityScroll.scrollIntoView(item);
    }
  },
  changeFocusedItem(direction) {
    const forwards = direction === "forwards";
    let next;
    if (!this.focusedItem || this.focusedItem.info.hidden) {
      next = forwards ? ng15NextVisibleTreeItem(this, true) : ng15PrevVisibleTreeItem(this, true);
      if (!next || next === this) {
        next = forwards ? ng15NextVisibleTreeItem(this.vChildren.first(), true) : ng15LastVisibleTreeItem(this.vChildren.last(), true);
      }
    } else {
      next = forwards ? ng15NextVisibleTreeItem(this.focusedItem, true) : ng15PrevVisibleTreeItem(this.focusedItem, true);
      if (!next || next === this) {
        next = forwards ? ng15NextVisibleTreeItem(this.vChildren.first(), true) : ng15LastVisibleTreeItem(this.vChildren.last(), true);
      }
    }
    if (next && next !== this) this.setFocusedItem(next);
  },
  toggle(hide, animate) {
    if (hide) this.el.hide();
    else {
      this.el.show();
      this.infinityScroll.invalidateAll();
    }
  },
  startLoader() {
    this.working = true;
    this.el.addClass("is-loading");
    this._onChange();
  },
  stopLoader() {
    this.working = false;
    this.el.removeClass("is-loading");
    this._onChange();
  },
  onResize() { this.infinityScroll.onResize(); },
});

// ---- factory exports for the manifest ---------------------------------------------------------------

export function ng11DefineSearchMatchResult(host) {
  ng11BindHost(host);
  ng11SearchViewClasses.SearchMatchResult = SearchMatchResult;
  return SearchMatchResult;
}
export function ng11DefineSearchPropertyResult(host) {
  ng11BindHost(host);
  ng11SearchViewClasses.SearchPropertyResult = SearchPropertyResult;
  return SearchPropertyResult;
}
export function ng11DefineSearchFileResult(host) {
  ng11BindHost(host);
  ng11SearchViewClasses.SearchFileResult = SearchFileResult;
  return SearchFileResult;
}
export function ng11DefineSearchResults(host) {
  ng11BindHost(host);
  ng11SearchViewClasses.SearchResults = SearchResults;
  return SearchResults;
}
