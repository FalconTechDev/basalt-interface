// g05 clean-room: pointer/selection behaviour of the pdf viewer controller —
// text & annotation highlights, the annotation popup, context menus, the
// selection-range helpers and the mobile copy hook. Attached onto the
// controller prototype by n-g05-pdf-controller.js.
import { hostEnv } from "./env.js";
import { runTransition } from "./animation.js";
import { ng05PdfLib, ng05PdfViewerNs, ng05TextLayerNodeAt, ng05TextOffsetAt } from "./n-g05-pdf-util.js";

function ng05ClosestPage(target) {
  let el = target && target.nodeType === 1 ? target : target && target.parentElement;
  while (el) {
    if (el.hasClass && el.hasClass("page")) return el;
    el = el.parentElement;
  }
  return null;
}

function ng05EventTarget(evt) {
  const t = evt.target;
  return t && t.nodeType === 1 ? t : t && t.parentElement ? t.parentElement : null;
}

function ng05NormalizeSelectionText(text) {
  const lib = ng05PdfLib();
  const viewer = ng05PdfViewerNs();
  let out = String(text || "").replace(/\s*\n\s*/g, " ");
  if (viewer && viewer.removeNullCharacters) out = viewer.removeNullCharacters(out);
  if (lib && lib.normalizeUnicode) out = lib.normalizeUnicode(out);
  return out.trim();
}

function ng05AnnotationData(raw) {
  return raw && raw.data ? raw.data : raw;
}

function ng05IsWidgetOrLink(data) {
  if (!data) return false;
  const subtype = data.subtype;
  if (typeof subtype === "string" && /^(widget|link)$/i.test(subtype)) return true;
  const lib = ng05PdfLib();
  const types = lib && lib.AnnotationType;
  if (types && (data.annotationType === types.WIDGET || data.annotationType === types.LINK)) return true;
  return false;
}

/** Finds the annotation element under a pdf-space point via the page's annotation layer. */
function ng05AnnotationAtPoint(pageView, point) {
  const builder = pageView && pageView.annotationLayer;
  const layer = builder && builder.annotationLayer;
  const fn = (layer && layer.getAnnotationAtPoint) || (builder && builder.getAnnotationAtPoint);
  if (!fn) return null;
  try { return fn.call(layer || builder, point[0], point[1]); } catch (e) { return null; }
}

/** Percentage rect of an annotation data rect against the page viewport view box. */
function ng05AnnotationPercents(pageView, rect) {
  const lib = ng05PdfLib();
  const view = pageView && pageView.viewport && pageView.viewport.view;
  if (!rect || !view) return null;
  const r = lib && lib.Util ? lib.Util.normalizeRect(rect) : rect;
  const w = view[2] - view[0], h = view[3] - view[1];
  if (!(w > 0) || !(h > 0)) return null;
  return {
    left: ((r[0] - view[0]) / w) * 100,
    top: ((view[3] - r[3]) / h) * 100,
    width: ((r[2] - r[0]) / w) * 100,
    height: ((r[3] - r[1]) / h) * 100,
    centerX: (((r[0] + r[2]) / 2 - view[0]) / w) * 100,
    topY: ((view[3] - r[3]) / h) * 100,
  };
}

function ng05AnnotationColor(data) {
  const c = data && data.color;
  if (c && c.length >= 3) return `rgb(${c[0]},${c[1]},${c[2]})`;
  return null;
}

/** Attaches the interaction methods onto the controller prototype. */
export function ng05AttachInteract(proto, host) {

  // ---- text highlight -----------------------------------------------------

  proto.highlightText = function (pageNumber, range) {
    this.clearTextHighlight();
    const pageView = this.getPage(pageNumber);
    const div = pageView && pageView.div;
    if (!div || !div.dataset || !div.dataset.loaded || !range) return;
    const layer = pageView.textLayer;
    const inner = layer && (layer.textLayer || layer);
    const divs = inner && inner.textDivs;
    const items = inner && inner.textContentItems;
    if (!divs || !items) return;
    const [[sDiv, sOff], [eDiv, eOff]] = range;
    if (!(sDiv >= 0 && eDiv < divs.length && sDiv <= eDiv)) return;
    const doc = div.doc || div.ownerDocument;
    const touched = [];
    let first = null;
    for (let i = sDiv; i <= eDiv; i++) {
      const node = divs[i];
      const item = items[i];
      if (!node || !item || typeof item.str !== "string") continue;
      const str = item.str;
      let before = "", sel = "", after = "";
      if (i === sDiv && i === eDiv) {
        before = str.slice(0, sOff); sel = str.slice(sOff, eOff); after = str.slice(eOff);
      } else if (i === sDiv) {
        before = str.slice(0, sOff); sel = str.slice(sOff);
      } else if (i === eDiv) {
        sel = str.slice(0, eOff); after = str.slice(eOff);
      } else {
        sel = str;
      }
      const cls = ["textLayerNode", "mod-focused", "selected"];
      if (i === sDiv) cls.push("begin");
      if (i === eDiv) cls.push("end");
      if (i > sDiv && i < eDiv) cls.push("middle");
      touched.push({ node, str, className: node.className || "" });
      node.className = cls.join(" ");
      node.textContent = "";
      if (before) node.appendChild(doc.createTextNode(before));
      if (sel) {
        const span = doc.createElement("span");
        span.className = "appended selected";
        span.textContent = sel;
        node.appendChild(span);
      }
      if (after) node.appendChild(doc.createTextNode(after));
      if (!first) first = node;
    }
    this.highlightedText = touched;
    if (first) {
      first.scrollIntoView({ block: "start" });
      const vc = this._dom && this._dom.viewerContainerEl;
      if (vc) vc.scrollTop = Math.max(0, vc.scrollTop - 50);
    }
  };

  proto.clearTextHighlight = function () {
    const touched = this.highlightedText;
    this.highlightedText = null;
    if (!touched) return;
    for (const rec of touched) {
      rec.node.textContent = rec.str;
      rec.node.className = rec.className || "";
    }
  };

  // ---- annotation highlight ----------------------------------------------

  proto.highlightAnnotation = function (pageNumber, annotationId) {
    this.clearAnnotationHighlight();
    const pageView = this.getPage(pageNumber);
    if (!pageView || !pageView.div) return;
    const layerEl = pageView.div.querySelector(".annotationLayer");
    if (!layerEl) return;
    const found = (ann) => {
      if (this._destroyed || !ann) return;
      const data = ng05AnnotationData(ann);
      const rect = data && data.rect;
      const pct = rect && ng05AnnotationPercents(pageView, rect);
      if (!pct) return;
      const doc = layerEl.doc || layerEl.ownerDocument;
      const el = doc.createElement("div");
      el.className = "boundingRect mod-focused";
      el.style.position = "absolute";
      el.style.left = pct.left + "%";
      el.style.top = pct.top + "%";
      el.style.width = pct.width + "%";
      el.style.height = pct.height + "%";
      const color = ng05AnnotationColor(data);
      if (color) el.style.setProperty("--annotation-color", color);
      layerEl.appendChild(el);
      this.annotationHighlight = el;
      setTimeout(() => { if (el.isConnected) el.scrollIntoView({ block: "nearest" }); }, 0);
    };
    const inner = pageView.annotationLayer && pageView.annotationLayer.annotationLayer;
    if (inner && inner.getAnnotation) {
      try { found(inner.getAnnotation(annotationId)); return; } catch (e) {}
    }
    if (pageView.pdfPage && pageView.pdfPage.getAnnotations) {
      pageView.pdfPage.getAnnotations().then((list) => {
        const ann = (list || []).find((a) => a && (a.id === annotationId || a.namedDest === annotationId));
        found(ann);
      }).catch(() => {});
    }
  };

  proto.clearAnnotationHighlight = function () {
    const el = this.annotationHighlight;
    this.annotationHighlight = null;
    if (el && el.parentNode) el.parentNode.removeChild(el);
  };

  proto.clearEphemeralUI = function () {
    this.destroyAnnotationPopup();
    this.clearAnnotationHighlight();
    this.clearTextHighlight();
    this.subpathHighlight = null;
  };

  // ---- annotated text -----------------------------------------------------

  proto.getTextByRect = function (pageView, rect) {
    const layer = pageView && pageView.textLayer;
    const items = layer && layer.textContentItems;
    if (!items || !rect) return "";
    const [x1, y1, x2, y2] = rect;
    let out = "";
    for (const item of items) {
      const chars = item.chars || [];
      for (const ch of chars) {
        const r = ch.r || ch.rect;
        if (!r) continue;
        const cx = (r[0] + r[2]) / 2;
        const cy = (r[1] + r[3]) / 2;
        if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) {
          out += ch.u != null ? ch.u : (ch.unicode || "");
        }
      }
    }
    return out;
  };

  proto.getAnnotatedText = function (pageView, annotationId) {
    if (!pageView || !pageView.pdfPage) return Promise.resolve(null);
    const layer = pageView.textLayer;
    const ready = layer && layer.renderingTask && layer.renderingTask.promise
      ? layer.renderingTask.promise.catch(() => {})
      : Promise.resolve();
    return Promise.all([ready, pageView.pdfPage.getAnnotations()]).then(([, annotations]) => {
      const ann = (annotations || []).find((a) => a && (a.id === annotationId || a.namedDest === annotationId));
      const qp = ann && ann.quadPoints;
      if (!qp || !qp.length) return null;
      const chunks = [];
      for (let i = 0; i + 8 <= qp.length; i += 8) {
        const q = qp.slice(i, i + 8);
        const xs = [q[0], q[2], q[4], q[6]];
        const ys = [q[1], q[3], q[5], q[7]];
        const rect = [Math.min.apply(null, xs), Math.min.apply(null, ys),
          Math.max.apply(null, xs), Math.max.apply(null, ys)];
        const text = this.getTextByRect(pageView, rect).replace(/\s+/g, " ").trim();
        if (text) chunks.push(text);
      }
      const out = chunks.join(" ").trim();
      return out || null;
    }).catch(() => null);
  };

  // ---- annotation popup ---------------------------------------------------

  proto.renderAnnotationPopup = function ({ layer, data, parent }) {
    this.destroyAnnotationPopup();
    const doc = layer.doc || layer.ownerDocument;
    const popup = createDiv("popup");
    const content = popup.createDiv("popupContent");
    const lines = String(data.contents || "").split("\n");
    lines.forEach((line, i) => {
      if (i) content.appendChild(doc.createElement("br"));
      content.appendChild(doc.createTextNode(line));
    });
    if (data.dir) content.setAttribute("dir", data.dir);
    const meta = popup.createDiv("popupMeta");
    if (data.titleObj) meta.createDiv("popupTitle").setText(data.titleObj);
    if (data.modificationDate) {
      const lib = ng05PdfLib();
      const date = lib && lib.PDFDateString && lib.PDFDateString.toDateObject(data.modificationDate);
      if (date) meta.createDiv("popupDate").setText(`${date.toLocaleDateString()}, ${date.toLocaleTimeString()}`);
    }
    const pageNumber = parent && parent.dataset ? parseInt(parent.dataset.pageNumber, 10) : NaN;
    const pageView = Number.isFinite(pageNumber) ? this.getPage(pageNumber) : null;
    if (pageView) {
      const copyEl = meta.createDiv("popup-copy clickable-icon");
      host.setIcon(copyEl, "lucide-copy");
      host.setTooltip(copyEl, host.t.interface.menu.copy());
      copyEl.addEventListener("click", () => {
        const annId = data.id;
        Promise.resolve(this.getAnnotatedText(pageView, annId)).then((annotated) => {
          const parts = [];
          if (annotated) parts.push("> " + annotated);
          parts.push(this.getMarkdownLink(`#page=${pageNumber}&annotation=${annId}`, this.getPageLinkAlias(pageNumber), false));
          if (data.contents) parts.push(String(data.contents));
          return navigator.clipboard.writeText(parts.join("\n\n"));
        }).then(() => {
          host.setIcon(copyEl, "lucide-check");
          setTimeout(() => host.setIcon(copyEl, "lucide-copy"), 1500);
        }).catch(() => {});
      });
    }

    if (host.Platform.isPhone) {
      const modal = new host.Modal();
      modal.modalEl.addClass("pdf-annotation-modal");
      modal.contentEl.appendChild(popup);
      modal.containerEl.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
      this._annotationModal = modal;
      this.activeAnnotationPopupEl = popup;
      setTimeout(() => { try { modal.open(); } catch (e) {} }, 20);
      return;
    }

    const wrapper = doc.createElement("div");
    wrapper.className = "popupWrapper";
    wrapper.dataset.annotationId = String(data.id || "");
    const color = ng05AnnotationColor(data);
    if (color) wrapper.style.setProperty("--annotation-color", color);
    const pct = pageView && data.rect ? ng05AnnotationPercents(pageView, data.rect) : null;
    wrapper.style.left = (pct ? pct.centerX : 50) + "%";
    wrapper.style.top = (pct ? pct.topY : 0) + "%";
    wrapper.appendChild(popup);
    layer.appendChild(wrapper);
    const spec = new host.Transition({ duration: 200, fn: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
    spec.addProp("transform", "translate(-50%,-1px) scale(0.97)", "translate(-50%,0) scale(1)", "translate(-50%,0)");
    spec.addProp("opacity", "0", "1", "1");
    runTransition(wrapper, spec);
    this.activeAnnotationPopupEl = wrapper;
    const vc = this._dom && this._dom.viewerContainerEl;
    const viewerRect = vc && vc.getBoundingClientRect ? vc.getBoundingClientRect() : null;
    const pr = wrapper.getBoundingClientRect ? wrapper.getBoundingClientRect() : null;
    if (viewerRect && pr && (pr.top < viewerRect.top || pr.bottom > viewerRect.bottom
      || pr.left < viewerRect.left || pr.right > viewerRect.right)) {
      wrapper.scrollIntoView({ block: "nearest" });
    }
  };

  proto.destroyAnnotationPopup = function () {
    const modal = this._annotationModal;
    this._annotationModal = null;
    if (modal) { try { modal.close(); } catch (e) {} }
    const el = this.activeAnnotationPopupEl;
    this.activeAnnotationPopupEl = null;
    if (!el || !el.parentNode) return;
    const spec = new host.Transition({ duration: 150, fn: "ease-in" });
    spec.addProp("transform", "translate(-50%,0) scale(1)", "translate(-50%,0) scale(0.9)", "translate(-50%,0) scale(0.9)");
    spec.addProp("opacity", "1", "0", "0");
    runTransition(el, spec, () => { if (el.parentNode) el.parentNode.removeChild(el); });
  };

  // ---- pointer interaction -----------------------------------------------

  proto._resolveAnnotationAt = function (pageNumber, pageView, evt) {
    if (!pageView || !pageView.getPagePointFromEvent) return null;
    let point;
    try { point = pageView.getPagePointFromEvent(evt); } catch (e) { return null; }
    return ng05AnnotationAtPoint(pageView, point);
  };

  proto.onAnnotationPointerDown = function (evt) {
    if (!evt || evt.button !== 0 || hostEnv().Kl(evt)) return;
    const target = ng05EventTarget(evt);
    const popup = this.activeAnnotationPopupEl;
    if (popup && target && popup.contains(target)) return;
    const pageEl = ng05ClosestPage(target);
    const pageNumber = pageEl && parseInt(pageEl.dataset.pageNumber, 10);
    if (!pageEl || !Number.isFinite(pageNumber)) {
      this.clearEphemeralUI();
      return;
    }
    const view = evt.view || (evt.target && evt.target.win) || window;
    const startX = evt.clientX, startY = evt.clientY, pointerId = evt.pointerId;
    let dragged = false;
    const onMove = (e) => {
      if (e.pointerId === pointerId
        && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 5) dragged = true;
    };
    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("pointerup", onUp);
      view.removeEventListener("pointercancel", onUp);
      this.clearEphemeralUI();
      if (dragged) return;
      const pageView = this.getPage(pageNumber);
      const raw = this._resolveAnnotationAt(pageNumber, pageView, e);
      const data = raw && ng05AnnotationData(raw);
      if (!data || ng05IsWidgetOrLink(data)) return;
      const annId = data.id;
      if (this.activeAnnotationPopupEl
        && this.activeAnnotationPopupEl.dataset
        && this.activeAnnotationPopupEl.dataset.annotationId === String(annId)) return;
      const layerEl = pageView.div && pageView.div.querySelector(".annotationLayer");
      if (!layerEl) return;
      this.renderAnnotationPopup({ layer: layerEl, data, parent: pageEl });
    };
    view.addEventListener("pointermove", onMove);
    view.addEventListener("pointerup", onUp);
    view.addEventListener("pointercancel", onUp);
  };

  // ---- context menus ------------------------------------------------------

  proto.getTextSelectionRangeStr = function (root) {
    const win = root && root.win ? root.win : window;
    const selection = win.getSelection && win.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return null;
    const sEl = ng05TextLayerNodeAt(root, range.startContainer);
    const eEl = ng05TextLayerNodeAt(root, range.endContainer);
    if (!sEl || !eEl) return null;
    const sIdx = parseInt(sEl.dataset.idx, 10);
    const eIdx = parseInt(eEl.dataset.idx, 10);
    if (!Number.isFinite(sIdx) || !Number.isFinite(eIdx)) return null;
    const sOff = ng05TextOffsetAt(root, range.startContainer, range.startOffset);
    const eOff = ng05TextOffsetAt(root, range.endContainer, range.endOffset);
    if (sOff === null || eOff === null) return null;
    return `${sIdx},${sOff},${eIdx},${eOff}`;
  };

  proto.getPageLinkAlias = function (pageNumber) {
    return `${this.file.basename}, ${host.t.pdf.labelPage({ page: pageNumber })}`;
  };

  proto._copyText = function (text, contents) {
    if (contents && contents.copy) { contents.copy(); return; }
    const nav = (window.navigator && window.navigator.clipboard) || null;
    if (nav) nav.writeText(text).catch(() => {});
  };

  proto.onContextMenu = async function (evt) {
    if (!host.Platform.isDesktopApp) return;
    const pageEl = ng05ClosestPage(ng05EventTarget(evt));
    const pageNumber = pageEl && parseInt(pageEl.dataset.pageNumber, 10);
    if (!pageEl || !Number.isFinite(pageNumber)) return;
    const win = evt.win || (evt.target && evt.target.win) || window;
    const electron = win.electron || null;
    let contents = null;
    let editFlags = null;
    if (evt.isTrusted && electron) {
      const info = await host.electronMenuInfo(evt);
      if (!info || evt.defaultPrevented) return;
      editFlags = info.editFlags || null;
      try { contents = electron.remote.webContents.fromId(info.webContentsId); } catch (e) { contents = null; }
    }
    const rawSelection = win.getSelection ? win.getSelection().toString() : "";
    const selected = ng05NormalizeSelectionText(rawSelection.replace(/\n/g, " "));
    const canCopy = !editFlags || editFlags.canCopy !== false;
    const rangeStr = this.getTextSelectionRangeStr(pageEl);
    const pageView = this.getPage(pageNumber);
    const annRaw = pageView ? this._resolveAnnotationAt(pageNumber, pageView, evt) : null;
    const annData = annRaw && ng05AnnotationData(annRaw);
    const annUsable = annData && !ng05IsWidgetOrLink(annData) ? annData : null;

    this.clearEphemeralUI();
    const menu = new host.Menu();
    menu.addSections(["action", "selection", "annotation"]);

    if (host.Platform.isMacOS && electron && contents && selected) {
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(host.t.interface.menu.lookupSelection({ selection: host.truncateText(selected, 25) }))
        .setIcon("lucide-library")
        .onClick(() => { menu.hide(); contents.showDefinitionForSelection(); }));
    }
    if (selected) {
      menu.addItem((item) => item
        .setSection("selection")
        .setTitle(host.t.interface.menu.copy())
        .setIcon("lucide-copy")
        .setDisabled(!canCopy)
        .onClick(() => { menu.hide(); this._copyText(rawSelection, contents); }));
    }
    if (rangeStr && selected) {
      const link = this.getMarkdownLink(`#page=${pageNumber}&selection=${rangeStr}`, this.getPageLinkAlias(pageNumber), false);
      menu.addItem((item) => item
        .setSection("selection")
        .setTitle(host.t.pdf.actionCopyQuote())
        .setIcon("lucide-copy")
        .onClick(() => { menu.hide(); this._copyText(`> ${selected}\n\n${link}`, contents); }));
      menu.addItem((item) => item
        .setSection("selection")
        .setTitle(host.t.pdf.actionCopySelectionLink())
        .setIcon("lucide-copy")
        .onClick(() => { menu.hide(); this._copyText(link, contents); }));
    }
    if (annUsable) {
      const annId = annUsable.id;
      const link = this.getMarkdownLink(`#page=${pageNumber}&annotation=${annId}`, this.getPageLinkAlias(pageNumber), false);
      const annotated = pageView ? await this.getAnnotatedText(pageView, annId) : null;
      if (annotated) {
        menu.addItem((item) => item
          .setSection("annotation")
          .setTitle(host.t.pdf.actionCopyAnnotation())
          .setIcon("lucide-copy")
          .onClick(() => { menu.hide(); this._copyText(`> ${annotated}\n\n${link}`, contents); }));
      }
      menu.addItem((item) => item
        .setSection("annotation")
        .setTitle(host.t.pdf.actionCopyAnnotLink())
        .setIcon("lucide-copy")
        .onClick(() => { menu.hide(); this._copyText(link, contents); }));
    }
    menu.showAtMouseEvent(evt);
    if (this.opts.isEmbed || !contents) evt.preventDefault();
  };

  proto.onThumbnailContextMenu = function (evt) {
    let thumb = ng05EventTarget(evt);
    while (thumb) {
      if (thumb.hasClass && thumb.hasClass("thumbnail")) break;
      thumb = thumb.parentElement;
    }
    const pageNumber = thumb && thumb.dataset ? parseInt(thumb.dataset.pageNumber, 10) : NaN;
    if (!thumb || !Number.isFinite(pageNumber)) return;
    const menu = new host.Menu();
    menu.addSections(["action"]);
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(host.t.pdf.actionCopyPageLink({ page: pageNumber }))
      .setIcon("lucide-copy")
      .onClick(() => {
        menu.hide();
        navigator.clipboard.writeText(this.getMarkdownLink(`#page=${pageNumber}`)).catch(() => {});
      }));
    menu.showAtMouseEvent(evt);
  };

  proto.onMobileCopy = function (evt) {
    if (!host.Platform.isMobile) return;
    const target = ng05EventTarget(evt);
    const pageEl = ng05ClosestPage(target);
    if (!pageEl) return;
    const layerEl = target && target.closest ? target.closest(".textLayer") : null;
    if (!layerEl || !pageEl.contains(layerEl)) return;
    const pageNumber = parseInt(pageEl.dataset.pageNumber, 10);
    if (!Number.isFinite(pageNumber)) return;
    const rangeStr = this.getTextSelectionRangeStr(pageEl);
    if (!rangeStr) return;
    const text = evt.clipboardData ? String(evt.clipboardData.getData("text/plain") || "") : "";
    const link = this.getMarkdownLink(`#page=${pageNumber}&selection=${rangeStr}`, this.getPageLinkAlias(pageNumber), false);
    if (evt.clipboardData) {
      evt.clipboardData.setData("text/plain", `> ${text}\n\n${link}`);
      evt.preventDefault();
    }
  };
}
