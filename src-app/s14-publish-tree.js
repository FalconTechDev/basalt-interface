// Publish-dialog navigation tree (s14).
//
//   T7  PublishNavItem   — custom-nav tree item with hide-in-navigation context menu
//   A7  PublishFolderItem — folder node (mod-folder, collapsible)
//   D7  PublishFileItem   — file leaf (mod-file title row)
//   P7  PublishNavTree    — tree-list container: folders/files indexes, nav ordering,
//                          hidden-item filtering, drag reorder via Gc
//   x7  PublishNavModal   — modal hosting the tree + navigation/hide settings
//   V7  ExcludeFoldersModal — base modal for "exclude folders" pickers (sync etc.)
//
// All bundle names are read lazily through env() at factory-call time, which is the
// original declarator position, so ordering matches the inherited code exactly.
import { env } from "./env.js";

// T7 — base custom-navigation item (was `T7=function(e){...}(JL)`).
export function s14PublishNavItem() {
  const e = env();
  class PublishNavItem extends e.JL {
    constructor(tree, path) {
      super();
      this.hidden = false;
      this.tree = tree;
      this.name = e.nu(path);
      this.path = path;
      this.el.addClass("mod-custom-nav");
      this.selfEl.addEventListener("contextmenu", this.onContextMenu.bind(this));
    }

    onContextMenu(ev) {
      const item = this;
      new e.Ug()
        .addItem((menuItem) =>
          menuItem
            .setTitle(e.gm.plugins.publish.optionHideInNavigation())
            .setChecked(item.hidden)
            .onClick(() => {
              item.hidden = !item.hidden;
              const hiddenItems = item.tree.hiddenItems;
              if (item.hidden) hiddenItems.push(item.path);
              else hiddenItems.remove(item.path);
              item.tree.visibilityChangeCb?.(hiddenItems);
              item.render();
            })
        )
        .showAtMouseEvent(ev);
    }

    render() {
      this.el.toggleClass("hidden", this.hidden);
      if (!this.hidden || this.tree.showHidden) {
        this.el.show();
        super.render();
        const parent = this.parent;
        const refEl = parent?.childrenEl ?? this.tree.childrenEl;
        e.Gc(
          this.selfEl,
          this.el,
          refEl,
          10,
          () => {},
          (index) => {
            const siblings = parent?.children ?? this.tree.children;
            siblings.remove(this);
            siblings.splice(index, 0, this);
            this.tree.rebuildNavOrder();
          }
        );
      } else {
        this.el.hide();
      }
    }
  }
  return PublishNavItem;
}

// A7 — folder node (was `A7=function(e){...}(T7)`).
export function s14PublishFolderItem() {
  const e = env();
  class PublishFolderItem extends e.T7 {
    constructor(tree, path) {
      super(tree, path);
      this.type = "folder";
      this.children = [];
      this.selfEl.addClass("mod-folder");
      this.setCollapsible(true);
      this.setClickable(true);
      this.setCollapsed(true, false);
      this.innerEl.createDiv({ cls: "file-tree-item-title", text: this.name });
    }

    onSelfClick() {
      this.toggleCollapsed(true);
    }
  }
  return PublishFolderItem;
}

// D7 — file leaf (was `D7=function(e){...}(T7)`).
export function s14PublishFileItem() {
  const e = env();
  class PublishFileItem extends e.T7 {
    constructor(tree, file) {
      super(tree, file);
      this.type = "file";
      const title = e.nu(file);
      this.innerEl.createDiv({ cls: "tree-item-title", text: title });
    }

    render() {
      super.render();
      this.setCollapsible(false);
      this.setClickable(true);
    }
  }
  return PublishFileItem;
}

// P7 — the navigation tree itself (was `P7=function(e){...}(eI)`).
export function s14PublishNavTree() {
  const e = env();
  class PublishNavTree extends e.eI {
    constructor(publish, containerEl, navOrder, hiddenItems) {
      super(containerEl);
      this.children = [];
      this.showHidden = false;
      this.hiddenItems = hiddenItems;
      this.navOrder = navOrder;
      this.folders = {};
      this.files = {};
      this.publish = publish;
      const listContainer = containerEl.createDiv("tree-list-container");
      listContainer.createDiv("tree-list-header", (header) => {
        header.createDiv({ cls: "tree-list-title", text: e.gm.plugins.publish.labelNavigationPreview() });
        header.createEl("label", { cls: "tree-list-action mod-checkbox" }, (label) => {
          label.createEl("input", { attr: { tabindex: -1 }, type: "checkbox" }).addEventListener("click", () => {
            this.setShowHidden(!this.showHidden);
          });
          label.appendText(e.gm.plugins.publish.optionShowHiddenItems());
        });
      });
      this.childrenEl = listContainer.createDiv("tree-list");
    }

    setShowHidden(show) {
      this.showHidden = show;
      this.render();
    }

    addChild(item) {
      const parentPath = e.iu(item.path);
      if (parentPath) {
        const folders = this.folders;
        let folder = folders[parentPath];
        if (!folder) {
          folder = folders[parentPath] = new e.A7(this, parentPath);
          this.addChild(folder);
        }
        folder.children.push(item);
        item.parent = folder;
      } else {
        this.addRoot(item);
      }
    }

    createItem(file) {
      const item = new e.D7(this, file);
      this.files[file] = item;
      this.addChild(item);
      return item;
    }

    rebuildNavOrder() {
      const order = [];
      const walk = (items) => {
        const copy = items.slice();
        e.BQ(copy, {}, false);
        let changed = false;
        for (let i = 0; i < items.length; i++) {
          if (copy[i].path !== items[i].path) {
            changed = true;
            break;
          }
        }
        for (const item of items) {
          if (changed) order.push(item.path);
          if (item instanceof e.A7) walk(item.children);
        }
      };
      walk(this.children);
      this.navOrder = order;
      this.orderChangeCb?.(this.navOrder);
      return order;
    }

    render() {
      const positions = {};
      for (let i = 0; i < this.navOrder.length; i++) positions[this.navOrder[i]] = i;
      e.BQ(this.children, positions);
      const hidden = new Set(this.hiddenItems);
      const applyHidden = (items) => {
        for (const item of items) {
          item.hidden = hidden.has(item.path);
          if (item.type === "folder") applyHidden(item.children);
        }
      };
      applyHidden(this.children);
      super.render();
    }
  }
  return PublishNavTree;
}

// x7 — navigation preview modal (was `x7=function(e){...}(tb)`).
// Args: (appOrPlugin, plugin, files, navOrder, hiddenItems) — first arg goes to the Modal base.
export function s14PublishNavModal() {
  const e = env();
  class PublishNavModal extends e.tb {
    constructor(app, plugin, files, navOrder, hiddenItems) {
      super(app);
      this.plugin = plugin;
      this.modalEl.addClass("mod-scrollable-content");
      this.titleEl.setText(e.gm.plugins.publish.labelNavigationModalTitle());
      new e.zk(this.contentEl)
        .setName(e.gm.plugins.publish.optionNavigationOrder())
        .setDesc(e.gm.plugins.publish.labelNavigationModalDesc())
        .addExtraButton((button) =>
          button
            .setIcon("lucide-rotate-ccw")
            .setTooltip(e.gm.setting.hotkeys.tooltipRestoreDefault())
            .onClick(() => {
              this.tree.navOrder = [];
              this.tree.orderChangeCb?.([]);
              this.tree.render();
            })
        );
      const tree = (this.tree = new e.P7(this.plugin, this.contentEl, navOrder, hiddenItems));
      for (const file of files) tree.createItem(file);
      tree.render();
      new e.zk(this.contentEl)
        .setName(e.gm.plugins.publish.optionHideItemsInNavigation())
        .setDesc(e.gm.plugins.publish.optionHideItemsInNavigationDesc())
        .addExtraButton((button) =>
          button
            .setIcon("lucide-rotate-ccw")
            .setTooltip(e.gm.setting.hotkeys.tooltipRestoreDefault())
            .onClick(() => {
              this.tree.hiddenItems = [];
              this.tree.visibilityChangeCb?.([]);
              this.tree.render();
            })
        );
      this.modalEl.createDiv("modal-button-container", (container) => {
        container.createEl("button", { text: e.gm.dialogue.buttonDone() }).addEventListener("click", () => this.close());
      });
    }

    onOrderChange(cb) {
      this.tree.orderChangeCb = cb;
      return this;
    }

    onVisibilityChange(cb) {
      this.tree.visibilityChangeCb = cb;
      return this;
    }
  }
  return PublishNavModal;
}

// V7 — exclude-folders picker modal base (was `V7=function(e){...}(nb)`).
// Subclasses implement getPaths()/setPaths(); labelI18nKey selects the title string.
export function s14ExcludeFoldersModal() {
  const e = env();
  class ExcludeFoldersModal extends e.nb {
    constructor(app, name, desc, labelI18nKey) {
      super(app);
      this.settingTab = null;
      this.displayEl = null;
      this.labelI18nKey = labelI18nKey;
      const content = this.contentEl;
      this.displayEl = content.createEl("p");
      new e.zk(content)
        .setName(name)
        .setDesc(desc)
        .addText((setting) => {
          const inputEl = setting.inputEl;
          const suggester = new e.PI(app, inputEl, (folder) => !this.getPaths().contains(folder.path), true);
          const submit = async () => {
            const path = e.cu(inputEl.value);
            if (path) {
              inputEl.value = "";
              const paths = this.getPaths();
              paths.push(path);
              await this.setPaths(paths);
            }
          };
          suggester.onSelect(submit);
          inputEl.addEventListener("keydown", (ev) => {
            if (!ev.isComposing && ev.key === "Enter") submit();
          });
        });
      this.addButton("", e.gm.dialogue.buttonDone(), this.close.bind(this));
    }

    onOpen() {
      super.onOpen();
      this.updateDisplay();
    }

    onClose() {
      this.settingTab.display();
    }

    async updateDisplay() {
      const e = env();
      const paths = this.getPaths();
      const displayEl = this.displayEl;
      displayEl.empty();
      const folderCount = e.gm.nouns.folderWithCount({ count: paths.length });
      displayEl.setText(e.gm(this.labelI18nKey, { folders: folderCount }));
      for (const path of paths) {
        const row = displayEl.createDiv("sync-exclude-folder");
        const removeBtn = row.createDiv("sync-exclude-folder-remove clickable-icon");
        e.tv(removeBtn, "lucide-x");
        e.Mv(removeBtn, e.gm.plugins.sync.tooltipRemoveExcludedFolder());
        removeBtn.addEventListener("click", async () => {
          const next = this.getPaths();
          next.remove(path);
          await this.setPaths(next);
          this.updateDisplay();
        });
        row.createSpan("clickable-icon", (icon) => e.tv(icon, "lucide-folder-open"));
        row.createDiv({ cls: "sync-exclude-folder-name" }, (nameEl) => nameEl.createSpan({ text: path }));
      }
    }
  }
  return ExcludeFoldersModal;
}
