import { inherit, methods } from "./inherit.js";

// Properties (frontmatter) editor rendered above markdown notes.
// Replaces the minified MetadataEditor (tO), PropertyRow (nO) and
// PropertyKeySuggest (AO) classes. DOM structure, keyboard navigation,
// multi-select, clipboard formats, collapse animation and the type-widget
// integration are reconstructed from the shipped implementation.

const collator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });
const compareKeysAsc = collator.compare;
const compareKeysDesc = (a, b) => -collator.compare(a, b);
const compareIndices = (a, b) => a - b;

// Reserved frontmatter keys get dedicated widgets in the type manager.
const RESERVED_PROPERTY_KEYS = Object.freeze({
  aliases: { name: "aliases", widget: "aliases" },
  cssclasses: { name: "cssclasses", widget: "multitext" },
  tags: { name: "tags", widget: "tags" },
});

// Empty string / empty list normalize to null.
function normalizePropertyValue(value) {
  return value === "" || (Array.isArray(value) && value.length === 0) ? null : value;
}

// Shallow merge used when pasting properties.
function mergeProperties(target, source) {
  if (Object.keys(source).length === 0) return;
  for (const key in source) {
    if (Object.hasOwn(source, key)) target[key] = source[key];
  }
}

// Briefly flashes an element.
function flashElement(el, host) {
  el.addClass("is-flashing");
  el.win.setTimeout(() => el.removeClass("is-flashing"), 750);
}

// Prevents text selection when the drag handle area is pressed.
function initDragHandle(el) {
  el.addEventListener("mousedown", (event) => {
    if (event.button === 1) event.preventDefault();
  });
}

const cache = new WeakMap();

function build(host) {
  let built = cache.get(host);
  if (built) return built;

  function PropertyKeySuggest(app, inputEl, properties) {
    const self = host.AbstractInputSuggest.call(this, app, inputEl) || this;
    self.properties = properties;
    self.suggestEl.addClass("mod-property-key");
    self.scope.register(["Shift"], "Enter", (event) => {
      self.selectSuggestion({ type: "text", text: self.getValue(), widget: "text", score: 0, matches: null }, event);
      return false;
    });
    return self;
  }
  inherit(PropertyKeySuggest, host.AbstractInputSuggest);
  methods(PropertyKeySuggest, {
    renderSuggestion(suggestEl, suggestion) {
      suggestEl.addClass("mod-complex");
      const iconEl = suggestEl.createDiv("suggestion-icon");
      host.renderResults(suggestEl.createDiv("suggestion-content").createDiv("suggestion-title"), suggestion.text, suggestion);
      const widget = this.app.metadataTypeManager.getWidget(suggestion.widget);
      iconEl.createSpan({ cls: "suggestion-flair" }, (flair) => host.setIcon(flair, widget.icon));
    },
    getSuggestions(query) {
      const used = new Set(this.properties.map((prop) => prop.key.toLowerCase()));
      const all = this.app.metadataTypeManager.getAllProperties();
      const names = Object.entries(all)
        .filter(([key]) => !used.has(key))
        .map(([, info]) => info.name);
      const results = [];
      const lowered = query.toLowerCase();
      for (const name of names) {
        const widget = this.app.metadataTypeManager.getTypeInfo(name).inferred.type;
        if (lowered === "") {
          results.push({ type: "text", text: name, widget, score: 0, matches: null });
        } else {
          const matches = host.containsAllWords([lowered], name.toLowerCase());
          if (matches) {
            results.push({ type: "text", text: name, widget, score: host.matchScore(matches, lowered.length, name.length, 0), matches });
          }
        }
      }
      results.sort((a, b) => b.score - a.score);
      return results;
    },
  });

  function PropertyRow(app, metadataEditor, entry) {
    const self = host.Component.call(this) || this;
    self.app = app;
    self.metadataEditor = metadataEditor;
    self.entry = entry;
    self.typeInfo = self.app.metadataTypeManager.getTypeInfo(entry.key, entry.value);
    self.containerEl = createDiv({ cls: "metadata-property", attr: { tabIndex: 0 } });
    self.containerEl.setAttr("data-property-key", entry.key.toLowerCase());
    self.containerEl.addEventListener("keydown", (event) => {
      if (event.isComposing || event.defaultPrevented || event.target !== self.containerEl) return;
      if (self.metadataEditor.selectedLines.size > 1) {
        self.metadataEditor.handleKeypress(event);
        return;
      }
      if (event.key === "Enter" || event.key === " " || event.key === "A" || event.key === "i") {
        event.preventDefault();
        const position = event.key === "A" ? "end" : event.key === "i" ? "start" : "both";
        self.metadataEditor.focusValue(entry.key, position);
      } else if (event.key === "ArrowLeft" || event.key === "h") {
        event.preventDefault();
        self.focusKey();
      } else if (event.key === "ArrowRight" || event.key === "l") {
        event.preventDefault();
        self.focusValue();
      } else {
        self.metadataEditor.handleKeypress(event);
      }
    });
    self.keyEl = self.containerEl.createDiv({ cls: "metadata-property-key" });
    self.iconEl = self.keyEl.createSpan({
      cls: "metadata-property-icon",
      attr: { "aria-disabled": !entry.key },
    }, (iconEl) => {
      iconEl.addEventListener("mousedown", (event) => event.preventDefault());
      iconEl.addEventListener("click", (event) => {
        event.preventDefault();
        if (iconEl.getAttr("aria-disabled") !== "true" && !self.containerEl.hasClass("has-active-menu")) self.handleItemClick(event);
      });
      iconEl.addEventListener("contextmenu", (event) => {
        if (iconEl.getAttr("aria-disabled") !== "true" && !self.containerEl.hasClass("has-active-menu")) {
          event.preventDefault();
          self.focusProperty();
          self.showPropertyMenu(event);
        }
      });
    });
    self.keyInputEl = self.keyEl.createEl("input", {
      cls: "metadata-property-key-input",
      value: entry.key,
      type: "text",
      attr: { autocapitalize: "none", enterkeyhint: host.Platform.isAndroidApp ? "enter" : "next" },
    }, (inputEl) => {
      if (!host.Platform.isMobile) host.displayTooltip(inputEl, entry.key);
      inputEl.addEventListener("blur", () => {
        if (inputEl !== inputEl.doc.activeElement) {
          const value = inputEl.value.trim();
          if (value !== "" || entry.key !== "") {
            if (!self.handleUpdateKey(value)) inputEl.value = entry.key;
          } else {
            self.metadataEditor.removeProperties([self], false);
          }
        }
      });
      inputEl.addEventListener("keydown", (event) => {
        if (event.isComposing || event.defaultPrevented) return;
        if (event.key === "Tab" || event.key === "Enter") {
          event.preventDefault();
          const value = inputEl.value.trim();
          if (self.handleUpdateKey(value)) {
            self.app.nextFrame(() => {
              self.renderProperty(self.entry, true);
              self.focusValue();
            });
          }
        } else if (event.key === "Escape") {
          event.preventDefault();
          inputEl.value = entry.key;
          if (entry.key) self.focusProperty();
          else self.metadataEditor.removeProperties([self]);
        }
      });
      inputEl.addEventListener("input", () => {
        const key = entry.key || inputEl.value.trim();
        self.iconEl.setAttr("aria-disabled", !key);
      });
      new PropertyKeySuggest(app, inputEl, metadataEditor.properties).onSelect((suggestion) => {
        const value = suggestion.text.trim();
        inputEl.value = value;
        if (self.handleUpdateKey(value)) {
          self.app.nextFrame(() => {
            self.renderProperty(self.entry, true);
            self.focusValue();
          });
        }
      });
    });
    self.valueEl = self.containerEl.createDiv("metadata-property-value");
    initDragHandle(self.valueEl);
    const warningEl = self.warningEl = self.containerEl.createDiv({ cls: "clickable-icon metadata-property-warning-icon" });
    host.displayTooltip(warningEl, host.t.properties.labelTypeMismatchWarning({ type: self.typeInfo.expected.name() }));
    host.setIcon(warningEl, "lucide-alert-triangle");
    warningEl.toggle(self.typeInfo.expected !== self.typeInfo.inferred);
    warningEl.addEventListener("click", () => new host.TypeInfoModal(app, self).open());
    host.makeDragReorderable(self.iconEl, self.containerEl, self.metadataEditor.propertyListEl, 10, () => {}, (index) => {
      self.metadataEditor.reorderKey(self.entry, index);
    });
    return self;
  }
  inherit(PropertyRow, host.Component);
  methods(PropertyRow, {
    setSelected(selected) {
      this.containerEl.toggleClass("is-selected", selected);
    },
    handleItemClick(event) {
      if (!this.metadataEditor.handleItemSelection(event, this)) this.showPropertyMenu(event);
    },
    focusKey() {
      const editor = this.metadataEditor;
      const input = this.keyInputEl;
      if (editor.collapsed) editor.setCollapse(false, true);
      input.focus();
    },
    focusProperty() {
      const editor = this.metadataEditor;
      const container = this.containerEl;
      if (editor.collapsed) editor.setCollapse(false, true);
      container.focus();
    },
    focusValue(position) {
      if (position === undefined) position = "both";
      const editor = this.metadataEditor;
      const rendered = this.rendered;
      if (editor.collapsed) editor.setCollapse(false, true);
      rendered.focus(position);
    },
    showPropertyMenu(event) {
      event.preventDefault();
      const menu = new host.Menu();
      menu.addSections(["title", "action", "action.changeType", "selection", "clipboard", "", "danger"]);
      const manager = this.app.metadataTypeManager;
      const editable = !Object.hasOwn(RESERVED_PROPERTY_KEYS, this.entry.key);
      const widgets = manager.registeredTypeWidgets;
      if (host.Platform.isPhone) {
        menu.addItem((item) => item.setTitle(this.entry.key).setSection("title").removeIcon().setIsLabel(true));
      }
      if (host.Platform.isMobile) {
        menu.addItem((item) => item
          .setTitle(host.t.properties.optionPropertyType())
          .setSection("action.changeType")
          .removeIcon()
          .setIsLabel(true)
          .titleEl.addClass("u-small"))
          .onHide(() => host.blurAndClearSelection());
      }
      menu.setSectionSubmenu("action.changeType", { title: host.t.properties.optionPropertyType(), icon: "lucide-info" });
      const addTypeItem = (widget) => {
        if (widget.reservedKeys && !widget.reservedKeys.contains(this.entry.key)) return;
        menu.addItem((item) => item
          .setTitle(widget.name())
          .setIcon(widget.icon)
          .setSection("action.changeType")
          .setDisabled(!editable)
          .setChecked(widget.type === this.typeInfo.expected.type)
          .onClick(() => {
            manager.setType(this.entry.key, widget.type);
            this.renderProperty(this.entry, true);
            if (this.entry.value == null || widget.validate(this.entry.value)) new host.TypeInfoModal(this.app, this).open();
          }));
      };
      for (const widget of Object.values(widgets)) addTypeItem(widget);
      if (host.Platform.isDesktopApp) {
        menu.addItem((item) => item.setTitle(host.t.interface.menu.cut()).setSection("clipboard").setIcon("lucide-scissors")
          .onClick(() => event.win.electron.remote.getCurrentWebContents().cut()));
        menu.addItem((item) => item.setTitle(host.t.interface.menu.copy()).setSection("clipboard").setIcon("lucide-copy")
          .onClick(() => event.win.electron.remote.getCurrentWebContents().copy()));
        menu.addItem((item) => item.setTitle(host.t.interface.menu.paste()).setSection("clipboard").setIcon("lucide-clipboard-check")
          .onClick(() => event.win.electron.remote.getCurrentWebContents().paste()));
      }
      menu.addItem((item) => item.setTitle(host.t.interface.menu.remove()).setWarning(true).setSection("danger").setIcon("lucide-trash-2")
        .onClick(() => this.metadataEditor.removeProperties([this])));
      menu.setParentElement(this.containerEl).showAtMouseEvent(event);
    },
    handleUpdateKey(key) {
      if (key === "") {
        if (this.keyInputEl.isActiveElement()) {
          host.displayTooltip(this.keyInputEl, host.t.properties.msgEmptyPropertyName(), { classes: ["mod-error"] });
        }
        return false;
      }
      if (this.entry.key !== key) {
        const duplicate = this.metadataEditor.rendered.find((row) => row.entry.key.toLowerCase() === key.toLowerCase());
        if (duplicate && duplicate !== this.metadataEditor.focusedLine) {
          flashElement(this.keyInputEl, host);
          host.displayTooltip(this.keyInputEl, host.t.properties.msgDuplicatePropertyName(), { classes: ["mod-error"] });
          return false;
        }
        this.entry.key = key;
        this.containerEl.setAttr("data-property-key", key.toLowerCase());
        this.metadataEditor.save();
      }
      host.blurAndClearSelection();
      this.iconEl.setAttr("aria-disabled", false);
      return true;
    },
    handleUpdateValue(value) {
      if (this.entry.value !== value) {
        value = normalizePropertyValue(value);
        this.entry.value = value;
        this.metadataEditor.save();
      }
    },
    handlePropertyBlur() {
      host.blurAndClearSelection();
      if (host.Platform.hasPhysicalKeyboard) this.focusProperty();
    },
    renderProperty(entry, force, isInitial) {
      if (force === undefined) force = false;
      if (isInitial === undefined) isInitial = false;
      const previousInferred = this.typeInfo.inferred.type;
      const previousValue = entry && entry.value;
      this.entry = entry;
      this.typeInfo = this.app.metadataTypeManager.getTypeInfo(entry.key, entry.value);
      const type = isInitial ? this.typeInfo.expected : this.typeInfo.inferred;
      const activeInValue = this.valueEl.contains(this.containerEl.doc.activeElement);
      if (force || !(activeInValue || (this.valueEl.hasChildNodes() && previousValue === this.entry.value && previousInferred === this.typeInfo.inferred.type))) {
        host.setIcon(this.iconEl, this.typeInfo.expected.icon);
        host.displayTooltip(this.warningEl, host.t.properties.labelTypeMismatchWarning({ type: this.typeInfo.expected.name() }));
        this.warningEl.toggle(!isInitial && this.typeInfo.expected !== this.typeInfo.inferred);
        this.valueEl.empty();
        this.valueEl.setAttr("data-property-type", type.type);
        const file = this.metadataEditor.owner.getFile();
        this.rendered = type.render(this.valueEl, this.entry.value, {
          app: this.app,
          key: this.entry.key,
          onChange: this.handleUpdateValue.bind(this),
          sourcePath: file ? file.path : "",
          blur: this.handlePropertyBlur.bind(this),
          hoverSource: this.metadataEditor.owner.getHoverSource(),
        });
      }
    },
  });

  function MetadataEditor(app, owner) {
    const self = host.Component.call(this) || this;
    self.hoverPopover = null;
    self.properties = [];
    self.selectedLines = new Set();
    self.collapsed = false;
    self.app = app;
    self.owner = owner;
    self.rendered = [];
    self.containerEl = createDiv({ cls: "metadata-container", attr: { tabIndex: -1 } });
    self.errorEl = self.containerEl.createDiv("metadata-error-container");
    self.containerEl.setAttr("data-property-count", 0);
    self.containerEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.target === self.containerEl) self.handleKeypress(event);
    });
    self.containerEl.addEventListener("focusin", (event) => {
      for (const row of self.rendered) {
        if (row.containerEl === event.targetNode) return;
      }
      self.clearSelection();
    });
    self.headingEl = self.containerEl.createDiv({ cls: "metadata-properties-heading", attr: { tabIndex: 0 } }, (heading) => {
      host.setIcon(self.foldEl = heading.createDiv({ cls: "collapse-indicator collapse-icon" }), "right-triangle");
      heading.createDiv({ cls: "metadata-properties-title", text: host.t.properties.labelHeading() });
      heading.addEventListener("click", (event) => {
        event.preventDefault();
        self.toggleCollapse();
      });
      heading.addEventListener("contextmenu", self.showPropertiesMenu.bind(self));
      heading.addEventListener("mousedown", (event) => event.preventDefault());
      heading.addEventListener("keydown", (event) => {
        if (event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          self.setCollapse(true);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          self.setCollapse(false);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          self.owner.shiftFocusBefore();
        } else if (event.key === "ArrowDown" || event.key === "j") {
          event.preventDefault();
          if (self.collapsed) self.owner.shiftFocusAfter();
          else self.focusPropertyAtIndex(0);
        }
      });
    });
    const contentEl = self.contentEl = self.containerEl.createDiv("metadata-content");
    self.propertyListEl = contentEl.createDiv("metadata-properties");
    self.addPropertyButtonEl = contentEl.createDiv({ cls: "metadata-add-button text-icon-button", attr: { tabIndex: 0 } }, (button) => {
      button.createSpan("text-button-icon", (icon) => host.setIcon(icon, "lucide-plus"));
      button.createSpan({ cls: "text-button-label", text: host.t.properties.labelAddPropertyButton() });
      button.addEventListener("click", () => self.addProperty());
      button.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          self.addProperty();
        } else if (event.key === "ArrowUp" || event.key === "k" || (event.shiftKey && event.key === "Tab")) {
          event.preventDefault();
          self.focusPropertyAtIndex(-1);
        } else if (event.key === "ArrowDown" || event.key === "j" || event.key === "Tab") {
          event.preventDefault();
          self.owner.shiftFocusAfter();
        } else {
          self.handleKeypress(event);
        }
      });
    });
    return self;
  }
  inherit(MetadataEditor, host.Component);
  Object.defineProperty(MetadataEditor.prototype, "focusedLine", {
    get() {
      const active = this.containerEl.doc.activeElement;
      for (const row of this.rendered) {
        if (row.containerEl.contains(active)) return row;
      }
      return null;
    },
    enumerable: false,
    configurable: true,
  });
  methods(MetadataEditor, {
    handleKeypress(event) {
      if (event.key === "o") {
        event.preventDefault();
        this.addProperty();
        return;
      }
      if (event.key === "Home" || (event.key === "ArrowDown" && event.altKey)) {
        event.preventDefault();
        this.owner.shiftFocusAfter();
        return;
      }
      const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      if (!vertical || !event.shiftKey) {
        if (event.key === "ArrowUp" || event.key === "k" || (event.key === "Tab" && event.shiftKey)) {
          event.preventDefault();
          this.clearSelection();
          const focused = this.focusedLine;
          const index = focused ? this.rendered.indexOf(focused) : -1;
          const previous = this.rendered[index - 1];
          if (previous) previous.focusProperty();
          else this.headingEl.focus();
        } else if (event.key === "ArrowDown" || event.key === "j" || (event.key === "Tab" && !event.shiftKey)) {
          event.preventDefault();
          this.clearSelection();
          const focused = this.focusedLine;
          const index = focused ? this.rendered.indexOf(focused) : -1;
          const next = this.rendered[index + 1];
          if (next) next.focusProperty();
          else if (this.addPropertyButtonEl.isShown()) this.addPropertyButtonEl.focus();
          else this.owner.shiftFocusAfter();
        } else if (event.key === "a" && host.Keymap.isModifier(event, "Mod")) {
          event.preventDefault();
          this.selectAll();
        } else if (event.key === "z" && event.shiftKey && host.Keymap.isModifier(event, "Mod")) {
          event.preventDefault();
          this.owner.redo && this.owner.redo();
        } else if (event.key === "z" && host.Keymap.isModifier(event, "Mod")) {
          event.preventDefault();
          this.owner.undo && this.owner.undo();
        } else if (event.key === "Escape" && this.selectedLines.size > 0) {
          event.preventDefault();
          this.clearSelection();
        } else if ((host.Platform.isMacOS && event.key === "Backspace" && event.metaKey) || event.key === "Delete") {
          event.preventDefault();
          const focused = this.focusedLine;
          const targets = Array.from(this.selectedLines);
          if (targets.length === 0 && focused) targets.push(focused);
          this.removeProperties(targets);
          this.clearSelection();
        }
        return;
      }
      event.preventDefault();
      const focused = this.focusedLine;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (focused) {
        const index = this.rendered.indexOf(focused);
        const neighbor = this.rendered[index + direction];
        const bothSelected = this.selectedLines.has(focused) && neighbor && this.selectedLines.has(neighbor);
        if (neighbor) {
          if (bothSelected) this.selectProperty(focused, false);
          else {
            this.selectProperty(focused, true);
            this.selectProperty(neighbor, true);
          }
          neighbor.focusProperty();
        }
      }
    },
    onload() {
      this.registerEvent(this.app.metadataTypeManager.on("changed", this.onMetadataTypeChange, this));
    },
    hasFocus() {
      const active = this.containerEl.doc.activeElement;
      return this.containerEl.contains(active);
    },
    hasPropertyFocused() {
      const active = this.containerEl.doc.activeElement;
      for (const row of this.rendered) {
        if (row.containerEl === active) return true;
      }
      return false;
    },
    showPropertiesMenu(event) {
      const self = this;
      if (this.headingEl.hasClass("has-active-menu")) return;
      const menu = host.Menu.forEvent(event);
      menu.addSections(["title", "action-primary", "action", "action.sort", "", "danger"]);
      menu.setSectionSubmenu("action.sort", { title: host.t.properties.optionSort(), icon: "lucide-sort-asc" });
      menu.addItem((item) => item.setTitle(host.t.commands.addProperty()).onClick(() => self.addProperty()).setSection("action-primary"))
        .addItem((item) => item.setTitle(host.t.commands.labelSortPropertyAToZ()).onClick(() => self.sortProperties()).setSection("action.sort"))
        .addItem((item) => item.setTitle(host.t.commands.labelSortPropertyZToA()).onClick(() => self.sortProperties(true)).setSection("action.sort"))
        .addItem((item) => item.setTitle(host.t.commands.clearProperties()).onClick(() => self.removeProperties(self.rendered)).setSection("danger").setWarning(true));
      this.app.workspace.trigger("markdown-properties-menu", menu, this.owner.getFile());
    },
    toggleCollapse() {
      this.setCollapse(!this.collapsed);
    },
    selectAll() {
      for (const row of this.rendered) this.selectProperty(row, true);
    },
    setCollapse(collapsed, animate) {
      if (animate === undefined) animate = true;
      if (this.collapsed === collapsed) return;
      this.collapsed = collapsed;
      this.containerEl.toggleClass("is-collapsed", this.collapsed);
      this.headingEl.toggleClass("is-collapsed", this.collapsed);
      this.foldEl.toggleClass("is-collapsed", this.collapsed);
      host.collapseElement(this.contentEl, this.collapsed, animate);
      if (animate) this.owner.onMarkdownFold();
    },
    focusPropertyAtIndex(index) {
      const row = this.rendered.at(index);
      if (row) row.focusProperty();
      else if (this.addPropertyButtonEl.isShown()) this.addPropertyButtonEl.focus();
    },
    _copyToClipboard(event, rows) {
      const data = {};
      for (const row of rows) data[row.entry.key] = row.entry.value;
      event.clipboardData.setData("Text", host.yamlStringify(data));
      event.clipboardData.setData("basalt/properties", JSON.stringify(data));
    },
    handleCut(event) {
      if (!this.hasPropertyFocused()) return;
      const targets = Array.from(this.selectedLines);
      if (targets.length === 0 && this.focusedLine) targets.push(this.focusedLine);
      if (targets.length === 0) return;
      event.preventDefault();
      this._copyToClipboard(event, targets);
      this.removeProperties(targets);
    },
    handleCopy(event) {
      if (!this.hasPropertyFocused()) return;
      const targets = Array.from(this.selectedLines);
      if (targets.length === 0 && this.focusedLine) targets.push(this.focusedLine);
      if (targets.length === 0) return;
      event.preventDefault();
      this._copyToClipboard(event, targets);
    },
    insertProperties(properties) {
      const data = this.serialize();
      mergeProperties(data, properties);
      this.synchronize(data);
      this.save();
    },
    handlePaste(event) {
      const raw = event.clipboardData.getData("basalt/properties");
      if (!raw) return;
      event.preventDefault();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (error) {
        console.error(error);
      }
      if (data) this.insertProperties(data);
    },
    handleItemSelection(event, row) {
      const selected = this.selectedLines;
      const focused = this.focusedLine;
      row.focusProperty();
      if (event.altKey && !event.shiftKey) {
        this.selectProperty(row, !selected.has(row));
        return true;
      }
      if (event.shiftKey) {
        if (focused) {
          const range = [this.rendered.indexOf(focused), this.rendered.indexOf(row)].sort(compareIndices);
          const start = range[0];
          const end = range[1];
          const collapse = selected.has(focused) && selected.has(row);
          for (let i = start; i <= end; i++) this.selectProperty(this.rendered[i], !collapse);
        } else {
          this.selectProperty(row, true);
        }
        return true;
      }
      this.clearSelection();
      return false;
    },
    selectProperty(row, selected) {
      if (!row) return;
      if (selected) {
        this.selectedLines.add(row);
        row.setSelected(true);
      } else {
        this.selectedLines.delete(row);
        row.setSelected(false);
      }
    },
    clearSelection() {
      this.selectedLines.forEach((row) => row.setSelected(false));
      this.selectedLines.clear();
    },
    clear() {
      if (this.hasFocus()) host.blurAndClearSelection();
      if (this.hasFocus()) this.containerEl.focus({ preventScroll: true });
      this.selectedLines = new Set();
    },
    focus(options) {
      if (options === undefined) options = { bottom: false };
      if (this.properties.length === 0) return false;
      if (this.collapsed || !options.bottom) this.headingEl.focus();
      else if (this.addPropertyButtonEl.isShown()) this.addPropertyButtonEl.focus();
      else this.focusPropertyAtIndex(-1);
      return true;
    },
    focusProperty(key) {
      const row = this.rendered.find((candidate) => candidate.entry.key === key);
      if (row) {
        if (host.Platform.hasPhysicalKeyboard) row.focusProperty();
        else flashElement(row.containerEl, host);
      }
    },
    focusKey(key) {
      const row = this.rendered.find((candidate) => candidate.entry.key === key);
      if (row) row.focusKey();
    },
    focusValue(key, position) {
      const row = this.rendered.find((candidate) => candidate.entry.key === key);
      if (row) row.focusValue(position);
    },
    onMetadataTypeChange(key) {
      const row = this.rendered.find((candidate) => candidate.entry.key.toLowerCase() === key);
      if (row) row.renderProperty(row.entry, true);
    },
    synchronize(properties) {
      const valid = !!properties;
      const entries = [];
      const rows = [];
      if (properties) {
        for (const key in properties) {
          if (Object.hasOwn(properties, key)) entries.push({ key, value: properties[key] });
        }
      }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        let row = this.rendered.find((candidate) => candidate.entry.key === entry.key);
        if (!row) row = new PropertyRow(this.app, this, entry);
        row.renderProperty(entry);
        rows.push(row);
      }
      const pending = this.rendered.find((row) => row.entry.key === "");
      if (pending) {
        const active = this.containerEl.doc.activeElement;
        if (pending.containerEl.contains(active)) {
          rows.push(pending);
          entries.push(pending.entry);
        }
      }
      this.propertyListEl.setChildrenInPlace(rows.map((row) => row.containerEl));
      this.properties = entries;
      this.rendered = rows;
      this.invalidFrontmatter = !valid;
      this.containerEl.setAttr("data-property-count", this.properties.length);
      this.containerEl.toggleClass("mod-error", !valid);
      this.headingEl.toggle(valid);
      this.addPropertyButtonEl.toggle(valid);
      this.errorEl.toggle(!valid);
      if (!valid && !this.errorEl.firstChild) {
        this.errorEl.createDiv({ cls: "metadata-error-title", text: host.t.properties.labelInvalidHeading() });
        this.errorEl.createDiv("text-icon-button metadata-show-source-button", (button) => {
          button.createSpan({ cls: "text-button-label", text: host.t.properties.labelShowSource() });
          button.addEventListener("click", () => {
            const file = this.owner.getFile();
            let view = this.app.workspace.getActiveFileView();
            if (view.file !== file) {
              const leaf = this.app.workspace.getLeaf();
              leaf.openFile(file);
              view = leaf.view;
            }
            if (view instanceof host.MarkdownView) {
              const state = view.leaf.getViewState();
              state.state.mode = "source";
              view.leaf.setViewState(state, { focus: true, cursor: { from: { line: 0, ch: 0 } } });
            }
          });
        });
      }
    },
    serialize() {
      const data = {};
      for (const property of this.properties) data[property.key] = property.value;
      return data;
    },
    sortProperties(descending) {
      if (descending === undefined) descending = false;
      const data = this.serialize();
      const keys = Object.keys(data);
      if (descending) keys.sort(compareKeysDesc); else keys.sort(compareKeysAsc);
      const sorted = {};
      for (const key of keys) sorted[key] = data[key];
      this.synchronize(sorted);
    },
    addProperty(key) {
      if (key === undefined) key = "";
      if (this.invalidFrontmatter) {
        new host.Notice(host.t.properties.msgInvalidProperties());
        return;
      }
      const data = this.serialize();
      if (!Object.hasOwn(data, key)) {
        data[key] = null;
        this.synchronize(data);
        if (key) this.owner.saveFrontmatter(data);
      }
      if (key) this.focusValue(key, "both");
      else this.focusKey(key);
    },
    removeProperties(rows, refocus) {
      if (refocus === undefined) refocus = true;
      let removedBeforeFocus = 0;
      const focused = this.focusedLine;
      const focusIndex = focused ? this.rendered.indexOf(focused) : -1;
      const data = this.serialize();
      for (const row of rows) {
        if (this.rendered.indexOf(row) <= focusIndex) removedBeforeFocus++;
        delete data[row.entry.key];
      }
      const newFocusIndex = focusIndex - removedBeforeFocus;
      this.synchronize(data);
      if (refocus) {
        if (Object.keys(data).length > 0) this.focusPropertyAtIndex(Math.clamp(newFocusIndex, 0, this.rendered.length - 1));
        else this.owner.shiftFocusAfter();
      }
      this.owner.saveFrontmatter(data);
    },
    save() {
      const data = this.serialize();
      this.owner.saveFrontmatter(data);
    },
    reorderKey(entry, targetIndex) {
      const data = this.serialize();
      delete data[entry.key];
      const reordered = {};
      const keys = Object.keys(data);
      for (let i = 0; i < keys.length; i++) {
        if (i === targetIndex) reordered[entry.key] = entry.value;
        const key = keys[i];
        reordered[key] = data[key];
      }
      if (targetIndex >= keys.length) reordered[entry.key] = entry.value;
      this.owner.saveFrontmatter(reordered);
    },
  });

  built = { PropertyKeySuggest, PropertyRow, MetadataEditor };
  cache.set(host, built);
  return built;
}

export function definePropertyKeySuggest(host) {
  return build(host).PropertyKeySuggest;
}

export function definePropertyRow(host) {
  return build(host).PropertyRow;
}

export function defineMetadataEditor(host) {
  return build(host).MetadataEditor;
}
