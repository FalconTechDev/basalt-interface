// g13: clean-room markdown file-cache record builder and `file#subpath` region
// extractor. s05ParseCache turns note text into the metadata-cache record
// (frontmatter, headings, links, embeds, tags, footnotes, list items, blocks,
// sections); s05ExtractSubpath slices the editable region a `#subpath` link
// refers to. Both are pure functions over the host markdown tree (env().Kx).

import { env } from "./env.js";
import { s05Range, s05InlineText, s05FrontmatterLinks } from "./s05-utils.js";

// Section type names kept stable for consumers; unknown node types degrade to
// "unknown" so sections always carry a string type.
const NG13_SECTION_TYPES = {
  paragraph: "paragraph",
  heading: "heading",
  code: "code",
  math: "math",
  blockquote: "blockquote",
  callout: "callout",
  list: "list",
  thematicBreak: "thematicBreak",
  html: "html",
  table: "table",
  definition: "definition",
  footnoteDefinition: "footnoteDefinition",
  yaml: "yaml",
  comment: "comment",
  text: "text",
  element: "element",
};

function ng13Slice(text, position) {
  if (!position) return undefined;
  const start = position.start && position.start.offset;
  const end = position.end && position.end.offset;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  return text.substring(start, end);
}

function ng13PointRange(position) {
  return position ? s05Range(position) : undefined;
}

// A fnRef node carries data.hProperties.contentPosition when it resolves to
// inline footnote content; plain [^id] refs do not.
function ng13FnRefContentPosition(node) {
  const props = node.data && node.data.hProperties;
  const pos = props && props.contentPosition;
  return pos && pos.start && pos.end ? pos : null;
}

// A synthetic list item is parser scaffolding for footnote content. Items with
// data.isInline hold inline-footnote bodies (their children are still walked);
// the rest prune their whole subtree so footnote bodies are not double-counted.
function ng13IsPrunedSynthetic(item) {
  return !!(item.synthetic && !(item.data && item.data.isInline === true));
}

/**
 * Parse markdown text into the file-cache record.
 * @param {string} markdownText
 * @param {boolean} [stripOriginal] omit `original` slices and `sections`
 */
export function s05ParseCache(markdownText, stripOriginal) {
  const text = String(markdownText == null ? "" : markdownText);
  const record = {};
  const links = [];
  const embeds = [];
  const tags = [];
  const headings = [];
  const footnotes = [];
  const footnoteRefs = [];
  const referenceLinks = [];
  const listItems = [];
  const blocks = {};
  const sections = [];

  const registerBlock = (id, position) => {
    if (typeof id !== "string" || id.length === 0) return;
    blocks[id.toLowerCase()] = { position, id };
  };

  const tree = (() => {
    try {
      return env().Kx(text);
    } catch (e) {
      return null;
    }
  })();
  const rootChildren = tree && Array.isArray(tree.children) ? tree.children : [];

  // Frontmatter: only a leading yaml block that parses to an object counts.
  const first = rootChildren[0];
  if (first && first.type === "yaml") {
    let fm = null;
    try {
      fm = env().$x(tree);
    } catch (e) {
      fm = null;
    }
    if (fm && typeof fm === "object") {
      record.frontmatter = fm;
      record.frontmatterPosition = ng13PointRange(first.position);
      record.frontmatterLinks = s05FrontmatterLinks(fm);
    }
  }

  // Sections: one entry per top-level node, in document order.
  for (const node of rootChildren) {
    if (!node || !node.position) continue;
    const section = { type: NG13_SECTION_TYPES[node.type] || "unknown", position: ng13PointRange(node.position) };
    if (typeof node.id === "string" && node.id.length > 0) {
      section.id = node.id;
      registerBlock(node.id, section.position);
    }
    sections.push(section);
  }

  // listItems parent encoding: parent >= 0 is the 0-based start line of the
  // enclosing list item; parent < 0 is minus the 0-based start line of a
  // top-level parent list (with -1 standing in for line 0).
  const listParentOf = new Map(); // list node -> enclosing listItem node

  const collectLinkLike = (node, out) => {
    const entry = {
      position: ng13PointRange(node.position),
      link: node.href || "",
      displayText: node.title || "",
    };
    if (!entry.displayText && node.converted) {
      entry.displayText = s05InlineText(node);
    }
    if (!stripOriginal) {
      entry.original = ng13Slice(text, node.position) || "";
    }
    out.push(entry);
  };

  const visitItem = (listNode, itemNode) => {
    const position = itemNode.position;
    let end = position && position.end;
    const children = Array.isArray(itemNode.children) ? itemNode.children : [];
    let trailing = 0;
    if (children.length > 1) {
      let b = children.length;
      while (b > 0) {
        const child = children[b - 1];
        if (child && child.type !== "list") {
          end = child.position && child.position.end ? child.position.end : end;
          break;
        }
        trailing++;
        b--;
      }
    }
    const enclosing = listParentOf.get(listNode);
    let parent;
    if (enclosing && enclosing.position) {
      // 0-based start line of the enclosing item (raw mdast lines are 1-based)
      parent = enclosing.position.start.line - 1;
    } else if (listNode && listNode.position) {
      // minus the 0-based start line of a top-level parent list; line 0 -> -1
      parent = -(listNode.position.start.line - 1);
      if (parent === 0) parent = -1;
    } else {
      parent = -1;
    }
    for (let k = 0; k < trailing; k++) {
      const child = children[children.length - 1 - k];
      if (child && child.type === "list") listParentOf.set(child, itemNode);
    }
    // mdast points are 1-based line/column; cache points are 0-based line/col
    const toCachePoint = (p) => (p ? { line: p.line - 1, col: p.column - 1, offset: p.offset } : { line: 0, col: 0, offset: 0 });
    const item = {
      position: {
        start: toCachePoint(position && position.start),
        end: toCachePoint(end || (position && position.end)),
      },
      parent,
    };
    if (itemNode.checklist !== null && itemNode.checklist !== undefined) {
      item.task = String(itemNode.checklist);
    }
    if (typeof itemNode.id === "string" && itemNode.id.length > 0) {
      item.id = itemNode.id;
      registerBlock(itemNode.id, item.position);
    }
    listItems.push(item);
    for (const child of children) walk(child, "listItem");
  };

  const walk = (node, parentType) => {
    if (!node || typeof node !== "object") return;
    const type = node.type;
    switch (type) {
      case "fnRef": {
        const contentPos = ng13FnRefContentPosition(node);
        const id = node.identifier || "";
        if (contentPos) {
          footnotes.push({ position: s05Range(contentPos), id });
        } else {
          footnoteRefs.push({ position: ng13PointRange(node.position), id });
        }
        break;
      }
      case "footnoteDefinition":
        footnotes.push({ position: ng13PointRange(node.position), id: node.identifier || "" });
        break;
      case "definition":
        if (node.url) {
          referenceLinks.push({
            position: ng13PointRange(node.position),
            id: node.label || node.identifier || "",
            link: node.url,
          });
        }
        break;
      case "heading":
        if (parentType === "root") {
          headings.push({
            position: ng13PointRange(node.position),
            heading: s05InlineText(node).replace(/\n+$/, ""),
            level: node.depth || 1,
          });
        }
        break;
      case "ilink":
        collectLinkLike(node, links);
        break;
      case "iembed":
        collectLinkLike(node, embeds);
        break;
      case "tag":
        tags.push({ position: ng13PointRange(node.position), tag: node.tag || "" });
        break;
      case "listItem":
        if (ng13IsPrunedSynthetic(node)) return;
        if (parentType === "list") {
          // handled through visitItem by the list parent
          break;
        }
        break;
      default:
        break;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    if (type === "list") {
      for (const child of children) {
        if (child && child.type === "listItem" && !child.synthetic) {
          visitItem(node, child);
        } else {
          walk(child, "list");
        }
      }
      return;
    }
    for (const child of children) walk(child, type);
  };

  for (const node of rootChildren) walk(node, "root");

  if (!stripOriginal && sections.length) record.sections = sections;
  if (links.length) record.links = links;
  if (embeds.length) record.embeds = embeds;
  if (tags.length) record.tags = tags;
  if (headings.length) record.headings = headings;
  if (footnotes.length) record.footnotes = footnotes;
  if (footnoteRefs.length) record.footnoteRefs = footnoteRefs;
  if (referenceLinks.length) record.referenceLinks = referenceLinks;
  if (listItems.length) record.listItems = listItems;
  if (Object.keys(blocks).length) record.blocks = blocks;
  return record;
}

// ---------------------------------------------------------------------------
// s05ExtractSubpath
// ---------------------------------------------------------------------------

const NG13_FOOTNOTE_DEF = /^\[\^[^\]]+\]:\s*/;
const NG13_TAB_WIDTH = 4;

// Visual width of a line's leading whitespace; tabs count as NG13_TAB_WIDTH.
function ng13IndentWidth(line) {
  let width = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") width += 1;
    else if (ch === "\t") width += NG13_TAB_WIDTH;
    else break;
  }
  return width;
}

// Remove up to `width` columns of leading whitespace per line; a tab counts
// NG13_TAB_WIDTH columns and is consumed whole.
function ng13Dedent(text, width) {
  if (!width) return text;
  return text.split("\n").map((line) => {
    let col = 0;
    let i = 0;
    while (i < line.length && col < width) {
      const ch = line[i];
      if (ch === " ") { col += 1; i += 1; }
      else if (ch === "\t") { col += NG13_TAB_WIDTH; i += 1; }
      else break;
    }
    return line.substring(i);
  }).join("\n");
}

function ng13LeadingWhitespace(line) {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return line.substring(0, i);
}

// Block/list subpath: region runs from the start of the referenced item's
// line to the end of the deepest following item whose parent chain stays
// inside the seen set; the text is de-indented by the first line's indent.
function ng13ExtractListSection(text, cache, section) {
  const start = section.start || {};
  const startOffset = typeof start.offset === "number" ? start.offset : 0;
  const col = typeof start.col === "number" ? start.col : 0;
  const regionStart = Math.max(0, Math.min(startOffset - col, text.length));

  const items = Array.isArray(cache && cache.listItems) ? cache.listItems : [];
  let index = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i] === section.list) { index = i; break; }
  }
  if (index === -1) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const sp = it && it.position && it.position.start;
      const bp = section.block && section.block.position && section.block.position.start;
      if (sp && bp && sp.line === bp.line && sp.offset === bp.offset) { index = i; break; }
    }
  }

  let endOffset = text.length;
  if (index !== -1) {
    const seen = new Set();
    seen.add(items[index].position && items[index].position.start ? items[index].position.start.line : -2);
    let last = items[index];
    for (let i = index + 1; i < items.length; i++) {
      const item = items[i];
      const pos = item && item.position;
      if (!pos || !pos.start) break;
      const parent = item.parent;
      let inside = false;
      if (typeof parent === "number" && parent >= 0) {
        inside = seen.has(parent);
      }
      if (!inside) break;
      seen.add(pos.start.line);
      last = item;
    }
    const endPos = last && last.position && last.position.end;
    if (endPos && typeof endPos.offset === "number") endOffset = endPos.offset;
  }

  const raw = text.substring(regionStart, endOffset);
  const firstLine = raw.split("\n", 1)[0];
  const indentStr = ng13LeadingWhitespace(firstLine);
  const width = ng13IndentWidth(firstLine);
  const content = ng13Dedent(raw, width);
  return {
    before: text.substring(0, regionStart),
    after: text.substring(endOffset),
    indent: indentStr,
    heading: "",
    content,
  };
}

/**
 * Extract the editable region referenced by `file#subpath`.
 * @param {string} text full note text
 * @param {object} cache file-cache record (from s05ParseCache)
 * @param {object} section resolved subpath ({type, start, end, list?, ...})
 * @param {boolean} [editable]
 */
export function s05ExtractSubpath(text, cache, section, editable) {
  const source = String(text == null ? "" : text);
  const out = { before: "", after: "", indent: "", heading: "", content: source };
  if (!section || typeof section !== "object") return out;

  if (section.type === "block" && section.list) {
    return ng13ExtractListSection(source, cache, section);
  }

  const start = section.start;
  const end = section.end;
  const startOffset = start && typeof start.offset === "number" ? start.offset : 0;
  const endOffset = end && typeof end.offset === "number" ? end.offset : source.length;
  const regionStart = Math.min(startOffset, source.length);
  const regionEnd = Math.min(Math.max(endOffset, regionStart), source.length);

  out.before = source.substring(0, regionStart);
  out.after = source.substring(regionEnd);

  if (section.type === "heading" && editable) {
    const lineEnd = source.indexOf("\n", regionStart);
    const headingEnd = lineEnd === -1 ? regionEnd : Math.min(lineEnd + 1, regionEnd);
    out.heading = source.substring(regionStart, headingEnd);
    out.content = source.substring(headingEnd, regionEnd);
    return out;
  }

  out.content = source.substring(regionStart, regionEnd);

  if (section.type === "footnote") {
    const marker = out.content.match(NG13_FOOTNOTE_DEF);
    if (marker) {
      out.before += marker[0];
      out.content = out.content.substring(marker[0].length);
    }
    out.content = out.content.replace(/\n(?: {4}|\t)/g, "\n");
  }

  return out;
}
