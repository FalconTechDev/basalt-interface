// n-g14-community.js — clean-room replacement for the community browser modules
// (spec g14 §3.1). Architecture: ONE generic CommunityBrowserModal driven by a
// per-kind descriptor table (plugin | theme), with search/sort/filter/row-render
// as small functions over an item array, plus the DonateModal and withButtonLoading.
// Frozen contract: DOM classes, i18n paths, localStorage keys, feed URLs, sort
// semantics, modal behaviour.
//
// Flat shared scope: ng14-prefixed helpers; host values read lazily via `host`.

import { env, hostEnv } from "./env.js";
import { inherit } from "./inherit.js";
import { containsAllWords, renderMatches } from "./search-simple.js";
import { s05CommunityPlugins, s05CommunityPluginStats } from "./s05-cli.js";
import { s04CommunityThemes } from "./s04-themes.js";
import { isOlderVersion } from "./text.js";

const ng14CE = () => hostEnv();
const ng14SortCollator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });

/** Adds `mod-loading` to `el` while `fn` runs; resolves with fn's result (spec §2.1). */
export async function withButtonLoading(el, fn) {
  el.addClass("mod-loading");
  try {
    return await fn();
  } finally {
    el.removeClass("mod-loading");
  }
}

// ---------------------------------------------------------------------------
// Shared feed/version helpers
// ---------------------------------------------------------------------------

/** Feed URL for a repo file at HEAD (raw.githubusercontent.com). */
function ng14RawUrl(repo, file) {
  return "https://raw.githubusercontent.com/" + repo + "/HEAD/" + file;
}

function ng14ReleaseUrl(repo, tag, file) {
  return "https://github.com/" + repo + "/releases/download/" + tag + "/" + file;
}

/** JSON GET through the app request helper; throws on failure. */
async function ng14FetchJson(url) {
  const res = await ng14CE().cy({ url, method: "GET" });
  return await res.json;
}

async function ng14FetchText(url) {
  const res = await ng14CE().cy({ url, method: "GET" });
  return await res.text;
}

/**
 * Effective installable version for a remote manifest (spec §3.1): the manifest
 * version, or — when the running app is older than minAppVersion — the numerically
 * greatest versions.json key the app satisfies. null when none / fetch fails.
 */
async function ng14PickCompatibleVersion(repo, manifest) {
  const appVersion = ng14CE().gte;
  if (!appVersion || !manifest.minAppVersion || !isOlderVersion(appVersion, manifest.minAppVersion)) {
    return manifest.version || null;
  }
  let versions;
  try {
    versions = await ng14FetchJson(ng14RawUrl(repo, "versions.json"));
  } catch (err) {
    return null;
  }
  if (!versions || typeof versions !== "object") return null;
  let best = null;
  for (const key of Object.keys(versions)) {
    const requirement = versions[key];
    if (!requirement) continue;
    if (isOlderVersion(appVersion, requirement)) continue;
    if (best && !isOlderVersion(best, key)) continue;
    best = key;
  }
  return best;
}

// ---------------------------------------------------------------------------
// CommunityBrowserModal — the shared shell
// ---------------------------------------------------------------------------

export function defineCommunityModal(host) {
  /**
   * Base browser modal. `descriptor` (set by subclasses) supplies:
   *   kind, storageKey, title(), placeholder(), sortOptions[], defaultSort,
   *   addCustomControls(setting), extraToggle(s), loadItems(), filterItems(),
   *   sortItems(), renderRow(item, el), showItem(item).
   */
  function CommunityBrowserModal(app) {
    const self = host.Modal.call(this, app) || this;
    const d = self.descriptor = self.kindDescriptor();
    self.items = [];
    self.visibleItems = [];
    self.query = "";
    self.queryWords = [];
    self.sortOrder = localStorage.getItem(d.storageKey) || d.defaultSort;
    self.selectedItemId = null;
    self.detailOpen = false;
    self.detailsLoading = false;
    self.feedError = null;
    self.closeCallback = null;
    self.autoOpenId = null;

    self.modalEl.addClass("mod-community-modal", "mod-sidebar-layout", d.modalClass);
    const sidebar = (self.sidebarEl = self.modalEl.createDiv("modal-sidebar"));
    const controls = (self.controlsEl = sidebar.createDiv("community-modal-controls"));
    self.searchEl = null;
    new host.Setting(controls)
      .setName("")
      .setDesc("")
      .addSearch((search) => {
        self.searchEl = search;
        search.setPlaceholder(d.placeholder());
        search.inputEl.addEventListener("input", self.onSearchInput.bind(self));
        search.inputEl.addEventListener("keydown", (event) => {
          if (!event.isComposing && event.key === "Enter" && !host.Platform.hasPhysicalKeyboard) {
            event.preventDefault();
            host.blurAndClearSelection();
          }
        });
      });
    // sort button
    new host.Setting(controls)
      .setName("")
      .setDesc("")
      .addButton((button) => {
        self.sortButtonEl = button.buttonEl;
        button.setIcon("lucide-sort-asc");
        button.setTooltip(host.t.plugins.fileExplorer.actionChangeSort());
        button.buttonEl.addClass("clickable-icon");
        button.onClick((event) => self.showSortMenu(event));
      });
    d.addCustomControls(self, controls);
    self.summaryEl = controls.createDiv("community-modal-search-summary u-muted");
    const wrapper = sidebar.createDiv("community-modal-search-results-wrapper");
    self.emptyStateEl = wrapper.createDiv("community-modal-empty-state");
    self.statusEl = wrapper.createDiv("community-modal-search-results-status");
    self.resultsEl = wrapper.createDiv("community-modal-search-results");
    // detail pane lives next to the sidebar inside the modal element
    self.infoEl = self.modalEl.createDiv("community-modal-detail");
    self.infoEl.hide();
    return self;
  }
  inherit(CommunityBrowserModal, host.Modal);
  const proto = CommunityBrowserModal.prototype;

  proto.kindDescriptor = function () {
    throw new Error("kindDescriptor not implemented");
  };

  proto.setCloseCallback = function (cb) {
    this.closeCallback = cb;
    return this;
  };

  /** Stores the id to auto-open once items load; chainable. */
  proto.setAutoOpen = function (id) {
    this.selectedItemId = id;
    this.autoOpenId = id;
    return this;
  };

  // ------------------------------------------------------------- search/sort

  proto.onSearchInput = function () {
    const self = this;
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      self.query = self.searchEl ? self.searchEl.getValue() : "";
      self.queryWords = self.query.toLowerCase().split(/\s+/).filter(Boolean);
      self.update();
    }, 300);
  };

  proto.showSortMenu = function (event) {
    event.preventDefault();
    const button = this.sortButtonEl;
    if (button.hasClass("has-active-menu")) return;
    const d = this.descriptor;
    const menu = new host.Menu();
    for (const key of d.sortOptions) {
      menu.addItem((item) => item
        .setTitle(d.sortLabel(key))
        .setChecked(key === this.sortOrder)
        .onClick(() => {
          this.sortOrder = key;
          localStorage.setItem(d.storageKey, key);
          this.update();
        }));
    }
    menu.setParentElement(button).showAtMouseEvent(event);
  };

  /** Stable sort per spec §3.1: release reverses feed order, update by parsed
   *  timestamp desc, alphabetical via Intl.Collator, else downloads desc. */
  proto.sortItems = function (items) {
    const order = this.sortOrder;
    const d = this.descriptor;
    if (d.customSort) return d.customSort(items, order);
    if (order === "release") {
      // release order = feed order reversed in place (NOT a date sort)
      return items.slice().reverse();
    }
    const decorated = items.map((item, index) => ({ item, index }));
    const cmp = (a, b) => {
      let r = 0;
      if (order === "update") {
        r = (b.item.updated || 0) - (a.item.updated || 0);
      } else if (order === "alphabetical") {
        r = ng14SortCollator.compare(a.item.name || "", b.item.name || "");
      } else {
        r = (b.item.downloads || 0) - (a.item.downloads || 0);
      }
      return r !== 0 ? r : a.index - b.index;
    };
    decorated.sort(cmp);
    return decorated.map((entry) => entry.item);
  };

  /** Applies installed-only/mode/query filters, then sorts; theme moves Default first. */
  proto.updateItems = function () {
    const d = this.descriptor;
    let items = this.items.slice();
    items = d.filterItems(this, items);
    items = this.sortItems(items);
    if (d.moveDefaultFirst) items = d.moveDefaultFirst(items);
    this.visibleItems = items;
    return items;
  };

  // --------------------------------------------------------------- rendering

  /** Renders the visible rows; first `syncCount` sync, rest via idle batching. */
  proto.update = function () {
    const results = this.resultsEl;
    results.empty();
    const items = this.updateItems();
    const d = this.descriptor;
    if (items.length === 0) {
      results.createDiv("community-item", (el) => {
        el.setText(host.t.setting.thirdPartyPlugin.labelNoResultsFound());
      });
    } else {
      const renderRow = (item) => {
        const el = results.createDiv("community-item");
        d.renderRow(this, item, el);
        el.addEventListener("click", () => this.selectItem(d.itemId(item)));
        return el;
      };
      const SYNC = 20;
      const BATCH = 10;
      for (let i = 0; i < Math.min(SYNC, items.length); i++) renderRow(items[i]);
      let index = SYNC;
      let lastPause = performance.now();
      const step = () => {
        if (index >= items.length) return;
        // pause when the user is not near the bottom of the results list
        const nearBottom = results.scrollTop + results.clientHeight >= results.scrollHeight - results.clientHeight / 2;
        if (!nearBottom) {
          results.addEventListener("scroll", step, { once: true });
          return;
        }
        const end = Math.min(index + BATCH, items.length);
        for (; index < end; index++) renderRow(items[index]);
        if (performance.now() - lastPause > 5) {
          lastPause = performance.now();
          schedule(step);
        } else {
          schedule(step);
        }
      };
      schedule(step);
    }
    this.updateSummary(items.length);
  };

  function schedule(fn) {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => fn(), { timeout: 100 });
    } else {
      setTimeout(fn, 0);
    }
  }

  proto.updateSummary = function (count) {
    const d = this.descriptor;
    this.summaryEl.setText(d.summaryText(this, count));
  };

  // ------------------------------------------------------------------ detail

  proto.selectItem = function (id) {
    if (this.detailsLoading) return;
    const item = this.visibleItems.find((entry) => this.descriptor.itemId(entry) === id) ||
      this.items.find((entry) => this.descriptor.itemId(entry) === id);
    if (!item) return;
    this.selectedItemId = id;
    this.detailOpen = true;
    this.infoEl.empty();
    this.infoEl.show();
    this.sidebarEl.addClass("is-hidden-detail");
    this.renderDetail(item);
    host.registerOpenModal(this.detailHandle());
    if (host.Platform.isPhone) {
      // slide the detail pane over the sidebar
      this.infoEl.addClass("is-open");
    } else {
      this.renderNavBar();
    }
  };

  proto.detailHandle = function () {
    const self = this;
    return { close: () => self.returnToGridView() };
  };

  proto.renderNavBar = function () {
    let bar = this.infoEl.find(".modal-setting-nav-bar");
    if (!bar) {
      bar = this.infoEl.createDiv("modal-setting-nav-bar");
      const back = bar.createDiv("clickable-icon", (el) => host.setIcon(el, "lucide-chevron-left"));
      host.setTooltip(back, host.t.interface.startScreen.buttonBack());
      back.addEventListener("click", () => this.returnToGridView());
    }
  };

  proto.renderDetail = async function (item) {
    const self = this;
    const d = this.descriptor;
    this.detailsLoading = true;
    this.infoEl.addClass("is-loading");
    try {
      const detail = await d.loadDetail(this, item);
      this.infoEl.removeClass("is-loading");
      if (!detail) return;
      d.renderDetail(this, item, detail);
      this.scrollIntoView(idOf(this, item));
    } catch (err) {
      console.error(err);
    } finally {
      this.detailsLoading = false;
    }
  };

  function idOf(self, item) {
    return self.descriptor.itemId(item);
  }

  proto.returnToGridView = function () {
    if (!this.detailOpen) return;
    this.detailOpen = false;
    this.selectedItemId = null;
    host.unregisterOpenModal(this._detailHandle || (this._detailHandle = this.detailHandle()));
    this.infoEl.hide();
    this.infoEl.removeClass("is-open");
    this.sidebarEl.removeClass("is-hidden-detail");
    const back = this.modalEl.find(".modal-setting-back-button");
    if (back) back.detach();
  };

  proto.scrollIntoView = function (id) {
    if (host.Platform.isPhone) return;
    const row = this.resultsEl.find(".community-item.is-selected");
    if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  // ------------------------------------------------------------------ lifecycle

  proto.onOpen = function () {
    const self = this;
    host.Modal.prototype.onOpen.call(this);
    this.setTitle(this.descriptor.title());
    this.emptyStateEl.hide();
    this.statusEl.empty();
    this.resultsEl.addClass("is-loading");
    this.loadAndRender().then(() => {
      this.resultsEl.removeClass("is-loading");
      if (this.autoOpenId) {
        const id = this.autoOpenId;
        this.autoOpenId = null;
        // re-select once the list exists
        setTimeout(() => {
          if (this.visibleItems.some((entry) => this.descriptor.itemId(entry) === id)) {
            this.selectItem(id);
          }
        }, 0);
      }
    });
  };

  proto.loadAndRender = async function () {
    try {
      await this.descriptor.loadItems(this);
      this.feedError = null;
      this.statusEl.empty();
      this.emptyStateEl.hide();
      this.update();
    } catch (err) {
      this.feedError = err;
      this.showError(err);
    }
  };

  proto.showError = function (err) {
    const t = host.t.setting.thirdPartyPlugin;
    this.resultsEl.empty();
    this.statusEl.empty();
    const message = err && err.message ? err.message : String(err);
    this.statusEl.createDiv({ cls: "community-modal-search-results-status", text: message });
    const cta = this.statusEl.createDiv("community-modal-search-results-cta");
    const button = cta.createEl("button", { cls: "mod-cta", text: host.t.dialogue.buttonView ? host.t.dialogue.buttonView() : "Retry" });
    button.addEventListener("click", () => {
      withButtonLoading(button, async () => {
        this.resultsEl.addClass("is-loading");
        try {
          await this.loadAndRender();
        } finally {
          this.resultsEl.removeClass("is-loading");
        }
      });
    });
  };

  proto.onClose = function () {
    host.Modal.prototype.onClose.call(this);
    const d = this.descriptor;
    if (d.storageKey) localStorage.setItem(d.storageKey, this.sortOrder);
    if (this.detailOpen) this.returnToGridView();
    if (this.closeCallback) this.closeCallback.call(this);
  };

  proto.onEscapeKey = function (event) {
    if (this.detailOpen) {
      event.preventDefault();
      this.returnToGridView();
      return;
    }
    host.Modal.prototype.onEscapeKey.call(this, event);
  };

  return CommunityBrowserModal;
}

// ---------------------------------------------------------------------------
// Plugin browser descriptor + modal
// ---------------------------------------------------------------------------

const ng14PluginSortOptions = ["download", "update", "release", "alphabetical"];

function ng14PluginSortLabel(host, key) {
  const t = host.t.setting.thirdPartyPlugin;
  switch (key) {
    case "update": return host.t.setting.thirdPartyPlugin.labelByUpdated();
    case "release": return host.t.setting.thirdPartyPlugin.labelByReleased();
    case "alphabetical": return host.t.setting.thirdPartyPlugin.labelAlphabetical();
    default: return host.t.setting.thirdPartyPlugin.labelByPopularity();
  }
}

export function definePluginBrowserModal(host) {
  const Base = defineCommunityModal(host);

  function PluginBrowserModal(app) {
    const self = Base.call(this, app) || this;
    return self;
  }
  inherit(PluginBrowserModal, Base);
  const proto = PluginBrowserModal.prototype;

  proto.kindDescriptor = function () {
    return {
      kind: "plugin",
      storageKey: "communityPluginSortOrder",
      defaultSort: "download",
      modalClass: "mod-community-plugin",
      sortOptions: ng14PluginSortOptions,
      sortLabel: (key) => ng14PluginSortLabel(host, key),
      title: () => host.t.setting.thirdPartyPlugin.name(),
      placeholder: () => host.t.setting.thirdPartyPlugin.placeholderCommunityPlugins(),
      summaryText: (self, count) =>
        host.t.setting.thirdPartyPlugin.labelSearchSummary({
          pluginCount: host.t.nouns.pluginWithCount({ count }),
        }),
      itemId: (item) => item.id,
      addCustomControls: (self, controls) => {
        new host.Setting(controls)
          .setName(host.t.setting.thirdPartyPlugin.labelInstalled())
          .setDesc("")
          .addToggle((toggle) => {
            self.installedOnlyEl = toggle.toggleEl;
            toggle.setValue(!!self.installedOnly);
            toggle.onChange((value) => {
              self.installedOnly = value;
              self.update();
            });
          });
      },
      filterItems: (self, items) => {
        let out = items;
        if (self.installedOnly) {
          const manifests = self.app.plugins ? self.app.plugins.manifests : {};
          out = out.filter((item) => manifests[item.id]);
        }
        if (self.queryWords.length > 0) {
          out = out.filter((item) => {
            const haystack = ((item.name || "") + " " + (item.author || "") + " " + (item.description || "")).toLowerCase();
            const ranges = containsAllWords(self.queryWords, haystack);
            if (ranges) {
              item.matchScore = ranges;
              return true;
            }
            item.matchScore = null;
            return false;
          });
        }
        return out;
      },
      renderRow: (self, item, el) => {
        el.addClass("community-item-plugin");
        const nameEl = el.createDiv("community-item-name");
        renderMatches(nameEl, item.name || "", item.matchScore);
        if (self.app.plugins && self.app.plugins.manifests && self.app.plugins.manifests[item.id]) {
          nameEl.createSpan({ cls: "flair mod-pop", text: host.t.setting.thirdPartyPlugin.labelInstalled() });
        }
        const author = item.author || "";
        if (author) {
          el.createDiv("community-item-author u-muted", (div) => {
            div.appendText(host.t.setting.thirdPartyPlugin.labelByAuthor() + " ");
            renderMatches(div.createSpan(), author, item.matchScore);
          });
        }
        const desc = (item.description || "").slice(0, 200);
        if (desc) {
          el.createDiv("community-item-desc u-muted", (div) => renderMatches(div, desc, item.matchScore));
        }
        if (item.downloads > 0) {
          el.createDiv("community-item-downloads u-muted", (div) => {
            const icon = div.createSpan({ cls: "community-item-downloads-icon" });
            host.setIcon(icon, "lucide-download-cloud");
            div.appendText(" " + item.downloads.toLocaleString());
          });
        }
        if (item.updated) {
          el.createDiv("community-item-updated u-muted", (div) => {
            div.setText(host.t.setting.thirdPartyPlugin.labelLastUpdated({ time: window.moment(item.updated).fromNow() }));
          });
        }
      },
      loadItems: async (self) => {
        const t = host.t.setting.thirdPartyPlugin;
        let feed;
        try {
          feed = await s05CommunityPlugins();
        } catch (err) {
          throw new Error(host.t.setting.thirdPartyPlugin.msgFailedLoadPlugins());
        }
        if (!Array.isArray(feed)) throw new Error(host.t.setting.thirdPartyPlugin.msgFailedLoadPlugins());
        // stats degrade to zero on failure, never block the list
        let stats = {};
        try {
          const raw = await s05CommunityPluginStats();
          if (raw && typeof raw === "object") stats = raw;
        } catch (err) {}
        self.items = [];
        for (const entry of feed) {
          if (!entry || !entry.id || !entry.name || !entry.repo) continue;
          const stat = stats[entry.id] || {};
          self.items.push({
            ...entry,
            downloads: stat.downloads || 0,
            updated: stat.updated || 0,
            matchScore: null,
          });
        }
        // auto-open id missing from the feed -> pre-fill search with spaced words
        if (self.autoOpenId && !self.items.some((item) => item.id === self.autoOpenId)) {
          const words = self.autoOpenId.replace(/-/g, " ");
          if (self.searchEl) {
            self.searchEl.setValue(words);
            self.query = words;
            self.queryWords = words.toLowerCase().split(/\s+/).filter(Boolean);
          }
        }
      },
      loadDetail: async (self, item) => {
        const t = host.t.setting.thirdPartyPlugin;
        let manifest;
        try {
          manifest = await ng14FetchJson(ng14RawUrl(item.repo, "manifest.json"));
        } catch (err) {
          new host.Notice(host.t.setting.thirdPartyPlugin.msgFailedToLoadManifest());
          return null;
        }
        if (!manifest || manifest.id !== item.id) {
          new host.Notice("Plugin ID mismatch.");
          return null;
        }
        const compatible = await ng14PickCompatibleVersion(item.repo, manifest);
        const version = compatible || manifest.version;
        return { manifest, version, compatible, item };
      },
      renderDetail: (self, item, detail) => {
        renderPluginDetail(host, self, item, detail);
      },
    };
  }
  return PluginBrowserModal;
}

// ---------------------------------------------------------------------------
// Plugin detail pane
// ---------------------------------------------------------------------------

function ng14DetailMetaRow(host, info, cls, build) {
  const row = info.createDiv("community-modal-info-" + cls);
  build(row);
  return row;
}

function renderPluginDetail(host, self, item, detail) {
  const t = host.t.setting.thirdPartyPlugin;
  const app = self.app;
  const { manifest, version, compatible, item: feed } = detail;
  const info = self.infoEl.createDiv("community-modal-info");
  const meta = info.createDiv("community-modal-meta");
  const installed = app.plugins && app.plugins.manifests ? app.plugins.manifests[item.id] : null;
  const plugin = app.plugins && app.plugins.getPlugin ? app.plugins.getPlugin(item.id) : null;

  // name + installed flair
  const nameRow = meta.createDiv("community-modal-info-name");
  nameRow.appendText(item.name || manifest.name || item.id);
  if (installed) nameRow.createSpan({ cls: "flair mod-pop", text: host.t.setting.thirdPartyPlugin.labelInstalled() });

  if (item.downloads > 0) {
    ng14DetailMetaRow(host, meta, "downloads", (row) => {
      const icon = row.createSpan();
      host.setIcon(icon, "lucide-download-cloud");
      row.appendText(" " + item.downloads.toLocaleString());
    });
  }
  // version
  ng14DetailMetaRow(host, meta, "version", (row) => {
    row.appendText(host.t.setting.thirdPartyPlugin.labelVersion({ version: version || "?" }));
    if (installed && installed.version) {
      row.appendText(" " + host.t.setting.thirdPartyPlugin.labelCurrentlyInstalledVersion({ version: installed.version }));
    }
  });
  // author
  const author = manifest.author || item.author || "";
  if (author) {
    ng14DetailMetaRow(host, meta, "author", (row) => {
      row.appendText(host.t.setting.thirdPartyPlugin.labelByAuthor() + " ");
      if (manifest.authorUrl) {
        row.createEl("a", { cls: "external-link", text: author, attr: { href: manifest.authorUrl } });
      } else {
        row.appendText(author);
      }
    });
  }
  // repository
  ng14DetailMetaRow(host, meta, "repo", (row) => {
    row.appendText(host.t.setting.thirdPartyPlugin.labelRepository() + " ");
    row.createEl("a", { cls: "external-link", text: item.repo, attr: { href: "https://github.com/" + item.repo } });
  });
  // last update
  if (item.updated) {
    ng14DetailMetaRow(host, meta, "repo", (row) => {
      row.appendText(host.t.setting.thirdPartyPlugin.labelLastUpdated({ time: window.moment(item.updated).fromNow() }));
      host.setTooltip(row, host.t.setting.thirdPartyPlugin.tooltipViewLastUpdate());
      const link = row.createEl("a", { cls: "external-link", attr: { href: "https://github.com/" + item.repo + "/releases/latest" } });
      link.hide();
    });
  }
  if (manifest.description || item.description) {
    meta.createDiv("community-modal-info-desc u-muted", (div) => div.setText(manifest.description || item.description));
  }
  if (manifest.isDesktopOnly && !host.Platform.isDesktopApp) {
    meta.createDiv("mod-warning u-muted", (div) => div.setText(host.t.setting.thirdPartyPlugin.labelUnsupported()));
  }

  // buttons
  const buttons = meta.createDiv("community-modal-button-container");
  const isInstalled = !!installed;
  const isLoaded = !!plugin;
  const updateAvailable = isInstalled && version && isOlderVersion(installed.version, version);

  const installButton = buttons.createEl("button", {
    cls: "mod-cta" + (updateAvailable ? "" : ""),
    text: updateAvailable ? host.t.setting.thirdPartyPlugin.buttonUpdate() : host.t.setting.thirdPartyPlugin.buttonInstall ? host.t.setting.thirdPartyPlugin.buttonInstall() : "Install",
  });
  if (!updateAvailable && isInstalled) installButton.hide();
  installButton.addEventListener("click", () => {
    if (manifest.isDesktopOnly && !host.Platform.isDesktopApp) {
      new host.Notice(host.t.setting.thirdPartyPlugin.labelUnsupported());
      return;
    }
    if (!compatible && !version) {
      new host.Notice("No appropriate version found.");
      return;
    }
    const tag = compatible || manifest.version;
    withButtonLoading(installButton, async () => {
      await app.plugins.installPlugin(item.repo, tag, manifest);
      self.update();
      self.selectItem(item.id);
    });
  });

  if (isLoaded) {
    // Options: only when a settings tab with this id exists
    const hasTab = app.setting && app.setting.pluginTabs && app.setting.pluginTabs.some((tab) => tab.id === manifest.id);
    if (hasTab) {
      buttons.createEl("button", { text: host.t.setting.options() }).addEventListener("click", () => {
        self.close();
        app.setting.open();
        app.setting.openTabById(manifest.id);
      });
    }
    // Hotkeys: only when a command id starts with "<id>:"
    const hasCommands = app.commands && app.commands.commands && Object.keys(app.commands.commands).some((id) => id.startsWith(item.id + ":"));
    if (hasCommands) {
      buttons.createEl("button", { text: host.t.setting.hotkeys.name() }).addEventListener("click", () => {
        self.close();
        app.setting.open();
        const tab = app.setting.openTabById("hotkeys");
        if (tab && tab.setQuery) tab.setQuery(manifest.id);
      });
    }
    // Enable / Disable
    const disableBtn = buttons.createEl("button", {
      cls: isLoaded ? "mod-destructive" : "",
      text: isLoaded ? host.t.setting.thirdPartyPlugin.buttonDisable() : host.t.setting.thirdPartyPlugin.buttonEnable(),
    });
    disableBtn.addEventListener("click", async () => {
      if (isLoaded) await app.plugins.disablePluginAndSave(item.id);
      else await app.plugins.enablePluginAndSave(item.id);
      self.selectItem(item.id);
    });
    // Uninstall
    const uninstall = buttons.createEl("button", { cls: "mod-destructive", text: host.t.setting.thirdPartyPlugin.labelUninstall() });
    uninstall.addEventListener("click", async () => {
      await app.plugins.uninstallPlugin(item.id);
      self.update();
      self.selectItem(item.id);
    });
  } else if (isInstalled) {
    const uninstall = buttons.createEl("button", { cls: "mod-destructive", text: host.t.setting.thirdPartyPlugin.labelUninstall() });
    uninstall.addEventListener("click", async () => {
      await app.plugins.uninstallPlugin(item.id);
      self.update();
      self.selectItem(item.id);
    });
  }

  // share link
  buttons.createEl("button", { text: host.t.setting.thirdPartyPlugin.buttonCopyShareLink() }).addEventListener("click", () => {
    const url = "basalt://show-plugin?id=" + encodeURIComponent(item.id);
    navigator.clipboard.writeText(url).then(() => new host.Notice(host.t.interface.copied()));
  });
  // donate
  const fundingUrl = manifest.fundingUrl || item.fundingUrl;
  if (fundingUrl) {
    buttons.createEl("button", { text: host.t.setting.thirdPartyPlugin.buttonDonate() }).addEventListener("click", () => {
      new (defineDonateModal(host))(app, item.name || manifest.name, fundingUrl).open();
    });
  }

  // readme
  const readme = info.createDiv("community-modal-readme markdown-rendered");
  readme.setText(host.t.setting.thirdPartyPlugin.labelNoReadme());
  ng14FetchText(ng14RawUrl(item.repo, "README.md"))
    .then((text) => {
      readme.empty();
      try {
        host.MarkdownRenderer.renderMarkdown(text, readme, item.repo, self);
      } catch (err) {
        readme.setText(text.slice(0, 4000));
      }
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Theme browser descriptor + modal
// ---------------------------------------------------------------------------

const ng14ThemeSortOptions = ["download", "release", "alphabetical"];

function ng14ThemeSortLabel(host, key) {
  const t = host.t.plugins.customCss;
  const p = host.t.setting.thirdPartyPlugin;
  switch (key) {
    case "release": return p.labelByReleased();
    case "alphabetical": return p.labelAlphabetical();
    default: return p.labelByPopularity();
  }
}

export function defineThemeBrowserModal(host) {
  const Base = defineCommunityModal(host);

  function ThemeBrowserModal(app, onlyShowUpdates) {
    const self = Base.call(this, app) || this;
    self.onlyShowUpdates = !!onlyShowUpdates;
    self.modeOnly = true;
    self.installedOnly = false;
    return self;
  }
  inherit(ThemeBrowserModal, Base);
  const proto = ThemeBrowserModal.prototype;

  proto.kindDescriptor = function () {
    const self = this;
    return {
      kind: "theme",
      storageKey: "communityThemeSortOrder",
      defaultSort: "download",
      modalClass: "mod-community-theme",
      sortOptions: ng14ThemeSortOptions,
      sortLabel: (key) => ng14ThemeSortLabel(host, key),
      title: () => host.t.plugins.customCss.settingCommunityThemes(),
      placeholder: () => host.t.plugins.customCss.promptFilter(),
      summaryText: (self, count) =>
        host.t.plugins.customCss.labelSearchSummary
          ? host.t.plugins.customCss.labelSearchSummary({ themeCount: host.t.nouns.themeWithCount({ count }) })
          : host.t.setting.thirdPartyPlugin.labelSearchSummary({ themeCount: host.t.nouns.themeWithCount({ count }) }),
      itemId: (item) => item.name,
      addCustomControls: (self, controls) => {
        const css = self.app.customCss;
        const isDark = css && css.isDarkMode ? css.isDarkMode() : true;
        const label = isDark
          ? host.t.plugins.customCss.labelDarkThemeOnly()
          : host.t.plugins.customCss.labelLightThemeOnly();
        self.modeToggleSetting = new host.Setting(controls)
          .setName(label)
          .setDesc("")
          .addToggle((toggle) => {
            self.modeOnlyEl = toggle.toggleEl;
            toggle.setValue(!!self.modeOnly);
            toggle.onChange((value) => {
              self.modeOnly = value;
              self.update();
            });
          });
        if (!self.onlyShowUpdates) {
          new host.Setting(controls)
            .setName(host.t.setting.thirdPartyPlugin.labelInstalled())
            .setDesc("")
            .addToggle((toggle) => {
              self.installedOnlyEl = toggle.toggleEl;
              toggle.setValue(!!self.installedOnly);
              toggle.onChange((value) => {
                self.installedOnly = value;
                self.update();
              });
            });
        }
      },
      filterItems: (self, items) => {
        const css = self.app.customCss;
        const installed = new Set();
        if (css) {
          for (const name of Object.keys(css.themes || {})) installed.add(name);
          for (const name of css.oldThemes || []) installed.add(name);
          installed.add("");
        }
        let out = items;
        if (self.installedOnly && !self.onlyShowUpdates) {
          out = out.filter((item) => installed.has(item.name));
        }
        if (self.onlyShowUpdates && css && css.updates) {
          out = out.filter((item) => css.updates[item.name]);
        }
        if (self.modeOnly && !self.onlyShowUpdates) {
          const mode = css && css.isDarkMode ? (css.isDarkMode() ? "dark" : "light") : "dark";
          out = out.filter((item) => !item.modes || item.modes.includes(mode));
        }
        if (self.queryWords.length > 0) {
          out = out.filter((item) => {
            if (item.name === "") return false; // Default card never matches a query
            const haystack = ((item.name || "") + " " + (item.author || "")).toLowerCase();
            return containsAllWords(self.queryWords, haystack) !== null;
          });
        }
        return out;
      },
      sortItems: function (items, order) {
        const decorated = items.map((item, index) => ({ item, index }));
        const cmp = (a, b) => {
          let r = 0;
          if (order === "release") r = b.index - a.index;
          else if (order === "alphabetical") r = ng14SortCollator.compare(a.item.name || "", b.item.name || "");
          else r = (b.item.downloads || 0) - (a.item.downloads || 0);
          return r !== 0 ? r : a.index - b.index;
        };
        decorated.sort(cmp);
        return decorated.map((entry) => entry.item);
      },
      moveDefaultFirst: (items) => {
        const idx = items.findIndex((item) => item.name === "");
        if (idx <= 0) return items;
        const copy = items.slice();
        const [def] = copy.splice(idx, 1);
        copy.unshift(def);
        return copy;
      },
      renderRow: (self, item, el) => {
        const css = self.app.customCss;
        const t = host.t;
        const isDefault = item.name === "";
        el.addClass("community-item-theme");
        if (isDefault) {
          el.createDiv("community-item-name", (div) => div.setText(host.t.setting.appearance.labelDefaultTheme()));
        } else {
          const nameEl = el.createDiv("community-item-name");
          nameEl.appendText(item.name);
          const active = css && css.theme === item.name && (item.isDefault || css.isThemeInstalled(item.name));
          const legacy = item.legacy === true;
          if (active) nameEl.createSpan({ cls: "flair mod-pop", text: host.t.setting.appearance.labelCurrentlyActive() });
          else if (legacy) nameEl.createSpan({ cls: "flair mod-pop", text: host.t.plugins.customCss.labelLegacy() });
          else if (item.installed || (css && css.isThemeInstalled(item.name))) {
            nameEl.createSpan({ cls: "flair mod-pop", text: host.t.setting.thirdPartyPlugin.labelInstalled() });
          }
        }
        if (item.author && !isDefault) {
          el.createDiv("community-item-author u-muted", (div) => div.setText(item.author));
        }
        // screenshot
        const shot = el.createDiv("community-item-screenshot");
        const repo = item.repo;
        const file = item.screenshot;
        if (repo && file) {
          const img = shot.createEl("img", { attr: { crossOrigin: "anonymous", loading: "lazy" } });
          img.hide();
          img.addEventListener("load", () => img.show());
          img.src = "https://raw.githubusercontent.com/" + repo + "/HEAD/" + file;
        } else {
          shot.addClass("mod-unavailable");
          host.setIcon(shot, "lucide-camera-off");
        }
        if (css && css.updates && css.updates[item.name]) {
          const badge = el.createDiv("community-item-badge mod-update");
          host.setIcon(badge, "lucide-alert-triangle");
          host.setTooltip(badge, host.t.setting.appearance.labelUpdateAvailable ? host.t.setting.appearance.labelUpdateAvailable() : "Update available");
        }
        if (item.downloads > 0) {
          el.createDiv("community-item-downloads u-muted", (div) => div.setText(item.downloads.toLocaleString()));
        }
      },
      loadItems: async (self) => {
        const css = self.app.customCss;
        const t = host.t;
        // theme feed failure -> inline status + retry (never throws)
        let feed = null;
        try {
          feed = await s04CommunityThemes();
        } catch (err) {
          feed = null;
        }
        if (!Array.isArray(feed)) {
          self.items = [ng14DefaultThemeItem(host)];
          self.feedError = true;
          return;
        }
        self.feedError = false;
        const stats = {}; // upstream ships no theme stats -> downloads 0
        const byName = {};
        for (const entry of feed) {
          if (!entry || typeof entry.author !== "string" || typeof entry.name !== "string" || typeof entry.repo !== "string" || !Array.isArray(entry.modes)) continue;
          byName[entry.name] = {
            ...entry,
            downloads: (stats[entry.name] && stats[entry.name].download) || 0,
            updated: 0,
            installed: false,
            matchScore: null,
          };
        }
        const items = [ng14DefaultThemeItem(host)];
        if (css) {
          for (const name of Object.keys(css.themes || {})) {
            const meta = byName[name] || {};
            items.push({ ...meta, name, author: meta.author || "", repo: meta.repo || "", modes: meta.modes || ["dark", "light"], installed: true, isDefault: false, legacy: false, downloads: meta.downloads || 0, matchScore: null });
            delete byName[name];
          }
          for (const name of css.oldThemes || []) {
            if (css.themes && css.themes[name]) continue;
            const meta = byName[name] || {};
            items.push({ ...meta, name, author: meta.author || "", repo: meta.repo || "", modes: meta.modes || ["dark", "light"], installed: true, legacy: true, downloads: meta.downloads || 0, matchScore: null });
            delete byName[name];
          }
          for (const name of Object.keys(byName)) {
            const entry = byName[name];
            if (entry.legacy) continue;
            items.push({ ...entry, installed: false, matchScore: null });
          }
        }
        self.items = items;
      },
      loadDetail: async (self, item) => {
        const css = self.app.customCss;
        const isDefault = item.name === "";
        const installed = isDefault || (css && css.isThemeInstalled(item.name));
        const active = css && css.theme === item.name && installed;
        const legacy = !!item.legacy;
        let manifest = null;
        let version = null;
        let compatible = null;
        if (!isDefault && item.repo) {
          try {
            manifest = await css.getManifest(item.repo);
          } catch (err) {}
          if (manifest) {
            compatible = await ng14PickCompatibleVersion(item.repo, manifest);
            version = compatible || manifest.version;
          }
        }
        return { item, isDefault, installed, active, legacy, manifest, version, compatible };
      },
      renderDetail: (self, item, detail) => {
        renderThemeDetail(host, self, item, detail);
      },
    };
  }
  return ThemeBrowserModal;
}

function ng14DefaultThemeItem(host) {
  return {
    name: "",
    author: "Basalt",
    repo: "obsidianmd/obsidian-releases",
    modes: ["dark", "light"],
    installed: true,
    isDefault: true,
    legacy: false,
    downloads: 0,
    updated: 0,
    screenshot: null,
    matchScore: null,
  };
}

// ---------------------------------------------------------------------------
// Theme detail pane
// ---------------------------------------------------------------------------

function renderThemeDetail(host, self, item, detail) {
  const css = self.app.customCss;
  const { isDefault, installed, active, legacy, manifest, version, compatible } = detail;
  const info = self.infoEl.createDiv("community-modal-info");
  const meta = info.createDiv("community-modal-meta");
  const name = isDefault ? host.t.setting.appearance.labelDefaultTheme() : item.name;
  meta.createDiv("community-modal-info-name", (div) => {
    div.appendText(name);
    if (active) div.createSpan({ cls: "flair mod-pop", text: host.t.setting.appearance.labelCurrentlyActive() });
    else if (legacy) div.createSpan({ cls: "flair mod-pop", text: host.t.plugins.customCss.labelLegacy() });
    else if (installed) div.createSpan({ cls: "flair mod-pop", text: host.t.setting.thirdPartyPlugin.labelInstalled() });
  });
  if (item.author && !isDefault) {
    meta.createDiv("community-modal-info-author u-muted", (div) => div.setText(item.author));
  }
  if (!isDefault && item.repo) {
    meta.createDiv("community-modal-info-repo", (row) => {
      row.appendText(host.t.setting.thirdPartyPlugin.labelRepository() + " ");
      row.createEl("a", { cls: "external-link", text: item.repo, attr: { href: "https://github.com/" + item.repo } });
    });
  }
  if (manifest) {
    meta.createDiv("community-modal-info-version u-muted", (row) => {
      row.setText(host.t.setting.thirdPartyPlugin.labelVersion({ version: version || "?" }));
    });
    if (manifest.description) {
      meta.createDiv("community-modal-info-desc u-muted", (div) => div.setText(manifest.description));
    }
  }
  const buttons = meta.createDiv("community-modal-button-container");
  const tc = host.t.plugins.customCss;

  if (active && isDefault) {
    const btn = buttons.createEl("button", { text: host.t.setting.appearance.labelCurrentlyActive() });
    btn.disabled = true;
  } else if (active) {
    buttons.createEl("button", { text: tc.labelStopUse() }).addEventListener("click", () => {
      css.setTheme("");
      self.selectItem(item.name);
    });
  } else {
    const useText = installed ? tc.labelUse() : tc.labelInstallAndUse();
    const useBtn = buttons.createEl("button", { cls: "mod-cta", text: useText });
    useBtn.addEventListener("click", async () => {
      if (!installed) {
        if (manifest && !compatible && !version) {
          new host.Notice("No appropriate version found.");
          return;
        }
        await css.installTheme(item, compatible || (manifest && manifest.version) || null);
      }
      css.setTheme(item.name);
      self.selectItem(item.name);
    });
    if (installed && item.name && css.updates && css.updates[item.name]) {
      buttons.createEl("button", { cls: "mod-cta", text: tc.labelUpdate() }).addEventListener("click", async () => {
        const update = css.updates[item.name];
        await css.installTheme(update.themeInfo || item, update.version || null);
        self.selectItem(item.name);
      });
    } else if (installed && item.repo && !manifest) {
      buttons.createEl("button", { text: tc.buttonCheckForUpdates() }).addEventListener("click", async () => {
        const found = await css.checkForUpdate(item);
        if (!found) new host.Notice(tc.msgNoUpdatesFound());
        self.selectItem(item.name);
      });
    }
  }
  if (installed && css.isThemeInstalled(item.name)) {
    const un = buttons.createEl("button", { cls: "mod-destructive", text: tc.labelUninstall ? tc.labelUninstall() : host.t.setting.thirdPartyPlugin.labelUninstall() });
    un.addEventListener("click", async () => {
      await css.removeTheme(item.name);
      new host.Notice(tc.msgDeletedTheme({ title: name }));
      self.update();
      self.returnToGridView();
    });
  }
  // readme
  const readme = info.createDiv("community-modal-readme markdown-rendered");
  if (isDefault) {
    readme.createEl("p", { text: host.t.setting.appearance.labelDefaultTheme() + " — " + (host.t.plugins.customCss.noSnippetDescription ? "" : "") });
    readme.createEl("p", { text: "The default Basalt theme." });
  } else if (item.repo) {
    readme.setText(host.t.setting.thirdPartyPlugin.labelNoReadme());
    ng14FetchText(ng14RawUrl(item.repo, "README.md"))
      .then((text) => {
        readme.empty();
        try {
          host.MarkdownRenderer.renderMarkdown(text, readme, item.repo, self);
        } catch (err) {
          readme.setText(text.slice(0, 4000));
        }
      })
      .catch(() => {});
  } else {
    readme.setText(host.t.setting.thirdPartyPlugin.labelNoReadme());
  }
}

// ---------------------------------------------------------------------------
// Donate modal
// ---------------------------------------------------------------------------

export function defineDonateModal(host) {
  function DonateModal(app, pluginName, fundingUrl) {
    const self = host.ButtonModal.call(this, app) || this;
    self.setTitle(host.t.setting.thirdPartyPlugin.labelDonateModalTitle ? host.t.setting.thirdPartyPlugin.labelDonateModalTitle() : pluginName);
    self.contentEl.createEl("p", { text: pluginName });
    self.contentEl.createEl("a", { cls: "external-link", text: fundingUrl, attr: { href: fundingUrl } });
    self.addButton("mod-cta", "Done", () => self.close());
    return self;
  }
  inherit(DonateModal, host.ButtonModal);
  return DonateModal;
}
