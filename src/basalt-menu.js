// Basalt compact menus: a long right-click menu (10+ items) is shown in columns - Вид / Файл / Путь и связи - with a bottom bar
// "Найти" + "Закрыть ▾" instead of twenty-five rows. Items, callbacks and submenus are the original ones; only the drawing changes.
(() => {
  "use strict";
  const MIN_ITEMS = 4, COLS_FROM = 10;
  const css = document.createElement("style");
  css.textContent = `
    .bm-pop { position: fixed; z-index: 60; display: flex; flex-direction: column; gap: 4px; padding: 6px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto;
      background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 10px; box-shadow: var(--shadow-l, 0 8px 24px rgba(0,0,0,.35)); font-size: var(--font-ui-small); color: var(--text-normal); user-select: none; }
    .bm-cols { display: flex; gap: 6px; align-items: stretch; }
    .bm-col { display: flex; flex-direction: column; min-width: 168px; }
    .bm-col + .bm-col { border-left: 1px solid var(--background-modifier-border); padding-left: 6px; }
    .bm-h { padding: 5px 8px 3px; font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--text-faint); }
    .bm-i { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 5px; cursor: pointer; white-space: nowrap; }
    .bm-i:hover, .bm-i.is-on { background: var(--background-modifier-hover); }
    .bm-i.is-off { opacity: .45; pointer-events: none; }
    .bm-i.is-danger, .bm-i.is-danger .bm-ic { color: var(--text-error, #e5675f); }
    .bm-ic { display: inline-flex; width: 16px; height: 16px; flex: none; color: var(--text-muted); } .bm-ic svg { width: 16px; height: 16px; }
    .bm-t { flex: 1; overflow: hidden; text-overflow: ellipsis; } .bm-k { color: var(--text-faint); font-size: 11px; margin-left: 10px; }
    .menu.bm-sub { clip-path: none !important; border-radius: 10px !important; padding: 6px !important; background: var(--background-primary) !important; border: 1px solid var(--background-modifier-border) !important; box-shadow: var(--shadow-l, 0 8px 24px rgba(0,0,0,.35)) !important; font-size: var(--font-ui-small); }
    .menu.bm-sub .menu-item { border-radius: 6px; padding: 6px 10px; } .menu.bm-sub .menu-item:hover, .menu.bm-sub .menu-item.selected { background: var(--background-modifier-hover); }
    .bm-sep { height: 1px; background: var(--background-modifier-border); margin: 4px 2px; }
    .bm-bar { display: flex; gap: 6px; align-items: center; border-top: 1px solid var(--background-modifier-border); padding-top: 6px; margin-top: 2px; }
    .bm-find { flex: 1; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); color: var(--text-muted); cursor: text; }
    .bm-find:hover { border-color: var(--background-modifier-border-hover); }
    .bm-split { display: flex; border-radius: 6px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); }
    .bm-split > div { display: flex; align-items: center; gap: 6px; padding: 7px 10px; cursor: pointer; }
    .bm-split > div:hover { background: var(--background-modifier-hover); } .bm-split > div + div { border-left: 1px solid var(--background-modifier-border); padding: 7px 8px; }
    .bm-drop { position: fixed; z-index: 61; min-width: 190px; padding: 5px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; box-shadow: var(--shadow-l, 0 8px 24px rgba(0,0,0,.35)); font-size: var(--font-ui-small); }
  `;
  document.head.appendChild(css);


  const RX = {
    close: /^закрыть/i, tr: /^перевести/i, find: /^(найти|заменить)/i, danger: /удалить/i,
    view: /разделить|в нов(ом|ое) окн|просмотр|исходного кода|структур|режим/i,
    path: /путь|проводник|менеджер|в папке|приложении по умолчанию|граф|ссылк|истори|верси|свойства файла|открыть свойства/i,
    file: /переименовать|переместить|закладк|объединить|закреп|открепить|свойств|экспорт/i,
  };
  const bucket = (t) => (RX.close.test(t) ? "close" : RX.tr.test(t) ? "tr" : RX.find.test(t) ? "find" : RX.view.test(t) ? "view" : RX.path.test(t) ? "path" : RX.danger.test(t) || RX.file.test(t) ? "file" : "other");

  let cur = null;
  function closeAll() { if (cur) { cur.remove(); cur = null; } document.querySelectorAll(".bm-drop").forEach((x) => x.remove()); document.removeEventListener("mousedown", onDown, true); document.removeEventListener("keydown", onKey, true); window.removeEventListener("blur", closeAll); }
  function onDown(e) { if (!e.target.closest(".bm-pop, .bm-drop")) closeAll(); }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeAll(); } }

  const txt = (it) => (it.titleEl ? it.titleEl.textContent : "").trim();
  function run(menu, it, ev, row) {
    if (it.submenu && it.submenu.items && it.submenu.items.length) {
      const r = row.getBoundingClientRect(); it.submenu._bmRaw = true;
      const pr = row.closest(".bm-pop").getBoundingClientRect(); it.submenu.showAtPosition({ x: pr.right + 4, y: r.top - 6 });
      const dm = it.submenu.dom; if (dm) { dm.classList.add("bm-sub"); const h = dm.getBoundingClientRect().height; dm.style.left = (pr.right + 4) + "px"; dm.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.top - 6)) + "px"; }
      return;
    }
    closeAll();
    setTimeout(() => { try { if (it.callback) it.callback(ev); } catch (err) { console.error("[basalt-menu]", err); } }, 0);
  }

  function row(menu, it, ev) {
    const d = document.createElement("div"); d.className = "bm-i";
    const ic = document.createElement("span"); ic.className = "bm-ic"; if (it.iconEl) ic.innerHTML = it.iconEl.innerHTML; d.appendChild(ic);
    const t = document.createElement("span"); t.className = "bm-t"; t.textContent = (it.checked ? "✓ " : "") + txt(it); d.appendChild(t);
    if (it.submenu && it.submenu.items && it.submenu.items.length) { const k = document.createElement("span"); k.className = "bm-k"; k.textContent = "›"; d.appendChild(k); }
    if (it.disabled) d.classList.add("is-off");
    if ((it.dom && it.dom.classList.contains("is-warning")) || RX.danger.test(txt(it))) d.classList.add("is-danger");
    d.addEventListener("click", (e) => { e.stopPropagation(); run(menu, it, e, d); });
    return d;
  }

  function layout(menu, ev) {
    const seen = new Set(), items = menu.items.filter((x) => { if (!x.titleEl || !txt(x) || seen.has(txt(x))) return false; seen.add(txt(x)); return true; });
    const rest = [], find = [], close = [], tr = [];
    for (const it of items) { const b = bucket(txt(it)); (b === "close" ? close : b === "tr" ? tr : b === "find" ? find : rest).push([b, it]); }
    const known = rest.filter(([b]) => b !== "other").length;
    const cols = [];
    if (items.length < COLS_FROM) cols.push({ h: "", items: rest.map((x) => x[1]) });
    else if (known >= Math.ceil(rest.length * 0.6)) {
      const defs = { view: "Вид", file: "Файл", path: "Путь и связи" };
      const m = { view: [], file: [], path: [] };
      for (const [b, it] of rest) if (b !== "other") m[b === "view" || b === "path" ? b : "file"].push(it);
      for (const [b, it] of rest) if (b === "other") { const k = Object.keys(m).sort((a, c) => m[a].length - m[c].length)[0]; m[k].push(it); }
      for (const k of ["view", "file", "path"]) if (m[k].length) { m[k].sort((a, c) => (RX.danger.test(txt(a)) ? 1 : 0) - (RX.danger.test(txt(c)) ? 1 : 0)); cols.push({ h: defs[k], items: m[k] }); }
    } else {
      const n = Math.min(3, Math.max(2, Math.ceil(rest.length / 9))), per = Math.ceil(rest.length / n);
      for (let i = 0; i < rest.length; i += per) cols.push({ h: "", items: rest.slice(i, i + per).map((x) => x[1]) });
    }
    const live = (a) => a.map((x) => x[1]).filter((i) => i.callback && !i.disabled);
    return { cols, find: live(find), tr: live(tr), close: close.map((x) => x[1]) };
  }

  function show(menu, x, y, ev) {
    closeAll();
    try { menu.sort && menu.sort(); } catch (e) { /* unsorted */ }
    const L = layout(menu, ev);
    const pop = document.createElement("div"); pop.className = "bm-pop";
    const cols = document.createElement("div"); cols.className = "bm-cols";
    for (const c of L.cols) {
      const col = document.createElement("div"); col.className = "bm-col";
      if (c.h) { const h = document.createElement("div"); h.className = "bm-h"; h.textContent = c.h; col.appendChild(h); }
      for (const it of c.items) col.appendChild(row(menu, it, ev));
      cols.appendChild(col);
    }
    pop.appendChild(cols);
    if (L.find.length || L.tr.length || L.close.length) {
      const bar = document.createElement("div"); bar.className = "bm-bar";
      if (L.find.length) {
        const f = document.createElement("div"); f.className = "bm-find"; f.innerHTML = '<span class="bm-ic"></span><span class="bm-t">Найти в файле</span>';
        try { window.__bsApi.setIcon(f.firstChild, "lucide-search"); } catch (e) { /* no icon */ }
        f.addEventListener("click", (e) => run(menu, L.find[0], e, f)); bar.appendChild(f);
        if (L.find[1]) { const r = document.createElement("div"); r.className = "bm-split"; r.innerHTML = '<div><span class="bm-ic"></span>Заменить</div>'; try { window.__bsApi.setIcon(r.querySelector(".bm-ic"), "lucide-replace"); } catch (e) { /* no icon */ } r.firstChild.addEventListener("click", (e) => run(menu, L.find[1], e, r)); bar.appendChild(r); }
      } else { const sp = document.createElement("div"); sp.style.flex = "1"; bar.appendChild(sp); }
      if (L.tr.length) {
        const q = document.createElement("div"); q.className = "bm-split"; q.innerHTML = '<div><span class="bm-ic"></span>Перевести</div>';
        try { window.__bsApi.setIcon(q.querySelector(".bm-ic"), "lucide-languages"); } catch (e) { /* no icon */ }
        q.firstChild.addEventListener("click", (e) => run(menu, L.tr[0], e, q)); bar.appendChild(q);
      }
      if (L.close.length) {
        const main = L.close.find((i) => /^закрыть$/i.test(txt(i))) || L.close[0], more = L.close.filter((i) => i !== main);
        const s = document.createElement("div"); s.className = "bm-split";
        const a = document.createElement("div"); a.innerHTML = '<span class="bm-ic"></span>Закрыть'; try { window.__bsApi.setIcon(a.firstChild, "lucide-x"); } catch (e) { /* no icon */ }
        a.addEventListener("click", (e) => run(menu, main, e, a)); s.appendChild(a);
        if (more.length) {
          const b = document.createElement("div"); b.innerHTML = '<span class="bm-ic"></span>'; try { window.__bsApi.setIcon(b.firstChild, "lucide-chevron-down"); } catch (e) { b.textContent = "▾"; }
          b.addEventListener("click", (e) => {
            e.stopPropagation(); document.querySelectorAll(".bm-drop").forEach((z) => z.remove());
            const d = document.createElement("div"); d.className = "bm-drop";
            more.forEach((it, k) => { const r = row(menu, it, e); if (/все/i.test(txt(it))) r.classList.add("is-danger"); if (k && /все/i.test(txt(it))) { const sep = document.createElement("div"); sep.className = "bm-sep"; d.appendChild(sep); } d.appendChild(r); });
            const pr = b.closest(".bm-pop").getBoundingClientRect(); d.style.width = pr.width + "px"; d.style.boxSizing = "border-box"; document.body.appendChild(d); const dr = d.getBoundingClientRect();
            d.style.left = pr.left + "px"; d.style.top = (pr.bottom + 4 + dr.height <= innerHeight - 8 ? pr.bottom + 4 : Math.max(8, pr.top - dr.height - 4)) + "px";
          });
          s.appendChild(b);
        }
        bar.appendChild(s);
      }
      pop.appendChild(bar);
    }
    document.body.appendChild(pop); cur = pop;
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    pop.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
    setTimeout(() => { document.addEventListener("mousedown", onDown, true); document.addEventListener("keydown", onKey, true); window.addEventListener("blur", closeAll); }, 0);
  }

  const t = setInterval(() => {
    const M = window.__bsApi && window.__bsApi.Menu; if (!M || !M.prototype) return; clearInterval(t);
    const P = M.prototype, atMouse = P.showAtMouseEvent, atPos = P.showAtPosition;
    const eligible = (m) => !m._bmRaw && m.items && m.items.filter((x) => x.titleEl).length >= MIN_ITEMS;
    P.showAtMouseEvent = function (e) { if (eligible(this)) { try { show(this, e.clientX, e.clientY, e); return this; } catch (err) { console.error("[basalt-menu]", err); } } return atMouse.apply(this, arguments); };
    P.showAtPosition = function (p) { if (eligible(this)) { try { show(this, p.x, p.y, null); return this; } catch (err) { console.error("[basalt-menu]", err); } } return atPos.apply(this, arguments); };
    window.__bsMenu = { show, closeAll };
  }, 300);
})();
