// Clean-room filter editor (g07): FilterGroup widget — conjunction select,
// nested children, add-filter/add-group actions.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07FilClsG2 = {};
function ng07FilOnceG2(key, build) { return (ng07FilClsG2[key] ??= build()); }

function ng07FilT(key) {
  const b = env().gm && env().gm.plugins && env().gm.plugins.bases;
  return b && b[key] ? b[key]() : key;
}

function ng07BuildGroup() {
  function FilterGroup(conjunctionFilter, filterEditor, parent) {
    s24FilterEditorBase(ng07Host).call(this, filterEditor, parent);
    this.conjunctionFilter = conjunctionFilter;
    this.conjunction = conjunctionFilter.conjunction || "and";
    this.children = (conjunctionFilter.filters || []).map((f) =>
      s24FilterEditorBase(ng07Host).fromParsedQueryFilter(f, filterEditor, this));
    this.listEl = null;
    this.render();
  }
  inherit(FilterGroup, s24FilterEditorBase(ng07Host));

  FilterGroup.prototype.render = function () {
    const self = this;
    this.containerEl = document.createElement("div");
    this.containerEl.className = "filter-group";
    // header: conjunction select (+ delete when nested)
    const header = document.createElement("div");
    header.className = "filter-group-header";
    this.containerEl.appendChild(header);
    const select = document.createElement("select");
    select.className = "conjunction dropdown";
    for (const [value, key] of [["and", "labelAllTheFollowing"], ["or", "labelAnyOfTheFollowing"], ["not", "labelNoneOfTheFollowing"]]) {
      const opt = document.createElement("option");
      opt.value = value; opt.textContent = ng07FilT(key);
      select.appendChild(opt);
    }
    select.value = this.conjunction;
    select.addEventListener("change", () => {
      self.conjunction = select.value;
      self.conjunctionFilter.conjunction = select.value;
      self.renderChildren();
      self.save();
    });
    header.appendChild(select);
    if (this.parent) {
      const del = document.createElement("button");
      del.className = "text-icon-button";
      del.setAttribute("aria-label", ng07FilT("labelDeleteFilter"));
      del.addEventListener("click", () => { self.parent.removeChild(self); self.save(); });
      header.appendChild(del);
    }
    this.listEl = document.createElement("div");
    this.listEl.className = "filter-group-statements";
    this.containerEl.appendChild(this.listEl);
    const actions = document.createElement("div");
    actions.className = "filter-group-actions";
    const addFilter = document.createElement("button");
    addFilter.className = "text-icon-button";
    addFilter.setAttribute("aria-label", ng07FilT("labelAddFilter"));
    addFilter.addEventListener("click", () => {
      self.children.push(new (s24FilterStatement(ng07Host))(new (s09RuleFilter(ng07Host))(""), self.filterEditor, self));
      self.renderChildren(); self.save();
    });
    const addGroup = document.createElement("button");
    addGroup.className = "text-icon-button";
    addGroup.setAttribute("aria-label", ng07FilT("labelAddFilterGroup"));
    addGroup.addEventListener("click", () => {
      const inner = new (s09AndFilter(ng07Host))([new (s09RuleFilter(ng07Host))("")]);
      self.children.push(new (s24FilterGroup(ng07Host))(inner, self.filterEditor, self));
      self.renderChildren(); self.save();
    });
    actions.appendChild(addFilter); actions.appendChild(addGroup);
    this.containerEl.appendChild(actions);
    this.renderChildren();
  };

  FilterGroup.prototype.renderChildren = function () {
    if (!this.listEl) return;
    this.listEl.empty ? this.listEl.empty() : (this.listEl.innerHTML = "");
    for (const child of this.children) {
      if (!child.containerEl && child.render) child.render();
      const row = document.createElement("div");
      row.className = "filter-row";
      row.appendChild(child.containerEl);
      this.listEl.appendChild(row);
    }
  };

  FilterGroup.prototype.removeChild = function (child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    if (!this.children.length) {
      // removing the last child of the root empties the top-level filter
      if (!this.parent && this.filterEditor) this.filterEditor.emptyTopLevelFilter();
    }
    this.renderChildren();
  };
  FilterGroup.prototype.replaceChild = function (oldChild, newChild) {
    const i = this.children.indexOf(oldChild);
    if (i >= 0) this.children[i] = newChild;
    this.renderChildren();
  };
  FilterGroup.prototype.serialize = function () {
    const data = this.children.map((c) => c.serialize());
    const meaningful = data.filter((d) => d !== "" && d !== undefined && d !== null);
    if (!meaningful.length) return {};
    return { [this.conjunction]: meaningful };
  };
  FilterGroup.prototype.save = function () { if (this.filterEditor) this.filterEditor.save(); };
  return FilterGroup;
}
export function s24FilterGroup(host) { ng07H(host); return ng07FilOnceG2("FilterGroup", ng07BuildGroup); }
