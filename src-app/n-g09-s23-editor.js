// ng09-s23-editor: clean-room reimplementation of the s23 editor extension
// values — the in-document find/replace bar (was class `gj`), the table-sync
// and ordered-list renumber transaction filters (was entries `wq`/`Mq`), the
// list-marker / inside-code probes (was `Sq`/`xq`), the hanging-indent
// decoration view plugin (was `Tq`/`Dq`), the wrap-pair input handler (was
// `fj`), and the search-match highlight constants (was `Eq`/`dj`/`aj`/`mj`).
//
// Clean-room: observable behaviour per specs/g09.md section 3.4; all app
// internals are reached lazily through `host.*` (manifest host getters) or
// `env()` (manifest envBind) so late-bound bundle values stay correct.
//
// Export naming: manifest `use` values are expected to point at the ng09*
// names below (entries append `__basaltHost` as the last argument, classes
// and declarators are invoked as `__basaltOwn.<name>(__basaltHost)`).
import { inherit, methods } from "./inherit.js";
import { env } from "./env.js";
import { s08SearchBarBase } from "./s08-values.js";

// DECISIONS:
// - Export names are ng09*-prefixed; manifest `use`/`expr` values for the s23
//   items must be repointed at them (entries append `__basaltHost`, so the
//   host-injected signatures below take `host` as the LAST parameter:
//   ng09TableSync(editor, field, host), ng09ListRenumber(editor, host),
//   ng09ListMarker(text, host), ng09InsideCode(tree, from, to, host);
//   classes/declarators are factories `(host) => value`).
// - ng09ListMarker returns the whole listLinePattern match (quote prefix +
//   marker + task box, group 0) and only when group 2 (the marker) exists —
//   this makes `line.from + marker.length` span the full prefix for the
//   inside-code probe and gives the correct hanging-indent width.
// - Transaction filters are `host.cmState.transactionFilter.of((tr) => ...)`
//   single-argument form (same shape as s40-fold-indent.js); `tr.state` is the
//   post-change state, `tr.startState` the pre-change one. Composing is read
//   off `editor.cm.composing` (the component's CM6 view).
// - Table widget starts are recovered from the live-preview decoration field's
//   RangeSet by digging `decoration.type.spec.widget` (fallbacks: `.spec`,
//   `.widget`) and `instanceof host.tableWidget`.
// - TableSync path A (single-char delete.backward at a widget boundary)
//   returns a replacement Transaction built on `tr.startState`; on Android the
//   insert also consumes one extra char (spec: "peels one extra char" — exact
//   side is uncertain, chose the char at the insertion point).
// - TableSync path B maps old-doc widget starts through `tr.changes.mapPos(s,-1)`
//   and inserts "\n" only when non-blank content precedes the start on the
//   same line and the position is not the frontmatter end.
// - ListRenumber treats "edited" lines (intersecting changed ranges) as
//   keeping their typed number; untouched continuations increment from the
//   previous same-key ordered item found by the upward scan (one blank line
//   allowed, stops at breakPattern / non-list / shallower depth). Change
//   ranges cover digits + suffix punctuation; insert is `num + suffix`.
// - Ordered detection derives digits/suffix from the marker text itself
//   (`/^(\d+)([.)]?)/`) rather than fixed group indexes, so it is robust to
//   the exact listLinePattern grouping.
// - s23ListIndentClass is a constructor function (matches the inherited
//   `new Tq(view)` usage) with static `clearCache` (s10StateEffect) AND static
//   `of()` delegating to it, because `host.cmClearCacheEffect` IS `Tq` and is
//   dispatched as `Tq.of()`.
// - Character width uses `view.defaultCharacterWidth` (fallback 8px); the DOM
//   measurement pass uses `coordsAtPos` minus the line's padding edge,
//   direction-aware via computed style, with a >50%-width re-measure.
// - s23WrapPairInput returns `{value:false}`/`{value:true}` per spec (not a
//   bare boolean); length-2 input is rejected when the first code point is not
//   exactly 1 UTF-16 unit.
// - s23EditorSearchBar extends s08SearchBarBase (imported from s08-values.js);
//   findNext/findPrevious results are normalized (object result used as-is,
//   truthy non-object falls back to cursor.from/to or cursor.current()) because
//   the SearchCursor return shape is not pinned by the spec.
// - `env().debounce` used for the 20 ms count debounce (envBind `debounce:wc`);
//   all other values via `host.*`.
// - UNRESOLVED: exact widget-spec access path inside decoration RangeSets,
//   the Android "peel one extra char" side, SearchCursor result shape,
//   s23RangeSetBuilder concrete API (assumed `new B()` + add/finish), and
//   whether CM6 inputHandler accepts `{value}` returns in this bundle.

// ---------------------------------------------------------------------------
// constants (manifest declarators, no host)
// ---------------------------------------------------------------------------

/** Block-quote / ATX heading / horizontal rule / code fence at line start (was Eq). */
export const ng09BreakPattern = /^\s*(?:> |#{1,6} |([-_*])(\s*\1){2,}\s*$|~~~|```)/;

/** Characters that trigger wrap-pair input handling (was dj). */
export const ng09WrapPairChars = ["=", "~", "$", "%"];

/** CSS class of the in-document search match highlight (was mj). */
export const ng09SearchMatchClass = "basalt-search-match-highlight";

// ---------------------------------------------------------------------------
// small shared helpers
// ---------------------------------------------------------------------------

function ng09NumCompare(a, b) { return a - b; }

/** Code point at `index` (handles surrogate pairs). */
function ng09CodePointAt(text, index) {
  const c = text.charCodeAt(index);
  if (c >= 0xd800 && c <= 0xdbff && index + 1 < text.length) {
    const c2 = text.charCodeAt(index + 1);
    if (c2 >= 0xdc00 && c2 <= 0xdfff) return (c - 0xd800) * 0x400 + (c2 - 0xdc00) + 0x10000;
  }
  return c;
}

/** UTF-16 length of a code point (1 for BMP, 2 for astral). */
function ng09Utf16Size(cp) { return cp < 0x10000 ? 1 : 2; }

/** Visual column width of `text` prefix, tabs expanded (was countColumn helper). */
function ng09CountCols(text, tabSize) {
  let col = 0;
  for (const ch of text) {
    if (ch === "\t") col += tabSize - (col % tabSize);
    else col += 1;
  }
  return col;
}

/** True when any transaction carries an effect of `type`. */
function ng09HasEffect(transactions, type) {
  return transactions.some((tr) => tr.effects.some((ef) => ef.is(type)));
}

/** Normalized annotation type of a possibly-instance annotation value. */
function ng09AnnotationType(ann) {
  return ann && ann.type ? ann.type : ann;
}

/** Annotation instance for transaction specs (`of` when it is a type). */
function ng09AnnotationValue(ann, value) {
  if (ann && typeof ann.of === "function") return ann.of(value);
  return ann;
}

/** Transaction carries the table-update annotation (either form). */
function ng09HasTableAnnotation(tr, host) {
  if (!host.tableUpdateAnnotation || !tr.annotation) return false;
  const type = ng09AnnotationType(host.tableUpdateAnnotation);
  try { return tr.annotation(type) != null; } catch (e) { return false; }
}

/** The component's CM6 view, when the "editor" argument exposes one. */
function ng09EditorView(editor) {
  return editor && editor.cm ? editor.cm : (editor && editor.state ? editor : null);
}

/** Lazy syntax tree of a state (null when unavailable). */
function ng09SyntaxTreeOf(state, host) {
  try {
    const tp = host.cmSyntaxTree;
    return tp ? tp(state) : null;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// probes (was Sq / xq)
// ---------------------------------------------------------------------------

/**
 * Leading list marker of a line via `host.listLinePattern` (was Sq).
 * Returns the whole matched prefix (quote run + marker + task box) or null
 * when the line has no list marker.
 */
export function ng09ListMarker(text, host) {
  const m = text.match(host.listLinePattern);
  if (!m || !m[0]) return null;
  // group 2 is the list marker itself; quote-only prefixes are not markers
  if (!m[2]) return null;
  return m[0];
}

/**
 * True when any syntax node overlapping [from, to) carries a live-preview
 * class containing `HyperMD-codeblock` or CM prop classes containing
 * `hmd-indented-code` (was xq).
 */
export function ng09InsideCode(tree, from, to, host) {
  if (!tree || typeof tree.iterate !== "function") return false;
  let inside = false;
  tree.iterate({
    from, to,
    enter(node) {
      if (inside) return false;
      const t = node.type;
      if (!t || typeof t.prop !== "function") return undefined;
      const a = host.livePreviewSyntaxClasses ? t.prop(host.livePreviewSyntaxClasses) : null;
      if (a && String(a).indexOf("HyperMD-codeblock") >= 0) { inside = true; return false; }
      const b = host.cmSyntaxPropClasses ? t.prop(host.cmSyntaxPropClasses) : null;
      if (b && String(b).indexOf("hmd-indented-code") >= 0) { inside = true; return false; }
      return undefined;
    },
  });
  return inside;
}

// ---------------------------------------------------------------------------
// table sync filter (was wq)
// ---------------------------------------------------------------------------

/**
 * Extract the widget object from a decoration value stored in the
 * live-preview decoration field's RangeSet (widget/replace decorations keep
 * their spec on `type.spec`, with a few fallbacks).
 */
function ng09DecoWidget(d) {
  if (!d || typeof d !== "object") return null;
  const t = d.type;
  const s = (t && t.spec) || d.spec || null;
  if (s && s.widget) return s.widget;
  if (d.widget) return d.widget;
  if (t && t.widget) return t.widget;
  return null;
}

/** Start offsets of every table widget decoration in `state`'s field value. */
function ng09TableWidgetStarts(state, field, host, from, to) {
  const starts = [];
  if (!field) return starts;
  let rs = null;
  try { rs = state.field(field); } catch (e) { return starts; }
  if (!rs || typeof rs.between !== "function") return starts;
  const lo = from == null ? 0 : from;
  const hi = to == null ? state.doc.length : to;
  rs.between(lo, hi, (f, t, spec) => {
    const w = ng09DecoWidget(spec);
    if (w && host.tableWidget && w instanceof host.tableWidget) starts.push(f);
  });
  return starts;
}

/** Ordered-list parse of one line: marker groups via host.listLinePattern. */
function ng09ParseListLine(text, host, tabSize) {
  const m = text.match(host.listLinePattern);
  if (!m || !m[0] || !m[2]) return null;
  const prefix = m[1] || "";
  const marker = m[2];
  const dm = /^(\d+)([.)]?)/.exec(marker);
  if (!dm) return null; // bullet / task-only marker: not ordered
  const quoteDepth = (prefix.match(/>/g) || []).length;
  const indentCols = ng09CountCols(prefix.replace(/>/g, ""), tabSize || 4);
  return {
    prefix, marker, quoteDepth, indentCols,
    digits: dm[1],
    num: parseInt(dm[1], 10),
    // offsets relative to line start
    numFrom: prefix.length,
    // punctuation right after the digits ("." or ")"), may be empty
    suffix: marker.slice(dm[1].length).replace(/\s+$/, ""),
    suffixLen: marker.slice(dm[1].length).replace(/\s+$/, "").length,
    ordered: true,
  };
}

/** Same list-block key: quote depth + visual indent of the quote/space prefix. */
function ng09ListKey(info) {
  return info.quoteDepth + ":" + info.indentCols;
}

/**
 * Table-sync transaction filter (was wq -> s23TableSync).
 * Keeps wrapped table rows on their own lines: a backspace that would glue a
 * table widget onto the preceding line is turned into a newline insert, and
 * any other edit that leaves a widget start glued to non-blank line content
 * gets a follow-up "\n" insertion.
 */
export function ng09TableSync(editor, field, host) {
  return host.cmState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    if (editor && editor.tableCell) return tr;
    if (tr.isUserEvent && tr.isUserEvent("set")) return tr;
    if (ng09HasTableAnnotation(tr, host)) return tr;
    const view = ng09EditorView(editor);
    if (view && view.composing) return tr;

    const annType = host.tableUpdateAnnotation;
    const ann = ng09AnnotationValue(annType, true);

    // -- path A: single-char delete.backward at a table-widget boundary ------
    const ranges = [];
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      ranges.push({ fromA, toA, fromB, toB });
    });
    if (tr.isUserEvent && tr.isUserEvent("delete.backward") && ranges.length === 1) {
      const c = ranges[0];
      if (c.toA - c.fromA === 1 && c.fromB === c.fromA) {
        const oldDoc = tr.startState.doc;
        const starts = ng09TableWidgetStarts(tr.startState, field, host, c.fromA - 1, c.toA + 1);
        for (const ws of starts) {
          if (ws !== c.toA) continue; // widget must start right after the deleted char
          // the line content before the widget start must be non-blank
          const wl = oldDoc.lineAt(Math.min(ws, oldDoc.length));
          let nonBlank = false;
          if (ws > wl.from) nonBlank = oldDoc.sliceString(wl.from, ws).trim() !== "";
          else if (wl.number > 1) nonBlank = oldDoc.line(wl.number - 1).text.trim() !== "";
          if (!nonBlank) continue;
          const isAndroid = !!(host.Platform && host.Platform.isAndroidApp);
          // instead of deleting: insert "\n" at the deletion point; on Android
          // one extra char is peeled (the char now at the insertion point).
          const spec = {
            changes: isAndroid
              ? { from: c.fromB, to: Math.min(c.fromB + 1, tr.state.doc.length), insert: "\n" }
              : { from: c.fromB, to: c.fromB, insert: "\n" },
            selection: host.cmSelection.cursor(c.fromB),
            annotations: ann ? [ann] : undefined,
            userEvent: "delete.backward",
            scrollIntoView: true,
          };
          return tr.startState.update(spec);
        }
      }
    }

    // -- path B: keep every widget start on its own line --------------------
    const oldStarts = ng09TableWidgetStarts(tr.startState, field, host, 0, tr.startState.doc.length);
    if (!oldStarts.length) return tr;
    const newDoc = tr.state.doc;
    const fe = host.s23FrontmatterEnd ? host.s23FrontmatterEnd(newDoc) : -1;
    const positions = [];
    const seen = new Set();
    for (const s of oldStarts) {
      let p;
      try { p = tr.changes.mapPos(s, -1); } catch (e) { continue; }
      if (p <= 0 || p > newDoc.length || seen.has(p)) continue;
      if (fe >= 0 && p === fe) continue;
      const line = newDoc.lineAt(p);
      // only when real (non-blank) content precedes the widget on its line
      if (newDoc.sliceString(line.from, p).trim() === "") continue;
      seen.add(p);
      positions.push(p);
    }
    if (!positions.length) return tr;
    positions.sort(ng09NumCompare);
    const changes = positions.map((p) => ({ from: p, to: p, insert: "\n" }));
    return [tr, {
      changes,
      sequential: true,
      annotations: ann ? [ann] : undefined,
    }];
  });
}

// ---------------------------------------------------------------------------
// ordered-list renumber filter (was Mq)
// ---------------------------------------------------------------------------

/** Scan upward from `lineNo - 1` for the previous same-key ordered item. */
function ng09PrevOrdered(doc, lineNo, info0, tabSize, host) {
  const key = ng09ListKey(info0);
  let blanks = 0;
  for (let n = lineNo - 1; n >= 1; n--) {
    const l = doc.line(n);
    const text = l.text;
    if (text.trim() === "") {
      if (++blanks > 1) return null; // at most one blank line is skipped
      continue;
    }
    blanks = 0;
    if (ng09BreakPattern.test(text)) return null;
    const info = ng09ParseListLine(text, host, tabSize);
    if (!info) return null; // non-list content stops the scan
    // shallower quote depth or indent stops the scan
    if (info.quoteDepth < info0.quoteDepth ||
        (info.quoteDepth === info0.quoteDepth && info.indentCols < info0.indentCols)) {
      return null;
    }
    if (info.ordered && ng09ListKey(info) === key) return { num: info.num, line: n };
    // deeper or sibling bullet items: keep scanning upward
  }
  return null;
}

/**
 * Ordered-list renumber transaction filter (was Mq -> s23ListRenumber).
 * After doc edits, contiguous runs of same-indent/same-quote-depth ordered
 * items are renumbered sequentially; only differing numbers produce changes.
 */
export function ng09ListRenumber(editor, host) {
  return host.cmState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    if (editor && editor.tableCell) return tr;
    if (tr.isUserEvent && tr.isUserEvent("set")) return tr;
    if (tr.isUserEvent && tr.isUserEvent("input.renumber")) return tr;
    if (ng09HasTableAnnotation(tr, host)) return tr;
    const view = ng09EditorView(editor);
    if (view && view.composing) return tr;

    const state = tr.state;
    const doc = state.doc;
    const tabSize = state.tabSize || 4;

    // new-doc line numbers touched by the change
    const touched = new Set();
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      const a = doc.lineAt(Math.max(0, Math.min(fromB, doc.length)));
      const b = doc.lineAt(Math.max(0, Math.min(Math.max(toB, fromB), doc.length)));
      for (let n = a.number; n <= b.number; n++) touched.add(n);
    });
    if (!touched.size) return tr;

    const tree = ng09SyntaxTreeOf(state, host);

    // gather ordered items per line once
    const items = new Map(); // lineNo -> parse info
    const orderedAt = (n) => {
      if (items.has(n)) return items.get(n);
      const l = doc.line(n);
      let info = null;
      if (l.text.trim() !== "" && !ng09BreakPattern.test(l.text)) {
        const p = ng09ParseListLine(l.text, host, tabSize);
        if (p && p.ordered) {
          // skip items inside code blocks / indented code
          if (!(tree && ng09InsideCode(tree, l.from, l.from + p.prefix.length + p.digits.length, host))) {
            info = p;
          }
        }
      }
      items.set(n, info);
      return info;
    };

    const changes = [];
    const doneRuns = new Set();

    for (const startNo of touched) {
      const first = orderedAt(startNo);
      if (!first) continue;
      const key = ng09ListKey(first);
      // expand to the maximal run of consecutive same-key ordered lines
      let runStart = startNo;
      while (runStart > 1) {
        const up = orderedAt(runStart - 1);
        if (!up || ng09ListKey(up) !== key) break;
        runStart--;
      }
      let runEnd = startNo;
      while (runEnd < doc.lines) {
        const down = orderedAt(runEnd + 1);
        if (!down || ng09ListKey(down) !== key) break;
        runEnd++;
      }
      const runKey = runStart + ":" + runEnd;
      if (doneRuns.has(runKey)) continue;
      doneRuns.add(runKey);

      // does the run actually contain a touched ordered line?
      let hit = false;
      for (let n = runStart; n <= runEnd; n++) if (touched.has(n) && orderedAt(n)) { hit = true; break; }
      if (!hit) continue;

      // previous number above the run (scan allows one blank line)
      const runFirst = orderedAt(runStart);
      const prev = runFirst ? ng09PrevOrdered(doc, runStart, runFirst, tabSize, host) : null;

      let nextNum = null;
      for (let n = runStart; n <= runEnd; n++) {
        const info = orderedAt(n);
        if (!info || ng09ListKey(info) !== key) { nextNum = null; continue; }
        const line = doc.line(n);
        const cur = info.num;
        const isEdited = touched.has(n);
        // edited lines keep their typed number; untouched continuations
        // follow the previous item (or the old block's base at run start)
        const want = isEdited ? cur
          : nextNum != null ? nextNum
          : prev ? prev.num + 1
          : cur;
        if (want !== cur) {
          const from = line.from + info.numFrom;
          const to = line.from + info.numFrom + info.digits.length + info.suffixLen;
          changes.push({ from, to, insert: String(want) + info.suffix });
        }
        nextNum = want + 1;
      }
    }

    if (!changes.length) return tr;
    changes.sort((a, b) => a.from - b.from);
    const ann = ng09AnnotationValue(host.tableUpdateAnnotation, true);
    return [tr, {
      changes,
      sequential: true,
      userEvent: "input.renumber",
      annotations: ann ? [ann] : undefined,
    }];
  });
}

// ---------------------------------------------------------------------------
// hanging-indent decoration plugin (was Tq class + Dq plugin value)
// ---------------------------------------------------------------------------

let ng09IndentClass = null;

/** New RangeSet builder from the host binding (s23RangeSetBuilder). */
function ng09NewRangeSet(host) {
  if (typeof host.s23RangeSetBuilder === "function") return new host.s23RangeSetBuilder();
  return host.s23RangeSetBuilder;
}

function ng09FinishRangeSet(builder) {
  return builder && typeof builder.finish === "function" ? builder.finish() : builder;
}

/** Character width estimate for a view (falls back to a sane default). */
function ng09CharWidth(view) {
  const w = view && view.defaultCharacterWidth;
  return typeof w === "number" && w > 0 ? w : 8;
}

/**
 * The hanging-indent view-plugin class (was Tq). Per-view state:
 * `decorations`, `indentCache` (line -> {text,size,dirty}), `markCache`
 * (px size -> line decoration), a MutationObserver dirtying `.cm-line` cache
 * entries, and a scheduled `updateDom` measurement pass.
 *
 * The class doubles as the `cmClearCacheEffect` host value: it carries a
 * static `clearCache` StateEffect plus a static `of()` delegating to it, so
 * `host.cmClearCacheEffect.of()` works on the class itself.
 */
export function ng09ListIndentClass(host) {
  if (ng09IndentClass) return ng09IndentClass;

  function ListIndent(view) {
    this.view = view;
    this.decorations = host.cmDecoration.none;
    this.indentCache = new Map();   // lineNo -> {text, size, dirty}
    this.markCache = new Map();     // px size -> line decoration
    this.hadFocus = !!(view && view.hasFocus);
    const self = this;
    this.observer = (typeof MutationObserver === "function")
      ? new MutationObserver((records) => self.onMutate(records))
      : null;
    if (this.observer && view.contentDOM) {
      this.observer.observe(view.contentDOM, { subtree: true, childList: true, characterData: true });
    }
    this.buildDeco(view);
    if (typeof host.s23ScheduleFrame === "function") host.s23ScheduleFrame(() => self.updateDom());
  }

  methods(ListIndent, {
    update(tr) {
      const state = tr.state;
      const clear = ListIndent.clearCache && ng09HasEffect(tr.transactions || [tr], ListIndent.clearCache);
      const view = tr.view;
      const focused = !!(view && view.hasFocus);
      const focusChanged = focused !== this.hadFocus;
      this.hadFocus = focused;
      let treeChanged = false;
      try {
        treeChanged = host.cmSyntaxTree &&
          host.cmSyntaxTree(tr.startState) !== host.cmSyntaxTree(state);
      } catch (e) { treeChanged = false; }
      let selChanged = false;
      try { selChanged = !state.selection.eq(tr.startState.selection); } catch (e) { selChanged = !!tr.selectionSet; }
      if (tr.docChanged || tr.viewportChanged || tr.geometryChanged || selChanged ||
          focusChanged || treeChanged || clear) {
        if (clear) { this.indentCache.clear(); this.markCache.clear(); }
        this.buildDeco(view || this.view);
      }
    },

    onMutate(records) {
      const view = this.view;
      if (!view || !view.contentDOM) return;
      const dirtyLines = new Set();
      for (const rec of records) {
        const nodes = [];
        if (rec.target) nodes.push(rec.target);
        if (rec.addedNodes) for (const n of rec.addedNodes) nodes.push(n);
        if (rec.removedNodes) for (const n of rec.removedNodes) nodes.push(n);
        for (const node of nodes) {
          const el = node && (node.nodeType === 1 ? node : node.parentElement);
          const lineEl = el && el.closest ? el.closest(".cm-line") : null;
          if (!lineEl) continue;
          try {
            const pos = view.posAtDOM(lineEl);
            const ln = view.state.doc.lineAt(pos).number;
            const info = this.indentCache.get(ln);
            if (info) info.dirty = true;
            dirtyLines.add(ln);
          } catch (e) { /* posAtDOM may fail mid-mutation */ }
        }
      }
      if (dirtyLines.size && typeof host.s23ScheduleFrame === "function") {
        host.s23ScheduleFrame(() => this.updateDom());
      }
    },

    /** px width of the list-marker prefix of `line`, cached per line text. */
    markerSize(view, line, marker) {
      const text = line.text;
      const cached = this.indentCache.get(line.number);
      if (cached && cached.text === text && !cached.dirty) return cached.size;
      const size = Math.floor(ng09CountCols(marker, view.state.tabSize || 4) * ng09CharWidth(view));
      this.indentCache.set(line.number, { text, size, dirty: false });
      return size;
    },

    lineDeco(size) {
      let deco = this.markCache.get(size);
      if (!deco) {
        deco = host.cmDecoration.line({
          attributes: { style: "text-indent:-" + size + "px;padding-inline-start:" + size + "px" },
        });
        this.markCache.set(size, deco);
      }
      return deco;
    },

    buildDeco(view) {
      const state = view.state;
      const doc = state.doc;
      const builder = ng09NewRangeSet(host);
      const tree = ng09SyntaxTreeOf(state, host);
      for (const block of view.viewportLineBlocks) {
        const line = doc.lineAt(block.from);
        const marker = ng09ListMarker(line.text, host);
        if (!marker) { this.indentCache.delete(line.number); continue; }
        if (tree && ng09InsideCode(tree, line.from, line.from + marker.length, host)) {
          this.indentCache.delete(line.number);
          continue;
        }
        const size = this.markerSize(view, line, marker);
        builder.add(line.from, line.from, this.lineDeco(size));
      }
      // entries for lines outside the viewport stay cached: markerSize keys
      // them by line text so neighbours are reused on scroll.
      this.decorations = ng09FinishRangeSet(builder);
    },

    /** Measure pass: freeze scroll, take observer records, measure dirty
     * `.cm-line` marker ends, write styles directly, rebuild on size change. */
    updateDom() {
      const view = this.view;
      if (!view || !view.contentDOM || !view.contentDOM.isConnected) return;
      const scrollEl = view.scrollDOM;
      const savedTop = scrollEl ? scrollEl.scrollTop : 0;
      const records = this.observer ? this.observer.takeRecords() : [];
      const lineEls = new Set();
      for (const rec of records) {
        const nodes = [];
        if (rec.target) nodes.push(rec.target);
        if (rec.addedNodes) for (const n of rec.addedNodes) nodes.push(n);
        if (rec.removedNodes) for (const n of rec.removedNodes) nodes.push(n);
        for (const node of nodes) {
          const el = node && (node.nodeType === 1 ? node : node.parentElement);
          const lineEl = el && el.closest ? el.closest(".cm-line") : null;
          if (lineEl) lineEls.add(lineEl);
        }
      }
      let changed = false;
      const doc = view.state.doc;
      for (const el of lineEls) {
        let pos;
        try { pos = view.posAtDOM(el); } catch (e) { continue; }
        const line = doc.lineAt(pos);
        const marker = ng09ListMarker(line.text, host);
        if (!marker) { this.indentCache.delete(line.number); continue; }
        const size = this.measureMarker(view, el, line.from + marker.length);
        const prev = this.indentCache.get(line.number);
        if (!prev || prev.size !== size) changed = true;
        this.indentCache.set(line.number, { text: line.text, size, dirty: false });
        el.style.textIndent = -size + "px";
        el.style.paddingInlineStart = size + "px";
      }
      if (scrollEl) scrollEl.scrollTop = savedTop;
      if (changed) this.decorations = this.buildDeco(view);
    },

    /** Pixel distance from the line's inline-start edge to `pos`. */
    measureMarker(view, lineEl, pos) {
      let n = -1;
      try {
        const c = view.coordsAtPos(pos);
        const r = lineEl.getBoundingClientRect();
        const style = typeof getComputedStyle === "function" ? getComputedStyle(lineEl) : null;
        const rtl = !!(style && (style.direction === "rtl" || style.unicodeBidi === "rtl" || style.unicodeBidi === "embed"));
        // border-aware: measure from the padding edge inward
        const padL = parseFloat(style && style.paddingLeft) || 0;
        const padR = parseFloat(style && style.paddingRight) || 0;
        n = rtl ? (r.right - padR) - (c.right || 0) : (c.left || 0) - (r.left + padL);
      } catch (e) { n = -1; }
      if (n < 0 || !isFinite(n)) {
        // fall back to the estimate
        try {
          const line = view.state.doc.lineAt(pos);
          const marker = ng09ListMarker(line.text, host) || "";
          n = Math.floor(ng09CountCols(marker, view.state.tabSize || 4) * ng09CharWidth(view));
        } catch (e2) { n = 0; }
      }
      const r = lineEl.getBoundingClientRect ? lineEl.getBoundingClientRect() : null;
      // sanity: a marker can never span more than the line width; re-measure once
      if (r && r.width > 0 && n > r.width * 0.5) {
        try {
          const c = view.coordsAtPos(pos);
          const style = typeof getComputedStyle === "function" ? getComputedStyle(lineEl) : null;
          const rtl = !!(style && style.direction === "rtl");
          n = rtl ? r.right - (c.right || 0) : (c.left || 0) - r.left;
        } catch (e3) { /* keep first measurement */ }
      }
      return Math.max(0, Math.round(n));
    },

    destroy() {
      if (this.observer) this.observer.disconnect();
      this.indentCache.clear();
      this.markCache.clear();
    },
  });

  // static clearCache StateEffect + `.of()` so the class itself can be used
  // as `host.cmClearCacheEffect` (`Tq.of()` dispatches a cache clear).
  ListIndent.clearCache = host.s10StateEffect.define();
  ListIndent.of = function (...args) { return ListIndent.clearCache.of(...args); };

  ng09IndentClass = ListIndent;
  return ListIndent;
}

let ng09IndentPluginValue = null;

/** The hanging-indent decorations extension value (was Dq). */
export function ng09ListIndentPlugin(host) {
  if (!ng09IndentPluginValue) {
    const Cls = ng09ListIndentClass(host);
    ng09IndentPluginValue = host.cmViewPlugin.define((view) => new Cls(view), {
      decorations: (p) => p.decorations,
    });
  }
  return ng09IndentPluginValue;
}

// ---------------------------------------------------------------------------
// wrap-pair input handler (was fj)
// ---------------------------------------------------------------------------

/**
 * inputHandler (was fj): typing `= ~ $ %` with non-empty selections wraps each
 * selection in the pair. Any empty range, non-main range, multi-code-unit or
 * non-pair input falls through to the default handling.
 */
export function ng09WrapPairInput(host) {
  return host.CMEditorView.inputHandler.of((view, from, to, text) => {
    if (text.length > 2) return false;
    if (text.length === 2 && ng09Utf16Size(ng09CodePointAt(text, 0)) !== 1) return false;
    const state = view.state;
    const main = state.selection.main;
    if (from !== main.from || to !== main.to) return false;
    if (ng09WrapPairChars.indexOf(text) < 0) return false;

    const len = text.length;
    const changes = [];
    const newRanges = [];
    let hasEmpty = false;
    for (const r of state.selection.ranges) {
      if (r.empty) { hasEmpty = true; continue; }
      changes.push({ from: r.from, to: r.from, insert: text });
      changes.push({ from: r.to, to: r.to, insert: text });
      newRanges.push(host.cmSelection.range(r.anchor + len, r.head + len, r.goalColumn));
    }
    // CM6 requires changes sorted by position; ranges are already ordered but
    // the "to" insertion of one range can precede the "from" insertion of the
    // next only when ranges are adjacent — sort defensively.
    changes.sort((a, b) => a.from - b.from || a.to - b.to);
    if (hasEmpty) return { value: false };
    view.dispatch(state.update({
      changes,
      selection: host.cmSelection.create(newRanges, state.selection.mainIndex),
      scrollIntoView: true,
      userEvent: "input.type",
    }));
    return { value: true };
  });
}

// ---------------------------------------------------------------------------
// search-match highlight (was aj)
// ---------------------------------------------------------------------------

let ng09SearchMark = null;

/** The mark decoration for search matches (was aj). */
export function ng09SearchMatchMark(host) {
  if (!ng09SearchMark) {
    ng09SearchMark = host.cmDecoration.mark({ class: ng09SearchMatchClass });
  }
  return ng09SearchMark;
}

// ---------------------------------------------------------------------------
// in-document find/replace bar (was gj)
// ---------------------------------------------------------------------------

let ng09SearchBarBaseCls = null;
let ng09SearchBarCls = null;

function ng09Focused(el) {
  if (!el) return false;
  if (typeof el.isActiveElement === "function") return el.isActiveElement();
  const d = el.ownerDocument;
  return !!(d && d.activeElement === el);
}

function ng09SetText(el, text) {
  if (!el) return;
  if (typeof el.setText === "function") el.setText(text);
  else el.textContent = text;
}

function ng09Toggle(el, show) {
  if (!el) return;
  // Obsidian extends HTMLElement with a show/hide `toggle(bool)`; fall back
  // to inline display when the extension is absent.
  if (typeof el.toggle === "function") { el.toggle(show); return; }
  el.style.display = show ? "" : "none";
}

/** Normalize a search-cursor result into a {from,to}-ish range or null. */
function ng09CursorMatch(cursor, result) {
  if (result && typeof result === "object") return result;
  if (result) {
    if (cursor && cursor.from !== undefined && cursor.to !== undefined) {
      return { from: cursor.from, to: cursor.to };
    }
    try {
      const c = cursor && cursor.current && cursor.current();
      if (c) return c;
    } catch (e) { /* ignore */ }
  }
  return null;
}

/**
 * The in-document find/replace bar (was gj). Extends the s08 SearchBarBase
 * with a replace row, find-all, Alt+Enter / Mod+Alt+Enter scope bindings and
 * search-match highlighting through the editor API.
 */
export function ng09EditorSearchBar(host) {
  if (ng09SearchBarCls) return ng09SearchBarCls;
  if (!ng09SearchBarBaseCls) ng09SearchBarBaseCls = s08SearchBarBase(host);
  const Base = ng09SearchBarBaseCls;

  function EditorSearchBar(editor, containerEl, applyScope) {
    const self = Base.call(this, containerEl) || this;
    self.editor = editor;
    self.applyScope = applyScope;
    self.cursor = null;
    self.isActive = false;
    self.isReplace = false;
    const debounceFn = env().debounce;
    self.requestUpdateCount = typeof debounceFn === "function"
      ? debounceFn(() => self.updateCount(), 20, true)
      : () => self.updateCount();

    // find-all button on the base button row
    self.searchButtonContainerEl.createEl("button", { cls: "clickable-icon document-search-button" }, (btn) => {
      host.tv(btn, "lucide-text-select");
      host.Mv(btn, host.gm.editor.search.labelFindAll() + "\n" + host.Rb(host.Fb(["Alt"], "Enter")), { placement: "top" });
      btn.addEventListener("mousedown", (evt) => evt.preventDefault());
      btn.addEventListener("click", (evt) => { evt.preventDefault(); self.searchAll(); });
    });

    // replace row
    const wrap = self.searchContainerEl.createDiv("document-replace");
    self.replaceInputEl = wrap.createEl("input", {
      cls: "document-replace-input",
      type: "text",
      placeholder: host.gm.editor.search.placeholderReplace(),
    });
    const btns = wrap.createDiv("document-replace-buttons");
    btns.createEl("button", { cls: "clickable-icon document-search-button" }, (btn) => {
      host.tv(btn, "lucide-replace");
      host.Mv(btn, host.gm.editor.search.labelReplace() + "\n" + host.Rb(host.Fb([], "Enter")), { placement: "top" });
      btn.addEventListener("mousedown", (evt) => evt.preventDefault());
      btn.addEventListener("click", (evt) => { evt.preventDefault(); self.replaceCurrentMatch(); });
    });
    btns.createEl("button", { cls: "clickable-icon document-search-button" }, (btn) => {
      host.tv(btn, "lucide-replace-all");
      host.Mv(btn, host.gm.editor.search.labelReplaceAll() + "\n" + host.Rb(host.Fb(["Mod", "Alt"], "Enter")), { placement: "top" });
      btn.addEventListener("mousedown", (evt) => evt.preventDefault());
      btn.addEventListener("click", (evt) => { evt.preventDefault(); self.replaceAll(); });
    });

    // extra scope bindings (base already owns F3/Mod+G/Shift+F3/Mod+Shift+G/Enter/Shift+Enter/Escape/Tab)
    self.scope.register(["Alt"], "Enter", self.onAltEnter.bind(self));
    self.scope.register(["Mod", "Alt"], "Enter", self.onModAltEnter.bind(self));
    return self;
  }
  inherit(EditorSearchBar, Base);

  methods(EditorSearchBar, {
    show(showReplace) {
      this.isActive = true;
      this.isReplace = !!showReplace;
      this.searchContainerEl.toggleClass("mod-replace-mode", this.isReplace);
      this.containerEl.prepend(this.searchContainerEl);
      // seed the query with the current selection when it is non-empty
      try {
        const cm = this.editor && this.editor.cm;
        const st = cm && cm.state;
        const r = st && st.selection.main;
        if (r && !r.empty) this.searchInputEl.value = st.doc.sliceString(r.from, r.to);
      } catch (e) { /* no selection to seed */ }
      this.searchInputEl.focus();
      this.searchInputEl.select();
      if (this.applyScope) this.applyScope(this.scope);
      this.onSearchInput();
    },

    hide() {
      if (!this.isActive) return;
      // restore the selection the cursor had when the search field has focus
      if (this.cursor && (ng09Focused(this.searchInputEl) || ng09Focused(this.replaceInputEl))) {
        try {
          const cur = this.cursor.current && this.cursor.current();
          if (cur) {
            const cm = this.editor && this.editor.cm;
            if (cm && cm.state && host.cmSelection) {
              const a = cur.anchor !== undefined ? cur.anchor : cur.from;
              const h = cur.head !== undefined ? cur.head : cur.to;
              cm.dispatch(cm.state.update({
                selection: host.cmSelection.range(a, h),
                userEvent: "select",
              }));
            } else if (typeof this.editor.setSelection === "function") {
              this.editor.setSelection(cur);
            }
          }
        } catch (e) { /* best effort */ }
      }
      if (this.searchContainerEl.detach) this.searchContainerEl.detach();
      else this.searchContainerEl.remove();
      this.searchInputEl.value = "";
      this.searchContainerEl.classList.remove("mod-no-match");
      this.cursor = null;
      this.editor.removeHighlights(ng09SearchMatchClass);
      if (this.applyScope) this.applyScope(null);
      this.editor.focus();
      this.isActive = false;
    },

    updateCount() {
      const query = this.getQuery();
      ng09Toggle(this.countEl, !!query);
      if (!query || !this.cursor || typeof this.cursor.getIndexAndCount !== "function") {
        ng09SetText(this.countEl, "");
        return;
      }
      const idx = this.cursor.getIndexAndCount();
      ng09SetText(this.countEl, idx[0] + " / " + idx[1]);
    },

    scheduleCount() {
      try {
        const f = this.requestUpdateCount;
        if (f && typeof f.run === "function") f.run();
        else if (typeof f === "function") f();
      } catch (e) { /* debounced count is best effort */ }
    },

    onSearchInput() {
      const query = this.getQuery();
      this.cursor = this.editor.searchCursor(query);
      const first = query && this.cursor ? ng09CursorMatch(this.cursor, this.cursor.findNext()) : null;
      if (first) this.highlight([first]);
      else this.clear();
      this.searchContainerEl.classList.toggle("mod-no-match", !!(query && !first));
      this.scheduleCount();
    },

    findNext() {
      if (!this.cursor) return;
      const r = ng09CursorMatch(this.cursor, this.cursor.findNext());
      if (r) this.highlight([r]);
      else this.clear();
      this.scheduleCount();
    },

    findPrevious() {
      if (!this.cursor) return;
      const r = ng09CursorMatch(this.cursor, this.cursor.findPrevious());
      if (r) this.highlight([r]);
      else this.clear();
      this.scheduleCount();
    },

    findNextOrReplace() {
      if (!this.cursor) return;
      if (this.replaceInputEl && ng09Focused(this.replaceInputEl) && this.replaceInputEl.value) {
        this.cursor.replace(this.replaceInputEl.value, "searchReplace");
      }
      this.findNext();
    },

    replaceCurrentMatch() {
      if (!this.cursor) return;
      this.cursor.replace(this.replaceInputEl.value, "searchReplace");
      this.findNext();
    },

    replaceAll() {
      if (!this.cursor) return;
      this.cursor.replaceAll(this.replaceInputEl.value, "searchReplace");
    },

    searchAll() {
      if (!this.cursor) return;
      const all = this.cursor.findAll();
      this.highlight(all || []);
    },

    highlight(ranges) {
      if (!ranges || !ranges.length) { this.clear(); return; }
      this.editor.addHighlights(ranges, ng09SearchMatchClass, true, true);
      this.editor.scrollIntoView(ranges[0], true);
    },

    clear() {
      this.editor.removeHighlights(ng09SearchMatchClass);
    },

    onAltEnter() {
      if (ng09Focused(this.searchInputEl) || ng09Focused(this.replaceInputEl)) this.searchAll();
    },

    onModAltEnter() {
      if (this.isReplace && this.replaceInputEl && ng09Focused(this.replaceInputEl)) this.replaceAll();
    },
  });

  ng09SearchBarCls = EditorSearchBar;
  return EditorSearchBar;
}
