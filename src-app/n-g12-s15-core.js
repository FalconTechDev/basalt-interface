// g12 clean-room: the Publish core plugin — state, persistence, file flag,
// hashing, change scanning, the HTTP API layer, commands, CLI and file-menu.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { account, acctRequest } from "./account.js";
import { lastSegment, parentPath, baseName, withoutExtension, extensionOf, withoutMd, normalizePath } from "./path.js";
import { formEncodePath } from "./text.js";

// ------------------------------------------------------------------ constants
export const ng12PublishUrl = "https://publish.basalt.md";
export const ng12PublishAssets = ["basalt.css", "publish.css", "favicon.ico", "publish.js"];
export const ng12PublishMaxUpload = 52428800;

/** env() passthrough kept for manifest declarators that referenced s15Env. */
export function ng12S15Env() {
  return env();
}

/** Change-diff ordering used by the review tree sections. */
export function ng12PublishItemSort(a, b) {
  return env().ub(a.path, b.path);
}

const ng12T = (key, fallback) => {
  try {
    const tree = env().gm && env().gm.plugins && env().gm.plugins.publish;
    const fn = tree && tree[key];
    if (typeof fn === "function") return fn();
    return typeof fn === "string" ? fn : fallback;
  } catch (e) {
    return fallback;
  }
};

// ------------------------------------------------------------------ error type
let ng12RequestErrorClass = null;
export function ng12PublishRequestErrorClass(host) {
  if (ng12RequestErrorClass) return ng12RequestErrorClass;

  class Ng12RequestError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "RequestError";
      this.code = code;
    }
  }

  ng12RequestErrorClass = Ng12RequestError;
  return Ng12RequestError;
}

// ------------------------------------------------------------------ plugin
let ng12PublishPluginClass = null;
export function ng12PublishPlugin(host) {
  if (ng12PublishPluginClass) return ng12PublishPluginClass;
  const RequestError = ng12PublishRequestErrorClass(host);
  const Base = host.Plugin || function Plugin() {};
  const i18n = () => env().gm.plugins.publish;

  class Ng12PublishPlugin extends Base {
    constructor() {
      super();
      this.id = "publish";
      this.name = ng12T("name", "Publish");
      this.description = ng12T("description", "Publish your notes to a website");
      this.app = null;
      this.vault = null;
      this.plugin = null;
      this.siteId = null;
      this.host = null;
      this.isGuest = false;
      this.includes = [];
      this.excludes = [];
      this.modal = null;
      this.requestSaveData = env().debounce
        ? env().debounce(() => this.saveData(), 2000)
        : () => this.saveData();
    }

    init(app, plugin) {
      this.app = app;
      this.vault = app.vault;
      this.plugin = plugin;
      const self = this;
      plugin.registerRibbonItem(
        ng12T("actionPublishChanges", "Publish changes"),
        "lucide-send",
        () => self.openPublishChanges()
      );
      plugin.registerGlobalCommand({
        id: "publish:view-changes",
        name: ng12T("actionPublishChanges", "Publish changes"),
        icon: "lucide-send",
        callback: () => self.openPublishChanges(),
      });
      plugin.registerGlobalCommand({
        id: "publish:publish-file",
        name: ng12T("actionPublishFile", "Publish file"),
        icon: "lucide-send",
        checkCallback: (checking) => {
          const file = self.app.workspace.getActiveFile();
          const ok = !!self.siteId && !!file && self.isFileSupported(file) && self.getPublishFlag(file) !== false;
          if (!checking && ok) self.uploadFile(file);
          return ok;
        },
      });
      plugin.registerGlobalCommand({
        id: "publish:open-in-live-site",
        name: ng12T("labelOpenInLiveSite", "Open in live site"),
        icon: "lucide-globe",
        checkCallback: (checking) => {
          const file = self.app.workspace.getActiveFile();
          const ok = !!self.siteId && !!file && self.isFileSupported(file) && self.getPublishFlag(file) !== false;
          if (!checking && ok) {
            self.getCurrentSlug().then((slug) => {
              window.open(ng12PublishUrl + "/" + slug + "/" + formEncodePath(withoutMd(file.path)));
            });
          }
          return ok;
        },
      });
      this.commandSpecs = [
        {
          id: "publish:view-changes",
          name: this.name + ": " + ng12T("actionPublishChanges", "Publish changes"),
          icon: "lucide-send",
          callback: () => self.openPublishChanges(),
        },
        {
          id: "publish:publish-file",
          name: this.name + ": " + ng12T("actionPublishFile", "Publish file"),
          icon: "lucide-send",
          checkCallback: (checking) => {
            const file = self.app.workspace.getActiveFile();
            const ok = !!self.siteId && !!file && self.isFileSupported(file) && self.getPublishFlag(file) !== false;
            if (!checking && ok) self.uploadFile(file);
            return ok;
          },
        },
        {
          id: "publish:open-in-live-site",
          name: this.name + ": " + ng12T("labelOpenInLiveSite", "Open in live site"),
          icon: "lucide-globe",
          checkCallback: (checking) => {
            const file = self.app.workspace.getActiveFile();
            const ok = !!self.siteId && !!file && self.isFileSupported(file) && self.getPublishFlag(file) !== false;
            if (!checking && ok) {
              self.getCurrentSlug().then((slug) => {
                window.open(ng12PublishUrl + "/" + slug + "/" + formEncodePath(withoutMd(file.path)));
              });
            }
            return ok;
          },
        },
      ];
    }

    ensureCommands() {
      try {
        const commands = this.app && this.app.commands && this.app.commands.commands;
        if (!commands || !this.commandSpecs) return;
        for (const spec of this.commandSpecs) {
          if (!commands[spec.id]) this.app.commands.addCommand(spec);
        }
      } catch (e) {}
    }

    async onEnable(app, plugin) {
      await this.loadData();
      this.registerCli(app, plugin);
      this.registerFileMenu(plugin);
      this.ensureCommands();
      const self = this;
      let heals = 0;
      const heal = () => {
        if (!self.app || !self.app.commands) return;
        self.ensureCommands();
        if (++heals < 40) self._healTimer = setTimeout(heal, 3000);
      };
      heal();
      self._healTimer = setTimeout(heal, 3000);
    }

    onDisable() {
      if (this._healTimer) clearTimeout(this._healTimer);
      this._healTimer = null;
      this.modal = null;
    }

    registerCli(app, plugin) {
      const self = this;
      const needSite = () => {
        if (!self.siteId) throw new Error("No publish site configured.");
      };
      const resolveFile = (args) => {
        if (args && args.path) {
          const f = app.vault.getAbstractFileByPath(args.path);
          if (!f) throw new Error('File "' + args.path + '" not found.');
          return f;
        }
        if (args && args.file) {
          const f = app.metadataCache.getFirstLinkpathDest(args.file, "");
          if (!f) throw new Error('File "' + args.file + '" not found.');
          return f;
        }
        const f = app.workspace.getActiveFile();
        if (!f) throw new Error("No active file.");
        return f;
      };

      plugin.registerCliHandler("publish:open", "Open file on published site", { file: {}, path: {} }, async (args) => {
        needSite();
        const file = resolveFile(args);
        const remote = await self.apiList();
        const entry = (remote.files || []).find((f) => f.path === file.path);
        if (!entry) throw new Error("File is not published.");
        const slug = await self.getCurrentSlug();
        const url = ng12PublishUrl + "/" + slug + "/" + formEncodePath(withoutMd(file.path));
        window.open(url);
        return url;
      });

      plugin.registerCliHandler("publish:status", "List publish changes", { total: {}, new: {}, changed: {}, deleted: {} }, async (args = {}) => {
        const diffs = await self.scanForChanges();
        let filtered;
        if (args.new) filtered = diffs.filter((d) => d.type === "new");
        else if (args.changed) filtered = diffs.filter((d) => d.type === "changed");
        else if (args.deleted) filtered = diffs.filter((d) => d.type === "deleted");
        else filtered = diffs.filter((d) => d.type !== "to-delete");
        if (args.total) return String(filtered.length);
        if (!filtered.length) return "No changes.";
        return filtered.map((d) => d.type + "\t" + d.path).join("\n");
      });

      plugin.registerCliHandler("publish:list", "List published files", { total: {} }, async (args = {}) => {
        needSite();
        const remote = await self.apiList();
        const files = (remote.files || []).map((f) => f.path).sort();
        if (args.total) return String(files.length);
        return files.join("\n");
      });

      plugin.registerCliHandler("publish:site", "Show publish site info", null, async () => {
        needSite();
        const slug = await self.getCurrentSlug();
        const lines = ["slug\t" + slug, "url\t" + ng12PublishUrl + "/" + slug];
        try {
          const custom = await self.apiCustomUrl();
          if (custom && custom.url) lines.push("custom\t" + custom.url);
        } catch (e) {}
        return lines.join("\n");
      });

      plugin.registerCliHandler("publish:add", "Publish a file or all changed files", { file: {}, path: {}, changed: {} }, async (args = {}) => {
        needSite();
        if (args.changed) {
          const diffs = await self.scanForChanges();
          const targets = diffs.filter((d) => (d.type === "new" || d.type === "changed") && app.vault.getAbstractFileByPath(d.path));
          const failed = [];
          for (const d of targets) {
            try { await self.apiUploadFile(app.vault.getAbstractFileByPath(d.path)); }
            catch (e) { failed.push(d.path); }
          }
          if (failed.length) {
            return "Published " + (targets.length - failed.length) + " files, " + failed.length + " failed:\n" + failed.join("\n");
          }
          return "Published " + targets.length + " files:\n" + targets.map((d) => d.path).join("\n");
        }
        const file = resolveFile(args);
        if (!self.isFileSupported(file)) throw new Error("File type is not supported for publishing.");
        if (self.getPublishFlag(file) === false) throw new Error("Publishing is disabled for this file.");
        await self.apiUploadFile(file);
        return "Published: " + file.path;
      });

      plugin.registerCliHandler("publish:remove", "Unpublish a file", { path: {}, file: {} }, async (args = {}) => {
        needSite();
        const file = resolveFile(args);
        await self.apiRemoveFile(file.path);
        return "Unpublished: " + file.path;
      });
    }

    registerFileMenu(plugin) {
      const self = this;
      plugin.register(() => {
        this.app.workspace.on("file-menu", (menu, file, source) => {
          if (!(file instanceof host.TFile)) return;
          if (["tab-header", "more-options", "file-explorer-context-menu"].indexOf(source) < 0) return;
          if (!self.isFileSupported(file) || self.getPublishFlag(file) === false) return;
          menu.addItem((item) => {
            item.setTitle(ng12T("actionPublishFile", "Publish file"))
              .setIcon("lucide-send")
              .onClick(() => self.uploadFile(file));
          });
        });
      });
    }

    // ------------------------------------------------------------ persistence
    async loadData() {
      try {
        const data = (await this.plugin.loadData()) || {};
        this.siteId = data.siteId != null ? data.siteId : null;
        this.host = data.host != null ? data.host : null;
        this.includes = Array.isArray(data.included) ? data.included.slice() : [];
        this.excludes = Array.isArray(data.excluded) ? data.excluded.slice() : [];
      } catch (e) {
        console.error(e);
      }
    }

    async saveData() {
      await this.plugin.saveData({
        siteId: this.siteId,
        host: this.host,
        included: this.includes,
        excluded: this.excludes,
      });
    }

    async setup(siteId, host_) {
      this.siteId = siteId;
      this.host = host_;
      await this.saveData();
    }

    async setIncludes(arr) {
      this.includes = arr || [];
      await this.saveData();
    }

    async setExcludes(arr) {
      this.excludes = arr || [];
      await this.saveData();
    }

    // ------------------------------------------------------------ file support
    getHost() {
      const h = this.host || "127.0.0.1:3002";
      return (/^(localhost|127\.0\.0\.1)/.test(h) ? "http://" : "https://") + h;
    }

    isFileSupported(file) {
      if (!file) return false;
      const ext = file.extension || extensionOf(file.path || "");
      if (env().Ky && env().Ky.includes(ext)) return true;
      return ng12PublishAssets.includes(file.name);
    }

    getPublishFlag(file) {
      if (!file) return null;
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) return null;
      const fm = cache.frontmatter;
      if (fm && Object.prototype.hasOwnProperty.call(fm, "publish")) {
        const flag = fm.publish;
        if (typeof flag === "string") {
          const s = flag.toLowerCase();
          if (s === "false" || s === "no") return false;
          if (s === "true" || s === "yes") return true;
        }
        if (flag !== null && flag !== undefined) return !!flag;
      }
      const path = file.path;
      for (const prefix of this.excludes) {
        if (path.startsWith(prefix + "/")) return false;
      }
      for (const prefix of this.includes) {
        if (path.startsWith(prefix + "/")) return true;
      }
      return null;
    }

    getHashFromMetadataCache(file) {
      const cache = this.app.metadataCache.getFileInfo
        ? this.app.metadataCache.getFileInfo(file.path)
        : this.app.metadataCache.getFileCache(file);
      if (!cache) return null;
      if (cache.mtime === file.stat.mtime && cache.size === file.stat.size) {
        return cache.hash || null;
      }
      return null;
    }

    async computeHash(file) {
      const data = await this.vault.readBinary(file);
      return host.contentHash(data);
    }

    async getHash(file) {
      const cached = this.getHashFromMetadataCache(file);
      if (cached) return cached;
      return this.computeHash(file);
    }

    // ------------------------------------------------------------ change scan
    async scanForChanges() {
      const remote = await this.apiList();
      this.isGuest = !remote.owner;
      const remoteFiles = remote.files || [];
      const remoteDiffs = [];
      const pendingRemote = {};

      for (const entry of remoteFiles) {
        const local = this.vault.getAbstractFileByPath(entry.path);
        if (!local || !(local instanceof host.TFile)) {
          remoteDiffs.push({
            path: entry.path,
            ctime: entry.ctime,
            mtime: entry.mtime,
            size: entry.size,
            type: "deleted",
            checked: false,
          });
          pendingRemote[entry.path] = true;
          continue;
        }
        const flag = this.getPublishFlag(local);
        if (flag === false) {
          remoteDiffs.push({
            path: entry.path,
            ctime: entry.ctime,
            mtime: entry.mtime,
            size: entry.size,
            type: "deleted",
            checked: false,
          });
          pendingRemote[entry.path] = true;
          continue;
        }
        const hash = await this.getHash(local);
        if (hash !== entry.hash) {
          remoteDiffs.push({
            path: entry.path,
            ctime: entry.ctime,
            mtime: entry.mtime,
            size: entry.size,
            type: "changed",
            checked: flag === true,
          });
          pendingRemote[entry.path] = true;
        } else {
          remoteDiffs.push({
            path: entry.path,
            ctime: entry.ctime,
            mtime: entry.mtime,
            size: entry.size,
            type: "to-delete",
            checked: false,
          });
        }
      }

      // vault walk: DFS from root, folders push children, pop order for files
      const diffs = [];
      const stack = [this.vault.getRoot()];
      while (stack.length) {
        const node = stack.pop();
        const children = node.children || [];
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        if (node instanceof host.TFolder) continue;
        if (!(node instanceof host.TFile)) continue;
        if (!this.isFileSupported(node)) continue;
        if (pendingRemote[node.path]) continue;
        const flag = this.getPublishFlag(node);
        if (flag === false) continue;
        diffs.push({
          path: node.path,
          ctime: 0,
          mtime: 0,
          size: 0,
          type: "new",
          checked: flag === true,
        });
      }
      return diffs.concat(remoteDiffs);
    }

    // ------------------------------------------------------------ HTTP layer
    async apiRequest(req) {
      let text;
      try {
        text = await env().ajaxPromise(req);
      } catch (e) {
        let msg = "Unknown";
        if (e instanceof XMLHttpRequest) msg = "Network unavailable.";
        else if (e instanceof Error) msg = e.message;
        throw new RequestError("NET", msg);
      }
      const data = JSON.parse(text);
      if (data && data.code && data.message) {
        throw new RequestError(data.code, data.message);
      }
      return data;
    }

    apiPostFrontend(path, body) {
      const payload = Object.assign({}, body);
      payload.token = account.token;
      return this.apiRequest({
        method: "POST",
        url: ng12PublishUrl + "/" + path,
        data: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      });
    }

    apiPostBackend(path, body) {
      const payload = Object.assign({}, body);
      payload.id = this.siteId;
      payload.token = account.token;
      return this.apiRequest({
        method: "POST",
        url: this.getHost() + "/" + path,
        data: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      });
    }

    apiSetSlug(id, host_, slug) {
      return this.apiPostFrontend("api/slug", { id, host: host_, slug });
    }

    apiGetSlugs(ids) {
      return this.apiPostFrontend("api/slugs", { ids });
    }

    apiCheckSlug(slug) {
      return this.apiPostFrontend("api/site", { slug });
    }

    apiCustomUrl(url, redirect) {
      return this.apiPostFrontend("api/customurl", { id: this.siteId, host: this.host, url, redirect });
    }

    apiList() {
      return this.apiPostBackend("api/list", { version: 2 });
    }

    apiOptions(options) {
      return this.apiPostBackend("api/options", { options });
    }

    apiGetPassword() {
      return this.apiPostBackend("api/password", {});
    }

    apiAddPassword(name, pw) {
      return this.apiPostBackend("api/password", { name, pw });
    }

    apiDelPassword(del) {
      return this.apiPostBackend("api/password", { del });
    }

    apiRemoveFile(path) {
      return this.apiPostBackend("api/remove", { path });
    }

    async apiUploadFile(file) {
      if (file.stat.size > ng12PublishMaxUpload) {
        throw new RequestError("TOOLARGE", "File is larger than 50mb.");
      }
      const hash = await this.getHash(file);
      const data = await this.vault.readBinary(file);
      return this.apiRequest({
        method: "POST",
        url: this.getHost() + "/api/upload",
        data,
        headers: {
          "obs-token": account.token,
          "obs-id": this.siteId,
          "obs-path": encodeURIComponent(file.path),
          "obs-hash": hash,
        },
      });
    }

    async apiDownloadFile(path) {
      const res = await fetch(this.getHost() + "/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: this.siteId, token: account.token, path }),
      });
      return res.arrayBuffer();
    }

    async getCurrentSlug() {
      try {
        const slugs = await this.apiGetSlugs([this.siteId]);
        return slugs[this.siteId] || this.siteId;
      } catch (e) {
        return this.siteId;
      }
    }

    // ------------------------------------------------------------ UI entry
    openModal(autoLoad) {
      if (this.modal) return this.modal;
      const ModalClass = env().z7;
      this.modal = new ModalClass(this.app, this);
      return this.modal;
    }

    openPublishChanges() {
      const modal = this.openModal(true);
      modal.open();
      return modal;
    }

    viewSites() {
      const modal = this.openModal(true);
      modal.open();
      if (modal.openManageSites) modal.openManageSites();
      return modal;
    }

    async uploadFile(file) {
      if (!this.siteId) {
        new (env().fb)(ng12T("msgNoSiteConfigured", "No publish site configured."));
        return;
      }
      try {
        await this.apiUploadFile(file);
        new (env().fb)(file.path + " published.");
      } catch (e) {
        if (this.modal && this.modal.handleError) this.modal.handleError(e);
        else new (env().fb)(String(e && e.message || e));
      }
    }
  }

  ng12PublishPluginClass = Ng12PublishPlugin;
  return Ng12PublishPlugin;
}
