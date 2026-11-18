// The find bar of the reading view ("document-search"): a scope-bound search input with match count,
// prev/next buttons and highlight ranges handed to the preview renderer.
import { makeHotkey } from "./text.js";

export function defineDocumentSearch(host) {
  /** `parentScope` seeds the key scope, `renderer` is the MarkdownPreviewRenderer, `containerEl` the
   *  element the bar is prepended to, `onClose` runs when the bar closes. */
  function DocumentSearch(parentScope, renderer, containerEl, onClose) {
    this.scope = null;
    this.searchContainerEl = null;
    this.searchInputEl = null;
    this.lastQuery = null;
    this.highlightRanges = null;
    this.selectedRange = -1;
    this.lastText = null;
    this.renderer = renderer;
    this.onClose = onClose;

    const scope = (this.scope = new host.Scope(parentScope));
    const box = (this.searchContainerEl = containerEl.createDiv({ cls: "document-search-container", prepend: true })).createDiv("document-search");
    const inputWrap = box.createDiv("search-input-container document-search-input");
    const input = (this.searchInputEl = inputWrap.createEl("input", {
      type: "text",
      placeholder: host.t.editor.search.placeholderFind(),
    }));
    this.countEl = inputWrap.createDiv("document-search-count");
    input.addEventListener("input", host.debounce(this.onSearchInput.bind(this), 150, true));
    input.addEventListener("keydown", (event) => {
      if (!event.isComposing && !host.Platform.hasPhysicalKeyboard && event.key === "Enter") {
        event.preventDefault();
        host.blurAndClearSelection();
      }
    });

    const buttons = box.createDiv({ cls: "document-search-buttons", type: "text" });
    buttons.createEl("button", { cls: "clickable-icon document-search-button" }, (el) => {
      host.setIcon(el, "lucide-arrow-up");
      host.setTooltip(el, host.t.editor.search.labelPrevious() + "\n" + host.formatHotkey(makeHotkey(["Shift"], "F3")), { placement: "top" });
      el.addEventListener("mousedown", (event) => event.preventDefault());
      el.addEventListener("click", (event) => { event.preventDefault(); this.findPrevious(); });
    });
    buttons.createEl("button", { cls: "clickable-icon document-search-button" }, (el) => {
      host.setIcon(el, "lucide-arrow-down");
      host.setTooltip(el, host.t.editor.search.labelNext() + "\n" + host.formatHotkey(makeHotkey([], "F3")), { placement: "top" });
      el.addEventListener("mousedown", (event) => event.preventDefault());
      el.addEventListener("click", (event) => { event.preventDefault(); this.findNext(); });
    });
    box.createDiv("clickable-icon document-search-close-button", (el) => {
      host.setIcon(el, "lucide-x");
      host.setTooltip(el, host.t.editor.search.labelExitSearch(), { placement: "top" });
      el.addEventListener("click", (event) => { event.preventDefault(); this.close(); });
    });

    scope.register([], "F3", this.findNext.bind(this));
    scope.register(["Mod"], "G", this.findNext.bind(this));
    scope.register(["Shift"], "F3", this.findPrevious.bind(this));
    scope.register(["Mod", "Shift"], "G", this.findPrevious.bind(this));
    scope.register([], "Enter", this.onEnter.bind(this));
    scope.register(["Shift"], "Enter", this.onShiftEnter.bind(this));
    scope.register([], "Escape", this.close.bind(this));

    const selection = activeWindow.getSelection().toString();
    if (selection) input.value = selection;
    this.updateQuery();
    this.updateCount();
  }

  DocumentSearch.prototype.close = function () {
    const box = this.searchContainerEl;
    const input = this.searchInputEl;
    box.detach();
    input.value = "";
    input.removeClass("mod-no-match");
    this.updateQuery();
    this.onClose();
  };

  /** Recomputes the highlight ranges for the current query; re-renders the preview when the text or query changed. */
  DocumentSearch.prototype.updateQuery = function () {
    const query = this.getQuery().toLowerCase();
    const renderer = this.renderer;
    const input = this.searchInputEl;
    const text = renderer.lastText;
    const effective = query ? text : null;
    const textChanged = this.lastText !== effective;
    const queryChanged = this.lastQuery !== query;
    if (textChanged) this.lastText = effective;
    if (queryChanged) {
      this.lastQuery = query;
      this.selectedRange = -1;
    }
    if (!textChanged && !queryChanged) return;
    input.removeClass("mod-no-match");
    const sections = renderer.sections;
    for (let i = 0; i < sections.length; i++) sections[i].highlightRanges = null;
    renderer.queueRender();
    if (!query) {
      this.highlightRanges = null;
      return;
    }
    const ranges = [];
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const textNodes = [];
      host.textNodes(section.el, textNodes);
      const haystack = textNodes.map((node) => node.textContent).join("").toLowerCase();
      const sectionRanges = [];
      let at = 0;
      while ((at = haystack.indexOf(query, at)) !== -1) {
        const end = at + query.length;
        const range = { section, start: at, end, active: false };
        sectionRanges.push(range);
        ranges.push(range);
        at = end;
      }
      if (sectionRanges.length > 0) section.highlightRanges = sectionRanges;
    }
    this.highlightRanges = ranges;
    input.toggleClass("mod-no-match", ranges.length === 0);
  };

  DocumentSearch.prototype.updateCount = function () {
    const total = (this.highlightRanges && this.highlightRanges.length) || 0;
    this.countEl.toggle(!!this.getQuery());
    this.countEl.setText((this.selectedRange + 1) + " / " + total);
  };

  DocumentSearch.prototype.onSearchInput = function () {
    this.updateQuery();
    this.selectRange(0);
    this.updateCount();
  };

  DocumentSearch.prototype.findNext = function () {
    this.selectRange(this.selectedRange + 1);
    this.updateCount();
  };

  DocumentSearch.prototype.findPrevious = function () {
    this.selectRange(this.selectedRange - 1);
    this.updateCount();
  };

  /** Wraps the selection around the match list and asks the renderer to scroll it into view. */
  DocumentSearch.prototype.selectRange = function (index) {
    const ranges = this.highlightRanges;
    if (!ranges || ranges.length === 0) return;
    if (index > ranges.length - 1) index = 0;
    if (index < 0) index = ranges.length - 1;
    const previous = ranges[this.selectedRange];
    if (previous) previous.active = false;
    this.selectedRange = index;
    const current = ranges[this.selectedRange];
    current.active = true;
    this.renderer.selectRange(current);
  };

  DocumentSearch.prototype.getQuery = function () { return this.searchInputEl.value; };

  DocumentSearch.prototype.onEnter = function (event) {
    if (!event.isComposing && this.searchInputEl.isActiveElement()) this.findNext();
  };

  DocumentSearch.prototype.onShiftEnter = function (event) {
    if (!event.isComposing && this.searchInputEl.isActiveElement()) this.findPrevious();
  };

  return DocumentSearch;
}
