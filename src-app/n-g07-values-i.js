// Clean-room property values (g07, part I): Url, Link, Image, Error,
// Markdown and Html values.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07ClsI = {};
function ng07OnceI(key, build) { return (ng07ClsI[key] ??= build()); }

// -------------------------------------------------------------- UrlValue

function ng07BuildUrlValue() {
  function UrlValue(url, display) {
    s08Value(ng07Host).call(this);
    this.url = String(url || "");
    this.display = display === undefined ? null : String(display);
  }
  inherit(UrlValue, s08Value(ng07Host));
  UrlValue.prototype.type = ng07ValueType("text", "lucide-external-link");
  UrlValue.prototype.data = undefined;
  Object.defineProperty(UrlValue.prototype, "data", { get() { return this.url; } });
  UrlValue.prototype.toString = function () { return this.display || this.url; };
  UrlValue.prototype.isTruthy = function () { return !!this.url; };
  UrlValue.prototype.equals = function (other) { return other instanceof UrlValue && this.url === other.url && this.display === other.display; };
  UrlValue.prototype.looseEquals = UrlValue.prototype.equals;
  UrlValue.prototype.renderTo = function (el, renderer) {
    if (renderer && typeof renderer.renderExternalLink === "function") { renderer.renderExternalLink(el, this.url, this.display || undefined); return; }
    s08AnyValue(ng07Host).prototype.renderTo.call(this, el, renderer);
  };
  return UrlValue;
}
export function s08UrlValue(host) { ng07H(host); return ng07OnceI("UrlValue", ng07BuildUrlValue); }

// ------------------------------------------------------------- LinkValue

function ng07BuildLinkValue() {
  function LinkValue(app, link, sourcePath, display) {
    s08Value(ng07Host).call(this);
    this.app = app;
    this.link = String(link || "");
    this.sourcePath = sourcePath || null;
    this.display = display === undefined || display === null ? null : String(display);
  }
  inherit(LinkValue, s08Value(ng07Host));
  LinkValue.prototype.type = ng07ValueType("text", "lucide-link");
  LinkValue.prototype.data = undefined;
  Object.defineProperty(LinkValue.prototype, "data", { get() { return this.link; } });
  LinkValue.prototype.toString = function () { return this.display ? `[[${this.link}|${this.display}]]` : `[[${this.link}]]`; };
  LinkValue.prototype.isTruthy = function () { return !!this.link; };
  LinkValue.prototype.resolve = function () {
    try {
      const cache = this.app && this.app.metadataCache;
      return cache && cache.getFirstLinkpathDest ? cache.getFirstLinkpathDest(this.link, this.sourcePath) : null;
    } catch (e) { return null; }
  };
  LinkValue.prototype.equals = function (other) {
    return other instanceof LinkValue && this.link === other.link && this.display === other.display;
  };
  LinkValue.prototype.looseEquals = function (other) {
    if (!(other instanceof LinkValue)) return false;
    if (this.link === other.link) return true;
    const a = this.resolve(), b = other.resolve();
    return !!a && a === b;
  };
  LinkValue.prototype.renderTo = function (el, renderer) {
    if (renderer && typeof renderer.renderLink === "function") { renderer.renderLink(el, this); return; }
    if (renderer && typeof renderer.renderFileLink === "function") {
      const file = this.resolve();
      if (file) { renderer.renderFileLink(el, file, this.display || undefined); return; }
    }
    s08AnyValue(ng07Host).prototype.renderTo.call(this, el, renderer);
  };
  LinkValue.parseFromString = function (app, text, sourcePath) {
    const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(String(text).trim());
    if (!m) return null;
    return new LinkValue(app, m[1].trim(), sourcePath, m[2] ? m[2].trim() : null);
  };
  LinkValue.fromReference = function (app, linktext, sourcePath) {
    const parsed = typeof linktext === "string" ? LinkValue.parseFromString(app, linktext, sourcePath) : null;
    if (parsed) return parsed;
    return new LinkValue(app, String(linktext || ""), sourcePath);
  };
  return LinkValue;
}
export function s08LinkValue(host) { ng07H(host); return ng07OnceI("LinkValue", ng07BuildLinkValue); }

// ------------------------------------------------------------ ImageValue

function ng07BuildImageValue() {
  function ImageValue(url, internal) {
    s08Value(ng07Host).call(this);
    this.url = String(url || "");
    this.internal = !!internal;
  }
  inherit(ImageValue, s08Value(ng07Host));
  ImageValue.prototype.type = ng07ValueType("image", "lucide-image");
  ImageValue.prototype.data = undefined;
  Object.defineProperty(ImageValue.prototype, "data", { get() { return this.url; } });
  ImageValue.prototype.toString = function () {
    return this.internal ? `![[${this.url}]]` : `![](${this.url})`;
  };
  ImageValue.prototype.isTruthy = function () { return !!this.url; };
  ImageValue.prototype.equals = function (other) { return other instanceof ImageValue && this.url === other.url && this.internal === other.internal; };
  ImageValue.prototype.looseEquals = ImageValue.prototype.equals;
  ImageValue.prototype.renderTo = function (el, renderer) {
    if (renderer && typeof renderer.renderImage === "function") { renderer.renderImage(el, this); return; }
    s08AnyValue(ng07Host).prototype.renderTo.call(this, el, renderer);
  };
  return ImageValue;
}
export function s08ImageValue(host) { ng07H(host); return ng07OnceI("ImageValue", ng07BuildImageValue); }

// ------------------------------------------------------------ ErrorValue

function ng07BuildErrorValue() {
  function ErrorValue(message) {
    s08Value(ng07Host).call(this);
    this.message = message === undefined || message === null ? "" : String(message && message.message ? message.message : message);
  }
  inherit(ErrorValue, s08Value(ng07Host));
  ErrorValue.prototype.type = ng07ValueType("error", "lucide-alert-triangle");
  ErrorValue.prototype.data = undefined;
  Object.defineProperty(ErrorValue.prototype, "data", { get() { return this.message; } });
  ErrorValue.prototype.toString = function () { return `Error: ${this.message}`; };
  ErrorValue.prototype.isTruthy = function () { return false; };
  ErrorValue.prototype.equals = function (other) { return other instanceof ErrorValue && this.message === other.message; };
  ErrorValue.prototype.looseEquals = ErrorValue.prototype.equals;
  ErrorValue.prototype.renderTo = function (el, renderer) {
    const doc = el && el.doc ? el.doc : (el && el.ownerDocument) || document;
    if (el && typeof el.empty === "function") el.empty();
    const box = el && el.createDiv ? el.createDiv({ cls: "bases-formula-error" }) : doc.createElement("div");
    if (!box.classList.contains("bases-formula-error")) box.className = "bases-formula-error";
    const icon = doc.createElement("div");
    icon.className = "warning-icon";
    if (env().tv) env().tv(icon, "lucide-info");
    const msg = doc.createElement("div");
    msg.className = "bases-formula-error-message";
    msg.textContent = this.message;
    box.appendChild(icon); box.appendChild(msg);
    if (el && !box.parentNode) el.appendChild(box);
    box.addEventListener("click", () => {
      try { env().activeWindow.navigator.clipboard.writeText(this.message); } catch (e) { /* noop */ }
    });
  };
  return ErrorValue;
}
export function s08ErrorValue(host) { ng07H(host); return ng07OnceI("ErrorValue", ng07BuildErrorValue); }

// --------------------------------------------------------- Markdown/Html

function ng07BuildMarkdownValue() {
  function MarkdownValue(text) { s08ScalarValue(ng07Host).call(this, String(text || "")); }
  inherit(MarkdownValue, s08ScalarValue(ng07Host));
  MarkdownValue.prototype.type = ng07ValueType("text", "lucide-file-text");
  MarkdownValue.prototype.renderTo = function (el, renderer) {
    if (renderer && typeof renderer.renderMarkdown === "function") { renderer.renderMarkdown(el, this.data); return; }
    s08AnyValue(ng07Host).prototype.renderTo.call(this, el, renderer);
  };
  return MarkdownValue;
}
export function s08MarkdownValue(host) { ng07H(host); return ng07OnceI("MarkdownValue", ng07BuildMarkdownValue); }

function ng07BuildHtmlValue() {
  function HtmlValue(text) { s08ScalarValue(ng07Host).call(this, String(text || "")); }
  inherit(HtmlValue, s08ScalarValue(ng07Host));
  HtmlValue.prototype.type = ng07ValueType("text", "lucide-code");
  HtmlValue.prototype.renderTo = function (el, renderer) {
    if (renderer && typeof renderer.renderHtml === "function") { renderer.renderHtml(el, this.data); return; }
    s08AnyValue(ng07Host).prototype.renderTo.call(this, el, renderer);
  };
  return HtmlValue;
}
export function s08HtmlValue(host) { ng07H(host); return ng07OnceI("HtmlValue", ng07BuildHtmlValue); }
