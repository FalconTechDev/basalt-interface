// s29: small application values and services around the workspace shell.
//
// Own replacements for the slice's literals and helpers: the workspace layout file names, the
// release-notes view type/repo, the secrets storage keys, the desktop-only guard used by pop-out
// windows, the Capacitor SecureStorage plugin bridge and the recent-file tracker.

import { env } from "./env.js";

export const s29WorkspaceFileName = "workspace.json";
export const s29WorkspaceMobileFileName = "workspace-mobile.json";
export const s29ReleaseNotesViewType = "release-notes";
export const s29ReleaseNotesRepo = "obsidianmd/obsidian-docs";
export const s29SecretsWarningDismissedKey = "secrets-encryption-warning-dismissed";
export const s29SecretsKey = "secrets";
export const s29SecretsEncryptedKey = "secrets-encrypted";
export const s29SecretsMetaKey = "secrets-meta";

/** Leaf split direction accepted by the workspace (was R0): boolean or tab/window/split. */
export function s29PaneType(direction) {
  const ok = typeof direction === "boolean" || direction === "tab" || direction === "window" || direction === "split";
  return ok && direction;
}

/** Throws (after showing a notice) when a desktop-only feature runs elsewhere or on an old installer. */
export function s29DesktopOnly() {
  const { Yl, gm, qf, fb } = env();
  let message;
  if (!Yl.isDesktopApp) {
    message = gm.interface.msgDesktopOnlyFeature();
    throw new fb(message), new Error(message);
  }
  if (qf < 13) {
    message = gm.interface.msgUpgradeInstaller();
    throw new fb(message), new Error(message);
  }
}

/** The Capacitor plugin object backing mobile secret storage (was U1). */
export function defineSecureStoreNative(host) {
  const capacitor = host.s04CapacitorCore;
  let plugin = null;
  plugin = capacitor.F3("SecureStorage", {
    web: async () => {
      const module = await env().s29Require(3357);
      return new module.SecureStorageWeb();
    },
    ios: async () => {
      const module = await env().s29Require(9804);
      return new module.SecureStorageNative(plugin);
    },
    android: async () => {
      const module = await env().s29Require(9804);
      return new module.SecureStorageNative(plugin);
    },
  });
  return plugin;
}

const S29_RECENT_LIMITS = { md: 25, canvas: 10, image: 10, other: 10 };

/** Remembers which files were opened recently so the layout file can restore them (was B0). */
export function defineRecentFileTracker(host) {
  function RecentFileTracker(workspace, vault) {
    this.workspace = workspace;
    this.vault = vault;
    this.lastOpenFiles = [];
    vault.on("create", this.addRecentFile, this);
    vault.on("rename", this.onRename, this);
  }
  const proto = RecentFileTracker.prototype;

  proto.load = function (files) { this.lastOpenFiles = files; };
  proto.serialize = function () { return this.lastOpenFiles; };

  proto.collect = function (file) {
    if (this.lastOpenFiles[0] === file.path) return;
    const limits = { ...S29_RECENT_LIMITS };
    const next = [file.path];
    for (const path of this.lastOpenFiles) {
      if (path === file.path) continue;
      const extension = env().su(path);
      let kind = "other";
      if (env().jy.includes(extension)) kind = "md";
      else if (env().Uy.includes(extension)) kind = "canvas";
      else if (env().Vy.includes(extension)) kind = "image";
      const limit = limits[kind];
      if (limit <= 0) continue;
      next.push(path);
      limits[kind] = limit - 1;
    }
    this.lastOpenFiles = next;
  };

  proto.onFileOpen = function (file, previousFile) {
    if (this.workspace.layoutReady && previousFile) {
      this.collect(previousFile);
      this.workspace.requestSaveLayout();
    }
  };

  proto.addRecentFile = function (file) {
    if (this.workspace.layoutReady) {
      this.collect(file);
      this.workspace.requestSaveLayout();
    }
  };

  proto.onRename = function (file, oldPath) {
    if (!this.workspace.layoutReady) return;
    this.lastOpenFiles = this.lastOpenFiles.map((path) => (path === oldPath ? file.path : path));
    this.workspace.requestSaveLayout();
  };

  proto.getLastOpenFiles = function () {
    return this.getRecentFiles({ showMarkdown: true, showNonAttachments: true, showNonImageAttachments: true, showImages: true });
  };

  proto.getRecentFiles = function (options) {
    const settings = Object.assign(
      { showMarkdown: true, showNonAttachments: true, showNonImageAttachments: false, showImages: false, maxCount: 10 },
      options,
    );
    const files = [];
    for (const path of this.lastOpenFiles) {
      const extension = env().su(path);
      if (extension === "md") {
        if (settings.showMarkdown) files.push(path);
      } else if (extension === "canvas" || extension === "base") {
        if (settings.showNonAttachments) files.push(path);
      } else if (env().Vy.includes(extension)) {
        if (settings.showImages) files.push(path);
      } else if (settings.showNonImageAttachments) {
        files.push(path);
      }
      if (files.length >= settings.maxCount) break;
    }
    return files;
  };

  return RecentFileTracker;
}
