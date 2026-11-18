// Slice s31: CodeMirror embed widgets, fold/selection/task decoration fields, the markdown
// extension lists and small editor helpers that lived as top-level statements in the bundle.
//
// Everything the original reached through application-scope names arrives lazily through env()
// (the manifest's envBind list); classes that replace other s31 classes share one cached
// constructor per key so `instanceof` keeps working across the splice.
import { env } from "./env.js";
import { inherit, methods } from "./inherit.js";

const s31Cache = new Map();
function s31Cls(key, build) {
  if (!s31Cache.has(key)) s31Cache.set(key, build());
  return s31Cache.get(key);
}

// ---------------------------------------------------------------------------
// Shared widget bases (originally `var X=function(e){...}(NV|FV|Rn)` IIFEs)
// ---------------------------------------------------------------------------

// g6: base class for block embed widgets rendered inside the editor ("cm-embed-block").
function s31BuildEmbedBlockWidget() {
  const E = env();
  function EmbedBlockWidget(app, editor, text, clazz) {
    const self = E.NV.call(this, app, editor) || this;
    self.text = text;
    self.clazz = clazz;
    return self;
  }
  inherit(EmbedBlockWidget, E.NV);
  methods(EmbedBlockWidget, {
    initDOM(view) {
      const self = this;
      const app = self.app;
      const editor = self.editor;
      const text = self.text;
      const clazz = self.clazz;
      const containerEl = (self.containerEl = createDiv("cm-embed-block " + clazz));
      containerEl.tabIndex = -1;
      const renderedEl = containerEl.createDiv("markdown-rendered");
      const ast = E.Kx(text);
      const frontmatter = E.$x(ast);
      E.jC(ast, "checklist", (node) => {
        node.data.hProperties["data-line"] = String(node.position.start.line - 1);
      });
      const html = E.xL(E.Zx(ast));
      renderedEl.toggleClass("rtl", app.vault.getConfig("rightToLeft"));
      renderedEl.toggleClass("show-indentation-guide", app.vault.getConfig("showIndentGuide"));
      renderedEl.appendChild(html);
      E.fq.postProcess(self.app, {
        docId: E.cc(16),
        sourcePath: editor.path,
        frontmatter,
        promises: [],
        addChild(child) { return self.addChild(child); },
        getSectionInfo() { return null; },
        replace() { return null; },
        containerEl,
        el: renderedEl,
        displayMode: false,
      });
      self.resolveLinks();
      self.hookClickHandler(view, containerEl);
      self.addEditButton(view, containerEl);
      self.resizeWidget(view, containerEl);
      return containerEl;
    },
    resolveLinks() {
      env().uq(this.app, this.containerEl, this.editor.path);
    },
  });
  Object.defineProperty(EmbedBlockWidget.prototype, "estimatedHeight", {
    get() {
      const text = this.text;
      let lines = 1;
      for (let at = 0; (at = text.indexOf("\n", at)) !== -1; ) {
        lines++;
        at++;
      }
      return lines * this.editor.cm.defaultLineHeight;
    },
    enumerable: false,
    configurable: true,
  });
  return EmbedBlockWidget;
}
export function s31EmbedBlockWidget(host) {
  return s31Cls("g6", s31BuildEmbedBlockWidget);
}

// m6: widget for `![[internal links]]` embeds.
function s31BuildInternalEmbedWidget() {
  const E = env();
  function InternalEmbedWidget(app, editor, sourcePath, href, title, depth) {
    const self = E.NV.call(this, app, editor) || this;
    self.sourcePath = sourcePath;
    self.href = href;
    self.title = title;
    self.depth = depth;
    return self;
  }
  inherit(InternalEmbedWidget, E.NV);
  methods(InternalEmbedWidget, {
    initDOM(view) {
      const self = this;
      const app = self.app;
      const sourcePath = self.sourcePath;
      const href = self.href;
      const title = self.title;
      const depth = self.depth;
      const containerEl = (self.containerEl = createDiv("internal-embed"));
      containerEl.tabIndex = -1;
      containerEl.setAttr("src", href);
      const child = E.sJ.load({
        app,
        linktext: href,
        sourcePath,
        containerEl,
        displayMode: false,
        showInline: true,
        depth,
      });
      if (child) {
        self.addChild(child);
        child.loadFile();
      }
      self.applyTitle(containerEl, title);
      if (child instanceof E.YZ || child instanceof E.E$) {
        self.addEditButton(view, containerEl);
      } else if (child instanceof E.tJ) {
        self.addEditButton(view, containerEl);
        const img = child.containerEl.find("img");
        if (img) {
          const wrapper = child.containerEl.createDiv("image-wrapper");
          wrapper.append(img);
          E.d6(self, view, containerEl, img, wrapper);
        }
      } else {
        self.hookClickHandler(view, containerEl);
      }
      self.resizeWidget(view, containerEl);
      return containerEl;
    },
    applyTitle(el, title) {
      this.title = title;
      let width = 0;
      let height = 0;
      if (title) {
        const parseSize = (value) => {
          const size = E.zx(value);
          if (!size) return false;
          width = size.x;
          height = size.y;
          return true;
        };
        const pipe = title.lastIndexOf("|");
        if (pipe !== -1) {
          if (parseSize(title.substr(pipe + 1))) title = title.substr(0, pipe);
        } else if (parseSize(title)) {
          title = "";
        }
      }
      el.setAttr("alt", title || null);
      el.setAttr("width", width === 0 ? null : String(width));
      el.setAttr("height", height === 0 ? null : String(height));
      const child = this.child;
      if (child instanceof E.tJ) {
        const img = child.containerEl.find("img");
        if (img) {
          img.setAttr("alt", title || null);
          img.setAttr("width", width === 0 ? null : String(width));
          img.setAttr("height", height === 0 ? null : String(height));
        }
      }
    },
  });
  Object.defineProperty(InternalEmbedWidget.prototype, "estimatedHeight", {
    get() { return 100; },
    enumerable: false,
    configurable: true,
  });
  return InternalEmbedWidget;
}
export function s31InternalEmbedWidget(host) {
  return s31Cls("m6", s31BuildInternalEmbedWidget);
}

// v6: widget for fenced code blocks with a renderable language (mermaid, query, post-processors).
function s31BuildCodeBlockWidget() {
  const E = env();
  function CodeBlockWidget(app, editor, lang, code) {
    const self = E.NV.call(this, app, editor) || this;
    self.lang = lang;
    self.code = code;
    return self;
  }
  inherit(CodeBlockWidget, E.NV);
  methods(CodeBlockWidget, {
    initDOM(view) {
      const self = this;
      const app = self.app;
      const editor = self.editor;
      const lang = self.lang;
      let code = self.code;
      const containerEl = (self.containerEl = createDiv(
        "cm-preview-code-block cm-embed-block markdown-rendered cm-lang-" + lang
      ));
      containerEl.tabIndex = -1;
      let preEl = containerEl.createEl("pre");
      let codeEl = preEl.createEl("code", "language-" + lang);
      E.Xz.set(codeEl, code);
      if (lang === "mermaid") {
        E.Yz(view.contentDOM, [codeEl]);
      } else if (lang === "query") {
        self.addChild(E.pq(app, code, preEl, editor.path));
      } else if (E.Gz.codeBlockPostProcessors.hasOwnProperty(lang)) {
        containerEl.empty();
        const blockEl = containerEl.createDiv("block-language-" + lang);
        const postProcess = E.Gz.codeBlockPostProcessors[lang];
        try {
          postProcess(code, blockEl, {
            docId: E.cc(16),
            sourcePath: editor.path,
            frontmatter: {},
            promises: [],
            addChild(child) { return self.addChild(child); },
            getSectionInfo(node) {
              return containerEl.contains(node)
                ? { lineStart: self.lineStart, lineEnd: self.lineEnd, text: view.state.doc.toString() }
                : null;
            },
            replace(text) {
              view.dispatch({
                changes: {
                  from: view.state.doc.line(self.lineStart + 1).from,
                  to: view.state.doc.line(self.lineEnd + 1).to,
                  insert: text,
                },
              });
            },
            replaceCode(text) {
              self.code = text;
              E.Xz.set(codeEl, code);
              const start = self.start;
              const end = self.end;
              self.end = start + text.length;
              view.dispatch({ changes: { from: start, to: end, insert: text } });
            },
            containerEl: view.scrollDOM,
            el: blockEl,
          });
        } catch (err) {
          console.error(err);
          new E.fb(env().gm.interface.msgCodeblockRenderError());
          containerEl.empty();
          preEl = containerEl.createEl("pre");
          codeEl = preEl.createEl("code", "language-" + lang);
          codeEl.setText(code);
        }
        const depth = E.JZ(view.scrollDOM);
        const embeds = containerEl.findAll(".internal-embed:not(.is-loaded)");
        if (embeds.length > 0) {
          for (const embedEl of embeds) {
            const linktext = embedEl.getAttribute("src");
            const child = E.sJ.load({
              app,
              linktext,
              sourcePath: editor.path,
              containerEl: embedEl,
              displayMode: true,
              showInline: true,
              depth,
            });
            if (child) {
              self.addChild(child);
              child.loadFile();
            }
          }
        }
      } else {
        codeEl.setText(code);
      }
      self.addEditButton(view, containerEl);
      self.resizeWidget(view, containerEl);
      return containerEl;
    },
  });
  CodeBlockWidget.canRenderLang = function (lang) {
    return lang === "mermaid" || lang === "query" || E.Gz.codeBlockPostProcessors.hasOwnProperty(lang);
  };
  Object.defineProperty(CodeBlockWidget.prototype, "estimatedHeight", {
    get() { return 50; },
    enumerable: false,
    configurable: true,
  });
  return CodeBlockWidget;
}
export function s31CodeBlockWidget(host) {
  return s31Cls("v6", s31BuildCodeBlockWidget);
}

// b6: widget for `$...$` / `$$...$$` math spans and blocks.
function s31BuildMathWidget() {
  const E = env();
  function MathWidget(math, block) {
    const self = E.FV.call(this) || this;
    self.math = math;
    self.block = block;
    return self;
  }
  inherit(MathWidget, E.FV);
  Object.defineProperty(MathWidget.prototype, "noReuse", {
    get() { return true; },
    enumerable: false,
    configurable: true,
  });
  methods(MathWidget, {
    initDOM(view) {
      const self = this;
      const containerEl = (self.containerEl = createEl(self.block ? "div" : "span", "math"));
      if (self.block) {
        containerEl.createEl("br");
        containerEl.createEl("br");
        self.addEditButton(view, containerEl);
      }
      self.hookClickHandler(view, containerEl);
      self.resizeWidget(view, containerEl);
      self.render(self.math);
      return containerEl;
    },
    render(math) {
      const self = this;
      E.bz.then(() => {
        const el = self.containerEl;
        const isBlock = self.block;
        el.toggleClass("math-block", isBlock);
        el.toggleClass("cm-embed-block", isBlock);
        const editButton = el.find(".edit-block-button");
        el.empty();
        try {
          el.appendChild(E.kz(math, isBlock));
        } catch (err) {
          el.appendText(math);
        }
        if (editButton) el.appendChild(editButton);
        E.xz();
      });
    },
  });
  Object.defineProperty(MathWidget.prototype, "estimatedHeight", {
    get() { return 50; },
    enumerable: false,
    configurable: true,
  });
  return MathWidget;
}
export function s31MathWidget(host) {
  return s31Cls("b6", s31BuildMathWidget);
}

// k6: widget for inline/block raw HTML embeds.
function s31BuildHtmlEmbedWidget() {
  const E = env();
  function HtmlEmbedWidget(app, editor, html, block) {
    const self = E.FV.call(this) || this;
    self.app = app;
    self.editor = editor;
    self.html = html;
    self.block = block;
    return self;
  }
  inherit(HtmlEmbedWidget, E.FV);
  Object.defineProperty(HtmlEmbedWidget.prototype, "noReuse", {
    get() { return true; },
    enumerable: false,
    configurable: true,
  });
  methods(HtmlEmbedWidget, {
    initDOM(view) {
      const self = this;
      const isBlock = self.block;
      const containerEl = (self.containerEl = createEl(
        isBlock ? "div" : "span",
        "cm-html-embed" + (isBlock ? " cm-embed-block" : "")
      ));
      containerEl.tabIndex = -1;
      containerEl.appendChild(E.xL(self.html));
      if (isBlock) self.addEditButton(view, containerEl);
      self.app.fixFileLinks(containerEl, self.editor.path);
      self.hookClickHandler(view, containerEl);
      self.resizeWidget(view, containerEl);
      return containerEl;
    },
  });
  Object.defineProperty(HtmlEmbedWidget.prototype, "estimatedHeight", {
    get() { return 40; },
    enumerable: false,
    configurable: true,
  });
  return HtmlEmbedWidget;
}
export function s31HtmlEmbedWidget(host) {
  return s31Cls("k6", s31BuildHtmlEmbedWidget);
}

// C6: a widget that renders nothing and swallows events (used for the `-1` side spacer).
function s31BuildEmptyWidget() {
  const E = env();
  function EmptyWidget() {
    return E.Rn.apply(this, arguments) || this;
  }
  inherit(EmptyWidget, E.Rn);
  methods(EmptyWidget, {
    toDOM() { return createSpan(); },
    ignoreEvent() { return true; },
    eq() { return true; },
  });
  return EmptyWidget;
}
export function s31EmptyWidget(host) {
  return s31Cls("C6", s31BuildEmptyWidget);
}

// y6: widget for `> [!type]` callout blocks; extends the embed-block widget (g6).
function s31BuildCalloutWidget() {
  const E = env();
  const Base = s31Cls("g6", s31BuildEmbedBlockWidget);
  function CalloutWidget(app, editor, unknown, text) {
    return Base.call(this, app, editor, text, "cm-callout") || this;
  }
  inherit(CalloutWidget, Base);
  methods(CalloutWidget, {
    getTypePos() {
      const start = this.start;
      const line = this.editor.cm.state.doc.lineAt(start);
      const open = line.text.indexOf("[!") + 2;
      return [open, line.text.indexOf("]", open)];
    },
    getType() {
      const start = this.start;
      const line = this.editor.cm.state.doc.lineAt(start);
      const pos = this.getTypePos();
      return line.text.slice(pos[0], pos[1]);
    },
    updateType(type) {
      const start = this.start;
      const cm = this.editor.cm;
      const pos = this.getTypePos();
      cm.dispatch({ changes: [{ from: start + pos[0], to: start + pos[1], insert: type }] });
    },
    remove() {
      const self = this;
      const start = self.start;
      const end = self.end;
      const cm = self.editor.cm;
      const first = cm.state.doc.lineAt(start);
      const last = cm.state.doc.lineAt(end);
      const changes = [{ from: first.from, to: first.to + 1, insert: "" }];
      for (let num = first.number + 1; num <= last.number; num++) {
        const line = cm.state.doc.line(num);
        const marker = E._A(line.text);
        changes.push({ from: line.from, to: line.from + marker, insert: "" });
      }
      cm.dispatch({ changes });
    },
    initDOM(view) {
      const self = this;
      const el = Base.prototype.initDOM.call(this, view);
      el.on("click", ".task-list-item-checkbox", (evt, target) => {
        let node = target;
        let inside = false;
        for (; node; ) {
          if (node === el) { inside = true; break; }
          if (node.classList.contains("markdown-preview-view")) break;
          const parent = node.parentElement;
          if (!parent) break;
          node = parent;
        }
        if (!inside) return;
        const line = parseInt(target.getAttribute("data-line"));
        if (line < 0 || isNaN(line) || !(target instanceof HTMLInputElement)) return;
        evt.preventDefault();
        navigator.vibrate(100);
        const toggled = E.hq.toggleCheckbox(self.text, line);
        if (toggled === null) return;
        self.text = toggled.text;
        view.dom.win.setTimeout(() => {
          const checked = toggled.char !== " ";
          target.checked = checked;
          const parent = target.parentNode;
          if (parent && parent instanceof HTMLLIElement) {
            parent.setAttr("data-task", toggled.char);
            parent.toggleClass("is-checked", checked);
          }
        }, 0);
        view.dispatch({ changes: [{ from: self.start, to: self.end, insert: toggled.text }] });
      });
      el.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        const type = self.getType();
        const menu = E.Ug.forEvent(evt).setNoIcon().addSections(["edit", "clipboard", "type", "", "danger"]);
        menu.addItem((item) =>
          item
            .setTitle(env().gm.interface.menu.edit())
            .setSection("edit")
            .onClick(() => E.FV.selectElement(view, self.containerEl))
        );
        menu.setSectionSubmenu("type", { title: env().gm.callout.optionType() });
        for (const key of Object.keys(E.W2)) {
          menu.addItem((item) =>
            item
              .setTitle(E.W2[key]())
              .setSection("type")
              .setChecked(key === type)
              .onClick(() => self.updateType(key))
          );
        }
        menu
          .addItem((item) =>
            item
              .setTitle(env().gm.callout.optionOther())
              .setSection("type")
              .onClick(() => new (s31Cls("F6", s31BuildCalloutTypeSuggest))(self.app, (value) => self.updateType(value)).open())
          )
          .addItem((item) =>
            item
              .setTitle(env().gm.callout.type.none())
              .setSection("type")
              .onClick(() => self.remove())
          );
      });
      return el;
    },
  });
  return CalloutWidget;
}
export function s31CalloutWidget(host) {
  return s31Cls("y6", s31BuildCalloutWidget);
}

// F6: suggest modal listing the known callout types plus a free-form "other" entry.
function s31BuildCalloutTypeSuggest() {
  const E = env();
  function CalloutTypeSuggest(app, onSubmit) {
    const self = E.lb.call(this, app) || this;
    self.onSubmit = onSubmit;
    self.setPlaceholder(env().gm.callout.optionOtherPlaceholder());
    self.setInstructions([
      { command: "↑↓", purpose: env().gm.plugins.commandPalette.instructionNavigate() },
      { command: "↵", purpose: env().gm.plugins.commandPalette.instructionUse() },
      { command: "esc", purpose: env().gm.plugins.commandPalette.instructionDismiss() },
    ]);
    self.scope.register(null, "Tab", () => false);
    self.scope.register(null, "Enter", (evt) => {
      if (evt.isComposing) return true;
      self.selectActiveSuggestion(evt);
      return false;
    });
    return self;
  }
  inherit(CalloutTypeSuggest, E.lb);
  methods(CalloutTypeSuggest, {
    getItemText(item) { return item; },
    getItems() { return env()._2; },
    getSuggestions(query) {
      const suggestions = E.lb.prototype.getSuggestions.call(this, query);
      return suggestions.length === 0 ? [{ item: query, match: { score: 0, matches: [] } }] : suggestions;
    },
    onChooseItem(item) { this.onSubmit(item); },
  });
  return CalloutTypeSuggest;
}
export function s31CalloutTypeSuggest(host) {
  return s31Cls("F6", s31BuildCalloutTypeSuggest);
}

// ---------------------------------------------------------------------------
// Fold / selection / task decoration fields (CodeMirror StateField helpers)
// ---------------------------------------------------------------------------

// M6: base decoration field over the fold tree; subclasses implement buildDeco.
function s31BuildFoldDecorations() {
  const E = env();
  function FoldDecorations(view) {
    this.tree = E.tp(view.state);
    this.decorations = this.buildDeco(view);
  }
  FoldDecorations.prototype.update = function (update) {
    const E2 = env();
    const tree = E2.tp(update.state);
    const plugin = update.view.plugin(E2.K2);
    if (tree.length < update.view.viewport.to || update.view.composing || (plugin && plugin.mousedown)) {
      this.decorations = this.decorations.map(update.changes);
    } else if (
      tree != this.tree ||
      update.viewportChanged ||
      update.selectionSet ||
      E2.VA(update.transactions, E2.G2) ||
      E2.VA(update.transactions, E2.EA) ||
      E2.VA(update.transactions, E2.MA)
    ) {
      this.tree = tree;
      this.decorations = this.buildDeco(update.view);
    }
  };
  return FoldDecorations;
}
export function s31FoldDecorations(host) {
  return s31Cls("M6", s31BuildFoldDecorations);
}

// S6: selection + search-match highlight decorations (extends M6).
function s31BuildSelectionDecorations() {
  const E = env();
  const Base = s31Cls("M6", s31BuildFoldDecorations);
  function SelectionDecorations() {
    return Base.apply(this, arguments) || this;
  }
  inherit(SelectionDecorations, Base);
  methods(SelectionDecorations, {
    update(update) {
      const E2 = env();
      if (!update.docChanged && update.selectionSet) {
        const plugin = update.view.plugin(E2.K2);
        if (!(plugin && plugin.mousedown)) {
          const state = update.state;
          const selection = state.selection;
          const decorations = this.decorations;
          let changed = false;
          const clamp = (pos, from, to, assoc, isRange) => {
            if (from <= pos && pos <= to) {
              if (assoc === E2.X2) pos = Math.min(from, pos);
              else if (assoc === E2.Z2) pos = Math.max(to, pos);
              else if (assoc === E2.$2 && isRange) pos = Math.min(from, pos);
            }
            return pos;
          };
          const ranges = selection.ranges.map((range) => {
            const origAnchor = range.anchor;
            const origHead = range.head;
            let anchor = origAnchor;
            let head = origHead;
            const isRange = state.doc.lineAt(anchor).number !== state.doc.lineAt(head).number;
            let moved = false;
            const fix = (from, to, assoc) => {
              const newAnchor = clamp(anchor, from, to, assoc, isRange);
              const newHead = clamp(head, from, to, assoc, isRange);
              if (newAnchor !== anchor || newHead !== head) {
                anchor = newAnchor;
                head = newHead;
                moved = true;
              }
            };
            for (let pass = 0; pass < 10; pass++) {
              moved = false;
              decorations.between(anchor, anchor, fix);
              if (anchor !== head) decorations.between(head, head, fix);
              if (!moved) break;
            }
            return anchor !== origAnchor || head !== origHead ? ((changed = true), E2.pe.range(anchor, head)) : range;
          });
          if (changed) {
            update.view.dom.win.setTimeout(() => {
              if (selection === update.state.selection) {
                update.view.dispatch({ selection: E2.pe.create(ranges, selection.mainIndex) });
              }
            });
          }
        }
      }
      Base.prototype.update.call(this, update);
    },
    buildDeco(view) {
      const E2 = env();
      if (!this.tree.length) return E2.Vn.none;
      const state = view.state;
      const focusedRanges = view.hasFocus ? state.selection.ranges : [];
      const searchField = state.field(E2.xA);
      const searchHighlight = E2.SA.get("basalt-search-match-highlight");
      const isMatch = (from, to) => E2.NA(focusedRanges, from, to) || E2.RA(searchField, searchHighlight, from, to);
      const lineIsMatch = (pos) => {
        const line = state.doc.lineAt(pos);
        return isMatch(line.from, line.to);
      };
      const builder = new E2.ct();
      let lastTo = 0;
      const self = this;
      const processRange = (from, to) => {
        let segStart = from;
        let segEnd = from;
        let pending = null;
        const push = (deco) => {
          if (!pending) pending = [];
          pending.push(deco);
        };
        const flush = (pos) => {
          if (pending) {
            if (isMatch(segStart, segEnd)) {
              for (const item of pending) if (item.always) builder.add(item.from, item.to, item.deco);
            } else {
              if (pending.length > 1) {
                const last = pending[pending.length - 1];
                if (last.deco === E2.X2) last.deco = E2.Z2;
              }
              for (const item of pending) builder.add(item.from, item.to, item.deco);
            }
            pending = null;
          }
          segStart = pos;
          segEnd = pos;
        };
        let urlText = "";
        let inImage = false;
        self.tree.iterate({
          from,
          to,
          enter(node) {
            const type = node.type;
            const nodeFrom = node.from;
            const nodeTo = node.to;
            const props = type.prop(E2.$d);
            const text = () => state.doc.sliceString(nodeFrom, nodeTo);
            if ((nodeFrom === segEnd && props) || flush(nodeFrom), props) {
              if (nodeFrom < lastTo) return;
              lastTo = nodeTo;
              const classList = props.split(" ");
              const classes = new Set(classList);
              if (classes.has("hmd-codeblock")) return;
              if (classes.has("formatting-header")) {
                const line = state.doc.lineAt(nodeFrom);
                if (isMatch(line.from, line.to) || line.text.trim() === text().trim()) {
                  push({ from: nodeFrom, to: nodeTo, deco: E2.$2 });
                }
                return;
              }
              if (classes.has("formatting-quote")) {
                if (!lineIsMatch(nodeFrom)) {
                  push({
                    from: nodeFrom,
                    to: nodeFrom + 1,
                    deco: classes.has("quote-1") ? E2.e6 : E2.i6,
                  });
                }
                return;
              }
              if (classes.has("hmd-escape-backslash") && !lineIsMatch(nodeFrom)) {
                push({ from: nodeFrom, to: nodeTo, deco: E2.X2 });
              }
              const hasHighlightClass = classList.some((cls) => E2.Y2.has(cls));
              let isFormatting = classes.has("formatting");
              const isStringUrl = classes.has("string") && classes.has("url");
              const isLink = classes.has("link") && !classes.has("url") && !isFormatting;
              const isInternalEmbed =
                classes.has("hmd-internal-link") &&
                !classes.has("link-has-alias") &&
                !classes.has("link-alias-pipe") &&
                !classes.has("hmd-embed");
              const isLinkLike = isLink || isInternalEmbed;
              const isImage = classes.has("image");
              const isLinkFormat =
                classes.has("formatting-link") || classes.has("link-has-alias") || classes.has("link-alias-pipe");
              const isTask = classes.has("formatting-task");
              const isLinkEnd = classes.has("formatting-link-end") || isStringUrl;
              const isListUl = classes.has("formatting-list-ul");
              const isBareUrl = classes.has("url") && !classes.has("string");
              if (isImage) inImage = true;
              else if (!inImage && !classes.has("url")) inImage = false;
              if (
                classes.has("formatting-link-start") &&
                state.doc.length >= nodeTo + 2 &&
                state.doc.sliceString(nodeTo, nodeTo + 2) === "]]"
              ) {
                return;
              }
              if (
                classes.has("formatting-link-end") &&
                nodeFrom >= 2 &&
                state.doc.sliceString(nodeFrom - 2, nodeFrom) === "[["
              ) {
                return;
              }
              let isInteresting = isLinkFormat || isStringUrl || isLinkLike || isTask || isListUl || isBareUrl;
              if (classes.has("hmd-barelink") && !classes.has("hmd-footnote")) {
                isFormatting = false;
                isInteresting = false;
              }
              if (isLinkFormat && classes.has("link") && classes.has("url")) {
                if (!isMatch(nodeFrom, nodeTo)) push({ from: nodeFrom, to: nodeTo, deco: E2.J2 });
                if (nodeTo + 1 < state.doc.length && state.doc.sliceString(nodeTo, nodeTo + 1) === ">") {
                  push({ from: nodeTo, to: nodeTo + 1, deco: E2.Z2 });
                }
                segEnd = nodeTo + 1;
                return;
              }
              let linkEnd = isLinkEnd;
              if (
                (isLinkFormat && classes.has("link") && text() === "]") ||
                (isFormatting && isStringUrl && text() === "(")
              ) {
                linkEnd = true;
              }
              if (hasHighlightClass || isInteresting) {
                segEnd = nodeTo;
                if (isFormatting || isInteresting) {
                const deco = { from: nodeFrom, to: nodeTo, deco: linkEnd ? E2.Z2 : E2.X2 };
                if (isTask) {
                  const mark = state.doc.sliceString(nodeFrom + 1, nodeFrom + 2);
                  deco.deco = E2.Vn.widget({ widget: new (env().l6)(mark) });
                } else if (isListUl) {
                  const line = state.doc.lineAt(nodeFrom);
                  const match = line.text.match(env().aP);
                  if (!(match && match[6])) {
                    deco.deco = E2.a6;
                    deco.to = segEnd = nodeFrom + 1;
                  }
                } else if (isLinkLike) {
                  const value = text();
                  if (isInternalEmbed && value.length > 1 && value.startsWith("#")) {
                    push({ from: nodeFrom, to: nodeFrom + 1, deco: E2.X2 });
                    deco.from++;
                  }
                  deco.deco = E2.J2;
                } else if (isBareUrl) {
                  deco.deco = E2.J2;
                }
                push(deco);
                }
              }
              if (classes.has("formatting-list-ol")) {
                segEnd = nodeTo;
                push({ from: nodeFrom, to: nodeTo, deco: E2.s6 });
              }
              if (classes.has("url") && !isFormatting) {
                urlText = text();
              } else if (classes.has("url") && isFormatting && urlText && text() === ")" && !inImage) {
                if (!env().YC(urlText)) {
                  const className =
                    Array.from(classes)
                      .map((cls) => "cm-" + cls)
                      .join(" ") + " external-link";
                  push({
                    from: nodeTo,
                    to: nodeTo,
                    always: true,
                    deco: E2.Vn.widget({ widget: new (env().c6)(className) }),
                  });
                }
                urlText = "";
              } else {
                urlText = "";
              }
            }
          },
        });
        flush(0);
      };
      for (const range of view.visibleRanges) processRange(range.from, range.to);
      return builder.finish();
    },
  });
  return SelectionDecorations;
}
export function s31SelectionDecorations(host) {
  return s31Cls("S6", s31BuildSelectionDecorations);
}

// x6: task-list line decorations (extends M6).
function s31BuildTaskDecorations() {
  const E = env();
  const Base = s31Cls("M6", s31BuildFoldDecorations);
  function TaskDecorations() {
    return Base.apply(this, arguments) || this;
  }
  inherit(TaskDecorations, Base);
  methods(TaskDecorations, {
    buildDeco(view) {
      const E2 = env();
      if (!this.tree.length) return E2.Vn.none;
      const state = view.state;
      const builder = new E2.ct();
      for (const range of view.visibleRanges) {
        this.tree.iterate({
          from: range.from,
          to: range.to,
          enter(node) {
            const type = node.type;
            const at = node.from;
            const props = type.prop(E2.Zd);
            if (props && props.contains("HyperMD-task-line")) {
              const match = state.doc.lineAt(at).text.match(E2.aP);
              if (match && match[6]) {
                builder.add(at, at, E2.Vn.line({ attributes: { "data-task": match[6] } }));
              }
            }
          },
        });
      }
      return builder.finish();
    },
  });
  return TaskDecorations;
}
export function s31TaskDecorations(host) {
  return s31Cls("x6", s31BuildTaskDecorations);
}

// ---------------------------------------------------------------------------
// Small declarator values and function expressions
// ---------------------------------------------------------------------------

// w6: tag names that must never be rendered inside HTML embeds.
export const s31HtmlTagBlocklist = ["script", "style", "link", "meta", "object", "embed", "webview"];

// _6: the print-modal command id, resolved lazily like the original declarator.
export function s31PrintModalCommand() {
  return env().gm.editor.printModal;
}

// E6: spacer widget spec registered on the `-1` side.
export function s31EmptyWidgetSide() {
  return env().Vn.widget({ widget: new (s31Cls("C6", s31BuildEmptyWidget))(), side: -1 });
}

// D6: schedules a fold-refresh effect dispatch after the current event loop turn.
export function s31PostProcessRefresh(view) {
  view.dom.win.setTimeout(() => view.dispatch({ effects: env().G2.of() }), 10);
}

// P6: editor extension factory that re-dispatches the refresh effect on post-processor changes.
export function s31PostProcessorPlugin(owner) {
  const E = env();
  return E.ji.define(function (view) {
    const registration = owner.app.workspace.on("post-processor-change", () => s31PostProcessRefresh(view));
    return {
      destroy() {
        registration.e.offref(registration);
      },
    };
  });
}

// L6 / I6: decoration fields for selection highlights and task list markers.
export function s31SelectionField() {
  const E = env();
  return E.ji.define(
    function (view) {
      return new (s31Cls("S6", s31BuildSelectionDecorations))(view);
    },
    { decorations: function (field) { return field.decorations; } }
  );
}
export function s31TaskField() {
  const E = env();
  return E.ji.define(
    function (view) {
      return new (s31Cls("x6", s31BuildTaskDecorations))(view);
    },
    { decorations: function (field) { return field.decorations; } }
  );
}

// A6: the list of always-on editor extensions (mousedown selection guard, focus/blur refresh).
export function s31EditorExtensions() {
  const E = env();
  return [
    E.ji.define(function (view) {
      const capture = { capture: true };
      const onMouseDown = (evt) => {
        if (evt.button !== 0) return;
        if (view.scrollDOM.scrollHeight > view.scrollDOM.clientHeight) {
          if (evt.clientX > view.scrollDOM.getBoundingClientRect().x + view.scrollDOM.clientWidth) return;
        }
        const selection = view.state.selection;
        const doc = view.state.doc;
        const scrollTop = view.scrollDOM.scrollTop;
        const plugin = view.plugin(E.K2);
        if (plugin) {
          plugin.mousedown = true;
          const dom = view.scrollDOM.doc;
          const finish = () => {
            dom.removeEventListener("mouseup", onUp, capture);
            dom.removeEventListener("drag", onDrag, capture);
            plugin.mousedown = false;
            if (!(view.state.selection.eq(selection) && view.state.doc.eq(doc) && view.scrollDOM.scrollTop === scrollTop)) {
              view.dom.win.setTimeout(() => {
                view.dispatch({ annotations: [E.AA.of(true)], selection: view.state.selection });
              }, 50);
            }
          };
          const onUp = (up) => {
            if (up.button === 0) finish();
          };
          const onDrag = () => finish();
          dom.addEventListener("mouseup", onUp, capture);
          dom.addEventListener("drag", onDrag, capture);
        }
      };
      view.scrollDOM.addEventListener("mousedown", onMouseDown, capture);
      return {
        destroy() {
          view.scrollDOM.removeEventListener("mousedown", onMouseDown, capture);
        },
      };
    }),
    E._o.domEventHandlers({
      focus(event, view) {
        return s31PostProcessRefresh(view);
      },
      blur(event, view) {
        return s31PostProcessRefresh(view);
      },
      mousedown(event) {
        if (event.button === 0 && (E.Bg.isModifier(event, "Mod") || (!event.shiftKey && !event.altKey))) {
          const target = event.targetNode;
          if (target instanceof Element) {
            const draggable = target.matchParent('[draggable="true"]');
            if (draggable) {
              draggable.setAttr("contenteditable", "false");
              const original = event.preventDefault;
              event.preventDefault = function () {
                event.preventDefault = original;
              };
              return true;
            }
          }
        }
        return undefined;
      },
    }),
  ];
}
