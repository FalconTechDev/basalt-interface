// Small self-contained pieces of the canvas subsystem.
//
// CanvasUndoStack (l5): the bounded undo/redo ring the canvas keeps node drags, resizes and edits in.
// SpatialIndex (Y3): the RBush-style bounding-box index the canvas uses for hit-testing and viewport
// queries (ported readably; the original was the stock rbush algorithm).
// CanvasDataCache (n8): per-file canvas JSON kept in localStorage under "canvas-<path>" so unopened
// canvases still resolve links; handles renames and deletes.
// NodeInteractionLayer (M5): the overlay of resize handles / connection points drawn above the
// selected canvas node; it forwards pointer events to the node's handlers.

// host is provided per factory; canvasHost is bound by the first factory that runs (all share the same host).
let canvasHost = null;
function bindCanvasHost(host) {
  canvasHost = host;
  return host;
}

// Classes produced by the factories below, visible to each other regardless of factory order.
const canvas = {};

// =====================================================================================================================
// Bounded undo/redo stack (l5)
// =====================================================================================================================

export function defineCanvasUndoStack(host) {
  bindCanvasHost(host);

  /**
   * `max` entries of undo history. `current` points at the entry redo() would restore; push()
   * truncates anything after it, so a new edit after an undo drops the redo tail.
   */
  function CanvasUndoStack(max) {
    this.data = [];
    this.current = 0;
    this.max = max;
  }
  const proto = CanvasUndoStack.prototype;

  proto.canUndo = function () {
    return this.current > 0;
  };

  proto.undo = function () {
    if (!this.canUndo()) return null;
    this.current--;
    return this.data[this.current];
  };

  proto.canRedo = function () {
    return this.current < this.data.length - 1;
  };

  proto.redo = function () {
    if (!this.canRedo()) return null;
    this.current++;
    return this.data[this.current];
  };

  proto.push = function (entry) {
    const data = this.data;
    if (data.length - 1 > this.current) data.length = this.current + 1;
    data.push(entry);
    if (data.length >= this.max) data.shift();
    this.current = data.length - 1;
  };

  proto.replace = function (entry) {
    const data = this.data;
    if (data.length === 0) {
      data.push(entry);
      this.current = 0;
    } else {
      data[this.current] = entry;
    }
  };

  proto.clear = function () {
    this.data.length = 0;
    this.current = 0;
  };

  canvas.UndoStack = CanvasUndoStack;
  return CanvasUndoStack;
}

// =====================================================================================================================
// Bounding-box spatial index (Y3, an RBush port)
// =====================================================================================================================

function rbBox() {
  return { children: [], height: 1, leaf: true, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function rbCalcBBox(node, toBBox, box) {
  box = box || rbBox();
  box.minX = Infinity;
  box.minY = Infinity;
  box.maxX = -Infinity;
  box.maxY = -Infinity;
  rbExtendBBox(node, box, toBBox);
  return box;
}

function rbExtendBBox(node, box, toBBox) {
  if (node.leaf) {
    for (let i = 0; i < node.children.length; i++) rbExtendItem(node.children[i], box, toBBox);
  } else {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      box.minX = Math.min(box.minX, child.minX);
      box.minY = Math.min(box.minY, child.minY);
      box.maxX = Math.max(box.maxX, child.maxX);
      box.maxY = Math.max(box.maxY, child.maxY);
    }
  }
  return box;
}

function rbExtendItem(item, box, toBBox) {
  const b = toBBox(item);
  box.minX = Math.min(box.minX, b.minX);
  box.minY = Math.min(box.minY, b.minY);
  box.maxX = Math.max(box.maxX, b.maxX);
  box.maxY = Math.max(box.maxY, b.maxY);
  return box;
}

/** Extends `node`'s box by an already-computed box (the J3 of the original). */
function rbExtendBox(node, box) {
  node.minX = Math.min(node.minX, box.minX);
  node.minY = Math.min(node.minY, box.minY);
  node.maxX = Math.max(node.maxX, box.maxX);
  node.maxY = Math.max(node.maxY, box.maxY);
  return node;
}

/** The box of a child: leaf items go through toBBox, inner nodes already carry one. */
function rbChildBox(parent, child, toBBox) {
  return parent.leaf ? toBBox(child) : child;
}

function rbCompareMinX(a, b) { return a.minX - b.minX; }
function rbCompareMinY(a, b) { return a.minY - b.minY; }
function rbBBoxArea(box) { return (box.maxX - box.minX) * (box.maxY - box.minY); }
function rbBBoxMargin(box) { return box.maxX - box.minX + (box.maxY - box.minY); }
function rbContains(box, other) {
  return box.minX <= other.minX && box.minY <= other.minY && other.maxX <= box.maxX && other.maxY <= box.maxY;
}
function rbIntersects(box, other) {
  return other.minX <= box.maxX && other.minY <= box.maxY && other.maxX >= box.minX && other.maxY >= box.minY;
}

function rbPartition(items, left, right, count, compare) {
  const stack = [left, right];
  while (stack.length) {
    right = stack.pop();
    left = stack.pop();
    if (right - left <= count) continue;
    const mid = left + Math.ceil((right - left) / count / 2) * count;
    rbQuickSelect(items, mid, left, right, compare);
    stack.push(left, mid, mid, right);
  }
}

function rbQuickSelect(items, k, left, right, compare) {
  rbSelect(items, k, left == null ? 0 : left, right == null ? items.length - 1 : right, compare || rbDefaultCompare);
}

function rbSelect(items, k, left, right, compare) {
  while (right > left) {
    if (right - left > 600) {
      const n = right - left + 1;
      const m = k - left + 1;
      const log = Math.log(n);
      const s = 0.5 * Math.exp((2 * log) / 3);
      const z = 0.5 * Math.sqrt(s * (n - s) / n) * (m - n / 2 < 0 ? -1 : 1);
      rbSelect(items, k, Math.max(left, Math.floor(k - (m * s) / n + z)), Math.min(right, Math.floor(k + ((n - m) * s) / n + z)), compare);
    }
    const pivot = items[k];
    let i = left;
    let j = right;
    rbSwap(items, left, k);
    if (compare(items[right], pivot) > 0) rbSwap(items, left, right);
    while (i < j) {
      rbSwap(items, i, j);
      i++;
      j--;
      while (compare(items[i], pivot) < 0) i++;
      while (compare(items[j], pivot) > 0) j--;
    }
    if (compare(items[left], pivot) === 0) rbSwap(items, left, j);
    else {
      j++;
      rbSwap(items, j, right);
    }
    if (j <= k) left = j + 1;
    if (k <= j) right = j - 1;
  }
}

function rbSwap(items, i, j) {
  const tmp = items[i];
  items[i] = items[j];
  items[j] = tmp;
}

function rbDefaultCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rbIndexOf(items, item, equals) {
  if (!equals) return items.indexOf(item);
  for (let i = 0; i < items.length; i++) {
    if (equals(item, items[i])) return i;
  }
  return -1;
}

function rbAll(node, result) {
  const stack = [];
  while (node) {
    if (node.leaf) {
      result.push.apply(result, node.children);
    } else {
      stack.push.apply(stack, node.children);
    }
    node = stack.pop();
  }
  return result;
}

function rbCalcBBoxSlice(node, from, to, toBBox, box) {
  box = box || rbBox();
  box.minX = Infinity;
  box.minY = Infinity;
  box.maxX = -Infinity;
  box.maxY = -Infinity;
  rbExtendBBoxRange(node, from, to, toBBox, box);
  return box;
}

function rbExtendBBoxRange(node, from, to, toBBox, box) {
  for (let i = from; i < to; i++) {
    const child = node.children[i];
    if (node.leaf) rbExtendItem(child, box, toBBox);
    else {
      box.minX = Math.min(box.minX, child.minX);
      box.minY = Math.min(box.minY, child.minY);
      box.maxX = Math.max(box.maxX, child.maxX);
      box.maxY = Math.max(box.maxY, child.maxY);
    }
  }
  return box;
}

// The SpatialIndex class produced by defineSpatialIndex; the bbox variants below subclass it.
let spatialIndexClass = null;

export function defineSpatialIndex(host) {
  bindCanvasHost(host);

  /**
   * Bounding-volume hierarchy over items with {minX,minY,maxX,maxY} boxes. `toBBox(item)` maps an
   * item to its box (identity by default; canvas subclasses return node.bbox). `compareMinX/Y` pick
   * the split axis comparators for inner nodes.
   */
  function SpatialIndex(maxEntries) {
    if (maxEntries === undefined) maxEntries = 9;
    this._maxEntries = Math.max(4, maxEntries);
    this._minEntries = Math.max(2, Math.ceil(0.4 * this._maxEntries));
    this.clear();
  }
  const proto = SpatialIndex.prototype;

  proto.all = function () {
    return rbAll(this.data, []);
  };

  proto.search = function (bbox) {
    let node = this.data;
    const result = [];
    if (!rbIntersects(bbox, node)) return result;
    const toBBox = this.toBBox;
    const stack = [];
    while (node) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const box = rbChildBox(node, child, toBBox);
        if (rbIntersects(bbox, box)) {
          if (node.leaf) result.push(child);
          else if (rbContains(box, bbox)) rbAll(child, result);
          else stack.push(child);
        }
      }
      node = stack.pop();
    }
    return result;
  };

  proto.collides = function (bbox) {
    let node = this.data;
    if (!rbIntersects(bbox, node)) return false;
    const stack = [];
    while (node || stack.length) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const box = rbChildBox(node, child, this.toBBox);
        if (rbIntersects(bbox, box)) {
          if (node.leaf || rbContains(box, bbox)) return true;
          stack.push(child);
        }
      }
      node = stack.pop();
    }
    return false;
  };

  proto.load = function (items) {
    if (!items || !items.length) return this;
    if (items.length < this._minEntries) {
      for (let i = 0; i < items.length; i++) this.insert(items[i]);
      return this;
    }
    const newRoot = this._build(items.slice(), 0, items.length - 1, 0);
    if (this.data.children.length) {
      if (this.data.height === newRoot.height) {
        this._splitRoot(this.data, newRoot);
      } else {
        if (this.data.height < newRoot.height) {
          const tmp = this.data;
          this.data = newRoot;
          newRoot = tmp;
        }
        this._insert(newRoot, this.data.height - newRoot.height - 1, true);
      }
    } else {
      this.data = newRoot;
    }
    return this;
  };

  proto.insert = function (item) {
    if (item) this._insert(item, this.data.height - 1);
    return this;
  };

  proto.clear = function () {
    this.data = rbBox();
    return this;
  };

  proto.remove = function (item, equals) {
    if (!item) return this;
    const bbox = this.toBBox(item);
    const stack = [];
    const path = [];
    let node = this.data;
    let index;
    let parent;
    let goingUp;
    while (node || stack.length) {
      if (!node) {
        node = stack.pop();
        parent = stack[stack.length - 1];
        index = path.pop();
        goingUp = true;
      }
      if (node.leaf) {
        const pos = rbIndexOf(node.children, item, equals);
        if (pos !== -1) {
          node.children.splice(pos, 1);
          stack.push(node);
          this._condense(stack);
          return this;
        }
      }
      if (goingUp || node.leaf || !rbContains(node, bbox)) {
        if (parent) {
          index++;
          node = parent.children[index];
          goingUp = false;
        } else {
          node = null;
        }
      } else {
        stack.push(node);
        path.push(index);
        index = 0;
        parent = node;
        node = node.children[0];
      }
    }
    return this;
  };

  proto.toBBox = function (item) {
    return item;
  };

  proto.compareMinX = function (a, b) {
    return a.minX - b.minX;
  };

  proto.compareMinY = function (a, b) {
    return a.minY - b.minY;
  };

  proto.toJSON = function () {
    return this.data;
  };

  proto.fromJSON = function (data) {
    this.data = data;
    return this;
  };

  proto._all = function (node, result) {
    return rbAll(node, result);
  };

  proto._build = function (items, left, right, height) {
    const count = right - left + 1;
    let maxEntries = this._maxEntries;
    if (count <= maxEntries) {
      const node = rbBox();
      node.children = items.slice(left, right + 1);
      rbCalcBBox(node, this.toBBox, node);
      return node;
    }
    if (!height) {
      height = Math.ceil(Math.log(count) / Math.log(maxEntries));
      maxEntries = Math.ceil(count / Math.pow(maxEntries, height - 1));
    }
    const node = rbBox();
    node.leaf = false;
    node.height = height;
    const M = Math.ceil(count / maxEntries);
    const N = M * Math.ceil(Math.sqrt(maxEntries));
    rbPartition(items, left, right, N, this.compareMinX);
    for (let i = left; i <= right; i += N) {
      const end = Math.min(i + N - 1, right);
      rbPartition(items, i, end, M, this.compareMinY);
      for (let j = i; j <= end; j += M) {
        const subEnd = Math.min(j + M - 1, end);
        node.children.push(this._build(items, j, subEnd, height - 1));
      }
    }
    rbCalcBBox(node, this.toBBox, node);
    return node;
  };

  proto._chooseSubtree = function (bbox, node, height, path) {
    while (path.push(node), !node.leaf && path.length - 1 !== height) {
      let minArea = Infinity;
      let minEnlargement = Infinity;
      let target = undefined;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const area = rbBBoxArea(child);
        const enlargement = rbEnlargement(bbox, child);
        if (enlargement < minEnlargement) {
          minEnlargement = enlargement;
          minArea = area < minArea ? area : minArea;
          target = child;
        } else if (enlargement === minEnlargement && area < minArea) {
          minArea = area;
          target = child;
        }
      }
      node = target || node.children[0];
    }
    return node;
  };

  proto._insert = function (item, level, isNode) {
    const bbox = isNode ? item : this.toBBox(item);
    const path = [];
    const node = this._chooseSubtree(bbox, this.data, level, path);
    node.children.push(item);
    rbExtendBox(node, bbox);
    for (let i = level; i >= 0 && path[i].children.length > this._maxEntries; i--) {
      this._split(path, i);
    }
    this._adjustParentBBoxes(bbox, path, level);
  };

  proto._split = function (path, level) {
    const node = path[level];
    const M = node.children.length;
    const m = this._minEntries;
    this._chooseSplitAxis(node, m, M);
    const index = this._chooseSplitIndex(node, m, M);
    const right = rbBox();
    right.children = node.children.splice(index, node.children.length - index);
    right.height = node.height;
    right.leaf = node.leaf;
    rbCalcBBox(node, this.toBBox, node);
    rbCalcBBox(right, this.toBBox, right);
    if (level) path[level - 1].children.push(right);
    else this._splitRoot(node, right);
  };

  proto._splitRoot = function (left, right) {
    this.data = rbBox();
    this.data.children = [left, right];
    this.data.height = left.height + 1;
    this.data.leaf = false;
    rbCalcBBox(this.data, this.toBBox, this.data);
  };

  proto._chooseSplitIndex = function (node, m, M) {
    let index;
    let minOverlap = Infinity;
    let minArea = Infinity;
    for (let i = m; i <= M - m; i++) {
      const leftBox = rbCalcBBoxSlice(node, 0, i, this.toBBox);
      const rightBox = rbCalcBBoxSlice(node, i, M, this.toBBox);
      const overlap = rbOverlapArea(leftBox, rightBox);
      const area = rbBBoxArea(leftBox) + rbBBoxArea(rightBox);
      if (overlap < minOverlap) {
        minOverlap = overlap;
        minArea = area < minArea ? area : minArea;
        index = i;
      } else if (overlap === minOverlap && area < minArea) {
        minArea = area;
        index = i;
      }
    }
    return index || M - m;
  };

  proto._chooseSplitAxis = function (node, m, M) {
    const compareMinX = node.leaf ? this.compareMinX : rbCompareMinX;
    const compareMinY = node.leaf ? this.compareMinY : rbCompareMinY;
    this._allDistMargin(node, m, M, compareMinX) < this._allDistMargin(node, m, M, compareMinY)
      ? node.children.sort(compareMinX)
      : node.children.sort(compareMinY);
  };

  proto._allDistMargin = function (node, m, M, compare) {
    node.children.sort(compare);
    const toBBox = this.toBBox;
    const leftBox = rbCalcBBoxSlice(node, 0, m, toBBox);
    const rightBox = rbCalcBBoxSlice(node, M - m, M, toBBox);
    let margin = rbBBoxMargin(leftBox) + rbBBoxMargin(rightBox);
    for (let i = m; i < M - m; i++) {
      rbExtendBox(leftBox, rbChildBox(node, node.children[i], toBBox));
      margin += rbBBoxMargin(leftBox);
    }
    for (let i = M - m - 1; i >= m; i--) {
      rbExtendBox(rightBox, rbChildBox(node, node.children[i], toBBox));
      margin += rbBBoxMargin(rightBox);
    }
    return margin;
  };

  proto._adjustParentBBoxes = function (bbox, path, level) {
    for (let i = level; i >= 0; i--) rbExtendBox(path[i], bbox);
  };

  proto._condense = function (path) {
    for (let i = path.length - 1; i >= 0; i--) {
      if (path[i].children.length === 0) {
        if (i > 0) {
          const siblings = path[i - 1].children;
          siblings.splice(siblings.indexOf(path[i]), 1);
        } else {
          this.clear();
        }
      } else {
        rbCalcBBox(path[i], this.toBBox, path[i]);
      }
    }
  };

  spatialIndexClass = SpatialIndex;
  canvas.SpatialIndex = SpatialIndex;
  return SpatialIndex;
}

// =====================================================================================================================
// Spatial-index variants used by the canvas link index (m5 / v5 / g5)
// =====================================================================================================================

/** Caches item.bbox on insert and drops it on remove; toBBox reads the cache. */
export function defineBboxCachedIndex(host) {
  bindCanvasHost(host);

  function BboxCachedIndex(maxEntries) {
    const self = spatialIndexClass.call(this, maxEntries) || this;
    return self;
  }
  inherit(BboxCachedIndex, spatialIndexClass);
  const proto = BboxCachedIndex.prototype;

  proto.insert = function (item) {
    item.bbox = item.getBBox();
    spatialIndexClass.prototype.insert.call(this, item);
    return this;
  };

  proto.remove = function (item) {
    if (item.bbox) {
      spatialIndexClass.prototype.remove.call(this, item);
      item.bbox = null;
      return this;
    }
    return this;
  };

  proto.toBBox = function (item) {
    return item.bbox;
  };

  canvas.BboxIndex = BboxCachedIndex;
  return BboxCachedIndex;
}

/** Orders nodes by their x / y position (edge endpoints). */
export function definePointIndex(host) {
  bindCanvasHost(host);

  function PointIndex(maxEntries) {
    const self = canvas.BboxIndex.call(this, maxEntries) || this;
    return self;
  }
  inherit(PointIndex, canvas.BboxIndex);
  const proto = PointIndex.prototype;

  proto.compareMinX = function (a, b) { return a.x - b.x; };
  proto.compareMinY = function (a, b) { return a.y - b.y; };

  canvas.PointIndex = PointIndex;
  return PointIndex;
}

/** Orders items by their getBBox() min corner. */
export function defineBBoxItemIndex(host) {
  bindCanvasHost(host);

  function BBoxItemIndex(maxEntries) {
    const self = canvas.BboxIndex.call(this, maxEntries) || this;
    return self;
  }
  inherit(BBoxItemIndex, canvas.BboxIndex);
  const proto = BBoxItemIndex.prototype;

  proto.compareMinX = function (a, b) {
    const boxA = a.getBBox();
    const boxB = b.getBBox();
    return boxA.minX - boxB.minX;
  };
  proto.compareMinY = function (a, b) {
    const boxA = a.getBBox();
    const boxB = b.getBBox();
    return boxA.minY - boxB.minY;
  };

  canvas.BBoxItemIndex = BBoxItemIndex;
  return BBoxItemIndex;
}

function rbEnlargement(bbox, node) {
  const minX = Math.min(node.minX, bbox.minX);
  const minY = Math.min(node.minY, bbox.minY);
  const maxX = Math.max(node.maxX, bbox.maxX);
  const maxY = Math.max(node.maxY, bbox.maxY);
  return (maxX - minX) * (maxY - minY) - rbBBoxArea(node);
}

function rbOverlapArea(a, b) {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return Math.max(0, w) * Math.max(0, h);
}

// =====================================================================================================================
// Per-file canvas data kept in localStorage (n8)
// =====================================================================================================================

export function defineCanvasDataCache(host) {
  bindCanvasHost(host);

  /** load/save/handleRename/handleDelete/remove of the "canvas-<path>" localStorage entries. */
  function CanvasDataCache(app) {
    this.app = app;
  }
  const proto = CanvasDataCache.prototype;

  proto.load = function (file) {
    return file ? this.app.loadLocalStorage("canvas-" + file.path) : null;
  };

  proto.save = function (file, data) {
    if (file) this.app.saveLocalStorage("canvas-" + file.path, data);
  };

  proto.handleRename = function (oldFile, newFile) {
    const data = this.app.loadLocalStorage("canvas-" + oldFile);
    if (data) {
      this.remove(oldFile);
      this.save(newFile, data);
    }
  };

  proto.handleDelete = function (file) {
    this.remove(file.path);
  };

  proto.remove = function (path) {
    this.app.saveLocalStorage("canvas-" + path, null);
  };

  canvas.DataCache = CanvasDataCache;
  return CanvasDataCache;
}

// =====================================================================================================================
// Canvas file metadata extraction (e8)
// =====================================================================================================================

export function defineCanvasMetadataExtractor(host) {
  bindCanvasHost(host);

  /**
   * Extractor for ".canvas" files (JSON): collects file/group-background embed references and parses
   * each text node's links so the metadata cache can resolve them. `refNodeIds` maps a resolved link
   * object back to the node id that produced it (WeakMap, for applyUpdates).
   */
  function CanvasMetadataExtractor(app) {
    const self = host.MetadataExtractorBase.call(this, app) || this;
    self.refNodeIds = new WeakMap();
    return self;
  }
  inherit(CanvasMetadataExtractor, host.MetadataExtractorBase);
  const proto = CanvasMetadataExtractor.prototype;

  proto.canProcess = function (file) {
    return file.extension === host.CANVAS_EXTENSION;
  };

  proto.process = async function (file) {
    const text = await this.app.vault.cachedRead(file);
    if (!text) return null;
    const data = JSON.parse(text);
    const nodes = data.nodes;
    if (!nodes || !Array.isArray(nodes)) return null;
    const embeds = [];
    const caches = {};
    const refNodeIds = this.refNodeIds;
    const self = this;

    const visitNode = async (node) => {
      if (node.type === "file") {
        embeds.push({ file: node.file, subpath: node.subpath });
      } else if (node.type === "group" && node.background) {
        embeds.push({ file: node.background, subpath: "" });
      } else if (node.type === "text") {
        const nodeText = node.text;
        try {
          const links = await self.parseText(nodeText);
          // WeakMap.set returns the map (truthy), so the scan stops after the first link — same as stock.
          host.indexCacheHasLink(links, (link) => refNodeIds.set(link, node.id));
          caches[node.id] = links;
        } catch (e) {
          console.error(e);
        }
      }
    };

    for (const node of nodes) await visitNode(node);
    this.app.metadataCache.queueFileForLinkResolution(file);
    return { embeds, caches };
  };

  proto.parseText = async function (text) {
    if (text.length < 5000) return host.parseSmallText(text);
    const proxy = host.fileProxy(text);
    return await this.app.metadataCache.computeMetadataAsync(proxy);
  };

  canvas.MetadataExtractor = CanvasMetadataExtractor;
  return CanvasMetadataExtractor;
}

// =====================================================================================================================
// Link maintenance across canvas files (t8)
// =====================================================================================================================

export function defineCanvasLinkUpdater(host) {
  bindCanvasHost(host);

  /**
   * Keeps "text" nodes and "file" embed subpaths inside .canvas JSON in sync when the files they
   * point at are renamed or their links change. `canvas.index` is the canvas's link index
   * ({getAll, getForPath, refNodeIds}); updates are {reference, change} pairs produced by the
   * metadata cache's link-resolution diff.
   */
  function CanvasLinkUpdater(app, canvas) {
    this.app = app;
    this.canvas = canvas;
  }
  const proto = CanvasLinkUpdater.prototype;

  /** Calls visit(path, link) for every cached reference of every indexed canvas file. */
  proto.iterateReferences = function (visit) {
    const all = this.canvas.index.getAll();
    const self = this;
    const walk = (path) => {
      if (!Object.hasOwn(all, path)) return;
      self.iterateReferencesForFile(path, (link) => visit(path, link));
    };
    for (const path in all) walk(path);
  };

  proto.iterateReferencesForFile = function (path, visit) {
    const entry = this.canvas.index.getForPath(path);
    if (!entry) return;
    for (const key of Object.keys(entry.caches)) {
      if (Object.hasOwn(entry.caches, key)) host.indexCacheHasLink(entry.caches[key], visit);
    }
    for (const embed of entry.embeds) {
      visit({ link: embed.file + (embed.subpath != null ? embed.subpath : ""), original: "" });
    }
  };

  /** Rewrites the text of "text" nodes whose stored link references changed (file renames, heading moves). */
  proto.applyUpdates = async function (file, updates) {
    const app = this.app;
    const refNodeIds = this.canvas.index.refNodeIds;
    try {
      await app.vault.process(file, (text) => {
        const data = JSON.parse(text);
        const byNode = new host.Multimap();
        for (const update of updates) {
          const nodeId = refNodeIds.get(update.reference);
          if (nodeId) byNode.add(nodeId, update);
        }
        for (const node of data.nodes) {
          if (node.type === "text") {
            const nodeUpdates = byNode.get(node.id);
            if (nodeUpdates) node.text = host.applyLinkChanges(node.text, nodeUpdates);
          }
        }
        return host.canvasSerialize(data);
      });
    } catch (e) {
      console.error(e);
    }
  };

  /**
   * Points every "file" embed whose subpath matched `oldSubpath` at `newSubpath` inside the canvas
   * files that reference `file`. `oldSubpath` starting with "^" demands an exact (case-insensitive)
   * match, otherwise it is compared whitespace/case-normalised.
   */
  proto.renameSubpath = async function (file, oldSubpath, newSubpath) {
    const app = this.app;
    const filePath = file.path;
    const affected = [];
    const all = this.canvas.index.getAll();
    for (const canvasPath of Object.keys(all)) {
      if (!Object.hasOwn(all, canvasPath)) continue;
      const entry = all[canvasPath];
      for (const embed of entry.embeds) {
        if (embed.file === filePath && embed.subpath) {
          const sub = embed.subpath.substring(1);
          if (oldSubpath.startsWith("^")) {
            if (sub.toLowerCase() === oldSubpath) {
              affected.push(canvasPath);
              break;
            }
          } else if (host.normalizeSubpath(sub).toLowerCase() === oldSubpath) {
            affected.push(canvasPath);
            break;
          }
        }
      }
    }
    if (affected.length === 0) return;
    new host.Notice("Canvas detected file renames affecting " + affected.length + " canvas files, updating...");
    let updated = 0;
    for (const canvasPath of affected) {
      const canvasFile = app.vault.getAbstractFileByPath(canvasPath);
      if (!(canvasFile instanceof MarkdownFile()) || canvasFile.extension !== host.CANVAS_EXTENSION) continue;
      await app.vault.process(canvasFile, (text) => {
        if (!text) return text;
        const data = JSON.parse(text);
        for (const node of data.nodes) {
          if (node.type === "file" && node.file === filePath && node.subpath) {
            const sub = node.subpath.substring(1);
            if (oldSubpath.startsWith("^")) {
              if (sub.toLowerCase() === oldSubpath) node.subpath = "#" + newSubpath;
            } else if (host.normalizeSubpath(sub).toLowerCase() === oldSubpath) {
              node.subpath = "#" + newSubpath;
            }
          }
        }
        return host.canvasSerialize(data);
      });
    }
    if (updated > 0) new host.Notice("Canvas updated " + updated + " embed cards.");
  };

  canvas.LinkUpdater = CanvasLinkUpdater;
  return CanvasLinkUpdater;
}

// =====================================================================================================================
// Resize-handle overlay for the selected node (M5)
// =====================================================================================================================

export function defineNodeInteractionLayer(host) {
  bindCanvasHost(host);

  /**
   * `target` is the canvas node currently selected (or null). The layer forwards pointerdown / click /
   * dblclick on each handle to the target's onResizePointerdown / onClick / onResizeDblclick and
   * pointerdown on the little connection dots to onConnectionPointerdown.
   */
  function NodeInteractionLayer(canvas) {
    this.canvas = canvas;
    const layer = (this.interactionEl = createDiv("canvas-node-interaction-layer"));

    const sides = ["top", "right", "bottom", "left"];
    for (const side of sides) {
      const handle = createDiv({ cls: "canvas-node-resizer", attr: { "data-resize": side } });
      handle.addEventListener("pointerdown", (event) => {
        const target = this.target;
        if (event.targetNode === handle && event.pointerType === "mouse") {
          target && target.onResizePointerdown(event, side);
        }
      });
      handle.addEventListener("click", (event) => {
        const target = this.target;
        target && target.onClick(event);
      });
      if (side !== "bottom" && side !== "right") {
        handle.addEventListener("dblclick", (event) => {
          const target = this.target;
          target && target.onResizeDblclick(event, side);
        });
      }
      handle.createDiv({ cls: "canvas-node-connection-point", attr: { "data-side": side } })
        .addEventListener("pointerdown", (event) => {
          const target = this.target;
          target && target.onConnectionPointerdown(event, side);
        });
      layer.append(handle);
    }

    const corners = ["topright", "bottomright", "bottomleft", "topleft"];
    for (const corner of corners) {
      const handle = createDiv({ cls: "canvas-node-resizer", attr: { "data-resize": corner } });
      handle.addEventListener("pointerdown", (event) => {
        const target = this.target;
        target && target.onResizePointerdown(event, corner);
      });
      handle.addEventListener("click", (event) => {
        const target = this.target;
        target && target.onClick(event);
      });
      layer.append(handle);
    }
  }
  const proto = NodeInteractionLayer.prototype;

  proto.setTarget = function (target) {
    if (this.target !== target) {
      this.target = target;
      this.render();
    }
  };

  proto.render = function () {
    const canvas = this.canvas;
    const target = this.target;
    const layer = this.interactionEl;
    if (!target) {
      if (layer.parentNode) layer.detach();
      return;
    }
    if (!layer.parentNode) canvas.canvasEl.appendChild(layer);
    layer.setCssStyles({
      transform: "translate(" + target.x + "px, " + target.y + "px)",
      width: target.width + "px",
      height: target.height + "px",
      zIndex: String(canvas.zIndexCounter + 1),
    });
  };

  canvas.InteractionLayer = NodeInteractionLayer;
  return NodeInteractionLayer;
}
