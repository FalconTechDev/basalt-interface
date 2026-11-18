// s22 slice: view container base class and the two markdown embed views —
// the file embed (dq) and the query-results embed (mq).
import { env } from "./env.js";
import { inherit } from "./inherit.js";


/**
 * Base for embed views that live inside an editor: keeps a children list and
 * forwards addChild/removeChild to the owning editor widget. Subclassed by the
 * table widget and the callout/live-preview widgets through the ES5 class-IIFE
 * pattern, so this stays a plain constructor function.
 */
export function defineViewContainer(host) {
  function ViewContainer(app, editor) {
    const self = env().FV.call(this) || this;
    self.children = [];
    self.app = app;
    self.editor = editor;
    return self;
  }
  inherit(ViewContainer, env().FV);
  Object.defineProperty(ViewContainer.prototype, "noReuse", {
    get: function () { return true; },
    enumerable: false,
    configurable: true,
  });
  ViewContainer.prototype.addChild = function (child) {
    this.editor.addChild(child);
    this.children.push(child);
  };
  ViewContainer.prototype.removeChild = function (child) {
    this.editor.removeChild(child);
    this.children.remove(child);
  };
  return ViewContainer;
}

/**
 * Markdown file embed: renders another note (or a `path#heading` subpath) inside
 * the current document, reusing the preview post-processing pipeline.
 */
export function defineMarkdownEmbed(host) {
  function MarkdownEmbed(context, file, subpath) {
    const self = host.Component.call(this) || this;
    self.hoverPopover = null;
    self.app = context.app;
    self.containerEl = context.containerEl;
    self.containerEl.addClass("markdown-embed");
    self.file = file;
    self.subpath = subpath;
    if (context.showInline) {
      self.containerEl.addClass("inline-embed");
      self.headerEl = self.containerEl.createDiv({ cls: "embed-title markdown-embed-title", prepend: true });
    }
    return self;
  }
  inherit(MarkdownEmbed, host.Component);

  MarkdownEmbed.prototype.loadFile = async function () {
    const app = this.app;
    const file = this.file;
    const subpath = this.subpath;
    const cache = app.metadataCache.getFileCache(file);
    const pos = env().FT(cache, subpath);
    let content = await app.vault.cachedRead(file);
    if (pos) content = env().NT(content, cache, pos).content;
    const tree = env().Kx(content);
    const frontmatter = env().$x(tree);
    const html = env().Zx(tree);
    const fragment = env().xL(html);
    if (!subpath) this.headerEl && this.headerEl.setText(file.basename);
    const contentEl = this.containerEl.createDiv("markdown-embed-content");
    const preview = contentEl.createDiv("markdown-preview-view markdown-rendered");
    preview.toggleClass("rtl", app.vault.getConfig("rightToLeft"));
    preview.toggleClass("show-indentation-guide", app.vault.getConfig("showIndentGuide"));
    preview.appendChild(fragment);
    const handlers = new host.PreviewLinkHandlers(this);
    env().Gz.registerDomEvents(preview, handlers);
    const promises = [];
    env().fq.postProcess(this.app, {
      docId: env().cc(16),
      sourcePath: file.path,
      frontmatter,
      promises,
      addChild: (child) => this.addChild(child),
      getSectionInfo: () => null,
      replace: () => null,
      containerEl: preview,
      el: preview,
      displayMode: true,
    });
    if (promises.length > 0) await Promise.all(promises);
  };

  Object.defineProperty(MarkdownEmbed.prototype, "path", {
    get: function () { return (this.file && this.file.path) || ""; },
    enumerable: false,
    configurable: true,
  });
  return MarkdownEmbed;
}

/**
 * Query-results embed: runs a search query inside the note and renders the
 * matches with the shared search-results component.
 */
export function defineQueryResults(host) {
  function QueryResults(app, containerEl, query, sourcePath) {
    const self = host.MarkdownRenderChild.call(this, containerEl) || this;
    self.searchQuery = null;
    self.app = app;
    self.query = query;
    self.sourcePath = sourcePath;
    self.dom = new (env().sz)(app, containerEl, env().gm.plugins.search.labelNoMatches());
    self.queue = new (env().aq)(app, self.dom);
    self.addChild(self.queue);
    return self;
  }
  inherit(QueryResults, host.MarkdownRenderChild);

  QueryResults.prototype.onload = function () {
    const app = this.app;
    const dom = this.dom;
    const sourcePath = this.sourcePath;
    dom.emptyResults();
    try {
      const query = new (env().BH)(app, this.query.replace(/\r?\n/g, " "), false);
      if (!query.matcher) return;
      this.searchQuery = query;
      const job = this.queue.start();
      env().VH(app, query.requiredInputs, job, (file, text) => {
        if (file.path === sourcePath) {
          text = text.replace(/```query([\s\S]*?)(```|$)/g, (block) => block.replace(/./g, " "));
        }
        const match = query.match(file, text);
        if (match) dom.addResult(file, match, text);
        else dom.removeResult(file);
      });
    } catch (e) {
      console.log(e);
    }
  };

  QueryResults.prototype.onResize = function () {
    this.dom.onResize();
  };
  return QueryResults;
}
