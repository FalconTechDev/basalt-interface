// g12 clean-room: published-site graph view, markdown embed view and the
// full-page renderer. DOM class names and the public method surface are the
// contract; internals are composed from host primitives.
import { env } from "./env.js";
import { s09GraphNodeData, s09GraphLocalData, s09LoadPixiScript, s09GraphRenderer } from "./s09-graph.js";
import { ng12PublishGraphData, ng12PublishResolveSub } from "./n-g12-s09-core.js";
import { ng12PublishTagModal } from "./n-g12-s09-tree.js";
import { lastSegment, parentPath, baseName, withoutExtension, extensionOf, displayName, withoutMd, parseLinktext, linkPath, isLocalLink, tidyLinkTarget, safeDecodeUri } from "./path.js";
import { escapeRegExp } from "./metadata-helpers.js";
import { formEncodePath } from "./text.js";

const ng12IsMd = (path) => extensionOf(path) === "md";

// ---------------------------------------------------------------- graph view
let ng12GraphViewClass = null;
export function ng12PublishGraphView() {
  if (ng12GraphViewClass) return ng12GraphViewClass;
  const Component = env().jm;

  class Ng12GraphView extends Component {
    constructor(publish, containerEl) {
      super();
      this.publish = publish;
      this.expanded = false;
      this.global = false;
      this.renderer = null;
      this._graphData = null;
      this._currentPath = null;
      this.highlightNode = null;

      const outerContainerEl = (this.outerContainerEl = containerEl.createDiv("graph-view-outer"));
      const header = outerContainerEl.createDiv("list-item published-section-header");
      const iconEl = header.createSpan("published-section-header-icon");
      env().tv(iconEl, "lucide-git-fork");
      header.createSpan({ cls: "published-section-header-text", text: "Interactive graph" });
      this.outerEl = outerContainerEl.createDiv("graph-view-container");
      this.containerEl = this.outerEl.createDiv("graph-view");

      const expandBtn = this.containerEl.createDiv({ cls: "graph-icon graph-expand", attr: { role: "button" } });
      env().tv(expandBtn, "lucide-arrow-up-right");
      env().Mv(expandBtn, "Expand");
      expandBtn.addEventListener("click", () => this.onExpand());
      const globalBtn = this.containerEl.createDiv({ cls: "graph-icon graph-global", attr: { role: "button" } });
      env().tv(globalBtn, "lucide-git-fork");
      env().Mv(globalBtn, "Global Graph");
      globalBtn.addEventListener("click", () => this.onGlobalGraph());

      const modalEl = (this.modalEl = env().createDiv("modal-container"));
      this.modalBgEl = modalEl.createDiv("modal-bg");
      this.modalBgEl.addEventListener("click", (e) => {
        if (e.button === 0) this.onExitExpand();
      });
      this.modalContainerEl = modalEl.createDiv("graph-view-container mod-expanded");

      publish.on("options-updated", () => this.updateOptions());
      publish.on("navigated", () => this.onNavigated());
      this.updateOptions();
    }

    get showGraph() {
      const site = this.publish.site;
      return !!(site && site.getConfig && site.getConfig("showGraph"));
    }

    updateOptions() {
      const show = this.showGraph && !env().Fc;
      if (this.publish.containerEl) {
        this.publish.containerEl.toggleClass("has-graph", show);
      }
      this.outerContainerEl.toggleVisibility(show);
      if (!show || this.renderer) return;
      env().gg(this.containerEl, async () => {
        if (this.renderer) return;
        const worker = new (env().Hz)("/sim.js", { name: "Graph Worker" });
        await s09LoadPixiScript();
        const doc = env().activeDocument || document;
        if (doc.fonts && doc.fonts.ready) await doc.fonts.ready;
        if (this.renderer) return;
        const Renderer = s09GraphRenderer();
        this.renderer = new Renderer(this.containerEl, false, false, worker);
        this.renderer.onNodeClick = (e, path, type) => this.onNodeClick(e, path, type);
        this.renderer.setScale(0.5);
        this.renderer.targetScale = 0.5;
        this.renderer.setRenderOptions({ textFadeMultiplier: -1 });
        this.onNavigated();
      });
    }

    onNodeClick(e, path, type) {
      this.onExitExpand();
      if (e instanceof MouseEvent || e instanceof PointerEvent) {
        this.publish.navigate(path, "", e);
      }
    }

    onExpand() {
      if (this.expanded) return;
      this.expanded = true;
      this.modalContainerEl.appendChild(this.containerEl);
      (env().activeDocument || document).body.appendChild(this.modalEl);
      if (this.renderer) {
        this.renderer.onResize();
        this.renderer.zoomTo(2 * this.renderer.scale);
      }
    }

    onExitExpand() {
      if (!this.expanded) return;
      this.expanded = false;
      this.outerEl.prepend(this.containerEl);
      this.modalEl.remove();
      if (this.global) {
        this.global = false;
        this.onNavigated();
      } else if (this.renderer && !this.global) {
        this.renderer.zoomTo(this.renderer.scale / 2);
      }
    }

    onGlobalGraph() {
      this.onExpand();
      this.global = true;
      if (this.renderer) this.renderer.zoomTo(this.renderer.scale);
      this.onNavigated();
    }

    getGraphData(cache) {
      if (!this._graphData) {
        this._graphData = ng12PublishGraphData(cache, {
          showAttachments: false,
          hideUnresolved: true,
          showTags: false,
        });
      }
      return this._graphData;
    }

    async onNavigated() {
      if (!this.renderer || !this.showGraph) return;
      const render = this.publish.render;
      const path = render && render.currentFilepath;
      if (path !== this._currentPath) {
        if (this.renderer.resetPan) this.renderer.resetPan();
        this._currentPath = path;
      }
      this.highlightNode = null;
      let data = { nodes: {} };
      if (path) {
        const site = this.publish.site;
        const cache = site && site.cache;
        const full = cache ? await this.getGraphData(cache) : { nodes: {} };
        if (!this.global) {
          data = s09GraphLocalData(full, {
            localFile: path,
            localJumps: 1,
            localInterlinks: true,
            localForelinks: true,
            localBacklinks: true,
          });
        } else {
          data = full;
        }
      }
      if (this.renderer.setData) this.renderer.setData(data);
    }
  }

  ng12GraphViewClass = Ng12GraphView;
  return Ng12GraphView;
}

// ------------------------------------------------------------------ embed view
let ng12EmbedViewClass = null;
export function ng12PublishEmbedView() {
  if (ng12EmbedViewClass) return ng12EmbedViewClass;
  const Component = env().jm;
  const TagModal = ng12PublishTagModal;

  class Ng12EmbedView extends Component {
    constructor(publish, contentEl) {
      super();
      this.id = env().cc(16);
      this.hoverPopover = null;
      this.currentFilepath = null;
      this.embedDepth = 0;
      this.publish = publish;
      const Renderer = env().Gz;
      this.renderer = new Renderer(this, this, contentEl, "/worker.js");
      this.addHeader();
      this.addFooter();
    }

    addHeader() {
      this.headerEl = this.renderer && this.renderer.headerEl;
    }

    addFooter() {
      this.footerEl = this.renderer && this.renderer.footerEl;
    }

    renderContent(text, path) {
      this.currentFilepath = path;
      if (this.hoverPopover) {
        this.hoverPopover.hide();
        this.hoverPopover = null;
      }
      this.renderer.clear();
      this.renderer.set(text);
    }

    onScroll() {}
    onFoldChange() {}
    onCheckboxClick() {}
    onExternalLinkClick() {}
    onInternalLinkDrag() {}
    onInternalLinkRightClick() {}
    onExternalLinkRightClick() {}
    onQueryClick() {}

    onInternalLinkClick(e, target, path) {
      e.preventDefault();
      this.publish.navigate(path, this.currentFilepath, e);
    }

    async onInternalLinkMouseover(e, target, path) {
      const site = this.publish.site;
      if (!site || !site.getConfig("showHoverPreview")) return;
      const hover = this.hoverPopover;
      if (hover && hover.state !== env().VQ.Hidden && hover.targetEl === target) return;
      const pop = new (env().rX)(this, target);
      this.hoverPopover = pop;
      setTimeout(async () => {
        if (pop.state === env().VQ.Hidden) return;
        const el = env().createDiv();
        pop.hoverEl.appendChild(el);
        try {
          await this.loadEmbed(path, this.currentFilepath, el, true);
        } catch (err) {
          el.empty();
          el.createDiv({ cls: "markdown-embed mod-empty", text: "This page does not yet exist." });
        }
        if (pop.state === env().VQ.Shown && pop.position) pop.position();
      }, 100);
    }

    onTagClick(e, target, tag) {
      new (TagModal())(this.publish, tag).open();
    }

    postProcess(rendered, promises, frontmatter) {
      const result = this._postProcess({
        docId: this.id,
        sourcePath: this.currentFilepath,
        frontmatter,
        promises,
        addChild: () => {},
        getSectionInfo: () => null,
        replace: () => null,
        containerEl: this.renderer.sizerEl,
        el: rendered.el,
      });
      if (result && typeof result.then === "function") promises.push(result);
      if (result && "usesFrontMatter" in result) rendered.usesFrontMatter = result.usesFrontMatter;
      return result;
    }

    _postProcess(ctx) {
      const el = ctx.el;
      const site = this.publish.site;
      const sourcePath = ctx.sourcePath;
      const promises = ctx.promises || [];
      if (!el || !site) return null;

      // run registered markdown post-processors first
      const processors = (env().Gz && env().Gz.postProcessors) || [];
      for (const fn of processors) {
        try {
          const out = fn(el, this);
          if (out && typeof out.then === "function") promises.push(out);
        } catch (e) {
          console.error(e);
        }
      }

      // internal links -> public hrefs + unresolved marking
      const links = el.querySelectorAll("a.internal-link[data-href]");
      for (const a of links) {
        const href = a.getAttr("data-href") || a.getAttribute("data-href");
        const parsed = parseLinktext(href || "");
        const targetPath = linkPath(href || "");
        const subpath = parsed && parsed.subpath ? parsed.subpath : "";
        const dest = site.cache ? site.cache.getLinkpathDest(targetPath, sourcePath) : null;
        a.toggleClass("is-unresolved", !dest);
        const base = dest || targetPath || "";
        a.setAttribute("href", site.getPublicHref(base) + (subpath || ""));
      }

      // first heading gets a copy-link button
      const first = el.firstElementChild;
      if (first && first.tagName === "H1" && first.hasAttribute("data-heading")) {
        const heading = first.getAttr("data-heading");
        first.addClass("publish-article-heading");
        first.appendText(" ");
        const btn = first.createSpan({ cls: "clickable-icon" });
        env().tv(btn, "lucide-link");
        env().Mv(btn, "Copy link");
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const url = site.getPublicHref(sourcePath) + "#" + env().NQ(env().IT(heading));
          history.replaceState(null, null, url);
          env().Ec(url);
          new (env().fb)("Link copied to your clipboard");
        });
      }

      // markdown embeds
      const embeds = el.querySelectorAll(".internal-embed:not(.is-loaded)");
      for (const embed of embeds) {
        const src = embed.getAttr("src") || embed.getAttribute("src") || "";
        promises.push(this.loadEmbed(src, sourcePath, embed));
      }

      // image alt fallback
      for (const img of el.querySelectorAll("img:not([alt])")) {
        const src = img.getAttribute("src") || "";
        img.setAttribute("alt", lastSegment(src));
      }

      // empty links get a placeholder href
      for (const a of el.querySelectorAll("a")) {
        const href = a.getAttribute("href");
        if (href == null || href === "") a.setAttribute("href", "#");
      }

      // checkbox aria labels
      for (const input of el.querySelectorAll('input[type="checkbox"]')) {
        if (!input.hasAttribute("aria-label")) input.setAttribute("aria-label", "Task");
      }

      // internal media src -> credentialed internal url
      for (const media of el.querySelectorAll("img, audio, video")) {
        const src = media.getAttribute("src") || "";
        if (!isLocalLink(src)) continue;
        const decoded = tidyLinkTarget(safeDecodeUri(src));
        const parsed = parseLinktext(decoded);
        const targetPath = linkPath(decoded);
        const dest = site.cache ? site.cache.getLinkpathDest(targetPath, sourcePath) : null;
        if (dest) media.src = site.getInternalUrl(dest);
      }

      return null;
    }

    loadEmbed(target, sourcePath, containerEl, hoverOnly = false) {
      const site = this.publish.site;
      const parsed = parseLinktext(target || "");
      const path = linkPath(target || "");
      const subpath = parsed && parsed.subpath ? parsed.subpath : "";
      const dest = site.cache ? site.cache.getLinkpathDest(path, sourcePath) : null;
      containerEl.empty();
      if (!dest) return Promise.resolve(false);
      const name = lastSegment(dest);
      const ext = extensionOf(dest);
      const href = site.getInternalUrl(dest);

      if (env().Vy.includes(ext)) {
        containerEl.addClass("image-embed");
        return env().xc(containerEl, href).then(() => {
          containerEl.addClass("is-loaded");
          return true;
        });
      }
      if (env().Hy.includes(ext)) {
        containerEl.addClass("media-embed", "audio-embed");
        return env().Dc(containerEl, href, name).then(() => {
          containerEl.addClass("is-loaded");
          return true;
        });
      }
      if (env().zy.includes(ext)) {
        containerEl.addClass("media-embed", "video-embed");
        return env().Ac(containerEl, href, name).then(() => {
          containerEl.addClass("is-loaded");
          return true;
        });
      }
      if (env().qy.includes(ext)) {
        containerEl.addClass("pdf-embed");
        const frame = containerEl.createEl("iframe", {
          attr: { src: href + (subpath || "") },
        });
        frame.style.width = "100%";
        frame.style.height = "100%";
        containerEl.addClass("is-loaded");
        return Promise.resolve(true);
      }
      if (env().jy.includes(ext) && this.embedDepth < 5) {
        return (async () => {
          const entry = site.cache.getCache(dest);
          let text;
          if (dest !== this.currentFilepath) {
            try {
              text = await env().ajaxPromise({ withCredentials: true, url: href });
            } catch (e) {
              const status = e && e.status;
              text = status === 404 ? "File not found" : "Failed to load";
            }
          } else {
            text = this.renderer.text;
          }
          const resolved = ng12PublishResolveSub(text, entry, subpath);
          containerEl.addClass("markdown-embed");
          const showTitle = !hoverOnly || resolved;
          if (showTitle) {
            const title = name.substring(0, name.length - ext.length - 1);
            containerEl.createDiv({ cls: "markdown-embed-title", text: title });
          }
          const content = containerEl.createDiv("markdown-embed-content");
          const linkBtn = containerEl.createDiv({ cls: "markdown-embed-link clickable-icon", attr: { role: "button" } });
          env().tv(linkBtn, "lucide-link");
          env().Mv(linkBtn, "Open link");
          linkBtn.addEventListener("click", (e) => {
            if (e.button !== 0 && e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            this.publish.navigate(target, sourcePath, e);
          });
          if (resolved) {
            const extracted = env().NT(text, entry, resolved);
            text = extracted && extracted.content !== undefined ? extracted.content : text;
          }
          const PageView = ng12PublishPageView();
          const child = new PageView(this.publish, content);
          child.embedDepth = this.embedDepth + 1;
          child.renderContent(text, dest);
          await child.renderer.onRendered;
          containerEl.addClass("is-loaded");
          return true;
        })();
      }
      // generic file embed
      containerEl.addClass("file-embed");
      containerEl.createDiv({ cls: "file-embed-title", text: name });
      const openBtn = containerEl.createDiv({ cls: "file-embed-link clickable-icon", attr: { role: "button" } });
      env().tv(openBtn, "lucide-arrow-up-right");
      env().Mv(openBtn, "Open in default app");
      openBtn.addEventListener("click", () => window.open(href));
      containerEl.addClass("is-loaded");
      return Promise.resolve(true);
    }
  }

  ng12EmbedViewClass = Ng12EmbedView;
  return Ng12EmbedView;
}

// ------------------------------------------------------------------ page view
let ng12PageViewClass = null;
export function ng12PublishPageView() {
  if (ng12PageViewClass) return ng12PageViewClass;
  const Embed = ng12PublishEmbedView();
  const Component = env().jm;

  class Ng12PageView extends Embed {
    constructor(publish) {
      const wrap = env().createDiv("publish-renderer");
      super(publish, wrap);
      this.renderContainerEl = wrap;
      this.extraTitle = wrap.createDiv("extra-title");
      this.extraTitleText = this.extraTitle.createSpan("extra-title-text");
      const closeBtn = this.extraTitle.createDiv({ cls: "clickable-icon", attr: { role: "button" } });
      env().tv(closeBtn, "lucide-x");
      env().Mv(closeBtn, "Close page");
      closeBtn.addEventListener("click", () => publish.closeRenderer(this));
    }

    async loadFile(path, subpath) {
      if (path === this.currentFilepath) {
        this.navigateSubpath(subpath);
        return;
      }
      this.currentFilepath = path;
      if (this.hoverPopover) {
        this.hoverPopover.hide();
        this.hoverPopover = null;
      }
      this.extraTitleText.setText(displayName(path));
      const site = this.publish.site;
      const headerEl = this.headerEl;
      if (headerEl) {
        headerEl.empty();
        if (!site.getConfig("hideTitle")) {
          headerEl.createEl("h1", { cls: "page-header", text: displayName(path) });
        }
        if (this.renderer.updateHeader) this.renderer.updateHeader();
      }
      this.renderer.clear();
      if (this.footerEl) {
        this.footerEl.empty();
        if (this.renderer.updateFooter) this.renderer.updateFooter();
      }
      const ext = extensionOf(path);
      if (ext !== "md") {
        this.renderer.set("![[" + path + "]]");
      } else {
        let text;
        try {
          text = await site.loadMarkdownFile(path);
        } catch (e) {
          const status = e && e.status;
          if (status === 404) {
            new (env().fb)(`"${path}" does not exist`);
          } else {
            new (env().fb)(`An error occurred while loading "${path}"`);
            console.error(e);
          }
          text = " ";
        }
        this.renderer.set(text || " ");
      }
      if (!this.navigateSubpath(subpath)) subpath = "";
      this.publish.trigger("navigated");
      if (subpath) {
        history.replaceState(null, null, site.getPublicHref(path) + env().RQ(subpath, "#"));
      }
      if (site.getConfig("showBacklinks")) {
        this._loadBacklinks(path);
      }
    }

    _loadBacklinks(path) {
      const site = this.publish.site;
      const cache = site && site.cache;
      if (!cache) return;
      const items = [];
      for (const other of Object.keys(cache.cache)) {
        if (other === path || !ng12IsMd(other)) continue;
        const entry = cache.cache[other];
        let found = false;
        try {
          found = !!env().ST(entry, (ref) => {
            const target = linkPath(ref && ref.link || "");
            return cache.getLinktextDest(target, other) === path;
          });
        } catch (e) {
          found = false;
        }
        if (!found) continue;
        const a = env().createEl("a", {
          cls: "internal-link",
          text: displayName(other),
          attr: { href: site.getPublicHref(other), "data-href": other },
        });
        const el = env().createDiv({ cls: "backlink-item" });
        el.appendChild(a);
        items.push({ el, name: displayName(other) });
      }
      if (!items.length) return;
      const self = this;
      this.renderer.onRendered(() => {
        const footerEl = self.footerEl;
        if (!footerEl) return;
        footerEl.empty();
        const section = footerEl.createDiv("published-section");
        section.appendChild((() => {
          const header = env().createDiv("list-item published-section-header");
          const iconEl = header.createSpan("published-section-header-icon");
          env().tv(iconEl, "lucide-link");
          header.createSpan({ cls: "published-section-header-text", text: "Links to this page" });
          return header;
        })());
        const container = section.createDiv("backlink-items-container");
        items.sort((a, b) => env().ub(a.name, b.name));
        for (const item of items) container.appendChild(item.el);
        if (self.renderer.updateFooter) self.renderer.updateFooter();
      });
    }

    onScroll() {
      const site = this.publish.site;
      if (!site || !site.getConfig("showOutline")) return;
      const outline = this.publish.outline;
      if (outline && outline.highlightLine && this.renderer.getScroll) {
        outline.highlightLine(Math.round(this.renderer.getScroll()));
      }
    }

    onResize() {
      if (this.renderer.onResize) this.renderer.onResize();
    }

    navigateSubpath(subpath) {
      if (!subpath) return false;
      const cache = this.publish.site && this.publish.site.cache;
      const entry = cache ? cache.getCache(this.currentFilepath) : null;
      const resolved = ng12PublishResolveSub(this.renderer.text, entry, subpath);
      if (resolved) {
        this.scrollToLoc(resolved.start);
        return true;
      }
      return false;
    }

    scrollToLoc(loc) {
      if (this.renderer.applyScrollDelayed) {
        this.renderer.applyScrollDelayed(loc.line, { highlight: true });
      }
      this.onScroll();
    }
  }

  ng12PageViewClass = Ng12PageView;
  return Ng12PageView;
}
