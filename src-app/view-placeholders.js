// The three views that stand in for a real one: DeferredView (a hidden tab restored from the layout; builds the real view when it is
// shown), EmptyView (a leaf with nothing open: the "new tab" page) and UnknownView (a layout names a view type nobody registered).
import { inherit } from "./inherit.js";

export function defineDeferredView(host) {
  /** Remembers type, icon, title and state of a view that is not built yet; rerender() swaps in the real one. */
  function DeferredView(leaf, viewType, icon, title) {
    const self = host.View.call(this, leaf) || this;
    self.navigation = false;
    self.viewType = viewType;
    self.icon = icon;
    self.title = title || "";
    // building happens when the tab becomes visible or is clicked
    self.containerEl.onNodeInserted(() => self.rerender());
    self.containerEl.addEventListener("click", () => self.rerender());
    return self;
  }
  inherit(DeferredView, host.View);
  const proto = DeferredView.prototype;

  proto.getDisplayText = function () { return this.title; };
  proto.getViewType = function () { return this.viewType; };
  proto.getState = function () { return this.state; };
  proto.setState = async function (state) { this.state = state; };
  proto.setEphemeralState = function (eState) { this.estate = eState; };

  /** Replaces this placeholder by the real view of the same type and state. */
  proto.rerender = async function () {
    const workspace = this.app.workspace;
    const leaf = this.leaf;
    if (leaf.view !== this || leaf.working) return;
    await leaf.setViewState({ type: this.viewType, state: this.state }, this.estate);
    if (leaf.view !== this) workspace.requestLayoutChangeEvents();
  };

  return DeferredView;
}

export function defineEmptyView(host) {
  /** The page of a new tab: create a note, go to a file, open a web page, close the tab. */
  function EmptyView(leaf) {
    const self = host.ItemView.call(this, leaf) || this;
    self.canDropAnywhere = true;
    self.navigation = true;
    const emptyState = (self.emptyStateEl = self.contentEl.createDiv("empty-state"));
    const area = (self.clickableAreaEl = emptyState.createDiv("empty-state-container"));
    self.emptyTitleEl = area.createDiv({ cls: "empty-state-title" });
    self.actionListEl = area.createDiv("empty-state-action-list");
    self.app.dragManager.handleDrop(emptyState, (event, data, isPreview) => {
      const hint = self.leaf.handleDrop(event, data, isPreview);
      if (hint) {
        hint.hoverEl = emptyState;
        hint.hoverClass = "is-highlighted";
        return hint;
      }
      return undefined;
    });
    return self;
  }
  inherit(EmptyView, host.ItemView);
  const proto = EmptyView.prototype;

  proto.getDisplayText = function () { return host.t.interface.labelNewTab(); };
  proto.getViewType = function () { return "empty"; };

  proto.onOpen = async function () {
    const app = this.app;
    const list = this.actionListEl;
    list.empty();
    /** A clickable line that runs a command; the command's hotkey is shown in brackets when `showHotkey`. */
    const addCommandAction = (label, commandId, showHotkey) => {
      let suffix = "";
      if (showHotkey) {
        const hotkey = app.hotkeyManager.printHotkeyForCommand(commandId);
        if (hotkey) suffix = ` (${hotkey})`;
      }
      list.createDiv({ cls: "empty-state-action tappable", text: label + suffix }, (el) => {
        el.addEventListener("click", (event) => { app.commands.executeCommandById(commandId, event); });
      });
    };
    addCommandAction(host.t.interface.emptyState.createNewFile(), "file-explorer:new-file", host.Platform.hasPhysicalKeyboard);
    if (!app.vault.isEmpty()) addCommandAction(host.t.interface.emptyState.goToFile(), "switcher:open", host.Platform.hasPhysicalKeyboard);
    if (this.app.internalPlugins.getEnabledPluginById("webviewer")) {
      addCommandAction(host.t.plugins.webViewer.actionOpen(), "webviewer:open", true);
    }
    list.createDiv({ cls: "empty-state-action tappable mod-close", text: host.t.interface.emptyState.close() }, (el) => {
      el.addEventListener("click", () => { this.leaf.detach(); });
    });
  };

  return EmptyView;
}

export function defineUnknownView(host) {
  /** "This pane doesn't look like anything": keeps the state of a view whose type is not registered, so it survives a restart. */
  function UnknownView(leaf, viewType) {
    const self = host.EmptyView.call(this, leaf) || this;
    self.canDropAnywhere = true;
    self.viewType = viewType;
    self.emptyTitleEl.setText(host.t.interface.emptyState.unknownPaneTitle());
    const description = createDiv({ text: host.t.interface.emptyState.unknownPaneDesc({ type: viewType }) });
    host.setTooltip(description, "This pane doesn't look like anything to me.");
    self.clickableAreaEl.insertAfter(description, self.emptyTitleEl);
    return self;
  }
  inherit(UnknownView, host.EmptyView);
  const proto = UnknownView.prototype;

  proto.getDisplayText = function () { return this.viewType; };
  proto.getViewType = function () { return this.viewType; };
  proto.getIcon = function () { return "lucide-ghost"; };
  proto.getState = function () { return this.state; };
  proto.setState = async function (state) { this.state = state; };

  proto.onload = function () {
    host.EmptyView.prototype.onload.call(this);
    this.registerEvent(this.app.workspace.on("layout-change", this.onLayoutChange.bind(this)));
  };

  proto.onOpen = async function () {
    const list = this.actionListEl;
    const type = this.viewType;
    list.createDiv({ cls: "empty-state-action tappable mod-close", text: host.t.interface.emptyState.close() })
      .addEventListener("click", () => this.leaf.detach());
    const leaves = this.app.workspace.getLeavesOfType(type);
    this.closeAllButtonEl = list.createDiv({
      cls: "empty-state-action tappable mod-close",
      text: host.t.interface.emptyState.closeAll({ id: type, count: leaves.length }),
    });
    this.closeAllButtonEl.hide();
    this.closeAllButtonEl.addEventListener("click", () => {
      for (const leaf of this.app.workspace.getLeavesOfType(this.viewType)) leaf.detach();
    });
  };

  /** "Close all" is only offered when more than one pane of this unknown type is open. */
  proto.onLayoutChange = function () {
    const type = this.viewType;
    const count = this.app.workspace.getLeavesOfType(type).length;
    this.closeAllButtonEl.setText(host.t.interface.emptyState.closeAll({ id: type, count }));
    this.closeAllButtonEl.toggle(count > 1);
  };

  return UnknownView;
}
