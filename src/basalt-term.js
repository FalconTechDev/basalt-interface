// Basalt terminal: a real terminal (ConPTY / pty) in a tab, in the side panel and inside canvas cards.
// xterm.js draws it, basalt-pty (a small Rust helper next to this file) runs the shell on a pseudo-terminal, so
// colours, cursor keys, Tab completion, vim, ssh, htop and the rest behave like in any terminal.
(() => {
  "use strict";
  const lk = (e) => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : String(e.key).toLowerCase()); // the letter of the key, whatever layout (Russian too)

  if (typeof window.require !== "function") return;
  const cp = window.require("child_process"), fs = window.require("fs"), path = window.require("path"), os = window.require("os");
  const WIN = process.platform === "win32";
  const HELPER = path.join(process.resourcesPath || "", "app-src", "bin", WIN ? "basalt-pty.exe" : "basalt-pty");
  const hasHelper = () => { try { return fs.existsSync(HELPER); } catch (e) { return false; } };

  // ---- which shell
  const SHELLS = (() => {
    const list = [];
    if (WIN) {
      list.push({ id: "powershell", name: "PowerShell", cmd: "powershell.exe", args: ["-NoLogo"] });
      list.push({ id: "pwsh", name: "PowerShell 7", cmd: "pwsh.exe", args: ["-NoLogo"] });
      list.push({ id: "cmd", name: "Командная строка", cmd: "cmd.exe", args: [] });
      for (const g of ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]) if (fs.existsSync(g)) { list.push({ id: "gitbash", name: "Git Bash", cmd: g, args: ["-l", "-i"] }); break; }
      list.push({ id: "wsl", name: "WSL", cmd: "wsl.exe", args: [] });
    } else list.push({ id: "default", name: path.basename(process.env.SHELL || "sh"), cmd: process.env.SHELL || "/bin/sh", args: ["-l"] });
    return list;
  })();
  const getShell = () => { let id = ""; try { id = localStorage.getItem("basalt-term-shell") || ""; } catch (e) { /* none */ } return SHELLS.find((s) => s.id === id) || SHELLS[0]; };
  const setShell = (id) => { try { localStorage.setItem("basalt-term-shell", id); } catch (e) { /* none */ } };

  // ---- xterm.js (vendored, MIT) loaded on first use
  let loading = null;
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("не загрузился " + src)); document.head.appendChild(s); });
  function loadXterm() {
    if (window.Terminal && window.FitAddon) return Promise.resolve();
    if (loading) return loading;
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "vendor/xterm.css"; document.head.appendChild(l);
    loading = loadScript("vendor/xterm.js").then(() => loadScript("vendor/addon-fit.js"));
    return loading;
  }

  const css = document.createElement("style");
  css.textContent = `
    .bst { display: flex; flex-direction: column; height: 100%; background: var(--background-primary); }
    .bst-bar { display: flex; gap: 8px; align-items: center; padding: 4px 10px; background: var(--background-primary); border-bottom: 1px solid var(--background-modifier-border); font-size: var(--font-ui-small); }
    .bst-bar select { height: 26px; } .bst-bar .bst-gap { flex: 1; } .bst-bar button { padding: 2px 10px; }
    .bst-body { flex: 1; min-height: 0; padding: 6px 8px; } .bst-body .xterm { height: 100%; } .bst-body .xterm-viewport { background: transparent !important; }
    .basalt-term-real { background: var(--background-primary); padding: 4px 6px; min-height: 160px; width: 100%; box-sizing: border-box; border: 1px solid var(--background-modifier-border); }
    .basalt-term-real .xterm-viewport { background: transparent !important; }
    .bst-msg { padding: 20px; color: var(--text-muted); }
  `;
  document.head.appendChild(css);

  const cssVar = (name, fb) => { const p = document.createElement("div"); p.style.cssText = "display:none;color:var(" + name + "," + fb + ")"; document.body.appendChild(p); const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(getComputedStyle(p).color); p.remove(); return m ? "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("") : fb; };
  const theme = () => {
    const dark = document.body.classList.contains("theme-dark");
    return { background: cssVar("--vs-bg", cssVar("--background-primary", "#17130f")), foreground: cssVar("--vs-fg", cssVar("--text-normal", "#ece4db")), cursor: cssVar("--interactive-accent", "#c98d5b"), cursorAccent: cssVar("--background-primary", "#17130f"), selectionBackground: "rgba(201,141,91,.35)",
      black: dark ? "#2a221c" : "#2a211a", red: "#e0705c", green: "#8fc98a", yellow: "#e0b565", blue: "#7c9ccf", magenta: "#c690c4", cyan: "#6fc0c0", white: dark ? "#d9cbb8" : "#6e6154",
      brightBlack: "#6e6154", brightRed: "#f2907c", brightGreen: "#a9dfa4", brightYellow: "#f0cc85", brightBlue: "#9bb8e6", brightMagenta: "#dcaadb", brightCyan: "#8fd6d6", brightWhite: dark ? "#f3ebe0" : "#1d1812" };
  };
  const mono = () => (getComputedStyle(document.body).getPropertyValue("--font-monospace") || "").trim() || "Consolas, 'Cascadia Mono', monospace";

  const frame = (tag, payload) => { const h = Buffer.alloc(5); h[0] = tag; h.writeUInt32LE(payload.length, 1); return Buffer.concat([h, payload]); };

  // creates a terminal inside `container`; the shell starts at `cwd`
  async function create(container, opts = {}) {
    if (!hasHelper()) throw new Error("не найден basalt-pty (" + HELPER + ")");
    await loadXterm();
    const sh = opts.shell || getShell(), cwd = opts.cwd || (window.app && app.vault && app.vault.adapter && app.vault.adapter.basePath) || os.homedir();
    const term = new window.Terminal({ fontFamily: mono(), fontSize: opts.fontSize || 13, cursorBlink: true, scrollback: 8000, allowProposedApi: true, theme: theme(), convertEol: false });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit); term.open(container);
    try { fit.fit(); } catch (e) { /* not visible yet */ }
    const proc = cp.spawn(HELPER, [String(term.cols), String(term.rows), cwd, sh.cmd, ...sh.args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: process.env });
    const send = (tag, buf) => { try { if (proc.stdin.writable) proc.stdin.write(frame(tag, buf)); } catch (e) { /* closed */ } };
    let exited = false;
    proc.stdout.on("data", (d) => term.write(new Uint8Array(d)));
    proc.stderr.on("data", (d) => term.write("\r\n\x1b[31m" + String(d).replace(/\n/g, "\r\n") + "\x1b[0m"));
    proc.on("error", (e) => term.write("\r\n\x1b[31m" + (window.__bsT || String)("не удалось запустить оболочку:") + " " + e.message + "\x1b[0m\r\n"));
    proc.on("exit", (code) => { exited = true; term.write("\r\n\x1b[2m[" + (window.__bsT || String)("процесс завершён, код") + " " + code + "]\x1b[0m\r\n"); if (opts.onExit) opts.onExit(code); });
    term.onData((s) => send(0, Buffer.from(s, "utf8")));
    term.onBinary((s) => send(0, Buffer.from(s, "binary")));
    term.onResize(({ cols, rows }) => { const b = Buffer.alloc(4); b.writeUInt16LE(cols, 0); b.writeUInt16LE(rows, 2); send(1, b); });
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const k = lk(e);
      if ((e.ctrlKey && e.shiftKey && k === "c") || (e.ctrlKey && !e.shiftKey && k === "c" && term.hasSelection())) { navigator.clipboard.writeText(term.getSelection()).catch(() => {}); return false; }
      if ((e.ctrlKey && e.shiftKey && k === "v") || (e.ctrlKey && !e.shiftKey && k === "v")) { navigator.clipboard.readText().then((t) => term.paste(t)).catch(() => {}); return false; }
      return true;
    });
    // the app must not treat typing in the terminal as its own hotkeys
    for (const ev of ["keydown", "keyup", "keypress"]) container.addEventListener(ev, (e) => e.stopPropagation());
    const ro = new ResizeObserver(() => { try { if (container.clientWidth > 40 && container.clientHeight > 30) fit.fit(); } catch (e) { /* hidden */ } });
    ro.observe(container);
    const themeObs = new MutationObserver(() => { term.options.theme = theme(); });
    themeObs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return {
      term, fit, proc, shell: sh,
      get exited() { return exited; },
      focus() { term.focus(); },
      dispose() { try { ro.disconnect(); themeObs.disconnect(); proc.kill(); } catch (e) { /* gone */ } try { term.dispose(); } catch (e) { /* gone */ } },
    };
  }

  // ---- sessions behind canvas cards survive the card being re-rendered
  const sessions = new Map();
  async function mount(key, holder) {
    let s = sessions.get(key);
    if (s && !s.exited) {
      holder.appendChild(s.term.element); try { s.fit.fit(); } catch (e) { /* hidden */ }
      s.holder = holder; return s;
    }
    holder.textContent = "";
    try { s = await create(holder, { onExit: () => sessions.delete(key) }); } catch (e) { holder.innerHTML = '<div class="bst-msg"></div>'; holder.firstChild.textContent = "Терминал недоступен: " + e.message; return null; }
    sessions.set(key, s); s.holder = holder;
    return s;
  }

  // ---- the terminal as a view (tab / side panel)
  const VIEW = "basalt-terminal";
  function makeView(api) {
    return class TerminalView extends api.ItemView {
      getViewType() { return VIEW; }
      getDisplayText() { return "Терминал"; }
      getIcon() { return "lucide-terminal"; }
      async onOpen() {
        const root = this.contentEl; root.empty && root.empty(); root.style.padding = "0"; root.style.overflow = "hidden";
        root.innerHTML = '<div class="bst"><div class="bst-bar"><select class="dropdown"></select><span class="bst-gap"></span><button class="clickable-icon" aria-label="Новая сессия"></button></div><div class="bst-body"></div></div>';
        const sel = root.querySelector("select"), body = root.querySelector(".bst-body"), again = root.querySelector("button"); try { window.__bsApi.setIcon(again, "lucide-plus"); } catch (e) { again.textContent = "+"; }
        for (const s of SHELLS) { const o = document.createElement("option"); o.value = s.id; o.textContent = s.name; if (s.id === getShell().id) o.selected = true; sel.appendChild(o); }
        const start = async () => {
          if (this.t) this.t.dispose(); body.textContent = "";
          try { this.t = await create(body, { shell: SHELLS.find((s) => s.id === sel.value) || getShell() }); this.t.focus(); } catch (e) { body.innerHTML = '<div class="bst-msg"></div>'; body.firstChild.textContent = "Терминал недоступен: " + e.message; }
        };
        sel.addEventListener("change", () => { setShell(sel.value); start(); });
        again.addEventListener("click", start);
        this.start = start; await start();
      }
      onResize() { try { this.t && this.t.fit.fit(); } catch (e) { /* hidden */ } }
      async onClose() { if (this.t) this.t.dispose(); }
    };
  }

  let done = false;
  const register = () => {
    if (done || !window.app || !app.commands || !app.workspace || !app.viewRegistry || !window.__bsApi) return false;
    done = true;
    const V = makeView(window.__bsApi), creator = (leaf) => new V(leaf);
    try { app.viewRegistry.registerView(VIEW, creator); } catch (e) { app.viewRegistry.viewByType[VIEW] = creator; }
    app.commands.addCommand({ id: "basalt:terminal", name: "Терминал: открыть во вкладке", hotkeys: [{ modifiers: ["Ctrl"], key: "`" }], callback: () => app.workspace.getLeaf("tab").setViewState({ type: VIEW, active: true }) });
    app.commands.addCommand({ id: "basalt:terminal-side", name: "Терминал: открыть справа", callback: async () => { const leaf = app.workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW, active: true }); app.workspace.revealLeaf(leaf); } });
    return true;
  };
  let tries = 0;
  const timer = setInterval(() => { try { if (register() || ++tries > 120) clearInterval(timer); } catch (e) { console.error("[basalt-term]", e); if (++tries > 120) clearInterval(timer); } }, 1000);

  window.__basaltTerm = { create, mount, ready: () => hasHelper(), shells: SHELLS, helper: HELPER };
})();
