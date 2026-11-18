// ng06 layout views: CardsView (`f4`), ListView (`x4`) and their building
// blocks — CardsGroupHeader (`m4`), CardsProperty (`g4`), CardsItem (`v4`),
// ListProperty (`A4`), ListGroup (`T4`), ListItem (`D4`) — plus the view
// switcher modal (`J4`) and the summary menu pages (`L4`, `I4`, `O4`).
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { s13VisibleRect, s13ScrollWatch } from "./s13-geom.js";
import { s13RowHeightDefault } from "./s13-consts.js";
import { ng06Div, ng06El, ng06Span, ng06Icon, ng06T, ng06CardsT, ng06ListT, ng06Idle, ng06IsEmptyValue } from "./n-g06-shared.js";

const ng06BasesStrings = () => env().gm.plugins.bases;

// ---------------------------------------------------------------- cards

/** `m4` — group header block of the cards view. */
export function ng06CardsGroupHeader() {
  function CardsGroupHeader(view) {
    this.view = view;
    this.containerEl = null;
    this.groupHeadingEl = null;
  }
  CardsGroupHeader.prototype.render = function (group) {
    if (!this.containerEl) {
      this.containerEl = ng06Div("bases-cards-group");
      this.groupHeadingEl = this.containerEl.createDiv("bases-group-heading");
    }
    const heading = this.view.createGroupHeadingEl(group);
    if (heading) {
      this.containerEl.empty();
      this.containerEl.appendChild(heading);
      this.groupHeadingEl = heading;
    } else {
      this.groupHeadingEl = null;
    }
  };
  return CardsGroupHeader;
}

/** `g4` — one property line of a card. */
export function ng06CardsProperty(host) {
  function CardsProperty(view, prop) {
    this.view = view;
    this.prop = prop;
    this.el = ng06Div("bases-cards-property");
    this.labelEl = this.el.createDiv("bases-cards-label");
    this.lineEl = this.el.createDiv("bases-cards-line");
    this.renderer = null;
  }
  CardsProperty.prototype.render = function (entry) {
    const view = this.view;
    try { this.labelEl.setText(view.config ? view.config.getDisplayName(this.prop) : this.prop); } catch (e) {}
    if (this.renderer && this.renderer.destroy) this.renderer.destroy();
    this.lineEl.empty();
    this.renderer = view.createRenderer(this.prop, this.lineEl);
    if (this.renderer && this.renderer.render) this.renderer.render(entry);
  };
  return CardsProperty;
}

/** `v4` — one card in the cards view. */
export function ng06CardsItem(host) {
  function CardsItem(view) {
    this.view = view;
    this.el = ng06Div("bases-cards-item");
    this.entry = null;
    this.props = [];
    this.coverEl = null;
    this.imageValue = null;
    const self = this;
    this.el.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button > 1) return;
      if (!self.entry) return;
      const sel = self.el.win.getSelection && self.el.win.getSelection();
      if (sel && !sel.isCollapsed && self.el.contains(sel.anchorNode)) return;
      if (e.target.closest && e.target.closest("a")) return;
      view.app.workspace.openLinkText(self.entry.file.path, "", e.isModEvent ? e.isModEvent() : env().Bg.isModEvent(e));
    });
    this.el.addEventListener("contextmenu", (e) => self.showMenu(e));
    return this;
  }
  CardsItem.prototype.render = function (entry, properties) {
    this.entry = entry;
    const view = this.view;
    const keep = new Set(properties);
    // reconcile property lines
    const wanted = [];
    for (const prop of properties) {
      let p = this.props.find((x) => x.prop === prop);
      if (!p) { p = new (host.s13CardsProperty)(view, prop); this.props.push(p); }
      wanted.push(p);
    }
    this.props = this.props.filter((p) => keep.has(p.prop));
    // title modifier on the first property
    wanted.forEach((p, i) => p.el.toggleClass("mod-title", i === 0));
    this.el.setChildrenInPlace(wanted.map((p) => { p.render(entry); return p.el; }));
    this.updateCover(entry);
  };
  CardsItem.prototype.updateCover = function (entry) {
    const view = this.view;
    const imageProp = view.imageProp;
    if (!imageProp) { if (this.coverEl) { this.coverEl.detach(); this.coverEl = null; } this.imageValue = null; return; }
    let value = null;
    try { value = entry.getValue(imageProp); } catch (e) {}
    if (value instanceof env().SW && value.length() > 0) { try { value = value.get(0); } catch (e) {} }
    if (value == null || value === env().bW.value) { if (this.coverEl) { this.coverEl.detach(); this.coverEl = null; } return; }
    if (env().gW.equals(value, this.imageValue)) return;
    this.imageValue = value;
    if (!this.coverEl) this.coverEl = this.el.createDiv("bases-cards-cover");
    let url = null;
    try {
      if (value instanceof env().NW) url = this.view.app.vault.getResourcePath(value.file || entry.file);
      else if (value instanceof env().BW) {
        const dest = this.view.app.metadataCache.getFirstLinkpathDest(value.data || value.toString(), entry.file.path);
        if (dest) url = this.view.app.vault.getResourcePath(dest);
      } else if (value instanceof env().CW) {
        const text = value.data;
        if (/^https?:\/\//.test(text)) url = text;
        else if (text.startsWith("file:///") && !env().Yl.isPhone) url = env().Yl.resourcePathPrefix + text.slice(7);
        else if (/^#[0-9a-fA-F]{6}$/.test(text)) { this.coverEl.setCssProps({ "background-color": text }); url = null; }
        else {
          const dest = this.view.app.metadataCache.getFirstLinkpathDest(text, entry.file.path);
          if (dest && host.imageExtensions.includes(dest.extension)) url = this.view.app.vault.getResourcePath(dest);
        }
      }
    } catch (e) {}
    if (url) {
      if (view.thumbnailer && view.thumbnailer.thumbnailBg) {
        try { view.thumbnailer.thumbnailBg(this.coverEl, url); return; } catch (e) {}
      }
      this.coverEl.setCssProps({ "background-image": `url("${url}")` });
    }
  };
  CardsItem.prototype.showMenu = function (event) {
    const view = this.view, entry = this.entry;
    if (!entry) return;
    const menu = host.Menu.forEvent(event).addSections([
      "title", "open", "action-primary", "action", "info", "view", "system", "", "danger",
    ]);
    const file = entry.file;
    view.app.workspace.handleLinkContextMenu(menu, file.path, event);
    menu.addItem((item) => item
      .setSection("danger")
      .setTitle(env().gm.interface.menu.deleteFile())
      .setIcon("lucide-trash-2")
      .setWarning(true)
      .onClick(() => view.app.fileManager.promptForDeletion(file)));
    menu.showAtMouseEvent ? menu.showAtMouseEvent(event) : menu;
  };
  return CardsItem;
}

/** `f4` — the `cards` view (`type="cards"`). */
export function ng06CardsView(host) {
  function CardsView(controller, scrollEl) {
    const self = host.s13BasesViewBase.call(this, controller) || this;
    self.type = "cards";
    self.scrollEl = scrollEl || controller.viewContainerEl;
    self.containerEl = self.scrollEl.createDiv({ cls: "bases-cards-container is-loading", attr: { tabIndex: 0 } });
    self.groups = [];
    self.items = [];
    self.unusedItems = [];
    self.measurements = {};
    self.imageProp = null;
    self.imageFitContain = false;
    self.imageAspectRatio = 1;
    self.lastScroll = { top: 0 };
    self.pendingScroll = null;
    self.lastViewport = null;
    self.testers = null;
    self.thumbnailer = new (host.s13Thumbnailer)();
    self._watcher = null;
    return self;
  }
  inherit(CardsView, host.s13BasesViewBase);

  CardsView.prototype.onload = function () {
    const self = this;
    this._watcher = s13ScrollWatch(this.containerEl, () => self.updateVirtualDisplay());
    this.registerEvent(this.app.workspace.on("css-change", () => self.updateVirtualDisplay()));
  };
  CardsView.prototype.onunload = function () {
    if (this._watcher) { this._watcher(); this._watcher = null; }
  };
  CardsView.prototype.onResize = function () { this.updateVirtualDisplay(); };
  CardsView.prototype.focus = function () { this.containerEl.focus({ preventScroll: true }); };
  CardsView.prototype.onDataUpdated = function () {
    this.containerEl.removeClass("is-loading");
    this.display();
  };

  CardsView.prototype.display = function () {
    const data = this.data, config = this.config;
    const container = this.containerEl;
    if (!data || !config) { container.empty(); return; }
    // view options
    this.imageProp = config.get("image") || null;
    this.imageFitContain = config.get("imageFit") === "contain";
    const ratio = parseFloat(config.get("imageAspectRatio"));
    this.imageAspectRatio = ratio > 0 ? ratio : 1;
    // reconcile groups
    const grouped = data.groupedData || [];
    const els = [];
    for (let i = 0; i < grouped.length; i++) {
      let group = this.groups[i];
      if (!group) group = this.groups[i] = { header: new (host.s13CardsGroupHeader)(this), items: [] };
      group.header.render(grouped[i]);
      const groupEl = group.header.containerEl;
      const props = data.properties || [];
      const itemEls = [];
      for (const entry of grouped[i].entries) {
        let item = group.items.find((it) => it.entry === entry);
        if (!item) { item = new (host.s13CardsItem)(this); item.render(entry, props); group.items.push(item); }
        else item.render(entry, props);
        itemEls.push(item.el);
      }
      groupEl.setChildrenInPlace([groupEl.firstChild].filter(Boolean).concat(itemEls));
      // keep heading first
      const heading = group.header.groupHeadingEl;
      if (heading) groupEl.setChildrenInPlace([heading].concat(itemEls));
      els.push(groupEl);
    }
    if (this.groups.length > grouped.length) this.groups.length = grouped.length;
    container.setChildrenInPlace(els);
    this.updateVirtualDisplay();
  };

  CardsView.prototype.updateVirtualDisplay = function () {
    const data = this.data, config = this.config, el = this.containerEl;
    if (!(data && config && el.isShown())) return;
    const scrollTop = el.scrollTop || 0;
    const total = el.scrollHeight || 0;
    this.lastScroll = total ? { top: scrollTop / total } : { top: 0 };
    if (this.pendingScroll) {
      const h = el.scrollHeight;
      if (h) { el.scrollTop = h * this.pendingScroll.top; this.lastScroll = this.pendingScroll; this.pendingScroll = null; }
    }
  };

  CardsView.prototype.setEphemeralState = function (state) {
    const scroll = state && state.scroll;
    if (scroll && typeof scroll === "object") this.pendingScroll = scroll;
  };
  CardsView.prototype.getEphemeralState = function () { return { scroll: this.lastScroll }; };

  CardsView.getViewOptions = function () {
    const t = ng06BasesStrings().cards;
    const b = ng06BasesStrings();
    return [
      { displayName: t.labelCardSize(), key: "cardSize", type: "slider", min: 50, max: 800, step: 10, default: 200 },
      { displayName: t.labelImageProperty(), key: "image", type: "property", placeholder: b.labelPropertyKey(), filter: (id) => !(id.startsWith("file.") && id !== "file.file") },
      { displayName: t.labelImageFit(), key: "imageFit", type: "dropdown", options: { "": t.optionImageFitCover(), "contain": t.optionImageFitContain() } },
      { displayName: t.labelImageAspectRatio(), key: "imageAspectRatio", type: "slider", min: 0.25, max: 2.5, step: 0.05, default: 1 },
    ];
  };
  return CardsView;
}

// ---------------------------------------------------------------- list

/** `A4` — one property of a list item. */
export function ng06ListProperty(host) {
  function ListProperty(view, propertyId) {
    this.view = view;
    this.propertyId = propertyId;
    this.el = null;
    this.renderer = null;
    this.entry = null;
  }
  ListProperty.prototype.render = function (entry) {
    this.entry = entry;
    const view = this.view;
    let value;
    try { value = entry.getValue(this.propertyId); } catch (e) { value = null; }
    if (ng06IsEmptyValue(value, env())) return null;
    const el = this.el || (this.el = ng06Div("bases-list-property"));
    if (this.renderer && this.renderer.destroy) this.renderer.destroy();
    el.empty();
    if (this.propertyId === "file.name") this.renderer = view.createRenderer(this.propertyId, el);
    else this.renderer = new (host.s13PropValueRenderer)(view, this.propertyId, el);
    if (this.renderer && this.renderer.render) this.renderer.render(entry);
    return el;
  };
  return ListProperty;
}

/** `T4` — group of the list view. */
export function ng06ListGroup(host) {
  function ListGroup(view, group) {
    this.view = view;
    this.group = group;
    this.containerEl = ng06Div("bases-list-group");
    this.groupHeadingEl = this.containerEl.createDiv("bases-group-heading");
    this.listEl = this.containerEl.createDiv("bases-list-group-list");
    this.rows = [];
    this.height = 0;
    this.measured = false;
    this.headerHeight = 0;
    const heading = view.createGroupHeadingEl(group);
    if (heading) this.groupHeadingEl.replaceWith ? this.groupHeadingEl.replaceWith(heading) : null;
    else this.groupHeadingEl.detach();
    if (heading) this.groupHeadingEl = heading;
  }
  ListGroup.prototype.render = function (viewport, budget) {
    const view = this.view;
    const entries = (this.group && this.group.entries) || [];
    const rows = [];
    let produced = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let row = this.rows.find((r) => r.entry === entry);
      if (!row) { row = new (host.s13ListItem)(view); row.render(i); this.rows.push(row); }
      else row.render(i);
      if (row.isEmpty && !row.isEmpty()) produced++;
      rows.push(row.el);
      if (budget && produced >= budget) break;
    }
    this.listEl.setChildrenInPlace(rows);
    this.measured = true;
    return produced;
  };
  return ListGroup;
}

/** `D4` — one list-view row. */
export function ng06ListItem(host) {
  function ListItem(view) {
    this.view = view;
    this.el = ng06Div("bases-list-item");
    this.propertiesEl = this.el.createDiv("bases-list-item-properties");
    this.additionalPropertiesEl = null;
    this.cells = [];
    this.entry = null;
    this.index = -1;
    this.measured = false;
    this.height = 0;
  }
  ListItem.prototype.isEmpty = function () {
    return !this.propertiesEl.firstChild;
  };
  ListItem.prototype.isInViewport = function () { return true; };
  ListItem.prototype.render = function (index) {
    if (this.index === index && this.entry) return false;
    this.index = index;
    return true;
  };
  return ListItem;
}

/** `x4` — the `list` view (`type="list"`). */
export function ng06ListView(host) {
  function ListView(controller, scrollEl) {
    const self = host.s13BasesViewBase.call(this, controller) || this;
    self.type = "list";
    self.scrollEl = scrollEl || controller.viewContainerEl;
    self.containerEl = self.scrollEl.createDiv({ cls: "bases-list-container is-loading", attr: { tabIndex: 0 } });
    self.groups = [];
    self.rowsMap = new WeakMap();
    self.measurements = {};
    self.propertySeparator = ", ";
    self.order = [];
    self.lastContainerElWidth = 0;
    self.precalcQueued = false;
    self.renderQueued = false;
    self.lastRenderedViewport = null;
    self.hoverPopover = null;
    self._watcher = null;
    return self;
  }
  inherit(ListView, host.s13BasesViewBase);

  ListView.prototype.onload = function () {
    const self = this;
    this._watcher = s13ScrollWatch(this.containerEl, () => self.updateVirtualDisplay());
    this.registerEvent(this.app.workspace.on("css-change", () => self.updateVirtualDisplay()));
  };
  ListView.prototype.onunload = function () {
    if (this._watcher) { this._watcher(); this._watcher = null; }
  };
  ListView.prototype.onResize = function () {
    if (this.containerEl.clientWidth !== this.lastContainerElWidth) this.invalidateCache();
    this.updateVirtualDisplay();
  };
  ListView.prototype.focus = function () { this.containerEl.focus({ preventScroll: true }); };

  ListView.getMarkers = function (config) {
    const m = config && config.get ? config.get("markers") : null;
    return m === "number" || m === "none" ? m : "bullet";
  };
  ListView.getViewOptions = function (config) {
    const t = ng06BasesStrings().list;
    return [
      { displayName: t.labelMarkers(), key: "markers", type: "dropdown", default: "bullet", options: { bullet: t.optionBullet(), number: t.optionNumber(), none: t.optionNone() } },
      { displayName: t.labelIndentProperties(), key: "indentProperties", type: "toggle", default: false },
      { displayName: t.labelPropertySeparator(), key: "separator", type: "text", default: ", ", shouldHide: (v) => !!(v && v.get && v.get("indentProperties")) },
    ];
  };

  ListView.prototype.onDataUpdated = function () {
    this.containerEl.removeClass("is-loading");
    const data = this.data, config = this.config;
    if (!data || !config) { this.containerEl.empty(); return; }
    this.propertySeparator = config.get("separator") || ", ";
    this.order = config.getOrder() || [];
    this.invalidateCache();
    this.containerEl.toggleClass("show-indentation-guide", !!this.app.vault.getConfig("showIndentGuide"));
    this.updateVirtualDisplay(true);
  };

  ListView.prototype.invalidateCache = function () {
    const data = this.data;
    this.groups = [];
    this.rowsMap = new WeakMap();
    this.measurements = {};
    const grouped = (data && data.groupedData) || [];
    for (const g of grouped) this.groups.push(new (host.s13ListGroup)(this, g));
    this.queueRender();
  };
  ListView.prototype.queueRender = function () { ng06Idle(() => this.updateVirtualDisplay(true), 10); };
  ListView.prototype.getRowForEntry = function (entry) {
    let row = this.rowsMap.get(entry);
    if (!row) { row = new (host.s13ListItem)(this); this.rowsMap.set(entry, row); }
    return row;
  };
  ListView.prototype.getAverageRowHeight = function () { return 60; };
  ListView.prototype.addMeasuredRow = function () {};

  ListView.prototype.updateVirtualDisplay = function (force) {
    const data = this.data;
    if (!data) return;
    const els = this.groups.map((g) => { g.render(null, 10); return g.containerEl; });
    this.containerEl.setChildrenInPlace(els);
    this.lastRenderedViewport = s13VisibleRect(this.containerEl);
  };

  ListView.prototype.setEphemeralState = function (state) {
    const scroll = state && state.scroll;
    if (scroll && typeof scroll === "object") this.pendingScroll = scroll;
  };
  ListView.prototype.getEphemeralState = function () { return { scroll: this.lastScroll || { top: 0 } }; };

  return ListView;
}

// ---------------------------------------------------------------- misc s13 views classes

/** `J4` — modal listing the query's view names for `bases:change-view`. */
export function ng06ViewSwitcherModal(host) {
  const Base = host.Modal || host.Component;
  function ViewSwitcherModal(app, controller, names) {
    const self = host.s13BasesViewBase.call(this) || this;
    self.app = app;
    self.controller = controller;
    self.names = names || [];
    return self;
  }
  inherit(ViewSwitcherModal, host.s13BasesViewBase);
  ViewSwitcherModal.prototype.onOpen = function () {
    const contentEl = this.contentEl || this.containerEl;
    if (!contentEl) return;
    contentEl.empty();
    for (const name of this.names) {
      const item = contentEl.createDiv("suggestion-item");
      item.setText(name);
      item.addEventListener("click", () => { this.controller.selectView(name); this.close(); });
    }
  };
  ViewSwitcherModal.prototype.open = function () { if (this.openModal) this.openModal(); else if (this.show) this.show(); };
  ViewSwitcherModal.prototype.close = function () { if (this.closeModal) this.closeModal(); };
  return ViewSwitcherModal;
}

/** `L4` — summary picker menu for a column/group summary cell. */
export function ng06SummaryMenu(host) {
  function SummaryMenuController(queryController, config, prop, summaryValues, anchorEl) {
    const self = this;
    this.queryController = queryController;
    this.config = config;
    this.prop = prop;
    this.summaryValues = summaryValues;
    this.anchorEl = anchorEl;
    this.menu = null;
    this.isOpenFn = () => !!(self.menu && self.menu.isOpen);
    this.open();
    return this;
  }
  SummaryMenuController.prototype.open = function () {
    const self = this;
    const app = this.queryController.app;
    const menu = this.menu = new (host.Menu)();
    const formulas = env().$K ? env().$K(this.summaryValues.constructor ? null : null) : null;
    const names = this.summaryValues && this.summaryValues.formulas ? Object.keys(this.summaryValues.formulas) : [];
    const keys = names.length ? names : ["sum", "avg", "min", "max", "count", "earliest", "latest"];
    for (const name of keys) {
      menu.addItem((item) => item
        .setTitle(name)
        .setChecked(this.config.getSummaryKey && this.config.getSummaryKey(this.prop) === name)
        .onClick(() => {
          this.config.setSummaryKey(this.prop, name);
          this.close();
        }));
    }
    const rect = this.anchorEl.getBoundingClientRect ? this.anchorEl.getBoundingClientRect() : { x: 0, y: 0, bottom: 0 };
    menu.showAtPosition({ x: rect.x || 0, y: (rect.bottom || rect.y || 0) });
  };
  SummaryMenuController.prototype.close = function () { if (this.menu) this.menu.hide(); };
  return SummaryMenuController;
}

/** `I4` — page listing summary formulas (property pick). */
export function ng06SummaryFormulaListPage(host) {
  function SummaryFormulaListPage(controller) {
    this.controller = controller;
    this.containerEl = ng06Div("bases-toolbar-menu-container");
  }
  SummaryFormulaListPage.prototype.onShow = function () {};
  return SummaryFormulaListPage;
}

/** `O4` — page editing one summary formula. */
export function ng06SummaryFormulaPage(host) {
  function SummaryFormulaPage(controller) {
    this.controller = controller;
    this.containerEl = ng06Div("bases-toolbar-menu-container");
  }
  SummaryFormulaPage.prototype.onShow = function () {};
  return SummaryFormulaPage;
}
