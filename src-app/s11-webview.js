// Web viewer chrome: the address bar with history/bookmark suggestions
// (original: HJ + zJ) and the find-in-page bar (original: qJ). The suggestion
// and find-in-page base classes (SI, vj) stay app-scope via env().
import { env } from "./env.js";
import { s11Inherit } from "./s11-media.js";
import { s11WebViewerStrings } from "./s11-i18n.js";

// Address bar shown in the web viewer title area (original: HJ).
export function s11WebviewAddressBar(host) {
  function WebviewAddressBar(webview, containerEl) {
    containerEl.addClass("webviewer-address-container");
    const row = containerEl.createDiv("webviewer-address");
    const input = (this.addrInputEl = row.createEl("input", { type: "text" }));
    input.setAttr("spellcheck", false);
    this.suggest = new S11WebviewSuggest(webview, input);
    let saved = "";
    input.addEventListener("focus", () => {
      containerEl.win.setTimeout(() => input.select(), 100);
      saved = input.value;
      this.suggest.open();
    });
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        input.blur();
        input.value = saved;
      }
    });
  }
  const proto = WebviewAddressBar.prototype;
  proto.setValue = function (value) { this.addrInputEl.value = value || ""; };
  proto.focus = function () { this.addrInputEl.focus(); };
  return WebviewAddressBar;
}

let S11WebviewSuggest = null, S11WebviewFindBar = null;

// Suggestion provider for the address bar (original: zJ; extends SI).
export function s11WebviewSuggest(host) {
  function WebviewSuggest(webview, inputEl) {
    const self = env().SI.call(this, webview.app, inputEl) || this;
    self.webview = webview;
    self.inputEl = inputEl;
    self.scope.register([], "Escape", () => self.close());
    return self;
  }
  s11Inherit(WebviewSuggest, env().SI);
  const proto = WebviewSuggest.prototype;
  proto.selectSuggestion = function (suggestion) {
    this.inputEl.blur();
    this.webview.navigate(suggestion.url, true);
    this.close();
  };
  proto.getSuggestions = async function (input) {
    const original = input;
    input = input.toLowerCase();
    const needles = [input];
    const items = {};
    items["about:blank"] = { url: "about:blank", title: "Blank", type: "about" };
    const history = await this.webview.plugin.db.getHistoryItems();
    for (const item of history) {
      if (!items[item.url]) items[item.url] = { url: item.url, title: item.title, type: "history" };
    }
    const bookmarksPlugin = this.app.internalPlugins.getEnabledPluginById("bookmarks");
    if (bookmarksPlugin) {
      const urlBookmarks = bookmarksPlugin.getBookmarks().filter((b) => b.type === "url");
      for (const bookmark of urlBookmarks) {
        items[bookmark.url] = { url: bookmark.url, title: bookmark.title, type: "bookmark" };
      }
    }
    const results = [];
    let typed = false;
    for (const item of Object.values(items)) {
      const suggestion = { title: item.title, url: item.url, type: item.type, score: 0, matches: null };
      if (input !== "") {
        if (item.url.toLowerCase() === input) typed = true;
        const haystack = `${item.title} ${item.url}`.toLowerCase();
        const matches = env().Ly(needles, haystack);
        if (matches) {
          suggestion.matches = matches;
          suggestion.score = env().xy(matches, input.length, haystack.length, 0);
          results.push(suggestion);
        }
      } else {
        results.push(suggestion);
      }
    }
    if (typed || input === "") return results;
    const hostMatch = /([^\/?#]+)/.exec(original)[0];
    const dot = hostMatch.lastIndexOf(".");
    if (dot !== -1 && dot !== hostMatch.length - 1) {
      results.unshift({ title: "", url: "https://" + original, score: 100, matches: null, type: "typed" });
      return results;
    }
    results.unshift({
      title: s11WebViewerStrings().actionSearchForQuery({ query: original }),
      url: this.webview.plugin.getSearchEngineUrl(original),
      score: 100, matches: null, type: "search",
    });
    return results;
  };
  proto.renderSuggestion = function (suggestion, el) {
    el.addClass("mod-complex");
    el.addClass("webviewer-addressbar-suggestion");
    const icon = el.createDiv("suggestion-icon");
    const content = el.createDiv("suggestion-content");
    const aux = el.createDiv("suggestion-aux");
    if (suggestion.type === "search") {
      icon.createSpan({ cls: "suggestion-flair-left" }, (span) => host.setIcon(span, "lucide-search"));
    } else if (suggestion.type === "history" || suggestion.type === "bookmark") {
      icon.createSpan({ cls: "suggestion-flair-left" }, (span) => this.webview.plugin.db.setIcon(span, suggestion.url));
    }
    if (suggestion.type === "bookmark") {
      aux.createSpan({ cls: "suggestion-flair" }, (span) => host.setIcon(span, "lucide-bookmark"));
    }
    env().Ny(content.createDiv("suggestion-title"), suggestion.title, suggestion.matches);
    if (suggestion.type !== "search") {
      env().Ny(content.createDiv("suggestion-url"), suggestion.url, suggestion.matches, -(suggestion.title.length + 1));
    }
  };
  proto.reposition = function (rect) {
    env().SI.prototype.reposition.call(this, rect);
    const width = (rect.right - rect.left).toString() + "px";
    this.suggestEl.style.width = width;
    this.suggestEl.style.maxWidth = width;
  };
  S11WebviewSuggest = WebviewSuggest;
  return WebviewSuggest;
}

// Find-in-page bar for the web viewer (original: qJ; extends vj).
export function s11WebviewFindBar(host) {
  function WebviewFindBar(webview, containerEl, applyScope) {
    const self = env().vj.call(this, containerEl) || this;
    self.foundInPageHandler = self._foundInPageHandler.bind(self);
    self.webview = webview;
    self.applyScope = applyScope;
    return self;
  }
  s11Inherit(WebviewFindBar, env().vj);
  const proto = WebviewFindBar.prototype;
  proto.findPrevious = function () {
    const query = this.getQuery();
    if (query) this.webview.findInPage(query, { findNext: false, forward: false });
    else this.webview.stopFindInPage("clearSelection");
  };
  proto.findNext = function () {
    const last = this.currentResult === this.numResults;
    const query = this.getQuery();
    if (query) this.webview.findInPage(query, { findNext: last });
    else this.webview.stopFindInPage("clearSelection");
  };
  proto.findNextOrReplace = function () { this.findNext(); };
  proto.onSearchInput = function () {
    const query = this.getQuery();
    if (query) this.webview.findInPage(query, { findNext: true });
  };
  proto.show = function () {
    const containerEl = this.containerEl, searchContainerEl = this.searchContainerEl, searchInputEl = this.searchInputEl;
    containerEl.prepend(searchContainerEl);
    env().Pv(searchInputEl);
    this.applyScope(this.scope);
    this.onSearchInput();
    this.webview.addEventListener("found-in-page", this.foundInPageHandler);
  };
  proto.hide = function () {
    this.webview.stopFindInPage("clearSelection");
    this.searchContainerEl.detach();
    this.applyScope(null);
    this.webview.removeEventListener("found-in-page", this.foundInPageHandler);
  };
  proto._foundInPageHandler = function (evt) {
    if (evt.result.finalUpdate) {
      this.numResults = evt.result.matches;
      this.currentResult = evt.result.activeMatchOrdinal;
    }
  };
  S11WebviewFindBar = WebviewFindBar;
  return WebviewFindBar;
}
