// Slice s31: the backlinks core plugin, its settings tab, the per-file fold-state store and
// the shared command-callback runner. Bundle-scope names arrive lazily through env().
import { env } from "./env.js";
import { inherit, methods } from "./inherit.js";

const s31BacklinkCache = new Map();
function s31BacklinkCls(key, build) {
  if (!s31BacklinkCache.has(key)) s31BacklinkCache.set(key, build());
  return s31BacklinkCache.get(key);
}

// V6: the built-in "backlink" core plugin (status-bar count, side pane, commands, menus).
function s31BuildBacklinkPlugin() {
  const E = env();
  function BacklinkPlugin() {
    this.id = "backlink";
    this.name = env().gm.plugins.backlinks.name();
    this.description = env().gm.plugins.backlinks.desc();
    this.defaultOn = true;
  }
  methods(BacklinkPlugin, {
    init(app, plugin) {
      const self = this;
      this.app = app;
      this.plugin = plugin;
      plugin.registerStatusBarItem();
      plugin.registerViewType(s31BacklinkViewType, (leaf) => new (env().H6)(leaf));
      plugin.registerGlobalCommand({
        id: "backlink:open",
        name: env().gm.plugins.backlinks.actionShow(),
        icon: "lucide-link",
        callback() {
          self.app.workspace.ensureSideLeaf(s31BacklinkViewType, "right", { active: true });
        },
      });
      plugin.registerGlobalCommand({
        id: "backlink:open-backlinks",
        name: env().gm.plugins.backlinks.actionOpenForCurrent(),
        icon: "lucide-link",
        checkCallback: this.openBacklinksForActiveFile.bind(this),
      });
      plugin.registerGlobalCommand({
        id: "backlink:toggle-backlinks-in-document",
        name: env().gm.plugins.backlinks.actionToggleBacklinksInDocument(),
        icon: "lucide-link",
        checkCallback: this.toggleBacklinksInDocument.bind(this),
      });
    },
    async onEnable(app, plugin) {
      plugin.registerEvent(app.workspace.on("file-open", this.onFileOpen, this));
      plugin.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
      plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
      plugin.registerEvent(app.metadataCache.on("resolved", this.updateBacklinks, this));
      const statusBarEl = this.plugin.statusBarEl;
      if (statusBarEl) {
        statusBarEl.addClass("mod-clickable");
        statusBarEl.addEventListener("click", () => {
          this.app.workspace.ensureSideLeaf(s31BacklinkViewType, "right", { active: true, reveal: true });
        });
      }
      this.options = Object.assign({}, await plugin.loadData());
      this.app.workspace.backlinkInDocument = this.options.backlinkInDocument;
      plugin.addSettingTab(new (s31BacklinkCls("q6", s31BuildBacklinksSettingTab))(app, plugin, this));
    },
    async onExternalSettingsChange() {
      this.options = (await this.plugin.loadData()) || {};
      this.app.workspace.backlinkInDocument = this.options.backlinkInDocument;
    },
    onUserEnable() {
      this.initLeaf();
    },
    onUserDisable(app) {
      app.workspace.detachLeavesOfType(s31BacklinkViewType);
      for (const leaf of app.workspace.getLeavesOfType(s31MarkdownViewType)) {
        const state = leaf.getViewState();
        state.state.backlinks = false;
        leaf.setViewState(state);
      }
      app.workspace.requestSaveLayout();
    },
    initLeaf() {
      this.app.workspace.ensureSideLeaf(s31BacklinkViewType, "right", { reveal: false });
    },
    onFileMenu(menu, file, source, leaf) {
      const self = this;
      if (file instanceof env().$T) {
        if (!env().Yl.isMobile && leaf && source !== "sidebar-context-menu") {
          menu.addItem((item) =>
            item
              .setSection("view.linked")
              .setTitle(env().gm.plugins.backlinks.actionOpen())
              .setIcon("links-coming-in")
              .onClick(async () => {
                await self.app.workspace
                  .splitLeafOrActive(leaf, "horizontal")
                  .setViewState({
                    type: s31BacklinkViewType,
                    active: true,
                    group: leaf,
                    state: { file: file.path },
                  });
              })
          );
        }
        if (leaf && leaf.view instanceof env().W6 && leaf.view.canToggleBacklinks()) {
          menu.addItem((item) =>
            item
              .setSection("pane")
              .setTitle(env().gm.plugins.backlinks.menuOptBacklinksInDocument())
              .setChecked(!!(leaf.view.getState().backlinks))
              .setIcon("links-coming-in")
              .onClick(() => {
                const view = leaf.view;
                if (view instanceof env().W6) view.toggleBacklinks();
              })
          );
        }
      }
    },
    onFileOpen(file) {
      this.file = file instanceof env().$T ? file : null;
      this.updateBacklinks();
    },
    updateBacklinks() {
      const file = this.file;
      const statusBarEl = this.plugin.statusBarEl;
      if (!statusBarEl) return;
      if (!file) {
        statusBarEl.setText("");
        statusBarEl.hide();
        return;
      }
      let count = 0;
      const path = file.path;
      const resolvedLinks = this.app.metadataCache.resolvedLinks;
      for (const source in resolvedLinks) {
        if (source !== path && resolvedLinks.hasOwnProperty(source) && resolvedLinks[source].hasOwnProperty(path)) {
          count += resolvedLinks[source][path];
        }
      }
      const text = env().gm.nouns.backlinkWithCount({ count });
      statusBarEl.setText(text);
      statusBarEl.show();
    },
    openBacklinksForActiveFile(byPassCheck) {
      if (env().Yl.isPhone) return false;
      const workspace = this.app.workspace;
      const file = workspace.getActiveFile();
      if (file) {
        if (!byPassCheck) {
          workspace.splitActiveLeaf("vertical").setViewState({
            type: s31BacklinkViewType,
            active: true,
            group: workspace.activeLeaf,
            state: { file: file.path },
          });
        }
        return true;
      }
      return undefined;
    },
    toggleBacklinksInDocument(byPassCheck) {
      const view = this.app.workspace.getActiveViewOfType(env().W6);
      if (view && view.canToggleBacklinks()) {
        if (!byPassCheck) view.toggleBacklinks();
        return true;
      }
      return undefined;
    },
  });
  return BacklinkPlugin;
}
export function s31BacklinkPlugin(host) {
  return s31BacklinkCls("V6", s31BuildBacklinkPlugin);
}

// q6: the backlinks plugin's setting tab (single "show in document" toggle).
function s31BuildBacklinksSettingTab() {
  const E = env();
  function BacklinksSettingTab(app, plugin, instance) {
    const self = E.Y0.call(this, app, plugin) || this;
    self.icon = "links-coming-in";
    self.instance = instance;
    return self;
  }
  inherit(BacklinksSettingTab, E.Y0);
  methods(BacklinksSettingTab, {
    display() {
      const self = this;
      const containerEl = this.containerEl;
      containerEl.empty();
      const options = this.instance.options;
      new (env().qk)(containerEl).addSetting((setting) =>
        setting
          .setName(env().gm.plugins.backlinks.optionBacklinkInDocument())
          .setDesc(env().gm.plugins.backlinks.optionBacklinkInDocumentDesc())
          .addToggle((toggle) =>
            toggle
              .setValue(options.backlinkInDocument)
              .onChange((value) => {
                options.backlinkInDocument = value;
                self.app.workspace.backlinkInDocument = value;
                self.plugin.saveData(options);
              })
          )
      );
    },
  });
  return BacklinksSettingTab;
}
export function s31BacklinksSettingTab(host) {
  return s31BacklinkCls("q6", s31BuildBacklinksSettingTab);
}

// Q6: per-file fold state persisted through the app's localStorage helpers.
function s31BuildNoteFoldStore() {
  function NoteFoldStore(app) {
    this.app = app;
  }
  methods(NoteFoldStore, {
    cleanup() {
      const app = this.app;
      const prefix = app.appId + "-note-fold-";
      for (const key in localStorage) {
        if (key.startsWith(prefix)) {
          const path = key.substr(prefix.length);
          if (!app.vault.getAbstractFileByPath(path)) localStorage.removeItem(key);
        }
      }
    },
    loadPath(path) {
      return this.app.loadLocalStorage("note-fold-" + path);
    },
    load(file) {
      return file ? this.loadPath(file.path) : null;
    },
    savePath(path, data) {
      if (data && data.folds.length === 0) data = null;
      return this.app.saveLocalStorage("note-fold-" + path, data);
    },
    save(file, data) {
      if (file) this.savePath(file.path, data);
    },
  });
  return NoteFoldStore;
}
export function s31NoteFoldStore(host) {
  return s31BacklinkCls("Q6", s31BuildNoteFoldStore);
}

// K6: runs a command's callback (or checkCallback in "check only" mode).
export function s31CommandCallback(command) {
  if (command.checkCallback) command.checkCallback(false);
  else if (command.callback) command.callback();
  else console.error("Command ".concat(command, " did not provide a callback"));
}

// View type string constants shared with the rest of the bundle.
export const s31BacklinkViewType = "backlink";
export const s31MarkdownViewType = "markdown";
