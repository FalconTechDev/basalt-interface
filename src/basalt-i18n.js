// Interface language for everything Basalt adds. The source strings are Russian; with any other interface language
// (Settings > General > Language) they are translated to English from the dictionary in basalt-i18n-en.js.
// Text nodes and attributes are translated as they appear; window.__bsT(text) is for strings drawn on a canvas.
(function () {
  let lang = "en";
  try { lang = (localStorage.getItem("language") || navigator.language || "en").split("-")[0].toLowerCase(); } catch (e) { /* default */ }
  window.__bsLang = lang;
  if (lang === "ru" || !window.__bsEnDict) { window.__bsT = (s) => s; return; }

  const D = window.__bsEnDict, CYR = /[А-Яа-яЁё]/, isCyr = (c) => !!c && CYR.test(c);
  const keys = Object.keys(D).sort((a, b) => b.length - a.length), esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const RX = new RegExp(keys.map(esc).join("|"), "g");
  // "N file" / "N files": the dictionary has the singular, the count decides the form
  const PL = { file: "files", node: "nodes", entry: "entries", object: "objects", place: "places", version: "versions", session: "sessions", edit: "edits", check: "checks", card: "cards", folder: "folders", link: "links", line: "lines", import: "imports", symbol: "symbols", call: "calls", record: "records", match: "matches", change: "changes" };
  const SING = Object.fromEntries(Object.entries(PL).map(([s, p]) => [p, s])), PLRX = new RegExp("(\\d{1,9})\\s(" + Object.keys(PL).concat(Object.values(PL)).join("|") + ")(?![A-Za-z])", "g");
  const cache = new Map();
  function tr(s, exactOnly) {
    if (!s || s.length > 500 || !CYR.test(s)) return s;
    const ck = (exactOnly ? "=" : "") + s, hit = cache.get(ck); if (hit !== undefined) return hit;
    let out;
    if (exactOnly) { const t = s.trim(), v = D[t]; out = v !== undefined ? s.replace(t, v) : s; }
    else {
      out = s.replace(RX, (m, off) => {
        if (isCyr(m[0]) && off > 0 && isCyr(s[off - 1])) return m;
        const e = off + m.length; if (isCyr(m[m.length - 1]) && e < s.length && isCyr(s[e])) return m;
        return D[m];
      });
      out = out.replace(PLRX, (all, n, w) => { const num = parseInt(n, 10), base = SING[w] || w; return n + " " + (num === 1 ? base : PL[base]); });
    }
    if (out !== s) out = out.replace(/[«»]/g, '"');
    if (cache.size > 6000) cache.clear(); cache.set(ck, out); return out;
  }
  window.__bsT = (s) => tr(s, false);

  // user content is never translated: notes, file names, canvas cards, search hits
  const SKIP = ".cm-editor, .markdown-preview-view, .markdown-source-view, .canvas-node-content, .nav-file, .nav-folder, .tree-item-inner, .search-result, .tag-pane-tag, .bookmark, textarea, input, script, style, .bst-code";
  // titles and lists that mix our texts with file names: only a whole-string match is translated
  const EXACT = ".suggestion-item, .workspace-tab-header-inner-title, .view-header-title, .bsh-rec, .bsh-sub, .bs-recent";
  const mode = (el) => { if (!el || !el.closest) return 0; if (el.closest(SKIP)) return -1; return el.closest(EXACT) ? 1 : 0; };
  function node(t) {
    const v = t.nodeValue; if (!v || !CYR.test(v)) return;
    const m = mode(t.parentElement); if (m < 0) return;
    const n = tr(v, m === 1); if (n !== v) t.nodeValue = n;
  }
  const ATTR = ["title", "aria-label", "placeholder", "data-tooltip"];
  function attrs(el) {
    if (el.nodeType !== 1) return;
    for (const a of ATTR) {
      const v = el.getAttribute(a); if (!v || !CYR.test(v)) continue;
      // the field itself is user content, but its placeholder and tooltip are ours
      const m = /^(INPUT|TEXTAREA)$/.test(el.tagName) ? mode(el.parentElement) : mode(el); if (m < 0) continue;
      const n = tr(v, m === 1); if (n !== v) el.setAttribute(a, n);
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { node(root); return; }
    if (root.nodeType !== 1) return;
    if (/^(INPUT|TEXTAREA)$/.test(root.tagName)) { attrs(root); return; }
    if (root.closest && root.closest(SKIP) && !root.matches(".suggestion-item")) return;
    attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: (n) => { if (n.nodeType === 1 && n.matches(SKIP)) { if (/^(INPUT|TEXTAREA)$/.test(n.tagName)) attrs(n); return NodeFilter.FILTER_REJECT; } return NodeFilter.FILTER_ACCEPT; } });
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) node(n); else attrs(n); }
  }
  const start = () => {
    walk(document.body); try { if (CYR.test(document.title)) document.title = tr(document.title); } catch (e) { /* ok */ }
    let burst = 0, t0 = 0;
    const mo = new MutationObserver((list) => {
      const now = performance.now(); if (now - t0 > 1000) { t0 = now; burst = 0; }
      if (++burst > 20000) { mo.disconnect(); console.error("[basalt-i18n] mutation loop, translator stopped"); return; }
      for (const m of list) {
        if (m.type === "childList") m.addedNodes.forEach(walk);
        else if (m.type === "characterData") node(m.target);
        else if (m.type === "attributes") attrs(m.target);
      }
      mo.takeRecords(); // our own edits are not news
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTR });
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);

  // native dialogs
  for (const f of ["alert", "confirm", "prompt"]) { const o = window[f]; if (o) window[f] = function (msg, ...r) { return o.call(window, typeof msg === "string" ? tr(msg) : msg, ...r); }; }
})();
