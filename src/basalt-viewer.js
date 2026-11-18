// Image viewer: a small app in an overlay to look at a picture in detail. Left mouse drags, wheel zooms around the cursor, double click
// toggles fit / 100%, arrows go to the neighbouring pictures of the folder. Opened from a card (right click -> "Просмотр…" or the button
// over its title), from the file list menu, or with window.__bsViewer.open(file).
(() => {
  "use strict";
  const lk = (e) => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : String(e.key).toLowerCase()); // the letter of the key, whatever layout (Russian too)

  const IMG = /^(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i;
  const css = document.createElement("style");
  css.textContent = `
    .bsv { position: fixed; inset: 0; z-index: 1100; background: rgba(10,8,7,.97); display: flex; flex-direction: column; user-select: none; animation: bsv-in .16s ease-out; }
    @keyframes bsv-in { from { opacity: 0; } to { opacity: 1; } }
    .bsv-stage { flex: 1; position: relative; overflow: hidden; cursor: grab; touch-action: none; }
    .bsv-stage.is-drag { cursor: grabbing; }
    .bsv-stage img { position: absolute; left: 0; top: 0; transform-origin: 0 0; max-width: none; max-height: none; will-change: transform; -webkit-user-drag: none; user-select: none; pointer-events: none; }
    .bsv-stage img.is-px { image-rendering: pixelated; }
    .bsv-title { position: absolute; left: 18px; top: 14px; display: flex; flex-direction: column; gap: 2px; padding: 8px 14px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);  max-width: 46vw; }
    .bsv-title b { color: var(--text-normal); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bsv-title small { color: var(--text-muted); }
    .bsv-x { position: absolute; right: 18px; top: 14px; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; border-radius: 0; clip-path: var(--bs-clip);  background: var(--background-secondary); border: 1px solid var(--background-modifier-border); color: var(--text-muted); cursor: pointer; }
    .bsv-x:hover { background: var(--interactive-accent); border-color: var(--interactive-accent); color: var(--text-on-accent, #fff); } .bsv-x svg { width: 18px; height: 18px; }
    .bsv-tb { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); display: flex; align-items: center; gap: 2px; padding: 5px 8px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);   }
    .bsv-tb button { background: transparent; box-shadow: none; clip-path: none; width: 34px; height: 34px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--bs-r); color: var(--text-muted); }
    .bsv-tb button:hover { background: var(--background-modifier-hover); color: var(--text-normal); } .bsv-tb button.is-on { background: color-mix(in srgb, var(--interactive-accent) 24%, transparent); color: var(--interactive-accent); }
    .bsv-tb svg { width: 18px; height: 18px; } .bsv-tb .sep { width: 1px; height: 22px; margin: 0 6px; background: var(--background-modifier-border); }
    .bsv-tb .pct { min-width: 54px; text-align: center; color: var(--text-normal); font-variant-numeric: tabular-nums; font-size: var(--font-ui-small); cursor: pointer; padding: 6px 4px; border-radius: var(--bs-r); } .bsv-tb .pct:hover { background: var(--background-modifier-hover); }
    .bsv-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 46px; height: 74px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); cursor: pointer; border-radius: 0; clip-path: var(--bs-clip);  background: var(--background-secondary); border: 1px solid var(--background-modifier-border); opacity: .7; }
    .bsv-nav:hover { opacity: 1; color: var(--text-normal); } .bsv-nav.l { left: 18px; } .bsv-nav.r { right: 18px; } .bsv-nav svg { width: 22px; height: 22px; }
    .bsv-info { position: absolute; right: 18px; top: 64px; width: 280px; padding: 12px 14px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);  display: none; font-size: var(--font-ui-small); line-height: 1.7; }
    .bsv-info.is-on { display: block; } .bsv-info span { color: var(--text-muted); display: inline-block; width: 92px; } .bsv-info div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .canvas-node-label .bsv-open { display: inline-flex; vertical-align: middle; margin-left: 6px; padding: 1px 5px; border-radius: 4px; cursor: pointer; color: var(--text-muted); } .canvas-node-label .bsv-open:hover { color: var(--interactive-accent); background: var(--background-modifier-hover); }
    .canvas-node-label .bsv-open svg { width: 13px; height: 13px; }
  `;
  document.head.appendChild(css);

  let cur = null;
  function open(file) {
    if (!file) return; if (cur) cur.close();
    const siblings = () => (file.parent ? file.parent.children : app.vault.getFiles()).filter((f) => f.extension && IMG.test(f.extension)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const ic = (el, name) => { try { window.__bsApi.setIcon(el, name); } catch (e) { el.textContent = "•"; } return el; };
    const wrap = document.createElement("div"); wrap.className = "bsv";
    wrap.innerHTML = '<div class="bsv-stage"><img alt="" draggable="false"></div>';
    const stage = wrap.querySelector(".bsv-stage"), img = stage.querySelector("img");
    const title = document.createElement("div"); title.className = "bsv-title"; title.innerHTML = "<b></b><small></small>";
    const closeB = ic(document.createElement("div"), "lucide-x"); closeB.className = "bsv-x"; closeB.title = "Закрыть (Esc)";
    const navL = ic(document.createElement("div"), "lucide-chevron-left"), navR = ic(document.createElement("div"), "lucide-chevron-right"); navL.className = "bsv-nav l"; navR.className = "bsv-nav r";
    const info = document.createElement("div"); info.className = "bsv-info";
    const tb = document.createElement("div"); tb.className = "bsv-tb";
    stage.append(title, closeB, navL, navR, info, tb);
    const st = { k: 1, x: 0, y: 0, rot: 0, flip: 1 };
    const pctEl = document.createElement("div"); pctEl.className = "pct"; pctEl.title = "Реальный размер (1)";
    const btn = (icon, tip, fn) => { const b = ic(document.createElement("button"), icon); b.title = tip; b.addEventListener("click", (e) => { e.stopPropagation(); fn(b); }); tb.appendChild(b); return b; };
    const sep = () => { const s = document.createElement("span"); s.className = "sep"; tb.appendChild(s); };
    const dims = () => (st.rot % 180 ? [img.naturalHeight, img.naturalWidth] : [img.naturalWidth, img.naturalHeight]);
    const apply = () => { img.style.transform = `translate(${st.x}px,${st.y}px) rotate(${st.rot}deg) scale(${st.k * st.flip},${st.k})`; img.classList.toggle("is-px", st.k >= 6); pctEl.textContent = Math.round(st.k * 100) + "%"; };
    const place = () => { const r = stage.getBoundingClientRect(), a = (st.rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a), cx = img.naturalWidth / 2, cy = img.naturalHeight / 2; st.x = r.width / 2 - st.k * (st.flip * cx * cos - cy * sin); st.y = r.height / 2 - st.k * (st.flip * cx * sin + cy * cos); apply(); };
    const fit = () => { const r = stage.getBoundingClientRect(), [w, h] = dims(); st.k = Math.min((r.width - 40) / w, (r.height - 150) / h, 1) || 1; place(); };
    const zoomAt = (f, px, py) => { const nk = Math.max(0.02, Math.min(60, st.k * f)), q = nk / st.k; st.x = px - (px - st.x) * q; st.y = py - (py - st.y) * q; st.k = nk; apply(); };
    const center = (f) => { const r = stage.getBoundingClientRect(); zoomAt(f, r.width / 2, r.height / 2); };
    btn("lucide-minus", "Уменьшить (−)", () => center(1 / 1.3)); tb.appendChild(pctEl); btn("lucide-plus", "Увеличить (+)", () => center(1.3));
    sep();
    btn("lucide-maximize", "По размеру окна (0)", fit); btn("lucide-scan", "Реальный размер 100% (1)", () => center(1 / st.k));
    sep();
    btn("lucide-rotate-ccw", "Повернуть влево (Shift+R)", () => { st.rot = (st.rot + 270) % 360; fit(); }); btn("lucide-rotate-cw", "Повернуть вправо (R)", () => { st.rot = (st.rot + 90) % 360; fit(); }); btn("lucide-flip-horizontal", "Отразить (F)", () => { st.flip *= -1; place(); });
    sep();
    btn("lucide-copy", "Копировать картинку (Ctrl+C)", async () => { try { const r = await fetch(img.src), b = await r.blob(); const png = b.type === "image/png" ? b : await new Promise((res) => { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d").drawImage(img, 0, 0); c.toBlob(res, "image/png"); }); await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]); new window.__bsApi.Notice("Картинка скопирована", 1500); } catch (e) { new window.__bsApi.Notice("Не удалось скопировать: " + e.message); } });
    btn("lucide-folder-open", "Показать в папке", () => window.__bsReveal(app.vault.adapter.basePath + "/" + file.path));
    const infoB = btn("lucide-info", "Сведения (I)", () => { info.classList.toggle("is-on"); infoB.classList.toggle("is-on", info.classList.contains("is-on")); });
    const load = (f) => {
      file = f; title.querySelector("b").textContent = f.name; title.querySelector("small").textContent = "";
      img.onload = () => {
        title.querySelector("small").textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${(f.stat.size / 1048576).toFixed(2)} МБ`;
        info.innerHTML = ""; for (const [k, v] of [["Файл", f.name], ["Путь", f.path], ["Размер", `${img.naturalWidth} × ${img.naturalHeight} px`], ["Вес", `${(f.stat.size / 1048576).toFixed(2)} МБ`], ["Изменён", new Date(f.stat.mtime).toLocaleString()]]) { const d = document.createElement("div"); d.innerHTML = "<span></span><i></i>"; d.querySelector("span").textContent = k; d.querySelector("i").textContent = v; d.querySelector("i").style.fontStyle = "normal"; info.appendChild(d); }
        st.rot = 0; st.flip = 1; fit();
      };
      img.src = app.vault.getResourcePath(f);
    };
    const go = (d) => { const l = siblings(), i = l.findIndex((x) => x.path === file.path); if (i < 0 || l.length < 2) return; load(l[(i + d + l.length) % l.length]); };
    stage.addEventListener("wheel", (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    // any button (left, middle, right) drags the picture (pointer capture on the stage: the image itself takes no events)
    let drag = null;
    stage.addEventListener("pointerdown", (e) => { if (e.button > 2 || e.target.closest(".bsv-tb, .bsv-nav, .bsv-x, .bsv-title, .bsv-info")) return; e.preventDefault(); drag = { x: e.clientX - st.x, y: e.clientY - st.y, moved: false, sx: e.clientX, sy: e.clientY }; stage.setPointerCapture(e.pointerId); stage.classList.add("is-drag"); });
    stage.addEventListener("pointermove", (e) => { if (!drag) return; if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 2) drag.moved = true; st.x = e.clientX - drag.x; st.y = e.clientY - drag.y; apply(); });
    const up = () => { drag = null; stage.classList.remove("is-drag"); }; stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
    stage.addEventListener("dragstart", (e) => e.preventDefault());
    stage.addEventListener("contextmenu", (e) => e.preventDefault()); // right button drags too
    stage.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); }); // no autoscroll circle on the middle button
    stage.addEventListener("dblclick", (e) => { if (e.target.closest(".bsv-tb, .bsv-nav, .bsv-x, .bsv-title, .bsv-info")) return; if (Math.abs(st.k - 1) < 0.02) fit(); else { const r = stage.getBoundingClientRect(); zoomAt(1 / st.k, e.clientX - r.left, e.clientY - r.top); } });
    pctEl.addEventListener("click", () => center(1 / st.k));
    navL.addEventListener("click", () => go(-1)); navR.addEventListener("click", () => go(1)); closeB.addEventListener("click", () => close());
    const key = (e) => {
      const k = lk(e);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); go(-1); } else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); go(1); }
      else if (e.key === "+" || e.key === "=") center(1.3); else if (e.key === "-") center(1 / 1.3); else if (e.key === "0") fit(); else if (e.key === "1") center(1 / st.k);
      else if (k === "r") { st.rot = (st.rot + (e.shiftKey ? 270 : 90)) % 360; fit(); } else if (k === "f") { st.flip *= -1; place(); } else if (k === "i") infoB.click();
    };
    const onResize = () => { if (st.k <= 1) fit(); };
    const close = () => { document.removeEventListener("keydown", key, true); window.removeEventListener("resize", onResize); wrap.remove(); cur = null; };
    document.addEventListener("keydown", key, true); window.addEventListener("resize", onResize);
    document.body.appendChild(wrap); load(file); cur = { close };
  }

  // a small button over the title of every picture card
  function decorate() {
    for (const leaf of app.workspace.getLeavesOfType("canvas")) {
      const c = leaf.view && leaf.view.canvas; if (!c) continue;
      for (const n of c.nodes.values()) {
        if (!n.file || !IMG.test(n.file.extension || "") || !n.nodeEl) continue;
        const lab = n.nodeEl.querySelector(".canvas-node-label"); if (!lab || lab.querySelector(".bsv-open")) continue;
        const b = document.createElement("span"); b.className = "bsv-open"; b.title = "Просмотр";
        try { window.__bsApi.setIcon(b, "lucide-zoom-in"); } catch (e) { b.textContent = "🔍"; }
        for (const ev of ["pointerdown", "mousedown", "dblclick"]) b.addEventListener(ev, (e) => e.stopPropagation());
        b.addEventListener("click", (e) => { e.stopPropagation(); open(n.file); }); lab.appendChild(b);
      }
    }
  }
  window.__bsViewer = { open };
  const t = setInterval(() => {
    if (!(window.app && app.workspace && app.workspace.layoutReady && app.commands && window.__bsApi)) return;
    clearInterval(t);
    app.workspace.on("file-menu", (menu, f) => { if (f && f.extension && IMG.test(f.extension)) menu.addItem((i) => i.setTitle("Просмотр…").setIcon("lucide-zoom-in").setSection("open").onClick(() => open(f))); });
    app.commands.addCommand({ id: "basalt:view-image", name: "Просмотр открытой картинки", checkCallback: (chk) => { const f = app.workspace.getActiveFile(); if (!f || !IMG.test(f.extension)) return false; if (!chk) open(f); return true; } });
    let timer = 0; new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(decorate, 250); }).observe(document.body, { childList: true, subtree: true }); decorate();
  }, 800);
})();
