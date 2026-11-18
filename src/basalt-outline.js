// Basalt "Структура" (VS Code Outline): symbols of the code file in front, in a side panel; click jumps, the symbol under the cursor is highlighted.
(() => {
  "use strict";
  const VIEW = "basalt-outline", TEXT = "basalt-textfile";
  const css = document.createElement("style");
  css.textContent = `
    .bso { --background-primary: var(--vs-bg); --text-normal: var(--vs-fg); --text-muted: var(--vs-ln); font-family: var(--font-interface); height: 100%; display: flex; flex-direction: column; background: var(--vs-bg); color: var(--vs-fg); }
    .bso-head { padding: 6px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--vs-ln); display: flex; gap: 8px; }
    .bso-in { margin: 0 8px 6px; height: 24px; padding: 0 8px; border-radius: var(--bs-r, 4px); border: 1px solid transparent; background: var(--vs-input); color: var(--vs-fg); font-size: 12px; outline-offset: -1px; }
    .bso-in:focus { outline: 1px solid var(--interactive-accent); }
    .bso-list { flex: 1; overflow: auto; padding-bottom: 8px; }
    .bso-row { display: flex; align-items: center; gap: 7px; height: 22px; padding: 0 12px; cursor: pointer; font-size: 13px; white-space: nowrap; }
    .bso-row:hover { background: rgba(128,128,128,.18); } .bso-row.cur { background: rgba(128,128,128,.3); }
    .bso-row.m { padding-left: 28px; }
    .bso-k { flex: none; width: 16px; height: 16px; border-radius: var(--bs-r, 4px); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; }
    .bso-n { overflow: hidden; text-overflow: ellipsis; } .bso-l { margin-left: auto; color: var(--vs-ln); font-size: 11px; }
    .bso-empty { padding: 16px; color: var(--vs-ln); font-size: 12.5px; }
  `;
  document.head.appendChild(css);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const KIND = { fn: ["ƒ", "#dcdcaa"], method: ["m", "#4ec9b0"], class: ["C", "#c586c0"], type: ["T", "#c586c0"] };

  function makeView(api) {
    return class OutlineView extends api.ItemView {
      getViewType() { return VIEW; }
      getDisplayText() { return "Структура"; }
      getIcon() { return "lucide-list-tree"; }
      async onOpen() {
        const c = this.contentEl; c.textContent = ""; c.style.padding = "0"; const root = el("div", "bso"); c.appendChild(root);
        root.appendChild(el("div", "bso-head", "Структура файла")); this.q = el("input", "bso-in"); this.q.placeholder = "Фильтр"; root.appendChild(this.q); this.list = el("div", "bso-list"); root.appendChild(this.list);
        this.q.addEventListener("input", () => this.render()); this.syms = []; this.gen = -1; this.view = null; this.curLine = -1;
        this.timer = setInterval(() => this.poll(), 500); this.poll();
      }
      poll() {
        const l = app.workspace.activeLeaf, v = l && l.view, ok = v && v.getViewType && v.getViewType() === TEXT && v.cm;
        if (!ok) { if (!this.view) return; if (!this.view.cm || !this.view.contentEl.isConnected) { this.view = null; this.syms = []; this.render(); } return; }
        const cm = v.cm, g = cm.changeGeneration(), line = cm.getCursor().line;
        if (v !== this.view || g !== this.gen) { this.view = v; this.gen = g; this.reparse(); }
        if (line !== this.curLine) { this.curLine = line; this.markCurrent(); }
      }
      reparse() {
        const v = this.view, P = window.__bsGraphs && window.__bsGraphs.parse; this.syms = [];
        if (v && P) { const ext = (v.path.split(".").pop() || "").toLowerCase(); try { this.syms = P({ ext, name: v.path.split(/[\\/]/).pop() }, v.cm.getValue()).syms; } catch (e) { /* none */ } }
        this.name = v ? v.path.split(/[\\/]/).pop() : ""; this.render();
      }
      render() {
        const q = (this.q.value || "").toLowerCase(), L = this.list; L.textContent = "";
        if (!this.view) { L.appendChild(el("div", "bso-empty", "Откройте файл с кодом — здесь появятся его функции и классы.")); return; }
        const items = this.syms.filter((s) => !q || s.name.toLowerCase().includes(q));
        if (!items.length) { L.appendChild(el("div", "bso-empty", this.syms.length ? "Нет совпадений" : "В файле " + this.name + " символы не найдены")); return; }
        this.rows = items.map((s) => {
          const r = el("div", "bso-row" + (s.kind === "method" ? " m" : "")), k = KIND[s.kind] || KIND.fn, b = el("span", "bso-k", k[0]); b.style.background = k[1];
          r.append(b, el("span", "bso-n", s.name), el("span", "bso-l", String(s.line + 1)));
          r.addEventListener("click", () => { const cm = this.view && this.view.cm; if (!cm) return; app.workspace.setActiveLeaf(this.view.leaf, { focus: true }); cm.setCursor({ line: s.line, ch: 0 }); cm.scrollIntoView({ line: s.line, ch: 0 }, 160); cm.focus(); });
          L.appendChild(r); return { s, r };
        });
        this.markCurrent();
      }
      markCurrent() {
        if (!this.rows) return; let best = null; for (const x of this.rows) if (x.s.line <= this.curLine) best = x; this.rows.forEach((x) => x.r.classList.toggle("cur", x === best)); if (best && !this.q.value) best.r.scrollIntoView({ block: "nearest" });
      }
      async onClose() { clearInterval(this.timer); }
    };
  }

  async function openOutline() {
    const ws = app.workspace; const ex = ws.getLeavesOfType(VIEW)[0]; if (ex) { ws.revealLeaf(ex); return; }
    const leaf = ws.getRightLeaf(false); await leaf.setViewState({ type: VIEW, active: true }); ws.revealLeaf(leaf);
  }
  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.viewRegistry || !app.commands || !window.__bsApi || !window.__bsApi.ItemView) return;
    clearInterval(t);
    const V = makeView(window.__bsApi), creator = (leaf) => new V(leaf);
    try { app.viewRegistry.registerView(VIEW, creator); } catch (e) { app.viewRegistry.viewByType[VIEW] = creator; }
    app.commands.addCommand({ id: "basalt:outline", name: "Структура файла (панель справа)", icon: "lucide-list-tree", callback: () => openOutline() });
    window.__bsOutline = { open: openOutline };
  }, 500);
})();
