// Spatial helpers used by the canvas, graph and bases code: a quickselect over arbitrary
// keys, bounding-box math for the node hierarchies, and the rectangular selection ranges of
// the bases table/cards views. Everything here is plain data-in/data-out; the only DOM touch
// is the cell-rectangle reader, which works on plain objects.

// ---------- ordering ----------

/** Three-way comparison of two values: negative, zero or positive. */
export function s13Compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/** Swaps two slots of an array in place. */
export function s13Swap(list, i, j) {
  const tmp = list[i];
  list[i] = list[j];
  list[j] = tmp;
}

/**
 * Index of `item` in `list`, or -1. With a `match` function the first index whose
 * `match(item, candidate)` is truthy wins (note the argument order: item first).
 */
export function s13IndexOf(list, item, match) {
  if (!match) return list.indexOf(item);
  for (let i = 0; i < list.length; i++) if (match(item, list[i])) return i;
  return -1;
}

// ---------- quickselect ----------

/**
 * Reorders `list[lo..hi]` so that the element that belongs at `k` sits there and every
 * element before it is not greater (according to `compare`), without sorting the rest.
 * Recurses on both sides of the pivot like the classic Hoare-partition quickselect; large
 * spans first narrow the window with a median-of-medians style pivot guess.
 */
export function s13SelectKth(list, k, lo, hi, compare) {
  while (hi > lo) {
    if (hi - lo > 600) {
      const span = hi - lo + 1;
      const offset = k - lo + 1;
      const depth = Math.log(span);
      const pivotGuess = 0.5 * Math.exp((2 * depth) / 3);
      const delta = 0.5 * Math.sqrt((pivotGuess * span * (span - pivotGuess)) / span) * (offset - span / 2 < 0 ? -1 : 1);
      s13SelectKth(list, k,
        Math.max(lo, Math.floor(k - (offset * pivotGuess) / span + delta)),
        Math.min(hi, Math.floor(k + ((span - offset) * pivotGuess) / span + delta)),
        compare);
    }
    const pivot = list[k];
    let left = lo;
    let right = hi;
    s13Swap(list, lo, k);
    if (compare(list[hi], pivot) > 0) s13Swap(list, lo, hi);
    while (left < right) {
      s13Swap(list, left, right);
      left++;
      right--;
      while (compare(list[left], pivot) < 0) left++;
      while (compare(list[right], pivot) > 0) right--;
    }
    if (compare(list[lo], pivot) === 0) s13Swap(list, lo, right);
    else { s13Swap(list, ++right, hi); }
    if (right <= k) lo = right + 1;
    if (k <= right) hi = right - 1;
  }
}

/**
 * Moves the `k`-th smallest element (0-based) of `list` into position `k`; elements before
 * it are <= it. `lo`/`hi` default to the whole array, `compare` to numeric order.
 */
export function s13Quickselect(list, k, lo, hi, compare) {
  s13SelectKth(list, k, lo || 0, hi || list.length - 1, compare || s13Compare);
}

/**
 * Same selection applied independently to consecutive chunks of `size` elements, so every
 * chunk gets its own local ordering around the chunk's median index.
 */
export function s13QuickselectChunks(list, k, lo, hi, size, compare) {
  const stack = [lo, hi];
  while (stack.length) {
    const end = stack.pop();
    const start = stack.pop();
    if (end - start <= size) continue;
    const mid = start + Math.ceil((end - start) / size / 2) * size;
    s13Quickselect(list, mid, start, end, compare);
    stack.push(start, mid, mid, end);
  }
}

// ---------- bounding boxes ----------
// A bounds object is { minX, minY, maxX, maxY } (plus children/height/leaf for tree nodes).

/** An empty tree node holding `children` (null for a leaf placeholder). */
export function s13NewNode(children) {
  return { children, height: 1, leaf: true, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

/** Grows `bounds` to also cover `other`; returns `bounds`. */
export function s13GrowBounds(bounds, other) {
  bounds.minX = Math.min(bounds.minX, other.minX);
  bounds.minY = Math.min(bounds.minY, other.minY);
  bounds.maxX = Math.max(bounds.maxX, other.maxX);
  bounds.maxY = Math.max(bounds.maxY, other.maxY);
  return bounds;
}

/**
 * Bounding box of the children of `node` between indices `from` (inclusive) and `to`
 * (exclusive). Leaf children are measured through `measure(item)`; inner children already
 * carry their own bounds. Writes into `out` (a fresh node when omitted).
 */
export function s13ChildrenBounds(node, from, to, measure, out) {
  if (!out) out = s13NewNode(null);
  out.minX = Infinity;
  out.minY = Infinity;
  out.maxX = -Infinity;
  out.maxY = -Infinity;
  for (let i = from; i < to; i++) {
    const child = node.children[i];
    s13GrowBounds(out, node.leaf ? measure(child) : child);
  }
  return out;
}

/** Bounding box of every child of `node`; `measure` maps a leaf item to bounds. */
export function s13SubtreeBounds(node, measure) {
  return s13ChildrenBounds(node, 0, node.children.length, measure, node);
}

/** Sort key: left edge. */
export function s13BoundsMinX(b) { return b.minX; }
/** Sort key: top edge. */
export function s13BoundsMinY(b) { return b.minY; }
/** Twice the width plus twice the height (a cheap "size" ordering). */
export function s13BoundsSpan(b) { return b.maxX - b.minX + (b.maxY - b.minY); }
/** Area of the box. */
export function s13BoundsArea(b) { return (b.maxX - b.minX) * (b.maxY - b.minY); }
/** True when `inner` lies completely inside `outer`. */
export function s13BoundsContains(outer, inner) {
  return inner.minX >= outer.minX && inner.minY >= outer.minY && inner.maxX <= outer.maxX && inner.maxY <= outer.maxY;
}
/** True when the two boxes overlap (edges touching counts). */
export function s13BoundsOverlap(a, b) {
  return b.minX <= a.maxX && b.minY <= a.maxY && b.maxX >= a.minX && b.maxY >= a.minY;
}

// ---------- bases table/cards selection ranges ----------
// A cell is { row, column, groupIdx }; a range is { top, bottom, start, end, groupIdx }.

/** A single-cell range, or null for a missing cell. */
export function s13CellRange(cell) {
  return cell ? { start: cell.column, top: cell.row, end: cell.column, bottom: cell.row, groupIdx: cell.groupIdx } : null;
}

/**
 * Range from `range` (null = start at `cell`) extended to include `cell`. Rows/columns that
 * the original range boundary sits strictly inside are pulled out to the cell's edge, which
 * is what makes dragging across a partially covered row/column select it whole.
 */
export function s13ExtendRange(range, cell, target) {
  if (range == null) range = s13CellRange(cell);
  let top = range.top;
  let bottom = range.bottom;
  let start = range.start;
  let end = range.end;
  const groupIdx = range.groupIdx;
  const row = target.row;
  const column = target.column;
  top = Math.min(top, row);
  bottom = Math.max(bottom, row);
  start = Math.min(start, column);
  end = Math.max(end, column);
  if (cell.row === range.top && row > range.top && row <= range.bottom) top = row;
  if (cell.row === range.bottom && row < range.bottom && row >= range.top) bottom = row;
  if (cell.column === range.start && column > range.start && column <= range.end) start = column;
  if (cell.column === range.end && column < range.end && column >= range.start) end = column;
  return { top, bottom, start, end, groupIdx };
}
