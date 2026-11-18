// n-g14-community-plugins.js — clean-room replacement for the community (third-party)
// plugin manager, spec g14 §3.2. Own architecture: the public CommunityPlugins class
// composes four small collaborators — a manifest scanner, a sandbox loader, an
// install pipeline and an update/deprecation poller — instead of one prototype bag.
//
// Frozen contract: app.plugins surface (manifests/plugins/enabledPlugins/updates/
// autoCheckForUpdates/lastUpdateCheck/loadingPluginId + the method table in spec §2.2),
// storage keys (community-plugins.json, enable-plugin-<appId>,
// plugin-automatically-check-for-updates, last-plugin-update-check), feed URLs and
// every Notice text named by the spec.
//
// Flat shared scope: helpers below are ng14-prefixed; host values are read lazily
// through `host` inside functions only.

import { env, hostEnv } from "./env.js";
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";

// window.require captured once at module load (spec §2.2); null off the desktop bridge.
const ng14WindowRequire = typeof window !== "undefined" ? window.require || null : null;

// Module-level deprecation map holder (spec: shared across manager instances).
const ng14Deprecation = { map: {}, fetched: false, pending: null };

const ng14PluginsT = (host) => host.t.setting.thirdPartyPlugin;
const ng14I18n = (host) => host.t;

/** (a) Manifest scanner: reads <dir>/manifest.json, normalises author, tags dir. */
function ng14ScanManifest(host, raw, dir) {
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!manifest || typeof manifest !== "object" || !manifest.id) return null;
  manifest.dir = dir;
  if (!manifest.author || String(manifest.author).toLowerCase() === "basalt") manifest.author = "";
  return manifest;
}

/** (b) Sandbox loader: builds the require() handed to plugin main.js. */
function ng14PluginRequire(host, app, emulateMobile) {
  return function (reqId) {
    if (host.cmDeprecatedMap && host.cmDeprecatedMap[reqId]) {
      console.error("Community plugin attempted to load deprecated CodeMirror 6 package: " + reqId);
      return host.cmDeprecatedMap[reqId];
    }
    if (host.cmRequireMap && host.cmRequireMap[reqId]) return host.cmRequireMap[reqId];
    if (emulateMobile) {
      new host.Notice(reqId + " attempted to load NodeJS package: \"" + reqId + "\"");
      console.error("Plugin attempted to load NodeJS package: " + reqId);
      return null;
    }
    if (ng14WindowRequire) {
      try {
        return ng14WindowRequire(reqId);
      } catch (err) {
        return undefined;
      }
    }
    return undefined;
  };
}

/** Strips inline sourcemaps unless the file already carries the nosourcemap marker. */
function ng14StripSourcemaps(code) {
  if (code.endsWith("/* nosourcemap */") || code.indexOf("nosourcemap") !== -1) return code;
  return code.replace(s12InlineSourcemapPattern(), "");
}

/** (c) Install pipeline: download manifest/main.js/styles.css into plugins/<id>. */
async function ng14InstallFiles(host, app, repo, tag, info) {
  const t = ng14PluginsT(host);
  const notice = new host.Notice(t.msgInstallingPlugin({ name: info.name }), 0);
  notice.containerEl.addClass("is-loading");
  const fail = (message) => {
    notice.containerEl.removeClass("is-loading");
    notice.setMessage(message);
    setTimeout(() => notice.hide(), 3000);
  };
  let manifestText;
  let manifest;
  try {
    manifestText = await s04RequestText(s04ReleaseUrl(repo, tag, "manifest.json"));
    manifest = JSON.parse(manifestText);
  } catch (err) {
    manifestText = undefined;
  }
  if (manifestText !== undefined && manifest && manifest.id !== info.id) {
    fail("Plugin ID mismatch.");
    return false;
  }
  if (manifestText === undefined) {
    fail(t.msgFailedToInstallPlugin({ name: info.name }));
    return false;
  }
  const adapter = app.vault.adapter;
  const base = app.vault.configDir + "/plugins";
  const dir = base + "/" + info.id;
  try {
    if (!(await app.vault.exists(base))) await adapter.mkdir(base);
    if (!(await app.vault.exists(dir))) await adapter.mkdir(dir);
    await adapter.write(dir + "/manifest.json", manifestText);
    try {
      let mainJs = await s04RequestText(s04ReleaseUrl(repo, tag, "main.js"));
      mainJs = ng14StripSourcemaps(mainJs) + s12NoSourcemapMarker();
      await adapter.write(dir + "/main.js", mainJs);
    } catch (err) {
      console.log("Failed to download main.js for " + info.id + ": " + err);
    }
    try {
      const css = await s04RequestText(s04ReleaseUrl(repo, tag, "styles.css"));
      await adapter.write(dir + "/styles.css", css);
    } catch (err) {
      console.log("Failed to download styles.css for " + info.id + ": " + err);
    }
  } catch (err) {
    console.error(err);
    fail(t.msgFailedToInstallPlugin({ name: info.name }));
    return false;
  }
  notice.containerEl.removeClass("is-loading");
  notice.containerEl.addClass("mod-success");
  notice.setMessage(t.msgSuccessfullyInstalledPlugin({ name: info.name }));
  setTimeout(() => notice.hide(), 3000);
  return true;
}

/** Picks the newest versions.json key the running app satisfies; null on any failure. */
async function ng14LatestCompatibleVersion(repo, manifest) {
  const appVersion = hostEnv().gte;
  if (!appVersion || !manifest.minAppVersion || !isOlderVersion(appVersion, manifest.minAppVersion)) {
    return manifest.version || null;
  }
  try {
    const versions = await s04Request(s04RawFileUrl(repo, "versions.json")).json;
    if (!versions || typeof versions !== "object") return null;
    let picked = null;
    for (const key of Object.keys(versions)) {
      const requirement = versions[key];
      if (!requirement) continue;
      if (isOlderVersion(appVersion, requirement)) continue;
      if (picked && !isOlderVersion(picked, key)) continue;
      picked = key;
    }
    return picked;
  } catch (err) {
    return null;
  }
}

/** Fetches + caches the community-plugin deprecation list (12 h poller refreshes it). */
async function ng14FetchDeprecationMap(host) {
  if (ng14Deprecation.fetched) return ng14Deprecation.map;
  if (ng14Deprecation.pending) return ng14Deprecation.pending;
  ng14Deprecation.pending = (async () => {
    try {
      const data = await s04Request(s12DeprecationIndexUrl()).json;
      if (data && typeof data === "object") {
        ng14Deprecation.map = data;
        ng14Deprecation.fetched = true;
      }
    } catch (err) {
      // keep the previous map on fetch failure
    } finally {
      ng14Deprecation.pending = null;
    }
    return ng14Deprecation.map;
  })();
  return ng14Deprecation.pending;
}

export function defineCommunityPlugins(host_) {
  const host = host_;
  /** app.plugins: community plugin registry, lifecycle and update machinery. */
  function CommunityPlugins(app) {
    this.app = app;
    this.manifests = {};
    this.plugins = {};
    this.enabledPlugins = new Set();
    this.updates = {};
    this.autoCheckForUpdates = false;
    this.lastUpdateCheck = 0;
    this.loadingPluginId = null;
    this.requestSaveConfig = debounceCall(this.saveConfig.bind(this), 1000);
    const stored = app.loadLocalStorage("plugin-automatically-check-for-updates");
    this.autoCheckForUpdates = stored === true || stored === "true";
    app.vault.on("raw", this.onRaw.bind(this));
  }

  const proto = CommunityPlugins.prototype;

  proto.getPluginFolder = function () {
    return this.app.vault.configDir + "/plugins";
  };

  proto.isEnabled = function () {
    return localStorage.getItem("enable-plugin-" + this.app.appId) === "true";
  };

  proto.setEnable = async function (on) {
    localStorage.setItem("enable-plugin-" + this.app.appId, on ? "true" : "false");
    if (on) {
      for (const id of this.enabledPlugins) await this.enablePlugin(id);
    } else {
      for (const id of Object.keys(this.plugins)) await this.disablePlugin(id, true);
    }
  };

  proto.setAutomaticUpdateCheck = function (on) {
    this.autoCheckForUpdates = !!on;
    this.app.saveLocalStorage("plugin-automatically-check-for-updates", this.autoCheckForUpdates);
  };

  /** data.json of an enabled plugin changed on disk: ping its watcher (debounced in Plugin). */
  proto.onRaw = function (path) {
    if (typeof path !== "string" || !path.endsWith("/data.json")) return;
    const dir = path.slice(0, -"/data.json".length);
    for (const id of this.enabledPlugins) {
      const manifest = this.manifests[id];
      if (manifest && manifest.dir === dir) {
        const plugin = this.plugins[id];
        if (plugin) plugin.onConfigFileChange();
        return;
      }
    }
  };

  /** Scans every <plugins>/<dir>/manifest.json; per-folder failures are logged and skipped. */
  proto.loadManifests = async function () {
    const folder = this.getPluginFolder();
    const vault = this.app.vault;
    if (!(await vault.exists(folder))) return;
    let listing;
    try {
      listing = await vault.adapter.list(folder);
    } catch (err) {
      return;
    }
    for (const dir of listing.folders) {
      await this.loadManifest(dir);
    }
  };

  proto.loadManifest = async function (dir) {
    const vault = this.app.vault;
    try {
      const raw = await vault.adapter.read(dir + "/manifest.json");
      const manifest = ng14ScanManifest(host, raw, dir);
      if (manifest) this.manifests[manifest.id] = manifest;
    } catch (err) {
      // missing or unparseable manifest: skip silently
    }
  };

  proto.getPlugin = function (id) {
    return this.plugins[id] || null;
  };

  /** require() shim handed to plugin code (spec §3.2 resolution order). */
  proto.pluginRequire = function (reqId, emulateMobile) {
    return ng14PluginRequire(host, this.app, emulateMobile)(reqId);
  };

  proto.loadPlugin = async function (id, onUserEnable) {
    const app = this.app;
    if (!this.isEnabled()) return null;
    if (this.plugins[id]) return this.plugins[id];
    const manifest = this.manifests[id];
    if (!manifest || !manifest.dir) return null;
    let code;
    try {
      code = await app.vault.adapter.read(manifest.dir + "/main.js");
    } catch (err) {
      return null;
    }
    code = ng14StripSourcemaps(code);
    const emulateMobile = !host.Platform.isDesktopApp;
    const requireShim = ng14PluginRequire(host, app, emulateMobile);
    const module = { exports: {} };
    let factory;
    try {
      factory = window.eval(
        "(function anonymous(require, module, exports) {\n" + code + "\n})\n//# sourceURL=plugin:" + encodeURIComponent(id)
      );
    } catch (err) {
      console.error("Failed to load plugin " + id, err);
      throw err;
    }
    factory(requireShim, module, module.exports);
    let instance = module.exports && module.exports.default ? module.exports.default : module.exports;
    if (!instance) throw new Error("Failed to load plugin " + id + ". No exports detected.");
    if (!(instance instanceof host.Plugin)) throw new Error("Failed to load plugin " + id);
    instance.app = app;
    instance.manifest = manifest;
    this.plugins[id] = instance;
    await instance.load();
    await instance.loadCSS();
    if (onUserEnable) instance.onUserEnable();
    return instance;
  };

  proto.unloadPlugin = async function (id, userDisabled) {
    const plugin = this.plugins[id];
    if (!plugin) return;
    plugin._userDisabled = !!userDisabled;
    try {
      await plugin.unload();
    } catch (err) {
      console.error(err);
    }
    delete this.plugins[id];
  };

  proto.enablePlugin = async function (id, onUserEnable) {
    const t = ng14PluginsT(host);
    const manifest = this.manifests[id];
    if (!manifest) return false;
    if (this.isDeprecated(manifest)) return false;
    const version = manifest.version || "";
    if (manifest.id === "cmdr" && host.semverCompare(version, "0.5.4")) {
      new host.Notice("Unable to load plugin " + manifest.name + " v" + version + ". This version has been reported to cause issues. Please check for a newer version of the plugin.");
      return false;
    }
    if (manifest.id === "obsidian-image-toolkit" && host.semverCompare(version, "1.4.3")) {
      new host.Notice("Unable to load plugin " + manifest.name + " v" + version + ". This version has been reported to cause issues. Please check for a newer version of the plugin.");
      return false;
    }
    if (manifest.id === "better-pdf-plugin" && version === "1.4.0") {
      new host.Notice("Better PDF Plugin is no longer functional. We recommend uninstalling it.", 6000);
      return false;
    }
    if (manifest.isDesktopOnly && !host.Platform.isDesktopApp) return false;
    host.trackUsage("communityPlugins." + id);
    this.loadingPluginId = id;
    try {
      await this.loadPlugin(id, onUserEnable);
      return true;
    } catch (err) {
      console.error(err);
      new host.Notice(ng14I18n(host).interface.msgFailedToLoadPlugin({ plugin: id }));
      return false;
    } finally {
      this.loadingPluginId = null;
    }
  };

  proto.disablePlugin = async function (id, userDisabled) {
    try {
      await this.unloadPlugin(id, userDisabled);
      return true;
    } catch (err) {
      new host.Notice(ng14PluginsT(host).msgFailedToDisablePlugin({ id }));
      return false;
    }
  };

  proto.enablePluginAndSave = async function (id) {
    const ok = await this.enablePlugin(id, true);
    if (!ok) return false;
    this.enabledPlugins.add(id);
    this.requestSaveConfig();
    return true;
  };

  proto.disablePluginAndSave = async function (id) {
    this.enabledPlugins.delete(id);
    this.requestSaveConfig();
    await this.disablePlugin(id, true);
  };

  proto.uninstallPlugin = async function (id) {
    await this.disablePluginAndSave(id);
    const manifest = this.manifests[id];
    const dir = manifest && manifest.dir;
    if (!dir) return;
    try {
      await this.app.vault.adapter.rmdir(dir, true);
    } catch (err) {
      if (await this.app.vault.exists(dir).catch(() => false)) {
        new host.Notice(ng14PluginsT(host).msgFailedToUninstallPlugin({ id }));
        return;
      }
    }
    delete this.manifests[id];
    delete this.updates[id];
  };

  proto.saveConfig = function () {
    return this.app.vault.writeConfigJson("community-plugins", Array.from(this.enabledPlugins));
  };

  /** Startup: restore enabled set, load manifests, enable plugins with watchdog + pollers. */
  proto.initialize = async function () {
    const app = this.app;
    const saved = await app.vault.readConfigJson("community-plugins");
    const ids = Array.isArray(saved) ? saved : [];
    this.enabledPlugins = new Set(ids);
    await this.loadManifests();
    if (Object.keys(this.manifests).length === 0) return;
    if (!this.isEnabled()) {
      if (localStorage.getItem("enable-plugin-" + app.appId) === null) {
        new host.TrustAuthorModal(app).open();
      }
      return;
    }
    host.trackUsage("communityPlugins");
    for (const id of ids) {
      let watchdog = null;
      const overlay = host.progressOverlay;
      watchdog = setTimeout(() => {
        overlay.setContext((el) => {
          el.createDiv({ text: host.t.interface.startUp.msgPluginHang({ plugin: id }) });
          el.createEl("button", { cls: "mod-cta", text: "Disable" }).addEventListener("click", () => {
            this.enabledPlugins.delete(id);
            this.requestSaveConfig();
            window.location.reload();
          });
        }).show();
      }, 3000);
      try {
        await this.enablePlugin(id);
      } finally {
        clearTimeout(watchdog);
        try {
          overlay.clearContext();
        } catch (err) {}
      }
    }
    this.requestSaveConfig();
    const storedCheck = app.loadLocalStorage("last-plugin-update-check");
    this.lastUpdateCheck = storedCheck == null ? Date.now() : storedCheck;
    const autoCheck = () => {
      if (!this.autoCheckForUpdates) return;
      if (host.activeWindow !== window) return;
      if (Date.now() <= this.lastUpdateCheck + 2592e5) return;
      this.checkForUpdates();
    };
    if (host.Platform.isDesktopApp) {
      window.addEventListener("focus", autoCheck);
    } else if (host.capacitorApp && typeof host.capacitorApp.addListener === "function") {
      host.capacitorApp.addListener("resume", () => {
        if (this.isEnabled() && this.autoCheckForUpdates && Date.now() > this.lastUpdateCheck + 2592e5) {
          this.checkForUpdates();
        }
      });
    }
    await this.checkForDeprecations();
    setInterval(() => this.checkForDeprecations(), 432e5);
  };

  /** Disables loaded plugins whose manifest version is on the deprecation list. */
  proto.checkForDeprecations = async function () {
    const loaded = Object.keys(this.plugins);
    if (loaded.length === 0) return;
    await ng14FetchDeprecationMap(host);
    const map = ng14Deprecation.map;
    for (const id of loaded) {
      const manifest = this.manifests[id] || (this.plugins[id] && this.plugins[id].manifest);
      if (!manifest) continue;
      const versions = map[manifest.id];
      if (!versions || !Array.isArray(versions) || !versions.includes(manifest.version)) continue;
      await this.disablePluginAndSave(id);
      new host.Notice(
        "The plugin " + manifest.name + " v" + manifest.version + " has been disabled. This version has been reported to cause issues. Please check for a newer version of the plugin.",
        0
      );
    }
  };

  proto.isDeprecated = function (manifest) {
    if (!manifest || !manifest.id) return false;
    const versions = ng14Deprecation.map[manifest.id];
    return !!versions && Array.isArray(versions) && versions.includes(manifest.version);
  };

  proto.installPlugin = async function (repo, tag, info) {
    const ok = await ng14InstallFiles(host, this.app, repo, tag, info);
    if (!ok) return;
    const manifest = this.manifests[info.id];
    const dir = manifest && manifest.dir;
    if (dir) {
      delete this.updates[info.id];
      await this.loadManifest(dir);
      if (this.plugins[info.id]) {
        await this.disablePlugin(info.id, true);
        await this.enablePlugin(info.id, true);
      }
    }
  };

  /** Scans installed plugins against the community feed; fills this.updates. */
  proto.checkForUpdates = async function (announce) {
    const app = this.app;
    const t = ng14PluginsT(host);
    if (!navigator.onLine) {
      if (!announce) new host.Notice(ng14I18n(host).dialogue.msgOffline());
      return;
    }
    this.lastUpdateCheck = Date.now();
    app.saveLocalStorage("last-plugin-update-check", this.lastUpdateCheck);
    this.updates = {};
    const notice = new host.Notice(t.msgCheckingForUpdates(), 0);
    let feed;
    try {
      feed = await host.communityPluginList();
    } catch (err) {
      notice.hide();
      new host.Notice(t.msgFailedLoadPlugins(), 4000);
      return;
    }
    if (!Array.isArray(feed)) {
      notice.hide();
      new host.Notice(t.msgFailedLoadPlugins(), 4000);
      return;
    }
    const installed = Object.keys(this.manifests).filter((id) => this.manifests[id] && this.manifests[id].version);
    const installedSet = new Set(installed);
    for (const entry of feed) {
      if (!entry || !entry.id || !installedSet.has(entry.id) || !entry.repo) continue;
      const local = this.manifests[entry.id];
      try {
        const remote = await s04Request(s04RawFileUrl(entry.repo, "manifest.json")).json;
        if (!remote || remote.id !== entry.id) continue;
        const latest = await ng14LatestCompatibleVersion(entry.repo, remote);
        if (latest && host.semverCompare(local.version, latest)) {
          this.updates[entry.id] = { repo: entry.repo, version: latest, manifest: remote };
        }
      } catch (err) {
        // per-plugin remote failures are skipped silently
      }
    }
    const count = Object.keys(this.updates).length;
    notice.hide();
    if (count === 0) {
      new host.Notice(t.msgNoUpdatesFound(), 4000);
    } else {
      const found = new host.Notice(t.msgUpdatesFound({ count }), 4000);
      if (announce) {
        found.addButton(ng14I18n(host).dialogue.buttonView(), () => {
          app.setting.open();
          app.setting.openTabById("community-plugins");
        });
      }
    }
  };

  return CommunityPlugins;
}

// Kept for the manifest alias: the class factory name the bundle wires to $0.
export const communityPluginsFactory = defineCommunityPlugins;
