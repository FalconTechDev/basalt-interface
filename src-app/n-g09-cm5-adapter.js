// ng09-cm5-adapter: CodeMirror-5-style facade over a CM6 EditorView (was `_q`).
//
// Clean-room reimplementation of the CM5 `CodeMirror.Adapter` surface consumed by
// the inherited vim mode and exposed as `window.CodeMirrorAdapter`. All CM6 /
// app-scope helpers are reached lazily through `env()` (envBind names) and
// `host` (manifest host names) inside methods — nothing is captured at factory
// top level because several bundle values are initialized after this module.
//
// Env names used (see manifest.envBind): $I hasMetadataEditor, $q bracket pair
// table, AR indentAuto, Bq Pos, Fq posToOffset, Gp cmFoldedRanges, Gq dialog box,
// Hq/Vq remove/add handler, Jq tag range, Kq notification-close slot, LR
// indentLess, Nd bracket matcher, Nq offsetToPos, Oq insertNewlineAndIndent,
// PF cursorCharLeft, PR indentMore, Qq closeDialog signal, Rq key-name table,
// SR newlineAndIndent, TF goLeft, UR CM5 string SearchCursor, Uq restore cursor,
// Vd StringStream, W$ owner field, Wq empty object, Xq openDialog, Yq setDialog,
// Zq noop, _o EditorView, aN/oN selection probes, eP end-of-line probe, jp
// cmUnfoldEffect, jq cm6Dispatch, ne assoc enum, np ensureSyntaxTree, pe
// cmSelection, qq callAll, tj bookmark mark, uB vim search query, yB overlay
// effect, yp indentUnit facet, zq emitStored, nF/iF cmUndo/cmRedo.
import { env } from "./env.js";

// ---------------------------------------------------------------------------
// small shared helpers
// ---------------------------------------------------------------------------

function ng09Doc(f) { return f.cm6.state.doc; }

function ng09View(f) { return f.cm6; }

/** Pos-like {line,ch} -> offset, clamped to the doc. */
function ng09Off(f, pos) {
  return env().Fq(ng09Doc(f), pos || { line: 0, ch: 0 });
}

/** Offset -> {line,ch}, clipped into the doc when out of range. */
function ng09Pos(f, off) {
  const doc = ng09Doc(f);
  const p = env().Nq(doc, off);
  if (p) return p;
  const c = f.clipPos({ line: 0, ch: 0 });
  return c;
}

function ng09ClipOffset(f, off) {
  const doc = ng09Doc(f);
  return Math.max(0, Math.min(doc.length, off));
}

/** Escape `{`/`}` that are not `{n,m}` quantifiers and not already escaped. */
function ng09EscapeBraceQuantifiers(source) {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const c = source.charAt(i);
    if (c === "\\") { out += c + source.charAt(++i || ""); continue; }
    if (c === "{") {
      const rest = source.slice(i);
      if (/^\{\d+(,\d*)?\}/.test(rest)) { out += c; continue; }
      out += "\\{";
      continue;
    }
    if (c === "}") { out += "\\}"; continue; }
    out += c;
  }
  return out;
}

function ng09SelectionRanges(f) {
  if (f.virtualSelection && f.virtualSelection.ranges) return f.virtualSelection.ranges;
  return f.cm6.state.selection.ranges;
}

// ---------------------------------------------------------------------------
// the facade constructor
// ---------------------------------------------------------------------------

export function ng09Cm5Adapter(host) {

  function Cm5Editor(cm6) {
    this.state = {};
    this.marks = Object.create(null);
    this.$mid = 0;
    this.options = {};
    this._handlers = {};
    this.$lastChangeEndOffset = 0;
    this.virtualSelection = null;
    this.cm6 = cm6;
    this.curOp = null;
    this.$d = 0;
    this.$lineHandleChanges = [];
    this.$lineHandles = null;
    ng09BindDispatch(this);
  }

  // Patch view.dispatch once per facade so doc/selection changes feed the
  // CM5-style change/cursorActivity pipeline. The transaction is rebuilt with
  // state.update (pure) purely for observation; the original args are passed
  // through untouched.
  function ng09BindDispatch(f) {
    const view = f.cm6;
    if (!view || view.__ng09Cm5Bound) return;
    view.__ng09Cm5Bound = true;
    const orig = view.dispatch;
    view.dispatch = function (...args) {
      const before = view.state;
      let tr = null;
      try {
        if (args.length === 1 && args[0] && args[0].startState && args[0].changes && args[0].selection) {
          tr = args[0];
        } else if (args.length) {
          tr = before.update(...args);
        }
      } catch (e) { tr = null; }
      const ret = orig.apply(view, args);
      try {
        if (tr) {
          f.onChange(tr);
          if (!before.selection.eq(view.state.selection)) f.onSelectionChange();
        } else if (before.doc !== view.state.doc || !before.selection.eq(view.state.selection)) {
          f.onSelectionChange();
        }
        if (!f.$d) f.onBeforeEndOperation();
      } catch (e) { console.error(e); }
      return ret;
    };
  }

  // -------------------------------------------------------------------------
  // events
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.on = function (type, fn) { env().Vq(this, type, fn); };
  Cm5Editor.prototype.off = function (type, fn) { env().Hq(this, type, fn); };
  Cm5Editor.prototype.signal = function (type, a1, a2) { env().zq(this, type, this, a1, a2); };

  // -------------------------------------------------------------------------
  // operations / change tracking
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.operation = function (fn) {
    this.$d = (this.$d || 0) + 1;
    try { return fn(this); }
    finally {
      this.$d--;
      if (this.$d <= 0) { this.$d = 0; this.onBeforeEndOperation(); }
    }
  };

  Cm5Editor.prototype.onChange = function (update) {
    this.$lineHandleChanges.push(update.changes);
    for (const id in this.marks) {
      const m = this.marks[id];
      if (m && typeof m.update === "function") {
        try { m.update(update.changes); } catch (e) { /* stale mark */ }
      }
    }
    if (this.virtualSelection && this.virtualSelection.ranges) {
      try {
        this.virtualSelection = {
          ranges: this.virtualSelection.ranges.map((r) => ({
            anchor: update.changes.mapPos(r.anchor, 0, env().ne.TrackAfter),
            head: update.changes.mapPos(r.head, 0, env().ne.TrackAfter),
          })),
        };
      } catch (e) { /* leave as-is */ }
    }
    const op = this.curOp || (this.curOp = { isVimOp: false, $changeStart: undefined, change: null, lastChange: null, $selChanged: false });
    let text = "";
    let firstFromB = null, lastToB = 0;
    try {
      update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        if (firstFromB === null) firstFromB = fromB;
        lastToB = toB;
        try { text += inserted.toString(); } catch (e) { text += ""; }
      });
    } catch (e) { /* empty change */ }
    if (firstFromB !== null) {
      const node = { text, next: null };
      if (op.lastChange) op.lastChange.next = node; else op.change = node;
      op.lastChange = node;
      if (op.$changeStart === undefined) op.$changeStart = firstFromB;
      this.$lastChangeEndOffset = lastToB;
    }
  };

  Cm5Editor.prototype.onSelectionChange = function () {
    const op = this.curOp || (this.curOp = { isVimOp: false, $changeStart: undefined, change: null, lastChange: null, $selChanged: false });
    op.$selChanged = true;
  };

  Cm5Editor.prototype.onBeforeEndOperation = function () {
    const op = this.curOp;
    if (!op) return;
    const view = this.cm6;
    try {
      if (op.change) {
        const list = this._handlers.change;
        if (list) env().qq(list, this, op.change);
      }
      if (op.$selChanged) {
        const list = this._handlers.cursorActivity;
        if (list) env().qq(list, this);
      }
      if (op.isVimOp && view) {
        const folded = env().Gp(view.state);
        if (folded && folded.size !== 0) {
          const effects = [];
          for (const r of view.state.selection.ranges) {
            folded.between(r.from, r.to, (from, to) => {
              effects.push(env().jp.of({ from, to }));
            });
          }
          if (effects.length) view.dispatch({ effects });
        }
        try { view.dispatch({ scrollIntoView: true }); } catch (e) { /* noop */ }
      }
    } catch (e) { console.error(e); }
    op.change = null;
    op.lastChange = null;
    op.$selChanged = false;
    op.isVimOp = false;
  };

  // -------------------------------------------------------------------------
  // dialogs / notifications
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.openDialog = function (template, callback, options) {
    let content = template;
    if (typeof content === "string") {
      const div = document.createElement("div");
      div.innerHTML = content;
      content = div;
    }
    return env().Xq(this, content, callback, options);
  };

  Cm5Editor.prototype.openNotification = function (message, options) {
    options = options || {};
    const view = this.cm6;
    const hostEl = (view && view.dom) || document.body;
    const box = document.createElement("div");
    box.className = "cm-notification";
    if (typeof message === "string") box.textContent = message;
    else if (message && message.nodeType) box.appendChild(message);
    else box.textContent = String(message);
    const close = () => {
      try { box.remove(); } catch (e) { /* detached */ }
      if (view && view.state.currentNotificationClose === close) view.state.currentNotificationClose = null;
    };
    env().Kq(view || this, close);
    box.addEventListener("click", close);
    hostEl.appendChild(box);
    const duration = options.duration === undefined ? 5000 : options.duration;
    if (duration) setTimeout(close, duration);
    return close;
  };

  // -------------------------------------------------------------------------
  // positions / coordinates
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.indexFromPos = function (pos) { return ng09Off(this, pos); };
  Cm5Editor.prototype.posFromIndex = function (offset) {
    const p = env().Nq(ng09Doc(this), offset);
    if (p) return p;
    return this.clipPos({ line: this.lastLine(), ch: 0 });
  };

  Cm5Editor.prototype.clipPos = function (pos) {
    const doc = ng09Doc(this);
    let line = Math.max(0, Math.min((pos && pos.line) || 0, doc.lines - 1));
    const l = doc.line(line + 1);
    let ch = Math.max(0, Math.min((pos && pos.ch) || 0, l.length));
    // handle line == doc.lines when doc is empty-ish
    if (line >= doc.lines) { line = doc.lines - 1; }
    const ll = doc.line(Math.max(1, line + 1));
    ch = Math.max(0, Math.min(ch, ll.length));
    return { line, ch };
  };

  Cm5Editor.prototype.charCoords = function (pos, mode) {
    const view = this.cm6;
    const off = this.indexFromPos(pos);
    let coords = null;
    try { coords = view.coordsAtPos(off); } catch (e) { coords = null; }
    if (!coords) return coords;
    if (mode === "div") {
      const r = view.contentDOM.getBoundingClientRect();
      return { left: coords.left - r.left, top: coords.top - r.top, right: coords.right - r.left, bottom: coords.bottom - r.top };
    }
    const r = view.scrollDOM.getBoundingClientRect();
    const st = view.scrollDOM.scrollTop || 0, sl = view.scrollDOM.scrollLeft || 0;
    return { left: coords.left - r.left + sl, top: coords.top - r.top + st, right: coords.right - r.left + sl, bottom: coords.bottom - r.top + st };
  };

  Cm5Editor.prototype.coordsChar = function (coords, mode) {
    const view = this.cm6;
    if (!coords) return null;
    let x = coords.left, y = coords.top;
    if (mode === "div") {
      const r = view.contentDOM.getBoundingClientRect();
      x += r.left; y += r.top;
    } else {
      const r = view.scrollDOM.getBoundingClientRect();
      const st = view.scrollDOM.scrollTop || 0, sl = view.scrollDOM.scrollLeft || 0;
      x = x + r.left - sl; y = y + r.top - st;
    }
    try {
      const off = view.posAtCoords({ x, y }, false);
      if (off != null) return this.posFromIndex(off);
    } catch (e) { /* fall through */ }
    return null;
  };

  // -------------------------------------------------------------------------
  // lines / values
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.getValue = function () { return ng09Doc(this).toString(); };

  Cm5Editor.prototype.setValue = function (text) {
    const view = this.cm6;
    const doc = view.state.doc;
    for (const id in this.marks) delete this.marks[id];
    view.dispatch(view.state.update({
      changes: { from: 0, to: doc.length, insert: text == null ? "" : String(text) },
      selection: env().pe.cursor(0),
      scrollIntoView: true,
      userEvent: "set",
    }));
  };

  Cm5Editor.prototype.lineCount = function () { return ng09Doc(this).lines; };
  Cm5Editor.prototype.firstLine = function () { return 0; };
  Cm5Editor.prototype.lastLine = function () { return ng09Doc(this).lines - 1; };

  Cm5Editor.prototype.getLine = function (line) {
    const doc = ng09Doc(this);
    if (line < 0 || line >= doc.lines) return "";
    return doc.line(line + 1).text;
  };

  // Line handles: {offset} of a line start, mapped through every recorded
  // ChangeDesc; getLineNumber returns null once the mapped pos leaves ch==0.
  Cm5Editor.prototype.getLineHandle = function (row) {
    if (!this.$lineHandles) this.$lineHandles = new Map();
    let h = this.$lineHandles.get(row);
    if (!h) {
      h = { offset: ng09Off(this, { line: row, ch: 0 }) };
      this.$lineHandles.set(row, h);
    }
    return h;
  };

  Cm5Editor.prototype.getLineNumber = function (handle) {
    if (!handle || typeof handle.offset !== "number") return null;
    let off = handle.offset;
    for (const ch of this.$lineHandleChanges) {
      try { off = ch.mapPos(off, 0, env().ne.TrackAfter); } catch (e) { return null; }
    }
    const p = env().Nq(ng09Doc(this), off);
    if (!p || p.ch !== 0) return null;
    return p.line;
  };

  Cm5Editor.prototype.releaseLineHandles = function () {
    this.$lineHandles = null;
    this.$lineHandleChanges = [];
  };

  // -------------------------------------------------------------------------
  // selections
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.setCursor = function (lineOrPos, ch) {
    let pos;
    if (lineOrPos && typeof lineOrPos === "object" && lineOrPos.line !== undefined) pos = lineOrPos;
    else pos = { line: lineOrPos | 0, ch: (ch || 0) | 0 };
    const off = ng09ClipOffset(this, ng09Off(this, this.clipPos(pos)));
    const inNonVimOp = this.curOp && !this.curOp.isVimOp;
    this.cm6.dispatch(this.cm6.state.update({
      selection: env().pe.cursor(off),
      scrollIntoView: !inNonVimOp,
      userEvent: "select",
    }));
    if (inNonVimOp) this.onBeforeEndOperation();
  };

  Cm5Editor.prototype.getCursor = function (which) {
    which = which || "head";
    const r = this.cm6.state.selection.main;
    let off;
    if (which === "head") off = r.head;
    else if (which === "anchor") off = r.anchor;
    else if (which === "start") off = r.from;
    else if (which === "end") off = r.to;
    else throw new Error("Invalid cursor type");
    return this.posFromIndex(off);
  };

  Cm5Editor.prototype.listSelections = function () {
    return this.cm6.state.selection.ranges.map((r) => ({
      anchor: this.posFromIndex(r.anchor),
      head: this.posFromIndex(r.head),
    }));
  };

  Cm5Editor.prototype.getMainSelection = function () {
    const sels = this.listSelections();
    const idx = this.cm6.state.selection.mainIndex;
    return sels[idx] || sels[0] || null;
  };

  Cm5Editor.prototype.setSelections = function (ranges) {
    const view = this.cm6;
    const list = (ranges || []).map((r) => {
      const a = ng09ClipOffset(this, ng09Off(this, this.clipPos(r.anchor || r.head || { line: 0, ch: 0 })));
      const h = ng09ClipOffset(this, ng09Off(this, this.clipPos(r.head || r.anchor || { line: 0, ch: 0 })));
      if (a === h) return env().pe.cursor(h, 1);
      return env().pe.range(a, h);
    });
    if (!list.length) list.push(env().pe.cursor(view.state.selection.main.head));
    const mainIndex = Math.min((ranges && ranges.length - 1) || 0, list.length - 1);
    view.dispatch(view.state.update({
      selection: env().pe.create(list, mainIndex),
      scrollIntoView: true,
      userEvent: "select",
    }));
  };

  Cm5Editor.prototype.setSelection = function (anchor, head, options) {
    const a = ng09ClipOffset(this, ng09Off(this, this.clipPos(anchor || { line: 0, ch: 0 })));
    const h = head === undefined ? a : ng09ClipOffset(this, ng09Off(this, this.clipPos(head)));
    const range = a === h ? env().pe.cursor(h, 1) : env().pe.range(a, h);
    this.cm6.dispatch(this.cm6.state.update({
      selection: env().pe.create([range], 0),
      scrollIntoView: true,
      userEvent: "select",
    }));
    if (options && options.origin === "*mouse") this.onBeforeEndOperation();
  };

  Cm5Editor.prototype.forEachSelection = function (fn) {
    const ranges = ng09SelectionRanges(this);
    for (const r of ranges) {
      const anchor = this.posFromIndex(r.anchor !== undefined ? r.anchor : r.from);
      const head = this.posFromIndex(r.head !== undefined ? r.head : r.to);
      const rr = {
        anchor, head,
        from: this.posFromIndex(Math.min(r.anchor !== undefined ? r.anchor : r.from, r.head !== undefined ? r.head : r.to)),
        to: this.posFromIndex(Math.max(r.anchor !== undefined ? r.anchor : r.from, r.head !== undefined ? r.head : r.to)),
      };
      try { fn.call(rr, rr); } catch (e) { console.error(e); }
    }
  };

  Cm5Editor.prototype.isInMultiSelectMode = function () {
    if (this.virtualSelection && this.virtualSelection.ranges) return this.virtualSelection.ranges.length > 1;
    return this.cm6.state.selection.ranges.length > 1;
  };

  Cm5Editor.prototype.virtualSelectionMode = function () { return !!this.virtualSelection; };

  // -------------------------------------------------------------------------
  // text ranges
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.getRange = function (from, to) {
    const doc = ng09Doc(this);
    const a = ng09ClipOffset(this, ng09Off(this, this.clipPos(from || { line: 0, ch: 0 })));
    const b = to === undefined ? doc.length : ng09ClipOffset(this, ng09Off(this, this.clipPos(to)));
    return doc.sliceString(Math.min(a, b), Math.max(a, b));
  };

  Cm5Editor.prototype.replaceRange = function (text, from, to) {
    const a = ng09ClipOffset(this, ng09Off(this, this.clipPos(from || { line: 0, ch: 0 })));
    const b = to === undefined ? a : ng09ClipOffset(this, ng09Off(this, this.clipPos(to)));
    env().jq(this, {
      changes: { from: Math.min(a, b), to: Math.max(a, b), insert: text == null ? "" : String(text) },
      scrollIntoView: true,
      userEvent: "input.type",
    });
  };

  Cm5Editor.prototype.replaceSelection = function (text) {
    const view = this.cm6;
    const state = view.state;
    const ins = text == null ? "" : String(text);
    const ranges = state.selection.ranges.slice().sort((x, y) => y.from - x.from);
    const changes = [];
    const sels = [];
    for (const r of ranges) {
      changes.push({ from: r.from, to: r.to, insert: ins });
      sels.push(env().pe.cursor(r.from + ins.length));
    }
    if (!changes.length) return;
    view.dispatch(state.update({
      changes,
      selection: env().pe.create(sels.reverse(), state.selection.mainIndex),
      scrollIntoView: true,
      userEvent: "input.type",
    }));
  };

  Cm5Editor.prototype.replaceSelections = function (texts) {
    const view = this.cm6;
    const state = view.state;
    const ranges = state.selection.ranges.slice().sort((x, y) => y.from - x.from);
    const changes = [];
    const sels = [];
    ranges.forEach((r, i) => {
      const ins = texts && texts[i] != null ? String(texts[i]) : "";
      changes.push({ from: r.from, to: r.to, insert: ins });
      sels.push(env().pe.cursor(r.from + ins.length));
    });
    if (!changes.length) return;
    view.dispatch(state.update({
      changes,
      selection: env().pe.create(sels.reverse(), state.selection.mainIndex),
      scrollIntoView: true,
      userEvent: "input.type",
    }));
  };

  Cm5Editor.prototype.getSelection = function () { return this.getSelections().join("\n"); };

  Cm5Editor.prototype.getSelections = function () {
    const doc = ng09Doc(this);
    return this.cm6.state.selection.ranges.map((r) => doc.sliceString(r.from, r.to));
  };

  Cm5Editor.prototype.somethingSelected = function () {
    return this.cm6.state.selection.ranges.some((r) => !r.empty);
  };

  Cm5Editor.prototype.getInputField = function () { return this.cm6.contentDOM; };

  // -------------------------------------------------------------------------
  // folds / brackets / indent / exec
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.foldCode = function (pos) {
    const view = this.cm6;
    const off = ng09ClipOffset(this, ng09Off(this, this.clipPos(pos || this.getCursor())));
    const line = view.state.doc.lineAt(off);
    const range = host.cmFoldableRange(view.state, line.from, line.to);
    if (range) {
      view.dispatch(view.state.update({
        selection: env().pe.cursor(off),
        effects: host.cmFoldEffect.of(range),
        userEvent: "select",
      }));
      return true;
    }
    return false;
  };

  Cm5Editor.prototype.findMatchingBracket = function (pos) {
    const off = ng09ClipOffset(this, ng09Off(this, this.clipPos(pos || this.getCursor())));
    const state = this.cm6.state;
    for (const [at, dir] of [[off + 1, -1], [off, 1]]) {
      try {
        const m = env().Nd(state, at, dir, {});
        if (m) {
          const end = m.to !== undefined ? m.to : (m.end !== undefined ? m.end : m);
          const from = typeof end === "object" && end !== null ? (end.from !== undefined ? end.from : end.pos) : end;
          if (from !== undefined && from !== null) return { to: this.posFromIndex(from) };
        }
      } catch (e) { /* try next direction */ }
    }
    return { to: undefined };
  };

  Cm5Editor.prototype.scanForBracket = function (pos, dir, style, options) {
    options = options || {};
    const maxScanLineLength = options.maxScanLineLength || 10000;
    const maxScanLines = options.maxScanLines || 1000;
    const bracketRegex = options.bracketRegex || /[(){}[\]]/;
    const pairs = env().$q || {};
    const doc = ng09Doc(this);
    const start = this.clipPos(pos);
    const step = dir < 0 ? -1 : 1;
    let line = start.line, ch = start.ch;
    let depth = 0;
    const target = style;
    const targetPair = pairs[target];
    if (!targetPair) return null;
    const targetMatch = targetPair.charAt(0);
    const scanned = new Set();
    for (let n = 0; n < maxScanLines; n++) {
      const l = doc.line(Math.min(Math.max(line + 1, 1), doc.lines));
      const text = l.text;
      if (ch > maxScanLineLength) return null;
      const from = ch;
      const to = dir < 0 ? -1 : text.length;
      for (let i = from; i !== to; i += step) {
        const c = text.charAt(i);
        if (!bracketRegex.test(c)) continue;
        const p = pairs[c];
        if (!p) continue;
        // p = "match>" for openers, "match<" for closers
        const isOpen = p.charAt(1) === ">";
        const matchesTarget = c === target;
        if (matchesTarget) {
          if (depth === 0) {
            const wantOpen = targetPair.charAt(1) === ">";
            // found the bracket we're looking for when it faces the scan dir
            return { pos: { line: l.number - 1, ch: i }, ch: i };
          }
          depth += step > 0 ? (isOpen ? 1 : -1) : (isOpen ? -1 : 1);
          continue;
        }
        // count nesting of the target pair only
        if (p.charAt(0) === targetMatch) {
          depth += step > 0 ? (isOpen ? 1 : -1) : (isOpen ? -1 : 1);
        }
      }
      line += step;
      ch = dir < 0 ? doc.line(Math.min(Math.max(line + 1, 1), doc.lines)).length : 0;
      if (line < 0 || line >= doc.lines) return null;
      if (scanned.has(line)) return null;
      scanned.add(line);
    }
    return null;
  };

  Cm5Editor.prototype.indentLine = function (line, dir) {
    const doc = ng09Doc(this);
    if (line < 0 || line >= doc.lines) return;
    const l = doc.line(line + 1);
    this.cm6.dispatch(this.cm6.state.update({
      selection: env().pe.range(l.from, l.to),
      userEvent: "select",
    }));
    (dir ? env().PR : env().LR)(this.cm6);
  };

  Cm5Editor.prototype.indentMore = function () { env().PR(this.cm6); };
  Cm5Editor.prototype.indentLess = function () { env().LR(this.cm6); };

  Cm5Editor.prototype.execCommand = function (name) {
    const view = this.cm6;
    if (name === "indentAuto") return env().AR(view);
    if (name === "goLineLeft") {
      const c = this.getCursor();
      const line = ng09Doc(this).line(c.line + 1);
      this.setCursor({ line: c.line, ch: 0 });
      return true;
    }
    if (name === "goLineRight") {
      const c = this.getCursor();
      const doc = ng09Doc(this);
      const line = doc.line(c.line + 1);
      let off = line.to;
      if (off < doc.length && doc.sliceString(off, off + 1) !== "\n") off += 1;
      this.setCursor(this.posFromIndex(off));
      return true;
    }
    console.log(name + " is not implemented");
    return false;
  };

  Cm5Editor.prototype.moveH = function (amount, unit) {
    if (unit !== "char") return;
    const c = this.getCursor();
    this.setCursor({ line: c.line, ch: c.ch + amount });
  };

  // -------------------------------------------------------------------------
  // bookmarks / overlays / search cursor
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.setBookmark = function (pos, options) {
    const assoc = options && options.insertLeft ? -1 : 1;
    return new (env().tj)(this, ng09ClipOffset(this, ng09Off(this, this.clipPos(pos))), assoc);
  };

  Cm5Editor.prototype.addOverlay = function (overlay) {
    if (!overlay || !overlay.query) return undefined;
    const q = overlay.query;
    const source = q.source !== undefined ? String(q.source) : String(q);
    let search;
    try {
      search = new (env().uB)({
        search: source,
        regexp: true,
        caseSensitive: q.ignoreCase ? false : true,
        literal: false,
        wholeWord: !!q.wholeWord,
        replace: q.replace || "",
      });
    } catch (e) { return undefined; }
    if (!search || search.valid === false) return undefined;
    search.forVim = true;
    this.cm6Query = search;
    try { this.cm6.dispatch({ effects: env().yB.of(search) }); } catch (e) { /* no field */ }
    return search;
  };

  Cm5Editor.prototype.removeOverlay = function () {
    if (this.cm6Query) {
      try { this.cm6Query.forVim = false; } catch (e) { /* noop */ }
      this.cm6Query = null;
    }
    try { this.cm6.dispatch({ effects: env().yB.of(null) }); } catch (e) { /* no field */ }
  };

  Cm5Editor.prototype.getSearchCursor = function (query, start) {
    const f = this;
    const doc = ng09Doc(f);
    const isRe = query instanceof RegExp;
    let source, flags;
    if (isRe) {
      source = ng09EscapeBraceQuantifiers(query.source);
      flags = (query.ignoreCase ? "i" : "") + (query.multiline ? "m" : "");
    } else {
      source = String(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      flags = "";
    }
    let re;
    try { re = new RegExp(source, flags); } catch (e) { re = /(?!)/; }
    const state = { pos: 0, from: null, to: null, match: null };

    function setMatch(index, matched) {
      state.from = f.posFromIndex(index);
      state.to = f.posFromIndex(index + matched.length);
      state.pos = index + matched.length;
      return true;
    }

    function findNext() {
      const text = doc.toString();
      re.lastIndex = Math.max(0, Math.min(state.pos, text.length));
      const m = re.exec(text);
      if (!m) return false;
      state.match = m;
      return setMatch(m.index, m[0]);
    }

    function findPrevious() {
      const text = doc.toString();
      const end = Math.max(0, Math.min(state.pos, text.length));
      let radius = 10000;
      for (;;) {
        const from = Math.max(0, end - radius);
        re.lastIndex = from;
        let last = null, m;
        const sliceEnd = end;
        // iterate matches inside [from, end)
        const sub = text.slice(from, sliceEnd);
        const r2 = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
        r2.lastIndex = 0;
        while ((m = r2.exec(sub)) !== null) {
          if (m[0].length === 0) { r2.lastIndex++; continue; }
          const abs = from + m.index;
          if (abs + m[0].length <= end) last = { index: abs, text: m[0] };
          if (m.index === r2.lastIndex) r2.lastIndex++;
        }
        if (last) {
          state.match = [last.text];
          return setMatch(last.index, last.text);
        }
        if (from === 0) return false;
        radius *= 2;
        if (from - radius < -text.length) return false;
      }
    }

    if (start !== undefined && start !== null) {
      if (start.ch === null || start.ch === undefined) {
        const l = doc.line(Math.min(Math.max((start.line | 0) + 1, 1), doc.lines));
        state.pos = l.to;
      } else {
        state.pos = ng09ClipOffset(f, ng09Off(f, f.clipPos(start)));
      }
    } else {
      state.pos = doc.length;
    }

    return {
      findNext,
      findPrevious,
      find(backward) { return backward ? findPrevious() : findNext(); },
      from() { return state.from; },
      to() { return state.to; },
      replace(text) {
        if (state.from == null || state.to == null) return;
        const a = ng09Off(f, state.from), b = ng09Off(f, state.to);
        const ins = text == null ? "" : String(text);
        f.cm6.dispatch(f.cm6.state.update({
          changes: { from: a, to: b, insert: ins },
          scrollIntoView: true,
          userEvent: "input.type",
        }));
        state.from = f.posFromIndex(a);
        state.to = f.posFromIndex(a + ins.length);
        state.pos = a + ins.length;
      },
    };
  };

  // -------------------------------------------------------------------------
  // scroll / size / misc
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.getScrollInfo = function () {
    const d = this.cm6.scrollDOM;
    return {
      top: d.scrollTop, left: d.scrollLeft,
      width: d.clientWidth, height: d.clientHeight,
      clientWidth: d.clientWidth, clientHeight: d.clientHeight,
      scrollWidth: d.scrollWidth, scrollHeight: d.scrollHeight,
    };
  };

  Cm5Editor.prototype.scrollTo = function (x, y) {
    const d = this.cm6.scrollDOM;
    if (x !== null && x !== undefined) d.scrollLeft = x;
    if (y !== null && y !== undefined) d.scrollTop = y;
  };

  Cm5Editor.prototype.scrollInfo = function () { return 0; };

  Cm5Editor.prototype.scrollIntoView = function (pos, margin) {
    const view = this.cm6;
    if (pos !== undefined && pos !== null) {
      try { view.dispatch({ scrollIntoView: ng09ClipOffset(this, ng09Off(this, this.clipPos(pos))) }); return; } catch (e) { /* fall through */ }
    }
    try { view.scrollDOM.scrollIntoView({ block: "nearest" }); } catch (e) { /* noop */ }
  };

  Cm5Editor.prototype.getWrapperElement = function () { return this.cm6.dom; };
  Cm5Editor.prototype.getMode = function () { return { name: this.getOption("mode") }; };
  Cm5Editor.prototype.setSize = function (w, h) {
    const dom = this.cm6.dom;
    if (w !== null && w !== undefined && w !== "") dom.style.width = w + 4 + "px";
    if (h !== null && h !== undefined && h !== "") dom.style.height = h + "px";
    this.refresh();
  };
  Cm5Editor.prototype.refresh = function () {
    const view = this.cm6;
    try { if (view.measure) view.measure(); else if (view.requestMeasure) view.requestMeasure(); } catch (e) { /* noop */ }
  };
  Cm5Editor.prototype.destroy = function () { this.removeOverlay(); };
  Cm5Editor.prototype.getLastEditEnd = function () { return this.posFromIndex(this.$lastChangeEndOffset); };
  Cm5Editor.prototype.focus = function () { this.cm6.focus(); };
  Cm5Editor.prototype.blur = function () { try { this.cm6.contentDOM.blur(); } catch (e) { /* noop */ } };
  Cm5Editor.prototype.defaultTextHeight = function () { return this.cm6.defaultLineHeight; };

  // -------------------------------------------------------------------------
  // vertical movement / token type / overwrite
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.moveByChar = function (pos, forward, count) {
    const view = this.cm6;
    count = count || 1;
    const p = this.clipPos(pos);
    try {
      if (view.getNextTablePos) {
        const r = view.getNextTablePos(p, forward, count);
        if (r) return typeof r === "object" && r.pos !== undefined ? r.pos : r;
      }
      if (view.moveByChar) {
        const np = view.moveByChar(p, forward ? count : -count);
        if (np) {
          const a = this.posFromIndex(this.indexFromPos(p));
          const b = this.posFromIndex(this.indexFromPos(np));
          if (a && b && a.line === b.line) return b;
          return p;
        }
      }
    } catch (e) { /* fall through to offset math */ }
    const off = ng09ClipOffset(this, ng09Off(this, p) + (forward ? count : -count));
    return this.posFromIndex(off);
  };

  Cm5Editor.prototype.findPosV = function (pos, amount, unit, goalColumn) {
    const view = this.cm6;
    const doc = ng09Doc(this);
    const p = this.clipPos(pos);
    const lineH = view.defaultLineHeight || 20;
    const clientH = (view.dom && view.dom.clientHeight) || 0;
    const pageLines = Math.max(1, Math.floor(clientH / lineH) || 1);
    const stepLines = unit === "page" ? pageLines : 1;
    const dir = amount < 0 ? -1 : 1;
    let remaining = Math.abs(amount | 0);
    let cur = this.indexFromPos(p);
    let hitSide = false;
    let focusBefore = null;
    while (remaining-- > 0) {
      const l = doc.lineAt(cur);
      const targetNum = l.number + dir * stepLines;
      if (targetNum < 1 || targetNum > doc.lines) { hitSide = true; break; }
      const tl = doc.line(targetNum);
      let ch = goalColumn !== undefined && goalColumn !== null ? goalColumn : (cur - l.from);
      ch = Math.max(0, Math.min(ch, tl.length));
      let next = tl.from + ch;
      try {
        if (view.getNextPosUpDown) {
          const r = view.getNextPosUpDown(next, dir);
          if (r && typeof r === "object" && r.value !== undefined) { cur = r.value; continue; }
          if (typeof r === "number") next = r;
        }
      } catch (e) { /* noop */ }
      try {
        if (view.getNextTablePos) {
          const tr = view.getNextTablePos(this.posFromIndex(next), dir > 0, 1);
          if (tr && tr.value !== undefined) { cur = tr.value; continue; }
        }
      } catch (e) { /* noop */ }
      cur = next;
    }
    const res = this.posFromIndex(cur);
    if (hitSide && goalColumn !== undefined && goalColumn !== null && res.ch !== goalColumn) res.hitSide = true;
    if (focusBefore) res.focusBefore = focusBefore;
    return res;
  };

  Cm5Editor.prototype.getTokenTypeAt = function (pos) {
    const off = ng09ClipOffset(this, ng09Off(this, this.clipPos(pos || this.getCursor())));
    try {
      const tree = env().np(this.cm6.state, off, 50);
      if (!tree) return "";
      const node = tree.resolveInner ? tree.resolveInner(off, 1) : tree.resolve(off, 1);
      const name = node && node.type && node.type.name ? node.type.name : "";
      if (/comment/.test(name)) return "comment";
      if (/string/.test(name)) return "string";
      return "";
    } catch (e) { return ""; }
  };

  Cm5Editor.prototype.overWriteSelection = function (text) {
    const view = this.cm6;
    const state = view.state;
    const ins = text == null ? "" : String(text);
    const doc = state.doc;
    const changes = [];
    const sels = [];
    for (const r of state.selection.ranges) {
      let from = r.from, to = r.to;
      if (from === to) {
        const line = doc.lineAt(from);
        if (from < doc.length && doc.sliceString(from, from + 1) !== "\n") to = from + 1;
        else if (to > line.from && doc.sliceString(to - 1, to) !== "\n") from = to - 1;
      }
      changes.push({ from, to, insert: ins });
      sels.push(env().pe.cursor(from + ins.length));
    }
    changes.sort((a, b) => b.from - a.from);
    sels.reverse();
    view.dispatch(state.update({
      changes,
      selection: env().pe.create(sels, state.selection.mainIndex),
      scrollIntoView: true,
      userEvent: "input.type",
    }));
  };

  // -------------------------------------------------------------------------
  // options
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.setOption = function (name, value) {
    if (name === "keyMap") this.state.keyMap = value;
    else if (name === "textwidth") this.state.textwidth = value;
    this.options[name] = value;
  };

  Cm5Editor.prototype.getOption = function (name) {
    if (name === "firstLineNumber") return 1;
    if (name === "tabSize") return this.state.tabSize || 4;
    if (name === "readOnly") return this.state.readOnly;
    if (name === "indentWithTabs") { try { return this.cm6.state.facet(env().yp) === "\t"; } catch (e) { return false; } }
    if (name === "indentUnit") { try { const u = this.cm6.state.facet(env().yp); return u ? u.length : 2; } catch (e) { return 2; } }
    if (name === "textwidth") return this.state.textwidth;
    if (name === "keyMap") return this.state.keyMap || "vim";
    if (name === "mode") return this.state.mode;
    return this.options[name];
  };

  Cm5Editor.prototype.toggleOverwrite = function (on) {
    if (on === undefined) this.state.overwrite = !this.state.overwrite;
    else this.state.overwrite = !!on;
    return this.state.overwrite;
  };

  // -------------------------------------------------------------------------
  // hard wrap (CM5 hardWrap reflow)
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.hardWrap = function (options) {
    options = options || {};
    const view = this.cm6;
    const doc = ng09Doc(this);
    const from = options.from !== undefined && options.from !== null
      ? ng09ClipOffset(this, ng09Off(this, this.clipPos(options.from)))
      : 0;
    const to = options.to !== undefined && options.to !== null
      ? ng09ClipOffset(this, ng09Off(this, this.clipPos(options.to)))
      : doc.length;
    const column = options.column || this.getOption("textwidth") || 80;
    const allowMerge = options.allowMerge !== false;
    const maxIndent = 5;

    const startLine = doc.lineAt(from);
    const endLine = doc.lineAt(Math.max(from, to - 1));
    const texts = [];
    for (let n = startLine.number; n <= endLine.number; n++) texts.push(doc.line(n).text);

    // wrapPoint: prefer a whitespace break at/before column; keep <= maxIndent.
    function wrapPoint(text) {
      if (text.length <= column) return -1;
      let best = -1;
      const limit = Math.min(column, text.length);
      for (let i = limit; i >= Math.max(0, limit - maxIndent * 4); i--) {
        const c = text.charAt(i);
        if (c === " " || c === "\t") { best = i; break; }
      }
      if (best < 0) {
        for (let i = Math.min(column, text.length - 1); i > 0; i--) {
          if (text.charAt(i) === " " || text.charAt(i) === "\t") { best = i; break; }
        }
      }
      return best < 0 ? column : best;
    }

    const out = [];
    let lastProcessed = startLine.number - 1;
    for (const text of texts) {
      let rest = text;
      let guard = 0;
      while (rest.length > column && guard++ < 1000) {
        const cut = wrapPoint(rest);
        if (cut <= 0) break;
        out.push(rest.slice(0, cut).replace(/\s+$/, ""));
        rest = rest.slice(cut).replace(/^\s+/, "");
      }
      out.push(rest.replace(/\s+$/, ""));
      lastProcessed = startLine.number + texts.indexOf(text);
    }

    // merge pass: join short lines while the combined line fits.
    if (allowMerge) {
      for (let i = 0; i < out.length - 1; i++) {
        const joined = out[i].replace(/\s+$/, "") + " " + out[i + 1].replace(/^\s+/, "");
        if (joined.length <= column) {
          out[i] = joined;
          out.splice(i + 1, 1);
          i--;
        }
      }
    }

    const newText = out.join("\n");
    const rangeFrom = startLine.from;
    const rangeTo = endLine.to;
    view.dispatch(view.state.update({
      changes: { from: rangeFrom, to: rangeTo, insert: newText },
      userEvent: "input.type",
      scrollIntoView: true,
    }));
    return lastProcessed;
  };

  // -------------------------------------------------------------------------
  // tag helpers (static surface also exposed on the constructor)
  // -------------------------------------------------------------------------

  Cm5Editor.prototype.findEnclosingTag = function (pos) {
    const r = env().Jq(this, this.clipPos(pos || this.getCursor()));
    if (!r) return null;
    return {
      open: r.open ? { from: this.posFromIndex(r.open.from), to: this.posFromIndex(r.open.to) } : undefined,
      close: r.close ? { from: this.posFromIndex(r.close.from), to: this.posFromIndex(r.close.to) } : undefined,
    };
  };

  Cm5Editor.prototype.findMatchingTag = function (pos) {
    const enc = this.findEnclosingTag(pos);
    if (!enc) return null;
    const p = this.clipPos(pos || this.getCursor());
    const off = this.indexFromPos(p);
    if (enc.open && off >= this.indexFromPos(enc.open.from) && off <= this.indexFromPos(enc.open.to)) {
      return { from: enc.open.from, to: enc.open.to };
    }
    if (enc.close && off >= this.indexFromPos(enc.close.from) && off <= this.indexFromPos(enc.close.to)) {
      return { from: enc.close.from, to: enc.close.to };
    }
    return enc.open ? { from: enc.open.from, to: enc.open.to } : null;
  };

  // -------------------------------------------------------------------------
  // statics
  // -------------------------------------------------------------------------

  Cm5Editor.isMac = /Mac/.test(typeof navigator !== "undefined" ? (navigator.platform || navigator.userAgent || "") : "");

  Cm5Editor.Pos = function (line, ch) { return new (env().Bq)(line, ch); };
  Cm5Editor.StringStream = function (...args) { return new (env().Vd)(...args); };

  Cm5Editor.isWordChar = function (ch) { return /[\w$]/.test(ch); };

  Cm5Editor.commands = {
    cursorCharLeft(f) { const v = f && f.cm6 ? f.cm6 : f; return env().PF(v); },
    redo(f) {
      if (f && f.cm6) { env().Uq(f, false); return true; }
      return env().iF(f);
    },
    undo(f) {
      if (f && f.cm6) { env().Uq(f, true); return true; }
      return env().nF(f);
    },
    newlineAndIndent(f) { const v = f && f.cm6 ? f.cm6 : f; return env().Oq(v); },
    newlineAndIndentBefore(f) {
      const v = f && f.cm6 ? f.cm6 : f;
      const s = v.state;
      const head = s.selection.main.head;
      const line = s.doc.lineAt(head);
      v.dispatch(s.update({
        changes: { from: line.from, insert: "\n" },
        selection: env().pe.cursor(line.from),
        userEvent: "input.type",
        scrollIntoView: true,
      }));
      try { env().AR(v); } catch (e) { /* noop */ }
      return true;
    },
    indentAuto(f) { const v = f && f.cm6 ? f.cm6 : f; return env().AR(v); },
  };

  Object.defineProperty(Cm5Editor, "keys", { get: () => env().Rq || {}, configurable: true });

  Cm5Editor.on = function (target, type, fn) { env().Vq(target, type, fn); };
  Cm5Editor.off = function (target, type, fn) { env().Hq(target, type, fn); };
  Cm5Editor.signal = function (target, type, ...args) { env().zq(target, type, ...args); };

  Cm5Editor.e_preventDefault = function (e) {
    if (e && e.preventDefault) e.preventDefault();
    else if (e) e.returnValue = false;
  };
  Cm5Editor.e_stop = function (e) {
    if (!e) return;
    if (e.stopPropagation) e.stopPropagation();
    Cm5Editor.e_preventDefault(e);
  };

  Cm5Editor.lookupKey = function (name, map, fn) {
    const tbl = env().Rq || {};
    let key = tbl[name];
    if (key === undefined && map && map[name] !== undefined) key = map[name];
    if (key !== undefined && typeof fn === "function") fn(key);
  };

  Cm5Editor.addClass = function () {};
  Cm5Editor.rmClass = function () {};

  Cm5Editor.findEnclosingTag = function (cm, pos) {
    if (cm && cm.findEnclosingTag) return cm.findEnclosingTag(pos);
    return null;
  };
  Cm5Editor.findMatchingTag = function (cm, pos) {
    if (cm && cm.findMatchingTag) return cm.findMatchingTag(pos);
    return null;
  };

  Cm5Editor.keyName = undefined;

  return Cm5Editor;
}

// DECISIONS:
// - commands table maps onto env helpers: cursorCharLeft->PF, undo/redo->Uq
//   (facade) or nF/iF (raw view), newlineAndIndent->Oq (insertNewlineAndIndent),
//   newlineAndIndentBefore->custom (spec had no env binding), indentAuto->AR.
// - The dispatch patch rebuilds the Transaction via state.update purely to feed
//   onChange/onSelectionChange; original dispatch args pass through untouched.
// - onBeforeEndOperation fires `change`/`cursorActivity` handlers immediately
//   after every non-operation() dispatch (CM5 implicit per-dispatch op) and at
//   the outermost operation() exit; it resets the change list but keeps
//   curOp.$changeStart so s07cm6RestoreCursor can read it after undo/redo.
// - addOverlay/removeOverlay dispatch env().yB (the plain StateEffect left for
//   the vim-search overlay) with the uB query object / null; fold uses
//   env().Gp (cmFoldedRanges) + env().jp (cmUnfoldEffect) for vim-op unfolds.
// - getSearchCursor implements the regex path per spec ({}-quantifier escaping,
//   backward 10k-char expanding windows) and a literal path via escaped source;
//   env().UR (the inherited CM5 string SearchCursor) is left unused.
// - scanForBracket is a simplified CM5-style line scan over the pair table
//   env().$q; findMatchingBracket adapts env().Nd's result defensively.
// - findPosV is a reasonable line/page-step implementation using the optional
//   view.getNextPosUpDown/getNextTablePos hooks; focusBefore is parsed but never
//   attached (metadata-editor handoff target is not reachable from env names).
// - hardWrap is a self-contained wrap/merge reflow; wrapPoint prefers the last
//   whitespace at/before the column within a bounded look-back.
// - forEachSelection passes a {anchor,head,from,to} Pos range object as both
//   `this` and first arg (CM5 range convention approximated).
// - getOption("mode")/state.mode is undefined unless setOption stored it;
//   getMode() therefore returns {name: undefined} which still satisfies the
//   "object" contract.
// - Pos/StringStream statics are lazy wrappers around env().Bq/env().Vd so the
//   bundle values may initialize after this module; `keys` is a lazy getter
//   over env().Rq.
// - openNotification builds a plain .cm-notification div appended to
//   view.dom (falls back to document.body), registers its close fn through
//   env().Kq, auto-closes after options.duration ?? 5000 (0 disables), and
//   returns the close function.
// - Unresolved: exact semantics of env().Wq ({}), env().Zq (noop), env().aN/
//   oN/eP probes, and whether the overlay effect value should be the query or
//   a {query} wrapper — chosen forms are documented above.
