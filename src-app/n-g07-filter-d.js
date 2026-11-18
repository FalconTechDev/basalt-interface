// Clean-room filter editor (g07): FilterBuilder — owns the root filter
// widget for global/view filter sections and persists through a callback.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07FilClsB = {};
function ng07FilOnceB(key, build) { return (ng07FilClsB[key] ??= build()); }

function ng07BuildBuilder() {
  function FilterBuilder(app, containerEl, view) {
    this.app = app;
    this.containerEl = containerEl;
    this.view = view || null;
    this.root = null;
    this.setFilters = null;
    this.viewConfig = null;
    this.filters = null;
  }

  FilterBuilder.prototype.updateQuery = function (setFilters, viewConfig, filters) {
    this.setFilters = setFilters || this.setFilters;
    this.viewConfig = viewConfig || null;
    this.filters = filters || null;
    const parsed = filters === undefined ? this.filters : filters;
    const model = typeof parsed === "string" || (parsed && !parsed.filters && !parsed.rule) ? s09DeserializeFilter(parsed) : parsed;
    this.root = s24FilterEditorBase(ng07Host).fromParsedQueryFilter(model || null, this, null);
    if (this.containerEl) {
      this.containerEl.empty ? this.containerEl.empty() : (this.containerEl.innerHTML = "");
      this.containerEl.appendChild(this.root.containerEl);
    }
  };

  FilterBuilder.prototype.emptyTopLevelFilter = function () {
    const and = new (s09AndFilter(ng07Host))([new (s09RuleFilter(ng07Host))("")]);
    this.root = new (s24FilterGroup(ng07Host))(and, this, null);
    if (this.containerEl) {
      this.containerEl.empty ? this.containerEl.empty() : (this.containerEl.innerHTML = "");
      this.containerEl.appendChild(this.root.containerEl);
    }
    this.save();
  };

  FilterBuilder.prototype.save = function () {
    if (!this.setFilters || !this.root) return;
    let data;
    try { data = this.root.serialize(); } catch (e) { data = {}; }
    const empty = !data || typeof data !== "object" || Object.keys(data).length === 0;
    let model = null;
    if (!empty) {
      try { model = s09DeserializeFilter(data); } catch (e) { model = null; }
    }
    // an "empty" statement serializes to "" and is dropped; treat all-empty as null
    if (model === null) {
      try {
        const probe = s09DeserializeFilter(data);
        if (probe && probe.hasError && probe.hasError()) model = probe;
      } catch (e2) { /* keep null */ }
    }
    this.setFilters(model);
  };

  FilterBuilder.prototype.getFilter = function () { return this.root; };
  return FilterBuilder;
}
export function s24FilterBuilder(host) { ng07H(host); return ng07FilOnceB("FilterBuilder", ng07BuildBuilder); }
