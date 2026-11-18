// FileView (an ItemView that shows one file: breadcrumbs, rename / delete handling, linked-tab sync) and ViewRegistry (view types and
// the file extensions they open).
import { inherit } from "./inherit.js";
import { normalizePath } from "./path.js";

export function defineFileView(host) {
  function FileView(leaf) {
    const self = host.ItemView.call(this, leaf) || this;
    self.allowNoFile = false; // false: when the file is gone the leaf goes back / closes
    self.navigation = true;
    return self;
  }
  inherit(FileView, host.ItemView);
  const proto = FileView.prototype;

  /** Folder names above the title; each one reveals the folder in the file explorer, has a context menu and can be dragged. */
  proto.renderBreadcrumbs = function () {
    const app = this.app;
    this.titleParentEl.empty();
    const folder = this.file && this.file.parent ? this.file.parent.path : undefined;
    if (!folder || folder === "/") return;
    const parts = folder.split("/");
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const crumb = this.titleParentEl.createSpan({ cls: "view-header-breadcrumb", text: name });
      if (!host.Platform.isMobile) host.setTooltip(crumb, name);
      crumb.addEventListener("click", () => {
        const explorer = app.internalPlugins.getEnabledPluginById("file-explorer");
        if (!explorer) return;
        const target = app.vault.getFolderByPath(normalizePath(path));
        if (target) explorer.revealInFolder(target);
      });
      crumb.addEventListener("contextmenu", (event) => {
        const { fileManager, vault, workspace } = app;
        const target = vault.getFolderByPath(normalizePath(path));
        if (!target) return;
        const menu = host.Menu.forEvent(event).addSections(["title", "open", "action-primary", "action", "info", "info.copy", "view", "system", "", "danger"]);
        menu.addItem((item) => item
          .setSection("action-primary")
          .setTitle(host.t.plugins.fileExplorer.menuOptNewNote())
          .setIcon("lucide-edit")
          .onClick(async (clickEvent) => {
            const note = await fileManager.createNewMarkdownFile(target);
            workspace.getLeaf(host.Keymap.isModEvent(clickEvent)).openFile(note, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
          }));
        menu.setParentElement(crumb);
        app.workspace.trigger("file-menu", menu, target, "file-explorer-context-menu");
      });
      app.dragManager.handleDrag(crumb, (event) => {
        const target = app.vault.getFolderByPath(normalizePath(path));
        if (!target) return null;
        app.dragManager.updateSource([crumb], "is-being-dragged");
        return app.dragManager.dragFolder(event, target);
      });
      this.titleParentEl.createSpan({ cls: "view-header-breadcrumb-separator", text: "/" });
    });
  };

  proto.getDisplayText = function () {
    return this.file ? this.file.basename : host.t.interface.noFile();
  };

  proto.onload = function () {
    host.ItemView.prototype.onload.call(this);
    const vault = this.app.vault;
    this.registerEvent(vault.on("rename", this.onRename.bind(this)));
    this.registerEvent(vault.on("delete", this.onDelete.bind(this)));
  };

  proto.getState = function () {
    const state = host.ItemView.prototype.getState.call(this);
    if (this.file) state.file = this.file.path;
    return state;
  };

  /** Linked tabs (same group) open the same file as this one. */
  proto.syncState = function () {
    const leaf = this.leaf;
    const group = leaf.group;
    if (!group) return;
    for (const other of this.app.workspace.getGroupLeaves(group)) {
      if (other !== leaf && other.view instanceof FileView) other.view.receiveSyncState(this);
    }
  };

  proto.receiveSyncState = function (source) {
    if (source.file !== this.file) this.leaf.openFile(source.file);
  };

  proto.setState = async function (state, result) {
    let changed = false;
    if (state.hasOwnProperty("file")) {
      const file = this.app.vault.getAbstractFileByPath(state.file);
      changed = file instanceof host.TFile ? await this.loadFile(file) : await this.loadFile(null);
    }
    if (!this.file && !this.allowNoFile) result.close = true;
    if (changed) {
      result.layout = true;
      result.history = true;
    }
    await host.ItemView.prototype.setState.call(this, state, result);
    if (!state.sync && (result.layout || result.history)) result.done = () => this.syncState();
  };

  proto.onClose = async function () {
    this.contentEl.empty();
    await this.loadFile(null);
  };

  /** Switches to `file` (null = none); returns false when it already was the file. A failing onLoadFile leaves the view without file. */
  proto.loadFile = async function (file) {
    const current = this.file;
    if (current === file) return false;
    if (current) await this.onUnloadFile(current);
    this.file = null;
    if (file) {
      try {
        this.file = file;
        await this.onLoadFile(file);
      } catch (err) {
        this.file = null;
        new host.Notice(host.t.interface.msgFailedToLoadFile({ plugin: file.path }));
        console.error(err);
      }
    }
    this.renderBreadcrumbs();
    this.titleEl.setText(this.getDisplayText());
    const leaf = this.leaf;
    const workspace = leaf.workspace;
    if (workspace.activeLeaf === leaf) workspace.requestActiveLeafEvents();
    this.leaf.updateHeader();
    return true;
  };

  proto.onLoadFile = async function () {};
  proto.onUnloadFile = async function () {};

  proto.onRename = async function (file) {
    if (file !== this.file) return;
    this.renderBreadcrumbs();
    this.titleEl.setText(file.basename);
    this.app.workspace.onLayoutChange();
    this.leaf.updateHeader();
  };

  /** The file was deleted: show nothing, go back in history, or turn the leaf into an empty one (closing it if it has siblings). */
  proto.onDelete = async function (file) {
    if (file === this.file) {
      if (this.allowNoFile) {
        await this.loadFile(null);
      } else {
        const leaf = this.leaf;
        if (leaf.history.backHistory.length > 0) await leaf.history.back();
        else await leaf.open(null);
        // (the inherited code assumed the leaf is still in the tree here; it may already be gone)
        if (this.leaf.view instanceof host.EmptyView && leaf.parent && leaf.parent.children.length > 1) leaf.detach();
      }
      this.app.workspace.onLayoutChange();
    }
  };

  proto.canAcceptExtension = function () { return false; };

  return FileView;
}

export function defineViewRegistry(host) {
  /**
   * view type -> creator(leaf), file extension -> view type. Emits "view-registered" / "view-unregistered" / "extensions-updated".
   */
  function ViewRegistry() {
    const self = host.Events.call(this) || this;
    self.viewByType = {};
    self.typeByExtension = {};
    // the views the app ships with, and what they open
    const builtIn = [
      [host.markdownExtensions, host.MarkdownView],
      [host.imageExtensions, host.ImageView],
      [host.audioExtensions, host.AudioView],
      [host.videoExtensions, host.VideoView],
      [host.pdfExtensions, host.PdfView],
    ];
    for (const [extensions, View] of builtIn) self.registerViewWithExtensions(extensions, View.VIEW_TYPE, (leaf) => new View(leaf));
    self.registerView(host.releaseNotesType, (leaf) => new host.ReleaseNotesView(leaf));
    return self;
  }
  inherit(ViewRegistry, host.Events);
  const proto = ViewRegistry.prototype;

  proto.registerView = function (type, creator) {
    if (this.viewByType.hasOwnProperty(type)) throw new Error(`Attempting to register an existing view type "${type}"`);
    this.viewByType[type] = creator;
    this.trigger("view-registered", type);
  };

  proto.unregisterView = function (type) {
    if (this.viewByType.hasOwnProperty(type)) {
      delete this.viewByType[type];
      this.trigger("view-unregistered", type);
    }
  };

  /** All-or-nothing: throws when any extension is taken already. */
  proto.registerExtensions = function (extensions, type) {
    for (const extension of extensions) {
      if (this.typeByExtension.hasOwnProperty(extension)) throw new Error(`Attempting to register an existing file extension "${extension}"`);
    }
    for (const extension of extensions) this.typeByExtension[extension] = type;
    this.trigger("extensions-updated");
  };

  proto.unregisterExtensions = function (extensions) {
    for (const extension of extensions) delete this.typeByExtension[extension];
    this.trigger("extensions-updated");
  };

  proto.registerViewWithExtensions = function (extensions, type, creator) {
    this.registerView(type, creator);
    this.registerExtensions(extensions, type);
  };

  proto.getViewCreatorByType = function (type) { return this.viewByType[type]; };
  proto.getTypeByExtension = function (extension) { return this.typeByExtension[extension]; };
  proto.isExtensionRegistered = function (extension) { return this.typeByExtension.hasOwnProperty(extension); };

  proto.trigger = function (name, ...args) {
    host.Events.prototype.trigger.apply(this, [name, ...args]);
  };
  proto.on = function (name, callback, context) {
    return host.Events.prototype.on.call(this, name, callback, context);
  };

  return ViewRegistry;
}
