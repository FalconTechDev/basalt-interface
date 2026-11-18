// Menu, MenuItem and MenuSeparator: context menus and drop-down menus (native Electron menus when enabled, otherwise DOM menus with
// keyboard navigation and nested submenus). Items are grouped by "section" names; "a.b" sections can be folded into a submenu.
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { floatOr } from "./text.js";
import { runTransition } from "./animation.js";

/** The innermost menu that is currently open (the one that receives Escape / arrow keys), or null. */
let activeMenu = null;
/** mouse event -> the Menu created for it by Menu.forEvent (so several callers of one event share a menu) */
const menusByEvent = new WeakMap();

/** Closes the open menu together with all its parent menus. */
export function closeAllMenus() {
  while (activeMenu) {
    const parent = activeMenu.parentMenu;
    activeMenu.close();
    activeMenu = parent;
  }
}

export function defineMenuItem(host) {
  function MenuItem(menu) {
    this.submenu = null;
    this.disabled = false;
    this.checked = null;
    this.section = "";
    this.menu = menu;
    const dom = (this.dom = createDiv("menu-item tappable"));
    this.iconEl = dom.createDiv("menu-item-icon");
    this.titleEl = dom.createDiv("menu-item-title");
    dom.addEventListener("click", this.handleEvent.bind(this));
  }
  const proto = MenuItem.prototype;

  /** `title`: text or a node. */
  proto.setTitle = function (title) {
    if (typeof title === "string") {
      this.titleEl.setText(title);
    } else {
      this.titleEl.empty();
      this.titleEl.appendChild(title);
    }
    return this;
  };
  proto.setIcon = function (icon) {
    if (icon) host.setIcon(this.iconEl, icon);
    else this.iconEl.empty();
    return this;
  };
  proto.removeIcon = function () { this.iconEl.detach(); return this; };
  proto.setActive = function (active) { return this.setChecked(active); };
  proto.setChecked = function (checked) {
    if (checked) {
      if (!this.checkIconEl) {
        this.checkIconEl = this.dom.createDiv("menu-item-icon mod-checked");
        host.setIcon(this.checkIconEl, "lucide-check");
      }
    } else if (this.checkIconEl) {
      this.checkIconEl.detach();
    }
    this.checked = checked;
    this.dom.toggleClass("mod-checked", checked);
    return this;
  };
  proto.setDisabled = function (disabled) {
    this.disabled = disabled;
    this.dom.toggleClass("is-disabled", disabled);
    return this;
  };
  proto.setWarning = function (warning) { this.dom.toggleClass("is-warning", warning); return this; };
  /** A label is a non-clickable row (a heading inside the menu). */
  proto.setIsLabel = function (isLabel) {
    this.dom.toggleClass("tappable", !isLabel);
    this.dom.toggleClass("is-label", isLabel);
    return this;
  };
  /** Turns the item into a submenu parent and returns the (created once) submenu. */
  proto.setSubmenu = function () {
    if (!this.submenu) {
      this.dom.addClass("has-submenu");
      this.submenu = new host.Menu();
      host.setIcon(this.dom.createDiv("menu-item-icon mod-submenu"), "lucide-chevron-right");
    }
    return this.submenu;
  };
  proto.onClick = function (callback) { this.callback = callback; return this; };

  proto.handleEvent = function (event) {
    if (this.disabled) {
      event.preventDefault();
      return;
    }
    const { dom, menu, submenu } = this;
    if (submenu) {
      event.preventDefault();
      if (host.Platform.isPhone) this.slideIntoSubmenu();
      else menu.selectElement(dom, true);
      return;
    }
    const callback = this.callback;
    if (callback) callback(event);
    this.menu.hide();
  };

  /** Phones: the submenu replaces the menu's content, with a "back" row on top. */
  proto.slideIntoSubmenu = function () {
    const { menu, submenu } = this;
    const back = MenuItem.create(submenu);
    back
      .setSection("title")
      .setTitle(this.titleEl.getText())
      .setIcon("lucide-chevron-left")
      .setIsLabel(true)
      .onClick((event) => {
        event.preventDefault();
        activeMenu = menu;
        menu.unselect();
        host.slideBetween(submenu.scrollEl, menu.scrollEl, "left");
        host.restoreScrollPositions(menu.scrollEl);
        submenu.items.remove(back);
      });
    host.saveScrollPositions(menu.scrollEl);
    submenu.items.unshift(back);
    submenu.sort();
    activeMenu = submenu;
    submenu.scrollEl.style.minHeight = menu.scrollEl.getBoundingClientRect().height + "px";
    host.slideBetween(menu.scrollEl, submenu.scrollEl, "right");
  };

  proto.setSection = function (section) {
    this.section = section;
    this.dom.setAttr("data-section", section);
    return this;
  };

  MenuItem.create = function (menu) { return new MenuItem(menu); };
  return MenuItem;
}

export function defineMenuSeparator() {
  function MenuSeparator(menu) {
    this.menu = menu;
    this.dom = createDiv("menu-separator");
  }
  return MenuSeparator;
}

export function defineMenu(host) {
  function Menu() {
    const self = host.Component.call(this) || this;
    self.unloading = false;
    self.useNativeMenu = Menu.useNativeMenu;
    self.showMacWritingTools = false;
    self.items = [];
    self.sections = [];
    self.submenuConfigs = {};
    self.selected = -1;
    // hovering an item with a submenu opens it after 250 ms of rest
    self.openSubmenuSoon = debounceCall(self.openSubmenu.bind(self), 250, true);
    self.scope = new host.Scope(host.Keymap.global.getRootScope());

    const dom = (self.dom = createDiv("menu"));
    dom.createDiv("menu-grabber");
    const scrollEl = (self.scrollEl = dom.createDiv("menu-scroll"));
    const bgEl = (self.bgEl = createDiv("suggestion-bg"));
    bgEl.style.opacity = "0";
    bgEl.addEventListener("mousedown", (event) => event.preventDefault());
    // keep focus where it is when the menu is clicked
    dom.addEventListener("mousedown", (event) => { if (event.button === 0) event.preventDefault(); });
    if (host.Platform.isPhone) {
      host.swipeToDismiss(dom, scrollEl, bgEl, () => {
        self.dom.detach();
        self.hide();
      });
    }
    bgEl.onClickEvent(() => self.hide());
    self.scope.register([], "ArrowUp", self.onArrowUp.bind(self));
    self.scope.register([], "ArrowDown", self.onArrowDown.bind(self));
    self.scope.register([], "ArrowLeft", self.onArrowLeft.bind(self));
    self.scope.register([], "ArrowRight", self.onArrowRight.bind(self));
    self.scope.register([], "Enter", self.onEnter.bind(self));
    self.scope.register([], "Escape", self.hide.bind(self));
    dom.addEventListener("mouseover", self.onMouseOver.bind(self));
    return self;
  }
  inherit(Menu, host.Component);
  const proto = Menu.prototype;

  proto.onload = function () {
    const win = this.parentEl && this.parentEl.win ? this.parentEl.win : activeWindow;
    this.registerDomEvent(win, "mousedown", (event) => {
      if (!(this.parentEl && this.parentEl.contains(event.targetNode))) this.handleClickOutside(event);
    });
    this.registerDomEvent(win, "click", this.handleClickOutside.bind(this));
    if (host.Platform.isDesktop) this.registerDomEvent(win, "contextmenu", this.hide.bind(this));
    host.Keymap.global.pushScope(this.scope);
  };

  proto.onunload = function () {
    host.Keymap.global.popScope(this.scope);
  };

  proto.handleClickOutside = function (event) {
    if (!this._loaded) return;
    const target = event.targetNode;
    if (target && !this.isInside(target)) this.hide();
  };

  /** Is `node` inside this menu, one of its parent menus or one of its open submenus? */
  proto.isInside = function (node) {
    if (this.dom.contains(node)) return true;
    for (let menu = this.parentMenu; menu; menu = menu.parentMenu) if (menu.dom.contains(node)) return true;
    for (let menu = this.currentSubmenu; menu; menu = menu.currentSubmenu) if (menu.dom.contains(node)) return true;
    return false;
  };

  /**
   * Arranges the items: grouped by section in the order of `sections` (unknown sections are appended, items without a section go
   * last unless "" is a section), a separator between sections whose first name part differs, and sections covered by a submenu
   * config folded into a submenu item.
   */
  proto.sort = function () {
    const { sections, submenuConfigs } = this;
    const bySection = { "": [] };
    for (const item of this.items) {
      const section = item instanceof host.MenuItem ? item.section : "";
      if (section !== "" && !sections.contains(section)) sections.push(section);
      if (!bySection.hasOwnProperty(section)) bySection[section] = [];
      bySection[section].push(item);
    }

    const result = [];
    let lastSection = null;
    let submenu = null;     // the submenu currently being filled
    let submenuKey = "";
    for (const section of sections) {
      if (!bySection.hasOwnProperty(section)) continue;
      let key = "";
      for (const candidate in submenuConfigs) {
        if (submenuConfigs.hasOwnProperty(candidate) && (section === candidate || section.substring(0, candidate.length + 1) === candidate + ".")) {
          key = candidate;
          break;
        }
      }
      const parts = section.split(".");
      const head = parts[0];
      const rest = parts.slice(1).join(".");

      if (key) {
        if (submenu && key === submenuKey) {
          submenu.items.push(new host.MenuSeparator(this));
        } else {
          if (lastSection && lastSection.split(".")[0] !== head) {
            result.push(new host.MenuSeparator(this));
            lastSection = section;
          }
          const config = submenuConfigs[key];
          const parent = host.MenuItem.create(this);
          result.push(parent);
          parent.setTitle(config.title);
          if (config.icon) parent.setIcon(config.icon);
          if (config.disabled) parent.setDisabled(true);
          submenu = parent.setSubmenu();
          submenuKey = key;
        }
        for (const item of bySection[section]) {
          if (item instanceof host.MenuItem) item.setSection(rest);
          submenu.items.push(item);
        }
      } else {
        if (lastSection !== head) {
          if (lastSection !== null) result.push(new host.MenuSeparator(this));
          lastSection = section;
        }
        for (const item of bySection[section]) result.push(item);
      }
    }
    if (!sections.contains("")) for (const item of bySection[""]) result.push(item);
    while (result.last() instanceof host.MenuSeparator) result.pop();

    this.items = result;
    this.scrollEl.empty();
    let group = null;
    for (const item of this.items) {
      if (item instanceof host.MenuItem) {
        if (!group) group = this.scrollEl.createDiv("menu-group");
        group.appendChild(item.dom);
      } else if (item instanceof host.MenuSeparator) {
        group = null;
        this.scrollEl.appendChild(item.dom);
      }
    }
  };

  /** Declares section names (in order) before the "" section. */
  proto.addSections = function (names) {
    const sections = this.sections;
    names = names.filter((name) => !sections.contains(name));
    let at = sections.indexOf("");
    if (at === -1) at = sections.length;
    sections.splice(at, 0, ...names);
    return this;
  };

  /** Sections named `name` (and `name.*`) are shown as one submenu item described by `config` { title, icon, disabled }. */
  proto.setSectionSubmenu = function (name, config) { this.submenuConfigs[name] = config; return this; };
  proto.setNoIcon = function () { this.dom.addClass("mod-no-icon"); return this; };
  proto.setUseNativeMenu = function (native) { this.useNativeMenu = native; return this; };
  proto.setShowMacWritingTools = function (show) { this.showMacWritingTools = show; return this; };

  /** Adds an item configured by `configure(item)`; ignored once the menu is showing. */
  proto.addItem = function (configure) {
    if (this._loaded) return this;
    const item = host.MenuItem.create(this);
    this.items.push(item);
    configure(item);
    return this;
  };

  proto.addSeparator = function () {
    if (this._loaded) return this;
    this.items.push(new host.MenuSeparator(this));
    return this;
  };

  /** The element the menu belongs to: it gets `has-active-menu` while the menu shows, and clicks on it do not count as "outside". */
  proto.setParentElement = function (el) {
    if (this.parentEl) this.parentEl.removeClass("has-active-menu");
    this.parentEl = el;
    return this;
  };

  proto.showAtMouseEvent = function (event) {
    return this.showAtPosition({ x: event.clientX, y: event.clientY }, event.doc);
  };

  /**
   * Shows the menu at `position` { x, y, width?, overlap?, left? } (client coordinates of `doc`). With `width` the menu is placed
   * beside (or, with `overlap`, over) that span - used for submenus and drop-downs.
   */
  proto.showAtPosition = function (position, doc) {
    this.unload();
    if (this.items.length === 0) return this;
    doc = doc || activeDocument;
    let body = doc.body;
    let x = position.x;
    let y = position.y;
    // inside an iframe (embedded content): translate into the top window
    const frame = host.frameOffset(body.win);
    if (frame) {
      x = x * frame.scale + frame.x;
      y = y * frame.scale + frame.y;
      doc = frame.win.document;
      body = doc.body;
    }
    if (this.parentEl) {
      this.parentEl.addClass("has-active-menu");
      host.watchElementGone(this.parentEl, 500, () => this.hide());
    }
    this.sort();
    host.hideTooltip();

    if (!host.Platform.isDesktop || !this.useNativeMenu) {
      host.registerOpenModal(this);
      setTimeout(this.load.bind(this), 0);
      const dom = this.dom;
      const bgEl = this.bgEl;
      body.appendChild(dom);
      body.appendChild(bgEl);
      if (host.Platform.isPhone) {
        if (host.Platform.isMobileApp && host.keyboard) host.keyboard.hide();
        const height = dom.offsetHeight - 1;
        runTransition(dom, new host.Transition({ duration: 150, fn: "var(--anim-motion-swing)" }).addProp("transform", `translateY(${height}px)`, ""));
        runTransition(bgEl, new host.Transition({ duration: 150 }).addProp("opacity", "0", "0.85"));
        dom.style.left = "";
        dom.style.top = "";
      } else {
        const width = dom.offsetWidth;
        const height = dom.offsetHeight;
        const viewWidth = body.clientWidth;
        const viewHeight = body.clientHeight;
        const bodyStyle = getComputedStyle(body);
        const topInset = floatOr(bodyStyle.paddingTop, 0) + floatOr(bodyStyle.getPropertyValue("--safe-area-inset-top"), 0);
        // `rightEdge` is where the menu's left side goes when it opens to the right, `leftEdge` where its right side goes when flipped
        let rightEdge;
        let leftEdge;
        if (position.width) {
          if (position.overlap) { rightEdge = x; leftEdge = x + position.width; }
          else { rightEdge = x + position.width; leftEdge = x; }
        } else {
          rightEdge = x + 2;
          leftEdge = x - 2;
        }
        const style = dom.style;
        const fitsLeft = leftEdge - width >= 0;
        if (!(rightEdge + width <= viewWidth) || (position.left && fitsLeft)) style.left = Math.max(0, leftEdge - width) + "px";
        else style.left = rightEdge + "px";
        if (y + height > viewHeight) y = Math.max(topInset, y - height);
        style.top = y + 2 + "px";
        host.scrollWithPointer(this.scrollEl);
        bgEl.style.opacity = "0.85";
      }
      activeMenu = this;
      return this;
    }

    // native menu
    const win = doc.win;
    const toTemplate = (items) => {
      const template = [];
      for (const item of items) {
        if (item instanceof host.MenuItem) {
          const entry = {
            label: item.titleEl.getText().replace(/\B&\B/, "&&"),
            enabled: !item.disabled && !item.dom.hasClass("is-label"),
            checked: item.checked,
            type: isBoolean(item.checked) ? "checkbox" : undefined,
            click: (_item, _window, event) => item.handleEvent(new MouseEvent("click", event)),
          };
          if (item.submenu) {
            item.submenu.sort();
            entry.submenu = toTemplate(item.submenu.items);
          }
          template.push(entry);
        } else if (item instanceof host.MenuSeparator) {
          template.push({ type: "separator" });
        }
      }
      return template;
    };
    const native = win.electron.remote.Menu.buildFromTemplate(toTemplate(this.items));
    native.on("menu-will-close", () => this.hide());
    const contents = win.electron.remote.getCurrentWebContents();
    const zoom = Math.pow(1.2, contents.getZoomLevel());
    native.popup({
      x: Math.round(x * zoom),
      y: Math.round(y * zoom),
      window: win.electron.remote.getCurrentWindow(),
      frame: this.showMacWritingTools ? contents.focusedFrame : undefined,
    });
    return undefined;
  };

  proto.hide = function () {
    this.unload();
    if (this.unloading) return this;
    this.unloading = true;
    host.unregisterOpenModal(this);
    this.unselect();
    this.closeSubmenu();
    if (this.parentMenu && this.parentMenu.currentSubmenu === this) {
      if (activeMenu === this) activeMenu = this.parentMenu;
      this.parentMenu.currentSubmenu = null;
    } else {
      activeMenu = null;
    }
    this.parentMenu = null;
    if (this.parentEl) {
      this.parentEl.removeClass("has-active-menu");
      this.parentEl = null;
    }
    const { dom, bgEl, hideCallback } = this;
    this.hideCallback = null;
    if (host.Platform.isPhone && dom.isShown()) {
      const height = dom.offsetHeight - 1;
      runTransition(dom, new host.Transition({ duration: 150 }).addProp("transform", "", `translateY(${height}px)`), () => {
        dom.detach();
        if (hideCallback) hideCallback();
        this.unloading = false;
      });
      runTransition(bgEl, new host.Transition({ duration: 150 }).addProp("opacity", null, "0"), () => { bgEl.detach(); });
    } else {
      dom.detach();
      bgEl.detach();
      if (hideCallback) hideCallback();
      this.unloading = false;
    }
    return this;
  };

  proto.close = function () { this.hide(); };
  proto.onHide = function (callback) { this.hideCallback = callback; };

  proto.onArrowUp = function (event) {
    event.preventDefault();
    const items = this.items;
    let index = this.selected - 1;
    for (let tried = 0; tried < items.length; tried++) {
      const item = items[index];
      if (item && item instanceof host.MenuItem && !item.disabled) {
        this.select(index);
        return false;
      }
      if (--index < 0) index = items.length - 1;
    }
    return false;
  };

  proto.onArrowDown = function (event) {
    event.preventDefault();
    const items = this.items;
    let index = this.selected + 1;
    for (let tried = 0; tried < items.length; tried++) {
      const item = items[index];
      if (item && item instanceof host.MenuItem && !item.disabled) {
        this.select(index);
        return false;
      }
      if (++index >= items.length) index = 0;
    }
    return false;
  };

  proto.onArrowLeft = function (event) {
    event.preventDefault();
    if (this.parentMenu) this.hide();
    return false;
  };

  proto.onArrowRight = function (event) {
    event.preventDefault();
    const item = this.items[this.selected];
    if (item instanceof host.MenuItem && item.submenu) {
      this.openSubmenu(item);
      if (this.currentSubmenu) this.currentSubmenu.select(0);
    }
    return false;
  };

  proto.onEnter = function (event) {
    const item = this.items[this.selected];
    if (item && item instanceof host.MenuItem) {
      item.handleEvent(event);
      this.hide();
    }
    return false;
  };

  /** Highlights the item that contains `el` (keeping the parent menu's matching item highlighted); opens its submenu now or soon. */
  proto.selectElement = function (el, openNow = false) {
    const parent = this.parentMenu;
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.dom.contains(el)) continue;
      if (parent) {
        for (let j = 0; j < parent.items.length; j++) {
          const sibling = parent.items[j];
          if (sibling instanceof host.MenuItem && sibling.submenu === this) {
            if (parent.selected !== j) {
              parent.openSubmenuSoon.cancel();
              parent.select(j);
            }
            break;
          }
        }
      }
      if (item instanceof host.MenuItem) {
        this.select(i);
        if (openNow) this.openSubmenu(item);
        else this.openSubmenuSoon(item);
      }
      return;
    }
  };

  proto.onMouseOver = function (event) {
    if (!host.isTouchSyntheticMouse(event)) this.selectElement(event.targetNode, false);
  };

  proto.unselect = function () {
    const item = this.items[this.selected];
    if (item) item.dom.removeClass("selected");
    this.selected = null;
    this.closeSubmenu();
  };

  proto.select = function (index) {
    const items = this.items;
    if (items.length === 0) return;
    if (index < 0) index = items.length - 1;
    if (index >= items.length) index = 0;
    const previous = items[this.selected];
    if (previous) previous.dom.removeClass("selected");
    this.selected = index;
    const item = items[index];
    item.dom.addClass("selected");
    item.dom.scrollIntoView({ block: "nearest" });
  };

  /** Opens the submenu of `item` next to it (closing a different open one first). */
  proto.openSubmenu = function (item) {
    this.openSubmenuSoon.cancel();
    const submenu = item.submenu;
    const itemEl = item.dom;
    const open = this.currentSubmenu;
    const parent = this.parentMenu;
    if (item.disabled) return;
    if (open) {
      if (open === submenu || (parent && parent.selected !== this.parentMenu.items.indexOf(item))) return;
      this.closeSubmenu();
    }
    if (!submenu) return;
    submenu.parentMenu = this;
    this.currentSubmenu = submenu;
    const style = getComputedStyle(this.dom);
    const top = parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
    const left = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) + 2;
    const right = parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth) + 2;
    const rect = itemEl.getBoundingClientRect();
    submenu.showAtPosition({ x: rect.x - left, y: rect.y - top, width: rect.width + left + right }, itemEl.doc);
  };

  proto.closeSubmenu = function () {
    this.openSubmenuSoon.cancel();
    const submenu = this.currentSubmenu;
    if (submenu) {
      submenu.hide();
      submenu.parentMenu = null;
      this.currentSubmenu = null;
    }
  };

  /** The menu for a mouse event (one per event, shown on the next tick); also cancels the browser's own context menu. */
  Menu.forEvent = function (event) {
    event.preventDefault();
    let menu = menusByEvent.get(event);
    if (!menu) {
      menu = new Menu();
      menusByEvent.set(event, menu);
      event.win.setTimeout(() => menu.showAtMouseEvent(event));
    }
    return menu;
  };
  Menu.useNativeMenu = false;

  return Menu;
}
