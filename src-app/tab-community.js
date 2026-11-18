// The "Community plugins" settings tab: restricted-mode disclaimer, installed-plugin list with
// update/install/uninstall actions, search and the automatic-update-check toggle. The plugin
// browser (M0) and donate dialog (S0) are still the inherited classes, reached through bindEnv.
import { inherit } from "./inherit.js";
import { hostEnv } from "./env.js";
import { containsAllWords, renderMatches } from "./search-simple.js";

/** Adds `cls` to `el` while `fn` runs (the inherited "is-loading" / "mod-loading" overlays). */
async function withElementLoading(el, cls, fn) {
  el.addClass(cls);
  try {
    return await fn();
  } finally {
    el.removeClass(cls);
  }
}

export function defineCommunityPluginsTab(host) {
  const env = () => hostEnv();
  const i18n = () => host.t.setting.thirdPartyPlugin;

  /** Settings tab id "community-plugins". */
  function CommunityPluginsTab(app, setting) {
    const self = host.SettingTab.apply(this, arguments) || this;
    self.name = i18n().name();
    self.id = "community-plugins";
    self.icon = "puzzle";
    self.installedPlugins = null;
    return self;
  }
  inherit(CommunityPluginsTab, host.SettingTab);
  const proto = CommunityPluginsTab.prototype;

  proto.display = function () { this.render(true); };

  proto.render = function (focusSearch) {
    const self = this;
    const app = this.app;
    const containerEl = this.containerEl;
    containerEl.empty();
    const i18nPlugin = i18n();
    const group = new host.SettingGroup(containerEl);
    const plugins = app.plugins;

    if (plugins.isEnabled()) {
      group.addSetting((setting) => {
        setting
          .setName(i18nPlugin.optionRestrictedMode())
          .setDesc(i18nPlugin.optionRestrictedModeDescription())
          .addButton((button) => {
            button.setButtonText(i18nPlugin.buttonTurnOn()).onClick(async () => {
              await plugins.setEnable(false);
              window.location.reload();
            });
          });
      });
      group.addSetting((setting) => {
        setting
          .setName(i18nPlugin.optionBrowseCommunityPlugins())
          .setDesc(i18nPlugin.optionBrowseCommunityPluginsDescription())
          .addButton((button) => {
            button.setCta().setButtonText(i18nPlugin.buttonBrowse()).onClick(() => {
              new (env().M0)(app).setCloseCallback(() => self.display()).open();
            });
          });
      });

      const manifests = plugins.manifests;
      const loaded = plugins.plugins;
      const manifestIds = Object.keys(manifests);
      const updates = plugins.updates;
      const updateCount = Object.keys(updates).length;
      manifestIds.sort((a, b) => manifests[a].name.localeCompare(manifests[b].name));

      group.addSetting((setting) => {
        setting
          .setName(i18nPlugin.labelCurrentPlugins())
          .setDesc(i18nPlugin.labelCurrentlyInstalled({ count: manifestIds.length }) + " " + (updateCount > 0 ? i18nPlugin.msgUpdatesFound({ count: updateCount }) : ""))
          .then((s) => {
            if (updateCount > 0) {
              s.addButton((button) => {
                button.setCta().setButtonText(i18nPlugin.buttonUpdateAllPlugins()).onClick(() =>
                  withElementLoading(containerEl, "is-loading", async () => {
                    for (const id of Object.keys(updates)) {
                      const update = updates[id];
                      await plugins.installPlugin(update.repo, update.version, update.manifest);
                    }
                    self.render();
                  }));
              });
            } else if (manifestIds.length > 0) {
              s.addButton((button) => {
                button.setCta().setButtonText(i18nPlugin.buttonCheckForUpdates()).onClick(() =>
                  withElementLoading(containerEl, "is-loading", async () => {
                    await plugins.checkForUpdates(false);
                    self.render();
                  }));
              });
            }
          });
      });

      group.addSetting((setting) => {
        setting
          .setName(i18nPlugin.optionAutomaticUpdateCheck())
          .setDesc(i18nPlugin.optionAutomaticUpdateCheckDesc())
          .addToggle((toggle) => {
            toggle.setValue(plugins.autoCheckForUpdates).onChange((value) => plugins.setAutomaticUpdateCheck(value));
          });
      });

      const installed = (this.installedPlugins = new host.SettingGroup(containerEl)
        .setHeading(i18nPlugin.labelInstalledPlugins())
        .addClass("installed-plugins-container")
        .addExtraButton((button) => {
          button.setIcon("lucide-refresh-cw").setTooltip(i18nPlugin.buttonReloadPlugins()).onClick(async () => {
            await plugins.loadManifests();
            new host.Notice(i18nPlugin.msgReloadedThirdPartyPlugins());
            self.render();
          });
        }));

      if (host.Platform.isDesktopApp) {
        installed.addExtraButton((button) => {
          button.setIcon("lucide-folder-open").setTooltip(i18nPlugin.buttonOpenPluginsFolder()).onClick(async () => {
            const folder = plugins.getPluginFolder();
            if (!(await app.vault.exists(folder))) await app.vault.createFolder(folder);
            app.openWithDefaultApp(folder);
          });
        });
      }

      if (manifestIds.length > 0) {
        installed.addSearch((search) => {
          search.setPlaceholder(i18nPlugin.placeholderSearchInstalledPlugin()).onChange((query) => self.updateSearch(query));
          search.inputEl.addEventListener("keypress", (event) => {
            if (!event.isComposing && event.key === "Enter" && !host.Platform.hasPhysicalKeyboard) host.blurAndClearSelection();
          });
          if (focusSearch && host.Platform.hasPhysicalKeyboard) {
            setTimeout(() => search.inputEl.focus());
          }
        });
      }

      // plugins that are loaded but have no manifest entry (e.g. removed from the list): shown so they can be disabled
      for (const id of Object.keys(loaded)) {
        if (Object.hasOwn(manifests, id)) continue;
        const manifest = loaded[id].manifest;
        installed.addSetting((setting) => {
          setting
            .setName(manifest.name)
            .setDesc(manifest.description)
            .addToggle((toggle) => {
              toggle.setValue(true).onChange(async () => {
                await plugins.disablePluginAndSave(manifest.id);
                self.render();
              });
            });
        });
      }
      this.updateSearch("");
    } else {
      group.listEl.createEl("p", { text: i18nPlugin.labelExitRestrictedModeDescription_1() });
      group.listEl.createEl("p", { text: i18nPlugin.labelExitRestrictedModeDescription_2() });
      group.addClass("community-plugins-disclaimer");
      const addDisclaimerSetting = (nameKey, descKey, icon) => {
        group.addSetting((setting) => {
          setting
            .setName(i18nPlugin[nameKey]())
            .setDesc(i18nPlugin[descKey]())
            .settingEl.prepend(createDiv("setting-icon", (el) => host.setIcon(el, icon)));
        });
      };
      addDisclaimerSetting("labelCodeReview", "labelCodeReviewDesc", "lucide-inspect");
      addDisclaimerSetting("labelOpenSource", "labelOpenSourceDesc", "lucide-github");
      addDisclaimerSetting("labelPeerAudit", "labelPeerAuditDesc", "lucide-users");
      addDisclaimerSetting("labelReportMechanism", "labelReportMechanismDesc", "lucide-bug");
      group.listEl.createEl("p", { text: i18nPlugin.labelExitRestrictedModeDisableConfirmation() });
      const button = containerEl
        .createDiv("community-modal-button-container")
        .createEl("button", { cls: "mod-cta", text: i18nPlugin.buttonTurnOnCommunityPlugins() });
      button.addEventListener("click", () =>
        withElementLoading(button, "mod-loading", async () => {
          await plugins.setEnable(true);
          self.render();
        }));
      containerEl.createEl("p", {}, (el) => {
        el.createEl("a", { text: i18nPlugin.labelLearnMore(), href: "https://github.com/FalconTechDev/basalt/wiki", attr: { target: "_blank", rel: "noopener" } });
      });
    }
  };

  proto.renderInstalledPlugin = function (manifest, nameMatches, authorMatches, descMatches) {
    const self = this;
    const app = this.app;
    const plugins = app.plugins;
    const installed = this.installedPlugins;
    const loaded = plugins.plugins;
    const updates = plugins.updates;
    const id = manifest.id;
    const i18nPlugin = i18n();

    const updateExtraButtons = () => {
      let hasTab = false;
      let hasHotkeys = false;
      if (plugins.getPlugin(id)) {
        hasTab = self.setting.pluginTabs.some((tab) => tab.id === id);
        hasHotkeys = Object.keys(app.commands.commands).some((commandId) => commandId.startsWith(id + ":"));
      }
      settingsButton.el.extraSettingsEl.toggle(hasTab);
      hotkeyButton.el.extraSettingsEl.toggle(hasHotkeys);
    };

    const settingsButton = { el: null };
    const hotkeyButton = { el: null };

    let row = null;
    installed.addSetting((setting) => {
      row = setting
        .setDesc(createFragment((frag) => {
          if (manifest.version) frag.createDiv({ text: i18nPlugin.labelVersion({ version: manifest.version }) });
          if (manifest.author) renderMatches(frag.createDiv({ text: i18nPlugin.labelByAuthor() }), manifest.author, authorMatches);
          renderMatches(frag.createDiv(), manifest.description, descMatches);
        }))
        .then((s) => {
          if (updates.hasOwnProperty(id)) {
            const update = updates[id];
            s.addButton((button) => {
              button
                .setCta()
                .setButtonText(i18nPlugin.buttonUpdate())
                .setTooltip(i18nPlugin.msgUpdatePlugin({ version: update.version }))
                .onClick(() =>
                  withElementLoading(s.settingEl, "is-loading", async () => {
                    await plugins.installPlugin(update.repo, update.version, update.manifest);
                    self.render();
                  }));
            });
          }
          renderMatches(s.nameEl, manifest.name, nameMatches);
        })
        .addExtraButton((button) => {
          settingsButton.el = button;
          button.setIcon("lucide-settings").setTooltip(host.t.setting.options()).onClick(() => self.setting.openTabById(id));
        })
        .addExtraButton((button) => {
          hotkeyButton.el = button;
          button.setIcon("lucide-plus-circle").setTooltip(host.t.setting.hotkeys.name()).onClick(() => {
            const tab = self.setting.openTabById("hotkeys");
            if (tab && tab.setQuery) tab.setQuery(id);
          });
        });

      if (manifest.fundingUrl) {
        row.addExtraButton((button) => {
          button.setIcon("lucide-heart").setTooltip(i18nPlugin.labelDonateModalTitle({ name: manifest.name })).onClick(() => {
            new (env().S0)(app, manifest.name, manifest.fundingUrl).open();
          });
        });
      }
      row.addExtraButton((button) => {
        button.setIcon("lucide-trash-2").setTooltip(i18nPlugin.labelUninstall()).onClick(() => {
          new host.ButtonModal(app)
            .setTitle(i18nPlugin.labelUninstallPlugin())
            .setContent(i18nPlugin.labelUninstallPluginConfirmation())
            .addButton("mod-warning", i18nPlugin.labelUninstall(), async () => {
              await plugins.uninstallPlugin(id);
              self.render();
            })
            .addCancelButton()
            .open();
        });
      });
      row.addToggle((toggle) => {
        toggle.setValue(loaded.hasOwnProperty(id)).onChange(async (enabled) => {
          if (enabled) {
            const ok = await plugins.enablePluginAndSave(id);
            if (!ok) toggle.setValue(false);
          } else {
            await plugins.disablePluginAndSave(id);
          }
          updateExtraButtons();
          if (enabled) setTimeout(updateExtraButtons, 100);
        });
      });

      const infoEl = row.infoEl;
      infoEl.style.cursor = "pointer";
      infoEl.addEventListener("click", () => {
        new (env().M0)(app).setCloseCallback(() => self.display()).setAutoOpen(id).open();
      });
      updateExtraButtons();
    });
  };

  proto.updateSearch = function (query) {
    const plugins = this.app.plugins;
    this.installedPlugins.listEl.empty();
    const manifests = plugins.manifests;
    const ids = Object.keys(manifests);
    ids.sort((a, b) => manifests[a].name.localeCompare(manifests[b].name));
    const trimmed = query.trim().toLowerCase();
    const words = trimmed.split(" ");
    for (const id of ids) {
      const manifest = manifests[id];
      let nameMatches = null;
      let authorMatches = null;
      let descMatches = null;
      if (trimmed) {
        nameMatches = containsAllWords(words, manifest.name.toLowerCase());
        authorMatches = manifest.author ? containsAllWords(words, manifest.author.toLowerCase()) : null;
        descMatches = manifest.description ? containsAllWords(words, manifest.description.toLowerCase()) : null;
        if (!nameMatches && !authorMatches && !descMatches) continue;
      }
      this.renderInstalledPlugin(manifest, nameMatches, authorMatches, descMatches);
    }
  };

  return CommunityPluginsTab;
}
