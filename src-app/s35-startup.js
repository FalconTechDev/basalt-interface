// Basalt start-up time modal and its stat-row helper.
// Faithful port of the inherited "Startup time" dialog: device/OS rows, the timed
// breakdown (total, initialization, vault, workspace, core plugins, community
// plugins) and the copy-to-clipboard summary. App-scope helpers arrive through
// host/env; bundle async plumbing becomes native async/await.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { chromeVersion } from "./text.js";
import { s05AnimDuration, s05LookupAnimNode } from "./s05-utils.js";
import { s16ApiVersion } from "./s16-constants.js";


// One labelled row of the start-up report (was `L7`).
export function s35StartupStat() {
  function StartupStat(containerEl) {
    this.containerEl = containerEl.createDiv("startup-stat");
    this.infoEl = this.containerEl.createDiv("startup-info");
  }
  StartupStat.prototype.setHeading = function (heading) {
    this.containerEl.toggleClass("mod-heading", heading);
    return this;
  };
  StartupStat.prototype.addLabel = function (text) {
    this.infoEl.createSpan({ cls: "startup-label", text });
    return this;
  };
  StartupStat.prototype.addDesc = function (text) {
    this.infoEl.createSpan({ cls: "startup-desc", text });
    return this;
  };
  StartupStat.prototype.addValue = function (text) {
    this.containerEl.createDiv({ cls: "startup-value", text });
    return this;
  };
  return StartupStat;
}

function s35StartupFormatter() {
  const fmt = new Intl.NumberFormat(env().sm(), { maximumFractionDigits: 0 });
  return (ms) => `${fmt.format(ms)}ms`;
}

// "Startup time" modal opened from the plugin debug menu (was `I7`).
export function s35StartupModal(host) {
  const Base = host.DialogModal;
  const Stat = s35StartupStat();
  const platform = host.Platform;
  const i18n = () => host.i18n;
  const fmt = s35StartupFormatter();

  function pluginRows(app) {
    const node = s05LookupAnimNode("communityPlugins");
    if (!node) return null;
    const rows = [];
    for (const child of Object.values(node.children)) {
      rows.push({ id: child.key, time: child.duration });
    }
    rows.sort((a, b) => b.time - a.time);
    return rows;
  }

  function StartupModal(app) {
    const self = Base.call(this, app) || this;
    self.setTitle("Startup time");
    self.modalEl.addClass("mod-lg", "mod-scrollable-content", "mod-plugin-debug");

    const info = self.contentEl.createDiv("startup-stat-list");
    const device = new Stat(info).addLabel("Device");
    const os = new Stat(info).addLabel("Operating system");
    const basalt = new Stat(info).addLabel("Basalt");
    if (platform.isMobileApp) {
      device.addValue(`${platform.manufacturer} ${platform.model}`);
      os.addValue(`${platform.osName} ${platform.osVersion}`);
      basalt.addDesc(platform.version);
      basalt.addLabel("Build").addDesc(platform.build);
    } else if (platform.isDesktopApp) {
      device.containerEl.hide();
      os.addValue(`${platform.osName} ${platform.osVersion}`);
      basalt.addDesc(platform.version);
      basalt.addLabel("Installer").addDesc(platform.build);
    }

    const timing = self.contentEl.createDiv("startup-timing-list");
    new Stat(timing).setHeading(true).addLabel("Total app startup").addValue(fmt(s05AnimDuration()));
    new Stat(timing).addLabel("Initialization").addValue(fmt(s05AnimDuration("initialization")));
    new Stat(timing)
      .addLabel("Vault")
      .addDesc(i18n().nouns.fileWithCount({ count: app.vault.getRoot().getFileCount() }))
      .addValue(fmt(s05AnimDuration("vault")));
    new Stat(timing)
      .addLabel("Workspace")
      .addDesc(`${env().sD.views} tabs (${env().sD.deferredViews} deferred)`)
      .addValue(fmt(s05AnimDuration("workspace")));
    new Stat(timing)
      .addLabel("Core plugins")
      .addDesc(i18n().nouns.pluginActiveWithCount({ count: app.internalPlugins.getEnabledPlugins().length }))
      .addValue(fmt(s05AnimDuration("corePlugins")));

    const list = self.contentEl.createDiv("startup-timing-list");
    const node = s05LookupAnimNode("communityPlugins");
    if (node) {
      const rows = [];
      for (const child of Object.values(node.children)) {
        rows.push({ id: child.key, time: child.duration });
      }
      rows.sort((a, b) => b.time - a.time);
      new Stat(list)
        .setHeading(true)
        .addLabel("Community plugins")
        .addDesc(i18n().nouns.pluginActiveWithCount({ count: Object.keys(app.plugins.plugins).length }))
        .addValue(fmt(s05AnimDuration("communityPlugins")));
      for (const row of rows) {
        const manifest = self.app.plugins.manifests[row.id];
        new Stat(list)
          .addLabel(manifest ? manifest.name : row.id)
          .addDesc(manifest ? manifest.version : "")
          .addValue(fmt(row.time));
      }
    }

    self
      .addButton("mod-secondary", i18n().interface.labelCopy(), async () => {
        await navigator.clipboard.writeText(s35StartupSummary(app));
        new host.Notice(i18n().interface.copied({ context: "generic" }));
        return true;
      })
      .addButton("mod-cancel", i18n().dialogue.buttonDone(), () => {});
    return self;
  }
  inherit(StartupModal, Base);

  function s35StartupSummary(app) {
    const lines = ["Basalt start-up time breakdown", ""];
    if (platform.isDesktopApp) {
      lines.push(`Basalt version: ${platform.version}`);
      lines.push(`Installer version: ${platform.build}`);
      lines.push(`Operating system: ${platform.osName} ${platform.osVersion}`);
    }
    if (platform.isMobileApp) {
      lines.push(`Basalt version: ${platform.version} (${platform.build})`);
      lines.push(`API version: ${s16ApiVersion}`);
      lines.push(`Operating system: ${platform.osName} ${platform.osVersion} (${platform.manufacturer} ${platform.model})`);
      if (platform.isAndroidApp) lines.push(`Webview version: ${chromeVersion(navigator.userAgent)}`);
    }
    lines.push("");
    const countFmt = new Intl.NumberFormat(env().sm(), { maximumFractionDigits: 0 });
    lines.push(`- Total startup time: ${fmt(s05AnimDuration())}`);
    lines.push(`- Initialization: ${fmt(s05AnimDuration("initialization"))}`);
    if (s05AnimDuration("icloud")) lines.push(`- iCloud: ${fmt(s05AnimDuration("icloud"))}`);
    lines.push(`- Vault (${countFmt.format(app.vault.getRoot().getFileCount())} files): ${fmt(s05AnimDuration("vault"))}`);
    lines.push(`- Workspace (${env().sD.views} tabs, ${env().sD.deferredViews} deferred): ${fmt(s05AnimDuration("workspace"))}`);
    lines.push(`- Core plugins: ${fmt(s05AnimDuration("corePlugins"))}`);
    const rows = pluginRows(app);
    if (rows) {
      lines.push(`- Community plugins (${countFmt.format(Object.keys(app.plugins.plugins).length)} active): ${fmt(s05AnimDuration("communityPlugins"))}`);
      for (const row of rows) {
        const manifest = app.plugins.manifests[row.id];
        lines.push(`  - ${manifest.name} (${manifest.version}): ${fmt(row.time)}`);
      }
    }
    return lines.join("\n");
  }

  return StartupModal;
}
