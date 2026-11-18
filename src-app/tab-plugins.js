// The "Core plugins" settings tab: a searchable list of the built-in plugins with enable toggles,
// a gear button that opens the plugin's own settings tab and a hotkey button that jumps to the
// hotkeys tab filtered by the plugin's command prefix.
import { inherit } from "./inherit.js";
import { hostEnv } from "./env.js";
import { containsAllWords, renderMatches } from "./search-simple.js";
import { stringCollator } from "./misc.js";

export function defineCorePluginsTab(host) {
  const env = () => hostEnv();

  /** Settings tab id "plugins". */
  function CorePluginsTab(app, setting) {
    const self = host.SettingTab.apply(this, arguments) || this;
    self.name = host.t.setting.builtinPlugins();
    self.id = "plugins";
    self.icon = "toy-brick";
    return self;
  }
  inherit(CorePluginsTab, host.SettingTab);
  const proto = CorePluginsTab.prototype;

  proto.display = function () { this.render(true); };

  proto.render = function (focusSearch) {
    const self = this;
    const app = this.app;
    const internalPlugins = app.internalPlugins;
    this.containerEl.empty();

    const toggles = {};
    const group = new host.SettingGroup(this.containerEl);
    const filterList = (query) => {
      group.listEl.empty();
      const words = (query || "").trim().toLowerCase().split(" ");
      const all = internalPlugins.plugins;
      const ids = Object.keys(all).filter((id) => !all[id].instance.hiddenFromList);
      ids.sort((a, b) => stringCollator.compare(all[a].instance.name, all[b].instance.name));

      const addPlugin = (id) => {
        const entry = all[id];
        const instance = entry.instance;
        let nameMatches = null;
        let descMatches = null;
        if (words.join("") !== "") {
          nameMatches = containsAllWords(words, instance.name.toLowerCase());
          descMatches = containsAllWords(words, instance.description.toLowerCase());
          if (!nameMatches && !descMatches) return;
        }

        const settingsButton = { el: null };
        const hotkeyButton = { el: null };
        const updateExtraButtons = () => {
          let hasTab = false;
          let hasHotkeys = false;
          if (entry.enabled) {
            hasTab = self.setting.pluginTabs.some((tab) => tab.id === id);
            hasHotkeys = Object.keys(app.commands.commands).some((commandId) => commandId.startsWith(id + ":"));
          }
          settingsButton.el.extraSettingsEl.toggle(hasTab);
          hotkeyButton.el.extraSettingsEl.toggle(hasHotkeys);
        };

        group.addSetting((setting) => {
          setting
            .setName(createFragment((frag) => renderMatches(frag, instance.name, nameMatches)))
            .setDesc(createFragment((frag) => renderMatches(frag, instance.description, descMatches)))
            .addExtraButton((button) => {
              settingsButton.el = button;
              button.setIcon("lucide-settings").setTooltip(host.t.setting.options()).onClick(() => self.setting.openTabById(id));
            })
            .addExtraButton((button) => {
              hotkeyButton.el = button;
              button.extraSettingsEl.addClass("mod-hotkeys");
              button.setIcon("lucide-plus-circle").setTooltip(host.t.setting.hotkeys.name()).onClick(() => {
                const tab = self.setting.openTabById("hotkeys");
                if (tab && tab.setQuery) tab.setQuery(id);
              });
            })
            .addToggle((toggle) => {
              toggles[id] = toggle;
              toggle.setValue(entry.enabled).onChange(async (enabled) => {
                if (enabled) await entry.enable(true);
                else entry.disable(true);
                updateExtraButtons();
              });
            });
          updateExtraButtons();
        });
      };

      for (const id of ids) addPlugin(id);
    };

    group.addSearch((search) => {
      search
        .setPlaceholder(host.t.setting.corePlugin.placeholderSearchPlugin())
        .onChange((query) => filterList(query))
        .then(() => {
          if (focusSearch && env().Yl.hasPhysicalKeyboard) {
            setTimeout(() => search.inputEl.focus());
          }
        });
    });

    filterList("");
    internalPlugins.on("change", () => this.updateEnabledState(toggles, app.internalPlugins));
  };

  /** Re-syncs every toggle with the plugin's current enabled flag (called on the plugins-changed event). */
  proto.updateEnabledState = function (toggles, internalPlugins) {
    const plugins = internalPlugins.plugins;
    for (const id in plugins) {
      if (!plugins.hasOwnProperty(id)) continue;
      const toggle = toggles[id];
      if (toggle) toggle.setValue(plugins[id].enabled);
    }
  };

  return CorePluginsTab;
}
