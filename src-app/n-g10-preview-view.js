// ng10 — clean-room MarkdownPreviewView (was `fq`): the reading-mode half of a
// markdown leaf. Own architecture: a config-key table drives the previewEl
// classes; gestures (keys, context menu, double-tap) are small handlers.
//
// Host access is lazy; own top-level names are prefixed ng10.

import { env } from "./env.js";
import { ng10Link } from "./n-g10-preview-renderer.js";

export function defineMarkdownPreviewView(host) {
  const Base = () => host.MarkdownRenderer;

  function MarkdownPreviewView(view) {
    MarkdownPreviewView.ng10ensure();
    if (this && !(typeof window !== "undefined" && this === window) && Object.getPrototypeOf(this) !== MarkdownPreviewView.prototype) Object.setPrototypeOf(this, MarkdownPreviewView.prototype);
    const app = view.app;
    const el = createDiv("markdown-reading-view");
    el.style.width = "100%";
    el.style.height = "100%";
    view.contentEl.appendChild(el);
    const self = Base().call(this, app, el, view.file && view.file.path, true) || this;
    self.view = view;
    self.type = "preview";
    self.search = null;
    self.renderer.addBottomPadding = true;

    self.foldChangeDebounced = host.debounce(() => view.onMarkdownFold(), 500);
    self.onFoldChange = () => self.foldChangeDebounced();

    self.applyConfigClasses();
    self.onResize();
    self.renderer.addHeader();
    self.renderer.addFooter();

    el.addEventListener("keydown", (event) => self.onKeydown(event));
    el.addEventListener("contextmenu", (event) => self.onContextMenu(event));
    self.setupDoubleTap(el);
    return self;
  }
  ng10Link(MarkdownPreviewView, Base);

  const proto = MarkdownPreviewView.prototype;

  // ------------------------------------------------------------- config -----

  /** config key -> [className | null, extra(view, enabled)] */
  proto.configTable = function () {
    return {
      readableLineLength: ["is-readable-line-width"],
      foldHeading: ["allow-fold-headings", (v, on) => { if (!on) v.renderer.unfoldAllHeadings(); }],
      foldIndent: ["allow-fold-lists", (v, on) => { if (!on) v.renderer.unfoldAllLists(); }],
      showIndentGuide: ["show-indentation-guide"],
      rightToLeft: ["rtl"],
      propertiesInDocument: ["show-properties", null, (v) => v.app.vault.getConfig("propertiesInDocument") !== "hidden"],
      strictLineBreaks: [null, (v, on) => {
        host.markdownOptions.globalOptions.breaks = !on;
        v.rerender(true);
      }],
    };
  };

  proto.applyConfigClasses = function () {
    const previewEl = this.renderer.previewEl;
    const table = this.configTable();
    for (const key of Object.keys(table)) {
      const [cls, extra, valueFn] = table[key];
      const value = valueFn ? valueFn(this) : this.app.vault.getConfig(key);
      const on = !!value;
      if (cls) previewEl.toggleClass(cls, on);
      if (extra) extra(this, on);
    }
  };

  proto.onConfigChanged = function (key) {
    const table = this.configTable();
    if (!table[key]) return;
    const [cls, extra, valueFn] = table[key];
    const value = valueFn ? valueFn(this) : this.app.vault.getConfig(key);
    const on = !!value;
    if (cls) this.renderer.previewEl.toggleClass(cls, on);
    if (extra) extra(this, on);
  };

  proto.updateOptions = function () {};

  // ------------------------------------------------------------- gestures --

  proto.onKeydown = function (event) {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.target !== this.renderer.previewEl) return;
    if (!host.Keymap.isModifier(event, "Mod")) return;
    const key = event.key.toLowerCase();
    if (key === "a") {
      event.preventDefault();
      new host.Notice(host.t.interface.menu.msgMarkdownCopyInstructions({ key: host.keyNames.Mod }));
    } else if (key === "c") {
      const sel = (env().activeWindow || window).getSelection();
      if (!sel || sel.isCollapsed || sel.toString() === "") {
        event.preventDefault();
        copyText(this.get());
        const notice = new host.Notice(host.t.interface.copied({ context: "generic" }));
        if (notice.containerEl) notice.containerEl.addClass("mod-success");
      }
    }
  };

  proto.onContextMenu = function (event) {
    if (event.defaultPrevented || !event.isTrusted) return;
    if (event instanceof PointerEvent && event.pointerType === "touch") return;
    const sel = (env().activeWindow || window).getSelection();
    if (host.Platform.isMobile && sel && !sel.isCollapsed) return;
    if (this.renderer.sizerEl.contains(event.target)) return;
    const menu = host.Menu.forEvent(event).addSections(["view", ""]);
    this.app.workspace.trigger("markdown-viewport-menu", menu, this.view, "preview", "gutter");
  };

  /** Two quick taps (<300 ms, <30 px travel) toggle source/preview. */
  proto.setupDoubleTap = function (el) {
    const win = env().activeWindow || window;
    let lastTap = null; // {t, x, y}
    let pending = null;
    el.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" || event.button !== 0) return;
      pending = { t: event.timeStamp, x: event.clientX, y: event.clientY, moved: false };
      const onMove = (ev) => {
        if (pending && Math.hypot(ev.clientX - pending.x, ev.clientY - pending.y) >= 30) pending.moved = true;
      };
      const onUp = (ev) => {
        win.removeEventListener("pointermove", onMove, true);
        win.removeEventListener("pointerup", onUp, true);
        win.removeEventListener("pointercancel", onUp, true);
        if (!pending || pending.moved || ev.defaultPrevented) { pending = null; return; }
        const sel = win.getSelection();
        if (sel && !sel.isCollapsed) { pending = null; return; }
        const now = event.timeStamp;
        if (lastTap && now - lastTap.t < 300 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 30) {
          // double tap confirmed; the click handler may still cancel it
          lastTap = null;
          pending = null;
          const toggle = () => {
            const sel2 = win.getSelection();
            if (!(sel2 && !sel2.isCollapsed)) this.view.toggleMode();
          };
          win.setTimeout(toggle, 10);
        } else {
          lastTap = { t: now, x: ev.clientX, y: ev.clientY };
        }
        pending = null;
      };
      win.addEventListener("pointermove", onMove, true);
      win.addEventListener("pointerup", onUp, true);
      win.addEventListener("pointercancel", onUp, true);
    });
  };

  // ------------------------------------------------------------- lifecycle --

  proto.show = function () {
    const view = this.view;
    const header = this.renderer.header;
    const footer = this.renderer.footer;
    if (header && view.inlineTitleEl) header.el.appendChild(view.inlineTitleEl);
    if (header && view.metadataEditor && view.metadataEditor.containerEl) header.el.appendChild(view.metadataEditor.containerEl);
    if (footer && view.backlinksEl) footer.el.appendChild(view.backlinksEl);
    this.containerEl.show();
    if (this.search) view.replaceScope(this.search.scope);
  };

  proto.hide = function () {
    this.containerEl.hide();
    if (this.search) this.view.replaceScope(null);
  };

  proto.get = function () { return this.renderer.text; };

  proto.set = function (data, clear) {
    if (clear) this.renderer.clear();
    this.renderer.set(data);
  };

  proto.clear = function () { this.renderer.clear(); };

  proto.beforeUnload = function () {};

  proto.rerender = function (full) { this.renderer.rerender(full); };

  proto.edit = function (text) {
    this.renderer.set(text);
    this.view.onInternalDataChange();
    this.view.save();
  };

  // ------------------------------------------------------- ephemeral state --

  proto.getEphemeralState = function (state) { return state; };

  proto.setEphemeralState = function (state) {
    const view = this.view;
    const renderer = this.renderer;
    if (state.focusMetadata) {
      view.metadataEditor.focusPropertyAtIndex(0);
      return;
    }
    if (state.focus) {
      renderer.previewEl.tabIndex = -1;
      renderer.previewEl.focus({ preventScroll: true });
      return;
    }
    if (state.hasOwnProperty("scroll")) {
      renderer.applyScrollDelayed(state.scroll);
      return;
    }
    if (typeof state.line === "number" && state.line >= 0) {
      renderer.applyScrollDelayed(state.line, { highlight: true }, () => view.syncScroll());
      return;
    }
    const matches = state.propertyMatches;
    if (matches && matches.length && view.canShowProperties()) {
      host.propertiesPlugin(this.app).then((properties) => {
        if (properties && properties.containerEl) {
          host.focusWhenShown(properties.containerEl, () => properties.focusProperty(matches[0].key));
        }
      });
      return;
    }
    const match = state.match;
    if (match && match.content && match.matches && match.matches.length) {
      const content = match.content;
      const at = match.matches[0][0];
      let line = 0;
      for (let i = 0; i < at && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
      renderer.applyScrollDelayed(line, { center: true, highlight: true }, () => view.syncScroll());
    }
  };

  // -------------------------------------------------------------- scrolling

  proto.getScroll = function () { return this.renderer.getScroll(); };

  proto.applyScroll = function (scroll) { return this.renderer.applyScroll(scroll); };

  proto.onResize = function () {
    this.renderer.onResize();
    if (this.view.scroll !== null) this.renderer.applyScrollDelayed(this.view.scroll);
  };

  proto.onScroll = function () {
    const renderer = this.renderer;
    if (Date.now() - renderer.lastRender > 100) {
      this.view.syncScroll();
      const navbar = this.app.mobileNavbar;
      if (navbar) navbar.onScroll(this.containerEl, this.getScroll());
    }
  };

  // ------------------------------------------------------------ search -----

  proto.showSearch = function () {
    const view = this.view;
    if (!this.search) {
      const self = this;
      this.search = new host.DocumentSearch(view.scope, this.renderer, this.containerEl, () => {
        self.search = null;
        view.replaceScope(null);
      });
    }
    view.replaceScope(this.search.scope);
    this.search.searchInputEl.focus();
    this.search.searchInputEl.select();
  };

  proto.onRenderComplete = function () {
    if (this.search && this.search.highlightRanges === null) this.search.updateQuery();
  };

  // ------------------------------------------------------------ folds ------

  proto.getFoldInfo = function () { return this.renderer.getFoldInfo(); };
  proto.applyFoldInfo = function (info) { this.renderer.applyFoldInfo(info); };

  proto.foldAll = function () {
    if (this.app.vault.getConfig("foldHeading")) this.renderer.foldAllHeadings();
    if (this.app.vault.getConfig("foldIndent")) this.renderer.foldAllLists();
  };

  proto.unfoldAll = function () {
    if (this.app.vault.getConfig("foldHeading")) this.renderer.unfoldAllHeadings();
    if (this.app.vault.getConfig("foldIndent")) this.renderer.unfoldAllLists();
  };

  proto.getSelection = function () {
    return (env().activeWindow || window).getSelection().toString();
  };

  proto.onload = function () {
    this.registerEvent(this.app.workspace.on("post-processor-change", () => this.rerender(true)));
    this.registerEvent(this.app.vault.on("config-changed", (key) => this.onConfigChanged(key)));
  };

  // ------------------------------------------------------------- statics ---

  /** Shared post-processing for every rendered markdown root (also used by embeds). */
  MarkdownPreviewView.postProcess = function (app, ctx) {
    const sourcePath = ctx.sourcePath;
    const promises = ctx.promises;
    const el = ctx.el;
    const displayMode = ctx.displayMode;
    const queries = el.findAll("code.language-query");
    for (let i = 0; i < queries.length; i++) {
      const code = queries[i];
      const query = host.queryBlockText(code).trim();
      const parent = code.parentElement;
      ctx.addChild(host.queryEmbed(app, query, parent, sourcePath));
    }
    const postProcessors = host.MarkdownPreviewRenderer.postProcessors;
    for (let i = 0; i < postProcessors.length; i++) {
      const result = postProcessors[i](el, ctx);
      if (result && result.then) promises.push(result);
    }
    const depth = host.embedDepth(ctx.containerEl);
    const embeds = el.findAll(".internal-embed:not(.is-loaded)");
    if (embeds.length > 0) {
      for (let i = 0; i < embeds.length; i++) {
        const embed = embeds[i];
        const linktext = embed.getAttribute("src");
        const child = host.EmbedLoader.load({
          app, linktext, sourcePath, containerEl: embed, displayMode, showInline: true, depth,
        });
        if (child) {
          ctx.addChild(child);
          promises.push(child.loadFile());
        }
      }
    }
    ctx.usesFrontMatter = !!(ctx.frontmatter && typeof ctx.frontmatter === "object" && Object.keys(ctx.frontmatter).length > 0);
    return ctx;
  };

  return MarkdownPreviewView;
}
