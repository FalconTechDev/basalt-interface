// g08 clean-room: drag & drop payloads, drop-effect permissions, drag image,
// one-shot event suppression and the app-wide DragManager (ghost + drop dispatch).
import { inherit } from "./inherit.js";

const ng08DragHost = () => __basaltHost;

/** Which dropEffects each DataTransfer.effectAllowed permits. */
export const ng08DragEffectMap = {
  none: [],
  uninitialized: [],
  copy: ["copy"],
  copyLink: ["copy", "link"],
  copyMove: ["copy", "move"],
  link: ["link"],
  linkMove: ["link", "move"],
  move: ["move"],
  all: ["copy", "link", "move"],
};

/** Shared 1x1 drag image; the app assigns the transparent GIF src after load. */
export const ng08DragPixel = new Image();

export function ng08SetDragUriData(dataTransfer, uri) {
  dataTransfer.setData("text/plain", uri);
  dataTransfer.setData("text/uri-list", uri);
}

export function ng08SetDragPlainData(dataTransfer, text) {
  dataTransfer.setData("text/plain", text);
}

export function ng08SetPlainText(dataTransfer, text) {
  dataTransfer.setData("text/plain", text);
}

export function ng08ApplyDropEffect(evt, effect) {
  if (!effect || !evt.dataTransfer) return;
  if (effect === "none") {
    evt.dataTransfer.dropEffect = effect;
    return;
  }
  const allowed = ng08DragEffectMap[evt.dataTransfer.effectAllowed];
  if (allowed && allowed.indexOf(effect) !== -1) evt.dataTransfer.dropEffect = effect;
}

/** Eats the next single event of `type` on `el` (capture phase). */
export function ng08SuppressNextEvent(el, type) {
  const listener = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    el.removeEventListener(type, listener, true);
  };
  el.addEventListener(type, listener, true);
  el.win.setTimeout(() => el.removeEventListener(type, listener, true), 0);
}

export function ng08SetDragImage(evt) {
  const pixel = ng08DragPixel;
  evt.doc.body.appendChild(pixel);
  evt.dataTransfer.setDragImage(pixel, 0, 0);
  setTimeout(() => pixel.detach(), 0);
}

export function ng08DefineDragManager(host) {
  function DragManager(app) {
    this.app = app;
    this.ghostEl = null;
    this.actionEl = null;
    this.draggable = null;
    this.sourceEls = null;
    this.sourceClass = null;
    this.hoverEl = null;
    this.hoverClass = null;
    this.dragStart = null;
    this.isDragOverHandled = false;
    this.shouldHideOverlay = null;
    this.overlayEl = createDiv("workspace-drop-overlay");
    this.touchEndListener = null;
    const win = window;
    win.addEventListener("dragstart", this.onDragStartGlobal.bind(this));
    win.addEventListener("dragover", this.onDragOverFirst.bind(this), true);
    win.addEventListener("dragover", this.onDragOver.bind(this));
    win.addEventListener("dragleave", this.onDragLeave.bind(this));
    const end = (event) => {
      if (event.view === window) this.onDragEnd();
      else setTimeout(() => this.onDragEnd(), 0);
    };
    win.addEventListener("dragend", end);
    win.addEventListener("drop", end);
  }
  const proto = DragManager.prototype;

  proto.onDragStartGlobal = function (evt) {
    host.hideTooltip();
    if (host.Platform.isIosApp) {
      host.cancelTouchDrag();
      navigator.vibrate(200);
    }
    if (this.draggable) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const target = evt.target;
    if (target && target.nodeName === "IMG") {
      const src = target.src;
      const file = src && this.app.vault.resolveFileUrl(src);
      if (file) this.onDragStart(evt, this.dragFile(evt, file));
    }
  };

  proto.handleDrag = function (el, describe) {
    el.draggable = true;
    el.addEventListener("dragstart", (evt) => {
      const info = describe(evt);
      if (info) this.onDragStart(evt, info);
    });
  };

  proto.onDragStart = function (evt, info) {
    const dt = evt.dataTransfer;
    this.draggable = info || null;
    if (host.Platform.isMobile) {
      this.dragStart = { evt, moved: false };
      this.touchEndListener = (touchEvt) => {
        if (touchEvt.touches && touchEvt.touches.length === 0) this.onDragEnd();
      };
      window.addEventListener("touchend", this.touchEndListener);
      ng08SuppressNextEvent(evt.targetNode || evt.target, "contextmenu");
    }
    const body = evt.doc ? evt.doc.body : document.body;
    body.addClass("is-grabbing");
    if (dt) dt.effectAllowed = "all";
    if (this.ghostEl) this.ghostEl.detach();
    this.ghostEl = null;
    this.actionEl = null;
    if (info) {
      const ghost = this.ghostEl = body.createDiv("drag-ghost");
      const selfEl = ghost.createDiv("drag-ghost-self");
      if (info.icon) host.setIcon(selfEl, info.icon);
      if (info.title) selfEl.createEl("span", { text: info.title });
      this.actionEl = ghost.createDiv("drag-ghost-action");
    }
    if (dt) ng08SetDragImage(evt);
    if (dt && info) {
      const items = dt.items;
      let needsFallback = !items || items.length === 0;
      if (!needsFallback) {
        needsFallback = true;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === "string" && dt.getData(item.type) !== "") {
            needsFallback = false;
            break;
          }
        }
      }
      if (needsFallback) dt.setData("text/plain", info.title || "-");
    }
  };

  proto.onDragOverFirst = function () {
    this.isDragOverHandled = false;
    queueMicrotask(() => {
      if (this.isDragOverHandled) return;
      this.setAction(null);
      this.updateHover(null, "");
      this.shouldHideOverlay = true;
      setTimeout(() => {
        if (this.shouldHideOverlay) this.hideOverlay();
      }, 0);
    });
  };

  proto.onDragOver = function (evt) {
    this.isDragOverHandled = true;
    if (host.Platform.isMobile) {
      evt.preventDefault();
      if (evt.dataTransfer && evt.dataTransfer.dropEffect === "none") {
        evt.dataTransfer.dropEffect = "move";
      }
    }
    const ghost = this.ghostEl;
    if ((evt.clientX !== 0 || evt.clientY !== 0) && ghost) {
      let x = evt.clientX + 5;
      let y = evt.clientY + 5;
      if (host.Platform.isMobile) {
        x -= ghost.offsetWidth / 2;
        y -= ghost.offsetHeight + 20;
      }
      if (ghost.parentNode !== evt.doc.body) evt.doc.body.appendChild(ghost);
      ghost.show();
      ghost.style.left = x + "px";
      ghost.style.top = y + "px";
      ghost.style.position = "absolute";
    }
    const start = this.dragStart;
    if (start && !start.moved && start.evt) {
      if (Math.abs(evt.clientX - start.evt.clientX) > 5 || Math.abs(evt.clientY - start.evt.clientY) > 5) {
        start.moved = true;
      }
    }
  };

  proto.onDragLeave = function (evt) {
    if (evt.clientX === 0 && evt.clientY === 0 && evt.screenX === 0 && evt.screenY === 0 && evt.relatedTarget === null) {
      if (this.ghostEl) this.ghostEl.detach();
      this.updateHover(null, "");
    }
  };

  proto.onDragEnd = function () {
    const start = this.dragStart;
    const startEvt = start && start.evt;
    if (this.ghostEl) this.ghostEl.detach();
    this.ghostEl = null;
    this.dragStart = null;
    this.draggable = null;
    this.updateSource(null, "");
    this.updateHover(null, "");
    document.body.removeClass("is-grabbing");
    if (this.touchEndListener) {
      window.removeEventListener("touchend", this.touchEndListener);
      this.touchEndListener = null;
    }
    this.overlayEl.detach();
    if (start && !start.moved && startEvt) {
      const target = startEvt.target;
      if (target) {
        const replay = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
          ctrlKey: !!startEvt.ctrlKey,
          shiftKey: !!startEvt.shiftKey,
          altKey: !!startEvt.altKey,
          metaKey: !!startEvt.metaKey,
          screenX: startEvt.screenX,
          screenY: startEvt.screenY,
          clientX: startEvt.clientX,
          clientY: startEvt.clientY,
        });
        if (!target.dispatchEvent(replay)) navigator.vibrate(200);
      }
    }
  };

  proto.setAction = function (action) {
    const el = this.actionEl;
    if (!el) return;
    if (action) {
      el.setText(action);
      el.show();
    } else {
      el.hide();
    }
  };

  proto.updateSource = function (els, className) {
    if (this.sourceEls && this.sourceClass) {
      for (const el of this.sourceEls) el.removeClass(this.sourceClass);
    }
    this.sourceEls = els || null;
    this.sourceClass = className || null;
    if (this.sourceEls && this.sourceClass) {
      for (const el of this.sourceEls) el.addClass(this.sourceClass);
    }
  };

  proto.updateHover = function (el, className) {
    if (el === this.hoverEl) return;
    if (this.hoverEl && this.hoverClass) this.hoverEl.removeClass(this.hoverClass);
    this.hoverEl = el || null;
    this.hoverClass = className || null;
    if (this.hoverEl && this.hoverClass) this.hoverEl.addClass(this.hoverClass);
  };

  proto.showOverlay = function (doc, rect) {
    const overlay = this.overlayEl;
    if (overlay.parentNode !== doc.body) doc.body.appendChild(overlay);
    overlay.show();
    overlay.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    this.shouldHideOverlay = null;
  };

  proto.hideOverlay = function () {
    this.overlayEl.hide();
  };

  proto.removeOverlay = function () {
    this.overlayEl.detach();
  };

  proto.handleDrop = function (el, handle, always) {
    const over = (evt) => {
      if (evt.defaultPrevented) return;
      if (!(always || this.draggable)) return;
      const result = handle(evt, this.draggable, true);
      if (!result) return;
      evt.preventDefault();
      if (result.action !== undefined) this.setAction(result.action);
      if (result.dropEffect !== undefined && evt.dataTransfer) evt.dataTransfer.dropEffect = result.dropEffect;
      if (result.hoverEl !== undefined || result.hoverClass !== undefined) {
        this.updateHover(result.hoverEl || null, result.hoverClass || "");
      }
    };
    const drop = (evt) => {
      if (evt.defaultPrevented) return;
      if (!(always || this.draggable)) return;
      const result = handle(evt, this.draggable, false);
      if (result) evt.preventDefault();
    };
    el.addEventListener("dragover", over);
    el.addEventListener("dragenter", over);
    el.addEventListener("drop", drop);
  };

  proto.dragFile = function (evt, file, source) {
    const app = this.app;
    ng08SetDragUriData(evt.dataTransfer, app.getObsidianUrl(file));
    return { source, type: "file", icon: "lucide-file", title: file.getShortName(), file };
  };

  proto.dragFolder = function (evt, folder, source) {
    ng08SetDragPlainData(evt.dataTransfer, folder.name);
    return { source, type: "folder", icon: "lucide-folder-open", title: folder.name, file: folder };
  };

  proto.dragFiles = function (evt, files, source) {
    if (!files || files.length === 0) return null;
    let fileCount = 0;
    let folderCount = 0;
    const uris = [];
    for (const file of files) {
      if (file instanceof host.TFile) {
        fileCount++;
        uris.push(this.app.getObsidianUrl(file));
      } else if (file instanceof host.TFolder) {
        folderCount++;
      }
    }
    ng08SetDragUriData(evt.dataTransfer, uris.join("\n"));
    let title;
    if (fileCount && folderCount) title = `${fileCount} files and ${folderCount} folders`;
    else if (folderCount) title = `${folderCount} folders`;
    else title = `${fileCount} files`;
    return { source, type: "files", icon: "lucide-files", title, files };
  };

  proto.dragLink = function (evt, linktext, sourcePath, title, source) {
    const app = this.app;
    const dest = app.metadataCache.getFirstLinkpathDest(host.linkPath(linktext), sourcePath);
    const uri = dest ? app.getObsidianUrl(dest) : linktext;
    const label = dest ? dest.getShortName() : linktext;
    ng08SetDragUriData(evt.dataTransfer, uri);
    return { source, type: "link", icon: "lucide-link", title: title || label, linktext, sourcePath, file: dest };
  };

  return DragManager;
}
