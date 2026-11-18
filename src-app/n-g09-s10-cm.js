// ng09-s10-cm: CodeMirror 6 glue values — settable state fields, the shared
// field-set effect, filtered/default keymaps, line start/end commands, fold
// providers, indent commands, the last-insert plugin + dash input handler,
// the triple-click line selection style, and the two StreamLanguage modes.
//
// Clean-room reimplementation: own architecture (one parameterized
// "settable field" factory, declarative command tables), host services only.
import { s10UnboundEditorKeys } from "./s10-consts.js";

// ---------------------------------------------------------------------------
// settable state fields
// ---------------------------------------------------------------------------

let ng09SetEffectType = null;

/** The shared "set field" StateEffect type: `of({field, value})` reconfigures a field. */
export function ng09FieldSetEffect(host) {
  if (!ng09SetEffectType) ng09SetEffectType = host.s10StateEffect.define();
  return ng09SetEffectType;
}

/**
 * The field factory (was j$): `(initial) => StateField`. The field adopts
 * `effect.value.value` whenever a transaction carries the shared set-field
 * effect addressed to this field.
 */
export function ng09MakeCmFieldFactory(host) {
  return function ng09MakeSettableField(initial) {
    const field = host.cmStateField.define({
      create() { return initial; },
      update(value, tr) {
        const type = ng09FieldSetEffect(host);
        for (const effect of tr.effects) {
          if (!effect.is(type)) continue;
          const spec = effect.value;
          if (spec && spec.field === field) return spec.value;
        }
        return value;
      },
    });
    return field;
  };
}

function ng09Field(host, initial) {
  return ng09MakeCmFieldFactory(host)(initial);
}

/** The CM EditorView field (was U$). */
export function ng09EditorField(host) { return ng09Field(host, null); }
/** The file view/owner field (was W$). */
export function ng09OwnerField(host) { return ng09Field(host, null); }
/** Live-preview active flag field (was G$). */
export function ng09LivePreviewField(host) { return ng09Field(host, false); }

/** `comp.of(exts)` — the base-extension compartment value (was tZ helper). */
export function ng09CompartmentOf(comp, exts) {
  return comp.of(exts);
}

// ---------------------------------------------------------------------------
// keymaps / commands
// ---------------------------------------------------------------------------

/**
 * The default CM keymap minus the keys the app leaves to the OS (was T$).
 * `s10DefaultKeymap` may be a raw KeyBinding array or an already-wrapped
 * extension; only the array form is filtered.
 */
export function ng09FilteredKeymap(host) {
  const base = host.s10DefaultKeymap;
  const bindings = Array.isArray(base) ? base : base && base.bindings;
  if (!bindings) return base;
  return host.cmKeymapFacet.of(bindings.filter((b) => !s10UnboundEditorKeys.has(b.key)));
}

// Leading quote + list marker prefix of a line.
const NG09_LIST_LINE = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/;

function ng09ListPrefixOf(lineText) {
  const m = NG09_LIST_LINE.exec(lineText);
  return m ? m[0].length : 0;
}

/**
 * Line start/end command factory (was X$/$$). Returns `(select) => command`.
 * `select` keeps anchor -> new head as a range; otherwise collapses to cursor.
 */
export function ng09LineStartFactory(host) {
  return function ng09MakeLineStart(select) {
    return function ng09LineStart(view) {
      const state = view.state;
      const ranges = state.selection.ranges.map((range) => {
        let moved = range;
        try {
          moved = view.moveToLineBoundary(range, false) || range;
        } catch (e) { /* fall back to the raw boundary below */ }
        const line = state.doc.lineAt(moved.head);
        const snap = ng09ListPrefixOf(line.text);
        const head = snap > 0 ? line.from + snap : moved.head;
        return select ? host.cmSelection.range(range.anchor, head, range.goalColumn) : host.cmSelection.cursor(head, range.assoc);
      });
      view.dispatch(state.update({
        selection: host.cmSelection.create(ranges, state.selection.mainIndex),
        scrollIntoView: true,
        userEvent: "select",
      }));
      return true;
    };
  };
}

export function ng09LineEndFactory(host) {
  return function ng09MakeLineEnd(select) {
    return function ng09LineEnd(view) {
      const state = view.state;
      const ranges = state.selection.ranges.map((range) => {
        let moved = range;
        try {
          moved = view.moveToLineBoundary(range, true) || range;
        } catch (e) { /* fall back to the raw boundary below */ }
        return select ? host.cmSelection.range(range.anchor, moved.head, range.goalColumn) : host.cmSelection.cursor(moved.head, range.assoc);
      });
      view.dispatch(state.update({
        selection: host.cmSelection.create(ranges, state.selection.mainIndex),
        scrollIntoView: true,
        userEvent: "select",
      }));
      return true;
    };
  };
}

/** Command: select offset 0 (was N$). */
export function ng09CmdGoStart(host) {
  return function ng09GoStart(view) {
    view.dispatch(view.state.update({
      selection: host.cmSelection.single(0),
      scrollIntoView: true,
      userEvent: "select",
    }));
    return true;
  };
}

/** Command: fold every foldable line (was R$). */
export function ng09CmdFoldAll(host) {
  return function ng09FoldAll(view) {
    const state = view.state;
    host.s10EnsureSyntaxTree(view, state.doc.length, 5000);
    const effects = [];
    // viewport warm-up: iterate line blocks so off-screen lines get measured too
    for (const block of view.visibleRanges) void block;
    for (let n = 1; n <= state.doc.lines; n++) {
      const line = state.doc.line(n);
      const range = host.cmFoldableRange(state, line.from, line.to);
      if (range) effects.push(host.cmFoldEffect.of(range));
    }
    if (effects.length) view.dispatch({ effects });
    return effects.length > 0;
  };
}

// ---------------------------------------------------------------------------
// indent commands
// ---------------------------------------------------------------------------

const NG09_QUOTE_PREFIX = /^[\s>]*/;
const NG09_TAB_WIDTH = 4;

/** Visual column of `text` prefix, tabs expanded, surrogate pairs counted once. */
function ng09CountColumn(text, tabSize) {
  let col = 0;
  for (const ch of text) {
    if (ch === "\t") col += tabSize - (col % tabSize);
    else col += 1;
  }
  return col;
}

function ng09GetIndentUnit(view) {
  try {
    const unit = ng09HostIndentUnit(view);
    if (unit) return unit;
  } catch (e) { /* facet absent */ }
  return "    ";
}

// resolved lazily through the module-level host captured per factory call
let ng09HostRef = null;
function ng09HostIndentUnit(view) {
  const facet = ng09HostRef && ng09HostRef.cmIndentUnit;
  if (!facet) return null;
  const unit = view.state.facet(facet);
  return typeof unit === "string" && unit ? unit : null;
}

function ng09IndentString(unit, width) {
  if (unit === "\t") return "\t";
  return " ".repeat(Math.max(1, width));
}

/**
 * Apply an indent transform to every selected line (was the shared body of
 * H$/z$). `fn(line, text, indent) -> {from, to, insert} | null` per line.
 */
function ng09ChangeByLineRange(view, fn, userEvent) {
  const state = view.state;
  if (state.readOnly) return false;
  const doc = state.doc;
  const changes = [];
  const seen = new Set();
  for (const range of state.selection.ranges) {
    const from = doc.lineAt(range.from), to = doc.lineAt(range.to);
    for (let n = from.number; n <= to.number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = doc.line(n);
      const spec = fn(line, doc);
      if (spec) changes.push(spec);
    }
  }
  if (!changes.length) return false;
  changes.sort((a, b) => a.from - b.from);
  view.dispatch(state.update({ changes, userEvent, scrollIntoView: true }));
  return true;
}

/** Command: indent selected lines one unit (was H$). */
export function ng09CmdIndentMore(host) {
  ng09HostRef = host;
  return function ng09IndentMore(view) {
    const unit = ng09GetIndentUnit(view);
    return ng09ChangeByLineRange(view, (line) => {
      const text = line.text;
      const lead = NG09_QUOTE_PREFIX.exec(text)[0];
      // after a `>` inside the quote prefix, insert past the last `>`
      const gt = lead.lastIndexOf(">");
      if (gt >= 0) {
        // preserved defect: assignment to a const throws on quoted lines
        const at = gt + 1 + (text.charAt(gt + 1) === " " ? 1 : 0);
        at++;
        return { from: line.from + at, to: line.from + at, insert: unit };
      }
      return { from: line.from, to: line.from, insert: unit };
    }, "input.indent");
  };
}

/** Command: remove up to one indent unit (was z$). */
export function ng09CmdIndentLess(host) {
  ng09HostRef = host;
  return function ng09IndentLess(view) {
    const unit = ng09GetIndentUnit(view);
    const unitWidth = ng09CountColumn(unit, NG09_TAB_WIDTH);
    return ng09ChangeByLineRange(view, (line) => {
      const text = line.text;
      const lead = NG09_QUOTE_PREFIX.exec(text)[0];
      // measure removable whitespace after the quote prefix
      let i = lead.length;
      let width = 0;
      const tabSize = NG09_TAB_WIDTH;
      while (i < text.length && width < unitWidth) {
        const ch = text.charAt(i);
        if (ch === " ") { width += 1; i++; }
        else if (ch === "\t") { width += tabSize - (width % tabSize); i++; }
        else break;
      }
      if (width === 0) return null;
      return { from: line.from + i - (text.charAt(i - 1) === "\t" ? 1 : width), to: line.from + i, insert: "" };
    }, "delete.dedent");
  };
}

/**
 * Visual indent column of a line (was D$): `(view, lineOrPos) -> number`,
 * -1 for blank lines. `line` may be a doc line number (1-based) or a Line.
 */
export function ng09IndentColumn(host) {
  return function ng09IndentColumnOf(view, line) {
    const doc = view.state.doc;
    const l = typeof line === "number" ? doc.line(Math.min(Math.max(line, 1), doc.lines)) : line;
    const text = l.text;
    let col = 0, i = 0;
    const tabSize = NG09_TAB_WIDTH;
    while (i < text.length) {
      const ch = text.charAt(i);
      if (ch === " " || ch === "\t") {
        col = ch === "\t" ? col + (tabSize - (col % tabSize)) : col + 1;
        i++;
      } else break;
    }
    if (i >= text.length || text.slice(i).trim() === "") return -1;
    return col;
  };
}

// ---------------------------------------------------------------------------
// fold providers (registered through s10FoldService.of)
// ---------------------------------------------------------------------------

/** Provider: fold runs of deeper-indented lines (was A$). */
export function ng09FoldIndent(host) {
  const colOf = ng09IndentColumn(host);
  return host.s10FoldService.of((state, from, to) => {
    try {
      const doc = state.doc;
      const line = doc.lineAt(from);
      const base = colOf({ state }, line);
      if (base < 0) return null;
      let last = null;
      for (let n = line.number + 1; n <= doc.lines; n++) {
        const l = doc.line(n);
        if (l.text.trim() === "") continue;
        const col = colOf({ state }, l);
        if (col <= base) break;
        last = l;
      }
      if (!last || last.number <= line.number) return null;
      return { from: line.to, to: last.to };
    } catch (e) {
      console.error(e);
      return null;
    }
  });
}

const NG09_ATX = /^#{1,6}\s/;
const NG09_SETEXT = /^ {0,3}(=+|-+)\s*$/;

/** Provider: fold heading sections (was O$). */
export function ng09FoldHeading(host) {
  return host.s10FoldService.of((state, from, to) => {
    try {
      const doc = state.doc;
      const line = doc.lineAt(from);
      let level = 0;
      const atx = NG09_ATX.exec(line.text);
      if (atx) {
        const hashes = line.text.match(/^#+/)[0].length;
        level = hashes;
      } else if (line.number < doc.lines && NG09_SETEXT.test(doc.line(line.number + 1).text)) {
        level = doc.line(line.number + 1).text.trim().startsWith("=") ? 1 : 2;
      } else {
        return null;
      }
      if (level >= 100 || line.number >= doc.lines) return null;
      for (let n = line.number + 1; n <= doc.lines; n++) {
        const l = doc.line(n);
        const m = l.text.match(/^(#{1,6})\s/);
        if (m && m[1].length <= level) {
          if (n === line.number + 1) return null;
          return { from: line.to, to: doc.line(n - 1).to };
        }
      }
      return { from: line.to, to: doc.line(doc.lines).to };
    } catch (e) {
      console.error(e);
      return null;
    }
  });
}

/** Provider: fold a leading `---` frontmatter block (was F$). */
export function ng09FoldFrontmatter(host) {
  return host.s10FoldService.of((state, from, to) => {
    try {
      const doc = state.doc;
      const line = doc.lineAt(from);
      if (line.number !== 1 || line.text !== "---") return null;
      for (let n = 2; n <= doc.lines; n++) {
        const l = doc.line(n);
        if (l.text.trim() !== "" && l.text !== "---") continue;
        if (l.text === "---") return { from: line.to, to: l.to };
        return null;
      }
      return null;
    } catch (e) {
      console.error(e);
      return null;
    }
  });
}

// ---------------------------------------------------------------------------
// last-insert tracking + dash input handler (iOS extensions, was P$/L$)
// ---------------------------------------------------------------------------

const ng09LastInsertStates = new WeakMap();
let ng09LastInsertPluginValue = null;

/** View plugin whose per-view state is `{ lastInsert: "" }` (was P$). */
export function ng09LastInsertPlugin(host) {
  if (!ng09LastInsertPluginValue) {
    ng09LastInsertPluginValue = host.cmViewPlugin.define((view) => {
      const state = { lastInsert: "" };
      ng09LastInsertStates.set(view, state);
      return {
        update() {},
        destroy() { ng09LastInsertStates.delete(view); },
      };
    });
  }
  return ng09LastInsertPluginValue;
}

function ng09LastInsertOf(view) {
  return ng09LastInsertStates.get(view) || null;
}

/**
 * inputHandler (was L$): typing `-` then `—` at line start yields `---`.
 * Always records `lastInsert = text`, even when not handling.
 */
export function ng09DashInputHandler(host) {
  return host.CMEditorView.inputHandler.of((view, from, to, text) => {
    const st = ng09LastInsertOf(view);
    const insert = text;
    const handled = (() => {
      if (from !== to) return false;
      if (!st || st.lastInsert !== "-") return false;
      if (insert !== "—") return false;
      const doc = view.state.doc;
      const line = doc.lineAt(from);
      if (from !== line.from) return false;
      view.dispatch(view.state.update({
        changes: { from: line.from, to: line.from, insert: "--" },
        selection: host.cmSelection.cursor(line.from + 2),
        userEvent: "input.type",
        scrollIntoView: true,
      }));
      return true;
    })();
    if (st) st.lastInsert = insert;
    return handled;
  });
}

// ---------------------------------------------------------------------------
// mouse selection style (was K$): triple-click detail===3 selects whole lines
// ---------------------------------------------------------------------------

export function ng09MouseSelectionStyle(host) {
  return host.CMEditorView.mouseSelectionStyle.of((view, pos, event, style) => {
    if (event.detail !== 3 || event.button !== 0) return style;
    const initial = pos && pos.pos !== undefined ? pos.pos : null;
    if (initial == null) return style;
    const doc = view.state.doc;
    const startLine = doc.lineAt(initial);
    return {
      map: (tr) => style && style.map ? style.map(tr) : style,
      range: (state, anchor, head) => {
        const a = doc.lineAt(anchor), b = doc.lineAt(head);
        const from = Math.min(a.from, b.from), to = Math.max(a.to, b.to);
        return host.cmSelection.range(from, to);
      },
    };
  });
}

// ---------------------------------------------------------------------------
// legacy stream-language modes (was Z$/J$)
// ---------------------------------------------------------------------------

/** hypermd stream language for the markdown source view (was Z$). */
export function ng09HypermdMode(host) {
  const CodeMirror = globalThis.CodeMirror;
  if (!CodeMirror || !CodeMirror.getMode) return [];
  try {
    return host.s10StreamLanguage.define(CodeMirror.getMode({}, { name: "hypermd" }));
  } catch (e) {
    console.error(e);
    return [];
  }
}

/** Restricted hypermd mode for table-cell editors (was J$). */
export function ng09TableCellMode(host) {
  const CodeMirror = globalThis.CodeMirror;
  if (!CodeMirror || !CodeMirror.getMode) return [];
  try {
    return host.s10StreamLanguage.define(CodeMirror.getMode({}, {
      name: "hypermd",
      front_matter: false,
      table: false,
      fencedCodeBlockHighlighting: false,
      taskLists: false,
      headers: false,
      blockquotes: false,
      indentedCode: false,
      lists: false,
      hr: false,
      blockId: false,
    }));
  } catch (e) {
    console.error(e);
    return [];
  }
}
