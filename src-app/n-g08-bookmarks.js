// g08 clean-room: Bookmarks plugin — item model, tree view, edit/many modals,
// commands, menus, persistence and opening logic.
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { ng15MakeTreePusher, ng15CollapsibleTreeItem, ng15WalkTree, ng15TreeDropPosition, ng15UpdateTreeDropIndicator } from "./n-g15-tree.js";
import { fileClass } from "./vault.js";
import { binaryFind, randomHex } from "./misc.js";
import { displayName, withoutMd, parseLinktext, firstHeadingText } from "./path.js";
import { linkSafeHeading } from "./text.js";
import { defineDialogModal } from "./modal.js";
import { Runnable } from "./metadata-helpers.js";
import { ng08SetPlainText } from "./n-g08-drag.js";
import { searchViewClasses } from "./search-view.js";
import { s28BookmarkParentSymbol } from "./s28-graph.js";

const ng08Host = () => __basaltHost;
const ng08BmT = () => ng08Host().t.plugins.bookmarks;

// Cross-factory registry: factories run in manifest order but only instantiate at runtime.
const ng08Bm = {};

// =====================================================================================================================
// Item factories and pure helpers
// =====================================================================================================================

export function ng08BookmarkItemForFile(file, subpath) {
  const item = { type: "file", ctime: Date.now(), path: file.path };
  if (subpath) item.subpath = subpath;
  return item;
}

export function ng08BookmarkItemForFolder(folder) {
  return { type: "folder", ctime: Date.now(), path: folder.path };
}

export function ng08BookmarkGroupItem(title) {
  return { type: "group", ctime: Date.now(), items: [], title: title || ng08BmT().labelUntitledGroup() };
}

export function ng08BookmarkItemForGraph(options, title) {
  return { type: "graph", ctime: Date.now(), title: title || ng08BmT().labelUntitledGraph(), options };
}

export function ng08BookmarkItemForUrl(url, title) {
  return { type: "url", ctime: Date.now(), url, title: title || "" };
}

export function ng08BookmarkItemForSearch(query) {
  return { type: "search", ctime: Date.now(), query };
}

/** Bookmark representation of a workspace leaf's view, or null when not bookmarkable. */
export function ng08ViewToBookmarkItem(leaf) {
  const host = ng08Host();
  const view = leaf && leaf.view;
  if (!view) return null;
  if (view instanceof host.GraphView) {
    return ng08BookmarkItemForGraph(view.dataEngine.getOptions());
  }
  if (view instanceof searchViewClasses.SearchView) {
    return ng08BookmarkItemForSearch(view.getQuery());
  }
  if (view instanceof host.FileView) {
    return view.file ? ng08BookmarkItemForFile(view.file) : null;
  }
  if (view instanceof host.WebViewerView) {
    return ng08BookmarkItemForUrl(view.url, view.getDisplayText());
  }
  return null;
}

/** Drops files already covered by a folder earlier in the same list (plain string prefix). */
export function ng08FlattenUniqueFiles(files) {
  const TFolder = fileClass("TFolder");
  const out = [];
  for (const file of files) {
    let covered = false;
    for (const other of files) {
      if (other !== file && other instanceof TFolder && file.path && file.path.startsWith(other.path)) {
        covered = true;
        break;
      }
    }
    if (!covered) out.push(file);
  }
  return out;
}

export function ng08FilesToBookmarkItems(files) {
  const TFile = fileClass("TFile");
  const TFolder = fileClass("TFolder");
  const out = [];
  for (const file of ng08FlattenUniqueFiles(files)) {
    if (file instanceof TFile) out.push(ng08BookmarkItemForFile(file));
    else if (file instanceof TFolder) out.push(ng08BookmarkItemForFolder(file));
  }
  return out;
}

/** Depth-first pre-order walk; a truthy visit() aborts only the current sibling list. */
export function ng08WalkBookmarkItems(items, visit) {
  const walk = (list, prefix) => {
    for (const item of list) {
      if (visit(item, prefix)) return;
      if (item.type === "group" && item.items) {
        walk(item.items, prefix + (item.title || "") + "/");
      }
    }
  };
  walk(items || [], "");
}

/** Last heading whose start line is at or before `position.line`. */
export function ng08HeadingAtPosition(app, file, position) {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache || !cache.headings) return null;
  const headings = cache.headings;
  let found = null;
  for (const heading of headings) {
    if (heading.position.start.line <= position.line) found = heading;
    else break;
  }
  return found;
}

/** Where to splice a `^blockId` reference into a markdown AST node's source. */
export function ng08BlockRefInsertion(contentInfo, id) {
  const node = contentInfo.node;
  const content = contentInfo.content;
  const start = node.position.start.offset;
  let blockEnd = node.position.end.offset;
  let ref;
  let newlines;
  if (node.type === "paragraph" || node.type === "listItem") {
    ref = " ^" + id;
    if (node.type === "listItem" && node.children && node.children.length > 1) {
      const last = node.children[node.children.length - 1];
      if (last.type === "list") {
        blockEnd = node.children[node.children.length - 2].position.end.offset;
      }
    }
    newlines = 0;
  } else {
    ref = "\n\n^" + id;
    newlines = 2;
  }
  if (node.type !== "paragraph") {
    if (content.slice(blockEnd, blockEnd + 2) !== "\n\n") {
      ref += "\n";
      newlines++;
    }
  }
  return { blockStart: start, blockEnd, addition: ref, newlines };
}

// =====================================================================================================================
// Runnable / ButtonModal (shared bases; Runnable and DialogModal already exist as clean-room modules)
// =====================================================================================================================

export function ng08DefineBookmarkRunnable() {
  return Runnable;
}

export function ng08DefineButtonModal(host) {
  return defineDialogModal(host);
}

// =====================================================================================================================
// Tree rows
// =====================================================================================================================

/** BookmarkItemBase: .bookmark row chrome, context menu, rename flow, data-path. */
export function ng08DefineBookmarkItemBase(host) {
  function BookmarkItemBase(view, tree, item) {
    const self = host.TreeItem.call(this) || this;
    self.view = view;
    self.tree = tree;
    self.item = item;
    self.pusherEl = ng15MakeTreePusher();
    self.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    self.selfEl.addClass("bookmark");
    self.titleEl = self.innerEl.createEl("span", { cls: "tree-item-inner-text" });
    self.scope = new host.Scope();
    self.scope.register([], "Enter", () => self.stopRename(true));
    self.scope.register([], "Escape", () => self.stopRename(false));
    self.selfEl.addEventListener("contextmenu", (event) => {
      if (!event.defaultPrevented) self.onContextMenu(event);
    });
    Object.defineProperty(self, "path", {
      get() {
        const parts = [];
        let node = self;
        while (node && node.item) {
          if (node.item.type === "group" || node === self) {
            const title = self.view.plugin.getItemTitle(node.item);
            if (title) parts.unshift(title);
          }
          node = node.parent;
        }
        return parts.join("/");
      },
      enumerable: false,
      configurable: true,
    });
    return self;
  }
  inherit(BookmarkItemBase, host.TreeItem);
  const proto = BookmarkItemBase.prototype;

  proto.update = function () {
    const item = this.item;
    const title = this.view.plugin.getItemTitle(item);
    this.titleEl.setText(title || "");
    if (item.type === "file" || item.type === "folder") {
      const file = this.view.app.vault.getAbstractFileByPath(item.path);
      this.el.toggleClass("is-hidden", !file);
      // hmm — spec: file items toggle row visibility; keep row but hide
    }
    this.tree.infinityScroll.invalidate(this);
  };

  proto.setActive = function (active) {
    this.selfEl.toggleClass("is-active", active);
  };

  proto.startRename = function () {
    if (this.renaming) return;
    this.renaming = true;
    this.selfEl.addClass("is-being-renamed");
    this.titleEl.setAttr("contenteditable", "true");
    host.focusAndSelectContents(this.titleEl);
    this.view.app.keymap.pushScope(this.scope);
  };

  proto.stopRename = function (save) {
    if (!this.renaming) return;
    this.renaming = false;
    this.titleEl.removeAttribute("contenteditable");
    this.selfEl.removeClass("is-being-renamed");
    this.view.app.keymap.popScope(this.scope);
    const text = (this.titleEl.textContent || "").trim();
    if (save && text) {
      this.item.title = text;
      this.view.plugin.onItemsChanged(true);
    } else {
      this.update();
    }
  };

  proto.getPath = function () { return this.path; };

  proto.onContextMenu = function (event) { /* overridden by leaf/group rows */ };

  ng08Bm.BookmarkItemBase = BookmarkItemBase;
  return BookmarkItemBase;
}

/** Leaf rows: file/folder/search/graph/url items. */
export function ng08DefineBookmarkLeafItem(host) {
  const Base = ng08Bm.BookmarkItemBase || ng08Host().TreeItem;

  function BookmarkLeafItem(view, tree, item) {
    const self = Base.call(this, view, tree, item) || this;
    const app = view.app;
    const activeFile = app.workspace.getActiveFile && app.workspace.getActiveFile();
    if (item.type === "file" && !item.subpath && activeFile && item.path === activeFile.path) {
      self.setActive(true);
    }
    self.selfEl.addEventListener("mouseover", (evt) => {
      if (host.isTouchSyntheticMouse(evt)) return;
      if (item.type !== "file" || item.subpath) return;
      const file = app.vault.getAbstractFileByPath(item.path);
      if (file instanceof fileClass("TFile")) {
        app.workspace.trigger("hover-link", {
          event: evt,
          source: "bookmarks",
          hoverParent: self,
          targetEl: self.selfEl,
          linktext: item.path + (item.subpath || ""),
        });
      }
    });
    return self;
  }
  inherit(BookmarkLeafItem, Base);
  const proto = BookmarkLeafItem.prototype;

  proto.updateIcon = function () {
    const item = this.item;
    const view = this.view;
    const app = view.app;
    if (!this.iconEl) {
      this.iconEl = this.innerEl.createDiv("tree-item-icon bookmark-icon");
      this.innerEl.prepend(this.iconEl);
    }
    let icon = null;
    if (item.type === "file") {
      if (item.path.endsWith(".canvas")) icon = "lucide-layout-dashboard";
      else if (item.subpath && item.subpath.startsWith("#^")) icon = "lucide-toy-brick";
      else if (item.subpath && item.subpath.startsWith("#")) icon = "lucide-heading";
      else icon = "lucide-file";
    } else if (item.type === "folder") icon = "lucide-folder";
    else if (item.type === "search") icon = "lucide-search";
    else if (item.type === "graph") icon = "lucide-git-fork";
    else if (item.type === "url") {
      const webviewer = app.internalPlugins.getEnabledPluginById("webviewer");
      if (webviewer && webviewer.db && webviewer.db.setIcon) {
        webviewer.db.setIcon(this.iconEl, item.url);
        return;
      }
      icon = "globe-2";
    }
    if (icon) {
      host.setIcon(this.iconEl, icon);
      this.iconEl.show();
    } else if (this.iconEl) {
      this.iconEl.hide();
    }
  };

  proto.update = function () {
    Base.prototype.update.call(this);
    const item = this.item;
    if ((item.type === "file" || item.type === "folder") && item.path) {
      this.el.setAttribute("data-path", displayName(item.path));
      this.selfEl.setAttribute("data-path", item.path);
    } else {
      this.el.removeAttribute("data-path");
      this.selfEl.removeAttribute("data-path");
    }
    this.updateIcon();
  };

  proto.onSelfClick = function (event) {
    if (this.tree.handleItemSelection(event, this)) return;
    const item = this.item;
    this.view.plugin.openBookmark(item, host.Keymap.isModEvent(event), { eState: { focus: true } });
  };

  proto.onContextMenu = function (event) {
    const view = this.view;
    const plugin = view.plugin;
    const app = view.app;
    const tree = this.tree;
    const item = this.item;
    const menu = new host.Menu().addSections(["title", "open", "action", "view", "info", "", "danger"]);
    const selected = tree.selectedDoms;
    const isMulti = selected.size > 1 && selected.has(this);
    const openItems = (target, section) => {
      menu.addItem((mi) => mi.setSection(section).setIcon("lucide-file-plus").setTitle(host.t.interface.menu.openInNewTab()).onClick(() => plugin.openBookmarks([target.item], true)));
      if (host.Platform.canSplit) {
        menu.addItem((mi) => mi.setSection(section).setIcon("lucide-separator-vertical").setTitle(host.t.interface.menu.openToTheRight()).onClick(() => plugin.openBookmarks([target.item], "split")));
      }
      if (host.Platform.canPopoutWindow) {
        menu.addItem((mi) => mi.setSection(section).setIcon("lucide-picture-in-picture-2").setTitle(host.t.interface.menu.openInNewWindow()).onClick(() => plugin.openBookmarks([target.item], "window")));
      }
    };
    if (isMulti) {
      const items = Array.from(selected);
      openItems(this, "open");
      menu.addItem((mi) => mi.setSection("danger").setIcon("lucide-trash-2").setTitle(ng08BmT().menuOptRemove()).onClick(() => {
        for (const dom of items) plugin.removeItem(dom.item);
      }));
      app.workspace.trigger("bookmarks:bookmarks-menu", menu, items.map((d) => d.item));
    } else {
      menu.addItem((mi) => mi.setSection("action").setIcon("lucide-pencil").setTitle(ng08BmT().menuOptRename()).onClick(() => this.startRename()));
      menu.addItem((mi) => mi.setSection("action").setIcon("lucide-trash-2").setTitle(ng08BmT().menuOptRemove()).onClick(() => plugin.removeItem(item)));
      if (item.type === "file" || item.type === "folder" || item.type === "graph") {
        openItems(this, "open");
      }
      menu.addItem((mi) => mi.setSection("action").setIcon("lucide-wrench").setTitle(ng08BmT().menuOptEdit()).onClick(() => {
        new ng08Bm.BookmarkEditModal(plugin, item, true).open();
      }));
      if ((item.type === "file" || item.type === "folder") && app.vault.getAbstractFileByPath(item.path)) {
        menu.addItem((mi) => mi.setSection("view").setIcon("lucide-folder-open").setTitle(host.t.plugins.fileExplorer.actionRevealFile()).onClick(() => {
          const explorer = app.internalPlugins.getEnabledPluginById("file-explorer");
          if (explorer && explorer.revealInFolder) explorer.revealInFolder(app.vault.getAbstractFileByPath(item.path));
        }));
      }
      app.workspace.trigger("bookmarks:bookmarks-menu", menu, [item]);
    }
    menu.showAtMouseEvent(event);
  };

  ng08Bm.BookmarkLeafItem = BookmarkLeafItem;
  return BookmarkLeafItem;
}

/** Collapsible group rows with recursive children. */
export function ng08DefineBookmarkGroupItem(host) {
  const ItemBase = ng08Bm.BookmarkItemBase;
  const CollapsibleBase = ng15CollapsibleTreeItem(ItemBase);

  function BookmarkGroupItem(view, tree, item) {
    const self = CollapsibleBase.call(this, view, tree, item) || this;
    self.vChildren = new host.TreeChildren(self);
    self.setCollapsible(true);
    self.setClickable(true);
    return self;
  }
  inherit(BookmarkGroupItem, CollapsibleBase);
  const proto = BookmarkGroupItem.prototype;

  proto.refreshChildren = function () {
    const view = this.view;
    const item = this.item;
    const kids = [];
    for (const child of item.items || []) {
      const kid = view.getItemDom(child);
      kid.update();
      kids.push(kid);
    }
    this.vChildren.setChildren(kids);
    return kids;
  };

  proto.updateCollapsed = async function (animate) {
    if (!this.collapsed) this.tree.handleCollapseAll?.(false);
    await CollapsibleBase.prototype.updateCollapsed.call(this, animate);
    this.tree.infinityScroll.invalidate(this);
  };

  proto.onCollapseClick = function (event) {
    CollapsibleBase.prototype.onCollapseClick.call(this, event);
    this.tree.requestSaveFolds();
  };

  proto.onContextMenu = function (event) {
    const view = this.view;
    const plugin = view.plugin;
    const app = view.app;
    const tree = this.tree;
    const item = this.item;
    const menu = new host.Menu().addSections(["title", "open", "action", "view", "info", "", "danger"]);
    const selected = tree.selectedDoms;
    const isMulti = selected.size > 1 && selected.has(this);
    if (isMulti) {
      const items = Array.from(selected);
      menu.addItem((mi) => mi.setSection("danger").setIcon("lucide-trash-2").setTitle(ng08BmT().menuOptRemove()).onClick(() => {
        for (const dom of items) plugin.removeItem(dom.item);
      }));
      app.workspace.trigger("bookmarks:bookmarks-menu", menu, items.map((d) => d.item));
    } else {
      menu.addItem((mi) => mi.setSection("action").setIcon("lucide-pencil").setTitle(ng08BmT().menuOptRename()).onClick(() => this.startRename()));
      menu.addItem((mi) => mi.setSection("action").setIcon("lucide-trash-2").setTitle(ng08BmT().menuOptRemove()).onClick(() => plugin.removeItem(item)));
      menu.addItem((mi) => mi.setSection("action").setIcon("lucide-bookmark-plus").setTitle(ng08BmT().actionNewBookmark()).onClick(() => {
        const leaf = app.workspace.getMostRecentLeaf && app.workspace.getMostRecentLeaf();
        const bm = leaf && ng08ViewToBookmarkItem(leaf);
        if (bm) plugin.addItem(bm, item);
      }));
      menu.addItem((mi) => mi.setSection("action").setIcon("lucide-folder-plus").setTitle(ng08BmT().actionNewGroup()).onClick(() => view.createNewGroup(item)));
      const children = [];
      ng08WalkBookmarkItems(item.items || [], (child) => {
        if (child.type === "file" || child.type === "graph") children.push(child);
      });
      if (children.length) {
        menu.addItem((mi) => mi.setSection("open").setIcon("lucide-file-plus").setTitle(host.t.interface.menu.openInNewTab()).onClick(() => plugin.openBookmarks(children, true)));
        if (host.Platform.canSplit) {
          menu.addItem((mi) => mi.setSection("open").setIcon("lucide-separator-vertical").setTitle(host.t.interface.menu.openToTheRight()).onClick(() => plugin.openBookmarks(children, "split")));
        }
        if (host.Platform.canPopoutWindow) {
          menu.addItem((mi) => mi.setSection("open").setIcon("lucide-picture-in-picture-2").setTitle(host.t.interface.menu.openInNewWindow()).onClick(() => plugin.openBookmarks(children, "window")));
        }
      }
      menu.addItem((mi) => mi.setSection("action").setIcon("lucide-wrench").setTitle(ng08BmT().menuOptEdit()).onClick(() => {
        new ng08Bm.BookmarkEditModal(plugin, item, true).open();
      }));
      app.workspace.trigger("bookmarks:bookmarks-menu", menu, [item]);
    }
    menu.showAtMouseEvent(event);
  };

  ng08Bm.BookmarkGroupItem = BookmarkGroupItem;
  return BookmarkGroupItem;
}

// =====================================================================================================================
// Modals
// =====================================================================================================================

/** BookmarkEditModal: title input, read-only type row, group dropdown, save/remove. */
export function ng08DefineBookmarkEditModal(host) {
  const Base = host.DialogModal || host.ButtonModal;

  function BookmarkEditModal(plugin, item, isExisting, onAdded) {
    const self = Base.call(this, plugin.app) || this;
    self.plugin = plugin;
    self.item = item;
    self.isExisting = isExisting;
    self.onAdded = onAdded;
    self.bookmarkGroup = undefined;
    self.initialBookmarkGroup = undefined;
    self.modalEl.addClass("mod-bookmark");
    self.modalEl.addClass("mod-lg");
    const t = ng08BmT();
    self.setTitle(isExisting ? t.actionEditBookmark() : t.actionNewBookmark());
    self.typeSetting = null;
    self.titleInput = null;
    self.groupDropdown = null;
    self.groupByValue = new Map();
    self.save = self.save.bind(self);
    return self;
  }
  inherit(BookmarkEditModal, Base);
  const proto = BookmarkEditModal.prototype;

  proto.setBookmarkGroup = function (group) {
    // fluent: store desired group; applied when the dropdown exists
    this.bookmarkGroup = group;
    if (this.groupDropdown && this.groupByValue) {
      for (const [value, g] of this.groupByValue) {
        if (g === group) { this.groupDropdown.setValue(value); break; }
      }
    }
    return this;
  };

  proto.onOpen = function () {
    const plugin = this.plugin;
    const item = this.item;
    const t = ng08BmT();
    const content = this.contentEl;
    content.empty();
    const hostT = ng08Host().t;

    // read-only type row
    if (item.type === "file" || item.type === "folder") {
      let value = withoutMd(item.path);
      if (item.type === "file" && item.subpath) value += item.subpath;
      new host.Setting(content).setName(t.optionPath()).addText((text) => {
        text.setValue(value).inputEl.setAttribute("readonly", "true");
      });
    } else if (item.type === "search") {
      new host.Setting(content).setName(t.optionQuery()).addText((text) => {
        text.setValue(item.query).inputEl.setAttribute("readonly", "true");
      });
    } else if (item.type === "url") {
      new host.Setting(content).setName("URL").addText((text) => {
        text.setValue(item.url).inputEl.setAttribute("readonly", "true");
      });
    }

    // title field
    const suggested = plugin.getItemTitle(item);
    new host.Setting(content).setName(t.optionTitle()).addText((text) => {
      text.setPlaceholder(suggested || "")
        .setValue(item.title || "")
        .onChange((value) => { this.titleInput = value; });
      this.titleInput = item.title || "";
      text.inputEl.setAttribute("enterKeyHint", host.Platform.isAndroidApp ? "enter" : "done");
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === "Enter") this.save();
      });
      this.titleTextComponent = text;
    });

    // group dropdown: all groups recursively, pre-order, indented, random values
    const options = [];
    const byValue = this.groupByValue = new Map();
    const collect = (list, depth) => {
      for (const g of list || []) {
        if (g.type === "group") {
          const value = randomHex(8);
          options.push({ value, label: "    ".repeat(depth) + (g.title || "") });
          byValue.set(value, g);
          collect(g.items, depth + 1);
        }
      }
    };
    collect(plugin.items, 0);
    let group = undefined;
    new host.Setting(content).setName(t.optionGroup()).addDropdown((dropdown) => {
      this.groupDropdown = dropdown;
      for (const opt of options) dropdown.addOption(opt.value, opt.label);
      dropdown.onChange((value) => { group = byValue.get(value); });
      if (this.bookmarkGroup !== undefined) {
        for (const [value, g] of byValue) if (g === this.bookmarkGroup) dropdown.setValue(value);
      }
    });
    this._pendingGroup = () => group;

    // buttons
    if (host.Platform.isPhone) {
      // nav-action Cancel/Save in modalEl; existing -> warning remove in content
      const nav = this.modalEl.createDiv("modal-nav");
      const cancelBtn = nav.createEl("button", { cls: "mod-cancel", text: hostT.dialogue.buttonCancel() });
      cancelBtn.addEventListener("click", () => this.close());
      const saveBtn = nav.createEl("button", { cls: "mod-cta", text: hostT.dialogue.buttonSave() });
      saveBtn.addEventListener("click", () => this.save());
      if (this.isExisting) {
        const removeBtn = content.createEl("button", { cls: "mod-warning", text: t.menuOptRemove() });
        removeBtn.addEventListener("click", () => {
          plugin.removeItem(item);
          this.close();
        });
      } else {
        this.buttonContainerEl.detach();
      }
    } else {
      if (this.isExisting) {
        this.addButton(["mod-secondary", "mod-destructive"], t.menuOptRemove(), () => {
          plugin.removeItem(item);
          this.close();
          return true;
        });
      }
      this.addCancelButton();
      this.addButton("mod-cta", hostT.dialogue.buttonSave(), () => this.save());
    }
  };

  proto.save = function () {
    const plugin = this.plugin;
    const item = this.item;
    item.title = this.titleInput !== undefined ? this.titleInput : (this.titleTextComponent ? this.titleTextComponent.getValue() : item.title);
    const group = this._pendingGroup ? this._pendingGroup() : this.bookmarkGroup;
    if (this.isExisting) {
      plugin.editItem(item);
      const parent = ng08BmParentOf(item);
      if (group !== parent) {
        plugin.moveItem(item, group || null, group ? group.items.length - 1 : plugin.items.length - 1);
      }
    } else {
      plugin.addItem(item, group || null);
    }
    if (this.onAdded) this.onAdded();
    this.close();
    return true;
  };

  proto.onClose = function () {
    host.hideTooltip();
  };

  ng08Bm.BookmarkEditModal = BookmarkEditModal;
  return BookmarkEditModal;
}

function ng08BmParentOf(item) {
  return item[s28BookmarkParentSymbol] || null;
}

/** BookmarkManyModal: "Add N bookmarks" — wraps items into a new group. */
export function ng08DefineBookmarkManyModal(host) {
  const Base = host.DialogModal || host.ButtonModal;

  function BookmarkManyModal(app, plugin, items) {
    const self = Base.call(this, app) || this;
    self.app = app;
    self.plugin = plugin;
    self.items = items;
    self.modalEl.addClass("mod-bookmark");
    self.setTitle("Add " + items.length + " bookmarks");
    self.groupByValue = new Map();
    self._group = null;
    return self;
  }
  inherit(BookmarkManyModal, Base);
  const proto = BookmarkManyModal.prototype;

  proto.onOpen = function () {
    const t = ng08BmT();
    const content = this.contentEl;
    content.empty();
    const placeholder = window.moment().format("LLL");
    let title = "";
    new host.Setting(content).setName(t.optionTitle()).addText((text) => {
      text.setPlaceholder(placeholder).setValue("").onChange((v) => { title = v; });
      text.inputEl.setAttribute("enterKeyHint", host.Platform.isAndroidApp ? "enter" : "done");
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === "Enter") this.save(title);
      });
    });
    const options = [];
    const byValue = this.groupByValue = new Map();
    const collect = (list, depth) => {
      for (const g of list || []) {
        if (g.type === "group") {
          const value = randomHex(8);
          options.push({ value, label: "    ".repeat(depth) + (g.title || "") });
          byValue.set(value, g);
          collect(g.items, depth + 1);
        }
      }
    };
    collect(this.plugin.items, 0);
    new host.Setting(content).setName(t.optionGroup()).addDropdown((dropdown) => {
      for (const opt of options) dropdown.addOption(opt.value, opt.label);
      dropdown.onChange((value) => { this._group = byValue.get(value); });
    });
    this.addCancelButton();
    this.addButton("mod-cta", ng08Host().t.dialogue.buttonSave(), () => this.save(title));
  };

  proto.save = function (title) {
    const plugin = this.plugin;
    const groupItem = ng08BookmarkGroupItem(title || window.moment().format("LLL"));
    plugin.addItem(groupItem, this._group || null);
    for (const item of this.items) plugin.addItem(item, groupItem);
    this.close();
    return true;
  };

  proto.onClose = function () {
    host.hideTooltip();
  };

  ng08Bm.BookmarkManyModal = BookmarkManyModal;
  return BookmarkManyModal;
}
