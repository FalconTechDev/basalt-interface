// s91 live-preview formatting helpers: range guards for tables/code blocks,
// per-line formatting bounds and the mark-span math used by the formatting
// commands. All syntax-tree access goes through the host table.

// Class names that mark a line as carrying list/quote/header formatting.
const s91FormatLineClasses = [
  "hmd-list-indent",
  "formatting-quote",
  "formatting-list",
  "formatting-task",
  "formatting-header",
];

// Space-separated class list of a syntax node as a Set.
function s91NodeClassSet(node, prop) {
  const raw = node.type.prop(prop);
  return new Set((raw ?? "").split(" "));
}

// True when the range touches a table or fenced code block (formatting is
// suppressed there). `host`: livePreviewSyntaxClasses, cmSyntaxTree.
export function s91FormatSkips(state, range, host) {
  let blocked = false;
  host.cmSyntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      const classes = s91NodeClassSet(node, host.livePreviewSyntaxClasses);
      if (classes.has("HyperMD-table-2") || classes.has("HyperMD-codeblock")) {
        blocked = true;
        return false;
      }
    },
  });
  return blocked;
}

// Bounds of the formattable part of one line: the line extended left over any
// list/quote/header marker nodes, then whitespace-trimmed.
// `host`: cmSyntaxTree, cmSyntaxPropClasses, cmFormatSpan.
export function s91FormatLineRange(state, lineNo, host) {
  const line = state.doc.line(lineNo);
  let from = line.from;
  const to = line.to;
  host.cmSyntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      const classes = s91NodeClassSet(node, host.cmSyntaxPropClasses);
      if (s91FormatLineClasses.some((c) => classes.has(c))) {
        from = Math.min(line.to, node.to);
      }
    },
  });
  return host.cmFormatSpan(state, { from, to });
}

// Edits that strip the marker characters of every `kind` mark inside range.
// `host`: s91FormatMarks, cmSyntaxTree, cmSyntaxPropClasses.
export function s91FormatRemoveMarks(state, range, kind, host) {
  const mark = host.s91FormatMarks[kind];
  const edits = [];
  host.cmSyntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      const classes = s91NodeClassSet(node, host.cmSyntaxPropClasses);
      if (classes.has("formatting") && classes.has(mark.nodeType)) {
        const span = s91FormatInnerMark(state, node.from, mark);
        if (span) edits.push({ ...span, insert: "" });
      }
    },
  });
  return edits;
}

// Marker characters of `mark` adjacent to `pos`; dir -1 looks before pos,
// anything else looks after it. Tries the primary then alternate chars.
export function s91FormatInnerMark(state, pos, mark, dir = 1) {
  const candidates = [mark.surroundingChars];
  if (mark.altSurroundingChars) candidates.push(mark.altSurroundingChars);
  for (const text of candidates) {
    let from = pos;
    let to = pos;
    if (dir === -1) from -= text.length;
    else to += text.length;
    if (state.sliceDoc(from, to) === text) return { from, to };
  }
  return null;
}

// Expands `range` across sibling nodes of the same mark type so toggling a
// mark covers the whole run (e.g. `**a** b **c**`). `cursor` is a syntax-tree
// cursor positioned by the caller; `kindIndex` selects the mark in s91FormatMarks.
// `host`: s91FormatMarks, cmSyntaxPropClasses, cmFormatSeek.
export function s91FormatNodeRange(state, cursor, range, kindIndex, host) {
  const mark = host.s91FormatMarks[kindIndex];
  const isMarkNode = () => {
    const raw = cursor.node.type.prop(host.cmSyntaxPropClasses);
    return (raw ?? "").split(" ").includes(mark.nodeType);
  };
  let from = range.from;
  let to = range.to;
  let edge = cursor.from;
  host.cmFormatSeek(cursor, range.from);
  for (let more = true; more && !(cursor.to < edge);) {
    if (s91FormatInnerMark(state, cursor.from, mark)) from = cursor.from;
    if (!isMarkNode()) break;
    edge = cursor.from;
    more = cursor.prevSibling();
  }
  host.cmFormatSeek(cursor, range.to);
  to = cursor.to;
  edge = cursor.to;
  for (let more = true; more && !(cursor.from > edge);) {
    if (cursor.from > from && s91FormatInnerMark(state, cursor.to, mark, -1)) {
      to = cursor.to;
      break;
    }
    if (!isMarkNode()) break;
    to = cursor.to;
    edge = cursor.to;
    more = cursor.nextSibling();
  }
  return { from, to };
}
