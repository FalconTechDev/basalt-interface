// s04: own implementations of the CSS theme/snippet manager and its small
// helpers (deferred, cached calls, promise sets, community theme list).
//
// Replaces the inherited `customCss` manager: it watches the vault for
// theme/snippet changes, keeps theme.css + snippet <style> elements in
// document.head in sync, and installs/updates themes from GitHub.
//
// Inherited pieces are reached through the factory's host table (Component,
// debounce, SerialTaskQueue, Notice, i18n) or env() (Platform helpers,
// translucency IPC, electronWindow). HTTP goes through the own s04-http
// helpers; path/string helpers are the own flat-scope functions.

import { env } from "./env.js";

const S04_THEME_FILE = "theme.css";
const S04_MANIFEST_FILE = "manifest.json";
const S04_THEMES_URL = "obsidianmd/obsidian-releases/community-css-themes.json";

// ---------------------------------------------------------------- small async helpers (was `gb`, `yb`, `Eb`, `Mb`)

/** A promise with exposed resolve/reject (was `gb`). */
export function s04CreateDeferred() {
  const deferred = { promise: null, resolve: null, reject: null };
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
}

/**
 * Wraps `fetcher` in a TTL cache with in-flight dedupe (was `yb`).
 * `cacheMs` is how long a successful result stays fresh; `dedupeMs` (default
 * `cacheMs`) is the window after a failure during which the previous result
 * is still served instead of refetching.
 */
export function s04CachedCall(fetcher, cacheMs, dedupeMs) {
  if (dedupeMs === undefined) dedupeMs = cacheMs;
  let pending = null;
  let freshUntil = 0;
  let result = null;
  return function () {
    if (pending) return pending;
    if (result && freshUntil > Date.now()) return Promise.resolve(result);
    pending = (async () => {
      freshUntil = Date.now() + dedupeMs;
      try {
        result = await fetcher();
      } catch (err) {
        pending = null;
        return null;
      }
      freshUntil = Date.now() + cacheMs;
      pending = null;
      setTimeout(() => {
        if (freshUntil > Date.now()) result = null;
      }, cacheMs);
      return result;
    })();
    return pending;
  };
}

/** Collects promises; `promise()` awaits all added so far (was `Eb`). */
export function s04PromiseSetClass() {
  class PromiseSet {
    constructor() {
      this.promises = [];
    }
    add(task) {
      this.promises.push(task());
    }
    addPromise(promise) {
      this.promises.push(promise);
    }
    isEmpty() {
      return this.promises.length === 0;
    }
    promise() {
      return Promise.all(this.promises);
    }
  }
  return PromiseSet;
}

/** Resolves (never rejects) once `promise` settles, with its value or undefined (was `Mb`). */
export function s04SettlePromise(promise) {
  return new Promise((resolve) => promise.then(resolve, resolve));
}

// ---------------------------------------------------------------- community theme list (was `Ab`, `Pb`, `Lb`)

const S04_COMMUNITY_THEMES_REPO = "obsidianmd/obsidian-releases";

/** Raw URL of the community theme catalog (was `Ab`). */
export const s04CommunityThemesUrl = s04RawFileUrl(S04_COMMUNITY_THEMES_REPO, "community-css-themes.json");

/** Cached loader for the community theme catalog (was `Pb`). */
export const s04CommunityThemes = s04CachedCall(async () => {
  const list = await s04Request(s04RawFileUrl(S04_COMMUNITY_THEMES_REPO, "community-css-themes.json")).json;
  if (!Array.isArray(list)) throw new Error("Failed to parse community themes.");
  return list;
}, 3e5, 6e4);

/** Cached empty catalog used where fetching is unavailable (was `Lb`). */
export const s04CommunityThemesEmpty = s04CachedCall(() => Promise.resolve({}), 3e5, 6e4);

// ---------------------------------------------------------------- string helpers (was `cb`, `hb`, `pb`)

const S04_COLLATOR = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });

/** Locale-aware string compare used for file lists (was `cb`). */
export const s04StringCompare = S04_COLLATOR.compare;

/** Descending variant (was `hb`). */
export function s04StringCompareDesc(a, b) {
  return -S04_COLLATOR.compare(a, b);
}

/** Numeric compare (was `pb`). */
export function s04NumberCompare(a, b) {
  return a - b;
}

// ---------------------------------------------------------------- the manager (was `Ib`)

/**
 * The `app.customCss` manager: keeps the active theme and enabled snippets
 * rendered into <style> elements and handles theme install/update flows.
 */
export function s04CssManager(host) {
  function CssManager(app) {
    const self = host.Component.call(this) || this;
    self.app = null;
    self.styleEl = null;
    self.extraStyleEls = [];
    self.boundRaw = self.onRaw.bind(self);
    self.oldThemes = [];
    self.themes = {};
    self.updates = {};
    self.snippets = [];
    self.enabledSnippets = new Set();
    self.csscache = new Map();
    self.theme = "";
    self.requestLoadTheme = host.debounce(self.loadTheme.bind(self), 100);
    self.requestLoadSnippets = host.debounce(self.loadSnippets.bind(self), 100);
    self.requestReadThemes = host.debounce(self.readThemes.bind(self), 2000);
    self.queue = new host.SerialTaskQueue();
    self.app = app;
    return self;
  }
  Object.setPrototypeOf(CssManager, host.Component);
  CssManager.prototype = Object.create(host.Component.prototype, {
    constructor: { value: CssManager, writable: true, configurable: true },
  });

  CssManager.prototype.onload = async function () {
    host.Component.prototype.onload.call(this);
    const app = this.app;
    this.loadData();
    await this.readThemes();
    await this.readSnippets();
    this.styleEl = document.head.createEl("style", { type: "text/css" });
    this.registerEvent(app.vault.on("raw", this.boundRaw));
    await this.loadTheme();
    await this.loadSnippets();
  };

  CssManager.prototype.loadData = function () {
    const vault = this.app.vault;
    const snippets = vault.getConfig("enabledCssSnippets");
    if (snippets) this.enabledSnippets = new Set(snippets);
    const theme = vault.getConfig("cssTheme");
    if (theme) this.theme = theme;
    if (vault.getConfig("translucency")) this.enableTranslucency();
  };

  CssManager.prototype.reloadTheme = function () {
    this.theme = this.app.vault.getConfig("cssTheme") || "";
    this.requestLoadTheme();
  };

  CssManager.prototype.readThemes = function (reload) {
    const self = this;
    return this.queue.queue(async function () {
      const app = self.app;
      const adapter = self.app.vault.adapter;
      const legacy = [];
      const themes = {};
      const folder = self.getThemeFolder();
      if (await app.vault.exists(folder)) {
        const listing = await adapter.list(folder);
        for (const dir of listing.folders) {
          const name = lastSegment(dir);
          const manifestPath = normalizePath(dir + "/" + S04_MANIFEST_FILE);
          const cssPath = normalizePath(dir + "/" + S04_THEME_FILE);
          try {
            if (!(await adapter.exists(cssPath))) continue;
            const raw = await adapter.read(manifestPath);
            const manifest = JSON.parse(raw);
            if (manifest.name && manifest.name === name) themes[name] = manifest;
          } catch (err) {
            console.error(err);
          }
        }
        for (const file of listing.files) {
          const name = lastSegment(file);
          if (name.startsWith(".") || extensionOf(name) !== "css") continue;
          legacy.push(baseName(name));
        }
      }
      self.oldThemes = legacy;
      self.themes = themes;
      if (reload) self.requestLoadTheme();
    });
  };

  CssManager.prototype.readSnippets = function (reload) {
    const self = this;
    return this.queue.queue(async function () {
      const vault = self.app.vault;
      const adapter = vault.adapter;
      const names = [];
      const folder = self.getSnippetsFolder();
      if (await adapter.exists(folder)) {
        const listing = await adapter.list(folder);
        for (const file of listing.files) {
          const name = lastSegment(file);
          if (name.startsWith(".") || extensionOf(name) !== "css") continue;
          names.push(baseName(name));
        }
      }
      names.sort(s04StringCompare);
      self.snippets = names;
      if (reload) self.requestLoadSnippets();
    });
  };

  CssManager.prototype.onRaw = function (path) {
    if (this.csscache.has(path)) this.csscache.delete(path);
    const name = lastSegment(path);
    const ext = extensionOf(name);
    if (path === this.getThemePath(this.theme)) this.requestLoadTheme();
    if (
      path.startsWith(this.getThemeFolder()) &&
      (name === S04_MANIFEST_FILE || name === S04_THEME_FILE || ext === "css")
    ) {
      this.requestReadThemes();
    }
    if (path.startsWith(this.getSnippetsFolder()) && ext === "css") this.readSnippets(true);
  };

  CssManager.prototype.loadTheme = function (css) {
    const self = this;
    return this.queue.queue(async function () {
      const styleEl = self.styleEl;
      const theme = self.theme;
      let text = "";
      if (css) {
        text = css;
      } else if (theme) {
        text = await self.loadCss(self.getThemePath(theme));
      }
      if (styleEl.textContent !== text) {
        styleEl.textContent = text;
        self.app.workspace.trigger("css-change");
        self.app.workspace.trigger("resize");
      }
    });
  };

  CssManager.prototype.loadSnippets = function () {
    const self = this;
    return this.queue.queue(async function () {
      const styleEl = self.styleEl;
      const extraStyleEls = self.extraStyleEls;
      const enabled = self.enabledSnippets;
      const texts = [];
      for (const name of self.snippets) {
        if (!enabled.has(name)) continue;
        texts.push(await self.loadCss(self.getSnippetPath(name)));
      }
      let changed = false;
      for (let i = 0; i < texts.length; i++) {
        let el = extraStyleEls[i];
        if (!el) {
          el = host.createEl("style", { type: "text/css" });
          extraStyleEls.push(el);
          styleEl.parentNode.insertAfter(el, styleEl);
          changed = true;
        }
        if (el.textContent !== texts[i]) {
          el.textContent = texts[i];
          changed = true;
        }
        styleEl = el;
      }
      const extra = extraStyleEls.length - texts.length;
      for (let i = 0; i < extra; i++) {
        extraStyleEls.pop().detach();
        changed = true;
      }
      if (changed) {
        self.app.workspace.trigger("css-change");
        self.app.workspace.trigger("resize");
      }
    });
  };

  CssManager.prototype.loadCss = async function (path) {
    if (this.csscache.has(path)) return this.csscache.get(path);
    const adapter = this.app.vault.adapter;
    if (await adapter.exists(path)) {
      const css = await adapter.read(path);
      this.csscache.set(path, css);
      return css;
    }
    return "";
  };

  CssManager.prototype.setCssEnabledStatus = function (name, enabled) {
    if (enabled) this.enabledSnippets.add(name);
    else this.enabledSnippets.delete(name);
    this.app.vault.setConfig("enabledCssSnippets", Array.from(this.enabledSnippets));
    this.requestLoadSnippets();
  };

  CssManager.prototype.setTheme = function (name) {
    this.theme = name;
    this.app.vault.setConfig("cssTheme", name);
    this.requestLoadTheme();
  };

  CssManager.prototype.setTranslucency = function (enabled) {
    this.app.vault.setConfig("translucency", enabled);
    if (enabled) this.enableTranslucency();
    else this.disableTranslucency();
  };

  CssManager.prototype.enableTranslucency = function () {
    const { Yl, Uf, Wf, electronWindow } = env();
    if (!(Yl.isDesktopApp && Uf())) return;
    try {
      Wf(electronWindow, true);
      document.body.addClass("is-translucent");
    } catch (err) {
      new host.Notice(host.t.interface.msgUpgradeInstaller());
    }
  };

  CssManager.prototype.disableTranslucency = function () {
    const { Yl, Uf, Wf, electronWindow } = env();
    if (!(Yl.isDesktopApp && Uf())) return;
    document.body.removeClass("is-translucent");
    try {
      Wf(electronWindow, false);
    } catch (err) {}
  };

  CssManager.prototype.isDarkMode = function () {
    return document.body.hasClass("theme-dark");
  };

  CssManager.prototype.getThemeFolder = function () {
    return this.app.vault.configDir + "/themes";
  };

  CssManager.prototype.getSnippetsFolder = function () {
    return this.app.vault.configDir + "/snippets";
  };

  CssManager.prototype.getThemePath = function (name) {
    if (!this.themes.hasOwnProperty(name) && this.oldThemes.includes(name)) {
      return this.getThemeFolder() + "/" + name + ".css";
    }
    return this.getThemeFolder() + "/" + name + "/" + S04_THEME_FILE;
  };

  CssManager.prototype.getSnippetPath = function (name) {
    return this.getSnippetsFolder() + "/" + name + ".css";
  };

  CssManager.prototype.removeTheme = async function (name) {
    const adapter = this.app.vault.adapter;
    const folder = this.getThemeFolder();
    const dir = folder + "/" + name;
    if (await adapter.exists(dir)) await adapter.rmdir(dir, true);
    const legacyPath = folder + "/" + name + ".css";
    const isLegacy = this.oldThemes.includes(name) && (await adapter.exists(legacyPath));
    if (isLegacy) await adapter.remove(legacyPath);
    await this.readThemes();
    if (this.theme === name) this.setTheme("");
  };

  CssManager.prototype.downloadLegacyTheme = function (info) {
    return s04Request(s04RawFileUrl(info.repo, "obsidian.css")).text;
  };

  CssManager.prototype.isThemeInstalled = function (name) {
    return this.themes.hasOwnProperty(name) || this.oldThemes.includes(name);
  };

  CssManager.prototype.hasUpdates = function () {
    return this.updates && Object.keys(this.updates).length > 0;
  };

  CssManager.prototype.checkForUpdate = async function (info) {
    const folder = this.getThemeFolder();
    const updates = this.updates || {};
    const name = info.name;
    const repo = info.repo;
    if (!this.isThemeInstalled(name)) return;
    let installedVersion = this.themes[name] ? this.themes[name].version : undefined;
    const manifestPath = s04RawFileUrl(repo, S04_MANIFEST_FILE);
    let manifest = null;
    try {
      manifest = await s04Request(manifestPath).json;
    } catch (err) {}
    if (!manifest) {
      const css = await this.downloadLegacyTheme(info);
      const hasDir = !!(this.themes[info.name] && this.themes[info.name].dir);
      const cssPath = hasDir ? folder + "/" + name + "/" + S04_THEME_FILE : folder + "/" + name + ".css";
      let current = "";
      try {
        current = await this.app.vault.adapter.read(cssPath);
      } catch (err) {
        return false;
      }
      if (css !== current) {
        updates[name] = { themeInfo: info };
        return true;
      }
      return false;
    }
    const latest = await s04ThemeVersion(repo, manifest);
    if (!installedVersion || (latest && isOlderVersion(installedVersion, latest))) {
      updates[name] = { themeInfo: info, version: latest };
      return true;
    }
    return false;
  };

  CssManager.prototype.checkForUpdates = async function () {
    this.updates = {};
    let themes;
    try {
      themes = await s04CommunityThemes();
    } catch (err) {
      console.error(err);
      new host.Notice(host.t.plugins.customCss.msgFailedToInstallTheme());
      return;
    }
    for (let i = 0; i < themes.length; i++) {
      await this.checkForUpdate(themes[i]);
    }
    const count = Object.keys(this.updates).length;
    new host.Notice(
      count === 0
        ? host.t.plugins.customCss.msgNoUpdatesFound()
        : host.t.plugins.customCss.msgUpdatesFound({ count })
    );
  };

  CssManager.prototype.installLegacyTheme = async function (info) {
    const vault = this.app.vault;
    const name = info.name;
    const css = await this.downloadLegacyTheme(info);
    const folder = this.getThemeFolder();
    if (!(await vault.exists(folder))) await vault.createFolder(folder);
    const dir = folder + "/" + name;
    if (!(await vault.exists(dir))) await vault.createFolder(dir);
    const manifest = { name: info.name, version: "0.0.0", minAppVersion: "0.16.0", author: info.author };
    await vault.adapter.write(dir + "/" + S04_THEME_FILE, css);
    await vault.adapter.write(dir + "/" + S04_MANIFEST_FILE, JSON.stringify(manifest, null, 4));
    const legacyPath = folder + "/" + name + ".css";
    if (await vault.adapter.exists(legacyPath)) await vault.adapter.remove(legacyPath);
    await this.readThemes();
  };

  CssManager.prototype.installTheme = async function (info, version) {
    const name = info.name;
    const repo = info.repo;
    const notice = new host.Notice(host.t.plugins.customCss.msgInstallingTheme({ name }), 0);
    notice.containerEl.addClass("is-loading");
    try {
      let installed = localStorage.getItem("local-themes");
      let list = installed ? JSON.parse(installed) : [];
      if (!Array.isArray(list)) list = [];
      if (!list.contains(name)) {
        list.push(name);
        localStorage.setItem("local-themes", JSON.stringify(list));
      }
    } catch (err) {
      console.error(err);
    }
    if (!version) {
      await this.installLegacyTheme(info);
      delete this.updates[name];
      notice.hide();
      return;
    }
    let manifestText;
    let cssText;
    try {
      manifestText = await s04Request(s04ReleaseUrl(repo, version, S04_MANIFEST_FILE)).text;
      cssText = await s04Request(s04ReleaseUrl(repo, version, S04_THEME_FILE)).text;
    } catch (err) {
      if (manifestText === undefined && err instanceof S04RequestError && err.status === 404) {
        try {
          manifestText = await s04Request(s04RawFileUrl(repo, S04_MANIFEST_FILE)).text;
          cssText = await s04Request(s04RawFileUrl(repo, S04_THEME_FILE)).text;
        } catch (fallbackErr) {
          console.error(fallbackErr);
          notice.containerEl.removeClass("is-loading");
          notice.containerEl.addClass("mod-error");
          notice.setMessage(host.t.plugins.customCss.msgFailedToInstallTheme({ name }));
          setTimeout(() => notice.hide(), 3000);
          return;
        }
      } else {
        console.error(err);
        notice.containerEl.removeClass("is-loading");
        notice.containerEl.addClass("mod-error");
        notice.setMessage(host.t.plugins.customCss.msgFailedToInstallTheme({ name }));
        setTimeout(() => notice.hide(), 3000);
        return;
      }
    }
    if (JSON.parse(manifestText).name !== name) {
      notice.containerEl.removeClass("is-loading");
      notice.setMessage(host.t.plugins.customCss.msgFailedToInstallTheme({ name }) + " Theme name mismatch.");
      setTimeout(() => notice.hide(), 3000);
      return;
    }
    const adapter = this.app.vault.adapter;
    const folder = this.getThemeFolder();
    if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
    const dir = folder + "/" + name;
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    await adapter.write(dir + "/" + S04_MANIFEST_FILE, manifestText);
    await adapter.write(dir + "/" + S04_THEME_FILE, cssText);
    const legacyPath = folder + "/" + name + ".css";
    if (await adapter.exists(legacyPath)) await adapter.remove(legacyPath);
    notice.setMessage(host.t.plugins.customCss.msgSuccessfullyInstalledTheme({ name }));
    notice.containerEl.removeClass("is-loading");
    notice.containerEl.addClass("mod-success");
    setTimeout(() => notice.hide(), 3000);
    delete this.updates[name];
    await this.readThemes();
  };

  CssManager.prototype.getManifest = async function (repo) {
    let manifest = null;
    try {
      manifest = await s04Request(s04RawFileUrl(repo, S04_MANIFEST_FILE)).json;
    } catch (err) {}
    return manifest;
  };

  return CssManager;
}
