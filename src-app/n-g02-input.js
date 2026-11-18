// g02 input layer: pointer/wheel/keyboard/touch gestures, drag sessions (node drag,
// drag-to-select, space-pan, temp-node ghost, auto-pan), clipboard-facing DOM handlers
// and drop handling. Installed onto CanvasController.prototype by n-g02-canvas.js.
import { env } from "./env.js";
import { pointOfEvent, boxOfPoints, boxContains, rectOfBox } from "./misc.js";
import { s13InterfaceI18n } from "./s13-consts.js";

const NG02_PAN_MARGIN = 30;
const NG02_PAN_MAX = 40;
const NG02_LONGPRESS_MS = 600;
const NG02_LONGPRESS_MOVE = 5;

function ng02InstallInput(proto, host) {
  const bare = (el) => {
    if (!el || typeof el.closest !== "function") return true;
    return !el.closest(
      ".canvas-node, .canvas-menu-container, .canvas-card-menu, .canvas-controls, .canvas-edges," +
      " .canvas-node-interaction-layer, .canvas-selection, .canvas-snaps, .canvas-path-label-wrapper," +
      " button, input, textarea, select, [contenteditable]",
    );
  };

  // ---------- space-pan mover ----------

  proto.onSpaceKey = function (e, down) {
    if (e.key !== " ") return;
    if (host.isEditableTarget(e.targetNode)) return;
    if (down) {
      if (e.repeat) return;
      if (this.selection.size === 1) {
        const only = [...this.selection][0];
        if (only && only.isEditing) return;
      }
      if (this.isHoldingSpace) return;
      this.isHoldingSpace = true;
      this.moverEl.style.zIndex = String(this.zIndexCounter + 4);
      this.wrapperEl.appendChild(this.moverEl);
      e.preventDefault();
    } else {
      if (!this.isHoldingSpace) return;
      this.isHoldingSpace = false;
      this.moverEl.detach();
    }
  };

  proto.onMoverPointerdown = function (e) {
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    this.setDragging(true);
    let last = this.posFromEvt(e);
    return host.dragWithThreshold(e, () => ({
      move: (evt) => {
        const p = this.posFromEvt(evt);
        this.panBy(last.x - p.x, last.y - p.y);
        last = p;
      },
      end: () => {},
      cleanup: () => this.setDragging(false),
    }), 0);
  };

  // ---------- pointer ----------

  proto.onPriorityPointerdown = function (e) {
    if (e.pointerType !== "mouse" || !e.isPrimary) return;
    const isMacCtrl = host.Platform.isMacOS && e.ctrlKey && e.button === 1;
    if (e.button === 1 && !isMacCtrl) {
      e.preventDefault();
      this.setDragging(true);
      let last = this.posFromEvt(e);
      host.dragWithThreshold(e, () => ({
        move: (evt) => {
          const p = this.posFromEvt(evt);
          this.panBy(last.x - p.x, last.y - p.y);
          last = p;
        },
        end: () => {},
        cleanup: () => this.setDragging(false),
      }), 0);
      return;
    }
    if (e.button === 2 || isMacCtrl) {
      host.dragWithThreshold(e, () => {
        let last = this.posFromEvt(e);
        return {
          move: (evt) => {
            const p = this.posFromEvt(evt);
            this.panBy(last.x - p.x, last.y - p.y);
            last = p;
          },
          end: () => {},
          cleanup: () => {
            host.s32SwallowEvent(this.wrapperEl, "contextmenu");
            this.setDragging(false);
          },
        };
      }, 5);
    }
  };

  proto.onPointerdown = function (e) {
    if (e.pointerType === "touch") return this.onTouchdown(e);
    if (e.button !== 0 || !e.isPrimary || e.defaultPrevented) return;
    if (!bare(e.targetNode)) return;
    if (host.isEditableTarget(e.targetNode)) return;
    const snapshot = new Set(this.selection);
    const additive = e.shiftKey;
    if (!additive) this.deselectAll();
    host.dragWithThreshold(e, () => this.handleDragToSelect(e, additive, snapshot));
  };

  proto.handleDragToSelect = function (e, additive, previousSelection) {
    const self = this;
    if (!this.dragSelectionBox) this.dragSelectionBox = new host.s32CanvasSelection(this);
    const boxEl = this.dragSelectionBox;
    const start = this.posFromEvt(e);
    boxEl.hide();
    return {
      move: (evt) => {
        const pos = self.posFromEvt(evt);
        const b = boxOfPoints(start, pos);
        boxEl.update(b);
        const hits = self.getIntersectingNodes(b).filter((n) => {
          if (n instanceof host.s13CanvasGroupNode) return boxContains(b, n.getBBox());
          return true;
        });
        let selected;
        if (additive) {
          selected = new Set(previousSelection);
          for (const n of hits) {
            if (selected.has(n)) selected.delete(n);
            else selected.add(n);
          }
        } else {
          selected = new Set(hits);
        }
        self.selectAll([...selected]);
      },
      end: (evt) => {
        boxEl.hide();
        if (host.keyModifiers.isModifier(evt, "Mod")) {
          const r = rectOfBox(boxEl.bbox);
          const pos = { x: r.x, y: r.y };
          const size = { width: r.width, height: r.height };
          switch (self.options.defaultModDragBehavior) {
            case "card":
              self.createTextNode({ pos, size });
              break;
            case "note":
              new host.CanvasFileSuggest(self, (file) => self.createFileNode({ pos, size, file }))
                .showAttachments(false).open();
              break;
            case "media":
              new host.s32MediaSuggest(self, (file) => self.createFileNode({ pos, size, file })).open();
              break;
            case "webpage":
              new host.s32UrlModal(self.app, "", (url) => self.createLinkNode({ pos, size, url })).open();
              break;
            case "group":
              self.createGroupNode({ pos, size });
              break;
            default:
            case "menu": {
              const menu = new host.Menu();
              self.showCreationMenu(menu, pos, size);
              const center = self.domFromPos({ x: pos.x + size.width / 2, y: pos.y + size.height / 2 });
              const r2 = self.canvasRect;
              menu.showAtPosition({ x: r2.cx + center.x, y: r2.cy + center.y });
            }
          }
        }
        host.s32SwallowEvent(self.wrapperEl, "click");
      },
      cancel: () => {
        boxEl.hide();
        self.selectAll([...previousSelection]);
      },
      cleanup: () => boxEl.hide(),
    };
  };

  proto.onPointermove = function (e) {
    if (env().Yl.isMobile || e.pointerType === "touch") return;
    this.pointer = { x: e.clientX, y: e.clientY };
    if (this.pointerFrame !== null) return;
    const win = this.canvasEl.win;
    this.pointerFrame = win.requestAnimationFrame(() => {
      this.pointerFrame = null;
      const p = this.posFromClient(this.pointer);
      let hit = this.hitTestNode(p, 8 / this.scale);
      if (hit && this.selection.size > 1 && this.selection.has(hit)) hit = null;
      if (this.nodeInteractionLayer.target !== hit) this.nodeInteractionLayer.setTarget(hit);
    });
  };

  proto.onDoubleClick = function (e) {
    if (this.isDragging || this.readonly || e.defaultPrevented) return;
    if (!bare(e.targetNode) || host.isEditableTarget(e.targetNode)) return;
    const pos = this.posFromEvt(e);
    this.createTextNode({ pos, position: "center" });
  };

  proto.onKeydown = function (e) {
    if (e.repeat || e.defaultPrevented) return;
    if (host.isEditableTarget(e.targetNode)) return;
    if (e.key === "Escape") {
      this.deselectAll();
      e.preventDefault();
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && !this.isDragging) {
      const doc = this.canvasEl.doc;
      if (doc && doc.activeElement === this.wrapperEl) {
        this.deleteSelection();
        e.preventDefault();
      }
    }
  };

  // ---------- wheel ----------

  proto.onWheel = function (e) {
    if (this.isDragging || e.defaultPrevented) return;
    const ti = s13CanvasI18n();
    void ti;
    if (host.Platform.isMacOS && e.ctrlKey && e.deltaX === 0 && e.deltaY === 0) {
      this.smartZoom(e);
      return;
    }
    const zoomKey = e.ctrlKey || e.metaKey;
    if (!(zoomKey || !host.s32Scrollable(e, this.wrapperEl))) return;
    e.preventDefault();
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 40;
      dy *= 40;
    } else if (e.deltaMode === 2) {
      dx *= 800;
      dy *= 800;
    }
    let zoomGesture = zoomKey || this.isHoldingSpace;
    const lineWheel = Math.abs(e.wheelDeltaY) === 240 && e.wheelDeltaX === 0;
    if (this.options.defaultWheelBehavior === "zoom" && !lineWheel) zoomGesture = !zoomGesture;
    if (zoomGesture) {
      let zdy = dy;
      if (host.Platform.isMacOS && dy % 1 !== 0) zdy = dy * 2;
      this.zoomBy(-zdy / 300, dy < 0 ? this.domPosFromEvt(e) : undefined);
      this.pauseAnimation = Date.now() + 200;
    } else if (e.shiftKey && e.deltaX === 0) {
      this.tx += (dy / this.scale) * 0.93;
    } else {
      this.tx += (dx / this.scale) * 0.93;
      this.ty += (dy / this.scale) * 0.93;
    }
    let synthetic = false;
    for (const [d, wd] of [[e.deltaX, e.wheelDeltaX], [e.deltaY, e.wheelDeltaY]]) {
      if (d !== 0 && Number.isInteger(wd) && Math.abs(wd) === 120 && wd === -3 * d) synthetic = true;
    }
    if (!synthetic) this.finishViewportAnimation = true;
    this.markViewportChanged();
  };

  // ---------- context menu / drop ----------

  proto.onContextMenu = function (e) {
    if (this.isDragging || this.readonly || e.defaultPrevented) return;
    if (!bare(e.targetNode)) return;
    e.preventDefault();
    this.deselectAll();
    const pos = this.posFromEvt(e);
    const menu = new host.Menu();
    this.showCreationMenu(menu, pos);
    menu.addSeparator();
    if (this.history.canUndo()) {
      menu.addItem((item) => item.setSection("history").setTitle(env().gm.setting.mobileToolbar.optionUndo())
        .setIcon("lucide-undo-2").onClick(() => this.undo()));
    }
    if (this.history.canRedo()) {
      menu.addItem((item) => item.setSection("history").setTitle(env().gm.setting.mobileToolbar.optionRedo())
        .setIcon("lucide-redo-2").onClick(() => this.redo()));
    }
    if (host.Platform.isDesktopApp) {
      menu.addItem((item) => item.setSection("clipboard").setTitle(s13InterfaceI18n().menu.paste())
        .setIcon("lucide-clipboard-check")
        .onClick(() => env().electron && env().electron.webContents && env().electron.webContents.paste()));
    }
    this.showQuickSettingsMenu(menu);
    menu.showAtMouseEvent(e);
  };

  proto.onDrop = function (evt, data, isOver) {
    void evt;
    void isOver;
    if (!data) return;
    if (data.type === "files" && Array.isArray(data.files)) {
      const pos = this.posCenter();
      const created = this.createFileNodes(data.files, pos);
      this.deselectAll();
      for (const node of created) this.select(node);
      this.requestSave();
    } else if (data.type === "link" && data.linktext) {
      const pos = this.posCenter();
      this.createLinkNode({ pos, url: data.linktext });
    }
  };

  // ---------- drag plumbing ----------

  proto.handleDragWithPan = function (e, handlers) {
    const self = this;
    const win = this.canvasEl.win;
    let panTimer = null;
    let lastEvt = e;

    const updatePan = (evt) => {
      lastEvt = evt;
      const r = self.canvasRect;
      const p = self.domPosFromClient({ x: evt.clientX, y: evt.clientY });
      let vx = 0;
      let vy = 0;
      const m = NG02_PAN_MARGIN;
      if (p.x < r.minX && r.minX - p.x <= m) vx = -Math.min(NG02_PAN_MAX, r.minX - p.x);
      else if (p.x > r.maxX && p.x - r.maxX <= m) vx = Math.min(NG02_PAN_MAX, p.x - r.maxX);
      if (p.y < r.minY && r.minY - p.y <= m) vy = -Math.min(NG02_PAN_MAX, r.minY - p.y);
      else if (p.y > r.maxY && p.y - r.maxY <= m) vy = Math.min(NG02_PAN_MAX, p.y - r.maxY);
      if (vx || vy) {
        if (!panTimer) {
          panTimer = win.setInterval(() => {
            const k = (0.5 / Math.sqrt(Math.max(self.scale, 0.01))) / 60;
            self.panBy(vx * k, vy * k);
          }, 1000 / 60);
        }
      } else if (panTimer) {
        win.clearInterval(panTimer);
        panTimer = null;
      }
    };

    const stopPan = () => {
      if (panTimer) {
        win.clearInterval(panTimer);
        panTimer = null;
      }
    };

    this.setDragging(true);
    return host.dragWithThreshold(e, () => ({
      move: (evt) => {
        updatePan(evt);
        if (handlers.move) handlers.move(evt);
      },
      end: (evt) => {
        stopPan();
        if (handlers.end) handlers.end(evt);
      },
      cancel: (evt) => {
        stopPan();
        if (handlers.cancel) handlers.cancel(evt);
      },
      cleanup: () => {
        stopPan();
        self.endSnapPointRendering();
        self.setDragging(false);
        if (handlers.cleanup) handlers.cleanup();
      },
      keydown: handlers.keydown ? (evt) => handlers.keydown(evt) : undefined,
      keyup: handlers.keyup ? (evt) => handlers.keyup(evt) : undefined,
      dragstart: handlers.dragstart ? (evt) => handlers.dragstart(evt) : undefined,
      drop: handlers.drop ? (evt) => handlers.drop(evt) : undefined,
      contextmenu: handlers.contextmenu ? (evt) => handlers.contextmenu(evt) : undefined,
    }), 0);
  };

  proto.dragTempNode = function (e, size, onDrop) {
    const dummy = new host.s32DummyNode(this);
    dummy.width = size.width;
    dummy.height = size.height;
    dummy.x = 0;
    dummy.y = 0;
    const win = this.canvasEl.win;
    let ghost = null;
    const show = () => {
      if (ghost) return;
      ghost = dummy;
      ghost.attach();
    };
    const cleanup = host.dragWithThreshold(e, () => ({
      move: (evt) => {
        show();
        const p = this.posFromEvt(evt);
        let x = p.x - size.width / 2;
        let y = p.y - size.height / 2;
        if (this.canSnap(evt)) {
          const spacing = this.gridSpacing;
          x = Math.round((p.x) / spacing) * spacing - size.width / 2;
          y = Math.round((p.y) / spacing) * spacing - size.height / 2;
        }
        ghost.x = x;
        ghost.y = y;
        ghost.render();
      },
      end: (evt) => {
        const dom = this.domPosFromClient({ x: evt.clientX, y: evt.clientY });
        if (this.posInViewport(dom)) {
          const p = this.posFromEvt(evt);
          onDrop({ x: ghost ? ghost.x : p.x - size.width / 2, y: ghost ? ghost.y : p.y - size.height / 2 });
        }
      },
      cleanup: () => {
        if (ghost) {
          ghost.detach();
          ghost.destroy();
        }
        host.s32SwallowEvent(this.wrapperEl, "click");
      },
    }), 0);
    void win;
    return cleanup;
  };

  // ---------- node drag ----------

  proto.handleSelectionDrag = function (e, targetNode, draggedNode) {
    if (this.readonly) return;
    const canvas = this;
    if (draggedNode && !this.selection.has(draggedNode)) this.selectOnly(draggedNode);

    const selected = [...this.selection];
    const groups = selected.filter((n) => n instanceof host.s13CanvasGroupNode);
    const dragNodes = new Set(selected.filter((n) => this._nodeItem(n)));
    for (const g of groups) {
      for (const n of this.getContainingNodes(g.getBBox())) {
        if (n !== g) dragNodes.add(n);
      }
    }
    if (dragNodes.size === 0) return;

    const origins = new Map();
    for (const node of dragNodes) {
      origins.set(node, { x: node.x, y: node.y });
      node.nodeEl.addClass("is-dragging");
      node.updateZIndex();
    }

    const start = this.posFromEvt(e);
    let totalDelta = { x: 0, y: 0 };
    let cloneMode = false;
    let ghosts = null;
    let cloneActive = false;

    const cloneModifier = () => (host.Platform.isMacOS ? e.altKey : e.ctrlKey);

    const syncGhosts = (delta) => {
      if (!ghosts) return;
      let i = 0;
      for (const node of dragNodes) {
        const g = ghosts[i++];
        const o = origins.get(node);
        g.x = o.x + delta.x;
        g.y = o.y + delta.y;
        g.render();
      }
    };

    const setClone = (on) => {
      if (on === cloneActive) return;
      cloneActive = on;
      if (on && !ghosts) {
        ghosts = [];
        for (const node of dragNodes) {
          const g = new host.s32DummyNode(canvas);
          g.width = node.width;
          g.height = node.height;
          const o = origins.get(node);
          g.x = o.x + totalDelta.x;
          g.y = o.y + totalDelta.y;
          g.attach();
          g.render();
          ghosts.push(g);
        }
      } else if (!on && ghosts) {
        for (const g of ghosts) {
          g.detach();
          g.destroy();
        }
        ghosts = null;
      }
      for (const node of dragNodes) {
        const o = origins.get(node);
        node.moveTo(cloneActive ? o : { x: o.x + totalDelta.x, y: o.y + totalDelta.y });
      }
      if (cloneActive) syncGhosts(totalDelta);
    };

    const snapTargets = () => {
      const targets = [];
      const viewportNodes = this.getViewportNodes(true);
      const dragSet = new Set(dragNodes);
      for (const n of viewportNodes) {
        if (dragSet.has(n)) continue;
        if (groups.length > 0 && !(n instanceof host.s13CanvasGroupNode)) continue;
        targets.push(n);
      }
      return targets;
    };

    const snapBoxes = () => {
      if (groups.length === 1) return [groups[0].getBBox()];
      if (groups.length > 1) {
        const outer = [];
        for (const g of groups) {
          const gb = g.getBBox();
          const inside = groups.some((o) => o !== g && boxContains(o.getBBox(), gb));
          if (!inside) outer.push(gb);
        }
        return outer;
      }
      return [...dragNodes].map((n) => n.getBBox());
    };

    canvas.handleDragWithPan(e, {
      move: (evt) => {
        cloneMode = cloneModifier();
        setClone(cloneMode);
        const pos = canvas.posFromEvt(evt);
        let dx = pos.x - start.x;
        let dy = pos.y - start.y;
        if (evt.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        totalDelta = { x: dx, y: dy };
        let snapX = dx !== 0;
        let snapY = dy !== 0;
        let snapDelta = { x: 0, y: 0 };
        if (canvas.canSnap(evt) && (snapX || snapY)) {
          const srcBoxes = snapBoxes().map((b) => ({
            minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy,
          }));
          const dstBoxes = snapTargets().map((n) => n.getBBox());
          const snapped = canvas.getSnapping(srcBoxes, dstBoxes, snapX, snapY);
          snapDelta = snapped;
          dx += snapped.x;
          dy += snapped.y;
        } else {
          canvas.clearSnapPoints();
        }
        for (const node of dragNodes) {
          const o = origins.get(node);
          node.moveTo({ x: o.x + dx, y: o.y + dy });
        }
        if (cloneActive) syncGhosts({ x: dx, y: dy });
      },
      keydown: (evt) => {
        if (evt.key === "Alt" || evt.key === "Control") setClone(cloneModifier());
      },
      keyup: (evt) => {
        if (evt.key === "Alt" || evt.key === "Control") setClone(cloneModifier());
      },
      end: (evt) => {
        cloneMode = cloneModifier();
        setClone(cloneMode);
        if (cloneMode && ghosts) {
          const data = canvas.getSelectionData(canvas.selection);
          const delta = { x: totalDelta.x, y: totalDelta.y };
          const cloned = canvas.cloneData(data, delta);
          const imported = canvas.importData(cloned, false) || new Set();
          canvas.deselectAll();
          canvas.requestSave();
          canvas.selectAll([...imported]);
        } else {
          canvas.requestSave();
        }
        canvas.clearSnapPoints();
        for (const node of dragNodes) node.nodeEl.removeClass("is-dragging");
        void targetNode;
      },
      cancel: () => {
        setClone(false);
        for (const node of dragNodes) {
          const o = origins.get(node);
          node.moveTo(o);
          node.nodeEl.removeClass("is-dragging");
        }
        canvas.clearSnapPoints();
      },
      cleanup: () => {
        setClone(false);
        for (const node of dragNodes) node.nodeEl.removeClass("is-dragging");
        canvas.clearSnapPoints();
        if (targetNode) host.s32SwallowEvent(targetNode, "click");
      },
    });
  };

  // ---------- touch ----------

  proto.onTouchdown = function (e) {
    if (!e.isPrimary || e.pointerType !== "touch") return;
    if (host.s32Scrollable(e, this.wrapperEl, true)) return;
    const self = this;
    const win = this.canvasEl.win;
    const startClient = { x: e.clientX, y: e.clientY };
    const startCanvas = this.posFromEvt(e);
    let longPressed = false;
    let panning = false;
    let last = startCanvas;
    let second = null;
    let pinchDist = 0;
    let pinchZoom = 0;
    let cleanup = null;

    const pointers = new Map();
    pointers.set(e.pointerId, startClient);

    const remove = () => {
      win.clearTimeout(timer);
      win.removeEventListener("pointermove", onMove);
      win.removeEventListener("pointerup", onUp);
      win.removeEventListener("pointercancel", onUp);
    };

    const onMove = (evt) => {
      if (!pointers.has(evt.pointerId)) return;
      pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
      const pts = [...pointers.values()];
      if (pts.length >= 2) {
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchDist === 0) {
          pinchDist = d;
          pinchZoom = self.zoom;
          panning = false;
        } else if (d > 0) {
          const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          const dom = self.domPosFromClient(mid);
          const canvasMid = self.posFromClient(mid);
          const targetZoom = ng02ClampT(Math.log2(Math.pow(2, pinchZoom) * (d / pinchDist)), -4, 1);
          const newScale = Math.pow(2, targetZoom);
          // keep the canvas point under the pinch midpoint fixed
          self.x = canvasMid.x - dom.x / newScale;
          self.y = canvasMid.y - dom.y / newScale;
          self.zoom = targetZoom;
          self.tZoom = targetZoom;
          self.tx = self.x;
          self.ty = self.y;
          self.scale = newScale;
          self.pauseAnimation = Date.now() + 200;
          self.markViewportChanged();
        }
        return;
      }
      const p = self.posFromEvt(evt);
      const movedFar = Math.hypot(evt.clientX - startClient.x, evt.clientY - startClient.y) > NG02_LONGPRESS_MOVE;
      if (movedFar) {
        win.clearTimeout(timer);
        panning = true;
      }
      if (panning || longPressed) {
        const dx = p.x - last.x;
        const dy = p.y - last.y;
        if (dx || dy) {
          self.panBy(dx, dy);
          last = p;
        }
      } else {
        last = p;
      }
      second = evt;
    };

    const onUp = (evt) => {
      pointers.delete(evt.pointerId);
      if (pointers.size === 0) {
        remove();
        if (cleanup) cleanup();
        if (!longPressed && !panning) {
          // tap on bare wrapper clears the selection
          if (bare(evt.targetNode)) self.deselectAll();
        }
        if (longPressed) {
          const ce = new PointerEvent("contextmenu", {
            bubbles: true, cancelable: true, clientX: evt.clientX, clientY: evt.clientY,
          });
          evt.target.dispatchEvent(ce);
        }
      }
    };

    const timer = win.setTimeout(() => {
      if (pointers.size !== 1) return;
      longPressed = true;
      panning = false;
      if (navigator.vibrate) navigator.vibrate(100);
      host.s32LongPressFx(win, startClient.x, startClient.y);
      const pos = self.posFromEvt({ clientX: startClient.x, clientY: startClient.y });
      const snapshot = new Set(self.selection);
      const additive = false;
      cleanup = host.dragWithThreshold(e, () => self.handleDragToSelect(e, additive, snapshot), 0);
      void pos;
    }, NG02_LONGPRESS_MS);

    win.addEventListener("pointermove", onMove);
    win.addEventListener("pointerup", onUp);
    win.addEventListener("pointercancel", onUp);
  };
}

function ng02ClampT(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
