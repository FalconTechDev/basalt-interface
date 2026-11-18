// Clean-room formula engine (g07, part H): summary-formula tables and the
// CodeMirror extension set for formula inputs.
import { env } from "./env.js";

/** `XK` declarator — summary formula choices keyed by value class. */
export function s09SummaryFormulas() {
  const e = env();
  const map = new Map();
  const put = (cls, entries) => { if (cls) map.set(cls, entries); };
  put(e.EW, {
    Average: "values.mean()", Min: "values.min()", Max: "values.max()",
    Sum: "values.sum()", Range: "values.max() - values.min()",
    Median: "values.median()", Stddev: "values.stddev()",
  });
  put(e.LW, { Earliest: "values.earliest()", Latest: "values.latest()", Range: "values.latest() - values.earliest()" });
  put(e.MW, { Checked: "values.sum()", Unchecked: "values.length() - values.sum()" });
  put(e.gW, { Empty: "values.length() == 0", Filled: "values.length() > 0", Unique: "values.unique().length()" });
  return map;
}

function ng07ClassChain(cls) {
  const chain = [];
  let proto = cls && cls.prototype;
  while (proto && proto.constructor && proto.constructor !== Object) {
    chain.unshift(proto.constructor);
    proto = Object.getPrototypeOf(proto);
  }
  return chain;
}

/** `$K` — summary formulas for `type`, merged from AnyValue down to the class. */
export function s09SummaryFormulasFor(type) {
  const cls = typeof type === "function" ? type : type && type.constructor;
  const table = s09SummaryFormulas();
  const merged = {};
  for (const c of ng07ClassChain(cls)) {
    const entries = table.get(c);
    if (entries) Object.assign(merged, entries);
  }
  return merged;
}

// ------------------------------------------------- editor CM6 extensions

function ng07FormulaLintSource(view) {
  const text = view.state.doc.toString();
  if (text.trim() === "") return [];
  const parsed = s09ParseFormula(text);
  if (parsed.type !== "invalid") return [];
  return [{
    from: 0, to: text.length,
    severity: "error",
    message: parsed.parseError || "Invalid formula",
  }];
}

function ng07MinimalCtx() {
  return {
    keys: () => ["values"],
    getByIdentifier: (id) => (String(id).toLowerCase() === "values"
      ? new (env().SW)([])
      : env().bW.value),
  };
}

/** `IY` — CM6 extensions for formula inputs: wrapping, lint, completion, highlight. */
export function s09FormulaEditorExtensions() {
  const e = env();
  const exts = [];
  try { if (e.s12reqView && e.s12reqView.EditorView) exts.push(e.s12reqView.EditorView.lineWrapping); } catch (err) { /* noop */ }
  try {
    if (e.s12reqLint && e.s12reqLint.linter) exts.push(e.s12reqLint.linter({ source: ng07FormulaLintSource }));
  } catch (err) { /* noop */ }
  try {
    if (e.s12reqAutocomplete && e.s12reqAutocomplete.autocompletion) {
      const suggester = new (s08FormulaSuggester(ng07Host))(ng07MinimalCtx());
      exts.push(e.s12reqAutocomplete.autocompletion({ override: [(ctx) => suggester.getCompletions(ctx)] }));
    }
  } catch (err) { /* noop */ }
  try {
    const syntax = new (s09FormulaSyntaxClass())();
    if (syntax && syntax.extensions) exts.push(...syntax.extensions);
  } catch (err) { /* noop */ }
  return exts;
}

function s09FormulaSyntaxClass() { return s09FormulaSyntax(ng07Host); }

// ---------------------------------------------------------- FormulaSyntax

const ng07FmlClsH = {};
function ng07FmlOnceH(key, build) { return (ng07FmlClsH[key] ??= build()); }

/** `AK` — syntax/highlight extension factory for formula editors. */
export function s09FormulaSyntax(host) {
  ng07H(host);
  return ng07FmlOnceH("FormulaSyntax", () => {
    function FormulaSyntax() { this.resolver = new (s08TableResolver(ng07Host))(); }
    Object.defineProperty(FormulaSyntax.prototype, "extensions", {
      get() {
        const out = [];
        try {
          const hl = env().s12reqLezerHighlight;
          const lang = env().s12reqLanguage;
          if (hl && hl.HighlightStyle && lang && lang.syntaxHighlighting) {
            const style = hl.HighlightStyle.define([
              { tag: hl.tags.keyword, class: "cm-keyword" },
              { tag: hl.tags.string, class: "cm-string" },
              { tag: hl.tags.number, class: "cm-number" },
              { tag: hl.tags.bool, class: "cm-builtin" },
              { tag: hl.tags.null, class: "cm-atom" },
              { tag: hl.tags.operator, class: "cm-operator" },
              { tag: hl.tags.propertyName, class: "cm-property" },
              { tag: hl.tags.variableName, class: "cm-variable" },
              { tag: hl.tags.function, class: "cm-function" },
              { tag: hl.tags.invalid, class: "cm-invalid" },
            ]);
            out.push(lang.syntaxHighlighting(style));
          }
        } catch (e) { /* highlight unavailable */ }
        return out;
      },
    });
    return FormulaSyntax;
  });
}
