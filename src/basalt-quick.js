// Basalt quick open (VS Code Ctrl+P): one box. Plain text = file by fuzzy name, "@" = symbol in the open file, ":" = go to line.
// Ctrl+Alt+P opens files, Ctrl+Shift+O opens symbols (the app's own Ctrl+P stays the command palette).
(() => {
  "use strict";
  const fs = window.require("fs"), path = window.require("path");
  const SKIP = new Set(["node_modules", "target", "dist", "build", "out", "__pycache__", "venv", ".venv", "vendor", "coverage", "bin", "obj", "Pods"]);
  const EXTCOL = { js: "#f1e05a", ts: "#3178c6", py: "#3572A5", rs: "#dea584", go: "#00ADD8", java: "#b07219", md: "#519aba", json: "#cbcb41", yaml: "#e06c75", yml: "#e06c75", toml: "#c9733a", html: "#e34c26", css: "#7a5cc7", dart: "#00B4AB", txt: "#9aa0a6", c: "#aaaaaa", cpp: "#f34b7d", cs: "#178600", sh: "#89e051", bat: "#89e051" };
  const css = document.createElement("style");
  css.textContent = `
    .bsq-ov { position: fixed; inset: 0; z-index: 70; display: flex; justify-content: center; align-items: flex-start; padding-top: 10vh; background: rgba(0,0,0,.25); }
    .bsq-box { --background-primary: var(--vs-bg); --text-normal: var(--vs-fg); --text-muted: var(--vs-ln); --text-faint: var(--vs-ln); font-family: var(--font-interface); width: min(640px, 92vw); max-height: 60vh; display: flex; flex-direction: column; background: var(--vs-widget); color: var(--vs-fg); border: 1px solid var(--vs-border); border-radius: 0; clip-path: var(--bs-clip); box-shadow: none; overflow: hidden; }
    .bsq-in { margin: 8px; height: 30px; padding: 0 10px; border-radius: var(--bs-r, 4px); border: 1px solid transparent; background: var(--vs-input); color: var(--vs-fg); font-size: 13px; outline-offset: -1px; }
    .bsq-in:focus { outline: 1px solid var(--interactive-accent); }
    .bsq-list { overflow: auto; padding-bottom: 4px; }
    .bsq-row { display: flex; align-items: center; gap: 8px; padding: 3px 12px; height: 24px; cursor: pointer; font-size: 13px; white-space: nowrap; }
    .bsq-row.sel { background: var(--vs-selrow); color: var(--text-normal); }
    .bsq-row:hover:not(.sel) { background: rgba(128,128,128,.18); }
    .bsq-badge { flex: none; width: 16px; height: 16px; border-radius: var(--bs-r, 4px); display: inline-flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 700; color: #fff; }
    .bsq-name { overflow: hidden; text-overflow: ellipsis; } .bsq-dir { color: var(--vs-ln); font-size: 12px; overflow: hidden; text-overflow: ellipsis; } .bsq-row.sel .bsq-dir { color: var(--text-muted); }
    .bsq-name mark, .bsq-dir mark { background: none; color: var(--text-accent); font-weight: 600; }
    .bsq-hint { padding: 14px 16px; color: var(--vs-ln); font-size: 12.5px; }
  `;
  document.head.appendChild(css);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const root = () => { const W = window.__bsWorkspace; return W && W.active && W.active() && W.root() ? W.root() : app.vault.adapter.basePath; };

  let cache = { root: "", t: 0, files: [] };
  async function listFiles() {
    const rt = root(); if (cache.root === rt && Date.now() - cache.t < 20000) return cache.files;
    const res = []; async function walk2(dir, rel) {
      let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) { if (res.length > 30000) return; if (e.isDirectory()) { if (e.name[0] === "." || SKIP.has(e.name)) continue; await walk2(path.join(dir, e.name), rel ? rel + "/" + e.name : e.name); } else res.push(rel ? rel + "/" + e.name : e.name); }
    }
    await walk2(rt, ""); cache = { root: rt, t: Date.now(), files: res }; return res;
  }
  // fuzzy: every query char in order; bonus for the file name, word starts and runs. Returns {score, idx[]} or null.
  function fuzzy(q, s) {
    const ql = q.toLowerCase(), sl = s.toLowerCase(), idx = []; let p = 0, score = 0, run = 0; const base = s.lastIndexOf("/") + 1;
    for (let i = 0; i < ql.length; i++) { const c = ql[i]; if (c === " ") continue; const k = sl.indexOf(c, p); if (k < 0) return null; run = k === p && i > 0 ? run + 1 : 0; score += 1 + run * 2 + (k >= base ? 3 : 0) + (k === 0 || /[\/._\- ]/.test(s[k - 1]) ? 4 : 0) - Math.min(3, (k - p) * .1); idx.push(k); p = k + 1; }
    return { score: score - s.length * .02, idx };
  }
  const hl = (s, idx, from, to) => { const f = document.createDocumentFragment(); let last = from; for (const i of idx) { if (i < from || i >= to) continue; if (i > last) f.appendChild(document.createTextNode(s.slice(last, i))); const m = el("mark", null, s[i]); f.appendChild(m); last = i + 1; } if (last < to) f.appendChild(document.createTextNode(s.slice(last, to))); return f; };

  function openAt(abs, line) { const F = window.__bsFind; if (F && F.openAt) F.openAt(abs, line); }

  let box = null;
  const close = () => { if (box) { box.ov.remove(); document.removeEventListener("keydown", box.onKey, true); box = null; } };
  async function openQuick(initial) {
    close(); const ov = el("div", "bsq-ov"), b = el("div", "bsq-box"), inp = el("input", "bsq-in"), list = el("div", "bsq-list"); b.append(inp, list); ov.appendChild(b); document.body.appendChild(ov);
    box = { ov }; let items = [], sel = 0; const view = () => { const l = app.workspace.activeLeaf, v = l && l.view; return v && v.getViewType && v.getViewType() === "basalt-textfile" ? v : null; };
    const files = await listFiles(); const rt = root();
    const draw = () => {
      list.textContent = ""; items.forEach((it, i) => {
        const row = el("div", "bsq-row" + (i === sel ? " sel" : "")); row.appendChild(it.badge); const nm = el("span", "bsq-name"); nm.appendChild(it.name); row.appendChild(nm); if (it.dir) { const d = el("span", "bsq-dir"); d.appendChild(it.dir); row.appendChild(d); }
        row.addEventListener("mousemove", () => { if (sel !== i) { sel = i; [...list.children].forEach((c, k) => c.classList.toggle("sel", k === i)); } }); row.addEventListener("click", () => { sel = i; run(); }); list.appendChild(row);
      });
      const cur = list.children[sel]; if (cur) cur.scrollIntoView({ block: "nearest" });
    };
    const badge = (ext, txt) => { const b2 = el("span", "bsq-badge", txt != null ? txt : (ext || "·").slice(0, 3)); b2.style.background = EXTCOL[ext] || "#8a8a8a"; if (txt != null) b2.style.fontSize = "10px"; return b2; };
    const refresh = () => {
      const v = inp.value; sel = 0; items = [];
      if (v[0] === ":") { const n = parseInt(v.slice(1), 10), ed = view(); items = [{ badge: badge("", "↳"), name: document.createTextNode(ed ? (n ? "Перейти к строке " + n + " (всего " + ed.cm.lineCount() + ")" : "Введите номер строки (1–" + ed.cm.lineCount() + ")") : "Откройте файл с кодом"), run: () => { if (ed && n) { ed.cm.setCursor({ line: Math.min(n, ed.cm.lineCount()) - 1, ch: 0 }); ed.cm.scrollIntoView(null, 160); ed.cm.focus(); } } }]; draw(); return; }
      if (v[0] === "@") {
        const ed = view(); const q = v.slice(1).trim(); const P = window.__bsGraphs && window.__bsGraphs.parse;
        if (!ed || !P) { items = [{ badge: badge("", "!"), name: document.createTextNode("Символы доступны в открытом файле с кодом"), run: () => {} }]; draw(); return; }
        const ext = (ed.path.split(".").pop() || "").toLowerCase(); let syms = []; try { syms = P({ ext, name: path.basename(ed.path) }, ed.cm.getValue()).syms; } catch (e) { /* none */ }
        const rows = []; for (const s of syms) { const f = q ? fuzzy(q, s.name) : { score: -s.line * .001, idx: [] }; if (f) rows.push({ s, f }); } rows.sort((a, b) => b.f.score - a.f.score);
        const sym = { fn: "ƒ", method: "m", class: "C", type: "T" }, col = { class: "#c586c0", type: "#c586c0", method: "#4ec9b0", fn: "#dcdcaa" };
        items = rows.slice(0, 200).map(({ s, f }) => { const bd = badge("", sym[s.kind] || "ƒ"); bd.style.background = col[s.kind] || "#8a8a8a"; return { badge: bd, name: hl(s.name, f.idx, 0, s.name.length), dir: document.createTextNode(":" + (s.line + 1)), run: () => { ed.cm.setCursor({ line: s.line, ch: 0 }); ed.cm.scrollIntoView({ line: s.line, ch: 0 }, 160); ed.cm.focus(); } }; });
        if (!items.length) items = [{ badge: badge("", "?"), name: document.createTextNode(syms.length ? "Нет совпадений" : "В этом файле символы не найдены"), run: () => {} }]; draw(); return;
      }
      const rows = []; for (const f of files) { const r = v.trim() ? fuzzy(v, f) : { score: 0, idx: [] }; if (r) rows.push({ f, r }); if (!v.trim() && rows.length >= 60) break; }
      if (v.trim()) rows.sort((a, b) => b.r.score - a.r.score);
      items = rows.slice(0, 80).map(({ f, r }) => { const ext = (f.split(".").pop() || "").toLowerCase(), cut = f.lastIndexOf("/") + 1; return { badge: badge(f.includes(".") ? ext : ""), name: hl(f, r.idx, cut, f.length), dir: cut ? hl(f, r.idx, 0, cut - 1) : null, run: () => openAt(path.join(rt, f), 0) }; });
      if (!items.length) items = [{ badge: badge("", "?"), name: document.createTextNode("Файл не найден"), run: () => {} }]; draw();
    };
    const run = () => { const it = items[sel]; if (!it) return; close(); it.run(); };
    inp.addEventListener("input", refresh);
    box.onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); } else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); } else if (e.key === "Enter" && document.activeElement === inp) { e.preventDefault(); run(); } };
    document.addEventListener("keydown", box.onKey, true); ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
    inp.placeholder = "Имя файла…  @ символ в файле   : строка"; inp.value = initial || ""; inp.focus(); refresh();
  }

  const t = setInterval(() => {
    if (!window.app || !app.commands || !app.commands.addCommand || !app.vault || !app.vault.adapter) return;
    clearInterval(t);
    app.commands.addCommand({ id: "basalt:quick-open", name: "Перейти к файлу (быстрое открытие)", icon: "lucide-file-search", hotkeys: [{ modifiers: ["Ctrl", "Alt"], key: "P" }], callback: () => openQuick("") });
    app.commands.addCommand({ id: "basalt:go-symbol", name: "Перейти к символу в файле", icon: "lucide-braces", hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "O" }], callback: () => openQuick("@") });
    app.commands.addCommand({ id: "basalt:go-line", name: "Перейти к строке", icon: "lucide-arrow-down-to-line", callback: () => openQuick(":") });
    window.__bsQuick = { open: openQuick };
  }, 500);
})();
