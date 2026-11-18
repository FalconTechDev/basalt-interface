// g01 clean-room: plugin / theme / snippet CLI commands.
import { env } from "./env.js";
import { ng01Collator } from "./n-g01-util.js";
import { ng01CommunityPlugins } from "./n-g01-table.js";

// request/rawFileUrl/pickCompatibleVersion are flat-scope helpers owned by community.js.

const ng01PluginSort = (a, b) => ng01Collator.compare(a, b);

function ng01CoreInfo(app, id) {
  const wrapper = app.internalPlugins.getPluginById(id);
  if (!wrapper) return null;
  return { id, name: wrapper.instance.name, enabled: !!wrapper.enabled, type: "core" };
}

function ng01CommInfo(app, id) {
  const manifest = app.plugins.manifests[id];
  if (!manifest) return null;
  return {
    id,
    name: manifest.name || id,
    version: manifest.version || "",
    author: manifest.author || "",
    description: manifest.description || "",
    enabled: app.plugins.enabledPlugins.has(id),
    type: "community",
  };
}

/** Detects plugin kind; core wins when an id exists in both registries. */
function ng01FindPlugin(app, id, filter) {
  const core = filter !== "community" ? ng01CoreInfo(app, id) : null;
  if (core) return core;
  return ng01CommInfo(app, id);
}

export function ng01RegisterPlugins(cli, host) {
  const app = cli.app;

  // ------------------------------------------------------------ plugin info

  cli.registerHandler("plugin", "Plugin information", {
    id: { value: "<id>", description: "Plugin id", required: true },
  }, (args) => {
    const id = String(args.id);
    const info = ng01FindPlugin(app, id);
    if (!info) throw `Plugin "${id}" not found.`;
    if (info.type === "core") {
      return cli.formatTable(["type", "name", "enabled"], [["core", info.name, String(info.enabled)]]);
    }
    const rows = [["community", info.name, info.version, info.author, String(info.enabled)]];
    const headers = ["type", "name", "version", "author", "enabled"];
    if (info.description) rows[0].push(info.description);
    return cli.formatTable(headers.concat(info.description ? ["description"] : []), rows);
  });

  const pluginRows = (enabledOnly) => {
    const rows = [];
    if (!enabledOnly || true) {
      const coreIds = enabledOnly
        ? app.internalPlugins.getEnabledPlugins().map((w) => w.instance.id)
        : Object.keys(app.internalPlugins.plugins);
      for (const id of coreIds) {
        const w = app.internalPlugins.getPluginById(id);
        rows.push({ id, type: "core", version: "", enabled: !!(w && w.enabled) });
      }
      const commIds = enabledOnly
        ? Array.from(app.plugins.enabledPlugins)
        : Object.keys(app.plugins.manifests);
      for (const id of commIds) {
        const m = app.plugins.manifests[id];
        rows.push({ id, type: "community", version: (m && m.version) || "", enabled: app.plugins.enabledPlugins.has(id) });
      }
    }
    return rows.sort((a, b) => ng01Collator.compare(a.id, b.id));
  };

  const pluginsHandler = (enabledOnly) => (args) => {
    let rows = pluginRows(enabledOnly);
    const filter = args.filter !== undefined ? String(args.filter) : "";
    if (filter === "core") rows = rows.filter((r) => r.type === "core");
    else if (filter === "community") rows = rows.filter((r) => r.type === "community");
    const headers = args.versions !== undefined ? ["id", "version"] : ["id"];
    return cli.formatTable(headers, rows.map((r) => headers.length === 2 ? [r.id, r.version] : [r.id]), args.format);
  };

  const pluginsFlags = {
    filter: { value: "core|community", description: "Plugin kind" },
    versions: { description: "Include version column" },
    format: { value: "json|tsv|csv", description: "Output format" },
  };
  cli.registerHandler("plugins", "List plugins", pluginsFlags, pluginsHandler(false));
  cli.registerHandler("plugins:enabled", "List enabled plugins", pluginsFlags, pluginsHandler(true));

  cli.registerHandler("plugins:restrict", "Community plugins restricted mode", {
    on: { description: "Enable restriction" },
    off: { description: "Disable restriction" },
  }, async (args) => {
    const restricted = !app.plugins.isEnabled();
    if (args.on !== undefined || args.off !== undefined) {
      const want = args.on !== undefined;
      if (want === restricted) return `Already ${want ? "restricted" : "unrestricted"}.`;
      await app.plugins.setEnable(!want);
      setTimeout(() => window.location.reload(), 300);
      return `Restricted mode ${want ? "enabled" : "disabled"}. Reloading...`;
    }
    return restricted ? "Restricted mode: on" : "Restricted mode: off";
  });

  // ------------------------------------------------------------ enable / disable / reload / uninstall

  const togglePlugin = (enable) => async (args) => {
    const id = String(args.id);
    const filter = args.filter !== undefined ? String(args.filter) : "";
    const info = ng01FindPlugin(app, id, filter);
    if (!info) throw `Plugin "${id}" not found.`;
    if (info.type === "core") {
      const wrapper = app.internalPlugins.getPluginById(id);
      if (enable) {
        if (wrapper.enabled) throw `Plugin "${id}" is already enabled.`;
        await wrapper.enable(true);
      } else {
        if (!wrapper.enabled) throw `Plugin "${id}" is already disabled.`;
        wrapper.disable(true);
      }
      return `${enable ? "Enabled" : "Disabled"}: ${id}`;
    }
    if (!app.plugins.manifests[id]) throw `Plugin "${id}" not found.`;
    if (enable) {
      if (app.plugins.enabledPlugins.has(id)) throw `Plugin "${id}" is already enabled.`;
      await app.plugins.enablePluginAndSave(id);
    } else {
      if (!app.plugins.enabledPlugins.has(id)) throw `Plugin "${id}" is already disabled.`;
      await app.plugins.disablePluginAndSave(id);
    }
    return `${enable ? "Enabled" : "Disabled"}: ${id}`;
  };

  const pluginActionFlags = {
    id: { value: "<id>", description: "Plugin id", required: true },
    filter: { value: "core|community", description: "Plugin kind" },
  };
  cli.registerHandler("plugin:enable", "Enable a plugin", pluginActionFlags, togglePlugin(true));
  cli.registerHandler("plugin:disable", "Disable a plugin", pluginActionFlags, togglePlugin(false));

  cli.registerHandler("plugin:reload", "Reload a plugin", {
    id: { value: "<id>", description: "Plugin id", required: true },
  }, async (args) => {
    const id = String(args.id);
    const core = ng01CoreInfo(app, id);
    if (core) {
      const wrapper = app.internalPlugins.getPluginById(id);
      if (!wrapper.enabled) throw `Plugin "${id}" is not enabled.`;
      wrapper.disable();
      await wrapper.enable();
      return `Reloaded: ${id}`;
    }
    if (!app.plugins.manifests[id]) throw `Plugin "${id}" not found.`;
    if (!app.plugins.enabledPlugins.has(id)) throw `Plugin "${id}" is not enabled.`;
    await app.plugins.disablePlugin(id);
    await app.plugins.loadManifests();
    await app.plugins.enablePlugin(id);
    return `Reloaded: ${id}`;
  });

  cli.registerHandler("plugin:uninstall", "Uninstall a plugin", {
    id: { value: "<id>", description: "Plugin id", required: true },
  }, async (args) => {
    const id = String(args.id);
    if (ng01CoreInfo(app, id)) throw `Core plugin "${id}" cannot be uninstalled.`;
    if (!app.plugins.manifests[id] && !app.plugins.plugins[id]) throw `Plugin "${id}" is not installed.`;
    await app.plugins.uninstallPlugin(id);
    return `Uninstalled: ${id}`;
  });

  cli.registerHandler("plugin:install", "Install a community plugin", {
    id: { value: "<id>", description: "Plugin id", required: true },
    enable: { description: "Enable after install" },
  }, async (args) => {
    const id = String(args.id);
    if (app.plugins.manifests[id] || app.plugins.plugins[id]) throw `Plugin "${id}" is already installed.`;
    const list = await ng01CommunityPlugins();
    const entry = list.find((e) => e.id === id);
    if (!entry) throw `Plugin "${id}" not found in community plugins.`;
    let manifest;
    try {
      manifest = await request(rawFileUrl(entry.repo, "manifest.json")).json;
    } catch (e) {
      throw `Failed to fetch manifest for "${id}".`;
    }
    if (!manifest || manifest.id !== id) throw `Plugin manifest for "${id}" could not be fetched.`;
    const version = await pickCompatibleVersion(entry.repo, manifest);
    if (!version) throw `No compatible version found for "${id}".`;
    try {
      await app.plugins.installPlugin(entry.repo, version, manifest);
    } catch (e) {
      throw `Failed to install "${id}": ${e && e.message ? e.message : e}`;
    }
    if (args.enable !== undefined) await app.plugins.enablePluginAndSave(id);
    return `Installed: ${id}`;
  });

  // ------------------------------------------------------------ themes

  cli.registerHandler("themes", "List themes", {
    versions: { description: "Include versions" },
  }, (args) => {
    const css = app.customCss;
    const names = new Set(Object.keys(css.themes || {}));
    for (const n of css.oldThemes || []) names.add(n);
    const sorted = Array.from(names).sort(ng01PluginSort);
    if (args.versions !== undefined) {
      return sorted.map((n) => {
        const t = css.themes[n];
        return n + "\t" + (t && t.version ? t.version : css.oldThemes && css.oldThemes.contains && css.oldThemes.contains(n) ? "(legacy theme)" : "");
      }).join("\n");
    }
    return sorted.join("\n");
  });

  cli.registerHandler("theme", "Theme information", {
    name: { value: "<name>", description: "Theme name" },
  }, (args) => {
    const css = app.customCss;
    if (args.name === undefined) {
      const active = css.theme || "";
      return active || "(default)";
    }
    const name = String(args.name);
    const t = css.themes[name];
    const isLegacy = !t && css.oldThemes && css.oldThemes.contains && css.oldThemes.contains(name);
    if (!t && !isLegacy) throw `Theme "${name}" is not installed.`;
    const active = (css.theme || "") === name;
    if (isLegacy) {
      return cli.formatTable(["name", "version", "active"], [[name, "(legacy theme)", String(active)]]);
    }
    return cli.formatTable(["name", "version", "author", "active"], [[name, t.version || "(unknown)", t.author || "", String(active)]]);
  });

  cli.registerHandler("theme:set", "Switch theme", {
    name: { value: "<name>", description: "Theme name (empty = default)", required: true },
  }, (args) => {
    const css = app.customCss;
    const name = String(args.name);
    if (name === "") {
      css.setTheme("");
      return "Switched to default theme";
    }
    const known = css.themes[name] || (css.oldThemes && css.oldThemes.contains && css.oldThemes.contains(name));
    if (!known) throw `Theme "${name}" is not installed.`;
    css.setTheme(name);
    return `Switched to: ${name}`;
  });

  cli.registerHandler("theme:install", "Install a community theme", {
    name: { value: "<name>", description: "Theme name", required: true },
    enable: { description: "Activate after install" },
  }, async (args) => {
    const name = String(args.name);
    const css = app.customCss;
    if (css.isThemeInstalled(name)) throw `Theme "${name}" is already installed.`;
    const themes = await env().Pb();
    const info = (themes || []).find((t) => t.name === name);
    if (!info) throw `Theme "${name}" not found in community themes.`;
    const manifest = await css.getManifest(info.repo);
    const version = manifest ? await pickCompatibleVersion(info.repo, manifest) : null;
    await css.installTheme(info, version);
    if (args.enable !== undefined) css.setTheme(name);
    return `Installed: ${name}`;
  });

  cli.registerHandler("theme:uninstall", "Uninstall a theme", {
    name: { value: "<name>", description: "Theme name", required: true },
  }, async (args) => {
    const name = String(args.name);
    await app.customCss.removeTheme(name);
    return `Uninstalled: ${name}`;
  });

  // ------------------------------------------------------------ snippets

  cli.registerHandler("snippets", "List snippets", null, () => {
    return (app.customCss.snippets || []).join("\n");
  });

  cli.registerHandler("snippets:enabled", "List enabled snippets", null, () => {
    return (app.customCss.enabledSnippets || []).join("\n");
  });

  const snippetToggle = (enable) => (args) => {
    const name = String(args.name);
    const css = app.customCss;
    const known = (css.snippets || []).includes(name);
    if (!known) throw `Snippet "${name}" not found.`;
    const enabled = (css.enabledSnippets || []).includes(name);
    if (enable === enabled) return `Snippet "${name}" is already ${enable ? "enabled" : "disabled"}.`;
    css.setCssEnabledStatus(name, enable);
    return `${enable ? "Enabled" : "Disabled"}: ${name}`;
  };

  const snippetFlags = {
    name: { value: "<name>", description: "Snippet name", required: true },
  };
  cli.registerHandler("snippet:enable", "Enable a snippet", snippetFlags, snippetToggle(true));
  cli.registerHandler("snippet:disable", "Disable a snippet", snippetFlags, snippetToggle(false));
}
