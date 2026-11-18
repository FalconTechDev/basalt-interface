// MetadataCache support classes and functions: task queues, the link-resolution queue, IndexedDB helpers,
// content hashing, tag/reference extraction and metadata (de)serialization. Everything here is internal to the
// metadata index; plugin-facing behaviour is unchanged.
//
// Names that live in the application scope (markdown parser, yaml helpers, frontmatter link extractor, the
// `activeWindow` handle, ...) arrive through `env()`; own helpers are imported directly.
import { env } from "./env.js";
import { bufferToHex } from "./misc.js";
import { lastSegment, tidyLinkTarget, dropMdSuffix } from "./path.js";
import { frontmatterTags } from "./frontmatter.js";

/* ------------------------------------------------------------------ */
/* Queues                                                              */
/* ------------------------------------------------------------------ */

/** Serial promise queue: each task starts only after the previous one settled (success or failure). */
function SerialTaskQueue() {
  this.promise = Promise.resolve();
}
SerialTaskQueue.prototype.queue = function (task) {
  const result = this.promise.then(task, task);
  this.promise = result;
  return result;
};
export { SerialTaskQueue };
export const defineSerialTaskQueue = () => SerialTaskQueue;

/** Map of key -> list of values; adding an existing value is a no-op. */
function RefMultimap() {
  this.data = new Map();
}
RefMultimap.prototype.add = function (key, value) {
  const data = this.data;
  let list = data.get(key);
  if (!list) {
    list = [];
    data.set(key, list);
  }
  if (!list.includes(value)) list.push(value);
};
RefMultimap.prototype.remove = function (key, value) {
  const data = this.data;
  if (!data.has(key)) return;
  const list = data.get(key);
  // Array.prototype.remove of the app drops every occurrence.
  for (let i = list.length - 1; i >= 0; i--) if (list[i] === value) list.splice(i, 1);
  if (list.length === 0) data.delete(key);
};
RefMultimap.prototype.get = function (key) {
  return this.data.get(key) || null;
};
RefMultimap.prototype.keys = function () {
  return Array.from(this.data.keys());
};
RefMultimap.prototype.clear = function (key) {
  this.data.delete(key);
};
RefMultimap.prototype.clearAll = function () {
  this.data.clear();
};
RefMultimap.prototype.contains = function (key, value) {
  const list = this.data.get(key);
  return !!list && list.includes(value);
};
RefMultimap.prototype.count = function () {
  const data = this.data;
  let total = 0;
  for (const key of this.keys()) {
    const list = data.get(key);
    if (list) total += list.length;
  }
  return total;
};
export { RefMultimap };
export const defineRefMultimap = () => RefMultimap;

/**
 * Chunked FIFO. `length` reports live items only; the backing array keeps a read offset and is compacted
 * once half of it has been consumed. `isEmpty`/`peek` look at the raw array like the original.
 */
function Deque() {
  this.queue = [];
  this.offset = 0;
}
Object.defineProperty(Deque.prototype, "length", {
  get: function () { return this.queue.length - this.offset; },
  enumerable: false,
  configurable: true,
});
Deque.prototype.get = function () { return this.queue; };
Deque.prototype.isEmpty = function () { return this.queue.length === 0; };
Deque.prototype.enqueue = function (item) { this.queue.push(item); };
Deque.prototype.enqueueArray = function (items) {
  const queue = this.queue;
  for (let i = 0; i < items.length; i++) queue.push(items[i]);
};
Deque.prototype.remove = function (item) {
  const queue = this.queue;
  for (let i = queue.length - 1; i >= this.offset; i--) {
    if (queue[i] === item) queue.splice(i, 1);
  }
};
Deque.prototype.clear = function () {
  this.queue = [];
  this.offset = 0;
};
Deque.prototype.dequeue = function () {
  const queue = this.queue;
  const offset = this.offset;
  if (queue.length === 0) return undefined;
  const item = queue[offset];
  queue[offset] = undefined;
  let next = offset + 1;
  if (2 * next >= queue.length) {
    this.queue = queue.slice(next);
    next = 0;
  }
  this.offset = next;
  return item;
};
Deque.prototype.peek = function () {
  return this.queue.length > 0 ? this.queue[this.offset] : undefined;
};
export { Deque };
export const defineDeque = () => Deque;

/** Lifecycle flags around a unit of work (onStart/onStop/onCancel callbacks). */
function Runnable(options) {
  this.running = false;
  this.cancelled = false;
  const opts = options || {};
  this.onStart = opts.onStart || null;
  this.onStop = opts.onStop || null;
  this.onCancel = opts.onCancel || null;
}
Runnable.prototype.start = function () {
  if (!this.running) {
    this.running = true;
    if (this.onStart) this.onStart();
  }
};
Runnable.prototype.stop = function () {
  if (this.running) {
    this.running = false;
    if (this.onStop) this.onStop();
  }
};
Runnable.prototype.cancel = function () {
  this.stop();
  if (!this.cancelled) {
    this.cancelled = true;
    if (this.onCancel) this.onCancel();
  }
};
Runnable.prototype.isRunning = function () { return this.running; };
Runnable.prototype.isCancelled = function () { return this.cancelled; };
export { Runnable };
export const defineRunnable = () => Runnable;

function deferred() {
  const d = { promise: null, resolve: null, reject: null };
  d.promise = new Promise((resolve, reject) => {
    d.resolve = resolve;
    d.reject = reject;
  });
  return d;
}

/**
 * Queue of pending link-resolution items. `generator()` is an async iterable that yields items as they are
 * enqueued; while the queue is empty it parks until `notify()` resolves the wait (add/clear call it).
 */
function LinkQueue(options) {
  this.items = new Deque();
  this.promise = null;
  this.runnable = new Runnable(options);
}
LinkQueue.prototype.addList = function (list) {
  this.items.enqueueArray(list);
  this.notify();
};
LinkQueue.prototype.add = function (item) {
  this.items.enqueue(item);
  this.notify();
};
LinkQueue.prototype.remove = function (item) {
  this.items.remove(item);
};
LinkQueue.prototype.clear = function () {
  this.items.clear();
};
LinkQueue.prototype.notify = function () {
  const pending = this.promise;
  if (pending) {
    this.promise = null;
    setTimeout(() => pending.resolve(), 0);
  }
};
LinkQueue.prototype.cancel = function () {
  this.runnable.cancel();
};
LinkQueue.prototype.generator = function () {
  const self = this;
  return (async function* () {
    const runnable = self.runnable;
    for (;;) {
      if (runnable.isCancelled()) return;
      if (self.items.length !== 0) {
        runnable.start();
        yield self.items.dequeue();
      } else {
        runnable.stop();
        self.promise = deferred();
        await self.promise.promise;
      }
    }
  })();
};
export { LinkQueue };
export const defineLinkQueue = () => LinkQueue;

/* ------------------------------------------------------------------ */
/* Async helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Runs `callback` on the next idle slot: requestIdleCallback with a timeout when available, otherwise
 * requestAnimationFrame. Returns { high, cancel }.
 */
export function idleOrTimeout(callback, ms) {
  const win = env().activeWindow;
  if (ms > 0 && win.requestIdleCallback) {
    let done = false;
    const idleId = win.requestIdleCallback(() => {
      done = true;
      win.clearTimeout(timer);
      callback();
    }, { timeout: ms });
    const timer = win.setTimeout(() => {
      done = true;
      win.cancelIdleCallback(idleId);
      callback();
    }, ms);
    return {
      high: false,
      cancel() {
        if (!done) {
          done = true;
          win.cancelIdleCallback(idleId);
          win.clearTimeout(timer);
        }
      },
    };
  }
  const frame = win.requestAnimationFrame(callback);
  return {
    high: true,
    cancel() { return win.cancelAnimationFrame(frame); },
  };
}

/**
 * Async generator that yields every item of `iterable`, pausing for `duration`-exceeded batches so the UI
 * stays responsive. Options: batchSize (10), duration ms (5), maxDelay ms (100), beforePause(timestamp).
 */
export async function* batchedAsync(iterable, options) {
  const opts = options || {};
  const batchSize = opts.batchSize === undefined ? 10 : opts.batchSize;
  const duration = opts.duration === undefined ? 5 : opts.duration;
  const maxDelay = opts.maxDelay === undefined ? 100 : opts.maxDelay;
  const beforePause = opts.beforePause;
  let count = 0;
  let last = performance.now();
  for await (const item of iterable) {
    yield item;
    if (++count % batchSize === 0) {
      const now = performance.now();
      if (now - last > duration) {
        if (beforePause) beforePause(now);
        await new Promise((resolve) => idleOrTimeout(resolve, maxDelay));
        last = performance.now();
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* IndexedDB                                                           */
/* ------------------------------------------------------------------ */

/**
 * Iterates an object store in batches: for each batch of up to `batchSize` values starting at successive
 * keys, calls `emit(keySlice, valueBatch)`. Stops when a batch comes back empty.
 */
export async function iterateIdbBatches(store, batchSize, emit) {
  const keys = await store.getAllKeys();
  for (let offset = 0; offset < keys.length;) {
    const values = await store.getAll(IDBKeyRange.lowerBound(keys[offset]), batchSize);
    if (values.length === 0) break;
    emit(keys.slice(offset, offset + values.length), values);
    offset += values.length;
  }
}

/* ------------------------------------------------------------------ */
/* Content / tags / references                                         */
/* ------------------------------------------------------------------ */

/** SHA-256 of a buffer, lowercase hex. */
export async function contentHash(buffer) {
  const digest = await window.crypto.subtle.digest("SHA-256", new Uint8Array(buffer));
  return bufferToHex(digest);
}

/** All tags of a metadata object: frontmatter tags plus inline tags. */
export function collectTags(meta) {
  if (!meta) return null;
  const tags = [];
  const frontmatter = frontmatterTags(meta.frontmatter);
  if (frontmatter) {
    for (let i = 0; i < frontmatter.length; i++) tags.push(frontmatter[i]);
  }
  const inline = meta.tags;
  if (inline) {
    for (let i = 0; i < inline.length; i++) tags.push(inline[i].tag);
  }
  return tags;
}

/** Cache key for a link target: notes are keyed without their ".md". */
export function linkCacheKey(path) {
  return dropMdSuffix(path);
}

/** Whether any key of `targets` shares a last path segment (case-insensitive) with `list`. */
export function sharesLinkTarget(list, targets) {
  if (!targets) return false;
  for (const key of Object.keys(targets)) {
    if (list.includes(lastSegment(key).toLowerCase())) return true;
  }
  return false;
}

/** Strict-true early-exit test over a list. */
export function anyRefMatch(list, predicate) {
  if (!list) return false;
  for (let i = 0; i < list.length; i++) {
    if (predicate(list[i]) === true) return true;
  }
  return false;
}

/** Whether a predicate matches any frontmatter link, link or embed of a metadata object. */
export function anyMetadataRef(meta, predicate) {
  return !!meta && (
    anyRefMatch(meta.frontmatterLinks, predicate) ||
    (anyRefMatch(meta.links, predicate) || anyRefMatch(meta.embeds, predicate))
  );
}

/** Calls `visit` on every link-like field of a metadata object (links, embeds, tags, headings, sections,
 *  listItems and every block). */
export function forEachLinkField(meta, visit) {
  if (!meta) return meta;
  if (meta.links) for (let i = 0; i < meta.links.length; i++) visit(meta.links[i]);
  if (meta.embeds) for (let i = 0; i < meta.embeds.length; i++) visit(meta.embeds[i]);
  if (meta.tags) for (let i = 0; i < meta.tags.length; i++) visit(meta.tags[i]);
  if (meta.headings) for (let i = 0; i < meta.headings.length; i++) visit(meta.headings[i]);
  if (meta.sections) for (let i = 0; i < meta.sections.length; i++) visit(meta.sections[i]);
  if (meta.listItems) for (let i = 0; i < meta.listItems.length; i++) visit(meta.listItems[i]);
  if (meta.blocks) {
    for (const key in meta.blocks) {
      if (Object.prototype.hasOwnProperty.call(meta.blocks, key)) visit(meta.blocks[key]);
    }
  }
  return meta;
}

/* ------------------------------------------------------------------ */
/* Position (de)serialization                                          */
/* ------------------------------------------------------------------ */

/** Position {start,end} -> flat [sl,sc,so,el,ec,eo] array. */
export function positionToArray(position) {
  const start = position.start;
  const end = position.end;
  return [start.line, start.col, start.offset, end.line, end.col, end.offset];
}

/** Flat 6-element array -> position {start:{line,col,offset},end:{...}}. */
export function positionFromArray(array) {
  return {
    start: { line: array[0], col: array[1], offset: array[2] },
    end: { line: array[3], col: array[4], offset: array[5] },
  };
}

/** Link field with `pos` array -> `position` object (used while deserializing cached metadata). */
export function linkPosFromArray(link) {
  const pos = link.pos;
  if (pos && Array.isArray(pos) && pos.length === 6) {
    delete link.pos;
    link.position = positionFromArray(pos);
  }
}

/** Link field with `position` object -> `pos` array (used while serializing cached metadata). */
export function linkPosToPos(link) {
  const position = link.position;
  if (position) {
    delete link.position;
    link.pos = positionToArray(position);
  }
}

/** Cached metadata -> live metadata: frontmatter position/links restored, every link `pos` -> `position`. */
export function deserializeMetadata(meta) {
  if (meta.frontmatterPos) {
    meta.frontmatterPosition = positionFromArray(meta.frontmatterPos);
    delete meta.frontmatterPos;
  }
  return forEachLinkField(meta, linkPosFromArray);
}

/* ------------------------------------------------------------------ */
/* Small predicates / strings                                          */
/* ------------------------------------------------------------------ */

/** Escapes a string for literal use inside a RegExp. */
export function escapeRegExp(text) {
  return text.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");
}

// A hashtag that is not a pure number ("#123" is a line anchor, not a tag).
const TAG_PATTERN = /^#[^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]+$/;
const NUMERIC_TAG = /^#\d+$/;

/** Whether a string is a usable tag (starts with #, has tag characters, is not "#<digits>"). */
export function tagValid(tag) {
  return !!tag && TAG_PATTERN.test(tag) && !NUMERIC_TAG.test(tag);
}

/** Block cache for a file: headings and list items with their AST nodes, cached per path+mtime. */
function BlockCache(app) {
  this.cache = {};
  this.app = app;
}
BlockCache.prototype.clear = function () {
  this.cache = {};
};
BlockCache.prototype.getForFile = async function (cancellation, file) {
  if (file.extension !== "md") return null;
  const mtime = file.stat.mtime;
  if (this.cache.hasOwnProperty(file.path)) {
    const cached = this.cache[file.path];
    if (cached.file === file && cached.mtime === mtime) return cached;
  }
  const content = await this.app.vault.cachedRead(file);
  if (cancellation.isCancelled()) return null;
  const ast = env().Kx(content);
  const blocks = [];
  for await (const node of batchedAsync(env().kb(ast.children), { maxDelay: 0 })) {
    if (cancellation.isCancelled()) break;
    if (node.type === "yaml") continue;
    if (node.type === "list") {
      env().jC(node, "listItem", (item) => {
        const text = env().sT(item).trim();
        if (text) blocks.push({ display: text, node: item });
      });
      continue;
    }
    const text = env().sT(node).trim();
    if (text === "") continue;
    let display = text;
    if (node.type === "heading") display = "#".repeat(node.depth || 1) + " " + display;
    blocks.push({ display, node });
  }
  const result = { file, content, mtime, blocks };
  this.cache[file.path] = result;
  return result;
};
BlockCache.prototype.getAll = async function (cancellation) {
  const files = this.app.vault.getMarkdownFiles();
  for (let i = 0; i < files.length; i++) {
    await this.getForFile(cancellation, files[i]);
  }
};
export { BlockCache };
export const defineBlockCache = () => BlockCache;

/* ------------------------------------------------------------------ */
/* Metadata upgrade + link updates                                     */
/* ------------------------------------------------------------------ */

/**
 * Brings cached metadata up to date: frontmatter links are (re)extracted, link targets normalized.
 * Returns true when the object was modified.
 */
export function isOutdatedMetadata(meta) {
  const version = meta.v || 0;
  if (version < 1) {
    if (meta.frontmatter && Array.isArray(meta.frontmatter)) {
      meta.frontmatter = null;
      delete meta.frontmatterPos;
      delete meta.frontmatterLinks;
    }
    if (meta.frontmatter) {
      if (!meta.frontmatterPos && meta.frontmatter.pos) {
        meta.frontmatterPos = meta.frontmatter.pos;
        delete meta.frontmatter.pos;
      }
      if (!meta.frontmatterLinks) meta.frontmatterLinks = env().dT(meta.frontmatter);
    }
    anyMetadataRef(meta, (ref) => {
      ref.link = tidyLinkTarget(ref.link);
    });
    meta.v = 1;
  }
  return meta.v !== version;
}

/**
 * Applies worker-computed link updates to file content: position references splice text right-to-left,
 * property references rewrite the matching frontmatter keys.
 */
export function applyLinkUpdates(text, updates) {
  const textEdits = [];
  const propertyEdits = [];
  for (let i = 0; i < updates.length; i++) {
    const update = updates[i];
    if (env().lT(update.reference)) {
      const position = update.reference.position;
      textEdits.push({ start: position.start.offset, end: position.end.offset, text: update.change });
    } else if (env().cT(update.reference)) {
      propertyEdits.push({ key: update.reference.key, value: update.change });
    }
  }
  textEdits.sort((a, b) => b.start - a.start);
  for (let i = 0; i < textEdits.length; i++) {
    const edit = textEdits[i];
    text = text.substring(0, edit.start) + edit.text + text.substring(edit.end);
  }
  if (propertyEdits.length === 0) return text;
  const frontmatter = env().Xx(text);
  if (!frontmatter.exists) return text;
  let data;
  try {
    data = env().mA(frontmatter.frontmatter);
  } catch (error) {
    return text;
  }
  for (let i = 0; i < propertyEdits.length; i++) {
    const edit = propertyEdits[i];
    env().jL(data, edit.key.split("."), edit.value);
  }
  const yaml = env().vA(data);
  return text.slice(0, frontmatter.from) + yaml + text.slice(frontmatter.to);
}
