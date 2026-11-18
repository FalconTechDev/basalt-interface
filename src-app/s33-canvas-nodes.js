// Canvas file node, group node, the shared canvas-file index base, the canvas-file
// embed renderer and the path suggest used by the file-recovery history modal.
//
// Replaces the inherited items: P5 (file node), R5 (group node), X5 (file index base),
// a8 (canvas embed) and N8 (path suggest).
import { randomHex, isLightColor } from "./misc.js";
import { withoutMd } from "./path.js";
import { ng08BlockRefInsertion } from "./n-g08-bookmarks.js";
import { idleOrTimeout } from "./metadata-helpers.js";
import { debounceCall } from "./timing.js";
import { setElementTooltip } from "./tooltip.js";
import { s13DigitsRe } from "./s13-geom.js";
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { s33CanvasPreview, s33InterfaceStrings, s33FileExplorerStrings } from "./s33-canvas-edge.js";

// ---- file node (P5) ----------------------------------------------------------------------

export function defineS33CanvasFileNode(host) {
  /** Node that embeds a vault file (markdown note, image, pdf, canvas, base, ...). */
  class FileNode extends canvas.EditableNode {
    constructor(...args) {
      super(...args);
      this.filePath = "";
      this.subpath = "";
      this.file = null;
    }

    initFile() {
      const { filePath, file, app } = this;
      if (filePath && file?.path !== filePath) {
        this.file = null;
        const resolved = app.vault.getAbstractFileByPath(filePath);
        if (resolved instanceof host.TFile) this.file = resolved;
      }
    }

    getData() {
      return {
        ...super.getData(),
        type: "file",
        file: this.file ? this.file.path : this.filePath,
        subpath: this.subpath || undefined,
      };
    }

    setData(data) {
      super.setData(data);
      const file = data.file;
      const subpath = data.subpath;
      if (file) this.setFilePath(file, subpath || "");
    }

    setFilePath(path, subpath) {
      if (this.filePath === path && this.subpath === subpath) return;
      this.filePath = path;
      if (!(this.file && this.file.path === path && this.subpath === subpath)) {
        this.subpath = subpath;
        this.initFile();
        this.unloadChild();
      }
      this.canvas.markDirty(this);
    }

    setFile(file, subpath = "", force) {
      if (!(force || this.filePath !== file.path || this.subpath !== subpath)) return;
      this.subpath = subpath;
      this.filePath = file.path;
      if (this.file !== file) {
        this.file = file;
        this.unloadChild();
      }
      this.canvas.markDirty(this);
    }

    blur() {
      super.blur();
      this.canvas.requestUpdateFileOpen(null);
    }

    focus() {
      super.focus();
      if (this.child) this.onFileFocus();
    }

    onFileFocus() {
      const workspace = this.app.workspace;
      const active = this.child instanceof host.MarkdownEmbedBase ? this.child : null;
      workspace.activeEditor = active;
      this.canvas.requestUpdateFileOpen(this.file);
    }

    initialize() { super.initialize(); }

    updateNodeLabel(text) {
      const visibility = this.canvas.options.cardLabelVisibility;
      const nodeEl = this.nodeEl;
      let labelEl = this.labelEl;
      if (visibility !== "never") {
        if (!labelEl) {
          labelEl = this.labelEl = nodeEl.createDiv("canvas-node-label");
          labelEl.addEventListener("click", this.onLabelClick.bind(this));
          labelEl.addEventListener("dblclick", this.onLabelDblClick.bind(this));
          labelEl.addEventListener("pointerdown", this.onPointerdown.bind(this));
        }
        labelEl.toggleClass("mod-hover-label", visibility === "hover");
        labelEl.setText(text);
      } else if (labelEl) {
        labelEl.detach();
        this.labelEl = null;
      }
    }

    updateBreakpoint(mount) {
      if (mount) {
        this.mountContent();
        return;
      }
      const child = this.child;
      if (child instanceof env().eJ || child instanceof env().a8) this.mountContent();
      else this.unmountContent();
    }

    render() {
      super.render();
      const file = this.file;
      const filePath = this.filePath;
      const subpath = this.subpath;
      if (file) {
        let label = file.getShortName();
        if (subpath && file.extension === "md") label += " › " + subpath.substring(1);
        this.updateNodeLabel(label);
        this.placeholderEl.setText(label);
      } else {
        this.updateNodeLabel(createFragment((frag) => {
          host.setIcon(frag.createSpan(), "lucide-alert-triangle");
          frag.createSpan({ text: filePath });
        }));
        this.placeholderEl.setText(filePath);
      }
      if (!this.child) {
        const ctx = {
          app: this.app,
          linktext: this.filePath + this.subpath,
          sourcePath: this.canvas.view.file?.path ?? "",
          containerEl: this.contentEl,
          depth: 0,
        };
        let child;
        if (file) {
          child = this.child = host.EmbedLoader.load(ctx);
          if (child instanceof host.StatefulEmbedBase) {
            child.useLocalPropertiesFoldState = true;
            child.editable = true;
            child.useIframe = true;
          }
        } else {
          child = this.child = new canvas.EmptyEmbed(ctx, this, () => this.render());
        }
        if (this.isFocused) this.onFileFocus();
        child.load();
        (async () => {
          await child.loadFile();
          if (child instanceof env().YZ && child.viewer) {
            child.viewer.then((viewer) => {
              const pdfViewer = viewer.pdfViewer;
              const toolbar = viewer.toolbar;
              pdfViewer.setHeight("auto");
              toolbar.toolbarRightEl.createDiv("clickable-icon", (icon) => {
                host.setIcon(icon, "lucide-file-symlink");
                setElementTooltip(icon, host.t.pdf.actionSavePDFLocation());
                viewer.on("pagechanging", debounceCall(() => {
                  icon.setAttr("aria-disabled", this.subpath !== "#page=" + pdfViewer.page ? "false" : "true");
                }, 100, true));
                icon.addEventListener("click", () => {
                  this.subpath = "#page=" + pdfViewer.page;
                  this.canvas.requestSave();
                  icon.setAttr("aria-disabled", "true");
                });
              });
            });
          }
          const first = this.contentEl.firstChild;
          if (!first) return;
          let size = null;
          if (first.instanceOf(HTMLImageElement)) {
            size = { width: first.naturalWidth, height: first.naturalHeight };
            first.draggable = false;
          } else if (first.instanceOf(HTMLVideoElement)) {
            size = { width: first.videoWidth, height: first.videoHeight };
          } else if (first.instanceOf(HTMLAudioElement)) {
            const fix = () => this.resize({ width: this.width, height: first.clientHeight || 42 });
            if (first.isShown()) fix();
            else first.onNodeInserted(fix, true);
            fix();
          }
          if (size && size.height !== 0) {
            const ratio = (this.aspectRatio = size.width / size.height);
            const { width, height } = this;
            if (width / height !== ratio) {
              this.resize({ width: Math.min(width, height * ratio), height: Math.min(height, width / ratio) });
              this.canvas.overrideHistory();
            }
          }
        })();
      }
    }

    onLabelClick(evt) {
      const leafType = host.Keymap.isModEvent(evt);
      if (leafType) this.app.workspace.getLeaf(leafType).openLinkText(this.filePath + this.subpath, "");
    }

    onLabelDblClick(evt) {
      this.app.workspace.getLeaf(false).openLinkText(this.filePath + this.subpath, "");
    }

    onPointerdown(evt) {
      const child = this.child;
      const target = evt.targetNode;
      if (child instanceof env().YZ && target.instanceOf(HTMLElement) && target.parentElement?.hasClass("textLayer")) return;
      super.onPointerdown(evt);
    }

    showMenu(menu) {
      super.showMenu(menu);
      const node = this;
      const file = this.file;
      const child = this.child;
      const canvas = this.canvas;
      const strings = host.t.plugins.canvas;
      const iface = s33InterfaceStrings();
      const explorerStrings = s33FileExplorerStrings();
      if (!canvas.readonly) {
        menu.addItem((item) =>
          item.setSection("canvas").setTitle(strings.actionSwapFile()).setIcon(file ? "lucide-arrow-left-right" : "lucide-wrench").onClick(() => {
            const showMarkdown = !file || file.extension === "md" || file.extension === "canvas";
            const showAttachments = !file || file.extension !== "md";
            new canvas.FileSuggest(canvas, (picked) => {
              node.setFile(picked, "");
              node.canvas.requestSave();
            }).showMarkdownAndCanvas(showMarkdown).showAttachments(showAttachments).open();
          }),
        );
      }
      if (file) {
        if (file.extension === "md") {
          menu.addItem((item) =>
            item.setSection("open").setTitle(iface.menu.openInNewTab()).setIcon("lucide-file-plus").onClick(() => {
              node.app.workspace.getLeaf("tab").openFile(file);
            }),
          );
        }
        if (!canvas.readonly && child instanceof host.StatefulEmbedBase) {
          menu.addItem((item) =>
            item.setSection("canvas").setTitle(iface.menu.edit()).setIcon("lucide-edit").onClick(() => node.startEditing()),
          );
        }
        if (!canvas.readonly && file.extension === "md") {
          menu.addItem((item) =>
            item.setSection("canvas").setIcon("lucide-minimize-2").setTitle(strings.actionNarrowHeading()).onClick(() => {
              new canvas.SectionSuggest(node.app, file, "heading", (result) => {
                const parsed = env().RI(result);
                node.setFilePath(parsed.path, parsed.subpath);
                node.canvas.requestSave();
              }).open();
            }),
          );
          menu.addItem((item) =>
            item.setSection("canvas").setIcon("lucide-minimize-2").setTitle(strings.actionNarrowBlock()).onClick(() => {
              new canvas.SectionSuggest(node.app, file, "block", (result) => {
                if (result.type === "block" && !result.node.id) {
                  const content = result.content;
                  const target = result.file;
                  const id = (result.node.id = randomHex(6));
                  const insertion = ng08BlockRefInsertion(result, id);
                  const blockEnd = insertion.blockEnd;
                  const addition = insertion.addition;
                  const text = content.slice(0, blockEnd) + addition + content.slice(blockEnd);
                  node.app.vault.modify(target, text);
                }
                const parsed = env().RI(result);
                node.setFilePath(parsed.path, parsed.subpath);
                node.canvas.requestSave();
              }).open();
            }),
          );
        }
        if (!canvas.readonly && file.extension === "base") {
          menu.addItem((item) =>
            item.setSection("canvas").setIcon("lucide-minimize-2").setTitle(strings.actionNarrowBasesView()).onClick(async () => {
              const text = await this.app.vault.cachedRead(file);
              const parsed = host.parseYaml(text)?.views;
              parsed.unshift(null);
              const viewName = this.subpath.slice(1);
              new canvas.ViewTypeSuggest(this.app, parsed, viewName, (picked) => {
                const subpath = picked ? "#" + picked : "";
                this.setFilePath(this.filePath, subpath);
                this.canvas.requestSave();
              }).open();
            }),
          );
        }
      }
      if (!this.subpath) {
        menu.addItem((item) =>
          item.setSection("action").setTitle(explorerStrings.menuOptRename()).setIcon("lucide-edit-3").onClick(() => {
            node.app.fileManager.promptForFileRename(file);
          }),
        );
        this.app.workspace.trigger("file-menu", menu, file, "canvas-menu");
      }
    }
  }

  canvas.FileNode = FileNode;
  return FileNode;
}

// ---- group node (R5) ---------------------------------------------------------------------

export function defineS33CanvasGroupNode(host) {
  /** Grouping container: holds other nodes, optional label and background image. */
  class GroupNode extends canvas.Node {
    constructor(nodeCanvas, id = randomHex(16)) {
      super(nodeCanvas, id);
      this.label = "";
      this.bgPath = "";
      this.bgStyle = "";
      this.nodeEl.addClass("canvas-node-group");
    }

    getData() {
      const data = { ...super.getData(), type: "group" };
      const label = this.label;
      const bgPath = this.bgPath;
      const bgFile = this.bgFile;
      const bgStyle = this.bgStyle;
      if (label) data.label = label;
      if (bgPath) {
        data.background = bgFile ? bgFile.path : bgPath;
        if (bgStyle && bgStyle !== "cover") data.backgroundStyle = bgStyle;
      }
      return data;
    }

    setData(data) {
      const { label, background, ...rest } = data;
      super.setData(rest);
      const bgStyle = data.backgroundStyle || "";
      if (label && String.isString(label)) this.setLabel(label);
      if (background && String.isString(background)) {
        if (this.bgPath !== background || (this.bgFile && this.bgFile.path !== background)) {
          this.bgPath = background;
          const resolved = this.app.vault.getAbstractFileByPath(background);
          this.bgFile = resolved instanceof host.TFile ? resolved : null;
          this.canvas.markDirty(this);
        }
        if (this.bgStyle !== bgStyle) {
          this.bgStyle = bgStyle;
          this.canvas.markDirty(this);
        }
      } else if (this.bgPath) {
        this.bgPath = "";
        this.bgFile = null;
        this.bgStyle = "";
        this.canvas.markDirty(this);
      }
      this.updateAspectRatio();
    }

    setLabel(label) {
      if (this.label !== label) {
        this.label = label;
        this.canvas.markDirty(this);
      }
    }

    setBackgroundFile(file) {
      const path = file ? file.path : "";
      if (this.bgPath === path && this.bgFile === file) return;
      this.bgPath = path;
      this.bgFile = file;
      if (!file) this.bgStyle = "";
      this.updateAspectRatio();
      this.canvas.markDirty(this);
    }

    setBackgroundStyle(style) {
      if (!this.bgPath) style = "";
      if (this.bgStyle !== style) {
        this.bgStyle = style;
        this.updateAspectRatio();
        this.canvas.markDirty(this);
      }
    }

    initialize() {
      super.initialize();
      this.contentEl = this.containerEl.createDiv("canvas-node-content");
      const labelEl = (this.labelEl = this.nodeEl.createDiv("canvas-group-label"));
      labelEl.spellcheck = false;
      labelEl.addEventListener("pointerdown", this.onPointerdown.bind(this));
      labelEl.addEventListener("dblclick", () => this.focusLabel());
      labelEl.addEventListener("keypress", (evt) => {
        if (evt.isComposing || evt.key !== "Enter") return;
        evt.preventDefault();
        this.blurLabel();
      });
      labelEl.addEventListener("blur", () => this.blurLabel());
    }

    focusLabel() {
      const labelEl = this.labelEl;
      if (!labelEl) return;
      labelEl.show();
      labelEl.setAttr("contenteditable", "true");
      host.focusAndSelectContents(labelEl);
    }

    blur() {
      super.blur();
      this.blurLabel();
    }

    blurLabel() {
      const labelEl = this.labelEl;
      if (!labelEl) return;
      labelEl.setAttr("contenteditable", "false");
      labelEl.blur();
      const text = labelEl.getText();
      if (this.label !== text) {
        this.setLabel(text);
        this.canvas.requestSave();
      } else {
        labelEl.toggle(!!text);
        labelEl.setText(text);
      }
    }

    render() {
      super.render();
      const labelEl = this.labelEl;
      const label = this.label;
      const color = this.color;
      if (!labelEl.isActiveElement()) {
        labelEl.toggle(!!label);
        labelEl.setText(label);
      }
      let light = false;
      let dark = false;
      if (color) {
        let parsed;
        if (s13DigitsRe.test(color)) {
          const rgb = labelEl.getCssPropertyValue("--canvas-color-" + color);
          parsed = host.s13ParseColor("rgb(" + rgb + ")");
        } else {
          parsed = host.s13ParseColor(color);
        }
        if (parsed) {
          if (isLightColor(parsed)) dark = true;
          else light = true;
        }
      }
      labelEl.toggleClass("mod-foreground-light", light);
      labelEl.toggleClass("mod-foreground-dark", dark);
      const app = this.app;
      const bgFile = this.bgFile;
      const bgStyle = this.bgStyle;
      const contentEl = this.contentEl;
      if (bgFile) {
        const styles = {
          backgroundImage: `url("${CSS.escape(app.vault.getResourcePath(bgFile))}")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center center",
          backgroundSize: "cover",
        };
        if (bgStyle === "repeat") {
          styles.backgroundRepeat = "repeat";
          styles.backgroundPosition = "top left";
          styles.backgroundSize = "auto";
        }
        contentEl.setCssStyles(styles);
      } else {
        contentEl.setCssStyles({
          backgroundImage: "",
          backgroundRepeat: "",
          backgroundPosition: "",
          backgroundSize: "",
        });
      }
    }

    updateAspectRatio() {
      (async () => {
        const bgFile = this.bgFile;
        if (!(this.bgStyle === "ratio" && bgFile)) {
          this.aspectRatio = 0;
          return;
        }
        const width = this.width;
        const height = this.height;
        const size = await env().Tc(this.app.vault.getResourcePath(bgFile));
        if (size && size.height !== 0) {
          const ratio = (this.aspectRatio = size.width / size.height);
          if (width / height !== ratio) {
            this.resize({ width: Math.min(width, height * ratio), height: Math.min(height, width / ratio) });
            this.canvas.overrideHistory();
          }
        }
      })();
    }

    updateZIndex() { this.renderZIndex(); }

    renderZIndex() {
      const zIndex = (this.zIndex = Math.round(-this.width * this.height));
      this.nodeEl.style.zIndex = String(zIndex);
    }

    isEditable() { return true; }

    startEditing() {
      super.startEditing();
      if (!this.canvas.readonly) this.focusLabel();
    }

    showMenu(menu) {
      super.showMenu(menu);
      const node = this;
      if (!this.canvas.readonly) {
        menu.addItem((item) =>
          item.setSection("canvas").setTitle(host.t.plugins.canvas.actionEditLabel()).setIcon("lucide-edit").onClick(() => node.startEditing()),
        );
      }
    }
  }

  canvas.GroupNode = GroupNode;
  return GroupNode;
}

// ---- shared canvas-file index base (X5) ---------------------------------------------------

/**
 * Base class for per-file canvas link indexes: queues changed files on vault events and
 * processes one file per idle frame, storing results under `index[path]`. Subclasses
 * implement `canProcess(file)` and `process(file)`.
 */
export function defineS33CanvasFileIndex(host) {
  function CanvasFileIndex(app) {
    const self = host.Component.call(this) || this;
    self.index = {};
    self.fileQueue = [];
    self.app = app;
    return self;
  }
  inherit(CanvasFileIndex, host.Component);
  const proto = CanvasFileIndex.prototype;

  proto.onload = function () {
    const vault = this.app.vault;
    this.registerEvent(vault.on("create", this.onCreate, this));
    this.registerEvent(vault.on("modify", this.onModify, this));
    this.registerEvent(vault.on("rename", this.onRename, this));
    this.registerEvent(vault.on("delete", this.onDelete, this));
    const files = vault.getFiles();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (this.canProcess(file)) this.queue(file);
    }
  };

  proto.onunload = function () {
    this.index = {};
    this.fileQueue = [];
    if (this.frame) {
      this.frame.cancel();
      this.frame = null;
    }
  };

  proto.onCreate = function (file) {
    if (file instanceof host.TFile && this.canProcess(file)) this.queue(file);
  };

  proto.onModify = function (file) {
    if (file instanceof host.TFile && this.canProcess(file)) this.queue(file);
  };

  proto.onRename = function (file, oldPath) {
    if (!(file instanceof host.TFile) || !this.canProcess(file)) return;
    const index = this.index;
    if (index.hasOwnProperty(oldPath)) {
      const value = index[oldPath];
      delete index[oldPath];
      index[file.path] = value;
    }
  };

  proto.onDelete = function (file) {
    const index = this.index;
    if (index.hasOwnProperty(file.path)) delete index[file.path];
    if (file instanceof host.TFile) {
      const at = this.fileQueue.indexOf(file);
      if (at >= 0) this.fileQueue.splice(at, 1);
    }
  };

  proto.queue = function (file) {
    if (!this.fileQueue.includes(file)) this.fileQueue.push(file);
    this.requestFrame();
  };

  proto.requestFrame = function () {
    if (!this.frame) this.frame = idleOrTimeout(this.run.bind(this), 100);
  };

  proto.run = async function () {
    const queue = this.fileQueue;
    if (queue.length > 0) {
      const file = queue.pop();
      try {
        const result = await this.process(file);
        if (result) this.index[file.path] = result;
      } catch (e) {
        console.error("Failed to index " + file.path, e);
      }
      this.frame = null;
    }
    if (queue.length > 0) this.requestFrame();
  };

  proto.get = function (file) { return this.getForPath(file.path); };

  proto.getForPath = function (path) {
    return this.index.hasOwnProperty(path) ? this.index[path] : null;
  };

  proto.getAll = function () { return this.index; };

  return CanvasFileIndex;
}

// ---- canvas-file embed renderer (a8) --------------------------------------------------------

/** Renders a .canvas file inside a canvas embed node (optionally with an inline header). */
export function defineS33CanvasEmbed(host) {
  function CanvasEmbed(ctx, file, subpath) {
    const self = host.Component.call(this) || this;
    const app = (self.app = ctx.app);
    self.ctx = ctx;
    const containerEl = (self.containerEl = ctx.containerEl);
    containerEl.addClass("canvas-embed");
    self.file = file;
    self.subpath = subpath;
    if (ctx.showInline) {
      containerEl.addClass("inline-embed");
      self.headerEl = containerEl.createDiv({ cls: "embed-title" }, (header) => {
        header.createSpan({ cls: "file-embed-icon" }, (icon) => {
          host.setIcon(icon, "lucide-layout-dashboard");
        });
        header.appendText(" " + self.file.basename);
      });
    }
    containerEl.addEventListener("click", (evt) => {
      app.workspace.getLeaf(host.Keymap.isModEvent(evt)).openLinkText(ctx.linktext, ctx.sourcePath);
    });
    return self;
  }
  inherit(CanvasEmbed, host.Component);
  const proto = CanvasEmbed.prototype;

  proto.loadFile = async function () {
    const containerEl = this.containerEl;
    const headerEl = this.headerEl;
    containerEl.empty();
    if (headerEl) containerEl.appendChild(headerEl);
    const text = await this.app.vault.cachedRead(this.file);
    s33CanvasPreview(containerEl, text, host);
  };

  return CanvasEmbed;
}

// ---- path suggest for the history modal (N8) -------------------------------------------------

/**
 * Suggests vault paths for the file-recovery history modal; filters case-insensitively,
 * caps at 100 hits and displays paths without their ".md" suffix.
 */
export function defineS33PathSuggest(host) {
  function PathSuggest(app, textInputEl, paths, modal) {
    const self = host.AbstractInputSuggest.call(this, app, textInputEl) || this;
    self.paths = [];
    self.modal = null;
    self.paths = paths;
    self.modal = modal;
    return self;
  }
  inherit(PathSuggest, host.AbstractInputSuggest);
  const proto = PathSuggest.prototype;

  proto.renderSuggestion = function (path, el) {
    el.setText(withoutMd(path));
  };

  proto.getSuggestions = function (query) {
    query = query.toLowerCase();
    const results = [];
    for (const path of this.paths) {
      if (path.toLowerCase().includes(query)) results.push(path);
    }
    return results.slice(0, 100);
  };

  proto.selectSuggestion = function (path) {
    const input = this.textInputEl;
    this.modal.switchToPath(path);
    input.trigger("input");
    this.close();
  };

  return PathSuggest;
}
