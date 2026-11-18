// Plugin: the base class of every plugin (internal and community). Everything a plugin registers is tied to the plugin's lifetime:
// the registration returns nothing to undo, because `register` queues the matching cleanup that runs on unload.
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { normalizePath } from "./path.js";

export function definePlugin(host) {
  function Plugin(app, manifest) {
    const self = host.Component.call(this) || this;
    self._lastDataModifiedTime = 0; // mtime of data.json as we last saw it, to ignore our own writes
    self._userDisabled = false;
    self.onConfigFileChange = debounceCall(self._onConfigFileChange, 50);
    self.app = app;
    self.manifest = manifest;
    return self;
  }
  inherit(Plugin, host.Component);
  const proto = Plugin.prototype;

  /** Unlike Component.load, waits for an asynchronous onload before the children are loaded. */
  proto.load = async function () {
    if (this._loaded) return;
    this._loaded = true;
    await this.onload();
    for (const child of this._children.slice()) child.load();
  };

  proto.onload = function () {};

  /** Adds a button to the left ribbon; its id is "<plugin id>:<title>". Returns the button element. */
  proto.addRibbonIcon = function (icon, title, callback) {
    const app = this.app;
    const id = this.manifest.id + ":" + title;
    const button = app.workspace.leftRibbon.addRibbonItemButton(id, icon, title, callback);
    this.register(() => {
      app.workspace.leftRibbon.removeRibbonAction(id);
      button.detach();
    });
    return button;
  };

  proto.addStatusBarItem = function () {
    const el = this.app.statusBar.registerStatusBarItem();
    el.addClass("plugin-" + this.manifest.id.toLowerCase().replace(/[^_a-zA-Z0-9-]/, "-"));
    this.register(() => el.detach());
    return el;
  };

  /** The command's id and name are prefixed with the plugin's id / name. */
  proto.addCommand = function (command) {
    command.id = this.manifest.id + ":" + command.id;
    command.name = this.manifest.name + ": " + command.name;
    this.app.commands.addCommand(command);
    this.register(() => this.app.commands.removeCommand(command.id));
    return command;
  };

  proto.removeCommand = function (id) {
    this.app.commands.removeCommand(this.manifest.id + ":" + id);
  };

  proto.addSettingTab = function (tab) {
    this.app.setting.addSettingTab(tab);
    this.register(() => this.app.setting.removeSettingTab(tab));
  };

  proto.registerView = function (type, creator) {
    this.app.viewRegistry.registerView(type, creator);
    this.register(() => {
      this.app.viewRegistry.unregisterView(type);
      // a plugin the user switched off takes its open views with it
      if (this._userDisabled) this.app.workspace.detachLeavesOfType(type);
    });
  };

  proto.registerHoverLinkSource = function (id, info) {
    this.app.workspace.registerHoverLinkSource(id, info);
    this.register(() => this.app.workspace.unregisterHoverLinkSource(id));
  };

  proto.registerExtensions = function (extensions, viewType) {
    this.app.viewRegistry.registerExtensions(extensions, viewType);
    this.register(() => this.app.viewRegistry.unregisterExtensions(extensions));
  };

  proto.registerMarkdownPostProcessor = function (processor, sortOrder) {
    host.MarkdownPreviewRenderer.registerPostProcessor(processor, sortOrder);
    this.app.workspace.trigger("post-processor-change");
    this.register(() => {
      host.MarkdownPreviewRenderer.unregisterPostProcessor(processor);
      this.app.workspace.trigger("post-processor-change");
    });
    return processor;
  };

  proto.registerMarkdownCodeBlockProcessor = function (language, handler, sortOrder) {
    const renderer = host.MarkdownPreviewRenderer;
    const processor = renderer.createCodeBlockPostProcessor(language, handler);
    renderer.registerPostProcessor(processor, sortOrder);
    renderer.registerCodeBlockPostProcessor(language, handler);
    this.app.workspace.trigger("post-processor-change");
    this.register(() => {
      renderer.unregisterCodeBlockPostProcessor(language);
      renderer.unregisterPostProcessor(processor);
      this.app.workspace.trigger("post-processor-change");
    });
    return processor;
  };

  /** Registers a Bases view type; false when the Bases core plugin is off. */
  proto.registerBasesView = function (type, registration) {
    const bases = this.app.internalPlugins.getEnabledPluginById("bases");
    if (!bases) return false;
    bases.registerView(type, registration);
    this.register(() => { bases.deregisterView(type); });
    return true;
  };

  proto.registerGlobalFunc = function (func) {
    host.FormulaFunctions.addGlobal(func);
    const name = func.name;
    this.register(() => host.FormulaFunctions.removeGlobal(name));
  };

  proto.registerInstanceFunc = function (type, func) {
    host.FormulaFunctions.addForType(type, func);
    const name = func.name;
    this.register(() => host.FormulaFunctions.removeForType(type, name));
  };

  proto.registerCodeMirror = function () {}; // CodeMirror 5 is gone; kept so old plugins do not fail

  proto.registerEditorExtension = function (extension) {
    this.app.workspace.registerEditorExtension(extension);
    this.register(() => this.app.workspace.unregisterEditorExtension(extension));
  };

  proto.registerObsidianProtocolHandler = function (action, handler) {
    this.app.workspace.registerObsidianProtocolHandler(action, handler);
    this.register(() => this.app.workspace.unregisterObsidianProtocolHandler(action, handler));
  };

  proto.registerEditorSuggest = function (suggest) {
    this.app.workspace.editorSuggest.addSuggest(suggest);
    this.register(() => this.app.workspace.editorSuggest.removeSuggest(suggest));
  };

  proto.registerCliHandler = function (command, description, flags, handler) {
    this.app.cli.registerHandler(command, `[${this.manifest.name}]: ${description}`, flags, handler);
    this.register(() => this.app.cli.unregisterHandler(command, handler));
  };

  /** The plugin's data.json (parsed), or null. Remembers its mtime when the plugin wants onExternalSettingsChange. */
  proto.loadData = async function () {
    const data = await this.app.vault.readPluginData(this.manifest.dir);
    if (data && this.onExternalSettingsChange) this._lastDataModifiedTime = await this.getModifiedTime();
    return data;
  };

  proto.saveData = async function (data) {
    const now = Date.now();
    this._lastDataModifiedTime = now;
    return this.app.vault.writePluginData(this.manifest.dir, data, { mtime: now });
  };

  /** Injects the plugin's styles.css (if any) just before the app's custom css. */
  proto.loadCSS = async function () {
    const { app, manifest } = this;
    const path = manifest.dir + "/" + host.PLUGIN_STYLES_FILE;
    if (!(await app.vault.exists(path))) return;
    const css = await app.vault.readRaw(path);
    const style = createEl("style", { type: "text/css" });
    style.textContent = css;
    document.head.insertBefore(style, app.customCss.styleEl);
    this.register(() => style.detach());
  };

  proto.onUserEnable = function () {};

  /** mtime of data.json, 0 when it does not exist. */
  proto.getModifiedTime = async function () {
    const vault = this.app.vault;
    try {
      return (await vault.adapter.stat(normalizePath(this.manifest.dir + "/data.json"))).mtime;
    } catch (err) {
      return 0;
    }
  };

  /** data.json changed on disk: tell the plugin unless it was our own write. */
  proto._onConfigFileChange = async function () {
    if (!this.onExternalSettingsChange) return;
    const modified = await this.getModifiedTime();
    if (this._lastDataModifiedTime < modified) this.onExternalSettingsChange();
    this._lastDataModifiedTime = modified;
  };

  return Plugin;
}
