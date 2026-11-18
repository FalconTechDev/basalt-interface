import { env } from "./env.js";
import { copyText } from "./misc.js";
import { parseLinktext, normalizePath } from "./path.js";
import { parseCallbackUrl } from "./vault-crypto.js";
import { s92ApplySpellcheckerLanguages } from "./s92-i18n.js";

/**
 * Workspace prototype methods, part 2: layout persistence, drag & drop,
 * context menus, URI plumbing, registries, undo, frameless.
 */
export function ng04WsOps(host) {
  const M = {};

  // ---------- small registries ----------

  M.registerEditorExtension = function (ext) {
    if (!this.editorExtensions.includes(ext)) this.editorExtensions.push(ext);
    this.updateOptions();
  };
  M.unregisterEditorExtension = function (ext) {
    this.editorExtensions = this.editorExtensions.filter((e) => e !== ext);
    this.updateOptions();
  };
  M.registerHoverLinkSource = function (id, source) {
    this.hoverLinkSources[id] = source;
  };
  M.unregisterHoverLinkSource = function (id) {
    delete this.hoverLinkSources[id];
  };
  M.registerOperatorFuncConfigs = function (id, configs) {
    this.operatorFuncConfigs[id] = configs;
  };
  M.unregisterOperatorFuncConfigs = function (id) {
    delete this.operatorFuncConfigs[id];
  };

  M.registerObsidianProtocolHandler = function (action, handler) {
    if (this.protocolHandlers.has(action)) {
      throw new Error('Action "' + action + '" is already registered as a handler.');
    }
    this.protocolHandlers.set(action, handler);
  };
  M.unregisterObsidianProtocolHandler = function (action, handler) {
    if (!handler || this.protocolHandlers.get(action) === handler) this.protocolHandlers.delete(action);
  };

  // ---------- layout persistence ----------

  M.readWorkspaceFile = async function () {
    const name = host.Platform.isMobile ? "workspace-mobile.json" : "workspace.json";
    try {
      const raw = await this.app.vault.adapter.read(this.app.vault.configDir + "/" + name);
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  };

  M.saveLayout = async function () {
    if (!this.layoutReady) return;
    try {
      const layout = this.getLayout();
      layout.lastOpenFiles = this.recentFileTracker.serialize();
      const name = host.Platform.isMobile ? "workspace-mobile.json" : "workspace.json";
      await this.app.vault.adapter.write(this.app.vault.configDir + "/" + name, JSON.stringify(layout, null, 2));
    } catch (e) { /* layout simply stays unsaved */ }
  };

  M.getLayout = function () {
    const layout = {
      main: this.rootSplit ? this.rootSplit.serialize() : null,
      left: this.leftSplit ? this.leftSplit.serialize() : null,
      right: this.rightSplit ? this.rightSplit.serialize() : null,
      "left-ribbon": this.leftRibbon ? this.leftRibbon.serialize() : { hiddenItems: {} },
    };
    if (this.floatingSplit && this.floatingSplit.children.length > 0) layout.floating = this.floatingSplit.serialize();
    if (this.activeLeaf) layout.active = this.activeLeaf.id;
    return layout;
  };

  M.clearLayout = async function () {
    this.layoutReady = false;
    if (this.requestLayoutChangeEvents && this.requestLayoutChangeEvents.cancel) this.requestLayoutChangeEvents.cancel();
    const leaves = [];
    this.iterateAllLeaves((leaf) => { leaves.push(leaf); });
    await Promise.all(leaves.map((leaf) => leaf.open(null)));
    for (const split of [this.rootSplit, this.leftSplit, this.rightSplit, this.floatingSplit]) {
      if (!split) continue;
      if (split instanceof env().I0 || split.type === "floating") {
        for (const child of split.children.slice()) {
          if (child.close) child.close();
        }
      }
      split.containerEl.remove();
      split.component.unload();
    }
    this.rootSplit = this.leftSplit = this.rightSplit = this.floatingSplit = null;
    this.activeLeaf = null;
    this.activeTabGroup = null;
    this.layoutItemQueue = [];
  };

  M.changeLayout = async function (layout) {
    if (!this.layoutReady) return;
    await this.clearLayout();
    await this.setLayout(layout);
  };

  // recursive layout -> tree node; returns node or null
  M.deserializeLayout = async function (data, sidebar) {
    if (!data || typeof data !== "object") return null;
    const ws = this;
    const app = this.app;
    const kind = data.type;

    if (kind === "split") {
      let node;
      if (sidebar === "root") {
        node = new (env().L0)(ws, "vertical", data.id);
      } else if (sidebar === "left" || sidebar === "right") {
        if (host.Platform.isMobile) return null;
        node = new host.WorkspaceSidedock(ws, "horizontal", sidebar, data.id);
      } else {
        node = new host.WorkspaceSplit(ws, data.direction === "horizontal" ? "horizontal" : "vertical", data.id);
      }
      const children = [];
      for (const childData of data.children || []) {
        const child = await ws.deserializeLayout(childData, null);
        if (child) children.push(child);
      }
      for (const child of children) {
        // leaves hanging directly off a split are auto-wrapped in a tab group
        if (child instanceof host.WorkspaceLeaf) {
          const tabs = new host.WorkspaceTabs(ws);
          tabs.insertChild(0, child);
          node.insertChild(node.children.length, tabs);
        } else {
          node.insertChild(node.children.length, child);
        }
      }
      if (sidebar === "left" || sidebar === "right") {
        if (data.width) node.setSize(data.width);
        if (data.collapsed) node.collapse();
      }
      if (children.length === 0 && !(node instanceof host.WorkspaceSidedock)) {
        node.containerEl.remove();
        node.component.unload();
        return null;
      }
      if (children.length > 0) node.recomputeChildrenDimensions();
      return node;
    }

    if (kind === "tabs") {
      const node = new host.WorkspaceTabs(ws, data.id);
      for (const childData of data.children || []) {
        const child = await ws.deserializeLayout(childData, null);
        if (child) node.insertChild(node.children.length, child);
      }
      if (node.isStacked !== !!data.stacked) node.setStacked(!!data.stacked);
      if (node.children.length === 0) {
        node.containerEl.remove();
        node.component.unload();
        return null;
      }
      node.selectTabIndex(Math.min(data.currentTab || 0, node.children.length - 1));
      node.recomputeChildrenDimensions();
      return node;
    }

    if (kind === "leaf") {
      const leaf = new host.WorkspaceLeaf(app, data.id);
      try {
        await leaf.setViewState(data.state);
      } catch (e) { console.error(e); }
      if (leaf.view instanceof host.EmptyView || (leaf.view && leaf.view.getViewType() === "empty" && !data.state)) {
        leaf.detach();
        return null;
      }
      if (data.group !== undefined && data.group !== null) leaf.setGroup(data.group);
      else if (data.group === null) leaf.setGroup(null);
      if (data.pinned) leaf.setPinned(true);
      return leaf;
    }

    if (kind === "floating") {
      const node = new (env().I0)(ws);
      for (const childData of data.children || []) {
        if (childData.type !== "window") continue;
        const child = await ws.deserializeLayout(childData, null);
        if (child) node.insertChild(node.children.length, child);
      }
      return node;
    }

    if (kind === "window") {
      if (host.Platform.isMobile || !host.Platform.isDesktopApp || env().qf < 13) return null;
      const options = {};
      for (const key of ["x", "y", "width", "height", "maximize", "zoom"]) {
        if (data.hasOwnProperty(key)) options[key] = data[key];
      }
      let node;
      try {
        node = new (env().O0)(ws, data.id, options);
      } catch (e) {
        console.error(e);
        return null;
      }
      for (const childData of data.children || []) {
        const child = await ws.deserializeLayout(childData, null);
        if (child) node.insertChild(node.children.length, child);
      }
      if (node.children.length === 0) {
        node.close();
        return null;
      }
      node.recomputeChildrenDimensions();
      return node;
    }

    if (kind === "mobile-drawer") {
      if (!host.Platform.isMobile) return null;
      const node = new host.MobileDrawer(ws, sidebar === "right" ? "right" : "left", data.id);
      for (const childData of data.children || []) {
        const child = await ws.deserializeLayout(childData, null);
        if (child) node.insertChild(node.children.length, child);
      }
      node.selectTabIndex(Math.min(data.currentTab || 0, Math.max(0, node.children.length - 1)));
      if (data.pinned) node.isPinned = true;
      return node;
    }

    return null;
  };

  M.setLayout = async function (data) {
    data = data || {};
    this.layoutReady = false;
    const isMobile = host.Platform.isMobile;
    const app = this.app;

    // main root
    let main = data.main ? await this.deserializeLayout(data.main, "root") : null;
    if (!main) {
      main = new (env().L0)(this, "vertical");
      const recent = this.getLastOpenFiles()[0];
      const file = recent ? app.vault.getAbstractFileByPath(normalizePath(recent)) : null;
      const tabs = new host.WorkspaceTabs(this);
      const leaf = new host.WorkspaceLeaf(app);
      tabs.insertChild(0, leaf);
      main.insertChild(0, tabs);
      if (file) leaf.openFile(file, { active: false });
    }
    this.rootSplit = main;

    // side docks / drawers
    let left = data.left ? await this.deserializeLayout(data.left, "left") : null;
    if (!left) {
      left = isMobile ? new host.MobileDrawer(this, "left") : new host.WorkspaceSidedock(this, "horizontal", "left");
    }
    this.leftSplit = left;

    let right = data.right ? await this.deserializeLayout(data.right, "right") : null;
    if (!right) {
      right = isMobile ? new host.MobileDrawer(this, "right") : new host.WorkspaceSidedock(this, "horizontal", "right");
      if (!isMobile) right.collapse();
    }
    this.rightSplit = right;

    let floating = data.floating ? await this.deserializeLayout(data.floating, null) : null;
    if (!floating) floating = new (env().I0)(this);
    this.floatingSplit = floating;

    // DOM order
    const container = this.containerEl;
    container.empty();
    if (isMobile) {
      container.append(left.containerEl, main.containerEl, right.containerEl);
    } else {
      container.append(this.leftRibbon.containerEl, left.containerEl, main.containerEl, right.containerEl, this.rightRibbon.containerEl);
    }
    if (data["left-ribbon"] && this.leftRibbon.load) this.leftRibbon.load(data["left-ribbon"]);

    // active leaf
    if (data.active) {
      const leaf = this.getLeafById(data.active);
      if (leaf) this.setActiveLeaf(leaf, { focus: true });
    }
    if (!this.activeLeaf) {
      const leaf = this.getMostRecentLeaf();
      if (leaf) this.setActiveLeaf(leaf, { focus: false });
    }

    // materialise visible deferred leaves in parallel
    const deferred = [];
    this.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof host.DeferredView && leaf.containerEl.isShown()) deferred.push(leaf.loadIfDeferred());
    });
    await Promise.all(deferred);

    this.layoutReady = true;
    this.onLayoutChange();
    this.requestActiveLeafEvents();
  };

  M.loadLayout = async function () {
    const data = await this.readWorkspaceFile();
    if (data.lastOpenFiles) this.recentFileTracker.load(data.lastOpenFiles);
    await this.setLayout(data);

    // sandbox vault special-case (desktop)
    const app = this.app;
    if (!host.Platform.isMobile && app.vault.getName() === "Basalt Sandbox") {
      try {
        new host.Notice(env().gm.interface.msgSandboxVault(), 0);
        const leaves = [];
        this.iterateRootLeaves((l) => leaves.push(l));
        if (this.floatingSplit) this.iterateLeaves(this.floatingSplit, (l) => leaves.push(l));
        await Promise.all(leaves.map((l) => l.detach()));
        this.updateLayout();
        const leaf = this.getUnpinnedLeaf(false);
        const name = env().gm.interface.starterContent ? env().gm.interface.starterContent.welcomeFilename() : "Start here";
        leaf.openLinkText(name, "", { state: { mode: "source" } });
      } catch (e) { console.error(e); }
    }

    this.trigger("layout-ready");
    const callbacks = this.onLayoutReadyCallbacks || [];
    this.onLayoutReadyCallbacks = null;
    for (const entry of callbacks) {
      await env().sleep(0);
      try {
        entry.callback();
      } catch (e) {
        console.error(e);
        new host.Notice(env().gm.interface.msgPluginError({ plugin: entry.pluginId || "" }));
      }
    }
  };

  // ---------- drag & drop ----------

  M.recursiveGetTarget = function (event, parent) {
    const x = event.clientX;
    const y = event.clientY;
    for (const child of parent.children || []) {
      const el = child.containerEl;
      if (!el || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        if (child instanceof host.WorkspaceTabs) return child;
        if (child.children && child.children.length > 0) return this.recursiveGetTarget(event, child);
        return child;
      }
    }
    return parent;
  };

  M.getDropLocation = function (event) {
    if (event.win && event.win !== window) {
      const children = this.floatingSplit ? this.floatingSplit.children : [];
      for (const child of children) {
        if (child.win === event.win) return this.recursiveGetTarget(event, child);
      }
      return null;
    }
    const target = event.target;
    const inside = (el) => el && target && (el === target || el.contains(target));
    const overPoint = (el) => {
      if (!el) return false;
      if (inside(el)) return true;
      const r = el.getBoundingClientRect();
      return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    };
    if (this.leftRibbon && overPoint(this.leftRibbon.containerEl)) return this.leftSplit;
    if (this.leftSidebarToggleButtonEl && overPoint(this.leftSidebarToggleButtonEl)) return this.leftSplit;
    if (this.rightRibbon && overPoint(this.rightRibbon.containerEl)) return this.rightSplit;
    if (this.rightSidebarToggleButtonEl && overPoint(this.rightSidebarToggleButtonEl)) return this.rightSplit;
    if (this.leftSplit && overPoint(this.leftSplit.containerEl)) {
      return this.leftSplit.children.length === 0 ? this.leftSplit : this.recursiveGetTarget(event, this.leftSplit);
    }
    if (this.rightSplit && overPoint(this.rightSplit.containerEl)) {
      return this.rightSplit.children.length === 0 ? this.rightSplit : this.recursiveGetTarget(event, this.rightSplit);
    }
    if (this.rootSplit && overPoint(this.rootSplit.containerEl)) {
      return this.recursiveGetTarget(event, this.rootSplit);
    }
    return null;
  };

  M.getDropDirection = function (event, rect, exclude, tabGroup) {
    exclude = exclude || [];
    const banned = new Set(exclude);
    const minDim = Math.min(rect.width, rect.height);
    const zone = Math.max(minDim / 3, 40);
    const x = event.clientX;
    const y = event.clientY;
    const dist = {
      top: y - rect.y,
      bottom: rect.y + rect.height - y,
      left: x - rect.x,
      right: rect.x + rect.width - x,
    };
    let best = null;
    let bestDist = Infinity;
    for (const dir of ["top", "bottom", "left", "right"]) {
      if (banned.has(dir)) continue;
      const d = dist[dir];
      if (d < 0 || d >= zone) continue;
      if (d < bestDist) { bestDist = d; best = dir; }
    }
    // stacked tab group: no left/right drops; over the header strip only the top third offers "top"
    if (tabGroup && tabGroup.isStacked) {
      const headerBottom = tabGroup.tabHeaderContainerEl ? tabGroup.tabHeaderContainerEl.getBoundingClientRect().bottom : rect.y;
      const headerTop = tabGroup.tabHeaderContainerEl ? tabGroup.tabHeaderContainerEl.getBoundingClientRect().top : rect.y;
      const overHeader = y >= headerTop && y <= headerBottom;
      if (overHeader) {
        if (best === "top" && y - headerTop > (headerBottom - headerTop) / 3) best = "center";
        else if (best !== "center" && best !== "top") best = "center";
      } else if (best === "left" || best === "right") {
        best = "center";
      }
    }
    if (!best) return "center";
    // mutate rect to the drop-zone region
    if (best === "top") { rect.height = rect.height / 2; }
    else if (best === "bottom") { rect.y += rect.height / 2; rect.height = rect.height / 2; }
    else if (best === "left") { rect.width = rect.width / 2; }
    else if (best === "right") { rect.x += rect.width / 2; rect.width = rect.width / 2; }
    return best;
  };

  M.onDragLeaf = function (event, leaf) {
    // compact drag state machine: ghost follows the pointer, drop resolves through getDropLocation
    const doc = event.doc || document;
    const win = event.win || window;
    event.dataTransfer.setData("text/plain", "");
    const ghost = env().createDiv("drag-ghost mod-leaf");
    ghost.createDiv("drag-ghost-icon", (el) => host.setIcon(el, leaf.getIcon()));
    ghost.createDiv({ cls: "drag-ghost-title", text: env().gc(leaf.getDisplayText(), 60) });
    doc.body.appendChild(ghost);
    let dragging = false;
    let lastX = event.clientX, lastY = event.clientY;
    const moveGhost = (e) => {
      ghost.style.left = e.clientX + 15 + "px";
      ghost.style.top = e.clientY + 15 + "px";
    };
    moveGhost(event);
    let overlay = null;
    const cleanup = () => {
      win.removeEventListener("dragover", onOver);
      win.removeEventListener("drop", onDrop);
      win.removeEventListener("dragend", onEnd);
      doc.body.removeClass("is-grabbing");
      if (overlay) { overlay.remove(); overlay = null; }
      ghost.remove();
    };
    const onOver = (e) => {
      if (!dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (dx * dx + dy * dy < 25) return;
        dragging = true;
        doc.body.addClass("is-grabbing");
      }
      const target = this.getDropLocation(e);
      e.dataTransfer.dropEffect = target ? "move" : "none";
      if (overlay) { overlay.remove(); overlay = null; }
      if (target && target !== leaf && !(target instanceof host.WorkspaceLeaf && target.view instanceof host.EmptyView)) {
        overlay = target.containerEl.createDiv("workspace-fake-target-overlay");
      }
    };
    const onDrop = (e) => {
      cleanup();
      const target = this.getDropLocation(e);
      if (!target || target === leaf) return;
      if (target instanceof host.WorkspaceSidedock || target instanceof host.MobileDrawer) {
        if (host.Platform.isMobile && target instanceof host.MobileDrawer) {
          target.insertChild(target.children.length, leaf);
        } else {
          const tabs = new host.WorkspaceTabs(this);
          tabs.insertChild(0, leaf);
          target.insertChild(target.children.length, tabs);
        }
      } else if (target instanceof host.WorkspaceTabs) {
        const index = target.getTabInsertLocation ? target.getTabInsertLocation(e.clientX).index : target.children.length;
        const oldParent = leaf.parent;
        if (oldParent) oldParent.removeChild(leaf);
        target.insertChild(Math.min(index, target.children.length), leaf);
      } else if (target instanceof host.WorkspaceLeaf) {
        const rect = { x: target.containerEl.getBoundingClientRect().left, y: target.containerEl.getBoundingClientRect().top, width: target.containerEl.getBoundingClientRect().width, height: target.containerEl.getBoundingClientRect().height };
        const dir = this.getDropDirection(e, rect, [], target.parent);
        if (dir === "center") {
          const oldParent = leaf.parent;
          const oldIndex = oldParent ? oldParent.children.indexOf(leaf) : -1;
          if (oldParent) oldParent.removeChild(leaf);
          const tp = target.parent;
          if (tp) tp.insertChild(tp.children.indexOf(target), leaf);
        } else {
          const tabs = new host.WorkspaceTabs(this);
          const parent = target.parent;
          const at = parent.children.indexOf(target);
          parent.insertChild(at + (dir === "left" || dir === "top" ? 0 : 1), tabs);
          tabs.insertChild(0, leaf);
          if (parent instanceof host.WorkspaceSplit) {
            // leaf sits inside tabs; split handled by tabs' own layout
          }
        }
      } else if (target instanceof host.WorkspaceSplit || target instanceof host.WorkspaceContainer) {
        const tabs = new host.WorkspaceTabs(this);
        tabs.insertChild(0, leaf);
        target.insertChild(target.children.length, tabs);
      }
      this.requestResize();
    };
    const onEnd = () => cleanup();
    win.addEventListener("dragover", onOver);
    win.addEventListener("drop", onDrop);
    win.addEventListener("dragend", onEnd);
  };

  M.onStartLink = function (leaf) {
    const win = window;
    const onMove = (event) => {
      const target = this.getDropLocation(event);
      if (target instanceof host.WorkspaceTabs) {
        const resolved = target.children[target.currentTab];
        if (resolved instanceof host.WorkspaceLeaf && resolved.view instanceof host.ItemView && resolved !== leaf) {
          leaf.setGroupMember(resolved);
        }
      }
    };
    const onUp = () => {
      win.removeEventListener("mousemove", onMove);
      win.removeEventListener("mouseup", onUp);
    };
    win.addEventListener("mousemove", onMove);
    win.addEventListener("mouseup", onUp);
  };

  // ---------- context menus ----------

  M.handleLinkContextMenu = function (menu, linktext, sourcePath, source) {
    if (!linktext) return false;
    const { path } = parseLinktext(linktext);
    const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    const isPhone = host.Platform.isPhone;
    if (file) {
      if (isPhone) {
        menu.addItem((item) => item.setSection("title").setTitle(file.getShortName ? file.getShortName() : file.path).setIcon("lucide-file").setIsLabel && item.setIsLabel());
      }
      menu.addItem((item) => item
        .setSection("open")
        .setTitle(host.t.interface.menu.openLink())
        .setIcon("lucide-link")
        .onClick((evt) => this.openLinkText(linktext, sourcePath, host.Keymap.isModEvent(evt) ? "split" : "tab")));
      menu.addItem((item) => item
        .setSection("open")
        .setTitle(host.t.interface.menu.openInNewTab())
        .setIcon("lucide-plus")
        .onClick(() => this.openLinkText(linktext, sourcePath, "tab")));
      if (host.Platform.canSplit) {
        menu.addItem((item) => item
          .setSection("open")
          .setTitle(host.t.interface.menu.openToTheRight())
          .setIcon("lucide-columns-2")
          .onClick(() => this.openLinkText(linktext, sourcePath, "split")));
      }
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(env().gm.plugins.fileExplorer.menuOptRename())
        .setIcon("lucide-edit-3")
        .onClick(() => this.app.fileManager.promptForFileRename(file)));
      this.trigger("file-menu", menu, file, "link-context-menu", source);
      return true;
    }
    menu.addItem((item) => item
      .setSection("open")
      .setTitle(host.t.interface.menu.createFile())
      .setIcon("lucide-file-plus")
      .onClick((evt) => this.openLinkText(linktext, sourcePath, host.Keymap.isModEvent(evt) ? "split" : "tab")));
    return true;
  };

  M.handleExternalLinkContextMenu = function (menu, url) {
    if (!url) return false;
    menu.addItem((item) => item
      .setSection("info")
      .setTitle(host.t.interface.menu.copyUrl())
      .setIcon("lucide-copy")
      .onClick(() => {
        copyText(url);
        new host.Notice(host.t.interface.copied({ item: "URL" }));
      }));
    menu.addItem((item) => item
      .setSection("open")
      .setTitle(env().gm.plugins.webViewer.actionOpenLinkDefaultBrowser())
      .setIcon("lucide-external-link")
      .onClick(() => window.open(url, "_external")));
    this.trigger("url-menu", menu, url);
    return true;
  };

  M.openLinkText = function (linktext, sourcePath, direction, newLeaf) {
    const leaf = this.getLeaf(direction === "window" ? "window" : direction === "split" ? "split" : direction === "tab" || direction === true ? "tab" : undefined);
    const options = {};
    if (newLeaf) options.group = undefined;
    return leaf.openLinkText(linktext, sourcePath, options);
  };

  // ---------- URI plumbing ----------

  M.registerUriHook = function () {
    const ws = this;
    const dispatch = (action) => {
      const container = ws.getFocusedContainer();
      if (container && container.win) container.win.focus && container.win.focus();
      const handler = ws.protocolHandlers.get(action.action);
      if (handler) {
        try { handler(action); }
        catch (e) { console.error(e); new host.Notice(host.t.interface.msgPluginError({ plugin: "" })); }
      } else {
        new host.Notice(host.t.interface.msgInvalidUriAction());
      }
    };
    const previous = window.OBS_ACT;
    window.OBS_ACT = function (action) {
      if (previous && previous !== window.OBS_ACT) {
        try { previous(action); } catch (e) { /* chained once */ }
      }
      dispatch(action);
    };
    if (host.Platform.isMobile && env().xm) {
      try {
        env().xm.addListener("appUrlOpen", (event) => {
          const url = event.url;
          const parsed = parseCallbackUrl(url);
          if (parsed && parsed.vault && parsed.vault.toLowerCase() !== ws.app.vault.getName().toLowerCase()) {
            sessionStorage.setItem("obsidian-uri", url);
            location.reload();
            return;
          }
          const action = parsed || { action: "open" };
          dispatch(action);
        });
      } catch (e) { console.error(e); }
    }
  };

  // ---------- frameless / title / options ----------

  M.updateFrameless = function () {
    if (!this.layoutReady) return;
    const roots = [this.rootSplit];
    const children = this.floatingSplit ? this.floatingSplit.children : [];
    for (const win of children) roots.push(win);
    // collect tab groups touching the top edge per root container
    for (const root of roots) {
      const groups = [];
      const collect = (node, touchesTop) => {
        if (!node) return;
        if (node instanceof host.WorkspaceTabs) {
          groups.push({ node, touchesTop });
          return;
        }
        if (node instanceof host.WorkspaceSplit) {
          node.children.forEach((child, i) => {
            const top = touchesTop && (node.direction === "vertical" ? i === 0 : true);
            collect(child, top);
          });
          return;
        }
        if (node.children) node.children.forEach((child) => collect(child, touchesTop));
      };
      collect(root, true);
      for (const g of groups) {
        g.node.containerEl.removeClass("mod-top", "mod-top-left-space", "mod-top-right-space");
      }
      const topGroups = groups.filter((g) => g.touchesTop);
      if (topGroups.length > 0 && !host.Platform.isMobile) {
        topGroups[0].node.containerEl.addClass("mod-top", "mod-top-left-space");
        topGroups[topGroups.length - 1].node.containerEl.addClass("mod-top", "mod-top-right-space");
      } else if (topGroups.length > 0) {
        for (const g of topGroups) g.node.containerEl.addClass("mod-top");
      }
    }
    // re-parent the sidebar toggle buttons for the main root
    this.positionSidebarToggle(this.leftSidebarToggleButtonEl, this.leftSplit, this.leftRibbon, "left");
    this.positionSidebarToggle(this.rightSidebarToggleButtonEl, this.rightSplit, this.rightRibbon, "right");
    this.trigger("window-frame-change");
  };

  M.positionSidebarToggle = function (button, dock, ribbon, side) {
    if (!button) return;
    const isMobile = host.Platform.isMobile;
    const ribbonVisible = ribbon && ribbon.containerEl && ribbon.containerEl.isShown();
    if (isMobile) {
      // tablet/pinned drawer handling is minimal: keep the button inside the nearest top tab group
    }
    if (ribbonVisible || isMobile) {
      const target = ribbon ? ribbon.containerEl : this.rootSplit && this.rootSplit.containerEl;
      if (target && button.parentNode !== target) target.appendChild(button);
      button.show();
      return;
    }
    // dock expanded -> edge tab group header; collapsed -> nearest top tab group
    let groups = [];
    const collect = (node, touchesTop) => {
      if (!node) return;
      if (node instanceof host.WorkspaceTabs) { groups.push({ node, touchesTop }); return; }
      if (node instanceof host.WorkspaceSplit) {
        node.children.forEach((child) => collect(child, touchesTop));
        return;
      }
      if (node.children) node.children.forEach((child) => collect(child, touchesTop));
    };
    collect(this.rootSplit, true);
    let target = null;
    if (dock && !dock.collapsed) {
      // edge-most tab group on this side
      target = side === "left" ? groups[0] && groups[0].node : groups[groups.length - 1] && groups[groups.length - 1].node;
    }
    if (!target) {
      const top = groups.find((g) => g.touchesTop);
      target = top && top.node;
    }
    if (target && target.tabHeaderContainerEl && button.parentNode !== target.tabHeaderContainerEl) {
      target.tabHeaderContainerEl.appendChild(button);
    }
    const showRight = !host.Platform.isMobile && this.rightSplit && !this.rightSplit.collapsed && !this.rightSplit.isPinned;
    if (side === "right" && !showRight) button.hide();
    else button.show();
  };

  M.updateOptions = function () {
    this.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof host.MarkdownView && leaf.view.updateOptions) leaf.view.updateOptions();
    });
    if (host.Platform.isDesktopApp && !host.Platform.isMobile) {
      try { s12ApplySpellcheckerLanguages(this.app.vault.getConfig("spellcheckLanguages")); } catch (e) {}
    }
  };

  M.updateMobileVisibleTabGroup = function () {
    if (!host.Platform.isMobile || !this.rootSplit) return;
    const marks = new Set();
    let leaf = this.activeLeaf;
    if (!leaf || !(leaf.parent instanceof host.WorkspaceTabs)) {
      const recent = this.getMostRecentLeaf();
      leaf = recent;
    }
    let node = leaf;
    while (node && node !== this.rootSplit) {
      if (node instanceof host.WorkspaceTabs) marks.add(node);
      node = node.parent;
    }
    const visit = (n) => {
      if (!n) return;
      if (n instanceof host.WorkspaceTabs) n.containerEl.toggleClass("mod-visible", marks.has(n));
      (n.children || []).forEach(visit);
    };
    visit(this.rootSplit);
  };

  // ---------- updateLayout self-heal ----------

  M.updateLayout = function () {
    if (!this.layoutReady) return;
    // drain queued dimension recomputes
    const queue = this.layoutItemQueue;
    this.layoutItemQueue = [];
    for (const item of queue) {
      try { item.recomputeChildrenDimensions && item.recomputeChildrenDimensions(); } catch (e) { console.error(e); }
    }
    // empty root -> fresh tab + leaf
    if (this.rootSplit && this.rootSplit.children.length === 0) {
      const tabs = new host.WorkspaceTabs(this);
      tabs.insertChild(0, new host.WorkspaceLeaf(this.app));
      if (this.lastTabGroupStacked) tabs.setStacked(true);
      this.rootSplit.insertChild(0, tabs);
    }
    // detached/missing active leaf -> pick a replacement
    const active = this.activeLeaf;
    if (!active || !this.isAttached(active)) {
      let next = null;
      if (this.activeTabGroup && this.isAttached(this.activeTabGroup)) {
        next = this.activeTabGroup.children[this.activeTabGroup.currentTab];
      }
      if (!next) next = this.getMostRecentLeaf(this.getFocusedContainer());
      if (!next) {
        this.iterateAllLeaves((leaf) => { if (!next || leaf.activeTime > next.activeTime) next = leaf; });
      }
      if (!next) {
        const tabs = new host.WorkspaceTabs(this);
        next = new host.WorkspaceLeaf(this.app);
        tabs.insertChild(0, next);
        this.rootSplit.insertChild(this.rootSplit.children.length, tabs);
      }
      this.setActiveLeaf(next, { focus: true });
    }
    if (this.activeTabGroup) this.activeTabGroup.containerEl.toggleClass("mod-active", this.activeTabGroup === (this.activeLeaf && this.activeLeaf.parent));
    if (host.Platform.isMobile) this.updateMobileVisibleTabGroup();
    // dissolve singleton link groups
    const groups = {};
    this.iterateAllLeaves((leaf) => {
      if (leaf.group) (groups[leaf.group] = groups[leaf.group] || []).push(leaf);
    });
    for (const id of Object.keys(groups)) {
      if (groups[id].length === 1) groups[id][0].setGroup(null);
    }
    this.updateFrameless();
    this.updateTitle();
    this.requestSaveLayout();
    this.requestResize();
    this.requestLayoutChangeEvents();
  };

  M.ensureSideLeaf = function (viewType, side, options) {
    options = options || {};
    const dock = side === "left" ? this.leftSplit : this.rightSplit;
    const existing = [];
    if (dock) this.iterateLeaves(dock, (leaf) => { if (leaf.view && leaf.view.getViewType() === viewType) existing.push(leaf); });
    let leaf = existing[0];
    const reveal = options.reveal !== false;
    const active = !!options.active;
    if (!leaf) {
      leaf = side === "left" ? this.getLeftLeaf(options.splitNew ? "split" : undefined) : this.getRightLeaf(options.splitNew ? "split" : undefined);
    }
    if (!leaf) return null;
    if ((active || reveal) && leaf.isDeferred) leaf.loadIfDeferred();
    if (options.state || (leaf.view && leaf.view.getViewType() !== viewType)) {
      leaf.setViewState({ type: viewType, state: options.state || {} });
    }
    this.revealLeaf(leaf);
    if (active) this.setActiveLeaf(leaf, { focus: !!options.focus });
    return leaf;
  };

  return M;
}

