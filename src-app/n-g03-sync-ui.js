// g03 clean-room: Basalt Sync settings tab, dialogs and views (s15 slice).
// Independent reimplementation per specs/g03.md section 3.12-3.22.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { extensionOf, baseName, withoutExtension, withoutMd, parentPath } from "./path.js";
import { formatBytes } from "./text.js";
import { utf8String, utf8Bytes, encodeBase64, decodeBase64 } from "./vault-crypto.js";
import { account, AccountError, acctRequest, acctUserInfo, acctListVaults, acctListSubscriptions, acctVaultRegions, acctCreateVault, acctMigrateVault, acctRenameVault, acctDeleteVault, acctListVaultShares, acctInviteVaultShare, acctRemoveVaultShare } from "./account.js";
import { deriveScryptKey, deriveVaultKeyhash, randomSaltHex } from "./vault-crypto.js";

const SYNC_HOUR_MS = 3600000;
const AVATAR_COLORS = [
  "mod-avatar-color-1", "mod-avatar-color-2", "mod-avatar-color-3", "mod-avatar-color-4",
  "mod-avatar-color-5", "mod-avatar-color-6", "mod-avatar-color-7", "mod-avatar-color-8",
];

function ng03Ti() { return env().gm.plugins.sync; }
function ng03Ii() { return env().gm.interface; }
function ng03Nouns() { return env().gm.nouns; }
function ng03Moment(ts) { return window.moment ? window.moment(ts) : null; }
function ng03FromNow(ts) { const m = ng03Moment(ts); return m ? m.fromNow() : ""; }
function ng03Llll(ts) { const m = ng03Moment(ts); return m ? m.format("LLLL") : ""; }
function ng03UiFmtTs(ts) {
  const m = ng03Moment(ts);
  return m ? m.format("YYYY-MM-DD HH:mm") : "";
}
function ng03Copy(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      return;
    }
  } catch (e) { /* ignore */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  } catch (e) { /* ignore */ }
}
function ng03ExtHas(set, ext) {
  if (!set) return false;
  if (typeof set.contains === "function") return set.contains(ext);
  if (typeof set.includes === "function") return set.includes(ext);
  if (typeof set.has === "function") return set.has(ext);
  return false;
}
function ng03MediaExts(kind) {
  const map = { image: host0Image(), audio: host0Audio(), video: host0Video(), pdf: host0Pdf() };
  return map[kind] || [];
}
function host0Image() { return env().Vy || []; }
function host0Audio() { return env().Hy || []; }
function host0Video() { return env().zy || []; }
function host0Pdf() { return env().qy || []; }
function host0Markdown() { return env().jy || []; }
function host0Text() { return env()._y || env().Wy || env().Uy || []; }

/** O9: attach a load-more callback when the element is scrolled near its bottom. */
export function ng03ScrollLoadMore(el, cb) {
  let scheduled = false;
  const check = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (!el.isConnected) return;
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remaining <= el.clientHeight / 2) cb();
    }, 30);
  };
  el.addEventListener("scroll", check);
}

export const ng03AvatarColorClasses = AVATAR_COLORS.slice();
export const ng03SyncHourMs = SYNC_HOUR_MS;

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

function ng03HistoryItemTitle(item) {
  return withoutExtension ? baseName(item.path) : item.path;
}

function ng03CreateAvatar(item, sync) {
  const el = createDiv("mod-avatar");
  const name = item.username || item.email || "";
  const isCurrent = sync && sync.userId != null && item.user != null && item.user === sync.userId && !name;
  let initials = "?";
  if (name) {
    const parts = name.trim().split(/\s+/);
    initials = parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("");
  }
  el.setText(initials || "?");
  if (name && (item.username || item.email)) {
    el.addClass("mod-avatar-current-user");
  } else {
    let sum = 0;
    const src = name || item.device || item.path || "";
    for (let i = 0; i < src.length; i++) sum += src.charCodeAt(i);
    el.addClass(AVATAR_COLORS[sum % AVATAR_COLORS.length]);
  }
  return el;
}

// ---------------------------------------------------------------------------
// SyncSettingsView (P9)
// ---------------------------------------------------------------------------

export function ng03DefineSyncSettingsView(host) {
  function SyncSettingsView(app, sync, wrapper) {
    const self = host.PluginInstanceSettingTab
      ? host.PluginInstanceSettingTab.call(this, app, wrapper || sync) || this
      : host.SettingTab.call(this, app, app.setting) || this;
    self.sync = sync;
    self.plugin = sync;
    self.id = "sync";
    self.name = (env().gm.plugins.sync && env().gm.plugins.sync.name) ? env().gm.plugins.sync.name() : "Sync";
    return self;
  }
  inherit(SyncSettingsView, host.PluginInstanceSettingTab || host.SettingTab);
  const proto = SyncSettingsView.prototype;

  proto.displayInitializing = function () {
    const el = this.containerEl;
    el.empty();
    const ti = ng03Ti();
    el.createDiv("setting-item", (item) => {
      item.createDiv("setting-item-info", (info) => {
        info.createDiv("setting-item-name").setText(ti.labelSyncLoading ? ti.labelSyncLoading() : "Loading…");
      });
      item.createDiv("setting-item-control", (control) => {
        const btn = control.createEl("button", { text: "Refresh" });
        btn.addEventListener("click", () => this.display());
      });
    });
  };

  proto.displayRequireLogin = function () {
    const el = this.containerEl;
    el.empty();
    const ti = ng03Ti();
    const ii = ng03Ii();
    el.createDiv("setting-item", (item) => {
      const info = item.createDiv("setting-item-info");
      info.createDiv("setting-item-name").setText(ti.labelSyncIntroduction ? ti.labelSyncIntroduction() : "Basalt Sync");
      info.createDiv("setting-item-description").setText(ti.labelAccountRequired ? ti.labelAccountRequired() : "An account is required.");
      const control = item.createDiv("setting-item-control");
      const login = control.createEl("button", { cls: "mod-cta", text: ii.logIn ? ii.logIn() : "Log in" });
      login.addEventListener("click", () => {
        const LoginModal = env().R7;
        if (LoginModal) {
          const modal = new LoginModal(this.app);
          const oldClose = modal.onClose && modal.onClose.bind(modal);
          modal.onClose = () => { if (oldClose) oldClose(); this.display(); };
          modal.open();
        }
      });
    });
  };

  proto.manageExclusions = function () {
    const Suggest = ng03DefineSyncExcludedFoldersSuggest(host);
    new Suggest(this.app, this.sync).open();
  };

  proto.gatherSyncSystemInfo = function () {
    return this.sync.gatherSyncSystemInfo ? this.sync.gatherSyncSystemInfo() : "";
  };

  proto.display = async function () {
    const sync = this.sync;
    const el = this.containerEl;
    el.empty();
    const ii = ng03Ii();
    const ti = ng03Ti();

    if (host.Platform && host.Platform.supportsIndexedDb === false) {
      const group = new host.SettingGroup(el);
      group.setHeading(ii.msgIndexedDbNotSupported ? ii.msgIndexedDbNotSupported() : "IndexedDB not supported");
      group.addSetting((s) => s.setDesc(ii.msgIndexedDbIOS ? ii.msgIndexedDbIOS() : ""));
      return;
    }
    if (!sync.initialized) { this.displayInitializing(); return; }
    if (!account.token) { this.displayRequireLogin(); return; }

    // third-party storage warnings
    const warnings = this._thirdPartyWarnings();
    if (warnings.length) {
      const group = new host.SettingGroup(el);
      group.setHeading(ti.labelThirdPartySyncWarning ? ti.labelThirdPartySyncWarning() : "Warning");
      for (const service of warnings) {
        group.addSetting((s) => {
          s.setName(ti.labelThirdPartySyncWarningDesc ? ti.labelThirdPartySyncWarningDesc({ service }) : service);
          s.addButton((b) => b.setButtonText("Learn more").onClick(() => {
            window.open("https://github.com/FalconTechDev/basalt", "_blank");
          }));
        });
      }
    }

    // main remote-vault group
    const group = new host.SettingGroup(el);
    const connected = !!sync.vaultId;
    group.setHeading(ti.optionRemoteVault ? ti.optionRemoteVault() : "Remote vault");
    group.addSetting((s) => {
      s.setName(ti.optionRemoteVault ? ti.optionRemoteVault() : "Remote vault");
      s.setDesc(connected
        ? (ti.optionRemoteVaultDescConnected ? ti.optionRemoteVaultDescConnected({ name: sync.vaultName }) : sync.vaultName)
        : (ti.optionRemoteVaultDescNotConnected ? ti.optionRemoteVaultDescNotConnected() : "Not connected"));
      if (sync.vaultName) {
        s.addButton((b) => b.setButtonText(ti.buttonDisconnectFromRemoteVault ? ti.buttonDisconnectFromRemoteVault() : "Disconnect")
          .setDestructive()
          .onClick(async () => { sync.unsetup(); this.display(); }));
      }
      s.addButton((b) => b.setButtonText(connected
          ? (ti.buttonManageRemoteVault ? ti.buttonManageRemoteVault() : "Manage")
          : (ti.buttonChooseRemoteVault ? ti.buttonChooseRemoteVault() : "Choose"))
        .setCta()
        .onClick(() => sync.openChooseRemoteVaultModal()));
    });

    if (connected) {
      // status row
      group.addSetting((s) => {
        s.setName(ti.optionSyncStatus ? ti.optionSyncStatus() : "Sync status");
        if (sync.pause) {
          s.setDesc(ti.optionSyncStatusDescPaused ? ti.optionSyncStatusDescPaused() : "Paused");
          s.addButton((b) => b.setButtonText(ti.buttonResume ? ti.buttonResume() : "Resume").setCta()
            .onClick(() => { sync.setPause(false); sync.requestSync(); this.display(); }));
        } else {
          s.setDesc(ti.optionSyncStatusDescRunning ? ti.optionSyncStatusDescRunning() : "Running");
          s.addButton((b) => b.setButtonText(ti.buttonPause ? ti.buttonPause() : "Pause")
            .onClick(() => { sync.setPause(true); this.display(); }));
        }
      });
      // encryption upgrade
      if (sync.encryptionVersion !== -1 && sync.encryptionVersion < 3) {
        group.addSetting((s) => {
          s.setName(ti.optionEncryption ? ti.optionEncryption() : "Encryption");
          s.addButton((b) => b.setButtonText(ti.buttonUpgradeEncryption ? ti.buttonUpgradeEncryption() : "Upgrade")
            .onClick(() => {
              const M = ng03DefineSyncUpgradeEncryptionModal(host);
              new M(this.app, sync).open();
            }));
        });
      }
      // device name
      group.addSetting((s) => {
        s.setName(ti.optionDeviceName ? ti.optionDeviceName() : "Device name");
        s.addText((t) => {
          t.setPlaceholder(sync.getDefaultDeviceName());
          t.setValue(sync.deviceName || "");
          t.onChange((v) => { sync.deviceName = v; sync.forceSaveData(); });
        });
      });
      // conflict handling
      group.addSetting((s) => {
        s.setName(ti.optionConflictHandling ? ti.optionConflictHandling() : "Conflict handling");
        s.addDropdown((d) => {
          d.addOption("merge", ti.optionAutomaticMerge ? ti.optionAutomaticMerge() : "Automatic merge");
          d.addOption("conflict", ti.optionConflictFile ? ti.optionConflictFile() : "Conflicted copy");
          d.setValue(sync.conflictAction === "conflict" ? "conflict" : "merge");
          d.onChange((v) => { if (v === "merge" || v === "conflict") { sync.conflictAction = v; sync.forceSaveData(); } });
        });
      });
      // deleted files + log
      group.addSetting((s) => {
        s.setName(ti.optionDeletedFiles ? ti.optionDeletedFiles() : "Deleted files");
        s.addButton((b) => b.setButtonText(ti.buttonView ? ti.buttonView() : "View").onClick(() => sync.showDeletedFiles()));
        s.addButton((b) => b.setButtonText(ti.buttonBulkRestore ? ti.buttonBulkRestore() : "Bulk restore").onClick(() => sync.showDeletedFiles(true)));
      });
      group.addSetting((s) => {
        s.setName(ti.optionSyncLog ? ti.optionSyncLog() : "Sync log");
        s.addButton((b) => b.setButtonText(ti.buttonView ? ti.buttonView() : "View").onClick(() => sync.showSyncLog()));
      });
      // vault size
      group.addSetting((s) => {
        s.setName(ti.optionVaultSize ? ti.optionVaultSize() : "Vault size");
        s.setDesc(ti.optionVaultSizeLoading ? ti.optionVaultSizeLoading() : "Loading…");
        s.addProgressBar((p) => { p.setValue(0); });
        sync.size().then((size) => {
          const pct = size && size.limit > 0 ? Math.min(100, (size.size / size.limit) * 100) : 0;
          s.setDesc(size && (size.size === -1 || size.limit === -1)
            ? (ti.optionVaultSizeUnknown ? ti.optionVaultSizeUnknown() : "Unknown")
            : (ti.optionVaultSizeDesc ? ti.optionVaultSizeDesc({ size: formatBytes(size.size), limit: formatBytes(size.limit) }) : formatBytes(size.size)));
          const bar = s.components.map((c) => c.progressBar).find(Boolean);
          if (bar) bar.style.width = pct + "%";
        }).catch(() => {});
      });
      if (host.Platform.isMobileApp) {
        group.addSetting((s) => {
          s.setName(ti.optionPreventSleep ? ti.optionPreventSleep() : "Prevent sleep");
          s.addToggle((t) => {
            t.setValue(sync.preventSleep);
            t.onChange((v) => { sync.preventSleep = v; sync.forceSaveData(); });
          });
        });
      }
      // support row
      group.addSetting((s) => {
        s.setName(ti.optionSupport ? ti.optionSupport() : "Support");
        s.addButton((b) => b.setButtonText(ti.buttonCopyDebug ? ti.buttonCopyDebug() : "Copy debug info")
          .onClick(() => {
            ng03Copy(sync.gatherSyncSystemInfo());
            new host.Notice(ii.copied_generic ? ii.copied_generic() : "Copied");
          }));
        s.addButton((b) => b.setButtonText(ti.buttonEmailSupport ? ti.buttonEmailSupport() : "Email support")
          .onClick(() => window.open("https://github.com/FalconTechDev/basalt/issues", "_blank")));
      });
    }

    // selective sync group
    const sel = new host.SettingGroup(el);
    sel.setHeading(ti.optionSelectiveSync ? ti.optionSelectiveSync() : "Selective sync");
    sel.addSetting((s) => {
      s.setName(ti.optionExcludedFolders ? ti.optionExcludedFolders() : "Excluded folders");
      const desc = (ti.optionExcludedFolderDesc ? ti.optionExcludedFolderDesc() : "") + "\n" +
        (ti.optionCurrentlyExcludedFolders ? ti.optionCurrentlyExcludedFolders() : "");
      s.setDesc(desc + (sync.ignoreFolders.length ? "\n" + sync.ignoreFolders.map((f) => "- " + f).join("\n") : ""));
      s.addButton((b) => b.setButtonText(ti.buttonManageExcludedFolders ? ti.buttonManageExcludedFolders() : "Manage")
        .onClick(() => this.manageExclusions()));
    });
    const types = ["image", "audio", "video", "pdf", "unsupported"];
    for (const type of types) {
      const key = "option-sync-" + type;
      sel.addSetting((s) => {
        s.setName(ti[key] ? ti[key]() : type);
        const descKey = key + "-desc";
        const exts = type === "image" ? host.imageExtensions : type === "audio" ? host.audioExtensions
          : type === "video" ? host.videoExtensions : type === "pdf" ? host.pdfExtensions : null;
        const extList = exts ? [...(exts.values ? exts.values() : exts)] : [];
        s.setDesc(ti[descKey] ? ti[descKey]({ extensions: extList.join(", ") }) : "");
        let changed = false;
        const extra = s.addExtraButton((b) => {
          b.setIcon("lucide-alert-circle");
          b.extraSettingsEl.hide();
          b.setTooltip(ti["tooltipUpdateSettingOnAllDevices"] ? ti.tooltipUpdateSettingOnAllDevices() : "");
        });
        s.addToggle((t) => {
          t.setValue(sync.allowTypes.has(type));
          t.onChange((v) => {
            changed = true;
            extra.extraSettingsEl.show();
            sync.setSyncType(type, v);
          });
        });
      });
    }

    // vault config group
    const cfg = new host.SettingGroup(el);
    cfg.setHeading(ti.optionVaultConfigSync ? ti.optionVaultConfigSync() : "Vault config sync");
    cfg.addSetting((s) => {
      s.setName(ti.optionViewConfigFiles ? ti.optionViewConfigFiles() : "Config files");
      s.addButton((b) => b.setButtonText(ti.buttonView ? ti.buttonView() : "View").onClick(() => sync.showConfigFiles()));
    });
    const specials = ["app", "appearance", "appearance-data", "hotkey", "core-plugin", "core-plugin-data", "community-plugin", "community-plugin-data"];
    for (const type of specials) {
      const key = "option-sync-" + type;
      cfg.addSetting((s) => {
        s.setName(ti[key] ? ti[key]() : type);
        const extra = s.addExtraButton((b) => {
          b.setIcon("lucide-alert-circle");
          b.extraSettingsEl.hide();
          b.setTooltip(ti.tooltipUpdateSettingOnAllDevices ? ti.tooltipUpdateSettingOnAllDevices() : "");
        });
        s.addToggle((t) => {
          t.setValue(sync.allowSpecialFiles.has(type));
          t.onChange((v) => {
            extra.extraSettingsEl.show();
            sync.setAllowSpecialFile(type, v);
          });
        });
      });
    }
  };

  proto._thirdPartyWarnings = function () {
    const out = [];
    try {
      const adapter = this.app.vault.adapter;
      const base = adapter && adapter.getBasePath ? adapter.getBasePath() : "";
      const lower = String(base).toLowerCase();
      if (lower.includes("dropbox")) out.push("Dropbox");
      if (lower.includes("com~apple~clouddocs") || lower.includes("icloud~")) out.push("iCloud");
      if (lower.includes("onedrive")) out.push("OneDrive");
      if (adapter && adapter.fs && adapter.fs.dir === "ICLOUD") out.push("iCloud");
      if (host.Platform.isMacOS && (lower.includes("/documents") || lower.includes("/desktop"))) {
        // second warning handled by caller via iCloudDriveWarning; approximate with iCloud
      }
    } catch (e) { /* ignore */ }
    return [...new Set(out)];
  };

  return SyncSettingsView;
}

// ---------------------------------------------------------------------------
// FileHistoryModal (F9) — paginated version list
// ---------------------------------------------------------------------------

export function ng03DefineSyncFileHistoryModal(host) {
  const BATCH = 30;

  function FileHistoryModal(app, sync, items, title) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    self.items = (items || []).filter((item) => !item.folder);
    self.title = title || "";
    self.rendered = 0;
    self.loading = false;
    return self;
  }
  inherit(FileHistoryModal, host.Modal);
  const proto = FileHistoryModal.prototype;

  proto.onOpen = function () {
    const ti = ng03Ti();
    this.titleEl.setText(this.title);
    this.modalEl.addClass("mod-lg");
    const header = this.contentEl.createDiv("sync-modal-header");
    const nouns = ng03Nouns();
    header.createDiv("sync-modal-header-title").setText(
      (nouns && nouns.fileWithCount ? nouns.fileWithCount({ count: this.items.length }) : this.items.length + " files") +
      " — " + (ti.labelClickToSeeHistory ? ti.labelClickToSeeHistory() : "click to see history"));
    this.listEl = this.contentEl.createDiv("sync-file-tree-container");
    this._renderBatch();
    const self = this;
    ng03ScrollLoadMore(this.listEl, () => self._renderBatch());
  };

  proto._renderBatch = function () {
    if (this.loading) return;
    const end = Math.min(this.rendered + BATCH, this.items.length);
    if (end <= this.rendered) return;
    for (let i = this.rendered; i < end; i++) {
      const item = this.items[i];
      const row = this.listEl.createDiv("list-item mod-selectable tappable");
      const part = row.createDiv("list-item-part mod-extended");
      const title = part.createDiv("list-item-part title");
      title.setText(withoutMd(item.path));
      const meta = part.createDiv("list-item-part multiline");
      let text = "";
      if (item.device) text += "[" + item.device + "] ";
      text += ng03FromNow(item.ts || 0);
      if (item.deleted) text += " (deleted)";
      meta.setText(text);
      meta.addClass("u-muted");
      row.addEventListener("click", () => {
        this.sync.showVersionHistory(item.path);
      });
    }
    this.rendered = end;
  };

  return FileHistoryModal;
}

// ---------------------------------------------------------------------------
// DeletedFilesModal (N9) — checkboxes + bulk restore
// ---------------------------------------------------------------------------

export function ng03DefineSyncDeletedFilesModal(host) {
  const BATCH = 30;

  function DeletedFilesModal(app, sync, items) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    self.items = (items || []).filter((item) => !item.folder);
    self.selected = new Set();
    self.rendered = 0;
    self.restoring = false;
    return self;
  }
  inherit(DeletedFilesModal, host.Modal);
  const proto = DeletedFilesModal.prototype;

  proto.onOpen = function () {
    const ti = ng03Ti();
    this.titleEl.setText(ti.labelDeletedFiles ? ti.labelDeletedFiles() : "Deleted files");
    this.modalEl.addClass("mod-lg", "mod-scrollable-content");
    const header = this.contentEl.createDiv("sync-modal-header");
    const nouns = ng03Nouns();
    header.createDiv("sync-modal-header-title").setText(
      (nouns && nouns.fileWithCount ? nouns.fileWithCount({ count: this.items.length }) : this.items.length + " files") +
      " — " + (ti.labelClickToSeeHistory ? ti.labelClickToSeeHistory() : ""));
    this.listEl = this.contentEl.createDiv("sync-file-tree-container");
    this._renderBatch();
    const self = this;
    ng03ScrollLoadMore(this.listEl, () => self._renderBatch());

    const btnBar = this.modalEl.createDiv("modal-button-container");
    this.restoreBtn = btnBar.createEl("button", { cls: "mod-cta" });
    this.cancelBtn = btnBar.createEl("button", { text: ng03Ii().cancel ? ng03Ii().cancel() : "Cancel" });
    this.cancelBtn.addEventListener("click", () => this.close());
    this._updateRestoreButton();
    this.restoreBtn.addEventListener("click", () => this._restore());
  };

  proto._updateRestoreButton = function () {
    const ti = ng03Ti();
    const count = this.selected.size;
    const label = ti.buttonRestoreFiles ? ti.buttonRestoreFiles({ count }) : "Restore files (" + count + ")";
    this.restoreBtn.setText(label);
    if (count > 0) this.restoreBtn.removeAttribute("aria-disabled");
    else this.restoreBtn.setAttribute("aria-disabled", "true");
  };

  proto._scheduleButtonUpdate = function () {
    setTimeout(() => this._updateRestoreButton(), 5);
  };

  proto._renderBatch = function () {
    const end = Math.min(this.rendered + BATCH, this.items.length);
    if (end <= this.rendered) return;
    for (let i = this.rendered; i < end; i++) {
      const item = this.items[i];
      const row = this.listEl.createDiv("list-item mod-selectable tappable");
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selected.has(item.path);
      const part = row.createDiv("list-item-part mod-extended");
      part.createDiv("list-item-part title").setText(withoutMd(item.path));
      const meta = part.createDiv("list-item-part multiline");
      let text = "";
      if (item.device) text += "[" + item.device + "] ";
      text += ng03FromNow(item.ts || 0);
      meta.setText(text);
      meta.addClass("u-muted");

      const toggle = (state) => {
        if (state) this.selected.add(item.path); else this.selected.delete(item.path);
        this._scheduleButtonUpdate();
      };
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => toggle(checkbox.checked));
      row.addEventListener("click", () => {
        checkbox.checked = !checkbox.checked;
        toggle(checkbox.checked);
      });
    }
    this.rendered = end;
  };

  proto._restore = async function () {
    if (this.restoring || !this.selected.size) return;
    const ti = ng03Ti();
    this.restoring = true;
    this.restoreBtn.setAttribute("aria-disabled", "true");
    const paths = [...this.selected];
    let done = 0, succeeded = 0, failed = 0;
    const progress = new host.Notice(ti.msgRestoring ? ti.msgRestoring({ done: 0, total: paths.length }) : "Restoring 0/" + paths.length, 0);
    for (const path of paths) {
      try {
        const history = await this.sync.getHistory(path);
        const items = (history && history.items) || [];
        const target = items.find((item) => !item.deleted);
        if (target) {
          await this.sync.restoreVersion(target.uid);
          succeeded++;
        } else failed++;
      } catch (e) { failed++; }
      done++;
      progress.setMessage(ti.msgRestoring ? ti.msgRestoring({ done, total: paths.length }) : "Restoring " + done + "/" + paths.length);
    }
    setTimeout(() => { try { progress.hide(); } catch (e) { /* ignore */ } }, 4000);
    new host.Notice(ti.msgRestoringComplete ? ti.msgRestoringComplete({ succeeded, failed }) : "Restored " + succeeded + ", failed " + failed);
    this.restoring = false;
    this.close();
  };

  return DeletedFilesModal;
}

// ---------------------------------------------------------------------------
// SyncLogModal (z9)
// ---------------------------------------------------------------------------

export function ng03DefineSyncLogModal(host) {
  function SyncLogModal(app, sync) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    self.filter = "all";
    self.query = "";
    self.rendered = 0;
    return self;
  }
  inherit(SyncLogModal, host.Modal);
  const proto = SyncLogModal.prototype;

  proto._entryText = function (entry) {
    return ng03UiFmtTs(entry.ts) + " - " + entry.info + (entry.file ? " " + entry.file : "");
  };

  proto._matches = function (entry) {
    if (this.filter === "errors" && !entry.error) return false;
    if (this.filter === "skipped" && entry.type !== "skip") return false;
    if (this.filter === "merge" && entry.type !== "merge") return false;
    if (this.query) {
      const hay = (entry.info + " " + (entry.file || "")).toLowerCase();
      if (hay.indexOf(this.query.toLowerCase()) < 0) return false;
    }
    return true;
  };

  proto.onOpen = function () {
    const ti = ng03Ti();
    const ii = ng03Ii();
    this.titleEl.setText(ti.labelSyncLog ? ti.labelSyncLog() : "Sync log");
    this.modalEl.addClass("mod-sync-log", "mod-lg");
    const toolbar = this.contentEl.createDiv("modal-toolbar");
    const select = toolbar.createEl("select", { cls: "dropdown" });
    const opts = [["all", ti.optionEventTypeAll ? ti.optionEventTypeAll() : "All"],
      ["errors", ti.optionEventTypeErrors ? ti.optionEventTypeErrors() : "Errors"],
      ["skipped", ti.optionEventTypeSkipped ? ti.optionEventTypeSkipped() : "Skipped"],
      ["merge", ti.optionEventTypeMerge ? ti.optionEventTypeMerge() : "Merge"]];
    for (const [value, label] of opts) {
      const o = select.createEl("option", { text: label });
      o.value = value;
    }
    select.value = this.filter;
    select.addEventListener("change", () => { this.filter = select.value; this._rerender(); });
    const search = toolbar.createEl("input", { type: "search", cls: "search-input" });
    search.placeholder = ii.promptFilter ? ii.promptFilter() : "Filter";
    search.addEventListener("input", () => { this.query = search.value; this._rerender(); });

    this.listEl = this.contentEl.createDiv("modal-list");
    this._renderAll();

    const self = this;
    this._onNewLog = () => { if (!self.win || self.win.document.contains(self.containerEl)) self._renderAll(); };
    this.sync.on("new-log", this._onNewLog);

    const btnBar = this.modalEl.createDiv("modal-button-container");
    const copyBtn = btnBar.createEl("button", { cls: "mod-cta", text: ti.buttonCopySyncLog ? ti.buttonCopySyncLog() : "Copy sync log" });
    copyBtn.addEventListener("click", () => {
      const text = this.sync.syncLog.map((e) => this._entryText(e)).join("\n");
      ng03Copy(text);
      new host.Notice(ti.msgSuccessfullyCopiedSyncLog ? ti.msgSuccessfullyCopiedSyncLog() : "Copied");
    });
    const doneBtn = btnBar.createEl("button", { text: ii.done ? ii.done() : "Done" });
    doneBtn.addEventListener("click", () => this.close());
  };

  proto.onClose = function () {
    if (this._onNewLog) this.sync.off("new-log", this._onNewLog);
  };

  proto._rerender = function () {
    this.listEl.empty();
    this.rendered = 0;
    this._renderAll();
  };

  proto._renderAll = function () {
    const entries = this.sync.syncLog.filter((e) => this._matches(e));
    for (const entry of entries) {
      const row = this.listEl.createDiv("list-item" + (entry.error ? " mod-error" : ""));
      row.setText(this._entryText(entry));
    }
    this.listEl.scrollTop = this.listEl.scrollHeight;
  };

  return SyncLogModal;
}

// ---------------------------------------------------------------------------
// RemoteVaultsModal (H9)
// ---------------------------------------------------------------------------

export function ng03DefineSyncRemoteVaultsModal(host) {
  function RemoteVaultsModal(app, sync, onDone) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    self.onDone = onDone;
    self.vaults = null;
    self.shared = null;
    self.limit = 0;
    return self;
  }
  inherit(RemoteVaultsModal, host.Modal);
  const proto = RemoteVaultsModal.prototype;

  proto.onOpen = function () { this._load(); };
  proto.onClose = function () {
    if (this.onDone) this.onDone();
    else if (this.sync.settingTab && this.sync.settingTab.display) {
      try { this.sync.settingTab.display(); } catch (e) { /* ignore */ }
    }
  };

  proto._load = async function () {
    const ti = ng03Ti();
    this.contentEl.empty();
    this.contentEl.createDiv("modal-loading" );
    try {
      const res = await acctListVaults(account.token);
      this.vaults = res.vaults || [];
      this.shared = res.shared || [];
      this.limit = res.limit || 0;
    } catch (error) {
      this._renderError(error);
      return;
    }
    this._render();
  };

  proto._renderError = function (error) {
    const ti = ng03Ti();
    this.contentEl.empty();
    const box = this.contentEl.createDiv("modal-error");
    box.createDiv().setText(ti.msgErrorFailedToFetch ? ti.msgErrorFailedToFetch() : "Failed to fetch");
    const btn = box.createEl("button", { text: ng03Ii().retry ? ng03Ii().retry() : "Retry" });
    btn.addEventListener("click", () => this._load());
  };

  proto._vaultRow = function (vault, isShared) {
    const ti = ng03Ti();
    const connected = this.sync.vaultId === vault.uid;
    const row = createDiv("list-item vault-list-item");
    row.createDiv("list-item-icon").appendChild((() => {
      const icon = createDiv("svg-icon");
      host.setIcon(icon, connected ? "open-vault" : "vault");
      return icon;
    })());
    const part = row.createDiv("list-item-part");
    const title = part.createDiv("list-item-part title" + (connected ? " is-connected" : ""));
    title.setText(vault.name || vault.uid);
    const desc = [];
    if (vault.region) desc.push(vault.region);
    if (vault.size != null) desc.push(formatBytes(vault.size));
    if (vault.created) desc.push(ti.labelVaultCreatedTime ? ti.labelVaultCreatedTime({ time: ng03FromNow(vault.created) }) : ng03FromNow(vault.created));
    part.createDiv("list-item-part description u-muted").setText(desc.join(" · "));

    const actions = row.createDiv("list-item-part list-item-action-icon");
    if (connected) {
      if (this.sync.vaultName !== vault.name) this.sync.setVaultName(vault.name);
    }
    if (!isShared && !connected) {
      const del = actions.createDiv("clickable-icon");
      host.setIcon(del, "trash-2");
      del.addEventListener("click", async () => {
        const ok = await this._confirmDelete(vault);
        if (!ok) return;
        try {
          await acctDeleteVault(account.token, vault.uid);
          new host.Notice(ti.msgRemoteVaultDeleted ? ti.msgRemoteVaultDeleted({ name: vault.name }) : "Deleted");
          this._load();
        } catch (e) {
          new host.Notice(e && e.message || String(e));
        }
      });
      const ren = actions.createDiv("clickable-icon");
      host.setIcon(ren, "pencil");
      ren.addEventListener("click", () => {
        const M = ng03DefineSyncRenameVaultModal(host);
        new M(this.app, vault.name || "", async (name) => {
          if (!name || name === vault.name) return;
          try {
            await acctRenameVault(account.token, vault.uid, name);
            if (connected) this.sync.setRemoteVaultName(name);
            this._load();
          } catch (e) { new host.Notice(e && e.message || String(e)); }
        }).open();
      });
      const share = actions.createDiv("clickable-icon");
      host.setIcon(share, "users");
      share.addEventListener("click", () => {
        const M = ng03DefineSyncManageSharingModal(host);
        new M(this.app, this.sync, vault).open();
      });
    }
    if (isShared) {
      const leave = actions.createDiv("clickable-icon");
      host.setIcon(leave, "log-out");
      leave.addEventListener("click", async () => {
        const ok = await this._confirmLeave(vault);
        if (!ok) return;
        try {
          await acctRemoveVaultShare(account.token, vault.uid, vault.share_uid || vault.uid);
          if (connected) this.sync.unsetup();
          this._load();
        } catch (e) { new host.Notice(e && e.message || String(e)); }
      });
    }
    if (!connected && !isShared) {
      const connectBtn = actions.createEl("button", { text: ti.buttonConnect ? ti.buttonConnect() : "Connect" });
      connectBtn.addEventListener("click", async () => {
        try {
          const subs = await acctListSubscriptions(account.token);
          if (!subs || !subs.sync) {
            const err = this.contentEl.createDiv("modal-error");
            err.setText(ti.labelRequireSubscriptionToConnect ? ti.labelRequireSubscriptionToConnect() : "Subscription required");
            return;
          }
          const M = ng03DefineSyncConnectVaultModal(host);
          new M(this.app, this.sync, () => this.close()).connect(vault);
        } catch (e) {
          new host.Notice(e && e.message || String(e));
        }
      });
    }
    if (isShared && !connected) {
      const connectBtn = actions.createEl("button", { text: ti.buttonConnect ? ti.buttonConnect() : "Connect" });
      connectBtn.addEventListener("click", async () => {
        try {
          const subs = await acctListSubscriptions(account.token);
          if (!subs || !subs.sync) {
            const err = this.contentEl.createDiv("modal-error");
            err.setText(ti.labelRequireSubscriptionToConnect ? ti.labelRequireSubscriptionToConnect() : "Subscription required");
            return;
          }
          const M = ng03DefineSyncConnectVaultModal(host);
          new M(this.app, this.sync, () => this.close()).connect(vault);
        } catch (e) {
          new host.Notice(e && e.message || String(e));
        }
      });
    }
    return row;
  };

  proto._confirmDelete = function (vault) {
    const ti = ng03Ti();
    return new Promise((resolve) => {
      const modal = new host.Modal(this.app);
      modal.titleEl.setText(ti.labelConfirmDeleteRemoteVault ? ti.labelConfirmDeleteRemoteVault() : "Delete remote vault?");
      modal.modalEl.addClass("mod-warning");
      const c = modal.contentEl;
      c.createDiv().setText(ti.msgConfirmDeleteRemoteVaultPart1 ? ti.msgConfirmDeleteRemoteVaultPart1({ name: vault.name }) : "");
      c.createDiv().setText(ti.msgConfirmDeleteRemoteVaultPart2 ? ti.msgConfirmDeleteRemoteVaultPart2() : "");
      c.createDiv().setText(ti.msgConfirmDeleteRemoteVaultPart3 ? ti.msgConfirmDeleteRemoteVaultPart3() : "");
      const bar = modal.modalEl.createDiv("modal-button-container");
      const yes = bar.createEl("button", { cls: "mod-warning", text: ti.buttonDelete ? ti.buttonDelete() : "Delete" });
      const no = bar.createEl("button", { text: ng03Ii().cancel ? ng03Ii().cancel() : "Cancel" });
      yes.addEventListener("click", () => { modal.close(); resolve(true); });
      no.addEventListener("click", () => { modal.close(); resolve(false); });
      modal.onClose = () => resolve(false);
      modal.open();
    });
  };

  proto._confirmLeave = function (vault) {
    const ti = ng03Ti();
    return new Promise((resolve) => {
      const modal = new host.Modal(this.app);
      modal.titleEl.setText(ti.labelLeaveVaultConfirmation ? ti.labelLeaveVaultConfirmation({ vault: vault.name }) : "Leave vault?");
      const c = modal.contentEl;
      c.createDiv().setText(ti.msgLeaveVaultPart1 ? ti.msgLeaveVaultPart1() : "");
      c.createDiv().setText(ti.msgLeaveVaultPart2 ? ti.msgLeaveVaultPart2() : "");
      const bar = modal.modalEl.createDiv("modal-button-container");
      const yes = bar.createEl("button", { cls: "mod-warning", text: ti.buttonLeave ? ti.buttonLeave() : "Leave" });
      const no = bar.createEl("button", { text: ng03Ii().cancel ? ng03Ii().cancel() : "Cancel" });
      yes.addEventListener("click", () => { modal.close(); resolve(true); });
      no.addEventListener("click", () => { modal.close(); resolve(false); });
      modal.onClose = () => resolve(false);
      modal.open();
    });
  };

  proto._render = function () {
    const ti = ng03Ti();
    this.titleEl.setText(ti.labelRemoteVaults ? ti.labelRemoteVaults() : "Remote vaults");
    this.modalEl.addClass("mod-lg");
    this.contentEl.empty();

    if (this.limit === 0) {
      const box = this.contentEl.createDiv();
      box.createDiv().setText(ti.labelNoSubscription ? ti.labelNoSubscription() : "No subscription");
      box.createDiv().setText(ti.labelPleaseVisit ? ti.labelPleaseVisit() : "Please visit");
      const a = box.createEl("a", { text: "github.com/FalconTechDev/basalt", attr: { href: "https://github.com/FalconTechDev/basalt" } });
      a.addEventListener("click", (e) => { e.preventDefault(); window.open(a.href, "_blank"); });
      return;
    }
    if (!this.vaults.length && !this.shared.length) {
      this.contentEl.createDiv().setText(ti.labelNotRemoteVaults ? ti.labelNotRemoteVaults() : "No remote vaults");
    }
    const list = this.contentEl.createDiv("list-container vault-list");
    for (const vault of this.vaults) list.appendChild(this._vaultRow(vault, false));
    if (this.shared.length) {
      this.contentEl.createDiv("setting-item-heading").setText(ti.labelVaultsSharedWithYou ? ti.labelVaultsSharedWithYou() : "Shared with you");
      const sharedList = this.contentEl.createDiv("list-container vault-list");
      for (const vault of this.shared) sharedList.appendChild(this._vaultRow(vault, true));
    }
    const bar = this.modalEl.createDiv("modal-button-container");
    if (this.vaults.length < this.limit) {
      const create = bar.createEl("button", { cls: "mod-cta js-create-vault", text: ti.buttonCreateNewRemoteVault ? ti.buttonCreateNewRemoteVault() : "Create new remote vault" });
      create.addEventListener("click", () => {
        const M = ng03DefineSyncCreateVaultModal(host);
        new M(this.app, this.sync, async (vault) => {
          this.close();
          const R = ng03DefineSyncRemoteVaultsModal(host);
          new R(this.app, this.sync).open();
        }).open();
      });
    } else {
      bar.createDiv("u-muted").setText(ti.msgRemoteVaultLimitHit ? ti.msgRemoteVaultLimitHit() : "");
    }
  };

  return RemoteVaultsModal;
}

// ---------------------------------------------------------------------------
// CreateVaultModal (V9)
// ---------------------------------------------------------------------------

export function ng03DefineSyncCreateVaultModal(host) {
  function CreateVaultModal(app, sync, onCreated) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    self.onCreated = onCreated;
    self.regions = [];
    self.busy = false;
    return self;
  }
  inherit(CreateVaultModal, host.Modal);
  const proto = CreateVaultModal.prototype;

  proto.onOpen = async function () {
    const ti = ng03Ti();
    const ii = ng03Ii();
    this.titleEl.setText(ti.labelCreateRemoteVault ? ti.labelCreateRemoteVault() : "Create remote vault");
    this.modalEl.addClass("mod-lg");
    this.contentEl.createDiv().setText(ti.msgCreateVaultExplanation ? ti.msgCreateVaultExplanation() : "");
    this.errorEl = this.contentEl.createDiv("message mod-error");
    this.errorEl.hide();

    const nameInput = this.contentEl.createEl("input", { type: "text", cls: "settings-field" });
    nameInput.placeholder = ti.optionVaultNamePlaceholder ? ti.optionVaultNamePlaceholder() : "Vault name";

    acctVaultRegions(account.token, this.sync.host || "").then((regions) => { this.regions = regions || []; }).catch(() => {});

    const regionSel = this.contentEl.createEl("select", { cls: "dropdown" });
    const auto = regionSel.createEl("option", { text: ti.optVaultRegionAutomatic ? ti.optVaultRegionAutomatic() : "Automatic" });
    auto.value = "";
    this._regionSel = regionSel;

    const encSel = this.contentEl.createEl("select", { cls: "dropdown" });
    const e2e = encSel.createEl("option", { text: "end-to-end" }); e2e.value = "end-to-end";
    const std = encSel.createEl("option", { text: "standard" }); std.value = "standard";
    encSel.value = "end-to-end";

    this.passwordEl = this.contentEl.createEl("input", { type: "password", cls: "settings-field" });
    const sync = this.sync;
    const refreshRegions = () => {
      regionSel.querySelectorAll("option:not([value=''])").forEach((o) => o.remove());
      for (const r of this.regions) {
        const o = regionSel.createEl("option", { text: r.name || r });
        o.value = r.name || r;
      }
    };
    acctVaultRegions(account.token, sync.host || "").then((regions) => {
      this.regions = regions || [];
      refreshRegions();
    }).catch(() => {});
    encSel.addEventListener("change", () => {
      this.passwordEl.toggle(encSel.value === "end-to-end");
    });
    this.passwordEl.hide();

    const bar = this.modalEl.createDiv("modal-button-container");
    const btn = bar.createEl("button", { cls: "mod-cta", text: ti.buttonCreateVault ? ti.buttonCreateVault() : "Create vault" });
    btn.addEventListener("click", async () => {
      if (this.busy) return;
      const name = nameInput.value.trim();
      const e2eMode = encSel.value === "end-to-end";
      const password = this.passwordEl.value;
      const fail = (msg) => { this.errorEl.setText(msg); this.errorEl.show(); };
      if (!name) return fail(ti.msgVaultNameCannotBeEmpty ? ti.msgVaultNameCannotBeEmpty() : "Name required");
      if (e2eMode && !password) return fail(ti.msgPleaseEnterPassword ? ti.msgPleaseEnterPassword() : "Password required");
      this.busy = true;
      btn.addClass("mod-loading");
      try {
        let keyhash = "", salt = "";
        if (e2eMode) {
          salt = randomSaltHex();
          keyhash = await deriveVaultKeyhash(password, salt, 3);
        }
        const vault = await acctCreateVault(account.token, name, keyhash, salt, regionSel.value, 3);
        new host.Notice(ti.msgSuccessfullyCreatedVault ? ti.msgSuccessfullyCreatedVault({ name }) : "Created");
        this.close();
        if (this.onCreated) this.onCreated(vault);
      } catch (error) {
        fail(error && error.error ? error.error : (error && error.message || String(error)));
      } finally {
        this.busy = false;
        btn.removeClass("mod-loading");
      }
    });
  };

  return CreateVaultModal;
}

// ---------------------------------------------------------------------------
// ConnectVaultModal (U9)
// ---------------------------------------------------------------------------

export function ng03DefineSyncConnectVaultModal(host) {
  function ConnectVaultModal(app, sync, onConnected) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    self.onConnected = onConnected;
    self.vault = null;
    return self;
  }
  inherit(ConnectVaultModal, host.Modal);
  const proto = ConnectVaultModal.prototype;

  proto.connect = function (vault) {
    this.vault = vault;
    const files = this.app.vault.getAllLoadedFiles ? this.app.vault.getAllLoadedFiles().length : 0;
    if (files > 0) this._renderConfirmMerge();
    else this._startConnect();
    return this;
  };

  proto._renderConfirmMerge = function () {
    const ti = ng03Ti();
    this.titleEl.setText(ti.labelConfirmMergeVault ? ti.labelConfirmMergeVault() : "Connect vault?");
    this.contentEl.empty();
    this.contentEl.createDiv().setText(ti.msgVaultHasNotes ? ti.msgVaultHasNotes() : "");
    this.contentEl.createDiv().setText(ti.msgVaultMergeWarning ? ti.msgVaultMergeWarning({ name: this.vault.name }) : "");
    const bar = this.modalEl.createDiv("modal-button-container");
    const yes = bar.createEl("button", { cls: "mod-cta", text: ng03Ii().continue ? ng03Ii().continue() : "Continue" });
    const no = bar.createEl("button", { text: ng03Ii().cancel ? ng03Ii().cancel() : "Cancel" });
    yes.addEventListener("click", () => { this.contentEl.empty(); this._startConnect(); });
    no.addEventListener("click", () => this.close());
  };

  proto._startConnect = async function () {
    const ti = ng03Ti();
    this.titleEl.setText(ti.labelConnectVault ? ti.labelConnectVault() : "Connect");
    this.contentEl.empty();
    const vault = this.vault;
    // password check via vault-key helper when vault has a password
    if (vault.password) {
      const ok = await this._checkPassword(vault);
      if (!ok) return; // _checkPassword rendered the prompt
    }
    await this._doSetup(vault, vault.password || "");
  };

  proto._checkPassword = function (vault) {
    return new Promise((resolve) => {
      const ti = ng03Ti();
      this.contentEl.empty();
      this.contentEl.createDiv().setText(ti.labelUnlockEncryptedVault ? ti.labelUnlockEncryptedVault() : "Enter password");
      const input = this.contentEl.createEl("input", { type: "password", cls: "settings-field" });
      this.errorEl = this.contentEl.createDiv("message mod-error");
      this.errorEl.hide();
      const bar = this.modalEl.createDiv("modal-button-container");
      const btn = bar.createEl("button", { cls: "mod-cta", text: ti.buttonUnlock ? ti.buttonUnlock() : "Unlock" });
      btn.addEventListener("click", async () => {
        try {
          const kk = env().kk;
          if (kk) await kk(this.app, input.value);
          vault.password = input.value;
          resolve(true);
        } catch (error) {
          const msg = error && error.message || String(error);
          this.errorEl.setText(msg.indexOf("network") >= 0 || msg.indexOf("fetch") >= 0
            ? (env().gm.plugins.publish && env().gm.plugins.publish.msgNetworkError ? env().gm.plugins.publish.msgNetworkError() : msg)
            : msg);
          this.errorEl.show();
        }
      });
      this._resolvePassword = resolve;
    });
  };

  proto._doSetup = async function (vault, password) {
    const ti = ng03Ti();
    try {
      const salt = vault.salt || randomSaltHex();
      const encVersion = vault.encryption_version != null ? vault.encryption_version : 0;
      await this.sync.setup(vault.uid, vault.name, password, salt, this.sync.host || vault.host || "", encVersion);
      this.sync.setPause(true);
      if (this.onConnected) this.onConnected(vault);
      this._renderSuccess(vault);
    } catch (error) {
      this._renderFailure(error);
    }
  };

  proto._renderSuccess = function (vault) {
    const ti = ng03Ti();
    this.contentEl.empty();
    this.contentEl.createDiv("sync-modal-icon").appendChild((() => {
      const icon = createDiv("svg-icon");
      host.setIcon(icon, "circle-check");
      return icon;
    })());
    this.contentEl.createDiv().setText(ti.labelSetupConnection ? ti.labelSetupConnection() : "Connected");
    this.contentEl.createDiv().setText(ti.labelNowConnectedToVault ? ti.labelNowConnectedToVault({ name: vault.name }) : vault.name);
    const excl = this.contentEl.createEl("button", { text: ti.labelManageExcludedFolders ? ti.labelManageExcludedFolders() : "Excluded folders" });
    excl.addEventListener("click", () => { if (this.sync.settingTab) this.sync.settingTab.manageExclusions(); });
    const bar = this.modalEl.createDiv("modal-button-container");
    const btn = bar.createEl("button", { cls: "mod-cta", text: ti.buttonStartSyncing ? ti.buttonStartSyncing() : "Start syncing" });
    btn.addEventListener("click", () => {
      this.sync.setPause(false);
      this.sync.requestSync();
      if (this.sync.settingTab && this.sync.settingTab.display) this.sync.settingTab.display();
      this.close();
    });
  };

  proto._renderFailure = function (error) {
    const ti = ng03Ti();
    this.contentEl.empty();
    this.contentEl.createDiv().setText(ti.labelConnectionFailed ? ti.labelConnectionFailed() : "Connection failed");
    this.contentEl.createDiv().setText(ti.labelConnectionFailedDesc ? ti.labelConnectionFailedDesc() : "");
    const bar = this.modalEl.createDiv("modal-button-container");
    const retry = bar.createEl("button", { cls: "mod-cta", text: ng03Ii().retry ? ng03Ii().retry() : "Retry" });
    const cancel = bar.createEl("button", { text: ng03Ii().cancel ? ng03Ii().cancel() : "Cancel" });
    retry.addEventListener("click", () => this._startConnect());
    cancel.addEventListener("click", () => this.close());
  };

  return ConnectVaultModal;
}

// ---------------------------------------------------------------------------
// RenameVaultModal (W9)
// ---------------------------------------------------------------------------

export function ng03DefineSyncRenameVaultModal(host) {
  function RenameVaultModal(app, name, onSave) {
    const self = host.Modal.call(this, app) || this;
    self.name = name;
    self.onSave = onSave;
    return self;
  }
  inherit(RenameVaultModal, host.Modal);
  const proto = RenameVaultModal.prototype;

  proto.onOpen = function () {
    const ti = ng03Ti();
    this.titleEl.setText(ti.labelRenameRemoteVault ? ti.labelRenameRemoteVault({ name: this.name }) : "Rename");
    const input = this.contentEl.createEl("input", { type: "text", cls: "settings-field" });
    input.placeholder = this.name;
    const bar = this.modalEl.createDiv("modal-button-container");
    const save = bar.createEl("button", { cls: "mod-cta", text: ng03Ii().save ? ng03Ii().save() : "Save" });
    save.addEventListener("click", () => {
      const value = input.value.trim();
      if (this.onSave) this.onSave(value);
      this.close();
    });
  };

  return RenameVaultModal;
}

// ---------------------------------------------------------------------------
// ManageSharingModal (_9)
// ---------------------------------------------------------------------------

export function ng03DefineSyncManageSharingModal(host) {
  function ManageSharingModal(app, sync, vault) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    self.vault = vault;
    self.shares = null;
    return self;
  }
  inherit(ManageSharingModal, host.Modal);
  const proto = ManageSharingModal.prototype;

  proto.onOpen = function () {
    const pub = env().gm.plugins.publish || {};
    this.titleEl.setText(pub.labelManageSharing ? pub.labelManageSharing({ name: this.vault.name }) : "Manage sharing");
    this.modalEl.addClass("sync-vault-share-container");
    const ti = ng03Ti();
    this.contentEl.createDiv().setText(ti.labelSharingWithUsers ? ti.labelSharingWithUsers() : "");
    this.errorEl = this.contentEl.createDiv("message mod-error");
    this.errorEl.hide();
    const row = this.contentEl.createDiv("setting-item");
    const input = row.createEl("input", { type: "email", cls: "settings-field" });
    input.placeholder = pub.optionInviteUser ? pub.optionInviteUser() : "Invite user";
    const addBtn = row.createEl("button", { cls: "mod-cta", text: ng03Ii().add ? ng03Ii().add() : "Add" });
    const invite = async () => {
      const email = input.value.trim();
      if (!email.includes("@")) {
        new host.Notice(pub.errorEmailMustBeValid ? pub.errorEmailMustBeValid() : "Invalid email");
        return;
      }
      input.setAttribute("aria-disabled", "true");
      addBtn.setAttribute("aria-disabled", "true");
      try {
        await acctInviteVaultShare(account.token, this.vault.uid, email);
        input.value = "";
        this._loadShares();
      } catch (e) {
        this.errorEl.setText(e && e.error ? e.error : (e && e.message || String(e)));
        this.errorEl.show();
      } finally {
        input.removeAttribute("aria-disabled");
        addBtn.removeAttribute("aria-disabled");
      }
    };
    addBtn.addEventListener("click", invite);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) invite(); });
    this.listEl = this.contentEl.createDiv("modal-list");
    this._loadShares();
    const bar = this.modalEl.createDiv("modal-button-container");
    const done = bar.createEl("button", { text: ng03Ii().done ? ng03Ii().done() : "Done" });
    done.addEventListener("click", () => this.close());
  };

  proto._loadShares = async function () {
    const pub = env().gm.plugins.publish || {};
    this.listEl.empty();
    try {
      const res = await acctListVaultShares(account.token, this.vault.uid);
      const shares = res.shares || res || [];
      if (!shares.length) {
        const ti = ng03Ti();
        this.listEl.createDiv().setText(ti.labelNotSharing ? ti.labelNotSharing() : "Not sharing");
        return;
      }
      for (const share of shares) {
        const row = this.listEl.createDiv("list-item");
        const name = share.name || "";
        const email = share.email || "";
        row.createDiv("list-item-part title").setText(name ? name + " <" + email + ">" : email);
        if (share.accepted === false) {
          row.createDiv("list-item-part description u-muted").setText(pub.labelInvitePending ? pub.labelInvitePending() : "Pending");
        }
        const del = row.createDiv("clickable-icon");
        host.setIcon(del, "trash-2");
        host.setTooltip(del, pub.tooltipRemoveUser ? pub.tooltipRemoveUser() : "");
        del.addEventListener("click", async () => {
          try {
            await acctRemoveVaultShare(account.token, this.vault.uid, share.uid || share.share_uid);
            this._loadShares();
          } catch (e) { new host.Notice(e && e.message || String(e)); }
        });
      }
    } catch (e) {
      const ti = ng03Ti();
      this.listEl.createDiv().setText(ti.labelSharingLoadFailed ? ti.labelSharingLoadFailed() : (e && e.message || String(e)));
    }
  };

  return ManageSharingModal;
}

// ---------------------------------------------------------------------------
// LargestFilesModal (j9)
// ---------------------------------------------------------------------------

export function ng03DefineSyncLargestFilesModal(host) {
  function LargestFilesModal(app, sync) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    return self;
  }
  inherit(LargestFilesModal, host.Modal);
  const proto = LargestFilesModal.prototype;

  proto.onOpen = function () {
    const ti = ng03Ti();
    this.titleEl.setText(ti.msgLargestFiles ? ti.msgLargestFiles() : "Largest files");
    this.modalEl.addClass("mod-lg");
    this.contentEl.createDiv("setting-item-description").setText(ti.msgLargestFilesDesc ? ti.msgLargestFilesDesc() : "");
    const list = this.contentEl.createDiv("modal-list");
    const files = Object.values(this.sync.serverFiles || {})
      .filter((rec) => rec && !rec.folder && (rec.size || 0) > 0)
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 20);
    for (const rec of files) {
      list.createDiv("list-item u-small u-muted").setText(rec.path + " (" + formatBytes(rec.size) + ")");
    }
    const bar = this.modalEl.createDiv("modal-button-container");
    const done = bar.createEl("button", { text: ng03Ii().done ? ng03Ii().done() : "Done" });
    done.addEventListener("click", () => this.close());
  };

  return LargestFilesModal;
}

// ---------------------------------------------------------------------------
// ExcludedFoldersSuggest (q9)
// ---------------------------------------------------------------------------

export function ng03DefineSyncExcludedFoldersSuggest(host) {
  function ExcludedFoldersSuggest(app, sync) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    self.query = "";
    return self;
  }
  inherit(ExcludedFoldersSuggest, host.Modal);
  const proto = ExcludedFoldersSuggest.prototype;

  proto._allFolders = function () {
    const out = [];
    const walk = (folder, prefix) => {
      for (const child of folder.children || []) {
        if (child instanceof host.TFolder) {
          const p = prefix ? prefix + "/" + child.name : child.name;
          out.push(p);
          walk(child, p);
        }
      }
    };
    if (this.app.vault.root) walk(this.app.vault.root, "");
    return out;
  };

  proto.onOpen = function () {
    const ti = ng03Ti();
    this.titleEl.setText(ti.labelManageExcludedFolders ? ti.labelManageExcludedFolders() : "Excluded folders");
    this.modalEl.addClass("mod-lg");
    const self = this;

    // current exclusions list
    this.currentEl = this.contentEl.createDiv("modal-list sync-excluded-current");
    const renderCurrent = () => {
      this.currentEl.empty();
      for (const folder of this.sync.ignoreFolders) {
        const row = this.currentEl.createDiv("list-item");
        row.createDiv("list-item-part title").setText(folder);
        const del = row.createDiv("clickable-icon");
        host.setIcon(del, "trash-2");
        del.addEventListener("click", () => {
          this.sync.setIgnoreFolders(this.sync.ignoreFolders.filter((f) => f !== folder));
          renderCurrent();
        });
      }
      if (!this.sync.ignoreFolders.length) {
        this.currentEl.createDiv("list-item u-muted").setText(ti.labelNoExcludedFolders ? ti.labelNoExcludedFolders() : "None");
      }
    };
    renderCurrent();
    this._renderCurrent = renderCurrent;

    // add via suggester
    const wrap = this.contentEl.createDiv("setting-item");
    const input = wrap.createEl("input", { type: "text", cls: "settings-field" });
    input.placeholder = ti.labelAddExcludedFolder ? ti.labelAddExcludedFolder() : "Add excluded folder";
    wrap.createDiv("setting-item-description").setText(ti.labelAddExcludedFolderDesc ? ti.labelAddExcludedFolderDesc() : "");
    this.suggestEl = this.contentEl.createDiv("suggestion-container");

    const renderSuggestions = () => {
      this.suggestEl.empty();
      const q = this.query.toLowerCase();
      const folders = this._allFolders().filter((f) => !this.sync.ignoreFolders.includes(f) && (!q || f.toLowerCase().includes(q)));
      for (const folder of folders.slice(0, 50)) {
        const item = this.suggestEl.createDiv("suggestion-item");
        item.setText(folder);
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          this.sync.setIgnoreFolders([...this.sync.ignoreFolders, folder]);
          this.query = "";
          input.value = "";
          renderCurrent();
          renderSuggestions();
        });
      }
    };
    this._renderSuggestions = renderSuggestions;
    input.addEventListener("input", () => { this.query = input.value; renderSuggestions(); });
    renderSuggestions();

    const bar = this.modalEl.createDiv("modal-button-container");
    const done = bar.createEl("button", { text: ng03Ii().done ? ng03Ii().done() : "Done" });
    done.addEventListener("click", () => this.close());
  };

  proto.onClose = function () {
    if (this.sync.settingTab && this.sync.settingTab.display) {
      try { this.sync.settingTab.display(); } catch (e) { /* ignore */ }
    }
  };

  return ExcludedFoldersSuggest;
}

// ---------------------------------------------------------------------------
// UpgradeEncryptionModal (R9) + MigrateVaultModal (B9)
// ---------------------------------------------------------------------------

export function ng03DefineSyncUpgradeEncryptionModal(host) {
  function UpgradeEncryptionModal(app, sync) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    return self;
  }
  inherit(UpgradeEncryptionModal, host.Modal);
  const proto = UpgradeEncryptionModal.prototype;

  proto.onOpen = function () {
    const ti = ng03Ti();
    this.titleEl.setText(ti.labelUpgradeEncryption ? ti.labelUpgradeEncryption() : "Upgrade encryption");
    this.modalEl.addClass("mod-lg");
    this.contentEl.createDiv().setText(ti.msgMigratePreConfirmationPart1 ? ti.msgMigratePreConfirmationPart1() : "");
    this.contentEl.createDiv().setText(ti.msgMigratePreConfirmationPart2 ? ti.msgMigratePreConfirmationPart2() : "");
    this.contentEl.createDiv().setText(ti.msgMigratePreConfirmationPart3 ? ti.msgMigratePreConfirmationPart3() : "");
    const a = this.contentEl.createEl("a", { text: ti.labelLearnMore ? ti.labelLearnMore() : "Learn more", attr: { href: "https://github.com/FalconTechDev/basalt" } });
    a.addEventListener("click", (e) => { e.preventDefault(); window.open(a.href, "_blank"); });
    const bar = this.modalEl.createDiv("modal-button-container");
    const yes = bar.createEl("button", { cls: "mod-cta", text: ti.buttonContinue ? ti.buttonContinue() : "Continue" });
    const no = bar.createEl("button", { text: ng03Ii().cancel ? ng03Ii().cancel() : "Cancel" });
    yes.addEventListener("click", () => {
      this.close();
      const M = ng03DefineSyncMigrateVaultModal(host);
      new M(this.app, this.sync).open();
    });
    no.addEventListener("click", () => this.close());
  };

  return UpgradeEncryptionModal;
}

export function ng03DefineSyncMigrateVaultModal(host) {
  function MigrateVaultModal(app, sync) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    self.vaults = null;
    self.busy = false;
    return self;
  }
  inherit(MigrateVaultModal, host.Modal);
  const proto = MigrateVaultModal.prototype;

  proto.onOpen = async function () {
    const ti = ng03Ti();
    this.titleEl.setText(ti.labelMigrateVault ? ti.labelMigrateVault() : "Migrate vault");
    this.modalEl.addClass("mod-lg");
    this.contentEl.createDiv("modal-loading");
    try {
      const res = await acctListVaults(account.token);
      this.vaults = res.vaults || [];
    } catch (e) {
      this.vaults = [];
    }
    this._renderForm();
  };

  proto._currentVault = function () {
    return (this.vaults || []).find((v) => v.uid === this.sync.vaultId);
  };

  proto._renderForm = function () {
    const ti = ng03Ti();
    const vault = this._currentVault();
    this.contentEl.empty();
    if (!vault) {
      this.contentEl.createDiv().setText(ti.msgCannotMigrateVault ? ti.msgCannotMigrateVault() : "Cannot migrate");
      return;
    }
    if (vault.shared || (vault.password === false)) {
      this.contentEl.createDiv().setText(ti.msgOnlyOwnerMayMigrate ? ti.msgOnlyOwnerMayMigrate() : "Only the owner may migrate");
      return;
    }
    this.errorEl = this.contentEl.createDiv("message mod-error");
    this.errorEl.hide();

    acctVaultRegions(account.token, this.sync.host || "").then((regions) => {
      const regionSel = this.contentEl.createEl("select", { cls: "dropdown" });
      const auto = regionSel.createEl("option", { text: ti.optVaultRegionAutomatic ? ti.optVaultRegionAutomatic() : "Automatic" });
      auto.value = "";
      for (const r of regions || []) {
        const o = regionSel.createEl("option", { text: r.name || r });
        o.value = r.name || r;
      }
      this._regionSel = regionSel;
    }).catch(() => {});

    const encSel = this.contentEl.createEl("select", { cls: "dropdown" });
    const e2e = encSel.createEl("option", { text: "end-to-end" }); e2e.value = "end-to-end";
    const std = encSel.createEl("option", { text: "standard" }); std.value = "standard";
    encSel.value = "end-to-end";
    this.passwordEl = this.contentEl.createEl("input", { type: "password", cls: "settings-field" });
    this.passwordEl.hide();
    encSel.addEventListener("change", () => this.passwordEl.toggle(encSel.value === "end-to-end"));

    const bar = this.modalEl.createDiv("modal-button-container");
    const btn = bar.createEl("button", { cls: "mod-cta", text: ti.buttonContinue ? ti.buttonContinue() : "Continue" });
    btn.addEventListener("click", () => this._renderConfirm(vault));
  };

  proto._renderConfirm = function (vault) {
    const ti = ng03Ti();
    const encSel = this.modalEl.querySelectorAll("select")[1];
    const e2eMode = encSel && encSel.value === "end-to-end";
    const password = this.passwordEl.value;
    if (e2eMode && !password) {
      this.errorEl.setText(ti.msgPleaseEnterPassword ? ti.msgPleaseEnterPassword() : "Password required");
      this.errorEl.show();
      return;
    }
    this.contentEl.empty();
    this.contentEl.createDiv().setText(ti.labelConfirmMigrate ? ti.labelConfirmMigrate() : "Migrate?");
    this.contentEl.createDiv().setText(ti.msgMigrateConfirmation ? ti.msgMigrateConfirmation() : "");
    this.contentEl.createDiv().setText(ti.msgProceedPrompt ? ti.msgProceedPrompt() : "");
    this.errorEl = this.contentEl.createDiv("message mod-error");
    this.errorEl.hide();
    const bar = this.modalEl.createDiv("modal-button-container");
    const btn = bar.createEl("button", { cls: "mod-cta mod-warning", text: ti.buttonMigrate ? ti.buttonMigrate() : "Migrate" });
    btn.addEventListener("click", async () => {
      if (this.busy) return;
      this.busy = true;
      btn.addClass("mod-loading");
      try {
        await this._migrate(vault, e2eMode, password);
      } catch (error) {
        this.errorEl.setText(error && error.error ? error.error : (error && error.message || String(error)));
        this.errorEl.show();
        this.busy = false;
        btn.removeClass("mod-loading");
      }
    });
  };

  proto._migrate = async function (vault, e2eMode, password) {
    const ti = ng03Ti();
    const sync = this.sync;
    // snapshot selective-sync choices
    const allowTypes = new Set(sync.allowTypes);
    const allowSpecial = new Set(sync.allowSpecialFiles);
    const ignoreFolders = sync.ignoreFolders.slice();
    const deviceName = sync.deviceName;
    sync.setPause(true);
    let keyhash = "", salt = "";
    if (e2eMode) {
      salt = randomSaltHex();
      keyhash = await deriveVaultKeyhash(password, salt, 3);
    }
    const region = this._regionSel ? this._regionSel.value : "";
    const res = await acctMigrateVault(account.token, vault.uid, keyhash, salt, region, 3);
    sync.unsetup();
    await sync.setup(vault.uid, vault.name || sync.vaultName, password || vault.password || "", salt || vault.salt, sync.host, 3);
    // restore preferences
    sync.allowTypes = allowTypes;
    sync.allowSpecialFiles = allowSpecial;
    sync.ignoreFolders = ignoreFolders;
    sync.deviceName = deviceName;
    sync.forceSaveData();
    sync.setPause(true);
    const once = () => {
      if (sync.getStatus() === "synced") {
        sync.off("status-change", once);
        new host.Notice(ti.msgVaultMigrationCompleted ? ti.msgVaultMigrationCompleted() : "Migration complete");
      }
    };
    sync.on("status-change", once);
    sync.setPause(false);
    sync.requestSync();
    new host.Notice(ti.msgVaultMigrationStarted ? ti.msgVaultMigrationStarted() : "Migration started");
    if (sync.settingTab && sync.settingTab.display) sync.settingTab.display();
    this.close();
  };

  return MigrateVaultModal;
}

// ---------------------------------------------------------------------------
// FileHistoryView (I9) — full history browser modal
// ---------------------------------------------------------------------------

export function ng03DefineSyncFileHistoryView(host) {
  function FileHistoryView(app, sync, path) {
    const self = host.Modal.call(this, app) || this;
    self.sync = sync;
    self.filepath = path;
    self.items = [];
    self.more = false;
    self.beforeUid = null;
    self.cache = {};
    self.showDiff = false;
    self.groupEls = [];
    return self;
  }
  inherit(FileHistoryView, host.Modal);
  const proto = FileHistoryView.prototype;

  proto.onOpen = function () {
    const ti = ng03Ti();
    this.titleEl.setText(this.filepath);
    this.modalEl.addClass("mod-sync-history", "mod-sidebar-layout", "mod-lg");
    try {
      this.showDiff = localStorage.getItem("history-show-diff") === "true";
    } catch (e) { /* ignore */ }

    const sidebar = this.contentEl.createDiv("sync-history-list-container");
    this.listEl = sidebar.createDiv("modal-sidebar sync-history-list");
    const moreBtn = sidebar.createEl("button", { cls: "sync-history-button", text: ti.labelLoadMore ? ti.labelLoadMore() : "Load more" });
    moreBtn.addEventListener("click", () => this.fetchMore());
    this.contentEl.createDiv("sync-history-content-container").appendChild(
      (this.contentPane = this.contentEl.createDiv("sync-history-content")));
    this.fetchMore();
  };

  proto.fetchMore = async function () {
    if (this.loading) return;
    this.loading = true;
    try {
      const related = this.items.length ? (this.items[this.items.length - 1].relatedpath || this.items[this.items.length - 1].path) : this.filepath;
      const cursor = this.items.length ? this.items[this.items.length - 1].uid : this.beforeUid;
      const res = await this.sync.getHistory(related, cursor);
      const items = (res && res.items) || [];
      let more = !!(res && res.more);
      // rename chains terminate the walk
      const cut = items.findIndex((item) => item.relatedpath && !item.deleted);
      const kept = cut >= 0 ? items.slice(0, cut + 1) : items;
      if (cut >= 0) more = true;
      this.items = this.items.concat(kept);
      this.more = more;
      this._renderGroups();
      if (!this._didInitialOpen && kept.length) {
        this._didInitialOpen = true;
        if (!host.Platform.isPhone) this._openItem(kept[0], null);
      }
      if (!this.items.length) {
        this.listEl.createDiv("list-item u-muted").setText(ng03Ti().labelNoHistory ? ng03Ti().labelNoHistory() : "No history");
      }
    } catch (e) {
      this.listEl.createDiv("list-item u-muted").setText(e && e.message || String(e));
    } finally {
      this.loading = false;
    }
  };

  proto._groupKey = function (item, prev) {
    if (!prev) return "new";
    const day = (ts) => Math.floor(ts / 86400000);
    if (day(item.ts) !== day(prev.ts)) return "day";
    if ((item.device || "") !== (prev.device || "") || (item.user || -1) !== (prev.user || -1)) return "who";
    if (Math.abs(item.ts - prev.ts) > SYNC_HOUR_MS) return "hour";
    return null;
  };

  proto._renderGroups = function () {
    this.listEl.empty();
    this.groupEls = [];
    const groups = [];
    let current = null;
    for (const item of this.items) {
      if (item.folder) continue;
      if (item.deleted && item.relatedpath) continue;
      const key = current ? this._groupKey(item, current.items[current.items.length - 1]) : "new";
      if (!current || key) {
        current = { items: [], header: null, container: null, first: item };
        groups.push(current);
      }
      current.items.push(item);
    }
    for (const group of groups) {
      const header = this.listEl.createDiv("sync-history-list-item");
      const isCurrentUser = group.items.some((i) => i.user != null && i.user === this.sync.userId);
      if (isCurrentUser) header.addClass("mod-current-user");
      const first = group.items[0];
      const avatar = ng03CreateAvatar(first, this.sync);
      header.appendChild(avatar);
      const info = header.createDiv("sync-history-list-item-info");
      const when = first.ts < Date.now() - 86400000 ? ng03Llll(first.ts) : ng03FromNow(first.ts);
      info.createDiv("sync-history-list-item-title").setText(when);
      const sub = [];
      if (first.relatedpath) sub.push(ng03Ti().labelFileRenamedFromTo ? ng03Ti().labelFileRenamedFromTo({ from: withoutMd(first.relatedpath), to: withoutMd(first.path) }) : "renamed");
      else if (first.deleted) sub.push(ng03Ti().labelFileDeleted ? ng03Ti().labelFileDeleted() : "deleted");
      else if ((first.size || 0) === 0) sub.push(ng03Ti().labelEmptyFile ? ng03Ti().labelEmptyFile() : "empty");
      else sub.push((ng03Ti().labelRevision ? ng03Ti().labelRevision({ count: group.items.length }) : group.items.length + " revisions") + (first.device ? " " + (ng03Ti().labelViaDevice ? ng03Ti().labelViaDevice({ device: first.device }) : "via " + first.device) : ""));
      info.createDiv("sync-history-list-item-subtitle u-muted").setText(sub.join(" "));
      const flair = header.createDiv("tree-item-flair-outer");
      const icon = flair.createDiv("tree-item-flair");
      host.setIcon(icon, host.Platform.isMobile ? "chevrons-up-down" : "right-triangle");
      const container = this.listEl.createDiv("version-group-container");
      container.hide();
      for (const item of group.items) {
        const btn = container.createEl("button", { cls: "version-group-item", text: ng03Moment(item.ts) ? ng03Moment(item.ts).format("LT") : "" });
        btn.addEventListener("click", () => this._openItem(item, group.items[0]));
      }
      header.addEventListener("click", () => {
        const collapsed = container.hasClass("is-hidden");
        container.toggleClass("is-hidden", !collapsed);
        icon.toggleClass("is-collapsed", !collapsed);
      });
      group.header = header; group.container = container; group.first = group.items[0];
      this.groupEls.push(group);
    }
  };

  proto._openItem = async function (item, groupFirst) {
    const ti = ng03Ti();
    const pane = this.contentPane;
    pane.empty();
    const titlebar = pane.createDiv("modal-setting-titlebar");
    const ext = extensionOf(this.filepath);
    const isMd = ng03ExtHas(host0Markdown(), ext) || ext === "md";
    titlebar.createDiv("modal-setting-title").setText(isMd ? withoutMd(this.filepath) : this.filepath);
    const actions = titlebar.createDiv("modal-setting-action-buttons");

    if (item.relatedpath) {
      const renamed = item.relatedpath !== this.filepath;
      pane.createDiv().setText(renamed
        ? (ti.labelFileRenamedFromTo ? ti.labelFileRenamedFromTo({ from: item.relatedpath, to: item.path }) : "renamed")
        : (ti.labelFileMovedFromTo ? ti.labelFileMovedFromTo({ from: item.relatedpath, to: item.path }) : "moved"));
      return;
    }
    if (item.deleted) {
      pane.createDiv().setText(ti.labelFileDeleted ? ti.labelFileDeleted() : "deleted");
      return;
    }

    // restore button
    const isLatest = this.items.length && this.items[0].uid === item.uid;
    const restoreBtn = actions.createEl("button", { text: ti.labelRestoreThisVersion ? ti.labelRestoreThisVersion() : "Restore" });
    restoreBtn.addEventListener("click", async () => {
      if (isLatest) {
        new host.Notice(ti.msgAlreadyLatestVersion ? ti.msgAlreadyLatestVersion() : "Already latest");
        return;
      }
      try {
        await this.sync.restoreVersion(item.uid, this.filepath !== item.path ? this.filepath : "");
        new host.Notice(ti.msgRestoredVersion ? ti.msgRestoredVersion({ time: ng03FromNow(item.ts) }) : "Restored");
        this.close();
      } catch (e) {
        new host.Notice(e && e.message || String(e));
      }
    });
    const copyBtn = actions.createEl("button", { cls: "clickable-icon" });
    host.setIcon(copyBtn, "lucide-copy");
    host.setTooltip(copyBtn, ng03Ii().labelCopyShort ? ng03Ii().labelCopyShort() : "Copy");
    const diffBtn = actions.createEl("button", { text: ti.labelShowDiff ? ti.labelShowDiff() : "Diff" });
    diffBtn.addClass(this.showDiff ? "is-active" : "");
    diffBtn.addEventListener("click", () => {
      this.showDiff = !this.showDiff;
      try { localStorage.setItem("history-show-diff", String(this.showDiff)); } catch (e) { /* ignore */ }
      this._openItem(item, groupFirst);
    });

    const loading = pane.createDiv("modal-loading");
    try {
      let data = this.cache[item.uid];
      if (!data) {
        data = await this.sync.getContentForVersion(item.uid);
        this.cache[item.uid] = data;
      }
      loading.detach();
      if (data == null) { pane.createDiv().setText("(empty)"); return; }
      const text = utf8String(data.buffer || data);
      if (isMd) {
        // rendered markdown + optional diff
        const preview = pane.createDiv("markdown-preview-view");
        preview.setText(text);
        if (this.showDiff && groupFirst && groupFirst.uid !== item.uid) {
          let prev = this.cache[groupFirst.uid];
          if (!prev) { prev = await this.sync.getContentForVersion(groupFirst.uid); this.cache[groupFirst.uid] = prev; }
          const prevText = prev == null ? "" : utf8String(prev.buffer || prev);
          const RX = env().RX;
          if (RX) {
            const diffEl = pane.createDiv("sync-history-diff");
            try { diffEl.appendChild(RX(prevText, text)); } catch (e) { /* ignore */ }
          }
        }
      } else if (ng03ExtHas(host0Text(), ext)) {
        const pre = pane.createEl("pre");
        pre.setText(text);
      } else if (ng03ExtHas(host0Image(), ext)) {
        const url = URL.createObjectURL(new Blob([data.buffer || data]));
        const img = pane.createEl("img", { attr: { src: url } });
        img.addClass("sync-history-image");
      } else {
        const o8 = env().o8;
        if (o8) {
          try { pane.appendChild(o8(this.app, item.path, data)); } catch (e) { this._unsupported(pane, ext); }
        } else this._unsupported(pane, ext);
      }
      copyBtn.addEventListener("click", () => {
        ng03Copy(text);
        new host.Notice(ng03Ii().copied_generic ? ng03Ii().copied_generic() : "Copied");
      });
    } catch (e) {
      loading.detach();
      pane.createDiv().setText(e && e.message || String(e));
    }
  };

  proto._unsupported = function (pane, ext) {
    const ti = ng03Ti();
    pane.createDiv().setText(ti.labelPreviewUnsupportedFileType ? ti.labelPreviewUnsupportedFileType({ type: ext || "file" }) : "Preview not supported");
  };

  return FileHistoryView;
}

// ---------------------------------------------------------------------------
// SyncChangesView (K9)
// ---------------------------------------------------------------------------

export function ng03DefineSyncChangesView(host) {
  function SyncChangesView(leaf) {
    const self = host.ItemView.call(this, leaf) || this;
    self.sync = self.app.internalPlugins.getEnabledPluginById("sync");
    self.groups = {};
    self.fileItems = {};
    self.hideMyChanges = false;
    self.multipleUsers = false;
    self.userMap = {};
    self.uninitializedEl = null;
    self.headerDom = { navHeaderEl: { find: () => null } };
    self._refreshTimer = null;
    self._interval = null;
    return self;
  }
  inherit(SyncChangesView, host.ItemView);
  const proto = SyncChangesView.prototype;

  proto.getViewType = function () { return "sync"; };
  proto.getDisplayText = function () { return ng03Ti().labelSyncChanges ? ng03Ti().labelSyncChanges() : "Sync changes"; };
  proto.getIcon = function () { return "refresh-ccw"; };

  proto.onOpen = function () {
    const sync = this.sync;
    const scope = this.scope;
    this.containerEl.addClass("sync-changes-view");

    // disconnected pane
    this.uninitializedEl = this.contentEl.createDiv("pane-empty sync-uninitialized");
    this.uninitializedEl.createDiv().setText(ng03Ti().labelSyncDisconnected ? ng03Ti().labelSyncDisconnected() : "Sync is not connected");

    // tree container
    const treeWrap = this.contentEl.createDiv("recent-changes-container");
    this.treeBoxEl = treeWrap;
    this.treeContainerEl = treeWrap.createDiv("sync-changes-tree");
    this.tree = { containerEl: this.treeContainerEl, onResize: () => {} };

    // custom header with users button
    const header = this.contentEl.createDiv("view-header sync-changes-header");
    const navButtons = header.createDiv("nav-buttons-container");
    this.usersBtn = navButtons.createEl("button", { cls: "clickable-icon" });
    host.setIcon(this.usersBtn, "users");
    host.setTooltip(this.usersBtn, ng03Ti().buttonHideMyChanges ? ng03Ti().buttonHideMyChanges() : "Hide my changes");
    this.usersBtn.setAttribute("aria-label", ng03Ti().buttonHideMyChanges ? ng03Ti().buttonHideMyChanges() : "Hide my changes");
    this.headerDom = { navHeaderEl: { find: () => this.usersBtn } };
    this.usersBtn.addEventListener("click", () => {
      this.hideMyChanges = !this.hideMyChanges;
      this.usersBtn.toggleClass("is-active", this.hideMyChanges);
      this.updateRecentChanges();
    });
    this.usersBtn.hide();

    // groups
    const defs = [["today", ng03Ti().labelToday], ["yesterday", ng03Ti().labelYesterday], ["week", ng03Ti().labelThisWeek], ["older", ng03Ti().labelOlder]];
    for (const [key, labelFn] of defs) {
      const group = {
        key,
        children: [],
        vChildren: null,
        el: null,
        setFlair(n) { this._flair = n; if (this.flairEl) this.flairEl.setText(String(n)); },
        getFlair() { return this._flair || 0; },
      };
      group.vChildren = { children: group.children };
      const el = this.treeContainerEl.createDiv("sync-change-group" + (key === "older" ? " is-collapsed" : ""));
      const head = el.createDiv("sync-change-group-header clickable-icon");
      host.setIcon(head.createDiv("tree-item-flair-outer").createDiv("tree-item-flair"), "right-triangle");
      head.createDiv("sync-change-group-title").setText(labelFn ? labelFn() : key);
      group.flairEl = head.createDiv("sync-change-group-count u-muted");
      group.bodyEl = el.createDiv("sync-change-group-body");
      group.el = el;
      head.addEventListener("click", () => {
        el.toggleClass("is-collapsed");
        group.collapsed = el.hasClass("is-collapsed");
      });
      group.collapsed = key === "older";
      this.groups[key] = group;
    }

    // events
    const vault = this.app.vault;
    vault.on("delete", this._onDelete = (file) => this._onVaultChange(file));
    vault.on("rename", this._onRename = (file, oldPath) => this._onVaultChange(file));
    this.app.workspace.on("file-open", this._onFileOpen = (file) => this._onFileOpened(file));
    if (sync) sync.on("status-change", this._onStatus = () => {
      if (this._refreshTimer) return;
      this._refreshTimer = setTimeout(() => { this._refreshTimer = null; this.updateRecentChanges(); }, 1000);
    });
    this._interval = setInterval(() => {
      const day = Math.floor(Date.now() / 86400000);
      if (day !== this._lastDay) { this._lastDay = day; this.updateRecentChanges(); }
    }, 300000);
    this._lastDay = Math.floor(Date.now() / 86400000);

    this.updateRecentChanges();
  };

  proto.onClose = function () {
    if (this._onDelete) this.app.vault.off("delete", this._onDelete);
    if (this._onRename) this.app.vault.off("rename", this._onRename);
    if (this._onFileOpen) this.app.workspace.off("file-open", this._onFileOpen);
    if (this.sync && this._onStatus) this.sync.off("status-change", this._onStatus);
    if (this._interval) clearInterval(this._interval);
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
  };

  proto.onResize = function () { if (this.tree && this.tree.onResize) this.tree.onResize(); };

  proto._onVaultChange = function (file) {
    const path = file && file.path;
    if (!path) return;
    for (const key in this.groups) {
      this.groups[key].children = this.groups[key].children.filter((c) => !(c.sFile && c.sFile.path === path));
    }
    delete this.fileItems[path];
  };

  proto._onFileOpened = function (file) {
    if (!file) return;
    for (const key in this.fileItems) this.fileItems[key].el && this.fileItems[key].el.removeClass("is-active");
    const item = this.fileItems[file.path];
    if (item && item.el) item.el.addClass("is-active");
  };

  proto._bucketFor = function (mtime, todayStart) {
    if (mtime > todayStart) return "today";
    if (mtime > todayStart - 86400000) return "yesterday";
    if (mtime > todayStart - 6 * 86400000) return "week";
    return "older";
  };

  proto.updateRecentChanges = async function () {
    const sync = this.sync;
    const status = sync ? sync.getStatus() : "disconnected";
    const connected = status !== "uninitialized" && status !== "disconnected";
    this.uninitializedEl.toggleClass("is-hidden", connected);
    this.uninitializedEl.style.display = connected ? "none" : "";
    this.treeBoxEl.toggleClass("is-hidden", !connected);
    this.treeBoxEl.style.display = connected ? "" : "none";
    if (!connected) { this._renderGroups(); return; }

    // usernames
    if (sync && !sync.userMapLoaded) {
      try {
        const map = await sync.getUsernames();
        sync.userMap = map || {};
        sync.userMapLoaded = true;
      } catch (e) { sync.userMapLoaded = true; }
    }
    this.userMap = (sync && sync.userMap) || {};
    const usernames = Object.keys(this.userMap);
    this.multipleUsers = usernames.length > 1;
    if (!this.multipleUsers) this.hideMyChanges = false;
    this.usersBtn.toggle(this.multipleUsers);
    this.usersBtn.toggleClass("is-active", this.hideMyChanges);

    const todayStart = window.moment ? window.moment().startOf("day").valueOf() : Math.floor(Date.now() / 86400000) * 86400000;
    const buckets = { today: [], yesterday: [], week: [], older: [] };
    const serverFiles = (sync && sync.serverFiles) || {};
    for (const path in serverFiles) {
      const rec = serverFiles[path];
      if (!rec || rec.folder || rec.deleted) continue;
      if (path.indexOf(".basalt") === 0) continue;
      if (this.hideMyChanges && (rec.user == null || rec.user === sync.userId)) continue;
      const key = this._bucketFor(rec.mtime || 0, todayStart);
      buckets[key].push(rec);
    }
    for (const key of ["today", "yesterday", "week", "older"]) {
      buckets[key].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    }
    this._buckets = buckets;
    this._renderGroups();
  };

  proto._renderGroups = function () {
    this.fileItems = {};
    const buckets = this._buckets || { today: [], yesterday: [], week: [], older: [] };
    for (const key of ["today", "yesterday", "week", "older"]) {
      const group = this.groups[key];
      if (!group) continue;
      group.children.length = 0;
      let list = buckets[key];
      let moreItem = null;
      if (key === "older" && list.length > 100) {
        list = list.slice(0, 100);
        moreItem = { _more: true, count: buckets[key].length - 100 };
      }
      for (const rec of list) {
        const item = this._makeFileItem(rec);
        group.children.push(item);
      }
      if (moreItem) {
        const el = createDiv("list-item sync-change-more");
        el.setText((ng03Ti().labelShowMore ? ng03Ti().labelShowMore() : "Show more") + " (" + moreItem.count + ")");
        const item = { el, _more: true, count: moreItem.count };
        group.children.push(item);
      }
      group.setFlair(group.children.filter((c) => c.sFile).length);
      // render DOM rows
      group.bodyEl.empty();
      for (const child of group.children) {
        group.bodyEl.appendChild(child.el);
      }
    }
    // activate current file
    const active = this.app.workspace.getActiveFile && this.app.workspace.getActiveFile();
    if (active && this.fileItems[active.path]) this.fileItems[active.path].el.addClass("is-active");
  };

  proto._makeFileItem = function (rec) {
    const el = createDiv("list-item sync-change-item tappable");
    const part = el.createDiv("list-item-part");
    part.createDiv("list-item-part title").setText(baseName(rec.path));
    const meta = [];
    if (rec.device) meta.push(rec.device);
    const uname = rec.user != null ? this.userMap[String(rec.user)] || this.userMap[rec.user] : null;
    if (uname) meta.push(uname);
    meta.push(ng03FromNow(rec.mtime || 0));
    part.createDiv("list-item-part description u-muted").setText(meta.join(" · "));
    el.addEventListener("click", () => {
      const file = this.app.vault.getAbstractFileByPath(rec.path);
      if (file) this.app.workspace.getLeaf().openFile(file);
    });
    const item = { sFile: rec, el };
    this.fileItems[rec.path] = item;
    return item;
  };

  return SyncChangesView;
}
