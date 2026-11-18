// g12 clean-room: published-site navigation tree, outline ("On this page"),
// left nav view and the small password/tag modals. Item DOM comes from the
// inherited tree-item bases; hierarchy and behaviour are implemented here.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng12PublishDefaults, ng12PublishConfig } from "./n-g12-s09-core.js";
import { lastSegment, parentPath, withoutExtension, extensionOf, displayName, escapeLinkChars } from "./path.js";
import { formEncodePath } from "./text.js";

const ng12Lower = (s) => String(s).toLowerCase();

// Base publish tree row (manifest class zQ).
let ng12TreeItemClass = null;
export function ng12PublishTreeItem() {
  if (!ng12TreeItemClass) ng12TreeItemClass = ng12MakeTreeItemBase(env().$L);
  return ng12TreeItemClass;
}

// ---------------------------------------------------------------- tree items
// Shared row base: file/owner bookkeeping, active flag, path accessor.
function ng12MakeTreeItemBase(Base) {
  function Ng12TreeItem(owner, file) {
    Base.call(this);
    this.owner = owner;
    this.file = file;
    if (file && file.path != null) this.selfEl.setAttr("data-path", file.path);
  }
  inherit(Ng12TreeItem, Base);
  const p = Ng12TreeItem.prototype;
  p.setActive = function (active) {
    this.selfEl.toggleClass("mod-active", !!active);
  };
  p.getItemPath = function () {
    return this.file ? this.file.path : "";
  };
  return Ng12TreeItem;
}

let ng12FileItemClass = null;
export function ng12PublishFileItem() {
  if (ng12FileItemClass) return ng12FileItemClass;
  const Base = ng12MakeTreeItemBase(env().$L);

  class Ng12FileItem extends Base {
    render() {
      this.setClickable(true);
      const inner = this.innerEl;
      inner.empty();
      const name = this.file.name || "";
      const label = extensionOf(lastSegment(name)) === "md" ? withoutExtension(name) : name;
      const a = inner.createEl("a", {
        text: label,
        attr: { href: this.owner.publish.site.getPublicHref(this.getItemPath()) },
      });
      return this;
    }

    onSelfClick(e) {
      if (!e.defaultPrevented && this.owner && this.owner.onItemClick) {
        this.owner.onItemClick(this, e);
      }
    }
  }

  ng12FileItemClass = Ng12FileItem;
  return Ng12FileItem;
}

// Collapsible folder row built on the host collapsible-children mixin.
let ng12FolderItemClass = null;
export function ng12PublishFolderItem() {
  if (ng12FolderItemClass) return ng12FolderItemClass;
  const CollapsibleBase = env().ZL(env().$L);
  const ItemBase = ng12MakeTreeItemBase(CollapsibleBase);

  class Ng12FolderItem extends ItemBase {
    constructor(owner, file) {
      super(owner, file);
      this.children = [];
      this.collapsed = file.name !== "";
      this.setCollapsible(file.name !== "");
    }

    render() {
      this.setClickable(true);
      const inner = this.innerEl;
      inner.empty();
      inner.setText(this.file.name || "");
      // mount child rows
      if (this.childrenEl && this.children.length) {
        this.childrenEl.empty();
        for (const child of this.children) this.childrenEl.appendChild(child.el);
      }
      for (const child of this.children) if (child.render) child.render();
      return this;
    }

    onSelfClick(e) {
      if (e.defaultPrevented) return;
      this.toggleCollapsed();
    }
  }

  ng12FolderItemClass = Ng12FolderItem;
  return Ng12FolderItem;
}

// ------------------------------------------------------------------ tree view
let ng12PublishTreeClass = null;
export function ng12PublishTree() {
  if (ng12PublishTreeClass) return ng12PublishTreeClass;
  const FileItem = ng12PublishFileItem();
  const FolderItem = ng12PublishFolderItem();

  class Ng12PublishTree {
    constructor(containerEl, publish, onItemClick) {
      this.containerEl = containerEl;
      this.publish = publish;
      this.onItemClick = onItemClick || null;
      this.activeItem = null;
      this.rootFolder = null;
      this.children = [];
      this.childrenEl = containerEl;
    }

    onItemClickWrapper(item, e) {
      if (this.onItemClick) this.onItemClick(item, e);
    }

    renderFile(parent, file) {
      if (extensionOf(file.path || "") !== "md") return null;
      const item = new FileItem(this, file);
      item.parent = parent;
      return item;
    }

    renderFolder(parent, folder) {
      const item = new FolderItem(this, folder);
      item.parent = parent;
      for (const child of folder.children || []) {
        let rendered = null;
        if (child.type === "folder") rendered = this.renderFolder(item, child);
        else rendered = this.renderFile(item, child);
        if (rendered) item.children.push(rendered);
      }
      if (item.children.length === 0) return null;
      return item;
    }

    renderTree(root) {
      let folder = this.renderFolder(null, root);
      if (!folder) {
        this.rootFolder = null;
        return;
      }
      while (
        folder.children.length === 1 &&
        folder.children[0] &&
        folder.children[0].file &&
        folder.children[0].file.type === "folder"
      ) {
        folder = folder.children[0];
      }
      folder.setCollapsed(false, false);
      folder.setCollapsible(false);
      folder.selfEl.addClass("mod-root");
      this.rootFolder = folder;
      this.children = [folder];
      this.childrenEl.empty();
      this.childrenEl.appendChild(folder.el);
      folder.render();
    }

    setActiveItem(path) {
      if (this.activeItem) {
        this.activeItem.setActive(false);
        this.activeItem = null;
      }
      if (!path || !this.rootFolder) return;
      const segments = String(path).split("/");
      const chain = [];
      let current = this.rootFolder;
      for (const segment of segments) {
        if (!current || !current.children) return;
        const next = current.children.find((c) => c.file && c.file.name === segment);
        if (!next) return;
        chain.push(next);
        current = next;
      }
      if (!chain.length) return;
      const collapsedFolders = chain.filter((item) => item.file && item.file.type === "folder" && item.collapsed);
      for (let i = 0; i < collapsedFolders.length - 1; i++) {
        collapsedFolders[i].setCollapsed(false, false);
      }
      if (collapsedFolders.length) {
        collapsedFolders[collapsedFolders.length - 1].setCollapsed(false, true);
      }
      this.activeItem = chain[chain.length - 1];
      this.activeItem.setActive(true);
    }
  }

  ng12PublishTreeClass = Ng12PublishTree;
  return Ng12PublishTree;
}

// ------------------------------------------------------------------ outline
let ng12OutlineItemClass = null;
export function ng12PublishOutlineItem() {
  if (ng12OutlineItemClass) return ng12OutlineItemClass;
  const CollapsibleBase = env().ZL(env().$L);
  const ItemBase = ng12MakeTreeItemBase(CollapsibleBase);

  class Ng12OutlineItem extends ItemBase {
    constructor(owner, heading) {
      super(owner, heading);
      this.heading = heading;
      this.children = [];
      this.collapsed = false;
    }

    render() {
      const hasKids = this.children.length > 0;
      this.setCollapsible(!!(this.owner && this.owner.collapsible) && hasKids);
      this.setClickable(!!(this.owner && this.owner.onItemClick));
      const inner = this.innerEl;
      inner.empty();
      inner.setText(env().OT(this.heading));
      if (this.childrenEl && hasKids) {
        this.childrenEl.empty();
        for (const child of this.children) this.childrenEl.appendChild(child.el);
      }
      for (const child of this.children) if (child.render) child.render();
      return this;
    }

    onSelfClick(e) {
      if (e.defaultPrevented) return;
      if (this.owner && this.owner.onItemClick) this.owner.onItemClick(this.heading);
    }
  }

  ng12OutlineItemClass = Ng12OutlineItem;
  return Ng12OutlineItem;
}

let ng12OutlineTreeClass = null;
export function ng12PublishOutlineTree() {
  if (ng12OutlineTreeClass) return ng12OutlineTreeClass;
  const Item = ng12PublishOutlineItem();
  const Base = env().eI;

  class Ng12OutlineTree extends Base {
    constructor(containerEl, onItemClick) {
      super(containerEl);
      this.collapsible = true;
      this.highlighted = null;
      this.allItems = [];
      this.onItemClick = onItemClick || null;
    }

    renderOutline(headings) {
      this.children = [];
      this.allItems = [];
      this.highlighted = null;
      const stack = [];
      for (const heading of headings || []) {
        const level = heading.level != null ? heading.level : 1;
        while (stack.length && stack[stack.length - 1].heading.level >= level) stack.pop();
        const item = new Item(this, heading);
        item.parent = stack.length ? stack[stack.length - 1] : this;
        if (stack.length) stack[stack.length - 1].children.push(item);
        else this.children.push(item);
        stack.push(item);
        this.allItems.push(item);
      }
      this.render();
    }

    highlightLine(line) {
      let target = null;
      for (const item of this.allItems) {
        const pos = item.heading && item.heading.position;
        if (pos && pos.start && pos.start.line <= line) target = item;
        else break;
      }
      if (target === this.highlighted) return;
      if (this.highlighted) this.highlighted.setActive(false);
      this.highlighted = target;
      if (this.highlighted) this.highlighted.setActive(true);
    }
  }

  ng12OutlineTreeClass = Ng12OutlineTree;
  return Ng12OutlineTree;
}

// ------------------------------------------------------------------ s09 views
function ng12SectionHeader(icon, text) {
  const header = env().createDiv("list-item published-section-header");
  const iconEl = header.createSpan("published-section-header-icon");
  env().tv(iconEl, icon);
  header.createSpan({ cls: "published-section-header-text", text });
  return header;
}

let ng12OutlineViewClass = null;
export function ng12PublishOutlineView() {
  if (ng12OutlineViewClass) return ng12OutlineViewClass;
  const Tree = ng12PublishOutlineTree();
  const Component = env().jm;

  class Ng12OutlineView extends Component {
    constructor(publish, containerEl) {
      super();
      this.publish = publish;
      this.initialized = false;
      const outer = (this.outerContainerEl = containerEl.createDiv("outline-view-outer"));
      outer.appendChild(ng12SectionHeader("lucide-list", "On this page"));
      this.containerEl = outer.createDiv("outline-view");
      this.treeView = new Tree(this.containerEl, (heading) => this.onItemClick(heading));
      this.treeView.collapsible = false;
      publish.on("options-updated", () => this.updateOptions());
      publish.on("navigated", () => this.onNavigated());
      this.updateOptions();
    }

    get showOutline() {
      const site = this.publish.site;
      return !!(site && site.getConfig && site.getConfig("showOutline"));
    }

    updateOptions() {
      const show = this.showOutline && !env().Fc;
      if (this.publish.containerEl) {
        this.publish.containerEl.toggleClass("has-outline", show);
      }
      this.outerContainerEl.toggleVisibility(show);
      if (show) {
        env().gg(this.containerEl, () => this.onNavigated());
      }
    }

    onItemClick(heading) {
      const publish = this.publish;
      if (publish.render && publish.render.scrollToLoc) {
        publish.render.scrollToLoc(heading.position.start);
      }
      const site = publish.site;
      const path = publish.render && publish.render.currentFilepath;
      if (site && path != null && history && history.replaceState) {
        history.replaceState(null, null, site.getPublicHref(path) + "#" + env().NQ(env().IT(heading)));
      }
    }

    onNavigated() {
      if (!this.showOutline) return;
      this.treeView.children = [];
      this.treeView.allItems = [];
      if (!this.containerEl.isShown || this.containerEl.offsetParent === null) return;
      const site = this.publish.site;
      const render = this.publish.render;
      const path = render && render.currentFilepath;
      const entry = site && site.cache ? site.cache.getCache(path) : null;
      const headings = (entry && entry.headings) || [];
      if (headings.length) {
        this.outerContainerEl.setCssStyles({ display: "" });
        this.treeView.renderOutline(headings);
        this.treeView.highlightLine(0);
      } else {
        this.outerContainerEl.toggleVisibility(false);
      }
    }
  }

  ng12OutlineViewClass = Ng12OutlineView;
  return Ng12OutlineView;
}

let ng12NavViewClass = null;
export function ng12PublishNavView() {
  if (ng12NavViewClass) return ng12NavViewClass;
  const Tree = ng12PublishTree();
  const Component = env().jm;

  class Ng12NavView extends Component {
    constructor(publish, containerEl) {
      super();
      this.publish = publish;
      this.initialized = false;
      this.outerEl = containerEl.createDiv("nav-view-outer");
      this.containerEl = this.outerEl.createDiv("nav-view");
      this.treeView = new Tree(this.containerEl, (item, e) => this.onItemClick(item, e));
      publish.on("options-updated", () => this.updateOptions());
      publish.on("navigated", () => this.onNavigated());
      this._mediaQuery = null;
      this.updateOptions();
    }

    getOuterEl() {
      return this.outerEl;
    }

    get showNavigation() {
      const site = this.publish.site;
      return !!(site && site.getConfig && site.getConfig("showNavigation"));
    }

    updateOptions() {
      const show = this.showNavigation && !env().Fc;
      if (this.publish.containerEl) {
        this.publish.containerEl.toggleClass("has-navigation", show);
      }
      this.outerEl.toggleVisibility(show);
      if (!show) return;
      this.init();
      if (!this._mediaQuery && typeof matchMedia === "function") {
        try {
          this._mediaQuery = matchMedia("(max-width: 750px)");
          const handler = () => this.init(true);
          if (this._mediaQuery.addEventListener) this._mediaQuery.addEventListener("change", handler);
          else if (this._mediaQuery.addListener) this._mediaQuery.addListener(handler);
        } catch (e) {
          console.error(e);
        }
      }
    }

    init(force = false) {
      if (this.initialized) return;
      if (!this.showNavigation) return;
      if (!force) {
        const rect = this.containerEl.getBoundingClientRect();
        if (!(rect.right > 0)) return;
      }
      this.initialized = true;
      const site = this.publish.site;
      const top = { type: "folder", name: "", path: "", children: [] };
      const folders = { "": top };
      const hidden = new Set(ng12PublishConfig(site, "navigationHiddenItems") || []);
      for (const path of Object.keys((site && site.cache && site.cache.cache) || {})) {
        const parts = path.split("/");
        let prefix = "";
        let parent = top;
        for (let i = 0; i < parts.length - 1; i++) {
          const seg = parts[i];
          prefix = prefix ? prefix + "/" + seg : seg;
          const key = prefix + "/";
          if (!folders[key]) {
            const node = { type: "folder", name: seg, path: key, children: [], parent };
            folders[key] = node;
            parent.children.push(node);
          }
          parent = folders[key];
        }
        const name = parts[parts.length - 1];
        parent.children.push({ type: "file", name, path, parent });
      }
      // prune hidden paths (folders remove their whole subtree)
      const prune = (node) => {
        node.children = (node.children || []).filter((child) => {
          if (hidden.has(child.path)) return false;
          if (child.type === "folder") prune(child);
          return child.type === "folder" ? child.children.length > 0 : true;
        });
      };
      prune(top);
      // ordering ranks
      const ordering = ng12PublishConfig(site, "navigationOrdering") || [];
      const rank = {};
      ordering.forEach((p, i) => { rank[p] = i; });
      const cmp = (a, b) => {
        const ra = rank[a.path], rb = rank[b.path];
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1;
        if (rb != null) return 1;
        return env().ub(a.path, b.path);
      };
      const sortRec = (node) => {
        (node.children || []).sort(cmp);
        for (const c of node.children || []) if (c.type === "folder") sortRec(c);
      };
      sortRec(top);
      this.treeView.renderTree(top);
      const render = this.publish.render;
      if (render) this.treeView.setActiveItem(render.currentFilepath);
    }

    onNavigated() {
      const render = this.publish.render;
      if (render && this.treeView) this.treeView.setActiveItem(render.currentFilepath);
    }

    onItemClick(item, e) {
      if (e && e.preventDefault) e.preventDefault();
      if (this.publish.containerEl) this.publish.containerEl.removeClass("is-left-column-open");
      if (this.publish.navigate) this.publish.navigate(item.getItemPath(), "", e);
    }
  }

  ng12NavViewClass = Ng12NavView;
  return Ng12NavView;
}

// ------------------------------------------------------------------ modals
let ng12ModalBaseClass = null;
export function ng12PublishModalBase() {
  if (ng12ModalBaseClass) return ng12ModalBaseClass;

  class Ng12ModalBase {
    constructor(publish) {
      this.publish = publish;
      this.scope = new (env().Ng)();
      this.scope.register([], "Escape", () => {
        this.close();
        return false;
      });
      const containerEl = (this.containerEl = env().createDiv("modal-container"));
      this.modalBgEl = containerEl.createDiv("modal-bg");
      const modalEl = (this.modalEl = containerEl.createDiv("modal"));
      const closeButtonEl = (this.closeButtonEl = modalEl.createDiv(
        "modal-close-button mod-raised clickable-icon"
      ));
      env().tv(closeButtonEl, "lucide-x");
      closeButtonEl.addEventListener("click", () => this.close());
      this.titleEl = modalEl.createDiv("modal-title");
      this.contentEl = modalEl.createDiv("modal-content");
      this.modalBgEl.addEventListener("click", () => this.close());
    }

    open() {
      const keymap = this.publish.keymap || env().Bg.init();
      keymap.pushScope(this.scope);
      (env().activeDocument || document).body.appendChild(this.containerEl);
      this.onOpen();
    }

    close() {
      const keymap = this.publish.keymap || env().Bg.init();
      keymap.popScope(this.scope);
      this.containerEl.remove();
      this.onClose();
    }

    onOpen() {}
    onClose() {}
  }

  ng12ModalBaseClass = Ng12ModalBase;
  return Ng12ModalBase;
}

let ng12PasswordModalClass = null;
export function ng12PublishPasswordModal() {
  if (ng12PasswordModalClass) return ng12PasswordModalClass;
  const Base = ng12PublishModalBase();

  class Ng12PasswordModal extends Base {
    constructor(publish, cb) {
      super(publish);
      this.done = false;
      this.cb = cb;
      this.passwordEl = null;
      this.passwordIncorrectMsg = null;
      this.modalEl.addClass("mod-password-required");
      this.titleEl.setText("Protected site");
      this.closeButtonEl.hide();
    }

    close() {
      if (!this.done) return;
      super.close();
    }

    onOpen() {
      this.showPasswordRequired();
    }

    showPasswordRequired() {
      const content = this.contentEl;
      content.empty();
      const err = content.createDiv({ cls: "message mod-error", text: "Password is incorrect, please try again." });
      err.hide();
      this.passwordIncorrectMsg = err;
      const form = content.createDiv("password-form");
      this.passwordEl = form.createEl("input", {
        attr: { type: "password", placeholder: "Enter password..." },
      });
      this.passwordEl.addEventListener("keydown", (e) => {
        if (e.isComposing) return;
        if (e.key === "Enter") this.tryUnlockSite();
      });
      const btnRow = content.createDiv("modal-button-container");
      const confirm = btnRow.createEl("button", { cls: "mod-cta", text: "Confirm" });
      confirm.addEventListener("click", () => this.tryUnlockSite());
    }

    async tryUnlockSite() {
      const site = this.publish.site;
      try {
        const res = await env().ajaxPromise({
          method: "POST",
          url: site.host + "/pw",
          data: JSON.stringify({ id: site.id, pw: this.passwordEl.value }),
          headers: { "Content-Type": "application/json" },
          withCredentials: true,
        });
        try {
          const parsed = JSON.parse(res);
          if (parsed && parsed.hpw !== undefined) {
            site.hpw = parsed.hpw;
            try {
              localStorage.setItem(site.id, parsed.hpw);
            } catch (e) {}
          }
        } catch (e) {
          console.error(e);
        }
        this.done = true;
        if (this.cb) this.cb();
        this.showPasswordCorrect();
      } catch (e) {
        this.passwordIncorrectMsg.show();
      }
    }

    showPasswordCorrect() {
      this.titleEl.setText("Site unlocked");
      const content = this.contentEl;
      content.empty();
      content.createDiv({ cls: "message mod-success", text: "Thank you, the password is correct." });
      content.createDiv({
        cls: "message mod-muted",
        text: "The password will be remembered during the following sessions for your convenience.",
      });
      const btnRow = content.createDiv("modal-button-container");
      const enter = btnRow.createEl("button", { cls: "mod-cta", text: "Enter" });
      enter.addEventListener("click", () => this.close());
    }
  }

  ng12PasswordModalClass = Ng12PasswordModal;
  return Ng12PasswordModal;
}

let ng12TagModalClass = null;
export function ng12PublishTagModal() {
  if (ng12TagModalClass) return ng12TagModalClass;
  const Base = ng12PublishModalBase();

  class Ng12TagModal extends Base {
    constructor(publish, tag) {
      super(publish);
      this.tag = tag;
      this.titleEl.setText("Pages with tag " + tag);
    }

    onOpen() {
      const site = this.publish.site;
      const content = this.contentEl;
      content.empty();
      const tag = this.tag;
      const re = new RegExp("^" + escapeLinkChars(tag) + "(\\/|$)", "i");
      const matches = [];
      for (const path of Object.keys((site && site.cache && site.cache.cache) || {})) {
        const entry = site.cache.cache[path];
        const tags = env().DT(entry) || [];
        if (tags.some((t) => re.test(String(t)))) matches.push(path);
      }
      if (!matches.length) {
        content.createDiv({ cls: "files-with-tag-item", text: "There are no pages that contain this tag." });
        return;
      }
      const list = content.createEl("ol", { cls: "files-with-tag-container" });
      for (const path of matches) {
        const li = list.createEl("li", { cls: "files-with-tag-item" });
        const a = li.createEl("a", {
          cls: "internal-link",
          text: displayName(path),
          attr: { href: site.getPublicHref(path) },
        });
        a.addEventListener("click", (e) => {
          e.preventDefault();
          this.close();
          if (this.publish.navigate) this.publish.navigate(path, "");
        });
      }
    }
  }

  ng12TagModalClass = Ng12TagModal;
  return Ng12TagModal;
}
