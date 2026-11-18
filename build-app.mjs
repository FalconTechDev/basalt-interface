// Builds the own-code part of src/app.js.
//   node build-app.mjs              bundle src-app/*.js and write them into src/app.js (plain JS)
//   node build-app.mjs --wasm       also compile app-core (Rust -> wasm) and inline it (needs cargo; --no-cargo reuses the built wasm)
//   node build-app.mjs --out F      write the result to F instead of src/app.js (input is still src/app.js)
//   node build-app.mjs --check      only verify that src/app.js is up to date with src-app/ (exit 1 if not)
//
// How it works. src/app.js is the inherited minified bundle. Own code lives in src-app/ (readable ES modules + the Rust crate
// app-core/). The build concatenates the modules into one object `__basaltOwn` placed between the markers /*basalt-own:begin*/ and
// /*basalt-own:end*/ right at the start of the application scope, and turns every function listed in src-app/manifest.json into a
// one-line wrapper:   function nu(e){return/*own*/__basaltOwn.lastSegment(e)}   (same name, same parameters, so no call site changes).
// Besides functions the manifest can hold "declarators" (a whole  var X=function(){...}()  class is replaced by an expression such as
// __basaltOwn.createVault(VT,Eu)), "methods" (one  e.prototype.m=function(){...}  of a class that stays is replaced by
// __basaltOwn.name) and "envBind" (the application-scope names the own code reads lazily, passed to bindEnv). Each replaced text is
// checked against the sha1 recorded in the manifest, so nothing else is ever overwritten.
// The build is repeatable: wrappers are regenerated, the block between the markers is replaced. A function is only swapped if its
// text is still byte-identical to the one in the base revision named in the manifest (git history keeps the originals).
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle, acorn } from "./tools/split-app.mjs";
import { loadBase } from "./tools/app-base.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, "src-app");
// order matters only for readability: every module is a flat scope, names must be unique across them
const FIRST = ["path.js", "text.js", "misc.js", "frontmatter.js", "search.js"];
export const JS_MODULES = [...FIRST, ...fs.readdirSync(srcDir).filter((f) => f.endsWith(".js") && !FIRST.includes(f) && !["core.js", "rust.js"].includes(f)).sort()];
// the WebAssembly side (app-core): shipped only with --wasm, because on every function measured so far plain JS is as fast or faster
export const WASM_MODULES = ["core.js", "rust.js"];
export const MODULES = [...WASM_MODULES.slice(0, 1), ...JS_MODULES, ...WASM_MODULES.slice(1)];
const BEGIN = "/*basalt-own:begin*/";
const END = "/*basalt-own:end*/";

/** The `e.prototype.name = <function>` of the class IIFE in `init` (the one in its returned sequence); returns the right-hand node. */
function findMethod(init, name) {
  const fn = init.type === "CallExpression" ? init.callee : init;
  const ret = fn.body.body.find((st) => st.type === "ReturnStatement" && st.argument && st.argument.type === "SequenceExpression");
  if (!ret) return null;
  for (const ex of ret.argument.expressions) {
    const l = ex.type === "AssignmentExpression" && ex.left;
    if (l && l.type === "MemberExpression" && !l.computed && l.property.name === name && l.object.type === "MemberExpression" && l.object.property.name === "prototype") return ex.right;
  }
  return null;
}

/** Base class-IIFE text with its already-replaced prototype methods rewritten to their __basaltOwn wrappers. */
function classInitWithMethodWrappers(baseSrc, init, methods) {
  let text = baseSrc.slice(init.start, init.end);
  const reps = [];
  for (const m of methods) {
    const node = findMethod(init, m.name);
    if (node) reps.push({ start: node.start - init.start, end: node.end - init.start, text: `__basaltOwn.${m.use}` });
  }
  reps.sort((a, b) => b.start - a.start);
  for (const r of reps) text = text.slice(0, r.start) + r.text + text.slice(r.end);
  return text;
}

export function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(srcDir, "manifest.json"), "utf8"));
}

export function buildWasm({ cargo = true } = {}) {
  const eng = path.join(root, "app-core");
  const target = process.env.CARGO_TARGET_DIR || "E:/rust-target/app-core";
  if (cargo) execSync("cargo build --release --target wasm32-unknown-unknown", { cwd: eng, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: target } });
  return fs.readFileSync(path.join(target, "wasm32-unknown-unknown/release/app_core.wasm"));
}

/** Module sources with imports/exports stripped, joined; returns { code, exported: Set } */
export function bundleModules(wasm) {
  const exported = new Set();
  const parts = [];
  for (const m of wasm ? MODULES : JS_MODULES) {
    let code = fs.readFileSync(path.join(srcDir, m), "utf8");
    if (m === "core.js") code = code.replace("__WASM_B64__", wasm.toString("base64"));
    const lines = code.split("\n").filter((l) => !/^import\s.*from\s+["'][^"']+["'];?\s*$/.test(l)).filter((l) => !/^export\s*\{.*\};?\s*$/.test(l));
    code = lines.join("\n").replace(/^export\s+(async\s+)?(function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm, (_, a, kind, name) => { exported.add(name); return `${a || ""}${kind} ${name}`; });
    parts.push(`// ---- ${m} ----\n${code.trim()}\n`);
  }
  const seen = new Map();
  const ast = acorn.parse(parts.join("\n"), { ecmaVersion: 2022 });
  for (const n of ast.body) {
    const names = n.type === "VariableDeclaration" ? n.declarations.map((d) => d.id.name) : n.id ? [n.id.name] : [];
    for (const name of names) { if (seen.has(name)) throw new Error(`duplicate top-level name ${name} in own modules`); seen.set(name, 1); }
  }
  const body = parts.join("\n").replace(/\n{3,}/g, "\n\n");
  const exportList = [...exported].sort();
  return { code: `var __basaltOwn=(()=>{\n${body}\nreturn {${exportList.join(",")}};\n})();`, exported };
}

/** Applies the manifest to the application text; returns the new text and the replaced byte count. */
export function applyOwn(srcText, wasm, tmpPath) {
  const manifest = readManifest();
  const base = loadBase(manifest.base);
  const { code, exported } = bundleModules(wasm);
  for (const e of manifest.entries) if (!exported.has(e.use)) throw new Error(`manifest: ${e.orig} -> ${e.use} is not exported by src-app`);

  // 1) wrappers (from the end of the file to the start, so earlier offsets stay valid)
  fs.writeFileSync(tmpPath, srcText);
  const b = loadBundle(tmpPath);
  const decl = new Map();
  for (const n of b.body) if (n.type === "FunctionDeclaration") decl.set(n.id.name, n);
  const jobs = [];
  let replaced = 0;
  for (const e of manifest.entries) {
    const n = decl.get(e.orig);
    if (!n) throw new Error(`manifest: no top-level function ${e.orig} in src/app.js`);
    if (!n.params.every((p) => p.type === "Identifier")) throw new Error(`manifest: ${e.orig} has non-trivial parameters`);
    const params = n.params.map((p) => p.name).join(",");
    const args = e.host ? [params, "__basaltHost"].filter(Boolean).join(",") : params;
    const wrapper = `function ${e.orig}(${params}){return/*own*/__basaltOwn.${e.use}(${args})}`;
    const text = srcText.slice(n.start, n.end);
    const wrapped = /^function [^(]+\([^)]*\)\{return\/\*own\*\/\__basaltOwn\./.test(text);
    if (!wrapped) {
      if (text !== base.fn(e.orig)) throw new Error(`manifest: ${e.orig} differs from base ${manifest.base}; refusing to replace it`);
      replaced += text.length;
      e.originalBytes = text.length;
    }
    jobs.push({ start: n.start, end: n.end, wrapper, orig: e.orig, text });
  }
  const fresh = [];
  // 1b) declarators and methods
  const sha = (t) => crypto.createHash("sha1").update(t).digest("hex");
  const declInit = new Map();
  for (const n of b.body) if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.init) declInit.set(d.id.name, d.init);
  const classOrigs = new Set((manifest.classes || []).map((e) => e.orig));
  let manifestChanged = false;
  const spans = [];
  for (const e of manifest.declarators || []) {
    const init = declInit.get(e.orig);
    if (!init) throw new Error(`manifest: no top-level var ${e.orig}`);
    spans.push({ node: init, orig: e.orig, entry: e, replacement: e.expr, label: e.orig });
  }
  for (const e of manifest.methods || []) {
    if (classOrigs.has(e.class)) continue;
    const init = declInit.get(e.class);
    if (!init) throw new Error(`manifest: no top-level var ${e.class}`);
    const node = findMethod(init, e.name);
    if (!node) throw new Error(`manifest: no method ${e.class}.${e.name}`);
    spans.push({ node, entry: e, replacement: `__basaltOwn.${e.use}`, label: `${e.class}.${e.name}` });
  }
  for (const sp of spans) {
    const text = srcText.slice(sp.node.start, sp.node.end);
    if (text === sp.replacement) continue;
    const hash = sha(text);
    const wasOwn = /__basaltOwn./.test(text.slice(0, 120)); // an earlier own replacement of this span (the entry now points to a new export)
    if (sp.entry.sha1 && sp.entry.sha1 !== hash && !wasOwn) throw new Error(`manifest: ${sp.label} differs from the recorded original; refusing to replace it`);
    if (wasOwn) { jobs.push({ start: sp.node.start, end: sp.node.end, wrapper: sp.replacement, orig: sp.label, text, isOwn: true }); continue; }
    if (!sp.entry.sha1) manifestChanged = true;
    sp.entry.sha1 = hash;
    sp.entry.originalBytes = text.length;
    replaced += text.length;
    fresh.push(sp.label);
    jobs.push({ start: sp.node.start, end: sp.node.end, wrapper: sp.replacement, orig: sp.label, text });
  }
  // 1b) classes: `X=function(){...}()` declarators get the init replaced by a call of the own factory (the factory runs at the
  // original position, so every app class it extends already exists); own code reaches app internals through __basaltHost only
  const vdecl = new Map();
  for (const n of b.body) if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier") vdecl.set(d.id.name, d);
  let baseDecls = null;
  let baseDeclNodes = null;
  for (const e of manifest.classes || []) {
    if (!exported.has(e.use)) throw new Error(`manifest: class ${e.orig} -> ${e.use} is not exported by src-app`);
    const d = vdecl.get(e.orig);
    if (!d || !d.init) throw new Error(`manifest: no top-level var ${e.orig} in src/app.js`);
    const text = srcText.slice(d.init.start, d.init.end);
    const wrapper = `__basaltOwn.${e.use}(__basaltHost)`;
    if (!text.startsWith("__basaltOwn.")) {
      if (!baseDecls) {
        const bf = path.join(path.dirname(tmpPath), `basalt-app-base-decls-${manifest.base}.js`);
        fs.writeFileSync(bf, base.src);
        baseDecls = new Map();
        baseDeclNodes = new Map();
        const bb = loadBundle(bf);
        for (const n of bb.body) if (n.type === "VariableDeclaration") for (const x of n.declarations) if (x.id.type === "Identifier" && x.init) {
          baseDecls.set(x.id.name, base.src.slice(x.init.start, x.init.end));
          baseDeclNodes.set(x.id.name, x.init);
        }
      }
      let expected = classInitWithMethodWrappers(base.src, baseDeclNodes.get(e.orig), (manifest.methods || []).filter((m) => m.class === e.orig));
      // textual patches may also touch the inside of a class init (e.g. constructor helper fixes);
      // the find text is anchored at the declarator, so test it against "orig=" + init
      for (const p of manifest.patches || []) {
        const anchored = e.orig + "=" + expected;
        const at = anchored.indexOf(p.find);
        if (at === 0 && anchored.indexOf(p.find, 1) < 0) expected = anchored.slice(0, at) + p.replace + anchored.slice(at + p.find.length);
        expected = expected.startsWith(e.orig + "=") ? expected.slice(e.orig.length + 1) : expected;
      }
      if (text !== expected) throw new Error(`manifest: class ${e.orig} differs from base ${manifest.base}; refusing to replace it`);
      replaced += text.length;
      e.originalBytes = text.length;
    }
    jobs.push({ start: d.init.start, end: d.init.end, wrapper, orig: e.orig, text, isOwn: text.startsWith("__basaltOwn.") });
  }
  jobs.sort((x, y) => y.start - x.start);
  let out = srcText;
  for (const j of jobs) {
    if (out.slice(j.start, j.end) !== j.text) throw new Error("internal: offsets moved");
    out = out.slice(0, j.start) + j.wrapper + out.slice(j.end);
    if (!j.text.includes("/*own*/") && !j.isOwn && !fresh.includes(j.orig) && !j.wrapper.startsWith("__basaltOwn.")) fresh.push(j.orig);
  }

  // 1c) textual patches for inherited code that has to cooperate with own ES6 classes (manifest.patches: {find, replace, note})
  for (const p of manifest.patches || []) {
    if (out.includes(p.replace)) continue;
    const at = out.indexOf(p.find);
    // both texts gone: the patched region itself was replaced by own code, nothing left to patch
    if (at < 0 && !out.includes(p.find)) continue;
    if (at < 0 || out.indexOf(p.find, at + 1) >= 0) throw new Error(`manifest.patches: "${p.note || p.find.slice(0, 40)}" must match exactly once`);
    out = out.slice(0, at) + p.replace + out.slice(at + p.find.length);
  }

  // 2) the block with the own modules
  // envBind entries are `name` or `alias:orig`; each becomes a lazy getter so
  // reading one bound value never forces evaluation of the others (some are
  // only defined late in bundle init).
  const bind = manifest.envBind
    ? `__basaltOwn.bindEnv(()=>({${manifest.envBind.split(",").map((t) => {
        const i = t.indexOf(":");
        const alias = i >= 0 ? t.slice(0, i).trim() : t.trim();
        const orig = i >= 0 ? t.slice(i + 1).trim() : alias;
        return `get ${alias}(){return ${orig}},set ${alias}(v){${orig}=v}`;
      }).join(",")}}));`
    : "";
  const host = Object.entries(manifest.host || {}).map(([k, v]) => `get ${k}(){return ${v}}`).join(",");
  const block = `${BEGIN}${code}var __basaltHost={${host}};${bind}${END}`;
  const bi = out.indexOf(BEGIN);
  if (bi >= 0) {
    const ei = out.indexOf(END, bi);
    out = out.slice(0, bi) + block + out.slice(ei + END.length);
  } else {
    const first = b.body[0]; // "use strict", always before any replaced function
    out = out.slice(0, first.end) + block + out.slice(first.end);
  }
  return { text: out, codeBytes: code.length, replacedFresh: fresh, entries: manifest.entries.length + (manifest.classes || []).length, ownBytesReplaced: replaced, manifest, manifestChanged };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const input = path.join(root, "src", "app.js");
  const withWasm = process.argv.includes("--wasm");
  const wasm = withWasm ? buildWasm({ cargo: !process.argv.includes("--no-cargo") }) : null;
  const tmp = path.join(process.env.TEMP || process.env.TMPDIR || ".", "basalt-app-build.js");
  const res = applyOwn(fs.readFileSync(input, "utf8"), wasm, tmp);
  if (process.argv.includes("--check")) {
    if (res.text !== fs.readFileSync(input, "utf8")) { console.error("src/app.js is out of date with src-app/ (run node build-app.mjs)"); process.exit(1); }
    console.log("src/app.js is up to date");
  } else {
    const out = arg("--out") ? path.resolve(arg("--out")) : input;
    fs.writeFileSync(out, res.text);
    if (res.manifestChanged) {
      const file = path.join(srcDir, "manifest.json");
      const crlf = fs.readFileSync(file, "utf8").includes("\r\n"); // keep the file's line endings
      fs.writeFileSync(file, (JSON.stringify(res.manifest, null, 1) + "\n").replace(/\n/g, crlf ? "\r\n" : "\n"));
    }
    console.log(`app.js: ${out} (${res.text.length} bytes); own block ${res.codeBytes} bytes (${wasm ? `wasm ${wasm.length}` : "no wasm"}); ${res.entries} functions wrapped, ${res.replacedFresh.length} newly`);
  }
}
