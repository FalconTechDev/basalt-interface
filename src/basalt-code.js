// Basalt: runnable code blocks and an embedded terminal.
//  - any rendered code block (reading view, canvas text cards, embeds) in js / python / shell / rust gets a Run button; the output appears under the block
//  - a ```basalt-terminal block turns into a small terminal (one command at a time, working directory kept)
//  - command "Запустить блок кода под курсором" works in the editor and writes the output under the block as a ```output block
// Code runs in a separate process: its own temporary folder as the working directory, a stripped environment, a time limit and an output limit.
// That is isolation of the process, not a security sandbox: the code can still reach what your user account can reach.
(() => {
  "use strict";
  const lk = (e) => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : String(e.key).toLowerCase()); // the letter of the key, whatever layout (Russian too)

  if (typeof window.require !== "function") return;
  const cp = window.require("child_process"), fs = window.require("fs"), os = window.require("os"), path = window.require("path");
  const WIN = process.platform === "win32";
  const LIMIT_MS = 15000, LIMIT_BYTES = 200 * 1024;

  const LANGS = {
    js: ["js", "javascript", "node", "mjs"], python: ["py", "python", "python3"], shell: ["sh", "bash", "shell", "zsh", "powershell", "ps1", "pwsh", "cmd", "bat"], rust: ["rs", "rust"],
  };
  const langOf = (name) => { name = (name || "").toLowerCase(); for (const [k, v] of Object.entries(LANGS)) if (v.includes(name)) return k; return null; };
  const LABEL = { js: "JavaScript", python: "Python", shell: "Shell", rust: "Rust" };

  const cleanEnv = (extra = {}) => {
    const keep = ["PATH", "Path", "SystemRoot", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "APPDATA", "LOCALAPPDATA", "ProgramFiles", "ProgramData"];
    const env = {};
    for (const k of keep) if (process.env[k] != null) env[k] = process.env[k];
    return Object.assign(env, extra);
  };
  const killTree = (child) => { try { if (WIN) cp.spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); else child.kill("SIGKILL"); } catch (e) { /* gone */ } };

  // runs one process, streams output via onData(kind, text); resolves { code, ms, timedOut, truncated }
  function spawnLimited(cmd, args, opts, onData, handle) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      let child, bytes = 0, truncated = false, timedOut = false;
      try { child = cp.spawn(cmd, args, Object.assign({ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }, opts)); }
      catch (e) { onData("err", `не удалось запустить ${cmd}: ${e.message}\n`); return resolve({ code: -1, ms: 0 }); }
      if (handle) handle.child = child;
      const timer = setTimeout(() => { timedOut = true; killTree(child); }, opts.limitMs || LIMIT_MS);
      const feed = (kind) => (d) => {
        if (truncated) return;
        bytes += d.length;
        if (bytes > LIMIT_BYTES) { truncated = true; onData("err", "\n… вывод обрезан (больше 200 КБ)\n"); killTree(child); return; }
        onData(kind, new TextDecoder("utf-8").decode(d));
      };
      child.stdout.on("data", feed("out")); child.stderr.on("data", feed("err"));
      child.on("error", (e) => { onData("err", e.code === "ENOENT" ? `не найдено: ${cmd}\n` : `${e.message}\n`); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ code: code == null ? -1 : code, ms: Date.now() - t0, timedOut, truncated }); });
    });
  }

  const which = (names) => new Promise((resolve) => {
    const probe = (i) => {
      if (i >= names.length) return resolve(null);
      const [cmd, ...args] = names[i];
      const c = cp.spawn(cmd, [...args, "--version"], { windowsHide: true, stdio: "ignore" });
      c.on("error", () => probe(i + 1)); c.on("close", (code) => (code === 0 || code === null ? resolve(names[i]) : probe(i + 1)));
    };
    probe(0);
  });

  async function runCode(lang, code, onData, handle) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-run-"));
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* in use */ } };
    try {
      const opts = { cwd: dir, env: cleanEnv() };
      if (lang === "js") {
        const f = path.join(dir, "main.js"); fs.writeFileSync(f, code);
        return await spawnLimited(process.execPath, [f], Object.assign({}, opts, { env: cleanEnv({ ELECTRON_RUN_AS_NODE: "1" }) }), onData, handle);
      }
      if (lang === "python") {
        const f = path.join(dir, "main.py"); fs.writeFileSync(f, code);
        const py = await which(WIN ? [["python"], ["py", "-3"], ["python3"]] : [["python3"], ["python"]]);
        if (!py) { onData("err", "Python не найден в PATH. Установите Python и перезапустите Basalt.\n"); return { code: -1, ms: 0 }; }
        return await spawnLimited(py[0], [...py.slice(1), "-X", "utf8", f], Object.assign({}, opts, { env: cleanEnv({ PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }) }), onData, handle);
      }
      if (lang === "rust") {
        const f = path.join(dir, "main.rs"), exe = path.join(dir, WIN ? "main.exe" : "main"); fs.writeFileSync(f, code);
        const b = await spawnLimited("rustc", ["--edition", "2021", "-o", exe, f], Object.assign({}, opts, { limitMs: 60000 }), onData, handle);
        if (b.code !== 0) return b;
        return await spawnLimited(exe, [], opts, onData, handle);
      }
      if (lang === "shell") {
        const f = path.join(dir, WIN ? "main.ps1" : "main.sh"); fs.writeFileSync(f, WIN ? "﻿" + code : code);
        if (WIN) return await spawnLimited("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", f], opts, onData, handle);
        return await spawnLimited("sh", [f], opts, onData, handle);
      }
      onData("err", "язык не поддерживается\n"); return { code: -1, ms: 0 };
    } finally { setTimeout(cleanup, 500); }
  }

  // ---------------------------------------------------------------- UI: run button under rendered code blocks
  const css = document.createElement("style");
  css.textContent = `
    .basalt-run-bar { display: flex; align-items: center; gap: 8px; margin: -2px 0 6px; font-size: var(--font-ui-smaller); color: var(--text-muted); }
    .basalt-run-bar button { padding: 2px 12px; }
    .basalt-run-out { margin: 0 0 12px; padding: 8px 12px; background: var(--background-secondary); border-left: 3px solid var(--interactive-accent); font-family: var(--font-monospace); font-size: var(--font-ui-smaller); white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; user-select: text; }
    .basalt-run-out .err { color: var(--text-error); }
    .basalt-run-out.is-fail { border-left-color: var(--text-error); }
    .basalt-term { margin: 6px 0; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; min-height: 140px; max-height: 100%; font-family: var(--font-monospace); font-size: var(--font-ui-small); }
    .basalt-term .bt-out { flex: 1; overflow: auto; padding: 8px 10px; white-space: pre-wrap; word-break: break-word; user-select: text; min-height: 80px; }
    .basalt-term .bt-out .err { color: var(--text-error); } .basalt-term .bt-out .cmd { color: var(--interactive-accent); }
    .basalt-term .bt-in { display: flex; gap: 6px; align-items: center; padding: 4px 10px; border-top: 1px solid var(--background-modifier-border); }
    .basalt-term .bt-in span { color: var(--interactive-accent); white-space: nowrap; max-width: 45%; overflow: hidden; text-overflow: ellipsis; }
    .basalt-term .bt-in input { flex: 1; border: 0; background: transparent; box-shadow: none; font-family: inherit; color: var(--text-normal); }
  `;
  document.head.appendChild(css);

  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const langFromCode = (codeEl) => { const m = /language-([\w+-]+)/.exec(codeEl.className || ""); return m ? m[1] : ""; };

  function enhanceCode(pre) {
    if (pre.dataset.basaltRun) return;
    const codeEl = pre.querySelector("code");
    if (!codeEl) return;
    const name = langFromCode(codeEl);
    if (name === "basalt-terminal") { pre.dataset.basaltRun = "1"; return mountTerminal(pre); }
    if (name === "output") { pre.dataset.basaltRun = "1"; return; }
    const lang = langOf(name);
    if (!lang) return;
    pre.dataset.basaltRun = "1";
    const bar = document.createElement("div"); bar.className = "basalt-run-bar";
    const run = document.createElement("button"); run.className = "mod-cta"; run.textContent = "Запустить"; try { const ic = document.createElement("span"); window.__bsApi.setIcon(ic, "lucide-play"); run.prepend(ic); } catch (e) { /* ok */ }
    const stop = document.createElement("button"); stop.textContent = "Стоп"; try { const ic = document.createElement("span"); window.__bsApi.setIcon(ic, "lucide-square"); stop.prepend(ic); } catch (e) { /* ok */ } stop.style.display = "none";
    const info = document.createElement("span"); info.textContent = LABEL[lang] + " · процесс в отдельной папке, лимит 15 с";
    bar.append(run, stop, info);
    pre.after(bar);
    let out = null, handle = null;
    run.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (out) out.remove();
      out = document.createElement("div"); out.className = "basalt-run-out"; bar.after(out);
      run.disabled = true; stop.style.display = ""; handle = {};
      const res = await runCode(lang, codeEl.textContent, (kind, text) => { const s = document.createElement("span"); if (kind === "err") s.className = "err"; s.textContent = text; out.appendChild(s); out.scrollTop = out.scrollHeight; }, handle);
      run.disabled = false; stop.style.display = "none";
      if (res.code !== 0) out.classList.add("is-fail");
      info.textContent = `${LABEL[lang]} · ${res.timedOut ? "остановлено по времени (15 с)" : res.code === 0 ? "готово" : "код выхода " + res.code} · ${(res.ms / 1000).toFixed(2)} с`;
      if (!out.textContent) out.textContent = "(вывода нет)";
    });
    stop.addEventListener("click", (e) => { e.stopPropagation(); if (handle && handle.child) killTree(handle.child); });
  }

  // ---------------------------------------------------------------- terminal widget
  const sessions = new Map(); // keeps cwd, history and output when the card is re-rendered
  function mountTerminal(pre) {
    const host = pre.closest(".canvas-node");
    const key = host ? (host.__basaltTermKey || (host.__basaltTermKey = "n" + Math.random().toString(36).slice(2))) : "x" + Math.random();
    // a card keeps its session through re-renders by its position in the canvas
    const idKey = host && host.closest(".canvas-wrapper") ? Array.from(host.parentNode.children).indexOf(host) + ":" + (host.style.transform || "") : key;
    let s = sessions.get(idKey);
    if (!s) { s = { cwd: (window.app && app.vault && app.vault.adapter && app.vault.adapter.basePath) || os.homedir(), hist: [], hi: 0, html: "" }; sessions.set(idKey, s); }
    // a real terminal when the pty helper is there
    if (window.__basaltTerm && window.__basaltTerm.ready()) {
      const holder = document.createElement("div"); holder.className = "basalt-term-real";
      const size = () => { const h = host ? host.getBoundingClientRect().height : 260; holder.style.height = Math.max(170, h - 52) + "px"; };
      pre.replaceWith(holder); size();
      for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "contextmenu"]) holder.addEventListener(ev, (e) => e.stopPropagation());
      if (host && window.ResizeObserver) new ResizeObserver(size).observe(host);
      window.__basaltTerm.mount(idKey, holder);
      return;
    }
    const term = document.createElement("div"); term.className = "basalt-term";
    term.innerHTML = '<div class="bt-out"></div><div class="bt-in"><span></span><input type="text" spellcheck="false" placeholder="команда…"></div>';
    const outEl = term.querySelector(".bt-out"), prompt = term.querySelector("span"), input = term.querySelector("input");
    outEl.innerHTML = s.html;
    const setPrompt = () => { prompt.textContent = s.cwd + (WIN ? ">" : "$"); prompt.title = s.cwd; };
    const write = (kind, text) => { const sp = document.createElement("span"); if (kind) sp.className = kind; sp.textContent = text; outEl.appendChild(sp); s.html = outEl.innerHTML; outEl.scrollTop = outEl.scrollHeight; };
    pre.replaceWith(term);
    for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "keydown", "wheel"]) term.addEventListener(ev, (e) => e.stopPropagation());
    setPrompt();
    let running = null;
    input.addEventListener("keydown", async (e) => {
      if (e.key === "ArrowUp") { if (s.hist.length) { s.hi = Math.max(0, s.hi - 1); input.value = s.hist[s.hi] || ""; } e.preventDefault(); return; }
      if (e.key === "ArrowDown") { s.hi = Math.min(s.hist.length, s.hi + 1); input.value = s.hist[s.hi] || ""; e.preventDefault(); return; }
      if (lk(e) === "c" && e.ctrlKey && running) { killTree(running.child); return; }
      if (e.key !== "Enter") return;
      const line = input.value.trim(); input.value = "";
      if (!line || running) return;
      s.hist.push(line); s.hi = s.hist.length;
      write("cmd", s.cwd + (WIN ? "> " : "$ ") + line + "\n");
      if (line === "clear" || line === "cls") { outEl.textContent = ""; s.html = ""; return; }
      const cd = /^cd\s*(.*)$/i.exec(line);
      if (cd) {
        const target = cd[1].replace(/^["']|["']$/g, "").trim() || os.homedir();
        const next = path.resolve(s.cwd, target);
        try { if (fs.statSync(next).isDirectory()) { s.cwd = next; setPrompt(); } else write("err", "не папка\n"); } catch (err) { write("err", "нет такой папки\n"); }
        return;
      }
      running = {}; input.disabled = true;
      const args = WIN ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" + line] : ["-c", line];
      const res = await spawnLimited(WIN ? "powershell.exe" : (process.env.SHELL || "sh"), args, { cwd: s.cwd, env: process.env, limitMs: 120000 }, write, running);
      if (res.timedOut) write("err", "остановлено по времени (2 мин)\n");
      running = null; input.disabled = false; input.focus();
    });
  }

  // ---------------------------------------------------------------- command for the editor: run the block under the cursor, write the output below it
  function blockAtCursor(editor) {
    const cur = editor.getCursor().line, last = editor.lastLine();
    let start = -1, end = -1;
    for (let i = cur; i >= 0; i--) { if (/^\s*```/.test(editor.getLine(i))) { start = i; break; } }
    if (start < 0) return null;
    // the fence found must be an opening one: count fences above it
    let fences = 0; for (let i = 0; i < start; i++) if (/^\s*```/.test(editor.getLine(i))) fences++;
    if (fences % 2) return null;
    for (let i = start + 1; i <= last; i++) { if (/^\s*```\s*$/.test(editor.getLine(i))) { end = i; break; } }
    if (end < 0 || end < cur) return null;
    const lang = langOf(editor.getLine(start).replace(/^\s*```\s*/, "").split(/\s/)[0]);
    if (!lang) return null;
    const code = []; for (let i = start + 1; i < end; i++) code.push(editor.getLine(i));
    return { start, end, lang, code: code.join("\n") };
  }
  const registerCommands = () => {
    if (!window.app || !app.commands || !app.commands.addCommand) return false;
    app.commands.addCommand({
      id: "basalt:run-code-block", name: "Запустить блок кода под курсором",
      editorCheckCallback: (checking, editor) => {
        const b = blockAtCursor(editor);
        if (!b) return false;
        if (checking) return true;
        let text = "";
        runCode(b.lang, b.code, (k, t) => { text += t; }).then((res) => {
          const body = (text.replace(/\s+$/, "") || "(вывода нет)") + (res.code !== 0 ? `\n[код выхода ${res.code}${res.timedOut ? ", остановлено по времени" : ""}]` : "");
          let end = b.end;
          // replace the output block that is already right under the code block
          if (/^\s*```output\s*$/.test(editor.getLine(end + 1) || "")) { let e2 = end + 2; while (e2 <= editor.lastLine() && !/^\s*```\s*$/.test(editor.getLine(e2))) e2++; editor.replaceRange("", { line: end + 1, ch: 0 }, { line: Math.min(e2 + 1, editor.lastLine() + 1), ch: 0 }); }
          editor.replaceRange("\n```output\n" + body + "\n```", { line: end, ch: editor.getLine(end).length });
        });
        return true;
      },
    });
    return true;
  };
  let tries = 0;
  const reg = setInterval(() => { if (registerCommands() || ++tries > 60) clearInterval(reg); }, 1000);

  // ---------------------------------------------------------------- watch the DOM for rendered code blocks
  let queued = false;
  const scan = () => { queued = false; for (const pre of document.querySelectorAll("pre:not([data-basalt-run])")) { if (pre.closest(".cm-editor") && !pre.closest(".cm-embed-block, .markdown-rendered, .canvas-node")) continue; enhanceCode(pre); } };
  const schedule = () => { if (!queued) { queued = true; setTimeout(scan, 120); } };
  const start = () => { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); scan(); };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);

  window.__basaltCode = { runCode, langOf };
})();
