// s06 property-editor widgets: the per-type value items shown in the properties
// editor (text, number, checkbox, date, file, folder, aliases, tags, multitext,
// unknown, property key), the multi-select and combobox controls they embed,
// the file/folder/tag suggest popups, the change-type dialog, and the twelve
// property-type descriptor objects consumed through host.propertyTypeWidgets.
//
// Every widget class is produced through s06PropClass(), a per-module registry,
// so the class object an app var receives is the same one sibling widgets and
// the descriptor objects see (instanceof stays meaningful). Bases that are
// still inherited are reached through `host`; names already rewritten are
// called directly; late-bound bundle values go through env().
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { s06TagSuggestions, s06DateFormats, s06DateTimeFormats, s06DropLinkTexts } from "./s06-util.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { renderResults, renderMatches } from "./search-simple.js";
import { setElementTooltip, hideTooltip, displayTooltip } from "./tooltip.js";
import { tagValid } from "./metadata-helpers.js";
import { copyTextToClipboard } from "./n-g11-view.js";
import { toStringList } from "./text.js";
import { isStringArray } from "./misc.js";

const gm = () => env().gm;
const platform = () => env().Yl;
const keymap = () => env().Bg;
const menu = () => env().Ug;

// ---- class registry -------------------------------------------------------
const s06PropCache = new Map();
function s06PropClass(key, host, build) {
  let cls = s06PropCache.get(key);
  if (!cls) { cls = build(host); s06PropCache.set(key, cls); }
  return cls;
}

// ---- shared bases ---------------------------------------------------------

function buildS06ValueItem() {
  function ValueItem(containerEl) { this.containerEl = containerEl; }
  ValueItem.prototype.focus = function (position) {
    if (position === undefined) position = "both";
    this.onFocus(position);
  };
  return ValueItem;
}
export function defineS06ValueItem(host) {
  return s06PropClass("valueItem", host, () => buildS06ValueItem());
}

function buildS06UnknownValue(host) {
  const Base = s06PropClass("valueItem", host, () => buildS06ValueItem());
  function UnknownValue(el, value) {
    const self = Base.call(this, el) || this;
    self.type = "unknown";
    self.el = el.createSpan({ cls: "metadata-property-value-item mod-unknown", text: JSON.stringify(value), attr: { tabindex: 0 } });
    return self;
  }
  inherit(UnknownValue, Base);
  UnknownValue.prototype.onFocus = function () { this.el.focus(); };
  UnknownValue.prototype.setValue = function (value) { this.el.setText(JSON.stringify(value)); };
  return UnknownValue;
}
export function defineS06UnknownValue(host) {
  return s06PropClass("unknownValue", host, buildS06UnknownValue);
}

function buildS06CheckboxValue(host) {
  const Base = s06PropClass("valueItem", host, () => buildS06ValueItem());
  function CheckboxValue(ctx, containerEl, value) {
    const self = Base.call(this, containerEl) || this;
    self.type = "checkbox";
    const checkboxEl = self.checkboxEl = containerEl.createEl("input", { type: "checkbox", cls: "metadata-input-checkbox" });
    checkboxEl.checked = value;
    checkboxEl.setAttr("data-indeterminate", value == null);
    checkboxEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      ctx.blur();
    });
    checkboxEl.addEventListener("change", (e) => {
      navigator.vibrate(100);
      ctx.onChange(checkboxEl.checked);
      checkboxEl.setAttr("data-indeterminate", false);
    });
    return self;
  }
  inherit(CheckboxValue, Base);
  CheckboxValue.prototype.onFocus = function () { this.checkboxEl.focus(); };
  CheckboxValue.prototype.setValue = function (value) {
    if (value === null) {
      this.checkboxEl.checked = false;
      this.checkboxEl.setAttr("data-indeterminate", true);
      return;
    }
    this.checkboxEl.checked = value;
  };
  return CheckboxValue;
}
export function defineS06CheckboxValue(host) {
  return s06PropClass("checkboxValue", host, buildS06CheckboxValue);
}

function s06FileLikeValue(host, typeName, SuggestClass, suggestArgs) {
  const Base = s06PropClass("valueItem", host, () => buildS06ValueItem());
  function FileValue(ctx, containerEl, value) {
    const self = Base.call(this, containerEl) || this;
    self.type = typeName;
    const inputEl = self.inputEl = containerEl.createEl("input", {
      cls: "metadata-input metadata-input-text", type: "text",
      placeholder: gm().properties.labelNoValue(), value: value != null ? value : "",
    });
    inputEl.addEventListener("change", () => ctx.onChange(inputEl.value));
    inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      ctx.blur();
    });
    const suggest = new SuggestClass(ctx.app, inputEl, ...suggestArgs).onSelect((s) => {
      inputEl.value = s.item.path;
      ctx.onChange(inputEl.value);
    });
    suggest.suggestEl.addClass("mod-property-value");
    return self;
  }
  inherit(FileValue, Base);
  FileValue.prototype.onFocus = function () { this.inputEl.focus(); };
  FileValue.prototype.setValue = function (value) {
    if (value === null) value = "";
    this.inputEl.value = value;
  };
  return FileValue;
}

function buildS06FileValue(host) {
  return s06FileLikeValue(host, "file", host.FilePathSuggest, []);
}
export function defineS06FileValue(host) {
  return s06PropClass("fileValue", host, buildS06FileValue);
}

function buildS06FolderValue(host) {
  // The folder widget uses the raw folder-path suggest with root folders
  // included and no null-selection row.
  return s06FileLikeValue(host, "folder", env().AI, [false, true]);
}
export function defineS06FolderValue(host) {
  return s06PropClass("folderValue", host, buildS06FolderValue);
}

// ---- dates ---------------------------------------------------------------

function buildS06DateValue(host) {
  const Base = s06PropClass("valueItem", host, () => buildS06ValueItem());
  function DateValue(ctx, containerEl, value) {
    const self = Base.call(this, containerEl) || this;
    self.type = "date";
    self.hoverPopover = null;
    self.dirty = false;
    self.value = value != null ? value : "";
    self.parse(value);
    self.dirty = false;
    const inputEl = self.inputEl = self.buildInput(containerEl);
    inputEl.toggleClass("is-empty", !value);
    inputEl.addEventListener("input", () => {
      inputEl.toggleClass("is-empty", !inputEl.value);
      self.parse(inputEl.value);
      self.dirty = true;
    });
    inputEl.addEventListener("blur", () => {
      if (!self.dirty) return;
      if (inputEl.value === "" || self.date.isValid()) {
        self.value = inputEl.value;
        ctx.onChange(self.format(self.date));
        self.dirty = false;
      }
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        ctx.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        self.setValue(self.value);
        ctx.blur();
      }
    });
    return self;
  }
  inherit(DateValue, Base);
  DateValue.prototype.onFocus = function () { this.inputEl.focus(); };
  DateValue.prototype.setValue = function (value) {
    this.dirty = false;
    this.inputEl.value = this.value = value;
    this.inputEl.toggleClass("is-empty", !value);
    this.parse(value);
  };
  // buildInput/parse/format are intentionally absent: the base is abstract and
  // only the daily-note and datetime subclasses provide them.
  return DateValue;
}
export function defineS06DateValue(host) {
  return s06PropClass("dateValue", host, buildS06DateValue);
}

function buildS06DailyNoteDateValue(host) {
  const Base = s06PropClass("dateValue", host, buildS06DateValue);
  function DailyNoteDateValue(ctx, containerEl, value) {
    const self = Base.call(this, ctx, containerEl, value) || this;
    self.type = "date";
    self.buttonEl = null;
    const app = ctx.app;
    const dailyNotes = app.internalPlugins.getEnabledPluginById("daily-notes");
    if (dailyNotes) {
      self.buttonEl = containerEl.createDiv("clickable-icon", (el) => {
        host.setIcon(el, "lucide-link");
        setElementTooltip(el, gm().plugins.properties.actionOpenDailyNote());
        el.onClickEvent(async (e) => {
          const note = await dailyNotes.getDailyNote(self.date);
          app.workspace.getLeaf(keymap().isModEvent(e)).openFile(note);
        });
        el.toggle(!!self.value);
      });
    }
    return self;
  }
  inherit(DailyNoteDateValue, Base);
  DailyNoteDateValue.prototype.buildInput = function (containerEl) {
    return containerEl.createEl("input", {
      cls: "metadata-input metadata-input-text mod-date", type: "date",
      placeholder: gm().properties.labelNoValue(), value: this.format(this.date),
      attr: { max: "9999-12-31" },
    });
  };
  DailyNoteDateValue.prototype.parse = function (value) {
    const date = this.date = window.moment(value, s06DateFormats);
    const buttonEl = this.buttonEl;
    if (buttonEl) buttonEl.toggle(date.isValid());
  };
  DailyNoteDateValue.prototype.format = function (date) {
    return date.isValid() ? date.format("YYYY-MM-DD") : "";
  };
  return DailyNoteDateValue;
}
export function defineS06DailyNoteDateValue(host) {
  return s06PropClass("dailyNoteDateValue", host, buildS06DailyNoteDateValue);
}

function buildS06DateTimeValue(host) {
  const Base = s06PropClass("dateValue", host, buildS06DateValue);
  function DateTimeValue(ctx, containerEl, value) {
    const self = Base.call(this, ctx, containerEl, value) || this;
    self.type = "datetime";
    return self;
  }
  inherit(DateTimeValue, Base);
  DateTimeValue.prototype.buildInput = function (containerEl) {
    return containerEl.createEl("input", {
      cls: "metadata-input metadata-input-text mod-datetime", type: "datetime-local",
      placeholder: gm().properties.labelNoValue(), value: this.format(this.date),
      attr: { max: "9999-12-31T23:59" },
    });
  };
  DateTimeValue.prototype.parse = function (value) {
    this.date = window.moment(value, s06DateTimeFormats);
  };
  DateTimeValue.prototype.format = function (date) {
    return date.isValid() ? date.format("YYYY-MM-DD[T]HH:mm:ss") : "";
  };
  return DateTimeValue;
}
export function defineS06DateTimeValue(host) {
  return s06PropClass("dateTimeValue", host, buildS06DateTimeValue);
}

// ---- number --------------------------------------------------------------

function buildS06NumberValue(host) {
  const Base = s06PropClass("valueItem", host, () => buildS06ValueItem());
  function NumberValue(ctx, containerEl, value) {
    const self = Base.call(this, containerEl) || this;
    self.type = "number";
    const inputEl = self.inputEl = containerEl.createEl("input", {
      cls: "metadata-input metadata-input-number", type: "number",
      placeholder: gm().properties.labelNoValue(),
      value: Number.isNaN(value) ? "" : "" + value,
      attr: { inputmode: "decimal", step: "any" },
    });
    const commit = (raw) => {
      value = null;
      if (raw) {
        value = +inputEl.value;
        if (Number.isNaN(value)) { self.showError(); return; }
      }
      ctx.onChange(value);
    };
    inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (inputEl.validity.valid) { commit(inputEl.value); ctx.blur(); }
        else self.showError();
      } else if (e.key === "Escape") {
        e.preventDefault();
        inputEl.value = value != null ? String(value) : "";
        ctx.blur();
      }
    });
    inputEl.addEventListener("blur", (e) => {
      if (e.defaultPrevented) return;
      if (inputEl.validity.valid) commit(inputEl.value);
      else inputEl.value = value != null ? String(value) : "";
    });
    return self;
  }
  inherit(NumberValue, Base);
  NumberValue.prototype.showError = function () {
    displayTooltip(this.inputEl, gm().properties.msgInvalidNumber(), { classes: ["mod-error"] });
  };
  NumberValue.prototype.onFocus = function () { this.inputEl.focus(); };
  NumberValue.prototype.setValue = function (value) {
    this.inputEl.value = value === null ? "" : String(value);
  };
  return NumberValue;
}
export function defineS06NumberValue(host) {
  return s06PropClass("numberValue", host, buildS06NumberValue);
}

// ---- text ----------------------------------------------------------------

function buildS06TextValue(host) {
  const Base = s06PropClass("valueItem", host, () => buildS06ValueItem());
  function TextValue(ctx, containerEl) {
    const self = Base.call(this, containerEl) || this;
    self.type = "text";
    self.hoverPopover = null;
    self.value = "";
    self.ctx = ctx;
    self.containerEl = containerEl;
    const spellcheck = String(ctx.app.vault.getConfig("spellcheck"));
    const inputEl = self.inputEl = containerEl.createDiv({
      cls: "metadata-input-longtext", type: "text",
      attr: { placeholder: gm().properties.labelNoValue(), contentEditable: true, spellcheck, tabIndex: 0 },
    });
    const commit = (text) => { self.setValue(text); self.ctx.onChange(text); };
    inputEl.addEventListener("drop", (e) => {
      const draggable = ctx.app.dragManager.draggable;
      if (!draggable) return;
      const links = s06DropLinkTexts(ctx.app, draggable, ctx.sourcePath, undefined, host);
      if (links.length > 0) {
        e.preventDefault();
        commit(links[0]);
      }
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        if (e.shiftKey) return;
        if (e.defaultPrevented) return;
        e.preventDefault();
        commit(inputEl.textContent);
        self.ctx.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        self.setValue(self.value);
        self.ctx.blur();
      }
    });
    inputEl.addEventListener("input", (e) => { if (!e.isComposing) env().mg(inputEl, true); });
    inputEl.addEventListener("paste", (e) => env().vg(inputEl, e));
    inputEl.addEventListener("blur", (e) => {
      if (e.defaultPrevented) return;
      commit(inputEl.textContent.trimEnd());
    });
    return self;
  }
  inherit(TextValue, Base);
  TextValue.prototype.render = function () {
    const self = this, ctx = this.ctx, value = this.value, inputEl = this.inputEl;
    const linkInner = createDiv("metadata-link-inner");
    if (env().oO(value, linkInner, ctx, this)) {
      const linkEl = createDiv("metadata-link");
      linkEl.appendChild(linkInner);
      linkEl.createDiv("metadata-link-flair", (el) => host.setIcon(el, "lucide-pencil"));
      linkEl.addEventListener("click", (e) => {
        if (e.defaultPrevented) return;
        self.onFocus();
      });
      this.containerEl.setChildrenInPlace([linkEl]);
    } else {
      this.containerEl.setChildrenInPlace([inputEl]);
    }
  };
  TextValue.prototype.setValue = function (value) {
    if (!value) value = "";
    this.value = String(value);
    this.inputEl.textContent = value;
    this.render();
  };
  TextValue.prototype.onFocus = function (position) {
    if (position === undefined) position = "both";
    const inputEl = this.inputEl;
    this.containerEl.setChildrenInPlace([inputEl]);
    if (platform().isPhone) inputEl.focus();
    else env().Av(inputEl, (pos) => position === "start" || (position !== "end" && undefined));
  };
  return TextValue;
}
export function defineS06TextValue(host) {
  return s06PropClass("textValue", host, buildS06TextValue);
}

// ---- multi-select --------------------------------------------------------

function buildS06MultiSelect(host) {
  function MultiSelect(rootEl) {
    this.elements = [];
    this.values = [];
    const container = this.rootEl = rootEl.createDiv({ cls: "multi-select-container", attr: { tabIndex: -1 } });
    const addText = (text) => {
      if (this.addElement(text)) {
        this.inputEl.innerText = "";
        this.inputEl.trigger("input");
      }
    };
    const inputEl = this.inputEl = this._createInputEl();
    inputEl.addEventListener("blur", () => { if (inputEl.getText()) addText(inputEl.getText()); });
    inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter" && inputEl.getText().length > 0) {
        e.preventDefault();
        addText(inputEl.getText());
      } else if (e.key === "Backspace" && this.inputText.length === 0 && this.elements.length > 0) {
        e.preventDefault();
        const last = this.elements[this.elements.length - 1];
        if (last) last.focus();
      } else if (e.key === "ArrowLeft") {
        const selection = inputEl.win.getSelection();
        if (inputEl.getText().length === 0 && selection.rangeCount > 0 && selection.getRangeAt(0).startOffset === 0) {
          e.preventDefault();
          this.focusElement(this.elements.length - 1);
        }
      }
    });
    inputEl.addEventListener("blur", () => addText(inputEl.getText()));
    container.addEventListener("click", (e) => { if (e.targetNode === container) inputEl.focus(); });
    this.renderValues();
  }
  Object.defineProperty(MultiSelect.prototype, "inputText", {
    get() { return this.inputEl.getText(); }, enumerable: false, configurable: true,
  });
  MultiSelect.prototype.setInputText = function (text) {
    this.inputEl.innerText = text;
    this.inputEl.trigger("input");
  };
  MultiSelect.prototype._createInputEl = function () {
    const el = createDiv({ cls: "multi-select-input", attr: { contentEditable: true, tabIndex: 0 } });
    el.addEventListener("input", (e) => env().mg(el, false));
    el.addEventListener("paste", (e) => env().vg(el, e));
    return el;
  };
  MultiSelect.prototype.setValues = function (values) {
    let changed = false;
    if (Array.isArray(values)) { changed = true; this.values = values; }
    else { changed = this.values.length > 0; this.values = []; }
    if (changed) { this.renderValues(); this.triggerChange(); }
    return this;
  };
  MultiSelect.prototype.onChange = function (cb) { this.changeCallback = cb; return this; };
  MultiSelect.prototype.setOptionRenderer = function (fn) {
    this.optionRenderer = fn;
    if (this.values.length > 0) this.renderValues();
    return this;
  };
  MultiSelect.prototype.allowCreatingOptions = function (fn) { this.createOption = fn; return this; };
  MultiSelect.prototype.preventDuplicates = function (fn) { this.findDuplicate = fn; return this; };
  MultiSelect.prototype.setupInputEl = function (fn) { this.setupInput = fn; return this; };
  MultiSelect.prototype._createElement = function (value) {
    const create = this.createOption;
    const el = create ? create.call(this, value) : undefined;
    return el || null;
  };
  MultiSelect.prototype.addElement = function (value) {
    const el = this._createElement(value);
    if (el) {
      const dup = this.findDuplicate ? this.findDuplicate.call(this, el, this.values) : undefined;
      if (dup !== undefined && dup >= 0 && dup < this.elements.length) {
        const dupEl = this.elements[dup];
        if (!dupEl.hasClass("multi-select-duplicate")) {
          dupEl.addClass("multi-select-duplicate");
          dupEl.win.setTimeout(() => dupEl.removeClass("multi-select-duplicate"), 2000);
        }
        return false;
      }
      this.values.push(el);
      this.renderValues();
      this.triggerChange();
    }
    return !!el;
  };
  MultiSelect.prototype.editElement = function (index) {
    const self = this;
    if (index < 0 || index >= this.values.length) return;
    const oldEl = this.elements[index];
    const inputEl = this._createInputEl();
    let editing = false;
    const commit = (text, refocus) => {
      if (refocus === undefined) refocus = false;
      const el = self._createElement(text);
      if (el) {
        const dup = self.findDuplicate ? self.findDuplicate.call(self, el, self.values) : undefined;
        if (dup !== undefined && dup >= 0 && dup < self.elements.length && dup !== index) {
          const dupEl = self.elements[dup];
          if (!dupEl.hasClass("multi-select-duplicate")) {
            dupEl.addClass("multi-select-duplicate");
            dupEl.win.setTimeout(() => dupEl.removeClass("multi-select-duplicate"), 2000);
          }
          return false;
        }
        editing = false;
        self.values[index] = el;
        self.renderValues();
        if (refocus) self.focusElement(index);
        self.triggerChange();
        return true;
      }
      return false;
    };
    if (this.setupInput) this.setupInput.call(this, inputEl, commit);
    inputEl.addEventListener("focus", () => { editing = true; });
    inputEl.addEventListener("blur", () => {
      if (!editing) return;
      editing = false;
      const text = inputEl.getText();
      if (text) commit(text);
      else {
        self.rootEl.insertBefore(oldEl, inputEl);
        inputEl.detach();
      }
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter" && inputEl.getText().length > 0) {
        e.preventDefault();
        commit(inputEl.getText(), true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        editing = false;
        self.rootEl.insertBefore(oldEl, inputEl);
        inputEl.detach();
        oldEl.focus();
      }
    });
    inputEl.innerText = String(this.values[index]);
    this.rootEl.insertBefore(inputEl, oldEl);
    oldEl.detach();
    env().Av(inputEl);
  };
  MultiSelect.prototype.removeElement = function (index, refocus) {
    if (refocus === undefined) refocus = false;
    if (index < 0 || index >= this.values.length) return;
    this.values = this.values.filter((_, i) => i !== index);
    this.renderValues();
    if (refocus) this.focusElement(index - 1);
    this.triggerChange();
  };
  MultiSelect.prototype.focusElement = function (index) {
    const clamped = Math.max(0, index);
    const el = this.elements[clamped];
    if (el) el.focus();
    else this.inputEl.focus();
  };
  MultiSelect.prototype.renderValues = function () {
    const self = this;
    this.elements = [];
    for (let i = 0; i < this.values.length; i++) {
      const value = this.values[i];
      const index = i;
      const pill = this.rootEl.createDiv({ cls: "multi-select-pill", attr: { tabIndex: 0 } });
      const content = pill.createDiv({ cls: "multi-select-pill-content" });
      const removeBtn = pill.createDiv({ cls: "multi-select-pill-remove-button" });
      host.setIcon(removeBtn, "lucide-x");
      pill.addEventListener("copy", (e) => copyTextToClipboard(String(value)));
      pill.addEventListener("contextmenu", (e) => {
        const m = menu().forEvent(e);
        m.addSections(["title", "open", "action-primary", "action", "info", "view", "system", "", "danger"]);
        m.addItem((item) => item.setSection("action-primary").setTitle(gm().interface.menu.edit()).setIcon("lucide-edit-3").onClick(() => self.editElement(index)));
        m.addItem((item) => item.setSection("action-primary").setTitle(gm().interface.menu.copy()).setIcon("lucide-copy").onClick(() => navigator.clipboard.writeText(String(value))));
        m.addItem((item) => item.setWarning(true).setSection("action-primary").setIcon("lucide-trash-2").setTitle(gm().interface.menu.removeFromList()).onClick(() => self.removeElement(index)));
      });
      pill.addEventListener("dblclick", (e) => { e.preventDefault(); self.editElement(index); });
      pill.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); self.editElement(index); }
        else if (e.key === "Escape") { e.preventDefault(); self.inputEl.focus(); }
        else if (e.key === "Backspace") { e.preventDefault(); self.removeElement(index, true); }
        else if (e.key === "ArrowUp") { e.preventDefault(); self.focusElement(0); }
        else if (e.key === "ArrowDown") { e.preventDefault(); self.inputEl.focus(); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); self.focusElement(index - 1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); self.focusElement(index + 1); }
      });
      if (this.optionRenderer) this.optionRenderer(value, { el: content, pillEl: pill });
      else content.createSpan({ text: String(value) });
      if (this.findDuplicate) {
        const dup = this.findDuplicate(value, this.values.slice(0, i));
        if (dup !== undefined && dup >= 0 && dup < i) pill.addClass("is-invalid");
      }
      this.elements.push(pill);
      removeBtn.addEventListener("mousedown", (e) => e.preventDefault());
      removeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        self.removeElement(index);
        self.inputEl.trigger("input");
      });
    }
    this.rootEl.setChildrenInPlace([...this.elements, this.inputEl]);
    this.inputEl.setAttr("placeholder", this.elements.length > 0 ? "" : gm().properties.labelNoValue());
  };
  MultiSelect.prototype.triggerChange = function () {
    if (this.changeCallback) this.changeCallback(this.values);
  };
  return MultiSelect;
}
export function defineS06MultiSelect(host) {
  return s06PropClass("multiSelect", host, buildS06MultiSelect);
}

// ---- combobox ------------------------------------------------------------

function buildS06Combobox(host) {
  const Base = host.PopoverSuggest;
  function Combobox(app, containerEl) {
    const self = Base.call(this, app) || this;
    self.clearable = false;
    self._items = [];
    self.value = null;
    self.app = app;
    self.suggestEl.addClass("combobox");
    const bgEl = self.bgEl = createDiv("suggestion-bg");
    bgEl.style.opacity = "0";
    const buttonEl = self.buttonEl = containerEl.createDiv({ cls: "combobox-button", attr: { tabindex: 0 } });
    const iconEl = self.iconEl = buttonEl.createDiv("combobox-button-icon");
    iconEl.hide();
    self.labelEl = buttonEl.createDiv("combobox-button-label");
    buttonEl.createDiv("combobox-clear-button", (el) => {
      host.setIcon(el, "lucide-x");
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", (e) => {
        e.preventDefault();
        self.buttonEl.blur();
        self.selectSuggestion(null, e);
      });
    });
    buttonEl.createDiv("combobox-button-chevron", (el) => host.setIcon(el, "lucide-chevrons-up-down"));
    buttonEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key.startsWith("Arrow") || e.key.length === 1) self.open();
    });
    buttonEl.addEventListener("click", (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      self.toggle();
    });
    self.searchComponent = new host.SearchComponent(self.suggestEl)
      .setPlaceholder(gm().plugins.search.promptStartSearch())
      .onChange((value) => self.onInputChange(value));
    self.suggestEl.prepend(self.searchComponent.containerEl);
    self.suggestEl.on("mousedown", ".suggestion", (e) => e.preventDefault());
    const inputEl = self.searchComponent.inputEl;
    inputEl.addEventListener("focus", () => self.suggestEl.addClass("has-input-focus"));
    inputEl.addEventListener("blur", () => self.suggestEl.removeClass("has-input-focus"));
    inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Tab") env().ng(self.buttonEl, { preventScroll: true });
    });
    self.suggestEl.addEventListener("focusout", (e) => {
      inputEl.win.setTimeout(() => { if (!buttonEl.isActiveElement()) self.close(); }, 0);
    });
    if (platform().isPhone) {
      self.suggestEl.createDiv({ cls: "menu-grabber", prepend: true });
      self.suggestEl.addClass("menu");
      self.suggestInnerEl.addClass("menu-scroll");
      bgEl.addEventListener("mousedown", (e) => e.preventDefault());
      bgEl.onClickEvent(() => self.close());
      env()._g(self.suggestEl, self.suggestInnerEl, bgEl, () => {
        self.suggestEl.detach();
        self.close();
      });
    }
    return self;
  }
  inherit(Combobox, Base);
  Combobox.prototype.setPlaceholder = function (placeholder) {
    this.labelEl.setAttribute("placeholder", placeholder);
    return this;
  };
  Combobox.prototype.setItems = function (items) { this._items = items; return this; };
  Combobox.prototype.getItems = function () { return this._items; };
  Combobox.prototype.setClearable = function (clearable) {
    this.clearable = clearable;
    if (this.value != null) this.renderLabel();
    return this;
  };
  Combobox.prototype.renderLabel = function () {
    const value = this.value;
    let label = "";
    if (value) label = value.display != null ? value.display : value.value;
    this.labelEl.setText(label);
    if (value && value.icon != null) host.setIcon(this.iconEl, value.icon);
    else this.iconEl.empty();
    this.buttonEl.toggleClass("mod-clearable", this.clearable && value != null);
    this.iconEl.toggle(!!(value && value.icon));
  };
  Combobox.prototype.setValue = function (value) {
    this.value = value;
    this.renderLabel();
    return this;
  };
  Combobox.prototype.setValueById = function (id) {
    const item = this.getItems().find((i) => i.value === id);
    if (item) this.setValue(item);
    return this;
  };
  Combobox.prototype.toggle = function () {
    if (this.isOpen) {
      env().ng(this.buttonEl, { preventScroll: true });
      this.close();
    } else {
      this.open();
    }
  };
  Combobox.prototype.close = function () {
    if (!this.isOpen) return;
    Base.prototype.close.call(this);
    this.isOpen = false;
    this.buttonEl.removeClass("has-focus");
    this.searchComponent.inputEl.value = "";
    if (this._onClose) this._onClose.call(this);
  };
  Combobox.prototype.attachDom = function () {
    const bgEl = this.bgEl, suggestEl = this.suggestEl;
    env().activeDocument.body.appendChild(suggestEl);
    if (platform().isPhone) {
      env().activeDocument.body.appendChild(bgEl);
      env().Pl(suggestEl, bgEl);
    } else {
      Base.prototype.attachDom.call(this);
    }
    suggestEl.style.left = "";
    suggestEl.style.top = "";
  };
  Combobox.prototype.detachDom = async function () {
    const bgEl = this.bgEl, suggestEl = this.suggestEl;
    if (platform().isPhone) {
      if (bgEl.isShown()) await env().Ll(suggestEl, bgEl);
    } else {
      Base.prototype.detachDom.call(this);
    }
    suggestEl.detach();
    bgEl.detach();
  };
  Combobox.prototype.open = function () {
    if (this.isOpen) return;
    Base.prototype.open.call(this);
    this.buttonEl.addClass("has-focus");
    if (platform().isPhone) {
      this.suggestions.setSuggestions(this.getSuggestions(""));
    } else {
      const rect = this.buttonEl.getBoundingClientRect();
      this.suggestions.setSuggestions(this.getSuggestions(""));
      this.reposition(rect);
      this.searchComponent.autoSelect();
    }
    this.setAutoDestroy(this.buttonEl);
    if (this._onOpen) this._onOpen.call(this);
  };
  Combobox.prototype.onOpen = function (cb) { this._onOpen = cb; return this; };
  Combobox.prototype.onClose = function (cb) { this._onClose = cb; return this; };
  Combobox.prototype.onEscapeKey = function () {
    env().ng(this.buttonEl, { preventScroll: true });
    this.close();
  };
  Combobox.prototype.selectSuggestion = function (value, evt) {
    this.setValue(value);
    env().ng(this.buttonEl, { preventScroll: true });
    if (this.selectCb) this.selectCb.call(this, value);
    this.close();
  };
  Combobox.prototype.renderSuggestion = function (item, el) {
    el.addClasses(["mod-complex", "mod-toggle"]);
    if (this.value && this.value.value === item.value) {
      host.setIcon(el.createDiv("suggestion-icon mod-checked"), "lucide-check");
    }
    if (item.icon) {
      host.setIcon(el.createDiv("suggestion-icon").createDiv("suggestion-flair"), item.icon);
    }
    const title = el.createSpan("suggestion-content").createDiv("suggestion-title");
    const display = item.display != null ? item.display : item.value;
    renderResults(title, display, item);
  };
  Combobox.prototype.onInputChange = function (value) {
    this.suggestions.setSuggestions(this.getSuggestions(value));
  };
  Combobox.prototype.getSuggestions = function (query) {
    const prepared = prepareQuery(query);
    const results = [];
    const items = this.getItems();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let match = fuzzyMatchJs(prepared, item.value);
      if (match) {
        results.push({ ...item, matches: match.matches, score: match.score });
      } else if (item.display) {
        match = fuzzyMatchJs(prepared, item.display);
        if (match) results.push({ ...item, matches: match.matches, score: match.score - 10 });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  };
  Combobox.prototype.onSelect = function (cb) { this.selectCb = cb; return this; };
  Combobox.prototype.focus = function () {
    env().ng(this.buttonEl, { preventScroll: true });
    this.open();
  };
  return Combobox;
}
export function defineS06Combobox(host) {
  return s06PropClass("combobox", host, buildS06Combobox);
}

// ---- suggest popups ------------------------------------------------------

function buildS06FilteredFileSuggest(host) {
  const Base = host.FilePathSuggest;
  function FilteredFileSuggest(app, inputEl, predicate) {
    const self = Base.call(this, app, inputEl) || this;
    self.predicate = predicate;
    return self;
  }
  inherit(FilteredFileSuggest, Base);
  FilteredFileSuggest.prototype.filePredicate = function (file) {
    return !this.predicate || this.predicate(file);
  };
  return FilteredFileSuggest;
}
export function defineS06FilteredFileSuggest(host) {
  return s06PropClass("filteredFileSuggest", host, buildS06FilteredFileSuggest);
}

function buildS06FolderSuggest(host) {
  const Base = env().AI;
  function FolderSuggest(app, inputEl, folderPredicate, allowRoot) {
    if (allowRoot === undefined) allowRoot = false;
    const self = Base.call(this, app, inputEl, allowRoot) || this;
    self.folderPredicate = folderPredicate;
    return self;
  }
  inherit(FolderSuggest, Base);
  FolderSuggest.prototype.filePredicate = function (file) {
    return !this.folderPredicate || this.folderPredicate(file);
  };
  return FolderSuggest;
}
export function defineS06FolderSuggest(host) {
  return s06PropClass("folderSuggest", host, buildS06FolderSuggest);
}

function buildS06MarkdownFileSuggest(host) {
  const Base = host.FilePathSuggest;
  function MarkdownFileSuggest() {
    return Base.apply(this, arguments) || this;
  }
  inherit(MarkdownFileSuggest, Base);
  MarkdownFileSuggest.prototype.filePredicate = function (file) {
    return file.extension === "md";
  };
  return MarkdownFileSuggest;
}
export function defineS06MarkdownFileSuggest(host) {
  return s06PropClass("markdownFileSuggest", host, buildS06MarkdownFileSuggest);
}

function buildS06TagValueSuggest(host) {
  const Base = host.AbstractInputSuggest;
  function TagValueSuggest(app, inputEl, suggestionFilter) {
    const self = Base.call(this, app, inputEl) || this;
    self.suggestionFilter = suggestionFilter;
    self.suggestEl.addClass("mod-property-value");
    self.scope.register([], "Tab", (evt) => {
      if (evt.isComposing) return false;
      const suggestions = self.suggestions;
      const item = suggestions.values[suggestions.selectedItem];
      if (item) {
        const rendered = env().By(item.tag, item.matches);
        inputEl.setText(rendered);
        env().fg(inputEl, { from: rendered.length });
        inputEl.trigger("input");
      }
      return false;
    });
    return self;
  }
  inherit(TagValueSuggest, Base);
  TagValueSuggest.prototype.getSuggestions = function (query) {
    return s06TagSuggestions(this.app.metadataCache, query, query.startsWith("#"), host)
      .filter(this.suggestionFilter);
  };
  TagValueSuggest.prototype.showSuggestions = function (query) {
    Base.prototype.showSuggestions.call(this, query);
    if (!this.getValue()) this.suggestions.forceSetSelectedItem(-1, null);
  };
  TagValueSuggest.prototype.renderSuggestion = function (value, el) {
    renderMatches(el, value.tag, value.matches);
  };
  return TagValueSuggest;
}
export function defineS06TagValueSuggest(host) {
  return s06PropClass("tagValueSuggest", host, buildS06TagValueSuggest);
}

// ---- remaining value widgets ---------------------------------------------

function buildS06AliasesValue(host) {
  const Base = s06PropClass("valueItem", host, () => buildS06ValueItem());
  function AliasesValue(ctx, containerEl, value) {
    const self = Base.call(this, containerEl) || this;
    self.type = "aliases";
    self.hoverPopover = null;
    value = toStringList(value);
    self.ctx = ctx;
    self.containerEl = containerEl;
    const MultiSelect = s06PropClass("multiSelect", host, buildS06MultiSelect);
    const multiselect = self.multiselect = new MultiSelect(containerEl)
      .setOptionRenderer((val, { el, pillEl }) => {
        el.setText(val);
        if (val.trim().length === 0) pillEl.addClass("is-invalid");
      })
      .preventDuplicates((val, values) => values.indexOf(val))
      .allowCreatingOptions((val) => val.trim())
      .setValues(value)
      .onChange((vals) => ctx.onChange(vals.slice()));
    multiselect.inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Escape") { e.preventDefault(); ctx.blur(); }
    });
    return self;
  }
  inherit(AliasesValue, Base);
  AliasesValue.prototype.onFocus = function () {
    if (platform().isPhone) this.multiselect.inputEl.focus();
    else env().Av(this.multiselect.inputEl);
  };
  AliasesValue.prototype.setValue = function (value) {
    this.multiselect.setValues(toStringList(value));
  };
  return AliasesValue;
}
export function defineS06AliasesValue(host) {
  return s06PropClass("aliasesValue", host, buildS06AliasesValue);
}

function buildS06TagsValue(host) {
  const Base = s06PropClass("valueItem", host, () => buildS06ValueItem());
  function TagsValue(ctx, containerEl, value) {
    const self = Base.call(this, containerEl) || this;
    self.type = "tags";
    if (value == null) value = [];
    let valueSet = new Set(value);
    const MultiSelect = s06PropClass("multiSelect", host, buildS06MultiSelect);
    const multiselect = self.multiselect = new MultiSelect(containerEl)
      .setOptionRenderer((val, { el, pillEl }) => {
        if (val.startsWith("#")) val = val.slice(1);
        el.createEl("span", { text: val });
        if (!tagValid("#" + val)) {
          pillEl.addClass("is-invalid");
          setElementTooltip(pillEl, gm().properties.msgInvalidTag());
        }
        env().dg(el, () => {
          const plugin = ctx.app.internalPlugins.getEnabledPluginById("global-search");
          if (plugin) plugin.openGlobalSearch("tag:" + val);
        });
      })
      .preventDuplicates((val, values) => {
        const strip = (v) => (v.startsWith("#") ? v.slice(1) : v);
        return values.map(strip).indexOf(strip(val));
      })
      .allowCreatingOptions((val) => {
        let text = val;
        if (!text.trim()) return null;
        if (!text.startsWith("#")) text = "#" + text;
        if (tagValid(text)) { hideTooltip(); return val; }
        displayTooltip(multiselect.inputEl, gm().properties.msgInvalidTag(), { classes: ["mod-error"] });
        return null;
      })
      .setValues(value)
      .onChange((vals) => { ctx.onChange(vals.slice()); valueSet = new Set(vals); });
    multiselect.inputEl.autocapitalize = "none";
    const TagSuggest = s06PropClass("tagValueSuggest", host, buildS06TagValueSuggest);
    new TagSuggest(ctx.app, multiselect.inputEl, (item) => !valueSet.has(item.tag))
      .onSelect((item) => { multiselect.addElement(item.tag); multiselect.setInputText(""); });
    multiselect.inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Escape") { e.preventDefault(); ctx.blur(); }
    });
    return self;
  }
  inherit(TagsValue, Base);
  TagsValue.prototype.onFocus = function () {
    if (platform().isPhone) this.multiselect.inputEl.focus();
    else env().Av(this.multiselect.inputEl);
  };
  TagsValue.prototype.setValue = function (value) {
    this.multiselect.setValues(toStringList(value));
  };
  return TagsValue;
}
export function defineS06TagsValue(host) {
  return s06PropClass("tagsValue", host, buildS06TagsValue);
}

function buildS06MultiTextValue(host) {
  const Base = s06PropClass("valueItem", host, () => buildS06ValueItem());
  function MultiTextValue(ctx, containerEl, value) {
    const self = Base.call(this, containerEl) || this;
    self.type = "multitext";
    self.hoverPopover = null;
    value = toStringList(value);
    self.valueSet = new Set(value);
    const app = ctx.app, onChange = ctx.onChange, sourcePath = ctx.sourcePath;
    const setupInput = (inputEl, commit) => {
      new (env().DO)(ctx, inputEl, (text, immediate) => commit(text, true),
        (item) => item.type !== "text" || !self.valueSet.has(item.text));
    };
    const MultiSelect = s06PropClass("multiSelect", host, buildS06MultiSelect);
    const multiselect = self.multiselect = new MultiSelect(containerEl)
      .setOptionRenderer((val, { el }) => {
        if (!env().oO(val, el, ctx, self)) el.setText(val);
      })
      .setValues(value)
      .allowCreatingOptions((val) => val)
      .setupInputEl(setupInput)
      .onChange((vals) => { self.valueSet = new Set(vals); onChange(vals.slice()); });
    app.dragManager.handleDrop(multiselect.rootEl, (evt, target, isPhantom) => {
      if (!target) return;
      if (isPhantom) return;
      const links = s06DropLinkTexts(app, target, sourcePath, undefined, host);
      if (links.length > 0) {
        evt.preventDefault();
        for (const link of links) multiselect.addElement(link);
      }
      return { hoverClass: "is-being-dragged-over", hoverEl: containerEl, dropEffect: "copy" };
    });
    multiselect.inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Escape") { e.preventDefault(); ctx.blur(); }
    });
    setupInput(multiselect.inputEl, (text) => {
      multiselect.addElement(text);
      multiselect.setInputText("");
    });
    return self;
  }
  inherit(MultiTextValue, Base);
  MultiTextValue.prototype.onFocus = function () {
    if (platform().isPhone) this.multiselect.inputEl.focus();
    else env().Av(this.multiselect.inputEl);
  };
  MultiTextValue.prototype.setValue = function (value) {
    const list = toStringList(value);
    this.valueSet = new Set(list);
    this.multiselect.setValues(list);
  };
  return MultiTextValue;
}
export function defineS06MultiTextValue(host) {
  return s06PropClass("multiTextValue", host, buildS06MultiTextValue);
}

function buildS06PropertyKeyValue(host) {
  const Base = s06PropClass("valueItem", host, () => buildS06ValueItem());
  function PropertyKeyValue(ctx, containerEl, value) {
    const self = Base.call(this, containerEl) || this;
    self.type = "property";
    const TypeCombobox = s06PropClass("typeCombobox", host, buildS06TypeCombobox);
    self.combobox = new TypeCombobox(ctx.app, containerEl)
      .setPlaceholder(gm().plugins.bases.labelPropertyKey())
      .onSelect((item) => ctx.onChange(item ? item.value : undefined))
      .setValueById(value);
    return self;
  }
  inherit(PropertyKeyValue, Base);
  PropertyKeyValue.prototype.onFocus = function () { this.combobox.focus(); };
  PropertyKeyValue.prototype.setValue = function (value) { this.combobox.setValueById(value); };
  return PropertyKeyValue;
}
export function defineS06PropertyKeyValue(host) {
  return s06PropClass("propertyKeyValue", host, buildS06PropertyKeyValue);
}

function buildS06TypeCombobox(host) {
  const Base = s06PropClass("combobox", host, buildS06Combobox);
  function TypeCombobox() {
    return Base.apply(this, arguments) || this;
  }
  inherit(TypeCombobox, Base);
  TypeCombobox.prototype.getItems = function () {
    const self = this;
    return Object.values(this.app.metadataTypeManager.getAllProperties()).map((prop) => ({
      value: prop.name,
      icon: this.app.metadataTypeManager.getWidget(prop.widget).icon,
    }));
  };
  return TypeCombobox;
}
export function defineS06TypeCombobox(host) {
  return s06PropClass("typeCombobox", host, buildS06TypeCombobox);
}

// ---- change-type dialog ---------------------------------------------------

function buildS06ChangeTypeModal(host) {
  const Base = host.DialogModal;
  function ChangeTypeModal(app, line) {
    const self = Base.call(this, app) || this;
    self.line = line;
    const typeInfo = line.typeInfo;
    const inferred = typeInfo.inferred;
    const expectedType = typeInfo.expected.type;
    const oldType = inferred.type;
    self.setTitle(gm().properties.labelChangePropertyType({ type: expectedType }));
    self.contentEl.createEl("p", { text: gm().properties.labelChangePropertyTypeDesc({ oldType }) });
    self.addButton("mod-cta", gm().dialogue.buttonUpdate(), (evt) => self.onSubmit(evt));
    self.addCancelButton();
    self.scope.register([], "Enter", self.onSubmit.bind(self));
    return self;
  }
  inherit(ChangeTypeModal, Base);
  ChangeTypeModal.prototype.onSubmit = function (evt) {
    evt.preventDefault();
    this.close();
    this.shouldRestoreSelection = false;
    this.line.renderProperty(this.line.entry, true, true);
    this.line.focusValue();
  };
  return ChangeTypeModal;
}
export function defineS06ChangeTypeModal(host) {
  return s06PropClass("changeTypeModal", host, buildS06ChangeTypeModal);
}

// ---- property-type descriptor objects -------------------------------------
// name/icon/validate/render mirror the built-in type registry entries; render
// receives (containerEl, value, ctx) where ctx is the property line context.

export function s06PropertyOptionText(host) {
  return {
    name: gm().properties.types.optionText,
    type: "text",
    icon: "lucide-text",
    validate: (v) => typeof v === "string",
    render: (el, value, ctx) => {
      const widget = new (s06PropClass("textValue", host, buildS06TextValue))(ctx, el);
      widget.setValue(String(value != null ? value : ""));
      new (env().DO)(ctx, widget.inputEl, (text, evt) => {
        evt.preventDefault();
        widget.setValue(text);
        ctx.onChange(text);
        env().Lv();
        ctx.blur();
      });
      return widget;
    },
  };
}
export function s06PropertyOptionPropertyName(host) {
  return {
    name: gm().properties.types.optionPropertyName,
    type: "property",
    icon: "lucide-info",
    reservedKeys: [],
    validate: (v) => typeof v === "string",
    render: (el, value, ctx) => {
      const KeyValue = s06PropClass("propertyKeyValue", host, buildS06PropertyKeyValue);
      return new KeyValue(ctx, el, value);
    },
  };
}
export function s06PropertyOptionAliases(host) {
  return {
    name: gm().properties.types.optionAliases,
    type: "aliases",
    icon: "lucide-forward",
    reservedKeys: ["aliases"],
    validate: (v) => typeof v === "string" || isStringArray(v, true),
    render: (el, value, ctx) => {
      const Aliases = s06PropClass("aliasesValue", host, buildS06AliasesValue);
      return new Aliases(ctx, el, toStringList(value));
    },
  };
}
export function s06PropertyOptionTags(host) {
  return {
    name: gm().properties.types.optionTags,
    type: "tags",
    icon: "lucide-tags",
    reservedKeys: ["tags"],
    validate: (v) => typeof v === "string" || isStringArray(v, true),
    render: (el, value, ctx) => {
      const Tags = s06PropClass("tagsValue", host, buildS06TagsValue);
      return new Tags(ctx, el, toStringList(value));
    },
  };
}
export function s06PropertyOptionFolder(host) {
  return {
    name: gm().properties.types.optionFolder,
    type: "folder",
    icon: "lucide-folder",
    reservedKeys: [],
    validate: (v) => typeof v === "string",
    render: (el, value, ctx) => {
      const Folder = s06PropClass("folderValue", host, buildS06FolderValue);
      return new Folder(ctx, el, value);
    },
  };
}
export function s06PropertyOptionFile(host) {
  return {
    name: gm().properties.types.optionFile,
    type: "file",
    icon: "lucide-file",
    reservedKeys: [],
    validate: (v) => typeof v === "string",
    render: (el, value, ctx) => {
      const File = s06PropClass("fileValue", host, buildS06FileValue);
      return new File(ctx, el, value);
    },
  };
}
export function s06PropertyOptionDate(host) {
  return {
    name: gm().properties.types.optionDate,
    type: "date",
    icon: "lucide-calendar",
    validate: (v) => !v || window.moment(v, s06DateFormats).isValid(),
    render: (el, value, ctx) => {
      const DateValue = s06PropClass("dailyNoteDateValue", host, buildS06DailyNoteDateValue);
      return new DateValue(ctx, el, value);
    },
  };
}
export function s06PropertyOptionDatetime(host) {
  return {
    name: gm().properties.types.optionDatetime,
    type: "datetime",
    icon: "lucide-clock",
    validate: (v) => !v || window.moment(v, s06DateTimeFormats).isValid(),
    render: (el, value, ctx) => {
      const DateTime = s06PropClass("dateTimeValue", host, buildS06DateTimeValue);
      return new DateTime(ctx, el, value);
    },
  };
}
export function s06PropertyOptionNumber(host) {
  return {
    name: gm().properties.types.optionNumber,
    type: "number",
    icon: "lucide-binary",
    validate: (v) => Number.isNumber(v),
    render: (el, value, ctx) => {
      const NumberValue = s06PropClass("numberValue", host, buildS06NumberValue);
      return new NumberValue(ctx, el, value);
    },
  };
}
export function s06PropertyOptionCheckbox(host) {
  return {
    name: gm().properties.types.optionCheckbox,
    type: "checkbox",
    icon: "lucide-check-square",
    validate: (v) => typeof v === "boolean",
    render: (el, value, ctx) => {
      const Checkbox = s06PropClass("checkboxValue", host, buildS06CheckboxValue);
      return new Checkbox(ctx, el, value);
    },
  };
}
export function s06PropertyOptionMultitext(host) {
  return {
    name: gm().properties.types.optionMultitext,
    type: "multitext",
    icon: "lucide-list",
    validate: (v) => typeof v === "string" || isStringArray(v, true),
    render: (el, value, ctx) => {
      const MultiText = s06PropClass("multiTextValue", host, buildS06MultiTextValue);
      return new MultiText(ctx, el, toStringList(value));
    },
  };
}
export function s06PropertyOptionUnknownDescriptor(host) {
  return {
    name: gm().properties.types.optionUnknown,
    type: "unknown",
    icon: "lucide-file-question",
    validate: () => true,
    render: (el, value, ctx) => {
      const Unknown = s06PropClass("unknownValue", host, buildS06UnknownValue);
      return new Unknown(el, value);
    },
  };
}
