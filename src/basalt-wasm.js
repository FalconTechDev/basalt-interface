// Basalt Wasm plugins: a plugin is a WebAssembly module plus manifest.json in <config>/wasm-plugins/<id>/.
// The module has no ambient access to anything: it can only call the functions the host hands it, and the host hands out
// only what the manifest asks for AND the user approved ("permissions"). See plugins-sdk/README.md for the ABI.
(() => {
  "use strict";
  const PERMS = {
    "vault.read": "читать заметки хранилища",
    "vault.write": "создавать и изменять заметки",
    "editor": "читать и менять выделенный текст в редакторе",
  };
  const dec = new TextDecoder(), enc = new TextEncoder();
  const root = () => app.vault.configDir + "/wasm-plugins";
  const stateFile = () => app.vault.configDir + "/wasm-plugins.json";
  const live = new Map(); // id -> { manifest, commands: [], inst }
  let state = { enabled: [], approved: {} };

  const loadState = async () => { try { const a = app.vault.adapter; if (await a.exists(stateFile())) state = Object.assign(state, JSON.parse(await a.read(stateFile()))); } catch (e) { /* first run */ } };
  const saveState = () => app.vault.adapter.write(stateFile(), JSON.stringify(state)).catch((e) => console.error("[basalt-wasm]", e));
  const notice = (m, t) => { try { new window.__bsApi.Notice(m, t || 4000); } catch (e) { console.log(m); } };
  const safePath = (p) => { const n = String(p).replace(/\\/g, "/").replace(/^\/+/, ""); return n && !n.split("/").some((s) => s === ".." || s === ".git") && !/^[a-zA-Z]:/.test(n) && !n.startsWith(app.vault.configDir + "/") ? n : null; };

  async function list() {
    const a = app.vault.adapter, out = [];
    if (!(await a.exists(root()))) return out;
    for (const dir of (await a.list(root())).folders) {
      try { const m = JSON.parse(await a.read(dir + "/manifest.json")); out.push({ ...m, dir, enabled: state.enabled.includes(m.id) }); } catch (e) { /* not a plugin */ }
    }
    return out;
  }

  async function start(m) {
    if (live.has(m.id)) return;
    const granted = new Set((m.permissions || []).filter((p) => (state.approved[m.id] || []).includes(p)));
    const bytes = await app.vault.adapter.readBinary(m.dir + "/" + (m.wasm || "plugin.wasm"));
    const rec = { manifest: m, commands: [], inst: null, buf: new Uint8Array(0) };
    const mem = () => new Uint8Array(rec.inst.exports.memory.buffer);
    const str = (p, n) => { if (p < 0 || n < 0 || p + n > mem().length) throw new Error("bad pointer"); return dec.decode(mem().subarray(p, p + n)); };
    const give = (text) => { rec.buf = enc.encode(String(text)); return rec.buf.length; };
    const deny = (what) => { console.warn(`[wasm:${m.id}] denied: ${what}`); return -1; };
    const guard = (perm, fn) => (...a) => { if (!granted.has(perm)) return deny(perm); try { return fn(...a); } catch (e) { console.warn(`[wasm:${m.id}]`, e.message); return -1; } };
    const imports = { basalt: {
      log: (p, n) => console.log(`[wasm:${m.id}]`, str(p, n)),
      notice: (p, n) => notice(str(p, n)),
      register_command: (ip, il, np, nl) => {
        const cid = str(ip, il), name = str(np, nl), full = `wasm:${m.id}:${cid}`;
        app.commands.addCommand({ id: full, name: `${m.name || m.id}: ${name}`, callback: () => { try { const b = enc.encode(cid), ptr = rec.inst.exports.bs_alloc(b.length); mem().set(b, ptr); rec.inst.exports.bs_command(ptr, b.length); } catch (e) { notice(`Плагин ${m.name || m.id}: ${e.message}`); } } });
        rec.commands.push(full);
      },
      take: (dst, cap) => { const n = Math.min(cap, rec.buf.length); mem().set(rec.buf.subarray(0, n), dst); return n; },
      active_path: () => { const f = app.workspace.getActiveFile(); return f ? give(f.path) : -1; },
      read_note: guard("vault.read", (p, n) => { const rel = safePath(str(p, n)); if (!rel) return -1; const f = app.vault.getAbstractFileByPath(rel); if (!f || f.extension === undefined) return -1; return give(window.require("fs").readFileSync(window.require("path").join(app.vault.adapter.basePath, rel), "utf8")); }),
      list_notes: guard("vault.read", () => give(app.vault.getMarkdownFiles().map((f) => f.path).join("\n"))),
      write_note: guard("vault.write", (p, n, dp, dl) => { const rel = safePath(str(p, n)); if (!rel) return -1; const fs = window.require("fs"), pa = window.require("path"), full = pa.join(app.vault.adapter.basePath, rel); fs.mkdirSync(pa.dirname(full), { recursive: true }); fs.writeFileSync(full, str(dp, dl)); return 0; }),
      selection: guard("editor", () => { const ed = app.workspace.activeEditor && app.workspace.activeEditor.editor; return ed ? give(ed.getSelection()) : -1; }),
      replace_selection: guard("editor", (p, n) => { const ed = app.workspace.activeEditor && app.workspace.activeEditor.editor; if (!ed) return -1; ed.replaceSelection(str(p, n)); return 0; }),
    } };
    const { instance } = await WebAssembly.instantiate(bytes, imports);
    rec.inst = instance;
    if (!instance.exports.memory || !instance.exports.bs_alloc) throw new Error("module must export memory and bs_alloc");
    if (instance.exports.bs_init) instance.exports.bs_init();
    live.set(m.id, rec);
  }
  function stop(id) {
    const rec = live.get(id); if (!rec) return;
    for (const c of rec.commands) { try { delete app.commands.commands[c]; delete app.commands.editorCommands[c]; } catch (e) { /* ok */ } }
    live.delete(id);
  }

  // enabling asks for the permissions once; they are remembered per plugin
  async function enable(m) {
    const need = (m.permissions || []).filter((p) => !(state.approved[m.id] || []).includes(p));
    if (need.length) {
      const text = `Плагин «${m.name || m.id}» (WebAssembly) просит разрешения:\n\n` + need.map((p) => "• " + (PERMS[p] || p)).join("\n") + "\n\nБез этих разрешений он не сможет ничего сделать. Разрешить?";
      if (!(await window.__bsConfirm(text, { title: "Разрешения модуля" }))) return false;
      state.approved[m.id] = (m.permissions || []).slice();
    }
    if (!state.enabled.includes(m.id)) state.enabled.push(m.id);
    await saveState();
    await start(m);
    return true;
  }
  async function disable(id) { state.enabled = state.enabled.filter((x) => x !== id); await saveState(); stop(id); }
  async function remove(id) { await disable(id); const a = app.vault.adapter; try { await a.rmdir(root() + "/" + id, true); } catch (e) { console.error(e); } delete state.approved[id]; await saveState(); }

  async function boot() {
    await loadState();
    for (const m of await list()) if (state.enabled.includes(m.id)) start(m).catch((e) => { console.error(`[basalt-wasm] ${m.id}`, e); notice(`Wasm-плагин «${m.name || m.id}» не запустился: ${e.message}`, 8000); });
  }
  window.__bsWasm = { list, enable, disable, remove, root, PERMS, running: () => Array.from(live.keys()), start: async (m) => { await loadState(); return start(m); } };
  const t = setInterval(() => { if (window.app && app.vault && app.vault.adapter && app.workspace && app.workspace.layoutReady && app.commands && window.__bsApi) { clearInterval(t); boot().catch((e) => console.error("[basalt-wasm]", e)); } }, 700);
})();
