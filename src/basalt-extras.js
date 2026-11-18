// Basalt extras: the ideas of a few popular community plugins, built in.
//  - 2-hop links: a side panel with the notes two links away from the open note (like "2Hop Links")
//  - table editor: edit the markdown table under the cursor in a grid, or insert a new one (like "Advanced Tables" / "Table Editor")
//  - admonitions: ```ad-note blocks (and the built-in callouts) in the Basalt look, plus a command to insert one (like "Admonition")
(() => {
  "use strict";
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const toast = (m) => { try { new window.Notice(m, 6000); } catch (e) { /* not ready */ } };

  const css = document.createElement("style");
  css.textContent = `
    /* ---- shared dialog shell */
    .bsx-modal .modal { width: min(920px, 94vw); max-width: none; }
    /* ---- 2-hop panel */
    .bsx-hop { padding: 10px 12px; font-size: var(--font-ui-small); }
    .bsx-hop h4 { margin: 12px 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: .12em; color: var(--text-faint); font-weight: 500; }
    .bsx-hop .bsx-title { font-weight: 600; font-size: var(--font-ui-medium); margin-bottom: 2px; }
    .bsx-hop .bsx-sub { color: var(--text-muted); font-size: var(--font-ui-smaller); }
    .bsx-hop .bsx-group { margin: 6px 0; border-left: 2px solid var(--background-modifier-border); padding-left: 8px; }
    .bsx-hop .bsx-via { display: flex; gap: 6px; align-items: baseline; cursor: pointer; color: var(--text-accent); }
    .bsx-hop .bsx-via span { color: var(--text-faint); font-size: var(--font-ui-smaller); }
    .bsx-hop .bsx-item { display: block; padding: 1px 0 1px 10px; color: var(--text-normal); cursor: pointer; }
    .bsx-hop .bsx-item:hover, .bsx-hop .bsx-via:hover { background: var(--background-modifier-hover); }
    .bsx-hop .bsx-empty { color: var(--text-muted); padding: 14px 0; }
    /* ---- table editor */
    .bsx-grid { width: 100%; border-collapse: collapse; margin: 8px 0; }
    .bsx-grid td, .bsx-grid th { border: 1px solid var(--background-modifier-border); padding: 0; }
    .bsx-grid th { background: var(--background-secondary); font-weight: 500; }
    .bsx-grid input { width: 100%; min-width: 80px; border: 0; border-radius: 0; background: transparent; padding: 6px 8px; box-shadow: none; color: var(--text-normal); height: auto; }
    .bsx-grid th input { font-weight: 600; }
    .bsx-grid td.is-cur, .bsx-grid th.is-cur { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
    .bsx-tools { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .bsx-tools button { padding: 3px 10px; }
    .bsx-scroll { max-height: 56vh; overflow: auto; }
    /* ---- admonitions and callouts */
    .bsx-ad, .markdown-rendered .callout, .markdown-source-view .callout { --bsx-c: var(--interactive-accent); border: 0; border-left: 3px solid var(--bsx-c); background: color-mix(in srgb, var(--bsx-c) 9%, var(--background-primary));
      border-radius: 0; margin: 12px 0; padding: 0; clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); mix-blend-mode: normal; }
    .bsx-ad-title { display: flex; align-items: center; gap: 8px; padding: 8px 14px; font-weight: 700; color: var(--bsx-c); text-transform: none; }
    .bsx-ad-body { padding: 0 14px 10px; } .bsx-ad-body > :first-child { margin-top: 0; } .bsx-ad-body > :last-child { margin-bottom: 0; }
    .callout[data-callout="note"], .bsx-ad[data-t="note"] { --bsx-c: #7b8cff; } .callout[data-callout="info"], .bsx-ad[data-t="info"] { --bsx-c: #5ad1e6; }
    .callout[data-callout="tip"], .callout[data-callout="hint"], .bsx-ad[data-t="tip"] { --bsx-c: #4fd18b; } .callout[data-callout="success"], .callout[data-callout="check"], .callout[data-callout="done"], .bsx-ad[data-t="success"] { --bsx-c: #4fd18b; }
    .callout[data-callout="warning"], .callout[data-callout="caution"], .bsx-ad[data-t="warning"] { --bsx-c: #f2c14e; } .callout[data-callout="question"], .callout[data-callout="help"], .callout[data-callout="faq"], .bsx-ad[data-t="question"] { --bsx-c: #f2c14e; }
    .callout[data-callout="danger"], .callout[data-callout="error"], .callout[data-callout="failure"], .callout[data-callout="fail"], .callout[data-callout="missing"], .bsx-ad[data-t="danger"], .bsx-ad[data-t="failure"] { --bsx-c: #ff6b6b; }
    .callout[data-callout="bug"], .bsx-ad[data-t="bug"] { --bsx-c: #ff7ac6; } .callout[data-callout="example"], .bsx-ad[data-t="example"] { --bsx-c: #b98cff; } .callout[data-callout="quote"], .callout[data-callout="cite"], .bsx-ad[data-t="quote"] { --bsx-c: #9a9ca6; }
    .callout[data-callout="abstract"], .callout[data-callout="summary"], .callout[data-callout="tldr"], .bsx-ad[data-t="abstract"] { --bsx-c: #5ad1e6; }
    .callout .callout-title { color: var(--bsx-c); font-weight: 700; } .callout .callout-icon { color: var(--bsx-c); }
  `;
  document.head.appendChild(css);

  const shell = (title, cls) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-container mod-dim " + (cls || "");
    wrap.innerHTML = '<div class="modal-bg"></div><div class="modal"><div class="modal-close-button"></div><div class="modal-title"></div><div class="modal-content"></div></div>';
    wrap.querySelector(".modal-title").textContent = title;
    const prev = document.activeElement;
    const close = () => { wrap.remove(); try { prev && prev.focus && prev.focus(); } catch (e) { /* gone */ } };
    wrap.querySelector(".modal-close-button").addEventListener("click", close);
    wrap.querySelector(".modal-bg").addEventListener("click", close);
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    document.body.appendChild(wrap);
    return { wrap, body: wrap.querySelector(".modal-content"), close };
  };

  // ================================================================ 2-hop links
  const HOP_TYPE = "basalt-2hop";
  function hopData(app, file) {
    const resolved = app.metadataCache.resolvedLinks || {};
    const outOf = (p) => Object.keys(resolved[p] || {});
    const inTo = new Map();
    for (const [src, dests] of Object.entries(resolved)) for (const d of Object.keys(dests)) { if (!inTo.has(d)) inTo.set(d, []); inTo.get(d).push(src); }
    const near = (p) => Array.from(new Set([...outOf(p), ...(inTo.get(p) || [])]));
    const first = near(file.path).filter((p) => p !== file.path);
    const direct = new Set([file.path, ...first]);
    const groups = [];
    for (const via of first) {
      const items = near(via).filter((p) => !direct.has(p));
      if (items.length) groups.push({ via, items });
    }
    groups.sort((a, b) => b.items.length - a.items.length);
    // notes reachable through several different neighbours are the strongest candidates
    const count = new Map(); groups.forEach((g) => g.items.forEach((p) => count.set(p, (count.get(p) || 0) + 1)));
    const strong = Array.from(count.entries()).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 15);
    return { first, groups, strong };
  }
  function makeHopView(api) {
    return class HopView extends api.ItemView {
      getViewType() { return HOP_TYPE; }
      getDisplayText() { return "Связи 2-го уровня"; }
      getIcon() { return "lucide-git-fork"; }
      async onOpen() {
        this.contentEl.empty && this.contentEl.empty();
        this.box = document.createElement("div"); this.box.className = "bsx-hop"; this.contentEl.appendChild(this.box);
        this.file = this.app.workspace.getActiveFile();
        this.render();
        const again = () => { clearTimeout(this.t); this.t = setTimeout(() => this.render(), 300); };
        this.registerEvent(this.app.workspace.on("file-open", (f) => { if (f) { this.file = f; again(); } }));
        this.registerEvent(this.app.metadataCache.on("resolved", again));
      }
      async onClose() { clearTimeout(this.t); }
      openNote(path, ev) { const f = this.app.vault.getAbstractFileByPath(path); if (f) this.app.workspace.getLeaf(ev && (ev.ctrlKey || ev.metaKey) ? "tab" : "tab").openFile(f); }
      render() {
        const b = this.box; b.textContent = "";
        if (!this.file) { b.innerHTML = '<div class="bsx-empty">Откройте заметку.</div>'; return; }
        const d = hopData(this.app, this.file), name = (p) => p.replace(/^.*\//, "").replace(/\.md$/, "");
        const add = (html, cls) => { const e = document.createElement("div"); if (cls) e.className = cls; e.innerHTML = html; b.appendChild(e); return e; };
        add(`<div class="bsx-title">${esc(this.file.basename)}</div><div class="bsx-sub">Прямых связей: ${d.first.length} · через них достаются ещё ${d.groups.reduce((t, g) => t + g.items.length, 0)}</div>`);
        if (!d.groups.length) { add("Ничего нет за одним переходом: у заметок рядом нет других связей.", "bsx-empty"); return; }
        if (d.strong.length) {
          add("<h4>Достижимы несколькими путями</h4>");
          for (const [p, n] of d.strong) { const e = add(`${esc(name(p))} <span class="bsx-sub">· ${n} пут.</span>`, "bsx-item"); e.addEventListener("click", (ev) => this.openNote(p, ev)); }
        }
        add("<h4>Через какие заметки</h4>");
        for (const g of d.groups.slice(0, 60)) {
          const box = add("", "bsx-group");
          const via = document.createElement("div"); via.className = "bsx-via"; via.innerHTML = `${esc(name(g.via))}<span>${g.items.length}</span>`; via.addEventListener("click", (ev) => this.openNote(g.via, ev)); box.appendChild(via);
          for (const p of g.items.slice(0, 40)) { const it = document.createElement("a"); it.className = "bsx-item"; it.textContent = name(p); it.addEventListener("click", (ev) => this.openNote(p, ev)); box.appendChild(it); }
        }
      }
    };
  }

  // ================================================================ table editor
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
  const splitRow = (l) => { let t = l.trim(); if (t.startsWith("|")) t = t.slice(1); if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1); const out = []; let cur = ""; for (let i = 0; i < t.length; i++) { if (t[i] === "\\" && t[i + 1] === "|") { cur += "|"; i++; } else if (t[i] === "|") { out.push(cur.trim()); cur = ""; } else cur += t[i]; } out.push(cur.trim()); return out; };
  function parseTable(lines) {
    const head = splitRow(lines[0]), sep = splitRow(lines[1]), n = head.length;
    const align = sep.map((s) => (s.startsWith(":") && s.endsWith(":") ? "c" : s.endsWith(":") ? "r" : s.startsWith(":") ? "l" : ""));
    const rows = lines.slice(2).map((l) => { const r = splitRow(l); while (r.length < n) r.push(""); return r.slice(0, n); });
    while (align.length < n) align.push("");
    return { head, align: align.slice(0, n), rows };
  }
  function formatTable(t) {
    const cols = t.head.length, cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " "), all = [t.head, ...t.rows].map((r) => r.map(cell));
    const w = Array.from({ length: cols }, (_, c) => Math.max(3, ...all.map((r) => [...(r[c] || "")].length)));
    const pad = (s, c) => s + " ".repeat(Math.max(0, w[c] - [...s].length));
    const line = (r) => "| " + r.map((s, c) => pad(s || "", c)).join(" | ") + " |";
    const sep = "| " + t.align.map((a, c) => { const d = "-".repeat(Math.max(3, w[c] - (a ? (a === "c" ? 2 : 1) : 0))); return a === "c" ? ":" + d + ":" : a === "r" ? d + ":" : a === "l" ? ":" + d : d; }).join(" | ") + " |";
    return [line(all[0]), sep, ...all.slice(1).map(line)].join("\n");
  }
  function openTableEditor(table, apply) {
    const t = JSON.parse(JSON.stringify(table));
    const { body, close } = shell("Редактор таблицы", "bsx-modal");
    const tools = document.createElement("div"); tools.className = "bsx-tools";
    const scroll = document.createElement("div"); scroll.className = "bsx-scroll";
    const foot = document.createElement("div"); foot.className = "bsx-tools"; foot.style.marginTop = "10px";
    body.append(tools, scroll, foot);
    let cur = { r: 0, c: 0 };
    const btn = (parent, txt, fn, cls) => { const b = document.createElement("button"); b.textContent = txt; if (cls) b.className = cls; b.addEventListener("click", fn); parent.appendChild(b); return b; };
    const grid = () => {
      scroll.textContent = "";
      const tb = document.createElement("table"); tb.className = "bsx-grid";
      const mk = (tag, val, r, c, set) => { const cellEl = document.createElement(tag); if (cur.r === r && cur.c === c) cellEl.classList.add("is-cur"); const i = document.createElement("input"); i.value = val; i.style.textAlign = t.align[c] === "c" ? "center" : t.align[c] === "r" ? "right" : "left";
        i.addEventListener("input", () => set(i.value)); i.addEventListener("focus", () => { cur = { r, c }; tb.querySelectorAll(".is-cur").forEach((x) => x.classList.remove("is-cur")); cellEl.classList.add("is-cur"); });
        i.addEventListener("keydown", (e) => { const mv = (dr, dc) => { e.preventDefault(); const nr = Math.max(0, Math.min(t.rows.length, r + dr)), nc = Math.max(0, Math.min(t.head.length - 1, c + dc)); cur = { r: nr, c: nc }; grid(); const inp = scroll.querySelectorAll("tr")[nr].querySelectorAll("input")[nc]; inp && inp.focus(); };
          if (e.key === "Enter") { if (r === t.rows.length) { t.rows.push(t.head.map(() => "")); } mv(1, 0); } else if (e.key === "ArrowDown" && e.altKey) mv(1, 0); else if (e.key === "ArrowUp" && e.altKey) mv(-1, 0); else if (e.key === "Tab") { if (!e.shiftKey && c === t.head.length - 1 && r === t.rows.length) { t.rows.push(t.head.map(() => "")); } if (e.shiftKey) mv(c === 0 ? -1 : 0, c === 0 ? t.head.length - 1 : -1); else mv(c === t.head.length - 1 ? 1 : 0, c === t.head.length - 1 ? -(t.head.length - 1) : 1); } });
        cellEl.appendChild(i); return cellEl; };
      const tr0 = document.createElement("tr"); t.head.forEach((h, c) => tr0.appendChild(mk("th", h, 0, c, (v) => { t.head[c] = v; }))); tb.appendChild(tr0);
      // row index 0 is the header; body rows are 1..n in cursor terms
      t.rows.forEach((row, ri) => { const tr = document.createElement("tr"); row.forEach((v, c) => tr.appendChild(mk("td", v, ri + 1, c, (x) => { t.rows[ri][c] = x; }))); tb.appendChild(tr); });
      scroll.appendChild(tb);
    };
    const colOp = (fn) => () => { fn(); grid(); };
    btn(tools, "+ строка ниже", colOp(() => { t.rows.splice(Math.max(0, cur.r), 0, t.head.map(() => "")); }));
    btn(tools, "− строка", colOp(() => { if (cur.r >= 1 && t.rows.length) t.rows.splice(cur.r - 1, 1); }));
    btn(tools, "↑", colOp(() => { const i = cur.r - 1; if (i > 0) { [t.rows[i - 1], t.rows[i]] = [t.rows[i], t.rows[i - 1]]; cur.r--; } }));
    btn(tools, "↓", colOp(() => { const i = cur.r - 1; if (i >= 0 && i < t.rows.length - 1) { [t.rows[i + 1], t.rows[i]] = [t.rows[i], t.rows[i + 1]]; cur.r++; } }));
    btn(tools, "+ столбец справа", colOp(() => { const c = cur.c + 1; t.head.splice(c, 0, ""); t.align.splice(c, 0, ""); t.rows.forEach((r) => r.splice(c, 0, "")); }));
    btn(tools, "− столбец", colOp(() => { if (t.head.length > 1) { t.head.splice(cur.c, 1); t.align.splice(cur.c, 1); t.rows.forEach((r) => r.splice(cur.c, 1)); cur.c = Math.min(cur.c, t.head.length - 1); } }));
    btn(tools, "←", colOp(() => { const c = cur.c; if (c > 0) { for (const r of [t.head, ...t.rows]) [r[c - 1], r[c]] = [r[c], r[c - 1]]; [t.align[c - 1], t.align[c]] = [t.align[c], t.align[c - 1]]; cur.c--; } }));
    btn(tools, "→", colOp(() => { const c = cur.c; if (c < t.head.length - 1) { for (const r of [t.head, ...t.rows]) [r[c + 1], r[c]] = [r[c], r[c + 1]]; [t.align[c + 1], t.align[c]] = [t.align[c], t.align[c + 1]]; cur.c++; } }));
    [["", "выр. по умолч."], ["l", "влево"], ["c", "по центру"], ["r", "вправо"]].forEach(([a, l]) => btn(tools, l, colOp(() => { t.align[cur.c] = a; })));
    const hint = document.createElement("span"); hint.style.cssText = "flex:1;color:var(--text-faint);font-size:var(--font-ui-smaller)"; hint.textContent = "Tab / Enter — следующая ячейка, в конце появится новая строка"; foot.appendChild(hint);
    btn(foot, "Отмена", close);
    btn(foot, "Применить", () => { apply(formatTable(t)); close(); }, "mod-cta");
    grid();
    setTimeout(() => { const i = scroll.querySelector("input"); i && i.focus(); }, 30);
  }
  function tableAt(editor) {
    const cur = editor.getCursor().line, last = editor.lastLine();
    if (!isRow(editor.getLine(cur))) return null;
    let s = cur, e = cur; while (s > 0 && isRow(editor.getLine(s - 1))) s--; while (e < last && isRow(editor.getLine(e + 1))) e++;
    const lines = []; for (let i = s; i <= e; i++) lines.push(editor.getLine(i));
    if (lines.length < 2 || !isSep(lines[1])) return null;
    return { s, e, lines };
  }

  // ================================================================ admonitions
  const AD = { note: "Заметка", info: "Инфо", tip: "Совет", success: "Готово", warning: "Внимание", question: "Вопрос", danger: "Опасно", failure: "Ошибка", bug: "Баг", example: "Пример", quote: "Цитата", abstract: "Кратко" };
  const md = (src) => {
    const lines = src.replace(/\r/g, "").split("\n"), out = []; let list = null;
    const inl = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>").replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, a, b) => `<a class="internal-link" data-href="${a}">${b || a}</a>`).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const l of lines) { let m;
      if ((m = /^\s*[-*+]\s+(.*)$/.exec(l))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inl(m[1])}</li>`); } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inl(m[1])}</li>`); } else if (!l.trim()) close(); else { close(); out.push(`<p>${inl(l)}</p>`); } }
    close(); return out.join("");
  };
  function enhanceAdmonition(pre) {
    if (pre.dataset.bsxAd) return; const code = pre.querySelector("code"); if (!code) return;
    const m = /language-ad-([\w-]+)/.exec(code.className || ""); if (!m) return;
    pre.dataset.bsxAd = "1";
    const type = m[1].toLowerCase(), text = code.textContent; let title = AD[type] || type[0].toUpperCase() + type.slice(1), body = text;
    const tm = /^\s*title:\s*(.*)\n?/i.exec(body); if (tm) { title = tm[1].trim() || title; body = body.slice(tm[0].length); }
    const el = document.createElement("div"); el.className = "bsx-ad"; el.dataset.t = type;
    el.innerHTML = `<div class="bsx-ad-title">${esc(title)}</div><div class="bsx-ad-body">${md(body)}</div>`;
    pre.replaceWith(el);
  }
  let queued = false;
  const scan = () => { queued = false; for (const pre of document.querySelectorAll("pre:not([data-bsx-ad])")) enhanceAdmonition(pre); };
  const watch = () => { new MutationObserver(() => { if (!queued) { queued = true; setTimeout(scan, 150); } }).observe(document.body, { childList: true, subtree: true }); scan(); };
  if (document.body) watch(); else document.addEventListener("DOMContentLoaded", watch);

  // ================================================================ the "+" of the tab bar: choose what to open
  const uniqueName = (base, ext) => { let n = base, i = 1; while (app.vault.getAbstractFileByPath(n + "." + ext)) n = base + " " + ++i; return n + "." + ext; };
  async function openInNewTab(tabsEl, action) {
    const ws = app.workspace; let parent = null;
    ws.iterateAllLeaves((l) => { if (!parent && l.parent && l.parent.containerEl === tabsEl) parent = l.parent; });
    const leaf = parent && ws.createLeafInParent ? ws.createLeafInParent(parent, parent.children.length) : ws.getLeaf("tab");
    await action(leaf);
    ws.setActiveLeaf(leaf, { focus: true });
  }
  const NEW_TAB_ITEMS = [
    ["Новая заметка", "lucide-file-plus", async (leaf) => { const f = await app.vault.create(uniqueName("Без названия", "md"), ""); await leaf.openFile(f); }],
    ["Новый холст", "lucide-layout-dashboard", async (leaf) => { const f = await app.vault.create(uniqueName("Без названия", "canvas"), JSON.stringify({ nodes: [], edges: [] })); await leaf.openFile(f); }],
    null,
    ["Терминал", "lucide-terminal", (leaf) => leaf.setViewState({ type: "basalt-terminal", active: true })],
    ["Граф", "lucide-git-fork", (leaf) => leaf.setViewState({ type: "graph", active: true, state: {} })],
    ["Локальный граф", "lucide-git-fork", (leaf) => { const f = app.workspace.getActiveFile(); return leaf.setViewState({ type: "localgraph", active: true, state: f ? { file: f.path } : {} }); }],
    null,
    ["Быстрый поиск", "lucide-search", async (leaf) => { await leaf.setViewState({ type: "empty" }); app.commands.executeCommandById("basalt:quick-search"); }],
    ["Пустая вкладка", "lucide-plus", (leaf) => leaf.setViewState({ type: "empty" })],
  ];
  function installNewTabMenu() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest(".workspace-tab-header-new-tab");
      if (!btn || e.shiftKey || !window.__bsApi || !window.__bsApi.Menu || !window.app) return; // Shift+click keeps the stock empty tab
      e.preventDefault(); e.stopPropagation();
      const menu = new window.__bsApi.Menu(), tabsEl = btn.closest(".workspace-tabs");
      for (const it of NEW_TAB_ITEMS) {
        if (!it) { menu.addSeparator(); continue; }
        menu.addItem((i) => i.setTitle(it[0]).setIcon(it[1]).onClick(() => { openInNewTab(tabsEl, it[2]).catch((err) => toast(err.message)); }));
      }
      const r = btn.getBoundingClientRect();
      menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
    }, true);
  }

  // ================================================================ registration
  installNewTabMenu();
  let done = false;
  const register = () => {
    if (done || !window.app || !app.commands || !app.workspace || !app.viewRegistry || !window.__bsApi) return false;
    done = true;
    app.commands.addCommand({ id: "basalt:table-edit", name: "Таблица: редактировать в сетке", editorCheckCallback: (checking, editor) => { const t = tableAt(editor); if (!t) return false; if (!checking) openTableEditor(parseTable(t.lines), (txt) => { editor.replaceRange(txt, { line: t.s, ch: 0 }, { line: t.e, ch: editor.getLine(t.e).length }); setTimeout(() => editor.focus && editor.focus(), 30); }); return true; } });
    app.commands.addCommand({ id: "basalt:table-insert", name: "Таблица: вставить новую", editorCallback: (editor) => openTableEditor({ head: ["Столбец 1", "Столбец 2", "Столбец 3"], align: ["", "", ""], rows: [["", "", ""], ["", "", ""]] }, (txt) => editor.replaceSelection(txt + "\n")) });
    for (const [k, label] of Object.entries(AD)) app.commands.addCommand({ id: "basalt:ad-" + k, name: "Выноска: " + label, editorCallback: (editor) => { const sel = editor.getSelection(); editor.replaceSelection("```ad-" + k + "\ntitle: " + label + "\n" + (sel || "Текст выноски") + "\n```\n"); } });
    return true;
  };
  let tries = 0;
  const timer = setInterval(() => { try { if (register() || ++tries > 120) clearInterval(timer); } catch (e) { console.error("[basalt-extras]", e); if (++tries > 120) clearInterval(timer); } }, 1000);
  window.__basaltExtras = { hopData, parseTable, formatTable, tableAt, md };
})();
