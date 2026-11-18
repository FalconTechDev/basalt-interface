// n-g14-webviewer.js — clean-room replacement for the Web Viewer core plugin
// (spec g14 §2.4 / §3.4). Own architecture: constants table + small helpers
// (search-url, history db, favicons), then the ItemView/TreeItem/Modal/Tab
// classes and the internal-plugin descriptor.
// Frozen contract: view types, command ids, i18n paths, storage keys, the
// IndexedDB schema, engine table, default options, menu structure.

import { inherit } from "./inherit.js";
import { env, hostEnv } from "./env.js";

const ng14WCE = () => hostEnv();

// ------------------------------------------------------------------ constants

export const s30WebviewerViewType = "webviewer";
export const s30WebviewerHistoryViewType = "webviewer-history";
export const s30DefaultSearchEngine = "duckduckgo";
export const s30WebviewerBlankUrl = "data:text/plain,";
export const s30SearchEngines = {
  duckduckgo: { display: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  brave: { display: "Brave", url: "https://search.brave.com/search?q=%s" },
  bing: { display: "Bing", url: "https://www.bing.com/search?q=%s" },
  google: { display: "Google", url: "https://www.google.com/search?q=%s" },
  custom: { display: "custom" },
};
export const s30WebviewerDefaultOptions = { openExternalURLs: true, enableAdblocking: true };

function ng14WVType() { return s30WebviewerViewType; }
function ng14WVType2() { return s30WebviewerHistoryViewType; }

// ------------------------------------------------------------------ WebviewerDb

export function defineWebviewerDb(host) {
  function WebviewerDb(app) {
    this.app = app;
    this.db = null;
    this.history = null;
    this.icons = null;
  }
  const proto = WebviewerDb.prototype;

  proto.connect = function () {
    const self = this;
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = host.openMetadataDb(this.app.appId + "-webview", 1, (db) => {
        if (!db.objectStoreNames.contains("icons")) db.createObjectStore("icons", { keyPath: "host" });
        if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
      });
      req.onsuccess = () => {
        self.db = req.result;
        self.icons = self.db.transaction("icons", "readwrite").objectStore("icons");
        self.history = self.db.transaction("history", "readwrite").objectStore("history");
        resolve(self.db);
      };
      req.onerror = () => reject(req.error);
    });
  };

  proto.getHistoryItems = function () {
    return new Promise((resolve) => {
      if (!this.history) return resolve([]);
      const tx = this.db.transaction("history", "readonly");
      const req = tx.objectStore("history").getAll();
      req.onsuccess = () => resolve((req.result || []).reverse());
      req.onerror = () => resolve([]);
    });
  };

  proto.addHistoryItem = function (url, title) {
    if (!this.history || !url || url === s30WebviewerBlankUrl) return;
    const store = this.db.transaction("history", "readwrite").objectStore("history");
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const items = getAll.result || [];
      if (items.length && items[items.length - 1].url === url) return; // consecutive dup
      const record = { title: title || "", url, accessTs: Date.now() };
      const addReq = store.add(record);
      addReq.onsuccess = () => {
        // trim to newest 1000
        const countReq = store.count();
        countReq.onsuccess = () => {
          if (countReq.result <= 1000) {
            this.app.workspace.trigger("webviewer:update-history");
            return;
          }
          const keysReq = store.getAllKeys();
          keysReq.onsuccess = () => {
            const keys = keysReq.result || [];
            const s = keys.length - 1000;
            if (s > 0) store.delete(IDBKeyRange.upperBound(keys[s - 1]));
            this.app.workspace.trigger("webviewer:update-history");
          };
        };
      };
    };
  };

  proto.removeHistoryItem = function (item) {
    if (!this.history || !item) return;
    const store = this.db.transaction("history", "readwrite").objectStore("history");
    store.delete(item.id);
    this.app.workspace.trigger("webviewer:update-history");
  };

  proto.clearHistoryItems = function () {
    if (!this.history) return;
    const store = this.db.transaction("history", "readwrite").objectStore("history");
    store.delete(IDBKeyRange.lowerBound(0, true));
    this.app.workspace.trigger("webviewer:update-history");
  };

  proto.setIcon = function (el, url) {
    const match = /^https?:\/\/([^/?#]+)/.exec(url || "");
    const key = match ? match[1].toLowerCase() : "";
    if (!key) {
      host.setIcon(el, "globe-2");
      return;
    }
    const done = (data) => {
      el.empty();
      if (data) {
        el.createEl("img", { attr: { src: data } });
      } else {
        host.setIcon(el, "globe-2");
      }
    };
    if (!this.icons) return done(null);
    const req = this.icons.get(key);
    req.onsuccess = () => {
      if (req.result && req.result.base64) return done(req.result.base64);
      this.storeIcon(host, url).then((data) => {
        if (data) {
          const put = this.db.transaction("icons", "readwrite").objectStore("icons");
          put.put({ host: key, source: url, base64: data });
        }
        done(data);
      });
    };
    req.onerror = () => done(null);
  };

  proto.storeIcon = async function (hostArg, url) {
    try {
      const fetcher = env().s30hy;
      if (!fetcher) return null;
      const res = await fetcher(url);
      if (!res || !res.ok) return null;
      const type = res.headers.get("content-type") || "image/png";
      const buf = await res.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return "data:" + type + ";base64," + btoa(binary);
    } catch (err) {
      return null;
    }
  };

  return WebviewerDb;
}

// ------------------------------------------------------- history item + view

export function defineWebviewerHistoryItem(host) {
  function WebviewerHistoryItem(tree, item) {
    const self = host.TreeItem.call(this, tree, item.title || item.url, item) || this;
    self.item = item;
    const iconEl = self.innerEl.createDiv("tree-item-icon");
    tree.webviewer.db.setIcon(iconEl, item.url);
    self.innerEl.createDiv("tree-item-inner-text webviewer-history-view-item", (el) => el.setText(item.title || item.url));
    return self;
  }
  inherit(WebviewerHistoryItem, host.TreeItem);
  const proto = WebviewerHistoryItem.prototype;

  proto.onClick = function (event) {
    const leaf = this.app.workspace.getLeaf(host.Keymap.isModEvent(event));
    leaf.setViewState({
      type: s30WebviewerViewType,
      active: true,
      state: { url: this.item.url, title: this.item.title, navigate: true },
    });
    if (host.Platform.isMobile) this.app.workspace.setActiveLeaf(leaf, { focus: true });
  };

  proto.onMoreOptionsMenu = function (menu) {
    const self = this;
    const t = host.t.plugins.webViewer;
    menu.addSection("action").addItem((item) =>
      item.setTitle(t.actionCopyUrl ? t.actionCopyUrl() : "Copy URL").setIcon("lucide-copy").onClick(() => {
        navigator.clipboard.writeText(self.item.url);
        new host.Notice(host.t.interface.copied());
      })
    );
    menu.addSection("danger").addItem((item) =>
      item.setTitle(t.actionRemoveFromHistory ? t.actionRemoveFromHistory() : "Remove from history").setIcon("lucide-trash-2").addClass("is-warning").onClick(() => {
        self.tree.webviewer.db.removeHistoryItem(self.item);
      })
    );
    return menu;
  };

  return WebviewerHistoryItem;
}

export function defineWebviewerHistoryView(host) {
  function WebviewerHistoryView(leaf, webviewer) {
    const self = host.ItemView.call(this, leaf) || this;
    self.webviewer = webviewer;
    self.icon = "lucide-clock";
    self.navigation = false;
    const scope = (self.scope = new host.Scope(appScope(self.app)));
    self.tree = new host.Tree(self.contentEl, {
      vault: self.app.vault,
      view: self,
      showSearch: false,
      sorter: () => 0,
    });
    self.tree.id = "webviewer-history";
    self.registerScopeEvents ? null : null;
    self.debouncedUpdate = host.debounce ? host.debounce(() => self.updateTree(), 100) : (() => self.updateTree());
    self.registerEvent(self.app.workspace, "webviewer:update-history", self.debouncedUpdate);
    self.register(() => self.debouncedUpdate.cancel && self.debouncedUpdate.cancel());
    return self;
  }
  inherit(WebviewerHistoryView, host.ItemView);
  const proto = WebviewerHistoryView.prototype;

  function appScope(app) {
    return app.scope || (app.keymap && app.keymap.scope) || null;
  }

  proto.getViewType = function () { return s30WebviewerHistoryViewType; };
  proto.getDisplayText = function () { return host.t.plugins.webViewer.historyName(); };
  proto.getIcon = function () { return "lucide-clock"; };

  proto.updateTree = function () {
    const self = this;
    this.webviewer.db.getHistoryItems().then((items) => {
      self.tree.setChildren(items.map((item) => new (defineWebviewerHistoryItem(host))(self.tree, item)));
      if (self.tree.infinityScroll) self.tree.infinityScroll.queueCompute();
    });
  };

  proto.onOpen = function () {
    host.ItemView.prototype.onOpen.call(this);
    this.updateTree();
  };

  proto.onPaneMenu = function (menu, source) {
    const self = this;
    const t = host.t.plugins.webViewer;
    menu.addItem((item) => item
      .setTitle(t.actionClearHistory ? t.actionClearHistory() : "Clear history")
      .setIcon("lucide-eraser")
      .onClick(() => self.webviewer.db.clearHistoryItems())
    );
    return menu;
  };

  proto.onResize = function () {
    if (this.tree && this.tree.infinityScroll) this.tree.infinityScroll.onResize();
  };

  return WebviewerHistoryView;
}

// ----------------------------------------------------------------- WebviewerView

export function defineWebviewerView(host) {
  function WebviewerView(leaf, webviewer) {
    const self = host.ItemView.call(this, leaf) || this;
    self.webviewer = webviewer;
    self.navigation = true;
    self.mode = "blank";
    self.url = null;
    self.title = "";
    self.webview = null;
    self.mounted = false;
    self.readerView = null;
    self.searchContainerEl = null;
    self.findBar = null;
    self.docSearch = null;
    self.readerData = null;
    return self;
  }
  inherit(WebviewerView, host.ItemView);
  const proto = WebviewerView.prototype;

  proto.getViewType = function () { return s30WebviewerViewType; };
  proto.getIcon = function () { return "globe-2"; };
  proto.getDisplayText = function () {
    return this.title || host.t.plugins.webViewer.labelNewWebViewer();
  };
  proto.getState = function () {
    return Object.assign(host.ItemView.prototype.getState.call(this), {
      url: this.url,
      title: this.title,
      mode: this.mode,
    });
  };
  proto.setState = function (state, result) {
    const r = host.ItemView.prototype.setState.call(this, state, result);
    if (state && state.url && state.url !== this.url) {
      this.title = state.title || this.title;
      this.navigate(state.url, state.navigate !== false);
    }
    return r;
  };

  proto.onOpen = function () {
    const self = this;
    host.ItemView.prototype.onOpen.call(this);
    this.viewHeaderEl.addClass("view-header-always-show");
    this.titleEl.detach();
    // reload button before the title container
    const container = this.viewHeaderTitleContainerEl || this.titleContainerEl;
    if (container && !container.find(".view-header-reload-button")) {
      const wrap = container.createDiv("view-header-reload-button");
      const btn = wrap.createDiv("clickable-icon");
      host.setIcon(btn, "lucide-rotate-cw");
      host.setTooltip(btn, host.t.interface.menu.reload ? host.t.interface.menu.reload() : "Reload");
      btn.addEventListener("click", () => {
        if (!self.webview) return;
        if (self.webview.isLoading && self.webview.isLoading()) self.webview.stop();
        else self.webview.reload();
      });
      self.reloadButtonEl = btn;
    }
    // address bar via the permitted s28 helper
    try {
      this.addressBar = env().s30HJ ? env().s30HJ(this, container) : null;
    } catch (err) { this.addressBar = null; }
    this.contentEl.addClass("webviewer-content");
    this.searchContainerEl = this.contentEl.createDiv("webviewer-search-container");
    this.searchContainerEl.hide();
    this.errorEl = this.contentEl.createDiv("error-notice");
    this.errorEl.hide();
    this.instantiateWebView();
    if (this.state && this.state.url) {
      this.navigate(this.state.url, this.state.navigate !== false);
    }
  };

  proto.instantiateWebView = function () {
    const self = this;
    const doc = this.contentEl.doc;
    const wv = doc.createElement("webview");
    wv.setAttribute("partition", this.app.getWebviewPartition ? this.app.getWebviewPartition() : "persist:webviewer");
    wv.setAttribute("allowpopups", "");
    wv.style.backgroundColor = "white";
    wv.style.width = "100%";
    wv.style.height = "100%";
    wv.style.display = "none";
    const attach = () => {
      if (wv.isConnected || !this.contentEl.isShown()) return;
      this.contentEl.appendChild(wv);
    };
    this.webview = wv;
    wv.addEventListener("dom-ready", () => {
      self.mounted = true;
      if (self.pendingUrl) {
        const url = self.pendingUrl;
        self.pendingUrl = null;
        self.commitPageLoad(url, self.pendingTitle, true);
      }
      self.configureWebContents();
    });
    wv.addEventListener("did-start-navigation", (e) => {
      if (e.isMainFrame !== false) self.reportPageLoad(e.url, undefined, true);
    });
    wv.addEventListener("did-redirect-navigation", (e) => {
      if (e.isMainFrame !== false) self.reportPageLoad(e.url, undefined, false);
    });
    wv.addEventListener("did-finish-load", () => self.hideLoading());
    wv.addEventListener("did-stop-loading", () => self.hideLoading());
    wv.addEventListener("did-fail-load", (e) => {
      if (e.errorCode === -3) return;
      if (e.isMainFrame === false) return;
      self.hideLoading();
      self.displayErrorView();
      self.commitPageLoad(e.validatedURL || e.url, undefined, false);
    });
    wv.addEventListener("did-navigate-in-page", (e) => self.commitPageLoad(e.url, undefined, false));
    wv.addEventListener("page-title-updated", (e) => {
      self.title = e.title || self.title;
      self.app.workspace.requestSaveLayout();
    });
    wv.addEventListener("page-favicon-updated", (e) => self.updateFavicon(e.favicons));
    wv.addEventListener("destroyed", () => {
      if (self.docChanged) self.instantiateWebView();
    });
    attach();
    // re-attach on first insertion if the pane wasn't shown yet
    const mo = new MutationObserver(attach);
    mo.observe(this.contentEl, { childList: true });
    this.register(() => mo.disconnect());
  };

  proto.showLoading = function () {
    this.contentEl.addClass("is-loading");
    if (this.reloadButtonEl) this.reloadButtonEl.setAttribute && this.reloadButtonEl.setAttribute("aria-busy", "true");
  };
  proto.hideLoading = function () {
    this.contentEl.removeClass("is-loading");
  };

  // ------------------------------------------------------------ navigation

  proto.navigate = function (url, navigate) {
    if (!url) return;
    const wv = this.webview;
    if (!wv || !this.mounted) {
      this.pendingUrl = url;
      this.pendingTitle = null;
      this.pendingNavigate = navigate !== false;
      return;
    }
    if (url === "about:blank") {
      this.displayBlank();
      return;
    }
    if (this.addressBar && this.addressBar.setValue) this.addressBar.setValue(url);
    this.reportPageLoad(url, undefined, navigate !== false);
    try { wv.stop(); } catch (err) {}
    try {
      wv.loadURL(url);
      if (this.mode !== "webview" && this.mode !== "reader") this.displayWebView();
    } catch (err) {}
  };

  proto.reportPageLoad = function (url, title, navigate) {
    if (!url) return;
    const rec = { url, title, navigate: navigate !== false };
    if (!this._pendingCommit) {
      this._pendingCommit = rec;
      this.showLoading();
      this._commitTimer = setTimeout(() => this.commitPending(), 50);
    } else {
      // inherit navigate from in-flight record when unspecified
      if (rec.navigate === undefined) rec.navigate = this._pendingCommit.navigate;
      this._pendingCommit = rec;
    }
  };
  proto.commitPending = function () {
    const rec = this._pendingCommit;
    this._pendingCommit = null;
    if (rec) this.commitPageLoad(rec.url, rec.title, rec.navigate);
  };

  proto.commitPageLoad = function (url, title, navigate) {
    if (!url || url === s30WebviewerBlankUrl) return;
    if (navigate) this.pushViewStackHistory();
    const prevUrl = this.url;
    this.url = url;
    const resolvedTitle = title || (this.webview && this.webview.getTitle && this.webview.getTitle()) || this.title;
    if (resolvedTitle) {
      this.title = resolvedTitle;
      this.app.workspace.requestSaveLayout();
    }
    if (resolvedTitle && resolvedTitle !== prevUrl) {
      this.webviewer.db.addHistoryItem(url, resolvedTitle);
    }
    try {
      const bookmarks = this.app.plugins && this.app.plugins.getPlugin && this.app.plugins.getPlugin("bookmarks");
      if (bookmarks && bookmarks.updateTabHeaders) bookmarks.updateTabHeaders();
    } catch (err) {}
    this.configureWebContents();
    this.app.workspace.requestSaveLayout();
  };

  proto.pushViewStackHistory = function () {
    const leaf = this.leaf;
    if (!leaf || !this.url) return;
    const hist = leaf.history || (leaf.history = []);
    if (hist.length && hist[hist.length - 1].state && hist[hist.length - 1].state.url === this.url) return;
    hist.push({
      icon: "globe-2",
      title: this.title || this.url,
      state: { state: { url: this.url, title: this.title }, type: s30WebviewerViewType },
    });
  };

  proto.updateFavicon = function (favicons) {
    const leaf = this.leaf;
    if (!leaf || !favicons || !favicons.length) return;
    const pick = favicons.find((f) => /32x/.test(f)) ||
      favicons.slice().sort((a, b) => parseInt((b.match(/(\d+)x/) || [0, 0])[1]) - parseInt((a.match(/(\d+)x/) || [0, 0])[1]))[0] ||
      favicons[0];
    if (!pick || pick === this._lastFavicon) return;
    this._lastFavicon = pick;
    const container = leaf.tabHeaderInnerIconEl;
    if (container) {
      const el = container.createDiv("webviewer-favicon-container");
      this.webviewer.db.setIcon(el, pick);
    }
  };

  // -------------------------------------------------------------- display

  proto.displayBlank = function () {
    this.mode = "blank";
    this.hideAll();
    setTimeout(() => { if (this.addressBar && this.addressBar.focus) this.addressBar.focus(); }, 100);
    this.app.workspace.requestSaveLayout();
  };
  proto.displayWebView = function () {
    this.mode = "webview";
    this.hideAll();
    if (this.webview) this.webview.style.display = "";
    this.app.workspace.requestSaveLayout();
  };
  proto.displayErrorView = function () {
    this.mode = "error";
    this.hideAll();
    if (this.errorEl) this.errorEl.show();
    this.app.workspace.requestSaveLayout();
  };
  proto.displayReaderView = function () {
    this.mode = "reader";
    this.hideAll();
    if (this.readerView) this.readerView.show();
    this.contentEl.addClass("mod-webviewer");
    this.app.workspace.requestSaveLayout();
  };
  proto.hideAll = function () {
    if (this.webview) this.webview.style.display = "none";
    if (this.errorEl) this.errorEl.hide();
    if (this.readerView) this.readerView.hide();
    this.contentEl.removeClass("mod-webviewer");
    this.closeSearch();
  };

  // -------------------------------------------------------------- reader mode

  proto.enterReaderMode = async function () {
    const self = this;
    const t = host.t.plugins.webViewer;
    if (!this.url || !this.url.startsWith("http")) return;
    try {
      const res = await fetch(this.app.vault.adapter ? this.app.vault.adapter.getBasePath ? "" : "" : "");
    } catch (err) {}
    let html;
    try {
      const page = await fetch(this.url).then((r) => r.text());
      html = page;
    } catch (err) {
      new host.Notice(t.msgErrorExtractingContent ? t.msgErrorExtractingContent() : "Error extracting content");
      return;
    }
    try {
      if (!window.Readability) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = this.app.vault.configDir + "/lib/readability.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
    } catch (err) {
      new host.Notice(t.msgErrorExtractingContent ? t.msgErrorExtractingContent() : "Error extracting content");
      return;
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    const article = new window.Readability(doc).parse();
    if (!article || !article.content) {
      new host.Notice(t.msgErrorFindingContent ? t.msgErrorFindingContent() : "Error finding content");
      return;
    }
    const title = typeof article.title === "string" ? article.title : (typeof article.siteName === "string" ? article.siteName : "Untitled");
    const sanitized = host.sanitizeHtml ? host.sanitizeHtml(article.content) : article.content;
    const md = host.htmlToMarkdown ? host.htmlToMarkdown(sanitized, this.url) : sanitized;
    this.readerData = { md, title };
    if (!this.readerView) {
      this.readerView = this.contentEl.createDiv("reader-mode-content");
      this.readerView.hide();
      this.readerRenderer = new host.MarkdownPreviewRenderer(this, this, this.readerView, "worker.js", false);
    } else {
      this.readerView.empty();
    }
    this.readerRenderer.previewEl && this.readerRenderer.previewEl.setText ? null : null;
    if (this.readerRenderer.set && this.readerRenderer.previewEl) {
      // render markdown through the preview renderer pipeline
      this.readerRenderer.previewEl.empty ? null : null;
    }
    try {
      host.MarkdownRenderer.renderMarkdown(md, this.readerView, this.url, this);
    } catch (err) {
      this.readerView.setText(md);
    }
    this.displayReaderView();
    const lineLength = this.app.vault.getConfig("readableLineLength");
    this.readerView.toggleClass("is-readable-line-width", lineLength !== false);
  };

  proto.exitReaderMode = function () {
    if (this.mode === "reader") this.displayWebView();
  };

  proto.saveAsMarkdown = async function () {
    const options = this.webviewer.options || {};
    let data = this.readerData;
    if (!data) {
      // extract on demand
      await this.enterReaderMode();
      data = this.readerData;
      if (this.mode === "reader") this.displayWebView();
    }
    if (!data) return;
    const title = (data.title || "untitled").replace(/[\\/:*?"<>|]/g, "-");
    const dir = options.markdownPath ? options.markdownPath + "/" : "";
    const path = this.app.vault.getAvailablePath(dir + title, "md");
    await this.app.vault.create(path, data.md);
    return { md: data.md, title: data.title, path };
  };

  // -------------------------------------------------------------- webcontents

  proto.configureWebContents = function () {
    const wv = this.webview;
    if (!wv || this._webContentsConfigured) return;
    try {
      const wc = env().electron && env().electron.remote ? env().electron.remote.webContents.fromId(wv.getWebContentsId()) : null;
      if (!wc) return;
      this._webContentsConfigured = true;
      wc.setIgnoreMenuShortcuts(true);
      wc.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") return;
        const ev = new KeyboardEvent("keydown", { key: input.key, code: input.code, metaKey: input.meta, ctrlKey: input.control, altKey: input.alt, shiftKey: input.shift });
        const handled = this.app.keymap.onKeyEvent(ev);
        wc.setIgnoreMenuShortcuts(handled);
      });
      wc.on("input-event", (event, input) => {
        if (input.type === "mouseDown") {
          this.app.workspace.setActiveLeaf(this.leaf);
        }
      });
    } catch (err) {}
  };

  // ------------------------------------------------------------------ zoom

  proto.zoomIn = function () { this.setZoom((this.webview && this.webview.getZoomFactor ? this.webview.getZoomFactor() : 1) + 0.1); };
  proto.zoomOut = function () { this.setZoom((this.webview && this.webview.getZoomFactor ? this.webview.getZoomFactor() : 1) - 0.1); };
  proto.zoomReset = function () { this.setZoom(1); };
  proto.setZoom = function (value) {
    const z = Math.min(3, Math.max(0.5, value));
    if (this.webview && this.webview.setZoomFactor) this.webview.setZoomFactor(z);
    if (this.webview && this.webview.setZoomLevel) this.webview.setZoomLevel(Math.log(z) / Math.LN2 * 1.2);
  };

  // -------------------------------------------------------------- menus/search

  proto.onPaneMenu = function (menu, source) {
    const self = this;
    const t = host.t.plugins.webViewer;
    const leaf = this.leaf;
    menu.addItem((item) => item
      .setTitle(t.actionSaveToVault ? t.actionSaveToVault() : "Save to vault")
      .setIcon("lucide-file-down")
      .onClick(async () => {
        const saved = await self.saveAsMarkdown();
        if (saved && saved.path) {
          const l = self.app.workspace.getLeaf("tab");
          l.openFile(self.app.vault.getAbstractFileByPath(saved.path));
        }
      })
    );
    menu.addItem((item) => item
      .setTitle(host.t.interface.menu.find ? host.t.interface.menu.find() : "Find")
      .setIcon("lucide-file-search")
      .onClick(() => self.showSearch())
    );
    menu.addItem((item) => item
      .setTitle(t.actionOpenInBrowser ? t.actionOpenInBrowser() : "Open in default browser")
      .setIcon("lucide-globe-2")
      .onClick(() => { if (self.url) window.open(self.url, "_external"); })
    );
    menu.addSection("zoom");
    const zoom = (this.webview && this.webview.getZoomFactor ? this.webview.getZoomFactor() : 1);
    menu.addItem((item) => item.setTitle("Zoom in").setIcon("lucide-zoom-in").disabled(zoom >= 3).onClick(() => self.zoomIn()));
    menu.addItem((item) => item.setTitle("Reset zoom").setIcon("lucide-rotate-cw").disabled(zoom === 1).onClick(() => self.zoomReset()));
    menu.addItem((item) => item.setTitle("Zoom out").setIcon("lucide-zoom-in").disabled(zoom <= 0.5).onClick(() => self.zoomOut()));
    return menu;
  };

  proto.showSearch = function () {
    if (this.mode === "reader" && this.readerView) {
      if (!this.docSearch) {
        this.docSearch = new host.DocumentSearch(this.scope, this.readerRenderer, this.searchContainerEl, () => this.closeSearch());
      }
      this.docSearch.containerEl.show();
      this.docSearch.focus && this.docSearch.focus();
      return;
    }
    if (!this.findBar && this.webview) {
      try {
        this.findBar = env().s30qJ ? env().s30qJ(this.webview, this.searchContainerEl, () => this.closeSearch()) : null;
      } catch (err) { this.findBar = null; }
    }
    if (this.findBar && this.findBar.show) this.findBar.show();
  };
  proto.closeSearch = function () {
    if (this.docSearch && this.docSearch.containerEl) this.docSearch.containerEl.hide();
    if (this.findBar && this.findBar.hide) this.findBar.hide();
    if (this.searchContainerEl) this.searchContainerEl.hide();
  };

  proto.onExternalLinkClick = function (event, sourcePath, href) {
    event.preventDefault();
    event.stopPropagation();
    this.navigate(href, true);
  };

  proto.onClose = function () {
    host.ItemView.prototype.onClose.call(this);
    this.closeSearch();
  };

  return WebviewerView;
}

// -------------------------------------------------------------- setting tab

export function defineWebviewerSettingTab(host) {
  function WebviewerSettingTab(plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, plugin, instance) || this;
    self.icon = "globe-2";
    return self;
  }
  inherit(WebviewerSettingTab, host.PluginInstanceSettingTab);
  const proto = WebviewerSettingTab.prototype;

  proto.display = function () {
    const self = this;
    const instance = this.instance;
    this.containerEl.empty();
    const options = instance.options || {};
    const group = new host.SettingGroup(this.containerEl);
    const save = () => instance.saveOptions && instance.saveOptions();

    group.addSetting((setting) => {
      setting
        .setName(host.t.plugins.webViewer.optionOpenExternalLinks ? host.t.plugins.webViewer.optionOpenExternalLinks() : "Open external links")
        .addToggle((toggle) => {
          toggle.setValue(options.openExternalURLs !== false);
          toggle.onChange((value) => { options.openExternalURLs = value; save(); });
        });
    });
    group.addSetting((setting) => {
      setting
        .setName(host.t.plugins.webViewer.optionHomepage ? host.t.plugins.webViewer.optionHomepage() : "Homepage")
        .addText((text) => {
          text.setValue(options.homepage || "").onChange((value) => { options.homepage = value; save(); });
        });
    });
    group.addSetting((setting) => {
      setting
        .setName(host.t.plugins.webViewer.optionMarkdownPath ? host.t.plugins.webViewer.optionMarkdownPath() : "Saved markdown folder")
        .setDesc(host.t.plugins.webViewer.labelFolderPathExamplePlaceholder ? "" : "")
        .addText((text) => {
          const tab = new host.FolderPathSuggestTab(this.app, text.inputEl);
          tab.onChanged && tab.onChanged(() => {});
          text.setValue(options.markdownPath || "").onChange((value) => { options.markdownPath = (value || "").trim(); save(); });
        });
    });
    // search engine dropdown
    group.addSetting((setting) => {
      setting
        .setName(host.t.plugins.webViewer.optionSearchEngine ? host.t.plugins.webViewer.optionSearchEngine() : "Search engine")
        .addDropdown((dropdown) => {
          for (const key of Object.keys(s30SearchEngines)) {
            const label = key === "custom"
              ? (host.t.plugins.webViewer.optionSearchEngineCustomDropDown ? host.t.plugins.webViewer.optionSearchEngineCustomDropDown() : "Custom")
              : s30SearchEngines[key].display;
            dropdown.addOption(key, label);
          }
          dropdown.setValue(options.searchEngine || s30DefaultSearchEngine);
          dropdown.onChange((value) => {
            options.searchEngine = value;
            if (value === "custom" && !options.customSearchEngine) {
              options.customSearchEngine = s30SearchEngines[s30DefaultSearchEngine].url;
            }
            save();
          });
        });
    });
    // custom engine (only for custom)
    if ((options.searchEngine || s30DefaultSearchEngine) === "custom") {
      group.addSetting((setting) => {
        setting
          .setName(host.t.plugins.webViewer.optionCustomSearchEngine ? host.t.plugins.webViewer.optionCustomSearchEngine() : "Custom search engine URL")
          .addText((text) => {
            text.setValue(options.customSearchEngine || s30SearchEngines[s30DefaultSearchEngine].url);
            text.inputEl.addEventListener("blur", () => {
              const value = text.getValue();
              if (value.indexOf("%s") === -1) {
                host.displayTooltip && host.displayTooltip(text.inputEl, 'Search engine URL must contain "%s"');
                setTimeout(() => host.hideTooltip && host.hideTooltip(), 2000);
                text.setValue(options.customSearchEngine || s30SearchEngines[s30DefaultSearchEngine].url);
                return;
              }
              options.customSearchEngine = value;
              save();
            });
          });
      });
    }
    group.addSetting((setting) => {
      setting
        .setName(host.t.plugins.webViewer.optionEnableAdblocking ? host.t.plugins.webViewer.optionEnableAdblocking() : "Adblocking")
        .addToggle((toggle) => {
          toggle.setValue(options.enableAdblocking !== false);
          toggle.onChange((value) => {
            options.enableAdblocking = value;
            save();
            if (instance.updateSession) instance.updateSession();
          });
        });
    });
    // adblock lists
    let lists = "";
    try {
      if (env().ipcRenderer && env().ipcRenderer.sendSync) {
        const result = env().ipcRenderer.sendSync("adblock-lists");
        lists = Array.isArray(result) ? result.join("\n") : String(result || "");
      }
    } catch (err) {}
    group.addSetting((setting) => {
      setting
        .setName("Adblock lists")
        .addTextArea((area) => {
          area.inputEl.addClass("webviewer-adblock-lists");
          area.setValue(lists).setDisabled(!options.enableAdblocking);
          area.inputEl.addEventListener("blur", () => {
            const value = area.getValue();
            try {
              env().ipcRenderer && env().ipcRenderer.sendSync("adblock-lists", value.split("\n").map((s) => s.trim()).filter(Boolean));
            } catch (err) {}
          });
        });
    });
    group.addSetting((setting) => {
      setting
        .setName("Adblock frequency")
        .addSlider((slider) => {
          slider.setLimits(0, 24, 1).setValue(12).onChange((value) => {
            try { env().ipcRenderer && env().ipcRenderer.sendSync("adblock-frequency", value); } catch (err) {}
          });
        });
    });
    // clear data
    group.addSetting((setting) => {
      setting
        .setName(host.t.plugins.webViewer.labelWebViewerData ? host.t.plugins.webViewer.labelWebViewerData() : "Web viewer data")
        .addButton((button) => {
          button.setButtonText(host.t.plugins.webViewer.labelClearData ? host.t.plugins.webViewer.labelClearData() : "Clear data").onClick(() => {
            new (defineWebviewerClearDataModal(host))(this.app, instance).open();
          });
        });
    });
  };

  return WebviewerSettingTab;
}

// ------------------------------------------------------------------ clear modal

export function defineWebviewerClearDataModal(host) {
  function ClearDataModal(app, instance) {
    const self = host.DialogModal.call(this, app) || this;
    const t = host.t.plugins.webViewer;
    self.setTitle(t.titleClearDataModal ? t.titleClearDataModal() : "Clear web viewer data");
    const content = self.contentEl;
    const toggles = {};
    const addToggle = (key, label) => {
      const row = content.createDiv("setting-item");
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = key !== "all";
      toggles[key] = cb;
      row.createSpan({ text: label });
      return cb;
    };
    addToggle("cookies", t.actionClearDataCookies ? t.actionClearDataCookies() : "Cookies");
    addToggle("cache", t.actionClearDataCache ? t.actionClearDataCache() : "Cache");
    addToggle("history", t.actionClearDataHistory ? t.actionClearDataHistory() : "History");
    const all = addToggle("all", t.actionClearDataAll ? t.actionClearDataAll() : "All data");
    all.checked = false;
    all.addEventListener("change", () => {
      const on = all.checked;
      for (const key of ["cookies", "cache", "history"]) {
        toggles[key].checked = on;
        toggles[key].disabled = on;
      }
    });
    for (const key of ["cookies", "cache", "history"]) {
      toggles[key].addEventListener("change", () => {
        if (toggles[key].checked) all.checked = false;
      });
    }
    self.buttonContainerEl.createEl("button", { cls: "mod-warning", text: t.actionClearData ? t.actionClearData() : "Clear" }).addEventListener("click", async () => {
      const storages = all.checked
        ? ["cookies", "filesystem", "indexdb", "localstorage", "shadercache", "websql", "serviceworkers", "cachestorage"]
        : [toggles.cookies.checked ? "cookies" : null, toggles.cache.checked ? "cachestorage" : null].filter(Boolean);
      try {
        const session = env().electron && env().electron.remote ? env().electron.remote.session.fromPartition(app.getWebviewPartition()) : null;
        if (session && session.clearStorageData) await session.clearStorageData({ storages });
        if (session && session.clearData) await session.clearData();
      } catch (err) {}
      if (toggles.history.checked || all.checked) {
        if (instance && instance.db) instance.db.clearHistoryItems();
      }
      self.close();
    });
    self.buttonContainerEl.createEl("button", { text: host.t.dialogue.buttonCancel ? host.t.dialogue.buttonCancel() : "Cancel" }).addEventListener("click", () => self.close());
    return self;
  }
  inherit(ClearDataModal, host.DialogModal);
  return ClearDataModal;
}

// ------------------------------------------------------------- search modal

export function defineWebviewerSearchModal(host) {
  function WebviewerSearchModal(app, webviewer) {
    const self = host.Modal.call(this, app) || this;
    self.webviewer = webviewer;
    self.modalEl.addClass("prompt");
    self.inputEl = self.contentEl.createEl("input", { cls: "prompt-input" });
    self.inputEl.setAttribute("placeholder", host.t.plugins.webViewer.labelSearchTheWeb ? host.t.plugins.webViewer.labelSearchTheWeb() : "Search the web");
    self.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const query = self.inputEl.value.trim();
        if (query) {
          const url = webviewer.getSearchEngineUrl(query);
          const leaf = app.workspace.getLeaf("tab");
          leaf.setViewState({ type: s30WebviewerViewType, active: true, state: { url, navigate: true } });
        }
        self.close();
      }
    });
    return self;
  }
  inherit(WebviewerSearchModal, host.Modal);
  const proto = WebviewerSearchModal.prototype;
  proto.onOpen = function () {
    host.Modal.prototype.onOpen.call(this);
    setTimeout(() => this.inputEl.focus(), 0);
  };
  return WebviewerSearchModal;
}

// ------------------------------------------------------------------ plugin

export function defineWebviewerPlugin(host) {
  const DbClass = defineWebviewerDb(host);
  const ViewClass = defineWebviewerView(host);
  const HistoryViewClass = defineWebviewerHistoryView(host);
  const SettingTabClass = defineWebviewerSettingTab(host);

  function WebviewerPlugin() {
    this.app = null;
    this.plugin = null;
    this.db = null;
    this.options = Object.assign({}, s30WebviewerDefaultOptions);
  }
  const proto = WebviewerPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.db = new DbClass(app);
    const self = this;
    app.workspace.registerView(s30WebviewerViewType, (leaf) => new ViewClass(leaf, self));
    app.workspace.registerView(s30WebviewerHistoryViewType, (leaf) => new HistoryViewClass(leaf, self));
  };

  proto.onEnable = async function (app, plugin) {
    const self = this;
    const t = host.t.plugins.webViewer;
    const stored = (await plugin.loadData()) || {};
    this.options = Object.assign({}, s30WebviewerDefaultOptions, stored);

    const commands = [
      ["webviewer:open", t.actionOpenWebViewer ? t.actionOpenWebViewer() : "Open web viewer", "globe-2", (view) => {
        const leaf = app.workspace.getLeaf("tab");
        leaf.setViewState({ type: s30WebviewerViewType, active: true, state: { url: self.options.homepage || "about:blank", navigate: true } });
      }],
      ["webviewer:open-history", t.actionOpenHistory ? t.actionOpenHistory() : "Open web viewer history", "lucide-clock", () => {
        app.workspace.ensureSideLeaf(s30WebviewerHistoryViewType, "left", { active: true });
      }],
      ["webviewer:toggle-reader-mode", "Toggle reader mode", "glasses", (view) => {
        if (view.mode === "reader") view.exitReaderMode(); else view.enterReaderMode();
      }],
      ["webviewer:focus-address-bar", "Focus address bar", "text-cursor-input", (view) => {
        if (view.addressBar && view.addressBar.focus) view.addressBar.focus();
      }],
      ["webviewer:zoom-in", "Zoom in", "lucide-zoom-in", (view) => view.zoomIn()],
      ["webviewer:zoom-reset", "Reset zoom", "lucide-rotate-cw", (view) => view.zoomReset()],
      ["webviewer:zoom-out", "Zoom out", "lucide-zoom-in", (view) => view.zoomOut()],
      ["webviewer:search", "Search the web", "lucide-search", () => new (defineWebviewerSearchModal(host))(app, self).open()],
      ["webviewer:save-to-vault", "Save to vault", "lucide-file-down", async (view) => {
        const saved = await view.saveAsMarkdown();
        if (saved && saved.path) {
          const leaf = app.workspace.getLeaf("tab");
          leaf.openFile(app.vault.getAbstractFileByPath(saved.path));
        }
      }],
    ];

    for (const [id, name, icon, run] of commands) {
      const isOpenHistory = id === "webviewer:open-history" || id === "webviewer:search";
      app.commands.addCommand({
        id,
        name,
        icon,
        checkCallback: (checking) => {
          if (isOpenHistory) {
            if (checking) return true;
            run(null);
            return true;
          }
          const view = app.workspace.getActiveViewOfType(ViewClass);
          if (!view) return false;
          if (checking) return true;
          run(view);
          return true;
        },
      });
    }

    // url-menu: "open link in web viewer"
    this._urlMenuHandler = (url, menu) => {
      menu.addItem((item) => item
        .setSection("open")
        .setTitle(t.actionOpenLinkWebViewer ? t.actionOpenLinkWebViewer() : "Open in web viewer")
        .setIcon("lucide-globe-2")
        .onClick((e) => self.openUrl(url, host.Keymap.isModEvent(e)))
      );
    };
    app.workspace.on("url-menu", this._urlMenuHandler);

    this._openUrlHandler = (url, where, event) => {
      if (!self.options.openExternalURLs) return;
      event.preventDefault && event.preventDefault();
      const hasModal = document.querySelector(".modal-container");
      self.openUrl(url, hasModal ? "window" : where, true);
    };
    window.addEventListener("open-url", this._openUrlHandler);

    app.setting.addSettingTab(new SettingTabClass(plugin, this));
    this.updateSession();
    this.db.connect();

    // CLI handler
    app.cli && app.cli.register && app.cli.register([{
      name: "web",
      description: "Open URL in web viewer",
      flags: [
        { name: "url", description: "<url>", required: true },
        { name: "newtab", description: "", required: false },
      ],
      handler: async (flags) => {
        let url = flags.url;
        if (!url) throw new Error("Missing required parameter: url\nUsage: web url=<url>");
        if (url.indexOf("://") === -1) url = "https://" + url;
        self.openUrl(url, flags.newtab ? "tab" : undefined, true);
        return "Opened: " + url;
      },
    }]);
  };

  proto.getSearchEngineUrl = function (query) {
    const options = this.options || {};
    const engine = options.searchEngine || s30DefaultSearchEngine;
    let template;
    if (engine === "custom") template = options.customSearchEngine;
    else if (s30SearchEngines[engine]) template = s30SearchEngines[engine].url;
    if (!template) template = s30SearchEngines[s30DefaultSearchEngine].url;
    return template.replace("%s", encodeURIComponent(query));
  };

  proto.updateSession = function () {
    try {
      env().ipcRenderer && env().ipcRenderer.send("create-browser-session", this.app.getWebviewPartition(), this.options.enableAdblocking);
    } catch (err) {}
  };

  proto.openUrl = function (url, where, active = true) {
    const leaf = this.app.workspace.getLeaf(where);
    if (!leaf) return;
    leaf.setViewState({
      type: s30WebviewerViewType,
      active,
      state: { url, title: url, navigate: true },
    });
  };

  proto.saveOptions = function () {
    return this.plugin.saveData(this.options);
  };

  proto.onUnload = function () {
    if (this._urlMenuHandler) this.app.workspace.off("url-menu", this._urlMenuHandler);
    if (this._openUrlHandler) window.removeEventListener("open-url", this._openUrlHandler);
  };

  return WebviewerPlugin;
}
