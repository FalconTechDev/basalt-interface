// Global search plugin: registers the "search" side-leaf view type, the
// global-search commands, editor/file context-menu entries and the CLI
// handlers. The search view itself (mJ) and the query engine (BH) stay
// app-scope and are reached through env().
import { env } from "./env.js";
import { s11SearchStrings } from "./s11-i18n.js";

export const s11SearchViewType = "search";

// Search operator metadata shown by the search view's suggestion UI.
export function s11SearchOperators() {
  const s = s11SearchStrings();
  return [
    { type: "operator", name: "path:", token: "path:", infoTextI18n: s.labelPathOptionDescription },
    { type: "operator", name: "file:", token: "file:", infoTextI18n: s.labelFileNameOptionDescription },
    { type: "operator", name: "tag:", token: "tag:", infoTextI18n: s.labelTagOptionDescription },
    { type: "operator", name: "line:", token: "line:()", infoTextI18n: s.labelLineOptionDescription },
    { type: "operator", name: "section:", token: "section:()", infoTextI18n: s.labelSectionOptionDescription },
    { type: "operator", name: "[property]", token: "[]", infoTextI18n: s.labelPropertyOptionDescription },
  ];
}

// Sanitizes a would-be filename; falls back to "Untitled" when the vault
// rejects the result.
export function s11UntitledName(name) {
  name = env().cu((name = name.replace(/[?*]/g, "")).replace(/[\\/:]/g, " - "));
  try {
    env().KT(name);
  } catch (e) {
    return "Untitled";
  }
  return name;
}

export function s11SearchPlugin() {
  function SearchPlugin() {
    this.id = "global-search";
    this.name = s11SearchStrings().name();
    this.description = s11SearchStrings().desc();
    this.defaultOn = true;
    this.app = null;
    this.plugin = null;
    this.options = {};
  }
  const proto = SearchPlugin.prototype;
  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerGlobalCommand({
      id: "global-search:open",
      name: s11SearchStrings().actionOpenSearch(),
      icon: "lucide-search",
      callback: () => {
        let query = window.getSelection().toString();
        const view = app.workspace.getActiveViewOfType(env().W6);
        if (view) {
          const selection = view.getSelection();
          if (selection) query = selection;
        }
        if (query) {
          if (query.contains(" ")) query = '"' + query.replace(/\\/, "\\\\").replace(/"/, '\\"') + '"';
        } else {
          query = null;
        }
        this.openGlobalSearch(query);
      },
      hotkeys: [env().Fb(["Mod", "Shift"], "F")],
    });
    plugin.registerViewType(s11SearchViewType, (leaf) => new (env().mJ)(leaf));
  };
  proto.onEnable = async function (app, plugin) {
    plugin.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
    plugin.registerEvent(app.workspace.on("editor-menu", this.onEditorMenu, this));
    plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
    this.options = (await plugin.loadData()) || {};
    const self = this;
    const searchFiles = async (query, folder, caseSensitive) => {
      const q = new (env().BH)(app, query, caseSensitive);
      if (!q.matcher) throw "Invalid search query.";
      let files = app.vault.getMarkdownFiles();
      if (folder) {
        const prefix = folder.endsWith("/") ? folder : folder + "/";
        files = files.filter((file) => file.path.startsWith(prefix));
      }
      const results = [];
      for (const file of files) {
        if (app.metadataCache.isUserIgnored(file.path)) continue;
        const content = await app.vault.cachedRead(file);
        const match = q.match(file, content);
        if (match) {
          const matches = [];
          if (match.content) {
            const lines = content.split("\n");
            for (const entry of match.content) {
              const pos = entry[0];
              const line = content.slice(0, pos).split("\n").length;
              const text = lines[line - 1] || "";
              matches.push({ line, text: text.trim() });
            }
          }
          results.push({ file: file.path, matches });
        }
      }
      return results;
    };
    plugin.registerCliHandler("search", "Search vault for text", {
      query: { value: "<text>", description: "Search query", required: true },
      path: { value: "<folder>", description: "Limit to folder" },
      limit: { value: "<n>", description: "Max files" },
      total: { description: "Return match count" },
      case: { description: "Case sensitive" },
      format: { value: "text|json", description: "Output format (default: text)" },
    }, async (args) => {
      if (!args.query) throw "Missing required parameter: query";
      const results = await searchFiles(args.query, args.path, !!args.case);
      const limit = args.limit ? parseInt(args.limit, 10) : 0;
      if (args.total) {
        return args.format === "json" ? JSON.stringify({ total: results.length }) : String(results.length);
      }
      if (results.length === 0) return "No matches found.";
      let paths = results.map((r) => r.file);
      if (limit > 0) paths = paths.slice(0, limit);
      return args.format === "json" ? JSON.stringify(paths) : paths.join("\n");
    });
    plugin.registerCliHandler("search:context", "Search with matching line context", {
      query: { value: "<text>", description: "Search query", required: true },
      path: { value: "<folder>", description: "Limit to folder" },
      limit: { value: "<n>", description: "Max files" },
      case: { description: "Case sensitive" },
      format: { value: "text|json", description: "Output format (default: text)" },
    }, async (args) => {
      if (!args.query) throw "Missing required parameter: query";
      let results = await searchFiles(args.query, args.path, !!args.case);
      const limit = args.limit ? parseInt(args.limit, 10) : 0;
      if (results.length === 0) return "No matches found.";
      if (limit > 0) results = results.slice(0, limit);
      if (args.format === "json") return JSON.stringify(results);
      const lines = [];
      for (const result of results) {
        if (result.matches.length === 0) {
          lines.push(result.file);
        } else {
          for (const match of result.matches) {
            lines.push(`${result.file}:${match.line}: ${match.text}`);
          }
        }
      }
      return lines.join("\n");
    });
    plugin.registerCliHandler("search:open", "Open search view", {
      query: { value: "<text>", description: "Initial search query" },
    }, (args) => {
      self.openGlobalSearch(args.query || "");
      return args.query ? "Opened search: " + args.query : "Opened search";
    });
  };
  proto.onExternalSettingsChange = async function () {
    this.options = (await this.plugin.loadData()) || {};
  };
  proto.onUserEnable = function () { this.initLeaf(); };
  proto.initLeaf = function () {
    this.app.workspace.ensureSideLeaf(s11SearchViewType, "left", { reveal: false });
  };
  proto.onFileMenu = function (menu, file, source) {
    if (source === "file-explorer-context-menu" && file instanceof env().ZT && !file.isRoot()) {
      menu.addItem((item) => item.setSection("action")
        .setTitle(s11SearchStrings().menuOptSearchInFolder())
        .setIcon("lucide-folder-search")
        .onClick(() => this.openGlobalSearch('path:"' + file.path + '/" ')));
    }
  };
  proto.onEditorMenu = function (menu, view) {
    const self = this;
    let selection = view.getSelection();
    if (!selection.trim()) return;
    menu.addItem((item) => item.setTitle(s11SearchStrings().menuOptSearchFor({ keyword: env().gc(selection, 25) }))
      .setIcon("lucide-search")
      .setSection("selection")
      .onClick(() => {
        if (selection.contains(" ")) selection = '"' + selection.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
        self.openGlobalSearch(selection);
      }));
  };
  proto.openGlobalSearch = function (query) {
    this.app.workspace.ensureSideLeaf(s11SearchViewType, "left", { active: true, reveal: true, state: { query } });
  };
  proto.getGlobalSearchQuery = function () {
    const leaves = this.app.workspace.getLeavesOfType(s11SearchViewType);
    if (leaves.length === 0) return "";
    const state = leaves[0].getViewState();
    return String.isString(state?.state?.query) ? state.state.query : "";
  };
  return SearchPlugin;
}
