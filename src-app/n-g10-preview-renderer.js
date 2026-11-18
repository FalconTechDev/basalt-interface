// ng10 — clean-room MarkdownPreviewRenderer (was `Gz`): sectioned, virtualised,
// foldable, searchable reading-mode renderer. Own architecture: a render
// scheduler + section pool + viewport window, per the g10 spec.
//
// Host access is lazy (host.X inside functions / env() inside functions); every
// own top-level name is prefixed ng10.

import { env } from "./env.js";
import { inherit, methods } from "./inherit.js";

// ---------------------------------------------------------------------------
// shared lazy-inheritance helper (also used by the other ng10 modules)
// ---------------------------------------------------------------------------

/**
 * Links `Cls` to `getParent()` lazily: the link (and `table` method install)
 * happens on first `ensure()` so own-module parents that initialise later in
 * the bundle are still resolved correctly. Constructors call
 * `Cls.ng10ensure()` first; parents exposing `ng10ensure` are ensured too.
 */
export function ng10Link(Cls, getParent, table) {
  let done = false;
  const ensure = function () {
    if (done) return;
    const Parent = getParent();
    if (!Parent) return;
    if (Parent.ng10ensure) Parent.ng10ensure();
    const prev = Cls.prototype;
    inherit(Cls, Parent);
    for (const key of Object.getOwnPropertyNames(prev)) {
      if (key === "constructor") continue;
      Object.defineProperty(Cls.prototype, key, Object.getOwnPropertyDescriptor(prev, key));
    }
    if (table) methods(Cls, table);
    done = true;
  };
  Object.defineProperty(Cls, "ng10ensure", { value: ensure, configurable: true });
  ensure();
  return ensure;
}

// ---------------------------------------------------------------------------
// markdown parse worker (module-level singleton, serialised requests)
// ---------------------------------------------------------------------------

let ng10Worker = null;
let ng10WorkerFailed = false;
let ng10WorkerQueue = [];
let ng10WorkerBusy = false;

function ng10WorkerMessage(data) {
  const job = ng10WorkerQueue.shift();
  ng10WorkerBusy = false;
  if (job) job.resolve(ng10WorkerResult(data));
  ng10PumpWorker();
}

function ng10WorkerResult(data) {
  if (data && data.sections) return data;
  if (data && data.result && data.result.sections) return data.result;
  return data;
}

function ng10PumpWorker() {
  if (ng10WorkerBusy || ng10WorkerQueue.length === 0 || !ng10Worker) return;
  const job = ng10WorkerQueue[0];
  ng10WorkerBusy = true;
  try {
    ng10Worker.postMessage({ parseSections: job.text, options: job.options });
  } catch (e) {
    ng10WorkerQueue.shift();
    ng10WorkerBusy = false;
    job.reject(e);
    ng10PumpWorker();
  }
}

function ng10EnsureWorker(workerPath) {
  if (ng10Worker || ng10WorkerFailed) return ng10Worker;
  const win = (typeof window !== "undefined" ? window : env().activeWindow) || null;
  const doc = win ? win.document : (typeof document !== "undefined" ? document : null);
  try {
    ng10Worker = new win.Worker(workerPath);
  } catch (e1) {
    try {
      const url = new win.URL(workerPath, doc ? doc.baseURI : undefined);
      ng10Worker = new win.Worker(url.href);
    } catch (e2) {
      ng10WorkerFailed = true;
      return null;
    }
  }
  ng10Worker.onmessage = (event) => ng10WorkerMessage(event.data);
  ng10Worker.onerror = (event) => {
    console.error("markdown worker error", event && event.message);
    // fall back: reject pending jobs; callers re-parse synchronously
    const jobs = ng10WorkerQueue.splice(0);
    ng10WorkerBusy = false;
    for (const job of jobs) job.resolve(null);
    ng10PumpWorker();
  };
  return ng10Worker;
}

function ng10ParseAsync(text, options, workerPath) {
  return new Promise((resolve, reject) => {
    ng10WorkerQueue.push({ text, options, resolve, reject });
    if (!ng10EnsureWorker(workerPath)) {
      ng10WorkerQueue.pop();
      resolve(null);
      return;
    }
    ng10PumpWorker();
  });
}

// ---------------------------------------------------------------------------
// small DOM / geometry helpers
// ---------------------------------------------------------------------------

function ng10IsHidden(el) {
  return !el || !el.isConnected || !el.offsetParent && el !== document.body;
}

/** Client rect of `el` expressed in `container`'s coordinate space (unscaled). */
function ng10RectInContainer(el, container) {
  const a = el.getBoundingClientRect();
  const b = container.getBoundingClientRect();
  return { left: a.left - b.left, top: a.top - b.top, right: a.right - b.left, bottom: a.bottom - b.top, width: a.width, height: a.height };
}

/** True when the selection intersects the preview and is not collapsed. */
function ng10SelectionOverlaps(containerEl) {
  const sel = (env().activeWindow || window).getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i);
    if (containerEl.contains(range.commonAncestorContainer)) return true;
  }
  return false;
}

// ===========================================================================
// MarkdownPreviewRenderer
// ===========================================================================

export function defineMarkdownPreviewRenderer(host) {
  const Section = () => host.MarkdownPreviewSection;
  const RendererBase = () => host.Component;

  function MarkdownPreviewRenderer(owner, linkHandlers, containerEl, workerPath, registerEvents) {
    MarkdownPreviewRenderer.ng10ensure();
    if (this && !(typeof window !== "undefined" && this === window) && Object.getPrototypeOf(this) !== MarkdownPreviewRenderer.prototype) Object.setPrototypeOf(this, MarkdownPreviewRenderer.prototype);
    const self = RendererBase().call(this) || this;
    self.owner = owner;
    self.linkHandlers = linkHandlers;
    self.workerPath = workerPath;
    self.sections = [];
    self.header = null;
    self.footer = null;
    self.text = "";
    self.lastText = null;
    self.frontmatter = null;
    self.frontmatterClasses = null;
    self.asyncSections = [];
    self.recycledSections = [];
    self.renderedCallbacks = [];
    self.renderQueued = false;
    self.parsing = false;
    self.parsePending = false;
    self.scrolling = false;
    self.lastScroll = -1;
    self.lastRender = 0;
    self.scrollTop = 0;
    self.addBottomPadding = false;
    self.sectionPool = new Map();

    self.previewEl = containerEl.createDiv("markdown-preview-view markdown-rendered");
    self.sizerEl = self.previewEl.createDiv("markdown-preview-sizer markdown-preview-section");
    self.pusherEl = createDiv("markdown-preview-pusher");
    self.pusherEl.style.width = "1px";
    self.pusherEl.style.height = "0.1px";
    self.sizerEl.appendChild(self.pusherEl);

    // delegated section clicks
    self.sizerEl.addEventListener("click", (event) => self.onSectionClick(event));
    self.sizerEl.addEventListener("auxclick", (event) => {
      if (event.button === 1 || event.button === 2) self.onSectionClick(event);
    });
    self.previewEl.addEventListener("scroll", () => self.onScroll(), { passive: true });

    MarkdownPreviewRenderer.registerDomEvents(self.sizerEl, linkHandlers, (el) => self.belongsToMe(el));

    if (registerEvents !== false) {
      self.previewEl.onNodeInserted = () => self.queueRender();
      setTimeout(() => self.onResize(), 0);
    }
    return self;
  }
  ng10Link(MarkdownPreviewRenderer, RendererBase);

  const proto = MarkdownPreviewRenderer.prototype;

  // ------------------------------------------------------------- lifecycle --

  proto.set = function (text) {
    this.text = text;
    this.queueRender();
  };

  proto.clear = function () {
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) sections[i].el.empty();
    this.sections = [];
    this.header = null;
    this.footer = null;
    this.sizerEl.empty();
    this.sizerEl.appendChild(this.pusherEl);
    this.text = "";
    this.lastText = null;
    this.frontmatter = null;
    this.asyncSections = [];
    this.recycledSections = [];
    this.scrollTop = 0;
    this.previewEl.scrollTop = 0;
    this.owner.onRenderComplete();
    this.cleanupParentComponents();
    this.queueRender();
  };

  proto.rerender = function (full) {
    this.lastText = null;
    if (full) {
      const sections = this.sections;
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        if (s === this.header || s === this.footer) continue;
        s.rendered = false;
        s.computed = false;
        s.el.empty();
      }
    }
    this.queueRender();
  };

  proto.cleanupParentComponents = function () {
    const owner = this.owner;
    const children = owner._children || owner.children || [];
    const preview = this.previewEl;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child instanceof host.MarkdownRenderChild && child.containerEl && !preview.contains(child.containerEl)) {
        owner.removeChild(child);
      }
    }
  };

  proto.handleDetached = function (el) {
    // a rendered element left the DOM: drop its child components
    const children = this.owner._children || this.owner.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child instanceof host.MarkdownRenderChild && child.containerEl === el) this.owner.removeChild(child);
    }
  };

  // ------------------------------------------------------------ scheduling --

  proto.queueRender = function () {
    if (this.renderQueued) return;
    this.renderQueued = true;
    const schedule = (fn) => (env().activeWindow || window).setTimeout(fn, 0);
    schedule(() => {
      this.renderQueued = false;
      this.onRender();
    });
  };

  proto.onRendered = function (fn) {
    if (!this.renderQueued && !this.parsing && this.asyncSections.length === 0) fn();
    else this.renderedCallbacks.push(fn);
  };

  proto.onResize = function () {
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) sections[i].resetCompute();
    this.updateVirtualDisplay(this.previewEl.scrollTop);
    this.queueRender();
  };

  // ---------------------------------------------------------------- parse --

  proto.parseSync = function (text) {
    return host.parseMarkdownSections(text);
  };

  proto.parseAsync = function (text) {
    const self = this;
    if (self.parsing) { self.parsePending = true; return; }
    self.parsing = true;
    const options = host.markdownOptions.globalOptions;
    const scrollTop = self.previewEl.scrollTop;
    ng10ParseAsync(text, options, self.workerPath).then((result) => {
      self.parsing = false;
      if (result && result.sections) {
        self.previewEl.scrollTop = scrollTop;
        self.parseFinish(result);
        self.queueRender();
      } else {
        // worker unavailable/failed: synchronous fallback
        try {
          self.parseFinish(self.parseSync(text));
        } catch (e) {
          console.error(e);
        }
        self.queueRender();
      }
      if (self.parsePending) {
        self.parsePending = false;
        self.parseAsync(self.text);
      }
    });
  };

  /** Rebuilds the section list from a parse result, pooling sections by html. */
  proto.parseFinish = function (result) {
    const parsed = result.sections || [];
    const frontmatter = result.frontmatter;
    const fmJson = frontmatter ? JSON.stringify(frontmatter) : null;
    const fmChanged = fmJson !== (this.frontmatter ? JSON.stringify(this.frontmatter) : null);
    this.frontmatter = frontmatter;
    if (fmChanged) {
      const old = this.frontmatterClasses || [];
      for (const c of old) this.previewEl.removeClass(c);
      const classes = host.frontmatterClasses(frontmatter);
      const list = classes ? (Array.isArray(classes) ? classes : String(classes).split(/\s+/)).filter(Boolean) : [];
      this.frontmatterClasses = list;
      for (const c of list) this.previewEl.addClass(c);
    }

    const pool = this.sectionPool;
    const used = new Set();
    const next = [];
    const oldByHtml = new Map();
    for (const s of this.sections) {
      if (s === this.header || s === this.footer) continue;
      if (s.rendered) {
        const list = oldByHtml.get(s.html) || [];
        list.push(s);
        oldByHtml.set(s.html, list);
      } else {
        this.recycleSection(s);
      }
    }

    const text = this.text;
    const totalLines = text === "" ? 0 : text.split("\n").length;
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      const html = p.html || "";
      let section = null;
      const candidates = oldByHtml.get(html);
      if (candidates && candidates.length) {
        section = candidates.shift();
        used.add(section);
      } else {
        const pooled = pool.get(html);
        if (pooled && pooled.length) {
          section = pooled.pop();
          pool.delete(html);
          if (!pooled.length) pool.delete(html);
        }
      }
      if (!section) section = new (Section())(html);
      section.level = p.level || 7;
      const pos = p.pos || {};
      const start = pos.start || { line: 0, col: 0, offset: 0 };
      const nextStart = i + 1 < parsed.length ? (parsed[i + 1].pos && parsed[i + 1].pos.start) : null;
      const endLine = nextStart ? nextStart.line : (pos.end ? pos.end.line + 1 : totalLines);
      const endOffset = nextStart ? nextStart.offset : text.length;
      section.start = { line: start.line, col: start.col, offset: start.offset };
      section.end = { line: endLine, col: 0, offset: endOffset };
      section.lines = Math.max(1, endLine - start.line);
      section.shown = true;
      if (fmChanged || section.usesFrontMatter) {
        // frontmatter may be embedded in the section: force re-render
        section.rendered = false;
        section.el.empty();
      }
      next.push(section);
    }

    // unused rendered sections -> recycling pool
    if (oldByHtml) {
      for (const list of oldByHtml.values()) {
        for (const s of list) this.recycleSection(s);
      }
    }
    // async sections that survived keep their pending state
    const kept = [];
    for (const s of this.asyncSections) {
      if (next.indexOf(s) !== -1) kept.push(s);
      else this.recycleSection(s);
    }
    this.asyncSections = kept;

    // header/footer stay at the edges
    if (this.header) next.unshift(this.header);
    if (this.footer) next.push(this.footer);
    this.sections = next;
    this.lastText = text;
  };

  proto.recycleSection = function (section) {
    if (!section.rendered) return;
    const list = this.recycledSections;
    if (list.indexOf(section) === -1) list.push(section);
    const key = section.html;
    let pool = this.sectionPool.get(key);
    if (!pool) this.sectionPool.set(key, (pool = []));
    pool.push(section);
    section.rendered = false;
    section.computed = false;
    section.el.empty();
  };

  // ------------------------------------------------------------- rendering --

  proto.onRender = function () {
    const previewEl = this.previewEl;
    if (!previewEl || previewEl.offsetWidth === 0 || ng10IsHidden(previewEl)) return;

    const text = this.text;
    if (this.lastText !== text && !this.parsing) {
      const flags = host.renderFlags;
      if (!flags.asyncParse || text.length < 10240) {
        try {
          this.parseFinish(this.parseSync(text));
        } catch (e) {
          console.error(e);
        }
      } else {
        this.parseAsync(text);
        return;
      }
    }
    if (this.lastText !== text) return;

    this.renderSections();
    this.updateVirtualDisplay(this.previewEl.scrollTop);
  };

  /** Renders pending sections in a >5 ms / 10-section time slice. */
  proto.renderSections = function () {
    const started = Date.now();
    const sections = this.sections;
    const recyclers = MarkdownPreviewRenderer.recyclers;
    let rendered = 0;
    let pending = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section === this.header || section === this.footer) continue;
      if (!section.rendered) {
        section.render();
        rendered++;
        for (const recycler of recyclers) {
          try { recycler(section.el, this.recycledSections); } catch (e) { console.error(e); }
        }
        // collapse icons
        this.injectCollapseIcons(section);
        // list bullets
        if (host.renderFlags.listBullet) this.injectListBullets(section);
        // post-process
        const promises = [];
        this.owner.postProcess(section, promises, this.frontmatter);
        if (promises.length > 0) {
          const self = this;
          Promise.all(promises.map((p) => Promise.resolve(p).catch(() => null))).then(() => {
            const at = self.asyncSections.indexOf(section);
            if (at !== -1) self.asyncSections.splice(at, 1);
            section.resetCompute();
            self.queueRender();
          });
          if (self.asyncSections.indexOf(section) === -1) self.asyncSections.push(section);
        }
      }
      if (!section.computed) pending++;
      if (rendered >= 10 && Date.now() - started > 5) {
        this.queueRender();
        return;
      }
      if (pending > 100) {
        this.queueRender();
        return;
      }
    }
    // pass complete: run deferred callbacks
    if (this.asyncSections.length === 0) {
      const cbs = this.renderedCallbacks;
      this.renderedCallbacks = [];
      this.lastRender = Date.now();
      for (const cb of cbs) {
        try { cb(); } catch (e) { console.error(e); }
      }
      this.owner.onRenderComplete();
    } else {
      this.queueRender();
    }
  };

  proto.injectCollapseIcons = function (section) {
    const el = section.el;
    const headings = el.findAll("h1,h2,h3,h4,h5,h6");
    for (const h of headings) {
      if (h.querySelector(":scope > .heading-collapse-indicator")) continue;
      const icon = createSpan("heading-collapse-indicator collapse-indicator collapse-icon");
      host.setIcon(icon, "right-triangle");
      h.prepend(icon);
    }
    const items = el.findAll("li");
    for (const li of items) {
      if (li.querySelector(":scope > ul, :scope > ol")) {
        if (!li.querySelector(":scope > .list-collapse-indicator")) {
          const icon = createSpan("list-collapse-indicator collapse-indicator collapse-icon");
          host.setIcon(icon, "right-triangle");
          li.prepend(icon);
        }
      }
    }
  };

  proto.injectListBullets = function (section) {
    const lists = section.el.findAll("ul");
    for (const ul of lists) {
      if (ul.classList.contains("contains-task-list")) continue;
      const items = ul.findAll(":scope > li");
      let hasBullet = false;
      for (const li of items) {
        if (li.classList.contains("task-list-item")) continue;
        if (!li.querySelector(":scope > .list-bullet")) {
          li.prepend(createSpan("list-bullet"));
          hasBullet = true;
        }
      }
      if (hasBullet) ul.addClass("has-list-bullet");
    }
  };

  // -------------------------------------------------------- virtualisation --

  /** Mounts only the viewport±margin window; spacers preserve total height. */
  proto.updateVirtualDisplay = function (scrollTop) {
    const flags = host.renderFlags;
    const sections = this.sections;
    const sizer = this.sizerEl;
    const preview = this.previewEl;
    if (!flags.progressiveRender) {
      // mount everything
      for (const s of sections) if (!s.el.parentElement) sizer.insertBefore(s.el, this.pusherEl.nextSibling);
      sizer.style.minHeight = "";
      this.pusherEl.style.marginBottom = "";
      this.renderHighlights(0, sections.length);
      return;
    }

    const viewportHeight = preview.clientHeight || 0;
    const margin = Math.max(viewportHeight * (flags.renderExtra === undefined ? 1 : flags.renderExtra),
      flags.renderExtraMinPx === undefined ? 500 : flags.renderExtraMinPx);
    const maxScroll = Math.min(scrollTop, Math.max(0, preview.scrollHeight - viewportHeight));
    const from = Math.max(0, maxScroll - margin);
    const to = maxScroll + viewportHeight + margin;

    // estimate heights
    const heights = sections.map((s) => {
      if (!s.shown) return 0;
      if (s.computed) return s.height;
      return -1; // unmeasured
    });
    let measuredSum = 0, measuredCount = 0;
    for (let i = 0; i < sections.length; i++) {
      if (heights[i] > 0) { measuredSum += heights[i]; measuredCount++; }
    }
    const avg = measuredCount ? measuredSum / measuredCount : 0;

    // selection overlap extends the mounted range
    let selFrom = -1, selTo = -1;
    const sel = (env().activeWindow || window).getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      if (sizer.contains(range.startContainer) || sizer.contains(range.endContainer)) {
        // map DOM positions to section indexes
        selFrom = this.sectionIndexAtNode(range.startContainer);
        selTo = this.sectionIndexAtNode(range.endContainer);
      }
    }

    let offset = 0;
    const mounts = [];
    let firstMountedOffset = -1;
    let totalHeight = 0;
    for (let i = 0; i < sections.length; i++) {
      const h = heights[i] < 0 ? avg : heights[i];
      const top = offset;
      const bottom = offset + h;
      const inWindow = bottom >= from && top <= to;
      const keep = inWindow || (selFrom !== -1 && i >= Math.min(selFrom, selTo) && i <= Math.max(selFrom, selTo));
      mounts.push({ section: sections[i], top, height: h, keep: keep && sections[i].shown });
      offset = bottom;
      totalHeight = bottom;
    }

    // detach out-of-window, mount in-window (order: pusher first, then sections)
    const desired = [];
    desired.push(this.pusherEl);
    for (const m of mounts) {
      const el = m.section.el;
      if (m.keep) {
        desired.push(el);
      } else if (el.parentElement === sizer) {
        el.detach();
      }
    }
    // ensure order
    let cursor = this.pusherEl;
    for (let i = 1; i < desired.length; i++) {
      const el = desired[i];
      if (el.previousSibling !== cursor) sizer.insertBefore(el, cursor.nextSibling);
      cursor = el;
    }

    // measure mounted-but-uncomputed sections
    this.measureWindow(mounts, from, to);
    // effective heights include collapsed margins between sections: derive them
    // from live layout (top delta to the next mounted section)
    this.syncSectionHeights();

    // recompute totals with fresh heights
    totalHeight = 0;
    let firstKeepTop = -1;
    let highlightFrom = sections.length, highlightTo = -1;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      const h = s.shown ? (s.computed ? s.height : avg) : 0;
      if (mounts[i].keep) {
        if (firstKeepTop === -1) firstKeepTop = totalHeight;
        if (highlightFrom === sections.length) highlightFrom = i;
        highlightTo = i;
      }
      totalHeight += h;
    }
    const bottomPad = this.addBottomPadding ? Math.max(0, preview.clientHeight || 0) : 0;
    sizer.style.minHeight = Math.max(0, totalHeight - 1 + bottomPad) + "px";
    this.pusherEl.style.marginBottom = Math.max(0, (firstKeepTop === -1 ? totalHeight : firstKeepTop) - (this.topSpace || 0)) + "px";

    this.renderHighlights(highlightFrom, highlightTo);
    this.lastScroll = scrollTop;
  };

  /** Recomputes mounted sections' heights as the layout distance to the next
   * mounted section, so collapsed child margins are accounted for. */
  proto.syncSectionHeights = function () {
    const sizer = this.sizerEl;
    const byEl = new Map();
    for (const s of this.sections) if (s.el) byEl.set(s.el, s);
    for (const s of this.sections) {
      const el = s.el;
      if (!el || el.parentElement !== sizer || !s.shown || !s.rendered) continue;
      // next section element in DOM order (skips overlays/spacers)
      let next = el.nextElementSibling;
      while (next && !byEl.has(next)) next = next.nextElementSibling;
      if (next) {
        const d = next.getBoundingClientRect().top - el.getBoundingClientRect().top;
        if (d > 0) s.height = d;
      } else {
        const oh = el.offsetHeight;
        if (oh > 0) s.height = oh;
      }
    }
  };

  proto.sectionIndexAtNode = function (node) {
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) {
      const el = sections[i].el;
      if (el === node || el.contains(node)) return i;
    }
    return sections.length - 1;
  };

  /** Measures rendered-but-uncomputed sections inside the window. */
  proto.measureWindow = function (mounts, from, to) {
    let pending = 0;
    for (const m of mounts) {
      const s = m.section;
      if (!m.keep || !s.rendered || s.computed || !s.shown) continue;
      pending++;
      const el = s.el;
      // height: prefer offsetHeight of the section element
      s.height = el.offsetHeight || m.height;
      s.computed = true;
      s.lines = s.lines || 1;
      if (pending > 100) break;
    }
    if (pending > 100) this.queueRender();
  };

  // -------------------------------------------------------- search highlights

  proto.renderHighlights = function (from, to) {
    const sizer = this.sizerEl;
    const old = sizer.querySelector(".search-highlight");
    if (old) old.remove();
    const sections = this.sections;
    const overlays = [];
    for (let i = Math.max(0, from | 0); i <= Math.min(sections.length - 1, to | 0); i++) {
      const section = sections[i];
      if (!section.shown || !section.highlightRanges || !section.highlightRanges.length) continue;
      if (!section.el.isConnected && !section.el.parentElement) continue;
      const ranges = section.highlightRanges;
      for (const r of ranges) {
        if (r.rects) continue;
        const textNodes = [];
        host.textNodes(section.el, textNodes);
        // build a DOM Range over the section text for [start,end)
        const domRange = this.rangeForOffsets(textNodes, r.start, r.end);
        if (!domRange) continue;
        const rects = Array.from(domRange.getClientRects());
        const containerRect = sizer.getBoundingClientRect();
        const scale = sizer.offsetWidth && containerRect.width ? sizer.offsetWidth / containerRect.width : 1;
        r.rects = rects.map((rc) => ({
          left: (rc.left - containerRect.left) * scale,
          top: (rc.top - containerRect.top) * scale,
          width: rc.width * scale,
          height: rc.height * scale,
        }));
      }
      for (const r of ranges) {
        if (!r.rects) continue;
        for (const rc of r.rects) {
          overlays.push({ rect: rc, active: !!r.active });
        }
      }
    }
    if (!overlays.length) return;
    const box = createDiv("search-highlight");
    box.style.position = "absolute";
    box.style.left = "0";
    box.style.top = "0";
    box.style.width = "100%";
    box.style.height = "100%";
    box.style.pointerEvents = "none";
    for (const o of overlays) {
      const d = createDiv(o.active ? "is-active" : "");
      d.style.position = "absolute";
      d.style.left = o.rect.left + "px";
      d.style.top = o.rect.top + "px";
      d.style.width = o.rect.width + "px";
      d.style.height = o.rect.height + "px";
      box.appendChild(d);
    }
    sizer.appendChild(box);
  };

  /** Maps a [start,end) offset range over text nodes to a DOM Range. */
  proto.rangeForOffsets = function (textNodes, start, end) {
    const doc = textNodes[0] && textNodes[0].ownerDocument;
    if (!doc) return null;
    const range = doc.createRange();
    let pos = 0, started = false;
    for (const node of textNodes) {
      const len = node.textContent.length;
      const nStart = pos, nEnd = pos + len;
      if (!started && end > nStart && start < nEnd) {
        range.setStart(node, Math.max(0, start - nStart));
        started = true;
      }
      if (started && start < nEnd && end > nStart) {
        range.setEnd(node, Math.min(len, end - nStart));
        return range;
      }
      pos = nEnd;
    }
    if (started) {
      const last = textNodes[textNodes.length - 1];
      if (last) { range.setEnd(last, last.textContent.length); return range; }
    }
    return null;
  };

  // ------------------------------------------------------------- scrolling --

  proto.onScroll = function () {
    const scrollTop = this.previewEl.scrollTop;
    if (this.scrolling) {
      this.scrolling = false;
      this.updateVirtualDisplay(scrollTop);
      return;
    }
    const flags = host.renderFlags;
    const margin = Math.max((this.previewEl.clientHeight || 0) * (flags.renderExtra === undefined ? 1 : flags.renderExtra),
      flags.renderExtraMinPx === undefined ? 500 : flags.renderExtraMinPx);
    if (Math.abs(this.lastScroll - scrollTop) > margin / 2) {
      this.updateVirtualDisplay(scrollTop);
    }
    this.owner.onScroll();
  };

  /** Fractional source line at the current scrollTop, or null when unmeasured. */
  proto.getScroll = function () {
    const sections = this.sections;
    if (!sections.length) return null;
    const scrollTop = this.previewEl.scrollTop + (this.topSpace || 0);
    let accLines = 0;
    let accHeight = 0;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (!s.shown) { accLines += s.lines; continue; } // folded: 0 height, lines still count
      if (!s.computed) return null; // unmeasured -> unknown
      if (accHeight + s.height >= scrollTop || i === sections.length - 1) {
        const within = Math.max(0, scrollTop - accHeight);
        const pxPerLine = s.lines > 0 ? s.height / s.lines : 0;
        let result = accLines + (pxPerLine > 0 ? within / pxPerLine : 0);
        const items = s.el.querySelectorAll("li[data-line]");
        if (items.length && s.height > 0) {
          const sRect = s.el.getBoundingClientRect();
          const anchors = [{ line: 0, top: 0 }];
          for (const li of items) {
            const line = parseInt(li.getAttribute("data-line"), 10);
            const top = li.getBoundingClientRect().top - sRect.top;
            if (!isNaN(line) && top >= 0) anchors.push({ line, top });
          }
          anchors.push({ line: Math.max(1, s.lines), top: s.height });
          anchors.sort((a, b) => a.top - b.top);
          let prev = anchors[0], next = null;
          for (const a of anchors) {
            if (a.top <= within) prev = a;
            else { next = a; break; }
          }
          if (next && next.top > prev.top) {
            const frac = Math.min(1, Math.max(0, (within - prev.top) / (next.top - prev.top)));
            result = accLines + prev.line + frac * (next.line - prev.line);
          }
        }
        return result;
      }
      accLines += s.lines;
      accHeight += s.height;
    }
    return accLines;
  };

  /** Scrolls so that source `line` is at the viewport top; returns success. */
  proto.applyScroll = function (line, options) {
    if (typeof line !== "number" || isNaN(line)) return false;
    if (this.text !== this.lastText) return false;
    const sections = this.sections;
    if (!sections.length) return true;
    options = options || {};
    const target = Math.floor(line);
    let accLines = 0, accHeight = 0;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (!s.shown) {
        if (target < accLines + s.lines) {
          this.showSection(s);
          if (!s.shown) { accLines += s.lines; continue; }
          const self = this;
          this.onRendered(() => {
            (env().activeWindow || window).setTimeout(() => self.applyScroll(line, options), 0);
          });
          return true;
        }
        accLines += s.lines; continue;
      }
      if (target < accLines + s.lines || i === sections.length - 1) {
        if (!s.computed) {
          if (options.highlight) this.showSection(s);
          else return false;
          if (!s.computed) return false;
        }
        const within = Math.max(0, Math.min(s.lines - 1, line - accLines));
        const pxPerLine = s.lines > 0 ? s.height / s.lines : 0;
        let scrollTop = accHeight + within * pxPerLine - (this.topSpace || 0);
        if (options.center) scrollTop -= (this.previewEl.clientHeight - pxPerLine) / 2;
        // refine with li[data-line]
        const items = s.el.querySelectorAll("li[data-line]");
        if (items.length) {
          const sRect = s.el.getBoundingClientRect();
          const want = sRect.top - this.previewEl.getBoundingClientRect().top + scrollTop + (this.topSpace || 0) - accHeight;
          for (const li of items) {
            const l = parseInt(li.getAttribute("data-line"), 10);
            if (isNaN(l)) continue;
            if (l <= within) {
              const r = li.getBoundingClientRect();
              const liTop = r.top - sRect.top;
              const itemLine = accLines + l;
              if (line >= itemLine) {
                const frac = pxPerLine > 0 ? (line - itemLine) : 0;
                scrollTop = accHeight + liTop + frac * pxPerLine - (this.topSpace || 0);
                if (options.center) scrollTop -= (this.previewEl.clientHeight - pxPerLine) / 2;
              }
            }
          }
        }
        this.scrolling = true;
        this.previewEl.scrollTop = Math.max(0, scrollTop);
        this.updateVirtualDisplay(this.previewEl.scrollTop);
        if (options.highlight) {
          const target2 = within === 0 ? s.el : (s.el.querySelector("li[data-line]") || s.el);
          this.highlightEl(target2);
        }
        return true;
      }
      accLines += s.lines;
      accHeight += s.height;
    }
    return true;
  };

  proto.applyScrollDelayed = function (line, options, callback) {
    const self = this;
    const tryApply = () => {
      if (self.applyScroll(line, options)) {
        if (callback) callback();
        return true;
      }
      return false;
    };
    if (!tryApply()) {
      this.onRendered(() => {
        if (!tryApply() && callback) callback();
      });
    }
  };

  proto.applyScrollSection = function (section) {
    const top = this.getSectionTop(section);
    if (top < 0) return false;
    this.scrolling = true;
    this.previewEl.scrollTop = Math.max(0, top - (this.topSpace || 0));
    this.updateVirtualDisplay(this.previewEl.scrollTop);
    return true;
  };

  /** Sum of heights of sections before `section`; -1 when unmeasured. */
  proto.getSectionTop = function (section) {
    const sections = this.sections;
    const idx = sections.indexOf(section);
    if (idx === -1) return -1;
    let measured = 0, count = 0, sum = 0;
    for (let i = 0; i < idx; i++) {
      const s = sections[i];
      if (!s.shown) continue;
      if (s.computed) { sum += s.height; measured++; }
      count++;
    }
    if (measured < count) {
      // estimate unmeasured with the average of measured so far
      const avg = measured ? sum / measured : 0;
      let total = 0;
      for (let i = 0; i < idx; i++) {
        const s = sections[i];
        if (!s.shown) continue;
        total += s.computed ? s.height : avg;
      }
      return total;
    }
    return sum;
  };

  // ------------------------------------------------------------ folds ------

  proto.updateShownSections = function () {
    const sections = this.sections;
    let threshold = 7;
    for (const s of sections) {
      if (s.level > threshold) {
        s.shown = false;
      } else {
        s.shown = true;
        if (s.headingCollapsed) threshold = s.level;
      }
    }
  };

  proto.foldAllHeadings = function () {
    for (const s of this.sections) {
      if (s.level < 7 && !s.headingCollapsed) s.setCollapsed(true);
    }
    this.updateShownSections();
    this.queueRender();
    this.owner.onFoldChange();
  };

  proto.unfoldAllHeadings = function () {
    for (const s of this.sections) {
      if (s.headingCollapsed) s.setCollapsed(false);
      s.shown = true;
    }
    this.updateShownSections();
    this.queueRender();
    this.owner.onFoldChange();
  };

  proto.foldAllLists = function () {
    for (const s of this.sections) {
      const items = s.el.querySelectorAll("li");
      for (const li of items) {
        if (li.querySelector(":scope > ul, :scope > ol")) this.setListCollapse(li, true);
      }
    }
    this.queueRender();
    this.owner.onFoldChange();
  };

  proto.unfoldAllLists = function () {
    for (const s of this.sections) {
      const items = s.el.querySelectorAll("li");
      for (const li of items) {
        if (li.classList.contains("is-collapsed")) this.setListCollapse(li, false);
      }
    }
    this.queueRender();
    this.owner.onFoldChange();
  };

  proto.setListCollapse = function (li, collapsed) {
    li.classList.toggle("is-collapsed", collapsed);
    const icon = li.querySelector(":scope > .list-collapse-indicator");
    if (icon) icon.classList.toggle("is-collapsed", collapsed);
    // reset the owning section's compute
    const sections = this.sections;
    for (const s of sections) {
      if (s.el.contains(li)) { s.resetCompute(); break; }
    }
  };

  proto.showSection = function (section) {
    // uncollapse ancestor headings
    const sections = this.sections;
    const idx = sections.indexOf(section);
    if (idx === -1) return;
    for (let i = 0; i < idx; i++) {
      const s = sections[i];
      if (s.headingCollapsed && s.level < section.level) s.setCollapsed(false);
    }
    section.shown = true;
    this.updateShownSections();
    this.queueRender();
  };

  // -------------------------------------------------------- fold persistence

  proto.getFoldInfo = function () {
    const text = this.text || "";
    const lines = text === "" ? 0 : text.split("\n").length;
    const folds = [];
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (s === this.header || s === this.footer) continue;
      if (s.headingCollapsed && s.start) {
        const next = sections[i + 1];
        const to = next && next.start ? next.start.line - 1 : (s.end ? s.end.line - 1 : s.start.line);
        folds.push({ from: s.start.line, to: Math.max(s.start.line, to) });
      }
    }
    // metadata fold: collapsed .metadata-container in first section
    if (this.frontmatter && sections.length) {
      const first = sections[0];
      const meta = first.el && first.el.querySelector(".metadata-container.is-collapsed, .metadata-container.collapsed");
      if (meta) {
        const lastLine = first.end ? first.end.line - 1 : first.start.line;
        folds.push({ from: first.start ? first.start.line : 0, to: Math.max(0, lastLine) });
      }
    }
    // collapsed list items
    for (const s of sections) {
      if (s === this.header || s === this.footer || !s.start) continue;
      const items = s.el.querySelectorAll("li.is-collapsed");
      for (const li of items) {
        const dl = li.getAttribute("data-line");
        if (dl === null) continue;
        const line = parseInt(dl, 10);
        if (isNaN(line)) continue;
        const next = li.nextElementSibling;
        let to;
        if (next && next.hasClass && next.hasClass("task-list-item, li")) {
          const ndl = next.getAttribute("data-line");
          to = ndl !== null && !isNaN(parseInt(ndl, 10)) ? parseInt(ndl, 10) - 1 : (s.end ? s.end.line - 1 : line);
        } else {
          to = s.end ? s.end.line - 1 : line;
        }
        folds.push({ from: s.start.line + line, to: Math.max(s.start.line + line, to) });
      }
    }
    return { folds, lines };
  };

  proto.applyFoldInfo = function (info) {
    const self = this;
    const apply = () => {
      const lines = self.text === "" ? 0 : self.text.split("\n").length;
      if (info && info.lines !== undefined && info.lines !== lines) return;
      const wanted = new Set();
      if (info && info.folds) for (const f of info.folds) wanted.add(f.from);
      let changed = false;
      for (const s of self.sections) {
        if (s === self.header || s === self.footer) continue;
        if (!s.start) continue;
        const shouldCollapse = s.level < 7 && wanted.has(s.start.line);
        if (shouldCollapse !== !!s.headingCollapsed) {
          s.setCollapsed(shouldCollapse);
          changed = true;
        }
        // list items
        const items = s.el.querySelectorAll("li");
        for (const li of items) {
          const dl = li.getAttribute("data-line");
          if (dl === null) continue;
          const line = parseInt(dl, 10);
          if (isNaN(line)) continue;
          const hasNested = !!li.querySelector(":scope > ul, :scope > ol");
          if (!hasNested) continue;
          const want = wanted.has(s.start.line + line);
          if (want !== li.classList.contains("is-collapsed")) {
            self.setListCollapse(li, want);
            changed = true;
          }
        }
      }
      self.updateShownSections();
      if (changed) self.queueRender();
    };
    if (!this.renderQueued && this.lastText === this.text) apply();
    else this.onRendered(apply);
  };

  // --------------------------------------------------------- section lookup

  proto.getSectionContainer = function (el) {
    const sections = this.sections;
    for (let i = sections.length - 1; i >= 0; i--) {
      const s = sections[i];
      if (s.el === el || s.el.contains(el)) return s;
    }
    return null;
  };

  proto.getSectionInfo = function (el) {
    const section = this.getSectionContainer(el);
    if (!section || !section.start) return null;
    return { text: this.text, lineStart: section.start.line, lineEnd: section.end ? section.end.line : section.start.line };
  };

  proto.belongsToMe = function (el) {
    return MarkdownPreviewRenderer.belongsToMe(el, this.previewEl, (node) => {
      const s = this.getSectionContainer(node);
      return !!s;
    });
  };

  proto.getInternalLinkHref = function (el) {
    if (el && el.hasAttribute && el.hasAttribute("data-href")) return el.getAttribute("data-href");
    if (el && el.hasAttribute && el.hasAttribute("href")) return el.getAttribute("href");
    return null;
  };

  proto.selectRange = function (range) {
    const section = range.section || this.getSectionContainer(range.el);
    if (!section) return;
    if (!section.computed || !section.shown) this.showSection(section);
    this.applyScrollSection(section);
    this.highlightEl(section.el);
    const target = section.el.querySelector("[data-line]") || section.el;
    if (target.scrollIntoView) target.scrollIntoView({ block: "center" });
  };

  proto.highlightEl = function (el) {
    if (!el || !el.classList) return;
    el.classList.add("is-flashing");
    setTimeout(() => el.classList.remove("is-flashing"), 3000);
  };

  // --------------------------------------------------------- header/footer --

  proto.addHeader = function () {
    if (this.header) return this.header;
    const section = new (Section())(null);
    section.el.addClass("mod-header", "mod-ui");
    this.header = section;
    this.sections.unshift(section);
    return section;
  };

  proto.removeHeader = function () {
    if (!this.header) return;
    const at = this.sections.indexOf(this.header);
    if (at !== -1) this.sections.splice(at, 1);
    this.header.el.detach();
    this.header = null;
  };

  proto.addFooter = function () {
    if (this.footer) return this.footer;
    const section = new (Section())(null);
    section.el.addClass("mod-footer", "mod-ui");
    this.footer = section;
    this.sections.push(section);
    return section;
  };

  proto.removeFooter = function () {
    if (!this.footer) return;
    const at = this.sections.indexOf(this.footer);
    if (at !== -1) this.sections.splice(at, 1);
    this.footer.el.detach();
    this.footer = null;
  };

  proto.updateHeader = function () { if (this.header) { this.header.resetCompute(); this.queueRender(); } };
  proto.updateFooter = function () { if (this.footer) { this.footer.resetCompute(); this.queueRender(); } };

  // --------------------------------------------------------- delegated DOM --

  proto.onSectionClick = function (event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (event.defaultPrevented && event.type === "click") return;
    if (!this.belongsToMe(target)) return;

    // footnote links
    const footnote = target.closest("a.footnote-link");
    if (footnote && event.button === 0) {
      const href = footnote.getAttribute("href") || "";
      if (!href.startsWith("#")) return;
      event.preventDefault();
      const id = href.slice(1);
      const sections = this.sections;
      for (const s of sections) {
        const found = s.el && s.el.querySelector('[data-footnote-id="' + id + '"]');
        if (found) {
          this.showSection(s);
          this.applyScrollSection(s);
          this.highlightEl(found);
          this.updateVirtualDisplay(this.previewEl.scrollTop);
          found.scrollIntoView({ block: "center" });
          this.owner.onScroll();
          return;
        }
      }
      return;
    }

    // task checkboxes
    const checkbox = target.closest(".task-list-item-checkbox");
    if (checkbox) {
      const dl = checkbox.getAttribute("data-line");
      const line = parseInt(dl, 10);
      if (isNaN(line) || line < 0) return;
      const section = this.getSectionContainer(checkbox);
      if (section && section.start) {
        this.owner.onCheckboxClick(event, checkbox, section.start.line + line);
      }
      return;
    }

    // heading collapse indicator
    const headingIcon = target.closest(".heading-collapse-indicator");
    if (headingIcon && event.button === 0) {
      const heading = headingIcon.parentElement;
      if (!(heading instanceof HTMLHeadingElement)) return;
      const section = this.getSectionContainer(heading);
      if (!section) return;
      event.preventDefault();
      section.setCollapsed(!section.headingCollapsed);
      this.updateShownSections();
      const sel = (env().activeWindow || window).getSelection();
      if (sel) sel.removeAllRanges();
      this.queueRender();
      this.owner.onFoldChange();
      return;
    }

    // list collapse indicator
    const listIcon = target.closest("li > .list-collapse-indicator");
    if (listIcon && event.button === 0) {
      const li = listIcon.parentElement;
      if (!(li instanceof HTMLLIElement)) return;
      event.preventDefault();
      this.setListCollapse(li, !li.classList.contains("is-collapsed"));
      this.queueRender();
      this.owner.onFoldChange();
    }
  };

  // ------------------------------------------------------------- statics ---

  MarkdownPreviewRenderer.registerDomEvents = function (container, handlers, detachedCheck) {
    const clickHandler = (event) => {
      const button = event.button;
      if (button !== 0 && button !== 1) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      MarkdownPreviewRenderer.domEvent(container, event, target, handlers, detachedCheck);
    };
    container.addEventListener("click", clickHandler);
    container.addEventListener("auxclick", clickHandler);
    container.addEventListener("dragstart", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a.internal-link");
      if (link && MarkdownPreviewRenderer.belongsToMe(link, container, detachedCheck)) {
        const href = link.getAttribute("data-href") || link.getAttribute("href");
        handlers.onInternalLinkDrag && handlers.onInternalLinkDrag(event, link, href, undefined);
      }
    });
    container.addEventListener("contextmenu", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const internal = target.closest("a.internal-link");
      if (internal && MarkdownPreviewRenderer.belongsToMe(internal, container, detachedCheck)) {
        const href = internal.getAttribute("data-href") || internal.getAttribute("href");
        handlers.onInternalLinkRightClick && handlers.onInternalLinkRightClick(event, internal, href);
        return;
      }
      const external = target.closest("a.external-link");
      if (external && MarkdownPreviewRenderer.belongsToMe(external, container, detachedCheck)) {
        const href = external.getAttribute("href");
        handlers.onExternalLinkRightClick && handlers.onExternalLinkRightClick(event, external, href);
        return;
      }
      // mobile image viewer
      const media = target.closest("img,video");
      if (media && !event.defaultPrevented && MarkdownPreviewRenderer.belongsToMe(media, container, detachedCheck) && host.Platform.isMobile) {
        event.preventDefault();
        if (media.tagName === "IMG") MarkdownPreviewRenderer.showMobileImageViewer(media);
      }
    });
    container.addEventListener("mouseover", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a.internal-link");
      if (link && MarkdownPreviewRenderer.belongsToMe(link, container, detachedCheck)) {
        const href = link.getAttribute("data-href") || link.getAttribute("href");
        handlers.onInternalLinkMouseover && handlers.onInternalLinkMouseover(event, link, href);
        return;
      }
      const foot = target.closest("a.footnote-link");
      if (foot) {
        const ref = foot.getAttribute("data-footref");
        if (ref && MarkdownPreviewRenderer.belongsToMe(foot, container, detachedCheck)) {
          handlers.onInternalLinkMouseover && handlers.onInternalLinkMouseover(event, foot, "#[^" + ref + "]");
        }
      }
    });
  };

  MarkdownPreviewRenderer.domEvent = function (container, event, target, handlers, detachedCheck) {
    const internal = target.closest("a.internal-link");
    if (internal && MarkdownPreviewRenderer.belongsToMe(internal, container, detachedCheck)) {
      const href = internal.getAttribute("data-href") || internal.getAttribute("href");
      const text = internal.textContent.trim();
      handlers.onInternalLinkClick && handlers.onInternalLinkClick(event, internal, href, text);
      return;
    }
    const external = target.closest("a.external-link");
    if (external && MarkdownPreviewRenderer.belongsToMe(external, container, detachedCheck)) {
      const href = external.getAttribute("href");
      handlers.onExternalLinkClick && handlers.onExternalLinkClick(event, external, href);
      return;
    }
    const tag = target.closest("a.tag");
    if (tag && event.button === 0) {
      event.preventDefault();
      handlers.onTagClick && handlers.onTagClick(event, tag, tag.textContent);
      return;
    }
    const media = target.closest("img,video");
    if (media && event.type === "click" && !event.defaultPrevented &&
        MarkdownPreviewRenderer.belongsToMe(media, container, detachedCheck) && host.Platform.isMobile) {
      event.preventDefault();
      if (media.tagName === "IMG") MarkdownPreviewRenderer.showMobileImageViewer(media);
    }
  };

  MarkdownPreviewRenderer.belongsToMe = function (el, container, detachedCheck) {
    let node = el;
    while (node) {
      if (node === container) return true;
      if (node.classList && (node.classList.contains("markdown-preview-view") || node.classList.contains("bases-view"))) return false;
      const parent = node.parentNode || node.host;
      if (!parent) {
        return detachedCheck ? !!detachedCheck(node) : false;
      }
      node = parent;
    }
    return false;
  };

  /** Full-screen pinch-zoom image viewer (mobile only). */
  MarkdownPreviewRenderer.showMobileImageViewer = function (img) {
    const doc = img.ownerDocument;
    const win = doc.defaultView || window;
    const viewer = doc.body.createDiv("mobile-image-viewer");
    viewer.style.position = "fixed";
    viewer.style.inset = "0";
    viewer.style.zIndex = "100";
    viewer.style.background = "rgba(0,0,0,0.9)";
    viewer.style.display = "flex";
    viewer.style.alignItems = "center";
    viewer.style.justifyContent = "center";
    viewer.style.overflow = "hidden";
    const clone = img.cloneNode();
    clone.style.maxWidth = "100%";
    clone.style.maxHeight = "100%";
    clone.style.touchAction = "none";
    clone.style.transformOrigin = "center center";
    viewer.appendChild(clone);

    const naturalW = img.naturalWidth || clone.width || 1;
    const naturalH = img.naturalHeight || clone.height || 1;
    const maxZoom = Math.max(1, Math.min(10, 2 * Math.max(naturalW / Math.max(1, clone.offsetWidth || naturalW), naturalH / Math.max(1, clone.offsetHeight || naturalH))) || 5);
    let scale = 1, tx = 0, ty = 0, vx = 0, vy = 0, lastT = 0;
    let raf = 0;
    const touches = new Map();
    let pinchDist = 0;

    const apply = () => {
      clone.style.transform = "scale(" + scale + ") translate(" + tx + "px," + ty + "px)";
    };
    const clampPan = () => {
      const w = clone.offsetWidth * scale, h = clone.offsetHeight * scale;
      const vw = viewer.clientWidth, vh = viewer.clientHeight;
      const maxX = Math.max(0, (w - vw) / 2), maxY = Math.max(0, (h - vh) / 2);
      tx = Math.min(maxX, Math.max(-maxX, tx));
      ty = Math.min(maxY, Math.max(-maxY, ty));
    };
    const animate = (t) => {
      if (!lastT) lastT = t;
      const dt = Math.min(50, t - lastT);
      lastT = t;
      if (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1) {
        tx += vx * dt; ty += vy * dt;
        vx *= Math.pow(0.997, dt); vy *= Math.pow(0.997, dt);
        clampPan(); apply();
        raf = win.requestAnimationFrame(animate);
      } else { vx = vy = 0; }
    };

    const onDown = (e) => {
      for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (touches.size === 2) {
        const [a, b] = Array.from(touches.values());
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        cancelAnimationFrame(raf); vx = vy = 0;
      } else if (touches.size === 1) {
        lastT = e.timeStamp; vx = vy = 0;
        const p = Array.from(touches.values())[0];
        clone._panStart = { x: p.x - tx, y: p.y - ty, moved: false };
      }
    };
    const onMove = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (touches.has(t.identifier)) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      if (touches.size === 2) {
        const [a, b] = Array.from(touches.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) {
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const rect = clone.getBoundingClientRect();
          const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
          const next = Math.min(maxZoom, Math.max(1, scale * (d / pinchDist)));
          const ratio = next / scale;
          tx = (mid.x - cx) * (1 - ratio) / ratio + tx * ratio;
          ty = (mid.y - cy) * (1 - ratio) / ratio + ty * ratio;
          scale = next;
          clampPan(); apply();
        }
        pinchDist = d;
        return;
      }
      if (touches.size === 1 && clone._panStart) {
        const p = Array.from(touches.values())[0];
        const dx = p.x - clone._panStart.x - tx, dy = p.y - clone._panStart.y - ty;
        if (Math.abs(dx) + Math.abs(dy) > 2) clone._panStart.moved = true;
        if (scale > 1 || clone._panStart.moved) {
          const now = e.timeStamp, dt = Math.max(1, now - lastT);
          vx = (p.x - (clone._panLastX || p.x)) / dt * 16;
          vy = (p.y - (clone._panLastY || p.y)) / dt * 16;
          clone._panLastX = p.x; clone._panLastY = p.y; lastT = now;
          tx = p.x - clone._panStart.x; ty = p.y - clone._panStart.y;
          clampPan(); apply();
          cancelAnimationFrame(raf); raf = win.requestAnimationFrame(animate);
        }
      }
    };
    const onUp = (e) => {
      for (const t of e.changedTouches) touches.delete(t.identifier);
      if (touches.size < 2) pinchDist = 0;
      if (touches.size === 0) {
        clone._panStart = null; clone._panLastX = clone._panLastY = undefined;
        if (Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1) { vx = vy = 0; }
      }
    };
    viewer.addEventListener("touchstart", onDown, { passive: true });
    viewer.addEventListener("touchmove", onMove, { passive: false });
    viewer.addEventListener("touchend", onUp, { passive: true });
    viewer.addEventListener("touchcancel", onUp, { passive: true });
    const close = () => viewer.remove();
    viewer.addEventListener("click", close);
    doc.body.appendChild(viewer);
    apply();
  };

  // ------------------------------------------------- post-processor registry

  MarkdownPreviewRenderer.postProcessors = [];
  MarkdownPreviewRenderer.recyclers = [];
  MarkdownPreviewRenderer.codeBlockPostProcessors = {};

  MarkdownPreviewRenderer.registerPostProcessor = function (fn, sortOrder) {
    fn.sortOrder = sortOrder || 0;
    MarkdownPreviewRenderer.postProcessors.push(fn);
    MarkdownPreviewRenderer.postProcessors.sort((a, b) => a.sortOrder - b.sortOrder);
  };
  MarkdownPreviewRenderer.unregisterPostProcessor = function (fn) {
    const list = MarkdownPreviewRenderer.postProcessors;
    const at = list.indexOf(fn);
    if (at !== -1) list.splice(at, 1);
  };
  MarkdownPreviewRenderer.registerRecycler = function (fn) {
    if (MarkdownPreviewRenderer.recyclers.indexOf(fn) === -1) MarkdownPreviewRenderer.recyclers.push(fn);
  };
  MarkdownPreviewRenderer.unregisterRecycler = function (fn) {
    const list = MarkdownPreviewRenderer.recyclers;
    const at = list.indexOf(fn);
    if (at !== -1) list.splice(at, 1);
  };
  MarkdownPreviewRenderer.registerCodeBlockPostProcessor = function (language, fn) {
    if (MarkdownPreviewRenderer.codeBlockPostProcessors[language]) {
      throw new Error("Code block post processor already registered for language: " + language);
    }
    MarkdownPreviewRenderer.codeBlockPostProcessors[language] = fn;
  };
  MarkdownPreviewRenderer.unregisterCodeBlockPostProcessor = function (language) {
    delete MarkdownPreviewRenderer.codeBlockPostProcessors[language];
  };

  /**
   * Builds a post-processor that replaces `code.language-<lang>` blocks with
   * `div.block-language-<lang>` and calls `factory(codeText, blockEl, api)`.
   */
  MarkdownPreviewRenderer.createCodeBlockPostProcessor = function (language, factory) {
    return function (containerEl, ctx) {
      const codes = containerEl.findAll("code.language-" + language);
      const promises = [];
      for (const code of codes) {
        const parent = code.parentElement;
        if (!parent) continue;
        const blockEl = createDiv("block-language-" + language);
        parent.replaceWith(blockEl);
        blockEl.appendChild(parent);
        const codeText = host.codeText(code);
        const sectionApi = {
          docId: ctx.docId,
          sourcePath: ctx.sourcePath,
          frontmatter: ctx.frontmatter || {},
          promises,
          addChild: ctx.addChild,
          containerEl: ctx.containerEl,
          el: blockEl,
          displayMode: ctx.displayMode,
          getSectionInfo: (el) => ctx.getSectionInfo ? ctx.getSectionInfo(el) : null,
          replace: ctx.replace,
          replaceCode(newText) {
            const info = ctx.getSectionInfo ? ctx.getSectionInfo(blockEl) : null;
            if (info) {
              const bounds = ng10LineBoundsOf(info.text, info.lineStart);
              // rewrite through the section text
              const sectionText = info.text.slice(bounds.start, bounds.end);
              const replaced = sectionText.replace(codeText, newText);
              if (replaced !== sectionText && ctx.replace) {
                ctx.replace(info.text.slice(0, bounds.start) + replaced + info.text.slice(bounds.end), true);
              }
            }
            host.codeTexts.set(code, newText);
          },
        };
        try {
          const result = factory(codeText, blockEl, sectionApi);
          if (result && result.then) promises.push(result);
        } catch (e) {
          console.error(e);
        }
      }
      return promises.length ? Promise.all(promises) : null;
    };
  };

  return MarkdownPreviewRenderer;
}

function ng10LineBoundsOf(text, line) {
  const lines = text.split("\n");
  let start = 0;
  for (let i = 0; i < line && i < lines.length; i++) start += lines[i].length + 1;
  let end = start;
  for (let i = line; i < lines.length; i++) end += lines[i].length + (i < lines.length - 1 ? 1 : 0);
  return { start, end };
}
