// s20: the file picker used by the "Orphaned attachments" dialog.
//   nI  FileTree: root container, folders{} / files{} lookup, sorting, checked-file collection
//   iI  FileTreeItem: one file row (checkbox, icon, title, checked state)
//   rI  FolderTreeItem: collapsible folder row with aggregate checked state
//   oI  row ordering: folders first, then by name
//   aI  AttachmentsGallery: grid of embed previews, one per file
//   sI  GalleryItem: embed preview + checkbox for one file
//   CI  UrlAttachmentItem: external-link row (checkbox + icon)
//   tI  OrphanedAttachmentsModal: tree/gallery switcher dialog
//
// The classes are created by the manifest "classes" factories and registered in
// `s20ft` so siblings can find each other regardless of factory order.

import { inherit } from "./inherit.js";
import { lastSegment, parentPath } from "./path.js";
import { setDynamicTooltip } from "./tooltip.js";
import { ellipsize } from "./text.js";

const s20ft = {};

/** Folder rows sort before file rows; inside a group rows order by name. */
export function s20TreeItemCompare(a, b) {
  const aFolder = a instanceof s20ft.folder;
  const bFolder = b instanceof s20ft.folder;
  if (aFolder && !bFolder) return -1;
  if (bFolder && !aFolder) return 1;
  return a.name.localeCompare(b.name);
}

// =====================================================================================================================
// File tree rows
// =====================================================================================================================

/** One file row: checkbox + icon + title; clicking toggles the checked state up the parent chain. */
export function defineS20FileTreeItem(host) {
  const LeafBase = host.s20DomLeafItem;
  function FileTreeItem(file) {
    const self = LeafBase.call(this) || this;
    self.checked = true;
    self.file = file;
    self.path = file.path;
    self.name = file.name;
    self.setClickable(true);
    self.selfEl.addClass("mod-file");
    self.innerEl.addClass("file-tree-item");
    self.checkboxEl = self.innerEl.createEl("input", { cls: "file-tree-item-checkbox", type: "checkbox" });
    self.checkboxEl.addEventListener("click", (event) => {
      event.preventDefault();
      self.setChecked(!self.checked);
      self.updateCheckedRecursive();
    });
    host.setIcon(self.innerEl.createDiv("file-tree-item-icon"), "lucide-file");
    self.innerEl.createDiv({ cls: "file-tree-item-title", text: self.name });
    self.updateChecked();
    return self;
  }
  inherit(FileTreeItem, LeafBase);
  FileTreeItem.prototype.onSelfClick = function (event) {
    this.setChecked(!this.checked);
    this.updateCheckedRecursive();
  };
  FileTreeItem.prototype.setChecked = function (checked) {
    if (this.checked === checked) return;
    this.checked = checked;
    this.updateChecked();
  };
  FileTreeItem.prototype.updateChecked = function () {
    this.checkboxEl.checked = this.checked;
    this.selfEl.toggleClass("is-selected", this.checked);
  };
  FileTreeItem.prototype.updateCheckedRecursive = function () {
    for (let parent = this.parent; parent;) {
      parent.updateChecked();
      parent = parent.parent;
    }
  };
  s20ft.fileItem = FileTreeItem;
  return FileTreeItem;
}

/** A folder row: collapsible, its checkbox reflects whether all/any descendants are checked. */
export function defineS20FolderTreeItem(host) {
  const ChildrenBase = host.s20DomChildrenItem;
  function FolderTreeItem(path) {
    const self = ChildrenBase.call(this) || this;
    self.children = [];
    self.path = path;
    self.name = lastSegment(path);
    self.setClickable(true);
    self.setCollapsible(true);
    self.selfEl.addClass("mod-folder");
    self.innerEl.addClass("file-tree-item");
    self.checkboxEl = self.innerEl.createEl("input", { cls: "file-tree-item-checkbox", type: "checkbox" });
    self.checkboxEl.addEventListener("click", (event) => {
      event.preventDefault();
      self.onSelfClick(event);
    });
    host.setIcon(self.innerEl.createDiv("file-tree-item-icon"), "lucide-folder");
    self.innerEl.createDiv({ cls: "file-tree-item-title", text: self.name });
    return self;
  }
  inherit(FolderTreeItem, ChildrenBase);
  FolderTreeItem.prototype.getChecked = function () {
    let count = 0;
    let checked = 0;
    for (const child of this.children) {
      if (child instanceof s20ft.fileItem) {
        count++;
        if (child.checked) checked++;
      } else if (child instanceof FolderTreeItem) {
        const inner = child.getChecked();
        count += inner.count;
        checked += inner.checked;
      }
    }
    return { count, checked };
  };
  FolderTreeItem.prototype.onSelfClick = function (event) {
    const stats = this.getChecked();
    const count = stats.count;
    const checked = stats.checked;
    if (count === 0) return;
    const next = checked < count;
    for (const child of this.children) child.setChecked(next);
    this.updateChecked();
    this.updateCheckedRecursive();
  };
  FolderTreeItem.prototype.setChecked = function (checked) {
    for (const child of this.children) child.setChecked(checked);
    this.updateChecked();
  };
  FolderTreeItem.prototype.updateChecked = function () {
    const stats = this.getChecked();
    const count = stats.count;
    const checked = stats.checked;
    const all = count > 0 && checked === count;
    this.checkboxEl.checked = all;
    this.checkboxEl.indeterminate = !all && checked > 0;
    this.selfEl.toggleClass("is-selected", all);
  };
  FolderTreeItem.prototype.updateCheckedRecursive = function () {
    for (let parent = this.parent; parent;) {
      parent.updateChecked();
      parent = parent.parent;
    }
  };
  FolderTreeItem.prototype.render = function () {
    this.children.sort(s20TreeItemCompare);
    ChildrenBase.prototype.render.call(this);
    this.updateChecked();
  };
  s20ft.folder = FolderTreeItem;
  return FolderTreeItem;
}

/** The tree root: builds the folder hierarchy for a flat file list and reports checked files. */
export function defineS20FileTree(host) {
  const ContainerBase = host.s20DomContainer;
  function FileTree(parentEl) {
    const el = parentEl.createDiv("file-tree");
    const self = ContainerBase.call(this, el) || this;
    self.folders = {};
    self.files = {};
    self.el = el;
    return self;
  }
  inherit(FileTree, ContainerBase);
  FileTree.prototype.addFile = function (file) {
    const item = new s20ft.fileItem(file);
    this.files[file.path] = item;
    this.addChild(item);
  };
  FileTree.prototype.addChild = function (item) {
    const parent = parentPath(item.path);
    if (parent) {
      let folder = this.folders[parent];
      if (!folder) {
        folder = this.folders[parent] = new s20ft.folder(parent);
        this.addChild(folder);
      }
      folder.children.push(item);
      item.parent = folder;
    } else {
      this.children.push(item);
    }
  };
  FileTree.prototype.render = function () {
    this.children.sort(s20TreeItemCompare);
    ContainerBase.prototype.render.call(this);
  };
  FileTree.prototype.getCheckedFiles = function () {
    const files = [];
    for (const path in this.files) {
      if (Object.hasOwn(this.files, path)) {
        const item = this.files[path];
        if (item.checked) files.push(item.file);
      }
    }
    return files;
  };
  s20ft.fileTree = FileTree;
  return FileTree;
}

// =====================================================================================================================
// Gallery view
// =====================================================================================================================

/** One embed preview with a checkbox, bound to a file-tree item. */
export function defineS20GalleryItem(host) {
  function GalleryItem(app, fileItem, component) {
    const self = this;
    self.fileItem = fileItem;
    self.el = createDiv("download-attachment-item");
    host.setTooltip(self.el, fileItem.name);
    self.el.addEventListener("click", (event) => {
      if (event.button !== 0 || event.defaultPrevented) return;
      self.fileItem.setChecked(!self.fileItem.checked);
      self.fileItem.updateCheckedRecursive();
      self.updateChecked();
    });
    self.checkboxEl = self.el.createEl("input", { type: "checkbox" });
    self.checkboxEl.addEventListener("click", (event) => event.preventDefault());
    const embed = host.EmbedLoader.load({
      app,
      linktext: fileItem.file.path,
      sourcePath: "",
      containerEl: self.el.createDiv("download-attachment-embed"),
      displayMode: true,
      depth: 0,
    });
    if (embed) {
      component.addChild(embed);
      embed.loadFile();
    }
    self.updateChecked();
    return self;
  }
  GalleryItem.prototype.updateChecked = function () {
    this.checkboxEl.checked = this.fileItem.checked;
    this.el.toggleClass("is-selected", this.fileItem.checked);
  };
  s20ft.galleryItem = GalleryItem;
  return GalleryItem;
}

/** The gallery grid: one GalleryItem per file in the tree. */
export function defineS20AttachmentsGallery() {
  function AttachmentsGallery(app, containerEl, fileTree, component) {
    this.items = [];
    this.el = containerEl.createDiv("attachments-gallery");
    for (const path in fileTree.files) {
      if (Object.hasOwn(fileTree.files, path)) {
        const file = fileTree.files[path];
        const item = new s20ft.galleryItem(app, file, component);
        this.items.push(item);
        this.el.appendChild(item.el);
      }
    }
  }
  AttachmentsGallery.prototype.refresh = function () {
    for (const item of this.items) item.updateChecked();
  };
  s20ft.gallery = AttachmentsGallery;
  return AttachmentsGallery;
}

/** An external-URL attachment row: checkbox + favicon + dynamic tooltip. */
export function defineS20UrlAttachmentItem(host) {
  function UrlAttachmentItem(url) {
    const self = this;
    self.name = "";
    self.url = url;
    self.el = createDiv("download-attachment-item");
    self.el.addEventListener("click", (event) => {
      if (event.button !== 0 || event.defaultPrevented) return;
      self.setChecked(!self.checked);
    });
    const checkbox = (self.checkboxEl = self.el.createEl("input", { type: "checkbox" }));
    checkbox.addEventListener("change", () => self.setChecked(checkbox.checked));
    self.setChecked(true);
    setDynamicTooltip(self.el, () => {
      let text = ellipsize(self.url, 100);
      if (self.name) text = self.name + "\n" + text;
      return text;
    });
    self.el.createEl("img", { attr: { src: url } });
    return self;
  }
  UrlAttachmentItem.prototype.setChecked = function (checked) {
    if (this.checked === checked) return;
    this.checked = checked;
    this.checkboxEl.checked = checked;
    this.el.toggleClass("is-selected", checked);
  };
  return UrlAttachmentItem;
}

// =====================================================================================================================
// The dialog
// =====================================================================================================================

/** "Orphaned attachments" modal: pick which unattached files to delete, as a tree or a gallery. */
export function defineS20OrphanAttachmentsModal(host) {
  function OrphanAttachmentsModal(app, files) {
    const self = host.s20PromptModal.call(this, app) || this;
    self.component = new host.Component();
    self.viewMode = "tree";
    self.modalEl.addClass("mod-scrollable-content", "mod-file-browser");
    self.setTitle(host.t.dialogue.orphanAttachmentsTitle());
    self.setCta("mod-warning", host.t.dialogue.buttonDelete());
    self.contentEl.createEl("p", {
      cls: "file-browser-description",
      text: host.t.dialogue.orphanAttachmentsDesc({ count: files.length }),
    });
    const toolbar = self.contentEl.createDiv("modal-view-options-toolbar");
    self.treeButtonEl = toolbar.createDiv("clickable-icon modal-view-option");
    host.setIcon(self.treeButtonEl, "lucide-list");
    host.setTooltip(self.treeButtonEl, host.t.dialogue.tooltipFileTree());
    self.treeButtonEl.addEventListener("click", () => self.setViewMode("tree"));
    self.galleryButtonEl = toolbar.createDiv("clickable-icon modal-view-option");
    host.setIcon(self.galleryButtonEl, "lucide-image");
    host.setTooltip(self.galleryButtonEl, host.t.dialogue.tooltipGallery());
    self.galleryButtonEl.addEventListener("click", () => self.setViewMode("gallery"));
    const views = self.contentEl.createDiv("file-browser-views");
    self.fileTree = new s20ft.fileTree(views);
    for (const file of files) self.fileTree.addFile(file);
    self.fileTree.render();
    self.gallery = new s20ft.gallery(app, views, self.fileTree, self.component);
    self.setViewMode("tree");
    return self;
  }
  inherit(OrphanAttachmentsModal, host.s20PromptModal);
  OrphanAttachmentsModal.prototype.onClickOutside = function (event) {};
  OrphanAttachmentsModal.prototype.setViewMode = function (mode) {
    this.viewMode = mode;
    this.treeButtonEl.toggleClass("is-active", mode === "tree");
    this.galleryButtonEl.toggleClass("is-active", mode === "gallery");
    this.fileTree.el.toggle(mode === "tree");
    this.gallery.el.toggle(mode === "gallery");
    if (mode === "gallery") this.gallery.refresh();
  };
  OrphanAttachmentsModal.prototype.getCheckedFiles = function () {
    return this.fileTree.getCheckedFiles();
  };
  OrphanAttachmentsModal.prototype.onOpen = function () {
    host.s20PromptModal.prototype.onOpen.call(this);
    this.component.load();
  };
  OrphanAttachmentsModal.prototype.onClose = function () {
    host.s20PromptModal.prototype.onClose.call(this);
    this.component.unload();
  };
  return OrphanAttachmentsModal;
}
