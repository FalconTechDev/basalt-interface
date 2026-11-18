// s29: the debug-info modal (was m0).
//
// Collects versions, theme/snippet/plugin state and upgrade recommendations into a read-only
// text area with copy and (on desktop) sandbox-vault actions.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { isOlderVersion } from "./text.js";
import { s05SystemInfo } from "./s05-utils.js";
import { s04ProjectUrl } from "./s04-http.js";

export function defineDebugInfoModal(host) {
  const i18n = () => host.i18n.interface;

  function DebugInfoModal(app) {
    const self = host.ButtonModal.call(this, app) || this;
    self.modalEl.addClass("mod-lg");
    self.titleEl.setText(i18n().labelDebugInfo());
    const contentEl = self.contentEl;
    const infoTextEl = (self.infoTextEl = contentEl.createEl("textarea", { cls: "debug-textarea" }));
    infoTextEl.spellcheck = false;
    infoTextEl.disabled = true;
    infoTextEl.value = "Loading...";
    self.setInfoText();
    self.addButton("mod-secondary", i18n().labelCopy(), () => {
      env().Ec(infoTextEl.value);
      new (env().fb)(i18n().copied({ item: i18n().labelDebugInfo() }));
    });
    if (env().Yl.isDesktop && env().Yl.isDesktopApp) {
      self.addButton("", i18n().helpScreen.labelSandboxVault(), () => {
        env().Of((electron) => electron.ipcRenderer.sendSync("sandbox"));
      });
    }
    self.addButton("mod-cancel", host.i18n.dialogue.buttonDone(), () => {});
    return self;
  }
  inherit(DebugInfoModal, host.ButtonModal);

  DebugInfoModal.prototype.setInfoText = async function () {
    const app = this.app;
    const infoTextEl = this.infoTextEl || this.contentEl.querySelector(".debug-textarea");
    let text = await s05SystemInfo();
    text += "\tLive preview: " + (app.vault.getConfig("livePreview") ? "on" : "off") + "\n";
    if (document.body.hasClass("emulate-mobile")) text += "\tEmulate mobile: on\n";
    const theme = app.vault.getConfig("theme");
    text += "\tBase theme: " + (theme === "system" ? "adapt to system" : theme === "basalt" ? "dark" : "light") + "\n";
    const customTheme = app.customCss.theme || "none";
    text += "\tCommunity theme: " + customTheme;
    const themeVersion = app.customCss.themes[customTheme]?.version;
    if (themeVersion) text += " " + themeVersion;
    text += "\n";
    const snippetCount = app.customCss.snippets.filter((snippet) => app.customCss.enabledSnippets.has(snippet)).length;
    text += "\tSnippets enabled: " + snippetCount + "\n";
    const restricted = app.plugins.isEnabled() ? "off" : "on";
    text += "\tRestricted mode: " + restricted + "\n";
    let pluginCount = 0;
    let enabledCount = 0;
    if (app.plugins.isEnabled()) {
      const manifests = app.plugins.manifests;
      const pluginIds = Object.keys(manifests);
      const plugins = app.plugins.plugins;
      text += "\tPlugins installed: " + pluginIds.length + "\n";
      enabledCount = Object.keys(plugins).length;
      text += "\tPlugins enabled: " + enabledCount + "\n";
      let index = 1;
      for (const id in plugins) {
        if (!Object.hasOwn(plugins, id)) continue;
        text += "\t\t" + index + ": " + plugins[id].manifest.name + " v" + plugins[id].manifest.version + "\n";
        index++;
      }
    }
    text += "\nRECOMMENDATIONS:\n";
    let recommendations = "";
    if (env().Yl.isDesktopApp && isOlderVersion(env().zf, env().yte)) {
      recommendations += "\tUpdate installer: installer version too low, please download from " + s04ProjectUrl() + " and reinstall.\n";
    }
    if (customTheme !== "none" || snippetCount > 0) {
      recommendations += "\tCustom theme and snippets: for cosmetic issues, please first try updating your theme and disabling your snippets. If still not fixed, please try to make the issue happen in the Sandbox Vault or disable community theme and snippets.\n";
    }
    if (restricted === "off" && enabledCount > 0) {
      recommendations += "\tCommunity plugins: for bugs, please first try updating all your plugins to latest. If still not fixed, please try to make the issue happen in the Sandbox Vault or disable community plugins.\n";
    }
    if (recommendations === "") recommendations = "\tnone\n";
    text += recommendations;
    this.infoTextEl.value = text;
  };

  return DebugInfoModal;
}
