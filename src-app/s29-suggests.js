// s29: editor suggestion classes and the move-folder suggest modal.
//
// FootnoteSuggest completes "[^" references inside markdown editors; EditorSuggestManager is the
// small dispatcher the workspace owns (link/tag/footnote suggests); MoveFolderModal is the fuzzy
// picker used by file/folder context menus to relocate items.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { renderResults } from "./search-simple.js";
import { s05NextFootnoteId } from "./s05-utils.js";
import { s10FolderContains, s10MovableFiles, s10MoveFilesAndUpdateLinks } from "./s10-app.js";
import { ng08FlattenUniqueFiles } from "./n-g08-bookmarks.js";

const S29_FOOTNOTE_PREFIX = "[inline";

export function defineFootnoteSuggest(host) {
  function FootnoteSuggest(app) {
    return host.EditorSuggest.apply(this, arguments) || this;
  }
  inherit(FootnoteSuggest, host.EditorSuggest);
  const proto = FootnoteSuggest.prototype;

  proto.onTrigger = function (cursor, editor, file) {
    const line = cursor.line;
    const text = editor.getLine(line);
    const before = text.slice(0, cursor.ch);
    const after = text.slice(cursor.ch);
    const match = before.match(/(?:^|[^\[])(\[\^)([^\]]*)$/);
    if (!match) return null;
    const length = before.length;
    const query = match[2];
    const start = { line, ch: length - (match[1].length + query.length) };
    const end = { line, ch: cursor.ch };
    const closer = after.match(/[\]\s]/);
    if (closer && closer[0] === "]") {
      end.ch = length + closer.index + 1;
      if (text[end.ch] === ":") return null;
    }
    return { start, end, query };
  };

  proto.renderSuggestion = function (suggestion, el) {
    renderResults(el, suggestion.footnote, suggestion);
  };

  proto.selectSuggestion = function (suggestion) {
    const context = this.context;
    this.close();
    if (!context) return;
    const editor = context.editor;
    if (suggestion.type === "create") {
      editor.replaceRange("", context.start, context.end);
      editor.insertFootnote();
      return;
    }
    const insert = "[^" + suggestion.id + "]";
    editor.transaction({
      changes: [{ from: context.start, to: context.end, text: insert }],
      selection: { from: { line: context.start.line, ch: context.start.ch + insert.length } },
    });
    env().activeWindow.setTimeout(() => editor.focus());
  };

  proto.getSuggestions = async function (context) {
    const runnable = this.runnable;
    if (runnable) runnable.cancel();
    const app = this.app;
    const file = context.file;
    if (!file) return null;
    this.runnable = new host.Runnable();
    const content = await app.vault.cachedRead(file);
    if (this.runnable.isCancelled()) return null;
    const cache = app.metadataCache.getFileCache(file);
    const results = [];
    const query = context.query;
    const prepared = prepareQuery(query);
    if (content && cache && cache.footnotes) {
      for (const footnote of cache.footnotes) {
        if (footnote.id.startsWith(S29_FOOTNOTE_PREFIX)) continue;
        const text = content.slice(footnote.position.start.offset, footnote.position.end.offset);
        const match = fuzzyMatchJs(prepared, text);
        if (match) results.push({ id: footnote.id, footnote: text, score: match.score, matches: match.matches, type: "match" });
      }
    }
    if (!query) {
      const id = s05NextFootnoteId(cache);
      results.push({
        id: String(id),
        footnote: "[^" + id + "]: " + host.i18n.editor.linkSuggestion.labelNewFootnote(),
        score: 1,
        matches: [],
        type: "create",
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  };

  return FootnoteSuggest;
}

export function defineEditorSuggestManager(host) {
  function EditorSuggestManager(app) {
    this.suggests = [];
    this.currentSuggest = null;
    const LinkSuggest = env()._I;
    const TagSuggest = env().YI;
    const FootnoteSuggest = env().d0;
    this.addSuggest(new LinkSuggest(app));
    this.addSuggest(new TagSuggest(app));
    this.addSuggest(new FootnoteSuggest(app));
  }
  const proto = EditorSuggestManager.prototype;

  proto.addSuggest = function (suggest) { this.suggests.push(suggest); };

  proto.removeSuggest = function (suggest) {
    if (this.currentSuggest === suggest) this.close();
    this.suggests.remove(suggest);
  };

  proto.trigger = function (editor, file, forceOpen) {
    if (!editor.cm.hasFocus) return;
    for (const suggest of this.suggests) {
      if (suggest.trigger(editor, file, forceOpen)) {
        if (forceOpen) this.setCurrentSuggest(suggest);
        return;
      }
    }
    this.close();
  };

  proto.setCurrentSuggest = function (suggest) {
    const previous = this.currentSuggest;
    if (previous === suggest) return;
    if (previous) previous.close();
    this.currentSuggest = suggest;
  };

  proto.isShowingSuggestion = function () {
    const suggest = this.currentSuggest;
    return suggest && suggest.isOpen;
  };

  proto.reposition = function () {
    const suggest = this.currentSuggest;
    if (suggest && suggest.isOpen) suggest.updatePosition();
  };

  proto.close = function () {
    this.setCurrentSuggest(null);
  };

  return EditorSuggestManager;
}

// Tab completion for the move-folder picker: keep the typed path up to the folder boundary.
function s29FolderPrefix(path, matches) {
  if (matches && matches.length > 0) {
    const end = matches[matches.length - 1][1];
    const slash = path.indexOf("/", end);
    if (slash !== -1) return path.slice(0, slash + 1);
  }
  return path;
}

export function defineMoveFolderModal(host) {
  const fileExplorer = () => host.i18n.plugins.fileExplorer;

  function MoveFolderModal(app, files) {
    const self = host.FuzzySuggestModal.call(this, app) || this;
    self.limit = 20;
    self.emptyStateText = fileExplorer().labelNoFolders();
    self.emptyMatch = Object.freeze({ match: { score: 0, matches: [] }, item: null });
    self.files = files;
    self.setInstructions([
      { command: "↑↓", purpose: fileExplorer().instructionNavigate() },
      { command: "↵", purpose: fileExplorer().instructionMove() },
      { command: "shift ↵", purpose: fileExplorer().instructionCreate() },
      { command: "esc", purpose: fileExplorer().instructionDismiss() },
    ]);
    self.inputEl.setAttribute("placeholder", fileExplorer().promptTypeFolder());
    self.scope.register(["Shift"], "Enter", (event) => {
      self.selectSuggestion(self.emptyMatch, event);
      return false;
    });
    self.scope.register([], "Tab", (event) => {
      if (event.isComposing) return false;
      const chooser = self.chooser;
      const values = chooser.values;
      const selected = chooser.selectedItem;
      const current = self.inputEl.value;
      const suggestion = values[selected];
      if (suggestion) {
        let next = s29FolderPrefix(suggestion.item.path, suggestion.match?.matches);
        if (next === "/") return false;
        if (next === current) next += "/";
        self.inputEl.value = next;
        self.inputEl.trigger("input");
      }
      return false;
    });
    return self;
  }
  inherit(MoveFolderModal, host.FuzzySuggestModal);
  const proto = MoveFolderModal.prototype;

  proto.onNoSuggestion = function () {
    this.chooser.setSuggestions([this.emptyMatch]);
    this.chooser.addMessage(this.emptyStateText);
  };

  proto.renderSuggestion = function (suggestion, el) {
    if (!suggestion.item) {
      el.addClass("mod-complex");
      const content = el.createDiv("suggestion-content");
      const aux = el.createDiv("suggestion-aux");
      content.createDiv({ cls: "suggestion-title", text: this.inputEl.value });
      aux.createSpan({ cls: "suggestion-hotkey", text: host.i18n.interface.labelEnterToCreate() });
      return;
    }
    host.FuzzySuggestModal.prototype.renderSuggestion.call(this, suggestion, el);
  };

  proto.getItems = function () {
    const movedFolders = ng08FlattenUniqueFiles(this.files).filter((file) => file instanceof host.TFolder);
    const hasFolders = movedFolders.length > 0;
    const folders = [];
    for (const folder of this.app.vault.getAllFolders(true)) {
      if (hasFolders && movedFolders.some((file) => !s10FolderContains(file, folder, host))) continue;
      folders.push(folder);
    }
    return folders;
  };

  proto.getItemText = function (folder) {
    return folder.isRoot() ? "/" : folder.path;
  };

  proto.onChooseItem = async function (folder) {
    const app = this.app;
    const files = this.files;
    if (!files || files.length === 0) return;
    if (!folder) {
      const path = this.inputEl.value;
      await app.vault.createFolder(path);
      const created = app.vault.getAbstractFileByPathInsensitive(path);
      if (created instanceof host.TFolder) folder = created;
    }
    const movable = s10MovableFiles(files, folder, host);
    if (movable.length > 0) await s10MoveFilesAndUpdateLinks(app, movable, folder, host);
  };

  return MoveFolderModal;
}
