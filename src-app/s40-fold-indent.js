// s40 slice: the live-preview fold and indent-guide decorations of the
// CodeMirror 6 editor. Replaces the inherited top-level declarations:
//   EV      -> s40FoldedRangeAt          (leftmost folded range overlapping a span)
//   MV      -> s40FoldIndicator          (widget class for the fold caret)
//   SV/xV   -> s40FoldedDeco/s40FoldableDeco (the two shared widget decorations)
//   TV      -> s40FoldViewPlugin         (rebuilds fold marks per viewport)
//   DV      -> s40FoldTransactionFilter  (editing folded text unfolds it)
//   AV      -> s40FoldDecorations        (the whole extension array)
//   PV/LV/IV-> s40IndentMarkPlain/Active/Spacing (indent-guide mark decorations)
//   OV      -> s40IndentGuides           (the indent-guide view plugin)
// Left inherited on purpose: kV and CV are upstream @codemirror/view
// drawSelection/layer internals (cursor blink rate, secondary-selection layer),
// covered by the CodeMirror 6 entry in THIRD_PARTY.md.
import { inherit, methods } from "./inherit.js";
import { ng15MarkItemCollapsed } from "./n-g15-tree.js";

/** Leftmost range of `ranges` overlapping [from, to], or null (was EV). */
function s40FirstFolded(ranges, from, to) {
  let found = null;
  ranges.between(from, to, (a, b) => {
    if (!found || found.from > a) found = { from: a, to: b };
  });
  return found;
}

export function s40FoldedRangeAt(ranges, from, to) {
  return s40FirstFolded(ranges, from, to);
}

// ---------------------------------------------------------------------------
// Fold indicator widget (was MV): a small caret shown on folded / foldable lines.
// ---------------------------------------------------------------------------

let s40FoldCls = null;

/** The FoldIndicator widget class, built once against the host bindings (was MV). */
export function s40FoldIndicator(host) {
  if (s40FoldCls) return s40FoldCls;

  function FoldIndicator(folded) {
    const self = host.EmbedWidgetBase.call(this) || this;
    self.folded = folded;
    return self;
  }
  inherit(FoldIndicator, host.EmbedWidgetBase);
  methods(FoldIndicator, {
    eq(other) {
      return other.folded == this.folded;
    },
    toDOM(view) {
      const el = host.createDiv("cm-fold-indicator");
      const icon = el.createDiv("collapse-indicator collapse-icon");
      ng15MarkItemCollapsed(el, this.folded);
      host.setIcon(icon, "right-triangle");
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", (e) => {
        const pos = view.posAtDOM(el);
        const line = view.state.doc.lineAt(pos);
        const folded = s40FirstFolded(host.cmFoldedRanges(view.state), line.from, line.to);
        if (folded) {
          view.dispatch({ effects: host.cmUnfoldEffect.of(folded) });
          e.preventDefault();
          return;
        }
        const foldable = host.cmFoldableRange(view.state, line.from, line.to);
        if (foldable) {
          view.dispatch({ effects: host.cmFoldEffect.of(foldable) });
          e.preventDefault();
        }
      });
      return el;
    },
  });

  s40FoldCls = FoldIndicator;
  return FoldIndicator;
}

// The two shared widget decorations (were SV = folded, xV = foldable).
const s40FoldDecos = new Map();

function s40FoldDeco(host, folded) {
  let deco = s40FoldDecos.get(folded);
  if (!deco) {
    deco = host.cmDecoration.widget({ widget: new (s40FoldIndicator(host))(folded) });
    s40FoldDecos.set(folded, deco);
  }
  return deco;
}

export function s40FoldedDeco(host) {
  return s40FoldDeco(host, true);
}

export function s40FoldableDeco(host) {
  return s40FoldDeco(host, false);
}

// ---------------------------------------------------------------------------
// Fold decoration view plugin (was TV): marks every viewport line that sits
// inside a folded range (folded caret) or can be folded (unfolded caret).
// ---------------------------------------------------------------------------

export function s40FoldViewPlugin(host) {
  class FoldDecorations {
    constructor(view) {
      this.decorations = host.cmDecoration.none;
      this.wasComposing = false;
      this.buildDeco(view);
    }

    update(tr) {
      if (tr.view.composing) {
        this.decorations = this.decorations.map(tr.changes);
        this.wasComposing = true;
        return;
      }
      const languageChanged = tr.startState.facet(host.s40cmLanguageFacet) !== tr.state.facet(host.s40cmLanguageFacet);
      if (
        tr.docChanged ||
        tr.viewportChanged ||
        languageChanged ||
        host.cmFoldedRanges(tr.startState) !== host.cmFoldedRanges(tr.state) ||
        this.wasComposing
      ) {
        this.wasComposing = false;
        this.buildDeco(tr.view);
      }
    }

    buildDeco(view) {
      const builder = new host.s20CmRangeSet();
      const folded = host.cmFoldedRanges(view.state);
      for (const block of view.viewportLineBlocks) {
        let deco = null;
        if (s40FirstFolded(folded, block.from, block.to)) deco = s40FoldDeco(host, true);
        else if (host.cmFoldableRange(view.state, block.from, block.to)) deco = s40FoldDeco(host, false);
        if (!deco) continue;
        const text = view.state.doc.sliceString(block.from, block.to);
        const at = block.from + text.match(/^\s*/)[0].length;
        builder.add(at, at, deco);
      }
      this.decorations = builder.finish();
    }
  }
  return FoldDecorations;
}

// Transaction filter (was DV): a doc change inside a folded range emits the
// matching unfold effects so the fold opens instead of corrupting.
export function s40FoldTransactionFilter(host) {
  return host.cmState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !host.notSetUserEvent(tr)) return tr;
    const folded = host.cmFoldedRanges(tr.startState).map(tr.changes);
    const effects = [];
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      folded.between(fromA, fromB, (from, to) => {
        effects.push(host.cmUnfoldEffect.of({ from, to }));
      });
    });
    return [tr, { effects, sequential: true }];
  });
}

// The full fold extension array (was AV).
export function s40FoldDecorations(host) {
  const plugin = host.cmViewPlugin.define((view) => new (s40FoldViewPlugin(host))(view), {
    decorations: (p) => p.decorations,
  });
  return [
    plugin,
    host.cmView.atomicRanges.of((view) => host.cmFoldedRanges(view.state)),
    s40FoldTransactionFilter(host),
  ];
}

// ---------------------------------------------------------------------------
// Indent guides (were PV/LV/IV marks and the OV view plugin): vertical guides
// at each indent level of the list/quote block around the cursor.
// ---------------------------------------------------------------------------

const S40_INDENT_LEAD = /^[\s>]+/;
const S40_INDENT_STEP = /^(\t| {4})/;

let s40IndentDecos = null;

function s40IndentDecoSet(host) {
  if (!s40IndentDecos) {
    s40IndentDecos = [
      host.cmDecoration.mark({ class: "cm-indent" }),
      host.cmDecoration.mark({ class: "cm-indent cm-active-indent" }),
      host.cmDecoration.mark({ class: "cm-indent-spacing" }),
    ];
  }
  return s40IndentDecos;
}

export function s40IndentMarkPlain(host) {
  return s40IndentDecoSet(host)[0];
}

export function s40IndentMarkActive(host) {
  return s40IndentDecoSet(host)[1];
}

export function s40IndentMarkSpacing(host) {
  return s40IndentDecoSet(host)[2];
}

/** The indent-guide view plugin (was OV). */
export function s40IndentGuides(host) {
  const [markPlain, markActive, markSpacing] = s40IndentDecoSet(host);

  class IndentGuides {
    constructor(view) {
      this.decorations = this.getDeco(view);
    }

    update(tr) {
      if (tr.docChanged || tr.viewportChanged || tr.selectionSet) this.decorations = this.getDeco(tr.view);
    }

    getDeco(view) {
      const builder = new host.s20CmRangeSet();
      const doc = view.state.doc;
      let cursorLine = doc.lineAt(view.state.selection.main.from);

      // The quote/list prefix the cursor sits in, and the whitespace unit its
      // content is indented by (marker width, or the ancestor marker's).
      let prefix = "";
      let unit = "";
      const onCursor = cursorLine.text.match(host.listLinePattern);
      if (onCursor && onCursor[0]) {
        prefix = onCursor[1];
        if (onCursor[2]) {
          unit = " ".repeat(onCursor[2].length);
        } else {
          for (let l = cursorLine.number - 1; l > 0; l--) {
            const prev = doc.line(l);
            const up = prev.text.match(host.listLinePattern);
            if (!up || !up[0]) break;
            if (up[2] || up[1] !== prefix) {
              const upPrefix = up[1] || "";
              if (up[2] && prefix.startsWith(upPrefix) && up[0].length <= prefix.length) {
                cursorLine = prev;
                prefix = up[1];
                unit = " ".repeat(up[2].length);
              }
              break;
            }
          }
        }
      }

      // Last line of the block: keeps the prefix and, while `unit` lasts, is
      // indented by it; afterwards each line must open with a tab or 4 spaces.
      let blockEnd = cursorLine.number + 1;
      while (blockEnd <= doc.lines) {
        let text = doc.line(blockEnd).text;
        if (!text.startsWith(prefix)) break;
        text = text.substring(prefix.length);
        if (unit) {
          if (text.startsWith(unit)) {
            blockEnd++;
            continue;
          }
          unit = "";
        }
        if (!S40_INDENT_STEP.test(text)) break;
        blockEnd++;
      }

      for (const block of view.viewportLineBlocks) {
        const line = doc.lineAt(block.from);
        const leadMatch = line.text.match(S40_INDENT_LEAD);
        if (!leadMatch) continue;
        const lead = leadMatch[0];
        const inBlock = cursorLine.number < line.number && line.number < blockEnd;
        let b = 0;
        while (b < lead.length) {
          const ch = lead.charAt(b);
          const at = block.from + b;
          const active = inBlock && b === prefix.length;
          let stepped = false;
          if (ch === ">") {
            b++;
            if (lead.charAt(b) === " ") b++;
          } else if (ch === "\t") {
            stepped = true;
            b++;
          } else {
            let whole = true;
            const x = b + 4;
            for (let t = b; t < x; t++) {
              if (lead.charAt(t) !== " ") {
                b = t;
                whole = false;
                break;
              }
            }
            if (!whole) {
              builder.add(at, block.from + b, markSpacing);
              b++;
              continue;
            }
            stepped = true;
            b = x;
          }
          if (stepped) builder.add(at, block.from + b, active ? markActive : markPlain);
        }
      }
      return builder.finish();
    }
  }

  return host.cmViewPlugin.fromClass(IndentGuides, { decorations: (p) => p.decorations });
}
