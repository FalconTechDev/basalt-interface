// The reading-mode render foundation: MarkdownRenderChild (the Component that owns a rendered container),
// MarkdownPreviewSection (one rendered slice of a document), the link/hover handlers every rendered view shares,
// and MarkdownRenderer (the object plugins call to render markdown into a DOM node).
//
// Everything the application scope still owns (the sectioned preview renderer, the embed loader, the markdown
// parsers, the preview view that post-processes embeds) is reached through `host`; names there are the only
// minified identifiers in this file.
import { inherit } from "./inherit.js";
import { randomHex, isUrl, copyText } from "./misc.js";
import { lineBounds } from "./text.js";

/** Plugins that called renderMarkdown without a Component: warn once per plugin id (was the bundle's `sq`). */
const renderWarnings = {};

export function defineMarkdownRenderChild(host) {
  /** A Component that simply owns the element its rendered content goes into. */
  function MarkdownRenderChild(containerEl) {
    const self = host.Component.call(this) || this;
    self.containerEl = containerEl;
    return self;
  }
  inherit(MarkdownRenderChild, host.Component);
  return MarkdownRenderChild;
}

export function defineMarkdownPreviewSection(host) {
  /** One rendered section of a preview: holds the sanitized html, the source range it came from and the
   *  geometry the renderer measured. `html === null` means "not rendered yet". */
  function MarkdownPreviewSection(html) {
    this.rendered = false;
    this.height = 0;
    this.computed = false;
    this.lines = 0;
    this.used = true;
    this.highlightRanges = null;
    this.level = 0;
    this.headingCollapsed = false;
    this.shown = true;
    this.usesFrontMatter = false;
    this.html = html || "";
    this.el = createDiv();
    if (html === null) {
      this.rendered = true;
      this.start = this.end = { line: 0, col: 0, offset: 0 };
    }
  }

  MarkdownPreviewSection.prototype.render = function () {
    if (this.rendered) return;
    const fragment = host.sanitizeHtml(this.html);
    this.el.appendChild(fragment);
    const first = this.el.firstChild;
    if (first && first.nodeType === Node.ELEMENT_NODE) this.el.addClass("el-" + first.tagName.toLowerCase());
    this.rendered = true;
    this.computed = false;
  };

  /** Marks the measured geometry stale; highlight rects of child ranges are dropped with it. */
  MarkdownPreviewSection.prototype.resetCompute = function () {
    this.computed = false;
    const ranges = this.highlightRanges;
    if (ranges) for (let i = 0; i < ranges.length; i++) ranges[i].rects = null;
  };

  MarkdownPreviewSection.prototype.setCollapsed = function (collapsed) {
    this.headingCollapsed = collapsed;
    host.setCollapsed(this.el, collapsed);
  };

  return MarkdownPreviewSection;
}

export function definePreviewLinkHandlers(host) {
  /** The click/drag/hover behaviour of links and tags inside rendered markdown. `info` is the owner
   *  (a MarkdownRenderer, or an editor wrapper): it provides `app` and `path`. */
  function PreviewLinkHandlers(info) {
    this.info = info;
  }
  const proto = PreviewLinkHandlers.prototype;

  proto.onInternalLinkDrag = function (event, targetEl, linktext, sourcePath) {
    const app = this.info.app;
    app.dragManager.onDragStart(event, app.dragManager.dragLink(event, linktext, this.info.path, sourcePath));
  };

  proto.onInternalLinkClick = function (event, targetEl, linktext) {
    event.preventDefault();
    this.info.app.workspace.openLinkText(linktext, this.info.path, host.Keymap.isModEvent(event));
  };

  proto.onInternalLinkRightClick = function (event, targetEl, linktext) {
    const menu = host.Menu.forEvent(event);
    menu.setParentElement(targetEl);
    menu.addSections(["title", "open", "action", "clipboard", "view", "info", "", "danger"]);
    menu.addItem((item) => item.setSection("clipboard").setTitle(host.t.interface.menu.copy()).setIcon("lucide-copy")
      .onClick(() => copyText(targetEl.getText())));
    this.info.app.workspace.handleLinkContextMenu(menu, linktext, this.info.path);
  };

  proto.onExternalLinkClick = function (event, targetEl, href) {
    event.preventDefault();
    if (isUrl(href)) {
      const mod = host.Keymap.isModEvent(event);
      // a boolean means "no modifier string to pass on"
      window.open(href, typeof mod === "boolean" ? "" : mod);
    } else {
      new host.Notice(host.t.interface.msgFailedToOpenHref({ href }));
    }
  };

  proto.onExternalLinkRightClick = function (event, targetEl, href) {
    const menu = host.Menu.forEvent(event);
    menu.addSections(["title", "open", "selection", "clipboard", "info", "action", "view", "", "danger"]);
    menu.addItem((item) => item.setSection("clipboard").setTitle(host.t.interface.menu.copy()).setIcon("lucide-copy")
      .onClick(() => copyText(targetEl.getText())));
    this.info.app.workspace.handleExternalLinkContextMenu(menu, href);
  };

  proto.onInternalLinkMouseover = function (event, targetEl, linktext) {
    this.info.app.workspace.trigger("hover-link", {
      event, source: "preview", hoverParent: this.info, targetEl, linktext, sourcePath: this.info.path,
    });
  };

  proto.onTagClick = function (event, targetEl, tag) {
    const search = this.info.app.internalPlugins.getEnabledPluginById("global-search");
    if (search) search.openGlobalSearch("tag:" + tag);
  };

  return PreviewLinkHandlers;
}

export function defineMarkdownRenderer(host) {
  /** Renders markdown into DOM. Plugins use the statics (render / renderMarkdown); a view uses an instance
   *  (constructed with the view's app, a container element and the file path) and drives `renderer`. */
  function MarkdownRenderer(app, containerEl, sourcePath, registerEvents) {
    if (registerEvents === undefined) registerEvents = true;
    const self = host.MarkdownRenderChild.call(this, containerEl) || this;
    self.docId = randomHex(16);
    self.hoverPopover = null;
    self.requestUpdateLinks = host.debounce(() => {
      const sections = self.renderer.sections;
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (section.rendered) self.resolveLinks(section.el);
      }
    }, 500);
    self.app = app;
    const linkHandlers = new host.PreviewLinkHandlers(self);
    self.renderer = new host.MarkdownPreviewRenderer(self, linkHandlers, containerEl, "worker.js", registerEvents);
    return self;
  }
  inherit(MarkdownRenderer, host.MarkdownRenderChild);
  const proto = MarkdownRenderer.prototype;

  proto.onload = function () {
    const app = this.app;
    this.registerEvent(app.vault.on("modify", this.onFileChange, this));
    this.registerEvent(app.vault.on("delete", this.onFileChange, this));
    this.registerEvent(app.metadataCache.on("changed", this.onFileChange, this));
  };

  /** Checkbox toggle inside rendered task lists: flips the source and patches the rendered list item. */
  proto.onCheckboxClick = function (event, checkboxEl, line) {
    event.preventDefault();
    navigator.vibrate(100);
    const text = this.renderer.text;
    const toggled = MarkdownRenderer.toggleCheckbox(text, line);
    if (toggled !== null) {
      const section = this.renderer.getSectionContainer(checkboxEl);
      if (section) {
        const checked = toggled.char !== " ";
        const sectionLine = line - section.start.line;
        if (sectionLine >= 0) {
          const key = String(sectionLine);
          // rewrite the matching <li> in the section's html so a re-render keeps the new state
          section.html = section.html.replace(
            /<li class="task-list-item( is-checked)?" data-task="(.)" data-line="(\d+)"><input class="task-list-item-checkbox" type="checkbox"( checked)? data-line="(\d+)">/g,
            (match, isChecked, task, dataLine, wasChecked, endLine) =>
              dataLine === key && endLine === key
                ? '<li class="task-list-item' + (checked ? " is-checked" : "") + '" data-task="' + toggled.char + '" data-line="' + dataLine + '"><input class="task-list-item-checkbox" type="checkbox"' + (checked ? " checked" : "") + ' data-line="' + endLine + '">'
                : match
          );
        }
        setTimeout(() => {
          checkboxEl.checked = checked;
          const item = checkboxEl.parentNode;
          if (item && item.instanceOf(HTMLLIElement)) {
            item.setAttr("data-task", toggled.char);
            item.toggleClass("is-checked", checked);
          }
        }, 0);
      }
      this.edit(toggled.text);
    }
  };

  /** Flips the [ ]/[x] on `line`; returns the new source text and marker char, or null when there is none. */
  MarkdownRenderer.toggleCheckbox = function (text, line) {
    const bounds = lineBounds(text, line);
    if (!bounds) return null;
    const mark = text.slice(bounds.start, bounds.end).search(/\[.\]/);
    if (mark === -1) return null;
    const at = bounds.start + mark + 1;
    const char = text.charAt(at) === " " ? "x" : " ";
    return { text: text.slice(0, at) + char + text.slice(at + 1), char };
  };

  /** Runs every registered post-processor over a rendered section, then resolves its links. */
  proto.postProcess = function (section, promises, frontmatter) {
    const self = this;
    const ctx = host.MarkdownPreviewView.postProcess(self.app, {
      docId: self.docId,
      sourcePath: self.path,
      frontmatter,
      promises,
      addChild: (child) => self.addChild(child),
      getSectionInfo: (el) => self.renderer.getSectionInfo(el),
      replace: (html, rerender) => {
        const text = self.renderer.text;
        const from = section.start;
        const to = section.end;
        const next = text.slice(0, from.offset) + html + text.slice(to.offset);
        if (rerender) {
          const rendered = host.renderSectionHtml(html);
          if (rendered.sections.length === 1) section.html = rendered.sections[0].html;
        }
        self.edit(next);
      },
      containerEl: self.renderer.sizerEl,
      el: section.el,
    });
    section.usesFrontMatter = !!ctx.usesFrontMatter;
    self.resolveLinks(section.el);
  };

  proto.onScroll = function () {};
  proto.onFoldChange = function () {};
  proto.onRenderComplete = function () {};

  Object.defineProperty(proto, "path", {
    get: function () { return (this.file && this.file.path) || ""; },
    enumerable: false,
    configurable: true,
  });

  proto.onFileChange = function () { this.requestUpdateLinks(); };

  proto.resolveLinks = function (el) {
    const self = this;
    host.refreshLinkStates(self.app, el, self.path, (linktext) => self.renderer.getInternalLinkHref(linktext));
  };

  /** The post-processing every rendered markdown root gets: query embeds, registered post-processors,
   *  file embeds. `ctx` is { app, markdown, el, sourcePath, component }. */
  MarkdownRenderer.postProcess = function (app, ctx) {
    const sourcePath = ctx.sourcePath;
    const promises = ctx.promises;
    const el = ctx.el;
    const displayMode = ctx.displayMode;
    const queries = el.findAll("code.language-query");
    for (let i = 0; i < queries.length; i++) {
      const code = queries[i];
      const query = host.queryBlockText(code).trim();
      const parent = code.parentElement;
      ctx.addChild(host.queryEmbed(app, query, parent, sourcePath));
    }
    const postProcessors = host.MarkdownPreviewRenderer.postProcessors;
    for (let i = 0; i < postProcessors.length; i++) {
      const result = postProcessors[i](el, ctx);
      if (result && result.then) promises.push(result);
    }
    const depth = host.embedDepth(ctx.containerEl);
    const embeds = el.findAll(".internal-embed:not(.is-loaded)");
    if (embeds.length > 0) {
      for (let i = 0; i < embeds.length; i++) {
        const embed = embeds[i];
        const linktext = embed.getAttribute("src");
        const child = host.EmbedLoader.load({
          app, linktext, sourcePath, containerEl: embed, displayMode, showInline: true, depth,
        });
        if (child) {
          ctx.addChild(child);
          promises.push(child.loadFile());
        }
      }
    }
    return ctx;
  };

  MarkdownRenderer.renderMarkdown = function (markdown, el, sourcePath, component) {
    return MarkdownRenderer.render(null, markdown, el, sourcePath, component);
  };

  /** Parses `markdown`, appends the sanitized DOM to `el` and runs post-processing; resolves when embeds settle. */
  MarkdownRenderer.render = function (app, markdown, el, sourcePath, component) {
    if (!(component && component instanceof host.Component)) {
      const stack = new Error().stack;
      if (typeof stack === "string") {
        const match = stack.match(/plugin:([^:]+)/);
        if (match) {
          const id = match[1];
          if (!renderWarnings.hasOwnProperty(id)) {
            renderWarnings[id] = true;
            console.error(new Error('Plugin "' + id + '" is not passing Component in renderMarkdown. This is needed to avoid memory leaks when embedded contents register global event handlers.'));
          }
        }
      }
    }
    const tree = host.markdownTree(markdown);
    const frontmatter = host.treeFrontmatter(tree);
    const html = host.sanitizeHtml(host.treeToHtml(tree));
    el.appendChild(html);
    const promises = [];
    const ctx = {
      docId: randomHex(16),
      sourcePath,
      frontmatter,
      promises,
      addChild: (child) => component && component.addChild(child),
      getSectionInfo: () => null,
      replace: () => null,
      containerEl: el,
      el,
      displayMode: true,
    };
    const postProcessors = host.MarkdownPreviewRenderer.postProcessors;
    for (let i = 0; i < postProcessors.length; i++) {
      const result = postProcessors[i](el, ctx);
      if (result && result.then) promises.push(result);
    }
    if (app && component) {
      const depth = host.embedDepth(el);
      const embeds = el.findAll(".internal-embed:not(.is-loaded)");
      if (embeds.length > 0) {
        for (let i = 0; i < embeds.length; i++) {
          const embed = embeds[i];
          const linktext = embed.getAttribute("src");
          const child = host.EmbedLoader.load({
            app, linktext, sourcePath, containerEl: embed, displayMode: true, showInline: true, depth,
          });
          if (child) {
            ctx.addChild(child);
            promises.push(child.loadFile());
          }
        }
      }
    }
    return promises.length > 0 ? Promise.all(promises).then() : Promise.resolve();
  };

  return MarkdownRenderer;
}
