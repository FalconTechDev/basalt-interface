// The suggestion widgets of the plugin API: the list controller with keyboard / mouse handling (SuggestionList), SuggestModal and
// FuzzySuggestModal (quick-switcher style dialogs), PopoverSuggest and its two users, AbstractInputSuggest (drop-down under a text
// field) and EditorSuggest (drop-down at the cursor of an editor).
import { inherit } from "./inherit.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { renderResults } from "./search-simple.js";
import { sortHitsByScore } from "./misc.js";
import { runTransition } from "./animation.js";

const SUGGESTION_LIMIT = 100;

export function defineSuggestionList(host) {
  /**
   * Shows `values` as `.suggestion-item` rows in `containerEl` (rendered by `chooser.renderSuggestion(value, el)`), keeps one row
   * selected, and registers the navigation keys (arrows, page up / down, home / end, enter) on `scope`.
   */
  function SuggestionList(chooser, containerEl, scope) {
    this.selectOnHover = true;
    this.chooser = chooser;
    this.containerEl = containerEl;
    this.values = [];
    this.suggestions = [];
    this.selectedItem = 0;
    containerEl.on("click", ".suggestion-item", this.onSuggestionClick.bind(this));
    containerEl.on("auxclick", ".suggestion-item", this.onSuggestionClick.bind(this));
    containerEl.on("mousemove", ".suggestion-item", this.onSuggestionMouseover.bind(this));
    this.moveUp = this.moveUp.bind(this);
    this.moveDown = this.moveDown.bind(this);
    scope.register([], "ArrowUp", this.moveUp);
    scope.register([], "ArrowDown", this.moveDown);
    scope.register([], "PageUp", this.pageUp.bind(this));
    scope.register([], "PageDown", this.pageDown.bind(this));
    scope.register([], "Home", (event) => { this.setSelectedItem(0, event); return false; });
    scope.register([], "End", (event) => { this.setSelectedItem(this.suggestions.length - 1, event); return false; });
    if (host.Platform.isMacOS || host.Platform.isIosApp) {
      scope.register(["Ctrl"], "p", this.moveUp);
      scope.register(["Ctrl"], "n", this.moveDown);
    }
    scope.register([], "Enter", (event) => {
      if (event.isComposing) return undefined;
      this.useSelectedItem(event);
      return false;
    });
  }
  const proto = SuggestionList.prototype;

  proto.getSelectedElement = function () {
    const el = this.suggestions[this.selectedItem];
    return el !== null && el !== undefined ? el : null;
  };
  proto.getSelectedValue = function () {
    const value = this.values[this.selectedItem];
    return value !== null && value !== undefined ? value : null;
  };
  proto.moveUp = function (event) {
    if (event.isComposing) return undefined;
    this.setSelectedItem(this.selectedItem - 1, event);
    return false;
  };
  proto.moveDown = function (event) {
    if (event.isComposing) return undefined;
    this.setSelectedItem(this.selectedItem + 1, event);
    return false;
  };
  Object.defineProperty(proto, "rowHeight", {
    get() { return this.suggestions[this.selectedItem].clientHeight; },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(proto, "numVisibleItems", {
    get() { return Math.floor(this.containerEl.clientHeight / this.rowHeight); },
    enumerable: false,
    configurable: true,
  });

  /** Index of the first row that is (at least partly) scrolled into view. */
  proto.firstVisibleIndex = function () {
    const { containerEl, rowHeight } = this;
    const scrolled = containerEl.scrollTop - parseFloat(getComputedStyle(containerEl).paddingTop);
    return Math.floor(scrolled / rowHeight);
  };

  proto.pageUp = function (event) {
    if (event.isComposing) return undefined;
    let target = this.firstVisibleIndex();
    if (this.selectedItem <= target) target -= this.numVisibleItems;
    this.setSelectedItem(Math.max(0, target), event);
    return false;
  };

  proto.pageDown = function (event) {
    if (event.isComposing) return undefined;
    const visible = this.numVisibleItems;
    let target = this.firstVisibleIndex() + (visible - 1);
    if (this.selectedItem >= target) target += visible;
    this.setSelectedItem(Math.min(this.suggestions.length - 1, target), event);
    return false;
  };

  proto.renderSuggestions = function () {
    const containerEl = this.containerEl;
    containerEl.empty();
    const rows = [];
    if (this.values) {
      for (const value of this.values) {
        const row = containerEl.createDiv("suggestion-item");
        this.chooser.renderSuggestion(value, row);
        rows.push(row);
      }
    }
    const selected = rows[this.selectedItem];
    if (selected) selected.addClass("is-selected");
    this.suggestions = rows;
  };

  proto.setSuggestions = function (values) {
    this.values = values;
    this.renderSuggestions();
    this.setSelectedItem(0, null);
  };

  proto.addSuggestion = function (value) {
    const { values, suggestions } = this;
    if (!values) return;
    const row = this.containerEl.createDiv("suggestion-item");
    this.chooser.renderSuggestion(value, row);
    values.push(value);
    suggestions.push(row);
  };

  proto.addMessage = function (text) {
    return this.containerEl.createDiv({ cls: "suggestion-empty", text });
  };

  proto.shouldSelectOnHover = function (select) { this.selectOnHover = select; return this; };

  /** Selects row `index` (wraps around at both ends). */
  proto.setSelectedItem = function (index, event) {
    const rows = this.suggestions;
    if (rows.length === 0) return;
    if (index < 0) index = rows.length - 1;
    else if (index >= rows.length) index = 0;
    this.forceSetSelectedItem(index, event);
  };

  proto.forceSetSelectedItem = function (index, event) {
    const rows = this.suggestions;
    const previous = rows[this.selectedItem];
    if (previous) previous.removeClass("is-selected");
    this.selectedItem = index;
    const row = rows[this.selectedItem];
    if (row) {
      row.addClass("is-selected");
      // mouse movement must not scroll the list under the pointer
      if (!event || event.instanceOf(KeyboardEvent)) row.scrollIntoView({ block: "nearest" });
    }
    const notify = this.chooser.onSelectedChange;
    if (notify) notify.call(this.chooser, this.values[index], event);
  };

  proto.onSuggestionClick = function (event, row) {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.setSelectedItem(this.suggestions.indexOf(row), event);
    this.useSelectedItem(event);
  };

  proto.onSuggestionMouseover = function (event, row) {
    if (this.selectOnHover) this.setSelectedItem(this.suggestions.indexOf(row), event);
  };

  /** Chooses the selected value (calls chooser.selectSuggestion); false when there is none. */
  proto.useSelectedItem = function (event) {
    if (!this.values) return false;
    const value = this.values[this.selectedItem];
    if (value === undefined) return false;
    this.chooser.selectSuggestion(value, event);
    return true;
  };

  return SuggestionList;
}

export function defineGroupedSuggestionList(host) {
  /** A SuggestionList whose values carry a `group`: consecutive values of one group share a `.suggestion-group` box. */
  function GroupedSuggestionList() {
    return host.SuggestionList.apply(this, arguments) || this;
  }
  inherit(GroupedSuggestionList, host.SuggestionList);
  GroupedSuggestionList.prototype.setSuggestions = function (values) {
    const containerEl = this.containerEl;
    containerEl.empty();
    const rows = [];
    if (values) {
      let lastGroup = null;
      let groupEl;
      for (const value of values) {
        if (!(groupEl && value.group === lastGroup)) {
          groupEl = containerEl.createDiv({ cls: "suggestion-group", attr: { "data-group": value.group } });
        }
        const row = groupEl.createDiv("suggestion-item");
        this.chooser.renderSuggestion(value, row);
        rows.push(row);
        lastGroup = value.group;
      }
    }
    const selected = rows[this.selectedItem];
    if (selected) selected.addClass("is-selected");
    this.values = values;
    this.suggestions = rows;
    this.setSelectedItem(0, null);
  };
  return GroupedSuggestionList;
}

export function defineSuggestModal(host) {
  /**
   * A dialog with a text field and a list of suggestions for what was typed. Subclasses implement getSuggestions(query),
   * renderSuggestion(value, el) and onChooseSuggestion(value, event).
   */
  function SuggestModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.limit = SUGGESTION_LIMIT;
    self.emptyStateText = host.t.setting.thirdPartyPlugin.labelNoResultsFound();
    self.isOpen = false;
    self.inputEl = null;
    self.clearButtonEl = null;
    self.ctaEl = null;
    self.resultContainerEl = null;
    self.instructionsEl = createDiv("prompt-instructions");

    const modalEl = self.modalEl;
    modalEl.removeClass("modal");
    modalEl.addClass("prompt");
    modalEl.empty();
    modalEl.createDiv("prompt-input-container", (container) => {
      if (host.Platform.isPhone) container.addClass("mod-raised");
      const input = (self.inputEl = container.createEl("input", {
        cls: "prompt-input",
        type: "text",
        attr: { autocapitalize: "off", spellcheck: "false", enterkeyhint: host.Platform.isAndroidApp ? "enter" : "done" },
      }));
      self.ctaEl = container.createDiv("prompt-input-cta");
      self.clearButtonEl = container.createDiv("search-input-clear-button", (button) => {
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          // first click empties the field, a click on the empty field closes the dialog
          if (input.value !== "") {
            input.value = "";
            input.trigger("input");
          } else {
            self.close();
          }
        });
      });
    });
    self.resultContainerEl = modalEl.createDiv("prompt-results");
    self.chooser = new host.SuggestionList(self, self.resultContainerEl, self.scope);
    self.inputEl.addEventListener("input", self.onInput.bind(self));
    return self;
  }
  inherit(SuggestModal, host.Modal);
  const proto = SuggestModal.prototype;

  proto.setPlaceholder = function (text) { this.inputEl.placeholder = text; };

  /** `instructions`: [{ command, purpose }] shown as a key legend below the list. */
  proto.setInstructions = function (instructions) {
    if (instructions.length > 0) {
      host.renderInstructions(this.instructionsEl, instructions);
      this.modalEl.appendChild(this.instructionsEl);
    } else {
      this.instructionsEl.detach();
    }
  };

  proto.onOpen = function () {
    const input = this.inputEl;
    this.isOpen = true;
    input.value = "";
    input.focus();
    this.updateSuggestions();
  };

  proto.onInput = function () { this.updateSuggestions(); };

  /** Asks getSuggestions for the current text (it may return a promise) and shows the first `limit` results. */
  proto.updateSuggestions = function () {
    const result = this.getSuggestions(this.inputEl.value);
    const show = (values) => {
      if (!values || values.length === 0) {
        this.onNoSuggestion();
        return;
      }
      const limit = this.limit;
      if (limit && limit > 0) values = values.slice(0, limit);
      this.chooser.setSuggestions(values);
    };
    if (Array.isArray(result)) show(result);
    else (async () => { show(await result); })();
  };

  proto.onNoSuggestion = function () {
    this.chooser.setSuggestions(null);
    this.chooser.addMessage(this.emptyStateText);
  };

  proto.selectSuggestion = function (value, event) {
    this.app.keymap.updateModifiers(event);
    this.close();
    this.isOpen = false;
    this.onChooseSuggestion(value, event);
  };

  proto.selectActiveSuggestion = function (event) { this.chooser.useSelectedItem(event); };

  return SuggestModal;
}

export function defineFuzzySuggestModal(host) {
  /** A SuggestModal over a fixed list of items (getItems) that are fuzzy-matched against getItemText. */
  function FuzzySuggestModal() {
    return host.SuggestModal.apply(this, arguments) || this;
  }
  inherit(FuzzySuggestModal, host.SuggestModal);
  const proto = FuzzySuggestModal.prototype;

  proto.sortSuggestions = function (results) { sortHitsByScore(results); };

  proto.getSuggestions = function (query) {
    query = query.trim();
    const prepared = prepareQuery(query);
    const results = [];
    for (const item of this.getItems()) {
      const match = fuzzyMatchJs(prepared, this.getItemText(item));
      if (match) results.push({ match, item });
    }
    this.sortSuggestions(results);
    return results;
  };

  proto.renderSuggestion = function (result, el) {
    renderResults(el, this.getItemText(result.item), result.match);
  };

  proto.onChooseSuggestion = function (result, event) {
    this.onChooseItem(result.item, event);
  };

  return FuzzySuggestModal;
}

export function definePopoverSuggest(host) {
  /** A floating suggestion list (not a dialog): positioned by the subclass, with its own key scope. */
  function PopoverSuggest(app, scope) {
    this.isOpen = false;
    this.app = app;
    this.scope = new host.Scope(scope || app.scope);
    this.suggestEl = createDiv("suggestion-container");
    const inner = (this.suggestInnerEl = this.suggestEl.createDiv("suggestion"));
    this.suggestions = new host.SuggestionList(this, inner, this.scope);
    this.scope.register([], "Escape", (event) => {
      this.onEscapeKey(event);
      return false;
    });
  }
  const proto = PopoverSuggest.prototype;

  proto.onEscapeKey = function () { this.close(); };

  proto.attachDom = function () {
    const el = this.suggestEl;
    activeDocument.body.appendChild(el);
    runTransition(el, new host.Transition({ fn: "var(--anim-motion-swing)", duration: 80 }).addProp("opacity", "0", "1", ""));
  };

  proto.detachDom = function () { this.suggestEl.detach(); };

  proto.open = function () {
    if (this.isOpen) return;
    this.isOpen = true;
    this.app.keymap.pushScope(this.scope);
    this.attachDom();
    host.registerOpenModal(this);
  };

  proto.close = function () {
    if (this.autoDestroy) {
      this.autoDestroy();
      this.autoDestroy = null;
    }
    this.app.keymap.popScope(this.scope);
    if (this.isOpen) {
      this.isOpen = false;
      this.suggestions.setSuggestions([]);
      this.detachDom();
      host.unregisterOpenModal(this);
    }
  };

  /** Places the popover next to `rect` (a client rect), left-aligned unless the text direction (or `alignment` "rtl") says right. */
  proto.reposition = function (rect, alignment = "auto") {
    const el = this.suggestEl;
    host.positionNear(rect, el, {
      gap: 5,
      preventOverlap: true,
      horizontalAlignment: { rtl: "right", ltr: "left", auto: getComputedStyle(el).direction === "rtl" ? "right" : "left" }[alignment],
    });
  };

  /** Closes the popover when `el` leaves the screen (checked twice a second). */
  proto.setAutoDestroy = function (el) {
    if (this.autoDestroy) this.autoDestroy();
    if (el) this.autoDestroy = host.watchElementGone(el, 500, () => { this.close(); });
  };

  return PopoverSuggest;
}

export function defineAbstractInputSuggest(host) {
  /** Suggestions under a text field (an <input> or a contenteditable); subclasses implement getSuggestions / renderSuggestion. */
  function AbstractInputSuggest(app, textInputEl) {
    const self = host.PopoverSuggest.call(this, app) || this;
    self.limit = SUGGESTION_LIMIT;
    self.textInputEl = textInputEl;
    self.autoReposition = self.autoReposition.bind(self);
    textInputEl.addEventListener("input", self.onInputChange.bind(self));
    textInputEl.addEventListener("focus", self.onInputFocus.bind(self));
    textInputEl.addEventListener("blur", self.close.bind(self));
    // clicking a suggestion must not blur the field first
    self.suggestEl.on("mousedown", ".suggestion-item", (event) => { event.preventDefault(); });
    return self;
  }
  inherit(AbstractInputSuggest, host.PopoverSuggest);
  const proto = AbstractInputSuggest.prototype;

  proto.showSuggestions = function (values) {
    const input = this.textInputEl;
    if (values.length === 0) {
      this.close();
      return;
    }
    if (!input.isShown()) return;
    const limit = this.limit;
    if (limit > 0 && values.length > limit) values = values.slice(0, limit);
    this.suggestions.setSuggestions(values);
    this.open();
    this.setAutoDestroy(input);
  };

  proto.setValue = function (text) {
    if (this.textInputEl.instanceOf(HTMLInputElement)) this.textInputEl.value = text;
    else this.textInputEl.innerText = text;
  };

  proto.getValue = function () {
    return this.textInputEl.instanceOf(HTMLInputElement) ? this.textInputEl.value : this.textInputEl.innerText;
  };

  proto.onInputFocus = function () {
    // iOS only reports the final field content on the next frame
    if (host.Platform.isIosApp) host.nextFrame(() => this.onInputChange());
    else this.onInputChange();
  };

  proto.onInputChange = function () {
    if (!this.textInputEl.isActiveElement()) return;
    const result = this.getSuggestions(this.getValue());
    if (Array.isArray(result)) {
      this.showSuggestions(result);
    } else if (result) {
      (async () => { this.showSuggestions(await result); })();
    }
  };

  proto.selectSuggestion = function (value, event) {
    if (this.selectCb) this.selectCb.call(this, value, event);
  };

  proto.onSelect = function (callback) { this.selectCb = callback; return this; };

  proto.close = function () {
    host.PopoverSuggest.prototype.close.call(this);
    this.textInputEl.doc.removeEventListener("scroll", this.autoReposition);
  };

  proto.reposition = function (rect) {
    host.PopoverSuggest.prototype.reposition.call(this, rect);
    this.lastRect = rect;
  };

  proto.open = function () {
    host.PopoverSuggest.prototype.open.call(this);
    const input = this.textInputEl;
    const rect = host.rectInTopWindow(input.getBoundingClientRect(), input.win).rect;
    this.reposition(rect);
    // keep the list attached to the field while anything scrolls
    input.doc.addEventListener("scroll", this.autoReposition, { capture: true, passive: true });
  };

  proto.autoReposition = function () {
    const last = this.lastRect;
    const input = this.textInputEl;
    const rect = host.rectInTopWindow(input.getBoundingClientRect(), input.win).rect;
    const unchanged = rect.bottom === last.bottom && rect.top === last.top && rect.left === last.left && rect.right === last.right;
    if (!unchanged) this.reposition(rect);
  };

  return AbstractInputSuggest;
}

export function defineEditorSuggest(host) {
  /** Suggestions at the cursor of an editor, triggered by text before the cursor (onTrigger decides); used for [[links]], #tags ... */
  function EditorSuggest(app) {
    const self = host.PopoverSuggest.call(this, app) || this;
    self.instructionsEl = createDiv("prompt-instructions");
    self.context = null;
    self.limit = SUGGESTION_LIMIT;
    self.suggestEl.addEventListener("mousedown", (event) => event.preventDefault());
    return self;
  }
  inherit(EditorSuggest, host.PopoverSuggest);
  const proto = EditorSuggest.prototype;

  proto.setInstructions = function (instructions) {
    if (instructions.length > 0) {
      host.renderInstructions(this.instructionsEl, instructions);
      this.suggestEl.appendChild(this.instructionsEl);
    } else {
      this.instructionsEl.detach();
    }
  };

  /**
   * Called by the editor on every change: returns true when this suggest is (still) active for the cursor position. A selection
   * (non-empty range) never triggers. With `forceOpen` (or when already open) suggestions are computed and shown.
   */
  proto.trigger = function (editor, file, forceOpen) {
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    if (from.line !== to.line || from.ch !== to.ch) {
      this.context = null;
      return false;
    }
    const hit = this.onTrigger(from, editor, file);
    if (!hit) {
      this.context = null;
      return false;
    }
    const context = (this.context = { editor, file, start: hit.start, end: hit.end, query: hit.query });
    if (forceOpen || this.isOpen) {
      const result = this.getSuggestions(context);
      if (Array.isArray(result)) {
        this.showSuggestions(result);
      } else {
        if (!result) return undefined;
        (async () => {
          const values = await result;
          // the answer may arrive after the editor lost focus
          if (editor.hasFocus()) { if (values) this.showSuggestions(values); }
          else this.close();
        })();
      }
    }
    return true;
  };

  proto.showSuggestions = function (values) {
    if (values.length === 0) {
      this.close();
      return;
    }
    const limit = this.limit;
    if (limit > 0 && values.length > limit) values = values.slice(0, limit);
    this.suggestions.setSuggestions(values);
    this.updatePosition(true);
  };

  /** Places the list under the trigger text (the rectangle spanned by context.start .. context.end). */
  proto.updatePosition = function () {
    const context = this.context;
    if (!context) return;
    const editor = context.editor;
    const start = editor.coordsAtPos(context.start);
    const end = editor.coordsAtPos(context.end);
    if (!start || !end) return;
    const rect = host.rectInTopWindow(
      { top: start.top, left: Math.min(start.left, end.left), right: Math.max(start.right, end.right), bottom: end.bottom },
      editor.containerEl.win,
    ).rect;
    this.open();
    this.reposition(rect, host.textDirection(editor.getLine(context.start.line)));
  };

  proto.close = function () {
    this.context = null;
    host.PopoverSuggest.prototype.close.call(this);
  };

  return EditorSuggest;
}
