// Canvas interaction pieces: the selection bounding box with its resize handles.
import { env } from "./env.js";
import { box, boxGrow, rectOfBox, boxOfRect, sortedBoxPoints, boxUnion, point, rect, rgbToHex } from "./misc.js";
import { setElementTooltip } from "./tooltip.js";
import { makeHotkey } from "./text.js";
import { s13CanvasI18n, s13InterfaceI18n } from "./s13-consts.js";
import { s13ResizeOrigin, s13MatchSpans } from "./s13-geom.js";

const s13CDiv = (...args) => env().createDiv(...args);

let S13CanvasSelection = null;

/**
 * The dashed selection rectangle drawn around the current canvas selection, with eight
 * resize handles. Dragging a handle resizes every selected node proportionally, honouring
 * snap-to-grid/object, aspect ratio (Shift inverts it) and the minimum size.
 */
export function defineS13CanvasSelection(host) {
  function CanvasSelection(canvas, className) {
    const self = this;
    this.bbox = box(0, 0, 0, 0);
    this.resizerEls = [];
    this.canvas = canvas;
    this.selectionEl = s13CDiv("canvas-selection" + (className ? " " + className : ""));
    const addSide = (name) => {
      const el = s13CDiv({ cls: "canvas-node-resizer", attr: { "data-resize": name } });
      el.addEventListener("pointerdown", (event) => {
        if (event.targetNode === el && event.pointerType === "mouse") self.onResizePointerdown(event, name);
      });
      if (name !== "bottom" && name !== "right") {
        el.addEventListener("dblclick", (event) => {
          for (const node of Array.from(self.canvas.selection)) {
            if (node instanceof host.s13CanvasNode) node.onResizeDblclick(event, name);
          }
        });
      }
      self.resizerEls.push(el);
    };
    for (const side of ["top", "right", "bottom", "left"]) addSide(side);
    const addCorner = (name) => {
      const el = s13CDiv({ cls: "canvas-node-resizer", attr: { "data-resize": name } });
      el.addEventListener("pointerdown", (event) => self.onResizePointerdown(event, name));
      self.resizerEls.push(el);
    };
    for (const corner of ["topright", "bottomright", "bottomleft", "topleft"]) addCorner(corner);
  }

  CanvasSelection.prototype.update = function (bbox) {
    this.bbox = bbox;
    const el = this.selectionEl;
    const resizers = this.resizerEls;
    if (!el.parentNode) this.canvas.canvasEl.appendChild(el);
    for (const resizer of resizers) el.appendChild(resizer);
    const rect = rectOfBox(boxGrow(bbox, 10));
    el.setCssStyles({
      transform: "translate(" + rect.x + "px, " + rect.y + "px)",
      width: rect.width + "px",
      height: rect.height + "px",
    });
  };

  CanvasSelection.prototype.onResizePointerdown = function (event, handle) {
    const self = this;
    if (!event.isPrimary || event.button !== 0 || event.pointerType !== "mouse") return;
    event.preventDefault();
    host.dragWithThreshold(event, () => {
      const bbox = self.bbox;
      const canvas = self.canvas;
      const rect = rectOfBox(bbox);
      const startX = rect.x;
      const startY = rect.y;
      const startW = rect.width;
      const startH = rect.height;
      const options = canvas.options;
      const snapToGrid = options.snapToGrid;
      const snapToObjects = options.snapToObjects;
      const minDim = canvas.config.minContainerDimension;
      const nodes = Array.from(canvas.selection);
      const nodeRects = [];
      const sizeRatios = [];
      const relBoxes = [];
      for (const node of nodes) {
        node.nodeEl.addClass("is-dragging");
        nodeRects.push(node.rect);
        const b = node.getBBox();
        sizeRatios.push({ width: (b.maxX - b.minX) / startW, height: (b.maxY - b.minY) / startH });
        relBoxes.push({
          minX: (b.minX - bbox.minX) / startW,
          minY: (b.minY - bbox.minY) / startH,
          maxX: (b.maxX - bbox.maxX) / startW,
          maxY: (b.maxY - bbox.maxY) / startH,
        });
      }
      const minW = minDim / Math.min(...sizeRatios.map((r) => r.width));
      const minH = minDim / Math.min(...sizeRatios.map((r) => r.height));
      return {
        move: (moveEvent) => {
          const pos = canvas.posFromEvt(moveEvent);
          canvas.clearSnapPoints();
          const { source, resizeX, resizeY } = s13ResizeOrigin(handle, pos, { x: startX, y: startY, width: startW, height: startH });
          let snapX = null;
          let snapY = null;
          let dx = 0;
          let dy = 0;
          if (canvas.canSnap(moveEvent)) {
            if (snapToObjects) {
              const srcPoints = sortedBoxPoints([boxOfRect(source)]);
              const nodePoints = sortedBoxPoints(canvas.getViewportNodes(true).map(boxOfRect));
              const dist = canvas.snapDistance;
              if (resizeX) {
                const match = s13MatchSpans(srcPoints, nodePoints, dist, "x");
                if (match) {
                  snapX = match;
                  dx = match.delta;
                }
              }
              if (resizeY) {
                const match = s13MatchSpans(srcPoints, nodePoints, dist, "y");
                if (match) {
                  snapY = match;
                  dy = match.delta;
                }
              }
            }
            if (snapToGrid) {
              const spacing = canvas.gridSpacing;
              if (resizeX && !snapX) dx = Math.round(pos.x / spacing) * spacing - pos.x;
              if (resizeY && !snapY) dy = Math.round(pos.y / spacing) * spacing - pos.y;
            }
          }
          const rawX = pos.x + dx;
          const rawY = pos.y + dy;
          if (handle.includes("top")) {
            bbox.minY = Math.min(bbox.maxY - minH, rawY);
            if (bbox.minY !== rawY) {
              snapY = null;
              dy = bbox.minY - pos.y;
            }
          }
          if (handle.includes("left")) {
            bbox.minX = Math.min(bbox.maxX - minW, rawX);
            if (bbox.minX !== rawX) {
              snapX = null;
              dx = bbox.minX - pos.x;
            }
          }
          if (handle.includes("bottom")) {
            bbox.maxY = Math.max(bbox.minY + minH, rawY);
            if (bbox.maxY !== rawY) {
              snapY = null;
              dy = bbox.maxY - pos.y;
            }
          }
          if (handle.includes("right")) {
            bbox.maxX = Math.max(bbox.minX + minW, rawX);
            if (bbox.maxX !== rawX) {
              snapX = null;
              dx = bbox.maxX - pos.x;
            }
          }
          const next = {
            x: bbox.minX,
            y: bbox.minY,
            width: bbox.maxX - bbox.minX,
            height: bbox.maxY - bbox.minY,
          };
          let lockAspect = nodes.some((node) => node.aspectRatio);
          if (moveEvent.shiftKey) lockAspect = !lockAspect;
          let aspect = 0;
          if (lockAspect && startH !== 0) aspect = startW / startH;
          if (aspect !== 0) {
            let w = next.width;
            let h = next.height;
            if (resizeX && resizeY) {
              const big = Math.max(w, h * aspect);
              h = Math.max(h, w / aspect);
              w = big;
              if (w !== next.width) snapX = null;
              else if (h !== next.height) snapY = null;
            } else if (resizeX) {
              h = w / aspect;
            } else if (resizeY) {
              w = h * aspect;
            }
            if (handle.includes("left")) {
              const newX = startX + startW - w;
              dx += newX - next.x;
              next.x = newX;
            }
            if (handle.includes("top")) {
              const newY = startY + startH - h;
              dy += newY - next.y;
              next.y = newY;
            }
            if (handle.includes("right")) dx += w - next.width;
            if (handle.includes("bottom")) dy += h - next.height;
            next.width = w;
            next.height = h;
          }
          if (snapX || snapY) canvas.renderSnapPoints(snapX, snapY, dx, dy);
          const bounds = boxOfRect(next);
          for (let i = 0; i < nodes.length; i++) {
            const rel = relBoxes[i];
            const target = {
              minX: bounds.minX + rel.minX * next.width,
              minY: bounds.minY + rel.minY * next.height,
              maxX: bounds.maxX + rel.maxX * next.width,
              maxY: bounds.maxY + rel.maxY * next.height,
            };
            nodes[i].moveAndResize(rectOfBox(target));
          }
        },
        end: () => canvas.requestSave(),
        cancel: () => {
          for (let i = 0; i < nodes.length; i++) nodes[i].moveAndResize(nodeRects[i]);
          canvas.requestSave();
        },
        cleanup: () => {
          for (const node of nodes) node.nodeEl.removeClass("is-dragging");
        },
      };
    });
  };

  CanvasSelection.prototype.hide = function () {
    this.selectionEl.remove();
  };

  S13CanvasSelection = CanvasSelection;
  return CanvasSelection;
}

/** The floating context menu shown over the current canvas selection. */
export function defineS13CanvasMenu(host) {

  function CanvasMenu(canvas) {
    const self = this;
    this.canvas = canvas;
    const containerEl = this.containerEl = s13CDiv("canvas-menu-container");
    this.menuEl = containerEl.createDiv("canvas-menu");
    this.selection = new S13CanvasSelection(canvas, "mod-group-selection");
    const selEl = this.selection.selectionEl;
    selEl.addEventListener("contextmenu", (event) => {
      canvas.onSelectionContextMenu(event);
      event.preventDefault();
    });
    selEl.addEventListener("pointerdown", (event) => {
      if (event.isPrimary && event.button === 0 && !event.defaultPrevented) {
        host.dragWithThreshold(event, () => canvas.handleSelectionDrag(event, selEl));
      }
    });
  }

  CanvasMenu.prototype.render = function (showMenu) {
    const self = this;
    const canvas = this.canvas;
    const selection = this.selection;
    const containerEl = this.containerEl;
    const menuEl = this.menuEl;
    const app = canvas.app;
    const nodes = Array.from(canvas.selection);
    if (nodes.length === 0) {
      containerEl.detach();
      menuEl.empty();
      selection.hide();
      return;
    }
    nodes.sort((a, b) => a.zIndex - b.zIndex);
    const single = nodes.length === 1;
    const last = nodes.at(-1);
    const bbox = boxUnion(nodes.map((node) => node.getBBox()));
    const minX = bbox.minX;
    const maxX = bbox.maxX;
    const minY = bbox.minY;
    if (single) selection.hide();
    else selection.update(bbox);
    if (canvas.isDragging) {
      containerEl.detach();
      menuEl.empty();
      return;
    }
    canvas.wrapperEl.append(containerEl);
    if (showMenu) {
      let subBtn = null;
      let submenu = null;
      let subType = null;
      menuEl.empty();
      const addButton = (parent, title, icon, onclick, force) => {
        if (!canvas.readonly || force) {
          const btn = parent.createEl("button", "clickable-icon");
          setElementTooltip(btn, title, { placement: "top" });
          host.setIcon(btn, icon);
          btn.addEventListener("click", onclick);
        }
      };
      const ti = s13CanvasI18n();
      addButton(menuEl, ti.actionRemove(), "lucide-trash-2", () => canvas.deleteSelection());
      let color = last.color;
      addButton(menuEl, ti.actionSetColor(), "lucide-palette", (event) => {
        const btn = event.currentTarget;
        if (submenu) {
          subBtn.removeClass("is-active");
          submenu.remove();
          submenu = null;
          if (subType === "color") return;
        }
        subBtn = btn;
        btn.addClass("is-active");
        submenu = menuEl.createDiv("canvas-submenu");
        subType = "color";
        const applyColor = (value, save = true) => {
          for (const node of nodes) node.setColor(value, !save);
          color = value;
          if (save) {
            submenu.remove();
            submenu = null;
          }
          canvas.requestSave();
        };
        let hasActive = false;
        const addSwatch = (value) => {
          const item = submenu.createDiv("canvas-color-picker-item");
          if (color === value) {
            item.addClass("is-active");
            hasActive = true;
          }
          if (value) item.addClass("mod-canvas-color-" + value);
          item.addEventListener("click", () => applyColor(value));
        };
        addSwatch("");
        for (let i = 1; i <= 6; i++) addSwatch(String(i));
        const custom = submenu.createDiv("canvas-color-picker-item canvas-color-picker-custom");
        const input = custom.createEl("input", { type: "color" });
        custom.style.setProperty("--canvas-color", "0,0,0");
        if (!hasActive) {
          const parsed = host.s13ParseColor(color);
          if (parsed) {
            input.value = rgbToHex(parsed);
            custom.style.setProperty("--canvas-color", parsed.r + "," + parsed.g + "," + parsed.b);
            custom.addClass("is-active");
          }
        }
        input.addEventListener("change", () => {
          if (window.__bsRecent) window.__bsRecent.add(input.value);
          return applyColor(input.value);
        });
        input.addEventListener("input", () => applyColor(input.value, false));
        if (window.__bsRecentRow) window.__bsRecentRow(submenu, applyColor);
      });
      const hotkey = host.formatHotkey(makeHotkey(["Shift"], "2"));
      if (window.__fpToolbar) window.__fpToolbar(menuEl, nodes, canvas);
      addButton(menuEl, ti.actionZoomToSelection() + "\n(" + hotkey + ")", "zoom-to-selection", () => canvas.zoomToSelection(), true);
      if (!single && last instanceof host.s13CanvasNode) {
        addButton(menuEl, ti.actionCreateGroup(), "create-group", () => {
          const rect = rectOfBox(boxGrow(boxUnion(Array.from(canvas.selection.values()).map((node) => node.getBBox())), 20));
          canvas.createGroupNode({ pos: rect, size: rect });
        });
      }
      if ((!single && last instanceof host.s13CanvasNode) || (single && last instanceof host.s13CanvasGroupNode)) {
        const alignTargets = () => {
          if (single && last instanceof host.s13CanvasGroupNode) {
            const b = last.getBBox();
            return [canvas.getContainingNodes(b).filter((node) => node !== last), boxGrow(b, -20)];
          }
          const groupNodes = nodes.filter((node) => node instanceof host.s13CanvasNode);
          return [groupNodes, boxUnion(groupNodes.map((node) => node.getBBox()))];
        };
        addButton(menuEl, ti.actionAlign(), "lucide-align-start-vertical", (event) => {
          const btn = event.currentTarget;
          if (btn.hasClass("has-active-menu")) return;
          const align = (mode) => {
            const [targets, box] = alignTargets();
            for (const node of targets) {
              if (mode === "left") node.moveTo(point(box.minX, node.y));
              else if (mode === "right") node.moveTo(point(box.maxX - node.width, node.y));
              else if (mode === "top") node.moveTo(point(node.x, box.minY));
              else if (mode === "bottom") node.moveTo(point(node.x, box.maxY - node.height));
              else if (mode === "center") node.moveTo(point((box.minX + box.maxX - node.width) / 2, node.y));
              else if (mode === "middle") node.moveTo(point(node.x, (box.minY + box.maxY - node.height) / 2));
            }
            canvas.requestSave();
          };
          const distribute = (axis) => {
            const [targets, box] = alignTargets();
            if (targets.length <= 1) return;
            if (axis === "horizontal") {
              let total = 0;
              for (const node of targets) total += node.width;
              targets.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
              const gap = (box.maxX - box.minX - total) / (targets.length - 1);
              for (let i = 1; i < targets.length - 1; i++) {
                const prev = targets[i - 1];
                const node = targets[i];
                node.moveTo(point(prev.x + prev.width + gap, node.y));
              }
            } else if (axis === "vertical") {
              let total = 0;
              for (const node of targets) total += node.height;
              targets.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
              const gap = (box.maxY - box.minY - total) / (targets.length - 1);
              for (let i = 1; i < targets.length - 1; i++) {
                const prev = targets[i - 1];
                const node = targets[i];
                node.moveTo(point(node.x, prev.y + prev.height + gap));
              }
            }
            canvas.requestSave();
          };
          const justify = (axis) => {
            const [targets, box] = alignTargets();
            if (targets.length <= 1) return;
            if (axis === "horizontal") {
              for (const node of targets) node.moveAndResize(rect(box.minX, node.y, box.maxX - box.minX, node.height));
            } else if (axis === "vertical") {
              for (const node of targets) node.moveAndResize(rect(node.x, box.minY, node.width, box.maxY - box.minY));
            }
            canvas.requestSave();
          };
          const arrange = (mode) => {
            const [targets, box] = alignTargets();
            if (targets.length <= 1) return;
            targets.sort((a, b) => a.y - b.y);
            const rows = [];
            let rowBottom = -Infinity;
            for (const node of targets) {
              if (node.y < rowBottom) {
                rows.at(-1).push(node);
                const bottom = node.y + node.height;
                if (bottom < rowBottom) rowBottom = bottom;
              } else {
                rows.push([node]);
                rowBottom = node.y + node.height;
              }
            }
            for (const row of rows) row.sort((a, b) => a.x - b.x);
            const flat = rows.flat();
            let anchor = flat[0];
            const spacing = canvas.gridSpacing;
            if (mode === "horizontal") {
              for (let i = 1; i < flat.length; i++) {
                const node = flat[i];
                node.moveTo(point(anchor.x + anchor.width + spacing, anchor.y));
                anchor = node;
              }
            } else if (mode === "vertical") {
              for (let i = 1; i < flat.length; i++) {
                const node = flat[i];
                node.moveTo(point(anchor.x, anchor.y + anchor.height + spacing));
                anchor = node;
              }
            } else if (mode === "grid") {
              let rowY = box.minY;
              for (const row of rows) {
                row[0].moveTo(point(box.minX, rowY));
                let rowH = row[0].height;
                for (let i = 1; i < row.length; i++) {
                  const prev = row[i - 1];
                  const node = row[i];
                  node.moveTo(point(prev.x + prev.width + spacing, rowY));
                  rowH = Math.max(rowH, node.height);
                }
                rowY += rowH + spacing;
              }
            }
            canvas.requestSave();
          };
          const btnRect = btn.getBoundingClientRect();
          const menu = new host.Menu().setUseNativeMenu(false)
            .addItem((item) => item.setSection("align-h").setTitle(ti.actionAlignLeft()).setIcon("lucide-align-start-vertical").onClick(() => align("left")))
            .addItem((item) => item.setSection("align-h").setTitle(ti.actionAlignCenter()).setIcon("lucide-align-center-vertical").onClick(() => align("center")))
            .addItem((item) => item.setSection("align-h").setTitle(ti.actionAlignRight()).setIcon("lucide-align-end-vertical").onClick(() => align("right")))
            .addItem((item) => item.setSection("align-v").setTitle(ti.actionAlignTop()).setIcon("lucide-align-start-horizontal").onClick(() => align("top")))
            .addItem((item) => item.setSection("align-v").setTitle(ti.actionAlignMiddle()).setIcon("lucide-align-center-horizontal").onClick(() => align("middle")))
            .addItem((item) => item.setSection("align-v").setTitle(ti.actionAlignBottom()).setIcon("lucide-align-end-horizontal").onClick(() => align("bottom")))
            .addItem((item) => item.setSection("arrange").setTitle(ti.actionArrangeHorizontally()).setIcon("stack-horizontal").onClick(() => arrange("horizontal")))
            .addItem((item) => item.setSection("arrange").setTitle(ti.actionArrangeVertically()).setIcon("stack-vertical").onClick(() => arrange("vertical")))
            .addItem((item) => item.setSection("arrange").setTitle(ti.actionArrangeGrid()).setIcon("lucide-layout-grid").onClick(() => arrange("grid")))
            .addItem((item) => item.setSection("distribute").setTitle(ti.actionDistributeHorizontalSpacing()).setIcon("distribute-space-horizontal").onClick(() => distribute("horizontal")))
            .addItem((item) => item.setSection("distribute").setTitle(ti.actionDistributeVerticalSpacing()).setIcon("distribute-space-vertical").onClick(() => distribute("vertical")))
            .addItem((item) => item.setSection("justify").setTitle(ti.actionJustifyHorizontally()).setIcon("stretch-horizontal").onClick(() => justify("horizontal")))
            .addItem((item) => item.setSection("justify").setTitle(ti.actionJustifyVertically()).setIcon("stretch-vertical").onClick(() => justify("vertical")));
          menu.setParentElement(btn).showAtPosition({ x: btnRect.x, y: btnRect.bottom, width: btnRect.width, overlap: true });
        });
      }
      const isEdge = nodes.every((node) => node instanceof host.s13CanvasEdge);
      if (isEdge) {
        const edgeNodes = nodes;
        const head = last;
        let icon = "lucide-arrow-right";
        if (head.from.end === "arrow") icon = "lucide-move-horizontal";
        else if (head.to.end === "none") icon = "line-horizontal";
        addButton(menuEl, ti.labelLineDirection(), icon, (event) => {
          const btn = event.currentTarget;
          if (btn.hasClass("has-active-menu")) return;
          const setEnds = (fromEnd, toEnd) => {
            for (const edge of edgeNodes) {
              edge.from.end = fromEnd;
              edge.to.end = toEnd;
              canvas.markDirty(edge);
            }
            canvas.requestSave();
          };
          const rect = btn.getBoundingClientRect();
          const menu = new host.Menu().setUseNativeMenu(false)
            .addItem((item) => item.setTitle(ti.labelNondirectional()).setIcon("line-horizontal").setChecked(icon === "line-horizontal").onClick(() => setEnds("none", "none")))
            .addItem((item) => item.setTitle(ti.labelUnidirectional()).setIcon("lucide-arrow-right").setChecked(icon === "lucide-arrow-right").onClick(() => setEnds("none", "arrow")))
            .addItem((item) => item.setTitle(ti.labelBidirectional()).setIcon("lucide-move-horizontal").setChecked(icon === "lucide-move-horizontal").onClick(() => setEnds("arrow", "arrow")));
          menu.setParentElement(btn).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true });
        });
      }
      if (single && last instanceof host.s13CanvasEdge && last.labelElement) {
        const edge = last;
        addButton(menuEl, ti.actionRemoveLabel(), "lucide-x-square", () => {
          edge.setLabel("");
          edge.labelElement.destroy();
          canvas.requestSave();
          self.render(true);
        });
      }
      if (single) {
        if (last instanceof host.s13CanvasEdge) {
          const edge = last;
          addButton(menuEl, ti.actionEditLabel(), "lucide-edit", () => edge.editLabel());
        } else if (last instanceof host.s13CanvasNode && last.isEditable()) {
          const node = last;
          const isGroup = node instanceof host.s13CanvasGroupNode;
          const label = isGroup ? ti.actionEditLabel() : s13InterfaceI18n().menu.edit();
          addButton(menuEl, label, "lucide-edit", () => node.startEditing());
          if (isGroup) {
            const group = node;
            const bgTitle = group.bgFile ? ti.actionEditBackground() : ti.actionSetBackground();
            addButton(menuEl, bgTitle, "lucide-image", (event) => {
              const btn = event.currentTarget;
              if (btn.hasClass("has-active-menu")) return;
              const pick = () => {
                new host.s13CanvasImageSuggest(app, (file) => {
                  group.setBackgroundFile(file);
                  canvas.requestSave();
                  self.render(true);
                }).open();
              };
              if (group.bgPath) {
                const setStyle = (style) => {
                  group.setBackgroundStyle(style);
                  canvas.requestSave();
                };
                const rect = btn.getBoundingClientRect();
                const menu = new host.Menu().setUseNativeMenu(false)
                  .addItem((item) => item.setSection("image").setTitle(ti.actionReplaceBackground()).setIcon("lucide-repeat").onClick(pick))
                  .addItem((item) => item.setSection("image").setTitle(ti.actionRemoveBackground()).setIcon("lucide-image-off").onClick(() => {
                    group.setBackgroundFile(null);
                    canvas.requestSave();
                    self.render(true);
                  }))
                  .addItem((item) => item.setSection("style").setTitle(ti.optionBackgroundCover()).setIcon("lucide-scaling").setChecked(!group.bgStyle || group.bgStyle === "cover").onClick(() => setStyle("cover")))
                  .addItem((item) => item.setSection("style").setTitle(ti.optionBackgroundRatio()).setIcon("aspect-ratio").setChecked(group.bgStyle === "ratio").onClick(() => setStyle("ratio")))
                  .addItem((item) => item.setSection("style").setTitle(ti.optionBackgroundRepeat()).setIcon("lucide-layout-grid").setChecked(group.bgStyle === "repeat").onClick(() => setStyle("repeat")));
                menu.setParentElement(btn).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true });
              } else {
                pick();
              }
            });
          }
        }
      }
      const zoom = canvas.scale;
      const canvasRect = canvas.canvasRect;
      let centerX = (minX + maxX) / 2;
      let bottomY = minY - 10 / zoom;
      const hasGroup = nodes.some((node) => node instanceof host.s13CanvasGroupNode);
      if (hasGroup) bottomY = minY - 35 / Math.sqrt(zoom);
      else if (last instanceof host.s13CanvasFileNode) bottomY = minY - 30 / Math.sqrt(zoom);
      if (single && last instanceof host.s13CanvasEdge && last.labelElement) {
        const center = last.getCenter();
        const labelHeight = last.labelElement.wrapperEl.clientHeight || 20;
        bottomY = Math.min(bottomY, center.y - 20 / zoom - labelHeight / 2);
      }
      const menuRect = menuEl.getBoundingClientRect();
      const menuW = menuRect.width;
      const menuH = menuRect.height;
      centerX = (centerX - canvas.x) * zoom - menuW / 2 + canvasRect.width / 2;
      bottomY = (bottomY - canvas.y) * zoom - menuH + canvasRect.height / 2;
      centerX = Math.clamp(centerX, 10, canvasRect.width - menuW - 10);
      bottomY = Math.clamp(bottomY, 10, canvasRect.height - menuH - 10);
      containerEl.setCssStyles({ left: centerX + "px", top: bottomY + "px" });
    }
  };

  CanvasMenu.prototype.updateZIndex = function (zIndex) {
    this.containerEl.style.zIndex = String(zIndex);
  };

  return CanvasMenu;
}
