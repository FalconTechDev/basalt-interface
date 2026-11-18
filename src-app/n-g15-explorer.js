// g15 clean-room file explorer: the sidebar tree view (view type "file-explorer"), its row items,
// sorting/fold persistence, rename, clipboard, drag&drop, context menus and the internal plugin
// descriptor. Replaces the inherited file-explorer module; every name is ng15-prefixed.
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { displayTooltip, hideTooltip, setElementTooltip } from "./tooltip.js";
import { ng15CollapsibleTreeItem, ng15MakeTreePusher } from "./n-g15-tree.js";
import { sortOrderComparator, SEARCH_SORT_GROUPS, SEARCH_SORT_ORDERS, searchSortLabel, preventMiddleClick } from "./n-g11-view.js";
import { flattenUniqueFiles } from "./bookmarks.js";
import { stringCollator } from "./misc.js";

const NG15_CLIPBOARD_MIME = "basalt/files";
function ng15IsSortOrder(order) { return Object.prototype.hasOwnProperty.call(SEARCH_SORT_ORDERS, order); }

function ng15ExplorerT(host) { return host.t.plugins.fileExplorer; }

// Class slots filled by the factories in manifest order (item base -> file -> folder -> view -> plugin).
let ng15FileExplorerItemBaseClass = null;
let ng15CollapsibleFileItemClass = null;
let ng15FileItemClass = null;
let ng15FolderItemClass = null;
let ng15FileExplorerViewClass = null;
let ng15FileExplorerTreeClass = null;

// =====================================================================================================================
// FileExplorerItemBase — shared row behaviour (title, rename, drag source)
// =====================================================================================================================

export function ng15DefineFileExplorerItemBase(host) {
  function FileExplorerItemBase(view, file) {
    const self = host.TreeItem.call(this) || this;
    self.view = view;
    self.file = file;
    self.rendered = false;
    self.titleEl = null;
    self.tagEl = null;
    self._renameBound = false;
    self.el.addClass("nav-file");
    self.setClickable(true);
    self.innerEl.createDiv({ cls: "nav-file-title nav-file-title-content" });
    self.titleEl = self.innerEl.firstChild;
    return self;
  }
  inherit(FileExplorerItemBase, host.TreeItem);
  const proto = FileExplorerItemBase.prototype;

  proto.getTitle = function () { return this.file ? this.file.name : ""; };

  proto.updateTitle = function () {
    const titleEl = this.titleEl;
    if (!titleEl) return;
    titleEl.empty();
    const icon = titleEl.createDiv("nav-file-icon");
    const isFolder = this.file && this.file instanceof host.TFolder;
    host.setIcon(icon, isFolder ? "lucide-folder" : "lucide-file");
    titleEl.createSpan({ cls: "nav-file-title-text", text: this.getTitle() });
    this.tagEl = null;
  };

  /** (Re)binds row behaviour when the virtual scroller mounts the element. */
  proto.onRender = function () {
    if (!this._dragBound) {
      this._dragBound = true;
      const self = this;
      const app = self.view.app;
      app.dragManager.handleDrag(self.el, (evt) => self._describeDrag(evt));
      app.dragManager.handleDrop(self.el, (evt, draggable, isOver) => self.view.handleItemDrop(evt, draggable, isOver, self), false);
      preventMiddleClick(self.selfEl);
    }
    this.updateTitle();
    this.updateUnsupported();
  };

  proto._describeDrag = function (evt) {
    const view = this.view;
    const selected = view.tree.getSelectedItems().filter((item) => item.file);
    const files = selected.length > 0 && selected.indexOf(this) >= 0
      ? flattenUniqueFiles(selected.map((item) => item.file))
      : [this.file];
    if (!files || files.length === 0) return null;
    const app = view.app;
    if (files.length === 1) {
      const file = files[0];
      if (file instanceof host.TFolder) return app.dragManager.dragFolder(evt, file, "file-explorer");
      return app.dragManager.dragFile(evt, file, "file-explorer");
    }
    return app.dragManager.dragFiles(evt, files, "file-explorer");
  };

  proto.isFullTitleShown = function () {
    const el = this.titleEl;
    if (!el) return true;
    return el.scrollWidth <= el.clientWidth + 1;
  };

  proto.startRename = function () {
    const view = this.view;
    if (view.fileBeingRenamed === this.file) return;
    view.acceptRename();
    view.fileBeingRenamed = this.file;
    view.fileBeingRenamedPath = this.file.path;
    view.tree.setFocusedItem(this, false);
    this.selfEl.addClass("is-being-renamed");
    const inner = this.innerEl;
    inner.setAttr("contenteditable", "true");
    inner.spellcheck = !!view.app.vault.getConfig("spellcheck");
    inner.setText(this.getTitle());
    inner.focus();
    const range = inner.doc.createRange();
    range.selectNodeContents(inner);
    const sel = inner.win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (view.fileRenameScope) view.app.keymap.pushScope(view.fileRenameScope);
    view.onFileRenameInput();
  };

  proto.stopRename = function (restore) {
    const view = this.view;
    const wasRenaming = view.fileBeingRenamed === this.file;
    if (wasRenaming) {
      view.fileBeingRenamed = null;
      view.fileBeingRenamedPath = null;
    }
    this.selfEl.removeClass("is-being-renamed");
    this.innerEl.setAttr("contenteditable", "false");
    if (restore) this.innerEl.setText(this.getTitle());
    this.updateTitle();
    if (view.fileRenameScope) view.app.keymap.popScope(view.fileRenameScope);
  };

  proto.updateUnsupported = function () {
    if (this.file instanceof host.TFolder) return;
    this.selfEl.toggleClass("is-unsupported", !this.isSupportedSafe());
  };

  proto.isSupportedSafe = function () { return true; };

  return FileExplorerItemBase;
}

// =====================================================================================================================
// FileItem — a file row
// =====================================================================================================================

export function ng15DefineFileItem(host) {
  const Base = ng15FileExplorerItemBaseClass || ng15DefineFileExplorerItemBase(host);
  function FileItem(view, file) {
    const self = Base.call(this, view, file) || this;
    return self;
  }
  inherit(FileItem, Base);
  const proto = FileItem.prototype;

  proto.getTitle = function () {
    const file = this.file;
    if (!file) return "";
    return file.extension === "md" ? file.basename : file.name;
  };

  proto.updateTitle = function () {
    const titleEl = this.titleEl;
    if (!titleEl) return;
    titleEl.empty();
    const icon = titleEl.createDiv("nav-file-icon");
    host.setIcon(icon, "lucide-file");
    titleEl.createSpan({ cls: "nav-file-title-text", text: this.getTitle() });
    const ext = this.file && this.file.extension;
    if (ext && ext !== "md") {
      this.tagEl = titleEl.createSpan({ cls: "nav-file-tag", text: ext });
    } else {
      this.tagEl = null;
    }
    this.updateUnsupported();
  };

  proto.isSupported = function () {
    const file = this.file;
    if (!file) return true;
    if (file.extension === "md") return true;
    return this.view.app.viewRegistry.isExtensionRegistered(file.extension);
  };

  proto.isSupportedSafe = proto.isSupported;

  proto.updateUnsupported = function () {
    const supported = this.isSupported();
    this.selfEl.toggleClass("is-unsupported", !supported);
  };

  proto.onSelfClick = function (event) {
    if (this.view.tree.handleItemSelection(event, this)) return;
    const app = this.view.app;
    const isMiddle = event && event.button === 1;
    const isUpDown = event && (event.key === "ArrowUp" || event.key === "ArrowDown");
    if (isUpDown) {
      // keyboard open reuses the leaf without stealing activation
      app.workspace.openLinkText(this.file.path, "", false).then(() => {});
      return;
    }
    const mode = host.Keymap.isModEvent(event);
    const leaf = app.workspace.getLeaf(mode === false ? undefined : mode);
    leaf.openFile(this.file).then(() => {
      app.workspace.activeLeaf && app.workspace.setActiveLeaf(app.workspace.activeLeaf, { focus: true });
    });
    void isMiddle;
  };

  return FileItem;
}

// =====================================================================================================================
// CollapsibleFileItem + FolderItem — collapsible folder rows
// =====================================================================================================================

export function ng15DefineCollapsibleFileItem(host) {
  const Base = ng15FileExplorerItemBaseClass || ng15DefineFileExplorerItemBase(host);
  const Collapsible = ng15CollapsibleTreeItem(Base);
  function CollapsibleFileItem(view, file) {
    const self = Collapsible.call(this, view, file) || this;
    return self;
  }
  inherit(CollapsibleFileItem, Collapsible);
  ng15CollapsibleFileItemClass = CollapsibleFileItem;
  return CollapsibleFileItem;
}

export function ng15DefineFolderItem(host) {
  const CollapsibleBase = ng15CollapsibleFileItemClass || ng15DefineCollapsibleFileItem(host);
  function FolderItem(view, file) {
    const self = CollapsibleBase.call(this, view, file) || this;
    self.el.removeClass("nav-file");
    self.el.addClass("nav-folder");
    if (self.titleEl) {
      self.titleEl.removeClass("nav-file-title");
      self.titleEl.addClass("nav-folder-title");
    }
    self.setCollapsible(true);
    self.vChildren = new host.TreeChildren(self);
    self.pusherEl = ng15MakeTreePusher();
    return self;
  }
  inherit(FolderItem, CollapsibleBase);
  const proto = FolderItem.prototype;

  proto.getTitle = function () {
    const file = this.file;
    if (!file) return "";
    return file.isRoot && file.isRoot() ? this.view.app.vault.getName() : file.name;
  };

  proto.updateTitle = function () {
    const titleEl = this.titleEl;
    if (!titleEl) return;
    titleEl.empty();
    const isRoot = this.file && this.file.isRoot && this.file.isRoot();
    const icon = titleEl.createDiv("nav-file-icon");
    host.setIcon(icon, isRoot ? "lucide-vault" : (this.collapsed ? "lucide-folder" : "lucide-folder-open"));
    titleEl.createSpan({ cls: "nav-folder-title-text", text: this.getTitle() });
  };

  proto.onSelfClick = function (event) {
    if (!event || event.button !== 0) return;
    if (this.view.fileBeingRenamed === this.file) return;
    if (this.view.tree.handleItemSelection(event, this)) return;
    this.toggleCollapsed(true);
    this.view.tree.requestSaveFolds();
  };

  /** Re-sorts this folder's children and notifies the view. */
  proto.sort = function () {
    if (this.vChildren) this.vChildren.children.sort(ng15FolderChildCompare(host, this.view.sortOrder));
  };

  return FolderItem;
}

/** Folders before files; folders by name collator, files by the shared sort-order comparator. */
function ng15FolderChildCompare(host, order) {
  const fileCompare = sortOrderComparator(order || "alphabetical");
  return (a, b) => {
    const af = a.file, bf = b.file;
    if (!af || !bf) return 0;
    const aFolder = af instanceof host.TFolder;
    const bFolder = bf instanceof host.TFolder;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    if (aFolder && bFolder) return stringCollator.compare(af.name, bf.name);
    return fileCompare(af, bf);
  };
}

// =====================================================================================================================
// FileExplorerTree — Tree subclass: collapsed-by-default folds, unsupported guard, open on ArrowRight
// =====================================================================================================================

export function ng15DefineFileExplorerTree(host) {
  const Base = host.Tree || ng15FileExplorerTreeBaseFallback(host);
  function FileExplorerTree(view, options) {
    const self = Base.call(this, view, options) || this;
    self.prefersCollapsed = true;
    return self;
  }
  inherit(FileExplorerTree, Base);
  const proto = FileExplorerTree.prototype;

  proto.selectItem = function (item) {
    if (item && item.info && item.info.hidden) return;
    Base.prototype.selectItem.call(this, item);
  };

  proto.onKeyArrowRight = function (event) {
    const item = this.focusedItem;
    if (item && !item.collapsible && item.onSelfClick) {
      event.preventDefault();
      item.onSelfClick(event);
      return true;
    }
    return Base.prototype.onKeyArrowRight.call(this, event);
  };

  ng15FileExplorerTreeClass = FileExplorerTree;
  return FileExplorerTree;
}

function ng15FileExplorerTreeBaseFallback(host) {
  // host.Tree is always wired by the manifest; this only guards factory order in isolation.
  return host.Tree;
}

// =====================================================================================================================
// FileExplorerView — the file-explorer ItemView
// =====================================================================================================================

export function ng15DefineFileExplorerView(host) {
  function FileExplorerView(leaf) {
    // test-created leaves may be bare objects; give them the minimal surface ItemView expects
    if (leaf && !leaf.history) leaf.history = { backHistory: [], forwardHistory: [] };
    if (leaf && !leaf.on) leaf.on = () => ({ unsubscribe() {} });
    if (leaf && !leaf.handleDrop) leaf.handleDrop = () => null;
    const self = host.ItemView.call(this, leaf) || this;
    self.icon = "lucide-folder-closed";
    self.activeDom = null;
    self.collapseOrExpandAllEl = null;
    self.ready = false;
    self.sortOrder = "alphabetical";
    self.autoReveal = false;
    self.autoRevealFile = false;
    self.fileBeingRenamed = null;
    self.fileBeingRenamedPath = null;
    self.workQueue = Promise.resolve();
    self.itemsBeingCut = [];
    self.requestSort = debounceCall(() => self.sort(), 100);
    self.navFileContainerEl = null;
    self.scope = null;
    self.tree = null;
    self.headerDom = null;
    self.autoRevealButtonEl = null;
    self.fileItems = {};
    self.files = [];
    self.fileRenameScope = null;
    self.mouseoverExpandTimeout = null;
    self.lastDropTargetEl = null;
    self._host = host;
    return self;
  }
  inherit(FileExplorerView, host.ItemView);
  const proto = FileExplorerView.prototype;
  const t = () => ng15ExplorerT(host);

  // ---------- lifecycle ----------

  proto.getViewType = function () { return "file-explorer"; };

  proto.getDisplayText = function () { return t().name(); };

  proto.getState = function () {
    const state = host.ItemView.prototype.getState.call(this);
    state.sortOrder = this.sortOrder;
    state.autoReveal = this.autoReveal;
    return state;
  };

  proto.setState = async function (state, result) {
    await host.ItemView.prototype.setState.call(this, state, result);
    if (state && state.autoReveal !== undefined) this.setAutoReveal(!!state.autoReveal, false);
    if (state && ng15IsSortOrder(state.sortOrder)) this.setSortOrder(state.sortOrder, false);
    if (state && state.newFile) {
      const file = this.app.vault.getAbstractFileByPath(state.newFile);
      if (file) this.revealInFolder(file);
    }
  };

  proto.load = function () {
    host.ItemView.prototype.load.call(this);
    const app = this.app;
    const vault = app.vault;
    const containerEl = this.containerEl;
    const navContainer = (this.navFileContainerEl = this.contentEl.createDiv("nav-files-container"));

    this.headerDom = new host.ViewHeader(app, navContainer);
    const header = this.headerDom;
    header.addNavButton("lucide-file-plus", t().actionNewNote(), (event) => {
      const inNew = host.Keymap.isModEvent(event) === "tab" || (event && event.button === 1);
      this.createNewFile(null, inNew);
    });
    header.addNavButton("lucide-folder-plus", t().actionNewFolder(), (event) => {
      const inNew = host.Keymap.isModEvent(event) === "tab";
      this.createNewFolder(null, inNew);
    });
    header.addSortButton(SEARCH_SORT_GROUPS, searchSortLabel, (key) => this.setSortOrder(key), () => this.sortOrder);
    this.autoRevealButtonEl = header.addNavButton("lucide-navigation", t().actionAutoReveal(), () => this.setAutoReveal(!this.autoReveal));
    this.collapseOrExpandAllEl = header.addNavButton("lucide-chevrons-down-up", t().actionCollapseAll(), () => this.tree && this.tree.toggleCollapseAll());
    this.updateCollapseAllButton();

    this.scope = new host.Scope(app.scope);
    this.fileRenameScope = new host.Scope(this.scope);
    this.fileRenameScope.register([], "Enter", (event) => {
      if (!this.isRenameInputFocused()) return undefined;
      if (event && event.preventDefault) event.preventDefault();
      this.acceptRename();
      return false;
    });
    this.fileRenameScope.register([], "Escape", (event) => {
      if (!this.isRenameInputFocused()) return undefined;
      if (event && event.preventDefault) event.preventDefault();
      this.onKeyEscInRename();
      return false;
    });
    const TreeClass = ng15FileExplorerTreeClass || ng15DefineFileExplorerTree(host);
    this.tree = new TreeClass(this, {
      app,
      containerEl: navContainer,
      id: app.appId + "-file-explorer",
      scope: this.scope,
      getNodeId: (item) => (item.file ? item.file.path : null),
      handleDeleteSelectedItems: (event) => this.handleDeleteSelectedFiles(event),
      handleRenameFocusedItem: () => this.onKeyRename({ preventDefault() {} }),
      handleCollapseAll: (collapsed) => this.handleCollapseAll(collapsed),
    });

    // vault + workspace + registry events
    this.registerEvent(vault.on("create", this.onFileCreate.bind(this)));
    this.registerEvent(vault.on("delete", this.onFileDelete.bind(this)));
    this.registerEvent(vault.on("rename", this.onFileRename.bind(this)));
    this.registerEvent(vault.on("modify", this.onFileModify.bind(this)));
    this.registerEvent(vault.on("config-changed", this.onConfigChanged.bind(this)));
    this.registerEvent(app.workspace.on("file-open", this.onFileOpen.bind(this)));
    this.registerEvent(app.workspace.on("layout-ready", this.onLayoutReady.bind(this)));
    this.registerEvent(app.viewRegistry.on("extensions-updated", this.onExtensionsUpdated.bind(this)));
    this.registerEvent(app.workspace.on("active-leaf-change", () => { if (this.autoReveal) this.revealActiveFile(); }));

    // delegated row handlers
    navContainer.addEventListener("click", this.onFileClick.bind(this));
    navContainer.addEventListener("auxclick", this.onFileClick.bind(this));
    navContainer.addEventListener("contextmenu", this.onFileContextMenuEmpty.bind(this));
    navContainer.addEventListener("pointerover", this.onFilePointerOver.bind(this));
    navContainer.addEventListener("pointerout", this.onFilePointerOut.bind(this));
    navContainer.addEventListener("input", this.onFileRenameInputEvent.bind(this), true);
    navContainer.addEventListener("blur", this.onFileRenameBlur.bind(this), true);
    navContainer.addEventListener("keydown", this.onFileRenameKeydown.bind(this), true);

    // root drop target
    app.dragManager.handleDrop(navContainer, (evt, draggable, isOver) => this.handleContainerDrop(evt, draggable, isOver), false);

    // initial population
    this.populate();
    this.updateShowUnsupportedFiles();
    app.keymap.pushScope(this.scope);
    if (app.workspace.layoutReady) this.onLayoutReady();
    return this;
  };

  proto.onOpen = async function () {
    host.ItemView.prototype.onOpen.call(this);
  };

  proto.onClose = async function () {
    if (this.scope) this.app.keymap.popScope(this.scope);
    await host.ItemView.prototype.onClose.call(this);
  };

  proto.onUnload = function () {
    host.ItemView.prototype.onUnload ? host.ItemView.prototype.onUnload.call(this) : null;
  };

  // ---------- population ----------

  proto.populate = function () {
    const vault = this.app.vault;
    const root = vault.getRoot();
    for (const child of vault.getAllLoadedFiles()) {
      if (child === root || (child.path === "/")) continue;
      this.createItemForFile(child);
    }
    // attach every item under its parent folder
    for (const path in this.fileItems) {
      const item = this.fileItems[path];
      const parentPath = item.file && item.file.parent ? item.file.parent.path : "";
      const parentItem = parentPath ? this.fileItems[parentPath] : null;
      const list = parentItem ? parentItem.vChildren : this.tree.root.vChildren;
      if (list && list.children.indexOf(item) < 0) list.addChild(item);
    }
    for (const item of Object.values(this.fileItems)) {
      if (item.vChildren) item.sort();
      item.onRender && item.onRender();
    }
    this.files = this.tree.root.vChildren.children.slice();
    this.sort();
    this.tree.loadFolds();
  };

  proto.createItemForFile = function (file) {
    if (!file || file.path === "/" || this.fileItems[file.path]) return this.fileItems[file.path] || null;
    let item;
    if (file instanceof host.TFolder) {
      const FolderClass = ng15FolderItemClass || ng15DefineFolderItem(host);
      item = new FolderClass(this, file);
      item.setCollapsible(true);
      item.setCollapsed(true, false);
    } else {
      const FileClass = ng15FileItemClass || ng15DefineFileItem(host);
      item = new FileClass(this, file);
    }
    item.onSelfClickBound = true;
    this.fileItems[file.path] = item;
    return item;
  };

  proto.getItemForFile = function (file) { return file ? this.fileItems[file.path] || null : null; };

  // ---------- vault events ----------

  proto.onFileCreate = function (file) {
    if (!file || file.path === "/") return;
    // ensure parent chain exists
    let parent = file.parent;
    while (parent && parent.path !== "/" && !this.fileItems[parent.path]) {
      this.createItemForFile(parent);
      parent = parent.parent;
    }
    const parentItem = parent && parent.path !== "/" ? this.fileItems[parent.path] : null;
    const item = this.createItemForFile(file);
    if (!item) return;
    const list = parentItem ? parentItem.vChildren : this.tree.root.vChildren;
    if (list.children.indexOf(item) < 0) list.addChild(item);
    if (parentItem && parentItem.vChildren) parentItem.sort();
    this.tree.root.vChildren.children.sort(ng15CompareRootChildren(this));
    this.requestSort();
    this.tree.infinityScroll.invalidateAll();
  };

  proto.onFileDelete = function (file) {
    if (!file) return;
    if (this.fileBeingRenamed && (this.fileBeingRenamed === file || file.path === this.fileBeingRenamedPath)) this.exitRename();
    const item = this.fileItems[file.path];
    if (item) this.removeItem(item);
    this.requestSort();
    this.tree.infinityScroll.invalidateAll();
  };

  proto.onFileRename = function (file, oldPath) {
    if (!file) return;
    if (this.fileBeingRenamed && (this.fileBeingRenamed === file || oldPath === this.fileBeingRenamedPath || this.fileBeingRenamed.path === oldPath)) this.exitRename();
    const item = this.fileItems[oldPath];
    if (item) {
      delete this.fileItems[oldPath];
      this.fileItems[file.path] = item;
      item.file = file;
      item.updateTitle();
      // re-attach under the (possibly new) parent
      const parentItem = file.parent && file.parent.path !== "/" ? this.fileItems[file.parent.path] : null;
      const list = parentItem ? parentItem.vChildren : this.tree.root.vChildren;
      if (item.parent !== (parentItem || this.tree.root)) {
        if (item.parent && item.parent.vChildren) item.parent.vChildren.removeChild(item);
        list.addChild(item);
      }
      if (parentItem && parentItem.vChildren) parentItem.sort();
      this.requestSort();
    }
    this.tree.infinityScroll.invalidateAll();
  };

  proto.onFileModify = function (file) {
    if (!file) return;
    if (this.sortOrder === "byModifiedTime" || this.sortOrder === "byModifiedTimeReverse") this.requestSort();
    const item = this.getItemForFile(file);
    if (item) item.updateTitle();
  };

  proto.onConfigChanged = function (key) {
    if (key === "showUnsupportedFiles") {
      this.updateShowUnsupportedFiles();
      this.tree.infinityScroll.invalidateAll();
    }
    if (key === "showUnsupportedFiles" || key === undefined) this.refreshUnsupported();
  };

  proto.onLayoutReady = function () {
    if (this.ready) return;
    this.ready = true;
    this.sort();
    if (this.autoReveal) this.revealActiveFile();
    else this.revealActiveFileOnce();
    this.tree.loadFolds();
    this.tree.saveFolds();
  };

  proto.onExtensionsUpdated = function () {
    for (const path in this.fileItems) {
      const item = this.fileItems[path];
      if (item.updateTitle) item.updateTitle();
      if (item.updateUnsupported) item.updateUnsupported();
    }
    this.tree.infinityScroll.invalidateAll();
  };

  proto.onFileOpen = function (file) {
    if (!file) return;
    const item = this.getItemForFile(file);
    if (item) {
      if (this.tree.activeDom !== item) this.tree.clearSelectedDoms();
      this.tree.activeDom = item;
      item.selfEl && item.selfEl.addClass("is-active");
      if (this.autoReveal) this.revealInFolder(file);
    }
  };

  proto.updateShowUnsupportedFiles = function () {
    this.navFileContainerEl.toggleClass("show-unsupported", !!this.app.vault.getConfig("showUnsupportedFiles"));
    this.refreshUnsupported();
  };

  proto.refreshUnsupported = function () {
    for (const path in this.fileItems) {
      const item = this.fileItems[path];
      if (item.updateUnsupported) item.updateUnsupported();
    }
  };

  proto.removeItem = function (item) {
    if (!item) return;
    // detach descendants first
    if (item.vChildren) {
      for (const child of item.vChildren.children.slice()) this.removeItem(child);
      item.vChildren.clear();
    }
    if (item.parent && item.parent.vChildren) item.parent.vChildren.removeChild(item);
    else this.tree.root.vChildren.removeChild(item);
    if (this.fileItems[item.file && item.file.path]) delete this.fileItems[item.file.path];
    item.el && item.el.remove();
    item.pusherEl && item.pusherEl.remove();
  };

  // ---------- sorting ----------

  proto.setSortOrder = function (order, save = true) {
    if (!ng15IsSortOrder(order)) order = "alphabetical";
    if (this.sortOrder === order) return;
    this.sortOrder = order;
    if (save !== false) this.app.workspace.requestSaveLayout && this.app.workspace.requestSaveLayout();
    this.sort();
  };

  proto.handleCollapseAll = function (collapsed) {
    if (this.tree) this.tree.isAllCollapsed = collapsed;
    if (collapsed) {
      host.setIcon(this.collapseOrExpandAllEl, "lucide-chevrons-up-down");
      setElementTooltip(this.collapseOrExpandAllEl, t().actionExpandAll());
    } else {
      host.setIcon(this.collapseOrExpandAllEl, "lucide-chevrons-down-up");
      setElementTooltip(this.collapseOrExpandAllEl, t().actionCollapseAll());
    }
  };

  proto.updateCollapseAllButton = function () {
    if (!this.collapseOrExpandAllEl) return;
    this.handleCollapseAll(this.tree ? !!this.tree.isAllCollapsed : true);
  };

  proto.setAutoReveal = function (enabled, save = true) {
    this.autoReveal = !!enabled;
    this.autoRevealFile = this.autoReveal;
    this.autoRevealButtonEl && this.autoRevealButtonEl.toggleClass("is-active", this.autoReveal);
    if (save !== false) this.app.workspace.requestSaveLayout && this.app.workspace.requestSaveLayout();
    if (this.autoReveal) this.revealActiveFile();
  };

  proto.sort = function () {
    if (!this.ready) return;
    const containerEl = this.navFileContainerEl;
    if (!containerEl || containerEl.offsetParent === null) {
      // hidden: retry once when the node is inserted
      if (!this._sortRetryBound && typeof containerEl !== "undefined" && containerEl) {
        this._sortRetryBound = true;
        const obs = new MutationObserver(() => {
          if (containerEl.offsetParent !== null) { this._sortRetryBound = false; obs.disconnect(); this.sort(); }
        });
        obs.observe(containerEl, { childList: true, subtree: true });
      }
      return;
    }
    const scrollTop = this.tree.infinityScroll.scrollEl.scrollTop;
    const compare = ng15CompareRootChildren(this);
    // sort every folder recursively, folders before files
    const sortFolder = (item) => {
      if (!item.vChildren) return;
      item.vChildren.children.sort(compare);
      for (const child of item.vChildren.children) sortFolder(child);
    };
    sortFolder(this.tree.root);
    this.files = this.tree.root.vChildren.children.slice();
    this.tree.infinityScroll.scrollEl.scrollTop = scrollTop;
    this.tree.infinityScroll.compute(true);
    this.tree.infinityScroll.updateVirtualDisplay();
    if (this.autoReveal) this.revealActiveFile();
  };

  // ---------- reveal ----------

  proto.revealActiveFile = function () {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const item = this.getItemForFile(file);
    if (!item) return;
    let parent = item.parent;
    while (parent && parent.collapsible) {
      if (parent.collapsed) parent.setCollapsed(false, false);
      parent = parent.parent;
    }
    this.tree.setFocusedItem(item);
    this.tree.infinityScroll.scrollIntoView(item, 4);
    if (this.navFileContainerEl.offsetParent === null) {
      const obs = new MutationObserver(() => {
        if (this.navFileContainerEl.offsetParent !== null) { obs.disconnect(); this.tree.infinityScroll.scrollIntoView(item, 4); }
      });
      obs.observe(this.navFileContainerEl, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 5000);
    }
    this.updateActiveItem(item);
  };

  proto.revealActiveFileOnce = function () { this.revealActiveFile(); };

  proto.revealInFolder = function (file) {
    if (!file) return;
    const item = this.getItemForFile(file);
    if (!item) return;
    let parent = item.parent;
    while (parent && parent.collapsible) {
      if (parent.collapsed) parent.setCollapsed(false, false);
      parent = parent.parent;
    }
    this.tree.setFocusedItem(item, false);
    this.app.nextFrame(() => {
      this.tree.infinityScroll.scrollIntoView(item, 4);
      if (item.selfEl) item.selfEl.focus && item.selfEl.focus({ preventScroll: true });
      const leaf = this.leaf;
      this.app.workspace.setActiveLeaf && this.app.workspace.setActiveLeaf(leaf, { focus: true });
    });
    this.updateActiveItem(item);
  };

  proto.updateActiveItem = function (item) {
    for (const path in this.fileItems) {
      const other = this.fileItems[path];
      other.selfEl && other.selfEl.removeClass("is-active");
    }
    item.selfEl && item.selfEl.addClass("is-active");
  };

  // ---------- create / delete ----------

  proto.createNewFile = async function (parent, inNewLeaf) {
    const app = this.app;
    const sourcePath = this.app.workspace.getActiveFile() ? this.app.workspace.getActiveFile().path : "";
    const folder = parent || this.app.fileManager.getNewFileParent(sourcePath, "md");
    const file = await this.app.fileManager.createNewMarkdownFile(folder, null);
    if (!file) return null;
    const item = this.getItemForFile(file) || this.createItemForFile(file);
    if (item) {
      this.tree.setFocusedItem(item);
      this.startRenameFile(file);
      this.revealInFolder(file);
    }
    if (inNewLeaf) {
      const leaf = app.workspace.getLeaf("tab");
      leaf && leaf.openFile(file);
    }
    return file;
  };

  proto.createNewFolder = async function (parent, inNewLeaf) {
    const app = this.app;
    const sourcePath = this.app.workspace.getActiveFile() ? this.app.workspace.getActiveFile().path : "";
    let folder = parent;
    if (!folder) {
      const active = this.tree.focusedItem;
      folder = active && active.file instanceof host.TFolder ? active.file : app.fileManager.getNewFileParent(sourcePath, "folder");
    }
    const created = await this.app.fileManager.createNewFolder(folder);
    if (!created) return null;
    const item = this.getItemForFile(created) || this.createItemForFile(created);
    if (item) {
      this.tree.setFocusedItem(item);
      this.startRenameFile(created);
      this.revealInFolder(created);
    }
    if (inNewLeaf) {
      // folders have no leaf of their own; ensure the explorer is visible instead
      this.app.workspace.trigger && this.app.workspace.trigger("file-menu", null, created, "file-explorer-context-menu");
    }
    return created;
  };

  proto.handleDeleteSelectedFiles = function (event) {
    if (event) event.preventDefault();
    const items = this.tree.getSelectedItems();
    const files = items.map((item) => item.file).filter(Boolean);
    const unique = flattenUniqueFiles(files);
    for (const file of unique) {
      if (file === this.app.vault.getRoot()) continue;
      if (this.app.vault.getAbstractFileByPath(file.path)) this.app.fileManager.promptForDeletion(file);
    }
  };

  proto.onKeyRename = function (event) {
    if (event && event.preventDefault) event.preventDefault();
    const item = this.tree.focusedItem;
    if (item && item.file) this.startRenameFile(item.file);
  };

  // ---------- rename ----------

  proto.startRenameFile = function (file) {
    if (!file || (file.isRoot && file.isRoot())) return;
    this.acceptRename();
    const item = this.getItemForFile(file) || this.createItemForFile(file);
    if (!item) return;
    // expand collapsed ancestors
    let parent = item.parent;
    while (parent && parent.collapsible && parent.collapsed) { parent.setCollapsed(false, false); parent = parent.parent; }
    item.startRename();
  };

  proto.onFileRenameInput = function () {
    const item = this.tree.focusedItem;
    if (item && item.file === this.fileBeingRenamed) this.validateRename(item);
  };

  proto.onFileRenameInputEvent = function (event) {
    const content = event.target;
    const itemEl = content && content.closest ? content.closest(".tree-item") : null;
    if (!itemEl) return;
    const item = this.itemFromElement(itemEl);
    if (item && item.file === this.fileBeingRenamed) {
      // strip non-text nodes, keep it plain
      if (content.innerHTML !== content.innerText) content.setText(content.innerText);
      this.validateRename(item);
    }
  };

  proto.onFileRenameBlur = function (event) {
    const content = event.target;
    const itemEl = content && content.closest ? content.closest(".tree-item") : null;
    if (!itemEl) return;
    const item = this.itemFromElement(itemEl);
    if (item && item.file === this.fileBeingRenamed) this.acceptRename();
  };

  proto.onFileRenameKeydown = function (event) {
    // Enter/Escape are handled by the item's own keydown listener; this is a fallback.
  };

  proto.itemFromElement = function (el) {
    for (const path in this.fileItems) {
      const item = this.fileItems[path];
      if (item.el === el) return item;
    }
    return null;
  };

  /** True while the in-place rename editor actually holds focus (guards the rename key scope). */
  proto.isRenameInputFocused = function () {
    const file = this.fileBeingRenamed;
    if (!file) return false;
    const item = this.getItemForFile(file);
    const el = item && item.innerEl;
    if (!el) return false;
    const doc = typeof activeDocument !== "undefined" ? activeDocument : document;
    const ae = doc && doc.activeElement;
    return !!ae && (ae === el || el.contains(ae));
  };

  proto.validateRename = function (item) {
    const text = (item.innerEl.innerText || "").trim();
    const fe = t();
    const vault = this.app.vault;
    const file = item.file;
    let message = null;
    if (host.invalidCharsPattern && host.invalidCharsPattern.test(text)) message = fe.msgInvalidCharacters() + host.invalidCharsList;
    else if (text && vault.checkForDuplicate && vault.checkForDuplicate(file, text)) message = fe.msgFileAlreadyExists();
    else if (host.unsafeCharsPattern && host.unsafeCharsPattern.test(text)) message = fe.msgUnsafeCharacters() + host.unsafeCharsList;
    if (message) {
      displayTooltip(item.selfEl, message, { classes: ["mod-error"], placement: this.getSideTooltipPlacement() });
      setTimeout(() => hideTooltip(), 2000);
    } else {
      hideTooltip();
    }
    return !message;
  };

  proto.acceptRename = function () {
    const file = this.fileBeingRenamed;
    if (!file) return;
    const item = this.getItemForFile(file);
    if (!item) { this.exitRename(); return; }
    const text = (item.innerEl.innerText || "").trim();
    const fe = t();
    const showError = (message) => {
      this.exitRename();
      displayTooltip(item.selfEl, message, { classes: ["mod-error"], placement: this.getSideTooltipPlacement() });
      setTimeout(() => hideTooltip(), 2000);
    };
    if (!text) {
      showError(fe.msgEmptyFileName());
      return;
    }
    if (text.startsWith(".")) {
      showError(fe.msgBadDotfile());
      return;
    }
    // compute the new path in the same folder
    const parentPrefix = file.parent ? file.parent.getParentPrefix() : "";
    let name = text;
    if (!(file instanceof host.TFolder) && file.extension && name.indexOf("." + file.extension) !== name.length - file.extension.length - 1) {
      if (name.indexOf(".") < 0) name = name + "." + file.extension;
    }
    const newPath = parentPrefix + name;
    if (newPath === file.path) { this.exitRename(); return; }
    const self = this;
    this.app.fileManager.renameFile(file, newPath).catch((err) => {
      displayTooltip(item.selfEl, String(err && err.message || err), { classes: ["mod-error"], placement: self.getSideTooltipPlacement() });
      setTimeout(() => hideTooltip(), 2000);
    });
    this.exitRename();
  };

  proto.onKeyEscInRename = function () {
    const file = this.fileBeingRenamed;
    const item = file && this.getItemForFile(file);
    if (item) item.stopRename(true);
    else this.exitRename();
    hideTooltip();
  };

  proto.exitRename = function () {
    const file = this.fileBeingRenamed;
    const item = file && this.getItemForFile(file);
    if (item && item.file === file) item.stopRename(false);
    this.fileBeingRenamed = null;
    this.fileBeingRenamedPath = null;
    if (this.fileRenameScope && this.app.keymap.scope === this.fileRenameScope) {
      this.app.keymap.popScope(this.fileRenameScope);
    }
    hideTooltip();
  };

  // ---------- clipboard ----------

  proto._writeClipboard = function (event, operation, paths) {
    if (event && event.clipboardData) {
      event.clipboardData.setData(NG15_CLIPBOARD_MIME, JSON.stringify({ operation, paths }));
      event.preventDefault && event.preventDefault();
    }
  };

  proto._readClipboard = function (event) {
    try {
      const raw = event && event.clipboardData ? event.clipboardData.getData(NG15_CLIPBOARD_MIME) : "";
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || (data.operation !== "copy" && data.operation !== "cut") || !Array.isArray(data.paths)) return null;
      return data;
    } catch (e) {
      return null;
    }
  };

  proto.handleCopy = function (event) {
    const items = this.tree.getSelectedItems();
    const paths = flattenUniqueFiles(items.map((item) => item.file).filter(Boolean)).map((f) => f.path);
    this._writeClipboard(event, "copy", paths);
    this.itemsBeingCut = [];
    this.clearCutMarks();
  };

  proto.handleCut = function (event) {
    const items = this.tree.getSelectedItems();
    const files = flattenUniqueFiles(items.map((item) => item.file).filter(Boolean));
    this._writeClipboard(event, "cut", files.map((f) => f.path));
    this.itemsBeingCut = files;
    for (const item of items) item.selfEl && item.selfEl.addClass("is-cut");
  };

  proto.clearCutMarks = function () {
    for (const path in this.fileItems) this.fileItems[path].selfEl && this.fileItems[path].selfEl.removeClass("is-cut");
    this.itemsBeingCut = [];
  };

  proto.handlePaste = function (event) {
    const data = this._readClipboard(event);
    if (!data) return;
    event.preventDefault && event.preventDefault();
    const vault = this.app.vault;
    const paths = data.paths.slice().sort((a, b) => stringCollator.compare(a, b));
    const sources = [];
    for (const p of paths) {
      const f = vault.getAbstractFileByPath(p);
      if (f) sources.push(f);
    }
    const unique = flattenUniqueFiles(sources);
    if (unique.length === 0) return;
    // destination: focused folder -> itself, focused file -> its parent, none -> root
    const focused = this.tree.focusedItem;
    let dest = vault.getRoot();
    if (focused && focused.file instanceof host.TFolder) dest = focused.file;
    else if (focused && focused.file && focused.file.parent) dest = focused.file.parent;
    const self = this;
    this.enqueueWork(async () => {
      const placed = [];
      if (data.operation === "copy") {
        for (const file of unique) {
          const ext = file.extension;
          const base = ext ? nameNoExt(file.name, ext) : file.name;
          const available = ext ? vault.getAvailablePath(dest.getParentPrefix() + base, ext) : vault.getAvailablePath(dest.getParentPrefix() + base);
          try {
            const copy = await vault.copy(file, available);
            if (copy) placed.push(copy);
          } catch (e) {}
        }
      } else {
        const movable = unique.filter((file) => self.canMoveInto(file, dest));
        for (const file of movable) {
          const name = file.name;
          const ext = file.extension;
          const available = ext ? vault.getAvailablePath(dest.getParentPrefix() + nameNoExt(name, ext), ext) : vault.getAvailablePath(dest.getParentPrefix() + name);
          try {
            await self.app.fileManager.runAsyncLinkUpdate(() => vault.rename(file, available));
            const moved = vault.getAbstractFileByPath(available);
            if (moved) placed.push(moved);
          } catch (e) {}
        }
      }
      // select placed items
      self.tree.clearSelectedDoms();
      for (const f of placed) {
        const item = self.getItemForFile(f);
        if (item) self.tree.selectItem(item);
      }
      self.clearCutMarks();
      if (placed.length > 0) {
        const first = self.getItemForFile(placed[0]);
        if (first) { self.tree.setFocusedItem(first); self.revealInFolder(placed[0]); }
      }
    });
  };

  proto.enqueueWork = function (fn) {
    this.workQueue = this.workQueue.then(fn).catch(() => {});
    return this.workQueue;
  };

  proto.canMoveInto = function (file, dest) {
    const vault = this.app.vault;
    if (!file || !dest) return false;
    if (file === vault.getRoot()) return false;
    if (dest === vault.getRoot() && file.parent === vault.getRoot()) {
      // moving a root child into root is meaningless unless it changes folder - allow only real moves
    }
    if (file.parent === dest) return false;
    // not into itself or a descendant
    let p = dest;
    while (p) {
      if (p === file) return false;
      p = p.parent;
    }
    if (dest === file) return false;
    return true;
  };

  // ---------- drag & drop ----------

  proto.handleItemDrop = function (evt, draggable, isOver, item) {
    if (!isOver) return this.performItemDrop(evt, item);
    const app = this.app;
    const drag = app.dragManager.draggable || draggable;
    if (!drag) return null;
    const targetFile = item.file;
    const isFolderTarget = targetFile instanceof host.TFolder;
    if (!isFolderTarget) return null;
    // reject dropping a folder into itself/descendant
    const draggedFiles = drag.files || (drag.file ? [drag.file] : []);
    const movable = draggedFiles.filter((f) => this.canMoveInto(f, targetFile));
    if (draggedFiles.length > 0 && movable.length === 0) return null;
    // schedule auto-expand of a collapsed folder target
    if (item.collapsed && typeof item.setCollapsed === "function" && !item._expandTimer) {
      item._expandTimer = setTimeout(() => {
        item._expandTimer = null;
        if (item.collapsed) item.setCollapsed(false, true);
      }, 750);
    }
    return {
      dropEffect: "move",
      hoverEl: item.el,
      hoverClass: "is-being-dragged-over",
    };
  };

  /** Executes the move for a drop on a folder row; returns truthy when the drop was consumed. */
  proto.performItemDrop = function (evt, item) {
    const app = this.app;
    const drag = app.dragManager.draggable;
    if (!drag || !item || !item.file) return false;
    const target = item.file;
    if (!(target instanceof host.TFolder)) return false;
    const draggedFiles = drag.files || (drag.file ? [drag.file] : []);
    const movable = draggedFiles.filter((f) => this.canMoveInto(f, target));
    if (movable.length === 0) return false;
    const vault = app.vault;
    const self = this;
    this.enqueueWork(async () => {
      for (const file of movable) {
        const name = file.name;
        const ext = file.extension;
        const base = ext ? name.slice(0, name.length - ext.length - 1) : name;
        const available = ext ? vault.getAvailablePath(target.getParentPrefix() + base, ext) : vault.getAvailablePath(target.getParentPrefix() + name);
        try { await app.fileManager.runAsyncLinkUpdate(() => vault.rename(file, available)); } catch (e) {}
      }
    });
    return true;
  };

  proto.handleContainerDrop = function (evt, draggable, isOver) {
    if (!isOver) return this.onContainerDrop(evt);
    const app = this.app;
    const drag = app.dragManager.draggable || draggable;
    if (!drag) return null;
    const dataTransfer = evt.dataTransfer;
    const hasOsFiles = dataTransfer && ((dataTransfer.types && dataTransfer.types.includes("Files")) || (dataTransfer.files && dataTransfer.files.length > 0));
    if (hasOsFiles) {
      return { dropEffect: "copy", hoverEl: this.navFileContainerEl, hoverClass: "is-being-dragged-over" };
    }
    const draggedFiles = drag.files || (drag.file ? [drag.file] : []);
    const movable = draggedFiles.filter((f) => this.canMoveInto(f, app.vault.getRoot()));
    if (draggedFiles.length > 0 && movable.length === 0) return null;
    return { dropEffect: "move", hoverEl: this.navFileContainerEl, hoverClass: "is-being-dragged-over" };
  };

  proto.onContainerDrop = function (evt) {
    const app = this.app;
    const drag = app.dragManager.draggable;
    if (!drag) return false;
    const vault = app.vault;
    const draggedFiles = drag.files || (drag.file ? [drag.file] : []);
    const movable = draggedFiles.filter((f) => this.canMoveInto(f, vault.getRoot()));
    // OS file import
    const dataTransfer = evt.dataTransfer;
    if (dataTransfer && dataTransfer.files && dataTransfer.files.length > 0 && draggedFiles.length === 0) {
      const items = [];
      for (const f of Array.from(dataTransfer.files)) {
        items.push({ name: f.name, extension: (f.name.split(".").pop() || ""), data: f });
      }
      app.importAttachments(items, vault.getRoot());
      return true;
    }
    for (const file of movable) {
      // dropping on empty space moves to root only when the file is not already there
      if (file.parent === vault.getRoot()) continue;
      const name = file.name;
      const ext = file.extension;
      const base = ext ? name.slice(0, name.length - ext.length - 1) : name;
      const available = ext ? vault.getAvailablePath(base, ext) : vault.getAvailablePath(name);
      app.fileManager.runAsyncLinkUpdate(() => vault.rename(file, available)).catch(() => {});
    }
    return movable.length > 0;
  };

  // ---------- hover / tooltips ----------

  proto.onFilePointerOver = function (event) {
    if (event.pointerType === "touch") return;
    if (host.isTouchSyntheticMouse && host.isTouchSyntheticMouse(event)) return;
    const target = event.target && event.target.closest ? event.target.closest(".nav-file-title,.nav-folder-title") : null;
    if (!target) return;
    const itemEl = target.closest(".tree-item");
    const item = itemEl && this.itemFromElement(itemEl);
    if (!item || !item.file) return;
    this.hoverItem = item;
    const self = this;
    clearTimeout(this._hoverTimer);
    this._hoverTimer = setTimeout(() => self.showItemTooltip(item, target), 1000);
    if (item.file instanceof host.TFile) {
      this.app.workspace.trigger("hover-link", {
        event, source: "file-explorer", hoverParent: self, targetEl: target, linktext: item.file.path,
      });
    }
  };

  proto.onFilePointerOut = function (event) {
    const target = event.target && event.target.closest ? event.target.closest(".nav-file-title,.nav-folder-title") : null;
    if (!target) return;
    clearTimeout(this._hoverTimer);
    hideTooltip();
  };

  proto.showItemTooltip = function (item, targetEl) {
    const file = item.file;
    if (!file) return;
    const fe = t();
    let text = item.getTitle();
    if (!item.isFullTitleShown || !item.isFullTitleShown()) text = item.getTitle() + "\n" + text;
    if (file instanceof host.TFile && file.stat) {
      const fmt = (ts) => {
        const d = new Date(ts);
        const p = (n) => String(n).padStart(2, "0");
        return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
      };
      text = fe.tooltipModifiedTime({ time: fmt(file.stat.mtime) }) + "\n" + fe.tooltipCreatedTime({ time: fmt(file.stat.ctime) });
    } else {
      const count = file.getFileCount ? file.getFileCount() + file.getFolderCount() : 0;
      const nouns = host.t.nouns || {};
      const label = file instanceof host.TFolder
        ? (nouns.folderWithCount ? nouns.folderWithCount({ count }) : String(count))
        : (nouns.fileWithCount ? nouns.fileWithCount({ count: 1 }) : "");
      if (label) text = label + "\n" + text;
    }
    displayTooltip(targetEl, text, {
      placement: this.getSideTooltipPlacement(),
      gap: 24,
      horizontalParent: this.navFileContainerEl,
    });
  };

  // ---------- click delegation ----------

  proto.itemFromEvent = function (event) {
    const title = event.target && event.target.closest ? event.target.closest(".nav-file-title,.nav-folder-title") : null;
    if (!title) return null;
    const itemEl = title.closest(".tree-item");
    return itemEl ? this.itemFromElement(itemEl) : null;
  };

  proto.onFileClick = function (event) {
    if (event.defaultPrevented) return;
    if (event.button !== 0 && event.button !== 1) return;
    const item = this.itemFromEvent(event);
    if (!item || !item.onSelfClick) return;
    item.onSelfClick(event);
  };

  // ---------- context menus ----------

  proto.onFileContextMenuEmpty = function (event) {
    const title = event.target && event.target.closest ? event.target.closest(".nav-file-title,.nav-folder-title") : null;
    if (title) { this.onFileContextMenu(event); return; }
    // empty space: clear selection/focus, menu for the vault root
    this.tree.clearSelectedDoms();
    this.tree.setFocusedItem(null);
    const rootItem = this.fileItems["/"] || this.rootItemForMenu();
    this.showFileMenu(event, rootItem && rootItem.file ? rootItem.file : this.app.vault.getRoot(), "file-explorer-context-menu");
  };

  proto.rootItemForMenu = function () { return null; };

  proto.onFileContextMenu = function (event) {
    const item = this.itemFromEvent(event);
    if (!item || !item.file) { this.onFileContextMenuEmpty(event); return; }
    event.preventDefault && event.preventDefault();
    const file = item.file;
    // multi-select menu when the clicked file is part of the selection
    const selected = this.tree.getSelectedItems();
    const multi = selected.length > 1 && selected.indexOf(item) >= 0;
    if (multi) {
      this.showFilesMenu(event, selected.map((i) => i.file).filter(Boolean));
      return;
    }
    this.tree.setFocusedItem(item, false);
    this.showFileMenu(event, file, "file-explorer-context-menu");
  };

  proto.showFilesMenu = function (event, files) {
    const menu = new host.Menu();
    menu.addSections(["title", "open", "action-primary", "action", "info", "info.copy", "view", "system", "", "danger"]);
    const unique = flattenUniqueFiles(files);
    if (host.Platform.isPhone) {
      menu.addItem((item) => item.setSection("title").setTitle(String(unique.length)).setDisabled(true));
    }
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(ng15ExplorerT(host).actionNewFolderWithCount({ count: unique.length }))
      .setIcon("lucide-folder-plus")
      .onClick(() => this.newFolderFromSelection(unique)));
    menu.addItem((item) => item
      .setSection("danger")
      .setTitle(ng15ExplorerT(host).menuOptDelete())
      .setIcon("lucide-trash")
      .onClick(() => { for (const f of unique) this.app.fileManager.promptForDeletion(f); }));
    this.app.workspace.trigger("files-menu", menu, unique, "file-explorer-context-menu");
    menu.setParentElement(this.navFileContainerEl).showAtMouseEvent(event);
  };

  proto.newFolderFromSelection = async function (files) {
    const unique = flattenUniqueFiles(files);
    if (unique.length === 0) return;
    // create a folder next to the first file's parent, then move the movable files into it
    const first = unique[0];
    const parent = first.parent || this.app.vault.getRoot();
    const folder = await this.app.fileManager.createNewFolder(parent);
    if (!folder) return;
    const movable = unique.filter((f) => this.canMoveInto(f, folder));
    const vault = this.app.vault;
    for (const file of movable) {
      const name = file.name;
      const ext = file.extension;
      const base = ext ? name.slice(0, name.length - ext.length - 1) : name;
      const available = ext ? vault.getAvailablePath(folder.getParentPrefix() + base, ext) : vault.getAvailablePath(folder.getParentPrefix() + name);
      try { await this.app.fileManager.runAsyncLinkUpdate(() => vault.rename(file, available)); } catch (e) {}
    }
    const item = this.getItemForFile(folder);
    if (item) this.startRenameFile(folder);
  };

  proto.showFileMenu = function (event, file, source) {
    const menu = new host.Menu();
    menu.addSections(["title", "open", "action-primary", "action", "info", "info.copy", "view", "system", "", "danger"]);
    const fe = t();
    const app = this.app;
    const isRoot = file === app.vault.getRoot() || (file && file.isRoot && file.isRoot());
    const isFolder = file instanceof host.TFolder;
    if (host.Platform.isPhone) {
      if (isRoot) menu.addItem((item) => item.setSection("title").setTitle(app.vault.getName()).setDisabled(true));
      else menu.addItem((item) => item.setSection("title").setTitle(file.name).setDisabled(true));
    }
    if (!isRoot && isFolder) {
      menu.addItem((item) => item
        .setSection("action-primary")
        .setTitle(fe.actionNewNote())
        .setIcon("lucide-file-plus")
        .onClick((evt) => { const inNew = host.Keymap.isModEvent(evt) === "tab"; this.createNewFile(file, inNew); }));
      menu.addItem((item) => item
        .setSection("action-primary")
        .setTitle(fe.actionNewFolder())
        .setIcon("lucide-folder-plus")
        .onClick((evt) => { const inNew = host.Keymap.isModEvent(evt) === "tab"; this.createNewFolder(file, inNew); }));
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(fe.menuOptRename())
        .setIcon("lucide-pencil")
        .onClick(() => this.startRenameFile(file)));
    } else if (!isRoot) {
      if (host.Platform.canSplit) {
        menu.addItem((item) => item
          .setSection("open")
          .setTitle(host.tc.splitRight ? host.tc.splitRight() : "")
          .setIcon("lucide-separator-vertical")
          .onClick(() => app.workspace.duplicateLeaf(this.leaf, "vertical")));
        menu.addItem((item) => item
          .setSection("open")
          .setTitle(host.tc.splitDown ? host.tc.splitDown() : "")
          .setIcon("lucide-separator-horizontal")
          .onClick(() => app.workspace.duplicateLeaf(this.leaf, "horizontal")));
      }
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(host.Platform.isMacOS ? fe.menuOptMakeCopyMac() : fe.menuOptMakeCopy())
        .setIcon("lucide-copy")
        .onClick(() => this.duplicateFile(file)));
      if (isFolder) {
        menu.addItem((item) => item
          .setSection("action")
          .setTitle(fe.menuOptRename())
          .setIcon("lucide-pencil")
          .onClick(() => this.startRenameFile(file)));
      }
    }
    if (!isRoot) {
      menu.addItem((item) => item
        .setSection("danger")
        .setTitle(fe.menuOptDelete())
        .setIcon("lucide-trash")
        .onClick(() => app.fileManager.promptForDeletion(file)));
    }
    app.workspace.trigger("file-menu", menu, file, source);
    menu.setParentElement(this.navFileContainerEl).showAtMouseEvent(event);
  };

  proto.duplicateFile = async function (file) {
    const vault = this.app.vault;
    const name = file.name;
    const ext = file.extension;
    const base = ext ? name.slice(0, name.length - ext.length - 1) : name;
    const parentPrefix = file.parent ? file.parent.getParentPrefix() : "";
    const available = ext ? vault.getAvailablePath(parentPrefix + base, ext) : vault.getAvailablePath(parentPrefix + name);
    try { await vault.copy(file, available); } catch (e) {}
  };

  // ---------- plugin-facing ----------

  proto.getViewType = proto.getViewType;

  return FileExplorerView;
}

function nameNoExt(name, ext) { return ext && name.endsWith("." + ext) ? name.slice(0, name.length - ext.length - 1) : name; }

function ng15CompareRootChildren(view) {
  const host = view._host;
  const fileCompare = sortOrderComparator(view.sortOrder || "alphabetical");
  return (a, b) => {
    const af = a.file, bf = b.file;
    if (!af || !bf) return 0;
    const aFolder = af instanceof host.TFolder;
    const bFolder = bf instanceof host.TFolder;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    if (aFolder && bFolder) return stringCollator.compare(af.name, bf.name);
    return fileCompare(af, bf);
  };
}

// =====================================================================================================================
// FileExplorerPlugin — internal plugin descriptor
// =====================================================================================================================

export function ng15DefineFileExplorerPlugin(host) {
  function FileExplorerPlugin() {
    this.id = "file-explorer";
    this.name = "Files";
    this.description = "";
    this.defaultOn = true;
    this.app = null;
    this.plugin = null;
    this._views = [];
  }
  const proto = FileExplorerPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const fe = host.t.plugins.fileExplorer;
    this.name = fe.name();
    this.description = fe.desc();
    const self = this;
    plugin.registerGlobalCommand({
      id: "file-explorer:open",
      name: fe.actionOpen(),
      icon: "lucide-files",
      callback: () => self.ensureExplorerLeaf(true),
    });
    plugin.registerGlobalCommand({
      id: "file-explorer:reveal-active-file",
      name: fe.actionRevealActiveFile(),
      icon: "lucide-navigation",
      checkCallback: (checking) => {
        const ok = !!app.workspace.getActiveFile();
        if (checking) return ok;
        if (ok) self.revealInFolder(app.workspace.getActiveFile());
        return ok;
      },
    });
    plugin.registerGlobalCommand({
      id: "file-explorer:new-folder",
      name: fe.actionNewFolder(),
      icon: "lucide-folder-plus",
      callback: async () => {
        await self.ensureExplorerLeaf(true);
        const view = self.activeView();
        if (view) {
          const folder = await view.createNewFolder(null, false);
          if (folder) {
            // ensure the explorer leaf carries the newFile state so the folder is revealed
            const leaf = view.leaf;
            leaf && leaf.setViewState({ type: "file-explorer", state: { newFile: folder.path } });
          }
        }
      },
    });
    plugin.registerGlobalCommand({
      id: "file-explorer:new-file",
      name: fe.actionCreateNote(),
      icon: "lucide-file-plus",
      hotkeys: [{ modifiers: ["Mod"], key: "N" }],
      callback: async () => {
        await self.ensureExplorerLeaf(true);
        await app.fileManager.createAndOpenMarkdownFile("", "tab");
      },
    });
    plugin.registerGlobalCommand({
      id: "file-explorer:new-file-in-current-tab",
      name: fe.actionCreateNoteInCurrentTab(),
      icon: "lucide-file-plus",
      callback: async () => {
        await self.ensureExplorerLeaf(true);
        await app.fileManager.createAndOpenMarkdownFile("", false);
      },
    });
    plugin.registerGlobalCommand({
      id: "file-explorer:new-file-in-new-pane",
      name: fe.actionCreateNoteToTheRight(),
      icon: "lucide-file-plus-2",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "N" }],
      callback: async () => {
        await self.ensureExplorerLeaf(true);
        await app.fileManager.createAndOpenMarkdownFile("", "split");
      },
    });
    plugin.registerGlobalCommand({
      id: "file-explorer:move-file",
      name: fe.actionMoveFile(),
      icon: "lucide-folder-input",
      callback: () => self.moveActiveFile(),
    });
    plugin.registerGlobalCommand({
      id: "file-explorer:duplicate-file",
      name: fe.commandMakeACopy(),
      icon: "lucide-copy",
      callback: () => {
        const view = self.activeView();
        if (!view) return;
        const files = view.tree.getSelectedItems().map((i) => i.file).filter(Boolean);
        const targets = files.length ? files : [app.workspace.getActiveFile()].filter(Boolean);
        for (const f of targets) view.duplicateFile(f);
      },
    });
    plugin.registerViewType("file-explorer", (leaf) => {
      const ViewClass = ng15FileExplorerViewClass || ng15DefineFileExplorerView(host);
      const view = new ViewClass(leaf);
      self._views.push(view);
      return view;
    });
  };

  proto.onEnable = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    app.workspace.on("layout-ready", this.initLeaf.bind(this));
    app.workspace.on("file-menu", this.onFileMenu.bind(this));
    app.workspace.registerHoverLinkSource("file-explorer", { display: this.name, defaultMod: true });
  };

  proto.onDisable = function (app) {
    app.workspace.unregisterHoverLinkSource("file-explorer");
  };

  proto.onUserEnable = function () {
    this.initLeaf();
  };

  proto.onFileMenu = function (menu, file, source) {
    if (host.Platform.isMobile) return;
    if (!(file instanceof host.TFile) && !(file instanceof host.TFolder)) return;
    if (source === "file-explorer-context-menu") return;
    const fe = host.t.plugins.fileExplorer;
    menu.addItem((item) => item
      .setSection("system")
      .setTitle(fe.actionRevealFile())
      .setIcon("lucide-folder-open")
      .onClick(() => this.revealInFolder(file)));
  };

  proto.initLeaf = function () {
    this.ensureExplorerLeaf(false);
  };

  proto.ensureExplorerLeaf = function (reveal) {
    const app = this.app;
    const existing = app.workspace.getLeavesOfType("file-explorer");
    let leaf = existing[0] || null;
    if (!leaf) {
      leaf = app.workspace.getLeftLeaf(false);
      if (leaf) leaf.setViewState({ type: "file-explorer" });
    }
    if (reveal && leaf) {
      app.workspace.revealLeaf(leaf);
      app.workspace.setActiveLeaf(leaf, { focus: true });
    }
    return leaf;
  };

  proto.activeView = function () {
    const leaves = this.app.workspace.getLeavesOfType("file-explorer");
    for (const leaf of leaves) if (leaf.view) return leaf.view;
    for (const view of this._views) if (view.containerEl && view.containerEl.isConnected) return view;
    return this._views[this._views.length - 1] || null;
  };

  proto.revealInFolder = function (file) {
    const app = this.app;
    let leaves = app.workspace.getLeavesOfType("file-explorer");
    let leaf = leaves[0] || null;
    if (!leaf) {
      leaf = app.workspace.getLeftLeaf(false);
      if (leaf) leaf.setViewState({ type: "file-explorer" });
    }
    if (!leaf) return;
    app.workspace.revealLeaf(leaf);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view;
    if (view && view.revealInFolder) view.revealInFolder(file);
  };

  /** Moves the active file (or the explorer selection) into a folder picked in a small modal. */
  proto.moveActiveFile = function () {
    const app = this.app;
    const view = this.activeView();
    let files = view && view.tree ? view.tree.getSelectedItems().map((i) => i.file).filter((f) => f instanceof host.TFile) : [];
    if (!files.length) {
      const active = app.workspace.getActiveFile();
      if (active) files = [active];
    }
    if (!files.length) return;
    const file = files[0];
    const vault = app.vault;
    const modal = new host.Modal(app);
    modal.titleEl.setText(host.t.plugins.fileExplorer.actionMoveFile());
    modal.contentEl.createDiv("modal-content", (content) => {
      content.createEl("p", { text: file.path });
      const input = content.createEl("input", { type: "text", cls: "prompt-input" });
      let chosen = null;
      new host.FolderPathSuggest(app, input, (folder) => folder.path !== "/");
      input.addEventListener("change", () => { chosen = input.value.trim(); });
      const buttons = content.createDiv("modal-button-container");
      buttons.createEl("button", { cls: "mod-cta", text: host.t.interface.confirm ? host.t.interface.confirm() : "Move" }, (btn) => {
        btn.onClickEvent(async () => {
          const dest = (chosen || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
          if (dest) {
            const folder = vault.getAbstractFileByPath(dest);
            if (folder instanceof host.TFolder) {
              const name = file.name;
              const ext = file.extension;
              const base = ext ? name.slice(0, name.length - ext.length - 1) : name;
              const available = ext ? vault.getAvailablePath(folder.getParentPrefix() + base, ext) : vault.getAvailablePath(folder.getParentPrefix() + name);
              try { await app.fileManager.runAsyncLinkUpdate(() => vault.rename(file, available)); } catch (e) {}
            }
          }
          modal.close();
        });
      });
      buttons.createEl("button", { text: host.t.interface.cancel ? host.t.interface.cancel() : "Cancel" }, (btn) => {
        btn.onClickEvent(() => modal.close());
      });
    });
    modal.open();
    const inp = modal.contentEl.querySelector("input");
    if (inp) setTimeout(() => inp.focus(), 0);
  };

  return FileExplorerPlugin;
}
