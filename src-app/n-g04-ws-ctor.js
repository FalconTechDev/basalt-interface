import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { makeHotkey } from "./text.js";
import { firstHeadingText } from "./path.js";
import { s12PosEq } from "./s12-consts.js";
import { ng04WsTree } from "./n-g04-ws-tree.js";
import { ng04WsOps } from "./n-g04-ws-ops.js";
import { parseCallbackUrl } from "./vault-crypto.js";
import { closeAllMenus } from "./menu.js";
let Ng04HostRef = null;

/**
 * Workspace constructor (spec g04, part C): fields, listeners, ribbons,
 * toggle buttons, commands, protocol handlers, hover sources, CM patch.
 */
export function ng04S48Workspace(host) {
  Ng04HostRef = host;
  function Workspace(app, containerEl) {
    const self = host.Events.call(this) || this;
    self.app = app;
    self.containerEl = containerEl;

    // ---- fields ----
    self.leftSplit = null;
    self.rightSplit = null;
    self.rootSplit = null;
    self.floatingSplit = null;
    self.layoutReady = false;
    self.activeLeaf = null;
    self.activeTabGroup = null;
    self._activeEditor = null;
    self.lastActiveFile = null;
    self.layoutItemQueue = [];
    self.mobileFileInfos = [];
    self.backlinkInDocument = false;
    self.lastTabGroupStacked = false;
    self.undoHistory = [];
    self.onLayoutReadyCallbacks = [];
    self.protocolHandlers = new Map();
    self.hoverLinkSources = {};
    self.operatorFuncConfigs = {};
    self.editorExtensions = [];
    self.handleXCallback = function (e, file) { return ng04HandleXCallback(self, e, file); };

    self.requestSaveLayout = debounceCall(self.saveLayout.bind(self), 1000);
    self.requestResize = debounceCall(self.onResize.bind(self), 0);
    self.requestActiveLeafEvents = debounceCall(self.activeLeafEvents.bind(self), 0);
    self.requestUpdateLayout = env().Cc(self.updateLayout.bind(self));
    self.requestLayoutChangeEvents = debounceCall(() => {
      if (self.layoutReady) self.trigger("layout-change");
    }, 10);

    self.scope = new (env().Rg)(app.scope, () => {
      const leaf = self.activeLeaf;
      return leaf && leaf.view ? leaf.view.scope : null;
    });
    self.recentFileTracker = new (env().B0)(self, app.vault);
    self.editorSuggest = new (env().f0)(app);

    // ---- Escape: refocus the most recent navigable leaf ----
    app.scope.register([], "Escape", (event) => {
      const active = self.activeLeaf;
      if (active && active.view instanceof host.MarkdownView && active.view.getMode() === "source") {
        const doc = env().activeDocument;
        const el = doc.activeElement;
        const inTitle = active.titleEl && active.titleEl.isActiveElement && active.titleEl.isActiveElement();
        const inInline = active.inlineTitleEl && active.inlineTitleEl.isActiveElement && active.inlineTitleEl.isActiveElement();
        const editorish = env().yg(el);
        if (!inTitle && !inInline && !editorish && !(active.editor && active.editor.hasFocus && active.editor.hasFocus())) {
          active.editor && active.editor.focus && active.editor.focus();
        }
      }
      const view = active && active.view;
      if (!view || !view.navigation) {
        let target = null;
        if (active) {
          const container = active.getContainer();
          if (container) {
            let best = 0;
            self.iterateLeaves(container, (leaf) => {
              if (leaf.canNavigate() && leaf.activeTime >= best) { best = leaf.activeTime; target = leaf; }
            });
          }
        }
        if (!target) {
          let best = 0;
          self.iterateAllLeaves((leaf) => {
            if (leaf.canNavigate() && leaf.activeTime >= best) { best = leaf.activeTime; target = leaf; }
          });
        }
        if (target) self.setActiveLeaf(target, { focus: false });
      }
    });
    app.keymap.pushScope(self.scope);

    // ---- ribbons + sidebar toggle buttons ----
    self.leftRibbon = new (env().P0)(self, "left");
    self.rightRibbon = new (env().P0)(self, "right");
    self.leftSidebarToggleButtonEl = ng04MakeToggleButton(self, "left");
    self.rightSidebarToggleButtonEl = ng04MakeToggleButton(self, "right");

    ng04WireListeners(self, host);
    ng04RegisterEventMenus(self);
    ng04RegisterCommands(self);
    ng04RegisterProtocolHandlers(self);
    ng04RegisterHoverSources(self);
    ng04PatchCodeMirror(self);
    return self;
  }

  inherit(Workspace, host.Events);
  Object.assign(Workspace.prototype, ng04WsTree(host), ng04WsOps(host));
  // views are registered through the workspace by plugins written against it; the registry itself lives on the app
  Workspace.prototype.registerView = function (type, creator) { return this.app.viewRegistry.registerView(type, creator); };
  Workspace.prototype.unregisterView = function (type) { return this.app.viewRegistry.unregisterView(type); };

  Object.defineProperty(Workspace.prototype, "initialized", {
    get() { return !!this.rootSplit; },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(Workspace.prototype, "activeEditor", {
    get() {
      if (this._activeEditor) return this._activeEditor;
      const leaf = this.activeLeaf;
      return leaf && leaf.view instanceof host.MarkdownView ? leaf.view : null;
    },
    set(editor) {
      if (editor instanceof host.MarkdownView) this._activeEditor = editor;
    },
    enumerable: true,
    configurable: true,
  });

  return Workspace;
}

// ---------- helpers ----------

function ng04MakeToggleButton(ws, side) {
  const dock = side === "left" ? () => ws.leftSplit : () => ws.rightSplit;
  const el = env().createDiv(`sidebar-toggle-button mod-${side}`);
  const icon = el.createDiv("clickable-icon sidebar-toggle-button-icon");
  host_setIcon(icon, side === "left" ? "lucide-panel-left" : "lucide-panel-right");
  host_setTooltip(el, side === "left" ? host_t(ws).interface.menu.leftSidebar() : host_t(ws).interface.menu.rightSidebar());
  el.addEventListener("click", () => {
    const d = dock();
    if (d && d.toggle) d.toggle();
  });
  el.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const menu = new Ng04HostRef.Menu().addSections(["", "action"]);
    const d = dock();
    if (d) {
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(d.collapsed ? host_t(ws).interface.sidebarExpand() : host_t(ws).interface.sidebarCollapse())
        .setChecked(!d.collapsed)
        .onClick(() => d.toggle()));
    }
    if (side === "left") {
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(host_t(ws).interface.menu.ribbon())
        .setIcon("lucide-panel-left-close")
        .setChecked(!!ws.app.vault.getConfig("showRibbon"))
        .onClick(() => ws.app.vault.setConfig("showRibbon", !ws.app.vault.getConfig("showRibbon"))));
    }
    menu.showAtMouseEvent(event);
  });
  return el;
}

function host_t(ws) { return ws.app ? env().gm : env().gm; }
function host_setIcon(el, icon) { env().tv(el, icon); }
function host_setTooltip(el, text) { env().Sv(el, text); }

// ---------- window / vault listeners ----------

function ng04WireListeners(ws, host) {
  Ng04HostRef = host;
  const app = ws.app;
  const win = window;

  win.addEventListener("resize", () => ws.requestResize());
  win.addEventListener("popstate", () => { closeAllMenus(); });

  // per-leaf history replaces the browser history API
  const leafHistory = (fn) => () => {
    const leaf = ws.activeLeaf;
    if (leaf && leaf.history) fn.call(leaf.history);
  };
  win.history.forward = leafHistory(function () { this.go(1); });
  win.history.back = leafHistory(function () { this.go(-1); });
  win.history.go = (n) => { const leaf = ws.activeLeaf; if (leaf && leaf.history) leaf.history.go(n); };

  if (!host.Platform.isLinux) {
    win.addEventListener("mousedown", (event) => {
      if (event.button === 3 || event.button === 4) {
        event.preventDefault();
        event.stopPropagation();
        if (event.button === 3) ws.activeLeaf && ws.activeLeaf.history.back();
        else ws.activeLeaf && ws.activeLeaf.history.forward();
      }
    }, true);
  }

  if (host.Platform.isDesktopApp) {
    win.addEventListener("focus", () => {
      ws.rootSplit && ws.rootSplit.onFocus && ws.rootSplit.onFocus();
    });
    win.addEventListener("fullscreenchange", () => ws.updateFrameless());
  }

  win.addEventListener("copy", (event) => {
    if (event.defaultPrevented || !event.isTrusted) return;
    const el = env().activeDocument.activeElement;
    if (el && env().yg(el)) return;
    const view = ws.activeLeaf && ws.activeLeaf.view;
    if (view && view.handleCopy) {
      view.handleCopy(event);
      if (event.defaultPrevented) return;
    }
    if (el && el !== env().activeDocument.body) {
      el.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: event.clipboardData }));
    }
  });
  win.addEventListener("paste", (event) => {
    if (event.defaultPrevented || !ws.activeLeaf) return;
    const el = env().activeDocument.activeElement;
    if (el && env().yg(el)) return;
    const view = ws.activeLeaf.view;
    if (view && view.handlePaste) view.handlePaste(event);
  });
  win.addEventListener("cut", (event) => {
    if (event.defaultPrevented || !ws.activeLeaf) return;
    const el = env().activeDocument.activeElement;
    if (el && env().yg(el)) return;
    const view = ws.activeLeaf.view;
    if (view && view.handleCut) view.handleCut(event);
  });

  // vault rename: rewrite file paths inside history states and undo stack
  app.vault.on("rename", (file, oldPath) => {
    if (!(file instanceof host.TFile)) return;
    const fix = (entry) => {
      const state = entry.state;
      if (state && state.state && state.state.file === oldPath) {
        state.state.file = file.path;
        if (entry.title) entry.title = lastSegmentSafe(file.path);
      }
    };
    this_iterateEntries(ws, (entry) => fix(entry));
    for (const item of ws.undoHistory) {
      if (item.state && item.state.state && item.state.state.file === oldPath) {
        item.state.state.file = file.path;
      }
    }
  });

  // view registry: reopen deferred leaves when their type (un)registers
  const reopenDeferred = (type) => {
    ws.getLeavesOfType(type).forEach((leaf) => {
      if (leaf.isDeferred) {
        const state = leaf.getViewState();
        leaf.open(new host.EmptyView(leaf)).then(() => leaf.setViewState(state));
      }
    });
  };
  app.viewRegistry.on("view-registered", reopenDeferred);
  app.viewRegistry.on("view-unregistered", reopenDeferred);

  // mobile back button
  if (host.Platform.isMobile && env().xm) {
    let lastBack = 0;
    try {
      env().xm.addListener("backButton", () => {
        const modal = env().activeDocument.querySelector(".modal-container");
        if (modal) { modal.remove(); return; }
        const left = ws.leftSplit;
        const right = ws.rightSplit;
        if (left && !left.collapsed && !left.isPinned) { left.collapse && left.collapse(); return; }
        if (right && !right.collapsed && !right.isPinned) { right.collapse && right.collapse(); return; }
        const leaf = ws.activeLeaf;
        if (leaf && leaf.history && leaf.history.backHistory.length > 0) { leaf.history.back(); return; }
        const now = Date.now();
        if (now - lastBack < 5000) {
          try { env().xm.minimizeApp(); } catch (e) {}
        } else {
          lastBack = now;
          new host.Notice(env().gm.mobile.msgBackAgainToExit(), 5000);
        }
      });
    } catch (e) { console.error(e); }
  }

  // iOS status tap: scroll topmost modal / prefer left dock / active leaf
  if (host.Platform.isIosApp) {
    try {
      env().xm.addListener("statusTap", () => {
        const modal = env().activeDocument.querySelector(".modal-container");
        if (modal) { modal.scrollTo({ top: 0, behavior: "smooth" }); return; }
        const left = ws.leftSplit;
        const right = ws.rightSplit;
        const dock = left && !left.collapsed ? left : (right && !right.collapsed ? right : null);
        if (dock) {
          const leaf = dock.children[0];
          if (leaf) { leaf.setEphemeralState({ scroll: 0 }); return; }
        }
        const leaf = ws.activeLeaf;
        if (leaf) {
          if (leaf.view instanceof host.MarkdownView) leaf.setEphemeralState({ scroll: 0 });
          else leaf.containerEl.scrollTop = 0;
        }
      });
    } catch (e) { console.error(e); }
  }

  // css-change: native window background (iOS) / frameDom (macOS)
  try {
    env().xm.addListener("cssChange", () => {
      if (host.Platform.isIosApp) {
        const bg = getComputedStyle(document.body).getPropertyValue("--background-primary") || getComputedStyle(document.body).backgroundColor;
        document.documentElement.style.setProperty("--native-bg", bg);
      }
      if (host.Platform.isMacOS) {
        if (window.frameDom && window.frameDom.requestUpdateStatus) window.frameDom.requestUpdateStatus();
        ws.iterateAllLeaves(() => {});
        const children = ws.floatingSplit ? ws.floatingSplit.children : [];
        for (const win of children) {
          if (win.win && win.win.frameDom && win.win.frameDom.requestUpdateStatus) win.win.frameDom.requestUpdateStatus();
        }
      }
    });
  } catch (e) {}

  // swipe -> "swipe" event + pull actions
  host.onSwipe(ws.containerEl, (event) => ws.trigger("swipe", event));
}

function this_iterateEntries(ws, fn) {
  ws.iterateAllLeaves((leaf) => {
    for (const e of leaf.history.backHistory) fn(e);
    for (const e of leaf.history.forwardHistory) fn(e);
  });
  for (const item of ws.undoHistory) {
    if (item.state) fn({ title: item.state.title, state: item.state });
  }
}
function lastSegmentSafe(path) { const i = path.lastIndexOf("/"); return i === -1 ? path : path.slice(i + 1); }

// ---------- event-menu contributions ----------

function ng04RegisterEventMenus(ws) {
  const app = ws.app;
  const T = () => env().gm;

  ws.on("file-menu", (menu, file, source, evt) => {
    menu.addItem((item) => item.setSection("info.copy").setTitle(T().interface.menu.copyPath()).setIcon("lucide-clipboard"));
    const isFile = file instanceof Ng04HostRef.TFile;
    if (isFile) {
      menu.addItem((item) => item
        .setSection("info.copy")
        .setTitle(T().interface.menu.copyObsidianUrl())
        .setIcon("lucide-link")
        .onClick(() => app.copyObsidianUrl(file)));
      menu.addItem((item) => item
        .setSection("system")
        .setTitle(Ng04HostRef.Platform.isMobile ? T().plugins.openWithDefaultApp.actionOpenFileMobile() : T().plugins.openWithDefaultApp.actionOpenFile())
        .setIcon("lucide-arrow-up-right")
        .onClick(() => app.openWithDefaultApp(file.path)));
      if (Ng04HostRef.Platform.canPopoutWindow) {
        menu.addItem((item) => item
          .setSection("open")
          .setTitle(T().interface.menu.openInNewWindow())
          .setIcon("lucide-picture-in-picture-2")
          .onClick(() => {
            const leaf = ws.openPopoutLeaf();
            leaf.openFile(file);
          }));
      }
    } else if (file && !file.isRoot || (file && file.isRoot === false)) {
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(file instanceof env().ZT ? T().plugins.fileExplorer.actionMoveFolder() : T().plugins.fileExplorer.actionMoveFile())
        .setIcon("lucide-folder-tree")
        .onClick(() => new (env().g0)(app, file)));
      menu.addItem((item) => item
        .setSection("info.copy")
        .setTitle(T().interface.menu.copyVaultPath())
        .setIcon("lucide-vault")
        .onClick(() => {
          copyTextFlat(file.path);
          new Ng04HostRef.Notice(T().interface.copied({ item: "path" }));
        }));
      if (Ng04HostRef.Platform.isDesktopApp && app.vault.adapter instanceof env().Eu) {
        menu.addItem((item) => item
          .setSection("info.copy")
          .setTitle(T().interface.menu.copyFullPath())
          .setIcon("lucide-hard-drive")
          .onClick(() => {
            copyTextFlat(app.vault.adapter.getFullPath(file.path));
            new Ng04HostRef.Notice(T().interface.copied({ item: "path" }));
          }));
        menu.addItem((item) => item
          .setSection("system")
          .setTitle(Ng04HostRef.Platform.isMacOS ? T().plugins.openWithDefaultApp.actionShowInFolderMac() : T().plugins.openWithDefaultApp.actionShowInFolder())
          .setIcon("lucide-folder-open")
          .onClick(() => app.showInFolder(file.path)));
      }
    }
  });

  ws.on("files-menu", (menu, files) => {
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(T().plugins.fileExplorer.actionMoveItems({ count: files.length }))
      .setIcon("lucide-folder-tree")
      .onClick(() => new (env().g0)(app, files)));
  });

  ws.on("markdown-viewport-menu", (menu, mode, source) => {
    const vault = app.vault;
    menu.addItem((item) => item
      .setSection("view")
      .setTitle(T().setting.editor.optionReadableLineLength())
      .setIcon("lucide-ruler")
      .setChecked(!!vault.getConfig("readableLineLength"))
      .onClick(() => vault.setConfig("readableLineLength", !vault.getConfig("readableLineLength"))));
    if (mode === "source") {
      menu.addItem((item) => item
        .setSection("view")
        .setTitle(T().menuItems.lineNumbers())
        .setIcon("lucide-list-ordered")
        .setChecked(!!vault.getConfig("showLineNumber"))
        .onClick(() => vault.setConfig("showLineNumber", !vault.getConfig("showLineNumber"))));
    }
    menu.addItem((item) => item
      .setSection("view")
      .setTitle(T().menuItems.inlineTitle())
      .setIcon("lucide-text-initial")
      .setChecked(!!vault.getConfig("showInlineTitle"))
      .onClick(() => vault.setConfig("showInlineTitle", !vault.getConfig("showInlineTitle"))));
  });

  const editorMenu = (menu, editor, view) => {
    const line = editor.getLine(editor.getCursor().line);
    const heading = firstHeadingText(line);
    if (heading && view instanceof Ng04HostRef.MarkdownView) {
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(T().interface.menu.renameHeading())
        .setIcon("lucide-edit-3")
        .onClick(() => {
          const leaf = ws.getLeafById ? null : null;
          new (env().pI)(app, ws.activeLeaf, editor.posToOffset ? editor.posToOffset(editor.getCursor()) : 0);
        }));
    }
    // block-id rename
    const token = line && line.match(/\^([A-Za-z0-9-]+)\s*$/);
    if (token) {
      menu.addItem((item) => item
        .setSection("selection")
        .setTitle(T().interface.menu.renameBlockid())
        .setIcon("lucide-edit-3")
        .onClick(() => new (env().dI)(app, ws.activeLeaf, token[1])));
    }
  };
  ws.on("editor-menu", editorMenu);

  ws.on("quit", (data) => {
    ws.requestSaveLayout.cancel();
    app.vault.requestSaveConfig && app.vault.requestSaveConfig();
    const promises = [];
    ws.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof Ng04HostRef.TextFileView && view.data !== view.lastSavedData) promises.push(view.save());
    });
    const adapter = app.vault.adapter;
    if (adapter && adapter.requestSave) {
      const pending = promises.length > 0 ? adapter.requestSave() : null;
      if (pending) promises.push(pending);
    }
    if (data) data.promises = promises;
  });
}

function copyTextFlat(text) {
  try { navigator.clipboard.writeText(text); } catch (e) {}
}

// ---------- commands ----------

function ng04RegisterCommands(ws) {
  const app = ws.app;
  const cmds = app.commands;
  const T = () => env().gm;
  const HK = (mods, key) => makeHotkey(mods, key);
  const Mod = Ng04HostRef.Platform.isMacOS ? "Meta" : "Ctrl";

  const activeLeaf = () => ws.activeLeaf;
  const activeView = (cls) => {
    const leaf = ws.activeLeaf;
    return leaf && leaf.view instanceof cls ? leaf.view : null;
  };
  const parentTabs = () => {
    const leaf = ws.activeLeaf;
    return leaf && leaf.parent instanceof Ng04HostRef.WorkspaceTabs ? leaf.parent : null;
  };

  const add = (cmd) => cmds.addCommand(cmd);

  add({
    id: "editor:save-file",
    name: T().commands.saveFile(),
    hotkeys: [HK(["Mod"], "s")],
    checkCallback: (checking) => {
      const view = activeView(Ng04HostRef.TextFileView);
      if (!view) return false;
      if (!checking) view.save();
      return true;
    },
  });
  add({
    id: "editor:download-attachments",
    name: T().commands.downloadAttachments(),
    checkCallback: (checking) => {
      const file = ws.getActiveFile();
      if (!file || file.extension !== "md") return false;
      if (!checking) app.fileManager.downloadAttachmentsForNote(file);
      return true;
    },
  });
  const linkToken = (editor) => {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch);
    const m = before.match(/\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]?$/) || before.match(/\[([^\]]*)\]\(([^)]+)\)?$/);
    return m ? (m[2] || m[1]) : null;
  };
  const openLinkCmd = (id, nameKey, paneType, hotkeys, needsPopout) => add({
    id,
    name: T().commands[nameKey](),
    hotkeys,
    editorCheckCallback: (checking, editor, view) => {
      if (!editor || !(view instanceof Ng04HostRef.MarkdownView)) return false;
      if (needsPopout && !Ng04HostRef.Platform.canPopoutWindow) return false;
      const token = linkToken(editor);
      if (!checking) {
        if (token) view.editMode && view.editMode.triggerClickableToken && view.editMode.triggerClickableToken(token, paneType);
        else ws.trigger("open-link", { paneType });
      }
      return true;
    },
  });
  openLinkCmd("editor:follow-link", "followCursorLink", false, [HK(["Alt"], "Enter")]);
  openLinkCmd("editor:open-link-in-new-leaf", "openCursorLinkInNewTab", "tab", [HK(["Mod"], "Enter")]);
  openLinkCmd("editor:open-link-in-new-window", "openCursorLinkInNewWindow", "window", [HK(["Mod", "Alt", "Shift"], "Enter")], true);
  openLinkCmd("editor:open-link-in-new-split", "openCursorLinkToTheRight", "split", [HK(["Mod", "Alt"], "Enter")]);
  add({
    id: "editor:rename-heading",
    name: T().commands.renameHeading ? T().commands.renameHeading() : "Rename heading",
    editorCheckCallback: (checking, editor, view) => {
      if (!editor || !(view instanceof Ng04HostRef.MarkdownView)) return false;
      const line = editor.getLine(editor.getCursor().line);
      if (!firstHeadingText(line)) return false;
      if (!checking) {
        const offset = editor.posToOffset ? editor.posToOffset(editor.getCursor()) : 0;
        new (env().pI)(app, ws.activeLeaf, offset);
      }
      return true;
    },
  });

  add({
    id: "workspace:toggle-pin",
    name: T().commands.togglePin(),
    checkCallback: (checking) => {
      const leaf = ws.activeLeaf;
      const ok = !!(leaf && leaf.view instanceof Ng04HostRef.ItemView && !(leaf.view instanceof Ng04HostRef.EmptyView));
      if (ok && !checking) leaf.togglePinned();
      return ok;
    },
  });

  const focusDir = (dir) => add({
    id: "editor:focus-" + dir,
    name: T().commands["navigateTab" + dir[0].toUpperCase() + dir.slice(1)] ? T().commands["navigateTab" + dir[0].toUpperCase() + dir.slice(1)]() : dir,
    checkCallback: (checking) => {
      if (!Ng04HostRef.Platform.canSplit) return false;
      const leaf = ws.activeLeaf;
      if (!leaf) return false;
      if (!checking) {
        const target = ws.getAdjacentLeafInDirection(leaf, dir);
        if (target) { env().Lv(); ws.setActiveLeaf(target, { focus: true }); }
      }
      return true;
    },
  });
  ["top", "bottom", "left", "right"].forEach(focusDir);

  const splitAvail = (checking, direction, sidebarBan) => {
    if (!Ng04HostRef.Platform.canSplit) return false;
    let leaf = ws.activeLeaf;
    if (!leaf || !(leaf.view instanceof Ng04HostRef.ItemView) || leaf.view instanceof Ng04HostRef.EmptyView) return false;
    if (sidebarBan && ws.isInSidebar(leaf)) {
      leaf = ws.getMostRecentLeaf();
      if (!leaf || !(leaf.view instanceof Ng04HostRef.ItemView) || leaf.view instanceof Ng04HostRef.EmptyView) return false;
    }
    if (!checking) ws.duplicateLeaf(leaf, direction);
    return true;
  };
  add({
    id: "workspace:split-vertical",
    name: T().commands.splitRight(),
    checkCallback: (checking) => splitAvail(checking, "vertical", true),
  });
  add({
    id: "workspace:split-horizontal",
    name: T().commands.splitDown(),
    checkCallback: (checking) => splitAvail(checking, "horizontal", false),
  });
  add({
    id: "workspace:toggle-stacked-tabs",
    name: T().commands.toggleStackedTabs(),
    checkCallback: (checking) => {
      if (!Ng04HostRef.Platform.canStackTabs) return false;
      const leaf = ws.activeLeaf;
      const parent = leaf && leaf.parent;
      if (!(parent instanceof Ng04HostRef.WorkspaceTabs) || ws.isInSidebar(parent)) return false;
      if (!checking) parent.setStacked(!parent.isStacked);
      return true;
    },
  });
  add({
    id: "workspace:edit-file-title",
    name: T().commands.editFileTitle(),
    hotkeys: [HK([], "F2")],
    checkCallback: (checking) => {
      const view = activeView(Ng04HostRef.EditableFileView);
      if (!view) return false;
      if (!checking) ws.activeLeaf.setEphemeralState({ rename: "all" });
      return true;
    },
  });
  const copyNotice = (text) => { copyTextFlat(text); new Ng04HostRef.Notice(T().interface.copied({ item: text })); };
  add({
    id: "workspace:copy-path",
    name: T().commands.copyPath(),
    checkCallback: (checking) => {
      const file = ws.getActiveFile();
      if (!file) return false;
      if (!checking) copyNotice(file.path);
      return true;
    },
  });
  add({
    id: "workspace:copy-full-path",
    name: T().commands.copyFullPath(),
    checkCallback: (checking) => {
      const file = ws.getActiveFile();
      const adapter = app.vault.adapter;
      if (!file || !Ng04HostRef.Platform.isDesktopApp || !(adapter instanceof env().Eu)) return false;
      if (!checking) copyNotice(adapter.getFullPath(file.path));
      return true;
    },
  });
  add({
    id: "workspace:copy-url",
    name: T().commands.copyUrl(),
    checkCallback: (checking) => {
      const file = ws.getActiveFile();
      if (!file) return false;
      if (!checking) app.copyObsidianUrl(file);
      return true;
    },
  });
  add({
    id: "workspace:undo-close-pane",
    name: T().commands.undoCloseTab(),
    hotkeys: [HK(["Mod", "Shift"], "t")],
    checkCallback: (checking) => {
      const entry = ws.undoHistory[0];
      if (!entry) return false;
      if (!checking) ng04UndoClose(ws, entry);
      return true;
    },
  });
  add({
    id: "workspace:export-pdf",
    name: T().commands.exportPdf(),
    checkCallback: (checking) => {
      if (!Ng04HostRef.Platform.canExportPdf) return false;
      const view = activeView(Ng04HostRef.MarkdownView);
      if (!view || !view.printToPdf) return false;
      if (!checking) view.printToPdf();
      return true;
    },
  });
  add({
    id: "workspace:open-in-new-window",
    name: T().commands.openInNewWindow(),
    checkCallback: (checking) => {
      const leaf = ws.activeLeaf;
      if (!Ng04HostRef.Platform.canPopoutWindow || !leaf || !(leaf.view instanceof Ng04HostRef.ItemView)) return false;
      if (!checking) ws.openPopoutLeaf().setViewState(leaf.getViewState(), { focus: true });
      return true;
    },
  });
  add({
    id: "workspace:move-to-new-window",
    name: T().commands.moveToNewWindow(),
    checkCallback: (checking) => {
      const leaf = ws.activeLeaf;
      if (!Ng04HostRef.Platform.canPopoutWindow || !leaf || !(leaf.view instanceof Ng04HostRef.ItemView)) return false;
      if (!checking) ws.moveLeafToPopout(leaf);
      return true;
    },
  });

  const cycleTab = (delta) => add({
    id: "workspace:" + (delta > 0 ? "next-tab" : "previous-tab"),
    name: T().commands[delta > 0 ? "goToNextTab" : "goToPrevTab"](),
    hotkeys: delta > 0
      ? [HK(["Ctrl"], "Tab"), HK([Ng04HostRef.Platform.isMacOS ? "Meta" : "Ctrl", "Shift"], "]"), HK(["Ctrl"], "PageDown")]
      : [HK(["Ctrl", "Shift"], "Tab"), HK([Ng04HostRef.Platform.isMacOS ? "Meta" : "Ctrl", "Shift"], "["), HK(["Ctrl"], "PageUp")],
    checkCallback: (checking) => {
      const parent = parentTabs();
      if (!parent || parent.children.length === 0) return false;
      if (!checking) {
        const next = (parent.currentTab + delta + parent.children.length) % parent.children.length;
        parent.selectTabIndex(next);
        ws.setActiveLeaf(parent.children[next], { focus: true });
      }
      return true;
    },
  });
  cycleTab(1);
  cycleTab(-1);

  for (let n = 1; n <= 8; n++) {
    add({
      id: "workspace:goto-tab-" + n,
      name: T().commands.goToNthTab({ n }),
      hotkeys: [HK(["Mod"], String(n))],
      checkCallback: (checking) => {
        if (Ng04HostRef.Platform.isPhone) return false;
        const parent = parentTabs();
        if (!parent || parent.children.length < n) return false;
        if (!checking) {
          parent.selectTabIndex(n - 1);
          ws.setActiveLeaf(parent.children[n - 1], { focus: true });
        }
        return true;
      },
    });
  }
  add({
    id: "workspace:goto-last-tab",
    name: T().commands.goToLastTab(),
    hotkeys: [HK(["Mod"], "9")],
    checkCallback: (checking) => {
      const parent = parentTabs();
      if (!parent || parent.children.length === 0) return false;
      if (!checking) {
        const last = parent.children.length - 1;
        parent.selectTabIndex(last);
        ws.setActiveLeaf(parent.children[last], { focus: true });
      }
      return true;
    },
  });

  add({
    id: "workspace:new-tab",
    name: T().commands.newTab(),
    hotkeys: [HK(["Mod"], "t")],
    checkCallback: (checking) => {
      const leaf = ws.getMostRecentLeaf();
      const parent = leaf && leaf.parent;
      if (!(parent instanceof Ng04HostRef.WorkspaceTabs)) return false;
      if (!checking) {
        const nl = new Ng04HostRef.WorkspaceLeaf(app);
        parent.insertChild(parent.children.length, nl);
        parent.selectTabIndex(parent.children.length - 1);
        ws.setActiveLeaf(nl, { focus: true });
      }
      return true;
    },
  });
  add({
    id: "workspace:new-window",
    name: T().commands.newWindow(),
    checkCallback: (checking) => {
      if (!Ng04HostRef.Platform.canPopoutWindow) return false;
      if (!checking) {
        const leaf = ws.openPopoutLeaf();
        ws.setActiveLeaf(leaf, { focus: true });
      }
      return true;
    },
  });
  add({
    id: "workspace:close",
    name: T().commands.closeActiveTab(),
    hotkeys: [HK(["Mod"], "w")],
    checkCallback: (checking) => {
      let leaf = ws.activeLeaf;
      if (!leaf || !(leaf.view instanceof Ng04HostRef.ItemView) || ws.isInSidebar(leaf)) {
        leaf = ws.getMostRecentLeaf();
      }
      if (!leaf) return false;
      if (!checking) {
        if (!Ng04HostRef.Platform.isPhone && leaf.pinned) leaf.setPinned(false);
        leaf.detach();
      }
      return true;
    },
  });
  add({
    id: "workspace:close-window",
    name: T().commands.closeWindow ? T().commands.closeWindow() : "Close window",
    hotkeys: [HK(["Mod", "Shift"], "w")],
    checkCallback: (checking) => {
      if (!Ng04HostRef.Platform.canPopoutWindow || !env().activeWindow) return false;
      if (!checking) env().activeWindow.close();
      return true;
    },
  });
  add({
    id: "workspace:close-others",
    name: T().commands.closeOtherTabs(),
    checkCallback: (checking) => {
      const leaf = ws.activeLeaf;
      if (!leaf) return false;
      const container = leaf.getContainer();
      const victims = [];
      ws.iterateLeaves(container, (l) => { if (l !== leaf && !l.pinned) victims.push(l); });
      if (!checking) victims.forEach((l) => l.detach());
      return victims.length > 0;
    },
  });
  add({
    id: "workspace:close-tab-group",
    name: T().commands.closeTabGroup(),
    checkCallback: (checking) => {
      const leaf = ws.activeLeaf;
      const parent = leaf && leaf.parent;
      if (!Ng04HostRef.Platform.canSplit || !(parent instanceof Ng04HostRef.WorkspaceTabs) || ws.isInSidebar(parent)) return false;
      const unpinned = parent.children.filter((c) => !c.pinned);
      if (!checking) unpinned.forEach((c) => c.detach());
      return unpinned.length > 0;
    },
  });
  add({
    id: "workspace:close-others-tab-group",
    name: T().commands.closeOthersInTabGroup(),
    checkCallback: (checking) => {
      const leaf = ws.activeLeaf;
      const parent = leaf && leaf.parent;
      if (!Ng04HostRef.Platform.canSplit || !(parent instanceof Ng04HostRef.WorkspaceTabs) || ws.isInSidebar(parent)) return false;
      const others = parent.children.filter((c) => c !== leaf && !c.pinned);
      if (!checking) others.forEach((c) => c.detach());
      return others.length > 0;
    },
  });
  add({
    id: "workspace:show-trash",
    name: T().commands.showTrash(),
    checkCallback: (checking) => {
      if (!Ng04HostRef.Platform.isDesktopApp || app.vault.getConfig("trashOption") !== "local") return false;
      if (!checking) app.showInFolder(".trash");
      return true;
    },
  });
}

function ng04UndoClose(ws, entry) {
  ws.undoHistory.shift();
  const leaf = new Ng04HostRef.WorkspaceLeaf(ws.app, entry.leafId);
  // find the recorded parent tab group
  let parent = null;
  let root = null;
  const roots = [ws.rootSplit, ws.floatingSplit, ws.leftSplit, ws.rightSplit];
  for (const r of roots) {
    if (r && r.id === entry.rootId) { root = r; break; }
  }
  if (!root) root = ws.rootSplit;
  ws.iterateTabs(root, (tabs) => {
    if (!parent && tabs.id === entry.parentId) parent = tabs;
  });
  if (parent) {
    parent.insertChild(parent.children.length, leaf);
  } else {
    const tabs = new Ng04HostRef.WorkspaceTabs(ws);
    tabs.insertChild(0, leaf);
    root.insertChild(root.children.length, tabs);
  }
  if (entry.leafHistory) leaf.history.deserialize(entry.leafHistory);
  leaf.setViewState(entry.state, Object.assign({}, entry.eState, { active: true }));
}

// ---------- protocol handlers ----------

function ng04RegisterProtocolHandlers(ws) {
  const app = ws.app;
  const T = () => env().gm;
  const reg = (action, handler) => ws.registerObsidianProtocolHandler(action, handler);

  reg("open", (e) => {
    if (!e.file) return;
    const { path, subpath } = parseLinktextLocal(e.file);
    const file = app.metadataCache.getFirstLinkpathDest(path, "");
    if (file) {
      const leaf = ws.getLeaf(s12leafTypeOrFalseLocal(e.paneType));
      leaf.openFile(file, { active: true, eState: subpath ? { subpath } : undefined });
      new Ng04HostRef.Notice(T().interface.msgOpenFileThroughUri());
    } else {
      new Ng04HostRef.Notice(T().interface.msgFileNotFoundThroughUri());
    }
  });

  reg("search", (e) => {
    const plugin = app.internalPlugins.getEnabledPluginById("global-search");
    if (plugin && plugin.openGlobalSearch) plugin.openGlobalSearch(e.query);
  });

  reg("new", async (e) => {
    try {
      let file = null;
      if (e.file && !e.file.split("/").includes("..")) {
        const path = normalizePathLocal(e.file);
        file = app.metadataCache.getFirstLinkpathDest(path, "") || app.vault.getAbstractFileByPathInsensitive(path);
        if (!file && (e.overwrite || e.append || e.prepend)) {
          // resolve or create
          const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
          let parent = parentPath ? app.vault.getAbstractFileByPath(parentPath) : app.vault.getRoot();
          if (!parent) parent = await app.vault.createFolder(parentPath);
          if (parent) file = await app.fileManager.createNewFile(parent, lastSeg(path), "md");
        }
      }
      if (!file && e.name) {
        const name = String(e.name).replace(/[\\/]/g, "");
        const active = ws.getActiveFile();
        const parent = app.fileManager.getNewFileParent(active ? active.path : "", name);
        file = await app.fileManager.createNewFile(parent, name, "md");
      }
      let content = e.content;
      if (content === undefined && e.clipboard) {
        try { content = await navigator.clipboard.readText(); } catch (err) {}
      }
      if (file && content !== undefined) {
        if (e.append) await app.fileManager.insertIntoFile(file, content, { position: "end" });
        else if (e.prepend) await app.fileManager.insertIntoFile(file, content, { position: "start" });
        else await app.vault.modify(file, content);
      }
      if (!e.silent && file) {
        const leaf = ws.getLeaf(s12leafTypeOrFalseLocal(e.paneType));
        leaf.openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
      }
      ws.handleXCallback(e, file);
    } catch (err) {
      new Ng04HostRef.Notice(String(err && err.message ? err.message : err));
    }
  });

  reg("show-plugin", (e) => {
    if (app.plugins && !app.plugins.enabledPlugins) {
      // plugins disabled -> settings on community-plugins tab
      try { app.setting.open(); app.setting.openTabById("community-plugins"); } catch (err) {}
      return;
    }
    const modal = new (env().M0)(app, e.id);
    modal.open();
    modal.containerEl.addClass("mod-dim");
  });

  reg("show-theme", (e) => {
    const modal = new (env().A0)(app, e.name);
    modal.open();
    modal.containerEl.addClass("mod-dim");
  });

  reg("show-release-notes", (e) => {
    app.showReleaseNotes(e.version);
  });

  reg("debug-info", () => {
    new (env().m0)(app).open();
  });

  reg("publish-sites", () => {
    const plugin = app.internalPlugins.getPluginById && app.internalPlugins.getPluginById("publish");
    if (plugin && !plugin.enabled) app.internalPlugins.enablePlugin && app.internalPlugins.enablePlugin("publish");
    const p = app.internalPlugins.getEnabledPluginById("publish");
    if (p && p.viewSites) p.viewSites();
  });

  reg("sync-setup", (e) => {
    ws.onLayoutReady(() => {
      try {
        const plugin = app.internalPlugins.getEnabledPluginById("sync");
        if (e.vault && plugin && plugin.connectToVault) {
          plugin.connectToVault(JSON.parse(e.vault));
        } else {
          app.openVaultChooser();
        }
      } catch (err) { console.error(err); }
    });
  });

  reg("vault-setup", () => {
    (async () => {
      try {
        const name = T().interface.starterContent.welcomeFilename() + ".md";
        const file = await app.fileManager.createNewMarkdownFileFromLinktext(name, "");
        await app.vault.modify(file, T().interface.starterContent.welcomeFileContent());
        const leaf1 = ws.getLeaf("split");
        leaf1.openFile(file, { active: false });
        const leaf2 = ws.getLeaf("tab");
        leaf2.openFile(file, { active: true });
      } catch (err) { console.error(err); }
    })();
  });

  reg("hook-get-address", (e) => {
    if (!app.vault.getConfig("uriCallbacks")) return;
    const file = ws.getActiveFile();
    if (file) {
      if (!ws.handleXCallback(e, file)) {
        const md = "[" + file.basename + "](" + app.getObsidianUrl(file) + ")";
        copyTextFlat(md);
        new Ng04HostRef.Notice(T().interface.copied({ item: "URL" }));
      }
    } else if (e["x-error"]) {
      const url = String(e["x-error"]);
      const sep = url.includes("?") ? "&" : "?";
      window.open(url + sep + "errorCode=NotFound&errorMessage=" + encodeURIComponent("No file is open at the moment"), "_blank");
    }
  });
}

function parseLinktextLocal(linktext) {
  const hash = linktext.indexOf("#");
  const pipe = linktext.indexOf("|");
  let end = linktext.length;
  if (hash !== -1) end = Math.min(end, hash);
  if (pipe !== -1) end = Math.min(end, pipe);
  const path = linktext.slice(0, end);
  const subpath = hash !== -1 ? linktext.slice(hash) : "";
  return { path, subpath };
}
function normalizePathLocal(p) { return String(p).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, ""); }
function lastSeg(p) { const i = p.lastIndexOf("/"); return i === -1 ? p : p.slice(i + 1); }
function s12leafTypeOrFalseLocal(e) {
  return (typeof e === "boolean" || e === "tab" || e === "window" || e === "split") ? e : false;
}

function ng04HandleXCallback(ws, e, file) {
  const app = ws.app;
  if (!app.vault.getConfig("uriCallbacks")) return false;
  const xSuccess = e["x-success"];
  if (!xSuccess || !file) return false;
  try {
    const params = { name: file.basename, url: app.getObsidianUrl(file) };
    if (Ng04HostRef.Platform.isDesktopApp && app.vault.adapter instanceof env().Eu) params.file = app.vault.adapter.getFullPath(file.path);
    const sep = xSuccess.includes("?") ? "&" : "?";
    const qs = Object.keys(params).map((k) => k + "=" + encodeURIComponent(params[k])).join("&");
    const url = xSuccess + sep + qs;
    if (url.startsWith("file:")) return true;
    window.open(url, "_blank");
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// ---------- hover link sources ----------

function ng04RegisterHoverSources(ws) {
  const T = () => env().gm;
  ws.hoverLinkSources["search"] = { display: T().plugins.pagePreview.labelSourceSearch(), defaultMod: true };
  ws.hoverLinkSources["preview"] = { display: T().plugins.pagePreview.labelSourcePreview(), defaultMod: false };
  ws.hoverLinkSources["editor"] = { display: T().plugins.pagePreview.labelSourceEditor(), defaultMod: true };
  ws.hoverLinkSources["tab-header"] = { display: T().plugins.pagePreview.labelSourceTabHeader(), defaultMod: true };
}

// ---------- CodeMirror getMode patch ----------

function ng04PatchCodeMirror(ws) {
  if (!Ng04HostRef.codeMirrorCompat || typeof Ng04HostRef.codeMirrorCompat.getMode !== "function" || Ng04HostRef.codeMirrorCompat.getMode.__ng04) return;
  const original = Ng04HostRef.codeMirrorCompat.getMode;
  const wrapped = function (...args) {
    const mode = original.apply(this, args);
    const name = mode && (mode.name || (typeof mode === "string" ? mode : ""));
    if (!name || name === "null") {
      Ng04HostRef.codeMirrorCompat.getMode = original;
      env().fz && env().fz.then(() => {
        ws.iterateAllLeaves((leaf) => {
          if (leaf.view instanceof Ng04HostRef.MarkdownView && leaf.view.resetSyntaxHighlighting) {
            leaf.view.resetSyntaxHighlighting();
          }
        });
      }).catch(() => {});
    }
    return mode;
  };
  wrapped.__ng04 = true;
  Ng04HostRef.codeMirrorCompat.getMode = wrapped;
}
