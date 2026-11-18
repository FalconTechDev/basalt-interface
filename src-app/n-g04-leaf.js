import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { randomHex, copyText } from "./misc.js";
import { parseLinktext, normalizePath } from "./path.js";
import { debounceCall } from "./timing.js";

/**
 * Clean-room reimplementation of the leaf area (spec g04, part A).
 * Everything is composed from registries/tables; no class mirrors the old layout.
 */

const NG04_HISTORY_LIMIT = 20;

export function ng04LeafHistory(host) {
  function LeafHistory(owner) {
    this.owner = owner;
    this.backHistory = [];
    this.forwardHistory = [];
  }
  const proto = LeafHistory.prototype;

  proto.updateState = async function (entry) {
    const state = entry.state;
    state.popstate = true;
    await this.owner.setViewState(state, entry.eState);
    this.owner.trigger("history-change");
  };

  proto.forward = function () {
    return this.go(1);
  };

  proto.back = function () {
    return this.go(-1);
  };

  proto.pushState = function (entry) {
    const back = this.backHistory;
    back.push(entry);
    if (back.length > NG04_HISTORY_LIMIT) back.shift();
    this.forwardHistory = [];
    this.owner.trigger("history-change");
  };

  proto.go = async function (steps) {
    if (this.owner.working) {
      new host.Notice(host.t.interface.msgTabBusy());
      return;
    }
    const owner = this.owner;
    let i = 0;
    let previous = null;
    while (i !== steps) {
      const forward = steps > 0;
      const source = forward ? this.forwardHistory : this.backHistory;
      const target = source.pop();
      if (!target) break;
      i += forward ? 1 : -1;
      const leaving = previous || owner.getHistoryState();
      (forward ? this.backHistory : this.forwardHistory).push(leaving);
      await this.updateState(target);
      previous = target;
    }
  };

  proto.serialize = function () {
    return {
      backHistory: this.backHistory.slice(),
      forwardHistory: this.forwardHistory.slice(),
    };
  };

  proto.deserialize = function (data) {
    if (!data) return;
    if (Object.prototype.hasOwnProperty.call(data, "backHistory")) this.backHistory = data.backHistory;
    if (Object.prototype.hasOwnProperty.call(data, "forwardHistory")) this.forwardHistory = data.forwardHistory;
    this.owner.trigger("history-change");
  };

  return LeafHistory;
}

export function ng04WorkspaceLeaf(host) {
  function WorkspaceLeaf(app, id) {
    const self = host.WorkspaceItem.call(this, app.workspace, id) || this;
    self.type = "leaf";
    self.activeTime = 0;
    self.history = new host.LeafHistory(self);
    self.hoverPopover = null;
    self.group = null;
    self.pinned = false;
    self.width = 0;
    self.height = 0;
    self.working = false;
    self.view = null;
    self._empty = null;
    self.tabHeaderEl = null;
    self.tabHeaderInnerEl = null;
    self.tabHeaderInnerIconEl = null;
    self.tabHeaderInnerTitleEl = null;
    self.tabHeaderStatusContainerEl = null;
    self.tabHeaderCloseEl = null;
    self.tabHeaderStatusLinkEl = null;
    self.tabHeaderStatusPinEl = null;

    self.containerEl.addClass("workspace-leaf");

    self.containerEl.addEventListener("focusin", () => {
      self.workspace.setActiveLeaf(self);
    });
    self.containerEl.addEventListener("pointerdown", () => {
      self.workspace.setActiveLeaf(self);
    }, true);

    const header = (self.tabHeaderEl = env().createDiv("workspace-tab-header tappable"));
    header.draggable = true;
    const inner = (self.tabHeaderInnerEl = header.createDiv("workspace-tab-header-inner"));
    self.tabHeaderInnerIconEl = inner.createDiv("workspace-tab-header-inner-icon");
    self.tabHeaderInnerTitleEl = inner.createDiv("workspace-tab-header-inner-title");
    self.tabHeaderStatusContainerEl = inner.createDiv("workspace-tab-header-status-container");
    self.tabHeaderCloseEl = inner.createDiv("workspace-tab-header-inner-close-button");
    host.setIcon(self.tabHeaderCloseEl, "lucide-x");
    host.setTooltip(self.tabHeaderCloseEl, host.t.interface.menu.close(), { delay: host.TOOLTIP_DELAY });
    self.tabHeaderCloseEl.addEventListener("click", () => {
      self.detach();
    });

    header.addEventListener("dragstart", (event) => {
      self.workspace.onDragLeaf(event, self);
    });
    header.addEventListener("contextmenu", (event) => {
      self.onOpenTabHeaderMenu(event, header);
    });
    header.addEventListener("mousedown", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    header.addEventListener("auxclick", (event) => {
      if (event.button === 1) self.detach();
    });
    header.addEventListener("mouseover", (event) => {
      if (event.defaultPrevented) return;
      if (!host.pointerEntered(event, header)) return;
      const state = self.getViewState().state || {};
      const file = state.file;
      if (typeof file !== "string" || !file) return;
      const target = self.app.vault.getAbstractFileByPath(normalizePath(file));
      if (target instanceof host.TFile) {
        self.workspace.trigger("hover-link", {
          event,
          source: "tab-header",
          hoverParent: self,
          targetEl: header,
          linktext: file,
        });
      }
    });

    self.resizeObserver = new ResizeObserver(
      debounceCall(() => {
        const { offsetWidth: w, offsetHeight: h } = self.containerEl;
        if (w === self.width && h === self.height) return;
        self.width = w;
        self.height = h;
        self.onResize();
      }, 20)
    );
    self.resizeObserver.observe(self.containerEl);

    self._empty = new host.EmptyView(self);
    self.open(self._empty);

    return self;
  }

  inherit(WorkspaceLeaf, host.WorkspaceItem);
  const proto = WorkspaceLeaf.prototype;

  proto.getViewState = function () {
    const view = this.view;
    let result;
    if (!view || view instanceof host.EmptyView) {
      result = { type: "empty", state: {} };
    } else {
      result = {
        type: view.getViewType(),
        state: view.getState(),
      };
      const icon = view.getIcon();
      if (icon) result.icon = icon;
      const title = view.getDisplayText().trim();
      if (title) result.title = title;
    }
    if (this.pinned) result.pinned = true;
    return result;
  };

  proto.setViewState = async function (viewState, eState) {
    if (this.working) return;
    this.working = true;
    const app = this.app;
    const workspace = this.workspace;
    try {
      viewState = viewState || {};
      const type = typeof viewState.type === "string" ? viewState.type : "";
      const state = viewState.state || {};
      const currentType = this.view ? this.view.getViewType() : "";
      const wasDeferred = this.view instanceof host.DeferredView;
      const typeChanged = type !== currentType;
      const swapped = typeChanged || wasDeferred;
      const oldView = this.view;
      const hadLeftState = !!(oldView && oldView.navigation && !(oldView instanceof host.EmptyView) && !wasDeferred);
      const historyEntry = hadLeftState ? this.getHistoryState() : null;
      const deferredKeptType = wasDeferred && type === currentType && this.view instanceof host.DeferredView;

      if (swapped) {
        const creator = type ? app.viewRegistry.getViewCreatorByType(type) : undefined;
        let replacement = null;
        if (creator) {
          const cheap =
            !wasDeferred &&
            !viewState.popstate &&
            !state.sync &&
            !hadLeftState &&
            viewState.icon !== undefined &&
            viewState.title !== undefined &&
            !this.containerEl.isShown();
          replacement = cheap ? new host.DeferredView(this, type, viewState.icon, viewState.title) : creator(this);
        } else if (!type || type === "empty") {
          replacement = this._empty;
        } else {
          replacement = new host.UnknownView(this, type);
        }
        await this.open(replacement);
      }

      const view = this.view;
      const result = {};
      try {
        await view.setState(state, result);
      } catch (e) {
        console.error(e);
      }
      if (swapped) {
        if (result.history === undefined) result.history = true;
        if (result.layout === undefined) result.layout = true;
      }
      if (result.close) await this.open(null);

      if (viewState.active) workspace.setActiveLeaf(this, { focus: true });
      if (viewState.group !== undefined) this.setGroupMember(viewState.group === null ? null : viewState.group);
      if (eState) this.setEphemeralState(eState);

      if (historyEntry && result.history !== false && !viewState.popstate && !state.sync && !deferredKeptType) {
        this.recordHistory(historyEntry);
      }
      if (result.layout) workspace.onLayoutChange(this);
      if (result.done) result.done();
      this.updateHeader();
    } finally {
      this.working = false;
    }
  };

  proto.open = async function (view) {
    if (view === this.view) return view;
    const old = this.view;
    if (old) {
      if (old instanceof host.DeferredView || old instanceof host.EmptyView) old.close();
      else await old.close();
    }
    const container = this.containerEl;
    for (const child of Array.from(container.children)) {
      if (child !== this.resizeHandleEl) child.remove();
    }
    this.view = view || this._empty;
    try {
      await this.view.open(container);
    } catch (e) {
      console.error(e);
    }
    return this.view;
  };

  proto.setEphemeralState = function (eState) {
    if (eState && eState.focus) {
      const doc = this.containerEl.win ? this.containerEl.win.document : document;
      const active = doc.activeElement;
      if (
        active instanceof doc.defaultView.HTMLElement &&
        active !== doc.body &&
        !this.containerEl.contains(active)
      ) {
        if (this.workspace.layoutReady) {
          active.blur();
          const sel = doc.getSelection();
          if (sel) sel.removeAllRanges();
        }
      }
    }
    if (this.view) this.view.setEphemeralState(eState);
  };

  proto.getEphemeralState = function () {
    return this.view ? this.view.getEphemeralState() : {};
  };

  proto.openLinkText = async function (linktext, sourcePath, options) {
    options = options || {};
    const { path, subpath } = parseLinktext(linktext);
    const app = this.app;
    const file = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    const eState = Object.assign({}, options.eState);
    if (subpath) eState.subpath = subpath;
    if (file) {
      return this.openFile(file, Object.assign({}, options, { eState }));
    }
    try {
      const created = await app.fileManager.createNewMarkdownFileFromLinktext(linktext, sourcePath);
      return this.openFile(created, Object.assign({}, options, {
        state: Object.assign({ mode: "source" }, options.state),
        eState,
      }));
    } catch (e) {
      new host.Notice(e.message);
      console.error(e);
    }
  };

  proto.openFile = function (file, options) {
    options = options || {};
    const app = this.app;
    const extension = file.extension;
    let type;
    if (this.view instanceof host.FileView && this.view.canAcceptExtension(extension)) {
      type = this.view.getViewType();
    } else {
      type = app.viewRegistry.getTypeByExtension(extension);
    }
    if (!type) {
      app.openWithDefaultApp(file.path);
      return;
    }
    const state = Object.assign({}, options.state, { file: file.path });
    return this.setViewState({
      type,
      state,
      active: options.active != null ? options.active : this.isActiveLeaf(),
      group: options.group,
    }, options.eState);
  };

  proto.isActiveLeaf = function () {
    return this.workspace.activeLeaf === this;
  };

  proto.canNavigate = function () {
    return !!(this.view && this.view.navigation && !this.pinned);
  };

  proto.canPin = function () {
    return this.parent instanceof host.WorkspaceTabs;
  };

  proto.togglePinned = function () {
    this.setPinned(!this.pinned);
  };

  proto.setPinned = function (pinned) {
    if (this.pinned === pinned) return;
    this.pinned = pinned;
    this.trigger("pinned-change");
    this.updateHeader();
    this.workspace.requestSaveLayout();
    if (this.group) {
      for (const leaf of this.workspace.getGroupLeaves(this.group)) {
        if (leaf !== this && leaf.pinned !== pinned) leaf.setPinned(pinned);
      }
    }
  };

  proto.setGroupMember = function (other) {
    if (other === this) return;
    if (other instanceof host.WorkspaceLeaf) {
      let group = other.group;
      if (!group) {
        group = randomHex(16);
        other.setGroup(group);
      }
      this.setGroup(group);
    } else {
      this.setGroup(null);
    }
  };

  proto.setGroup = function (group) {
    if (this.group === group) return;
    let adoptPin = false;
    if (group) {
      for (const leaf of this.workspace.getGroupLeaves(group)) {
        if (leaf !== this && leaf.pinned) {
          adoptPin = true;
          break;
        }
      }
    }
    this.setPinned(adoptPin);
    this.group = group;
    this.trigger("group-change");
    this.updateHeader();
    this.workspace.requestUpdateLayout();
  };

  proto.getGroup = function () {
    return this.group;
  };

  proto.highlight = function () {
    this.containerEl.addClass("is-highlighted");
  };

  proto.unhighlight = function () {
    this.containerEl.removeClass("is-highlighted");
  };

  proto.loadIfDeferred = async function () {
    if (this.view instanceof host.DeferredView) return this.view.rerender();
  };

  proto.rebuildView = async function () {
    const state = this.getViewState();
    const eState = this.getEphemeralState();
    await this.open(null);
    await this.setViewState(state, eState);
  };

  proto.getHistoryState = function () {
    return {
      title: this.getDisplayText(),
      icon: this.getIcon(),
      state: this.getViewState(),
      eState: this.getEphemeralState(),
    };
  };

  proto.recordHistory = function (entry) {
    const view = this.view;
    if (!view || !view.navigation || view instanceof host.EmptyView) return;
    const back = this.history.backHistory;
    const last = back[back.length - 1];
    if (last && JSON.stringify(last.state) === JSON.stringify(entry.state)) return;
    this.history.pushState(entry);
  };

  proto.detach = function () {
    const parent = this.parent;
    const parentId = parent ? parent.id : null;
    const root = this.getRoot();
    const rootId = root ? root.id : null;
    host.WorkspaceItem.prototype.detach.call(this);
    if (this.group) {
      for (const other of this.workspace.getGroupLeaves(this.group)) other.unhighlight();
    }
    this.workspace.pushUndoHistory(this, parentId, rootId);
    if (this.view) this.view.close();
    this.view = this._empty;
    if (this._empty.containerEl.parentNode !== this.containerEl) {
      this.containerEl.appendChild(this._empty.containerEl);
    }
    if (this.resizeObserver) this.resizeObserver.disconnect();
  };

  proto.updateHeader = function () {
    const header = this.tabHeaderEl;
    const view = this.view;
    host.setIcon(this.tabHeaderInnerIconEl, view && view.getIcon ? view.getIcon() : "");
    const title = this.getDisplayText();
    this.tabHeaderInnerTitleEl.setText(title);
    const status = this.tabHeaderStatusContainerEl;

    if (this.group) {
      if (!this.tabHeaderStatusLinkEl) {
        this.tabHeaderStatusLinkEl = status.createDiv("workspace-tab-header-status-icon mod-linked", (el) => {
          host.setIcon(el, "lucide-link");
          host.setTooltip(el, host.t.interface.menu.unlinkTab(), { delay: host.TOOLTIP_DELAY });
          el.addEventListener("click", () => {
            if (this.group) {
              for (const leaf of this.workspace.getGroupLeaves(this.group)) leaf.unhighlight();
            }
            this.setGroup(null);
          });
          el.addEventListener("mouseover", () => {
            host.setIcon(el, "lucide-unlink");
            if (this.group) {
              for (const leaf of this.workspace.getGroupLeaves(this.group)) leaf.highlight();
            }
          });
          el.addEventListener("mouseout", () => {
            host.setIcon(el, "lucide-link");
            if (this.group) {
              for (const leaf of this.workspace.getGroupLeaves(this.group)) leaf.unhighlight();
            }
          });
        });
        status.prepend(this.tabHeaderStatusLinkEl);
      }
    } else if (this.tabHeaderStatusLinkEl) {
      this.tabHeaderStatusLinkEl.remove();
      this.tabHeaderStatusLinkEl = null;
    }

    if (this.pinned) {
      this.tabHeaderCloseEl.hide();
      if (!this.tabHeaderStatusPinEl) {
        this.tabHeaderStatusPinEl = status.createDiv("workspace-tab-header-status-icon mod-pinned", (el) => {
          host.setIcon(el, "lucide-pin");
          host.setTooltip(el, host.t.interface.menu.unpin(), { delay: host.TOOLTIP_DELAY });
          el.addEventListener("click", () => this.setPinned(false));
        });
      }
      this.tabHeaderStatusPinEl.show();
    } else {
      this.tabHeaderCloseEl.show();
      if (this.tabHeaderStatusPinEl) this.tabHeaderStatusPinEl.hide();
    }

    host.setTooltip(header, env().gc(title, 100), { delay: host.TOOLTIP_DELAY });
    if (this.parent instanceof host.MobileDrawer) this.parent.updateCurrentTab();
    header.setAttribute("data-type", view ? view.getViewType() : "");
    header.toggleClass("mod-unknown", view instanceof host.UnknownView);
  };

  proto.getDisplayText = function () {
    if (this.view) return this.view.getDisplayText();
    return "";
  };

  proto.getIcon = function () {
    const icon = this.view ? this.view.getIcon() : "";
    return icon || "lucide-file";
  };

  proto.getViewType = function () {
    return this.view ? this.view.getViewType() : "";
  };

  proto.onResize = function () {
    if (this.view && this.view.onResize) this.view.onResize();
  };

  proto.onOpenTabHeaderMenu = function (event, targetEl) {
    event.preventDefault();
    const menu = host.Menu.forEvent(event);
    menu.addSections(["title", "close", "pane", "open", "action", "find", "info", "info.copy", "view", "view.linked", "system", "", "danger"]);
    menu.setSectionSubmenu("info.copy", { title: host.t.interface.menu.copyPath(), icon: "lucide-clipboard" });
    menu.setSectionSubmenu("view.linked", { title: host.t.interface.menu.openLinkedView(), icon: "lucide-link" });
    const leaf = this;
    const view = this.view;
    const file = view instanceof host.FileView ? view.file : null;

    if (host.Platform.isPhone) {
      menu.addItem((item) => item
        .setSection("title")
        .setTitle(this.getDisplayText())
        .setIcon(this.getIcon())
        .setIsLabel());
    }

    menu.addItem((item) => item
      .setSection("close")
      .setTitle(host.t.interface.menu.close())
      .setIcon("lucide-x")
      .onClick(() => leaf.detach()));

    if (leaf.canPin()) {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(leaf.pinned ? host.t.interface.menu.unpin() : host.t.interface.menu.pin())
        .setIcon(leaf.pinned ? "lucide-pin-off" : "lucide-pin")
        .onClick(() => leaf.togglePinned()));
    }
    const siblings = leaf.parent instanceof host.WorkspaceTabs ? leaf.parent.children.filter((c) => c !== leaf) : [];
    if (siblings.length > 0) {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(host.t.interface.menu.closeOthers())
        .setIcon("lucide-columns-2")
        .onClick(() => {
          for (const other of siblings) if (!other.pinned) other.detach();
        }));
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(host.t.interface.menu.closeAll())
        .setIcon("lucide-trash-2")
        .onClick(() => {
          for (const other of [leaf, ...siblings]) other.detach();
        }));
    }
    if (leaf.group) {
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(host.t.interface.menu.unlinkTab())
        .setIcon("lucide-unlink")
        .onClick(() => {
          for (const other of leaf.workspace.getGroupLeaves(leaf.group)) other.unhighlight();
          leaf.setGroup(null);
        }));
    }
    menu.addItem((item) => item
      .setSection("open")
      .setTitle(host.t.interface.menu.openInNewTab())
      .setIcon("lucide-copy-plus")
      .onClick(() => {
        leaf.workspace.getLeaf("tab").setViewState(leaf.getViewState());
      }));
    if (host.Platform.canPopoutWindow) {
      menu.addItem((item) => item
        .setSection("open")
        .setTitle(host.t.interface.menu.openInNewWindow())
        .setIcon("lucide-app-window")
        .onClick(() => leaf.workspace.openPopoutLeaf().setViewState(leaf.getViewState())));
    }
    if (file) {
      menu.addItem((item) => item
        .setSection("info.copy")
        .setTitle(host.t.interface.menu.copyPath())
        .setIcon("lucide-copy")
        .onClick(() => copyText(file.path)));
      menu.addItem((item) => item
        .setSection("info.copy")
        .setTitle(host.t.interface.menu.copyObsidianUrl ? host.t.interface.menu.copyObsidianUrl() : host.t.interface.menu.copyUrl())
        .setIcon("lucide-link")
        .onClick(() => copyText(leaf.app.getObsidianUrl ? leaf.app.getObsidianUrl(file) : file.path)));
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(env().gm.plugins.fileExplorer.menuOptRename ? env().gm.plugins.fileExplorer.menuOptRename() : host.t.interface.menu.rename())
        .setIcon("lucide-edit-3")
        .onClick(() => leaf.app.fileManager.promptForFileRename(file)));
      if (host.Platform.isDesktopApp) {
        menu.addItem((item) => item
          .setSection("system")
          .setTitle(host.Platform.isMacOS ? env().gm.plugins.openWithDefaultApp.actionShowInFolderMac() : env().gm.plugins.openWithDefaultApp.actionShowInFolder())
          .setIcon("lucide-folder-open")
          .onClick(() => leaf.app.showInFolder(file.path)));
      }
    }

    if (view && view.onTabMenu) view.onTabMenu(menu);
    const visible = this.isVisible();
    const switcher = this.app.mobileTabSwitcher;
    const switcherVisible = !!(switcher && switcher.containerEl && switcher.containerEl.isShown && switcher.containerEl.isShown());
    if (visible && !(host.Platform.isMobile && switcherVisible)) {
      const inSidebar = this.workspace.isInSidebar(this);
      if (view && view.onPaneMenu) view.onPaneMenu(menu, inSidebar ? "sidebar-context-menu" : "tab-header");
      this.workspace.trigger("leaf-menu", menu, this);
    }
    menu.setParentElement(targetEl || this.tabHeaderEl);
    return false;
  };

  proto.handleDrop = function (event, data, isPreview) {
    const kind = data && data.type;
    const ui = host.t.interface.dragAndDrop;
    if (kind === "bookmarks") {
      const plugin = this.app.internalPlugins.getEnabledPluginById("bookmarks");
      if (!plugin) return undefined;
      const items = (data.items || []).map((entry) => entry.item || entry).filter((item) => item && (item.type === "file" || item.type === "graph"));
      if (items.length !== 1) return undefined;
      if (!isPreview) {
        this.workspace.setActiveLeaf(this);
        plugin.openBookmarkInLeaf(items[0], this, { active: true });
      }
      return { action: ui.openInThisTab(), dropEffect: "move" };
    }
    if (kind === "file" || kind === "link") {
      if (!isPreview) {
        this.workspace.setActiveLeaf(this);
        if (kind === "file") this.openFile(data.file);
        else this.openLinkText(data.linktext, data.sourcePath);
      }
      return { action: ui.openInThisTab(), dropEffect: "move" };
    }
    return undefined;
  };

  proto.isVisible = function () {
    return this.containerEl.isShown();
  };

  proto.getRoot = function () {
    return host.WorkspaceItem.prototype.getRoot.call(this);
  };

  Object.defineProperty(WorkspaceLeaf.prototype, "isDeferred", {
    get() { return this.view instanceof host.DeferredView; },
    enumerable: true,
    configurable: true,
  });

  proto.serialize = function () {
    const data = host.WorkspaceItem.prototype.serialize.call(this);
    if (this.pinned) data.pinned = true;
    data.state = this.getViewState();
    if (this.group) data.group = this.group;
    return data;
  };

  return WorkspaceLeaf;
}
