// The Hotkeys settings tab: search + status/hotkey filters, the conflict-aware command list and the
// "press a key" capture scopes. Hotkey records stay { modifiers: ["Mod", ...], key } exactly like the
// inherited format; the display string comes from the shared formatHotkey helper.
import { inherit } from "./inherit.js";
import { makeHotkey } from "./text.js";
import { stringCollator } from "./misc.js";

const HOTKEY_STATUS_FILTERS = ["show-all", "show-assigned", "show-user-assigned", "show-unassigned"];

export function defineHotkeysTab(host) {
  const i18n = () => host.t.setting.hotkeys;

  /** Multimap hotkey-text -> command names, used to mark conflicting bindings. */
  class HotkeyUseIndex {
    constructor() { this.data = new Map(); }
    add(key, value) {
      let list = this.data.get(key);
      if (!list) { list = []; this.data.set(key, list); }
      if (!list.contains(value)) list.push(value);
    }
    get(key) { return this.data.get(key) || null; }
  }

  /** The removable filter chip shown above the hotkey list (status filter or captured hotkey). */
  function HotkeyFilterChip(containerEl) {
    this.value = null;
    const self = this;
    this.el = createDiv({ cls: "hotkey-filter" }, (el) => {
      self.innerEl = el.createDiv({ cls: "hotkey-filter-inner", text: i18n().labelShowAll() });
      self.removeEl = el.createDiv("hotkey-filter-remove-button", (btn) => {
        host.setIcon(btn, "lucide-x");
        host.setTooltip(btn, host.t.interface.menu.close());
      });
    });
    if (containerEl) containerEl.appendChild(this.el);
    this.removeEl.addEventListener("click", () => this.remove());
  }
  const chipProto = HotkeyFilterChip.prototype;
  chipProto.setValue = function (value) { this.value = value; return this; };
  chipProto.setTitle = function (title) { this.innerEl.setText(title); return this; };
  chipProto.onRemove = function (callback) { this.handleRemove = callback; return this; };
  chipProto.remove = function () {
    this.value = null;
    if (this.el.isShown()) {
      this.el.detach();
      if (this.handleRemove) this.handleRemove();
    }
  };

  /** A pressed key as a hotkey record, or null for keys that must not be captured (bare letters etc.). */
  function hotkeyFromInfo(info) {
    const modifiers = host.Keymap.decompileModifiers(info.modifiers);
    const key = info.vkey;
    if (modifiers.length !== 0 || /^F[0-9]+$/i.test(key)) {
      if (modifiers.length === 1 && /^[a-zA-Z]$/.test(key) && modifiers[0] === "Shift") return null;
      return makeHotkey(modifiers, key);
    }
    return null;
  }

  const STATUS_FILTER_TITLES = () => ({
    "show-all": i18n().labelShowAll,
    "show-assigned": i18n().labelShowAssigned,
    "show-user-assigned": i18n().labelShowUserAssigned,
    "show-unassigned": i18n().labelShowUnassigned,
  });

  /** Settings tab id "hotkeys". */
  function HotkeysTab(app, setting) {
    const self = host.SettingTab.apply(this, arguments) || this;
    self.name = i18n().name();
    self.id = "hotkeys";
    self.icon = "command";
    self.setHotkeyScope = null;
    self.commandBeingCustomized = null;
    self.filterHotkeyScope = null;
    self.filterHotkeyEl = null;
    self.filterHotkeyActiveEl = null;
    self.hotkeyListContainerEl = null;
    self.hotkeyFilter = null;
    self.searchComponent = null;
    self.headerComponent = null;
    self.filterContainerEl = null;
    self.statusFilter = null;

    // scope that captures the replacement hotkey for the command being customized
    self.setHotkeyScope = new host.Scope();
    self.setHotkeyScope.register(null, null, (event, info) => {
      const command = self.commandBeingCustomized;
      const manager = app.hotkeyManager;
      if (command) {
        const hotkey = hotkeyFromInfo(info);
        if (hotkey) {
          let hotkeys = (manager.getHotkeys(command.id) || manager.getDefaultHotkeys(command.id) || []).slice();
          const already = hotkeys.filter((h) => host.formatHotkey(h) === host.formatHotkey(hotkey)).length > 0;
          if (!already) {
            hotkeys.push(hotkey);
            manager.setHotkeys(command.id, hotkeys);
            manager.save().then(() => self.finishCustomizingHotkey());
          }
        }
        event.preventDefault();
        event.stopPropagation();
      }
    });
    self.setHotkeyScope.register([], "Escape", () => {
      if (self.commandBeingCustomized) {
        self.finishCustomizingHotkey();
        return false;
      }
    });

    // scope that captures a hotkey to filter the list by
    self.filterHotkeyScope = new host.Scope();
    self.filterHotkeyScope.register([], "Escape", (event) => {
      if (self.hotkeyFilter) self.hotkeyFilter.remove();
      self.finishFilteringByHotkey();
      self.updateHotkeyVisibility();
      return false;
    });
    self.filterHotkeyScope.register(null, null, (event, info) => {
      self.setHotkeyFilter(makeHotkey(host.Keymap.decompileModifiers(info.modifiers), info.vkey));
      event.preventDefault();
      event.stopPropagation();
    });
    self.filterHotkeyScope.register([], "Escape", () => {
      self.finishFilteringByHotkey();
      self.updateHotkeyVisibility();
    });
    return self;
  }
  inherit(HotkeysTab, host.SettingTab);
  const proto = HotkeysTab.prototype;

  proto.display = function () {
    const self = this;
    const i18nHotkeys = i18n();
    const containerEl = this.containerEl;
    containerEl.empty();
    if (this.hotkeyFilter) this.hotkeyFilter.remove();

    const group = new host.SettingGroup(containerEl);
    group.addSetting((setting) => {
      self.headerComponent = setting;
      setting
        .setName(i18nHotkeys.optionSearch())
        .addButton((button) => {
          host.setIcon(button.buttonEl, "lucide-filter");
          button.buttonEl.addClass("clickable-icon");
          button.onClick(self.showFilterMenu.bind(self));
        })
        .addSearch((search) => {
          self.searchComponent = search;
          search.setPlaceholder(i18nHotkeys.promptFilter()).onChange(self.updateHotkeyVisibility.bind(self));
          const container = search.containerEl;
          container.addClass("mod-hotkey");
          const filterButton = (self.filterHotkeyEl = container.createDiv("input-right-decorator clickable-icon"));
          host.setIcon(filterButton, "lucide-keyboard");
          self.filterHotkeyActiveEl = createSpan({
            cls: "setting-hotkey mod-active input-right-decorator",
            text: i18nHotkeys.labelWaitingForHotkeyPress(),
          });
          filterButton.addEventListener("click", () => {
            if (self.filterHotkeyActiveEl.isShown()) {
              self.filterHotkeyActiveEl.detach();
              self.finishFilteringByHotkey();
              return;
            }
            container.appendChild(self.filterHotkeyActiveEl);
            self.app.keymap.pushScope(self.filterHotkeyScope);
          });
        });
    });

    self.filterContainerEl = group.listEl.createDiv("setting-filter-container");
    self.statusFilter = new HotkeyFilterChip(self.filterContainerEl)
      .onRemove(() => self.setStatusFilter("show-all"))
      .setTitle(i18nHotkeys.labelShowAll());
    self.hotkeyListContainerEl = group.listEl.createDiv("hotkey-list-container");
    self.updateHotkeyVisibility();
    if (host.Platform.hasPhysicalKeyboard && self.searchComponent) self.searchComponent.inputEl.focus();
  };

  proto.setHotkeyFilter = function (hotkey) {
    const self = this;
    if (this.statusFilter) this.statusFilter.remove();
    if (this.hotkeyFilter) this.hotkeyFilter.remove();
    this.hotkeyFilter = new HotkeyFilterChip(this.filterContainerEl)
      .setValue(hotkey)
      .setTitle(host.formatHotkey(hotkey))
      .onRemove(() => self.updateHotkeyVisibility());
    this.finishFilteringByHotkey();
    this.updateHotkeyVisibility();
  };

  proto.setStatusFilter = function (filter) {
    if (this.hotkeyFilter) this.hotkeyFilter.remove();
    this.statusFilter.setValue(filter);
    if (filter === "show-all") {
      this.statusFilter.remove();
    } else {
      if (!this.statusFilter.el.isShown()) this.filterContainerEl.appendChild(this.statusFilter.el);
      this.statusFilter.setTitle(STATUS_FILTER_TITLES()[filter]());
    }
    this.updateHotkeyVisibility();
  };

  proto.setDescription = function (shown, conflicts) {
    const i18nHotkeys = i18n();
    this.headerComponent.setDesc(createFragment((frag) => {
      frag.createSpan({ text: i18nHotkeys.optionSearchDesc({ count: shown }) });
      if (conflicts) frag.createSpan({ cls: "mod-warning", text: i18nHotkeys.optionSearchConflict({ count: conflicts }) });
    }));
  };

  proto.showFilterMenu = function (event) {
    const self = this;
    event.preventDefault();
    const parent = event.currentTarget;
    if (parent.hasClass("has-active-menu")) return;
    const menu = new host.Menu();
    const current = this.statusFilter && this.statusFilter.value ? this.statusFilter.value : "show-all";
    const titles = STATUS_FILTER_TITLES();
    for (const key of HOTKEY_STATUS_FILTERS) {
      menu.addItem((item) => {
        item.setTitle(titles[key]()).setChecked(current === key).onClick(() => self.setStatusFilter(key));
      });
    }
    menu.setParentElement(parent).showAtMouseEvent(event);
  };

  proto.hide = function () { this.finishCustomizingHotkey(); };

  proto.setQuery = function (query) {
    const input = this.searchComponent.inputEl;
    input.value = query;
    input.focus();
    this.updateHotkeyVisibility();
  };

  proto.updateHotkeyVisibility = function () {
    const self = this;
    const i18nHotkeys = i18n();
    const app = this.app;
    const commands = app.commands;
    const manager = app.hotkeyManager;
    this.hotkeyListContainerEl.empty();

    // every effective hotkey -> the command names using it (for conflict marks and counts)
    const uses = new HotkeyUseIndex();
    for (const id in commands.commands) {
      if (!commands.commands.hasOwnProperty(id)) continue;
      const command = commands.commands[id];
      const custom = manager.getHotkeys(id);
      const defaults = manager.getDefaultHotkeys(id);
      const hasCustom = custom !== undefined;
      const hasDefaults = defaults !== undefined && defaults.length > 0;
      if (hasCustom) {
        for (const hotkey of custom) uses.add(host.formatHotkey(hotkey), command.name);
      } else if (hasDefaults) {
        for (const hotkey of defaults) uses.add(host.formatHotkey(hotkey), command.name);
      }
    }

    const sorted = Object.values(commands.commands);
    sorted.sort((a, b) => stringCollator.compare(a.name, b.name));

    let shown = 0;
    const conflicted = new Set();
    const status = (this.statusFilter && this.statusFilter.value) || "show-all";
    const hotkeyFilter = this.hotkeyFilter && this.hotkeyFilter.value;
    const query = this.searchComponent.inputEl.value.toLowerCase();

    for (const command of sorted) {
      const id = command.id;
      const name = command.name;
      if (query !== "" && !name.toLowerCase().contains(query) && !id.startsWith(query)) continue;
      const custom = manager.getHotkeys(id);
      const defaults = manager.getDefaultHotkeys(id);
      const effective = custom || defaults;
      const hasCustom = custom !== undefined;
      const hasDefaults = defaults !== undefined;

      if (hasCustom) {
        for (const hotkey of custom) {
          const text = host.formatHotkey(hotkey);
          for (const other of (uses.get(text) || []).filter((n) => n !== name)) conflicted.add(other);
        }
      }
      if (hotkeyFilter && !(effective && effective.find((h) => host.formatHotkey(h) === host.formatHotkey(hotkeyFilter)))) continue;
      if (status === "show-assigned" && !hasDefaults && !hasCustom) continue;
      if (status === "show-user-assigned" && !hasCustom) continue;
      if (status === "show-unassigned" && (hasCustom || hasDefaults)) continue;
      shown++;

      const row = new host.Setting(this.hotkeyListContainerEl).setName(name);
      const controlEl = row.controlEl;
      const hotkeyBox = controlEl.createDiv("setting-command-hotkeys");

      const addHotkeyEl = (hotkey, remove) => {
        const text = host.formatHotkey(hotkey);
        hotkeyBox.createSpan("setting-hotkey", (el) => {
          const others = uses.get(text) ? uses.get(text).filter((n) => n !== name) : null;
          if (others && others.length > 0) {
            el.addClass("has-conflict");
            el.addEventListener("click", (ev) => {
              if (ev.defaultPrevented) return;
              self.setQuery("");
              self.setHotkeyFilter(hotkey);
            });
            if (others.length === 1) {
              host.setTooltip(el, i18nHotkeys.tooltipHotkeySingleConflict({ command: others[0] }));
            } else {
              host.setTooltip(el, i18nHotkeys.tooltipHotkeyMultipleConflicts({ count: others.length }));
            }
          }
          el.appendText(" " + text + " ");
          el.createSpan("setting-hotkey-icon setting-delete-hotkey", (icon) => {
            host.setIcon(icon, "lucide-x");
            host.setTooltip(icon, i18nHotkeys.tooltipDeleteHotkey());
            icon.addEventListener("click", (ev) => {
              ev.preventDefault();
              remove();
            });
          });
        });
      };

      if (hasCustom) {
        for (const hotkey of custom) {
          addHotkeyEl(hotkey, () => {
            const remaining = custom.filter((h) => host.formatHotkey(h) !== host.formatHotkey(hotkey));
            if (remaining.length !== 0 || hasDefaults) manager.setHotkeys(id, remaining);
            else manager.removeHotkeys(id);
            manager.save().then(() => self.updateHotkeyVisibility());
          });
        }
      } else if (hasDefaults) {
        for (const hotkey of defaults) {
          addHotkeyEl(hotkey, () => {
            const remaining = defaults.filter((h) => host.formatHotkey(h) !== host.formatHotkey(hotkey));
            manager.setHotkeys(id, remaining);
            manager.save().then(() => self.updateHotkeyVisibility());
          });
        }
      }

      if (self.commandBeingCustomized && id === self.commandBeingCustomized.id) {
        hotkeyBox.createSpan({ cls: "setting-hotkey mod-active", text: i18nHotkeys.labelWaitingForHotkeyPress() });
      } else if ((hasCustom && custom.length === 0) || (!hasCustom && !hasDefaults)) {
        hotkeyBox.createSpan({ cls: "setting-hotkey mod-empty", text: i18nHotkeys.labelBlankHotkey() });
      }

      if (hasCustom) {
        controlEl.createSpan("clickable-icon setting-restore-hotkey-button", (el) => {
          host.setIcon(el, "lucide-rotate-ccw");
          host.setTooltip(el, i18nHotkeys.tooltipRestoreDefault());
          el.addEventListener("click", () => {
            manager.removeHotkeys(id);
            manager.save().then(() => self.finishCustomizingHotkey());
          });
        });
      }
      controlEl.createSpan("clickable-icon setting-add-hotkey-button", (el) => {
        host.setIcon(el, "lucide-plus-circle");
        host.setTooltip(el, i18nHotkeys.tooltipCustomizeCommand());
        el.addEventListener("click", () => {
          self.commandBeingCustomized = command;
          app.keymap.pushScope(self.setHotkeyScope);
          self.updateHotkeyVisibility();
        });
        el.toggleClass("mod-active", command === self.commandBeingCustomized);
      });
    }
    this.setDescription(shown, conflicted.size);
  };

  proto.finishFilteringByHotkey = function () {
    this.filterHotkeyActiveEl.detach();
    this.app.keymap.popScope(this.filterHotkeyScope);
  };

  proto.finishCustomizingHotkey = function () {
    this.app.keymap.popScope(this.setHotkeyScope);
    this.commandBeingCustomized = null;
    this.updateHotkeyVisibility();
  };

  return HotkeysTab;
}

