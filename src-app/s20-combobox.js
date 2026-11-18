// s20: the combobox — a PopoverSuggest with a button, optional clear button, icon and
// an inline search field. Used for filter/dropdown settings controls.
//   MI  ComboboxSuggest (extends PopoverSuggest)

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { fuzzyMatchJs, prepareQuery } from "./search.js";

/** Combobox dropdown: button + chevron + clear, searchable item list, mobile bottom-sheet mode. */
export function defineS20Combobox(host) {
  function Combobox(app, buttonContainer) {
    const self = host.PopoverSuggest.call(this, app) || this;
    self.clearable = false;
    self._items = [];
    self.value = null;
    self.app = app;
    self.suggestEl.addClass("combobox");
    const bgEl = (self.bgEl = createDiv("suggestion-bg"));
    bgEl.style.opacity = "0";
    const buttonEl = (self.buttonEl = buttonContainer.createDiv({ cls: "combobox-button", attr: { tabindex: 0 } }));
    const iconEl = (self.iconEl = buttonEl.createDiv("combobox-button-icon"));
    iconEl.hide();
    self.labelEl = buttonEl.createDiv("combobox-button-label");
    buttonEl.createDiv("combobox-clear-button", (clear) => {
      host.setIcon(clear, "lucide-x");
      clear.addEventListener("mousedown", (event) => event.preventDefault());
      clear.addEventListener("click", (event) => {
        event.preventDefault();
        buttonEl.blur();
        self.selectSuggestion(null, event);
      });
    });
    buttonEl.createDiv("combobox-button-chevron", (chevron) => host.setIcon(chevron, "lucide-chevrons-up-down"));
    buttonEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key.startsWith("Arrow") || event.key.length === 1) self.open();
    });
    buttonEl.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      self.toggle();
    });
    self.searchComponent = new host.SearchComponent(self.suggestEl)
      .setPlaceholder(host.t.plugins.search.promptStartSearch())
      .onChange((value) => self.onInputChange(value));
    self.suggestEl.prepend(self.searchComponent.containerEl);
    self.suggestEl.on("mousedown", ".suggestion", (event) => event.preventDefault());
    const inputEl = self.searchComponent.inputEl;
    inputEl.addEventListener("focus", () => self.suggestEl.addClass("has-input-focus"));
    inputEl.addEventListener("blur", () => self.suggestEl.removeClass("has-input-focus"));
    inputEl.addEventListener("keydown", (event) => {
      if (event.isComposing || event.key !== "Tab") return;
      host.s20FocusEl(buttonEl, { preventScroll: true });
    });
    self.suggestEl.addEventListener("focusout", (event) => {
      inputEl.win.setTimeout(() => {
        if (!buttonEl.isActiveElement()) self.close();
      }, 0);
    });
    if (host.Platform.isPhone) {
      self.suggestEl.createDiv({ cls: "menu-grabber", prepend: true });
      self.suggestEl.addClass("menu");
      self.suggestInnerEl.addClass("menu-scroll");
      bgEl.addEventListener("mousedown", (event) => event.preventDefault());
      bgEl.onClickEvent(() => self.close());
      host.swipeToDismiss(self.suggestEl, self.suggestInnerEl, bgEl, () => {
        self.suggestEl.detach();
        self.close();
      });
    }
    return self;
  }
  inherit(Combobox, host.PopoverSuggest);
  const proto = Combobox.prototype;

  proto.setPlaceholder = function (placeholder) {
    this.labelEl.setAttribute("placeholder", placeholder);
    return this;
  };
  proto.setItems = function (items) {
    this._items = items;
    return this;
  };
  proto.getItems = function () {
    return this._items;
  };
  proto.setClearable = function (clearable) {
    this.clearable = clearable;
    if (this.value != null) this.renderLabel();
    return this;
  };
  proto.renderLabel = function () {
    const value = this.value;
    let text = "";
    if (value) text = value.display != null ? value.display : value.value;
    this.labelEl.setText(text);
    if (value && value.icon) host.setIcon(this.iconEl, value.icon);
    else this.iconEl.empty();
    this.buttonEl.toggleClass("mod-clearable", this.clearable && value != null);
    this.iconEl.toggle(!!(value && value.icon));
  };
  proto.setValue = function (value) {
    this.value = value;
    this.renderLabel();
    return this;
  };
  proto.setValueById = function (id) {
    const item = this.getItems().find((entry) => entry.value === id);
    if (item) this.setValue(item);
    return this;
  };
  proto.toggle = function () {
    if (this.isOpen) {
      host.s20FocusEl(this.buttonEl, { preventScroll: true });
      this.close();
    } else {
      this.open();
    }
  };
  proto.close = function () {
    if (!this.isOpen) return;
    host.PopoverSuggest.prototype.close.call(this);
    this.isOpen = false;
    this.buttonEl.removeClass("has-focus");
    this.searchComponent.inputEl.value = "";
    if (this._onClose) this._onClose();
  };
  proto.attachDom = function () {
    const bgEl = this.bgEl;
    const suggestEl = this.suggestEl;
    env().activeDocument.body.appendChild(suggestEl);
    if (host.Platform.isPhone) {
      env().activeDocument.body.appendChild(bgEl);
      host.Pl(suggestEl, bgEl);
    } else {
      host.PopoverSuggest.prototype.attachDom.call(this);
    }
    suggestEl.style.left = "";
    suggestEl.style.top = "";
  };
  proto.detachDom = async function () {
    const bgEl = this.bgEl;
    const suggestEl = this.suggestEl;
    if (host.Platform.isPhone) {
      if (bgEl.isShown()) await host.Ll(suggestEl, bgEl);
    } else {
      host.PopoverSuggest.prototype.detachDom.call(this);
    }
    suggestEl.detach();
    bgEl.detach();
  };
  proto.open = function () {
    if (this.isOpen) return;
    host.PopoverSuggest.prototype.open.call(this);
    this.buttonEl.addClass("has-focus");
    if (host.Platform.isPhone) {
      this.suggestions.setSuggestions(this.getSuggestions(""));
    } else {
      const rect = this.buttonEl.getBoundingClientRect();
      this.suggestions.setSuggestions(this.getSuggestions(""));
      this.reposition(rect);
      this.searchComponent.autoSelect();
    }
    this.setAutoDestroy(this.buttonEl);
    if (this._onOpen) this._onOpen();
  };
  proto.onOpen = function (callback) {
    this._onOpen = callback;
    return this;
  };
  proto.onClose = function (callback) {
    this._onClose = callback;
    return this;
  };
  proto.onEscapeKey = function (event) {
    host.s20FocusEl(this.buttonEl, { preventScroll: true });
    this.close();
  };
  proto.selectSuggestion = function (value, event) {
    this.setValue(value);
    host.s20FocusEl(this.buttonEl, { preventScroll: true });
    if (this.selectCb) this.selectCb(value);
    this.close();
  };
  proto.renderSuggestion = function (value, el) {
    el.addClasses(["mod-complex", "mod-toggle"]);
    if (this.value && this.value.value === value.value) host.setIcon(el.createDiv("suggestion-icon mod-checked"), "lucide-check");
    if (value.icon) host.setIcon(el.createDiv("suggestion-icon").createDiv("suggestion-flair"), value.icon);
    host.renderResults(el.createSpan("suggestion-content").createDiv("suggestion-title"), value.display != null ? value.display : value.value, value);
  };
  proto.onInputChange = function (value) {
    const suggestions = this.getSuggestions(value);
    this.suggestions.setSuggestions(suggestions);
  };
  proto.getSuggestions = function (query) {
    const prepared = prepareQuery(query);
    const out = [];
    for (const item of this.getItems()) {
      let hit = fuzzyMatchJs(prepared, item.value);
      if (hit) {
        out.push({ ...item, matches: hit.matches, score: hit.score });
      } else if (item.display) {
        hit = fuzzyMatchJs(prepared, item.display);
        if (hit) out.push({ ...item, matches: hit.matches, score: hit.score - 10 });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  };
  proto.onSelect = function (callback) {
    this.selectCb = callback;
    return this;
  };
  proto.focus = function () {
    host.s20FocusEl(this.buttonEl, { preventScroll: true });
    this.open();
  };
  return Combobox;
}
