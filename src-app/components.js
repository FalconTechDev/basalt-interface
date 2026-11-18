// The settings framework of the plugin API: Setting (one row), SettingGroup, the form components that go into a row's control area
// (button, toggle, text, dropdown, slider, colour ...) and the base classes of settings tabs.
//
// Every component is a small object that owns one DOM element, has chainable setters and reports changes through `onChange` /
// `onClick`. All names, constructor signatures and return values (`this` for chaining) are part of the public plugin API.
import { inherit } from "./inherit.js";
import { parseHexColor, rgbToHex, rgbToHsl, hslToRgb } from "./misc.js";

export function defineBaseComponent() {
  /** Common root: `disabled` flag and `then(cb)` for inline configuration. */
  function BaseComponent() {
    this.disabled = false;
  }
  BaseComponent.prototype.then = function (callback) {
    callback(this);
    return this;
  };
  BaseComponent.prototype.setDisabled = function (disabled) {
    this.disabled = disabled;
    return this;
  };
  return BaseComponent;
}

export function defineValueComponent(host) {
  /** A component that holds a value (getValue / setValue) and can bind it to a property of an options object. */
  function ValueComponent() {
    return host.BaseComponent.apply(this, arguments) || this;
  }
  inherit(ValueComponent, host.BaseComponent);
  /** Makes `target[key]` a getter/setter function: `target[key]()` reads, `target[key](v)` writes. */
  ValueComponent.prototype.registerOptionListener = function (target, key) {
    target[key] = (value) => {
      if (value !== undefined) this.setValue(value);
      return this.getValue();
    };
    return this;
  };
  return ValueComponent;
}

export function defineButtonComponent(host) {
  function ButtonComponent(containerEl) {
    const self = host.BaseComponent.call(this) || this;
    const button = (self.buttonEl = containerEl.createEl("button"));
    button.addEventListener("click", async (event) => {
      const callback = self.clickCallback;
      if (self.disabled || !callback) return;
      // an async callback keeps the button in its "loading" look until it settles
      button.addClass("mod-loading");
      try {
        await callback(event);
      } finally {
        button.removeClass("mod-loading");
      }
    });
    return self;
  }
  inherit(ButtonComponent, host.BaseComponent);
  const proto = ButtonComponent.prototype;
  proto.setDisabled = function (disabled) {
    host.BaseComponent.prototype.setDisabled.call(this, disabled);
    this.buttonEl.disabled = disabled;
    return this;
  };
  proto.setLoading = function (loading) { this.buttonEl.toggleClass("mod-loading", loading); return this; };
  proto.setCta = function () { this.buttonEl.addClass("mod-cta"); return this; };
  proto.removeCta = function () { this.buttonEl.removeClass("mod-cta"); return this; };
  proto.setWarning = function () { this.buttonEl.addClass("mod-warning"); return this; };
  proto.setTooltip = function (text, options) { host.setTooltip(this.buttonEl, text, options); return this; };
  proto.setButtonText = function (text) { this.buttonEl.setText(text); return this; };
  proto.setIcon = function (icon) { host.setIcon(this.buttonEl, icon); return this; };
  proto.setClass = function (cls) { this.buttonEl.addClass(cls); return this; };
  proto.onClick = function (callback) { this.clickCallback = callback; return this; };
  return ButtonComponent;
}

export function defineExtraButtonComponent(host) {
  /** The round gear-like icon button at the right of a setting. */
  function ExtraButtonComponent(containerEl) {
    const self = host.BaseComponent.call(this) || this;
    const el = (self.extraSettingsEl = containerEl.createDiv("clickable-icon extra-setting-button"));
    host.setIcon(el, "lucide-settings");
    el.addEventListener("click", () => {
      const callback = self.changeCallback;
      if (!self.disabled && callback) callback();
    });
    return self;
  }
  inherit(ExtraButtonComponent, host.BaseComponent);
  const proto = ExtraButtonComponent.prototype;
  proto.setDisabled = function (disabled) {
    host.BaseComponent.prototype.setDisabled.call(this, disabled);
    this.extraSettingsEl.toggleClass("is-disabled", disabled);
    return this;
  };
  proto.setTooltip = function (text, options) { host.setTooltip(this.extraSettingsEl, text, options); return this; };
  proto.setIcon = function (icon) { host.setIcon(this.extraSettingsEl, icon); return this; };
  proto.onClick = function (callback) { this.changeCallback = callback; return this; };
  return ExtraButtonComponent;
}

export function defineToggleComponent(host) {
  function ToggleComponent(containerEl) {
    const self = host.ValueComponent.call(this) || this;
    self.on = false;
    self.toggleEl = containerEl.createEl("label", { cls: "checkbox-container", attr: { tabIndex: 0 } }, (label) => {
      label.createEl("input", { attr: { type: "checkbox", tabIndex: 0 } });
      label.addEventListener("change", self.onClick.bind(self));
    });
    return self;
  }
  inherit(ToggleComponent, host.ValueComponent);
  const proto = ToggleComponent.prototype;
  proto.setDisabled = function (disabled) {
    host.ValueComponent.prototype.setDisabled.call(this, disabled);
    this.toggleEl.toggleClass("is-disabled", disabled);
    return this;
  };
  proto.getValue = function () { return this.on; };
  proto.setValue = function (on) {
    if (this.on !== on) {
      this.on = on;
      this.toggleEl.toggleClass("is-enabled", on);
      if (this.changeCallback) this.changeCallback.call(this, on);
    }
    return this;
  };
  proto.setSmall = function () { this.toggleEl.addClass("mod-small"); return this; };
  proto.setTooltip = function (text, options) { host.setTooltip(this.toggleEl, text, options); return this; };
  proto.onClick = function () {
    if (this.disabled) return;
    navigator.vibrate(100);
    this.setValue(!this.getValue());
  };
  proto.onChange = function (callback) { this.changeCallback = callback; return this; };
  return ToggleComponent;
}

export function defineAbstractTextComponent(host) {
  /** Base of the text-like inputs: wraps an <input> / <textarea> element. */
  function AbstractTextComponent(inputEl) {
    const self = host.ValueComponent.call(this) || this;
    self.inputEl = inputEl;
    inputEl.addEventListener("input", self.onChanged.bind(self));
    inputEl.setAttribute("spellcheck", "false");
    return self;
  }
  inherit(AbstractTextComponent, host.ValueComponent);
  const proto = AbstractTextComponent.prototype;
  proto.setDisabled = function (disabled) {
    host.ValueComponent.prototype.setDisabled.call(this, disabled);
    this.inputEl.disabled = disabled;
    return this;
  };
  proto.getValue = function () { return this.inputEl.value; };
  proto.setValue = function (value) {
    if (String.isString(value)) this.inputEl.value = value;
    return this;
  };
  proto.setPlaceholder = function (text) { this.inputEl.setAttribute("placeholder", text); return this; };
  proto.onChanged = function () {
    const callback = this.changeCallback;
    if (callback) callback(this.inputEl.value);
  };
  proto.onChange = function (callback) { this.changeCallback = callback; return this; };
  return AbstractTextComponent;
}

export function defineTextComponent(host) {
  function TextComponent(containerEl) {
    return host.AbstractTextComponent.call(this, containerEl.createEl("input", { type: "text" })) || this;
  }
  inherit(TextComponent, host.AbstractTextComponent);
  TextComponent.prototype.autoSelect = function (selectAll = false) {
    host.selectOnFocus(this.inputEl, selectAll);
    return this;
  };
  return TextComponent;
}

export function defineSearchComponent(host) {
  /** A search field with a clear (x) button. */
  function SearchComponent(containerEl) {
    const wrapper = containerEl.createDiv("search-input-container");
    const input = wrapper.createEl("input", { type: "search", attr: { enterkeyhint: "search" } });
    const self = host.AbstractTextComponent.call(this, input) || this;
    self.containerEl = wrapper;
    self.clearButtonEl = wrapper.createDiv("search-input-clear-button", (button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        if (self.disabled) return;
        input.value = "";
        self.onChanged();
        input.focus();
      });
    });
    return self;
  }
  inherit(SearchComponent, host.AbstractTextComponent);
  const proto = SearchComponent.prototype;
  proto.onChanged = function () { host.AbstractTextComponent.prototype.onChanged.call(this); };
  proto.setValue = function (value) { return host.AbstractTextComponent.prototype.setValue.call(this, value); };
  proto.setClass = function (cls) { this.containerEl.addClass(cls); return this; };
  proto.autoSelect = function () { host.selectOnFocus(this.inputEl); return this; };
  proto.addRightDecorator = function (callback) {
    callback(this.containerEl.createDiv("input-right-decorator"));
    return this;
  };
  return SearchComponent;
}

export function defineTextAreaComponent(host) {
  function TextAreaComponent(containerEl) {
    return host.AbstractTextComponent.call(this, containerEl.createEl("textarea")) || this;
  }
  return inherit(TextAreaComponent, host.AbstractTextComponent);
}

export function defineMomentFormatComponent(host) {
  /** A text field for a moment.js format string with a live sample of today's date in that format. */
  function MomentFormatComponent() {
    return host.TextComponent.apply(this, arguments) || this;
  }
  inherit(MomentFormatComponent, host.TextComponent);
  const proto = MomentFormatComponent.prototype;
  proto.setDefaultFormat = function (format) {
    this.defaultFormat = format;
    this.setPlaceholder(format);
    this.updateSample();
    return this;
  };
  proto.setSampleEl = function (el) {
    this.sampleEl = el;
    this.updateSample();
    return this;
  };
  proto.setValue = function (value) {
    host.TextComponent.prototype.setValue.call(this, value);
    this.updateSample();
    return this;
  };
  proto.onChanged = function () {
    host.TextComponent.prototype.onChanged.call(this);
    this.updateSample();
  };
  proto.updateSample = function () {
    const el = this.sampleEl;
    if (!el) return;
    const format = this.inputEl.value || this.defaultFormat;
    el.setText(format ? window.moment().format(format) : "");
  };
  return MomentFormatComponent;
}

export function defineDropdownComponent(host) {
  function DropdownComponent(containerEl) {
    const self = host.ValueComponent.call(this) || this;
    self.selectEl = containerEl.createEl("select", "dropdown");
    self.selectEl.addEventListener("change", () => {
      const callback = self.changeCallback;
      if (callback) callback(self.getValue());
    });
    return self;
  }
  inherit(DropdownComponent, host.ValueComponent);
  const proto = DropdownComponent.prototype;
  proto.setDisabled = function (disabled) {
    host.ValueComponent.prototype.setDisabled.call(this, disabled);
    this.selectEl.disabled = disabled;
    return this;
  };
  proto.addOption = function (value, label) {
    this.selectEl.createEl("option", { value, text: label });
    return this;
  };
  /** `options`: { value: label, ... } */
  proto.addOptions = function (options) {
    for (const value in options) if (options.hasOwnProperty(value)) this.selectEl.createEl("option", { value, text: options[value] });
    return this;
  };
  proto.getValue = function () { return this.selectEl.value; };
  proto.setValue = function (value) { this.selectEl.value = value; return this; };
  proto.onChange = function (callback) { this.changeCallback = callback; return this; };
  return DropdownComponent;
}

export function defineProgressBarComponent(host) {
  function ProgressBarComponent(containerEl) {
    const self = host.ValueComponent.call(this) || this;
    self.progressBar = containerEl.createDiv("setting-progress-bar", (bar) => {
      self.lineEl = bar.createDiv("setting-progress-bar-inner");
    });
    return self;
  }
  inherit(ProgressBarComponent, host.ValueComponent);
  ProgressBarComponent.prototype.getValue = function () { return this.value; };
  /** Percent, clamped to 0..100. */
  ProgressBarComponent.prototype.setValue = function (percent) {
    percent = Math.clamp(percent, 0, 100);
    this.value = percent;
    this.lineEl.style.width = `${percent}%`;
    return this;
  };
  ProgressBarComponent.prototype.setVisibility = function (visible) {
    this.progressBar.hidden = !visible;
    return this;
  };
  return ProgressBarComponent;
}

export function defineSliderComponent(host) {
  function SliderComponent(containerEl) {
    const self = host.ValueComponent.call(this) || this;
    self.dynamicTooltip = false;
    self.instant = false; // report while dragging instead of on release
    const slider = (self.sliderEl = containerEl.createEl("input", { type: "range", cls: "slider" }));
    slider.dataset.ignoreSwipe = "true";
    slider.addEventListener("input", () => {
      navigator.vibrate(100);
      if (self.dynamicTooltip) self.showTooltip();
      if (self.instant) {
        const callback = self.changeCallback;
        if (callback) callback(self.getValue());
      }
    });
    slider.addEventListener("change", () => {
      if (self.instant) return;
      const callback = self.changeCallback;
      if (callback) callback(self.getValue());
    });
    slider.addEventListener("touchend", () => { host.hideTooltip(); });
    slider.addEventListener("click", (event) => { event.stopPropagation(); });
    return self;
  }
  inherit(SliderComponent, host.ValueComponent);
  const proto = SliderComponent.prototype;
  proto.setDisabled = function (disabled) {
    host.ValueComponent.prototype.setDisabled.call(this, disabled);
    this.sliderEl.disabled = disabled;
    return this;
  };
  proto.setInstant = function (instant) { this.instant = instant; return this; };
  proto.setLimits = function (min, max, step) {
    this.sliderEl.setAttrs({ min, max, step });
    return this;
  };
  proto.getValue = function () { return this.sliderEl.valueAsNumber; };
  proto.setValue = function (value) {
    if (this.sliderEl.valueAsNumber !== value) {
      this.sliderEl.valueAsNumber = value;
      const callback = this.changeCallback;
      if (callback) callback(value);
    }
    return this;
  };
  /** The value as text: two decimals for fractional steps. */
  proto.getValuePretty = function () {
    const slider = this.sliderEl;
    const value = this.getValue();
    return slider.step === "any" || parseFloat(slider.step) < 1 ? value.toFixed(2) : value.toString();
  };
  proto.setDynamicTooltip = function () {
    this.sliderEl.addEventListener("mouseenter", this.showTooltip.bind(this));
    this.sliderEl.addEventListener("mouseleave", host.hideTooltip);
    this.dynamicTooltip = true;
    return this;
  };
  proto.showTooltip = function () {
    host.displayTooltip(this.sliderEl, this.getValuePretty(), { placement: "top" });
  };
  proto.onChange = function (callback) { this.changeCallback = callback; return this; };
  return SliderComponent;
}

export function defineColorComponent(host) {
  /** Colour picker; values as "#rrggbb", { r, g, b } (0..255), { h, s, l } or a 24-bit integer. */
  function ColorComponent(containerEl) {
    const self = host.ValueComponent.call(this) || this;
    self.colorPickerEl = containerEl.createEl("input", { type: "color" });
    self.colorPickerEl.addEventListener("change", () => {
      const callback = self.changeCallback;
      if (callback) callback(self.getValue());
    });
    return self;
  }
  inherit(ColorComponent, host.ValueComponent);
  const proto = ColorComponent.prototype;
  proto.setDisabled = function (disabled) {
    host.ValueComponent.prototype.setDisabled.call(this, disabled);
    this.colorPickerEl.disabled = disabled;
    return this;
  };
  proto.getValue = function () { return this.colorPickerEl.value; };
  proto.getValueRgb = function () { return parseHexColor(this.getValue()) || { r: 0, g: 0, b: 0 }; };
  proto.getValueHsl = function () { return rgbToHsl(this.getValueRgb()); };
  proto.getValueInt = function () { return parseInt(this.getValue().slice(1), 16); };
  proto.setValue = function (hex) {
    if (this.colorPickerEl.value !== hex) {
      this.colorPickerEl.value = hex;
      const callback = this.changeCallback;
      if (callback) callback(this.getValue());
    }
    return this;
  };
  proto.setValueRgb = function (rgb) { return this.setValue(rgbToHex(rgb)); };
  proto.setValueHsl = function (hsl) { return this.setValueRgb(hslToRgb(hsl)); };
  proto.setValueInt = function (int) { return this.setValue("#" + int.toString(16).padStart(6, "0")); };
  proto.onChange = function (callback) { this.changeCallback = callback; return this; };
  return ColorComponent;
}

export function defineSetting(host) {
  /** One row of a settings page: name, description and a control area that the add* methods fill with components. */
  function Setting(containerEl) {
    this.components = [];
    const row = (this.settingEl = containerEl.createDiv("setting-item"));
    const info = (this.infoEl = row.createDiv("setting-item-info"));
    this.nameEl = info.createDiv("setting-item-name");
    this.descEl = info.createDiv("setting-item-description");
    this.controlEl = row.createDiv("setting-item-control");
  }
  const proto = Setting.prototype;
  /** Creates the component, remembers it (for setDisabled) and hands it to the caller's configure function. */
  const addComponent = (setting, Component, configure) => {
    const component = new Component(setting.controlEl);
    setting.components.push(component);
    configure(component);
    return setting;
  };

  proto.setName = function (name) { this.nameEl.setText(name); return this; };
  proto.setDesc = function (desc) { this.descEl.setText(desc); return this; };
  proto.setClass = function (cls) { this.settingEl.addClass(cls); return this; };
  proto.setTooltip = function (text, options) { host.setTooltip(this.nameEl, text, options); return this; };
  proto.setHeading = function () { this.settingEl.addClass("setting-item-heading"); return this; };
  proto.setDisabled = function (disabled) {
    this.settingEl.toggleClass("is-disabled", disabled);
    for (const component of this.components) component.setDisabled(disabled);
    return this;
  };
  proto.setNoInfo = function () { this.infoEl.hide(); return this; };
  proto.addButton = function (configure) { return addComponent(this, host.ButtonComponent, configure); };
  proto.addExtraButton = function (configure) { return addComponent(this, host.ExtraButtonComponent, configure); };
  proto.addToggle = function (configure) {
    addComponent(this, host.ToggleComponent, configure);
    this.settingEl.addClass("mod-toggle");
    return this;
  };
  proto.addText = function (configure) {
    const text = new host.TextComponent(this.controlEl);
    if (!host.Platform.hasPhysicalKeyboard) {
      // on-screen keyboards: Enter dismisses it
      const input = text.inputEl;
      input.addEventListener("keydown", (event) => {
        if (!event.isComposing && !event.defaultPrevented && event.key === "Enter") input.blur();
      });
    }
    this.components.push(text);
    configure(text);
    return this;
  };
  /** `factory(controlEl)` creates any component of your own. */
  proto.addComponent = function (factory) {
    this.components.push(factory(this.controlEl));
    return this;
  };
  proto.addSearch = function (configure) { return addComponent(this, host.SearchComponent, configure); };
  proto.addTextArea = function (configure) { return addComponent(this, host.TextAreaComponent, configure); };
  proto.addMomentFormat = function (configure) { return addComponent(this, host.MomentFormatComponent, configure); };
  proto.addDropdown = function (configure) { return addComponent(this, host.DropdownComponent, configure); };
  proto.addColorPicker = function (configure) { return addComponent(this, host.ColorComponent, configure); };
  proto.addProgressBar = function (configure) { return addComponent(this, host.ProgressBarComponent, configure); };
  proto.addSlider = function (configure) { return addComponent(this, host.SliderComponent, configure); };
  proto.then = function (callback) { callback(this); return this; };
  proto.clear = function () {
    this.controlEl.empty();
    this.components = [];
    return this;
  };
  proto.setVisibility = function (visible) { this.settingEl.toggle(visible); return this; };
  return Setting;
}

export function defineSettingGroup(host) {
  /** A titled box of settings. */
  function SettingGroup(containerEl) {
    this.components = [];
    const group = (this.groupEl = containerEl.createDiv("setting-group"));
    const header = (this.headerEl = createDiv("setting-item setting-item-heading"));
    this.headerInnerEl = header.createDiv("setting-item-name");
    this.controlEl = header.createDiv("setting-item-control");
    this.listEl = group.createDiv("setting-items");
  }
  const proto = SettingGroup.prototype;
  /** The header is only in the DOM while there is a heading text. */
  proto.setHeading = function (text) {
    this.headerInnerEl.setText(text);
    const attached = this.headerEl.isShown();
    if (text && !attached) this.groupEl.prepend(this.headerEl);
    else if (!text && attached) this.headerEl.detach();
    return this;
  };
  proto.addClass = function (cls) { this.groupEl.addClass(cls); return this; };
  proto.addSetting = function (configure) { configure(new host.Setting(this.listEl)); return this; };
  proto.addSearch = function (configure) {
    if (!this.searchContainerEl) {
      this.searchContainerEl = createDiv("setting-group-search");
      this.groupEl.insertBefore(this.searchContainerEl, this.listEl);
    }
    const search = new host.SearchComponent(this.searchContainerEl);
    this.components.push(search);
    configure(search);
    return this;
  };
  proto.addExtraButton = function (configure) {
    const button = new host.ExtraButtonComponent(this.controlEl);
    this.components.push(button);
    configure(button);
    return this;
  };
  return SettingGroup;
}

export function defineSettingTab() {
  /** Base of a page in the settings dialog; `containerEl` is where the page draws itself. */
  function SettingTab(app, setting) {
    this.app = app;
    this.setting = setting;
    this.containerEl = createDiv("vertical-tab-content");
    this.navEl = null;
  }
  SettingTab.prototype.hide = function () {};
  return SettingTab;
}

export function definePluginSettingTab(host) {
  function PluginSettingTab(app, plugin) {
    const self = host.SettingTab.call(this, app, app.setting) || this;
    self.plugin = plugin;
    self.name = plugin.manifest.name;
    self.id = plugin.manifest.id;
    return self;
  }
  return inherit(PluginSettingTab, host.SettingTab);
}

export function defineInstanceSettingTab(host) {
  /** Settings tab of an internal plugin: named after the plugin instance (`plugin.instance`), not a manifest. */
  function InstanceSettingTab(app, plugin) {
    const self = host.SettingTab.call(this, app, app.setting) || this;
    self.plugin = plugin;
    self.name = plugin.instance.name;
    self.id = plugin.instance.id;
    return self;
  }
  return inherit(InstanceSettingTab, host.SettingTab);
}
