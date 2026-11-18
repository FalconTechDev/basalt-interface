// g12 clean-room: shared Bases toolbar widgets — toolbar button, anchored
// dropdown menu with backdrop, and the button+menu pair. Composition over
// the host DOM/Scope/Keymap primitives; no mirrored subclass tree.
import { env } from "./env.js";

const ng12Doc = () => env().activeDocument || document;
const ng12Win = (doc) => (doc && doc.defaultView) || window;

// Toolbar button row.
let ng12ToolbarButtonClass = null;
export function ng12BasesToolbarButton() {
  if (ng12ToolbarButtonClass) return ng12ToolbarButtonClass;

  class Ng12ToolbarButton {
    constructor(containerEl, text, icon, onClick) {
      this.containerEl = containerEl.createDiv("bases-toolbar-item");
      const buttonEl = (this.buttonEl = this.containerEl.createDiv({
        cls: "text-icon-button",
        attr: { tabindex: 0 },
      }));
      this.iconEl = buttonEl.createSpan("text-button-icon");
      env().tv(this.iconEl, icon);
      this.labelEl = buttonEl.createSpan("text-button-label");
      this.labelEl.setText(text);
      buttonEl.addEventListener("click", (event) => {
        event.preventDefault();
        onClick();
      });
      buttonEl.addEventListener("keydown", (event) => {
        if (event.isComposing || event.defaultPrevented) return;
        if (event.key !== " " && event.key !== "Enter") return;
        onClick();
      });
    }

    addContainerClass(cls) {
      this.containerEl.addClass(cls);
    }

    setText(text) {
      this.labelEl.setText(text);
    }

    setIcon(icon) {
      env().tv(this.iconEl, icon);
    }
  }

  ng12ToolbarButtonClass = Ng12ToolbarButton;
  return Ng12ToolbarButton;
}

// Anchored popup menu with backdrop.
let ng12BasesMenuClass = null;
export function ng12BasesMenu() {
  if (ng12BasesMenuClass) return ng12BasesMenuClass;

  class Ng12BasesMenu {
    constructor(app, parentEl, title) {
      this.enabled = true;
      this.app = app;
      this.parentEl = parentEl;
      this.handleOpen = null;
      this.handleClose = null;
      this._isOpen = false;
      this._autoDestroy = null;
      this._outsideCleanups = [];
      this._observer = null;
      this._resizeCount = 0;
      this._resizeWindowStart = 0;

      this.scope = new (env().Ng)(app.scope);
      this.scope.register([], "Escape", () => {
        this.setOpen(false);
        return false;
      });

      const bgEl = (this.bgEl = env().createDiv("suggestion-bg"));
      bgEl.style.opacity = "0";
      bgEl.addEventListener("mousedown", (event) => event.preventDefault());
      bgEl.addEventListener("click", () => this.setOpen(false));

      const menuEl = (this.menuEl = env().createDiv("menu bases-toolbar-menu"));
      this.mobileTitleEl = null;
      menuEl.createDiv("menu-grabber");
      const headerEl = menuEl.createDiv("modal-header");
      headerEl.createDiv({ cls: "modal-title", text: title });
      const closeEl = headerEl.createDiv("modal-close-button tappable mod-raised clickable-icon");
      env().tv(closeEl, "lucide-check");
      closeEl.addEventListener("click", () => this.setOpen(false));
      this.scrollEl = menuEl.createDiv("menu-scroll");

      if (env().Yl.isPhone) {
        env()._g(menuEl, this.scrollEl, bgEl, () => {
          menuEl.detach();
          this.setOpen(false);
        });
      }
    }

    get isOpen() {
      return this._isOpen;
    }

    isNodeOutside(node) {
      return !(
        (node && node.closest && node.closest(".suggestion-container")) ||
        (this.parentEl && this.parentEl.contains(node)) ||
        this.menuEl.contains(node)
      );
    }

    registerOnClickOutside() {
      this._cleanupOutside();
      const doc = ng12Doc();
      const win = ng12Win(doc);
      let pressOutside = false;
      const targetOf = (event) => event.targetNode || event.target;
      const onAux = (event) => {
        if (this.isNodeOutside(targetOf(event))) this.setOpen(false);
      };
      const onDown = (event) => {
        if (event.defaultPrevented) return;
        pressOutside = this.isNodeOutside(targetOf(event));
        if (pressOutside) this.setOpen(false);
      };
      const onClick = (event) => {
        if (pressOutside) return;
        win.setTimeout(() => {
          const active = doc.activeElement;
          if (active && active !== doc.body && this.isNodeOutside(active)) this.setOpen(false);
        }, 0);
      };
      win.addEventListener("auxclick", onAux, true);
      win.addEventListener("mousedown", onDown, true);
      win.addEventListener("click", onClick, true);
      this._outsideCleanups = [
        () => win.removeEventListener("auxclick", onAux, true),
        () => win.removeEventListener("mousedown", onDown, true),
        () => win.removeEventListener("click", onClick, true),
      ];
    }

    onOpen(cb) {
      this.handleOpen = cb;
      return this;
    }

    onClose(cb) {
      this.handleClose = cb;
      return this;
    }

    _cleanupOutside() {
      for (const cleanup of this._outsideCleanups) cleanup();
      this._outsideCleanups = [];
    }

    _cleanup() {
      this._cleanupOutside();
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
    }

    position() {
      env().Nv(this.parentEl.getBoundingClientRect(), this.menuEl, {
        preventOverlap: true,
        gap: 4,
      });
    }

    watchResize() {
      if (this._observer || typeof ResizeObserver === "undefined") return;
      this._resizeCount = 0;
      this._resizeWindowStart = Date.now();
      this._observer = new ResizeObserver(() => {
        const now = Date.now();
        if (now - this._resizeWindowStart > 100) {
          this._resizeWindowStart = now;
          this._resizeCount = 0;
        }
        this._resizeCount++;
        if (this._resizeCount > 10) return;
        this.position();
      });
      this._observer.observe(this.menuEl);
    }

    setAutoDestroy(el) {
      if (this._autoDestroy) this._autoDestroy();
      this._autoDestroy = el ? env().Rv(el, 500, () => this.setOpen(false)) : null;
    }

    setOpen(open) {
      if (this._isOpen === open || (open && !this.enabled)) return this;
      this._isOpen = open;
      const doc = ng12Doc();
      const keymap = (this.app && this.app.keymap) || env().Bg.init();
      if (open) {
        keymap.pushScope(this.scope);
        const win = ng12Win(doc);
        win.setTimeout(() => this.registerOnClickOutside(), 0);
        if (this.handleOpen) this.handleOpen();
        doc.body.appendChild(this.bgEl);
        doc.body.appendChild(this.menuEl);
        if (env().Yl.isPhone) {
          this.menuEl.style.transform = "";
          this.bgEl.style.opacity = "1";
        } else {
          this.position();
          this.watchResize();
        }
      } else {
        if (this._autoDestroy) {
          this._autoDestroy();
          this._autoDestroy = null;
        }
        if (this.handleClose) this.handleClose();
        this._cleanup();
        keymap.popScope(this.scope);
        if (env().Yl.isPhone) {
          if (this.menuEl.isConnected) {
            this.menuEl.detach();
            this.bgEl.detach();
          }
        } else {
          const hadFocus = this.menuEl.contains(doc.activeElement);
          this.bgEl.detach();
          this.menuEl.detach();
          if (hadFocus && this.parentEl && this.parentEl.focus) {
            this.parentEl.focus({ preventScroll: true });
          }
        }
      }
      return this;
    }

    toggle() {
      return this.setOpen(!this._isOpen);
    }
  }

  ng12BasesMenuClass = Ng12BasesMenu;
  return Ng12BasesMenu;
}

// Button + dropdown menu pair.
let ng12BasesDropdownClass = null;
export function ng12BasesDropdown() {
  if (ng12BasesDropdownClass) return ng12BasesDropdownClass;
  const Button = ng12BasesToolbarButton();
  const Menu = ng12BasesMenu();

  class Ng12BasesDropdown {
    constructor(app, parentEl, text, icon) {
      this.enabled = true;
      this.scope = new (env().Ng)(app.scope);
      this.scope.register([], "Escape", () => {
        this.setOpen(false);
        return false;
      });
      this.button = new Button(parentEl, text, icon, () => this.toggle());
      this.menu = new Menu(app, this.button.buttonEl, icon);
    }

    get scrollEl() {
      return this.menu.scrollEl;
    }

    addClass(cls) {
      this.button.addContainerClass(cls);
      this.menu.menuEl.addClass(cls);
    }

    onOpen(cb) {
      this.menu.handleOpen = cb;
      return this;
    }

    onClose(cb) {
      this.menu.handleClose = cb;
      return this;
    }

    setEnabled(enabled) {
      this.enabled = enabled;
      this.button.buttonEl.toggleClass("is-disabled", !enabled);
      if (!enabled) this.menu.setOpen(false);
      return this;
    }

    setOpen(open) {
      if (open && !this.enabled) return this;
      if (open) this.menu.setAutoDestroy(this.button.buttonEl);
      this.menu.setOpen(open);
      return this;
    }

    toggle() {
      return this.setOpen(!this.menu.isOpen);
    }
  }

  ng12BasesDropdownClass = Ng12BasesDropdown;
  return Ng12BasesDropdown;
}
