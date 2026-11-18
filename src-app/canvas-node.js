// Canvas node base class (S5): position/size/color state, DOM attach/detach, breakpoint
// mounting, selection/focus/editing visuals, context menu and the connection-drag that
// creates a new edge to a file or text node. Subclasses (text/file/frame/link nodes and
// the edge class) live in the same module family; cross-references go through `canvas.*`.
import { randomHex, boxOfRect, boxGrow, boxContains, rgbTripleToHex, pointOfEvent } from "./misc.js";
import { parseLinktext } from "./path.js";
import { copyTextToClipboard } from "./n-g11-view.js";

const cnCanvasT = (host) => host.t.plugins.canvas;

export function defineCanvasNode(host) {
  class CanvasNode {
    constructor(canvas, id = randomHex(16)) {
      this.x = 0;
      this.y = 0;
      this.width = 100;
      this.height = 100;
      this.color = "";
      this.unknownData = {};
      this.initialized = false;
      this.zIndex = -1;
      this.aspectRatio = 0;
      this.isEditing = false;
      this.destroyed = false;
      this.renderedZIndex = -1;
      this.app = canvas.app;
      this.canvas = canvas;
      this.id = id;
      this.nodeEl = createDiv("canvas-node");
    }

    getData() {
      const data = {
        ...this.unknownData,
        id: this.id,
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height,
      };
      if (this.color) data.color = this.color;
      return data;
    }

    setData(data) {
      const canvas = this.canvas;
      let x = data.x, y = data.y, width = data.width, height = data.height;
      let color = data.color;
      const { x: _x, y: _y, width: _w, height: _h, color: _c, ...unknownData } = data;
      x = Math.round(x); y = Math.round(y); width = Math.round(width); height = Math.round(height);
      let dirty = false, moved = false;
      if (!isNaN(x) && this.x !== x) { this.x = x; moved = true; dirty = true; }
      if (!isNaN(y) && this.y !== y) { this.y = y; moved = true; dirty = true; }
      if (!isNaN(width) && this.width !== width) { this.width = width; dirty = true; }
      if (!isNaN(height) && this.height !== height) { this.height = height; dirty = true; }
      color = rgbTripleToHex(color || "");
      if (this.color !== color) { this.color = color; dirty = true; }
      if (dirty) canvas.markDirty(this);
      if (moved) canvas.markMoved(this);
      this.unknownData = unknownData;
    }

    get rect() {
      return { x: this.x, y: this.y, width: this.width, height: this.height };
    }

    setColor(color, render) {
      if (render === undefined) render = false;
      color = rgbTripleToHex(color || "");
      if (this.color !== color) {
        this.color = color;
        if (render) this.render();
        else this.canvas.markDirty(this);
      }
    }

    moveTo(pos) {
      this.moveAndResize({ width: this.width, height: this.height, ...pos });
    }

    resize(size) {
      this.moveAndResize({ x: this.x, y: this.y, ...size });
    }

    moveAndResize(rect) {
      this.x = Math.round(rect.x);
      this.y = Math.round(rect.y);
      this.width = Math.round(rect.width);
      this.height = Math.round(rect.height);
      this.canvas.markMoved(this);
    }

    destroy() {
      this.nodeEl.detach();
      this.destroyed = true;
    }

    attach() {
      const el = this.nodeEl;
      const canvas = this.canvas;
      if (!el.parentNode) canvas.canvasEl.appendChild(el);
      this.updateBreakpoint(canvas.zoom > canvas.zoomBreakpoint || this.isEditing);
    }

    preDetach() {}

    detach() {
      if (this.nodeEl.parentNode) this.nodeEl.detach();
    }

    updateBreakpoint(mount) {}

    get isAttached() {
      return !!this.nodeEl.parentNode;
    }

    initialize() {
      const el = this.nodeEl;
      el.addEventListener("click", this.onClick.bind(this));
      el.addEventListener("contextmenu", this.onContextMenu.bind(this));
      (this.containerEl = el.createDiv("canvas-node-container")).addEventListener("pointerdown", this.onPointerdown.bind(this));
    }

    setIsEditing(editing) {
      if (this.isEditing === editing) return;
      this.isEditing = editing;
      this.nodeEl.toggleClass("is-editing", editing);
    }

    isEditable() {
      return false;
    }

    startEditing() {
      const canvas = this.canvas;
      if (canvas.readonly) return;
      canvas.selectOnly(this);
      const minZoom = canvas.zoomBreakpoint + 0.1;
      if (canvas.zoom < minZoom) canvas.zoomToBbox(this.getBBox());
    }

    getBBox() {
      return boxOfRect(this);
    }

    render() {
      if (!this.initialized) {
        this.initialized = true;
        this.initialize();
        if (this.zIndex < 0) this.updateZIndex();
      }
      const el = this.nodeEl;
      const { x, y, width, height, color } = this;
      const canvas = this.canvas;
      el.setCssStyles({
        transform: `translate(${x}px, ${y}px)`,
        width: `${width}px`,
        height: `${height}px`,
      });
      el.setCssProps({ "--canvas-node-width": `${width}px`, "--canvas-node-height": `${height}px` });
      host.applyCanvasColor(el, color);
      el.toggleClass("is-themed", !!color);
      this.renderZIndex();
      this.updateBreakpoint(canvas.zoom > canvas.zoomBreakpoint || this.isEditing);
    }

    updateZIndex() {
      const canvas = this.canvas;
      if (this.zIndex === canvas.zIndexCounter) return;
      this.zIndex = canvas.getZIndex();
      this.renderZIndex();
    }

    renderZIndex() {
      const canvas = this.canvas;
      let z = this.zIndex;
      if (canvas.selection.size === 1 && canvas.selection.has(this)) z = canvas.zIndexCounter + 1;
      if (z === this.renderedZIndex) return;
      this.nodeEl.style.zIndex = z.toString();
      this.renderedZIndex = z;
    }

    get isFocused() {
      return this.nodeEl.hasClass("is-focused");
    }

    focus() {
      this.nodeEl.addClass("is-focused");
      this.renderZIndex();
    }

    blur() {
      this.nodeEl.removeClass("is-focused");
      this.setIsEditing(false);
      this.renderZIndex();
    }

    select() {
      this.nodeEl.addClass("is-selected");
      this.renderZIndex();
    }

    deselect() {
      this.nodeEl.removeClass("is-selected");
      this.renderZIndex();
    }

    onPointerdown(evt) {
      if (!evt.isPrimary || evt.button !== 0 || this.isEditing || evt.pointerType !== "mouse" || this.canvas.readonly) return;
      if (host.isEditableTarget(evt.targetNode)) return;
      host.dragWithThreshold(evt, () => this.canvas.handleSelectionDrag(evt, this.nodeEl, this));
    }

    onClick(evt) {
      if (this.isEditing) return;
      const canvas = this.canvas;
      if (evt.shiftKey) canvas.toggleSelect(this);
      else canvas.selectOnly(this);
    }

    onContextMenu(evt) {
      if (this.isEditing || evt.defaultPrevented) return;
      const canvas = this.canvas;
      if (canvas.selection.has(this) && canvas.selection.size > 1) {
        canvas.onSelectionContextMenu(evt);
        return;
      }
      canvas.selectOnly(this);
      const menu = host.Menu.forEvent(evt);
      menu.addSections(["title", "canvas", "open", "action-primary", "action", "info", "view", "system", "", "danger"]);
      this.showMenu(menu);
    }

    showMenu(menu) {
      const node = this;
      const canvas = this.canvas;
      if (window.__fpNodeMenu) window.__fpNodeMenu(menu, node);
      if (!canvas.readonly) {
        menu.addItem((item) =>
          item.setSection("danger").setTitle(cnCanvasT(host).actionRemove()).setIcon("lucide-trash-2").setWarning(true).onClick(() => {
            canvas.removeNode(node);
            canvas.requestSave();
          }),
        );
      }
      if (host.Platform.isMobile) {
        menu.addItem((item) =>
          item.setSection("action").setTitle(cnCanvasT(host).actionDuplicate()).setIcon("lucide-files").onClick(() => {
            const data = canvas.getSelectionData();
            const clone = canvas.cloneData(data);
            const nodes = canvas.importData(clone, false);
            canvas.deselectAll();
            for (const n of nodes) canvas.select(n);
          }),
        );
      }
      menu.addItem((item) =>
        item.setSection("canvas").setTitle(cnCanvasT(host).actionZoomToSelection()).setIcon("zoom-to-selection").onClick(() => {
          canvas.zoomToSelection();
        }),
      );
      this.app.workspace.trigger("canvas:node-menu", menu, this);
    }

    onResizePointerdown(evt, handles) {
      const node = this;
      if (!evt.isPrimary || evt.button !== 0) return;
      if (evt.pointerType !== "mouse" && !this.canvas.selection.has(this)) return;
      evt.preventDefault();
      host.dragWithThreshold(evt, () => {
        const canvas = node.canvas;
        const startX = node.x, startY = node.y, startW = node.width, startH = node.height;
        const { snapToGrid, snapToObjects } = canvas.options;
        canvas.selectOnly(node);
        node.nodeEl.addClass("is-dragging");
        canvas.handleDragWithPan(evt, {
          move: (moveEvt) => {
            const minDim = canvas.config.minContainerDimension;
            const pos = canvas.posFromEvt(moveEvt);
            canvas.clearSnapPoints();
            let snapX = 0, snapY = 0;
            let matchX = null, matchY = null;
            const anchor = host.canvasResizeAnchor(handles, pos, node);
            const source = anchor.source;
            const resizeX = anchor.resizeX;
            const resizeY = anchor.resizeY;
            if (canvas.canSnap(moveEvt)) {
              if (snapToObjects) {
                const srcPoints = host.canvasSnapPoints([boxOfRect(source)]);
                const nodePoints = host.canvasSnapPoints(canvas.getViewportNodes(true).map(boxOfRect));
                const snapDist = canvas.snapDistance;
                if (resizeX) {
                  const m = host.canvasSnapMatch(srcPoints, nodePoints, snapDist, "x");
                  if (m) { matchX = m; snapX = m.delta; }
                }
                if (resizeY) {
                  const m = host.canvasSnapMatch(srcPoints, nodePoints, snapDist, "y");
                  if (m) { matchY = m; snapY = m.delta; }
                }
              }
              if (snapToGrid) {
                const grid = canvas.gridSpacing;
                if (resizeX && !matchX) snapX = Math.round(pos.x / grid) * grid - pos.x;
                if (resizeY && !matchY) snapY = Math.round(pos.y / grid) * grid - pos.y;
              }
            }
            const dx = pos.x + snapX, dy = pos.y + snapY;
            const startBox = boxOfRect({ x: startX, y: startY, width: startW, height: startH });
            if (handles.contains("top")) {
              startBox.minY = Math.min(startBox.maxY - minDim, dy);
              if (startBox.minY !== dy) { matchY = null; snapY = startBox.minY - pos.y; }
            }
            if (handles.contains("left")) {
              startBox.minX = Math.min(startBox.maxX - minDim, dx);
              if (startBox.minX !== dx) { matchX = null; snapX = startBox.minX - pos.x; }
            }
            if (handles.contains("bottom")) {
              startBox.maxY = Math.max(startBox.minY + minDim, dy);
              if (startBox.maxY !== dy) { matchY = null; snapY = startBox.maxY - pos.y; }
            }
            if (handles.contains("right")) {
              startBox.maxX = Math.max(startBox.minX + minDim, dx);
              if (startBox.maxX !== dx) { matchX = null; snapX = startBox.maxX - pos.x; }
            }
            const rect = { x: startBox.minX, y: startBox.minY, width: startBox.maxX - startBox.minX, height: startBox.maxY - startBox.minY };
            const aspect = node.aspectRatio;
            if (aspect !== 0) {
              let w = rect.width, h = rect.height;
              if (resizeX && resizeY) {
                const maxSide = Math.max(w, h * aspect);
                h = Math.max(h, w / aspect);
                w = maxSide;
                if (w !== rect.width) matchX = null;
                if (h !== rect.height) matchY = null;
              } else if (resizeX) {
                h = w / aspect;
              } else if (resizeY) {
                w = h * aspect;
              }
              if (handles.includes("left")) {
                const left = startX + startW - w;
                snapX += left - rect.x;
                rect.x = left;
              }
              if (handles.includes("top")) {
                const top = startY + startH - h;
                snapY += top - rect.y;
                rect.y = top;
              }
              if (handles.includes("right")) snapX += w - rect.width;
              if (handles.includes("bottom")) snapY += h - rect.height;
              rect.width = w;
              rect.height = h;
            }
            if (matchX || matchY) canvas.renderSnapPoints(matchX, matchY, snapX, snapY);
            node.moveAndResize(rect);
          },
          end: () => canvas.requestSave(),
          cancel: () => {
            node.moveAndResize({ x: startX, y: startY, width: startW, height: startH });
            canvas.requestSave();
          },
          cleanup: () => node.nodeEl.removeClass("is-dragging"),
        });
      });
    }

    onConnectionPointerdown(evt, side) {
      const node = this;
      if (!evt.isPrimary || evt.button !== 0) return;
      if (evt.pointerType === "touch" && !this.canvas.selection.has(this)) return;
      evt.preventDefault();
      host.dragWithThreshold(evt, () => {
        const canvas = node.canvas;
        const dummy = new canvas.DummyNode(canvas);
        let snapped = null;
        canvas.canvasEl.addClass("is-connecting");
        canvas.deselectAll();
        const opposite = { right: "left", left: "right", top: "bottom" }[side] || "top";
        const from = { side, node, end: "none" };
        const edge = new canvas.EdgeClass(canvas, randomHex(16), from, { side: opposite, node: dummy, end: "arrow" });
        canvas.addEdge(edge);
        canvas.handleDragWithPan(evt, {
          move: (moveEvt) => {
            const pos = canvas.posFromEvt(moveEvt);
            dummy.x = pos.x; dummy.y = pos.y; dummy.width = 0; dummy.height = 0;
            const candidates = canvas
              .getIntersectingNodes(boxGrow(dummy.getBBox(), canvas.config.objectSnapDistance))
              .filter((other) => {
                if (other === node) return false;
                if (other instanceof canvas.FrameNode && boxContains(other.getBBox(), node.getBBox())) return false;
                if (node instanceof canvas.FrameNode && boxContains(node.getBBox(), other.getBBox())) return false;
                return true;
              });
            const hit = host.canvasNearestSide(pos, candidates, canvas.config.objectSnapDistance);
            snapped = hit;
            if (hit) edge.update(from, { side: hit.side, node: hit.node, end: "arrow" });
            else edge.update(from, { side: opposite, node: dummy, end: "arrow" });
          },
          end: () => {
            if (snapped) canvas.requestSave();
            else {
              const app = node.app;
              const metadataCache = app.metadataCache;
              const menu = new host.Menu().addSections(["action", "file", ""]);
              let closed = false;
              const onHide = () => {
                activeWindow.setTimeout(() => {
                  if (!closed) canvas.removeEdge(edge);
                  closed = false;
                }, 50);
              };
              menu.onHide(onHide);
              const connectTo = (target) => {
                edge.update(from, { side: opposite, node: target, end: "arrow" });
                canvas.requestSave();
              };
              const createAt = (file, subpath) => {
                const pos = canvas.posFromEvt(evt);
                const created = canvas.createFileNode({ pos, position: opposite, file, subpath });
                connectTo(created);
              };
              const resolveLink = async (linktext, sourcePath) => {
                closed = true;
                const pos = canvas.posFromEvt(evt);
                if (linktext) {
                  const parsed = parseLinktext(linktext);
                  const path = parsed.path;
                  const subpath = parsed.subpath;
                  let dest = metadataCache.getFirstLinkpathDest(path, sourcePath);
                  if (!dest) {
                    const parent = app.fileManager.getNewFileParent(linktext, path);
                    dest = await app.fileManager.createNewMarkdownFile(parent, path);
                  }
                  createAt(dest, subpath);
                } else {
                  const created = canvas.createTextNode({ pos, position: opposite });
                  connectTo(created);
                }
              };
              menu
                .addItem((item) =>
                  item.setTitle(cnCanvasT(host).actionAddCard()).setSection("action").onClick(() => resolveLink("", "")),
                )
                .addItem((item) =>
                  item.setTitle(cnCanvasT(host).actionAddNote()).setSection("action").onClick(() => {
                    closed = true;
                    new canvas.FileSuggest(canvas, (file) => {
                      closed = true;
                      createAt(file, "");
                    }, onHide).open();
                  }),
                );
              if (node instanceof canvas.FileNode) {
                const file = node.file;
                const links = [];
                host.iterateLinks(metadataCache.getFileCache(file).links, (link) => {
                  const parsed = parseLinktext(link.link);
                  const dest = metadataCache.getFirstLinkpathDest(parsed.path, file.path);
                  if (dest) links.push(dest.path + parsed.subpath);
                });
                const connected = node.getConnectedFiles();
                let count = 0;
                const addFileItem = (path) => {
                  if (connected.has(path)) return "continue";
                  connected.add(path);
                  menu.addItem((item) =>
                    item.setTitle(path).setSection("file").onClick(() => resolveLink(path, file.path)),
                  );
                  count++;
                  return count >= 20 ? "break" : undefined;
                };
                for (const path of links) {
                  if (addFileItem(path) === "break") break;
                }
              }
              node.app.workspace.trigger("canvas:node-connection-drop-menu", menu, node, edge);
              menu.showAtMouseEvent(evt);
            }
          },
          cancel: () => canvas.removeEdge(edge),
          cleanup: () => canvas.canvasEl.removeClass("is-connecting"),
        });
      });
    }

    onResizeDblclick(evt, handle) {}

    getConnectedFiles() {
      const canvas = this.canvas;
      const files = new Set();
      const edges = canvas.edgeFrom.getArray(this);
      for (const edge of edges) {
        const other = edge.to.node;
        if (edge.from.node === this && other instanceof canvas.FileNode && other.file) {
          files.add(other.file.path + other.subpath);
        }
      }
      return files;
    }
  }

  canvas.Node = CanvasNode;
  return CanvasNode;
}

// =====================================================================================================================
// Content-mounting node (x5): keeps heavy embeds unmounted until the card is large enough on screen
// =====================================================================================================================

export function defineContentMountNode(host) {
  class ContentMountNode extends canvas.Node {
    constructor(...args) {
      super(...args);
      this.isContentMounted = false;
      this.alwaysKeepLoaded = false;
    }

    attach() {
      const wasDetached = !this.nodeEl.parentNode;
      super.attach();
      if (wasDetached && this.contentEl) host.restoreScrollPositions(this.contentEl);
    }

    preDetach() {
      if (!this.alwaysKeepLoaded && this.nodeEl.parentNode && this.contentEl) host.saveScrollPositions(this.contentEl);
    }

    detach() {
      if (!this.alwaysKeepLoaded) super.detach();
    }

    updateBreakpoint(mount) {
      super.updateBreakpoint(mount);
      if (mount) this.mountContent();
      else this.unmountContent();
    }

    mountContent() {
      const containerEl = this.containerEl;
      if (!this.initialized || this.isContentMounted) return;
      containerEl.appendChild(this.contentEl);
      containerEl.appendChild(this.contentBlockerEl);
      this.placeholderEl.detach();
      this.isContentMounted = true;
      host.restoreScrollPositions(this.contentEl);
    }

    unmountContent() {
      if (this.alwaysKeepLoaded || !this.initialized || !this.isContentMounted) return;
      host.saveScrollPositions(this.contentEl);
      this.contentEl.detach();
      this.contentBlockerEl.detach();
      this.containerEl.appendChild(this.placeholderEl);
      this.isContentMounted = false;
    }

    initialize() {
      super.initialize();
      this.contentEl = createDiv("canvas-node-content");
      this.contentBlockerEl = createDiv("canvas-node-content-blocker");
      this.placeholderEl = this.containerEl.createDiv("canvas-node-placeholder");
    }
  }
  canvas.ContentMountNode = ContentMountNode;
  return ContentMountNode;
}

// =====================================================================================================================
// Dummy node (T5): zero-size placeholder used while drawing a new edge
// =====================================================================================================================

export function defineDummyNode(host) {
  class DummyNode extends canvas.Node {
    constructor(canvas) {
      super(canvas, randomHex(16));
      this.nodeEl.addClass("is-dummy");
    }
  }
  canvas.DummyNode = DummyNode;
  return DummyNode;
}

// =====================================================================================================================
// Editable node base (A5): dblclick-to-edit markdown children, resize-to-fit on width changes
// =====================================================================================================================

export function defineEditableNode(host) {
  class EditableNode extends canvas.ContentMountNode {
    constructor(...args) {
      super(...args);
      this.resizeDirty = false;
    }

    initialize() {
      const self = this;
      super.initialize();
      const isEditableTarget = (evt) => {
        if (host.isEditableTarget(evt.targetNode)) return true;
        const target = evt.targetNode;
        return !!(target.instanceOf(Element) && target.closest("button, input, .collapse-indicator, .interactive-child"));
      };
      this.containerEl.addEventListener("dblclick", (evt) => {
        if (evt.defaultPrevented) return;
        const child = self.child;
        if (child instanceof host.MarkdownEmbedBase && !child.editMode && !isEditableTarget(evt)) {
          self.startEditing(pointOfEvent(evt));
        }
      });
      host.nativeDblClick(this.contentEl, (evt) => {
        if (self.destroyed || isEditableTarget(evt)) return;
        self.startEditing(pointOfEvent(evt));
      });
    }

    blur() {
      super.blur();
      const child = this.child;
      if (child instanceof canvas.MarkdownEmbed || child instanceof host.StatefulEmbedBase) {
        child.showPreview(true);
        child.applyScope(null);
      }
    }

    focus() {
      super.focus();
      const workspace = this.app.workspace;
      const editor = this.child instanceof host.MarkdownEmbedBase ? this.child : null;
      workspace.activeEditor = editor;
      let file = null;
      if (this instanceof canvas.FileNode) file = this.file;
      this.canvas.requestUpdateFileOpen(file);
    }

    destroy() {
      super.destroy();
      const child = this.child;
      if (child instanceof canvas.MarkdownEmbed || child instanceof host.StatefulEmbedBase) child.applyScope(null);
      this.unloadChild();
    }

    unloadChild() {
      this.aspectRatio = 0;
      if (this.child) {
        this.child.unload();
        this.child = null;
        this.alwaysKeepLoaded = false;
      }
      if (this.contentEl) this.contentEl.empty();
      this.setIsEditing(false);
    }

    startEditing(point) {
      super.startEditing();
      const child = this.child;
      if (!this.canvas.readonly && child instanceof host.MarkdownEmbedBase) {
        child.showEditor(point);
        this.setIsEditing(true);
      }
    }

    isEditable() {
      return this.child instanceof host.MarkdownEmbedBase;
    }

    onClick(evt) {
      const child = this.child;
      if (!this.canvas.readonly) {
        if (child instanceof host.MarkdownEmbedBase) this.setIsEditing(!!child.editMode);
        else this.setIsEditing(false);
      }
      super.onClick(evt);
    }

    onResizeDblclick(evt, handle) {
      evt.preventDefault();
      super.onResizeDblclick(evt, handle);
      const child = this.child;
      if (!(child instanceof host.MarkdownEmbedBase)) return;
      const previewEl = child.previewMode.renderer.previewEl;
      if (!previewEl.isShown()) return;
      if (handle === "top" || handle === "bottom") {
        for (let i = 0; i < 10; i++) {
          const before = previewEl.clientHeight;
          previewEl.style.height = "1px";
          const contentHeight = previewEl.scrollHeight;
          previewEl.style.height = "";
          const delta = contentHeight - before + 1;
          if (Math.abs(delta) < 0.5) break;
          this.resize({ width: this.width, height: this.height + delta });
          this.render();
          this.canvas.requestSave();
        }
        return;
      }
      previewEl.style.height = "1px";
      try {
        const target = previewEl.scrollHeight + 0.1;
        const startWidth = this.width;
        let lo = 0, hi = startWidth;
        for (let i = 0; i < 10; i++) {
          const mid = Math.round((lo + hi) / 2);
          this.resize({ width: mid, height: this.height });
          this.render();
          if (previewEl.scrollHeight > target) lo = mid;
          else hi = mid;
          if (hi - lo < 1) break;
        }
        this.resize({ width: hi, height: this.height });
        if (previewEl.scrollHeight > target) {
          this.resize({ width: startWidth, height: this.height });
          this.render();
        } else {
          this.canvas.requestSave();
        }
      } finally {
        previewEl.style.height = "";
      }
    }

    moveAndResize(rect) {
      const child = this.child;
      if (child instanceof host.MarkdownEmbedBase && (this.width !== rect.width || this.height !== rect.height)) {
        this.resizeDirty = true;
      }
      super.moveAndResize(rect);
    }

    render() {
      super.render();
      const child = this.child;
      if (this.resizeDirty && child instanceof host.MarkdownEmbedBase) child.previewMode.renderer.onResize();
      this.resizeDirty = false;
    }
  }
  canvas.EditableNode = EditableNode;
  return EditableNode;
}

// =====================================================================================================================
// Text node (I5) and link/embed node (F5)
// =====================================================================================================================

export function defineTextNode(host) {
  class TextNode extends canvas.EditableNode {
    constructor(canvas, size) {
      if (size === undefined) size = randomHex(16);
      super(canvas, size);
      this.text = "";
    }

    getData() {
      return { ...super.getData(), type: "text", text: this.text };
    }

    setData(data) {
      super.setData(data);
      const text = data.text;
      if (String.isString(text)) this.setText(text);
    }

    setText(text) {
      if (this.text === text) return;
      this.text = text;
      if (this.child) this.child.set(text);
    }

    initialize() {
      super.initialize();
      host.setIcon(this.placeholderEl.createDiv("canvas-icon-placeholder"), "lucide-align-left");
    }

    render() {
      super.render();
      if (!this.child) {
        this.child = new canvas.MarkdownEmbed(this);
        this.child.set(this.text);
        this.child.load();
      }
    }

    showMenu(menu) {
      const node = this;
      super.showMenu(menu);
      if (this.canvas.readonly) return;
      if (this.child) {
        menu
          .addItem((item) =>
            item.setSection("canvas").setTitle(host.t.interface.menu.edit()).setIcon("lucide-edit").onClick(() => node.startEditing()),
          )
          .addItem((item) =>
            item.setSection("canvas").setTitle(cnCanvasT(host).actionConvertToFile()).setIcon("lucide-file-input").onClick(() => node.convertToFile()),
          );
      }
    }

    convertToFile() {
      const node = this;
      const canvas = this.canvas;
      const text = this.text;
      const parentPath = this.canvas.view.file.path;
      new canvas.NewFileModal(this.app, "Untitled", async (name) => {
        try {
          const app = this.app;
          const parent = app.fileManager.getNewFileParent(parentPath, name);
          const file = await app.fileManager.createNewMarkdownFile(parent, name, text);
          const created = canvas.createFileNode({ pos: this.size, size: this.size, file, save: false, focus: false });
          const edges = canvas.getEdgesForNode(this);
          for (const edge of edges) {
            if (edge.from.node === this) edge.update({ ...edge.from, node: created }, edge.to);
            if (edge.to.node === this) edge.update(edge.from, { ...edge.to, node: created });
          }
          canvas.removeNode(this);
          canvas.selectOnly(created);
          canvas.requestSave();
        } catch (e) {
          return e;
        }
      }).open();
    }
  }
  canvas.TextNode = TextNode;
  return TextNode;
}

export function defineLinkNode(host) {
  class LinkNode extends canvas.ContentMountNode {
    constructor(...args) {
      super(...args);
      this.url = "";
      this.alwaysKeepLoaded = true;
    }

    getData() {
      return { ...super.getData(), type: "link", url: this.url };
    }

    setData(data) {
      super.setData(data);
      const url = data.url;
      if (url) this.setUrl(url);
    }

    setUrl(url) {
      if (window.__fpUrl) url = window.__fpUrl(url);
      if (this.url === url) return;
      this.url = url;
      this.canvas.markDirty(this);
      this.setFrameUrl();
    }

    recreateFrame() {
      if (this.frameEl) this.frameEl.detach();
      let frameEl;
      if (host.Platform.isDesktopApp) {
        const contentEl = this.contentEl;
        const doc = contentEl.doc;
        const webview = doc.createElement("webview");
        const partition = this.app.getWebviewPartition();
        electron.ipcRenderer.send("create-browser-session", partition, null);
        webview.partition = partition;
        webview.addClass("canvas-link");
        webview.allowpopups = true;
        frameEl = this.frameEl = webview;
        webview.addEventListener("page-title-updated", () => this.updateNodeLabel(webview.getTitle()));
        webview.addEventListener("destroyed", () => {
          if (doc !== contentEl.doc) {
            webview.detach();
            this.recreateFrame();
          }
        });
        if (doc.contains(contentEl)) contentEl.appendChild(webview);
        else contentEl.onNodeInserted(() => {
          if (contentEl.doc === doc) contentEl.appendChild(webview);
          else this.recreateFrame();
        }, true);
      } else {
        frameEl = this.frameEl = this.contentEl.createEl("iframe", "canvas-link");
        frameEl.setAttr("sandbox", "allow-forms allow-presentation allow-same-origin allow-scripts allow-modals");
        frameEl.setAttr("allow", "fullscreen");
      }
      frameEl.style.width = "100%";
      frameEl.style.height = "100%";
      this.setFrameUrl();
    }

    initialize() {
      super.initialize();
      this.recreateFrame();
    }

    updateNodeLabel(title) {
      const node = this;
      const canvas = this.canvas;
      const nodeEl = this.nodeEl;
      const visibility = canvas.options.cardLabelVisibility;
      let labelEl = this.labelEl;
      if (visibility === "never") {
        if (labelEl) {
          labelEl.detach();
          this.labelEl = null;
        }
        return;
      }
      if (!labelEl) {
        labelEl = this.labelEl = nodeEl.createDiv("canvas-node-label");
        labelEl.addEventListener("click", this.onLabelClick.bind(this));
        labelEl.addEventListener("dblclick", () => window.open(this.url, "_blank"));
        labelEl.addEventListener("pointerdown", this.onPointerdown.bind(this));
      }
      labelEl.toggleClass("mod-hover-label", visibility === "hover");
      labelEl.setText(title);
    }

    onLabelClick(evt) {
      if (host.Keymap.isModifier(evt, "Mod")) window.open(this.url, "_blank");
    }

    setFrameUrl() {
      const frameEl = this.frameEl;
      let url = this.url;
      if (!frameEl) return;
      this.updateNodeLabel(url);
      if (!/^https?:\/\//.test(url)) return;
      const normalized = host.normalizeEmbedUrl(url);
      if (normalized) url = normalized;
      if (host.Platform.isDesktopApp) this.frameEl.useragent = "";
      frameEl.src = url;
      if (host.isWebviewElement(frameEl) && frameEl.isShown()) {
        try {
          frameEl.loadURL(url);
        } catch (e) {}
      }
    }

    showMenu(menu) {
      const node = this;
      super.showMenu(menu);
      if (this.canvas.readonly) return;
      menu
        .addItem((item) =>
          item.setSection("canvas").setTitle(cnCanvasT(host).actionChangeUrl()).setIcon("lucide-link").onClick(() => {
            new canvas.UrlModal(this.app, this.url, (url) => {
              this.setUrl(url);
              this.canvas.requestSave();
            }).open();
          }),
        )
        .addItem((item) =>
          item.setSection("canvas").setTitle(host.t.interface.menu.openInBrowser()).setIcon("lucide-globe").onClick(() => {
            window.open(node.url, "_blank");
          }),
        )
        .addItem((item) =>
          item.setSection("canvas").setTitle(host.t.interface.menu.copyUrl()).setIcon("lucide-copy").onClick(() => {
            copyTextToClipboard(node.url);
            new host.Notice(host.t.interface.copied({ item: "URL" }));
          }),
        )
        .addItem((item) =>
          item.setSection("canvas").setTitle(cnCanvasT(host).actionReloadPage()).setIcon("lucide-rotate-ccw").onClick(() => {
            const frame = node.frameEl;
            if (host.isWebviewElement(frame)) {
              try {
                frame.loadURL(node.url);
              } catch (e) {}
            } else {
              frame.src = node.url;
            }
          }),
        );
    }
  }
  canvas.LinkNode = LinkNode;
  return LinkNode;
}
