// Pinned files in the file explorer: "Закрепить" in a file's menu puts it at the top of its folder with a pin mark.
// The list lives in the vault's settings folder.
(() => {
  "use strict";
  const css = document.createElement("style");
  css.textContent = `
    .workspace-leaf-content[data-type=file-explorer] .nav-folder-children, .workspace-leaf-content[data-type=file-explorer] .nav-files-container > div { display: flex; flex-direction: column; }
    .workspace-leaf-content[data-type=file-explorer] .nav-file.bsp-pinned { order: -1; }
    .nav-file.bsp-pinned > .nav-file-title::after { content: ""; flex: none; width: 12px; height: 12px; margin-left: 6px; background: var(--interactive-accent);
      -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z'/%3E%3C/svg%3E") center / contain no-repeat; }
  `;
  document.head.appendChild(css);

  let pins = [];
  const file = () => app.vault.configDir + "/basalt-pins.json";
  const load = async () => { try { const a = app.vault.adapter; if (await a.exists(file())) pins = JSON.parse(await a.read(file())).filter((p) => typeof p === "string"); } catch (e) { pins = []; } };
  const save = async () => { try { await app.vault.adapter.write(file(), JSON.stringify(pins)); } catch (e) { console.error("[basalt-pins]", e); } };
  const mark = () => document.querySelectorAll(".workspace-leaf-content[data-type=file-explorer] .nav-file").forEach((el) => {
    const t = el.querySelector(".nav-file-title"), p = t && t.getAttribute("data-path");
    el.classList.toggle("bsp-pinned", !!p && pins.includes(p));
  });

  const listeners = [];
  const toggle = (path) => { pins = pins.includes(path) ? pins.filter((p) => p !== path) : pins.concat(path); save(); mark(); listeners.forEach((fn) => fn()); };
  window.__bsPinsApi = { has: (p) => pins.includes(p), toggle, onChange: (fn) => listeners.push(fn) };

  function boot() {
    load().then(() => {
      mark(); new MutationObserver(mark).observe(document.body, { childList: true, subtree: true });
      app.workspace.on("file-menu", (menu, f) => {
        if (!f || !f.extension) return;
        const on = pins.includes(f.path);
        menu.addItem((i) => i.setTitle(on ? "Открепить" : "Закрепить").setIcon(on ? "pin-off" : "pin").setSection("action").onClick(() => toggle(f.path)));
      });
      app.vault.on("rename", (f, old) => { const i = pins.indexOf(old); if (i >= 0) { pins[i] = f.path; save(); mark(); listeners.forEach((fn) => fn()); } });
    });
  }
  const t = setInterval(() => { if (window.app && app.workspace && app.vault && app.vault.adapter && app.workspace.layoutReady) { clearInterval(t); boot(); } }, 500);
})();
