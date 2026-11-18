// ng09-editor-cm: clean-room reimplementation of the CodeMirror 6 editor
// component (was manifest class `oZ` -> `defineCodeMirrorEditor`).
//
// Owns the CM6 EditorView, builds the local + dynamic extension sets, keeps
// per-file undo history (cmHistoryStore, capped at 20), routes pointer and
// keyboard interaction (clickable tokens, link hover popup, context menu,
// drag/drop, clipboard) and implements the fold-info persistence contract.
//
// Vendor CodeMirror 6 stays inherited; all app internals are reached lazily
// through `host.*` so late-bound bundle values stay correct.
import { inherit, methods } from "./inherit.js";

export function ng09DefineCodeMirrorEditor(host) {

  // -- small shared helpers (closure over host) ------------------------------

  // userEvent matchers may be predicates `(tr) => bool` or plain strings.
  function ng09MatchUserEvent(tr, spec) {
    if (spec == null) return false;
    if (typeof spec === "function") return !!spec(tr);
    if (typeof spec === "string") return tr.isUserEvent(spec);
    return false;
  }

  function ng09ObserverIgnore(cm, fn) {
    const observer = cm && cm.observer;
    if (observer && typeof observer.ignore === "function") return observer.ignore(fn);
    return fn();
  }

  // {uniformHeading, headingLevel} over the main selection, for the context
  // menu's checked-state of the heading items.
  function ng09HeadingFormatInfo(cm) {
    const doc = cm.state.doc;
    const sel = cm.state.selection.main;
    const from = doc.lineAt(sel.from).number;
    const to = doc.lineAt(sel.to).number;
    let level = 0, count = 0, uniform = true;
    for (let n = from; n <= to; n++) {
      const text = doc.line(n).text;
      let l = 0;
      const atx = /^(#{1,6})\s/.exec(text);
      if (atx) l = atx[1].length;
      else if (n < doc.lines && /^ {0,3}(=+|-+)\s*$/.test(doc.line(n + 1).text)) {
        l = /^=/.test(doc.line(n + 1).text.trim()) ? 1 : 2;
      }
      if (l) {
        count++;
        if (level === 0) level = l;
        else if (level !== l) uniform = false;
      }
    }
    return { uniformHeading: count === 0 || uniform, headingLevel: count === 0 ? 0 : level };
  }

  function ng09AddMenuItem(menu, section, configure) {
    menu.addItem((item) => {
      item.setSection(section);
      configure(item);
      return item;
    });
  }

  // -- the component ----------------------------------------------------------

  function CodeMirrorEditor(app, containerEl, owner) {
    const self = host.Component.call(this) || this;
    self.cleanupLivePreview = null;
    self.sourceMode = true;
    self.cmInit = false;
    self.cursorPopupEl = null;
    self.tableCell = null;
    self.app = app;
    self.owner = owner;
    self.containerEl = containerEl;
    self.editorSuggest = app.workspace.editorSuggest;
    self.sourceMode = !app.vault.getConfig("livePreview");
    const editorEl = self.editorEl = containerEl.createDiv("markdown-source-view cm-s-basalt mod-cm6");
    const cm = self.cm = new host.CMEditorView({ parent: editorEl });
    self.editor = new host.CMEditorComponent(self);
    self.clipboardManager = new host.ClipboardManager(owner);
    host.MarkdownPreviewRenderer.registerDomEvents(cm.contentDOM, new host.PreviewLinkHandlers(owner));
    editorEl.addEventListener("click", self.onEditorClick.bind(self));
    editorEl.addEventListener("mousedown", self.onEditorClick.bind(self), { capture: true });
    if (host.Platform.isIosApp) host.iosTap(editorEl, self.onEditorClick.bind(self));
    editorEl.addEventListener("contextmenu", self.onContextMenu.bind(self));
    editorEl.on("mouseover", ".cm-link, .cm-hmd-internal-link, .cm-footref", self.onEditorLinkMouseover.bind(self));
    editorEl.addEventListener("dragstart", self.onEditorDragStart.bind(self));
    editorEl.onNodeInserted(() => self.reinit());
    setTimeout(() => self.onResize(), 0);
    return self;
  }
  inherit(CodeMirrorEditor, host.Component);

  Object.defineProperty(CodeMirrorEditor.prototype, "file", {
    get() { return this.owner && this.owner.file; },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(CodeMirrorEditor.prototype, "path", {
    get() { return (this.file && this.file.path) || ""; },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(CodeMirrorEditor.prototype, "activeCM", {
    get() { return this.tableCell ? this.tableCell.cm : this.cm; },
    enumerable: false,
    configurable: true,
  });

  methods(CodeMirrorEditor, {

    onload() {
      this.registerEvent(this.app.vault.on("config-changed", this.onConfigChanged, this));
    },

    get() {
      return this.cm.state.doc.toString();
    },

    // ------------------------------------------------------------------ set

    set(text, force) {
      const cm = this.cm;
      if (force || !this.cmInit) {
        if (this.cleanupLivePreview) {
          this.cleanupLivePreview();
          this.cleanupLivePreview = null;
        }
        this.livePreviewPlugin = null;
        this.editorSuggest.close();
        const extensions = [
          this.getLocalExtensions(),
          host.cmCompartment.of(this.getDynamicExtensions()),
          host.cmBaseExtension,
        ];
        try {
          const path = this.path;
          if (path) {
            const store = host.cmHistoryStore;
            const entry = store && store.find((item) => item && item.file === path && item.length === text.length);
            if (entry) {
              const history = host.cmHistoryField.spec.fromJSON(entry.data);
              if (history) extensions.push(host.cmHistoryField.init(() => history));
            }
          }
        } catch (error) {
          console.error(error);
        }
        const state = host.cmState.create({ doc: text, extensions });
        cm.setState(state);
        cm.dispatch({ effects: [host.CMEditorView.scrollIntoView(0), host.cmRefreshEffect.of()] });
        cm.scrollDOM.scrollTop = 0;
        cm.dispatch({ effects: [host.cmRefreshEffect.of()] });
        this.cmInit = true;
        return;
      }

      // Minimal-diff update: keep common head/tail lines, replace the middle.
      const doc = cm.state.doc;
      const newLines = String(text).split(/\r?\n/);
      const oldLines = doc.lines;
      let head = 0;
      while (head < newLines.length && head < oldLines && newLines[head] === doc.line(head + 1).text) head++;
      if (head === newLines.length && head === oldLines) return;
      let tailNew = newLines.length - 1;
      let tailOld = oldLines - 1;
      while (tailNew > head && tailOld > head && newLines[tailNew] === doc.line(tailOld + 1).text) {
        tailNew--;
        tailOld--;
      }
      let from = { line: head, ch: 0 };
      let to = { line: tailOld, ch: doc.line(tailOld + 1).length };
      let insert = newLines.slice(head, tailNew + 1).join("\n");
      // single changed line: refine to the common intra-line prefix/suffix
      if (head === tailOld && head === tailNew && head < oldLines && head < newLines.length) {
        const oldLine = doc.line(head + 1).text;
        const newLine = newLines[head];
        let prefix = 0;
        while (prefix < oldLine.length && prefix < newLine.length && oldLine.charAt(prefix) === newLine.charAt(prefix)) prefix++;
        let suffix = 0;
        while (
          suffix < oldLine.length - prefix &&
          suffix < newLine.length - prefix &&
          oldLine.charAt(oldLine.length - 1 - suffix) === newLine.charAt(newLine.length - 1 - suffix)
        ) suffix++;
        if (prefix > 0 || suffix > 0) {
          from = { line: head, ch: prefix };
          to = { line: tailOld, ch: doc.line(tailOld + 1).length - suffix };
          insert = insert.slice(prefix, insert.length - suffix);
        }
      }
      // change at the end of the document: anchor on the previous line end
      // and prefix the inserted text with a newline.
      if (head === Math.min(oldLines, newLines.length) && head > 0) {
        from = { line: head - 1, ch: doc.line(head).length };
        if (newLines.length > oldLines) insert = "\n" + insert;
      }
      cm.dispatch({
        changes: { from: host.cmPosToOffset(doc, from), to: host.cmPosToOffset(doc, to), insert },
        userEvent: "set",
      });
    },

    // --------------------------------------------------------------- history

    saveHistory() {
      const path = this.path;
      if (!path) return;
      try {
        const state = this.cm.state;
        const history = state.field(host.cmHistoryField);
        if (!history) return;
        const data = host.cmHistoryField.spec.toJSON(history, state);
        const hasChanges = (stack) => {
          if (!stack || !Array.isArray(stack)) return false;
          for (const item of stack) {
            if (item && item.changes && item.changes.length) return true;
          }
          return false;
        };
        if (!hasChanges(data && data.done) && !hasChanges(data && data.undone)) return;
        const store = host.cmHistoryStore;
        if (!store) return;
        for (let i = store.length - 1; i >= 0; i--) {
          if (store[i] && store[i].file === path) store.splice(i, 1);
        }
        store.push({ ts: Date.now(), file: path, data, length: state.doc.length });
        while (store.length > 20) store.shift();
      } catch (error) {
        console.error(error);
      }
    },

    // -------------------------------------------------------------- lifecycle

    reinit() {
      this.cm.setRoot(this.editorEl.doc);
      this.onResize();
    },

    reparent(containerEl) {
      this.containerEl = containerEl;
      containerEl.appendChild(this.editorEl);
      this.reinit();
    },

    clear() {
      if (this.cleanupLivePreview) {
        this.cleanupLivePreview();
        this.cleanupLivePreview = null;
      }
      this.livePreviewPlugin = null;
      const livePreview = !this.sourceMode;
      const state = host.cmState.create({
        doc: "",
        extensions: [
          this.getLocalExtensions(),
          host.cmCompartment.of(this.getDynamicExtensions()),
          host.cmBaseExtension,
          host.livePreviewField.init(() => livePreview),
        ],
      });
      this.cm.setState(state);
      this.cmInit = true;
    },

    destroy() {
      this.localExtensions = null;
      if (this.cleanupLivePreview) {
        this.cleanupLivePreview();
        this.cleanupLivePreview = null;
      }
      this.livePreviewPlugin = null;
      this.cm.setState(host.cmState.create({}));
      this.cm.destroy();
      this.editorSuggest.close();
      if (this.scope) this.app.keymap.popScope(this.scope);
      if (host.Platform.isMobile) this.app.mobileToolbar.update();
      this.destroyTableCell();
    },

    // --------------------------------------------------------- update routing

    updateEvent() {
      const self = this;
      let triggerSuggest = false;
      const suggest = host.debounce(() => {
        self.editorSuggest.trigger(self.editor, self.file, triggerSuggest);
        triggerSuggest = false;
      }, 50);
      const expand = host.debounce(() => self.editor.expandText(), 10);
      const linkPopup = host.debounce(() => self.updateLinkPopup(), 300);
      return (update) => {
        const transactions = update.transactions || [];
        const docChanged = update.docChanged && transactions.some((tr) => ng09MatchUserEvent(tr, host.notSetUserEvent));
        if (update.docChanged) {
          expand();
          if (
            transactions.some((tr) => ng09MatchUserEvent(tr, host.inputEditUserEvent)) &&
            transactions.some((tr) => !ng09MatchUserEvent(tr, host.notSetUserEvent))
          ) {
            triggerSuggest = true;
          }
        }
        if (update.focusChanged || update.docChanged || update.selectionSet) {
          suggest();
          linkPopup();
        }
        this.onUpdate(update, docChanged);
      };
    },

    onUpdate(update, docChanged) {
      // subclass extension point
    },

    // ------------------------------------------------------------- extensions

    buildLocalExtensions() {
      const self = this;
      const extensions = [];
      extensions.push(host.cmEditorField.init(() => self.cm));
      extensions.push(host.cmOwnerField.init(() => self.owner));
      extensions.push(host.CMEditorView.updateListener.of(this.updateEvent()));
      const suggestShowing = () => self.editorSuggest.isShowingSuggestion();
      extensions.push(host.cmKeymapFacet.of([
        { key: "ArrowUp", run: suggestShowing, preventDefault: true },
        { key: "ArrowDown", run: suggestShowing, preventDefault: true },
        { key: "Enter", run: suggestShowing, preventDefault: true },
        { key: "Tab", run: suggestShowing, preventDefault: true },
        {
          key: "Escape",
          run() {
            self.editor.removeHighlights();
            return false;
          },
          preventDefault: true,
        },
      ]));
      if (host.Platform.isMobileApp && host.Platform.isIosApp && host.iosEditorExtensions) {
        extensions.push(...host.iosEditorExtensions);
      }
      extensions.push(
        host.CMEditorView.clipboardCopyHook.of((view, event, slice) => {
          const text = slice && slice.text !== undefined ? slice.text : String(slice || "");
          event.setData("text/markdown", text);
          if (text.length <= 1e6) {
            event.setData("text/html", host.htmlCommentPrefix + host.treeToHtml(host.markdownTree(text)));
          }
        }),
        host.CMEditorView.clipboardPasteHook.of((view, event, defaultInsert) => {
          const handled = self.clipboardManager.handleDataTransfer(event);
          const fallback = defaultInsert && defaultInsert.text !== undefined ? defaultInsert.text : defaultInsert;
          const insert = handled || fallback;
          if (typeof insert === "string" && insert && self.tryPasteUrl(view, insert)) return true;
          if (handled) {
            self.editor.replaceSelection(handled, "input.paste");
            return true;
          }
          const files = host.clipboardFiles(event, "clipboard", true);
          if (files && files.length > 0) {
            self.clipboardManager.insertFiles(files);
            return true;
          }
          return false;
        }),
      );
      extensions.push(host.CMEditorView.domEventHandlers({
        dragstart: (event) => {
          if (event.dataTransfer) event.dataTransfer.clearData("text/html");
        },
        dragover: (event) => self.clipboardManager.handleDragOver(event),
        drop: (event) => self.clipboardManager.handleDrop(event),
        paste: (event) => self.clipboardManager.handlePaste(event),
        focus: () => {
          self.app.workspace.activeEditor = self.owner;
          if (host.Platform.isMobile) self.app.mobileToolbar.update();
          self.destroyTableCell();
        },
        blur: () => {
          if (host.Platform.isMobile) self.app.mobileToolbar.update();
          if (self.owner instanceof host.MarkdownView) self.owner.saveImmediately();
          self.editorSuggest.close();
        },
      }));
      return extensions;
    },

    getLocalExtensions() {
      let extensions = this.localExtensions;
      if (!extensions) extensions = this.localExtensions = this.buildLocalExtensions();
      return extensions;
    },

    /** Paste of plain URLs: single line -> the URL itself; N lines for N
     *  ranges -> `[selected](url)` for non-empty ranges. */
    tryPasteUrl(view, text) {
      if (typeof text !== "string" || text.length === 0) return false;
      const state = view.state;
      const doc = state.doc;
      const ranges = state.selection.ranges;
      const ok = ranges.every((range) =>
        range.empty || doc.lineAt(range.from).number === doc.lineAt(range.to).number
      );
      if (!ok) return false;
      let urls;
      if (!text.includes("\n") && host.isPlainUrl(text)) {
        urls = ranges.map(() => text);
      } else {
        const lines = text.split("\n");
        if (lines.length !== ranges.length || !lines.every((line) => host.isPlainUrl(line))) return false;
        urls = lines;
      }
      const changes = ranges.map((range, index) => ({
        from: range.from,
        to: range.to,
        insert: range.empty ? urls[index] : `[${doc.sliceString(range.from, range.to)}](${urls[index]})`,
      }));
      view.dispatch(state.update({ changes, userEvent: "input.paste", scrollIntoView: true }));
      return true;
    },

    getDynamicExtensions() {
      const extensions = [];
      const vault = this.app.vault;
      extensions.push(host.cmState.tabSize.of(vault.getConfig("tabSize")));
      extensions.push(host.cmIndentUnit.of(vault.getConfig("useTab") ? "\t" : "    "));
      const rtl = vault.getConfig("rightToLeft") || this.editorEl.doc.body.hasClass("mod-rtl");
      this.editorEl.toggleClass("is-rtl", rtl);
      this.editorEl.setAttr("dir", rtl ? "rtl" : null);
      if (rtl) extensions.push(host.CMEditorView.theme({ "&": { direction: "rtl" } }));
      const spellcheck = vault.getConfig("spellcheck");
      extensions.push(host.CMEditorView.contentAttributes.of({
        spellcheck: String(spellcheck),
        autocorrect: "on",
        autocapitalize: "on",
        contenteditable: "true",
      }));
      const livePreview = !this.sourceMode;
      this.editorEl.toggleClass("is-live-preview", livePreview);
      extensions.push(host.livePreviewField.init(() => livePreview));
      if (livePreview) {
        if (!this.livePreviewPlugin) this.livePreviewPlugin = host.livePreviewPluginFactory(this, this.cm);
        extensions.push(this.livePreviewPlugin);
      }
      const brackets = [];
      if (vault.getConfig("autoPairBrackets")) brackets.push("(", "[", "{", "'", '"');
      if (vault.getConfig("autoPairMarkdown")) brackets.push("*", "_", "`", "```");
      if (brackets.length > 0) {
        const closeBrackets = { brackets };
        extensions.push(host.bracketOpenInput, host.bracketField);
        extensions.push(host.cmKeymapFacet.of(host.bracketKeys));
        extensions.push(host.cmState.languageData.of(() => [{ closeBrackets }]));
        extensions.push(host.closeBracketInput);
      }
      if (this.app.isVimEnabled()) {
        extensions.push(
          host.vimTheme,
          host.vimPrecedence.highest(host.vimKeymapClass),
          host.vimThemeAlt,
          host.vimStatusField,
        );
      }
      extensions.push(...this.app.workspace.editorExtensions);
      return extensions;
    },

    onConfigChanged(configKey) {
      if (
        configKey === "useTab" || configKey === "tabSize" || configKey === "rightToLeft" ||
        configKey === "spellcheck" || configKey === "autoPairBrackets" || configKey === "autoPairMarkdown" ||
        configKey === "smartIndentList" || configKey === "vimMode"
      ) {
        this.updateOptions();
      }
    },

    updateOptions() {
      if (!this.cmInit) return;
      this.cm.dispatch({
        effects: [
          host.cmCompartment.reconfigure(this.getDynamicExtensions()),
          host.fieldSetEffect.of({ field: host.livePreviewField, value: !this.sourceMode }),
        ],
      });
    },

    resetSyntaxHighlighting() {
      const cm = this.cm;
      if (cm.state.doc.length > 0) {
        cm.dispatch({
          changes: [{ from: 0, to: 1, insert: cm.state.doc.sliceString(0, 1) }],
          userEvent: "set",
        });
      }
    },

    toggleSource() {
      this.sourceMode = !this.sourceMode;
      this.updateOptions();
      this.cm.dispatch({ effects: [host.cmRefreshEffect.of()] });
    },

    onResize() {
      if (!this.containerEl.offsetParent) return;
      this.editorSuggest.reposition();
      if (host.Platform.isMobile && this.cm.hasFocus) {
        const sel = this.cm.state.selection.main;
        this.cm.dispatch({ effects: [host.CMEditorView.scrollIntoView(host.cmSelection.range(sel.anchor, sel.head), { y: "nearest" })] });
      }
      if (typeof this.editor.refresh === "function") this.editor.refresh();
    },

    // ------------------------------------------------------- clickable tokens

    getClickableTokenHref(token) {
      if (token.type === "external-link") return token.text;
      if (token.type === "external-ref-link") {
        const file = this.file;
        if (!file) return null;
        const cache = this.app.metadataCache.getFileCache(file);
        const ref = cache && cache.referenceLinks && cache.referenceLinks.find((item) => item.id === token.text);
        return ref && host.isUrl(ref.link) ? ref.link : null;
      }
      return null;
    },

    triggerClickableToken(token, newTab) {
      if (!token) return;
      if (token.type === "internal-link") {
        setTimeout(() => this.app.workspace.openLinkText(token.text, this.path, newTab), 100);
      } else if (token.type === "external-link" || token.type === "external-ref-link") {
        const href = this.getClickableTokenHref(token);
        if (!href) return;
        if (host.isUrl(href)) {
          if (newTab === true) window.open(href, "tab");
          else if (newTab === false) window.open(href);
          else window.open(href, newTab);
        } else {
          new host.Notice(host.t.interface.msgFailedToOpenHref({ href }));
        }
      } else if (token.type === "tag") {
        let tag = token.text;
        if (!tag.startsWith("#")) tag = "#" + tag;
        const search = this.app.internalPlugins.getEnabledPluginById("global-search");
        if (search) search.openGlobalSearch("tag:" + tag);
      }
    },

    /** Mobile-only "tap the link" bubble above the cursor token. */
    updateLinkPopup() {
      const cm = this.cm;
      const editor = this.editor;
      let popup = this.cursorPopupEl;
      if (popup) {
        popup.detach();
        this.cursorPopupEl = null;
      }
      if (!host.Platform.isMobile || !this.sourceMode) return;
      if (!cm.hasFocus) return;
      const cursor = typeof editor.getCursor === "function" ? editor.getCursor() : null;
      const token = cursor && typeof editor.getClickableTokenAt === "function" ? editor.getClickableTokenAt(cursor) : null;
      if (!token || token.type === "footref") return;
      const startCoords = editor.coordsAtPos(token.start);
      const endCoords = editor.coordsAtPos(token.end);
      if (!startCoords || !endCoords) return;
      const label = token.type === "internal-link"
        ? host.t.editor.linkPopover.tooltipFollowLink()
        : (token.type === "tag"
          ? host.t.editor.linkPopover.tooltipSearchTag()
          : host.t.editor.linkPopover.tooltipOpenLink());
      const scrollRect = cm.scrollDOM.getBoundingClientRect();
      const popupEl = this.cursorPopupEl = cm.scrollDOM.createDiv();
      const bubble = popupEl.createDiv("follow-link-popover tappable");
      bubble.setText(label);
      popupEl.createDiv("popover-arrow");
      const midX = (startCoords.left + endCoords.right) / 2 - scrollRect.left + cm.scrollDOM.scrollLeft;
      const midY = (startCoords.top + endCoords.bottom) / 2 - scrollRect.top + cm.scrollDOM.scrollTop;
      const width = bubble.offsetWidth || 0;
      const height = popupEl.offsetHeight || 0;
      const maxLeft = Math.max(0, cm.scrollDOM.clientWidth - width - 8);
      popupEl.style.position = "absolute";
      popupEl.style.left = Math.max(8, Math.min(midX - width / 2, maxLeft)) + "px";
      popupEl.style.top = Math.max(0, midY - height - 10) + "px";
      popupEl.addEventListener("mousedown", (event) => event.preventDefault());
      popupEl.addEventListener("click", (event) => {
        event.preventDefault();
        const newTab = event.shiftKey || event.button === 1;
        this.triggerClickableToken(token, newTab);
        if (popupEl.parentElement) popupEl.detach();
        if (this.cursorPopupEl === popupEl) this.cursorPopupEl = null;
      });
      if (token.type === "internal-link") {
        bubble.addEventListener("mouseover", (event) => {
          if (host.pointerEntered(event)) {
            this.app.workspace.trigger("hover-link", {
              event,
              source: "editor",
              hoverParent: this.owner,
              targetEl: bubble,
              linktext: token.text,
              sourcePath: this.path,
            });
          }
        });
      }
    },

    // ------------------------------------------------------------ DOM events

    onEditorClick(event, forwarded) {
      const self = this;
      const cm = this.cm;
      const isMouseDown = event.type === "mousedown";
      const Platform = host.Platform;
      if (Platform.isDesktopApp || (!Platform.isMobileApp && !Platform.isIosApp && !Platform.isAndroidApp)) {
        if (isMouseDown ? event.button !== 1 : event.button !== 0) return;
      } else if (Platform.isAndroidApp) {
        if (!isMouseDown && (event.isTrusted || !forwarded)) return;
      } else if (Platform.isIosApp) {
        if (!event.isTrusted) return;
      } else {
        if (isMouseDown ? event.button !== 1 : event.button !== 0) return;
      }
      const mod = host.Keymap.isModEvent(event);
      const middle = event.button === 1;
      if (!mod && !middle) return;

      const target = event.targetNode || event.target;
      if (!(target instanceof Node) || !cm.contentDOM.contains(target)) return;
      if (target === cm.contentDOM || target.parentElement === cm.contentDOM) return;
      // inside a non-editable island that is not a link or draggable: ignore
      for (let el = target; el && el !== cm.contentDOM; el = el.parentElement) {
        if (el.getAttribute && el.getAttribute("contenteditable") === "false" &&
            !el.classList.contains("external-link") && !el.draggable) {
          return;
        }
      }

      const pos = this.editor.posAtMouse(event);
      if (pos == null) return;
      const state = cm.state;
      if (!this.sourceMode && !state.selection.main.empty) {
        const main = state.selection.main;
        const offset = host.cmPosToOffset(state.doc, pos);
        if (offset >= main.from && offset <= main.to) return;
      }
      const token = this.editor.getClickableTokenAt(pos);
      if (!token) return;

      const allowed = {
        "internal-link": ".cm-hmd-internal-link, .cm-link, .cm-url",
        "external-link": ".external-link, .cm-link, .cm-url",
        "external-ref-link": ".external-link, .cm-link, .cm-url",
        "tag": ".cm-hashtag, .cm-url, .cm-tag",
        "footref": ".cm-footref",
        "blockid": ".cm-blockid, .cm-hashtag",
      };
      const selector = allowed[token.type] || ".cm-link, .cm-hmd-internal-link, .external-link, .cm-url";
      if (!(target instanceof Element) || !target.closest(selector)) return;

      let newTab = middle ? true : mod;
      if (this.sourceMode && mod && !event.shiftKey && newTab === "tab") newTab = false;
      this.triggerClickableToken(token, newTab);
      event.preventDefault();
    },

    onEditorLinkMouseover(event, target) {
      if (!host.pointerEntered(event)) return;
      const pos = this.editor.posAtMouse(event);
      if (pos == null) return;
      const token = this.editor.getClickableTokenAt(pos);
      if (!token || (token.type !== "internal-link" && token.type !== "footref")) return;
      const isFootnote = token.type === "footref";
      this.app.workspace.trigger("hover-link", {
        event,
        source: "editor",
        hoverParent: this.owner,
        targetEl: target,
        linktext: isFootnote ? "#[^" + token.text + "]" : token.text,
        sourcePath: this.path,
      });
    },

    onEditorDragStart(event) {
      const target = event.targetNode || event.target;
      if (!(target instanceof HTMLElement) || !target.draggable) return;
      const cm = this.cm;
      if (!cm.contentDOM.contains(target) || target === cm.contentDOM || target.parentElement === cm.contentDOM) return;
      const pos = this.editor.posAtMouse(event);
      if (pos == null) return;
      const token = this.editor.getClickableTokenAt(pos);
      if (!token) return;
      if (token.type === "internal-link") {
        const drag = this.app.dragManager.dragLink(event, token.text, this.path, token.displayText);
        this.app.dragManager.onDragStart(event, drag);
      } else if (token.type === "external-link" || token.type === "external-ref-link") {
        const href = this.getClickableTokenHref(token);
        if (href) host.setUriList(event.dataTransfer, href);
      }
    },

    // ------------------------------------------------------------ table cells

    editTableCell(table, cell) {
      const current = this.tableCell;
      if (current && current.table === table && current.cell === cell) return current;
      const wrapper = createDiv("table-cell-wrapper");
      const component = new host.TableCellEditor(this, wrapper, table, cell);
      this.addChild(component);
      ng09ObserverIgnore(this.cm, () => {
        cell.lockDimensions();
        cell.contentEl.hide();
        cell.el.appendChild(wrapper);
      });
      component.cm.focus();
      this.tableCell = component;
      if (current) this.destroyTableCell(current);
      table.setActiveDragHandles(cell);
      table.containerEl.addClass("has-focus");
      return component;
    },

    destroyTableCell(component) {
      const cellEditor = component || this.tableCell;
      if (!cellEditor) return;
      const table = cellEditor.table;
      const cell = cellEditor.cell;
      table.unsetActiveDragHandles(cell);
      table.containerEl.removeClass("has-focus");
      ng09ObserverIgnore(this.cm, () => {
        cell.lockDimensions();
        if (cellEditor.containerEl && cellEditor.containerEl.parentElement) cellEditor.containerEl.detach();
        cell.contentEl.show();
      });
      table.rerenderCell(cell);
      this.removeChild(cellEditor);
      if (this.tableCell === cellEditor) this.tableCell = null;
    },

    // ------------------------------------------------------------------ folds

    getFoldInfo() {
      const cm = this.cm;
      const doc = cm.state.doc;
      const folds = [];
      const ranges = host.cmFoldedRanges(cm.state);
      if (ranges && typeof ranges.between === "function") {
        ranges.between(0, doc.length, (from, to) => {
          folds.push({ from: host.cmOffsetToPos(doc, from).line, to: host.cmOffsetToPos(doc, to).line });
        });
      }
      return { folds, lines: doc.lines };
    },

    applyFoldInfo(info) {
      const cm = this.cm;
      const doc = cm.state.doc;
      // line-count mismatch: keep whatever folds are currently applied
      if (!info || doc.lines !== info.lines) {
        if (!info) {
          host.cmdUnfoldAll(cm);
          return;
        }
        return;
      }
      host.cmdUnfoldAll(cm);
      const effects = [];
      for (const fold of info.folds || []) {
        const start = doc.line(Math.min(fold.from + 1, doc.lines));
        const end = doc.line(Math.min(fold.to + 1, doc.lines));
        const range = host.cmFoldableRange(cm.state, start.from, start.to);
        if (range) effects.push(host.cmFoldEffect.of({ from: range.from, to: Math.max(range.to, end.to) }));
      }
      if (effects.length !== 0) cm.dispatch({ effects });
    },

    toggleFoldFrontmatter() {
      const state = this.cm.state;
      if (state.doc.line(1).text !== "---") return;
      const range = host.cmFoldableRange(state, 0, 0);
      if (!range) return;
      const folded = host.cmFoldCheck(host.cmFoldedRanges(state), 0, 0) ? host.cmUnfoldEffect : host.cmFoldEffect;
      this.cm.dispatch({ effects: folded.of(range) });
    },

    // ------------------------------------------------------------- menu/hook

    onMenu(menu) {
      // subclass extension point
    },

    // -------------------------------------------------------- context menu

    async onContextMenu(event, isTouchMenu = false) {
      if (event.defaultPrevented) return;
      const Platform = host.Platform;
      // mobile early-outs
      if (Platform.isMobile && event instanceof PointerEvent && event.button === -1) return;
      if (!isTouchMenu && Platform.mobileSoftKeyboardVisible && (!event.isTrusted || event instanceof TouchEvent)) return;

      const cm = this.cm;
      const target = event.targetNode || event.target;
      const pos = this.editor.posAtMouse(event);
      if (pos == null) return;
      if (!(target instanceof Node) || !cm.contentDOM.contains(target)) return;

      // token at the click position; a plain .cm-line target on a non-touch
      // menu suppresses the token (native spellcheck takes over instead)
      const onPlainLine = target instanceof Element && !!target.closest(".cm-line");
      let token = null;
      let hasCustomSpellcheck = false;
      if (onPlainLine && !isTouchMenu) {
        hasCustomSpellcheck = true;
      } else {
        token = this.editor.getClickableTokenAt(pos);
      }
      if (Platform.isMobile && !isTouchMenu && !token) return;

      const menu = new host.Menu();
      menu.addSections([
        "title", "correction", "spellcheck", "open", "selection-link", "selection",
        "selection.format", "selection.paragraph", "selection.paragraph.list",
        "selection.paragraph.heading", "selection.paragraph.block",
        "selection.insert.basic", "selection.insert.advanced", "insert",
        "clipboard", "info", "info.copy", "action", "view", "", "danger",
      ]);

      // desktop spell-check / editing info from the host
      let editFlags = null;
      let contents = null;
      let misspelledWord = null;
      let dictionarySuggestions = null;
      const electron = Platform.isDesktopApp && event.isTrusted && event.win && event.win.electron ? event.win.electron : null;
      if (electron) {
        const info = await host.electronMenuInfo(event);
        if (!info || event.defaultPrevented) return;
        editFlags = info.editFlags || null;
        misspelledWord = info.misspelledWord || null;
        dictionarySuggestions = info.dictionarySuggestions || null;
        try {
          contents = electron.remote.webContents.fromId(info.webContentsId);
        } catch (error) {
          contents = null;
        }
      }
      const canCut = !editFlags || editFlags.canCut !== false;
      const canCopy = !editFlags || editFlags.canCopy !== false;
      const canPaste = !editFlags || editFlags.canPaste !== false;

      const editor = this.editor;
      const selection = editor.getSelection();

      // spellcheck suggestions
      if (misspelledWord) {
        const suggestions = Array.isArray(dictionarySuggestions) ? dictionarySuggestions.slice(0, 6) : [];
        if (suggestions.length === 0) {
          ng09AddMenuItem(menu, "correction", (item) => item
            .setTitle(host.t.editor.spellcheck.noSuggestion())
            .setDisabled(true));
        } else {
          for (const suggestion of suggestions) {
            ng09AddMenuItem(menu, "correction", (item) => item
              .setTitle(suggestion)
              .setIcon("lucide-repeat")
              .onClick(() => {
                menu.hide();
                if (contents) contents.replaceMisspelling(suggestion);
              }));
          }
        }
        ng09AddMenuItem(menu, "spellcheck", (item) => item
          .setTitle(host.t.editor.spellcheck.addToDictionary())
          .setIcon("lucide-folder-tree")
          .onClick(() => {
            if (contents && contents.session) contents.session.addWordToSpellCheckerDictionary(misspelledWord);
            if (contents) contents.replaceMisspelling(misspelledWord);
          }));
      }

      // token-specific items
      if (token) {
        if (token.type === "internal-link" || token.type === "external-link") {
          ng09AddMenuItem(menu, "selection", (item) => item
            .setTitle(host.t.editor.menu.editLink())
            .setIcon("lucide-text-cursor-input")
            .onClick(() => {
              editor.focus();
              editor.setSelection(token.start, token.end);
            }));
          if (token.type === "internal-link") {
            this.app.workspace.handleLinkContextMenu(menu, token.text, this.path);
          } else {
            const href = this.getClickableTokenHref(token);
            if (href) this.app.workspace.handleExternalLinkContextMenu(menu, href);
          }
        } else if (token.type === "external-ref-link") {
          const href = this.getClickableTokenHref(token);
          if (href) this.app.workspace.handleExternalLinkContextMenu(menu, href);
        } else if (token.type === "tag") {
          ng09AddMenuItem(menu, "selection", (item) => item
            .setTitle(host.t.editor.menu.editTag())
            .setIcon("lucide-text-cursor-input")
            .onClick(() => {
              editor.focus();
              editor.setSelection(host.shiftPos(token.start, 1), token.end);
            }));
        } else if (token.type === "footref") {
          const file = this.file;
          const cache = file && this.app.metadataCache.getFileCache(file);
          const note = cache && cache.footnotes && cache.footnotes.find((entry) =>
            entry && entry.position && (entry.id === token.text || entry.key === token.text || entry.label === token.text)
          );
          if (note) {
            ng09AddMenuItem(menu, "action", (item) => item
              .setTitle(host.t.editor.menu.labelDeleteFootrefAndNote())
              .setIcon("lucide-file-signature")
              .onClick(() => {
                const doc = this.cm.state.doc;
                const from = host.cmPosToOffset(doc, token.start);
                const to = host.cmPosToOffset(doc, token.end);
                const changes = [{ from, to, insert: "" }];
                const start = note.position.start && note.position.start.offset;
                const end = note.position.end && note.position.end.offset;
                if (typeof start === "number" && typeof end === "number") {
                  changes.push({ from: start - 1, to: end, insert: "" });
                }
                this.cm.dispatch(this.cm.state.update({ changes, userEvent: "input" }));
              }));
          }
        }
      }

      // macOS lookup of the current selection
      if (Platform.isMacOS && contents && selection && selection.trim()) {
        ng09AddMenuItem(menu, "title", (item) => item
          .setTitle(host.t.interface.menu.lookupSelection({ selection: host.truncateText(selection, 25) }))
          .setIcon("lucide-library")
          .onClick(() => contents.showDefinitionForSelection()));
      }

      // clipboard section (not on mobile)
      if (!Platform.isMobile) {
        const hasSelection = !!selection;
        ng09AddMenuItem(menu, "clipboard", (item) => item
          .setTitle(host.t.interface.menu.cut())
          .setIcon("lucide-scissors")
          .setDisabled(!canCut || !hasSelection)
          .onClick(() => {
            if (contents) { contents.cut(); return; }
            const text = editor.getSelection();
            editor.replaceSelection("", "input.cut");
            if (text) navigator.clipboard.writeText(text).catch(() => {});
          }));
        ng09AddMenuItem(menu, "clipboard", (item) => item
          .setTitle(host.t.interface.menu.copy())
          .setIcon("lucide-copy")
          .setDisabled(!canCopy || !hasSelection)
          .onClick(() => {
            if (contents) { contents.copy(); return; }
            navigator.clipboard.writeText(editor.getSelection()).catch(() => {});
          }));
        ng09AddMenuItem(menu, "clipboard", (item) => item
          .setTitle(host.t.interface.menu.paste())
          .setIcon("lucide-clipboard-check")
          .setDisabled(!canPaste)
          .onClick(() => {
            if (contents) { contents.paste(); return; }
            navigator.clipboard.readText().then((text) => editor.replaceSelection(text, "input.paste")).catch(() => {});
          }));
        ng09AddMenuItem(menu, "clipboard", (item) => item
          .setTitle(host.t.interface.menu.pasteAsPlainText())
          .setIcon("lucide-clipboard-type")
          .setDisabled(!canPaste)
          .onClick(() => {
            if (contents) { contents.pasteAndMatchStyle(); return; }
            navigator.clipboard.readText().then((text) => editor.replaceSelection(text, "input.paste")).catch(() => {});
          }));
        ng09AddMenuItem(menu, "clipboard", (item) => item
          .setTitle(host.t.interface.menu.selectAll())
          .setIcon("lucide-box-select")
          .onClick(() => {
            const view = this.activeCM;
            view.dispatch(view.state.update({
              selection: host.cmSelection.create([host.cmSelection.range(0, view.state.doc.length)]),
              scrollIntoView: true,
              userEvent: "select",
            }));
          }));
      }

      // link insertion
      const multiline = selection.indexOf("\n") !== -1;
      ng09AddMenuItem(menu, "selection-link", (item) => item
        .setTitle(host.t.interface.formatting.insertLink())
        .setIcon("lucide-link")
        .setDisabled(multiline)
        .onClick(() => editor.triggerWikilink(false)));
      ng09AddMenuItem(menu, "selection-link", (item) => item
        .setTitle(host.t.interface.formatting.insertExternalLink())
        .setIcon("lucide-external-link")
        .setDisabled(multiline)
        .onClick(() => editor.insertMarkdownLink()));

      if (!token) {
        const formatInfo = ng09HeadingFormatInfo(this.cm);
        host.formattingMenu(menu, editor, formatInfo, "selection.format");
        menu.setSectionSubmenu("selection.paragraph", {
          title: host.t.interface.formatting.labelParagraph(),
          disabled: editor.inTableCell,
          icon: "lucide-pilcrow",
        });
        menu.setSectionSubmenu("info.copy", {
          title: host.t.interface.menu.copyPath(),
          icon: "lucide-clipboard",
        });
        menu.setSectionSubmenu("selection.insert", {
          title: host.t.interface.formatting.labelInsert(),
          disabled: editor.inTableCell,
          icon: "lucide-list-plus",
        });

        // paragraph list toggles
        ng09AddMenuItem(menu, "selection.paragraph.list", (item) => item
          .setTitle(host.t.interface.formatting.toggleBulletList())
          .setIcon("lucide-list")
          .onClick(() => editor.toggleBulletList()));
        ng09AddMenuItem(menu, "selection.paragraph.list", (item) => item
          .setTitle(host.t.interface.formatting.toggleNumberedList())
          .setIcon("lucide-list-ordered")
          .onClick(() => editor.toggleNumberList()));
        ng09AddMenuItem(menu, "selection.paragraph.list", (item) => item
          .setTitle(host.t.interface.formatting.toggleChecklist())
          .setIcon("lucide-check-square")
          .onClick(() => editor.toggleCheckList()));

        // heading levels 1-6 + "no heading"
        for (let level = 1; level <= 6; level++) {
          const lv = level;
          ng09AddMenuItem(menu, "selection.paragraph.heading", (item) => item
            .setTitle(host.t.interface.formatting.setHeading({ level: lv }))
            .setIcon("lucide-heading-" + lv)
            .setChecked(formatInfo.uniformHeading && formatInfo.headingLevel === lv)
            .onClick(() => editor.setHeading(lv)));
        }
        ng09AddMenuItem(menu, "selection.paragraph.heading", (item) => item
          .setTitle(host.t.interface.formatting.noHeading())
          .setIcon("lucide-text")
          .setChecked(formatInfo.uniformHeading && formatInfo.headingLevel === 0)
          .onClick(() => editor.setHeading(0)));

        ng09AddMenuItem(menu, "selection.paragraph.block", (item) => item
          .setTitle(host.t.interface.formatting.toggleQuote())
          .setIcon("lucide-quote")
          .onClick(() => editor.toggleBlockquote()));

        // insert submenu
        ng09AddMenuItem(menu, "selection.insert.basic", (item) => item
          .setTitle(host.t.interface.formatting.insertFootnote())
          .setIcon("lucide-file-signature")
          .onClick(() => editor.insertFootnote()));
        ng09AddMenuItem(menu, "selection.insert.basic", (item) => item
          .setTitle(host.t.interface.formatting.insertTable())
          .setIcon("lucide-table")
          .onClick(() => editor.insertTable()));
        ng09AddMenuItem(menu, "selection.insert.basic", (item) => item
          .setTitle(host.t.interface.formatting.insertCallout())
          .setIcon("lucide-quote")
          .onClick(() => editor.insertCallout()));
        ng09AddMenuItem(menu, "selection.insert.basic", (item) => item
          .setTitle(host.t.interface.formatting.insertHorizontalRule())
          .setIcon("lucide-minus")
          .onClick(() => editor.insertHorizontalRule()));
        ng09AddMenuItem(menu, "selection.insert.advanced", (item) => item
          .setTitle(host.t.interface.formatting.insertCodeBlock())
          .setIcon("lucide-code")
          .onClick(() => editor.insertCodeblock()));
        ng09AddMenuItem(menu, "selection.insert.advanced", (item) => item
          .setTitle(host.t.interface.formatting.insertMathBlock())
          .setIcon("lucide-sigma-square")
          .onClick(() => editor.insertMathBlock()));

        // copy path submenu
        ng09AddMenuItem(menu, "info.copy", (item) => item
          .setTitle(this.path || "")
          .setIcon("lucide-clipboard")
          .onClick(() => {
            if (this.path) navigator.clipboard.writeText(this.path).catch(() => {});
          }));
      }

      // plugin/subclass hook, then show. Touch menus and mobile menus with a
      // token skip the editor-menu trigger.
      const touchMenu = isTouchMenu && Platform.isMobile;
      if (!touchMenu && !(Platform.isMobile && token)) {
        this.app.workspace.trigger("editor-menu", menu, editor, this.owner);
        this.onMenu(menu);
      }
      menu.showAtMouseEvent(event);
      if (hasCustomSpellcheck) event.preventDefault();
    },
  });

  return CodeMirrorEditor;
}

// DECISIONS (spec-silent areas, chosen independently):
// - `notSetUserEvent`/`inputEditUserEvent` host values are treated as
//   user-event matchers: a function is called with the transaction, a string
//   via `tr.isUserEvent(str)` (ng09MatchUserEvent).
// - `tryPasteUrl` wraps non-empty ranges as `[selected](url)` in both the
//   single-line and N-lines/N-ranges cases; multi-line paste requires
//   lines.length === ranges.length and every line `isPlainUrl`.
// - clipboardPasteHook tries `tryPasteUrl` on `handled || defaultInsert`
//   (plain-text fallback normalised from a possible Slice) before the
//   markdown/files fallbacks.
// - Context menu: `editor-menu` trigger + `onMenu` are skipped for mobile
//   non-touch menus that resolved a token, and for touch menus on mobile
//   (`touchMenu = isTouchMenu && Platform.isMobile`). On desktop the hook
//   still fires even when the caller passes isTouchMenu=true (acceptance
//   test 09 relies on this).
// - `formatInfo` for `formattingMenu` is computed locally as
//   {uniformHeading, headingLevel} by scanning ATX/setext headings across
//   the main selection; no dedicated host query was specified.
// - Footref "delete footnote" looks up `cache.footnotes` entries carrying
//   `position.start.offset`/`position.end.offset`; note block removed as
//   `{from: start.offset - 1, to: end.offset}`; userEvent "input".
// - `onEditorClick` platform gate approximated: desktop click btn0 /
//   mousedown btn1; Android mousedown or untrusted forwarded click; iOS
//   trusted click; requires mod or middle button; "tab"->false demotion in
//   source mode when mod && !shift.
// - Token-click allow rules are a best-effort selector table per token
//   type (.cm-hmd-internal-link/.cm-link/.external-link/.cm-url/.cm-footref/
//   .cm-hashtag/.cm-blockid/.cm-underline family).
// - `cm.observer.ignore` used when present, else the callback runs directly
//   (ng09ObserverIgnore).
// - `updateLinkPopup` builds a wrapper div on `cm.scrollDOM` containing the
//   `follow-link-popover tappable` bubble + `popover-arrow` div; position is
//   absolute above the token midpoint, horizontally clamped to scroll width.
// - `reinit()` uses `cm.setRoot(this.editorEl.doc)` literally per spec.
// - `getFoldInfo` iterates `cmFoldedRanges(state).between(0, doc.length)`;
//   folds are `{from: line0, to: line0}`; `applyFoldInfo` returns early on
//   line-count mismatch (keeps current folds), else unfold-all + refold.
// - `onContextMenu` is async because `electronMenuInfo` is awaited; the
//   mobile/PointerEvent/soft-keyboard early-outs and the token resolution
//   happen synchronously before the first await.
// - `contents` (webContents) is resolved via
//   `event.win.electron.remote.webContents.fromId(info.webContentsId)`;
//   all contents-delegating menu clicks guard on it being non-null.
// - Clipboard section skipped entirely on `Platform.isMobile`; flags come
//   from `info.editFlags` when present (absent => all enabled); cut/copy
//   additionally require a non-empty selection.
// - `info.copy` submenu gets one item that copies `this.path` via
//   navigator.clipboard (copyPath semantics approximated).
// - `selection-link` items are added unconditionally (also when a token
//   exists), per the spec's section ordering.
// - `onunload` is inherited from Component; subclasses call destroy()
//   themselves (TableCellEditor does).
// - Export name is `ng09DefineCodeMirrorEditor`; manifest `classes` entry
//   for `oZ` must reference it (parent owns manifest.json).
// - No `env()` usage: every needed value is a manifest `host` alias; all
//   host.* reads happen inside methods/closures (lazy), except the
//   unavoidable `host.Component` base lookup at class-definition time.
// - `clear()` mirrors spec literally, including the extra
//   `livePreviewField.init` appended after `cmBaseExtension`.
// - `set()` diff edge guard `head > 0` added to protect `doc.line(head)`.
// - `editor.refresh()` on onResize is typeof-guarded (EditorImpl parallel
//   module may not define it).
// - `host.CMEditorComponent`/`host.TableCellEditor`/`host.MarkdownView` are
//   resolved lazily so the parallel n-g09 modules can supply them.
// - Unresolved: exact `onEditorClick` gate details, `bracketKeys` shape,
//   `clipboardFiles` nullability, footnote cache shape, and whether
//   `notSetUserEvent`/`inputEditUserEvent` are predicates or annotations —
//   all handled defensively per ng09MatchUserEvent/guards above.
//

// NOTE: clipboard menu items implement their electron/navigator fallback
// logic inline; no shared helper is used.
