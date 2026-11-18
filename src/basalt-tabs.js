// Basalt tab strip: our own tabs for the editor area (replaces the inherited tab headers; the inherited ones stay in the
// DOM, hidden, because the layout code still keeps them). Click, middle-click or × closes, drag to reorder, menu, pins.
(() => {
  "use strict";
  const css = document.createElement("style");
  css.textContent = `
    .workspace-tab-header-container-inner.bt-hidden { display: none !important; }
    .btab { display: flex; flex-direction: row !important; flex-wrap: nowrap; align-items: stretch; flex: 0 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; -webkit-app-region: no-drag; align-self: stretch; }
    .btab::-webkit-scrollbar { display: none; }
    .bt-t { position: relative; display: flex; align-items: center; gap: 7px; flex: 0 1 190px; min-width: 96px; max-width: 220px; padding: 0 8px 0 12px; cursor: pointer; color: var(--text-muted); border-right: 1px solid color-mix(in srgb, var(--background-modifier-border) 60%, transparent); transition: background .1s, color .1s; user-select: none; }
    .bt-t:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .bt-t.is-cur { background: var(--background-primary); color: var(--text-normal); }
    .bt-t.is-cur::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--text-faint); }
    .bt-t.is-act::before { background: var(--interactive-accent); }
    .bt-t.is-drop { box-shadow: inset 3px 0 0 var(--interactive-accent); }
    .bt-i { display: inline-flex; flex: none; color: var(--interactive-accent); opacity: .85; } .bt-i svg { width: 15px; height: 15px; }
    .bt-n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; font-size: var(--font-ui-small); }
    .bt-p { width: 11px; height: 11px; color: var(--interactive-accent); flex: none; }
    .bt-x { width: 18px; height: 18px; flex: none; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; opacity: 0; color: var(--text-muted); font-size: 15px; line-height: 1; } .bt-x svg { width: 16px; height: 16px; }
    .bt-t:hover .bt-x, .bt-t.is-cur .bt-x { opacity: .75; } .bt-x:hover { opacity: 1 !important; background: var(--background-modifier-hover); color: var(--text-normal); }
  `;
  document.head.appendChild(css);

  const rootGroups = () => {
    const out = new Set();
    app.workspace.iterateAllLeaves((l) => { try { if (l.getRoot() === app.workspace.rootSplit && l.parent && l.parent.children && l.parent.tabHeaderContainerEl) out.add(l.parent); } catch (e) { /* detached */ } });
    // an empty group still has its strip to clean up
    return Array.from(out);
  };
  const sigOf = (g) => g.children.map((l) => { let t = ""; try { t = l.getDisplayText(); } catch (e) { /* loading */ } return (l.id || "") + ":" + t + ":" + (l.pinned ? 1 : 0) + ":" + (l === app.workspace.activeLeaf ? 1 : 0); }).join("|") + "#" + g.currentTab;

  function build(g) {
    const host = g.tabHeaderContainerEl, inner = host.querySelector(".workspace-tab-header-container-inner");
    if (!inner) return;
    let strip = host.querySelector(".btab");
    if (!strip) { strip = document.createElement("div"); strip.className = "btab"; inner.before(strip); inner.classList.add("bt-hidden"); }
    const sig = sigOf(g); if (strip.dataset.sig === sig) return; strip.dataset.sig = sig;
    const scroll = strip.scrollLeft; strip.textContent = "";
    const api = window.__bsApi, act = app.workspace.activeLeaf;
    g.children.forEach((leaf, idx) => {
      const t = document.createElement("div"); t.className = "bt-t" + (g.currentTab === idx ? " is-cur" : "") + (leaf === act ? " is-act" : ""); t.draggable = true;
      let title = ""; try { title = leaf.getDisplayText(); } catch (e) { /* loading */ }
      if (title === "New tab" && window.__bsLang === "ru") title = "Новая вкладка";
      t.title = title;
      t.innerHTML = '<span class="bt-i"></span><span class="bt-n"></span>' + (leaf.pinned ? '<svg class="bt-p" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg>' : '') + '<span class="bt-x" title="Закрыть"></span>';
      t.querySelector(".bt-n").textContent = title || "Без названия";
      try { api.setIcon(t.querySelector(".bt-x"), "lucide-x"); } catch (e) { t.querySelector(".bt-x").textContent = "×"; }
      try { api.setIcon(t.querySelector(".bt-i"), leaf.getIcon()); } catch (e) { /* no icon */ }
      t.addEventListener("click", (e) => { if (e.target.closest(".bt-x")) { leaf.detach(); return; } g.selectTab(leaf); app.workspace.setActiveLeaf(leaf, { focus: true }); });
      t.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); if (!leaf.pinned) leaf.detach(); } });
      t.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const m = new api.Menu();
        const closeOthers = (pred) => g.children.slice().forEach((o, k) => { if (o !== leaf && !o.pinned && pred(k)) o.detach(); });
        m.addItem((i) => i.setTitle("Закрыть").setIcon("lucide-x").onClick(() => leaf.detach()));
        m.addItem((i) => i.setTitle("Закрыть остальные вкладки").setIcon("lucide-x").onClick(() => closeOthers(() => true)));
        m.addItem((i) => i.setTitle("Закрыть вкладки справа").setIcon("lucide-x").onClick(() => closeOthers((k) => k > idx)));
        m.addItem((i) => i.setTitle("Закрыть все вкладки").setIcon("lucide-x").onClick(() => { g.children.slice().forEach((o) => { if (!o.pinned) o.detach(); }); }));
        m.addSeparator();
        m.addItem((i) => i.setTitle(leaf.pinned ? "Открепить" : "Закрепить").setIcon("lucide-pin").onClick(() => leaf.togglePinned && leaf.togglePinned()));
        m.addSeparator();
        m.addItem((i) => i.setTitle("Переместить в новое окно").setIcon("lucide-external-link").onClick(() => { try { app.workspace.moveLeafToPopout(leaf); } catch (err) { /* no popout */ } }));
        m.addItem((i) => i.setTitle("Открыть в новом окне").setIcon("lucide-app-window").onClick(() => { try { app.workspace.duplicateLeaf(leaf, "window"); } catch (err) { /* no popout */ } }));
        m.addSeparator();
        try {
          const vt = leaf.view && leaf.view.getViewType && leaf.view.getViewType(), cmd = vt === "canvas" ? "basalt:translate-canvas" : vt === "markdown" ? "basalt:translate-note" : null;
          if (cmd) m.addItem((i) => i.setTitle("Перевести…").setIcon("lucide-languages").onClick(() => { app.workspace.setActiveLeaf(leaf, { focus: true }); setTimeout(() => app.commands.executeCommandById(cmd), 60); }));
        } catch (err) { /* no translator */ }
        try { leaf.view && leaf.view.onPaneMenu && leaf.view.onPaneMenu(m, "tab-header"); } catch (err) { /* view has no menu */ }
        try { app.workspace.trigger("tab-menu", m, leaf.view && leaf.view.file, "tab-header", leaf); } catch (err) { /* plugins */ }
        m.showAtMouseEvent(e);
      });
      t.addEventListener("dragstart", (e) => { window.__bstDrag = { g, leaf }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/bst", leaf.id || String(idx)); try { app.workspace.onDragLeaf(e, leaf); } catch (err) { /* drag to split unavailable */ } });
      t.addEventListener("dragend", () => { window.__bstDrag = null; strip.querySelectorAll(".is-drop").forEach((x) => x.classList.remove("is-drop")); });
      t.addEventListener("dragover", (e) => { const d = window.__bstDrag; if (d && d.g === g && d.leaf !== leaf) { e.preventDefault(); t.classList.add("is-drop"); } });
      t.addEventListener("dragleave", () => t.classList.remove("is-drop"));
      t.addEventListener("drop", (e) => {
        t.classList.remove("is-drop"); const d = window.__bstDrag; if (!d || d.g !== g || d.leaf === leaf) return; e.preventDefault(); e.stopPropagation();
        const cur = g.children[g.currentTab], from = g.children.indexOf(d.leaf), to = g.children.indexOf(leaf);
        g.children.splice(from, 1); g.children.splice(to, 0, d.leaf);
        g.currentTab = g.children.indexOf(cur);
        try { g.recomputeChildrenDimensions && g.recomputeChildrenDimensions(); app.workspace.requestSaveLayout && app.workspace.requestSaveLayout(); app.workspace.trigger("layout-change"); } catch (err) { /* ok */ }
        strip.dataset.sig = ""; build(g);
      });
      strip.appendChild(t);
    });
    strip.scrollLeft = scroll;
    const cur = strip.querySelector(".is-cur"); if (cur && !strip.dataset.seen) { cur.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  const all = () => { try { for (const g of rootGroups()) build(g); } catch (e) { console.error("[basalt-tabs]", e); } };
  const t = setInterval(() => {
    if (!(window.app && app.workspace && app.workspace.layoutReady && window.__bsApi)) return;
    clearInterval(t); all();
    for (const ev of ["layout-change", "active-leaf-change", "file-open"]) app.workspace.on(ev, () => setTimeout(all, 30));
    setInterval(all, 600); // titles change after a note is renamed or a view finishes loading
  }, 600);
})();
