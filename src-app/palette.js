// Quick switcher ("switcher") and command palette ("command-palette") internal plugins.
//
// Quick switcher: a SuggestModal (QuickSwitcherModalBase) that fuzzy-matches vault files (basename first),
// frontmatter aliases, unresolved link texts and bookmark items into suggestions of shape
// { type: "file" | "alias" | "unresolved" | "bookmark", match, ... , downranked? }. An empty query lists
// recent files instead. QuickSwitcherModal fixes the options (attachments, unresolved links, new files)
// and opens the picked target in a leaf — Mod/Shift/Ctrl+Enter picks the "new leaf" variant.
//
// Command palette: a FuzzySuggestModal over app.commands.listCommands() with pinned + recent ordering,
// hotkey hints and a pin flair; its settings tab edits the pinned list through a small
// AbstractInputSuggest. Both plugins keep their options in data.json and the palette also keeps the
// last 100 used command ids in localStorage ("recent-commands").

import { inherit } from "./inherit.js";
import { runTransition } from "./animation.js";
import { setElementTooltip } from "./tooltip.js";
import { fileClass } from "./vault.js";
import { lastSegment, fileLinkPath, targetText, withoutMd } from "./path.js";
import { frontmatterAliases } from "./frontmatter.js";
import { ng08WalkBookmarkItems } from "./n-g08-bookmarks.js";
import { prepareFuzzyFinder, prepareSimpleFinder, renderResults } from "./search-simple.js";
import { sortHitsByScore, sortByOrder, shiftRanges } from "./misc.js";
import { makeHotkey } from "./text.js";

// Classes produced by the factories below, visible to each other regardless of factory order.
const palette = {};

export const QUICK_SWITCHER_DEFAULTS = { showExistingOnly: false, showAttachments: true, showAllFileTypes: false };
const RECENT_COMMANDS_KEY = "recent-commands";
const RECENT_COMMANDS_LIMIT = 100;

// host is provided per factory; paletteHost is bound by the first factory that runs (all share the same host).
let paletteHost = null;
function bindPaletteHost(host) {
  paletteHost = host;
  return host;
}

const TFileType = () => fileClass("TFile");

// Case-insensitive, numeric-aware comparison for command names (same collator the rest of the app sorts with).
const commandNameCollator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true }).compare;

/** Splits `list` into [matching, rest], preserving order. */
function partition(list, predicate) {
  const matching = [];
  const rest = [];
  for (const item of list) (predicate(item) ? matching : rest).push(item);
  return [matching, rest];
}

/**
 * The folder prefix of `path` that contains the end of the last match range — used by Tab completion so
 * accepting a suggestion keeps the user inside the matched folder.
 */
function folderPrefixOfLastMatch(path, matches) {
  if (matches && matches.length > 0) {
    const lastEnd = matches[matches.length - 1][1];
    const slash = path.indexOf("/", lastEnd);
    if (slash !== -1) return path.slice(0, slash + 1);
  }
  return path;
}

/**
 * Runs `match` (a prepared finder) against the file name first; on a hit the match ranges are shifted to
 * the full path. Falls back to matching the whole path with a small score penalty.
 */
function matchBasenameFirst(match, path) {
  const base = lastSegment(path);
  const hit = match(base);
  if (hit) {
    shiftRanges(hit.matches, path.length - base.length);
    return hit;
  }
  const fallback = match(path);
  if (fallback) fallback.score -= 1;
  return fallback;
}

/** The ": "-separated "prefix: rest" command name is rendered as two highlighted spans. */
function renderCommandName(el, name, match, offset = 0) {
  const separator = name.indexOf(": ");
  if (separator !== -1) {
    renderResults(el.createSpan("suggestion-prefix"), name.slice(0, separator), match);
    renderResults(el.createSpan(), name.slice(separator + 2), match, offset - (separator + 2));
  } else {
    renderResults(el.createSpan(), name, match, offset);
  }
}

// =====================================================================================================================
// Quick switcher modal base (U2): SuggestModal over files / aliases / unresolved links / bookmarks
// =====================================================================================================================

export function defineQuickSwitcherModalBase(host) {
  bindPaletteHost(host);

  function QuickSwitcherModalBase(app) {
    const self = host.SuggestModal.call(this, app) || this;
    self.shouldShowUnresolved = false;
    self.shouldShowMarkdown = true;
    self.shouldShowNonAttachments = true;
    self.shouldShowAlias = true;
    self.shouldShowNonImageAttachments = true;
    self.shouldShowImages = true;
    self.shouldShowAllTypes = false;
    self.shouldShowNonFileBookmarks = false;
    self.createButtonEl = null;
    self.allowCreateNewFile = false;
    self.context = "view";
    self.limit = 20;

    // Tab completes the selected suggestion to its folder prefix.
    self.scope.register([], "Tab", (event) => {
      if (event.isComposing) return undefined;
      const chooser = self.chooser;
      const values = chooser.values;
      const selected = chooser.selectedItem;
      const value = values[selected];
      if (value) {
        let text = folderPrefixOfLastMatch(targetText(value), value.match ? value.match.matches : null);
        if (text === self.inputEl.value) text += "/";
        self.inputEl.value = text;
        self.inputEl.trigger("input");
      }
      return false;
    });

    // The "create" call-to-action button, shown on touch devices while creating is allowed.
    self.createButtonEl = createEl("button", "clickable-icon", (el) => {
      host.setIcon(el, "lucide-file-plus");
      el.addEventListener("click", (event) => {
        self.onChooseSuggestion(null, event);
        self.close();
      });
    });
    return self;
  }
  inherit(QuickSwitcherModalBase, host.SuggestModal);
  const proto = QuickSwitcherModalBase.prototype;

  proto.onInput = function () {
    host.SuggestModal.prototype.onInput.call(this);
    if (host.Platform.isMobile && this.allowCreateNewFile) {
      const self = this;
      const button = self.createButtonEl;
      const chooser = self.chooser;
      const value = self.inputEl.value.trim();
      if (value === "") {
        button.detach();
        return;
      }
      if (!button.parentElement) {
        self.ctaEl.appendChild(button);
        runTransition(button, new host.Transition({ duration: 150, fn: "cubic-bezier(0, 0.55, 0.45, 1)" }).addProp("transform", "scale(0.10)", ""));
      }
      const first = chooser.suggestions[0];
      const label = first ? first.getText() : "";
      button.ariaDisabled = String(value.toLowerCase() === label.toLowerCase());
    }
  };

  Object.defineProperty(proto, "supportsCreate", {
    get() { return this.allowCreateNewFile && this.shouldShowMarkdown; },
    enumerable: false,
    configurable: true,
  });

  proto.onNoSuggestion = function () {
    const value = this.inputEl.value.trim();
    if (value && this.supportsCreate) {
      this.chooser.setSuggestions([null]);
      return;
    }
    const text = value ? this.emptyStateText : host.t.setting.thirdPartyPlugin.labelNoRecentFilesFound();
    this.chooser.setSuggestions(null);
    this.chooser.addMessage(text);
  };

  /** Whether a file extension may appear in the suggestions. */
  proto.showsExtension = function (file) {
    const self = this;
    const showAllTypes = this.shouldShowAllTypes;
    const registry = this.context === "view" ? this.app.viewRegistry : this.app.embedRegistry;
    if (file.extension === "md") return self.shouldShowMarkdown;
    if (file.extension === "canvas" || file.extension === "base") return self.shouldShowNonAttachments;
    if (host.imageExtensions.includes(file.extension)) return self.shouldShowImages;
    return !!showAllTypes || (!!self.shouldShowNonImageAttachments && registry.isExtensionRegistered(file.extension));
  };

  proto.getSuggestions = function (query) {
    const self = this;
    query = query.trim();
    const app = this.app;
    const vault = app.vault;
    const metadataCache = app.metadataCache;
    const workspace = app.workspace;
    const results = [];
    const showsExtension = (file) => self.showsExtension(file);

    if (!query) {
      const recent = workspace.getRecentFiles({
        showNonImageAttachments: this.shouldShowNonImageAttachments,
        showImages: this.shouldShowImages,
        showNonAttachments: this.shouldShowNonAttachments,
        showMarkdown: this.shouldShowMarkdown,
      });
      for (const path of recent) {
        const file = vault.getAbstractFileByPath(path);
        if (file instanceof TFileType() && !metadataCache.isUserIgnored(file.path) && showsExtension(file)) {
          results.push({ type: "file", file, match: null });
        }
      }
      return results;
    }

    const files = vault.getFiles().filter(showsExtension);
    const match = files.length < 10000 ? prepareFuzzyFinder(query) : prepareSimpleFinder(query);
    for (const file of files) {
      const ignored = metadataCache.isUserIgnored(file.path);
      const hit = matchBasenameFirst(match, fileLinkPath(file));
      if (hit) {
        if (ignored) hit.score -= 10;
        results.push({ type: "file", file, match: hit, downranked: ignored });
      }
      if (this.shouldShowAlias) {
        const cache = metadataCache.getFileCache(file);
        if (cache) {
          const aliases = frontmatterAliases(cache.frontmatter);
          if (aliases) {
            for (const alias of aliases) {
              const aliasHit = match(alias);
              if (aliasHit) {
                if (ignored) aliasHit.score -= 10;
                results.push({ type: "alias", alias, file, match: aliasHit, downranked: ignored });
              }
            }
          }
        }
      }
    }

    if (this.shouldShowUnresolved) {
      const unresolved = metadataCache.unresolvedLinks;
      const linktexts = [];
      for (const source in unresolved) {
        if (unresolved.hasOwnProperty(source)) {
          const targets = unresolved[source];
          for (const linktext in targets) {
            if (targets.hasOwnProperty(linktext)) linktexts.push(linktext);
          }
        }
      }
      for (const linktext of Array.from(new Set(linktexts))) {
        const hit = match(linktext);
        if (hit) results.push({ type: "unresolved", linktext, match: hit });
      }
    }

    const bookmarksPlugin = app.internalPlugins.getEnabledPluginById("bookmarks");
    if (bookmarksPlugin) {
      const addBookmark = (item, path) => {
        const hit = match(path + bookmarksPlugin.getItemTitle(item));
        if (hit) results.push({ type: "bookmark", match: hit, item, bookmarkPath: path });
      };
      ng08WalkBookmarkItems(bookmarksPlugin.items, (item, path) => {
        if (item.type !== "file" || item.subpath) {
          if (self.shouldShowNonFileBookmarks && item.type !== "group") addBookmark(item, path);
        } else {
          const file = vault.getAbstractFileByPath(item.path);
          if (file instanceof TFileType() && showsExtension(file)) addBookmark(item, path);
        }
      });
    }

    sortHitsByScore(results);
    return results;
  };

  proto.renderSuggestion = function (result, el) {
    const self = this;
    const app = this.app;
    el.addClass("mod-complex");
    let dragTitle = "";
    const content = el.createDiv("suggestion-content");
    const aux = el.createDiv("suggestion-aux");

    if (!result) {
      content.createDiv({ cls: "suggestion-title", text: this.inputEl.value });
      aux.createSpan({ cls: "suggestion-action", text: host.t.interface.labelEnterToCreate() });
      return;
    }

    if (result.downranked) el.addClass("mod-downranked");

    if (result.type === "file") {
      renderResults(content.createDiv("suggestion-title"), fileLinkPath(result.file), result.match);
      aux.createSpan({ cls: "suggestion-flair" });
    } else if (result.type === "alias") {
      const title = content.createDiv("suggestion-title");
      dragTitle = result.alias;
      renderResults(title, result.alias, result.match);
      content.createDiv({ cls: "suggestion-note", text: fileLinkPath(result.file) });
      aux.createSpan({ cls: "suggestion-flair" }, (flair) => {
        host.setIcon(flair, "lucide-forward");
        setElementTooltip(flair, host.t.interface.tooltip.alias());
      });
    } else if (result.type === "unresolved") {
      renderResults(content.createDiv("suggestion-title"), result.linktext, result.match);
      aux.createSpan({ cls: "suggestion-flair" }, (flair) => {
        host.setIcon(flair, "lucide-file-plus");
        setElementTooltip(flair, host.t.interface.tooltip.notCreatedYet());
      });
    } else if (result.type === "bookmark") {
      const title = content.createDiv("suggestion-title");
      const note = content.createDiv("suggestion-note");
      const item = result.item;
      dragTitle = item.title;
      renderResults(title, result.bookmarkPath, result.match);
      aux.createSpan({ cls: "suggestion-flair" }, (flair) => {
        if (item.type === "file") {
          host.setIcon(flair, "lucide-bookmark");
          note.setText(withoutMd(item.path) + (item.subpath != null ? item.subpath : ""));
        } else if (item.type === "folder") {
          host.setIcon(flair, "lucide-bookmark");
          note.setText(withoutMd(item.path));
        } else if (item.type === "search") {
          host.setIcon(flair, "lucide-search");
          note.setText(item.query);
        } else if (item.type === "graph") {
          host.setIcon(flair, "lucide-git-fork");
          flair.detach();
        } else if (item.type === "url") {
          const webviewer = app.internalPlugins.getEnabledPluginById("webviewer");
          if (webviewer) {
            flair.addClass("webviewer-favicon-container");
            webviewer.db.setIcon(flair, item.url);
          } else {
            host.setIcon(flair, "globe-2");
          }
          note.setText(item.url);
        }
      });
    }

    const dragManager = app.dragManager;
    const linktext = targetText(result);
    if (linktext) {
      dragManager.handleDrag(el, (event) => {
        self.inputEl.focus({ preventScroll: true });
        dragManager.updateSource([el, self.containerEl], "is-being-dragged");
        dragManager.dragLink(event, linktext, "", dragTitle);
      });
    }
  };

  palette.ModalBase = QuickSwitcherModalBase;
  return QuickSwitcherModalBase;
}

// =====================================================================================================================
// Quick switcher modal (y9) and its settings tab (b9) + plugin (g9)
// =====================================================================================================================

export function defineQuickSwitcherModal(host) {
  bindPaletteHost(host);

  function QuickSwitcherModal(app, options) {
    const self = palette.ModalBase.call(this, app, options) || this;
    const switcherT = host.t.plugins.quickSwitcher;
    self.emptyStateText = switcherT.labelNoNoteCreateNew();
    self.shouldShowNonFileBookmarks = true;
    self.allowCreateNewFile = true;
    self.shouldShowUnresolved = !options.showExistingOnly;
    self.shouldShowNonImageAttachments = options.showAttachments;
    self.shouldShowImages = options.showAttachments;
    self.shouldShowAllTypes = options.showAllFileTypes;
    self.setPlaceholder(switcherT.promptTypeFileName());
    self.setInstructions([
      { command: "↑↓", purpose: switcherT.instructionNavigate() },
      { command: "↵", purpose: switcherT.instructionOpen() },
      { command: host.isMacLike ? "⌘ ↵" : "ctrl ↵", purpose: switcherT.instructionOpenInNewTab() },
      { command: host.isMacLike ? "⌘ ⌥ ↵" : "ctrl alt ↵", purpose: switcherT.instructionOpenToTheRight() },
      { command: "shift ↵", purpose: switcherT.instructionCreate() },
      { command: "esc", purpose: switcherT.instructionDismiss() },
    ]);
    const scope = self.scope;
    scope.register(["Shift"], "Enter", (event) => { self.selectSuggestion(null, event); return false; });
    scope.register(["Mod", "Shift"], "Enter", (event) => { self.selectSuggestion(null, event); return false; });
    scope.register(null, "Enter", (event) => { self.selectActiveSuggestion(event); return false; });
    return self;
  }
  inherit(QuickSwitcherModal, palette.ModalBase);
  const proto = QuickSwitcherModal.prototype;

  proto.onChooseSuggestion = function (suggestion, event) {
    const newLeaf = host.Keymap.isModEvent(event);
    let sourcePath = "";
    const view = this.app.workspace.getActiveViewOfType(host.FileView);
    if (view && view.file) sourcePath = view.file.path || "";
    if (suggestion) {
      if (suggestion.type === "file" || suggestion.type === "alias") {
        this.app.workspace.getLeaf(newLeaf).openFile(suggestion.file, { active: true });
      } else if (suggestion.type === "unresolved") {
        this.app.workspace.getLeaf(newLeaf).openLinkText(suggestion.linktext, sourcePath, { active: true });
      } else if (suggestion.type === "bookmark") {
        const bookmarks = this.app.internalPlugins.getEnabledPluginById("bookmarks");
        if (bookmarks) bookmarks.openBookmark(suggestion.item, newLeaf);
      }
    } else {
      this.app.workspace.openLinkText(this.inputEl.value, sourcePath, newLeaf, { active: true });
    }
  };

  palette.Modal = QuickSwitcherModal;
  return QuickSwitcherModal;
}

export function defineQuickSwitcherSettingTab(host) {
  bindPaletteHost(host);

  function QuickSwitcherSettingTab(app, plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, app, plugin) || this;
    self.icon = "file-search";
    self.instance = instance;
    return self;
  }
  inherit(QuickSwitcherSettingTab, host.PluginInstanceSettingTab);
  const proto = QuickSwitcherSettingTab.prototype;

  proto.display = function () {
    const self = this;
    const options = this.instance.options;
    const switcherT = host.t.plugins.quickSwitcher;
    this.containerEl.empty();
    const group = new host.SettingGroup(this.containerEl);
    group.addSetting((setting) => setting
      .setName(switcherT.optionShowExistingOnly())
      .setDesc(switcherT.optionShowExistingOnlyDescription())
      .addToggle((toggle) => toggle
        .setValue(options.showExistingOnly)
        .onChange((value) => {
          options.showExistingOnly = value;
          self.plugin.saveData(options);
        })));
    group.addSetting((setting) => setting
      .setName(switcherT.optionShowAttachments())
      .setDesc(switcherT.optionShowAttachmentsDesc())
      .addToggle((toggle) => toggle
        .setValue(options.showAttachments)
        .onChange((value) => {
          options.showAttachments = value;
          self.plugin.saveData(options);
        })));
    if (this.app.vault.getConfig("showUnsupportedFiles")) {
      group.addSetting((setting) => setting
        .setName(switcherT.optionShowAllFileTypes())
        .setDesc(switcherT.optionShowAllFileTypesDesc())
        .addToggle((toggle) => toggle
          .setValue(options.showAllFileTypes)
          .onChange((value) => {
            options.showAllFileTypes = value;
            self.plugin.saveData(options);
          })));
    }
  };

  palette.SettingTab = QuickSwitcherSettingTab;
  return QuickSwitcherSettingTab;
}

export function defineQuickSwitcherPlugin(host) {
  bindPaletteHost(host);

  function QuickSwitcherPlugin() {
    this.id = "switcher";
    this.name = host.t.plugins.quickSwitcher.name();
    this.description = host.t.plugins.quickSwitcher.desc();
    this.defaultOn = true;
    this.plugin = null;
    this.options = QUICK_SWITCHER_DEFAULTS;
    this.activeModal = null;
    this.QuickSwitcherModal = palette.Modal;
  }
  const proto = QuickSwitcherPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const switcherT = host.t.plugins.quickSwitcher;
    plugin.registerRibbonItem(switcherT.actionOpen(), "lucide-file-search", this.onOpen.bind(this));
    plugin.registerGlobalCommand({
      id: "switcher:open",
      name: switcherT.actionOpen(),
      icon: "lucide-navigation",
      callback: this.onOpen.bind(this),
      hotkeys: [makeHotkey(["Mod"], "O")],
    });
  };

  proto.onEnable = async function (app, plugin) {
    plugin.addSettingTab(new palette.SettingTab(app, plugin, this));
    this.options = (await plugin.loadData()) || QUICK_SWITCHER_DEFAULTS;
  };

  proto.onExternalSettingsChange = async function () {
    this.options = (await this.plugin.loadData()) || {};
  };

  proto.onOpen = function () {
    const self = this;
    if (!this.activeModal) {
      this.activeModal = new palette.Modal(this.app, this.options)
        .setCloseCallback(() => { self.activeModal = null; });
      this.activeModal.open();
    }
  };

  palette.Plugin = QuickSwitcherPlugin;
  return QuickSwitcherPlugin;
}

// =====================================================================================================================
// Command palette: modal (h8), settings tab (p8), pinned-command suggest (l8), plugin (u8)
// =====================================================================================================================

export function defineCommandPaletteSuggest(host) {
  bindPaletteHost(host);

  /** Suggestions under the settings search field for adding a command to the pinned list. */
  function CommandPaletteSuggest(app, textInputEl, commands, callback) {
    const self = host.AbstractInputSuggest.call(this, app, textInputEl) || this;
    self.commands = commands;
    self.callback = callback;
    return self;
  }
  inherit(CommandPaletteSuggest, host.AbstractInputSuggest);
  const proto = CommandPaletteSuggest.prototype;

  proto.renderSuggestion = function (result, el) {
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    const aux = el.createDiv("suggestion-aux");
    const title = content.createDiv("suggestion-title");
    const command = result.item;
    const name = command.name;
    const separator = name.indexOf(": ");
    if (separator !== -1) {
      renderResults(title.createSpan("suggestion-prefix"), name.slice(0, separator), result.match);
      renderResults(title.createSpan(), name.slice(separator + 2), result.match, -(separator + 2));
    } else {
      renderResults(title.createSpan(), name, result.match);
    }
    if (command.icon) {
      aux.createSpan({ cls: "suggestion-flair" }, (flair) => host.setIcon(flair, command.icon));
    }
  };

  proto.getSuggestions = function (query) {
    const match = prepareFuzzyFinder(query);
    const results = [];
    for (const command of this.commands) {
      const hit = match(command.name);
      if (hit) results.push({ match: hit, item: command });
    }
    sortHitsByScore(results);
    return results;
  };

  proto.selectSuggestion = function (result) {
    this.callback(result.item);
    this.close();
  };

  palette.Suggest = CommandPaletteSuggest;
  return CommandPaletteSuggest;
}

export function defineCommandPaletteModal(host) {
  bindPaletteHost(host);

  function CommandPaletteModal(app, plugin) {
    const self = host.FuzzySuggestModal.call(this, app) || this;
    const paletteT = host.t.plugins.commandPalette;
    self.emptyStateText = paletteT.labelNoCommands();
    self.commands = null;
    self.plugin = plugin;
    self.setInstructions([
      { command: "↑↓", purpose: paletteT.instructionNavigate() },
      { command: "↵", purpose: paletteT.instructionUse() },
      { command: "esc", purpose: paletteT.instructionDismiss() },
    ]);
    self.setPlaceholder(paletteT.promptTypeCommand());
    self.scope.register(null, "Tab", () => false);
    self.scope.register(null, "Enter", (event) => {
      if (event.isComposing) return undefined;
      self.selectActiveSuggestion(event);
      return false;
    });
    return self;
  }
  inherit(CommandPaletteModal, host.FuzzySuggestModal);
  const proto = CommandPaletteModal.prototype;

  proto.onOpen = function () {
    this.commands = null;
    host.FuzzySuggestModal.prototype.onOpen.call(this);
  };

  proto.onClose = function () {
    this.commands = null;
    host.FuzzySuggestModal.prototype.onClose.call(this);
  };

  proto.getItems = function () {
    let commands = this.commands;
    if (!commands) commands = this.commands = this.plugin.getCommands();
    return commands;
  };

  proto.getItemText = function (command) { return command.name; };

  /** Slightly prefers shorter command names when scores tie (name length is a tiny bonus). */
  proto.sortSuggestions = function (results) {
    for (const result of results) {
      if (result.match.score > 0) result.match.score += result.item.name.length / 10000;
    }
    host.FuzzySuggestModal.prototype.sortSuggestions.call(this, results);
  };

  proto.renderSuggestion = function (result, el) {
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    const aux = el.createDiv("suggestion-aux");
    const title = content.createDiv("suggestion-title");
    const command = result.item;
    renderCommandName(title, command.name, result.match);

    const hotkeys = this.app.hotkeyManager.getHotkeys(command.id);
    const defaultHotkeys = this.app.hotkeyManager.getDefaultHotkeys(command.id);
    if (hotkeys) {
      for (const hotkey of hotkeys) aux.createEl("kbd", { cls: "suggestion-hotkey", text: host.formatHotkey(hotkey) });
    } else if (defaultHotkeys) {
      for (const hotkey of defaultHotkeys) aux.createEl("kbd", { cls: "suggestion-hotkey", text: host.formatHotkey(hotkey) });
    }

    const pinned = this.plugin.options.pinned;
    if (pinned && pinned.includes(command.id)) {
      aux.createSpan({ cls: "suggestion-flair" }, (flair) => host.setIcon(flair, "lucide-pin"));
    }
  };

  proto.onChooseItem = function (command, event) {
    this.app.lastEvent = event;
    host.runCommandCallback(command);
    const recent = this.plugin.recentCommands;
    recent.remove(command.id);
    recent.unshift(command.id);
    if (recent.length > RECENT_COMMANDS_LIMIT) recent.length = RECENT_COMMANDS_LIMIT;
    this.app.saveLocalStorage(RECENT_COMMANDS_KEY, recent);
  };

  palette.PaletteModal = CommandPaletteModal;
  return CommandPaletteModal;
}

export function defineCommandPaletteSettingTab(host) {
  bindPaletteHost(host);

  function CommandPaletteSettingTab(app, plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, app, plugin) || this;
    self.icon = "terminal";
    self.instance = instance;
    return self;
  }
  inherit(CommandPaletteSettingTab, host.PluginInstanceSettingTab);
  const proto = CommandPaletteSettingTab.prototype;

  proto.display = function () {
    const self = this;
    const commands = this.app.commands.commands;
    const candidates = [];
    this.containerEl.empty();
    const pinned = [];

    const refresh = () => {
      const ids = pinned.map((command) => command.id);
      self.instance.options.pinned = ids.length === 0 ? null : ids;
      self.instance.saveSettings(self.plugin);
      self.display();
    };

    const group = new host.SettingGroup(this.containerEl)
      .setHeading(host.t.plugins.commandPalette.labelPinnedCommands());
    group.addSearch((search) => search
      .setPlaceholder(host.t.plugins.commandPalette.promptTypeCommand())
      .then(() => {
        new palette.Suggest(self.app, search.inputEl, candidates, (command) => {
          pinned.push(command);
          refresh();
        });
      }));

    const saved = this.instance.options.pinned;
    if (saved) {
      for (const id of saved) {
        const command = commands[id];
        if (command) pinned.push(command);
      }
    }

    const listEl = group.listEl.createDiv();
    const renderItem = (command) => {
      listEl.createDiv("mobile-option-setting-item", (el) => {
        el.createSpan({ cls: "mobile-option-setting-item-name", text: command.name });
        el.createDiv("clickable-icon", (icon) => {
          host.setIcon(icon, "lucide-x");
          setElementTooltip(icon, host.t.interface.deleteActionShortName());
          icon.addEventListener("click", () => {
            pinned.remove(command);
            refresh();
          });
        });
        el.createDiv("clickable-icon mobile-option-setting-drag-icon", (handle) => {
          host.setIcon(handle, "lucide-menu");
          setElementTooltip(handle, host.t.interface.dragToRearrange());
          host.makeDragReorderable(handle, el, listEl, 5, () => null, (to) => {
            pinned.remove(command);
            pinned.splice(to, 0, command);
            refresh();
          });
        });
      });
    };
    for (const command of pinned) renderItem(command);

    if (pinned.length === 0) {
      listEl.createDiv({ cls: "mobile-option-setting-item", text: host.t.plugins.commandPalette.labelNoCommands() });
    }
    for (const id in commands) {
      const command = commands[id];
      if (!pinned.includes(command)) candidates.push(command);
    }
  };

  palette.PaletteSettingTab = CommandPaletteSettingTab;
  return CommandPaletteSettingTab;
}

export function defineCommandPalettePlugin(host) {
  bindPaletteHost(host);

  function CommandPalettePlugin() {
    this.id = "command-palette";
    this.name = host.t.plugins.commandPalette.name();
    this.description = host.t.plugins.commandPalette.desc();
    this.defaultOn = true;
    this.modal = null;
    this.options = {};
    this.recentCommands = [];
    this.plugin = null;
  }
  const proto = CommandPalettePlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const paletteT = host.t.plugins.commandPalette;
    this.openCallback = this.onOpen.bind(this);
    plugin.registerRibbonItem(paletteT.actionOpen(), "lucide-terminal", this.openCallback);
    plugin.registerGlobalCommand({
      id: "command-palette:open",
      name: paletteT.actionOpen(),
      icon: "lucide-terminal-square",
      callback: this.openCallback,
      hotkeys: [makeHotkey(["Mod"], "P")],
      showOnMobileToolbar: true,
    });
  };

  proto.onEnable = async function (app, plugin) {
    this.modal = new palette.PaletteModal(app, this);
    this.options = Object.assign({}, await plugin.loadData());
    const recent = app.loadLocalStorage(RECENT_COMMANDS_KEY);
    if (recent && Array.isArray(recent)) this.recentCommands = recent;
    plugin.addSettingTab(new palette.PaletteSettingTab(app, plugin, this));
  };

  proto.onDisable = function () {
    this.modal = null;
  };

  proto.onExternalSettingsChange = async function () {
    this.options = (await this.plugin.loadData()) || {};
  };

  proto.saveSettings = function (plugin) {
    plugin.saveData(this.options);
    this.app.saveLocalStorage(RECENT_COMMANDS_KEY, this.recentCommands);
  };

  proto.onOpen = function () {
    if (this.modal) this.modal.open();
    return false;
  };

  /** Pinned commands first (in pin order), then the rest by name with recently used ones floated up. */
  proto.getCommands = function () {
    const all = this.app.commands.listCommands();
    const pinned = this.options.pinned;
    let commands = [];
    let rest = all;
    if (pinned && pinned.length > 0) {
      const pinnedSet = new Set(pinned);
      const parts = partition(all, (command) => pinnedSet.has(command.id));
      commands = parts[0];
      rest = parts[1];
      sortByOrder(commands, pinned);
    }
    rest.sort((a, b) => commandNameCollator(a.name, b.name));
    sortByOrder(rest, this.recentCommands);
    return commands.concat(rest);
  };

  palette.CommandPalettePlugin = CommandPalettePlugin;
  return CommandPalettePlugin;
}
