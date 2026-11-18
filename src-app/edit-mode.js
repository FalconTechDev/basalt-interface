import { inherit, methods } from "./inherit.js";

// MarkdownEditMode (j6): the "source" edit mode of a MarkdownView. Extends
// the edit-mode base (aZ) and wires the mode into the view: inline title,
// properties editor and backlinks elements are reparented into the editor
// sizer on show(); ephemeral cursor/scroll/property-match state; fold info
// including the properties block; live-preview properties extension;
// bottom padding for the backlinks pane and mobile keyboard/toolbar.

// doc offset -> {line, ch} (0-based line).
function offsetToPos(doc, offset) {
  offset = Math.clamp(offset, 0, doc.length);
  const line = doc.lineAt(offset);
  return { line: line.number - 1, ch: offset - line.from };
}

// Character offsets (from search matches) -> editor positions.
function offsetsToRanges(text, offsets) {
  const result = [];
  let line = 0;
  let lineStart = 0;
  let newline = text.indexOf("\n");
  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i];
    while (newline < offset) {
      if (newline === -1) {
        newline = text.length;
        break;
      }
      line++;
      lineStart = newline + 1;
      newline = text.indexOf("\n", lineStart);
    }
    result.push({ line, ch: offset - lineStart });
  }
  return result;
}

// Any transaction in the list carries the given effect?
function transactionHasEffect(transactions, effect) {
  return transactions.some((tr) => tr.effects.some((e) => e.is(effect)));
}

// parseFloat with fallback for CSS custom properties.
function cssPixels(value, fallback) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
}

export function defineMarkdownEditMode(host) {
  function MarkdownEditMode(view) {
    const self = host.EditModeBase.call(this, view.app, view.contentEl, view) || this;
    self.type = "source";
    self.requestOnInternalDataChange = host.debounce(() => self.view.onInternalDataChange(), 10);
    self.requestSaveFolds = host.debounce(() => self.view.onMarkdownFold(), 500);
    self.view = view;
    self.app = view.app;
    self.search.applyScope = (scope) => {
      self.view.scope = scope;
    };
    view.addChild(self);
    self.updateReadableLineLength();
    self.updateOptions();
    self.cm.scrollDOM.addEventListener("contextmenu", (event) => {
      if (event.defaultPrevented || !event.isTrusted || (event instanceof PointerEvent && event.pointerType === "touch")) return;
      const target = event.targetNode;
      if (!self.sizerEl.contains(target) || target.parentElement.closest(".cm-gutters")) return;
      self.app.workspace.trigger("markdown-viewport-menu", host.Menu.forEvent(event).addSections(["view", ""]), view, "source", "gutter");
    });
    return self;
  }
  inherit(MarkdownEditMode, host.EditModeBase);
  methods(MarkdownEditMode, {
    show() {
      host.EditModeBase.prototype.show.call(this);
      this.sizerEl.prepend(this.view.metadataEditor.containerEl);
      this.sizerEl.prepend(this.view.inlineTitleEl);
      this.sizerEl.appendChild(this.view.backlinksEl);
    },
    set(content, ...rest) {
      host.EditModeBase.prototype.set.call(this, content, ...rest);
    },
    clear() {
      host.EditModeBase.prototype.clear.call(this);
      this.propertiesExtension = null;
    },
    destroy() {
      host.EditModeBase.prototype.destroy.call(this);
      this.propertiesExtension = null;
    },
    getSelection() {
      return this.editor.getSelection();
    },
    beforeUnload() {
      this.requestOnInternalDataChange.cancel();
      this.requestSaveFolds.run();
      this.saveHistory();
    },
    getEphemeralState(state) {
      const cm = this.cm;
      const doc = cm.state.doc;
      const anchor = offsetToPos(doc, cm.state.selection.main.anchor);
      const head = offsetToPos(doc, cm.state.selection.main.head);
      state.cursor = { from: { line: anchor.line, ch: anchor.ch }, to: { line: head.line, ch: head.ch } };
    },
    setEphemeralState(state) {
      this.setState(state);
      this.setHighlight(state);
    },
    setState(state) {
      const editor = this.editor;
      const cursor = state.cursor;
      const scroll = editor.getScrollInfo();
      let focus = state.focus && (!host.Platform.isMobile || state.focusOnMobile);
      if (cursor && cursor.from) {
        if (host.Platform.isDesktop) focus = true;
        editor.setSelection(cursor.from, cursor.to);
        editor.scrollTo(scroll.left, scroll.top);
      }
      if (state.focusMetadata) {
        const metadataEditor = this.view.metadataEditor;
        if (this.view.canShowProperties() && metadataEditor && metadataEditor.properties.length > 0) {
          metadataEditor.focus();
          focus = false;
        } else {
          focus = true;
        }
      }
      if (focus) this.focus();
      if (state.hasOwnProperty("scroll")) this.applyScroll(state.scroll);
    },
    handleScroll() {
      host.EditModeBase.prototype.handleScroll.call(this);
      if (this.app.mobileNavbar) this.app.mobileNavbar.onScroll(this.cm.scrollDOM, this.getScroll());
    },
    setHighlight(state) {
      const self = this;
      const editor = this.editor;
      if (state.startLoc !== undefined && state.endLoc !== undefined) {
        const from = { line: state.startLoc.line, ch: state.startLoc.col };
        const to = state.endLoc
          ? { line: state.endLoc.line, ch: state.endLoc.col }
          : { line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length };
        this.highlightSearchMatches([{ from, to }]);
        this.isScrolling = true;
        this.onScroll();
      } else if (state.line !== undefined && state.line >= 0) {
        const line = state.line;
        const from = { line, ch: 0 };
        const to = { line, ch: editor.getLine(line).length };
        editor.setSelection(to, to);
        this.highlightSearchMatches([{ from, to }]);
        this.isScrolling = true;
        this.onScroll();
      } else if (state.propertyMatches !== undefined) {
        const matches = state.propertyMatches;
        if (matches.length > 0) {
          if (this.app.vault.getConfig("propertiesInDocument") === "hidden" || this.view.canShowProperties()) {
            (async () => {
              const plugin = await host.propertiesPlugin(this.app);
              if (plugin) plugin.focusProperty(matches[0].key);
            })();
          } else {
            editor.setSelection({ line: 0, ch: 0 });
            this.isScrolling = true;
            this.onScroll();
          }
        }
      } else if (state.match !== undefined) {
        const match = state.match;
        const flat = [];
        for (const m of match.matches) flat.push(m[0], m[1]);
        const positions = offsetsToRanges(match.content, flat);
        const ranges = [];
        for (let i = 0; i < match.matches.length; i++) {
          ranges.push({ from: positions[i * 2], to: positions[i * 2 + 1] });
        }
        this.highlightSearchMatches(ranges);
        this.isScrolling = true;
        this.onScroll();
      }
    },
    highlightSearchMatches(ranges, scroll, moveCursor, flash) {
      if (scroll === undefined) scroll = true;
      if (moveCursor === undefined) moveCursor = true;
      if (flash === undefined) flash = true;
      const editor = this.editor;
      if (ranges.length !== 0) {
        editor.addHighlights(ranges, "is-flashing", flash, true);
        const first = ranges[0];
        if (moveCursor) editor.setCursor(first.from);
        if (scroll) editor.scrollIntoView({ from: first.to, to: first.from }, true);
      } else {
        editor.removeHighlights("is-flashing");
      }
    },
    getFoldInfo() {
      const base = host.EditModeBase.prototype.getFoldInfo.call(this);
      let folds = base && base.folds ? base.folds : [];
      const lines = base && base.lines !== undefined ? base.lines : this.editor.lineCount();
      const metadataEditor = this.view.metadataEditor;
      if (this.view.canShowProperties() && metadataEditor.properties.length > 0) {
        folds = folds.filter((fold) => fold.from !== 0);
        if (metadataEditor.collapsed) folds.unshift({ from: 0, to: 0 });
      }
      return { folds, lines };
    },
    getDynamicExtensions() {
      const extensions = host.EditModeBase.prototype.getDynamicExtensions.call(this);
      if (!this.sourceMode) {
        let propertiesExtension = this.propertiesExtension;
        if (!propertiesExtension) {
          propertiesExtension = this.propertiesExtension = host.propertiesExtensionFactory(this, this.view);
        }
        extensions.push(propertiesExtension);
      }
      return extensions;
    },
    onUpdate(update, isUserEvent) {
      host.EditModeBase.prototype.onUpdate.call(this, update, isUserEvent);
      const transactions = update.transactions;
      if (isUserEvent) {
        this.view.requestSave();
        this.requestSaveFolds();
        this.requestOnInternalDataChange();
      }
      if (transactionHasEffect(transactions, host.cmFoldEffect) || transactionHasEffect(transactions, host.cmUnfoldEffect)) {
        this.requestSaveFolds();
      }
    },
    onResize() {
      host.EditModeBase.prototype.onResize.call(this);
      const container = this.containerEl;
      if (container.offsetParent) this.updateBottomPadding(container.clientHeight);
    },
    updateBottomPadding(height) {
      const backlinksEl = this.view.backlinksEl;
      let padding = Math.round(height / 2) + "px";
      if (host.Platform.isMobile) {
        const keyboardHeight = cssPixels(document.documentElement.getCssPropertyValue("--keyboard-height"), 0);
        const toolbarHeight = this.app.mobileToolbar.isVisible
          ? cssPixels(document.body.getCssPropertyValue("--mobile-toolbar-height"), 0)
          : 0;
        padding = Math.round((height + keyboardHeight + toolbarHeight) / 2) + "px";
      }
      if (backlinksEl.isShown()) {
        padding = "100px";
        backlinksEl.style.minHeight = Math.max(0, height / 2 - 100) + "px";
      }
      this.cm.contentDOM.style.paddingBottom = padding;
    },
    updateReadableLineLength() {
      const readable = this.app.vault.getConfig("readableLineLength");
      this.editorEl.toggleClass("is-readable-line-width", readable);
    },
    onConfigChanged(configKey) {
      host.EditModeBase.prototype.onConfigChanged.call(this, configKey);
      if (configKey === "readableLineLength") this.updateReadableLineLength();
    },
  });
  return MarkdownEditMode;
}
