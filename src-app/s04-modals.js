// s04: own implementations of three small inherited classes.
//
//  - s04ThemePicker   (was `Ob`): the theme-selection fuzzy suggest modal.
//  - s04PromptModal   (was `ib`):  a DialogModal with a primary CTA button that
//                     resolves a promise on accept/cancel (subclassed by
//                     inherited dialogs, so it stays a constructor function).
//  - s04NumberComponent (was `$k`): a numeric text setting component.
//
// All three derive from classes that are already own (FuzzySuggestModal,
// DialogModal, TextComponent) reached through the host table.

import { inherit } from "./inherit.js";

/** Theme picker dialog (was `Ob`). */
export function s04ThemePicker(host) {
  function ThemePicker(app) {
    const self = host.FuzzySuggestModal.call(this, app) || this;
    self.requestThemePreview = host.debounce(self.previewTheme.bind(self), 100, true);
    self.initialTheme = app.customCss.theme;
    self.setInstructions([
      { command: "↑↓", purpose: host.t.plugins.commandPalette.instructionNavigate() },
      { command: "↵", purpose: host.t.plugins.commandPalette.instructionUse() },
      { command: "esc", purpose: host.t.plugins.commandPalette.instructionDismiss() },
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
  inherit(ThemePicker, host.FuzzySuggestModal);

  ThemePicker.prototype.getItems = function () {
    const customCss = this.app.customCss;
    const items = [{ name: "", display: host.t.setting.appearance.labelDefaultTheme() }];
    for (const name in customCss.themes) items.push({ name, display: name });
    for (const name of customCss.oldThemes) {
      if (!customCss.themes.hasOwnProperty(name)) items.push({ name, display: name + " (Legacy)" });
    }
    return items;
  };

  ThemePicker.prototype.renderSuggestion = function (result, el) {
    host.FuzzySuggestModal.prototype.renderSuggestion.call(this, result, el);
    if (result.item.name === this.initialTheme) {
      el.createSpan({ cls: "flair mod-pop", text: host.t.setting.appearance.labelCurrentlyActive() });
    }
  };

  ThemePicker.prototype.getItemText = function (item) {
    return item.display;
  };

  ThemePicker.prototype.onChooseItem = function (item) {
    this.app.customCss.setTheme(item.name);
  };

  ThemePicker.prototype.onSelectedChange = function (suggestion, event) {
    if (event && event.instanceOf(KeyboardEvent)) this.requestThemePreview(suggestion.item.name);
  };

  ThemePicker.prototype.previewTheme = function (name) {
    if (this.isOpen) this.app.customCss.setTheme(name);
  };

  ThemePicker.prototype.onEscapeKey = function (event) {
    host.FuzzySuggestModal.prototype.onEscapeKey.call(this, event);
    this.app.customCss.setTheme(this.initialTheme);
  };

  return ThemePicker;
}

/** Dialog with a configurable primary button resolving a promise (was `ib`). */
export function s04PromptModal(host) {
  function PromptModal(app) {
    const self = host.DialogModal.call(this, app) || this;
    self.ctaCls = "mod-cta";
    self.ctaText = "";
    self.resolve = null;
    self.scope.register([], "Enter", self.accept.bind(self));
    return self;
  }
  inherit(PromptModal, host.DialogModal);

  PromptModal.prototype.setCta = function (cls, text) {
    this.ctaCls = cls;
    this.ctaText = text;
    return this;
  };

  PromptModal.prototype.onOpen = function () {
    const self = this;
    this.promise = new Promise((resolve) => {
      self.resolve = resolve;
    });
  };

  PromptModal.prototype.accept = function () {
    if (this.resolve) this.resolve(true);
  };

  PromptModal.prototype.cancel = function () {
    if (this.resolve) this.resolve(false);
  };

  PromptModal.prototype.prompt = async function () {
    this.addButton(this.ctaCls, this.ctaText, this.accept.bind(this));
    this.addCancelButton(this.cancel.bind(this));
    this.open();
    return this.promise;
  };

  PromptModal.prototype.onClose = function () {
    host.DialogModal.prototype.onClose.call(this);
    this.cancel();
  };

  return PromptModal;
}

/** Number input setting component (was `$k`). */
export function s04NumberComponent(host) {
  function NumberComponent() {
    const self = host.TextComponent.apply(this, arguments) || this;
    self.inputEl.setAttribute("type", "number");
    return self;
  }
  inherit(NumberComponent, host.TextComponent);

  NumberComponent.prototype.getValueAsNumber = function () {
    return this.inputEl.valueAsNumber;
  };

  NumberComponent.prototype.setValueAsNumber = function (value) {
    this.inputEl.valueAsNumber = value;
    return this;
  };

  NumberComponent.prototype.setLimits = function (min, max, step) {
    this.inputEl.setAttrs({ min, max, step });
    return this;
  };

  return NumberComponent;
}
