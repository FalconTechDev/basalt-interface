// Geometry and DOM-rect helpers used by the canvas and bases code, plus the small
// scroll/visibility watchers. The pure math lives in misc.js; this module only adapts it
// to the shapes the views pass around (points, rects, boxes, elements).
import { point, rect, rectAt, centeredOrigin, distance, sideMidpoint, boxX, boxY, sortByKey, unitSteps } from "./misc.js";
import { floatOr } from "./text.js";

/** A plain digit-string test shared by the canvas colour theming. */
export const s13DigitsRe = /^(\d+)$/;
/** "r, g, b" triple used by the canvas colour parser. */
export const s13RgbRe = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/i;

/**
 * Client rect of `el` as {left, top, width, height, cx, cy, minX, minY, maxX, maxY},
 * offset by the element's border (clientLeft/clientTop) so it lines up with layout coords.
 */
export function s13DomRect(el) {
  const r = el.getBoundingClientRect();
  const left = r.left + el.clientLeft;
  const top = r.top + el.clientTop;
  const width = el.clientWidth;
  const height = el.clientHeight;
  return { left, top, width, height, cx: left + width / 2, cy: top + height / 2, minX: -width / 2, minY: -height / 2, maxX: width / 2, maxY: height / 2 };
}

/**
 * The part of `el` that is actually visible: the element's client rect clipped by every
 * scrollable ancestor (and the window). Returned in client coordinates scaled by the
 * element's own pixel ratio correction. A `.print` ancestor means "everything".
 */
export function s13VisibleRect(el) {
  if (el.closest(".print")) return { top: 0, left: 0, bottom: Infinity, right: Infinity };
  const r = el.getBoundingClientRect();
  const scale = r.width > 0 ? el.clientWidth / Math.round(r.width) : r.height > 0 ? el.clientHeight / Math.round(r.height) : 1;
  const doc = el.ownerDocument;
  const win = doc.defaultView || window;
  let clipLeft = 0;
  let clipRight = win.innerWidth;
  let clipTop = 0;
  let clipBottom = win.innerHeight;
  let node = el.parentNode;
  while (node && node != doc.body) {
    if (node.nodeType == 1) {
      const style = window.getComputedStyle(node);
      if ((node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) && style.overflow != "visible") {
        const pr = node.getBoundingClientRect();
        clipLeft = Math.max(clipLeft, pr.left);
        clipRight = Math.min(clipRight, pr.right);
        clipTop = Math.max(clipTop, pr.top);
        clipBottom = Math.min(node == el.parentNode ? win.innerHeight : clipBottom, pr.bottom);
      }
      node = style.position == "absolute" || style.position == "fixed" ? node.offsetParent : node.parentNode;
    } else {
      if (node.nodeType != 11) break;
      node = node.host;
    }
  }
  return {
    left: scale * (clipLeft - r.left),
    right: scale * (Math.max(clipLeft, clipRight) - r.left),
    top: scale * (clipTop - r.top),
    bottom: scale * (Math.max(clipTop, clipBottom) - r.top),
  };
}

/**
 * Calls `onChange` whenever `el` scrolls inside its current window or crosses the
 * intersection-observer threshold. Returns a disposer. `el` must offer isShown(), win and
 * onNodeInserted() (Component instances do).
 */
export function s13ScrollWatch(el, onChange) {
  let win = null;
  const observer = new IntersectionObserver(onChange, { threshold: unitSteps(1e3) });
  function onScroll(event) {
    if (win && event.target.contains(el)) onChange();
  }
  function sync() {
    const prev = win;
    const next = el.isShown() ? el.win : null;
    if (next === prev) return;
    if (prev) prev.removeEventListener("scroll", onScroll, { capture: true });
    if (next) next.addEventListener("scroll", onScroll, { capture: true, passive: true });
    win = next;
    onChange();
  }
  observer.observe(el);
  sync();
  const offInserted = el.onNodeInserted(sync);
  return function () {
    offInserted();
    observer.disconnect();
    if (win) {
      win.removeEventListener("scroll", onScroll, { capture: true });
      win = null;
    }
  };
}

/** Joins key names for display ("Ctrl + Alt" style), translating modifiers on macOS. */
export function s13KeyNames(keys, host) {
  const names = keys.map((k) => (Object.prototype.hasOwnProperty.call(host.keyNames, k) ? host.keyNames[k] : k));
  return names.join(host.Platform.isMacOS ? " " : " + ");
}

/** Reads the four padding values of a view config into {top,bottom,start,end} lengths. */
export function s13PaddingBox(config) {
  return {
    top: floatOr(config.paddingTop, 0),
    bottom: floatOr(config.paddingBottom, 0),
    start: floatOr(config.paddingInlineStart, 0),
    end: floatOr(config.paddingInlineEnd, 0),
  };
}

/**
 * Anchor point for an edge interaction: `placement` ("left" | "top" | "right" | "bottom" |
 * "center" | a corner name) refines the origin; the rect itself is always returned.
 */
export function s13AnchorRect(origin, box, placement) {
  if (placement) {
    origin = placement === "center" ? centeredOrigin(origin, box) : (function (r, side) {
      const x = r.x;
      const y = r.y;
      const w = r.width;
      const h = r.height;
      switch (side) {
        case "left": return point(x, y - h / 2);
        case "top": return point(x - w / 2, y);
        case "right": return point(x - w, y - h / 2);
        case "bottom": return point(x - w / 2, y - h);
      }
    })(rectAt(origin, box), placement);
  }
  return rectAt(origin, box);
}

/** Resize handle geometry: which zero-size rect a side/corner drag starts from. */
export function s13ResizeOrigin(side, point_, box) {
  const x = box.x;
  const y = box.y;
  const w = box.width;
  const h = box.height;
  let source;
  let resizeX;
  let resizeY;
  switch (side) {
    case "top":
    case "bottom":
      source = rect(x, point_.y, w, 0);
      resizeX = false;
      resizeY = true;
      break;
    case "left":
    case "right":
      source = rect(point_.x, y, 0, h);
      resizeX = true;
      resizeY = false;
      break;
    case "topleft":
    case "topright":
    case "bottomleft":
    case "bottomright":
      source = rect(point_.x, point_.y, 0, 0);
      resizeX = true;
      resizeY = true;
  }
  return { source, resizeX, resizeY };
}

/**
 * The node whose bounding box comes closest to `point` (within `maxDistance`), answered as
 * {side, node} where side is the nearest edge midpoint direction. Null when nothing is in
 * range.
 */
export function s13NearestSide(point_, nodes, maxDistance) {
  let best = [Infinity, null];
  for (const node of nodes) {
    const b = node.getBBox();
    const sides = [["top", sideMidpoint(b, "top")], ["right", sideMidpoint(b, "right")], ["bottom", sideMidpoint(b, "bottom")], ["left", sideMidpoint(b, "left")]];
    for (const [side, mid] of sides) {
      const d = distance(point_, mid);
      if (d <= maxDistance) return { side, node };
      if (d < best[0]) best = [d, { side, node }];
    }
  }
  return best[1];
}

/**
 * Aligns two lists sorted in place by their x (axis "x") or y key, returning the runs
 * where source and destination items share a key. `delta` is the current best offset; a
 * smaller non-zero offset found along the way resets the accumulated matches.
 */
export function s13MatchSpans(source, dest, delta, axis) {
  if (source.length === 0 || dest.length === 0) return null;
  const key = axis === "x" ? boxX : boxY;
  sortByKey(source, key);
  sortByKey(dest, key);
  let bestDelta = delta;
  const matches = [];
  let srcRun = [];
  let dstRun = [];
  let lastKey = Infinity;
  for (const item of source) {
    const k = key(item);
    if (k !== lastKey) {
      lastKey = k;
      if (srcRun.length > 0 || dstRun.length > 0) {
        matches.push({ src: srcRun, dest: dstRun });
        srcRun = [];
        dstRun = [];
      }
      // binary search for the first dest with key >= k
      let lo = 0;
      let hi = dest.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const diff = k - key(dest[mid]);
        if (diff > 0) lo = mid + 1;
        else if (diff < 0) hi = mid - 1;
        else { lo = hi = mid; break; }
      }
      if (lo !== hi) {
        if (hi < 0) hi = 0;
        else if (lo >= dest.length - 1) lo = dest.length - 1;
        else {
          const leftDiff = key(dest[lo]) - k;
          const rightDiff = k - key(dest[hi]);
          if (leftDiff === rightDiff) {
            if (leftDiff === bestDelta) hi = lo;
            else lo = hi;
          } else {
            const pick = leftDiff < rightDiff ? lo : hi;
            lo = hi = pick;
          }
        }
      }
      const destKey = key(dest[lo]);
      const off = destKey - k;
      if (off === bestDelta || Math.abs(off) < Math.abs(bestDelta)) {
        if (off !== bestDelta) {
          matches.length = 0;
          srcRun = [];
          dstRun = [];
          bestDelta = off;
        }
        while (lo > 0 && key(dest[lo - 1]) === destKey) lo--;
        while (hi < dest.length - 1 && key(dest[hi + 1]) === destKey) hi++;
        srcRun.push(item);
        for (let c = lo; c <= hi; c++) dstRun.push(dest[c]);
      }
    } else if (srcRun.length > 0 && key(srcRun[srcRun.length - 1]) === k) {
      srcRun.push(item);
    }
  }
  if (srcRun.length > 0 || dstRun.length > 0) matches.push({ src: srcRun, dest: dstRun });
  return matches.length === 0 ? null : { matches, delta: bestDelta };
}

/**
 * Applies a canvas colour name/custom value to `el`: clears previous colour classes, sets
 * `is-themed`, then either a numbered `mod-canvas-color-N` class or a custom
 * `--canvas-color` property parsed through the host colour parser.
 */
export function s13ApplyCanvasColor(el, color, host) {
  color = (color || "").trim();
  const classes = Array.from(el.classList);
  for (const cls of classes) {
    if (cls.startsWith("mod-canvas-color")) el.removeClass(cls);
  }
  el.style.removeProperty("--canvas-color");
  el.toggleClass("is-themed", !!color);
  if (!color) return;
  if (s13DigitsRe.test(color)) {
    el.addClass("mod-canvas-color-" + color);
    return;
  }
  const parsed = host.s13ParseColor(color);
  if (parsed) {
    el.addClass("mod-canvas-color-custom");
    el.style.setProperty("--canvas-color", `${parsed.r},${parsed.g},${parsed.b}`);
  }
}
