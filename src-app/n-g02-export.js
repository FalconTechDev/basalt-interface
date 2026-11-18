// g02 export layer: viewport screenshot and tiled high-resolution PNG export.
// Installed onto CanvasController.prototype by n-g02-canvas.js.
import { env } from "./env.js";
import { point, box, boxOfRect, boxUnion, boxGrow } from "./misc.js";
import { s13CanvasI18n } from "./s13-consts.js";

const NG02_HD_MAX_TILES = 40;

function ng02InstallExport(proto, host) {
  proto.takeScreenshot = async function (filePath, garbleText) {
    const ti = s13CanvasI18n();
    void ti;
    const win = this.canvasEl.win;
    this.wrapperEl.addClass("is-screenshotting");
    if (garbleText) this.wrapperEl.addClass("is-text-garbled");
    this.deselectAll();
    const statusBar = this.app.statusBar && this.app.statusBar.containerEl;
    if (statusBar) statusBar.hide();
    try {
      await env().sleep(10);
      await new Promise((resolve) => win.requestAnimationFrame(resolve));
      const boxes = [...this.nodes.values()].map((n) => boxOfRect(n.rect));
      if (boxes.length === 0) return;
      const b = boxUnion(boxes);
      const corners = [
        this.domFromPos(point(b.minX, b.minY)),
        this.domFromPos(point(b.maxX, b.minY)),
        this.domFromPos(point(b.minX, b.maxY)),
        this.domFromPos(point(b.maxX, b.maxY)),
      ];
      const r = this.canvasRect;
      const wrap = this.wrapperEl.getBoundingClientRect();
      let x0 = Math.min(...corners.map((c) => c.x)) + r.cx - 10;
      let y0 = Math.min(...corners.map((c) => c.y)) + r.cy - 10;
      let x1 = Math.max(...corners.map((c) => c.x)) + r.cx + 10;
      let y1 = Math.max(...corners.map((c) => c.y)) + r.cy + 10;
      x0 = Math.max(0, Math.round(x0));
      y0 = Math.max(0, Math.round(y0));
      x1 = Math.min(wrap.width, Math.round(x1));
      y1 = Math.min(wrap.height, Math.round(y1));
      if (x1 <= x0 || y1 <= y0) return;
      const rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      const contents = env().electron.remote.getCurrentWebContents();
      const image = await contents.capturePage(rect);
      const bytes = host.s32BufferFrom(await image.toPNG());
      const fs = env().electron.remote.require("original-fs");
      await fs.promises.writeFile(filePath, bytes);
      const notice = new host.Notice(filePath, 10000);
      if (notice && notice.noticeEl) {
        const btn = notice.noticeEl.createEl("button", { cls: "mod-cta" });
        btn.setText(s13CanvasI18n().actionShowInFolder ? s13CanvasI18n().actionShowInFolder() : "Show in folder");
        btn.addEventListener("click", () => host.s32ShowInFolder(filePath));
      }
    } finally {
      if (statusBar) statusBar.show();
      this.wrapperEl.removeClass("is-screenshotting");
      this.wrapperEl.removeClass("is-text-garbled");
    }
  };

  proto.generateHDImage = async function () {
    const ti = s13CanvasI18n();
    if (this.nodes.size === 0) {
      new host.Notice(ti.msgExportFailedEmptyCanvas());
      return;
    }
    const win = this.canvasEl.win;
    const file = this.view.file;
    const dpr = win.devicePixelRatio || 1;
    const zoomLevel = this.zoom;
    let scale = Math.round((dpr / Math.pow(1.2, zoomLevel)) * 1e5) / 1e5;

    let bounds = boxUnion([...this.nodes.values()].map((n) => boxOfRect(n.rect)));
    const ink = window.__fpInkBoxes ? window.__fpInkBoxes(this) : null;
    if (ink && ink.length) {
      for (const ib of ink) bounds = boxUnion([bounds, ib]);
    }
    bounds = boxGrow(bounds, 100 + 160 / Math.max(0.15, scale));
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    const maxZoom = Math.min(4, 16284 / scale / bw, 16284 / scale / bh);
    let zoomFactor = Math.min(2, maxZoom);

    const modal = new (env().tb)(this.app);
    modal.modalEl.addClass("mod-narrow");
    modal.setTitle(ti.actionExportPng());
    modal.contentEl.createDiv({ cls: "setting-item-description", text: ti.labelExportPngDesc({ title: file ? file.basename : "" }) });

    const content = modal.contentEl;
    let frameValue = "full";
    let privacyMode = false;
    let showLogo = true;
    let frameSetting = null;
    let zoomSetting = null;
    let logoSetting = null;
    let privacySetting = null;

    const syncFrameVisibility = () => {
      const isViewport = frameValue === "viewport";
      if (zoomSetting) zoomSetting.settingEl.toggle(!isViewport);
      if (logoSetting) logoSetting.settingEl.toggle(!isViewport);
      if (privacySetting) privacySetting.settingEl.toggle(!isViewport);
    };

    const Setting = env().zk;
    const mkSetting = () => new Setting(content).setClass("canvas-export-setting");

    frameSetting = mkSetting().setName(ti.optionExportPngFrame()).setDesc(ti.optionExportPngFrameDesc());
    frameSetting.addDropdown((dd) => dd
      .addOption("full", ti.optionExportPngFrameFull())
      .addOption("viewport", ti.optionExportPngFrameViewport())
      .setValue(frameValue)
      .onChange((v) => { frameValue = v; syncFrameVisibility(); }));

    zoomSetting = mkSetting().setName(ti.optionExportPngZoom()).setDesc(ti.optionExportPngZoomDesc());
    const zoomSlider = zoomSetting.addSlider((sl) => {
      const min = Math.min(-1, Math.log2(maxZoom));
      const max = Math.log2(maxZoom);
      sl.setLimits(min, max, 0.01)
        .setValue(Math.log2(zoomFactor))
        .setDynamicTooltip()
        .onChange((v) => {
          zoomFactor = Math.pow(2, v);
          const w = Math.round(bw * scale * zoomFactor);
          const h = Math.round(bh * scale * zoomFactor);
          zoomSetting.setDesc(ti.labelExportPngDimensions({ width: w, height: h }));
        });
      const w = Math.round(bw * scale * zoomFactor);
      const h = Math.round(bh * scale * zoomFactor);
      zoomSetting.setDesc(ti.labelExportPngDimensions({ width: w, height: h }));
    });
    void zoomSlider;

    logoSetting = mkSetting().setName(ti.optionExportPngShowLogo()).setDesc(ti.optionExportPngShowLogoDesc());
    logoSetting.addToggle((t) => t.setValue(showLogo).onChange((v) => { showLogo = v; }));

    privacySetting = mkSetting().setName(ti.optionExportPngPrivacyMode()).setDesc(ti.optionExportPngPrivacyModeDesc());
    privacySetting.addToggle((t) => t.setValue(privacyMode).onChange((v) => { privacyMode = v; }));

    syncFrameVisibility();

    const doExport = async () => {
      modal.close();
      if (frameValue === "viewport") {
        const defaultPath = (file ? file.basename : "canvas") + ".png";
        const picked = await env().electron.remote.dialog.showSaveDialog({
          defaultPath,
          filters: [{ name: "PNG", extensions: ["png"] }, { name: "All files", extensions: ["*"] }],
        });
        const filePath = picked && (picked.filePath || (picked[1] && picked[1]));
        if (!filePath) return;
        await this.takeScreenshot(filePath, privacyMode);
        return;
      }
      await this.exportFullPng(scale * zoomFactor, showLogo, privacyMode, file);
    };

    modal.addButton({
      cls: "mod-cta",
      btnAttrs: { "aria-label": ti.actionExportPng() },
      name: ti.actionExportPng(),
    }).onClick(doExport);
    modal.open();
  };

  /** Full-canvas export: bounds-fitted tiled capture, optional logo/privacy, progress UI. */
  proto.exportFullPng = async function (pxPerUnit, showLogo, privacyMode, file) {
    const ti = s13CanvasI18n();
    const win = this.canvasEl.win;
    const doc = this.canvasEl.doc;
    const electron = env().electron;
    const remote = electron && electron.remote;
    if (!remote) return;

    const boxes = [...this.nodes.values()].map((n) => boxOfRect(n.rect));
    if (boxes.length === 0) return;
    let bounds = boxUnion(boxes);
    const ink = window.__fpInkBoxes ? window.__fpInkBoxes(this) : null;
    if (ink && ink.length) for (const ib of ink) bounds = boxUnion([bounds, ib]);
    bounds = boxGrow(bounds, 100);

    const picked = await remote.dialog.showSaveDialog({
      defaultPath: (file ? file.basename : "canvas") + ".png",
      filters: [{ name: "PNG", extensions: ["png"] }, { name: "All files", extensions: ["*"] }],
    });
    const filePath = picked && (picked.filePath || (picked[1] && picked[1]));
    if (!picked || picked.canceled || !filePath) return;

    // reparent the canvas onto a full-window screenshot stage
    const stage = doc.createElement("div");
    stage.className = "canvas-export-stage";
    stage.style.cssText = "position:fixed;inset:0;z-index:9999;background:var(--background-primary);overflow:hidden;";
    const holder = doc.createElement("div");
    holder.style.cssText = "position:absolute;left:0;top:0;";
    stage.appendChild(holder);
    doc.body.appendChild(stage);

    const wrapper = this.wrapperEl;
    const parent = wrapper.parentNode;
    const nextSibling = wrapper.nextSibling;
    holder.appendChild(wrapper);
    wrapper.style.position = "absolute";
    wrapper.style.left = "0";
    wrapper.style.top = "0";

    const edge = 5;
    const appZoom = win.devicePixelRatio || 1;
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    const vw = Math.ceil(bw * pxPerUnit) + edge * 2;
    const vh = Math.ceil(bh * pxPerUnit) + edge * 2;
    wrapper.style.width = vw + "px";
    wrapper.style.height = vh + "px";

    const prev = { x: this.x, y: this.y, zoom: this.zoom, tx: this.tx, ty: this.ty, tZoom: this.tZoom, scale: this.scale };
    this.screenshotting = true;
    this.viewportChanged = true;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const targetZoom = Math.log2(pxPerUnit);
    this.setViewport(centerX, centerY, targetZoom);
    this.x = centerX;
    this.y = centerY;
    this.zoom = targetZoom;
    this.tZoom = targetZoom;
    this.tx = centerX;
    this.ty = centerY;
    this.scale = Math.pow(2, targetZoom);

    if (privacyMode) wrapper.addClass("is-text-garbled");

    let watermark = null;
    if (showLogo) {
      watermark = doc.createElement("div");
      watermark.className = "canvas-export-watermark";
      watermark.style.cssText = "position:absolute;right:16px;bottom:16px;font-size:14px;color:var(--text-muted);user-select:none;";
      watermark.textContent = "Basalt";
      stage.appendChild(watermark);
    }

    const progress = env().pD.instance;
    try {
      await env().sleep(10);
      await new Promise((r) => win.requestAnimationFrame(r));
      await new Promise((r) => win.requestAnimationFrame(r));

      const tileW = Math.min(4096, vw);
      const tileH = Math.min(4096, vh);
      const cols = Math.ceil(vw / tileW);
      const rows = Math.ceil(vh / tileH);
      const tiles = cols * rows;
      if (tiles > NG02_HD_MAX_TILES) throw new Error("too many tiles");

      progress.show().setMessage(ti.labelExportPngProgress ? ti.labelExportPngProgress() : "Exporting…");
      const contents = remote.getCurrentWebContents();
      const canvas2d = doc.createElement("canvas");
      canvas2d.width = vw;
      canvas2d.height = vh;
      const ctx = canvas2d.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, vw, vh);

      let done = 0;
      for (let ty = 0; ty < vh; ty += tileH) {
        for (let tx = 0; tx < vw; tx += tileW) {
          const rect = { x: tx, y: ty, width: Math.min(tileW, vw - tx), height: Math.min(tileH, vh - ty) };
          const image = await contents.capturePage(rect);
          const blob = await new Promise((res) => image.toBlob(res, "image/png"));
          const bmp = await createImageBitmap(blob);
          ctx.drawImage(bmp, tx, ty);
          done++;
          if (progress && progress.setProgress) progress.setProgress(done / tiles);
        }
      }
      const blob = await new Promise((res) => canvas2d.toBlob(res, "image/png"));
      const buf = host.s32BufferFrom(await blob.arrayBuffer());
      const fs = remote.require("original-fs");
      await fs.promises.writeFile(filePath, buf);
      new host.Notice(filePath, 10000);
    } finally {
      progress.hide();
      if (watermark) watermark.remove();
      wrapper.removeClass("is-text-garbled");
      this.screenshotting = false;
      this.viewportChanged = true;
      // restore wrapper and viewport
      if (parent) {
        if (nextSibling) parent.insertBefore(wrapper, nextSibling);
        else parent.appendChild(wrapper);
      } else {
        holder.remove();
      }
      stage.remove();
      this.setViewport(prev.x, prev.y, prev.zoom);
      this.x = prev.x; this.y = prev.y; this.zoom = prev.zoom;
      this.tx = prev.tx; this.ty = prev.ty; this.tZoom = prev.tZoom; this.scale = prev.scale;
      this.markViewportChanged();
      this.requestFrame();
    }
  };
}
