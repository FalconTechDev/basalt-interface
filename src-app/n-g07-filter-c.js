// Clean-room filter editor (g07): FilterStatement widget — LHS property,
// operator dropdown, RHS value, advanced formula mode, error display.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07FilClsS = {};
function ng07FilOnceS(key, build) { return (ng07FilClsS[key] ??= build()); }

function ng07CmpOps() { return ["==", "!=", "<", "<=", ">", ">="]; }
function ng07FuncOps() {
  const out = [];
  if (ng07FuncRegistry && ng07FuncRegistry.getAllGlobal) {
    try { for (const f of ng07FuncRegistry.getAllGlobal()) if (f && f.name) out.push(f.name); } catch (err) { /* noop */ }
  }
  return out;
}

function ng07BuildStatement() {
  function FilterStatement(ruleFilter, filterEditor, parent) {
    s24FilterEditorBase(ng07Host).call(this, filterEditor, parent);
    this.parsedQuery = ruleFilter;
    this.advancedInputMode = false;
    this.advancedInputValue = "";
    this.rightInputValue = "";
    this.leftValue = "file.file";
    this.selectedOperator = "==";
    this.errorMessageEl = null;
    this.operatorItems = [];
    this._initFromRule();
    this.render();
  }
  inherit(FilterStatement, s24FilterEditorBase(ng07Host));

  FilterStatement.prototype._initFromRule = function () {
    const text = this.parsedQuery && this.parsedQuery.rule ? this.parsedQuery.rule.toString() : "";
    const parsed = s09ParseFormula(text);
    if (parsed.type === "expression") {
      // simple "lhs op rhs" comparisons populate the simple controls
      const src = s09NodeText ? "" : "";
    }
    this.advancedInputValue = text;
  };

  FilterStatement.prototype.render = function () {
    const self = this;
    const root = document.createElement("div");
    root.className = "filter-statement";
    // left property input
    const lhsWrap = root.createDiv ? root.createDiv("filter-lhs-container") : Object.assign(document.createElement("div"), { className: "filter-lhs-container" });
    if (!lhsWrap.parentNode) root.appendChild(lhsWrap);
    const leftInput = document.createElement("input");
    leftInput.className = "filter-expression metadata-property";
    leftInput.value = s09PropertyToRef(this.leftValue);
    leftInput.addEventListener("input", () => { self.leftValue = leftInput.value; self.updateOperators(); self.renderRightInput(); });
    lhsWrap.appendChild(leftInput);
    this.leftInputEl = {
      el: leftInput,
      setValueById(id) { self.leftValue = String(id); leftInput.value = s09PropertyToRef(self.leftValue); self.updateOperators(); self.renderRightInput(); },
      getValue() { return self.leftValue; },
    };
    // operator dropdown
    const opWrap = Object.assign(document.createElement("div"), { className: "filter-operator" });
    const select = document.createElement("select");
    select.className = "dropdown";
    opWrap.appendChild(select);
    root.appendChild(opWrap);
    this.operatorComponent = {
      el: select,
      setValue(item) {
        self.selectedOperator = typeof item === "string" ? item : item && item.value;
        select.value = self.selectedOperator;
        self.renderRightInput();
      },
      getValue() { return self.selectedOperator; },
    };
    this.updateOperators();
    // right input
    const rhsWrap = Object.assign(document.createElement("div"), { className: "filter-rhs-container" });
    root.appendChild(rhsWrap);
    this.rightInputWrap = rhsWrap;
    this.renderRightInput();
    // error row
    const err = Object.assign(document.createElement("div"), { className: "filter-row-error" });
    err.style.display = "none";
    root.appendChild(err);
    this.errorMessageEl = err;
    // advanced toggle
    const toggle = document.createElement("button");
    toggle.className = "filer-expression-mode-toggle";
    toggle.addEventListener("click", () => self.toggleAdvancedMode());
    root.appendChild(toggle);
    this.toggleAdvancedModeButton = toggle;
    // advanced editor container
    const adv = Object.assign(document.createElement("div"), { className: "formula-editor-container" });
    adv.style.display = "none";
    const ed = document.createElement("textarea");
    ed.className = "formula-editor";
    ed.value = this.advancedInputValue;
    ed.addEventListener("input", () => { self.advancedInputValue = ed.value; self.update(); });
    adv.appendChild(ed);
    root.appendChild(adv);
    this.advancedEditorEl = ed;
    this.containerEl = root;
  };

  FilterStatement.prototype.getLeftInputValue = function () { return this.leftValue || "file.file"; };
  FilterStatement.prototype.setLeftInputValue = function (v) { this.leftValue = v; };

  FilterStatement.prototype.updateOperators = function () {
    const items = [];
    const lv = this.leftValue || "";
    const isNumeric = /score|number|count|amount|price/i.test(lv);
    const isDate = /date|time|created|modified/i.test(lv);
    for (const op of ng07CmpOps()) {
      if (["<", "<=", ">", ">="].includes(op) && !(isNumeric || isDate)) continue;
      items.push({ value: op, label: op === "==" ? "=" : op === "!=" ? "≠" : op });
    }
    for (const fn of ng07FuncOps()) items.push({ value: fn, label: fn });
    this.operatorItems = items;
    const sel = this.operatorComponent && this.operatorComponent.el;
    if (sel) {
      sel.innerHTML = "";
      for (const it of items) {
        const o = document.createElement("option");
        o.value = it.value; o.textContent = it.label;
        sel.appendChild(o);
      }
      if (!items.some((i) => i.value === this.selectedOperator)) this.selectedOperator = items[0] ? items[0].value : "==";
      sel.value = this.selectedOperator;
      sel.addEventListener("change", () => { this.selectedOperator = sel.value; this.renderRightInput(); });
    }
    return items;
  };

  FilterStatement.prototype.setOperator = function (op) { this.selectedOperator = op; this.renderRightInput(); };
  FilterStatement.prototype.getSelectedFunction = function () { return this.selectedOperator; };
  FilterStatement.prototype.getFunction = function () { return this.selectedOperator; };
  FilterStatement.prototype.focusLHS = function () { if (this.leftInputEl && this.leftInputEl.el) this.leftInputEl.el.focus(); };
  FilterStatement.prototype.reconcileVisibleFields = function () {
    const hideRhs = ["isEmpty", "hasProperty"].includes(this.selectedOperator);
    if (this.rightInputWrap) this.rightInputWrap.style.display = hideRhs ? "none" : "";
  };

  FilterStatement.prototype.renderRightInput = function () {
    const wrap = this.rightInputWrap;
    if (!wrap) return;
    wrap.innerHTML = "";
    this.reconcileVisibleFields();
    if (["isEmpty", "hasProperty"].includes(this.selectedOperator)) return;
    const input = document.createElement("input");
    input.className = "filter-rhs-input";
    input.value = this.rightInputValue || "";
    input.addEventListener("input", () => { this.rightInputValue = input.value; });
    wrap.appendChild(input);
    this.rightInputEl = input;
  };

  FilterStatement.prototype.setAdvancedValue = function (v) {
    this.advancedInputMode = true;
    this.advancedInputValue = String(v || "");
    if (this.advancedEditorEl) this.advancedEditorEl.value = this.advancedInputValue;
    if (this.containerEl) {
      const adv = this.containerEl.querySelector(".formula-editor-container");
      if (adv) adv.style.display = "";
      const simple = this.containerEl.querySelectorAll(".filter-lhs-container,.filter-operator,.filter-rhs-container");
      simple.forEach((el) => { el.style.display = "none"; });
    }
  };
  FilterStatement.prototype.toggleAdvancedMode = function () {
    if (this.advancedInputMode) {
      this.advancedInputMode = false;
      if (this.advancedEditorEl) this.advancedInputValue = this.advancedEditorEl.value;
      if (this.containerEl) {
        const adv = this.containerEl.querySelector(".formula-editor-container");
        if (adv) adv.style.display = "none";
        this.containerEl.querySelectorAll(".filter-lhs-container,.filter-operator,.filter-rhs-container").forEach((el) => { el.style.display = ""; });
      }
    } else {
      // entering advanced: seed with current simple serialization
      const ser = this.serializeSimple();
      this.setAdvancedValue(ser || this.advancedInputValue);
    }
    this.update();
  };

  FilterStatement.prototype.serializeSimple = function () {
    const lhs = s09PropertyToRef(this.getLeftInputValue());
    const op = this.getSelectedFunction();
    const rhs = this.quoteValueString(this.rightInputValue);
    if (!lhs || !op || rhs === "" || rhs === undefined) return "";
    if (ng07CmpOps().includes(op)) return `${lhs} ${op} ${rhs}`;
    return `${lhs}.${op}(${rhs})`;
  };
  FilterStatement.prototype.serialize = function () {
    if (this.advancedInputMode) return this.advancedInputValue || "";
    return this.serializeSimple();
  };

  FilterStatement.prototype.setFieldValuesFromInput = function () {};
  FilterStatement.prototype.setErrorState = function (message) {
    if (!this.containerEl) return;
    if (message) {
      this.containerEl.classList.add("mod-error");
      if (this.errorMessageEl) {
        this.errorMessageEl.textContent = message;
        this.errorMessageEl.style.display = "";
      }
    } else {
      this.containerEl.classList.remove("mod-error");
      if (this.errorMessageEl) { this.errorMessageEl.textContent = ""; this.errorMessageEl.style.display = "none"; }
    }
  };

  FilterStatement.prototype.update = function () {
    const text = this.serialize();
    const parsed = s09ParseFormula(text);
    if (parsed.type === "invalid") {
      this.setErrorState(parsed.parseError || "Invalid formula");
    } else {
      this.setErrorState(null);
    }
    if (this.parsedQuery && this.parsedQuery.rule) {
      this.parsedQuery.rule = new (env().DK)(text);
    }
    try { if (this.filterEditor) this.filterEditor.save(); } catch (e) { /* noop */ }
  };

  FilterStatement.prototype.quoteValueString = function (value) {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return JSON.stringify(value.map((v) => this.quoteValueString(v)));
    const s = String(value);
    const link = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(s);
    if (link) return link[2] ? `link(${JSON.stringify(link[1])},${JSON.stringify(link[2])})` : `link(${JSON.stringify(link[1])})`;
    if (/^(note|formula|file|this)\.[^\s]+$/.test(s) || /^[A-Za-z_][\w]*$/.test(s)) return s;
    if (/^(true|false|null|[-+]?\d+(\.\d+)?)$/.test(s)) return s;
    return JSON.stringify(s);
  };
  return FilterStatement;
}
export function s24FilterStatement(host) { ng07H(host); return ng07FilOnceS("FilterStatement", ng07BuildStatement); }
