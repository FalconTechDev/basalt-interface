// s16 slice: the workspaces core plugin — save/load named window layouts, with a manage
// modal, a fuzzy suggest picker and CLI handlers.
import { inherit } from "./inherit.js";
import { renderMatches } from "./search-simple.js";

/** Iee: WorkspacesPlugin. */
export function defineWorkspacesPlugin(host) {
  function WorkspacesPlugin() {
    this.id = "workspaces";
    this.name = host.i18n.plugins.workspaces.name();
    this.description = host.i18n.plugins.workspaces.desc();
    this.workspaces = {};
    this.activeWorkspace = "";
  }

  const proto = WorkspacesPlugin.prototype;
  const t = () => host.i18n.plugins.workspaces;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerGlobalCommand({ id: "workspaces:load", name: t().actionLoadLayout(), icon: "lucide-layout", callback: this.onLoad.bind(this) });
    plugin.registerGlobalCommand({ id: "workspaces:save", name: t().actionSave(), icon: "lucide-save", callback: this.onSave.bind(this) });
    plugin.registerGlobalCommand({ id: "workspaces:save-and-load", name: t().actionSaveAndLoadLayout(), icon: "lucide-layout", callback: this.onSaveAndLoad.bind(this) });
    plugin.registerRibbonItem(t().actionManageLayouts(), "lucide-layout", this.onOpenModal.bind(this));
    plugin.registerGlobalCommand({ id: "workspaces:open-modal", name: t().actionManageLayouts(), icon: "lucide-layout", callback: this.onOpenModal.bind(this) });
  };

  proto.onEnable = async function (app, plugin) {
    const data = (await plugin.loadData()) || {};
    this.workspaces = data.workspaces || {};
    this.activeWorkspace = data.active || "";
    const self = this;

    plugin.registerCliHandler("workspaces", "List saved workspaces", {
      total: { description: "Return workspace count" },
    }, (args) => {
      const names = Object.keys(self.workspaces);
      if (args.total) return String(names.length);
      if (names.length === 0) return "No workspaces saved.";
      return names.map((name) => (name === self.activeWorkspace ? `${name} (active)` : name)).join("\n");
    });

    plugin.registerCliHandler("workspace:save", "Save current layout as workspace", {
      name: { value: "<name>", description: "Workspace name" },
    }, (args) => {
      const name = args.name;
      if (name) {
        self.saveWorkspace(name);
        self.setActiveWorkspace(name);
        return `Saved workspace: ${name}`;
      }
      if (self.activeWorkspace) {
        self.saveWorkspace(self.activeWorkspace);
        return `Saved workspace: ${self.activeWorkspace}`;
      }
      return "Missing required parameter: name\nUsage: workspace:save name=<name>";
    });

    plugin.registerCliHandler("workspace:load", "Load a saved workspace", {
      name: { value: "<name>", description: "Workspace name", required: true },
    }, async (args) => {
      const name = args.name;
      if (!name) throw new Error("Missing required parameter: name\nUsage: workspace:load name=<name>");
      if (!Object.hasOwn(self.workspaces, name)) throw new Error(`Workspace "${name}" not found.`);
      await self.loadWorkspace(name);
      return `Loaded workspace: ${name}`;
    });

    plugin.registerCliHandler("workspace:delete", "Delete a saved workspace", {
      name: { value: "<name>", description: "Workspace name", required: true },
    }, async (args) => {
      const name = args.name;
      if (!name) throw new Error("Missing required parameter: name\nUsage: workspace:delete name=<name>");
      if (!Object.hasOwn(self.workspaces, name)) throw new Error(`Workspace "${name}" not found.`);
      await self.deleteWorkspace(name);
      return `Deleted workspace: ${name}`;
    });
  };

  proto.onDisable = async function () {
    await this.saveData();
  };

  proto.onOpenModal = function () {
    new host.s16ManageWorkspacesModal(this.app, this).open();
  };

  proto.onLoad = function () {
    new host.s16WorkspaceSuggestModal(this.app, this, false).open();
    return false;
  };

  proto.onSave = function () {
    const active = this.activeWorkspace;
    if (active && this.workspaces.hasOwnProperty(active)) {
      this.saveWorkspace(active);
      new host.Notice(t().msgSaveLayoutSuccess({ name: active }));
    } else {
      new host.s16ManageWorkspacesModal(this.app, this).open();
    }
  };

  proto.onSaveAndLoad = function () {
    new host.s16WorkspaceSuggestModal(this.app, this, true).open();
    return false;
  };

  proto.saveWorkspace = function (name) {
    const layout = this.app.workspace.getLayout();
    layout.mtime = window.moment().format();
    this.workspaces[name] = layout;
    this.saveData();
  };

  proto.setActiveWorkspace = function (name) {
    this.activeWorkspace = name;
    this.saveData();
  };

  proto.loadWorkspace = async function (name) {
    if (this.workspaces.hasOwnProperty(name)) {
      this.activeWorkspace = name;
      await this.app.workspace.changeLayout(this.workspaces[name]);
      this.saveData();
    }
  };

  proto.deleteWorkspace = async function (name) {
    delete this.workspaces[name];
    await this.saveData();
  };

  proto.saveData = async function () {
    await this.plugin.saveData({ workspaces: this.workspaces, active: this.activeWorkspace });
  };

  return WorkspacesPlugin;
}

/** Oee: modal to name-and-save the current layout and manage/delete saved ones. */
export function defineManageWorkspacesModal(host) {
  const Base = host.Modal;
  function ManageWorkspacesModal(app, plugin) {
    const self = Base.call(this, app) || this;
    self.plugin = plugin;
    self.titleEl.setText(host.i18n.plugins.workspaces.actionManageLayouts());
    self.contentEl.createDiv("list-item", (el) => {
      const input = self.nameEl = el.createEl("input", { cls: "list-item-part mod-extended", type: "text" });
      input.placeholder = host.i18n.plugins.workspaces.placeholderSaveCurrentLayoutAs();
      input.addEventListener("keypress", (event) => {
        if (!event.isComposing && event.key === "Enter") self.onFinish();
      });
      const button = el.createEl("button", { cls: "list-item-part", text: host.i18n.plugins.workspaces.buttonSave() });
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", self.onFinish.bind(self));
    });
    self.listContainerEl = self.contentEl.createDiv("list-container mod-manage-workspaces");
    self.renderList();
    return self;
  }
  inherit(ManageWorkspacesModal, Base);
  const proto = ManageWorkspacesModal.prototype;

  proto.onOpen = function () {
    this.nameEl.focus();
  };

  proto.renderList = function () {
    const self = this;
    const container = this.listContainerEl;
    const workspaces = this.plugin.workspaces;
    container.empty();
    const render = (name) => {
      if (!workspaces.hasOwnProperty(name)) return;
      const layout = workspaces[name];
      container.createDiv("list-item", (el) => {
        el.createDiv("list-item-part mod-extended", (info) => {
          info.createSpan({ text: name });
          if (name === self.plugin.activeWorkspace) info.createSpan({ cls: "flair mod-pop", text: host.i18n.setting.appearance.labelCurrentlyActive() });
          info.createDiv("list-item-desc", (desc) => {
            if (layout.mtime) {
              const when = window.moment(layout.mtime);
              desc.createDiv({ cls: "list-item-part", text: host.i18n.plugins.workspaces.labelWorkspaceModifiedTime({ time: when.fromNow() }) });
            }
          });
        });
        el.createDiv("list-item-actions", (actions) => {
          actions.createEl("button", { cls: "list-item-part", text: host.i18n.plugins.workspaces.buttonLoad() }, (button) => {
            button.addEventListener("click", () => {
              self.plugin.loadWorkspace(name);
              self.close();
            });
          });
          actions.createDiv("list-item-part clickable-icon", (icon) => {
            host.setIcon(icon, "lucide-x");
            host.setTooltip(icon, host.i18n.plugins.workspaces.tooltipDeleteLayout());
            icon.addEventListener("mousedown", (event) => event.preventDefault());
            icon.addEventListener("click", async () => {
              await self.plugin.deleteWorkspace(name);
              self.renderList();
            });
          });
        });
      });
    };
    for (const name in this.plugin.workspaces) render(name);
  };

  proto.onFinish = function () {
    const name = this.nameEl.value.trim();
    if (name) {
      this.plugin.saveWorkspace(name);
      this.plugin.setActiveWorkspace(name);
      new host.Notice(host.i18n.plugins.workspaces.msgSaveLayoutSuccess({ name }));
      this.nameEl.value = "";
      this.renderList();
    } else {
      new host.Notice(host.i18n.plugins.workspaces.msgEnterName());
    }
  };

  return ManageWorkspacesModal;
}

/** Fee: fuzzy picker over saved workspace names; optionally saves the current layout first. */
export function defineWorkspaceSuggestModal(host) {
  const Base = host.FuzzySuggestModal;
  function WorkspaceSuggestModal(app, plugin, shouldSave) {
    const self = Base.call(this, app) || this;
    self.emptyStateText = host.i18n.plugins.workspaces.labelNoLayoutFound();
    self.plugin = plugin;
    self.shouldSave = shouldSave;
    self.setPlaceholder(host.i18n.plugins.workspaces.placeholderTypeToSearchLayouts());
    self.setInstructions([
      { command: "↑↓", purpose: host.i18n.plugins.commandPalette.instructionNavigate() },
      { command: "↵", purpose: host.i18n.plugins.commandPalette.instructionUse() },
      { command: "esc", purpose: host.i18n.plugins.commandPalette.instructionDismiss() },
    ]);
    return self;
  }
  inherit(WorkspaceSuggestModal, Base);
  const proto = WorkspaceSuggestModal.prototype;

  proto.getItems = function () {
    return Object.keys(this.plugin.workspaces);
  };

  proto.getEmptySearchItems = function () {
    return this.getItems();
  };

  proto.getItemText = function (item) {
    return item;
  };

  proto.renderSuggestion = function (item, el) {
    const name = item.item;
    renderMatches(el, this.getItemText(name), item.match ? item.match.matches : null);
    if (name === this.plugin.activeWorkspace) el.createSpan({ cls: "flair mod-pop", text: host.i18n.setting.appearance.labelCurrentlyActive() });
  };

  proto.onChooseItem = function (name) {
    if (this.shouldSave) {
      const workspaces = this.plugin.workspaces;
      const active = this.plugin.activeWorkspace;
      if (active && workspaces[active]) this.plugin.saveWorkspace(active);
    }
    this.plugin.loadWorkspace(name);
  };

  return WorkspaceSuggestModal;
}
