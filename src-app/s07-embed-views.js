// Display-mode embed views: the markdown file embed shown inside reading mode
// (`dq`) and the base section every CM6 embed child derives from (`NV`).
// Both stay plain constructor functions linked with `inherit` because inherited
// subclasses still call them through `Base.call(this, ...)`.

import { inherit, methods } from "./inherit.js";
import { env } from "./env.js";
import { searchClasses } from "./n-g11-query.js";
import { searchViewClasses, runSearchOverFiles } from "./n-g11-view.js";

export function defineMarkdownEmbedView(host) {
  /** Reading-mode embed of another markdown file (or a `file#subpath` slice of it). */
  function MarkdownEmbedView(info, file, subpath) {
    const self = host.Component.call(this) || this;
    self.hoverPopover = null;
    self.app = info.app;
    self.containerEl = info.containerEl;
    self.containerEl.addClass("markdown-embed");
    self.file = file;
    self.subpath = subpath;
    if (info.showInline) {
      self.containerEl.addClass("inline-embed");
      self.headerEl = self.containerEl.createDiv({ cls: "embed-title markdown-embed-title", prepend: true });
    }
    return self;
  }
  inherit(MarkdownEmbedView, host.Component);

  methods(MarkdownEmbedView, {
    loadFile() {
      const self = this;
      return (async () => {
        const app = self.app;
        const file = self.file;
        const subpath = self.subpath;
        const cache = app.metadataCache.getFileCache(file);
        const range = host.subpathToPos(cache, subpath);
        let text = await app.vault.cachedRead(file);
        if (range) text = host.subpathContent(text, cache, range).content;
        const tree = host.markdownTree(text);
        const frontmatter = host.treeFrontmatter(tree);
        const html = host.sanitizeHtml(host.treeToHtml(tree));
        if (!subpath) self.headerEl?.setText(file.basename);
        const content = self.containerEl.createDiv("markdown-embed-content");
        const view = content.createDiv("markdown-preview-view markdown-rendered");
        view.toggleClass("rtl", app.vault.getConfig("rightToLeft"));
        view.toggleClass("show-indentation-guide", app.vault.getConfig("showIndentGuide"));
        view.appendChild(html);
        const linkHandlers = new host.PreviewLinkHandlers(self);
        host.MarkdownPreviewRenderer.registerDomEvents(view, linkHandlers);
        const promises = [];
        host.MarkdownPreviewView.postProcess(app, {
          docId: host.randomHex(16),
          sourcePath: file.path,
          frontmatter,
          promises,
          addChild: (child) => self.addChild(child),
          getSectionInfo: () => null,
          replace: () => null,
          containerEl: view,
          el: view,
          displayMode: true,
        });
        if (promises.length > 0) await Promise.all(promises);
      })();
    },
  });

  Object.defineProperty(MarkdownEmbedView.prototype, "path", {
    get() { return this.file?.path || ""; },
    configurable: true,
  });

  return MarkdownEmbedView;
}

export function defineEmbedSectionBase(host) {
  /** Base of the editor embed sections: owns the child list and forwards add/remove to the editor. */
  function EmbedSectionBase(app, editor) {
    const self = host.EmbedCursorBase.call(this) || this;
    self.children = [];
    self.app = app;
    self.editor = editor;
    return self;
  }
  inherit(EmbedSectionBase, host.EmbedCursorBase);

  Object.defineProperty(EmbedSectionBase.prototype, "noReuse", {
    get() { return true; },
    configurable: true,
  });

  methods(EmbedSectionBase, {
    addChild(child) {
      this.editor.addChild(child);
      this.children.push(child);
    },
    removeChild(child) {
      this.editor.removeChild(child);
      this.children.remove(child);
    },
  });

  return EmbedSectionBase;
}

export function defineEmbedWidget(host) {
  /** Base of the block widgets embedded in the CM6 editor: tracks the source
   *  range, wires click-to-select and the edit button, and observes resizes. */
  function EmbedWidget() {
    const self = host.EmbedWidgetBase.apply(this, arguments) || this;
    self.start = -1;
    self.end = -1;
    return self;
  }
  inherit(EmbedWidget, host.EmbedWidgetBase);

  methods(EmbedWidget, {
    setPos(start, end) {
      this.start = start;
      this.end = end;
    },
    hookClickHandler(view, owner) {
      this.setOwner(owner);
      host.nativeDblClick(owner, (evt) => {
        for (let node = evt.targetNode, boundary = view.contentDOM; node && node !== boundary;) {
          if (node.instanceOf(HTMLElement) && node.matches(".cm-editor, .interactive-child")) return;
          node = node.parentNode;
        }
        EmbedWidget.selectElement(view, owner);
      });
    },
    addEditButton(view, owner) {
      this.setOwner(owner);
      const button = owner.createDiv("edit-block-button");
      env().tv(button, "lucide-code-2");
      host.Mv(button, env().gm.editor.menu.labelEditBlock());
      button.addEventListener("click", () => EmbedWidget.selectElement(view, owner));
    },
    resizeWidget(view, el) {
      if (!this.resizeObserver) {
        this.resizeObserver = new ResizeObserver(() => view.requestMeasure());
      }
      this.resizeObserver.observe(el, { box: "border-box" });
    },
    destroy() {
      this.resizeObserver?.disconnect();
    },
    toDOM(view) {
      return this.containerEl || (this.containerEl = this.initDOM(view));
    },
    setOwner(el) {
      EmbedWidget.widgetOwner.set(el, this);
    },
  });

  EmbedWidget.widgetOwner = new WeakMap;
  EmbedWidget.getOwner = function (el) { return EmbedWidget.widgetOwner.get(el); };
  EmbedWidget.selectElement = function (view, owner) {
    const widget = EmbedWidget.getOwner(owner);
    let start = widget.start;
    let end = widget.end;
    if (start < 0 || end < 0) {
      try {
        const pos = view.posAtDOM(owner);
        view.dispatch({ selection: { head: pos, anchor: pos } });
        view.focus();
      } catch (e) {}
      return;
    }
    if (env().Yl.isMobile) end = start;
    try {
      view.focus();
      view.dispatch({ selection: { head: start, anchor: end }, scrollIntoView: true });
    } catch (e) {}
  };

  return EmbedWidget;
}

export function defineQueryEmbedView(host) {
  /** Embed view for ```query blocks: live search results inside rendered markdown. */
  function QueryEmbedView(app, containerEl, query, sourcePath) {
    const self = host.MarkdownRenderChild.call(this, containerEl) || this;
    self.searchQuery = null;
    self.app = app;
    self.query = query;
    self.sourcePath = sourcePath;
    self.dom = new searchViewClasses.SearchResults(app, containerEl, env().gm.plugins.search.labelNoMatches());
    self.queue = new searchViewClasses.SearchQueueComponent(app, self.dom);
    self.addChild(self.queue);
    return self;
  }
  inherit(QueryEmbedView, host.MarkdownRenderChild);

  methods(QueryEmbedView, {
    onload() {
      const app = this.app;
      const dom = this.dom;
      const sourcePath = this.sourcePath;
      dom.emptyResults();
      try {
        const searchQuery = new searchClasses.SearchQuery(app, this.query.replace(/\r?\n/g, " "), false);
        if (!searchQuery.matcher) return;
        this.searchQuery = searchQuery;
        const queue = this.queue.start();
        runSearchOverFiles(app, searchQuery.requiredInputs, queue, (file, content) => {
          if (file.path === sourcePath) {
            content = content.replace(/```query([\s\S]*?)(```|$)/g, (block) => block.replace(/./g, " "));
          }
          const match = searchQuery.match(file, content);
          if (match) dom.addResult(file, match, content);
          else dom.removeResult(file);
        });
      } catch (e) {
        console.log(e);
      }
    },
    onResize() {
      this.dom.onResize();
    },
  });

  return QueryEmbedView;
}
