// ng06 QueryController + BasesEvents: drives embeds and the `bases` FileView —
// owns the toolbar DOM, query lifecycle, search queue, results and view switching.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { normalizePath, parsePropertyId } from "./text.js";
import { ng06Div, ng06T, ng06Idle, ng06FileExplorerStrings } from "./n-g06-shared.js";
import { s09ValueTypeName } from "./s09-query.js";
import { prepareQuery } from "./search.js";

const ng06Strings = () => env().gm.plugins.bases;

/** `k$` — Events subclass used as `controller.events`. */
export function ng06BasesEvents(host) {
  function BasesEvents() { return host.Events.apply(this, arguments) || this; }
  inherit(BasesEvents, host.Events);
  return BasesEvents;
}

/** `C$` — QueryController. */
export function ng06BasesController(host) {
  function QueryController(app, plugin, containerEl, currentFile) {
    const self = host.Component.call(this) || this;
    self.app = app;
    self.plugin = plugin;
    self.containerEl = containerEl;
    self.currentFile = currentFile || null;
    self.query = null;
    self.viewName = "";
    self.view = null;
    self.viewConfig = null;
    self.events = new (host.s13BasesEvents || ng06BasesEvents(host))();
    self.results = new Map();
    self.errors = new Set();
    self.searchQuery = null;
    self.ctx = null;
    self.queryState = "";
    self.viewEstates = {};
    self.relevantProperties = new Set();
    self.mockContext = null;
    self.queue = null;
    self.initialScan = false;
    self._notifyQueued = false;
    self._stateKey = "";

    // DOM: header > toolbar children, error line, view container
    const headerEl = self.viewHeaderEl = containerEl.createDiv("bases-header");
    const toolbarEl = headerEl.createDiv("bases-toolbar");
    self.viewMenu = new (env().s$)(app, self, toolbarEl);
    self.resultsMenu = new (env().$X)(app, self, toolbarEl);
    self.sortMenu = new (env().e$)(app, self, toolbarEl);
    self.filterMenu = new (env().AX)(app, self, toolbarEl);
    self.propertyMenu = new (env().GX)(app, self, toolbarEl);
    const searchRow = toolbarEl.createDiv({ cls: "bases-search-row bases-toolbar-search" });
    self.searchMenu = new (env().ZX)(app, self, searchRow, headerEl);
    const newItemWrap = toolbarEl.createDiv({ cls: "bases-toolbar-item bases-toolbar-new-item-menu" });
    self.newItemMenu = new (env().jX)(app, self, newItemWrap);
    self.errorEl = containerEl.createDiv({ cls: "bases-error", attr: { style: "display:none" } });
    self.viewContainerEl = containerEl.createDiv("bases-view");
    self.viewContainerEl.tabIndex = 0;

    // view container dataset + grouped class + keydown view cycling
    self._syncViewAttrs();
    self.registerDomEvent(self.viewContainerEl, "keydown", (e) => self.onViewKeydown(e));

    // drag & drop of files into the view (new-item defaults)
    self.registerDomEvent(self.viewContainerEl, "dragover", (e) => self.onDragOver(e));
    self.registerDomEvent(self.viewContainerEl, "drop", (e) => self.onDrop(e));
    self.registerDomEvent(self.viewContainerEl, "dragleave", (e) => {
      if (e.target === self.viewContainerEl) self.viewContainerEl.removeClass("is-being-dragged-over");
    });

    // mock eval context + search queue + resize observer
    self.mockContext = new (env().DY)(app, self.query ? self.query.formulas : {});
    self.queue = { stop() {}, reset() {}, cancelled: false };
    if (typeof ResizeObserver === "function") {
      self._ro = new ResizeObserver(() => self.onResize());
      self._ro.observe(self.viewContainerEl);
    }
    return self;
  }
  inherit(QueryController, host.Component);

  QueryController.prototype.onload = function () {
    const self = this;
    this.registerEvent(this.app.metadataTypeManager.on("changed", () => self.requestNotifyView(50)));
    this.registerEvent(this.app.vault.on("config-changed", (key) => {
      if (key === "userIgnoreFilters") self.update();
    }));
    if (this.view) this.view.addChild ? null : null;
  };
  QueryController.prototype.onunload = function () {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
  };

  // -- DOM helpers ---------------------------------------------------------

  QueryController.prototype._syncViewAttrs = function () {
    const el = this.viewContainerEl;
    if (!el) return;
    if (this.viewConfig) {
      el.setAttr("data-view-type", this.viewConfig.type || "");
      el.setAttr("data-view-name", this.viewConfig.name || "");
      el.toggleClass("is-grouped", !!(this.viewConfig.groupBy && this.viewConfig.groupBy.property));
    } else {
      el.removeAttribute("data-view-type");
      el.removeAttribute("data-view-name");
      el.removeClass("is-grouped");
    }
  };

  QueryController.prototype.onViewKeydown = function (e) {
    if (!env().Bg.isModEvent(e) || !e.shiftKey || (e.key !== "PageUp" && e.key !== "PageDown")) return;
    const names = this.getQueryViewNames();
    if (names.length < 2) return;
    const idx = names.indexOf(this.viewName);
    const next = names[(idx + (e.key === "PageDown" ? 1 : names.length - 1)) % names.length];
    e.preventDefault();
    this.selectView(next);
    this.view && this.view.focus && this.view.focus();
  };

  // -- query lifecycle -----------------------------------------------------

  QueryController.prototype.setQuery = function (query) {
    this.clearError();
    if (query instanceof Error) {
      this.displayError("query", query);
      this.query = null;
      this.queryData = null;
    } else {
      this.query = query;
      this.queryData = query;
    }
    this.update();
  };

  QueryController.prototype.setQueryAndView = function (query, viewName) {
    const changed = viewName !== this.viewName;
    this.viewName = viewName || "";
    this.setQuery(query);
    if (changed) this.events.trigger("view-changed");
  };

  QueryController.prototype.clear = function () {
    this.query = null;
    this.viewName = "";
    this.queue && this.queue.stop && this.queue.stop();
    if (this.view && this.view.unload) this.view.unload();
    this.view = null;
    this.viewConfig = null;
    this.viewContainerEl.empty();
    this.results.clear();
    this.events.trigger("view-changed");
  };

  QueryController.prototype.update = function () {
    const query = this.query;
    if (!query) return;
    let config = null;
    try { config = query.getViewConfig(this.viewName); } catch (e) { config = null; }
    if (!config) {
      const first = query.views && query.views[0];
      if (!this.viewName && first) {
        this.viewName = first.name;
        config = first;
      } else {
        this.displayError("view", new Error(ng06Strings().msgErrorViewNotFound()));
        this.viewMenu && this.viewMenu.setView && this.viewMenu.setView("", "lucide-file-question");
        this._syncViewAttrs();
        this.events.trigger("view-changed");
        return;
      }
    }
    this.clearError();
    const typeChanged = this.viewConfig && this.viewConfig.type !== config.type;
    this.viewConfig = config;
    if (!this.viewName) this.viewName = config.name;
    const reg = this.plugin && this.plugin.getRegistration ? this.plugin.getRegistration(config.type) : null;
    if (!reg || typeof reg.factory !== "function") {
      this.displayError("view", new Error(ng06Strings().msgErrorUnknownViewType()));
      this._syncViewAttrs();
      return;
    }
    if (!this.view || typeChanged) {
      if (this.view && this.view.unload) this.view.unload();
      this.viewContainerEl.empty();
      this.view = reg.factory(this, this.viewContainerEl);
      if (this.view && typeof this.view.register === "function") this.addChild(this.view);
      this.events.trigger("view-changed");
    }
    this.view.config = config;
    this._syncViewAttrs();
    // state key: filters+formulas decide full re-query vs notify only
    let key = "";
    try { key = JSON.stringify({ filter: config.filters ? config.filters.serialize() : null, formulas: Object.keys(query.formulas || {}).map((k) => k + "=" + query.formulas[k].toString()) }); } catch (e) {}
    if (key !== this._stateKey) {
      this._stateKey = key;
      this.runQuery(this.buildBasesContext(config.filters));
    } else {
      this.requestNotifyView();
    }
  };

  QueryController.prototype.buildBasesContext = function (extraFilters) {
    const query = this.query;
    const filters = host.s13FilterOps.and(query.filters, extraFilters);
    return new (host.s13QuerySession)(this.app, filters, query.formulas || {}, this.currentFile);
  };

  // -- query execution ----------------------------------------------------

  QueryController.prototype.runQuery = async function (ctx) {
    const self = this;
    this.ctx = ctx;
    this.initialScan = true;
    this.queue && this.queue.reset && this.queue.reset();
    const previous = new Map(this.results);
    this.results.clear();
    const files = this.app.vault.getMarkdownFiles();
    let localRerun = false;
    const processFile = async (file) => {
      if (self.app.metadataCache.isUserIgnored(file.path)) return;
      let item = null;
      try {
        item = new (host.s13QueryItem)(ctx, file);
        const filter = ctx.filter;
        if (!filter || filter.test(ctx)) {
          // NOTE: per-file context evaluates formulas against this file
          self.addResult(file, item);
        }
      } catch (e) {
        self.errors.add(ng06Strings().msgErrorFilterFailedToEvaluate({ message: e && e.message ? e.message : String(e) }));
      }
      if (ctx.local && ctx.local.file === file) localRerun = true;
    };
    // batched async scan (~10 files / 50ms)
    const batch = 10;
    for (let i = 0; i < files.length; i += batch) {
      for (let j = i; j < Math.min(i + batch, files.length); j++) await processFile(files[j]);
      await new Promise((res) => setTimeout(res, 50));
      if (i === 0 || i % 100 === 0) self.requestNotifyView();
    }
    if (localRerun) {
      const regen = ctx.regenerateLocal ? ctx.regenerateLocal() : ctx;
      // one local re-run for this-file-relative formulas
      try {
        const file = ctx.local && ctx.local.file;
        if (file instanceof env().$T) {
          const item = new (host.s13QueryItem)(regen, file);
          if (!regen.filter || regen.filter.test(regen)) self.addResult(file, item);
        }
      } catch (e) {}
    }
    self.stopLoader();
  };

  QueryController.prototype.startLoader = function () {};
  QueryController.prototype.stopLoader = function () {
    this.initialScan = false;
    this.requestNotifyView();
  };

  QueryController.prototype.addResult = function (file, item) {
    if (!this.results.has(file)) this.results.set(file, item);
    else this.results.set(file, item);
  };
  QueryController.prototype.removeResult = function (file) {
    const had = this.results.delete(file);
    if (had) this.requestNotifyView();
  };

  // -- notify / render -----------------------------------------------------

  QueryController.prototype.requestNotifyView = debounceCall(function () {
    const self = this;
    if (self._notifyQueued) return;
    self._notifyQueued = true;
    setTimeout(() => { self._notifyQueued = false; self.notifyView(); }, 50);
  }, 50);

  QueryController.prototype.notifyView = function () {
    if (this.initialScan) return;
    // flush accumulated errors as Notices
    if (this.errors.size) {
      for (const msg of this.errors) new host.Notice(msg);
      this.errors.clear();
    }
    const query = this.query, config = this.viewConfig;
    if (!query || !config || !this.view) return;
    if (this.viewMenu && this.viewMenu.updateQuery) this.viewMenu.updateQuery(query, config);
    // order results by path
    const ordered = Array.from(this.results.values()).sort((a, b) => host.s13ComparePaths(a.file.path, b.file.path));
    const filtered = this.applySearchQuery(ordered, ordered.map((e) => e.file.path));
    this.evaluateRelevantProperties(this.results.values());
    const properties = this.getProperties();
    this.view.allProperties = properties;
    const QueryData = host.s25QueryData || env().u$;
    this.view.data = new QueryData(this.app, config, properties, filtered);
    if (this.view.onDataUpdated) this.view.onDataUpdated();
    // rebuild mock context over current formulas
    try { this.mockContext = new (env().DY)(this.app, query.formulas || {}); } catch (e) {}
    if (this.filterMenu && this.filterMenu.updateQuery) this.filterMenu.updateQuery(query, config);
    if (this.propertyMenu && this.propertyMenu.updateQuery) this.propertyMenu.updateQuery(query, config);
    if (this.newItemMenu && this.newItemMenu.updateQuery) this.newItemMenu.updateQuery(this, query, config, filtered);
    if (this.sortMenu && this.sortMenu.updateQuery) this.sortMenu.updateQuery(this, query, config);
    if (this.resultsMenu && this.resultsMenu.updateQuery) this.resultsMenu.updateQuery(this.view, config, filtered.length);
    if (this.searchMenu && this.searchMenu.updateCount) this.searchMenu.updateCount(filtered);
  };

  QueryController.prototype.applySearchQuery = function (results, order) {
    const query = (this.searchQuery || "").trim();
    if (!query) return results;
    const tokens = prepareQuery(query).tokens;
    const props = this.view ? (this.view.data ? this.view.data.properties : []) : [];
    return results.filter((entry) => {
      const hay = [];
      for (const prop of props) {
        let v;
        try { v = entry.getValue(prop); } catch (e) { continue; }
        if (v == null || v === env().bW.value) continue;
        try {
          if (v instanceof env().SW && v.length() === 0) continue;
          if (v instanceof env().CW && v.data === "") continue;
        } catch (e) {}
        hay.push(String(v));
      }
      const text = hay.join(" ").toLowerCase();
      return tokens.every((t) => text.includes(String(t).toLowerCase()));
    });
  };

  QueryController.prototype.getProperties = function () {
    const out = [];
    const seen = new Set();
    const push = (id) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };
    // file properties first
    for (const p of env().oY.FILE_PROPERTIES || []) push(p);
    // note properties sorted by locale compare
    const notes = [];
    try {
      const all = this.app.metadataTypeManager.getAllProperties();
      for (const name of Object.keys(all)) notes.push("note." + name);
    } catch (e) {}
    notes.sort((a, b) => host.s13ComparePaths(a, b));
    for (const n of notes) push(n);
    // formula properties
    const formulas = this.query && this.query.formulas ? Object.keys(this.query.formulas) : [];
    formulas.sort();
    for (const f of formulas) push("formula." + f);
    return out;
  };

  QueryController.prototype.evaluateRelevantProperties = function (results) {
    const set = new Set();
    for (const entry of results) {
      try { for (const k of entry.getPropertyKeys()) set.add(String(k).toLowerCase()); } catch (e) {}
    }
    this.relevantProperties = set;
  };

  QueryController.prototype.getWidgetForIdent = function (ident) {
    if (ident === "file.file" || ident === "file.path") return "file";
    if (ident === "file.tags") return "tags";
    if (ident === "file.ctime" || ident === "file.mtime") return "date";
    if (ident === "file.folder") return "folder";
    try {
      const value = this.mockContext.evaluateIdent(ident);
      if (value instanceof env().LW) return value.time ? "datetime" : "date";
      return s09ValueTypeName(value && value.type);
    } catch (e) { return "text"; }
  };

  QueryController.prototype.getEditorLanguageSupport = function () {
    try { return new (env().JK)(this.mockContext); } catch (e) { return []; }
  };

  // -- view selection -----------------------------------------------------

  QueryController.prototype.getQueryViewNames = function () {
    return this.query && this.query.views ? this.query.views.map((v) => v.name) : [];
  };
  QueryController.prototype.getViewConfig = function () { return this.viewConfig; };
  QueryController.prototype.getCurrentFile = function () { return this.currentFile; };
  QueryController.prototype.getSearchQuery = function () { return this.searchQuery || null; };
  QueryController.prototype.updateSearchQuery = function (query) {
    this.searchQuery = query || null;
    this.notifyView();
  };

  QueryController.prototype.selectView = function (name) {
    if (name === this.viewName) return;
    if (this.view) {
      try { this.viewEstates[this.viewName] = this.view.getEphemeralState ? this.view.getEphemeralState() : {}; } catch (e) {}
      if (typeof this.removeChild === "function") this.removeChild(this.view); else if (this.view.unload) this.view.unload();
      this.view = null;
    }
    this._clearErrorKind("view");
    this.viewName = name;
    this.update();
    const state = this.viewEstates[name];
    if (state && this.view && this.view.setEphemeralState) this.view.setEphemeralState(state);
    this.events.trigger("view-changed");
  };

  QueryController.prototype.setEphemeralState = function (state) {
    if (state && state.views && typeof state.views === "object") {
      for (const k of Object.keys(state.views)) this.viewEstates[k] = state.views[k];
    }
  };
  QueryController.prototype.getEphemeralState = function () {
    const views = Object.assign({}, this.viewEstates);
    if (this.view && this.view.getEphemeralState) {
      try { views[this.viewName] = this.view.getEphemeralState(); } catch (e) {}
    }
    return { views };
  };

  QueryController.prototype.getActiveBasesViewOfType = function (type) {
    return this.view instanceof type ? this.view : null;
  };

  QueryController.prototype.promptForAddView = function () {
    if (this.viewMenu && this.viewMenu.promptForAddView) this.viewMenu.promptForAddView();
  };

  QueryController.prototype.updateCurrentFile = function (file) {
    if (!this.query) return;
    if (file === this.currentFile) return;
    this.currentFile = file || null;
    this.ctx = this.buildBasesContext(this.viewConfig ? this.viewConfig.filters : null);
    this.runQuery(this.ctx);
  };

  QueryController.prototype.onResize = function () {
    if (this.view && this.view.onResize) this.view.onResize();
  };
  QueryController.prototype.onConfigChanged = function (key) { this.update(); };

  // -- errors -------------------------------------------------------------

  QueryController.prototype.displayError = function (kind, error) {
    this.viewContainerEl.hide();
    if (kind === "query") this.viewHeaderEl.hide();
    if (this.filterMenu && this.filterMenu.setEnabled) this.filterMenu.setEnabled(false);
    if (this.propertyMenu && this.propertyMenu.setEnabled) this.propertyMenu.setEnabled(false);
    const el = this.errorEl;
    el.empty();
    if (kind === "query") el.createEl("p", { text: ng06Strings().msgErrorUnableToParse() });
    el.createEl("p", { text: error && error.message ? error.message : String(error) });
    el.show();
  };
  QueryController.prototype.clearError = function () {
    this._clearErrorKind(null);
  };
  QueryController.prototype._clearErrorKind = function () {
    this.viewContainerEl.show();
    this.viewHeaderEl.show();
    if (this.filterMenu && this.filterMenu.setEnabled) this.filterMenu.setEnabled(true);
    if (this.propertyMenu && this.propertyMenu.setEnabled) this.propertyMenu.setEnabled(true);
    this.errorEl.empty();
    this.errorEl.hide();
  };

  // -- drag & drop ---------------------------------------------------------

  QueryController.prototype.onDragOver = function (e) {
    const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    if (!types.some((t) => ["Files", "text/plain", "text/uri-list"].includes(t))) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    this.viewContainerEl.addClass("is-being-dragged-over");
  };

  QueryController.prototype.onDrop = async function (e) {
    this.viewContainerEl.removeClass("is-being-dragged-over");
    const dt = e.dataTransfer;
    if (!dt) return;
    e.preventDefault();
    const files = [];
    try {
      if (dt.files && dt.files.length) {
        for (const f of dt.files) {
          const imported = await this.app.fileManager.importAttachments ? null : null;
        }
      }
      const text = dt.getData("text/plain") || "";
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        const file = this.app.metadataCache.getFirstLinkpathDest(t, this.currentFile ? this.currentFile.path : "")
          || this.app.vault.getAbstractFileByPath(normalizePath(t));
        if (file instanceof env().$T) files.push(file);
      }
    } catch (err) {}
    for (const file of files) await this.applyNewItemDefaults(file);
  };

  /** Applies the view's new-item defaults (frontmatter keys + folder move) to a dropped file. */
  QueryController.prototype.applyNewItemDefaults = async function (file) {
    try {
      let ctx = null;
      try { ctx = this.ctx || this.buildBasesContext(this.viewConfig ? this.viewConfig.filters : null); } catch (e) {}
      let itemCtx = null;
      try { itemCtx = ctx ? new (host.s13QueryItem)(ctx, file) : null; } catch (e) {}
      const res = host.s13NewItemContext(this.app, this.query, this.viewConfig, itemCtx) || {};
      const fm = res.frontmatter || {};
      const folder = res.folder || "";
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        for (const k of Object.keys(fm)) if (fm[k] !== undefined) frontmatter[k] = fm[k];
        return frontmatter;
      });
      if (folder && file.parent && normalizePath(file.parent.path + "/") !== normalizePath(folder.endsWith("/") ? folder : folder + "/")) {
        const target = normalizePath(folder.replace(/\/$/, "") + "/" + file.name);
        try { await this.app.fileManager.renameFile(file, target); } catch (e) {}
      }
    } catch (e) {}
  };

  return QueryController;
}
