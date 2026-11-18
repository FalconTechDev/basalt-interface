// Canvas connection (edge) class plus the small geometry helpers and the offscreen
// SVG preview renderer used by canvas embeds.
//
// Replaces the inherited items: G5 (the edge class), o8 (preview renderer), b5/V5/z5
// (helpers) and the declarators U5/W5/_5 (arrow rotation map and edge-end kinds).
import { boxCenter, sideMidpoint, bezierEdge, boxOfRect, boxUnion, boxGrow, distance, rgbTripleToHex } from "./misc.js";
import { s13NearestSide, s13ApplyCanvasColor } from "./s13-geom.js";
import { ng08SuppressNextEvent } from "./n-g08-drag.js";
import { env } from "./env.js";

/** Stack order of nodes for serialisation/painting (lower zIndex first). */
export function s33ZIndexCompare(a, b) { return a.zIndex - b.zIndex; }

/** Cardinal direction from the centre of box `a` toward the centre of box `b`. */
export function s33EdgeDirection(a, b) {
  const ca = boxCenter(a.getBBox());
  const cb = boxCenter(b.getBBox());
  const angle = Math.atan2(cb.y - ca.y, cb.x - ca.x);
  const slope = Math.atan2(a.height, a.width);
  if (angle > -slope && angle <= slope) return "right";
  if (angle > slope && angle <= Math.PI - slope) return "bottom";
  if (angle > Math.PI - slope || angle <= -(Math.PI - slope)) return "left";
  return "top";
}

/** Moves a side anchor point 7px outward, where the edge curve visually starts. */
export function s33EdgeOutset(point, side) {
  const out = { ...point };
  switch (side) {
    case "top": out.y -= 7; break;
    case "bottom": out.y += 7; break;
    case "left": out.x -= 7; break;
    case "right": out.x += 7; break;
  }
  return out;
}

// ---- declarator replacements (edge-end kinds, arrow rotation, view/file types) ----

export const s33EdgeEndRotation = { top: "180", bottom: "0", left: "90", right: "270" };
export const s33EdgeEndNone = "none";
export const s33EdgeEndArrow = "arrow";
export const s33CanvasViewType = "canvas";
export const s33CanvasExtension = "canvas";
export const s33FileExplorerViewType = "file-explorer";
export const s33DefaultDateFormat = "YYYY-MM-DD";
export const s33RecoveryDefaults = { intervalMinutes: 5, keepDays: 7 };

// ---- locale-table aliases (the i18n tables themselves are owned elsewhere) --------

const s33T = () => env().gm;
export function s33InterfaceStrings() { return s33T().interface; }
export function s33CanvasStrings() { return s33T().plugins.canvas; }
export function s33DailyNotesStrings() { return s33T().plugins.dailyNotes; }
export function s33FileExplorerStrings() { return s33T().plugins.fileExplorer; }
export function s33FileRecoveryStrings() { return s33T().plugins.fileRecovery; }
export function s33EditorStatusStrings() { return s33T().plugins.editorStatus; }
export function s33SyncStrings() { return s33T().plugins.sync; }

// ---- preview renderer ----------------------------------------------------------------

/**
 * Draws a .canvas JSON document as a small static SVG map (cards + connection lines)
 * into `containerEl`. Used for canvas embeds/thumbnails; silently does nothing for
 * unparseable or empty documents.
 */
export function s33CanvasPreview(containerEl, text, host) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return;
  }
  const nodes = data.nodes;
  const edges = data.edges;
  if (!nodes || nodes.length === 0) return;
  const edgeList = edges || [];
  const svg = createSvg("svg", "canvas-minimap");
  const boxes = {};
  const all = [];
  for (const node of nodes) {
    const b = boxOfRect(node);
    boxes[node.id] = b;
    all.push(b);
  }
  const bounds = boxUnion(all);
  const strokeWidth = Math.sqrt((bounds.maxX - bounds.minX) / 10);
  const paint = (node) => {
    s33ApplyCanvasColor(
      svg.createSvg("rect", { attr: { x: node.x, y: node.y, width: node.width, height: node.height, rx: "20", ry: "20" } }),
      node.color,
      host,
    );
  };
  for (const node of nodes) {
    if (node.type === "group") paint(node);
  }
  for (const edge of edgeList) {
    const from = boxes[edge.fromNode];
    const to = boxes[edge.toNode];
    if (from && to) {
      const curve = bezierEdge(sideMidpoint(from, edge.fromSide), edge.fromSide, sideMidpoint(to, edge.toSide), edge.toSide);
      const path = svg.createSvg("path", { attr: { d: curve.path } });
      path.style.strokeWidth = String(strokeWidth);
      s33ApplyCanvasColor(path, edge.color, host);
    }
  }
  for (const node of nodes) {
    if (node.type !== "group") paint(node);
  }
  const grown = boxGrow(bounds, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 20);
  svg.setAttr("viewBox", `${grown.minX} ${grown.minY} ${grown.maxX - grown.minX} ${grown.maxY - grown.minY}`);
  containerEl.appendChild(svg);
}

// ---- the edge class ---------------------------------------------------------------------

/**
 * A connection between two canvas nodes. Owns two SVG groups: `lineGroupEl` holds the
 * interaction + display paths and the optional label element, `lineEndGroupEl` holds the
 * arrow/end markers positioned at the anchor points.
 */
export function defineS33CanvasEdge(host) {
  const normalizeColor = (color) => rgbTripleToHex(color || "");
  const canvasStrings = () => host.t.plugins.canvas;

  class CanvasEdge {
    constructor(canvas, id, from, to) {
      this.color = "";
      this.label = "";
      this.unknownData = {};
      this.initialized = false;
      this.canvas = canvas;
      this.id = id;
      this.from = from;
      this.to = to;
      this.lineGroupEl = createSvg("g");
      this.lineEndGroupEl = createSvg("g");
    }

    attach() {
      if (this.isAttached) return;
      this.canvas.edgeContainerEl.appendChild(this.lineGroupEl);
      this.canvas.edgeEndContainerEl.appendChild(this.lineEndGroupEl);
    }

    detach() {
      if (!this.isAttached) return;
      this.lineGroupEl.detach();
      this.lineEndGroupEl.detach();
    }

    get isAttached() { return !!this.lineGroupEl.parentNode; }

    destroy() {
      this.labelElement?.destroy();
      this.lineGroupEl?.remove();
      this.lineEndGroupEl?.remove();
    }

    getData() {
      const data = {
        ...this.unknownData,
        id: this.id,
        fromNode: this.from.node.id,
        fromSide: this.from.side,
        toNode: this.to.node.id,
        toSide: this.to.side,
      };
      if (this.from.end !== s33EdgeEndNone) data.fromEnd = this.from.end;
      if (this.to.end !== s33EdgeEndArrow) data.toEnd = this.to.end;
      if (this.color) data.color = this.color;
      if (this.label) data.label = this.label;
      return data;
    }

    setData(data) {
      const { fromNode, fromSide, fromEnd, toNode, toSide, toEnd, color, label, ...unknownData } = data;
      let dirty = false;
      const nextColor = normalizeColor(color);
      if (this.color !== nextColor) { this.color = nextColor; dirty = true; }
      if (this.label !== label) { this.label = label; dirty = true; }
      const canvas = this.canvas;
      const nodes = canvas.nodes;
      let moved = false;
      if (fromNode && fromNode !== this.from.node.id && nodes.has(fromNode)) {
        moved = true;
        this.from.node = nodes.get(fromNode);
      }
      const nextFromEnd = fromEnd || s33EdgeEndNone;
      if (fromNode && nextFromEnd !== this.from.end) { this.from.end = nextFromEnd; dirty = true; }
      if (toNode && toNode !== this.to.node.id && nodes.has(toNode)) {
        moved = true;
        this.to.node = nodes.get(toNode);
      }
      const nextToEnd = toEnd || s33EdgeEndArrow;
      if (toNode && nextToEnd !== this.to.end) { this.to.end = nextToEnd; dirty = true; }
      if (fromNode) {
        const side = fromSide ?? s33EdgeDirection(this.from.node, this.to.node);
        if (side !== this.from.side) { this.from.side = side; dirty = true; }
      }
      if (toNode) {
        const side = toSide ?? s33EdgeDirection(this.to.node, this.from.node);
        if (side !== this.to.side) { this.to.side = side; dirty = true; }
      }
      if (moved) canvas.markMoved(this);
      if (dirty) canvas.markDirty(this);
      this.unknownData = unknownData;
    }

    setColor(color, render = false) {
      color = normalizeColor(color);
      if (this.color !== color) {
        this.color = color;
        if (render) this.render();
        else this.canvas.markDirty(this);
      }
    }

    setLabel(label) {
      if (this.label !== label) this.label = label;
    }

    update(from, to) {
      const canvas = this.canvas;
      if (this.from.node !== from.node) {
        canvas.edgeFrom.delete(this.from.node, this);
        if (!(from.node instanceof canvas.DummyNode)) canvas.edgeFrom.add(from.node, this);
      }
      if (this.to.node !== to.node) {
        canvas.edgeTo.delete(this.to.node, this);
        if (!(to.node instanceof canvas.DummyNode)) canvas.edgeTo.add(to.node, this);
      }
      this.from = from;
      this.to = to;
      canvas.markMoved(this);
    }

    getBBox() {
      const a = sideMidpoint(this.from.node.getBBox(), this.from.side);
      const b = sideMidpoint(this.to.node.getBBox(), this.to.side);
      return {
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
      };
    }

    focus() { this.select(); }

    blur() {
      this.deselect();
      this.labelElement?.blur();
    }

    select() {
      this.lineGroupEl.addClass("is-focused");
      this.lineEndGroupEl.addClass("is-focused");
    }

    deselect() {
      this.lineGroupEl.removeClass("is-focused");
      this.lineEndGroupEl.removeClass("is-focused");
    }

    editLabel() {
      if (!this.labelElement) this.labelElement = new canvas.EdgeLabel(this);
      this.labelElement.focus();
    }

    /** Point halfway along the visible bezier (used by "follow connection"). */
    getCenter() {
      const t = this.bezier;
      const e = 0.5;
      const a = 1 - e;
      const s = a * a * a, l = 3 * e * a * a, c = 3 * e * e * a, u = e * e * e;
      return {
        x: s * t.from.x + l * t.cp1.x + c * t.cp2.x + u * t.to.x,
        y: s * t.from.y + l * t.cp1.y + c * t.cp2.y + u * t.to.y,
      };
    }

    initialize() {
      const group = this.lineGroupEl;
      group.addEventListener("click", (evt) => this.onClick(evt));
      group.addEventListener("contextmenu", (evt) => this.onContextMenu(evt));
      group.addEventListener("pointerdown", (evt) => this.onConnectionPointerdown(evt));
      this.path = {
        interaction: group.createSvg("path", "canvas-interaction-path"),
        display: group.createSvg("path", "canvas-display-path"),
      };
    }

    render() {
      if (!this.initialized) {
        this.initialized = true;
        this.initialize();
      }
      const group = this.lineGroupEl;
      const ends = this.lineEndGroupEl;
      const color = this.color;
      const label = this.label;
      this.updatePath();
      if (this.labelElement && !label) this.labelElement.destroy(true);
      this.labelElement?.render();
      if (label) {
        if (!this.labelElement) this.labelElement = new canvas.EdgeLabel(this);
        this.labelElement.setText(label);
      }
      s13ApplyCanvasColor(group, color, host);
      s13ApplyCanvasColor(ends, color, host);
      group.toggleClass("is-themed", !!color);
      ends.toggleClass("is-themed", !!color);
    }

    updatePath() {
      const from = this.from;
      const to = this.to;
      const paths = this.path;
      const anchorFrom = sideMidpoint(from.node.getBBox(), from.side);
      const start = s33EdgeOutset(anchorFrom, from.side);
      const anchorTo = sideMidpoint(to.node.getBBox(), to.side);
      const end = s33EdgeOutset(anchorTo, to.side);
      const curve = (this.bezier = bezierEdge(start, from.side, end, to.side));
      if (window.__fpBezierFix) window.__fpBezierFix(this, curve, start, end, from.side, to.side);

      let fromEnd = this.fromLineEnd;
      if (from.end !== fromEnd?.type) {
        if (fromEnd) fromEnd.el.detach();
        fromEnd = this.fromLineEnd = this.createEdgeEnd(from.end);
      }
      let toEnd = this.toLineEnd;
      if (to.end !== toEnd?.type) {
        if (toEnd) toEnd.el.detach();
        toEnd = this.toLineEnd = this.createEdgeEnd(to.end);
      }

      let d = curve.path;
      if (fromEnd) {
        fromEnd.el.style.transform = `translate(${anchorFrom.x}px, ${anchorFrom.y}px) rotate(${s33EdgeEndRotation[from.side]}deg)`;
      } else {
        d = `M${anchorFrom.x} ${anchorFrom.y} L${start.x} ${start.y} ${d}`;
      }
      if (toEnd) {
        toEnd.el.style.transform = `translate(${anchorTo.x}px, ${anchorTo.y}px) rotate(${s33EdgeEndRotation[to.side]}deg)`;
      } else {
        d = `${d} M${end.x} ${end.y} L${anchorTo.x} ${anchorTo.y}`;
      }
      paths.interaction.setAttr("d", d);
      paths.display.setAttr("d", d);
    }

    /** Builds the arrow/marker element for an edge end, or null for "none". */
    createEdgeEnd(end) {
      const custom = window.__fpEndPoints && window.__fpEndPoints(end);
      if (custom) {
        return {
          el: this.lineEndGroupEl.createSvg("g", {}, (g) => {
            g.createSvg("polygon", { cls: "canvas-path-end", attr: { points: custom } });
          }),
          type: end,
        };
      }
      if (end === "arrow") {
        return {
          el: this.lineEndGroupEl.createSvg("g", {}, (g) => {
            g.createSvg("polygon", { cls: "canvas-path-end", attr: { points: "0,0 6.5,10.4 -6.5,10.4" } });
          }),
          type: end,
        };
      }
      return null;
    }

    onClick(evt) {
      const canvas = this.canvas;
      if (evt.button !== 0 || canvas.readonly) return;
      if (evt.shiftKey) canvas.toggleSelect(this);
      else if (canvas.selection.size === 1 && canvas.selection.has(this)) this.editLabel();
      else canvas.selectOnly(this);
    }

    onContextMenu(evt) {
      if (evt.defaultPrevented) return;
      const canvas = this.canvas;
      if (canvas.selection.has(this) && canvas.selection.size > 1) {
        canvas.onSelectionContextMenu(evt);
        return;
      }
      if (!canvas.readonly) canvas.selectOnly(this);
      const menu = new host.Menu().addSections(["canvas"]);
      this.showMenu(menu, evt);
      evt.preventDefault();
      menu.showAtMouseEvent(evt);
    }

    showMenu(menu, evt) {
      const edge = this;
      if (window.__fpEdgeMenu) window.__fpEdgeMenu(menu, edge);
      const canvas = this.canvas;
      const strings = canvasStrings();
      if (!canvas.readonly) {
        menu.addItem((item) =>
          item.setSection("danger").setTitle(strings.actionRemove()).setIcon("lucide-trash-2").setWarning(true).onClick(() => {
            canvas.removeEdge(edge);
            canvas.requestSave();
          }),
        );
        menu.addItem((item) =>
          item.setSection("canvas").setTitle(strings.actionEditLabel()).setIcon("lucide-edit").onClick(() => edge.editLabel()),
        );
      }
      menu.addItem((item) =>
        item.setSection("canvas").setTitle(strings.actionFollowConnection()).setIcon("lucide-corner-down-right").onClick(() => {
          const fromAnchor = sideMidpoint(edge.from.node.getBBox(), edge.from.side);
          const toAnchor = sideMidpoint(edge.to.node.getBBox(), edge.to.side);
          const pos = canvas.posFromEvt(evt);
          const target = distance(pos, fromAnchor) > distance(pos, toAnchor) ? "to" : "from";
          const node = target === "from" ? edge.to.node : edge.from.node;
          canvas.zoomToBbox(node.getBBox());
        }),
      );
      canvas.app.workspace.trigger("canvas:edge-menu", menu, this);
    }

    /**
     * Dragging an edge end onto another node re-targets that end; dropping on empty
     * canvas removes the edge. `fixed` is the endpoint descriptor that stays put.
     */
    onConnectionPointerdown(evt) {
      const edge = this;
      if (window.__fpEdgeGrab && window.__fpEdgeGrab(edge, evt)) return;
      const canvas = edge.canvas;
      if (!evt.isPrimary || evt.button !== 0 || canvas.readonly) return;
      if (evt.pointerType === "touch" && !canvas.selection.has(edge)) return;
      evt.preventDefault();
      host.dragWithThreshold(evt, () => {
        const from = edge.from;
        const to = edge.to;
        const pos = canvas.posFromEvt(evt);
        const fromAnchor = sideMidpoint(from.node.getBBox(), from.side);
        const toAnchor = sideMidpoint(to.node.getBBox(), to.side);
        const dragged = distance(pos, fromAnchor) > distance(pos, toAnchor) ? "to" : "from";
        const fixed = dragged === "from" ? to : from;
        const dummy = new canvas.DummyNode(canvas);
        let snapped = null;
        canvas.canvasEl.addClass("is-connecting");
        canvas.deselectAll();
        edge.canvas.handleDragWithPan(evt, {
          move: (moveEvt) => {
            const p = canvas.posFromEvt(moveEvt);
            dummy.x = p.x;
            dummy.y = p.y;
            dummy.width = 0;
            dummy.height = 0;
            const candidates = canvas
              .getIntersectingNodes(boxGrow(dummy.getBBox(), canvas.config.objectSnapDistance));
            const at = candidates.indexOf(fixed.node);
            if (at >= 0) candidates.splice(at, 1);
            snapped = s13NearestSide(p, candidates, canvas.config.objectSnapDistance);
            if (dragged === "from") {
              if (snapped) edge.update({ side: snapped.side, node: snapped.node, end: from.end }, to);
              else edge.update({ side: from.side, node: dummy, end: from.end }, to);
            } else {
              if (snapped) edge.update(from, { side: snapped.side, node: snapped.node, end: to.end });
              else edge.update(from, { side: to.side, node: dummy, end: to.end });
            }
          },
          end: () => {
            if (!snapped) canvas.removeEdge(edge);
            canvas.requestSave();
          },
          cancel: () => edge.update(from, to),
          cleanup: () => {
            canvas.canvasEl.removeClass("is-connecting");
            ng08SuppressNextEvent(edge.lineGroupEl, "click");
          },
        });
      });
    }
  }

  canvas.EdgeClass = CanvasEdge;
  return CanvasEdge;
}
