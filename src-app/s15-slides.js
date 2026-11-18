// Own Basalt implementation of the Slides core plugin.
//
// The plugin registers a "slides:start" global command and a file-menu item for
// markdown files; the view splits the document on thematic breaks, renders each
// slide through the markdown pipeline and drives the bundled reveal.js deck.
// Reveal.js itself is still the third-party script loaded through the host
// script loader (M9); everything else is own code.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { randomHex } from "./misc.js";

const SV = () => env();
const slidesT = () => SV().gm.plugins.slides;

let slidesCache = null;

function buildSlidesClasses() {
  const Component = SV().jm;
  const Scope = SV().Ng;

  // -- x9: slides presentation view ------------------------------------------
  function SlidesView(app) {
    const self = Component.call(this) || this;
    self.containerEl = null;
    self.revealCssEl = null;
    self.themeCssEl = null;
    self.deck = null;
    self.app = app;
    self.scope = new Scope();
    self.scope.register([], "Escape", self.close.bind(self));
    return self;
  }
  inherit(SlidesView, Component);

  SlidesView.prototype.openFile = async function (file) {
    this.destroy();
    this.app.keymap.pushScope(this.scope);
    const text = await this.app.vault.read(file);
    try {
      if (this.containerEl) this.containerEl.detach();
      const revealReady = SV().M9.promise;
      const isLight = this.app.vault.getConfig("theme") === "moonstone";
      const containerEl = (this.containerEl = activeDocument.body.createDiv("slides-container"));
      const themeCssEl = (this.themeCssEl = activeDocument.head.createEl("link", { prepend: true }));
      themeCssEl.setAttribute("rel", "stylesheet");
      themeCssEl.setAttribute("href", isLight ? "/lib/reveal/white.css" : "/lib/reveal/black.css");
      const revealCssEl = (this.revealCssEl = activeDocument.head.createEl("link", { prepend: true }));
      revealCssEl.setAttribute("rel", "stylesheet");
      revealCssEl.setAttribute("href", "/lib/reveal/reveal.css");
      const revealEl = containerEl.createDiv("reveal");
      const slidesEl = revealEl.createDiv("slides");
      revealEl.createDiv("slides-close-btn", (btn) => {
        SV().tv(btn, "lucide-x-square");
        btn.addEventListener("click", this.close.bind(this));
      });
      const doc = SV().Kx(text);
      const frontmatter = SV().$x(doc);
      const definitions = { definitions: SV().oT(doc) };
      const children = doc.children;
      const slides = [[]];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === "thematicBreak") slides.push([]);
        else slides.last().push(child);
      }
      for (let i = 0; i < slides.length; i++) {
        const group = slides[i];
        if (group.length === 0) continue;
        doc.children = group;
        const html = SV().Zx(doc, definitions);
        slidesEl.createEl("section", {}, (section) => {
          section.appendChild(SV().xL(html));
        });
      }
      const promises = [];
      SV().fq.postProcess(this.app, {
        docId: randomHex(16),
        sourcePath: file.path,
        frontmatter,
        promises,
        addChild: (child) => this.addChild(child),
        getSectionInfo: () => null,
        replace: () => null,
        containerEl: slidesEl,
        el: slidesEl,
      });
      if (promises.length > 0) await Promise.all(promises);
      await revealReady;
      this.deck = new Reveal(revealEl, {
        embedded: true,
        keyboardCondition: "focused",
        controlsTutorial: false,
        overview: false,
      }).initialize();
      setTimeout(() => {
        revealEl.dispatchEvent(new PointerEvent("pointerdown"));
      }, 0);
    } catch (err) {
      console.error(err);
      this.close();
    }
  };

  SlidesView.prototype.close = function () {
    this.destroy();
  };

  SlidesView.prototype.destroy = function () {
    this.app.keymap.popScope(this.scope);
    const deck = this.deck;
    const containerEl = this.containerEl;
    const revealCssEl = this.revealCssEl;
    const themeCssEl = this.themeCssEl;
    if (containerEl) {
      containerEl.detach();
      this.containerEl = null;
    }
    if (revealCssEl) {
      revealCssEl.detach();
      this.revealCssEl = null;
    }
    if (themeCssEl) {
      themeCssEl.detach();
      this.themeCssEl = null;
    }
    if (deck) deck.destroy();
  };

  // -- S9: slides plugin -------------------------------------------------------
  function SlidesPlugin() {
    this.id = "slides";
    this.name = slidesT().name();
    this.description = slidesT().desc();
  }
  SlidesPlugin.prototype.init = function (app, manifest) {
    const self = this;
    this.app = app;
    manifest.registerGlobalCommand({
      id: "slides:start",
      name: slidesT().actionStart(),
      icon: "lucide-monitor",
      checkCallback: (checking) => {
        const file = self.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          if (!checking) new SlidesView(self.app).openFile(file);
          return true;
        }
        return false;
      },
    });
  };
  SlidesPlugin.prototype.onEnable = function (app, manifest) {
    manifest.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
  };
  SlidesPlugin.prototype.onFileMenu = function (menu, file) {
    const self = this;
    if (file instanceof SV().$T && file.extension === "md") {
      menu.addItem((item) =>
        item
          .setSection("view")
          .setTitle(slidesT().actionStart())
          .setIcon("lucide-monitor")
          .onClick(() => new SlidesView(self.app).openFile(file)),
      );
    }
  };

  return { x9: SlidesView, S9: SlidesPlugin };
}

let slidesBuilt = null;
function slidesClasses() {
  if (!slidesBuilt) slidesBuilt = buildSlidesClasses();
  return slidesBuilt;
}

export function defineSlidesView(host) {
  return slidesClasses().x9;
}
export function defineSlidesPlugin(host) {
  return slidesClasses().S9;
}
