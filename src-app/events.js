// Events (a tiny named-event emitter) and Component (load/unload lifecycle with owned children and cleanups).
// These two are the base of nearly every class in the application and of every community plugin, so the observable
// behaviour is kept exactly: reference objects returned by `on`, errors in handlers surfacing asynchronously, load/unload ordering.

/** Factory called once at the place of the original class; `host` gives access to the rest of the application. */
export function defineEvents() {
  function Events() {
    // event name -> list of subscription records; the field name is read by older plugins, keep it
    this._ = {};
  }

  /** Subscribes `callback` (called with `context` as `this`); returns the subscription reference. */
  Events.prototype.on = function (name, callback, context) {
    let list = this._[name];
    if (!list) list = this._[name] = [];
    const ref = { e: this, name, fn: callback, ctx: context };
    list.push(ref);
    return ref;
  };

  /** Removes every subscription of `name` whose callback is `callback`. */
  Events.prototype.off = function (name, callback) {
    const list = this._[name];
    const kept = [];
    if (list && callback) for (const sub of list) if (sub.fn !== callback) kept.push(sub);
    if (kept.length > 0) this._[name] = kept;
    else delete this._[name];
  };

  /** Removes the single subscription a reference stands for. */
  Events.prototype.offref = function (ref) {
    if (!ref) return;
    const list = this._[ref.name];
    const kept = [];
    if (list) for (const sub of list) if (sub !== ref) kept.push(sub);
    if (kept.length) this._[ref.name] = kept;
    else delete this._[ref.name];
  };

  /** Calls every subscriber of `name`; the list is copied first, so handlers may subscribe or unsubscribe while running. */
  Events.prototype.trigger = function (name, ...args) {
    const list = this._[name];
    if (!list) return;
    for (const sub of list.slice()) this.tryTrigger(sub, args);
  };

  /** Runs one subscriber; an exception is rethrown on a fresh stack so it cannot break the other subscribers. */
  Events.prototype.tryTrigger = function (sub, args) {
    try {
      sub.fn.apply(sub.ctx, args);
    } catch (err) {
      setTimeout(() => { throw err; }, 0);
    }
  };

  return Events;
}

export function defineComponent() {
  function Component() {
    this._loaded = false;
    this._events = []; // cleanup functions, run in reverse order on unload
    this._children = [];
  }

  /** Loads the component and then its children; returns a promise only when something asynchronous was started. */
  Component.prototype.load = function () {
    if (this._loaded) return;
    this._loaded = true;
    const pending = [];
    const own = this.onload();
    if (own) pending.push(own);
    for (const child of this._children.slice()) {
      const result = child.load();
      if (result) pending.push(result);
    }
    return pending.length > 0 ? Promise.all(pending).then() : undefined;
  };
  Component.prototype.onload = function () {};

  /** Unloads children (last added first), then runs cleanups (last registered first), then calls onunload. */
  Component.prototype.unload = function () {
    if (!this._loaded) return;
    this._loaded = false;
    const children = this._children;
    const cleanups = this._events;
    while (children.length > 0) children.pop().unload();
    while (cleanups.length > 0) cleanups.pop()();
    this.onunload();
  };
  Component.prototype.onunload = function () {};

  Component.prototype.addChild = function (child) {
    this._children.push(child);
    if (this._loaded) child.load();
    return child;
  };

  Component.prototype.removeChild = function (child) {
    const at = this._children.indexOf(child);
    if (at !== -1) {
      this._children.splice(at, 1);
      child.unload();
    }
    return child;
  };

  /** Registers a cleanup to run when the component unloads. */
  Component.prototype.register = function (cleanup) {
    this._events.push(cleanup);
  };

  Component.prototype.registerEvent = function (ref) {
    this.register(() => ref.e.offref(ref));
  };

  Component.prototype.registerDomEvent = function (target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.register(() => target.removeEventListener(type, listener, options));
  };

  Component.prototype.registerScopeEvent = function (handler) {
    this.register(() => handler.scope.unregister(handler));
  };

  Component.prototype.registerInterval = function (id) {
    this.register(() => clearInterval(id));
    return id;
  };

  return Component;
}
