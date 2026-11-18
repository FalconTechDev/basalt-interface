// Small core-plugin shells (s14).
//
//   q8  FootnotesPlugin      — registers the footnotes side-leaf view + open command
//   U8  MarkdownImporterPlugin — ribbon item + global command opening the importer
//   N8  ImporterPathSuggest   — path suggestion dropdown used by the importer modal
//
// The plugin objects are plain constructors in the original; own factories return
// ES classes with the same public surface (id/name/description/init/onUserEnable).
import { env } from "./env.js";

// q8 — footnotes core plugin.
export function s14FootnotesPlugin() {
  const e = env();
  const pane = () => e.gm.plugins.footnotesPane;
  return class FootnotesPlugin {
    constructor() {
      this.id = "footnotes";
      this.name = pane().name();
      this.description = pane().desc();
      this.defaultOn = false;
    }

    init(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      plugin.registerViewType(e.V8, (leaf) => new e.z8(leaf));
      plugin.registerGlobalCommand({
        id: "footnotes:open",
        name: pane().actionShow(),
        icon: "lucide-file-signature",
        callback: () => {
          this.app.workspace.ensureSideLeaf(e.V8, "right", { active: true });
        },
      });
    }

    onUserEnable() {
      this.initLeaf();
    }

    initLeaf() {
      this.app.workspace.ensureSideLeaf(e.V8, "right", { reveal: false });
    }
  };
}

// U8 — markdown importer core plugin.
export function s14MarkdownImporterPlugin() {
  const e = env();
  const importer = () => e.gm.plugins.markdownFormatImporter;
  return class MarkdownImporterPlugin {
    constructor() {
      this.id = "markdown-importer";
      this.name = importer().name();
      this.description = importer().desc();
    }

    init(app, plugin) {
      this.app = app;
      plugin.registerRibbonItem(importer().actionOpen(), "lucide-binary", this.onOpen.bind(this));
      plugin.registerGlobalCommand({
        id: "markdown-importer:open",
        name: importer().actionOpen(),
        icon: "lucide-download",
        callback: this.onOpen.bind(this),
      });
    }

    onOpen() {
      new e.X8(this.app).open();
      return false;
    }
  };
}

// N8 — path suggester for the importer (was `N8=function(e){...}(SI)`).
export function s14ImporterPathSuggest() {
  const e = env();
  return class ImporterPathSuggest extends e.SI {
    constructor(app, inputEl, paths, modal) {
      super(app, inputEl);
      this.paths = [];
      this.modal = null;
      this.paths = paths;
      this.modal = modal;
    }

    renderSuggestion(path, el) {
      el.setText(e.pu(path));
    }

    getSuggestions(query) {
      query = query.toLowerCase();
      const out = [];
      for (const path of this.paths) {
        if (path.toLowerCase().contains(query)) out.push(path);
      }
      return out.slice(0, 100);
    }

    selectSuggestion(path) {
      const input = this.textInputEl;
      this.modal.switchToPath(path);
      input.trigger("input");
      this.close();
    }
  };
}

// b8 — editor-status core plugin: status-bar item showing read/source/live-preview mode.
export function s14EditorStatusPlugin() {
  const e = env();
  const editorStatus = () => e.gm.plugins.editorStatus;
  return class EditorStatusPlugin {
    constructor() {
      this.id = "editor-status";
      this.name = editorStatus().name();
      this.description = editorStatus().desc();
      this.defaultOn = true;
      this.hiddenFromList = true;
    }

    init(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      plugin.registerStatusBarItem();
    }

    onEnable(app, plugin) {
      plugin.registerEvent(app.workspace.on("layout-change", this.updateStatus, this));
      plugin.registerEvent(app.workspace.on("active-leaf-change", this.updateStatus, this));
      plugin.statusBarEl.addEventListener("click", this.onClick.bind(this));
      plugin.statusBarEl.addEventListener("contextmenu", this.onClick.bind(this));
      plugin.statusBarEl.addClass("mod-clickable");
      this.updateStatus();
    }

    onDisable() {}

    getStatus() {
      const view = this.getActiveView();
      if (!view) return "";
      if (view.getMode() === "preview") return "read";
      if (view.editMode) return view.editMode.sourceMode ? "source" : "live-preview";
      return "source";
    }

    getActiveView() {
      const view = this.app.workspace.getActiveFileView();
      return view && view instanceof e.W6 ? view : null;
    }

    async setStatus(mode) {
      const view = this.getActiveView();
      if (!view) return;
      const state = view.getState();
      switch (mode) {
        case "read":
          state.mode = "preview";
          break;
        case "source":
          state.mode = "source";
          state.source = true;
          break;
        case "live-preview":
          state.mode = "source";
          state.source = false;
          break;
      }
      await view.leaf.setViewState({ type: e.U6, state });
    }

    updateStatus() {
      const bar = this.plugin.statusBarEl;
      bar.empty();
      bar.show();
      const icon = bar.createSpan("status-bar-item-icon");
      switch (this.getStatus()) {
        case "":
          bar.hide();
          return;
        case "read":
          e.tv(icon, "lucide-book-open");
          e.Mv(bar, editorStatus().read(), { placement: "top" });
          break;
        case "source":
          e.tv(icon, "lucide-code-2");
          e.Mv(bar, editorStatus().editSource(), { placement: "top" });
          break;
        case "live-preview":
          e.tv(icon, "lucide-edit-3");
          e.Mv(bar, editorStatus().editLivePreview(), { placement: "top" });
          break;
      }
    }

    onClick(ev) {
      const view = this.getActiveView();
      if (!view) return;
      const menu = new e.Ug();
      const current = this.getStatus();
      const add = (mode, icon, title) => {
        menu.addItem((item) => item.setTitle(title).setIcon(icon).setChecked(current === mode).onClick(() => this.setStatus(mode)));
      };
      add("read", "lucide-book-open", editorStatus().read());
      add("source", "lucide-code-2", editorStatus().editSource());
      if (view.editMode) add("live-preview", "lucide-edit-3", editorStatus().editLivePreview());
      menu.showAtMouseEvent(ev);
    }
  };
}

// r7 — outgoing-link core plugin: side-leaf view + commands + CLI handler.
export function s14OutgoingLinkPlugin() {
  const e = env();
  const links = () => e.gm.plugins.outgoingLinks;
  return class OutgoingLinkPlugin {
    constructor() {
      this.id = "outgoing-link";
      this.name = links().name();
      this.description = links().desc();
      this.defaultOn = true;
    }

    init(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      plugin.registerViewType(e.n7, (leaf) => new e.o7(leaf));
      plugin.registerGlobalCommand({
        id: "outgoing-links:open",
        name: links().actionShow(),
        icon: "lucide-link",
        callback: () => {
          this.app.workspace.ensureSideLeaf(e.n7, "right", { active: true });
        },
      });
      plugin.registerGlobalCommand({
        id: "outgoing-links:open-for-current",
        name: links().actionOpenForCurrent(),
        icon: "lucide-link",
        checkCallback: this.openForCurrentFile.bind(this),
      });
    }

    onEnable(app, plugin) {
      plugin.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
      plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
      plugin.registerCliHandler(
        "links",
        "List outgoing links from a file",
        {
          file: { value: "<name>", description: "File name" },
          path: { value: "<path>", description: "File path" },
          total: { description: "Return link count" },
        },
        async (args) => {
          const file = app.cli.tryResolveFile(args);
          const cache = app.metadataCache.getFileCache(file);
          if (!cache) return "No links found.";
          const found = new Set();
          const sourcePath = file.path;
          e.xT(cache, (link) => {
            const linkPath = e.MT(link).path;
            const dest = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
            if (dest) found.add(dest.path);
            else found.add(linkPath + " (unresolved)");
          });
          if (args.total) return String(found.size);
          if (found.size === 0) return "No links found.";
          return Array.from(found).sort().join("\n");
        }
      );
    }

    onUserEnable() {
      this.initLeaf();
    }

    onUserDisable(app) {
      app.workspace.detachLeavesOfType(e.n7);
    }

    initLeaf() {
      this.app.workspace.ensureSideLeaf(e.n7, "right", { reveal: false });
    }

    onFileMenu(menu, file, source, leaf) {
      if (e.Yl.isMobile || !(file instanceof e.$T) || !leaf || file.extension !== "md" || source === "sidebar-context-menu") return;
      menu.addItem((item) =>
        item
          .setSection("view.linked")
          .setTitle(links().actionOpen())
          .setIcon("links-going-out")
          .onClick(async () => {
            await this.app.workspace.splitLeafOrActive(leaf, "horizontal").setViewState({
              type: e.n7,
              active: true,
              group: leaf,
              state: { file: file.path },
            });
          })
      );
    }

    openForCurrentFile(checking) {
      if (e.Yl.isPhone) return false;
      const workspace = this.app.workspace;
      const file = workspace.getActiveFile();
      if (file) {
        if (!checking) {
          workspace.splitActiveLeaf("vertical").setViewState({ type: e.n7, active: true, group: workspace.activeLeaf, state: { file: file.path } });
        }
        return true;
      }
      return undefined;
    }
  };
}
