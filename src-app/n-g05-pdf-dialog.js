// g05 clean-room: the pdf password dialog and the pdf toolbar (sidebar toggle,
// zoom controls, display options, page jump) that sit above the pdf.js pages.
import { ng05PdfLib, ng05PdfViewerNs, ng05PdfStorageKey } from "./n-g05-pdf-util.js";

/** `BZ` — password prompt driven by the pdf.js event bus (passwordpromptopen). */
export function ng05BuildPasswordDialog(host) {
  function PdfPasswordDialog(containerEl, eventBus) {
    this.containerEl = containerEl;
    this.eventBus = eventBus;
    this.updateCallback = null;
    this.reason = null;
    this.dialogEl = null;
  }
  const proto = PdfPasswordDialog.prototype;

  proto.buildUI = function () {
    this.close();
    const pdf = host.t.pdf;
    const dialogEl = this.dialogEl = createDiv("pdf-password-dialog");
    dialogEl.createDiv("pdf-lock-icon", (el) => host.setIcon(el, "lucide-lock"));
    dialogEl.createDiv({ text: pdf.msgPasswordProtected() });
    const wrong = this.reason === ng05PdfLib(host).PasswordResponses.INCORRECT_PASSWORD;
    dialogEl.createDiv({
      cls: wrong ? "mod-warning mod-small" : "mod-small",
      text: wrong ? pdf.msgInvalidPassword() : pdf.msgEnterPassword(),
    });
    const input = dialogEl.createEl("input", {
      cls: "pdf-password-input",
      attr: { type: "password", placeholder: host.t.setting.account.labelPassword() },
    });
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.verify(input.value);
      }
    });
    this.containerEl.appendChild(dialogEl);
    setTimeout(() => input.focus(), 0);
  };

  proto.open = async function () {
    this.buildUI();
    this.eventBus.dispatch("passwordpromptopen", { source: this });
  };

  proto.close = function () {
    if (this.dialogEl) {
      this.dialogEl.detach();
      this.dialogEl = null;
    }
  };

  proto.verify = function (password) {
    if (!password) return;
    this.invokeCallback(password);
  };

  proto.invokeCallback = function (password) {
    this.close();
    const callback = this.updateCallback;
    this.updateCallback = null;
    if (callback) callback(password);
  };

  proto.setUpdateCallback = async function (callback, reason) {
    this.updateCallback = callback;
    this.reason = reason;
  };

  proto.reset = function () {
    this.close();
    this.updateCallback = null;
    this.reason = null;
  };

  return PdfPasswordDialog;
}

/** `HZ` — the toolbar above the pages; `compact` is the legacy layout variant. */
export function ng05BuildToolbar(host) {
  function PdfToolbar(app, containerEl, viewer, compact) {
    this.app = app;
    this.containerEl = containerEl;
    this.viewer = viewer;      // the viewer controller
    this.pdfViewer = viewer;   // field name read by pdf.js viewer internals
    this.eventBus = viewer && viewer.eventBus;
    this.pageNumber = 0;
    this.pageLabel = "";
    this.pagesCount = 0;
    this.hasPageLabels = false;
    this.pageScaleValue = "";
    this.pageScale = 0;
    this.openMenu = null;
    this.compact = !!compact;
    this.buildDOM();
    const bus = this.eventBus;
    if (bus && bus._on) {
      bus._on("sidebarviewchanged", (evt) => {
        if (this.sidebarToggleEl) this.sidebarToggleEl.toggleClass("is-active", evt.view > 0);
      });
    }
  }
  const proto = PdfToolbar.prototype;

  proto.dispatch = function (type, data) {
    const bus = this.eventBus || (this.viewer && this.viewer.eventBus);
    if (bus && bus.dispatch) {
      bus.dispatch(type, data && typeof data === "object" ? Object.assign({ source: this }, data) : { source: this, value: data });
    }
  };

  /** The pdf.js application object behind the controller (has .pdfViewer inner). */
  proto.appViewer = function () { return this.viewer && this.viewer.pdfViewer; };
  /** The inner PDFViewer (currentScaleValue / spreadMode / scrollMode). */
  proto.innerViewer = function () {
    const app = this.appViewer();
    return app && app.pdfViewer ? app.pdfViewer : null;
  };

  proto.iconButton = function (parent, icon, tooltip, onClick) {
    return parent.createEl("button", { cls: "pdf-toolbar-button clickable-icon" }, (btn) => {
      host.setIcon(btn, icon);
      host.setTooltip(btn, tooltip);
      btn.addEventListener("click", onClick);
    });
  };

  /** Single-open dropdown anchored at the button's rect (overlap, left:false). */
  proto.showMenu = function (btn, build) {
    if (this.openMenu && this.openMenu.btn === btn) return;
    if (this.openMenu) this.openMenu.menu.hide();
    const menu = new host.Menu();
    build(menu);
    const rect = btn.getBoundingClientRect();
    menu.onHide(() => {
      if (this.openMenu && this.openMenu.menu === menu) this.openMenu = null;
    });
    this.openMenu = { btn, menu };
    menu.showAtPosition({ x: rect.left, y: rect.bottom, width: rect.width, overlap: true, left: false }, btn.doc);
  };

  proto.buildSidebarMenu = function (menu) {
    const t = host.t.pdf;
    const app = this.appViewer();
    const sidebar = app && app.pdfSidebar;
    const outline = app && app.pdfOutlineViewer;
    const hasOutline = !!(outline && outline.outline);
    menu.addSections(["view", "action"]);
    menu.addItem((item) => item
      .setSection("view")
      .setTitle(t.actionShowThumbnails())
      .setChecked(!!(sidebar && sidebar.isOpen && sidebar.active === 1))
      .onClick(() => { if (sidebar) sidebar.switchView(1); }));
    menu.addItem((item) => item
      .setSection("view")
      .setTitle(t.actionShowOutline())
      .setChecked(!!(sidebar && sidebar.isOpen && sidebar.active === 2))
      .setDisabled(!hasOutline)
      .onClick(() => { if (sidebar) sidebar.switchView(2); }));
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(t.actionRevealInOutline())
      .setDisabled(!hasOutline)
      .onClick(() => {
        if (sidebar && !(sidebar.isOpen && sidebar.active === 2)) sidebar.switchView(2);
        this.dispatch("currentoutlineitem");
      }));
  };

  proto.buildDisplayMenu = function (menu) {
    const t = host.t.pdf;
    const inner = this.innerViewer();
    const scaleValue = inner ? inner.currentScaleValue : "";
    const spreadMode = inner ? inner.spreadMode : -1;
    const themed = !!this.app.loadLocalStorage(ng05PdfStorageKey);
    menu.addSections(["zoom", "spread", "appearance"]);
    menu.addItem((item) => item
      .setSection("zoom").setTitle(t.actionFitWidth())
      .setChecked(scaleValue === "page-width")
      .onClick(() => this.dispatch("scalechanged", "page-width")));
    menu.addItem((item) => item
      .setSection("zoom").setTitle(t.actionFitHeight())
      .setChecked(scaleValue === "page-height")
      .onClick(() => this.dispatch("scalechanged", "page-height")));
    menu.addItem((item) => item
      .setSection("spread").setTitle(t.labelSpreadSingle())
      .setChecked(spreadMode === 0)
      .onClick(() => this.dispatch("switchspreadmode", { mode: 0 })));
    menu.addItem((item) => item
      .setSection("spread").setTitle(t.labelSpreadOdd())
      .setChecked(spreadMode === 1)
      .onClick(() => this.dispatch("switchspreadmode", { mode: 1 })));
    menu.addItem((item) => item
      .setSection("spread").setTitle(t.labelSpreadEven())
      .setChecked(spreadMode === 2)
      .onClick(() => this.dispatch("switchspreadmode", { mode: 2 })));
    menu.addItem((item) => item
      .setSection("appearance").setTitle(t.labelAdaptToTheme())
      .setChecked(themed)
      .onClick(() => {
        if (this.app.loadLocalStorage(ng05PdfStorageKey)) this.app.saveLocalStorage(ng05PdfStorageKey, null);
        else this.app.saveLocalStorage(ng05PdfStorageKey, "true");
        if (this.viewer && this.viewer.onCSSChange) this.viewer.onCSSChange();
      }));
  };

  proto.buildDOM = function () {
    const pdf = host.t.pdf;
    const bar = this.toolbarEl = createDiv("pdf-toolbar");
    const left = this.toolbarLeftEl = bar.createDiv("pdf-toolbar-left");

    this.sidebarToggleEl = this.iconButton(left, "lucide-layout-list", pdf.actionToggleSidebar(),
      () => this.dispatch("togglesidebar"));
    this.sidebarOptionsEl = this.iconButton(left, "lucide-chevron-down", pdf.tooltipSidebarOptions(),
      (evt) => this.showMenu(evt.currentTarget, (menu) => this.buildSidebarMenu(menu)));

    // the legacy (dead) layout keeps only the sidebar controls in the left
    // cluster; zoom and page controls sit directly on the bar
    const mid = this.compact ? bar : left;
    mid.createDiv("pdf-toolbar-spacer");
    this.zoomOutEl = this.iconButton(mid, "lucide-zoom-out", host.t.commands.zoomOut(),
      () => this.dispatch("zoomout"));
    mid.createDiv("pdf-toolbar-divider");
    this.zoomInEl = this.iconButton(mid, "lucide-zoom-in", host.t.commands.zoomIn(),
      () => this.dispatch("zoomin"));
    this.displayOptionsEl = this.iconButton(mid, "lucide-chevron-down", pdf.tooltipDisplayOptions(),
      (evt) => this.showMenu(evt.currentTarget, (menu) => this.buildDisplayMenu(menu)));

    mid.createDiv("pdf-toolbar-spacer");
    this.pageInputEl = mid.createEl("input", { cls: "pdf-page-input" });
    this.pageInputEl.addEventListener("click", () => this.pageInputEl.select());
    this.pageInputEl.addEventListener("change", () => this.dispatch("pagenumberchanged", this.pageInputEl.value));
    this.pageNumberEl = mid.createSpan("pdf-page-numbers");
    this.toolbarRightEl = bar.createDiv("pdf-toolbar-right");
    this.refresh();
  };

  proto.setPageNumber = function (pageNumber, pageLabel) {
    this.pageNumber = pageNumber;
    this.pageLabel = pageLabel || "";
    this.refresh();
  };

  proto.setPagesCount = function (pagesCount, hasPageLabels) {
    this.pagesCount = pagesCount;
    this.hasPageLabels = !!hasPageLabels;
    this.refresh();
  };

  proto.setPageScale = function (pageScaleValue, pageScale) {
    this.pageScaleValue = pageScaleValue;
    this.pageScale = pageScale;
    this.refresh();
  };

  proto.reset = function () {
    const ns = ng05PdfViewerNs(host);
    this.pageNumber = 0;
    this.pageLabel = "";
    this.pagesCount = 0;
    this.hasPageLabels = false;
    this.pageScaleValue = ns ? ns.DEFAULT_SCALE_VALUE : "page-width";
    this.pageScale = ns ? ns.DEFAULT_SCALE : 1;
    this.pageInputEl && this.pageInputEl.classList.remove("mod-page-loading");
    this.refresh();
    this.dispatch("toolbarreset");
  };

  proto.refresh = function () {
    const input = this.pageInputEl;
    if (!input) return;
    const pdf = host.t.pdf;
    if (this.hasPageLabels) {
      input.type = "text";
      input.value = this.pageLabel;
      this.pageNumberEl.textContent = pdf.labelPageOfPages({ current: this.pageNumber, count: this.pagesCount });
    } else {
      input.type = "number";
      if (this.pagesCount) input.max = String(this.pagesCount);
      input.value = String(this.pageNumber || "");
      this.pageNumberEl.textContent = this.pageNumber
        ? pdf.labelPageOfPages({ current: this.pageNumber, count: this.pagesCount })
        : pdf.labelOfPages({ count: this.pagesCount });
    }
    const ns = ng05PdfViewerNs(host);
    if (this.zoomOutEl && ns) this.zoomOutEl.classList.toggle("mod-disabled", this.pageScale <= ns.MIN_SCALE);
    if (this.zoomInEl && ns) this.zoomInEl.classList.toggle("mod-disabled", this.pageScale >= ns.MAX_SCALE);
    if (this.prevPageEl) this.prevPageEl.classList.toggle("mod-disabled", this.pageNumber <= 1);
    if (this.nextPageEl) this.nextPageEl.classList.toggle("mod-disabled", this.pageNumber >= this.pagesCount);
  };

  proto.updateUIState = function () { this.refresh(); };

  proto.updateLoadingIndicatorState = function (loading) {
    if (this.pageInputEl) this.pageInputEl.classList.toggle("mod-page-loading", !!loading);
  };

  return PdfToolbar;
}
