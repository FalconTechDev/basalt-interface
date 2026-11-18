// s16 slice: the sync-sidebar tree items — the layout-info base (Y9), the collapsible
// folder row (Q9), the "+N more" row (X9) and the file row with version-history menu ($9).
import { inherit } from "./inherit.js";
import { baseName, extensionOf } from "./path.js";

// The four manifest factories run in bundle order (Y9, Q9, X9, $9); the shared base is
// built once and reused so Q9/X9/$9 extend the exact same constructor.
let s16NavBase = null;

function navBase(host) {
  if (s16NavBase) return s16NavBase;
  function NavItemBase() {
    const self = host.TreeItem.call(this) || this;
    self.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    delete self.coverEl;
    return self;
  }
  inherit(NavItemBase, host.TreeItem);
  s16NavBase = NavItemBase;
  return NavItemBase;
}

/** Y9: base tree item carrying the infinity-scroll layout record. */
export function defineNavItemBase(host) {
  return navBase(host);
}

/** Q9: a folder row — chevron, flair count and a lazily built child list. */
export function defineNavFolder(host) {
  const Base = host.s16TreeCollapsible(navBase(host));
  function NavFolder(tree, id, title) {
    const self = Base.call(this, tree, id, title) || this;
    self.vChildren = new host.TreeChildren(self);
    self.pusherEl = host.s16TreePusher();
    self.tree = tree;
    self.id = id;
    self.setClickable(true);
    self.setCollapsible(true);
    self.el.addClass("nav-folder");
    self.selfEl.addClass("nav-folder-title");
    self.innerEl.addClass("nav-folder-title-content");
    self.childrenEl.addClass("nav-folder-children");
    self.innerEl.setText(title);
    self.flairEl = self.selfEl.createDiv("tree-item-flair-outer").createSpan("tree-item-flair");
    self.collapseEl.empty();
    return self;
  }
  inherit(NavFolder, Base);
  const proto = NavFolder.prototype;

  proto.clear = function () {
    this.vChildren.clear();
    this.setFlair(0);
  };

  proto.addChild = function (child) {
    this.vChildren.addChild(child);
  };

  proto.onSelfClick = function () {
    this.toggleCollapsed(true);
  };

  proto.setFlair = function (count) {
    this.flairEl.setText(host.i18n.nouns.count({ count }));
  };

  proto.setCollapsed = function (collapsed, scroll) {
    return (async () => {
      await Base.prototype.setCollapsed.call(this, collapsed, scroll);
      this.tree.infinityScroll.invalidate(this);
      this.tree.requestSaveFolds();
    })();
  };

  return NavFolder;
}

/** X9: the "+N more" row shown when a folder is collapsed to a preview. */
export function defineNavMoreButton(host) {
  const Base = navBase(host);
  function NavMoreButton(parent, count) {
    const self = Base.call(this, parent, count) || this;
    self.parent = parent;
    self.count = count;
    self.setClickable(false);
    self.el.addClass("nav-file");
    self.selfEl.addClass("more-button");
    self.innerEl.addClass("nav-file-title-content");
    self.innerEl.setText(host.i18n.plugins.sync.labelMore({ count }));
    return self;
  }
  inherit(NavMoreButton, Base);
  return NavMoreButton;
}

/** $9: a synced file row — opens the file, offers version history, shows a hover tooltip. */
export function defineSyncNavFile(host) {
  const Base = navBase(host);
  function SyncNavFile(view, sFile) {
    const self = Base.call(this, view, sFile) || this;
    self.view = view;
    self.sFile = sFile;
    self.setClickable(true);
    self.el.addClass("nav-file");
    self.selfEl.addClass("nav-file-title");
    self.innerEl.addClass("nav-file-title-content");
    const ext = extensionOf(sFile.path);
    if (!host.markdownExtensions.contains(ext)) self.selfEl.createDiv({ cls: "nav-file-tag", text: ext });
    self.innerEl.setText(baseName(sFile.path));
    self.selfEl.setAttr("data-path", self.sFile.path);
    self.selfEl.addEventListener("mouseover", self.onFileMouseover.bind(self));
    self.selfEl.addEventListener("mouseout", self.onFileMouseout.bind(self));
    self.selfEl.addEventListener("contextmenu", self.openFileContextMenu.bind(self));
    return self;
  }
  inherit(SyncNavFile, Base);
  const proto = SyncNavFile.prototype;

  proto.onSelfClick = function (event) {
    this.view.app.workspace.openLinkText(this.sFile.path, "", host.Keymap.isModEvent(event));
  };

  proto.openFileContextMenu = function (event) {
    event.preventDefault();
    const dest = this.view.app.metadataCache.getFirstLinkpathDest(this.sFile.path, "");
    if (!dest) return;
    const menu = new host.Menu().addSections(["title", "open", "action", "view", "info", "", "danger"]);
    menu.addItem((item) => item
      .setSection("view")
      .setTitle(host.i18n.plugins.sync.menuOptViewVersionHistory())
      .setIcon("lucide-history")
      .onClick(() => this.view.sync.showVersionHistory(this.sFile.path)));
    this.view.app.workspace.trigger("file-menu", menu, dest, "sync-sidebar");
    menu.showAtMouseEvent(event);
  };

  proto.onFileMouseover = function (event) {
    if (!host.pointerEntered(event, this.selfEl) || host.isTouchSyntheticMouse(event)) return;
    let text = window.moment(this.sFile.mtime).format("llll");
    if (this.sFile.user && this.view.userMap.hasOwnProperty(this.sFile.user)) text += "\n" + this.view.userMap[this.sFile.user];
    host.displayTooltip(this.selfEl, text, {
      placement: this.view.getSideTooltipPlacement(),
      gap: 24,
      horizontalParent: this.view.containerEl,
      delay: host.s16NavTooltipDelay,
    });
  };

  proto.onFileMouseout = function (event) {
    if (host.pointerEntered(event, this.selfEl)) host.hideTooltip();
  };

  return SyncNavFile;
}
