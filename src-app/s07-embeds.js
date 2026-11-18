// s07 embeds: lazy script loaders (MathJax, Mermaid, pdf.js, Prism, CM modes),
// the markdown worker bridge, embed post-processors that dedupe already-rendered
// mermaid/math/code/image/link nodes, and the MathJax stylesheet flush.

import { env } from "./env.js";
import { escapeRegExp } from "./metadata-helpers.js";
import { s04CreateDeferred } from "./s04-themes.js";
import { s07weakMapFactory } from "./s07-helpers.js";

// ---------- lazy script loaders (were `Hv(...)` declarators) ----------

let s07mathJax, s07mermaid, s07pdfjs, s07prism, s07pdfviewer, s07cmmodes;

export function s07mathJaxLoader() {
  return s07mathJax || (s07mathJax = env().Hv("/lib/mathjax/tex-chtml-full.js", {
    before: function () {
      window.MathJax = {
        tex: { inlineMath: [], displayMath: [], processEscapes: false, processEnvironments: false, processRefs: false },
        startup: { typeset: false },
        options: {
          enableMenu: false,
          menuOptions: { settings: { renderer: "CHTML" } },
          renderActions: { assistiveMml: [] },
          safeOptions: { safeProtocols: { http: true, https: true, file: true, javascript: false, data: false } },
        },
      };
      if (window.publish) delete window.MathJax.options.renderActions;
      localStorage.removeItem("MathJax-Menu-Settings");
    },
  }));
}

export function s07mermaidLoader() {
  return s07mermaid || (s07mermaid = env().Hv("/lib/mermaid.min.js", {
    after: function () {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        themeVariables: { fontFamily: "var(--font-mermaid)" },
        flowchart: { useMaxWidth: false },
        sequence: { useMaxWidth: false },
        gantt: { useMaxWidth: true, axisFormatter: [["%Y-%m-%d", function (d) { return d.getDay() === 1; }]] },
        journey: { useMaxWidth: true },
        class: { useMaxWidth: true },
        git: { useMaxWidth: false },
        state: { useMaxWidth: true },
        er: { useMaxWidth: false },
        pie: { useMaxWidth: true },
      });
    },
  }));
}

export function s07pdfJsLoader() {
  return s07pdfjs || (s07pdfjs = env().Hv("/lib/pdfjs/pdf.min.mjs", {
    type: "module",
    after: function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/lib/pdfjs/pdf.worker.min.mjs";
      env().Jl(window, "pdfjsLib");
      env().Jl(pdfjsLib.GlobalWorkerOptions, "workerSrc");
    },
  }));
}

export function s07prismLoader() {
  return s07prism || (s07prism = env().Hv("/lib/prism.min.js", {
    before: function () {
      window.Prism = window.Prism || {};
      window.Prism.manual = true;
    },
  }));
}

export function s07pdfViewerLoader() {
  return s07pdfviewer || (s07pdfviewer = env().Hv("/lib/pdfjs/pdf.viewer.min.mjs", {
    type: "module",
    after: function () {
      env().Jl(window, "pdfjsViewer");
    },
  }));
}

export function s07cmModesLoader() {
  return s07cmmodes || (s07cmmodes = env().Hv("/lib/codemirror/modes.min.js"));
}

// ---------- loader readiness (were `wz`/`vz`/`yz`/`pz`/`dz`) ----------

export async function s07loadMathJax() {
  await s07mathJaxLoader().promise;
}
export async function s07loadMermaid() {
  await s07mermaidLoader().promise;
  return mermaid;
}
export async function s07loadPrism() {
  await s07prismLoader().promise;
  return Prism;
}
export async function s07loadPdfJs() {
  await s07pdfJsLoader().promise;
  return window.pdfjsLib;
}
export async function s07loadPdfViewer() {
  await s07pdfJsLoader().promise;
  await s07pdfViewerLoader().promise;
  return window.pdfjsViewer;
}

// ---------- markdown worker bridge (was `Bz`) ----------

/** One outstanding request per worker; resolves with the first message back. */
export function s07workerBridge() {
  return class {
    constructor(worker) {
      this.promise = null;
      this.worker = worker;
      this.worker.onmessage = this.onReceiveMessageFromWorker.bind(this);
    }
    onReceiveMessageFromWorker(event) {
      if (this.promise) {
        const pending = this.promise;
        this.promise = null;
        pending.resolve(event.data);
      }
    }
    submit(message, transfer) {
      if (this.promise) return null;
      this.promise = s04CreateDeferred();
      this.worker.postMessage(message, transfer);
      return this.promise.promise;
    }
  };
}

// ---------- worker script loading (was `Hz`/`Vz`) ----------

/** Loads a worker script: same-origin gets a real Worker, anything else is fetched and blob-ified. */
export async function s07workerScript(url, options) {
  try {
    if (new URL(url, document.baseURI).origin !== location.origin) return await s07workerFromScript(url, options);
  } catch (e) { /* fall through to the Worker attempt */ }
  try {
    return new Worker(url, options);
  } catch (e) {
    return await s07workerFromScript(url, options);
  }
}

/** Fetches the worker source and wraps it in a blob URL Worker. */
export async function s07workerFromScript(url, options) {
  const source = await env().ajaxPromise({ url });
  return new Worker(window.URL.createObjectURL(new Blob([source])), options);
}

// ---------- embed dedupe caches (were `Xz`/`eq`, built by `Rz`) ----------

export function s07newEmbedCache() {
  return s07weakMapFactory();
}

// ---------- mermaid rendering (was `Kz`/`Yz`/`Qz`/`$z`/`Zz`) ----------

/** Text of a mermaid code block, cached per element with a trailing newline stripped. */
export function s07mermaidCodeText(el) {
  const cache = env().Xz;
  if (cache.has(el)) return cache.get(el);
  let text = el.getText();
  if (text.endsWith("\n")) text = text.substring(0, text.length - 1);
  cache.set(el, text);
  return text;
}

/** First rendered .mermaid element inside the sections whose code text matches. */
export function s07mermaidElementFor(sections, text) {
  for (let i = 0; i < sections.length; i++) {
    const found = sections[i].el.findAll(".mermaid");
    for (let j = 0; j < found.length; j++) {
      const el = found[j];
      if (text === s07mermaidCodeText(el)) return el;
    }
  }
  return null;
}

/** The `language-x` class name of a highlighted code element, or undefined. */
export function s07highlightedLang(el) {
  return el.className.split(" ").filter((c) => c.startsWith("language-"))[0];
}

/** Renders one mermaid code element into its parent, fixing up links and marker ids. */
export async function s07renderMermaidDiagram(container, codeEl) {
  const text = s07mermaidCodeText(codeEl);
  const parent = codeEl.parentElement;
  const doc = codeEl.doc;
  let width = parent.clientWidth;
  if (width === 0) width = container.clientWidth;
  if (width === 0) width = container.win.innerWidth;
  const id = "m" + randomHex(16);
  const measurer = document.body.createDiv("mermaid");
  try {
    measurer.style.width = width + "px";
    measurer.style.visibility = "hidden";
    measurer.style.position = "absolute";
    const rendered = await mermaid.render(id, text, measurer);
    const svg = rendered.svg;
    measurer.detach();
    const holder = env().createDiv("mermaid");
    holder.innerHTML = svg;
    parent.replaceWith(holder);
    env().Xz.set(holder, text);
    if (holder.instanceOf(Element)) {
      const links = holder.findAll('[*|class*="internal-link"] > g.label foreignObject > div');
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const label = link.textContent;
        if (label) {
          link.empty();
          link.createEl("a", { cls: "internal-link", href: label, text: label });
        }
      }
      const stack = [holder];
      while (stack.length > 0) {
        const node = stack.pop();
        stack.push.apply(stack, Array.from(node.childNodes));
        if (node.instanceOf(SVGAElement) && node.href && !node.href.baseVal) node.href.baseVal = node.getAttr("href");
      }
      const style = holder.find("style");
      if (style) {
        const before = style.innerHTML;
        let css = before;
        const markers = holder.findAll("marker");
        for (let i = 0; i < markers.length; i++) {
          const marker = markers[i];
          const mid = marker.id;
          if (mid) {
            const renamed = id + "-" + mid;
            marker.id = renamed;
            for (let k = 0; k < 2; k++) {
              const attr = ["marker-start", "marker-end"][k];
              const refs = holder.findAll("[" + attr + '="url(#' + mid + ')"]');
              for (let j = 0; j < refs.length; j++) refs[j].setAttr(attr, "url(#" + renamed + ")");
            }
            css = css.replace(new RegExp("#" + escapeRegExp(mid) + "(?!\\w|-)", "g"), "#" + renamed);
          }
        }
        if (css !== before) style.innerHTML = css;
      }
    }
  } catch (err) {
    const old = doc.getElementById("d" + id);
    if (old) old.detach();
    measurer.detach();
    console.error(err);
    codeEl.empty();
    codeEl.appendText("Error parsing Mermaid diagram!\n\n" + (err.str || err.message));
  }
}

/** Renders every mermaid code element under `contentEl`, deferring hidden ones. */
export async function s07renderMermaidDiagrams(contentEl, codeEls) {
  await s07mermaidLoader();
  const pending = [];
  for (let i = 0; i < codeEls.length; i++) {
    const code = codeEls[i];
    if (!code.isShown() && !contentEl.isShown()) {
      code.onNodeInserted(() => s07renderMermaidDiagram(contentEl, code), true);
    } else {
      pending.push(s07renderMermaidDiagram(contentEl, code));
    }
  }
  if (pending.length > 0) await Promise.all(pending);
}

// ---------- math rendering (was `Sz`/`xz`/`kz`) ----------

let s07mjDeferred = null;
let s07mjStyle = null;
let s07mjTimer = 0;

/** Appends the current MathJax CHTML stylesheet and releases the pending flush. */
export function s07flushMathJax() {
  const sheet = MathJax.chtmlStylesheet();
  if (!(s07mjStyle && sheet === s07mjStyle)) {
    if (s07mjStyle) s07mjStyle.detach();
    s07mjStyle = sheet;
    document.head.appendChild(sheet);
  }
  s07mjStyle.dataset.change = s07mjStyle.dataset.change === "1" ? "2" : "1";
  s07mjDeferred.resolve();
  s07mjDeferred = null;
}

/** Schedules a stylesheet flush 100 ms out and returns its promise. */
export function s07scheduleMathJaxFlush() {
  if (!s07mjDeferred) s07mjDeferred = s04CreateDeferred();
  clearTimeout(s07mjTimer);
  s07mjTimer = window.setTimeout(s07flushMathJax, 100);
  return s07mjDeferred.promise;
}

/** MathJax TeX -> CHTML. */
export function s07texToHtml(tex, display) {
  return MathJax.tex2chtml(tex, { display });
}

// ---------- embed post-processors (were `tq`/`iq`/`Jz`/`rq`/`nq`/`cq`) ----------

/** First rendered math element matching text + block flag inside the sections. */
export function s07mathElementFor(sections, text, isBlock) {
  const cache = env().eq;
  for (let i = 0; i < sections.length; i++) {
    const found = sections[i].el.findAll(".math.is-loaded");
    for (let j = 0; j < found.length; j++) {
      const el = found[j];
      if (text === cache.get(el) && el.classList.contains("math-block") === isBlock) return el;
    }
  }
  return null;
}

/** True when both elements expose the same values for every attribute name. */
export function s07attrsMatch(source, target, names) {
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (source.getAttr(name) !== target.getAttr(name)) return false;
  }
  return true;
}

/** First rendered internal embed matching src/width/height/alt inside the sections. */
export function s07internalEmbedFor(sections, source) {
  for (let i = 0; i < sections.length; i++) {
    const found = sections[i].el.findAll(".internal-embed.is-loaded");
    for (let j = 0; j < found.length; j++) {
      const el = found[j];
      if (s07attrsMatch(source, el, ["src", "width", "height", "alt"])) return el;
    }
  }
  return null;
}

/** First highlighted code element with the same cached text and language. */
export function s07highlightedCodeFor(sections, lang, text) {
  const cache = env().Xz;
  for (let i = 0; i < sections.length; i++) {
    const found = sections[i].el.findAll('code[class*="language-"].is-loaded');
    for (let j = 0; j < found.length; j++) {
      const el = found[j];
      if (text === cache.get(el) && lang === s07highlightedLang(el)) return el;
    }
  }
  return null;
}

/** First fully loaded image with the same src; copies size/alt attributes onto it. */
export function s07imageFor(sections, url, source) {
  for (let i = 0; i < sections.length; i++) {
    const found = sections[i].el.findAll("img");
    for (let j = 0; j < found.length; j++) {
      const img = found[j];
      if (img.instanceOf(HTMLImageElement) && img.complete && url === img.src) {
        img.setAttr("width", source.getAttr("width"));
        img.setAttr("height", source.getAttr("height"));
        img.setAttr("alt", source.getAttr("alt"));
        return img;
      }
    }
  }
  return null;
}

/** The link target an element points at inside this document, or null. */
export function s07linkHrefFor(el, container) {
  const href = el.getAttr("data-href") || el.getAttr("href");
  return href && env().Gz.belongsToMe(el, container) ? href : null;
}
