// g11 clean-room: the global "search" view — query input with autocomplete, option
// toggles, sort dropdown, virtualised results, incremental queue search, keyboard
// navigation, copy-results modal, explain panel and recent-searches persistence.

import { inherit,methods } from "./inherit.js";
import { env } from "./env.js";
import { debounceCall } from "./timing.js";
import { setElementTooltip } from "./tooltip.js";
import { ng11SearchViewClasses,ng11CompareSearchText,ng11CountSearchMatches,ng11RenderMatchRanges,ng11IndexOfPositionOffset,ng11PreventMiddleClick,ng11ContextLineBounds,ng11SearchSortOrders,ng11SearchSortGroups,ng11SearchSortLabel,ng11SortOrderComparator,ng11ToggleElementVisibility,ng11CopyTextToClipboard,ng11BatchedIteration,ng11DefineFileQueue,ng11RunSearchOverFiles } from "./n-g11-results.js";
import { ng11SearchClasses,ng11TokenizeQuery,ng11TokenEnd,ng11BuildMatcher,ng11DefineSearchOperators,ng11DefineSearchQuery } from "./n-g11-query.js";
import { lastSegment } from "./path.js";

const V = ng11SearchViewClasses;
let ng11ViewHost = null;
function VH() { return ng11ViewHost; }
function ng11SearchStrings() { return VH().t.plugins.search; }

// Contract-name aliases consumed by sibling modules (flat-scope compat).
export const searchViewClasses = ng11SearchViewClasses;
export const compareSearchText = ng11CompareSearchText;
export const countSearchMatches = ng11CountSearchMatches;
export const renderMatchRanges = ng11RenderMatchRanges;
export const indexOfPositionOffset = ng11IndexOfPositionOffset;
export const preventMiddleClick = ng11PreventMiddleClick;
export const contextLineBounds = ng11ContextLineBounds;
export const SEARCH_SORT_ORDERS = ng11SearchSortOrders;
export const SEARCH_SORT_GROUPS = ng11SearchSortGroups;
export const searchSortLabel = ng11SearchSortLabel;
export const sortOrderComparator = ng11SortOrderComparator;
export const toggleElementVisibility = ng11ToggleElementVisibility;
export const batchedIteration = ng11BatchedIteration;
export const runSearchOverFiles = ng11RunSearchOverFiles;
export const copyTextToClipboard = ng11CopyTextToClipboard;
export const defineFileQueue = (host) => ng11DefineFileQueue(host);
export const defineSearchMatchResult = (host) => host && (V.SearchMatchResult = (V.SearchMatchResult || ng11LazyMatchResult(host)));
export const defineSearchPropertyResult = (host) => host && (V.SearchPropertyResult = (V.SearchPropertyResult || ng11LazyPropResult(host)));
export const defineSearchFileResult = (host) => host && (V.SearchFileResult = (V.SearchFileResult || ng11LazyFileResult(host)));
export const defineSearchResults = (host) => ng11DefineSearchResultsView(host);

// resolved lazily through results.js factories (avoid circular init order issues)
import { ng11DefineSearchMatchResult,ng11DefineSearchPropertyResult,ng11DefineSearchFileResult,ng11DefineSearchResults } from "./n-g11-results.js";
function ng11LazyMatchResult(host) { return ng11DefineSearchMatchResult(host); }
function ng11LazyPropResult(host) { return ng11DefineSearchPropertyResult(host); }
function ng11LazyFileResult(host) { return ng11DefineSearchFileResult(host); }
function ng11DefineSearchResultsView(host) { return ng11DefineSearchResults(host); }

// ---- recent searches ----------------------------------------------------------------------------

const NG11_RECENT_KEY = "recent-searches";
const NG11_RECENT_MAX = 20;

function ng11LoadRecentSearches(app) {
  const list = app.loadLocalStorage(NG11_RECENT_KEY);
  return Array.isArray(list) ? list : [];
}

/** Records `query` newest-first, deduped, capped at 20; empty queries are ignored. */
function ng11SaveRecentSearch(app, query) {
  if (!query) return;
  const list = ng11LoadRecentSearches(app);
  const idx = list.indexOf(query);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(query);
  app.saveLocalStorage(NG11_RECENT_KEY, list.slice(0, NG11_RECENT_MAX));
}

// ---- operator suggestion table ---------------------------------------------------------------------

/** The six operator completions shown by SearchSuggest (shared with s27-search). */
export function ng11SearchOperatorSuggestions(host) {
  const t = host.t.plugins.search;
  return [
    { type: "operator", name: "path", token: "path:", infoTextI18n: t.labelPathOptionDescription },
    { type: "operator", name: "file", token: "file:", infoTextI18n: t.labelFileNameOptionDescription },
    { type: "operator", name: "tag", token: "tag:", infoTextI18n: t.labelTagOptionDescription },
    { type: "operator", name: "line", token: "line:()", infoTextI18n: t.labelLineOptionDescription },
    { type: "operator", name: "section", token: "section:()", infoTextI18n: t.labelSectionOptionDescription },
    { type: "operator", name: "property", token: "[]", infoTextI18n: t.labelPropertyOptionDescription },
  ];
}

// ---- SearchSuggest ---------------------------------------------------------------------------------

/** Simple subsequence fuzzy score; higher is better, -1 = no match. */
function ng11FuzzyScore(text, query) {
  const t = String(text).toLowerCase(), q = String(query).toLowerCase();
  if (!q) return 0;
  let ti = 0, score = 0, streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 5 - (found - ti);
    ti = found + 1;
  }
  return score;
}

function SearchSuggest(app, inputEl, showHistory = true) {
  const self = VH().AbstractInputSuggest.call(this, app, inputEl) || this;
  self.inputEl = inputEl;
  self.showHistory = !!showHistory;
  self.suggestEl.addClass("mod-search-suggestion");
  return self;
}

/** Attaches a suggest popup to `inputEl` (desktop search view entry point). */
SearchSuggest.attach = function (app, inputEl, showHistory = true) {
  return new SearchSuggest(app, inputEl, showHistory);
};
SearchSuggest.showOnce = function (app, inputEl, showHistory = true) {
  const s = new SearchSuggest(app, inputEl, showHistory);
  s.onInputChange();
  return s;
};

const SearchSuggestProto = {
  onInputChange() {
    const input = this.textInputEl;
    const caret = input.selectionStart != null ? input.selectionStart : input.value.length;
    const selEnd = input.selectionEnd != null ? input.selectionEnd : caret;
    const value = input.value;
    // only active with collapsed caret at end-of-value or before a space
    const ok = caret === selEnd && (caret === value.length || /\s/.test(value[caret]));
    this._caret = ok ? caret : -1;
    this._value = value;
    if (!ok) { this.close(); return; }
    const result = this.getSuggestions(value);
    if (Array.isArray(result)) this.showSuggestions(result);
  },
  getSuggestions(query) {
    const app = this.app;
    const host = VH();
    const value = this._value != null ? this._value : (this.inputEl ? this.inputEl.value : "");
    const caret = this._caret != null && this._caret >= 0 ? this._caret : value.length;
    const before = value.slice(0, caret);
    const tokens = ng11TokenizeQuery(before);
    let matcher = null;
    try {
      matcher = ng11BuildMatcher(tokens, host.SearchOperators || ng11DefineSearchOperators(host));
    } catch (e) { matcher = null; }
    const ctx = matcher && matcher.getContext ? matcher.getContext(caret) : null;
    const out = [];
    const t = host.t.plugins.search;
    if (ctx) {
      const stack = ctx.matcherStack || [];
      const top = stack[stack.length - 1];
      const C = ng11SearchClasses;
      // deepest context decides the group
      const prop = [...stack].reverse().find((m) => m instanceof C.PropertyMatcher);
      if (prop) {
        const topIdx = stack.indexOf(top);
        const valueIdx = prop.value ? stack.indexOf(prop.value) : -1;
        if (valueIdx >= 0 && topIdx > valueIdx) return out;
        // property key completion
        const needle = ctx.token.type === "bracket" ? "" : ctx.token.content;
        const rawProps = app.metadataTypeManager.getAllProperties();
        const props = (Array.isArray(rawProps) ? rawProps : Object.values(rawProps || {})).map((p) => (p && p.name) || p);
        const scored = [];
        for (const name of props) {
          const s = ng11FuzzyScore(name, needle);
          if (s >= 0) scored.push({ name, score: s });
        }
        scored.sort((a, b) => b.score - a.score || ng11CompareSearchText(a.name, b.name));
        if (scored.length) {
          out.push({ type: "group", heading: t.labelPropertiesGroup(), info: "lucide-info", infoTooltip: t.tooltipReadMore(), clearable: false });
          for (const p of scored.slice(0, 20)) out.push({ type: "property-key", name: p.name });
        }
        return out;
      }
      if (!prop && stack.some((m) => m instanceof C.TagMatcher)) {
        const tags = Object.keys(app.metadataCache.getTags()).sort(ng11CompareSearchText);
        const needle = (ctx.token.type === "text" ? ctx.token.content : "").replace(/^#/, "");
        const scored = [];
        for (const tag of tags) {
          const s = ng11FuzzyScore(tag, needle);
          if (s >= 0) scored.push({ tag, score: s });
        }
        scored.sort((a, b) => b.score - a.score || ng11CompareSearchText(a.tag, b.tag));
        if (scored.length) {
          out.push({ type: "group", heading: t.labelTagsGroup(), info: null });
          for (const p of scored.slice(0, 20)) out.push({ type: "string", name: "#" + p.tag });
        }
        return out;
      }
      if (!prop && stack.some((m) => m instanceof C.PathMatcher)) {
        const files = app.vault.getAllLoadedFiles().filter((f) => !(f instanceof host.TFolder));
        const scored = [];
        for (const f of files) {
          const s = ng11FuzzyScore(f.path, ctx.token.type === "text" ? ctx.token.content : "");
          if (s >= 0) scored.push({ name: f.path, score: s });
        }
        scored.sort((a, b) => b.score - a.score || ng11CompareSearchText(a.name, b.name));
        if (scored.length) {
          for (const p of scored.slice(0, 20)) out.push({ type: "string", name: p.name });
        }
        return out;
      }
      // quote token or deeper context -> nothing
      if (ctx.token.type === "quote" || ctx.token.type === "regex") return out;
    }
    // operator completions
    const prefix = (ctx && ctx.token && ctx.token.type === "text" ? ctx.token.content : before.trim().split(/\s+/).pop() || "").toLowerCase();
    const ops = ng11SearchOperatorSuggestions(host).filter((o) => o.name.startsWith(prefix));
    if (ops.length) {
      out.push({ type: "group", heading: t.labelSearchOptions(), info: null });
      for (const o of ops) out.push(o);
    }
    // history on empty query
    if (this.showHistory && !before.trim()) {
      const recent = ng11LoadRecentSearches(app);
      if (recent.length) {
        out.push({ type: "group", heading: t.labelHistory(), info: "lucide-x", infoTooltip: t.tooltipClearHistory(), clearable: true });
        for (const q of recent.slice(0, 10)) out.push({ type: "history", name: q });
      }
    }
    return out;
  },
  renderSuggestion(item, el) {
    el.empty();
    const host = VH();
    const t = host.t.plugins.search;
    if (item.type === "group") {
      el.addClass("mod-group");
      const title = el.createDiv({ cls: "suggestion-title" });
      title.setText(item.heading);
      if (item.info) {
        const aux = el.createDiv({ cls: "suggestion-aux" });
        const icon = aux.createSpan({ cls: "search-suggest-icon" });
        host.setIcon(icon, item.info);
        if (item.infoTooltip) setElementTooltip(icon, item.infoTooltip);
        if (item.clearable) {
          icon.addEventListener("click", (e) => {
            e.preventDefault(); e.stopPropagation();
            this.app.saveLocalStorage(NG11_RECENT_KEY, null);
            this.close();
          });
        }
      }
      return;
    }
    el.addClass("search-suggest-item");
    const content = el.createDiv({ cls: "suggestion-content" });
    let label = item.name || "";
    if (item.type === "operator") label = item.token;
    if (item.type === "property-key") label = "[" + item.name + "]";
    content.createSpan({ cls: "suggestion-title", text: label });
    if (item.infoTextI18n) {
      const info = content.createSpan({ cls: "search-suggest-info-text" });
      info.setText(typeof item.infoTextI18n === "function" ? item.infoTextI18n() : String(item.infoTextI18n));
    }
  },
  selectSuggestion(item, evt) {
    if (!item || item.type === "group") return false;
    const input = this.inputEl;
    const value = this._value != null ? this._value : input.value;
    const caret = this._caret != null && this._caret >= 0 ? this._caret : value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const host = VH();
    let insert = "";
    let cursor = -1;
    if (item.type === "history") {
      insert = item.name;
    } else if (item.type === "operator") {
      insert = item.token;
      if (/[)\]]$/.test(insert)) cursor = -1;
    } else if (item.type === "property-key") {
      const shift = evt && (evt.shiftKey || (VH().Keymap && VH().Keymap.isModEvent(evt)));
      insert = shift ? '"' + item.name + '"] ' : '"' + item.name + '": ';
    } else {
      // string: replace the token under the caret
      const tokens = ng11TokenizeQuery(before);
      let start = before.length;
      const last = tokens[tokens.length - 1];
      if (last && ["text", "regex", "quote"].includes(last.type) && last.pos + (last.content || "").length >= caret - 1) {
        start = last.pos;
      } else {
        const m = before.match(/([^\s[\](){}:<>"'/]+)$/);
        if (m) start = before.length - m[0].length;
      }
      let text = item.name;
      if (/[\[\]\(\)\s:]/.test(text)) text = '"' + text + '" ';
      insert = before.slice(0, start) + text + after;
      input.value = insert;
      const pos = start + text.length - (after.length ? 0 : 0);
      input.setSelectionRange(pos, pos);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (VH().Platform && VH().Platform.isMobile) this.close();
      return true;
    }
    // generic insertion path (operators/history/property-key)
    const tokens = ng11TokenizeQuery(before);
    const last = tokens[tokens.length - 1];
    let start = before.length;
    if (last && ["text", "regex", "quote"].includes(last.type)) start = last.pos;
    else {
      const m = before.match(/([^\s[\](){}:<>"'/]+)$/);
      if (m) start = before.length - m[0].length;
    }
    const merged = before.slice(0, start) + insert + after;
    input.value = merged;
    const pos = cursor === -1 ? merged.length : start + Math.max(0, insert.length + cursor);
    input.setSelectionRange(pos, pos);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (VH().Platform && VH().Platform.isMobile) this.close();
    return true;
  },
};

// ---- CopyResultsModal -------------------------------------------------------------------------------

function CopyResultsModal(app, results) {
  const self = VH().Modal.call(this, app) || this;
  self.results = results;
  self.options = { showFullPath: false, linkStyle: "none", listStyle: "none" };
  const plugin = app.internalPlugins && app.internalPlugins.getEnabledPluginById("global-search");
  if (plugin && plugin.options) Object.assign(self.options, plugin.options);
  return self;
}
const CopyResultsModalProto = {
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const t = VH().t.plugins.search;
    contentEl.createEl("h2", { text: t.labelCopySearchResults() });
    const box = contentEl.createDiv("copy-search-result-container");
    const ta = box.createEl("textarea", { cls: "copy-search-result-textarea" });
    ta.value = this._buildText();
    ta.rows = 10;
    const t2 = VH().t.plugins.search;
    new (VH().Setting)(contentEl).setName(t2.optionShowPath()).setDesc(t2.optionShowPathDescription()).addToggle((c) => {
      c.setValue(this.options.showFullPath).onChange((v) => { this.options.showFullPath = v; ta.value = this._buildText(); });
    });
    new (VH().Setting)(contentEl).setName(t2.optionLinkStyle()).setDesc(t2.optionLinkStyleDescription()).addDropdown((c) => {
      c.addOption("none", t2.optionChoiceLinkStyleNone())
        .addOption("wikilink", t2.optionChoiceLinkStyleWikilink())
        .addOption("markdown", t2.optionChoiceLinkStyleMarkdownLink())
        .setValue(this.options.linkStyle)
        .onChange((v) => { this.options.linkStyle = v; ta.value = this._buildText(); });
    });
    new (VH().Setting)(contentEl).setName(t2.optionListPrefix()).setDesc(t2.optionListPrefixDescription()).addDropdown((c) => {
      c.addOption("none", t2.optionChoiceListStyleNone())
        .addOption("-", t2.optionChoiceListStyleDash())
        .addOption("*", t2.optionChoiceListStyleAsterisk())
        .addOption("num", t2.optionChoiceListStyleNumbered())
        .setValue(this.options.listStyle)
        .onChange((v) => { this.options.listStyle = v; ta.value = this._buildText(); });
    });
    const btns = contentEl.createDiv("modal-button-container");
    btns.createEl("button", { cls: "mod-cta", text: t2.buttonCopyResults() }).addEventListener("click", async () => {
      await ng11CopyTextToClipboard(ta.value);
      new (VH().Notice)(t2.msgSuccessfullyCopied());
    });
    btns.createEl("button", { text: VH().t.dialogue.buttonDone() }).addEventListener("click", () => this.close());
    this._saveOptions = () => {
      const plugin = this.app.internalPlugins && this.app.internalPlugins.getEnabledPluginById("global-search");
      if (plugin) {
        plugin.options = Object.assign({}, plugin.options, this.options);
        plugin.saveData(plugin.options);
      }
    };
  },
  onClose() { this.contentEl.empty(); if (this._saveOptions) this._saveOptions(); },
  _buildText() {
    const files = this.results.getFiles();
    const lines = [];
    let n = 0;
    for (const file of files) {
      let name = this.options.showFullPath ? file.path : (file.getShortName ? file.getShortName() : file.name);
      if (this.options.linkStyle === "wikilink") name = "[[" + name + "]]";
      else if (this.options.linkStyle === "markdown") name = "[" + (file.basename || file.name) + "](" + file.path + ")";
      let prefix = "";
      if (this.options.listStyle === "-") prefix = "- ";
      else if (this.options.listStyle === "*") prefix = "* ";
      else if (this.options.listStyle === "num") prefix = ++n + ". ";
      lines.push(prefix + name);
    }
    return lines.join("\n");
  },
};

// ---- SearchQueueComponent -----------------------------------------------------------------------------

function SearchQueueComponent(app, dom) {
  const self = VH().Component.call(this) || this;
  self.app = app;
  self.dom = dom;
  self.queue = null;
  return self;
}
const SearchQueueComponentProto = {
  onload() {
    const app = this.app;
    this.registerEvent(app.vault.on("create", (f) => {
      if (f.extension !== "md" && this.queue) this.queue.add(f);
    }));
    this.registerEvent(app.vault.on("modify", (f) => {
      if (f.extension !== "md" && this.queue) this.queue.add(f);
    }));
    this.registerEvent(app.vault.on("rename", (f) => { if (this.queue && !this.queue.items.includes(f)) this.queue.add(f); }));
    this.registerEvent(app.metadataCache.on("changed", (f) => { if (this.queue && !this.queue.items.includes(f)) this.queue.add(f); }));
    this.registerEvent(app.vault.on("delete", (f) => {
      if (this.queue) this.queue.remove(f);
      if (this.dom && this.dom.removeResult) this.dom.removeResult(f);
    }));
  },
  onunload() { this.stop(); },
  start(options = {}) {
    this.stop();
    const app = this.app;
    const queue = new V.FileQueue({
      onStart: () => { if (this.dom) this.dom.startLoader(); },
      onStop: () => {
        if (this.dom) this.dom.stopLoader();
        if (options.onStop) options.onStop();
      },
      onCancel: () => {
        this.queue = null;
        if (options.onCancel) options.onCancel();
      },
    });
    this.queue = queue;
    const files = app.vault.getFiles().slice();
    const cmp = ng11SortOrderComparator(this.dom ? this.dom.sortOrder : "alphabetical");
    files.sort(cmp);
    queue.addList(files);
    return queue;
  },
  stop() {
    if (this.queue) { this.queue.cancel(); }
    this.queue = null;
  },
};

// ---- SearchView --------------------------------------------------------------------------------------

function SearchView(leaf) {
  const app = leaf.app;
  const self = VH().View.call(this, leaf) || this;
  self.icon = "lucide-search";
  self.matchingCase = false;
  self.explainSearch = false;
  self.collapseAll = false;
  self.extraContext = false;
  self.sortOrder = "alphabetical";
  self.query = "";
  self._searchRunning = false;
  self._saveSearchQueued = debounceCall(() => self.saveSearch(), 5000);
  self._restartSearch = debounceCall(() => self.startSearch(), 0);

  const containerEl = self.containerEl;
  self.dom = new V.SearchResults(app, containerEl.createDiv({ cls: "search-result-container mod-global-search" }), ng11SearchStrings().labelNoMatches(), containerEl);

  const row = containerEl.createDiv("search-row");
  self.searchComponent = new (VH().SearchComponent)(row);
  self.searchComponent.inputEl.addClass("global-search-input-container");
  setElementTooltip(self.searchComponent.inputEl, ng11SearchStrings().promptStartSearch());
  self.searchComponent.setPlaceholder(ng11SearchStrings().promptStartSearch());
  self.caseButtonEl = row.createDiv("clickable-icon");
  VH().setIcon(self.caseButtonEl, "uppercase-lowercase-a");
  setElementTooltip(self.caseButtonEl, ng11SearchStrings().labelMatchCase());
  self.caseButtonEl.addEventListener("click", () => self.setMatchingCase(!self.matchingCase));
  self.searchComponent.onChange(() => {
    self.dom.setFocusedItem(null);
    self.stopSearch();
    const v = self.searchComponent.getValue();
    if (v) self._restartSearch();
    else { self.startSearch(); self.searchInfoContainerEl.hide(); }
  });
  self.searchComponent.inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      self.startSearch();
      if (VH().Platform && VH().Platform.isMobile && !VH().Platform.hasPhysicalKeyboard) VH().blurAndClearSelection();
    }
  });
  if (VH().Platform && VH().Platform.isMobile) {
    const suggestBtn = row.createDiv("clickable-icon search-input-suggest-button");
    VH().setIcon(suggestBtn, "right-triangle");
    suggestBtn.addEventListener("click", () => SearchSuggest.showOnce(app, self.searchComponent.inputEl, true));
  }

  self.searchInfoContainerEl = containerEl.createDiv("search-info-container");
  self.searchInfoContainerEl.hide();

  self.filterSectionToggleEl = containerEl.createDiv("clickable-icon");
  VH().setIcon(self.filterSectionToggleEl, "lucide-sliders-horizontal");
  setElementTooltip(self.filterSectionToggleEl, ng11SearchStrings().labelToggleSearchSettings());
  self.searchParamsEl = containerEl.createDiv("search-params");
  self.searchParamsEl.hide();
  self.filterSectionToggleEl.addEventListener("click", () => {
    const show = self.searchParamsEl.hasClass("is-active") ? false : true;
    self.searchParamsEl.toggleClass("is-active", show);
    self.filterSectionToggleEl.toggleClass("is-active", show);
    ng11ToggleElementVisibility(self.searchParamsEl, !show, true);
  });
  self._addToggleSetting(self.searchParamsEl, ng11SearchStrings().labelCollapseResults(), () => self.collapseAll, (v) => self.setCollapseAll(v));
  self._addToggleSetting(self.searchParamsEl, ng11SearchStrings().labelMoreContext(), () => self.extraContext, (v) => self.setExtraContext(v));
  self._addToggleSetting(self.searchParamsEl, ng11SearchStrings().labelExplainSearchTerm(), () => self.explainSearch, (v) => self.setExplainSearch(v));

  self.resultsInfoEl = containerEl.createDiv("search-results-info");
  self.resultsInfoEl.hide();
  self.resultCountEl = self.resultsInfoEl.createDiv("search-results-result-count clickable-icon");
  const countSpan = self.resultCountEl.createSpan();
  self.resultCountTextEl = countSpan;
  const moreIcon = self.resultCountEl.createSpan("more-options-icon");
  VH().setIcon(moreIcon, "lucide-more-horizontal");
  moreIcon.addEventListener("click", (e) => self.onResultCountMenu(e));

  self.sortDropdownEl = self.resultsInfoEl.createDiv();
  const sortDD = new (VH().DropdownComponent)(self.sortDropdownEl);
  for (const group of ng11SearchSortGroups) {
    for (const key of group) sortDD.addOption(key, ng11SearchSortLabel(key));
  }
  sortDD.setValue(self.sortOrder).onChange((v) => self.setSortOrder(v));

  self.queueComponent = new V.SearchQueueComponent ? new V.SearchQueueComponent(app, self.dom) : null;
  self.scope = new (VH().Scope)(app.scope);
  self.scope.register([], "Enter", self.onActivateKey.bind(self));
  self.scope.register([], "ArrowDown", self.onArrowDown.bind(self));
  self.scope.register([], "ArrowUp", self.onArrowUp.bind(self));
  self.scope.register([], "ArrowLeft", self.onArrowLeft.bind(self));
  self.scope.register([], "ArrowRight", self.onArrowRight.bind(self));
  self.scope.register(["Shift"], "ArrowUp", self.onShiftArrowUp.bind(self));
  self.scope.register(["Shift"], "ArrowDown", self.onShiftArrowDown.bind(self));
  app.keymap.pushScope(self.scope);
  self.register(() => app.keymap.popScope(self.scope));

  if (!(VH().Platform && VH().Platform.isMobile)) {
    V.SearchSuggest = V.SearchSuggest || SearchSuggest;
    SearchSuggest.attach(app, self.searchComponent.inputEl, true);
  }
  return self;
}
const SearchViewProto = {
  _addToggleSetting(parent, name, get, set) {
    const setting = new (VH().Setting)(parent).setName(name);
    setting.controlEl.addClass("mod-toggle");
    setting.addToggle((c) => c.setValue(get()).onChange((v) => set(v)));
  },
  onOpen() {
    VH().View.prototype.onOpen.call(this);
    this.app.workspace.onLayoutReady(() => {});
    this.containerEl.ownerDocument && null;
    const leaf = this.leaf;
    if (leaf && leaf.tabHeaderEl) {
      leaf.tabHeaderEl.addEventListener("click", () => this.searchComponent.autoSelect && this.searchComponent.autoSelect());
    }
  },
  getViewType() { return "search"; },
  getDisplayText() { return ng11SearchStrings().name(); },
  getQuery() { return this.query; },
  setQuery(query) {
    this.query = query || "";
    this.searchComponent.setValue(this.query);
    this.startSearch();
  },
  getState() {
    const state = VH().View.prototype.getState.call(this);
    state.query = this.query;
    state.matchingCase = this.matchingCase;
    state.explainSearch = this.explainSearch;
    state.collapseAll = this.collapseAll;
    state.extraContext = this.extraContext;
    state.sortOrder = this.sortOrder;
    return state;
  },
  setState(state, result) {
    if (typeof state.query === "string" || state.query === null) {
      this.query = state.query || "";
      if (this.searchComponent) this.searchComponent.setValue(this.query);
    }
    if (typeof state.matchingCase === "boolean") this.matchingCase = state.matchingCase;
    if (typeof state.explainSearch === "boolean") this.explainSearch = state.explainSearch;
    if (typeof state.collapseAll === "boolean") this.collapseAll = state.collapseAll;
    if (typeof state.extraContext === "boolean") this.extraContext = state.extraContext;
    if (state.sortOrder && ng11SearchSortOrders[state.sortOrder]) this.sortOrder = state.sortOrder;
    if (this.dom) {
      this.dom.sortOrder = this.sortOrder;
      this.dom.collapseAll = this.collapseAll;
      this.dom.extraContext = this.extraContext;
    }
    if (this.caseButtonEl) this.caseButtonEl.toggleClass("is-active", this.matchingCase);
    return VH().View.prototype.setState.call(this, state, result);
  },
  setEphemeralState(state) {
    if (state && state.focus && this.searchComponent) {
      this.searchComponent.inputEl.focus();
      this.searchComponent.inputEl.select();
    }
    return VH().View.prototype.setEphemeralState ? VH().View.prototype.setEphemeralState.call(this, state) : state;
  },
  saveSearch() {
    ng11SaveRecentSearch(this.app, this.query);
  },
  setMatchingCase(v) {
    if (this.matchingCase === v) return;
    this.matchingCase = v;
    this.caseButtonEl.toggleClass("is-active", v);
    this.requestSaveLayout();
    if (this.query) this.startSearch();
  },
  setExplainSearch(v) {
    if (this.explainSearch === v) return;
    this.explainSearch = v;
    this.requestSaveLayout();
    if (this.query) this.startSearch();
  },
  setCollapseAll(v) {
    if (this.collapseAll === v) return;
    this.collapseAll = v;
    if (this.dom) this.dom.setCollapseAll(v);
    this.requestSaveLayout();
  },
  setExtraContext(v) {
    if (this.extraContext === v) return;
    this.extraContext = v;
    if (this.dom) this.dom.setExtraContext(v);
    this.requestSaveLayout();
  },
  setSortOrder(order) {
    if (!ng11SearchSortOrders[order] || this.sortOrder === order) return;
    this.sortOrder = order;
    if (this.dom) { this.dom.sortOrder = order; this.dom.changed(); }
    this.requestSaveLayout();
  },
  requestSaveLayout() { this.app.workspace.requestSaveLayout(); },

  startSearch() {
    this.stopSearch();
    this.dom.emptyResults();
    this.dom.setFocusedItem(null);
    const value = this.searchComponent ? this.searchComponent.getValue() : this.query;
    this.query = value;
    this.searchInfoContainerEl.empty();
    if (!value || !value.trim()) {
      this.resultsInfoEl.hide();
      this.searchInfoContainerEl.hide();
      return;
    }
    let sq = null;
    try {
      sq = new ng11SearchClasses.SearchQuery(this.app, value, this.matchingCase);
    } catch (err) {
      console.log(err);
      const info = this.searchInfoContainerEl.createDiv("search-info");
      info.setText(err.message || String(err));
      this.searchInfoContainerEl.show();
      this.requestSaveLayout();
      this._saveSearchQueued();
      return;
    }
    if (!sq.matcher) { this.resultsInfoEl.hide(); this._saveSearchQueued(); return; }
    if (this.explainSearch) this.renderSearchInfo(sq.matcher, this.searchInfoContainerEl);
    else this.searchInfoContainerEl.empty();
    this.searchInfoContainerEl.show();
    this.resultsInfoEl.show();
    const C = V;
    if (!this.queueComponent) this.queueComponent = new C.SearchQueueComponent(this.app, this.dom);
    const queue = this.queueComponent.start({
      onStop: () => {
        const count = this.dom.getMatchCount();
        this.resultCountTextEl.setText(ng11SearchStrings().labelResultCount({ count }));
      },
    });
    const requiredInputs = sq.requiredInputs;
    let files;
    try {
      files = this.app.vault.getFiles().filter((f) => !this.app.metadataCache.isUserIgnored(f.path));
    } catch (e) { files = []; }
    const self = this;
    this._searchRunning = true;
    (async () => {
      try {
        await ng11RunSearchOverFiles(this.app, requiredInputs, queue, async (file, content) => {
          const result = sq.match(file, content);
          if (result && ng11CountSearchMatches(result) > 0) {
            this.dom.addResult(file, result, content, true);
          } else {
            this.dom.removeResult(file);
          }
        }, {
          batchSize: 10,
          beforePause: async () => {
            const count = this.dom.getMatchCount();
            this.resultCountTextEl.setText(ng11SearchStrings().labelResultCount({ count }));
          },
        });
      } catch (e) { console.log(e); }
      finally {
        this._searchRunning = false;
        const count = this.dom.getMatchCount();
        this.resultCountTextEl.setText(ng11SearchStrings().labelResultCount({ count }));
        this.requestSaveLayout();
        this._saveSearchQueued();
      }
    })();
  },
  stopSearch() {
    if (this.queueComponent) this.queueComponent.stop();
    this._searchRunning = false;
    this.searchInfoContainerEl.empty();
  },
  renderSearchInfo(matcher, el) {
    el.empty();
    const render = (m, parent) => {
      const row = parent.createDiv("search-info");
      row.setText(m.getInfo ? m.getInfo() : "");
      const C = ng11SearchClasses;
      const kids = [];
      if (m instanceof C.MultiMatcher || (m.matcher && !(m instanceof C.PropertyMatcher))) kids.push(m.matcher);
      if (m instanceof C.MultiMatcher) kids.push(...m.matchers);
      if (m instanceof C.PropertyMatcher) {
        const keyRow = row.createDiv("search-info-children");
        keyRow.setText("Key:");
        if (m.key) render(m.key, keyRow);
        if (m.value) {
          const valRow = row.createDiv("search-info-children");
          valRow.setText("Value:");
          render(m.value, valRow);
        }
        return;
      }
      if (kids.length) {
        const childBox = row.createDiv("search-info-children");
        for (const k of kids) render(k, childBox);
      }
    };
    render(matcher, el);
  },
  onResultCountMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const menu = new (VH().Menu)().addSections(["action"]);
    this.app.workspace.trigger("search:results-menu", menu, this);
    menu.addItem((item) => item
      .setIcon("lucide-copy")
      .setTitle(ng11SearchStrings().labelCopySearchResults())
      .onClick(() => this.onCopyResultsClick()));
    menu.showAtMouseEvent(event);
  },
  onCopyResultsClick() {
    new V.CopyResultsModal(this.app, this.dom).open();
  },
  onActivateKey() {
    const item = this.dom.focusedItem;
    if (!item) return;
    const evt = { button: 0, preventDefault() {}, defaultPrevented: false };
    if (item.onResultClick) item.onResultClick(evt);
  },
  _arrowSkip(event) {
    return !!(event.defaultPrevented || (this.searchComponent && document.activeElement === this.searchComponent.inputEl));
  },
  onArrowDown(event) {
    if (this._arrowSkip(event)) return;
    VH().blurAndClearSelection();
    this.dom.changeFocusedItem("forwards");
  },
  onArrowUp(event) {
    if (this._arrowSkip(event)) return;
    this.dom.changeFocusedItem("backwards");
  },
  onArrowLeft(event) {
    if (this._arrowSkip(event)) return;
    const item = this.dom.focusedItem;
    if (item && item.file) {
      if (item.collapsed) item.setCollapse(false, true);
      else if (this.dom.vChildren.children.length) this.dom.setCollapseAll(true);
    } else this.dom.setCollapseAll(true);
  },
  onArrowRight(event) {
    if (this._arrowSkip(event)) return;
    const item = this.dom.focusedItem;
    if (item && item.file) {
      if (item.collapsed) item.setCollapse(false, true);
      else if (item.vChildren && item.vChildren.hasChildren && item.vChildren.hasChildren()) item.setCollapse(false, true);
    }
  },
  onShiftArrowUp(event) {
    if (this._arrowSkip(event)) return;
    const item = this.dom.focusedItem;
    if (item && item.showMoreBefore) item.showMoreBefore();
  },
  onShiftArrowDown(event) {
    if (this._arrowSkip(event)) return;
    const item = this.dom.focusedItem;
    if (item && item.showMoreAfter) item.showMoreAfter();
  },
  onResize() { this.dom.onResize(); },
};

// ---- factories ---------------------------------------------------------------------------------------

export function ng11DefineCopyResultsModal(host) {
  ng11ViewHost = host;
  if (!CopyResultsModal.prototype.onOpen) {
    inherit(CopyResultsModal, host.Modal);
    methods(CopyResultsModal, CopyResultsModalProto);
  }
  V.CopyResultsModal = CopyResultsModal;
  return CopyResultsModal;
}
export function ng11DefineSearchQueueComponent(host) {
  ng11ViewHost = host;
  if (!SearchQueueComponent.prototype.onload) {
    inherit(SearchQueueComponent, host.Component);
    methods(SearchQueueComponent, SearchQueueComponentProto);
  }
  V.SearchQueueComponent = SearchQueueComponent;
  V.FileQueue = V.FileQueue || ng11DefineFileQueue(host);
  return SearchQueueComponent;
}
export function ng11DefineSearchSuggest(host) {
  ng11ViewHost = host;
  if (!SearchSuggest.prototype.getSuggestions) {
    inherit(SearchSuggest, host.AbstractInputSuggest);
    methods(SearchSuggest, SearchSuggestProto);
    SearchSuggest.prototype.onChooseSuggestion = SearchSuggest.prototype.selectSuggestion;
  }
  V.SearchSuggest = SearchSuggest;
  return SearchSuggest;
}
export function ng11DefineSearchView(host) {
  ng11ViewHost = host;
  inherit(SearchView, host.View);
  methods(SearchView, SearchViewProto);
  ng11EnsureViewClasses(host);
  V.SearchView = SearchView;
  return SearchView;
}
function ng11EnsureViewClasses(host) {
  ng11ViewHost = host;
  ng11DefineSearchMatchResult(host); ng11DefineSearchPropertyResult(host); ng11DefineSearchFileResult(host); ng11DefineSearchResults(host);
  ng11DefineFileQueue(host);
  ng11DefineSearchQuery(host);
  ng11DefineSearchQueueComponent(host);
  ng11DefineCopyResultsModal(host);
  ng11DefineSearchSuggest(host);
}

// Contract-name aliases for class factories (manifest `use` names).
export const defineSearchView = (host) => ng11DefineSearchView(host);
export const defineSearchQueueComponent = (host) => ng11DefineSearchQueueComponent(host);
export const defineCopyResultsModal = (host) => ng11DefineCopyResultsModal(host);
export const defineSearchSuggest = (host) => ng11DefineSearchSuggest(host);
export const searchOperatorSuggestions = ng11SearchOperatorSuggestions;
