// g05 clean-room: PdfComponent (lazy controller wrapper), PdfView (the "pdf"
// file view) and PdfEmbed (the `![[file.pdf]]` embed with its own toolbar
// affordance). Class factories are resolved lazily through the shared kit so
// construction order inside the bundle does not matter.
import { inherit } from "./inherit.js";
import { isEditableNode } from "./tree.js";
import { ng05ParsePdfSubpath } from "./n-g05-pdf-util.js";
import { ng05PdfKitGet } from "./n-g05-pdf-viewer.js";
import { ng05BuildController } from "./n-g05-pdf-controller.js";

function ng05ComponentCtor(host) { return ng05PdfKitGet(host, "component", () => ng05BuildComponent(host)); }
function ng05ControllerCtor(host) { return ng05PdfKitGet(host, "controller", () => ng05BuildController(host)); }

/** `GZ` — lazy wrapper: owns the controller's scope and queues `then` callbacks. */
export function ng05BuildComponent(host) {
  function PdfComponent(app, containerEl, opts) {
    const self = host.Component.call(this) || this;
    self.app = app;
    self.containerEl = containerEl;
    self.opts = opts || {};
    self.scope = new host.Scope(app.scope);
    self.child = null;
    self.next = null;
    self.ready = false;
    return self;
  }
  inherit(PdfComponent, host.Component);
  const proto = PdfComponent.prototype;

  proto.onload = function () {
    host.Component.prototype.onload.call(this);
    this.registerEvent(this.app.workspace.on("css-change", () => {
      this.then((child) => { if (child.onCSSChange) child.onCSSChange(); });
    }));
    if (this.child) return;
    const child = this.child = new (ng05ControllerCtor(host))(this.app, this.scope, this.containerEl, this.opts);
    return child.load().then(() => {
      if (this.child !== child) return; // replaced mid-load
      const queued = this.next;
      this.next = null;
      this.ready = true;
      if (queued) {
        for (const cb of queued) {
          try { cb(child); } catch (e) { setTimeout(() => { throw e; }); }
        }
      }
    });
  };

  proto.onunload = function () {
    host.Component.prototype.onunload.call(this);
    if (this.child) { this.child.unload(); this.child = null; }
    this.next = null;
    this.ready = false;
  };

  proto.then = function (cb) {
    if (this.child && this.ready && this.next === null) { cb(this.child); return; }
    (this.next || (this.next = [])).push(cb);
  };

  proto.loadFile = function (file, subpath) {
    if (!this.child) return Promise.resolve();
    return new Promise((resolve) => {
      this.then((child) => {
        Promise.resolve(child.loadFile(file, subpath)).then(resolve, resolve);
      });
    });
  };

  return PdfComponent;
}

/** `KZ` — the "pdf" file view. */
export function ng05BuildView(host) {
  const Base = host.EditableFileView;
  function PdfView(leaf) {
    const self = Base.apply(this, arguments) || this;
    self.icon = "lucide-file-text";
    self.viewer = new (ng05ComponentCtor(host))(self.app, self.contentEl, {
      removePageBorders: host.Platform.isMobile,
    });
    self.addChild(self.viewer);
    self.scope = self.viewer.scope;
    return self;
  }
  inherit(PdfView, Base);
  const proto = PdfView.prototype;

  proto.getViewType = function () { return "pdf"; };
  proto.canAcceptExtension = function (ext) { return host.pdfExtensions.contains(ext); };

  proto.pageStep = function (dir) {
    this.viewer.then((child) => {
      const app = child.pdfViewer;
      const inner = app && app.pdfViewer;
      if (!inner) return;
      const scale = inner.currentScaleValue;
      if (scale !== "page-width" && scale !== "page-height") return;
      if (dir > 0 && inner.nextPage) inner.nextPage();
      else if (dir < 0 && inner.previousPage) inner.previousPage();
    });
  };

  proto.onload = function () {
    const base = host.EditableFileView.prototype.onload;
    if (base) base.call(this);
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file === this.file) this.onModify(file);
    }, this));
    this.scope.register([], "ArrowLeft", (evt) => {
      if (isEditableNode(evt.targetNode)) return;
      const inner = this.viewer.child && this.viewer.child.pdfViewer && this.viewer.child.pdfViewer.pdfViewer;
      const scale = inner && inner.currentScaleValue;
      if (scale !== "page-width" && scale !== "page-height") return;
      evt.preventDefault();
      this.pageStep(-1);
    });
    this.scope.register([], "ArrowRight", (evt) => {
      if (isEditableNode(evt.targetNode)) return;
      const inner = this.viewer.child && this.viewer.child.pdfViewer && this.viewer.child.pdfViewer.pdfViewer;
      const scale = inner && inner.currentScaleValue;
      if (scale !== "page-width" && scale !== "page-height") return;
      evt.preventDefault();
      this.pageStep(1);
    });
  };

  proto.onModify = function () { this.viewer.loadFile(this.file); };

  proto.onLoadFile = function (file) { return this.viewer.loadFile(file); };

  proto.onUnloadFile = function () {
    const child = this.viewer.child;
    if (child && child.pdfViewer) child.pdfViewer.close();
  };

  proto.setEphemeralState = function (eState) {
    const base = host.EditableFileView.prototype.setEphemeralState;
    if (base) base.call(this, eState);
    this.viewer.then((child) => {
      if (eState.subpath) child.applySubpath(eState.subpath);
      if (eState.focus) {
        const inner = child.pdfViewer && child.pdfViewer.pdfViewer;
        const done = () => {
          const el = child.containerEl && child.containerEl.querySelector(".pdfViewer");
          if (el && el.focus) el.focus();
        };
        if (inner && inner.firstPagePromise) inner.firstPagePromise.then(done, done);
        else done();
      }
    });
  };

  proto.showSearch = function () {
    this.viewer.then((child) => { if (child.findBar) child.findBar.showSearch(); });
  };

  PdfView.VIEW_TYPE = "pdf";
  return PdfView;
}

/** `YZ` — the `![[document.pdf]]` embed. */
export function ng05BuildEmbed(host) {
  function PdfEmbed(ctx, file, subpath) {
    const self = host.Component.call(this) || this;
    self.app = ctx.app;
    self.containerEl = ctx.containerEl;
    self.ctx = ctx;
    self.file = file;
    self.subpath = subpath || "";
    self.containerEl.addClass("pdf-embed");
    const parsed = ng05ParsePdfSubpath(self.subpath);
    const height = parsed.height !== null && parsed.height > 0 ? parsed.height : "page";
    self.viewer = new (ng05ComponentCtor(host))(self.app, self.containerEl, {
      removePageBorders: true,
      isEmbed: true,
      height,
      initDelay: 300,
      displayMode: ctx.displayMode,
    });
    self.addChild(self.viewer);
    self.viewer.then((child) => {
      const right = child.toolbar && child.toolbar.toolbarRightEl;
      if (right) {
        right.createDiv("pdf-toolbar-spacer");
        const btn = right.createDiv("clickable-icon pdf-embed-open", (el) => {
          host.setIcon(el, "lucide-more-vertical");
          host.setTooltip(el, host.t.setting.about.buttonOpen());
        });
        btn.addEventListener("click", () => {
          const menu = new host.Menu().setParentElement(btn);
          if (!self.app.workspace.handleLinkContextMenu(menu, ctx.linktext, ctx.sourcePath)) return;
          const rect = btn.getBoundingClientRect();
          menu.showAtPosition({ x: rect.left, y: rect.bottom, width: rect.width, overlap: true, left: true }, btn.doc);
        });
      }
      if (child.pdfViewer && child.pdfViewer.dom && child.pdfViewer.dom.viewerContainerEl) {
        host.s27PreserveScroll(child.pdfViewer.dom.viewerContainerEl);
      }
    });
    return self;
  }
  inherit(PdfEmbed, host.Component);
  const proto = PdfEmbed.prototype;

  proto.onload = function () {
    host.Component.prototype.onload.call(this);
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file === this.file) this.loadFile();
    }, this));
  };

  proto.loadFile = function () { return this.viewer.loadFile(this.file, this.subpath); };

  return PdfEmbed;
}
