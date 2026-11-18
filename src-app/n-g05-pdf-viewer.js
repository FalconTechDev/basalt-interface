// g05 clean-room: the manifest-facing factories for the pdf viewer classes.
// Each factory memoises its class per host so `instanceof` stays stable across
// callers; cross-class lookups go through ng05PdfKitGet and resolve lazily.
import { ng05BuildPasswordDialog, ng05BuildToolbar } from "./n-g05-pdf-dialog.js";
import { ng05BuildController } from "./n-g05-pdf-controller.js";
import { ng05BuildComponent, ng05BuildView, ng05BuildEmbed } from "./n-g05-pdf-component.js";

const ng05Kit = new WeakMap(); // host -> { key: class }

/** Lazily builds (once per host) and returns a named class from the kit. */
export function ng05PdfKitGet(host, key, build) {
  let slot = ng05Kit.get(host);
  if (!slot) ng05Kit.set(host, slot = {});
  return slot[key] || (slot[key] = build());
}

export function ng05PdfPasswordDialogClass(host) {
  return ng05PdfKitGet(host, "password", () => ng05BuildPasswordDialog(host));
}
export function ng05PdfToolbarClass(host) {
  return ng05PdfKitGet(host, "toolbar", () => ng05BuildToolbar(host));
}
// pdf.js warm-up: fetch each module and import it through a blob URL (the
// app:// protocol serves no JS MIME type for module scripts). This sets
// globalThis.pdfjsLib / globalThis.pdfjsViewer without touching the app's
// script loader, whose first attempt can hang and stay pending — and whose
// re-import would clobber the namespace the viewer module already bound.
let ng05Warming = false;
let ng05WorkerBlob = null;
let ng05WorkerBlobP = null;
function ng05PdfJsReady() {
  return !!(typeof window !== "undefined" && window.pdfjsLib && window.pdfjsViewer);
}
/**
 * The app:// protocol serves every file without a JS MIME type, so pdf.js can
 * never load "/lib/pdfjs/pdf.worker.min.js" (the configured workerSrc) as a
 * module worker — and its fake-worker fallback `import()` of the same URL
 * fails the same way, permanently poisoning the page after the first failure.
 * A blob: URL carrying the worker module source loads fine both as a module
 * worker and via dynamic import(), so we hand pdf.js that instead.
 */
export function ng05EnsureWorkerBlob() {
  if (ng05WorkerBlob) return Promise.resolve(ng05WorkerBlob);
  if (!ng05WorkerBlobP) {
    ng05WorkerBlobP = fetch("/lib/pdfjs/pdf.worker.min.mjs")
      .then((r) => r.text())
      .then((text) => (ng05WorkerBlob = URL.createObjectURL(new Blob([text], { type: "text/javascript" }))))
      .catch(() => null);
  }
  return ng05WorkerBlobP;
}
function ng05WarmPdfJs() {
  if (ng05Warming || ng05PdfJsReady() || typeof window === "undefined") return;
  ng05Warming = true;
  ng05EnsureWorkerBlob();
  const load = (src) => fetch(src)
    .then((r) => r.text())
    .then((text) => import(URL.createObjectURL(new Blob([text], { type: "text/javascript" }))));
  const first = window.pdfjsLib
    ? Promise.resolve()
    : load("/lib/pdfjs/pdf.min.mjs").then(() => {
        if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/lib/pdfjs/pdf.worker.min.mjs";
        }
      });
  first
    .then(() => (window.pdfjsViewer ? null : load("/lib/pdfjs/pdf.viewer.min.mjs")))
    .catch(() => {})
    .finally(() => { ng05Warming = false; });
}
/** Resolves true once both pdf.js namespaces are global (kicks the warm-up). */
export function ng05EnsurePdfJs(timeoutMs) {
  return new Promise((resolve) => {
    const limit = timeoutMs || 30000;
    const t0 = Date.now();
    const tick = () => {
      try {
        if (ng05PdfJsReady()) return resolve(true);
        if (typeof document !== "undefined" && document.readyState === "complete") ng05WarmPdfJs();
        if (Date.now() - t0 > limit) return resolve(false);
      } catch (e) {}
      setTimeout(tick, 200);
    };
    tick();
  });
}

export function ng05PdfViewerClass(host) {
  // start immediately: fetch+import does not need the DOM, and finishing
  // before the first document opens keeps the cold-start render deterministic
  ng05WarmPdfJs();
  const poll = setInterval(() => {
    try {
      if (ng05PdfJsReady()) { clearInterval(poll); clearTimeout(fallback); return; }
      ng05WarmPdfJs();
    } catch (e) {}
  }, 1000);
  const fallback = setTimeout(() => clearInterval(poll), 120000);
  if (typeof window === "undefined" || typeof document === "undefined") { clearInterval(poll); clearTimeout(fallback); }
  return ng05PdfKitGet(host, "controller", () => ng05BuildController(host));
}
export function ng05PdfComponentClass(host) {
  return ng05PdfKitGet(host, "component", () => ng05BuildComponent(host));
}
export function ng05PdfViewClass(host) {
  return ng05PdfKitGet(host, "view", () => ng05BuildView(host));
}
export function ng05PdfEmbedClass(host) {
  return ng05PdfKitGet(host, "embed", () => ng05BuildEmbed(host));
}
