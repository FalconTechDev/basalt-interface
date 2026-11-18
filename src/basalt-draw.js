// Basalt ink. On a canvas the drawing is a layer of the board itself (kept in the canvas file as "fpInk": no cards, no frames):
// pen with shape snapping (hold still at the end of a stroke), line, arrow, rectangle, ellipse, eraser, colour palette.
// In notes a drawing is a ```basalt-draw block with the same strokes (editor opens from the block or with Alt+D).
(() => {
  "use strict";
  const lk = (e) => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : String(e.key).toLowerCase()); // the letter of the key, whatever layout (Russian too)

  const SVGNS = "http://www.w3.org/2000/svg";
  const PALETTE = [["default", null], ["red", "#fb464c"], ["orange", "#e9973f"], ["yellow", "#e0de71"], ["green", "#44cf6e"], ["cyan", "#53dfdd"], ["purple", "#a882ff"]];
  const TOOLS = [["select", "lucide-mouse-pointer-2", "Выделение: двигать, перекрашивать, Delete (V)"], ["pen", "lucide-pencil", "Кисть (задержка в конце штриха выравнивает фигуру)"], ["line", "lucide-slash", "Прямая линия"], ["arrow", "lucide-move-up-right", "Стрелка"], ["rect", "lucide-square", "Прямоугольник"], ["ellipse", "lucide-circle", "Эллипс / круг"], ["hl", "lucide-highlighter", "Маркер (H)"], ["text", "lucide-type", "Текст (T): клик и печатай, Enter — готово, Shift+Enter — новая строка"], ["erase", "lucide-eraser", "Ластик (E)"]];
  const css = document.createElement("style");
  css.textContent = `
    .bsink, .bsink-live { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 20; }
    .bsink-live { z-index: 21; }
    /* the drawing lies under the controls of the board: it never covers the buttons, the minimap or the toolbars */
    .canvas-wrapper .canvas-controls, .canvas-wrapper .fp-minimap, .canvas-wrapper .canvas-card-menu, .canvas-wrapper .canvas-menu-container, .canvas-wrapper .canvas-selection-menu { z-index: 40 !important; }
    .canvas-wrapper { overflow: hidden; }
    .bsink-on, .bsink-on * { cursor: crosshair !important; }
    .bsink-on .canvas-card-menu { display: none !important; }
    .bsd { position: relative; margin: 4px 0; line-height: 0; } .bsd svg { width: 100%; height: auto; display: block; }
    .bsd-edit { position: absolute; top: 4px; right: 4px; line-height: 1; padding: 3px 8px; font-size: 12px; opacity: 0; transition: opacity .12s; z-index: 2; }
    .bsd:hover .bsd-edit { opacity: .9; }
    .canvas-node.bsd-card .canvas-node-container { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }
    .canvas-node.bsd-card .canvas-node-content { background: transparent !important; padding: 0 !important; overflow: visible; }
    .bsd-tb { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 30; display: flex; align-items: center; gap: 2px; padding: 4px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);   }
    .bsd-tb button { background: transparent; box-shadow: none; clip-path: none; width: 34px; height: 34px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--bs-r); color: var(--text-muted); }
    .bsd-tb button:hover { background: var(--background-modifier-hover); color: var(--text-normal); } .bsd-tb button.is-on { background: color-mix(in srgb, var(--interactive-accent) 24%, transparent); color: var(--interactive-accent); }
    .bsd-tb button svg { width: 18px; height: 18px; } .bsd-sep { width: 1px; height: 22px; margin: 0 6px; background: var(--background-modifier-border); }
    .canvas-wrapper:has(.bsd-tb) .canvas-menu-container, .canvas-wrapper:has(.bsd-tb) .canvas-selection { display: none !important; }
    .bsd-dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--background-modifier-border-hover); display: inline-block; }
    .bsd-pop { position: absolute; bottom: 58px; left: 50%; transform: translateX(-50%); padding: 8px 12px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);   display: flex; gap: 12px; align-items: center; z-index: 31; }
    .bsd-pop .bsd-c { width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer; padding: 0; position: relative; transition: transform .08s; clip-path: none; box-shadow: none; } .bsd-pop .bsd-c:hover { transform: scale(1.08); }
    .bsd-pop .bsd-c.is-on { box-shadow: 0 0 0 3px var(--background-secondary), 0 0 0 5px var(--text-normal); }
    .bsd-pop .bsd-c.rainbow { background: conic-gradient(#fb464c, #e9973f, #e0de71, #44cf6e, #53dfdd, #a882ff, #fb464c); overflow: hidden; } .bsd-pop .bsd-c.rainbow input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
    .bsd-pop .bsd-w { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--bs-r); cursor: pointer; } .bsd-pop .bsd-w:hover { background: var(--background-modifier-hover); } .bsd-pop .bsd-w.is-on { background: color-mix(in srgb, var(--interactive-accent) 24%, transparent); }
    .bsd-pop .bsd-w i { display: block; border-radius: 50%; background: var(--text-normal); }
    .bsd-modal { width: min(980px, 94vw); max-width: none; height: min(720px, 90vh); display: flex; flex-direction: column; padding: 0; position: relative; }
    .bsd-surface { flex: 1; min-height: 0; position: relative; background: var(--background-primary-alt, var(--background-secondary)); touch-action: none; }
    .bsd-surface canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  `;
  document.head.appendChild(css);

  // ======================================================================== geometry
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; if (!l2) return dist(p, a); let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return dist(p, [a[0] + t * dx, a[1] + t * dy]); };
  const bboxOf = (pts) => { let x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12; for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };
  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    let md = 0, mi = 0; for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], pts[0], pts[pts.length - 1]); if (d > md) { md = d; mi = i; } }
    if (md <= eps) return [pts[0], pts[pts.length - 1]];
    return rdp(pts.slice(0, mi + 1), eps).slice(0, -1).concat(rdp(pts.slice(mi), eps));
  }
  const pathLen = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i], pts[i - 1]); return l; };
  // what did the hand mean? returns a stroke-shape or null (keep the freehand line, only smoothed)
  function recognize(pts, k) {
    if (pts.length < 4) return null;
    const len = pathLen(pts), chord = dist(pts[0], pts[pts.length - 1]); if (len * k < 24) return null;
    let dev = 0; for (const p of pts) dev = Math.max(dev, segDist(p, pts[0], pts[pts.length - 1]));
    if (chord / len > 0.9 && dev / len < 0.06) return { t: "l", a: pts[0], b: pts[pts.length - 1] };
    const bb = bboxOf(pts);
    if (chord < len * 0.22 && bb.w * k > 14 && bb.h * k > 14) {
      const cx = bb.x0 + bb.w / 2, cy = bb.y0 + bb.h / 2, rx = bb.w / 2, ry = bb.h / 2;
      let eErr = 0, rErr = 0;
      for (const p of pts) {
        eErr += Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1);
        rErr += Math.min(Math.abs(p[0] - bb.x0), Math.abs(p[0] - bb.x1), Math.abs(p[1] - bb.y0), Math.abs(p[1] - bb.y1)) / Math.min(bb.w, bb.h);
      }
      eErr /= pts.length; rErr /= pts.length;
      // corners tell a rectangle from an ellipse: a rectangle has points close to its corners
      const cornerHit = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]].filter((c) => pts.some((p) => dist(p, c) < Math.min(bb.w, bb.h) * 0.14)).length;
      if (rErr < 0.09 && rErr < eErr * 0.7 && cornerHit >= 3) return { t: "r", a: [bb.x0, bb.y0], b: [bb.x1, bb.y1] };
      if (eErr < 0.16) { let a = [bb.x0, bb.y0], b = [bb.x1, bb.y1]; if (Math.abs(bb.w - bb.h) / Math.max(bb.w, bb.h) < 0.18) { const s = (bb.w + bb.h) / 2; a = [cx - s / 2, cy - s / 2]; b = [cx + s / 2, cy + s / 2]; } return { t: "e", a, b }; }
    }
    return null;
  }
  const smoothPts = (pts, k) => { const s = rdp(pts, 1.2 / k); return s.length < 2 ? pts : s; };

  // ---- text strokes: { t: "t", a: [x, y], text, z: size in world px, c }
  const textFont = (s) => s.z + "px " + ((getComputedStyle(document.body).getPropertyValue("--font-interface") || "").trim() || "system-ui, sans-serif");
  let mctx = null;
  const textBox = (s) => { mctx = mctx || document.createElement("canvas").getContext("2d"); mctx.font = textFont(s); const lines = String(s.text || "").split("\n"); let w = 0; for (const l of lines) w = Math.max(w, mctx.measureText(l).width); return { x0: s.a[0], y0: s.a[1], x1: s.a[0] + w, y1: s.a[1] + lines.length * s.z * 1.25, w, h: lines.length * s.z * 1.25 }; };
  // the points that frame a stroke
  const ptsOf = (s) => (s.t === "t" ? (() => { const b = textBox(s); return [[b.x0, b.y0], [b.x1, b.y1]]; })() : s.p || [s.a, s.b]);
  // ======================================================================== drawing of one stroke
  const themeColor = () => (document.body.classList.contains("theme-light") ? "#2a211a" : "#ece4db");
  function trace(ctx, s) {
    ctx.beginPath();
    const t = s.t || "p";
    if (t === "p") {
      const p = s.p;
      if (p.length === 1) { ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[0][0] + 0.01, p[0][1]); return; }
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    } else if (t === "l" || t === "a") {
      ctx.moveTo(s.a[0], s.a[1]); ctx.lineTo(s.b[0], s.b[1]);
      if (t === "a") { const ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]), h = Math.max(10, s.w * 4); for (const d of [0.45, -0.45]) { ctx.moveTo(s.b[0], s.b[1]); ctx.lineTo(s.b[0] - h * Math.cos(ang + d), s.b[1] - h * Math.sin(ang + d)); } }
    } else if (t === "r") ctx.rect(Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.abs(s.b[0] - s.a[0]), Math.abs(s.b[1] - s.a[1]));
    else if (t === "e") ctx.ellipse((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, Math.abs(s.b[0] - s.a[0]) / 2, Math.abs(s.b[1] - s.a[1]) / 2, 0, 0, Math.PI * 2);
  }
  function paint(ctx, s) {
    if (s.t === "t") { if (s._hide) return; ctx.font = textFont(s); ctx.fillStyle = s.c || themeColor(); ctx.textBaseline = "top"; ctx.textAlign = "left"; String(s.text || "").split("\n").forEach((l, i) => ctx.fillText(l, s.a[0], s.a[1] + i * s.z * 1.25)); return; }
    trace(ctx, s); ctx.strokeStyle = s.c || (s.o ? "#e0de71" : themeColor()); ctx.lineWidth = s.w; ctx.lineCap = s.o ? "butt" : "round"; ctx.lineJoin = "round"; ctx.globalAlpha = s.o || 1; ctx.stroke(); ctx.globalAlpha = 1; }
  // does the point (x, y) touch the stroke within r?
  function touches(s, x, y, r) {
    const t = s.t || "p", P = [x, y], rr = r + (s.w || 0) / 2;
    if (t === "t") { const b = textBox(s); return x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r; }
    if (t === "p") { for (let i = 0; i < s.p.length; i++) { if (dist(s.p[i], P) < rr) return true; if (i && segDist(P, s.p[i - 1], s.p[i]) < rr) return true; } return false; }
    if (t === "l" || t === "a") return segDist(P, s.a, s.b) < rr;
    const x0 = Math.min(s.a[0], s.b[0]), x1 = Math.max(s.a[0], s.b[0]), y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]);
    if (t === "r") return [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]].some(([a, b]) => segDist(P, a, b) < rr);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 || 1, ry = (y1 - y0) / 2 || 1, d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return Math.abs(d - 1) * Math.min(rx, ry) < rr;
  }

  // for previews of a board (nested canvases, the graph, the version list): how a stroke is drawn and where it is
  window.__bsInk = { paint: (ctx, s) => paint(ctx, s), paintMin: (ctx, s, minW) => paint(ctx, { ...s, w: Math.max(s.w || 1, minW) }), state: (canvas) => { const L = layers.get(canvas); return L ? { strokes: L.strokes, ver: L.ver || 0 } : null; }, box: (s) => { const b = bboxOf(ptsOf(s)); const w = (s.w || 0) / 2; return [b.x0 - w, b.y0 - w, b.x1 + w, b.y1 + w]; } };
  // ======================================================================== the drawer: pointer logic shared by the canvas and the note editor
  // surface = { strokes, k(), toWorld(e), live (2d ctx with world transform applied), clearLive(), repaint(), changed() }
  const snapAngle = (a, w) => { const dx = w[0] - a[0], dy = w[1] - a[1], len = Math.hypot(dx, dy), step = Math.PI / 12, ang = Math.round(Math.atan2(dy, dx) / step) * step; return [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)]; };
  // resizing a stroke from a corner: the geometry of the original is scaled about the opposite corner
  const geomOf = (s) => ({ p: s.p ? s.p.map((q) => q.slice()) : null, a: s.a ? s.a.slice() : null, b: s.b ? s.b.slice() : null, z: s.z });
  const scaleStroke = (s, g, ox, oy, sx, sy) => {
    const f = (q) => [ox + (q[0] - ox) * sx, oy + (q[1] - oy) * sy];
    if (g.p) s.p = g.p.map(f); if (g.a) s.a = f(g.a); if (g.b) s.b = f(g.b); if (s.t === "t") s.z = Math.max(2, g.z * Math.abs(sx));
  };
  const moveStroke = (s, dx, dy) => { if (s.t === "t") s.a = [s.a[0] + dx, s.a[1] + dy]; else if (s.p) s.p = s.p.map((q) => [q[0] + dx, q[1] + dy]); else { s.a = [s.a[0] + dx, s.a[1] + dy]; s.b = [s.b[0] + dx, s.b[1] + dy]; } };
  function makeDrawer(surface, state) {
    // the selected stroke: a dashed frame on the live layer; the eraser: a ring of its size
    const showSel = () => { surface.clearLive(); const s = state.sel; if (!s || !surface.strokes.includes(s)) { state.sel = null; return; } const b = bboxOf(ptsOf(s)), k = surface.k(), pad = ((s.w || 0) / 2 + 5 / k), c = surface.live; c.save(); c.strokeStyle = "#c98d5b"; c.lineWidth = 1.5 / k; c.setLineDash([5 / k, 4 / k]); c.strokeRect(b.x0 - pad, b.y0 - pad, b.w + pad * 2, b.h + pad * 2); c.setLineDash([]);
      for (const q of [[b.x0 - pad, b.y0 - pad], [b.x1 + pad, b.y0 - pad], [b.x1 + pad, b.y1 + pad], [b.x0 - pad, b.y1 + pad]]) { c.fillStyle = "#1a1612"; c.strokeStyle = "#c98d5b"; c.lineWidth = 1.5 / k; c.fillRect(q[0] - 4 / k, q[1] - 4 / k, 8 / k, 8 / k); c.strokeRect(q[0] - 4 / k, q[1] - 4 / k, 8 / k, 8 / k); }
      c.restore(); };
    // which corner handle of the selected stroke is under w (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left) or -1
    const cornerAt = (w) => { const s = state.sel; if (!s) return -1; const b = bboxOf(ptsOf(s)), k = surface.k(), pad = ((s.w || 0) / 2 + 5 / k), cs = [[b.x0 - pad, b.y0 - pad], [b.x1 + pad, b.y0 - pad], [b.x1 + pad, b.y1 + pad], [b.x0 - pad, b.y1 + pad]]; for (let i = 0; i < 4; i++) if (Math.hypot(w[0] - cs[i][0], w[1] - cs[i][1]) < 9 / k) return i; return -1; };
    let openEd = null; // commits the text box that is open, if any
    const openText = (w) => {
      if (!surface.host) return;
      let st = null; for (let i = surface.strokes.length - 1; i >= 0; i--) if (surface.strokes[i].t === "t" && touches(surface.strokes[i], w[0], w[1], 4 / surface.k())) { st = surface.strokes[i]; break; }
      const k = surface.k(), z = st ? st.z : Math.max(4, (10 + state.width * 3) / k), a = st ? st.a : w, at = surface.toScreen(a);
      const ta = document.createElement("textarea"); ta.value = st ? st.text : ""; ta.rows = 1; ta.spellcheck = false;
      ta.style.cssText = "position:absolute;left:" + at[0] + "px;top:" + at[1] + "px;z-index:45;min-width:90px;margin:0;padding:0 2px;border:1px dashed #c98d5b;border-radius:2px;background:rgba(0,0,0,.28);outline:none;resize:none;overflow:hidden;white-space:pre;box-shadow:none;line-height:1.25;font:" + (z * k) + "px/1.25 " + textFont({ z: 1 }).replace(/^1px /, "") + ";color:" + ((st && st.c) || state.color || themeColor());
      surface.host.appendChild(ta);
      const fit = () => { const lines = ta.value.split(String.fromCharCode(10)); ta.rows = lines.length; ta.style.width = "10px"; ta.style.width = Math.max(90, ta.scrollWidth + 6) + "px"; };
      if (st) { st._hide = true; surface.repaint(); }
      let done = false;
      const finish = (keep) => {
        if (done) return; done = true; openEd = null; const text = ta.value.replace(/\s+$/, ""); ta.remove();
        if (st) { st._hide = false; if (keep && text !== st.text) { if (text) st.text = text; else surface.strokes.splice(surface.strokes.indexOf(st), 1); surface.repaint(); surface.changed(); } else surface.repaint(); }
        else if (keep && text) { surface.strokes.push({ t: "t", a, text, z, c: state.color }); surface.repaint(); surface.changed(); }
      };
      openEd = () => finish(true);
      ta.addEventListener("dragstart", (e) => e.preventDefault()); ta.addEventListener("input", fit);
      ta.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); finish(false); } else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(true); } });
      ta.addEventListener("pointerdown", (e) => e.stopPropagation());
      ta.addEventListener("blur", () => finish(true));
      fit(); setTimeout(() => { ta.focus(); ta.select(); }, 0);
    };
    const ring = (w) => { surface.clearLive(); const c = surface.live, k = surface.k(); c.save(); c.strokeStyle = "rgba(200,200,200,.8)"; c.lineWidth = 1.2 / k; c.beginPath(); c.arc(w[0], w[1], 9 / k, 0, Math.PI * 2); c.stroke(); c.restore(); };
    let cur = null, holdT = 0, last = null;
    const live = () => { surface.clearLive(); if (cur) paint(surface.live, cur.preview || cur.s); };
    const hold = () => {
      clearTimeout(holdT);
      if (state.tool !== "pen" || !state.snap || !cur || cur.erase) return;
      holdT = setTimeout(() => { if (!cur || cur.s.t !== "p") return; const sh = recognize(cur.s.p, surface.k()); if (sh) { cur.s = { ...cur.s, ...sh, p: undefined }; cur.snapped = true; live(); } }, 480);
    };
    const eraseAt = (w) => { const r = 9 / surface.k(); const n = surface.strokes.length; for (let i = surface.strokes.length - 1; i >= 0; i--) if (touches(surface.strokes[i], w[0], w[1], r)) { surface.strokes.splice(i, 1); } if (surface.strokes.length !== n) { surface.repaint(); cur.erased = true; } };
    return {
      down(e) {
        if (openEd) openEd();
        const w = surface.toWorld(e); last = [e.clientX, e.clientY];
        if (state.tool === "text") { cur = null; openText(w); return; }
        if (state.tool === "erase") { cur = { erase: true }; eraseAt(w); return; }
        if (state.tool === "select") {
          const ci = cornerAt(w);
          if (ci >= 0) { const b = bboxOf(ptsOf(state.sel)), cs = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]; cur = { resize: true, c: cs[ci], o: cs[(ci + 2) % 4], g: geomOf(state.sel), moved: false }; return; }
          const r = 8 / surface.k(); let hit = null; for (let i = surface.strokes.length - 1; i >= 0; i--) if (touches(surface.strokes[i], w[0], w[1], r)) { hit = surface.strokes[i]; break; }
          state.sel = hit; cur = hit ? { move: true, last: w, moved: false } : null; showSel(); return;
        }
        const base = { c: state.color, w: state.tool === "hl" ? Math.max(10, state.width * 4) : state.width, ...(state.tool === "hl" ? { o: 0.38 } : {}) };
        cur = { s: state.tool === "pen" || state.tool === "hl" ? { ...base, t: "p", p: [w] } : { ...base, t: state.tool === "line" ? "l" : state.tool === "arrow" ? "a" : state.tool === "rect" ? "r" : "e", a: w, b: w }, start: w };
        hold();
      },
      move(e) {
        if (!cur) return; const w = surface.toWorld(e);
        if (cur.erase) { eraseAt(w); ring(w); return; }
        if (cur.resize) {
          const s = state.sel, dx0 = cur.c[0] - cur.o[0], dy0 = cur.c[1] - cur.o[1];
          let sx = Math.abs(dx0) > 1e-6 ? (w[0] - cur.o[0]) / dx0 : 1, sy = Math.abs(dy0) > 1e-6 ? (w[1] - cur.o[1]) / dy0 : 1;
          if (s.t === "t" || e.shiftKey) { const m = Math.max(Math.abs(sx), Math.abs(sy)) || 1; sx = m * Math.sign(sx || 1); sy = m * Math.sign(sy || 1); } /* text and Shift keep the proportions */
          if (Math.abs(sx) < 0.05) sx = 0.05 * (sx < 0 ? -1 : 1); if (Math.abs(sy) < 0.05) sy = 0.05 * (sy < 0 ? -1 : 1);
          scaleStroke(s, cur.g, cur.o[0], cur.o[1], sx, sy); cur.moved = true; surface.repaint(); showSel(); return;
        }
        if (cur.move) { const dx = w[0] - cur.last[0], dy = w[1] - cur.last[1]; if (dx || dy) { moveStroke(state.sel, dx, dy); cur.last = w; cur.moved = true; surface.repaint(); showSel(); } return; }
        if (cur.snapped && cur.s.t !== "p") { /* a snapped shape stays as it was recognised */ return; }
        if (cur.s.t === "p") {
          // Shift: the stroke becomes a straight line from where it started (angles snap to 15 degrees); letting go of Shift gives the freehand line back
          if (e.shiftKey) { cur.straight = true; cur.preview = { ...cur.s, t: "l", a: cur.start, b: snapAngle(cur.start, w), p: undefined }; clearTimeout(holdT); cur.s.p.push(w); live(); return; }
          if (cur.straight) { cur.straight = false; cur.preview = null; live(); }
        }
        if (Math.hypot(e.clientX - last[0], e.clientY - last[1]) > 2.5) { last = [e.clientX, e.clientY]; hold(); }
        if (cur.s.t === "p") {
          const p = cur.s.p, l = p[p.length - 1]; if (Math.hypot(w[0] - l[0], w[1] - l[1]) * surface.k() < 1.2) return;
          p.push(w);
          // only the new piece is drawn: no repaint of the whole picture while the hand moves
          if (cur.s.o) { live(); return; }
          const ctx = surface.live, n = p.length; ctx.strokeStyle = cur.s.c || themeColor(); ctx.lineWidth = cur.s.w; ctx.lineCap = "round"; ctx.lineJoin = "round";
          ctx.beginPath(); if (n === 2) { ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo((p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2); } else { const a = p[n - 3], b = p[n - 2], c = p[n - 1]; ctx.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); ctx.quadraticCurveTo(b[0], b[1], (b[0] + c[0]) / 2, (b[1] + c[1]) / 2); } ctx.stroke();
        } else {
          let b = w; if (e.shiftKey && (cur.s.t === "l" || cur.s.t === "a")) b = snapAngle(cur.start, w); else if (e.shiftKey) { const d = Math.max(Math.abs(w[0] - cur.start[0]), Math.abs(w[1] - cur.start[1])); b = [cur.start[0] + Math.sign(w[0] - cur.start[0] || 1) * d, cur.start[1] + Math.sign(w[1] - cur.start[1] || 1) * d]; }
          cur.s.b = b; live();
        }
      },
      up() {
        clearTimeout(holdT); const c = cur; cur = null; if (!c) return;
        if (c.erase) { surface.clearLive(); if (c.erased) surface.changed(); return; }
        if (c.move || c.resize) { if (c.moved) surface.changed(); showSel(); return; }
        let s = c.s; if (c.straight && c.preview) { const { p: _p, ...rest } = c.preview; s = rest; }
        if (s.t === "p") {
          if (!c.snapped) s.p = smoothPts(s.p, surface.k());
          if (s.t === "p" && s.p.length === 1) s.p = [s.p[0], [s.p[0][0] + 0.01, s.p[0][1]]];
        } else if (!c.snapped && dist(s.a, s.b) * surface.k() < 3) { surface.clearLive(); return; }
        surface.strokes.push(s); surface.clearLive(); surface.repaint(); surface.changed();
      },
      hover(e) { if (cur) return; if (state.tool === "erase") ring(surface.toWorld(e)); else if (state.tool === "select") showSel(); },
      removeSelected() { const s = state.sel; if (!s) return false; const i = surface.strokes.indexOf(s); if (i < 0) return false; surface.strokes.splice(i, 1); state.sel = null; surface.clearLive(); surface.repaint(); surface.changed(); return true; },
      nudge(dx, dy) { if (!state.sel) return false; moveStroke(state.sel, dx, dy); surface.repaint(); showSel(); surface.changed(); return true; },
      refresh() { surface.repaint(); showSel(); surface.changed(); },
      cancel() { clearTimeout(holdT); cur = null; surface.clearLive(); },
    };
  }

  // ======================================================================== toolbar + palette (like the canvas card menu)
  // the keys of the drawing mode, in the same window layout as the canvas help
  function showHelp() {
    const A = window.__bsApi; if (!A || !A.Modal) return;
    const m = new A.Modal(window.app); m.modalEl.addClass("mod-canvas-help"); m.setTitle("Рисование");
    const box = m.contentEl.createDiv("canvas-help");
    const row = (label, combos) => box.createDiv({ cls: "canvas-instruction" }, (rw) => { rw.createDiv({ cls: "canvas-instruction-label", text: label }); rw.createDiv({ cls: "canvas-instruction-desc" }, (d) => { combos.forEach((c) => d.createSpan({ cls: "setting-hotkey", text: c.join(" + ") })); }); });
    row("Выделение", [["V"]]); row("Текст", [["T"]]); row("Кисть", [["P"]]); row("Прямая линия кистью", [["Shift"]]); row("Маркер", [["H"]]); row("Линия", [["L"]]); row("Стрелка", [["A"]]);
    row("Прямоугольник", [["R"]]); row("Эллипс", [["O"]]); row("Ластик", [["E"]]); row("Отменить", [["Ctrl", "Z"]]); row("Повторить", [["Ctrl", "Y"]]); row("Выйти из рисования", [["Alt", "D"], ["Esc"]]);
    m.open();
  }
  function toolbar(state, host, ctl) {
    const bar = document.createElement("div"); bar.className = "bsd-tb";
    let pop = null;
    const closePop = () => { if (pop) { pop.remove(); pop = null; } };
    const icon = (el, name) => { try { window.__bsApi.setIcon(el, name); } catch (e) { el.textContent = "•"; } };
    const btn = (name, title, fn) => { const b = document.createElement("button"); icon(b, name); b.title = title; b.addEventListener("click", (e) => { e.stopPropagation(); fn(b); }); bar.appendChild(b); return b; };
    const sep = () => { const s = document.createElement("span"); s.className = "bsd-sep"; bar.appendChild(s); };
    const toolBtns = TOOLS.map(([id, ic, title]) => { const b = btn(ic, title, () => { state.tool = id; if (id !== "select") state.sel = null; sync(); closePop(); }); b.dataset.tool = id; if (id === "erase") { b.before(document.createElement("span")); } return b; });
    sep();
    const colorB = btn("lucide-palette", "Цвет", () => openPop("color")), widthB = btn("lucide-minus", "Толщина", () => openPop("width"));
    colorB.innerHTML = '<span class="bsd-dot"></span>'; const dot = colorB.firstChild;
    sep();
    const snapB = btn("lucide-wand-2", "Выравнивать фигуры", () => { state.snap = !state.snap; sync(); });
    btn("lucide-undo-2", "Отменить (Ctrl+Z)", () => ctl.undo()); btn("lucide-redo-2", "Повторить (Ctrl+Y)", () => ctl.redo());
    sep();
    btn("lucide-circle-help", "Клавиши рисования", () => showHelp());
    const done = btn("lucide-check", "Готово (Alt+D)", () => ctl.done()); done.style.color = "var(--interactive-accent)";
    function sync() {
      toolBtns.forEach((b) => b.classList.toggle("is-on", b.dataset.tool === state.tool)); snapB.classList.toggle("is-on", state.snap);
      dot.style.background = state.color || themeColor(); widthB.innerHTML = `<i style="display:block;border-radius:50%;background:currentColor;width:${Math.min(18, 4 + state.width * 1.2)}px;height:${Math.min(18, 4 + state.width * 1.2)}px"></i>`;
    }
    function openPop(kind) {
      if (pop && pop.dataset.kind === kind) return closePop(); closePop();
      pop = document.createElement("div"); pop.className = "bsd-pop"; pop.dataset.kind = kind;
      if (kind === "color") {
        for (const [name, c] of PALETTE) { const b = document.createElement("button"); b.className = "bsd-c" + (state.color === c ? " is-on" : ""); b.style.background = c || "#8a8a8a"; b.title = name === "default" ? "По умолчанию" : name; b.addEventListener("click", () => { state.color = c; if (state.sel && ctl.recolor) ctl.recolor(c); sync(); closePop(); }); pop.appendChild(b); }
        const rb = document.createElement("button"); rb.className = "bsd-c rainbow" + (state.color && !PALETTE.some(([, c]) => c === state.color) ? " is-on" : ""); rb.title = "Свой цвет";
        const inp = document.createElement("input"); inp.type = "color"; inp.value = state.color || "#ffffff"; inp.addEventListener("input", () => { state.color = inp.value; if (state.sel && ctl.recolor) ctl.recolor(inp.value); sync(); }); inp.addEventListener("change", () => { window.__bsRecent && window.__bsRecent.add(inp.value); closePop(); }); rb.appendChild(inp); pop.appendChild(rb);
        for (const c of (window.__bsRecent ? window.__bsRecent.get() : [])) { const b = document.createElement("button"); b.className = "bsd-c" + (state.color === c ? " is-on" : ""); b.style.background = c; b.title = "Недавний цвет " + c; b.addEventListener("click", () => { window.__bsRecent.add(c); state.color = c; if (state.sel && ctl.recolor) ctl.recolor(c); sync(); closePop(); }); pop.appendChild(b); }
      } else {
        // a slider with a live sample of the stroke, and the usual sizes
        const col = document.createElement("div"); col.style.cssText = "display:flex;flex-direction:column;gap:8px;align-items:stretch;min-width:210px";
        const sample = document.createElement("div"); sample.style.cssText = "height:34px;display:flex;align-items:center;justify-content:center";
        const dotS = document.createElement("i"); dotS.style.cssText = "display:block;border-radius:50%;background:var(--text-normal)"; sample.appendChild(dotS);
        const rng = document.createElement("input"); rng.type = "range"; rng.min = 1; rng.max = 40; rng.step = 1; rng.value = state.width;
        const lab = document.createElement("div"); lab.style.cssText = "text-align:center;font-size:11.5px;color:var(--text-faint)";
        const upd = () => { const v = +rng.value; state.width = v; dotS.style.width = dotS.style.height = Math.min(v, 34) + "px"; lab.textContent = v + " px"; if (state.sel && ctl.rewidth) ctl.rewidth(v); sync(); };
        rng.addEventListener("input", upd); upd();
        const presets = document.createElement("div"); presets.style.cssText = "display:flex;gap:6px;justify-content:center";
        for (const w of [2, 4, 8, 14, 24]) { const b = document.createElement("span"); b.className = "bsd-w" + (state.width === w ? " is-on" : ""); b.innerHTML = `<i style="width:${Math.min(w + 4, 22)}px;height:${Math.min(w + 4, 22)}px"></i>`; b.addEventListener("click", () => { rng.value = w; upd(); }); presets.appendChild(b); }
        col.append(sample, rng, lab, presets); pop.appendChild(col);
      }
      host.appendChild(pop);
    }
    sync(); host.appendChild(bar);
    return { bar, closePop, sync, destroy() { closePop(); bar.remove(); } };
  }

  // ======================================================================== the ink layer of a canvas
  // the board's file is saved with a 2 s delay; a drawing is written to disk right away, and everything pending is written when the user leaves
  const flushCanvas = (canvas) => { try { const v = canvas && canvas.view; if (!v) return; if (v.requestSave && typeof v.requestSave.run === "function") v.requestSave.run(); else if (typeof v.save === "function") { const p = v.save(); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* nothing pending */ } };
  const flushAll = () => { try { for (const l of app.workspace.getLeavesOfType("canvas")) flushCanvas(l.view && l.view.canvas); } catch (e) { /* closing */ } };
  window.addEventListener("beforeunload", flushAll); window.addEventListener("pagehide", flushAll); document.addEventListener("visibilitychange", () => { if (document.hidden) flushAll(); });
  const layers = new WeakMap();
  function layerOf(canvas) {
    let L = layers.get(canvas); if (L) return L;
    const wrap = canvas.wrapperEl; if (!wrap) return null;
    const ink = document.createElement("canvas"); ink.className = "bsink"; const liveC = document.createElement("canvas"); liveC.className = "bsink-live";
    wrap.appendChild(ink); wrap.appendChild(liveC);
    L = { canvas, ink, liveC, strokes: [], view: null, sig: "", dirty: true, loaded: false };
    layers.set(canvas, L);
    // the ink travels with the canvas data: saved, loaded and undone together with the cards
    const getData = canvas.getData.bind(canvas), importData = canvas.importData.bind(canvas);
    canvas.getData = function () { const d = getData(); if (!L.file && canvas.view && canvas.view.file) L.file = canvas.view.file; const mine = !L.file || !canvas.view || canvas.view.file === L.file; if (mine && L.strokes.length) d.fpInk = L.strokes.map((s) => { const c = { ...s }; delete c._d; return c; }); return d; };
    // importData(data, true) loads a whole board (the file, undo, redo); importData(data, false) only adds pasted or duplicated cards
    canvas.importData = function (d, full, ...a) {
      const whole = full === true;
      // a board that was saved a moment ago is read back by the app: when that happens after the user already went on (drew or erased more),
      // the older copy must not bring erased strokes back or drop new ones. Undo and redo do replace the drawing.
      const echo = whole && !canvas.__inHistory && L.localAt && performance.now() - L.localAt < 4000;
      if (whole && !echo) { L.strokes = Array.isArray(d && d.fpInk) ? d.fpInk.map((s) => ({ ...s })) : []; L.dirty = true; L.loaded = true; L.ver = (L.ver || 0) + 1; }
      return importData(d, full, ...a);
    };
    // data that was loaded before this layer existed
    const view = canvas.view || app.workspace.getLeavesOfType("canvas").map((l) => l.view).find((v) => v && v.canvas === canvas); /* a board inside a card has its view on the canvas, it is not in the workspace list */
    if (view && view.file) app.vault.cachedRead(view.file).then((t) => { if (L.loaded) return; try { const j = JSON.parse(t); if (Array.isArray(j.fpInk)) { L.strokes = j.fpInk; L.dirty = true; canvas.requestFrame && canvas.requestFrame(); } } catch (e) { /* not json */ } L.loaded = true; });
    return L;
  }
  const dpr = () => window.devicePixelRatio || 1;
  function fit(L, v) {
    const w = Math.max(1, Math.round(v.vw * dpr())), h = Math.max(1, Math.round(v.vh * dpr()));
    for (const c of [L.ink, L.liveC]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; L.dirty = true; }
  }
  const setT = (ctx, v) => { const k = v.scale * dpr(); ctx.setTransform(k, 0, 0, k, (v.vw / 2 - v.cx * v.scale) * dpr(), (v.vh / 2 - v.cy * v.scale) * dpr()); };
  function repaint(L) {
    const v = L.view; if (!v) return; fit(L, v);
    const ctx = L.ink.getContext("2d"); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, L.ink.width, L.ink.height);
    if (!L.strokes.length) return;
    setT(ctx, v); const vx0 = v.cx - v.vw / 2 / v.scale, vy0 = v.cy - v.vh / 2 / v.scale, vx1 = v.cx + v.vw / 2 / v.scale, vy1 = v.cy + v.vh / 2 / v.scale;
    for (const s of L.strokes) { const pts = ptsOf(s), b = bboxOf(pts); if (b.x1 + (s.w || 0) < vx0 || b.x0 - (s.w || 0) > vx1 || b.y1 + (s.w || 0) < vy0 || b.y0 - (s.w || 0) > vy1) continue; paint(ctx, s); }
  }
  // the drawing follows the board's own camera, read live (a board that lives inside a card, like a nested canvas, may not report its view on every change)
  const liveView = (canvas, v0) => { const wrap = canvas.wrapperEl; return { cx: canvas.x, cy: canvas.y, scale: canvas.scale, vw: (wrap && wrap.clientWidth) || (v0 && v0.vw) || 1, vh: (wrap && wrap.clientHeight) || (v0 && v0.vh) || 1 }; };
  window.__bsInkFrame = (canvas, v0) => {
    const L = layerOf(canvas); if (!L) return;
    const v = liveView(canvas, v0); L.view = v;
    if (!L.poll) { L.poll = true; const tick = () => { const w = canvas.wrapperEl; if (!w || !w.isConnected) { L.poll = false; return; } try { window.__bsInkFrame(canvas, null); } catch (e) { /* gone */ } requestAnimationFrame(tick); }; requestAnimationFrame(tick); } const sig = [v.cx, v.cy, v.scale, v.vw, v.vh, L.strokes.length].join("|");
    if (L.dirty || sig !== L.sig) { L.sig = sig; L.dirty = false; repaint(L); }
  };

  // ---- live drawing on a canvas
  const modes = new WeakMap();
  function startLive(canvas) {
    if (modes.has(canvas)) return;
    const L = layerOf(canvas), wrap = canvas.wrapperEl, state = { tool: "pen", color: null, width: 3, snap: true };
    const liveCtx = L.liveC.getContext("2d");
    const surface = {
      strokes: L.strokes, k: () => (L.view ? L.view.scale : canvas.scale),
      toWorld: (e) => { const p = canvas.posFromEvt(e); return [p.x, p.y]; },
      host: wrap, toScreen: (p) => { const v = L.view || { cx: canvas.x, cy: canvas.y, scale: canvas.scale, vw: wrap.clientWidth, vh: wrap.clientHeight }; return [v.vw / 2 + (p[0] - v.cx) * v.scale, v.vh / 2 + (p[1] - v.cy) * v.scale]; },
      get live() { setT(liveCtx, L.view); return liveCtx; },
      clearLive: () => { liveCtx.setTransform(1, 0, 0, 1, 0, 0); liveCtx.clearRect(0, 0, L.liveC.width, L.liveC.height); },
      repaint: () => repaint(L),
      changed: () => { L.dirty = true; L.ver = (L.ver || 0) + 1; L.localAt = performance.now(); canvas.requestSave && canvas.requestSave(); flushCanvas(canvas); /* written at once: leaving, deleting or closing right after drawing must not lose it */ },
    };
    const drawer = makeDrawer(surface, state);
    // while drawing, the strokes array must be the layer's current one (undo replaces it)
    const sync = () => { surface.strokes = L.strokes; };
    let active = false;
    const down = (e) => { if (e.button !== 0 || e.target.closest(".bsd-tb, .bsd-pop, textarea, .canvas-controls, .canvas-card-menu")) return; sync(); e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); active = true; try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* ok */ } drawer.down(e); };
    const move = (e) => { if (!active) return; const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const ce of list.length ? list : [e]) drawer.move(ce); };
    const up = () => { if (!active) return; active = false; drawer.up(); };
    const noDbl = (e) => { if (e.target.closest(".bsd-tb, .bsd-pop, .canvas-controls")) return; e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }; /* a double click would make a card: the board is not editable while drawing */
    wrap.addEventListener("dblclick", noDbl, true); wrap.addEventListener("drop", noDbl, true); /* text dragged out of a text box must not become a card either */
    const hover = (e) => { if (!active) drawer.hover(e); };
    wrap.addEventListener("pointermove", hover, true);
    wrap.addEventListener("pointerdown", down, true); window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", up, true);
    wrap.classList.add("bsink-on");
    const tb = toolbar(state, wrap, {
      undo: () => { state.sel = null; canvas.undo(); L.dirty = true; drawer.hover({ clientX: -1e5, clientY: -1e5 }); }, redo: () => { state.sel = null; canvas.redo(); L.dirty = true; }, done: () => stop(),
      recolor: (c) => { if (state.sel) { state.sel.c = c; drawer.refresh(); } }, rewidth: (w) => { if (state.sel) { state.sel.w = state.sel.o ? Math.max(10, w * 4) : w; drawer.refresh(); } },
    });
    const key = (e) => {
      if (/TEXTAREA/.test((e.target || {}).tagName || "")) return; /* typing text: the box handles its own keys */
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stop(); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || "")) {
        if (e.key === "Delete" || e.key === "Backspace") { if (drawer.removeSelected()) { e.preventDefault(); e.stopPropagation(); } return; }
        const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (arrow && state.sel) { const st = (e.shiftKey ? 10 : 1) / Math.max(0.2, surface.k()); if (drawer.nudge(arrow[0] * st, arrow[1] * st)) { e.preventDefault(); e.stopPropagation(); } return; }
        const m = { v: "select", t: "text", p: "pen", h: "hl", l: "line", a: "arrow", r: "rect", o: "ellipse", e: "erase" }[lk(e)]; if (m) { state.tool = m; if (m !== "select") state.sel = null; surface.clearLive(); tb.sync(); }
      }
    };
    document.addEventListener("keydown", key, true);
    function stop() { wrap.removeEventListener("dblclick", noDbl, true); wrap.removeEventListener("drop", noDbl, true); wrap.removeEventListener("pointermove", hover, true); document.removeEventListener("keydown", key, true); wrap.removeEventListener("pointerdown", down, true); window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true); wrap.classList.remove("bsink-on"); drawer.cancel(); tb.destroy(); modes.delete(canvas); }
    modes.set(canvas, { stop });
    new window.__bsApi.Notice("Рисование включено. Клавиши: кнопка справки на панели", 3500);
  }

  // ======================================================================== blocks in notes
  const FENCE = /```basalt-draw\n([\s\S]*?)\n?```/;
  const blank = (w = 800, h = 500) => ({ v: 2, w, h, strokes: [] });
  const parse = (txt) => { try { const d = JSON.parse(txt); if (d && Array.isArray(d.strokes)) return d; } catch (e) { /* damaged */ } return null; };
  const clean = (s) => { const c = { ...s }; delete c._d; const r = (q) => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]; if (c.p) c.p = c.p.map(r); if (c.a) c.a = r(c.a); if (c.b) c.b = r(c.b); return c; };
  const pack = (d) => "```basalt-draw\n" + JSON.stringify({ v: 2, w: Math.round(d.w), h: Math.round(d.h), strokes: d.strokes.map(clean) }) + "\n```";
  function svgOf(d) {
    const svg = document.createElementNS(SVGNS, "svg"); svg.setAttribute("viewBox", `0 0 ${d.w} ${d.h}`);
    const cv = document.createElement("canvas"), ctx = null; void cv; void ctx;
    for (const s of d.strokes) {
      const t = s.t || "p"; let el;
      const mk = (tag, attrs) => { el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); svg.appendChild(el); };
      const common = { fill: "none", stroke: s.c || "currentColor", "stroke-width": s.w, "stroke-linecap": "round", "stroke-linejoin": "round" };
      if (t === "p") { const p = s.p; let dd = `M${p[0][0]} ${p[0][1]}`; if (p.length === 1) dd += " l0.01 0"; for (let i = 1; i < p.length - 1; i++) dd += ` Q${p[i][0]} ${p[i][1]} ${(p[i][0] + p[i + 1][0]) / 2} ${(p[i][1] + p[i + 1][1]) / 2}`; if (p.length > 1) dd += ` L${p[p.length - 1][0]} ${p[p.length - 1][1]}`; mk("path", { ...common, d: dd }); }
      else if (t === "l" || t === "a") { let dd = `M${s.a[0]} ${s.a[1]} L${s.b[0]} ${s.b[1]}`; if (t === "a") { const ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]), h = Math.max(10, s.w * 4); for (const dv of [0.45, -0.45]) dd += ` M${s.b[0]} ${s.b[1]} L${s.b[0] - h * Math.cos(ang + dv)} ${s.b[1] - h * Math.sin(ang + dv)}`; } mk("path", { ...common, d: dd }); }
      else if (t === "r") mk("rect", { ...common, x: Math.min(s.a[0], s.b[0]), y: Math.min(s.a[1], s.b[1]), width: Math.abs(s.b[0] - s.a[0]), height: Math.abs(s.b[1] - s.a[1]) });
      else mk("ellipse", { ...common, cx: (s.a[0] + s.b[0]) / 2, cy: (s.a[1] + s.b[1]) / 2, rx: Math.abs(s.b[0] - s.a[0]) / 2, ry: Math.abs(s.b[1] - s.a[1]) / 2 });
    }
    return svg;
  }
  // the editor modal for a block: the same drawer on a fitted surface
  function editor(data, onSave) {
    const d = { ...data, strokes: data.strokes.map((s) => ({ ...s })) }, state = { tool: "pen", color: null, width: 3, snap: true };
    const wrap = document.createElement("div"); wrap.className = "modal-container mod-dim";
    wrap.innerHTML = '<div class="modal-bg"></div><div class="modal bsd-modal"><div class="modal-close-button"></div><div class="bsd-surface"><canvas class="m-ink"></canvas><canvas class="m-live"></canvas></div></div>';
    const modal = wrap.querySelector(".bsd-modal"), surf = wrap.querySelector(".bsd-surface"), ink = wrap.querySelector(".m-ink"), lc = wrap.querySelector(".m-live"), ictx = ink.getContext("2d"), lctx = lc.getContext("2d");
    const view = { k: 1, ox: 0, oy: 0 }, undone = [];
    const fitView = () => { const r = surf.getBoundingClientRect(), p = dpr(); for (const c of [ink, lc]) { c.width = r.width * p; c.height = r.height * p; } const k = Math.min(r.width / d.w, r.height / d.h) * 0.96; view.k = k; view.ox = (r.width - d.w * k) / 2; view.oy = (r.height - d.h * k) / 2; };
    const apply = (ctx) => { const p = dpr(); ctx.setTransform(view.k * p, 0, 0, view.k * p, view.ox * p, view.oy * p); };
    const repaintM = () => { fitView(); ictx.setTransform(1, 0, 0, 1, 0, 0); ictx.clearRect(0, 0, ink.width, ink.height); apply(ictx); ictx.fillStyle = "rgba(127,127,127,.08)"; ictx.fillRect(0, 0, d.w, d.h); for (const s of d.strokes) paint(ictx, s); };
    const surface = { strokes: d.strokes, k: () => view.k, host: surf, toScreen: (p) => [p[0] * view.k + view.ox, p[1] * view.k + view.oy], toWorld: (e) => { const r = surf.getBoundingClientRect(); return [(e.clientX - r.left - view.ox) / view.k, (e.clientY - r.top - view.oy) / view.k]; }, get live() { apply(lctx); return lctx; }, clearLive: () => { lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, lc.width, lc.height); }, repaint: () => { ictx.setTransform(1, 0, 0, 1, 0, 0); ictx.clearRect(0, 0, ink.width, ink.height); apply(ictx); ictx.fillStyle = "rgba(127,127,127,.08)"; ictx.fillRect(0, 0, d.w, d.h); for (const s of d.strokes) paint(ictx, s); }, changed: () => { undone.length = 0; } };
    const drawer = makeDrawer(surface, state); let active = false;
    surf.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; surf.setPointerCapture(e.pointerId); active = true; drawer.down(e); });
    surf.addEventListener("pointermove", (e) => { if (active) for (const ce of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) drawer.move(ce); });
    const end = () => { if (active) { active = false; drawer.up(); } }; surf.addEventListener("pointerup", end); surf.addEventListener("pointercancel", end);
    const close = () => { wrap.remove(); window.removeEventListener("resize", repaintM); document.removeEventListener("keydown", key, true); };
    const ctl = { undo: () => { const s = d.strokes.pop(); if (s) undone.push(s); surface.repaint(); }, redo: () => { const s = undone.pop(); if (s) d.strokes.push(s); surface.repaint(); }, done: () => { close(); onSave(d); } };
    const tb = toolbar(state, modal, ctl); void tb;
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); e.stopPropagation(); e.shiftKey ? ctl.redo() : ctl.undo(); } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") { e.preventDefault(); ctl.redo(); } };
    document.addEventListener("keydown", key, true); window.addEventListener("resize", repaintM);
    wrap.querySelector(".modal-close-button").addEventListener("click", close); wrap.querySelector(".modal-bg").addEventListener("click", close);
    document.body.appendChild(wrap); requestAnimationFrame(repaintM);
  }
  function sourceUpdater(host, oldJson) {
    return (nd) => {
      const block = pack(nd), card = host && host.closest(".canvas-node");
      if (card) { for (const l of app.workspace.getLeavesOfType("canvas")) { const c = l.view && l.view.canvas; if (!c) continue; const n = Array.from(c.nodes.values()).find((x) => x.nodeEl === card); if (n && typeof n.text === "string") { n.setText(n.text.replace(FENCE, () => block)); c.requestSave(); return; } } return; }
      const f = app.workspace.getActiveFile(); if (!f) return;
      app.vault.read(f).then((t) => app.vault.modify(f, t.replace(FENCE, (m, body) => (body.trim() === oldJson.trim() ? block : m))));
    };
  }
  function enhance(pre) {
    const code = pre.querySelector("code"); if (!code || !/language-basalt-draw/.test(code.className) || pre.dataset.bsd) return;
    pre.dataset.bsd = "1"; const src = code.textContent, d = parse(src) || blank();
    const box = document.createElement("div"); box.className = "bsd"; box.appendChild(svgOf(d));
    const b = document.createElement("button"); b.className = "bsd-edit"; b.textContent = "Рисовать"; try { const ic = document.createElement("span"); window.__bsApi.setIcon(ic, "lucide-pencil"); b.prepend(ic); } catch (e) { /* ok */ } const host = pre.closest(".canvas-node");
    b.addEventListener("click", (e) => { e.stopPropagation(); editor(d, sourceUpdater(host, src)); });
    for (const ev of ["pointerdown", "mousedown", "dblclick"]) b.addEventListener(ev, (e) => e.stopPropagation());
    box.appendChild(b); pre.replaceWith(box); if (host) host.classList.add("bsd-card");
  }
  const scan = () => document.querySelectorAll("pre > code[class*='language-basalt-draw']").forEach((c) => enhance(c.parentElement));
  function inNote(view) {
    const ed = view.editor; if (!ed) return; const cur = ed.getCursor(), text = ed.getValue(), off = ed.posToOffset(cur); let m; const re = /```basalt-draw\n([\s\S]*?)\n?```/g;
    while ((m = re.exec(text))) if (off >= m.index && off <= m.index + m[0].length) { const d = parse(m[1]) || blank(), from = ed.offsetToPos(m.index), to = ed.offsetToPos(m.index + m[0].length); return editor(d, (nd) => ed.replaceRange(pack(nd), from, to)); }
    editor(blank(), (nd) => { if (nd.strokes.length) ed.replaceRange("\n" + pack(nd) + "\n", cur); });
  }
  function toggle() {
    const v = app.workspace.activeLeaf && app.workspace.activeLeaf.view;
    if (v && v.canvas) { const m = modes.get(v.canvas); if (m) m.stop(); else startLive(v.canvas); return; }
    if (v && v.editor) return inNote(v);
    new window.__bsApi.Notice("Откройте холст или заметку, чтобы рисовать");
  }
  const t = setInterval(() => {
    if (!(window.app && app.commands && app.workspace && app.workspace.layoutReady && window.__bsApi)) return;
    clearInterval(t);
    for (const ev of ["active-leaf-change", "layout-change", "file-open", "quit"]) { try { app.workspace.on(ev, flushAll); } catch (e) { /* no such event */ } }
    app.commands.addCommand({ id: "basalt:draw-toggle", name: "Рисование: вкл/выкл (Alt+D)", callback: toggle });
    // Alt+D is handled here directly: it works wherever the focus is
    window.addEventListener("keydown", (e) => { if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyD") { e.preventDefault(); e.stopPropagation(); toggle(); } }, true);
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }); scan();
    const addBtn = () => document.querySelectorAll(".canvas-controls:not(.bsg-controls):not(.bscg-controls)").forEach((box) => {
      if (box.querySelector(".bsd-pen")) return;
      const g = document.createElement("div"); g.className = "canvas-control-group bsd-pen"; const item = document.createElement("div"); item.className = "canvas-control-item"; item.setAttribute("aria-label", "Рисование (Alt+D)"); item.title = "Рисование (Alt+D)";
      try { window.__bsApi.setIcon(item, "lucide-pencil"); } catch (e) { item.textContent = "✎"; }
      item.addEventListener("click", (e) => { e.stopPropagation(); toggle(); }); g.appendChild(item); box.appendChild(g);
    });
    new MutationObserver(addBtn).observe(document.body, { childList: true, subtree: true }); addBtn();
    window.__bsDraw = { toggle, editor, pack, layerOf, recognize };
  }, 600);
})();
