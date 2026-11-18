// s20: the small DOM "tree item" classes used by the orphaned-attachments dialog.
//   ZL  childrenMixin: collapsible tree item that renders a list of child items
//   XL  collapsible tree item (no extra behaviour)
//   $L  plain tree item with a no-op render
//   JL  children-rendering tree item
//   eI  container: owns a childrenEl and renders its children into it
//
// These mirror the shape of the workspace TreeItem (src-app/tree.js) but are the
// separate, simpler classes the attachments dialog was built on.

import { inherit } from "./inherit.js";
import { ng15CollapsibleTreeItem } from "./n-g15-tree.js";

/**
 * Mixin factory: extends `Base` (already collapsible-aware) with a `children` list and a
 * `render()` that mounts the children's elements into `childrenEl`.
 */
export function s20ChildrenMixin(Base) {
  const Collapsible = ng15CollapsibleTreeItem(Base);
  function ChildrenItem() {
    const self = Collapsible.apply(this, arguments) || this;
    self.children = null;
    return self;
  }
  inherit(ChildrenItem, Collapsible);
  ChildrenItem.prototype.render = function () {
    const childrenEl = this.childrenEl;
    const children = this.children;
    if (children !== null) {
      childrenEl.setChildrenInPlace(children.map((child) => child.el));
      for (const child of children) child.render();
    } else {
      childrenEl.empty();
    }
  };
  return ChildrenItem;
}

/** A collapsible tree item with no render behaviour of its own. */
export function defineS20CollapsibleItem(host) {
  const Base = ng15CollapsibleTreeItem(host.TreeItem);
  function CollapsibleItem() {
    return Base.apply(this, arguments) || this;
  }
  inherit(CollapsibleItem, Base);
  return CollapsibleItem;
}

/** A plain tree item whose render does nothing (subclasses fill it in). */
export function defineS20RenderItem(host) {
  function RenderItem() {
    return host.TreeItem.apply(this, arguments) || this;
  }
  inherit(RenderItem, host.TreeItem);
  RenderItem.prototype.render = function () {};
  return RenderItem;
}

/** A tree item that renders `children` into its `childrenEl` (folder rows). */
export function defineS20ChildrenItem(host) {
  return s20ChildrenMixin(host.TreeItem);
}

/** Container with a `children` list rendered into a caller-provided element. */
export function defineS20TreeContainer() {
  function TreeContainer(childrenEl) {
    this.children = [];
    this.childrenEl = childrenEl;
  }
  TreeContainer.prototype.render = function () {
    const childrenEl = this.childrenEl;
    const children = this.children;
    childrenEl.setChildrenInPlace(children.map((child) => child.el));
    for (const child of children) child.render();
  };
  TreeContainer.prototype.addRoot = function (item) {
    this.children.push(item);
  };
  TreeContainer.prototype.clear = function () {
    this.children = [];
    this.render();
  };
  return TreeContainer;
}
