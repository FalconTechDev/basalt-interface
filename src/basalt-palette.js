// Basalt quick switcher (Ctrl+O) and command palette (Ctrl+P): our own, replaces the inherited ones.
// Type to filter by fuzzy match; ">" at the start switches to commands; Enter opens/runs, Ctrl+Enter opens in a new tab.
(() => {
  "use strict";
  const mainLeaf = (newTab) => { const ws = app.workspace; let l = newTab ? null : ws.getMostRecentLeaf(ws.rootSplit); if (!l || l.getRoot() !== ws.rootSplit) l = ws.getLeaf("tab"); return l; }; /* a file opens in the main area, never in a side panel that happens to be focused */

  const css = document.createElement("style");
  css.textContent = `
    .bpal-wrap { position: fixed; inset: 0; z-index: 1000; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; background: rgba(0,0,0,.35); }
    .bpal { width: min(640px, 92vw); max-height: 70vh; display: flex; flex-direction: column; background: var(--modal-background, var(--background-primary)); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);   overflow: hidden; }
    .bpal-in { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--background-modifier-border); }
    .bpal-mode { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; padding: 2px 8px; background: color-mix(in srgb, var(--interactive-accent) 22%, transparent); color: var(--interactive-accent); flex: none; border-radius: 4px; }
    .bpal-in input:focus, .bpal-in input:focus-visible { box-shadow: none !important; border: 0 !important; outline: none !important; border-radius: 0 !important; }
    .bpal-in input { flex: 1; border: 0; background: transparent; box-shadow: none; font-size: 16px; color: var(--text-normal); height: auto; padding: 4px 0; outline: none; }
    .bpal-list { overflow: auto; padding: 4px; }
    .bpal-i { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-radius: var(--bs-r); cursor: pointer; }
    .bpal-i.is-sel { background: color-mix(in srgb, var(--interactive-accent) 18%, transparent); }
    .bpal-i .bpal-ic { color: var(--interactive-accent); display: inline-flex; flex: none; } .bpal-i .bpal-ic svg { width: 16px; height: 16px; }
    .bpal-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bpal-t small { color: var(--text-faint); margin-left: 8px; }
    .bpal-t mark, .bpal-i mark { background: none; color: var(--interactive-accent); font-weight: 600; }
    .bpal-k { color: var(--text-faint); font-size: var(--font-ui-smaller); font-family: var(--font-monospace); flex: none; }
    .bpal-foot { display: flex; gap: 14px; padding: 6px 16px; border-top: 1px solid var(--background-modifier-border); color: var(--text-faint); font-size: var(--font-ui-smaller); }
    .bpal-empty { padding: 20px; color: var(--text-muted); text-align: center; }
  `;
  document.head.appendChild(css);

  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // fuzzy match: every query letter appears in order; consecutive letters and word starts score more
  function fuzzy(q, text) {
    if (!q) return { score: 0, idx: [] };
    const t = text.toLowerCase(), idx = []; let pos = 0, score = 0, prev = -2;
    for (const ch of q) {
      const i = t.indexOf(ch, pos); if (i < 0) return null;
      score += 1 + (i === prev + 1 ? 4 : 0) + (i === 0 || /[\s\-_/.]/.test(t[i - 1]) ? 3 : 0) - Math.min(i - pos, 6) * 0.1;
      idx.push(i); prev = i; pos = i + 1;
    }
    return { score: score - t.length * 0.01, idx };
  }
  const hl = (text, idx) => { if (!idx.length) return esc(text); const set = new Set(idx); let o = ""; for (let i = 0; i < text.length; i++) o += set.has(i) ? `<mark>${esc(text[i])}</mark>` : esc(text[i]); return o; };
  const ICONS = { md: "lucide-file-text", canvas: "lucide-layout-dashboard", img: "lucide-image", other: "lucide-file" };
  const iconOf = (f) => (f.extension === "md" ? ICONS.md : f.extension === "canvas" ? ICONS.canvas : /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.extension) ? ICONS.img : ICONS.other);
  const recentCmds = () => { try { return JSON.parse(localStorage.getItem("basalt-recent-cmds") || "[]"); } catch (e) { return []; } };
  const pushCmd = (id) => { try { localStorage.setItem("basalt-recent-cmds", JSON.stringify([id, ...recentCmds().filter((x) => x !== id)].slice(0, 12))); } catch (e) { /* full */ } };

  let open = null;
  function show(mode) {
    if (open) { open.setMode(mode); return; }
    const api = window.__bsApi;
    const wrap = document.createElement("div"); wrap.className = "bpal-wrap";
    wrap.innerHTML = '<div class="bpal"><div class="bpal-in"><span class="bpal-mode"></span><input type="text" spellcheck="false"></div><div class="bpal-list"></div><div class="bpal-foot"><span>↑↓ выбрать</span><span>Enter открыть</span><span class="bpal-f2">Ctrl+Enter в новой вкладке</span><span>&gt; команды</span><span>Esc закрыть</span></div></div>';
    const input = wrap.querySelector("input"), list = wrap.querySelector(".bpal-list"), modeEl = wrap.querySelector(".bpal-mode"), f2 = wrap.querySelector(".bpal-f2");
    const prev = document.activeElement; let m = mode, sel = 0, items = [];
    const close = () => { wrap.remove(); open = null; try { prev && prev.focus && prev.focus(); } catch (e) { /* gone */ } };
    const files = () => app.vault.getFiles().filter((f) => !f.path.split("/").some((s) => /^\.(basalt|obsidian|git|trash)$/.test(s)));
    const cmds = () => { let list; try { list = app.commands.listCommands ? app.commands.listCommands() : Object.values(app.commands.commands); } catch (e) { list = Object.values(app.commands.commands); } return list.filter((c) => c && c.name); };

    function compute() {
      const raw = input.value; let q = raw;
      if (m === "files" && raw.startsWith(">")) { m = "commands"; input.value = q = raw.slice(1); }
      q = q.trim().toLowerCase();
      modeEl.textContent = m === "files" ? "Файлы" : "Команды"; input.placeholder = m === "files" ? "Найти файл…" : "Найти команду…"; f2.style.display = m === "files" ? "" : "none";
      items = [];
      if (m === "files") {
        const all = files();
        if (!q) { const rec = (app.workspace.getLastOpenFiles ? app.workspace.getLastOpenFiles() : []).map((p) => app.vault.getAbstractFileByPath(p)).filter((f) => f && f.extension !== undefined); const seen = new Set(rec.map((f) => f.path)); items = rec.concat(all.filter((f) => !seen.has(f.path)).sort((a, b) => b.stat.mtime - a.stat.mtime)).slice(0, 60).map((f) => ({ f, idx: [], nameIdx: [] })); }
        else { const r = []; for (const f of all) { const n = fuzzy(q, f.name.replace(/\.(md|canvas)$/i, "")), p = n ? null : fuzzy(q, f.path); const hit = n || p; if (hit) r.push({ f, score: hit.score + (n ? 6 : 0), nameIdx: n ? n.idx : [], idx: [] }); } r.sort((a, b) => b.score - a.score); items = r.slice(0, 60); }
      } else {
        const rec = recentCmds(), all = cmds();
        if (!q) items = all.sort((a, b) => { const ra = rec.indexOf(a.id), rb = rec.indexOf(b.id); return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || a.name.localeCompare(b.name); }).slice(0, 80).map((c) => ({ c, idx: [] }));
        else { const r = []; for (const c of all) { const h = fuzzy(q, c.name); if (h) r.push({ c, score: h.score, idx: h.idx }); } r.sort((a, b) => b.score - a.score); items = r.slice(0, 80); }
      }
      sel = Math.min(sel, Math.max(0, items.length - 1));
    }
    function draw() {
      compute(); list.textContent = "";
      if (!items.length) { list.innerHTML = '<div class="bpal-empty">Ничего не найдено</div>'; return; }
      items.forEach((it, i) => {
        const row = document.createElement("div"); row.className = "bpal-i" + (i === sel ? " is-sel" : "");
        if (m === "files") {
          const f = it.f, dir = f.parent && f.parent.path !== "/" ? f.parent.path : "";
          row.innerHTML = '<span class="bpal-ic"></span><span class="bpal-t"></span>' + (f.extension !== "md" && f.extension !== "canvas" ? `<span class="bpal-k">${esc(f.extension)}</span>` : "");
          try { api.setIcon(row.querySelector(".bpal-ic"), iconOf(f)); } catch (e) { /* none */ }
          const base = f.name.replace(/\.(md|canvas)$/i, ""); row.querySelector(".bpal-t").innerHTML = hl(base, it.nameIdx) + (dir ? `<small>${esc(dir)}</small>` : "");
        } else {
          let hk = ""; try { hk = app.hotkeyManager.printHotkeyForCommand(it.c.id) || ""; } catch (e) { /* none */ }
          row.innerHTML = '<span class="bpal-ic"></span><span class="bpal-t"></span>' + (hk ? `<span class="bpal-k">${esc(hk)}</span>` : "");
          try { api.setIcon(row.querySelector(".bpal-ic"), it.c.icon || "lucide-terminal"); } catch (e) { /* none */ }
          row.querySelector(".bpal-t").innerHTML = hl(it.c.name, it.idx);
        }
        row.addEventListener("mousemove", () => { if (sel !== i) { sel = i; list.querySelectorAll(".bpal-i").forEach((x, k) => x.classList.toggle("is-sel", k === i)); } });
        row.addEventListener("click", (e) => run(i, e.ctrlKey || e.metaKey));
        list.appendChild(row);
      });
      const cur = list.children[sel]; cur && cur.scrollIntoView && cur.scrollIntoView({ block: "nearest" });
    }
    function run(i, newTab) {
      const it = items[i]; if (!it) return; close();
      if (m === "files") mainLeaf(newTab).openFile(it.f);
      else { pushCmd(it.c.id); setTimeout(() => app.commands.executeCommandById(it.c.id), 30); }
    }
    input.addEventListener("input", () => { sel = 0; draw(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === "Enter") { e.preventDefault(); run(sel, e.ctrlKey || e.metaKey); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Backspace" && m === "commands" && !input.value && mode === "files") { m = "files"; draw(); }
    });
    wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap) close(); });
    open = { setMode(x) { m = x; sel = 0; input.value = ""; draw(); input.focus(); } };
    document.body.appendChild(wrap); input.focus(); draw();
  }

  const t = setInterval(() => {
    if (!(window.app && app.commands && app.workspace && app.workspace.layoutReady && window.__bsApi)) return;
    clearInterval(t);
    const c = app.commands.commands;
    for (const [id, mode] of [["switcher:open", "files"], ["command-palette:open", "commands"]]) {
      if (c[id]) { delete c[id].checkCallback; c[id].callback = () => show(mode); }
      else app.commands.addCommand({ id, name: mode === "files" ? "Перейти к файлу" : "Открыть палитру команд", callback: () => show(mode) });
    }
    window.__bsPalette = { show };
  }, 600);
})();
