// Clean-room query model (g07, part I): the filter AST — rule/conjunction/
// and/or/not nodes, (de)serialization and ctx testing.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07QryClsI = {};
function ng07QryOnceI(key, build) { return (ng07QryClsI[key] ??= build()); }

function ng07QErrI(key) { const b = env().gm && env().gm.plugins && env().gm.plugins.bases; return b && b[key] ? b[key]() : key; }

// ------------------------------------------------------------ FilterBase

function ng07BuildFilterBase() {
  function FilterBase() {}
  FilterBase.prototype.getFilterRules = function () { return this.getFilterRulesWithNegation(false); };
  FilterBase.prototype.getFilterRulesWithNegation = function (negated) {
    if (this instanceof s09RuleFilter(ng07Host)) return [{ rule: this, negated }];
    if (this instanceof s09ConjunctionFilter(ng07Host)) {
      const flip = this instanceof s09NotFilter(ng07Host);
      const out = [];
      for (const f of this.filters || []) out.push(...f.getFilterRulesWithNegation(negated !== flip));
      return out;
    }
    return [];
  };
  FilterBase.prototype.optimize = function () { return this; };
  FilterBase.prototype.hasError = function () { return false; };
  FilterBase.and = function (...filters) {
    const list = filters.filter(Boolean);
    return list.length === 1 ? list[0] : new (s09AndFilter(ng07Host))(list).optimize();
  };
  FilterBase.or = function (...filters) {
    const list = filters.filter(Boolean);
    return list.length === 1 ? list[0] : new (s09OrFilter(ng07Host))(list).optimize();
  };
  FilterBase.not = function (...filters) {
    const list = filters.filter(Boolean);
    return new (s09NotFilter(ng07Host))(list).optimize();
  };
  return FilterBase;
}
export function s09FilterBase(host) { ng07H(host); return ng07QryOnceI("FilterBase", ng07BuildFilterBase); }

// ------------------------------------------------------------ RuleFilter

function ng07BuildRuleFilter() {
  function RuleFilter(formulaText) {
    s09FilterBase(ng07Host).call(this);
    if (formulaText instanceof env().DK) this.rule = formulaText;
    else if (formulaText && typeof formulaText === "object" && typeof formulaText.type === "string") {
      this.rule = new (env().DK)({ parsed: formulaText });
    } else {
      this.rule = new (env().DK)(formulaText === undefined ? "" : String(formulaText));
    }
  }
  inherit(RuleFilter, s09FilterBase(ng07Host));
  RuleFilter.prototype.type = "rule";
  RuleFilter.prototype.serialize = function () {
    const p = this.rule && this.rule.parsed;
    return p && typeof p === "object" ? p : { type: "empty" };
  };
  RuleFilter.prototype.test = function (ctx) { return this.rule.test(ctx); };
  RuleFilter.prototype.hasError = function () { return this.rule.formula instanceof env().RK; };
  RuleFilter.prototype.optimize = function () { return this; };
  return RuleFilter;
}
export function s09RuleFilter(host) { ng07H(host); return ng07QryOnceI("RuleFilter", ng07BuildRuleFilter); }
