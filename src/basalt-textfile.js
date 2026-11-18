// Basalt text files: every text file (yaml, json, bat, source code, logs, no extension...) opens in a tab here, with syntax
// colours, search/replace, folding, bracket matching, comment toggling and a status bar, instead of being handed to another
// application. Binary files and huge files still go to the system as before.
(() => {
  "use strict";
  const VIEW = "basalt-textfile";
  const MAX = 5 * 1024 * 1024;
  const nfs = window.require("fs"), npath = window.require("path"), ncp = window.require("child_process"), WIN = process.platform === "win32";
  const isAbs = (p) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/");
  const io = {
    read: (p) => (isAbs(p) ? nfs.promises.readFile(p, "utf8") : app.vault.adapter.read(p)),
    write: (p, t) => (isAbs(p) ? nfs.promises.writeFile(p, t, "utf8") : app.vault.adapter.write(p, t)),
    abs: (p) => (isAbs(p) ? p : npath.join(app.vault.adapter.basePath, p)),
  };
  const baseName = (p) => p.split(/[\\/]/).pop();
  const has = (c) => { try { return ncp.spawnSync(WIN ? "where" : "which", [c], { windowsHide: true }).status === 0; } catch (e) { return false; } };
  const RUNNABLE = new Set(["js", "mjs", "cjs", "ts", "py", "rs", "go", "java", "dart", "rb", "php", "lua", "sh", "bat", "cmd", "ps1", "html", "htm"]);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bstf." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("bstf." + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const css = document.createElement("style");
  css.textContent = `
    .bstf { position: absolute; inset: 0; display: flex; flex-direction: column; }
    .bstf .CodeMirror { flex: 1; min-height: 0; height: 100%; background: transparent; color: var(--text-normal); font-family: var(--font-monospace); font-size: var(--bstf-size, 14px); line-height: 1.55; }
    .bstf .CodeMirror-gutters { background: transparent; border-right: 1px solid var(--background-modifier-border); }
    .bstf .CodeMirror-linenumber { color: var(--text-faint); }
    .bstf .CodeMirror-cursor { border-left-color: var(--text-normal); }
    .bstf .CodeMirror-selected, .bstf .CodeMirror-focused .CodeMirror-selected { background: var(--text-selection, rgba(120,120,255,.3)); }
    .bstf .CodeMirror-activeline-background { background: var(--background-modifier-hover); }
    .bstf .CodeMirror-activeline .CodeMirror-linenumber { color: var(--text-normal); }
    .bstf-bar { display: flex; align-items: center; gap: 8px; padding: 4px 12px; font-size: var(--font-ui-smaller); color: var(--text-faint); border-bottom: 1px solid var(--background-modifier-border); }
    .bstf-bar .bstf-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bstf-bar .bstf-state { margin-left: auto; white-space: nowrap; }
    .bstf-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 22px; padding: 0 6px; border-radius: var(--bs-r, 4px); color: var(--text-muted); cursor: pointer; border: 1px solid transparent; background: transparent; font: inherit; font-size: var(--font-ui-smaller); }
    .bstf-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .bstf-btn.on { background: var(--background-modifier-hover); border-color: var(--background-modifier-border); color: var(--text-normal); }
    .bstf-find { display: none; flex-direction: column; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--background-modifier-border); background: var(--background-secondary); }
    .bstf-find.open { display: flex; }
    .bstf-row { display: flex; align-items: center; gap: 6px; }
    .bstf-row.rep { display: none; }
    .bstf-find.replace .bstf-row.rep { display: flex; }
    .bstf-in { flex: 1; min-width: 80px; max-width: 360px; height: 24px; padding: 0 8px; border-radius: var(--bs-r, 4px); border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font: inherit; font-size: var(--font-ui-small); }
    .bstf-in.bad { border-color: var(--text-error); }
    .bstf-count { min-width: 64px; color: var(--text-faint); font-size: var(--font-ui-smaller); text-align: center; white-space: nowrap; }
    .bstf-status { display: flex; align-items: center; gap: 14px; padding: 2px 12px; font-size: var(--font-ui-smaller); color: var(--text-faint); border-top: 1px solid var(--background-modifier-border); user-select: none; }
    .bstf-status .sp { margin-left: auto; }
    .bstf-status span[data-act] { cursor: pointer; } .bstf-status span[data-act]:hover { color: var(--text-normal); }
    .bstf .CodeMirror { min-width: 0; }
    .bstf-selmatch { background: rgba(128,160,200,.25); border-radius: var(--bs-r, 4px); }
    .bstf .CodeMirror-scroll::-webkit-scrollbar { width: 14px; height: 14px; }
    .bstf .CodeMirror-scroll::-webkit-scrollbar-track, .bstf .CodeMirror-scroll::-webkit-scrollbar-corner { background: transparent; }
    .bstf .CodeMirror-scroll::-webkit-scrollbar-thumb { background: rgba(121,121,121,.4); border: 0; }
    .bstf .CodeMirror-scroll::-webkit-scrollbar-thumb:hover { background: rgba(121,121,121,.65); }
    .bstf-mini { position: relative; flex: none; border-left: 1px solid rgba(128,128,128,.15); background: var(--vs-bg); cursor: pointer; overflow: hidden; }
    .bstf-mini canvas { display: block; }
    .bstf-mini-slider { position: absolute; left: 0; right: 0; background: rgba(128,128,128,.22); pointer-events: none; }
    .bstf-mini:hover .bstf-mini-slider { background: rgba(128,128,128,.34); }
    .bstf .bstf-btn { background: transparent; box-shadow: none; border: 0; border-radius: var(--bs-r, 4px); }
    .bstf-run-action svg { color: #3fb950; } .bstf-run-action:hover svg { color: #56d364; }
    .bstf-term { display: flex; flex-direction: column; border-top: 1px solid var(--vs-border); background: var(--vs-bg); position: relative; flex: none; }
    .bstf-term-grip { position: absolute; left: 0; right: 0; top: -3px; height: 6px; cursor: ns-resize; z-index: 5; }
    .bstf-term-grip:hover { background: var(--interactive-accent); opacity: .6; }
    .bstf-term-head { display: flex; align-items: center; gap: 6px; padding: 2px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--vs-ln); }
    .bstf-term-head .sp { margin-left: auto; }
    .bstf-term-body { flex: 1; min-height: 0; position: relative; padding: 0 6px 4px 10px; }
    .bstf-term-body .xterm { height: 100%; }
    .bstf-msg { padding: 24px; color: var(--text-muted); }
    .bstf-match { background: rgba(255,200,0,.28); border-radius: var(--bs-r, 4px); }
    .bstf-cur { background: rgba(255,150,0,.55); border-radius: var(--bs-r, 4px); outline: 1px solid rgba(255,150,0,.9); }
    .bstf .CodeMirror-matchingbracket { color: var(--text-normal) !important; background: rgba(120,200,255,.28); border-radius: var(--bs-r, 4px); }
    .bstf .CodeMirror-nonmatchingbracket { color: var(--text-error) !important; }
    .bstf .CodeMirror-foldgutter { width: 14px; } .bstf .CodeMirror-foldgutter-open, .bstf .CodeMirror-foldgutter-folded { cursor: pointer; color: var(--text-faint); text-align: center; }
    .bstf .CodeMirror-foldgutter-open:after { content: "\\25BE"; } .bstf .CodeMirror-foldgutter-folded:after { content: "\\25B8"; color: var(--text-accent); }
    .bstf .CodeMirror-foldgutter-open { opacity: 0; transition: opacity .12s; } .bstf .CodeMirror-gutters:hover .CodeMirror-foldgutter-open { opacity: 1; }
    .bstf .CodeMirror-foldmarker { color: var(--text-accent); background: var(--background-modifier-hover); border-radius: var(--bs-r, 4px); padding: 0 4px; cursor: pointer; font-family: inherit; text-shadow: none; }
    .bstf .CodeMirror { position: relative; overflow: hidden; direction: ltr; }
    .bstf .CodeMirror-scroll { overflow: scroll !important; margin-bottom: -50px; margin-right: -50px; padding-bottom: 50px; height: 100%; outline: none; position: relative; }
    .bstf .CodeMirror-sizer { position: relative; border-right: 50px solid transparent; }
    .bstf .CodeMirror-vscrollbar, .bstf .CodeMirror-hscrollbar, .bstf .CodeMirror-scrollbar-filler, .bstf .CodeMirror-gutter-filler { position: absolute; z-index: 6; display: none; outline: none; }
    .bstf .CodeMirror-vscrollbar { right: 0; top: 0; overflow-x: hidden; overflow-y: scroll; }
    .bstf .CodeMirror-hscrollbar { bottom: 0; left: 0; overflow-y: hidden; overflow-x: scroll; }
    .bstf .CodeMirror-scrollbar-filler { right: 0; bottom: 0; } .bstf .CodeMirror-gutter-filler { left: 0; bottom: 0; }
    .bstf .CodeMirror-gutters { position: absolute; left: 0; top: 0; min-height: 100%; z-index: 3; }
    .bstf .CodeMirror-gutter { white-space: normal; height: 100%; display: inline-block; vertical-align: top; margin-bottom: -50px; }
    .bstf .CodeMirror-gutter-wrapper { position: absolute; z-index: 4; background: none !important; border: none !important; }
    .bstf .CodeMirror-gutter-background { position: absolute; top: 0; bottom: 0; z-index: 4; }
    .bstf .CodeMirror-gutter-elt { position: absolute; cursor: default; z-index: 4; }
    .bstf .CodeMirror-lines { cursor: text; min-height: 1px; padding: 4px 0; }
    .bstf .CodeMirror pre.CodeMirror-line, .bstf .CodeMirror pre.CodeMirror-line-like { border-radius: 0; border-width: 0; background: transparent; font-family: inherit; font-size: inherit; margin: 0; white-space: pre; word-wrap: normal; line-height: inherit; color: inherit; z-index: 2; position: relative; overflow: visible; padding: 0 6px; }
    .bstf .CodeMirror-wrap pre.CodeMirror-line, .bstf .CodeMirror-wrap pre.CodeMirror-line-like { word-wrap: break-word; white-space: pre-wrap; word-break: normal; }
    .bstf .CodeMirror-code { outline: none; }
    .bstf .CodeMirror-measure { position: absolute; width: 100%; height: 0; overflow: hidden; visibility: hidden; }
    .bstf .CodeMirror-cursor { position: absolute; pointer-events: none; border-left: 1px solid; width: 0; }
    .bstf .CodeMirror-cursors { visibility: hidden; position: relative; z-index: 3; } .bstf .CodeMirror-focused .CodeMirror-cursors { visibility: visible; }
    .bstf .CodeMirror-selected { background: var(--text-selection, rgba(120,120,255,.3)); }
    .bstf .CodeMirror-linebackground { position: absolute; left: 0; right: 0; top: 0; bottom: 0; z-index: 0; }
    .bstf .CodeMirror-linenumber { padding: 0 8px 0 10px; min-width: 20px; text-align: right; white-space: nowrap; }
    body { --vs-bg: var(--background-primary); --vs-fg: var(--text-normal); --vs-ln: var(--text-muted); --vs-line: var(--background-primary-alt); --vs-sel: color-mix(in srgb, var(--interactive-accent) 38%, transparent); --vs-gut: var(--background-primary); --vs-widget: var(--background-secondary); --vs-border: var(--background-modifier-border); --vs-input: var(--background-secondary-alt, var(--background-primary-alt)); --vs-guide: color-mix(in srgb, var(--text-faint) 45%, transparent); --vs-selrow: color-mix(in srgb, var(--interactive-accent) 30%, transparent); --vs-op: var(--text-normal);
      --vs-kw:#569cd6; --vs-ctl:#c586c0; --vs-str:#ce9178; --vs-num:#b5cea8; --vs-com:#6a9955; --vs-fn:#dcdcaa; --vs-var:#9cdcfe; --vs-type:#4ec9b0; }
    body.theme-light { --vs-kw:#0000ff; --vs-ctl:#af00db; --vs-str:#a31515; --vs-num:#098658; --vs-com:#008000; --vs-fn:#795e26; --vs-var:#001080; --vs-type:#267f99; }
    .bstf { background: var(--vs-bg); color: var(--vs-fg); }
    .bstf .CodeMirror { color: var(--vs-fg); font-family: Consolas, "Cascadia Code", var(--font-monospace); }
    .bstf .CodeMirror-gutters { background: var(--vs-gut); border-right: 0; }
    .bstf .CodeMirror-linenumber { color: var(--vs-ln); }
    .bstf .CodeMirror-activeline .CodeMirror-linenumber { color: var(--vs-lna); }
    .bstf .CodeMirror-activeline-background { background: var(--vs-line); box-shadow: inset 0 0 0 1px rgba(128,128,128,.18); }
    .bstf .CodeMirror-cursor { border-left: 2px solid var(--vs-fg); }
    .bstf .CodeMirror-selected, .bstf .CodeMirror-focused .CodeMirror-selected { background: var(--vs-sel); }
    .bstf-bar { background: var(--vs-bg); border-bottom: 0; padding: 3px 12px; color: var(--vs-ln); }
    .bstf-bar .bstf-path b { font-weight: normal; color: var(--vs-fg); } .bstf-bar .bstf-path i { font-style: normal; opacity: .6; margin: 0 4px; }
    .bstf-btn { color: var(--vs-ln); } .bstf-btn:hover, .bstf-btn.on { color: var(--vs-fg); background: rgba(128,128,128,.2); border-color: transparent; }
    .bstf-find { position: absolute; top: 30px; right: 22px; z-index: 20; width: 440px; max-width: calc(100% - 40px); padding: 6px 8px; border: 1px solid var(--vs-border); border-top: 0; border-radius: 0 0 4px 4px; background: var(--vs-widget); box-shadow: 0 2px 8px rgba(0,0,0,.36); }
    .bstf-find .bstf-in { max-width: none; background: var(--vs-input); color: var(--vs-fg); border: 1px solid transparent; border-radius: var(--bs-r, 4px); }
    .bstf-find .bstf-in:focus { outline: 1px solid var(--interactive-accent); outline-offset: -1px; }
    .bstf-row { flex-wrap: wrap; }
    .bstf-status { background: var(--vs-bg); color: var(--vs-ln); border-top: 1px solid var(--vs-border); padding: 0 10px; height: 24px; gap: 0; font-size: 12px; }
    .bstf-status > span { padding: 0 8px; height: 24px; display: inline-flex; align-items: center; }
    .bstf-status span[data-act]:hover { background: rgba(128,128,128,.2); color: var(--vs-fg); }
    .bstf .cm-keyword, .bstf .cm-atom, .bstf .cm-builtin { color: var(--vs-kw); }
    .bstf .cm-keyword.cm-ctl { color: var(--vs-ctl); }
    .bstf .cm-number { color: var(--vs-num); } .bstf .cm-def { color: var(--vs-fn); } .bstf .cm-variable { color: var(--vs-var); } .bstf .cm-variable-2 { color: var(--vs-var); } .bstf .cm-variable-3, .bstf .cm-type { color: var(--vs-type); }
    .bstf .cm-string, .bstf .cm-string-2 { color: var(--vs-str); } .bstf .cm-meta { color: var(--vs-kw); }
    .bstf .cm-comment { color: var(--vs-com); font-style: normal; }
    .bstf .cm-property, .bstf .cm-attribute, .bstf .cm-qualifier { color: var(--vs-var); }
    .bstf .cm-tag, .bstf .cm-header { color: var(--vs-kw); }
    .bstf .cm-operator, .bstf .cm-bracket { color: var(--vs-op); }
    .bstf .cm-link { color: var(--text-accent); text-decoration: underline; } .bstf .cm-error { color: #f48771; }
    .bstf .CodeMirror-matchingbracket { background: rgba(128,128,128,.3) !important; outline: 1px solid rgba(128,128,128,.6); }
  `;
  document.head.appendChild(css);

  const isBinary = (buf) => { const a = new Uint8Array(buf, 0, Math.min(buf.byteLength, 8000)); for (let i = 0; i < a.length; i++) if (a[i] === 0) return true; return false; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const LINE_COMMENT = { python: "#", shell: "#", yaml: "#", ruby: "#", perl: "#", powershell: "#", toml: "#", properties: "#", dockerfile: "#", r: "#", cmake: "#", nginx: "#", sql: "--", lua: "--", haskell: "--", clike: "//", javascript: "//", go: "//", rust: "//", swift: "//", dart: "//", php: "//", sass: "//", stylus: "//", verilog: "//", d: "//", julia: "#", coffeescript: "#", elixir: "#", erlang: "%", lisp: ";", clojure: ";", scheme: ";", vb: "'", mathematica: "(*", ini: ";" };

  // the full set of CodeMirror language modes (js, ts, python, rust, css, html, sql...) is a separate 560 KB file; load it on first use
  let modesP = null;
  const ensureModes = () => modesP || (modesP = new Promise((res) => {
    if (window.CodeMirror && window.CodeMirror.modes && window.CodeMirror.modes.javascript) return res();
    const sc = document.createElement("script"); sc.src = "lib/codemirror/modes.min.js"; sc.onload = () => res(); sc.onerror = () => res(); document.head.appendChild(sc);
  }));

  function makeView(api) {
    return class TextFileView extends api.ItemView {
      constructor(leaf) { super(leaf); this.path = ""; this.dirty = false; this.marks = []; this.matches = []; }
      getViewType() { return VIEW; }
      getDisplayText() { return this.path ? baseName(this.path) : "Файл"; }
      getIcon() { return "lucide-file-code"; }
      getState() { return { file: this.path }; }
      async setState(state, result) {
        if (state && state.file && state.file !== this.path) { await this.flush(); this.path = state.file; await this.load(); }
        try { this.leaf.updateHeader && this.leaf.updateHeader(); } catch (e) { /* header */ }
        return super.setState ? super.setState(state, result) : undefined;
      }
      async onOpen() { this.contentEl.empty && this.contentEl.empty(); this.contentEl.style.padding = "0"; this.contentEl.style.position = "relative"; this.contentEl.style.overflow = "hidden"; }

      async load() {
        const root = this.contentEl; root.textContent = "";
        const wrap = el("div", "bstf"); root.appendChild(wrap); this.wrap = wrap;
        let text = "";
        try { text = await io.read(this.path); } catch (e) { wrap.appendChild(el("div", "bstf-msg", "Не удалось прочитать файл: " + e.message)); return; }
        this.eol = /\r\n/.test(text) ? "\r\n" : "\n";
        this.lastText = text;

        const bar = el("div", "bstf-bar"); const crumbs = el("span", "bstf-path"); this.shownPath().split(/[\\/]/).forEach((seg, k, arr) => { if (k) crumbs.appendChild(el("i", null, "›")); crumbs.appendChild(el(k === arr.length - 1 ? "b" : "span", null, seg)); }); bar.appendChild(crumbs);
        this.stateEl = el("span", "bstf-state", ""); bar.appendChild(this.stateEl);
        const ext0 = (this.path.split(".").pop() || "").toLowerCase();
        if (!this.runAction) { try { this.runAction = this.addAction("lucide-play", "Запустить файл (F5)", () => this.run()); this.runAction.classList.add("bstf-run-action"); } catch (e) { this.runAction = null; } }
        if (this.runAction) { this.runAction.style.display = RUNNABLE.has(ext0) ? "" : "none"; this.runBtn = RUNNABLE.has(ext0) ? this.runAction : null; }
        const mkBtn = (label, title, fn) => { const b = el("button", "bstf-btn", label); b.title = title; b.addEventListener("click", fn); return b; };
        this.btnFind = mkBtn("Найти", "Найти (Ctrl+F)", () => this.openFind(false));
        this.btnWrap = mkBtn("Перенос", "Переносить длинные строки (Alt+Z)", () => this.setWrap(!this.cm.getOption("lineWrapping")));
                wrap.appendChild(bar);

        const find = this.buildFind(); wrap.appendChild(find);
        const holder = el("div"); holder.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:row;position:relative"; wrap.appendChild(holder);
        const status = el("div", "bstf-status"); this.status = status; wrap.appendChild(status); this.statusEl = status;
        wrap.style.setProperty("--bstf-size", store.get("size", 14) + "px");

        await ensureModes();
        const CM = window.CodeMirror;
        if (!CM) { const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "flex:1;width:100%;background:transparent;color:inherit;border:0;font-family:var(--font-monospace)"; holder.appendChild(ta); this.getText = () => ta.value; ta.addEventListener("input", () => this.touch()); return; }
        let mode = "text/plain", langName = "Текст";
        try { const m = CM.findModeByFileName && CM.findModeByFileName(this.path.split("/").pop()); if (m) { mode = m.mime || m.mode; langName = m.name; } } catch (e) { /* plain */ }
        this.lang = langName;
        const tabs = (text.match(/^\t/gm) || []).length, spaces = (text.match(/^ {2,}/gm) || []).length;
        const useTabs = tabs > spaces;
        const two = (text.match(/^ {2}\S/gm) || []).length, four = (text.match(/^ {4}\S/gm) || []).length;
        const unit = useTabs ? 4 : (four > two * 1.5 ? 4 : 2);
        this.indentLabel = useTabs ? "Табуляция" : "Пробелы: " + unit; this.useTabs = useTabs; this.unit = unit;
        const self = this;
        const dupLine = (cm, down) => { const c = cm.getCursor("head"); if (cm.somethingSelected()) { const t = cm.getSelection(); cm.replaceSelection(t + t, "around"); return; } const l = cm.getLine(c.line); if (down) { cm.replaceRange("\n" + l, { line: c.line, ch: l.length }); cm.setCursor({ line: c.line + 1, ch: c.ch }); } else cm.replaceRange(l + "\n", { line: c.line, ch: 0 }); };
        const cmpP = (a, b) => a.line - b.line || a.ch - b.ch;
        const selNext = (cm) => {
          const sels = cm.listSelections();
          if (!cm.somethingSelected()) { cm.setSelections(sels.map((r) => { const w = cm.findWordAt(r.head); return { anchor: w.anchor, head: w.head }; }), sels.length - 1); return; }
          const last = sels[sels.length - 1], text = cm.getRange(last.from(), last.to()); if (!text || text.includes("\n")) return;
          let cur = cm.getSearchCursor(text, last.to(), { caseFold: false }), ok = cur.findNext(); if (!ok) { cur = cm.getSearchCursor(text, { line: 0, ch: 0 }, { caseFold: false }); ok = cur.findNext(); } if (!ok) return;
          if (sels.some((r) => cmpP(r.from(), cur.from()) === 0)) return;
          cm.setSelections(sels.map((r) => ({ anchor: r.anchor, head: r.head })).concat([{ anchor: cur.from(), head: cur.to() }]), sels.length); cm.scrollIntoView(cur.from(), 80);
        };
        const selAllOcc = (cm) => {
          let text = cm.getSelection(); if (!text) { const w = cm.findWordAt(cm.getCursor()); text = cm.getRange(w.anchor, w.head); } if (!text || text.includes("\n")) return;
          const cur = cm.getSearchCursor(text, { line: 0, ch: 0 }, { caseFold: false }), out = []; while (cur.findNext() && out.length < 5000) out.push({ anchor: cur.from(), head: cur.to() }); if (out.length) cm.setSelections(out, 0);
        };
        const delLine = (cm) => { const a = cm.getCursor("from"), b = cm.getCursor("to"); const end = b.line + 1 < cm.lineCount() ? { line: b.line + 1, ch: 0 } : { line: b.line, ch: cm.getLine(b.line).length }; const start = b.line + 1 < cm.lineCount() ? { line: a.line, ch: 0 } : (a.line > 0 ? { line: a.line - 1, ch: cm.getLine(a.line - 1).length } : { line: 0, ch: 0 }); cm.replaceRange("", start, end); };
        const moveLine = (cm, dir) => { const a = cm.getCursor("from"), b = cm.getCursor("to"); const last = b.ch === 0 && b.line > a.line ? b.line - 1 : b.line; if (dir < 0 && a.line === 0) return; if (dir > 0 && last >= cm.lineCount() - 1) return;
          cm.operation(() => { const block = []; for (let i = a.line; i <= last; i++) block.push(cm.getLine(i)); const sa = cm.getCursor("anchor"), sh = cm.getCursor("head");
            if (dir < 0) { const prev = cm.getLine(a.line - 1); cm.replaceRange(block.join("\n") + "\n" + prev, { line: a.line - 1, ch: 0 }, { line: last, ch: cm.getLine(last).length }); }
            else { const next = cm.getLine(last + 1); cm.replaceRange(next + "\n" + block.join("\n"), { line: a.line, ch: 0 }, { line: last + 1, ch: cm.getLine(last + 1).length }); }
            cm.setSelection({ line: sa.line + dir, ch: sa.ch }, { line: sh.line + dir, ch: sh.ch }); }); };
        const toggleComment = (cm) => {
          const a = cm.getCursor("from"), b = cm.getCursor("to"); const last = b.ch === 0 && b.line > a.line ? b.line - 1 : b.line;
          const m = cm.getModeAt(a); let lc = m.lineComment || LINE_COMMENT[m.name] || LINE_COMMENT[cm.getMode().name]; let bs = m.blockCommentStart, be = m.blockCommentEnd;
          if (!lc && !bs) { if (/\.(bat|cmd)$/i.test(self.path)) lc = "REM"; else return; }
          cm.operation(() => {
            const lines = []; for (let i = a.line; i <= last; i++) lines.push(cm.getLine(i));
            const real = lines.filter((l) => l.trim()); if (!real.length) return;
            const tok = lc || bs; const commented = real.every((l) => l.trim().startsWith(tok));
            const minInd = Math.min(...real.map((l) => l.match(/^\s*/)[0].length));
            lines.forEach((l, i) => { if (!l.trim()) return; const ln = a.line + i; const ind = l.match(/^\s*/)[0].length;
              if (commented) { const rest = l.slice(ind); let r = rest.slice(tok.length); if (r.startsWith(" ")) r = r.slice(1); if (!lc && be && r.trimEnd().endsWith(be)) r = r.trimEnd().slice(0, -be.length).trimEnd(); cm.replaceRange(l.slice(0, ind) + r, { line: ln, ch: 0 }, { line: ln, ch: l.length }); }
              else { const nl = l.slice(0, minInd) + tok + " " + l.slice(minInd) + (!lc && be ? " " + be : ""); cm.replaceRange(nl, { line: ln, ch: 0 }, { line: ln, ch: l.length }); } });
          });
        };
        const zoom = (d) => { const s = d === 0 ? 14 : Math.max(9, Math.min(32, store.get("size", 14) + d)); store.set("size", s); wrap.style.setProperty("--bstf-size", s + "px"); this.cm.refresh(); };
        const goLine = () => { if (window.__bsQuick) window.__bsQuick.open(":"); };
        this.cm = CM(holder, {
          value: text, mode, theme: "basalt", lineNumbers: true, lineWrapping: store.get("wrap", false), indentUnit: unit, tabSize: unit, indentWithTabs: useTabs,
          styleActiveLine: true, matchBrackets: true, configureMouse: (cm, repeat, ev) => ({ addNew: ev.altKey }), autoCloseBrackets: true, scrollPastEnd: true, smartIndent: true, electricChars: true,
          lineSeparator: this.eol === "\r\n" ? "\r\n" : null, foldGutter: true, gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
          foldOptions: { rangeFinder: CM.fold && CM.fold.auto ? CM.fold.auto : undefined },
          extraKeys: {
            "Ctrl-S": () => this.flush(), "Cmd-S": () => this.flush(),
            "Ctrl-F": () => this.openFind(false), "Cmd-F": () => this.openFind(false), "Ctrl-H": () => this.openFind(true),
            "F3": () => this.step(1), "Shift-F3": () => this.step(-1), "Ctrl-G": goLine,
            "Ctrl-/": toggleComment, "Cmd-/": toggleComment, "Ctrl-D": selNext, "Shift-Ctrl-L": selAllOcc, "Shift-Alt-Down": (cm) => dupLine(cm, true), "Shift-Alt-Up": (cm) => dupLine(cm, false), "Shift-Ctrl-K": delLine,
            "Alt-Up": (cm) => moveLine(cm, -1), "Alt-Down": (cm) => moveLine(cm, 1), "Alt-Z": () => this.setWrap(!this.cm.getOption("lineWrapping")),
            "Ctrl-]": (cm) => cm.indentSelection("add"), "Ctrl-[": (cm) => cm.indentSelection("subtract"),
            "Ctrl-=": () => zoom(1), "Ctrl-Minus": () => zoom(-1), "Ctrl-0": () => zoom(0),
            "Ctrl-Alt-[": (cm) => cm.foldCode(cm.getCursor()), "Shift-Ctrl-[": (cm) => cm.foldCode(cm.getCursor()), "Shift-Ctrl-]": (cm) => cm.foldCode(cm.getCursor(), null, "unfold"),
            Tab: (cm) => { if (cm.somethingSelected()) cm.indentSelection("add"); else if (useTabs) cm.replaceSelection("\t", "end"); else cm.replaceSelection(" ".repeat(unit - (cm.getCursor().ch % unit)), "end"); },
            "Shift-Tab": (cm) => cm.indentSelection("subtract"),
          },
        });
        this.getText = () => { const t = this.cm.getValue().replace(/\r\n/g, "\n"); return this.eol === "\r\n" ? t.replace(/\n/g, "\r\n") : t; };
        this.cm.on("change", () => { this.touch(); this.scheduleMarks(); });
        this.cm.on("renderLine", (cm, line, elt) => {
          const m = /^[ \t]+/.exec(line.text); if (!m) return; const cols = CM.countColumn(m[0], null, cm.getOption("tabSize"));
          if (cm.getOption("lineWrapping")) { const off = cols * cm.defaultCharWidth(); elt.style.textIndent = "-" + off + "px"; elt.style.paddingLeft = (6 + off) + "px"; }
          if (cols < unit) return;
          elt.style.backgroundImage = "repeating-linear-gradient(90deg, var(--vs-guide) 0 1px, transparent 1px " + unit + "ch)"; elt.style.backgroundSize = cols + "ch 100%"; elt.style.backgroundRepeat = "no-repeat"; elt.style.backgroundPosition = "6px 0";
        });
        let hm = [], ht = 0; const clearHM = () => { hm.forEach((x) => x.clear()); hm = []; };
        this.cm.on("cursorActivity", (cm) => { clearTimeout(ht); ht = setTimeout(() => {
          clearHM(); if (cm.listSelections().length > 1) return; const sel = cm.getSelection(); if (!sel || sel.length < 2 || sel.length > 80 || /\s/.test(sel)) return;
          const cur = cm.getSearchCursor(sel, { line: 0, ch: 0 }, { caseFold: false }), at = cm.getCursor("from"); let n = 0;
          cm.operation(() => { while (cur.findNext() && n < 400) { n++; if (cmpP(cur.from(), at) === 0) continue; hm.push(cm.markText(cur.from(), cur.to(), { className: "bstf-selmatch" })); } });
        }, 200); });
        this.cm.getWrapperElement().addEventListener("contextmenu", (e) => {
          e.preventDefault(); const M = api.Menu; if (!M) return; const cm = this.cm, m = new M(), has = cm.somethingSelected();
          const it = (t, ic, fn, off) => m.addItem((i) => { i.setTitle(t).setIcon(ic).onClick(fn); if (off) i.setDisabled(true); });
          it("Вырезать", "lucide-scissors", () => { navigator.clipboard.writeText(cm.getSelection()); cm.replaceSelection(""); }, !has);
          it("Копировать", "lucide-copy", () => navigator.clipboard.writeText(cm.getSelection()), !has);
          it("Вставить", "lucide-clipboard-paste", () => navigator.clipboard.readText().then((t) => cm.replaceSelection(t)));
          it("Выделить всё", "lucide-text-select", () => cm.execCommand("selectAll"));
          m.addSeparator(); it("Найти…", "lucide-search", () => this.openFind(false)); it("Заменить…", "lucide-replace", () => this.openFind(true)); it("Закомментировать / раскомментировать", "lucide-message-square", () => toggleComment(cm));
          if (this.runBtn) { m.addSeparator(); it("Запустить файл", "lucide-play", () => this.run()); }
          m.showAtMouseEvent(e);
        });
        this.cm.on("cursorActivity", () => this.updateStatus());
        this.cm.getWrapperElement().addEventListener("wheel", (e) => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
        this.btnWrap.classList.toggle("on", !!this.cm.getOption("lineWrapping"));
        this.buildMinimap(holder); this.buildPanel(wrap, status); this.buildStatus(); this.bindRunKeys(); this.setWrap(!!this.cm.getOption("lineWrapping"));
        this.updateStatus();
        this.registerEvent(app.vault.on("modify", (f) => this.external(f)));
        setTimeout(() => this.cm && this.cm.refresh(), 50);
      }

      shownPath() {
        const W = window.__bsWorkspace; if (isAbs(this.path)) { const r = W && W.active && W.active() && W.root(); if (r && this.path.toLowerCase().startsWith(r.toLowerCase())) return npath.basename(r) + this.path.slice(r.length).replace(/\\/g, "/"); return this.path.replace(/\\/g, "/"); }
        return this.path;
      }
      // ---- terminal under the editor + run ----
      buildPanel(wrap, status) {
        const p = el("div", "bstf-term"); p.style.display = "none"; p.style.height = store.get("termH", 260) + "px";
        const grip = el("div", "bstf-term-grip"), head = el("div", "bstf-term-head"), body = el("div", "bstf-term-body");
        const hb = (t, title, fn) => { const b = el("button", "bstf-btn", t); b.title = title; b.addEventListener("click", fn); return b; };
        head.append(el("span", null, "Терминал"), el("span", "sp"), hb("+", "Новая сессия", () => this.restartTerm()), hb("✕", "Закрыть терминал", () => this.killTerm()));
        p.append(grip, head, body); wrap.insertBefore(p, status); this.tpanel = p; this.tbody = body;
        let sy = 0, sh = 0, drag = false;
        grip.addEventListener("pointerdown", (e) => { drag = true; sy = e.clientY; sh = p.offsetHeight; grip.setPointerCapture(e.pointerId); });
        grip.addEventListener("pointermove", (e) => { if (!drag) return; const h = Math.max(100, Math.min(wrap.clientHeight - 160, sh + sy - e.clientY)); p.style.height = h + "px"; });
        grip.addEventListener("pointerup", () => { if (drag) { drag = false; store.set("termH", p.offsetHeight); this.cm.refresh(); this.drawMini(); } });
      }
      async openTerm(focus) {
        this.tpanel.style.display = "flex";
        if (!this.tt) {
          const T = window.__basaltTerm; this.tbody.textContent = "";
          if (!T || !T.ready()) { this.tbody.appendChild(el("div", "bstf-msg", "Терминал недоступен")); return null; }
          try { this.tt = await T.create(this.tbody, { cwd: npath.dirname(io.abs(this.path)), onExit: () => { this.tt = null; } }); } catch (e) { this.tbody.appendChild(el("div", "bstf-msg", "Терминал недоступен: " + e.message)); return null; }
        }
        if (focus !== false) this.tt.focus(); this.cm.refresh(); this.drawMini(); return this.tt;
      }
      async toggleTerm() { if (this.tpanel.style.display === "none") await this.openTerm(true); else { this.tpanel.style.display = "none"; this.cm.refresh(); this.cm.focus(); this.drawMini(); } }
      killTerm() { if (this.tt) { try { this.tt.dispose(); } catch (e) { /* gone */ } this.tt = null; } this.tbody.textContent = ""; this.tpanel.style.display = "none"; this.cm.refresh(); this.cm.focus(); this.drawMini(); }
      async restartTerm() { if (this.tt) { try { this.tt.dispose(); } catch (e) { /* gone */ } this.tt = null; } await this.openTerm(true); }
      runCommand() {
        const f = io.abs(this.path), dir = npath.dirname(f), ext = (f.split(".").pop() || "").toLowerCase(), q = '"' + f + '"';
        const up = (name) => { let d = dir; for (let i = 0; i < 8; i++) { const c = npath.join(d, name); if (nfs.existsSync(c)) return c; const n = npath.dirname(d); if (n === d) break; d = n; } return null; };
        switch (ext) {
          case "js": case "mjs": case "cjs": return "node " + q;
          case "ts": return "npx -y tsx " + q;
          case "py": return (has("python") ? "python " : has("py") ? "py -3 " : "python3 ") + q;
          case "rs": { const c = up("Cargo.toml"); return c ? 'cargo run --manifest-path "' + c + '"' : null; }
          case "go": return "go run " + q;
          case "java": return "java " + q;
          case "dart": return "dart run " + q;
          case "rb": return "ruby " + q;
          case "php": return "php " + q;
          case "lua": return "lua " + q;
          case "sh": return "bash " + q;
          case "bat": case "cmd": return "cmd /c " + q;
          case "ps1": return "powershell -NoProfile -ExecutionPolicy Bypass -File " + q;
          default: return null;
        }
      }
      async run() {
        const ext = (this.path.split(".").pop() || "").toLowerCase();
        await this.flush();
        if (ext === "html" || ext === "htm") { try { (window.electron || window.require("electron")).shell.openPath(io.abs(this.path)); } catch (e) { /* no shell */ } return; }
        const cmd = this.runCommand();
        if (!cmd) { new api.Notice(ext === "rs" ? "Для запуска Rust нужен Cargo.toml в папке проекта" : "Для этого типа файлов запуск не настроен"); return; }
        const t = await this.openTerm(false); if (!t) return;
        t.term.input(cmd + "\r", true); t.focus();
      }
      bindRunKeys() {
        this.cm.on("keydown", (cm, e) => {
          if (e.key === "F5" && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); e.codemirrorIgnore = true; if (this.runBtn) this.run(); return; }
          if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "`" || e.code === "Backquote")) { e.preventDefault(); e.stopPropagation(); e.codemirrorIgnore = true; this.toggleTerm(); }
        });
      }
      // ---- minimap (code overview on the right, as in VS Code) ----
      buildMinimap(holder) {
        const W = 92, box = el("div", "bstf-mini"), cv = document.createElement("canvas"), slider = el("div", "bstf-mini-slider"); box.style.width = W + "px"; box.append(cv, slider); holder.appendChild(box);
        this.mini = { box, cv, slider, W }; let drag = false;
        const scrollTo = (clientY) => { const m = this.miniMetrics(), r = box.getBoundingClientRect(), frac = (clientY - r.top + m.off) / Math.max(1, m.docH); this.cm.scrollTo(null, frac * m.info.height - m.info.clientHeight / 2); };
        box.addEventListener("pointerdown", (e) => { drag = true; box.setPointerCapture(e.pointerId); scrollTo(e.clientY); });
        box.addEventListener("pointermove", (e) => { if (drag) scrollTo(e.clientY); });
        box.addEventListener("pointerup", () => { drag = false; }); box.addEventListener("pointercancel", () => { drag = false; });
        this.cm.on("scroll", () => this.drawMini()); this.cm.on("change", () => this.drawMini());
        this.miniRO = new ResizeObserver(() => this.drawMini()); this.miniRO.observe(box);
        setTimeout(() => this.drawMini(), 80);
      }
      miniMetrics() {
        const cm = this.cm, lines = cm.lineCount(), rowH = 2, H = this.mini.box.clientHeight, docH = lines * rowH, info = cm.getScrollInfo();
        const frac = info.height > info.clientHeight ? info.top / (info.height - info.clientHeight) : 0;
        return { lines, rowH, H, docH, info, off: docH > H ? frac * (docH - H) : 0 };
      }
      drawMini() {
        if (this.miniRaf) return;
        this.miniRaf = requestAnimationFrame(() => {
          this.miniRaf = 0; const mi = this.mini; if (!mi || !this.cm || !this.wrap || !this.wrap.isConnected) return;
          const m = this.miniMetrics(); if (m.H < 10) return; const d = window.devicePixelRatio || 1, cv = mi.cv, W = mi.W;
          if (cv.width !== Math.round(W * d) || cv.height !== Math.round(m.H * d)) { cv.width = Math.round(W * d); cv.height = Math.round(m.H * d); cv.style.width = W + "px"; cv.style.height = m.H + "px"; }
          const ctx = cv.getContext("2d"); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, m.H);
          const cs = getComputedStyle(this.wrap), c = (n) => cs.getPropertyValue(n).trim(), pal = { kw: c("--vs-kw"), str: c("--vs-str"), com: c("--vs-com"), num: c("--vs-num"), fn: c("--vs-fn"), vr: c("--vs-var"), fg: c("--vs-fg"), ty: c("--vs-type") };
          const colour = (t) => !t ? pal.fg : t.includes("comment") ? pal.com : t.includes("string") ? pal.str : t.includes("number") ? pal.num : t.includes("keyword") || t.includes("atom") || t.includes("builtin") || t.includes("tag") || t.includes("header") ? pal.kw : t.includes("def") ? pal.fn : t.includes("variable-3") || t.includes("type") ? pal.ty : t.includes("variable") || t.includes("property") || t.includes("attribute") ? pal.vr : pal.fg;
          const first = Math.max(0, Math.floor(m.off / m.rowH)), last = Math.min(m.lines - 1, Math.ceil((m.off + m.H) / m.rowH));
          ctx.globalAlpha = .75;
          for (let i = first; i <= last; i++) { const y = i * m.rowH - m.off; for (const t of this.cm.getLineTokens(i)) { if (!t.string.trim()) continue; const w = Math.min(W - 4 - t.start, t.end - t.start); if (w <= 0) continue; ctx.fillStyle = colour(t.type); ctx.fillRect(2 + t.start, y, w, 1.4); } }
          ctx.globalAlpha = 1;
          const top = (m.info.top / m.info.height) * m.docH - m.off, h = Math.max(10, (m.info.clientHeight / m.info.height) * m.docH); mi.slider.style.top = Math.max(0, top) + "px"; mi.slider.style.height = Math.min(m.H, h) + "px";
        });
      }
      buildStatus() {
        const s = this.status; s.textContent = "";
        this.stPos = el("span"); this.stSel = el("span");
        const sp = el("span", "sp"); const mk = (t) => el("span", null, t);
        this.stWrap = mk(""); this.stWrap.dataset.act = "wrap"; this.stWrap.title = "Перенос длинных строк (Alt+Z)"; this.stWrap.addEventListener("click", () => this.setWrap(!this.cm.getOption("lineWrapping")));
        this.stTerm = mk("Терминал"); this.stTerm.dataset.act = "term"; this.stTerm.title = "Терминал под редактором (Ctrl+`)"; this.stTerm.addEventListener("click", () => this.toggleTerm());
        this.stIndent = mk(this.indentLabel); this.stIndent.dataset.act = "indent"; this.stIndent.title = "Отступы"; this.stIndent.addEventListener("click", (e) => this.indentMenu(e));
        this.stEol = mk(this.eol === "\r\n" ? "CRLF" : "LF"); this.stEol.dataset.act = "eol"; this.stEol.title = "Окончания строк: нажмите, чтобы переключить LF / CRLF"; this.stEol.addEventListener("click", () => { this.eol = this.eol === "\r\n" ? "\n" : "\r\n"; this.stEol.textContent = this.eol === "\r\n" ? "CRLF" : "LF"; this.touch(); });
        this.stLang = mk(this.lang); this.stLang.dataset.act = "lang"; this.stLang.title = "Язык подсветки"; this.stLang.addEventListener("click", (e) => this.langMenu(e));
        s.append(this.stPos, this.stSel, sp, this.stTerm, this.stWrap, this.stIndent, this.stEol, mk("UTF-8"), this.stLang);
        const lines = el("span"); this.stLines = lines; s.insertBefore(lines, sp);
        const goto = this.stPos; goto.dataset.act = "goto"; goto.title = "Перейти к строке (Ctrl+G)"; goto.addEventListener("click", () => { if (window.__bsQuick) window.__bsQuick.open(":"); });
      }
      langMenu(e) {
        const M = api.Menu; if (!M) return; const m = new M(), CM = window.CodeMirror;
        const L = [["Простой текст", "text/plain"], ["JavaScript", "text/javascript"], ["TypeScript", "text/typescript"], ["Python", "text/x-python"], ["Rust", "text/x-rustsrc"], ["Go", "text/x-go"], ["Java", "text/x-java"], ["C", "text/x-csrc"], ["C++", "text/x-c++src"], ["C#", "text/x-csharp"], ["Kotlin", "text/x-kotlin"], ["Swift", "text/x-swift"], ["Dart", "application/dart"], ["HTML", "text/html"], ["CSS", "text/css"], ["JSON", "application/json"], ["YAML", "text/x-yaml"], ["XML", "application/xml"], ["Markdown", "text/x-markdown"], ["Shell", "text/x-sh"], ["SQL", "text/x-sql"], ["Ruby", "text/x-ruby"], ["PHP", "application/x-httpd-php"], ["Lua", "text/x-lua"]];
        for (const [name, mime] of L) m.addItem((i) => { i.setTitle(name).onClick(() => { this.cm.setOption("mode", mime); this.lang = name; this.stLang.textContent = name; if (i.setChecked) i.setChecked(false); this.drawMini(); }); if (name === this.lang) i.setChecked(true); });
        m.showAtMouseEvent(e);
      }
      indentMenu(e) {
        const M = api.Menu; if (!M) return; const m = new M(), cm = this.cm;
        const set = (tabs, n) => { this.useTabs = tabs; this.unit = n; cm.setOption("indentUnit", n); cm.setOption("tabSize", n); cm.setOption("indentWithTabs", tabs); this.indentLabel = tabs ? "Табуляция" : "Пробелы: " + n; this.stIndent.textContent = this.indentLabel; cm.refresh(); };
        for (const n of [2, 4, 8]) m.addItem((i) => { i.setTitle("Пробелы: " + n).onClick(() => set(false, n)); if (!this.useTabs && this.unit === n) i.setChecked(true); });
        m.addItem((i) => { i.setTitle("Табуляция").onClick(() => set(true, cm.getOption("tabSize") || 4)); if (this.useTabs) i.setChecked(true); });
        m.addSeparator();
        m.addItem((i) => i.setTitle("Преобразовать отступы в пробелы").onClick(() => { cm.operation(() => { for (let l = 0; l < cm.lineCount(); l++) { const t = cm.getLine(l), mm = /^\t+/.exec(t); if (mm) cm.replaceRange(" ".repeat(mm[0].length * this.unit), { line: l, ch: 0 }, { line: l, ch: mm[0].length }); } }); }));
        m.addItem((i) => i.setTitle("Преобразовать отступы в табуляцию").onClick(() => { cm.operation(() => { for (let l = 0; l < cm.lineCount(); l++) { const t = cm.getLine(l), mm = /^ +/.exec(t); if (mm) { const n = Math.floor(mm[0].length / this.unit); if (n) cm.replaceRange("\t".repeat(n) + " ".repeat(mm[0].length - n * this.unit), { line: l, ch: 0 }, { line: l, ch: mm[0].length }); } } }); }));
        m.showAtMouseEvent(e);
      }
      updateStatus() {
        if (!this.cm || !this.stPos) return;
        const c = this.cm.getCursor();
        this.stPos.textContent = "Строка " + (c.line + 1) + ", столбец " + (c.ch + 1);
        const sel = this.cm.getSelection(); this.stSel.textContent = sel ? "Выделено: " + sel.length : "";
        this.stLines.textContent = this.cm.lineCount() + " стр.";
      }
      setWrap(on) { store.set("wrap", on); this.cm.setOption("lineWrapping", on); this.btnWrap.classList.toggle("on", on); if (this.stWrap) this.stWrap.textContent = on ? "Перенос: вкл" : "Перенос: выкл"; this.cm.refresh(); }

      // ---- find / replace ----
      buildFind() {
        const box = el("div", "bstf-find"); this.findBox = box;
        const r1 = el("div", "bstf-row"), r2 = el("div", "bstf-row rep");
        const q = el("input", "bstf-in"); q.placeholder = "Найти"; const rp = el("input", "bstf-in"); rp.placeholder = "Заменить на";
        this.qIn = q; this.rIn = rp; this.optCase = false; this.optRe = false; this.optWord = false;
        const btn = (label, title, fn, cls) => { const b = el("button", "bstf-btn" + (cls ? " " + cls : ""), label); b.title = title; b.addEventListener("click", fn); return b; };
        const tog = (label, title, key) => { const b = btn(label, title, () => { this[key] = !this[key]; b.classList.toggle("on", this[key]); this.refreshMatches(true); }); return b; };
        this.count = el("span", "bstf-count");
        r1.append(q, tog("Аа", "Учитывать регистр", "optCase"), tog(".*", "Регулярное выражение", "optRe"), tog("«слово»", "Слово целиком", "optWord"), btn("↑", "Предыдущее (Shift+F3)", () => this.step(-1)), btn("↓", "Следующее (F3 / Enter)", () => this.step(1)), this.count,
          btn("Заменить…", "Показать замену (Ctrl+H)", () => { box.classList.toggle("replace"); if (box.classList.contains("replace")) rp.focus(); }), btn("✕", "Закрыть (Esc)", () => this.closeFind()));
        r2.append(rp, btn("Заменить", "Заменить текущее", () => this.replaceOne()), btn("Заменить все", "Заменить все совпадения", () => this.replaceAll()));
        box.append(r1, r2);
        q.addEventListener("input", () => this.refreshMatches(true));
        q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); } else if (e.key === "Escape") { e.preventDefault(); this.closeFind(); } });
        rp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.replaceOne(); } else if (e.key === "Escape") { e.preventDefault(); this.closeFind(); } });
        return box;
      }
      openFind(replace) {
        this.findBox.classList.add("open"); this.btnFind.classList.add("on");
        if (replace) this.findBox.classList.add("replace");
        const sel = this.cm.getSelection(); if (sel && !sel.includes("\n")) this.qIn.value = sel;
        this.qIn.focus(); this.qIn.select(); this.refreshMatches(false);
        this.cm.refresh();
      }
      closeFind() { this.findBox.classList.remove("open"); this.btnFind.classList.remove("on"); this.clearMarks(); this.cm.focus(); this.cm.refresh(); }
      clearMarks() { this.marks.forEach((m) => m.clear()); this.marks = []; if (this.curMark) { this.curMark.clear(); this.curMark = null; } }
      query() {
        const s = this.qIn.value; if (!s) return null;
        let src = this.optRe ? s : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (this.optWord) src = "\\b(?:" + src + ")\\b";
        try { const re = new RegExp(src, this.optCase ? "" : "i"); this.qIn.classList.remove("bad"); return re; } catch (e) { this.qIn.classList.add("bad"); return null; }
      }
      scheduleMarks() { if (!this.findBox || !this.findBox.classList.contains("open")) return; clearTimeout(this.mt); this.mt = setTimeout(() => this.refreshMatches(false), 200); }
      refreshMatches(jump) {
        this.clearMarks(); this.matches = []; const re = this.query();
        if (!re) { this.count.textContent = this.qIn.value ? "—" : ""; return; }
        const cm = this.cm, cur = cm.getSearchCursor(re, { line: 0, ch: 0 });
        cm.operation(() => { let n = 0; while (cur.findNext() && n < 5000) { n++; const f = cur.from(), t = cur.to(); if (f.line === t.line && f.ch === t.ch) { if (t.ch >= cm.getLine(t.line).length && t.line >= cm.lastLine()) break; continue; } this.matches.push({ from: f, to: t }); this.marks.push(cm.markText(f, t, { className: "bstf-match" })); } });
        if (jump) this.step(0); else this.showCount();
      }
      showCount() {
        const n = this.matches.length; if (!this.qIn.value) { this.count.textContent = ""; return; }
        if (!n) { this.count.textContent = "Нет совпадений"; return; }
        const c = this.cm.getCursor("from"); let idx = this.matches.findIndex((m) => m.from.line === c.line && m.from.ch === c.ch);
        this.count.textContent = (idx >= 0 ? idx + 1 : "?") + " из " + n + (n >= 5000 ? "+" : "");
      }
      step(dir) {
        if (!this.matches.length) { if (this.findBox.classList.contains("open")) this.showCount(); else this.openFind(false); return; }
        const cm = this.cm, from = cm.getCursor("from"), to = cm.getCursor("to"); let idx;
        const cmp = (a, b) => a.line - b.line || a.ch - b.ch;
        if (dir > 0) idx = this.matches.findIndex((m) => cmp(m.from, to) >= 0 && !(cmp(m.from, from) === 0 && cmp(m.to, to) === 0 && cm.somethingSelected()) ? true : (cmp(m.from, to) > 0));
        else if (dir < 0) { idx = -1; for (let i = this.matches.length - 1; i >= 0; i--) if (cmp(this.matches[i].from, from) < 0) { idx = i; break; } if (idx < 0) idx = this.matches.length - 1; }
        else idx = Math.max(0, this.matches.findIndex((m) => cmp(m.from, from) >= 0));
        if (idx < 0) idx = 0;
        const m = this.matches[idx]; cm.setSelection(m.from, m.to); cm.scrollIntoView({ from: m.from, to: m.to }, 80);
        if (this.curMark) this.curMark.clear(); this.curMark = cm.markText(m.from, m.to, { className: "bstf-cur" });
        this.count.textContent = (idx + 1) + " из " + this.matches.length + (this.matches.length >= 5000 ? "+" : "");
      }
      expand(re, text, rep) { if (!this.optRe) return rep; try { return text.replace(new RegExp(re.source, re.flags.replace("g", "")), rep); } catch (e) { return rep; } }
      replaceOne() {
        const re = this.query(); if (!re) return; const cm = this.cm, rep = this.rIn.value;
        const f = cm.getCursor("from"), t = cm.getCursor("to"); const hit = this.matches.find((m) => m.from.line === f.line && m.from.ch === f.ch && m.to.line === t.line && m.to.ch === t.ch);
        if (hit) { const old = cm.getRange(f, t); cm.replaceRange(this.expand(re, old, rep), f, t); this.refreshMatches(false); this.step(1); }
        else this.step(1);
      }
      replaceAll() {
        const re = this.query(); if (!re || !this.matches.length) return; const rep = this.rIn.value, cm = this.cm, list = this.matches.slice(), n = list.length;
        cm.operation(() => { for (let i = list.length - 1; i >= 0; i--) { const m = list[i]; cm.replaceRange(this.expand(re, cm.getRange(m.from, m.to), rep), m.from, m.to); } });
        this.refreshMatches(false); this.count.textContent = "Заменено: " + n;
      }

      // ---- saving ----
      touch() {
        this.dirty = true; if (this.stateEl) this.stateEl.textContent = "● Не сохранено";
        clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 800);
      }
      async flush() {
        clearTimeout(this.timer);
        if (!this.dirty || !this.getText) return;
        this.dirty = false;
        const text = this.getText();
        try { this.lastText = text; await io.write(this.path, text); if (this.stateEl) this.stateEl.textContent = ""; }
        catch (e) { this.dirty = true; if (this.stateEl) this.stateEl.textContent = "Ошибка сохранения"; console.error("[basalt-textfile]", e); }
      }
      async reload() {
        if (this.dirty || !this.cm) return;
        try { const text = await io.read(this.path); if (text === this.lastText || this.dirty) return; this.lastText = text; const cur = this.cm.getCursor(), sc = this.cm.getScrollInfo(); this.cm.setValue(text); this.dirty = false; if (this.stateEl) this.stateEl.textContent = ""; this.cm.setCursor(cur); this.cm.scrollTo(sc.left, sc.top); } catch (e) { /* gone */ }
      }
      async external(f) {
        if (!f || isAbs(this.path) || f.path !== this.path || this.dirty || !this.cm) return;
        try {
          const text = await io.read(this.path);
          if (text === this.lastText || this.dirty) return;
          this.lastText = text; const cur = this.cm.getCursor(), sc = this.cm.getScrollInfo();
          this.cm.setValue(text); this.dirty = false; if (this.stateEl) this.stateEl.textContent = "";
          this.cm.setCursor(cur); this.cm.scrollTo(sc.left, sc.top);
        } catch (e) { /* file gone */ }
      }
      onResize() { try { this.cm && this.cm.refresh(); this.drawMini && this.drawMini(); } catch (e) { /* hidden */ } }
      async onClose() { if (this.miniRO) this.miniRO.disconnect(); if (this.tt) { try { this.tt.dispose(); } catch (e) { /* gone */ } this.tt = null; } await this.flush(); }
    };
  }

  function jump(path, line) {
    let n = 0; const t = setInterval(() => {
      const l = app.workspace.getLeavesOfType(VIEW).find((x) => x.view && x.view.path === path && x.view.cm);
      if (l) { clearInterval(t); const cm = l.view.cm, at = { line: Math.max(0, line - 1), ch: 0 }; cm.setCursor(at); cm.scrollIntoView(at, 200); cm.focus(); } else if (++n > 40) clearInterval(t);
    }, 100);
  }
  async function open(path, line) {
    const ws = app.workspace;
    const same = ws.getLeavesOfType(VIEW).find((l) => l.view && l.view.path === path);
    if (same) { ws.revealLeaf(same); ws.setActiveLeaf(same, { focus: true }); if (line) jump(path, line); return true; }
    const leaf = ws.getLeaf("tab");
    await leaf.setViewState({ type: VIEW, active: true, state: { file: path } });
    ws.setActiveLeaf(leaf, { focus: true });
    if (line) jump(path, line);
    return true;
  }

  async function openAbs(abs, line) {
    try {
      const st = await nfs.promises.stat(abs); if (!st.isFile() || st.size > MAX) return false;
      const fd = await nfs.promises.open(abs, "r"), b = Buffer.alloc(Math.min(8000, st.size)); await fd.read(b, 0, b.length, 0); await fd.close();
      for (let i = 0; i < b.length; i++) if (b[i] === 0) return false;
    } catch (e) { return false; }
    return open(abs, line);
  }
  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.viewRegistry || !app.vault || !app.vault.adapter || !window.__bsApi || !window.__bsApi.ItemView || typeof app.openWithDefaultApp !== "function") return;
    clearInterval(t);
    const V = makeView(window.__bsApi), creator = (leaf) => new V(leaf);
    try { app.viewRegistry.registerView(VIEW, creator); } catch (e) { app.viewRegistry.viewByType[VIEW] = creator; }
    const orig = app.openWithDefaultApp.bind(app);
    app.openWithDefaultApp = async function (path) {
      try {
        const a = app.vault.adapter, st = await a.stat(path);
        if (st && st.type === "file" && st.size <= MAX) {
          const buf = await a.readBinary(path);
          if (!isBinary(buf)) return await open(path);
        }
      } catch (e) { console.error("[basalt-textfile]", e); }
      return orig(path);
    };
    // the app's own status bar (word count, sync) lies over the editor's status bar: hide it while a code file is in front
    const st = document.createElement("style"); st.textContent = "body.bs-code-front .status-bar { display: none !important; }"; document.head.appendChild(st);
    const front = () => { const l = app.workspace.activeLeaf, t = l && l.view && l.view.getViewType && l.view.getViewType(); document.body.classList.toggle("bs-code-front", t === VIEW); };
    app.workspace.on("active-leaf-change", front); app.workspace.on("layout-change", front); front();
    window.__bsTextFile = { open, openAbs };
    app.commands.addCommand({ id: "basalt:run-file", name: "Запустить текущий файл", checkCallback: (c) => { const l = app.workspace.activeLeaf, v = l && l.view; if (!v || v.getViewType() !== VIEW || !v.runBtn) return false; if (!c) v.run(); return true; } });
    app.commands.addCommand({ id: "basalt:editor-terminal", name: "Терминал под редактором: показать / скрыть", checkCallback: (c) => { const l = app.workspace.activeLeaf, v = l && l.view; if (!v || v.getViewType() !== VIEW) return false; if (!c) v.toggleTerm(); return true; } });
  }, 500);
})();
