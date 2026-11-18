// g12 clean-room: PublishChangesModal sections and the auxiliary modals
// (share/compare/confirm/folder pickers/path suggest). Sections are plain
// view objects appended to the host modal's contentEl; all network access
// goes through the plugin's api* methods and degrades to inline messages.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { account, acctRequest, acctDeletePublishSite, acctInvitePublishShare, acctRemovePublishShare, acctListPublishSites, acctCreatePublishSite, acctListPublishShares, acctAcceptPublishShare } from "./account.js";
import { ng12PublishDefaults } from "./n-g12-s09-core.js";
import { ng12PublishUrl, ng12PublishAssets, ng12PublishRequestErrorClass } from "./n-g12-s15-core.js";
import { lastSegment, baseName, withoutExtension, extensionOf, withoutMd, displayName } from "./path.js";
import { formEncodePath } from "./text.js";

const ng12mT = (key, fallback, ...args) => {
  try {
    const tree = env().gm && env().gm.plugins && env().gm.plugins.publish;
    const fn = tree && tree[key];
    if (typeof fn === "function") return fn(...args);
    if (typeof fn === "string") return fn;
  } catch (e) {}
  return fallback;
};

// ------------------------------------------------------------------ section base
let ng12mSectionClass = null;
export function ng12mPublishSection(host) {
  if (ng12mSectionClass) return ng12mSectionClass;

  class Ng12Section {
    constructor(parentModal) {
      this.parentModal = parentModal;
      this.title = "";
      this.el = parentModal.contentEl.createDiv("publish-section");
      this.el.hide();
    }

    show() {
      this.el.show();
    }

    hide() {
      this.el.hide();
    }
  }

  ng12mSectionClass = Ng12Section;
  return Ng12Section;
}

const ng12mPara = (el, cls, text) => el.createDiv({ cls: cls || "paragraph", text });

// ------------------------------------------------------------------ offline
let ng12mOfflineClass = null;
export function ng12mPublishOfflineSection(host) {
  if (ng12mOfflineClass) return ng12mOfflineClass;
  const Base = ng12mPublishSection(host);

  class Ng12Offline extends Base {
    constructor(parentModal) {
      super(parentModal);
      ng12mPara(this.el, "publish-offline-message", ng12mT("labelNoInternetAccess", "No internet access."));
    }

    async show() {
      this.el.show();
    }
  }

  ng12mOfflineClass = Ng12Offline;
  return Ng12Offline;
}

// ------------------------------------------------------------------ login
let ng12mLoginClass = null;
export function ng12mPublishLoginSection(host) {
  if (ng12mLoginClass) return ng12mLoginClass;
  const Base = ng12mPublishSection(host);

  class Ng12Login extends Base {
    constructor(parentModal) {
      super(parentModal);
      ng12mPara(this.el, null, ng12mT("labelPublishServiceDescription", "Publish your notes to the web."));
      ng12mPara(this.el, null, ng12mT("labelPleaseLogin", "Please log in to continue."));
      const row = this.el.createDiv("modal-button-container");
      const signup = row.createEl("button", { cls: "mod-cta", text: ng12mT("linkSignUpNow", "Sign up now") });
      signup.addEventListener("click", () => window.open("https://github.com/FalconTechDev/basalt", "_blank"));
      const login = row.createEl("button", { text: ng12mT("buttonLogin", "Log in") });
      login.addEventListener("click", () => {
        const modal = this.parentModal;
        modal.close();
        const LoginModal = env().R7;
        new LoginModal(this.parentModal.app, () => {
          const m2 = this.parentModal.plugin.openModal(true);
          m2.open();
        }).open();
      });
    }

    async show() {
      this.el.show();
    }
  }

  ng12mLoginClass = Ng12Login;
  return Ng12Login;
}

// ------------------------------------------------------------------ manage sites
let ng12mManageClass = null;
export function ng12mPublishManageSitesSection(host) {
  if (ng12mManageClass) return ng12mManageClass;
  const Base = ng12mPublishSection(host);
  const RequestError = ng12PublishRequestErrorClass(host);

  class Ng12ManageSites extends Base {
    constructor(parentModal) {
      super(parentModal);
      this.slugInputEl = null;
      this.sites = [];
      this.shared = [];
      this.limit = 0;
      this.slugs = {};
    }

    async show() {
      this.el.empty();
      this.el.show();
      let data;
      try {
        data = await acctListPublishSites(account.token);
      } catch (e) {
        this.parentModal.handleError(e);
        return;
      }
      this.sites = (data && data.sites) || [];
      this.shared = (data && data.shared) || [];
      this.limit = data && data.limit != null ? data.limit : 0;
      try {
        const ids = this.sites.map((s) => s.id || s.uid).concat(this.shared.map((s) => s.id || s.uid));
        this.slugs = (await this.parentModal.plugin.apiGetSlugs(ids)) || {};
      } catch (e) {
        this.slugs = {};
      }
      this.render();
    }

    render() {
      const el = this.el;
      el.empty();
      el.createDiv({ cls: "setting-item-name", text: ng12mT("labelYourSites", "Your sites") });
      const list = el.createDiv("site-list-container");
      const plugin = this.parentModal.plugin;
      const modal = this.parentModal;

      const rowFor = (site, isShared) => {
        const row = list.createDiv("site-list-item");
        const slug = this.slugs[site.id || site.uid] || site.id || site.uid;
        row.createSpan({ cls: "site-slug", text: slug });
        const choose = row.createEl("button", { cls: "mod-cta", text: ng12mT("buttonChoose", "Choose") });
        choose.addEventListener("click", async () => {
          await plugin.setup(site.id || site.uid, site.host);
          modal.openReviewChanges();
        });
        if (!isShared) {
          const edit = row.createDiv({ cls: "clickable-icon", attr: { role: "button" } });
          env().tv(edit, "lucide-edit");
          env().Mv(edit, "Edit");
          edit.addEventListener("click", () => modal.editSlug(site, slug));
          const del = row.createDiv({ cls: "clickable-icon", attr: { role: "button" } });
          env().tv(del, "lucide-trash-2");
          env().Mv(del, "Delete");
          del.addEventListener("click", async () => {
            try {
              await acctDeletePublishSite(account.token, site.id || site.uid);
              await modal.deleteSite(site.id || site.uid);
            } catch (e) {
              modal.handleError(e);
            }
          });
        } else {
          const leave = row.createDiv({ cls: "clickable-icon", attr: { role: "button" } });
          env().tv(leave, "lucide-log-out");
          env().Mv(leave, "Leave");
          leave.addEventListener("click", async () => {
            try {
              await acctRemovePublishShare(account.token, site.id || site.uid, site.share_uid || site.uid);
              await modal.deleteSiteShare(site.id || site.uid, site.share_uid || site.uid);
            } catch (e) {
              modal.handleError(e);
            }
          });
        }
      };

      if (!this.sites.length && this.limit !== 0) {
        ng12mPara(el, null, ng12mT("labelNoSites", "You have no sites yet."));
      }
      for (const site of this.sites) rowFor(site, false);

      // footer: create / usage
      const footer = el.createDiv("modal-button-container");
      if (this.sites.length < this.limit || this.limit === 0) {
        if (this.limit === 0) {
          ng12mPara(el, null, ng12mT("labelNoSitesBought", "You have no site slots."));
          const get = footer.createEl("button", { text: ng12mT("buttonGetSite", "Get a site") });
          get.addEventListener("click", () => window.open("https://github.com/FalconTechDev/basalt", "_blank"));
        } else {
          const input = footer.createEl("input", { attr: { placeholder: ng12mT("optionSiteIdPlaceholder", "site-id") } });
          this.slugInputEl = input;
          const create = footer.createEl("button", { cls: "mod-cta", text: ng12mT("buttonCreate", "Create") });
          const go = async () => {
            const slug = (input.value || "").toLowerCase().trim();
            if (!/^[a-z0-9\-]+$/.test(slug)) {
              modal.showError(ng12mT("msgInvalidSiteId", "Site id may only contain lowercase letters, numbers and dashes."));
              return;
            }
            try {
              await plugin.apiCheckSlug(slug);
              modal.showError(ng12mT("msgSiteIdInUse", "This site id is already in use."));
            } catch (e) {
              if (!(e instanceof RequestError) || e.code !== "NOTFOUND") {
                modal.handleError(e);
                return;
              }
              try {
                const created = await acctCreatePublishSite(account.token);
                const id = created.id || created.siteId;
                const host_ = created.host;
                await plugin.apiSetSlug(id, host_, slug);
                await plugin.setup(id, host_);
                modal.openReviewChanges();
              } catch (e2) {
                modal.handleError(e2);
              }
            }
          };
          create.addEventListener("click", go);
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.isComposing) go();
          });
        }
      } else {
        ng12mPara(el, null, ng12mT("labelSiteUsage", "Using {site} of {limit} sites.", { site: this.sites.length, limit: this.limit }));
        const more = footer.createEl("button", { text: ng12mT("buttonAddMore", "Add more") });
        more.addEventListener("click", () => window.open("https://github.com/FalconTechDev/basalt", "_blank"));
      }

      if (this.shared.length) {
        el.createDiv({ cls: "setting-item-name", text: ng12mT("labelSitesSharedWithYou", "Sites shared with you") });
        const sharedList = el.createDiv("site-list-container");
        for (const site of this.shared) {
          const row = sharedList.createDiv("site-list-item");
          row.createSpan({ cls: "site-slug", text: this.slugs[site.id || site.uid] || site.id || site.uid });
          const choose = row.createEl("button", { cls: "mod-cta", text: ng12mT("buttonChoose", "Choose") });
          choose.addEventListener("click", async () => {
            await plugin.setup(site.id || site.uid, site.host);
            modal.openReviewChanges();
          });
          const leave = row.createDiv({ cls: "clickable-icon", attr: { role: "button" } });
          env().tv(leave, "lucide-log-out");
          leave.addEventListener("click", async () => {
            try {
              await acctRemovePublishShare(account.token, site.id || site.uid, site.share_uid || site.uid);
              await modal.deleteSiteShare(site.id || site.uid, site.share_uid || site.uid);
            } catch (e) {
              modal.handleError(e);
            }
          });
        }
      }
    }
  }

  ng12mManageClass = Ng12ManageSites;
  return Ng12ManageSites;
}

// ------------------------------------------------------------------ site options
let ng12mOptionsClass = null;
export function ng12mPublishSiteOptionsSection(host) {
  if (ng12mOptionsClass) return ng12mOptionsClass;
  const Base = ng12mPublishSection(host);

  class Ng12SiteOptions extends Base {
    constructor(parentModal) {
      super(parentModal);
      this.options = null;
      this.changed = {};
    }

    async show() {
      this.el.empty();
      this.el.show();
      const plugin = this.parentModal.plugin;
      let data;
      try {
        data = await plugin.apiOptions();
      } catch (e) {
        const back = this.el.createEl("button", { text: ng12mT("buttonGoBack", "Go back") });
        back.addEventListener("click", () => this.parentModal.openReviewChanges());
        this.parentModal.handleError(e);
        return;
      }
      this.options = (data && data.options) || {};
      this.changed = {};
      this.buildForm();
    }

    val(key) {
      return this.changed[key] !== undefined ? this.changed[key] : (this.options[key] !== undefined ? this.options[key] : ng12PublishDefaults()[key]);
    }

    set(key, value) {
      this.changed[key] = value;
    }

    buildForm() {
      const el = this.el;
      const plugin = this.parentModal.plugin;
      const modal = this.parentModal;
      const container = el.createDiv("publish-site-settings-container");
      const defaults = ng12PublishDefaults();
      const T = (k, f) => ng12mT(k, f);

      const heading = (text) => container.createDiv({ cls: "setting-item-name", text });
      const textSetting = (key, label, placeholder, width) => {
        new host.Setting(container)
          .setName(label)
          .addText((t) => {
            t.setValue(String(this.val(key) || ""));
            if (placeholder) t.setPlaceholder(placeholder);
            if (width) t.inputEl.style.width = width;
            t.onChange((v) => this.set(key, v));
          });
      };
      const toggleSetting = (key, label, desc) => {
        new host.Setting(container)
          .setName(label)
          .setDesc(desc || "")
          .addToggle((t) => {
            t.setValue(!!this.val(key));
            t.onChange((v) => this.set(key, v));
          });
      };

      heading(T("optionSiteGeneral", "General"));
      textSetting("siteName", T("optionSiteName", "Site name"));
      textSetting("indexFile", T("optionHomePageFile", "Home page file"));
      textSetting("logo", T("optionLogo", "Logo"));
      if (!plugin.isGuest) {
        const shareRow = new host.Setting(container).setName(T("optionCollaboration", "Collaboration"));
        shareRow.addButton((b) => b.setButtonText(T("buttonManage", "Manage")).onClick(() => {
          const slug = this.val("slug") || plugin.siteId;
          new (ng12ShareModal(host))(this.parentModal.app, slug, plugin.siteId).open();
        }));
        const domainRow = new host.Setting(container).setName(T("optionCustomDomain", "Custom domain"));
        domainRow.addButton((b) => b.setButtonText(T("buttonConfigure", "Configure")).onClick(() => modal.openSection(modal.configureCustomDomainSection)));
        toggleSetting("noindex", T("optionNoindex", "No index"));
      }
      heading(T("optionSiteAppearance", "Appearance"));
      new host.Setting(container).setName(T("optionDefaultTheme", "Default theme")).addDropdown((d) => {
        d.addOption("light", "Light").addOption("dark", "Dark").addOption("system", T("optionThemeSystem", "System"));
        d.setValue(this.val("defaultTheme") || "light");
        d.onChange((v) => this.set("defaultTheme", v));
      });
      toggleSetting("showThemeToggle", T("optionShowThemeToggle", "Show theme toggle"));
      heading(T("optionSiteReadingExperience", "Reading experience"));
      toggleSetting("showHoverPreview", T("optionShowHoverPreview", "Show hover preview"));
      toggleSetting("hideTitle", T("optionHideTitle", "Hide title"));
      toggleSetting("readableLineLength", T("optionReadableLineLength", "Readable line length"));
      toggleSetting("strictLineBreaks", T("optionStrictLineBreak", "Strict line breaks"));
      toggleSetting("slidingWindowMode", T("optionSlidingWindowMode", "Sliding window mode"));
      heading(T("optionSiteComponents", "Components"));
      toggleSetting("showNavigation", T("optionShowNavigation", "Show navigation"));
      const navRow = new host.Setting(container).setName(T("optionCustomizeNavigation", "Customize navigation"));
      navRow.addButton((b) => b.setButtonText(T("buttonManage", "Manage")).onClick(async () => {
        try {
          const remote = await plugin.apiList();
          const files = (remote.files || []).map((f) => f.path);
          new (env().x7)(this.parentModal.app, {
            files,
            ordering: this.val("navigationOrdering") || [],
            hidden: this.val("navigationHiddenItems") || [],
            onOrdering: (v) => this.set("navigationOrdering", v),
            onHidden: (v) => this.set("navigationHiddenItems", v),
          }).open();
        } catch (e) {
          modal.handleError(e);
        }
      }));
      toggleSetting("showSearch", T("optionShowSearch", "Show search"));
      toggleSetting("showGraph", T("optionShowGraph", "Show graph"));
      toggleSetting("showOutline", T("optionShowOutline", "Show outline"));
      toggleSetting("showBacklinks", T("optionShowBacklinks", "Show backlinks"));
      if (!plugin.isGuest) {
        heading(T("optionSiteMisc", "Misc"));
        const pwRow = new host.Setting(container).setName(T("optionPasswords", "Passwords"));
        pwRow.addButton((b) => b.setButtonText(T("buttonManage", "Manage")).onClick(() => modal.showPasswords()));
        textSetting("googleAnalytics", T("optionGoogleAnalytics", "Google Analytics"), "UA-XXXXX-Y or G-XXXXXXXX", "200px");
      }

      const row = el.createDiv("modal-button-container");
      const save = row.createEl("button", { cls: "mod-cta", text: T("buttonSaveSiteSettings", "Save site settings") });
      save.addEventListener("click", async () => {
        try {
          await plugin.apiOptions(this.changed);
          new (env().fb)(T("msgUpdatedOptions", "Site options updated."));
          modal.openReviewChanges();
        } catch (e) {
          modal.handleError(e);
        }
      });
      const back = row.createEl("button", { text: T("buttonGoBack", "Go back") });
      back.addEventListener("click", () => modal.openReviewChanges());
    }
  }

  ng12mOptionsClass = Ng12SiteOptions;
  return Ng12SiteOptions;
}

// ------------------------------------------------------------------ site filters
let ng12mFiltersClass = null;
export function ng12mPublishSiteFiltersSection(host) {
  if (ng12mFiltersClass) return ng12mFiltersClass;
  const Base = ng12mPublishSection(host);

  class Ng12SiteFilters extends Base {
    constructor(parentModal) {
      super(parentModal);
    }

    async show() {
      this.el.empty();
      this.el.show();
      const plugin = this.parentModal.plugin;
      const modal = this.parentModal;
      this.title = ng12mT("labelSiteOptions", "Site options");
      const mkList = (items) => {
        if (!items || !items.length) return null;
        const ul = this.el.createEl("ul");
        for (const p of items) ul.createEl("li", { text: p });
        return ul;
      };
      new host.Setting(this.el)
        .setName(ng12mT("labelIncludedFolders", "Included folders"))
        .setDesc(ng12mT("labelIncludedFoldersDesc", "Only these folders are published."))
        .addButton((b) => b.setButtonText(ng12mT("buttonManage", "Manage")).onClick(() => {
          new (ng12IncludedFoldersModal(host))(modal.app, plugin, this).open();
        }));
      mkList(plugin.includes);
      new host.Setting(this.el)
        .setName(ng12mT("labelExcludedFolders", "Excluded folders"))
        .setDesc(ng12mT("labelExcludedFoldersDesc", "These folders are not published."))
        .addButton((b) => b.setButtonText(ng12mT("buttonManage", "Manage")).onClick(() => {
          new (ng12ExcludedFoldersModal(host))(modal.app, plugin, this).open();
        }));
      mkList(plugin.excludes);
      const row = this.el.createDiv("modal-button-container");
      const done = row.createEl("button", { cls: "mod-cta", text: ng12mT("buttonDone", "Done") });
      done.addEventListener("click", () => modal.openReviewChanges());
    }
  }

  ng12mFiltersClass = Ng12SiteFilters;
  return Ng12SiteFilters;
}

// ------------------------------------------------------------------ change trees
let ng12mTreeItemBaseCache = null;
function ng12mPublishTreeItemBaseClass(host) {
  if (!ng12mTreeItemBaseCache) {
    const Base = ng12mPublishSection(host);
    class Ng12TreeItemBase {
    constructor(section) {
      this.section = section;
      this.visible = true;
      this.children = [];
      this.parent = null;
      this.checked = false;
      this.el = section.childrenEl.createDiv("publish-tree-item");
      this.selfEl = this.el.createDiv("publish-tree-item-self");
      this.innerEl = this.selfEl.createDiv("publish-tree-item-inner");
    }
    setChecked(c) { this.checked = !!c; if (this.checkboxEl) this.checkboxEl.checked = this.checked; }
    setVisible(v) { this.visible = !!v; this.el.toggleVisibility(this.visible); }
    applyQuery() {}
    updateChecked() {}
    updateCheckedRecursive() {}
    render() { return this; }
    onSelfClick() {}
    }
    ng12mTreeItemBaseCache = Ng12TreeItemBase;
  }
  return ng12mTreeItemBaseCache;
}
export function ng12mPublishTreeItemBase(host) {
  return ng12mPublishTreeItemBaseClass(host);
}

let ng12mFileItemClass = null;
export function ng12mPublishFileItem(host) {
  if (ng12mFileItemClass) return ng12mFileItemClass;
  const Base = ng12mPublishTreeItemBaseClass(host);

  class Ng12FileItem extends Base {
    constructor(section, diff) {
      super(section);
      this.diff = diff;
      this.path = diff.path;
      this.name = withoutMd(lastSegment(diff.path));
      this.checkboxEl = this.selfEl.createEl("input", { attr: { type: "checkbox" } });
      this.checkboxEl.checked = !!diff.checked;
      this.innerEl.setText(this.name);
      this.setChecked(!!diff.checked);
      this.el.addClass("publish-file-item");
      this.el.addEventListener("click", (e) => this.onSelfClick(e));
      this.el.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    }
    setChecked(c) {
      super.setChecked(c);
      if (this.diff) this.diff.checked = this.checked;
      if (this.section && this.section.updateChecked) this.section.updateChecked();
    }
    updateChecked() {}
    applyQuery(query) {
      this.setVisible(!query || this.path.toLowerCase().includes(String(query).toLowerCase()));
    }
    onSelfClick(e) {
      if (e.target === this.checkboxEl) return;
      this.setChecked(!this.checked);
    }
    onContextMenu(e) {
      // placeholder: no custom context actions in clean-room build
    }
    render() { return this; }
  }

  ng12mFileItemClass = Ng12FileItem;
  return Ng12FileItem;
}

let ng12mFolderItemClass = null;
export function ng12mPublishFolderItem(host) {
  if (ng12mFolderItemClass) return ng12mFolderItemClass;
  const Base = ng12mPublishTreeItemBaseClass(host);

  class Ng12FolderItem extends Base {
    constructor(section, path) {
      super(section);
      this.path = path;
      this.name = lastSegment(path);
      this.checkboxEl = this.selfEl.createEl("input", { attr: { type: "checkbox" } });
      this.childrenEl = this.el.createDiv("publish-tree-children");
      this.el.addClass("publish-folder-item");
      this.setChecked(false);
    }
    getChecked() {
      let count = 0, checked = 0;
      const walk = (item) => {
        for (const c of item.children) {
          if (c.diff) { count++; if (c.checked) checked++; }
          else walk(c);
        }
      };
      walk(this);
      return { count, checked };
    }
    setChecked(c) {
      super.setChecked(c);
      for (const child of this.children) {
        if (child.setChecked) child.setChecked(c);
        if (child.updateCheckedRecursive) child.updateCheckedRecursive();
      }
      if (this.section && this.section.updateChecked) this.section.updateChecked();
    }
    updateChecked() {
      const { count, checked } = this.getChecked();
      if (this.checkboxEl) {
        this.checkboxEl.checked = count > 0 && checked === count;
        this.checkboxEl.indeterminate = checked > 0 && checked < count;
      }
      this.checked = count > 0 && checked === count;
      if (this.parent && this.parent.updateChecked) this.parent.updateChecked();
    }
    applyQuery(query) {
      const q = String(query || "").toLowerCase();
      let any = !q || this.path.toLowerCase().includes(q);
      for (const c of this.children) {
        c.applyQuery(query);
        if (c.visible) any = true;
      }
      this.setVisible(any);
    }
    onSelfClick(e) {
      if (e.target === this.checkboxEl) return;
      // folder row click toggles collapse only
      this.el.classList.toggle("is-collapsed");
    }
    render() { return this; }
  }

  ng12mFolderItemClass = Ng12FolderItem;
  return Ng12FolderItem;
}

let ng12mTreeSectionClass = null;
export function ng12mPublishTreeSection(host) {
  if (ng12mTreeSectionClass) return ng12mTreeSectionClass;
  const SectionBase = ng12mPublishSection(host);
  const FileItem = ng12mPublishFileItem(host);
  const FolderItem = ng12mPublishFolderItem(host);

  class Ng12TreeSection extends SectionBase {
    constructor(publish, parentEl, title) {
      super({ contentEl: parentEl });
      // re-parent: our base appended to parentEl directly
      this.publish = publish;
      this.title = title;
      this.children = [];
      this.collapsed = false;
      this.folders = {};
      this.files = {};
      this.childrenEl = this.el.createDiv("publish-tree-children");
      const header = this.el.createDiv("publish-tree-header");
      this.headerEl = header;
      const titleEl = header.createDiv({ cls: "publish-tree-title", text: title });
      this.selectedEl = header.createSpan("publish-tree-selected");
      this.selectedCountEl = header.createSpan("publish-tree-count");
      const checkAllBtn = header.createDiv({ cls: "clickable-icon", attr: { role: "button" } });
      env().tv(checkAllBtn, "lucide-check-check");
      env().Mv(checkAllBtn, "Check all");
      checkAllBtn.addEventListener("click", () => this.checkAll());
      const uncheckAllBtn = header.createDiv({ cls: "clickable-icon", attr: { role: "button" } });
      env().tv(uncheckAllBtn, "lucide-square");
      env().Mv(uncheckAllBtn, "Uncheck all");
      uncheckAllBtn.addEventListener("click", () => this.uncheckAll());
    }

    folderFor(path) {
      const parts = path.split("/").slice(0, -1);
      let key = "";
      let parent = null;
      for (const seg of parts) {
        key = key ? key + "/" + seg : seg;
        if (!this.folders[key]) {
          const item = new FolderItem(this, key);
          item.parent = parent;
          if (parent) parent.children.push(item);
          else this.children.push(item);
          this.folders[key] = item;
        }
        parent = this.folders[key];
      }
      return parent;
    }

    addChild(item) {
      const parent = item.path ? this.folderFor(item.path) : null;
      if (parent) {
        item.parent = parent;
        parent.children.push(item);
      } else {
        item.parent = null;
        this.children.push(item);
      }
      if (item.diff) this.files[item.path] = item;
    }

    createItem(diff) {
      const item = new FileItem(this, diff);
      this.addChild(item);
      return item;
    }

    toggleCollapsed(animate) {
      this.setCollapsed(!this.collapsed, animate);
    }

    setCollapsed(collapsed, animate) {
      this.collapsed = collapsed;
      this.el.classList.toggle("is-collapsed", collapsed);
    }

    collapseAll() {
      this.setCollapsed(true, false);
      for (const c of this.children) if (c.childrenEl) c.el.classList.add("is-collapsed");
    }

    checkAll() {
      for (const item of Object.values(this.files)) item.setChecked(true);
      this.updateChecked();
    }

    uncheckAll() {
      for (const item of Object.values(this.files)) item.setChecked(false);
      this.updateChecked();
    }

    updateChecked() {
      let count = 0, checked = 0;
      const walk = (items) => {
        for (const it of items) {
          if (it.diff) { count++; if (it.checked) checked++; }
          else { walk(it.children); if (it.updateChecked) it.updateChecked(); }
        }
      };
      walk(this.children);
      this.selectedCountEl.setText(checked + "/" + count);
    }

    render() {
      this.childrenEl.empty();
      for (const child of this.children) {
        this.childrenEl.appendChild(child.el);
        child.render();
      }
      this.updateChecked();
      return this;
    }

    applyQuery(query) {
      for (const child of this.children) child.applyQuery(query);
    }

    clear() {
      this.children = [];
      this.folders = {};
      this.files = {};
      this.childrenEl.empty();
    }
  }

  ng12mTreeSectionClass = Ng12TreeSection;
  return Ng12TreeSection;
}

// ------------------------------------------------------------------ review section
let ng12mReviewClass = null;
export function ng12mPublishReviewSection(host) {
  if (ng12mReviewClass) return ng12mReviewClass;
  const Base = ng12mPublishSection(host);
  const TreeSection = ng12mPublishTreeSection(host);

  class Ng12Review extends Base {
    constructor(parentModal) {
      super(parentModal);
      this.pathToDiffMap = {};
      this.sectionChanged = null;
      this.sectionUnchanged = null;
      this.sectionNew = null;
      this.currentlyPublishedToSiteNameEl = null;
      this.filterComponent = null;
      this.noChangesEl = null;
    }

    async show() {
      this.el.empty();
      this.el.show();
      const plugin = this.parentModal.plugin;
      const modal = this.parentModal;

      // header
      const header = this.el.createDiv("publish-changes-info");
      header.createSpan(ng12mT("labelPublishingTo", "Publishing to"));
      this.currentlyPublishedToSiteNameEl = header.createEl("a", {
        cls: "internal-link",
        text: plugin.siteId || "",
        attr: { href: ng12PublishUrl + "/" + plugin.siteId, target: "_blank" },
      });
      const icons = header.createDiv("publish-changes-icons");
      const mkIcon = (icon, tip, fn) => {
        const b = icons.createDiv({ cls: "clickable-icon", attr: { role: "button" } });
        env().tv(b, icon);
        env().Mv(b, tip);
        b.addEventListener("click", fn);
      };
      mkIcon("lucide-repeat", ng12mT("tooltipSwitchSite", "Switch site"), () => modal.openManageSites());
      mkIcon("lucide-settings", "Options", () => modal.openSection(modal.siteOptionsSection));
      mkIcon("lucide-filter", "Filters", () => modal.openSection(modal.siteFiltersSection));
      mkIcon("lucide-life-buoy", "Support", () => window.open("https://github.com/FalconTechDev/basalt/issues"));

      // filter
      try {
        this.filterComponent = new host.SearchComponent(this.el, (q) => this.applyQuery(q));
      } catch (e) {
        this.filterComponent = null;
      }
      const addLinked = this.el.createEl("button", { text: ng12mT("buttonAddLinked", "Add linked files") });
      env().Mv(addLinked, ng12mT("tooltipAddLinked", "Add files linked from checked files"));
      addLinked.addEventListener("click", () => this.addLinked());

      this.noChangesEl = this.el.createDiv({ cls: "message", text: ng12mT("msgNoChanges", "No changes.") });
      this.noChangesEl.hide();

      let changes;
      try {
        changes = await plugin.scanForChanges();
      } catch (e) {
        modal.handleError(e);
        return;
      }
      this.pathToDiffMap = {};
      for (const d of changes) this.pathToDiffMap[d.path] = d;
      this.setCurrentSiteName(plugin.siteId);

      const groups = { changed: [], "to-delete": [], new: [], deleted: [] };
      for (const d of changes) (groups[d.type] || groups.changed).push(d);

      const mount = (title, diffs) => {
        const section = new TreeSection(plugin, this.el, title);
        section.title = title;
        for (const d of diffs) section.createItem(d);
        section.render();
        return section;
      };
      this.sectionChanged = mount(ng12mT("labelChangedFiles", "Changed files"), groups.changed.concat(groups.deleted));
      this.sectionUnchanged = mount(ng12mT("labelUnchangedFiles", "Unchanged files"), groups["to-delete"]);
      this.sectionNew = mount(ng12mT("labelNewFiles", "New files"), groups.new);

      const hasChanges = groups.changed.length + groups.deleted.length + groups.new.length > 0;
      this.noChangesEl.toggleVisibility(!hasChanges);

      // collapse rules
      if (groups.changed.length || groups.deleted.length) {
        this.sectionUnchanged.collapseAll();
        this.sectionNew.collapseAll();
        for (const d of groups.changed.concat(groups.deleted)) {
          if (d.type !== "deleted") d.checked = true;
        }
        this.sectionChanged.checkAll && this.sectionChanged.updateChecked();
      } else {
        this.sectionChanged.collapseAll();
        this.sectionUnchanged.collapseAll();
      }
      super.show();
    }

    setCurrentSiteName(slug) {
      if (this.currentlyPublishedToSiteNameEl) {
        this.currentlyPublishedToSiteNameEl.setText(slug || "");
        this.currentlyPublishedToSiteNameEl.setAttribute("href", ng12PublishUrl + "/" + (slug || ""));
      }
    }

    applyQuery(query) {
      this.sectionChanged && this.sectionChanged.applyQuery(query);
      this.sectionUnchanged && this.sectionUnchanged.applyQuery(query);
      this.sectionNew && this.sectionNew.applyQuery(query);
    }

    async addLinked() {
      const plugin = this.parentModal.plugin;
      const checked = [];
      for (const section of [this.sectionChanged, this.sectionNew]) {
        if (!section) continue;
        for (const item of Object.values(section.files)) {
          if (item.checked && item.diff && item.diff.type !== "deleted") checked.push(item.diff);
        }
      }
      const targets = new Set();
      for (const d of checked) {
        const file = plugin.vault.getAbstractFileByPath(d.path);
        const cache = file && plugin.app.metadataCache.getFileCache(file);
        for (const link of (cache && cache.links) || []) {
          const dest = plugin.app.metadataCache.getFirstLinkpathDest(link.link, d.path);
          if (dest) targets.add(dest.path);
        }
      }
      let added = 0;
      for (const item of Object.values(this.sectionNew.files)) {
        if (targets.has(item.path) && !item.checked) {
          item.setChecked(true);
          added++;
        }
      }
      if (added) new (env().fb)(ng12mT("msgAddedLinkedFiles", "Added {count} linked files.", { count: added }));
    }

    uploadChanges() {
      const changes = [];
      for (const section of [this.sectionChanged, this.sectionNew, this.sectionUnchanged]) {
        if (!section) continue;
        for (const item of Object.values(section.files)) {
          if (item.checked && item.diff) changes.push(item.diff);
        }
      }
      if (!changes.length) {
        new (env().fb)(ng12mT("msgSelectAtLeastOneFile", "Select at least one file."));
        return;
      }
      this.parentModal.uploadChanges(changes);
    }
  }

  ng12mReviewClass = Ng12Review;
  return Ng12Review;
}

// ------------------------------------------------------------------ upload section
let ng12mUploadClass = null;
export function ng12mPublishUploadSection(host) {
  if (ng12mUploadClass) return ng12mUploadClass;
  const Base = ng12mPublishSection(host);
  const Runnable = env().bb;

  class Ng12Upload extends Base {
    constructor(parentModal) {
      super(parentModal);
      this.changes = [];
      this.pathToEl = {};
      this.runnable = null;
      this.successMessageEl = null;
      this.siteLinkEl = null;
      this.doneButton = null;
    }

    addChanges(changes) {
      this.changes = (this.changes || []).concat(changes || []);
    }

    async show() {
      this.el.empty();
      this.el.show();
      const plugin = this.parentModal.plugin;
      const modal = this.parentModal;
      if (this.runnable) this.runnable.cancel && this.runnable.cancel();
      this.pathToEl = {};
      for (const change of this.changes) {
        const row = this.el.createDiv("publish-upload-item list-item");
        row.createDiv({ cls: "file-icon" });
        row.createDiv({ cls: "publish-upload-title", text: withoutExtension(lastSegment(change.path)) });
        const flair = row.createDiv({ cls: "publish-upload-status" });
        this.pathToEl[change.path] = { row, flair, change };
      }
      const row = this.el.createDiv("modal-button-container");
      this.doneButton = row.createEl("button", { cls: "mod-cta", text: ng12mT("buttonStop", "Stop") });
      this.doneButton.addEventListener("click", () => {
        if (this.runnable) this.runnable.cancel && this.runnable.cancel();
        else modal.close();
      });
      const back = row.createEl("button", { text: ng12mT("buttonGoBack", "Go back") });
      back.addEventListener("click", () => {
        if (this.runnable) this.runnable.cancel && this.runnable.cancel();
        modal.openReviewChanges();
      });
      this.startUpload();
      super.show();
    }

    startUpload() {
      const plugin = this.parentModal.plugin;
      const modal = this.parentModal;
      const self = this;
      const runnable = this.runnable = new Runnable({
        onStop: () => {
          self.doneButton.setText(ng12mT("buttonDone", "Done"));
          self.doneButton.removeClass("mod-warning");
          self.el.addClass("is-finished");
          const link = self.el.createEl("a", {
            cls: "internal-link",
            text: ng12PublishUrl + "/" + plugin.siteId,
            attr: { href: ng12PublishUrl + "/" + plugin.siteId, target: "_blank" },
          });
          self.siteLinkEl = link;
          const msg = self.el.createDiv("publish-upload-success");
          msg.createDiv({ cls: "paragraph", text: ng12mT("labelClearCache", "Clear your cache") });
          msg.createDiv({ cls: "paragraph", text: ng12mT("labelVisitSite", "Visit your site") });
          self.successMessageEl = msg;
          self.runnable = null;
        },
      });
      runnable.start && runnable.start();
      (async () => {
        for (const change of self.changes) {
          const parts = self.pathToEl[change.path];
          if (!parts) continue;
          const { row, flair } = parts;
          if (runnable.isCancelled && runnable.isCancelled()) {
            flair.setText(ng12mT("labelStatusCancelled", "Cancelled"));
            flair.addClass("mod-failed", "mod-completed");
            continue;
          }
          flair.setText(ng12mT("labelStatusUploading", "Uploading"));
          try {
            if (change.type === "deleted" || change.type === "to-delete") {
              await plugin.apiRemoveFile(change.path);
              flair.setText(ng12mT("labelStatusDeleted", "Deleted"));
            } else {
              const file = plugin.vault.getAbstractFileByPath(change.path);
              if (file) {
                await plugin.apiUploadFile(file);
                flair.setText(ng12mT("labelStatusPublished", "Published"));
              }
            }
          } catch (e) {
            modal.handleError(e);
            flair.setText(ng12mT("labelStatusFailed", "Failed"));
            flair.addClass("mod-failed");
          }
          flair.addClass("mod-completed");
          row.scrollIntoView && row.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        runnable.stop && runnable.stop();
      })();
    }
  }

  ng12mUploadClass = Ng12Upload;
  return Ng12Upload;
}

// ------------------------------------------------------------------ small sections
let ng12mEditSlugClass = null;
export function ng12mPublishEditSlugSection(host) {
  if (ng12mEditSlugClass) return ng12mEditSlugClass;
  const Base = ng12mPublishSection(host);

  class Ng12EditSlug extends Base {
    constructor(parentModal) {
      super(parentModal);
      this.site = null;
      this.newSlug = "";
      this.slugInputEl = null;
    }

    setSiteInfo(site) { this.site = site; }
    setExistingSlug(slug) { this.existingSlug = slug; }

    async show() {
      this.el.empty();
      this.el.show();
      const plugin = this.parentModal.plugin;
      const modal = this.parentModal;
      this.title = ng12mT("optionSiteId", "Site ID");
      new host.Setting(this.el)
        .setName(ng12mT("optionSiteId", "Site ID"))
        .setDesc(ng12mT("optionSiteIdDesc", "The id of your site."))
        .addText((t) => {
          this.slugInputEl = t.inputEl;
          t.setPlaceholder(ng12mT("optionSiteIdPlaceholder", "site-id"));
          t.setValue(this.existingSlug || (this.site && (this.site.id || this.site.slug)) || "");
          t.onChange((v) => { this.newSlug = v.toLowerCase(); });
        });
      const row = this.el.createDiv("modal-button-container");
      const change = row.createEl("button", { cls: "mod-cta", text: ng12mT("buttonChange", "Change") });
      change.addEventListener("click", async () => {
        const site = this.site;
        if (!site) return;
        try {
          await plugin.apiSetSlug(site.id || site.uid, site.host, this.newSlug || this.slugInputEl.value.toLowerCase());
          modal.openSection(modal.siteOptionsSection);
        } catch (e) {
          modal.handleError(e);
        }
      });
      const cancel = row.createEl("button", { text: ng12mT("buttonCancel", "Cancel") });
      cancel.addEventListener("click", () => modal.openSection(modal.manageSitesSection));
      super.show();
    }
  }

  ng12mEditSlugClass = Ng12EditSlug;
  return Ng12EditSlug;
}

let ng12mPasswordsClass = null;
export function ng12mPublishPasswordsSection(host) {
  if (ng12mPasswordsClass) return ng12mPasswordsClass;
  const Base = ng12mPublishSection(host);

  class Ng12Passwords extends Base {
    constructor(parentModal) {
      super(parentModal);
      this.passwords = null;
    }

    setPasswords(pw) { this.passwords = pw; }

    async show() {
      this.updateDisplay();
      super.show();
    }

    updateDisplay() {
      this.el.empty();
      const modal = this.parentModal;
      if (this.passwords === null || this.passwords === undefined) {
        ng12mPara(this.el, null, ng12mT("labelNoPassword", "No password set."));
      } else {
        ng12mPara(this.el, null, ng12mT("labelHavePassword", "A password is set."));
        this.el.createEl("hr");
        const list = Array.isArray(this.passwords) ? this.passwords : [];
        list.forEach((pw, index) => {
          const row = this.el.createDiv("password-item list-item");
          row.createSpan({ text: pw.name || ng12mT("labelUntitledPassword", "Untitled password") });
          row.createSpan({ cls: "password-time", text: ng12mT("labelPasswordCreatedTime", "Created {time}", { time: "" }) });
          const del = row.createDiv({ cls: "clickable-icon", attr: { role: "button" } });
          env().tv(del, "lucide-trash-2");
          del.addEventListener("click", async () => {
            try {
              await modal.plugin.apiDelPassword(index);
              modal.showPasswords();
            } catch (e) {
              modal.handleError(e);
            }
          });
        });
      }
      const row = this.el.createDiv("modal-button-container");
      const add = row.createEl("button", { cls: "mod-cta", text: ng12mT("buttonNewPassword", "New password") });
      add.addEventListener("click", () => modal.openAddPassword());
      const back = row.createEl("button", { text: ng12mT("buttonGoBack", "Go back") });
      back.addEventListener("click", () => modal.openSection(modal.siteOptionsSection));
    }
  }

  ng12mPasswordsClass = Ng12Passwords;
  return Ng12Passwords;
}

let ng12mAddPasswordClass = null;
export function ng12mPublishAddPasswordSection(host) {
  if (ng12mAddPasswordClass) return ng12mAddPasswordClass;
  const Base = ng12mPublishSection(host);

  class Ng12AddPassword extends Base {
    constructor(parentModal) {
      super(parentModal);
      this.passwordFieldEl = null;
      this.nicknameFieldEl = null;
    }

    async show() {
      this.el.empty();
      this.el.show();
      const modal = this.parentModal;
      new host.Setting(this.el)
        .setName(ng12mT("optionPassword", "Password"))
        .addText((t) => {
          this.passwordFieldEl = t;
          t.inputEl.type = "password";
          t.setPlaceholder(ng12mT("optionPasswordPlaceholder", "Enter password"));
        });
      new host.Setting(this.el)
        .setName(ng12mT("optionPasswordNickname", "Nickname"))
        .addText((t) => {
          this.nicknameFieldEl = t;
        });
      const row = this.el.createDiv("modal-button-container");
      const add = row.createEl("button", { cls: "mod-cta", text: ng12mT("buttonAdd", "Add") });
      add.addEventListener("click", async () => {
        try {
          await modal.plugin.apiAddPassword(this.nicknameFieldEl.getValue(), this.passwordFieldEl.getValue());
          new (env().fb)(ng12mT("msgAddedNewPassword", "Password added."));
          modal.showPasswords();
        } catch (e) {
          modal.handleError(e);
        }
      });
      const back = row.createEl("button", { text: ng12mT("buttonGoBack", "Go back") });
      back.addEventListener("click", () => modal.showPasswords());
      super.show();
    }
  }

  ng12mAddPasswordClass = Ng12AddPassword;
  return Ng12AddPassword;
}

let ng12mCustomDomainClass = null;
export function ng12mPublishCustomDomainSection(host) {
  if (ng12mCustomDomainClass) return ng12mCustomDomainClass;
  const Base = ng12mPublishSection(host);

  class Ng12CustomDomain extends Base {
    constructor(parentModal) {
      super(parentModal);
      this.urlInput = null;
      this.redirectToggle = null;
    }

    async show() {
      this.el.empty();
      this.el.show();
      const plugin = this.parentModal.plugin;
      const modal = this.parentModal;
      let current = {};
      try {
        current = (await plugin.apiCustomUrl()) || {};
      } catch (e) {}
      const instr = this.el.createDiv("paragraph");
      instr.innerHTML = ng12mT("labelCustomDomainInstructions", "Point a custom domain at your site. See {link}.", {
        link: '<a href="https://github.com/FalconTechDev/basalt/wiki">' + ng12mT("labelCustomDomainLinkName", "the wiki") + "</a>",
      });
      new host.Setting(this.el)
        .setName(ng12mT("optionCustomDomain", "Custom domain"))
        .addText((t) => {
          this.urlInput = t;
          t.setPlaceholder("example.com");
          t.setValue(current.url || "");
        });
      new host.Setting(this.el)
        .setName(ng12mT("optionRedirect", "Redirect"))
        .addToggle((t) => {
          this.redirectToggle = t;
          t.setValue(!!current.redirect);
        });
      const row = this.el.createDiv("modal-button-container");
      const update = row.createEl("button", { cls: "mod-cta", text: ng12mT("buttonUpdate", "Update") });
      update.addEventListener("click", async () => {
        try {
          await plugin.apiCustomUrl(this.urlInput.getValue(), this.redirectToggle.getValue());
          modal.openSection(modal.siteOptionsSection);
        } catch (e) {
          modal.handleError(e);
        }
      });
      const back = row.createEl("button", { text: ng12mT("buttonGoBack", "Go back") });
      back.addEventListener("click", () => modal.openSection(modal.siteOptionsSection));
      super.show();
    }
  }

  ng12mCustomDomainClass = Ng12CustomDomain;
  return Ng12CustomDomain;
}

// ------------------------------------------------------------------ modals
let ng12mShareModalClass = null;
export function ng12mPublishShareModal(host) {
  if (ng12mShareModalClass) return ng12mShareModalClass;

  class Ng12ShareModal extends host.ButtonModal {
    constructor(app, siteName, siteId) {
      super(app);
      this.shares = [];
      this.siteId = siteId;
      this.siteName = siteName;
      this.emailInput = null;
      this.modalEl.addClass("mod-publish-share");
    }

    onOpen() {
      this.setTitle(ng12mT("labelManageSharing", "Manage sharing for {name}", { name: this.siteName }));
      this.addDoneButton();
      this.display();
    }

    async display() {
      this.contentEl.empty();
      let data;
      try {
        data = await acctListPublishShares(account.token, this.siteId);
      } catch (e) {
        return;
      }
      this.shares = (data && data.shares) || data || [];
      if (!this.shares.length) {
        this.contentEl.createDiv({ cls: "paragraph", text: ng12mT("labelNotSharing", "Not sharing with anyone.") });
      }
      for (const share of this.shares) {
        const row = this.contentEl.createDiv("share-item list-item");
        row.createSpan({ text: share.name ? share.name + " <" + (share.email || "") + ">" : (share.email || "") });
        if (share.pending || share.status === "pending") {
          row.createSpan({ cls: "share-pending", text: ng12mT("labelInvitePending", "Pending") });
        }
        const del = row.createDiv({ cls: "clickable-icon", attr: { role: "button" } });
        env().tv(del, "lucide-trash-2");
        del.addEventListener("click", async () => {
          try {
            await acctRemovePublishShare(account.token, this.siteId, share.uid || share.id);
            this.display();
          } catch (e) {}
        });
      }
      const invite = this.contentEl.createDiv("modal-button-container");
      const input = invite.createEl("input", { attr: { type: "email", placeholder: "email@example.com" } });
      this.emailInput = input;
      const add = invite.createEl("button", { cls: "mod-cta", text: ng12mT("buttonAdd", "Add") });
      add.addEventListener("click", () => this.inviteToSite(input.value));
    }

    async inviteToSite(email) {
      email = (email || "").trim();
      if (email.indexOf("@") < 0) {
        new (env().fb)(ng12mT("errorEmailMustBeValid", "Email must be valid."));
        return;
      }
      try {
        await acctInvitePublishShare(account.token, this.siteId, email);
        this.display();
      } catch (e) {}
    }
  }

  ng12mShareModalClass = Ng12ShareModal;
  return Ng12ShareModal;
}

let ng12mCompareModalClass = null;
export function ng12mPublishCompareModal(host) {
  if (ng12mCompareModalClass) return ng12mCompareModalClass;

  class Ng12CompareModal extends host.ButtonModal {
    constructor(app, publish, path) {
      super(app);
      this.publish = publish;
      this.path = path;
      this.doneModal = null;
    }

    async onOpen() {
      this.setTitle(this.path);
      this.addDoneButton();
      const plugin = this.publish.plugin;
      let data;
      try {
        data = await plugin.apiDownloadFile(this.path);
      } catch (e) {
        return;
      }
      const ext = extensionOf(this.path);
      const local = plugin.vault.getAbstractFileByPath(this.path);
      try {
        if (env().Vy.includes(ext)) {
          let url;
          if (local) url = plugin.vault.getResourcePath(local);
          else url = URL.createObjectURL(new Blob([data]));
          this.contentEl.createEl("img", { attr: { src: url } });
        } else {
          const text = new TextDecoder().decode(data);
          const localText = local ? await plugin.vault.cachedRead(local) : "";
          const view = new (env().RX)(text, localText);
          this.contentEl.appendChild(view.el || view);
        }
      } catch (e) {}
      if (local instanceof host.TFile) {
        const use = this.contentEl.createEl("button", { cls: "mod-warning", text: ng12mT("buttonUseLiveVersion", "Use live version") });
        use.addEventListener("click", () => {
          new (ng12ConfirmModal(host))(this.app, local, this.publish, data).open();
        });
      }
    }
  }

  ng12mCompareModalClass = Ng12CompareModal;
  return Ng12CompareModal;
}

let ng12mConfirmModalClass = null;
export function ng12mPublishConfirmModal(host) {
  if (ng12mConfirmModalClass) return ng12mConfirmModalClass;

  class Ng12ConfirmModal extends host.ButtonModal {
    constructor(app, file, publishModal, data) {
      super(app);
      this.file = file;
      this.publishModal = publishModal;
      this.data = data;
    }

    onOpen() {
      this.setTitle(ng12mT("labelConfirmOverride", "Confirm override"));
      ng12mPara(this.contentEl, null, ng12mT("labelConfirmOverrideDesc", "This will overwrite the local file."));
      ng12mPara(this.contentEl, null, ng12mT("labelConfirmOverrideDesc2", "Are you sure?"));
      const proceed = this.contentEl.createEl("button", { cls: "mod-warning", text: ng12mT("buttonProceed", "Proceed") });
      proceed.addEventListener("click", async () => {
        try {
          await this.app.vault.modifyBinary(this.file, this.data);
          new (env().fb)(ng12mT("messageSuccessfullyUsedLiveVersion", "Successfully used live version."));
          if (this.publishModal && this.publishModal.reviewChangesSection) {
            this.publishModal.reviewChangesSection.show();
          }
        } catch (e) {}
        this.close();
      });
      const cancel = this.contentEl.createEl("button", { text: ng12mT("buttonCancel", "Cancel") });
      cancel.addEventListener("click", () => this.close());
    }
  }

  ng12mConfirmModalClass = Ng12ConfirmModal;
  return Ng12ConfirmModal;
}

// ------------------------------------------------------------------ folder pickers
function ng12mFolderModalBase(host, titleKey, titleFallback) {
  const Base = env().V7;
  class Ng12FolderModal extends Base {
    constructor(app, publish, section) {
      super(app);
      this.publish = publish;
      this.section = section;
      this.title = ng12mT(titleKey, titleFallback);
    }
    getPaths() {
      return this.section === "include" ? this.publish.includes : this.publish.excludes;
    }
    setPaths(paths) {
      const p = paths || [];
      if (this.section === "include") return this.publish.setIncludes(p);
      return this.publish.setExcludes(p);
    }
    onClose() {
      if (this.sectionRef && this.sectionRef.show) this.sectionRef.show();
    }
  }
  return Ng12FolderModal;
}

let ng12mIncludedClass = null;
export function ng12mPublishIncludedFoldersModal(host) {
  if (ng12mIncludedClass) return ng12mIncludedClass;
  const Base = ng12mFolderModalBase(host, "labelManageIncludedFolders", "Manage included folders");
  class Ng12Included extends Base {
    constructor(app, publish, section) {
      super(app, publish, "include");
      this.sectionRef = section;
    }
  }
  ng12mIncludedClass = Ng12Included;
  return Ng12Included;
}

let ng12mExcludedClass = null;
export function ng12mPublishExcludedFoldersModal(host) {
  if (ng12mExcludedClass) return ng12mExcludedClass;
  const Base = ng12mFolderModalBase(host, "labelManageExcludedFolders", "Manage excluded folders");
  class Ng12Excluded extends Base {
    constructor(app, publish, section) {
      super(app, publish, "exclude");
      this.sectionRef = section;
    }
  }
  ng12mExcludedClass = Ng12Excluded;
  return Ng12Excluded;
}

// ------------------------------------------------------------------ path suggest
let ng12mPathSuggestClass = null;
export function ng12mPublishPathSuggest(host) {
  if (ng12mPathSuggestClass) return ng12mPathSuggestClass;
  const Base = host.FilePathSuggest || env().xI;

  class Ng12PathSuggest extends Base {
    constructor(app, inputEl) {
      super(app, inputEl);
    }
    filePredicate(file) {
      return env().Vy.includes(file.extension);
    }
    selectSuggestion(suggestion) {
      const item = suggestion.item;
      const path = item && item.path !== undefined ? item.path : item;
      this.inputEl.value = path;
      this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      this.close();
    }
  }

  ng12mPathSuggestClass = Ng12PathSuggest;
  return Ng12PathSuggest;
}
