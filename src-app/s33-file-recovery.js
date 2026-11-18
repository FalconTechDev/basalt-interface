// File recovery plugin (O8), its IndexedDB-backed history modal (R8) and settings tab (F8).
//
// Backups live in an IndexedDB "backups" store (auto-increment key, "path" and "ts"
// indexes) reached through the bundle's promise wrapper `Zw`. The plugin snapshots
// markdown/canvas/base files at most once per configured interval and exposes history
// through the modal and four CLI handlers.
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { parentPath, extensionOf, withoutMd } from "./path.js";
import { formatBytes } from "./text.js";
import { copyTextToClipboard } from "./n-g11-view.js";
import { s10RenderDiffView } from "./s10-app.js";
import { s33FileRecoveryStrings, s33InterfaceStrings, s33SyncStrings } from "./s33-canvas-edge.js";

const recoveryStrings = s33FileRecoveryStrings;
const interfaceStrings = s33InterfaceStrings;
const syncStrings = s33SyncStrings;

// ---- history modal (R8) ---------------------------------------------------------------------

/** Sidebar modal listing backup versions of one file with diff/restore/copy actions. */
export function defineS33RecoveryHistoryModal(host) {
  function HistoryModal(app, plugin) {
    const self = host.Modal.call(this, app) || this;
    self.plugin = null;
    self.currentVersion = null;
    self.activeVersionEl = null;
    self.historyListContainerEl = null;
    self.historyListEl = null;
    self.versionListEl = null;
    self.fileContentEl = null;
    self.diffToggle = null;
    self.backButtonEl = null;
    self.textareaEl = null;
    self.diffEl = null;
    self.plugin = plugin;
    self.setTitle(recoveryStrings().name());
    self.modalEl.addClass("mod-sync-history", "mod-sidebar-layout");
    self.historyListContainerEl = self.contentEl.createDiv("file-recovery-list-container");
    const listEl = (self.historyListEl = self.historyListContainerEl.createDiv("modal-sidebar file-recovery-list"));
    new host.Setting(listEl).setNoInfo().addSearch((search) => {
      self.searchComponent = search;
      search.setPlaceholder(recoveryStrings().placeholderChooseFile());
    });
    self.versionListEl = listEl.createDiv("file-recovery-list-item-container");
    const contentEl = (self.fileContentEl = self.contentEl.createDiv("sync-history-content-container mod-empty"));
    contentEl.createEl("p", { cls: "sync-history-content-empty", text: recoveryStrings().labelSelectFile() });
    const inner = contentEl.createDiv("sync-history-content");
    inner.createDiv("modal-setting-titlebar", (titlebar) => {
      self.titleEl = titlebar.createDiv("modal-setting-title");
      titlebar.createDiv("modal-setting-titlebar-actions", (actions) => {
        actions.createSpan({ text: syncStrings().labelShowDiff(), cls: "modal-setting-titlebar-toggle" }, (span) => {
          self.diffToggle = new host.ToggleComponent(span).setSmall().setValue(false);
        });
        new host.ButtonComponent(actions).setButtonText(interfaceStrings().labelCopyShort()).onClick(() => {
          copyTextToClipboard(self.currentVersion.data);
          new host.Notice(interfaceStrings().copied({ context: "generic" }));
        });
        new host.ButtonComponent(actions).setButtonText(syncStrings().labelRestoreThisVersion()).onClick(async () => {
          const version = self.currentVersion;
          const data = version.data;
          const path = version.path;
          const ts = version.ts;
          const dir = parentPath(path);
          let needsFolder = false;
          if (dir) needsFolder = !(await self.app.vault.exists(dir));
          if (needsFolder) await self.app.vault.createFolder(dir);
          const when = window.moment(ts).fromNow();
          await self.app.vault.adapter.write(path, data);
          await self.plugin.forceAdd(path, data);
          new host.Notice(syncStrings().msgRestoredVersion({ time: when }));
          self.switchToPath(path);
        });
      });
    });
    self.textareaEl = inner.createEl("textarea", { cls: "file-recovery-text", attr: { spellcheck: false } });
    self.diffEl = inner.createDiv("file-recovery-diff");
    if (host.Platform.isPhone) {
      contentEl.detach();
      self.backButtonEl = createDiv({ cls: "modal-setting-back-button" }, (button) => {
        button.createSpan("modal-setting-back-button-icon", (icon) => {
          host.setIcon(icon, "lucide-arrow-left");
        });
        button.addEventListener("click", () => {
          env().Dl(self.contentEl, self.historyListContainerEl, "left", () => {
            self.backButtonEl?.detach();
            self.activeVersionEl?.removeClass("is-active");
            self.activeVersionEl = null;
          });
          env().lg(self.historyListContainerEl);
        });
      });
    }
    return self;
  }
  inherit(HistoryModal, host.Modal);
  const proto = HistoryModal.prototype;

  proto.switchToPath = async function (path) {
    const versionListEl = this.versionListEl;
    const fileContentEl = this.fileContentEl;
    const titleEl = this.titleEl;
    const searchInput = this.searchComponent.inputEl;
    versionListEl.empty();
    searchInput.value = withoutMd(path);
    searchInput.blur();
    titleEl.setText(withoutMd(path));
    const db = this.plugin.db;
    const tx = db.transaction("backups", "readonly");
    const versions = await tx.store.index("path").getAll(path);
    versions.sort((a, b) => b.ts - a.ts);
    this.activeVersionEl = null;
    const self = this;
    const renderVersion = (index) => {
      const version = versions[index];
      const previous = versions[index + 1];
      const header = versionListEl.createDiv("file-recovery-list-item-header");
      const details = header.createDiv({ cls: "file-recovery-list-item-details", text: window.moment(version.ts).format("llll") });
      details.createDiv("u-small u-muted").setText(formatBytes(version.data.length));
      const activate = () => {
        if (self.activeVersionEl) self.activeVersionEl.removeClass("is-active");
        self.activeVersionEl = header;
        self.activeVersionEl.addClass("is-active");
        fileContentEl.removeClass("mod-empty");
        self.currentVersion = version;
        self.openHistory(version, previous);
      };
      details.addEventListener("click", activate);
      if (self.activeVersionEl === null && host.Platform.hasPhysicalKeyboard) activate();
    };
    for (let i = 0; i < versions.length; i++) renderVersion(i);
  };

  proto.openHistory = function (version, previous) {
    const textareaEl = this.textareaEl;
    const diffEl = this.diffEl;
    const diffToggle = this.diffToggle;
    const data = version.data;
    textareaEl.value = data;
    textareaEl.setAttr("data-ext", extensionOf(version.path));
    diffEl.empty();
    let rendered = false;
    const apply = () => {
      const showDiff = diffToggle.getValue();
      textareaEl.toggle(!showDiff);
      diffEl.toggle(showDiff);
      if (showDiff && !rendered) {
        rendered = true;
        let oldData = "";
        if (previous) oldData = previous.data;
        diffEl.empty();
        diffEl.appendChild(s10RenderDiffView(oldData, data, host));
      }
    };
    diffToggle.onChange(apply);
    apply();
    if (host.Platform.isPhone) {
      env().ag(this.historyListContainerEl);
      env().Dl(this.contentEl, this.fileContentEl, "right");
      this.titleEl.prepend(this.backButtonEl);
    } else if (!this.fileContentEl.parentNode) {
      this.contentEl.appendChild(this.fileContentEl);
    }
  };

  proto.onOpen = async function () {
    const contentEl = this.contentEl;
    await env().Uv(contentEl, async () => {
      const db = this.plugin.db;
      const tx = db.transaction("backups", "readonly");
      const cursor = await tx.store.index("path").openCursor(null, "nextunique");
      const paths = [];
      let current = cursor;
      while (current) {
        paths.push(current.value.path);
        current = await current.continue();
      }
      paths.sort(host.compareStrings);
      if (paths.length === 0) {
        this.titleEl.setText(recoveryStrings().name());
        contentEl.createEl("p", { text: recoveryStrings().labelNoHistoryFound() });
        return;
      }
      const input = this.searchComponent.inputEl;
      const suggest = new (env().N8)(this.app, input, paths, this);
      setTimeout(() => {
        if (!input.value) {
          input.focus({ preventScroll: true });
          suggest.onInputChange();
        }
      });
    });
  };

  return HistoryModal;
}

// ---- settings tab (F8) -----------------------------------------------------------------------

/** File-recovery settings: backup interval, retention, open-history and clear actions. */
export function defineS33RecoverySettingsTab(host) {
  function RecoverySettingsTab(app, plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, app, plugin) || this;
    self.icon = "history";
    self.instance = instance;
    return self;
  }
  inherit(RecoverySettingsTab, host.PluginInstanceSettingTab);
  const proto = RecoverySettingsTab.prototype;

  proto.display = function () {
    const self = this;
    const containerEl = this.containerEl;
    containerEl.empty();
    const group = new host.SettingGroup(containerEl);
    const t = recoveryStrings();
    if (host.Platform.supportsIndexedDb) {
      const options = this.instance.options;
      group
        .addSetting((setting) =>
          setting.setName(t.optionInterval()).setDesc(t.optionIntervalDescription()).addText((text) =>
            text.setValue(String(options.intervalMinutes)).onChange((value) => {
              const minutes = parseFloat(value);
              if (!isNaN(minutes) && minutes >= 0) {
                options.intervalMinutes = minutes;
                self.plugin.saveData(options);
              }
            }),
          ),
        )
        .addSetting((setting) =>
          setting.setName(t.optionKeep()).setDesc(t.optionKeepDescription()).addText((text) =>
            text.setValue(String(options.keepDays)).onChange((value) => {
              const days = parseFloat(value);
              if (!isNaN(days) && days >= 1) {
                options.keepDays = days;
                self.plugin.saveData(options);
              }
            }),
          ),
        )
        .addSetting((setting) =>
          setting.setName(t.optionOpenHistory()).setDesc(t.optionOpenHistoryDescription()).addButton((button) =>
            button.setButtonText(t.buttonViewHistory()).setCta().onClick(() => self.instance.openModal()),
          ),
        )
        .addSetting((setting) =>
          setting.setName(t.optionClear()).setDesc(t.optionClearDescription()).addButton((button) =>
            button.setButtonText(t.buttonClearHistory()).setWarning().onClick(() => {
              new host.ButtonModal(self.app)
                .setTitle(t.optionClear())
                .setContent(createFragment((frag) => {
                  frag.createEl("p", { cls: "mod-warning", text: t.labelClearWarning() });
                }))
                .addButton("mod-warning", t.buttonClearHistory(), () => {
                  self.instance.clearData();
                  new host.Notice(t.msgClearComplete());
                })
                .addCancelButton()
                .open();
            }),
          ),
        );
    } else {
      group.addSetting((setting) =>
        setting.setName(env().gm.interface.msgIndexedDbNotSupported()).setDesc(env().gm.interface.msgIndexedDbIOS()),
      );
    }
  };

  return RecoverySettingsTab;
}

// ---- plugin (O8) -------------------------------------------------------------------------------

/** Internal plugin: periodic IndexedDB snapshots of markdown/canvas/base files. */
export function defineS33FileRecoveryPlugin(host) {
  const t = () => recoveryStrings();

  function FileRecoveryPlugin() {
    this.id = "file-recovery";
    this.name = t().name();
    this.description = t().desc();
    this.defaultOn = true;
    this.app = null;
    this.pluginInstance = null;
    this.db = null;
    this.tsCache = {};
    this.pendingFiles = new Set();
  }
  const proto = FileRecoveryPlugin.prototype;

  proto.init = function (app, plugin) {
    const self = this;
    this.app = app;
    this.pluginInstance = plugin;
    plugin.registerGlobalCommand({
      id: "file-recovery:open",
      name: t().actionOpen(),
      icon: "lucide-rotate-ccw",
      callback: () => {
        const file = self.app.workspace.getActiveFile();
        let path = "";
        if (file && file.extension === "md") path = file.path;
        self.openModal(path);
      },
    });
  };

  proto.onEnable = async function (app, plugin) {
    const self = this;
    this.options = Object.assign({}, env().L8, await plugin.loadData());
    plugin.addSettingTab(new (env().F8)(app, plugin, this));
    if (!host.Platform.supportsIndexedDb) return;
    plugin.registerEvent(app.vault.on("modify", this.onFileChanged, this));
    plugin.registerEvent(app.workspace.on("file-open", this.onFileChanged, this));
    plugin.registerInterval(window.setInterval(this.resave.bind(this), 60000));
    plugin.registerInterval(window.setInterval(this.cleanup.bind(this), 3600000));
    app.workspace.onLayoutReady(() => {
      plugin.registerEvent(app.vault.on("create", self.onFileChanged, self));
    });
    try {
      this.db = await env().Zw(this.app.appId + "-backup", 1, {
        upgrade: (db) => {
          if (db.objectStoreNames.contains("backups")) db.deleteObjectStore("backups");
          const store = db.createObjectStore("backups", { autoIncrement: true });
          store.createIndex("path", "path");
          store.createIndex("ts", "ts");
        },
      });
      window.setTimeout(this.cleanup.bind(this), 60000);
    } catch (e) {
      console.error("File Recovery failed to connect to IndexedDB");
    }
    const getHistory = (path) =>
      (async () => {
        if (!this.db) return [];
        const tx = this.db.transaction("backups", "readonly");
        const versions = await tx.store.index("path").getAll(path);
        versions.sort((a, b) => b.ts - a.ts);
        return versions;
      })();
    plugin.registerCliHandler("history", "List file history versions", {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
    }, async (args) => {
      if (!this.db) throw "File recovery database not available.";
      const file = app.cli.tryResolveFile(args);
      const versions = await getHistory(file.path);
      if (versions.length === 0) return "No history found for this file.";
      const lines = versions.map((v, i) => `${i + 1}\t${window.moment(v.ts).format("YYYY-MM-DD HH:mm")}\t${formatBytes(v.data.length)}`);
      return `${file.path}\n${lines.join("\n")}`;
    });
    plugin.registerCliHandler("history:list", "List files with history", null, async () => {
      if (!this.db) throw "File recovery database not available.";
      const tx = this.db.transaction("backups", "readonly");
      let cursor = await tx.store.index("path").openCursor(null, "nextunique");
      const paths = [];
      while (cursor) {
        paths.push(cursor.value.path);
        cursor = await cursor.continue();
      }
      if (paths.length === 0) return "No file history found.";
      paths.sort(host.compareStrings);
      return paths.join("\n");
    });
    plugin.registerCliHandler("history:read", "Read a file history version", {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      version: { value: "<n>", description: "Version number (default: 1)" },
    }, async (args) => {
      if (!this.db) throw "File recovery database not available.";
      const file = app.cli.tryResolveFile(args);
      const versions = await getHistory(file.path);
      if (versions.length === 0) return "No history found for this file.";
      const index = args.version ? parseInt(args.version, 10) : 1;
      if (index < 1 || index > versions.length) throw `Invalid version number. Available: 1-${versions.length}`;
      const version = versions[index - 1];
      const when = window.moment(version.ts).format("YYYY-MM-DD HH:mm");
      return `${file.path} (version ${index}, ${when})\n---\n${version.data}`;
    });
    plugin.registerCliHandler("history:restore", "Restore a file history version", {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      version: { value: "<n>", description: "Version number", required: true },
    }, async (args) => {
      if (!this.db) throw "File recovery database not available.";
      const file = app.cli.tryResolveFile(args);
      const versions = await getHistory(file.path);
      if (versions.length === 0) return "No history found for this file.";
      if (!args.version) return "Missing required parameter: version\nUsage: history:restore file=<name> version=<n>";
      const index = parseInt(args.version, 10);
      if (index < 1 || index > versions.length) throw `Invalid version number. Available: 1-${versions.length}`;
      const version = versions[index - 1];
      await app.vault.adapter.write(file.path, version.data);
      await this.forceAdd(file.path, version.data);
      const when = window.moment(version.ts).format("YYYY-MM-DD HH:mm");
      return `Restored: ${file.path} to version ${index} (${when})`;
    });
    plugin.registerCliHandler("history:open", "Open file recovery", {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
    }, (args) => {
      let path = "";
      if (args.path) path = args.path;
      else if (args.file) {
        const resolved = app.metadataCache.getFirstLinkpathDest(args.file, "");
        if (resolved) path = resolved.path;
      } else {
        const active = app.workspace.getActiveFile();
        if (active) path = active.path;
      }
      self.openModal(path);
      return path ? "Opened history for: " + path : "Opened file recovery";
    });
  };

  proto.onDisable = function () {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  };

  proto.onExternalSettingsChange = async function () {
    this.options = (await this.pluginInstance.loadData()) || {};
  };

  proto.onFileChanged = async function (file) {
    if (!(file instanceof host.TFile)) return;
    if (!(file.extension === "md" || file.extension === "canvas" || file.extension === "base")) return;
    const db = this.db;
    const tsCache = this.tsCache;
    if (!db) return;
    const path = file.path;
    let lastTs = tsCache[path];
    let lastVersion = null;
    if (!tsCache.hasOwnProperty(path)) {
      lastVersion = await this.getLastVersionByPath(path);
      lastTs = lastVersion ? lastVersion.ts : 0;
      tsCache[path] = lastTs;
    }
    const now = Date.now();
    const elapsed = now - lastTs;
    let interval = this.options.intervalMinutes;
    if (isNaN(interval) || interval < 0) interval = 5;
    if (elapsed < 60 * interval * 1000) {
      this.pendingFiles.add(path);
      return;
    }
    const data = await this.app.vault.cachedRead(file);
    if (!lastVersion) lastVersion = await this.getLastVersionByPath(path);
    if (lastVersion && lastVersion.data === data) return;
    await db.add("backups", { path, ts: now, data });
    tsCache[path] = now;
  };

  proto.forceAdd = async function (path, data) {
    const db = this.db;
    const tsCache = this.tsCache;
    if (!db) return;
    const now = Date.now();
    await db.add("backups", { path, ts: now, data });
    tsCache[path] = now;
  };

  proto.resave = async function () {
    const pending = this.pendingFiles;
    const paths = Array.from(pending);
    const vault = this.app.vault;
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      pending.delete(path);
      await this.onFileChanged(vault.getAbstractFileByPath(path));
    }
  };

  proto.cleanup = async function () {
    const db = this.db;
    if (!db) return;
    const tx = db.transaction("backups", "readwrite", { durability: "relaxed" });
    const index = tx.store.index("ts");
    let keepDays = this.options.keepDays;
    if (isNaN(keepDays) || keepDays < 1) keepDays = 7;
    let cursor = await index.openCursor(IDBKeyRange.upperBound(Date.now() - 24 * keepDays * 60 * 60 * 1000));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  };

  proto.openModal = function (path) {
    const modal = new (env().R8)(this.app, this);
    modal.open();
    if (path) modal.switchToPath(path);
  };

  proto.clearData = function () {
    this.db.clear("backups");
    this.tsCache = {};
  };

  proto.getLastVersionByPath = async function (path) {
    const tx = this.db.transaction("backups", "readonly");
    const cursor = await tx.store.index("path").openCursor(path, "prev");
    return cursor ? cursor.value : null;
  };

  return FileRecoveryPlugin;
}
