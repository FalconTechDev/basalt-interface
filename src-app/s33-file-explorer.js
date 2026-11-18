// File-explorer DOM factories (C8/M8): cached "tree-item" prototypes for nav files and
// folders. Each call returns a fresh clone of a lazily built prototype element, matching
// the memoised-clone behaviour the tree items rely on.
//
// Also home to the view-type and locale aliases used by the file explorer (x8/w8/A8).

/** Builds `build()` once, then hands out clones (the bundle's Sg helper semantics). */
const s33LazyClone = (build) => {
  let proto = null;
  let make = build;
  return () => {
    if (!proto) {
      proto = make();
      make = null;
    }
    return proto.cloneNode(true);
  };
};

/** Prototype factory for a "nav-file" tree item element. */
export const s33NavFileEl = s33LazyClone(() => {
  const el = createDiv("tree-item nav-file");
  el.createDiv("tree-item-self nav-file-title tappable is-clickable").createDiv("tree-item-inner nav-file-title-content");
  return el;
});

/** Prototype factory for a "nav-folder" tree item element (title + children container). */
export const s33NavFolderEl = s33LazyClone(() => {
  const el = createDiv("tree-item nav-folder");
  el.createDiv("tree-item-self nav-folder-title is-clickable").createDiv("tree-item-inner nav-folder-title-content");
  el.createDiv("tree-item-children nav-folder-children");
  return el;
});
