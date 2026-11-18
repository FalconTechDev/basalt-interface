// Updates from GitHub Releases: no update server of our own. Checks once a day (can be switched off in Settings > About),
// shows what is new, downloads the installer asset and runs it silently; the installer closes and restarts Basalt.
(() => {
  "use strict";
  const REPO = "FalconTechDev/basalt", VERSION = "0.1.0";
  const https = window.require("https"), fs = window.require("fs"), path = window.require("path"), os = window.require("os"), cp = window.require("child_process");
  const num = (v) => String(v).replace(/^v/i, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  const auto = () => localStorage.getItem("basalt-update-auto") !== "0";
  const setAuto = (v) => localStorage.setItem("basalt-update-auto", v ? "1" : "0");
  const notice = (m, t) => { try { new window.__bsApi.Notice(m, t || 6000); } catch (e) { console.log(m); } };

  function get(url, binary, onProgress, depth = 0) {
    return new Promise((resolve, reject) => {
      if (depth > 5) return reject(new Error("слишком много перенаправлений"));
      https.get(new URL(url), { headers: { "User-Agent": "Basalt/" + VERSION, Accept: "application/vnd.github+json, */*" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) { res.resume(); return resolve(get(new URL(res.headers.location, url).toString(), binary, onProgress, depth + 1)); }
        if (res.statusCode !== 200) { res.resume(); return reject(Object.assign(new Error("ответ " + res.statusCode), { code: res.statusCode })); }
        const total = +res.headers["content-length"] || 0, parts = []; let got = 0;
        res.on("data", (c) => { parts.push(c); got += c.length; if (onProgress && total) onProgress(got / total); });
        res.on("end", () => resolve(binary ? Buffer.concat(parts) : Buffer.concat(parts).toString("utf8")));
      }).on("error", reject);
    });
  }
  async function install(asset) {
    const file = path.join(os.tmpdir(), asset.name);
    notice("Скачиваю обновление…", 4000);
    fs.writeFileSync(file, await get(asset.browser_download_url, true));
    notice("Устанавливаю: Basalt перезапустится", 5000);
    cp.spawn(file, ["/SILENT", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS"], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => window.electron.remote.app.quit(), 1500);
  }
  async function check(manual) {
    try {
      localStorage.setItem("basalt-update-last", String(Date.now()));
      const rel = JSON.parse(await get(`https://api.github.com/repos/${REPO}/releases/latest`));
      if (!rel.tag_name || !newer(rel.tag_name, VERSION)) { if (manual) notice(`У вас последняя версия (${VERSION})`); return; }
      const asset = (rel.assets || []).find((a) => /Setup.*\.exe$/i.test(a.name));
      const ok = await window.__bsConfirm(`Доступна версия ${rel.tag_name.replace(/^v/, "")} (у вас ${VERSION}).\n\n${String(rel.body || "").slice(0, 700)}`, { title: "Обновление Basalt", ok: asset ? "Обновить сейчас" : "Открыть страницу", cancel: "Позже" });
      if (!ok) return;
      if (asset) await install(asset); else window.require("electron").shell.openExternal(rel.html_url);
    } catch (e) {
      if (manual) notice(e.code === 404 || /404/.test(String(e.message)) ? "Релизов на GitHub пока нет" : "Не удалось проверить обновления: " + e.message);
    }
  }
  window.__bsUpdate = { check, auto, setAuto, VERSION, newer };
  const t = setInterval(() => {
    if (!(window.app && app.commands && app.workspace && app.workspace.layoutReady && window.__bsApi && window.__bsConfirm)) return;
    clearInterval(t);
    app.commands.addCommand({ id: "basalt:check-updates", name: "Проверить обновления Basalt", callback: () => check(true) });
    const last = +localStorage.getItem("basalt-update-last") || 0;
    if (auto() && Date.now() - last > 864e5) setTimeout(() => check(false), 20000);
  }, 800);
})();
