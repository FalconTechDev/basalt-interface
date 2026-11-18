// The publish plugin's "navigation preview" tree and its edit modal.
// Faithful port of the inherited code: a checkbox-less tree of the site's files
// and folders that can be reordered by drag and filtered through a context menu,
// plus the modal that edits the order and the hidden items. The five original
// classes shared one bundle scope; here each factory registers its class in
// navClasses so the siblings can find it (all registrations happen during
// bundle init, long before any of them is instantiated).

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { lastSegment, parentPath } from "./path.js";
import { s09SortTreeItems } from "./s09-graph.js";

const pubI18n = (host) => host.i18n.plugins.publish;

// Filled by the five factories below; read only at runtime.
const navClasses = {};

// The tree that lists every publishable path once (was `P7`).
export function s35PublishNavTree(host) {
  const Base = env().eI;
  const i18n = host.i18n;

  function PublishNavTree(plugin, containerEl, navOrder, hiddenItems) {
    const self = Base.call(this, containerEl) || this;
    self.children = [];
    self.showHidden = false;
    self.hiddenItems = [];
    self.navOrder = [];
    self.folders = {};
    self.files = {};
    self.publish = plugin;
    self.navOrder = navOrder;
    self.hiddenItems = hiddenItems;
    const wrap = containerEl.createDiv("tree-list-container");
    wrap.createDiv("tree-list-header", (header) => {
      header.createDiv({ cls: "tree-list-title", text: i18n.plugins.publish.labelNavigationPreview() });
      header.createEl("label", { cls: "tree-list-action mod-checkbox" }, (label) => {
        label
          .createEl("input", { attr: { tabindex: -1 }, type: "checkbox" })
          .addEventListener("click", () => self.setShowHidden(!self.showHidden));
        label.appendText(pubI18n(host).optionShowHiddenItems());
      });
    });
    self.childrenEl = wrap.createDiv("tree-list");
    return self;
  }
  inherit(PublishNavTree, Base);
  const proto = PublishNavTree.prototype;

  proto.setShowHidden = function (show) {
    this.showHidden = show;
    this.render();
  };

  proto.addChild = function (item) {
    const parent = parentPath(item.path);
    if (parent) {
      const folders = this.folders;
      let folder = folders[parent];
      if (!folder) {
        folder = folders[parent] = new navClasses.folder(this, parent);
        this.addChild(folder);
      }
      folder.children.push(item);
      item.parent = folder;
    } else {
      this.addRoot(item);
    }
  };

  proto.createItem = function (path) {
    const item = new navClasses.file(this, path);
    this.files[path] = item;
    this.addChild(item);
    return item;
  };

  proto.rebuildNavOrder = function () {
    const order = [];
    const visit = (items) => {
      const sorted = items.slice();
      s09SortTreeItems(sorted, {}, false);
      let changed = false;
      for (let i = 0; i < items.length; i++) {
        if (sorted[i].path !== items[i].path) {
          changed = true;
          break;
        }
      }
      for (const item of items) {
        if (changed) order.push(item.path);
        if (item instanceof navClasses.folder) visit(item.children);
      }
    };
    visit(this.children);
    this.navOrder = order;
    this.orderChangeCb?.(this.navOrder);
    return order;
  };

  proto.render = function () {
    const ranks = {};
    for (let i = 0; i < this.navOrder.length; i++) ranks[this.navOrder[i]] = i;
    s09SortTreeItems(this.children, ranks);
    const hidden = new Set(this.hiddenItems);
    const mark = (items) => {
      for (const item of items) {
        item.hidden = hidden.has(item.path);
        if (item.type === "folder") mark(item.children);
      }
    };
    mark(this.children);
    Base.prototype.render.call(this);
  };

  navClasses.tree = PublishNavTree;
  return PublishNavTree;
}

// Shared base of the navigation rows: draggable via the host drag helper (was `T7`).
let navItemBaseClass = null;
function navItemBase(host) {
  if (navItemBaseClass) return navItemBaseClass;
  const Base = env().JL;
  function NavItem(tree, path) {
    const self = Base.call(this) || this;
    self.hidden = false;
    self.tree = tree;
    self.name = lastSegment(path);
    self.path = path;
    self.el.addClass("mod-custom-nav");
    self.selfEl.addEventListener("contextmenu", self.onContextMenu.bind(self));
    return self;
  }
  inherit(NavItem, Base);
  const proto = NavItem.prototype;

  proto.onContextMenu = function (event) {
    const self = this;
    new host.Menu()
      .addItem((item) =>
        item
          .setTitle(pubI18n(host).optionHideInNavigation())
          .setChecked(self.hidden)
          .onClick(() => {
            self.hidden = !self.hidden;
            const hiddenItems = self.tree.hiddenItems;
            if (self.hidden) hiddenItems.push(self.path);
            else hiddenItems.remove(self.path);
            self.tree.visibilityChangeCb?.(hiddenItems);
            self.render();
          }),
      )
      .showAtMouseEvent(event);
  };

  proto.render = function () {
    this.el.toggleClass("hidden", this.hidden);
    if (!this.hidden || this.tree.showHidden) {
      this.el.show();
      Base.prototype.render.call(this);
      const siblingsEl = this.parent?.childrenEl ?? this.tree.childrenEl;
      host.makeDragReorderable(this.selfEl, this.el, siblingsEl, 10, () => {}, (index) => {
        const siblings = this.parent?.children ?? this.tree.children;
        siblings.remove(this);
        siblings.splice(index, 0, this);
        this.tree.rebuildNavOrder();
      });
    } else {
      this.el.hide();
    }
  };

  navItemBaseClass = NavItem;
  return NavItem;
}

// Shared base of the navigation rows (was `T7`); memoized so the tree, the
// folder and file rows and the modal all extend the same class.
export function s35PublishNavItem(host) {
  return navItemBase(host);
}

// Folder row of the navigation tree (was `A7`).
export function s35PublishNavFolderItem(host) {
  const Base = navItemBase(host);
  function PublishNavFolderItem(tree, path) {
    const self = Base.call(this, tree, path) || this;
    self.type = "folder";
    self.children = [];
    self.selfEl.addClass("mod-folder");
    self.setCollapsible(true);
    self.setClickable(true);
    self.setCollapsed(true, false);
    self.innerEl.createDiv({ cls: "file-tree-item-title", text: self.name });
    return self;
  }
  inherit(PublishNavFolderItem, Base);
  PublishNavFolderItem.prototype.onSelfClick = function () {
    this.toggleCollapsed(true);
  };
  navClasses.folder = PublishNavFolderItem;
  return PublishNavFolderItem;
}

// File row of the navigation tree (was `D7`).
export function s35PublishNavFileItem(host) {
  const Base = navItemBase(host);
  function PublishNavFileItem(tree, path) {
    const self = Base.call(this, tree, path) || this;
    self.type = "file";
    self.innerEl.createDiv({ cls: "tree-item-title", text: lastSegment(path) });
    return self;
  }
  inherit(PublishNavFileItem, Base);
  PublishNavFileItem.prototype.render = function () {
    Base.prototype.render.call(this);
    this.setCollapsible(false);
    this.setClickable(true);
  };
  navClasses.file = PublishNavFileItem;
  return PublishNavFileItem;
}

// Modal that edits the navigation order and hidden items (was `x7`).
export function s35PublishNavModal(host) {
  const Base = host.Modal;
  const i18n = host.i18n;
  const propI18n = pubI18n(host);

  function PublishNavModal(app, plugin, paths, navOrder, hiddenItems) {
    const self = Base.call(this, app) || this;
    self.plugin = plugin;
    self.modalEl.addClass("mod-scrollable-content");
    self.titleEl.setText(propI18n.labelNavigationModalTitle());
    new host.Setting(self.contentEl)
      .setName(propI18n.optionNavigationOrder())
      .setDesc(propI18n.labelNavigationModalDesc())
      .addExtraButton((button) =>
        button
          .setIcon("lucide-rotate-ccw")
          .setTooltip(i18n.setting.hotkeys.tooltipRestoreDefault())
          .onClick(() => {
            self.tree.navOrder = [];
            self.tree.orderChangeCb?.([]);
            self.tree.render();
          }),
      );
    const tree = (self.tree = new navClasses.tree(self.plugin, self.contentEl, navOrder, hiddenItems));
    for (const path of paths) tree.createItem(path);
    tree.render();
    new host.Setting(self.contentEl)
      .setName(propI18n.optionHideItemsInNavigation())
      .setDesc(propI18n.optionHideItemsInNavigationDesc())
      .addExtraButton((button) =>
        button
          .setIcon("lucide-rotate-ccw")
          .setTooltip(i18n.setting.hotkeys.tooltipRestoreDefault())
          .onClick(() => {
            self.tree.hiddenItems = [];
            self.tree.visibilityChangeCb?.([]);
            self.tree.render();
          }),
      );
    self.modalEl.createDiv("modal-button-container", (container) => {
      container.createEl("button", { text: i18n.dialogue.buttonDone() }).addEventListener("click", () => self.close());
    });
    return self;
  }
  inherit(PublishNavModal, Base);
  const proto = PublishNavModal.prototype;

  proto.onOrderChange = function (callback) {
    this.tree.orderChangeCb = callback;
    return this;
  };
  proto.onVisibilityChange = function (callback) {
    this.tree.visibilityChangeCb = callback;
    return this;
  };

  return PublishNavModal;
}
