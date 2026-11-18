// Slice s09 — graph view: the PIXI renderer (nodes, links, power tag, worker-driven layout),
// the graph data helpers and the constants the renderer reads. PIXI itself is the bundled
// /lib/pixi.min.js script (a global), the force worker is /sim.js; both stay external.
import { env } from "./env.js";
import { displayName } from "./path.js";

const s09GCache = {};
function s09GOnce(key, build) { return s09GCache[key] ??= build(); }

function s09IsBoolean(value) { return typeof value === "boolean"; }

// ---------------------------------------------------------------- small helpers (mQ..bQ)

/** `var mQ` — frame-rate independent damping: `a*t + b*(1-t)`, default t = .9. */
export function s09Damp(a, b, t = 0.9) { return a * t + b * (1 - t); }

/** `var vQ` — per-channel damp of two 0xRRGGBB colours. */
export function s09LerpColor(a, b) {
  return (s09Damp(a >> 16 & 255, b >> 16 & 255) << 16)
    + (s09Damp(a >> 8 & 255, b >> 8 & 255) << 8)
    + (s09Damp(a & 255, b & 255) | 0);
}

/** `var gQ` — true when the two boxes do NOT intersect. */
export function s09BoxesDisjoint(a, b) {
  return b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom;
}

/** `var yQ` — box of half-size n around (x, y). */
export function s09BoxAround(x, y, n) {
  return { left: x - n, right: x + n, top: y - n, bottom: y + n };
}

/** `var bQ` — makes a canvas (or iframe body) fill its container. */
export function s09ResetCanvasStyle(el) {
  el.style.margin = "0"; el.style.padding = "0"; el.style.border = "0";
  el.style.width = "100%"; el.style.height = "100%"; el.style.overflow = "hidden";
}

// ---------------------------------------------------------------- constants

/** `var wQ` — default options of the local graph. */
export const s09GraphDefaults = {
  showAttachments: false, hideUnresolved: false, showOrphans: true, showTags: false,
  localFile: null, localJumps: 1, localInterlinks: false, localForelinks: true, localBacklinks: true,
};

/** `var fQ` — master alpha of links and the power tag. */
export const s09GraphLinkAlpha = 0.2;

/** `var EQ` — node types that never propagate weight to neighbours. */
export const s09GraphNoWeightTypes = { tag: true };

/** `var MQ` — css class -> css variable name, one entry per graph colour. */
export const s09GraphColorClasses = {
  fill: "color-fill", fillFocused: "color-fill-focused", fillTag: "color-fill-tag",
  fillUnresolved: "color-fill-unresolved", fillAttachment: "color-fill-attachment",
  arrow: "color-arrow", circle: "color-circle", line: "color-line", text: "color-text",
  fillHighlight: "color-fill-highlight", lineHighlight: "color-line-highlight",
};

/** `var SQ` — node circle radius at weight 0 / scale 1. */
export const s09GraphNodeBaseSize = 100;

/** `var LQ` — kicks off the /lib/pixi.min.js script load; the returned handle is awaited by the graph views. */
export function s09LoadPixiScript() { return env().Hv("/lib/pixi.min.js?7.2.4"); }

// ---------------------------------------------------------------- node data (kQ, CQ, PQ)

/** `var kQ` — empty graph node record. */
export function s09GraphNodeData(type = "") { return { type, links: {} }; }

/** `var CQ` — copy of a graph node record, keeping its colour. */
export function s09GraphNodeDataFrom(node) {
  if (!node) return s09GraphNodeData();
  const copy = s09GraphNodeData(node.type);
  if (node.color) copy.color = node.color;
  return copy;
}

/** `var PQ` — computes the visible node set of the local graph by flooding `localJumps`
 *  hops out from `localFile`, honouring the inter/fore/back-link toggles. */
export function s09GraphLocalData(graph, options) {
  const source = graph.nodes, out = {}, weights = {};
  const localFile = options.localFile, localJumps = options.localJumps;
  const localInterlinks = options.localInterlinks, localForelinks = options.localForelinks;
  const localBacklinks = options.localBacklinks;
  weights[localFile] = 30;
  if (!source.hasOwnProperty(localFile)) {
    out[localFile] = s09GraphNodeData();
    return { nodes: out, weights };
  }
  out[localFile] = s09GraphNodeData(source[localFile].type);
  const pass = (weight) => {
    const added = {};
    for (const id in source) {
      if (!source.hasOwnProperty(id)) continue;
      const node = source[id];
      if (node.type === "tag") continue;
      const links = node.links;
      for (const other in links) {
        if (!links.hasOwnProperty(other)) continue;
        const me = out[id];
        if (localForelinks && out.hasOwnProperty(id) && !out.hasOwnProperty(other)
          && !s09GraphNoWeightTypes.hasOwnProperty(me.type)) {
          added[other] = added[other] || s09GraphNodeDataFrom(source[other]);
          me.links[other] = true;
        } else if (localBacklinks && out.hasOwnProperty(other) && !out.hasOwnProperty(id)
          && !s09GraphNoWeightTypes.hasOwnProperty(out[other].type)) {
          added[id] = added[id] || s09GraphNodeDataFrom(source[id]);
          added[id].links[other] = true;
        }
      }
    }
    for (const id in added) {
      if (added.hasOwnProperty(id)) { out[id] = added[id]; weights[id] = weight; }
    }
  };
  const step = 30 / localJumps;
  for (let p = 0; p < localJumps; p++) pass(30 - step * (p + 1));
  if (localInterlinks) {
    for (const id in out) {
      if (out.hasOwnProperty(id) && source.hasOwnProperty(id)) out[id] = source[id];
    }
  }
  return { nodes: out, weights };
}

/** `var BQ` — sorts a file tree in place: entries named in `order` first (by that order),
 *  folders before files inside each group, then by display name. */
export function s09SortTreeItems(tree, order, recurse = true) {
  if (recurse) {
    for (let i = 0; i < tree.length; i++) {
      const item = tree[i];
      if (item.type === "folder") s09SortTreeItems(item.children, order, recurse);
    }
  }
  tree.sort((a, b) => {
    const oa = order.hasOwnProperty(a.path) ? order[a.path] : undefined;
    const ob = order.hasOwnProperty(b.path) ? order[b.path] : undefined;
    if (oa !== undefined && ob !== undefined) return oa - ob;
    if (oa !== undefined) return -1;
    if (ob !== undefined) return 1;
    const fa = a.type === "folder", fb = b.type === "folder";
    if (fa || fb) {
      if (fa && !fb) return -1;
      if (fb && !fa) return 1;
    }
    return env().ub(a.name, b.name);
  });
}

// ---------------------------------------------------------------- node (xQ)

function s09buildGraphNode() {
  const S = s09GraphNodeBaseSize, FADE = s09GraphLinkAlpha;
  function GraphNode(renderer, id, type) {
    this.x = null; this.y = null; this.fx = null; this.fy = null;
    this.forward = {}; this.reverse = {};
    this.weight = 0; this.color = null;
    this.rendered = false; this.fadeAlpha = 0; this.moveText = 0; this.fontDirty = false;
    this.onClick = (e) => {
      const t = e.nativeEvent;
      if (e.button === 2 || (t.instanceOf(MouseEvent) && env().Kl(t))) {
        const r = this.renderer;
        if (r.onNodeRightClick) r.onNodeRightClick(e.nativeEvent, this.id, this.type);
      }
    };
    this.renderer = renderer; this.id = id; this.type = type;
  }
  GraphNode.prototype.initGraphics = function () {
    if (this.rendered) return false;
    this.rendered = true;
    const renderer = this.renderer;
    const circle = this.circle = new PIXI.Graphics();
    circle.eventMode = "static";
    circle.beginFill(16777215); circle.drawCircle(S, S, S); circle.endFill();
    if (env().Yl.isMobile) {
      circle.beginFill(16777215, 1e-4); circle.drawCircle(S, S, 500); circle.endFill();
    }
    circle.pivot.x = S; circle.pivot.y = S;
    circle.cursor = "pointer"; circle.zIndex = 1;
    circle.on("pointerdown", (e) => renderer.onPointerDown(this, e))
      .on("pointerover", (e) => renderer.onPointerOver(this, e))
      .on("pointerout", () => renderer.onPointerOut())
      .on("click", this.onClick)
      .on("rightclick", this.onClick);
    const fill = this.getFillColor();
    circle.alpha = fill.a; circle.tint = fill.rgb;
    renderer.hanger.addChild(circle);
    const style = new PIXI.TextStyle(this.getTextStyle());
    const text = this.text = new PIXI.Text(this.getDisplayText(), style);
    text.eventMode = "none"; text.resolution = 2; text.anchor.set(0.5, 0); text.zIndex = 2;
    renderer.hanger.addChild(text);
    this.fadeAlpha = 0;
    return true;
  };
  GraphNode.prototype.clearGraphics = function () {
    if (!this.rendered) return;
    this.rendered = false;
    const circle = this.circle, highlight = this.highlight, text = this.text;
    if (circle) { this.circle = null; if (circle.parent) circle.parent.removeChild(circle); circle.destroy(); }
    if (highlight) { this.highlight = null; if (highlight.parent) highlight.parent.removeChild(highlight); highlight.destroy(); }
    if (text) { this.text = null; if (text.parent) text.parent.removeChild(text); text.destroy(); }
  };
  GraphNode.prototype.getTextStyle = function () {
    const renderer = this.renderer, size = this.getSize();
    return new PIXI.TextStyle({
      fontSize: 14 + size / 4,
      fill: renderer.colors.text.rgb,
      fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Microsoft YaHei Light", sans-serif',
      wordWrap: true, wordWrapWidth: 300, align: "center",
    });
  };
  GraphNode.prototype.render = function () {
    if (!this.rendered) return;
    const renderer = this.renderer, x = this.x, y = this.y;
    const circle = this.circle, highlight = this.highlight, text = this.text;
    let fade = this.fadeAlpha, move = this.moveText;
    const size = this.getSize(), fill = this.getFillColor();
    const textColor = renderer.colors.text;
    const hl = renderer.getHighlightNode(), isHl = hl === this, nodeScale = renderer.nodeScale;
    const wasVisible = text.visible;
    let target = FADE;
    if (!hl || isHl || this.forward.hasOwnProperty(hl.id) || this.reverse.hasOwnProperty(hl.id)) target = 1;
    fade = this.fadeAlpha = s09Damp(fade, target);
    let alpha = fade * fill.a;
    let textAlpha = renderer.textAlpha;
    textAlpha *= fade;
    if (isHl) textAlpha = 1;
    textAlpha *= textColor.a;
    const lift = isHl ? 15 : 0;
    move = this.moveText = wasVisible ? s09Damp(move, lift) : lift;
    let textVisible = textAlpha > 0.001;
    const viewport = renderer.viewport;
    let circleVisible = isHl || !s09BoxesDisjoint(viewport, s09BoxAround(x, y, size * nodeScale + 1));
    if (textVisible) {
      textVisible = isHl || !s09BoxesDisjoint(viewport, { left: x - 300, right: x + 300, top: y, bottom: y + 200 });
    }
    circle.tint = s09LerpColor(circle.tint, fill.rgb);
    circle.visible = circleVisible;
    if (circleVisible) {
      circle.x = x; circle.y = y;
      circle.scale.x = circle.scale.y = size / 100 * nodeScale;
      circle.alpha = alpha;
    }
    text.visible = textVisible;
    if (textVisible) {
      text.x = x;
      text.y = y + (size + 5) * nodeScale + move / renderer.scale;
      text.scale.x = text.scale.y = nodeScale;
      if (isHl && renderer.scale < 1) { text.scale.x = text.scale.y = 1 / renderer.scale; }
      text.alpha = textAlpha;
    }
    if (isHl) {
      let ring = this.highlight;
      if (!ring) {
        ring = this.highlight = new PIXI.Graphics();
        ring.eventMode = "none"; ring.zIndex = 1;
        renderer.hanger.addChild(ring);
      }
      ring.x = x; ring.y = y;
      ring.scale.x = ring.scale.y = nodeScale;
      ring.clear();
      const width = Math.max(1, 1 / renderer.scale / nodeScale);
      const color = renderer.colors.circle;
      ring.alpha = color.a;
      ring.lineStyle(width, color.rgb, 1);
      ring.drawCircle(0, 0, size + width / 2);
    } else if (highlight) {
      if (highlight.parent) highlight.parent.removeChild(highlight);
      highlight.destroy();
      this.highlight = null;
    }
    if (this.fontDirty) {
      this.fontDirty = false;
      text.style = this.getTextStyle();
    }
  };
  GraphNode.prototype.getFillColor = function () {
    const renderer = this.renderer, type = this.type, color = this.color;
    if (renderer.getHighlightNode() === this) return renderer.colors.fillHighlight;
    if (type === "focused") {
      const focused = renderer.colors.fillFocused;
      if (focused.a > 0) return focused;
    } else {
      if (color) return color;
      if (type === "tag") return renderer.colors.fillTag;
      if (type === "unresolved") return renderer.colors.fillUnresolved;
      if (type === "attachment") return renderer.colors.fillAttachment;
    }
    return renderer.colors.fill;
  };
  GraphNode.prototype.getSize = function () {
    return this.renderer.fNodeSizeMult * Math.max(8, Math.min(3 * Math.sqrt(this.weight + 1), 30));
  };
  GraphNode.prototype.getDisplayText = function () { return displayName(this.id); };
  GraphNode.prototype.getRelated = function () {
    return Object.keys(this.forward).concat(Object.keys(this.reverse));
  };
  return GraphNode;
}
export function s09GraphNode() { return s09GOnce("s09GraphNode", s09buildGraphNode); }

// ---------------------------------------------------------------- link (TQ)

function s09buildGraphLink() {
  const FADE = s09GraphLinkAlpha;
  function GraphLink(renderer, source, target) {
    this.rendered = false;
    this.renderer = renderer; this.source = source; this.target = target;
  }
  GraphLink.prototype.initGraphics = function () {
    if (this.rendered || !this.source.rendered || !this.target.rendered) return;
    this.rendered = true;
    const renderer = this.renderer;
    const px = this.px = new PIXI.Container();
    renderer.hanger.addChild(px);
    const line = this.line = new PIXI.Sprite(PIXI.Texture.WHITE);
    line.eventMode = "none";
    const lineColor = renderer.colors.line;
    line.alpha = FADE * lineColor.a; line.tint = lineColor.rgb;
    px.addChild(line);
    const arrow = this.arrow = new PIXI.Graphics();
    arrow.eventMode = "none";
    const arrowColor = renderer.colors.text;
    arrow.alpha = FADE * arrowColor.a; arrow.tint = arrowColor.rgb;
    arrow.beginFill(16777215);
    arrow.moveTo(0, 0); arrow.lineTo(-4, -2); arrow.lineTo(-3, 0); arrow.lineTo(-4, 2); arrow.lineTo(0, 0);
    arrow.endFill();
    arrow.zIndex = 1;
    renderer.hanger.addChild(arrow);
  };
  GraphLink.prototype.clearGraphics = function () {
    if (!this.rendered) return;
    this.rendered = false;
    const px = this.px, line = this.line, arrow = this.arrow;
    if (px) { this.px = null; if (px.parent) px.parent.removeChild(px); px.destroy(); px.visible = false; }
    if (line) { this.line = null; line.destroy(); line.visible = false; }
    if (arrow) { this.arrow = null; if (arrow.parent) arrow.parent.removeChild(arrow); arrow.destroy(); arrow.visible = false; }
  };
  GraphLink.prototype.render = function () {
    if (!this.rendered) return;
    const px = this.px, line = this.line, arrow = this.arrow, renderer = this.renderer;
    const source = this.source, target = this.target;
    const hl = renderer.getHighlightNode();
    const linked = source === hl || target === hl;
    let lineTarget = FADE;
    if (!hl || linked) lineTarget = 1;
    const arrowBase = lineTarget * Math.clamp(2 * (renderer.scale - 0.3), 0, 1);
    let lineColor = renderer.colors.line;
    if (linked) lineColor = renderer.colors.lineHighlight;
    const arrowColor = renderer.colors.arrow;
    const forward = !(source.reverse.hasOwnProperty(target.id) && source.id.localeCompare(target.id) < 0);
    let showArrow = renderer.fShowArrow;
    const sizeMult = renderer.fLineSizeMult / renderer.scale;
    const viewport = renderer.viewport;
    const a = s09BoxAround(source.x, source.y, sizeMult);
    const b = s09BoxAround(target.x, target.y, sizeMult);
    const box = { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
    const inView = !s09BoxesDisjoint(viewport, box);
    lineTarget *= lineColor.a;
    const arrowTarget = arrowBase * arrowColor.a;
    line.alpha = s09Damp(line.alpha, lineTarget);
    arrow.alpha = s09Damp(arrow.alpha, arrowTarget);
    const drawLine = forward && inView;
    showArrow = showArrow && inView && arrow.alpha > 0.001;
    line.visible = drawLine;
    arrow.visible = showArrow;
    if (!drawLine && !showArrow) return;
    const dx = target.x - source.x, dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const sourceSize = source.getSize() * renderer.nodeScale;
    let targetSize = target.getSize() * renderer.nodeScale;
    arrow.visible = showArrow = showArrow && dist > sizeMult;
    if (drawLine) {
      px.x = source.x + dx * sourceSize / dist;
      px.y = source.y + dy * sourceSize / dist;
      px.pivot.set(0, 0);
      px.rotation = Math.atan2(dy, dx);
      line.x = 0; line.y = -sizeMult / 2;
      line.width = Math.max(0, dist - sourceSize - targetSize);
      line.height = sizeMult;
      line.tint = s09LerpColor(line.tint, lineColor.rgb);
    }
    if (showArrow) {
      targetSize += 1;
      arrow.x = target.x - dx * targetSize / dist;
      arrow.y = target.y - dy * targetSize / dist;
      arrow.pivot.set(0, 0);
      arrow.rotation = Math.atan2(dy, dx);
      arrow.scale.x = arrow.scale.y = 2 * Math.sqrt(renderer.fLineSizeMult) / renderer.scale;
      arrow.tint = arrowColor.rgb;
    }
  };
  return GraphLink;
}
export function s09GraphLink() { return s09GOnce("s09GraphLink", s09buildGraphLink); }

// ---------------------------------------------------------------- power tag (DQ)

function s09buildGraphPowerTag() {
  const FONT = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Microsoft YaHei Light", sans-serif';
  function GraphPowerTag(renderer) {
    this.rendered = false;
    this.renderer = renderer;
  }
  GraphPowerTag.prototype.initGraphics = function () {
    const renderer = this.renderer;
    if (this.text) return;
    const text = this.text = new PIXI.Text("Powered by Basalt", this.getTextStyle());
    text.eventMode = "none"; text.anchor.set(1, 1); text.zIndex = 3; text.alpha = 0.5;
    renderer.px.stage.addChild(text);
  };
  GraphPowerTag.prototype.clearGraphics = function () {
    const text = this.text;
    if (text && text.parent) { this.text = null; text.parent.removeChild(text); text.destroy(); }
    this.rendered = false;
  };
  GraphPowerTag.prototype.render = function () {
    const renderer = this.renderer, text = this.text;
    if (!text) return;
    text.visible = !renderer.hidePowerTag;
    text.alpha = renderer.colors.text.a;
    const res = renderer.px.renderer;
    text.x = res.width / res.resolution;
    text.y = res.height / res.resolution;
    if (!this.rendered) { this.rendered = true; this.text.style = this.getTextStyle(); }
  };
  GraphPowerTag.prototype.getTextStyle = function () {
    return {
      fontSize: 12, fill: this.renderer.colors.text.rgb,
      fontFamily: FONT, wordWrap: false, align: "right",
    };
  };
  return GraphPowerTag;
}
export function s09GraphPowerTag() { return s09GOnce("s09GraphPowerTag", s09buildGraphPowerTag); }

// ---------------------------------------------------------------- renderer (AQ)

function s09buildGraphRenderer() {
  function GraphRenderer(containerEl, iframeMode, hidePowerTag, worker) {
    const self = this;
    this.interactiveEl = null;
    this.onNodeClick = null; this.onNodeRightClick = null;
    this.onNodeHover = null; this.onNodeUnhover = null;
    this.workerResults = null;
    this.nodeLookup = {}; this.nodes = []; this.links = [];
    this.dragNode = null; this.highlightNode = null;
    this.px = null; this.hanger = null; this.powerTag = null;
    this.scale = 1; this.nodeScale = 1; this.textAlpha = 1; this.targetScale = 1;
    this.panX = 0; this.panY = 0; this.panvX = 0; this.panvY = 0;
    this.keyboardActions = {}; this.panning = false;
    this.width = 0; this.height = 0; this.viewport = null;
    this.zoomCenterX = 0; this.zoomCenterY = 0;
    this.hidePowerTag = hidePowerTag;
    this.containerEl = containerEl;
    this.fNodeSizeMult = 1; this.fLineSizeMult = 1; this.fTextShowMult = 1; this.fShowArrow = false;
    this.mouseX = null; this.mouseY = null;
    this.colors = {};
    this.renderTimer = null; this.idleFrames = 0;
    this.testCSS();
    const interactiveEl = this.interactiveEl = containerEl.createEl("canvas");
    containerEl.style.padding = "0"; containerEl.style.overflow = "hidden"; containerEl.style.position = "relative";
    interactiveEl.style.position = "absolute"; interactiveEl.style.left = "0"; interactiveEl.style.top = "0";
    s09ResetCanvasStyle(interactiveEl);
    interactiveEl.addEventListener("mousedown", (e) => e.preventDefault());
    interactiveEl.addEventListener("wheel", this.onWheel.bind(this), { passive: false });
    interactiveEl.addEventListener("mousemove", this.onMouseMove.bind(this), { passive: true });
    interactiveEl.addEventListener("mouseout", this.onMouseMove.bind(this));
    const w = worker || new Worker("/sim.js", { name: "Graph Worker" });
    this.worker = w;
    w.onmessage = (e) => {
      if (e.data.ignore) return;
      this.workerResults = e.data;
      this.changed();
    };
    if (iframeMode) {
      const iframeEl = this.iframeEl = containerEl.createEl("iframe");
      s09ResetCanvasStyle(iframeEl);
      iframeEl.onload = this.onIframeLoad.bind(this);
      if (iframeEl.contentDocument) this.onIframeLoad();
    } else {
      const canvas = containerEl.createEl("canvas");
      s09ResetCanvasStyle(canvas);
      setTimeout(() => {
        try { this.initGraphics(canvas); }
        catch (e) { setTimeout(() => this.initGraphics(canvas), 300); }
      }, 50);
    }
  }
  GraphRenderer.prototype.destroy = function () {
    this.worker.terminate();
    this.workerResults = null;
    this.destroyGraphics();
  };
  GraphRenderer.prototype.onIframeLoad = function () {
    const iframeEl = this.iframeEl;
    iframeEl.contentWindow.onbeforeunload = this.onIframeUnload.bind(this);
    const body = iframeEl.contentDocument.body;
    s09ResetCanvasStyle(body);
    body.innerHTML = "<canvas>";
    const canvas = body.firstChild;
    s09ResetCanvasStyle(canvas);
    this.destroyGraphics();
    this.initGraphics(canvas);
  };
  GraphRenderer.prototype.onIframeUnload = function () { this.destroyGraphics(); };
  GraphRenderer.prototype.onWheel = function (e) {
    e.preventDefault();
    if (!this.px) return;
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 40; else if (e.deltaMode === 2) delta *= 800;
    let target = this.targetScale;
    target *= Math.pow(1.5, -delta / 120);
    this.targetScale = target;
    if (target < this.scale) { this.zoomCenterX = 0; this.zoomCenterY = 0; }
    else {
      const dpr = window.devicePixelRatio;
      this.zoomCenterX = e.offsetX * dpr;
      this.zoomCenterY = e.offsetY * dpr;
    }
    this.changed();
  };
  GraphRenderer.prototype.onMouseMove = function (e) {
    if (e.type === "mouseout") this.mouseX = this.mouseY = null;
    else { this.mouseX = e.offsetX; this.mouseY = e.offsetY; }
  };
  GraphRenderer.prototype.initGraphics = function (view) {
    const self = this;
    const iframeEl = this.iframeEl, interactiveEl = this.interactiveEl, worker = this.worker;
    PIXI.settings.RENDER_OPTIONS.hello = false;
    let px;
    const prevWebGL = window.WebGL2RenderingContext;
    try {
      if (iframeEl && iframeEl.contentWindow.WebGL2RenderingContext) {
        window.WebGL2RenderingContext = iframeEl.contentWindow.WebGL2RenderingContext;
      }
      px = this.px = new PIXI.Application({ view, antialias: true, backgroundAlpha: 0, autoStart: false });
    } finally {
      window.WebGL2RenderingContext = prevWebGL;
    }
    px.renderer.events.setTargetElement(interactiveEl);
    let dragStart = null;
    this.onPointerDown = (node, e) => {
      if (e.nativeEvent.target !== interactiveEl) return;
      if (!touch1) { this.dragNode = node; dragStart = e.getLocalPosition(px.stage); }
    };
    const endDrag = (e) => {
      const t = e.nativeEvent;
      if (t.instanceOf(TouchEvent)) touchMove(t);
      const node = this.dragNode;
      if (node) {
        if (dragStart && this.onNodeClick) {
          const isMouse = t.instanceOf(MouseEvent);
          const simple = isMouse && (t.button === 0 || t.button === 1) && !env().Kl(t);
          if (simple || t.instanceOf(TouchEvent)) this.onNodeClick(t, node.id, node.type);
        }
        node.fx = null; node.fy = null;
        worker.postMessage({ alphaTarget: 0, forceNode: { id: node.id, x: null, y: null } });
        dragStart = null;
        this.dragNode = null;
        this.changed();
      }
    };
    px.stage.on("pointermove", (e) => {
      const node = this.dragNode;
      if (node) {
        if (touch2) { dragStart = null; this.dragNode = null; return; }
        if (dragStart) {
          const pos = e.getLocalPosition(px.stage);
          const dx = pos.x - dragStart.x, dy = pos.y - dragStart.y;
          if (dx * dx + dy * dy > 25) dragStart = null;
        }
        const local = e.getLocalPosition(this.hanger);
        node.fx = local.x; node.fy = local.y;
        worker.postMessage({ alpha: 0.3, alphaTarget: 0.3, run: true, forceNode: { id: node.id, x: local.x, y: local.y } });
        this.changed();
      }
    }).on("pointerup", endDrag).on("pointerupoutside", endDrag).eventMode = "static";
    this.onPointerOver = (node, e) => {
      if (e.pointerType === "touch") return;
      this.highlightNode = node;
      this.changed();
      const t = e.nativeEvent;
      if (t.instanceOf(MouseEvent)) { this.mouseX = t.offsetX; this.mouseY = t.offsetY; }
      if (this.onNodeHover) this.onNodeHover(t, node.id, node.type);
    };
    this.onPointerOut = () => {
      this.highlightNode = null;
      this.changed();
      if (this.onNodeUnhover) this.onNodeUnhover();
    };
    const hanger = this.hanger = new PIXI.Container();
    hanger.eventMode = "static";
    const powerTag = this.powerTag = new (s09GraphPowerTag())(this);
    this.onResize();
    this.resetPan();
    const backdrop = new PIXI.Graphics();
    backdrop.eventMode = "static";
    backdrop.beginFill(0); backdrop.drawRect(0, 0, 1e4, 1e4); backdrop.endFill();
    backdrop.alpha = 0;
    let panStart = null, panOrigin = null;
    let lastTime = performance.now();
    let panVel = 0;
    let panDx = 0, panDy = 0;
    let touch1 = null, touch2 = null;
    const touchMove = (e) => {
      const now = performance.now();
      const dt = now - lastTime;
      const rest = Array.prototype.slice.call(e.touches);
      let t1 = null, t2 = null;
      for (const touch of rest) {
        if (touch1 && touch.identifier === touch1.identifier) t1 = touch;
        if (touch2 && touch.identifier === touch2.identifier) t2 = touch;
      }
      if (t2 && !t1) { touch1 = touch2; t1 = touch2; touch2 = null; t2 = null; }
      if (t1) rest.remove(t1); else if (rest.length > 0) { t1 = rest.first(); rest.splice(0, 1); }
      if (t2) rest.remove(t2); else if (rest.length > 0) { t2 = rest.first(); rest.splice(0, 1); }
      if (!dragStart && !this.dragNode && touch1 && t1 && touch1.identifier === t1.identifier) {
        const dpr = window.devicePixelRatio;
        if (touch2 && t2 && touch2.identifier === t2.identifier) {
          const rect = this.interactiveEl.getBoundingClientRect();
          const mx1 = ((touch1.clientX + touch2.clientX) / 2 - rect.x) * dpr;
          const my1 = ((touch1.clientY + touch2.clientY) / 2 - rect.y) * dpr;
          const mx2 = ((t1.clientX + t2.clientX) / 2 - rect.x) * dpr;
          const my2 = ((t1.clientY + t2.clientY) / 2 - rect.y) * dpr;
          const odx = touch1.clientX - touch2.clientX, ody = touch1.clientY - touch2.clientY;
          const ndx = t1.clientX - t2.clientX, ndy = t1.clientY - t2.clientY;
          const l1 = odx * odx + ody * ody, l2 = ndx * ndx + ndy * ndy;
          if (l1 !== 0 && l2 !== 0) {
            const ratio = Math.sqrt(l2 / l1);
            const newScale = this.targetScale * ratio;
            const panX = this.panX + (mx2 - mx1);
            const panY = this.panY + (my2 - my1);
            this.zoomCenterX = mx2; this.zoomCenterY = my2;
            this.setPan(panX, panY);
            this.targetScale = newScale;
            this.changed();
          }
          panDx = 0; panDy = 0;
        } else {
          const dx = (t1.clientX - touch1.clientX) * dpr;
          const dy = (t1.clientY - touch1.clientY) * dpr;
          panVel = s09Damp(panVel, dt, 0.8);
          lastTime = now;
          panDx = s09Damp(panDx, dx, 0.8);
          panDy = s09Damp(panDy, dy, 0.8);
          this.setPan(this.panX + dx, this.panY + dy);
          this.changed();
        }
      } else {
        panVel = s09Damp(panVel, dt, 0.8);
        if (dt < 100) { this.panvX = panDx / panVel; this.panvY = panDy / panVel; }
        panDx = panDx = 0; // the bundle resets only the x delta here (b=b=0)
      }
      touch1 = t1; touch2 = t2;
    };
    const endPointer = (e) => {
      if (e.nativeEvent.instanceOf(TouchEvent)) touchMove(e.nativeEvent);
      else {
        panStart = null;
        document.body.removeClass("is-grabbing");
        this.panning = false;
        const dt = performance.now() - lastTime;
        panVel = s09Damp(panVel, dt, 0.8);
        if (dt > 100) this.panvX = this.panvY = 0;
        else { this.panvX /= panVel; this.panvY /= panVel; }
      }
    };
    backdrop.on("pointerdown", (e) => {
      if (e.nativeEvent.instanceOf(TouchEvent)) touchMove(e.nativeEvent);
      else {
        panStart = e.getLocalPosition(px.stage);
        panOrigin = { x: hanger.x, y: hanger.y };
        document.body.addClass("is-grabbing");
        this.panning = true;
      }
    });
    px.stage.on("pointermove", (e) => {
      if (e.nativeEvent.instanceOf(TouchEvent)) { touchMove(e.nativeEvent); return; }
      if (!panStart) return;
      const pos = e.getLocalPosition(px.stage);
      const x = panOrigin.x + pos.x - panStart.x;
      const y = panOrigin.y + pos.y - panStart.y;
      const now = performance.now();
      panVel = s09Damp(panVel, now - lastTime, 0.8);
      lastTime = now;
      this.panvX = s09Damp(this.panvX, x - this.panX, 0.8);
      this.panvY = s09Damp(this.panvY, y - this.panY, 0.8);
      this.setPan(x, y);
      this.changed();
    }).on("pointerup", endPointer).on("pointerupoutside", endPointer).eventMode = "static";
    px.stage.addChild(backdrop);
    px.stage.addChild(hanger);
    powerTag.initGraphics();
    this.updateZoom();
    this.renderCallback = function () {
      self.renderTimer = null;
      if (!self.px || self.idleFrames > 60) return;
      const results = self.workerResults;
      if (results) {
        const ids = results.id, buffer = results.buffer;
        let valid = true;
        if (buffer instanceof ArrayBuffer) {
          self.workerResults = null;
        } else {
          const version = new Uint32Array(buffer, buffer.byteLength - 4, 1);
          if (version[0] === results.v) valid = false; else results.v = version[0];
        }
        if (valid) {
          const positions = new Float32Array(buffer);
          for (let d = 0; d < ids.length; d++) {
            const node = self.nodeLookup[ids[d]];
            if (node) {
              node.x = positions[2 * d]; node.y = positions[2 * d + 1];
              if (node.fx) node.x = node.fx;
              if (node.fy) node.y = node.fy;
            }
          }
        }
      }
      const nodes = self.nodes, links = self.links;
      const keys = self.keyboardActions, shift = keys.shift;
      if (!self.panning) {
        self.panX += 1000 * self.panvX / 60;
        self.panY += 1000 * self.panvY / 60;
        let wx = 0, wy = 0;
        if (keys.up) wy += 1;
        if (keys.down) wy -= 1;
        if (keys.left) wx += 1;
        if (keys.right) wx -= 1;
        if (wx !== 0 || wy !== 0) self.idleFrames = 0;
        const boost = shift ? 3 : 1;
        self.panvX = s09Damp(self.panvX, wx * boost, 0.9);
        self.panvY = s09Damp(self.panvY, wy * boost, 0.9);
      }
      const grow = 1 + (shift ? 0.1 : 0.03);
      let zoomed = false;
      if (keys.zoomin) { self.targetScale *= grow; zoomed = true; }
      if (keys.zoomout) { self.targetScale /= grow; zoomed = true; }
      if (zoomed) {
        self.idleFrames = 0;
        const dpr = window.devicePixelRatio;
        self.zoomCenterX = self.width / 2 * dpr;
        self.zoomCenterY = self.height / 2 * dpr;
      }
      self.updateZoom();
      const scale = self.scale;
      const left = -self.panX / scale, top = -self.panY / scale;
      const right = left + self.width / scale * window.devicePixelRatio;
      const bottom = top + self.height / scale * window.devicePixelRatio;
      self.viewport = { left, right, top, bottom };
      const midX = (left + right) / 2, midY = (top + bottom) / 2;
      const byDist = [];
      const byDistSort = (a, b) => a.dist - b.dist;
      for (const node of nodes) {
        if (node.rendered) continue;
        const dx = node.x - midX, dy = node.y - midY;
        const dist = dx * dx + dy * dy;
        if (byDist.length < 50 || dist < byDist[byDist.length - 1].dist) {
          byDist.push({ node, dist });
          byDist.sort(byDistSort);
          if (byDist.length > 50) byDist.pop();
        }
      }
      if (byDist.length > 0) {
        for (const entry of byDist) entry.node.initGraphics();
        self.idleFrames = 0;
      }
      for (const link of links) link.initGraphics();
      for (const node of nodes) node.render();
      for (const link of links) link.render();
      powerTag.render();
      hanger.sortChildren();
      px.render();
      self.idleFrames++;
      self.queueRender();
      const mouseX = self.mouseX, mouseY = self.mouseY, highlight = self.highlightNode;
      if (mouseX !== null && mouseY !== null && highlight) {
        const dx = mouseX * window.devicePixelRatio - self.panX;
        const dy = mouseY * window.devicePixelRatio - self.panY;
        const hx = highlight.x - dx / scale, hy = highlight.y - dy / scale;
        const radius = highlight.getSize() * self.nodeScale + 2;
        if (hx * hx + hy * hy > radius * radius) {
          self.highlightNode = null;
          self.idleFrames = 0;
          if (self.onNodeUnhover) self.onNodeUnhover();
        }
      }
    };
    this.queueRender();
  };
  GraphRenderer.prototype.destroyGraphics = function () {
    const iframeEl = this.iframeEl, px = this.px;
    const links = this.links, nodes = this.nodes, powerTag = this.powerTag;
    this.hanger = null;
    for (const link of links) link.clearGraphics();
    for (const node of nodes) node.clearGraphics();
    if (powerTag) { this.powerTag = null; powerTag.clearGraphics(); }
    if (px) {
      px.renderer.events.setTargetElement(null);
      if (iframeEl && document.body.contains(iframeEl) && iframeEl.contentDocument) {
        px.destroy(true, { children: true, texture: true, baseTexture: true });
      }
      this.px = null;
    }
    this.containerEl.win.cancelAnimationFrame(this.renderTimer);
    this.renderTimer = null;
    this.renderCallback = null;
    document.body.removeClass("is-grabbing");
  };
  GraphRenderer.prototype.zoomTo = function (scale, center) {
    this.targetScale = scale;
    if (center) { this.zoomCenterX = center.x; this.zoomCenterY = center.y; }
    else this.zoomCenterX = this.zoomCenterY = 0;
  };
  GraphRenderer.prototype.onResize = function () {
    const px = this.px, hanger = this.hanger, containerEl = this.containerEl, interactiveEl = this.interactiveEl;
    const dpr = window.devicePixelRatio;
    const width = this.width = containerEl.clientWidth;
    const height = this.height = containerEl.clientHeight;
    if (px) {
      const w = Math.round(width * dpr), h = Math.round(height * dpr);
      const renderer = px.renderer, oldW = renderer.width, oldH = renderer.height;
      renderer.view.style.width = width + "px";
      renderer.view.style.height = height + "px";
      renderer.resize(w, h);
      interactiveEl.width = width; interactiveEl.height = height;
      renderer.events.resolutionChange(1 / dpr);
      if (hanger) this.setPan(this.panX + (w - oldW) / 2, this.panY + (h - oldH) / 2);
    }
    this.changed();
  };
  GraphRenderer.prototype.resetPan = function () {
    const dpr = window.devicePixelRatio;
    this.setPan(this.width / 2 * dpr, this.height / 2 * dpr);
  };
  GraphRenderer.prototype.setData = function (data) {
    const nodes = this.nodes, nodeLookup = this.nodeLookup, links = this.links;
    const incoming = data.nodes, positions = {}, removedNodes = [], removedLinks = [];
    let changed = false, colorsChanged = false;
    let maxDist = 0;
    for (const node of nodes) {
      if (incoming.hasOwnProperty(node.id)) {
        maxDist = Math.max(maxDist, node.x * node.x + node.y * node.y);
      } else { removedNodes.push(node); changed = true; }
    }
    const radius = Math.sqrt(maxDist);
    const added = [];
    for (const id in incoming) {
      if (!incoming.hasOwnProperty(id)) continue;
      const info = incoming[id];
      if (nodeLookup.hasOwnProperty(id)) {
        const node = nodeLookup[id];
        const color = info.color || null;
        if (node.color !== color) { node.color = color; colorsChanged = true; }
        if (node.type !== info.type) { node.type = info.type; colorsChanged = true; }
      } else {
        const node = new (s09GraphNode())(this, id, info.type);
        node.color = info.color || null;
        nodes.push(node); nodeLookup[id] = node; changed = true; added.push(node);
      }
    }
    for (const id in incoming) {
      if (!incoming.hasOwnProperty(id) || !nodeLookup.hasOwnProperty(id)) continue;
      const node = nodeLookup[id];
      const wanted = incoming[id].links;
      for (const key in node.forward) {
        if (node.forward.hasOwnProperty(key) && !wanted.hasOwnProperty(key)) {
          removedLinks.push(node.forward[key]); changed = true;
        }
      }
      for (const key in wanted) {
        if (wanted.hasOwnProperty(key) && !node.forward.hasOwnProperty(key) && nodeLookup.hasOwnProperty(key)) {
          const target = nodeLookup[key];
          const link = new (s09GraphLink())(this, node, target);
          links.push(link);
          node.forward[target.id] = link;
          target.reverse[node.id] = link;
          changed = true;
        }
      }
    }
    const dropLink = (link) => {
      link.clearGraphics();
      links.remove(link);
      delete link.source.forward[link.target.id];
      delete link.target.reverse[link.source.id];
    };
    for (const link of removedLinks) dropLink(link);
    for (const node of removedNodes) {
      node.clearGraphics();
      nodes.remove(node);
      delete nodeLookup[node.id];
      for (const key in node.forward) if (node.forward.hasOwnProperty(key)) dropLink(node.forward[key]);
      for (const key in node.reverse) if (node.reverse.hasOwnProperty(key)) dropLink(node.reverse[key]);
    }
    const count = added.length;
    if (count > 0) {
      const area = 60 * count * 60;
      const ring = Math.sqrt(area / Math.PI + radius * radius) - radius;
      const spread = Math.sqrt(area);
      for (const node of added) {
        const related = node.getRelated();
        let sx = 0, sy = 0, sn = 0;
        for (const key of related) {
          if (nodeLookup.hasOwnProperty(key)) {
            const other = nodeLookup[key];
            if (other.x !== null && other.y !== null) { sx += other.x; sy += other.y; sn++; }
          }
        }
        if (sn > 0) {
          node.x = sx / sn + (Math.random() - 0.5) * spread;
          node.y = sy / sn + (Math.random() - 0.5) * spread;
        } else {
          const angle = 2 * Math.random() * Math.PI;
          const dist = radius + Math.sqrt(Math.random()) * ring;
          node.x = dist * Math.cos(angle);
          node.y = dist * Math.sin(angle);
        }
        positions[node.id] = [node.x, node.y];
      }
    }
    const weights = data.weights;
    for (const id in nodeLookup) {
      if (!nodeLookup.hasOwnProperty(id)) continue;
      const node = nodeLookup[id];
      let weight = node.weight;
      weight = weights
        ? (weights.hasOwnProperty(id) ? weights[id] : 0)
        : node.getRelated().length;
      if (node.weight !== weight) { node.weight = weight; changed = true; }
    }
    if (changed) {
      const linkPairs = [];
      for (const link of links) linkPairs.push([link.source.id, link.target.id]);
      this.worker.postMessage({ nodes: positions, links: linkPairs, alpha: 0.3, run: true });
      this.changed();
    } else if (colorsChanged) {
      this.changed();
    }
  };
  GraphRenderer.prototype.setRenderOptions = function (options) {
    const nodeSize = options.nodeSizeMultiplier, lineSize = options.lineSizeMultiplier;
    const showArrow = options.showArrow, textFade = options.textFadeMultiplier;
    if (Number.isNumber(nodeSize)) this.fNodeSizeMult = nodeSize;
    if (Number.isNumber(lineSize)) this.fLineSizeMult = lineSize;
    if (Number.isNumber(textFade)) this.fTextShowMult = textFade;
    if (s09IsBoolean(showArrow)) this.fShowArrow = showArrow;
    this.changed();
  };
  GraphRenderer.prototype.setForces = function (forces) {
    this.worker.postMessage({ forces, alpha: 0.3, run: true });
  };
  GraphRenderer.prototype.getHighlightNode = function () { return this.dragNode || this.highlightNode; };
  GraphRenderer.prototype.updateZoom = function () {
    let scale = this.scale, target = this.targetScale;
    target = this.targetScale = Math.min(8, Math.max(1 / 128, target));
    if ((scale > target ? scale / target : target / scale) - 1 >= 0.01) {
      let cx = this.zoomCenterX, cy = this.zoomCenterY;
      if (cx === 0 && cy === 0) {
        const dpr = window.devicePixelRatio;
        cx = this.width / 2 * dpr; cy = this.height / 2 * dpr;
      }
      const lx = (cx - this.panX) / scale, ly = (cy - this.panY) / scale;
      scale = s09Damp(scale, target, 0.85);
      this.panX -= lx * scale + this.panX - cx;
      this.panY -= ly * scale + this.panY - cy;
      this.changed();
    }
    this.setPan(this.panX, this.panY);
    this.setScale(scale);
  };
  GraphRenderer.prototype.setPan = function (x, y) {
    const hanger = this.hanger;
    this.panX = x; this.panY = y;
    if (hanger) { hanger.x = x; hanger.y = y; }
  };
  GraphRenderer.prototype.setScale = function (scale) {
    const hanger = this.hanger;
    this.scale = scale;
    this.nodeScale = Math.sqrt(1 / scale);
    const exp = Math.log(scale) / Math.log(2);
    this.textAlpha = Math.clamp(exp + 1 - this.fTextShowMult, 0, 1);
    if (hanger) { hanger.scale.x = hanger.scale.y = scale; }
  };
  GraphRenderer.prototype.changed = function () { this.idleFrames = 0; this.queueRender(); };
  GraphRenderer.prototype.queueRender = function () {
    if (!this.renderTimer && this.renderCallback) {
      this.renderTimer = this.containerEl.win.requestAnimationFrame(this.renderCallback);
    }
  };
  GraphRenderer.prototype.testCSS = function () {
    const probe = (cls) => {
      const el = document.body.createDiv({ cls: "graph-view " + cls });
      const style = getComputedStyle(el);
      const color = style.color, opacity = style.opacity;
      el.detach();
      const parsed = env().Ak(color);
      let a = parseFloat(opacity);
      if (isNaN(a)) a = 1;
      if (parsed) return { a: a * parsed.a, rgb: parsed.r << 16 | parsed.g << 8 | parsed.b };
      return { a, rgb: 8947848 };
    };
    for (const key in s09GraphColorClasses) {
      if (s09GraphColorClasses.hasOwnProperty(key)) this.colors[key] = probe(s09GraphColorClasses[key]);
    }
    for (const node of this.nodes) node.fontDirty = true;
    const powerTag = this.powerTag;
    if (powerTag) powerTag.rendered = false;
    this.changed();
  };
  GraphRenderer.prototype.getTransparentScreenshot = function () {
    const px = this.px;
    px.render();
    return px.view;
  };
  GraphRenderer.prototype.getBackgroundScreenshot = function () {
    const src = this.getTransparentScreenshot();
    const canvas = document.createElement("canvas");
    canvas.width = src.width; canvas.height = src.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, src.width, src.height);
    ctx.drawImage(src, 0, 0);
    return canvas;
  };
  GraphRenderer.prototype.copyToClipboard = async function (canvas, type) {
    const blob = await env().Jc(canvas, type);
    await env().Mc(blob);
  };
  return GraphRenderer;
}
export function s09GraphRenderer() { return s09GOnce("s09GraphRenderer", s09buildGraphRenderer); }
