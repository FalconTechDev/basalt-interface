// Clean-room query model (g07, part K): PropertyConfig, DeserializeView and
// the View class (order/sort/limit/groupBy/filters/summaries/data).
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07QryClsK = {};
function ng07QryOnceK(key, build) { return (ng07QryClsK[key] ??= build()); }

function ng07QErrK(key) { const b = env().gm && env().gm.plugins && env().gm.plugins.bases; return b && b[key] ? b[key]() : key; }

// -------------------------------------------------------- PropertyConfig

function ng07BuildPropConfig() {
  function PropertyConfig(query, propertyId) {
    this.query = query;
    this.propertyId = propertyId;
    this.displayName = "";
    this.unrecognizedData = {};
  }
  PropertyConfig.deserialize = function (data, propertyId, query) {
    const cfg = new PropertyConfig(query, propertyId);
    if (data && typeof data === "object") {
      for (const k of Object.keys(data)) {
        if (k === "displayName") cfg.displayName = String(data[k]);
        else cfg.unrecognizedData[k] = data[k];
      }
    }
    return cfg;
  };
  PropertyConfig.prototype.serialize = function () {
    const out = {};
    if (this.displayName) out.displayName = this.displayName;
    Object.assign(out, this.unrecognizedData || {});
    return Object.keys(out).length ? out : undefined;
  };
  PropertyConfig.prototype.getDisplayName = function () {
    return this.displayName || s09ShortPropertyId(this.propertyId);
  };
  PropertyConfig.prototype.setDisplayName = function (name) {
    this.displayName = name || "";
    if (this.query) this.query.save();
  };
  PropertyConfig.prototype.migrateDisplayName = function () {};
  return PropertyConfig;
}
export function s09PropertyConfig(host) { ng07H(host); return ng07QryOnceK("PropertyConfig", ng07BuildPropConfig); }

function ng07ShortPropertyId(id) {
  const i = String(id || "").indexOf(".");
  return i >= 0 ? String(id).slice(i + 1) : String(id || "");
}
export function s09ShortPropertyId(id) { return ng07ShortPropertyId(id); }
