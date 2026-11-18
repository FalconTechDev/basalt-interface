import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { randomHex } from "./misc.js";
import { normalizePath } from "./path.js";
import { debounceCall } from "./timing.js";
import { s12leafTypeOrFalse, s12requireDesktopApp } from "./s12-consts.js";

/**
 * Workspace prototype methods, part 1: traversal, active-leaf management,
 * leaf factories, splits, pop-outs. Installed on Workspace.prototype by the
 * s48 factory. `this` is always the workspace.
 */
export function ng04WsTree(host) {
  const M = {};

  function walk(node, cb) {
    if (!node) return false;
    if (Array.isArray(node)) {
      for (const n of node) if (walk(n, cb)) return true;
      return false;
    }
    if (node instanceof host.WorkspaceLeaf) return !!cb(node);
    const children = node.children || [];
    for (const child of children) if (walk(child, cb)) return true;
    return false;
  }

  function eachLeaf(ws, cb) { walk([ws.rootSplit, ws.leftSplit, ws.rightSplit, ws.floatingSplit], cb); }

  M.on = function (name, callback, ctx) { return host.Events.prototype.on.call(this, name, callback, ctx); };
  M.trigger = function (name, ...args) { return host.Events.prototype.trigger.call(this, name, ...args); };

  M.isAttached = function (leaf) {
    const root = leaf.getRoot();
    return root === this.leftSplit || root === this.rootSplit || root === this.floatingSplit || root === this.rightSplit;
  };

  M.iterateLeaves = function (node, callback) {
    if (typeof node === "function") { const t = node; node = callback; callback = t; }
    return walk(node, callback);
  };

  M.iterateTabs = function (node, callback) {
    if (typeof node === "function") { const t = node; node = callback; callback = t; }
    const visit = (n) => {
      if (!n) return false;
      if (Array.isArray(n)) {
        for (const c of n) if (visit(c)) return true;
        return false;
      }
      if (n instanceof host.WorkspaceTabs) return !!callback(n);
      const children = n.children || [];
      for (const c of children) if (visit(c)) return true;
      return false;
    };
    return visit(node);
  };

  function walkAll(node, cb) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const n of node) walkAll(n, cb);
      return;
    }
    if (node instanceof host.WorkspaceLeaf) { cb(node); return; }
    const children = node.children || [];
    for (const child of children) walkAll(child, cb);
  }

  M.iterateAllLeaves = function (callback) {
    walkAll([this.rootSplit, this.leftSplit, this.rightSplit, this.floatingSplit], callback);
  };

  M.iterateRootLeaves = function (callback) {
    return walk(this.rootSplit, callback);
  };

  M.iterateCodeMirrors = function () {};

  M.getLeavesOfType = function (type) {
    const out = [];
    this.iterateAllLeaves((leaf) => {
      if (leaf.view && leaf.view.getViewType() === type) out.push(leaf);
    });
    return out;
  };

  M.getLeafById = function (id) {
    let found = null;
    this.iterateAllLeaves((leaf) => {
      if (leaf.id === id) { found = leaf; return true; }
    });
    return found;
  };

  M.getGroupLeaves = function (group) {
    const out = [];
    this.iterateAllLeaves((leaf) => {
      if (leaf.group === group) out.push(leaf);
    });
    return out;
  };

  M.hasUndoHistory = function () {
    return this.undoHistory.length > 0;
  };

  M.isInSidebar = function (item) {
    const root = item.getRoot();
    return root === this.leftSplit || root === this.rightSplit;
  };

  M.onLayoutChange = function (item) {
    this.requestUpdateLayout();
    if (item && !this.layoutItemQueue.includes(item)) this.layoutItemQueue.push(item);
  };

  M.onLayoutReady = function (callback, pluginId) {
    if (this.onLayoutReadyCallbacks === null) callback();
    else this.onLayoutReadyCallbacks.push({ pluginId, callback });
  };

  M.onQuickPreview = function (leaf, file) {
    this.trigger("quick-preview", leaf, file);
  };

  M.addMobileFileInfo = function (info) {
    this.mobileFileInfos.push(info);
  };

  M.getRecentFiles = function (options) {
    return this.recentFileTracker.getRecentFiles(options);
  };

  M.getLastOpenFiles = function () {
    return this.recentFileTracker.getLastOpenFiles();
  };

  M.addRecentFile = function (file) {
    return this.recentFileTracker.addRecentFile(file);
  };

  M.onResize = function () {
    this.trigger("resize");
  };

  M.updateTitle = function () {
    const leaf = this.getMostRecentLeaf(this.rootSplit);
    document.title = this.app.getAppTitle(leaf ? leaf.getDisplayText().trim() : "");
  };

  M.getActiveFile = function () {
    return (this.activeEditor && this.activeEditor.file) || (this.getActiveFileView() && this.getActiveFileView().file) || null;
  };

  M.getFocusedContainer = function () {
    const children = this.floatingSplit ? this.floatingSplit.children : [];
    for (const child of children) {
      if (child.win === env().activeWindow) return child;
    }
    return this.rootSplit;
  };

  M.getMostRecentLeaf = function (root) {
    const roots = root ? (Array.isArray(root) ? root : [root]) : [this.rootSplit, this.floatingSplit];
    let best = null;
    let first = null;
    for (const r of roots) {
      walk(r, (leaf) => {
        if (!first) first = leaf;
        if (leaf.containerEl.isShown()) {
          if (!best || leaf.activeTime > best.activeTime) best = leaf;
        }
      });
    }
    return best || first;
  };

  M.getActiveViewOfType = function (type) {
    const leaf = this.activeLeaf;
    return leaf && leaf.view instanceof type ? leaf.view : null;
  };

  M.getActiveLeafOfViewType = function (type) {
    return this.getActiveViewOfType(type);
  };

  M.getSideLeaf = function (split, splitNew) {
    if (split instanceof host.MobileDrawer) {
      const leaf = new host.WorkspaceLeaf(this.app);
      split.insertChild(split.children.length, leaf);
      return leaf;
    }
    if (split instanceof host.WorkspaceSidedock) {
      if (splitNew) {
        const tabs = new host.WorkspaceTabs(this);
        const leaf = new host.WorkspaceLeaf(this.app);
        tabs.insertChild(0, leaf);
        split.insertChild(split.children.length, tabs);
        return leaf;
      }
      if (split.children.length > 0) {
        const first = split.children[0];
        if (first instanceof host.WorkspaceParent) {
          const leaf = new host.WorkspaceLeaf(this.app);
          first.insertChild(first.children.length, leaf);
          return leaf;
        }
        return null;
      }
      const tabs = new host.WorkspaceTabs(this);
      const leaf = new host.WorkspaceLeaf(this.app);
      tabs.insertChild(0, leaf);
      split.insertChild(0, tabs);
      return leaf;
    }
    return null;
  };

  M.getActiveFileView = function () {
    const active = this.activeLeaf;
    if (active && active.view instanceof host.MarkdownView && active.view.navigation) return active.view;
    let best = null;
    this.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof host.MarkdownView && view.navigation && (!best || leaf.activeTime > best[0].activeTime)) best = [leaf, view];
    });
    return best ? best[1] : null;
  };

  M.activeLeafEvents = function () {
    if (!this.layoutReady) return;
    this.trigger("active-leaf-change");
    const file = this.getActiveFile();
    const prev = this.lastActiveFile;
    if (file !== prev) {
      this.recentFileTracker.onFileOpen(this.activeLeaf, file);
      this.lastActiveFile = file;
      this.trigger("file-open", file);
    }
  };

  M.pushUndoHistory = function (leaf, parentId, rootId) {
    if (!leaf) return;
    const state = leaf.getViewState();
    if (!state || state.type === "empty") return;
    this.undoHistory.unshift({
      leafId: leaf.id,
      state,
      eState: leaf.getEphemeralState(),
      parentId,
      rootId,
      leafHistory: leaf.history.serialize(),
    });
    if (this.undoHistory.length > 10) this.undoHistory.pop();
  };

  M.getLeaf = function (direction, makeActive) {
    direction = s12leafTypeOrFalse(direction) || (direction === true ? "tab" : direction);
    if (direction === "split") {
      const dir = typeof makeActive === "string" && (makeActive === "horizontal" || makeActive === "vertical") ? makeActive : undefined;
      return this.splitActiveLeaf(dir);
    }
    if (direction === "tab" || direction === true) return this.createLeafInTabGroup();
    if (direction === "window") return this.openPopoutLeaf();
    return this.getUnpinnedLeaf();
  };

  M.getUnpinnedLeaf = function (reveal = true) {
    const active = this.activeLeaf;
    if (active && active.canNavigate()) {
      if (reveal) this.setActiveLeaf(active);
      return active;
    }
    const container = active ? active.getContainer() : this.getFocusedContainer();
    let best = null;
    walk(container, (leaf) => {
      if (!leaf.canNavigate()) return;
      const parent = leaf.parent;
      const isCurrentTab = parent instanceof host.WorkspaceTabs && parent.children[parent.currentTab] === leaf;
      const inStacked = parent instanceof host.WorkspaceTabs && parent.isStacked;
      if (!(isCurrentTab || inStacked)) return;
      if (!best || leaf.activeTime > best.activeTime) best = leaf;
    });
    if (!best) {
      const recent = this.getMostRecentLeaf();
      const parent = recent && recent.parent;
      if (parent instanceof host.WorkspaceParent) {
        best = this.createLeafInParent(parent, parent.children.length);
      } else {
        best = this.createLeafInTabGroup();
      }
    }
    if (reveal) this.setActiveLeaf(best);
    return best;
  };

  M.createLeafInTabGroup = function (parent) {
    if (!parent) {
      let recent = this.getMostRecentLeaf();
      if (!recent && this.layoutReady) {
        // self-heal an emptied root before giving up
        this.updateLayout();
        recent = this.getMostRecentLeaf();
      }
      if (!recent) throw new Error("No tab group found.");
      parent = recent.parent;
      while (parent && !(parent instanceof host.WorkspaceTabs)) parent = parent.parent;
      if (!parent) throw new Error("No tab group found.");
    }
    let bestIndex = -1;
    let bestTime = -1;
    parent.children.forEach((child, i) => {
      if (child.activeTime > bestTime) { bestTime = child.activeTime; bestIndex = i; }
    });
    if (bestIndex !== -1) {
      const child = parent.children[bestIndex];
      if (child instanceof host.WorkspaceLeaf && child.view instanceof host.EmptyView) return child;
    }
    const leaf = new host.WorkspaceLeaf(this.app);
    parent.insertChild(bestIndex + 1, leaf);
    if (this.app.vault.getConfig("focusNewTab")) this.setActiveLeaf(leaf, { focus: true });
    return leaf;
  };

  M.createLeafInParent = function (parent, index) {
    const leaf = new host.WorkspaceLeaf(this.app);
    if (parent.children.length > 0) leaf.setDimension(100 / parent.children.length);
    parent.insertChild(index, leaf);
    this.setActiveLeaf(leaf, { focus: true });
    return leaf;
  };

  M.createLeafBySplit = function (leaf, direction, before) {
    const newLeaf = new host.WorkspaceLeaf(this.app);
    this.splitLeaf(leaf, newLeaf, direction, before);
    this.setActiveLeaf(newLeaf, { focus: true });
    return newLeaf;
  };

  M.splitActiveLeaf = function (direction) {
    const leaf = this.getMostRecentLeaf() || this.getLeaf("tab");
    return this.createLeafBySplit(leaf, direction || "vertical");
  };

  M.splitLeafOrActive = function (leaf, direction) {
    if (leaf) return this.createLeafBySplit(leaf, direction);
    return this.splitActiveLeaf(direction);
  };

  M.splitLeaf = function (leaf, tabs, direction = "vertical", before) {
    let node = leaf;
    while (node.parent && !(node.parent instanceof host.WorkspaceSplit)) node = node.parent;
    const split = node.parent;
    if (!split) return;
    if (!(tabs instanceof host.WorkspaceParent)) tabs = host.WorkspaceTabs.createFrom(this, tabs);
    const child = node;
    if (split.direction !== direction) {
      const wrapper = new host.WorkspaceSplit(this, direction);
      const at = split.children.indexOf(child);
      wrapper.dimension = child.dimension;
      child.setDimension(null);
      // move `child` into the wrapper without triggering the collapse logic of removeChild
      split.children.remove(child);
      child.setParent(null);
      split.insertChild(at, wrapper);
      if (before) {
        wrapper.insertChild(0, tabs);
        wrapper.insertChild(1, child);
      } else {
        wrapper.insertChild(0, child);
        wrapper.insertChild(1, tabs);
      }
    } else {
      const at = split.children.indexOf(child);
      const half = child.dimension != null ? child.dimension / 2 : null;
      if (before) {
        split.insertChild(at, tabs);
        child.setDimension(half);
        tabs.setDimension(half);
      } else {
        split.insertChild(at + 1, tabs);
        child.setDimension(half);
        tabs.setDimension(half);
      }
    }
    split.recomputeChildrenDimensions();
  };

  M.getLeftLeaf = function (dir) {
    return this.getSideLeaf(this.leftSplit, dir === "split");
  };

  M.getRightLeaf = function (dir) {
    return this.getSideLeaf(this.rightSplit, dir === "split");
  };

  M.duplicateLeaf = async function (leaf, type, direction) {
    if (type === "horizontal" || type === "vertical") { direction = type; type = "split"; }
    const state = leaf.getViewState();
    const eState = leaf.getEphemeralState();
    const history = leaf.history.serialize();
    let target;
    if (type === "split") target = this.createLeafBySplit(leaf, direction || "vertical");
    else target = this.getLeaf(type || "tab");
    await target.setViewState(state, Object.assign({}, eState, { focus: true }));
    target.history.deserialize(history);
    return target;
  };

  M.openPopout = function (options) {
    s12requireDesktopApp();
    const win = new (env().O0)(this, undefined, options);
    this.floatingSplit.insertChild(this.floatingSplit.children.length, win);
    return win;
  };

  M.openPopoutLeaf = function (options) {
    const win = this.openPopout(options);
    const tabs = new host.WorkspaceTabs(this);
    const leaf = new host.WorkspaceLeaf(this.app);
    tabs.insertChild(0, leaf);
    win.insertChild(0, tabs);
    return leaf;
  };

  M.moveLeafToPopout = function (leaf, options) {
    s12requireDesktopApp();
    if (!(leaf.view instanceof host.ItemView)) return;
    const rect = leaf.containerEl.getBoundingClientRect();
    options = Object.assign({
      x: rect.left, y: rect.top, width: rect.width, height: rect.height,
      zoom: (leaf.getContainer().win || window).electron ? (leaf.getContainer().win || window).electron.webFrame.getZoomLevel() : undefined,
    }, options || {});
    const win = this.openPopout(options);
    const parent = leaf.parent;
    const index = parent ? parent.children.indexOf(leaf) : -1;
    leaf.setDimension(null);
    if (parent) parent.removeChild(leaf);
    const tabs = host.WorkspaceTabs.createFrom(this, leaf);
    win.insertChild(0, tabs);
    this.setActiveLeaf(leaf, { focus: true });
  };

  M.revealLeaf = function (leaf) {
    const root = leaf.getRoot();
    if (root instanceof host.WorkspaceSidedock || (root && root.collapsed !== undefined && root.collapsed)) {
      if (root.expand) root.expand();
    }
    if (leaf.parent instanceof host.MobileDrawer) {
      leaf.parent.openLeaf(leaf);
      if (leaf.parent.expand) leaf.parent.expand();
    }
    const parent = leaf.parent;
    if (parent instanceof host.WorkspaceTabs) {
      const before = parent.currentTab;
      parent.selectTab(leaf);
      if (before !== parent.currentTab) {
        leaf.tabHeaderEl.animate ? null : null;
      }
    }
    leaf.containerEl.focus();
    leaf.loadIfDeferred();
  };

  M.focusLeaf = function (leaf) {
    if (!host.Platform.isMobile) {
      const container = leaf.getContainer();
      if (container && container.focus) container.focus();
    }
    leaf.setEphemeralState({ focus: true });
    if (host.Platform.isMobile) {
      const root = leaf.getRoot();
      if (root === this.rootSplit) {
        if (this.leftSplit && this.leftSplit.collapse) this.leftSplit.collapse();
        if (this.rightSplit && this.rightSplit.collapse) this.rightSplit.collapse();
      }
    }
    // a settings window floating over the same window closes
    if (env().activeWindow && env().activeWindow !== window) {
      // handled by window focus plumbing elsewhere
    }
  };

  M.setActiveLeaf = function (leaf, options, focus) {
    if (typeof options === "boolean") { focus = options; options = null; }
    options = options || {};
    if (focus === undefined) focus = options.focus;
    if (!leaf || !this.isAttached(leaf)) return;
    if (this.activeLeaf === leaf) {
      if (focus) this.focusLeaf(leaf);
      return;
    }
    const old = this.activeLeaf;
    if (old) {
      old.containerEl.removeClass("mod-active");
      old.tabHeaderEl && old.tabHeaderEl.removeClass("mod-active");
    }
    if (this.activeTabGroup) this.activeTabGroup.containerEl.removeClass("mod-active");
    this.activeLeaf = leaf;
    leaf.activeTime = Date.now();
    leaf.containerEl.addClass("mod-active");
    if (leaf.tabHeaderEl) leaf.tabHeaderEl.addClass("mod-active");
    const parent = leaf.parent;
    this.activeTabGroup = parent instanceof host.WorkspaceTabs ? parent : (parent ? parent.parent : null);
    if (this.activeTabGroup instanceof host.WorkspaceTabs) {
      this.activeTabGroup.containerEl.addClass("mod-active");
      this.activeTabGroup.selectTabIndex(this.activeTabGroup.children.indexOf(leaf));
    }
    this._activeEditor = null;
    const container = leaf.getContainer();
    if (container && container.updateTitle) container.updateTitle();
    else this.updateTitle();
    if (focus) this.focusLeaf(leaf);
    if (host.Platform.isMobile) this.updateMobileVisibleTabGroup();
    this.requestActiveLeafEvents();
  };

  M.unsetActiveEditor = function (editor) {
    if (!editor || this._activeEditor === editor) this._activeEditor = null;
  };

  M.getAdjacentLeafInDirection = function (leaf, direction) {
    const rect = leaf.containerEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let best = null;
    let bestDist = Infinity;
    const consider = (other) => {
      if (other === leaf || !other.containerEl.isShown()) return;
      const r = other.containerEl.getBoundingClientRect();
      const ox = r.left + r.width / 2;
      const oy = r.top + r.height / 2;
      const dx = ox - cx;
      const dy = oy - cy;
      let ok = false;
      if (direction === "left" && dx < 0 && Math.abs(dy) < r.height) ok = true;
      if (direction === "right" && dx > 0 && Math.abs(dy) < r.height) ok = true;
      if (direction === "top" && dy < 0 && Math.abs(dx) < r.width) ok = true;
      if (direction === "bottom" && dy > 0 && Math.abs(dx) < r.width) ok = true;
      if (!ok) return;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = other; }
    };
    this.iterateAllLeaves(consider);
    return best;
  };

  M.detachLeavesOfType = function (type) {
    const leaves = this.getLeavesOfType(type);
    for (const leaf of leaves) leaf.detach();
    return leaves;
  };

  return M;
}

