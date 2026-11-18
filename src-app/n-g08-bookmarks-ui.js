// g08 clean-room: BookmarksView (sidebar tree) and BookmarksPlugin (commands, menus, CLI, persistence).
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { ng15WalkTree, ng15TreeDropPosition, ng15UpdateTreeDropIndicator } from "./n-g15-tree.js";
import { fileClass } from "./vault.js";
import { binaryFind, randomHex } from "./misc.js";
import { displayName, firstHeadingText, parseLinktext } from "./path.js";
import { linkSafeHeading } from "./text.js";
import { ng08SetPlainText } from "./n-g08-drag.js";
import { s28BookmarkParentSymbol } from "./s28-graph.js";

const ng08BmT2 = () => __basaltHost.t.plugins.bookmarks;

// =====================================================================================================================
// BookmarksView
// =====================================================================================================================

export function ng08DefineBookmarksView(host) {
  const viewT = () => ng08BmT2();
  const fileExplorerT = () => __basaltHost.t.plugins.fileExplorer;

  function BookmarksView(leaf, plugin) {
    const self = host.ItemView.call(this, leaf) || this;
    self.icon = "lucide-bookmark";
    self.plugin = plugin;
    self.itemDoms = new WeakMap();
    self.requestUpdate = debounceCall(self.update.bind(self), 50);
    self.scope = new host.Scope(self.app.scope);
    const contentEl = self.contentEl;
    self.tree = new host.Tree(self, {
      app: self.app,
      containerEl: contentEl,
      id: "bookmarks",
      scope: self.scope,
      getNodeId: (dom) => "item-" + dom.item.ctime,
      handleCollapseAll: self.handleCollapseAll.bind(self),
      handleDeleteSelectedItems: self.handleDeleteSelectedItems.bind(self),
      handleRenameFocusedItem: self.handleRenameFocusedItem.bind(self),
    });
    const header = new host.ViewHeader(self.app, self.containerEl);
    self.newBookmarkButtonEl = header.addNavButton("lucide-bookmark-plus", viewT().actionNewBookmark(), () => {
      const leaf = self.app.workspace.getMostRecentLeaf && self.app.workspace.getMostRecentLeaf();
      if (leaf) new ng08Bm.BookmarkEditModal(plugin, leaf, false).open();
    });
    self.newGroupButtonEl = header.addNavButton("lucide-folder-plus", viewT().actionNewGroup(), () => self.createNewGroup());
    self.collapseAllButtonEl = header.addNavButton("lucide-chevrons-down-up", fileExplorerT().actionCollapseAll(), () => {
      self.tree.toggleCollapseAll();
      self.updateCollapseIcon();
    });
    self.emptyEl = null;
    self.attachDropHandler(contentEl);
    return self;
  }
  inherit(BookmarksView, host.ItemView);
  const proto = BookmarksView.prototype;

  proto.getViewType = function () { return "bookmarks"; };
  proto.getDisplayText = function () { return viewT().name(); };

  proto.getItemDom = function (item) {
    let dom = this.itemDoms.get(item);
    if (!dom) {
      if (item.type === "group") dom = new ng08Bm.BookmarkGroupItem(this, this.tree, item);
      else dom = new ng08Bm.BookmarkLeafItem(this, this.tree, item);
      this.itemDoms.set(item, dom);
    }
    return dom;
  };

  proto.isItem = function (item) { return item instanceof ng08Bm.BookmarkItemBase; };
  proto.getNodeId = function (dom) { return "item-" + dom.item.ctime; };

  proto.updateCollapseIcon = function () {
    const collapsed = this.tree.isAllCollapsed;
    host.setIcon(this.collapseAllButtonEl, collapsed ? "lucide-chevrons-down-up" : "lucide-chevrons-up-down");
    host.setTooltip(this.collapseAllButtonEl, collapsed ? fileExplorerT().actionCollapseAll() : fileExplorerT().actionExpandAll());
  };

  proto.handleCollapseAll = function () {
    this.updateCollapseIcon();
  };

  proto.handleDeleteSelectedItems = function () {
    const selected = this.tree.getSelectedItems();
    if (selected.length) {
      for (const dom of selected) this.plugin.removeItem(dom.item);
    } else if (this.tree.focusedItem && this.isItem(this.tree.focusedItem)) {
      this.plugin.removeItem(this.tree.focusedItem.item);
    }
  };

  proto.handleRenameFocusedItem = function () {
    const focused = this.tree.focusedItem;
    if (focused && this.isItem(focused)) focused.startRename();
  };

  proto.onOpen = function () {
    const self = this;
    const app = this.app;
    const plugin = this.plugin;
    const vault = app.vault;
    this.registerEvent(plugin.on("changed", () => this.requestUpdate()));
    this.registerEvent(app.metadataCache.on("finished", () => this.requestUpdate()));
    this.registerEvent(vault.on("create", (file) => this.onVaultFileChange(file)));
    this.registerEvent(vault.on("delete", (file) => this.onVaultFileChange(file)));
    this.registerEvent(app.workspace.on("file-open", () => this.refreshActiveState()));
    this.registerEvent(app.workspace.on("layout-ready", () => this.tree.loadFolds()));
    this.update();
  };

  proto.onVaultFileChange = function (file) {
    ng08WalkBookmarkItems(this.plugin.items, (item) => {
      if ((item.type === "file" || item.type === "folder") && item.path === file.path) {
        const dom = this.itemDoms.get(item);
        if (dom) dom.update();
        return true;
      }
    });
  };

  proto.refreshActiveState = function () {
    const file = this.app.workspace.getActiveFile && this.app.workspace.getActiveFile();
    const activePath = file && file.path;
    ng15WalkTree(this.tree.root, (dom) => {
      if (!this.isItem(dom)) return;
      const item = dom.item;
      const active = item.type === "file" && !item.subpath && item.path === activePath;
      dom.setActive(active);
    });
  };

  proto.update = function () {
    const plugin = this.plugin;
    const tree = this.tree;
    tree.root.vChildren.clear();
    if (plugin.hasValidData) {
      for (const item of plugin.items) {
        const dom = this.getItemDom(item);
        dom.update();
        if (item.type === "group") dom.refreshChildren();
        tree.root.vChildren.addChild(dom);
      }
    }
    if (plugin.items.length > 0) {
      if (this.emptyEl) this.emptyEl.hide();
    } else {
      if (!this.emptyEl) {
        this.emptyEl = this.contentEl.createDiv({ cls: "pane-empty bookmarks-pane-empty", text: viewT().labelNoBookmarks() });
      }
      this.emptyEl.show();
    }
    if (!plugin.hasValidData) {
      let errorEl = this.contentEl.find(".pane-empty.mod-error");
      if (!errorEl) {
        errorEl = this.contentEl.createDiv({ cls: "pane-empty mod-error" });
        errorEl.createDiv({ cls: "mod-error-message", text: viewT().labelInvalidData() });
        errorEl.createDiv({ cls: "mod-error-description", text: viewT().labelInvalidDataDesc() });
      }
      errorEl.show();
    } else {
      const errorEl = this.contentEl.find(".pane-empty.mod-error");
      if (errorEl) errorEl.hide();
    }
    this.refreshActiveState();
    this.updateCollapseIcon();
    if (this.tree.infinityScroll && this.tree.infinityScroll.compute) this.tree.infinityScroll.compute();
  };

  proto.createNewGroup = function (parent) {
    const group = ng08BookmarkGroupItem();
    if (parent) {
      parent.items.push(group);
      Object.defineProperty(group, s28BookmarkParentSymbol, { value: parent, enumerable: false, configurable: true, writable: true });
    } else {
      this.plugin.items.push(group);
      Object.defineProperty(group, s28BookmarkParentSymbol, { value: null, enumerable: false, configurable: true, writable: true });
    }
    this.plugin.saveData();
    this.update();
    const dom = this.getItemDom(group);
    dom.startRename();
  };

  proto.attachDropHandler = function (contentEl) {
    const self = this;
    const plugin = this.plugin;
    self.app.dragManager.handleDrop(contentEl, (event, dragInfo, isOver) => {
      const pos = ng15TreeDropPosition(event, self.tree);
      const indicator = ng15UpdateTreeDropIndicator(self.tree, pos, dragInfo.items || [], isOver);
      if (!isOver) {
        if (pos) {
          const parentItem = pos.parentNode && pos.parentNode.item ? pos.parentNode.item : null;
          const index = pos.index !== undefined ? pos.index : (parentItem ? (parentItem.items || []).length : plugin.items.length);
          const dragged = dragInfo.items || [];
          if (dragInfo.type === "bookmarks" && dragInfo.source === "bookmarks") {
            for (const entry of dragged) {
              const item = entry.item || entry;
              if (!item || !item.type) continue;
              const parentNode = item[s28BookmarkParentSymbol];
              if (parentNode === parentItem) continue;
              plugin.moveItem(item, parentItem, index);
            }
          } else if (dragInfo.type === "file" && dragInfo.file) {
            plugin.addItem(ng08BookmarkItemForFile(dragInfo.file), parentItem);
          } else if (dragInfo.type === "heading" && dragInfo.file && dragInfo.heading) {
            plugin.addItem(ng08BookmarkItemForFile(dragInfo.file, "#" + linkSafeHeading(dragInfo.heading.heading)), parentItem);
          } else if (dragInfo.type === "link" && dragInfo.file) {
            const sub = parseLinktext(dragInfo.linktext || "").subpath;
            const item = ng08BookmarkItemForFile(dragInfo.file, sub);
            item.title = dragInfo.title;
            plugin.addItem(item, parentItem);
          } else if (dragInfo.type === "files" && dragInfo.files) {
            for (const item of ng08FilesToBookmarkItems(dragInfo.files)) plugin.addItem(item, parentItem);
          } else if (dragInfo.type === "folder" && dragInfo.file) {
            plugin.addItem(ng08BookmarkItemForFolder(dragInfo.file), parentItem);
          }
        }
        return null;
      }
      return { dropEffect: "move", hoverEl: indicator, hoverClass: "is-active" };
    });
  };

  proto.dragSelectedBookmarks = function (event, dom) {
    const selected = this.tree.selectedDoms;
    if (!selected.has(dom) || selected.size <= 1) return null;
    const ordered = Array.from(selected).sort((a, b) => a.selfEl.offsetTop - b.selfEl.offsetTop);
    this.app.dragManager.updateSource(ordered.map((d) => d.selfEl), "is-being-dragged");
    const items = ordered.map((d) => d.item);
    const title = viewT().labelBookmarkWithCount({ count: items.length });
    return { source: "bookmarks", type: "bookmarks", icon: "lucide-bookmark", items: ordered, title, bookmarkItems: items };
  };

  proto.attachDragHandler = function (dom) {
    const self = this;
    const plugin = this.plugin;
    self.app.dragManager.handleDrag(dom.selfEl, (event) => {
      const multi = self.dragSelectedBookmarks(event, dom);
      if (multi) {
        const title = plugin.getItemTitle(dom.item) || "";
        ng08SetPlainText(event.dataTransfer, title);
        return multi;
      }
      if (!self.tree.selectedDoms.has(dom)) {
        if (self.tree.clearSelectedDoms) self.tree.clearSelectedDoms();
        if (self.tree.selectItem) self.tree.selectItem(dom);
      }
      self.app.dragManager.updateSource([dom.selfEl], "is-being-dragged");
      const title = plugin.getItemTitle(dom.item) || "";
      ng08SetPlainText(event.dataTransfer, title);
      return { source: "bookmarks", type: "bookmarks", icon: "lucide-bookmark", items: [dom], title, bookmarkItems: [dom.item] };
    });
  };

  proto._getActiveBookmarks = function () {
    const selected = this.tree.getSelectedItems();
    if (selected.length) return selected.map((d) => d.item);
    const focused = this.tree.focusedItem;
    if (focused && this.isItem(focused)) return [focused.item];
    return [];
  };

  proto.onCopy = function () {
    const items = this._getActiveBookmarks();
    if (!items.length) return;
    const text = JSON.stringify(items);
    try { this.app.clipboard && this.app.clipboard.write && this.app.clipboard.write({ "basalt/bookmarks": text }); } catch (e) {}
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
  };

  proto.onCut = function () {
    const items = this._getActiveBookmarks();
    if (!items.length) return;
    const text = JSON.stringify(items);
    try { this.app.clipboard && this.app.clipboard.write && this.app.clipboard.write({ "basalt/bookmarks": text }); } catch (e) {}
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
    for (const item of items) this.plugin.removeItem(item);
  };

  proto.onPaste = function () {
    const read = async () => {
      let text = null;
      try {
        if (this.app.clipboard && this.app.clipboard.read) {
          const data = await this.app.clipboard.read();
          text = data && (data["basalt/bookmarks"] || data.text);
        }
      } catch (e) {}
      if (!text && navigator.clipboard && navigator.clipboard.readText) {
        try { text = await navigator.clipboard.readText(); } catch (e) {}
      }
      if (!text) return;
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { console.log(e); return; }
      if (!Array.isArray(parsed)) return;
      const focused = this.tree.focusedItem;
      let parent = null;
      if (focused && this.isItem(focused)) {
        parent = focused.item.type === "group" ? focused.item : (focused.item[s28BookmarkParentSymbol] || null);
      }
      for (const entry of parsed) {
        this.plugin.addItem(Object.assign({}, entry, { ctime: Date.now() }), parent);
      }
    };
    read();
  };

  ng08Bm.BookmarksView = BookmarksView;
  return BookmarksView;
}

// =====================================================================================================================
// BookmarksPlugin
// =====================================================================================================================

const ng08BM_VIEW_TYPE = "bookmarks";

export function ng08DefineBookmarksPlugin(host) {
  const t = () => ng08BmT2();

  function BookmarksPlugin() {
    host.Events.call(this);
    this.id = "bookmarks";
    this.name = t().name();
    this.description = t().desc();
    this.defaultOn = true;
    this.items = [];
    this.hasValidData = false;
    this.bookmarkLookup = {};
    this.urlBookmarkLookup = {};
    this.bookmarkedViews = new WeakMap();
    this.app = null;
    this.plugin = null;
    this.onItemsChanged = debounceCall(this._onItemsChanged.bind(this, true), 20);
  }
  inherit(BookmarksPlugin, host.Events);
  const proto = BookmarksPlugin.prototype;

  proto.init = function (app, plugin) {
    const self = this;
    this.app = app;
    this.plugin = plugin;
    plugin.registerViewType(ng08BM_VIEW_TYPE, (leaf) => new ng08Bm.BookmarksView(leaf, self));

    plugin.registerGlobalCommand({
      id: "bookmarks:open",
      name: t().actionShow(),
      icon: "lucide-bookmark",
      callback: () => {
        app.workspace.ensureSideLeaf(ng08BM_VIEW_TYPE, "left", { active: true });
      },
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:bookmark-current-view",
      name: t().actionBookmark(),
      icon: "lucide-bookmark-plus",
      checkCallback: (checking) => self.cmdBookmarkCurrentView(checking),
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:bookmark-current-search",
      name: t().actionBookmarkSearch(),
      icon: "lucide-search",
      checkCallback: (checking) => self.cmdBookmarkCurrentSearch(checking),
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:unbookmark-current-view",
      name: t().actionRemoveBookmark(),
      icon: "lucide-bookmark-plus",
      checkCallback: (checking) => self.cmdUnbookmarkCurrentView(checking),
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:bookmark-current-section",
      name: t().actionBookmarkBlock(),
      icon: "lucide-bookmark-plus",
      editorCallback: (editor, view) => self.cmdBookmarkSection(editor, view),
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:bookmark-current-heading",
      name: t().actionBookmarkHeading(),
      icon: "lucide-bookmark-plus",
      editorCallback: (editor, view) => self.cmdBookmarkHeading(editor, view),
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:bookmark-all-tabs",
      name: t().actionBookmarkAllTabs(),
      icon: "lucide-bookmark-plus",
      callback: () => self.cmdBookmarkAllTabs(),
    });
  };

  // ---------- data ----------

  proto.loadData = async function () {
    const data = await this.plugin.loadData();
    this.hasValidData = data !== undefined;
    const diskItems = data && Array.isArray(data.items) ? data.items : [];
    this.items = this._reconcileLoaded(diskItems);
    this._linkParents(this.items, null);
    this.rebuildBookmarkCache();
    return this.hasValidData;
  };

  /** Reuses live item objects for entries that are unchanged on disk, so callers holding
   *  references (tests, views, drag payloads) survive watcher-triggered reloads. */
  proto._reconcileLoaded = function (diskItems) {
    const pool = new Map();
    ng08WalkBookmarkItems(this.items, (it) => {
      const key = JSON.stringify(it);
      if (!pool.has(key)) pool.set(key, it);
    });
    const take = (d) => {
      const key = JSON.stringify(d);
      const hit = pool.get(key);
      if (hit) { pool.delete(key); return hit; }
      return d;
    };
    const build = (list) => (list || []).map((d) => {
      const it = take(d);
      if (it.type === "group" && Array.isArray(d.items)) it.items = build(d.items);
      return it;
    });
    return build(diskItems);
  };

  proto._linkParents = function (list, parent) {
    for (const item of list || []) {
      Object.defineProperty(item, s28BookmarkParentSymbol, {
        value: parent, enumerable: false, configurable: true, writable: true,
      });
      if (item.type === "group" && item.items) this._linkParents(item.items, item);
    }
  };

  proto.saveData = async function () {
    await this.plugin.saveData({ items: this.items });
  };

  proto._onItemsChanged = function (save) {
    this.trigger("changed");
    this.rebuildBookmarkCache();
    this.updateTabHeaders();
    if (save) this.saveData();
  };

  proto.rebuildBookmarkCache = function () {
    const lookup = {};
    const urlLookup = {};
    ng08WalkBookmarkItems(this.items, (item) => {
      if ((item.type === "file" && !item.subpath) || item.type === "folder") {
        lookup[item.path] = item;
      } else if (item.type === "url") {
        urlLookup[item.url] = item;
      }
    });
    this.bookmarkLookup = lookup;
    this.urlBookmarkLookup = urlLookup;
  };

  // ---------- item list ops ----------

  proto.getBookmarks = function () { return this.items; };

  proto.getItemTitle = function (item) {
    if (!item) return "";
    if (item.title) return item.title;
    if (item.type === "file") {
      if (item.subpath) return displayName(item.path) + item.subpath;
      const file = this.app.vault.getAbstractFileByPath(item.path);
      return file ? file.getShortName() : displayName(item.path);
    }
    if (item.type === "folder") {
      const file = this.app.vault.getAbstractFileByPath(item.path);
      return file ? file.name : displayName(item.path);
    }
    if (item.type === "search") return item.query;
    return item.title;
  };

  proto.addItem = function (item, parent) {
    Object.defineProperty(item, s28BookmarkParentSymbol, {
      value: parent || null, enumerable: false, configurable: true, writable: true,
    });
    if (parent && parent.items) parent.items.push(item);
    else this.items.push(item);
    this.onItemsChanged(true);
  };

  proto.editItem = function (item) {
    this._onItemsChanged(true);
  };

  proto.removeItem = function (item) {
    const parent = item[s28BookmarkParentSymbol];
    const list = parent && parent.items ? parent.items : this.items;
    const index = list.indexOf(item);
    if (index !== -1) list.splice(index, 1);
    this._onItemsChanged(true);
  };

  proto.moveItem = function (item, parent, index) {
    const oldParent = item[s28BookmarkParentSymbol];
    const oldList = oldParent && oldParent.items ? oldParent.items : this.items;
    const oldIndex = oldList.indexOf(item);
    if (oldIndex === -1) return;
    oldList.splice(oldIndex, 1);
    const newList = parent && parent.items ? parent.items : this.items;
    let target = index;
    if (oldList === newList && oldIndex < target) target--;
    if (target < 0) target = 0;
    if (target > newList.length) target = newList.length;
    newList.splice(target, 0, item);
    Object.defineProperty(item, s28BookmarkParentSymbol, {
      value: parent || null, enumerable: false, configurable: true, writable: true,
    });
    this._onItemsChanged(true);
  };

  proto.findBookmarkByView = function (view) {
    if (!view) return null;
    if (view instanceof host.FileView && view.file) {
      return this.bookmarkLookup[view.file.path] || null;
    }
    if (view instanceof host.WebViewerView && view.url) {
      return this.urlBookmarkLookup[view.url] || null;
    }
    return null;
  };

  // ---------- opening ----------

  proto.openBookmark = function (item, newLeaf, options) {
    const app = this.app;
    if (item.type === "file" || item.type === "graph") {
      const leaf = app.workspace.getLeaf(newLeaf);
      return this.openBookmarkInLeaf(item, leaf, options);
    }
    if (item.type === "url") {
      window.open(item.url, "_blank");
      return;
    }
    if (item.type === "folder") {
      const file = app.vault.getAbstractFileByPath(item.path);
      const explorer = app.internalPlugins.getEnabledPluginById("file-explorer");
      if (explorer && explorer.revealInFolder && file) explorer.revealInFolder(file);
      return;
    }
    if (item.type === "search") {
      const searchPlugin = app.internalPlugins.getEnabledPluginById("global-search");
      if (!searchPlugin) return;
      const query = item.query || "";
      let current = "";
      app.workspace.getLeavesOfType("search").forEach((leaf) => {
        if (leaf.view && leaf.view.getQuery) current = leaf.view.getQuery() || current;
      });
      if (!newLeaf || !current) {
        searchPlugin.openGlobalSearch(query);
      } else {
        const next = current.includes(query) ? (current.replace(query, "") || "").trim() : (current + " " + query).trim();
        searchPlugin.openGlobalSearch(next);
      }
    }
  };

  proto.openBookmarkInLeaf = async function (item, leaf, options) {
    const app = this.app;
    if (item.type === "file") {
      await leaf.openLinkText(item.path + (item.subpath || ""), "", options);
    } else if (item.type === "graph") {
      const graphPlugin = app.internalPlugins.getEnabledPluginById("graph");
      await leaf.setViewState({ type: "graph" });
      if (leaf.view instanceof host.GraphView) {
        if (leaf.view.dataEngine && leaf.view.dataEngine.setOptions) leaf.view.dataEngine.setOptions(item.options);
        if (graphPlugin && graphPlugin.options) graphPlugin.options.options = item.options;
      }
    } else if (item.type === "url") {
      window.open(item.url, "_blank");
    }
  };

  proto.openBookmarks = async function (items, placement) {
    const openable = (items || []).filter((i) => i.type === "file" || i.type === "graph");
    if (!openable.length) return;
    const app = this.app;
    const firstLeaf = app.workspace.getLeaf(placement);
    const parent = firstLeaf.parent;
    const leaves = [firstLeaf];
    for (let i = 1; i < openable.length; i++) {
      const leaf = new host.WorkspaceLeaf(app);
      parent.insertChild(i, leaf);
      leaves.push(leaf);
    }
    for (let i = 0; i < openable.length; i++) {
      await this.openBookmarkInLeaf(openable[i], leaves[i], { active: false });
    }
    if (app.vault.getConfig("focusNewTab")) {
      app.workspace.setActiveLeaf(firstLeaf, { focus: true });
    }
  };

  // ---------- commands ----------

  proto._mostRecentLeaf = function () {
    return this.app.workspace.getMostRecentLeaf && this.app.workspace.getMostRecentLeaf();
  };

  proto.cmdBookmarkCurrentView = function (checking) {
    const leaf = this._mostRecentLeaf();
    const view = leaf && leaf.view;
    if (!view) return undefined;
    const item = ng08ViewToBookmarkItem(leaf);
    if (!item) return undefined;
    let exists = false;
    if (view instanceof host.FileView && view.file) exists = !!this.bookmarkLookup[view.file.path];
    else if (view instanceof host.WebViewerView && view.url) exists = !!this.urlBookmarkLookup[view.url];
    if (checking) return true;
    new ng08Bm.BookmarkEditModal(this, item, exists).open();
    return true;
  };

  proto._searchQuery = function () {
    const app = this.app;
    let query = "";
    app.workspace.getLeavesOfType("search").forEach((leaf) => {
      if (leaf.view && leaf.view.getQuery) query = leaf.view.getQuery() || query;
    });
    if (!query) {
      const sp = app.internalPlugins.getEnabledPluginById("global-search");
      if (sp && sp.query) query = sp.query;
    }
    return query || "";
  };

  proto.cmdBookmarkCurrentSearch = function (checking) {
    const app = this.app;
    const searchPlugin = app.internalPlugins.getEnabledPluginById("global-search");
    if (!searchPlugin) return undefined;
    const query = this._searchQuery();
    if (!query) {
      if (!checking) new host.Notice(t().msgNoSearchQuery());
      return true;
    }
    let exists = false;
    ng08WalkBookmarkItems(this.items, (item) => {
      if (item.type === "search" && item.query === query) { exists = true; return true; }
    });
    if (checking) return true;
    new ng08Bm.BookmarkEditModal(this, ng08BookmarkItemForSearch(query), exists).open();
    return true;
  };

  proto.cmdUnbookmarkCurrentView = function (checking) {
    const leaf = this._mostRecentLeaf();
    const view = leaf && leaf.view;
    const item = this.findBookmarkByView(view);
    if (!item) return false;
    if (!checking) this.removeItem(item);
    return true;
  };

  proto.cmdBookmarkAllTabs = function () {
    const app = this.app;
    const items = [];
    const collect = (split) => {
      if (!split) return;
      app.workspace.iterateLeaves(split, (leaf) => {
        const item = ng08ViewToBookmarkItem(leaf);
        if (item) items.push(item);
      });
    };
    collect(app.workspace.rootSplit);
    collect(app.workspace.floatingSplit);
    if (items.length) new ng08Bm.BookmarkManyModal(app, this, items).open();
  };

  proto._sectionAtCursor = function (editor, view) {
    const app = this.app;
    const file = view && view.file;
    if (!file) return null;
    const cursor = editor.getCursor();
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) return null;
    const sections = cache.sections;
    if (sections && sections.length) {
      const section = binaryFind(sections, (s) => {
        if (s.position.start.line > cursor.line) return -1;
        if (s.position.end.line < cursor.line) return 1;
        return 0;
      });
      if (section) return { kind: "section", section, file, cursor, cache };
    }
    const items = cache.listItems;
    if (items && items.length) {
      const item = binaryFind(items, (it) => {
        if (it.position.start.line > cursor.line) return -1;
        if (it.position.end.line < cursor.line) return 1;
        return 0;
      });
      if (item) return { kind: "listItem", section: { type: "listItem", position: item.position, id: item.id }, file, cursor, cache };
    }
    const headings = cache.headings;
    if (headings && headings.length) {
      const heading = ng08HeadingAtPosition(app, file, cursor);
      if (heading) return { kind: "heading", section: { type: "heading", position: heading.position }, file, cursor, cache, heading };
    }
    return null;
  };

  proto._findSectionNode = function (content, section) {
    const tree = __basaltHost.markdownTree(content);
    const children = tree.children || [];
    for (const n of children) {
      if (n.type === section.type && n.position) {
        const sl = section.position.start.line;
        if (n.position.start.line === sl || n.position.start.line === sl - 1 || n.position.start.line === sl + 1) return n;
      }
    }
    return children[0] || null;
  };

  proto.cmdBookmarkSection = function (editor, view) {
    const found = this._sectionAtCursor(editor, view);
    if (!found) return;
    const { file, cursor, section } = found;
    const app = this.app;
    const content = editor.getValue();
    const node = this._findSectionNode(content, section);
    if (!node || !node.position) return;
    const pos = node.position;
    const startOffset = pos.start.offset;
    const endOffset = pos.end.offset;
    if (startOffset === undefined || endOffset === undefined) return;

    let subpath;
    let onAdded;
    const selectionText = editor.getSelection();
    if (section.type === "heading" || found.kind === "heading") {
      const heading = found.heading || ng08HeadingAtPosition(app, file, cursor);
      if (!heading) return;
      subpath = "#" + linkSafeHeading(heading.heading);
    } else {
      const id = section.id || randomHex(6);
      subpath = "#^" + id;
      onAdded = () => {
        const current = editor.getValue();
        const tree = __basaltHost.markdownTree(current);
        let target = null;
        const walk = (nodes) => {
          for (const n of nodes || []) {
            if (n.position && n.position.start.offset === startOffset) { target = n; return; }
            if (n.children) walk(n.children);
          }
        };
        walk(tree.children);
        if (!target) target = node;
        const insertion = ng08BlockRefInsertion({ content: current, node: target }, id);
        editor.cm.dispatch({ changes: { from: insertion.blockEnd, insert: insertion.addition } });
      };
    }
    const item = ng08BookmarkItemForFile(file, subpath);
    if (selectionText) item.title = selectionText;
    let exists = false;
    ng08WalkBookmarkItems(this.items, (it) => {
      if (it.type === "file" && it.path === file.path && (it.subpath || "") === subpath) { exists = true; return true; }
    });
    new ng08Bm.BookmarkEditModal(this, item, exists, onAdded).open();
  };

  proto.cmdBookmarkHeading = function (editor, view) {
    const file = view && view.file;
    if (!file) return;
    const cursor = editor.getCursor();
    const heading = ng08HeadingAtPosition(this.app, file, cursor);
    if (!heading) return;
    const subpath = "#" + linkSafeHeading(heading.heading);
    const item = ng08BookmarkItemForFile(file, subpath);
    const selectionText = editor.getSelection();
    if (selectionText) item.title = selectionText;
    let exists = false;
    ng08WalkBookmarkItems(this.items, (it) => {
      if (it.type === "file" && it.path === file.path && it.subpath === subpath) { exists = true; return true; }
    });
    new ng08Bm.BookmarkEditModal(this, item, exists).open();
  };

  // ---------- lifecycle ----------

  proto.onEnable = async function (app, wrapper) {
    const self = this;
    wrapper.registerEvent(app.workspace.on("editor-menu", this.onEditorMenu, this));
    wrapper.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
    wrapper.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
    wrapper.registerEvent(app.workspace.on("files-menu", this.onFilesMenu, this));
    wrapper.registerEvent(app.workspace.on("leaf-menu", this.onLeafMenu, this));
    wrapper.registerEvent(app.workspace.on("search:results-menu", this.onSearchResultsMenu, this));
    wrapper.registerEvent(app.workspace.on("tab-group-menu", this.onTabGroupMenu, this));
    wrapper.registerEvent(app.workspace.on("layout-change", this.updateTabHeaders, this));
    wrapper.registerEvent(app.vault.on("rename", this.onFileRename, this));
    app.workspace.registerHoverLinkSource("bookmarks", { display: this.name, defaultMod: true });

    wrapper.registerCliHandler(
      "bookmarks",
      "List bookmarks",
      {
        total: { description: "Return bookmark count" },
        verbose: { description: "Verbose output" },
        format: { value: "json|tsv|csv", description: "Output format" },
      },
      (args) => self.cliBookmarks(args)
    );
    wrapper.registerCliHandler(
      "bookmark",
      "Add a bookmark",
      {
        file: { value: "<path>", description: "File to bookmark" },
        folder: { value: "<path>", description: "Folder to bookmark" },
        search: { value: "<query>", description: "Search query" },
        url: { value: "<url>", description: "URL" },
        title: { value: "<title>", description: "Title" },
      },
      (args) => self.cliBookmark(args)
    );

    await this.loadData();
    if (!this.items.length) {
      app.workspace.onLayoutReady(async () => {
        try {
          const starred = await app.vault.readConfigJson("starred");
          if (starred && Array.isArray(starred.items)) {
            const ctime = Date.now();
            let changed = false;
            for (const entry of starred.items) {
              if (entry.type !== "file" && entry.type !== "folder") continue;
              const file = app.vault.getAbstractFileByPath(entry.path);
              if (!file) continue;
              const item = entry.type === "file" ? ng08BookmarkItemForFile(file) : ng08BookmarkItemForFolder(file);
              item.ctime = ctime;
              this.addItem(item);
              changed = true;
            }
            if (changed) this._onItemsChanged(true);
          }
        } catch (e) { console.log(e); }
      });
    }
  };

  proto.onUserEnable = function () {
    this.initLeaf();
  };

  proto.initLeaf = function () {
    this.app.workspace.ensureSideLeaf(ng08BM_VIEW_TYPE, "left", { reveal: false });
  };

  proto.onExternalSettingsChange = async function () {
    // the watcher also fires for our own writes while they are still flushing through the
    // vault queue; give in-flight saves a moment so disk and memory agree before reloading
    await new Promise((resolve) => setTimeout(resolve, 200));
    const data = await this.plugin.loadData();
    const diskItems = data && Array.isArray(data.items) ? data.items : [];
    // the config watcher also fires after our own writes; keep live item objects when nothing changed
    if (JSON.stringify(diskItems) === JSON.stringify(this.items || [])) {
      this.rebuildBookmarkCache();
      return;
    }
    this.hasValidData = data !== undefined;
    this.items = this._reconcileLoaded(diskItems);
    this._linkParents(this.items, null);
    this.rebuildBookmarkCache();
    this.trigger("changed");
  };

  // ---------- menus ----------

  proto.onEditorMenu = function (menu, editor, view) {
    const file = view && view.file;
    if (!file) return;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const headingText = line && firstHeadingText(line);
    if (!headingText) return;
    const self = this;
    menu.addItem((item) =>
      item
        .setSection("action")
        .setIcon("lucide-bookmark")
        .setTitle(t().menuOptBookmarkHeading())
        .onClick(() => {
          const bm = ng08BookmarkItemForFile(file, "#" + linkSafeHeading(headingText));
          new ng08Bm.BookmarkEditModal(self, bm, false).open();
        })
    );
  };

  proto.onFileMenu = function (menu, file, source, leaf) {
    if (!file) return;
    if (file instanceof fileClass("TFolder") && !file.parent) return;
    const self = this;
    const isFolder = file instanceof fileClass("TFolder");
    const existing = this.bookmarkLookup[file.path];
    const title = existing ? t().actionEditBookmark() : t().actionBookmark();
    menu.addItem((item) =>
      item
        .setSection("action")
        .setIcon("lucide-bookmark")
        .setTitle(title)
        .onClick(() => {
          if (existing) {
            new ng08Bm.BookmarkEditModal(self, existing, true).open();
          } else {
            const bm = isFolder ? ng08BookmarkItemForFolder(file) : ng08BookmarkItemForFile(file);
            new ng08Bm.BookmarkEditModal(self, bm, false).open();
          }
        })
    );
  };

  proto.onFilesMenu = function (menu, files) {
    if (!files || !files.length) return;
    const items = ng08FilesToBookmarkItems(files);
    if (!items.length) return;
    const self = this;
    menu.addItem((item) =>
      item
        .setSection("action")
        .setIcon("lucide-bookmark")
        .setTitle(t().actionBookmark())
        .onClick(() => new ng08Bm.BookmarkManyModal(self.app, self, items).open())
    );
  };

  proto.onLeafMenu = function (menu, leaf) {
    const view = leaf && leaf.view;
    if (!view) return;
    const self = this;
    if (view instanceof host.GraphView) {
      menu.addItem((item) =>
        item.setSection("action").setIcon("lucide-bookmark").setTitle(t().actionBookmark()).onClick(() => {
          const bm = ng08BookmarkItemForGraph(view.dataEngine.getOptions());
          new ng08Bm.BookmarkEditModal(self, bm, false).open();
        })
      );
    } else if (view instanceof host.WebViewerView) {
      const url = view.url;
      const existing = this.urlBookmarkLookup[url];
      menu.addItem((item) =>
        item.setSection("action").setIcon("lucide-bookmark").setTitle(existing ? t().actionEditBookmark() : t().actionBookmark()).onClick(() => {
          if (existing) new ng08Bm.BookmarkEditModal(self, existing, true).open();
          else new ng08Bm.BookmarkEditModal(self, ng08BookmarkItemForUrl(url, view.title || view.getDisplayText()), false).open();
        })
      );
    }
  };

  proto.onTabGroupMenu = function (menu) {
    const app = this.app;
    const items = [];
    app.workspace.iterateAllLeaves((leaf) => {
      const item = ng08ViewToBookmarkItem(leaf);
      if (item) items.push(item);
    });
    if (!items.length) return;
    const self = this;
    menu.addItem((item) =>
      item.setSection("action").setIcon("lucide-bookmark").setTitle(t().actionBookmarkTabGroup({ count: items.length })).onClick(() => {
        new ng08Bm.BookmarkManyModal(app, self, items).open();
      })
    );
  };

  proto.onSearchResultsMenu = function (menu, results) {
    const query = results && results.getQuery ? results.getQuery() : this._searchQuery();
    if (!query) return;
    const self = this;
    menu.addItem((item) =>
      item.setSection("action").setIcon("lucide-bookmark").setTitle(t().actionBookmark()).onClick(() => {
        new ng08Bm.BookmarkEditModal(self, ng08BookmarkItemForSearch(query), false).open();
      })
    );
  };

  // ---------- misc plugin behavior ----------

  proto.onFileRename = function (file, oldPath) {
    if (!file) return;
    let changed = false;
    ng08WalkBookmarkItems(this.items, (item) => {
      if ((item.type === "file" || item.type === "folder") && item.path === oldPath) {
        item.path = file.path;
        changed = true;
      }
    });
    if (changed) this.onItemsChanged(true);
  };

  proto.updateTabHeaders = function () {
    const app = this.app;
    const self = this;
    const tt = ng08BmT2();
    app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof host.ItemView)) return;
      let button = self.bookmarkedViews.get(view);
      if (!button) {
        button = view.addAction("lucide-bookmark", tt.labelBookmark(), () => {
          const existing = self.findBookmarkByView(view);
          const item = existing || ng08ViewToBookmarkItem(leaf);
          if (item) new ng08Bm.BookmarkEditModal(self, item, !!existing).open();
        });
        button.addClass("mod-bookmark");
        self.bookmarkedViews.set(view, button);
      }
      const existing = self.findBookmarkByView(view);
      button.toggleClass("mod-bookmarked", !!existing);
      button.toggleClass("mod-filled", !!existing);
      host.setTooltip(button, existing ? tt.labelBookmarked() : tt.labelBookmark());
    });
  };

  // ---------- CLI ----------

  proto._bookmarkValue = function (item) {
    if (item.type === "file") return item.path + (item.subpath || "");
    if (item.type === "folder") return item.path;
    if (item.type === "search") return item.query;
    if (item.type === "url") return item.url;
    return "";
  };

  proto.cliBookmarks = function (args) {
    const app = this.app;
    const items = [];
    ng08WalkBookmarkItems(this.items, (item) => { items.push(item); });
    if (args.total) return String(items.length);
    if (!items.length) return "No bookmarks found.";
    if (args.format === "json") {
      return JSON.stringify(items.map((i) => ({ type: i.type, value: this._bookmarkValue(i), title: this.getItemTitle(i) })), null, 2);
    }
    if (args.verbose) {
      const rows = [["type", "value", "title"]];
      for (const item of items) rows.push([item.type, this._bookmarkValue(item), this.getItemTitle(item) || ""]);
      return app.cli.formatTable(rows);
    }
    const rows = items.map((item) => {
      const title = this.getItemTitle(item);
      const value = this._bookmarkValue(item);
      return title ? `[${item.type}] ${title}` : value;
    });
    return rows.join("\n");
  };

  proto.cliBookmark = function (args) {
    const app = this.app;
    const title = args.title;
    let item = null;
    if (args.url) {
      item = ng08BookmarkItemForUrl(args.url);
    } else if (args.search) {
      item = ng08BookmarkItemForSearch(args.search);
      if (title) item.title = title;
    } else if (args.folder) {
      const folder = app.vault.getAbstractFileByPath(args.folder);
      if (!folder) throw "Folder not found: " + args.folder;
      item = ng08BookmarkItemForFolder(folder);
      if (title) item.title = title;
    } else {
      const file = app.cli.tryResolveFile(args);
      if (!file) throw "File not found.";
      item = ng08BookmarkItemForFile(file);
      if (title) item.title = title;
    }
    this.addItem(item);
    return "Bookmark added.";
  };

  return BookmarksPlugin;
}