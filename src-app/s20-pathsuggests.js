// s20: the specialised path-suggestion classes used by settings and dialogs.
//   TI  MarkdownFileSuggest: FilePathSuggest limited to .md files
//   DI  PredicatedFileSuggest: FilePathSuggest with a caller-supplied file predicate
//   PI  PredicatedFolderSuggest: FolderPathSuggest with a caller-supplied folder predicate

import { inherit } from "./inherit.js";

/** Only markdown files are suggested. */
export function defineS20MarkdownFileSuggest(host) {
  function MarkdownFileSuggest() {
    const self = host.FilePathSuggest.apply(this, arguments) || this;
    return self;
  }
  inherit(MarkdownFileSuggest, host.FilePathSuggest);
  MarkdownFileSuggest.prototype.filePredicate = function (file) {
    return file.extension === "md";
  };
  return MarkdownFileSuggest;
}

/** File-path suggestions filtered by `predicate` (no predicate = everything). */
export function defineS20PredicatedFileSuggest(host) {
  function PredicatedFileSuggest(app, textInputEl, predicate) {
    const self = host.FilePathSuggest.call(this, app, textInputEl) || this;
    self.predicate = predicate;
    return self;
  }
  inherit(PredicatedFileSuggest, host.FilePathSuggest);
  PredicatedFileSuggest.prototype.filePredicate = function (file) {
    return !this.predicate || this.predicate(file);
  };
  return PredicatedFileSuggest;
}

/** Folder-path suggestions filtered by `folderPredicate`; `allowNullSelection` passes through. */
export function defineS20PredicatedFolderSuggest(host) {
  function PredicatedFolderSuggest(app, textInputEl, folderPredicate, allowNullSelection = false) {
    const self = host.FolderSuggest.call(this, app, textInputEl, allowNullSelection) || this;
    self.folderPredicate = folderPredicate;
    return self;
  }
  inherit(PredicatedFolderSuggest, host.FolderSuggest);
  PredicatedFolderSuggest.prototype.filePredicate = function (folder) {
    return !this.folderPredicate || this.folderPredicate(folder);
  };
  return PredicatedFolderSuggest;
}
