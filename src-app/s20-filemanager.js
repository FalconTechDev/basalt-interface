// s20: the file manager — creation, renaming with link updates, deletion with
// orphan-attachment cleanup, attachment downloads and frontmatter edits.
//   mI  FileManager

import { env } from "./env.js";
import { parentPath, extensionOf, withoutExtension, normalizePath, lastSegment, baseName, linkPath, escapeLinkChars, isLocalLink } from "./path.js";
import { s05IsValidFileName } from "./s05-utils.js";
import { s04ParseDataUrl, s04RawRequest } from "./s04-http.js";
import { valueIgnoringCase } from "./text.js";
import { extensionWithoutContent } from "./n-g11-query.js";
import { propertyTypeDefaults } from "./metadata-types.js";
import { SerialTaskQueue, RefMultimap } from "./metadata-helpers.js";
import { s20MergeFrontmatter, s20LinkUpdateForRename, s20DeepMerge, s20SplitFrontmatter, s20FrontmatterText } from "./s20-frontmatter.js";

/** content-type -> saved extension for downloaded attachments. */
const s20MimeExtensions = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/pict": "pict",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/webp": "webp",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/m4a": "m4a",
  "audio/3gp": "3gp",
  "audio/flac": "flac",
  "audio/ogg": "opus",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "application/ogg": "ogg",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "application/pdf": "pdf",
};

function s20MimeExtension(contentType) {
  return Object.hasOwn(s20MimeExtensions, contentType) ? s20MimeExtensions[contentType] : "";
}

/** Only http(s) URLs count as downloadable attachments. */
function s20IsHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

/** Renames key `from` to `to` inside `obj`, preserving insertion order. */
function s20RenameObjectKey(obj, from, to) {
  for (let i = 0; i < Object.keys(obj).length; i++) {
    const key = Object.keys(obj)[i];
    const value = obj[key];
    delete obj[key];
    obj[key === from ? to : key] = value;
  }
}

/** Collects { frontmatterLinks, embeds, urls } referenced by note `text`. */
function s20CollectNoteReferences(text, host) {
  const frontmatterLinks = [];
  const embeds = [];
  const urls = [];
  const { frontmatter } = s20SplitFrontmatter(text, host);
  const tree = host.markdownTree(text);
  if (frontmatter) {
    for (const key in frontmatter) {
      if (!Object.hasOwn(frontmatter, key)) continue;
      const value = frontmatter[key];
      if (String.isString(value) && s20IsHttpUrl(value) && host.imageExtensions.includes(extensionOf(value))) {
        frontmatterLinks.push({ key, value });
        urls.push(value);
      }
    }
  }
  env().jC(tree, ["image"], (node) => {
    const url = node.url;
    if (url && !isLocalLink(url) && /^(https?:\/\/|data:)/.test(url)) {
      embeds.push(node);
      urls.push(url);
    }
  });
  return { frontmatterLinks, embeds, urls };
}

/** The file manager app.fileManager. */
export function defineS20FileManager(host) {
  function FileManager(app) {
    this.app = null;
    this.vault = null;
    this.fileParentCreatorByType = {};
    this.inProgressUpdates = null;
    this.updateQueue = new SerialTaskQueue();
    this.app = app;
    this.vault = app.vault;
    this.registerFileParentCreator("md", this.getMarkdownNewFileParent.bind(this));
  }
  const proto = FileManager.prototype;

  proto.getMarkdownNewFileParent = function (sourcePath) {
    const vault = this.vault;
    const location = vault.getConfig("newFileLocation");
    let folder;
    if (location === "folder") {
      const configured = vault.getConfig("newFileFolderPath");
      folder = vault.getAbstractFileByPath(configured);
      if (folder instanceof host.TFolder) return folder;
    } else if (location === "current") {
      const parent = parentPath(sourcePath);
      folder = vault.getAbstractFileByPath(parent);
      if (folder instanceof host.TFolder) return folder;
    }
    return vault.getRoot();
  };

  proto.getNewFileParent = function (sourcePath, nameOrExt) {
    const extension = (nameOrExt && extensionOf(nameOrExt)) || "md";
    let creator = this.fileParentCreatorByType[extension];
    if (!creator) {
      console.error("No file creator assigned to create file with extension " + extension + ". Falling back to Markdown file creator.");
      creator = this.fileParentCreatorByType.md;
    }
    return creator(sourcePath);
  };

  proto.registerFileParentCreator = function (extension, creator) {
    this.fileParentCreatorByType[extension] = creator;
  };

  proto.unregisterFileCreator = function (extension) {
    delete this.fileParentCreatorByType[extension];
  };

  proto.canCreateFileWithExt = function (extension) {
    return this.fileParentCreatorByType.hasOwnProperty(extension || "md");
  };

  proto.createNewMarkdownFileFromLinktext = async function (linktext, sourcePath) {
    if (!s05IsValidFileName(linktext)) {
      throw new Error(host.t.plugins.fileExplorer.msgInvalidCharacters() + host.invalidCharsList);
    }
    let parent = null;
    if (!linktext.contains("/")) parent = this.getNewFileParent(sourcePath, linktext);
    return this.createNewMarkdownFile(parent, linktext);
  };

  proto.createNewMarkdownFile = async function (parent, name, template) {
    return this.createNewFile(parent, name, "md", template);
  };

  proto.createNewFile = async function (parent, name, extension, template) {
    const vault = this.vault;
    if (!parent) parent = vault.getRoot();
    if (!extension) extension = (name && extensionOf(name)) || "md";
    if (!this.fileParentCreatorByType.hasOwnProperty(extension)) extension = "md";
    const prefix = parent.getParentPrefix();
    let availablePath;
    if (name) {
      name = name.trim();
      if (extensionOf(name) === extension) name = withoutExtension(name);
      name = normalizePath(name);
      availablePath = vault.getAvailablePath(prefix + name, extension);
    } else {
      const untitled = host.t.plugins.fileExplorer.labelUntitledFile();
      availablePath = vault.getAvailablePath(prefix + untitled, extension);
    }
    const folderPath = parentPath(availablePath);
    const fileName = lastSegment(availablePath);
    const folder = await (async () => {
      if (folderPath && folderPath !== "/") {
        const existing = vault.getAbstractFileByPathInsensitive(folderPath);
        if (existing instanceof host.TFolder) return existing;
        return vault.createFolder(folderPath);
      }
      return vault.getRoot();
    })();
    return vault.create(folder.getParentPrefix() + fileName, template || "");
  };

  proto.createNewFolder = async function (parent) {
    const prefix = !parent || parent.isRoot() ? "" : parent.path + "/";
    const untitled = host.t.plugins.fileExplorer.labelUntitledFolder();
    const path = this.vault.getAvailablePath(prefix + untitled);
    await this.vault.createFolder(path);
    const folder = this.vault.getAbstractFileByPath(path);
    return folder instanceof host.TFolder ? folder : null;
  };

  proto.renameFile = async function (file, newPath) {
    await this.runAsyncLinkUpdate(() => this.vault.rename(file, newPath));
  };

  proto.runAsyncLinkUpdate = async function (callback) {
    if (this.inProgressUpdates) {
      this.inProgressUpdates.push(callback);
      return;
    }
    return this.updateQueue.queue(async () => {
      const app = this.app;
      const metadataCache = app.metadataCache;
      const vault = app.vault;
      await new Promise((resolve) => metadataCache.onCleanCache(resolve));
      const updates = [];
      metadataCache.iterateAllRefs((sourcePath, reference) => {
        const link = linkPath(reference.link);
        if (!link) return;
        const sourceFile = vault.getAbstractFileByPath(sourcePath);
        if (!(sourceFile instanceof host.TFile)) return;
        const resolved = metadataCache.getLinkpathDest(link, sourcePath);
        if (resolved.length > 0) {
          updates.push({
            sourceFile,
            reference,
            resolvedFile: resolved[0],
            resolvedPaths: resolved.map((file) => file.path),
          });
        }
      });
      try {
        this.inProgressUpdates = [];
        await callback(updates);
        while (this.inProgressUpdates.length > 0) {
          const pending = this.inProgressUpdates;
          this.inProgressUpdates = [];
          await Promise.all(pending.map((fn) => fn(updates)));
        }
      } finally {
        this.inProgressUpdates = null;
      }
      await this.updateAllLinks(updates);
    });
  };

  proto.updateAllLinks = async function (updates) {
    const linkUpdates = new RefMultimap();
    const metadataCache = this.app.metadataCache;
    for (const update of updates) {
      const entry = s20LinkUpdateForRename(update, metadataCache, host);
      if (entry) linkUpdates.add(entry.sourcePath, entry);
    }
    const linkCount = linkUpdates.count();
    if (linkCount === 0) return;
    const linksLabel = host.t.nouns.linkWithCount({ count: linkCount });
    const filesLabel = host.t.nouns.fileWithCount({ count: linkUpdates.data.size });
    const noteText = host.t.dialogue.labelLinkAffected({ links: linksLabel, files: filesLabel });
    const apply = async () => {
      await metadataCache.updateInternalLinks(linkUpdates);
      new host.Notice(host.t.dialogue.msgUpdatedLinks({ links: linksLabel, files: filesLabel }));
    };
    if (this.vault.getConfig("alwaysUpdateLinks")) return apply();
    return new Promise((resolve, reject) => {
      try {
        const modal = new host.ButtonModal(this.app);
        modal.titleEl.setText(host.t.dialogue.labelUpdateLinks());
        modal.contentEl.createEl("p", { text: host.t.dialogue.labelConfirmUpdateLinkToFile() });
        modal.contentEl.createEl("p", { text: noteText });
        modal.setCloseCallback(resolve);
        const done = (always) => {
          modal.setCloseCallback(null);
          modal.close();
          if (always) this.vault.setConfig("alwaysUpdateLinks", true);
          resolve(apply());
        };
        const buttons = modal.buttonContainerEl;
        modal.buttonContainerEl.createEl("button", { text: host.t.dialogue.buttonAlwaysUpdate() }).addEventListener("click", () => done(true));
        buttons.createEl("button", { text: host.t.dialogue.buttonJustOnce() }).addEventListener("click", () => done());
        buttons.createEl("button", { text: host.t.dialogue.buttonDoNotUpdate() }).addEventListener("click", () => modal.close());
        modal.open();
      } catch (error) {
        reject(error);
      }
    });
  };

  proto.deleteProperty = async function (key) {
    const app = this.app;
    const metadataCache = app.metadataCache;
    const typeManager = app.metadataTypeManager;
    const files = metadataCache.getCachedFiles();
    for (const path of files) {
      if (metadataCache.isUserIgnored(path)) continue;
      const cache = metadataCache.getCache(path);
      if (!cache || !cache.frontmatter || !Object.hasOwn(cache.frontmatter, key)) continue;
      const file = this.vault.getFileByPath(path);
      if (file) {
        await this.processFrontMatter(file, (frontmatter) => {
          delete frontmatter[key];
        });
      }
    }
    if (!Object.hasOwn(propertyTypeDefaults, key)) {
      if (Object.hasOwn(typeManager.assignedWidgets, key)) typeManager.unsetType(key);
    }
  };

  proto.renameProperty = async function (from, to) {
    const app = this.app;
    const metadataCache = app.metadataCache;
    const typeManager = app.metadataTypeManager;
    if (Object.hasOwn(typeManager.assignedWidgets, from)) {
      const widget = typeManager.assignedWidgets[from].widget;
      if (!Object.hasOwn(propertyTypeDefaults, from)) typeManager.unsetType(from);
      typeManager.setType(to, widget);
    }
    const files = metadataCache.getCachedFiles();
    for (const path of files) {
      if (metadataCache.isUserIgnored(path)) continue;
      const cache = metadataCache.getCache(path);
      if (!cache || !cache.frontmatter || !Object.hasOwn(cache.frontmatter, from)) continue;
      const target = this.vault.getAbstractFileByPath(path);
      if (target instanceof host.TFile) {
        await app.vault.process(target, (text) => {
          const { content, frontmatter } = s20SplitFrontmatter(text, host);
          if (Object.hasOwn(frontmatter, to)) {
            s20DeepMerge(frontmatter, { [to]: frontmatter[from] });
            delete frontmatter[from];
          } else {
            s20RenameObjectKey(frontmatter, from, to);
          }
          return s20FrontmatterText(frontmatter, host) + content;
        });
      }
    }
  };

  proto.getAllLinkResolutions = function () {
    return [];
  };

  proto.promptForDeletion = async function (file) {
    const app = this.app;
    const promptDelete = app.vault.getConfig("promptDelete");
    const trashOption = app.vault.getConfig("trashOption");
    const deleteAttachments = app.vault.getConfig("deleteUnlinkedAttachments");
    if (promptDelete) {
      const content = document.createDocumentFragment();
      content.createEl("p", { cls: "u-break-word", text: host.t.dialogue.labelConfirmDeletion({ filename: file.name }) });
      if (trashOption === "system") content.createEl("p", { text: host.t.dialogue.labelMoveToSystemTrash() });
      else if (trashOption === "local") content.createEl("p", { text: host.t.dialogue.labelMoveToVaultTrash() });
      else if (trashOption === "none") content.createEl("p", { cls: "mod-warning", text: host.t.dialogue.labelPermanentDelete() });
      if (file instanceof host.TFolder && file.children.length > 0) {
        content.createEl("p", { cls: "mod-warning", text: host.t.dialogue.labelNonEmptyFolder() });
        content.createEl("p", { cls: "mod-warning", text: host.t.dialogue.labelDeleteFolderWarning() });
      }
      if (file instanceof host.TFile) {
        const backlinks = app.metadataCache.getBacklinksForFile(file);
        const count = backlinks.count();
        if (count > 0) {
          content.createEl("p", {
            cls: "mod-warning",
            text: host.t.dialogue.labelExistingBacklink({ count }),
          });
        }
      }
      let dontAsk = false;
      const modal = new host.s20PromptModal(app)
        .setTitle(file instanceof host.TFolder ? host.t.dialogue.labelDeleteFolder() : host.t.dialogue.labelDeleteFile())
        .setContent(content)
        .setCta("mod-warning", host.t.dialogue.buttonDelete());
      if (!host.Platform.isMobile) {
        modal.addCheckbox(host.t.dialogue.labelDoNotAskAgain(), (event) => {
          dontAsk = event.target.checked;
        });
      }
      if (!(await modal.prompt())) return false;
      if (dontAsk) app.vault.setConfig("promptDelete", false);
    }
    const attachments = {};
    const resolvedLinks = app.metadataCache.resolvedLinks;
    if (file instanceof host.TFile && Object.hasOwn(resolvedLinks, file.path)) {
      const targets = resolvedLinks[file.path];
      for (const targetPath in targets) {
        if (Object.hasOwn(targets, targetPath) && extensionWithoutContent(extensionOf(targetPath))) {
          const target = app.vault.getFileByPath(targetPath);
          if (target) attachments[target.path] = target;
        }
      }
    }
    await this.trashFile(file);
    if (deleteAttachments === "never" || Object.keys(attachments).length === 0) return true;
    for (const sourcePath in resolvedLinks) {
      if (!Object.hasOwn(resolvedLinks, sourcePath)) continue;
      const targets = resolvedLinks[sourcePath];
      for (const targetPath in targets) {
        if (Object.hasOwn(targets, targetPath)) delete attachments[targetPath];
      }
    }
    const remaining = Object.values(attachments);
    if (remaining.length === 0) return true;
    if (deleteAttachments === "always") {
      for (const attachment of remaining) await this.trashFile(attachment);
    } else if (deleteAttachments === "ask") {
      const picker = new host.s20OrphanAttachmentsModal(app, remaining);
      if (await picker.prompt()) {
        const checked = picker.getCheckedFiles();
        for (const attachment of checked) await this.trashFile(attachment);
      }
      picker.close();
    }
    return true;
  };

  proto.promptForFolderDeletion = function (file) {
    return this.promptForDeletion(file);
  };

  proto.promptForFileDeletion = function (file) {
    return this.promptForDeletion(file);
  };

  proto.promptForFileRename = function (file) {
    new host.s20FileRenameModal(this.app, file).open();
  };

  proto.trashFile = async function (file) {
    const trashOption = this.app.vault.getConfig("trashOption");
    if (trashOption === "system") await this.app.vault.trash(file, true);
    else if (trashOption === "local") await this.app.vault.trash(file, false);
    else if (trashOption === "none") await this.app.vault.delete(file, true);
  };

  proto.downloadAttachmentsForNote = async function (file) {
    if (file.extension !== "md") return;
    const content = await this.app.vault.read(file);
    const collected = s20CollectNoteReferences(content, host);
    const frontmatterLinks = collected.frontmatterLinks;
    const embeds = collected.embeds;
    const urls = collected.urls;
    if (urls.length === 0) {
      new host.Notice(host.t.dialogue.labelNoAttachments());
      return;
    }
    const downloads = await this.promptForImageDownload(urls.unique());
    if (!downloads || Object.keys(downloads).length === 0) return;
    await this.app.vault.process(file, async (text) => {
      if (text !== content) {
        const again = s20CollectNoteReferences(text, host);
        frontmatterLinks.length = 0;
        embeds.length = 0;
        urls.length = 0;
        frontmatterLinks.push(...again.frontmatterLinks);
        embeds.push(...again.embeds);
        urls.push(...again.urls);
      }
      const replacements = [];
      for (const embed of embeds) {
        const url = embed.url;
        if (Object.hasOwn(downloads, url)) {
          const saved = downloads[url];
          const position = embed.position;
          let alias = "";
          if (embed.alt && typeof embed.alt === "string") alias = embed.alt;
          const link = this.app.fileManager.generateMarkdownLink(saved, file.path, "", alias);
          replacements.push({ from: position.start.offset, to: position.end.offset, text: "!" + link });
        }
      }
      replacements.sort((a, b) => b.from - a.from);
      for (const replacement of replacements) {
        text = text.substring(0, replacement.from) + replacement.text + text.substring(replacement.to);
      }
      if (frontmatterLinks.length > 0) {
        text = s20MergeFrontmatter(text, (frontmatter) => {
          for (const link of frontmatterLinks) {
            if (Object.hasOwn(downloads, link.value)) {
              const saved = downloads[link.value];
              const linktext = this.app.metadataCache.fileToLinktext(saved, "", false);
              frontmatter[link.key] = "[[".concat(linktext, "]]");
            }
          }
        }, host);
      }
      return text;
    });
  };

  proto.promptForImageDownload = async function (urls) {
    if (urls.length === 0) return;
    const modal = new host.s20PromptModal(this.app)
      .setTitle(host.t.dialogue.labelDownloadAttachments())
      .setCta("mod-cta", host.t.dialogue.buttonDownload());
    modal.modalEl.addClass("mod-scrollable-content");
    const items = [];
    const byUrl = {};
    for (const url of urls) {
      const item = new host.s20GalleryItem(url);
      items.push(item);
      byUrl[url] = item;
      if (url.startsWith("data:")) {
        const parsed = s04ParseDataUrl(url);
        if (parsed) {
          const type = s20MimeExtension(parsed.contentType) || "jpg";
          item.name = "Image." + type;
        }
      } else {
        const pathname = new URL(url).pathname.split("/").filter((part) => !!part).last();
        if (host.forbiddenNameChars.test(pathname) || host.unsafeNameChars.test(pathname)) continue;
        const dot = pathname.lastIndexOf(".");
        if (dot === -1 || !/^[a-z0-9]+$/i.test(pathname.substring(dot + 1))) continue;
        item.name = pathname;
      }
    }
    modal.contentEl.createDiv("attachments-gallery").setChildrenInPlace(items.map((item) => item.el));
    if (!(await modal.prompt())) return null;
    const downloads = {};
    const self = this;
    await env().Uv(modal.contentEl, async () => {
      for (const url of urls) {
        const item = byUrl[url];
        if (!item.checked) continue;
        let name = item.name;
        if (url.startsWith("data:")) {
          const parsed = s04ParseDataUrl(url);
          if (parsed) {
            const base = baseName(name) || "Image";
            const ext = s20MimeExtension(parsed.contentType) || "jpg";
            downloads[url] = await self.app.saveAttachment(base, ext, parsed.arrayBuffer);
          }
        } else {
          const response = await s04RawRequest(url);
          let disposition = valueIgnoringCase(response.headers, "Content-Disposition") || "";
          const parts = disposition.split(";").map((part) => part.trim()).filter((part) => !!part);
          if (parts.contains("attachment")) {
            for (const part of parts) {
              if (part.startsWith("filename=")) {
                name = part.substring(9).replace(/"/g, "");
                break;
              }
            }
          }
          if (!name) {
            const contentType = (valueIgnoringCase(response.headers, "Content-Type") || "").split(";")[0].trim().toLowerCase();
            if (contentType.startsWith("image/")) {
              const ext = s20MimeExtension(contentType) || "jpg";
              name = "Image." + ext;
            }
          }
          if (!name) name = "Image.jpg";
          const base = baseName(name);
          const ext = extensionOf(name);
          const buffer = response.arrayBuffer;
          downloads[url] = await self.app.saveAttachment(base, ext, buffer);
        }
      }
    });
    modal.close();
    new host.Notice(host.t.dialogue.labelDownloadedAttachments({ count: Object.keys(downloads).length }));
    return downloads;
  };

  proto.generateMarkdownLink = function (file, sourcePath, subpath, alias) {
    const app = this.app;
    const useMarkdownLinks = app.vault.getConfig("useMarkdownLinks");
    const wikiLinks = !useMarkdownLinks;
    let linktext = app.metadataCache.fileToLinktext(file, sourcePath, wikiLinks) + (subpath || "");
    if (file.path === sourcePath && subpath) linktext = subpath;
    let result;
    if (useMarkdownLinks) {
      const destination = escapeLinkChars(linktext);
      result = file.extension === "md" ? "[".concat(alias || file.basename, "](").concat(destination, ")") : "[".concat(alias || "", "](").concat(destination, ")");
    } else {
      if (alias && alias.toLowerCase() === linktext.toLowerCase()) {
        linktext = alias;
        alias = null;
      }
      result = alias ? "[[".concat(linktext, "|").concat(alias, "]]") : "[[".concat(linktext, "]]");
    }
    return result;
  };

  proto.createAndOpenMarkdownFile = async function (name, leafParam) {
    const workspace = this.app.workspace;
    const activePath = workspace.getActiveFile()?.path ?? "";
    const parent = this.getNewFileParent(activePath, name);
    const file = await this.createNewMarkdownFile(parent, name);
    await workspace.getLeaf(leafParam).openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
    return file;
  };

  proto.insertIntoFile = async function (file, text, position = "append") {
    await this.app.vault.process(file, (content) => {
      let inserted, insertedFrontmatter;
      try {
        const split = s20SplitFrontmatter(text, host);
        inserted = split.content;
        insertedFrontmatter = split.frontmatter;
      } catch (error) {
        inserted = text;
        insertedFrontmatter = {};
        new host.Notice(host.t.properties.msgInvalidProperties());
      }
      let existing, existingFrontmatter;
      try {
        const split = s20SplitFrontmatter(content, host);
        existing = split.content;
        existingFrontmatter = split.frontmatter;
      } catch (error) {
        existing = content;
        existingFrontmatter = {};
        new host.Notice(host.t.properties.msgInvalidProperties());
      }
      const head = position === "prepend" ? inserted : existing;
      const tail = position === "prepend" ? existing : inserted;
      let merged;
      if (head && tail && !(head.slice(-2) + tail.slice(0, 2)).contains("\n\n")) {
        merged = head.endsWith("\n") || tail.startsWith("\n") ? head + "\n" + tail : head + "\n\n" + tail;
      } else {
        merged = head + tail;
      }
      s20DeepMerge(existingFrontmatter, insertedFrontmatter);
      if (Object.keys(existingFrontmatter).length > 0) {
        const yaml = host.yamlStringify(existingFrontmatter).trim();
        merged = "---\n".concat(yaml, "\n---\n") + merged;
      }
      return merged;
    });
  };

  proto.processFrontMatter = async function (file, mutate, options) {
    if (file.extension !== "md") return;
    await this.vault.process(file, (text) => s20MergeFrontmatter(text, mutate, host), options);
  };

  proto.storeTextFileBackup = async function (file, content) {
    try {
      const plugin = this.app.internalPlugins.getEnabledPluginById("file-recovery");
      if (plugin) await plugin.forceAdd(file, content);
    } catch (error) {
      // backup is best-effort
    }
  };

  proto.getAvailablePathForAttachment = async function (name, sourcePath) {
    const app = this.app;
    const vault = app.vault;
    const workspace = app.workspace;
    const base = baseName(name);
    const extension = extensionOf(name);
    let folder = null;
    if (sourcePath) {
      const target = vault.getAbstractFileByPath(sourcePath);
      if (target instanceof host.TFolder) folder = target;
    }
    if (!folder) folder = workspace.getActiveFile();
    return vault.getAvailablePathForAttachments(base, extension, folder);
  };

  proto.notifyForBulkUndo = function (updates, timeout = 30000) {
    if (updates.length === 0) return;
    const self = this;
    new host.Notice(host.t.dialogue.msgFilesUpdated({ count: updates.length }), timeout).addButton(
      host.t.dialogue.buttonUndo(),
      () => {
        self.updateQueue.queue(async () => {
          const vault = self.app.vault;
          for (let i = 0; i < updates.length; i++) {
            const entry = updates[i];
            await vault.modify(entry.file, entry.content, { mtime: entry.mtime });
          }
          new host.Notice(host.t.dialogue.msgFilesReverted({ count: updates.length }));
        });
      },
    );
  };

  return FileManager;
}
