// Clean-room property values (g07, part H): Icon, File, Url, Link, Image,
// Error, Markdown and Html values.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07ClsH = {};
function ng07OnceH(key, build) { return (ng07ClsH[key] ??= build()); }

// -------------------------------------------------------------- IconValue

function ng07BuildIconValue() {
  function IconValue(icon) { s08ScalarValue(ng07Host).call(this, String(icon || "")); }
  inherit(IconValue, s08ScalarValue(ng07Host));
  IconValue.prototype.type = ng07ValueType("icon", "lucide-smile");
  IconValue.prototype.icon = "lucide-smile";
  IconValue.prototype.renderTo = function (el, renderer) {
    if (el && typeof el.empty === "function") el.empty();
    const target = el && el.createDiv ? el.createDiv() : el;
    if (target && env().tv) env().tv(target, this.data);
    else if (target) target.textContent = this.data;
  };
  return IconValue;
}
export function s08IconValue(host) { ng07H(host); return ng07OnceH("IconValue", ng07BuildIconValue); }

// ------------------------------------------------------------- FileValue

function ng07BuildFileValue() {
  function FileValue(app, file) {
    s08Value(ng07Host).call(this);
    this.app = app;
    this.file = file;
    this._cache = {};
  }
  inherit(FileValue, s08Value(ng07Host));
  FileValue.prototype.type = ng07ValueType("file", "lucide-file");
  FileValue.prototype.icon = "lucide-file";
  const str = (v) => new (s08StringValue(ng07Host))(v === undefined || v === null ? "" : String(v));
  const num = (v) => new (s08NumberValue(ng07Host))(v || 0);
  FileValue.prototype.getMeta = function () {
    try { return this.app && this.app.metadataCache ? this.app.metadataCache.getFileCache(this.file) || {} : {}; }
    catch (e) { return {}; }
  };
  FileValue.prototype.getLinks = function () { return this._lazy("links", () => this._linkList("links")); };
  FileValue.prototype.getEmbeds = function () { return this._lazy("embeds", () => this._linkList("embeds")); };
  FileValue.prototype.getBacklinks = function () { return this._lazy("backlinks", () => this._backlinkList()); };
  FileValue.prototype.getTags = function () { return this._lazy("tags", () => this._tagList()); };
  FileValue.prototype.getProps = function () { return this._lazy("props", () => this._propObject()); };
  FileValue.prototype._lazy = function (key, build) { return (this._cache[key] ??= build()); };
  FileValue.prototype._linkList = function (kind) {
    const meta = this.getMeta();
    const links = (meta[kind] || []).map((l) => l.link).filter(Boolean);
    return new (s08ListValue(ng07Host))(links.map((l) => new (s08LinkValue(ng07Host))(this.app, l, this.file.path)));
  };
  FileValue.prototype._backlinkList = function () {
    try {
      const bl = this.app.metadataCache.getBacklinksForFile ? this.app.metadataCache.getBacklinksForFile(this.file) : null;
      const data = bl && bl.data ? bl.data : null;
      const paths = data ? [...data.keys()] : [];
      return new (s08ListValue(ng07Host))(paths.map((p) => { const f = this.app.vault.getAbstractFileByPath(p); return f ? new FileValue(this.app, f) : str(p); }));
    } catch (e) { return new (s08ListValue(ng07Host))([]); }
  };
  FileValue.prototype._tagList = function () {
    const meta = this.getMeta();
    const tags = new Set((meta.tags || []).map((t) => (t.tag || t).replace(/^#/, "")));
    const fm = meta.frontmatter && meta.frontmatter.tags;
    for (const t of Array.isArray(fm) ? fm : fm ? [fm] : []) tags.add(String(t).replace(/^#/, ""));
    return new (s08TagsValue(ng07Host))([...tags]);
  };
  FileValue.prototype._propObject = function () {
    const fm = this.getMeta().frontmatter || {};
    return s08ObjectValue(ng07Host).fromFrontMatter(this.app, this.file, fm);
  };
  FileValue.prototype.objectAccess = function (key) {
    const f = this.file;
    switch (String(key)) {
      case "file": return this;
      case "name": return str(f ? f.name : "");
      case "basename": return str(f ? f.basename : "");
      case "fullname": return str(f ? f.basename : "");
      case "path": return str(f ? f.path : "");
      case "folder": return str(f && f.parent ? f.parent.path : "");
      case "ext": return str(f ? f.extension : "");
      case "ctime": return num(f && f.stat ? f.stat.ctime : 0);
      case "mtime": return num(f && f.stat ? f.stat.mtime : 0);
      case "size": return num(f && f.stat ? f.stat.size : 0);
      case "links": return this.getLinks();
      case "embeds": return this.getEmbeds();
      case "backlinks": return this.getBacklinks();
      case "tags": return this.getTags();
      case "properties": return this.getProps();
      default: return s08NullValue(ng07Host).value;
    }
  };
  FileValue.prototype.keys = function () { return ["file","name","basename","fullname","path","folder","ext","ctime","mtime","size","links","embeds","backlinks","tags","properties"]; };
  FileValue.prototype.toString = function () { return this.file ? this.file.path : ""; };
  FileValue.prototype.isTruthy = function () { return !!this.file; };
  FileValue.prototype.equals = function (other) { return other instanceof FileValue && this.file === other.file; };
  FileValue.prototype.looseEquals = function (other) {
    if (other instanceof FileValue) return this.file === other.file || (this.file && other.file && this.file.path === other.file.path);
    return false;
  };
  FileValue.prototype.renderTo = function (el, renderer) {
    if (this.file && renderer && typeof renderer.renderFile === "function") { renderer.renderFile(el, this.file); return; }
    s08AnyValue(ng07Host).prototype.renderTo.call(this, el, renderer);
  };
  return FileValue;
}
export function s08FileValue(host) { ng07H(host); return ng07OnceH("FileValue", ng07BuildFileValue); }
