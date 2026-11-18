// WorkspaceTabs: a tab group. A header strip (tabs, "new tab" button, tab list menu) above a stack of leaf containers where only the
// current tab is visible - or, in "stacked" mode, all leaves side by side as sliding panes. Dropping files / links / bookmarks on the
// header strip opens them as tabs.
import { inherit } from "./inherit.js";
import { runTransition, cancelTransition } from "./animation.js";

/** Mouse wheel over the header strip scrolls it sideways. */
function wheelScrollsSideways(event) {
  if (!event.deltaY) return;
  const strip = event.currentTarget;
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) strip.scrollLeft += event.deltaX;
  else strip.scrollLeft += event.deltaY;
  event.preventDefault();
}

/** Fire-and-forget: opens `items` one after the other in the given leaves, then focuses the last leaf. */
async function openSequentially(workspace, leaves, items, openOne) {
  for (let i = 0; i < items.length; i++) await openOne(items[i], leaves[i]);
  workspace.setActiveLeaf(leaves[leaves.length - 1], { focus: true });
}

export function defineWorkspaceTabs(host) {
  function WorkspaceTabs(workspace, id) {
    const self = host.WorkspaceParent.call(this, workspace, id) || this;
    self.type = "tabs";
    self.children = [];
    self.parent = null;
    self.allowSingleChild = true;
    self.autoManageDOM = false; // the tab group lays its children out itself (updateTabDisplay)
    self.tabHeaderEls = [];
    self.currentTab = 0;
    self.hasLockedTabWidths = false;
    self.isStacked = false;
    self.containerEl.addClass("workspace-tabs");

    const headerContainer = (self.tabHeaderContainerEl = self.containerEl.createDiv("workspace-tab-header-container"));
    const headerStrip = (self.tabsInnerEl = headerContainer.createDiv("workspace-tab-header-container-inner"));
    const tabsContainer = (self.tabsContainerEl = self.containerEl.createDiv("workspace-tab-container"));

    self.containerEl.on("click", ".workspace-tab-header", (event, headerEl) => {
      const index = self.tabHeaderEls.indexOf(headerEl);
      if (index === -1) return;
      self.selectTabIndex(index);
      const leaf = self.children[index];
      if (leaf instanceof host.WorkspaceLeaf) self.workspace.setActiveLeaf(leaf, { focus: true });
    });
    headerStrip.addEventListener("wheel", wheelScrollsSideways, { passive: false });
    if (window.frameDom) host.enableTitlebarDoubleClick(headerContainer);
    headerContainer.addEventListener("mouseleave", () => { self.unlockTabWidths(); });
    tabsContainer.addEventListener("scroll", () => self.onContainerScroll(), { passive: true });

    headerContainer.createDiv("workspace-tab-header-new-tab", (el) => {
      el.createSpan("clickable-icon", (button) => {
        host.setTooltip(button, host.t.interface.labelNewTab());
        host.setIcon(button, "lucide-plus");
        button.addEventListener("click", () => {
          const leaf = new host.WorkspaceLeaf(self.app);
          self.insertChild(self.children.length, leaf);
          self.selectTabIndex(self.children.length);
          self.workspace.setActiveLeaf(leaf, { focus: true });
        });
      });
    });
    headerContainer.createDiv("workspace-tab-header-spacer");
    headerContainer.createDiv("workspace-tab-header-tab-list", (el) => {
      el.createSpan("clickable-icon", (button) => {
        host.setIcon(button, "lucide-chevron-down");
        const open = (event) => {
          if (button.hasClass("has-active-menu")) return;
          event.preventDefault();
          self.showTabListMenu(button);
        };
        button.addEventListener("click", open);
        button.addEventListener("contextmenu", open);
      });
    });

    self.app.dragManager.handleDrop(headerContainer, (event, data, isPreview) => self.onHeaderDrop(event, data, isPreview));
    new ResizeObserver(self.updateSlidingTabs.bind(self)).observe(self.tabsContainerEl);
    return self;
  }
  inherit(WorkspaceTabs, host.WorkspaceParent);

  /** A tab group holding just `leaf`. */
  WorkspaceTabs.createFrom = function (workspace, leaf) {
    const tabs = new WorkspaceTabs(workspace);
    tabs.insertChild(0, leaf);
    return tabs;
  };

  /** The drop-down under the chevron: stack/unstack, close all, and one entry per tab. */
  WorkspaceTabs.prototype.showTabListMenu = function (anchor) {
    const menu = new host.Menu().addSections(["action", "close", "", "tablist"]);
    menu.dom.addClass("mod-tab-list");
    menu
      .addItem((item) => item
        .setSection("action")
        .setTitle(this.isStacked ? host.t.interface.menu.unstackTabs() : host.t.interface.menu.stackTabs())
        .setIcon("lucide-layers")
        .onClick(() => { this.setStacked(!this.isStacked); }))
      .addItem((item) => item
        .setSection("close")
        .setTitle(host.t.interface.menu.closeAll())
        .setIcon("lucide-x")
        .onClick(() => {
          for (const leaf of this.children.slice()) if (!leaf.pinned) leaf.detach();
        }));
    this.workspace.trigger("tab-group-menu", menu, this);
    this.children.forEach((leaf, index) => {
      if (!(leaf instanceof host.WorkspaceLeaf)) return;
      const view = leaf.view;
      if (!view) return;
      menu.addItem((item) => item
        .setSection("tablist")
        .setTitle(view.getDisplayText())
        .setChecked(index === this.currentTab)
        .setIcon(view.getIcon())
        .onClick(() => { this.workspace.setActiveLeaf(leaf); }));
    });
    const rect = anchor.getBoundingClientRect();
    menu.setParentElement(anchor).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: true });
  };

  /**
   * Something is dragged over / dropped on the header strip. With `isPreview` true nothing may be changed, only the hint is
   * returned ({ action, dropEffect, hoverEl? }); returns undefined for dragged things that are not openable.
   */
  WorkspaceTabs.prototype.onHeaderDrop = function (event, data, isPreview) {
    const kind = data.type;
    if (kind !== "file" && kind !== "files" && kind !== "link" && kind !== "bookmarks") return undefined;
    const { rect, index, droppedIndex } = this.getTabInsertLocation(event.clientX);
    const ui = host.t.interface.dragAndDrop;
    // dropped right onto the middle of an existing tab: reuse that tab when it can navigate
    const reuse = (leaf, open) => {
      if (!isPreview) {
        this.workspace.setActiveLeaf(leaf);
        open();
      }
      return { hoverEl: leaf.tabHeaderEl, hoverClass: "is-highlighted", action: ui.openInThisTab(), dropEffect: "move" };
    };
    const newLeaves = (count, at) => {
      const leaves = [];
      for (let i = 0; i < count; i++) {
        const leaf = new host.WorkspaceLeaf(this.app);
        this.insertChild(at + i, leaf);
        leaves.push(leaf);
      }
      return leaves;
    };

    if (kind === "link") {
      if (droppedIndex !== null) {
        const target = this.children[droppedIndex];
        if (target.canNavigate()) return reuse(target, () => target.openLinkText(data.linktext, data.sourcePath, { active: true }));
      }
      if (!isPreview) {
        const leaf = newLeaves(1, index)[0];
        leaf.openLinkText(data.linktext, data.sourcePath, { active: true });
      }
    } else if (kind === "bookmarks") {
      const plugin = this.app.internalPlugins.getEnabledPluginById("bookmarks");
      const items = data.items.map((entry) => entry.item).filter((item) => item.type === "file" || item.type === "graph");
      if (plugin) {
        if (droppedIndex !== null) {
          if (items.length !== 1) return undefined;
          const target = this.children[droppedIndex];
          if (target.canNavigate()) return reuse(target, () => plugin.openBookmarkInLeaf(items[0], target, { active: true }));
        } else if (items.length === 0) {
          return undefined;
        }
        if (!isPreview) {
          const leaves = newLeaves(items.length, index);
          openSequentially(this.workspace, leaves, items, (item, leaf) => plugin.openBookmarkInLeaf(item, leaf, { active: true }));
        }
      }
    } else {
      const files = (kind === "files" ? data.files : [data.file]).filter((file) => file instanceof host.TFile);
      if (files.length === 0) return undefined;
      if (files.length === 1 && droppedIndex !== null) {
        const target = this.children[droppedIndex];
        if (target.canNavigate()) return reuse(target, () => target.openFile(files[0], { active: true }));
      }
      if (!isPreview) {
        const leaves = newLeaves(files.length, index);
        openSequentially(this.workspace, leaves, files, (file, leaf) => leaf.openFile(file, { active: false }));
      }
    }
    this.app.dragManager.showOverlay(event.doc, rect);
    return { action: ui.openAsTab(), dropEffect: "copy" };
  };

  /** Stacked tabs (Andy Matuschak style); only on platforms that support it. */
  WorkspaceTabs.prototype.setStacked = function (stacked) {
    if (!host.Platform.canStackTabs) stacked = false;
    if (this.isStacked === stacked) return;
    this.isStacked = stacked;
    this.containerEl.toggleClass("mod-stacked", stacked);
    if (this.children.length > 0) {
      this.updateTabDisplay();
      this.scrollIntoView(this.currentTab);
      this.workspace.requestUpdateLayout();
    }
  };

  WorkspaceTabs.prototype.serialize = function () {
    const data = host.WorkspaceParent.prototype.serialize.call(this);
    if (this.currentTab > 0) data.currentTab = this.currentTab;
    if (this.isStacked) data.stacked = true;
    return data;
  };

  WorkspaceTabs.prototype.selectTabIndex = function (index) {
    index = Math.clamp(index, 0, this.children.length - 1);
    if (this.currentTab === index) return;
    this.currentTab = index;
    this.updateTabDisplay();
    if (this.isStacked) {
      const leaf = this.children[this.currentTab];
      if (leaf) leaf.containerEl.removeClass("is-hidden");
      this.scrollIntoView(this.currentTab);
    }
    this.workspace.requestSaveLayout();
    this.workspace.requestResize();
  };

  WorkspaceTabs.prototype.selectTab = function (leaf) {
    const index = this.children.indexOf(leaf);
    if (index !== -1) this.selectTabIndex(index);
  };

  /**
   * Brings the DOM in line with `children` / `currentTab`: header strip (with an animated diff when tabs came or went) and the
   * content area (one visible leaf, or all of them in stacked mode).
   */
  WorkspaceTabs.prototype.updateTabDisplay = function () {
    const { isStacked, tabsInnerEl: strip, tabsContainerEl: content, children } = this;
    if (children.length === 0) {
      content.empty();
      return;
    }
    const current = Math.clamp(this.currentTab, 0, children.length - 1);
    if (current !== this.currentTab) {
      this.currentTab = current;
      this.workspace.requestSaveLayout();
      this.workspace.requestResize();
    }

    // wanted children of the content area: leaf containers (stacked mode: header, then container, per leaf)
    const headers = [];
    const wanted = [];
    for (const leaf of children) {
      const header = leaf.tabHeaderEl;
      headers.push(header);
      if (isStacked) {
        wanted.push(header);
        leaf.loadIfDeferred();
      }
      wanted.push(leaf.containerEl);
    }
    this.tabHeaderEls = headers;
    const wantedSet = new Set(wanted);

    // elements about to be moved or removed: remember their scroll positions (restored by restoreScrollPositions below)
    for (const el of Array.from(content.children)) if (!wantedSet.has(el)) host.saveScrollPositions(el);
    for (const leaf of children) if (leaf.containerEl.parentNode !== content) host.saveScrollPositions(leaf.containerEl);
    if (isStacked) {
      let cursor = content.firstChild;
      const moved = new Set();
      for (const el of wanted) {
        if (el.parentNode !== content) continue;
        while (cursor && (!wantedSet.has(cursor) || moved.has(cursor))) cursor = cursor.nextSibling;
        if (cursor !== el) {
          host.saveScrollPositions(el);
          moved.add(el);
        } else {
          cursor = cursor.nextSibling;
        }
      }
    }

    let currentLeaf = null;
    children.forEach((leaf, i) => {
      const active = i === current;
      leaf.tabHeaderEl.toggleClass("is-active", active);
      leaf.containerEl.toggle(isStacked || active);
      if (active) currentLeaf = leaf;
      if (isStacked) cancelTransition(leaf.tabHeaderEl);
    });

    if (isStacked) {
      content.setChildrenInPlace(wanted);
    } else {
      for (const el of Array.from(content.children)) if (!wantedSet.has(el)) el.detach();
      for (const leaf of children) if (leaf.containerEl.parentNode !== content) content.appendChild(leaf.containerEl);
    }
    host.restoreScrollPositions(content);
    this.updateSlidingTabs();
    if (isStacked) return;

    // header strip
    if (strip.isShown()) {
      this.animateHeaderChanges(headers);
    } else {
      strip.setChildrenInPlace(headers);
    }
    if (currentLeaf) {
      // no scroll animation for the jump; in a side dock the strip pages through the tabs
      strip.style.setProperty("--animation-dur", "0s");
      if (this.getRoot() instanceof host.WorkspaceSidedock) strip.scrollLeft = currentLeaf.tabHeaderEl.clientWidth * current;
      if (this.containerEl.isShown()) currentLeaf.loadIfDeferred();
      strip.style.setProperty("--animation-dur", "250ms");
    }
  };

  /** Makes the strip show exactly `headers`; new ones grow in, vanished ones shrink out (on a clone, the real node is gone). */
  WorkspaceTabs.prototype.animateHeaderChanges = function (headers) {
    const strip = this.tabsInnerEl;
    const removed = [];
    const added = [];
    const wanted = new Set(headers);
    let cursor = strip.firstChild;
    for (const header of headers) {
      while (cursor && !wanted.has(cursor)) {
        removed.push(cursor);
        cursor = cursor.nextSibling;
      }
      if (header !== cursor) {
        if (header.parentNode !== strip) added.push(header);
        strip.insertBefore(header, cursor);
      } else {
        cursor = cursor.nextSibling;
      }
    }
    while (cursor) {
      removed.push(cursor);
      cursor = cursor.nextSibling;
    }
    for (const header of added) {
      header.style.flex = "";
      header.style.width = "";
    }
    const addedWidths = added.map((header) => header.clientWidth);
    const removedWidths = removed.map((header) => header.clientWidth);

    added.forEach((header, i) => {
      cancelTransition(header, true);
      header.style.flex = "0 0 auto";
      runTransition(header, new host.Transition({ duration: 200 }).addProp("width", "0", addedWidths[i] + "px", "").addProp("opacity", "0", "1", ""), () => {
        header.style.flex = "";
      });
    });
    removed.forEach((header, i) => {
      const ghost = header.cloneNode(true);
      header.replaceWith(ghost);
      ghost.style.flex = "0 0 auto";
      runTransition(ghost, new host.Transition({ duration: 200 }).addProp("width", removedWidths[i] + "px", "0", "").addProp("opacity", "1", "0", ""), () => {
        ghost.detach();
      });
    });
  };

  WorkspaceTabs.prototype.recomputeChildrenDimensions = function () {
    this.updateTabDisplay();
  };

  /**
   * Where a tab dragged to horizontal position `x` would be inserted: the marker rectangle, the insert index, and - when the
   * pointer is within the middle quarter of a tab - the index of the tab it would land on (otherwise null).
   */
  WorkspaceTabs.prototype.getTabInsertLocation = function (x) {
    const children = this.children;
    let marker = this.tabHeaderContainerEl.getBoundingClientRect();
    let index = this.tabHeaderEls.length;
    let droppedIndex = null;
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].tabHeaderEl.getBoundingClientRect();
      const left = rect.x;
      const right = rect.right;
      if (i === children.length - 1 || x <= right) {
        marker = { x: left, y: rect.y, width: 10, height: rect.height };
        index = i;
        const middle = (left + right) / 2;
        if (Math.abs(x - middle) / (right - left) < 0.25) droppedIndex = i;
        if (x > middle) {
          index++;
          marker.x = right;
        }
        break;
      }
    }
    marker.x -= 5;
    return { rect: marker, index, droppedIndex };
  };

  WorkspaceTabs.prototype.insertChild = function (index, leaf) {
    host.WorkspaceParent.prototype.insertChild.call(this, index, leaf);
    if (leaf instanceof host.WorkspaceLeaf) {
      leaf.updateHeader();
      cancelTransition(leaf.tabHeaderEl);
    }
    this.unlockTabWidths();
  };

  WorkspaceTabs.prototype.removeChild = function (leaf) {
    const index = this.children.indexOf(leaf);
    const previous = this.currentTab;
    const previousLeaf = this.children[previous];
    leaf.tabHeaderEl.removeClass("is-active");
    if (this.children.length === 1) this.workspace.lastTabGroupStacked = this.isStacked;
    host.WorkspaceParent.prototype.removeChild.call(this, leaf);
    if (this.children.length > 0 && index === previous) {
      // the current tab was closed: the next one takes its place (or the last one)
      this.currentTab = Math.min(index, this.children.length - 1);
      this.workspace.onLayoutChange(this);
    } else {
      this.currentTab = this.children.indexOf(previousLeaf);
    }
  };

  /** While the pointer is in the strip, tabs keep their width so closing one does not move the next close button away. */
  WorkspaceTabs.prototype.lockTabWidths = function () {
    if (!this.tabHeaderContainerEl.isShown() || this.isStacked) return;
    this.hasLockedTabWidths = true;
    const widths = this.children.map((leaf) => leaf.tabHeaderEl.clientWidth);
    this.children.forEach((leaf, i) => { leaf.tabHeaderEl.style.width = widths[i] + "px"; });
  };

  WorkspaceTabs.prototype.unlockTabWidths = function () {
    if (!this.hasLockedTabWidths) return;
    this.hasLockedTabWidths = false;
    if (this.tabHeaderContainerEl.isShown()) {
      const widths = this.children.map((leaf) => leaf.tabHeaderEl.clientWidth);
      this.children.forEach((leaf, i) => {
        runTransition(leaf.tabHeaderEl, new host.Transition({ duration: 250 }).addProp("width", widths[i] + "px", ""));
      });
    } else {
      for (const leaf of this.children) leaf.tabHeaderEl.style.width = "";
    }
  };

  /** Stacked layout: every header gets a left/right offset so it sticks to the edges while its pane scrolls past. */
  WorkspaceTabs.prototype.updateSlidingTabs = function () {
    const { isStacked, children, tabsContainerEl: content } = this;
    if (!isStacked) {
      for (const leaf of children) {
        leaf.tabHeaderEl.style.left = "";
        leaf.tabHeaderEl.style.right = "";
        leaf.containerEl.style.left = "";
        leaf.containerEl.style.minWidth = "";
        leaf.containerEl.style.maxWidth = "";
      }
      return;
    }
    const headerWidths = children.map((leaf) => leaf.tabHeaderEl.offsetWidth);
    const headersTotal = headerWidths.reduce((a, b) => a + b, 0);
    const maxPane = Math.max(300, content.clientWidth - headersTotal);
    const minPane = maxPane / children.length;
    let left = 0;
    let right = headersTotal;
    children.forEach((leaf, i) => {
      leaf.tabHeaderEl.style.left = left + "px";
      left += headerWidths[i];
      right -= headerWidths[i];
      leaf.tabHeaderEl.style.right = right + "px";
      leaf.containerEl.style.left = left + "px";
      leaf.containerEl.style.minWidth = minPane + "px";
      leaf.containerEl.style.maxWidth = maxPane + "px";
    });
    this.onContainerScroll();
  };

  /** Stacked layout: panes scrolled completely out of view get `is-hidden` (so they stop rendering). */
  WorkspaceTabs.prototype.onContainerScroll = function () {
    const { isStacked, children, currentTab, tabsContainerEl: content } = this;
    if (!isStacked) return;
    const headerWidths = children.map((leaf) => leaf.tabHeaderEl.offsetWidth);
    const paneWidths = children.map((leaf) => leaf.containerEl.offsetWidth);
    const viewLeft = content.scrollLeft;
    const viewRight = viewLeft + content.clientWidth;
    let x = 0;
    children.forEach((leaf, i) => {
      const paneStart = x + headerWidths[i];
      const paneEnd = paneStart + paneWidths[i];
      x = paneEnd;
      const hidden = i !== currentTab && (paneEnd <= viewLeft || paneStart >= viewRight);
      leaf.containerEl.toggleClass("is-hidden", hidden);
    });
  };

  /** Stacked layout: smooth-scrolls so that pane `index` is fully visible. */
  WorkspaceTabs.prototype.scrollIntoView = function (index) {
    const { children, tabsContainerEl: content } = this;
    const leaf = children[index];
    if (!leaf) return;
    let headersUpTo = 0;
    let headersAfter = 0;
    let offset = 0;
    for (let i = 0; i < children.length; i++) {
      const headerWidth = children[i].tabHeaderEl.offsetWidth;
      if (i <= index) {
        headersUpTo += headerWidth;
        offset += headerWidth;
        if (i < index) offset += children[i].containerEl.offsetWidth;
      } else {
        headersAfter += headerWidth;
      }
    }
    const minScroll = offset - headersUpTo;
    const maxScroll = offset + leaf.containerEl.offsetWidth - content.clientWidth + headersAfter;
    const scroll = content.scrollLeft;
    if (scroll < maxScroll) content.scrollTo({ behavior: "smooth", left: maxScroll });
    else if (scroll > minScroll) content.scrollTo({ behavior: "smooth", left: minScroll });
  };

  return WorkspaceTabs;
}
