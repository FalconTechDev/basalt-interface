// Basalt local API: a small HTTP server inside the app for scripts, bots and the `basalt-cli` command.
// Localhost only, every request needs the token (header "Authorization: Bearer <token>"), browsers are refused (no Origin allowed).
// Address and token are written to <userData>/basalt-api.json so the CLI finds them.
(() => {
  "use strict";
  const fs = window.require("fs"), path = window.require("path"), http = window.require("http"), crypto = window.require("crypto");

  const infoFile = () => path.join(window.electron.remote.app.getPath("userData"), "basalt-api.json");
  const readInfo = () => { try { return JSON.parse(fs.readFileSync(infoFile(), "utf8")); } catch (e) { return {}; } };

  const safe = (p) => {
    if (typeof p !== "string" || !p) return null;
    const n = p.replace(/\\/g, "/").replace(/^\/+/, "");
    if (n.split("/").some((s) => s === ".." || s === ".git") || /^[a-zA-Z]:/.test(n)) return null;
    return n;
  };
  const send = (res, code, body) => {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(code, { "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(data);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > 20 * 1024 * 1024) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
  const ensureFolder = async (p) => {
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    if (dir && !(await app.vault.adapter.exists(dir))) await app.vault.createFolder(dir).catch(() => {});
  };
  const fileOf = (p) => { const f = app.vault.getAbstractFileByPath(p); return f && f.extension !== undefined ? f : null; };

  async function handle(req, res, token) {
    if (req.headers.origin) return send(res, 403, { error: "browser requests are not allowed" });
    if (req.headers.authorization !== "Bearer " + token) return send(res, 401, { error: "bad or missing token" });
    const url = new URL(req.url, "http://127.0.0.1");
    const route = req.method + " " + url.pathname.replace(/\/+$/, "");
    const q = url.searchParams, p = safe(q.get("path"));
    switch (route) {
      case "GET /v1/status": {
        const files = app.vault.getFiles();
        return send(res, 200, { app: "Basalt", vault: app.vault.getName(), notes: files.filter((f) => f.extension === "md").length, canvases: files.filter((f) => f.extension === "canvas").length, files: files.length });
      }
      case "GET /v1/files": {
        const prefix = (q.get("folder") || "").replace(/^\/+|\/+$/g, "");
        const list = app.vault.getFiles().filter((f) => !prefix || f.path.startsWith(prefix + "/")).slice(0, +q.get("limit") || 5000).map((f) => ({ path: f.path, size: f.stat.size, mtime: f.stat.mtime }));
        return send(res, 200, list);
      }
      case "GET /v1/search": {
        const text = q.get("q") || "";
        if (!text.trim()) return send(res, 400, { error: "q is required" });
        if (window.__bsSearchApi) return send(res, 200, window.__bsSearchApi(text, +q.get("limit") || 20));
        const low = text.toLowerCase(), out = [];
        for (const f of app.vault.getMarkdownFiles()) { if (out.length >= (+q.get("limit") || 20)) break; const t = await app.vault.cachedRead(f); const i = t.toLowerCase().indexOf(low); if (i >= 0 || f.basename.toLowerCase().includes(low)) out.push({ path: f.path, title: f.basename, snippet: t.slice(Math.max(0, i - 40), i + 100) }); }
        return send(res, 200, out);
      }
      case "GET /v1/note": {
        const f = p && fileOf(p); if (!f) return send(res, 404, { error: "not found" });
        return send(res, 200, await app.vault.read(f));
      }
      case "PUT /v1/note": {
        if (!p) return send(res, 400, { error: "valid path is required" });
        const body = await readBody(req), f = fileOf(p);
        if (f) await app.vault.modify(f, body); else { await ensureFolder(p); await app.vault.create(p, body); }
        return send(res, 200, { ok: true, path: p, created: !f });
      }
      case "POST /v1/note/append": {
        if (!p) return send(res, 400, { error: "valid path is required" });
        const body = await readBody(req), f = fileOf(p);
        if (f) await app.vault.append(f, (body.startsWith("\n") ? "" : "\n") + body); else { await ensureFolder(p); await app.vault.create(p, body); }
        return send(res, 200, { ok: true, path: p, created: !f });
      }
      case "DELETE /v1/note": {
        const f = p && fileOf(p); if (!f) return send(res, 404, { error: "not found" });
        await app.vault.trash(f, true);
        return send(res, 200, { ok: true });
      }
      case "POST /v1/open": {
        const f = p && fileOf(p); if (!f) return send(res, 404, { error: "not found" });
        await app.workspace.getLeaf("tab").openFile(f);
        return send(res, 200, { ok: true });
      }
      case "POST /v1/quit": {
        send(res, 200, { ok: true });
        setTimeout(() => window.electron.remote.app.quit(), 200);
        return;
      }
      default:
        return send(res, 404, { error: "unknown route", routes: ["GET /v1/status", "GET /v1/files", "GET /v1/search?q=", "GET|PUT|DELETE /v1/note?path=", "POST /v1/note/append?path=", "POST /v1/open?path=", "POST /v1/quit"] });
    }
  }

  function start() {
    const prev = readInfo();
    const token = prev.token || crypto.randomBytes(24).toString("hex");
    const server = http.createServer((req, res) => { handle(req, res, token).catch((e) => send(res, 500, { error: String(e && e.message || e) })); });
    let port = prev.port || 27124, tries = 0;
    server.on("error", (e) => { if (e.code === "EADDRINUSE" && tries++ < 20) { port++; server.listen(port, "127.0.0.1"); } else console.error("[basalt-api]", e.message); });
    server.on("listening", () => {
      try { fs.writeFileSync(infoFile(), JSON.stringify({ port, token, vault: app.vault.getName(), pid: process.pid }, null, 2), { mode: 0o600 }); } catch (e) { console.error("[basalt-api] info file", e); }
      window.__bsApiInfo = { port, token };
    });
    server.listen(port, "127.0.0.1");
    window.addEventListener("beforeunload", () => { try { server.close(); } catch (e) { /* gone */ } });
    app.commands.addCommand({
      id: "basalt:api-info", name: "API: показать адрес и скопировать токен",
      callback: () => { const i = window.__bsApiInfo; if (!i) return; navigator.clipboard.writeText(i.token).catch(() => {}); new window.__bsApi.Notice(`Basalt API: http://127.0.0.1:${i.port}\nТокен скопирован в буфер обмена`, 8000); },
    });
  }
  const t = setInterval(() => { if (window.app && app.vault && app.vault.adapter && app.workspace && app.workspace.layoutReady && app.commands && window.__bsApi) { clearInterval(t); try { start(); } catch (e) { console.error("[basalt-api]", e); } } }, 700);
})();
