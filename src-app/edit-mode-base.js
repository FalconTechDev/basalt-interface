import { inherit, methods } from "./inherit.js";

// Base class for markdown edit modes (source / live preview). Owns the
// scroll DOM rearrangement (sizer/contentContainer/gutters), scroll
// position math between CM coordinates and fractional lines, the in-editor
// search bar, mode keymaps (Enter list continuation, Tab indent) and the
// dynamic CodeMirror extension set (line numbers, indent guides, folding,
// bracket pairing, live-preview decorations).
export function defineEditModeBase(host) {
  function EditModeBase(app, contentEl, owner) {
    const self = host.CodeMirrorEditor.call(this, app, contentEl, owner) || this;
    self.isScrolling = false;
    self.cssClasses = [];
    const cm = self.cm;
    cm.contentDOM.detach();
    const sizerEl = self.sizerEl = cm.scrollDOM.createDiv("cm-sizer");
    const container = sizerEl.createDiv("cm-contentContainer");
    const gutters = cm.scrollDOM.find(".cm-gutters");
    if (gutters) container.appendChild(gutters);
    container.appendChild(cm.contentDOM);
    cm.scrollDOM.addEventListener("scroll", () => self.onScroll());
    self.search = new host.EditorSearchBar(self.editor, self.editorEl, (scope) => {
      if (scope !== self.scope) {
        if (self.scope) app.keymap.popScope(self.scope);
        if (scope) app.keymap.pushScope(scope);
        self.scope = scope;
      }
    });
    self.editorEl.addEventListener("click", self.onViewClick.bind(self));
    return self;
  }
  inherit(EditModeBase, host.CodeMirrorEditor);
  methods(EditModeBase, {
    onScroll() {
      this.editorSuggest.reposition();
      if (this.isScrolling) this.isScrolling = false;
      else this.handleScroll();
    },
    handleScroll() {
      this.owner.syncScroll();
    },
    show() {
      this.editorEl.show();
    },
    hide() {
      this.editorEl.hide();
      this.editorSuggest.close();
      this.search.hide();
    },
    focus() {
      const editor = this.editor;
      const scroll = editor.getScrollInfo();
      editor.focus();
      editor.scrollTo(scroll.left, scroll.top);
      if (host.Platform.isMobileApp && host.keyboard) host.keyboard.show();
    },
    // Fractional line position (can be between lines) derived from scrollTop.
    getScroll() {
      const cm = this.cm;
      const contentTop = cm.contentDOM.offsetTop;
      const scrollTop = cm.scrollDOM.scrollTop;
      const block = cm.lineBlockAtHeight(Math.max(scrollTop - contentTop, 0));
      const startLine = cm.state.doc.lineAt(block.from).number - 1;
      const lineSpan = cm.state.doc.lineAt(block.to).number - 1 - startLine + 1;
      let offset = scrollTop - block.top;
      let height = block.height;
      if (startLine === 0) height += contentTop;
      else offset -= contentTop;
      return startLine + lineSpan * Math.max(0, offset) / Math.max(1, height);
    },
    applyScroll(scroll) {
      if (!Number.isNumber(scroll) || isNaN(scroll)) return;
      const cm = this.cm;
      if (scroll < 0) scroll = 0;
      if (scroll >= cm.state.doc.lines) scroll = cm.state.doc.lines - 0.99;
      const line = Math.floor(scroll);
      const fraction = scroll - line;
      const docLine = cm.state.doc.line(line + 1);
      const computeTop = () => {
        const block = cm.lineBlockAt(docLine.from);
        const blockStart = cm.state.doc.lineAt(block.from).number - 1;
        const lineSpan = cm.state.doc.lineAt(block.to).number - 1 - blockStart + 1;
        const inner = line - blockStart;
        let top = block.top;
        let height = block.height;
        const contentTop = cm.contentDOM.offsetTop;
        if (blockStart === 0) height += contentTop;
        else top += contentTop;
        return top + (inner + fraction) * (height / lineSpan);
      };
      if (cm.visibleRanges.some((range) => range.from <= docLine.from && docLine.from <= range.to)) {
        this.isScrolling = true;
        cm.scrollDOM.scrollTop = computeTop();
        return;
      }
      this.isScrolling = true;
      cm.dispatch({ effects: host.cmView.scrollIntoView(docLine.from, { y: "nearest" }) });
      cm.requestMeasure({
        read() {},
        write() {
          cm.requestMeasure({
            read() { return computeTop(); },
            write(top) {
              this.isScrolling = true;
              cm.scrollDOM.scrollTop = top;
            },
          });
        },
      });
    },
    showSearch(reveal) {
      if (reveal === undefined) reveal = false;
      this.destroyTableCell();
      this.search.show(reveal);
    },
    buildLocalExtensions() {
      const self = this;
      const extensions = host.CodeMirrorEditor.prototype.buildLocalExtensions.call(this);
      extensions.push(host.hypermdMode);
      extensions.push(host.cmLiveDecorations);
      extensions.push(host.cmView.scrollHandler.of((update, range) => {
        const cell = self.tableCell;
        return cell && cell.containerEl.isShown() && cell.table.containsRange(range.anchor, range.head);
      }));
      extensions.push(host.cmKeymapFacet.of([{
        key: "Enter",
        run() {
          if (self.app.vault.getConfig("smartIndentList")) {
            const state = self.editor.cm.state;
            const pos = state.selection.main.from;
            if (host.isSmartIndentTarget(state, state.doc.lineAt(pos))) {
              self.editor.newlineAndIndentOnly();
              return true;
            }
            self.editor.newlineAndIndentContinueMarkdownList();
            return true;
          }
          return false;
        },
        shift() {
          if (!self.app.vault.getConfig("smartIndentList")) return false;
          self.editor.newlineAndIndentOnly();
          return true;
        },
        preventDefault: true,
      }, {
        key: "Tab",
        run() {
          self.editor.indentList();
          return true;
        },
        shift() {
          self.editor.unindentList();
          return true;
        },
      }]));
      return extensions;
    },
    onConfigChanged(configKey) {
      host.CodeMirrorEditor.prototype.onConfigChanged.call(this, configKey);
      if (configKey === "showLineNumber" || configKey === "showIndentGuide" || configKey === "foldHeading" || configKey === "foldIndent" || configKey === "propertiesInDocument") {
        this.updateOptions();
      }
    },
    getDynamicExtensions() {
      const extensions = host.CodeMirrorEditor.prototype.getDynamicExtensions.call(this);
      const vault = this.app.vault;
      if (vault.getConfig("showLineNumber")) {
        extensions.push(host.cmLineNumbersFixed({ fixed: false }));
        extensions.push(host.cmLineNumbersCompute);
        extensions.push(host.cmLineNumbersField());
      }
      if (vault.getConfig("smartIndentList")) extensions.push(host.cmTableCellFilter(this));
      if (vault.getConfig("showIndentGuide")) extensions.push(host.cmIndentGuides);
      const foldHeading = vault.getConfig("foldHeading");
      const foldIndent = vault.getConfig("foldIndent");
      const folding = foldHeading || foldIndent;
      this.editorEl.toggleClass("is-folding", folding);
      if (folding) {
        extensions.push(host.cmFoldGutter());
        extensions.push(host.cmFoldDecorations);
        if (foldHeading) extensions.push(host.cmFoldHeading);
        if (foldIndent) extensions.push(host.cmFoldIndent);
        extensions.push(host.cmFoldFrontmatter);
      }
      const autoPairBrackets = vault.getConfig("autoPairBrackets");
      const autoPairMarkdown = vault.getConfig("autoPairMarkdown");
      if (autoPairBrackets || autoPairMarkdown) extensions.push([host.cmAutoPair]);
      this.editorEl.toggleClass("show-properties", vault.getConfig("propertiesInDocument") === "visible");
      return extensions;
    },
    setCssClass(classes) {
      const editorEl = this.editorEl;
      editorEl.removeClasses(this.cssClasses);
      if (classes && classes.length > 0) {
        const classList = editorEl.classList;
        classes = classes.filter((cls) => !classList.contains(cls));
        editorEl.addClasses(classes);
      } else {
        classes = [];
      }
      this.cssClasses = classes;
    },
    onCssChange() {
      this.cm.dispatch({ effects: host.cmClearCacheEffect.of() });
      this.editor.refresh();
    },
    onViewClick(event) {
      const self = this;
      if (event.defaultPrevented) return;
      this.editorSuggest.close();
      setTimeout(() => self.editor.removeHighlights(), 0);
    },
    onUpdate(update, isUserEvent) {
      host.CodeMirrorEditor.prototype.onUpdate.call(this, update, isUserEvent);
      if (update.docChanged) this.app.workspace.trigger("editor-change", this.editor, this.owner);
      if (update.selectionSet || isUserEvent || update.focusChanged) {
        this.app.workspace.trigger("editor-selection-change", this.editor, this.owner);
      }
    },
  });
  return EditModeBase;
}
