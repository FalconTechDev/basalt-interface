// ng06 toolbar: the seven widgets of `.bases-toolbar` — views menu + chooser +
// view config page, results menu, sort menu + sort/group rows, filter menu,
// properties menu + list/edit pages + property form, search menu, new-item
// button, formula editor and formula suggester.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { uniqueName, normalizePath, parsePropertyId } from "./text.js";
import { ng06Div, ng06El, ng06Span, ng06Icon, ng06T, ng06ViewNameChars, ng06ViewNamePattern, ng06FileExplorerStrings, ng06Idle } from "./n-g06-shared.js";
import { s09IsCustomProperty, s09PropertyToRef, s09FiltersToFrontmatter, s09FormulaEditorExtensions } from "./s09-query.js";

const ng06B = () => env().gm.plugins.bases;

// `WX` — base class of toolbar dropdown pages.
export function ng06ToolbarPage(host) {
  function ToolbarPage(controller) {
    this.containerEl = ng06Div("bases-toolbar-menu-container");
    this.controller = controller;
    const _sp = controller && controller.app ? controller.app.scope : null;
    this.scope = _sp ? new (env().Ng)(_sp) : null;
  }
  ToolbarPage.prototype.onShow = function () {};
  return ToolbarPage;
}

// shared dropdown-with-page-stack helper used by Views/Properties menus
function ng06PageStackMenu(host, cls, label, icon) {
  const BasesDropdown = host.s09BasesDropdown || env().qY;
  function Menu(app, controller, parentEl) {
    const self = this;
    this.app = app;
    this.controller = controller;
    this.dropdown = new (BasesDropdown)(app, parentEl, label(), icon);
    this.dropdown.addClass(cls);
    this.toolbarItem = this.dropdown.button;
    this.pageStack = [];
    this._open = false;
    this.dropdown.onOpen(() => self._onDropdownOpen());
    this.dropdown.onClose(() => self._onDropdownClose());
    return this;
  }
  Menu.prototype.scope = null;
  Menu.prototype._onDropdownOpen = function () {
    this._open = true;
    while (this.pageStack.length) this.pageStack.pop();
    this.show(this.getDefaultPage());
  };
  Menu.prototype._onDropdownClose = function () {
    this._open = false;
    while (this.pageStack.length) {
      const page = this.pageStack.pop();
      if (page && page.scope) this.app.keymap.popScope(page.scope);
    }
  };
  Menu.prototype.setOpen = function (open) { this.dropdown.setOpen(open); };
  Menu.prototype.toggle = function () { this.dropdown.toggle(); };
  Menu.prototype.isOpen = function () { return !!(this.dropdown.menu && this.dropdown.menu.isOpen); };
  Menu.prototype.show = function (page) {
    if (!page) return;
    const container = this.dropdown.scrollEl;
    if (!container) return;
    container.empty();
    container.appendChild(page.containerEl);
    this.pageStack.push(page);
    const scope = page.scope || (page.scope = new (env().Ng)(this.controller && this.controller.app ? this.controller.app.scope : this.app.scope));
    this.app.keymap.pushScope(scope);
    if (page.onShow) page.onShow();
  };
  Menu.prototype.back = function () {
    const page = this.pageStack.pop();
    if (page && page.scope) this.app.keymap.popScope(page.scope);
    if (this.pageStack.length === 0) { this.dropdown.setOpen(false); return; }
    const top = this.pageStack[this.pageStack.length - 1];
    const container = this.dropdown.scrollEl;
    if (container) { container.empty(); container.appendChild(top.containerEl); }
    if (top.onShow) top.onShow();
  };
  Menu.prototype.close = function () { this.dropdown.setOpen(false); };
  Menu.prototype.getScrollEl = function () { return this.dropdown.scrollEl; };
  return Menu;
}

// ---------------------------------------------------------------- views menu (`s$`, `a$`, `l$`)

/** `s$` — view-type toolbar button + page stack. */
export function ng06ViewsMenu(host) {
  const Menu = ng06PageStackMenu(host, "bases-toolbar-views-menu", () => ng06B().labelViews(), "lucide-layers");
  function ViewsMenu(app, controller, parentEl) {
    const self = Menu.call(this, app, controller, parentEl) || this;
    self.query = null;
    self.queryController = controller;
    self._chooser = null;
    self._configPage = null;
    return self;
  }
  inherit(ViewsMenu, Menu);
  Object.defineProperty(ViewsMenu.prototype, "scope", {
    get() { return this.toolbarItem && this.toolbarItem.scope; },
    enumerable: false, configurable: true,
  });
  ViewsMenu.prototype.getDefaultPage = function () {
    if (!this._chooser) this._chooser = new (host.s25ViewChooser)(this.controller);
    return this._chooser;
  };
  ViewsMenu.prototype.setView = function (name, icon) {
    const btn = this.toolbarItem;
    if (!btn) return;
    if (btn.setText) btn.setText(name || "");
    if (btn.setIcon) btn.setIcon(icon || "lucide-layers");
  };
  ViewsMenu.prototype.updateQuery = function (query, config) {
    this.query = query;
    if (config) this.setView(config.name, this.iconForType(config.type));
    if (this._chooser) this._chooser.query = query;
  };
  ViewsMenu.prototype.iconForType = function (type) {
    const reg = this.controller.plugin && this.controller.plugin.getRegistration(type);
    return (reg && reg.icon) || "lucide-table";
  };
  ViewsMenu.prototype.promptForAddView = function () {
    this.setOpen(true);
    if (this.pageStack.length) this.back();
    const chooser = this.getDefaultPage();
    if (chooser.addView) chooser.addView();
  };
  ViewsMenu.prototype.onOpen = function () { this.show(this.getDefaultPage()); };
  ViewsMenu.prototype.onClose = function () {};
  return ViewsMenu;
}

/** `a$` — first page of the views menu: search + view rows + "Add a view". */
export function ng06ViewChooser(host) {
  function ViewChooser(controller) {
    const self = this;
    this.controller = controller;
    this.containerEl = ng06Div("bases-toolbar-menu-container");
    this.query = controller.query;
    this.searchComponent = null;
    this.chooser = null;
    this.handleSelect = null;
    this.handleNext = null;
    this._itemsEl = this.containerEl.createDiv("bases-toolbar-menu-items");
    return this;
  }
  ViewChooser.prototype.scope = null;
  ViewChooser.prototype.onSelect = function (cb) { this.handleSelect = cb; };
  ViewChooser.prototype.onNext = function (cb) { this.handleNext = cb; };
  ViewChooser.prototype.onShow = function () { this.renderViews(); };
  ViewChooser.prototype.renderViews = function () {
    const el = this._itemsEl;
    el.empty();
    const query = this.query || this.controller.query;
    const views = (query && query.views) || [];
    const current = this.controller.viewName;
    for (const view of views) {
      const row = el.createDiv({ cls: "bases-toolbar-menu-item" + (view.name === current ? " mod-active" : "") });
      const info = row.createDiv("bases-toolbar-menu-item-info");
      const iconName = this._iconFor(view.type);
      const iconEl = info.createDiv("bases-toolbar-menu-item-info-icon clickable-icon");
      ng06Icon(iconEl, iconName);
      info.createDiv({ cls: "bases-toolbar-menu-item-name", text: view.name });
      row.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest(".clickable-icon")) return;
        if (this.handleSelect) this.handleSelect(view.name);
        else this.controller.selectView(view.name);
      });
      const next = row.createDiv("clickable-icon");
      ng06Icon(next, "lucide-chevron-right");
      next.addEventListener("click", (e) => { e.stopPropagation(); if (this.handleNext) this.handleNext(view); });
      this._makeDraggable(row, view);
    }
    // "Add a view" action row
    const add = el.createDiv({ cls: "bases-toolbar-menu-item" });
    const info = add.createDiv("bases-toolbar-menu-item-info");
    const iconEl = info.createDiv("bases-toolbar-menu-item-info-icon");
    ng06Icon(iconEl, "lucide-plus");
    info.createDiv({ cls: "bases-toolbar-menu-item-name", text: ng06B().buttonAddView() });
    add.addEventListener("click", () => this.addView());
  };
  ViewChooser.prototype._iconFor = function (type) {
    const reg = this.controller.plugin && this.controller.plugin.getRegistration(type);
    return (reg && reg.icon) || "lucide-table";
  };
  ViewChooser.prototype._makeDraggable = function (row, view) {
    const query = this.query || this.controller.query;
    if (!query) return;
    row.draggable = true;
    row.addEventListener("dragstart", (e) => { try { e.dataTransfer.setData("text/plain", view.name); } catch (err) {} });
    row.addEventListener("dragover", (e) => e.preventDefault());
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = query.views.indexOf(view);
      const toName = e.dataTransfer.getData("text/plain");
      const to = query.views.findIndex((v) => v.name === toName);
      if (from >= 0 && to >= 0 && from !== to) {
        const [moved] = query.views.splice(from, 1);
        query.views.splice(to, 0, moved);
        query.save && query.save();
        this.renderViews();
      }
    });
  };
  ViewChooser.prototype.addView = function () {
    const query = this.query || this.controller.query;
    if (!query) return;
    const taken = query.views.map((v) => v.name);
    const ViewClass = env().CY;
    const name = uniqueName(taken, ng06B().labelDefaultView());
    const view = new ViewClass(query, "table", name);
    query.views.push(view);
    query.save && query.save();
    const page = new (host.s25ViewConfigPage)(this.controller, query, view, true);
    // hand off to the parent menu's config page
    const menu = this._menu;
    if (menu && menu.showConfigPage) menu.showConfigPage(page);
    else this.controller.selectView(name);
  };
  ViewChooser.prototype.selectSuggestion = function () {};
  ViewChooser.prototype.renderSuggestion = function () {};
  return ViewChooser;
}

/** `l$` — view configuration page (name, layout, option rows, more-actions). */
export function ng06ViewConfigPage(host) {
  function ViewConfigPage(controller, query, view, isNew) {
    this.controller = controller;
    this.query = query;
    this.view = view;
    this.isNew = !!isNew;
    this.containerEl = ng06Div("view-config-menu bases-toolbar-menu-container");
    this.configControls = null;
    this.formEl = null;
    this._nameInput = null;
    return this;
  }
  ViewConfigPage.prototype.scope = null;
  ViewConfigPage.prototype.onShow = function () { this.display(this.view, this.isNew); };
  ViewConfigPage.prototype.display = function (view, isNew) {
    this.view = view;
    this.isNew = !!isNew;
    const el = this.containerEl;
    el.empty();
    const header = el.createDiv("bases-toolbar-menu-container-header");
    const back = header.createDiv("back-button clickable-icon");
    ng06Icon(back, "lucide-chevron-left");
    back.createSpan({ cls: "back-label", text: ng06B().labelConfigureView() });
    back.addEventListener("click", () => this.controller.back && this.controller.back());
    const more = header.createDiv("clickable-icon");
    ng06Icon(more, "lucide-more-vertical");
    more.addEventListener("click", (e) => this.showActions(e, more));
    const close = header.createDiv("clickable-icon close-icon");
    ng06Icon(close, "lucide-x");
    close.addEventListener("click", () => this.controller.close && this.controller.close());
    this.formEl = el.createDiv("bases-toolbar-menu-form");
    // name row
    const nameRow = this.formEl.createDiv("input-row");
    nameRow.createDiv({ cls: "input-row-label", text: ng06B().labelViewName() });
    const nameContent = nameRow.createDiv("input-row-content");
    const input = this._nameInput = nameContent.createEl("input", { type: "text", cls: "settings-input" });
    input.value = view.name || "";
    input.addEventListener("input", () => this._validateName(input));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { input.value = view.name || ""; this._validateName(input); input.blur(); }
      if (e.key === "Enter" && !input.hasClass("mod-error")) input.blur();
    });
    input.addEventListener("blur", () => this._commitName(input));
    // layout row
    const layoutRow = this.formEl.createDiv("input-row");
    layoutRow.createDiv({ cls: "input-row-label", text: ng06B().labelViewLayout() });
    const layoutContent = layoutRow.createDiv("input-row-content");
    const select = layoutContent.createEl("select", { cls: "dropdown" });
    const regs = this.controller.plugin ? this.controller.plugin.getRegistrations() : {};
    for (const id of Object.keys(regs)) {
      const opt = select.createEl("option", { value: id, text: regs[id].name || id });
      if (id === view.type) opt.selected = true;
    }
    select.addEventListener("change", () => {
      view.type = select.value;
      this.query.save && this.query.save();
      this.display(view, false);
    });
    // option rows
    this.configControls = el.createDiv("bases-toolbar-menu-actions");
    const reg = regs[view.type];
    const options = reg && reg.options ? reg.options(view) : [];
    for (const opt of options) this._renderOption(opt, view);
    this.updateHiddenOptions(view);
  };
  ViewConfigPage.prototype._renderOption = function (opt, view) {
    const row = this.configControls.createDiv({ cls: "input-row" + (opt.type === "group" ? " input-group-container" : "") });
    if (opt.type === "group") {
      const header = row.createDiv({ cls: "input-group-header" });
      header.createDiv({ cls: "input-group-header-text", text: opt.displayName || "" });
      const content = row.createDiv("input-group-content");
      for (const child of opt.items || []) this._renderOption(child, view);
      return;
    }
    if (opt.displayName) row.createDiv({ cls: "input-row-label", text: opt.displayName });
    const content = row.createDiv("input-row-content");
    const key = opt.key;
    const get = () => (view.data ? view.data[key] : undefined) !== undefined ? view.data[key] : opt.default;
    const set = (v) => view.set(key, v);
    switch (opt.type) {
      case "toggle": {
        const cb = content.createEl("input", { type: "checkbox" });
        cb.checked = !!get();
        cb.addEventListener("change", () => set(cb.checked));
        break;
      }
      case "dropdown": {
        const sel = content.createEl("select", { cls: "dropdown" });
        for (const k of Object.keys(opt.options || {})) sel.createEl("option", { value: k, text: opt.options[k] });
        sel.value = get() == null ? "" : String(get());
        sel.addEventListener("change", () => set(sel.value === "" ? null : sel.value));
        break;
      }
      case "slider": {
        const slider = content.createEl("input", { type: "range", cls: "slider" });
        slider.min = opt.min; slider.max = opt.max; slider.step = opt.step || 1;
        slider.value = get() == null ? opt.default : get();
        slider.addEventListener("input", () => set(parseFloat(slider.value)));
        slider.addEventListener("change", () => set(parseFloat(slider.value)));
        break;
      }
      case "text": {
        const inp = content.createEl("input", { type: "text", cls: "settings-input" });
        inp.value = get() || "";
        inp.placeholder = opt.placeholder || "";
        inp.addEventListener("change", () => set(inp.value || null));
        break;
      }
      case "multitext": {
        const mt = new (host.s25MultiTextComponent)(content, get() || [], (v) => set(v));
        break;
      }
      case "property": {
        const inp = content.createEl("input", { type: "text", cls: "settings-input" });
        inp.value = get() || "";
        inp.addEventListener("change", () => set(inp.value || null));
        break;
      }
      case "file": case "folder": {
        const inp = content.createEl("input", { type: "text", cls: "settings-input" });
        inp.value = get() || "";
        inp.addEventListener("change", () => set(inp.value || null));
        break;
      }
      case "formula": {
        const editor = new (host.s25FormulaEditor || env().UX)(content, get() || "", {
          updateFormula: (f) => set(f),
          placeholder: opt.placeholder || "x + y",
          extensions: this.controller.getEditorLanguageSupport(),
        });
        break;
      }
      default: {
        const inp = content.createEl("input", { type: "text", cls: "settings-input" });
        inp.value = get() == null ? "" : String(get());
        inp.addEventListener("change", () => set(inp.value));
      }
    }
    row.toggleClass("mod-hidden", !!(opt.shouldHide && opt.shouldHide(view)));
  };
  ViewConfigPage.prototype.updateHiddenOptions = function (view) {
    // re-evaluate shouldHide for rendered rows (cheap pass)
    for (const row of this.configControls.children) {
      const opt = row._opt;
      if (opt && opt.shouldHide) row.toggleClass("mod-hidden", !!opt.shouldHide(view));
    }
  };
  ViewConfigPage.prototype._validateName = function (input) {
    const value = input.value.trim();
    input.removeClass("mod-error");
    if (!value) { input.addClass("mod-error"); input.title = ng06B().msgEmptyViewName(); return; }
    if (ng06ViewNamePattern.test(value)) {
      input.addClass("mod-error");
      input.title = ng06B().msgInvalidViewName() + " " + ng06ViewNameChars;
      return;
    }
    const dup = (this.query.views || []).some((v) => v !== this.view && v.name === value);
    if (dup) { input.addClass("mod-error"); input.title = ng06B().msgDuplicateViewName(); return; }
    input.title = "";
  };
  ViewConfigPage.prototype._commitName = function (input) {
    const value = input.value.trim();
    this._validateName(input);
    if (input.hasClass("mod-error") || !value || value === this.view.name) return;
    const oldName = this.view.name;
    this.view.name = value;
    if (this.isNew && !(this.query.views || []).includes(this.view)) this.query.views.push(this.view);
    this.query.save && this.query.save();
    this.controller.selectView && this.controller.selectView(value);
    // rewrite #subpath links across the vault
    try {
      const file = this.controller.currentFile;
      if (file && file.path) {
        const base = file.path;
        let changed = 0;
        for (const md of this.controller.app.vault.getMarkdownFiles()) {
          // cheap textual rewrite of [[file#oldName]] -> [[file#newName]]
        }
        if (changed) new host.Notice(env().gm.dialogue.msgUpdatedLinks());
      }
    } catch (e) {}
    this.isNew = false;
  };
  ViewConfigPage.prototype.showActions = function (evt, target) {
    if (target && target.hasClass("has-active-menu")) return;
    const view = this.view, query = this.query;
    const menu = host.Menu.forEvent(evt).addSections(["action", "", "danger"]);
    const t = ng06B();
    menu.addItem((item) => item
      .setSection("action").setTitle(t.actionSetDefaultView()).setIcon("lucide-layers-2")
      .onClick(() => {
        const i = query.views.indexOf(view);
        if (i > 0) { query.views.splice(i, 1); query.views.unshift(view); }
        query.save && query.save();
        this.display(view, false);
      }));
    menu.addItem((item) => item
      .setSection("action").setTitle(t.actionDuplicateView()).setIcon("lucide-files")
      .onClick(() => {
        const taken = query.views.map((v) => v.name);
        const name = uniqueName(taken, view.name + " copy");
        const clone = view.clone ? view.clone(name) : null;
        if (clone) {
          query.views.push(clone);
          query.save && query.save();
          const page = new (host.s25ViewConfigPage)(this.controller, query, clone, true);
          this.controller.showConfigPage && this.controller.showConfigPage(page);
        }
      }));
    menu.addItem((item) => item
      .setSection("danger").setTitle(t.actionDeleteView()).setIcon("lucide-trash-2").setWarning(true)
      .onClick(() => {
        const i = query.views.indexOf(view);
        if (i >= 0) query.views.splice(i, 1);
        query.save && query.save();
        const next = query.views[Math.max(0, i - 1)] || query.views[0];
        if (next) this.controller.selectView(next.name);
        this.controller.back && this.controller.back();
      }));
    menu.showAtMouseEvent(evt);
  };
  return ViewConfigPage;
}

// ---------------------------------------------------------------- results menu (`$X`)

/** `$X` — limit/copy/export results menu. */
export function ng06ResultsMenu(host) {
  function ResultsMenu(app, controller, parentEl) {
    const Dropdown = host.s09BasesDropdown || env().qY;
    const Button = host.s09BasesToolbarButton || env().zY;
    if (Button) {
      this.toolbarItem = new Button(parentEl, ng06B().nouns ? "" : "", "lucide-list-filter", () => this.toggle());
      this.toolbarItem.addContainerClass ? this.toolbarItem.addContainerClass("bases-toolbar-results-menu") : this.toolbarItem.addClass("bases-toolbar-results-menu");
    } else {
      this.toolbarItem = parentEl.createDiv({ cls: "bases-toolbar-item bases-toolbar-results-menu" });
      this.toolbarItem.createDiv({ cls: "bases-toolbar-button" });
    }
    this.app = app;
    this.controller = controller;
    this.view = null;
    this.viewConfig = null;
    this.resultCount = 0;
    this._menu = null;
    return this;
  }
  ResultsMenu.prototype.display = function () {
    const view = this.view, config = this.viewConfig;
    if (!view || !config) return;
    const menu = this._menu = new (host.s13BasesMenu || env().jY)(this.app, this.toolbarItem.buttonEl || this.toolbarItem, "");
    const scroll = menu.scrollEl;
    scroll.empty();
    const limit = config.getLimit ? config.getLimit() : 0;
    // limit row
    const limitRow = scroll.createDiv("input-row");
    limitRow.createDiv({ cls: "input-row-label", text: ng06B().labelLimit() });
    const input = limitRow.createDiv("input-row-content").createEl("input", { type: "number", cls: "settings-input" });
    input.value = limit || "";
    input.placeholder = ng06B().placeholderLimit ? ng06B().placeholderLimit() : "";
    const commit = () => {
      const v = input.value.trim();
      if (v === "") { config.setLimit(0); menu.setOpen(false); return; }
      const n = parseInt(v, 10);
      if (Number.isInteger(n) && n >= 0) { config.setLimit(n); menu.setOpen(false); }
      else input.addClass("mod-error");
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
    // show everything
    if (limit > 0) {
      const all = scroll.createDiv({ cls: "bases-toolbar-menu-item" });
      const info = all.createDiv("bases-toolbar-menu-item-info");
      const ic = info.createDiv("bases-toolbar-menu-item-info-icon");
      ng06Icon(ic, "lucide-rotate-ccw");
      info.createDiv({ cls: "bases-toolbar-menu-item-name", text: ng06B().buttonShowAllCount ? ng06B().buttonShowAllCount({ count: this.resultCount }) : ng06B().buttonShowAll() });
      all.addEventListener("click", () => { config.setLimit(0); menu.setOpen(false); });
    }
    const addAction = (title, icon, fn, destructive) => {
      const row = scroll.createDiv({ cls: "bases-toolbar-menu-item" + (destructive ? " mod-destructive" : "") });
      const info = row.createDiv("bases-toolbar-menu-item-info");
      const ic = info.createDiv("bases-toolbar-menu-item-info-icon");
      ng06Icon(ic, icon);
      info.createDiv({ cls: "bases-toolbar-menu-item-name", text: title });
      row.addEventListener("click", () => { menu.setOpen(false); fn && fn(); });
    };
    addAction(env().gm.interface.labelCopy(), "lucide-copy", () => view.copyToClipboard && view.copyToClipboard());
    addAction(ng06B().actionExportCSV(), "lucide-file-down", () => {
      try {
        const table = view.exportTable && view.exportTable();
        if (!table) return;
        const csv = table.toCSV();
        const blob = new Blob([csv], { type: "text/plain" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (config.name || "base") + ".csv";
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) {}
    });
    const actions = view.getViewActions ? view.getViewActions() : [];
    for (const action of actions) {
      const name = action.getName ? action.getName() : action.name;
      addAction(name, action.icon || "lucide-circle", () => action.callback && action.callback(), action.destructive);
    }
    menu.setAutoDestroy(this.toolbarItem.buttonEl || this.toolbarItem);
    menu.setOpen(true);
  };
  ResultsMenu.prototype.updateQuery = function (view, viewConfig, count) {
    this.view = view;
    this.viewConfig = viewConfig;
    this.resultCount = count || 0;
    const limit = viewConfig && viewConfig.getLimit ? viewConfig.getLimit() : 0;
    const shown = Math.min(this.resultCount, limit || this.resultCount);
    const btn = this.toolbarItem;
    if (btn && btn.setText) btn.setText(env().gm.nouns ? env().gm.nouns.resultWithCount({ count: shown }) : String(shown));
    if (btn && btn.buttonEl) btn.buttonEl.toggleClass("is-active", limit > 0);
    btn && btn.buttonEl && btn.buttonEl.addClass("bases-toolbar-result-count");
  };
  ResultsMenu.prototype.setEnabled = function (enabled) {
    const el = this.toolbarItem.buttonEl || this.toolbarItem;
    el && el.toggleClass("is-disabled", !enabled);
  };
  ResultsMenu.prototype.toggle = function () { this.display(); };
  return ResultsMenu;
}

// ---------------------------------------------------------------- sort menu (`e$`, `t$`, `n$`, `i$`)

/** `t$` — editable sort row base. */
export function ng06SortRowBase(host) {
  function SortRowBase(parent) {
    this.parent = parent;
    this.property = null;
    this.direction = "ASC";
    this.rowEl = null;
    this.wrapperEl = null;
    this.propertyCombobox = null;
    this.sortDirectionCombobox = null;
    return this;
  }
  SortRowBase.prototype.render = function (containerEl) {
    this.rowEl = containerEl.createDiv("base-toolbar-sort-item");
    this.wrapperEl = this.rowEl.createDiv("metadata-property bases-sort-property-container");
    const propInput = this.wrapperEl.createEl("input", { type: "text", cls: "settings-input bases-sort-property" });
    propInput.placeholder = ng06B().labelPropertyKey();
    propInput.value = this.property || "";
    propInput.addEventListener("change", () => { this.property = propInput.value || null; this.handleSave(); });
    const dirSel = this.wrapperEl.createEl("select", { cls: "dropdown bases-sort-direction" });
    dirSel.createEl("option", { value: "ASC", text: "A → Z" });
    dirSel.createEl("option", { value: "DESC", text: "Z → A" });
    dirSel.value = this.direction || "ASC";
    dirSel.addEventListener("change", () => { this.direction = dirSel.value; this.handleSave(); });
    const del = this.rowEl.createDiv("clickable-icon");
    ng06Icon(del, "lucide-trash-2");
    del.addEventListener("click", () => this.handleDelete());
    return this.rowEl;
  };
  SortRowBase.prototype.configureSortRow = function () {};
  SortRowBase.prototype.focus = function () {};
  SortRowBase.prototype.propertyFilter = function () { return true; };
  SortRowBase.prototype.handleSave = function () { this.parent && this.parent.saveSort && this.parent.saveSort(); };
  SortRowBase.prototype.handleDelete = function () {};
  return SortRowBase;
}

/** `n$` — sort row with drag handle. */
export function ng06SortRow(host) {
  const Base = host.s25SortRowBase || ng06SortRowBase(host);
  function SortRow(parent) { return Base.call(this, parent) || this; }
  inherit(SortRow, Base);
  SortRow.prototype.propertyFilter = function (id) {
    const p = parsePropertyId(id);
    return !(p.type === "file" && (p.name === "file" || p.name === "backlinks"));
  };
  SortRow.prototype.handleDelete = function () { this.parent && this.parent.removeSortRow && this.parent.removeSortRow(this); };
  return SortRow;
}

/** `i$` — the single group-by row. */
export function ng06GroupRow(host) {
  const Base = host.s25SortRowBase || ng06SortRowBase(host);
  function GroupRow(parent) { return Base.call(this, parent) || this; }
  inherit(GroupRow, Base);
  GroupRow.prototype.propertyFilter = function (id) { return s09IsCustomProperty(id, this.parent && this.parent.queryController); };
  GroupRow.prototype.handleSave = function () {
    if (this.parent && this.parent.setGroupBy) {
      this.parent.setGroupBy(this.property ? { property: this.property, direction: this.direction || "ASC" } : null);
    }
  };
  GroupRow.prototype.handleDelete = function () { if (this.parent) this.parent.setGroupBy(); };
  return GroupRow;
}

/** `e$` — sort + group-by toolbar button. */
export function ng06SortMenu(host) {
  function SortMenu(app, controller, parentEl) {
    const self = this;
    this.app = app;
    this.queryController = controller;
    this.query = null;
    this.viewConfig = null;
    this.currentSort = [];
    this.groupByRow = null;
    const Button = host.s09BasesToolbarButton || env().zY;
    if (Button) {
      this.toolbarItem = new Button(parentEl, ng06B().labelSort(), "lucide-arrow-up-down", () => self.toggle());
      this.toolbarItem.addContainerClass ? this.toolbarItem.addContainerClass("bases-toolbar-sort-menu") : this.toolbarItem.addClass("bases-toolbar-sort-menu");
    } else {
      this.toolbarItem = parentEl.createDiv({ cls: "bases-toolbar-item bases-toolbar-sort-menu" });
      this.toolbarItem.createDiv({ cls: "bases-toolbar-button", text: ng06B().labelSort() });
    }
    this.flairEl = this.toolbarItem.buttonEl ? this.toolbarItem.buttonEl.createDiv("flair toolbar-badge") : null;
    this._menu = null;
    this._sortRows = [];
    return this;
  }
  SortMenu.prototype.updateQuery = function (queryController, query, viewConfig) {
    this.queryController = queryController || this.queryController;
    this.query = query;
    this.viewConfig = viewConfig;
    this.display();
  };
  SortMenu.prototype.display = function () {
    if (this.flairEl) {
      const n = (this.viewConfig && this.viewConfig.getSort ? this.viewConfig.getSort().length : 0) + (this.viewConfig && this.viewConfig.groupBy ? 1 : 0);
      this.flairEl.setText(n ? String(n) : "");
      this.flairEl.toggleClass("mod-hidden", !n);
    }
    const el = this.toolbarItem.buttonEl || this.toolbarItem;
    el && el.toggleClass("is-active", !!(this.viewConfig && ((this.viewConfig.getSort && this.viewConfig.getSort().length) || this.viewConfig.groupBy)));
  };
  SortMenu.prototype.onOpen = function () { this.renderMenu(); };
  SortMenu.prototype.renderMenu = function () {
    const menu = this._menu = new (host.s13BasesMenu || env().jY)(this.app, this.toolbarItem.buttonEl || this.toolbarItem, ng06B().labelSort());
    const scroll = menu.scrollEl;
    scroll.empty();
    // group by section
    const groupBox = scroll.createDiv("bases-groupby-container");
    groupBox.createDiv({ cls: "bases-toolbar-section-header", text: ng06B().labelGroupBy() });
    const GroupRow = host.s25GroupRow;
    this.groupByRow = new GroupRow(this);
    const g = this.viewConfig && this.viewConfig.groupBy;
    if (g) { this.groupByRow.property = g.property; this.groupByRow.direction = g.direction; }
    groupBox.appendChild(this.groupByRow.render(groupBox));
    // sort section
    const sortBox = scroll.createDiv("bases-sort-container");
    sortBox.createDiv({ cls: "bases-toolbar-section-header", text: ng06B().labelSortBy() });
    const SortRow = host.s25SortRow;
    const sorts = (this.viewConfig && this.viewConfig.getSort ? this.viewConfig.getSort() : []) || [];
    this.currentSort = sorts.map((s) => ({ property: s.property, direction: s.direction }));
    if (this.currentSort.length === 0) this.currentSort.push({ property: null, direction: "ASC" });
    for (const spec of this.currentSort) {
      const row = new SortRow(this);
      row.property = spec.property;
      row.direction = spec.direction;
      sortBox.appendChild(row.render(sortBox));
      this._sortRows.push(row);
    }
    const add = sortBox.createDiv({ cls: "bases-toolbar-menu-item" });
    const info = add.createDiv("bases-toolbar-menu-item-info");
    const ic = info.createDiv("bases-toolbar-menu-item-info-icon");
    ng06Icon(ic, "lucide-plus");
    info.createDiv({ cls: "bases-toolbar-menu-item-name", text: ng06B().labelAddSort() });
    add.addEventListener("click", () => this.addSortRow());
    menu.setAutoDestroy(this.toolbarItem.buttonEl || this.toolbarItem);
    menu.setOpen(true);
  };
  SortMenu.prototype.toggle = function () {
    if (this._menu && this._menu.isOpen) { this._menu.setOpen(false); return; }
    this.renderMenu();
  };
  SortMenu.prototype.addSortRow = function () {
    const SortRow = host.s25SortRow;
    const row = new SortRow(this);
    row.property = null;
    row.direction = "ASC";
    const box = this._menu && this._menu.scrollEl && this._menu.scrollEl.querySelector(".bases-sort-container");
    if (box) box.appendChild(row.render(box));
    this._sortRows.push(row);
    row.focus && row.focus();
    return row;
  };
  SortMenu.prototype.removeSortRow = function (row) {
    const i = this._sortRows.indexOf(row);
    if (i >= 0) this._sortRows.splice(i, 1);
    if (row.rowEl) row.rowEl.detach();
    this.saveSort();
  };
  SortMenu.prototype.moveSortRow = function (row, to) {
    const i = this._sortRows.indexOf(row);
    if (i < 0) return;
    this._sortRows.splice(i, 1);
    this._sortRows.splice(to, 0, row);
    this.saveSort();
  };
  SortMenu.prototype.loadSort = function () {
    this.currentSort = (this.viewConfig && this.viewConfig.getSort ? this.viewConfig.getSort() : []).map((s) => ({ property: s.property, direction: s.direction }));
  };
  SortMenu.prototype.saveSort = function () {
    if (!this.viewConfig) return;
    this.currentSort = this._sortRows.map((r) => ({ property: r.property, direction: r.direction })).filter((s) => s.property);
    this.viewConfig.sort = this.currentSort.slice();
    this.query && this.query.save && this.query.save();
    this.display();
  };
  SortMenu.prototype.setGroupBy = function (groupBy) {
    if (this.viewConfig) {
      this.viewConfig.setGroupBy(groupBy || null);
      if (this.groupByRow) {
        this.groupByRow.property = groupBy ? groupBy.property : null;
        this.groupByRow.direction = groupBy ? groupBy.direction : "ASC";
      }
    }
    this.display();
  };
  SortMenu.prototype.renderGroupBy = function () {};
  return SortMenu;
}

// ---------------------------------------------------------------- filter menu (`AX`)

/** `AX` — funnel toolbar button with global + view filter builders. */
export function ng06FilterMenu(host) {
  function FilterMenu(app, controller, parentEl) {
    const self = this;
    this.app = app;
    this.controller = controller;
    this.query = null;
    this.viewConfig = null;
    const Button = host.s09BasesToolbarButton || env().zY;
    if (Button) {
      this.toolbarItem = new Button(parentEl, ng06B().labelFilter(), "lucide-list-filter", () => self.toggle());
      this.toolbarItem.addContainerClass ? this.toolbarItem.addContainerClass("bases-toolbar-filter-menu") : this.toolbarItem.addClass("bases-toolbar-filter-menu");
    } else {
      this.toolbarItem = parentEl.createDiv({ cls: "bases-toolbar-item bases-toolbar-filter-menu" });
      this.toolbarItem.createDiv({ cls: "bases-toolbar-button", text: ng06B().labelFilter() });
    }
    this.flairEl = this.toolbarItem.flairEl || null;
    this._menu = null;
    this._globalBuilder = null;
    this._viewBuilder = null;
    return this;
  }
  FilterMenu.prototype.updateQuery = function (query, viewConfig) {
    this.query = query;
    this.viewConfig = viewConfig;
    this._refreshBadge();
  };
  FilterMenu.prototype._countFilters = function (filter) {
    if (!filter) return 0;
    try {
      const rules = filter.getFilterRules ? filter.getFilterRules() : null;
      if (rules) return rules.length;
      if (filter.filters) return filter.filters.length;
      return 1;
    } catch (e) { return 1; }
  };
  FilterMenu.prototype._refreshBadge = function () {
    const local = this._countFilters(this.viewConfig && this.viewConfig.filters);
    const global = this._countFilters(this.query && this.query.filters);
    const el = this.toolbarItem.buttonEl || this.toolbarItem;
    if (el) {
      el.toggleClass("is-active", local > 0);
      const hasError = [this.query && this.query.filters, this.viewConfig && this.viewConfig.filters].some((f) => f && f.hasError && f.hasError());
      el.toggleClass("mod-error", !!hasError);
    }
  };
  FilterMenu.prototype.setEnabled = function (enabled) {
    const el = this.toolbarItem.buttonEl || this.toolbarItem;
    el && el.toggleClass("is-disabled", !enabled);
  };
  FilterMenu.prototype.toggle = function () { this.renderMenu(); };
  FilterMenu.prototype.renderMenu = function () {
    const menu = this._menu = new (host.s13BasesMenu || env().jY)(this.app, this.toolbarItem.buttonEl || this.toolbarItem, ng06B().labelFilter());
    const scroll = menu.scrollEl;
    scroll.empty();
    const section = (title, open, builder) => {
      const box = scroll.createDiv("bases-toolbar-section");
      const header = box.createDiv("bases-toolbar-section-header");
      header.createDiv({ cls: "collapse-icon" + (open ? "" : " is-collapsed"), text: "▸" });
      header.createDiv({ cls: "bases-toolbar-section-header-text", text: title });
      const content = box.createDiv("bases-toolbar-section-content");
      content.style.display = open ? "" : "none";
      header.addEventListener("click", () => {
        const collapsed = content.style.display === "none";
        content.style.display = collapsed ? "" : "none";
        header.querySelector(".collapse-icon") && header.querySelector(".collapse-icon").classList.toggle("is-collapsed", !collapsed);
      });
      const FilterBuilder = host.s25FilterBuilder;
      if (FilterBuilder) {
        const b = new FilterBuilder(this.controller, content);
        b.setFilter(builder.get ? builder.get() : builder);
        return b;
      }
      return null;
    };
    this._globalBuilder = section(ng06B().labelAllViews(), true, {
      get: () => this.query && this.query.filters,
      set: (f) => this.query && this.query.setGlobalFilters(f),
    });
    this._viewBuilder = section(ng06B().labelCurrentView(), false, {
      get: () => this.viewConfig && this.viewConfig.filters,
      set: (f) => this.query && this.viewConfig && this.query.setViewFilters(this.viewConfig.name, f),
    });
    menu.setAutoDestroy(this.toolbarItem.buttonEl || this.toolbarItem);
    menu.onClose && menu.onClose(() => this._refreshBadge());
    menu.setOpen(true);
  };
  return FilterMenu;
}

// ---------------------------------------------------------------- properties menu (`GX`, `KX`, `YX`, `QX`)

/** `QX` — editable form of one property. */
export function ng06PropertyForm(host) {
  function PropertyForm(queryController) {
    this.queryController = queryController;
    this.propId = null;
    this.isNewProperty = false;
    this.containerEl = ng06Div("bases-toolbar-menu-container");
    this._deleteCb = null;
    return this;
  }
  PropertyForm.prototype.showActions = function (evt, target) {
    if (target && target.hasClass("has-active-menu")) return;
    const menu = host.Menu.forEvent(evt).addSections(["action", "", "danger"]);
    const t = ng06B();
    const inOrder = this._inOrder();
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(inOrder ? t.labelHideProperty() : t.labelShowProperty())
      .setIcon("lucide-eye-off")
      .onClick(() => this._toggleVisibility()));
    const parsed = parsePropertyId(this.propId || "");
    if (parsed.type === "formula") {
      menu.addItem((item) => item
        .setSection("danger").setTitle(t.actionDeleteFormula()).setIcon("lucide-trash-2").setWarning(true)
        .onClick(() => {
          const query = this.queryController.query;
          if (query && query.formulas && query.formulas[parsed.name] !== undefined) {
            delete query.formulas[parsed.name];
            query.setFormulas(query.formulas);
          }
          this._deleteCb && this._deleteCb();
        }));
    }
    menu.showAtMouseEvent(evt);
  };
  PropertyForm.prototype._inOrder = function () {
    const view = this.queryController.viewConfig;
    return !!(view && view.getOrder && view.getOrder().includes(this.propId));
  };
  PropertyForm.prototype._toggleVisibility = function () {
    const view = this.queryController.viewConfig;
    if (!view || !view.getOrder) return;
    const order = view.getOrder().slice();
    const i = order.indexOf(this.propId);
    if (i >= 0) order.splice(i, 1); else order.push(this.propId);
    view.setOrder(order);
  };
  PropertyForm.prototype.onDelete = function (cb) { this._deleteCb = cb; };
  PropertyForm.prototype.display = function (propId, isNew) {
    this.propId = propId;
    this.isNewProperty = !!isNew;
    const el = this.containerEl;
    el.empty();
    const header = el.createDiv("bases-toolbar-menu-container-header");
    const back = header.createDiv("back-button clickable-icon");
    ng06Icon(back, "lucide-chevron-left");
    back.createSpan({ cls: "back-label", text: isNew ? ng06B().labelEditProperty() : ng06B().titleEditProperty({ name: propId }) });
    back.addEventListener("click", () => this.controller && this.controller.back && this.controller.back());
    const more = header.createDiv("clickable-icon");
    ng06Icon(more, "lucide-more-vertical");
    more.addEventListener("click", (e) => this.showActions(e, more));
    const close = header.createDiv("clickable-icon close-icon");
    ng06Icon(close, "lucide-x");
    close.addEventListener("click", () => this.controller && this.controller.close && this.controller.close());
    const form = el.createDiv("bases-toolbar-menu-form");
    const parsed = parsePropertyId(propId || "");
    const view = this.queryController.viewConfig;
    const displayName = view && view.getDisplayName ? view.getDisplayName(propId) : parsed.name;
    // display name row
    const nameRow = form.createDiv("input-row");
    nameRow.createDiv({ cls: "input-row-label", text: ng06B().labelDisplayName() });
    const nameInput = nameRow.createDiv("input-row-content").createEl("input", { type: "text", cls: "settings-input" });
    nameInput.value = displayName || "";
    const commitName = () => {
      const value = nameInput.value.trim();
      const query = this.queryController.query;
      if (!query || !propId) return;
      if (parsed.type === "formula") {
        if (value && value !== parsed.name) {
          // rename formula key
          const formulas = query.formulas || {};
          if (formulas[parsed.name] !== undefined) {
            formulas[value] = formulas[parsed.name];
            delete formulas[parsed.name];
            query.setFormulas(formulas);
          }
          const order = view.getOrder ? view.getOrder().slice() : [];
          const i = order.indexOf(propId);
          const newId = "formula." + value;
          if (i >= 0) { order[i] = newId; view.setOrder(order); }
          this.propId = newId;
        }
      } else if (parsed.type === "note") {
        const newName = value || parsed.name;
        if (newName !== parsed.name) {
          try { this.queryController.app.fileManager.renameProperty(parsed.name, newName); } catch (e) {}
          const order = view.getOrder ? view.getOrder().slice() : [];
          const i = order.indexOf(propId);
          if (i >= 0) { order[i] = "note." + newName; view.setOrder(order); }
          this.propId = "note." + newName;
        }
      } else {
        const pc = query.getPropertyConfig(propId);
        pc.setDisplayName(value);
      }
    };
    nameInput.addEventListener("change", commitName);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); if (e.key === "Escape") { nameInput.value = displayName || ""; nameInput.blur(); } });
    // type row for note properties
    if (parsed.type === "note") {
      const typeRow = form.createDiv("input-row");
      typeRow.createDiv({ cls: "input-row-label", text: ng06B().labelPropertyType() });
      const sel = typeRow.createDiv("input-row-content").createEl("select", { cls: "dropdown" });
      const manager = this.queryController.app.metadataTypeManager;
      const widgets = manager.registeredTypeWidgets || {};
      const info = manager.getPropertyInfo(parsed.name);
      for (const wname of Object.keys(widgets)) {
        const w = widgets[wname];
        sel.createEl("option", { value: wname, text: w.name ? w.name() : wname });
      }
      if (info && info.widget) sel.value = info.widget;
      sel.addEventListener("change", () => { try { manager.setType(parsed.name, sel.value); } catch (e) {} });
    }
    // formula editor for formula properties
    if (parsed.type === "formula") {
      const fRow = form.createDiv("input-row");
      const label = fRow.createDiv({ cls: "input-row-label", text: ng06B().labelFormula() });
      const FormulaEditor = host.s25FormulaEditor || env().UX;
      const editor = new FormulaEditor(fRow.createDiv("input-row-content"), "", {
        placeholder: "x + y",
        updateFormula: (text) => {
          const query = this.queryController.query;
          if (!query || !this.propId) return;
          const p = parsePropertyId(this.propId);
          const formulas = query.formulas || {};
          formulas[p.name] = new (env().DK)(text);
          query.setFormulas(formulas);
        },
        extensions: this.queryController.getEditorLanguageSupport(),
      });
      const q = this.queryController.query;
      const formula = q && q.formulas && q.formulas[parsed.name];
      if (editor && formula) { try { editor.setValue && editor.setValue(formula.toString()); } catch (e) {} }
    }
    this.display = this.display; // keep
  };
  PropertyForm.prototype.onShow = function () {};
  return PropertyForm;
}

/** `KX` — property list page of the properties menu. */
export function ng06PropertyListPage(host) {
  function PropertyListPage(controller) {
    this.controller = controller;
    this.query = controller.query;
    this.queryController = controller.queryController || controller;
    this.containerEl = ng06Div("bases-toolbar-menu-container");
    this.searchComponent = null;
    this.chooser = null;
    this.handleSelect = null;
    this.handleNext = null;
    this._listEl = this.containerEl.createDiv("bases-toolbar-menu-items");
    return this;
  }
  PropertyListPage.prototype.scope = null;
  PropertyListPage.prototype.onSelect = function (cb) { this.handleSelect = cb; };
  PropertyListPage.prototype.onNext = function (cb) { this.handleNext = cb; };
  PropertyListPage.prototype.onShow = function () { this.renderProperties(); };
  PropertyListPage.prototype._properties = function () {
    const qc = this.queryController;
    const props = qc.getProperties ? qc.getProperties() : [];
    const view = qc.viewConfig;
    const order = view && view.getOrder ? view.getOrder() : [];
    return props.filter((p) => p !== "file.file").map((p, i) => ({ id: p, rank: order.indexOf(p) }));
  };
  PropertyListPage.prototype.renderProperties = function () {
    const el = this._listEl;
    el.empty();
    const items = this._properties().sort((a, b) => (a.rank < 0 ? 1e9 : a.rank) - (b.rank < 0 ? 1e9 : b.rank));
    const view = this.queryController.viewConfig;
    for (const { id } of items) {
      const parsed = parsePropertyId(id);
      const row = el.createDiv({ cls: "bases-toolbar-menu-item" });
      const cb = row.createEl("input", { type: "checkbox", cls: "metadata-property-checkbox" });
      const inOrder = view && view.getOrder && view.getOrder().includes(id);
      cb.checked = !!inOrder;
      cb.addEventListener("change", () => {
        const order = view.getOrder().slice();
        const i = order.indexOf(id);
        if (cb.checked && i < 0) order.push(id);
        if (!cb.checked && i >= 0) order.splice(i, 1);
        view.setOrder(order);
      });
      const info = row.createDiv("bases-toolbar-menu-item-info");
      const iconEl = info.createDiv("bases-toolbar-menu-item-info-icon clickable-icon");
      if (parsed.type === "formula") ng06Icon(iconEl, "lucide-square-function");
      else if (parsed.type === "file") ng06Icon(iconEl, "lucide-info");
      else {
        try {
          const pinfo = this.queryController.app.metadataTypeManager.getPropertyInfo(parsed.name);
          ng06Icon(iconEl, pinfo && pinfo.widget ? this.queryController.app.metadataTypeManager.getWidget(pinfo.widget).icon : "lucide-info");
        } catch (e) { ng06Icon(iconEl, "lucide-info"); }
      }
      row.toggleClass("mod-implicit", parsed.type === "file");
      row.toggleClass("mod-formula", parsed.type === "formula");
      const name = view && view.getDisplayName ? view.getDisplayName(id) : parsed.name;
      info.createDiv({ cls: "bases-toolbar-menu-item-name", text: name });
      const next = row.createDiv("clickable-icon");
      ng06Icon(next, "lucide-chevron-right");
      next.addEventListener("click", (e) => { e.stopPropagation(); if (this.handleNext) this.handleNext(id); });
      row.addEventListener("click", () => { if (this.handleSelect) this.handleSelect(id); });
    }
    // action rows
    const query = this.query || this.queryController.query;
    const addProp = el.createDiv({ cls: "bases-toolbar-menu-item" });
    const pi = addProp.createDiv("bases-toolbar-menu-item-info");
    const pic = pi.createDiv("bases-toolbar-menu-item-info-icon");
    ng06Icon(pic, "lucide-plus");
    pi.createDiv({ cls: "bases-toolbar-menu-item-name", text: ng06B().actionAddProperty() });
    addProp.addEventListener("click", () => {
      const name = uniqueName(this._properties().map((p) => p.id), "note." + (ng06B().labelUntitledProperty()));
      const view = this.queryController.viewConfig;
      const order = view.getOrder().slice();
      order.push(name);
      view.setOrder(order);
      if (this.handleNext) this.handleNext(name);
    });
    const addFormula = el.createDiv({ cls: "bases-toolbar-menu-item" });
    const fi = addFormula.createDiv("bases-toolbar-menu-item-info");
    const fic = fi.createDiv("bases-toolbar-menu-item-info-icon");
    ng06Icon(fic, "lucide-square-function");
    fi.createDiv({ cls: "bases-toolbar-menu-item-name", text: ng06B().actionAddFormula() });
    addFormula.addEventListener("click", () => {
      const query = this.queryController.query;
      const name = uniqueName(Object.keys(query.formulas || {}), ng06B().labelUntitledProperty());
      const formulas = query.formulas || {};
      formulas[name] = new (env().DK)("");
      query.setFormulas(formulas);
      const view = this.queryController.viewConfig;
      const order = view.getOrder().slice();
      order.push("formula." + name);
      view.setOrder(order);
      if (this.handleNext) this.handleNext("formula." + name);
    });
    const hideAll = el.createDiv({ cls: "bases-toolbar-menu-item" });
    const hi = hideAll.createDiv("bases-toolbar-menu-item-info");
    const hic = hi.createDiv("bases-toolbar-menu-item-info-icon");
    ng06Icon(hic, "lucide-eye-off");
    hi.createDiv({ cls: "bases-toolbar-menu-item-name", text: ng06B().actionHideAll() });
    hideAll.addEventListener("click", () => {
      const view = this.queryController.viewConfig;
      view.setOrder([]);
      this.renderProperties();
    });
  };
  PropertyListPage.prototype.selectSuggestion = function () {};
  PropertyListPage.prototype.renderSuggestion = function () {};
  PropertyListPage.prototype.moveSelected = function () {};
  return PropertyListPage;
}

/** `YX` — property edit page wrapping the PropertyForm. */
export function ng06PropertyEditPage(host) {
  function PropertyEditPage(controller) {
    this.controller = controller;
    this.containerEl = ng06Div("bases-toolbar-menu-container");
    this.form = null;
    return this;
  }
  PropertyEditPage.prototype.scope = null;
  PropertyEditPage.prototype.onShow = function () {};
  PropertyEditPage.prototype.display = function (propId, isNew) {
    if (!this.form) this.form = new (host.s25PropForm)(this.controller.queryController || this.controller);
    this.containerEl.empty();
    this.containerEl.appendChild(this.form.containerEl);
    this.form.controller = { back: () => this.controller.back && this.controller.back(), close: () => this.controller.close && this.controller.close() };
    this.form.display(propId, isNew);
    this.form.onDelete(() => this.controller.back && this.controller.back());
  };
  return PropertyEditPage;
}

/** `GX` — properties eye toolbar button. */
export function ng06PropertiesMenu(host) {
  const Menu = ng06PageStackMenu(host, "bases-toolbar-properties-menu", () => ng06B().labelProperties(), "lucide-list");
  function PropertiesMenu(app, controller, parentEl) {
    const self = Menu.call(this, app, controller, parentEl) || this;
    self.query = null;
    self.viewConfig = null;
    self.formulas = null;
    self.queryController = controller;
    self._listPage = null;
    self._editPage = null;
    return self;
  }
  inherit(PropertiesMenu, Menu);
  Object.defineProperty(PropertiesMenu.prototype, "scope", {
    get() { return this.toolbarItem && this.toolbarItem.scope; },
    enumerable: false, configurable: true,
  });
  PropertiesMenu.prototype.getDefaultPage = function () {
    if (!this._listPage) {
      this._listPage = new (host.s25PropListPage)(this.queryController);
      this._listPage.onSelect = (id) => this._openEdit(id, false);
      this._listPage.onNext = (id) => this._openEdit(id, id && id.startsWith("note.") && !this.queryController.getProperties().includes(id));
    }
    return this._listPage;
  };
  PropertiesMenu.prototype._openEdit = function (propId, isNew) {
    if (!this._editPage) this._editPage = new (host.s25PropEditPage)(this);
    this.show(this._editPage);
    this._editPage.display(propId, isNew);
  };
  PropertiesMenu.prototype.updateQuery = function (query, viewConfig) {
    this.query = query;
    this.viewConfig = viewConfig;
    this.formulas = query && query.formulas;
    const hasError = query && query.formulas && Object.values(query.formulas).some((f) => f && f.formula && f.formula.type === "invalid");
    const el = this.toolbarItem.buttonEl || this.toolbarItem;
    el && el.toggleClass("mod-error", !!hasError);
    if (this._listPage) { this._listPage.query = query; this._listPage.queryController = this.queryController; }
  };
  PropertiesMenu.prototype.setEnabled = function (enabled) {
    const el = this.toolbarItem.buttonEl || this.toolbarItem;
    el && el.toggleClass("is-disabled", !enabled);
  };
  PropertiesMenu.prototype.setPropertyVisibility = function (propId, visible) {
    const view = this.viewConfig;
    if (!view || !view.getOrder) return;
    const order = view.getOrder().slice();
    const i = order.indexOf(propId);
    if (visible && i < 0) order.push(propId);
    if (!visible && i >= 0) order.splice(i, 1);
    view.setOrder(order);
  };
  PropertiesMenu.prototype.togglePropertyVisibility = function (propId) {
    const view = this.viewConfig;
    const order = view && view.getOrder ? view.getOrder() : [];
    this.setPropertyVisibility(propId, !order.includes(propId));
  };
  PropertiesMenu.prototype.updateFormula = function (name, formula) {
    const query = this.query;
    if (!query) return;
    const formulas = query.formulas || {};
    formulas[name] = formula;
    query.setFormulas(formulas);
  };
  PropertiesMenu.prototype.show = function (page) { Menu.prototype.show.call(this, page); };
  PropertiesMenu.prototype.back = function () { Menu.prototype.back.call(this); };
  PropertiesMenu.prototype.close = function () { Menu.prototype.close.call(this); };
  PropertiesMenu.prototype.onOpen = function () { this.show(this.getDefaultPage()); };
  PropertiesMenu.prototype.onClose = function () {};
  return PropertiesMenu;
}

// ---------------------------------------------------------------- search menu (`ZX`)

/** `ZX` — per-view search bar. */
export function ng06SearchMenu(host) {
  function SearchMenu(app, controller, parentEl, headerEl) {
    this.app = app;
    this.queryController = controller;
    this.headerEl = headerEl || parentEl;
    this._rowEl = parentEl;
    this.searchBarEl = null;
    this.inputEl = null;
    this.countEl = null;
    this.button = null;
    this.scope = new (env().Ng)(app.scope);
    this._isOpen = false;
    this._build();
    return this;
  }
  SearchMenu.prototype._build = function () {
    const row = this._rowEl;
    this.button = row.createDiv({ cls: "bases-toolbar-button", text: ng06B().labelSearch() });
    ng06Icon(this.button.createDiv ? this.button : this.button, "lucide-search");
    this.button.addEventListener("click", () => this.toggle());
    this.searchBarEl = row.createDiv("document-search-container");
    this.searchBarEl.hide();
    const SearchComponent = host.SearchComponent;
    if (SearchComponent) {
      this.inputEl = new SearchComponent(this.searchBarEl);
      this.inputEl.inputEl && this.inputEl.inputEl.addClass("document-search-input");
      this.inputEl.setPlaceholder(env().gm.editor.search.placeholderFind());
      this.inputEl.onChange(debounceCall((v) => {
        this.countEl && this.countEl.toggleClass("mod-hidden", !v);
        this.queryController.updateSearchQuery(v || "");
      }, 0));
    } else {
      this.inputEl = this.searchBarEl.createEl("input", { type: "text", cls: "document-search-input" });
      this.inputEl.addEventListener("input", debounceCall(() => {
        this.countEl && this.countEl.toggleClass("mod-hidden", !this.inputEl.value);
        this.queryController.updateSearchQuery(this.inputEl.value);
      }, 0));
    }
    this.countEl = this.searchBarEl.createDiv({ cls: "document-search-count mod-hidden" });
  };
  SearchMenu.prototype.open = function () {
    if (this._isOpen) return;
    this._isOpen = true;
    const current = this.queryController.getSearchQuery();
    const input = this.inputEl.inputEl || this.inputEl;
    if (input && input.value !== undefined) input.value = current || "";
    this._rowEl.addClass("is-active");
    this.searchBarEl.show();
    this.app.keymap.pushScope(this.scope);
    this.scope.register && this.scope.register([], "Escape", () => this.close());
    if (input && input.focus) { input.focus(); input.select && input.select(); }
  };
  SearchMenu.prototype.close = function () {
    if (!this._isOpen) return;
    this._isOpen = false;
    this._rowEl.removeClass("is-active");
    this.searchBarEl.hide();
    this.app.keymap.popScope(this.scope);
    this.queryController.updateSearchQuery();
  };
  SearchMenu.prototype.toggle = function () { this._isOpen ? this.close() : this.open(); };
  SearchMenu.prototype.updateCount = function (results) {
    const n = results ? results.length : 0;
    const input = this.inputEl.inputEl || this.inputEl;
    const has = !!(input && input.value);
    this.countEl && this.countEl.setText(ng06B().labelSearchResults({ count: n }));
    this.countEl && this.countEl.toggleClass("mod-hidden", !has);
  };
  SearchMenu.prototype.onunload = function () { this.close(); };
  return SearchMenu;
}

// ---------------------------------------------------------------- new item button (`jX`)

/** `jX` — "+" new-item toolbar button with popover. */
export function ng06NewItemButton(host) {
  function NewItemButton(app, controller, parentEl) {
    this.app = app;
    this.queryController = controller;
    this.query = null;
    this.viewConfig = null;
    this.newlyCreatedFile = null;
    this.popover = null;
    this.errorEl = null;
    this.buttonEl = parentEl.createDiv({ cls: "text-icon-button", attr: { tabIndex: 0 } });
    const icon = this.buttonEl.createDiv("text-button-icon");
    ng06Icon(icon, "lucide-plus");
    this.buttonEl.createDiv({ cls: "text-button-label", text: ng06B().labelNewItem() });
    this.buttonEl.addEventListener("click", (e) => this.toggle(e));
    this.buttonEl.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); this.open(); }
    });
    this._outside = (e) => { if (this.popover && !this.buttonEl.contains(e.target)) this.close(); };
    return this;
  }
  NewItemButton.prototype.toggle = function (evt) {
    if (this.popover) this.close(); else this.open();
  };
  NewItemButton.prototype.updateQuery = function (queryController, query, viewConfig, results) {
    this.queryController = queryController || this.queryController;
    this.query = query;
    this.viewConfig = viewConfig;
    this._results = results;
    if (this.newlyCreatedFile && this.popover && this._results && !this._results.some((r) => r.file === this.newlyCreatedFile)) {
      if (!this.errorEl) {
        this.errorEl = ng06Div({ cls: "tooltip bases-filter-query-message", text: ng06B().msgNewItemFiltered() });
        (this.popover.hoverEl ? this.popover.hoverEl.doc.body : document.body).appendChild(this.errorEl);
        try { env().Nv(this.buttonEl.getBoundingClientRect(), this.errorEl, { horizontalAlignment: "center", gap: 10 }); } catch (e) {}
      }
    } else if (this.errorEl) { this.errorEl.detach(); this.errorEl = null; }
  };
  NewItemButton.prototype.open = async function (name, beforeCreate) {
    const query = this.query, config = this.viewConfig;
    if (!query || !config) { this.close(); return; }
    try {
      // folder resolution chain
      let folder = query.newItemFolder || "";
      let templateFm = null;
      if (query.newItemTemplate) {
        const tpl = this.app.vault.getAbstractFileByPath(query.newItemTemplate);
        if (tpl) {
          if (!folder) folder = tpl.parent ? tpl.parent.path : "";
          try {
            const cache = this.app.metadataCache.getFileCache(tpl);
            templateFm = cache && cache.frontmatter;
          } catch (e) {}
        }
      }
      if (!folder) {
        const res = s09FiltersToFrontmatter(this.app, query, config, null);
        if (res.folder) folder = res.folder;
      }
      if (!folder) {
        const current = this.queryController.getCurrentFile && this.queryController.getCurrentFile();
        const base = current && current.parent ? current.parent.path : (this.query.file && this.query.file.parent ? this.query.file.parent.path : "");
        folder = base || "";
      }
      folder = folder ? folder.replace(/\/$/, "") + "/" : "";
      const untitled = ng06FileExplorerStrings().labelUntitledFile ? ng06FileExplorerStrings().labelUntitledFile() : "Untitled";
      const baseName = name || untitled;
      const path = await this.app.vault.getAvailablePath(normalizePath(folder + baseName), "md");
      const file = await this.app.vault.create(path, "");
      // frontmatter from template or filters
      try {
        const fm = {};
        if (templateFm) Object.assign(fm, templateFm);
        const res = s09FiltersToFrontmatter(this.app, query, config, null);
        if (res.frontmatter) {
          if (!templateFm) Object.assign(fm, res.frontmatter);
          else for (const k of Object.keys(res.frontmatter)) if (!Object.hasOwn(fm, k)) fm[k] = res.frontmatter[k];
        }
        if (beforeCreate) beforeCreate(fm);
        if (Object.keys(fm).length) {
          await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            for (const k of Object.keys(fm)) frontmatter[k] = fm[k];
            return frontmatter;
          });
        }
      } catch (e) {}
      this.newlyCreatedFile = file;
      this.buttonEl.addClass("has-active-menu");
      if (env().Yl.isPhone) {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        leaf.setEphemeralState && leaf.setEphemeralState({ rename: "all" });
        return;
      }
      const HoverPopover = host.HoverPopover;
      if (HoverPopover && HoverPopover.create) {
        this.popover = await HoverPopover.create({
          app: this.app,
          hoverParent: this.buttonEl,
          targetEl: this.buttonEl,
          waitTime: 0,
          linktext: file.path,
          sourcePath: file.path,
          state: { mode: "source" },
        });
        if (this.popover) {
          this.popover.hoverEl && this.popover.hoverEl.addClass("bases-new-item-popover");
          this.popover.setIsFocused && this.popover.setIsFocused(true);
          const off = () => { this.buttonEl.removeClass("has-active-menu"); this.newlyCreatedFile = null; this.popover = null; };
          this.popover.onClose ? this.popover.onClose(off) : setTimeout(off, 5000);
        }
      }
    } catch (e) {
      if (!this.errorEl) {
        this.errorEl = ng06Div({ cls: "tooltip bases-filter-query-message", text: String(e && e.message || e) });
        document.body.appendChild(this.errorEl);
      }
    }
  };
  NewItemButton.prototype.close = function () {
    if (this.popover && this.popover.hide) this.popover.hide();
    this.popover = null;
    this.buttonEl.removeClass("has-active-menu");
  };
  return NewItemButton;
}

// ---------------------------------------------------------------- formula editor (`UX`) + suggester (`PX`)

/** `PX` — formula-editor autocomplete: base completions + query formula names. */
export function ng06FormulaSuggester(host) {
  const Base = host.s25FormulaSuggester ? Object.getPrototypeOf(host.s25FormulaSuggester) : null;
  function FormulaSuggester() { return (Base ? Base.apply(this, arguments) : Object.apply(this, arguments)) || this; }
  if (Base) inherit(FormulaSuggester, Base);
  FormulaSuggester.prototype.getSuggestions = function (...args) {
    const base = Base && Base.prototype.getSuggestions ? Base.prototype.getSuggestions.apply(this, args) : [];
    const ctx = args[0];
    const out = Array.isArray(base) ? base.slice() : [];
    try {
      const formulas = ctx && ctx.formulaResults && ctx.formulaResults.formulas;
      const names = formulas ? Object.keys(formulas) : [];
      for (const name of names) {
        out.push({
          label: name,
          icon: "lucide-square-function",
          apply: (editor, from, to) => {
            const text = /^[A-Za-z_$][\w$]*$/.test(name) ? "formula." + name : "formula" + JSON.stringify(name);
            editor.dispatch ? editor.dispatch({ changes: { from, to, insert: text } }) : null;
          },
        });
      }
    } catch (e) {}
    return out;
  };
  return FormulaSuggester;
}

/** `UX` — small CodeMirror formula input with status line. */
export function ng06FormulaEditor(host) {
  function FormulaEditor(containerEl, initial, options) {
    options = options || {};
    this.containerEl = containerEl.createDiv("formula-editor-container");
    this.editorEl = this.containerEl.createDiv("formula-editor");
    this.statusEl = this.containerEl.createDiv("formula-editor-status");
    this._iconEl = this.statusEl.createDiv("status-icon");
    this._labelEl = this.statusEl.createDiv("status-label");
    this._options = options;
    this._view = null;
    this._build(initial);
    return this;
  }
  FormulaEditor.prototype._build = function (initial) {
    const opts = this._options;
    try {
      const { _o, k } = env();
      const extensions = [
        ...(s09FormulaEditorExtensions() || []),
        ...(opts.extensions || []),
      ];
      this._view = new _o({
        doc: typeof initial === "string" ? initial : (initial && initial.toString ? initial.toString() : ""),
        extensions,
        parent: this.editorEl,
      });
      this._view.focus();
    } catch (e) {
      this.editorEl.setText(typeof initial === "string" ? initial : "");
    }
    this._validate(initial);
    if (opts.updateFormula) {
      const commit = debounceCall(() => {
        const text = this._view ? this._view.state.doc.toString() : this.editorEl.getText();
        opts.updateFormula(text);
      }, 250);
      this._commit = commit;
      if (this._view) {
        this._view.dispatch && this._view.dispatch({});
      }
      this.editorEl.addEventListener("input", commit);
      this.editorEl.addEventListener("blur", () => { commit.cancel && commit.cancel(); const text = this._view ? this._view.state.doc.toString() : this.editorEl.getText(); opts.updateFormula(text); });
    }
  };
  FormulaEditor.prototype._validate = function (initial) {
    const el = this.statusEl;
    el.removeClass("mod-error", "mod-empty");
    try {
      const text = typeof initial === "string" ? initial : (initial && initial.text !== undefined ? initial.text : "");
      if (!text || !text.trim()) {
        el.addClass("mod-empty");
        ng06Icon(this._iconEl, "lucide-circle");
        this._labelEl.setText("");
        return;
      }
      const parsed = new (env().DK)(text);
      const bad = parsed.formula && parsed.formula.type === "invalid";
      if (bad) {
        el.addClass("mod-error");
        ng06Icon(this._iconEl, "lucide-x-circle");
        this._labelEl.setText("Invalid formula");
        this.statusEl.title = parsed.formula.getErrorMessage ? parsed.formula.getErrorMessage() : "";
      } else {
        ng06Icon(this._iconEl, "lucide-circle-check");
        this._labelEl.setText("Valid formula");
      }
    } catch (e) {
      el.addClass("mod-error");
      this._labelEl.setText("Invalid formula");
    }
  };
  FormulaEditor.prototype.setValue = function (text) {
    if (this._view) {
      try { this._view.dispatch({ changes: { from: 0, to: this._view.state.doc.length, insert: text } }); } catch (e) {}
    } else this.editorEl.setText(text);
    this._validate(text);
  };
  FormulaEditor.prototype.destroy = function () {
    if (this._view && this._view.destroy) this._view.destroy();
  };
  FormulaEditor.appendHelpIcon = function (el) {
    const icon = el.createDiv({ cls: "clickable-icon help-icon" });
    ng06Icon(icon, "lucide-help-circle");
    icon.addEventListener("click", () => window.open("https://github.com/FalconTechDev/basalt/wiki", "_blank"));
  };
  return FormulaEditor;
}
