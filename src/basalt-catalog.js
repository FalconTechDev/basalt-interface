// Plugin catalog: install plugins straight from GitHub releases, no central store.
//  - "owner/repo" or a GitHub link installs the latest release (JS plugin: main.js + manifest.json [+ styles.css],
//    or a Wasm plugin: manifest.json with "wasm" + the .wasm file)
//  - sources: any JSON file by link ([{"repo":"owner/repo","name":"...","description":"..."}]) lists plugins to pick from
(() => {
  "use strict";
  const https = window.require("https");
  const css = document.createElement("style");
  css.textContent = `
    .bsc { width: min(1100px, 94vw); max-width: none; height: min(720px, 88vh); display: flex; flex-direction: column; padding: 0; }
    .bsc-head { padding: 18px 64px 12px 24px; border-bottom: 1px solid var(--background-modifier-border); }
    .bsc-title { font-size: var(--font-ui-large); font-weight: 600; color: var(--text-normal); } .bsc-row b { color: var(--text-normal); } .bsc-sub { color: var(--text-muted); font-size: var(--font-ui-small); margin-top: 2px; }
    .bsc-add { display: flex; gap: 8px; padding: 12px 24px; border-bottom: 1px solid var(--background-modifier-border); } .bsc-add input { flex: 1; }
    .bsc-tabs { display: flex; gap: 0; padding: 10px 24px 0; border-bottom: 1px solid var(--background-modifier-border); }
    .bsc-tabs button { background: transparent; border: 0; border-bottom: 2px solid transparent; border-radius: 0; clip-path: none; box-shadow: none; color: var(--text-muted); padding: 6px 14px; height: auto; }
    .bsc-tabs button.mod-cta { background: transparent; color: var(--text-normal); border-bottom-color: var(--interactive-accent); }
    .bsc-row button.mod-cta { background: var(--background-primary); color: var(--text-normal); }
    .bsc-body { flex: 1; overflow: auto; padding: 10px 24px 20px; }
    .bsc-row { display: flex; gap: 12px; align-items: center; padding: 10px 12px; margin: 6px 0; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; }
    .bsc-row .bsc-i { flex: 1; min-width: 0; } .bsc-row b { font-weight: 600; } .bsc-row small { display: block; color: var(--text-muted); }
    .bsc-tag { display: inline-block; padding: 0 6px; margin-left: 6px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; background: color-mix(in srgb, var(--interactive-accent) 20%, transparent); color: var(--interactive-accent); }
    .bsc-msg { color: var(--text-muted); padding: 14px 4px; } .bsc-err { color: var(--text-error); padding: 6px 4px; white-space: pre-wrap; }
    .bsc-src { display: flex; gap: 8px; align-items: center; padding: 6px 10px; margin: 4px 0; background: var(--background-secondary); border-radius: 0; } .bsc-src span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  document.head.appendChild(css);

  const catFile = () => app.vault.configDir + "/basalt-catalog.json";
  let cat = { sources: [], repos: {} };
  const loadCat = async () => { try { const a = app.vault.adapter; if (await a.exists(catFile())) cat = Object.assign(cat, JSON.parse(await a.read(catFile()))); } catch (e) { /* first run */ } };
  const saveCat = () => app.vault.adapter.write(catFile(), JSON.stringify(cat, null, 1));

  // ---- network (Node's https: no browser CORS rules, follows redirects)
  function get(url, depth = 0) {
    return new Promise((resolve, reject) => {
      if (depth > 5) return reject(new Error("слишком много перенаправлений"));
      const u = new URL(url);
      if (u.protocol !== "https:") return reject(new Error("только https"));
      https.get(u, { headers: { "User-Agent": "Basalt", Accept: "application/vnd.github+json, */*" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) { res.resume(); return resolve(get(new URL(res.headers.location, u).toString(), depth + 1)); }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${res.statusCode} для ${u.host}${u.pathname}`)); }
        const parts = []; let size = 0;
        res.on("data", (c) => { size += c.length; if (size > 60 * 1024 * 1024) { reject(new Error("файл слишком большой")); res.destroy(); } else parts.push(c); });
        res.on("end", () => resolve(Buffer.concat(parts)));
      }).on("error", reject);
    });
  }
  const getJson = async (url) => JSON.parse((await get(url)).toString("utf8"));
  const parseRepo = (s) => { const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/.exec(String(s).trim()); return m ? `${m[1]}/${m[2]}` : null; };

  async function install(repo) {
    const rel = await getJson(`https://api.github.com/repos/${repo}/releases/latest`);
    const asset = (name) => (rel.assets || []).find((a) => a.name === name);
    const mAsset = asset("manifest.json");
    const manifest = mAsset ? JSON.parse((await get(mAsset.browser_download_url)).toString("utf8")) : await getJson(`https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`);
    if (!manifest.id || !/^[\w.-]+$/.test(manifest.id)) throw new Error("в manifest.json нет корректного id");
    const wasm = !!manifest.wasm;
    const main = asset(wasm ? manifest.wasm : "main.js");
    if (!main) throw new Error(`в релизе ${rel.tag_name} нет файла ${wasm ? manifest.wasm : "main.js"}`);
    const verb = wasm ? "Wasm-плагин (изолирован, получает только разрешённое)" : "плагин на JavaScript (получает полный доступ к приложению и файлам)";
    if (!(await window.__bsConfirm(`Установить «${manifest.name || manifest.id}» ${manifest.version || rel.tag_name}\nиз github.com/${repo}\n\nЭто ${verb}.\nУстанавливайте только то, чему доверяете.`, { title: "Установка плагина", ok: "Установить" }))) return null;
    const a = app.vault.adapter, dir = (wasm ? app.vault.configDir + "/wasm-plugins/" : app.vault.configDir + "/plugins/") + manifest.id;
    if (!(await a.exists(dir))) await a.mkdir(dir).catch(async () => { await a.mkdir(dir.slice(0, dir.lastIndexOf("/"))).catch(() => {}); await a.mkdir(dir); });
    await a.write(dir + "/manifest.json", JSON.stringify(manifest, null, 2));
    await a.writeBinary(dir + "/" + (wasm ? manifest.wasm : "main.js"), (await get(main.browser_download_url)).buffer.slice(0));
    const st = asset("styles.css"); if (st && !wasm) await a.write(dir + "/styles.css", (await get(st.browser_download_url)).toString("utf8"));
    cat.repos[manifest.id] = repo; await saveCat();
    if (wasm) { const m = { ...manifest, dir }; if (await window.__bsWasm.enable(m)) return { manifest, wasm }; return { manifest, wasm, notEnabled: true }; }
    if (!app.plugins.isEnabled()) await app.plugins.setEnable(true);
    await app.plugins.loadManifests();
    await app.plugins.enablePluginAndSave(manifest.id);
    return { manifest, wasm };
  }

  // the public community list: every plugin people published for this plugin format, with download counts
  const COMMUNITY = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
  const STATS = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugin-stats.json";
  let communityCache = null;
  async function community() {
    if (communityCache) return communityCache;
    const file = app.vault.configDir + "/community-cache.json", a = app.vault.adapter;
    try { if (await a.exists(file)) { const c = JSON.parse(await a.read(file)); if (Date.now() - c.at < 864e5) return (communityCache = c.list); } } catch (e) { /* refetch */ }
    const [list, stats] = await Promise.all([getJson(COMMUNITY), getJson(STATS).catch(() => ({}))]);
    communityCache = list.map((p) => ({ id: p.id, name: p.name, author: p.author, description: p.description, repo: p.repo, downloads: (stats[p.id] && stats[p.id].downloads) || 0 })).sort((x, y) => y.downloads - x.downloads);
    a.write(file, JSON.stringify({ at: Date.now(), list: communityCache })).catch(() => {});
    return communityCache;
  }

  async function installed() {
    const out = [];
    const man = app.plugins.manifests || {};
    for (const id of Object.keys(man)) out.push({ id, name: man[id].name, version: man[id].version, kind: "js", enabled: app.plugins.enabledPlugins && app.plugins.enabledPlugins.has(id), repo: cat.repos[id] });
    if (window.__bsWasm) for (const m of await window.__bsWasm.list()) out.push({ id: m.id, name: m.name, version: m.version, kind: "wasm", enabled: m.enabled, repo: cat.repos[m.id], m });
    return out;
  }

  async function open() {
    await loadCat();
    const wrap = document.createElement("div"); wrap.className = "modal-container mod-dim";
    wrap.innerHTML = '<div class="modal-bg"></div><div class="modal bsc"><div class="modal-close-button"></div><div class="bsc-head"><div class="bsc-title">Плагины</div><div class="bsc-sub">Установка напрямую из GitHub: без магазина и модерации. Плагины на Wasm изолированы, JS-плагины получают полный доступ.</div></div><div class="bsc-add"><input type="text" placeholder="Поиск по сообществу, либо owner/repo для прямой установки"><button class="mod-cta">Установить</button></div><div class="bsc-tabs"></div><div class="bsc-body"></div></div>';
    const q = (s) => wrap.querySelector(s), body = q(".bsc-body"), input = q("input");
    const prev = document.activeElement; const onEsc = (e) => { if (e.key === "Escape") close(); }; document.addEventListener("keydown", onEsc, true); const close = () => { document.removeEventListener("keydown", onEsc, true); wrap.remove(); try { prev && prev.focus && prev.focus(); } catch (e) { /* gone */ } };
    q(".modal-close-button").addEventListener("click", close); q(".modal-bg").addEventListener("click", close);
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    let tab = "community", shown = 60, lastQuery = "";
    const tabs = q(".bsc-tabs");
    for (const [k, label] of [["installed", "Установлено"], ["community", "Сообщество"], ["catalog", "Из источников"], ["sources", "Источники"]]) { const b = document.createElement("button"); b.textContent = label; b.dataset.k = k; b.addEventListener("click", () => { tab = k; shown = 60; render(); }); tabs.appendChild(b); }
    const row = (title, sub, tag, btns) => { const r = document.createElement("div"); r.className = "bsc-row"; r.innerHTML = '<div class="bsc-i"><b></b><small></small></div>'; r.querySelector("b").textContent = title; if (tag) { const t = document.createElement("span"); t.className = "bsc-tag"; t.textContent = tag; r.querySelector("b").appendChild(t); } r.querySelector("small").textContent = sub || ""; for (const [l, fn, cls] of btns) { const b = document.createElement("button"); b.textContent = l; if (cls) b.className = cls; b.addEventListener("click", async () => { b.disabled = true; try { await fn(); } catch (e) { notice(e.message); } render(); }); r.appendChild(b); } return r; };
    const notice = (m) => { try { new window.__bsApi.Notice(m, 6000); } catch (e) { alert(m); } };
    const doInstall = async (repo) => { try { notice(`Скачиваю ${repo}…`); const r = await install(repo); if (r) notice(`«${r.manifest.name || r.manifest.id}» установлен${r.notEnabled ? ", но не включён" : " и включён"}`); } catch (e) { notice("Не удалось установить: " + e.message); } render(); };
    async function render() {
      tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("mod-cta", b.dataset.k === tab));
      body.textContent = "…";
      const frag = document.createDocumentFragment();
      if (tab === "installed") {
        const list = await installed();
        if (!list.length) frag.appendChild(Object.assign(document.createElement("div"), { className: "bsc-msg", textContent: "Пока ничего не установлено. Вставьте owner/repo выше." }));
        for (const p of list) {
          const btns = [];
          btns.push([p.enabled ? "Выключить" : "Включить", async () => { if (p.kind === "wasm") { p.enabled ? await window.__bsWasm.disable(p.id) : await window.__bsWasm.enable(p.m); } else { p.enabled ? await app.plugins.disablePluginAndSave(p.id) : await app.plugins.enablePluginAndSave(p.id); } }]);
          if (p.repo) btns.push(["Обновить", async () => { await doInstall(p.repo); }]);
          btns.push(["Удалить", async () => { if (!(await window.__bsConfirm(`Удалить плагин «${p.name || p.id}»?`, { title: "Удаление плагина", ok: "Удалить", danger: true }))) return; if (p.kind === "wasm") await window.__bsWasm.remove(p.id); else await app.plugins.uninstallPlugin(p.id); delete cat.repos[p.id]; await saveCat(); }, "mod-warning"]);
          frag.appendChild(row(p.name || p.id, `${p.version || ""}${p.repo ? " · github.com/" + p.repo : ""}${p.enabled ? " · включён" : " · выключен"}`, p.kind === "wasm" ? "wasm" : "js", btns));
        }
      } else if (tab === "community") {
        let list = [];
        try { list = await community(); } catch (e) { frag.appendChild(Object.assign(document.createElement("div"), { className: "bsc-err", textContent: "Не удалось загрузить список: " + e.message })); }
        const have = new Set((await installed()).map((p) => p.id));
        const f = input.value.trim().toLowerCase();
        const hit = (f && !parseRepo(input.value) ? list.filter((p) => (p.name + " " + p.description + " " + p.author + " " + p.id).toLowerCase().includes(f)) : list);
        const bar = document.createElement("div"); bar.className = "bsc-msg"; bar.textContent = `${list.length} плагинов в списке сообщества${f && !parseRepo(input.value) ? `, найдено ${hit.length}` : ""}. Строка сверху ищет по названию и описанию; owner/repo ставит напрямую.`; frag.appendChild(bar);
        if (f !== lastQuery) { shown = 60; lastQuery = f; }
        for (const p of hit.slice(0, shown)) {
          const r = row(p.name, `${p.description || ""} — ${p.author || ""}${p.downloads ? " · " + p.downloads.toLocaleString() + " загрузок" : ""}`, "", have.has(p.id) ? [["Установлен", async () => {}]] : [["Установить", () => doInstall(p.repo), "mod-cta"]]);
          frag.appendChild(r);
        }
        if (hit.length > shown) { const more = document.createElement("button"); more.className = "mod-cta"; more.style.cssText = "display:block;margin:12px auto"; more.textContent = `Показать ещё (${Math.min(60, hit.length - shown)} из ${hit.length - shown} оставшихся)`; more.addEventListener("click", () => { shown += 60; const top = body.scrollTop; render().then(() => { body.scrollTop = top; }); }); frag.appendChild(more); }
      } else if (tab === "catalog") {
        if (!cat.sources.length) frag.appendChild(Object.assign(document.createElement("div"), { className: "bsc-msg", textContent: "Источников нет. Добавьте ссылку на JSON-список на вкладке «Источники». Формат списка: [{\"repo\": \"owner/repo\", \"name\": \"Название\", \"description\": \"Что делает\"}]. Либо просто вставьте owner/repo в поле сверху." }));
        for (const url of cat.sources) {
          try {
            const j = await getJson(url), items = Array.isArray(j) ? j : j.plugins || [];
            for (const it of items) { const repo = parseRepo(it.repo || ""); if (repo) frag.appendChild(row(it.name || repo, it.description || repo, "", [["Установить", () => doInstall(repo), "mod-cta"]])); }
          } catch (e) { frag.appendChild(Object.assign(document.createElement("div"), { className: "bsc-err", textContent: `${url}: ${e.message}` })); }
        }
      } else {
        for (const url of cat.sources) { const d = document.createElement("div"); d.className = "bsc-src"; d.innerHTML = "<span></span>"; d.firstChild.textContent = url; const b = document.createElement("button"); b.textContent = "Убрать"; b.addEventListener("click", async () => { cat.sources = cat.sources.filter((x) => x !== url); await saveCat(); render(); }); d.appendChild(b); frag.appendChild(d); }
        const add = document.createElement("div"); add.className = "bsc-add"; add.style.padding = "8px 0";
        add.innerHTML = '<input type="text" placeholder="https://…/plugins.json или owner/repo с файлом plugins.json"><button>Добавить источник</button>';
        add.querySelector("button").addEventListener("click", async () => {
          let u = add.querySelector("input").value.trim(); if (!u) return;
          const r = parseRepo(u); if (!/^https:/.test(u) && r) u = `https://raw.githubusercontent.com/${r}/HEAD/plugins.json`;
          if (!/^https:\/\//.test(u)) return notice("Нужна ссылка https или owner/repo");
          if (!cat.sources.includes(u)) { cat.sources.push(u); await saveCat(); } render();
        });
        frag.appendChild(add);
      }
      body.textContent = ""; body.appendChild(frag);
    }
    q(".bsc-add button").addEventListener("click", () => { const r = parseRepo(input.value); if (!r) return notice("Нужно owner/repo или ссылка на GitHub"); input.value = ""; doInstall(r); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !(tab === "community" && !parseRepo(input.value))) q(".bsc-add button").click(); });
    let typing = 0; input.addEventListener("input", () => { clearTimeout(typing); if (tab === "community") typing = setTimeout(render, 250); });
    document.body.appendChild(wrap); render(); input.focus();
  }
  window.__bsCatalog = { open, install, parseRepo };
  const t = setInterval(() => {
    if (!(window.app && app.commands && app.workspace && app.workspace.layoutReady && window.__bsApi)) return;
    clearInterval(t);
    app.commands.addCommand({ id: "basalt:plugin-catalog", name: "Плагины: каталог и установка из GitHub", callback: open });
  }, 700);
})();
