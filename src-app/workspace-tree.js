// The layout tree of the workspace: WorkspaceItem -> WorkspaceParent -> WorkspaceSplit -> WorkspaceContainer (root / window),
// plus WorkspaceFloating. Leaves (WorkspaceLeaf), tab groups and side docks derive from these.
//
// Shape of the tree: a container (root split or a pop-out window) holds splits; a split holds splits or tab groups; a tab group
// holds leaves. Every node owns one DOM element (`containerEl`) and knows its parent. `dimension` is the share of the parent's
// size in percent (null = automatic), stored as the flex-grow of the element.
import { inherit } from "./inherit.js";
import { randomHex } from "./misc.js";
import { debounceCall } from "./timing.js";

/** Smallest size (px) a split child may be dragged to. */
const MIN_PANE_SIZE = 200;

export function defineWorkspaceItem(host) {
  /**
   * Base of every node. Emits events (it is an Events), owns a Component that lives as long as the node and the resize handle
   * that sits between this node and its next sibling.
   */
  function WorkspaceItem(workspace, id) {
    const self = host.Events.call(this) || this;
    self.containerEl = null;
    self.dimension = null;
    self.component = new host.Component();
    self.app = workspace.app;
    self.workspace = workspace;
    self.id = id || randomHex(16);
    self.containerEl = createDiv();
    self.resizeHandleEl = self.containerEl.createEl("hr", "workspace-leaf-resize-handle");
    self.component.load();
    self.resizeHandleEl.addEventListener("mousedown", self.onResizeStart.bind(self));
    return self;
  }
  inherit(WorkspaceItem, host.Events);

  // plugins read `leaf.parentSplit`
  Object.defineProperty(WorkspaceItem.prototype, "parentSplit", {
    get() { return this.parent; },
    enumerable: false,
    configurable: true,
  });

  WorkspaceItem.prototype.serialize = function () {
    const data = { id: this.id, type: this.type };
    if (this.dimension) data.dimension = this.dimension;
    return data;
  };

  WorkspaceItem.prototype.onResizeStart = function (event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const parent = this.parent;
    if (parent instanceof host.WorkspaceSplit) parent.onChildResizeStart(this, event);
  };

  WorkspaceItem.prototype.setParent = function (parent) { this.parent = parent; };

  /** Topmost ancestor (the node itself when it has no parent). */
  WorkspaceItem.prototype.getRoot = function () {
    let node = this;
    while (node.parent) node = node.parent;
    return node;
  };

  /** The root split or pop-out window this node lives in; detached nodes report the main root split. */
  WorkspaceItem.prototype.getContainer = function () {
    let node = this;
    while (node.parent) {
      if (node instanceof host.WorkspaceContainer) return node;
      node = node.parent;
    }
    return node instanceof host.WorkspaceContainer ? node : this.workspace.rootSplit;
  };

  /** Sets the share (percent, exclusive 0..100) of the parent; anything else clears it. */
  WorkspaceItem.prototype.setDimension = function (percent) {
    if (percent !== null && (percent <= 0 || percent >= 100)) percent = null;
    this.dimension = percent;
    this.containerEl.style.flexGrow = percent ? String(percent) : "";
  };

  WorkspaceItem.prototype.detach = function () {
    if (this.parent) this.parent.removeChild(this);
  };

  WorkspaceItem.prototype.getIcon = function () { return "lucide-file"; };

  return WorkspaceItem;
}

export function defineWorkspaceParent(host) {
  /** A node with children (splits, tab groups, floating windows list). */
  function WorkspaceParent() {
    const self = host.WorkspaceItem.apply(this, arguments) || this;
    // a parent that would be left with a single child is collapsed into its own parent, unless this is set
    self.allowSingleChild = false;
    // false for tab groups, which lay their children out themselves
    self.autoManageDOM = true;
    return self;
  }
  inherit(WorkspaceParent, host.WorkspaceItem);

  WorkspaceParent.prototype.serialize = function () {
    const data = host.WorkspaceItem.prototype.serialize.call(this);
    data.children = this.children.map((child) => child.serialize());
    return data;
  };

  /** Puts `node` where the child at `index` was; the old child is detached from the DOM and orphaned. */
  WorkspaceParent.prototype.replaceChild = function (index, node) {
    const { workspace, autoManageDOM, containerEl, children } = this;
    if (index < 0) index = 0;
    if (index >= children.length) index = children.length;
    const old = children[index];
    const next = old.containerEl.nextSibling;
    if (autoManageDOM) old.containerEl.detach();
    old.setParent(null);
    children[index] = node;
    if (autoManageDOM) containerEl.insertBefore(node.containerEl, next);
    node.setParent(this);
    workspace.onLayoutChange(this);
  };

  /** Inserts `node` before the child at `index` (appends when out of range). */
  WorkspaceParent.prototype.insertChild = function (index, node) {
    const { workspace, autoManageDOM, containerEl, children } = this;
    if (index < 0 || index >= children.length) index = children.length;
    const before = children[index];
    const beforeEl = before ? before.containerEl : null;
    children.splice(index, 0, node);
    if (autoManageDOM) containerEl.insertBefore(node.containerEl, beforeEl);
    node.setParent(this);
    workspace.onLayoutChange(this);
  };

  /**
   * Removes a child. An empty parent removes itself from its own parent; a parent left with exactly one child is replaced by that
   * child (which takes over its share of the space), unless `allowSingleChild`.
   */
  WorkspaceParent.prototype.removeChild = function (node) {
    const { workspace, autoManageDOM, parent, children } = this;
    children.remove(node);
    node.setParent(null);
    if (autoManageDOM) node.containerEl.detach();
    if (parent) {
      if (children.length === 1 && !this.allowSingleChild) {
        const survivor = children[0];
        children.remove(survivor);
        if (autoManageDOM) survivor.containerEl.detach();
        survivor.setParent(null);
        const at = parent.children.indexOf(this);
        if (autoManageDOM) parent.replaceChild(at, survivor);
        survivor.setDimension(this.dimension);
      } else if (children.length === 0) {
        parent.removeChild(this);
        return;
      }
    }
    workspace.onLayoutChange(this);
  };

  WorkspaceParent.prototype.recomputeChildrenDimensions = function () {};

  return WorkspaceParent;
}

export function defineWorkspaceSplit(host) {
  /** A row ("vertical" direction = children side by side) or column of nodes with draggable dividers. */
  function WorkspaceSplit(workspace, direction, id) {
    const self = host.WorkspaceParent.call(this, workspace, id) || this;
    self.parent = null;
    self.children = [];
    self.type = "split";
    self.direction = null;
    self.resizeStartPos = null;
    self.originalSizes = null;
    self.isResizing = false;
    self.workspace = workspace;
    self.containerEl.addClass("workspace-split");
    self.setDirection(direction);
    return self;
  }
  inherit(WorkspaceSplit, host.WorkspaceParent);

  WorkspaceSplit.prototype.serialize = function () {
    const data = host.WorkspaceParent.prototype.serialize.call(this);
    data.direction = this.direction;
    return data;
  };

  WorkspaceSplit.prototype.setDirection = function (direction) {
    this.containerEl.removeClass("mod-" + this.direction);
    this.direction = direction;
    this.containerEl.addClass("mod-" + direction);
  };

  /** Rescales the children's dimensions so they add up to 100 (or resets all when one of them has none). */
  WorkspaceSplit.prototype.recomputeChildrenDimensions = function () {
    const children = this.children;
    let sum = 0;
    for (const child of children) {
      if (child.dimension == null) { sum = null; break; }
      sum += child.dimension;
    }
    for (const child of children) {
      if (sum == null || isNaN(sum)) child.setDimension(null);
      else child.setDimension((100 * child.dimension) / sum);
    }
    this.workspace.requestResize();
  };

  /** Drag of the divider after `child`: neighbours on the far side shrink first, the ones on the near side grow. */
  WorkspaceSplit.prototype.onChildResizeStart = function (child, downEvent) {
    if (downEvent.button !== 0) return;
    const win = downEvent.win;
    this.resizeStartPos = { x: downEvent.clientX, y: downEvent.clientY };

    const onMove = (event) => {
      if (event.button !== 0) return;
      let delta = 0;
      if (this.direction === "vertical") delta = event.clientX - this.resizeStartPos.x;
      else if (this.direction === "horizontal") delta = event.clientY - this.resizeStartPos.y;
      const at = this.children.indexOf(child);
      if (!this.isResizing) {
        this.originalSizes = this.children.map((c) => this.getElSize(c.containerEl));
        this.isResizing = true;
      }
      const before = this.children.slice(0, at + 1).reverse();
      const after = this.children.slice(at + 1);
      if (delta > 0) {
        const moved = this.resizeItemsByDiff(after, delta, 1);
        if (Math.abs(delta) > moved) delta = moved;
        this.resizeItemsByDiff(before, delta, -1);
      } else {
        const moved = this.resizeItemsByDiff(before, delta, -1);
        if (Math.abs(delta) > moved) delta = -moved;
        this.resizeItemsByDiff(after, delta, 1);
      }
      event.preventDefault();
    };
    const onUp = () => {
      win.removeEventListener("mousemove", onMove);
      win.removeEventListener("mouseup", onUp);
      document.body.removeClass("is-grabbing");
      try { this.finishResize(); } catch (err) { console.error(err); }
    };
    win.addEventListener("mousemove", onMove);
    win.addEventListener("mouseup", onUp);
    document.body.addClass("is-grabbing");
  };

  /** Resizes `items` (in order) by `delta` px in direction `sign`, none below MIN_PANE_SIZE; returns how many px were absorbed. */
  WorkspaceSplit.prototype.resizeItemsByDiff = function (items, delta, sign) {
    let absorbed = 0;
    for (const item of items) {
      const at = this.children.indexOf(item);
      const original = this.originalSizes[at];
      let size = original - delta * sign;
      size = Math.max(MIN_PANE_SIZE, size);
      const change = original - size;
      delta -= change * sign;
      absorbed += Math.abs(change);
      this.setElSize(this.children[at].containerEl, size);
    }
    return absorbed;
  };

  /** Turns the pixel sizes the drag produced back into percentages. */
  WorkspaceSplit.prototype.finishResize = function () {
    this.isResizing = false;
    this.resizeStartPos = null;
    const children = this.children;
    const sizes = [];
    let total = 0;
    for (const child of children) {
      const size = this.getElSize(child.containerEl);
      sizes.push(size);
      total += size;
    }
    children.forEach((child, i) => {
      this.unsetElSize(child.containerEl);
      child.setDimension((sizes[i] / total) * 100);
    });
    this.workspace.requestSaveLayout();
    this.workspace.requestResize();
  };

  WorkspaceSplit.prototype.getElSize = function (el) {
    if (this.direction === "vertical") return el.offsetWidth;
    if (this.direction === "horizontal") return el.offsetHeight;
    return undefined;
  };

  WorkspaceSplit.prototype.setElSize = function (el, px) {
    el.style.flex = "0 0 auto";
    if (this.direction === "vertical") el.style.width = `${px}px`;
    else if (this.direction === "horizontal") el.style.height = `${px}px`;
  };

  WorkspaceSplit.prototype.unsetElSize = function (el) {
    el.style.flex = "";
    el.style.width = "";
    el.style.height = "";
  };

  return WorkspaceSplit;
}

export function defineWorkspaceContainer(host) {
  /** A split that is the top of a window (the main root or a pop-out): a single child is fine, and it can take focus. */
  function WorkspaceContainer() {
    const self = host.WorkspaceSplit.apply(this, arguments) || this;
    self.allowSingleChild = true;
    return self;
  }
  inherit(WorkspaceContainer, host.WorkspaceSplit);

  /** The window got focus: after a short delay make its most recent leaf the active one (unless the active leaf is already here). */
  WorkspaceContainer.prototype.onFocus = function () {
    setTimeout(() => {
      if (!this.doc.hasFocus()) return;
      const modalOpen = !!this.doc.querySelector(".modal-container");
      const workspace = this.workspace;
      const active = workspace.activeLeaf;
      if (!active || active.getContainer() !== this) {
        const leaf = workspace.getMostRecentLeaf(this);
        if (leaf) workspace.setActiveLeaf(leaf, { focus: !host.Platform.isMobile && !modalOpen });
      }
    }, 100);
  };

  /** Brings the OS window forward (restoring it when minimised). */
  WorkspaceContainer.prototype.focus = function () {
    if (host.Platform.isDesktopApp && !this.doc.hasFocus()) {
      const win = this.win.electronWindow;
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  };

  return WorkspaceContainer;
}

export function defineWorkspaceRoot(host) {
  /** The root split of the main window. */
  function WorkspaceRoot(workspace, direction, id) {
    const self = host.WorkspaceContainer.call(this, workspace, direction, id) || this;
    self.win = window;
    self.doc = document;
    self.containerEl.addClass("mod-root");
    return self;
  }
  return inherit(WorkspaceRoot, host.WorkspaceContainer);
}

export function defineWorkspaceFloating(host) {
  /** Holds the pop-out windows; draws nothing itself. */
  function WorkspaceFloating() {
    const self = host.WorkspaceParent.apply(this, arguments) || this;
    self.parent = null;
    self.children = [];
    self.type = "floating";
    self.allowSingleChild = true;
    self.autoManageDOM = false;
    return self;
  }
  return inherit(WorkspaceFloating, host.WorkspaceParent);
}

export function defineWorkspaceWindow(host) {
  /** A pop-out window: a second Electron window that hosts its own root split. */
  function WorkspaceWindow(workspace, id, options) {
    const self = host.WorkspaceContainer.call(this, workspace, "vertical", id) || this;
    self.parent = null;
    self.children = [];
    self.type = "window";
    self.size = {};
    self.workspace = workspace;
    self.containerEl.addClass("mod-root", "workspace-window");
    self.component.load();

    const features = ["popup"];
    if (options) {
      if (options.size) {
        options.width = Math.max(options.size.width, 600);
        options.height = Math.max(options.size.height, 600);
      }
      for (const key of ["x", "y", "width", "height"]) {
        if (options.hasOwnProperty(key)) {
          features.push(`${key}=${options[key]}`);
          self.size[key] = options[key];
        }
      }
    }
    try {
      const rgb = host.parseColor(getComputedStyle(window.document.body).backgroundColor);
      if (rgb) features.push("background=" + host.colorToHex(rgb));
    } catch (e) { /* the colour is only a nicety */ }

    const win = (self.win = window.open("about:blank", "_blank", features.join(",")));
    self.doc = win.document;
    const baseEl = createEl("base", { href: location.href });
    win.document.head.appendChild(baseEl);

    host.installEnhancements(win);
    host.attachElectron(win);
    win.app = self.workspace.app;
    host.installTooltipHandlers(win.document);
    host.installTitlebar(win);
    host.trackWindowFocus(win);

    self.rootEl = win.document.body.createDiv("app-container");
    self.rootEl.createDiv("horizontal-main-container").createDiv("workspace").appendChild(self.containerEl);
    win.document.title = "Basalt";

    win.addEventListener("focus", () => {
      activeWindow = win;
      activeDocument = win.document;
      self.onFocus();
    });
    win.addEventListener("beforeunload", (event) => {
      if (win.electron.ipcRenderer.sendSync("is-quitting")) event.preventDefault();
      else self.close();
    });
    // history navigation of a pop-out is the main window's history
    win.history.forward = () => window.history.forward();
    win.history.back = () => window.history.back();
    win.history.go = (n) => window.history.go(n);
    win.addEventListener("resize", debounceCall(() => {
      self.workspace.iterateLeaves(self, (leaf) => leaf.onResize());
      self.workspace.requestSaveLayout();
      self.updateSize();
    }, 50));
    host.applyLanguage(win.document);
    host.forwardInputEvents(win);
    self.cleanup = host.mirrorStyles(win, [baseEl]);
    self.component.registerEvent(self.workspace.on("quit", () => { win.close(); }));
    self.component.registerEvent(self.workspace.on("layout-change", () => { self.updateTitle(); }));
    win.electronWindow.show();

    if (options) {
      if (options.maximize) win.electronWindow.maximize();
      const zoom = options.zoom;
      if (zoom && typeof zoom === "number") win.electron.webFrame.setZoomLevel(zoom);
    } else {
      win.electron.webFrame.setZoomLevel(window.electron.webFrame.getZoomLevel());
    }
    workspace.trigger("window-open", self, win);
    self.updateSize();
    return self;
  }
  inherit(WorkspaceWindow, host.WorkspaceContainer);

  WorkspaceWindow.prototype.serialize = function () {
    const data = host.WorkspaceContainer.prototype.serialize.call(this);
    const win = this.win;
    if (win && !win.closed) {
      data.x = win.screenX;
      data.y = win.screenY;
      data.width = win.outerWidth;
      data.height = win.outerHeight;
      this.updateSize();
      if (this.size) Object.assign(data, this.size);
      try {
        const electronWin = this.win.electronWindow;
        data.maximize = electronWin.isMaximized();
        data.zoom = electronWin.webContents.zoomLevel;
      } catch (e) { /* window already gone */ }
    }
    return data;
  };

  /** Remembers the normal (not maximised / minimised / fullscreen) bounds of the OS window. */
  WorkspaceWindow.prototype.updateSize = function () {
    if (!this.win) return;
    const electronWin = this.win.electronWindow;
    if (electronWin && !electronWin.isMaximized() && !electronWin.isMinimized() && !electronWin.isFullScreen()) {
      const { x, y, width, height } = electronWin.getBounds();
      this.size = { x, y, width, height };
    }
  };

  WorkspaceWindow.prototype.updateTitle = function () {
    if (!this.win) return;
    const leaf = this.workspace.getMostRecentLeaf(this);
    this.win.document.title = this.app.getAppTitle(leaf ? leaf.getDisplayText().trim() : "");
  };

  WorkspaceWindow.prototype.detach = function () { this.close(); };

  WorkspaceWindow.prototype.close = function () {
    host.WorkspaceContainer.prototype.detach.call(this);
    const { workspace, win, component, cleanup } = this;
    const active = workspace.activeLeaf;
    if ((active ? active.getContainer() : undefined) === this) {
      const next = workspace.getMostRecentLeaf();
      if (next) workspace.setActiveLeaf(next);
    }
    workspace.iterateLeaves(this, (leaf) => { leaf.detach(); });
    if (activeWindow === win) {
      activeWindow = window;
      activeDocument = document;
    }
    if (cleanup) { cleanup(); this.cleanup = null; }
    component.unload();
    if (win) {
      win.close();
      workspace.trigger("window-close", this, win);
      this.win = null;
    }
  };

  WorkspaceWindow.prototype.removeChild = function (node) {
    host.WorkspaceContainer.prototype.removeChild.call(this, node);
    if (this.children.length === 0) this.close();
  };

  return WorkspaceWindow;
}
