// Clean-room filter editor (g07): FilterEditorBase and FilterGroup widgets.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07FilClsF = {};
function ng07FilOnceF(key, build) { return (ng07FilClsF[key] ??= build()); }

function ng07BasesT(key) {
  const b = env().gm && env().gm.plugins && env().gm.plugins.bases;
  return b && b[key] ? b[key]() : key;
}
function ng07ConjunctionOf(f) {
  return f && typeof f === "object" && Array.isArray(f.filters) && typeof f.conjunction === "string";
}

// --------------------------------------------------------- FilterEditorBase

function ng07BuildEditorBase() {
  function FilterEditorBase(filterEditor, parent) {
    this.filterEditor = filterEditor;
    this.parent = parent || null;
    this.containerEl = null;
  }
  FilterEditorBase.fromParsedQueryFilter = function (parsed, filterEditor, parent) {
    let widget;
    if (parsed === null || parsed === undefined) {
      widget = new (s24FilterStatement(ng07Host))(new (s09RuleFilter(ng07Host))(""), filterEditor, parent);
    } else if (ng07ConjunctionOf(parsed)) {
      widget = new (s24FilterGroup(ng07Host))(parsed, filterEditor, parent);
    } else if (parsed instanceof s09RuleFilter(ng07Host) || (parsed && parsed.rule instanceof env().DK)) {
      widget = new (s24FilterStatement(ng07Host))(parsed instanceof s09RuleFilter(ng07Host) ? parsed : new (s09RuleFilter(ng07Host))(parsed.rule), filterEditor, parent);
    } else {
      throw new Error("Invalid input filter");
    }
    if (!parent && !(widget instanceof s24FilterGroup(ng07Host))) {
      const inner = widget.parsedQuery || widget.ruleFilter || widget.conjunctionFilter;
      const and = new (s09AndFilter(ng07Host))([inner]);
      return new (s24FilterGroup(ng07Host))(and, filterEditor, null);
    }
    return widget;
  };
  return FilterEditorBase;
}
export function s24FilterEditorBase(host) { ng07H(host); return ng07FilOnceF("FilterEditorBase", ng07BuildEditorBase); }
