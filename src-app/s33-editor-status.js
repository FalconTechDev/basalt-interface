// Editor-status internal plugin (b8): a status-bar item showing and switching the
// active markdown view's mode (read / source / live-preview).
import { setElementTooltip } from "./tooltip.js";
import { env } from "./env.js";
import { s33EditorStatusStrings } from "./s33-canvas-edge.js";

export function defineS33EditorStatusPlugin(host) {
  const t = () => s33EditorStatusStrings();

  function EditorStatusPlugin() {
    this.id = "editor-status";
    this.name = t().name();
    this.description = t().desc();
    this.defaultOn = true;
    this.hiddenFromList = true;
  }
  const proto = EditorStatusPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerStatusBarItem();
  };

  proto.onEnable = function (app, plugin) {
    plugin.registerEvent(app.workspace.on("layout-change", this.updateStatus, this));
    plugin.registerEvent(app.workspace.on("active-leaf-change", this.updateStatus, this));
    plugin.statusBarEl.addEventListener("click", this.onClick.bind(this));
    plugin.statusBarEl.addEventListener("contextmenu", this.onClick.bind(this));
    plugin.statusBarEl.addClass("mod-clickable");
    this.updateStatus();
  };

  proto.onDisable = function () {};

  proto.getStatus = function () {
    const view = this.getActiveView();
    if (!view) return "";
    if (view.getMode() === "preview") return "read";
    if (view.editMode) return view.editMode.sourceMode ? "source" : "live-preview";
    return "source";
  };

  proto.getActiveView = function () {
    const view = this.app.workspace.getActiveFileView();
    return view && view instanceof host.MarkdownView ? view : null;
  };

  proto.setStatus = async function (mode) {
    const view = this.getActiveView();
    if (!view) return;
    const state = view.getState();
    switch (mode) {
      case "read": state.mode = "preview"; break;
      case "source": state.mode = "source"; state.source = true; break;
      case "live-preview": state.mode = "source"; state.source = false; break;
    }
    await view.leaf.setViewState({ type: env().U6, state });
  };

  proto.updateStatus = function () {
    const bar = this.plugin.statusBarEl;
    bar.empty();
    bar.show();
    const icon = bar.createSpan("status-bar-item-icon");
    switch (this.getStatus()) {
      case "":
        bar.hide();
        return;
      case "read":
        host.setIcon(icon, "lucide-book-open");
        setElementTooltip(bar, t().read(), { placement: "top" });
        break;
      case "source":
        host.setIcon(icon, "lucide-code-2");
        setElementTooltip(bar, t().editSource(), { placement: "top" });
        break;
      case "live-preview":
        host.setIcon(icon, "lucide-edit-3");
        setElementTooltip(bar, t().editLivePreview(), { placement: "top" });
        break;
    }
  };

  proto.onClick = function (evt) {
    const view = this.getActiveView();
    if (!view) return;
    const menu = new host.Menu();
    const current = this.getStatus();
    const add = (mode, icon, title) => {
      menu.addItem((item) => item.setTitle(title).setIcon(icon).setChecked(current === mode).onClick(() => this.setStatus(mode)));
    };
    add("read", "lucide-book-open", t().read());
    add("source", "lucide-code-2", t().editSource());
    if (view.editMode) add("live-preview", "lucide-edit-3", t().editLivePreview());
    menu.showAtMouseEvent(evt);
  };

  return EditorStatusPlugin;
}
