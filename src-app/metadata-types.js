// MetadataTypeManager (app.metadataTypeManager): the types.json overrides that pin a property name
// to a widget type, plus the inference helpers every property editor uses to pick a widget.
import { debounceCall } from "./timing.js";
import { isStringArray } from "./misc.js";
import { inherit } from "./inherit.js";

/** Built-in property names that always map to a widget, regardless of types.json. */
export const propertyTypeDefaults = Object.freeze({
  aliases: { name: "aliases", widget: "aliases" },
  cssclasses: { name: "cssclasses", widget: "multitext" },
  tags: { name: "tags", widget: "tags" },
});

const DATE_RE = /^\d{4}-[01]\d-[0-3]\d$/;
const DATETIME_RE = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/;

/** Guesses the widget type a raw property value wants; "unknown" when nothing fits. */
export function inferPropertyWidget(value) {
  if (value == null) return "text";
  const type = typeof value;
  if (type === "string") return DATETIME_RE.test(value) ? "datetime" : DATE_RE.test(value) ? "date" : "text";
  if (type === "number") return "number";
  if (type === "boolean") return "checkbox";
  return isStringArray(value, true) ? "multitext" : "unknown";
}

export function defineMetadataTypeManager(host) {
  /**
   * app.metadataTypeManager. `registeredTypeWidgets` and the unknown-type descriptor come from the
   * property editors through the host; this class only owns the types.json file and the lookups.
   */
  function MetadataTypeManager(app) {
    host.Events.call(this);
    this.assignedWidgets = {};
    this.lastSave = 0;
    this.properties = {};
    this._loaded = false;
    this.onConfigFileChange = debounceCall(this.onTypesFileChanged, 50);
    this.app = app;
    this.registeredTypeWidgets = host.propertyTypeWidgets;
  }
  inherit(MetadataTypeManager, host.Events);

  MetadataTypeManager.prototype.load = async function () {
    await this.loadData();
    this._loaded = true;
  };

  MetadataTypeManager.prototype.registerListeners = function () {
    this.app.vault.on("raw", this.onRaw.bind(this));
    this.app.metadataCache.on("finished", this.updatePropertyInfoCache, this);
    this.on("changed", this.updatePropertyInfoCache, this);
  };

  MetadataTypeManager.prototype.onRaw = function (path) {
    if (path === this.app.vault.configDir + "/types.json") this.onConfigFileChange();
  };

  /** Debounced: reload types.json when it changed on disk after our last save. */
  MetadataTypeManager.prototype.onTypesFileChanged = async function () {
    const file = this.app.vault.getConfigFile("types");
    try {
      const stat = await this.app.vault.adapter.stat(file);
      const mtime = stat.mtime;
      if (this.lastSave < mtime) await this.loadData();
      this.lastSave = mtime;
    } catch {
      // missing or unreadable file: nothing to reload
    }
  };

  MetadataTypeManager.prototype.updatePropertyInfoCache = function () {
    this.properties = this.app.metadataCache.getAllPropertyInfos();
  };

  MetadataTypeManager.prototype.getAllProperties = function () {
    return this.properties;
  };

  /** The widget name types.json assigned to `name` (lowercased lookup), or null. */
  MetadataTypeManager.prototype.getAssignedWidget = function (name) {
    const key = name.toLowerCase();
    return Object.hasOwn(this.assignedWidgets, key) ? this.assignedWidgets[key].widget : null;
  };

  /** The widget descriptor for a widget name; falls back to the "unknown" descriptor. */
  MetadataTypeManager.prototype.getWidget = function (name) {
    const key = name.toLowerCase();
    return Object.hasOwn(this.registeredTypeWidgets, key) ? this.registeredTypeWidgets[key] : host.unknownPropertyWidget;
  };

  /**
   * {expected, inferred} widget descriptors for a property. `expected` honours the types.json
   * assignment when the value validates against it; `inferred` is what the raw value suggests.
   */
  MetadataTypeManager.prototype.getTypeInfo = function (name, value) {
    let expected;
    const assigned = this.getAssignedWidget(name);
    if (assigned) {
      expected = this.getWidget(assigned);
      if (value == null || expected.validate(value)) return { expected, inferred: expected };
    }
    if (value == null) {
      const fromInfo = this.getWidget(this.getPropertyInfo(name).widget);
      if (fromInfo !== host.unknownPropertyWidget) return { inferred: fromInfo, expected: expected ?? fromInfo };
    }
    const inferred = this.getWidget(inferPropertyWidget(value));
    return { inferred, expected: expected ?? inferred };
  };

  MetadataTypeManager.prototype.getPropertyInfo = function (name) {
    const key = name.toLowerCase();
    return Object.hasOwn(this.properties, key) ? this.properties[key] : { name, widget: "text", occurrences: 0 };
  };

  /** Reads types.json into assignedWidgets (lowercased keys, first assignment wins) and fires "changed" per difference. */
  MetadataTypeManager.prototype.loadData = async function () {
    const data = await this.app.vault.readConfigJson("types");
    const previous = this.assignedWidgets;
    this.assignedWidgets = {};
    if (data && data.hasOwnProperty("types")) {
      for (const key in data.types) {
        if (data.types.hasOwnProperty(key)) {
          const widget = data.types[key];
          const lower = key.toLowerCase();
          if (!this.assignedWidgets.hasOwnProperty(lower)) {
            this.assignedWidgets[lower] = { name: key, widget };
          }
          if (this._loaded && !(previous.hasOwnProperty(lower) && previous[lower].widget === widget)) {
            this.trigger("changed", lower);
          }
        }
      }
    }
    Object.assign(this.assignedWidgets, propertyTypeDefaults);
  };

  MetadataTypeManager.prototype.save = async function () {
    const types = {};
    for (const key in this.assignedWidgets) {
      if (this.assignedWidgets.hasOwnProperty(key)) {
        const entry = this.assignedWidgets[key];
        types[entry.name] = entry.widget;
      }
    }
    const mtime = Date.now();
    this.lastSave = mtime;
    await this.app.vault.writeConfigJson("types", { types }, { mtime });
  };

  MetadataTypeManager.prototype.setType = async function (name, widget) {
    const key = name.toLowerCase();
    const existing = this.assignedWidgets[key];
    if (existing) existing.widget = widget;
    else this.assignedWidgets[key] = { name, widget };
    await this.save();
    this.trigger("changed", key);
  };

  MetadataTypeManager.prototype.unsetType = async function (name) {
    const key = name.toLowerCase();
    delete this.assignedWidgets[key];
    await this.save();
    this.trigger("changed", key);
  };

  return MetadataTypeManager;
}
