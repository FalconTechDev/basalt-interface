// s16 slice: the tag-pane core plugin — registers the side leaf, its open command and view type.
import { s16TagViewType } from "./s16-constants.js";

/** dee: TagPanePlugin. */
export function defineTagPanePlugin(host) {
  function TagPanePlugin() {
    this.id = "tag-pane";
    this.name = host.i18n.plugins.tagPane.name();
    this.description = host.i18n.plugins.tagPane.desc();
    this.defaultOn = true;
  }

  TagPanePlugin.prototype.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerGlobalCommand({
      id: "tag-pane:open",
      name: host.i18n.plugins.tagPane.actionShow(),
      icon: "lucide-tag",
      callback: () => this.app.workspace.ensureSideLeaf(s16TagViewType, "right", { active: true }),
    });
    plugin.registerViewType(s16TagViewType, (leaf) => new host.s16TagPaneView(leaf));
  };

  TagPanePlugin.prototype.onEnable = function (app, plugin) {
    plugin.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
  };

  TagPanePlugin.prototype.onUserEnable = function () {
    this.initLeaf();
  };

  TagPanePlugin.prototype.initLeaf = function () {
    const side = host.Platform.isMobile ? "left" : "right";
    this.app.workspace.ensureSideLeaf(s16TagViewType, side, { reveal: false });
  };

  return TagPanePlugin;
}
