// The properties panes: the per-file properties view (`M7`), the global
// all-properties view (`E7`) and the property row inside its tree (`C7`).
// Faithful port of the inherited code: same DOM classes, view-type ids, i18n
// keys, sort orders, rename flow and context menu. App-scope helpers arrive
// through host/env; bundle async plumbing becomes native async/await.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { debounceCall } from "./timing.js";
import { lastSegment } from "./path.js";
import { propertyTypeDefaults } from "./metadata-types.js";
import { frontmatterBounds } from "./notes-utils.js";

const propsI18n = (host) => host.i18n.plugins.properties;

// View-type ids (were the `g7` / `y7` constants).
const ALL_PROPERTIES_VIEW = "all-properties";
const FILE_PROPERTIES_VIEW = "file-properties";

// Sort orders offered by the view header (was `b7`) and their labels (was `w7`).
const SORT_ORDERS = [
  ["alphabetical", "alphabeticalReverse"],
  ["frequency", "frequencyReverse"],
];
function s35PropsSortLabels(host) {
  const i18n = propsI18n(host);
  return {
    alphabetical: i18n.labelSortByNameAToZ,
    alphabeticalReverse: i18n.labelSortByNameZToA,
    frequency: i18n.labelSortByFrequencyHighToLow,
    frequencyReverse: i18n.labelSortByFrequencyLowToHigh,
  };
}

// The class `E7` instantiates for every property row; filled by s35PropertyItem.
let propertyItemClass = null;

// One property row in the all-properties tree (was `C7`).
export function s35PropertyItem(host) {
  const Base = env().YL;
  const i18n = host.i18n;
  const propI18n = propsI18n(host);

  function PropertyItem(view) {
    const self = Base.call(this) || this;
    self.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    self.vChildren = new env().UH(self);
    self.pusherEl = host.s16TreePusher();
    self.view = view;
    self.app = view.app;
    const innerEl = self.innerEl;
    self.iconEl = self.selfEl.createDiv({ cls: "tree-item-icon", prepend: true });
    self.titleEl = innerEl.createDiv("tree-item-inner-text");
    self.flairEl = self.selfEl.createDiv("tree-item-flair-outer").createSpan("tree-item-flair");
    self.selfEl.addClass("tappable");
    self.selfEl.addEventListener("contextmenu", self.onContextMenu.bind(self));
    self.setClickable(true);
    self.titleEl.addEventListener("blur", () => self.view.acceptRename(self));
    return self;
  }
  inherit(PropertyItem, Base);
  const proto = PropertyItem.prototype;

  proto.onContextMenu = function (event) {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.view.tree.setFocusedItem(this, false);
    const typeManager = this.app.metadataTypeManager;
    const menu = new host.Menu().addSections(["action", "action.changeType", "danger"]);
    menu.setSectionSubmenu("action.changeType", { title: i18n.properties.optionPropertyType(), icon: "lucide-menu" });

    if (this.view.tree.selectedDoms.size > 1 && this.view.tree.selectedDoms.has(this)) {
      const selected = Array.from(this.view.tree.selectedDoms);
      const canChange = selected.every((item) => !Object.hasOwn(propertyTypeDefaults, item.property.name));
      menu.addItem((item) =>
        item
          .setSection("action.changeType")
          .setIcon("lucide-loader")
          .setDisabled(!canChange)
          .setTitle(propI18n.optAutomatic())
          .onClick(() => {
            for (const dom of selected) typeManager.unsetType(dom.property.name);
          })
          .setWarning(true),
      );
      const widgets = Object.values(typeManager.registeredTypeWidgets);
      const self = this;
      for (const widget of widgets) {
        if (widget.reservedKeys && !widget.reservedKeys?.contains(self.property.name)) continue;
        menu.addItem((item) =>
          item
            .setTitle(widget.name())
            .setIcon(widget.icon)
            .setSection("action.changeType")
            .setDisabled(!canChange)
            .onClick(() => {
              for (const dom of selected) typeManager.setType(dom.property.name, widget.type);
            }),
        );
      }
      menu.addItem((item) =>
        item
          .setSection("danger")
          .setTitle(propI18n.optDeleteProperties({ count: selected.length }))
          .setIcon("lucide-trash-2")
          .setDisabled(!canChange)
          .setWarning(true)
          .onClick(() => {
            for (const dom of selected) self.view.deleteProperty(dom);
          }),
      );
    } else {
      const isCustom = !Object.hasOwn(propertyTypeDefaults, this.property.name);
      const assigned = typeManager.getAssignedWidget(this.property.name);
      const hasType = !!assigned;
      const inferred = typeManager.getTypeInfo(this.property.name).inferred;
      const self = this;
      menu.addItem((item) =>
        item
          .setSection("action.changeType")
          .setDisabled(!isCustom)
          .setIcon("lucide-loader")
          .setTitle(hasType ? propI18n.optAutomatic() : propI18n.optAutomaticWithType({ type: inferred.name() }))
          .setChecked(!hasType)
          .onClick(() => typeManager.unsetType(self.property.name)),
      );
      const widgets = Object.values(typeManager.registeredTypeWidgets);
      for (const widget of widgets) {
        if (widget.reservedKeys && !widget.reservedKeys?.contains(self.property.name)) continue;
        menu.addItem((item) =>
          item
            .setTitle(widget.name())
            .setIcon(widget.icon)
            .setSection("action.changeType")
            .setDisabled(!isCustom)
            .setChecked(widget.type === assigned)
            .onClick(() => typeManager.setType(self.property.name, widget.type)),
        );
      }
      menu.addItem((item) =>
        item
          .setSection("action")
          .setTitle(i18n.interface.menu.rename())
          .setIcon("lucide-edit-3")
          .setDisabled(!isCustom)
          .onClick(() => self.view.startRename(self)),
      );
      menu.addItem((item) =>
        item
          .setSection("danger")
          .setTitle(propI18n.optDeleteProperties())
          .setIcon("lucide-trash-2")
          .setDisabled(!isCustom)
          .setWarning(true)
          .onClick(() => self.view.deleteProperty(self)),
      );
    }
    menu.setParentElement(this.el).showAtMouseEvent(event);
  };

  proto.displayError = function (message) {
    const el = this.selfEl;
    host.displayTooltip(el, message, { placement: "bottom", classes: ["mod-error"] });
    el.win.setTimeout(host.hideTooltip, 2000);
  };

  proto.startRename = function () {
    const selfEl = this.selfEl;
    const titleEl = this.titleEl;
    selfEl.addClass("is-being-renamed");
    titleEl.setAttribute("contenteditable", "true");
    titleEl.setAttribute("spellcheck", String(this.app.vault.getConfig("spellcheck")));
    env().Av(titleEl);
  };

  proto.stopRename = function () {
    const selfEl = this.selfEl;
    const titleEl = this.titleEl;
    selfEl.removeClass("is-being-renamed");
    titleEl.removeAttribute("contenteditable");
    titleEl.removeAttribute("spellcheck");
  };

  proto.onSelfClick = function (event) {
    if (this.view.tree.handleItemSelection(event, this)) return;
    const search = this.view.app.internalPlugins.getEnabledPluginById("global-search");
    if (search) {
      const modEvent = host.Keymap.isModEvent(event);
      const query = search.getGlobalSearchQuery();
      const term = `["${this.property.name}"]`;
      if (modEvent && query !== "") {
        if (query.contains(term)) search.openGlobalSearch(query.replace(term, "").trim());
        else search.openGlobalSearch(`${query.trim()} ${term}`);
      } else {
        search.openGlobalSearch(term);
      }
    }
  };

  proto.updateTitle = function () {
    this.titleEl.setText(this.property.name);
  };

  proto.setProperty = function (property) {
    const widget = this.app.metadataTypeManager.getWidget(property.widget);
    this.property = property;
    host.setIcon(this.iconEl, widget.icon);
    this.updateTitle();
    this.flairEl.setText(String(property.occurrences));
    return this;
  };

  propertyItemClass = PropertyItem;
  return PropertyItem;
}

// Global "all properties" pane (was `E7`).
export function s35AllPropertiesView(host) {
  const Base = host.ItemView;
  const i18n = host.i18n;
  const propI18n = propsI18n(host);

  function AllPropertiesView(leaf) {
    const self = Base.call(this, leaf) || this;
    self.icon = "lucide-archive";
    self.doms = {};
    self.searchQuery = null;
    self.sortOrder = "frequency";
    self.isShowingSearch = false;
    self.propertyBeingRenamed = null;
    self.requestUpdate = debounceCall(self.update.bind(self), 100);

    const containerEl = self.containerEl;
    self.emptyStateEl = host.createDiv({
      cls: "pane-empty properties-pane-empty",
      text: propI18n.labelNoProperties(),
    });
    self.scope = new host.Scope(self.app.scope);
    self.scope.register([], "Enter", self.onKeyEnterInFocus.bind(self));
    self.scope.register(["Mod"], "Enter", self.onKeyEnterInFocus.bind(self));

    const header = new host.ViewHeader(self.app, containerEl);
    header.addSortButton(SORT_ORDERS, s35PropsSortLabels(host), (order) => self.setSortOrder(order), () => self.sortOrder);
    self.showSearchButtonEl = header.addNavButton(
      "lucide-search",
      i18n.plugins.backlinks.labelShowSearch(),
      self.onToggleShowSearch.bind(self),
    );
    self.searchComponent = new host.SearchComponent(header.navHeaderEl)
      .setPlaceholder(i18n.plugins.search.promptStartSearch())
      .onChange(debounceCall(self.updateSearch.bind(self), 300, true))
      .then((component) => {
        host.setTooltip(component.clearButtonEl, i18n.plugins.search.tooltipClearSearch());
        component.inputEl.addEventListener("keypress", (event) => {
          if (event.isComposing || event.key !== "Enter") return;
          if (!host.Platform.hasPhysicalKeyboard) host.blurAndClearSelection();
          self.updateSearch();
        });
        component.containerEl.hide();
      });
    self.tree = new host.Tree(self, {
      app: self.app,
      containerEl: self.contentEl,
      id: ALL_PROPERTIES_VIEW,
      scope: self.scope,
    });
    self.propertyRenameScope = new host.Scope(self.app.scope);
    self.propertyRenameScope.register([], "Enter", self.onKeyEnterInRename.bind(self));
    self.propertyRenameScope.register([], "Escape", self.cancelRename.bind(self));
    containerEl.addEventListener("click", () => self.tree.setFocusedItem(null));
    return self;
  }
  inherit(AllPropertiesView, Base);
  const proto = AllPropertiesView.prototype;

  proto.onload = function () {
    const self = this;
    this.registerEvent(this.app.vault.on("delete", this.requestUpdate, this));
    this.registerEvent(this.app.metadataCache.on("finished", this.requestUpdate, this));
    this.registerEvent(this.app.metadataTypeManager.on("changed", this.requestUpdate, this));
    this.app.workspace.onLayoutReady(() => self.update());
  };

  proto.startRename = function (item) {
    if (this.propertyBeingRenamed) this.cancelRename();
    else {
      this.propertyBeingRenamed = item;
      this.app.keymap.pushScope(this.propertyRenameScope);
      item.startRename();
    }
  };

  proto.deleteProperty = async function (item) {
    const selfEl = item.selfEl.addClass("is-cut");
    const name = item.property.name;
    try {
      await this.app.fileManager.deleteProperty(name);
    } finally {
      selfEl.removeClass("is-cut");
    }
  };

  proto.onKeyEnterInRename = function (event) {
    if (event.isComposing) return;
    event.preventDefault();
    this.acceptRename(this.propertyBeingRenamed);
  };

  proto.exitRename = function () {
    const item = this.propertyBeingRenamed;
    this.propertyBeingRenamed = null;
    item.stopRename();
    this.app.keymap.popScope(this.propertyRenameScope);
  };

  proto.cancelRename = function () {
    const item = this.propertyBeingRenamed;
    if (item) {
      item.updateTitle();
      this.exitRename();
    }
  };

  proto.acceptRename = async function (item) {
    if (!item || item !== this.propertyBeingRenamed) return;
    this.exitRename();
    const oldKey = item.property.name;
    const newKey = item.titleEl.getText().trim();
    if (oldKey === newKey) {
      item.updateTitle();
      return;
    }
    if (newKey === "") {
      item.updateTitle();
      item.displayError(i18n.properties.msgEmptyPropertyName());
      return;
    }
    const infos = this.app.metadataCache.getAllPropertyInfos();
    const needsConfirm = Object.hasOwn(infos, newKey);
    if (needsConfirm) {
      const ok = await new (env().ib(this.app))
        .setTitle(propI18n.msgMergePropertiesWarning({ oldKey, newKey }))
        .setContent(propI18n.msgMergePropertiesWarningDesc({ oldKey }))
        .setCta("mod-cta", i18n.dialogue.buttonSave())
        .prompt();
      if (!ok) {
        item.updateTitle();
        return;
      }
    }
    try {
      await this.app.fileManager.renameProperty(oldKey, newKey);
      const dom = this.doms[newKey];
      this.tree.infinityScroll.scrollIntoView(dom, 4);
      if (needsConfirm) env().Iv(dom.selfEl);
    } catch (e) {
      item.updateTitle();
    }
  };

  proto.onToggleShowSearch = function () {
    this.setShowSearch(!this.isShowingSearch);
    if (this.isShowingSearch) this.searchComponent.inputEl.focus();
  };

  proto.showSearch = function () {
    this.setShowSearch(true);
    this.searchComponent.inputEl.focus();
  };

  proto.setShowSearch = function (show) {
    if (show === this.isShowingSearch) return;
    this.isShowingSearch = show;
    this.searchComponent.containerEl.toggle(show);
    this.showSearchButtonEl.toggleClass("is-active", show);
    if (!show) {
      this.searchComponent.setValue("");
      this.updateSearch();
    }
    this.app.workspace.requestSaveLayout();
  };

  proto.updateSearch = function () {
    const value = this.searchComponent.getValue();
    const previous = this.searchQuery;
    if (previous && !value) {
      this.searchQuery = null;
    } else if (!previous && !value) {
      return;
    } else if (!previous || previous.query !== value) {
      try {
        if (value) {
          const query = new (env().BH(this.app, value, false));
          this.searchQuery = query.matcher ? query : null;
        } else {
          this.searchQuery = null;
        }
        this.update();
      } catch (e) {
        console.log(e);
      }
    }
  };

  proto.isItem = function (item) {
    return item instanceof propertyItemClass;
  };

  proto.onKeyEnterInFocus = function (event) {
    event.preventDefault();
    if (this.isItem(this.tree.focusedItem)) this.tree.focusedItem.onSelfClick(event);
  };

  proto.getDisplayText = function () {
    return propI18n.nameGlobal();
  };

  proto.getViewType = function () {
    return ALL_PROPERTIES_VIEW;
  };

  proto.getState = function () {
    const state = Base.prototype.getState.call(this);
    state.sortOrder = this.sortOrder;
    state.showSearch = this.isShowingSearch;
    state.searchQuery = this.searchComponent.getValue();
    return state;
  };

  proto.setState = async function (state, result) {
    await Base.prototype.setState.call(this, state, result);
    const searchQuery = state.searchQuery;
    const showSearch = state.showSearch;
    const sortOrder = state.sortOrder;
    if (String.isString(sortOrder) && SORT_ORDERS.flat().includes(sortOrder)) this.sortOrder = sortOrder;
    if (isBoolean(showSearch)) this.setShowSearch(showSearch);
    if (String.isString(searchQuery)) {
      this.searchComponent.setValue(searchQuery);
      this.updateSearch();
    }
    this.update();
  };

  proto.setSortOrder = function (order) {
    this.sortOrder = order;
    this.update();
  };

  Object.defineProperty(proto, "root", {
    get() { return this.tree.infinityScroll.rootEl; },
    enumerable: false,
    configurable: true,
  });

  proto.onResize = function () {
    this.tree.infinityScroll.onResize();
  };

  proto.update = function () {
    const app = this.app;
    const doms = this.doms;
    const properties = app.metadataTypeManager.getAllProperties();
    this.doms = {};
    this.root.vChildren.clear();
    this.tree.focusedItem = null;
    if (Object.keys(properties).length === 0) {
      this.contentEl.appendChild(this.emptyStateEl);
    } else {
      this.emptyStateEl.detach();
      const order = this.sortOrder;
      let compare;
      if (order === "alphabetical") {
        compare = (a, b) => host.ub(a.property.name, b.property.name);
      } else if (order === "alphabeticalReverse") {
        compare = (a, b) => -host.ub(a.property.name, b.property.name);
      } else {
        const direction = order === "frequencyReverse" ? -1 : 1;
        compare = (a, b) => {
          const aName = a.property.name.toLowerCase();
          const bName = b.property.name.toLowerCase();
          const aCount = properties[aName]?.occurrences ?? 0;
          const bCount = properties[bName]?.occurrences ?? 0;
          return aCount === bCount ? host.ub(aName, bName) : direction * (bCount - aCount);
        };
      }
      for (const [name, info] of Object.entries(properties)) {
        if (this.searchQuery && !this.searchQuery.matchContent(name)) continue;
        const item = doms[name] || new propertyItemClass(this);
        item.setProperty(info);
        this.root.vChildren.addChild(item);
        this.doms[name] = item;
      }
      this.root.vChildren.sort(compare);
    }
    this.tree.infinityScroll.queueCompute();
  };

  return AllPropertiesView;
}

// Per-file properties pane (was `M7`).
export function s35FilePropertiesView(host) {
  const Base = env().gJ;
  const i18n = host.i18n;
  const propI18n = propsI18n(host);

  function FilePropertiesView(leaf, plugin) {
    const self = Base.call(this, leaf) || this;
    self.icon = "lucide-info";
    self.modifyingFile = null;
    self.rawFrontmatter = null;
    self.frontmatter = {};
    self.plugin = plugin;
    self.scope = new host.Scope(self.app.scope);
    self.contentEl.addEventListener("click", (event) => {
      if (event.target === self.contentEl) self.metadataEditor.containerEl.focus();
    });
    self.metadataEditor = new host.MetadataEditor(self.app, self);
    self.contentEl.appendChild(self.metadataEditor.containerEl);
    self.addChild(self.metadataEditor);
    self.contentEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (event.targetNode === self.contentEl && self.isSupportedFile(self.file)) {
        self.metadataEditor.showPropertiesMenu(event);
      }
    });
    self.emptyStateEl = self.contentEl.createDiv({ cls: "pane-empty", text: propI18n.labelNoProperties() });
    self.updateEmptyState();
    return self;
  }
  inherit(FilePropertiesView, Base);
  const proto = FilePropertiesView.prototype;

  proto.setEphemeralState = function (state) {
    Base.prototype.setEphemeralState.call(this, state);
    if (state.focus) this.metadataEditor.containerEl.focus();
  };

  proto.onload = function () {
    this.registerEvent(this.app.vault.on("modify", this.onFileChange, this));
    this.registerEvent(this.app.workspace.on("quick-preview", this.onQuickPreview, this));
  };

  proto.canAcceptExtension = function () { return true; };
  proto.getFile = function () { return this.file; };
  proto.getHoverSource = function () { return "properties"; };
  proto.canShowProperties = function () { return true; };
  proto.shiftFocusAfter = function () {};
  proto.shiftFocusBefore = function () {};
  proto.onMarkdownFold = function () {};

  proto.handleCut = function (event) { this.metadataEditor.handleCut(event); };
  proto.handleCopy = function (event) { this.metadataEditor.handleCopy(event); };
  proto.handlePaste = function (event) {
    if (event.clipboardData.getData("basalt/properties")) this.metadataEditor.handlePaste(event);
  };

  proto.saveFrontmatter = function (frontmatter) {
    const file = this.file;
    const modifying = this.modifyingFile;
    if (file && file.extension === "md" && file === modifying) {
      this.app.vault.process(file, (content) => env().kI(content, frontmatter));
    }
  };

  proto.isSupportedFile = function (file) {
    return !!file && file.extension === "md";
  };

  proto.readSupportedFile = async function (file) {
    if (!this.isSupportedFile(file)) return "";
    return this.app.vault.cachedRead(file);
  };

  proto.onLoadFile = async function (file) {
    const content = await this.readSupportedFile(file);
    this.updateFrontmatter(file, content);
    if (this.isSupportedFile(file)) this.modifyingFile = file;
    await Base.prototype.onLoadFile.call(this, file);
  };

  proto.onUnloadFile = async function (file) {
    this.modifyingFile = null;
    this.updateFrontmatter(null, "");
    this.rawFrontmatter = null;
    this.metadataEditor.clear();
    await Base.prototype.onUnloadFile.call(this, file);
  };

  proto.onQuickPreview = function (file, content) {
    if (file === this.file) {
      this.updateFrontmatter(file, content);
      this.requestUpdate();
    }
  };

  proto.onFileChange = async function (file) {
    if (file === this.file) {
      const content = await this.readSupportedFile(file);
      this.updateFrontmatter(file, content);
      this.requestUpdate();
    }
  };

  proto.getDisplayText = function () {
    if (!this.file || host.Platform.isMobile) return propI18n.nameLocal();
    return propI18n.tabTitle({ displayText: Base.prototype.getDisplayText.call(this) });
  };

  proto.getViewType = function () {
    return FILE_PROPERTIES_VIEW;
  };

  proto.updateFrontmatter = function (file, content) {
    if (!this.isSupportedFile(file)) {
      this.rawFrontmatter = null;
      this.frontmatter = null;
      return;
    }
    const raw = frontmatterBounds(content).frontmatter;
    if (this.rawFrontmatter === null || this.rawFrontmatter !== raw) {
      this.rawFrontmatter = raw;
      try {
        const parsed = env().mA(raw) ?? {};
        if (typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Frontmatter must be a valid object!");
        }
        this.frontmatter = parsed;
      } catch (e) {
        this.frontmatter = null;
      }
    }
  };

  proto.updateEmptyState = function () {
    const unsupported = !this.isSupportedFile(this.file);
    this.metadataEditor.containerEl.toggle(!unsupported);
    this.emptyStateEl.toggle(unsupported);
  };

  proto.update = function () {
    this.metadataEditor.synchronize(this.frontmatter);
    this.updateEmptyState();
  };

  return FilePropertiesView;
}
