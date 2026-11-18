// g11 clean-room: the core "global-search" plugin — command, view registration,
// editor/file context-menu entries and the search/search:context/search:open CLI handlers.

import { methods } from "./inherit.js";
import { env } from "./env.js";
import { ng11SearchClasses,ng11DefineSearchQuery } from "./n-g11-query.js";
import { ng11DefineSearchView,ng11SearchOperatorSuggestions } from "./n-g11-view.js";
import { ng11CompareSearchText } from "./n-g11-results.js";
import { lastSegment } from "./path.js";

let ng11PluginHost = null;
function PLH() { return ng11PluginHost || env(); }

/** The search i18n table, resolved lazily (manifest declarators evaluate before env/host bind). */
function ng11SearchT() {
  if (ng11PluginHost) return ng11PluginHost.t.plugins.search;
  const g = env().gm;
  return g && g.plugins ? g.plugins.search : null;
}

/** i18n table proxy that forwards to the real table whenever it becomes available. */
function ng11SearchI18nProxy() {
  return new Proxy(function () {}, {
    get(o, k) {
      if (k === Symbol.toPrimitive) return undefined;
      const t = ng11SearchT();
      const v = t ? t[k] : undefined;
      return typeof v === "function" ? v.bind(t) : v;
    },
    has(o, k) { const t = ng11SearchT(); return !!t && k in t; },
    ownKeys() { const t = ng11SearchT(); return t ? Reflect.ownKeys(t) : []; },
    getOwnPropertyDescriptor(o, k) {
      const t = ng11SearchT();
      return t ? Object.getOwnPropertyDescriptor(t, k) : undefined;
    },
  });
}

const NG11_SUGGEST_META = [
  ["path", "path:", "labelPathOptionDescription"],
  ["file", "file:", "labelFileNameOptionDescription"],
  ["tag", "tag:", "labelTagOptionDescription"],
  ["line", "line:()", "labelLineOptionDescription"],
  ["section", "section:()", "labelSectionOptionDescription"],
  ["property", "[]", "labelPropertyOptionDescription"],
];

// Contract aliases (manifest `use` / declarator names for s27-search.js).
export const s27SearchI18n = () => ng11SearchI18nProxy();
export const s27SearchOperatorSuggestions = () => NG11_SUGGEST_META.map(([name, token, label]) => ({
  type: "operator",
  name,
  token,
  infoTextI18n: () => { const t = ng11SearchT(); return t ? t[label]() : ""; },
}));
export const defineS27GlobalSearchPlugin = (host) => ng11DefineS27GlobalSearchPlugin(host);

function ng11EscapeQueryForQuotes(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Reads the current text selection: window selection first, MarkdownView fallback. */
function ng11CurrentSelection(app) {
  let sel = "";
  try { sel = window.getSelection ? window.getSelection().toString() : ""; } catch (e) { sel = ""; }
  const view = app.workspace.getActiveViewOfType(PLH().MarkdownView);
  if ((!sel || !sel.trim()) && view && view.getSelection) {
    try { sel = view.getSelection() || ""; } catch (e) { sel = ""; }
  }
  return sel;
}

/** Selection -> quoted query fragment, or null when empty. */
function ng11SelectionQuery(app) {
  const sel = ng11CurrentSelection(app);
  if (!sel || !sel.trim()) return null;
  if (/\s/.test(sel)) return '"' + ng11EscapeQueryForQuotes(sel) + '"';
  return sel;
}

function GlobalSearchPlugin() {
  this.id = "global-search";
  this.name = PLH().t.plugins.search.name();
  this.description = PLH().t.plugins.search.desc();
  this.defaultOn = true;
  this.options = {};
}
methods(GlobalSearchPlugin, {
  init(app, plugin) {
    const self = this;
    this.app = app;
    this.plugin = plugin;
    plugin.registerGlobalCommand({
      id: "global-search:open",
      name: PLH().t.plugins.search.actionOpenSearch(),
      icon: "lucide-search",
      hotkeys: [PLH().Fb(["Mod", "Shift"], "F")],
      callback() {
        self.openGlobalSearch(ng11SelectionQuery(app));
      },
    });
    plugin.registerViewType(PLH().s27SearchViewType, (leaf) => new (PLH().s27SearchView)(leaf));
  },
  async onEnable(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
    plugin.registerEvent(app.workspace.on("editor-menu", this.onEditorMenu, this));
    plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
    this.options = Object.assign({}, (await plugin.loadData()) || {});
    this._registerCli(plugin);
  },
  async onExternalSettingsChange() {
    this.options = Object.assign({}, (await this.plugin.loadData()) || {});
  },
  onUserEnable() { this.initLeaf(); },
  initLeaf() {
    this.app.workspace.ensureSideLeaf(PLH().s27SearchViewType, "left", { reveal: false });
  },

  // ---- menus --------------------------------------------------------------------------------------
  onFileMenu(menu, file, source) {
    const host = PLH();
    const t = host.t.plugins.search;
    if (source !== "file-explorer-context-menu") return;
    if (!(file instanceof host.TFolder)) return;
    if (file.isRoot && file.isRoot()) return;
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(t.menuOptSearchInFolder())
      .setIcon("lucide-folder-search")
      .onClick(() => {
        this.openGlobalSearch('path:"' + file.path + '/" ');
      }));
  },
  onEditorMenu(menu, editor, view) {
    const host = PLH();
    const t = host.t.plugins.search;
    const selection = view && view.getSelection ? view.getSelection() : "";
    if (!selection || !selection.trim()) return;
    const keyword = host.truncateText ? host.truncateText(selection, 25) : selection.slice(0, 25);
    menu.addItem((item) => item
      .setSection("selection")
      .setTitle(t.menuOptSearchFor({ keyword }))
      .setIcon("lucide-search")
      .onClick(() => {
        this.openGlobalSearch('"' + ng11EscapeQueryForQuotes(selection) + '"');
      }));
  },

  // ---- open / query --------------------------------------------------------------------------------
  openGlobalSearch(query) {
    const host = PLH();
    const state = { query: query == null ? "" : query };
    this.app.workspace.ensureSideLeaf(host.s27SearchViewType, "left", { active: true, reveal: true, state });
  },
  getGlobalSearchQuery() {
    const host = PLH();
    const leaves = this.app.workspace.getLeavesOfType(host.s27SearchViewType);
    for (const leaf of leaves) {
      const state = leaf.getViewState && leaf.getViewState();
      const q = state && state.state && state.state.query;
      if (typeof q === "string") return q;
    }
    return "";
  },

  // ---- CLI handlers ---------------------------------------------------------------------------------
  _registerCli(plugin) {
    const app = this.app;
    const host = PLH();
    const C = ng11SearchClasses;
    const searchQuery = (args) => {
      const q = args.query;
      if (q == null || String(q).trim() === "") throw "Missing required parameter: query";
      const sq = new C.SearchQuery(app, String(q), !!args.case);
      if (!sq.matcher) throw "Invalid search query.";
      return sq;
    };
    const collect = async (args, sq, withContext) => {
      const app = this.app;
      let files = app.vault.getMarkdownFiles();
      if (args.path) {
        const prefix = String(args.path).replace(/\/+$/, "") + "/";
        files = files.filter((f) => f.path.startsWith(prefix) || f.path === String(args.path));
      }
      const limit = args.limit != null ? parseInt(args.limit, 10) : Infinity;
      const out = [];
      let total = 0;
      for (const file of files) {
        if (app.metadataCache.isUserIgnored(file.path)) continue;
        let content = "";
        try { content = await app.vault.cachedRead(file); } catch (e) { content = ""; }
        const result = sq.match(file, content);
        if (!result) continue;
        const contentRanges = (result.content || []).slice().sort((a, b) => a[0] - b[0]);
        if (contentRanges.length) {
          total += contentRanges.length;
          if (out.length < limit) {
            for (const r of contentRanges) {
              if (out.length >= limit) break;
              const line = content.slice(0, r[0]).split("\n").length;
              const lines = content.split("\n");
              const text = lines[line - 1] || "";
              const lineStart = lines.slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
              const lineMatches = contentRanges
                .filter((m) => m[0] < lineStart + text.length + 1 && m[1] > lineStart)
                .map((m) => [Math.max(0, m[0] - lineStart), Math.min(text.length + 1, m[1] - lineStart)]);
              out.push(withContext ? { file: file.path, line, text: text.trim(), matches: lineMatches } : file.path);
            }
          }
        } else {
          const n = Object.keys(result).reduce((acc, k) => acc + (Array.isArray(result[k]) ? result[k].length : 0), 0) + (result.properties ? result.properties.length : 0);
          if (n > 0) {
            total += n;
            if (out.length < limit) out.push(withContext ? { file: file.path } : file.path);
          }
        }
      }
      return { out, total };
    };
    const fmt = (args, payload) => (args.format === "json" ? JSON.stringify(payload) : payload);

    plugin.registerCliHandler(
      "search",
      "Search the vault",
      {
        query: { value: "<query>", description: "Search query" },
        path: { value: "<path>", description: "Limit to folder" },
        limit: { value: "<n>", description: "Max results" },
        total: { description: "Return match count only" },
        case: { description: "Case sensitive" },
        format: { value: "text|json", description: "Output format" },
      },
      async (args) => {
        const sq = searchQuery(args);
        const { out, total } = await collect(args, sq, false);
        if (args.total) return args.format === "json" ? JSON.stringify({ total }) : String(total);
        if (!out.length) return "No matches found.";
        return fmt(args, args.format === "json" ? [...new Set(out)] : [...new Set(out)].join("\n"));
      }
    );

    plugin.registerCliHandler(
      "search:context",
      "Search the vault with context lines",
      {
        query: { value: "<query>", description: "Search query" },
        path: { value: "<path>", description: "Limit to folder" },
        limit: { value: "<n>", description: "Max results" },
        total: { description: "Return match count only" },
        case: { description: "Case sensitive" },
        format: { value: "text|json", description: "Output format" },
      },
      async (args) => {
        const sq = searchQuery(args);
        const { out, total } = await collect(args, sq, true);
        if (args.total) return args.format === "json" ? JSON.stringify({ total }) : String(total);
        if (!out.length) return "No matches found.";
        if (args.format === "json") return JSON.stringify(out);
        return out.map((o) => (o.line ? `${o.file}:${o.line}: ${o.text}` : o.file)).join("\n");
      }
    );

    plugin.registerCliHandler(
      "search:open",
      "Open the search pane",
      { query: { value: "<query>", description: "Initial query" } },
      (args) => {
        const q = args.query == null ? "" : String(args.query);
        this.openGlobalSearch(q);
        return q ? `Opened search: ${q}` : "Opened search";
      }
    );
  },
});

export function ng11DefineS27GlobalSearchPlugin(host) {
  ng11PluginHost = host;
  ng11DefineSearchQuery(host);
  ng11DefineSearchView(host);
  return GlobalSearchPlugin;
}
