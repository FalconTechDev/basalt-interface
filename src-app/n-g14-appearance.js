// n-g14-appearance.js — clean-room replacement for the Appearance settings tab
// (spec g14 §2.3 / §3.3). Renders base theme, accent colour, theme manager,
// interface toggles, font families + size, desktop advanced section and the
// CSS-snippets list. All config writes go through vault.setConfig / customCss.

import { inherit } from "./inherit.js";
import { env, hostEnv } from "./env.js";

const ng14ACE = () => hostEnv();

function ng14T(path, fallback) {
  try {
    let node = hostEnv().t;
    for (const part of path.split(".")) {
      node = node[part];
      if (node === undefined || node === null) return fallback;
    }
    const value = typeof node === "function" ? node() : node;
    return value === undefined || value === null ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

export function defineAppearanceTab(host) {
  const env = () => hostEnv();

  function AppearanceTab(app, setting) {
    const self = host.SettingTab.apply(this, arguments) || this;
    self.app = app;
    self.setting = setting;
    self.name = ng14T("setting.appearance.name", "Appearance");
    self.id = "appearance";
    self.icon = "palette";
    return self;
  }
  inherit(AppearanceTab, host.SettingTab);
  const proto = AppearanceTab.prototype;

  proto.display = function () {
    this.containerEl.empty();
    this.renderBaseTheme();
    this.renderAccent();
    this.renderThemeManager();
    this.renderInterface();
    this.renderFonts();
    this.renderFontSize();
    this.renderAdvanced();
    this.renderSnippets();
  };

  proto.configBool = function (key, fallback) {
    const value = this.app.vault.getConfig(key);
    return value === undefined || value === null ? !!fallback : !!value;
  };

  proto.setConfig = function (key, value) {
    this.app.vault.setConfig(key, value);
  };

  // ------------------------------------------------------------- base theme

  proto.renderBaseTheme = function () {
    const app = this.app;
    const i18n = (key) => ng14T("setting.appearance." + key, key);
    new host.SettingGroup(this.containerEl)
      .addHeading(() => ng14T("setting.appearance.optionBaseTheme", "Base theme"))
      .addSetting((setting) => {
        setting
          .setName(ng14T("setting.appearance.optionBaseTheme", "Base theme"))
          .setDesc(ng14T("setting.appearance.optionBaseThemeDesc", "Choose the base palette of the app."))
          .addDropdown((dropdown) => {
            dropdown
              .addOption("basalt", i18n("dark-theme") === "dark-theme" ? "Dark" : i18n("dark-theme"))
              .addOption("moonstone", i18n("light-theme") === "light-theme" ? "Light" : i18n("light-theme"))
              .addOption("system", i18n("system-theme") === "system-theme" ? "Match system" : i18n("system-theme"))
              .setValue(app.vault.getConfig("theme") || "basalt")
              .onChange((value) => app.changeTheme(value));
          });
      });
  };

  // ---------------------------------------------------------------- accent

  proto.renderAccent = function () {
    const app = this.app;
    new host.SettingGroup(this.containerEl)
      .addSetting((setting) => {
        setting
          .setName(ng14T("setting.appearance.optionAccentColor", "Accent color"))
          .setDesc(ng14T("setting.appearance.optionAccentColorDesc", "Choose the accent color used across the app."))
          .addColorPicker((picker) => {
            const current = app.vault.getConfig("accentColor") || "#7c6cf0";
            picker.setValue(current).onChange((value) => this.setConfig("accentColor", value));
          });
      });
  };

  // --------------------------------------------------------- theme manager

  proto.renderThemeManager = function () {
    const self = this;
    const app = this.app;
    const css = app.customCss;
    const group = new host.SettingGroup(this.containerEl)
      .addHeading(() => ng14T("setting.appearance.optionTheme", "Theme"));

    // theme dropdown
    group.addSetting((setting) => {
      setting
        .setName(ng14T("setting.appearance.optionTheme", "Theme"))
        .setDesc(ng14T("setting.appearance.optionThemeDesc", "Choose a theme for the app."))
        .addDropdown((dropdown) => {
          const themes = [""].concat(
            Object.keys(css.themes || {}),
            (css.oldThemes || []).filter((name) => !(css.themes && css.themes[name]))
          );
          for (const name of themes) {
            dropdown.addOption(name, name === "" ? ng14T("setting.appearance.labelDefaultTheme", "Default") : name);
          }
          dropdown.setValue(css.theme || "").onChange((value) => {
            css.setTheme(value);
            self.setting.display && self.setting.display();
          });
        })
        .addExtraButton((button) => {
          button.setIcon("lucide-folder").setTooltip("Open theme folder").onClick(() => {
            env().Platform && env().Platform.openPath ? env().Platform.openPath(css.getThemeFolder()) : null;
          });
        })
        .addExtraButton((button) => {
          button.setIcon("lucide-layout-list").setTooltip("Manage themes").onClick(() => {
            new (env().A0 || env().D0 || Object.getPrototypeOf(self).constructor)(app, true).open();
          });
        });
    });

    // community themes + update badges
    if (css.hasUpdates && css.hasUpdates()) {
      group.addSetting((setting) => {
        setting
          .setName(ng14T("plugins.customCss.labelUpdatesAvailable", "Updates available"))
          .addButton((button) => {
            button.setButtonText("Update all").onClick(async () => {
              await css.checkForUpdates();
              for (const name of Object.keys(css.updates || {})) {
                const update = css.updates[name];
                try {
                  await css.installTheme(update.themeInfo || { name }, update.version || null);
                } catch (err) {}
              }
              css.updates = {};
              self.setting.display && self.setting.display();
            });
          });
      });
    }
  };

  // ------------------------------------------------------------- interface

  proto.renderInterface = function () {
    const self = this;
    const app = this.app;
    const platform = env().Platform;
    const group = new host.SettingGroup(this.containerEl)
      .addHeading(() => ng14T("setting.appearance.optionInterface", "Interface"));

    const addToggle = (label, desc, key, onChange) => {
      group.addSetting((setting) => {
        setting
          .setName(label)
          .setDesc(desc || "")
          .addToggle((toggle) => {
            toggle.setValue(self.configBool(key, false));
            toggle.onChange((value) => {
              self.setConfig(key, value);
              if (onChange) onChange(value);
            });
          });
      });
    };

    if (platform.isPhone) {
      addToggle(
        ng14T("setting.appearance.optionAutoFullScreen", "Auto fullscreen"),
        ng14T("setting.appearance.optionAutoFullScreenDesc", "Automatically enter fullscreen on launch."),
        "autoFullScreen"
      );
      addToggle(
        ng14T("setting.appearance.optionSlidingSidebar", "Sliding sidebar"),
        ng14T("setting.appearance.optionSlidingSidebarDesc", "Slide the sidebar instead of pushing content."),
        "slidingSidebar",
        () => {
          try { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); } catch (err) {}
        }
      );
    }
    if (platform.isMobile) {
      addToggle(
        ng14T("setting.appearance.optionFloatingNavigation", "Floating navigation"),
        ng14T("setting.appearance.optionFloatingNavigationDesc", "Use a floating navigation bar."),
        "floatingNavigation"
      );
    }
    addToggle(
      ng14T("setting.editor.optionShowInlineTitle", "Show inline title"),
      ng14T("setting.editor.optionShowInlineTitleDescription", "Show the note title inside the editor."),
      "showInlineTitle"
    );
    if (!platform.isPhone) {
      addToggle(
        ng14T("setting.appearance.optionShowViewHeader", "Show view header"),
        ng14T("setting.appearance.optionShowViewHeaderDesc", "Show the header of each view."),
        "showViewHeader"
      );
    }
    if (platform.canDisplayRibbon) {
      addToggle(
        ng14T("setting.appearance.optionShowRibbon", "Show ribbon"),
        ng14T("setting.appearance.optionShowRibbonDesc", "Show the ribbon on the left side."),
        "showRibbon",
        (value) => { document.body.toggleClass("show-ribbon", value); }
      );
      if (platform.isMobile || self.configBool("showRibbon", true)) {
        group.addSetting((setting) => {
          setting
            .setName(ng14T("setting.appearance.optionConfigureRibbon", "Configure ribbon"))
            .addButton((button) => {
              button.setButtonText(ng14T("dialogue.buttonManage", "Manage")).onClick(() => {
                const tab = self.setting && self.setting.openTabById ? self.setting.openTabById("ribbon") : null;
                if (tab && tab.display) tab.display();
              });
            });
        });
      }
    }
  };

  // ----------------------------------------------------------------- fonts

  proto.renderFonts = function () {
    const self = this;
    const app = this.app;
    const group = new host.SettingGroup(this.containerEl)
      .addHeading(() => ng14T("setting.appearance.optionFont", "Font"));

    const fontRows = [
      { key: "interfaceFontFamily", label: ng14T("setting.appearance.optionInterfaceFont", "Interface font"), desc: ng14T("setting.appearance.optionInterfaceFontDesc", "Font used in menus and dialogs.") },
      { key: "textFontFamily", label: ng14T("setting.appearance.optionTextFont", "Text font"), desc: ng14T("setting.appearance.optionTextFontDesc", "Font used for note text.") },
      { key: "monospaceFontFamily", label: ng14T("setting.appearance.optionMonospaceFont", "Monospace font"), desc: ng14T("setting.appearance.optionMonospaceFontDesc", "Font used for code blocks.") },
    ];

    for (const row of fontRows) {
      group.addSetting((setting) => {
        setting
          .setName(row.label)
          .setDesc(row.desc)
          .addExtraButton((button) => {
            button.setIcon("lucide-text").setTooltip(ng14T("setting.appearance.optionThemeButtonManage", "Manage")).onClick(() => {
              const current = (app.vault.getConfig(row.key) || "").split(",").map((s) => s.trim()).filter(Boolean);
              const modal = new (env().ZEE || host.FuzzySuggestModal)(app);
              // The font-list modal seeds with the current families and writes back on pick.
              modal.setPlaceholder && modal.setPlaceholder(row.label);
              modal.getItems = () => current;
              modal.renderSuggestion = (value, el) => { el.setText(value); };
              modal.onChooseSuggestion = (value, evt) => {
                const next = evt && evt.metaKey ? current.concat([value]) : [value];
                app.vault.setConfig(row.key, next.join(","));
                self.setting.display && self.setting.display();
              };
              modal.open();
            });
          });
        const families = (app.vault.getConfig(row.key) || "").split(",").map((s) => s.trim()).filter(Boolean);
        const descEl = setting.descEl;
        if (descEl && families.length) {
          const list = descEl.createEl("ul");
          for (const family of families) {
            const li = list.createEl("li", { text: family });
            li.addClass("u-pop");
            if (document.fonts && document.fonts.ready) {
              document.fonts.ready.then(() => {
                const ok = family === "" || document.fonts.check('12px "' + family + '"');
                if (!ok) {
                  li.addClass("mod-warning");
                  const icon = li.createSpan();
                  env().setIcon && env().setIcon(icon, "lucide-alert-circle");
                  env().displayTooltip && env().displayTooltip(li, ng14T("setting.appearance.msgFontNotFound", "Font not found"));
                }
              });
            }
          }
        }
      });
    }
  };

  // ------------------------------------------------------------- font size

  proto.renderFontSize = function () {
    const self = this;
    const app = this.app;
    const group = new host.SettingGroup(this.containerEl)
      .addHeading(() => ng14T("setting.appearance.optionFontSize", "Font size"));

    let size = parseInt(app.vault.getConfig("baseFontSize"), 10);
    if (isNaN(size)) size = 16;
    group.addSetting((setting) => {
      setting
        .setName(ng14T("setting.appearance.optionBaseFontSize", "Base font size"))
        .setDesc(ng14T("setting.appearance.optionBaseFontSizeDesc", "Base font size in pixels."))
        .addSlider((slider) => {
          slider
            .setLimits(10, 40, 1)
            .setValue(size)
            .setDynamicTooltip()
            .onChange((value) => {
              app.vault.setConfig("baseFontSize", value);
              document.documentElement.style.setProperty("--font-text-size", value + "px");
            });
        })
        .addExtraButton((button) => {
          button.setIcon("lucide-rotate-ccw").setTooltip("Reset").onClick(() => {
            app.vault.setConfig("baseFontSize", 16);
            self.setting.display && self.setting.display();
          });
        });
    });

    group.addSetting((setting) => {
      setting
        .setName(ng14T("setting.appearance.optionActionTextSize", "Action text size"))
        .setDesc(ng14T("setting.appearance.optionActionTextSizeDesc", "Scale interface text with the base font size."))
        .addToggle((toggle) => {
          toggle.setValue(self.configBool("interfaceFontSizeAdjust", true));
          toggle.onChange((value) => self.setConfig("interfaceFontSizeAdjust", value));
        });
    });
  };

  // --------------------------------------------------------------- advanced

  proto.renderAdvanced = function () {
    const self = this;
    const app = this.app;
    const platform = env().Platform;
    if (!platform.isDesktopApp) return;

    const group = new host.SettingGroup(this.containerEl)
      .addHeading(() => ng14T("setting.appearance.optionAdvanced", "Advanced"));

    const rows = [
      { key: "zoom", label: "Zoom", type: "number", min: 0.5, max: 3, step: 0.1, get: () => app.vault.getConfig("zoom") || 100, set: (v) => app.vault.setConfig("zoom", v) },
      { key: "nativeMenus", label: "Native menus", type: "toggle", get: () => self.configBool("nativeMenus", true), set: (v) => self.setConfig("nativeMenus", v) },
      { key: "windowFrameStyle", label: "Window frame style", type: "text", get: () => app.vault.getConfig("windowFrameStyle") || "", set: (v) => self.setConfig("windowFrameStyle", v) },
      { key: "customAppIcon", label: "Custom app icon", type: "text", get: () => app.vault.getConfig("customAppIcon") || "", set: (v) => self.setConfig("customAppIcon", v) },
      { key: "translucency", label: "Translucency", type: "toggle", get: () => self.configBool("translucency", false), set: (v) => self.setConfig("translucency", v) },
      { key: "hardwareAcceleration", label: "Hardware acceleration", type: "toggle", get: () => self.configBool("hardwareAcceleration", true), set: (v) => self.setConfig("hardwareAcceleration", v) },
    ];

    for (const row of rows) {
      group.addSetting((setting) => {
        setting.setName(row.label).setDesc("");
        if (row.type === "toggle") {
          setting.addToggle((toggle) => {
            toggle.setValue(!!row.get());
            toggle.onChange((value) => row.set(value));
          });
        } else if (row.type === "text") {
          setting.addText((text) => {
            text.setValue(row.get() || "").onChange((value) => row.set(value));
          });
        } else {
          setting.addText((text) => {
            text.setValue(String(row.get())).onChange((value) => {
              const n = parseFloat(value);
              if (!isNaN(n)) row.set(n);
            });
          });
        }
      });
    }
  };

  // --------------------------------------------------------------- snippets

  proto.renderSnippets = function () {
    const self = this;
    const app = this.app;
    const css = app.customCss;
    const group = new host.SettingGroup(this.containerEl)
      .addHeading(() => ng14T("setting.appearance.optionCssSnippets", "CSS snippets"));

    const snippets = (css && css.snippets) || [];
    const enabled = (css && css.enabledSnippets) || new Set();

    if (!snippets.length) {
      group.addSetting((setting) => {
        setting
          .setName(ng14T("plugins.customCss.labelNoSnippets", "No CSS snippets"))
          .setDesc(ng14T("plugins.customCss.noSnippetDescription", "Add .css files to the snippets folder."));
      });
      return;
    }

    const folderBtn = () => {
      group.addSetting((setting) => {
        setting
          .setName(ng14T("setting.appearance.optionSnippetFolder", "Snippet folder"))
          .addButton((button) => {
            button.setButtonText("Open folder").onClick(() => {
              env().Platform && env().Platform.openPath && env().Platform.openPath(css.getSnippetsFolder());
            });
          });
      });
    };
    folderBtn();

    for (const name of snippets) {
      group.addSetting((setting) => {
        setting
          .setName(name)
          .setDesc(ng14T("plugins.customCss.snippetDescription", "CSS snippet"))
          .addToggle((toggle) => {
            toggle.setValue(enabled.has(name));
            toggle.onChange(async (value) => {
              if (value) enabled.add(name); else enabled.delete(name);
              if (css.saveSnippetsConfig) await css.saveSnippetsConfig([...enabled]);
              else app.vault.setConfig("enabledCssSnippets", [...enabled]);
              if (css.reloadSnippets) css.reloadSnippets();
            });
          });
      });
    }
  };

  return AppearanceTab;
}
