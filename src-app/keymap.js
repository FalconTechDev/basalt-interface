// Keyboard handling: Scope (a set of key bindings with an optional parent), a Scope variant whose parent is looked up on every key
// press (the workspace uses it to follow the active view), and Keymap (the global key listener with a stack of scopes).
import { inherit } from "./inherit.js";

export function defineScope(host) {
  /**
   * A list of bindings { scope, modifiers, key, func }. A key press is offered to the bindings in registration order; the first
   * binding that matches and returns something other than `undefined` decides (returning `false` swallows the key).
   * Unhandled presses go to the parent scope.
   */
  function Scope(parent) {
    this.tabFocusContainerEl = null; // when set, focus is kept inside this element while the scope is active
    this.keys = [];
    this.parent = parent;
  }

  /** `modifiers`: array like ["Mod", "Shift"] (or null = any); `key`: key name (or null = any). */
  Scope.prototype.register = function (modifiers, key, func) {
    const binding = { scope: this, modifiers: modifiers ? host.Keymap.compileModifiers(modifiers) : null, key, func };
    this.keys.push(binding);
    return binding;
  };

  Scope.prototype.unregister = function (binding) { this.keys.remove(binding); };

  Scope.prototype.setTabFocusContainerEl = function (el) { this.tabFocusContainerEl = el; };

  Scope.prototype.handleKey = function (event, info) {
    for (const binding of this.keys) {
      if (!host.Keymap.isMatch(binding, info)) continue;
      const result = binding.func(event, info);
      if (result !== undefined) return result;
      // a catch-all binding that returned nothing lets the key fall through; a specific one ends the search
      if (binding.key !== null || binding.modifiers !== null) return result;
    }
    if (this.parent) return this.parent.handleKey(event, info);
    return undefined;
  };

  return Scope;
}

export function defineDynamicScope(host) {
  /** A Scope that first asks `getActive()` for another scope and lets it handle the key when there is one. */
  function DynamicScope(parent, getActive) {
    const self = host.Scope.call(this, parent) || this;
    self.cb = getActive;
    return self;
  }
  inherit(DynamicScope, host.Scope);

  DynamicScope.prototype.handleKey = function (event, info) {
    const active = this.cb();
    return active ? active.handleKey(event, info) : host.Scope.prototype.handleKey.call(this, event, info);
  };

  return DynamicScope;
}

export function defineKeymap(host) {
  return class Keymap {
    constructor() {
      this.modifiers = ""; // compiled modifier string of the last key event, e.g. "Ctrl,Shift"
      this.rootScope = new host.Scope();
      this.scope = this.rootScope;
      this.prevScopes = [];
      window.addEventListener("keydown", this.onKeyEvent.bind(this), true);
      window.addEventListener("focusin", this.onFocusIn.bind(this));
    }

    /** The one global instance (created on first use). */
    static init() {
      if (!Keymap.global) Keymap.global = new Keymap();
      return Keymap.global;
    }

    getRootScope() { return this.rootScope; }

    pushScope(scope) {
      if (this.scope === scope) return;
      this.prevScopes.push(this.scope);
      this.scope = scope;
    }

    popScope(scope) {
      if (scope === this.rootScope) return;
      if (this.scope === scope) this.scope = this.prevScopes.pop() || this.rootScope;
      else this.prevScopes.remove(scope);
    }

    onKeyEvent(event) {
      this.updateModifiers(event);
      const scope = this.scope;
      if (!scope) return undefined;
      const key = host.eventKey(event);
      if (Keymap.isModifierKey(key)) return undefined;
      let virtualKey = host.eventVirtualKey(event);
      // a layout that types "^" on the I key reports it as dead key: treat it as plain I
      if (event.which === 54 && event.key === "^" && event.code === "KeyI") virtualKey = "KeyI";
      const info = { modifiers: this.modifiers, key, vkey: virtualKey };
      if (scope.handleKey(event, info) === false) {
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
      return undefined;
    }

    /** With a tab focus container, focus that moves outside of it is taken back (or dropped) a tick later. */
    onFocusIn(event) {
      const scope = this.scope;
      if (!scope || !scope.tabFocusContainerEl) return;
      const container = scope.tabFocusContainerEl;
      const target = event.targetNode;
      if (target && target !== activeDocument.body && target.instanceOf(Element) && !container.contains(target)) {
        setTimeout(() => {
          if (this.scope !== scope) return;
          if (!host.focusElement(container, { preventScroll: true })) {
            const active = activeDocument.activeElement;
            if (active && active.instanceOf(HTMLElement)) active.blur();
          }
        }, 0);
      }
    }

    updateModifiers(event) { this.modifiers = Keymap.getModifiers(event); }

    /** "Ctrl,Meta,Alt,Shift" subset that is held in `event`, compiled. */
    static getModifiers(event) {
      const held = [];
      if (event.ctrlKey) held.push("Ctrl");
      if (event.metaKey) held.push("Meta");
      if (event.altKey) held.push("Alt");
      if (event.shiftKey) held.push("Shift");
      return Keymap.compileModifiers(held);
    }

    /** ["Mod", "Shift"] -> "Ctrl,Shift" (Mod is Cmd on macOS, Ctrl elsewhere); sorted so that comparison is a string compare. */
    static compileModifiers(list) {
      return list.map((name) => (name === "Mod" ? (host.osName === "macOS" ? "Meta" : "Ctrl") : name)).sort().join(",");
    }

    /** Inverse of compileModifiers (the platform's Mod key is written as "Mod" again). */
    static decompileModifiers(text) {
      const mac = host.osName === "macOS";
      return text
        .split(",")
        .map((name) => ((mac && name === "Meta") || (!mac && name === "Ctrl") ? "Mod" : name))
        .filter((name) => name);
    }

    static isModifierKey(key) {
      return key === "Control" || key === "Alt" || key === "Shift" || key === "OS" || key === "Meta";
    }

    matchModifiers(compiled) { return this.modifiers === compiled; }

    hasModifier(name) { return Keymap.decompileModifiers(this.modifiers).contains(name); }

    /** Is modifier `name` ("Ctrl", "Meta", "Alt", "Shift" or "Mod") held in the event? */
    static isModifier(event, name) {
      if (name === "Ctrl") return event.ctrlKey;
      if (name === "Meta") return event.metaKey;
      if (name === "Alt") return event.altKey;
      if (name === "Shift") return event.shiftKey;
      return name === "Mod" && (host.osName === "macOS" ? event.metaKey : event.ctrlKey);
    }

    /** Does the key info `{ modifiers, key, vkey }` fire `binding`? A null modifiers / key in the binding means "any". */
    static isMatch(binding, info) {
      const { modifiers, key } = binding;
      return (modifiers === null || modifiers === info.modifiers) &&
        (!key || key === info.vkey || !(!info.key || key.toLowerCase() !== info.key.toLowerCase()));
    }

    /**
     * How an open/click event asks to open something: "tab" (Mod+click or middle button), "split" (Mod+Alt),
     * "window" (Mod+Alt+Shift) or false for a plain click.
     */
    static isModEvent(event) {
      if (!event) return false;
      const middleButton = (event.instanceOf(MouseEvent) || event.instanceOf(PointerEvent)) && event.button === 1;
      if (middleButton) return "tab";
      if (!Keymap.isModifier(event, "Mod")) return false;
      if (Keymap.isModifier(event, "Alt")) return Keymap.isModifier(event, "Shift") ? "window" : "split";
      return "tab";
    }
  };
}
