// Startup-time modal (s14): the "Startup time" dialog shown from the help/startup menu.
//
//   L7  StartupStat — one label/description/value row inside the modal (not a Component, just a
//       small builder object the modal composes lists from).
//   I7  StartupTimeModal — DialogModal listing device info and the recorded startup timings
//       (total, initialization, vault, workspace, core + community plugins) with a copy button.
import { env } from "./env.js";

/** One stat row: heading flag, label, optional description and a right-aligned value (was `L7`). */
class S14StartupStat {
  constructor(containerEl) {
    this.containerEl = containerEl.createDiv("startup-stat");
    this.infoEl = this.containerEl.createDiv("startup-info");
  }

  setHeading(isHeading) {
    this.containerEl.toggleClass("mod-heading", isHeading);
    return this;
  }

  addLabel(text) {
    this.infoEl.createSpan({ cls: "startup-label", text });
    return this;
  }

  addDesc(text) {
    this.infoEl.createSpan({ cls: "startup-desc", text });
    return this;
  }

  addValue(text) {
    this.containerEl.createDiv({ cls: "startup-value", text });
    return this;
  }
}

export function defineStartupStat(host) {
  return S14StartupStat;
}

const s14Fmt = (host) => new host.s13NumberFormat({ maximumFractionDigits: 0 });
const s14Ms = (formatter, value) => formatter.format(value) + "ms";

/** Dialog listing where startup time went, with a button that copies the breakdown (was `I7`). */
export function defineStartupTimeModal(host) {
  class StartupTimeModal extends host.DialogModal {
    constructor(app) {
      super(app);
      const t = env();
      this.setTitle("Startup time");
      this.modalEl.addClass("mod-lg", "mod-scrollable-content", "mod-plugin-debug");

      const fmt = s14Fmt(host);
      const ms = (v) => s14Ms(fmt, v);
      const Stat = S14StartupStat;
      const i18n = t.gm;

      // ---- device / environment ----
      const deviceList = this.contentEl.createDiv("startup-stat-list");
      const device = new Stat(deviceList).addLabel("Device");
      const os = new Stat(deviceList).addLabel("Operating system");
      const build = new Stat(deviceList).addLabel("Basalt");
      const platform = host.Platform;
      if (platform.isMobileApp) {
        device.addValue(`${platform.manufacturer} ${platform.model}`);
        os.addValue(`${platform.osName} ${platform.osVersion}`);
        build.addDesc(platform.version);
        build.addLabel("Build");
        build.addDesc(platform.build);
      } else if (platform.isDesktopApp) {
        device.containerEl.hide();
        os.addValue(`${platform.osName} ${platform.osVersion}`);
        build.addDesc(platform.version);
        build.addLabel("Installer");
        build.addDesc(platform.build);
      }

      // ---- core timings ----
      const coreList = this.contentEl.createDiv("startup-timing-list");
      const root = app.vault.getRoot();
      new Stat(coreList).setHeading(true).addLabel("Total app startup").addValue(ms(t.hD()));
      new Stat(coreList).addLabel("Initialization").addValue(ms(t.hD("initialization")));
      new Stat(coreList)
        .addLabel("Vault")
        .addDesc(i18n.nouns.fileWithCount({ count: root.getFileCount() }))
        .addValue(ms(t.hD("vault")));
      new Stat(coreList)
        .addLabel("Workspace")
        .addDesc(`${t.sD.views} tabs (${t.sD.deferredViews} deferred)`)
        .addValue(ms(t.hD("workspace")));
      new Stat(coreList)
        .addLabel("Core plugins")
        .addDesc(i18n.nouns.pluginActiveWithCount({ count: app.internalPlugins.getEnabledPlugins().length }))
        .addValue(ms(t.hD("corePlugins")));

      // ---- community plugins, slowest first ----
      const community = t.uD("communityPlugins");
      if (community) {
        const pluginList = this.contentEl.createDiv("startup-timing-list");
        const count = Object.keys(app.plugins.plugins).length;
        const timings = Object.values(community.children).map((c) => ({ id: c.key, time: c.duration }));
        new Stat(pluginList)
          .setHeading(true)
          .addLabel("Community plugins")
          .addDesc(i18n.nouns.pluginActiveWithCount({ count }))
          .addValue(ms(t.hD("communityPlugins")));
        timings.sort((a, b) => b.time - a.time);
        for (const { id, time } of timings) {
          const manifest = app.plugins.manifests[id];
          new Stat(pluginList).addLabel(manifest ? manifest.name : id).addDesc(manifest ? manifest.version : "").addValue(ms(time));
        }
      }

      const copyText = () => {
        const lines = ["Basalt start-up time breakdown", ""];
        if (platform.isDesktopApp) {
          lines.push(`Basalt version: ${platform.version}`);
          lines.push(`Installer version: ${platform.build}`);
          lines.push(`Operating system: ${platform.osName} ${platform.osVersion}`);
        }
        if (platform.isMobileApp) {
          lines.push(`Basalt version: ${platform.version} (${platform.build})`);
          lines.push(`API version: ${t.gte}`);
          lines.push(`Operating system: ${platform.osName} ${platform.osVersion} (${platform.manufacturer} ${platform.model})`);
          if (platform.isAndroidApp) lines.push(`Webview version: ${t.rD(navigator.userAgent)}`);
        }
        lines.push("");
        const fileCount = app.vault.getRoot().getFileCount();
        const pluginCount = Object.keys(app.plugins.plugins).length;
        lines.push(`- Total startup time: ${ms(t.hD())}`);
        lines.push(`- Initialization: ${ms(t.hD("initialization"))}`);
        const icloud = t.hD("icloud");
        if (icloud) lines.push(`- iCloud: ${ms(icloud)}`);
        lines.push(`- Vault (${fmt.format(fileCount)} files): ${ms(t.hD("vault"))}`);
        lines.push(`- Workspace (${t.sD.views} tabs, ${t.sD.deferredViews} deferred): ${ms(t.hD("workspace"))}`);
        lines.push(`- Core plugins: ${ms(t.hD("corePlugins"))}`);
        const communityTimings = t.uD("communityPlugins");
        if (communityTimings) {
          lines.push(`- Community plugins (${fmt.format(pluginCount)} active): ${ms(t.hD("communityPlugins"))}`);
          const timings = Object.values(communityTimings.children)
            .map((c) => ({ id: c.key, time: c.duration }))
            .sort((a, b) => b.time - a.time);
          for (const { id, time } of timings) {
            const manifest = app.plugins.manifests[id];
            lines.push(`  - ${manifest.name} (${manifest.version}): ${ms(time)}`);
          }
        }
        return lines.join("\n");
      };

      return this.addButton("mod-secondary", i18n.interface.labelCopy(), async () => {
        await navigator.clipboard.writeText(copyText());
        new t.fb(i18n.interface.copied({ context: "generic" }));
        return true;
      }).addButton("mod-cancel", i18n.dialogue.buttonDone(), () => {});
    }
  }
  return StartupTimeModal;
}
