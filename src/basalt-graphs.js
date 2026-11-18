// Basalt code graphs: "Граф файлов" (directories, files, imports between files) and "Граф кода" (functions / classes and the calls between
// them) for the open folder (or the vault). Plain-text parsing per language, force layout on a 2D canvas, pan / zoom / drag / pin, search,
// click opens the file. Positions are remembered in <root>/.basalt/graph-layout.json.
(() => {
  "use strict";
  const VIEW = "basalt-codegraph";
  const fs = window.require("fs"), path = window.require("path");
  const SKIP = new Set(["node_modules", "target", "dist", "build", "out", "__pycache__", "venv", ".venv", "vendor", "coverage", "bin", "obj", "Pods", "site-packages", "third_party"]);
  const LIMIT_FILES = 6000, MAX_BYTES = 400 * 1024, MAX_SYMS = 12000;
  const LANG = {
    js: ["JavaScript", "#f1e05a"], jsx: ["JavaScript", "#f1e05a"], mjs: ["JavaScript", "#f1e05a"], cjs: ["JavaScript", "#f1e05a"], ts: ["TypeScript", "#3178c6"], tsx: ["TypeScript", "#3178c6"],
    py: ["Python", "#3572A5"], rs: ["Rust", "#dea584"], go: ["Go", "#00ADD8"], java: ["Java", "#b07219"], kt: ["Kotlin", "#A97BFF"], cs: ["C#", "#178600"],
    c: ["C", "#aaaaaa"], h: ["C", "#aaaaaa"], cpp: ["C++", "#f34b7d"], hpp: ["C++", "#f34b7d"], cc: ["C++", "#f34b7d"], swift: ["Swift", "#F05138"], rb: ["Ruby", "#cc342d"],
    php: ["PHP", "#8892bf"], dart: ["Dart", "#00B4AB"], lua: ["Lua", "#5a5aff"], sh: ["Shell", "#89e051"], css: ["CSS", "#7a5cc7"], html: ["HTML", "#e34c26"],
  };
  const FILECOL = { txt: "#9aa0a6", md: "#519aba", mdx: "#519aba", json: "#cbcb41", yaml: "#e06c75", yml: "#e06c75", toml: "#c9733a", lock: "#7a7a7a", png: "#a074c4", jpg: "#a074c4", jpeg: "#a074c4", gif: "#a074c4", webp: "#a074c4", ico: "#a074c4", svg: "#ffb13b", pdf: "#e44d4d", zip: "#b58900", gz: "#b58900", tar: "#b58900", exe: "#6d8086", dll: "#6d8086", so: "#6d8086", bat: "#89e051", cmd: "#89e051", ps1: "#4d8fd1", log: "#8a8a8a", csv: "#4caf50", xml: "#e37933", ini: "#8a8a8a", env: "#ecd53f", gradle: "#5aa9a9", properties: "#8a8a8a", sql: "#e38c00", ipynb: "#f37626", dockerfile: "#2496ed", mjs: "#f1e05a" };
  const langOf = (ext) => LANG[ext] || [ext ? ext.toUpperCase() : "Файл", FILECOL[ext] || "#8a8a8a"];
  const P_FOLDER = new Path2D("M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z");
  const P_FILE = new Path2D("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z");
  const P_FOLD = new Path2D("M14 2v4a2 2 0 0 0 2 2h4");
  const JSLIKE = new Set(["js", "jsx", "mjs", "cjs", "ts", "tsx"]), CLIKE = new Set(["c", "h", "cpp", "hpp", "cc"]), JVM = new Set(["java", "kt", "cs"]);
  const KW = new Set(["if", "for", "while", "switch", "catch", "function", "return", "else", "do", "try", "new", "typeof", "sizeof", "super", "this", "await", "async", "def", "fn", "func", "class", "match", "with", "and", "or", "not", "in", "is", "elif", "print", "len", "range", "str", "int", "map", "get", "set", "log", "push", "pop", "join", "then", "constructor", "require", "import", "assert", "println", "format", "Some", "Ok", "Err", "Vec", "String", "Box", "Arc"]);
  const css = document.createElement("style");
  css.textContent = `
    .bsg { --background-primary: var(--vs-bg); --background-secondary: var(--vs-widget); --text-normal: var(--vs-fg); --text-muted: var(--vs-ln); --text-faint: var(--vs-ln); --background-modifier-border: var(--vs-border); --background-modifier-hover: rgba(128,128,128,.18); --font-monospace: Consolas, 'Cascadia Code', monospace; font-family: var(--font-interface); position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--vs-bg); color: var(--vs-fg); }
    .bsg-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--background-modifier-border); flex-wrap: wrap; }
    .bsg-seg { display: inline-flex; border: 1px solid var(--background-modifier-border); border-radius: var(--bs-r, 4px); overflow: hidden; }
    .bsg-seg button { border: 0; border-radius: 0; background: transparent; padding: 3px 12px; height: 26px; color: var(--text-muted); cursor: pointer; box-shadow: none; font-size: var(--font-ui-small); }
    .bsg-seg button.bsg-si { padding: 0 10px; height: 26px; display: inline-flex; align-items: center; gap: 6px; }
    .bsg-sic { display: inline-flex; } .bsg-sic svg { width: 14px; height: 14px; stroke-width: 1.75; }
    .bsg-seg button.on { background: var(--interactive-accent); color: var(--text-on-accent); }
    .bsg-btn { border: 0; border-radius: var(--bs-r, 4px); background: transparent; height: 24px; padding: 0 10px; color: var(--vs-ln); cursor: pointer; box-shadow: none; font-size: 12px; }
    .bsg-ib { width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; flex: none; } .bsg-ib svg { width: 16px; height: 16px; }
    .bsg-btn:hover { color: var(--vs-fg); background: rgba(128,128,128,.2); } .bsg-btn.on { color: var(--vs-fg); background: rgba(128,128,128,.28); }
    .bsg-search:focus { outline: 1px solid var(--interactive-accent); }
    .bsg-search { height: 24px; font-size: 12px; width: 150px; padding: 0 8px; border-radius: var(--bs-r, 4px); border: 1px solid transparent; background: var(--vs-input); outline-offset: -1px; color: var(--text-normal); font-size: var(--font-ui-small); }
    .bsg-info { margin-left: auto; color: var(--text-faint); font-size: var(--font-ui-smaller); white-space: nowrap; }
    .bsg-body { position: relative; flex: 1; min-height: 0; }
    .bsg-sbox { position: relative; display: flex; align-items: center; } .bsg-sbox .bsg-search { width: 260px; padding-right: 64px; } .bsg-count { position: absolute; right: 10px; font-size: 11px; color: var(--text-faint); pointer-events: none; }
    .bsg-panel .setting-item-info { flex: 1 1 auto; min-width: 0; } .bsg-panel .setting-item-control { flex: 0 0 auto; } .bsg-panel .setting-item-control input[type=range] { width: 140px; }
    .bsg-panel .setting-item-heading { background: none; border: 0; border-top: 1px solid var(--background-modifier-border); border-radius: 0; margin-top: 12px; padding: 14px 4px 6px; } .bsg-panel .setting-item-heading:first-child { border-top: 0; margin-top: 0; }
    .bsg-panel { overflow-x: hidden; box-sizing: border-box; position: absolute; right: 60px; top: 12px; width: 380px; padding: 12px 14px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);   display: none; font-size: 12.5px; }
    .bsg-panel.is-open { display: block; }
    .bsg-panel .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 8px 0; color: var(--text-muted); }
    .bsg-panel input[type=range] { width: 120px; }
    .bsg-panel .hd { margin: 14px 0 6px; padding-top: 10px; border-top: 1px solid var(--background-modifier-border); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-faint); }
    .bsg-panel .grp { gap: 6px; } .bsg-panel .grp input[type=color] { width: 22px; height: 22px; padding: 0; border: 0; background: none; flex: none; }
    .bsg-panel .grp .nm { flex: 1; min-width: 0; height: 24px; padding: 0 6px; font-size: 12px; } .bsg-panel .grp .n { color: var(--text-faint); font-size: 11px; min-width: 16px; text-align: right; }
    .bsg-panel .grp.is-off .nm, .bsg-panel .grp.is-off .n { opacity: .45; } .bsg-panel .grp.is-solo { background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); }
    .bsg-panel .grp .ic { width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: transparent; box-shadow: none; clip-path: none; border: 0; color: var(--text-faint); cursor: pointer; border-radius: var(--bs-r); flex: none; }
    .bsg-panel .grp .ic svg { width: 15px; height: 15px; } .bsg-panel .grp .ic:hover { color: var(--text-normal); background: var(--background-modifier-hover); } .bsg-panel .grp .ic.on { color: var(--interactive-accent); }
    .bsg-panel .focusbox { margin: 8px 0; padding: 8px 10px; border: 1px solid var(--background-modifier-border); } .bsg-panel .focusbox .row b { min-width: 28px; text-align: right; color: var(--text-muted); font-weight: 500; }
    .bsg-panel .grp .x, .bsg-panel .wide { background: transparent; box-shadow: none; clip-path: none; border: 1px solid var(--background-modifier-border); color: var(--text-muted); cursor: pointer; border-radius: var(--bs-r); }
    .bsg-panel .grp .x { width: 22px; height: 22px; padding: 0; } .bsg-panel .wide { width: 100%; height: 28px; margin: 4px 0; font-size: 12px; } .bsg-panel .wide:hover, .bsg-panel .grp .x:hover { color: var(--text-normal); border-color: var(--interactive-accent); }
    .bsg-panel .mute { font-size: 11.5px; color: var(--text-faint); }
    .bsg-panel { max-height: calc(100% - 66px); overflow-y: auto; }
    .bscg-top { position: absolute; left: 14px; right: 60px; top: 12px; z-index: 6; padding: 0; border: 0; flex-wrap: nowrap; }
    .bsg-body { position: absolute !important; inset: 0; }
    .bscg-controls { position: absolute; right: 12px; top: 12px; z-index: 6; }
    .bscg-controls .canvas-control-group { background: var(--background-secondary); border-radius: 0; box-shadow: none; clip-path: var(--bs-clip); }
    .bscg-controls .canvas-control-item { background: transparent; } .bscg-controls .canvas-control-item:hover { background: var(--background-modifier-hover); }
    .bsg-body > .bsg-panel { z-index: 7; }
    .bsg-panel .hd.first { margin-top: 2px; padding-top: 0; border-top: 0; }
    .bsg-panel .btns { display: flex; gap: 6px; margin: 6px 0 2px; } .bsg-panel .btns button { flex: 1; height: 26px; font-size: 12px; background: transparent; box-shadow: none; clip-path: none; border: 1px solid var(--background-modifier-border); color: var(--text-muted); border-radius: var(--bs-r); cursor: pointer; } .bsg-panel .btns button:hover { color: var(--text-normal); border-color: var(--interactive-accent); }
    .bsg-panel .li { display: inline-flex; width: 15px; height: 15px; margin-right: 7px; color: var(--text-faint); vertical-align: -3px; flex: none; } .bsg-panel .li svg { width: 15px; height: 15px; }
    .bsg-panel .hd { display: flex; align-items: center; } .bsg-panel .hd .li { color: var(--interactive-accent); }
    .bsg-panel .row .lb { display: flex; align-items: center; flex: 1; min-width: 0; }
    .bsg-panel .cbs { display: flex; gap: 10px; } .bsg-panel .cb2:checked { background-color: #6e96be !important; border-color: #6e96be !important; --interactive-accent: #6e96be; }
    .bsg-panel .cap { display: flex; justify-content: flex-end; gap: 4px; margin: -2px 0 2px; font-size: 10.5px; color: var(--text-faint); } .bsg-panel .cap span { width: 40px; text-align: center; }
    .bsg-panel .row.focus .nm { color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bsg-panel .row.focus .n { color: var(--text-muted); min-width: 36px; text-align: center; font-size: 12px; }
    .bsg-panel .row.focus .ic { width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: transparent; box-shadow: none; clip-path: none; border: 0; color: var(--text-muted); cursor: pointer; border-radius: var(--bs-r); flex: none; } .bsg-panel .row.focus .ic:hover { color: var(--text-normal); background: var(--background-modifier-hover); } .bsg-panel .row.focus .ic svg { width: 15px; height: 15px; }
    .bsg-panel .wide .li, .bsg-panel .btns button .li { margin-right: 6px; } .bsg-panel .wide, .bsg-panel .btns button { display: inline-flex; align-items: center; justify-content: center; }
    .bsg-panel .setting-item { padding: 8px 0; } .bsg-panel .setting-item-heading { padding-top: 14px; } .bsg-panel .setting-item-name { display: flex; align-items: center; }
    .bsg-panel .bsg-si { display: inline-flex; width: 16px; height: 16px; margin-right: 8px; color: var(--interactive-accent); flex: none; } .bsg-panel .bsg-si svg { width: 16px; height: 16px; }
    .bsg-panel .bsg-t2.is-enabled { background-color: #6e96be; }
    .bsg-panel .bsg-off .setting-item-name, .bsg-panel .bsg-off .setting-item-description { opacity: .45; } .bsg-panel .bsg-solo { background: color-mix(in srgb, var(--interactive-accent) 12%, transparent); }
      this.top = this.root.querySelector(".bsg-top"); this.panel = this.root.querySelector(".bsg-panel"); this.status = this.root.querySelector(".bsg-status"); this.card = this.root.querySelector(".bsg-card"); this.helpEl = { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } }; this.empty = this.root.querySelector(".bsg-empty");
    .bscg-panel { position: absolute; right: 60px; top: 12px; z-index: 7; width: 300px; padding: 12px 14px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); clip-path: var(--bs-clip); display: none; font-size: 12.5px; box-sizing: border-box; }
    .bscg-panel.is-open { display: block; }
    .bscg-hd { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-faint); margin-bottom: 6px; }
    .bscg-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 8px 0; color: var(--text-muted); }
    .bscg-row button { height: 26px; padding: 0 10px; font-size: 12px; }
    .bscg-info { position: absolute; left: 14px; bottom: 10px; z-index: 5; color: var(--text-faint); font-size: var(--font-ui-smaller); pointer-events: none; }
    .bsg canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; }
    .bsg-tip { position: absolute; z-index: 5; pointer-events: none; display: none; max-width: 360px; padding: 6px 10px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); box-shadow: 0 4px 16px rgba(0,0,0,.3); font-size: var(--font-ui-smaller); color: var(--text-normal); }
    .bsg-tip b { display: block; margin-bottom: 2px; } .bsg-tip span { color: var(--text-muted); display: block; }
    .bsg-legend { position: absolute; left: 10px; bottom: 10px; display: flex; flex-wrap: wrap; gap: 4px 12px; max-width: 60%; padding: 6px 10px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); font-size: var(--font-ui-smaller); color: var(--text-muted); }
    .bsg-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
    .bsg-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-muted); pointer-events: none; text-align: center; padding: 24px; }
  `;
  document.head.appendChild(css);

  // ---------- scanning ----------
  async function scan(root, prog, all) {
    const files = [];
    async function walk(dir, rel) {
      let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (e.isDirectory()) { if (e.name[0] === "." || SKIP.has(e.name)) continue; await walk(path.join(dir, e.name), rel ? rel + "/" + e.name : e.name); }
        else if (files.length < LIMIT_FILES) { const ext = e.name.includes(".") ? e.name.split(".").pop().toLowerCase() : ""; if (all || (ext && LANG[ext])) files.push({ rel: (rel ? rel + "/" : "") + e.name, abs: path.join(dir, e.name), ext, name: e.name }); }
      }
      if (prog) prog(files.length);
    }
    await walk(root, "");
    return files;
  }

  // ---------- parsing ----------
  const re = (r) => new RegExp(r.source, r.flags);
  function parse(f, text) {
    const imps = [], syms = [], lines = text.split("\n"), ext = f.ext;
    const add = (name, kind, line) => { if (name && !KW.has(name)) syms.push({ name, kind, line }); };
    const all = (rx, fn) => { const r = re(rx); let m; while ((m = r.exec(text))) fn(m); };
    if (JSLIKE.has(ext)) {
      all(/(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g, (m) => imps.push(m[1])); all(/import\s*['"]([^'"]+)['"]/g, (m) => imps.push(m[1]));
      all(/require\(\s*['"]([^'"]+)['"]\s*\)/g, (m) => imps.push(m[1])); all(/import\(\s*['"]([^'"]+)['"]\s*\)/g, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m;
        if ((m = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(l))) add(m[1], "fn", i);
        else if ((m = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(l))) add(m[1], "class", i);
        else if ((m = /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(l))) add(m[1], "type", i);
        else if ((m = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/.exec(l))) add(m[1], "fn", i);
        else if ((m = /^\s{2,}(?:(?:static|async|public|private|protected|get|set|override)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$/.exec(l))) add(m[1], "method", i); });
    } else if (ext === "py") {
      all(/^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm, (m) => m[1].split(",").forEach((x) => imps.push(x.trim().split(/\s+/)[0])));
      all(/^\s*from\s+(\.*[\w.]*)\s+import/gm, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^\s*(?:async\s+)?def\s+(\w+)/.exec(l))) add(m[1], /^\s/.test(l) ? "method" : "fn", i); else if ((m = /^\s*class\s+(\w+)/.exec(l))) add(m[1], "class", i); });
    } else if (ext === "rs") {
      all(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm, (m) => imps.push("mod:" + m[1])); all(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)/gm, (m) => imps.push("use:" + m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+(\w+)/.exec(l))) add(m[1], /^\s{2,}/.test(l) ? "method" : "fn", i); else if ((m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+(\w+)/.exec(l))) add(m[1], "class", i); });
    } else if (ext === "go") {
      all(/^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm, (m) => imps.push(m[1])); all(/import\s*\(([\s\S]*?)\)/g, (m) => { const r = /"([^"]+)"/g; let x; while ((x = r.exec(m[1]))) imps.push(x[1]); });
      lines.forEach((l, i) => { let m; if ((m = /^func\s+(?:\([^)]*\)\s*)?(\w+)/.exec(l))) add(m[1], /^func\s+\(/.test(l) ? "method" : "fn", i); else if ((m = /^type\s+(\w+)\s+(?:struct|interface)/.exec(l))) add(m[1], "class", i); });
    } else if (JVM.has(ext)) {
      all(/^\s*(?:import|using)\s+(?:static\s+)?([\w.]+)/gm, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^\s*(?:(?:public|private|protected|internal|abstract|final|static|data|sealed|open|partial)\s+)*(?:class|interface|enum|object|record|struct)\s+(\w+)/.exec(l))) add(m[1], "class", i);
        else if ((m = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|synchronized|override|suspend|async)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*\(/.exec(l))) add(m[1], "method", i);
        else if ((m = /^\s+(?:(?:public|private|protected|internal|static|final|abstract|synchronized|override|async)\s+)+(?:[\w<>\[\],.?]+\s+)?(\w+)\s*\(/.exec(l))) add(m[1], "method", i); });
    } else if (CLIKE.has(ext)) {
      all(/^\s*#\s*include\s*"([^"]+)"/gm, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^(?:class|struct)\s+(\w+)/.exec(l))) add(m[1], "class", i);
        else if (/^[A-Za-z_]/.test(l) && !/^(?:if|for|while|switch|return|else|typedef|using|namespace|#)/.test(l) && (m = /^[\w\s\*&:<>,~]*?\b(\w+)\s*\([^;{]*\)?\s*(?:const\s*)?\{?\s*$/.exec(l)) && /[)\{]\s*$/.test(l)) add(m[1], "fn", i); });
    } else if (ext === "dart") {
      all(/^\s*(?:import|export|part)\s+['"]([^'"]+)['"]/gm, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^\s*(?:abstract\s+|base\s+|final\s+|sealed\s+|mixin\s+)*(?:class|mixin|enum|extension)\s+(\w+)/.exec(l))) add(m[1], "class", i); else if ((m = /^(?:[\w<>?,\s]+?\s)?(\w+)\s*\([^;]*\)\s*(?:async\*?\s*)?(?:\{|=>)/.exec(l)) && !/^\s/.test(l) && !/^(?:if|for|while|switch|return|else)\b/.test(l)) add(m[1], "fn", i); else if ((m = /^ {2}(?:static\s+|Future<[^>]*>\s+|[\w<>?]+\s+)(\w+)\s*\([^;]*\)\s*(?:async\*?\s*)?(?:\{|=>)/.exec(l))) add(m[1], "method", i); });
    } else {
      all(/^\s*(?:require_relative|require|include|include_once|require_once|source)\s*\(?\s*['"]([^'"]+)['"]/gm, (m) => imps.push(m[1])); all(/@import\s+(?:url\()?['"]([^'"]+)['"]/g, (m) => imps.push(m[1])); all(/<(?:script[^>]+src|link[^>]+href)=["']([^"']+)["']/g, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^\s*(?:def|function|fn|func|fun|sub|local\s+function)\s+(\w+)/.exec(l))) add(m[1], "fn", i); else if ((m = /^\s*class\s+(\w+)/.exec(l))) add(m[1], "class", i); });
    }
    return { imps, syms, lines };
  }

  // ---------- import resolution ----------
  function makeResolver(files) {
    const byRel = new Map(files.map((f) => [f.rel, f])), byBase = new Map(), byDir = new Map();
    for (const f of files) { (byBase.get(f.name) || byBase.set(f.name, []).get(f.name)).push(f); const d = path.posix.dirname(f.rel); (byDir.get(d) || byDir.set(d, []).get(d)).push(f); }
    const pick = (cands) => { for (const c of cands) { const f = byRel.get(c); if (f) return f; } return null; };
    const exts = Object.keys(LANG);
    const tryJs = (base) => pick([base, ...exts.map((e) => base + "." + e), ...exts.map((e) => base + "/index." + e)]);
    return (f, spec) => {
      const dir = path.posix.dirname(f.rel), norm = (p) => path.posix.normalize(p).replace(/^\.\//, "");
      if (JSLIKE.has(f.ext) || ["css", "html", "rb", "php", "sh", "lua", "dart"].includes(f.ext)) {
        if (spec[0] === ".") { const b = norm(dir + "/" + spec); return (f.ext === "dart" ? byRel.get(b) : null) || tryJs(b) || (f.ext === "rb" || f.ext === "php" ? pick([b + ".rb", b + ".php"]) : null); }
        if (f.ext === "dart" && spec.startsWith("package:")) { const rest = spec.slice(8), slash = rest.indexOf("/"), pkg = rest.slice(0, slash), tail = "/lib/" + rest.slice(slash + 1); const list = byBase.get(path.posix.basename(rest)) || []; const hit = list.find((x) => x.rel.endsWith(tail) && x.rel.includes("/" + pkg + "/") ) || list.find((x) => x.rel.endsWith(tail)); return hit || null; }
        if (/^[@~]\//.test(spec)) { const s = spec.slice(2); return tryJs("src/" + s) || tryJs(s); }
        return f.ext === "rb" || f.ext === "php" ? tryJs(norm(dir + "/" + spec)) : null;
      }
      if (f.ext === "py") {
        let dots = 0; while (spec[dots] === ".") dots++; const rest = spec.slice(dots).replace(/\./g, "/");
        const bases = dots ? [path.posix.join(dir, ...Array(Math.max(0, dots - 1)).fill(".."), rest)] : [rest, norm(dir + "/" + rest), "src/" + rest];
        for (const b of bases) { const r = pick([b + ".py", b + "/__init__.py"]); if (r) return r; } return null;
      }
      if (f.ext === "rs") {
        if (spec.startsWith("mod:")) { const n = spec.slice(4), stem = f.name.replace(/\.rs$/, ""); const base = ["mod", "lib", "main"].includes(stem) ? dir : dir + "/" + stem; return pick([base + "/" + n + ".rs", base + "/" + n + "/mod.rs", dir + "/" + n + ".rs", dir + "/" + n + "/mod.rs"]); }
        const parts = spec.slice(4).split("::"); if (parts[0] === "crate") { const si = f.rel.lastIndexOf("src/"); const src = si >= 0 ? f.rel.slice(0, si + 3) : "src"; for (let n = parts.length; n >= 2; n--) { const r = pick([src + "/" + parts.slice(1, n).join("/") + ".rs", src + "/" + parts.slice(1, n).join("/") + "/mod.rs"]); if (r && r !== f) return r; } }
        else if (parts[0] === "super") { const r = pick([path.posix.dirname(dir) + "/" + (parts[1] || "") + ".rs", path.posix.dirname(dir) + "/" + (parts[1] || "") + "/mod.rs"]); if (r && r !== f) return r; }
        return null;
      }
      if (f.ext === "go") { const segs = spec.split("/"); for (const [d, list] of byDir) { if (d === "." ) continue; if (d.endsWith(segs.slice(-2).join("/")) || (segs.length === 1 && path.posix.basename(d) === segs[0])) return list.find((x) => x.name === path.posix.basename(d) + ".go") || list.find((x) => !x.name.endsWith("_test.go")) || list[0]; } return null; }
      if (JVM.has(f.ext)) { const segs = spec.split("."); const last = segs.pop(); const cands = []; for (const e of ["java", "kt", "cs"]) (byBase.get(last + "." + e) || []).forEach((x) => cands.push(x)); const want = segs.join("/"); return cands.find((x) => x.rel.includes(want)) || cands[0] || null; }
      if (CLIKE.has(f.ext)) { const b = norm(dir + "/" + spec); const r = byRel.get(b) || byRel.get(spec); if (r) return r; const list = byBase.get(path.posix.basename(spec)); return list ? list[0] : null; }
      return null;
    };
  }

  // ---------- graph ----------
  const hue = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 360; };
  async function buildGraph(root, mode, prog) {
    const files = await scan(root, prog, mode === "files");
    const resolve = makeResolver(files), parsed = new Map();
    let n = 0;
    for (const f of files) {
      try { const st = await fs.promises.stat(f.abs); if (mode === "files") { f.loc = Math.max(1, Math.round(st.size / 40)); f.size = st.size; parsed.set(f, { imps: [], syms: [], lines: [] }); continue; } if (st.size > MAX_BYTES) { f.loc = Math.round(st.size / 40); parsed.set(f, { imps: [], syms: [], lines: [] }); continue; }
        const text = await fs.promises.readFile(f.abs, "utf8"); const p = parse(f, text); f.loc = p.lines.length; parsed.set(f, p); } catch (e) { f.loc = 0; parsed.set(f, { imps: [], syms: [], lines: [] }); }
      if (++n % 40 === 0) { if (prog) prog(files.length, n); await new Promise((r) => setTimeout(r, 0)); }
    }
    const nodes = [], links = [], idx = new Map(), seen = new Set();
    const addNode = (o) => { o.deg = 0; idx.set(o.id, o); nodes.push(o); return o; };
    const addLink = (a, b, kind) => { const k = a.id + ">" + b.id + kind; if (seen.has(k) || a === b) return; seen.add(k); links.push({ a, b, kind }); a.deg++; b.deg++; if (kind === "contains") b.up = a; };
    // directories + files
    const dirNode = (d) => { if (idx.has("d:" + d)) return idx.get("d:" + d); const node = addNode({ id: "d:" + d, kind: "dir", label: d === "" ? path.basename(root) : path.posix.basename(d), path: d, dir: d, loc: 0 }); if (d !== "") addLink(dirNode(path.posix.dirname(d) === "." ? "" : path.posix.dirname(d)), node, "contains"); return node; };
    dirNode("");
    for (const f of files) { const d = path.posix.dirname(f.rel) === "." ? "" : path.posix.dirname(f.rel); const node = addNode({ id: "f:" + f.rel, kind: "file", label: f.name, path: f.rel, abs: f.abs, dir: d, loc: f.loc || 1, ext: f.ext, size: f.size, lang: langOf(f.ext)[0], color: langOf(f.ext)[1], extColor: langOf(f.ext)[1] }); f.node = node; addLink(dirNode(d), node, "contains"); }
    for (const f of files) for (const spec of parsed.get(f).imps) { const t = resolve(f, spec); if (t && t.node) addLink(f.node, t.node, "import"); }
    let symCount = 0; const defs = new Map();
    if (mode === "code") {
      for (const f of files) { const p = parsed.get(f); f.symNodes = []; for (const s of p.syms) { if (symCount >= MAX_SYMS) break; symCount++; const node = addNode({ id: "s:" + f.rel + ":" + s.line + ":" + s.name, kind: "sym", sym: s.kind, label: s.name, path: f.rel, abs: f.abs, line: s.line + 1, dir: f.node.dir, parent: f.node, loc: 0, lang: langOf(f.ext)[0], color: f.node.color }); f.symNodes.push(node); addLink(f.node, node, "contains"); (defs.get(s.name) || defs.set(s.name, []).get(s.name)).push(node); } }
      for (const f of files) {
        const p = parsed.get(f), sn = f.symNodes; if (!sn.length && !p.lines.length) continue; let cur = -1; const rx = /\b([A-Za-z_$][\w$]*)\s*\(/g;
        for (let i = 0; i < p.lines.length; i++) {
          while (cur + 1 < sn.length && sn[cur + 1].line - 1 <= i) cur++;
          const src = cur >= 0 ? sn[cur] : f.node; if (cur >= 0 && sn[cur].line - 1 === i) { /* declaration line: skip own name */ }
          rx.lastIndex = 0; let m; const line = p.lines[i]; if (line.length > 400) continue;
          while ((m = rx.exec(line))) { const t = defs.get(m[1]); if (!t || t.length > 2 || KW.has(m[1])) continue; for (const tn of t) if (tn !== src && !(cur >= 0 && sn[cur].line - 1 === i && tn === sn[cur])) addLink(src, tn, "call"); }
        }
      }
      // import edges between files stay (fainter); symbols without any call/contain beyond the file are fine
    }
    // colour groups: the first two path segments, the biggest groups get distinct hues
    const gc = new Map(); for (const f of files) { const k = f.rel.split("/").slice(0, 2).join("/"); f.group = k.includes("/") ? k : "(корень)"; gc.set(f.group, (gc.get(f.group) || 0) + 1); }
    const ranked = [...gc.entries()].sort((a, b) => b[1] - a[1]), gcol = new Map(); ranked.forEach(([k], i) => gcol.set(k, i < 14 ? "hsl(" + Math.round((i * 137.5) % 360) + ",62%,60%)" : "#8a8a8a"));
    const groups = ranked.slice(0, 14).map(([k, c]) => ({ name: k, n: c, color: gcol.get(k) }));
    for (const f of files) { f.node.color = gcol.get(f.group); f.node.group = f.group; if (f.symNodes) for (const sy of f.symNodes) { sy.color = f.node.color; sy.group = f.group; } }
    // dir sizes
    for (const nd of nodes) if (nd.kind === "file") { let d = idx.get("d:" + nd.dir); while (d) { d.loc += nd.loc; d.nfiles = (d.nfiles || 0) + 1; const up = d.path === "" ? null : (path.posix.dirname(d.path) === "." ? "" : path.posix.dirname(d.path)); d = up === null ? null : idx.get("d:" + up); } }
    for (const l of links) if (l.kind !== "contains") for (const x of [l.a, l.b]) (x.kind === "sym" ? x.parent : x).hasLinks = true;
    return { nodes, links, idx, files: files.length, syms: symCount, groups };
  }

  // ---------- view ----------
  function makeView(api) {
    return class CodeGraphView extends api.ItemView {
      constructor(leaf) { super(leaf); this.opt = Object.assign({ maxFiles: 15, onlyDirs: false }, (() => { try { return JSON.parse(localStorage.getItem("bsg.opt") || "{}"); } catch (e) { return {}; } })()); this.mode = "files"; this.g = null; this.scale = 1; this.ox = 0; this.oy = 0; this.alpha = 1; this.hover = null; this.match = null; this.showDirs = true; this.showImports = true; this.expanded = new Set(); this.collapsed = new Set(); this.hidden = new Set(); this.focusSet = null; this.tags = new Map(); this.vnodes = []; this.vlinks = []; this.static = false; try { this.layout = localStorage.getItem("bsg.layout") || "tree"; } catch (e) { this.layout = "ladder"; } }
      getViewType() { return VIEW; }
      getDisplayText() { return this.mode === "code" ? "Граф кода" : "Граф файлов"; }
      getIcon() { return "lucide-git-fork"; }
      getState() { return { mode: this.mode }; }
      async setState(state, result) { this.mode = "files"; try { this.leaf.updateHeader && this.leaf.updateHeader(); } catch (e) { /* ok */ } return super.setState ? super.setState(state, result) : undefined; }
      root() { const W = window.__bsWorkspace; if (W && W.active && W.active() && W.root()) return W.root(); return app.vault.adapter.basePath; }
      async onOpen() {
        const c = this.contentEl; c.textContent = ""; c.style.padding = "0"; c.style.position = "relative"; c.style.overflow = "hidden";
        const wrap = document.createElement("div"); wrap.className = "bsg"; c.appendChild(wrap);
        const bar = document.createElement("div"); bar.className = "bsg-bar bscg-top"; wrap.appendChild(bar);
        const seg = document.createElement("div"); seg.className = "bsg-seg"; bar.appendChild(seg); this.segBtns = {};
        const SEGI = { "2d": ["lucide-square", "2D"], "3d": ["lucide-box", "3D"], files: ["lucide-folder-tree", "Файлы"] }; const segFill = (b, k) => { b.textContent = ""; const i = document.createElement("span"); i.className = "bsg-sic"; try { window.__bsApi.setIcon(i, SEGI[k][0]); } catch (e) { /* ok */ } const t = document.createElement("span"); t.textContent = SEGI[k][1]; b.append(i, t); };
        for (const [k, t] of [["2d", "2D"], ["3d", "3D"], ["files", "Файлы"]]) { const b = document.createElement("button"); b.className = "bsg-si"; segFill(b, k); b.title = k === "files" ? "Граф файлов и папок" : "Граф заметок"; b.addEventListener("click", () => { if (k !== "files") this.leaf.setViewState({ type: "graph", state: { view: k }, active: true }); }); seg.appendChild(b); this.segBtns[k] = b; }
        const sbox = document.createElement("div"); sbox.className = "bsg-sbox"; const q = document.createElement("input"); q.className = "bsg-search"; q.placeholder = "Найти по имени и тексту…"; this.qIn = q; this.qCount = document.createElement("span"); this.qCount.className = "bsg-count"; sbox.append(q, this.qCount); bar.appendChild(sbox);
        q.addEventListener("input", () => this.runSearch()); q.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); this.stepMatch(e.shiftKey ? -1 : 1); } else if (e.key === "Escape") { q.value = ""; this.runSearch(); q.blur(); } });
        // settings panel (gear), the same place and look as in the note graph
        // settings panel (gear): the note graph's panel, the same Setting rows, headings and toggles
        const panel = document.createElement("div"); panel.className = "bsg-panel"; this.panelEl = panel;
        const S = window.__bsApi.Setting, saveOpt = () => { try { localStorage.setItem("bsg.opt", JSON.stringify(this.opt)); } catch (e) { /* ok */ } }, re = () => { this.rebuildView(); this.userView = false; this.refit = false; this.applyLayout(false); };
        const L = (st, ic) => { const i = document.createElement("span"); i.className = "bsg-si"; try { window.__bsApi.setIcon(i, ic); } catch (e) { /* ok */ } st.nameEl.prepend(i); return st; }, N = (name, ic) => L(new S(panel).setName(name), ic);
        L(new S(panel).setName("Вид").setHeading(), "lucide-palette");
        N("Раскладка", "lucide-network").addDropdown((d) => { for (const [k, t] of [["tree", "Дерево"], ["ladder", "Лесенка"], ["radial", "Радиальный"], ["3d", "3D"], ["force", "Свободный"]]) d.addOption(k, t); d.setValue(this.layout).onChange((v) => { this.layout = v; try { localStorage.setItem("bsg.layout", v); } catch (e) { /* ok */ } this.userView = false; this.refit = false; this.applyLayout(false); }); this.layoutSel = d.selectEl; });
        N("Только папки", "lucide-folder").addToggle((t) => t.setValue(!!this.opt.onlyDirs).onChange((v) => { this.opt.onlyDirs = v; saveOpt(); re(); }));
        N("Файлов в папке", "lucide-files").addSlider((sl) => sl.setLimits(3, 60, 1).setValue(this.opt.maxFiles).setDynamicTooltip().onChange((v) => { this.opt.maxFiles = v; saveOpt(); re(); }));
        L(new S(panel).setName("Папки").setHeading(), "lucide-folder-tree");
        N("Свернуть / развернуть всё", "lucide-chevrons-up-down").addExtraButton((b) => b.setIcon("lucide-chevrons-up-down").setTooltip("Свернуть или развернуть все папки").onClick(() => this.toggleAllDirs()));
        N("Сбросить позиции", "lucide-rotate-ccw").addExtraButton((b) => b.setIcon("lucide-rotate-ccw").setTooltip("Забыть перетащенные узлы и разложить заново").onClick(() => this.relayout()));
        N("Пересканировать папку", "lucide-refresh-cw").addExtraButton((b) => b.setIcon("lucide-refresh-cw").setTooltip("Прочитать файлы с диска заново").onClick(() => this.load(true)));
        this.btnImps = document.createElement("button"); this.btnImps.style.display = "none";
        this.info = document.createElement("div"); this.info.className = "bscg-info";
        // controls column on the right: settings | zoom | help, stock canvas-control classes
        const colm = document.createElement("div"); colm.className = "canvas-controls bscg-controls";
        const grp = () => { const g = document.createElement("div"); g.className = "canvas-control-group"; colm.appendChild(g); return g; };
        const mk = (g, icon, title, fn) => { const b = document.createElement("div"); b.className = "canvas-control-item"; b.setAttribute("aria-label", title); try { window.__bsApi.setIcon(b, icon); } catch (e) { /* ok */ } b.addEventListener("click", fn); g.appendChild(b); return b; };
        void 0;
        const zoom = (k) => { if (this.layout === "3d") { this.zoom3 = Math.max(.01, Math.min(8, (this.zoom3 || 1) * k)); } else { const cx = this.w / 2, cy = this.h / 2; this.ox = cx - (cx - this.ox) * k; this.oy = cy - (cy - this.oy) * k; this.scale *= k; } this.userView = true; this.draw(); };
        mk(grp(), "lucide-settings", "Настройки графа", () => panel.classList.toggle("is-open"));
        const zg = grp(); mk(zg, "lucide-plus", "Приблизить", () => zoom(1.25)); mk(zg, "lucide-maximize", "Вписать весь граф в окно", () => { if (this.layout === "3d") { this.compute3D(); this.draw(); return; } this.userView = true; this.fitAll = true; this.fit(); this.fitAll = false; }); mk(zg, "lucide-minus", "Отдалить", () => zoom(.8));
        mk(grp(), "lucide-folder-tree", "Свернуть / развернуть все папки", () => this.toggleAllDirs());
        mk(grp(), "lucide-circle-help", "Справка", () => { panel.classList.remove("is-open"); this.openHelp(); });
        const body = document.createElement("div"); body.className = "bsg-body"; wrap.appendChild(body); this.body = body; body.append(panel, colm, this.info);
        const cv = document.createElement("canvas"); body.appendChild(cv); this.cv = cv; this.ctx = cv.getContext("2d");
        this.tip = document.createElement("div"); this.tip.className = "bsg-tip"; body.appendChild(this.tip);
        this.legend = document.createElement("div"); this.legend.className = "bsg-legend"; body.appendChild(this.legend);
        this.msg = document.createElement("div"); this.msg.className = "bsg-msg"; body.appendChild(this.msg);
        this.bind(); this.syncSeg();
        this.ro = new ResizeObserver(() => { this.resize(); this.draw(); }); this.ro.observe(body);
        this.built = true; await this.load();
      }
      syncSeg() { for (const k in this.segBtns) this.segBtns[k].classList.toggle("on", k === this.mode); if (this.layoutSel) this.layoutSel.style.display = this.mode === "files" ? "" : "none"; if (this.btnImps) this.btnImps.style.display = this.mode === "code" ? "" : "none"; if (this.btnCol) this.btnCol.style.display = this.mode === "files" ? "" : "none"; if (this.legend) this.legend.style.display = this.mode === "code" ? "" : "none"; }
      resize() { const r = this.body.getBoundingClientRect(), d = window.devicePixelRatio || 1; this.w = r.width; this.h = r.height; this.cv.width = Math.max(1, Math.round(r.width * d)); this.cv.height = Math.max(1, Math.round(r.height * d)); this.dpr = d; }
      async load(force) {
        const myRun = this.run = (this.run || 0) + 1; this.resize(); this.g = null; this.msg.textContent = "Читаю файлы…"; this.draw();
        const root = this.root();
        if (!root) { this.msg.textContent = "Откройте папку или хранилище"; return; }
        // the scan is kept per folder: reopening the graph is instant, ↻ (or a file change in the vault) reads it again
        const GC = window.__bsgCache || (window.__bsgCache = new Map()), ck = root + "|" + this.mode;
        let g; try { g = !force && GC.get(ck) ? GC.get(ck) : await buildGraph(root, this.mode, (n, k) => { if (myRun === this.run) this.msg.textContent = "Читаю файлы… " + (k || n) + (k ? " / " + n : ""); }); } catch (e) { console.error("[basalt-graphs]", e); this.msg.textContent = "Ошибка: " + e.message; return; }
        if (myRun !== this.run) return;
        this.g = g; this.rootPath = root; GC.set(ck, g); this.hidden.clear(); this.focusSet = null; this.loadTags();
        if (!window.__bsgCacheHook) { window.__bsgCacheHook = 1; const drop = () => GC.clear(); for (const ev of ["create", "delete", "rename"]) app.vault.on(ev, drop); }
        if (!g.nodes.length) { this.msg.textContent = "В этой папке нет файлов с кодом"; return; }
        this.msg.textContent = "";
        this.syncSeg();
        const saved = (this.mode === "code" || this.layout === "force") ? await this.loadLayout() : null; let placed = 0;
        const cx = 0, cy = 0, dirs = [...new Set(g.nodes.map((n) => n.dir))]; const ang = new Map(dirs.map((d, i) => [d, (i / dirs.length) * Math.PI * 2]));
        g.nodes.forEach((n, i) => { const s = saved && saved[n.id]; if (s) { n.x = s[0]; n.y = s[1]; n.pinned = !!s[2]; placed++; } else { const a = ang.get(n.dir) + (Math.random() - .5) * .6, r = 60 + Math.sqrt(g.nodes.length) * 14 * (.4 + Math.random() * .6); n.x = cx + Math.cos(a) * r; n.y = cy + Math.sin(a) * r; n.pinned = false; } if (n.kind === "sym" && !(saved && saved[n.id])) { n.x = n.parent.x + (Math.random() - .5) * 30; n.y = n.parent.y + (Math.random() - .5) * 30; } n.vx = n.vy = 0; n.r = n.kind === "dir" ? 6 : n.kind === "file" ? Math.min(15, 3 + Math.sqrt(n.loc) / 4) : Math.min(9, 2.5 + n.deg * .35); });
        this.expanded = new Set(); this.collapsed = new Set(); this.defaultCollapse(); this.rebuildView(); this.alpha = placed > g.nodes.length * .8 ? .05 : 1; this.applyLayout(true); this.fitted = false; this.refit = false; this.userView = false;
        this.fillLegend(); this.updateInfo(); this.runSearch(true); this.loop();
      }
      fillLegend() { this.legend.textContent = ""; for (const gr of this.g.groups) { const sp = document.createElement("span"); const ic = document.createElement("i"); ic.style.background = gr.color; sp.append(ic, gr.name); this.legend.appendChild(sp); } }
      updateInfo() { const g = this.g; this.info.textContent = this.mode === "files" ? g.files + " файлов · " + g.nodes.filter((n) => n.kind === "dir").length + " каталогов" : g.files + " файлов · " + g.links.filter((l) => l.kind === "import").length + " импортов" + (this.mode === "code" ? " · " + g.syms + " символов · " + g.links.filter((l) => l.kind === "call").length + " вызовов · двойной клик по файлу раскрывает символы" : ""); }
      // -- visible graph: in "Код" mode symbols are hidden inside their file until it is expanded (double click); calls are summed per file pair --
      rebuildView() {
        const g = this.g, exp = this.expanded, files = this.mode === "files", col = this.collapsed, hid = (n) => { for (let u = n.up; u; u = u.up) if (col.has(u.id)) return true; return false; },
          cap = this.capFiles(), vis0 = (n) => (n.kind === "dir" ? files && !hid(n) : n.kind === "sym" ? exp.has(n.parent.id) : files ? !hid(n) && !cap.has(n) : !!n.hasLinks || exp.has(n.id)), vis = (n) => vis0(n) && !this.isHidden(n) && (!this.focusSet || this.focusSet.has(n)), rep = (n) => (vis(n) ? n : n.parent), map = new Map(), links = [];
        this.vnodes = g.nodes.filter(vis);
        for (const l of g.links) {
          if (l.kind === "contains") { if (vis(l.a) && vis(l.b)) links.push(l); continue; }
          const a = rep(l.a), b = rep(l.b); if (!a || !b || a === b) continue; const k = a.id + ">" + b.id + l.kind; let e = map.get(k);
          if (!e) { e = { a, b, kind: l.kind, w: 0 }; map.set(k, e); links.push(e); } e.w++;
        }
        this.vlinks = links; this.byDeg = null; for (const n of this.vnodes) n.vd = 0; for (const l of links) { const w = l.kind === "call" ? Math.min(l.w, 6) : 1; l.a.vd += w; l.b.vd += w; }
        for (const n of this.vnodes) n.r = this.mode === "files" ? 15 : n.kind === "dir" ? 5 : n.kind === "file" ? Math.min(14, 2.5 + Math.sqrt(n.loc) / 5 + Math.sqrt(n.vd) * .5) : Math.min(8, 2.2 + Math.sqrt(n.vd));
        this.byDeg = this.vnodes.slice().sort((a, b) => b.vd * (b.kind === "dir" ? 1.5 : 1) - a.vd * (a.kind === "dir" ? 1.5 : 1));
      }
      defaultCollapse() { this.collapsed.clear(); if (this.mode === "files" && this.g.files > 300) for (const n of this.g.nodes) if (n.kind === "dir" && n.path && n.path.split("/").length >= 2 && n.nfiles) this.collapsed.add(n.id);  }
      // ---- right-click menu helpers: hide, focus, colour marks (kept per folder in localStorage) ----
      isHidden(n) { if (!this.hidden.size) return false; for (let u = n; u; u = u.up || u.parent) if (this.hidden.has(u.id)) return true; return false; }
      tagKey() { return "bsg.tags|" + this.rootPath; }
      loadTags() { this.tags = new Map(); try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(this.tagKey()) || "{}"))) this.tags.set(k, v); } catch (e) { /* none */ } }
      saveTags() { try { localStorage.setItem(this.tagKey(), JSON.stringify(Object.fromEntries(this.tags))); } catch (e) { /* ok */ } }
      setTag(n, c) { const all = n.kind === "dir" ? this.g.nodes.filter((m) => { for (let u = m; u; u = u.up) if (u === n) return true; return false; }) : [n]; for (const m of all) { if (c) this.tags.set(m.id, c); else this.tags.delete(m.id); } this.saveTags(); this.draw(); }
      hideNode(n) { this.hidden.add(n.id); this.rebuildView(); this.userView = true; this.applyLayout(false); }
      showAllNodes() { this.hidden.clear(); this.focusSet = null; this.rebuildView(); this.userView = false; this.refit = false; this.applyLayout(false); }
      focusNode(n) {
        const set = new Set(); for (let u = n; u; u = u.up) set.add(u);
        if (n.kind === "dir") { for (const m of this.g.nodes) for (let u = m; u; u = u.up) if (u === n) { set.add(m); break; } } else if (n.up) for (const m of this.g.nodes) if (m.up === n.up && m.kind !== "dir") set.add(m);
        for (const l of this.g.links) if (l.kind !== "contains" && (l.a === n || l.b === n)) { set.add(l.a); set.add(l.b); for (let u = l.a.up; u; u = u.up) set.add(u); for (let u = l.b.up; u; u = u.up) set.add(u); }
        this.focusSet = set; this.rebuildView(); this.userView = false; this.refit = false; this.applyLayout(false);
      }
      setDirTree(n, open) { for (const m of this.g.nodes) { if (m.kind !== "dir" || !m.nfiles) continue; let inside = false; for (let u = m; u; u = u.up) if (u === n) { inside = true; break; } if (!inside) continue; if (open) this.collapsed.delete(m.id); else this.collapsed.add(m.id); } for (const m of this.g.nodes) if (m.up && !m.pinned) { m.x = m.up.x; m.y = m.up.y; } this.rebuildView(); this.userView = true; this.applyLayout(false); }
      openHelp() {
        const M = window.__bsApi.Modal, m = new M(app); m.modalEl.classList.add("mod-canvas-help"); m.setTitle("Справка: граф файлов");
        const box = m.contentEl.createDiv("canvas-help");
        const row = (label, combos) => { const rw = box.createDiv({ cls: "canvas-instruction" }); rw.createDiv({ cls: "canvas-instruction-label", text: label }); const d = rw.createDiv({ cls: "canvas-instruction-desc" }); for (const k of combos) d.createSpan({ cls: "setting-hotkey", text: k.join(" + ") }); };
        row("Приблизить / отдалить", [["Колесо"]]); row("Сдвинуть граф", [["Перетащить пустое место"]]); row("Переместить узел и закрепить его", [["Перетащить"]]);
        row("Открыть файл", [["Клик"]]); row("Свернуть / развернуть папку", [["Клик по папке"]]); row("Открепить узел", [["Двойной клик"]]);
        row("Меню узла: открыть, скрыть, цвет, путь", [["Правый клик"]]); row("Меню графа: вписать, показать всё, настройки", [["Правый клик по пустому месту"]]);
        row("Искать по имени и тексту", [["Поле поиска"]]); row("Следующее / предыдущее совпадение", [["Enter"], ["Shift", "Enter"]]); row("Очистить поиск", [["Esc"]]);
        m.open();
      }
      toggleDir(n) {
        if (this.mode !== "files" || n.kind !== "dir" || !n.nfiles) return;
        if (this.collapsed.has(n.id)) { this.collapsed.delete(n.id); for (const m of this.g.nodes) for (let u = m.up; u; u = u.up) if (u === n) { m.x = n.x; m.y = n.y; break; } } else this.collapsed.add(n.id);
        this.rebuildView(); this.userView = true; this.applyLayout(false); if (this.btnCol) 0;
      }
      toggleAllDirs() { if (this.collapsed.size) { this.collapsed.clear(); } else this.defaultCollapse(); for (const m of this.g.nodes) if (m.up && !m.pinned) { m.x = m.up.x; m.y = m.up.y; } this.rebuildView(); this.userView = false; this.refit = false; this.applyLayout(false); if (this.btnCol) 0; }
      // files beyond the per-folder limit (or all of them in "only folders") are left out; the folder shows "+N"
      capFiles() { const out = new Set(), per = new Map(), lim = this.opt.onlyDirs ? 0 : this.opt.maxFiles; this.more = new Map(); if (!this.g || this.mode !== "files") return out;
        for (const n of this.g.nodes) if (n.kind !== "dir" && n.up && !(this.match && this.match.has(n))) { const k = per.get(n.up) || 0; per.set(n.up, k + 1); if (k >= lim) { out.add(n); this.more.set(n.up, (this.more.get(n.up) || 0) + 1); } } return out; }
      labelOf(n) { const extra = this.more && n.kind === "dir" && !this.collapsed.has(n.id) && this.more.get(n); if (extra) return n.label + "  +" + extra + ((window.__bsT || String)(this.opt.onlyDirs ? " файл." : " ещё"));  return n.kind === "dir" && this.collapsed.has(n.id) && n.nfiles ? n.label + " (" + n.nfiles + ")" : n.label; }
      drawIcon(ctx, n, S, lw, hov, bg, txt) {
        const size = 22, px = size * S, mut = (this.cssv("--text-faint") || this.cssv("--vs-ln")) || "#999", dir = n.kind === "dir";
        if (px < 5) { ctx.fillStyle = dir ? (this.cssv("--interactive-accent") || mut) : n.extColor; ctx.fillRect(n.x - 3 * lw, n.y - 3 * lw, 6 * lw, 6 * lw); return; }
        const k = size / 24, col = dir && this.collapsed.has(n.id);
        ctx.save(); ctx.translate(n.x - 12 * k, n.y - 12 * k); ctx.scale(k, k);
        // same line icons as the explorer: 24-grid outline, round joins, type colour softened towards the muted text colour
        ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.fillStyle = bg;
        const path = dir ? P_FOLDER : P_FILE, fc = this.cssv("--interactive-accent") || mut; ctx.fill(path); ctx.strokeStyle = dir ? fc : mut; ctx.stroke(path);
        if (!dir) { const a0 = ctx.globalAlpha; ctx.globalAlpha = a0 * .62; ctx.strokeStyle = n.extColor; ctx.stroke(path); ctx.stroke(P_FOLD); ctx.globalAlpha = a0; ctx.strokeStyle = mut; ctx.globalAlpha = a0 * .4; ctx.stroke(P_FOLD); ctx.globalAlpha = a0; }
        else if (px > 14 && col && n.nfiles) { ctx.fillStyle = fc; ctx.font = "600 7px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(n.nfiles > 999 ? "999+" : n.nfiles), 12, 13); }
        ctx.restore();
        const tg = this.tags.get(n.id); if (tg) { ctx.beginPath(); ctx.arc(n.x, n.y, 17, 0, 7); ctx.lineWidth = 2.4 * lw; ctx.strokeStyle = tg; ctx.stroke(); }
        if (n === hov) { ctx.beginPath(); ctx.arc(n.x, n.y, 17, 0, 7); ctx.lineWidth = 1.6 * lw; ctx.strokeStyle = txt; ctx.stroke(); }
      }
      toggleExpand(n) {
        if (this.mode !== "code" || n.kind !== "file") return; const id = n.id;
        if (this.expanded.has(id)) this.expanded.delete(id); else { this.expanded.add(id); for (const s of this.g.nodes) if (s.parent === n) { s.x = n.x + (Math.random() - .5) * 40; s.y = n.y + (Math.random() - .5) * 40; s.vx = s.vy = 0; } }
        this.rebuildView(); this.alpha = Math.max(this.alpha, .5); this.loop();
      }
      applyLayout(initial) {
        if (this.mode === "files" && this.layout === "3d") { this.static = true; this.compute3D(); this.loop(); return; }
        if (this.mode !== "files" || this.layout === "force") { this.static = false; if (!initial) { this.alpha = 1; this.fitted = false; this.loop(); } return; }
        this.static = true; this.computeTree(); this.loop();
      }
      // ---- 3D: the folder tree on spheres around its parents; drag rotates, wheel zooms, click opens / folds ----
      compute3D() {
        const nodes = this.vnodes, kids = new Map(), root = nodes.find((n) => n.id === "d:"); if (!root) return;
        for (const l of this.vlinks) if (l.kind === "contains") { let a = kids.get(l.a); if (!a) kids.set(l.a, a = []); a.push(l.b); }
        const cmp = (a, b) => (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1) || a.label.localeCompare(b.label); for (const arr of kids.values()) arr.sort(cmp);
        if (this.yaw === undefined) { this.yaw = .6; this.pitch = .3; this.zoom3 = 1; }
        const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
        const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const place = (n, dir, depth) => {
          const k = kids.get(n); if (!k) return; const cnt = k.length, up = Math.abs(dir[1]) < .9 ? [0, 1, 0] : [1, 0, 0], u = norm(cross(dir, up)), w = cross(dir, u), cone = depth === 0 ? Math.PI : Math.min(1.9, .9 + cnt * .05);
          k.forEach((c, i) => {
            const t = (i + .5) / cnt, polar = Math.acos(1 - t * (1 - Math.cos(cone))), phi = i * 2.399963, sp = Math.sin(polar), cp = Math.cos(polar), cf = Math.cos(phi), sf = Math.sin(phi);
            const v = [dir[0] * cp + (u[0] * cf + w[0] * sf) * sp, dir[1] * cp + (u[1] * cf + w[1] * sf) * sp, dir[2] * cp + (u[2] * cf + w[2] * sf) * sp], len = c.kind === "dir" ? 210 * Math.pow(.8, depth) + 50 : 80 + Math.min(80, cnt * 1.6);
            c.x3 = n.x3 + v[0] * len; c.y3 = n.y3 + v[1] * len; c.z3 = n.z3 + v[2] * len; place(c, v, depth + 1);
          });
        };
        root.x3 = root.y3 = root.z3 = 0; place(root, [0, 0, 1], 0); for (const n of nodes) if (n.x3 === undefined) n.x3 = n.y3 = n.z3 = 0;
        let mx = 0, my = 0, mz = 0; for (const n of nodes) { mx += n.x3; my += n.y3; mz += n.z3; } mx /= nodes.length; my /= nodes.length; mz /= nodes.length;
        let R = 1; for (const n of nodes) { n.x3 -= mx; n.y3 -= my; n.z3 -= mz; R = Math.max(R, Math.hypot(n.x3, n.y3, n.z3)); }
        this.zoom3 = Math.max(.01, Math.min(3, Math.min(this.w || 800, this.h || 600) * .4 / R));
      }
      project3D() {
        const cx = this.w / 2, cy = this.h / 2, co = Math.cos(this.yaw), si = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), D = 900, zm = this.zoom3 || 1;
        for (const n of this.vnodes) { const x1 = n.x3 * co + n.z3 * si, z1 = -n.x3 * si + n.z3 * co, y1 = n.y3 * cp - z1 * sp, z2 = n.y3 * sp + z1 * cp, s = D / Math.max(80, D + z2); n.sx = cx + x1 * s * zm; n.sy = cy + y1 * s * zm; n.ss = s * zm; n.sz = z2; }
      }
      hit3d() { let best = null, bd = 1e9; for (const n of this.vnodes) { if (n.sx === undefined) continue; const d = Math.hypot(n.sx - this.lsx, n.sy - this.lsy), r = Math.max(10, 15 * n.ss * .8); if (d < r) { const sc = d + (n.sz + 600) * .01; if (sc < bd) { best = n; bd = sc; } } } return best; }
      draw3d(ctx) {
        this.project3D();
        const bg = this.cssv("--vs-bg"), txt = this.cssv("--vs-fg"), mut = this.cssv("--vs-ln"), hov = this.hover, nb = new Set(); if (hov) { nb.add(hov); for (const l of this.vlinks) { if (l.a === hov) nb.add(l.b); else if (l.b === hov) nb.add(l.a); } }
        ctx.lineWidth = 1; ctx.strokeStyle = mut;
        for (const pass of [0, 1]) { ctx.beginPath(); for (const l of this.vlinks) { if (l.kind !== "contains" || (((l.a.sz + l.b.sz) / 2 > 0) ? 0 : 1) !== pass) continue; ctx.moveTo(l.a.sx, l.a.sy); ctx.lineTo(l.b.sx, l.b.sy); } ctx.globalAlpha = (pass ? .34 : .14) * (hov ? .5 : 1); ctx.stroke(); }
        if (hov) { ctx.beginPath(); for (const l of this.vlinks) if (l.a === hov || l.b === hov) { ctx.moveTo(l.a.sx, l.a.sy); ctx.lineTo(l.b.sx, l.b.sy); } ctx.globalAlpha = .9; ctx.lineWidth = 1.6; ctx.strokeStyle = txt; ctx.stroke(); ctx.lineWidth = 1; }
        const order = this.vnodes.slice().sort((a, b) => b.sz - a.sz);
        for (const n of order) { ctx.globalAlpha = (hov && !nb.has(n) ? .3 : 1) * Math.max(.45, Math.min(1, 1.2 - (n.sz + 450) / 1500)); this.drawIcon(ctx, { x: n.sx, y: n.sy, kind: n.kind, ext: n.ext, extColor: n.extColor, id: n.id, nfiles: n.nfiles }, n.ss * .8, 1 / Math.max(.2, n.ss * .8), null, bg, txt); }
        ctx.globalAlpha = 1; if (hov) { ctx.beginPath(); ctx.arc(hov.sx, hov.sy, Math.max(12, 16 * hov.ss * .8), 0, 7); ctx.lineWidth = 1.6; ctx.strokeStyle = txt; ctx.stroke(); }
        ctx.font = "12px sans-serif"; ctx.textBaseline = "middle"; const placed = [], near = this.vnodes.slice().sort((a, b) => a.sz - b.sz); let shown = 0;
        for (const n of (hov ? [hov].concat(near) : near)) { if (shown > 70 || (n !== hov && !nb.has(n) && n.ss < .5)) continue; const lab = this.labelOf(n), w = ctx.measureText(lab).width, x = n.sx + Math.max(10, 14 * n.ss * .8), y = n.sy, box = [x, y - 7, x + w, y + 7]; if (n !== hov && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue; placed.push(box); shown++; ctx.lineWidth = 3; ctx.strokeStyle = bg; ctx.strokeText(lab, x, y); ctx.fillStyle = n.kind === "dir" ? mut : txt; ctx.fillText(lab, x, y); }
      }
      computeTree() {
        const nodes = this.vnodes, kids = new Map(), root = nodes.find((n) => n.id === "d:"); if (!root) return;
        for (const n of nodes) n.tx = undefined;
        for (const l of this.vlinks) if (l.kind === "contains") { let a = kids.get(l.a); if (!a) kids.set(l.a, a = []); a.push(l.b); }
        const cmp = (a, b) => (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1) || a.label.localeCompare(b.label);
        for (const arr of kids.values()) arr.sort(cmp);
        const L = this.layout;
        if (L === "ladder") { let row = 0; const walk = (n, d) => { n.tx = d * 36; n.ty = row++ * 34; for (const c of kids.get(n) || []) walk(c, d + 1); }; walk(root, 0); }
        else {
          const leaves = new Map(); let maxD = 1; const cnt = (n, d) => { maxD = Math.max(maxD, d); const k = kids.get(n); if (!k || !k.length) { leaves.set(n, 1); return 1; } let t = 0; for (const c of k) t += cnt(c, d + 1); leaves.set(n, t); return t; }; const total = cnt(root, 0);
          // compact tree: each folder's files (and folded folders) are a list under it, its open subfolders go to the right of that list
          if (L === "tree") {
            const isBranch = (c) => (kids.get(c) || []).length > 0, RH = 30, W = new Map(), colW = (n) => { let m = this.labelOf(n).length; for (const c of kids.get(n) || []) if (!isBranch(c)) m = Math.max(m, this.labelOf(c).length + 3); return Math.max(150, Math.min(420, m * 7.6 + 60)); };
            const width = (n) => { const k = kids.get(n) || [], br = k.filter(isBranch), lv = k.length - br.length; let w = lv || !br.length ? colW(n) : 0; for (const c of br) w += width(c); W.set(n, w); return w; };
            const place = (n, x0, y) => { n.tx = x0; n.ty = y; const k = kids.get(n) || [], br = k.filter(isBranch), lv = k.filter((c) => !isBranch(c));
              lv.forEach((c, i) => { c.tx = x0 + 26; c.ty = y + 44 + i * RH; }); let x = x0 + (lv.length ? colW(n) : 0); for (const c of br) { place(c, x, y + 110); x += W.get(c); } };
            width(root); place(root, 0, 0);
          }
          else { const step = Math.max(150, total * 34 / (2 * Math.PI) / maxD); const place = (n, d, a0, a1) => { const am = (a0 + a1) / 2, r = d * step; n.tx = Math.cos(am) * r; n.ty = Math.sin(am) * r; const k = kids.get(n); if (!k) return; let a = a0; for (const c of k) { const span = (a1 - a0) * leaves.get(c) / leaves.get(n); place(c, d + 1, a, a + span); a += span; } }; place(root, 0, 0, Math.PI * 2); }
        }
        for (const n of nodes) if (n.tx === undefined) { n.tx = n.x; n.ty = n.y; }
      }
      tween() { let mv = false; for (const n of this.vnodes) { if (n.tx === undefined) continue; const dx = n.tx - n.x, dy = n.ty - n.y; if (Math.abs(dx) + Math.abs(dy) > 1.5) { n.x += dx * .3; n.y += dy * .3; mv = true; } else { n.x = n.tx; n.y = n.ty; } } return mv; }
      // -- physics --
      loop() { if (this.raf) return; const step = () => { this.raf = 0; if (!this.g) return; if (this.static) { const mv = this.tween(); this.draw(); if (mv || this.dragging) this.raf = requestAnimationFrame(step); else if (!this.userView) this.fit(); return; } if (this.alpha > .012 || this.dragging) { this.tick(); this.draw(); this.raf = requestAnimationFrame(step); } else { this.draw(); this.saveLayout(); } if (!this.fitted && this.alpha < .5 && this.w) { this.fitted = true; this.fit(); } if (!this.userView && this.alpha < .03 && !this.refit) { this.refit = true; this.fit(); } }; this.raf = requestAnimationFrame(step); }
      tick() {
        const nodes = this.vnodes, a = this.alpha, cell = 64, grid = new Map(), key = (x, y) => x * 73856093 ^ y * 19349663;
        for (const n of nodes) { const k = key(Math.floor(n.x / cell), Math.floor(n.y / cell)); let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(n); n.fx = 0; n.fy = 0; }
        for (const n of nodes) { const cx = Math.floor(n.x / cell), cy = Math.floor(n.y / cell);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const arr = grid.get(key(cx + dx, cy + dy)); if (!arr) continue; for (let q = 0, qn = Math.min(arr.length, 28); q < qn; q++) { const m = arr[q]; if (m === n) continue; let ex = n.x - m.x, ey = n.y - m.y, d2 = ex * ex + ey * ey; if (d2 > cell * cell * 2.4) continue; if (d2 < .01) { ex = Math.random() - .5; ey = Math.random() - .5; d2 = .25; } const f = (240 + (n.r + m.r) * 14) / d2; n.fx += ex * f; n.fy += ey * f; } } }
        const BIG = 320, cg = new Map(), ck = (x, y) => x * 83492791 ^ y * 28411;
        for (const n of nodes) { const k = ck(Math.floor(n.x / BIG), Math.floor(n.y / BIG)); let c = cg.get(k); if (!c) cg.set(k, c = { x: 0, y: 0, n: 0, cx: Math.floor(n.x / BIG), cy: Math.floor(n.y / BIG) }); c.x += n.x; c.y += n.y; c.n++; }
        for (const c of cg.values()) { c.x /= c.n; c.y /= c.n; }
        if (cg.size > 1) for (const n of nodes) { const bx = Math.floor(n.x / BIG), by = Math.floor(n.y / BIG); for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) { if (!dx && !dy) continue; const c = cg.get(ck(bx + dx, by + dy)); if (!c) continue; const ex = n.x - c.x, ey = n.y - c.y, d2 = ex * ex + ey * ey + 400, inv = 140 * c.n / (d2 * Math.sqrt(d2)); n.fx += ex * inv; n.fy += ey * inv; } }
        for (const l of this.vlinks) { const A = l.a, B = l.b; let ex = B.x - A.x, ey = B.y - A.y; const d = Math.sqrt(ex * ex + ey * ey) || 1; const len = l.kind === "contains" ? (A.kind === "dir" ? 50 : 26) : l.kind === "import" ? 110 : 80 / (1 + Math.log2(l.w || 1) * .3), k = l.kind === "contains" ? .07 : .018; const f = (d - len) * k; ex /= d; ey /= d; A.fx += ex * f; A.fy += ey * f; B.fx -= ex * f; B.fy -= ey * f; }
        for (const n of nodes) { n.fx -= n.x * .0035; n.fy -= n.y * .0035; if (n.pinned || n === this.dragNode) { n.vx = n.vy = 0; continue; } n.vx = (n.vx + n.fx * a) * .8; n.vy = (n.vy + n.fy * a) * .8; const sp = Math.hypot(n.vx, n.vy); if (sp > 30) { n.vx *= 30 / sp; n.vy *= 30 / sp; } n.x += n.vx; n.y += n.vy; }
        this.alpha *= .985;
      }
      relayout() { if (!this.g) return; for (const n of this.g.nodes) { n.pinned = false; n.x += (Math.random() - .5) * 40; n.y += (Math.random() - .5) * 40; } this.alpha = 1; this.fitted = false; this.refit = false; this.userView = false; this.loop(); }
      fit() { if (this.layout === "3d" && this.mode === "files") { this.draw(); return; } const ns = this.vnodes; if (!ns || !ns.length || !this.w) return; const xs = ns.map((n) => n.x).sort((a, b) => a - b), ys = ns.map((n) => n.y).sort((a, b) => a - b), q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * p)))]; const lo = this.static ? 0 : .01, hi = this.static ? .9999 : .99; const x0 = q(xs, lo), x1 = q(xs, hi), y0 = q(ys, lo), y1 = q(ys, hi); const pw = Math.max(1, x1 - x0), ph = Math.max(1, y1 - y0); this.scale = Math.min(4, Math.max(.003, Math.min((this.w - 80) / pw, (this.h - 80) / ph))); if (this.static && !this.fitAll && (this.layout === "ladder" || this.layout === "tree")) { this.scale = Math.max(.7, Math.min(1.1, (this.w - 80) / pw)); this.ox = 40 - x0 * this.scale; this.oy = 70 - y0 * this.scale; this.draw(); return; } this.ox = this.w / 2 - ((x0 + x1) / 2) * this.scale; this.oy = this.h / 2 - ((y0 + y1) / 2) * this.scale; this.draw(); }
      // -- search --
      // search like the note graph: names first, then the text inside files; Enter / Shift+Enter walk the hits with "N из M"
      runSearch(quiet) {
        const s = this.qIn.value.trim().toLowerCase(), tok = this.sTok = (this.sTok || 0) + 1; this.match = null; this.mlist = []; this.mAt = 0;
        if (!s || !this.g) { this.qCount.textContent = ""; if (!quiet) { this.rebuildView(); this.draw(); } return; }
        for (const n of this.g.nodes) if (n.label.toLowerCase().includes(s)) this.mlist.push(n);
        this.mlist.sort((a, b) => (a.label.toLowerCase().startsWith(s) ? 0 : 1) - (b.label.toLowerCase().startsWith(s) ? 0 : 1) || (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1));
        this.applyMatches(quiet);
        clearTimeout(this.sT); this.sT = setTimeout(async () => {
          const have = new Set(this.mlist), extra = [], TX = window.__bsgFText || (window.__bsgFText = new Map()), root = this.rootPath;
          for (const n of this.g.nodes) { if (n.kind === "dir" || have.has(n) || !n.path || (n.size || 0) > 400000 || !/^(md|txt|json|ya?ml|toml|ini|xml|html?|css|s[ac]ss|[cm]?js|jsx|tsx?|py|rs|go|java|kts?|c|h|cpp|hpp|cs|swift|rb|php|lua|sh|bat|cmd|ps1|dart|sql|gradle|csv|cfg|conf|properties|vue|svelte)$/i.test(n.ext || "")) continue;
            let t = TX.get(n.path); if (t === undefined) { try { t = (await fs.promises.readFile(n.abs || path.join(root, n.path), "utf8")).toLowerCase(); } catch (e) { t = ""; } TX.set(n.path, t); }
            if (tok !== this.sTok) return; if (t.includes(s)) extra.push(n); }
          if (tok !== this.sTok) return; if (extra.length) { this.mlist = this.mlist.concat(extra); this.applyMatches(true, true); } else if (!this.mlist.length) this.qCount.textContent = "ничего";
        }, 220);
      }
      applyMatches(quiet, keep) {
        this.match = new Set(this.mlist); const first = this.mlist[0];
        this.qCount.textContent = this.mlist.length ? (this.mAt + 1) + " из " + this.mlist.length : "ищу…";
        let ch = false; if (this.mode === "files") for (const n of this.mlist.slice(0, 250)) for (let u = n.up; u; u = u.up) if (this.collapsed.delete(u.id)) ch = true;
        this.rebuildView(); if (ch) { this.userView = true; this.applyLayout(false); }
        if (first && !keep) setTimeout(() => this.focusMatch(), ch ? 450 : 0); else if (!quiet) this.draw(); else this.draw();
      }
      stepMatch(d) { if (!this.mlist || !this.mlist.length) return; this.mAt = (this.mAt + d + this.mlist.length) % this.mlist.length; this.qCount.textContent = (this.mAt + 1) + " из " + this.mlist.length; this.focusMatch(); }
      focusMatch() { if (!this.mlist || !this.mlist.length) return; const n = this.mlist[this.mAt] || this.mlist[0]; this.hover = n; if (this.layout === "3d") { this.draw(); return; } if (n.kind === "sym" && !this.expanded.has(n.parent.id)) { this.toggleExpand(n.parent); } this.scale = Math.max(this.scale, 1.1); this.userView = true; const x = n.tx !== undefined ? n.tx : n.x, y = n.ty !== undefined ? n.ty : n.y; this.ox = this.w / 2 - x * this.scale; this.oy = this.h / 2 - y * this.scale; this.draw(); }
      // -- layout storage --
      layoutFile() { return path.join(this.rootPath, ".basalt", "graph-layout.json"); }
      async loadLayout() { try { const j = JSON.parse(await fs.promises.readFile(this.layoutFile(), "utf8")); return j[this.mode] || null; } catch (e) { return null; } }
      saveLayout() { clearTimeout(this.st); this.st = setTimeout(async () => { if (!this.g || !this.rootPath) return; try { let all = {}; try { all = JSON.parse(await fs.promises.readFile(this.layoutFile(), "utf8")); } catch (e) { /* new */ } const m = {}; for (const n of this.g.nodes) m[n.id] = [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10, n.pinned ? 1 : 0]; all[this.mode] = m; await fs.promises.mkdir(path.dirname(this.layoutFile()), { recursive: true }); await fs.promises.writeFile(this.layoutFile(), JSON.stringify(all)); } catch (e) { /* read-only folder */ } }, 400); }
      // -- drawing --
      cssv(n) { return getComputedStyle(this.cv).getPropertyValue(n).trim(); }
      draw() {
        const ctx = this.ctx; if (!ctx || !this.w) return; const d = this.dpr || 1, g = this.g;
        ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, this.w, this.h); if (!g || !this.vnodes) return;
        if (this.layout === "3d" && this.mode === "files") { this.draw3d(ctx); return; }
        const bg = this.cssv("--vs-bg") || "#1e1e1e", txt = this.cssv("--vs-fg") || "#ddd", mut = this.cssv("--vs-ln") || "#999", acc = this.cssv("--vs-kw") || "#7a6cf0";
        ctx.translate(this.ox, this.oy); ctx.scale(this.scale, this.scale);
        const hov = this.hover, S = this.scale, lw = 1 / S, nb = new Set(); if (hov) { nb.add(hov); for (const l of this.vlinks) { if (l.a === hov) nb.add(l.b); else if (l.b === hov) nb.add(l.a); } }
        const focus = hov ? nb : this.match, dim = (n) => focus && !focus.has(n) && !(hov && n === hov);
        const vx0 = -this.ox / S - 30, vy0 = -this.oy / S - 30, vx1 = vx0 + this.w / S + 60, vy1 = vy0 + this.h / S + 60;
        const seen = (l) => { const A = l.a, B = l.b; return !((A.x < vx0 && B.x < vx0) || (A.x > vx1 && B.x > vx1) || (A.y < vy0 && B.y < vy0) || (A.y > vy1 && B.y > vy1)); };
        const curve = (l) => { const A = l.a, B = l.b; if (l.kind === "contains" && this.static && this.layout === "ladder") { ctx.moveTo(A.x, A.y); ctx.lineTo(A.x, B.y); ctx.lineTo(B.x, B.y); return; } if (l.kind === "contains" && this.static && this.layout === "tree") { if (B.x - A.x < 40) { ctx.moveTo(A.x, A.y); ctx.lineTo(A.x, B.y); ctx.lineTo(B.x, B.y); } else { ctx.moveTo(A.x, A.y); ctx.lineTo(A.x, A.y + 22); ctx.lineTo(B.x, A.y + 22); ctx.lineTo(B.x, B.y); } return; } if (l.kind === "contains") { ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); return; } const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, dx = B.x - A.x, dy = B.y - A.y; ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(mx - dy * .12, my + dx * .12, B.x, B.y); };
        const showC = (l) => l.kind !== "contains" || this.showDirs || l.a.kind !== "dir", showI = (l) => l.kind !== "import" || this.showImports || this.mode !== "code";
        const f = focus ? .22 : 1, B = [[], [], [], [], []];
        for (const l of this.vlinks) { if (!seen(l)) continue; if (l.kind === "contains") { if (showC(l)) B[0].push(l); } else if (l.kind === "import") { if (showI(l)) B[1].push(l); } else B[l.w < 3 ? 2 : l.w < 10 ? 3 : 4].push(l); }
        const sty = [[mut, .16 * f, .8], [acc, .4 * f, 1], ["#e0a030", .2 * f, .8], ["#e0a030", .38 * f, 1.3], ["#f0b040", .6 * f, 2]];
        B.forEach((arr, k) => { if (!arr.length) return; ctx.beginPath(); for (const l of arr) curve(l); ctx.globalAlpha = sty[k][1]; ctx.strokeStyle = sty[k][0]; ctx.lineWidth = sty[k][2] * lw; ctx.stroke(); });
        if (focus) { const hl = (l) => (hov ? (l.a === hov || l.b === hov) : (this.match.has(l.a) || this.match.has(l.b))) && showC(l) && showI(l); for (const l of this.vlinks) { if (!hl(l) || !seen(l)) continue; ctx.beginPath(); curve(l); ctx.globalAlpha = .9; ctx.lineWidth = (l.kind === "call" ? 1.2 + Math.min(2, Math.log2(l.w || 1) * .5) : 1.4) * lw; ctx.strokeStyle = l.kind === "call" ? "#f0b040" : l.kind === "import" ? acc : mut; ctx.stroke(); } }
        for (const n of this.vnodes) {
          if (n.x < vx0 || n.x > vx1 || n.y < vy0 || n.y > vy1) continue;
          ctx.globalAlpha = dim(n) ? .12 : 1; ctx.beginPath();
          if (this.mode === "files") { this.drawIcon(ctx, n, S, lw, hov, bg, txt); }
          else if (n.kind === "dir") { ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 1.4 * lw; ctx.strokeStyle = mut; ctx.stroke(); }
          else if (n.kind === "sym") { const sq = n.sym === "class" || n.sym === "type"; if (sq) ctx.rect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2); else ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fillStyle = n.color; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = bg; ctx.stroke(); }
          else { ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fillStyle = n.color; ctx.fill(); if (n.r * S > 3) { ctx.lineWidth = 1.2 * lw; ctx.strokeStyle = bg; ctx.stroke(); } if (n === hov || (this.match && this.match.has(n))) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2 * lw, 0, 7); ctx.lineWidth = 2 * lw; ctx.strokeStyle = txt; ctx.stroke(); } if (this.expanded.has(n.id)) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3 * lw, 0, 7); ctx.setLineDash([3 * lw, 3 * lw]); ctx.lineWidth = lw; ctx.strokeStyle = n.color; ctx.stroke(); ctx.setLineDash([]); } }
          if (n.pinned) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2.5 * lw, 0, 7); ctx.lineWidth = lw; ctx.strokeStyle = txt; ctx.stroke(); }
        }
        // labels: biggest first, none over an already placed one; few at a distance, more when zoomed in
        ctx.globalAlpha = 1; const fs = (this.mode === "files" ? 14 : 11) / S; ctx.font = fs + "px sans-serif"; ctx.textBaseline = "middle"; const placed = [], budget = this.mode === "files" ? 700 : Math.round(14 + S * S * 120);
        const inView = (n) => n.x > vx0 && n.x < vx1 && n.y > vy0 && n.y < vy1;
        const strongSet = (hov || this.match) ? this.vnodes.filter((n) => inView(n) && (n === hov || (hov && nb.has(n)) || (this.match && this.match.has(n)))) : [];
        const order = strongSet.concat(this.byDeg || []);
        let shown = 0, scanned = 0;
        for (const n of order) {
          if (!inView(n)) continue; if (++scanned > 4000 && shown >= budget) break;
          const strong = n === hov || (hov && nb.has(n)) || (this.match && this.match.has(n)); if (!strong && (shown >= budget || dim(n) || (n.kind === "sym" && S < 1.3))) { if (shown >= budget) break; continue; }
          const lab = this.labelOf(n), w = ctx.measureText(lab).width, x = n.x + n.r + 3 / S, y = n.y, box = [x, y - fs / 2, x + w, y + fs / 2];
          if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue; placed.push(box); shown++;
          ctx.lineWidth = 3 / S; ctx.strokeStyle = bg; ctx.strokeText(lab, x, y); ctx.fillStyle = n.kind === "dir" ? mut : txt; ctx.fillText(lab, x, y);
        }
        ctx.globalAlpha = 1;
      }
      // -- interaction --
      toWorld(e) { const r = this.cv.getBoundingClientRect(); this.lsx = e.clientX - r.left; this.lsy = e.clientY - r.top; return [(e.clientX - r.left - this.ox) / this.scale, (e.clientY - r.top - this.oy) / this.scale]; }
      hit(wx, wy) { const g = this.g; if (!g) return null; if (this.layout === "3d" && this.mode === "files") return this.hit3d(); let best = null, bd = 1e9; for (const n of this.vnodes) { const d = Math.hypot(n.x - wx, n.y - wy); if (d < n.r + 4 / this.scale && d < bd) { best = n; bd = d; } } return best; }
      bind() {
        const cv = this.cv; let pan = null, down = null;
        cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); const [wx, wy] = this.toWorld(e), n = this.hit(wx, wy); down = { x: e.clientX, y: e.clientY, moved: false, n }; if (n && !(this.layout === "3d" && this.mode === "files")) { this.dragNode = n; this.dragging = true; this.alpha = Math.max(this.alpha, .3); this.loop(); } else pan = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy, yaw: this.yaw, pitch: this.pitch }; cv.style.cursor = "grabbing"; });
        cv.addEventListener("pointermove", (e) => {
          if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
          if (this.dragNode && down && down.moved) { const [wx, wy] = this.toWorld(e); this.dragNode.x = wx; this.dragNode.y = wy; this.dragNode.pinned = true; this.alpha = Math.max(this.alpha, .25); this.tip.style.display = "none"; return; }
          if (pan) { this.userView = true; if (this.layout === "3d" && this.mode === "files") { this.yaw = pan.yaw + (e.clientX - pan.x) * .008; this.pitch = Math.max(-1.45, Math.min(1.45, pan.pitch + (e.clientY - pan.y) * .008)); this.draw(); return; } this.ox = pan.ox + e.clientX - pan.x; this.oy = pan.oy + e.clientY - pan.y; this.draw(); return; }
          const [wx, wy] = this.toWorld(e), n = this.hit(wx, wy); if (n !== this.hover) { this.hover = n; this.draw(); this.showTip(n, e); } else if (n) this.moveTip(e);
          cv.style.cursor = n ? "pointer" : "grab";
        });
        cv.addEventListener("pointerup", () => { if (down && !down.moved && down.n) { if (this.dragNode) { this.dragNode = null; } this.openNode(down.n); } if (this.dragNode) { this.dragNode = null; this.saveLayout(); } this.dragging = false; pan = null; down = null; cv.style.cursor = "grab"; if (this.g) this.saveLayout(); });
        cv.addEventListener("pointerleave", () => { if (!down) { this.hover = null; this.tip.style.display = "none"; this.draw(); } });
        cv.addEventListener("contextmenu", (e) => {
          e.preventDefault(); const [wx, wy] = this.toWorld(e), n = this.hit(wx, wy), M = window.__bsApi && window.__bsApi.Menu; if (!M) return;
          const m = new M(), item = (t, ic, fn, chk) => m.addItem((i) => { i.setTitle(t).setIcon(ic).onClick(fn); if (chk) i.setChecked(true); });
          const abs = (x) => (x.kind === "dir" ? path.join(this.rootPath, x.path) : x.abs), copy = (t) => navigator.clipboard.writeText(t).catch(() => {});
          if (n) {
            if (n.kind === "file") item("Открыть", "lucide-file", () => this.openNode(n));
            if (n.kind === "dir" && n.nfiles) { item(this.collapsed.has(n.id) ? "Развернуть папку" : "Свернуть папку", "lucide-folder-tree", () => this.toggleDir(n)); item("Развернуть всё внутри", "lucide-chevrons-down", () => this.setDirTree(n, true)); item("Свернуть всё внутри", "lucide-chevrons-up", () => this.setDirTree(n, false)); }
            m.addSeparator();
            item(n.pinned ? "Открепить" : "Закрепить на месте", n.pinned ? "lucide-pin-off" : "lucide-pin", () => { n.pinned = !n.pinned; this.saveLayout(); this.draw(); });
            item("Скрыть" + (n.kind === "dir" ? " папку" : ""), "lucide-eye-off", () => this.hideNode(n));
            item("Показать только это и окружение", "lucide-focus", () => this.focusNode(n));
            m.addItem((it) => { it.setTitle("Цветная метка").setIcon("lucide-palette"); const sub = it.setSubmenu(); for (const [t, c] of [["Красная", "#e5484d"], ["Оранжевая", "#f59f3b"], ["Жёлтая", "#d6b43c"], ["Зелёная", "#46a758"], ["Голубая", "#3fa7d6"], ["Фиолетовая", "#8e6bd8"]]) sub.addItem((x) => x.setTitle(t).setIcon("lucide-circle").setChecked(this.tags.get(n.id) === c).onClick(() => this.setTag(n, c))); if (this.tags.has(n.id)) { sub.addSeparator(); sub.addItem((x) => x.setTitle("Убрать метку").setIcon("lucide-x").onClick(() => this.setTag(n, null))); } });
            m.addSeparator();
            item("Показать в проводнике", "lucide-folder-open", () => { try { window.__bsReveal(abs(n)); } catch (er) { /* none */ } });
            m.addItem((it) => { it.setTitle("Копировать").setIcon("lucide-copy"); const sub = it.setSubmenu(); sub.addItem((x) => x.setTitle("Полный путь").setIcon("lucide-copy").onClick(() => copy(abs(n)))); sub.addItem((x) => x.setTitle("Путь от корня папки").setIcon("lucide-copy").onClick(() => copy(n.path))); sub.addItem((x) => x.setTitle("Имя").setIcon("lucide-copy").onClick(() => copy(n.label))); });
          } else {
            item("Вписать в окно", "lucide-maximize", () => { this.userView = true; this.fitAll = true; this.fit(); this.fitAll = false; });
            if (this.hidden.size || this.focusSet) item("Показать весь граф", "lucide-eye", () => this.showAllNodes());
            if (this.mode === "files") item(this.collapsed.size ? "Развернуть все папки" : "Свернуть все папки", "lucide-folder-tree", () => this.toggleAllDirs());
            if (this.tags.size) item("Убрать все цветные метки", "lucide-eraser", () => { this.tags.clear(); this.saveTags(); this.draw(); });
            m.addSeparator();
            item("Пересканировать папку", "lucide-refresh-cw", () => this.load(true));
            item("Настройки графа", "lucide-settings", () => this.panelEl && this.panelEl.classList.add("is-open"));
            item("Справка", "lucide-circle-help", () => this.openHelp());
          }
          m.showAtMouseEvent(e);
        });
        cv.addEventListener("dblclick", (e) => { const [wx, wy] = this.toWorld(e), n = this.hit(wx, wy); if (n && this.mode === "code" && n.kind === "file") { this.toggleExpand(n); return; } if (n) { n.pinned = false; this.alpha = Math.max(this.alpha, .3); this.loop(); this.saveLayout(); } });
        cv.addEventListener("wheel", (e) => { e.preventDefault(); this.userView = true; if (this.layout === "3d" && this.mode === "files") { this.zoom3 = Math.max(.01, Math.min(8, (this.zoom3 || 1) * Math.exp(-e.deltaY * .0015))); this.draw(); return; } const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = Math.exp(-e.deltaY * .0015), ns = Math.max(.003, Math.min(10, this.scale * k)); this.ox = mx - (mx - this.ox) * (ns / this.scale); this.oy = my - (my - this.oy) * (ns / this.scale); this.scale = ns; this.draw(); }, { passive: false });
      }
      showTip(n, e) { if (!n) { this.tip.style.display = "none"; return; } const t = this.tip; t.textContent = ""; const b = document.createElement("b"); b.textContent = n.label; t.appendChild(b); const add = (s) => { const x = document.createElement("span"); x.textContent = s; t.appendChild(x); };
        if (n.kind === "dir") add("Папка · файлов: " + (n.nfiles || 0) + (n.nfiles ? " · клик — " + (this.collapsed.has(n.id) ? "развернуть" : "свернуть") : "")); else if (n.kind === "file") { add(n.path); add(n.lang + (n.size != null ? " · " + (n.size < 1024 ? n.size + " Б" : n.size < 1048576 ? (n.size / 1024).toFixed(1) + " КБ" : (n.size / 1048576).toFixed(1) + " МБ") : " · " + n.loc + " строк")); } else { add(n.path + ":" + n.line); add((n.sym === "class" ? "Класс/тип" : n.sym === "method" ? "Метод" : "Функция") + " · связей: " + n.deg); }
        t.style.display = "block"; this.moveTip(e); }
      moveTip(e) { const r = this.body.getBoundingClientRect(); this.tip.style.left = Math.min(r.width - 200, e.clientX - r.left + 14) + "px"; this.tip.style.top = Math.min(r.height - 60, e.clientY - r.top + 14) + "px"; }
      openNode(n) {
        if (n.kind === "dir") { this.toggleDir(n); return; } const W = window.__bsWorkspace;
        if (W && W.active && W.active() && W.root() === this.rootPath) { W.openFile({ path: n.path, abs: n.abs, name: path.basename(n.path), isDir: false }, true); return; }
        const f = app.vault.getAbstractFileByPath(n.path); const go = async () => { const leaf = app.workspace.getLeaf("tab"); if (f) await leaf.openFile(f); else if (window.__bsTextFile) await window.__bsTextFile.open(n.path);
          if (n.line) setTimeout(() => { const l = app.workspace.getLeavesOfType("basalt-textfile").find((x) => x.view && x.view.path === n.path); const cm = l && l.view.cm; if (cm) { cm.setCursor({ line: n.line - 1, ch: 0 }); cm.scrollIntoView({ line: n.line - 1, ch: 0 }, 160); cm.focus(); } }, 500); }; go();
      }
      async onClose() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; if (this.ro) this.ro.disconnect(); this.g = null; }
    };
  }

  async function openGraph(mode) {
    const ws = app.workspace; const same = ws.getLeavesOfType(VIEW).find((l) => l.view && l.view.mode === mode);
    if (same) { ws.revealLeaf(same); ws.setActiveLeaf(same, { focus: true }); return; }
    const leaf = ws.getLeaf("tab"); await leaf.setViewState({ type: VIEW, active: true, state: { mode } }); ws.setActiveLeaf(leaf, { focus: true });
  }

  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.viewRegistry || !app.commands || !window.__bsApi || !window.__bsApi.ItemView) return;
    clearInterval(t);
    const V = makeView(window.__bsApi), creator = (leaf) => new V(leaf);
    try { app.viewRegistry.registerView(VIEW, creator); } catch (e) { app.viewRegistry.viewByType[VIEW] = creator; }
    app.commands.addCommand({ id: "basalt:graph-files", name: "Граф файлов", icon: "lucide-git-fork", callback: () => openGraph("files") });
        window.__bsGraphs = { open: openGraph, build: buildGraph, parse };
  }, 500);
})();
