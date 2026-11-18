// The tag pane (view type "tag"): a Tree of TagPaneItem rows built from metadataCache.getTags(), with
// nested "parent/child" tags, frequency / alphabetical sorting, an optional search filter that hides
// non-matching rows, and fold persistence under "tag-pane-fold".
//
// The view (bee) is a plain View that owns a TagPaneTree (yee, a Tree with a fixed fold key) and recycles
// TagPaneItem rows (gee, a collapsible tree item) across updates so their DOM survives.

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { setElementTooltip } from "./tooltip.js";
import { ng15MakeTreePusher, ng15CollapsibleTreeItem, ng15WalkTree, ng15HasChildList } from "./n-g15-tree.js";
import { searchClasses } from "./n-g11-query.js";
import { compareSearchText } from "./n-g11-view.js";

// Classes defined by the factories below, visible to each other regardless of factory order.
const tagPane = {};

const VIEW_TYPE_TAG = "tag";
const FOLD_KEY = "tag-pane-fold";
const SORT_GROUPS = [["alphabetical", "alphabeticalReverse"], ["frequency", "frequencyReverse"]];

// =====================================================================================================================
// One tag row
// =====================================================================================================================

/** A collapsible tree item showing "parent/tag" split into parent prefix + leaf name, plus an occurrence count. */
export function defineTagPaneItem(host) {
  const ItemBase = ng15CollapsibleTreeItem(host.TreeItem);

  function TagPaneItem(tree, tagView) {
    const self = ItemBase.call(this) || this;
    self.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    self.tag = "";
    self.count = -1;
    self.vChildren = new host.TreeChildren(self);
    self.pusherEl = ng15MakeTreePusher();
    self.tree = tree;
    self.tagView = tagView;
    const selfEl = self.selfEl;
    const innerEl = self.innerEl;
    selfEl.addClass("tag-pane-tag");
    self.tagTextEl = innerEl.createDiv("tree-item-inner-text");
    self.tagCountEl = selfEl.createDiv("tree-item-flair-outer").createSpan("tag-pane-tag-count tree-item-flair");
    self.setCollapsible(true);
    self.setClickable(true);
    return self;
  }
  inherit(TagPaneItem, ItemBase);
  const proto = TagPaneItem.prototype;

  /** Click toggles the "tag:<tag>" clause of the global search (plain click replaces, mod-click toggles). */
  proto.onSelfClick = function (event) {
    const app = this.tagView.app;
    const query = "tag:" + this.tag;
    const plugin = app.internalPlugins.getEnabledPluginById("global-search");
    if (!plugin) return;
    const current = plugin.getGlobalSearchQuery();
    if (!host.Keymap.isModEvent(event) || current === "") {
      plugin.openGlobalSearch(query);
      return;
    }
    if (current.contains(query)) plugin.openGlobalSearch(current.replace(query, "").trim());
    else plugin.openGlobalSearch(current.trim() + " " + query);
    this.tagView.tree.setFocusedItem(null, false);
  };

  /** Stores the tag and renders it as "parent/" prefix + leaf name. */
  proto.setTag = function (tag) {
    if (this.tag !== tag) {
      this.tag = tag;
      let text = tag;
      if (text.startsWith("#")) text = text.substr(1);
      const parts = text.split("/");
      const leaf = parts[parts.length - 1];
      const parent = text.substr(0, text.length - leaf.length);
      const el = this.tagTextEl;
      el.empty();
      el.createSpan({ cls: "tag-pane-tag-parent", text: parent });
      el.createSpan({ cls: "tree-item-inner-text", text: leaf });
    }
    return this;
  };

  proto.setCount = function (count) {
    if (this.count !== count) {
      this.count = count;
      this.tagCountEl.setText(String(count));
    }
    return this;
  };

  proto.onCollapseClick = function (event) {
    ItemBase.prototype.onCollapseClick.call(this, event);
    this.tree.requestSaveFolds();
  };

  proto.updateCollapsed = async function (animate) {
    await ItemBase.prototype.updateCollapsed.call(this, animate);
    if (!this.collapsed) {
      const tree = this.tree;
      if (tree.handleCollapseAll) tree.handleCollapseAll(false);
    }
    this.tree.infinityScroll.invalidate(this);
  };

  tagPane.TagPaneItem = TagPaneItem;
  return TagPaneItem;
}

// =====================================================================================================================
// The tree: a Tree whose fold state is stored under a fixed key
// =====================================================================================================================

/** Tree subclass with the tag pane's fold key. */
export function defineTagPaneTree(host) {
  function TagPaneTree() {
    return host.Tree.apply(this, arguments) || this;
  }
  inherit(TagPaneTree, host.Tree);
  TagPaneTree.prototype.getFoldKey = function () {
    return FOLD_KEY;
  };
  tagPane.TagPaneTree = TagPaneTree;
  return TagPaneTree;
}

// =====================================================================================================================
// The view
// =====================================================================================================================

/** The "tag" sidebar view: header buttons (sort, hierarchy, collapse-all, search) over a virtualised tag tree. */
export function defineTagPaneView(host) {
  const paneT = () => host.t.plugins.tagPane;
  const sortLabels = () => {
    const pane = host.t.plugins.tagPane;
    return {
      alphabetical: pane.labelSortByNameAToZ,
      alphabeticalReverse: pane.labelSortByNameZToA,
      frequency: pane.labelSortByFrequencyHighToLow,
      frequencyReverse: pane.labelSortByFrequencyLowToHigh,
    };
  };

  function TagPaneView(leaf) {
    const self = host.View.call(this, leaf) || this;
    self.icon = "lucide-tags";
    self.tagDoms = {};
    self.tagPaneEl = null;
    self.searchQuery = null;
    self.sortOrder = "frequency";
    self.useHierarchy = false;
    self.isShowingSearch = false;

    const containerEl = self.containerEl;
    self.tagPaneEl = containerEl.createDiv("tag-container");
    self.scope = new host.Scope(self.app.scope);
    self.tree = new tagPane.TagPaneTree(self, {
      app: self.app,
      containerEl: self.tagPaneEl,
      id: VIEW_TYPE_TAG,
      scope: self.scope,
      getNodeId: self.getNodeId.bind(self),
    });
    self.emptyEl = createDiv({ cls: "pane-empty tag-pane-empty", text: paneT().labelNoTags() });

    const header = new host.ViewHeader(self.app, containerEl);
    header.addNavButton("lucide-sort-asc", host.t.plugins.fileExplorer.actionChangeSort(), (event) => {
      event.preventDefault();
      const menu = new host.Menu();
      const current = self.sortOrder;
      for (const group of SORT_GROUPS) {
        for (const key of group) {
          const title = sortLabels()[key]();
          menu.addItem((item) => item
            .setTitle(title)
            .setChecked(key === current)
            .onClick(() => {
              self.sortOrder = key;
              self.requestUpdateTags();
              self.app.workspace.requestSaveLayout();
            }));
        }
        menu.addSeparator();
      }
      menu.showAtMouseEvent(event);
    });
    self.useHierarchyEl = header.addNavButton("lucide-folder-tree", paneT().actionShowNestedTags(), () => {
      self.setUseHierarchy(!self.useHierarchy);
      self.app.workspace.requestSaveLayout();
    });
    self.collapseOrExpandAllEl = header.addNavButton("lucide-chevrons-up-down", paneT().actionExpandAll(), () => {
      self.tree.toggleCollapseAll();
      self.app.workspace.requestSaveLayout();
    });
    self.showSearchButtonEl = header.addNavButton("lucide-search", host.t.plugins.backlinks.labelShowSearch(), () => {
      self.onToggleShowSearch();
      self.app.workspace.requestSaveLayout();
    });

    const onSearchChange = debounceCall(() => {
      self.updateSearch();
      self.app.workspace.requestSaveLayout();
    }, 300, true);
    self.searchComponent = new host.SearchComponent(header.navHeaderEl)
      .setPlaceholder(host.t.plugins.search.promptStartSearch())
      .onChange(onSearchChange)
      .then((component) => {
        setElementTooltip(component.clearButtonEl, host.t.plugins.search.tooltipClearSearch());
        component.inputEl.addEventListener("keypress", (event) => {
          if (event.isComposing) return;
          if (event.key !== "Enter") return;
          if (!host.Platform.hasPhysicalKeyboard) host.blurAndClearSelection();
          self.updateSearch();
        });
        component.containerEl.hide();
      });

    self.scope.register([], "Enter", self.onKeyEnterInFocus.bind(self));
    self.scope.register(["Mod"], "Enter", self.onKeyEnterInFocus.bind(self));
    containerEl.addEventListener("click", () => self.tree.setFocusedItem(null));
    self.requestUpdateTags = debounceCall(self.updateTags.bind(self), 10);
    self.setUseHierarchy(true);
    return self;
  }
  inherit(TagPaneView, host.View);
  const proto = TagPaneView.prototype;

  proto.getNodeId = function (item) {
    return item.tag.toLowerCase();
  };

  proto.isItem = function (item) {
    return item instanceof tagPane.TagPaneItem;
  };

  proto.onKeyEnterInFocus = function (event) {
    event.preventDefault();
    if (this.isItem(this.tree.focusedItem)) this.tree.focusedItem.onSelfClick(event);
  };

  proto.getDisplayText = function () {
    return paneT().shortName();
  };

  proto.getViewType = function () {
    return VIEW_TYPE_TAG;
  };

  proto.getState = function () {
    const state = host.View.prototype.getState.call(this);
    state.sortOrder = this.sortOrder;
    state.useHierarchy = this.useHierarchy;
    state.showSearch = this.isShowingSearch;
    state.searchQuery = this.searchComponent.getValue();
    return state;
  };

  proto.setState = async function (state, result) {
    await host.View.prototype.setState.call(this, state, result);
    const sortOrder = state.sortOrder;
    const useHierarchy = state.useHierarchy;
    const showSearch = state.showSearch;
    const searchQuery = state.searchQuery;
    if (String.isString(sortOrder) && sortLabels().hasOwnProperty(sortOrder)) this.sortOrder = sortOrder;
    if (isBoolean(useHierarchy)) this.setUseHierarchy(useHierarchy);
    if (isBoolean(showSearch)) this.setShowSearch(showSearch);
    if (String.isString(searchQuery)) {
      this.searchComponent.setValue(searchQuery);
      this.updateSearch();
    }
    this.requestUpdateTags();
  };

  proto.onload = function () {
    this.registerEvent(this.app.metadataCache.on("finished", this.requestUpdateTags, this));
    this.requestUpdateTags();
  };

  proto.onResize = function () {
    this.tree.onResize();
  };

  /** Keeps the collapse-all button icon / tooltip in sync with the tree's collapse-all state. */
  proto.setIsAllCollapsed = function (collapsed) {
    this.tree.isAllCollapsed = collapsed;
    if (collapsed) {
      host.setIcon(this.collapseOrExpandAllEl, "lucide-chevrons-up-down");
      setElementTooltip(this.collapseOrExpandAllEl, paneT().actionExpandAll());
    } else {
      host.setIcon(this.collapseOrExpandAllEl, "lucide-chevrons-down-up");
      setElementTooltip(this.collapseOrExpandAllEl, paneT().actionCollapseAll());
    }
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
  };

  /** Rebuilds the query object from the search box; empty or invalid input clears the filter. */
  proto.updateSearch = function () {
    const query = this.searchComponent.getValue();
    const previous = this.searchQuery;
    if ((!previous && !query) || (previous && previous.query === query)) return;
    try {
      if (query) {
        const searchQuery = new searchClasses.SearchQuery(this.app, query, false);
        this.searchQuery = searchQuery.matcher ? searchQuery : null;
      } else {
        this.searchQuery = null;
      }
      this.updateTags();
    } catch (error) {
      console.log(error);
    }
  };

  proto.setUseHierarchy = function (useHierarchy) {
    if (this.useHierarchy === useHierarchy) return;
    this.collapseOrExpandAllEl.ariaDisabled = String(!useHierarchy);
    this.useHierarchy = useHierarchy;
    this.useHierarchyEl.toggleClass("is-active", useHierarchy);
    this.requestUpdateTags();
    this.app.workspace.requestSaveLayout();
  };

  /** Rebuilds the whole tag tree from the metadata cache, reusing the previous rows where possible. */
  proto.updateTags = function () {
    const self = this;
    const app = this.app;
    const oldDoms = this.tagDoms;
    const tree = this.tree;
    const tags = app.metadataCache.getTags();
    const names = Object.keys(tags);
    const doms = (this.tagDoms = {});
    const folded = app.loadLocalStorage(FOLD_KEY);
    const foldedSet = new Set(folded || null);
    tree.root.vChildren.clear();
    tree.setFocusedItem(null, false);
    if (names.length === 0) {
      this.tagPaneEl.appendChild(this.emptyEl);
      return;
    }
    this.emptyEl.detach();

    const order = this.sortOrder;
    let compare;
    if (order === "alphabetical") {
      compare = (a, b) => compareSearchText(a.tag, b.tag);
    } else if (order === "alphabeticalReverse") {
      compare = (a, b) => -compareSearchText(a.tag, b.tag);
    } else {
      const direction = order === "frequencyReverse" ? -1 : 1;
      compare = (a, b) => {
        const countA = tags[a.tag];
        const countB = tags[b.tag];
        return countA === countB ? compareSearchText(a.tag, b.tag) : direction * (countB - countA);
      };
    }

    const hierarchy = this.useHierarchy;
    // Places `item` for `tag` under its parent chain (when hierarchy is on), creating parent rows as needed.
    const place = (tag, item) => {
      const leaf = tag.split("/").pop();
      if (hierarchy && leaf !== tag) {
        const parent = tag.substr(0, tag.length - leaf.length - 1);
        const key = parent.toLowerCase();
        let parentItem = doms[key];
        if (!parentItem) {
          parentItem = new tagPane.TagPaneItem(tree, self);
          parentItem.setTag(parent);
          doms[key] = parentItem;
        }
        if (parentItem.vChildren.children.indexOf(item) === -1) parentItem.vChildren.addChild(item);
        place(parent, parentItem);
      } else if (tree.root.vChildren.children.indexOf(item) === -1) {
        tree.root.vChildren.addChild(item);
      }
    };

    // Old rows keep their DOM but lose their children; missing rows are created fresh.
    for (const key in oldDoms) {
      if (oldDoms.hasOwnProperty(key)) oldDoms[key].vChildren.clear();
    }
    for (const name of names) {
      const key = name.toLowerCase();
      const item = oldDoms[key] || new tagPane.TagPaneItem(tree, self);
      item.setTag(name);
      doms[key] = item;
    }
    for (const name of names) {
      place(name, doms[name.toLowerCase()]);
    }
    for (const key in doms) {
      if (doms.hasOwnProperty(key)) {
        const item = doms[key];
        const hasKids = item.vChildren.hasChildren();
        item.setCollapsible(hasKids);
        item.setCount(tags[item.tag] || 0);
        if (hasKids) item.setCollapsed(foldedSet.has(key), false);
      }
    }
    tree.root.vChildren.sort(compare);

    const filtering = !!(self.searchComponent && self.searchComponent.getValue());
    ng15WalkTree(tree.root, (item) => {
      if (ng15HasChildList(item)) item.vChildren.sort(compare);
      if (filtering) {
        if (self.searchQuery.matchContent(item.tag)) {
          // keep the row and every ancestor visible
          for (let node = item; node; node = node.parent) node.el.show();
        } else {
          item.el.hide();
        }
      } else {
        item.el.show();
      }
    }, false);
    tree.infinityScroll.invalidateAll();
  };

  tagPane.TagPaneView = TagPaneView;
  return TagPaneView;
}
