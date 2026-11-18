// g11 clean-room: the "backlink" and "outgoing-link" sidebar panes.
// LinkPaneView is the shared FileView base; BacklinkComponent/BacklinkView render
// linked + unlinked mentions; OutgoingLinkComponent/OutgoingLinkView render resolved
// links plus unlinked-mention rows with one-click link conversion.

import { inherit,methods } from "./inherit.js";
import { env } from "./env.js";
import { debounceCall } from "./timing.js";
import { setElementTooltip } from "./tooltip.js";
import { ng11SearchViewClasses,ng11CompareSearchText,ng11SearchSortOrders,ng11SearchSortGroups,ng11SearchSortLabel,ng11SortOrderComparator,ng11ContextLineBounds,ng11ToggleElementVisibility,ng11CopyTextToClipboard,ng11BatchedIteration,ng11RunSearchOverFiles,ng11DefineFileQueue,ng11DefineSearchMatchResult,ng11DefineSearchPropertyResult,ng11DefineSearchFileResult,ng11DefineSearchResults } from "./n-g11-results.js";
import { ng11SearchClasses,ng11DefineSearchQuery } from "./n-g11-query.js";
import { ng11WholeWordPattern } from "./n-g11-matchers.js";
import { lastSegment,extensionOf } from "./path.js";

function ng11EnsurePaneClasses(host) {
  ng11PaneHost = host;
  ng11DefineSearchQuery(host);
  ng11DefineSearchMatchResult(host);
  ng11DefineSearchPropertyResult(host);
  ng11DefineSearchFileResult(host);
  ng11DefineSearchResults(host);
  ng11DefineFileQueue(host);
  if (!LinkPaneView.prototype.load) {
    inherit(LinkPaneView, host.FileView);
    methods(LinkPaneView, LinkPaneViewProto);
  }
}
let ng11PaneHost = null;
function LPH() { return ng11PaneHost; }

// Contract-name aliases for sibling modules / manifest.
export const defineLinkPaneView = (host) => ng11DefineLinkPaneView(host);
export const defineBacklinkComponent = (host) => ng11DefineBacklinkComponent(host);
export const defineBacklinkView = (host) => ng11DefineBacklinkView(host);
export const defineOutgoingLinkComponent = (host) => ng11DefineOutgoingLinkComponent(host);
export const defineOutgoingLinkView = (host) => ng11DefineOutgoingLinkView(host);

function ng11PaneModEvent(event) {
  return !!(event && (event.metaKey || event.ctrlKey));
}
function ng11FileName(file) { return file ? (file.basename || file.name) : ""; }
function ng11DropMd(path) { return typeof path === "string" ? path.replace(/\.md$/i, "") : path; }
function ng11LinkPathOf(linktext) {
  if (typeof linktext !== "string") return "";
  return linktext.split("|")[0].split("#")[0];
}
function ng11LinkSubpathOf(linktext) {
  if (typeof linktext !== "string") return "";
  const noAlias = linktext.split("|")[0];
  const h = noAlias.indexOf("#");
  return h >= 0 ? noAlias.slice(h) : "";
}

// ---- LinkPaneView -----------------------------------------------------------------------------------

function LinkPaneView(leaf) {
  const self = LPH().FileView.call(this, leaf) || this;
  self.navigation = false;
  self.allowNoFile = true;
  self.requestUpdate = debounceCall(() => self.update(), 10);
  return self;
}

// ---- shared section chrome --------------------------------------------------------------------------

/** One collapsible pane section: header row (.tree-item-self.is-clickable) + body el. */
function ng11MakeSection(pane, label, countEl, onToggle) {
  const header = pane.createDiv("tree-item-self is-clickable");
  header.addClass("search-section-header");
  const icon = header.createDiv("tree-item-icon collapse-icon");
  LPH().setIcon(icon, "right-triangle");
  const inner = header.createDiv("tree-item-inner");
  inner.createDiv("tree-item-inner-text").setText(label);
  const flair = header.createDiv("tree-item-flair-outer").createSpan("tree-item-flair");
  const body = pane.createDiv();
  body.hide();
  const section = {
    header, body, flair, collapsed: true,
    setCollapsed(c, animate) {
      this.collapsed = c;
      LPH().setIcon(icon, c ? "right-triangle" : "down-chevron"); // fallback; chevron rotated via class in real css
      ng11ToggleElementVisibility(body, c, animate);
      setElementTooltip(header, c ? LPH().t.interface.tooltip.clickToExpand() : LPH().t.interface.tooltip.clickToCollapse());
    },
  };
  header.addEventListener("click", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    section.setCollapsed(!section.collapsed, true);
    if (onToggle) onToggle(section.collapsed);
  });
  return section;
}

// ---- BacklinkComponent ------------------------------------------------------------------------------

function BacklinkComponent(app, containerEl, scrollParent) {
  const self = LPH().Component.call(this) || this;
  self.app = app;
  self.containerEl = containerEl;
  self.scrollParent = scrollParent || containerEl;
  self.collapseAll = false;
  self.extraContext = false;
  self.sortOrder = "alphabetical";
  self.isShowingSearch = false;
  self.searchQuery = null;
  self.backlinkCollapsed = false;
  self.unlinkedCollapsed = true;
  self.unlinkedAliases = "";
  self.backlinkFile = null;
  self.unlinkedFile = null;
  self.tooltipPlacement = "right";
  self._backlinkQueue = null;
  self._unlinkedQueue = null;
  self._pendingFiles = new Set();
  self._buildDom();
  return self;
}
const BacklinkComponentProto = {
  _buildDom() {
    const host = LPH();
    const t = host.t.plugins.backlinks;
    const pane = this.containerEl.createDiv("backlink-pane");
    this.paneEl = pane;

    // header: collapse-all / more-context / sort / show-search buttons
    const header = pane.createDiv("backlink-header");
    this.collapseAllBtn = header.createDiv("clickable-icon");
    host.setIcon(this.collapseAllBtn, "lucide-list");
    setElementTooltip(this.collapseAllBtn, host.t.plugins.search.labelCollapseResults());
    this.collapseAllBtn.addEventListener("click", () => this.setCollapseAll(!this.collapseAll));
    this.moreContextBtn = header.createDiv("clickable-icon");
    host.setIcon(this.moreContextBtn, "lucide-move-vertical");
    setElementTooltip(this.moreContextBtn, host.t.plugins.search.labelMoreContext());
    this.moreContextBtn.addEventListener("click", () => this.setExtraContext(!this.extraContext));
    this.sortBtn = header.createDiv("clickable-icon");
    host.setIcon(this.sortBtn, "lucide-arrow-up-down");
    this.sortBtn.addEventListener("click", (e) => this._sortMenu(e));
    this.searchBtn = header.createDiv("clickable-icon");
    host.setIcon(this.searchBtn, "lucide-search");
    setElementTooltip(this.searchBtn, t.labelShowSearch());
    this.searchBtn.addEventListener("click", () => this.setShowSearch(!this.isShowingSearch));

    const searchRow = pane.createDiv("search-row");
    this.searchComponent = new host.SearchComponent(searchRow);
    this.searchComponent.setPlaceholder(host.t.plugins.search.promptStartSearch());
    this.searchComponent.inputEl.addClass("backlink-search-input");
    this._onSearchChange = debounceCall(() => this.updateSearch(), 300);
    this.searchComponent.onChange(() => {
      const v = this.searchComponent.getValue();
      if (v === this.searchQuery) return;
      this.updateSearch();
    });
    this.searchComponent.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); this.updateSearch(); }
    });
    searchRow.hide();
    this.searchRowEl = searchRow;

    // two sections
    this.linkedSection = ng11MakeSection(pane, t.labelLinkedMentions(), null, (c) => this.setBacklinkCollapsed(c, true));
    this.backlinkDom = new ng11SearchViewClasses.SearchResults(app, this.linkedSection.body.createDiv({ cls: "search-result-container" }), t.labelNoBacklinks(), this.scrollParent);
    this.linkedSection.body.show();
    this.unlinkedSection = ng11MakeSection(pane, t.labelUnlinkedMentions(), null, (c) => this.setUnlinkedCollapsed(c, true));
    this.unlinkedDom = new ng11SearchViewClasses.SearchResults(app, this.unlinkedSection.body.createDiv({ cls: "search-result-container" }), t.labelNoUnlinkedMentions(), this.scrollParent);
    this.unlinkedSection.body.show();
    this.linkedSection.setCollapsed(this.backlinkCollapsed, false);
    this.unlinkedSection.setCollapsed(this.unlinkedCollapsed, false);

    this._syncSectionStates();
  },
  _syncSectionStates() {
    // counts live in the section flair elements
    this.linkedSection.flair.setText(String(this.backlinkDom.getMatchCount()));
    this.unlinkedSection.flair.setText(String(this.unlinkedDom.getMatchCount()));
  },
  _sortMenu(event) {
    event.preventDefault(); event.stopPropagation();
    const host = LPH();
    const menu = new host.Menu().addSections(["action"]);
    for (const group of ng11SearchSortGroups) {
      for (const key of group) {
        menu.addItem((item) => item.setTitle(ng11SearchSortLabel(key)).setChecked(this.sortOrder === key)
          .onClick(() => this.setSortOrder(key)));
      }
    }
    menu.showAtMouseEvent(event);
  },
  getState() {
    return {
      collapseAll: this.collapseAll,
      extraContext: this.extraContext,
      sortOrder: this.sortOrder,
      showSearch: this.isShowingSearch,
      searchQuery: this.searchQuery,
      backlinkCollapsed: this.backlinkCollapsed,
      unlinkedCollapsed: this.unlinkedCollapsed,
    };
  },
  setState(state) {
    if (!state) return;
    if (typeof state.collapseAll === "boolean") this.setCollapseAll(state.collapseAll);
    if (typeof state.extraContext === "boolean") this.setExtraContext(state.extraContext);
    if (typeof state.sortOrder === "string" && ng11SearchSortOrders[state.sortOrder]) this.setSortOrder(state.sortOrder);
    if (typeof state.showSearch === "boolean") this.setShowSearch(state.showSearch);
    if (typeof state.searchQuery === "string") {
      this.searchQuery = state.searchQuery;
      if (this.searchComponent) this.searchComponent.setValue(state.searchQuery);
      this.updateSearch();
    }
    if (typeof state.backlinkCollapsed === "boolean") { this.backlinkCollapsed = state.backlinkCollapsed; this.linkedSection.setCollapsed(state.backlinkCollapsed, false); }
    if (typeof state.unlinkedCollapsed === "boolean") { this.unlinkedCollapsed = state.unlinkedCollapsed; this.unlinkedSection.setCollapsed(state.unlinkedCollapsed, false); }
  },
  setBacklinkCollapsed(v, animate) {
    if (this.backlinkCollapsed === v) return;
    this.backlinkCollapsed = v;
    this.linkedSection.setCollapsed(v, animate);
    if (v) { this._backlinkQueue && this._backlinkQueue.cancel(); this.linkedSection.flair.setText(""); }
    else this.recomputeBacklink(this.file);
    this.app.workspace.requestSaveLayout();
  },
  setUnlinkedCollapsed(v, animate) {
    if (this.unlinkedCollapsed === v) return;
    this.unlinkedCollapsed = v;
    this.unlinkedSection.setCollapsed(v, animate);
    if (v) { this._unlinkedQueue && this._unlinkedQueue.cancel(); this.unlinkedSection.flair.setText(""); }
    else this.recomputeUnlinked(this.file);
    this.app.workspace.requestSaveLayout();
  },
  setCollapseAll(v) {
    if (this.collapseAll === v) return;
    this.collapseAll = v;
    this.collapseAllBtn.toggleClass("is-active", v);
    for (const dom of [this.backlinkDom, this.unlinkedDom]) {
      dom.collapseAll = v;
      for (const item of dom.vChildren.children) item.setCollapse(v, false);
    }
    this.app.workspace.requestSaveLayout();
  },
  setExtraContext(v) {
    if (this.extraContext === v) return;
    this.extraContext = v;
    this.moreContextBtn.toggleClass("is-active", v);
    this.backlinkDom.setExtraContext(v);
    this.unlinkedDom.setExtraContext(v);
    this.app.workspace.requestSaveLayout();
  },
  setShowSearch(show) {
    if (this.isShowingSearch === show) return;
    this.isShowingSearch = show;
    this.searchBtn.toggleClass("is-active", show);
    ng11ToggleElementVisibility(this.searchRowEl, !show, true);
    if (!show) {
      if (this.searchQuery) { this.searchQuery = null; this.searchComponent.setValue(""); }
      this._applySearchFilter();
    } else {
      this.searchComponent.inputEl.focus();
    }
    this.app.workspace.requestSaveLayout();
  },
  setSortOrder(order) {
    if (!ng11SearchSortOrders[order] || this.sortOrder === order) return;
    this.sortOrder = order;
    this.backlinkDom.sortOrder = order;
    this.unlinkedDom.sortOrder = order;
    this.backlinkDom.changed();
    this.unlinkedDom.changed();
    this.app.workspace.requestSaveLayout();
  },
  updateSearch() {
    const query = this.searchComponent ? this.searchComponent.getValue() : "";
    if (query === this.searchQuery) return;
    this.searchQuery = query || null;
    if (!query) { this._searchQueryObj = null; this._applySearchFilter(); return; }
    try {
      this._searchQueryObj = new ng11SearchClasses.SearchQuery(this.app, query, false);
    } catch (e) {
      new (LPH().Notice)(e.message || String(e));
      this._searchQueryObj = null;
    }
    this._applySearchFilter();
    this.update();
  },
  _applySearchFilter() {
    for (const dom of [this.backlinkDom, this.unlinkedDom]) {
      const kept = [];
      for (const item of dom.vChildren.children) {
        if (this.passSearchFilter(item.file, item.content)) kept.push(item);
        else item.el.detach();
      }
      for (const item of kept) dom.childrenEl.appendChild(item.el);
    }
    this._syncSectionStates();
  },
  passSearchFilter(file, content) {
    if (!this._searchQueryObj || !this._searchQueryObj.matcher) return true;
    try {
      const r = this._searchQueryObj.match(file, content);
      return !!(r && (Object.keys(r).length > 0));
    } catch (e) { return false; }
  },
  file: null,
  update() {
    const file = this.file;
    if (file !== this._lastFile) {
      this._lastFile = file;
      this.recomputeBacklink(file);
      this.recomputeUnlinked(file);
    }
    this._syncSectionStates();
  },
  onFileOpen(file) { this.file = file; this.requestUpdate(); },
  onResize() { this.backlinkDom.onResize(); this.unlinkedDom.onResize(); },

  // ---- linked mentions ---------------------------------------------------------------------------
  recomputeBacklink(file) {
    if (this._backlinkQueue) this._backlinkQueue.cancel();
    const host = LPH();
    const app = this.app;
    this.backlinkFile = file;
    const dom = this.backlinkDom;
    dom.emptyResults();
    if (this.backlinkCollapsed || !file) { this.linkedSection.flair.setText("0"); return; }
    const resolved = app.metadataCache.resolvedLinks || {};
    const candidates = app.vault.getFiles().filter((f) => {
      if (f === file) return false;
      if (!this._isLinkable(f)) return false;
      const dests = resolved[f.path];
      return !!(dests && file.path in dests);
    });
    candidates.sort(ng11SortOrderComparator(dom.sortOrder));
    if (!candidates.length) { this.linkedSection.flair.setText("0"); return; }
    const queue = new ng11SearchViewClasses.FileQueue({
      onStart: () => dom.startLoader(),
      onStop: () => { dom.stopLoader(); this.linkedSection.flair.setText(String(dom.getMatchCount())); },
    });
    this._backlinkQueue = queue;
    queue.addList(candidates);
    const self = this;
    (async () => {
      for await (const f of ng11BatchedIteration(queue.generator(), { batchSize: 2 })) {
        if (queue.runnable.isCancelled()) return;
        if (app.metadataCache.isUserIgnored(f.path)) continue;
        try {
          const content = await app.vault.cachedRead(f);
          const result = self._collectLinkRefs(f, file, content);
          if (result && self.passSearchFilter(f, content)) {
            if (Object.keys(result).length) dom.addResult(f, result, content, true);
            else dom.removeResult(f);
          } else dom.removeResult(f);
        } catch (e) { /* skip unreadable */ }
      }
    })();
  },
  _isLinkable(f) {
    const app = this.app;
    if (f.extension === "md") return true;
    const lu = app.metadataCache.linkUpdaters;
    if (Array.isArray(lu)) return lu.includes(f.extension);
    if (lu && typeof lu === "object") return !!lu[f.extension];
    return false;
  },
  _collectLinkRefs(sourceFile, targetFile, content) {
    const app = this.app;
    const result = { content: [], properties: [] };
    const ext = sourceFile.extension || "";
    if (ext === "canvas") {
      const plugin = app.internalPlugins && app.internalPlugins.getEnabledPluginById("canvas");
      if (!plugin) return null;
      let json = null;
      try { json = JSON.parse(content); } catch (e) { return null; }
      if (!json || !Array.isArray(json.nodes)) return null;
      const index = plugin.index && plugin.index.get(sourceFile);
      const caches = (index && index.caches) || {};
      for (const node of json.nodes) {
        const cache = caches[node.id];
        const refs = cache ? [...(cache.links || []), ...(cache.embeds || []), ...(cache.frontmatterLinks || [])] : [];
        let hit = false;
        for (const ref of refs) {
          const dest = app.metadataCache.getFirstLinkpathDest(ng11LinkPathOf(ref.link), sourceFile.path);
          if (dest === targetFile) { hit = true; break; }
        }
        if (!hit && node.file) {
          const dest = app.metadataCache.getFirstLinkpathDest(ng11LinkPathOf(node.file), sourceFile.path);
          if (dest === targetFile) hit = true;
        }
        if (hit) result["canvas-" + node.id] = [[0, Math.max(1, (node.text || "").length)]];
      }
      return result;
    }
    const cache = app.metadataCache.getFileCache(sourceFile);
    if (!cache) return null;
    const refs = [...(cache.frontmatterLinks || []), ...(cache.links || []), ...(cache.embeds || [])];
    for (const ref of refs) {
      const path = ng11LinkPathOf(ref.link);
      const dest = app.metadataCache.getFirstLinkpathDest(path, sourceFile.path)
        || app.metadataCache.getFirstLinkpathDest(ng11DropMd(path), sourceFile.path);
      if (dest !== targetFile) continue;
      const pos = ref.position;
      if (pos && typeof pos.start === "object" && typeof pos.start.offset === "number") {
        result.content.push([pos.start.offset, pos.end.offset]);
      } else if (typeof pos === "number") {
        result.content.push([pos, pos + (ref.original || ref.link || "").length]);
      }
    }
    // frontmatter property rows
    for (const fl of cache.frontmatterLinks || []) {
      const path = ng11LinkPathOf(fl.link);
      const dest = app.metadataCache.getFirstLinkpathDest(path, sourceFile.path)
        || app.metadataCache.getFirstLinkpathDest(ng11DropMd(path), sourceFile.path);
      if (dest !== targetFile) continue;
      const entry = { key: fl.key, pos: [0, String(fl.original || fl.link || "").length] };
      if (fl.key && fl.key.includes(".")) entry.subkey = fl.key.split(".").map((p) => /^\d+$/.test(p) ? Number(p) : p);
      result.properties.push(entry);
    }
    return result;
  },

  // ---- unlinked mentions ---------------------------------------------------------------------------
  recomputeUnlinked(file) {
    if (this._unlinkedQueue) this._unlinkedQueue.cancel();
    const host = LPH();
    const app = this.app;
    this.unlinkedFile = file;
    const dom = this.unlinkedDom;
    dom.emptyResults();
    if (this.unlinkedCollapsed || !file || file.extension !== "md") { this.unlinkedSection.flair.setText("0"); return; }
    // alias patterns: basename + frontmatter aliases of the target
    const patterns = [];
    const base = ng11FileName(file).replace(/\.md$/i, "");
    if (base.trim()) patterns.push(base);
    try {
      const cache = app.metadataCache.getFileCache(file);
      const al = cache && cache.frontmatter && cache.frontmatter.aliases;
      const list = Array.isArray(al) ? al : (typeof al === "string" ? al.split(",") : []);
      for (const a of list) { const s = String(a).trim(); if (s) patterns.push(s); }
    } catch (e) { /* no cache */ }
    this.unlinkedAliases = JSON.stringify(patterns);
    const regexes = patterns.map((p) => {
      const src = ng11WholeWordPattern(p, host);
      return src ? new RegExp(src, "gi") : null;
    }).filter(Boolean);
    if (!regexes.length) { this.unlinkedSection.flair.setText("0"); return; }
    const candidates = app.vault.getMarkdownFiles()
      .filter((f) => f !== file && !app.metadataCache.isUserIgnored(f.path));
    candidates.sort((a, b) => ng11SearchSortOrders[dom.sortOrder](a, b));
    const queue = new ng11SearchViewClasses.FileQueue({
      onStart: () => dom.startLoader(),
      onStop: () => { dom.stopLoader(); this.unlinkedSection.flair.setText(String(dom.getMatchCount())); },
    });
    this._unlinkedQueue = queue;
    queue.addList(candidates);
    const self = this;
    (async () => {
      for await (const f of ng11BatchedIteration(queue.generator(), { batchSize: 2 })) {
        if (queue.runnable.isCancelled()) return;
        try {
          const content = await app.vault.cachedRead(f);
          const ranges = self._findUnlinked(content, f, regexes);
          if (ranges.length && self.passSearchFilter(f, content)) {
            const item = dom.addResult(f, { content: ranges }, content, true);
            item.separateMatches = true;
            item.onChildRender = (child) => {
              if (!(child instanceof ng11SearchViewClasses.SearchMatchResult)) return;
              child.onMatchRender = (range, el) => self._addReplaceButton(child, el, f, content);
            };
            item.invalidate();
          } else dom.removeResult(f);
        } catch (e) { /* skip */ }
      }
    })();
  },
  _findUnlinked(content, file, regexes) {
    const app = this.app;
    const cache = app.metadataCache.getFileCache(file);
    const blocked = [];
    if (cache) {
      for (const l of [...(cache.links || []), ...(cache.embeds || [])]) {
        const p = l.position;
        if (p && p.start && typeof p.start.offset === "number") blocked.push([p.start.offset, p.end.offset]);
      }
      const fp = cache.frontmatterPosition;
      if (fp && fp.start && typeof fp.start.offset === "number") blocked.push([fp.start.offset, fp.end.offset]);
    }
    const out = [];
    for (const re of regexes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content))) {
        if (!m[0]) { re.lastIndex++; continue; }
        const s = m.index + (m[1] ? m[0].indexOf(m[1]) : 0);
        const e = s + (m[1] ? m[1].length : m[0].length);
        if (blocked.some(([bs, be]) => s >= bs && e <= be)) continue;
        out.push([s, e]);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
    return out.sort((a, b) => a[0] - b[0]);
  },
  _addReplaceButton(child, el, sourceFile, content) {
    const host = LPH();
    const t = host.t.plugins.backlinks;
    const btn = el.createEl("button", { cls: "search-result-file-match-replace-button", text: t.labelLinkButtonText() });
    btn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const target = this.file;
      if (!target) return;
      const mention = content.substring(child.start, child.end);
      const link = this.app.fileManager.generateMarkdownLink(target, sourceFile.path, "", mention);
      const next = content.slice(0, child.start) + link + content.slice(child.end);
      await this.app.vault.modify(sourceFile, next);
      this.recomputeUnlinked(target);
    });
  },
  onload() {
    const app = this.app;
    this.registerEvent(app.metadataCache.on("resolve", () => {
      if (this.file) { this._pendingFiles.add(this.file); this.requestUpdate(); }
    }));
    this.registerEvent(app.vault.on("create", () => this.recomputeUnlinked(this.file)));
    this.registerEvent(app.vault.on("modify", () => this.recomputeUnlinked(this.file)));
    this.registerEvent(app.vault.on("rename", (f, old) => {
      if (this.file && f === this.file) { this.recomputeBacklink(f); this.recomputeUnlinked(f); }
      else { if (this._backlinkQueue) this._backlinkQueue.add(f); this.recomputeUnlinked(this.file); }
    }));
    this.registerEvent(app.vault.on("delete", (f) => {
      this.backlinkDom.removeResult(f);
      this.unlinkedDom.removeResult(f);
    }));
  },
};

// ---- BacklinkView -------------------------------------------------------------------------------------

function BacklinkView(leaf) {
  const self = LPH().LinkPaneView ? LPH().LinkPaneView.call(this, leaf) || this : null;
  return self;
}

// ---- OutgoingLinkComponent -----------------------------------------------------------------------------

function OutgoingLinkComponent(app, containerEl, scrollParent) {
  const self = LPH().Component.call(this) || this;
  self.app = app;
  self.containerEl = containerEl;
  self.scrollParent = scrollParent || containerEl;
  self.showSearch = false;
  self.outgoingFile = null;
  self.unlinkedFile = null;
  self.linksCollapsed = false;
  self.unlinkedCollapsed = true;
  self.tooltipPlacement = "right";
  self._linksQueue = null;
  self._unlinksQueue = null;
  self.unlinkedDomInfo = new WeakMap();
  self._buildDom();
  self.requestUpdate = debounceCall(() => self.update(), 50);
  return self;
}
const OutgoingLinkComponentProto = {
  _buildDom() {
    const host = LPH();
    const t = host.t.plugins.outgoingLinks;
    const pane = this.containerEl.createDiv("outgoing-link-pane");
    this.paneEl = pane;

    // Links section
    this.linksSection = ng11MakeSection(pane, t.labelLinks(), null, (c) => this.setLinksCollapsed(c, true));
    const linksBody = this.linksSection.body;
    linksBody.addClass("search-result-container");
    this.linksListEl = linksBody.createDiv();
    this.linksChildrenEl = linksBody.createDiv("search-results-children");
    this.linksEl = linksBody;
    this.linksSection.body.show();
    this.linksSection.setCollapsed(this.linksCollapsed, false);

    // Unlinked mentions section
    this.unlinkedSection = ng11MakeSection(pane, t.labelUnlinkedMentions(), null, (c) => this.setUnlinkedCollapsed(c, true));
    this.unlinkedDom = new ng11SearchViewClasses.SearchResults(app, this.unlinkedSection.body.createDiv({ cls: "search-result-container" }), t.labelUnlinkedMentions(), this.scrollParent);
    this.unlinkedSection.body.show();
    this.unlinkedSection.setCollapsed(this.unlinkedCollapsed, false);
  },
  setLinksCollapsed(v, animate) {
    if (this.linksCollapsed === v) return;
    this.linksCollapsed = v;
    this.linksSection.setCollapsed(v, animate);
    if (v) { this._linksQueue && this._linksQueue.cancel(); }
    else this.recomputeLinks(this.file);
    this.app.workspace.requestSaveLayout();
  },
  setUnlinkedCollapsed(v, animate) {
    if (this.unlinkedCollapsed === v) return;
    this.unlinkedCollapsed = v;
    this.unlinkedSection.setCollapsed(v, animate);
    if (v) { this._unlinksQueue && this._unlinksQueue.cancel(); this.unlinkedSection.flair.setText(""); }
    else this.recomputeUnlinked(this.file);
    this.app.workspace.requestSaveLayout();
  },
  getState() {
    return { linksCollapsed: this.linksCollapsed, unlinkedCollapsed: this.unlinkedCollapsed };
  },
  setState(state) {
    if (!state) return;
    if (typeof state.linksCollapsed === "boolean") this.setLinksCollapsed(state.linksCollapsed);
    if (typeof state.unlinkedCollapsed === "boolean") this.setUnlinkedCollapsed(state.unlinkedCollapsed);
  },
  file: null,
  update() {
    const file = this.file;
    if (file !== this._lastFile) {
      this._lastFile = file;
      this.recomputeLinks(file);
      this.recomputeUnlinked(file);
    }
    this._syncCounts();
  },
  onFileOpen(file) { this.file = file; this.requestUpdate(); },
  _syncCounts() {
    this.linksSection.flair.setText(String(this._linkCount || 0));
    this.unlinkedSection.flair.setText(String(this.unlinkedDom ? this.unlinkedDom.getMatchCount() : 0));
  },
  onResize() { this.unlinkedDom.onResize(); },
  onload() {
    const app = this.app;
    this.registerEvent(app.metadataCache.on("resolve", () => { if (this.file) this.requestUpdate(); }));
    this.registerEvent(app.vault.on("delete", () => { this.unlinkedFile = null; this.requestUpdate(); }));
  },

  // ---- resolved outgoing links ---------------------------------------------------------------------
  recomputeLinks(file) {
    if (this._linksQueue) this._linksQueue.cancel();
    const app = this.app;
    this.outgoingFile = file;
    const listEl = this.linksListEl || (this.linksListEl = this.linksSection.body.createDiv());
    listEl.empty();
    this.linksChildrenEl.empty();
    this._linkCount = 0;
    if (this.linksCollapsed || !file || file.extension !== "md") return;
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) return;
    const refs = [];
    for (const r of [...(cache.frontmatterLinks || []), ...(cache.links || []), ...(cache.embeds || [])]) {
      refs.push({ linktext: r.link, pos: r.position && r.position.start ? r.position.start.offset : 0 });
    }
    refs.sort((a, b) => a.pos - b.pos);
    const seen = new Set();
    const items = [];
    for (const ref of refs) {
      const linktext = ref.linktext;
      const path = ng11LinkPathOf(linktext);
      const subpath = ng11LinkSubpathOf(linktext);
      let dest = app.metadataCache.getFirstLinkpathDest(path, file.path);
      if (!dest) dest = app.metadataCache.getFirstLinkpathDest(ng11DropMd(path), file.path);
      const key = (dest ? dest.path : ng11DropMd(path)) + "|" + subpath;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(new OutgoingLinkItem(this, file, linktext, dest, subpath, ref.pos));
    }
    this._linkItems = items;
    for (const item of items) listEl.appendChild(item.el);
    this._linkCount = items.length;
    this.linksSection.flair.setText(String(items.length));
  },

  // ---- unlinked mentions ---------------------------------------------------------------------------
  recomputeUnlinked(file) {
    if (this._unlinksQueue) this._unlinksQueue.cancel();
    const app = this.app;
    this.unlinkedFile = file;
    const dom = this.unlinkedDom;
    if (!dom) return;
    // reset the single SearchFileResult rows
    const host = LPH();
    const t = host.t.plugins.outgoingLinks;
    dom.emptyResults();
    this._mentionRows = [];
    this.unlinkedDomInfo = new WeakMap();
    if (this.unlinkedCollapsed || !file || file.extension !== "md") { this.unlinkedSection.flair.setText("0"); return; }
    // mention map: lowercase mention -> {text, files[]}
    const mentionMap = new Map();
    for (const f of app.vault.getMarkdownFiles()) {
      if (f === file) continue;
      const add = (text) => {
        const key = String(text).trim().toLowerCase();
        if (!key) return;
        if (!mentionMap.has(key)) mentionMap.set(key, { text: String(text).trim(), files: [] });
        const e = mentionMap.get(key);
        if (!e.files.includes(f)) e.files.push(f);
      };
      const base = ng11FileName(f).replace(/\.md$/i, "");
      add(base);
      try {
        const c = app.metadataCache.getFileCache(f);
        const al = c && c.frontmatter && c.frontmatter.aliases;
        const list = Array.isArray(al) ? al : (typeof al === "string" ? al.split(",") : []);
        for (const a of list) add(a);
      } catch (e) { /* no cache */ }
    }
    const mentions = [...mentionMap.values()].sort((a, b) => ng11CompareSearchText(a.text, b.text));
    if (!mentions.length) { this.unlinkedSection.flair.setText("0"); return; }
    let content = "";
    (async () => {
      try { content = await app.vault.cachedRead(file); } catch (e) { return; }
      const cache = app.metadataCache.getFileCache(file);
      const blocked = [];
      if (cache) {
        for (const l of [...(cache.links || []), ...(cache.embeds || [])]) {
          const p = l.position;
          if (p && p.start && typeof p.start.offset === "number") blocked.push([p.start.offset, p.end.offset]);
        }
        const fp = cache.frontmatterPosition;
        if (fp && fp.start && typeof fp.start.offset === "number") blocked.push([fp.start.offset, fp.end.offset]);
      }
      const frontmatterEnd = cache && cache.frontmatterPosition && cache.frontmatterPosition.end
        ? cache.frontmatterPosition.end.offset : 0;
      const rows = [];
      for (const mention of mentions) {
        const src = ng11WholeWordPattern(mention.text, host);
        if (!src) continue;
        const re = new RegExp(src, "gi");
        re.lastIndex = frontmatterEnd;
        let m;
        while ((m = re.exec(content))) {
          if (!m[0]) { re.lastIndex++; continue; }
          const s = m.index + (m[1] ? m[0].indexOf(m[1]) : 0);
          const e = s + (m[1] ? m[1].length : m[0].length);
          if (blocked.some(([bs, be]) => s >= bs && e <= be)) continue;
          rows.push({ start: s, end: e, mention });
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      }
      rows.sort((a, b) => a.start - b.start);
      // one SearchFileResult for the file itself
      const item = dom.addResult(file, { content: [] }, content, false);
      item.separateMatches = true;
      item._rendered = true;
      item.setCollapsible(true);
      for (const row of rows) {
        const child = new ng11SearchViewClasses.SearchMatchResult(item, content, cache, row.start, row.end, [[row.start, row.end]]);
        child.el.addClass("outgoing-unlinked-match");
        this.unlinkedDomInfo.set(child, row);
        child.onMatchRender = (range, el) => this._addDestinationButtons(child, el, row, file, content);
        item.vChildren.addChild(child);
        item.childrenEl.appendChild(child.el);
        child.render();
      }
      this._mentionRows = rows;
      dom.resultDomLookup.set(file.path, item);
      if (item.parentDom && item.parentDom.infinityScroll) item.parentDom.infinityScroll.invalidate(item, true);
      dom._onChange && dom._onChange();
      this.unlinkedSection.flair.setText(String(rows.length));
    })();
  },
  _addDestinationButtons(child, el, row, file, content) {
    const host = LPH();
    const t = host.t.plugins.outgoingLinks;
    const container = el.createDiv("search-result-file-match-destination-file-container");
    const files = row.mention.files.slice().sort((a, b) => ng11CompareSearchText(ng11FileName(a), ng11FileName(b)));
    for (const target of files) {
      const rowEl = container.createDiv("search-result-file-match-destination-file clickable-icon");
      const icon = rowEl.createSpan("search-result-file-match-destination-file-icon");
      host.setIcon(icon, "lucide-link");
      rowEl.createSpan("search-result-file-match-destination-file-name").setText(ng11FileName(target));
      setElementTooltip(rowEl, t.tooltipLinkFile() + " " + target.path);
      rowEl.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        const mention = content.substring(child.start, child.end);
        const link = this.app.fileManager.generateMarkdownLink(target, file.path, "", mention);
        const next = content.slice(0, child.start) + link + content.slice(child.end);
        await this.app.vault.modify(file, next);
        this.recomputeUnlinked(file);
      });
    }
  },
};

// ---- OutgoingLinkItem ----------------------------------------------------------------------------------

function OutgoingLinkItem(component, sourceFile, linktext, dest, subpath, pos) {
  const host = LPH();
  this.component = component;
  this.sourceFile = sourceFile;
  this.linktext = linktext;
  this.dest = dest;
  this.subpath = subpath || "";
  this.pos = pos || 0;
  this.el = createDiv("tree-item-self is-clickable outgoing-link-item");
  this.iconEl = this.el.createDiv("tree-item-icon");
  this.innerEl = this.el.createDiv("tree-item-inner");
  this.labelEl = this.innerEl.createDiv("tree-item-inner-text");
  this.subEl = this.innerEl.createDiv("tree-item-inner-subtext");
  this._render();
  this.el.addEventListener("click", (e) => this.onClick(e));
  this.el.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
  this.el.addEventListener("contextmenu", (e) => this.onContextMenu(e));
  this.el.addEventListener("mouseover", (e) => this.onMouseover(e));
}
methods(OutgoingLinkItem, {
  _render() {
    const host = LPH();
    const t = host.t.plugins.outgoingLinks;
    const app = this.component.app;
    const dest = this.dest;
    let icon = "lucide-link", label = "", sub = "", tooltip = "";
    if (!dest) {
      icon = "lucide-file-plus";
      label = ng11LinkPathOf(this.linktext) || this.linktext;
      tooltip = t.tooltipNotCreated();
    } else {
      const resolved = this._resolveSubpath(dest);
      if (resolved && resolved.type === "heading") {
        icon = "heading-glyph"; label = resolved.text; tooltip = dest.path + this.subpath;
      } else if (resolved && resolved.type === "block") {
        icon = "lucide-layout-list"; label = resolved.text; tooltip = dest.path + this.subpath;
      } else if (resolved && resolved.type === "bad") {
        icon = "lucide-file-question"; label = this.subpath; tooltip = dest.path + this.subpath;
      } else {
        icon = "lucide-link";
        label = ng11FileName(dest);
        const parent = dest.parent && !dest.parent.isRoot() ? dest.parent.path : "";
        sub = parent;
        tooltip = dest.path;
      }
    }
    host.setIcon(this.iconEl, icon);
    this.labelEl.setText(label);
    this.subEl.setText(sub || "");
    this.subEl.toggle(!!sub);
    setElementTooltip(this.el, tooltip);
  },
  _resolveSubpath(dest) {
    const app = this.component.app;
    const sub = this.subpath;
    if (!sub || sub === "#") return null;
    const body = sub.slice(1);
    const cache = app.metadataCache.getFileCache(dest);
    if (!cache) return { type: "bad", text: sub };
    if (body.startsWith("^")) {
      const id = body.slice(1);
      const blocks = cache.blocks || {};
      return blocks[id] ? { type: "block", text: id } : { type: "bad", text: sub };
    }
    const head = body.split("#")[0];
    const norm = (s) => String(s).trim().toLowerCase();
    for (const h of cache.headings || []) {
      if (h.type === "heading" && norm(h.heading) === norm(head)) return { type: "heading", text: h.heading };
    }
    return { type: "bad", text: sub };
  },
  onClick(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    const leaf = this.component.app.workspace.getLeaf(ng11PaneModEvent(event));
    leaf.openLinkText(this.linktext, this.sourceFile.path, {});
  },
  onContextMenu(event) {
    event.preventDefault();
    const host = LPH();
    const app = this.component.app;
    const menu = new host.Menu().addSections(["title", "open", "action", "view", "info", "", "danger"]);
    if (app.workspace.handleLinkContextMenu) app.workspace.handleLinkContextMenu(menu, this.linktext, this.sourceFile.path);
    menu.showAtMouseEvent(event);
  },
  onMouseover(event) {
    const app = this.component.app;
    if (!app.workspace.trigger) return;
    app.workspace.trigger("hover-link", {
      event, source: "search", hoverParent: this.el, targetEl: this.el,
      linktext: this.linktext, sourcePath: this.sourceFile.path, state: {},
    });
  },
});

// ---- OutgoingLinkView ----------------------------------------------------------------------------------

function OutgoingLinkView(leaf) {
  const self = LinkPaneView.call(this, leaf) || this;
  self.navigation = false;
  self.allowNoFile = true;
  self.icon = "links-going-out";
  self.outgoingLink = new OutgoingLinkComponent(self.app, self.contentEl.createDiv("outgoing-link-view-content"), self.contentEl);
  self.requestUpdate = debounceCall(() => self.update(), 50);
  return self;
}

// ---- BacklinkView (real) -------------------------------------------------------------------------------

function BacklinkViewReal(leaf) {
  const self = LinkPaneView.call(this, leaf) || this;
  self.navigation = false;
  self.allowNoFile = true;
  self.icon = "links-coming-in";
  self.backlink = new BacklinkComponent(self.app, self.contentEl, self.contentEl);
  self.requestUpdate = debounceCall(() => self.update(), 10);
  return self;
}

const LinkPaneViewProto = {
    load() {
      LPH().FileView.prototype.load.call(this);
      const app = this.app;
      this.registerEvent(app.workspace.on("file-open", this.onFileOpen, this));
      app.workspace.onLayoutReady(() => this.onFileOpen(app.workspace.getActiveFile()));
    },
    getState() { return LPH().FileView.prototype.getState.call(this); },
    setState(state, result) {
      if (state && !state.group && !this.leaf.pinned) {
        const f = this.app.workspace.getActiveFile();
        if (f) state.file = f.path;
      }
      return LPH().FileView.prototype.setState.call(this, state, result);
    },
    onLoadFile(file) { this.update(); },
    onUnloadFile() { this.requestUpdate(); },
    onFileOpen(file) {
      if (this.leaf.group || this.leaf.pinned) return;
      this.loadFile(file);
    },
    onGroupChange() {
      if (LPH().FileView.prototype.onGroupChange) LPH().FileView.prototype.onGroupChange.call(this);
      const group = this.leaf.group;
      if (group) {
        for (const sibling of group.children) {
          if (sibling !== this.leaf && sibling.view instanceof LPH().FileView && sibling.view.file) {
            this.loadFile(sibling.view.file);
            return;
          }
        }
      }
      this.onFileOpen(this.app.workspace.getActiveFile());
    },
    update() {},
  };

// ---- factories -----------------------------------------------------------------------------------------

export function ng11DefineLinkPaneView(host) {
  ng11EnsurePaneClasses(host);
  if (!LinkPaneView.prototype.load) {
    inherit(LinkPaneView, host.FileView);
    methods(LinkPaneView, LinkPaneViewProto);
  }
  return LinkPaneView;
}

export function ng11DefineBacklinkComponent(host) {
  ng11EnsurePaneClasses(host);
  if (!BacklinkComponent.prototype.update) {
    inherit(BacklinkComponent, host.Component);
    methods(BacklinkComponent, BacklinkComponentProto);
  }
  return BacklinkComponent;
}

export function ng11DefineBacklinkView(host) {
  ng11EnsurePaneClasses(host);
  if (!BacklinkViewReal.prototype.getViewType) {
    inherit(BacklinkViewReal, LinkPaneView);
    methods(BacklinkViewReal, {
      getViewType() { return "backlink"; },
      canAcceptExtension() { return true; },
      getDisplayText() {
        const t = LPH().t.plugins.backlinks;
        const f = this.file;
        if (!f || (LPH().Platform && LPH().Platform.isMobile)) return t.name();
        return t.tabTitle({ displayText: ng11FileName(f) });
      },
      getState() {
        const s = LPH().FileView.prototype.getState.call(this);
        return Object.assign(s, this.backlink ? this.backlink.getState() : {});
      },
      setState(state, result) {
        if (this.backlink) this.backlink.setState(state);
        return LPH().FileView.prototype.setState.call(this, state, result);
      },
      showSearch() {
        if (this.backlink) { this.backlink.setShowSearch(true); this.backlink.searchComponent.inputEl.focus(); }
      },
      update() {
        if (this.leaf && this.leaf.updateHeader) this.leaf.updateHeader();
        if (this.backlink) {
          this.backlink.file = this.file;
          this.backlink.tooltipPlacement = this.getSideTooltipPlacement ? this.getSideTooltipPlacement() : "right";
          this.backlink.update();
        }
      },
      onResize() { if (this.backlink) this.backlink.onResize(); },
    });
  }
  return BacklinkViewReal;
}

export function ng11DefineOutgoingLinkComponent(host) {
  ng11EnsurePaneClasses(host);
  if (!OutgoingLinkComponent.prototype.recomputeLinks) {
    inherit(OutgoingLinkComponent, host.Component);
    methods(OutgoingLinkComponent, OutgoingLinkComponentProto);
  }
  return OutgoingLinkComponent;
}

export function ng11DefineOutgoingLinkView(host) {
  ng11EnsurePaneClasses(host);
  if (!OutgoingLinkView.prototype.getViewType) {
    inherit(OutgoingLinkView, LinkPaneView);
    methods(OutgoingLinkView, {
      getViewType() { return "outgoing-link"; },
      canAcceptExtension() { return true; },
      getDisplayText() {
        const linksT = LPH().t.plugins.outgoingLinks;
        const f = this.file;
        if (!f || (LPH().Platform && LPH().Platform.isMobile)) return linksT.name();
        const displayText = ng11FileName(f);
        return typeof linksT.tabTitle === "function" ? linksT.tabTitle({ displayText }) : linksT.name();
      },
      getState() {
        const s = LPH().FileView.prototype.getState.call(this);
        return Object.assign(s, this.outgoingLink ? this.outgoingLink.getState() : {});
      },
      setState(state, result) {
        if (this.outgoingLink) this.outgoingLink.setState(state);
        return LPH().FileView.prototype.setState.call(this, state, result);
      },
      update() {
        if (this.leaf && this.leaf.updateHeader) this.leaf.updateHeader();
        if (this.outgoingLink) {
          this.outgoingLink.file = this.file;
          this.outgoingLink.tooltipPlacement = this.getSideTooltipPlacement ? this.getSideTooltipPlacement() : "right";
          this.outgoingLink.update();
        }
      },
      onResize() { if (this.outgoingLink) this.outgoingLink.onResize(); },
    });
  }
  return OutgoingLinkView;
}
