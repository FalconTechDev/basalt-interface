// s20: the rename dialogs.
//   uI  FileRenameModal: validates a new file name and renames through fileManager
//   hI  RenameLinkModal: base that rewrites every link pointing at the renamed thing
//   pI  HeadingRenameModal: hI specialised for headings (editor token + file scan)
//   dI  BlockIdRenameModal: hI specialised for `^block` ids
//
// All four extend the shared rename-prompt modal (lI, host.TextInputModal).

import { inherit } from "./inherit.js";
import { RefMultimap, applyLinkUpdates } from "./metadata-helpers.js";
import { parseLinktext } from "./path.js";
import { plainHeading, linkSafeHeading } from "./text.js";
import { s20RewriteLinkText } from "./s20-links.js";

const s20rn = {};

const explorerT = (host) => host.t.plugins.fileExplorer;
const dialogueT = (host) => host.t.dialogue;

// =====================================================================================================================
// File rename
// =====================================================================================================================

/** Validates a new name for `file` and renames it, reporting success/failure with a Notice. */
export function defineS20FileRenameModal(host) {
  function FileRenameModal(app, file) {
    const self = host.TextInputModal.call(this, app, file.basename) || this;
    self.file = file;
    if (file.extension === "md") self.title = dialogueT(host).labelRenameFile();
    return self;
  }
  inherit(FileRenameModal, host.TextInputModal);
  FileRenameModal.prototype.validate = function (value) {
    const error = host.TextInputModal.prototype.validate.call(this, value);
    if (error) return error;
    if (value === "") return explorerT(host).msgEmptyFileName();
    if (host.invalidCharsPattern.test(value)) return explorerT(host).msgInvalidCharacters() + host.invalidCharsList;
    if (value.startsWith(".")) return explorerT(host).msgBadDotfile();
    if (host.unsafeCharsPattern.test(value)) return explorerT(host).msgUnsafeCharacters() + host.unsafeCharsList;
    const app = this.app;
    const file = this.file;
    if (app.vault.checkForDuplicate(file, value)) return explorerT(host).msgFileAlreadyExists();
    return "";
  };
  FileRenameModal.prototype.submit = async function (value) {
    const error = this.validate(value);
    if (error) {
      this.displayError(error, false);
      return true;
    }
    this.close();
    const app = this.app;
    const file = this.file;
    const newPath = file.getNewPathAfterRename(value);
    if (file.path === newPath) return undefined;
    try {
      await app.fileManager.renameFile(file, newPath);
      new host.Notice(dialogueT(host).msgRenameSuccess());
    } catch (err) {
      if (err) new host.Notice(err.message || err.code || err.toString());
      return true;
    }
    return undefined;
  };
  return FileRenameModal;
}

// =====================================================================================================================
// Link-rewriting rename base
// =====================================================================================================================

/**
 * Base for renames that must update links: collects the affected references with `getChanges`,
 * applies them to the file itself and to every other file through metadataCache, then lets
 * registered link updaters rewrite their own subpaths.
 */
export function defineS20RenameLinkModal(host) {
  function RenameLinkModal(app, editor, file, tokenRange, initialValue) {
    const self = host.TextInputModal.call(this, app, initialValue) || this;
    self.file = file;
    self.editor = editor;
    self.tokenRange = tokenRange;
    return self;
  }
  inherit(RenameLinkModal, host.TextInputModal);
  RenameLinkModal.prototype.submit = async function (value) {
    const error = this.validate(value);
    if (error) {
      this.displayError(error, false);
      return true;
    }
    const app = this.app;
    const file = this.file;
    const vault = app.vault;
    const metadataCache = app.metadataCache;
    const changes = this.getChanges(value);
    const fileCount = changes.data.size;
    const linkCount = changes.count();
    if (linkCount !== 0) {
      const own = changes.get(file.path);
      if (own && own.length > 0) {
        changes.clear(file.path);
        const replacement = this.replaceInFile(value);
        const reference = {
          link: "",
          original: "",
          position: {
            start: { line: 0, col: 0, offset: replacement.start },
            end: { line: 0, col: 0, offset: replacement.end },
          },
        };
        own.push({ sourcePath: file.path, change: replacement.text, reference });
        await vault.process(file, (content) => applyLinkUpdates(content, own));
      } else {
        this.replaceInEditor(value);
      }
      await metadataCache.updateInternalLinks(changes);
      const links = host.t.nouns.linkWithCount({ count: linkCount });
      const files = host.t.nouns.fileWithCount({ count: fileCount });
      new host.Notice(dialogueT(host).msgUpdatedLinks({ links, files }));
    } else {
      this.replaceInEditor(value);
    }
    const updaters = metadataCache.linkUpdaters;
    const custom = this.getCustomReplacements(value);
    for (const updater of Object.values(updaters)) {
      await updater.renameSubpath(this.file, custom.oldSubpath, custom.newSubpath);
    }
    this.close();
    return undefined;
  };
  s20rn.linkBase = RenameLinkModal;
  return RenameLinkModal;
}

// =====================================================================================================================
// Heading rename
// =====================================================================================================================

/** Renames a heading: rewrites `#old` links everywhere and the heading line itself. */
export function defineS20HeadingRenameModal(host) {
  function HeadingRenameModal(app, editor, file, tokenRange, oldHeading) {
    const self = s20rn.linkBase.call(this, app, editor, file, tokenRange, oldHeading) || this;
    self.title = dialogueT(host).labelRenameHeading();
    self.oldHeading = oldHeading;
    return self;
  }
  inherit(HeadingRenameModal, s20rn.linkBase);
  HeadingRenameModal.prototype.validate = function (value) {
    return value === "" ? dialogueT(host).msgHeadingEmpty() : "";
  };
  HeadingRenameModal.prototype.getChanges = function (value) {
    const file = this.file;
    const metadataCache = this.app.metadataCache;
    const changes = new RefMultimap();
    const oldSubpath = plainHeading(this.oldHeading).toLowerCase();
    const newSubpath = linkSafeHeading(value);
    metadataCache.iterateAllRefs((sourceFile, reference) => {
      const parsed = parseLinktext(reference.link);
      const link = parsed.path;
      const subpath = parsed.subpath;
      if (
        subpath &&
        plainHeading(subpath.substring(1)).toLowerCase() === oldSubpath &&
        metadataCache.getFirstLinkpathDest(link, sourceFile) === file
      ) {
        changes.add(sourceFile, {
          sourcePath: sourceFile,
          reference,
          change: s20RewriteLinkText(reference, link + "#" + newSubpath, host),
        });
      }
    });
    return changes;
  };
  HeadingRenameModal.prototype.replaceInEditor = function (value) {
    const tokenRange = this.tokenRange;
    const editor = this.editor;
    const pos = editor.offsetToPos(tokenRange.start);
    const line = editor.getLine(pos.line);
    const replaced = this.replaceHeadingText(line, value);
    editor.setLine(pos.line, replaced);
  };
  HeadingRenameModal.prototype.replaceInFile = function (value) {
    const tokenRange = this.tokenRange;
    const editor = this.editor;
    const pos = editor.offsetToPos(tokenRange.start);
    const line = editor.getLine(pos.line);
    const replaced = this.replaceHeadingText(line, value);
    return { ...tokenRange, text: replaced };
  };
  HeadingRenameModal.prototype.replaceHeadingText = function (line, value) {
    return line.replace(/^(#{1,6} ).*/m, (match, marks) => marks + value);
  };
  HeadingRenameModal.prototype.getCustomReplacements = function (value) {
    return {
      oldSubpath: plainHeading(this.oldHeading).toLowerCase(),
      newSubpath: linkSafeHeading(value),
    };
  };
  return HeadingRenameModal;
}

// =====================================================================================================================
// Block-id rename
// =====================================================================================================================

/** Renames a `^block` id: rewrites `#^old` links everywhere and the id in the editor. */
export function defineS20BlockIdRenameModal(host) {
  function BlockIdRenameModal(app, editor, file, tokenRange, token) {
    const self = s20rn.linkBase.call(this, app, editor, file, tokenRange, token.text.substring(1)) || this;
    self.title = dialogueT(host).labelRenameBlockid();
    self.token = token;
    return self;
  }
  inherit(BlockIdRenameModal, s20rn.linkBase);
  BlockIdRenameModal.prototype.validate = function (value) {
    if (value === "") return dialogueT(host).msgBlockIdEmpty();
    if (/^[a-zA-Z0-9\-]+$/.test(value)) return "";
    return dialogueT(host).msgBlockIdInvalid();
  };
  BlockIdRenameModal.prototype.getChanges = function (value) {
    const self = this;
    const file = self.file;
    const metadataCache = self.app.metadataCache;
    const token = self.token;
    const changes = new RefMultimap();
    const oldSubpath = "#" + token.text.toLowerCase();
    metadataCache.iterateAllRefs((sourceFile, reference) => {
      const parsed = parseLinktext(reference.link);
      const link = parsed.path;
      const subpath = parsed.subpath;
      if (
        subpath &&
        subpath.toLowerCase() === oldSubpath &&
        metadataCache.getFirstLinkpathDest(link, sourceFile) === file
      ) {
        changes.add(sourceFile, {
          sourcePath: sourceFile,
          reference,
          change: s20RewriteLinkText(reference, link + "#^" + value, host),
        });
      }
    });
    return changes;
  };
  BlockIdRenameModal.prototype.replaceInEditor = function (value) {
    const editor = this.editor;
    const token = this.token;
    editor.replaceRange("^" + value, token.start, token.end);
  };
  BlockIdRenameModal.prototype.replaceInFile = function (value) {
    return { ...this.tokenRange, text: "^" + value };
  };
  BlockIdRenameModal.prototype.getCustomReplacements = function (value) {
    return { oldSubpath: this.token.text.toLowerCase(), newSubpath: "^" + value };
  };
  return BlockIdRenameModal;
}
