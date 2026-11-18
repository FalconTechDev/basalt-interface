// View (what a leaf shows) and ItemView (a view with the standard header: back / forward, title, action buttons, more-options menu).
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";

export function defineView(host) {
  /**
   * Base of all views. Owns `containerEl` (a child of the leaf's element), is loaded when the leaf shows it and unloaded when it
   * leaves. State has two parts: `getState` / `setState` (persisted in the layout) and the ephemeral state (scroll position, focus ...).
   */
  function View(leaf) {
    const self = host.Component.call(this) || this;
    self.icon = "lucide-file";
    self.navigation = false; // true when the view takes part in back / forward history
    self.app = leaf.app;
    self.leaf = leaf;
    self.containerEl = leaf.containerEl.createDiv("workspace-leaf-content");
    self.containerEl.setAttribute("data-type", self.getViewType());
    return self;
  }
  inherit(View, host.Component);
  const proto = View.prototype;

  proto.open = async function (parentEl) {
    parentEl.appendChild(this.containerEl);
    this.load();
    await this.onOpen();
  };

  proto.close = async function () {
    this.containerEl.detach();
    this.unload();
    await this.onClose();
  };

  proto.onOpen = async function () {};
  proto.onClose = async function () {};
  proto.getState = function () { return {}; };
  proto.setState = async function () {};
  proto.getEphemeralState = function () { return {}; };
  proto.setEphemeralState = function () {};
  proto.getIcon = function () { return this.icon ? this.icon : "lucide-file"; };
  proto.onResize = function () {};
  proto.onPaneMenu = function () {};
  proto.onHeaderMenu = function () {};

  /** The close entries of the tab context menu (close, close others, close to the right, close all). */
  proto.onTabMenu = function (menu) {
    const leaf = this.leaf;
    const tabs = leaf.parent;
    const index = tabs.children.indexOf(leaf);
    const closeEntry = (title, leaves) => menu.addItem((item) => item
      .setSection("close")
      .setTitle(title)
      .setIcon("lucide-x")
      .onClick(() => { for (const other of leaves) other.detach(); }));

    menu.addItem((item) => item
      .setSection("close")
      .setTitle(host.t.interface.menu.close())
      .setIcon("lucide-x")
      .onClick(() => this.leaf.detach()));

    const siblings = tabs.children.slice();
    if (this.app.workspace.isInSidebar(leaf)) return;
    const others = siblings.filter((other) => !other.pinned && other !== leaf);
    if (others.length > 0) closeEntry(host.t.interface.menu.closeOthers(), others);
    const after = siblings.slice(index + 1).filter((other) => !other.pinned);
    if (after.length > 0) closeEntry(host.t.interface.menu.closeAfter(), after);
    const all = siblings.filter((other) => !other.pinned);
    if (all.length > 0 && (all.length !== 1 || all[0] !== leaf)) closeEntry(host.t.interface.menu.closeAll(), all);
  };

  /** Where a tooltip of a control in a side dock opens (away from the dock), undefined elsewhere. */
  proto.getSideTooltipPlacement = function () {
    const root = this.leaf.getRoot();
    if (root.side === "left") return "right";
    if (root.side === "right") return "left";
    return undefined;
  };

  proto.handleCut = function () {};
  proto.handleCopy = function () {};
  proto.handlePaste = function () {};

  return View;
}

export function defineItemView(host) {
  function ItemView(leaf) {
    const self = host.View.call(this, leaf) || this;
    self.canDropAnywhere = false; // false: files are only accepted on the header (or with a modifier key)
    self.leftSidebarToggleEl = null;
    const app = self.app;
    const workspace = app.workspace;
    const header = (self.headerEl = self.containerEl.createDiv("view-header"));
    self.contentEl = self.containerEl.createDiv("view-content");

    header.createDiv("view-header-left", (left) => {
      if (host.Platform.isMobile) {
        self.leftSidebarToggleEl = left.createEl(
          "button",
          "view-action clickable-icon mod-left-split-toggle mod-raised sidebar-toggle-button mod-left",
          (button) => {
            host.setTooltip(button, host.t.interface.sidebarExpand());
            host.setIcon(button, "sidebar-toggle-button-icon");
            button.addEventListener("click", () => {
              navigator.vibrate(100);
              self.app.workspace.leftSplit.toggle();
            });
          },
        );
      }
      left.createDiv("view-header-nav-buttons", (nav) => {
        self.backButtonEl = host.createNavButton(app, () => self.leaf, "backward");
        host.setIcon(self.backButtonEl, "lucide-arrow-left");
        nav.appendChild(self.backButtonEl);
        self.forwardButtonEl = host.createNavButton(app, () => self.leaf, "forward");
        host.setIcon(self.forwardButtonEl, "lucide-arrow-right");
        nav.appendChild(self.forwardButtonEl);
      });
      self.updateNavButtons();
    });

    self.titleContainerEl = header.createDiv("view-header-title-container mod-at-start", (container) => {
      self.titleParentEl = container.createDiv({ cls: "view-header-title-parent" });
      self.titleEl = container.createDiv({ cls: "view-header-title" });
    });
    // a long title fades out at the edge it overflows; the classes follow the scroll position
    const fadeEl = self.titleContainerEl;
    const scrollEl = self.titleEl;
    fadeEl.addClass("mod-fade");
    const updateFade = () => {
      const left = scrollEl.scrollLeft;
      fadeEl.toggleClass("mod-at-start", left === 0);
      fadeEl.toggleClass("mod-at-end", Math.ceil(left) >= scrollEl.scrollWidth - scrollEl.offsetWidth);
    };
    scrollEl.addEventListener("scroll", debounceCall(updateFade, 10));
    updateFade();

    self.actionsEl = header.createDiv("view-actions");
    if (host.Platform.isPhone) self.actionsEl.addClass("mod-raised");
    const openMoreOptions = (event) => {
      if (!event.currentTarget.hasClass("has-active-menu")) self.onMoreOptions(event);
    };
    self.moreOptionsButtonEl = self.addAction("lucide-more-vertical", host.t.interface.menu.moreOptions(), openMoreOptions);
    if (host.Platform.isMobile) {
      self.moreOptionsButtonEl.addEventListener("contextmenu", (event) => {
        if (host.Platform.isPhone) {
          event.preventDefault();
          workspace.rightSplit.expand();
        }
      });
    }
    app.dragManager.handleDrop(self.containerEl, self.handleDrop.bind(self));
    return self;
  }
  inherit(ItemView, host.View);
  const proto = ItemView.prototype;

  /** Back / forward buttons are dimmed (aria-disabled) when there is nothing to go to. */
  proto.updateNavButtons = function () {
    const { backHistory, forwardHistory } = this.leaf.history;
    this.backButtonEl.ariaDisabled = String(backHistory.length === 0);
    this.forwardButtonEl.ariaDisabled = String(forwardHistory.length === 0);
  };

  proto.load = function () {
    host.View.prototype.load.call(this);
    const leaf = this.leaf;
    this.titleEl.setText(this.getDisplayText());
    this.registerEvent(leaf.on("group-change", this.onGroupChange, this));
    this.registerEvent(leaf.on("history-change", this.updateNavButtons, this));
  };

  /** Drops on the view: accepted on the header, anywhere when `canDropAnywhere`, or with Shift (Alt on non-mac) held. */
  proto.handleDrop = function (event, data, isPreview) {
    if (this.canDropAnywhere || (host.isMacLike ? event.shiftKey : event.altKey) || this.headerEl.contains(event.target)) {
      const hint = this.leaf.handleDrop(event, data, isPreview);
      if (hint) {
        hint.hoverEl = this.headerEl;
        hint.hoverClass = "is-highlighted";
        return hint;
      }
    }
    return undefined;
  };

  proto.onGroupChange = function () {};

  /** Adds an icon button to the header (left of the others); returns the button. Clicks with the left / middle mouse button only. */
  proto.addAction = function (icon, title, callback) {
    const button = createEl("button", "clickable-icon view-action");
    this.actionsEl.prepend(button);
    host.setIcon(button, icon);
    host.setTooltip(button, title);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.onClickEvent((event) => {
      if (event.button === 0 || event.button === 1) return callback(event);
      return undefined;
    });
    return button;
  };

  proto.onMoreOptions = function (event) {
    event.preventDefault();
    const menu = new host.Menu().addSections(["close", "pane", "open", "action", "find", "info", "info.copy", "view", "view.linked", "system", "", "danger"]);
    menu.setSectionSubmenu("info.copy", { title: host.t.interface.menu.copyPath(), icon: "lucide-clipboard" });
    menu.setSectionSubmenu("view.linked", { title: host.t.interface.menu.openLinkedView(), icon: "lucide-link" });
    this.onPaneMenu(menu, "more-options");
    this.onMoreOptionsMenu(menu);
    this.app.workspace.trigger("leaf-menu", menu, this.leaf);
    const button = event.target;
    const rect = button.getBoundingClientRect();
    menu.setParentElement(button).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: true });
  };

  proto.onPaneMenu = function (menu, source) {
    host.View.prototype.onPaneMenu.call(this, menu, source);
    const app = this.app;
    const leaf = this.leaf;
    if (host.Platform.isPhone && source === "more-options") {
      menu.addItem((item) => item.setSection("close").setTitle(host.t.interface.menu.close()).setIcon("lucide-x").onClick(() => this.leaf.detach()));
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(this.leaf.pinned ? host.t.interface.menu.unpin() : host.t.interface.menu.pin())
        .setIcon(this.leaf.pinned ? "lucide-pin-off" : "lucide-pin")
        .onClick(() => this.leaf.togglePinned()));
    }
    if (host.Platform.canSplit && leaf.canPin()) {
      menu
        .addItem((item) => item
          .setSection("open")
          .setTitle(host.tc.splitRight())
          .setDisabled(app.workspace.isInSidebar(this.leaf))
          .setIcon("lucide-separator-vertical")
          .onClick(() => app.workspace.duplicateLeaf(leaf, "vertical")))
        .addItem((item) => item
          .setSection("open")
          .setTitle(host.tc.splitDown())
          .setIcon("lucide-separator-horizontal")
          .onClick(() => app.workspace.duplicateLeaf(leaf, "horizontal")));
    }
  };

  proto.onTabMenu = function (menu) {
    host.View.prototype.onTabMenu.call(this, menu);
    const app = this.app;
    const leaf = this.leaf;
    if (leaf.canPin()) {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(leaf.pinned ? host.t.interface.menu.unpin() : host.t.interface.menu.pin())
        .setIcon("lucide-pin")
        .onClick(() => leaf.togglePinned()));
    }
    if (leaf.group) {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(host.t.interface.menu.unlinkTab())
        .setIcon("lucide-link")
        .onClick(() => leaf.setGroup(null)));
    } else if (leaf.canPin()) {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(host.t.interface.menu.linkTab())
        .setIcon("lucide-link")
        .onClick(() => app.workspace.onStartLink(leaf)));
    }
    if (host.Platform.canPopoutWindow) {
      menu.addItem((item) => item
        .setSection("open")
        .setTitle(host.t.interface.menu.moveToNewWindow())
        .setIcon("lucide-picture-in-picture")
        .onClick(() => { app.workspace.moveLeafToPopout(leaf); }));
    }
  };

  proto.onMoreOptionsMenu = function () {};

  return ItemView;
}
