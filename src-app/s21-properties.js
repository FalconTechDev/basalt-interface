// Frontmatter property ("metadata") value widgets, their suggest popups and the small helpers around them.
//
// The properties editor (see properties-editor.js) asks the metadata type manager for a widget descriptor
// ({ name, type, icon, reservedKeys, validate, render }) and calls `render(containerEl, value, ctx)`; the
// returned object only needs `focus(position)` (the shared base below) plus whatever the concrete widget
// exposes. The ctx argument is { app, key, onChange, sourcePath, blur, hoverSource }.
//
// Everything here mirrors the shipped behaviour: same DOM classes, same keyboard handling, same suggest
// wiring. Inherited helpers (i18n, tooltips, drag-and-drop, link suggestions, the combobox and suggest
// base classes) are reached through the host object or the lazy env binding, never copied.

import { inherit, methods } from "./inherit.js";
import { hostEnv } from "./env.js";
import { lastSegment, isLocalLink, linkPath } from "./path.js";
import { isStringArray, shiftRanges } from "./misc.js";
import { toStringList } from "./text.js";
import { tagValid } from "./metadata-helpers.js";
import { prepareQuery, fuzzyMatchJs, matchScore } from "./search.js";
import { renderMatches, renderResults, containsAllWords } from "./search-simple.js";
import { s04StringCompare } from "./s04-themes.js";
import { ng08BlockRefInsertion } from "./n-g08-bookmarks.js";
import { hideTooltip, displayTooltip, setElementTooltip } from "./tooltip.js";
import { copyTextToClipboard } from "./n-g11-view.js";

const s21Env = () => hostEnv();
const s21Cache = new WeakMap();

/** Renders a property value that is a link (internal [[...]] or external URL) into `el`; returns true when it was a link. */
export function s21RenderLinkValue(value, el, ctx, hoverParent) {
  const app = ctx.app;
  const sourcePath = ctx.sourcePath;
  let internal = false;
  let external = false;
  let href = "";
  let title = "";
  if (value.startsWith("[[") && value.endsWith("]]")) {
    internal = true;
    const parsed = s21Env().iE(value.slice(2, -2));
    href = parsed.href;
    title = parsed.title;
  } else if (value.startsWith("[") && value.endsWith(")")) {
    const match = value.match(s21Env().pT);
    if (match) {
      title = match[2];
      href = match[5];
      if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1).trim();
      if (isLocalLink(href)) {
        internal = true;
        try { href = decodeURI(href); } catch (e) { /* keep the raw href */ }
      } else external = true;
    }
  } else if (s21Env().Qc(value)) {
    external = true;
    href = value;
    title = value;
  } else if (s21Env().Zc(value)) {
    external = true;
    href = "mailto:" + value;
    title = value;
  }
  if (!internal && !external) return false;
  el.setText(title);
  el.setAttr("data-href", href);
  el.toggleClass("internal-link", internal);
  el.toggleClass("external-link", external);
  if (internal) el.toggleClass("is-unresolved", app.metadataCache.isUnresolved(linkPath(href), sourcePath));
  el.onClickEvent((event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    if (internal) app.workspace.openLinkText(href, sourcePath, s21Env().Bg.isModEvent(event));
    else if (external) window.open(href, "_blank");
  });
  el.addEventListener("open-link", (event) => {
    event.preventDefault();
    if (internal) app.workspace.openLinkText(href, sourcePath, event.detail.paneType);
    else if (external) window.open(href, "_blank");
  });
  el.addEventListener("contextmenu", (event) => {
    const menu = s21Env().Ug.forEvent(event).addSections(["title", "open", "action", "view", "info", "info.copy", "", "danger"]);
    if (internal) {
      app.workspace.handleLinkContextMenu(menu, href, sourcePath);
    } else {
      if (!external) return;
      app.workspace.handleExternalLinkContextMenu(menu, href);
    }
  });
  if (internal) {
    app.dragManager.handleDrag(el, (dragEvent) => app.dragManager.dragLink(dragEvent, href, sourcePath));
    el.addEventListener("mouseover", (event) => {
      app.workspace.trigger("hover-link", {
        event,
        source: ctx.hoverSource,
        hoverParent,
        targetEl: el,
        linktext: href,
      });
    });
  }
  return true;
}

/** All classes and widget descriptors built once per host (the __basaltHost object). */
function s21Build(host) {
  let built = s21Cache.get(host);
  if (built) return built;

  // ===============================================================================================================
  // Value widgets (the render() targets of the type descriptors below)
  // ===============================================================================================================

  /** Base class every property value widget derives from: only adds focus() -> onFocus(position). */
  function ValueBase(containerEl) {
    this.containerEl = containerEl;
  }
  methods(ValueBase, {
    focus(position) {
      if (position === undefined) position = "both";
      this.onFocus(position);
    },
  });

  /** Plain text value; renders as a link chip when the text parses as one. */
  function TextValue(ctx, containerEl) {
    const self = ValueBase.call(this, containerEl) || this;
    self.type = "text";
    self.hoverPopover = null;
    self.value = "";
    self.ctx = ctx;
    self.containerEl = containerEl;
    const spellcheck = String(ctx.app.vault.getConfig("spellcheck"));
    const inputEl = self.inputEl = containerEl.createDiv({
      cls: "metadata-input-longtext",
      type: "text",
      attr: { placeholder: host.t.properties.labelNoValue(), contentEditable: true, spellcheck, tabIndex: 0 },
    });
    const commit = (text) => {
      self.setValue(text);
      self.ctx.onChange(text);
    };
    inputEl.addEventListener("drop", (event) => {
      const draggable = ctx.app.dragManager.draggable;
      if (!draggable) return;
      const links = host.dragLinkText(ctx.app, draggable, ctx.sourcePath);
      if (links.length > 0) {
        event.preventDefault();
        commit(links[0]);
      }
    });
    inputEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        if (event.shiftKey) return;
        if (event.defaultPrevented) return;
        event.preventDefault();
        commit(inputEl.textContent);
        self.ctx.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        self.setValue(self.value);
        self.ctx.blur();
      }
    });
    inputEl.addEventListener("input", (event) => {
      if (!event.isComposing) host.normalizeEditable(inputEl, true);
    });
    inputEl.addEventListener("paste", (event) => host.pastePlainText(inputEl, event));
    inputEl.addEventListener("blur", (event) => {
      if (event.defaultPrevented) return;
      commit(inputEl.textContent.trimEnd());
    });
    return self;
  }
  inherit(TextValue, ValueBase);
  methods(TextValue, {
    render() {
      const self = this;
      const ctx = this.ctx;
      const value = this.value;
      let inputEl = this.inputEl;
      const inner = createDiv("metadata-link-inner");
      if (s21RenderLinkValue(value, inner, ctx, self)) {
        inputEl = createDiv("metadata-link");
        inputEl.appendChild(inner);
        inputEl.createDiv("metadata-link-flair", (flair) => host.setIcon(flair, "lucide-pencil"));
        inputEl.addEventListener("click", (event) => {
          if (event.defaultPrevented) return;
          self.onFocus();
        });
      }
      this.containerEl.setChildrenInPlace([inputEl]);
    },
    setValue(value) {
      if (!value) value = "";
      this.value = String(value);
      this.inputEl.textContent = value;
      this.render();
    },
    onFocus(position) {
      const inputEl = this.inputEl;
      this.containerEl.setChildrenInPlace([inputEl]);
      if (host.Platform.isPhone) inputEl.focus();
      else host.focusAndSelectContents(inputEl, position === "start" ? true : position === "end" ? false : undefined);
    },
  });

  /** Shared base for the date/datetime widgets: input element, dirty tracking, parse/format hooks. */
  function DateValueBase(ctx, containerEl, value) {
    const self = ValueBase.call(this, containerEl) || this;
    self.type = "date";
    self.hoverPopover = null;
    self.dirty = false;
    self.value = "";
    self.value = value != null ? value : "";
    self.parse(value);
    self.dirty = false;
    const inputEl = self.buildInput(containerEl);
    self.inputEl = inputEl;
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
    inputEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        ctx.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        self.setValue(self.value);
        ctx.blur();
      }
    });
    return self;
  }
  inherit(DateValueBase, ValueBase);
  methods(DateValueBase, {
    onFocus() {
      this.inputEl.focus();
    },
    setValue(value) {
      this.dirty = false;
      this.inputEl.value = this.value = value;
      this.inputEl.toggleClass("is-empty", !value);
      this.parse(value);
    },
  });

  /** Date value; adds a button that opens the daily note for the picked day when the plugin is enabled. */
  function DateValue(ctx, containerEl, value) {
    const self = DateValueBase.call(this, ctx, containerEl, value) || this;
    self.type = "datetime";
    self.buttonEl = null;
    const app = ctx.app;
    const dailyNotes = app.internalPlugins.getEnabledPluginById("daily-notes");
    if (dailyNotes) {
      self.buttonEl = containerEl.createDiv("clickable-icon", (el) => {
        host.setIcon(el, "lucide-link");
        setElementTooltip(el, host.t.plugins.properties.actionOpenDailyNote());
        el.onClickEvent((event) => {
          (async () => {
            const note = await dailyNotes.getDailyNote(self.date);
            app.workspace.getLeaf(host.Keymap.isModEvent(event)).openFile(note);
          })();
        });
        el.toggle(!!self.value);
      });
    }
    return self;
  }
  inherit(DateValue, DateValueBase);
  methods(DateValue, {
    buildInput(containerEl) {
      return containerEl.createEl("input", {
        cls: "metadata-input metadata-input-text mod-date",
        type: "date",
        placeholder: host.t.properties.labelNoValue(),
        value: this.format(this.date),
        attr: { max: "9999-12-31" },
      });
    },
    parse(value) {
      this.date = window.moment(value, s21Env().LL);
      if (this.buttonEl) this.buttonEl.toggle(this.date.isValid());
    },
    format(date) {
      return date.isValid() ? date.format("YYYY-MM-DD") : "";
    },
  });

  /** Datetime-local value (no daily-note button). */
  function DateTimeValue(ctx, containerEl, value) {
    const self = DateValueBase.call(this, ctx, containerEl, value) || this;
    self.type = "datetime";
    return self;
  }
  inherit(DateTimeValue, DateValueBase);
  methods(DateTimeValue, {
    buildInput(containerEl) {
      return containerEl.createEl("input", {
        cls: "metadata-input metadata-input-text mod-datetime",
        type: "datetime-local",
        placeholder: host.t.properties.labelNoValue(),
        value: this.format(this.date),
        attr: { max: "9999-12-31T23:59" },
      });
    },
    parse(value) {
      this.date = window.moment(value, s21Env().IL);
    },
    format(date) {
      return date.isValid() ? date.format("YYYY-MM-DD[T]HH:mm:ss") : "";
    },
  });

  /** File path value with the file-path suggest. */
  function FileValue(ctx, containerEl, value) {
    const self = ValueBase.call(this, containerEl) || this;
    self.type = "file";
    const inputEl = self.inputEl = containerEl.createEl("input", {
      cls: "metadata-input metadata-input-text",
      type: "text",
      placeholder: host.t.properties.labelNoValue(),
      value: value != null ? value : "",
    });
    inputEl.addEventListener("change", () => ctx.onChange(inputEl.value));
    inputEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      ctx.blur();
    });
    const suggest = new host.FilePathSuggest(ctx.app, inputEl).onSelect((item) => {
      inputEl.value = item.item.path;
      ctx.onChange(inputEl.value);
    });
    suggest.suggestEl.addClass("mod-property-value");
    return self;
  }
  inherit(FileValue, ValueBase);
  methods(FileValue, {
    onFocus() { this.inputEl.focus(); },
    setValue(value) {
      if (value === null) value = "";
      this.inputEl.value = value;
    },
  });

  /** Folder path value with the folder-path suggest. */
  function FolderValue(ctx, containerEl, value) {
    const self = ValueBase.call(this, containerEl) || this;
    self.type = "folder";
    const inputEl = self.inputEl = containerEl.createEl("input", {
      cls: "metadata-input metadata-input-text",
      type: "text",
      placeholder: host.t.properties.labelNoValue(),
      value: value != null ? value : "",
    });
    inputEl.addEventListener("change", () => ctx.onChange(inputEl.value));
    inputEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      ctx.blur();
    });
    const suggest = new host.FolderSuggest(ctx.app, inputEl, false, true).onSelect((item) => {
      inputEl.value = item.item.path;
      ctx.onChange(inputEl.value);
    });
    suggest.suggestEl.addClass("mod-property-value");
    return self;
  }
  inherit(FolderValue, ValueBase);
  methods(FolderValue, {
    onFocus() { this.inputEl.focus(); },
    setValue(value) {
      if (value === null) value = "";
      this.inputEl.value = value;
    },
  });

  /** Boolean value rendered as a checkbox (null shows the indeterminate state). */
  function CheckboxValue(ctx, containerEl, value) {
    const self = ValueBase.call(this, containerEl) || this;
    self.type = "checkbox";
    const checkboxEl = self.checkboxEl = containerEl.createEl("input", { type: "checkbox", cls: "metadata-input-checkbox" });
    checkboxEl.checked = value;
    checkboxEl.setAttr("data-indeterminate", value == null);
    checkboxEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      ctx.blur();
    });
    checkboxEl.addEventListener("change", () => {
      navigator.vibrate(100);
      ctx.onChange(checkboxEl.checked);
      checkboxEl.setAttr("data-indeterminate", false);
    });
    return self;
  }
  inherit(CheckboxValue, ValueBase);
  methods(CheckboxValue, {
    onFocus() { this.checkboxEl.focus(); },
    setValue(value) {
      if (value === null) {
        this.checkboxEl.checked = false;
        this.checkboxEl.setAttr("data-indeterminate", true);
        return;
      }
      this.checkboxEl.checked = value;
    },
  });

  /** Number value; invalid input shows an error tooltip and is not committed. */
  function NumberValue(ctx, containerEl, value) {
    const self = ValueBase.call(this, containerEl) || this;
    self.type = "number";
    const inputEl = self.inputEl = containerEl.createEl("input", {
      cls: "metadata-input metadata-input-number",
      type: "number",
      placeholder: host.t.properties.labelNoValue(),
      value: Number.isNaN(value) ? "" : "" + value,
      attr: { inputmode: "decimal", step: "any" },
    });
    const commit = (raw) => {
      value = null;
      if (raw) {
        value = +inputEl.value;
        if (Number.isNaN(value)) {
          self.showError();
          return;
        }
      }
      ctx.onChange(value);
    };
    inputEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (inputEl.validity.valid) {
          commit(inputEl.value);
          ctx.blur();
        } else self.showError();
      } else if (event.key === "Escape") {
        event.preventDefault();
        inputEl.value = value != null ? String(value) : "";
        ctx.blur();
      }
    });
    inputEl.addEventListener("blur", (event) => {
      if (event.defaultPrevented) return;
      if (inputEl.validity.valid) commit(inputEl.value);
      else inputEl.value = value != null ? String(value) : "";
    });
    return self;
  }
  inherit(NumberValue, ValueBase);
  methods(NumberValue, {
    showError() {
      displayTooltip(this.inputEl, host.t.properties.msgInvalidNumber(), { classes: ["mod-error"] });
    },
    onFocus() { this.inputEl.focus(); },
    setValue(value) {
      this.inputEl.value = value === null ? "" : String(value);
    },
  });

  /** Fallback widget: shows the JSON of whatever value the property holds. */
  function UnknownValue(containerEl, value) {
    const self = ValueBase.call(this, containerEl) || this;
    self.type = "unknown";
    self.el = containerEl.createSpan({
      cls: "metadata-property-value-item mod-unknown",
      text: JSON.stringify(value),
      attr: { tabindex: 0 },
    });
    return self;
  }
  inherit(UnknownValue, ValueBase);
  methods(UnknownValue, {
    onFocus() { this.el.focus(); },
    setValue(value) { this.el.setText(JSON.stringify(value)); },
  });

  /** Multi-value text widget (multitext/cssclasses): chips plus a contenteditable input with link suggest. */
  function MultiTextValue(ctx, containerEl, value) {
    const self = ValueBase.call(this, containerEl) || this;
    self.type = "multitext";
    self.hoverPopover = null;
    value = toStringList(value);
    self.valueSet = new Set(value);
    const app = ctx.app;
    const onChange = ctx.onChange;
    const sourcePath = ctx.sourcePath;
    const setupSuggest = (inputEl, onPick) => {
      new ValueLinkSuggest(ctx, inputEl, (text, event) => onPick(text, true), (suggestion) => suggestion.type !== "text" || !self.valueSet.has(suggestion.text));
    };
    const multiselect = self.multiselect = new MultiSelect(containerEl)
      .setOptionRenderer((item, parts) => {
        const el = parts.el;
        if (!s21RenderLinkValue(item, el, ctx, self)) el.setText(item);
      })
      .setValues(value)
      .allowCreatingOptions((text) => text)
      .setupInputEl(setupSuggest)
      .onChange((items) => {
        self.valueSet = new Set(items);
        onChange(items.slice());
      });
    app.dragManager.handleDrop(multiselect.rootEl, (event, draggable, isExternal) => {
      if (!draggable) return;
      if (!isExternal) {
        const links = host.dragLinkText(app, draggable, sourcePath);
        if (links.length > 0) {
          event.preventDefault();
          for (const link of links) multiselect.addElement(link);
        }
      }
      return { hoverClass: "is-being-dragged-over", hoverEl: containerEl, dropEffect: "copy" };
    });
    multiselect.inputEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        ctx.blur();
      }
    });
    setupSuggest(multiselect.inputEl, (text) => {
      multiselect.addElement(text);
      multiselect.setInputText("");
    });
    return self;
  }
  inherit(MultiTextValue, ValueBase);
  methods(MultiTextValue, {
    onFocus() {
      if (host.Platform.isPhone) this.multiselect.inputEl.focus();
      else host.focusAndSelectContents(this.multiselect.inputEl);
    },
    setValue(value) {
      value = toStringList(value);
      this.valueSet = new Set(value);
      this.multiselect.setValues(value);
    },
  });

  /** Tags widget: chips with validation, a tag suggest and jump-to-search on double click. */
  function TagsValue(ctx, containerEl, value) {
    const self = ValueBase.call(this, containerEl) || this;
    self.type = "tags";
    if (value == null) value = [];
    let known = new Set(value);
    const multiselect = self.multiselect = new MultiSelect(containerEl)
      .setOptionRenderer((item, parts) => {
        const el = parts.el;
        const pillEl = parts.pillEl;
        if (item.startsWith("#")) item = item.slice(1);
        el.createEl("span", { text: item });
        if (!tagValid("#" + item)) {
          pillEl.addClass("is-invalid");
          setElementTooltip(pillEl, host.t.properties.msgInvalidTag());
        }
        host.nativeDblClick(el, () => {
          const search = ctx.app.internalPlugins.getEnabledPluginById("global-search");
          if (search) search.openGlobalSearch("tag:" + item);
        });
      })
      .preventDuplicates((item, values) => {
        const strip = (tag) => (tag.startsWith("#") ? tag.slice(1) : tag);
        return values.map(strip).indexOf(strip(item));
      })
      .allowCreatingOptions((text) => {
        if (!text.trim()) return null;
        const tag = text.startsWith("#") ? text : "#" + text;
        if (tagValid(tag)) {
          hideTooltip();
          return text;
        }
        displayTooltip(multiselect.inputEl, host.t.properties.msgInvalidTag(), { classes: ["mod-error"] });
        return null;
      })
      .setValues(value)
      .onChange((items) => {
        ctx.onChange(items.slice());
        known = new Set(items);
      });
    multiselect.inputEl.autocapitalize = "none";
    new TagValueSuggest(ctx.app, multiselect.inputEl, (suggestion) => !known.has(suggestion.tag))
      .onSelect((suggestion) => {
        multiselect.addElement(suggestion.tag);
        multiselect.setInputText("");
      });
    multiselect.inputEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        ctx.blur();
      }
    });
    return self;
  }
  inherit(TagsValue, ValueBase);
  methods(TagsValue, {
    onFocus() {
      if (host.Platform.isPhone) this.multiselect.inputEl.focus();
      else host.focusAndSelectContents(this.multiselect.inputEl);
    },
    setValue(value) { this.multiselect.setValues(toStringList(value)); },
  });

  /** Aliases widget: chips with duplicate prevention. */
  function AliasesValue(ctx, containerEl, value) {
    const self = ValueBase.call(this, containerEl) || this;
    self.type = "aliases";
    self.hoverPopover = null;
    value = toStringList(value);
    self.ctx = ctx;
    self.containerEl = containerEl;
    const multiselect = self.multiselect = new MultiSelect(containerEl)
      .setOptionRenderer((item, parts) => {
        parts.el.setText(item);
        if (item.trim().length === 0) parts.pillEl.addClass("is-invalid");
      })
      .preventDuplicates((item, values) => values.indexOf(item))
      .allowCreatingOptions((text) => text.trim())
      .setValues(value)
      .onChange((items) => ctx.onChange(items.slice()));
    multiselect.inputEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        ctx.blur();
      }
    });
    return self;
  }
  inherit(AliasesValue, ValueBase);
  methods(AliasesValue, {
    onFocus() {
      if (host.Platform.isPhone) this.multiselect.inputEl.focus();
      else host.focusAndSelectContents(this.multiselect.inputEl);
    },
    setValue(value) { this.multiselect.setValues(toStringList(value)); },
  });

  /** Combobox over the registered property names (the "property" type used by bases views). */
  function PropertyCombo(app, containerEl) {
    const self = s21Env().MI.apply(this, arguments) || this;
    return self;
  }
  inherit(PropertyCombo, s21Env().MI);
  methods(PropertyCombo, {
    getItems() {
      const self = this;
      return Object.values(this.app.metadataTypeManager.getAllProperties()).map((info) => ({
        value: info.name,
        icon: this.app.metadataTypeManager.getWidget(info.widget).icon,
      }));
    },
  });

  /** Combobox widget for the "property" type. */
  function PropertyValue(ctx, containerEl, value) {
    const self = ValueBase.call(this, containerEl) || this;
    self.type = "property";
    self.combobox = new PropertyCombo(ctx.app, containerEl)
      .setPlaceholder(host.t.plugins.bases.labelPropertyKey())
      .onSelect((item) => ctx.onChange(item == null ? undefined : item.value))
      .setValueById(value);
    return self;
  }
  inherit(PropertyValue, ValueBase);
  methods(PropertyValue, {
    onFocus() { this.combobox.focus(); },
    setValue(value) { this.combobox.setValueById(value); },
  });

  // ===============================================================================================================
  // Suggest popups
  // ===============================================================================================================

  /** Tag suggestions for the tags property input (filters out values already present). */
  function TagValueSuggest(app, inputEl, suggestionFilter) {
    const self = host.AbstractInputSuggest.call(this, app, inputEl) || this;
    self.suggestionFilter = suggestionFilter;
    self.suggestEl.addClass("mod-property-value");
    self.scope.register([], "Tab", (event) => {
      if (event.isComposing) return undefined;
      const suggestions = self.suggestions;
      const item = suggestions.values[suggestions.selectedItem];
      if (item) {
        const text = s21Env().By(item.tag, item.matches);
        inputEl.setText(text);
        s21Env().fg(inputEl, { from: text.length });
        inputEl.trigger("input");
      }
      return false;
    });
    return self;
  }
  inherit(TagValueSuggest, host.AbstractInputSuggest);
  methods(TagValueSuggest, {
    getSuggestions(query) {
      return s21TagSuggestions(this.app.metadataCache, query, query.startsWith("#")).filter(this.suggestionFilter);
    },
    showSuggestions(values) {
      host.AbstractInputSuggest.prototype.showSuggestions.call(this, values);
      if (!this.getValue()) this.suggestions.forceSetSelectedItem(-1, null);
    },
    renderSuggestion(suggestion, el) {
      renderMatches(el, suggestion.tag, suggestion.matches);
    },
  });

  /** Link/file/heading suggestions inside property text values (the [[...]] and value completers). */
  function ValueLinkSuggest(ctx, inputEl, onSelectLink, suggestionFilter) {
    const self = host.AbstractInputSuggest.call(this, ctx.app, inputEl) || this;
    self.context = ctx;
    self.inputEl = inputEl;
    self.onSelectLink = onSelectLink;
    self.suggestionFilter = suggestionFilter;
    self.instructionsEl = createDiv("prompt-instructions");
    self.sourcePath = ctx.sourcePath;
    self.manager = new (s21Env().WI)(ctx.app, () => ctx.sourcePath);
    self.suggestEl.addClass("mod-property-value");
    self.suggestEl.setAttr("data-property-key", ctx.key.toLowerCase());
    self.scope.register(["Shift"], "Enter", (event) => {
      self.selectSuggestion(null, event);
      return false;
    });
    self.scope.register([], "Tab", (event) => {
      if (event.isComposing) return undefined;
      if (self.suggestions.useSelectedItem(event)) return false;
      return undefined;
    });
    self.scope.register(null, "#", (event) => {
      if (!inputEl.getText().startsWith("[[")) return undefined;
      if (self.manager.mode !== "file" && self.manager.mode !== "heading") return undefined;
      if (self.suggestions.useSelectedItem(event)) return false;
      return undefined;
    });
    self.scope.register(null, "^", (event) => {
      if (self.manager.mode !== "file") return undefined;
      if (self.suggestions.useSelectedItem(event)) return false;
      return undefined;
    });
    return self;
  }
  inherit(ValueLinkSuggest, host.AbstractInputSuggest);
  methods(ValueLinkSuggest, {
    updateInstructions(isLink) {
      if (isLink) host.renderInstructions(this.instructionsEl, this.manager.getInstructions());
      host.renderInstructions(this.instructionsEl, [
        { command: host.t.properties.valueSuggestion.keyLinkNote(), purpose: host.t.properties.valueSuggestion.instructionLinkNote() },
        { command: "esc", purpose: host.t.properties.valueSuggestion.instructionDismiss() },
      ]);
    },
    showSuggestions(values) {
      host.AbstractInputSuggest.prototype.showSuggestions.call(this, values);
      if (this.context) {
        const text = this.inputEl.getText();
        if (!text || text === "[[" || text.startsWith("[[^") || text.startsWith("#")) {
          this.suggestions.forceSetSelectedItem(-1, null);
        }
        this.updateInstructions(text.startsWith("[["));
      }
    },
    selectSuggestion(suggestion, event) {
      let text;
      let close = true;
      let selection = null;
      if (suggestion == null) {
        text = this.getValue();
        if (text.startsWith("[[") && !text.endsWith("]]")) text += "]]";
      } else if (suggestion.type === "text") {
        text = suggestion.text;
      } else {
        const key = event.instanceOf(KeyboardEvent) ? host.eventKey(event) : "";
        close = !key || key === "Enter";
        const current = this.inputEl.getText();
        const range = this.inputEl.win.getSelection().getRangeAt(0);
        const beforeCursor = current.substring(2, range.startOffset);
        const linkInfo = s21Env().UI(this.app, suggestion, beforeCursor, current, 0, range.startOffset, this.sourcePath, key, "frontmatter");
        if (suggestion.type === "block" && linkInfo.blockId) {
          const insertion = ng08BlockRefInsertion(suggestion, linkInfo.blockId);
          let content = suggestion.content;
          content = content.slice(0, insertion.blockEnd) + insertion.addition + content.slice(insertion.blockEnd);
          this.app.vault.modify(suggestion.file, content);
        }
        text = linkInfo.replacement;
        selection = { from: linkInfo.selectionStart, to: linkInfo.selectionEnd };
      }
      if (close) {
        this.close();
        this.onSelectLink(text, event);
      } else {
        this.inputEl.textContent = text;
        s21Env().fg(this.inputEl, selection);
        this.inputEl.trigger("input");
      }
    },
    renderSuggestion(suggestion, el) {
      if (suggestion.type === "text") {
        if (suggestion.text.startsWith("[[") && suggestion.text.endsWith("]]")) {
          el.addClass("mod-complex");
          const content = el.createDiv("suggestion-content");
          const aux = el.createDiv("suggestion-aux");
          const title = content.createDiv("suggestion-title");
          const note = content.createDiv("suggestion-note");
          const parsed = s21Env().iE(suggestion.text.slice(2, -2));
          const titleText = parsed.title;
          const href = parsed.href;
          const isAlias = parsed.isAlias;
          if (isAlias) note.setText(href);
          aux.createSpan({ cls: "suggestion-flair" }, (flair) => {
            if (isAlias) {
              host.setIcon(flair, "lucide-forward");
              setElementTooltip(flair, host.t.interface.tooltip.alias());
            } else host.setIcon(flair, "lucide-link");
          });
          shiftRanges(suggestion.matches, -2);
          renderResults(title, titleText, suggestion);
        } else {
          el.addClass("mod-nowrap");
          renderResults(el, suggestion.text, suggestion);
        }
      } else {
        host.renderSectionSuggestion(suggestion, el, this.manager.global);
      }
    },
    getSuggestions(query) {
      return (async () => {
        let suggestions;
        if (query.startsWith("[[")) {
          let runnable = this.manager.runnable;
          if (runnable) runnable.cancel();
          runnable = this.manager.runnable = new (s21Env().bb)();
          let offset;
          const selection = this.inputEl.win.getSelection();
          if (selection && selection.rangeCount > 0) offset = selection.getRangeAt(0).startOffset;
          const text = query.slice(2, offset);
          const result = await this.manager.getSuggestionsAsync(runnable, text);
          if (!result || runnable.isCancelled()) return [];
          if (result.length === 0) result.push(s21Env().VI);
          result.sort(s21Env().BI);
          suggestions = result;
        } else {
          suggestions = s21PropertyValueSuggestions(this.app, this.context.key, query);
        }
        return this.suggestionFilter ? suggestions.filter(this.suggestionFilter) : suggestions;
      })();
    },
  });

  /** Type-change confirmation modal shown when a property's inferred type differs from the expected one. */
  function TypeChangeModal(app, line) {
    const self = host.ButtonModal.call(this, app) || this;
    self.line = line;
    const typeInfo = line.typeInfo;
    const inferred = typeInfo.inferred;
    const expectedType = typeInfo.expected.type;
    const inferredType = inferred.type;
    self.setTitle(host.t.properties.labelChangePropertyType({ type: expectedType }));
    self.contentEl.createEl("p", { text: host.t.properties.labelChangePropertyTypeDesc({ oldType: inferredType }) });
    self.addButton("mod-cta", host.t.dialogue.buttonUpdate(), (event) => self.onSubmit(event));
    self.addCancelButton();
    self.scope.register([], "Enter", self.onSubmit.bind(self));
    return self;
  }
  inherit(TypeChangeModal, host.ButtonModal);
  methods(TypeChangeModal, {
    onSubmit(event) {
      event.preventDefault();
      this.close();
      this.shouldRestoreSelection = false;
      this.line.renderProperty(this.line.entry, true, true);
      this.line.focusValue();
    },
  });

  // ===============================================================================================================
  // Editor suggests (the [[...]] and #tag triggers inside the markdown editor)
  // ===============================================================================================================

  /** [[link]] suggestions in the editor, driven by the shared link suggestion manager. */
  function WikilinkSuggest(app) {
    const self = host.EditorSuggest.call(this, app) || this;
    self.suggestManager = new (s21Env().WI)(app, () => {
      const context = self.context;
      const file = context && context.file;
      return file && file.path != null ? file.path : "";
    });
    self.setInstructions(self.suggestManager.getInstructions());
    self.scope.register(["Shift"], "Enter", (event) => {
      if (event.isComposing) return undefined;
      self.selectSuggestion({ type: "none", matches: [], score: 0 }, event);
      return false;
    });
    self.scope.register([], "Tab", (event) => {
      if (event.isComposing) return undefined;
      if (self.suggestions.useSelectedItem(event)) return false;
      return undefined;
    });
    self.scope.register(null, "#", (event) => {
      const mode = self.suggestManager.mode;
      if (mode === "file" || mode === "heading") {
        if (self.suggestions.useSelectedItem(event)) return false;
      }
      return undefined;
    });
    self.scope.register(null, "^", (event) => {
      if (self.suggestManager.mode === "file") {
        if (self.suggestions.useSelectedItem(event)) return false;
      }
      return undefined;
    });
    return self;
  }
  inherit(WikilinkSuggest, host.EditorSuggest);
  methods(WikilinkSuggest, {
    onTrigger(cursor, editor, file) {
      const line = cursor.line;
      const text = editor.getLine(line).substr(0, cursor.ch);
      const open = text.lastIndexOf("[[");
      const close = text.lastIndexOf("]");
      if (open !== -1 && close < open) {
        return { start: { line, ch: open + 2 }, end: { line, ch: cursor.ch }, query: text.substr(open + 2) };
      }
      return null;
    },
    getSuggestions(context) {
      return (async () => {
        let runnable = this.suggestManager.runnable;
        if (runnable) runnable.cancel();
        runnable = this.suggestManager.runnable = new (s21Env().bb)();
        const query = context.query.trim();
        const result = await this.suggestManager.getSuggestionsAsync(runnable, query);
        if (!result || runnable.isCancelled()) return null;
        if (result.length === 0) result.push(s21Env().VI);
        result.sort(s21Env().BI);
        this.setInstructions(this.suggestManager.getInstructions());
        return result;
      })();
    },
    showSuggestions(values) {
      host.EditorSuggest.prototype.showSuggestions.call(this, values);
      if (this.context) {
        const query = this.context.query;
        if (!(query && query !== "^" && query !== "#")) this.suggestions.forceSetSelectedItem(-1, null);
      }
    },
    renderSuggestion(suggestion, el) {
      host.renderSectionSuggestion(suggestion, el, this.suggestManager.global);
    },
    selectSuggestion(suggestion, event) {
      const context = this.context;
      this.close();
      if (!context) return;
      const editor = context.editor;
      let start = context.start;
      const end = context.end;
      const file = context.file;
      const query = context.query;
      start = host.shiftPos(start, -2);
      const linkInfo = s21Env().UI(this.app, suggestion, query, editor.getLine(end.line).substr(end.ch), start.ch, end.ch, file && file.path || "", event.instanceOf(KeyboardEvent) ? host.eventKey(event) : "", "markdown");
      const lineStart = { line: start.line, ch: 0 };
      const changes = [{ from: host.shiftPos(lineStart, linkInfo.start), to: host.shiftPos(lineStart, linkInfo.end), text: linkInfo.replacement }];
      const selection = { from: host.shiftPos(lineStart, linkInfo.selectionStart), to: host.shiftPos(lineStart, linkInfo.selectionEnd) };
      if (suggestion.type === "block" && linkInfo.blockId) {
        const insertion = ng08BlockRefInsertion(suggestion, linkInfo.blockId);
        let content = suggestion.content;
        const blockStart = insertion.blockStart;
        const blockEnd = insertion.blockEnd;
        const addition = insertion.addition;
        const newlines = insertion.newlines;
        const target = suggestion.file;
        if (file !== target) {
          content = content.slice(0, blockEnd) + addition + content.slice(blockEnd);
          this.app.vault.modify(target, content);
        } else {
          const block = content.substring(blockStart, blockEnd);
          if (block === "") {
            this.close();
            return;
          }
          const whole = editor.getValue();
          let best = -99999;
          for (let at = 0, index = -1;;) {
            index = whole.indexOf(block, at);
            if (index === -1) break;
            if (Math.abs(blockStart - index) < Math.abs(blockStart - best)) best = index;
            at = index + block.length;
          }
          if (best >= 0) {
            const pos = s21Env().uP(whole, [best + block.length])[0];
            changes.push({ from: pos, text: addition });
            selection.from.line += newlines;
            selection.to.line += newlines;
          }
        }
      }
      editor.transaction({ changes, selection }, "input.autocomplete");
      setTimeout(() => editor.focus());
    },
    close() {
      host.EditorSuggest.prototype.close.call(this);
      this.suggestManager.fileSuggestions = null;
      if (this.suggestManager.runnable) {
        this.suggestManager.runnable.cancel();
        this.suggestManager.runnable = null;
      }
    },
  });

  /** #tag suggestions in the editor. */
  function TagTriggerSuggest(app) {
    const self = host.EditorSuggest.call(this, app) || this;
    self.scope.register([], "Tab", (event) => {
      if (event.isComposing) return undefined;
      const suggestions = self.suggestions;
      const item = suggestions.values[suggestions.selectedItem];
      if (item) {
        const context = self.context;
        const editor = context.editor;
        const start = context.start;
        const end = context.end;
        const text = "#" + s21Env().By(item.tag, item.matches);
        editor.transaction({ changes: [{ from: start, to: end, text }] });
        return false;
      }
      return undefined;
    });
    return self;
  }
  inherit(TagTriggerSuggest, host.EditorSuggest);
  methods(TagTriggerSuggest, {
    onTrigger(cursor, editor, file) {
      const line = cursor.line;
      const text = editor.getLine(line);
      const before = text.substr(0, cursor.ch);
      if (before.match(s21TagTriggerRe) && text.substr(cursor.ch, 1) !== "#") {
        const at = before.lastIndexOf("#");
        const query = before.substr(at + 1);
        return { start: { line, ch: at }, end: { line, ch: cursor.ch }, query };
      }
      return null;
    },
    renderSuggestion(suggestion, el) {
      renderResults(el, suggestion.tag, suggestion);
    },
    selectSuggestion(suggestion) {
      const context = this.context;
      this.close();
      if (!context) return;
      const editor = context.editor;
      const start = context.start;
      const end = context.end;
      editor.transaction({ changes: [{ from: start, to: end, text: "#" + suggestion.tag + " " }] });
      setTimeout(() => editor.focus());
    },
    getSuggestions(context) {
      return s21TagSuggestions(this.app.metadataCache, context.query);
    },
  });

  // ===============================================================================================================
  // MultiSelect: chips + contenteditable input used by the list-valued widgets
  // ===============================================================================================================

  function MultiSelect(containerEl) {
    const self = this;
    self.elements = [];
    self.values = [];
    self.rootEl = containerEl.createDiv({ cls: "multi-select-container", attr: { tabIndex: -1 } });
    const addFromInput = (text) => {
      if (self.addElement(text)) {
        self.inputEl.innerText = "";
        self.inputEl.trigger("input");
      }
    };
    const inputEl = self.inputEl = self.createInputEl();
    inputEl.addEventListener("blur", () => {
      if (inputEl.getText()) addFromInput(inputEl.getText());
    });
    inputEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter" && inputEl.getText().length > 0) {
        event.preventDefault();
        addFromInput(inputEl.getText());
      } else if (event.key === "Backspace" && self.inputText.length === 0 && self.elements.length > 0) {
        event.preventDefault();
        const last = self.elements[self.elements.length - 1];
        if (last) last.focus();
      } else if (event.key === "ArrowLeft") {
        const selection = inputEl.win.getSelection();
        if (inputEl.getText().length === 0 && selection.rangeCount > 0 && selection.getRangeAt(0).startOffset === 0) {
          event.preventDefault();
          self.focusElement(self.elements.length - 1);
        }
      }
    });
    inputEl.addEventListener("blur", () => {
      addFromInput(inputEl.getText());
    });
    self.rootEl.addEventListener("click", (event) => {
      if (event.targetNode === self.rootEl) inputEl.focus();
    });
    self.renderValues();
    return self;
  }
  Object.defineProperty(MultiSelect.prototype, "inputText", {
    get() { return this.inputEl.getText(); },
    enumerable: false,
    configurable: true,
  });
  methods(MultiSelect, {
    setInputText(text) {
      this.inputEl.innerText = text;
      this.inputEl.trigger("input");
    },
    createInputEl() {
      const el = createDiv({ cls: "multi-select-input", attr: { contentEditable: true, tabIndex: 0 } });
      el.addEventListener("input", () => host.normalizeEditable(el, false));
      el.addEventListener("paste", (event) => host.pastePlainText(el, event));
      return el;
    },
    setValues(values) {
      let changed = false;
      if (Array.isArray(values)) {
        changed = true;
        this.values = values;
      } else {
        changed = this.values.length > 0;
        this.values = [];
      }
      if (changed) {
        this.renderValues();
        this.triggerChange();
      }
      return this;
    },
    onChange(callback) {
      this.changeCallback = callback;
      return this;
    },
    setOptionRenderer(renderer) {
      this.optionRenderer = renderer;
      if (this.values.length > 0) this.renderValues();
      return this;
    },
    allowCreatingOptions(createOption) {
      this.createOption = createOption;
      return this;
    },
    preventDuplicates(findDuplicate) {
      this.findDuplicate = findDuplicate;
      return this;
    },
    setupInputEl(setupInput) {
      this.setupInput = setupInput;
      return this;
    },
    createElement(text) {
      const created = this.createOption == null ? undefined : this.createOption.call(this, text);
      return created || null;
    },
    addElement(text) {
      const created = this.createElement(text);
      if (!created) return false;
      const duplicateIndex = this.findDuplicate == null ? undefined : this.findDuplicate.call(this, created, this.values);
      if (duplicateIndex !== undefined && duplicateIndex >= 0 && duplicateIndex < this.elements.length) {
        const existing = this.elements[duplicateIndex];
        if (!existing.hasClass("multi-select-duplicate")) {
          existing.addClass("multi-select-duplicate");
          existing.win.setTimeout(() => existing.removeClass("multi-select-duplicate"), 2000);
        }
        return false;
      }
      this.values.push(created);
      this.renderValues();
      this.triggerChange();
      return true;
    },
    editElement(index) {
      const self = this;
      if (index < 0 || index >= this.values.length) return;
      const pill = this.elements[index];
      const inputEl = this.createInputEl();
      let focused = false;
      const commit = (text, refocus) => {
        if (refocus === undefined) refocus = false;
        const created = self.createElement(text);
        if (!created) return false;
        const duplicateIndex = self.findDuplicate == null ? undefined : self.findDuplicate.call(self, created, self.values);
        if (duplicateIndex !== undefined && duplicateIndex >= 0 && duplicateIndex !== index && duplicateIndex < self.elements.length) {
          const existing = self.elements[duplicateIndex];
          if (!existing.hasClass("multi-select-duplicate")) {
            existing.addClass("multi-select-duplicate");
            existing.win.setTimeout(() => existing.removeClass("multi-select-duplicate"), 2000);
          }
          return false;
        }
        focused = false;
        self.values[index] = created;
        self.renderValues();
        if (refocus) self.focusElement(index);
        self.triggerChange();
        return true;
      };
      if (this.setupInput != null) this.setupInput.call(this, inputEl, commit);
      inputEl.addEventListener("focus", () => { focused = true; });
      inputEl.addEventListener("blur", () => {
        if (!focused) return;
        focused = false;
        const text = inputEl.getText();
        if (text) commit(text);
        else {
          self.rootEl.insertBefore(pill, inputEl);
          inputEl.detach();
        }
      });
      inputEl.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === "Enter" && inputEl.getText().length > 0) {
          event.preventDefault();
          commit(inputEl.getText(), true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          focused = false;
          self.rootEl.insertBefore(pill, inputEl);
          inputEl.detach();
          pill.focus();
        }
      });
      inputEl.innerText = String(this.values[index]);
      this.rootEl.insertBefore(inputEl, pill);
      pill.detach();
      host.focusAndSelectContents(inputEl);
    },
    removeElement(index, refocus) {
      if (refocus === undefined) refocus = false;
      if (index < 0 || index >= this.values.length) return;
      this.values = this.values.filter((_, i) => i !== index);
      this.renderValues();
      if (refocus) this.focusElement(index - 1);
      this.triggerChange();
    },
    focusElement(index) {
      const clamped = Math.max(0, index);
      const el = this.elements[clamped];
      if (el) el.focus();
      else this.inputEl.focus();
    },
    renderValues() {
      const self = this;
      this.elements = [];
      for (let index = 0; index < this.values.length; index++) {
        const value = this.values[index];
        const valueIndex = index;
        const pill = this.rootEl.createDiv({ cls: "multi-select-pill", attr: { tabIndex: 0 } });
        const content = pill.createDiv({ cls: "multi-select-pill-content" });
        const removeButton = pill.createDiv({ cls: "multi-select-pill-remove-button" });
        host.setIcon(removeButton, "lucide-x");
        pill.addEventListener("copy", () => copyTextToClipboard(String(value)));
        pill.addEventListener("contextmenu", (event) => {
          const menu = host.Menu.forEvent(event);
          menu.addSections(["title", "open", "action-primary", "action", "info", "view", "system", "", "danger"]);
          menu.addItem((item) => item
            .setSection("action-primary")
            .setTitle(host.t.interface.menu.edit())
            .setIcon("lucide-edit-3")
            .onClick(() => self.editElement(valueIndex)));
          menu.addItem((item) => item
            .setSection("action-primary")
            .setTitle(host.t.interface.menu.copy())
            .setIcon("lucide-copy")
            .onClick(() => navigator.clipboard.writeText(String(value))));
          menu.addItem((item) => item
            .setWarning(true)
            .setSection("action-primary")
            .setIcon("lucide-trash-2")
            .setTitle(host.t.interface.menu.removeFromList())
            .onClick(() => self.removeElement(valueIndex)));
        });
        pill.addEventListener("dblclick", (event) => {
          event.preventDefault();
          self.editElement(valueIndex);
        });
        pill.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            self.editElement(valueIndex);
          } else if (event.key === "Escape") {
            event.preventDefault();
            self.inputEl.focus();
          } else if (event.key === "Backspace") {
            event.preventDefault();
            self.removeElement(valueIndex, true);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            self.focusElement(0);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            self.inputEl.focus();
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            self.focusElement(valueIndex - 1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            self.focusElement(valueIndex + 1);
          }
        });
        if (self.optionRenderer) self.optionRenderer(value, { el: content, pillEl: pill });
        else content.createSpan({ text: String(value) });
        if (self.findDuplicate) {
          const earlier = self.findDuplicate(value, self.values.slice(0, index));
          if (earlier !== undefined && earlier >= 0 && earlier < index) pill.addClass("is-invalid");
        }
        self.elements.push(pill);
        removeButton.addEventListener("mousedown", (event) => event.preventDefault());
        removeButton.addEventListener("click", (event) => {
          event.preventDefault();
          self.removeElement(valueIndex);
          self.inputEl.trigger("input");
        });
      }
      this.rootEl.setChildrenInPlace([...this.elements, this.inputEl]);
      this.inputEl.setAttr("placeholder", this.elements.length > 0 ? "" : host.t.properties.labelNoValue());
    },
    triggerChange() {
      if (this.changeCallback) this.changeCallback(this.values);
    },
  });

  // ===============================================================================================================
  // Widget type descriptors (what the metadata type manager registers)
  // ===============================================================================================================

  function widgetText() {
    return {
      name: host.t.properties.types.optionText,
      type: "text",
      icon: "lucide-text",
      validate: (value) => typeof value === "string",
      render(containerEl, value, ctx) {
        const widget = new TextValue(ctx, containerEl);
        widget.setValue(String(value != null ? value : ""));
        new ValueLinkSuggest(ctx, widget.inputEl, (text, event) => {
          event.preventDefault();
          widget.setValue(text);
          ctx.onChange(text);
          host.blurAndClearSelection();
          ctx.blur();
        });
        return widget;
      },
    };
  }

  function widgetProperty() {
    return {
      name: host.t.properties.types.optionPropertyName,
      type: "property",
      icon: "lucide-info",
      reservedKeys: [],
      validate: (value) => typeof value === "string",
      render: (containerEl, value, ctx) => new PropertyValue(ctx, containerEl, value),
    };
  }

  function widgetAliases() {
    return {
      name: host.t.properties.types.optionAliases,
      type: "aliases",
      icon: "lucide-forward",
      reservedKeys: ["aliases"],
      validate: (value) => typeof value === "string" || isStringArray(value, true),
      render: (containerEl, value, ctx) => new AliasesValue(ctx, containerEl, toStringList(value)),
    };
  }

  function widgetTags() {
    return {
      name: host.t.properties.types.optionTags,
      type: "tags",
      icon: "lucide-tags",
      reservedKeys: ["tags"],
      validate: (value) => typeof value === "string" || isStringArray(value, true),
      render: (containerEl, value, ctx) => new TagsValue(ctx, containerEl, toStringList(value)),
    };
  }

  function widgetFolder() {
    return {
      name: host.t.properties.types.optionFolder,
      type: "folder",
      icon: "lucide-folder",
      reservedKeys: [],
      validate: (value) => typeof value === "string",
      render: (containerEl, value, ctx) => new FolderValue(ctx, containerEl, value),
    };
  }

  function widgetFile() {
    return {
      name: host.t.properties.types.optionFile,
      type: "file",
      icon: "lucide-file",
      reservedKeys: [],
      validate: (value) => typeof value === "string",
      render: (containerEl, value, ctx) => new FileValue(ctx, containerEl, value),
    };
  }

  function widgetDate() {
    return {
      name: host.t.properties.types.optionDate,
      type: "date",
      icon: "lucide-calendar",
      validate: (value) => !value || window.moment(value, s21Env().LL).isValid(),
      render: (containerEl, value, ctx) => new DateValue(ctx, containerEl, value),
    };
  }

  function widgetDatetime() {
    return {
      name: host.t.properties.types.optionDatetime,
      type: "datetime",
      icon: "lucide-clock",
      validate: (value) => !value || window.moment(value, s21Env().IL).isValid(),
      render: (containerEl, value, ctx) => new DateTimeValue(ctx, containerEl, value),
    };
  }

  function widgetNumber() {
    return {
      name: host.t.properties.types.optionNumber,
      type: "number",
      icon: "lucide-binary",
      validate: (value) => Number.isNumber(value),
      render: (containerEl, value, ctx) => new NumberValue(ctx, containerEl, value),
    };
  }

  function widgetCheckbox() {
    return {
      name: host.t.properties.types.optionCheckbox,
      type: "checkbox",
      icon: "lucide-check-square",
      validate: (value) => typeof value === "boolean",
      render: (containerEl, value, ctx) => new CheckboxValue(ctx, containerEl, value),
    };
  }

  function widgetMultitext() {
    return {
      name: host.t.properties.types.optionMultitext,
      type: "multitext",
      icon: "lucide-list",
      validate: (value) => typeof value === "string" || isStringArray(value, true),
      render: (containerEl, value, ctx) => new MultiTextValue(ctx, containerEl, toStringList(value)),
    };
  }

  function widgetUnknown() {
    return {
      name: host.t.properties.types.optionUnknown,
      type: "unknown",
      icon: "lucide-file-question",
      validate: () => true,
      render: (containerEl, value) => new UnknownValue(containerEl, value),
    };
  }

  built = {
    ValueBase,
    TextValue,
    DateValueBase,
    DateValue,
    DateTimeValue,
    FileValue,
    FolderValue,
    CheckboxValue,
    NumberValue,
    UnknownValue,
    MultiTextValue,
    TagsValue,
    AliasesValue,
    PropertyCombo,
    PropertyValue,
    TagValueSuggest,
    ValueLinkSuggest,
    TypeChangeModal,
    WikilinkSuggest,
    TagTriggerSuggest,
    MultiSelect,
    widgetText,
    widgetProperty,
    widgetAliases,
    widgetTags,
    widgetFolder,
    widgetFile,
    widgetDate,
    widgetDatetime,
    widgetNumber,
    widgetCheckbox,
    widgetMultitext,
    widgetUnknown,
  };
  s21Cache.set(host, built);
  return built;
}

// =====================================================================================================================
// Exports consumed by the manifest (class factories receive __basaltHost; declarator factories too)
// =====================================================================================================================

export function s21DefineValueBase(host) { return s21Build(host).ValueBase; }
export function s21DefineTextValue(host) { return s21Build(host).TextValue; }
export function s21DefineDateBase(host) { return s21Build(host).DateValueBase; }
export function s21DefineDateValue(host) { return s21Build(host).DateValue; }
export function s21DefineDateTimeValue(host) { return s21Build(host).DateTimeValue; }
export function s21DefineFileValue(host) { return s21Build(host).FileValue; }
export function s21DefineFolderValue(host) { return s21Build(host).FolderValue; }
export function s21DefineCheckboxValue(host) { return s21Build(host).CheckboxValue; }
export function s21DefineNumberValue(host) { return s21Build(host).NumberValue; }
export function s21DefineUnknownValue(host) { return s21Build(host).UnknownValue; }
export function s21DefineMultitextValue(host) { return s21Build(host).MultiTextValue; }
export function s21DefineTagsValue(host) { return s21Build(host).TagsValue; }
export function s21DefineAliasesValue(host) { return s21Build(host).AliasesValue; }
export function s21DefinePropertyCombo(host) { return s21Build(host).PropertyCombo; }
export function s21DefinePropertyValue(host) { return s21Build(host).PropertyValue; }
export function s21DefineTagValueSuggest(host) { return s21Build(host).TagValueSuggest; }
export function s21DefineValueLinkSuggest(host) { return s21Build(host).ValueLinkSuggest; }
export function s21DefineTypeChangeModal(host) { return s21Build(host).TypeChangeModal; }
export function s21DefineWikilinkSuggest(host) { return s21Build(host).WikilinkSuggest; }
export function s21DefineTagTriggerSuggest(host) { return s21Build(host).TagTriggerSuggest; }
export function s21DefineMultiSelect(host) { return s21Build(host).MultiSelect; }

export function s21WidgetText(host) { return s21Build(host).widgetText(); }
export function s21WidgetProperty(host) { return s21Build(host).widgetProperty(); }
export function s21WidgetAliases(host) { return s21Build(host).widgetAliases(); }
export function s21WidgetTags(host) { return s21Build(host).widgetTags(); }
export function s21WidgetFolder(host) { return s21Build(host).widgetFolder(); }
export function s21WidgetFile(host) { return s21Build(host).widgetFile(); }
export function s21WidgetDate(host) { return s21Build(host).widgetDate(); }
export function s21WidgetDatetime(host) { return s21Build(host).widgetDatetime(); }
export function s21WidgetNumber(host) { return s21Build(host).widgetNumber(); }
export function s21WidgetCheckbox(host) { return s21Build(host).widgetCheckbox(); }
export function s21WidgetMultitext(host) { return s21Build(host).widgetMultitext(); }
export function s21WidgetUnknown(host) { return s21Build(host).widgetUnknown(); }

/** The regex that detects a #tag trigger at the end of the text before the cursor. */
export const s21TagTriggerRe = /(^|\s)#[^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]*$/g;

// =====================================================================================================================
// Plain function replacements (manifest "entries"); they reach app internals through the lazy env binding.
// =====================================================================================================================

/** Tag suggestions scored against the metadata cache; `withHash` keeps the leading '#' on the returned tags. */
export function s21TagSuggestions(cache, query, withHash) {
  if (withHash === undefined) withHash = false;
  query = query.toLowerCase();
  let tags = Object.keys(cache.getTags());
  if (!withHash) tags = tags.map((tag) => tag.slice(1));
  const results = [];
  const prepared = prepareQuery(query);
  tags.sort(s04StringCompare);
  for (const tag of tags) {
    if (query === "" || (query === "#" && withHash)) {
      results.push({ tag, score: 0, matches: null });
    } else {
      const match = fuzzyMatchJs(prepared, tag.toLowerCase());
      if (match) results.push({ tag, score: match.score, matches: match.matches });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

/** Scores `text`-like suggestions: tries the last path segment first (with shifted match ranges), then the whole string. */
export function s21PathSuggestion(getter, text) {
  const base = lastSegment(text);
  let result = getter(base);
  if (result) {
    shiftRanges(result.matches, text.length - base.length);
    return result;
  }
  result = getter(text);
  if (result) result.score -= 1;
  return result;
}

/** True when the given view/editor exposes a live metadata (properties) editor. */
export function s21HasMetadataEditor(view) {
  return !!view && typeof view === "object" && Object.hasOwn(view, "metadataEditor") && view.metadataEditor instanceof s21Env().tO;
}

/** The metadata editor of the active editor, or of the active leaf's view when the editor has none. */
export function s21ActivePropertiesEditor(workspace) {
  const activeEditor = workspace.activeEditor;
  if (s21HasMetadataEditor(activeEditor) && activeEditor.canShowProperties()) return activeEditor.metadataEditor;
  const view = workspace.activeLeaf == null ? undefined : workspace.activeLeaf.view;
  if (s21HasMetadataEditor(view) && view.canShowProperties()) return view.metadataEditor;
  return null;
}

/** Suggestions for a property value that is not a link: existing values of the same frontmatter key. */
function s21PropertyValueSuggestions(app, key, query) {
  query = query.toLowerCase();
  const results = [];
  const words = [query];
  const values = app.metadataCache.getFrontmatterPropertyValuesForKey(key);
  for (const value of values) {
    if (query === "") {
      results.push({ type: "text", text: value, score: 0, matches: null });
    } else {
      const spans = containsAllWords(words, value.toLowerCase());
      if (spans) results.push({ type: "text", text: value, score: matchScore(spans, query.length, value.length, 0), matches: spans });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}
