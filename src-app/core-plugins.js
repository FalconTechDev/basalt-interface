// Core (internal) plugins: the small set of features that ship inside the app. Each one is a plain
// object with init/onEnable/onDisable hooks; InternalPlugins wraps every loaded one in a
// PluginWrapper that owns its commands, ribbon items, views, status bar item and data.json file.
import { debounceCall } from "./timing.js";
import { parentPath, baseName, extensionOf } from "./path.js";
import { inherit } from "./inherit.js";

// The wrapper class is built by definePluginWrapper, which the bundle evaluates before
// defineInternalPlugins (i2 sits before o2); the manager reaches it through this slot.
let pluginWrapperClass = null;

/** Ids of the built-in plugins, in the order the settings list shows them. */
export const corePluginIds = [
  "file-explorer", "global-search", "switcher", "graph", "backlink", "outgoing-link", "tag-pane",
  "page-preview", "daily-notes", "templates", "note-composer", "command-palette", "slash-command",
  "editor-status", "starred", "markdown-importer", "zk-prefixer", "random-note", "outline",
  "word-count", "slides", "audio-recorder", "workspaces", "file-recovery", "publish", "sync",
];

export function definePluginWrapper(host) {
  /** Everything one loaded plugin instance owns; enable()/disable() add and remove its contributions. */
  function PluginWrapper(app, instance, manager) {
    host.Component.call(this);
    this.lastSave = 0;
    this.manager = null;
    this.instance = null;
    this.enabled = false;
    this.commands = [];
    this.ribbonItems = [];
    this.mobileFileInfo = [];
    this.hasStatusBarItem = false;
    this.statusBarEl = null;
    this.addedButtonEls = [];
    this.views = {};
    this.onConfigFileChange = debounceCall(this.handleConfigFileChange, 50);
    this.app = app;
    this.instance = instance;
    this.manager = manager;
  }
  inherit(PluginWrapper, host.Component);
  pluginWrapperClass = PluginWrapper;

  PluginWrapper.prototype.init = function () {
    const instance = this.instance;
    if (instance.init) instance.init(this.app, this);
  };

  /** Registers every contribution the plugin collected, then calls its onEnable hook. */
  PluginWrapper.prototype.enable = async function (byUser) {
    if (this.enabled) return;
    this.enabled = true;
    const instance = this.instance;
    const views = this.views;
    const app = this.app;
    for (const command of this.commands) app.commands.addCommand(command);
    for (const item of this.ribbonItems) {
      const el = app.workspace.leftRibbon.addRibbonItemButton(item.id, item.icon, item.title, item.callback);
      this.addedButtonEls.push(el);
    }
    if (host.Platform.isMobile) {
      for (const info of this.mobileFileInfo) app.workspace.addMobileFileInfo(info);
    }
    if (this.hasStatusBarItem) {
      this.statusBarEl = app.statusBar.registerStatusBarItem();
      this.statusBarEl.addClass("plugin-" + this.instance.id.toLowerCase().replace(/[^_a-zA-Z0-9-]/, "-"));
    }
    for (const type in views) {
      if (views.hasOwnProperty(type)) app.viewRegistry.registerView(type, views[type]);
    }
    if (instance.onEnable) await instance.onEnable(app, this);
    if (byUser && instance.onUserEnable) instance.onUserEnable(app);
    this.load();
    this.manager.requestSaveConfig();
    this.manager.trigger("change", this);
  };

  /** Removes every contribution and calls onDisable; `byUser` also detaches the plugin's open views. */
  PluginWrapper.prototype.disable = function (byUser) {
    if (!this.enabled) return;
    this.enabled = false;
    const instance = this.instance;
    const views = this.views;
    const app = this.app;
    if (instance.onDisable) instance.onDisable(app, this);
    if (byUser && instance.onUserDisable) instance.onUserDisable(app);
    for (const command of this.commands) app.commands.removeCommand(command.id);
    for (const el of this.addedButtonEls) el.detach();
    for (const item of this.ribbonItems) app.workspace.leftRibbon.removeRibbonAction(item.id);
    if (this.statusBarEl) this.statusBarEl.detach();
    for (const type in views) {
      if (views.hasOwnProperty(type)) {
        app.viewRegistry.unregisterView(type);
        if (byUser) app.workspace.detachLeavesOfType(type);
      }
    }
    this.unload();
    this.manager.requestSaveConfig();
    this.manager.trigger("change", this);
  };

  /** mtime of the plugin's data.json, 0 when it cannot be stat'ed. */
  PluginWrapper.prototype.getModifiedTime = async function () {
    const id = this.instance.id;
    const app = this.manager.app;
    const file = app.vault.getConfigFile(id);
    try {
      return (await app.vault.adapter.stat(file)).mtime;
    } catch {
      return 0;
    }
  };

  /** Debounced raw-file watcher: reload external settings edits that happened after our last save. */
  PluginWrapper.prototype.handleConfigFileChange = async function () {
    let mtime;
    if (this.instance.onExternalSettingsChange) mtime = await this.getModifiedTime();
    else return;
    if (this.lastSave < mtime) this.instance.onExternalSettingsChange();
    this.lastSave = mtime;
  };

  PluginWrapper.prototype.loadData = function () {
    return this.manager.app.vault.readConfigJson(this.instance.id);
  };

  PluginWrapper.prototype.saveData = async function (data) {
    const id = this.instance.id;
    const app = this.manager.app;
    const mtime = Date.now();
    this.lastSave = mtime;
    await app.vault.writeConfigJson(id, data, { mtime });
  };

  PluginWrapper.prototype.deleteData = function () {
    return this.manager.app.vault.deleteConfigJson(this.instance.id);
  };

  PluginWrapper.prototype.registerViewType = function (type, view) {
    this.views[type] = view;
  };

  /** Prefixes the command name with the plugin name, the way core commands are namespaced. */
  PluginWrapper.prototype.registerGlobalCommand = function (command) {
    command.name = this.instance.name + ": " + command.name;
    this.commands.push(command);
  };

  PluginWrapper.prototype.registerRibbonItem = function (title, icon, callback) {
    const id = this.instance.id + ":" + title;
    this.ribbonItems.push({ id, title, icon, callback, hidden: false });
  };

  PluginWrapper.prototype.registerStatusBarItem = function () {
    this.hasStatusBarItem = true;
  };

  PluginWrapper.prototype.registerMobileFileInfo = function (renderCallback) {
    this.mobileFileInfo.push({ renderCallback });
  };

  PluginWrapper.prototype.addSettingTab = function (tab) {
    const self = this;
    this.app.setting.addSettingTab(tab);
    this.register(function () {
      return self.app.setting.removeSettingTab(tab);
    });
  };

  PluginWrapper.prototype.registerCliHandler = function (id, name, options, callback) {
    const self = this;
    this.app.cli.registerHandler(id, name, options, callback);
    this.register(function () {
      return self.app.cli.unregisterHandler(id, callback);
    });
  };

  return PluginWrapper;
}

export function defineInternalPlugins(host) {
  /**
   * app.internalPlugins: loads the built-in plugin objects, restores the core-plugins.json
   * enable flags (with the array->object migration) and keeps them in sync.
   */
  function InternalPlugins(app) {
    host.Events.call(this);
    this.plugins = {};
    this.config = {};
    this.requestSaveConfig = debounceCall(this.saveConfig.bind(this), 500);
    this.app = app;
    this.app.vault.on("raw", this.onRaw.bind(this));
  }
  inherit(InternalPlugins, host.Events);

  /** A write inside the config dir that touches a plugin's json config pings that plugin's watcher. */
  InternalPlugins.prototype.onRaw = function (path) {
    if (parentPath(path) === this.app.vault.configDir && extensionOf(path) === "json") {
      const name = baseName(path);
      const plugin = this.plugins[name];
      if (plugin && plugin.enabled) plugin.onConfigFileChange();
    }
  };

  InternalPlugins.prototype.getPluginById = function (id) {
    const plugins = this.plugins;
    return plugins.hasOwnProperty(id) ? plugins[id] : null;
  };

  InternalPlugins.prototype.getEnabledPluginById = function (id) {
    const plugins = this.plugins;
    if (plugins.hasOwnProperty(id)) {
      const plugin = plugins[id];
      if (plugin.enabled) return plugin.instance;
    }
    return null;
  };

  /** Wraps a core plugin object; throws when the id is already loaded. */
  InternalPlugins.prototype.loadPlugin = function (instance) {
    const app = this.app;
    const plugins = this.plugins;
    if (plugins.hasOwnProperty(instance.id)) {
      throw new Error("Plugin " + instance.name + " has already been loaded");
    }
    const wrapper = new pluginWrapperClass(app, instance, this);
    wrapper.init();
    plugins[instance.id] = wrapper;
    return instance;
  };

  InternalPlugins.prototype.getEnabledPlugins = function () {
    const plugins = this.plugins;
    const enabled = [];
    for (const id in plugins) {
      if (plugins.hasOwnProperty(id)) {
        const plugin = plugins[id];
        if (plugin.enabled) enabled.push(plugin);
      }
    }
    return enabled;
  };

  /** Reads core-plugins.json (migrating the old array format) and enables every plugin it marks, plus defaultOn ones. */
  InternalPlugins.prototype.enable = async function () {
    const app = this.app;
    const plugins = this.plugins;
    let config = {};
    const saved = await app.vault.readConfigJson("core-plugins");
    if (saved) {
      if (Array.isArray(saved)) {
        const migration = await app.vault.readConfigJson("core-plugins-migration");
        if (migration && typeof migration === "object") config = migration;
        const listed = new Set(saved);
        for (const id of corePluginIds) {
          if (plugins.hasOwnProperty(id)) config[id] = listed.has(id);
        }
      } else if (typeof saved === "object") {
        config = saved;
      }
    }
    const enabling = [];
    for (const id in plugins) {
      if (plugins.hasOwnProperty(id)) {
        const plugin = plugins[id];
        if (config.hasOwnProperty(id)) {
          if (config[id]) enabling.push(plugin.enable(false));
        } else {
          if (plugin.instance.defaultOn) enabling.push(plugin.enable(false));
          this.requestSaveConfig();
        }
      }
    }
    await Promise.all(enabling);
    this.config = config;
  };

  /** Writes {pluginId: enabled} back to core-plugins.json. */
  InternalPlugins.prototype.saveConfig = async function () {
    const app = this.app;
    const plugins = this.plugins;
    const config = this.config;
    for (const id in plugins) {
      if (plugins.hasOwnProperty(id)) {
        config[id] = plugins[id].enabled;
      }
    }
    await app.vault.writeConfigJson("core-plugins", config);
  };

  return InternalPlugins;
}
