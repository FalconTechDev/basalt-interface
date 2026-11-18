// g15 clean-room tree engine: traversal helpers, DOM/measurement/animation helpers, the
// item/root/child-list classes, the virtualised scroller, the tree controller and the shared
// drag/drop indicator. Replaces the inherited tree module; every name is ng15-prefixed.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";

const NG15_INFO = () => ({ height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false });

// =====================================================================================================================
// Traversal helpers (pure model walks; `el`/`childrenEl` presence decides what is mounted)
// =====================================================================================================================

/** Visits descendants of `item` (not `item`) in child order. Truthy return prunes the subtree. Always returns false. */
export function ng15WalkTree(item, visit, skipCollapsed = false) {
  const walk = (parent) => {
    const children = parent && parent.vChildren ? parent.vChildren.children : null;
    if (!children) return;
    for (const child of children) {
      if (visit(child)) continue;
      if (skipCollapsed && child.collapsed) continue;
      walk(child);
    }
  };
  walk(item);
  return false;
}

/** True when `item` owns both a child list and the element that hosts it. */
export function ng15HasChildList(item) {
  return !!(item && item.vChildren && item.childrenEl);
}

/** Visits `item` then mounted descendants pre-order (a child list counts only while its element is in the DOM). */
export function ng15WalkTreeAll(item, visit) {
  if (visit(item) === true) return;
  if (!ng15HasChildList(item) || !item.childrenEl.parentNode) return;
  for (const child of item.vChildren.children) ng15WalkTreeAll(child, visit);
}

/** Child-index path from the tree root to `item` (empty for the root or a parentless item). */
export function ng15TreeAncestorPath(item) {
  const path = [];
  let node = item;
  while (node && node.parent && node.parent.vChildren) {
    const siblings = node.parent.vChildren.children;
    const idx = siblings.indexOf(node);
    if (idx < 0) break;
    path.unshift(idx);
    node = node.parent;
  }
  return path;
}

export function ng15PrevTreeSibling(item) {
  const parent = item && item.parent;
  if (!parent || !parent.vChildren) return null;
  const siblings = parent.vChildren.children;
  const idx = siblings.indexOf(item);
  return idx > 0 ? siblings[idx - 1] : null;
}

export function ng15NextTreeSibling(item) {
  const parent = item && item.parent;
  if (!parent || !parent.vChildren) return null;
  const siblings = parent.vChildren.children;
  const idx = siblings.indexOf(item);
  return idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
}

function ng15ComparePaths(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** All visible items between `a` and `b` inclusive (order of the arguments does not matter). */
export function ng15TreeRange(a, b) {
  if (!a || !b) return [];
  const pa = ng15TreeAncestorPath(a);
  const pb = ng15TreeAncestorPath(b);
  const cmp = ng15ComparePaths(pa, pb);
  const [from, to] = cmp <= 0 ? [a, b] : [b, a];
  const pfrom = cmp <= 0 ? pa : pb;
  const items = [];
  let collecting = false;
  const root = ng15FindRoot(from);
  if (!root) return items;
  ng15WalkTreeVisible(root, (item) => {
    if (item === from) collecting = true;
    if (collecting) items.push(item);
    if (item === to) { collecting = false; return true; }
  });
  void pfrom;
  return items;
}

function ng15FindRoot(item) {
  let node = item;
  while (node && node.parent) node = node.parent;
  return node;
}

/** Depth-first walk over visible rows only (skips hidden rows and, when asked, collapsed subtrees). */
function ng15WalkTreeVisible(root, visit) {
  const descend = (parent) => {
    if (!ng15HasChildList(parent)) return;
    for (const child of parent.vChildren.children) {
      if (child.info && child.info.hidden) continue;
      const stop = visit(child);
      if (stop) return true;
      if (child.collapsed) continue;
      if (descend(child)) return true;
    }
    return false;
  };
  return descend(root);
}

function ng15VisibleNext(item, skipCollapsed) {
  // into expanded children first
  if (ng15HasChildList(item) && !item.collapsed) {
    const first = item.vChildren.first();
    if (first && !(first.info && first.info.hidden)) return first;
  }
  // then next visible sibling, climbing ancestors as needed
  let node = item;
  while (node) {
    const next = ng15NextTreeSibling(node);
    if (next) {
      if (next.info && next.info.hidden) { node = next; continue; }
      return next;
    }
    node = node.parent;
    if (!node || !node.parent) return null; // climbed past the root's children
    if (node.parent && !node.parent.vChildren) return null;
  }
  return null;
}

function ng15VisiblePrev(item) {
  const prev = ng15PrevTreeSibling(item);
  if (prev) {
    // deepest last visible descendant of prev
    let node = prev;
    while (ng15HasChildList(node) && !node.collapsed) {
      const last = node.vChildren.last();
      if (!last || (last.info && last.info.hidden)) break;
      node = last;
    }
    return node.info && node.info.hidden ? ng15VisiblePrev(node) : node;
  }
  const parent = item.parent;
  if (parent && parent.parent) return parent; // a real item, not the sentinel root
  return null;
}

/** Next row a keyboard user would land on moving down (never the sentinel root, hidden rows skipped). */
export function ng15NextVisibleTreeItem(item, skipCollapsed = false) {
  if (!item) return null;
  let node = item;
  for (let guard = 0; guard < 100000; guard++) {
    const next = ng15VisibleNext(node, skipCollapsed);
    if (!next) return null;
    if (!(next.info && next.info.hidden)) return next;
    node = next;
  }
  return null;
}

export function ng15PrevVisibleTreeItem(item, skipCollapsed = false) {
  if (!item) return null;
  void skipCollapsed;
  let node = item;
  for (let guard = 0; guard < 100000; guard++) {
    const prev = ng15VisiblePrev(node);
    if (!prev) return null;
    if (!(prev.info && prev.info.hidden)) return prev;
    node = prev;
  }
  return null;
}

/** Deepest last visible row at or below `item`; climbs out of collapsed ancestors. */
export function ng15LastVisibleTreeItem(item, skipCollapsed = false) {
  if (!item) return null;
  let node = item;
  // descend to the deepest last child while allowed
  for (let guard = 0; guard < 100000; guard++) {
    if (ng15HasChildList(node) && !(skipCollapsed && node.collapsed)) {
      const last = node.vChildren.last();
      if (last && !(last.info && last.info.hidden)) { node = last; continue; }
    }
    break;
  }
  // climb out while the result sits inside a collapsed subtree or is hidden
  for (let guard = 0; guard < 100000; guard++) {
    if (!(node.info && node.info.hidden)) {
      let p = node.parent;
      let insideCollapsed = false;
      while (p && p.parent) { if (p.collapsed) { insideCollapsed = true; break; } p = p.parent; }
      if (!insideCollapsed) return node;
    }
    const parent = node.parent;
    if (!parent || !parent.parent) return node.info && node.info.hidden ? null : node;
    node = parent;
  }
  return node;
}

// =====================================================================================================================
// DOM / measurement / animation helpers
// =====================================================================================================================

/** Spacer div reserving space for virtualised rows. */
export function ng15MakeTreePusher() {
  const el = document.createElement("div");
  el.style.width = "1px";
  el.style.height = "0.1px";
  el.style.marginBottom = "0";
  return el;
}

/**
 * Runs `fn` on an idle callback with `timeout` as the cap; falls back to the next animation frame when idle
 * callbacks are missing or `timeout <= 0`. Returns { high, cancel } — `high()` runs the callback immediately.
 */
export function ng15ScheduleIdle(fn, timeout = 0) {
  let done = false;
  let handle = null;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  const cancel = () => {
    if (done) return;
    done = true;
    if (handle !== null) {
      if (timeout > 0 && window.requestIdleCallback) window.cancelIdleCallback(handle);
      else window.cancelAnimationFrame(handle);
    }
  };
  if (timeout > 0 && window.requestIdleCallback) {
    handle = window.requestIdleCallback(run, { timeout });
  } else {
    handle = window.requestAnimationFrame(run);
  }
  return { high: run, cancel };
}

/**
 * Measures `el` relative to `until` (or the offset-parent boundary): { top, left, right } in px.
 * `top`/`left` accumulate offsets while subtracting intermediate scroll positions; `right` is the
 * remaining width to the right edge of the boundary.
 */
export function ng15OffsetBox(el, until) {
  let top = 0;
  let left = 0;
  let node = el;
  let boundary = null;
  while (node && node !== until) {
    top += node.offsetTop || 0;
    left += node.offsetLeft || 0;
    const parent = node.offsetParent;
    if (parent && parent !== until) {
      top -= parent.scrollTop || 0;
      left -= parent.scrollLeft || 0;
    }
    node = parent;
    if (!node) boundary = el.offsetParent;
  }
  const boxParent = until || boundary || el.parentElement;
  const width = el.offsetWidth || 0;
  const parentWidth = boxParent ? boxParent.clientWidth : 0;
  return { top, left, right: Math.max(0, parentWidth - left - width) };
}

/** Non-zero pixel box metrics of `el` used by the collapse/expand animations. */
export function ng15BoxMetrics(el) {
  const style = getComputedStyle(el);
  const px = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const out = {};
  const height = px(style.height);
  const paddingTop = px(style.paddingTop);
  const paddingBottom = px(style.paddingBottom);
  const marginTop = px(style.marginTop);
  const marginBottom = px(style.marginBottom);
  if (height) out.height = height;
  if (paddingTop) out.paddingTop = paddingTop;
  if (paddingBottom) out.paddingBottom = paddingBottom;
  if (marginTop) out.marginTop = marginTop;
  if (marginBottom) out.marginBottom = marginBottom;
  return out;
}

const NG15_COLLAPSE_EASING = "cubic-bezier(.02,.01,.47,1)";
const NG15_ANIM_MS = 100;

function ng15CancelAnim(el) {
  if (el.getAnimations) for (const a of el.getAnimations()) a.cancel();
}

/** Animates the non-zero box metrics of `el` to zero; resolves when finished. */
export function ng15AnimateCollapse(el) {
  ng15CancelAnim(el);
  const metrics = ng15BoxMetrics(el);
  const keys = [];
  const to = { overflow: "hidden" };
  for (const key of Object.keys(metrics)) {
    keys.push({ [key]: metrics[key] + "px", overflow: "hidden" });
    to[key] = "0px";
  }
  if (keys.length === 0) return Promise.resolve();
  keys.push(to);
  const anim = el.animate(keys, { duration: NG15_ANIM_MS, easing: NG15_COLLAPSE_EASING, fill: "forwards" });
  return anim.finished.then(() => undefined, () => undefined);
}

/** Animates the box metrics of `el` back to their natural size; resolves when finished. */
export function ng15ExpandFromZero(el) {
  ng15CancelAnim(el);
  const metrics = ng15BoxMetrics(el);
  const names = Object.keys(metrics);
  if (names.length === 0) return Promise.resolve();
  const zero = { overflow: "hidden" };
  const natural = { overflow: "" };
  for (const key of names) {
    zero[key] = "0px";
    natural[key] = metrics[key] + "px";
  }
  // park at zero first so the transition has a start point
  const style = el.style;
  for (const key of names) style[key] = "0px";
  style.overflow = "hidden";
  void el.offsetHeight;
  const anim = el.animate([zero, natural], { duration: NG15_ANIM_MS, easing: NG15_COLLAPSE_EASING });
  return anim.finished.then(() => {
    for (const key of names) style[key] = "";
    style.overflow = "";
  }, () => {
    for (const key of names) style[key] = "";
    style.overflow = "";
  });
}

/**
 * Shows/appends or hides/detaches a children container. Collapsed: optionally animate closed, then detach.
 * Expanded: show, append to `itemEl`, optionally animate open.
 */
export async function ng15MountChildren(childrenEl, itemEl, collapsed, animate) {
  if (collapsed) {
    if (!childrenEl.parentNode) return;
    if (animate) await ng15AnimateCollapse(childrenEl);
    childrenEl.detach();
    return;
  }
  if (!childrenEl.parentNode) itemEl.appendChild(childrenEl);
  childrenEl.show();
  if (animate) await ng15ExpandFromZero(childrenEl);
}

/** Toggles `is-collapsed` on the row element and on its `.collapse-icon` (and `.tree-item-self`) descendants. */
export function ng15MarkItemCollapsed(itemEl, collapsed) {
  if (!itemEl) return;
  itemEl.classList.toggle("is-collapsed", collapsed);
  const icon = itemEl.querySelector(".collapse-icon");
  if (icon) icon.classList.toggle("is-collapsed", collapsed);
  const self = itemEl.querySelector(".tree-item-self");
  if (self) self.classList.toggle("is-collapsed", collapsed);
}

/** True for INPUT elements or HTMLElements with contentEditable="true". */
export function ng15IsEditableNode(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.nodeName === "INPUT" || node.nodeName === "TEXTAREA" || node.nodeName === "SELECT") return true;
  return node instanceof HTMLElement && node.contentEditable === "true";
}

/** Replays a key event with copied modifiers plus overrides. */
export function ng15SyntheticKeyEvent(event, overrides = {}) {
  const init = {
    key: event.key,
    code: event.code,
    location: event.location,
    repeat: event.repeat,
    isComposing: event.isComposing,
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    composed: event.composed,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    ...overrides,
  };
  return new KeyboardEvent(event.type, init);
}

// =====================================================================================================================
// TreeChildren — the ordered live child list owned by a tree item/root
// =====================================================================================================================

export function ng15DefineTreeChildren() {
  function TreeChildren(owner) {
    this.owner = owner;
    this.children = [];
  }
  const proto = TreeChildren.prototype;

  proto.addChild = function (item) {
    if (this.children.indexOf(item) >= 0) return;
    this.children.push(item);
    item.parent = this.owner;
  };

  proto.setChildren = function (items) {
    for (const child of this.children) child.parent = null;
    this.children = items.slice();
    for (const child of this.children) child.parent = this.owner;
  };

  proto.removeChild = function (item) {
    const idx = this.children.indexOf(item);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      item.parent = null;
    }
  };

  proto.hasChildren = function () { return this.children.length > 0; };
  proto.first = function () { return this.children[0] || null; };
  proto.last = function () { return this.children[this.children.length - 1] || null; };
  proto.size = function () { return this.children.length; };
  proto.clear = function () {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
  };
  proto.sort = function (compare) { this.children.sort(compare); };

  ng15TreeChildrenClass = TreeChildren;
  return TreeChildren;
}

// =====================================================================================================================
// TreeItem — one row: .tree-item > .tree-item-self > .tree-item-inner
// =====================================================================================================================

export function ng15DefineTreeItem() {
  function TreeItem(el) {
    if (el) {
      this.el = el;
      this.selfEl = el.firstChild;
      this.innerEl = this.selfEl ? this.selfEl.firstChild : null;
      this.coverEl = this.selfEl;
    } else {
      this.el = document.createElement("div");
      this.el.className = "tree-item";
      this.selfEl = document.createElement("div");
      this.selfEl.className = "tree-item-self";
      this.innerEl = document.createElement("div");
      this.innerEl.className = "tree-item-inner";
      this.selfEl.appendChild(this.innerEl);
      this.el.appendChild(this.selfEl);
      this.coverEl = this.selfEl;
    }
    this.parent = null;
    this.info = NG15_INFO();
    this.pusherEl = null;
    this._ng15Top = undefined;
    this._ng15Total = undefined;
    this._ng15Rendered = false;
    const self = this;
    const onClick = (event) => {
      if (!event.defaultPrevented) self.onSelfClick(event);
    };
    this.selfEl.addEventListener("click", onClick);
    this.selfEl.addEventListener("auxclick", onClick);
  }
  const proto = TreeItem.prototype;

  proto.onSelfClick = function () {};

  proto.setClickable = function (clickable) {
    this.selfEl.classList.toggle("is-clickable", !!clickable);
  };

  ng15TreeItemClass = TreeItem;
  return TreeItem;
}

// =====================================================================================================================
// TreeRoot — sentinel root of a tree
// =====================================================================================================================

// The manifest factories run in bundle order; TreeRoot and Tree resolve their class dependencies
// through these slots, which the bound factories fill as they are created.
let ng15TreeChildrenClass = null;
let ng15TreeItemClass = null;
let ng15TreeRootClass = null;
let ng15InfinityScrollClass = null;

export function ng15DefineTreeRoot(host) {
  void host;
  function TreeRoot(el) {
    this.el = el;
    this.childrenEl = el.createDiv();
    this.vChildren = new ng15TreeChildrenClass(this);
    this.info = NG15_INFO();
    this.pusherEl = ng15MakeTreePusher();
  }
  ng15TreeRootClass = TreeRoot;
  return TreeRoot;
}

// =====================================================================================================================
// collapsibleTreeItem — mixin/factory adding collapse behaviour to a TreeItem subclass
// =====================================================================================================================

export function ng15CollapsibleTreeItem(Base) {
  function CollapsibleItem() {
    const self = Base.apply(this, arguments) || this;
    self.collapsible = false;
    self.collapsed = false;
    self.collapseEl = null;
    if (!self.childrenEl) {
      const existing = self.el && self.el.querySelector ? self.el.querySelector(".tree-item-children") : null;
      self.childrenEl = existing || env().createDiv({ cls: "tree-item-children" });
    }
    return self;
  }
  inherit(CollapsibleItem, Base);
  const proto = CollapsibleItem.prototype;

  proto.setCollapsible = function (collapsible) {
    if (this.collapsible === collapsible) return;
    this.collapsible = collapsible;
    if (collapsible) {
      if (!this.collapseEl) {
        const el = this.selfEl.createDiv({ cls: "tree-item-icon collapse-icon", prepend: true });
        const setIcon = env().s12applyIcon || env().tv;
        if (setIcon) setIcon(el, "right-triangle");
        this.collapseEl = el;
      }
      this.selfEl.classList.add("mod-collapsible");
      this.collapseEl.onClickEvent((event) => this.onCollapseClick(event));
    } else {
      if (this.collapseEl) this.collapseEl.detach();
      this.collapseEl = null;
      this.selfEl.classList.remove("mod-collapsible");
      this.collapsed = false;
      ng15MarkItemCollapsed(this.el, false);
    }
  };

  proto.onCollapseClick = function (event) {
    if (event) event.preventDefault();
    this.toggleCollapsed();
  };

  proto.toggleCollapsed = function (animate) {
    this.setCollapsed(!this.collapsed, animate);
  };

  proto.setCollapsed = function (collapsed, animate) {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    this.updateCollapsed(animate);
  };

  proto.updateCollapsed = async function (animate) {
    ng15MarkItemCollapsed(this.el, this.collapsed);
    await ng15MountChildren(this.childrenEl, this.el, this.collapsed, animate);
    let node = this;
    while (node && !node.tree && node.parent) node = node.parent;
    const tree = node && node.tree;
    if (tree && tree.infinityScroll) tree.infinityScroll.invalidate(this);
  };

  return CollapsibleItem;
}

// =====================================================================================================================
// InfinityScroll — the virtualised scroller
// =====================================================================================================================

export function ng15DefineInfinityScroll() {
  const RENDER_BLOCK = 50;
  const WINDOW_MARGIN = 0.25;
  const WINDOW_MIN = 300;

  function InfinityScroll(scrollEl) {
    this.scrollEl = scrollEl;
    this.rootEl = null;
    this.rootMargin = WINDOW_MARGIN;
    this.renderBlockSize = RENDER_BLOCK;
    this.width = 0;
    this.height = 0;
    this.lastScroll = 0;
    this.queued = false;
    this.yScale = 1;
    this.rtl = false;
    this.setWidth = true;
    this._idle = null;
    this._scrollHandler = () => this.onScroll();
    this._resizeHandler = () => this.onResize();
    scrollEl.addEventListener("scroll", this._scrollHandler, { passive: true });
    window.addEventListener("resize", this._resizeHandler);
  }

  const proto = InfinityScroll.prototype;

  // ---- invalidation ----

  proto.invalidate = function (item, deep) {
    if (!item) { this.invalidateAll(); return; }
    if (deep && ng15HasChildList(item)) {
      for (const child of item.vChildren.children) this.invalidate(child, true);
    }
    item.info.queued = true;
    item.info.computed = false;
    this.queueCompute();
  };

  proto.invalidateAll = function () {
    const root = this.rootEl;
    if (root) ng15WalkTreeAll(root, (item) => { item.info.computed = false; item.info.queued = false; });
    this.queueCompute();
  };

  proto.queueCompute = function () {
    if (this.queued) return;
    this.queued = true;
    if (this._idle) this._idle.cancel();
    this._idle = ng15ScheduleIdle(() => {
      this._idle = null;
      this.compute();
    }, 50);
  };

  // ---- measuring ----

  proto.measureRow = function (parent, item) {
    void parent;
    if (!item.el) {
      if (!item.info.height) item.info.height = this._avgHeight || 30;
      return item.info.height;
    }
    const self = item.selfEl || item.el;
    const h = self ? self.offsetHeight : item.el.offsetHeight;
    if (h === 0 && self && self.isConnected) {
      item.info.height = 0;
      return 0;
    }
    if (h > 0) {
      item.info.height = h;
      this._avgHeight = this._avgHeight ? (this._avgHeight + h) / 2 : h;
    } else if (!item.info.height) {
      item.info.height = this._avgHeight || 30;
    }
    return item.info.height;
  };

  proto.measureDeep = function (item) {
    if (ng15HasChildList(item)) for (const child of item.vChildren.children) this.measureDeep(child);
    this.measureRow(item.parent, item);
  };

  // ---- layout ----

  /**
   * One layout pass. Pass A measures and positions rows (bounded by renderBlockSize unless
   * `limitPasses`); pass B decides which rows render and reconciles each childrenEl's DOM order.
   */
  proto.compute = function (limitPasses) {
    const root = this.rootEl;
    if (!root) { this.queued = false; return; }
    const budget = limitPasses ? Infinity : this.renderBlockSize;
    let used = 0;
    let more = false;
    const scrollTop = this.scrollEl.scrollTop;
    const viewH = this.scrollEl.clientHeight || this.height || 0;
    const margin = Math.max(viewH * WINDOW_MARGIN, WINDOW_MIN);
    const rangeTop = Math.max(0, scrollTop - margin);
    const rangeBottom = scrollTop + viewH + margin;
    this._rangeTop = rangeTop;
    this._rangeBottom = rangeBottom;

    const measureChildren = (parent, top) => {
      if (!ng15HasChildList(parent)) return 0;
      let offset = 0;
      for (const child of parent.vChildren.children) {
        if (used >= budget) { more = true; break; }
        used++;
        child.info.queued = false;
        const ownH = this.measureRow(parent, child);
        const hidden = !!(child.info && child.info.hidden);
        const kids = !hidden && !child.collapsed && ng15HasChildList(child) && child.childrenEl && child.childrenEl.parentNode
          ? measureChildren(child, top + offset + ownH)
          : 0;
        const total = hidden ? 0 : ownH + kids;
        child.info.height = ownH;
        child._ng15Top = top + offset;
        child._ng15Total = total;
        child.info.childTop = ownH;
        child.info.computed = true;
        offset += total;
      }
      return offset;
    };

    const rootTop = this.getRootTop();
    measureChildren(root, rootTop);

    // pass B: render decision + DOM reconciliation, top-down so parents render before children
    const renderChildren = (parent, parentRendered) => {
      if (!ng15HasChildList(parent)) return;
      const box = parent.childrenEl;
      const nodes = [];
      for (const child of parent.vChildren.children) {
        const top = child._ng15Top;
        const total = child._ng15Total;
        const computed = child.info.computed && top !== undefined;
        const intersects = computed && top < rangeBottom && top + Math.max(total, child.info.height || 0) > rangeTop;
        const wasRendered = child._ng15Rendered;
        const zeroHeight = computed && child.info.height === 0;
        const render = parentRendered && (zeroHeight || (intersects && total > 0)) && !(child.info && child.info.hidden);
        child._ng15Rendered = render;
        child.rendered = render;
        if (render && !wasRendered && typeof child.onRender === "function") child.onRender();
        if (render) {
          child.pusherEl && child.pusherEl.remove();
          nodes.push(child.el);
        } else {
          if (child.el && child.el.parentNode === box) child.el.remove();
          const p = child.pusherEl || ng15MakeTreePusher();
          child.pusherEl = p;
          p.style.height = Math.max(0, computed ? (child._ng15Total || 0) : (child.info.height || 0)) + "px";
          nodes.push(p);
        }
        renderChildren(child, render);
      }
      if (box && (box.parentNode !== null || parent === root)) {
        const current = box.children;
        let same = current.length === nodes.length;
        if (same) for (let i = 0; i < nodes.length; i++) if (current[i] !== nodes[i]) { same = false; break; }
        if (!same) {
          if (box.setChildrenInPlace) box.setChildrenInPlace(nodes);
          else nodes.forEach((n) => box.appendChild(n));
        }
      }
    };

    renderChildren(root, true);
    this.queued = false;
    if (more) this.queueCompute();
  };

  // ---- scrolling ----

  proto.precompute = function (item) { this.measureDeep(item); };

  proto.layout = function (item, budget) {
    void item; void budget;
    this.compute(true);
  };

  /** The visible window after a scroll: [scrollTop - margin, scrollTop + height + margin]. */
  proto.updateVirtualDisplay = function (scrollTop) {
    void scrollTop;
    this.compute();
  };

  proto.onScroll = function () {
    const top = this.scrollEl.scrollTop;
    const delta = Math.abs(top - this.lastScroll);
    const threshold = Math.max(this.scrollEl.clientHeight || this.height || 0, 300) / 2;
    this.lastScroll = top;
    if (delta > threshold || this.queued) this.updateVirtualDisplay(top);
  };

  proto.onResize = function () {
    const el = this.scrollEl;
    if (el.offsetParent === null) return; // hidden container: nothing to measure
    const w = el.clientWidth;
    const h = el.clientHeight;
    const widthChanged = this.setWidth && w !== this.width;
    this.width = w;
    this.height = h;
    if (widthChanged) this.invalidateAll();
    else this.queueCompute();
  };

  /** Forces computation (bounded passes) and scrolls `item` into view with `margin` px. */
  proto.scrollIntoView = function (item, margin = 0) {
    if (!item) return;
    const root = this.rootEl;
    if (!root) return;
    // bounded compute passes until the item has a position
    for (let i = 0; i < 9; i++) {
      this.compute(true);
      if (item._ng15Top !== undefined && item.info.computed) break;
    }
    if (item._ng15Top === undefined) return;
    const top = item._ng15Top - this.getRootTop();
    const bottom = top + (item._ng15Total || item.info.height || 0);
    const viewTop = this.scrollEl.scrollTop;
    const viewH = this.scrollEl.clientHeight || this.height || 0;
    let target = viewTop;
    if (top - margin < viewTop) target = top - margin;
    else if (bottom + margin > viewTop + viewH) target = bottom + margin - viewH;
    target = Math.max(0, target);
    if (Math.abs(target - viewTop) > 1) this.scrollEl.scrollTop = target;
    this.updateVirtualDisplay(this.scrollEl.scrollTop);
  };

  /** Top offset of `target` (an item or its row element) relative to the root, in content coordinates. */
  proto.findElementTop = function (target, item, top) {
    void target;
    if (item && item._ng15Top !== undefined) return item._ng15Top + (top || 0);
    return top || 0;
  };

  /** Top of the root content relative to the scroll element's content origin. */
  proto.getRootTop = function () {
    const root = this.rootEl;
    if (!root) return 0;
    const el = root.childrenEl || root.el;
    if (!el) return 0;
    const box = ng15OffsetBox(el, this.scrollEl);
    return box.top + this.scrollEl.scrollTop;
  };

  proto.update = function (item, top, rangeTop, rangeBottom, paddingInlineStart, avgHeight) {
    void item; void top; void rangeTop; void rangeBottom; void paddingInlineStart; void avgHeight;
  };

  ng15InfinityScrollClass = InfinityScroll;
  return InfinityScroll;
}

// =====================================================================================================================
// Tree — the tree controller
// =====================================================================================================================

export function ng15DefineTree(host) {
  void host;

  function Tree(view, options) {
    options = options || {};
    this.view = view;
    this.app = options.app || (view && view.app);
    this.id = options.id || "";
    this.scope = options.scope || null;
    this.containerEl = options.containerEl || null;
    this.getNodeId = options.getNodeId || (() => null);
    this.handleDeleteSelectedItems = options.handleDeleteSelectedItems || null;
    this.handleCollapseAll = options.handleCollapseAll || null;
    this.handleRenameFocusedItem = options.handleRenameFocusedItem || null;
    this.prefersCollapsed = false;
    this.isAllCollapsed = true;
    this.requestSaveFolds = debounceCall(() => this.saveFolds(), 200);
    this.activeDom = null;
    this.focusedItem = null;
    this.selectedDoms = new Set();

    const TreeChildrenClass = ng15TreeChildrenClass || ng15DefineTreeChildren();
    const TreeItemClass = ng15TreeItemClass || ng15DefineTreeItem();
    const TreeRootClass = ng15TreeRootClass || ng15DefineTreeRoot();
    const InfinityScrollClass = ng15InfinityScrollClass || ng15DefineInfinityScroll();

    this.infinityScroll = new InfinityScrollClass(this.containerEl);
    this.root = new TreeRootClass(this.containerEl);
    this.root.tree = this;
    this.infinityScroll.rootEl = this.root;
    if (this.containerEl && this.root.el && this.root.el !== this.containerEl && this.root.el.parentNode !== this.containerEl) {
      this.containerEl.appendChild(this.root.el);
    }
    this._TreeItemClass = TreeItemClass;
    this._TreeChildrenClass = TreeChildrenClass;
    void TreeRootClass;

    this.initializeKeyboardNav();
    if (this.containerEl) {
      this.containerEl.addEventListener("click", (event) => {
        if (event.target === this.containerEl) this.setFocusedItem(null);
      });
    }
  }

  const proto = Tree.prototype;

  proto.isItem = function (item) {
    return !!(item && item instanceof this._TreeItemClass);
  };

  // ---- keyboard navigation ----

  proto.initializeKeyboardNav = function () {
    const scope = this.scope;
    if (!scope) return;
    const guard = (event) => !ng15IsEditableNode(event.targetNode || event.target);
    const nav = (fn) => (event) => (guard(event) && fn.call(this, event) ? false : undefined);
    for (const mods of [[], ["Shift"], ["Mod"]]) {
      scope.register(mods, "ArrowDown", nav(this.onKeyArrowDown));
      scope.register(mods, "ArrowUp", nav(this.onKeyArrowUp));
    }
    for (const mods of [[], ["Mod"]]) {
      scope.register(mods, "ArrowLeft", nav(this.onKeyArrowLeft));
      scope.register(mods, "ArrowRight", nav(this.onKeyArrowRight));
    }
    scope.register([], "Enter", nav(this.onKeyOpen));
    scope.register(["Mod"], "Enter", nav(this.onKeyOpen));
    scope.register([], "Space", nav(this.onKeyOpen));
    if (this.handleRenameFocusedItem) {
      scope.register([], "F2", (event) => {
        if (guard(event) && this.focusedItem) {
          event.preventDefault();
          this.handleRenameFocusedItem();
          return false;
        }
        return undefined;
      });
    }
    if (this.handleDeleteSelectedItems) {
      const del = (event) => {
        if (!guard(event)) return undefined;
        this.handleDeleteSelectedItems(event);
        return false;
      };
      scope.register([], "Delete", del);
      scope.register(["Mod"], "Backspace", del);
    }
  };

  proto.onKeyOpen = function (event) {
    if (ng15IsEditableNode(event.targetNode || event.target)) return false;
    const item = this.focusedItem;
    if (!item || !item.onSelfClick) return false;
    event.preventDefault();
    const isMac = env().jl || (typeof navigator !== "undefined" && /Mac/.test(navigator.platform));
    if (event.key === "Enter" && isMac && this.handleRenameFocusedItem) {
      this.handleRenameFocusedItem();
      return true;
    }
    item.onSelfClick(event);
    return true;
  };

  proto.onKeyArrowDown = function (event) {
    if (ng15IsEditableNode(event.targetNode || event.target)) return false;
    event.preventDefault();
    this.changeFocusedItem("forwards");
    return true;
  };

  proto.onKeyArrowUp = function (event) {
    if (ng15IsEditableNode(event.targetNode || event.target)) return false;
    event.preventDefault();
    this.changeFocusedItem("backwards");
    return true;
  };

  proto.onKeyArrowLeft = function (event) {
    if (ng15IsEditableNode(event.targetNode || event.target)) return false;
    event.preventDefault();
    const item = this.focusedItem;
    const isTopLevel = !item || item === this.root || (item.parent === this.root);
    if (isTopLevel) {
      if (!this.isAllCollapsed) this.setCollapseAll(true);
      return true;
    }
    if (item.collapsible) {
      if (!item.collapsed) {
        item.setCollapsed(true);
        this.requestSaveFolds();
      } else {
        const parent = item.parent;
        if (parent && parent !== this.root) this.setFocusedItem(parent);
      }
      return true;
    }
    const parent = item.parent;
    if (parent && parent !== this.root) {
      if (parent.collapsible && !parent.collapsed) {
        parent.setCollapsed(true);
        this.requestSaveFolds();
      }
      this.setFocusedItem(parent);
    }
    return true;
  };

  proto.onKeyArrowRight = function (event) {
    if (ng15IsEditableNode(event.targetNode || event.target)) return false;
    event.preventDefault();
    const item = this.focusedItem;
    if (!item || item === this.root) return true;
    if (item.collapsible) {
      if (item.collapsed) {
        item.setCollapsed(false);
        this.requestSaveFolds();
      } else if (ng15HasChildList(item) && item.vChildren.hasChildren()) {
        const next = ng15NextVisibleTreeItem(item, true);
        if (next) this.setFocusedItem(next);
      }
      return true;
    }
    // non-collapsible target: replay the key without modifiers so it can open
    if (event.ctrlKey || event.metaKey || event.altKey) {
      const replay = ng15SyntheticKeyEvent(event, { ctrlKey: false, metaKey: false, altKey: false });
      item.el.dispatchEvent(replay);
    }
    return true;
  };

  // ---- focus / selection ----

  proto.setFocusedItem = function (item, scroll = true) {
    if (this.focusedItem && this.focusedItem !== item && this.focusedItem.selfEl) {
      this.focusedItem.selfEl.classList.remove("has-focus");
    }
    this.focusedItem = item || null;
    if (item && item.selfEl) {
      item.selfEl.classList.add("has-focus");
      if (scroll !== false && this.infinityScroll) this.infinityScroll.scrollIntoView(item);
    }
  };

  proto.changeFocusedItem = function (direction) {
    const current = this.focusedItem;
    let next;
    if (current) {
      next = direction === "forwards"
        ? ng15NextVisibleTreeItem(current, true)
        : ng15PrevVisibleTreeItem(current, true);
    } else {
      next = direction === "forwards"
        ? this.root.vChildren.first()
        : ng15LastVisibleTreeItem(this.root, true);
    }
    if (next) this.setFocusedItem(next);
  };

  proto.selectItem = function (item) {
    if (!item) return;
    this.selectedDoms.add(item);
    if (item.selfEl) item.selfEl.classList.add("is-selected");
  };

  proto.deselectItem = function (item) {
    if (!item) return;
    this.selectedDoms.delete(item);
    if (item.selfEl) item.selfEl.classList.remove("is-selected");
  };

  proto.clearSelectedDoms = function () {
    for (const item of this.selectedDoms) if (item.selfEl) item.selfEl.classList.remove("is-selected");
    this.selectedDoms.clear();
  };

  proto.getSelectedItems = function () {
    if (this.selectedDoms.size > 0) return Array.from(this.selectedDoms);
    return this.focusedItem ? [this.focusedItem] : [];
  };

  /**
   * Click-selection rules. Returns true when the click was consumed for selection (callers then skip
   * their own open/toggle behaviour): ctrl/cmd toggles, shift selects the range from activeDom, alt
   * toggles without shift; a plain click clears multi-selection and focus.
   */
  proto.handleItemSelection = function (event, item) {
    if (!item) return false;
    const isMouse = event && (event.button === 0 || event.button === undefined);
    const shift = !!(event && event.shiftKey);
    const mod = !!(event && (event.ctrlKey || event.metaKey));
    const alt = !!(event && event.altKey && !shift);
    if (shift && this.activeDom) {
      const range = ng15TreeRange(this.activeDom, item);
      for (const entry of range) this.selectItem(entry);
      this.setFocusedItem(item, false);
      this.activeDom = item;
      return true;
    }
    if (mod || alt) {
      if (this.selectedDoms.has(item)) this.deselectItem(item);
      else this.selectItem(item);
      this.setFocusedItem(item, false);
      this.activeDom = item;
      return true;
    }
    // plain click: clear multi-selection and focus, keep the active row
    this.clearSelectedDoms();
    if (!isMouse || !this.activeDom || this.activeDom !== item) this.setFocusedItem(item, false);
    this.activeDom = item;
    return false;
  };

  // ---- collapse-all ----

  proto.toggleCollapseAll = function () {
    this.setCollapseAll(!this.isAllCollapsed);
  };

  proto.setCollapseAll = function (collapsed) {
    this.isAllCollapsed = collapsed;
    ng15WalkTree(this.root, (item) => {
      if (item.collapsible && typeof item.setCollapsed === "function") item.setCollapsed(collapsed, false);
    });
    if (this.handleCollapseAll) this.handleCollapseAll(collapsed);
    this.requestSaveFolds();
  };

  proto.onResize = function () {
    if (this.infinityScroll) this.infinityScroll.onResize();
  };

  // ---- fold persistence ----

  proto.getFoldKey = function () {
    return this.prefersCollapsed ? this.id + "-unfold" : this.id + "-folds";
  };

  proto.loadFolds = function () {
    const key = this.getFoldKey();
    let stored = null;
    const appId = this.app && this.app.appId;
    try {
      if (appId && key.indexOf(appId + "-") === 0) {
        const raw = localStorage.getItem(key);
        stored = raw === null ? null : JSON.parse(raw);
      } else if (this.app && this.app.loadLocalStorage) {
        stored = this.app.loadLocalStorage(key);
      }
    } catch (e) { stored = null; }
    if (!Array.isArray(stored)) return;
    const ids = new Set(stored);
    const app = this.app;
    ng15WalkTree(this.root, (item) => {
      if (!item.collapsible || typeof item.setCollapsed !== "function") return;
      const id = this.getNodeId(item);
      if (id == null) return;
      // prefersCollapsed trees store the EXPANDED set; normal trees store the COLLAPSED set
      const collapsed = this.prefersCollapsed ? !ids.has(id) : ids.has(id);
      if (item.collapsed !== collapsed) item.setCollapsed(collapsed, false);
    });
    void app;
    if (this.infinityScroll) this.infinityScroll.invalidateAll();
  };

  proto.saveFolds = function () {
    const app = this.app;
    const workspace = app && app.workspace;
    if (!workspace || !workspace.layoutReady) return;
    const ids = [];
    ng15WalkTree(this.root, (item) => {
      if (!item.collapsible) return;
      const collapsed = !!item.collapsed;
      if (collapsed !== !!this.prefersCollapsed) {
        const id = this.getNodeId(item);
        if (id != null) ids.push(id);
      }
    });
    const key = this.getFoldKey();
    const appId = app && app.appId;
    if (appId && key.indexOf(appId + "-") === 0) {
      try { localStorage.setItem(key, JSON.stringify(ids)); } catch (e) {}
    } else if (app.saveLocalStorage) {
      app.saveLocalStorage(key, ids);
    }
  };

  return Tree;
}

export function ng15DefineTreeChildrenBound(host) {
  const cls = ng15DefineTreeChildren(host);
  ng15TreeChildrenClass = cls;
  return cls;
}
export function ng15DefineTreeItemBound(host) {
  const cls = ng15DefineTreeItem(host);
  ng15TreeItemClass = cls;
  return cls;
}
export function ng15DefineTreeRootBound(host) {
  const TreeChildren = host && host.TreeChildren ? host.TreeChildren : ng15TreeChildrenClass;
  void TreeChildren;
  const cls = ng15DefineTreeRoot(host);
  ng15TreeRootClass = cls;
  return cls;
}
export function ng15DefineInfinityScrollBound(host) {
  const cls = ng15DefineInfinityScroll(host);
  ng15InfinityScrollClass = cls;
  return cls;
}
export function ng15DefineTreeBound(host) {
  const cls = ng15DefineTree(host);
  return cls;
}

// =====================================================================================================================
// Shared drag & drop indicator
// =====================================================================================================================

/**
 * Computes the drop target for a tree drag. Returns null or
 * { node, parentNode, idx, placement, overlapsNode, x, y }.
 */
export function ng15TreeDropPosition(event, tree) {
  const scrollEl = tree.infinityScroll && tree.infinityScroll.scrollEl;
  if (!scrollEl) return null;
  const x = event.clientX;
  const y = event.clientY;
  const items = [];
  const root = tree.root;
  if (!root) return null;
  // collect top-level rows under the pointer, honouring hidden rows and the selected set
  const selected = tree.selectedDoms || new Set();
  const gather = (parent) => {
    if (!ng15HasChildList(parent)) return;
    for (const child of parent.vChildren.children) {
      if (child.info && child.info.hidden) continue;
      if (selected.has(child)) continue; // a selected row prunes its subtree
      items.push(child);
      if (child.collapsible && !child.collapsed) gather(child);
    }
  };
  gather(root);
  if (items.length === 0) {
    // empty tree: drop at the end of the root list
    return { node: null, parentNode: root, idx: 0, placement: "after", overlapsNode: false, x: 0, y: y };
  }
  const first = items[0];
  const last = items[items.length - 1];
  const firstTop = ng15ItemTop(first, tree);
  const lastBottom = ng15ItemBottom(last, tree);
  if (y < firstTop) {
    return { node: first, parentNode: first.parent, idx: childIndex(first), placement: "before", overlapsNode: false, x: ng15ItemIndentX(first), y: firstTop };
  }
  if (y > lastBottom) {
    const idx = childIndex(last) + 1;
    return { node: last, parentNode: last.parent, idx, placement: "after", overlapsNode: false, x: ng15ItemIndentX(last), y: lastBottom };
  }
  // find the row under the pointer
  let target = null;
  for (const item of items) {
    const top = ng15ItemTop(item, tree);
    const bottom = ng15ItemBottom(item, tree);
    if (y >= top && y <= bottom) { target = item; break; }
  }
  if (!target) target = last;
  const top = ng15ItemTop(target, tree);
  const bottom = ng15ItemBottom(target, tree);
  const mid = top + (bottom - top) / 2;
  const placement = y < mid ? "before" : "after";
  // central band of a collapsible row means "into this folder"
  const rowH = bottom - top;
  const band = Math.min(rowH * 0.3, 12);
  const overlapsNode = !!(target.collapsible && Math.abs(y - (top + rowH / 2)) <= band);
  let parentNode = target.parent;
  let idx = childIndex(target);
  if (overlapsNode) {
    return { node: target, parentNode: target, idx: 0, placement: "into", overlapsNode: true, x: ng15ItemIndentX(target), y: top };
  }
  if (placement === "after" && target.collapsible && !target.collapsed && ng15HasChildList(target)) {
    // dropping after an expanded folder lands inside it
    return { node: target, parentNode: target, idx: target.vChildren.size(), placement: "after", overlapsNode: false, x: ng15ItemIndentX(target), y: bottom };
  }
  if (placement === "after") idx += 1;
  return { node: target, parentNode, idx, placement, overlapsNode: false, x: ng15ItemIndentX(target), y: placement === "before" ? top : bottom };
}

function childIndex(item) {
  const parent = item && item.parent;
  if (!parent || !parent.vChildren) return 0;
  const idx = parent.vChildren.children.indexOf(item);
  return idx < 0 ? 0 : idx;
}

function ng15ItemTop(item, tree) {
  if (item._ng15Top !== undefined) return item._ng15Top;
  const scroller = tree.infinityScroll;
  if (scroller) {
    for (let i = 0; i < 9; i++) { scroller.compute(true); if (item._ng15Top !== undefined) break; }
  }
  return item._ng15Top !== undefined ? item._ng15Top : 0;
}

function ng15ItemBottom(item, tree) {
  return ng15ItemTop(item, tree) + (item._ng15Total !== undefined ? item._ng15Total : (item.info ? item.info.height : 0));
}

function ng15ItemIndentX(item) {
  // x = the child's indent for folder drops, the row's left indent for top-level drops
  let depth = 0;
  let node = item;
  while (node && node.parent && node.parent.vChildren) { depth++; node = node.parent; }
  return depth * 16;
}

const ng15DropIndicatorState = new WeakMap();

/**
 * Shows/moves/hides the shared `.drop-indicator.is-active` element for `tree`.
 * `items` are the dragged tree items (used to suppress no-op self drops and to auto-expand
 * collapsed hover targets). Returns the indicator element, or undefined when hiding.
 */
export function ng15UpdateTreeDropIndicator(tree, pos, items, isOver) {
  const containerEl = tree.containerEl;
  if (!containerEl) return undefined;
  let state = ng15DropIndicatorState.get(tree);
  if (!state) {
    state = { el: null, pos: null, items: null, overNode: null, expandTimer: null };
    ng15DropIndicatorState.set(tree, state);
  }
  const dragged = Array.isArray(items) ? items : [];
  if (!isOver || !pos) {
    if (state.el) state.el.classList.remove("is-active");
    if (state.overNode && state.overNode.selfEl) state.overNode.selfEl.classList.remove("is-being-dragged-over");
    state.overNode = null;
    if (state.expandTimer) { clearTimeout(state.expandTimer); state.expandTimer = null; }
    return undefined;
  }
  // no-op drop: a single dragged item right before/after itself shows no indicator
  const node = pos.node;
  const single = dragged.length === 1 ? dragged[0] : null;
  const noop = !!(single && node === single && (pos.placement === "before" || pos.placement === "after") &&
    pos.parentNode === single.parent && pos.idx === (pos.placement === "before" ? childIndex(single) : childIndex(single) + 1));
  if (noop) {
    if (state.el) state.el.classList.remove("is-active");
    return state.el || undefined;
  }
  // hover state on the overlapped collapsible row + auto-expand after ~750 ms
  if (pos.overlapsNode && node && node.collapsible && dragged.indexOf(node) < 0) {
    if (state.overNode !== node) {
      if (state.overNode && state.overNode.selfEl) state.overNode.selfEl.classList.remove("is-being-dragged-over");
      state.overNode = node;
      if (node.selfEl) node.selfEl.classList.add("is-being-dragged-over");
      if (node.collapsed && typeof node.setCollapsed === "function") {
        if (state.expandTimer) clearTimeout(state.expandTimer);
        state.expandTimer = setTimeout(() => {
          state.expandTimer = null;
          if (state.overNode === node && node.collapsed) node.setCollapsed(false);
        }, 750);
      }
    }
  } else if (state.overNode) {
    if (state.overNode.selfEl) state.overNode.selfEl.classList.remove("is-being-dragged-over");
    state.overNode = null;
    if (state.expandTimer) { clearTimeout(state.expandTimer); state.expandTimer = null; }
  }
  if (!state.el) {
    state.el = document.createElement("div");
    state.el.className = "drop-indicator";
    containerEl.appendChild(state.el);
  }
  state.el.classList.add("is-active");
  state.el.style.left = (pos.x || 0) + "px";
  state.el.style.top = (pos.y || 0) + "px";
  state.el.style.width = "auto";
  return state.el;
}
