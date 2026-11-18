// Clipboard and drag/drop handling for the editor: paste of markdown/html/uri-list,
// html-to-markdown conversion with image extraction, file drops turned into embeds,
// and drag-over drop-effect hints driven by the workspace drag manager.
export function defineClipboardManager(host) {
  const {
    Platform, dragDropEffect, dragLinkText,
    isImageExtension, pathBaseName, pathNormalize, stripExtBase, escapePathChars,
    sanitizeHtml, htmlToMarkdown, base64ToBuffer, TFile,
    getExtension, mediaExtensions, clipboardFiles, htmlCommentPrefix, t,
  } = host;

  function ClipboardManager(info) {
    this.app = info.app;
    this.info = info;
  }

  ClipboardManager.prototype.getPath = function () {
    return this.info.file?.path || "";
  };

  ClipboardManager.prototype.handlePaste = function (event) {
    const editor = this.info.editor;
    if (!event.defaultPrevented) {
      this.app.workspace.trigger("editor-paste", event, editor, this.info);
    }
    if (event.defaultPrevented) return true;
    if (event.clipboardData.getData("basalt/properties") && this.info instanceof host.MarkdownView) {
      this.info.handlePaste(event);
    }
    return false;
  };

  ClipboardManager.prototype.handleDragOver = function (event) {
    const draggable = this.app.dragManager.draggable;
    if (draggable) {
      if (Platform.isMacOS ? event.shiftKey : event.altKey) return;
      if (draggable.type === "file") {
        dragDropEffect(event, "link");
        this.app.dragManager.setAction(t.interface.dragAndDrop.insertLinkHere());
      } else if (draggable.type === "files") {
        dragDropEffect(event, "link");
        this.app.dragManager.setAction(t.interface.dragAndDrop.insertLinksHere());
      } else if (draggable.type === "link" || draggable.type === "heading") {
        dragDropEffect(event, "link");
        this.app.dragManager.setAction(t.interface.dragAndDrop.insertLinkHere());
      } else if (draggable.type === "bookmarks") {
        const files = draggable.items.filter((item) => item.item.type === "file");
        if (files.length > 0) {
          dragDropEffect(event, "link");
          this.app.dragManager.setAction(t.interface.dragAndDrop.insertLinkHere());
        }
      }
    } else if (event.ctrlKey) {
      dragDropEffect(event, "link");
    } else {
      dragDropEffect(event, "copy");
    }
  };

  ClipboardManager.prototype.handleDrop = function (event) {
    const app = this.app;
    const info = this.info;
    let result = null;
    const draggable = app.dragManager.draggable;
    if (draggable) {
      if (info instanceof host.MarkdownView && (Platform.isMacOS ? event.shiftKey : event.altKey)) {
        event.preventDefault();
        info.handleDrop(event, draggable, false);
        return true;
      }
      result = dragLinkText(app, draggable, this.getPath(), true).join("\n");
    } else {
      if (!event.defaultPrevented) {
        app.workspace.trigger("editor-drop", event, this.info.editor, this.info);
      }
      if (event.defaultPrevented) return true;
      if (!event.shiftKey) result = this.handleDataTransfer(event.dataTransfer);
      if (!result) result = this.handleDropIntoEditor(event);
    }
    const cm = this.info.editor.activeCM;
    cm.dispatch({ selection: host.cmSelection.single(cm.posAtCoords({ x: event.clientX, y: event.clientY })) });
    if (typeof result === "string") {
      cm.dispatch(cm.state.replaceSelection(result));
      cm.focus();
      event.preventDefault();
      return true;
    }
    return false;
  };

  ClipboardManager.prototype.handleDropIntoEditor = function (event) {
    const app = this.app;
    if (Platform.isMacOS ? event.altKey : event.ctrlKey) {
      const links = [];
      const files = clipboardFiles(event.dataTransfer, "drop", false);
      for (const file of files) {
        const filepath = file.filepath;
        if (!filepath) continue;
        const resolved = app.vault.resolveFilePath(filepath);
        if (resolved) {
          const link = app.fileManager.generateMarkdownLink(resolved, this.getPath());
          links.push(isImageExtension(resolved.extension) ? "!" + link : link);
        } else {
          const name = pathBaseName(pathNormalize(filepath));
          const ext = getExtension(name);
          const label = ext === "md" ? stripExtBase(name) : name;
          let href = escapePathChars(filepath);
          href = href.startsWith("/") ? "file://" + href : "file:///" + href;
          let link = "[" + label + "](" + href + ")";
          if (mediaExtensions.contains(ext)) link = "!" + link;
          links.push(link);
        }
      }
      return links.length === 0 ? null : links.join("\n");
    }
    const files = clipboardFiles(event.dataTransfer, "drop", true);
    if (files.length > 0) event.preventDefault();
    this.insertFiles(files);
    return null;
  };

  ClipboardManager.prototype.handleDataTransfer = function (event) {
    const app = this.app;
    const html = event.getData("text/html");
    if (html && html.includes(htmlCommentPrefix) && event.getData("text/plain")) return null;
    const markdown = event.getData("text/markdown");
    if (markdown) return markdown;
    if (html) {
      if (!app.vault.getConfig("autoConvertHtml")) return null;
      const fragment = sanitizeHtml(html);
      const container = createEl("div");
      container.appendChild(fragment);
      if (event.files.length > 0 && /^<img [^>]+>$/.test(container.innerHTML.trim())) return null;
      const dataUrls = [];
      for (const el of fragment.findAll("img, audio, video")) {
        if (el instanceof HTMLImageElement || el instanceof HTMLMediaElement) {
          if (Platform.isDesktopApp && el.src.startsWith(Platform.resourcePathPrefix)) {
            el.src = "file:///" + el.src.substring(Platform.resourcePathPrefix.length);
            const file = app.vault.resolveFileUrl(el.src);
            if (file instanceof TFile) {
              el.src = app.metadataCache.fileToLinktext(file, this.getPath(), true);
            }
          }
          if (el.src.startsWith("data:") && el.src.length > 1e3) {
            dataUrls.push(el.src);
            el.detach();
          }
        }
      }
      (async () => {
        for (const url of dataUrls) {
          try {
            const match = url.match(/^data:([\w/\-.]+);base64,(.*)/);
            const mime = match[1];
            const isPng = mime === "image/png";
            const isJpg = mime === "image/jpeg";
            if (isPng || isJpg) {
              const buffer = base64ToBuffer(match[2]);
              await this.saveAttachment("Pasted image", isPng ? "png" : "jpg", buffer, true);
            }
          } catch (error) {
            console.error(error);
          }
        }
      })();
      return htmlToMarkdown(container.innerHTML.trim());
    }
    const uriList = event.getData("text/uri-list");
    if (uriList) {
      const text = event.getData("text/plain") || "";
      if (!text) {
        const files = clipboardFiles(event, "drop", false);
        if (files && files.length > 0) {
          const ext = files[0].extension.toLowerCase();
          if (ext === "webloc" || ext === "url") return files[0].name;
        }
        return uriList;
      }
      if (uriList.toLowerCase() !== text.toLowerCase() && decodeURIComponent(uriList.toLowerCase()) !== text.toLowerCase()) {
        const ext = getExtension(pathBaseName(uriList));
        let link = "[" + text + "](" + uriList + ")";
        if (mediaExtensions.contains(ext)) link = "!" + link;
        return link;
      }
    }
    return null;
  };

  ClipboardManager.prototype.insertFiles = function (files) {
    return (async () => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = file.name;
        const extension = file.extension;
        const filepath = file.filepath;
        const data = file.data;
        const addNewline = i < files.length - 1;
        if (filepath) {
          const resolved = this.app.vault.resolveFilePath(filepath);
          if (resolved) {
            this.insertAttachmentEmbed(resolved, addNewline);
            continue;
          }
        }
        const saved = await data;
        if (saved) await this.saveAttachment(name, extension, saved, addNewline);
      }
    })();
  };

  ClipboardManager.prototype.saveAttachment = function (name, extension, data, addNewline) {
    return (async () => {
      if (name === "Pasted image") {
        name += " " + window.moment().format("YYYYMMDDHHmmss");
      }
      const file = await this.app.saveAttachment(name, extension, data);
      if (file) this.insertAttachmentEmbed(file, addNewline);
    })();
  };

  ClipboardManager.prototype.insertAttachmentEmbed = function (file, addNewline) {
    let embed = "!" + this.app.fileManager.generateMarkdownLink(file, this.getPath());
    if (addNewline) embed += "\n\n";
    this.info.editor.replaceSelection(embed);
  };

  return ClipboardManager;
}
