// ng06 BasesView FileView (`HX`, view type "bases"): wraps a .base file's YAML
// query in a QueryController and persists view state.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng06BasesViewType } from "./n-g06-shared.js";

/** `HX` — the `bases` FileView. */
export function ng06BasesFileView(host) {
  const Base = host.PlaintextView || host.FileView;
  function BasesFileView(leaf, plugin) {
    const self = Base.call(this, leaf) || this;
    self.plugin = plugin;
    self.navigation = true;
    self.isPlaintext = false;
    self.query = null;
    self.lastData = null;
    self.controller = null;
    const app = self.app;
    const currentFile = self.isInSidebar && self.isInSidebar()
      ? (app.workspace.getActiveFile && app.workspace.getActiveFile()) || null
      : null;
    self.controller = new (env().C$)(app, plugin, self.contentEl, currentFile);
    self.addChild ? self.addChild(self.controller) : null;
    if (self.controller && self.controller.events) {
      self.controller.events.on("view-changed", () => {
        self.requestSaveLayout && self.requestSaveLayout();
        if (self.leaf) self.leaf.updateHeader();
      });
    }
    return self;
  }
  inherit(BasesFileView, Base);

  BasesFileView.prototype.getViewType = function () { return ng06BasesViewType; };
  BasesFileView.prototype.getIcon = function () {
    const c = this.controller;
    const type = c && c.viewConfig && c.viewConfig.type;
    const reg = type && this.plugin && this.plugin.getRegistration ? this.plugin.getRegistration(type) : null;
    return (reg && reg.icon) || "lucide-layout-list";
  };
  BasesFileView.prototype.canAcceptExtension = function (ext) { return ext === "base"; };

  BasesFileView.prototype.load = function () {
    const self = this;
    Base.prototype.load && Base.prototype.load.call(this);
    this.registerEvent(this.app.workspace.on("file-open", (file) => self.updateCurrentFile(file)));
    this.registerEvent(this.app.workspace.on("layout-change", () => self.onLayoutChange()));
  };

  BasesFileView.prototype.onLayoutChange = function () {
    if (this.isInSidebar && this.isInSidebar()) this.onGroupChange();
  };

  BasesFileView.prototype.onGroupChange = function () {
    const group = this.leaf && this.leaf.group;
    if (group) {
      const siblings = group.children || [];
      for (const leaf of siblings) {
        if (leaf !== this.leaf && leaf.view instanceof env().MD) {
          this.updateCurrentFile(leaf.view.file);
          return;
        }
      }
    }
    this.updateCurrentFile(this.app.workspace.getActiveFile());
  };

  BasesFileView.prototype.updateCurrentFile = function (file) {
    if (this.leaf && this.leaf === this.app.workspace.activeLeaf && this.isInSidebar && this.isInSidebar()) return;
    if (this.leaf && (this.leaf.pinned || this.leaf.group)) return;
    if (!this.controller) return;
    this.controller.updateCurrentFile(file instanceof env().$T ? file : null);
  };

  BasesFileView.prototype.receiveSyncState = function (state) {
    if (state && state.file !== undefined) this.updateCurrentFile(state.file);
  };

  BasesFileView.prototype.getViewData = function () {
    if (this.query) return this.query.toString();
    return this.lastData;
  };

  BasesFileView.prototype.setViewData = function (data, clear) {
    this.lastData = data;
    let query = null;
    try {
      query = env().EY.fromString(data);
      query.file = this.file;
      query.saveFn = (q) => this.saveQuery(q);
    } catch (e) {
      query = e;
    }
    this.query = query instanceof Error ? null : query;
    if (this.controller) this.controller.setQuery(query);
  };

  BasesFileView.prototype.saveQuery = function (query) {
    this.query = query;
    this.requestSave();
    if (this.controller) this.controller.setQuery(query);
  };

  BasesFileView.prototype.getState = function () {
    const state = Base.prototype.getState ? Base.prototype.getState.call(this) : {};
    if (this.controller) state.viewName = this.controller.viewName;
    return state;
  };

  BasesFileView.prototype.setState = function (state, result) {
    if (Base.prototype.setState) Base.prototype.setState.call(this, state, result);
    if (state && state.viewName && this.controller) {
      this.controller.selectView(state.viewName);
      if (this.leaf) this.leaf.updateHeader();
    }
  };

  BasesFileView.prototype.getEphemeralState = function () {
    const state = Base.prototype.getEphemeralState ? Base.prototype.getEphemeralState.call(this) : {};
    if (this.controller) {
      const c = this.controller.getEphemeralState();
      state.views = c.views;
    }
    return state;
  };

  BasesFileView.prototype.setEphemeralState = function (state) {
    if (Base.prototype.setEphemeralState) Base.prototype.setEphemeralState.call(this, state);
    if (state && state.views && this.controller) this.controller.setEphemeralState(state);
    if (state && state.focus && this.controller && this.controller.view && this.controller.view.focus) {
      this.controller.view.focus();
    }
    if (state && typeof state.subpath === "string" && state.subpath.startsWith("#") && this.controller) {
      this.controller.selectView(state.subpath.slice(1));
    }
  };

  BasesFileView.prototype.showSearch = function () {
    if (this.controller && this.controller.searchMenu) this.controller.searchMenu.open();
  };

  BasesFileView.prototype.clear = function () {
    if (this.controller) this.controller.clear();
  };

  return BasesFileView;
}
