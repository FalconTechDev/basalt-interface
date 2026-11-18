// g05 clean-room: PdfViewerController — owns the pdf.js viewer application
// object for one pdf file view / embed: scaffold DOM, load/unload, file
// loading, subpath application and theme handling. Highlight/annotation/menu
// behaviour lives in n-g05-pdf-interact.js (attached onto the same prototype).
import { env, hostEnv } from "./env.js";
import { debounceCall } from "./timing.js";
import { ng05ParsePdfSubpath, ng05PdfViewerNs, ng05InnerViewer, ng05PdfStorageKey } from "./n-g05-pdf-util.js";
import { ng05AttachInteract } from "./n-g05-pdf-interact.js";
import { ng05BuildPasswordDialog, ng05BuildToolbar } from "./n-g05-pdf-dialog.js";
import { ng05PdfKitGet, ng05EnsurePdfJs, ng05EnsureWorkerBlob } from "./n-g05-pdf-viewer.js";

/** ` _Z` — the viewer controller driving the bundled pdf.js viewer. */
export function ng05BuildController(host) {
  function PdfViewerController(app, scope, containerEl, opts) {
    this.app = app;
    this.scope = scope;
    this.containerEl = containerEl;
    this.opts = opts || {};
    this.eventBus = null; // created in load() once pdf.js is guaranteed loaded
    this.pdfViewer = null;        // the pdf.js application object
    this.toolbar = null;
    this.findBar = null;
    this.file = null;
    this.subpathHighlight = null;
    this.currentSubpath = "";
    this.highlightedText = null;
    this.annotationHighlight = null;
    this.activeAnnotationPopupEl = null;
    this.loadingEl = null;
    this._active = false;
    this._destroyed = false;
    this._escapeHandler = null;
    this._resizeObserver = null;
    this._pendingTextHighlight = null;
    this._pendingAnnotationHighlight = null;
    this._dom = null;
    this._wrapper = null;
  }
  const proto = PdfViewerController.prototype;

  proto.on = function (name, cb) { if (this.eventBus) this.eventBus._on(name, cb); };
  proto.off = function (name, cb) { if (this.eventBus) this.eventBus._off(name, cb); };

  proto.getPage = function (pageNumber) {
    const inner = ng05InnerViewer(this.pdfViewer);
    return inner && inner.getPageView ? inner.getPageView(pageNumber - 1) : null;
  };

  proto.onResize = function () {
    if (this.containerEl && this.containerEl.isShown && this.containerEl.isShown() && this.eventBus) {
      this.eventBus.dispatch("resize", { source: this });
    }
  };

  proto.getMarkdownLink = function (subpath, alias, embed) {
    const link = this.app.fileManager.generateMarkdownLink(this.file, "", subpath, alias);
    return embed ? "!" + link : link;
  };

  proto.applySubpath = function (subpath) {
    const parsed = ng05ParsePdfSubpath(subpath);
    this.subpathHighlight = parsed.highlight;
    const app = this.pdfViewer;
    if (!app) return;
    const go = () => {
      if (app.pdfLinkService && app.pdfDocument) {
        try {
          if (parsed.simple && parsed.page !== null) app.pdfLinkService.goToPage(parsed.page);
          else if (parsed.destJson) app.pdfLinkService.goToDestination(JSON.parse(parsed.destJson));
        } catch (e) { console.error(e); }
      }
    };
    if (app.pdfLoadingTask) {
      app.pdfLoadingTask.promise.then(go).catch(() => {});
    } else if (app.pdfDocument) {
      go();
    } else {
      // pdf.js consumes `subpath` as a query string at open time
      app.subpath = parsed.query;
    }
  };

  proto.onCSSChange = function () {
    const app = this.pdfViewer;
    if (!app) return;
    const themed = !!this.app.loadLocalStorage(ng05PdfStorageKey);
    const pdfContainerEl = this._dom && this._dom.containerEl;
    let background = null;
    let invert = false;
    if (themed && pdfContainerEl) {
      background = getComputedStyle(pdfContainerEl).getPropertyValue("--pdf-page-background").trim();
      invert = document.body.classList.contains("theme-dark");
    }
    const inner = ng05InnerViewer(app);
    if (inner && background !== inner.pageBackground) {
      pdfContainerEl && pdfContainerEl.classList.toggle("mod-themed", themed);
      app.setBackground(background, invert);
    }
  };

  proto.load = async function () {
    const opts = this.opts;
    if (opts.initDelay) {
      await host.sleep(opts.initDelay);
      if (this._destroyed) return;
    }
    // pdf.js arrives via the blob-URL warm-up; the host script loader is only
    // a fallback — its module-script path can hang on this transport and a
    // late re-import would clobber the namespace pdf.viewer already bound.
    if (!(window.pdfjsLib && window.pdfjsViewer)) {
      const ok = await ng05EnsurePdfJs(30000);
      if (this._destroyed) return;
      if (!ok) {
        await Promise.race([
          Promise.resolve(host.s27LoadPdfViewer()).catch(() => {}),
          host.sleep(20000),
        ]);
      }
    }
    if (this._destroyed) return;
    if (host.Platform.isMobile) host.s27PdfConfig.maxCanvasPixels = 5242880;

    const doc = this.containerEl.doc;
    const viewerNs = ng05PdfViewerNs(host);
    if (!viewerNs) throw new Error("pdf.js failed to load");
    this.eventBus = new viewerNs.EventBus();

    // hidden scaffold built off-view inside the document body
    const wrapper = this._wrapper = createDiv();
    wrapper.setCssProps({
      position: "fixed", left: "-10000px", top: "0", opacity: "0",
      "z-index": "-1", "pointer-events": "none",
    });
    const pdfContainerEl = wrapper.createDiv("pdf-container");
    const contentEl = pdfContainerEl.createDiv("pdf-content-container");
    const viewerContainerEl = contentEl.createDiv("pdf-viewer-container");
    const viewerEl = viewerContainerEl.createDiv("pdfViewer");
    const sidebarContainerEl = contentEl.createDiv("pdf-sidebar-container");
    const sidebarWrapEl = sidebarContainerEl.createDiv("pdf-sidebar-content-wrapper");
    const sidebarContentEl = sidebarWrapEl.createDiv("pdf-sidebar-content");
    const thumbnailViewEl = sidebarContentEl.createDiv("pdf-thumbnail-view");
    const outlineViewEl = sidebarContentEl.createDiv("pdf-outline-view hidden");
    doc.body.appendChild(wrapper);

    const dom = this._dom = {
      containerEl: pdfContainerEl,
      contentEl,
      viewerContainerEl,
      viewerEl,
      sidebarContainerEl,
      thumbnailViewEl,
      outlineViewEl,
    };

    // themed pages: remember the flag and feed the computed page background
    let pageBackground = null;
    let pageInvert = false;
    if (this.app.loadLocalStorage(ng05PdfStorageKey)) {
      pdfContainerEl.addClass("mod-themed");
      pageBackground = getComputedStyle(pdfContainerEl).getPropertyValue("--pdf-page-background").trim();
      pageInvert = doc.body.classList.contains("theme-dark");
    }

    viewerContainerEl.addEventListener("transitionend", (evt) => {
      if (evt.target === viewerContainerEl) this.eventBus.dispatch("resize", { source: this });
    }, true);
    viewerContainerEl.addEventListener("contextmenu", (evt) => this.onContextMenu(evt));
    viewerContainerEl.addEventListener("pointerdown", (evt) => this.onAnnotationPointerDown(evt));
    sidebarContainerEl.addEventListener("contextmenu", (evt) => this.onThumbnailContextMenu(evt));

    const app = this.pdfViewer = viewerNs.createObsidianPDFViewer({
      baseConfig: host.s27PdfConfig,
      l10n: new host.s27PdfL10n(),
      eventBus: this.eventBus,
      removePageBorders: opts.removePageBorders,
      dom,
      height: opts.height,
      isEmbed: opts.isEmbed,
      pageBackground,
      pageInvert,
    });

    // app:// serves no JS MIME type, so the configured "/lib/pdfjs/pdf.worker.min.js"
    // can never load as a module worker (nor as the fake-worker import fallback —
    // and that failure permanently poisons pdf.js for the page). Point the stored
    // preference at a blob: URL of the worker module instead; open() copies
    // AppOptions' preference-kind values onto GlobalWorkerOptions before
    // getDocument, so this wins over baseConfig.workerSrc.
    const workerBlob = await ng05EnsureWorkerBlob();
    if (this._destroyed) return;
    if (workerBlob && viewerNs.AppOptions) viewerNs.AppOptions.set("workerSrc", workerBlob);

    this.toolbar = new (ng05ToolbarCtor(host))(this.app, pdfContainerEl, this);
    this.findBar = new host.s27PdfFindBar(this.app, contentEl, this.eventBus, this.scope);
    app.findBar = this.findBar;
    app.passwordPrompt = new (ng05PasswordCtor(host))(viewerContainerEl, this.eventBus);
    app.pdfOutlineViewer = new host.s27PdfOutline(this, outlineViewEl, this.eventBus);
    app.toolbar = this.toolbar;

    // window migration: close and reopen the same file in the new window
    if (contentEl.onWindowMigrated) {
      contentEl.onWindowMigrated(() => {
        const file = this.file;
        if (!file || !this.pdfViewer) return;
        const subpath = this.currentSubpath;
        const viewer = this.pdfViewer;
        Promise.resolve(viewer.close()).catch(() => {}).then(() => {
          if (!this.pdfViewer) return;
          return viewer.open({ url: this.app.vault.getResourcePath(file), ownerDocument: this.containerEl.doc });
        }).then(() => {
          if (subpath && viewer.pdfLoadingTask) {
            viewer.pdfLoadingTask.promise.then(() => this.applySubpath(subpath)).catch(() => {});
          }
        }).catch((e) => console.error(e));
      });
    }

    const bus = this.eventBus;
    bus._on("sidebarviewchanged", (evt) => {
      sidebarContainerEl.dataset.view = evt.view;
    });
    bus._on("find", () => this.clearEphemeralUI());
    this._escapeHandler = this.scope.register([], "Escape", (evt) => {
      if (hostEnv().Kl(evt)) return;
      this.clearEphemeralUI();
      if (this.findBar) this.findBar.close();
    });

    // debounced (~200 ms, leading edge) resize dispatch while the container is shown
    let lastFire = 0, pending = false;
    const fireResize = () => {
      if (pdfContainerEl.isShown && pdfContainerEl.isShown()) this.eventBus.dispatch("resize", { source: this });
    };
    const onMaybeResize = () => {
      const now = Date.now();
      if (now - lastFire >= 200) { lastFire = now; fireResize(); }
      else if (!pending) {
        pending = true;
        setTimeout(() => { pending = false; lastFire = Date.now(); fireResize(); }, 200 - (now - lastFire));
      }
    };
    this._resizeObserver = new ResizeObserver(debounceCall(onMaybeResize, 50));
    this._resizeObserver.observe(pdfContainerEl);

    await app.initialize();
    if (this._destroyed) { this.unload(); return; }

    // reveal: move the scaffold content into the real container
    wrapper.detach();
    this._wrapper = null;
    app.dom.containerEl = this.containerEl;
    this.containerEl.appendChild(this.toolbar.toolbarEl);
    this.containerEl.appendChild(pdfContainerEl);
    if (typeof opts.height === "number") app.setHeight(opts.height);
    this._active = true;

    bus._on("textlayerrendered", (evt) => this.onTextLayerRendered(evt));
    if (opts.isEmbed) {
      bus._on("pagerendered", () => {
        const hidden = pdfContainerEl.querySelector(".hiddenCopyElement");
        if (hidden) hidden.remove();
      }, { once: true });
    }
    bus._on("annotationlayerrendered", (evt) => this.onAnnotationLayerRendered(evt));
  };

  proto.onTextLayerRendered = function (evt) {
    const pageNumber = evt && evt.pageNumber;
    if (host.Platform.isMobile) {
      const pageView = this.getPage(pageNumber);
      const layerEl = pageView && pageView.div && pageView.div.querySelector(".textLayer");
      if (layerEl && !layerEl.__ng05CopyBound) {
        layerEl.__ng05CopyBound = true;
        layerEl.addEventListener("copy", (e) => this.onMobileCopy(e));
      }
    }
    const pending = this._pendingTextHighlight;
    if (pending && pending.page === pageNumber) {
      this._pendingTextHighlight = null;
      this.highlightText(pageNumber, pending.range);
    }
    const hl = this.subpathHighlight;
    if (hl && hl.type === "text" && hl.page === pageNumber) {
      this.highlightText(pageNumber, hl.range);
    }
  };

  proto.onAnnotationLayerRendered = function (evt) {
    const pageNumber = evt && evt.pageNumber;
    const pending = this._pendingAnnotationHighlight;
    if (pending && pending.page === pageNumber) {
      this._pendingAnnotationHighlight = null;
      this.highlightAnnotation(pageNumber, pending.id);
    }
    const hl = this.subpathHighlight;
    if (hl && hl.type === "annotation" && hl.page === pageNumber) {
      this.highlightAnnotation(pageNumber, hl.id);
    }
  };

  proto.loadFile = async function (file, subpath) {
    const app = this.pdfViewer;
    if (!this._active || !app) return;
    app.subpath = null;
    this.file = null;
    this.currentSubpath = subpath || "";
    const parsed = ng05ParsePdfSubpath(subpath);
    this.subpathHighlight = parsed.highlight;
    const displayMode = !!this.opts.displayMode;

    const open = async () => {
      const viewer = this.pdfViewer;
      if (!viewer) return;
      const inner = ng05InnerViewer(viewer);
      if (displayMode && inner) {
        inner.scrollMode = 3;   // page-at-a-time scrolling
        inner.spreadMode = 0;   // no spread
      }
      // hand the query to pdf.js for the initial view, then re-apply once the
      // new loading task exists so custom destinations (offset/zoom) land
      const parsed = ng05ParsePdfSubpath(subpath);
      this.subpathHighlight = parsed.highlight;
      viewer.subpath = parsed.query;
      this.file = file;
      try {
        await viewer.open({ url: this.app.vault.getResourcePath(file), ownerDocument: this.containerEl.doc });
        this.applySubpath(subpath);
        if (displayMode && inner && inner._pagesCapability) {
          try {
            await inner._pagesCapability.promise;
            const pageView = inner.getPageView(inner._currentPageNumber - 1);
            const canvas = pageView && pageView.canvas;
            if (canvas) {
              canvas.style.maxWidth = pageView.viewport.width + "px";
              const wrapper = createDiv("canvasWrapper");
              wrapper.appendChild(canvas);
              this.containerEl.appendChild(wrapper);
              if (viewer.height === "auto" || viewer.height === "page") this.containerEl.style.height = "auto";
            }
          } catch (e) { console.error(e); }
        }
      } catch (e) {
        console.error(e);
      }
    };

    if (this.containerEl.offsetParent) {
      // visible already: a protected file raises passwordpromptopen while the
      // open promise is pending — pdf.js only finishes open() after the
      // password callback, so awaiting it covers the prompt wait.
      await open();
      return;
    }
    // not in the DOM yet: defer opening until insertion
    this.containerEl.onNodeInserted(open, true);
  };

  proto.unload = function () {
    this._destroyed = true;
    this._active = false;
    if (this._escapeHandler && this.scope) {
      try { this.scope.unregister(this._escapeHandler); } catch (e) {}
      this._escapeHandler = null;
    }
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this.pdfViewer) {
      try { this.pdfViewer.close(); } catch (e) {}
      this.pdfViewer = null;
    }
    this.toolbar = null;
    this.findBar = null;
    this.file = null;
    this.subpathHighlight = null;
    this.currentSubpath = "";
    this.highlightedText = null;
    this.annotationHighlight = null;
    this.activeAnnotationPopupEl = null;
    this._pendingTextHighlight = null;
    this._pendingAnnotationHighlight = null;
    this._dom = null;
    if (this.containerEl) this.containerEl.empty();
  };

  ng05AttachInteract(proto, host);
  return PdfViewerController;
}

// kit lookups kept at the bottom so the class bodies above stay readable;
// they resolve lazily through the shared kit in n-g05-pdf-viewer.js.
function ng05ToolbarCtor(host) { return ng05PdfKitGet(host, "toolbar", () => ng05BuildToolbar(host)); }
function ng05PasswordCtor(host) { return ng05PdfKitGet(host, "password", () => ng05BuildPasswordDialog(host)); }
