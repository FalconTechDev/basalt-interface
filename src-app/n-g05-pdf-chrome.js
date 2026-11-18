// g05 clean-room: the pdf.js "chrome" layer — viewer config, find bar,
// localization adapter and the outline tree — plus the unreachable duplicate
// generation of the Part A classes that the module surface still exports.
//
// The live chrome delegates to the s26 slice's clean-room implementations;
// the l10n adapter is written here because the contract adds getDirection().
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { s26PdfFindBar, s26PdfOutlineItem, s26PdfOutlineTree } from "./s26-pdf.js";
import { ng05BuildPasswordDialog, ng05BuildToolbar } from "./n-g05-pdf-dialog.js";
import { ng05PdfViewerClass, ng05PdfComponentClass, ng05PdfViewClass, ng05PdfEmbedClass, ng05PdfKitGet } from "./n-g05-pdf-viewer.js";

/** `TZ` — base configuration handed to `pdfjsViewer.createObsidianPDFViewer`. */
export const ng05PdfViewerConfig = {
  enableScripting: false,
  externalLinkTarget: 2,
  imageResourcesPath: "/lib/pdfjs/images/",
  maxCanvasPixels: 16747216,
  pdfBugEnabled: false,
  sidebarViewOnLoad: 0,
  viewerCssTheme: 0,
  disablePreferences: false,
  disableHistory: true,
  verbosity: 0,
  defaultZoomValue: "page-width",
  cMapPacked: true,
  cMapUrl: "/lib/pdfjs/cmaps/",
  standardFontDataUrl: "/lib/pdfjs/standard_fonts/",
  wasmUrl: "/lib/pdfjs/wasm/",
  iccUrl: "/lib/pdfjs/iccs/",
  workerSrc: "/lib/pdfjs/pdf.worker.min.js",
  defaultUrl: "",
  disableTelemetry: true,
  isEvalSupported: false,
};

/** `PZ` — localStorage key of the persisted find-bar settings. */
export const ng05PdfSearchSettingsKey = "pdfjs-search-settings";
/** localStorage key remembering the themed-pages flag (dead classes only). */
export const ng05PdfIsThemedKey = "pdfjs-is-themed";

/** `OZ` — pdf.js l10n interface over the app string table (`gm.pdf`).
 *  (`s11PdfStrings`/`DZ`/`IZ` are provided by s11-i18n.js.) */
export function ng05PdfLocalization() {
  function PdfLocalization() {}
  const proto = PdfLocalization.prototype;
  proto.getLanguage = function () { return env().sm(); };
  proto.getDirection = function () { return "ltr"; };
  proto.get = function (id, args, fallback) {
    const table = env().gm && env().gm.pdf;
    const entry = table && table[id];
    const value = typeof entry === "function" ? entry(args) : entry;
    return value || fallback;
  };
  proto.translate = function (root) {
    const nodes = root ? Array.from(root.querySelectorAll("*[data-l10n-id]")) : [];
    const table = env().gm && env().gm.pdf;
    for (const node of nodes) {
      const ds = node.dataset;
      const id = ds.l10nId;
      const args = ds.l10nArgs ? JSON.parse(ds.l10nArgs) : null;
      if (id && args && table && typeof table[id] === "function") {
        if (args.attr) node.setAttr(args.attr, table[id](args));
        else node.setText(table[id](args));
      }
    }
  };
  proto.pause = function () {};
  proto.resume = function () {};
  return PdfLocalization;
}

/** `LZ` — the find bar inside the pdf viewer (s26 implementation). */
export function ng05PdfFindBar(host) {
  return s26PdfFindBar(host);
}

/** env()-sourced host shim for the no-argument factories. */
function ng05PdfEnvHost() {
  const map = {
    t: "gm", Platform: "Yl", Menu: "Ug", Component: "jm", Scope: "Ng",
    EditableFileView: "OX", Modal: "tb", Transition: "dl", runTransition: "yl",
    setIcon: "tv", setTooltip: "Mv", truncateText: "gc", createDiv: "createDiv",
    sleep: "sleep", s27PreserveScroll: "cg", pdfExtensions: "qy",
    ImageView: "xZ", AudioView: "MZ", VideoView: "XZ",
    MetadataEditor: "tO", MarkdownPreviewView: "fq", EmbedLoader: "sJ",
    s27DisplayModeEmbed: "dq", s27PdfEmbed: "YZ", s27StopMedia: "Kc",
    Events: "VT", TFile: "$T", Keymap: "Bg", Notice: "fb",
  };
  const shim = {};
  for (const key of Object.keys(map)) {
    const orig = map[key];
    Object.defineProperty(shim, key, { get: () => env()[orig], configurable: true });
  }
  Object.defineProperty(shim, "s27PdfViewerNs", { get: () => globalThis.pdfjsViewer, configurable: true });
  Object.defineProperty(shim, "s27PdfLib", { get: () => globalThis.pdfjsLib, configurable: true });
  Object.defineProperty(shim, "s27PdfConfig", { get: () => ng05PdfViewerConfig, configurable: true });
  Object.defineProperty(shim, "s27PdfL10n", { get: () => ng05PdfLocalization(), configurable: true });
  Object.defineProperty(shim, "electronMenuInfo", { get: () => env().Gf, configurable: true });
  return shim;
}

/** `FZ` — one outline row (s26 implementation via the env host shim). */
export function ng05PdfOutlineItem() {
  return s26PdfOutlineItem(ng05PdfEnvHost());
}

/** `NZ` — the outline tree (s26 implementation via the env host shim). */
export function ng05PdfOutlineTree() {
  return s26PdfOutlineTree(ng05PdfEnvHost());
}

// ---- dead duplicate generation (never instantiated by the bundle) ---------

/** dead duplicate of `BZ` — same password prompt, env-sourced strings. */
export function ng05PdfPasswordPrompt() {
  return ng05BuildPasswordDialog(ng05PdfEnvHost());
}

/** dead duplicate of `HZ` — the compact toolbar layout (no `.pdf-toolbar-left`
 *  wrapper around the zoom/page cluster). */
export function ng05PdfToolbar(host) {
  const Live = ng05PdfKitGet(host, "toolbar", () => ng05BuildToolbar(host));
  function DeadPdfToolbar(app, containerEl, viewer) {
    Live.call(this, app, containerEl, viewer, true);
  }
  inherit(DeadPdfToolbar, Live);
  return DeadPdfToolbar;
}

/** dead duplicate of `_Z` — the viewer controller. */
export function ng05PdfViewerComponent(host) {
  return ng05PdfViewerClass(host);
}

/** dead duplicate of `GZ` — the lazy viewer wrapper. */
export function ng05PdfLazyViewer(host) {
  return ng05PdfComponentClass(host);
}

/** dead duplicate of `KZ` — the pdf file view. */
export function ng05PdfView(host) {
  return ng05PdfViewClass(host);
}

/** dead duplicate of `YZ` — the pdf embed. */
export function ng05PdfEmbedView(host) {
  return ng05PdfEmbedClass(host);
}
