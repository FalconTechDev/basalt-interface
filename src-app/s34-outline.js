// The "Outline" core plugin: a side-pane tree of the current note's headings.
//
// Replaces the inherited pieces:
//   p7  OutlinePlugin        -> defineOutlinePlugin
//   d7  OutlineView          -> defineOutlineView    (base: the shared link-pane view)
//   h7  OutlineTreeItem      -> defineOutlineTreeItem (base: collapsible tree item)
//   c7  "outline" view type  -> declarator "outline"
//
// The view keeps a reconciled list of heading rows inside the shared Tree/InfinityScroll widget,
// follows the cursor or the preview scroll position, offers a search filter and supports
// drag-reordering of heading sections inside the note.

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { setElementTooltip } from "./tooltip.js";
import { s05HeadingText } from "./s05-utils.js";
import { linkSafeHeading, endWithBlankLine } from "./text.js";
import { renderMatches } from "./search-simple.js";
import { searchClasses } from "./n-g11-query.js";
import { ng15WalkTree, ng15TreeDropPosition, ng15UpdateTreeDropIndicator, ng15MakeTreePusher, ng15CollapsibleTreeItem } from "./n-g15-tree.js";
import { ng08SetDragPlainData } from "./n-g08-drag.js";
import { ng08HeadingAtPosition } from "./n-g08-bookmarks.js";

const s34OutlineViewType = "outline";
const outlineT = (host) => host.t.plugins.outline;

function s34IsBoolean(value) {
  return typeof value === "boolean";
}

/** Reconciles `existing` against `desired` in place (same contract as the inherited yy helper). */
function reconcileItems(existing, desired, matches, create) {
  for (let o = 0; o < desired.length; o++) {
    const wanted = desired[o];
    let found = -1;
    for (let l = o; l < existing.length; l++) {
      if (matches(existing[l], wanted)) {
        found = l;
        break;
      }
    }
    if (found !== -1) {
      if (o !== found) {
        const tmp = existing[o];
        existing[o] = existing[found];
        existing[found] = tmp;
      }
    } else {
      existing.splice(o, 0, create(wanted));
    }
  }
  existing.length = desired.length;
}

// The plugin and the view/item factories run at different bundle positions; they reach each
// other through this registry.
const outlineParts = {};

/** One heading row of the outline tree. */
export function defineOutlineTreeItem(host) {
  const ItemBase = ng15CollapsibleTreeItem(host.TreeItem);

  function OutlineTreeItem(view, tree, heading) {
    const self = ItemBase.call(this) || this;
    self.pusherEl = ng15MakeTreePusher();
    self.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    self.vChildren = new host.TreeChildren(self);
    self.view = view;
    self.tree = tree;
    self.heading = heading;
    self.setClickable(true);
    self.setCollapsible(false);
    self.headingText = s05HeadingText(self.heading);
    self.innerEl.setText(self.headingText);
    return self;
  }
  inherit(OutlineTreeItem, ItemBase);
  const proto = OutlineTreeItem.prototype;

  proto.onSelfClick = function () {
    const view = this.view;
    const leaf = view.findCorrespondingLeaf();
    const state = { line: this.heading.position.start.line };
    if (leaf) {
      view.leaf.workspace.setActiveLeaf(leaf, { focus: true });
      leaf.view.setEphemeralState(state);
    } else {
      const app = view.app;
      const file = view.file;
      const newLeaf = app.workspace.getLeaf();
      newLeaf.openFile(file, { eState: state });
    }
  };

  proto.updateCollapsed = async function (collapsed) {
    if (!this.collapsed) this.tree.handleCollapseAll?.(false);
    await ItemBase.prototype.updateCollapsed.call(this, collapsed);
    this.tree.infinityScroll.invalidate(this);
  };

  outlineParts.OutlineTreeItem = OutlineTreeItem;
  return OutlineTreeItem;
}

/** The outline view: heading tree + search + follow-cursor for the active markdown file. */
export function defineOutlineView(host) {
  const backlinksT = () => host.t.plugins.backlinks;
  const searchT = () => host.t.plugins.search;
  const fileExplorerT = () => host.t.plugins.fileExplorer;
  const tagPaneT = () => host.t.plugins.tagPane;

  function OutlineView(leaf, plugin) {
    const self = host.LinkPaneView.call(this, leaf) || this;
    self.icon = "lucide-list";
    self.activeEl = null;
    self.searchQuery = null;
    self.cachedHeadingDom = [];
    self.isShowingSearch = false;
    self.followCursor = false;
    self.onSelectionChange = debounceCall(self.handleSelectionChange.bind(self), 20);
    self.prevQuery = "";
    self.plugin = plugin;
    const contentEl = self.contentEl;
    self.scope = new host.Scope(self.app.scope);
    self.tree = new host.Tree(self, {
      app: self.app,
      containerEl: contentEl,
      id: s34OutlineViewType,
      scope: self.scope,
      handleCollapseAll: self.handleCollapseAll.bind(self),
    });
    self.tree.isAllCollapsed = false;
    const header = new host.ViewHeader(self.app, self.containerEl);
    self.showSearchButtonEl = header.addNavButton("lucide-search", backlinksT().labelShowSearch(), self.onToggleShowSearch.bind(self));
    self.searchComponent = new host.SearchComponent(header.navHeaderEl)
      .setPlaceholder(searchT().promptStartSearch())
      .onChange(debounceCall(self.updateSearch.bind(self), 300, true))
      .then((component) => {
        setElementTooltip(component.clearButtonEl, searchT().tooltipClearSearch());
        component.inputEl.addEventListener("keypress", (event) => {
          if (event.isComposing) return;
          if (event.key !== "Enter") return;
          if (!host.Platform.hasPhysicalKeyboard) host.blurAndClearSelection();
          self.updateSearch();
        });
        component.containerEl.hide();
      });
    self.followCursorButtonEl = header.addNavButton("lucide-gallery-vertical", outlineT(host).labelFollowCursor(), self.onToggleFollowCursor.bind(self));
    self.collapseOrExpandAllEl = header.addNavButton("lucide-chevrons-down-up", fileExplorerT().actionCollapseAll(), () => self.tree.toggleCollapseAll());
    self.emptyEl = self.contentEl.createDiv({ cls: "pane-empty", text: outlineT(host).labelNoHeadings() });
    self.app.dragManager.handleDrop(contentEl, (event, dragInfo, isOver) => {
      if (dragInfo.source !== "outline" || dragInfo.type !== "heading" || dragInfo.file !== self.file) return;
      if (!self.tree.root.vChildren.hasChildren()) return;
      const drop = ng15TreeDropPosition(event, self.tree);
      const indicator = ng15UpdateTreeDropIndicator(self.tree, drop, [], isOver);
      if (!isOver) {
        (async () => {
          const cache = self.app.metadataCache.getFileCache(self.file);
          if (!cache?.headings || !drop?.node) return;
          const headings = cache.headings;
          const dragged = dragInfo.heading;
          const fromIndex = headings.indexOf(dragged);
          let toIndex = headings.indexOf(drop.node.heading);
          let anchor = drop.node.heading;
          if (toIndex === -1 || fromIndex === -1) return;
          if (drop.placement === "after") {
            toIndex++;
            anchor = headings[toIndex];
          }
          if (fromIndex === toIndex) return;
          let sectionEnd = fromIndex + 1;
          while (sectionEnd < headings.length && !(headings[sectionEnd].level <= dragged.level)) sectionEnd++;
          const startOffset = dragged.position.start.offset;
          let endOffset = sectionEnd < headings.length ? headings[sectionEnd].position.start.offset : -1;
          let anchorOffset = anchor ? anchor.position.start.offset : -1;
          const insertAt = Math.max(startOffset, endOffset, anchorOffset) + 1;
          const writeEnd = endOffset === -1 ? insertAt : endOffset;
          const anchorPos = anchorOffset === -1 ? insertAt : anchorOffset;
          if (anchorPos >= startOffset && anchorPos <= writeEnd) return;
          const content = await self.app.vault.read(self.file);
          if (endOffset === -1) endOffset = content.length;
          if (anchorOffset === -1) anchorOffset = content.length;
          const section = endWithBlankLine(content.substring(startOffset, endOffset));
          const next =
            anchorOffset < startOffset
              ? endWithBlankLine(content.substring(0, anchorOffset)) +
                section +
                content.substring(anchorOffset, startOffset) +
                content.substring(endOffset)
              : content.substring(0, startOffset) +
                endWithBlankLine(content.substring(endOffset, anchorOffset)) +
                section +
                content.substring(anchorOffset);
          await self.app.vault.modify(self.file, next);
        })();
      }
      return { dropEffect: "move", hoverEl: indicator, hoverClass: "is-active" };
    }, { dropEffect: "move", hoverEl: header, hoverClass: "is-active" });
    return self;
  }
  inherit(OutlineView, host.LinkPaneView);
  const proto = OutlineView.prototype;

  /** The markdown leaf showing this file (any group), used for cursor/scroll following. */
  proto.findCorrespondingLeaf = function () {
    const leaf = this.leaf;
    const group = leaf.group;
    const workspace = leaf.workspace;
    let leaves;
    if (group) leaves = workspace.getGroupLeaves(group);
    else {
      leaves = [];
      const active = workspace.getActiveFileView();
      if (active) leaves.push(active.leaf);
    }
    for (const candidate of leaves) {
      if (candidate && candidate.view instanceof host.MarkdownView && candidate.view.file === this.file) return candidate;
    }
    return null;
  };

  proto.handleCollapseAll = function (collapsed) {
    this.tree.isAllCollapsed = collapsed;
    if (collapsed) {
      host.setIcon(this.collapseOrExpandAllEl, "lucide-chevrons-up-down");
      setElementTooltip(this.collapseOrExpandAllEl, tagPaneT().actionExpandAll());
    } else {
      host.setIcon(this.collapseOrExpandAllEl, "lucide-chevrons-down-up");
      setElementTooltip(this.collapseOrExpandAllEl, tagPaneT().actionCollapseAll());
    }
  };

  proto.getDisplayText = function () {
    if (!this.file || host.Platform.isMobile) return outlineT(host).name();
    return outlineT(host).tabTitle({ displayText: host.LinkPaneView.prototype.getDisplayText.call(this) });
  };

  proto.getViewType = function () {
    return s34OutlineViewType;
  };

  proto.getState = function () {
    const state = host.LinkPaneView.prototype.getState.call(this);
    state.followCursor = this.followCursor;
    state.showSearch = this.isShowingSearch;
    state.searchQuery = this.searchComponent.getValue();
    return state;
  };

  proto.setState = async function (state, result) {
    await host.LinkPaneView.prototype.setState.call(this, state, result);
    const followCursor = state.followCursor;
    const searchQuery = state.searchQuery;
    const showSearch = state.showSearch;
    if (s34IsBoolean(followCursor)) this.setFollowCursor(followCursor);
    if (s34IsBoolean(showSearch)) this.setShowSearch(showSearch);
    if (String.isString(searchQuery)) {
      this.searchComponent.setValue(searchQuery);
      this.updateSearch();
    }
  };

  proto.canAcceptExtension = function () {
    return true;
  };

  proto.onload = function () {
    this.registerEvent(this.app.workspace.on("editor-selection-change", this.onSelectionChange));
    this.registerEvent(this.app.workspace.on("markdown-scroll", debounceCall(this.onMarkdownScroll.bind(this), 20)));
    this.registerEvent(this.app.metadataCache.on("changed", this.onFileChanged, this));
  };

  /** Heading under the cursor (edit mode) or under the preview scroll position. */
  proto.findActiveHeading = function (view) {
    if (!view) return null;
    let result = null;
    if (view.getMode() === "preview") {
      const scroll = view.scroll;
      ng15WalkTree(this.tree.root, (item) => {
        if (scroll >= item.heading.position.end.line) result = item;
      });
    } else if (view.file) {
      const selection = view.editor.listSelections().first();
      const heading = ng08HeadingAtPosition(this.app, view.file, selection.head);
      ng15WalkTree(this.tree.root, (item) => {
        if (item.heading === heading) {
          result = item;
          return true;
        }
      });
    }
    return result;
  };

  proto.setHighlightedItem = function (item) {
    if (item?.selfEl === this.activeEl) return;
    this.activeEl?.removeClass("is-active");
    this.activeEl = null;
    if (item) {
      this.activeEl = item.selfEl;
      this.activeEl.addClass("is-active");
      if (this.followCursor) this.tree.infinityScroll.scrollIntoView(item, 20);
    }
  };

  proto.getOwner = function () {
    const editor = this.app.workspace.activeEditor;
    if (editor && editor.file === this.file && !(editor instanceof host.EmbedFileView && editor.subpath)) return editor;
    const leaf = this.findCorrespondingLeaf();
    if (leaf && leaf.view instanceof host.MarkdownView) return leaf.view;
    return null;
  };

  proto.onMarkdownScroll = function (view) {
    if (view.getMode() === "preview" && view === this.getOwner()) {
      const item = this.findActiveHeading(view);
      this.setHighlightedItem(item);
    }
  };

  proto.onFileChanged = function (file) {
    if (this.app.workspace.layoutReady && file === this.file) this.requestUpdate();
  };

  proto.handleSelectionChange = function (view, owner) {
    if (
      owner === this.getOwner() &&
      !(owner instanceof host.MarkdownView && owner.dirty) &&
      !(owner instanceof host.MarkdownEmbedBase && owner.dirty)
    ) {
      const item = this.findActiveHeading(owner);
      this.setHighlightedItem(item);
    }
  };

  proto.createItemDom = function (heading) {
    const self = this;
    const item = new outlineParts.OutlineTreeItem(this, this.tree, heading);
    this.app.dragManager.handleDrag(item.selfEl, (event) => {
      self.app.dragManager.updateSource([item.selfEl], "is-being-dragged");
      ng08SetDragPlainData(event.dataTransfer, item.heading.heading);
      return {
        source: "outline",
        type: "heading",
        icon: "heading-glyph",
        title: item.heading.heading,
        heading: item.heading,
        file: self.file,
      };
    });
    const selfEl = item.selfEl;
    selfEl.addEventListener("mouseover", (event) => {
      if (!host.pointerEntered(event, selfEl) || host.isTouchSyntheticMouse(event)) return;
      const linktext = self.file.path + "#" + linkSafeHeading(heading.heading);
      self.app.workspace.trigger("hover-link", { event, source: "outline", hoverParent: self, targetEl: selfEl, linktext });
    });
    return item;
  };

  proto.update = function () {
    if (this.file !== this.cachedFile) {
      this.activeEl = null;
      this.cachedHeadingDom = [];
      this.cachedFile = this.file;
    }
    this.tree.root.vChildren.clear();
    const headings = this.getHeadings();
    if (headings.length > 0) {
      const items = this.cachedHeadingDom;
      this.emptyEl.detach();
      reconcileItems(
        items,
        headings,
        (item, heading) => {
          const current = item.heading;
          const same = current.level === heading.level && current.heading === heading.heading;
          if (same) {
            item.heading = heading;
            if (item.vChildren.hasChildren()) item.vChildren.clear();
          }
          return same;
        },
        (heading) => this.createItemDom(heading)
      );
      const stack = [];
      for (const item of items) {
        const heading = item.heading;
        let parent = stack[stack.length - 1];
        while (parent && parent.heading.level >= heading.level) {
          stack.pop();
          parent = stack[stack.length - 1];
        }
        stack.push(item);
        if (parent) {
          parent.vChildren.addChild(item);
          parent.setCollapsible(true);
        } else {
          this.tree.root.vChildren.addChild(item);
        }
      }
    } else {
      this.contentEl.appendChild(this.emptyEl);
    }
    const active = this.findActiveHeading(this.getOwner());
    this.setHighlightedItem(active);
    this.filterSearchResults();
    this.tree.infinityScroll.queueCompute();
  };

  /** Applies the search filter: matching rows get their heading text highlighted, others hidden. */
  proto.filterSearchResults = function () {
    const tree = this.tree;
    const filtering = !!this.searchQuery;
    const query = this.searchQuery?.query ?? "";
    const queryChanged = query !== this.prevQuery;
    this.prevQuery = query;
    ng15WalkTree(tree.root, (item) => {
      if (filtering) {
        const match = this.searchQuery.matchContent(item.heading.heading);
        if (match) {
          if (!queryChanged && item.innerEl.hasClass("is-match")) return;
          item.innerEl.empty();
          item.innerEl.addClass("is-match");
          renderMatches(item.innerEl, item.headingText, match.content);
          let node = item;
          while (node) {
            node.el.show();
            node = node.parent;
          }
        } else {
          if (!queryChanged && !item.innerEl.hasClass("is-match")) return;
          item.innerEl.removeClass("is-match");
          item.innerEl.setText(item.headingText);
          item.el.hide();
        }
      } else {
        if (!queryChanged && !item.innerEl.hasClass("is-match")) return;
        item.innerEl.removeClass("is-match");
        item.innerEl.setText(item.headingText);
        item.el.show();
      }
      tree.infinityScroll.invalidate(item);
    });
  };

  proto.getHeadings = function () {
    const file = this.file;
    if (!file || file.extension !== "md") return [];
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return [];
    const headings = cache.headings;
    return headings && headings.length !== 0 ? headings : [];
  };

  proto.setFollowCursor = function (follow) {
    if (follow === this.followCursor) return;
    this.followCursor = follow;
    this.followCursorButtonEl.toggleClass("is-active", follow);
  };

  proto.onToggleFollowCursor = function () {
    this.setFollowCursor(!this.followCursor);
    if (this.followCursor) {
      const item = this.findActiveHeading(this.getOwner());
      if (item) this.tree.infinityScroll.scrollIntoView(item, 20);
    }
    this.app.workspace.requestSaveLayout();
  };

  proto.onToggleShowSearch = function () {
    this.setShowSearch(!this.isShowingSearch);
    if (this.isShowingSearch) this.searchComponent.inputEl.focus();
  };

  proto.showSearch = function () {
    this.setShowSearch(true);
    this.searchComponent.inputEl.focus();
  };

  proto.setShowSearch = function (show) {
    if (show === this.isShowingSearch) return;
    this.isShowingSearch = show;
    this.searchComponent.containerEl.toggle(show);
    this.showSearchButtonEl.toggleClass("is-active", show);
    if (!show) {
      this.searchComponent.setValue("");
      this.updateSearch();
    }
    this.app.workspace.requestSaveLayout();
  };

  proto.updateSearch = function () {
    const value = this.searchComponent.getValue();
    const current = this.searchQuery;
    if ((!current && !value) || (current && current.query === value)) return;
    try {
      if (value) {
        const query = new searchClasses.SearchQuery(this.app, value, false);
        this.searchQuery = query.matcher ? query : null;
      } else {
        this.searchQuery = null;
      }
      this.filterSearchResults();
    } catch (error) {
      console.log(error);
    }
  };

  outlineParts.OutlineView = OutlineView;
  return OutlineView;
}

/** The plugin shell: view type, open commands, file-menu entry, hover source and the "outline" CLI. */
export function defineOutlinePlugin(host) {
  class OutlinePlugin {
    constructor() {
      this.id = "outline";
      this.name = outlineT(host).name();
      this.description = outlineT(host).desc();
      this.defaultOn = true;
    }

    init(app, plugin) {
      const self = this;
      this.app = app;
      this.plugin = plugin;
      plugin.registerViewType(s34OutlineViewType, (leaf) => new outlineParts.OutlineView(leaf, self));
      plugin.registerGlobalCommand({
        id: "outline:open",
        name: outlineT(host).actionShow(),
        icon: "lucide-list",
        callback: () => {
          self.app.workspace.ensureSideLeaf(s34OutlineViewType, "right", { active: true });
        },
      });
      plugin.registerGlobalCommand({
        id: "outline:open-for-current",
        name: outlineT(host).actionOpenForCurrent(),
        icon: "lucide-list",
        checkCallback: this.openTocForActiveFile.bind(this),
      });
    }

    onEnable(app, wrapper) {
      wrapper.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
      wrapper.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
      app.workspace.registerHoverLinkSource("outline", { display: this.name, defaultMod: true });
      wrapper.registerCliHandler(
        "outline",
        "Show headings for the current file",
        {
          file: { value: "<name>", description: "File name" },
          path: { value: "<path>", description: "File path" },
          format: { value: "tree|md|json", description: "Output format (default: tree)" },
          total: { description: "Return heading count" },
        },
        (args) => {
          const file = app.cli.tryResolveFile(args);
          if (file.extension !== "md") throw "File is not a markdown file.";
          const cache = app.metadataCache.getFileCache(file);
          const headings = cache?.headings;
          if (!headings || headings.length === 0) return "No headings found.";
          let list = headings;
          if (args.total) return String(list.length);
          if (args.format === "json") {
            return JSON.stringify(
              list.map((h) => ({ level: h.level, heading: h.heading, line: h.position.start.line + 1 })),
              null,
              2
            );
          }
          if (args.format === "md") {
            return list.map((h) => "#".repeat(h.level) + " " + h.heading).join("\n");
          }
          const roots = [];
          const stack = [];
          for (const heading of list) {
            const node = { label: heading.heading, children: [] };
            while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) stack.pop();
            if (stack.length === 0) roots.push(node);
            else stack[stack.length - 1].node.children.push(node);
            stack.push({ node, level: heading.level });
          }
          return app.cli.formatAsciiTree(roots);
        }
      );
    }

    onUserEnable() {
      this.initLeaf();
    }

    initLeaf() {
      this.app.workspace.ensureSideLeaf(s34OutlineViewType, "right", { reveal: false });
    }

    onFileMenu(menu, file, source, leaf) {
      if (host.Platform.isMobile) return;
      if (!(file instanceof host.TFile) || !leaf || file.extension !== "md") return;
      if (source === "sidebar-context-menu") return;
      const self = this;
      menu.addItem((item) =>
        item
          .setSection("view.linked")
          .setTitle(outlineT(host).actionOpen())
          .setIcon("lucide-list")
          .onClick(async () => {
            await self.app.workspace.splitLeafOrActive(leaf, "vertical").setViewState({
              type: s34OutlineViewType,
              active: true,
              group: leaf,
              state: { file: file.path },
            });
          })
      );
    }

    openTocForActiveFile(checking) {
      const workspace = this.app.workspace;
      const file = workspace.getActiveFile();
      if (file) {
        if (!checking) {
          workspace.splitActiveLeaf("vertical").setViewState({
            type: s34OutlineViewType,
            active: true,
            group: workspace.activeLeaf,
            state: { file: file.path },
          });
        }
        return true;
      }
    }
  }
  return OutlinePlugin;
}
