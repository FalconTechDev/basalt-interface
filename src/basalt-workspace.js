// Basalt workspace: opens any folder as-is, without turning it into a vault.
// The file explorer lists it lazily, one directory at a time; ignored directories
// (.git, node_modules, build output, .gitignore rules) are never listed or watched
// unless "показывать игнорируемые" is on. The only thing ever written into the folder
// is a hidden .basalt/ directory, and its name goes to .git/info/exclude so
// `git status` in the folder stays clean.
(() => {
  "use strict";
  const fs = window.require("fs"), path = window.require("path");
  const el = window.electron || window.require("electron");
  const api = () => window.__bsApi;

  const VIEW = "basalt-workspace-file";
  const IMG = /^(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;
  const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif", ico: "image/x-icon" };
  // directories that are never listed (unless the "show ignored" toggle is on)
  const ALWAYS = new Set([".git", "node_modules", "target", "dist", "build", ".venv", ".basalt"]);
  const MAX_STAT_DIR = 20000;   // above this many entries stats are skipped (name sort still works)
  const MAX_VIEW = 8 * 1024 * 1024;

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const lsKey = () => "basalt-workspace:" + (window.app && app.vault ? app.vault.getName() : "vault");
  const extOf = (n) => { const i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };

  // ---- state
  let root = null;            // absolute path of the open folder
  let rootNode = null;        // tree node for the root (path "")
  let showIgnored = false;
  let activeFile = null;      // rel path of the file open in a tab
  const listeners = new Set();
  const nodeByAbs = new Map(); // abs dir -> node
  const cache = new Map();     // abs dir -> {entries, promise}
  const watchers = new Map();  // abs dir -> fs.FSWatcher
  const igCache = new Map();   // abs dir -> Promise<rules[]|null>  (.gitignore of that dir)
  const chainCache = new Map();// abs dir -> Promise<chain>
  const watchTimers = new Map();

  const notify = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error("[workspace] listener", e); } } };
  const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  // ---- paths
  const relOf = (abs) => { const r = path.relative(root, abs); return r === "" ? "" : r.split(path.sep).join("/"); };
  const absOf = (rel) => (rel ? path.join(root, ...String(rel).split("/")) : root);
  const relPath = (abs) => relOf(abs);

  // ---- .gitignore (the common subset: comments, !, dir-only, anchored, *, **, ?)
  function gitGlob(pat) {
    let re = "";
    for (let i = 0; i < pat.length;) {
      const c = pat[i];
      if (c === "*") {
        if (pat[i + 1] === "*") {
          const prevB = i === 0 || pat[i - 1] === "/";
          const nxt = pat[i + 2], nextB = nxt === undefined || nxt === "/";
          if (prevB && nextB) {
            if (nxt === undefined) { re += ".*"; i += 2; }        // trailing ** : everything inside
            else { re += "(?:[^/]+/)*"; i += 3; }               // **/ : zero or more directories
            continue;
          }
          re += "[^/]*"; i += 2; continue;                      // ** inside a name acts like *
        }
        re += "[^/]*"; i++; continue;
      }
      if (c === "?") { re += "[^/]"; i++; continue; }
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&"); i++;
    }
    return new RegExp("^" + re + "$");
  }
  function parseIgnore(text) {
    const rules = [];
    for (const raw of String(text).split(/\r?\n/)) {
      let l = raw.replace(/\s+$/, "");
      if (!l || l.startsWith("#")) continue;
      let neg = false, dirOnly = false;
      if (l.startsWith("!")) { neg = true; l = l.slice(1); }
      if (l.endsWith("/")) { dirOnly = true; l = l.slice(0, -1); }
      if (!l) continue;
      const anchored = l.includes("/");
      l = l.replace(/^\/+/, "");
      if (!l) continue;
      rules.push({ re: gitGlob(l), neg, dirOnly, nameOnly: !anchored });
    }
    return rules;
  }
  function rulesOf(dirAbs) {
    if (!igCache.has(dirAbs)) {
      igCache.set(dirAbs, (async () => {
        try { return parseIgnore(await fs.promises.readFile(path.join(dirAbs, ".gitignore"), "utf8")); }
        catch (e) { return null; }
      })());
    }
    return igCache.get(dirAbs);
  }
  // .gitignore files from the root down to dirAbs (inclusive)
  async function chainOf(dirAbs) {
    if (chainCache.has(dirAbs)) return chainCache.get(dirAbs);
    const p = (async () => {
      const dirs = [];
      for (let d = dirAbs; ; d = path.dirname(d)) { dirs.unshift(d); if (d === root || d === path.dirname(d)) break; }
      const out = [];
      for (const g of dirs) { const r = await rulesOf(g); if (r && r.length) out.push({ base: g, rules: r }); }
      return out;
    })();
    chainCache.set(dirAbs, p);
    return p;
  }
  function entryIgnored(name, isDir, dirAbs, chain) {
    for (const { base, rules } of chain) {
      const rel = path.relative(base, path.join(dirAbs, name)).split(path.sep).join("/");
      if (rel.startsWith("..")) continue;
      let ig = false;
      for (const r of rules) {
        if (r.dirOnly && !isDir) continue;
        if (r.re.test(r.nameOnly ? name : rel)) ig = !r.neg;
      }
      if (ig) return true;
    }
    return false;
  }

  // ---- tree nodes & lazy listing
  function getDirNode(abs) {
    if (abs === root) return rootNode;
    let n = nodeByAbs.get(abs);
    if (!n) {
      n = { name: path.basename(abs), path: relOf(abs), isDir: true, abs, children: null, parent: null, extension: undefined, stat: null, size: 0, mtime: 0 };
      nodeByAbs.set(abs, n);
    }
    return n;
  }
  async function listDir(absDir) {
    let c = cache.get(absDir);
    if (c && c.entries) return c.entries;
    if (c && c.promise) return c.promise;
    const p = (async () => {
      const ents = await fs.promises.readdir(absDir, { withFileTypes: true });
      const chain = await chainOf(absDir);
      const out = [];
      for (const d of ents) {
        const name = d.name, isDir = d.isDirectory();
        if (name === ".basalt") continue;
        if (!showIgnored && (ALWAYS.has(name) || await entryIgnored(name, isDir, absDir, chain))) continue;
        const abs = path.join(absDir, name);
        let n = nodeByAbs.get(abs);
        if (!n) { n = { name, path: "", isDir, abs, children: isDir ? null : undefined, parent: null, extension: undefined, stat: null, size: 0, mtime: 0 }; nodeByAbs.set(abs, n); }
        n.name = name; n.isDir = isDir; n.path = relOf(abs); n.extension = isDir ? undefined : extOf(name); n.parent = null;
        out.push(n);
      }
      out.sort((a, b) => collator.compare(a.name, b.name));
      const me = getDirNode(absDir);
      me.children = out;
      for (const n of out) n.parent = me;
      watchDir(absDir);
      statEnrich(out);
      notify();
      return out;
    })().catch((e) => { const cc = cache.get(absDir); if (cc) cc.promise = null; throw e; });
    cache.set(absDir, { entries: null, promise: p });
    p.then((entries) => { const cc = cache.get(absDir); if (cc) { cc.entries = entries; cc.promise = null; } }).catch(() => {});
    return p;
  }
  function ensure(node) {
    if (!node || !node.isDir || node.children != null || !root) return;
    listDir(node.abs).catch((e) => { node.children = []; notify(); console.error("[workspace] list", node.path, e); });
  }
  // stats are nice-to-have (mtime sort); fetched in the background, never block the listing
  async function statEnrich(out) {
    if (!out || out.length > MAX_STAT_DIR) return;
    const CH = 400;
    for (let i = 0; i < out.length; i += CH) {
      await Promise.all(out.slice(i, i + CH).map(async (n) => {
        try { const s = await fs.promises.stat(n.abs); n.size = s.size; n.mtime = s.mtimeMs; n.stat = { size: s.size, mtime: s.mtimeMs }; } catch (e) { /* gone */ }
      }));
    }
  }

  // ---- watching: only directories the user actually expanded are watched
  function watchDir(absDir) {
    if (watchers.has(absDir)) return;
    let w;
    try { w = fs.watch(absDir, { persistent: false }, (ev, file) => onWatch(absDir, file)); }
    catch (e) { return; }
    watchers.set(absDir, w);
    w.on("error", () => { try { w.close(); } catch (e) { /* ok */ } watchers.delete(absDir); });
  }
  function onWatch(absDir, file) {
    if (!file) return;
    if (file === ".gitignore") { igCache.delete(absDir); chainCache.clear(); }
    clearTimeout(watchTimers.get(absDir));
    watchTimers.set(absDir, setTimeout(() => {
      watchTimers.delete(absDir);
      const c = cache.get(absDir); if (c) { c.entries = null; c.promise = null; }
      const me = nodeByAbs.get(absDir) || (absDir === root ? rootNode : null);
      if (me) me.children = null;
      notify();
    }, 200));
  }

  // ---- opening / closing a folder
  async function ensureBasalt(dir) {
    try { await fs.promises.mkdir(path.join(dir, ".basalt"), { recursive: true }); } catch (e) { console.error("[workspace] .basalt", e); }
  }
  async function excludeGit(dir) {
    try {
      const git = path.join(dir, ".git");
      const st = await fs.promises.stat(git).catch(() => null);
      if (!st) return;
      let gitdir = git;
      if (st.isFile()) { // worktree / submodule: ".git" is a file with "gitdir: <path>"
        const t = await fs.promises.readFile(git, "utf8");
        const m = /^gitdir:\s*(.+)$/m.exec(t);
        if (m) gitdir = path.resolve(dir, m[1].trim());
      }
      if (!fs.existsSync(gitdir)) return;
      const info = path.join(gitdir, "info");
      await fs.promises.mkdir(info, { recursive: true });
      const ex = path.join(info, "exclude");
      let cur = ""; try { cur = await fs.promises.readFile(ex, "utf8"); } catch (e) { /* new */ }
      if (!cur.split(/\r?\n/).some((l) => l.trim() === ".basalt" || l.trim() === ".basalt/")) {
        await fs.promises.appendFile(ex, (cur && !cur.endsWith("\n") ? "\n" : "") + ".basalt/\n");
      }
    } catch (e) { console.error("[workspace] git exclude", e); }
  }
  async function open(dir) {
    let st = null;
    try { st = await fs.promises.stat(dir); } catch (e) { /* missing */ }
    if (!st || !st.isDirectory()) { if (api()) new (api().Notice)("Не удалось открыть папку: " + dir); return false; }
    close(false);
    root = path.resolve(dir);
    rootNode = { name: path.basename(root) || root, path: "", isDir: true, abs: root, children: null, parent: null, extension: undefined, stat: null, size: 0, mtime: 0 };
    nodeByAbs.set(root, rootNode);
    activeFile = null;
    try { localStorage.setItem(lsKey(), root); } catch (e) { /* full */ }
    ensureBasalt(root); excludeGit(root);
    notify();
    return true;
  }
  function close(doNotify = true) {
    root = null; rootNode = null; activeFile = null;
    for (const w of watchers.values()) { try { w.close(); } catch (e) { /* ok */ } }
    watchers.clear(); cache.clear(); nodeByAbs.clear(); igCache.clear(); chainCache.clear();
    for (const t of watchTimers.values()) clearTimeout(t); watchTimers.clear();
    try { localStorage.removeItem(lsKey()); } catch (e) { /* ok */ }
    if (doNotify) notify();
  }
  function pick() {
    const d = el.remote && el.remote.dialog;
    if (!d || !d.showOpenDialog) { if (api()) new (api().Notice)("Диалог выбора папки недоступен"); return; }
    Promise.resolve(d.showOpenDialog({ title: "Открыть папку", properties: ["openDirectory"] }))
      .then((r) => {
        const dir = r && !r.canceled ? (Array.isArray(r.filePaths) ? r.filePaths[0] : r) : null;
        if (!dir) return;
        open(dir).then((ok) => { if (ok && api()) new (api().Notice)("Папка открыта: " + path.basename(dir)); });
      })
      .catch((e) => console.error("[workspace] dialog", e));
  }

  // ---- ignored toggle & refresh
  function setShowIgnored(v) {
    showIgnored = !!v;
    try { localStorage.setItem("basalt-workspace:ignored", showIgnored ? "1" : "0"); } catch (e) { /* ok */ }
    // every cached listing was filtered differently: drop it all
    cache.clear(); igCache.clear(); chainCache.clear();
    for (const n of nodeByAbs.values()) if (n.isDir) n.children = null;
    notify();
  }
  function refresh() {
    cache.clear();
    for (const n of nodeByAbs.values()) if (n.isDir) n.children = null;
    notify();
  }

  // ---- search (lazy walk, budgeted)
  async function search(q, limit = 400) {
    if (!root || !q) return [];
    const low = q.toLowerCase(), out = [];
    let dirs = 0, token = ++searchToken;
    const walk = async (node) => {
      if (out.length >= limit || dirs > 4000 || token !== searchToken) return;
      const kids = await listDir(node.abs).catch(() => null);
      dirs++;
      if (!kids) return;
      for (const c of kids) {
        if (token !== searchToken || out.length >= limit || dirs > 4000) return;
        if (c.name.toLowerCase().includes(low)) out.push(c);
        if (c.isDir) await walk(c);
      }
    };
    await walk(rootNode);
    return out;
  }
  let searchToken = 0;

  // ---- opening files
  function nodeAt(rel) { return nodeByAbs.get(absOf(rel)) || null; }
  function hasPath(rel) { return !!nodeAt(rel); }
  function openFile(node, newTab) {
    if (!node || node.isDir || !root) return;
    activeFile = node.path;
    notify();
    const legacy = () => openReadOnly(node, newTab);
    if (window.__bsTextFile && window.__bsTextFile.openAbs) { window.__bsTextFile.openAbs(node.abs).then((ok) => { if (!ok) legacy(); }).catch(legacy); return; }
    legacy();
  }
  function openReadOnly(node, newTab) {
    try {
      const ws = app.workspace;
      let leaf = newTab ? null : ws.getMostRecentLeaf(ws.rootSplit);
      if (!leaf || leaf.getRoot() !== ws.rootSplit) leaf = ws.getLeaf("tab");
      leaf.setViewState({ type: VIEW, active: true, state: { path: node.abs, name: node.name } })
        .then(() => ws.setActiveLeaf(leaf, { focus: true }))
        .catch((e) => console.error("[workspace] open file", e));
    } catch (e) { console.error("[workspace] open file", e); }
  }

  // ---- read-only file view
  const css = document.createElement("style");
  css.textContent = `
    .bswf { display: flex; flex-direction: column; height: 100%; }
    .bswf-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--background-modifier-border); font-size: var(--font-ui-small); color: var(--text-muted); }
    .bswf-bar b { color: var(--text-normal); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bswf-bar .bswf-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
    .bswf-bar button { background: transparent; box-shadow: none; padding: 4px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-muted); border-radius: 4px; clip-path: none; flex: none; }
    .bswf-bar button:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .bswf-bar svg { width: 16px; height: 16px; }
    .bswf-body { flex: 1; overflow: auto; position: relative; }
    .bswf-pre { margin: 0; padding: 12px 16px; font-family: var(--font-monospace); font-size: var(--font-ui-small); line-height: 1.55; color: var(--text-normal); white-space: pre; tab-size: 4; }
    .bswf-img { display: flex; align-items: center; justify-content: center; min-height: 100%; padding: 24px; box-sizing: border-box; }
    .bswf-img img { max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 0 0 1px var(--background-modifier-border); }
    .bswf-bin { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; height: 100%; color: var(--text-muted); font-size: var(--font-ui-small); }
    .bswf-bin svg { width: 40px; height: 40px; color: var(--text-faint); }
    .bswf-note { padding: 8px 16px; color: var(--text-faint); font-size: var(--font-ui-smaller); border-bottom: 1px solid var(--background-modifier-border); }
  `;
  document.head.appendChild(css);

  function makeView() {
    const A = api();
    return class WorkspaceFileView extends A.ItemView {
      getViewType() { return VIEW; }
      getDisplayText() { return this.name || (this.path ? path.basename(this.path) : "Файл"); }
      getIcon() { return "file"; }
      async onOpen() {
        this.contentEl.empty && this.contentEl.empty(); this.contentEl.addClass("bswf");
        this.body = this.contentEl.createDiv("bswf-body");
        if (this.path) await this.load();
      }
      async setState(state) {
        this.path = state && state.path;
        this.name = state && state.name;
        if (this.body) await this.load();
      }
      async onClose() { if (this.url) { URL.revokeObjectURL(this.url); this.url = null; } }
      async load() {
        const body = this.body; if (!body || !this.path) return;
        if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
        body.empty();
        const A2 = api();
        let st = null;
        try { st = await fs.promises.stat(this.path); } catch (e) { body.createDiv({ cls: "bswf-bin", text: "Файл не найден" }); return; }
        const rel = root ? relPath(this.path) : this.path;
        const head = body.createDiv("bswf-bar");
        const b = head.createEl("b", { text: this.name || path.basename(this.path) });
        const p = head.createSpan({ cls: "bswf-path", text: rel }); p.title = this.path;
        const btn = (icon, tip, fn) => { const x = document.createElement("button"); x.title = tip; try { A2.setIcon(x, icon); } catch (e) { x.textContent = "•"; } x.addEventListener("click", fn); head.appendChild(x); return x; };
        btn("lucide-folder-open", "Показать в папке", () => { try { window.__bsReveal(this.path); } catch (e) { /* ok */ } });
        btn("lucide-copy", "Копировать путь", () => { navigator.clipboard.writeText(this.path).then(() => new A2.Notice("Путь скопирован")); });
        const ext = extOf(this.path);
        let buf;
        try {
          if (st.size > MAX_VIEW) {
            const fd = await fs.promises.open(this.path, "r");
            buf = Buffer.alloc(MAX_VIEW);
            await fd.read(buf, 0, MAX_VIEW, 0);
            await fd.close();
          } else buf = await fs.promises.readFile(this.path);
        } catch (e) { body.createDiv({ cls: "bswf-bin", text: "Не удалось прочитать файл" }); return; }
        const probe = buf.slice(0, 8000);
        const binary = probe.includes(0);
        if (IMG.test(ext) && !binary) {
          const wrap = body.createDiv("bswf-img");
          const img = wrap.createEl("img", { attr: { alt: this.name || "" } });
          this.url = URL.createObjectURL(new Blob([buf], { type: MIME[ext] || "application/octet-stream" }));
          img.src = this.url;
          return;
        }
        if (binary) {
          const bin = body.createDiv("bswf-bin");
          try { A2.setIcon(bin.createSpan(), "lucide-file-x-2"); } catch (e) { /* ok */ }
          bin.appendChild(document.createTextNode("двоичный файл"));
          const s = document.createElement("small"); s.textContent = `${(st.size / 1048576).toFixed(2)} МБ`; bin.appendChild(s);
          return;
        }
        let text = buf.toString("utf8");
        if (st.size > MAX_VIEW) { body.createDiv({ cls: "bswf-note", text: `Показаны первые ${MAX_VIEW / 1048576} МБ из ${(st.size / 1048576).toFixed(1)} МБ` }); }
        const pre = body.createEl("pre", { cls: "bswf-pre" });
        pre.textContent = text;
      }
    };
  }

  // ---- app menu: add "Открыть папку…" to the File menu
  function injectMenu(template) {
    for (const top of template) {
      if (top.label !== "&File" || !Array.isArray(top.submenu)) continue;
      if (top.submenu.some((i) => i.appCommand === "basalt:open-folder" || i.id === "basalt:open-folder")) return;
      const item = { appCommand: "basalt:open-folder", label: "Открыть папку…", before: ["open-vault"] };
      const sep = top.submenu.findIndex((i) => i.type === "separator");
      if (sep > 0) top.submenu.splice(sep, 0, item); else top.submenu.push(item);
      return;
    }
  }
  let menuPatched = false;
  function patchMenu() {
    if (menuPatched) return;
    try {
      const ipc = el.ipcRenderer;
      if (!ipc || !ipc.send) return;
      const send = ipc.send.bind(ipc);
      ipc.send = function (channel, ...rest) {
        if (channel === "set-menu") {
          try { const t = rest[0] && rest[0].template; if (Array.isArray(t)) injectMenu(t); } catch (e) { /* menu stays stock */ }
        }
        return send(channel, ...rest);
      };
      menuPatched = true;
    } catch (e) { console.error("[workspace] menu", e); }
  }

  // ---- public API
  const WS = {
    VIEW,
    active: () => !!root,
    root: () => root,
    rootName: () => (rootNode ? rootNode.name : ""),
    rootNode: () => rootNode,
    relPath,
    absOf,
    onChange,
    pick,
    open,
    close: () => close(),
    setShowIgnored,
    showIgnored: () => showIgnored,
    refresh,
    ensure,
    listDir,
    childrenOf: (node) => (node && node.children != null ? node.children : null),
    search,
    nodeAt,
    hasPath,
    openFile,
    activePath: () => activeFile,
  };
  window.__bsWorkspace = WS;

  // ---- boot: view, commands, menu hook, restore last folder
  try { showIgnored = localStorage.getItem("basalt-workspace:ignored") === "1"; } catch (e) { /* ok */ }
  let registered = false;
  const boot = () => {
    if (!(window.app && app.workspace && app.viewRegistry && window.__bsApi && app.vault && app.commands)) return false;
    if (!registered) {
      registered = true;
      const View = makeView();
      try { app.viewRegistry.registerView(VIEW, (leaf) => new View(leaf)); } catch (e) { app.viewRegistry.viewByType[VIEW] = (leaf) => new View(leaf); }
      app.commands.addCommand({ id: "basalt:open-folder", name: "Открыть папку…", callback: () => pick() });
      app.commands.addCommand({ id: "basalt:close-folder", name: "Закрыть папку", checkCallback: (c) => { if (!root) return false; if (!c) close(); return true; } });
      patchMenu();
      // reopen the last folder of this vault, if it is still there
      try {
        const last = localStorage.getItem(lsKey());
        if (last) fs.promises.stat(last).then((s) => { if (s.isDirectory() && !root) open(last); }).catch(() => {});
      } catch (e) { /* ok */ }
    }
    return true;
  };
  const t = setInterval(() => { try { if (boot()) clearInterval(t); } catch (e) { console.error("[workspace]", e); } }, 700);
})();
