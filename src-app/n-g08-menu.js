// g08 clean-room: native application menu builder + format-state CM plugin.
import { env } from "./env.js";
import { debounceCall } from "./timing.js";

export const ng08S04ModifierKeys = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];

export const ng08S04AcceleratorNames = {
  Mod: "CommandOrControl",
  Ctrl: "Ctrl",
  Meta: "Command",
  Alt: "Alt",
  Shift: "Shift",
};

export function ng08S04ModifierDisplayNames(isMac) {
  return isMac
    ? { Mod: "⌘", Ctrl: "⌃", Meta: "⌘", Alt: "⌥", Shift: "⇧" }
    : { Mod: "Ctrl", Ctrl: "Ctrl", Meta: "Win", Alt: "Alt", Shift: "Shift" };
}

function ng08Electron() {
  const shim = env().If;
  return shim ? shim("electron") : null;
}

/** Sends an "update-menu-items" IPC patch; merge defaults to false. No-op without Electron. */
export function ng08S04UpdateMenuItems(items, merge = false) {
  const electron = ng08Electron();
  if (electron && electron.ipcRenderer) electron.ipcRenderer.send("update-menu-items", items, merge);
}

function ng08MenuItems() {
  return __basaltHost.t.menuItems;
}

function ng08Cmd(id, label, extra) {
  return Object.assign({ id, appCommand: id, label, registerAccelerator: false }, extra || {});
}

function ng08Sep(extra) {
  return Object.assign({ type: "separator" }, extra || {});
}

/** Concatenates menu stages; `before` anchors stay as item metadata for the main process. */
function ng08MergeMenu(base, extra) {
  return base.concat(extra || []);
}

export function ng08DefineS04MenuManager(host) {
  const items = () => ng08MenuItems();

  function MenuManager(app) {
    this.app = app;
    app.workspace.registerEditorExtension(ng08S04FormatMenuPlugin(host));
    this.requestRender = host.debounce(this.render.bind(this), 200);
    const onFileOpen = host.debounce(() => this._onFileOpen(), 250);
    const onFrame = host.debounce(() => this.updateWorkspace(), 200);
    app.workspace.on("file-open", onFileOpen);
    app.workspace.on("active-leaf-change", onFileOpen);
    app.workspace.on("window-frame-change", onFrame);
    app.workspace.onLayoutReady(() => this.render());
  }
  const proto = MenuManager.prototype;

  proto._onFileOpen = function () {
    this.updateViewState();
    this.updateShareMenuItem();
  };

  proto.updateViewState = function () {
    const editor = this.app.workspace.activeEditor;
    const preview = editor ? editor.getMode() === "preview" : false;
    const source = editor
      ? { checked: !preview && !!editor.editMode.sourceMode, enabled: !preview }
      : { checked: false, enabled: false };
    ng08S04UpdateMenuItems([
      { itemId: "markdown:toggle-preview", eState: { checked: preview, enabled: !!editor } },
      { itemId: "editor:toggle-source", eState: source },
    ]);
  };

  proto.updateWorkspace = function () {
    const app = this.app;
    const isActiveWindow = env().activeWindow === window;
    const left = app.workspace.leftSplit;
    const right = app.workspace.rightSplit;
    const leaf = app.workspace.activeLeaf;
    ng08S04UpdateMenuItems([
      {
        itemId: "app:toggle-left-sidebar",
        eState: {
          checked: !!(left && !left.collapsed),
          enabled: isActiveWindow,
        },
      },
      {
        itemId: "app:toggle-right-sidebar",
        eState: {
          checked: !!(right && !right.collapsed),
          enabled: isActiveWindow,
        },
      },
      {
        itemId: "app:toggle-ribbon",
        eState: {
          checked: document.body.hasClass("show-ribbon"),
          enabled: isActiveWindow,
        },
      },
      {
        itemId: "workspace:move-to-new-window",
        eState: { enabled: !!(leaf && leaf.view instanceof host.ItemView) },
      },
    ]);
  };

  proto.updateShareMenuItem = function () {
    const app = this.app;
    if (!host.Platform.isMacOS) return;
    const adapter = app.vault.adapter;
    if (!(adapter instanceof env().Eu)) return;
    const editor = app.workspace.activeEditor;
    const file = editor ? editor.file : undefined;
    ng08S04UpdateMenuItems(
      [
        {
          itemId: "share-menu",
          eState: { sharingItem: { filePaths: file ? [adapter.getFullPath(file.path)] : [] } },
        },
      ],
      true
    );
  };

  proto.buildMenu = function () {
    const t = items();
    const app = this.app;

    const fileSubmenu = ng08MergeMenu(
      [
        ng08Cmd("file-explorer:new-file", t.newFile(), { before: ["open-section"] }),
        ng08Cmd("file-explorer:new-file-in-new-pane", t.newFileToTheRight(), { before: ["open-section"] }),
        ng08Cmd("workspace:new-tab", t.newTab(), { before: ["open-section"] }),
        ng08Cmd("workspace:new-window", t.newWindow(), { before: ["open-section"] }),
        ng08Sep({ before: ["open-section"] }),
        ng08Cmd("switcher:open", t.openSwitcher(), { before: ["open-section"] }),
        ng08Sep({ before: ["quit"] }),
        ng08Cmd("workspace:close", t.closeTab(), { before: ["open-section"] }),
        ng08Cmd("workspace:close-window", t.closeWindow(), { before: ["open-section"] }),
      ],
      host.Platform.isMacOS
        ? [ng08Sep(), { id: "share-menu", before: ["quit"], enabled: false, role: "shareMenu" }]
        : []
    );
    fileSubmenu.push(ng08Cmd("workspace:export-pdf", t.exportPdf(), { before: ["quit"] }));

    const editSubmenu = [
      { id: "find-section", before: ["speech-section"], type: "separator" },
      ng08Cmd("editor:open-search", t.find()),
      ng08Cmd("editor:open-search-replace", t.replace()),
      ng08Sep(),
    ];

    const insertSubmenu = [
      ng08Cmd("editor:insert-wikilink", t.insertWikilink()),
      ng08Cmd("editor:insert-link", t.insertMarkdownLink()),
      ng08Cmd("editor:insert-callout", t.insertCallout()),
      ng08Cmd("editor:insert-blockquote", t.insertQuote()),
      ng08Sep(),
      ng08Cmd("editor:insert-codeblock", t.insertCodeblock()),
      ng08Cmd("editor:insert-mathblock", t.insertMathBlock()),
      ng08Cmd("editor:insert-table", t.insertTable()),
      ng08Cmd("editor:insert-footnote", t.insertFootnote()),
      ng08Sep(),
      ng08Sep(),
      ng08Cmd("editor:toggle-bullet-list", t.toggleBulletList()),
      ng08Cmd("editor:toggle-numbered-list", t.toggleNumberedList()),
      ng08Cmd("editor:toggle-checklist-status", t.toggleChecklist()),
      ng08Sep(),
      ng08Cmd("editor:attach-file", t.insertAttachment()),
      ng08Sep(),
      {
        label: t.foldingMenu(),
        submenu: [
          ng08Cmd("editor:fold-all", t.foldAll()),
          ng08Cmd("editor:unfold-all", t.unfoldAll()),
          ng08Sep(),
          ng08Cmd("editor:fold-more", t("fold-more")),
          ng08Cmd("editor:fold-less", t("fold-less")),
        ],
      },
    ];

    const formatSubmenu = [
      { id: "heading-indeterminate", label: "Indeterminate heading level", type: "radio", visible: false },
    ];
    for (let level = 1; level <= 6; level++) {
      formatSubmenu.push(
        ng08Cmd(`editor:set-heading-${level}`, t.setHeading({ level }), { type: "radio" })
      );
    }
    formatSubmenu.push(ng08Cmd("editor:set-heading-0", t.noHeading(), { type: "radio" }));
    formatSubmenu.push(ng08Sep());
    for (const [id, label] of [
      ["editor:toggle-bold", t.toggleBold()],
      ["editor:toggle-italics", t.toggleItalics()],
      ["editor:toggle-code", t.toggleCode()],
      ["editor:toggle-highlight", t.toggleHighlight()],
    ]) {
      formatSubmenu.push(ng08Cmd(id, label, { type: "checkbox" }));
    }
    formatSubmenu.push(ng08Sep());
    formatSubmenu.push(
      ng08Cmd("editor:toggle-strikethrough", t.toggleStrikethrough(), { type: "checkbox" }),
      ng08Cmd("editor:toggle-inline-math", t.toggleInlineMath(), { type: "checkbox" }),
      ng08Cmd("editor:toggle-comments", t.toggleComment(), { type: "checkbox" }),
      ng08Sep()
    );

    const viewSubmenu = [
      ng08Cmd("markdown:toggle-preview", t.readingView(), { type: "checkbox" }),
      ng08Cmd("editor:toggle-source", t.sourceMode(), { type: "checkbox" }),
      ng08Sep(),
      ng08Cmd("app:toggle-left-sidebar", t.toggleLeftSidebar(), { type: "checkbox" }),
      ng08Cmd("app:toggle-right-sidebar", t.toggleRightSidebar(), { type: "checkbox" }),
      ng08Sep(),
      ng08Cmd("app:toggle-ribbon", t.toggleRibbon(), { type: "checkbox" }),
      ng08Sep(),
      ng08Cmd("workspace:split-vertical", t.splitRight()),
      ng08Cmd("workspace:split-horizontal", t.splitDown()),
      ng08Sep(),
      ng08Cmd("app:go-back", t.navigateBack(), { before: ["developer-section"] }),
      ng08Cmd("app:go-forward", t.navigateForward(), { before: ["developer-section"] }),
      ng08Sep({ before: ["developer-section"] }),
    ];

    const template = [];
    if (host.Platform.isMacOS) {
      template.push({
        label: "Basalt",
        submenu: [
          { id: "app-settings-item", before: ["preferences-section"], appCommand: "app:open-settings", registerAccelerator: false },
          ng08Sep(),
        ],
      });
    }
    template.push(
      { label: "&File", submenu: fileSubmenu },
      { label: "&Edit", submenu: editSubmenu },
      { label: "&Insert", submenu: insertSubmenu },
      { label: "&Format", submenu: formatSubmenu },
      { label: "&View", submenu: viewSubmenu },
      {
        label: "&Window",
        role: "window",
        submenu: [
          ng08Cmd("workspace:move-to-new-window", t.moveToNewWindow(), { before: ["tab-management"] }),
        ],
      },
      {
        label: "&Help",
        role: "help",
        submenu: [
          ng08Cmd("app:show-release-notes", t.releaseNotes(), { before: ["help-links"] }),
          ng08Cmd("app:show-debug-info", t.showDebugInfo()),
          ng08Cmd("app:open-sandbox-vault", t.openSandbox()),
        ],
      }
    );
    this.applyHotkeys(template);
    this.hideUnregisteredCommands(template);
    return template;
  };

  proto.render = function () {
    const electron = ng08Electron();
    if (!electron || !electron.ipcRenderer) return;
    electron.ipcRenderer.send("set-menu", { template: this.buildMenu() });
  };

  proto.getAcceleratorFromHotkey = function (hotkey) {
    if (!hotkey) return "";
    const parts = [];
    const mods = hotkey.modifiers;
    const hasMod = (m) => (Array.isArray(mods) ? mods.indexOf(m) !== -1 : !!(mods && mods[m]));
    for (const modifier of ng08S04ModifierKeys) {
      if (hasMod(modifier)) parts.push(ng08S04AcceleratorNames[modifier]);
    }
    if (hotkey.key) parts.push(String(hotkey.key).split("Arrow").join(""));
    return parts.join("+");
  };

  proto.applyHotkeys = function (menuItems) {
    const app = this.app;
    for (const item of menuItems) {
      if (item.submenu) this.applyHotkeys(item.submenu);
      if (!item.appCommand) continue;
      const hotkeys = app.hotkeyManager.getHotkeys(item.appCommand);
      const defaults = app.hotkeyManager.getDefaultHotkeys(item.appCommand);
      const hotkey = (hotkeys && hotkeys[0]) || (defaults && defaults[0]) || null;
      item.accelerator = this.getAcceleratorFromHotkey(hotkey);
      item.registerAccelerator = false;
    }
  };

  proto.hideUnregisteredCommands = function (menuItems) {
    for (const item of menuItems) {
      if (item.submenu) this.hideUnregisteredCommands(item.submenu);
      if (item.appCommand && !this.app.commands.findCommand(item.appCommand)) {
        item.visible = false;
      }
    }
  };

  MenuManager.updateMenuItems = function (items, merge) {
    ng08S04UpdateMenuItems(items, merge);
  };

  return MenuManager;
}

/** CM6 view plugin reporting which inline formatting is active at the cursor. */
export function ng08S04FormatMenuPlugin(host) {
  class FormatMenuPlugin {
    constructor(view) {
      this.view = view;
      this.dead = false;
      this.debouncedUpdate = host.debounce(this.rawUpdate.bind(this), 500, true);
    }
    update(update) {
      this.debouncedUpdate(update);
    }
    destroy() {
      this.dead = true;
      if (this.debouncedUpdate && this.debouncedUpdate.cancel) this.debouncedUpdate.cancel();
    }
    rawUpdate(update) {
      if (this.dead) return;
      const state = update.view.state;
      const info = host.cmFormatQuery(state, state.selection.ranges[0]);
      const items = [];
      if (info.uniformHeading) {
        items.push({ itemId: `editor:set-heading-${info.headingLevel}`, eState: { checked: true } });
      } else {
        items.push({ itemId: "heading-indeterminate", eState: { checked: true } });
      }
      items.push(
        { itemId: "editor:toggle-italics", eState: { checked: !!info.italic } },
        { itemId: "editor:toggle-bold", eState: { checked: !!info.bold } },
        { itemId: "editor:toggle-code", eState: { checked: !!info.code } },
        { itemId: "editor:toggle-highlight", eState: { checked: !!info.highlight } },
        { itemId: "editor:toggle-comments", eState: { checked: !!info.comment } },
        { itemId: "editor:toggle-strikethrough", eState: { checked: !!info.strikethrough } }
      );
      ng08S04UpdateMenuItems(items);
    }
  }
  return [host.cmViewPlugin.fromClass(FormatMenuPlugin)];
}
