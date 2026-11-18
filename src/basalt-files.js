// Basalt file explorer: our own view of the vault tree (replaces the inherited "file-explorer" view).
// Folders and files, sorting, filter, pinned files on top, rename in place, drag to move, keyboard, context menu, multi-select.
(() => {
  "use strict";
  const lk = (e) => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : String(e.key).toLowerCase()); // the letter of the key, whatever layout (Russian too)

  const TYPE = "basalt-files";
  const css = document.createElement("style");
  css.textContent = `
    .bsf { display: flex; flex-direction: column; height: 100%; outline: none; }
    .bsf-bar { display: flex; gap: 2px; padding: 8px 8px 4px; align-items: center; flex-wrap: wrap; }
    .bsf-bar button { background: transparent; box-shadow: none; padding: 4px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-muted); border-radius: 4px; clip-path: none; }
    .bsf-bar button:hover { background: var(--background-modifier-hover); color: var(--text-normal); } .bsf-bar button.is-on { color: var(--interactive-accent); }
    .bsf-bar svg, .bsf-i svg { width: 16px; height: 16px; flex: none; } .bsf-bar button .svg-icon { width: 16px; height: 16px; }
    .bsf-find { padding: 0 8px 6px; } .bsf-find input { width: 100%; height: 28px; font-size: var(--font-ui-small); }
    .bsf-tree { flex: 1; overflow: auto; padding: 2px 4px 24px; }
    .bsf-r { display: flex; align-items: center; gap: 6px; height: 28px; padding-right: 8px; margin: 1px 0; border-radius: 4px; cursor: pointer; border-left: 2px solid transparent; user-select: none; color: var(--text-muted); }
    .bsf-r:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .bsf-r.is-sel { background: color-mix(in srgb, var(--interactive-accent) 12%, transparent); color: var(--text-normal); }
    .bsf-r.is-active { background: color-mix(in srgb, var(--interactive-accent) 20%, transparent); border-left-color: var(--interactive-accent); color: var(--text-normal); }
    .bsf-r.is-focus { outline: 1px solid color-mix(in srgb, var(--interactive-accent) 55%, transparent); outline-offset: -1px; }
    .bsf-r.is-drop { background: color-mix(in srgb, var(--interactive-accent) 28%, transparent); outline: 1px dashed var(--interactive-accent); }
    .bsf-r.is-dir { color: var(--text-normal); font-weight: 600; }
    .bsf-r { position: relative; }
    .bsf-guide { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--background-modifier-border); pointer-events: none; }
    .bsf-car { width: 14px; height: 14px; flex: none; transition: transform .1s; color: var(--text-faint); } .bsf-r.is-open > .bsf-car { transform: rotate(90deg); }
    .bsf-sp { width: 14px; flex: none; }
    .bsf-i { color: var(--text-faint); display: inline-flex; } .bsf-r.is-dir .bsf-i { color: var(--interactive-accent); }
    .bsf-n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bsf-n small { color: var(--text-faint); font-weight: 400; margin-left: 8px; }
    .bsf-ext { display: inline-flex; align-items: center; justify-content: center; width: 22px; flex: none; height: 14px; padding: 0; margin: 1px -3px 1px -3px; border-radius: 3px; font-size: 8px; font-weight: 700; color: #fff; letter-spacing: .2px; text-transform: uppercase; box-sizing: border-box; line-height: 1; }
    .bsf-x { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-faint); }
    .bsf-pin { width: 12px; height: 12px; color: var(--interactive-accent); flex: none; }
    .bsf-r input.bsf-ren { flex: 1; min-width: 0; height: 22px; padding: 0 4px; }
    .bsf-empty { padding: 18px 12px; color: var(--text-faint); font-size: var(--font-ui-small); }
    .bsf-wsroot { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-normal); font-weight: 600; font-size: var(--font-ui-small); padding: 0 6px; align-self: center; }
  `;
  document.head.appendChild(css);

  const ICON = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    canvas: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    car: '<path d="M9 6l6 6-6 6"/>',
    pin: '<path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
    newNote: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    newDir: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/>',
    newCanvas: '<rect x="3" y="3" width="8" height="8"/><path d="M17 3v8M13 7h8M3 15h18M3 19h18"/>',
    sort: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
    collapse: '<path d="M4 8l4 4-4 4M20 8l-4 4 4 4"/>',
  };
  const svg = (k, cls) => `<svg class="${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
  const IMG = /^(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;
  const kindOf = (f) => (f.children ? "folder" : f.extension === "md" ? "note" : f.extension === "canvas" ? "canvas" : IMG.test(f.extension) ? "image" : "file");
  const HIDDEN = /^\.(basalt|obsidian|git|trash)$/;
  // one coloured badge per file type, the same idea as the icon themes of VS Code
  const FILECOL = { md: "#519aba", mdx: "#519aba", txt: "#8f98a0", json: "#cbcb41", yaml: "#e06c75", yml: "#e06c75", toml: "#c9733a", lock: "#7a7a7a", js: "#d4b800", mjs: "#d4b800", cjs: "#d4b800", jsx: "#2fa8c6", ts: "#3178c6", tsx: "#3178c6", py: "#3572A5", rs: "#c97d4f", go: "#00ADD8", java: "#b07219", kt: "#A97BFF", cs: "#178600", c: "#8a8f94", h: "#8a8f94", cpp: "#f34b7d", hpp: "#f34b7d", swift: "#F05138", rb: "#cc342d", php: "#8892bf", dart: "#00B4AB", lua: "#5a5aff", sh: "#7fbf4d", bat: "#7fbf4d", cmd: "#7fbf4d", ps1: "#4d8fd1", css: "#7a5cc7", scss: "#c6538c", html: "#e34c26", xml: "#e37933", svg: "#ffb13b", png: "#a074c4", jpg: "#a074c4", jpeg: "#a074c4", gif: "#a074c4", webp: "#a074c4", ico: "#a074c4", pdf: "#e44d4d", zip: "#b58900", gz: "#b58900", exe: "#6d8086", dll: "#6d8086", sql: "#e38c00", csv: "#4caf50", log: "#7a7a7a", ini: "#7a7a7a", iml: "#e0705c", gradle: "#5aa9a9", env: "#c9b400", gitignore: "#d9593d", dockerfile: "#2496ed" };
  // the same 16px line icon as everywhere, only tinted by type and softened towards the text colour
  const tint = (f) => { const raw = (f.extension || "").toLowerCase() || (f.name[0] === "." ? f.name.slice(1).toLowerCase() : ""), c = FILECOL[raw]; return c ? `color-mix(in srgb, ${c} 62%, var(--text-muted))` : ""; };
  const badge = (f) => { const raw = (f.extension || "").toLowerCase() || (/^\.?[\w-]+$/.test(f.name) && f.name[0] === "." ? f.name.slice(1).toLowerCase() : ""); const col = FILECOL[raw] || "#7d7d7d"; const label = (raw || "·").slice(0, 3); return `<span class="bsf-ext" style="background:${col}">${label}</span>`; };
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const SORTS = [["name", "по имени"], ["mtime", "по дате изменения"], ["type", "по типу"]];
  const pinsApi = () => window.__bsPinsApi || { has: () => false, toggle: () => {}, onChange: () => {} };
  const keyOf = () => "basalt-files:" + app.vault.getName();

  function makeView(api) {
    return class FilesView extends api.ItemView {
      getViewType() { return TYPE; }
      getDisplayText() { return "Файлы"; }
      getIcon() { return "folder"; }
      async onOpen() {
        let saved = {}; try { saved = JSON.parse(localStorage.getItem(keyOf()) || "{}"); } catch (e) { /* none */ }
        this.open = new Set(saved.open || []); this.sort = saved.sort || "name"; this.filter = ""; this.sel = new Set(); this.focus = null; this.anchor = null;
        const el = this.contentEl; el.empty && el.empty(); el.classList.add("bsf-host");
        el.innerHTML = '<div class="bsf" tabindex="0"><div class="bsf-bar"></div><div class="bsf-find"><input type="text" placeholder="Фильтр по имени…" spellcheck="false"></div><div class="bsf-tree"></div></div>';
        this.root = el.querySelector(".bsf"); this.treeEl = el.querySelector(".bsf-tree"); this.find = el.querySelector("input");
        this.buildBar();
        this.find.addEventListener("input", () => { this.filter = this.find.value.trim().toLowerCase(); if (this.ws()) this.wsSearch(); else this.render(); });
        this.find.addEventListener("keydown", (e) => { if (e.key === "Escape") { this.find.value = ""; this.filter = ""; this.render(); this.root.focus(); } });
        this.root.addEventListener("keydown", (e) => this.onKey(e));
        this.treeEl.addEventListener("contextmenu", (e) => { if (e.target === this.treeEl) { e.preventDefault(); const ws = this.ws(); if (ws && ws.rootNode()) this.wsMenu(ws.rootNode(), e); else this.menuFor(app.vault.getRoot(), e); } });
        this.treeEl.addEventListener("dragover", (e) => { if (e.target === this.treeEl && this.dragging) { e.preventDefault(); } });
        this.treeEl.addEventListener("drop", (e) => { if (e.target === this.treeEl) this.dropOn(app.vault.getRoot(), e); });
        const again = () => { clearTimeout(this.t); this.t = setTimeout(() => this.render(), 120); };
        for (const ev of ["create", "delete", "rename", "modify"]) this.registerEvent(app.vault.on(ev, again));
        this.registerEvent(app.workspace.on("file-open", (f) => { if (f && !(window.__bsMiniFeatures && window.__bsMiniFeatures.cfg.explorer.keepFolders)) { this.reveal(f.path, false); } this.render(); }));
        pinsApi().onChange(again);
        this._wsOff = window.__bsWorkspace ? window.__bsWorkspace.onChange(() => this.render()) : null;
        this.render();
      }
      async onClose() { clearTimeout(this.t); if (this._wsOff) this._wsOff(); }
      save() { try { localStorage.setItem(keyOf(), JSON.stringify({ open: Array.from(this.open), sort: this.sort })); } catch (e) { /* full */ } }

      // ---- toolbar
      ws() { const w = window.__bsWorkspace; return w && w.active() ? w : null; }
      buildBar() {
        const ws = this.ws(), mode = ws ? "ws" + (ws.showIgnored() ? "1" : "0") : "vault";
        if (this._barMode === mode) return;
        this._barMode = mode;
        const bar = this.contentEl.querySelector(".bsf-bar"); bar.textContent = "";
        const btn = (icon, title, fn) => { const b = document.createElement("button"); b.title = title; try { api.setIcon(b, icon); } catch (e) { b.textContent = "•"; } b.addEventListener("click", fn); bar.appendChild(b); return b; };
        const sortBtn = () => btn("lucide-arrow-up-down", "Сортировка", (e) => {
          const m = new api.Menu();
          for (const [k, label] of SORTS) m.addItem((i) => i.setTitle(label[0].toUpperCase() + label.slice(1)).setIcon(this.sort === k ? "lucide-check" : "lucide-blank").onClick(() => { this.sort = k; this.save(); this.render(); }));
          m.showAtMouseEvent(e);
        });
        if (ws) {
          const label = document.createElement("span"); label.className = "bsf-wsroot"; label.textContent = ws.rootName(); label.title = ws.root();
          bar.appendChild(label);
          btn(ws.showIgnored() ? "lucide-eye" : "lucide-eye-off", ws.showIgnored() ? "Скрыть игнорируемые" : "Показывать игнорируемые", () => ws.setShowIgnored(!ws.showIgnored()));
          btn("lucide-rotate-cw", "Обновить", () => ws.refresh());
          btn("lucide-folder-open", "Сменить папку", () => ws.pick());
          btn("lucide-x", "Закрыть папку", () => ws.close());
          sortBtn();
          return;
        }
        // one "new" button with a menu, like before: note, folder, canvas, database
        btn("lucide-plus", "Создать", (e) => {
          const m = new api.Menu();
          m.addItem((i) => i.setTitle("Новая заметка").setIcon("lucide-square-pen").onClick(() => this.create("md")));
          m.addItem((i) => i.setTitle("Новая папка").setIcon("lucide-folder-open").onClick(() => this.createFolder()));
          m.addItem((i) => i.setTitle("Новый холст").setIcon("lucide-layout-dashboard").onClick(() => this.create("canvas")));
          m.addItem((i) => i.setTitle("Создать базу данных").setIcon("lucide-layout-list").onClick(() => this.create("base")));
          m.showAtMouseEvent(e);
        });
        sortBtn();
        btn("lucide-chevrons-down-up", "Свернуть все папки", () => { this.open.clear(); this.save(); this.render(); });
      }

      // ---- model
      children(folder) {
        const wsMode = !!this.ws(), list = (folder.children || []).filter((c) => !(c.children && HIDDEN.test(c.name)) && !(c.name[0] === "." && !c.children && !wsMode));
        const pins = pinsApi();
        const cmp = (a, b) => {
          if (!!a.children !== !!b.children) return a.children ? -1 : 1;
          const pa = !a.children && pins.has(a.path), pb = !b.children && pins.has(b.path);
          if (pa !== pb) return pa ? -1 : 1;
          if (this.sort === "mtime" && a.stat && b.stat) return b.stat.mtime - a.stat.mtime;
          if (this.sort === "type" && !a.children) { const d = collator.compare(a.extension, b.extension); if (d) return d; }
          return collator.compare(a.name, b.name);
        };
        return list.sort(cmp);
      }
      // ---- workspace mode (an opened folder, listed lazily by basalt-workspace.js)
      wsKids(node) {
        const kids = node && node.children;
        if (kids == null) return null;
        if (this.sort === "name") return kids;
        const cmp = (a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          if (this.sort === "mtime") { const am = a.stat ? a.stat.mtime : a.mtime, bm = b.stat ? b.stat.mtime : b.mtime; if (am || bm) return bm - am; }
          if (this.sort === "type" && !a.isDir) { const d = collator.compare(a.extension || "", b.extension || ""); if (d) return d; }
          return collator.compare(a.name, b.name);
        };
        return kids.slice().sort(cmp);
      }
      wsSearch() {
        const ws = this.ws(), q = this.filter;
        this.wsResults = [];
        if (!ws || !q) { this.render(); return; }
        const id = (this._wsq = (this._wsq || 0) + 1);
        ws.search(q).then((r) => { if (id === this._wsq && this.ws()) { this.wsResults = r.map((f) => ({ f, depth: 0, flat: true })); this.render(); } }).catch(() => {});
      }
      wsOpen(f, newTab) { const ws = this.ws(); if (!ws) return; ws.openFile(f, newTab); this.reveal(f.path, false); }
      wsShow(f) { try { window.__bsReveal(f.abs); } catch (e) { /* ok */ } }
      wsMenu(f, e) {
        const menu = new api.Menu();
        if (!f.isDir) {
          menu.addItem((i) => i.setTitle("Открыть").setIcon("lucide-file").onClick(() => this.wsOpen(f, false)));
          menu.addItem((i) => i.setTitle("Открыть в новой вкладке").setIcon("lucide-copy-plus").onClick(() => this.wsOpen(f, true)));
          menu.addSeparator();
        }
        menu.addItem((i) => i.setTitle("Показать в папке").setIcon("lucide-folder-open").onClick(() => this.wsShow(f)));
        menu.addItem((i) => i.setTitle("Копировать путь").setIcon("lucide-copy").onClick(() => { navigator.clipboard.writeText(f.abs).then(() => new api.Notice("Путь скопирован")); }));
        menu.showAtMouseEvent(e);
      }

      rows() {
        const ws = this.ws();
        if (ws) {
          const out = [];
          if (this.filter) return this.wsResults || [];
          const walk = (node, depth) => {
            const kids = this.wsKids(node);
            if (!kids) { ws.ensure(node); return; }
            for (const c of kids) { out.push({ f: c, depth }); if (c.isDir && this.open.has(c.path)) walk(c, depth + 1); }
          };
          if (ws.rootNode()) walk(ws.rootNode(), 0);
          return out;
        }
        const out = [];
        if (this.filter) {
          const hit = app.vault.getAllLoadedFiles().filter((f) => f.path !== "/" && !f.path.split("/").some((s) => HIDDEN.test(s)) && f.name.toLowerCase().includes(this.filter));
          hit.sort((a, b) => collator.compare(a.name, b.name)).slice(0, 400).forEach((f) => out.push({ f, depth: 0, flat: true }));
          return out;
        }
        const walk = (folder, depth) => { for (const c of this.children(folder)) { out.push({ f: c, depth }); if (c.children && this.open.has(c.path)) walk(c, depth + 1); } };
        walk(app.vault.getRoot(), 0);
        return out;
      }
      reveal(path, scroll = true) {
        const ws = this.ws();
        if (ws) {
          const parts = path.split("/"); parts.pop(); let p = "";
          for (const s of parts) { p = p ? p + "/" + s : s; const n = ws.nodeAt(p); if (n && n.isDir) this.open.add(p); }
          if (scroll) { this.save(); this.render(); const el = this.treeEl.querySelector(`[data-path="${CSS.escape(path)}"]`); el && el.scrollIntoView({ block: "center" }); }
          return;
        }
        const parts = path.split("/"); parts.pop(); let p = "";
        for (const s of parts) { p = p ? p + "/" + s : s; this.open.add(p); }
        if (scroll) { this.save(); this.render(); const el = this.treeEl.querySelector(`[data-path="${CSS.escape(path)}"]`); el && el.scrollIntoView({ block: "center" }); }
      }

      // ---- drawing
      render() {
        if (!this.treeEl || this.renaming) return;
        this.buildBar();
        const scroll = this.treeEl.scrollTop, ws = this.ws(), act = ws ? null : app.workspace.getActiveFile(), pins = pinsApi();
        this.rowList = this.rows();
        const frag = document.createDocumentFragment();
        for (const { f, depth, flat } of this.rowList) {
          const dir = ws ? !!f.isDir : !!f.children, r = document.createElement("div");
          const active = ws ? f.path === ws.activePath() : act && act.path === f.path;
          r.className = "bsf-r" + (dir ? " is-dir" : "") + (dir && this.open.has(f.path) ? " is-open" : "") + (active ? " is-active" : "") + (this.sel.has(f.path) ? " is-sel" : "") + (this.focus === f.path ? " is-focus" : "");
          r.dataset.path = f.path; r.draggable = !ws; r.style.paddingLeft = 6 + depth * 14 + "px";
          const extName = ws ? f.extension || "" : f.extension !== "md" && f.extension !== "canvas" ? f.extension : "";
          const ext = "";
          r.innerHTML = (dir ? svg("car", "bsf-car") : '<span class="bsf-sp"></span>') + `<span class="bsf-i">${svg(dir ? "folder" : kindOf(f))}</span><span class="bsf-n"></span>${!dir && pins.has(f.path) ? svg("pin", "bsf-pin") : ""}${ext}`;
          if (!dir) { const t = tint(f); if (t) r.querySelector(".bsf-i").style.color = t; }
          for (let d = 1; d <= depth; d++) { const gl = document.createElement("i"); gl.className = "bsf-guide"; gl.style.left = 6 + (d - 1) * 14 + 7 + "px"; r.appendChild(gl); }
          const n = r.querySelector(".bsf-n"); n.textContent = f.name;
          if (flat && f.parent && f.parent.path && f.parent.path !== "/") { const s = document.createElement("small"); s.textContent = f.parent.path; n.appendChild(s); }
          this.wire(r, f);
          frag.appendChild(r);
        }
        this.treeEl.textContent = ""; this.treeEl.appendChild(frag);
        if (!this.rowList.length) this.treeEl.innerHTML = `<div class="bsf-empty">${this.filter ? "Ничего не найдено" : ws ? "Папка пуста" : "В хранилище пока нет файлов. Нажмите «Новая заметка» выше."}</div>`;
        this.treeEl.scrollTop = scroll;
      }
      wire(r, f) {
        const ws = this.ws(), isDir = ws ? !!f.isDir : !!f.children;
        r.addEventListener("click", (e) => {
          this.focus = f.path;
          if (e.shiftKey && this.anchor) { const paths = this.rowList.map((x) => x.f.path), a = paths.indexOf(this.anchor), b = paths.indexOf(f.path); this.sel = new Set(paths.slice(Math.min(a, b), Math.max(a, b) + 1)); this.render(); return; }
          if (e.ctrlKey || e.metaKey) { this.sel.has(f.path) ? this.sel.delete(f.path) : this.sel.add(f.path); this.anchor = f.path; this.render(); return; }
          this.sel = new Set([f.path]); this.anchor = f.path;
          if (isDir) { this.open.has(f.path) ? this.open.delete(f.path) : this.open.add(f.path); this.save(); this.render(); } else if (ws) { this.wsOpen(f, false); this.render(); } else { this.openFile(f, false); this.render(); }
        });
        r.addEventListener("auxclick", (e) => { if (e.button === 1 && !isDir) { e.preventDefault(); ws ? this.wsOpen(f, true) : this.openFile(f, true); } });
        r.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!this.sel.has(f.path)) { this.sel = new Set([f.path]); this.render(); } ws ? this.wsMenu(f, e) : this.menuFor(f, e); });
        r.addEventListener("dragstart", (e) => {
          if (ws) return;
          const paths = this.sel.has(f.path) ? Array.from(this.sel) : [f.path]; this.dragging = paths; e.dataTransfer.effectAllowed = "copyMove";
          try { const files = paths.map((p) => app.vault.getAbstractFileByPath(p)).filter((x) => x && !x.children); const d = files.length > 1 ? app.dragManager.dragFiles(e, files) : f.children ? app.dragManager.dragFolder(e, f) : app.dragManager.dragFile(e, f); app.dragManager.onDragStart(e, d); } catch (err) { /* drop into notes unavailable */ }
        });
        r.addEventListener("dragend", () => { this.dragging = null; this.treeEl.querySelectorAll(".is-drop").forEach((x) => x.classList.remove("is-drop")); });
        if (isDir && !ws) {
          r.addEventListener("dragover", (e) => { if (this.dragging && !this.dragging.some((p) => p === f.path || f.path.startsWith(p + "/"))) { e.preventDefault(); r.classList.add("is-drop"); } });
          r.addEventListener("dragleave", () => r.classList.remove("is-drop"));
          r.addEventListener("drop", (e) => { r.classList.remove("is-drop"); this.dropOn(f, e); });
        }
      }

      // ---- actions
      openFile(f, newTab) { if (f.extension === undefined) return; const ws = app.workspace; let leaf = newTab ? null : ws.getMostRecentLeaf(ws.rootSplit); if (!leaf || leaf.getRoot() !== ws.rootSplit) leaf = ws.getLeaf("tab"); leaf.openFile(f).then(() => ws.setActiveLeaf(leaf, { focus: true })).catch((e) => console.error("[files] open", e)); }
      async dropOn(folder, e) {
        if (this.ws()) return;
        const paths = this.dragging; this.dragging = null; if (!paths) return; e.preventDefault(); e.stopPropagation();
        for (const p of paths) {
          const f = app.vault.getAbstractFileByPath(p); if (!f || (f.parent && f.parent.path === folder.path)) continue;
          const dest = (folder.path === "/" ? "" : folder.path + "/") + f.name;
          if (app.vault.getAbstractFileByPath(dest)) { new api.Notice(`«${f.name}» уже есть в «${folder.name || "корне"}»`); continue; }
          try { await app.fileManager.renameFile(f, dest); } catch (err) { new api.Notice("Не удалось переместить: " + err.message); }
        }
        if (folder.path !== "/") { this.open.add(folder.path); this.save(); }
        this.render();
      }
      targetFolder() { const p = this.focus && app.vault.getAbstractFileByPath(this.focus); return p ? (p.children ? p : p.parent) : app.vault.getRoot(); }
      async create(ext) {
        if (this.ws()) return;
        const folder = this.targetFolder() || app.vault.getRoot();
        const base = ext === "md" ? "Без названия" : "Без названия", join = (n) => (folder.path === "/" ? "" : folder.path + "/") + n;
        let n = base, i = 1; while (app.vault.getAbstractFileByPath(join(`${n}.${ext}`))) n = `${base} ${++i}`;
        const f = await app.vault.create(join(`${n}.${ext}`), ext === "canvas" ? '{"nodes":[],"edges":[]}' : ext === "base" ? "views:\n  - type: table\n    name: Table\n" : "");
        if (folder.path !== "/") { this.open.add(folder.path); this.save(); }
        this.focus = f.path; this.sel = new Set([f.path]); this.render(); this.openFile(f, false); setTimeout(() => this.rename(f), 150);
      }
      async createFolder() {
        if (this.ws()) return;
        const folder = this.targetFolder() || app.vault.getRoot(), join = (n) => (folder.path === "/" ? "" : folder.path + "/") + n;
        let n = "Новая папка", i = 1; while (app.vault.getAbstractFileByPath(join(n))) n = `Новая папка ${++i}`;
        await app.vault.createFolder(join(n)); const f = app.vault.getAbstractFileByPath(join(n));
        if (folder.path !== "/") this.open.add(folder.path); this.save(); this.focus = f.path; this.render(); setTimeout(() => this.rename(f), 200);
      }
      rename(f) {
        if (this.ws()) return;
        const row = this.treeEl.querySelector(`[data-path="${CSS.escape(f.path)}"]`); if (!row) return;
        const n = row.querySelector(".bsf-n"), input = document.createElement("input"); input.className = "bsf-ren"; input.type = "text";
        const stem = f.children ? f.name : f.name.replace(/\.[^.]+$/, ""), ext = f.children ? "" : f.name.slice(stem.length);
        input.value = stem; n.replaceWith(input); input.focus(); input.select(); this.renaming = true;
        let done = false;
        const finish = async (ok) => {
          if (done) return; done = true; this.renaming = false;
          const v = input.value.trim().replace(/[\\/:*?"<>|]/g, "");
          if (ok && v && v + ext !== f.name) { const dest = (f.parent && f.parent.path !== "/" ? f.parent.path + "/" : "") + v + ext; if (app.vault.getAbstractFileByPath(dest)) new api.Notice("Такое имя уже занято"); else { try { await app.fileManager.renameFile(f, dest); } catch (err) { new api.Notice("Не удалось переименовать: " + err.message); } } }
          this.render(); this.root.focus();
        };
        input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); });
        input.addEventListener("blur", () => finish(true)); input.addEventListener("click", (e) => e.stopPropagation()); input.addEventListener("dblclick", (e) => e.stopPropagation());
      }
      async remove(files) {
        if (this.ws()) return;
        const names = files.map((f) => f.name).slice(0, 4).join(", ") + (files.length > 4 ? "…" : "");
        if (!(await window.__bsConfirm(`Удалить в корзину: ${names}?`, { title: "Удаление", ok: "Удалить", danger: true }))) return;
        for (const f of files) { try { await app.fileManager.trashFile(f); } catch (err) { new api.Notice("Не удалось удалить: " + err.message); } }
        this.sel.clear(); this.render();
      }
      menuFor(f, e) {
        const menu = new api.Menu(), many = this.sel.size > 1, list = () => Array.from(this.sel).map((p) => app.vault.getAbstractFileByPath(p)).filter(Boolean);
        if (!f.children && !many) { menu.addItem((i) => i.setTitle("Открыть").setIcon("lucide-file").onClick(() => this.openFile(f, false))); menu.addItem((i) => i.setTitle("Открыть в новой вкладке").setIcon("lucide-copy-plus").onClick(() => this.openFile(f, true))); menu.addSeparator(); }
        if (f.children) { const t = f.path === "/" ? app.vault.getRoot() : f; menu.addItem((i) => i.setTitle("Новая заметка здесь").setIcon("lucide-file-plus").onClick(() => { this.focus = t.path === "/" ? null : t.path; this.create("md"); })); menu.addItem((i) => i.setTitle("Новая папка здесь").setIcon("lucide-folder-plus").onClick(() => { this.focus = t.path === "/" ? null : t.path; this.createFolder(); })); menu.addItem((i) => i.setTitle("Новый холст здесь").setIcon("lucide-layout-dashboard").onClick(() => { this.focus = t.path === "/" ? null : t.path; this.create("canvas"); })); menu.addItem((i) => i.setTitle("Создать базу данных здесь").setIcon("lucide-layout-list").onClick(() => { this.focus = t.path === "/" ? null : t.path; this.create("base"); })); menu.addSeparator(); }
        if (!f.children && !many && window.__vaultSyncHistory) { menu.addItem((i) => i.setTitle("История версий").setIcon("lucide-history").onClick(() => window.__vaultSyncHistory(f.path))); }
        if (!f.children && !many) menu.addItem((i) => i.setTitle("Дублировать").setIcon("lucide-copy").onClick(async () => { const dot = f.name.lastIndexOf("."), stem = f.name.slice(0, dot), ext = f.name.slice(dot), dir = f.parent && f.parent.path !== "/" ? f.parent.path + "/" : ""; let n = `${stem} копия`, i = 1; while (app.vault.getAbstractFileByPath(dir + n + ext)) n = `${stem} копия ${++i}`; try { await app.vault.copy(f, dir + n + ext); } catch (err) { new api.Notice("Не удалось скопировать: " + err.message); } }));
        if (f.path !== "/" && !many) menu.addItem((i) => i.setTitle("Переименовать").setIcon("lucide-pencil").onClick(() => this.rename(f)));
        try { app.workspace.trigger("file-menu", menu, f, "file-explorer"); } catch (err) { /* plugins */ }
        if (f.path !== "/") { menu.addSeparator(); menu.addItem((i) => { i.setTitle(many ? `Удалить (${this.sel.size})` : "Удалить").setIcon("lucide-trash-2"); if (i.setWarning) i.setWarning(true); i.onClick(() => this.remove(many ? list() : [f])); }); }
        menu.showAtMouseEvent(e);
      }
      wsKey(e) {
        const paths = this.rowList.map((x) => x.f.path), i = paths.indexOf(this.focus);
        const hit = this.focus ? this.rowList.find((x) => x.f.path === this.focus) : null, cur = hit ? hit.f : null;
        const go = (k) => { const j = Math.max(0, Math.min(paths.length - 1, k)); this.focus = paths[j]; if (!e.shiftKey) this.sel = new Set([this.focus]); this.render(); const el = this.treeEl.querySelector(`[data-path="${CSS.escape(this.focus)}"]`); el && el.scrollIntoView({ block: "nearest" }); };
        if (e.key === "ArrowDown") { e.preventDefault(); go(i + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); go(i < 0 ? 0 : i - 1); }
        else if (e.key === "ArrowRight" && cur && cur.isDir) { e.preventDefault(); this.open.add(cur.path); this.save(); this.render(); }
        else if (e.key === "ArrowLeft" && cur) { e.preventDefault(); if (cur.isDir && this.open.has(cur.path)) { this.open.delete(cur.path); this.save(); this.render(); } else if (cur.parent && cur.parent.path) { this.focus = cur.parent.path; this.sel = new Set([this.focus]); this.render(); } }
        else if (e.key === "Enter" && cur) { e.preventDefault(); if (cur.isDir) { this.open.has(cur.path) ? this.open.delete(cur.path) : this.open.add(cur.path); this.save(); this.render(); } else this.wsOpen(cur, e.ctrlKey || e.metaKey); }
        else if ((e.ctrlKey || e.metaKey) && lk(e) === "f") { e.preventDefault(); this.find.focus(); this.find.select(); }
      }
      onKey(e) {
        if (e.target.tagName === "INPUT") return;
        if (this.ws()) { this.wsKey(e); return; }
        const paths = this.rowList.map((x) => x.f.path), i = paths.indexOf(this.focus), cur = this.focus && app.vault.getAbstractFileByPath(this.focus);
        const go = (k) => { const j = Math.max(0, Math.min(paths.length - 1, k)); this.focus = paths[j]; if (!e.shiftKey) this.sel = new Set([this.focus]); this.render(); const el = this.treeEl.querySelector(`[data-path="${CSS.escape(this.focus)}"]`); el && el.scrollIntoView({ block: "nearest" }); };
        if (e.key === "ArrowDown") { e.preventDefault(); go(i + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); go(i < 0 ? 0 : i - 1); }
        else if (e.key === "ArrowRight" && cur && cur.children) { e.preventDefault(); this.open.add(cur.path); this.save(); this.render(); }
        else if (e.key === "ArrowLeft" && cur) { e.preventDefault(); if (cur.children && this.open.has(cur.path)) { this.open.delete(cur.path); this.save(); this.render(); } else if (cur.parent && cur.parent.path !== "/") { this.focus = cur.parent.path; this.sel = new Set([this.focus]); this.render(); } }
        else if (e.key === "Enter" && cur) { e.preventDefault(); if (cur.children) { this.open.has(cur.path) ? this.open.delete(cur.path) : this.open.add(cur.path); this.save(); this.render(); } else this.openFile(cur, e.ctrlKey || e.metaKey); }
        else if (e.key === "F2" && cur) { e.preventDefault(); this.rename(cur); }
        else if (e.key === "Delete" && cur) { e.preventDefault(); this.remove(this.sel.size ? Array.from(this.sel).map((p) => app.vault.getAbstractFileByPath(p)).filter(Boolean) : [cur]); }
        else if ((e.ctrlKey || e.metaKey) && lk(e) === "f") { e.preventDefault(); this.find.focus(); this.find.select(); }
      }
    };
  }

  // ---- registration, and the swap of the inherited explorer leaves
  let registered = false;
  const setup = () => {
    if (!window.app || !app.workspace || !app.viewRegistry || !window.__bsApi || !app.vault) return false;
    if (!registered) {
      registered = true;
      const View = makeView(window.__bsApi), creator = (leaf) => new View(leaf);
      try { app.viewRegistry.registerView(TYPE, creator); } catch (e) { app.viewRegistry.viewByType[TYPE] = creator; }
      const reveal = async () => { let leaf = app.workspace.getLeavesOfType(TYPE)[0]; if (!leaf) { leaf = app.workspace.getLeftLeaf(false); await leaf.setViewState({ type: TYPE, active: true }); } app.workspace.revealLeaf(leaf); return leaf; };
      // the explorer commands and the ribbon now open this view
      const cmds = app.commands.commands;
      if (cmds["file-explorer:open"]) cmds["file-explorer:open"].callback = reveal;
      if (cmds["file-explorer:reveal-active-file"]) cmds["file-explorer:reveal-active-file"].checkCallback = (c) => { const f = app.workspace.getActiveFile(); if (!f) return false; if (!c) reveal().then((l) => l.view.reveal && l.view.reveal(f.path)); return true; };
      for (const id of ["file-explorer:new-file", "file-explorer:new-folder"]) { /* kept: they create through the vault, not through the view */ }
      try {
        const plug = app.internalPlugins.getEnabledPluginById("file-explorer");
        if (plug) plug.revealInFolder = (f) => { if (f) reveal().then((l) => l.view.reveal && l.view.reveal(f.path)).catch((e) => console.error("[basalt-files] reveal", e)); };
      } catch (e) { /* plugin missing */ }
      window.__bsFiles = { reveal };
    }
    return true;
  };
  const swap = async () => {
    if (!setup()) return;
    // views that no longer exist leave empty "ghost" tabs in the side panels; and one explorer is enough
    for (const dead of ["basalt-2hop"]) for (const leaf of app.workspace.getLeavesOfType(dead)) { try { leaf.detach(); } catch (e) { /* gone */ } }
    for (const leaf of app.workspace.getLeavesOfType("empty")) { try { const root = leaf.getRoot(); if (root === app.workspace.leftSplit || root === app.workspace.rightSplit) leaf.detach(); } catch (e) { /* gone */ } }
    app.workspace.getLeavesOfType(TYPE).slice(1).forEach((l) => { try { l.detach(); } catch (e) { /* gone */ } });
    for (const leaf of app.workspace.getLeavesOfType("file-explorer")) { try { await leaf.setViewState({ type: TYPE, active: false }); } catch (e) { console.error("[basalt-files]", e); } }
  };
  // the files tab is always the first one in its panel (and the one that is open after a start)
  let ordered = false;
  const firstTab = () => {
    const leaf = app.workspace.getLeavesOfType(TYPE)[0]; if (!leaf || !leaf.parent || !leaf.parent.children) return;
    const g = leaf.parent, i = g.children.indexOf(leaf);
    if (i > 0) {
      g.children.splice(i, 1); g.children.unshift(leaf);
      const inner = g.tabHeaderContainerEl && g.tabHeaderContainerEl.querySelector(".workspace-tab-header-container-inner");
      if (inner && leaf.tabHeaderEl) inner.prepend(leaf.tabHeaderEl);
      try { g.recomputeChildrenDimensions && g.recomputeChildrenDimensions(); } catch (e) { /* ok */ }
    }
    if (!ordered) { ordered = true; try { g.selectTab(leaf); } catch (e) { /* ok */ } }
    try { app.workspace.requestSaveLayout && app.workspace.requestSaveLayout(); } catch (e) { /* ok */ }
  };
  const t = setInterval(() => { try { if (window.app && app.workspace && app.workspace.layoutReady && app.commands && window.__bsApi) { clearInterval(t); setup(); swap().then(firstTab); app.workspace.on("layout-change", () => swap().then(firstTab)); } } catch (e) { console.error("[basalt-files]", e); } }, 600);
})();
