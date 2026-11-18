// Modal: the dialog base class of the plugin API (title, content area, close button, backdrop, Escape, focus handling).
import { runTransition, cancelTransition } from "./animation.js";
import { inherit } from "./inherit.js";

/** Remembers what had focus / selection in `win` so that closing the dialog can give it back. */
function captureSelection(win) {
  win = win || window;
  const selection = win.getSelection();
  if (!selection) return null;
  let focusEl = win.document.activeElement;
  if (focusEl === win.document.body) focusEl = null;
  if (focusEl && focusEl.tagName === "IFRAME" && focusEl.contentDocument) focusEl = focusEl.contentDocument.activeElement;
  let range = null;
  if (focusEl && selection.rangeCount > 0) {
    const candidate = selection.getRangeAt(0);
    const container = candidate.commonAncestorContainer;
    // only a selection inside the focused element is worth restoring
    if (focusEl === container || focusEl.contains(container)) range = candidate;
  }
  return { win, range, focusEl };
}

function restoreSelection(saved, host) {
  if (!saved || !(saved.focusEl || saved.range)) return;
  const { win, focusEl, range } = saved;
  win.focus();
  // the CodeMirror editor restores its own selection when focused
  const isEditor = focusEl && focusEl.instanceOf(HTMLElement) && focusEl.hasClass("cm-content");
  if (range && !isEditor && host.nodeInWindow(win, range.startContainer) && host.nodeInWindow(win, range.endContainer)) {
    const selection = win.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  if (focusEl && (focusEl.instanceOf(HTMLElement) || focusEl.instanceOf(SVGElement)) && host.nodeInWindow(win, focusEl)) {
    focusEl.focus({ preventScroll: true });
  }
}

export function defineModal(host) {
  function Modal(app) {
    const self = this;
    this.shouldRestoreSelection = true;
    this.selection = null;
    this.win = null;
    this.shouldAnimate = true;
    this.dimBackground = true;
    this.bgOpacity = "0.85";
    this.app = app;
    this.scope = new host.Scope();
    this.scope.register([], "Escape", this.onEscapeKey.bind(this));
    this.onWindowClose = this.onWindowClose.bind(this);

    this.containerEl = createDiv("modal-container");
    const bg = (this.bgEl = this.containerEl.createDiv("modal-bg"));
    this.modalEl = this.containerEl.createDiv("modal");
    const closeButton = this.modalEl.createDiv("modal-close-button mod-raised clickable-icon");
    host.setIcon(closeButton, "x");
    this.headerEl = this.modalEl.createDiv("modal-header");
    this.titleEl = this.headerEl.createDiv("modal-title");
    this.contentEl = this.modalEl.createDiv("modal-content");
    this.scope.setTabFocusContainerEl(this.containerEl);
    closeButton.addEventListener("click", this.close.bind(this));

    if (host.Platform.isDesktopApp && host.Platform.isMacOS) {
      // macOS: a click only counts when the pointer did not travel (a window drag that ends over the backdrop must not close it)
      let downX = null;
      let downY = null;
      bg.addEventListener("click", (event) => {
        if (Math.hypot(event.screenX - downX, event.screenY - downY) < 5) self.close();
      });
      bg.addEventListener("mousedown", (event) => {
        downX = event.screenX;
        downY = event.screenY;
      });
    } else {
      bg.addEventListener("click", this.onClickOutside.bind(this));
    }

    if (host.Platform.isMobile) {
      // phones: drag the title down to dismiss
      host.onSwipe(this.titleEl, (gesture) => {
        if (gesture.points !== 1 || gesture.direction !== "y") return;
        const { modalEl, bgEl } = self;
        gesture.registerCallback({
          move(_event, y) {
            const height = modalEl.offsetHeight;
            const fraction = Math.clamp((y - gesture.startY) / height, 0, 1);
            modalEl.style.transform = `translateY(${fraction * height}px)`;
            self.bgEl.style.opacity = String(1 - fraction);
          },
          cancel() {
            modalEl.style.transform = "";
            bgEl.style.opacity = "";
          },
          finish(_event, y, velocity) {
            const height = modalEl.offsetHeight;
            const fraction = Math.clamp((y - gesture.startY) / height, 0, 1);
            if (velocity < height / 2) {
              // not dragged far / fast enough: spring back
              runTransition(modalEl, new host.Transition({ duration: 150 * fraction }).addProp("transform", null, "translateY(0)", ""));
              runTransition(bgEl, new host.Transition({ duration: 150 * fraction, fn: "linear" }).addProp("opacity", null, "1", ""));
            } else {
              const remaining = 1 - fraction;
              runTransition(modalEl, new host.Transition({ duration: 150 * remaining, fn: "ease-out" }).addProp("transform", null, `translateY(${height}px)`, ""), () => { self.close(); });
              runTransition(bgEl, new host.Transition({ duration: 150 * remaining, fn: "linear" }).addProp("opacity", null, "0"));
            }
          },
        });
      });
    }
  }

  /** Shows the dialog in the active window and makes its scope the one that receives keys. */
  Modal.prototype.open = function () {
    const { app, containerEl } = this;
    if (containerEl.parentNode) return; // already open
    const win = (this.win = activeWindow);
    this.selection = this.shouldRestoreSelection ? captureSelection(win) : null;
    host.blurAndClearSelection(win);
    app.keymap.pushScope(this.scope);
    win.document.body.appendChild(containerEl);
    if (host.Platform.isPhone) cancelTransition(this.modalEl);
    this.onOpen();
    const { modalEl, bgEl, dimBackground } = this;
    containerEl.toggleClass("mod-dim", dimBackground);
    if (host.Platform.isPhone) this.animateOpen();
    else bgEl.style.opacity = dimBackground ? this.bgOpacity : "0";
    host.closeAllMenus();
    host.registerOpenModal(this);
    if (host.Platform.hasPhysicalKeyboard) host.focusElement(modalEl, { preventScroll: true });
    if (win !== window) win.addEventListener("beforeunload", this.onWindowClose);
  };

  Modal.prototype.animateOpen = async function () {
    if (!this.shouldAnimate) return;
    const body = this.modalEl.doc.body;
    body.addClass("hide-cursor");
    await host.slideModalIn(this.modalEl, this.bgEl, this.bgOpacity);
    body.removeClass("hide-cursor");
  };

  Modal.prototype.animateClose = async function () {
    const body = this.modalEl.doc.body;
    body.addClass("hide-cursor");
    await host.slideModalOut(this.modalEl, this.bgEl);
    body.removeClass("hide-cursor");
  };

  Modal.prototype.close = function () {
    const { app, win, containerEl } = this;
    app.keymap.popScope(this.scope);
    const finish = () => {
      containerEl.detach();
      this.onClose();
      if (this.onCloseCallback) this.onCloseCallback.call(this);
    };
    if (host.Platform.isPhone) this.animateClose().then(finish);
    else finish();
    host.unregisterOpenModal(this);
    if (this.shouldRestoreSelection) restoreSelection(this.selection, host);
    if (win && win !== window) win.removeEventListener("beforeunload", this.onWindowClose);
    this.win = null;
  };

  Modal.prototype.onOpen = function () {};
  Modal.prototype.onClose = function () {};
  Modal.prototype.onWindowClose = function () { this.close(); };
  Modal.prototype.onClickOutside = function (event) { if (!event.defaultPrevented) this.close(); };
  Modal.prototype.onEscapeKey = function (event) { if (!event.defaultPrevented) this.close(); };

  Modal.prototype.setTitle = function (title) { this.titleEl.setText(title); return this; };
  /** `content`: text or a node. */
  Modal.prototype.setContent = function (content) {
    if (String.isString(content)) this.contentEl.setText(content);
    else this.contentEl.appendChild(content);
    return this;
  };
  Modal.prototype.setBackgroundOpacity = function (opacity) { this.bgOpacity = opacity; return this; };
  Modal.prototype.setCloseCallback = function (callback) { this.onCloseCallback = callback; return this; };
  Modal.prototype.setDimBackground = function (dim) { this.dimBackground = dim; return this; };

  return Modal;
}

/** DialogModal: Modal plus a button container row (addButton / addCheckbox / addCancelButton).
 *  Base of the confirm/prompt dialogs; `nb` in the original bundle. */
export function defineDialogModal(host) {
  function DialogModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.buttonContainerEl = null;
    self.containerEl.addClass("mod-confirmation");
    self.buttonContainerEl = self.modalEl.createDiv("modal-button-container");
    return self;
  }
  inherit(DialogModal, host.Modal);

  const proto = DialogModal.prototype;

  proto.addCheckbox = function (label, onToggle) {
    this.buttonContainerEl.createEl("label", { cls: "mod-checkbox" }, (el) => {
      el.createEl("input", { attr: { tabindex: -1 }, type: "checkbox" })
        .addEventListener("click", onToggle);
      el.appendText(label);
    });
    return this;
  };

  proto.addButton = function (cls, text, onClick) {
    const self = this;
    const classes = Array.isArray(cls) ? cls : [cls];
    const button = this.buttonContainerEl.createEl("button", { cls: classes.join(" "), text });
    button.addEventListener("click", (event) => {
      (async () => {
        try {
          button.addClass("mod-loading");
          const result = await onClick(event);
          if (!result) self.close();
        } finally {
          button.removeClass("mod-loading");
        }
      })();
    });
    return this;
  };

  proto.addCancelButton = function (onCancel) {
    return this.addButton("mod-cancel", host.t.dialogue.buttonCancel(), () => { if (onCancel) onCancel(); });
  };

  proto.onClose = function () { host.hideTooltip(); };

  return DialogModal;
}
