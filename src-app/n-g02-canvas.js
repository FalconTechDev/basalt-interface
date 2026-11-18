// Clean-room canvas view controller (g02): the interactive .canvas board — DOM surface,
// pan/zoom viewport with eased animation, node/edge bookkeeping through spatial indexes,
// selection, data codec + undo history, node factories, snapping and the frame pipeline.
// Pointer/touch/wheel/keyboard gestures live in n-g02-input.js, PNG export in n-g02-export.js.
import { env } from "./env.js";
import { makeHotkey } from "./text.js";
import { point, pointOfEvent, box, boxOfPoints, boxUnion, boxCenter, boxGrow, boxContains, boxOfRect, rectOfBox, randomHex, sortedBoxPoints } from "./misc.js";
import { debounceCall } from "./timing.js";
import { s13DomRect, s13AnchorRect, s13MatchSpans } from "./s13-geom.js";
import { s13CanvasI18n, s13InterfaceI18n, s13ZoomDefault, s13ZoomStep, s13ZoomPanOffset } from "./s13-consts.js";

const NG02_GRID_SPACING = [[-3.3, 160], [-2.16, 80], [-0.91, 40]];
const NG02_ZOOM_MIN = -4;
const NG02_ZOOM_MAX = 1;
const NG02_ATTACH_BUDGET = 10;

function ng02GridSpacing(zoom) {
  for (const [limit, spacing] of NG02_GRID_SPACING) if (zoom < limit) return spacing;
  return 20;
}

function ng02Clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function ng02PointBox(p) { return box(p.x, p.y, p.x, p.y); }

/** True when `el` is (or sits inside) interactive canvas chrome rather than bare board. */
function ng02BareTarget(el) {
  if (!el || typeof el.closest !== "function") return true;
  return !el.closest(
    ".canvas-node, .canvas-menu-container, .canvas-card-menu, .canvas-controls, .canvas-edges," +
    " .canvas-node-interaction-layer, .canvas-selection, .canvas-snaps, .canvas-path-label-wrapper," +
    " button, input, textarea, select, [contenteditable]",
  );
}

export function ng02CanvasView(host) {
  class CanvasController {
    constructor(view) {
      this.view = view;
      this.app = view.app;
      for (const key in canvas) this[key] = canvas[key];
      this.Node = host.s13CanvasNode;
      this.Edge = host.s13CanvasEdge;
      this.EdgeClass = host.s13CanvasEdge;
      this.FileNode = host.s13CanvasFileNode;
      this.GroupNode = host.s13CanvasGroupNode;
      this.TextNode = host.s32TextNode;
      this.LinkNode = host.s32LinkNode;
      this.DummyNode = host.s32DummyNode;
      this.FileSuggest = host.CanvasFileSuggest;
      this.MediaSuggest = host.s32MediaSuggest;
      this.UrlModal = host.s32UrlModal;
      this.InteractionLayer = host.s32InteractionLayer;
      this.UndoStack = host.s32UndoStack;
      this.PointIndex = host.s32PointIndex;
      this.BBoxItemIndex = host.s32BBoxItemIndex;
      this.SpatialIndex = host.s32BBoxItemIndex;
      this.BboxIndex = host.s32BBoxItemIndex;

      this.config = {
        zoomMultiplier: 0.5,
        objectSnapDistance: 15,
        minContainerDimension: 50,
        defaultTextNodeDimensions: { width: 250, height: 60 },
        defaultFileNodeDimensions: { width: 400, height: 400 },
      };
      this.zIndexCounter = 1;
      this.readonly = false;
      this.data = {};
      this.x = 0; this.y = 0; this.zoom = 0; this.scale = 1;
      this.tx = 0; this.ty = 0; this.tZoom = 0;
      this.zoomCenter = null;
      this.finishViewportAnimation = false;
      this.pauseAnimation = 0;
      this.wasAnimating = false;
      this.screenshotting = false;
      this.isHoldingSpace = false;
      this.isDragging = false;
      this.viewportChanged = true;
      this.selectionChanged = false;
      this.moved = new Set();
      this.dirty = new Set();
      this.staleSelection = null;
      this.selection = new Set();
      this.nodes = new Map();
      this.edges = new Map();
      this.nodeIndex = new host.s32BBoxItemIndex();
      this.edgeIndex = new host.s32BBoxItemIndex();
      this.edgeFrom = new host.s32Multimap();
      this.edgeTo = new host.s32Multimap();
      this.lastNodesInViewport = new Set();
      this.lastEdgesInViewport = new Set();
      this.pointer = { x: 0, y: 0 };
      this.pointerFrame = null;
      this.frame = null;
      this.frameTime = 0;
      this.canvasPlaceholderEl = null;
      this.snapContainerEl = null;
      this.zoomToFitQueued = false;
      this.history = new host.s32UndoStack(100);
      this.dragSelectionBox = null;

      this.requestUpdateFileOpen = debounceCall((file) => this.updateFileOpen(file), 200);
      this.requestPushHistory = debounceCall(() => this.pushHistory(this.data), 250, true);

      this.buildDom();
      this.nodeInteractionLayer = new host.s32InteractionLayer(this);
      this.menu = new host.s32CanvasMenu(this);
      this.canvasRect = s13DomRect(this.wrapperEl);
      this.requestFrame();
    }

    get plugin() { return this.view.plugin; }
    get options() { return this.view.plugin.options; }

    // ---------- DOM construction ----------

    buildDom() {
      const view = this.view;
      const wrapperEl = (this.wrapperEl = env().createDiv("canvas-wrapper"));
      wrapperEl.tabIndex = -1;
      wrapperEl.setAttr("data-ignore-swipe", "true");
      view.contentEl.appendChild(wrapperEl);
      wrapperEl.onNodeInserted(() => this.onResize());

      const svg = createSvg("svg", "canvas-background");
      const patternId = randomHex(16);
      const pattern = svg.createSvg("pattern", {
        attr: { id: patternId, patternUnits: "userSpaceOnUse" },
      });
      pattern.createSvg("circle", { attr: { cx: s13ZoomDefault, cy: s13ZoomDefault, r: s13ZoomDefault } });
      svg.createSvg("rect", { attr: { width: "100%", height: "100%", fill: `url(#${patternId})` } });
      this.backgroundPatternEl = pattern;
      wrapperEl.appendChild(svg);

      const moverEl = (this.moverEl = env().createDiv("canvas-mover"));
      moverEl.addEventListener("pointerdown", (evt) => this.onMoverPointerdown(evt));

      this.buildCardMenu(wrapperEl);
      this.buildControls(wrapperEl);

      const canvasEl = (this.canvasEl = env().createDiv("canvas"));
      this.edgeContainerEl = createSvg("svg", "canvas-edges");
      this.edgeEndContainerEl = createSvg("svg", "canvas-edges");
      canvasEl.appendChild(this.edgeContainerEl);
      canvasEl.appendChild(this.edgeEndContainerEl);
      wrapperEl.appendChild(canvasEl);

      this.app.dragManager.handleDrop(wrapperEl, (evt, data, isOver) => this.onDrop(evt, data, isOver));

      wrapperEl.addEventListener("keydown", (evt) => this.onKeydown(evt));
      wrapperEl.addEventListener("pointerdown", (evt) => this.onPriorityPointerdown(evt), { capture: true });
      wrapperEl.addEventListener("pointerdown", (evt) => this.onPointerdown(evt));
      wrapperEl.addEventListener("dblclick", (evt) => this.onDoubleClick(evt));
      wrapperEl.addEventListener("contextmenu", (evt) => this.onContextMenu(evt));
      wrapperEl.addEventListener("wheel", (evt) => this.onWheel(evt), { passive: false });
      if (!env().Yl.isMobile) {
        wrapperEl.addEventListener("pointermove", (evt) => this.onPointermove(evt));
      }
    }

    buildCardMenu(wrapperEl) {
      const ti = s13CanvasI18n();
      const menuEl = (this.cardMenuEl = env().createDiv("canvas-card-menu"));
      const addButton = (title, icon, action, size) => {
        const btn = env().createEl("button", "canvas-card-menu-button mod-draggable");
        btn.setAttr("aria-label", title);
        env().tv(btn, icon);
        env().Mv(btn, title);
        btn.addEventListener("click", () => action(this.posCenter(), size));
        btn.addEventListener("pointerdown", (evt) => {
          if (!evt.isPrimary || evt.button !== 0) return;
          evt.preventDefault();
          this.dragTempNode(evt, size, (pos) => action(pos, size));
        });
        menuEl.appendChild(btn);
      };
      const textSize = this.config.defaultTextNodeDimensions;
      const fileSize = this.config.defaultFileNodeDimensions;
      addButton(ti.actionDragToAddCard(), "lucide-sticky-note", (pos) => {
        this.createTextNode({ pos });
      }, textSize);
      addButton(ti.actionDragToAddNote(), "lucide-file-text", (pos, size) => {
        new host.CanvasFileSuggest(this, (file) => {
          this.createFileNode({ pos, size, file });
        }).showAttachments(false).open();
      }, fileSize);
      addButton(ti.actionDragToAddMedia(), "lucide-file-image", (pos, size) => {
        new host.s32MediaSuggest(this, (file) => {
          this.createFileNode({ pos, size, file });
        }).open();
      }, fileSize);
      wrapperEl.appendChild(menuEl);
      setTimeout(() => { if (window.__fpCardMenu) window.__fpCardMenu(menuEl, this); }, 0);
    }

    buildControls(wrapperEl) {
      const ti = s13CanvasI18n();
      const controlsEl = (this.canvasControlsEl = env().createDiv("canvas-controls"));
      const addGroup = () => {
        const group = env().createDiv("canvas-control-group mod-raised");
        controlsEl.appendChild(group);
        return group;
      };
      const addButton = (group, icon, tooltip, onclick) => {
        const item = env().createDiv("canvas-control-item");
        const btn = env().createEl("button", "canvas-control-button");
        env().tv(btn, icon);
        env().Mv(btn, tooltip);
        btn.addEventListener("click", (evt) => onclick(evt));
        item.appendChild(btn);
        group.appendChild(item);
        return item;
      };
      const g1 = addGroup();
      this.quickSettingsButton = addButton(g1, "lucide-settings", ti.labelCanvasSettings(), (evt) => {
        const menu = new host.Menu();
        this.showQuickSettingsMenu(menu);
        menu.showAtMouseEvent(evt);
      });
      const g2 = addGroup();
      addButton(g2, "lucide-zoom-in", env().gm.commands.zoomIn(), () => this.zoomBy(this.config.zoomMultiplier));
      addButton(g2, "lucide-zoom-out", env().gm.commands.zoomOut(), () => this.zoomBy(-this.config.zoomMultiplier));
      addButton(g2, "lucide-rotate-cw", env().gm.commands.resetZoom(), () => this.zoomBy(-this.zoom));
      addButton(g2, "lucide-maximize", ti.actionZoomToFit() + " (" + host.formatHotkey(makeHotkey(["Shift"], "1")) + ")", () => this.zoomToFit());
      const g3 = addGroup();
      this.undoBtnEl = addButton(g3, "lucide-undo-2", env().gm.setting.mobileToolbar.optionUndo(), () => this.undo());
      this.redoBtnEl = addButton(g3, "lucide-redo-2", env().gm.setting.mobileToolbar.optionRedo(), () => this.redo());
      if (env().Yl.isDesktop) {
        const g4 = addGroup();
        addButton(g4, "lucide-help-circle", ti.labelCanvasHelp(), () => new host.s32CanvasHelp(this).open());
      }
      this.updateHistoryUI();
      this.syncReadonlyUi();
      wrapperEl.appendChild(controlsEl);
    }

    // ---------- options / readonly ----------

    setReadonly(readonly) {
      if (this.readonly === readonly) return;
      this.readonly = readonly;
      this.wrapperEl.toggleClass("mod-readonly", readonly);
      this.syncReadonlyUi();
      this.menu.render(true);
    }

    syncReadonlyUi() {
      const btn = this.quickSettingsButton && this.quickSettingsButton.querySelector("button");
      if (btn) {
        const ti = s13CanvasI18n();
        env().tv(btn, this.readonly ? "lucide-settings" : "lucide-lock");
        env().Mv(btn, this.readonly ? ti.labelDisableReadonly() : ti.labelCanvasSettings());
      }
    }

    // ---------- lifecycle ----------

    load() {
      const win = this.wrapperEl.win;
      this._spaceDown = (evt) => this.onSpaceKey(evt, true);
      this._spaceUp = (evt) => this.onSpaceKey(evt, false);
      win.addEventListener("keydown", this._spaceDown);
      win.addEventListener("keyup", this._spaceUp);
    }

    unload() {
      const win = this.wrapperEl.win;
      if (this._spaceDown) win.removeEventListener("keydown", this._spaceDown);
      if (this._spaceUp) win.removeEventListener("keyup", this._spaceUp);
      this._spaceDown = null;
      this._spaceUp = null;
      this.clear();
      this.cancelFrame();
    }

    clear() {
      this.staleSelection = null;
      this.selection.clear();
      for (const node of [...this.nodes.values()]) this.removeNode(node);
      for (const edge of [...this.edges.values()]) this.removeEdge(edge);
      this.nodeIndex.clear();
      this.edgeIndex.clear();
      this.history.clear();
      this.data = {};
      this.requestPushHistory.cancel();
      this.requestUpdateFileOpen.cancel();
      this.moved.clear();
      this.dirty.clear();
      this.lastNodesInViewport.clear();
      this.lastEdgesInViewport.clear();
      this.setViewport(0, 0, 0);
      this.setReadonly(false);
      this.updateHistoryUI();
      if (this.canvasPlaceholderEl) {
        this.canvasPlaceholderEl.detach();
        this.canvasPlaceholderEl = null;
      }
    }

    onResize() {
      const prev = this.canvasRect;
      const next = s13DomRect(this.wrapperEl);
      if (prev && env().Yl.isMobile && prev.height !== next.height && prev.height > 0 && next.height > 0) {
        const shift = (next.height - prev.height) / 2 / this.scale;
        this.y += shift;
        this.ty += shift;
      }
      this.canvasRect = next;
      if (env().Yl.isMobile && this.selection.size === 1) {
        const only = [...this.selection][0];
        if (only && only.isEditing) this.panIntoView(only.getBBox());
      }
      this.viewportChanged = true;
      this.requestFrame();
      if (next.width > 0 && this.zoomToFitQueued) {
        this.zoomToFitQueued = false;
        this.finishViewportAnimation = true;
        this.zoomToFit();
      }
    }

    // ---------- viewport state ----------

    setViewport(x, y, zoom) {
      if (this.x === x && this.y === y && this.zoom === zoom) return;
      this.x = this.tx = x;
      this.y = this.ty = y;
      this.zoom = this.tZoom = zoom;
      this.scale = Math.pow(2, zoom);
      this.markViewportChanged();
    }

    getState() { return { x: this.tx, y: this.ty, zoom: this.tZoom }; }

    setState(state) {
      if (state && typeof state.x === "number" && typeof state.y === "number" && typeof state.zoom === "number") {
        this.setViewport(state.x, state.y, state.zoom);
      }
      this.zoomToFitQueued = false;
    }

    markViewportChanged() {
      this.viewportChanged = true;
      this.requestFrame();
    }

    // ---------- coordinate mapping ----------

    domPosFromClient(p) {
      const r = this.canvasRect;
      return { x: p.x - r.cx, y: p.y - r.cy };
    }

    domPosFromEvt(e) { return this.domPosFromClient(pointOfEvent(e)); }

    posFromDom(p) { return { x: this.x + p.x / this.scale, y: this.y + p.y / this.scale }; }

    domFromPos(p) { return { x: (p.x - this.x) * this.scale, y: (p.y - this.y) * this.scale }; }

    posFromClient(p) { return this.posFromDom(this.domPosFromClient(p)); }

    posFromEvt(e) { return this.posFromClient(pointOfEvent(e)); }

    posCenter() { return this.posFromDom(point(0, 0)); }

    posInViewport(p) {
      const r = this.canvasRect;
      return !(p.x < r.minX || p.x > r.maxX || p.y < r.minY || p.y > r.maxY);
    }

    getViewportBBox() {
      const r = this.canvasRect;
      return boxUnion([
        ng02PointBox(this.posFromDom(point(r.minX, r.minY))),
        ng02PointBox(this.posFromDom(point(r.maxX, r.minY))),
        ng02PointBox(this.posFromDom(point(r.minX, r.maxY))),
        ng02PointBox(this.posFromDom(point(r.maxX, r.maxY))),
      ]);
    }

    hitTestNode(p, padding = 0) {
      const b = box(p.x - padding, p.y - padding, p.x + padding, p.y + padding);
      let best = null;
      for (const node of this.nodeIndex.search(b)) {
        if (!best || node.zIndex > best.zIndex) best = node;
      }
      return best;
    }

    get gridSpacing() { return ng02GridSpacing(this.zoom); }
    get snapDistance() { return Math.ceil(this.config.objectSnapDistance / this.scale); }
    get zoomBreakpoint() { return s13ZoomPanOffset - (this.options.zoomBreakpoint || 0); }

    getViewportNodes(excludeSelection) {
      const nodes = this.nodeIndex.search(this.getViewportBBox());
      if (!excludeSelection) return nodes;
      return nodes.filter((n) => !this.selection.has(n));
    }

    getIntersectingNodes(b) { return this.nodeIndex.search(b); }
    getIntersectingEdges(b) { return this.edgeIndex.search(b); }

    getContainingNodes(b) {
      return this.getIntersectingNodes(b).filter((n) => boxContains(b, n.getBBox()));
    }

    // ---------- viewport commands ----------

    zoomBy(delta, center) {
      this.tZoom += delta;
      this.zoomCenter = center || { x: 0, y: 0 };
      this.markViewportChanged();
    }

    panTo(x, y) {
      this.x = this.tx = x;
      this.y = this.ty = y;
      this.markViewportChanged();
    }

    panBy(dx, dy) {
      this.x += dx;
      this.y += dy;
      this.tx = this.x;
      this.ty = this.y;
      this.markViewportChanged();
    }

    zoomToBbox(bounds) {
      const r = this.canvasRect;
      if (!r || r.width <= 0 || r.height <= 0) return;
      const bw = Math.max(bounds.maxX - bounds.minX, 1e-6);
      const bh = Math.max(bounds.maxY - bounds.minY, 1e-6);
      const fit = Math.min(r.width / (1.1 * bw), r.height / (1.1 * bh));
      this.tZoom = Math.log2(fit);
      const c = boxCenter(bounds);
      this.tx = c.x;
      this.ty = c.y;
      this.zoomCenter = null;
      this.markViewportChanged();
    }

    zoomToFit() {
      if (this.nodes.size === 0) return;
      this.zoomToBbox(boxUnion([...this.nodes.values()].map((n) => n.getBBox())));
    }

    zoomToSelection() {
      if (this.selection.size === 0) return;
      this.zoomToBbox(boxUnion([...this.selection].map((i) => i.getBBox())));
    }

    panIntoView(bounds, growBy) {
      if (growBy === undefined) growBy = this.gridSpacing;
      const b = boxGrow(bounds, growBy);
      const vp = this.getViewportBBox();
      const halfW = this.canvasRect.width / 2 / this.scale;
      const halfH = this.canvasRect.height / 2 / this.scale;
      if (b.maxX - b.minX > vp.maxX - vp.minX || b.maxY - b.minY > vp.maxY - vp.minY) {
        this.zoomToBbox(b);
        return;
      }
      if (b.minX < vp.minX) this.tx = b.minX + halfW;
      if (b.maxX > vp.maxX) this.tx = b.maxX - halfW;
      if (b.minY < vp.minY) this.ty = b.minY + halfH;
      if (b.maxY > vp.maxY) this.ty = b.maxY - halfH;
      this.markViewportChanged();
    }

    smartZoom(e) {
      const p = this.posFromEvt(e);
      if (this.selection.size > 0) {
        const bb = this.menu.selection.bbox;
        if (bb && boxContains(bb, ng02PointBox(p))) {
          this.zoomToSelection();
          return;
        }
      }
      let best = null;
      let bestArea = Infinity;
      for (const node of this.getIntersectingNodes(ng02PointBox(p))) {
        const b = node.getBBox();
        if (!boxContains(b, ng02PointBox(p))) continue;
        const area = (b.maxX - b.minX) * (b.maxY - b.minY);
        if (area < bestArea) {
          bestArea = area;
          best = node;
        }
      }
      if (best) this.zoomToBbox(best.getBBox());
      else this.zoomToFit();
    }

    nudgeSelection(keyEvent, direction) {
      const nodes = [...this.selection].filter((n) => this._nodeItem(n));
      if (nodes.length === 0) return;
      const spacing = this.gridSpacing * (keyEvent.shiftKey ? 5 : 1);
      const deltas = {
        left: { x: -spacing, y: 0 }, right: { x: spacing, y: 0 },
        up: { x: 0, y: -spacing }, down: { x: 0, y: spacing },
      };
      const d = deltas[direction];
      if (!d) return;
      for (const node of nodes) node.moveTo({ x: node.x + d.x, y: node.y + d.y });
      if (this.options.snapToGrid) {
        const snapSpacing = this.gridSpacing;
        const b = boxUnion(nodes.map((n) => n.getBBox()));
        const rx = Math.round(b.minX % snapSpacing);
        const ry = Math.round(b.minY % snapSpacing);
        let sx = 0;
        let sy = 0;
        if (direction === "left") sx = -rx;
        else if (direction === "right") sx = rx > 0 ? snapSpacing - rx : -rx;
        else if (direction === "up") sy = -ry;
        else if (direction === "down") {
          if (ry > 0) sx += snapSpacing;
          else sy = -ry;
        }
        if (sx || sy) for (const node of nodes) node.moveTo({ x: node.x + sx, y: node.y + sy });
      }
      this.requestSave();
    }

    // ---------- frame loop ----------

    requestFrame() {
      if (this.frame !== null) return;
      const win = this.canvasEl.win;
      this.frameTime = performance.now();
      this.frame = win.requestAnimationFrame((t) => this.onFrame(t));
    }

    cancelFrame() {
      if (this.frame !== null) {
        this.canvasEl.win.cancelAnimationFrame(this.frame);
        this.frame = null;
      }
      if (this.pointerFrame !== null) {
        this.canvasEl.win.cancelAnimationFrame(this.pointerFrame);
        this.pointerFrame = null;
      }
    }

    onFrame(timestamp) {
      this.frame = null;
      const elapsed = timestamp - this.frameTime;
      let needFrame = false;
      let selMoved = false;

      // 1. viewport easing
      if (this.viewportChanged) {
        let ease = Math.pow(0.984, Math.max(elapsed, 0));
        if (this.finishViewportAnimation) {
          ease = 0;
          this.finishViewportAnimation = false;
        }
        const amount = 1 - ease;
        const tZoom = this.screenshotting ? this.tZoom : ng02Clamp(this.tZoom, NG02_ZOOM_MIN, NG02_ZOOM_MAX);
        if (tZoom !== this.tZoom) this.tZoom = tZoom;
        const zoomDelta = tZoom - this.zoom;
        if (!isFinite(zoomDelta)) {
          this.zoom = 0;
          this.scale = 1;
        } else if (tZoom === this.zoom) {
          this.scale = Math.pow(2, tZoom);
        } else if (this.zoomCenter) {
          const newZoom = this.zoom + zoomDelta * amount;
          const newScale = Math.pow(2, newZoom);
          const cx = this.zoomCenter.x;
          const cy = this.zoomCenter.y;
          const nx = this.x + cx / this.scale - cx / newScale;
          const ny = this.y + cy / this.scale - cy / newScale;
          this.zoom = newZoom;
          this.scale = newScale;
          this.x = nx;
          this.y = ny;
          this.tx = nx;
          this.ty = ny;
        } else {
          this.zoom += zoomDelta * amount;
          this.scale = Math.pow(2, this.zoom);
        }
        this.x += (this.tx - this.x) * amount;
        if (this.tx !== this.x && Math.abs(this.tx - this.x) < s13ZoomStep) this.x = this.tx;
        this.y += (this.ty - this.y) * amount;
        if (this.ty !== this.y && Math.abs(this.ty - this.y) < s13ZoomStep) this.y = this.ty;

        const r = this.canvasRect;
        this.wrapperEl.toggleClass("mod-zoomed-out", this.zoom <= s13ZoomPanOffset);
        this.canvasEl.style.transform =
          `translate(${r.width / 2}px, ${r.height / 2}px) scale(${this.scale}) translate(${-this.x}px, ${-this.y}px)`;
        if (window.__fpView) window.__fpView(this, this.x, this.y, this.scale, r.width, r.height);

        const spacing = this.gridSpacing;
        const pat = this.backgroundPatternEl;
        if (pat) {
          pat.setAttr("x", String(r.width / 2 - (this.x % spacing) * this.scale));
          pat.setAttr("y", String(r.height / 2 - (this.y % spacing) * this.scale));
          pat.setAttr("width", String(spacing * this.scale));
          pat.setAttr("height", String(spacing * this.scale));
        }

        const animating = this.x !== this.tx || this.y !== this.ty || this.zoom !== this.tZoom || Date.now() < this.pauseAnimation;
        this.wrapperEl.toggleClass("mod-animating", animating && !env().Yl.isIosApp);
        if (animating) {
          this.wasAnimating = true;
          needFrame = true;
        } else {
          this.wasAnimating = false;
          const s = this.screenshotting ? Math.max(1, this.scale) : this.scale;
          this.wrapperEl.style.setProperty("--zoom-multiplier", String(Math.sqrt(1 / s)));
          this.viewportChanged = false;
          this.app.workspace.requestSaveLayout();
        }
      }

      // 2. moved items -> spatial index refresh
      for (const item of this.moved) {
        if (this._nodeItem(item)) {
          for (const edge of this.getEdgesForNode(item)) this.moved.add(edge);
        }
      }
      for (const item of [...this.moved]) {
        if (this._nodeItem(item)) {
          this.nodeIndex.remove(item);
          this.nodeIndex.insert(item);
        } else if (this._edgeItem(item)) {
          this.edgeIndex.remove(item);
          this.edgeIndex.insert(item);
        }
        this.dirty.add(item);
        if (this.selection.has(item)) selMoved = true;
      }
      this.moved.clear();

      // 3. virtualize
      const vpBBox = this.getViewportBBox();
      let nodeCandidates;
      let edgeCandidates;
      if (this.screenshotting) {
        nodeCandidates = [...this.nodes.values()];
        edgeCandidates = [...this.edges.values()];
      } else {
        nodeCandidates = this.nodeIndex.search(vpBBox);
        edgeCandidates = this.edgeIndex.search(vpBBox);
      }
      const single = this.selection.size === 1 ? [...this.selection][0] : null;
      const keepNodes = new Set();
      let budget = this.screenshotting ? Infinity : NG02_ATTACH_BUDGET;
      for (const node of nodeCandidates) {
        if (node === single && node instanceof host.s13CanvasNode) keepNodes.add(node);
        else if (node.isAttached) keepNodes.add(node);
        else if (budget > 0) {
          budget--;
          keepNodes.add(node);
        }
      }
      const keepEdges = new Set(edgeCandidates);
      let attached = 0;
      for (const node of this.lastNodesInViewport) {
        if (!keepNodes.has(node)) {
          node.preDetach();
          node.detach();
        }
      }
      for (const edge of this.lastEdgesInViewport) {
        if (!keepEdges.has(edge)) edge.detach();
      }
      for (const node of keepNodes) {
        if (!node.isAttached) attached++;
        node.attach();
      }
      for (const edge of keepEdges) edge.attach();
      this.lastNodesInViewport = keepNodes;
      this.lastEdgesInViewport = keepEdges;
      if (attached > 0) needFrame = true;

      // 4. dirty items
      for (const item of [...this.dirty]) {
        if (item.isAttached) {
          item.render();
          this.dirty.delete(item);
        }
      }

      // 5. selection reconciliation
      const prev = this.staleSelection;
      this.staleSelection = null;
      if (prev) {
        const now = this.selection;
        for (const item of prev) {
          if (!now.has(item)) {
            if (prev.length === 1) item.blur();
            else item.deselect();
          }
        }
        for (const item of now) {
          if (!prev.includes(item)) {
            if (now.size === 1) item.focus();
            else item.select();
          }
        }
        const retained = prev.filter((i) => now.has(i));
        if (retained.length === 1) {
          const item = retained[0];
          if (prev.length === 1 && now.size > 1) {
            item.blur();
            item.select();
          } else if (prev.length > 1 && now.size === 1) {
            item.deselect();
            item.focus();
          }
        }
        if (env().Yl.isMobile) {
          const only = now.size === 1 ? [...now][0] : null;
          this.nodeInteractionLayer.setTarget(only instanceof host.s13CanvasNode ? only : null);
        }
      }
      const selChanged = this.selectionChanged;
      this.selectionChanged = false;
      if (selChanged || this.viewportChanged || selMoved) this.menu.render(selChanged);
      if (window.__fpFrame) window.__fpFrame(this, selChanged);
      this.nodeInteractionLayer.render();

      if (needFrame) this.requestFrame();
    }

    rerenderViewport() {
      for (const node of this.lastNodesInViewport) this.markDirty(node);
      for (const edge of this.lastEdgesInViewport) this.markDirty(edge);
    }

    virtualize() { this.requestFrame(); }

    // ---------- data codec / history ----------

    getData() {
      const nodes = [...this.nodes.values()].sort((a, b) => a.zIndex - b.zIndex).map((n) => n.getData());
      const edges = [...this.edges.values()].map((e) => e.getData());
      return { ...this.data, nodes, edges };
    }

    setData(data) {
      if (!data) return;
      if (Object.keys(data).length === 0) {
        this.createPlaceholder();
        return;
      }
      this.importData(data, true);
      this.data = data;
      this.pushHistory(data);
      if (this.nodes.size === 0) this.createPlaceholder();
    }

    importData(data, replace) {
      if (!data || !Array.isArray(data.nodes)) return undefined;
      const keptNodes = new Set();
      const nodeIds = new Set();
      let lastZ = -1;
      for (const nodeData of data.nodes) {
        if (!nodeData || typeof nodeData.id !== "string") continue;
        nodeIds.add(nodeData.id);
        let node = this.nodes.get(nodeData.id);
        if (!node) {
          const type = nodeData.type;
          if (type === "file") node = new host.s13CanvasFileNode(this, nodeData.id);
          else if (type === "text") node = new host.s32TextNode(this, nodeData.id);
          else if (type === "link") node = new host.s32LinkNode(this, nodeData.id);
          else if (type === "group") node = new host.s13CanvasGroupNode(this, nodeData.id);
          else continue;
          this.addNode(node);
          this.markMoved(node);
        }
        node.setData(nodeData);
        if (node.zIndex < lastZ) node.updateZIndex();
        lastZ = node.zIndex;
        keptNodes.add(node);
      }
      if (replace) {
        for (const node of [...this.nodes.values()]) {
          if (!nodeIds.has(node.id)) this.removeNode(node);
        }
      }
      const keptEdges = new Set();
      if (Array.isArray(data.edges)) {
        for (const edgeData of data.edges) {
          if (!edgeData || typeof edgeData.id !== "string") continue;
          const fromNode = this.nodes.get(edgeData.fromNode);
          const toNode = this.nodes.get(edgeData.toNode);
          if (!fromNode || !toNode) {
            if (replace) {
              const stale = this.edges.get(edgeData.id);
              if (stale) this.removeEdge(stale);
            }
            continue;
          }
          let edge = this.edges.get(edgeData.id);
          if (!edge) {
            if (!edgeData.fromSide) edgeData.fromSide = host.s32EdgeSide(fromNode, toNode);
            if (!edgeData.toSide) edgeData.toSide = host.s32EdgeSide(toNode, fromNode);
            if (!edgeData.fromEnd) edgeData.fromEnd = host.s32EdgeEndNone;
            if (!edgeData.toEnd) edgeData.toEnd = host.s32EdgeEndArrow;
            edge = new host.s13CanvasEdge(
              this,
              edgeData.id,
              { node: fromNode, side: edgeData.fromSide, end: edgeData.fromEnd },
              { node: toNode, side: edgeData.toSide, end: edgeData.toEnd },
            );
            this.addEdge(edge);
            this.markMoved(edge);
          }
          edge.setData(edgeData);
          keptEdges.add(edge);
        }
        if (replace) {
          for (const edge of [...this.edges.values()]) {
            if (!keptEdges.has(edge)) this.removeEdge(edge);
          }
        }
      }
      return keptNodes;
    }

    getSelectionData(selection) {
      if (!selection) selection = this.selection;
      const items = [...selection].sort((a, b) => a.zIndex - b.zIndex);
      const nodeSet = new Set(items.filter((i) => this._nodeItem(i)));
      const edgeSet = new Set(items.filter((i) => this._edgeItem(i)));
      for (const node of nodeSet) {
        for (const edge of this.getEdgesForNode(node)) {
          if (nodeSet.has(edge.from.node) && nodeSet.has(edge.to.node)) edgeSet.add(edge);
        }
      }
      const ordered = [...nodeSet, ...edgeSet].sort((a, b) => a.zIndex - b.zIndex);
      const nodes = ordered.filter((i) => nodeSet.has(i)).map((n) => n.getData());
      const edges = ordered.filter((i) => edgeSet.has(i)).map((e) => e.getData());
      const center = boxCenter(boxUnion(ordered.map((i) => i.getBBox())));
      return { nodes, edges, center };
    }

    cloneData(data, offset) {
      const idMap = new Map();
      for (const node of data.nodes || []) {
        const next = randomHex(16);
        idMap.set(node.id, next);
        node.id = next;
        if (offset) {
          node.x += offset.x;
          node.y += offset.y;
        }
      }
      for (const edge of data.edges || []) {
        edge.id = randomHex(16);
        edge.fromNode = idMap.get(edge.fromNode) || "";
        edge.toNode = idMap.get(edge.toNode) || "";
      }
      return data;
    }

    requestSave(save = true) {
      this.data = this.getData();
      if (save) this.requestPushHistory();
      this.view.requestSave();
    }

    pushHistory(data) {
      this.history.push(data);
      this.updateHistoryUI();
    }

    overrideHistory() {
      this.requestPushHistory.run();
      const data = this.getData();
      this.history.replace(data);
      this.updateHistoryUI();
      this.view.requestSave();
    }

    undo() {
      if (this.history.canUndo()) this.applyHistory(this.history.undo());
    }

    redo() {
      if (this.history.canRedo()) this.applyHistory(this.history.redo());
    }

    applyHistory(data) {
      this.importData(data, true);
      this.data = data;
      this.view.requestSave();
      this.updateHistoryUI();
    }

    updateHistoryUI() {
      if (this.undoBtnEl) this.undoBtnEl.toggleClass("is-disabled", !this.history.canUndo());
      if (this.redoBtnEl) this.redoBtnEl.toggleClass("is-disabled", !this.history.canRedo());
    }

    updateFileOpen(file) {
      const leaf = this.view.leaf;
      if (leaf && this.app.workspace.activeLeaf === leaf && leaf.view === this.view) {
        this.app.workspace.trigger("file-open", file ?? this.view.file);
      }
    }

    getZIndex() { return this.zIndexCounter++; }

    // ---------- node/edge bookkeeping ----------

    addNode(node) {
      this.nodes.set(node.id, node);
      this.requestFrame();
      if (this.canvasPlaceholderEl) {
        this.canvasPlaceholderEl.detach();
        this.canvasPlaceholderEl = null;
      }
    }

    removeNode(node) {
      for (const edge of [...this.getEdgesForNode(node)]) this.removeEdge(edge);
      if (this.selection.has(node)) this.deselect(node);
      this.nodes.delete(node.id);
      this.nodeIndex.remove(node);
      this.moved.delete(node);
      this.dirty.delete(node);
      this.lastNodesInViewport.delete(node);
      node.destroy();
      this.requestFrame();
    }

    addEdge(edge) {
      this.edges.set(edge.id, edge);
      this.edgeFrom.add(edge.from.node, edge);
      this.edgeTo.add(edge.to.node, edge);
      this.requestFrame();
    }

    removeEdge(edge) {
      if (!this.edges.has(edge.id)) return;
      if (this.selection.has(edge)) this.deselect(edge);
      this.edges.delete(edge.id);
      this.edgeFrom.delete(edge.from.node, edge);
      this.edgeTo.delete(edge.to.node, edge);
      this.edgeIndex.remove(edge);
      this.moved.delete(edge);
      this.dirty.delete(edge);
      this.lastEdgesInViewport.delete(edge);
      edge.destroy();
      this.requestFrame();
    }

    getEdgesForNode(node) {
      return this.edgeFrom.getArray(node).concat(this.edgeTo.getArray(node));
    }

    _nodeItem(item) { return item != null && this.nodes.get(item.id) === item; }
    _edgeItem(item) { return item != null && this.edges.get(item.id) === item; }

    // ---------- selection ----------

    updateSelection(mutate) {
      if (this.staleSelection === null) this.staleSelection = Array.from(this.selection);
      mutate();
      this.selectionChanged = true;
      this.requestFrame();
    }

    select(item) {
      if (this.selection.has(item)) return;
      this.updateSelection(() => this.selection.add(item));
    }

    deselect(item) {
      if (!this.selection.has(item)) return;
      this.updateSelection(() => this.selection.delete(item));
    }

    toggleSelect(item) {
      if (this.selection.has(item)) this.deselect(item);
      else this.select(item);
    }

    selectOnly(item) {
      if (this.selection.size === 1 && this.selection.has(item)) return;
      this.updateSelection(() => {
        this.selection.clear();
        this.selection.add(item);
      });
    }

    selectAll(items) {
      this.updateSelection(() => {
        this.selection.clear();
        for (const item of items) this.selection.add(item);
      });
    }

    deselectAll() {
      if (this.selection.size === 0) return;
      this.updateSelection(() => this.selection.clear());
    }

    setDragging(dragging) {
      if (this.isDragging === dragging) return;
      this.isDragging = dragging;
      this.wrapperEl.toggleClass("is-dragging", dragging);
      this.selectionChanged = true;
      this.requestFrame();
    }

    deleteSelection() {
      if (this.readonly) return;
      for (const item of [...this.selection]) {
        if (this._edgeItem(item)) this.removeEdge(item);
        else if (this._nodeItem(item)) this.removeNode(item);
      }
      this.deselectAll();
      this.requestSave();
    }

    markMoved(item) {
      this.moved.add(item);
      this.requestFrame();
    }

    markDirty(item) {
      this.dirty.add(item);
      if (this.selection.has(item)) this.selectionChanged = true;
      this.requestFrame();
    }

    // ---------- node factories ----------

    createTextNode({ pos, size, position, text, save = true, focus = true }) {
      const dimensions = size || this.config.defaultTextNodeDimensions;
      const node = new host.s32TextNode(this);
      node.moveAndResize(s13AnchorRect(pos, dimensions, position));
      this.addNode(node);
      if (text !== undefined) node.setText(text);
      if (save) this.requestSave();
      if (focus) {
        node.attach();
        node.render();
        this.selectOnly(node);
        node.startEditing();
      }
      return node;
    }

    createFileNode({ pos, size, position, file, subpath, save = true, focus = true }) {
      const dimensions = size || this.config.defaultFileNodeDimensions;
      const node = new host.s13CanvasFileNode(this);
      node.moveAndResize(s13AnchorRect(pos, dimensions, position));
      this.addNode(node);
      node.setFile(file, subpath || "");
      if (save) this.requestSave();
      if (focus) this.selectOnly(node);
      return node;
    }

    createFileNodes(files, pos) {
      const dim = this.config.defaultFileNodeDimensions;
      const pitchX = dim.width + 45;
      const pitchY = dim.height + 45;
      const created = [];
      let i = 0;
      for (const file of files) {
        const col = i % 10;
        const row = Math.floor(i / 10);
        created.push(this.createFileNode({
          pos: { x: pos.x + col * pitchX, y: pos.y + row * pitchY },
          save: false,
          focus: false,
          file,
        }));
        i++;
      }
      return created;
    }

    createLinkNode({ pos, size, position, url, save = true, focus = true }) {
      if (window.__fpUrl) url = window.__fpUrl(url);
      const yt = host.s32YouTubeRe.test(url);
      const dimensions = size || (yt ? { width: 640, height: 360 } : this.config.defaultFileNodeDimensions);
      const node = new host.s32LinkNode(this);
      node.moveAndResize(s13AnchorRect(pos, dimensions, position));
      this.addNode(node);
      node.setUrl(url);
      if (save) this.requestSave();
      if (focus) this.selectOnly(node);
      return node;
    }

    createGroupNode({ pos, size, position, label, save = true, focus = true }) {
      const dimensions = size || this.config.defaultFileNodeDimensions;
      const node = new host.s13CanvasGroupNode(this);
      node.moveAndResize(s13AnchorRect(pos, dimensions, position));
      this.addNode(node);
      node.setLabel(label !== undefined ? label : s13CanvasI18n().labelUntitledGroup());
      if (save) this.requestSave();
      if (focus) {
        this.selectOnly(node);
        node.attach();
        node.render();
        node.focusLabel();
      }
      return node;
    }

    createPlaceholder() {
      if (this.canvasPlaceholderEl) return this.canvasPlaceholderEl;
      const ti = s13CanvasI18n();
      const el = this.canvasEl.createDiv("canvas-placeholder-message");
      if (env().Yl.isMobile) {
        el.createDiv({ text: ti.labelDragPan() });
        el.createDiv({ text: ti.labelPinchZoom() });
        el.createDiv({ text: ti.labelLongpress() });
      } else {
        el.createDiv({ text: ti.labelDragFromBelow() });
        el.createDiv({ text: ti.labelSpaceDragPan() });
        el.createDiv({ text: `${host.keyNames.Mod} + ${ti.labelScrollToZoom()}` });
      }
      this.canvasPlaceholderEl = el;
      return el;
    }

    // ---------- snapping ----------

    canSnap(e) {
      return env().Yl.isMacOS ? !e.ctrlKey : !e.altKey;
    }

    getSnapping(sourceBoxes, targetBoxes, snapX, snapY) {
      const out = { x: 0, y: 0 };
      if (!sourceBoxes || sourceBoxes.length === 0) return out;
      const opts = this.options;
      const dist = this.snapDistance;
      let deltaX = 0;
      let deltaY = 0;
      let matchX = null;
      let matchY = null;
      const srcPts = sortedBoxPoints(sourceBoxes);
      const dstPts = sortedBoxPoints(targetBoxes);
      if (opts.snapToObjects) {
        if (snapX) {
          const m = s13MatchSpans(srcPts, dstPts, dist, "x");
          if (m) {
            matchX = m;
            deltaX = m.delta;
          }
        }
        if (snapY) {
          const m = s13MatchSpans(srcPts, dstPts, dist, "y");
          if (m) {
            matchY = m;
            deltaY = m.delta;
          }
        }
      }
      if (opts.snapToGrid) {
        const b = boxUnion(sourceBoxes);
        const spacing = this.gridSpacing;
        if (snapX && !matchX) deltaX = Math.round(b.minX / spacing) * spacing - b.minX;
        if (snapY && !matchY) deltaY = Math.round(b.minY / spacing) * spacing - b.minY;
      }
      if (matchX || matchY) this.renderSnapPoints(matchX, matchY, deltaX, deltaY);
      out.x = deltaX;
      out.y = deltaY;
      return out;
    }

    renderSnapPoints(matchX, matchY, deltaX, deltaY) {
      if (!this.snapContainerEl) {
        const svg = createSvg("svg", "canvas-snaps");
        svg.setAttr("width", "100%");
        svg.setAttr("height", "100%");
        svg.style.position = "absolute";
        svg.style.inset = "0";
        svg.style.pointerEvents = "none";
        svg.style.zIndex = String(this.zIndexCounter + 2);
        this.canvasEl.appendChild(svg);
        this.snapContainerEl = svg;
      }
      const svg = this.snapContainerEl;
      svg.empty();
      const stroke = "var(--canvas-snapping-guide, #7aa2f7)";
      const draw = (match, dx, dy) => {
        if (!match) return;
        const pts = [];
        for (const run of match.matches) {
          for (const p of run.src) pts.push(point(p.x + dx, p.y + dy));
          for (const p of run.dest) pts.push(point(p.x, p.y));
        }
        if (!pts.length) return;
        const b = boxUnion(pts.map(ng02PointBox));
        svg.createSvg("line", {
          attr: {
            x1: b.minX, y1: b.minY, x2: b.maxX, y2: b.maxY,
            stroke, "stroke-width": "1",
          },
        });
        for (const p of pts) {
          svg.createSvg("circle", { attr: { cx: p.x, cy: p.y, r: 4, fill: stroke } });
        }
      };
      draw(matchX, deltaX, 0);
      draw(matchY, 0, deltaY);
    }

    clearSnapPoints() {
      if (this.snapContainerEl) this.snapContainerEl.empty();
    }

    endSnapPointRendering() {
      if (this.snapContainerEl) {
        this.snapContainerEl.detach();
        this.snapContainerEl = null;
      }
    }

    // ---------- clipboard ----------

    handleCopy(e) {
      if (this.canvasEl.doc.activeElement !== this.wrapperEl) return;
      if (this.selection.size === 0) return;
      e.preventDefault();
      e.clipboardData.setData("basalt/canvas", JSON.stringify(this.getSelectionData()));
    }

    handleCut(e) {
      if (this.readonly) return;
      if (this.canvasEl.doc.activeElement !== this.wrapperEl) return;
      if (this.selection.size === 0) return;
      this.handleCopy(e);
      for (const item of [...this.selection]) {
        if (this._edgeItem(item)) this.removeEdge(item);
        else if (this._nodeItem(item)) this.removeNode(item);
      }
      this.deselectAll();
      this.requestSave();
    }

    async handlePaste(e) {
      if (e.defaultPrevented || this.readonly) return;
      if (this.canvasEl.doc.activeElement !== this.wrapperEl) return;
      e.preventDefault();
      const center = this.posCenter();
      const files = env().CP(e.clipboardData, "clipboard", true);
      if (files && files.length) {
        const attachments = await this.app.importAttachments(files, null);
        const created = this.createFileNodes(attachments, center);
        this.deselectAll();
        for (const node of created) this.select(node);
        this.requestSave();
        return;
      }
      const raw = e.clipboardData.getData("basalt/canvas");
      if (raw) {
        let data;
        try {
          data = JSON.parse(raw);
        } catch (err) {
          console.error(err);
          return;
        }
        if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return;
        const offset = data.center ? { x: center.x - data.center.x, y: center.y - data.center.y } : undefined;
        const cloned = this.cloneData(data, offset);
        const imported = this.importData(cloned, false) || new Set();
        this.deselectAll();
        this.requestSave();
        for (const node of imported) this.select(node);
        return;
      }
      const text = e.clipboardData.getData("text/plain");
      if (text) {
        if (host.s32IsHttpUrl(text)) {
          this.createLinkNode({ pos: center, url: text });
        } else {
          this.createTextNode({ pos: center, text });
        }
      }
    }

    // ---------- menus ----------

    showQuickSettingsMenu(menu) {
      const ti = s13CanvasI18n();
      const self = this;
      menu.addSections(["canvas"]);
      menu.addItem((item) =>
        item.setSection("canvas").setTitle(ti.optionSnapToGrid()).setIcon("lucide-grid")
          .setChecked(!!this.options.snapToGrid)
          .onClick(() => {
            self.options.snapToGrid = !self.options.snapToGrid;
            self.plugin.saveOptions();
            self.menu.render(true);
          }),
      );
      menu.addItem((item) =>
        item.setSection("canvas").setTitle(ti.optionSnapToObjects()).setIcon("snap-to-object")
          .setChecked(!!this.options.snapToObjects)
          .onClick(() => {
            self.options.snapToObjects = !self.options.snapToObjects;
            self.plugin.saveOptions();
            self.menu.render(true);
          }),
      );
      menu.addItem((item) =>
        item.setSection("canvas").setTitle(ti.labelReadonly()).setIcon("lucide-lock")
          .setChecked(this.readonly)
          .onClick(() => {
            self.setReadonly(!self.readonly);
            self.view.saveLocalData();
          }),
      );
    }

    showCreationMenu(menu, pos, size) {
      const ti = s13CanvasI18n();
      const self = this;
      menu.addSections(["create"]);
      menu.addItem((item) =>
        item.setSection("create").setTitle(ti.actionAddCard()).setIcon("lucide-sticky-note").onClick(() => {
          self.createTextNode({ pos, size });
        }),
      );
      if (window.__fpCreationMenu) window.__fpCreationMenu(menu, this, pos, size);
      menu.addItem((item) =>
        item.setSection("create").setTitle(ti.actionAddNote()).setIcon("lucide-file-text").onClick(() => {
          new host.CanvasFileSuggest(self, (file) => self.createFileNode({ pos, size, file }))
            .showAttachments(false).open();
        }),
      );
      menu.addItem((item) =>
        item.setSection("create").setTitle(ti.actionAddMedia()).setIcon("lucide-file-image").onClick(() => {
          new host.s32MediaSuggest(self, (file) => self.createFileNode({ pos, size, file })).open();
        }),
      );
      menu.addItem((item) =>
        item.setSection("create").setTitle(ti.actionAddWebsite()).setIcon("lucide-external-link").onClick(() => {
          new host.s32UrlModal(self.app, "", (url) => self.createLinkNode({ pos, size, url })).open();
        }),
      );
      menu.addItem((item) =>
        item.setSection("create").setTitle(ti.actionCreateGroup()).setIcon("create-group").onClick(() => {
          self.createGroupNode({ pos, size });
        }),
      );
    }

    onSelectionContextMenu(e) {
      const menu = host.Menu.forEvent(e);
      const ti = s13CanvasI18n();
      const iface = s13InterfaceI18n();
      const self = this;
      menu.addSections(["title", "open", "selection", "clipboard", "action", "view", "info", "", "danger"]);
      if (!this.readonly) {
        menu.addItem((item) =>
          item.setSection("danger").setTitle(ti.actionRemove()).setIcon("lucide-trash-2").setWarning(true)
            .onClick(() => self.deleteSelection()),
        );
      }
      menu.addItem((item) =>
        item.setSection("action").setTitle(ti.actionZoomToSelection()).setIcon("zoom-to-selection")
          .onClick(() => self.zoomToSelection()),
      );
      if (!this.readonly) {
        menu.addItem((item) =>
          item.setSection("action").setTitle(ti.actionCreateGroup()).setIcon("create-group").onClick(() => {
            const b = boxGrow(boxUnion([...self.selection].map((i) => i.getBBox())), 20);
            const r = rectOfBox(b);
            self.createGroupNode({ pos: { x: r.x, y: r.y }, size: { width: r.width, height: r.height } });
          }),
        );
        if (env().Yl.isDesktopApp) {
          const wc = () => env().electron && env().electron.webContents;
          menu.addItem((item) => item.setSection("clipboard").setTitle(iface.menu.cut()).setIcon("lucide-scissors").onClick(() => wc() && wc().cut()));
          menu.addItem((item) => item.setSection("clipboard").setTitle(iface.menu.copy()).setIcon("lucide-copy").onClick(() => wc() && wc().copy()));
          menu.addItem((item) => item.setSection("clipboard").setTitle(iface.menu.paste()).setIcon("lucide-clipboard-check").onClick(() => wc() && wc().paste()));
        }
      }
      this.app.workspace.trigger("canvas:selection-menu", menu, this);
      const files = [...this.selection].filter((i) => i instanceof host.s13CanvasFileNode && i.file);
      if (files.length > 1) {
        this.app.workspace.trigger("files-menu", menu, files, "canvas:selection-menu", null);
      }
    }
  }

  ng02InstallInput(CanvasController.prototype, host);
  ng02InstallExport(CanvasController.prototype, host);
  return CanvasController;
}
