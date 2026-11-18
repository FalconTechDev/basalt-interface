// s22 slice: lazy third-party script loaders (pdf.js, CodeMirror modes, mermaid,
// prism, MathJax) and the small promise getters / MathJax render helpers that go with them.
// The loaders delegate to the app's own script loader (`Hv`); the returned objects keep
// the same `{ promise }` shape the inherited code expects.
import { env } from "./env.js";

const s22Hv = () => env().Hv;
const s22Jl = () => env().Jl;

// ---- pdf.js ----
let s22PdfLib = null;
export function s22LoadPdfLib() {
  if (!s22PdfLib) {
    s22PdfLib = s22Hv()("/lib/pdfjs/pdf.min.mjs", {
      type: "module",
      after: () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/lib/pdfjs/pdf.worker.min.mjs";
        s22Jl()(window, "pdfjsLib");
        s22Jl()(window.pdfjsLib.GlobalWorkerOptions, "workerSrc");
      },
    });
  }
  return s22PdfLib;
}

let s22PdfViewerLib = null;
export function s22LoadPdfViewer() {
  if (!s22PdfViewerLib) {
    s22PdfViewerLib = s22Hv()("/lib/pdfjs/pdf.viewer.min.mjs", {
      type: "module",
      after: () => s22Jl()(window, "pdfjsViewer"),
    });
  }
  return s22PdfViewerLib;
}

export async function s22LoadPdfJs() {
  await s22LoadPdfLib().promise;
  return window.pdfjsLib;
}

export async function s22LoadPdfViewerJs() {
  await s22LoadPdfLib().promise;
  await s22LoadPdfViewer().promise;
  return window.pdfjsViewer;
}

// ---- CodeMirror legacy modes ----
let s22CodeMirrorModes = null;
export function s22LoadCodeMirrorModes() {
  if (!s22CodeMirrorModes) s22CodeMirrorModes = s22Hv()("/lib/codemirror/modes.min.js");
  return s22CodeMirrorModes;
}

// ---- mermaid ----
let s22MermaidLib = null;
export function s22LoadMermaidLib() {
  if (!s22MermaidLib) {
    s22MermaidLib = s22Hv()("/lib/mermaid.min.js", {
      after: () => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          themeVariables: { fontFamily: "var(--font-mermaid)" },
          flowchart: { useMaxWidth: false },
          sequence: { useMaxWidth: false },
          gantt: { useMaxWidth: true, axisFormatter: [["%Y-%m-%d", (d) => d.getDay() === 1]] },
          journey: { useMaxWidth: true },
          class: { useMaxWidth: true },
          git: { useMaxWidth: false },
          state: { useMaxWidth: true },
          er: { useMaxWidth: false },
          pie: { useMaxWidth: true },
        });
      },
    });
  }
  return s22MermaidLib;
}

export async function s22LoadMermaid() {
  await s22LoadMermaidLib().promise;
  return mermaid;
}

// ---- prism ----
let s22PrismLib = null;
export function s22LoadPrismLib() {
  if (!s22PrismLib) {
    s22PrismLib = s22Hv()("/lib/prism.min.js", {
      before: () => {
        window.Prism = window.Prism || {};
        window.Prism.manual = true;
      },
    });
  }
  return s22PrismLib;
}

export async function s22LoadPrism() {
  await s22LoadPrismLib().promise;
  return Prism;
}

// ---- MathJax ----
let s22MathJaxLib = null;
export function s22LoadMathJaxLib() {
  if (!s22MathJaxLib) {
    s22MathJaxLib = s22Hv()("/lib/mathjax/tex-chtml-full.js", {
      before: () => {
        window.MathJax = {
          tex: {
            inlineMath: [],
            displayMath: [],
            processEscapes: false,
            processEnvironments: false,
            processRefs: false,
          },
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
    });
  }
  return s22MathJaxLib;
}

export async function s22LoadMathJax() {
  await s22LoadMathJaxLib().promise;
}

// TeX -> MathML/CHTML conversion used by the math post-processor.
export function s22RenderMath(tex, display) {
  return MathJax.tex2chtml(tex, { display });
}

// App-scope state mirrored for the MathJax stylesheet flush (Cz/Ez/Mz in the bundle).
export const s22MathJaxDeferred = null;
export const s22MathJaxTimer = 0;
export const s22MathJaxSheet = null;
export const s22WeakKeySeed = 0;

// ---- stylesheet change broadcast (forces a repaint of math output) ----
// State lives in the app-scope vars Cz/Ez/Mz (bound through envBind) so the
// deferred flush sees the same values the rest of the bundle would.
function s22MathState() { return env(); }

export function s22FlushMathStyles() {
  const st = s22MathState();
  const sheet = MathJax.chtmlStylesheet();
  if (!st.Mz || sheet !== st.Mz) {
    if (st.Mz) st.Mz.detach();
    st.Mz = sheet;
    document.head.appendChild(sheet);
  }
  st.Mz.dataset.change = st.Mz.dataset.change === "1" ? "2" : "1";
  st.Cz.resolve();
  st.Cz = null;
}

export function s22ScheduleMathFlush() {
  const st = s22MathState();
  if (!st.Cz) st.Cz = env().gb();
  clearTimeout(st.Ez);
  st.Ez = window.setTimeout(s22FlushMathStyles, 100);
  return st.Cz.promise;
}
