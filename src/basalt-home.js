// Basalt start screen: replaces the stock "empty tab" (three text links) with a home page:
// search, quick actions, recent files and the vault at a glance.
(() => {
  "use strict";
  const mainLeaf = (newTab) => { const ws = app.workspace; let l = newTab ? null : ws.getMostRecentLeaf(ws.rootSplit); if (!l || l.getRoot() !== ws.rootSplit) l = ws.getLeaf("tab"); return l; }; /* a file opens in the main area, never in a side panel that happens to be focused */

  const css = document.createElement("style");
  css.textContent = `
    .empty-state { position: relative; display: block !important; } .bsh { position: absolute; inset: 0; overflow: auto; display: flex; justify-content: center; padding: 5vh 24px 32px; box-sizing: border-box; }
    .bsh-in { width: min(760px, 100%); display: flex; flex-direction: column; gap: 26px; }
    .bsh-brand { display: flex; align-items: center; gap: 18px; }
    .bsh-brand img { height: 64px; width: auto; flex: none; }
    .bsh-brand h1 { margin: 0; font-size: 34px; letter-spacing: .04em; font-weight: 700; line-height: 1; }
    .bsh-brand p { margin: 6px 0 0; color: var(--text-muted); font-size: var(--font-ui-small); }
    .bsh-search { display: flex; align-items: center; gap: 10px; padding: 14px 18px; cursor: text; color: var(--text-muted); background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);  transition: border-color .12s, background .12s; }
    .bsh-search:hover { border-color: var(--interactive-accent); background: var(--background-modifier-hover); }
    .bsh-search svg { width: 18px; height: 18px; flex: none; }
    .bsh-search span { flex: 1; font-size: 15px; }
    .bsh kbd { font-family: var(--font-monospace); font-size: 11px; padding: 2px 7px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); color: var(--text-faint); }
    .bsh-tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .bsh-tile { position: relative; display: flex; flex-direction: row; align-items: center; gap: 12px; padding: 12px 14px; min-height: 60px; cursor: pointer; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);  transition: transform .12s, border-color .12s, background .12s; }
    .bsh-tile:hover { border-color: var(--interactive-accent); background: var(--background-modifier-hover); }
    .bsh-keys { display: flex; gap: 4px; }
    .bsh-tile > div { display: flex; flex-direction: row; align-items: center; gap: 10px; flex: 1; min-width: 0; }
    .bsh-tile .bsh-keys { margin-left: auto; }
    .bsh-tile .bsh-ti { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: var(--bs-r); background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); color: var(--interactive-accent); flex: none; }
    .bsh-tile .bsh-ti svg { width: 20px; height: 20px; padding: 0; box-sizing: border-box; background: none; border-radius: 0; }
    .bsh-tile svg { padding: 7px; box-sizing: content-box; width: 22px; height: 22px; border-radius: var(--bs-r); background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); }
    .bsh-tile svg { color: var(--interactive-accent); }
    .bsh-tile b { font-weight: 600; } .bsh-tile small { color: var(--text-faint); font-size: var(--font-ui-smaller); }
    .bsh-cols { display: grid; grid-template-columns: 1fr; gap: 32px; }
    .bsh-hint { color: var(--text-faint); font-size: var(--font-ui-smaller); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .bsh-hint kbd { font-family: var(--font-monospace); font-size: 11.5px; padding: 1px 6px; border-radius: var(--bs-r); background: var(--background-modifier-hover); color: var(--text-muted); }
    .bsh-recent { display: grid; grid-template-columns: 1fr; column-gap: 14px; }
    @media (max-width: 720px) { .bsh-cols { grid-template-columns: 1fr; } }
    .bsh h3 { margin: 0 0 8px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--text-faint); font-weight: 600; }
    .bsh-rec { display: flex; align-items: center; gap: 12px; padding: 8px 10px; cursor: pointer; border-left: 2px solid transparent; }
    .bsh-rec:hover { background: var(--background-modifier-hover); border-left-color: var(--interactive-accent); }
    .bsh-rec svg { width: 18px; height: 18px; color: var(--text-muted); flex: none; }
    .bsh-rec div { flex: 1; min-width: 0; } .bsh-rec b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bsh-rec small { display: block; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bsh-rec time { color: var(--text-faint); font-size: var(--font-ui-smaller); flex: none; }
    .bsh-stat { display: flex; flex-direction: column; gap: 6px; }
    .bsh-stat div { border-radius: 0; display: flex; justify-content: space-between; padding: 11px 12px; background: var(--background-secondary); border-left: 2px solid var(--background-modifier-border); }
    .bsh-stat b { color: var(--text-normal); } .bsh-stat span { color: var(--text-muted); }
    .bsh-close { color: var(--text-faint); font-size: var(--font-ui-smaller); cursor: pointer; align-self: flex-start; } .bsh-close:hover { color: var(--text-normal); }
    .empty-state .empty-state-container { display: none; }
  `;
  document.head.appendChild(css);

  const ICON = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    canvas: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    term: '<path d="M4 17l6-6-6-6M12 19h8"/>',
    graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l8 1M7 8l4 8M17 10l-4 6"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const ago = (ms) => { const s = (Date.now() - ms) / 1000; if (s < 90) return "только что"; if (s < 3600) return Math.round(s / 60) + " мин"; if (s < 86400) return Math.round(s / 3600) + " ч"; if (s < 86400 * 30) return Math.round(s / 86400) + " дн"; return new Date(ms).toLocaleDateString(); };
  const cmd = (id) => { try { app.commands.executeCommandById(id); } catch (e) { /* missing */ } };

  function build(state) {
    const host = state.querySelector(".empty-state-container");
    if (!host || state.querySelector(".bsh")) return;
    // only in the editor area: an empty leftover in a side panel gets nothing
    if (state.closest(".mod-left-split, .mod-right-split")) return;
    const leafEl = state.closest(".workspace-leaf-content");
    const leaf = (() => { let f = null; app.workspace.iterateAllLeaves((l) => { if (l.view && l.view.containerEl && leafEl && l.view.containerEl === leafEl) f = l; }); return f; })();
    const files = app.vault.getFiles(), notes = files.filter((f) => f.extension === "md"), canv = files.filter((f) => f.extension === "canvas");
    const recent = (app.workspace.getLastOpenFiles ? app.workspace.getLastOpenFiles() : []).map((p) => app.vault.getAbstractFileByPath(p)).filter((f) => f && f.extension).slice(0, 6);
    const links = Object.values(app.metadataCache.resolvedLinks || {}).reduce((n, o) => n + Object.keys(o).length, 0);
    const el = document.createElement("div"); el.className = "bsh";
    el.innerHTML = `<div class="bsh-in">
      <div class="bsh-brand"><img src="basalt-logo.png" alt=""><div><h1>Basalt</h1><p></p></div></div>
      <div class="bsh-search">${svg("search")}<span>Искать по заметкам и холстам…</span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>O</kbd></div>
      <div class="bsh-tiles"></div>
      <div class="bsh-cols"><div><h3>Недавние</h3><div class="bsh-recent"></div></div></div></div>`;
    el.querySelector("p").textContent = app.vault.getName();
    el.querySelector(".bsh-search").addEventListener("click", () => cmd("basalt:quick-search"));
    const tiles = [
      ["folder", "Открыть папку", "", () => window.__bsWorkspace ? window.__bsWorkspace.pick() : cmd("basalt:open-folder")],
      ["note", "Новая заметка", "|Ctrl+N", () => cmd("file-explorer:new-file")],
      ["canvas", "Новый холст", "", () => cmd("canvas:new-file")],
      ["term", "Терминал", "", () => leaf && leaf.setViewState({ type: "basalt-terminal", active: true })],
    ];
    const tl = el.querySelector(".bsh-tiles");
    const LI = { folder: "folder-open", note: "file-text", canvas: "layout-dashboard", term: "terminal", graph: "git-fork", file: "file-search", history: "history", plug: "plug", gear: "settings" };
    for (const [ic, t, sub, fn] of tiles) { const [desc, keys] = sub.split("|"); const d = document.createElement("div"); d.className = "bsh-tile"; d.innerHTML = `<span class="bsh-ti"></span><div><b>${esc(t)}</b>${desc ? `<br><small>${esc(desc)}</small>` : ""}${keys ? `<span class="bsh-keys">${keys.split("+").map((k) => `<kbd>${esc(k)}</kbd>`).join("")}</span>` : ""}</div>`; try { window.__bsApi.setIcon(d.firstChild, "lucide-" + LI[ic]); } catch (e) { d.firstChild.innerHTML = svg(ic); } d.addEventListener("click", fn); tl.appendChild(d); }
    const rl = el.querySelector(".bsh-recent");
    if (!recent.length) rl.innerHTML = '<div class="bsh-rec" style="cursor:default"><div><small>Пока ничего не открывали</small></div></div>';
    for (const f of recent) {
      const d = document.createElement("div"); d.className = "bsh-rec";
      d.innerHTML = `${svg(f.extension === "canvas" ? "canvas" : "note")}<div><b>${esc(f.basename || f.name)}</b><small>${esc(f.parent && f.parent.path && f.parent.path !== "/" ? f.parent.path : "корень")}</small></div><time>${f.stat ? ago(f.stat.mtime) : ""}</time>`;
      d.addEventListener("click", () => { (leaf || mainLeaf(false)).openFile(f); });
      rl.appendChild(d);
    }
    state.appendChild(el);
  }

  const scan = () => {
    document.querySelectorAll('.workspace-leaf-content[data-type="empty"] .view-header-title').forEach((t) => { if (t.textContent === "New tab" && window.__bsLang === "ru") t.textContent = "Новая вкладка"; }); if (!window.app || !app.workspace || !app.vault) return; document.querySelectorAll(".empty-state").forEach((s) => { try { build(s); } catch (e) { console.error("[basalt-home]", e); } }); };
  new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
  setTimeout(scan, 1500);
  // the app opens on the start tab
  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.workspace.layoutReady) return;
    clearInterval(t);
    try {
      let has = null; app.workspace.iterateAllLeaves((l) => { if (!has && l.view && l.view.getViewType && l.view.getViewType() === "empty") has = l; });
      const leaf = has || app.workspace.getLeaf("tab");
      if (!has) leaf.setViewState({ type: "empty" });
      app.workspace.setActiveLeaf(leaf, { focus: false });
    } catch (e) { console.error("[basalt-home]", e); }
  }, 400);
})();
