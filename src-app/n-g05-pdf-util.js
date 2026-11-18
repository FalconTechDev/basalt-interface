// g05 clean-room: shared helpers for the PDF modules — the i18n table alias,
// the themed-storage key, text-layer offset helpers, the subpath parser and
// small DOM/event utilities used by the viewer controller.
import { env, hostEnv } from "./env.js";
import { intOrNull } from "./text.js";

/** i18n table the neighbouring inherited code still reads through the RZ/VZ/zZ aliases. */
export function ng05PdfI18n() { return hostEnv().gm.pdf; }

/** localStorage key remembering whether the pdf pages adapt to the theme. */
export const ng05PdfStorageKey = "pdfjs-is-themed";

/** The `.textLayerNode` element containing `node` inside `root`, or null. */
export function ng05TextLayerNodeAt(root, node) {
  if (!root || !root.contains || !root.contains(node)) return null;
  const isEl = node.nodeType === 1;
  if (isEl && node.hasClass && node.hasClass("textLayerNode")) return node;
  let cur = node;
  while ((cur = cur.parentNode)) {
    if (cur === root) return null;
    if (cur.nodeType === 1 && cur.hasClass && cur.hasClass("textLayerNode")) return cur;
  }
  return null;
}

/**
 * Character offset of a selection boundary inside its `.textLayerNode`.
 * `node` is the boundary container (a text node or the element itself) and
 * `offset` the DOM offset; text-node lengths are counted in document order
 * up to the target node, then `offset` is added.
 */
export function ng05TextOffsetAt(root, node, offset) {
  const layerNode = ng05TextLayerNodeAt(root, node);
  if (!layerNode) return null;
  const doc = layerNode.ownerDocument || (root.doc || document);
  if (node === layerNode) {
    // DOM offset on an element indexes child nodes — convert to chars
    let pos = 0;
    const kids = layerNode.childNodes;
    for (let i = 0; i < offset && i < kids.length; i++) {
      pos += kids[i].textContent ? kids[i].textContent.length : 0;
    }
    return pos;
  }
  const walker = doc.createNodeIterator(layerNode, NodeFilter.SHOW_TEXT);
  let pos = 0, cur;
  while ((cur = walker.nextNode())) {
    if (cur === node) return pos + offset;
    pos += cur.textContent.length;
  }
  return null;
}

/**
 * Parses a pdf subpath ("#page=N&offset=x,y,zoom&annotation=ID&selection=a,b,c,d&height=H").
 * Returns { query, page, destJson, highlight, height }:
 *  - query: the subpath without the leading '#' (what pdf.js consumes as `subpath`)
 *  - destJson: JSON explicit destination array, or null when there is no page param
 *  - highlight: {type:"text",page,range} | {type:"annotation",page,id} | null
 *  - height: integer embed height or null
 */
export function ng05ParsePdfSubpath(subpath) {
  const raw = subpath || "";
  const query = raw.startsWith("#") ? raw.slice(1) : raw;
  const params = new URLSearchParams(query);
  const pageParam = params.get("page");
  if (pageParam === null) {
    return { query, page: null, destJson: null, highlight: null, height: null };
  }
  let page = parseInt(pageParam, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  let x = null, y = null, z = null;
  const offset = params.get("offset");
  if (offset !== null) {
    const parts = offset.split(",");
    x = intOrNull(parts[0]);
    y = intOrNull(parts[1]);
    z = intOrNull(parts[2]);
  }
  const dest = z !== null
    ? [page - 1, { name: "XYZ" }, x, y, z]
    : [page - 1, { name: "FitBH" }, y];
  let highlight = null;
  const annotation = params.get("annotation");
  const selection = params.get("selection");
  if (annotation !== null) {
    highlight = { type: "annotation", page, id: annotation };
  } else if (selection !== null) {
    const parts = selection.split(",").map((v) => intOrNull(v));
    if (parts.length >= 4 && parts[0] !== null && parts[1] !== null && parts[2] !== null && parts[3] !== null) {
      highlight = { type: "text", page, range: [[parts[0], parts[1]], [parts[2], parts[3]]] };
    }
  }
  const heightParam = params.get("height");
  return {
    query,
    page,
    // plain "#page=N" links navigate to the top of the page; offset/zoom
    // variants keep the explicit destination array
    simple: offset === null && params.get("zoom") === null,
    destJson: JSON.stringify(dest),
    highlight,
    height: heightParam === null ? null : intOrNull(heightParam),
  };
}

function ng05HostValue(host, key) {
  try {
    const h = host || hostEnv();
    const v = h && h[key];
    return v === undefined ? null : v;
  } catch (e) { return null; }
}

/** pdf.js viewer namespace (pdfjsViewer) — the host getter throws a bare
 *  ReferenceError while pdf.js is not loaded, so globalThis is probed first
 *  and host access is guarded. */
export function ng05PdfViewerNs(host) {
  const g = globalThis.pdfjsViewer;
  if (g) return g;
  const v = ng05HostValue(host, "s27PdfViewerNs");
  if (v) return v;
  try { const e = env().pdfjsViewer; if (e) return e; } catch (err) { /* not a bundle name */ }
  return undefined;
}

/** pdf.js library namespace (pdfjsLib) — same guarded access as above. */
export function ng05PdfLib(host) {
  const g = globalThis.pdfjsLib;
  if (g) return g;
  const v = ng05HostValue(host, "s27PdfLib");
  if (v) return v;
  try { const e = env().pdfjsLib; if (e) return e; } catch (err) { /* not a bundle name */ }
  return undefined;
}

/** The inner PDFViewer of an app-level pdf.js viewer object, or null. */
export function ng05InnerViewer(app) { return app && app.pdfViewer ? app.pdfViewer : null; }

/** Dispatches a named event on the controller's pdf.js event bus. */
export function ng05BusDispatch(controller, name, data) {
  const bus = controller && controller.eventBus;
  if (bus && bus.dispatch) bus.dispatch(name, data);
}

/** True while the controller's viewer is usable (loaded and not torn down). */
export function ng05ViewerReady(controller) {
  return !!(controller && controller._active && controller.pdfViewer);
}
