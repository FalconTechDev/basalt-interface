// Class plumbing for the own classes that replace the application's ES5-style class bodies.
//
// The remaining (inherited) classes of the bundle derive from each other with plain constructor functions:
// `var self = Base.call(this) || this`. A native `class` cannot be called that way, so every own class that is
// subclassed from inherited code is written as a constructor function and linked with `inherit`.

/** Makes `Child` derive from `Parent`: prototype chain for instances, and the constructor chain for static members. */
export function inherit(Child, Parent) {
  Object.setPrototypeOf(Child, Parent);
  Child.prototype = Object.create(Parent.prototype, {
    constructor: { value: Child, writable: true, configurable: true },
  });
  return Child;
}

/** Defines the given functions as (non-enumerable-by-convention) prototype methods of `Class`. */
export function methods(Class, table) {
  for (const name of Object.keys(table)) Class.prototype[name] = table[name];
  return Class;
}
