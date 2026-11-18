// Small UI pieces of the slice: the bases summary-formula menu pages, the view
// switcher suggestion modal, the file picker modal, the thumbnail background helper,
// the canvas help modal and the quick-actions registry.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { parsePropertyId, uniqueName } from "./text.js";
import { extensionOf } from "./path.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { setElementTooltip } from "./tooltip.js";
import { s13KeyNames } from "./s13-geom.js";
import { s13BasesI18n, s13CanvasI18n } from "./s13-consts.js";

// Classes produced by the define* factories; referenced across factories only inside
// method bodies that run after every factory has executed.
let S13SummaryFormulaListPage = null;
let S13SummaryFormulaPage = null;

const s13BasesT = () => s13BasesI18n();

/** Suggestion modal listing the available view types for a bases file. */
export function defineS13ViewSwitcherModal(host) {
  function ViewSwitcherModal(parentArg, controller, options) {
    const self = host.FuzzySuggestModal.call(this, parentArg) || this;
    self.options = options;
    self.controller = controller;
    self.setInstructions([
      { command: "↑↓", purpose: env().gm.plugins.commandPalette.instructionNavigate() },
      { command: "↵", purpose: env().gm.plugins.commandPalette.instructionUse() },
      { command: "esc", purpose: env().gm.plugins.commandPalette.instructionDismiss() },
    ]);
    self.scope.register(null, "Tab", () => false);
    self.scope.register(null, "Enter", (event) => {
      if (!event.isComposing) {
        self.selectActiveSuggestion(event);
        return false;
      }
    });
    return self;
  }
  inherit(ViewSwitcherModal, host.FuzzySuggestModal);

  ViewSwitcherModal.prototype.getItems = function () {
    return this.options;
  };

  ViewSwitcherModal.prototype.renderSuggestion = function (item, el) {
    host.FuzzySuggestModal.prototype.renderSuggestion.call(this, item, el);
    if (item === this.controller.viewName) {
      el.createSpan({ cls: "flair toolbar-badge", text: env().gm.setting.appearance.labelCurrentlyActive() });
    }
  };

  ViewSwitcherModal.prototype.getItemText = function (item) {
    return item;
  };

  ViewSwitcherModal.prototype.onChooseItem = function (item) {
    this.controller.selectView(item);
  };

  return ViewSwitcherModal;
}

/**
 * Controller of the summary-formula picker: a page stack inside one menu, with
 * Escape going back and closing at the root.
 */
export function defineS13SummaryMenu(host) {
  function SummaryMenu(queryController, viewConfig, propertyId, ctx, containerEl) {
    this.pageStack = [];
    this.viewConfig = null;
    const app = this.app = queryController.app;
    this.queryController = queryController;
    this.viewConfig = viewConfig;
    this.containerEl = containerEl;
    this.propertyId = propertyId;
    this.ctx = ctx;
    this.scope = new host.Scope(app.scope);
    this.scope.register([], "Escape", () => this.close());
    const name = parsePropertyId(propertyId).name;
    this.menu = new host.s13BasesMenu(app, containerEl, name);
    this.menu.setOpen(true);
    this.show(new S13SummaryFormulaListPage(this));
  }

  SummaryMenu.prototype.show = function (page) {
    this.menu.scrollEl.setChildrenInPlace([page.containerEl]);
    page.onShow();
    this.pageStack.push(page);
    this.app.keymap.pushScope(page.scope);
  };

  SummaryMenu.prototype.isOpen = function () {
    return this.menu.isOpen;
  };

  SummaryMenu.prototype.close = function () {
    let page;
    while ((page = this.pageStack.pop())) this.app.keymap.popScope(page.scope);
    this.menu.setAutoDestroy(this.containerEl);
    this.menu.setOpen(false);
  };

  SummaryMenu.prototype.back = function () {
    const page = this.pageStack.pop();
    if (page) this.app.keymap.popScope(page.scope);
    const prev = this.pageStack.at(-1);
    if (prev) {
      this.menu.scrollEl.setChildrenInPlace([prev.containerEl]);
      prev.onShow();
    }
  };

  SummaryMenu.prototype.selectSummaryFormula = function (formula) {
    this.viewConfig.setSummaryKey(this.propertyId, formula);
  };

  SummaryMenu.prototype.getSelectedSummaryKey = function () {
    return this.viewConfig.getSummaryKey(this.propertyId);
  };

  return SummaryMenu;
}

/** Page of the summary menu listing built-in and custom summary formulas. */
export function defineS13SummaryFormulaListPage(host) {
  const collator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true }).compare;

  function FormulaListPage(controller) {
    const self = host.s13BasesToolbarPage.call(this, controller) || this;
    self.query = "";
    self.searchComponent = new host.SearchComponent(self.containerEl)
      .setPlaceholder(s13BasesT().placeholderSearchProperty())
      .onChange((query) => {
        self.query = query;
        self.renderSummaryFormulaList();
      });
    const itemsEl = self.containerEl.createDiv("bases-toolbar-items");
    self.chooser = new host.GroupedSuggestionList(self, itemsEl, self.scope);
    self.scope.register([], "ArrowRight", () => {
      const selected = self.chooser.getSelectedValue();
      if (selected?.type === "formula") self.showFormulaPage(selected.name);
    });
    return self;
  }
  inherit(FormulaListPage, host.s13BasesToolbarPage);

  FormulaListPage.prototype.onShow = function () {
    this.searchComponent.autoSelect();
    this.renderSummaryFormulaList();
  };

  FormulaListPage.prototype.showFormulaPage = function (name) {
    this.controller.show(new S13SummaryFormulaPage(this.controller, name));
  };

  FormulaListPage.prototype.selectSuggestion = function (item, el) {
    if (item.type === "action") item.callback();
    else if (item.type === "formula") {
      this.controller.selectSummaryFormula(item.name);
      this.controller.close();
    }
    const selectedEl = this.chooser.getSelectedElement();
    if (selectedEl) {
      selectedEl.empty();
      this.renderSuggestion(item, selectedEl);
    }
  };

  /** All summary formulas for the property: type defaults plus user-defined ones. */
  FormulaListPage.prototype.getSummaryFormulas = function () {
    const baseId = host.s13FormulaBaseForType(this.controller.propertyId);
    const result = {};
    const evaluated = this.controller.queryController.mockContext.evaluateIdent(baseId);
    const defaults = host.s13SummaryFormulasForType(evaluated.type);
    for (const name in defaults) result[name] = { formula: new host.s13FormulaValue(defaults[name]), custom: false };
    const custom = this.controller.queryController.query.summaryFormulas;
    if (custom) for (const name in custom) result[name] = { formula: custom[name], custom: true };
    return result;
  };

  FormulaListPage.prototype.renderSummaryFormulaList = function () {
    const self = this;
    const prepared = prepareQuery(this.query);
    const suggestions = [];
    const formulas = this.getSummaryFormulas();
    const names = Object.keys(formulas);
    names.sort(collator);
    for (const name of names) {
      if (fuzzyMatchJs(prepared, name)) {
        const entry = formulas[name];
        suggestions.push({ type: "formula", name, group: "formulas", formula: entry.formula, custom: entry.custom });
      }
    }
    const query = this.query.trim();
    if (query && !Object.hasOwn(names, query)) {
      suggestions.push({
        type: "action",
        name: s13BasesT().actionAddSummary({ name: query }),
        icon: "lucide-plus",
        group: "actions",
        callback: () => {
          const name = self.query.trim() || s13BasesT().labelUntitledProperty();
          self.controller.queryController.query.setSummaryFormula(name, new host.s13FormulaValue(""));
          self.controller.selectSummaryFormula(name);
          self.controller.show(new S13SummaryFormulaPage(self.controller, name));
        },
      });
    } else {
      suggestions.push({
        type: "action",
        name: s13BasesT().buttonAddSummary(),
        icon: "lucide-square-function",
        group: "actions",
        callback: () => {
          const name = uniqueName(new Set(names), "new summary");
          self.controller.selectSummaryFormula(name);
          self.controller.show(new S13SummaryFormulaPage(self.controller, name));
        },
      });
    }
    if (this.controller.getSelectedSummaryKey() !== null) {
      suggestions.push({
        type: "action",
        name: s13BasesT().buttonHideSummary(),
        icon: "lucide-trash-2",
        group: "actions",
        callback: () => {
          self.controller.selectSummaryFormula(null);
          self.controller.close();
        },
      });
    }
    this.chooser.setSuggestions(suggestions);
  };

  FormulaListPage.prototype.renderSuggestion = function (item, el) {
    const self = this;
    el.addClass("bases-toolbar-menu-item", "bases-summary-menu-item");
    el.toggleClass("mod-active", this.controller.getSelectedSummaryKey() === item.name);
    const info = el.createDiv("bases-toolbar-menu-item-info");
    const iconEl = info.createDiv("bases-toolbar-menu-item-info-icon");
    if (item.type === "action") {
      host.setIcon(iconEl, item.icon);
      info.createDiv({ cls: "bases-toolbar-menu-item-name", text: item.name });
    } else if (item.type === "formula") {
      info.createDiv({ cls: "bases-toolbar-menu-item-name", text: item.name });
      if (item.formula.formula instanceof host.s13FormulaParseError) {
        iconEl.addClass("mod-error");
        setElementTooltip(iconEl, item.formula.formula.getErrorMessage());
      } else {
        iconEl.removeClass("mod-error");
      }
      const value = item.formula.getValue(this.controller.ctx);
      if (value && value !== host.s13BasesValueEmpty.value) {
        if (value instanceof host.s13ErrorValue) {
          info.createDiv({ cls: "bases-toolbar-menu-item-value", text: env().gm.dialogue.labelError() });
          host.setIcon(iconEl, value.icon);
        } else {
          const text = value instanceof host.s13NumberValue ? host.s13NumberFormat({}).format(value.data) : value.toString();
          info.createDiv({ cls: "bases-toolbar-menu-item-value", text });
          host.setIcon(iconEl, value.icon);
        }
      } else {
        host.setIcon(iconEl, "lucide-square-function");
      }
      const chevron = el.createDiv("clickable-icon bases-toolbar-menu-item-icon");
      host.setIcon(chevron, "lucide-chevron-right");
      chevron.addEventListener("click", (event) => {
        event.preventDefault();
        const index = self.chooser.selectedItem;
        const selected = self.chooser.values[index];
        if (selected.type === "formula") {
          if (!selected.custom) self.controller.queryController.query.setSummaryFormula(selected.name, selected.formula);
          self.showFormulaPage(selected.name);
        }
      });
    }
  };

  S13SummaryFormulaListPage = FormulaListPage;
  return FormulaListPage;
}

/** Page of the summary menu editing one summary formula. */
export function defineS13SummaryFormulaPage(host) {
  function FormulaPage(controller, formulaName) {
    const self = host.s13BasesToolbarPage.call(this, controller) || this;
    self.formulaName = formulaName;
    const query = self.query = controller.queryController.query;
    const header = self.containerEl.createDiv("bases-toolbar-menu-container-header");
    const back = header.createDiv("back-button");
    host.setIcon(back.createDiv("back-icon"), "lucide-chevron-left");
    back.createDiv({ text: s13BasesT().titleEditProperty({ formulaName }), cls: "back-label" });
    back.addEventListener("click", () => self.controller.back());
    const more = header.createDiv("clickable-icon");
    host.setIcon(more, "lucide-more-vertical");
    const close = header.createDiv("close-icon clickable-icon");
    host.setIcon(close, "lucide-x");
    close.addEventListener("click", () => controller.close());
    self.scope.register([], "Escape", () => self.controller.back());
    const form = self.containerEl.createDiv("bases-toolbar-menu-form");
    form.createDiv("input-row", (row) => {
      row.createDiv({ cls: "input-row-label", text: s13BasesT().labelSummaryName() });
      const input = new host.TextComponent(row.createDiv("input-row-content"))
        .setPlaceholder(formulaName)
        .setValue(formulaName)
        .autoSelect()
        .inputEl;
      input.addEventListener("blur", () => {
        const value = input.value.trim();
        if (value !== formulaName) {
          query.renameSummaryFormula(formulaName, value);
          formulaName = self.formulaName = value;
        }
      });
      input.addEventListener("keydown", (event) => {
        if (event.isComposing || event.defaultPrevented) return;
        if (event.key === "Escape") {
          event.preventDefault();
          input.value = formulaName;
          input.blur();
        } else if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
    });
    const stored = query.summaryFormulas ?? {};
    const formula = Object.hasOwn(stored, formulaName) ? stored[formulaName] : null;
    const row = form.createDiv("input-row");
    host.s13FormulaEditor.appendHelpIcon(row.createDiv({ cls: "input-row-label", text: s13BasesT().labelFormula() }));
    const content = row.createDiv("input-row-content");
    new host.s13FormulaEditor(content, formula, {
      updateFormula: (value) => query.setSummaryFormula(formulaName, value),
      extensions: [new host.s13FormulaEditorExtensions(new host.s13SummaryValuesEditor(self.controller.app))],
      placeholder: "values.reduce( ... )",
    });
    more.addEventListener("click", (event) => self.showActions(event, more));
    return self;
  }
  inherit(FormulaPage, host.s13BasesToolbarPage);

  FormulaPage.prototype.showActions = function (event, target) {
    const self = this;
    if (target && target.hasClass("has-active-menu")) return;
    const menu = host.Menu.forEvent(event);
    menu.addSections(["danger"]);
    if (target) menu.setParentElement(target);
    menu.addItem((item) => item.setTitle(s13BasesT().actionDeleteSummary()).setSection("danger").setWarning(true).onClick(() => {
      self.query.deleteSummaryFormula(self.formulaName);
      self.controller.back();
    }));
    menu.showAtMouseEvent(event);
  };

  S13SummaryFormulaPage = FormulaPage;
  return FormulaPage;
}

/** Quick-switcher style modal for picking a file to insert at the cursor. */
export function defineS13FilePickerModal(host) {
  function FilePickerModal(parentArg, text) {
    const self = host.s13QuickSwitcherModalBase.call(this, parentArg) || this;
    self.emptyStateText = env().gm.plugins.quickSwitcher.labelNoNoteCreateNew();
    self.allowCreateNewFile = true;
    self.text = text;
    self.shouldShowUnresolved = true;
    self.shouldShowNonImageAttachments = false;
    self.shouldShowImages = false;
    self.shouldShowNonAttachments = false;
    self.shouldShowAllTypes = false;
    self.setPlaceholder("Choose file to insert");
    self.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to select" },
      { command: "esc", purpose: "to dismiss" },
    ]);
    return self;
  }
  inherit(FilePickerModal, host.s13QuickSwitcherModalBase);

  FilePickerModal.prototype.onChooseSuggestion = async function (suggestion) {
    const app = this.app;
    let file = null;
    try {
      if (!suggestion) {
        file = await app.fileManager.createNewMarkdownFileFromLinktext(this.inputEl.value, "");
      } else if (suggestion.type === "unresolved") {
        file = await app.fileManager.createNewMarkdownFileFromLinktext(suggestion.linktext, "");
      } else if (suggestion.type === "file" || suggestion.type === "alias") {
        file = suggestion.file;
      }
    } catch (error) {
      new host.Notice(error.toString());
    }
    if (file) {
      await app.fileManager.insertIntoFile(file, this.text);
      await app.workspace.getLeaf().openFile(file);
    }
  };

  return FilePickerModal;
}

/** Caches downscaled data-URL backgrounds for remote images (canvas covers etc.). */
export function defineS13Thumbnailer(host) {
  function Thumbnailer() {
    this.items = {};
    this.queue = new host.SerialTaskQueue();
  }

  Thumbnailer.prototype.thumbnailBg = function (el, url) {
    const self = this;
    const items = this.items;
    if (Object.hasOwn(items, url)) {
      el.style.backgroundImage = `url("${items[url]}")`;
      return;
    }
    const raw = `url("${url}")`;
    el.style.backgroundImage = raw;
    let format = "";
    try {
      format = extensionOf(new URL(url).pathname);
      if (format === "gif" || format === "svg") return;
    } catch (e) { /* keep empty format */ }
    this.queue.queue(async () => {
      if (el.style.backgroundImage !== raw) return;
      if (Object.hasOwn(items, url)) {
        el.style.backgroundImage = `url("${items[url]}")`;
        return;
      }
      const image = new Image();
      image.crossOrigin = "anonymous";
      await new Promise((resolve) => {
        const done = () => resolve();
        image.addEventListener("load", done);
        image.addEventListener("error", done);
        env().activeWindow.setTimeout(done, 10000);
        image.src = url;
      });
      if (!el.isShown() || el.style.backgroundImage !== raw) return;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (width === 0 || height === 0) {
        items[url] = url;
        return;
      }
      const scale = Math.max(el.offsetWidth / width, el.offsetHeight / height);
      const ratio = scale * el.win.devicePixelRatio;
      if (ratio <= 0 || ratio > 0.5) {
        items[url] = url;
        return;
      }
      const w = Math.ceil(width * ratio);
      const h = Math.ceil(height * ratio);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(image, 0, 0, w, h);
      const data = canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg");
      items[url] = data;
      el.style.backgroundImage = `url("${data}")`;
    });
  };

  Thumbnailer.prototype.clear = function () {
    this.items = {};
  };

  return Thumbnailer;
}

/** Help modal listing the canvas mouse/keyboard shortcuts. */
export function defineS13CanvasHelpModal(host) {
  function CanvasHelpModal(view) {
    const self = host.Modal.call(this, view.app) || this;
    self.modalEl.addClass("mod-canvas-help");
    self.setTitle(s13CanvasI18n().labelCanvasHelp());
    const root = self.contentEl.createDiv("canvas-help");
    const addInstruction = (label, combos) => {
      root.createDiv({ cls: "canvas-instruction" }, (row) => {
        row.createDiv({ cls: "canvas-instruction-label", text: label });
        row.createDiv({ cls: "canvas-instruction-desc" }, (desc) => {
          for (const combo of combos) {
            desc.createSpan({ cls: "setting-hotkey", text: s13KeyNames(combo, host) });
          }
        });
      });
    };
    let panExtra = [["Shift", "Scroll"]];
    let horizontal = [["Shift", "Scroll"]];
    let zoom = [["Mod", "Scroll"], ["Space", "Scroll"]];
    if (view.plugin.options.defaultWheelBehavior === "zoom") {
      const swapped = [zoom, panExtra];
      panExtra = swapped[0];
      zoom = swapped[1];
      horizontal = [["Mod", "Shift", "Scroll"], ["Shift", "Space", "Scroll"]];
    }
    addInstruction(s13CanvasI18n().labelPan(), [["Space", "Drag"]].concat(panExtra));
    addInstruction(s13CanvasI18n().labelPanHorizontal(), horizontal);
    addInstruction(s13CanvasI18n().labelZoom(), zoom);
    addInstruction(s13CanvasI18n().actionZoomToFit(), [["Shift", "1"]]);
    addInstruction(s13CanvasI18n().actionZoomToSelection(), [["Shift", "2"]]);
    addInstruction(s13CanvasI18n().labelSelectAll(), [["Mod", "A"]]);
    addInstruction(s13CanvasI18n().labelAddRemoveSelection(), [["Shift", "Click"], ["Shift", "Drag to select"]]);
    addInstruction(s13CanvasI18n().actionCreateWithSize(), [["Mod", "Drag to select"]]);
    addInstruction(s13CanvasI18n().labelCloneCard(), [[host.Platform.isMacOS ? "Alt" : "Ctrl", "Drag"]]);
    addInstruction(s13CanvasI18n().labelConstrainMovementAxis(), [["Shift", "Drag"]]);
    addInstruction(s13CanvasI18n().labelDisableDragSnapping(), [[host.Platform.isMacOS ? "Ctrl" : "Alt"]]);
    addInstruction(s13CanvasI18n().labelRemoveCard(), [["Backspace"], ["Delete"]]);
    addInstruction(env().gm.setting.mobileToolbar.optionUndo(), [["Mod", "Z"]]);
    addInstruction(env().gm.setting.mobileToolbar.optionRedo(), [["Mod", "Y"], ["Mod", "Shift", "Z"]]);
    return self;
  }
  inherit(CanvasHelpModal, host.Modal);

  return CanvasHelpModal;
}

/** Registry of quick actions exposed to the mobile shell (OBS_QUICK_ACTION bridge). */
export function defineS13QuickActions(host) {
  function QuickActions() {
    this.registeredActions = {};
  }

  QuickActions.prototype.load = function () {
    if (window.OBS_QUICK_ACTION_LISTENER != null) {
      window.OBS_QUICK_ACTION_LISTENER.remove();
      delete window.OBS_QUICK_ACTION_LISTENER;
    }
    if (window.OBS_QUICK_ACTION) {
      const pending = window.OBS_QUICK_ACTION;
      delete window.OBS_QUICK_ACTION;
      this.fireAction(pending);
    }
    if (host.capacitorApp) {
      host.capacitorApp.addListener("quickActionSelected", (event) => this.fireAction(event.id));
    }
  };

  QuickActions.prototype.registerQuickAction = function (id, action) {
    if (host.Platform.isMobileApp && host.capacitorApp) {
      this.registeredActions[id] = action;
      this.updateQuickActions();
    }
  };

  QuickActions.prototype.unregisterQuickAction = function (id) {
    delete this.registeredActions[id];
    this.updateQuickActions();
  };

  QuickActions.prototype.fireAction = function (id) {
    if (Object.hasOwn(this.registeredActions, id)) this.registeredActions[id].callback();
  };

  QuickActions.prototype.updateQuickActions = function () {
    const actions = Object.entries(this.registeredActions).map(([id, action]) => ({
      id,
      title: action.title,
      iconName: action.iconName,
      description: action.description,
    }));
    host.capacitorApp.setQuickActions({ actions });
  };

  return QuickActions;
}
