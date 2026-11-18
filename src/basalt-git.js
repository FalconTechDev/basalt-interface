// Basalt Git panel (VS Code "Source control"): branch, staged / changed files, stage / unstage / discard, commit, pull / push, diff tab.
// Works on the open folder (or the vault) with the system `git`. Nothing destructive runs without a confirmation that names what is lost.
(() => {
  "use strict";
  const cp = window.require("child_process"), fs = window.require("fs"), path = window.require("path");
  const VIEW = "basalt-git", DIFF = "basalt-diff";
  const css = document.createElement("style");
  css.textContent = `
    .bsg2 { --background-primary: var(--vs-bg); --text-normal: var(--vs-fg); --text-muted: var(--vs-ln); font-family: var(--font-interface); height: 100%; display: flex; flex-direction: column; background: var(--vs-bg); color: var(--vs-fg); font-size: 13px; }
    .bsg2-head { display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 12px; }
    .bsg2-head b { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--vs-ln); font-weight: 600; margin-right: auto; }
    .bsg2-ib { width: 24px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--bs-r, 4px); color: var(--vs-ln); cursor: pointer; border: 0; background: transparent; box-shadow: none; font-size: 14px; padding: 0; }
    .bsg2-ib:hover { background: rgba(128,128,128,.25); color: var(--vs-fg); }
    .bsg2-branch { display: flex; align-items: center; gap: 6px; margin: 0 8px 6px; padding: 4px 8px; border-radius: var(--bs-r, 4px); cursor: pointer; background: var(--vs-input); }
    .bsg2-branch:hover { outline: 1px solid var(--interactive-accent); } .bsg2-branch small { color: var(--vs-ln); margin-left: auto; }
    .bsg2-msg { margin: 0 8px 6px; min-height: 54px; resize: vertical; padding: 6px 8px; border-radius: var(--bs-r, 4px); border: 1px solid transparent; background: var(--vs-input); color: var(--vs-fg); font: inherit; outline-offset: -1px; }
    .bsg2-msg:focus { outline: 1px solid var(--interactive-accent); }
    .bsg2-commit { margin: 0 8px 8px; height: 28px; border: 0; border-radius: var(--bs-r, 4px); background: var(--interactive-accent); color: var(--text-on-accent); cursor: pointer; box-shadow: none; font-size: 13px; }
    .bsg2-commit:hover { background: var(--interactive-accent-hover); } .bsg2-commit:disabled { opacity: .5; cursor: default; }
    .bsg2-list { flex: 1; overflow: auto; }
    .bsg2-sec { display: flex; align-items: center; padding: 3px 8px 3px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--vs-ln); font-weight: 600; background: rgba(128,128,128,.08); }
    .bsg2-sec span { margin-left: auto; background: rgba(128,128,128,.3); border-radius: 9px; padding: 0 6px; color: var(--vs-fg); }
    .bsg2-row { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px 0 12px; cursor: pointer; white-space: nowrap; }
    .bsg2-row:hover { background: rgba(128,128,128,.18); } .bsg2-row .acts { display: none; margin-left: auto; } .bsg2-row:hover .acts { display: inline-flex; }
    .bsg2-n { overflow: hidden; text-overflow: ellipsis; } .bsg2-d { color: var(--vs-ln); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
    .bsg2-st { margin-left: auto; width: 14px; text-align: center; font-weight: 600; } .bsg2-row:hover .bsg2-st { display: none; }
    .bsg2-empty { padding: 16px; color: var(--vs-ln); }
    .bsd { font-family: Consolas, 'Cascadia Code', monospace; font-size: 13px; height: 100%; overflow: auto; background: var(--vs-bg); color: var(--vs-fg); padding: 8px 0; user-select: text; }
    .bsd div { white-space: pre; padding: 0 16px; min-height: 19px; } .bsd .add { background: rgba(35,134,54,.28); } .bsd .del { background: rgba(218,54,51,.28); } .bsd .hunk { color: #6a9fd8; background: rgba(0,127,212,.12); } .bsd .meta { color: var(--vs-ln); }
  `;
  document.head.appendChild(css);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const rootDir = () => { const W = window.__bsWorkspace; return W && W.active && W.active() && W.root() ? W.root() : app.vault.adapter.basePath; };
  const git = (cwd, args) => new Promise((res, rej) => cp.execFile("git", args, { cwd, maxBuffer: 40 * 1024 * 1024, windowsHide: true, encoding: "utf8" }, (e, out, err) => (e ? rej(new Error((err || e.message).trim())) : res(out))));
  const notice = (m) => { try { new window.__bsApi.Notice(m, 6000); } catch (e) { console.warn(m); } };
  const COL = { M: "#e2c08d", A: "#73c991", D: "#c74e39", R: "#73c991", "?": "#73c991", U: "#e2c08d", C: "#73c991" };

  async function status(cwd) {
    const out = await git(cwd, ["status", "--porcelain=v1", "-b", "-uall"]); const lines = out.split("\n").filter(Boolean); let branch = "", ahead = 0, behind = 0; const staged = [], changed = [];
    for (const l of lines) {
      if (l.startsWith("## ")) { const m = /^## (?:No commits yet on )?([^\s.]+)(?:\.\.\.\S+)?(?: \[(.*)\])?/.exec(l); branch = m ? m[1] : l.slice(3); if (m && m[2]) { const a = /ahead (\d+)/.exec(m[2]), b = /behind (\d+)/.exec(m[2]); ahead = a ? +a[1] : 0; behind = b ? +b[1] : 0; } continue; }
      const x = l[0], y = l[1]; let file = l.slice(3); if (file.includes(" -> ")) file = file.split(" -> ")[1]; file = file.replace(/^"|"$/g, "");
      if (x === "?" && y === "?") { changed.push({ file, st: "?" }); continue; }
      if (x !== " " && x !== "?") staged.push({ file, st: x }); if (y !== " " && y !== "?") changed.push({ file, st: y });
    }
    return { branch, ahead, behind, staged, changed };
  }

  function makeViews(api) {
    class GitView extends api.ItemView {
      getViewType() { return VIEW; }
      getDisplayText() { return "Git"; }
      getIcon() { return "lucide-git-branch"; }
      async onOpen() {
        const c = this.contentEl; c.textContent = ""; c.style.padding = "0"; this.root = el("div", "bsg2"); c.appendChild(this.root);
        this.timer = setInterval(() => { if (this.contentEl.isConnected && this.contentEl.offsetParent) this.refresh(true); }, 4000); await this.refresh();
      }
      async onClose() { clearInterval(this.timer); }
      ib(parent, txt, title, fn) { const b = el("button", "bsg2-ib", txt); b.title = title; b.addEventListener("click", (e) => { e.stopPropagation(); fn(e); }); parent.appendChild(b); return b; }
      async run(args, okMsg) { try { await git(this.cwd, args); if (okMsg) notice(okMsg); } catch (e) { notice("git: " + e.message); } await this.refresh(); }
      async refresh(quiet) {
        this.cwd = rootDir(); const root = this.root; let st;
        try { st = await status(this.cwd); } catch (e) {
          if (quiet && this.st === null) return; this.st = null; root.textContent = ""; const m = el("div", "bsg2-empty"); m.textContent = /not a git repository/i.test(e.message) ? "Это не git-репозиторий: " + path.basename(this.cwd) : "git: " + e.message; root.appendChild(m);
          if (/not a git repository/i.test(e.message)) { const b = el("button", "bsg2-commit", "Инициализировать репозиторий"); b.style.margin = "0 12px"; b.addEventListener("click", () => this.run(["init"], "Репозиторий создан")); root.appendChild(b); } return;
        }
        const sig = JSON.stringify(st); if (quiet && sig === this.sig) return; this.sig = sig; this.st = st; const keep = this.msg ? this.msg.value : "";
        root.textContent = ""; const h = el("div", "bsg2-head"); h.appendChild(el("b", null, "Система контроля версий")); this.ib(h, "↻", "Обновить", () => this.refresh()); root.appendChild(h);
        const br = el("div", "bsg2-branch"); br.appendChild(el("span", null, "⎇ " + (st.branch || "—"))); const sm = el("small", null, (st.ahead ? "↑" + st.ahead + " " : "") + (st.behind ? "↓" + st.behind : "")); br.appendChild(sm); br.title = "Сменить ветку"; br.addEventListener("click", (e) => this.branchMenu(e)); root.appendChild(br);
        const sync = el("div", "bsg2-head"); sync.style.paddingTop = "0"; this.ib(sync, "↓", "Получить изменения (pull --ff-only)", () => this.run(["pull", "--ff-only"], "Получено")); this.ib(sync, "↑", "Отправить (push)", () => this.run(["push"], "Отправлено")); this.ib(sync, "⟳", "Fetch", () => this.run(["fetch", "--all"], "Fetch выполнен")); root.appendChild(sync);
        this.msg = el("textarea", "bsg2-msg"); this.msg.placeholder = "Сообщение коммита (Ctrl+Enter)"; this.msg.value = keep; root.appendChild(this.msg);
        const cb = el("button", "bsg2-commit", "✓ Закоммитить" + (st.staged.length ? " (" + st.staged.length + ")" : "")); cb.addEventListener("click", () => this.commit()); root.appendChild(cb); this.msg.addEventListener("keydown", (e) => { if (e.ctrlKey && e.key === "Enter") this.commit(); });
        const list = el("div", "bsg2-list"); root.appendChild(list);
        const section = (title, items, staged) => {
          if (!items.length) return; const s = el("div", "bsg2-sec", title); s.appendChild(el("span", null, String(items.length))); list.appendChild(s);
          for (const it of items) {
            const r = el("div", "bsg2-row"), name = path.posix.basename(it.file), dir = path.posix.dirname(it.file); r.title = it.file; const n = el("span", "bsg2-n", name); r.appendChild(n); if (dir !== ".") r.appendChild(el("span", "bsg2-d", dir));
            const acts = el("span", "acts"); r.appendChild(acts);
            this.ib(acts, "↗", "Открыть файл", () => this.openFile(it.file));
            if (staged) this.ib(acts, "−", "Убрать из коммита", () => this.run(["restore", "--staged", "--", it.file]));
            else { this.ib(acts, "↶", "Отменить изменения", () => this.discard(it)); this.ib(acts, "+", "Добавить в коммит", () => this.run(["add", "--", it.file])); }
            const stl = el("span", "bsg2-st", it.st === "?" ? "U" : it.st); stl.style.color = COL[it.st] || "#e2c08d"; r.appendChild(stl);
            r.addEventListener("click", () => this.showDiff(it, staged)); list.appendChild(r);
          }
        };
        section("Изменения в коммите", st.staged, true); section("Изменения", st.changed, false);
        if (!st.staged.length && !st.changed.length) list.appendChild(el("div", "bsg2-empty", "Изменений нет. Рабочая папка чистая."));
      }
      async commit() {
        const m = this.msg.value.trim(); if (!m) { notice("Напишите сообщение коммита"); this.msg.focus(); return; }
        if (!this.st.staged.length) { if (!this.st.changed.length) { notice("Нечего коммитить"); return; } if (!confirm("В коммит ничего не добавлено. Добавить все изменения (" + this.st.changed.length + " файлов) и закоммитить?")) return; try { await git(this.cwd, ["add", "-A"]); } catch (e) { notice("git: " + e.message); return; } }
        try { await git(this.cwd, ["commit", "-m", m]); this.msg.value = ""; notice("Коммит создан"); } catch (e) { notice("git: " + e.message); } await this.refresh();
      }
      async discard(it) {
        const abs = path.join(this.cwd, it.file);
        if (it.st === "?") { if (!confirm("Удалить неотслеживаемый файл навсегда?\n\n" + it.file)) return; try { fs.unlinkSync(abs); } catch (e) { notice(e.message); } await this.refresh(); return; }
        if (!confirm("Отменить изменения в файле и вернуть его к последнему коммиту? Правки будут потеряны.\n\n" + it.file)) return; await this.run(["restore", "--", it.file]);
      }
      async branchMenu(e) {
        const M = api.Menu; if (!M) return; let out = ""; try { out = await git(this.cwd, ["branch", "--format=%(refname:short)"]); } catch (er) { notice("git: " + er.message); return; }
        const m = new M(); for (const b of out.split("\n").filter(Boolean)) m.addItem((i) => { i.setTitle(b).setIcon("lucide-git-branch").onClick(() => this.run(["checkout", b], "Ветка: " + b)); if (b === this.st.branch) i.setChecked(true); });
        m.addSeparator(); m.addItem((i) => i.setTitle("Создать ветку…").setIcon("lucide-plus").onClick(() => { const n = prompt("Имя новой ветки:"); if (n && n.trim()) this.run(["checkout", "-b", n.trim()], "Создана ветка " + n.trim()); })); m.showAtMouseEvent(e);
      }
      openFile(rel) { const F = window.__bsFind; if (F && F.openAt) F.openAt(path.join(this.cwd, rel), 0); }
      async showDiff(it, staged) {
        let text = ""; try { if (it.st === "?") text = fs.readFileSync(path.join(this.cwd, it.file), "utf8").split("\n").map((l) => "+" + l).join("\n"), text = "новый файл " + it.file + "\n@@ новый файл @@\n" + text; else text = await git(this.cwd, ["diff", "--no-color", ...(staged ? ["--cached"] : []), "--", it.file]); } catch (e) { text = "git: " + e.message; }
        const ws = app.workspace, leaf = ws.getLeaf("tab"); await leaf.setViewState({ type: DIFF, active: true, state: { title: it.file + (staged ? " (в коммите)" : ""), text } }); ws.setActiveLeaf(leaf, { focus: true });
      }
    }
    class DiffView extends api.ItemView {
      constructor(leaf) { super(leaf); this.title = "Различия"; this.text = ""; }
      getViewType() { return DIFF; }
      getDisplayText() { return this.title; }
      getIcon() { return "lucide-file-diff"; }
      getState() { return { title: this.title, text: this.text }; }
      async setState(state, result) { if (state) { this.title = state.title || this.title; this.text = state.text || ""; this.render(); try { this.leaf.updateHeader(); } catch (e) { /* ok */ } } return super.setState ? super.setState(state, result) : undefined; }
      async onOpen() { this.contentEl.style.padding = "0"; this.render(); }
      render() {
        const c = this.contentEl; c.textContent = ""; const box = el("div", "bsd"); c.appendChild(box);
        if (!this.text.trim()) { box.appendChild(el("div", "meta", "Различий нет")); return; }
        for (const l of this.text.split("\n")) { const d = el("div", /^(diff |index |--- |\+\+\+ |новый файл)/.test(l) ? "meta" : l.startsWith("@@") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "", l || " "); box.appendChild(d); }
      }
    }
    return { GitView, DiffView };
  }

  async function openPanel() {
    const ws = app.workspace, ex = ws.getLeavesOfType(VIEW)[0]; if (ex) { ws.revealLeaf(ex); return; }
    const leaf = ws.getLeftLeaf(false); await leaf.setViewState({ type: VIEW, active: true }); ws.revealLeaf(leaf);
  }
  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.viewRegistry || !app.commands || !window.__bsApi || !window.__bsApi.ItemView) return;
    clearInterval(t);
    const { GitView, DiffView } = makeViews(window.__bsApi);
    const reg = (type, C) => { const creator = (leaf) => new C(leaf); try { app.viewRegistry.registerView(type, creator); } catch (e) { app.viewRegistry.viewByType[type] = creator; } };
    reg(VIEW, GitView); reg(DIFF, DiffView);
    app.commands.addCommand({ id: "basalt:git-panel", name: "Git: панель изменений", icon: "lucide-git-branch", hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "G" }], callback: () => openPanel() });
    window.__bsGit = { open: openPanel, status, git };
  }, 500);
})();
