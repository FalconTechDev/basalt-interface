// Slice s26 — Bases property value renderers: the shared base plus the metadata,
// file-link and formula variants a BasesView picks per property via createRenderer.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { parsePropertyId } from "./text.js";
import { emptyToNull } from "./misc.js";
import { s09ValueTypeName } from "./s09-query.js";
import { s09BasesStrings } from "./s09-formula.js";
import { setElementTooltip, displayTooltip } from "./tooltip.js";

/** `var p$` — base of every rendered property value: holds view/prop/el and is
 *  invoked through `.call(this, view, prop, el)` by the subclasses. */
export function s26ValueRendererBase(view, prop, el) {
  this.view = view;
  this.prop = prop;
  this.el = el;
}

/** `var d$` — renders a note property through its metadata-type widget. */
export function s26MetadataValueRenderer(host) {
  const Base = s26ValueRendererBase;
  function MetadataValueRenderer(view, prop, el) {
    const self = Base.call(this, view, prop, el) || this;
    self.propertyEditor = null;
    self.inferredType = null;
    self.el.addClass("bases-rendered-value", "metadata-property-value");
    return self;
  }
  inherit(MetadataValueRenderer, Base);
  MetadataValueRenderer.prototype.render = function (entry) {
    const view = this.view, el = this.el, prop = this.prop, prevVal = this.val, prevError = this.error;
    const name = parsePropertyId(prop).name;
    const app = view.app;
    const raw = entry.getRawProperty(name);
    const json = JSON.stringify(raw);
    this.entry = entry;
    this.val = json;
    if (entry.file.extension !== "md") {
      this.propertyEditor = null;
      el.empty();
      el.setAttr("disabled", true);
      return;
    }
    el.setAttr("disabled", null);
    const inferred = app.metadataTypeManager.getTypeInfo(name, raw).inferred;
    if (this.propertyEditor && inferred === this.inferredType && prevVal === json) return;
    el.empty();
    this.inferredType = inferred;
    el.setAttr("data-property-type", inferred.type);
    this.propertyEditor = inferred.render(el, raw, {
      app,
      blur: () => { host.blurAndClearSelection(); el.scrollLeft = 0; view.focus(); },
      key: name,
      hoverSource: "bases",
      onChange: (value) => {
        value = emptyToNull(value);
        const next = JSON.stringify(value);
        if (next === this.val) return;
        this.val = next;
        view.updateProperty(this.entry.file, name, value);
      },
      sourcePath: entry.file.path,
    });
  };
  return MetadataValueRenderer;
}

/** `var f$` — renders `file.*` link properties as file links. */
export function s26FileValueRenderer(host) {
  const Base = s26ValueRendererBase;
  function FileValueRenderer(view, prop, el) {
    const self = Base.call(this, view, prop, el) || this;
    self.el.addClass("bases-rendered-value");
    return self;
  }
  inherit(FileValueRenderer, Base);
  FileValueRenderer.prototype.render = function (entry) {
    const prevEntry = this.entry, prevPath = this.filepath;
    this.entry = entry;
    this.filepath = entry.file.path;
    if (prevEntry?.file === entry.file && prevPath === this.filepath) return;
    this.el.empty();
    this.view.app.renderContext.renderFileLink(entry.file, null, this.el);
  };
  return FileValueRenderer;
}

/** `var m$` — renders a formula result, or the formula error / editor affordance. */
export function s26FormulaValueRenderer(host) {
  const Base = s26ValueRendererBase;
  function FormulaValueRenderer(view, prop, el) {
    const self = Base.call(this, view, prop, el) || this;
    self.value = null;
    self.error = null;
    self.el.addClass("bases-rendered-value");
    return self;
  }
  inherit(FormulaValueRenderer, Base);
  FormulaValueRenderer.prototype.render = function (entry) {
    const view = this.view, el = this.el, prop = this.prop;
    const prevValue = this.value, prevError = this.error;
    let value = null, error = null;
    try { value = entry.getValue(prop); } catch (e) { error = e; }
    this.entry = entry;
    this.value = value;
    this.error = error;
    if (env().gW.equals(prevValue, value) && error?.message === prevError?.message) return;
    el.empty();
    el.setAttr("data-property-type", value ? s09ValueTypeName(value.type) : "");
    if (error) {
      const box = el.createDiv("bases-formula-error");
      host.setIcon(box.createDiv("warning-icon"), "lucide-info");
      box.createDiv({ text: error.message, cls: "bases-formula-error-message" });
      setElementTooltip(box, error.message, { delay: host.TOOLTIP_DELAY });
      box.addEventListener("click", () => displayTooltip(box, error.message));
      box.addEventListener("dblclick", (e) => { e.preventDefault(); this.showFormulaEditor(); });
      return;
    }
    if (value) value.renderTo(el, view.app.renderContext);
  };
  FormulaValueRenderer.prototype.showFormulaEditor = function () {
    const view = this.view, el = this.el, prop = this.prop;
    const name = parsePropertyId(prop).name;
    const editor = new host.s13BasesMenu(view.app, el, name);
    editor.scrollEl.createDiv("bases-toolbar-menu-container", (bar) => {
      const header = bar.createDiv("bases-toolbar-menu-container-header");
      header.createDiv("menu-title").createDiv({ cls: "menu-title-inner", text: s09BasesStrings().titleEditProperty({ name }) });
      const btn = header.createDiv("clickable-icon");
      const actions = new host.s13PropActionsMenu(view.queryController, prop, false);
      btn.addEventListener("click", (e) => actions.showActions(e, btn));
      host.setIcon(btn, "lucide-more-vertical");
      bar.appendChild(actions.containerEl);
    });
    editor.setAutoDestroy(el);
    editor.onClose(() => view.focus());
    editor.setOpen(true);
  };
  return FormulaValueRenderer;
}
