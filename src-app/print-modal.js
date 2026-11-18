// PrintToPdfModal (G6): the "Export to PDF" dialog. Collects the pdfExportSettings
// (file name, page size, orientation, margins, downscale), asks the OS for a save path,
// renders the note through the markdown pipeline into a hidden popup window and hands
// it to the electron print-to-pdf IPC.
import { inherit } from "./inherit.js";

export function definePrintToPdfModal(host) {
  const strings = () => host.printModalText;

  function PrintToPdfModal(app, file) {
    const self = host.DialogModal.call(this, app) || this;
    self.file = file;
    self.modalEl.addClass("mod-narrow");
    self.titleEl.setText(strings().title());

    const content = self.contentEl;
    content.createEl("p", { cls: "u-muted u-break-word", text: strings().caption({ filename: file.basename }) });

    const settings = app.vault.getConfig("pdfExportSettings");
    new host.Setting(content).setName(strings().settingIncludeFileName()).addToggle((toggle) => {
      toggle.setValue(settings.includeName).then(() => { self.includeName = toggle; });
    });
    new host.Setting(content).setName(strings().settingPageSize()).addDropdown((dropdown) => {
      dropdown.addOption("A3", "A3").addOption("A4", "A4").addOption("A5", "A5")
        .addOption("Legal", "Legal").addOption("Letter", "Letter").addOption("Tabloid", "Tabloid")
        .setValue(settings.pageSize).then(() => { self.pageSize = dropdown; });
    });
    new host.Setting(content).setName(strings().settingLandscape()).addToggle((toggle) => {
      toggle.setValue(settings.landscape).then(() => { self.landscape = toggle; });
    });
    new host.Setting(content).setName(strings().settingMargin()).addDropdown((dropdown) => {
      dropdown.addOption("0", strings().settingMarginDefault())
        .addOption("2", strings().settingMarginMinimal())
        .addOption("1", strings().settingMarginNone())
        .setValue(settings.margin).then(() => { self.marginsType = dropdown; });
    });
    new host.Setting(content).setName(strings().settingDownscalePercent()).addSlider((slider) => {
      slider.setLimits(10, 100, 1).setDynamicTooltip()
        .setValue(settings.downscalePercent).then(() => { self.scaleFactor = slider; });
    });

    const button = self.ctaEl = self.buttonContainerEl.createEl("button", {
      cls: "mod-cta", text: strings().buttonExportToPdf(),
    }, (el) => {
      el.addEventListener("click", () => {
        (async () => {
          button.addClass("mod-loading");
          const config = {
            includeName: self.includeName.getValue(),
            pageSize: self.pageSize.getValue(),
            landscape: self.landscape.getValue(),
            margin: self.marginsType.getValue(),
            downscalePercent: self.scaleFactor.getValue(),
          };
          await app.vault.setConfig("pdfExportSettings", config);
          const options = {};
          options.includeName = config.includeName;
          options.pageSize = config.pageSize;
          options.landscape = config.landscape;
          options.marginsType = parseInt(config.margin);
          if (options.marginsType === 1 || options.marginsType === 2) {
            options.margins = { top: 0, left: 0, bottom: 0, right: 0 };
          }
          options.scaleFactor = config.downscalePercent;
          options.scale = Math.clamp(options.scaleFactor / 100, 0.1, 2);
          options.open = true;
          const result = await host.electronBridge("electron").remote.dialog.showSaveDialog({
            defaultPath: file.basename + ".pdf",
            filters: [{ name: "PDF Files", extensions: ["pdf"] }, { name: "All Files", extensions: ["*"] }],
            properties: ["showOverwriteConfirmation"],
          });
          button.removeClass("mod-loading");
          if (result.canceled || !result.filePath) return;
          options.filepath = result.filePath;
          self.close();
          await self.printToPdf(options);
        })();
      });
    });
    self.addCancelButton();
    return self;
  }
  inherit(PrintToPdfModal, host.DialogModal);

  const proto = PrintToPdfModal.prototype;

  proto.onOpen = function () {
    const self = this;
    this.win.setTimeout(() => self.ctaEl.focus());
  };

  proto.printToPdf = function (options) {
    return (async () => {
      const popup = window.open("about:blank", "_blank", "popup,hide=true");
      const base = createEl("base", { href: location.href });
      popup.document.head.appendChild(base);
      popup.document.title = this.file.basename;
      host.applyEnhancements(popup);
      host.applyLanguage(popup.document);
      host.attachElectron(popup);
      host.mirrorStyles(popup, [base])();
      host.waitModal.instance.setMessage(host.t.dialogue.preparingPdf()).show();
      const doc = popup.document;
      await host.sleep(200);
      doc.body.removeClass("theme-dark");
      doc.body.addClass("theme-light");
      const container = doc.body.createDiv("print");
      const component = new host.Component();
      component.load();
      const cleanup = () => {
        container.detach();
        component.unload();
        popup.close();
        host.waitModal.instance.hide();
      };
      container.addEventListener("click", cleanup);
      try {
        await this.print(container, component, options.includeName);
        await host.sleep(200);
        await host.printToPdfIpc(container.win.electron, options);
        new host.Notice("PDF Saved to " + options.filepath);
      } catch (error) {
        console.error(error);
        new host.Notice("Failed to save PDF.");
      } finally {
        cleanup();
      }
    })();
  };

  proto.testPrint = function () {
    return (async () => {
      const container = document.body.createDiv("print");
      let component;
      container.addEventListener("click", () => {
        container.detach();
        component.unload();
      });
      component = new host.Component();
      component.load();
      await this.print(container, component, true);
    })();
  };

  /** Renders the file's markdown into `container` using the standard preview pipeline. */
  proto.print = function (container, component, includeName) {
    return (async () => {
      const preview = container.createDiv("markdown-preview-view markdown-rendered");
      const app = this.app;
      const file = this.file;
      preview.toggleClass("rtl", app.vault.getConfig("rightToLeft"));
      preview.toggleClass("show-properties", app.vault.getConfig("propertiesInDocument") !== "hidden");
      if (includeName) preview.createEl("h1", { text: file.basename });
      const text = await app.vault.cachedRead(file);
      const tree = host.markdownTree(text);
      const frontmatter = host.treeFrontmatter(tree);
      const html = host.sanitizeHtml(host.treeToHtml(tree));
      const fragment = createFragment();
      const children = Array.from(html.children);
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.tagName === "HR") fragment.appendChild(child);
        else fragment.createDiv({}, (wrapper) => wrapper.appendChild(child));
      }
      preview.appendChild(fragment);
      preview.addClasses(host.frontmatterClasses(frontmatter));
      const promises = [];
      host.MarkdownPreviewView.postProcess(app, {
        docId: host.randomHex(16),
        sourcePath: file.path,
        frontmatter,
        promises,
        addChild: (child) => component.addChild(child),
        getSectionInfo: () => null,
        replace: () => null,
        containerEl: preview,
        el: preview,
        displayMode: true,
      });
      if (promises.length > 0) await Promise.all(promises);
      const links = preview.findAll("a.internal-link");
      for (let i = 0; i < links.length; i++) links[i].removeAttribute("href");
      return preview;
    })();
  };

  return PrintToPdfModal;
}
