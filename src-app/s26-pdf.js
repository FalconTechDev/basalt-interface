// Slice s26 — the PDF viewer glue: base configuration for pdf.js, the find bar,
// the outline (bookmark) tree and its items, and the l10n adapter that feeds the
// viewer's data-l10n-* attributes from the app's string table.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

/** `var TZ` — base configuration handed to `pdfjsViewer.createObsidianPDFViewer`.
 *  Scripting and evaluation stay off; telemetry is disabled; workers/cmaps/fonts
 *  resolve under /lib/pdfjs/. Mobile lowers the canvas pixel budget at runtime. */
export const s26PdfBaseConfig = {
  enableScripting: false,
  externalLinkTarget: 2,
  imageResourcesPath: "/lib/pdfjs/images/",
  maxCanvasPixels: 16777216,
  pdfBugEnabled: false,
  sidebarViewOnLoad: 0,
  viewerCssTheme: 0,
  disablePreferences: false,
  disableHistory: true,
  verbosity: 0,
  defaultZoomValue: "page-width",
  cMapPacked: true,
  cMapUrl: "/lib/pdfjs/cmaps/",
  standardFontDataUrl: "/lib/pdfjs/standard_fonts/",
  wasmUrl: "/lib/pdfjs/wasm/",
  iccUrl: "/lib/pdfjs/iccs/",
  workerSrc: "/lib/pdfjs/pdf.worker.min.js",
  defaultUrl: "",
  disableTelemetry: true,
  isEvalSupported: false,
};

/** `var PZ` — localStorage key of the persisted find-bar settings. */
export const s26PdfSearchSettingsKey = "pdfjs-search-settings";

/** `var OZ` — l10n adapter for the pdf.js viewer: strings come from `gm.pdf`,
 *  `translate` fills every `[data-l10n-id]` descendant of a container. */
export function s26PdfL10n(host) {
  function PdfL10n() {}
  PdfL10n.prototype.getLanguage = function () { return env().sm(); };
  PdfL10n.prototype.get = async function (id, args = null, fallback) {
    return host.t.pdf[id](args) || fallback;
  };
  PdfL10n.prototype.translate = async function (root) {
    const nodes = root ? Array.from(root.querySelectorAll("*[data-l10n-id]")) : [];
    for (const node of nodes) {
      const ds = node.dataset;
      const id = ds.l10nId;
      const args = ds.l10nArgs ? JSON.parse(ds.l10nArgs) : null;
      if (id && args) {
        if (args.attr) node.setAttr(args.attr, host.t.pdf[id](args));
        else node.setText(host.t.pdf[id](args));
      }
    }
  };
  PdfL10n.prototype.pause = function () {};
  PdfL10n.prototype.resume = function () {};
  return PdfL10n;
}

/** `var LZ` — the find bar shown inside the PDF viewer toolbar area. */
export function s26PdfFindBar(host) {
  function PdfFindBar(app, containerEl, eventBus, scope) {
    const self = this;
    this.opened = false;
    this.searchSettings = { highlightAll: false, caseSensitive: false, matchDiacritics: false, entireWord: false };
    this.clickOutsideHandler = function (e) {
      const s = self.settingsToggleEl, settings = self.settingsEl;
      if (e.target === settings || e.target === s || settings.contains(e.target)) return;
      self.toggleSettings(false);
      settings.win.removeEventListener("click", self.clickOutsideHandler);
    };
    this.keyHandlers = null;
    this.app = app;
    this.containerEl = containerEl;
    this.eventBus = eventBus;
    this.scope = scope;
    const stored = app.loadLocalStorage(s26PdfSearchSettingsKey);
    if (stored) {
      try { this.searchSettings = JSON.parse(stored); } catch (e) {}
    }
    const settings = this.searchSettings;
    const barEl = this.barEl = containerEl.createDiv("pdf-findbar pdf-toolbar mod-hidden");
    barEl.createDiv("pdf-search-wrapper", (wrap) => {
      wrap.createDiv({ cls: "pdf-findbar-message", attr: { "aria-live": "polite" } }, (msg) => {
        this.findResultsCountEl = msg.createSpan("pdf-toolbar-label pdf-find-results-count");
      });
      new host.SearchComponent(wrap)
        .setPlaceholder(host.t.plugins.search.promptStartSearch())
        .setClass("global-search-input-container")
        .addRightDecorator((dec) => {
          host.setTooltip(dec, host.t.plugins.search.labelMatchCase());
          host.setIcon(dec, "uppercase-lowercase-a");
          dec.addClass("clickable-icon");
          dec.addEventListener("click", () => {
            settings.caseSensitive = !settings.caseSensitive;
            this.saveSettings();
            this.dispatchEvent("casesensitivitychange");
            dec.toggleClass("is-active", settings.caseSensitive);
          });
          dec.toggleClass("is-active", settings.caseSensitive);
        })
        .onChange(env().debounce(() => this.dispatchEvent(""), 250, true))
        .then((comp) => {
          host.setTooltip(comp.clearButtonEl, host.t.plugins.search.tooltipClearSearch());
          this.searchComponent = comp;
          comp.inputEl.addEventListener("keypress", (e) => {
            if (e.isComposing || e.key !== "Enter") return;
            host.Platform.isMobile && host.blurAndClearSelection();
            this.dispatchEvent("again", e.shiftKey);
          });
        });
      this.findPreviousButtonEl = wrap.createEl("button", { cls: "pdf-toolbar-button clickable-icon" }, (btn) => {
        host.setIcon(btn, "lucide-arrow-up");
        host.setTooltip(btn, host.formatHotkey(host.Platform.isMacOS ? host.makeHotkey(["Mod", "Shift"], "G") : host.makeHotkey(["Shift"], "F3")), { placement: "top" });
        btn.addEventListener("click", () => this.dispatchEvent("again", true));
      });
      this.findNextButtonEl = wrap.createEl("button", { cls: "pdf-toolbar-button clickable-icon" }, (btn) => {
        host.setIcon(btn, "lucide-arrow-down");
        host.setTooltip(btn, host.formatHotkey(host.Platform.isMacOS ? host.makeHotkey(["Mod"], "G") : host.makeHotkey([], "F3")), { placement: "top" });
        btn.addEventListener("click", () => this.dispatchEvent("again", false));
      });
      wrap.createDiv("clickable-icon pdf-findbar-settings-btn", (btn) => {
        host.setTooltip(btn, host.t.plugins.search.labelToggleSearchSettings());
        host.setIcon(btn, "lucide-sliders-horizontal");
        this.settingsToggleEl = btn;
        btn.addEventListener("click", () => this.toggleSettings());
      });
      wrap.createDiv("pdf-toolbar-divider");
      wrap.createDiv("clickable-icon", (btn) => {
        host.setTooltip(btn, host.t.interface.emptyState.close());
        host.setIcon(btn, "lucide-x");
        btn.addEventListener("click", () => this.close());
      });
    });
    this.settingsEl = host.createDiv("pdf-findbar-settings", (panel) => {
      new host.Setting(panel).setName(host.t.pdf.actionHighlightAll()).setClass("mod-toggle")
        .addToggle((t) => t.setSmall().setValue(settings.highlightAll)
          .onChange((v) => { settings.highlightAll = v; this.saveSettings(); this.dispatchEvent("highlightallchange"); }));
      new host.Setting(panel).setName(host.t.pdf.actionMatchDiacritics()).setClass("mod-toggle")
        .addToggle((t) => t.setSmall().setValue(settings.matchDiacritics)
          .onChange((v) => { settings.matchDiacritics = v; this.saveSettings(); this.dispatchEvent("diacriticmatchingchange"); }));
      new host.Setting(panel).setName(host.t.pdf.actionWholeWords()).setClass("mod-toggle")
        .addToggle((t) => t.setSmall().setValue(settings.entireWord)
          .onChange((v) => { settings.entireWord = v; this.saveSettings(); this.dispatchEvent("entirewordchange"); }));
    });
  }
  PdfFindBar.prototype.toggleSettings = function (force) {
    const toggle = this.settingsToggleEl, panel = this.settingsEl;
    if (force === false || panel.isShown()) {
      toggle.removeClass("is-active");
      panel.win.removeEventListener("click", this.clickOutsideHandler);
      return;
    }
    const left = toggle.offsetLeft, top = toggle.offsetTop, height = toggle.clientHeight, width = toggle.clientWidth;
    toggle.addClass("is-active");
    panel.setCssProps({ top: top + height + 6 + "px", left: left + width + "px" });
    this.containerEl.append(panel);
    setTimeout(() => { panel.win.addEventListener("click", this.clickOutsideHandler); });
  };
  PdfFindBar.prototype.saveSettings = function () {
    try { this.app.saveLocalStorage(s26PdfSearchSettingsKey, JSON.stringify(this.searchSettings)); }
    catch (e) { console.error("Error saving PDF search settings", e); }
  };
  PdfFindBar.prototype.reset = function () { this.updateUIState(); };
  PdfFindBar.prototype.dispatchEvent = function (type, findPrevious = false) {
    const comp = this.searchComponent, settings = this.searchSettings;
    this.eventBus.dispatch("find", Object.assign({
      source: this, type, query: comp.inputEl.value, findPrevious,
    }, settings));
  };
  PdfFindBar.prototype.updateUIState = function (state, previous, matches) {
    const comp = this.searchComponent, input = comp.inputEl, wrap = comp.containerEl;
    let cls = "";
    wrap.removeClasses(["mod-pending", "mod-not-found"]);
    switch (state) {
      case window.pdfjsViewer.FindState.PENDING: cls = "mod-pending"; break;
      case window.pdfjsViewer.FindState.NOT_FOUND: cls = "mod-not-found"; break;
    }
    if (cls) wrap.addClass(cls);
    input.setAttribute("aria-invalid", String(state === window.pdfjsViewer.FindState.NOT_FOUND));
    this.updateResultsCount(matches);
  };
  PdfFindBar.prototype.updateResultsCount = function (matches) {
    const m = matches || { current: 0, total: 0 };
    const current = m.current, total = m.total;
    let text = "";
    if (total > 0) {
      text = total > 1000 ? host.t.pdf.msgMaxSearchResults({ current, limit: 1000 })
        : total > 1 ? host.t.pdf.msgSearchCount_plural({ current, total })
        : host.t.pdf.msgSearchCount({ current, total });
    }
    this.findResultsCountEl.textContent = text;
  };
  PdfFindBar.prototype.showSearch = function () {
    const input = this.searchComponent.inputEl;
    if (this.opened && input.doc.activeElement !== input) this.searchComponent.autoSelect();
    else this.toggle();
  };
  PdfFindBar.prototype.open = function () {
    const self = this, barEl = this.barEl, eventBus = this.eventBus, scope = this.scope;
    if (!this.opened) {
      this.opened = true;
      barEl.removeClass("mod-hidden");
      barEl.parentElement.addClass("findbarOpen");
      barEl.parentElement.setCssProps({ "--findbar-height": barEl.clientHeight + "px" });
    }
    this.searchComponent.autoSelect();
    eventBus.dispatch("findbaropen", { source: this });
    this.keyHandlers = [
      scope.register([], "F3", () => this.dispatchEvent("again", false)),
      scope.register(["Mod"], "G", () => this.dispatchEvent("again", false)),
      scope.register(["Shift"], "F3", () => this.dispatchEvent("again", true)),
      scope.register(["Mod", "Shift"], "G", () => this.dispatchEvent("again", true)),
    ];
  };
  PdfFindBar.prototype.close = function () {
    const self = this, barEl = this.barEl, eventBus = this.eventBus, scope = this.scope, handlers = this.keyHandlers;
    if (!this.opened) return;
    this.opened = false;
    barEl.addClass("mod-hidden");
    barEl.parentElement.removeClass("findbarOpen");
    barEl.parentElement.setCssProps({ "--findbar-height": "" });
    eventBus.dispatch("findbarclose", { source: this });
    for (const h of handlers) scope.unregister(h);
    this.keyHandlers = null;
    this.toggleSettings(false);
  };
  PdfFindBar.prototype.toggle = function () {
    if (this.opened) { this.close(); return false; }
    this.open();
    return true;
  };
  return PdfFindBar;
}

/** `var FZ` — one row of the PDF outline tree (a heading/link inside the sidebar). */
export function s26PdfOutlineItem(host) {
  const Base = env().JL;
  function PdfOutlineItem(owner, item, parent) {
    const self = Base.call(this) || this;
    self.owner = owner;
    self.item = item;
    self.parent = parent;
    self.innerEl.setText(item.title);
    self.renderLabels();
    self.selfEl.addEventListener("contextmenu", (e) => {
      if (e.defaultPrevented) return;
      self.owner.onItemContextMenu(self, e);
    });
    return self;
  }
  inherit(PdfOutlineItem, Base);
  PdfOutlineItem.prototype.getExplicitDestination = async function () {
    if (this.explicitDest !== undefined) return this.explicitDest;
    const self = this;
    return self.explicitDest = await self.fetchExplicitDestination(self.owner.pdfDocument);
  };
  PdfOutlineItem.prototype.getPageNumber = async function () {
    if (this.pageNumber !== undefined) return this.pageNumber;
    const self = this;
    return self.pageNumber = await self.fetchPageNumber(self.owner.pdfDocument);
  };
  PdfOutlineItem.prototype.fetchExplicitDestination = async function (pdfDocument) {
    const owner = this.owner, item = this.item, dest = item.dest;
    if (typeof dest === "string") {
      try {
        const resolved = await owner.pdfDocument.getDestination(dest);
        if (pdfDocument !== owner.pdfDocument) return null;
        if (resolved && Array.isArray(resolved) && typeof resolved[0]?.num === "number") return resolved;
      } catch (e) { console.error(e); return null; }
      return null;
    }
    if (Array.isArray(dest)) return dest;
    return null;
  };
  PdfOutlineItem.prototype.fetchPageNumber = async function (pdfDocument) {
    const owner = this.owner;
    const dest = await this.getExplicitDestination();
    let pageNumber = null;
    if (!dest) return null;
    const ref = dest[0];
    if (typeof ref === "object" && ref !== null) {
      const cached = pdfDocument.cachedPageNumber(ref);
      if (cached !== null) pageNumber = cached;
      else {
        try {
          pageNumber = await owner.pdfDocument.getPageIndex(ref) + 1;
          if (pdfDocument !== owner.pdfDocument) return null;
        } catch (e) { /* fall through */ }
      }
    } else if (Number.isInteger(ref)) {
      pageNumber = ref + 1;
    } else {
      return null;
    }
    return pageNumber;
  };
  PdfOutlineItem.prototype.getMarkdownLink = async function () {
    const dest = await this.getExplicitDestination();
    const pageNumber = await this.getPageNumber();
    if (!dest || pageNumber === null) return null;
    let link = "page=" + pageNumber;
    if (dest[1] && dest[1].name === "XYZ" && dest.length === 5 && dest[2] !== null) {
      const offset = [dest[2]];
      if (dest[3] !== null) { offset.push(dest[3]); if (dest[4] !== null) offset.push(dest[4]); }
      link += "&offset=" + offset.join(",");
    }
    let title = this.item.title;
    if (title) title = title.replace(/[\s\n\r]+/g, " ");
    const viewer = this.owner.viewer;
    return viewer.getMarkdownLink("#" + link, viewer.file.basename + ", " + title);
  };
  PdfOutlineItem.prototype.renderLabels = async function () {
    const owner = this.owner;
    const pageNumber = await this.getPageNumber();
    if (!owner.outline || pageNumber === null) return;
    const labels = owner.pageLabels ?? [];
    const label = String(labels[pageNumber - 1] ?? pageNumber);
    this.selfEl.createDiv("tree-item-flair-outer").createSpan({ cls: "tree-item-flair", text: label });
  };
  PdfOutlineItem.prototype.onSelfClick = function (e) {
    if (e.defaultPrevented) return;
    this.owner.onItemClick(this);
  };
  PdfOutlineItem.prototype.render = function () {
    Base.prototype.render.call(this);
    const children = this.children;
    this.setCollapsible(children && children.length > 0);
    this.setClickable(true);
    const item = this.item;
    if (item.bold) this.innerEl.style.fontWeight = "bold";
    if (item.italic) this.innerEl.style.fontStyle = "italic";
  };
  PdfOutlineItem.prototype.setActive = function (active) { this.selfEl.toggleClass("mod-active", active); };
  PdfOutlineItem.prototype.reveal = function () {
    let p = this.parent;
    while (p !== null) { p.setCollapsed(false, false); p = p.parent; }
    this.selfEl.scrollIntoView({ block: "start" });
  };
  return PdfOutlineItem;
}

/** `var NZ` — the outline (bookmark) tree section of the PDF sidebar. */
export function s26PdfOutlineTree(host) {
  const Base = env().eI;
  function PdfOutlineTree(viewer, containerEl, eventBus, linkService) {
    const self = Base.call(this, containerEl) || this;
    self.allItems = [];
    self.highlighted = null;
    self.pageLabels = null;
    self.viewer = viewer;
    self.eventBus = eventBus;
    self.linkService = linkService;
    eventBus._on("toggleoutlinetree", self.toggleAllTreeItems.bind(self));
    eventBus._on("currentoutlineitem", self.findCurrentOutlineItem.bind(self));
    eventBus._on("pagechanging", (e) => { self.currentPageNumber = e.pageNumber; });
    eventBus._on("pagesloaded", (e) => {
      const loaded = !!e.pagesCount;
      self.isPagesLoaded = loaded;
      self.currentOutlineItemCapability?.resolve(loaded);
    });
    eventBus._on("sidebarviewchanged", (e) => { self.sidebarView = e.view; });
    self.reset();
    return self;
  }
  inherit(PdfOutlineTree, Base);
  PdfOutlineTree.prototype.reset = function () {
    this.outline = null;
    this.pageNumberToDestHashCapability = null;
    this.currentPageNumber = 1;
    this.isPagesLoaded = null;
    this.highlighted = null;
    this.allItems = [];
    this.currentOutlineItemCapability?.resolve(false);
    this.currentOutlineItemCapability = null;
    this.clear();
  };
  PdfOutlineTree.prototype.recurseTree = function (outline, items, parent = null) {
    if (!outline.length) return [];
    const result = [];
    for (const entry of outline) {
      const item = new (s26PdfOutlineItem(host))(this, entry, parent);
      if (entry.items.length) item.setCollapsed(true, false);
      item.children = this.recurseTree(entry.items, items, item);
      result.push(item);
      items.push(item);
    }
    return result;
  };
  PdfOutlineTree.prototype.setPageNumber = function (pageNumber) { this.currentPageNumber = pageNumber; };
  PdfOutlineTree.prototype.renderTree = function ({ outline, pdfDocument }) {
    if (this.outline && this.outline !== outline) this.reset();
    else this.clear();
    this.outline = outline || null;
    this.pdfDocument = pdfDocument || null;
    if (outline) {
      const items = this.allItems = [];
      const roots = this.recurseTree(outline, items);
      for (const root of roots) this.addRoot(root);
      this.highlighted = null;
      this.render();
      this.dispatchEvent(items.length);
    } else {
      this.dispatchEvent(0);
    }
  };
  PdfOutlineTree.prototype.dispatchEvent = function (outlineCount) {
    const capability = this.currentOutlineItemCapability = window.pdfjsViewer.createPromiseWithResolvers();
    const pdfDocument = this.pdfDocument, loaded = this.isPagesLoaded, eventBus = this.eventBus;
    if (outlineCount === 0 || pdfDocument?.loadingParams.disableAutoFetch) capability.resolve(false);
    else if (loaded !== null) capability.resolve(loaded);
    eventBus.dispatch("outlineloaded", { source: this, outlineCount, currentOutlineItemPromise: capability.promise });
  };
  PdfOutlineTree.prototype.onItemClick = function (item) {
    const highlighted = this.highlighted, linkService = this.linkService, data = item.item;
    const url = data.url, action = data.action, dest = data.dest, ocg = data.setOCGState;
    if (data.dest) {
      if (highlighted !== item) {
        highlighted?.setActive(false);
        item.setActive(true);
        this.highlighted = item;
      }
      if (url) env().activeWindow.open(window.pdfjsViewer.removeNullCharacters(url), "_blank");
      else if (action) linkService.executeNamedAction(action);
      else if (ocg) linkService.executeSetOCGState(ocg);
      else linkService.goToDestination(dest);
    } else if (item.children.length) {
      item.toggleCollapsed(true);
    }
  };
  PdfOutlineTree.prototype.onItemContextMenu = async function (item, event) {
    if (this.viewer.opts?.isEmbed) event.preventDefault();
    const link = await item.getMarkdownLink();
    if (!link) return;
    let title = item.item.title;
    if (title) title = title.replace(/[\s\n\r]+/g, " ");
    const label = title ? host.t.pdf.actionCopySectionLinkTitle({ title: host.truncateText(title, 40) })
      : host.t.pdf.actionCopySectionLink();
    new host.Menu()
      .addItem((menuItem) => menuItem.setTitle(label).setIcon("lucide-copy")
        .onClick(() => { event.view.navigator.clipboard.writeText(link); }))
      .showAtMouseEvent(event);
  };
  PdfOutlineTree.prototype.toggleAllTreeItems = function () {
    const items = this.allItems;
    if (!items?.length) return;
    const collapsed = items[0].collapsed;
    for (const item of items) item.setCollapsed(!collapsed, false);
  };
  PdfOutlineTree.prototype.findCurrentOutlineItem = async function () {
    if (!this.isPagesLoaded) throw new Error("findCurrentOutlineItem: All pages have not been loaded.");
    if (!this.outline || !this.pdfDocument) return;
    const pageToDest = await this.getPageNumberToDestHash(this.pdfDocument);
    if (!pageToDest) return;
    this.highlighted?.setActive(false);
    this.highlighted = null;
    if (this.sidebarView !== 2) return;
    for (let page = this.currentPageNumber; page > 0; page--) {
      const dest = pageToDest.get(page);
      if (!dest) continue;
      for (const item of this.allItems) {
        if (item.item.dest === dest) {
          item.setActive(true);
          item.reveal();
          this.highlighted = item;
          return;
        }
      }
    }
  };
  PdfOutlineTree.prototype.getPageNumberToDestHash = async function (pdfDocument) {
    if (this.pageNumberToDestHashCapability) return this.pageNumberToDestHashCapability.promise;
    const capability = this.pageNumberToDestHashCapability = window.pdfjsViewer.createPromiseWithResolvers();
    const map = new Map();
    let i = 0;
    const items = this.allItems;
    while (i < items.length) {
      const item = items[i];
      const dest = item.item.dest;
      const pageNumber = await item.getPageNumber();
      if (pdfDocument !== this.pdfDocument) return null;
      map.set(pageNumber, dest);
      i++;
    }
    capability.resolve(map.size > 0 ? map : null);
    return capability.promise;
  };
  PdfOutlineTree.prototype.setPageLabels = function (labels) {
    this.pageLabels = labels || null;
    if (this.pdfDocument) this.renderTree({ outline: this.outline, pdfDocument: this.pdfDocument });
  };
  return PdfOutlineTree;
}
