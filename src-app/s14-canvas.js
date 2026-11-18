// Canvas slice (s14): the pieces of the .canvas subsystem that were still inherited.
//
//   CanvasFileIndex (X5)   vault watcher that incrementally indexes every .canvas file through the
//                          registered extractor; `index[path]` holds {embeds, caches}.
//   CanvasGroupNode (R5)   "group" node: label + optional background image/style.
//   CanvasFileNode (P5)    "file" node: embeds any file (md/canvas/pdf/media/...), label, menus.
//   CanvasEdge (G5)        edge between two node sides: path, arrow ends, label, reconnect drag.
//   CanvasView (r8)        the TextFileView that hosts the canvas controller (y5, still inherited).
//   CanvasEmbedRenderer (a8) embed of a .canvas file inside notes (renders the minimap).
//   CanvasSettingsTab (s8) plugin settings: file location, wheel/mod-drag behaviour, grid snapping.
//   s14RenderMinimap (o8)  draws the small svg overview of nodes/edges used by the embed.
//   s14EdgeSide/z5/b5      edge geometry helpers kept as top-level functions (other code calls them).
//
// Cross-references between the node/edge/embed classes go through the shared `canvas` registry
// populated by the other canvas modules, exactly like the inherited code referenced the classes
// by name. App-scope helpers come in through `host`; own helpers are imported directly.
import { inherit } from "./inherit.js";
import { randomHex, boxCenter, boxOfRect, boxUnion, boxGrow, sideMidpoint, bezierEdge, isLightColor, distance, ng08SuppressNextEvent } from "./misc.js";
import { newlinesBefore } from "./text.js";
import { idleOrTimeout } from "./metadata-helpers.js";
import { debounceCall } from "./timing.js";

const s14CanvasT = (host) => host.t.plugins.canvas;

// =====================================================================================================================
// Vault index of canvas files (X5)
// =====================================================================================================================

/**
 * Component that keeps `index` — a map of canvas file path -> extractor result — up to date.
 * `canProcess`/`process` are supplied by the subclass (the metadata extractor); files are
 * processed one per idle slice so indexing never blocks the UI.
 */
export function defineCanvasFileIndex(host) {
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
    for (const file of vault.getFiles()) {
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

  proto.onModify = proto.onCreate;

  proto.onRename = function (file, oldPath) {
    if (!(file instanceof host.TFile) || !this.canProcess(file)) return;
    const index = this.index;
    if (Object.hasOwn(index, oldPath)) {
      const entry = index[oldPath];
      delete index[oldPath];
      index[file.path] = entry;
    }
  };

  proto.onDelete = function (file) {
    const index = this.index;
    if (Object.hasOwn(index, file.path)) delete index[file.path];
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

  /** Processes a single queued file per idle slice. */
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
    return Object.hasOwn(this.index, path) ? this.index[path] : null;
  };

  proto.getAll = function () { return this.index; };

  return CanvasFileIndex;
}

// =====================================================================================================================
// Edge geometry helpers (V5, z5, b5) — kept as top-level functions, the rest of the bundle calls them.
// =====================================================================================================================

/** Which side of `from` faces `to`: compares the centre-to-centre angle against the node's aspect. */
export function s14EdgeSide(from, to) {
  const a = boxCenter(from.getBBox());
  const b = boxCenter(to.getBBox());
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const aspect = Math.atan2(from.height, from.width);
  if (angle > -aspect && angle <= aspect) return "right";
  if (angle > aspect && angle <= Math.PI - aspect) return "bottom";
  if (angle > Math.PI - aspect || angle <= -(Math.PI - aspect)) return "left";
  return "top";
}

/** Moves a point 7px outward through the given side — where the edge line visually starts/ends. */
export function s14EdgeAnchor(point, side) {
  const p = { ...point };
  switch (side) {
    case "top": p.y -= 7; break;
    case "bottom": p.y += 7; break;
    case "left": p.x -= 7; break;
    case "right": p.x += 7; break;
  }
  return p;
}

/** z-index ordering comparator for stacked nodes. */
export function s14ByZIndex(a, b) { return a.zIndex - b.zIndex; }

// =====================================================================================================================
// Group node (R5)
// =====================================================================================================================

export const S14_EDGE_END_NONE = "none";
export const S14_EDGE_END_ARROW = "arrow";
export const S14_EDGE_ROTATION = { top: "180", bottom: "0", left: "90", right: "270" };
const S14_COLOR_VAR = /^(\d+)$/;

/** View-type id under which the canvas view registers (was `$5`). */
export const S14_CANVAS_VIEW_TYPE = "canvas";
/** File extension handled by the canvas plugin (was `Z5`). */
export const S14_CANVAS_EXTENSION = "canvas";

/** "group" canvas node: editable label plus optional background image with cover/contain/repeat. */
export function defineCanvasGroupNode(host) {
  class CanvasGroupNode extends canvas.Node {
    constructor(canvas, id = randomHex(16)) {
      super(canvas, id);
      this.label = "";
      this.bgPath = "";
      this.bgStyle = "";
      this.nodeEl.addClass("canvas-node-group");
    }

    getData() {
      const data = { ...super.getData(), type: "group" };
      const { label, bgPath, bgFile, bgStyle } = this;
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
      let bgStyle = data.backgroundStyle || "";
      if (label && String.isString(label)) this.setLabel(label);
      if (background && String.isString(background)) {
        if (this.bgPath !== background || (this.bgFile && this.bgFile.path !== background)) {
          this.bgPath = background;
          const file = this.app.vault.getAbstractFileByPath(background);
          this.bgFile = file instanceof host.TFile ? file : null;
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
      if (this.label === label) return;
      this.label = label;
      this.canvas.markDirty(this);
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
      if (this.bgStyle === style) return;
      this.bgStyle = style;
      this.updateAspectRatio();
      this.canvas.markDirty(this);
    }

    initialize() {
      super.initialize();
      this.contentEl = this.containerEl.createDiv("canvas-node-content");
      const labelEl = (this.labelEl = this.nodeEl.createDiv("canvas-group-label"));
      labelEl.spellcheck = false;
      labelEl.addEventListener("pointerdown", this.onPointerdown.bind(this));
      labelEl.addEventListener("dblclick", () => this.focusLabel());
      labelEl.addEventListener("keypress", (e) => {
        if (e.isComposing || e.key !== "Enter") return;
        e.preventDefault();
        this.blurLabel();
      });
      labelEl.addEventListener("blur", () => this.blurLabel());
    }

    focusLabel() {
      const el = this.labelEl;
      if (!el) return;
      el.show();
      el.setAttr("contenteditable", "true");
      host.focusAndSelectContents(el);
    }

    blur() {
      super.blur();
      this.blurLabel();
    }

    blurLabel() {
      const el = this.labelEl;
      if (!el) return;
      el.setAttr("contenteditable", "false");
      el.blur();
      const text = el.getText();
      if (this.label !== text) {
        this.setLabel(text);
        this.canvas.requestSave();
      } else {
        el.toggle(!!text);
        el.setText(text);
      }
    }

    render() {
      super.render();
      const { labelEl, label, color } = this;
      if (!labelEl.isActiveElement()) {
        labelEl.toggle(!!label);
        labelEl.setText(label);
      }
      let light = false;
      let dark = false;
      if (color) {
        let parsed;
        if (S14_COLOR_VAR.test(color)) {
          const components = labelEl.getCssPropertyValue("--canvas-color-" + color);
          parsed = host.s14ParseColor("rgb(" + components + ")");
        } else {
          parsed = host.s14ParseColor(color);
        }
        if (parsed) {
          if (isLightColor(parsed)) dark = true;
          else light = true;
        }
      }
      labelEl.toggleClass("mod-foreground-light", light);
      labelEl.toggleClass("mod-foreground-dark", dark);

      const { app, bgFile, bgStyle, contentEl } = this;
      if (bgFile) {
        const styles = {
          backgroundImage: 'url("' + CSS.escape(app.vault.getResourcePath(bgFile)) + '")',
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
        contentEl.setCssStyles({ backgroundImage: "", backgroundRepeat: "", backgroundPosition: "", backgroundSize: "" });
      }
    }

    /** bgStyle "ratio" keeps the node's aspect ratio matched to the background image. */
    async updateAspectRatio() {
      const { bgFile, bgStyle } = this;
      if (bgStyle !== "ratio" || !bgFile) {
        this.aspectRatio = 0;
        return;
      }
      const size = await host.s14ImageSize(this.app.vault.getResourcePath(bgFile));
      if (size && size.height !== 0) {
        const ratio = (this.aspectRatio = size.width / size.height);
        const { width, height } = this;
        if (width / height !== ratio) {
          this.resize({ width: Math.min(width, height * ratio), height: Math.min(height, width / ratio) });
          this.canvas.overrideHistory();
        }
      }
    }

    updateZIndex() { this.renderZIndex(); }

    renderZIndex() {
      this.zIndex = Math.round(-this.width * this.height);
      this.nodeEl.style.zIndex = String(this.zIndex);
    }

    isEditable() { return true; }

    startEditing() {
      super.startEditing();
      if (!this.canvas.readonly) this.focusLabel();
    }

    showMenu(menu) {
      super.showMenu(menu);
      if (this.canvas.readonly) return;
      const node = this;
      menu
        .addItem((item) =>
          item
            .setSection("canvas")
            .setTitle(s14CanvasT(host).actionEditLabel())
            .setIcon("lucide-edit")
            .onClick(() => node.startEditing()),
        );
    }
  }
  canvas.GroupNode = CanvasGroupNode;
  return CanvasGroupNode;
}

// =====================================================================================================================
// File node (P5)
// =====================================================================================================================

/** "file" canvas node: embeds any vault file (or a web/media/pdf resource) with an optional label. */
export function defineCanvasFileNode(host) {
  class CanvasFileNode extends canvas.EditableNode {
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
        const found = app.vault.getAbstractFileByPath(filePath);
        if (found instanceof host.TFile) this.file = found;
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
      const { file, subpath } = data;
      if (file) this.setFilePath(file, subpath || "");
    }

    setFilePath(path, subpath) {
      if (this.filePath === path && this.subpath === subpath) return;
      this.filePath = path;
      if (this.file?.path === path && this.subpath === subpath) return;
      this.subpath = subpath;
      this.initFile();
      this.unloadChild();
      this.canvas.markDirty(this);
    }

    setFile(file, subpath, force) {
      subpath = subpath || "";
      if (force || this.filePath !== file.path || this.subpath !== subpath) {
        this.subpath = subpath;
        this.filePath = file.path;
        if (this.file !== file) {
          this.file = file;
          this.unloadChild();
        }
        this.canvas.markDirty(this);
      }
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
      const child = this.child instanceof host.MarkdownEmbedBase ? this.child : null;
      workspace.activeEditor = child;
      this.canvas.requestUpdateFileOpen(this.file);
    }

    initialize() { super.initialize(); }

    /** Card label under the node; visibility follows the "cardLabelVisibility" canvas option. */
    updateNodeLabel(text) {
      const { labelEl, canvas, nodeEl } = this;
      const visibility = canvas.options.cardLabelVisibility;
      if (visibility !== "never") {
        let el = labelEl;
        if (!el) {
          el = this.labelEl = nodeEl.createDiv("canvas-node-label");
          el.addEventListener("click", this.onLabelClick.bind(this));
          el.addEventListener("dblclick", this.onLabelDblClick.bind(this));
          el.addEventListener("pointerdown", this.onPointerdown.bind(this));
        }
        el.toggleClass("mod-hover-label", visibility === "hover");
        el.setText(text);
      } else if (labelEl) {
        labelEl.detach();
        this.labelEl = null;
      }
    }

    updateBreakpoint(editing) {
      if (editing) {
        this.mountContent();
      } else {
        const child = this.child;
        if (child instanceof host.s14MediaEmbedBase || child instanceof host.CanvasEmbedRenderer) this.mountContent();
        else this.unmountContent();
      }
    }

    render() {
      super.render();
      const { file, filePath, subpath } = this;
      if (file) {
        let label = file.getShortName();
        if (subpath && file.extension === "md") label += " › " + subpath.substring(1);
        this.updateNodeLabel(label);
        this.placeholderEl.setText(label);
      } else {
        this.updateNodeLabel(
          createFragment((el) => {
            host.setIcon(el.createSpan(), "lucide-alert-triangle");
            el.createSpan({ text: filePath });
          }),
        );
        this.placeholderEl.setText(filePath);
      }

      if (!this.child) {
        const { app, canvas } = this;
        const options = {
          app,
          linktext: this.filePath + this.subpath,
          sourcePath: canvas.view.file?.path ?? "",
          containerEl: this.contentEl,
          depth: 0,
        };
        let child;
        if (file) {
          child = this.child = host.EmbedLoader.load(options);
          if (child instanceof host.EmbedFileView) {
            child.useLocalPropertiesFoldState = true;
            child.editable = true;
            child.useIframe = true;
          }
        } else {
          child = this.child = new canvas.EmptyEmbed(options, this, () => this.render());
        }
        if (this.isFocused) this.onFileFocus();
        child.load();
        (async () => {
          await child.loadFile();
          if (child instanceof host.s14PdfEmbed) {
            child.viewer.then(({ pdfViewer, toolbar }) => {
              pdfViewer.setHeight("auto");
              const button = toolbar.toolbarRightEl.createDiv("clickable-icon", (el) => {
                host.setIcon(el, "lucide-file-symlink");
                host.setTooltip(el, host.t.pdf.actionSavePDFLocation());
                child.on("pagechanging", debounceCall(() => {
                  if (this.subpath !== "#page=" + pdfViewer.page) el.setAttr("aria-disabled", "false");
                  else if (el.getAttr("aria-disabled") !== "true") el.setAttr("aria-disabled", "true");
                }, 100, true));
                el.addEventListener("click", () => {
                  this.subpath = "#page=" + pdfViewer.page;
                  this.canvas.requestSave();
                  el.setAttr("aria-disabled", "true");
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
            const fit = () => this.resize({ width: this.width, height: first.clientHeight || 42 });
            if (!first.isShown()) first.onNodeInserted(fit, true);
            else fit();
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

    onLabelClick(e) {
      const inNewTab = host.keyModifiers.isModEvent(e);
      if (inNewTab) this.app.workspace.getLeaf(inNewTab).openLinkText(this.filePath + this.subpath, "");
    }

    onLabelDblClick(e) {
      this.app.workspace.getLeaf(false).openLinkText(this.filePath + this.subpath, "");
    }

    onPointerdown(e) {
      const target = e.targetNode;
      if (
        this.child instanceof host.s14PdfEmbed &&
        target.instanceOf(HTMLElement) &&
        target.parentElement?.hasClass("textLayer")
      ) {
        return;
      }
      super.onPointerdown(e);
    }

    showMenu(menu) {
      super.showMenu(menu);
      const node = this;
      const { file, child, canvas } = this;
      if (!canvas.readonly) {
        menu.addItem((item) =>
          item
            .setSection("canvas")
            .setTitle(s14CanvasT(host).actionSwapFile())
            .setIcon(file ? (file.extension === "md" || file.extension === "canvas" ? "lucide-arrow-left-right" : "lucide-wrench") : "lucide-wrench")
            .onClick(() => {
              const canMd = !file || file.extension === "md" || file.extension === "canvas";
              const canAttach = !file || file.extension !== "md";
              new host.CanvasFileSuggest(canvas, (picked) => {
                node.setFile(picked, "");
                node.canvas.requestSave();
              })
                .showMarkdownAndCanvas(canMd)
                .showAttachments(canAttach)
                .open();
            }),
        );
      }
      if (file) {
        if (file.extension === "md") {
          menu.addItem((item) =>
            item
              .setSection("open")
              .setTitle(host.t.interface.menu.openInNewTab())
              .setIcon("lucide-file-plus")
              .onClick(() => node.app.workspace.getLeaf("tab").openFile(file)),
          );
        }
        if (!canvas.readonly && child instanceof host.EmbedFileView) {
          menu.addItem((item) =>
            item
              .setSection("canvas")
              .setTitle(host.t.interface.menu.edit())
              .setIcon("lucide-edit")
              .onClick(() => node.startEditing()),
          );
        }
        if (!canvas.readonly && file.extension === "md") {
          menu.addItem((item) =>
            item
              .setSection("canvas")
              .setIcon("lucide-minimize-2")
              .setTitle(s14CanvasT(host).actionNarrowHeading())
              .onClick(() => {
                new canvas.SectionSuggest(node.app, file, "heading", (section) => {
                  const { path, subpath } = host.s14LinkParts(section);
                  node.setFilePath(path, subpath);
                  node.canvas.requestSave();
                }).open();
              }),
          );
          menu.addItem((item) =>
            item
              .setSection("canvas")
              .setIcon("lucide-minimize-2")
              .setTitle(s14CanvasT(host).actionNarrowBlock())
              .onClick(() => {
                new canvas.SectionSuggest(node.app, file, "block", (section) => {
                  if (section.type === "block" && !section.node.id) {
                    const content = section.content;
                    const target = section.file;
                    const id = (section.node.id = randomHex(6));
                    const { blockEnd, addition } = ng08BlockRefInsertion(section, id);
                    const text = content.slice(0, blockEnd) + addition + content.slice(blockEnd);
                    node.app.vault.modify(target, text);
                  }
                  const { path, subpath } = host.s14LinkParts(section);
                  node.setFilePath(path, subpath);
                  node.canvas.requestSave();
                }).open();
              }),
          );
        }
        if (!canvas.readonly && file.extension === "base") {
          menu.addItem((item) =>
            item
              .setSection("canvas")
              .setIcon("lucide-minimize-2")
              .setTitle(s14CanvasT(host).actionNarrowBasesView())
              .onClick(async () => {
                const text = await this.app.vault.cachedRead(file);
                const views = host.parseYaml(text)?.views;
                views.unshift(null);
                const current = this.subpath.slice(1);
                new canvas.ViewTypeSuggest(this.app, views, current, (view) => {
                  const subpath = view ? "#" + view : "";
                  this.setFilePath(this.filePath, subpath);
                  this.canvas.requestSave();
                }).open();
              }),
          );
        }
      }
      if (!this.subpath) {
        menu.addItem((item) =>
          item
            .setSection("action")
            .setTitle(host.t.plugins.fileExplorer.menuOptRename())
            .setIcon("lucide-edit-3")
            .onClick(() => node.app.fileManager.promptForFileRename(file)),
        );
        this.app.workspace.trigger("file-menu", menu, file, "canvas-menu");
      }
    }
  }
  canvas.FileNode = CanvasFileNode;
  return CanvasFileNode;
}

// =====================================================================================================================
// Canvas edge (G5)
// =====================================================================================================================

/** Edge between a "from" and a "to" node anchor; renders the svg path, arrow heads and label. */
export function defineCanvasEdge(host) {
  function CanvasEdge(canvas, id, from, to) {
    this.color = "";
    this.label = "";
    this.unknownData = {};
    this.initialized = false;
    this.canvas = canvas;
    this.id = id;
    this.from = from;
    this.to = to;
    this.lineGroupEl = createSvg("g");
    this.lineEndGroupEl = createSvg("g");
  }
  const proto = CanvasEdge.prototype;

  proto.attach = function () {
    if (this.isAttached) return;
    this.canvas.edgeContainerEl.appendChild(this.lineGroupEl);
    this.canvas.edgeEndContainerEl.appendChild(this.lineEndGroupEl);
  };

  proto.detach = function () {
    if (!this.isAttached) return;
    this.lineGroupEl.detach();
    this.lineEndGroupEl.detach();
  };

  Object.defineProperty(proto, "isAttached", {
    get() { return !!this.lineGroupEl.parentNode; },
    enumerable: false,
    configurable: true,
  });

  proto.destroy = function () {
    this.labelElement?.destroy();
    this.lineGroupEl?.remove();
    this.lineEndGroupEl?.remove();
  };

  proto.getData = function () {
    const { id, from, to, color, label, unknownData } = this;
    const data = {
      ...unknownData,
      id,
      fromNode: from.node.id,
      fromSide: from.side,
      toNode: to.node.id,
      toSide: to.side,
    };
    if (from.end !== S14_EDGE_END_NONE) data.fromEnd = from.end;
    if (to.end !== S14_EDGE_END_ARROW) data.toEnd = to.end;
    if (color) data.color = color;
    if (label) data.label = label;
    return data;
  };

  proto.setData = function (data) {
    const {
      fromNode, fromSide, fromEnd, toNode, toSide, toEnd, color, label,
      ...rest
    } = data;
    let dirty = false;
    let moved = false;
    const normalized = host.normalizeCanvasColor(color || "");
    if (this.color !== normalized) {
      this.color = normalized;
      dirty = true;
    }
    if (this.label !== label) {
      this.label = label;
      dirty = true;
    }
    const canvas = this.canvas;
    const nodes = canvas.nodes;
    if (fromNode && fromNode !== this.from.node.id && nodes.has(fromNode)) {
      moved = true;
      this.from.node = nodes.get(fromNode);
    }
    const fromEndFinal = fromEnd || S14_EDGE_END_NONE;
    if (fromNode && fromEndFinal !== this.from.end) {
      this.from.end = fromEndFinal;
      dirty = true;
    }
    if (toNode && toNode !== this.to.node.id && nodes.has(toNode)) {
      moved = true;
      this.to.node = nodes.get(toNode);
    }
    const toEndFinal = toEnd || S14_EDGE_END_ARROW;
    if (toNode && toEndFinal !== this.to.end) {
      this.to.end = toEndFinal;
      dirty = true;
    }
    if (fromNode) {
      const side = fromSide ?? s14EdgeSide(this.from.node, this.to.node);
      if (side !== this.from.side) {
        this.from.side = side;
        dirty = true;
      }
    }
    if (toNode) {
      const side = toSide ?? s14EdgeSide(this.to.node, this.from.node);
      if (side !== this.to.side) {
        this.to.side = side;
        dirty = true;
      }
    }
    if (moved) canvas.markMoved(this);
    if (dirty) canvas.markDirty(this);
    this.unknownData = rest;
  };

  proto.setColor = function (color, rerender) {
    color = host.normalizeCanvasColor(color || "");
    if (this.color === color) return;
    this.color = color;
    if (rerender) this.render();
    else this.canvas.markDirty(this);
  };

  proto.setLabel = function (label) {
    if (this.label === label) return;
    this.label = label;
  };

  proto.update = function (from, to) {
    const canvas = this.canvas;
    if (this.from.node !== from.node) {
      canvas.edgeFrom.delete(this.from.node, this);
      if (!(from.node instanceof canvas.DummyNode)) canvas.edgeFrom.add(from.node, this);
    }
    if (this.to.node !== to.node) {
      canvas.edgeTo.delete(this.to.node, this);
      if (!(to.node instanceof canvas.DummyNode)) canvas.edgeTo.add(to.node, this);
    }
    this.from = from;
    this.to = to;
    canvas.markMoved(this);
  };

  proto.getBBox = function () {
    const fromPoint = sideMidpoint(this.from.node.getBBox(), this.from.side);
    const toPoint = sideMidpoint(this.to.node.getBBox(), this.to.side);
    return {
      minX: Math.min(fromPoint.x, toPoint.x),
      minY: Math.min(fromPoint.y, toPoint.y),
      maxX: Math.max(fromPoint.x, toPoint.x),
      maxY: Math.max(fromPoint.y, toPoint.y),
    };
  };

  proto.focus = function () { this.select(); };

  proto.blur = function () {
    this.deselect();
    this.labelElement?.blur();
  };

  proto.select = function () {
    this.lineGroupEl.addClass("is-focused");
    this.lineEndGroupEl.addClass("is-focused");
  };

  proto.deselect = function () {
    this.lineGroupEl.removeClass("is-focused");
    this.lineEndGroupEl.removeClass("is-focused");
  };

  proto.editLabel = function () {
    if (!this.labelElement) this.labelElement = new canvas.EdgeLabel(this);
    this.labelElement.focus();
  };

  /** Point at t in [0,1] along the rendered cubic bezier. */
  proto.getCenter = function () {
    return cubicAt(0.5, this.bezier);
  };

  proto.initialize = function () {
    const group = this.lineGroupEl;
    group.addEventListener("click", (e) => this.onClick(e));
    group.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    group.addEventListener("pointerdown", (e) => this.onConnectionPointerdown(e));
    this.path = {
      interaction: group.createSvg("path", "canvas-interaction-path"),
      display: group.createSvg("path", "canvas-display-path"),
    };
  };

  proto.render = function () {
    if (!this.initialized) {
      this.initialized = true;
      this.initialize();
    }
    const { lineGroupEl, lineEndGroupEl, color, label } = this;
    this.updatePath();
    if (this.labelElement && !label) this.labelElement.destroy(true);
    this.labelElement?.render();
    if (label) {
      if (!this.labelElement) this.labelElement = new canvas.EdgeLabel(this);
      this.labelElement.setText(label);
    }
    host.applyCanvasColor(lineGroupEl, color);
    host.applyCanvasColor(lineEndGroupEl, color);
    lineGroupEl.toggleClass("is-themed", !!color);
    lineEndGroupEl.toggleClass("is-themed", !!color);
  };

  proto.updatePath = function () {
    const { from, to, path } = this;
    const fromAnchor = sideMidpoint(from.node.getBBox(), from.side);
    const fromOut = s14EdgeAnchor(fromAnchor, from.side);
    const toAnchor = sideMidpoint(to.node.getBBox(), to.side);
    const toOut = s14EdgeAnchor(toAnchor, to.side);
    const bezier = (this.bezier = bezierEdge(fromOut, from.side, toOut, to.side));
    let d = bezier.path;

    // Arrow / custom end markers: replaced entirely when the endpoint type changes.
    if (from.end !== this.fromLineEnd?.type) {
      if (this.fromLineEnd) this.fromLineEnd.el.detach();
      this.fromLineEnd = this.createEdgeEnd(from.end);
    }
    if (to.end !== this.toLineEnd?.type) {
      if (this.toLineEnd) this.toLineEnd.el.detach();
      this.toLineEnd = this.createEdgeEnd(to.end);
    }

    const fix = window.__fpBezierFix && window.__fpBezierFix(this, bezier, fromOut, toOut, from.side, to.side);
    if (this.fromLineEnd) {
      this.fromLineEnd.el.style.transform =
        "translate(" + fromAnchor.x + "px, " + fromAnchor.y + "px) rotate(" + S14_EDGE_ROTATION[from.side] + "deg)";
      d = "M" + fromAnchor.x + " " + fromAnchor.y + " L" + fromOut.x + " " + fromOut.y + " " + d;
    }
    if (this.toLineEnd) {
      this.toLineEnd.el.style.transform =
        "translate(" + toAnchor.x + "px, " + toAnchor.y + "px) rotate(" + S14_EDGE_ROTATION[to.side] + "deg)";
      d = d + " M" + toOut.x + " " + toOut.y + " L" + toAnchor.x + " " + toAnchor.y;
    }
    path.interaction.setAttr("d", d);
    path.display.setAttr("d", d);
  };

  proto.createEdgeEnd = function (type) {
    const custom = window.__fpEndPoints && window.__fpEndPoints(type);
    if (custom) {
      return {
        el: this.lineEndGroupEl.createSvg("g", {}, (g) => {
          g.createSvg("polygon", { cls: "canvas-path-end", attr: { points: custom } });
        }),
        type,
      };
    }
    if (type === "arrow") {
      return {
        el: this.lineEndGroupEl.createSvg("g", {}, (g) => {
          g.createSvg("polygon", { cls: "canvas-path-end", attr: { points: "0,0 6.5,10.4 -6.5,10.4" } });
        }),
        type,
      };
    }
    return null;
  };

  proto.onClick = function (e) {
    const canvas = this.canvas;
    if (e.button !== 0 || canvas.readonly) return;
    if (e.shiftKey) canvas.toggleSelect(this);
    else if (canvas.selection.size === 1 && canvas.selection.has(this)) this.editLabel();
    else canvas.selectOnly(this);
  };

  proto.onContextMenu = function (e) {
    if (e.defaultPrevented) return;
    const canvas = this.canvas;
    if (canvas.selection.has(this) && canvas.selection.size > 1) {
      canvas.onSelectionContextMenu(e);
    } else {
      if (!canvas.readonly) canvas.selectOnly(this);
      const menu = new host.Menu().addSections(["canvas"]);
      this.showMenu(menu, e);
      e.preventDefault();
      menu.showAtMouseEvent(e);
    }
  };

  proto.showMenu = function (menu, event) {
    const edge = this;
    window.__fpEdgeMenu && window.__fpEdgeMenu(menu, edge);
    if (!this.canvas.readonly) {
      menu.addItem((item) =>
        item
          .setSection("danger")
          .setTitle(s14CanvasT(host).actionRemove())
          .setIcon("lucide-trash-2")
          .setWarning(true)
          .onClick(() => {
            edge.canvas.removeEdge(edge);
            edge.canvas.requestSave();
          }),
      );
      menu.addItem((item) =>
        item
          .setSection("canvas")
          .setTitle(s14CanvasT(host).actionEditLabel())
          .setIcon("lucide-edit")
          .onClick(() => edge.editLabel()),
      );
    }
    menu.addItem((item) =>
      item
        .setSection("canvas")
        .setTitle(s14CanvasT(host).actionFollowConnection())
        .setIcon("lucide-corner-down-right")
        .onClick(() => {
          const canvas = edge.canvas;
          const from = edge.from;
          const to = edge.to;
          const pos = canvas.posFromEvt(event);
          const fromMid = sideMidpoint(from.node.getBBox(), from.side);
          const toMid = sideMidpoint(to.node.getBBox(), to.side);
          const nearer = distance(pos, fromMid) > distance(pos, toMid) ? "to" : "from";
          const node = (nearer === "from" ? to : from).node;
          canvas.zoomToBbox(node.getBBox());
        }),
    );
    this.canvas.app.workspace.trigger("canvas:edge-menu", menu, this);
  };

  /** Drag the edge's endpoint onto another node (or empty space for a fresh node). */
  proto.onConnectionPointerdown = function (e) {
    const edge = this;
    const canvas = this.canvas;
    if (window.__fpEdgeGrab && window.__fpEdgeGrab(this, e)) return;
    if (!e.isPrimary || e.button !== 0 || canvas.readonly) return;
    if (e.pointerType === "touch" && !canvas.selection.has(this)) return;
    e.preventDefault();
    host.dragWithThreshold(e, () => {
      const { from, to } = edge;
      const canvas = edge.canvas;
      const pos = canvas.posFromEvt(e);
      const fromMid = sideMidpoint(from.node.getBBox(), from.side);
      const toMid = sideMidpoint(to.node.getBBox(), to.side);
      const end = distance(pos, fromMid) > distance(pos, toMid) ? "to" : "from";
      const other = end === "from" ? to : from;
      const dummy = new canvas.DummyNode(canvas);
      let target = null;
      canvas.canvasEl.addClass("is-connecting");
      canvas.deselectAll();
      edge.canvas.handleDragWithPan(e, {
        move: (moveEvent) => {
          const p = canvas.posFromEvt(moveEvent);
          dummy.x = p.x;
          dummy.y = p.y;
          dummy.width = 0;
          dummy.height = 0;
          const candidates = canvas.getIntersectingNodes(boxGrow(dummy.getBBox(), canvas.config.objectSnapDistance));
          candidates.remove(other.node);
          target = host.canvasNearestSide(p, candidates, canvas.config.objectSnapDistance);
          if (end === "from") {
            if (target) edge.update({ side: target.side, node: target.node, end: from.end }, to);
            else edge.update({ side: from.side, node: dummy, end: from.end }, to);
          } else {
            if (target) edge.update(from, { side: target.side, node: target.node, end: to.end });
            else edge.update(from, { side: to.side, node: dummy, end: to.end });
          }
        },
        end: () => {
          if (!target) canvas.removeEdge(edge);
          canvas.requestSave();
        },
        cancel: () => edge.update(from, to),
        cleanup: () => {
          canvas.canvasEl.removeClass("is-connecting");
          ng08SuppressNextEvent(edge.lineGroupEl, "click");
        },
      });
    });
  };

  canvas.Edge = CanvasEdge;
  return CanvasEdge;
}

/** Cubic bezier point at t, used for edge label placement. */
function cubicAt(t, bezier) {
  const { from: n, to: i, cp1: r, cp2: o } = bezier;
  const a = 1 - t;
  const s = a * a * a;
  const l = 3 * t * a * a;
  const c = 3 * t * t * a;
  const u = t * t * t;
  return { x: s * n.x + l * r.x + c * o.x + u * i.x, y: s * n.y + l * r.y + c * o.y + u * i.y };
}

// =====================================================================================================================
// Canvas view (r8) — a TextFileView hosting the canvas controller.
// =====================================================================================================================

export function defineCanvasView(host) {
  class CanvasView extends host.TextFileView {
    constructor(leaf, plugin) {
      super(leaf);
      this.icon = "lucide-layout-dashboard";
      this.hoverPopover = null;
      this.isPlaintext = false;
      this.plugin = plugin;
      this.canvas = new host.s14CanvasController(this);
      const scope = (this.scope = new host.Scope(this.app.scope));
      const editable = (e) => !host.isEditableTarget(e.targetNode);
      scope.register(["Mod"], "z", (e) => {
        if (editable(e)) {
          e.preventDefault();
          this.canvas.undo();
        }
      });
      scope.register(["Mod"], "a", (e) => {
        if (editable(e)) this.canvas.selectAll();
      });
      const redo = (e) => {
        if (editable(e)) {
          e.preventDefault();
          this.canvas.redo();
        }
      };
      scope.register(["Mod", "Shift"], "z", redo);
      scope.register(["Mod"], "y", redo);
      scope.register(["Shift"], "1", (e) => {
        if (editable(e)) this.canvas.zoomToFit();
      });
      scope.register(["Shift"], "2", (e) => {
        if (editable(e)) this.canvas.zoomToSelection();
      });
      for (const [key, dir] of [
        ["ArrowRight", "right"],
        ["ArrowLeft", "left"],
        ["ArrowUp", "up"],
        ["ArrowDown", "down"],
      ]) {
        scope.register([], key, (e) => {
          if (editable(e)) {
            e.preventDefault();
            this.canvas.nudgeSelection(e, dir);
          }
        });
        scope.register(["Shift"], key, (e) => {
          if (editable(e)) {
            e.preventDefault();
            this.canvas.nudgeSelection(e, dir);
          }
        });
      }
    }

    async setState(state, result) {
      await super.setState(state, result);
      if (state.viewState) this.canvas.setState(state.viewState);
    }

    getState() {
      const state = super.getState();
      state.viewState = this.canvas.getState();
      return state;
    }

    setEphemeralState(state) {
      super.setEphemeralState(state);
      if (state.focus) this.canvas.wrapperEl.focus({ preventScroll: true });
      if (state.match !== undefined) {
        const { nodeId, content, matches } = state.match;
        const node = nodeId && this.canvas.nodes.get(nodeId);
        if (node) {
          this.canvas.selectOnly(node);
          this.canvas.panIntoView(node.getBBox());
          if (node instanceof canvas.TextNode && node.child instanceof canvas.MarkdownEmbed && matches.length > 0) {
            const line = newlinesBefore(content, matches[0][0]);
            node.child.previewMode.renderer.applyScrollDelayed(line, { center: true, highlight: true });
          }
        }
      }
    }

    onResize() { this.canvas.onResize(); }

    getViewType() { return host.CanvasViewType; }

    getViewData() { return host.canvasSerialize(this.canvas.data); }

    setViewData(data, clear) {
      const canvas = this.canvas;
      if (clear) this.clear();
      if (data) {
        canvas.setData(JSON.parse(data));
        if (clear) {
          canvas.zoomToFitQueued = true;
          canvas.onResize();
        }
      } else {
        canvas.createPlaceholder();
        canvas.requestFrame();
      }
      if (clear) {
        const local = this.getLocalData();
        if (local && Object.hasOwn(local, "readonly") && typeof local.readonly === "boolean") {
          canvas.setReadonly(local.readonly);
        }
      }
    }

    clear() { this.canvas.clear(); }

    async onOpen() {
      this.canvas.load();
      await super.onOpen();
    }

    async onClose() {
      await super.onClose();
      this.canvas.unload();
    }

    handleCut(e) { this.canvas.handleCut(e); }
    handleCopy(e) { this.canvas.handleCopy(e); }
    handlePaste(e) { this.canvas.handlePaste(e); }

    onPaneMenu(menu, source) {
      super.onPaneMenu(menu, source);
      if (host.Platform.isDesktopApp) {
        const view = this;
        menu.addItem((item) =>
          item
            .setSection("action")
            .setTitle(host.canvasI18n.actionExportPng())
            .setIcon("lucide-image")
            .onClick(() => view.canvas.generateHDImage()),
        );
      }
    }

    getLocalData() { return this.plugin.localDataManager.load(this.file); }

    saveLocalData() {
      const data = {};
      if (this.canvas.readonly) data.readonly = true;
      this.plugin.localDataManager.save(this.file, Object.keys(data).length === 0 ? null : data);
    }
  }
  canvas.View = CanvasView;
  return CanvasView;
}

// =====================================================================================================================
// Canvas embed renderer (a8)
// =====================================================================================================================

/** Renders a .canvas file embedded in a note: the svg minimap of its nodes and edges. */
export function defineCanvasEmbed(host) {
  class CanvasEmbedRenderer extends host.Component {
    constructor(ctx, file, subpath) {
      super();
      const { app } = ctx;
      this.app = app;
      this.ctx = ctx;
      const containerEl = (this.containerEl = ctx.containerEl);
      containerEl.addClass("canvas-embed");
      this.file = file;
      this.subpath = subpath;
      if (ctx.showInline) {
        containerEl.addClass("inline-embed");
        this.headerEl = containerEl.createDiv({ cls: "embed-title" }, (el) => {
          el.createSpan({ cls: "file-embed-icon" }, (icon) => host.setIcon(icon, "lucide-layout-dashboard"));
          el.appendText(" " + file.basename);
        });
        containerEl.addEventListener("click", (e) => {
          this.app.workspace.getLeaf(host.keyModifiers.isModEvent(e)).openLinkText(ctx.linktext, ctx.sourcePath);
        });
      }
    }

    async loadFile() {
      const containerEl = this.containerEl;
      const headerEl = this.headerEl;
      containerEl.empty();
      if (headerEl) containerEl.appendChild(headerEl);
      const text = await this.app.vault.cachedRead(this.file);
      s14RenderMinimap(containerEl, text, host);
    }
  }
  return CanvasEmbedRenderer;
}

// =====================================================================================================================
// Canvas settings tab (s8)
// =====================================================================================================================

export function defineCanvasSettingsTab(host) {
  class CanvasSettingsTab extends host.PluginInstanceSettingTab {
    constructor(app, plugin, instance) {
      super(app, plugin);
      this.icon = "layout-dashboard";
      this.instance = instance;
    }

    display() {
      const self = this;
      const containerEl = this.containerEl;
      containerEl.empty();
      const options = this.instance.options;
      let locationSetting;
      let zoomSlider;
      let extraSettings;
      const syncFolderVisibility = () => locationSetting.settingEl.toggle(options.newFileLocation === "folder");
      const syncZoomExtra = (value) => extraSettings.extraSettingsEl.toggleVisibility(value !== 0);

      new host.SettingGroup(containerEl)
        .addSetting((setting) =>
          setting
            .setName(host.canvasI18n.optionNewCanvasLocation())
            .addDropdown((dropdown) => {
              locationSetting = dropdown;
              dropdown
                .addOption("root", host.t.setting.file.optionChoiceVaultRoot())
                .addOption("current", host.t.setting.file.optionChoiceCurrentFolder())
                .addOption("folder", host.t.setting.file.optionChoiceSpecifiedFolder())
                .setValue(options.newFileLocation || "root")
                .onChange((value) => {
                  options.newFileLocation = value;
                  self.plugin.saveData(options);
                  syncFolderVisibility();
                });
            }),
        )
        .addSetting((setting) =>
          setting
            .setName(host.canvasI18n.optionNewCanvasFolderPath())
            .setDesc(host.canvasI18n.optionNewCanvasFolderPathDescription())
            .addText((text) => {
              text
                .setPlaceholder(host.t.setting.folderPathExamplePlaceholder())
                .setValue(options.newFileFolderPath === "/" ? "" : options.newFileFolderPath)
                .onChange((value) => {
                  options.newFileFolderPath = value;
                  self.plugin.saveData(options);
                });
              new host.FolderPathSuggestTab(self.app, text.inputEl, false, true);
            }),
        )
        .addSetting((setting) =>
          setting
            .setName(host.canvasI18n.optionWheelBehavior())
            .addDropdown((dropdown) =>
              dropdown
                .addOption("pan", host.canvasI18n.labelPan())
                .addOption("zoom", host.canvasI18n.labelZoom())
                .setValue(options.defaultWheelBehavior || "pan")
                .onChange((value) => {
                  options.defaultWheelBehavior = value;
                  self.plugin.saveData(options);
                }),
            ),
        )
        .addSetting((setting) =>
          setting
            .setName(host.canvasI18n.optionModDragBehavior({ key: host.s14KeyNames(["Mod", "Drag"]) }))
            .addDropdown((dropdown) =>
              dropdown
                .addOption("menu", host.canvasI18n.optionShowMenu())
                .addOption("card", host.canvasI18n.actionAddCard())
                .addOption("note", host.canvasI18n.actionAddNote())
                .addOption("media", host.canvasI18n.actionAddMedia())
                .addOption("webpage", host.canvasI18n.actionAddWebsite())
                .addOption("group", host.canvasI18n.actionCreateGroup())
                .setValue(options.defaultModDragBehavior || "menu")
                .onChange((value) => {
                  options.defaultModDragBehavior = value;
                  self.plugin.saveData(options);
                }),
            ),
        )
        .addSetting((setting) =>
          setting
            .setName(host.canvasI18n.optionNodeLabel())
            .addDropdown((dropdown) =>
              dropdown
                .addOption("always", host.canvasI18n.labelAlways())
                .addOption("hover", host.canvasI18n.labelHover())
                .addOption("never", host.canvasI18n.labelNever())
                .setValue(options.cardLabelVisibility || "always")
                .onChange((value) => {
                  options.cardLabelVisibility = value;
                  self.plugin.saveData(options);
                  self.instance.rerenderCanvases();
                }),
            ),
        )
        .addSetting((setting) =>
          setting
            .setName(host.canvasI18n.optionSnapToGrid())
            .setDesc(host.canvasI18n.optionSnapToGridDesc())
            .addToggle((toggle) =>
              toggle
                .setValue(options.snapToGrid)
                .onChange((value) => {
                  options.snapToGrid = value;
                  self.plugin.saveData(options);
                }),
            ),
        )
        .addSetting((setting) =>
          setting
            .setName(host.canvasI18n.optionSnapToObjects())
            .setDesc(host.canvasI18n.optionSnapToObjectsDesc())
            .addToggle((toggle) =>
              toggle
                .setValue(options.snapToObjects)
                .onChange((value) => {
                  options.snapToObjects = value;
                  self.plugin.saveData(options);
                }),
            ),
        )
        .addSetting((setting) => {
          extraSettings = setting
            .setName(host.canvasI18n.optionZoomBreakpoint())
            .setDesc(host.canvasI18n.optionZoomBreakpointDesc())
            .addExtraButton((button) =>
              button
                .setIcon("lucide-rotate-ccw")
                .setTooltip(host.t.setting.hotkeys.tooltipRestoreDefault())
                .onClick(() => zoomSlider.setValue(0)),
            )
            .addSlider((slider) => {
              zoomSlider = slider;
              slider
                .setLimits(-0.7, 2.4, 0.01)
                .setValue(options.zoomBreakpoint || 0)
                .onChange((value) => {
                  options.zoomBreakpoint = value;
                  self.plugin.saveData(options);
                  syncZoomExtra(value);
                });
            });
        });

      syncFolderVisibility();
      syncZoomExtra(options.zoomBreakpoint || 0);
      window.__fpSettings && window.__fpSettings(containerEl, options, this.plugin, this.instance, host.Setting);
    }
  }
  return CanvasSettingsTab;
}

// =====================================================================================================================
// Canvas minimap (o8)
// =====================================================================================================================

/** Draws a small svg overview of the canvas's nodes and edges into `containerEl`. */
export function s14RenderMinimap(containerEl, text, host) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return;
  }
  const nodes = data.nodes;
  let edges = data.edges;
  if (!nodes || nodes.length === 0) return;
  if (!edges) edges = [];

  const svg = createSvg("svg", "canvas-minimap");
  const boxes = {};
  const all = [];
  for (const node of nodes) {
    const box = boxOfRect(node);
    boxes[node.id] = box;
    all.push(box);
  }
  const bounds = boxUnion(all);

  const drawNode = (node) => {
    host.applyCanvasColor(
      svg.createSvg("rect", {
        attr: { x: node.x, y: node.y, width: node.width, height: node.height, rx: "20", ry: "20" },
      }),
      node.color,
    );
  };
  for (const node of nodes) {
    if (node.type === "group") drawNode(node);
  }
  for (const edge of edges) {
    const from = boxes[edge.fromNode];
    const to = boxes[edge.toNode];
    if (!from || !to) continue;
    const bezier = bezierEdge(sideMidpoint(from, edge.fromSide), edge.fromSide, sideMidpoint(to, edge.toSide), edge.toSide);
    const path = svg.createSvg("path", { attr: { d: bezier.path } });
    path.style.strokeWidth = String(Math.sqrt((bounds.maxX - bounds.minX) / 10));
    host.applyCanvasColor(path, edge.color);
  }
  for (const node of nodes) {
    if (node.type !== "group") drawNode(node);
  }
  const padded = boxGrow(bounds, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 20);
  svg.setAttr(
    "viewBox",
    padded.minX + " " + padded.minY + " " + (padded.maxX - padded.minX) + " " + (padded.maxY - padded.minY),
  );
  containerEl.appendChild(svg);
}
