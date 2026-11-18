// The command registry (app.commands) and the hotkey manager (app.hotkeyManager).
import { debounceCall } from "./timing.js";
import { keyLabel } from "./text.js";

/** Key of the user's own hotkey table on the manager; a symbol so that it never shows up in the manager's enumerable state. */
const CUSTOM_KEYS = Symbol("customKeys");

export function defineCommands(host) {
  /**
   * All commands of the app, by id. A command is { id, name, callback | checkCallback | editorCallback | editorCheckCallback,
   * hotkeys?, icon?, repeatable?, mobileOnly?, ... }. Editor commands are wrapped so that they only run when an editor is active.
   */
  function Commands(app) {
    this.commands = {};
    this.editorCommands = {};
    this.app = app;
  }
  const proto = Commands.prototype;

  proto.addCommand = function (command) {
    if (command.mobileOnly && !host.Platform.isMobile) return;
    if (command.editorCallback || command.editorCheckCallback) {
      // the editor variants are reduced to a checkCallback: (checking) => boolean | null | undefined
      command.checkCallback = (checking) => {
        const active = this.app.workspace.activeEditor;
        if (!active) return null;
        if (!command.allowPreview && active.getMode() === "preview") return undefined;
        const editor = active.editor;
        if (active instanceof host.MarkdownView) {
          // typing in the title or in the properties must not trigger editor commands
          if (active.inlineTitleEl.isActiveElement()) return undefined;
          if (active.titleEl.isActiveElement()) return undefined;
          if (!command.allowProperties && activeDocument.activeElement.closest(".metadata-container")) return undefined;
        }
        if (command.editorCheckCallback) return command.editorCheckCallback(checking, editor, active);
        if (command.editorCallback) {
          if (!checking) command.editorCallback(editor, active);
          return true;
        }
        return undefined;
      };
      this.editorCommands[command.id] = command;
    }
    if (command.showOnMobileToolbar) this.editorCommands[command.id] = command;
    this.commands[command.id] = command;
    if (command.hotkeys) this.app.hotkeyManager.addDefaultHotkeys(command.id, command.hotkeys);
  };

  proto.removeCommand = function (id) {
    if (this.commands.hasOwnProperty(id)) this.app.hotkeyManager.removeDefaultHotkeys(id);
    delete this.commands[id];
    delete this.editorCommands[id];
  };

  proto.findCommand = function (id) { return this.commands[id]; };

  /** The commands that are available right now (a checkCallback is asked in "checking" mode). */
  proto.listCommands = function () {
    return Object.values(this.commands).filter((command) => {
      if (!command.checkCallback) return true;
      try {
        return command.checkCallback(true);
      } catch (err) {
        console.log("Command failed to execute: ", command.id);
        console.error(err);
        return false;
      }
    });
  };

  proto.executeCommandById = function (id, event) {
    const command = this.findCommand(id);
    return !!command && this.executeCommand(command, event);
  };

  /** Runs a command; false when it threw (the error is logged). */
  proto.executeCommand = function (command, event) {
    this.app.lastEvent = event || null;
    try {
      host.runCommandCallback(command);
    } catch (err) {
      console.log("Command failed to execute: ", command.id);
      console.error(err);
      return false;
    }
    return true;
  };

  return Commands;
}

export function defineHotkeyManager(host) {
  /**
   * Maps key presses to commands. Hotkeys are { modifiers: ["Mod", ...], key | code }. Every command has default hotkeys (from the
   * command) and optionally user hotkeys (hotkeys.json in the config folder) that replace the defaults of that command.
   * The lookup table is rebuilt lazily ("baked") after any change.
   */
  function HotkeyManager(app) {
    this.defaultKeys = {};
    this[CUSTOM_KEYS] = {};
    this.baked = false;
    this.bakedHotkeys = []; // [{ modifiers (compiled), key }] ...
    this.bakedIds = [];     // ... and the command id of each entry
    this.onConfigFileChange = debounceCall(this.load, 50);
    this.app = app;
    // a catch-all binding at the root scope: every key press that nobody else handled ends up in onTrigger
    this.app.scope.register(null, null, this.onTrigger.bind(this));
  }
  const proto = HotkeyManager.prototype;

  Object.defineProperty(proto, "customKeys", {
    get() { return Object.assign({}, this[CUSTOM_KEYS]); },
    enumerable: false,
    configurable: true,
  });

  proto.registerListeners = function () {
    this.app.vault.on("raw", this.onRaw.bind(this));
  };

  proto.onRaw = function (path) {
    if (path === this.app.vault.configDir + "/hotkeys.json") this.onConfigFileChange();
  };

  proto.save = async function () {
    await this.app.vault.writeConfigJson("hotkeys", this[CUSTOM_KEYS]);
  };

  proto.load = async function () {
    const data = await this.app.vault.readConfigJson("hotkeys");
    if (data && typeof data === "object") {
      this[CUSTOM_KEYS] = data || {};
      this.baked = false;
    }
  };

  proto.getDefaultHotkeys = function (id) { return this.defaultKeys[id]; };
  proto.addDefaultHotkeys = function (id, hotkeys) {
    this.defaultKeys[id] = hotkeys;
    this.baked = false;
  };
  proto.removeDefaultHotkeys = function (id) {
    delete this.defaultKeys[id];
    this.baked = false;
  };
  proto.getHotkeys = function (id) { return this[CUSTOM_KEYS][id]; };
  proto.setHotkeys = function (id, hotkeys) {
    this[CUSTOM_KEYS][id] = hotkeys;
    this.baked = false;
    if (host.Platform.isDesktopApp) this.app.appMenuBarManager.requestRender();
  };
  proto.removeHotkeys = function (id) {
    delete this[CUSTOM_KEYS][id];
    this.baked = false;
  };

  /** The first hotkey of a command as text ("Ctrl + P"), or "". */
  proto.printHotkeyForCommand = function (id) {
    const hotkeys = this.getHotkeys(id) || this.getDefaultHotkeys(id);
    return hotkeys && hotkeys.length > 0 ? host.formatHotkey(hotkeys[0]) : "";
  };

  /** Builds the flat lookup lists; commands with user hotkeys do not get their defaults. */
  proto.bake = function () {
    if (this.baked) return;
    this.baked = true;
    const custom = this[CUSTOM_KEYS];
    const hotkeys = [];
    const ids = [];
    const add = (id, list) => {
      for (const hotkey of list) {
        hotkeys.push({ modifiers: host.Keymap.compileModifiers(hotkey.modifiers), key: hotkey.code ? keyLabel(hotkey.code) : hotkey.key });
        ids.push(id);
      }
    };
    for (const id in custom) if (custom.hasOwnProperty(id)) add(id, custom[id]);
    for (const id in this.defaultKeys) if (this.defaultKeys.hasOwnProperty(id) && !custom.hasOwnProperty(id)) add(id, this.defaultKeys[id]);
    this.bakedHotkeys = hotkeys;
    this.bakedIds = ids;
  };

  /** Root-scope handler: runs the first command whose hotkey matches; returning false swallows the key. */
  proto.onTrigger = function (event, info) {
    this.bake();
    const { bakedHotkeys, bakedIds } = this;
    for (let i = 0; i < bakedHotkeys.length; i++) {
      if (!host.Keymap.isMatch(bakedHotkeys[i], info)) continue;
      const command = this.app.commands.findCommand(bakedIds[i]);
      if (command && (!event.repeat || command.repeatable) && this.app.commands.executeCommand(command)) return false;
    }
    return undefined;
  };

  return HotkeyManager;
}
