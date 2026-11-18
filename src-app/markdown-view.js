// MarkdownView: a markdown leaf that owns two "modes" — the source/live-preview editor mode
// (j6, still inherited) and the reading preview mode (fq, own). It keeps the inline title,
// the properties metadata editor, the embedded backlinks pane, view state (mode/source/
// backlinks), scroll sync between modes, fold persistence and the pane menu.
import { inherit } from "./inherit.js";

const VIEW_TYPE = "markdown";

function isBoolean(value) { return typeof value === "boolean"; }

export function defineMarkdownView(host) {
  function MarkdownView(leaf) {
    const self = host.TextFileView.call(this, leaf) || this;
    self.icon = "lucide-file";
    self.modeButtonEl = null;
    self.modes = {};
    self.currentMode = null;
    self.scroll = null;
    self.showBacklinks = false;
    self.rawFrontmatter = null;
    self.scope = self.initialScope = new host.Scope(self.app.scope);
    self.editMode = self.registerMode(new host.MarkdownEditMode(self));
    self.sourceMode = { cmEditor: self.editor };
    self.previewMode = self.registerMode(new host.MarkdownPreviewView(self));

    const titleEl = self.inlineTitleEl = createDiv("inline-title");
    titleEl.contentEditable = "true";
    titleEl.spellcheck = self.app.vault.getConfig("spellcheck");
    titleEl.autocapitalize = "on";
    titleEl.tabIndex = -1;
    titleEl.enterKeyHint = host.Platform.isAndroidApp ? "enter" : "done";
    titleEl.addEventListener("focus", () => { self.fileBeingRenamed = self.file; });
    titleEl.addEventListener("blur", () => self.onInlineTitleBlur());
    titleEl.addEventListener("input", () => self.onTitleChange(titleEl));
    titleEl.addEventListener("paste", (event) => self.onTitlePaste(titleEl, event));
    titleEl.addEventListener("keydown", self.onTitleKeydown.bind(self));

    self.metadataEditor = new host.MetadataEditor(self.app, self);
    self.addChild(self.metadataEditor);
    self.backlinksEl = createDiv("embedded-backlinks");
    self.backlinksEl.hide();
    self.modeButtonEl = self.addAction("lucide-book-open", "", self.onSwitchView.bind(self));

    const modes = self.modes;
    for (const key in modes) if (modes.hasOwnProperty(key)) modes[key].hide();

    let defaultMode = self.app.vault.getConfig("defaultViewMode");
    if (!defaultMode || !modes.hasOwnProperty(defaultMode)) defaultMode = "source";
    self.currentMode = modes[defaultMode];
    self.containerEl.setAttribute("data-mode", self.getMode());
    self.currentMode.show();
    self.updateButtons();
    self.showBacklinks = self.app.workspace.backlinkInDocument;
    self.updateShowBacklinks();
    self.addChild(self.previewMode);

    // ctrl/cmd + wheel adjusts the base font size (with a 500 ms rate limit per direction change)
    let lastWheelTime = 0;
    self.containerEl.addEventListener("wheel", (event) => {
      if (self.app.vault.getConfig("baseFontSizeAction")) {
        const isZoom = event.ctrlKey;
        const now = Date.now();
        if (isZoom && !(lastWheelTime > now - 500)) {
          if (isZoom && event.deltaY !== 0) {
            if (host.isMacOS && Number.isInteger(event.deltaY)) return;
            let size = self.app.vault.getConfig("baseFontSize");
            if (event.deltaY < 0) size++; else size--;
            size = Math.clamp(size, 10, 30);
            self.app.vault.setConfig("baseFontSize", size);
          }
        } else lastWheelTime = now;
      }
    }, { passive: true });
    return self;
  }
  inherit(MarkdownView, host.TextFileView);

  Object.defineProperty(MarkdownView.prototype, "editor", {
    get() { return this.editMode.editor; },
    enumerable: false, configurable: true,
  });

  const proto = MarkdownView.prototype;

  proto.replaceScope = function (scope) { this.scope = scope || this.initialScope; };

  proto.saveFrontmatter = function (frontmatter) {
    const data = host.spliceFrontmatter(this.getViewData(), frontmatter);
    this.setViewData(data, false);
    this.onInternalDataChange();
    this.save();
  };

  proto.getFile = function () { return this.file; };

  proto.shiftFocusAfter = function () {
    this.setEphemeralState({ focus: true, focusOnMobile: true, cursor: { from: { line: 0, ch: 0 } } });
  };

  proto.shiftFocusBefore = function () {
    if (this.canShowProperties() && !this.metadataEditor.hasFocus()) {
      this.metadataEditor.focus({ bottom: true });
    } else if (this.inlineTitleEl.isShown()) {
      host.focusAndSelectContents(this.inlineTitleEl);
    }
  };

  proto.onInlineTitleBlur = function () {
    return Promise.resolve().then(async () => {
      const changed = await this.saveTitle(this.inlineTitleEl);
      if (!changed) this.inlineTitleEl.setText(this.file.basename);
      host.hideTooltip();
    });
  };

  proto.onload = function () {
    host.TextFileView.prototype.onload.call(this);
    const leaf = this.leaf;
    this.registerEvent(leaf.workspace.on("quick-preview", this.onExternalDataChange, this));
    this.registerEvent(leaf.workspace.on("resize", this.onResize, this));
    this.registerEvent(leaf.workspace.on("css-change", this.onCssChange, this));
    this.registerEvent(this.app.vault.on("config-changed", this.onConfigChanged, this));
    this.onResize();
  };

  proto.onClose = function () {
    return Promise.resolve().then(() => host.TextFileView.prototype.onClose.call(this))
      .then(() => { this.editMode.destroy(); });
  };

  proto.getViewType = function () { return VIEW_TYPE; };

  proto.canAcceptExtension = function (extension) {
    return host.markdownExtensions.contains(extension);
  };

  proto.getState = function () {
    const state = host.TextFileView.prototype.getState.call(this);
    state.mode = this.getMode();
    state.source = this.editMode.sourceMode;
    state.backlinks = this.showBacklinks;
    if (state.backlinks) state.backlinkOpts = this.backlinks.getState();
    return state;
  };

  proto.setState = function (state, result) {
    return (async () => {
      let needsLayout = false;
      const mode = state.mode;
      const backlinks = state.backlinks;
      const backlinkOpts = state.backlinkOpts;
      const source = state.source;
      if (mode) {
        const modes = this.modes;
        if (modes.hasOwnProperty(mode)) needsLayout = await this.setMode(modes[mode]);
      }
      const editMode = this.editMode;
      if (typeof source === "boolean" && editMode.sourceMode !== source) {
        editMode.toggleSource();
        needsLayout = true;
      }
      if (isBoolean(backlinks)) {
        this.showBacklinks = backlinks;
        this.updateShowBacklinks();
        if (backlinks && backlinkOpts && typeof backlinkOpts === "object") this.backlinks.setState(backlinkOpts);
      }
      if (needsLayout) result.layout = true;
      await host.TextFileView.prototype.setState.call(this, state, result);
    })();
  };

  proto.getEphemeralState = function () {
    const state = host.TextFileView.prototype.getEphemeralState.call(this);
    this.currentMode.getEphemeralState(state);
    if (this.scroll !== null) state.scroll = this.scroll;
    return state;
  };

  proto.setEphemeralState = function (state) {
    const rename = state.rename;
    if (rename) {
      let collapse;
      if (rename === "start") collapse = true;
      else if (rename === "end") collapse = false;
      if (this.inlineTitleEl.isShown()) {
        const scroll = this.currentMode === this.editMode
          ? this.editMode.cm.scrollDOM.scrollTop
          : this.previewMode.getScroll();
        if (scroll < 0.5) {
          host.focusAndSelectContents(this.inlineTitleEl, collapse);
          delete state.rename;
        }
      }
    }
    host.TextFileView.prototype.setEphemeralState.call(this, state);
    const subpath = state.subpath;
    if (subpath) {
      const pos = host.subpathToPos(this.app.metadataCache.getFileCache(this.file), subpath);
      if (pos) {
        state.line = pos.start.line;
        state.startLoc = pos.start;
        state.endLoc = pos.end || null;
      }
    }
    this.currentMode.setEphemeralState(state);
    if (state.hasOwnProperty("scroll")) this.scroll = state.scroll;
  };

  proto.onUnloadFile = function (file) {
    return Promise.resolve().then(() => {
      this.onMarkdownFold();
      this.currentMode.beforeUnload();
      this.rawFrontmatter = null;
      this.metadataEditor.clear();
      this.editMode.setCssClass(null);
      return host.TextFileView.prototype.onUnloadFile.call(this, file);
    });
  };

  proto.registerMode = function (mode) {
    this.modes[mode.type] = mode;
    return mode;
  };

  proto.getMode = function () { return this.currentMode.type; };

  proto.getHoverSource = function () { return this.editMode ? "editor" : "preview"; };

  proto.toggleMode = function () {
    const leaf = this.leaf;
    const viewState = leaf.getViewState();
    viewState.state.mode = viewState.state.mode === "preview" ? "source" : "preview";
    leaf.setViewState(viewState, { focus: true });
  };

  proto.updateButtons = function () {
    const mode = this.currentMode;
    const button = this.modeButtonEl;
    const modClick = host.t.interface.menu.modClickOpenNewTab({ key: host.keyNames.Mod });
    if (mode.type === "source") {
      host.setIcon(button, "lucide-book-open");
      host.setTooltip(button, host.t.interface.menu.editView() + "\n" + host.t.interface.menu.switchToReadView() + "\n" + modClick);
    } else {
      host.setIcon(button, "lucide-edit-3");
      host.setTooltip(button, host.t.interface.menu.readView() + "\n" + host.t.interface.menu.switchToEditView() + "\n" + modClick);
    }
  };

  proto.setMode = function (mode) {
    return (async () => {
      if (!mode || this.currentMode === mode) return false;
      const previous = this.currentMode;
      const scroll = this.scroll;
      if (previous.type === "source") await this.save();
      const foldInfo = previous.getFoldInfo();
      this.app.foldManager.save(this.file, foldInfo);
      previous.hide();
      this.currentMode = mode;
      mode.show();
      if (this.data !== null) mode.set(this.data, false);
      mode.onResize();
      if (scroll !== null) mode.setEphemeralState({ scroll });
      mode.applyFoldInfo(foldInfo);
      this.metadataEditor.setCollapse(!!foldInfo && foldInfo.folds.some((fold) => fold.from === 0), false);
      this.updateButtons();
      this.containerEl.setAttribute("data-mode", this.getMode());
      return true;
    })();
  };

  proto.getViewData = function () { return this.currentMode.get(); };

  proto.clear = function () {
    const currentMode = this.currentMode;
    const editMode = this.editMode;
    const modes = this.modes;
    if (currentMode === editMode) this.onMarkdownFold();
    this.scroll = null;
    for (const key in modes) if (modes.hasOwnProperty(key)) modes[key].clear();
  };

  Object.defineProperty(MarkdownView.prototype, "path", {
    get() { return this.file.path; },
    enumerable: false, configurable: true,
  });

  proto.onSwitchView = function (event) {
    return (async () => {
      event.preventDefault();
      const leaf = this.leaf;
      const state = this.getState();
      state.mode = this.getMode() === "preview" ? "source" : "preview";
      const viewState = { type: VIEW_TYPE, state };
      if (host.Keymap.isModEvent(event)) {
        const workspace = this.app.workspace;
        const newLeaf = workspace.createLeafBySplit(this.leaf);
        viewState.active = true;
        viewState.group = this.leaf;
        await newLeaf.setViewState(viewState, { focus: true });
      } else {
        await leaf.setViewState(viewState, { focus: true });
      }
    })();
  };

  proto.canToggleBacklinks = function () {
    return this.getMode() === "preview" || this.editMode instanceof host.MarkdownEditMode;
  };

  proto.toggleBacklinks = function () {
    return (async () => {
      const state = this.getState();
      state.backlinks = !state.backlinks;
      await this.leaf.setViewState({ type: VIEW_TYPE, state });
      this.app.workspace.requestSaveLayout();
    })();
  };

  proto.updateShowBacklinks = function () {
    const show = this.showBacklinks;
    const app = this.app;
    const backlinks = this.backlinks;
    if (show && !backlinks) {
      this.backlinksEl.show();
      this.backlinks = this.addChild(new host.BacklinksPane(app, this.backlinksEl));
      this.updateBacklinks();
    } else if (!show && backlinks) {
      this.removeChild(backlinks);
      this.backlinksEl.empty();
      this.backlinksEl.hide();
      this.backlinks = null;
    }
    if (this.currentMode === this.editMode) this.editMode.onResize();
  };

  proto.updateBacklinks = function () {
    const backlinks = this.backlinks;
    if (backlinks) {
      backlinks.file = this.file;
      backlinks.update();
    }
  };

  proto.onLoadFile = function (file) {
    return Promise.resolve().then(() => {
      this.inlineTitleEl.setText(this.getDisplayText());
      return host.TextFileView.prototype.onLoadFile.call(this, file);
    }).then(() => { this.updateBacklinks(); });
  };

  proto.onRename = function (file) {
    return (async () => {
      if (file === this.file) this.inlineTitleEl.setText(file.basename);
      await host.TextFileView.prototype.onRename.call(this, file);
    })();
  };

  proto.syncScroll = function () {
    const scroll = this.currentMode.getScroll();
    if (scroll !== null) this.scroll = scroll;
    this.app.workspace.trigger("markdown-scroll", this);
    this.syncState();
  };

  proto.receiveSyncState = function (other) {
    if (this.file !== other.file) {
      this.leaf.openFile(other.file, { eState: other.getEphemeralState() });
    } else {
      this.setEphemeralState(other.getEphemeralState());
    }
  };

  proto.onMarkdownFold = function () {
    this.app.foldManager.save(this.file, this.currentMode.getFoldInfo());
  };

  proto.onPaneMenu = function (menu, leaf) {
    host.TextFileView.prototype.onPaneMenu.call(this, menu, leaf);
    const mode = this.getMode();
    const self = this;
    menu.addItem((item) => item
      .setSection("pane")
      .setTitle(host.t.interface.menu.toggleReadingView())
      .setChecked(mode === "preview")
      .setIcon("lucide-book-open")
      .onClick(self.onSwitchView.bind(self)));
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(host.t.interface.menu.addProperty())
      .setDisabled(!this.canShowProperties())
      .setIcon("lucide-plus-circle")
      .onClick(() => host.propertiesPlugin(this.app).then((properties) => properties.addProperty())));
    if (mode === "source") {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(host.t.interface.menu.toggleSourceMode())
        .setIcon("lucide-code-2")
        .setChecked(!!this.getState().source)
        .onClick(() => {
          const state = this.getState();
          state.source = !state.source;
          this.leaf.setViewState({ type: VIEW_TYPE, state });
        }));
    }
    menu.addItem((item) => item
      .setSection("find")
      .setTitle(host.t.interface.menu.find())
      .setIcon("lucide-file-search")
      .onClick(() => this.showSearch()));
    menu.addItem((item) => item
      .setSection("find")
      .setDisabled(mode !== "source")
      .setTitle(host.t.interface.menu.replace())
      .setIcon("lucide-file-search")
      .onClick(() => this.showSearch(true)));
    if (host.Platform.canExportPdf) {
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(host.tc.exportPdf())
        .setIcon("lucide-file-down")
        .onClick(() => this.printToPdf()));
    }
  };

  proto.onResize = function () { this.currentMode.onResize(); };

  proto.onCssChange = function () { this.editMode.onCssChange(); };

  proto.loadFrontmatter = function (data) {
    const frontmatter = host.extractFrontmatter(data).frontmatter;
    if (this.rawFrontmatter === null || this.rawFrontmatter !== frontmatter) {
      this.rawFrontmatter = frontmatter;
      let parsed;
      try {
        parsed = host.parseYaml(frontmatter) ?? {};
        if (typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Frontmatter must be a valid object!");
        }
      } catch (e) {
        parsed = null;
      }
      this.editMode.setCssClass(host.frontmatterClasses(parsed));
      this.metadataEditor.synchronize(parsed);
    }
  };

  proto.onInternalDataChange = function () {
    const data = this.currentMode.get();
    if (this.data !== data) {
      this.data = data;
      this.leaf.workspace.onQuickPreview(this.file, this.data);
      this.loadFrontmatter(data);
    }
  };

  proto.onExternalDataChange = function (file, data) {
    if (file === this.file) this.setData(data, false);
  };

  proto.setViewData = function (data, isNewFile) {
    const currentMode = this.currentMode;
    const modes = this.modes;
    if (isNewFile) {
      this.scroll = null;
      for (const key in modes) if (modes.hasOwnProperty(key)) modes[key].set(data, true);
      const foldInfo = this.app.foldManager.load(this.file);
      if (foldInfo) currentMode.applyFoldInfo(foldInfo);
      this.metadataEditor.setCollapse(!!foldInfo && foldInfo.folds.some((fold) => fold.from === 0), false);
    } else {
      currentMode.set(data, false);
    }
    this.loadFrontmatter(data);
  };

  proto.onConfigChanged = function (key) {
    if (key === "spellcheck") this.inlineTitleEl.spellcheck = this.app.vault.getConfig("spellcheck");
  };

  proto.updateOptions = function () {
    const modes = this.modes;
    for (const key in modes) if (modes.hasOwnProperty(key)) modes[key].updateOptions();
  };

  proto.showSearch = function (replace) {
    if (replace === undefined) replace = false;
    this.currentMode.showSearch(replace);
  };

  proto.canShowProperties = function () {
    return (this.getMode() !== "source" || !this.editMode.sourceMode)
      && this.app.vault.getConfig("propertiesInDocument") === "visible";
  };

  proto.undo = function () { this.editMode.editor.undo(); };

  proto.redo = function () { this.editMode.editor.redo(); };

  proto.metadataHasFocus = function () { return this.metadataEditor.hasFocus(); };

  proto.getSelection = function () { return this.currentMode.getSelection(); };

  proto.printToPdf = function () {
    new host.PrintToPdfModal(this.app, this.file).open();
  };

  proto.triggerClickableToken = function (token, event) {
    const self = this;
    if (token.type === "internal-link") {
      setTimeout(() => {
        self.app.workspace.openLinkText(token.text, self.file.path, event);
      }, 100);
    } else if (token.type === "external-link") {
      window.open(token.text);
    } else if (token.type === "tag") {
      let tag = token.text;
      if (!tag.startsWith("#")) tag = "#" + tag;
      const search = this.app.internalPlugins.getEnabledPluginById("global-search");
      if (search) search.openGlobalSearch("tag:" + tag);
    }
  };

  proto.handleCut = function (event) {
    if (this.metadataEditor.hasFocus()) this.metadataEditor.handleCut(event);
  };

  proto.handleCopy = function (event) {
    if (this.metadataEditor.hasFocus()) this.metadataEditor.handleCopy(event);
  };

  proto.handlePaste = function (event) {
    if (event.clipboardData.getData("basalt/properties")) this.metadataEditor.handlePaste(event);
  };

  MarkdownView.VIEW_TYPE = VIEW_TYPE;
  return MarkdownView;
}
