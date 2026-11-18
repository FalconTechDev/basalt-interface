// g03 clean-room: Basalt Sync core plugin (remote-vault sync engine).
// Independent reimplementation of the "sync" core plugin per specs/g03.md.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { extensionOf, baseName, withoutExtension, parentPath, normalizePath } from "./path.js";
import { s05IsValidFileName } from "./s05-utils.js";
import { s10MergeText } from "./s10-app.js";
import { s04SettlePromise } from "./s04-themes.js";
import { contentHash } from "./metadata-helpers.js";
import { formatBytes } from "./text.js";
import { account, AccountError, acctRequest, acctUserInfo, acctListVaults, acctListSubscriptions, acctVaultRegions, acctCreateVault, acctMigrateVault, acctRenameVault, acctDeleteVault, acctListVaultShares, acctInviteVaultShare, acctRemoveVaultShare, acctSignOut, acctSignIn, acctSignup, acctSignupMobileSync, acctResendConfirmation, acctForgetPassword } from "./account.js";
import { deriveScryptKey, deriveVaultKeyhash, randomSaltHex, initCipher, utf8Bytes, utf8String, encodeBase64, decodeBase64 } from "./vault-crypto.js";
import { ng03DefineSyncSettingsView, ng03DefineSyncFileHistoryModal, ng03DefineSyncDeletedFilesModal, ng03DefineSyncLogModal, ng03DefineSyncRemoteVaultsModal, ng03DefineSyncFileHistoryView, ng03DefineSyncChangesView, ng03DefineSyncConnectVaultModal } from "./n-g03-sync-ui.js";

const SYNC_DATA_VER = 2;
const SYNC_LOG_LIMIT = () => (env().lee || 10000);
const SYNC_HOUR = 3600000;

function ng03SyncI18n() { return env().gm.plugins.sync; }
function ng03InterfaceI18n() { return env().gm.interface; }

function ng03HasExt(set, ext) {
  if (!set) return false;
  if (typeof set.contains === "function") return set.contains(ext);
  if (typeof set.includes === "function") return set.includes(ext);
  if (typeof set.has === "function") return set.has(ext);
  return false;
}

function ng03DefaultTypes() { return new Set(["image", "pdf", "video"]); }
function ng03DefaultSpecials() {
  return new Set(["app", "appearance", "appearance-data", "hotkey", "core-plugin", "core-plugin-data"]);
}

function ng03DefaultDeviceName(host) {
  return (host.Platform && host.Platform.deviceName) || "Unknown";
}

function ng03SanitizeTag(name, fallback) {
  let tag = String(name || "").replace(new RegExp(env().UT || /[\\/:*?"<>|]/g), "_").replace(/_+/g, "_");
  if (!tag || tag === "_") tag = fallback || "device";
  return tag;
}

function ng03ConflictName(name, tag, time) {
  const ext = extensionOf(name);
  const base = ext ? withoutExtension(name) : name;
  const stamp = time || "";
  return base + " (Conflicted copy " + tag + stamp + ")" + (ext ? "." + ext : "");
}

function ng03Pad2(n) { return String(n).padStart(2, "0"); }
function ng03Stamp(d) {
  return d.getFullYear() + ng03Pad2(d.getMonth() + 1) + ng03Pad2(d.getDate()) +
    ng03Pad2(d.getHours()) + ng03Pad2(d.getMinutes());
}
function ng03FmtTs(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + ng03Pad2(d.getMonth() + 1) + "-" + ng03Pad2(d.getDate()) +
    " " + ng03Pad2(d.getHours()) + ":" + ng03Pad2(d.getMinutes()) + ":" + ng03Pad2(d.getSeconds());
}

function ng03IsDotPath(path) {
  return path.split("/")[0].charAt(0) === ".";
}

/** hee/SyncSocket-backed sync engine: state, persistence, filtering, log, sync cycle, CLI, menus. */
export function ng03SyncPlugin(host) {
  function SyncPlugin() {
    host.Events.call(this);
    const ti = ng03SyncI18n();
    this.id = "sync";
    this.name = ti && ti.name ? ti.name() : "Sync";
    this.description = ti && ti.desc ? ti.desc() : "";
    this.defaultOn = true;

    // persisted / identity state
    this.vaultId = null;
    this.vaultName = null;
    this.key = null;
    this.salt = "";
    this.host = "";
    this.deviceName = "";
    this.encryptionVersion = -1;
    this.userId = -1;
    this.pause = false;
    this.version = 0;
    this.initial = true;
    this.preventSleep = false;
    this.conflictAction = "merge";
    this.allowTypes = ng03DefaultTypes();
    this.allowSpecialFiles = ng03DefaultSpecials();
    this.ignoreFolders = [];

    // runtime state
    this.app = null;
    this.plugin = null;
    this.settingTab = null;
    this.initialized = false;
    this.dataLoaded = false;
    this.dirty = false;
    this.error = false;
    this.syncing = false;
    this.syncingPath = null;
    this.syncStatus = "Uninitialized";
    this.localFiles = {};
    this.serverFiles = {};
    this.newServerFiles = [];
    this.fileRetry = {};
    this.filterCache = {};
    this.skippedFiles = {};
    this.scanSpecialFiles = false;
    this.scanSpecialFileQueue = [];
    this.encryptionProvider = null;
    this.server = null;
    this.gettingServer = null;
    this.ready = false;
    this.syncLog = [];
    this.dbPromise = null;
    this.userMap = {};
    this.userMapLoaded = false;
    this._saveTimer = null;
    this._statusTimer = null;
    this._syncTimer = null;
    this._keepAwake = null;
    this.backoff = new (env().Z9 || function () {
      return { isReady: () => true, success: () => {}, fail: () => {} };
    })();
    this.db = {
      get: async (key, store) => {
        const database = await this._openDb();
        const tx = database.transaction(store || "data", "readonly");
        return tx.objectStore(store || "data").get(key);
      },
      put: async (key, value, store) => {
        const database = await this._openDb();
        const tx = database.transaction(store || "data", "readwrite");
        await tx.objectStore(store || "data").put(value, key);
      },
      delete: async (key, store) => {
        const database = await this._openDb();
        const tx = database.transaction(store || "data", "readwrite");
        await tx.objectStore(store || "data").delete(key);
      },
    };
  }
  inherit(SyncPlugin, host.Events);
  const proto = SyncPlugin.prototype;

  // ---- IndexedDB -----------------------------------------------------------

  proto._openDb = async function () {
    if (!this.dbPromise) {
      this.dbPromise = host.openMetadataDb(this.app.appId + "-sync", 1, {
        upgrade: (database) => {
          if (!database.objectStoreNames.contains("data")) database.createObjectStore("data");
        },
      });
    }
    return this.dbPromise;
  };

  // ---- logging --------------------------------------------------------------

  proto.log = function (info, file, isError, type) {
    this.logTags(info, file || "", !!isError, type || "");
  };

  proto.logMerge = function (info, file, isError) {
    this.logTags(info, file || "", !!isError, "merge");
  };

  proto.logSkip = function (info, file) {
    const skipKey = file + "|" + info;
    if (this.skippedFiles[skipKey]) return;
    this.skippedFiles[skipKey] = true;
    this.logTags(info, file || "", true, "skip");
  };

  proto.logTags = function (info, file, isError, type) {
    const last = this.syncLog[this.syncLog.length - 1];
    if (info === "Fully synced" && last && last.info === "Fully synced" && !last.file) return;
    this.syncLog.push({ file, info, ts: Date.now(), error: isError, type: type || "" });
    const limit = SYNC_LOG_LIMIT();
    if (this.syncLog.length > limit + 100) this.syncLog.splice(0, this.syncLog.length - limit);
    this.trigger("new-log");
  };

  // ---- status ----------------------------------------------------------------

  proto.setStatus = function (status) {
    this.syncStatus = status;
    this.trigger("status-change");
    this._updateStatusBar();
  };

  proto.getStatus = function () {
    if (!this.initialized) return "uninitialized";
    if (!this.vaultId) return "disconnected";
    if (this.error || Object.keys(this.fileRetry).length > 0) return "error";
    if (this.pause) return "paused";
    if (this.syncing) return "syncing";
    return "synced";
  };

  proto.setPause = function (pause) {
    this.pause = !!pause;
    if (!this.pause) this.requestSync();
    this._updateStatusBar();
  };

  proto.getPause = function () { return this.pause; };

  proto._updateStatusBar = function () {
    {
      const status = this.getStatus();
      const cls = status === "synced" ? "mod-success"
        : status === "syncing" ? "mod-spin"
        : status === "error" || status === "disconnected" ? "mod-error"
        : "mod-working";
      const icon = this.statusIconEl;
      if (icon) {
        icon.removeClass("mod-working", "mod-spin", "mod-success", "mod-error");
        icon.addClass(cls);
      }
      if (this.statusBarSegmentEl) {
        this.statusBarSegmentEl.setText(this.syncStatus);
        this.statusBarSegmentEl.removeClass("mod-working", "mod-spin", "mod-success", "mod-error");
        this.statusBarSegmentEl.addClass(cls);
      }
    }
  };

  // ---- persistence ------------------------------------------------------------

  proto.saveData = async function () {
    if (!this.dirty || !this.app) return;
    this.dirty = false;
    const record = {
      appId: this.app.appId,
      vaultId: this.vaultId,
      vaultName: this.vaultName,
      key: this.key ? encodeBase64(this.key) : "",
      salt: this.salt,
      encryptionVersion: this.encryptionVersion,
      host: this.host,
      deviceName: this.deviceName,
      userId: this.userId,
      pause: this.pause,
      version: this.version,
      initial: this.initial,
      local: this.localFiles,
      remote: this.serverFiles,
      pending: this.newServerFiles,
      allowTypes: [...this.allowTypes],
      allowSpecialFiles: [...this.allowSpecialFiles],
      ignoreFolders: this.ignoreFolders,
      preventSleep: this.preventSleep,
      conflictAction: this.conflictAction,
      dataVer: SYNC_DATA_VER,
    };
    try {
      await this.db.put("data", record, "data");
    } catch (error) {
      console.error("Failed to save sync data", error);
    }
  };

  proto.requestSaveData = function () {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveData();
    }, 2000);
  };

  proto.forceSaveData = function () {
    this.dirty = true;
    this.requestSaveData();
  };

  proto.loadData = async function () {
    this.fileRetry = {};
    this.filterCache = {};
    this.skippedFiles = {};
    this.scanSpecialFileQueue = [];
    let record = null;
    try {
      record = await this.db.get("data", "data");
    } catch (error) {
      console.error("Failed to load sync data", error);
    }
    if (record && typeof record === "object") {
      const foreign = record.appId && record.appId !== this.app.appId;
      this.vaultId = record.vaultId != null ? record.vaultId : null;
      this.vaultName = record.vaultName != null ? record.vaultName : null;
      this.host = record.host || "";
      this.deviceName = record.deviceName || "";
      this.userId = record.userId != null ? record.userId : -1;
      this.salt = record.salt || "";
      this.encryptionVersion = record.encryptionVersion != null ? record.encryptionVersion : 0;
      this.key = record.key ? decodeBase64(record.key) : null;
      this.allowTypes = record.allowTypes ? new Set(record.allowTypes) : ng03DefaultTypes();
      this.allowSpecialFiles = record.allowSpecialFiles ? new Set(record.allowSpecialFiles) : ng03DefaultSpecials();
      this.ignoreFolders = record.ignoreFolders ? record.ignoreFolders.slice() : [];
      this.preventSleep = !!record.preventSleep;
      this.conflictAction = record.conflictAction === "conflict" ? "conflict" : "merge";
      if (foreign) {
        // foreign app data: keep credentials/settings and the local scan
        // state, wipe the remote side, force pause
        this.pause = true;
        this.version = 0;
        this.initial = true;
        this.localFiles = record.local || {};
        this.serverFiles = {};
        this.newServerFiles = [];
      } else {
        this.pause = !!record.pause;
        this.version = record.version || 0;
        this.initial = record.initial === undefined ? true : !!record.initial;
        this.localFiles = record.local || {};
        this.serverFiles = record.remote || {};
        this.newServerFiles = record.pending || [];
        // dataVer migration quirk: the migration reads the nonexistent
        // `localFiles` member of the remote map and throws, skipping itself.
        const dataVer = record.dataVer || 0;
        if (dataVer < 2) {
          try {
            for (const path in this.serverFiles) {
              if (path.endsWith(".canvas") || path.endsWith(".base")) {
                const local = this.serverFiles.localFiles[path];
                if (local) this.newServerFiles.push(local);
              }
            }
          } catch (error) {
            // preserved quirk: migration always throws and is skipped
          }
        }
      }
    }
    this.dirty = false;
    await this.scanFiles();
    // empty vault on first sync: refuse to wipe the remote side
    const vault = this.app.vault;
    if (this.vaultId && this.initial && vault.root && (!vault.root.children || vault.root.children.length === 0)) {
      this.pause = true;
      this.setStatus("Error");
      this.log("Vault is empty. Resuming sync could delete all files on the remote vault. See https://github.com/FalconTechDev/basalt for details.", "", true);
    }
    this.scanSpecialFiles = true;
    this.dataLoaded = true;
  };

  // ---- file tracking -----------------------------------------------------------

  proto._localRecord = function (path) {
    let rec = this.localFiles[path];
    if (!rec) {
      rec = this.localFiles[path] = {
        path, previouspath: "", folder: false,
        ctime: 0, mtime: 0, size: 0, hash: "", synctime: 0, synchash: "",
      };
    }
    return rec;
  };

  proto._refreshLocalRecord = function (rec, file) {
    if (file instanceof host.TFolder) {
      rec.folder = true;
      rec.ctime = 0; rec.mtime = 0; rec.size = 0; rec.hash = "";
      return;
    }
    rec.folder = false;
    const stat = file.stat || {};
    const oldM = rec.mtime, oldS = rec.size;
    rec.mtime = Math.ceil(stat.mtime || 0);
    rec.ctime = Math.ceil(stat.ctime || 0);
    rec.size = stat.size || 0;
    if (oldM !== rec.mtime || oldS !== rec.size) rec.hash = "";
  };

  proto.onFileAdd = function (file) {
    if (!file || !file.path || file.path === "/") return;
    const rec = this._localRecord(file.path);
    this._refreshLocalRecord(rec, file);
    this.requestSync();
  };

  proto.onFileRemove = function (file) {
    const path = typeof file === "string" ? file : file && file.path;
    if (!path) return;
    delete this.localFiles[path];
    delete this.skippedFiles[path];
  };

  proto.onFileRename = function (file, oldPath) {
    if (!file || !oldPath) return;
    const rec = this.localFiles[oldPath];
    if (rec) {
      delete this.localFiles[oldPath];
      rec.path = file.path;
      if (!rec.previouspath) rec.previouspath = oldPath;
      rec.synctime = 0;
      this._refreshLocalRecord(rec, file);
      this.localFiles[file.path] = rec;
    }
    delete this.skippedFiles[oldPath];
    delete this.skippedFiles[file.path];
    this.dirty = true;
    this.requestSync();
  };

  proto.onRaw = function (path) {
    const cd = this.app && this.app.vault.configDir;
    if (!cd || !path || !path.startsWith(cd + "/")) return;
    if (!this.scanSpecialFileQueue.includes(path)) this.scanSpecialFileQueue.push(path);
    this.requestSync();
  };

  proto.scanFiles = async function () {
    const vault = this.app.vault;
    const walk = (folder) => {
      const children = folder.children || [];
      for (const child of children) {
        this.onFileAdd(child);
        if (child instanceof host.TFolder) walk(child);
      }
    };
    if (vault.root) walk(vault.root);
    this.scanSpecialFiles = true;
  };

  // ---- selective-sync filter -----------------------------------------------------

  proto._configDirPrefix = function () {
    const cd = this.app && this.app.vault.configDir;
    return cd ? cd + "/" : null;
  };

  proto._classifyConfigFile = function (inner) {
    const segments = inner.split("/");
    for (const seg of segments) {
      if (seg === "node_modules" || seg.startsWith(".")) return { reject: true };
    }
    const last = segments[segments.length - 1];
    if (inner === "workspace.json" || inner === "workspace-mobile.json") return { reject: true };
    if (inner === "app.json" || inner === "types.json") return { category: "app" };
    if (inner === "appearance.json") return { category: "appearance" };
    if (inner === "hotkeys.json") return { category: "hotkey" };
    if (inner === "core-plugins.json" || inner === "core-plugins-migration.json") return { category: "core-plugin" };
    if (inner === "community-plugins.json") return { category: "community-plugin" };
    if (segments[0] === "themes" && segments.length === 3 && (last === "theme.css" || last === "manifest.json")) {
      return { category: "appearance-data" };
    }
    if (segments[0] === "snippets" && segments.length === 2 && last.endsWith(".css")) {
      return { category: "appearance-data" };
    }
    if (segments.length === 1 && last.endsWith(".json")) return { category: "core-plugin-data" };
    if (segments[0] === "plugins" && segments.length === 3 && last === "data.json") {
      return { category: "community-plugin-data" };
    }
    return { reject: true };
  };

  proto._allowSyncFile = function (path, isFolder) {
    for (const folder of this.ignoreFolders) {
      if (isFolder && path === folder) return false;
      if (path.startsWith(folder + "/")) return false;
    }
    const prefix = this._configDirPrefix();
    if (!isFolder && prefix && path.startsWith(prefix)) {
      const result = this._classifyConfigFile(path.slice(prefix.length));
      if (result.reject) return false;
      return this.allowSpecialFiles.has(result.category);
    }
    if (path.startsWith(".")) return false;
    if (isFolder) return true;
    const ext = extensionOf(path);
    if (ext === "md" || ext === "canvas" || ext === "base") return true;
    if (ng03HasExt(host.imageExtensions, ext)) return this.allowTypes.has("image");
    if (ext === "webm") return this.allowTypes.has("audio") || this.allowTypes.has("video");
    if (ng03HasExt(host.audioExtensions, ext)) return this.allowTypes.has("audio");
    if (ng03HasExt(host.videoExtensions, ext)) return this.allowTypes.has("video");
    if (ng03HasExt(host.pdfExtensions, ext)) return this.allowTypes.has("pdf");
    return this.allowTypes.has("unsupported");
  };

  proto.allowSyncFile = function (path, isFolder) {
    const cached = this.filterCache[path];
    if (cached !== undefined) return cached;
    const result = this._allowSyncFile(path, !!isFolder);
    this.filterCache[path] = result;
    return result;
  };

  proto.changeFilter = function (change) {
    const rejected = [];
    for (const path in this.serverFiles) {
      const rec = this.serverFiles[path];
      if (rec && !rec.folder && !this.allowSyncFile(path, false)) rejected.push(path);
    }
    change();
    this.filterCache = {};
    const revived = rejected.filter((path) => this.allowSyncFile(path, false));
    revived.sort((a, b) => a.length - b.length);
    const queue = revived.map((path) => ({ ...(this.serverFiles[path] || { path }) }));
    this.newServerFiles = queue.concat(this.newServerFiles);
    this.dirty = true;
  };

  proto.setSyncType = function (type, enabled) {
    if (this.allowTypes.has(type) === enabled) return;
    this.changeFilter(() => {
      if (enabled) this.allowTypes.add(type); else this.allowTypes.delete(type);
    });
    this.forceSaveData();
    this.requestSync();
  };

  proto.setAllowSpecialFile = function (type, enabled) {
    if (this.allowSpecialFiles.has(type) === enabled) return;
    this.changeFilter(() => {
      if (enabled) this.allowSpecialFiles.add(type); else this.allowSpecialFiles.delete(type);
    });
    this.forceSaveData();
    this.requestSync();
  };

  proto.setIgnoreFolders = function (folders) {
    const next = (folders || []).slice();
    if (JSON.stringify(next) === JSON.stringify(this.ignoreFolders)) return;
    this.changeFilter(() => { this.ignoreFolders = next; });
    this.forceSaveData();
    this.requestSync();
  };

  proto.canSyncPath = function (since, path) {
    for (const key in this.fileRetry) {
      const entry = this.fileRetry[key];
      if (entry && entry.ts > since && path.startsWith(key)) return false;
    }
    return true;
  };

  proto.canSyncLocalFile = function (now, rec) {
    if (!rec || !rec.synctime) return true;
    const size = rec.size || 0;
    const interval = size <= 10240 ? 10000 : size <= 102400 ? 20000 : 30000;
    return now - rec.synctime >= interval;
  };

  // ---- lifecycle ------------------------------------------------------------------

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerStatusBarItem();
    const SyncSettingsView = ng03DefineSyncSettingsView(host);
    this.settingTab = new SyncSettingsView(app, this, plugin);
    const ChangesView = ng03DefineSyncChangesView(host);
    plugin.registerViewType("sync", (leaf) => new ChangesView(leaf));
  };

  proto.onEnable = function (app, plugin) {
    const self = this;
    const vault = app.vault;
    vault.on("create", this._onVaultCreate = (file) => this.onFileAdd(file));
    vault.on("modify", this._onVaultModify = (file) => this.onFileAdd(file));
    vault.on("delete", this._onVaultDelete = (file) => this.onFileRemove(file));
    vault.on("rename", this._onVaultRename = (file, oldPath) => this.onFileRename(file, oldPath));
    vault.on("raw", this._onVaultRaw = (path) => this.onRaw(path));

    plugin.addSettingTab(this.settingTab);

    app.workspace.on("file-menu", this._onFileMenu = (menu, file, source) => this.onFileMenu(menu, file, source));

    const ti = ng03SyncI18n();
    plugin.registerGlobalCommand({
      id: "sync:setup",
      name: ti.actionSetupSync(),
      icon: "lucide-settings",
      checkCallback: (checking) => {
        if (!this.vaultId) {
          if (!checking) this.openSettings();
          return true;
        }
        return false;
      },
    });
    plugin.registerGlobalCommand({
      id: "sync:view-version-history",
      name: ti.actionViewVersionHistory(),
      icon: "lucide-history",
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(host.FileView);
        const file = view && view.file;
        if (this.vaultId && file) {
          if (!checking) this.showVersionHistory(file.path);
          return true;
        }
        return false;
      },
    });
    plugin.registerGlobalCommand({
      id: "sync:open-sync-view",
      name: ti.actionViewSyncSidebar(),
      icon: "lucide-rotate-ccw",
      checkCallback: (checking) => {
        if (!this.vaultId) return false;
        if (!checking) {
          const leaf = app.workspace.getRightLeaf(false) || app.workspace.getLeaf("tab");
          if (leaf) {
            leaf.setViewState({ type: "sync", active: true });
            app.workspace.revealLeaf(leaf);
          }
        }
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "sync:open-sync-log",
      name: ti.actionActivityLog(),
      icon: "lucide-align-left",
      checkCallback: (checking) => {
        if (!this.vaultId) return false;
        if (!checking) this.showSyncLog();
        return true;
      },
    });

    this._registerCli(plugin);
    this._createStatusIcon(plugin);

    app.workspace.onLayoutReady(async () => {
      try {
        await this.loadData();
      } catch (error) {
        console.error("Sync loadData failed", error);
      }
      this.initialized = true;
      this.dataLoaded = true;
      this.requestSync();
      this._updateStatusBar();
    });

    this._syncTimer = setInterval(() => {
      if (this.vaultId && !this.pause) this.requestSync();
    }, 30000);

    this.on("status-change", () => this._updateStatusBar());
  };

  proto.onDisable = function () {
    if (this.server) {
      try { this.server.disconnect(); } catch (error) { /* ignore */ }
      this.server = null;
    }
    this.gettingServer = null;
    if (this._syncTimer) { clearInterval(this._syncTimer); this._syncTimer = null; }
    if (this._onVaultCreate) this.app.vault.off("create", this._onVaultCreate);
    if (this._onVaultModify) this.app.vault.off("modify", this._onVaultModify);
    if (this._onVaultDelete) this.app.vault.off("delete", this._onVaultDelete);
    if (this._onVaultRename) this.app.vault.off("rename", this._onVaultRename);
    if (this._onVaultRaw) this.app.vault.off("raw", this._onVaultRaw);
    if (this._onFileMenu) this.app.workspace.off("file-menu", this._onFileMenu);
    if (this.statusIconEl) this.statusIconEl.detach();
    if (this.statusBarSegmentEl) this.statusBarSegmentEl.detach();
    this.statusIconEl = null;
    this.statusBarSegmentEl = null;
  };

  // ---- status bar icon ---------------------------------------------------------

  proto._createStatusIcon = function (plugin) {
    const self = this;
    if (host.Platform.isMobile) {
      const header = this.app.workspace.rightSplit && this.app.workspace.rightSplit.addHeaderButton && this.app.workspace.rightSplit;
      if (header && header.addHeaderButton) {
        const btn = header.addHeaderButton("sync-small");
        if (btn) {
          btn.addClass("sync-status-icon");
          btn.addEventListener("click", (event) => self.openStatusIconMenu(event));
          btn.addEventListener("contextmenu", (event) => { event.preventDefault(); self.openStatusIconMenu(event); });
          this.statusIconEl = btn;
        }
      }
      return;
    }
    if (plugin && plugin.statusBarEl) {
      const segment = plugin.statusBarEl.createDiv("status-bar-item-segment");
      const icon = segment.createSpan("status-bar-item-icon sync-status-icon");
      icon.addEventListener("click", (event) => self.openStatusIconMenu(event));
      icon.addEventListener("contextmenu", (event) => { event.preventDefault(); self.openStatusIconMenu(event); });
      plugin.statusBarEl.addEventListener("click", (event) => self.openStatusIconMenu(event));
      plugin.statusBarEl.addEventListener("contextmenu", (event) => { event.preventDefault(); self.openStatusIconMenu(event); });
      this.statusBarSegmentEl = segment;
      this.statusIconEl = icon;
    }
  };

  // ---- menus ---------------------------------------------------------------------

  proto.openStatusIconMenu = function (event) {
    const menu = host.Menu.forEvent(event);
    menu.setParentElement(this.statusIconEl || undefined);
    const sections = ["status", "selection", "", "global"];
    menu.addSections(sections);
    const ii = ng03InterfaceI18n();
    const ti = ng03SyncI18n();
    menu.addItem((item) => {
      item.setTitle(ii.labelSyncStatus ? ii.labelSyncStatus({ status: this.syncStatus }) : this.syncStatus)
        .setIsLabel(true)
        .removeIcon();
      if (item.titleEl) item.titleEl.addClass("u-small");
    }, sections[0]);
    if (this.vaultId) {
      menu.addItem((item) => {
        if (this.pause) {
          item.setTitle(ti.buttonResume()).setIcon("lucide-play-circle")
            .onClick(() => { this.setPause(false); this.requestSync(); });
        } else {
          item.setTitle(ti.buttonPause()).setIcon("lucide-pause")
            .onClick(() => this.setPause(true));
        }
      }, sections[0]);
      menu.addItem((item) => {
        const view = this.app.workspace.getActiveViewOfType(host.FileView);
        const file = view && view.file;
        item.setTitle(ti.actionViewVersionHistory()).setIcon("lucide-history")
          .setDisabled(!file)
          .onClick(() => { if (file) this.showVersionHistory(file.path); });
      }, sections[1]);
      menu.addItem((item) => {
        item.setTitle(ti.actionActivityLog()).setIcon("lucide-align-left")
          .onClick(() => this.showSyncLog());
      }, sections[3]);
      menu.addItem((item) => {
        item.setTitle(ti.labelDeletedFiles ? ti.labelDeletedFiles() : "Deleted files").setIcon("lucide-trash-2")
          .onClick(() => this.showDeletedFiles());
      }, sections[3]);
    }
    menu.addItem((item) => {
      item.setTitle(ii.settings()).setIcon("lucide-settings")
        .onClick(() => this.openSettings());
    });
    menu.showAtMouseEvent(event);
  };

  proto.onFileMenu = function (menu, file, source) {
    if (!(file instanceof host.TFile)) return;
    if (source !== "tab-header" && source !== "more-options" && source !== "file-explorer-context-menu") return;
    const ti = ng03SyncI18n();
    menu.addItem((item) => {
      item.setSection("view")
        .setTitle(ti.menuOptViewVersionHistory())
        .setIcon("lucide-history")
        .onClick(() => this.showVersionHistory(file.path));
    });
  };

  // ---- connection ------------------------------------------------------------------

  proto.getHost = function () {
    const h = this.host || "";
    const name = h.split(":")[0];
    const local = name === "localhost" || name === "127.0.0.1" || name === "::1" || name.endsWith(".local");
    return (local ? "ws://" : "wss://") + h;
  };

  proto.getDefaultDeviceName = function () {
    return ng03DefaultDeviceName(host);
  };

  proto._onReady = function (serverVersion) {
    this.log("Connection successful. Detecting changes...");
    this.ready = true;
    this.initial = false;
    if (serverVersion > this.version) this.version = serverVersion;
    this.dirty = true;
    this.saveData();
    this.requestSync();
  };

  proto._onConnectError = function (error) {
    const message = error && error.message ? error.message : String(error);
    if (message.indexOf("Your subscription to Basalt Sync has expired") >= 0) {
      new host.Notice(message);
    } else if (message.indexOf("Vault not found") >= 0) {
      const ti = ng03SyncI18n();
      new host.Notice(ti.msgDisconnectFromDeletedVault ? ti.msgDisconnectFromDeletedVault() : message);
      this.unsetup();
      return;
    }
    this.log(message, "", true);
    if (this.server) {
      try { this.server.disconnect(); } catch (e) { /* ignore */ }
      this.server = null;
    }
    this.gettingServer = null;
    this.error = true;
    this.backoff.fail();
    this._updateStatusBar();
  };

  proto.asyncGetServer = async function () {
    const token = account.token;
    const hostName = this.host;
    const id = this.vaultId;
    if (!hostName || !token || !id) return null;
    if (!this.encryptionProvider) {
      if (!this.key) return null;
      try {
        this.encryptionProvider = await initCipher(
          this.encryptionVersion < 0 ? 0 : this.encryptionVersion, this.key, this.salt);
      } catch (error) {
        this.log("Unable to decrypt vault", "", true);
        this.error = true;
        this.backoff.fail();
        return null;
      }
    }
    const server = this.server = new (env().hee)(this.encryptionProvider);
    this.setStatus("Connecting to server");
    this.log("Connecting to server");
    const device = this.deviceName || this.getDefaultDeviceName();
    try {
      await server.connect(this.getHost(), token, id, this.version, this.initial, device,
        (v) => this._onReady(v), (entry) => this.onPushedFile(entry));
    } catch (error) {
      this._onConnectError(error);
      return null;
    }
    this.backoff.success();
    return server;
  };

  proto.getServer = function () {
    if (this.gettingServer) return this.gettingServer;
    const server = this.server;
    if (server && !server.isConnected() && !server.isConnecting()) {
      try { server.disconnect(); } catch (error) { /* ignore */ }
      this.server = null;
      this.backoff.fail();
    }
    if (this.server) return Promise.resolve(this.server);
    if (!this.vaultId || !this.host || !account.token) return Promise.resolve(null);
    if (!this.encryptionProvider && !this.key) return Promise.resolve(null);
    this.gettingServer = this.asyncGetServer().finally(() => { this.gettingServer = null; });
    return this.gettingServer;
  };

  // ---- server-pushed entries ---------------------------------------------------------

  proto.onPushedFile = function (entry) {
    if (!entry || !entry.path) return;
    this.version = entry.uid || this.version;
    if (this.initial && entry.deleted) return;
    const record = {
      path: entry.path,
      previouspath: entry.previouspath || "",
      folder: !!entry.folder,
      ctime: entry.ctime || 0,
      mtime: entry.mtime || 0,
      size: entry.size || 0,
      hash: entry.hash || "",
      deleted: !!entry.deleted,
      uid: entry.uid || 0,
      device: entry.device || "",
      user: entry.user != null ? entry.user : -1,
      ts: entry.ts || Date.now(),
    };
    if (this.initial) record.initial = true;
    if (entry.wasJustPushed) {
      // echo of our own upload: drop matching pending entries, store directly
      this.newServerFiles = this.newServerFiles.filter((item) => item.path !== entry.path);
      this.serverFiles[entry.path] = record;
      this.dirty = true;
      return;
    }
    let suffix = "";
    if (entry.folder) suffix += " (folder)";
    if (entry.deleted) suffix += " (deleted or renamed)";
    if (entry.device) suffix += " [" + entry.device + "]";
    this.log("Server pushed" + suffix, entry.path);
    this.newServerFiles.push(record);
    this.requestSync();
  };

  // ---- the sync cycle ------------------------------------------------------------------

  proto.requestSync = function () {
    if (this.syncing) return;
    this.syncing = true;
    this.error = false;
    this.trigger("status-change");
    (async () => {
      try {
        await host.sleep(50);
        while (this.vaultId && !this.pause) {
          if (host.s16Em && this.preventSleep && !this._keepAwake && host.s13KeepAwake) {
            this._keepAwake = host.s13KeepAwake();
          }
          const server = this.server;
          const netTs = server ? server.lastNetworkRequestTs || 0 : 0;
          const cycleStart = Date.now();
          let more = false;
          try {
            more = await this._sync();
          } catch (error) {
            this.log("Sync Error!", "", true);
            console.error(error);
            this.error = true;
            this.failedSync(error && error.message ? error.message : String(error));
            break;
          }
          if (this.syncingPath) {
            delete this.fileRetry[this.syncingPath];
            this.syncingPath = null;
          }
          if (this.dirty) {
            this.dirty = false;
            this.saveData();
          }
          if (!more) break;
          const wait = server ? Math.max(0, 50 - (Date.now() - Math.max(netTs, cycleStart))) : 0;
          if (wait > 0) await host.sleep(wait);
        }
      } finally {
        if (this._keepAwake) {
          try { this._keepAwake.release(); } catch (error) { /* ignore */ }
          this._keepAwake = null;
        }
        this.syncing = false;
        this.trigger("status-change");
        this._updateStatusBar();
      }
    })();
  };

  proto.failedSync = function (message) {
    const path = this.syncingPath;
    this.log(message, path || "", true);
    if (path) {
      const entry = this.fileRetry[path] || { count: 0 };
      entry.count = (entry.count || 0) + 1;
      entry.ts = Date.now() + Math.min(5 * Math.pow(2, entry.count) * 1000, 300000);
      this.fileRetry[path] = entry;
    }
    this._updateStatusBar();
  };

  proto._sync = async function () {
    if (this.pause) return false;
    if (!this.backoff.isReady()) {
      this.log("Waiting to connect to server");
      return false;
    }
    if (!account.token) throw new Error("Not logged in");
    const server = await this.getServer();
    if (!server) return false;
    if (this.pause || !this.vaultId) return false;

    // Phase A: special-file scan (once per connect while armed)
    if (this.scanSpecialFiles) {
      this.scanSpecialFiles = false;
      this.setStatus("Initializing...");
      const vault = this.app.vault;
      const dotPaths = [];
      for (const path in this.localFiles) {
        if (path.split("/")[0].charAt(0) === ".") dotPaths.push(path);
      }
      for (const path of dotPaths) delete this.localFiles[path];
      const cd = vault.configDir;
      const queue = [];
      const pushJson = async (p) => { queue.push(p); };
      try {
        const adapter = vault.adapter;
        const list = await adapter.list(cd);
        for (const file of list.files || []) {
          const rel = file.slice(cd.length + 1);
          const segs = rel.split("/");
          if (segs.some((s) => s === "node_modules" || s.startsWith("."))) continue;
          if (segs.length === 1 && file.endsWith(".json")) queue.push(file);
          if (segs[0] === "themes" && segs.length === 3 && (segs[2] === "theme.css" || segs[2] === "manifest.json")) queue.push(file);
          if (segs[0] === "snippets" && segs.length === 2 && segs[1].endsWith(".css")) queue.push(file);
          if (segs[0] === "plugins" && segs.length === 3 && segs[2] === "data.json") queue.push(file);
        }
      } catch (error) {
        // config dir listing is best-effort
      }
      queue.push(cd + "/config");
      this.scanSpecialFileQueue = queue.concat(this.scanSpecialFileQueue.filter((p) => !queue.includes(p)));
      this.forceSaveData();
      while (this.scanSpecialFileQueue.length) {
        const path = this.scanSpecialFileQueue.pop();
        try {
          const file = vault.getAbstractFileByPath(path);
          if (!file && path.startsWith(cd + "/")) {
            // config files live outside the vault tree; stat via adapter
            try {
              const stat = await vault.adapter.stat(path);
              if (!stat || stat.type !== "file") { delete this.localFiles[path]; continue; }
              const rec = this._localRecord(path);
              this._refreshLocalRecord(rec, { stat, path });
            } catch (e2) {
              delete this.localFiles[path];
            }
          } else if (file) {
            this._refreshLocalRecord(this._localRecord(path), file);
          } else {
            delete this.localFiles[path];
          }
        } catch (error) {
          this.log("Failed to scan " + path + ": " + (error && error.message || error), "", true);
        }
      }
    }

    // Phase B: apply pending server pushes (at most one accept per cycle)
    const pendingResult = await this._applyPending(server);
    if (pendingResult) return true;

    // Phase C: propagate local deletions to the server
    if (await this._pushDeletes(server)) return true;

    // Phase D: pick uploads
    if (await this._pickUploads(server)) return true;

    // Phase E: quiescence
    this.log("Fully synced");
    this.setStatus("Fully synced");
    this.fileRetry = {};
    return false;
  };

  proto._acceptPending = function (entry, opts) {
    opts = opts || {};
    if (!opts.silent) this.log("Accepted " + entry.path, entry.path);
    const localRec = this.localFiles[entry.path];
    if (localRec) localRec.synctime = Date.now();
    if (!opts.skipStore) this.serverFiles[entry.path] = entry;
    if (this.newServerFiles.length && this.newServerFiles[0] === entry) this.newServerFiles.shift();
    else {
      const idx = this.newServerFiles.indexOf(entry);
      if (idx >= 0) this.newServerFiles.splice(idx, 1);
    }
    this.dirty = true;
    return true;
  };

  proto._applyPending = async function (server) {
    let deferred = 0;
    while (this.newServerFiles.length) {
      const entry = this.newServerFiles[0];
      const path = entry.path;
      if (!this.allowSyncFile(path, !!entry.folder)) {
        this._acceptPending(entry, { silent: true });
        return false;
      }
      const segments = normalizePath(path).split("/");
      if (segments.some((s) => s === "..")) {
        this._acceptPending(entry, { silent: true });
        continue;
      }
      const isAndroid = host.Platform.isAndroidApp;
      const illegal = !s05IsValidFileName(path) || (isAndroid && /[*?"]/.test(path));
      if (illegal) {
        this.log("Ignoring remote file name with illegal characters", path, true);
        new host.Notice('Sync: Unable to download file with illegal name "' + path + '"');
        this.newServerFiles.shift();
        continue;
      }
      const since = Date.now();
      if (!this.canSyncPath(since - 60000, path)) { deferred++; this.newServerFiles.push(this.newServerFiles.shift()); continue; }
      const localRec = this.localFiles[path];
      const remoteRec = this.serverFiles[path];
      // hash comparison
      let localHash = localRec ? localRec.hash : "";
      if (localRec && !localRec.folder && localRec.hash) {
        const info = this.app.metadataCache.getFileInfo(path);
        if (info && info.mtime === localRec.mtime && info.size === localRec.size) localHash = info.hash || localHash;
      }
      if (localHash && localHash === entry.hash && !entry.deleted) {
        this._acceptPending(entry, { silent: true });
        continue;
      }
      // duplicate pending path later in queue
      if (this.newServerFiles.slice(1).some((item) => item.path === path)) {
        this.logSkip("Skipped " + path, path);
        this._acceptPending(entry);
        continue;
      }
      const localFile = this.app.vault.getAbstractFileByPath(path);
      if (!localRec && entry.deleted) {
        this._acceptPending(entry, { silent: true });
        continue;
      }
      if (!localRec || !localFile || entry.initial || (entry.mtime > (localRec.mtime || 0) && entry.hash !== localRec.synchash)) {
        // download path (merge handled below for markdown)
        const merged = await this._tryMerge(server, entry, localRec, localFile);
        if (merged === "accepted") { this._acceptPending(entry); return true; }
        if (merged === "defer") { deferred++; this.newServerFiles.push(this.newServerFiles.shift()); continue; }
        this.setStatus("Downloading " + path);
        try {
          await this.syncFileDown(server, entry);
        } catch (error) {
          const msg = error && error.message ? error.message : String(error);
          if (isAndroid && msg.indexOf("FILE_NOTCREATED") >= 0) {
            this.log("Ignoring remote file name with illegal characters", path, true);
            this.newServerFiles.shift();
            continue;
          }
          throw error;
        }
        this._acceptPending(entry);
        return true;
      }
      // both exist and differ: markdown merge or conflict handling
      const merged = await this._tryMerge(server, entry, localRec, localFile);
      if (merged === "accepted") { this._acceptPending(entry); return true; }
      if (merged === "defer") { deferred++; this.newServerFiles.push(this.newServerFiles.shift()); continue; }
      // folder/file mismatches
      if (localRec && localRec.folder !== !!entry.folder) {
        if (entry.folder && !localRec.folder) {
          // local file vs incoming folder: rename local to conflicted copy
          const file = localFile;
          if (file) {
            const tag = ng03SanitizeTag(this.deviceName || this.getDefaultDeviceName(), this.getDefaultDeviceName());
            const newPath = this.app.vault.getAvailablePath(ng03ConflictName(path, tag, ""));
            this.setStatus("Renaming conflicted file " + path);
            this.logMerge("Renaming conflicted file " + path, path);
            await this.app.vault.rename(file, newPath);
            this.dirty = true;
            return true; // cycle ends without accepting
          }
        }
        if (!entry.folder && localRec.folder) {
          // incoming file vs local folder handled inside syncFileDown
        }
      }
      if (remoteRec && (remoteRec.folder || entry.folder) && localRec && localRec.folder === !!entry.folder) {
        if (entry.deleted) {
          const existing = this.app.vault.getAbstractFileByPath(path);
          if (existing) {
            this.setStatus("Deleting " + path);
            this.log("Deleting " + path, path);
            try { await this.app.vault.delete(existing, true); } catch (e) { this.log(e.message, path, true); }
          }
        } else {
          this.setStatus("Downloading " + path);
          await this.syncFileDown(server, entry);
        }
        this._acceptPending(entry);
        return true;
      }
      if (localRec && localFile instanceof host.TFile && entry.folder) {
        // covered above
      }
      // local file vs incoming folder rename handled; otherwise hashes equal path
      if (entry.deleted && localFile) {
        this.setStatus("Deleting " + path);
        this.log("Deleting " + path, path);
        try { await this.app.vault.delete(localFile, true); } catch (e) { this.log(e.message, path, true); }
        this._acceptPending(entry);
        return true;
      }
      if (!entry.deleted) {
        this.setStatus("Downloading " + path);
        await this.syncFileDown(server, entry);
        this._acceptPending(entry);
        return true;
      }
      this._acceptPending(entry, { silent: true });
      return true;
    }
    return deferred > 0;
  };

  /** Returns "accepted" | "defer" | null (fall through to default handling). */
  proto._tryMerge = async function (server, entry, localRec, localFile) {
    const path = entry.path;
    const isMd = extensionOf(path) === "md";
    const mergeCandidate = isMd && !entry.initial && !(localRec && localRec.folder) && !entry.folder
      && !entry.deleted && entry.hash !== (localRec && localRec.synchash);
    if (mergeCandidate && localFile instanceof host.TFile) {
      this.setStatus("Merging " + path);
      this.logMerge("Merging conflicted file " + path, path);
      let localText = "";
      try { localText = await this.app.vault.read(localFile); } catch (e) {
        this.logMerge("Merge failed. " + (e && e.message || e), path);
        return "accepted";
      }
      if (!localText) return null; // empty local -> plain download
      let prevText = "", newText = "";
      const remoteRec = this.serverFiles[path];
      try {
        if (remoteRec && remoteRec.uid) prevText = utf8String(await server.pull(remoteRec.uid));
        newText = utf8String(await server.pull(entry.uid));
      } catch (e) {
        this.logMerge("Merge failed. " + (e && e.message || e), path);
        return "accepted";
      }
      if (prevText === newText || localText === newText) return "accepted";
      if (!newText) return "accepted";
      if (this.conflictAction === "conflict") {
        const tag = ng03SanitizeTag(this.deviceName || this.getDefaultDeviceName(), this.getDefaultDeviceName());
        const now = new Date();
        const stamp = now.getFullYear() + ng03Pad2(now.getMonth() + 1) + ng03Pad2(now.getDate()) + ng03Pad2(now.getHours()) + ng03Pad2(now.getMinutes());
        const copyPath = this.app.vault.getAvailablePath(ng03ConflictName(path, tag, stamp));
        await this.app.vault.create(copyPath, localText);
        await this.app.vault.modify(localFile, newText);
        this.log("Conflicted copy stored", path);
        return "accepted";
      }
      try {
        if (remoteRec && remoteRec.uid) {
          const fm = this.app.fileManager || this.app.vault;
          if (fm.createBackup) await fm.createBackup(localFile, localText);
        } else {
          const fm = this.app.fileManager;
          if (fm && fm.createBackup) await fm.createBackup(localFile, localText);
        }
        const merged = s10MergeText(prevText, localText, newText, host);
        await this.app.vault.modify(localFile, merged);
        this.log("Merge successful", path);
        return "accepted";
      } catch (e) {
        this.logMerge("Merge failed. " + (e && e.message || e), path);
        return "accepted";
      }
    }
    // config-file JSON merge
    const prefix = this._configDirPrefix();
    if (!(entry.folder || entry.deleted || (entry.size || 0) <= 0 || !prefix || !path.startsWith(prefix))) return null;
    const ext = extensionOf(path);
    if (ext !== "json") return null;
    try {
      const localFile = this.app.vault.getAbstractFileByPath(path);
      const localRaw = localFile ? await this.app.vault.readBinary(localFile) : null;
      const remoteRaw = await server.pull(entry.uid);
      if (remoteRaw == null) return null;
      const localObj = localRaw ? JSON.parse(utf8String(localRaw.buffer || localRaw)) : {};
      const remoteObj = JSON.parse(utf8String(remoteRaw.buffer || remoteRaw));
      if (typeof localObj !== "object" || localObj === null || Array.isArray(localObj)
        || typeof remoteObj !== "object" || remoteObj === null || Array.isArray(remoteObj)) {
        return null;
      }
      for (const key in remoteObj) localObj[key] = remoteObj[key];
      if (path === prefix + "core-plugins.json") this.patchCorePlugins(localObj);
      const data = utf8Bytes(JSON.stringify(localObj, null, 2));
      const adapter = this.app.vault.adapter;
      await adapter.writeBinary(path, data);
      this.logMerge("Merge successful", path);
      return "accepted";
    } catch (e) {
      this.logMerge("Merge failed. " + (e && e.message || e), path);
      // fall back to plain download
      return null;
    }
  };

  proto.patchCorePlugins = function (obj) {
    if (Array.isArray(obj)) {
      if (!obj.includes("sync")) obj.push("sync");
    } else if (obj && typeof obj === "object" && obj.sync !== true) {
      obj.sync = true;
    }
  };

  proto.patchCorePluginsFile = function (data) {
    try {
      const text = utf8String(data.buffer || data);
      const obj = JSON.parse(text);
      const before = JSON.stringify(obj);
      this.patchCorePlugins(obj);
      if (JSON.stringify(obj) !== before) return utf8Bytes(JSON.stringify(obj, null, 2));
    } catch (e) { /* leave unchanged */ }
    return data;
  };

  proto._pushDeletes = async function (server) {
    let file = null, filePath = "";
    let folder = null, folderPath = "";
    for (const path in this.serverFiles) {
      const rec = this.serverFiles[path];
      if (!rec || rec.deleted) continue;
      if (!this.localFiles[path] && this.allowSyncFile(path, !!rec.folder)) {
        if (rec.folder) {
          if (!folder || path.length > folderPath.length) { folder = rec; folderPath = path; }
        } else {
          if (!file || path.length > filePath.length) { file = rec; filePath = path; }
        }
      }
    }
    const pick = file || folder;
    if (!pick) return false;
    const isFolder = !!pick.folder;
    this.syncingPath = pick.path;
    this.setStatus((isFolder ? "Deleting remote folder " : "Deleting remote file ") + pick.path);
    this.log((isFolder ? "Deleting remote folder " : "Deleting remote file ") + pick.path, pick.path);
    await server.push(pick.path, pick.previouspath || null, isFolder, true, 0, 0, "", null);
    pick.deleted = true;
    this.dirty = true;
    return true;
  };

  proto._pickUploads = async function (server) {
    let deferred = 0;
    let uploadFolder = null;
    let uploadFile = null;
    const now = Date.now();
    for (const path in this.localFiles) {
      const local = this.localFiles[path];
      if (!this.allowSyncFile(path, local.folder)) continue;
      if (!this.canSyncPath(now, path)) { deferred++; continue; }
      const remote = this.serverFiles[path];
      const changed = !remote || remote.deleted || (!!remote.folder !== !!local.folder)
        || remote.ctime !== local.ctime || remote.mtime !== local.mtime || remote.size !== local.size
        || !local.hash || (remote.hash && remote.hash !== local.hash);
      if (!changed) continue;
      if (!local.folder && !this.canSyncLocalFile(now, local)) { deferred++; continue; }
      if (local.size > server.perFileMax && !local.folder) {
        this.logSkip("File too large to sync (" + local.size + ", max " + server.perFileMax + ")", path);
        continue;
      }
      if (local.folder) {
        if (!uploadFolder || path.length < uploadFolder.path.length) uploadFolder = local;
      } else if (!uploadFile || local.size > uploadFile.size) {
        uploadFile = local;
      }
    }
    const pick = uploadFolder || uploadFile;
    if (!pick) return deferred > 0;
    this.syncingPath = pick.path;
    if (pick.folder) {
      this.setStatus("Uploading " + pick.path);
      this.log("Uploading " + pick.path, pick.path);
      await server.push(pick.path, pick.previouspath || null, true, false, 0, 0, "", null);
      let remote = this.serverFiles[pick.path];
      if (!remote) {
        remote = this.serverFiles[pick.path] = { path: pick.path, folder: true, ctime: 0, mtime: 0, size: 0, hash: "", deleted: false, uid: 0, device: this.deviceName };
      } else {
        remote.deleted = false;
      }
      pick.previouspath = "";
      pick.synctime = Date.now();
      this.dirty = true;
      return true;
    }
    // file upload
    const remote = this.serverFiles[pick.path];
    let hash = pick.hash;
    if (!hash) {
      const info = this.app.metadataCache.getFileInfo(pick.path);
      if (info && info.mtime === pick.mtime && info.size === pick.size) hash = info.hash || "";
    }
    if (hash && remote && remote.hash === hash) {
      this.setStatus("Comparing " + pick.path);
      pick.synchash = hash;
      pick.synctime = Date.now();
      this.dirty = true;
      return true;
    }
    const file = this.app.vault.getAbstractFileByPath(pick.path);
    if (!file) { delete this.localFiles[pick.path]; return deferred > 0; }
    this.setStatus("Computing hash " + pick.path);
    const data = await this.app.vault.readBinary(file);
    hash = await contentHash(data.buffer || data);
    if (remote && remote.hash === hash) {
      this.setStatus("Comparing " + pick.path);
      pick.hash = hash; pick.synchash = hash;
      pick.synctime = Date.now();
      this.dirty = true;
      return true;
    }
    this.setStatus("Uploading " + pick.path);
    this.log("Uploading file " + pick.path, pick.path);
    const result = await server.push(pick.path, pick.previouspath || null, false, false, pick.ctime, pick.mtime, hash, data);
    pick.hash = hash;
    pick.synchash = hash;
    if (result && result.uid) {
      const rec = this.serverFiles[pick.path] = {
        path: pick.path, previouspath: pick.previouspath || "", folder: false,
        ctime: pick.ctime, mtime: pick.mtime, size: pick.size, hash,
        deleted: false, uid: result.uid, device: this.deviceName, user: this.userId,
      };
    }
    this.log("Upload complete " + pick.path, pick.path);
    pick.previouspath = "";
    pick.synctime = Date.now();
    this.dirty = true;
    return true;
  };

  // ---- downloads ------------------------------------------------------------------------

  proto.syncFileDown = async function (server, entry) {
    const vault = this.app.vault;
    const path = entry.path;
    const adapter = vault.adapter;
    if (entry.folder) {
      const existing = vault.getAbstractFileByPath(path);
      if (existing instanceof host.TFolder) {
        // case-insensitive collision fix
        for (const p in this.localFiles) {
          if (p !== path && p.toLowerCase() === path.toLowerCase() && p.split("/").pop() === path.split("/").pop()) {
            try { await adapter.rename(p, path); } catch (e) { /* best effort */ }
            break;
          }
        }
        return;
      }
      if (existing) await vault.delete(existing, true);
      await adapter.mkdir(path);
      return;
    }
    const existing = vault.getAbstractFileByPath(path);
    if (existing instanceof host.TFolder) {
      if ((existing.children || []).length > 0) {
        const copyPath = vault.getAvailablePath(path + " (Conflicted copy)");
        await adapter.rename(path, copyPath);
      } else {
        await adapter.rmdir(path);
      }
    }
    this.setStatus("Downloading " + path);
    const data = await server.pull(entry.uid);
    if (!data) throw new Error("Failed to download file, no data.");
    let finalData = data;
    if (path === this._configDirPrefix() + "core-plugins.json") {
      const patched = this.patchCorePluginsFile(data);
      if (!patched) {
        this.log("File is corrupt, ignoring", path, true);
        throw new Error("File is corrupt, ignoring");
      }
      finalData = patched;
    }
    const hash = await contentHash(finalData.buffer || finalData);
    await s04SettlePromise(Promise.resolve());
    let ctime = entry.ctime || 0;
    const oldStat = existing ? await adapter.stat(path).catch(() => null) : null;
    if (oldStat && oldStat.ctime && oldStat.ctime > ctime) ctime = oldStat.ctime;
    const file = vault.getAbstractFileByPath(path);
    if (file instanceof host.TFile) {
      if (file.saving) await host.sleep(100);
      await vault.modifyBinary(file, finalData);
    } else {
      const parent = parentPath(path);
      if (parent && !vault.getAbstractFileByPath(parent)) await adapter.mkdir(parent);
      await adapter.writeBinary(path, finalData, { ctime, mtime: entry.mtime });
    }
    const rec = this.localFiles[path];
    if (rec) {
      rec.hash = hash;
      rec.synchash = hash;
      rec.synctime = Date.now();
    }
    this.log("Downloading complete " + path, path);
    this.dirty = true;
  };

  // ---- history / deleted / size -------------------------------------------------------------

  proto.getHistory = function (path, cursor) {
    return this.getServer().then((server) => {
      if (!server) return { items: [], more: false };
      return server.listHistory(path, cursor);
    });
  };

  proto.getContentForVersion = function (uid) {
    return this.getServer().then((server) => {
      if (!server) return null;
      return server.pull(uid);
    });
  };

  proto.restoreVersion = async function (uid, path) {
    if (!path) {
      const server = await this.getServer();
      if (!server) throw new Error("Sync is not connected");
      return server.restore(uid);
    }
    const data = await this.getContentForVersion(uid);
    if (data == null) throw new Error("Failed to download file, no data.");
    const content = utf8String(data.buffer || data);
    await this.app.vault.adapter.write(path, content);
  };

  proto.showVersionHistory = function (path) {
    if (window.__vaultSyncHistory) {
      window.__vaultSyncHistory(path);
      return;
    }
    const FileHistoryView = ng03DefineSyncFileHistoryView(host);
    new FileHistoryView(this.app, this, path).open();
  };

  proto.showDeletedFiles = async function (useHistoryView) {
    const server = await this.getServer();
    if (!server) { this.openSettings(); return; }
    const self = this;
    server.listDeleted().then((items) => {
      const sorted = (items || []).slice().reverse();
      if (useHistoryView) {
        const DeletedFilesModal = ng03DefineSyncDeletedFilesModal(host);
        new DeletedFilesModal(self.app, self, sorted).open();
      } else {
        const FileHistoryModal = ng03DefineSyncFileHistoryModal(host);
        const ti = ng03SyncI18n();
        new FileHistoryModal(self.app, self, sorted, ti.labelDeletedFiles ? ti.labelDeletedFiles() : "Deleted files").open();
      }
    }).catch((error) => {
      new host.Notice(error && error.message || String(error));
    });
  };

  proto.showConfigFiles = async function () {
    const prefix = this._configDirPrefix();
    const items = [];
    for (const path in this.serverFiles) {
      const rec = this.serverFiles[path];
      if (!rec || rec.folder) continue;
      if (!prefix || !path.startsWith(prefix)) continue;
      items.push({
        uid: rec.uid, ts: rec.mtime, folder: false, path,
        relatedpath: "", size: rec.size, deleted: !!rec.deleted,
        device: rec.device || "", user: rec.user,
      });
    }
    items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const FileHistoryModal = ng03DefineSyncFileHistoryModal(host);
    const ti = ng03SyncI18n();
    new FileHistoryModal(this.app, this, items, ti.labelSettingFiles ? ti.labelSettingFiles() : "Setting files").open();
  };

  proto.showSyncLog = async function () {
    const server = await this.getServer();
    if (!this.vaultId || !server) { this.openSettings(); return; }
    const SyncLogModal = ng03DefineSyncLogModal(host);
    new SyncLogModal(this.app, this).open();
  };

  proto.openSettings = function () {
    const setting = this.app.setting;
    if (setting && setting.open) setting.open();
    if (setting && setting.openTabById) {
      try { setting.openTabById("sync"); } catch (e) { /* ignore */ }
    }
  };

  proto.openChooseRemoteVaultModal = function () {
    const RemoteVaultsModal = ng03DefineSyncRemoteVaultsModal(host);
    new RemoteVaultsModal(this.app, this).open();
  };

  proto.size = async function () {
    const server = this.server || (await this.getServer());
    if (!server || !server.size) return { size: -1, limit: -1, vault_size: -1 };
    try {
      return await server.size();
    } catch (error) {
      return { size: -1, limit: -1, vault_size: -1 };
    }
  };

  proto.purge = async function () {
    const server = await this.getServer();
    if (!server) throw new Error("Sync is not connected");
    return server.purge();
  };

  proto.getUsernames = async function () {
    const server = await this.getServer();
    if (!server) return {};
    return server.getUsernames();
  };

  // ---- vault setup ---------------------------------------------------------------------

  proto.setVaultName = function (name) {
    this.vaultName = name;
    this.forceSaveData();
  };

  proto.setRemoteVaultName = function (name) {
    this.vaultName = name;
    this.saveData();
  };

  proto.getRemoteVaultId = function () { return this.vaultId; };
  proto.getRemoteVaultName = function () { return this.vaultName; };

  proto.setup = async function (vaultId, vaultName, password, salt, hostName, encryptionVersion) {
    this.vaultId = vaultId;
    this.vaultName = vaultName;
    this.salt = salt;
    this.host = hostName;
    this.encryptionVersion = encryptionVersion;
    this.key = await deriveScryptKey(password, salt);
    this.clear();
    await this.scanFiles();
    this.forceSaveData();
    this.requestSync();
  };

  proto.unsetup = function () {
    this.vaultId = null;
    this.vaultName = null;
    this.key = null;
    this.salt = "";
    this.host = "";
    this.deviceName = "";
    this.encryptionVersion = -1;
    this.userId = -1;
    this.clear();
    this.setStatus("Uninitialized");
    this.saveData();
  };

  proto.clear = function () {
    this.dirty = true;
    this.version = 0;
    this.initial = true;
    this.serverFiles = {};
    this.newServerFiles = [];
    this.fileRetry = {};
    this.ignoreFolders = [];
    this.filterCache = {};
    this.skippedFiles = {};
    this.allowTypes = ng03DefaultTypes();
    this.allowSpecialFiles = ng03DefaultSpecials();
    this.encryptionProvider = null;
    if (this.server) {
      try { this.server.disconnect(); } catch (e) { /* ignore */ }
      this.server = null;
    }
    this.gettingServer = null;
    this.backoff.success();
  };

  proto.connectToVault = function (vault) {
    // obsidian://sync-setup?vault=<json>
    try {
      const data = typeof vault === "string" ? JSON.parse(vault) : vault;
      const ConnectVaultModal = ng03DefineSyncConnectVaultModal(host);
      new ConnectVaultModal(this.app, this).connect(data);
    } catch (error) {
      console.error("connectToVault failed", error);
    }
  };

  // ---- system info ----------------------------------------------------------------------

  proto.gatherSyncSystemInfo = function () {
    const lines = ["SYNC INFO:"];
    lines.push("Vault ID: " + (this.vaultId || ""));
    lines.push("Host: " + this.getHost());
    lines.push("Device name: " + this.deviceName);
    lines.push("Encryption version: " + this.encryptionVersion);
    lines.push("Allowed types: " + [...this.allowTypes].join(", "));
    lines.push("Allowed special types: " + [...this.allowSpecialFiles].join(", "));
    if (this.ignoreFolders.length) {
      lines.push("Ignored directories:");
      for (const folder of this.ignoreFolders) lines.push("- " + folder);
    }
    if (host.Platform.isMobileApp && this.preventSleep) lines.push("Prevent sleep: on");
    try {
      const plugins = this.app.plugins && this.app.plugins.plugins;
      if (plugins) {
        const names = Object.keys(plugins).filter((id) => plugins[id] && plugins[id].enabled !== false);
        lines.push("Plugins (" + names.length + "):");
        for (const id of names.slice(0, 50)) {
          const p = plugins[id];
          lines.push("- " + (p.manifest && p.manifest.name || id) + " v" + (p.manifest && p.manifest.version || "?"));
        }
      }
    } catch (e) { /* ignore */ }
    const recent = this.syncLog.slice(-20);
    for (const entry of recent) {
      lines.push(ng03FmtTs(entry.ts) + " " + (entry.error ? "Error" : "Info") + "  " + entry.info + (entry.file ? " - " + entry.file : ""));
    }
    try {
      const sys = env().oD ? env().oD() : "";
      if (sys) lines.unshift(sys);
    } catch (e) { /* ignore */ }
    return lines.join("\n");
  };

  // ---- CLI ---------------------------------------------------------------------------------

  proto._registerCli = function (plugin) {
    const self = this;
    plugin.registerCliHandler("sync", "Pause or resume sync", {
      on: { description: "Resume sync" },
      off: { description: "Pause sync" },
    }, async (args) => {
      if (args.on !== undefined && args.off === undefined) {
        if (!self.pause) return "Sync is already running.";
        self.setPause(false);
        self.requestSync();
        return "Sync resumed.";
      }
      if (args.off !== undefined && args.on === undefined) {
        if (self.pause) return "Sync is already paused.";
        self.setPause(true);
        return "Sync is paused.";
      }
      if (args.on !== undefined || args.off !== undefined) throw "Usage: sync [on|off]";
      return self.pause ? "Sync is paused." : "Sync is running.";
    });

    const assertLive = async () => {
      const status = self.getStatus();
      if (status === "uninitialized" || status === "disconnected") throw "Sync is not set up.";
      if (status === "paused") throw "Sync is paused.";
      if (status === "error") throw "Sync is in an error state.";
    };
    const resolveTarget = async (args) => {
      let path = args.path;
      if (!path && args.file) {
        const file = self.app.cli.tryResolveFile(args);
        path = file ? file.path : null;
      }
      if (!path) throw "No file specified";
      return path;
    };
    const fileOpts = {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
    };
    const fmtItem = (i, item) => {
      let line = i + ": " + ng03FmtTs(item.ts || 0) + " (" + (item.size || 0) + " bytes)";
      if (item.device) line += " [" + item.device + "]";
      if (item.deleted) line += " deleted";
      if (item.relatedpath) line += " (renamed from " + item.relatedpath + ")";
      return line;
    };

    plugin.registerCliHandler("sync:history", "Show version history of a file", {
      ...fileOpts,
      total: { description: "Only print the number of versions" },
    }, async (args) => {
      await assertLive();
      const path = await resolveTarget(args);
      const result = await self.getHistory(path);
      const items = (result && result.items) || [];
      if (args.total) return String(items.length) + ((result && result.more) ? "+" : "");
      const lines = items.map((item, i) => fmtItem(i, item));
      if (result && result.more) lines.push("(more history available)");
      return lines.join("\n");
    });

    plugin.registerCliHandler("sync:read", "Print a version of a file", {
      ...fileOpts,
      version: { value: "<n>", description: "Version index", required: true },
    }, async (args) => {
      await assertLive();
      const path = await resolveTarget(args);
      const version = parseInt(args.version, 10);
      if (isNaN(version) || version < 0) throw "Invalid version: " + args.version;
      const result = await self.getHistory(path);
      const items = (result && result.items) || [];
      if (version >= items.length) throw "Version not found. Valid range: 0-" + Math.max(0, items.length - 1);
      const item = items[version];
      const data = await self.getContentForVersion(item.uid);
      const content = data == null ? "" : utf8String(data.buffer || data);
      return path + " (version " + version + ", " + ng03FmtTs(item.ts || 0) + ")\n---\n" + content;
    });

    plugin.registerCliHandler("sync:restore", "Restore a version of a file", {
      ...fileOpts,
      version: { value: "<n>", description: "Version index", required: true },
    }, async (args) => {
      await assertLive();
      const path = await resolveTarget(args);
      const version = parseInt(args.version, 10);
      if (isNaN(version) || version < 0) throw "Invalid version: " + args.version;
      if (version === 0) throw "Cannot restore the current version.";
      const result = await self.getHistory(path);
      const items = (result && result.items) || [];
      if (version >= items.length) throw "Version not found. Valid range: 0-" + Math.max(0, items.length - 1);
      const item = items[version];
      await self.restoreVersion(item.uid, path);
      return "Restored " + path + " to version " + version;
    });

    plugin.registerCliHandler("sync:open", "Open version history of a file", {
      ...fileOpts,
    }, async (args) => {
      await assertLive();
      const path = await resolveTarget(args);
      self.showVersionHistory(path);
      return "Opened sync history for " + path;
    });

    plugin.registerCliHandler("sync:deleted", "List remotely deleted files", {
      total: { description: "Only print the number of deleted files" },
    }, async (args) => {
      await assertLive();
      const server = await self.getServer();
      const items = server ? await server.listDeleted() : [];
      const sorted = (items || []).slice().reverse();
      if (args.total) return String(sorted.length);
      return sorted.map((item) => {
        let line = ng03FmtTs(item.ts || 0) + ": " + item.path + " (" + (item.size || 0) + " bytes)";
        if (item.device) line += " [" + item.device + "]";
        return line;
      }).join("\n");
    });

    plugin.registerCliHandler("sync:status", "Show sync status", {}, async () => {
      const lines = ["status: " + self.getStatus()];
      if (self.vaultId) {
        lines.push("vault: " + (self.vaultName || ""));
        lines.push("device: " + self.deviceName);
        const size = await self.size();
        lines.push("vault size: " + formatBytes(size && size.vault_size > 0 ? size.vault_size : size && size.size));
        lines.push("account usage: " + formatBytes(size && size.size) + " / " + formatBytes(size && size.limit));
      } else {
        lines.push("Sync is not set up.");
      }
      return lines.join("\n");
    });
  };

  return SyncPlugin;
}
