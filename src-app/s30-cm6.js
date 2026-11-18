// Slice s30 — CodeMirror glue and the editor's live-preview decoration widgets.
//
// Two groups of inherited items live here:
//  * the CM6 compatibility shim (require() maps for @codemirror/* and @lezer/*,
//    the PluginField stub, the tree.iterate warning wrapper and the
//    sourceMappingURL helpers used when snippets are written to disk);
//  * the decorations and widgets the markdown editor builds for rendered
//    syntax (underline/escape marks, blockquote border, horizontal rule,
//    task-list checkbox, code-block flair, generic style span, image embed
//    and its context menu / file picker), plus the callout type tables.
//
// App-scope values arrive through env() (envBind aliases) or through the
// declarator arguments the manifest splices in at the original position.

import { inherit } from "./inherit.js";
import { env } from "./env.js";

const s30E = () => env();

// ---------------------------------------------------------------- CM6 shim

/** Error detail appended to the "tree.iterate has changed syntax" warning (z0). */
export const s30CmIterateErrorText =
  "See the stack trace to find the faulty plugin and file an issue with the plugin author. \n" +
  "Details: https://discuss.codemirror.net/t/release-0-20-0/4302";

/** Shared stub used for PluginField.define/decorations/atomicRanges/scrollMargins (U0). */
export const s30CmPluginFieldStub = { from: function () {} };

/** require() map for the supported @codemirror/* and @lezer/* packages (W0). */
export function s30CmRequireMap(obsidian, autocomplete, collab, commands, language, lint, search, state, text, view, common, lr, highlight) {
  return {
    obsidian: obsidian,
    "@codemirror/autocomplete": autocomplete,
    "@codemirror/collab": collab,
    "@codemirror/commands": commands,
    "@codemirror/language": language,
    "@codemirror/lint": lint,
    "@codemirror/search": search,
    "@codemirror/state": state,
    "@codemirror/text": text,
    "@codemirror/view": view,
    "@lezer/common": common,
    "@lezer/lr": lr,
    "@lezer/highlight": highlight,
  };
}

/** require() map for the deprecated package names (still resolved, with a warning) (_0). */
export function s30CmRequireMapDeprecated(closebrackets, comment, fold, gutter, highlight, history, matchbrackets, panel, rangeset, rectangularSelection, streamParser, tooltip) {
  return {
    "@codemirror/closebrackets": closebrackets,
    "@codemirror/comment": comment,
    "@codemirror/fold": fold,
    "@codemirror/gutter": gutter,
    "@codemirror/highlight": highlight,
    "@codemirror/history": history,
    "@codemirror/matchbrackets": matchbrackets,
    "@codemirror/panel": panel,
    "@codemirror/rangeset": rangeset,
    "@codemirror/rectangular-selection": rectangularSelection,
    "@codemirror/stream-parser": streamParser,
    "@codemirror/tooltip": tooltip,
  };
}

/** Matches an inline sourceMappingURL comment (Q0). */
export const s30CmSourceMapPattern = /^\/\/[@#] sourceMappingURL=data:application\/json(?:;charset[:=][^;]+)?;base64,.*$/gm;

/** Marker appended so written snippets opt out of source maps (X0). */
export const s30CmNoSourceMap = "\n/* nosourcemap */";

/** Captures Tree.prototype.iterate before the compatibility patch replaces it (q0). */
export function s30CmTreeIterate(proto) {
  return proto.iterate;
}

/** Wraps one iterate callback so plugins using the old enter/leave signature log a warning (j0). */
export function s30CmIterateWrapper(fn) {
  return function (range) {
    console.error(new Error("[CM6] tree.iterate has changed syntax.\n".concat(s30CmIterateErrorText)));
    fn.call(this, range.type, range.from, range.to);
  };
}

/** StateEffect that forces the editor to drop cached syntax information (G2). */
export function s30CmClearCacheEffect(StateEffect) {
  return StateEffect.define();
}

/** ViewPlugin tracking whether the mouse button is down inside the editor (K2). */
export function s30CmMousePlugin(ViewPlugin) {
  return ViewPlugin.define(function () {
    return { mousedown: false };
  });
}

// ---------------------------------------------------------------- callouts

/** Callout type display names keyed by type id; values are i18n functions (W2). */
export function s30CalloutTypeMap() {
  const t = s30E().gm.callout.type;
  return {
    info: t.info,
    important: t.important,
    tip: t.tip,
    success: t.success,
    question: t.question,
    warning: t.warning,
    example: t.example,
    quote: t.quote,
  };
}

/** Every callout type name the picker offers: the titled types plus the extra aliases (_2). */
export function s30CalloutTypeNames() {
  return Object.keys(s30CalloutTypeMap()).concat([
    "abstract", "summary", "tldr", "todo", "hint", "check", "done", "question", "faq", "help",
    "caution", "attention", "failure", "fail", "missing", "danger", "error", "bug", "example", "cite",
  ]);
}

// ---------------------------------------------------------------- decorations

/** Mark spec for underlined (toggleable) text: J2. */
export function s30CmUnderlineMark(Decoration) {
  return Decoration.mark({ class: "cm-underline", attributes: { tabIndex: "-1", draggable: "true" } });
}

/** Transparent mark used for escaped characters: e6. */
export function s30CmTransparentMark(Decoration) {
  return Decoration.mark({ class: "cm-transparent" });
}

/** Mark for links the metadata cache cannot resolve: t6. */
export function s30CmUnresolvedMark(Decoration) {
  return Decoration.mark({ class: "is-unresolved" });
}

/** Bullet marker for unordered lists: a6. */
export function s30CmListBulletMark(Decoration) {
  return Decoration.mark({ class: "list-bullet" });
}

/** Marker for ordered lists: s6. */
export function s30CmListNumberMark(Decoration) {
  return Decoration.mark({ class: "list-number" });
}

/** Empty replace decoration; each call produces its own instance like the original (X2/$2/Z2). */
export function s30CmEmptyReplace(Decoration) {
  return Decoration.replace({});
}

/** Replace decoration drawing the blockquote border widget: i6. */
export function s30CmBlockquoteReplace(Decoration, widget) {
  return Decoration.replace({ widget: new widget() });
}

/** Set of node names that count as inline formatting for the editor's mark logic (Y2). */
export const s30CmInlineMarkNames = new Set([
  "em", "strong", "inline-code", "strikethrough", "highlight", "link", "image",
  "hmd-internal-link", "hmd-embed", "formatting-link", "footref",
]);

/** Fence opener pattern used to detect the language of a code block (Q2). */
export const s30CmFencePattern = /^\s*(~~~+|```+)[ \t]*([\w\/+#-]*)[^\n`]*$/;

// ---------------------------------------------------------------- widgets

let s30Widgets = null;
let s30WidgetsHost = null;

function s30WidgetClasses(host) {
  if (host) s30WidgetsHost = host;
  if (s30Widgets) return s30Widgets;
  const H = s30WidgetsHost || {};
  const Rn = s30E().s30Rn;
  const FV = s30E().s30FV;

  // Draws the ">" gutter line next to blockquotes (n6).
  function CmBlockquoteBorderWidget() {
    const self = Rn.call(this) || this;
    return self;
  }
  inherit(CmBlockquoteBorderWidget, Rn);
  CmBlockquoteBorderWidget.prototype.toDOM = function () {
    return createSpan({ cls: "cm-blockquote-border cm-transparent", text: ">" });
  };

  // Whole-line widget for horizontal rules; clicking selects the line (r6).
  function CmHrWidget() {
    const self = Rn.call(this) || this;
    return self;
  }
  inherit(CmHrWidget, Rn);
  CmHrWidget.prototype.eq = function () { return true; };
  CmHrWidget.prototype.toDOM = function (view) {
    const el = createDiv("hr cm-line");
    el.createEl("br");
    el.addEventListener("click", function () {
      const pos = view.posAtDOM(el);
      const line = view.state.doc.lineAt(pos);
      view.dispatch({ selection: { head: line.from, anchor: line.to } });
    });
    el.createEl("hr");
    return el;
  };
  CmHrWidget.prototype.destroy = function (dom) { dom.detach(); };
  Object.defineProperty(CmHrWidget.prototype, "estimatedHeight", { get: function () { return 20; }, enumerable: false, configurable: true });

  // Checkbox widget for task list items (l6).
  function CmTaskListWidget(content) {
    const self = Rn.call(this) || this;
    self.content = content;
    return self;
  }
  inherit(CmTaskListWidget, Rn);
  CmTaskListWidget.prototype.eq = function (other) { return other.content === this.content; };
  CmTaskListWidget.prototype.updateDOM = function (el) {
    if (el.instanceOf(HTMLLabelElement) && el.firstChild && el.firstChild.instanceOf(HTMLInputElement)) {
      const input = el.firstChild;
      input.setAttribute("data-task", this.content);
      input.checked = " " !== this.content;
      return true;
    }
    return false;
  };
  CmTaskListWidget.prototype.toDOM = function (view) {
    const self = this;
    const label = createEl("label", "task-list-label");
    const input = label.createEl("input", { cls: "task-list-item-checkbox", type: "checkbox" });
    input.setAttribute("data-task", this.content);
    input.checked = " " !== this.content;
    label.addEventListener("mousedown", function (e) { e.preventDefault(); });
    input.addEventListener("input", function () {
      const pos = view.posAtDOM(input);
      const line = view.state.doc.lineAt(pos);
      const at = line.text.search(/\[.]/);
      if (-1 === at) return;
      const marker = line.text.charAt(at + 1);
      const from = line.from + at + 1;
      navigator.vibrate(100);
      view.dispatch({ changes: [{ from: from, to: from + 1, insert: " " === marker ? "x" : " " }] });
      if (s30E().Yl.isAndroidApp) {
        const top = view.scrollDOM.scrollTop;
        const unlock = function (e) { clear(); e.preventDefault(); view.scrollDOM.scrollTop = top; };
        const clear = function () { view.scrollDOM.removeEventListener("scroll", unlock, { capture: true }); };
        view.scrollDOM.addEventListener("scroll", unlock, { capture: true, passive: false });
        input.win.setTimeout(clear, 200);
      }
    });
    return label;
  };

  // Widget carrying an arbitrary class list (c6).
  function CmStyleWidget(styles) {
    const self = Rn.call(this) || this;
    self.styles = styles;
    return self;
  }
  inherit(CmStyleWidget, Rn);
  CmStyleWidget.prototype.eq = function (other) { return this.styles === other.styles; };
  CmStyleWidget.prototype.toDOM = function () { return createSpan(this.styles); };
  CmStyleWidget.prototype.ignoreEvent = function () { return false; };

  // Language flair + copy button shown on fenced code blocks (u6).
  function CmCodeFlairWidget(lang, code) {
    const self = Rn.call(this) || this;
    self.lang = lang;
    self.code = code;
    return self;
  }
  inherit(CmCodeFlairWidget, Rn);
  CmCodeFlairWidget.prototype.eq = function (other) { return other.lang === this.lang && other.code === this.code; };
  CmCodeFlairWidget.prototype.toDOM = function () {
    const self = this;
    const el = createSpan({ cls: "code-block-flair", text: this.lang });
    if (!this.lang) s30E().tv(el, "lucide-copy");
    s30E().Mv(el, s30E().gm.interface.menu.copy());
    el.addEventListener("click", function () {
      let code = self.code;
      if (code.endsWith("\n")) code = code.substr(0, code.length - 1);
      navigator.clipboard.writeText(code).then(function () {
        new (s30E().fb)(s30E().gm.interface.copied({ context: "generic" }));
      });
    });
    return el;
  };

  // Image embed widget (f6); extends the shared embed widget base.
  function CmImageEmbedWidget(url, title) {
    const self = FV.call(this) || this;
    self.url = url;
    self.title = title;
    return self;
  }
  inherit(CmImageEmbedWidget, FV);
  Object.defineProperty(CmImageEmbedWidget.prototype, "noReuse", { get: function () { return true; }, enumerable: false, configurable: true });
  CmImageEmbedWidget.prototype.initDOM = function (editor) {
    let el;
    const embed = s30E().s30Az(this.url);
    if (embed) {
      el = s30E().s30Pz(embed);
    } else {
      el = createDiv("image-embed");
      el.tabIndex = -1;
      const wrapper = el.createDiv("image-wrapper");
      const img = this.imageEl = wrapper.createEl("img");
      img.src = this.url;
      this.applyTitle(this.title);
      s30ImageContextMenu(this, editor, el, img, wrapper);
    }
    this.addEditButton(editor, el);
    this.resizeWidget(editor, el);
    return el;
  };
  CmImageEmbedWidget.prototype.applyTitle = function (title) {
    this.title = title;
    const img = this.imageEl;
    if (!img) return;
    let w = 0, h = 0;
    const readDim = function (text) {
      const dim = s30E().s30Zx(text);
      if (dim) { w = dim.x; h = dim.y; return true; }
      return false;
    };
    if (title) {
      const at = title.lastIndexOf("|");
      if (-1 !== at) {
        if (readDim(title.substr(at + 1))) title = title.substr(0, at);
      } else if (readDim(title)) {
        title = "";
      }
    }
    if (!title) title = s30E().nu(this.url);
    img.setAttr("width", 0 === w ? null : String(w));
    img.setAttr("height", 0 === h ? null : String(h));
    img.setAttr("alt", title);
  };
  Object.defineProperty(CmImageEmbedWidget.prototype, "estimatedHeight", { get: function () { return 30; }, enumerable: false, configurable: true });

  // File picker used to choose the attachment for an image embed (p6).
  const QuickSwitcherBase = H.s13QuickSwitcherModalBase;
  let CmFileSuggestModal = null;
  if (QuickSwitcherBase) {
  function CmFileSuggestModal_(app, handleChoose) {
    const self = QuickSwitcherBase.call(this, app) || this;
    self.emptyStateText = s30E().gm.plugins.noteComposer.labelNoFiles();
    self.context = "embed";
    self.shouldShowImages = true;
    self.allowCreateNewFile = false;
    self.shouldShowUnresolved = false;
    self.shouldShowMarkdown = false;
    self.shouldShowNonImageAttachments = false;
    self.shouldShowNonAttachments = false;
    self.shouldShowAllTypes = false;
    self.handleChoose = handleChoose;
    self.setPlaceholder(s30E().gm.interface.mobile.actionChooseFileToInsert());
    self.setInstructions([
      { command: "↑↓", purpose: s30E().gm.plugins.quickSwitcher.instructionNavigate() },
      { command: "↵", purpose: s30E().gm.plugins.quickSwitcher.instructionSelect() },
      { command: "esc", purpose: s30E().gm.plugins.quickSwitcher.instructionDismiss() },
    ]);
    return self;
  }
  inherit(CmFileSuggestModal_, QuickSwitcherBase);
  CmFileSuggestModal_.prototype.onChooseSuggestion = function (item) {
    if ("file" !== item.type && "alias" !== item.type) return;
    this.handleChoose(item.file);
    this.app.workspace.addRecentFile(item.file);
  };
  CmFileSuggestModal = CmFileSuggestModal_;
  }

  s30Widgets = {
    n6: CmBlockquoteBorderWidget,
    r6: CmHrWidget,
    l6: CmTaskListWidget,
    c6: CmStyleWidget,
    u6: CmCodeFlairWidget,
    f6: CmImageEmbedWidget,
    p6: CmFileSuggestModal,
  };
  return s30Widgets;
}

// One exported factory per replaced declarator; all share the single builder.
export function defineCmBlockquoteWidget(host) { return s30WidgetClasses(host).n6; }
export function defineCmHrWidget(host) { return s30WidgetClasses(host).r6; }
export function defineCmTaskWidget(host) { return s30WidgetClasses(host).l6; }
export function defineCmStyleWidget(host) { return s30WidgetClasses(host).c6; }
export function defineCmCodeFlairWidget(host) { return s30WidgetClasses(host).u6; }
export function defineCmImageEmbedWidget(host) { return s30WidgetClasses(host).f6; }
export function defineCmFileSuggestModal(host) { return s30WidgetClasses(host).p6; }

/** The shared hr widget instance used for every horizontal rule (o6). */
export function s30CmHrWidgetInstance() {
  return new (s30WidgetClasses(null).r6)();
}

// ---------------------------------------------------------------- helpers

/** Rewrites the text inside an embed/link so an explicit size survives re-renders (h6). */
const S30_FI = /^(!?\[\[)(.*?)(\|(.*))?(]])$/;
const S30_PT = /^(!?\[)(.*?)(]\(\s*)((<[^>]*?>|[^ "]+?)(\s+([^ ]+|"[^"]+"|'[^']+'|\([^']+\)))?)?(\s*\))$/;

export function s30EmbedLinkText(text, size) {
  const withSize = function (inner) {
    if (!inner || s30E().s30Zx(inner)) return void 0 === size ? "" : String(size);
    const suffix = void 0 === size ? "" : "|".concat(size);
    const at = inner.lastIndexOf("|");
    if (-1 !== at && s30E().s30Zx(inner.slice(at + 1))) return inner.slice(0, at) + suffix;
    return inner + suffix;
  };
  let m = text.match(S30_FI);
  if (m) {
    const label = m[2];
    const sized = withSize(null != m[4] ? m[4] : "");
    return "![[" + label + (sized ? "|" + sized : "") + "]]";
  }
  if ((m = text.match(S30_PT))) {
    const bang = m[1], label = m[2], open = m[3], target = m[4], tail = m[8];
    return bang + withSize(label) + open + target + tail;
  }
  return text;
}

/** Clipboard accessor matching the platform rule used across the app (Qf). */
function s30Clipboard() {
  return s30E().qf < 40 ? s30E().electron.clipboard : s30E().electron.remote.clipboard;
}

function s30IsImageMime(ext) {
  const map = s30E().s30du;
  for (const mime in map) {
    if (Object.hasOwn(map, mime) && map[mime] === ext) return mime;
  }
  return "";
}

function s30CopyFailed() {
  return new (s30E().fb)(s30E().gm.interface.copy_failed());
}

/** Context menu + drag-to-resize wiring for image embeds (d6). */
export function s30ImageContextMenu(widget, editor, containerEl, imgEl, wrapperEl) {
  wrapperEl.addEventListener("contextmenu", function (e) {
    const menu = s30E().Ug.forEvent(e);
    menu.setParentElement(containerEl);
    menu.addSections(["image"]);
    menu.addItem(function (item) {
      return item.setSection("image").setTitle(s30E().gm.interface.menu.copyImage()).setIcon("lucide-copy").onClick(function () {
        return (async function () {
          try {
            let data;
            let mime = "image/png";
            if (widget instanceof s30E().s30m6 && widget.child instanceof s30E().s30tJ && widget.child.file) {
              const file = widget.child.file;
              data = await widget.app.vault.readBinary(file);
              mime = s30IsImageMime(file.extension) || "image/png";
            } else if (widget instanceof s30WidgetClasses(null).f6) {
              const res = await s30E().s30hy(widget.url);
              data = res.arrayBuffer;
              const ct = res.headers[s30E().s30qV(res.headers, "content-type")];
              if (ct && ct.startsWith("image/")) mime = ct;
            }
            if (data) {
              if (!s30E().Yl.isDesktopApp || ("image/png" !== mime && "image/jpeg" !== mime)) {
                mime = "image/png";
                const blob = {};
                blob[mime] = new Blob([data], { type: mime });
                await navigator.clipboard.write([new ClipboardItem(blob)]);
              } else {
                const buf = s30E().s30vu(data);
                const img = s30E().electron.nativeImage.createFromBuffer(buf);
                s30Clipboard().writeImage(img);
              }
              return;
            }
          } catch (err) {
            // fall through to the failure notice
          }
          s30CopyFailed();
        })();
      });
    });
    if (widget instanceof s30E().s30m6) {
      const app = widget.app, href = widget.href, sourcePath = widget.sourcePath;
      widget.app.workspace.handleLinkContextMenu(menu, href, sourcePath);
      menu.addItem(function (item) {
        return item.setSection("image").setTitle(s30E().gm.plugins.canvas.actionSwapFile()).setIcon("lucide-arrow-left-right").onClick(function () {
          const w = widget;
          new (s30WidgetClasses(null).p6)(w.app, function (file) {
            const start = w.start, end = w.end, title = w.title;
            const link = w.app.fileManager.generateMarkdownLink(file, sourcePath, void 0, title);
            editor.dispatch({ changes: [{ from: start, to: end, insert: "!" + link }], scrollIntoView: false });
          }).open();
        });
      });
    }
    if (null !== imgEl.getAttribute("width")) {
      menu.addItem(function (item) {
        return item.setSection("image").setTitle(s30E().gm.editor.menu.resetSize()).setIcon("lucide-rotate-ccw").onClick(function () {
          const start = widget.start, end = widget.end;
          const text = editor.state.doc.sliceString(start, end);
          const rewritten = s30EmbedLinkText(text);
          editor.dispatch({ changes: [{ from: start, to: end, insert: rewritten }] });
          imgEl.removeAttribute("width");
        });
      });
    }
    if (widget instanceof s30E().s30m6) {
      const app = widget.app, href = widget.href, sourcePath = widget.sourcePath;
      const dest = s30E().MT(href).path;
      const target = app.metadataCache.getFirstLinkpathDest(dest, sourcePath);
      menu.addItem(function (item) {
        return item.setSection("danger").setTitle(s30E().gm.editor.menu.deleteImage()).setWarning(true).setIcon("lucide-trash-2").onClick(function () {
          return (async function () {
            const start = widget.start, end = widget.end;
            if (await app.fileManager.promptForDeletion(target)) {
              editor.dispatch({ userEvent: "select.pointer", selection: s30E().pe.cursor(start), changes: [{ from: start, to: end, insert: "" }] });
            }
          })();
        });
      });
    }
    if (!s30E().Yl.isMobile) {
      wrapperEl.createDiv("image-resize-corner", function (corner) {
        corner.addEventListener("dblclick", function (e) {
          if (e.defaultPrevented) return;
          const start = widget.start, end = widget.end;
          const text = editor.state.doc.sliceString(start, end);
          const rewritten = s30EmbedLinkText(text);
          if (text !== rewritten) editor.dispatch({ changes: [{ from: start, to: end, insert: rewritten }] });
        });
        corner.addEventListener("pointerdown", function (e) {
          if (!e.isPrimary || 0 !== e.button) return;
          e.preventDefault();
          containerEl.focus();
          let pos = s30E().s30Fl(e);
          const startW = imgEl.offsetWidth, startH = imgEl.offsetHeight;
          const rtl = "rtl" === getComputedStyle(containerEl).direction;
          const rect = imgEl.getBoundingClientRect();
          const originX = rtl ? rect.right : rect.left;
          const originY = rect.top;
          const maxW = editor.contentDOM.offsetWidth;
          const ratio = startW / startH;
          let raf = null;
          s30E().s30Cg(e, function () {
            return {
              move: function (ev) {
                pos = s30E().s30Fl(ev);
                if (!raf) {
                  raf = requestAnimationFrame(function () {
                    const dx = Math.abs(pos.x - originX);
                    const dy = Math.abs(pos.y - originY);
                    const size = Math.max(dx, dy * ratio);
                    imgEl.width = Math.round(Math.min(Math.max(size, 20), maxW));
                    raf = null;
                  });
                }
              },
              end: function () {
                const start = widget.start, end = widget.end;
                const text = editor.state.doc.sliceString(start, end);
                const rewritten = s30EmbedLinkText(text, Math.round(imgEl.clientWidth));
                if (text !== rewritten) editor.dispatch({ changes: [{ from: start, to: end, insert: rewritten }] });
              },
              cleanup: function () {
                if (raf) { cancelAnimationFrame(raf); raf = null; }
              },
            };
          }, 0);
        });
      });
    }
  });
}
