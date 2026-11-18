// The "Properties" core plugin: status-bar property count, the "all properties" and "file properties"
// side panes (the views themselves are inherited classes registered by view type), file-menu entry
// and hover-link source.
//
// Replaces the inherited pieces:
//   k7  PropertiesPlugin -> definePropertiesPlugin
//   v7  gm.plugins.properties -> declarator __basaltHost.t.plugins.properties
//   g7  "all-properties"  -> declarator "all-properties"
//   y7  "file-properties" -> declarator "file-properties"
//   b7  sort-order pairs  -> declarator __basaltOwn.s34PropertySortOrders
//   w7  sort-order labels -> declarator __basaltOwn.s34PropertySortLabels(v7)

/** View type of the vault-wide properties pane (was `g7`). */
export const s34ViewTypeAllProperties = "all-properties";
/** View type of the per-file properties pane (was `y7`). */
export const s34ViewTypeFileProperties = "file-properties";

const VIEW_ALL = s34ViewTypeAllProperties;
const VIEW_FILE = s34ViewTypeFileProperties;
const propertiesT = (host) => host.t.plugins.properties;

/** Sort-order pairs offered by the properties views' sort button (was `b7`). */
export const s34PropertySortOrders = [
  ["alphabetical", "alphabeticalReverse"],
  ["frequency", "frequencyReverse"],
];

/** Display label per sort order, keyed off the properties translation table (was `w7`). */
export function s34PropertySortLabels(t) {
  return {
    alphabetical: t.labelSortByNameAToZ(),
    alphabeticalReverse: t.labelSortByNameZToA(),
    frequency: t.labelSortByFrequencyHighToLow(),
    frequencyReverse: t.labelSortByFrequencyLowToHigh(),
  };
}

/** Plugin shell: view types, commands, status bar item, events and menu entries. */
export function definePropertiesPlugin(host) {
  class PropertiesPlugin {
    constructor() {
      this.id = "properties";
      this.name = propertiesT(host).name();
      this.description = propertiesT(host).desc();
      this.defaultOn = true;
    }

    init(app, plugin) {
      const self = this;
      this.app = app;
      this.plugin = plugin;
      plugin.registerStatusBarItem();
      plugin.registerGlobalCommand({
        id: "properties:open",
        name: propertiesT(host).actionShow(),
        icon: "lucide-archive",
        callback: () => {
          const side = host.Platform.isMobile ? "left" : "right";
          self.app.workspace.ensureSideLeaf(VIEW_ALL, side, { active: true });
        },
      });
      plugin.registerGlobalCommand({
        id: "properties:open-local",
        name: propertiesT(host).actionShowLocal(),
        icon: "lucide-info",
        callback: () => {
          const file = self.app.workspace.getActiveFile();
          self.ensurePropertiesView(file);
        },
      });
      plugin.registerViewType(VIEW_ALL, (leaf) => new host.AllPropertiesView(leaf));
      plugin.registerViewType(VIEW_FILE, (leaf) => new host.FilePropertiesView(leaf, self));
    }

    initLeaf() {
      const side = host.Platform.isMobile ? "left" : "right";
      this.app.workspace.ensureSideLeaf(VIEW_ALL, side, { reveal: false });
    }

    onUserEnable() {
      this.initLeaf();
    }

    updateStatusbar(count) {
      const item = this.plugin.statusBarEl;
      if (item) {
        item.setText(host.t.nouns.propertiesWithCount({ count }));
        item.toggle(count > 0);
      }
    }

    onFileOpen(file) {
      let count = 0;
      if (file) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache) count = Object.keys(cache.frontmatter ?? {}).length;
      }
      this.updateStatusbar(count);
    }

    onCacheChanged(file, _oldCache, newCache) {
      if (file === this.app.workspace.getActiveFile()) {
        const count = Object.keys(newCache?.frontmatter ?? {}).length;
        this.updateStatusbar(count);
      }
    }

    onEnable(app, plugin) {
      const self = this;
      plugin.registerEvent(app.workspace.on("file-open", this.onFileOpen, this));
      plugin.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
      plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
      plugin.registerEvent(app.metadataCache.on("changed", this.onCacheChanged, this));
      const statusBar = this.plugin.statusBarEl;
      if (statusBar) {
        statusBar.addClass("mod-clickable");
        statusBar.addEventListener("click", () => {
          const file = self.app.workspace.getActiveFile();
          self.ensurePropertiesView(file);
        });
      }
      app.workspace.registerHoverLinkSource("properties", { display: this.name, defaultMod: true });
    }

    onDisable(app) {
      app.workspace.unregisterHoverLinkSource("properties");
    }

    onFileMenu(menu, file, source, leaf) {
      if (host.Platform.isMobile) return;
      if (!(file instanceof host.TFile) || !leaf || file.extension !== "md") return;
      if (source === "sidebar-context-menu") return;
      const self = this;
      menu.addItem((item) =>
        item
          .setSection("view.linked")
          .setTitle(propertiesT(host).actionOpenLocal())
          .setIcon("lucide-info")
          .onClick(async () => {
            await self.app.workspace.splitLeafOrActive(leaf, "horizontal").setViewState({
              type: VIEW_FILE,
              active: true,
              group: leaf,
              state: { file: file.path },
            });
          })
      );
    }

    async ensurePropertiesView(file) {
      const leaves = this.app.workspace.getLeavesOfType(VIEW_FILE);
      let leaf;
      for (const candidate of leaves) {
        if (!candidate.pinned || candidate.getViewState().state?.file === file.path) {
          leaf = candidate;
          break;
        }
      }
      if (!leaf) leaf = this.app.workspace.getRightLeaf(false);
      await this.app.workspace.revealLeaf(leaf);
      await leaf.setViewState({ type: VIEW_FILE, state: file ? { file: file.path } : undefined });
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      return leaf.view;
    }

    async addProperty(file) {
      const view = await this.ensurePropertiesView(file);
      view.metadataEditor.addProperty();
    }
  }
  return PropertiesPlugin;
}
