// Canvas leaf classes: color helper, URL modal, section/block suggestion modal, edge label,
// jump-to-group and view-type suggester modals, markdown embed and empty-embed components.
// The node/edge base classes (S5/A5/x5/G5/y5/...) are ported separately; until then the
// registry `canvas.*` is used so factory order never matters for classes defined later.
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { parseLinktext, extensionOf } from "./path.js";
import { pointOfEvent } from "./misc.js";
import { renderResults } from "./search-simple.js";

const cvCanvasT = (host) => host.t.plugins.canvas;
const cvInterfaceT = (host) => host.t.interface;
const cvTemplatesT = (host) => host.t.plugins.templates;
const cvCommandPaletteT = (host) => host.t.plugins.commandPalette;

// Colors are applied through the still-inherited helpers (B3/H3) via the host map until they get
// their own ports; the class factories below only need the host at call time.

// =====================================================================================================================
// URL editor modal (w5): a text-input modal that validates the URL before saving
// =====================================================================================================================

export function defineUrlEditModal(host) {
  class UrlEditModal extends host.TextInputModal {
    constructor(app, url, onSave) {
      super(app, url);
      this.title = cvCanvasT(host).labelEnterUrl();
      this.onSave = onSave;
    }

    validate(value) {
      super.validate(value);
      try {
        new URL(value);
      } catch (e) {
        return "Invalid URL";
      }
      return null;
    }

    async submit(value) {
      const error = this.validate(value);
      if (error) {
        this.displayError(error, false);
        return true;
      }
      this.close();
      this.onSave(value);
      return undefined;
    }
  }
  canvas.UrlModal = UrlEditModal;
  return UrlEditModal;
}

// =====================================================================================================================
// Section/block narrow suggestion modal (E5): pick a heading or block to narrow a canvas file card to
// =====================================================================================================================

export function defineSectionSuggestModal(host) {
  class SectionSuggestModal extends host.SuggestModal {
    constructor(app, file, mode, cb) {
      super(app);
      this.fileSuggestions = null;
      this.mode = "heading";
      this.runnable = null;
      this.emptyStateText = cvCanvasT(host).labelNoSectionFound();
      this.file = file;
      this.cb = cb;
      this.mode = mode;
      this.setInstructions([
        { command: "↑↓", purpose: cvTemplatesT(host).instructionNavigate() },
        { command: "↵", purpose: this.mode === "block" ? cvCanvasT(host).instructionNarrowBlock() : cvCanvasT(host).instructionNarrowHeading() },
        { command: "esc", purpose: cvTemplatesT(host).instructionDismiss() },
      ]);
      this.setPlaceholder(cvCanvasT(host).promptToNarrow());
    }

    onChooseSuggestion(item) {
      this.cb(item);
    }

    async getSuggestions(query) {
      query = query.trim();
      const items = await this.getSuggestionsAsync(query);
      if (!items) return null;
      items.sort((a, b) => b.score - a.score);
      if (!query) {
        items.unshift({ alias: cvCanvasT(host).labelNoNarrow(), type: "alias", file: this.file, matches: null, path: this.file.path, score: 0 });
      }
      return items;
    }

    async getSuggestionsAsync(query) {
      const mode = this.mode;
      if (this.runnable) this.runnable.cancel();
      this.runnable = new host.Runnable();
      if (mode === "block") return this.getBlockSuggestions(this.runnable, query);
      if (mode === "heading") {
        let q = query;
        if (!q.startsWith("#")) q = "#" + q;
        return this.getHeadingSuggestions(this.runnable, q);
      }
      return [];
    }

    async getHeadingSuggestions(runnable, query) {
      const cache = this.app.metadataCache;
      const headings = cache.getFileCache(this.file)?.headings;
      return host.headingBlockSuggestions(runnable, this.file, headings, this.file.path, query);
    }

    async getBlockSuggestions(runnable, query) {
      const blocks = await this.app.metadataCache.blockCache.getForFile(runnable, this.file);
      return host.blockSuggestions(runnable, this.file, this.file.path, blocks, query);
    }

    renderSuggestion(item, el) {
      host.renderSectionSuggestion(item, el);
    }

    close() {
      super.close();
      this.fileSuggestions = null;
    }
  }
  canvas.SectionSuggest = SectionSuggestModal;
  return SectionSuggestModal;
}

// =====================================================================================================================
// Edge label editor (K5): contenteditable label centered on a canvas edge
// =====================================================================================================================

export function defineEdgeLabel(host) {
  class EdgeLabel {
    constructor(edge) {
      this.isEditing = false;
      this.initialTextState = "";
      this.edge = edge;
      const canvas = edge.canvas;
      this.wrapperEl = canvas.canvasEl.createDiv("canvas-path-label-wrapper");
      this.wrapperEl.addEventListener("click", (evt) => {
        if (canvas.readonly) return;
        if (evt.shiftKey) {
          this.blur();
          canvas.toggleSelect(edge);
          return;
        }
        const selection = canvas.selection;
        if (selection.size === 1 && selection.has(edge)) {
          if (!this.isEditing) this.focus(pointOfEvent(evt));
        } else {
          canvas.selectOnly(edge);
        }
      });
      this.textareaEl = this.wrapperEl.createDiv(
        { parent: this.wrapperEl, cls: "canvas-path-label", text: this.edge.label, attr: { contentEditable: false, "data-placeholder": cvCanvasT(host).promptAddText() } },
        (el) => {
          el.addEventListener("input", () => {
            this.edge.label = el.innerText;
            this.edge.canvas.requestSave(false);
          });
          if (!this.edge.label) setTimeout(() => this.focus());
        },
      );
      this.render();
    }

    setText(text) {
      this.textareaEl.setText(text);
    }

    focus(point) {
      const el = this.textareaEl;
      this.isEditing = true;
      el.setAttr("contenteditable", true);
      el.addClass("is-editing");
      let range;
      if (point) {
        range = el.doc.caretRangeFromPoint(point.x, point.y);
      } else {
        range = el.doc.createRange();
        range.selectNodeContents(el);
      }
      const selection = el.win.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      el.focus();
      this.initialTextState = this.edge.label || "";
    }

    blur() {
      const el = this.textareaEl;
      this.isEditing = false;
      el.blur();
      el.setAttr("contenteditable", false);
      el.removeClass("is-editing");
      if (this.edge.label) {
        if (this.initialTextState !== this.edge.label) this.edge.canvas.requestSave();
      } else {
        this.destroy();
      }
      this.initialTextState = "";
    }

    render() {
      const el = this.wrapperEl;
      const center = this.edge.getCenter();
      el.style.transform = `translate(${center.x}px, ${center.y}px)`;
      host.applyCanvasColor(el, this.edge.color);
      el.toggleClass("is-themed", !!this.edge.color);
    }

    destroy(keepLabel) {
      const edge = this.edge;
      if (edge.label) delete edge.label;
      if (this.initialTextState && !keepLabel) edge.canvas.requestSave();
      this.wrapperEl.remove();
      edge.labelElement = null;
    }
  }
  canvas.EdgeLabel = EdgeLabel;
  return EdgeLabel;
}

// =====================================================================================================================
// Jump-to-group suggester (Q5) and view-type suggester (L5)
// =====================================================================================================================

export function defineJumpToGroupModal(host) {
  class JumpToGroupSuggestModal extends host.FuzzySuggestModal {
    constructor(view, cb) {
      super(view.app);
      this.emptyStateText = cvCanvasT(host).msgNoGroupsFound();
      this.view = view;
      this.cb = cb;
      this.setInstructions([
        { command: "↑↓", purpose: cvTemplatesT(host).instructionNavigate() },
        { command: "↵", purpose: cvCanvasT(host).instructionJumpToGroup() },
        { command: "esc", purpose: cvTemplatesT(host).instructionDismiss() },
      ]);
      this.setPlaceholder(cvCanvasT(host).actionJumpToGroup());
      this.scope.register(null, "Tab", () => false);
    }

    getItems() {
      return this.view.canvas.getData().nodes.filter((node) => node.type === "group");
    }

    onChooseItem(item) {
      this.cb(item);
    }

    getItemText(item) {
      return item.label || cvCanvasT(host).labelUntitledGroup();
    }
  }
  canvas.JumpModal = JumpToGroupSuggestModal;
  return JumpToGroupSuggestModal;
}

export function defineViewTypeSuggestModal(host) {
  class ViewTypeSuggestModal extends host.FuzzySuggestModal {
    constructor(app, views, currentViewName, cb) {
      super(app);
      this.views = views;
      this.currentViewName = currentViewName;
      this.cb = cb;
      this.setInstructions([
        { command: "↑↓", purpose: cvCommandPaletteT(host).instructionNavigate() },
        { command: "↵", purpose: cvInterfaceT(host).instructionUse() },
        { command: "esc", purpose: cvCommandPaletteT(host).instructionDismiss() },
      ]);
      this.scope.register(null, "Tab", () => false);
      this.scope.register(null, "Enter", (evt) => {
        if (evt.isComposing) return;
        this.selectActiveSuggestion(evt);
        return false;
      });
    }

    getItems() {
      return this.views;
    }

    getItemText(item) {
      return item ? item.name : "";
    }

    renderSuggestion(item, el) {
      el.addClass("mod-complex");
      const iconEl = el.createDiv("suggestion-icon");
      const contentEl = el.createSpan("suggestion-content").createDiv("suggestion-title");
      const view = item.item;
      if (view !== null) {
        renderResults(contentEl, view.name, item.match);
        if (view.name === this.currentViewName) {
          el.createSpan("suggestion-aux").createSpan({ cls: "flair toolbar-badge", text: cvInterfaceT(host).labelCurrentlyActive() });
        }
        const basesPlugin = this.app.internalPlugins.getEnabledPluginById("bases");
        if (basesPlugin) {
          const registration = basesPlugin.getRegistration(view.type);
          host.setIcon(iconEl.createDiv("suggestion-flair"), registration && registration.icon || "lucide-table");
        }
      } else {
        contentEl.setText(cvCanvasT(host).labelShowDefaultView());
      }
    }

    onChooseItem(item) {
      this.cb(item.name);
    }
  }
  canvas.ViewTypeSuggest = ViewTypeSuggestModal;
  return ViewTypeSuggestModal;
}

// =====================================================================================================================
// Markdown embed inside a text node (O5) and the empty-embed placeholder (N5)
// =====================================================================================================================

export function defineCanvasMarkdownEmbed(host) {
  class CanvasMarkdownEmbed extends host.MarkdownEmbedBase {
    constructor(node) {
      super(node.app, node.contentEl, null);
      this.editable = true;
      this.useIframe = true;
      this.scope = null;
      this.node = node;
      this.containerEl.addClass("markdown-embed");
    }

    save(content, force) {
      super.save(content, force);
      if (force && this.node.text !== content) {
        this.node.text = content;
        this.node.canvas.requestSave();
      }
    }

    applyScope(scope) {
      if (scope === this.scope) return;
      if (this.scope) this.app.keymap.popScope(this.scope);
      if (scope) this.app.keymap.pushScope(scope);
      this.scope = scope;
    }

    onunload() {
      super.onunload();
      this.applyScope(null);
    }

    get linktext() {
      const node = this.node;
      return node.canvas.view.file.path + "#^" + node.id;
    }

    getFoldInfo() {
      return this.app.foldManager.loadPath(this.linktext);
    }

    onMarkdownFold() {
      const info = this.getMode() === "preview" ? this.previewMode.renderer.getFoldInfo() : this.editMode.getFoldInfo();
      this.app.foldManager.savePath(this.linktext, info);
    }
  }
  canvas.MarkdownEmbed = CanvasMarkdownEmbed;
  return CanvasMarkdownEmbed;
}

export function defineCanvasEmptyEmbed(host) {
  class CanvasEmptyEmbed extends host.Component {
    constructor(ctx, node, reload) {
      super(ctx.app, ctx.contentEl, null);
      this.file = null;
      this.ctx = ctx;
      this.node = node;
      this.reload = reload;
      this.containerEl = ctx.containerEl;
    }

    async loadFile() {
      const containerEl = this.containerEl;
      const ctx = this.ctx;
      const app = ctx.app;
      const linktext = ctx.linktext;
      const sourcePath = ctx.sourcePath;
      const node = this.node;
      const canvas = node.canvas;
      node.contentBlockerEl.detach();
      const path = parseLinktext(linktext).path;
      containerEl.createDiv("canvas-empty-embed-container", (el) => {
        el.createDiv({ cls: "canvas-empty-embed-label", text: cvCanvasT(host).labelEmptyEmbed({ linktext }) });
        el.createDiv("canvas-empty-embed-action-list", (list) => {
          const fileExt = extensionOf(path);
          if (fileExt === "md" || fileExt === "") {
            list.createEl("button", { cls: "empty-state-action", text: cvInterfaceT(host).emptyState.createNewFile() }, (btn) => {
              btn.addEventListener("click", () => {
                app.fileManager.createNewMarkdownFileFromLinktext(linktext, sourcePath);
              });
            });
          }
          list.createEl("button", { cls: "empty-state-action", text: cvCanvasT(host).actionSwapFile() }, (btn) => {
            btn.addEventListener("click", () => {
              new host.CanvasFileSuggest(canvas, (file) => {
                node.setFile(file, "", canvas.requestSave());
              }).open();
            });
          });
          list.createEl("button", { cls: "empty-state-action mod-warning", text: cvCanvasT(host).actionRemove() }, (btn) => {
            btn.addEventListener("click", () => {
              canvas.removeNode(node);
              canvas.requestSave();
            });
          });
        });
      });
      containerEl.addClass("mod-canvas-empty");
    }

    onload() {
      const ctx = this.ctx;
      const app = ctx.app;
      const linktext = ctx.linktext;
      const onFileEvent = debounceCall((file) => {
        const parsed = parseLinktext(linktext);
        if (file instanceof host.TFile && file.path === parsed.path) {
          this.node.setFile(file, parsed.subpath, true);
        }
      });
      this.registerEvent(app.vault.on("create", onFileEvent));
      this.registerEvent(app.vault.on("rename", onFileEvent));
    }

    onClick(evt) {
      const ctx = this.ctx;
      ctx.app.workspace.openLinkText(ctx.linktext, ctx.sourcePath, host.Keymap.isModEvent(evt));
    }
  }
  canvas.EmptyEmbed = CanvasEmptyEmbed;
  return CanvasEmptyEmbed;
}

// =====================================================================================================================
// Rename prompt modal (lI) and new-file modal (cI)
// =====================================================================================================================

export function defineRenamePromptModal(host) {
  class RenamePromptModal extends host.ButtonModal {
    constructor(app, initialValue) {
      super(app);
      this.title = host.t.dialogue.labelRenameFileGeneric();
      this.modalEl.addClass("mod-file-rename");
      const inputEl = (this.inputEl = createEl("textarea", { cls: "rename-textarea" }));
      inputEl.rows = 1;
      inputEl.innerText = initialValue;
      app.nextFrame(() => {
        inputEl.style.height = "auto";
        inputEl.style.height = inputEl.scrollHeight + "px";
      });
      inputEl.addEventListener("keypress", (evt) => {
        if (evt.key !== "Enter" || evt.isComposing) return;
        evt.preventDefault();
        this.submit(inputEl.value.trim());
      });
      inputEl.addEventListener("input", () => {
        host.hideTooltip();
        inputEl.rows = 1;
        inputEl.style.height = "auto";
        inputEl.style.height = inputEl.scrollHeight + "px";
        const error = this.validate(inputEl.value.trim());
        if (error) this.displayError(error, false);
      });
      this.setContent(createFragment((frag) => frag.appendChild(inputEl)))
        .addButton("mod-cta", host.t.dialogue.buttonSave(), () => this.submit(inputEl.value.trim()))
        .addCancelButton();
    }

    validate(value) {
      return "";
    }

    onOpen() {
      super.onOpen();
      this.setTitle(this.title);
      this.inputEl.select();
      this.inputEl.focus();
    }

    displayError(message, autoHide) {
      host.displayTooltip(this.inputEl, message, { classes: ["mod-wide", "mod-error"] });
      if (autoHide) setTimeout(() => host.hideTooltip(), 2000);
    }
  }
  canvas.RenamePrompt = RenamePromptModal;
  canvas.RenamePrompt = RenamePromptModal;
  return RenamePromptModal;
}

export function defineNewFileModal(host) {
  class NewFileModal extends canvas.RenamePrompt {
    constructor(app, initialValue, onSave) {
      super(app, initialValue);
      this.onSave = onSave;
    }

    validate(value) {
      if (host.invalidCharsPattern.test(value)) return host.t.plugins.fileExplorer.msgInvalidCharacters() + host.invalidCharsList;
      if (value.startsWith(".")) return host.t.plugins.fileExplorer.msgBadDotfile();
      if (host.unsafeCharsPattern.test(value)) return host.t.plugins.fileExplorer.msgUnsafeCharacters() + host.unsafeCharsList;
      return "";
    }

    async submit(value) {
      const error = this.validate(value);
      if (error) {
        this.displayError(error, false);
        return true;
      }
      this.close();
      this.onSave(value);
      return undefined;
    }
  }
  canvas.NewFileModal = NewFileModal;
  return NewFileModal;
}

// =====================================================================================================================
// Canvas file/media/image suggester modals (x3 / T3 / D3) — all extend the quick-switcher file suggest base
// =====================================================================================================================

function canvasSuggestFlags(host, ctx) {
  const flags = {
    emptyStateText: ctx.empty,
    context: "embed",
    canvas: ctx.canvas,
    handleClose: ctx.onClose,
    handleChoose: ctx.onChoose,
    shouldShowUnresolved: false,
    shouldShowMarkdown: ctx.markdown,
    shouldShowNonAttachments: ctx.attachments,
    shouldShowImages: ctx.images,
    shouldShowNonImageAttachments: ctx.nonImageAttachments,
    shouldShowAllTypes: ctx.allTypes ? ctx.app.vault.getConfig("showUnsupportedFiles") : false,
  };
  if (ctx.allowCreate !== undefined) flags.allowCreateNewFile = ctx.allowCreate;
  return flags;
}

export function defineCanvasFileSuggest(host) {
  class CanvasFileSuggest extends palette.ModalBase {
    constructor(canvas, onChoose, onClose) {
      super(canvas.view.app);
      const flags = canvasSuggestFlags(host, {
        app: canvas.view.app, canvas, onChoose, onClose,
        empty: host.t.plugins.quickSwitcher.labelNoNoteCreateNew(),
        allowCreate: true, markdown: true, attachments: true, images: true, nonImageAttachments: true, allTypes: true,
      });
      Object.assign(this, flags);
      this.setPlaceholder(host.t.plugins.canvas.promptStartSearch());
      this.setInstructions([
        { command: "↑↓", purpose: host.t.plugins.quickSwitcher.instructionNavigate() },
        { command: "↵", purpose: host.t.plugins.quickSwitcher.instructionOpen() },
        { command: "shift ↵", purpose: host.t.plugins.quickSwitcher.instructionCreate() },
        { command: "esc", purpose: host.t.plugins.quickSwitcher.instructionDismiss() },
      ]);
      this.scope.register(["Shift"], "Enter", (evt) => {
        this.selectSuggestion(null, evt);
        return false;
      });
    }

    showMarkdownAndCanvas(show) {
      this.shouldShowMarkdown = show;
      this.shouldShowNonAttachments = show;
      return this;
    }

    showAttachments(show) {
      this.shouldShowNonImageAttachments = show;
      this.shouldShowImages = show;
      return this;
    }

    async onChooseSuggestion(suggestion) {
      if (!suggestion) {
        const parent = this.canvas.view.file.path;
        const file = await this.app.fileManager.createNewMarkdownFileFromLinktext(this.inputEl.value, parent);
        this.handleChoose(file);
        return;
      }
      if (suggestion.type !== "file" && suggestion.type !== "alias") return;
      this.handleChoose(suggestion.file);
    }

    onClose() {
      if (this.handleClose) this.handleClose();
    }
  }
  canvas.FileSuggest = CanvasFileSuggest;
  canvas.FileSuggest = CanvasFileSuggest;
  return CanvasFileSuggest;
}

export function defineCanvasMediaSuggest(host) {
  class CanvasMediaSuggest extends palette.ModalBase {
    constructor(canvas, onChoose, onClose) {
      super(canvas.view.app);
      Object.assign(this, canvasSuggestFlags(host, {
        app: canvas.view.app, canvas, onChoose, onClose,
        empty: host.t.plugins.canvas.labelNoMedia(),
        allowCreate: false, markdown: false, attachments: true, images: true, nonImageAttachments: true, allTypes: true,
      }));
      this.setPlaceholder(host.t.plugins.canvas.promptStartSearch());
      this.setInstructions([
        { command: "↑↓", purpose: host.t.plugins.quickSwitcher.instructionNavigate() },
        { command: "↵", purpose: host.t.plugins.quickSwitcher.instructionOpen() },
        { command: "esc", purpose: host.t.plugins.quickSwitcher.instructionDismiss() },
      ]);
    }

    async onChooseSuggestion(suggestion) {
      if (suggestion && (suggestion.type === "file" || suggestion.type === "alias")) {
        this.handleChoose(suggestion.file);
      }
    }

    onClose() {
      if (this.handleClose) this.handleClose();
    }
  }
  canvas.MediaSuggest = CanvasMediaSuggest;
  canvas.MediaSuggest = CanvasMediaSuggest;
  return CanvasMediaSuggest;
}

export function defineCanvasImageSuggest(host) {
  class CanvasImageSuggest extends palette.ModalBase {
    constructor(canvas, onChoose, onClose) {
      super(canvas.view.app);
      Object.assign(this, canvasSuggestFlags(host, {
        app: canvas.view.app, canvas, onChoose, onClose,
        empty: host.t.plugins.canvas.labelNoImages(),
        allowCreate: undefined, markdown: false, attachments: false, images: true, nonImageAttachments: false, allTypes: false,
      }));
      this.setPlaceholder(host.t.plugins.canvas.promptStartSearch());
      this.setInstructions([
        { command: "↑↓", purpose: host.t.plugins.quickSwitcher.instructionNavigate() },
        { command: "↵", purpose: host.t.plugins.quickSwitcher.instructionSelect() },
        { command: "esc", purpose: host.t.plugins.quickSwitcher.instructionDismiss() },
      ]);
    }

    async onChooseSuggestion(suggestion) {
      if (suggestion && suggestion.type === "file") this.handleChoose(suggestion.file);
    }

    onClose() {
      if (this.handleClose) this.handleClose();
    }
  }
  canvas.ImageSuggest = CanvasImageSuggest;
  canvas.ImageSuggest = CanvasImageSuggest;
  return CanvasImageSuggest;
}
