// CSS transitions driven from script: describe the style properties to animate (Transition), start it on an element (runTransition)
// and, if needed, finish it early (cancelTransition). Used for sidebar collapse/expand, tab insert/remove, menus, notices.

export function defineTransition() {
  /**
   * `from` styles are applied first, then (one frame later) the `to` styles with a CSS transition; when it ends the `end` styles
   * replace the animated ones (usually "" to give control back to the stylesheet).
   */
  function Transition(options) {
    this.from = {};
    this.to = {};
    this.end = {};
    const { duration = 100, fn = "ease-in-out" } = options || {};
    this.duration = duration;
    this.fn = fn;
  }

  /** Adds a property: `from` -> `to`, afterwards `end` (a null leaves that stage out). Chainable. */
  Transition.prototype.addProp = function (name, from, to, end = null) {
    if (from !== null) this.from[name] = from;
    if (to !== null) this.to[name] = to;
    if (end !== null) this.end[name] = end;
    return this;
  };

  return Transition;
}

/** element -> the transition currently running on it */
const running = new WeakMap();
/** actions waiting for the next frame (so that the `from` styles are laid out before the `to` styles arrive) */
let startQueue = null;

function applyStyles(el, styles) {
  for (const name in styles) if (styles.hasOwnProperty(name)) el.style[name] = styles[name];
}

/** Ends the transition running on `el` right now: the `end` styles are applied and the completion callback runs (unless `silent`). */
export function cancelTransition(el, silent) {
  const state = running.get(el);
  running.delete(el);
  if (!state) return;
  el.style.transition = "";
  el.style.transitionProperty = "";
  applyStyles(el, state.spec.end);
  state.win.clearTimeout(state.timer);
  el.removeEventListener("transitionend", state.listener);
  if (!silent && state.onDone) state.onDone.call(state);
}

/** Starts `spec` on `el`, replacing a running one; `onDone` is called when it has finished (or has been cancelled). */
export function runTransition(el, spec, onDone) {
  cancelTransition(el);
  applyStyles(el, spec.from);
  const state = {
    spec,
    onDone,
    timer: 0,
    win: el.win,
    listener: (event) => { if (event.target === el) cancelTransition(el); },
  };
  running.set(el, state);
  if (startQueue === null) {
    startQueue = [];
    setTimeout(() => {
      document.body.offsetHeight; // force layout so the starting styles are in effect
      const queue = startQueue;
      startQueue = null;
      for (const start of queue) start();
    }, 0);
  }
  startQueue.push(() => {
    el.style.transition = `all ${spec.duration}ms ${spec.fn}`;
    el.style.transitionProperty = Object.keys(spec.from).join(", ");
    applyStyles(el, spec.to);
    el.addEventListener("transitionend", state.listener);
    // transitionend never fires when nothing changes (hidden element, same value): the timer is the safety net
    state.timer = state.win.setTimeout(() => cancelTransition(el), spec.duration + 50);
  });
}
