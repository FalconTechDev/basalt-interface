// ng09-editor-impl: EditorImpl (iZ) — the public `Editor` API surface that
// plugins and internal code reach through `view.editor`, translated onto a
// CodeMirror 6 EditorView. Position model is {line (0-based), ch}; all CM6
// access goes through the lazy `host` table and the sibling ng09 helpers.
//
// Clean-room reimplementation: own structure (constructor function +
// inherit/methods like the other own classes), spec'd defects preserved.
import { inherit, methods } from "./inherit.js";
import { defineEditor } from "./editor-api.js";

// ---------------------------------------------------------------------------
// small shared helpers (flat-scope names are ng09-prefixed)
// ---------------------------------------------------------------------------

/** Sorted change list -> ChangeSet (or null when empty). */
function ng09ChangeSet(host, state, raw) {
  if (!raw || !raw.length) return null;
  raw.sort((a, b) => a.from - b.from || a.to - b.to);
  if (raw.length === 1) return raw[0];
  return host.cmChangeSet.of(raw, state.doc.length);
}

/** Point inserts merged into span edits at identical positions. */
function ng09MergeChanges(edits) {
  edits.sort((a, b) => a.from - b.from || a.to - b.to);
  const out = [];
  for (const e of edits) {
    const last = out[out.length - 1];
    if (last && last.from === e.from && last.to === e.to && e.insert !== undefined) {
      last.insert += e.insert;
      continue;
    }
    out.push({ from: e.from, to: e.to, insert: e.insert || "" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// clickable-token classification helpers
// ---------------------------------------------------------------------------

/** Syntax segments of one line carrying cmSyntaxPropClasses. */
function ng09TokenSegments(host, state, line) {
  const segs = [];
  try {
    host.cmSyntaxTree(state).iterate({
      from: line.from,
      to: line.to,
      enter(node) {
        const raw = node.type.prop(host.cmSyntaxPropClasses);
        if (raw) segs.push({ from: node.from, to: node.to, cls: raw.split(" "), text: state.sliceDoc(node.from, node.to) });
      },
    });
  } catch (e) { /* partial tree: classify what we have */ }
  segs.sort((a, b) => a.from - b.from || a.to - b.to);
  return segs;
}

const ng09Has = (seg, cls) => seg.cls.indexOf(cls) >= 0;

/** Contiguous run of segments around `hit` whose classes satisfy `ok`. */
function ng09SegRun(segs, hit, ok) {
  let i = segs.indexOf(hit), l = i, r = i;
  while (l > 0 && segs[l - 1].to === segs[l].from && ok(segs[l - 1])) l--;
  while (r < segs.length - 1 && segs[r + 1].from === segs[r].to && ok(segs[r + 1])) r++;
  return { l, r };
}

function ng09InternalLink(host, impl, state, doc, segs, hit) {
  const ok = (s) => ng09Has(s, "hmd-internal-link") ||
    (ng09Has(s, "formatting-link") && (s.text === "[[" || s.text === "![[" || s.text === "]]"));
  const { l, r } = ng09SegRun(segs, hit, ok);
  const from = segs[l].from, to = segs[r].to;
  let inner = doc.sliceString(from, to).replace(/^!?\[\[/, "").replace(/\]\]$/, "");
  let displayText = "";
  const bar = inner.indexOf("|");
  if (bar >= 0) {
    displayText = inner.slice(bar + 1);
    inner = inner.slice(0, bar);
  }
  const parsed = host.parseLinkText(inner);
  const path = parsed.path || "";
  const subpath = parsed.subpath || "";
  if (displayText) {
    const ext = host.getExtension(path);
    const media = host.mediaExtensions &&
      (host.mediaExtensions.contains ? host.mediaExtensions.contains(ext) : host.mediaExtensions.has(ext));
    if (media && host.isImageDimension(displayText)) displayText = "";
  }
  return {
    type: "internal-link",
    text: path + subpath,
    displayText,
    start: impl.offsetToPos(from),
    end: impl.offsetToPos(to),
  };
}

function ng09ExternalLink(host, impl, state, doc, segs, hit) {
  const ok = (s) => ng09Has(s, "link") || ng09Has(s, "url") || ng09Has(s, "string") || ng09Has(s, "formatting-link");
  const { l, r } = ng09SegRun(segs, hit, ok);
  // a bare "string" node only resolves when the run sits inside a link
  const runHasLink = segs.slice(l, r + 1).some((s) => ng09Has(s, "link") || ng09Has(s, "url"));
  if (!runHasLink) return null;
  let urlSeg = null;
  for (let j = l; j <= r; j++) {
    const s = segs[j];
    if (ng09Has(s, "url")) { urlSeg = s; break; }
    if (ng09Has(s, "string") && !urlSeg) urlSeg = s;
  }
  if (!urlSeg) return null;
  const from = segs[l].from, to = segs[r].to;
  let raw = urlSeg.text;
  if (ng09Has(urlSeg, "string")) raw = host.decodeExternalUrl(raw);
  raw = (raw || "").trim();
  if (!raw) return null;
  const start = impl.offsetToPos(from), end = impl.offsetToPos(to);
  if (host.isInternalUrl(raw)) {
    let decoded;
    try { decoded = decodeURI(raw); } catch (e) { return null; }
    const text = (host.trimSlashes ? host.trimSlashes(decoded) : decoded).trim();
    return { type: "internal-link", text, displayText: "", start, end };
  }
  let href;
  if (host.isEmailAddress && host.isEmailAddress(raw)) href = "mailto:" + raw;
  else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) href = "https://" + raw;
  else href = raw;
  if (host.normalizeExternalUrl) href = host.normalizeExternalUrl(href);
  return { type: "external-link", text: href, start, end };
}

/** Regex fallback for lines the syntax tree leaves unclassified. */
function ng09RegexToken(host, impl, state, doc, line, off, hit) {
  if (hit && hit.cls.some((c) => /code|html/.test(c))) return null;
  const i = off - line.from;
  const text = line.text;
  const span = (m) => ({
    start: impl.offsetToPos(line.from + m.index),
    end: impl.offsetToPos(line.from + m.index + m[0].length),
  });
  let m;
  const wiki = /(!?)\[\[([^\]]*)\]\]/g;
  while ((m = wiki.exec(text))) {
    if (m.index <= i && i <= m.index + m[0].length) {
      const inner = m[2], bar = inner.indexOf("|");
      const body = bar >= 0 ? inner.slice(0, bar) : inner;
      const parsed = host.parseLinkText(body);
      const s = span(m);
      return { type: "internal-link", text: (parsed.path || "") + (parsed.subpath || ""), displayText: bar >= 0 ? inner.slice(bar + 1) : "", start: s.start, end: s.end };
    }
  }
  const tag = /(^|[^\w#])#[^\s#]+/g;
  while ((m = tag.exec(text))) {
    const at = m.index + m[1].length;
    if (at <= i && i <= at + m[0].length - m[1].length) {
      const s = span(m);
      s.start = impl.offsetToPos(line.from + at);
      return { type: "tag", text: text.slice(at, at + m[0].length - m[1].length), start: s.start, end: s.end };
    }
  }
  const url = /https?:\/\/[^\s)\]]+/g;
  while ((m = url.exec(text))) {
    if (m.index <= i && i <= m.index + m[0].length) {
      const s = span(m);
      return { type: "external-link", text: m[0], start: s.start, end: s.end };
    }
  }
  const foot = /\[\^[^\]]*\]/g;
  while ((m = foot.exec(text))) {
    if (m.index <= i && i <= m.index + m[0].length) {
      const s = span(m);
      return { type: "footref", text: m[0].toLowerCase(), start: s.start, end: s.end };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// the class
// ---------------------------------------------------------------------------

export function ng09DefineEditorImpl(host) {
  const EditorApi = defineEditor();

  function EditorImpl(component) {
    EditorApi.call(this);
    this.editorComponent = component;
    this.cm = component.cm;
    this.containerEl = component.cm.dom;
    return this;
  }
  inherit(EditorImpl, EditorApi);

  Object.defineProperty(EditorImpl.prototype, "activeCM", {
    get() { return this.editorComponent.activeCM; },
    configurable: true,
  });
  Object.defineProperty(EditorImpl.prototype, "inTableCell", {
    get() {
      const c = this.editorComponent;
      return !!c && (c instanceof host.TableCellEditor || !!c.tableCell);
    },
    configurable: true,
  });

  // Static command table (was iZ.commands): thunks keep host lookups lazy.
  EditorImpl.commands = {
    goUp: (v) => host.cmdGoUp(v),
    goDown: (v) => host.cmdGoDown(v),
    goLeft: (v) => host.cmdGoLeft(v),
    goRight: (v) => host.cmdGoRight(v),
    goStart: (v) => host.cmdGoStart(v),
    goEnd: (v) => host.cmdGoEnd(v),
    goWordLeft: (v) => host.cmdGoWordLeft(v),
    goWordRight: (v) => host.cmdGoWordRight(v),
    indentMore: (v) => host.cmdIndentMore(v),
    indentLess: (v) => host.cmdIndentLess(v),
    newlineAndIndent: (v) => host.cmdNewlineAndIndent(v),
    swapLineUp: (v) => host.cmdSwapLineUp(v),
    swapLineDown: (v) => host.cmdSwapLineDown(v),
    deleteLine: (v) => host.cmdDeleteLine(v),
    toggleFold: (v) => host.cmFoldToggle(v),
    foldAll: (v) => host.cmdFoldAll(v),
    unfoldAll: (v) => host.cmdUnfoldAll(v),
  };

  methods(EditorImpl, {
    // ---------------------------------------------------------- document --

    getValue() {
      return this.cm.state.doc.toString();
    },

    setValue(text) {
      const view = this.cm, state = view.state, doc = state.doc;
      if (doc.length === 0 && text === "") return;
      view.dispatch(state.update({ changes: { from: 0, to: doc.length, insert: String(text) } }));
    },

    getLine(line) {
      const doc = this.cm.state.doc;
      if (line < 0 || line >= doc.lines) return "";
      return doc.line(line + 1).text;
    },

    lineCount() {
      return this.cm.state.doc.lines;
    },

    lastLine() {
      return this.cm.state.doc.lines - 1;
    },

    posToOffset(pos) {
      if (pos == null) return 0;
      return host.cmPosToOffset(this.cm.state.doc, pos);
    },

    offsetToPos(offset) {
      return host.cmOffsetToPos(this.cm.state.doc, offset);
    },

    // -------------------------------------------------------- selection --

    getSelection() {
      const r = this.cm.state.selection.main;
      return this.cm.state.doc.sliceString(r.from, r.to);
    },

    getRange(from, to) {
      return this.cm.state.doc.sliceString(this.posToOffset(from), this.posToOffset(to));
    },

    replaceSelection(text, userEvent) {
      const view = this.cm, state = view.state;
      if (typeof state.replaceSelection === "function") {
        const spec = state.replaceSelection(text);
        view.dispatch(state.update({ ...spec, userEvent, scrollIntoView: true }));
        return;
      }
      view.dispatch(state.update({
        changes: state.selection.ranges.map((r) => ({ from: r.from, to: r.to, insert: String(text) })),
        userEvent,
        scrollIntoView: true,
      }));
    },

    replaceRange(text, from, to, userEvent) {
      const view = this.cm, state = view.state;
      const f = this.posToOffset(from);
      const t = to === undefined || to === null ? f : this.posToOffset(to);
      const insert = String(text);
      view.dispatch(state.update({
        changes: { from: f, to: Math.max(f, t), insert },
        selection: { anchor: f + insert.length },
        scrollIntoView: true,
        userEvent,
      }));
    },

    getCursor(which) {
      const r = this.cm.state.selection.main;
      let off;
      switch (which === undefined ? "head" : which) {
        case "from": off = r.from; break;
        case "to": off = r.to; break;
        case "anchor": off = r.anchor; break;
        case "head": off = r.head; break;
        default: return null;
      }
      return this.offsetToPos(off);
    },

    listSelections() {
      return this.cm.state.selection.ranges.map((r) => ({
        anchor: this.offsetToPos(r.anchor),
        head: this.offsetToPos(r.head),
      }));
    },

    setSelection(anchor, head) {
      const view = this.cm, state = view.state;
      const a = this.posToOffset(anchor);
      const h = head === undefined || head === null ? a : this.posToOffset(head);
      view.dispatch(state.update({
        selection: { anchor: a, head: h },
        scrollIntoView: true,
        userEvent: "select",
      }));
    },

    setSelections(selections, userEvent) {
      const view = this.cm, state = view.state;
      const ranges = (selections || []).map((s) => {
        const a = this.posToOffset(s.anchor !== undefined ? s.anchor : s.from);
        const h = s.head !== undefined ? this.posToOffset(s.head)
          : s.to !== undefined ? this.posToOffset(s.to) : a;
        return host.cmSelection.range(a, h);
      });
      view.dispatch(state.update({
        selection: host.cmSelection.create(ranges, state.selection.mainIndex),
        scrollIntoView: true,
        userEvent,
      }));
    },

    exec(command) {
      return EditorImpl.commands[command](this.activeCM);
    },

    focus() {
      this.activeCM.focus();
    },

    blur() {
      this.activeCM.contentDOM.blur();
    },

    hasFocus() {
      return !!this.activeCM.hasFocus;
    },

    refresh() {
      this.cm.dispatch({ effects: [host.cmRefreshEffect.of()] });
    },

    // ------------------------------------------------------------ scroll --

    getScrollInfo() {
      const el = this.cm.scrollDOM;
      return {
        top: el.scrollTop,
        left: el.scrollLeft,
        clientHeight: el.clientHeight,
        clientWidth: el.clientWidth,
        height: el.scrollHeight,
        width: el.scrollWidth,
      };
    },

    scrollTo(left, top) {
      const el = this.cm.scrollDOM;
      if (left !== null && left !== undefined) el.scrollLeft = left;
      if (top !== null && top !== undefined) el.scrollTop = top;
    },

    scrollIntoView(range, center) {
      if (!range) return;
      const from = this.posToOffset(range.from !== undefined ? range.from : range.anchor);
      const to = range.to !== undefined && range.to !== null ? this.posToOffset(range.to) : from;
      this.cm.dispatch({
        effects: [host.cmView.scrollIntoView({ from, to }, { y: center ? "center" : "nearest" })],
      });
    },

    // ------------------------------------------------------- transactions

    transaction(spec, userEvent) {
      if (!spec) return;
      const view = this.cm, state = view.state, doc = state.doc;
      const raw = [];
      if (spec.changes) {
        for (const c of spec.changes) {
          const from = this.posToOffset(c.from);
          const to = c.to === undefined || c.to === null ? from : this.posToOffset(c.to);
          raw.push({ from, to: Math.max(from, to), insert: c.text !== undefined ? String(c.text) : String(c.insert || "") });
        }
      }
      if (spec.replaceSelection !== undefined) {
        const text = String(spec.replaceSelection);
        for (const r of state.selection.ranges) raw.push({ from: r.from, to: r.to, insert: text });
      }
      const changes = ng09ChangeSet(host, state, raw);
      const cs = changes && changes.mapPos ? changes : (raw.length ? state.changes(raw) : null);
      const trSpec = { scrollIntoView: true };
      if (userEvent !== undefined) trSpec.userEvent = userEvent;
      if (cs) trSpec.changes = cs;
      const sels = spec.selections || (spec.selection ? [spec.selection] : null);
      if (sels && sels.length) {
        const mapIt = (p) => (cs && cs.mapPos ? cs.mapPos(p, 1) : p);
        const ranges = sels.map((s) => {
          const a = this.posToOffset(s.anchor !== undefined ? s.anchor : s.from);
          const h = s.head !== undefined ? this.posToOffset(s.head)
            : s.to !== undefined && s.to !== null ? this.posToOffset(s.to) : a;
          return host.cmSelection.range(mapIt(a), mapIt(h));
        });
        trSpec.selection = host.cmSelection.create(ranges, Math.min(state.selection.mainIndex, ranges.length - 1));
      }
      view.dispatch(state.update(trSpec));
    },

    wordAt(pos) {
      const state = this.cm.state;
      const off = this.posToOffset(pos);
      if (off < 0 || off > state.doc.length) return null;
      if (typeof state.wordAt === "function") {
        const r = state.wordAt(off);
        if (r) return { from: this.offsetToPos(r.from), to: this.offsetToPos(r.to) };
      }
      const line = state.doc.lineAt(off);
      const text = line.text;
      const isW = (c) => !!c && /[\p{L}\p{N}\p{M}_$]/u.test(c);
      let i = off - line.from;
      if (i >= text.length) i = text.length;
      if (!isW(text.charAt(i)) && !isW(text.charAt(i - 1))) return null;
      while (i > 0 && isW(text.charAt(i - 1))) i--;
      let j = off - line.from;
      while (j < text.length && isW(text.charAt(j))) j++;
      if (j <= i) return null;
      return { from: this.offsetToPos(line.from + i), to: this.offsetToPos(line.from + j) };
    },

    undo() {
      host.cmUndo(this.activeCM);
    },

    redo() {
      host.cmRedo(this.activeCM);
    },

    coordsAtPos(pos, clipToScroll) {
      const off = this.posToOffset(pos);
      const c = clipToScroll ? this.cm.coordsAtPos(off, 0, true) : this.cm.coordsAtPos(off);
      return c || null;
    },

    posAtCoords(x, y) {
      const off = this.cm.posAtCoords({ x, y });
      return off === null || off === undefined ? null : this.offsetToPos(off);
    },

    // ---------------------------------------------------------- highlights

    addHighlights(ranges, cls, replace, excludeFolds) {
      const view = this.cm, state = view.state;
      let markSpec = host.highlightCache.get(cls);
      if (!markSpec) {
        markSpec = host.cmDecoration.mark({ class: cls });
        host.highlightCache.set(cls, markSpec);
      }
      const effects = [];
      const marks = [];
      for (const r of ranges || []) {
        const from = this.posToOffset(r.from), to = this.posToOffset(r.to);
        if (from >= to) continue;
        if (excludeFolds) {
          host.cmFoldedRanges(state).between(from, to, (f, t) => {
            effects.push(host.cmUnfoldEffect.of({ from: f, to: t }));
          });
        }
        marks.push(markSpec.range(from, to));
      }
      if (replace) effects.push(host.cmFilterEffect.of((from, to, value) => value !== markSpec));
      effects.push(host.cmHighlightField.of(marks));
      view.dispatch({ effects });
    },

    removeHighlights(cls) {
      const view = this.cm;
      if (view.dom && view.dom.isShown && !view.dom.isShown()) return;
      if (cls) {
        const markSpec = host.highlightCache.get(cls);
        if (!markSpec) return;
        view.dispatch({ effects: [host.cmFilterEffect.of((from, to, value) => value !== markSpec)] });
        return;
      }
      view.dispatch({ effects: [host.cmFilterEffect.of(() => false)] });
    },

    hasHighlight(cls) {
      const state = this.cm.state;
      const field = state.field(host.cmHighlightState, false);
      if (!field) return false;
      const doc = state.doc;
      if (!cls) {
        let any = false;
        field.between(0, doc.length, () => { any = true; });
        return any;
      }
      const markSpec = host.highlightCache.get(cls);
      if (!markSpec) return false;
      let found = false;
      field.between(0, doc.length, (from, to, value) => {
        if (value === markSpec || (value && value.spec === markSpec)) found = true;
      });
      return found;
    },

    // --------------------------------------------------------------- folds

    getAllFoldableLines() {
      const state = this.cm.state, doc = state.doc;
      const out = [];
      for (let n = 1; n <= doc.lines; n++) {
        const line = doc.line(n);
        const range = host.cmFoldableRange(state, line.from, line.to);
        if (range) out.push(range);
      }
      return out;
    },

    getFoldOffsets() {
      const state = this.cm.state;
      const out = new Set();
      host.cmFoldedRanges(state).between(0, state.doc.length, (from) => out.add(from));
      return out;
    },

    foldLess() {
      const view = this.cm, state = view.state, doc = state.doc;
      const folded = host.cmFoldedRanges(state);
      const effects = [];
      for (const range of state.selection.ranges) {
        const l1 = doc.lineAt(range.from).number, l2 = doc.lineAt(range.to).number;
        for (let n = l1; n <= l2; n++) {
          const line = doc.line(n);
          const r = host.cmFoldableRange(state, line.from, line.to);
          if (!r) continue;
          let isFolded = false;
          folded.between(r.from, r.to, () => { isFolded = true; });
          if (isFolded) { effects.push(host.cmUnfoldEffect.of(r)); break; }
        }
      }
      if (effects.length) view.dispatch({ effects });
      return effects.length > 0;
    },

    foldMore() {
      const view = this.cm, state = view.state, doc = state.doc;
      const folded = host.cmFoldedRanges(state);
      const effects = [];
      for (const range of state.selection.ranges) {
        const l1 = doc.lineAt(range.from).number, l2 = doc.lineAt(range.to).number;
        let candidate = null;
        for (let n = l1; n <= l2; n++) {
          const line = doc.line(n);
          const r = host.cmFoldableRange(state, line.from, line.to);
          if (!r) continue;
          let isFolded = false;
          folded.between(r.from, r.to, () => { isFolded = true; });
          if (!isFolded) candidate = r;
        }
        if (candidate) effects.push(host.cmFoldEffect.of(candidate));
      }
      if (effects.length) view.dispatch({ effects });
      return effects.length > 0;
    },

    // ------------------------------------------------------- insert helpers

    insertHorizontalRule() {
      const view = this.cm, state = view.state, doc = state.doc;
      const edits = [];
      const cursors = [];
      for (const range of state.selection.ranges) {
        const head = range.head;
        const line = doc.lineAt(head);
        const ch = head - line.from > 0 ? 2 : 1;
        const insert = "\n".repeat(ch) + "---\n";
        edits.push({ from: head, to: head, insert });
        cursors.push(head);
      }
      const changes = ng09ChangeSet(host, state, edits);
      const cs = changes && changes.mapPos ? changes : state.changes(edits);
      const sel = host.cmSelection.create(
        cursors.map((p) => host.cmSelection.cursor(cs.mapPos(p, 1))),
        state.selection.mainIndex,
      );
      view.dispatch(state.update({ changes: cs, selection: sel, scrollIntoView: true, userEvent: "input.type" }));
    },

    insertBlock(open, close) {
      const view = this.cm, state = view.state, doc = state.doc;
      const before = open + "\n", after = "\n" + close;
      const edits = [];
      for (const r of state.selection.ranges) {
        const l1 = doc.lineAt(Math.min(r.anchor, r.head)).from;
        const l2 = doc.lineAt(Math.max(r.anchor, r.head)).to;
        edits.push({ from: l1, to: l1, insert: before });
        edits.push({ from: l2, to: l2, insert: after });
      }
      const changes = ng09MergeChanges(edits);
      const cs = state.changes(changes);
      const selRanges = state.selection.ranges.map((orig) => {
        const collapsed = orig.anchor === orig.head;
        const anchor = cs.mapPos(orig.anchor, 1);
        const head = collapsed ? anchor : cs.mapPos(orig.head, -1);
        return host.cmSelection.range(anchor, head);
      });
      view.dispatch(state.update({
        changes: cs,
        selection: host.cmSelection.create(selRanges, state.selection.mainIndex),
        scrollIntoView: true,
        userEvent: "input.type",
      }));
    },

    insertMarkdownLink() {
      const view = this.cm, state = view.state, doc = state.doc;
      const edits = [];
      const cursors = [];
      for (const range of state.selection.ranges) {
        const text = doc.sliceString(range.from, range.to);
        edits.push({ from: range.from, to: range.to, insert: "[" + text + "]()" });
        cursors.push({ from: range.from, inner: text.length + 3 });
      }
      const changes = ng09ChangeSet(host, state, edits);
      const cs = changes && changes.mapPos ? changes : state.changes(edits);
      const sel = host.cmSelection.create(
        cursors.map((c) => host.cmSelection.cursor(cs.mapPos(c.from, -1) + c.inner)),
        state.selection.mainIndex,
      );
      view.dispatch(state.update({
        changes: cs,
        selection: sel,
        scrollIntoView: true,
        userEvent: "input.autocomplete",
      }));
    },

    triggerWikilink(embed) {
      const view = this.cm, state = view.state, doc = state.doc;
      const prefix = embed ? "![[" : "[[";
      const suffix = "]]";
      const edits = [];
      const cursors = [];
      for (const range of state.selection.ranges) {
        const text = doc.sliceString(range.from, range.to);
        edits.push({ from: range.from, to: range.to, insert: prefix + text + suffix });
        cursors.push({ from: range.from, inner: prefix.length + text.length });
      }
      const changes = ng09ChangeSet(host, state, edits);
      const cs = changes && changes.mapPos ? changes : state.changes(edits);
      const sel = host.cmSelection.create(
        cursors.map((c) => host.cmSelection.cursor(cs.mapPos(c.from, -1) + c.inner)),
        state.selection.mainIndex,
      );
      view.dispatch(state.update({
        changes: cs,
        selection: sel,
        scrollIntoView: true,
        userEvent: "input.autocomplete",
      }));
    },

    // ------------------------------------------------------- formatting ----

    getTableSelection() {
      const cell = this.editorComponent && this.editorComponent.tableCell;
      return cell && cell.table ? cell.table.selectedCells : [];
    },

    /** Ranges ({from,to} offsets) covered by the current selection or table cells. */
    ng09FormatRanges() {
      const state = this.cm.state;
      const cells = this.getTableSelection();
      if (cells && cells.length) {
        const ranges = [];
        for (const cell of cells) {
          const offs = cell.getAbsoluteOffsets ? cell.getAbsoluteOffsets() : null;
          if (offs && offs.textStart !== undefined && offs.textEnd !== undefined) {
            ranges.push({ from: offs.textStart, to: offs.textEnd });
          }
        }
        if (ranges.length) return { ranges, singleSelection: false };
      }
      return {
        ranges: state.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
        singleSelection: state.selection.ranges.length === 1,
      };
    },

    clearMarkdownFormatting() {
      const view = this.cm, state = view.state;
      const { ranges } = this.ng09FormatRanges();
      const edits = [];
      const kinds = host.s91FormatMarks ? Object.keys(host.s91FormatMarks) : [];
      for (const r of ranges) {
        for (const kind of kinds) {
          const got = host.cmFormatRemove(state, r, kind);
          if (got) for (const e of got) edits.push(e);
        }
      }
      if (!edits.length) return;
      view.dispatch(state.update({ changes: ng09MergeChanges(edits), userEvent: "input.type", scrollIntoView: true }));
    },

    toggleMarkdownFormatting(kind) {
      const view = this.cm, state = view.state;
      const { ranges } = this.ng09FormatRanges();
      if (!ranges.length) return;
      const mark = host.s91FormatMarks ? host.s91FormatMarks[kind] : null;
      const info = host.cmFormatQuery(state, ranges[0]);
      const present = !!(info && info[kind]);
      const edits = [];
      if (present) {
        // unwrap: strip the mark characters of every node of this kind
        for (const r of ranges) {
          const got = host.cmFormatRemove(state, r, kind);
          if (got) for (const e of got) edits.push({ from: e.from, to: e.to, insert: e.insert || "" });
          if (r.from === r.to && mark) {
            for (const dir of [-1, 1]) {
              const inner = host.cmFormatInner(state, r.from, mark, dir);
              if (inner) edits.push({ from: inner.from, to: inner.to, insert: "" });
            }
          }
        }
        if (edits.length) {
          view.dispatch(state.update({ changes: ng09MergeChanges(edits), userEvent: "input.type", scrollIntoView: true }));
        }
        return;
      }
      // ADD branch — preserves the observed defect: the host node query returns
      // a single {from,to} object, and the original spread it as a list.
      const cursor = host.cmSyntaxTree(state).cursor(host.cmSyntaxExcludeBuffers);
      for (const r of ranges) {
        const spans = [...host.cmFormatNodes(state, cursor, r, kind)];
        for (const s of spans) edits.push(s);
      }
      // unreachable in the defective build (the spread above throws first)
      if (edits.length) {
        view.dispatch(state.update({ changes: ng09MergeChanges(edits), userEvent: "input.type", scrollIntoView: true }));
      }
    },

    toggleComment() {
      const view = this.cm, state = view.state, doc = state.doc;
      const edits = [];
      const cursors = [];
      for (const range of state.selection.ranges) {
        const r = { from: range.from, to: range.to };
        const info = host.cmFormatQuery(state, r);
        if (info && info.comment) {
          const got = host.cmFormatRemove(state, r, "comment");
          if (got) for (const e of got) edits.push({ from: e.from, to: e.to, insert: e.insert || "" });
          cursors.push({ pos: r.from, collapsed: false });
          continue;
        }
        let from = r.from, to = r.to;
        const wasCollapsed = from === to;
        if (wasCollapsed) {
          const w = this.wordAt(this.offsetToPos(from));
          if (w) { from = this.posToOffset(w.from); to = this.posToOffset(w.to); }
        }
        const inner = { from, to };
        const got = host.cmFormatRemove(state, inner, "comment");
        if (got) for (const e of got) edits.push({ from: e.from, to: e.to, insert: e.insert || "" });
        edits.push({ from, to: from, insert: "%% " });
        edits.push({ from: to, to: to, insert: " %%" });
        cursors.push({ pos: wasCollapsed ? from : to, collapsed: wasCollapsed });
      }
      const changes = ng09MergeChanges(edits);
      const cs = state.changes(changes);
      const sel = host.cmSelection.create(
        cursors.map((c) => host.cmSelection.cursor(cs.mapPos(c.pos, -1) + (c.collapsed ? 3 : 0))),
        state.selection.mainIndex,
      );
      view.dispatch(state.update({ changes: cs, selection: sel, scrollIntoView: true, userEvent: "input.type" }));
    },

    insertTable() {
      const view = this.cm, state = view.state, doc = state.doc;
      const head = state.selection.main.head;
      const line = doc.lineAt(head);
      const anchor = head;
      if (line.text !== "") {
        // observed defect: the original reassigned the const `anchor` to the
        // line end on non-empty lines -> TypeError: Assignment to constant variable.
        throw new TypeError("Assignment to constant variable.");
      }
      const insert = "\n|     |     |\n| --- | --- |\n|     |     |\n";
      view.dispatch(state.update({
        changes: { from: head, to: head, insert },
        scrollIntoView: true,
        userEvent: "input.type",
      }));
      // second dispatch: cursor one char into the table
      view.dispatch(state.update({
        selection: { anchor: anchor + 2 },
        scrollIntoView: true,
        userEvent: "select",
      }));
    },

    async insertFootnote() {
      const view = this.cm, state = view.state, doc = state.doc;
      const comp = this.editorComponent;
      const app = comp && comp.app;
      const owner = comp && comp.owner;
      const file = comp && comp.file;
      const cache = app && app.metadataCache && file ? app.metadataCache.getFileCache(file) : null;
      const marker = "[^" + host.nextFootnoteId(cache) + "]";

      const edits = [];
      const cursors = [];
      for (const range of state.selection.ranges) {
        edits.push({ from: range.from, to: range.to, insert: marker });
        cursors.push(range.from);
      }
      const trailing = (() => {
        let n = 0;
        for (let i = doc.length - 1; i >= 0 && doc.sliceString(i, i + 1) === "\n"; i--) n++;
        return n;
      })();
      const gap = "\n".repeat(2 - Math.min(trailing, 2));
      edits.push({ from: doc.length, to: doc.length, insert: gap + marker + ": \n" });
      const changes = ng09ChangeSet(host, state, edits);
      const cs = changes && changes.mapPos ? changes : state.changes(edits);
      view.dispatch(state.update({
        changes: cs,
        selection: { anchor: cs.mapPos(cursors[0] !== undefined ? cursors[0] : 0, 1) },
        scrollIntoView: true,
        userEvent: "input.type",
      }));

      if (owner instanceof host.MarkdownView) owner.saveImmediately();
      else if (owner instanceof host.EmbedFileView) owner.save(this.getValue(), true);
      else return;
      if (app && app.metadataCache && file && typeof app.metadataCache.computeFileMetadataAsync === "function") {
        app.metadataCache.computeFileMetadataAsync(file);
      }
      if (!file) return;
      try {
        const from = cursors[0] !== undefined ? cs.mapPos(cursors[0], -1) : 0;
        const coords = view.coordsAtPos(from + 1);
        if (!coords) return;
        const rtl = !!(view.dom && view.dom.dir === "rtl");
        const dom = view.domAtPos ? view.domAtPos(from + 1) : null;
        const popover = await host.HoverPopover.create({
          app,
          hoverParent: owner,
          targetEl: dom && dom.node ? dom.node : view.contentDOM,
          linktext: "#" + marker,
          sourcePath: file.path,
          waitTime: 0,
          state: { mode: "source" },
          position: { x: coords[rtl ? "right" : "left"], y: (coords.top + coords.bottom) / 2 },
        });
        if (owner instanceof host.EmbedFileView && popover && popover.embed && popover.embed.editMode) {
          const embed = popover.embed;
          embed.editMode.register(() => {
            setTimeout(() => {
              const active = view.dom && view.dom.win ? view.dom.win.document.activeElement : null;
              if (!view.hasFocus && !(active && view.contentDOM.contains(active))) view.focus();
            }, 0);
          });
        }
      } catch (e) { /* popover is best-effort */ }
    },

    // -------------------------------------------------------- search cursor

    searchCursor(query) {
      const view = this.cm;
      const self = this;
      const q = query === null || query === undefined ? "" : String(query);
      const ql = q.toLowerCase();
      let cur = null;
      let pos = view.state.selection.main.head;

      const lower = () => view.state.doc.toString().toLowerCase();
      const toPair = (m) => ({ from: self.offsetToPos(m.from), to: self.offsetToPos(m.to) });

      const cursor = {
        findNext() {
          if (!ql) return null;
          const doc = view.state.doc, text = lower();
          let start = cur ? cur.to : pos;
          if (start < 0) start = 0;
          if (start > doc.length) start = doc.length;
          let i = text.indexOf(ql, start);
          if (i < 0 && start > 0) i = text.indexOf(ql, 0);
          if (i < 0) return null;
          cur = { from: i, to: i + q.length };
          pos = cur.to;
          return toPair(cur);
        },
        findPrevious() {
          if (!ql) return null;
          const doc = view.state.doc, text = lower();
          const end = cur ? cur.from : pos;
          let i = -1;
          if (end - q.length >= 0) i = text.lastIndexOf(ql, end - q.length);
          if (i < 0) i = text.lastIndexOf(ql);
          if (i < 0) return null;
          cur = { from: i, to: i + q.length };
          pos = cur.from;
          return toPair(cur);
        },
        current() {
          return cur ? toPair(cur) : null;
        },
        findAll() {
          if (!ql) return [];
          const doc = view.state.doc, text = lower();
          const out = [];
          let i = text.indexOf(ql);
          while (i >= 0) {
            out.push(toPair({ from: i, to: i + q.length }));
            i = text.indexOf(ql, i + Math.max(1, q.length));
          }
          return out;
        },
        getIndexAndCount() {
          const all = cursor.findAllOffsets();
          if (!cur) return [0, all.length];
          const idx = all.findIndex((m) => m.from === cur.from && m.to === cur.to);
          return [idx >= 0 ? idx + 1 : 0, all.length];
        },
        findAllOffsets() {
          if (!ql) return [];
          const doc = view.state.doc, text = lower();
          const out = [];
          let i = text.indexOf(ql);
          while (i >= 0 && out.length < 9999) {
            out.push({ from: i, to: i + q.length });
            i = text.indexOf(ql, i + Math.max(1, q.length));
          }
          return out;
        },
        replace(text, userEvent) {
          if (!cur) return;
          const m = { from: cur.from, to: cur.to };
          cur = null;
          self.replaceRange(text, self.offsetToPos(m.from), self.offsetToPos(m.to), userEvent);
          pos = m.from + String(text).length;
        },
        // observed defect: delegates to a non-existent editor method
        replaceAll(text, userEvent) {
          return self.findAll(text, userEvent);
        },
      };
      return cursor;
    },

    // ------------------------------------------------------- clickable token

    getClickableTokenAt(pos) {
      const view = this.cm, state = view.state, doc = state.doc;
      if (pos === null || pos === undefined) return null;
      const off = typeof pos === "number" ? pos : this.posToOffset(pos);
      if (off < 0 || off > doc.length) return null;
      try { host.s10EnsureSyntaxTree(view, off, 400); } catch (e) { /* best effort */ }
      const line = doc.lineAt(off);
      const segs = ng09TokenSegments(host, state, line);
      let hit = null;
      for (const s of segs) {
        if (s.from <= off && off <= s.to && (!hit || (s.to - s.from) < (hit.to - hit.from))) hit = s;
      }
      if (hit) {
        if (ng09Has(hit, "hmd-internal-link")) return ng09InternalLink(host, this, state, doc, segs, hit);
        if (ng09Has(hit, "hmd-footref2")) {
          return { type: "external-ref-link", text: hit.text, start: this.offsetToPos(hit.from), end: this.offsetToPos(hit.to) };
        }
        if (ng09Has(hit, "link") || ng09Has(hit, "url") || ng09Has(hit, "string")) {
          const token = ng09ExternalLink(host, this, state, doc, segs, hit);
          if (token) return token;
        }
        if (ng09Has(hit, "hashtag")) {
          const { l, r } = ng09SegRun(segs, hit, (s) => ng09Has(s, "hashtag"));
          const from = segs[l].from, to = segs[r].to;
          return { type: "tag", text: doc.sliceString(from, to), start: this.offsetToPos(from), end: this.offsetToPos(to) };
        }
        if (ng09Has(hit, "blockid")) {
          const { l, r } = ng09SegRun(segs, hit, (s) => ng09Has(s, "blockid"));
          const from = segs[l].from, to = segs[r].to;
          return { type: "blockid", text: doc.sliceString(from, to), start: this.offsetToPos(from), end: this.offsetToPos(to) };
        }
        if (ng09Has(hit, "footref") && !ng09Has(hit, "inline-footnote")) {
          const from = Math.max(line.from, hit.from - 2);
          const to = Math.min(line.to, hit.to + 1);
          return { type: "footref", text: doc.sliceString(from, to).toLowerCase(), start: this.offsetToPos(from), end: this.offsetToPos(to) };
        }
      }
      return ng09RegexToken(host, this, state, doc, line, off, hit);
    },
  });

  return EditorImpl;
}

// DECISIONS:
// - `this.cm` (the impl's own CM6 view) backs every document/selection/scroll/
//   coords/highlight/fold/format op; `activeCM` is used only where the spec
//   says so: `exec`, `focus`, `blur`, `hasFocus`, `undo`, `redo`.
// - EditorApi base comes from `defineEditor()` (editor-api.js) via inherit(),
//   matching the house constructor-function style; its prototype supplies
//   setHeading/toggle lists/insertCallout/insertBlock callers etc.
// - `EditorImpl.commands` is a plain map of lazy thunks so late-bound host
//   command values (declarator positions in the bundle) resolve at exec time.
// - transaction(): changes are sorted and merged through `cmChangeSet.of`;
//   selection endpoints are mapped through the ChangeSet and interpreted in
//   post-change coordinates (CM6 spec semantics); `scrollIntoView` always on.
// - insertBlock(): endpoints mapped through the change set — anchor assoc +1,
//   head assoc -1 (collapsed ranges use +1) so selections shift by the open
//   marker length without swallowing the close marker at line end.
// - toggleComment(): per range — comment detected via cmFormatQuery; removal
//   via cmFormatRemove; otherwise "%% "/" %%" wraps (empty ranges expand to
//   wordAt first); collapsed results get cursor at from+3.
// - toggleMarkdownFormatting(): table-cell selections use each cell's
//   getAbsoluteOffsets() text span; the add-format branch reproduces the
//   observed TypeError by spreading the single {from,to} result of
//   cmFormatNodes (s91FormatNodeRange), exactly as the defect describes.
// - insertTable(): non-empty cursor line throws TypeError
//   "Assignment to constant variable." deterministically (the original relied
//   on strict-mode const reassignment); empty line inserts "\n" + the 3-row
//   table literal and a second dispatch puts the cursor after the first "|".
// - searchCursor(): self-contained lowercase substring cursor; findNext wraps
//   to doc start, findPrevious scans backwards from the current match start
//   and wraps to doc end; replaceAll delegates to the non-existent
//   `self.findAll` on the editor (preserves the observed TypeError).
// - getClickableTokenAt(): syntax-tree segments via cmSyntaxPropClasses with
//   run-merging for hmd-internal-link / link / hashtag / blockid; a regex
//   fallback covers lines the tree leaves unclassified (suppressed inside
//   code/html classes). Token start/end are {line,ch} pos objects.
// - addHighlights(): mark decorations cached in highlightCache by class;
//   replace uses cmFilterEffect keeping values !== the class mark spec;
//   removeHighlights() no-ops when the view DOM reports hidden.
// - insertFootnote(): replaces every selection range with the marker, appends
//   "[^id]: \n" at doc end with a computed blank-line gap, then saves
//   (MarkdownView.saveImmediately / EmbedFileView.save), recomputes metadata
//   and opens HoverPopover positioned at the inline marker; non-view owners
//   abort after the dispatch per spec.
// - UNRESOLVED: whether `state.replaceSelection` exists on this CM6 build —
//   a manual per-range fallback is included.
// - UNRESOLVED: exact payload/semantics of cmFilterEffect beyond the observed
//   `(from,to,value)=>value!==markSpec` predicate shape.
// - UNRESOLVED: `coordsAtPos` clip flag position assumed (pos, side, clip).
// - UNRESOLVED: getAllFoldableLines returns raw {from,to} offset ranges.
