// mini-features: small conveniences, each one switchable in Settings > mini-features.
//  2. The file explorer does not open the folder of a file you touch (a picture on a canvas, a link): folders open only when you open them.
//  1. Pictures go to a folder of your choice: pasted or dropped images are moved (links are updated) to a folder of the vault,
//     or to a subfolder next to the note / canvas they were added to (for example "assets").
(() => {
  "use strict";
  const IMG = /^(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
  const DEF = { images: { enabled: false, mode: "vault", folder: "Изображения", sub: "assets" }, explorer: { keepFolders: true } };
  let cfg = JSON.parse(JSON.stringify(DEF));
  const file = () => app.vault.configDir + "/mini-features.json";
  const load = async () => { try { const a = app.vault.adapter; if (await a.exists(file())) { const j = JSON.parse(await a.read(file())); cfg = { images: { ...DEF.images, ...(j.images || {}) }, explorer: { ...DEF.explorer, ...(j.explorer || {}) } }; } } catch (e) { /* defaults */ } };
  const save = () => app.vault.adapter.write(file(), JSON.stringify(cfg, null, 1)).catch((e) => console.error("[mini-features]", e));
  const notice = (m) => { try { new window.__bsApi.Notice(m, 4000); } catch (e) { console.log(m); } };
  const clean = (p) => String(p || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").split("/").filter((s) => s && s !== "." && s !== "..").join("/");

  async function ensureFolder(path) {
    if (!path) return;
    let cur = "";
    for (const part of path.split("/")) { cur = cur ? cur + "/" + part : part; if (!(await app.vault.adapter.exists(cur))) await app.vault.createFolder(cur).catch(() => {}); }
  }
  // where should this picture live? (the note or canvas it was added to decides for the "next to the note" mode)
  function targetDir(f) {
    const c = cfg.images;
    if (c.mode === "sub") {
      const host = app.workspace.getActiveFile();
      const base = host && host.parent && host.parent.path !== "/" ? host.parent.path : "";
      return clean((base ? base + "/" : "") + (clean(c.sub) || "assets"));
    }
    return clean(c.folder) || "";
  }
  async function place(f) {
    window.__bsMiniFeatures.last = ["place", f && f.path, cfg.images.enabled];
    if (!cfg.images.enabled || !f || !IMG.test(f.extension || "")) return;
    const dir = targetDir(f);
    if (f.parent && (f.parent.path === "/" ? "" : f.parent.path) === dir) return;
    try {
      await ensureFolder(dir);
      let name = f.name, n = 1; const stem = f.basename;
      while (await app.vault.adapter.exists((dir ? dir + "/" : "") + name)) name = `${stem} ${++n}.${f.extension}`;
      await app.fileManager.renameFile(f, (dir ? dir + "/" : "") + name);
      notice(`Картинка перемещена: ${dir || "корень"}`);
    } catch (e) { window.__bsMiniFeatures.last = ["error", String(e && e.stack)]; console.error("[mini-features]", e); }
  }

  // settings page inside our window
  window.__bsMiniFeatures = {
    section(h, row, toggle, select, text) {
      const c = cfg.images;
      row(h, "Картинки в отдельную папку", "Вставленные и перетащенные картинки автоматически переносятся в нужную папку, ссылки обновляются.", toggle(() => c.enabled, (v) => { c.enabled = v; save(); }));
      row(h, "Куда", "В одну папку хранилища или в подпапку рядом с заметкой или холстом, куда картинку добавили.", select([["vault", "В папку хранилища"], ["sub", "В подпапку рядом с заметкой / холстом"]], () => c.mode, (v) => { c.mode = v; save(); }));
      row(h, "Не раскрывать папку файла", "Когда трогаешь картинку или файл на холсте, проводник не раскрывает папку, в которой он лежит. Папки открываются только вручную.", toggle(() => cfg.explorer.keepFolders, (v) => { cfg.explorer.keepFolders = v; save(); }));
      row(h, "Папка хранилища", "Например: Изображения или Проект/Картинки.", text(() => c.folder, (v) => { c.folder = clean(v); save(); }, "Изображения"));
      row(h, "Имя подпапки", "Создаётся рядом с заметкой или холстом. Например: assets.", text(() => c.sub, (v) => { c.sub = clean(v) || "assets"; save(); }, "assets"));
    },
    get cfg() { return cfg; }, place,
  };
  const t = setInterval(async () => {
    if (!(window.app && app.vault && app.vault.adapter && app.workspace && app.workspace.layoutReady && app.commands)) return;
    clearInterval(t);
    await load();
    const started = Date.now();
    app.vault.on("create", (f) => {
      // only what appears now: not the files found while the vault loads
      if (Date.now() - started < 4000 || !f || f.children || !IMG.test(f.extension || "")) return;
      setTimeout(() => place(f), 900); window.__bsMiniFeatures.last = ["scheduled", f.path];
    });
    app.commands.addCommand({ id: "mini-features:move-images", name: "Мини-функции: перенести картинки открытой заметки в папку картинок", checkCallback: (chk) => { const host = app.workspace.getActiveFile(); if (!host) return false; if (chk) return true; (async () => { const links = Object.keys((app.metadataCache.resolvedLinks || {})[host.path] || {}).map((p) => app.vault.getAbstractFileByPath(p)).filter((f) => f && IMG.test(f.extension || "")); const was = cfg.images.enabled; cfg.images.enabled = true; for (const f of links) await place(f); cfg.images.enabled = was; notice(`Проверено картинок: ${links.length}`); })(); return true; } });
  }, 800);
})();
// "Показать в папке": a slash-joined vault path makes Windows Explorer ignore the file, so normalize it first.
(() => {
  const t = setInterval(() => {
    if (!window.app || !app.vault || !app.vault.adapter) return;
    clearInterval(t);
    const reveal = (full) => {
      const e = window.electron || window.require("electron"), p = window.require("path");
      full = p.normalize(full);
      if (process.platform === "win32") window.require("child_process").spawn("explorer.exe", ["/select," + full], { detached: true, stdio: "ignore" }).unref();
      else (e.remote && e.remote.shell || e.shell).showItemInFolder(full);
    };
    window.__bsReveal = (full) => { try { reveal(full); } catch (err) { console.error("[show-in-folder]", err); } };
    const show = (rel) => window.__bsReveal(app.vault.adapter.getFullPath(rel || ""));
    for (const o of [app, app.vault]) if (typeof o.showInFolder === "function") o.showInFolder = show;
  }, 500);
})();
