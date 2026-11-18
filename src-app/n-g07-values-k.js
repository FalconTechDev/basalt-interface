// Clean-room formula glue (g07, part K): the syntax-highlight table, the
// link/tag renderer, the document search bar, the formula suggester and the
// shared runtime instance.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07ClsK = {};
function ng07OnceK(key, build) { return (ng07ClsK[key] ??= build()); }

// ---------------------------------------------------------- TableResolver

function ng07BuildTableResolver() {
  const TABLE = {
    identifier: "cm-variable", property: "cm-property", string: "cm-string",
    number: "cm-number", boolean: "cm-builtin", null: "cm-atom",
    bracket: "cm-bracket", operator: "cm-operator", function: "cm-function",
    error: "cm-invalid", comment: "cm-comment",
  };
  function TableResolver(extra) {
    this.table = extra ? { ...TABLE, ...extra } : { ...TABLE };
  }
  TableResolver.prototype.for = function (tag) { return this.table[tag] || ""; };
  TableResolver.prototype.classFor = TableResolver.prototype.for;
  return TableResolver;
}
export function s08TableResolver(host) { ng07H(host); return ng07OnceK("TableResolver", ng07BuildTableResolver); }

// ----------------------------------------------------------- LinkRenderer

function ng07BuildLinkRenderer() {
  function LinkRenderer(app) {
    this.app = app;
    this.hoverPopover = null;
  }
  const ng07IsFile = (v) => v && typeof v === "object" && typeof v.path === "string" && "stat" in v;
  const ng07IsEl = (v) => v && typeof v === "object" && typeof v.appendChild === "function";
  LinkRenderer.prototype.renderFileLink = function (a, b, c, d) {
    // Obsidian order: (file, sourcePath, el, display); legacy order: (el, file, display)
    let el, file, display;
    if (ng07IsFile(a)) { file = a; el = ng07IsEl(c) ? c : (ng07IsEl(b) ? b : null); display = d || (typeof b === "string" ? undefined : b); }
    else { el = a; file = b; display = c; }
    if (!el) return null;
    const doc = el && el.doc ? el.doc : (el && el.ownerDocument) || document;
    const anchor = doc.createElement("a");
    anchor.className = "internal-link";
    anchor.setAttribute("data-href", file ? file.path : "");
    anchor.textContent = display || (file ? (file.extension === "md" ? file.basename : file.name) : "");
    if (file) anchor.setAttribute("data-href-path", file.path);
    anchor.addEventListener("click", (e) => {
      e.preventDefault();
      if (file && this.app && this.app.workspace) {
        const leaf = this.app.workspace.getLeaf(false);
        if (leaf) leaf.openFile(file);
      }
    });
    el.appendChild(anchor);
    return anchor;
  };
  LinkRenderer.prototype.renderExternalLink = function (a, b, c) {
    // Obsidian order: (url, el, display); legacy order: (el, url, display)
    let el, url, display;
    if (typeof a === "string") { url = a; el = ng07IsEl(b) ? b : (ng07IsEl(c) ? c : null); display = typeof c === "string" ? c : (typeof b === "string" ? b : undefined); }
    else { el = a; url = b; display = c; }
    if (!el || !url) return null;
    const doc = el && el.doc ? el.doc : (el && el.ownerDocument) || document;
    const anchor = doc.createElement("a");
    anchor.className = "external-link";
    anchor.href = url;
    anchor.textContent = display || url;
    anchor.addEventListener("click", (e) => {
      e.preventDefault();
      try { env().activeWindow.open(url, "_blank", "noopener"); }
      catch (err) { if (env().fb) new (env().fb)("Failed to open link"); }
    });
    el.appendChild(anchor);
    return anchor;
  };
  LinkRenderer.prototype.renderTag = function (a, b) {
    // Obsidian order: (tag, el); legacy order: (el, tag)
    const el = ng07IsEl(a) ? a : b;
    const tag = ng07IsEl(a) ? b : a;
    if (!el) return null;
    const doc = el && el.doc ? el.doc : (el && el.ownerDocument) || document;
    const anchor = doc.createElement("a");
    anchor.className = "tag";
    anchor.textContent = "#" + String(tag).replace(/^#/, "");
    anchor.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        if (this.app && this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById("global-search")) {
          const q = this.app.internalPlugins.getPluginById("global-search");
          if (q && q.openSearch) q.openSearch("tag:" + anchor.textContent.slice(1));
        }
      } catch (err) { /* search unavailable */ }
    });
    el.appendChild(anchor);
    return anchor;
  };
  return LinkRenderer;
}
export function s08LinkRenderer(host) { ng07H(host); return ng07OnceK("LinkRenderer", ng07BuildLinkRenderer); }
