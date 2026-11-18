// Basalt "Поиск по файлам" (Ctrl+Shift+F): text / regex search through every text file of the open folder (or the vault),
// results grouped by file, a click opens the file on that line.
(() => {
  "use strict";
  const fs = window.require("fs"), path = window.require("path");
  const SKIP = new Set(["node_modules", "target", "dist", "build", "out", "__pycache__", "venv", ".venv", "vendor", "coverage", "bin", "obj", "Pods"]);
  const BIN = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "7z", "rar", "exe", "dll", "so", "dylib", "wasm", "mp3", "mp4", "mov", "avi", "woff", "woff2", "ttf", "otf", "class", "jar", "pyc", "lock", "bin", "dat", "db", "sqlite"]);
  const MAX_FILE = 1.5 * 1024 * 1024, MAX_HITS = 2000, PER_FILE = 60;
  const css = document.createElement("style");
  css.textContent = `
    .bsf-ov { position: fixed; inset: 0; z-index: 70; background: rgba(0,0,0,.35); display: flex; justify-content: center; align-items: flex-start; padding-top: 8vh; }
    .bsf-box { --background-primary: var(--vs-bg); --background-secondary: var(--vs-widget); --text-normal: var(--vs-fg); --text-muted: var(--vs-ln); --text-faint: var(--vs-ln); --background-modifier-border: var(--vs-border); --background-modifier-hover: rgba(128,128,128,.18); --font-monospace: Consolas, 'Cascadia Code', monospace; font-family: var(--font-interface); width: min(860px, 94vw); max-height: 80vh; display: flex; flex-direction: column; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip); box-shadow: none; overflow: hidden; background: var(--vs-widget); color: var(--vs-fg); }
    .bsf-head { display: flex; align-items: center; gap: 6px; padding: 10px 12px 6px; flex-wrap: wrap; }
    .bsf-in { flex: 1; min-width: 200px; height: 30px; padding: 0 10px; border-radius: var(--bs-r, 4px); border: 1px solid transparent; outline-offset: -1px; background: var(--vs-input); color: var(--text-normal); font-size: var(--font-ui-medium); }
    .bsf-in.mask { flex: none; width: 170px; min-width: 120px; font-size: var(--font-ui-small); }
    .bsf-in.bad { border-color: var(--text-error); }
    .bsf-tog { height: 28px; min-width: 30px; padding: 0 8px; border-radius: var(--bs-r, 4px); border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); cursor: pointer; box-shadow: none; font-size: var(--font-ui-small); }
    .bsf-tog:hover { background: var(--background-modifier-hover); color: var(--text-normal); } .bsf-tog.on { background: var(--interactive-accent); color: var(--text-on-accent); border-color: transparent; }
    .bsf-info { padding: 0 14px 8px; font-size: var(--font-ui-smaller); color: var(--text-faint); }
    .bsf-list { overflow: auto; padding: 0 6px 8px; border-top: 1px solid var(--background-modifier-border); }
    .bsf-in:focus { outline: 1px solid var(--interactive-accent); }
    .bsf-file { display: flex; align-items: baseline; gap: 8px; padding: 6px 8px 2px; font-size: var(--font-ui-small); color: var(--text-normal); font-weight: 600; position: sticky; top: 0; background: var(--background-primary); }
    .bsf-file small { color: var(--text-faint); font-weight: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bsf-file i { margin-left: auto; font-style: normal; color: var(--text-faint); font-weight: normal; }
    .bsf-hit { display: flex; gap: 10px; padding: 2px 8px 2px 14px; border-radius: var(--bs-r, 4px); cursor: pointer; font-family: var(--font-monospace); font-size: 12.5px; color: var(--text-muted); white-space: pre; overflow: hidden; }
    .bsf-hit:hover, .bsf-hit.sel { background: var(--background-modifier-hover); color: var(--text-normal); }
    .bsf-hit b { color: var(--text-faint); font-weight: normal; min-width: 38px; text-align: right; flex: none; }
    .bsf-hit mark { background: rgba(255,170,0,.35); color: inherit; border-radius: var(--bs-r, 4px); padding: 0; }
    .bsf-hit input { flex: none; margin: 0 2px 0 0; accent-color: var(--interactive-accent); }
    .bsf-rep { display: none; padding-top: 0; } .bsf-rep.open { display: flex; }
    .bsf-empty { padding: 24px; color: var(--text-muted); text-align: center; }
  `;
  document.head.appendChild(css);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const root = () => { const W = window.__bsWorkspace; return W && W.active && W.active() && W.root() ? W.root() : app.vault.adapter.basePath; };
  async function* walk(dir) {
    let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name[0] === "." || SKIP.has(e.name)) continue; yield* walk(p); } else yield p; }
  }
  const globRe = (m) => { m = m.trim(); if (!m) return null; const parts = m.split(/[\s,;]+/).filter(Boolean).map((g) => "(?:^|/)" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, ".") + "$"); try { return new RegExp(parts.join("|"), "i"); } catch (e) { return null; } };

  function openAt(abs, line) {
    const W = window.__bsWorkspace, base = app.vault.adapter.basePath, T = window.__bsTextFile;
    if (W && W.active && W.active() && W.root() && abs.toLowerCase().startsWith(W.root().toLowerCase())) { if (T) T.openAbs(abs, line); return; }
    const rel = path.relative(base, abs).replace(/\\/g, "/"), f = app.vault.getAbstractFileByPath(rel);
    if (f && f.extension === "md") { app.workspace.getLeaf("tab").openFile(f, { eState: { line: line - 1 } }); return; }
    if (T) T.open(rel, line);
  }

  let box = null;
  function close() { if (box) { box.run = (box.run || 0) + 1; box.ov.remove(); document.removeEventListener("keydown", box.onKey, true); box = null; } }
  function openFind(prefill) {
    if (box) { box.q.focus(); box.q.select(); if (prefill) { box.q.value = prefill; box.start(); } return; }
    const ov = el("div", "bsf-ov"), b = el("div", "bsf-box"); ov.appendChild(b);
    const head = el("div", "bsf-head"), q = el("input", "bsf-in"), mask = el("input", "bsf-in mask"); q.placeholder = "Найти во всех файлах…"; mask.placeholder = "Маска: *.py, src/*"; mask.title = "Только файлы по маске (через запятую)";
    const opt = { c: false, r: false, w: false };
    const tog = (t, ti, k) => { const x = el("button", "bsf-tog", t); x.title = ti; x.addEventListener("click", () => { opt[k] = !opt[k]; x.classList.toggle("on", opt[k]); start(); }); return x; };
    const x = el("button", "bsf-tog", "✕"); x.title = "Закрыть (Esc)"; x.addEventListener("click", close);
    const rt0 = el("button", "bsf-tog", "↔"); rt0.title = "Заменить во всех найденных"; rt0.addEventListener("click", () => { rrow.classList.toggle("open"); rt0.classList.toggle("on", rrow.classList.contains("open")); if (rrow.classList.contains("open")) repIn.focus(); });
    head.append(q, tog("Аа", "Учитывать регистр", "c"), tog(".*", "Регулярное выражение", "r"), tog("«слово»", "Слово целиком", "w"), rt0, mask, x);
    const rrow = el("div", "bsf-head bsf-rep"), repIn = el("input", "bsf-in"), repBtn = el("button", "bsf-tog", "Заменить отмеченные"); repIn.placeholder = "Заменить на…"; repBtn.title = "Записать замену в файлы (спросит подтверждение)"; rrow.append(repIn, repBtn);
    let hitsList = [], lastRe = null;
    const info = el("div", "bsf-info", "Введите текст. Ищу в " + path.basename(root()) + " (без node_modules, target, dist и бинарных файлов)"), list = el("div", "bsf-list");
    b.append(head, rrow, info, list); document.body.appendChild(ov);
    let timer = 0; box = { ov, q, run: 0 };
    const start = () => { clearTimeout(timer); timer = setTimeout(search, 220); }; box.start = start;
    async function search() {
      const my = ++box.run, s = q.value; list.textContent = ""; hitsList = []; if (!s) { info.textContent = "Введите текст"; return; }
      let src = opt.r ? s : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); if (opt.w) src = "\\b(?:" + src + ")\\b";
      let re; try { re = new RegExp(src, "g" + (opt.c ? "" : "i")); lastRe = re; q.classList.remove("bad"); } catch (e) { q.classList.add("bad"); info.textContent = "Ошибка в выражении"; return; }
      const gl = globRe(mask.value), rt = root(); let files = 0, hits = 0, matched = 0, shown = 0; info.textContent = "Ищу…";
      for await (const p of walk(rt)) {
        if (my !== box.run) return;
        const ext = p.split(".").pop().toLowerCase(); if (BIN.has(ext)) continue; const rel = path.relative(rt, p).replace(/\\/g, "/"); if (gl && !gl.test(rel)) continue;
        let st; try { st = await fs.promises.stat(p); } catch (e) { continue; } if (st.size > MAX_FILE) continue; files++;
        let text; try { text = await fs.promises.readFile(p, "utf8"); } catch (e) { continue; } if (text.slice(0, 4000).includes("\u0000")) continue;
        const lines = text.split("\n"), found = [];
        for (let i = 0; i < lines.length && found.length < PER_FILE; i++) { re.lastIndex = 0; const m = re.exec(lines[i]); if (m) { found.push({ i, m }); } }
        if (found.length) {
          matched++; hits += found.length; const fh = el("div", "bsf-file"); fh.append(el("span", null, path.basename(p)), el("small", null, path.dirname(rel) === "." ? "" : path.dirname(rel)), el("i", null, String(found.length))); list.appendChild(fh);
          for (const { i, m } of found) { const ln = lines[i].replace(/\r$/, ""), a = Math.max(0, m.index - 40); const row = el("div", "bsf-hit"); const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true; cb.addEventListener("click", (ev) => ev.stopPropagation()); row.appendChild(cb); hitsList.push({ p, i, cb }); row.appendChild(el("b", null, String(i + 1)));
            const sp = el("span"); sp.append(document.createTextNode((a ? "…" : "") + ln.slice(a, m.index)), (() => { const mk = el("mark", null, m[0]); return mk; })(), document.createTextNode(ln.slice(m.index + m[0].length, m.index + m[0].length + 160))); row.appendChild(sp);
            row.addEventListener("click", () => { close(); openAt(p, i + 1); }); list.appendChild(row); shown++; }
        }
        if (files % 40 === 0) { info.textContent = "Ищу… файлов: " + files + ", совпадений: " + hits; await new Promise((r) => setTimeout(r, 0)); }
        if (hits >= MAX_HITS) { info.textContent = "Показаны первые " + hits + " совпадений в " + matched + " файлах — уточните запрос"; return; }
      }
      if (my !== box.run) return;
      info.textContent = hits ? "Совпадений: " + hits + " в файлах: " + matched + " (просмотрено файлов: " + files + ")" : "Ничего не найдено (просмотрено файлов: " + files + ")";
      if (!hits) list.appendChild(el("div", "bsf-empty", "Ничего не найдено"));
    }
    async function applyReplace() {
      const rep = repIn.value, sel = hitsList.filter((h) => h.cb.checked); if (!sel.length || !lastRe) return;
      const byFile = new Map(); for (const h of sel) { let a = byFile.get(h.p); if (!a) byFile.set(h.p, a = []); a.push(h.i); }
      if (!confirm("Заменить на «" + rep + "» в " + sel.length + " строках, файлов: " + byFile.size + "?\n\nИзменения сразу записываются в файлы.")) return;
      let done = 0;
      for (const [p, idxs] of byFile) {
        try {
          const lines = (await fs.promises.readFile(p, "utf8")).split("\n"), rx = new RegExp(lastRe.source, lastRe.flags);
          for (const i of idxs) { const cr = lines[i].endsWith("\r"), ln = cr ? lines[i].slice(0, -1) : lines[i]; lines[i] = (opt.r ? ln.replace(rx, rep) : ln.replace(rx, () => rep)) + (cr ? "\r" : ""); done++; }
          await fs.promises.writeFile(p, lines.join("\n"), "utf8");
          for (const l of app.workspace.getLeavesOfType("basalt-textfile")) { const v = l.view; if (!v || !v.reload) continue; const abs = /^[A-Za-z]:[\\/]|^\//.test(v.path) ? v.path : path.join(app.vault.adapter.basePath, v.path); if (path.resolve(abs).toLowerCase() === path.resolve(p).toLowerCase()) v.reload(); }
        } catch (e) { console.error("[basalt-find]", e); }
      }
      info.textContent = "Заменено строк: " + done; search();
    }
    repBtn.addEventListener("click", applyReplace);
    q.addEventListener("input", start); mask.addEventListener("input", start);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(timer); search(); const f = list.querySelector(".bsf-hit"); if (e.shiftKey === false && f && !timer) { /* results appear as they stream */ } } });
    box.onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener("keydown", box.onKey, true);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
    if (prefill) q.value = prefill; q.focus(); q.select(); if (prefill) start();
  }

  const t = setInterval(() => {
    if (!window.app || !app.commands || !app.commands.addCommand || !app.vault || !app.vault.adapter) return;
    clearInterval(t);
    app.commands.addCommand({ id: "basalt:find-in-files", name: "Поиск по файлам", icon: "lucide-search", hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "F" }], callback: () => { const l = app.workspace.activeLeaf, v = l && l.view; const sel = v && v.cm && v.cm.getSelection && v.cm.getSelection(); openFind(sel && !sel.includes("\n") ? sel : ""); } });
    window.__bsFind = { open: openFind, openAt };
  }, 500);
})();
