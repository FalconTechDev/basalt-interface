// Helpers that map a DOM selection inside a pdf.js text layer back to
// (textDivIndex, charOffset) pairs used by the #page&selection= link format.

// Offset of `node` within `root`'s text content, in characters.
export function s11TextLayerOffset(root, node, offset) {
  if (!root.contains(node)) return null;
  let count = offset;
  const walker = root.doc.createNodeIterator(root, NodeFilter.SHOW_TEXT);
  let current;
  while ((current = walker.nextNode()) && current !== node) count += current.textContent.length;
  return count;
}

// Nearest ancestor (or self) of `node` that is a .textLayerNode inside `root`.
export function s11TextLayerNode(root, node) {
  if (!root.contains(node)) return null;
  if (node.instanceOf(HTMLElement) && node.hasClass("textLayerNode")) return node;
  let current = node;
  while ((current = current.parentNode)) {
    if (current === root) return null;
    if (current.instanceOf(HTMLElement) && current.hasClass("textLayerNode")) return current;
  }
  return null;
}
