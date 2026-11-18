// Slice s28 — the web viewer chrome: the address bar with its history/bookmark suggest,
// the find-in-page bar and the page-title-to-file-name helper.
//
// Replaces the bundle items HJ, zJ, qJ and VJ. The WebViewerView/P2 plugin itself belongs to
// another slice; these classes are the pieces it instantiates.

import { env } from "./env.js";
import { normalizePath } from "./path.js";
import { s05AssertValidFileName } from "./s05-utils.js";
import { containsAllWords } from "./search-simple.js";
import { matchScore } from "./search.js";
import { renderMatches } from "./search-simple.js";

// Classes produced by the factories below; the address bar reaches the suggest through here
// (its own bundle position precedes the suggest's, so the class may not exist yet at factory time).
const s28Web = {};

// host is passed to every factory; s28WVHost is bound by the first one that runs (all share it).
let s28WVHost = null;
function s28WVBindHost(host) {
  s28WVHost = host;
  return host;
}

const webViewerStrings = () => s28WVHost.t.plugins.webViewer;

/** `VJ` — turns a web page title into a usable note name, "Untitled" when nothing valid remains. */
export function s28TitleToFileName(title) {
  const cleaned = normalizePath(title.replace(/[?*]/g, "").replace(/[\\/:]/g, " - "));
  try {
    s05AssertValidFileName(cleaned);
  } catch (error) {
    return "Untitled";
  }
  return cleaned;
}

// =====================================================================================================================
// The address-bar suggest (zJ): history + bookmark + "search for" completions under the URL input.
// =====================================================================================================================

export function s28WebViewerAddressSuggest(host) {
  s28WVBindHost(host);
  const SuggestBase = env().SI;

  class WebViewerAddressSuggest extends SuggestBase {
    constructor(webview, inputEl) {
      super(webview.app, inputEl);
      this.webview = webview;
      this.inputEl = inputEl;
      this.scope.register([], "Escape", () => this.close());
    }

    selectSuggestion(suggestion) {
      this.inputEl.blur();
      this.webview.navigate(suggestion.url, true);
      this.close();
    }

    async getSuggestions(query) {
      const rawQuery = query;
      query = query.toLowerCase();
      const words = [query];
      const seen = {};
      seen["about:blank"] = { url: "about:blank", title: "Blank", type: "about" };

      const history = await this.webview.plugin.db.getHistoryItems();
      for (const item of history) {
        if (!seen[item.url]) seen[item.url] = { url: item.url, title: item.title, type: "history" };
      }

      const bookmarksPlugin = this.app.internalPlugins.getEnabledPluginById("bookmarks");
      if (bookmarksPlugin) {
        const urlBookmarks = bookmarksPlugin.getBookmarks().filter((item) => item.type === "url");
        for (const bookmark of urlBookmarks) {
          seen[bookmark.url] = { url: bookmark.url, title: bookmark.title, type: "bookmark" };
        }
      }

      const suggestions = [];
      let exactUrl = false;
      for (const entry of Object.values(seen)) {
        const suggestion = { title: entry.title, url: entry.url, type: entry.type, score: 0, matches: null };
        if (query !== "") {
          if (entry.url.toLowerCase() === query) exactUrl = true;
          const haystack = (entry.title + " " + entry.url).toLowerCase();
          const ranges = containsAllWords(words, haystack);
          if (ranges) {
            suggestion.matches = ranges;
            suggestion.score = matchScore(ranges, query.length, haystack.length, 0);
            suggestions.push(suggestion);
          }
        } else {
          suggestions.push(suggestion);
        }
      }

      if (exactUrl || query === "") return suggestions;
      if (query.startsWith("http://") || query.startsWith("https://")) {
        suggestions.unshift({ title: "", url: rawQuery, score: 100, matches: null, type: "typed" });
        return suggestions;
      }
      const host = /([^\/?#]+)/.exec(query)[0];
      const dot = host.lastIndexOf(".");
      if (dot !== -1 && dot !== host.length - 1) {
        suggestions.unshift({ title: "", url: "https://" + rawQuery, score: 100, matches: null, type: "typed" });
        return suggestions;
      }
      suggestions.unshift({
        title: webViewerStrings().actionSearchForQuery({ query: rawQuery }),
        url: this.webview.plugin.getSearchEngineUrl(rawQuery),
        score: 100,
        matches: null,
        type: "search",
      });
      return suggestions;
    }

    renderSuggestion(suggestion, el) {
      const self = this;
      el.addClass("mod-complex", "webviewer-addressbar-suggestion");
      const icon = el.createDiv("suggestion-icon");
      const content = el.createDiv("suggestion-content");
      const aux = el.createDiv("suggestion-aux");
      if (suggestion.type === "search") {
        icon.createSpan({ cls: "suggestion-flair-left" }, (flair) => s28WVHost.setIcon(flair, "lucide-search"));
      } else if (suggestion.type === "history" || suggestion.type === "bookmark") {
        icon.createSpan({ cls: "suggestion-flair-left" }, (flair) => self.webview.plugin.db.setIcon(flair, suggestion.url));
      }
      if (suggestion.type === "bookmark") {
        aux.createSpan({ cls: "suggestion-flair" }, (flair) => s28WVHost.setIcon(flair, "lucide-bookmark"));
      }
      renderMatches(content.createDiv("suggestion-title"), suggestion.title, suggestion.matches);
      if (suggestion.type !== "search") {
        renderMatches(content.createDiv("suggestion-url"), suggestion.url, suggestion.matches, -(suggestion.title.length + 1));
      }
    }

    reposition(targetRect) {
      super.reposition(targetRect);
      const width = (targetRect.right - targetRect.left).toString() + "px";
      this.suggestEl.style.width = width;
      this.suggestEl.style.maxWidth = width;
    }
  }

  s28Web.AddressSuggest = WebViewerAddressSuggest;
  return WebViewerAddressSuggest;
}

// =====================================================================================================================
// The address bar (HJ): URL input + the suggest, Escape restores the previous value.
// =====================================================================================================================

export function s28WebViewerAddressBar(host) {
  s28WVBindHost(host);

  class WebViewerAddressBar {
    constructor(webview, containerEl) {
      const self = this;
      containerEl.addClass("webviewer-address-container");
      const row = containerEl.createDiv("webviewer-address");
      this.addrInputEl = row.createEl("input", { type: "text" });
      this.addrInputEl.setAttr("spellcheck", false);
      const SuggestClass = s28Web.AddressSuggest || s28WebViewerAddressSuggest(host);
      this.suggest = new SuggestClass(webview, this.addrInputEl);
      let previousValue = "";
      this.addrInputEl.addEventListener("focus", () => {
        containerEl.win.setTimeout(() => self.addrInputEl.select(), 100);
        previousValue = self.addrInputEl.value;
        self.suggest.open();
      });
      this.addrInputEl.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          self.addrInputEl.blur();
          self.addrInputEl.value = previousValue;
        }
      });
    }

    setValue(value) {
      this.addrInputEl.value = value || "";
    }

    focus() {
      this.addrInputEl.focus();
    }
  }

  return WebViewerAddressBar;
}

// =====================================================================================================================
// The find-in-page bar (qJ): wraps the shared document-search bar for Electron's found-in-page events.
// =====================================================================================================================

export function s28WebViewerFindBar(host) {
  s28WVBindHost(host);
  const SearchBarBase = env().vj;

  class WebViewerFindBar extends SearchBarBase {
    constructor(webview, containerEl, applyScope) {
      super(containerEl);
      this.foundInPageHandler = this._foundInPageHandler.bind(this);
      this.webview = webview;
      this.applyScope = applyScope;
    }

    findPrevious() {
      const query = this.getQuery();
      if (query) this.webview.findInPage(query, { findNext: false, forward: false });
      else this.webview.stopFindInPage("clearSelection");
    }

    findNext() {
      const wrapped = this.currentResult === this.numResults;
      const query = this.getQuery();
      if (query) this.webview.findInPage(query, { findNext: wrapped });
      else this.webview.stopFindInPage("clearSelection");
    }

    findNextOrReplace() {
      this.findNext();
    }

    onSearchInput() {
      const query = this.getQuery();
      if (query) this.webview.findInPage(query, { findNext: true });
    }

    show() {
      const containerEl = this.containerEl;
      const searchContainerEl = this.searchContainerEl;
      const searchInputEl = this.searchInputEl;
      containerEl.prepend(searchContainerEl);
      host.selectOnFocus(searchInputEl);
      this.applyScope(this.scope);
      this.onSearchInput();
      this.webview.addEventListener("found-in-page", this.foundInPageHandler);
    }

    hide() {
      this.webview.stopFindInPage("clearSelection");
      this.searchContainerEl.detach();
      this.applyScope(null);
      this.webview.removeEventListener("found-in-page", this.foundInPageHandler);
    }

    _foundInPageHandler(event) {
      if (event.result.finalUpdate) {
        this.numResults = event.result.matches;
        this.currentResult = event.result.activeMatchOrdinal;
      }
    }
  }

  return WebViewerFindBar;
}
