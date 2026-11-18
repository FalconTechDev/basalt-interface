// Slice s31: the mobile bottom navigation bar (back/forward, quick switcher, new tab,
// tab count, ribbon menu). Bundle-scope names arrive lazily through env().
import { env } from "./env.js";

const s31MobileCache = new Map();

// X6: mobile navbar shown above the keyboard / auto-hidden on scroll.
function s31BuildMobileNavbar() {
  const E = env();
  function MobileNavbar(app) {
    const self = this;
    this.isVisible = false;
    this.scrollTops = new WeakMap();
    this.app = app;
    this.showRibbonMenu = this.showRibbonMenu.bind(this);
    this.onRibbonMenuClick = this.showRibbonMenu;
    this.containerEl = createDiv("mobile-navbar mod-raised", (el) => {
      el.createDiv("mobile-navbar-actions", (actions) => {
        actions.createDiv("mobile-navbar-action mobile-navbar-action-back", (action) => {
          self.backButtonEl = E.Gg(app, () => app.workspace.activeLeaf, "backward");
          E.tv(self.backButtonEl, "lucide-chevron-left");
          action.appendChild(self.backButtonEl);
        });
        actions.createDiv("mobile-navbar-action mobile-navbar-action-forward", (action) => {
          self.forwardButtonEl = E.Gg(app, () => app.workspace.activeLeaf, "forward");
          E.tv(self.forwardButtonEl, "lucide-chevron-right");
          action.appendChild(self.forwardButtonEl);
        });
        actions.createDiv("mobile-navbar-action mobile-navbar-action-quick-switcher", (action) => {
          action.createSpan("clickable-icon", (icon) => {
            E.tv(icon, "lucide-search");
          });
          action.addEventListener("click", () => {
            const plugin = app.internalPlugins.getPluginById("switcher");
            const instance = plugin && plugin.instance;
            if (instance) instance.onOpen();
          });
        });
        actions.createDiv("mobile-navbar-action mobile-navbar-action-new-tab", (action) => {
          action.createSpan("clickable-icon", (icon) => {
            E.tv(icon, "lucide-plus");
          });
          action.addEventListener("click", () => {
            if (!app.workspace.getActiveViewOfType(env().tD)) app.commands.executeCommandById("workspace:new-tab");
          });
        });
        actions.createDiv("mobile-navbar-action mobile-navbar-action-tabs", (action) => {
          action.createDiv("clickable-icon", (icon) => {
            E.tv(icon, "tab-frame");
            self.tabButtonEl = icon.createDiv("mobile-navbar-tabs-number");
          });
          action.addEventListener("click", (evt) => {
            evt.preventDefault();
            app.mobileTabSwitcher.show();
          });
          action.addEventListener("contextmenu", (evt) => app.mobileTabSwitcher.showTabManagementMenu(evt));
        });
        actions.createDiv("mobile-navbar-action mobile-navbar-action-menu has-longpress-menu", (action) => {
          self.ribbonMenuItemEl = action.createSpan("clickable-icon", (icon) => {
            icon.addEventListener("click", (evt) => self.onRibbonMenuClick(evt));
            icon.addEventListener("contextmenu", self.showRibbonMenu);
            E.tv(icon, "lucide-menu");
          });
          self.ribbonMenuFlairEl = action.createDiv("navbar-action-flair", (flair) => {
            E.tv(flair, "chevrons-up-down");
            flair.hide();
          });
        });
      });
    });
    const updateTabCount = () => {
      let count = 0;
      app.workspace.iterateRootLeaves(() => {
        count++;
      });
      self.tabButtonEl.setText(String(count));
    };
    app.workspace.onLayoutReady(() => {
      updateTabCount();
      self.updateRibbonMenuItem();
    });
    app.workspace.on("active-leaf-change", this.onLeafChange, this);
    app.workspace.on("layout-change", updateTabCount);
    app.vault.on("config-changed", (key) => {
      if (key !== "autoFullScreen" || app.vault.getConfig("autoFullScreen")) return;
      self.restoreNavigation();
    });
    window.addEventListener("keyboardWillHide", () => self.show());
    window.addEventListener("keyboardWillShow", () => self.hide());
    window.addEventListener("mousedown", () => self.restoreNavigation(true));
    this.show();
  }
  MobileNavbar.prototype.onScroll = function (view, scrollTop) {
    const E2 = env();
    const previous = this.scrollTops.get(view) ?? 0;
    this.scrollTops.set(view, scrollTop);
    if (E2.Yl.isPhone && !E2.Yl.mobileSoftKeyboardVisible && this.app.vault.getConfig("autoFullScreen")) {
      const delta = scrollTop - previous;
      if (scrollTop < 0.1 && previous < 0.1) return;
      if (Math.abs(delta) < 0.125) return;
      if (delta > 0) this.hideNavigation();
      else this.restoreNavigation();
    }
  };
  MobileNavbar.prototype.hideNavigation = function () {
    if (env().Yl.isPhone) {
      document.body.addClass("is-hidden-nav");
      env().Pm && env().Pm.hide();
    }
  };
  MobileNavbar.prototype.restoreNavigation = function (animated) {
    if (animated === undefined) animated = true;
    const self = this;
    if (!env().Yl.isPhone || !document.body.hasClass("is-hidden-nav")) return;
    document.body.removeClass("is-hidden-nav");
    if (env().Pm) env().Pm.show({ animation: animated ? env().D.Fade : env().D.None });
    if (!animated) {
      this.app.disableCssTransition();
      setTimeout(() => {
        self.app.enableCssTransition();
      }, 0);
    }
  };
  MobileNavbar.prototype.updateRibbonMenuItem = function () {
    const items = this.app.workspace.leftRibbon.items;
    const wanted = this.app.vault.getConfig("mobileQuickRibbonItem");
    let item;
    if (wanted) item = items.find((entry) => entry.id === wanted);
    this.ribbonMenuFlairEl.toggle(!!item);
    if (item) {
      this.onRibbonMenuClick = item.callback;
      env().tv(this.ribbonMenuItemEl, item.icon);
    } else {
      this.onRibbonMenuClick = this.showRibbonMenu;
      env().tv(this.ribbonMenuItemEl, "lucide-menu");
    }
  };
  MobileNavbar.prototype.showRibbonMenu = function (evt) {
    evt.preventDefault();
    const items = this.app.workspace.leftRibbon.items;
    const wanted = this.app.vault.getConfig("mobileQuickRibbonItem");
    const menu = new (env().Ug)();
    const addItem = (item) => {
      if (item.hidden) return;
      menu.addItem((entry) =>
        entry
          .setTitle(item.title)
          .setIcon(item.icon)
          .setChecked(!!(wanted && item.id === wanted))
          .onClick((clickEvt) => item.callback(clickEvt))
      );
    };
    for (const item of items) addItem(item);
    const rect = this.ribbonMenuItemEl.getBoundingClientRect();
    menu
      .setParentElement(this.ribbonMenuItemEl)
      .showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: true });
  };
  MobileNavbar.prototype.onLeafChange = function () {
    const leaf = this.app.workspace.activeLeaf;
    if (leaf) {
      const history = leaf.history;
      const back = history.backHistory;
      const forward = history.forwardHistory;
      this.backButtonEl.ariaDisabled = String(back.length === 0);
      this.forwardButtonEl.ariaDisabled = String(forward.length === 0);
      this.restoreNavigation();
    }
  };
  MobileNavbar.prototype.show = function () {
    if (this.isVisible || this.app.mobileToolbar.isVisible || env().Yl.mobileSoftKeyboardVisible) return;
    this.isVisible = true;
    this.app.dom.appContainerEl.appendChild(this.containerEl);
  };
  MobileNavbar.prototype.hide = function () {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.containerEl.detach();
  };
  return MobileNavbar;
}
export function s31MobileNavbar(host) {
  if (!s31MobileCache.has("X6")) s31MobileCache.set("X6", s31BuildMobileNavbar());
  return s31MobileCache.get("X6");
}
