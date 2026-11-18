// Slice s26 — markdown embeds: MarkdownEmbedBase (source/preview modes), the
// iframe-capable embed edit mode, the preview mode, the Bases file embed view,
// the public HoverPopover and the iOS editor-extension pair.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { focusWhenShown, pointOfEvent } from "./misc.js";
import { installTooltipHandlers } from "./tooltip.js";
import { s26InstallEnhancements, s26AttachElectron } from "./s26-window.js";
import { s10IsEditableTarget, s10ForwardDomEvent } from "./s10-app.js";

/** `var I$` — `iosEditorExtensions`: the two iOS-only CodeMirror extensions. */
export function s26IosEditorExtensions() {
  return [env().P$, env().L$];
}

/** `var wZ` — edit mode of a markdown embed; can run inside a sandboxed iframe. */
export function s26EmbedEditMode(host) {
  const Base = host.EditModeBase;
  function EmbedEditMode(owner) {
    const self = Base.call(this, owner.app, owner.editorEl, owner) || this;
    self.iframeEl = null;
    self.cleanup = null;
    self.requestSaveFolds = debounceCall(() => self.onMarkdownFold(), 500);
    self.owner = owner;
    if (owner.useIframe) {
      self.editorEl.detach();
      self.editorEl.addClass("mod-inside-iframe");
      const iframe = self.iframeEl = owner.editorEl.createEl("iframe", "embed-iframe is-controlled");
      iframe.setAttr("sandbox", "allow-forms allow-presentation allow-same-origin allow-scripts allow-modals");
      if (iframe.contentDocument) self.onIframeLoad();
      iframe.onload = self.onIframeLoad.bind(self);
    }
    if (owner instanceof host.StatefulEmbedBase) self.sizerEl.prepend(owner.inlineTitleEl);
    return self;
  }
  inherit(EmbedEditMode, Base);

  EmbedEditMode.prototype.cleanupIframe = function () {
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
  };
  EmbedEditMode.prototype.onunload = function () {
    Base.prototype.onunload.call(this);
    this.cleanupIframe();
  };
  EmbedEditMode.prototype.onIframeLoad = function () {
    this.cleanupIframe();
    const iframe = this.iframeEl, doc = iframe.contentDocument, win = iframe.contentWindow;
    const base = doc.createElement("base");
    base.href = location.href;
    doc.head.appendChild(base);
    host.forwardInputEvents(win);
    win.addEventListener("focus", (e) => {
      iframe.win.dispatchEvent(s10ForwardDomEvent(e));
      iframe.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    }, { capture: true });
    win.addEventListener("blur", (e) => iframe.win.dispatchEvent(s10ForwardDomEvent(e)), { capture: true });
    this.cleanup = host.mirrorStyles(win, [base]);
    win.app = this.app;
    s26InstallEnhancements(win);
    if (host.Platform.isDesktopApp) s26AttachElectron(win, host);
    installTooltipHandlers(doc);
    doc.body.setCssProps({
      "--safe-area-inset-top": "0", "--safe-area-inset-bottom": "0",
      "--safe-area-inset-left": "0", "--safe-area-inset-right": "0",
    });
    env().activeWindow.setTimeout(() => this.reparent(doc.body));
  };
  EmbedEditMode.prototype.onUpdate = function (update, transactions) {
    Base.prototype.onUpdate.call(this, update, transactions);
    if (transactions) {
      const doc = update.state.doc;
      this.owner.save(doc.toString());
      this.requestSaveFolds();
    }
    const tr = update.transactions;
    if (env().VA(tr, host.cmFoldEffect) || env().VA(tr, host.cmUnfoldEffect)) this.requestSaveFolds();
  };
  EmbedEditMode.prototype.getDynamicExtensions = function () {
    const extensions = Base.prototype.getDynamicExtensions.call(this);
    if (!this.sourceMode) {
      let props = this.propertiesExtension;
      if (!props) props = this.propertiesExtension = host.propertiesExtensionFactory(this);
      extensions.push(props);
    }
    extensions.push(host.cmKeymapFacet.of([{
      key: "Escape",
      run: (view) => {
        const vim = view.cm?.vim;
        if (!vim || !vim.insertMode) { this.owner.showPreview(true); return true; }
        return false;
      },
    }]));
    return extensions;
  };
  return EmbedEditMode;
}

/** `var kZ` — preview mode of a markdown embed (wraps the markdown renderer). */
export function s26EmbedPreviewMode(host) {
  const Base = host.MarkdownRenderer;
  function EmbedPreviewMode(owner, flag = true) {
    const self = Base.call(this, owner.app, owner.previewEl, flag) || this;
    self.search = null;
    self.owner = owner;
    self.onFoldChange = debounceCall(() => self.owner.onMarkdownFold(), 500);
    return self;
  }
  inherit(EmbedPreviewMode, Base);

  Object.defineProperty(EmbedPreviewMode.prototype, "file", {
    get: function () { return this.owner.file; }, enumerable: false, configurable: true,
  });

  EmbedPreviewMode.prototype.set = function (text) {
    const app = this.app, renderer = this.renderer;
    renderer.set(text);
    renderer.previewEl.toggleClass("rtl", app.vault.getConfig("rightToLeft"));
    renderer.previewEl.toggleClass("show-indentation-guide", app.vault.getConfig("showIndentGuide"));
    renderer.applyFoldInfo(this.owner.getFoldInfo());
    const foldHeading = app.vault.getConfig("foldHeading"), foldIndent = app.vault.getConfig("foldIndent");
    renderer.previewEl.toggleClass("allow-fold-headings", foldHeading);
    renderer.previewEl.toggleClass("allow-fold-lists", foldIndent);
    if (!foldHeading) renderer.unfoldAllHeadings();
    if (!foldIndent) renderer.unfoldAllLists();
  };
  EmbedPreviewMode.prototype.foldAll = function () {
    const config = this.app.vault;
    if (config.getConfig("foldHeading")) this.renderer.foldAllHeadings();
    if (config.getConfig("foldIndent")) this.renderer.foldAllLists();
  };
  EmbedPreviewMode.prototype.unfoldAll = function () {
    const config = this.app.vault;
    if (config.getConfig("foldHeading")) this.renderer.unfoldAllHeadings();
    if (config.getConfig("foldIndent")) this.renderer.unfoldAllLists();
  };
  EmbedPreviewMode.prototype.edit = function (text) {
    this.renderer.set(text);
    this.owner.save(text, true);
  };
  EmbedPreviewMode.prototype.onunload = function () {
    Base.prototype.onunload.call(this);
    if (this.search) this.owner.applyScope(null);
  };
  EmbedPreviewMode.prototype.showSearch = function () {
    if (!this.search) {
      const self = this;
      this.search = new (host.DocumentSearch)(this.app.scope, this.renderer, this.containerEl, () => {
        self.search = null;
        self.owner.applyScope(null);
      });
      this.owner.applyScope(this.search.scope);
    }
  };
  EmbedPreviewMode.prototype.onScroll = function () { this.owner.syncScroll(); };
  return EmbedPreviewMode;
}

/** `var CZ` — MarkdownEmbedBase: an embedded markdown document with source/preview modes. */
export function s26MarkdownEmbedBase(host) {
  const Base = host.Component;
  function MarkdownEmbedBase(app, containerEl, file, state) {
    const self = Base.call(this) || this;
    self.file = null;
    self.hoverPopover = null;
    self.editable = false;
    self.text = "";
    self.dirty = false;
    self.useIframe = false;
    self.requestSaveFolds = debounceCall(() => self.onMarkdownFold(), 500);
    self.requestSave = debounceCall(() => self.save(self.text, true), 2000);
    self.app = app;
    self.containerEl = containerEl;
    self.file = file;
    self.state = state;
    self.previewEl = self.containerEl.createDiv("markdown-embed-content");
    self.editorEl = self.containerEl.createDiv("markdown-embed-content");
    env().cg(self.previewEl);
    env().cg(self.editorEl);
    self.previewMode = self.addChild(new (env().kZ)(self));
    return self;
  }
  inherit(MarkdownEmbedBase, Base);

  MarkdownEmbedBase.prototype.onload = function () {
    const state = this.state;
    if (state?.mode === "source") this.showEditor();
    else this.showPreview();
  };
  MarkdownEmbedBase.prototype.save = function (text, immediate = false) {
    this.text = text;
    this.dirty = !immediate;
    if (!immediate) this.requestSave();
    this.set(text);
  };
  MarkdownEmbedBase.prototype.set = function (text, scroll) {
    this.text = text;
    this.previewMode.set(text);
    if (this.editMode) this.editMode.set(text, scroll);
  };
  MarkdownEmbedBase.prototype.showSearch = function (show) {
    if (this.editMode) this.editMode.showSearch(show);
    else this.previewMode.showSearch();
  };
  MarkdownEmbedBase.prototype.destroyEditor = function (save = false) {
    const editMode = this.editMode;
    if (editMode) {
      if (save) { this.requestSave.cancel(); this.save(editMode.cm.state.doc.toString(), true); }
      editMode.destroy();
      this.removeChild(editMode);
      this.editMode = null;
    }
    this.editorEl.empty();
    this.applyScope(null);
    this.app.workspace.unsetActiveEditor(this);
  };
  MarkdownEmbedBase.prototype.onunload = function () {
    this.destroyEditor();
    this.containerEl.empty();
    this.app.workspace.unsetActiveEditor(this);
  };
  MarkdownEmbedBase.prototype.showPreview = function (scroll = false) {
    let savedScroll = null;
    if (this.editMode) savedScroll = this.editMode.getScroll();
    this.editorEl.hide();
    this.previewEl.show();
    this.destroyEditor(scroll);
    const foldInfo = this.getFoldInfo();
    if (savedScroll !== null) {
      this.previewMode.renderer.applyScrollDelayed(savedScroll);
      this.previewMode.renderer.applyFoldInfo(foldInfo);
    }
  };
  MarkdownEmbedBase.prototype.showEditor = function (point) {
    if (!this.editable) return;
    const scroll = this.previewMode.renderer.getScroll();
    this.previewEl.hide();
    this.editorEl.show();
    let editMode = this.editMode;
    if (!editMode) editMode = this.editMode = this.addChild(new (env().wZ)(this));
    editMode.set(this.text, true);
    const foldInfo = this.getFoldInfo();
    focusWhenShown(editMode.editorEl, () => {
      editMode.applyFoldInfo(foldInfo);
      editMode.applyScroll(scroll);
      editMode.focus();
      if (point) {
        if (editMode.iframeEl) {
          const frame = host.frameOffset(editMode.iframeEl.contentWindow);
          point = { x: (point.x - frame.x) / frame.scale, y: (point.y - frame.y) / frame.scale };
        }
        editMode.editorEl.win.setTimeout(() => {
          editMode.cm.dispatch({ userEvent: "select.pointer", selection: host.cmSelection.single(editMode.cm.posAtCoords(point, false)) });
        });
      }
    });
  };
  Object.defineProperty(MarkdownEmbedBase.prototype, "path", {
    get: function () { return this.file?.path || ""; }, enumerable: false, configurable: true,
  });
  Object.defineProperty(MarkdownEmbedBase.prototype, "editor", {
    get: function () { return this.editMode?.editor; }, enumerable: false, configurable: true,
  });
  MarkdownEmbedBase.prototype.getMode = function () { return this.editMode ? "source" : "preview"; };
  MarkdownEmbedBase.prototype.toggleMode = function () {
    if (this.getMode() === "preview") this.showEditor();
    else this.showPreview();
  };
  MarkdownEmbedBase.prototype.syncScroll = function () { this.app.workspace.trigger("markdown-scroll", this); };
  Object.defineProperty(MarkdownEmbedBase.prototype, "scroll", {
    get: function () { return this.getMode() === "preview" ? this.previewMode.renderer.getScroll() : this.editMode.getScroll(); },
    enumerable: false, configurable: true,
  });
  return MarkdownEmbedBase;
}

/** `var E$` — BasesEmbed: renders a `.base` file inside a markdown document. */
export function s26BasesEmbedView(host) {
  const Base = host.Component;
  function BasesEmbed(app, plugin, info, file, viewName) {
    const self = Base.call(this) || this;
    self.requestSave = debounceCall(async (text) => {
      await self.app.vault.modify(self.file, text.toString());
    }, 1000);
    self.app = app;
    self.file = file;
    self.containerEl = info.containerEl;
    self.plugin = plugin;
    self.containerEl.addClass("bases-embed", "interactive-child");
    const containingFile = app.vault.getFileByPath(info.sourcePath);
    self.containingFile = containingFile;
    self.controller = new (env().C$)(app, plugin, self.containerEl, containingFile);
    self.addChild(self.controller);
    self.viewName = viewName;
    self.linkText = info.linktext;
    return self;
  }
  inherit(BasesEmbed, Base);

  BasesEmbed.prototype.onload = function () {
    const self = this;
    Base.prototype.onload.call(this);
    this.registerEvent(this.app.vault.on("modify", (file) => {
      (async () => {
        if (!this.file || file !== this.file) return;
        let query;
        try { query = await this.loadQuery(); }
        catch (e) { query = e; }
        this.controller.setQuery(query);
      })();
    }));
  };
  BasesEmbed.prototype.loadFile = async function () {
    let query;
    try { query = await this.loadQuery(); }
    catch (e) { query = e; }
    this.controller.clear();
    this.controller.setQueryAndView(query, this.viewName);
  };
  BasesEmbed.prototype.loadQuery = async function () {
    const text = await this.app.vault.read(this.file);
    const query = env().EY.fromString(text);
    query.file = this.file;
    query.saveFn = () => { this.controller.setQuery(query); this.requestSave(query); };
    return query;
  };
  return BasesEmbed;
}

/** `var S$` — HoverPopover (public API): hover preview that lazily loads an embed. */
export function s26HoverPopover(host) {
  const Base = env().rX;
  function HoverPopover(hoverParent, targetEl, waitTime, position) {
    const self = Base.apply(this, arguments) || this;
    return self;
  }
  inherit(HoverPopover, Base);

  HoverPopover.create = async function (options) {
    const app = options.app, hoverParent = options.hoverParent, targetEl = options.targetEl;
    const waitTime = options.waitTime, position = options.position;
    const linktext = options.linktext, sourcePath = options.sourcePath, state = options.state;
    const popover = new HoverPopover(hoverParent, targetEl, waitTime, position);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, popover.waitTime - 100)));
    if (popover.state === host.PopoverState.Hidden) return null;
    const hoverEl = popover.hoverEl.createDiv();
    const embed = popover.embed = host.EmbedLoader.load({
      app, linktext, sourcePath, containerEl: hoverEl, state, depth: 0,
    });
    if (embed) {
    const enterEdit = () => {
      popover.setIsFocused(true);
      popover.hoverEl.toggleClass("is-editing", true);
      const scope = new (host.Scope)(app.scope);
      app.keymap.pushScope(scope);
      embed.register(() => app.keymap.popScope(scope));
      embed.registerDomEvent(embed.containerEl.win, "click", (e) => {
        if (e.defaultPrevented) return;
        if (!hoverEl.contains(e.targetNode)) popover.hide();
      });
    };
    let editorAt = null;
    if (embed instanceof host.s13BasesEmbedView) {
      host.nativeDblClick(embed.containerEl, () => enterEdit());
    } else if (embed instanceof host.StatefulEmbedBase) {
      editorAt = (point) => { embed.showEditor(point); embed.editMode.register(() => popover.hide()); };
      if (state?.mode === "source") {
        app.workspace.activeEditor = embed;
        enterEdit();
        editorAt();
      } else {
        host.nativeDblClick(embed.containerEl, (e) => {
          if (embed.editorEl.isShown()) return;
          app.workspace.activeEditor = embed;
          enterEdit();
          if (!s10IsEditableTarget(e.targetNode, host)) editorAt(pointOfEvent(e));
        });
      }
    }
    popover.watchResize(hoverEl);
    popover.addChild(embed);
    await embed.loadFile();
    }
    if (popover.state === host.PopoverState.Shown) popover.position();
    return popover;
  };
  return HoverPopover;
}
