// Canvas cards of code / text files (yaml, js, py, json, ...) show their text like md cards do,
// instead of only the file name. Highlighted with the editor's CodeMirror modes when they are loaded.
(function () {
  const TEXT = /^(txt|json|jsonc|yaml|yml|toml|ini|cfg|conf|env|lock|xml|svg|html|htm|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|rs|go|java|kt|kts|c|h|cpp|hpp|cc|cs|swift|rb|php|lua|sh|bash|zsh|bat|cmd|ps1|dart|sql|gradle|properties|iml|csv|log|gitignore|dockerfile|makefile|cmake|vue|svelte|r|pl|scala|ex|exs|erl|hs|clj|zig|nim|proto|graphql)$/i;
  const MAX = 60000;
  const css = document.createElement("style");
  css.textContent = `
    .bs-cprev { position: absolute; inset: 0; overflow: auto; margin: 0; padding: 10px 14px; box-sizing: border-box; font-family: var(--font-monospace); font-size: 12.5px; line-height: 1.5; color: var(--text-normal); white-space: pre; tab-size: 4; background: transparent; user-select: text; }
    .canvas-node-content.bs-cprev-host { position: relative; }
    .canvas-node-content.bs-cprev-host > :not(.bs-cprev) { display: none !important; }
  `;
  document.head.appendChild(css);
  const extOf = (p) => { const b = p.split("/").pop(), i = b.lastIndexOf("."); return i > 0 ? b.slice(i + 1) : b.replace(/^\./, ""); };
  async function paint(node, file) {
    const host = node.contentEl; if (!host) return;
    let text; try { text = await app.vault.cachedRead(file); } catch (e) { return; }
    if (text.length > MAX) text = text.slice(0, MAX) + "\n…";
    let pre = host.querySelector(":scope > .bs-cprev"); if (!pre) { pre = document.createElement("pre"); pre.className = "bs-cprev cm-s-default"; host.appendChild(pre); }
    host.classList.add("bs-cprev-host"); pre.textContent = "";
    const CM = window.CodeMirror, mi = CM && CM.findModeByFileName && CM.findModeByFileName(file.name);
    if (CM && CM.runMode && mi && mi.mode && CM.modes[mi.mode]) { try { CM.runMode(text, mi.mime || mi.mode, pre); } catch (e) { pre.textContent = text; } }
    else pre.textContent = text;
    node.__bsPrev = file.path + ":" + file.stat.mtime;
  }
  function scan() {
    for (const leaf of app.workspace.getLeavesOfType("canvas")) {
      const cv = leaf.view && leaf.view.canvas; if (!cv || !cv.nodes) continue;
      for (const node of cv.nodes.values()) {
        const f = node.file; if (!f || f.extension === "md" || f.extension === "canvas" || !TEXT.test(extOf(f.path))) continue;
        const key = f.path + ":" + f.stat.mtime;
        if (node.__bsPrev === key && node.contentEl && node.contentEl.querySelector(":scope > .bs-cprev")) continue;
        paint(node, f);
      }
    }
  }
  const wait = setInterval(() => {
    if (!window.app || !app.workspace || !app.workspace.layoutReady) return; clearInterval(wait);
    setInterval(() => { if (app.workspace.getLeavesOfType("canvas").length) scan(); }, 800);
  }, 500);
})();
