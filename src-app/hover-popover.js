// HoverPopover: the floating preview that appears when the pointer rests on a link or a tab and stays while the pointer is over the
// target or the popover (or a popover opened from inside it). All popovers share one global tracker: while any is shown a 500 ms
// poll checks where the pointer is, and a click anywhere (outside) closes the popovers that are not focused.
import { inherit } from "./inherit.js";
import { runTransition } from "./animation.js";

/** popovers waiting to appear (the show timer is running) */
const pending = [];
/** popovers on screen */
const shown = [];
let pollTimer = 0;
/** where the pointer is, { x, y, doc } of the last mouse move while any popover is shown */
let pointer = null;

function trackPointer(event) {
  pointer = { x: event.clientX, y: event.clientY, doc: event.doc };
}

/** A click closes the popovers waiting to show and, a moment later, the shown ones that did not get the click or focus. */
function onGlobalClick(event) {
  for (const popover of pending) popover.hide();
  const target = event.targetNode;
  const closing = [];
  for (const popover of shown) {
    if (popover.isFocused || popover.hoverEl.contains(target)) continue;
    if (popover.childHovers.some((child) => child.hoverEl.contains(target))) continue;
    closing.push(popover);
  }
  event.win.setTimeout(() => { closing.forEach((popover) => popover.hide()); }, 5);
}

/** Every 500 ms: let each popover look at what is under the pointer and move on in its state machine. */
function poll() {
  if (shown.length === 0) {
    window.removeEventListener("click", onGlobalClick, { capture: true });
    window.removeEventListener("contextmenu", onGlobalClick, { capture: true });
    window.removeEventListener("mousemove", trackPointer);
    clearInterval(pollTimer);
    pollTimer = 0;
    pointer = null;
    return;
  }
  if (!pointer) return;
  const under = pointer.doc.elementFromPoint(pointer.x, pointer.y);
  for (const popover of shown) popover.detect(under);
  for (const popover of shown) popover.transition();
}

function ensureTracking() {
  if (pollTimer) return;
  window.addEventListener("click", onGlobalClick, { capture: true });
  window.addEventListener("contextmenu", onGlobalClick, { capture: true });
  window.addEventListener("mousemove", trackPointer);
  pollTimer = window.setInterval(poll, 500);
}

export function defineHoverPopover(host) {
  const State = host.PopoverState;

  /**
   * `parent` owns the popover (`parent.hoverPopover`); `targetEl` is what the pointer rests on (null for a free-standing popover);
   * it shows after `waitTime` ms, optionally at the fixed screen position `staticPos` { x, y }.
   */
  function HoverPopover(parent, targetEl, waitTime = 300, staticPos = null) {
    const self = host.Component.call(this) || this;
    self.onTarget = true;   // pointer is on the target
    self.onHover = false;   // pointer is on the popover
    self.isFocused = false;
    self.staticPos = null;
    self.parent = parent;
    self.targetEl = targetEl;
    self.waitTime = waitTime;
    self.state = State.Showing;
    self.staticPos = staticPos;
    const hoverEl = (self.hoverEl = createDiv("popover hover-popover"));
    const onMouseIn = (self.onMouseIn = self.onMouseIn.bind(self));
    const onMouseOut = (self.onMouseOut = self.onMouseOut.bind(self));
    if (targetEl) {
      targetEl.addEventListener("mouseover", onMouseIn);
      targetEl.addEventListener("mouseout", onMouseOut);
    }
    hoverEl.addEventListener("mouseover", (event) => {
      if (host.pointerEntered(event, hoverEl)) { self.onHover = true; self.transition(); }
    });
    hoverEl.addEventListener("mouseout", (event) => {
      if (host.pointerEntered(event, hoverEl)) { self.onHover = false; self.transition(); }
    });
    self.timer = activeWindow.setTimeout(self.show.bind(self), waitTime);
    pending.push(self);
    ensureTracking();
    return self;
  }
  inherit(HoverPopover, host.Component);
  const proto = HoverPopover.prototype;

  // `pointerEntered(event, el)` is true when the event crosses the boundary of `el` (not just moves between its children)
  proto.onMouseIn = function (event) {
    if (this.targetEl && !host.pointerEntered(event, this.targetEl)) return;
    this.onTarget = true;
    this.transition();
  };
  proto.onMouseOut = function (event) {
    if (this.targetEl && !host.pointerEntered(event, this.targetEl)) return;
    this.onTarget = false;
    this.transition();
  };

  /** Sets onTarget / onHover from the element that is under the pointer. */
  proto.detect = function (el) {
    const { targetEl, hoverEl } = this;
    if (targetEl) this.onTarget = el === targetEl || targetEl.contains(el);
    this.onHover = el === hoverEl || hoverEl.contains(el);
  };

  proto.shouldShow = function () { return this.shouldShowSelf() || this.shouldShowChild(); };
  proto.shouldShowSelf = function () {
    const el = this.hoverEl;
    return this.onTarget || this.onHover || this.isFocused || el.contains(el.doc.activeElement);
  };

  /** Shown popovers that were opened from something inside this popover. */
  Object.defineProperty(proto, "childHovers", {
    get() { return shown.filter((other) => other !== this && other.targetEl && this.hoverEl.contains(other.targetEl)); },
    enumerable: false,
    configurable: true,
  });

  proto.shouldShowChild = function () { return this.childHovers.some((child) => child.shouldShow()); };
  proto.setIsFocused = function (focused) { this.isFocused = focused; };

  /** State machine: Showing -> (hide at once if the pointer left) ; Shown -> Hiding (after waitTime) -> Hidden ; Hiding -> Shown when wanted again. */
  proto.transition = function () {
    const wanted = this.shouldShow();
    const state = this.state;
    if (wanted) {
      if (state === State.Hiding) {
        this.state = State.Shown;
        clearTimeout(this.timer);
      }
    } else if (state === State.Showing) {
      this.hide();
    } else if (state === State.Shown) {
      this.state = State.Hiding;
      this.timer = activeWindow.setTimeout(() => {
        if (this.shouldShow()) this.transition();
        else this.hide();
      }, this.waitTime);
    }
  };

  proto.show = function () {
    const target = this.targetEl;
    if (target && !target.doc.body.contains(target)) {
      this.hide();
      return;
    }
    this.state = State.Shown;
    this.timer = 0;
    this.position();
    this.onShow();
    pending.remove(this);
    shown.push(this);
    ensureTracking();
    this.load();
    runTransition(this.hoverEl, new host.Transition({ fn: "var(--anim-motion-swing)", duration: 80 }).addProp("opacity", "0", "1", ""));
  };

  proto.hide = function () {
    const { hoverEl, targetEl, timer } = this;
    this.state = State.Hidden;
    pending.remove(this);
    shown.remove(this);
    clearTimeout(timer);
    hoverEl.detach();
    if (targetEl) {
      targetEl.removeEventListener("mouseover", this.onMouseIn);
      targetEl.removeEventListener("mouseout", this.onMouseOut);
    }
    this.onTarget = false;
    this.onHover = false;
    // popovers that were opened from inside this one lose their ground
    for (const other of shown) {
      if (!other.shouldShowSelf() && other.targetEl && this.hoverEl.contains(other.targetEl)) other.hide();
    }
    this.onHide();
    this.unload();
  };

  /** Becomes the parent's current popover (replacing, and hiding, the previous one). */
  proto.onShow = function () {
    const parent = this.parent;
    if (parent.hoverPopover) parent.hoverPopover.hide();
    parent.hoverPopover = this;
    host.hideTooltip();
  };

  proto.onHide = function () {
    const parent = this.parent;
    if (parent.hoverPopover === this) parent.hoverPopover = null;
  };

  /** Places the popover beside the target (or at the pointer for tall targets and static positions). */
  proto.position = function () {
    const { hoverEl, targetEl } = this;
    const fixed = this.staticPos;
    const point = fixed || pointer;
    let rect;
    if (!fixed && targetEl) {
      if (pointer && targetEl.offsetHeight > 300) {
        // a tall target (a whole note): anchor at the pointer instead
        this.staticPos = pointer;
        rect = { top: pointer.y - 10, bottom: pointer.y + 10, left: pointer.x, right: pointer.x };
      } else {
        const box = targetEl.getBoundingClientRect();
        rect = { top: box.top, bottom: box.top + targetEl.offsetHeight, left: box.left, right: box.left + targetEl.offsetWidth };
      }
    } else if (point) {
      rect = { top: point.y - 10, bottom: point.y + 10, left: point.x, right: point.x };
      this.staticPos = point;
    } else {
      rect = { top: 0, bottom: 0, left: 0, right: 0 };
    }
    let doc = activeDocument;
    let rtl = false;
    if (targetEl) {
      rtl = getComputedStyle(targetEl).direction === "rtl";
      const mapped = host.rectInTopWindow(rect, targetEl.win);
      rect = mapped.rect;
      doc = mapped.win.document;
    }
    if (hoverEl.parentElement !== doc.body) doc.body.appendChild(hoverEl);
    host.positionNear(rect, hoverEl, { gap: 10, preventOverlap: true, horizontalAlignment: rtl ? "right" : "left" });
  };

  /** Re-positions when `el` changes size (content loading), at most 10 times. */
  proto.watchResize = function (el) {
    if (!this.observer) {
      let count = 0;
      this.observer = new ResizeObserver(() => {
        if (this.state !== State.Shown) return;
        if (++count >= 10) {
          if (this.observer) this.observer.disconnect();
          this.observer = null;
          return;
        }
        this.position();
      });
    }
    this.observer.observe(el);
  };

  proto.onunload = function () {
    host.Component.prototype.onunload.call(this);
    if (this.observer) this.observer.disconnect();
    this.observer = null;
  };

  return HoverPopover;
}
