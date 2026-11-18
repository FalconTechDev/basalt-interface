// ng06 BasesPlugin (`Z4`): the "bases" core plugin — view-type registry,
// commands, ribbon, file/editor menus, embed extension, hover source,
// operator func configs, YAML mode, CLI handlers and the `base` code-block
// post-processor.
import { env } from "./env.js";
import { normalizePath, parentPath, baseName } from "./path.js";
import { debounceCall } from "./timing.js";
import { ng06T, ng06FileExplorerStrings, ng06BasesViewType } from "./n-g06-shared.js";
import { s09FiltersToFrontmatter } from "./s09-query.js";

const ng06PluginStrings = () => env().gm.plugins.bases;

const ng06OperatorConfigs = [
  ["hasProperty", "has property", "does not have property"],
  ["isEmpty", "is empty", "is not is empty".replace("is not is", "is not")],
  ["startsWith", "starts with", "does not start with"],
  ["endsWith", "ends with", "does not end with"],
  ["contains", "contains", "does not contain"],
  ["containsAny", "contains any of", "does not contain any of"],
  ["containsAll", "contains all of", "does not contain all of"],
  ["matches", "matches", "does not match"],
  ["hasLink", "links to", "does not link to"],
  ["inFolder", "in folder", "is not in folder"],
  ["hasTag", "has tag", "does not have tag"],
].map(([funcName, display, inverseDisplay]) => ({ funcName, display, inverseDisplay }));

/** `Z4` — internal plugin class `BasesPlugin`. */
export function ng06BasesPlugin(host) {
  function BasesPlugin() {
    this.id = "bases";
    this.name = ng06PluginStrings().name();
    this.description = ng06PluginStrings().desc();
    this.defaultOn = true;
    this.views = {};
    this._postProcessor = null;
    return this;
  }

  // -- view-type registry ---------------------------------------------------

  BasesPlugin.prototype.registerView = function (viewId, registration) {
    if (this.views[viewId]) {
      new host.Notice(ng06PluginStrings().msgErrorRegisterView({ viewId }));
      return;
    }
    this.views[viewId] = registration;
  };
  BasesPlugin.prototype.deregisterView = function (viewId) { delete this.views[viewId]; };
  BasesPlugin.prototype.getRegistration = function (viewId) { return this.views[viewId] || null; };
  BasesPlugin.prototype.getRegistrations = function () { return this.views; };
  BasesPlugin.prototype.getViewFactory = function (viewId) {
    const reg = this.views[viewId];
    return reg ? reg.factory : null;
  };

  // -- file creation ---------------------------------------------------------

  /** Creates a `.base` file (empty query) under `parent` and opens it; Mod-click → new tab + rename. */
  BasesPlugin.prototype.createNewBasesFile = async function (parent, name, content, evt) {
    const app = this._app;
    const folder = parent || app.fileManager.getNewFileParent(app.workspace.getActiveFile() ? app.workspace.getActiveFile().path : "", "base");
    const baseName = name || ng06FileExplorerStrings().labelUntitledFile ? "Untitled" : "Untitled";
    let path = normalizePath((folder ? folder.path || folder : "") + "/" + (name || "Untitled") + ".base");
    path = await app.vault.getAvailablePath(path.replace(/\.base$/, ""), "base");
    const file = await app.vault.create(path, content == null ? "" : content);
    const leaf = app.workspace.getLeaf(evt && env().Bg.isModEvent(evt) ? "tab" : false);
    await leaf.openFile(file);
    leaf.setEphemeralState && leaf.setEphemeralState({ rename: "all" });
    return file;
  };

  BasesPlugin.prototype.createAndOpenBase = function (evt) {
    return this.createNewBasesFile(null, null, null, evt);
  };

  /** Creates a base and embeds `![[path]]` at the editor cursor/selection. */
  BasesPlugin.prototype.createAndEmbedBase = async function (editor) {
    const app = this._app;
    const file = editor.file;
    const folder = file && file.parent ? file.parent : app.fileManager.getNewFileParent("", "base");
    const created = await this.createNewBasesFile(folder, null, null, null);
    if (!created) return;
    const link = "![[" + created.path + "]]\n";
    const view = editor.cm && editor.cm.cm ? editor.cm.cm : editor;
    if (view && view.state && view.dispatch) {
      const changes = [];
      for (const range of view.state.selection.ranges) {
        const from = view.state.doc.lineAt(range.from);
        const prefix = range.from === from.from ? "" : "\n";
        changes.push({ from: range.from, to: range.to, insert: prefix + link });
      }
      view.dispatch({ changes });
    }
  };

  // -- menus -----------------------------------------------------------------

  BasesPlugin.prototype.onFileMenu = function (menu, file, source, evt) {
    if (source !== "file-explorer-context-menu") return;
    if (!(file instanceof host.s13FolderClass)) return;
    const app = this._app;
    menu.addItem((item) => item
      .setSection("action-primary")
      .setTitle(ng06PluginStrings().actionNewBase())
      .setIcon("lucide-layout-list")
      .onClick(async () => {
        await this.createNewBasesFile(file, null, null, evt);
      }));
  };

  BasesPlugin.prototype.onEditorMenu = function (menu, editor) {
    const app = this._app;
    menu.addItem((item) => item
      .setSection("selection.insert.advanced")
      .setTitle(ng06PluginStrings().actionNewBase())
      .setIcon("lucide-layout-list")
      .onClick(() => this.createAndEmbedBase(editor)));
  };

  // -- lifecycle --------------------------------------------------------------

  BasesPlugin.prototype.init = function (app, plugin) {
    this._app = app;
    this._plugin = plugin;
    const t = ng06PluginStrings();
    // ribbon
    plugin.registerRibbonItem(t.commandCreateNew(), "lucide-layout-list", (evt) => this.createAndOpenBase(evt));
    // file view for .base (registered on enable via wrapper.views)
    plugin.registerViewType(ng06BasesViewType, (leaf) => new (env().HX)(leaf, this));
    // commands
    plugin.registerGlobalCommand({
      id: "bases:new-file",
      name: t.commandCreateNew(),
      icon: "lucide-layout-list",
      callback: (evt) => this.createAndOpenBase(evt),
    });
    plugin.registerGlobalCommand({
      id: "bases:insert",
      name: t.commandInsertNew(),
      icon: "lucide-layout-list",
      editorCheckCallback: (checking, editor, ctx) => {
        if (!checking && editor && editor.cm && !editor.inTableCell) this.createAndEmbedBase(editor);
        return !checking && !!(editor && editor.cm) && !editor.inTableCell;
      },
      callback: () => {},
    });
    plugin.registerGlobalCommand({
      id: "bases:copy-table",
      name: t.commandCopyTable(),
      icon: "lucide-copy",
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(host.s13BaseFileView);
        const ok = !!(view && view.controller && view.controller.view && view.controller.view.type === "table");
        if (!checking && ok) view.controller.view.copyToClipboard();
        return ok;
      },
    });
    plugin.registerGlobalCommand({
      id: "bases:change-view",
      name: t.commandChangeView(),
      icon: "lucide-shapes",
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(host.s13BaseFileView);
        const ok = !!(view && view.controller && view.controller.getQueryViewNames().length > 1);
        if (!checking && ok) {
          const names = view.controller.getQueryViewNames();
          new (host.s13ViewSwitcher)(app, view.controller, names).open ? null : null;
        }
        return ok;
      },
    });
    plugin.registerGlobalCommand({
      id: "bases:add-view",
      name: t.commandAddView(),
      icon: "lucide-shapes",
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(host.s13BaseFileView);
        const ok = !!(view && view.controller);
        if (!checking && ok) view.controller.promptForAddView();
        return ok;
      },
    });
    plugin.registerGlobalCommand({
      id: "bases:add-item",
      name: t.commandAddItem(),
      icon: "lucide-shapes",
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(host.s13BaseFileView);
        const ok = !!(view && view.controller && view.controller.newItemMenu);
        if (!checking && ok) view.controller.newItemMenu.open();
        return ok;
      },
    });
  };

  BasesPlugin.prototype._registerEmbedPostProcessor = function () {
    const app = this._app;
    const handler = (codeText, blockEl, ctx) => {
      const text = (codeText || "").replace(/^(\t+)/gm, (m) => "    ".repeat(m.length));
      blockEl.addClass("bases-embed", "interactive-child");
      let query;
      try { query = env().EY.fromString(text); } catch (e) { query = e; }
      const sourcePath = ctx && ctx.sourcePath ? ctx.sourcePath : "";
      const file = sourcePath ? app.vault.getFileByPath(sourcePath) : (app.workspace.getActiveFile() || null);
      const controller = new (env().C$)(app, this, blockEl, file);
      if (query instanceof Error) {
        controller.setQuery(query);
        return;
      }
      query.file = file;
      query.saveFn = (q) => {
        try { controller.setQuery(q); } catch (e) {}
        const str = q.toString();
        debounceCall(() => ctx && ctx.replaceCode && ctx.replaceCode(str), 100)();
      };
      controller.setQuery(query);
    };
    const processor = env().Gz.createCodeBlockPostProcessor("base", handler);
    env().Gz.registerPostProcessor(processor, -1);
    env().Gz.registerCodeBlockPostProcessor("base", handler);
    this._postProcessor = processor;
  };

  BasesPlugin.prototype.onEnable = function (app, plugin) {
    this._app = app;
    this._plugin = plugin;
    const t = ng06PluginStrings();
    // YAML highlighting for .base files
    try {
      if (host.codeMirrorCompat && host.codeMirrorCompat.modes) {
        host.codeMirrorCompat.modes.base = host.codeMirrorCompat.modes.yaml;
      }
    } catch (e) {}
    // view registrations (registry-driven)
    this.registerView("table", {
      name: t.labelViewTypeTable(),
      icon: "lucide-table",
      factory: (controller, containerEl) => new (host.s13BasesTableView)(controller, containerEl),
      options: () => host.s13BasesTableView.getViewOptions(),
    });
    this.registerView("cards", {
      name: env().gm.plugins.bases.cards.name(),
      icon: "lucide-layout-grid",
      factory: (controller, containerEl) => new (host.s13CardsView)(controller, containerEl),
      options: (view) => host.s13CardsView.getViewOptions(view),
    });
    this.registerView("list", {
      name: env().gm.plugins.bases.list.name(),
      icon: "lucide-list",
      factory: (controller, containerEl) => new (host.s13ListView)(controller, containerEl),
      options: (view) => host.s13ListView.getViewOptions(view && view.config),
    });
    // markdown ```base blocks
    this._registerEmbedPostProcessor();
    app.viewRegistry.registerExtensions(["base"], ng06BasesViewType);
    plugin.register(() => app.viewRegistry.unregisterExtensions(["base"]));
    // embed extension for ![[x.base]]
    app.embedRegistry.registerExtension("base", (m, el, ctx) => {
      const anchor = m && m.subpath ? m.subpath : "";
      const viewName = anchor.startsWith("#") ? anchor.slice(1) : anchor || undefined;
      return new (env().E$)(app, this, m, ctx.file, viewName);
    });
    plugin.register(() => app.embedRegistry.unregisterExtension("base"));
    // hover link source
    app.workspace.registerHoverLinkSource("bases", { display: this.name, defaultMod: true });
    plugin.register(() => app.workspace.unregisterHoverLinkSource("bases"));
    // file parent creator for .base
    app.fileManager.registerFileParentCreator("base", (sourcePath) => app.fileManager.getNewFileParent(sourcePath, "base"));
    // menus
    plugin.registerEvent(app.workspace.on("file-menu", (menu, file, source, evt) => this.onFileMenu(menu, file, source, evt)));
    plugin.registerEvent(app.workspace.on("editor-menu", (menu, editor) => this.onEditorMenu(menu, editor)));
    // operator func configs for the filter builder
    app.workspace.registerOperatorFuncConfigs("bases", ng06OperatorConfigs);
    plugin.register(() => app.workspace.unregisterOperatorFuncConfigs("bases"));
    // CLI handlers
    this._registerCli(plugin);
  };

  BasesPlugin.prototype.onDisable = function (app, plugin) {
    if (this._postProcessor) {
      try {
        env().Gz.unregisterPostProcessor(this._postProcessor);
        env().Gz.unregisterCodeBlockPostProcessor("base");
      } catch (e) {}
      this._postProcessor = null;
    }
    for (const id of Object.keys(this.views)) delete this.views[id];
  };

  // -- CLI -------------------------------------------------------------------

  BasesPlugin.prototype._resolveBaseFile = async function (args) {
    const app = this._app;
    let file = null;
    if (args.path) file = app.vault.getFileByPath(args.path);
    else if (args.file) file = app.metadataCache.getFirstLinkpathDest(args.file, "") || app.vault.getFileByPath(args.file);
    else {
      const active = app.workspace.getActiveFile();
      if (active && active.extension === "base") file = active;
      else throw "No active file or base file specified";
    }
    if (!file) throw "Base file not found";
    if (file.extension !== "base") throw "Not a base file: " + file.path;
    return file;
  };

  BasesPlugin.prototype._loadModel = async function (args) {
    const file = await this._resolveBaseFile(args);
    const text = await this._app.vault.read(file);
    let model;
    try { model = env().EY.fromString(text); }
    catch (e) { throw "Failed to parse base file: " + (e && e.message ? e.message : e); }
    model.file = file;
    return { file, model };
  };

  BasesPlugin.prototype._registerCli = function (plugin) {
    const app = this._app;
    const self = this;
    plugin.registerCliHandler("bases", "List all base files in vault", {}, async () => {
      const files = app.vault.getFiles().filter((f) => f.extension === "base").sort((a, b) => host.s13ComparePaths(a.path, b.path));
      return files.length ? files.map((f) => f.path).join("\n") : "No base files found in vault";
    });
    plugin.registerCliHandler("base:query", "Query a base and return results", {
      args: [
        { name: "file", description: "Base file name" },
        { name: "path", description: "Base file path" },
        { name: "view", description: "View name" },
        { name: "format", description: "json|csv|tsv|md|paths", default: "json" },
      ],
    }, async (args) => {
      const { model } = await self._loadModel(args || {});
      const activeView = app.workspace.getActiveViewOfType(host.s13BaseFileView);
      const viewName = (args && args.view) || (activeView && activeView.controller ? activeView.controller.viewName : null);
      const viewConfig = model.getViewConfig(viewName) || model.views[0];
      if (!viewConfig) return "No views defined in base file";
      if (args && args.view && !model.getViewConfig(args.view)) {
        const names = model.views.map((v) => v.name).join(", ");
        throw "View not found: " + args.view + "\nAvailable views: " + names;
      }
      const filters = host.s13FilterOps.and(model.filters, viewConfig.filters);
      const ctx = new (host.s13QuerySession)(app, filters, model.formulas || {}, model.file);
      const items = [];
      for (const file of app.vault.getMarkdownFiles()) {
        if (app.metadataCache.isUserIgnored(file.path)) continue;
        try {
          const item = new (host.s13QueryItem)(ctx, file);
          if (!ctx.filter || ctx.filter.test(ctx)) items.push(item);
        } catch (e) {}
      }
      items.sort((a, b) => host.s13ComparePaths(a.file.path, b.file.path));
      const order = viewConfig.getOrder();
      const headers = order.map((k) => viewConfig.getDisplayName(k));
      const rows = items.map((item) => order.map((k) => {
        try {
          const v = item.getValue(k);
          return v == null || v === env().bW.value ? "" : v.toString();
        } catch (e) { return ""; }
      }));
      const format = (args && args.format) || "json";
      if (format === "paths") return items.map((i) => i.file.path).join("\n");
      if (format === "csv" || format === "tsv" || format === "md") {
        const table = new (host.s13TableExport)(headers, rows);
        return format === "csv" ? table.toCSV() : format === "tsv" ? table.toTSV() : table.toMarkdown();
      }
      return JSON.stringify(items.map((item, i) => {
        const row = { path: item.file.path };
        order.forEach((k, j) => { row[headers[j]] = rows[i][j] || null; });
        return row;
      }), null, 2);
    });
    plugin.registerCliHandler("base:views", "List views in the current base file", {}, async () => {
      const { model } = await self._loadModel({});
      if (!model.views || model.views.length === 0) return "No views defined.";
      return model.views.map((v) => v.name + "\t" + v.type).join("\n");
    });
    plugin.registerCliHandler("base:create", "Create a new item in a base", {
      args: [
        { name: "file" }, { name: "path" }, { name: "view" },
        { name: "name", default: "Untitled" }, { name: "content" },
        { name: "open", default: "false" }, { name: "newtab", default: "false" },
      ],
    }, async (args) => {
      const { file: baseFile, model } = await self._loadModel(args || {});
      const viewName = (args && args.view) || undefined;
      const viewConfig = model.getViewConfig(viewName) || model.views[0];
      const name = (args && args.name) || "Untitled";
      let folder = model.newItemFolder || "";
      if (!folder) {
        const res = s09FiltersToFrontmatter(app, model, viewConfig, null);
        folder = res.folder || "";
      }
      if (!folder) folder = baseFile.parent ? baseFile.parent.path : "";
      folder = folder.replace(/\/$/, "");
      const path = await app.vault.getAvailablePath(normalizePath(folder + "/" + name), "md");
      const content = (args && args.content) || "";
      const created = await app.vault.create(path, content);
      try {
        const res = s09FiltersToFrontmatter(app, model, viewConfig, null);
        const fm = res.frontmatter || {};
        if (Object.keys(fm).length) {
          await app.fileManager.processFrontMatter(created, (frontmatter) => {
            for (const k of Object.keys(fm)) frontmatter[k] = fm[k];
            return frontmatter;
          });
        }
      } catch (e) {}
      if (args && (args.open === "true" || args.open === true)) {
        const leaf = app.workspace.getLeaf(args.newtab === "true" || args.newtab === true ? "tab" : false);
        await leaf.openFile(created);
      }
      return "Created: " + path;
    });
  };

  return BasesPlugin;
}
