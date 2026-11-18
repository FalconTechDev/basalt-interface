// s12 plugins and core services: recent-file tracking, webviewer helpers and shared utilities.
// App classes come from the __basaltHost object; inherited helpers come from env().

import { env } from "./env.js";
import { s12imageContextMenu } from "./n-g10-s12-livepreview.js";

const S12PENV = () => env();

let S12RecentFiles = null;

/** Recent-file tracker: keeps the last opened notes/canvases/images for the "Open recent" suggestions. */
export function defineS12RecentFiles(host) {
  const extOf = S12PENV().su;
  const mdSet = S12PENV().s12extMarkdown, canvasSet = S12PENV().s12extCanvas, imageSet = S12PENV().s12extImage;
  S12RecentFiles = class {
    constructor(workspace, vault) {
      this.workspace = workspace;
      this.vault = vault;
      this.lastOpenFiles = [];
      vault.on("create", this.addRecentFile, this);
      vault.on("rename", this.onRename, this);
    }
    load(files) { this.lastOpenFiles = files; }
    serialize() { return this.lastOpenFiles; }
    collect(file) {
      if (this.lastOpenFiles[0] === file.path) return;
      const quota = { md: 25, canvas: 10, image: 10, other: 10 };
      const next = [file.path];
      for (const path of this.lastOpenFiles) {
        if (path === file.path) continue;
        const ext = extOf(path);
        let kind = "other";
        if (mdSet.includes(ext)) kind = "md";
        else if (canvasSet.includes(ext)) kind = "canvas";
        else if (imageSet.includes(ext)) kind = "image";
        const left = quota[kind];
        if (left <= 0) continue;
        next.push(path);
        quota[kind] = left - 1;
      }
      this.lastOpenFiles = next;
    }
    onFileOpen(_leaf, file) {
      if (this.workspace.layoutReady && file) {
        this.collect(file);
        this.workspace.requestSaveLayout();
      }
    }
    addRecentFile(file) {
      if (this.workspace.layoutReady) {
        this.collect(file);
        this.workspace.requestSaveLayout();
      }
    }
    onRename(file, oldPath) {
      if (!this.workspace.layoutReady) return;
      this.lastOpenFiles = this.lastOpenFiles.map((p) => (p === oldPath ? file.path : p));
      this.workspace.requestSaveLayout();
    }
    getLastOpenFiles() {
      return this.getRecentFiles({ showMarkdown: true, showNonAttachments: true, showNonImageAttachments: true, showImages: true });
    }
    getRecentFiles(options) {
      const opts = Object.assign({ showMarkdown: true, showNonAttachments: true, showNonImageAttachments: false, showImages: false, maxCount: 10 }, options);
      const out = [];
      for (const path of this.lastOpenFiles) {
        const ext = extOf(path);
        if ("md" === ext) { if (opts.showMarkdown) out.push(path); }
        else if ("canvas" === ext || "base" === ext) { if (opts.showNonAttachments) out.push(path); }
        else if (imageSet.includes(ext)) { if (opts.showImages) out.push(path); }
        else if (opts.showNonImageAttachments) out.push(path);
        if (out.length >= opts.maxCount) break;
      }
      return out;
    }
  };
  return S12RecentFiles;
}

/** d6: shared image context menu + resize corner used by live-preview image widgets. */
export function s12ImageContextMenuEntry(widget, view, containerEl, imgEl, wrapperEl) {
  s12imageContextMenu(widget, view, containerEl, imgEl, wrapperEl);
}
