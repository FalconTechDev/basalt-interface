// Live-preview decoration engine: the syntax-tree walker that turns HyperMD
// markup nodes into widgets (links, embeds, images, math, code blocks,
// callouts, tables, HTML blocks) plus the plugin assembly that adds arrow-key
// block navigation, vim hooks and mobile cursor drag support.
//
// Widget classes themselves (link/math/image/table/codeblock renderers) remain
// host-provided; this module owns the traversal, reuse, coverage and
// decoration-placement logic.

// tP: end offset of the leading --- frontmatter block, or -1.
function docFrontmatterEnd(doc) {
  let end = -1;
  if (doc.line(1).text === "---") {
    for (let n = 2; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (line.text === "---") { end = line.to; break; }
    }
  }
  return end;
}

// eP: true when pos sits on the same visual line as just past the frontmatter end.
function sameLineAsDocEnd(view, pos) {
  const a = view.coordsAtPos(pos);
  if (!a) return false;
  const b = view.coordsAtPos(docFrontmatterEnd(view.state.doc) + 1);
  return !!b && b.top === a.top;
}

// NA: any selection range fully contains [from,to).
function selectionCovers(ranges, from, to, host) {
  for (const r of ranges) if (host.cmRangeContains(r, from, to)) return true;
  return false;
}

// RA: highlight field has a marked range covering [from,to).
function highlightCovers(field, mark, from, to) {
  let found = false;
  field.between(from, to, (s, e, spec) => { if (spec === mark) { found = true; return false; } });
  return found;
}

// VA: any transaction carries the given effect.
function hasEffect(transactions, effect) {
  return transactions.some((tr) => tr.effects.some((ef) => ef.is(effect)));
}

// $I: owner component currently hosts a live MetadataEditor.
function metadataEditorActive(owner, host) {
  return !!owner && typeof owner === "object" && Object.hasOwn(owner, "metadataEditor")
    && owner.metadataEditor instanceof defineMetadataEditor(host);
}

// nE: "a#b#c" -> "a > b > c" (heading path display form).
function headingPath(text) {
  return text.split("#").filter((p) => !!p).join(" > ").trim();
}

// JC: normalize a link target (nbsp collapse + NFC).
function normalizeLinkTarget(text) {
  return text.replace(/ /g, " ").trim().normalize("NFC");
}

// iE: parse "target|alias" / "target#heading" widget source text.
function parseLinkToken(text) {
  let title = "", pipe = text.indexOf("|"), isAlias = pipe > 0;
  if (isAlias) {
    title = text.substring(pipe + 1).trim();
    text = text.substring(0, pipe).trim();
  } else {
    title = headingPath(text = text.trim());
  }
  if (text.endsWith("\\")) text = text.substring(0, text.length - 1);
  return { href: normalizeLinkTarget(text), title, isAlias };
}

export function livePreviewDecorations(component, view, host) {
  const app = component.app;
  const depth = embedDepthAt(component.cm.scrollDOM, host);
  let links = [], codeblocks = [], tables = [], callouts = [], maths = [], htmls = [], images = [];
  let computing = false;
  const removeChildren = (list) => {
    for (const group of list) for (const child of group.children) component.removeChild(child);
  };
  component.cleanupLivePreview = () => {
    removeChildren(links); links = [];
    removeChildren(codeblocks); codeblocks = [];
    removeChildren(callouts); callouts = [];
    removeChildren(tables); tables = [];
    maths = []; htmls = []; images = [];
  };

  const build = (update) => {
    const state = update.state, tree = host.cmSyntaxTree(state), doc = state.doc;
    const selRanges = view.hasFocus ? state.selection.ranges : [];
    const hiState = state.field(host.cmHighlightState);
    const searchMark = host.highlightCache.get("basalt-search-match-highlight");
    const covered = (from, to) =>
      selectionCovers(selRanges, from, to, host) || highlightCovers(hiState, searchMark, from, to);
    const replaceSpec = (spec, from, to) => {
      if (spec.block && to === doc.length) spec.inclusiveEnd = false;
      return host.cmDecoration.replace(spec).range(from, to);
    };
    const sourcePath = component.path;
    const decos = [];
    const oldLinks = links.slice(); links = [];
    const oldCodeblocks = codeblocks.slice(); codeblocks = [];
    const oldCallouts = callouts.slice(); callouts = [];
    const oldTables = tables.slice(); tables = [];
    const oldMaths = maths.slice(); maths = [];
    const oldHtmls = htmls.slice(); htmls = [];
    const oldImages = images.slice(); images = [];
    let inLink = false, linkStart = -1, linkEnd = -1, linkIsEmbed = false, linkText = "", linkAliasEnd = -1;
    let inImage = false, imagePos = -1, imageAlt = "", imageUrl = "";
    let inHtml = -1, htmlTag = "";
    let inMath = -1, mathStart = -1, mathBlock = false;
    let inCallout = -1, calloutEnd = -1;
    let inTable = -1, tableEnd = -1;
    let inCodeblock = -1, codeblockLang = "";

    const widgetForLink = (source, from, to) => {
      const parsed = parseLinkToken(source), href = parsed.href, title = parsed.title;
      let w = oldLinks.find((x) => x.sourcePath === sourcePath && x.href === href);
      if (w) {
        if (w.title !== title && w.containerEl) w.applyTitle(w.containerEl, title);
      } else {
        w = new host.livePreviewLinkWidget(app, component, sourcePath, href, title, depth);
      }
      w.setPos(from, to);
      links.push(w);
      return w;
    };

    // place a widget decoration, preferring block placement at line end when
    // the remainder of the line is blank.
    const placeWidget = (widget, from, to) => {
      const line = doc.lineAt(from), lineFrom = line.from, lineTo = line.to, text = line.text;
      const atLineStartBlank = from === lineFrom && text.substr(to - lineFrom).trim() === "";
      if (atLineStartBlank) {
        if (covered(lineFrom, lineTo)) decos.push(host.cmDecoration.widget({ widget, block: true, side: 1 }).range(lineTo));
        else decos.push(replaceSpec({ widget, block: true, side: 1 }, lineFrom, lineTo));
      } else if (covered(from, to)) {
        decos.push(host.cmDecoration.widget({ widget, side: 1 }).range(to));
      } else {
        decos.push(replaceSpec({ widget, side: 1 }, from, to));
      }
    };

    const closeCallout = (pos) => {
      if (inCallout === -1 || calloutEnd >= pos) return;
      const text = doc.sliceString(inCallout, calloutEnd);
      const suppressed = highlightCovers(hiState, searchMark, inCallout, calloutEnd);
      const w = oldCallouts.find((x) => x.text === text) ||
        (suppressed ? null : new host.livePreviewCalloutWidget(app, component, view, text));
      if (!suppressed) decos.push(replaceSpec({ widget: w, side: 1, block: true }, inCallout, calloutEnd));
      if (w) { w.setPos(inCallout, calloutEnd); callouts.push(w); }
      inCallout = -1; calloutEnd = -1;
    };

    const closeTable = (pos) => {
      if (inTable === -1 || tableEnd >= pos) return;
      const text = doc.slice(inTable, tableEnd);
      const complete = tableEnd !== tree.length - 1 || tree.length === doc.length;
      let w = null;
      const mappedStart = update.changes.invertedDesc.mapPos(inTable);
      for (const cand of oldTables) {
        const cs = cand.start;
        if (mappedStart === cs || inTable === cs || (update.changes.length >= cs && inTable === update.changes.mapPos(cs))) {
          if (complete ? cand.receiveUpdate(update, text) : (!update.docChanged || cand.receiveIncompleteUpdate(update, text))) {
            w = cand; oldTables.remove(cand); break;
          }
        }
      }
      if (!highlightCovers(hiState, searchMark, inTable, tableEnd)) {
        if (!w) w = new host.tableWidget(app, component, text, complete);
        const inclusiveStart = inTable > 0 && inTable > docFrontmatterEnd(update.newDoc) + 1;
        decos.push(replaceSpec({ widget: w, side: 1, block: true, inclusiveStart }, inTable, tableEnd));
        if (host.Platform.isAndroidApp && tableEnd !== doc.length) decos.push(host.livePreviewAndroidWidget.range(tableEnd + 1));
      }
      if (w) { w.setPos(inTable, tableEnd); w.receiveSelection(update); tables.push(w); }
      inTable = -1; tableEnd = -1;
    };

    tree.iterate({
      enter(node) {
        const type = node.type, from = node.from, to = node.to;
        const classes = type.prop(host.cmSyntaxPropClasses);
        if (classes) { closeCallout(from); closeTable(from); }
        if (classes && !(inCallout !== -1 || inTable !== -1)) {
          const set = new Set(classes.split(" "));
          if (!set.has("hmd-codeblock")) {
            if (set.has("formatting-math-begin")) {
              inMath = from; mathStart = to; mathBlock = set.has("math-block");
            } else if (inMath !== -1) {
              if (set.has("formatting-math-end")) {
                const end = from, endTo = to;
                const mathText = doc.sliceString(mathStart, end);
                let w = oldMaths.find((x) => x.math === mathText && x.block === mathBlock);
                if (!w) w = new host.livePreviewMathWidget(mathText, mathBlock);
                maths.push(w);
                w.setPos(mathBlock && mathText.startsWith("\n") ? mathStart + 1 : mathStart,
                           mathBlock && mathText.endsWith("\n") ? endTo - 1 : endTo);
                const block = mathBlock && (function (s, e) {
                  const l1 = doc.lineAt(s), l2 = doc.lineAt(e);
                  return l1.text.substr(0, s - l1.from).trim() === "" && l2.text.substr(e - l2.from).trim() === "";
                })(inMath, endTo);
                if (covered(inMath, endTo)) {
                  if (mathBlock) decos.push(host.cmDecoration.widget({ widget: w, block: true, side: 1 }).range(endTo));
                } else {
                  decos.push(replaceSpec({ widget: w, block, side: 1 }, inMath, endTo));
                }
                inMath = -1; mathStart = -1;
              }
            } else if (set.has("formatting-link-start")) {
              inLink = true; linkIsEmbed = set.has("formatting-embed"); linkStart = from; linkEnd = to;
            } else if (linkStart > -1) {
              if (set.has("hmd-internal-link")) {
                linkText += doc.sliceString(from, to); linkAliasEnd = to;
              } else {
                if (set.has("formatting-link-end") && linkText) {
                  if (linkIsEmbed) {
                    const w = widgetForLink(linkText, linkStart, to);
                    placeWidget(w, linkStart, to);
                  } else {
                    const href = parseLinkToken(linkText).href;
                    if (app.metadataCache.isUnresolved(host.stripLinkSubpath(href), sourcePath)) {
                      decos.push(host.livePreviewUnresolvedMark.range(linkEnd, linkAliasEnd));
                    }
                  }
                }
                linkText = ""; linkStart = -1;
              }
            } else if (set.has("image-marker")) {
              inImage = true; imagePos = from;
            } else if (set.has("image-alt-text") && !set.has("formatting")) {
              imageAlt = doc.sliceString(from, to);
            } else if (inImage && set.has("url") && !set.has("formatting")) {
              imageUrl = doc.sliceString(from, to);
            } else if (inImage && imageUrl && set.has("formatting")) {
              let w;
              if (host.isUrl(imageUrl = host.decodeExternalUrl(imageUrl))) {
                let decoded;
                try { decoded = decodeURI(imageUrl); } catch (err) { return; }
                const target = host.trimSlashes(decoded).trim();
                w = widgetForLink(target + "|" + imageAlt, imagePos, to);
              } else {
                imageUrl = host.normalizeExternalUrl(imageUrl);
                if (host.Platform.isDesktopApp && imageUrl.startsWith("file:///")) {
                  imageUrl = host.Platform.resourcePathPrefix + imageUrl.substr(8);
                }
                let img = oldImages.find((x) => x.url === imageUrl);
                if (img) {
                  if (img.title !== imageAlt && img.applyTitle) img.applyTitle(imageAlt);
                } else {
                  img = new host.livePreviewImageWidget(imageUrl, imageAlt);
                  images.push(img);
                }
                img.setPos(imagePos, to);
                w = img;
              }
              placeWidget(w, imagePos, to);
              inImage = false; imageUrl = ""; imageAlt = ""; imagePos = -1;
            } else if (set.has("hmd-html-begin")) {
              inHtml = from;
            } else if (inHtml > -1 && !htmlTag && set.has("tag")) {
              htmlTag = doc.sliceString(from, to);
            } else if (set.has("hmd-html-end") && htmlTag && !host.livePreviewTagBlocklist.contains(htmlTag)) {
              let htmlEnd = to;
              const htmlStart0 = inHtml;
              const htmlText = doc.sliceString(htmlStart0, htmlEnd);
              const l1 = doc.lineAt(htmlStart0), l2 = doc.lineAt(htmlEnd);
              const block = !host.isKnownHtmlTag(htmlTag);
              // inline vs block: expand to full lines when the html is the only
              // content on those lines (comma-expression semantics preserved)
              if (!(doc.sliceString(l1.from, htmlStart0).trim() || doc.sliceString(htmlEnd, l2.to).trim())) {
                inHtml = l1.from; htmlEnd = l2.to;
              }
              if (!covered(inHtml, htmlEnd)) {
                let w = oldHtmls.find((x) => x.html === htmlText && x.block === block);
                if (!w) w = new host.livePreviewHtmlWidget(app, component, htmlText, block);
                htmls.push(w); w.setPos(inHtml, htmlEnd);
                decos.push(replaceSpec({ widget: w, block, side: 1 }, inHtml, htmlEnd));
              }
              inHtml = -1; htmlTag = "";
            } else if (set.has("hr")) {
              if (!covered(from, to)) decos.push(replaceSpec({ widget: host.livePreviewHrWidget, block: true }, from, to));
            }
          }
        }
        const syntaxClasses = type.prop(host.livePreviewSyntaxClasses);
        if (syntaxClasses) {
          const set = new Set(syntaxClasses.split(" "));
          if (set.has("HyperMD-callout")) { closeCallout(from); inCallout = from; calloutEnd = to; }
          if (set.has("HyperMD-quote") && inCallout !== -1) { if (from - calloutEnd > 1) closeCallout(from); else calloutEnd = to; }
          if (set.has("HyperMD-table-row")) {
            closeCallout(from);
            if (from - tableEnd > 1) closeTable(from);
            if (inTable === -1) inTable = from;
            tableEnd = to;
          }
          if (set.has("HyperMD-codeblock-begin") && inCodeblock === -1) {
            const line = doc.lineAt(from);
            inCodeblock = from; codeblockLang = "";
            let code = line.text;
            if (set.has("HyperMD-list-line")) {
              const m = code.match(host.listLinePattern);
              if (m) { inCodeblock = line.from + m[0].length; code = code.slice(m[0].length); }
            }
            const m = code.match(host.codeblockLangPattern);
            if (m) codeblockLang = m[2];
          }
          if (set.has("HyperMD-codeblock-end") && inCodeblock !== -1) {
            const begin = inCodeblock;
            inCodeblock = -1;
            if (covered(begin, to)) return;
            const endLine = doc.lineAt(from);
            if (endLine.number <= 1) return;
            const beginLine = doc.lineAt(begin);
            if (beginLine.number >= doc.lines) return;
            const codeFrom = doc.line(beginLine.number + 1).from;
            let codeTo = doc.line(endLine.number - 1).to;
            if (codeTo < codeFrom) codeTo = codeFrom;
            const code = doc.sliceString(codeFrom, codeTo);
            if (host.livePreviewCodeblockWidget.canRenderLang(codeblockLang)) {
              let w = oldCodeblocks.find((x) => x.lang === codeblockLang && x.code === code);
              if (!w) w = new host.livePreviewCodeblockWidget(app, component, codeblockLang, code);
              w.setPos(codeFrom, codeTo);
              w.lineStart = beginLine.number - 1; w.lineEnd = endLine.number - 1;
              codeblocks.push(w);
              decos.push(replaceSpec({ widget: w, block: true }, begin, to));
            } else {
              let lang = codeblockLang;
              try {
                const mode = host.codeMirrorCompat.findModeByName(lang);
                if (mode && mode.name !== "null") lang = mode.name;
              } catch (err) {}
              decos.push(host.livePreviewCodeblockHide.range(begin, beginLine.to));
              decos.push(host.cmDecoration.widget({ widget: new host.livePreviewCodeFallbackWidget(lang, code) }).range(beginLine.to));
              decos.push(host.livePreviewCodeblockShow.range(endLine.from, endLine.to));
            }
          }
        }
        closeCallout(from); closeTable(from);
      }
    });
    closeCallout(doc.length + 1); closeTable(doc.length + 1);

    // Fallback for callouts the syntax walk did not tag: a quote block whose
    // first line carries the [!type] marker.
    if (!callouts.length) {
      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (!/^>\s*\[![^\]]+\]/.test(line.text)) continue;
        let j = i;
        while (j < doc.lines && /^>/.test(doc.line(j + 1).text)) j++;
        const from = line.from, to = doc.line(j).to, text = doc.sliceString(from, to);
        if (!highlightCovers(hiState, searchMark, from, to)) {
          const w = new host.livePreviewCalloutWidget(app, component, view, text);
          w.setPos(from, to);
          decos.push(replaceSpec({ widget: w, side: 1, block: true }, from, to));
          callouts.push(w);
        }
        i = j;
      }
    }

    if (component.tableCell && component.tableCell.cm.hasFocus && update.docChanged &&
        (update.isUserEvent("undo") || update.isUserEvent("redo")) &&
        !component.tableCell.table.containsSelection(state.selection)) view.focus();

    removeChildren(oldLinks); removeChildren(oldCodeblocks); removeChildren(oldCallouts); removeChildren(oldTables);
    return host.cmDecoration.set(decos, true);
  };

  function syncTableWidgetRanges(update) {
    if (!update.docChanged || !tables.length) return;
    const changes = update.changes;
    for (const w of tables) {
      const s = w.start, e = w.end;
      const touched = changes.touchesRange(s, e);
      if (changes.length < s || changes.length < e) continue;
      const ns = changes.mapPos(s), ne = changes.mapPos(e);
      w.setPos(ns, ne);
      if (touched) w.receiveUpdate(update, update.newDoc.slice(ns, ne)) && w.receiveSelection(update);
    }
  }

  function syncTableWidgetSelection(update) {
    if (!update.selection || !tables.length) return;
    for (const w of tables) {
      if (w.containedBySelection(update.selection)) w.selectTable();
      else if (!w.containsSelection(update.selection)) w.deselectTable();
    }
  }

  return host.cmStateField.define({
    create() { return host.cmDecoration.none; },
    update(deco, update) {
      let value; let full = true;
      const syntaxUpto = Math.min(view.viewport.to + 2000, Math.max(0, update.state.doc.length - 1));
      if (!host.ensureSyntaxViewport(update.state, syntaxUpto, 20)) full = false;
      if (hasEffect([update], host.mobileCursorEffect) || hasEffect([update], host.cmHighlightField) || hasEffect([update], host.cmFilterEffect)) full = true;
      if (view.composing || computing || (view.plugin(host.mobileCursorPlugin) || {}).mousedown) full = false;
      if (full) {
        computing = true;
        try { value = build(update); } finally { computing = false; }
      } else {
        value = deco.map(update.changes);
        syncTableWidgetRanges(update);
      }
      syncTableWidgetSelection(update);
      return value;
    },
    provide(field) { return host.cmView.decorations.from(field); }
  });
}

// A6: mobile drag-to-select cursor plugin + draggable-widget guard.
function mobileCursorExtensions(host) {
  const dispatchCursor = (view) => {
    view.dom.win.setTimeout(() => view.dispatch({ effects: host.mobileCursorEffect.of() }), 10);
  };
  const plugin = host.cmViewPlugin.define((editorView) => {
    const opts = { capture: true };
    const onDown = (ev) => {
      if (ev.button !== 0) return;
      if (editorView.scrollDOM.scrollHeight > editorView.scrollDOM.clientHeight &&
          ev.clientX > editorView.scrollDOM.getBoundingClientRect().x + editorView.scrollDOM.clientWidth) return;
      const sel = editorView.state.selection, doc = editorView.state.doc, top = editorView.scrollDOM.scrollTop;
      const p = editorView.plugin(host.mobileCursorPlugin);
      if (!p) return;
      p.mousedown = true;
      const owner = editorView.scrollDOM.doc;
      const release = () => {
        owner.removeEventListener("mouseup", up, opts);
        owner.removeEventListener("drag", drag, opts);
        p.mousedown = false;
        if (!(editorView.state.selection.eq(sel) && editorView.state.doc.eq(doc) && editorView.scrollDOM.scrollTop === top)) {
          editorView.dom.win.setTimeout(() => editorView.dispatch({
            annotations: [host.mobileCursorAnnotation.of(true)],
            selection: editorView.state.selection
          }), 50);
        }
      };
      const up = (e) => { if (e.button === 0) release(); };
      const drag = () => release();
      owner.addEventListener("mouseup", up, opts);
      owner.addEventListener("drag", drag, opts);
    };
    editorView.scrollDOM.addEventListener("mousedown", onDown, opts);
    return { destroy() { editorView.scrollDOM.removeEventListener("mousedown", onDown, opts); } };
  });
  const handlers = host.cmView.domEventHandlers({
    focus(_ev, eview) { dispatchCursor(eview); },
    blur(_ev, eview) { dispatchCursor(eview); },
    mousedown(ev) {
      if (ev.button === 0 && (host.keyModifiers.isModifier(ev, "Mod") || (!ev.shiftKey && !ev.altKey))) {
        const node = ev.targetNode;
        if (node.instanceOf(Element)) {
          const drag = node.matchParent('[draggable="true"]');
          if (drag) {
            drag.setAttr("contenteditable", "false");
            const orig = ev.preventDefault;
            ev.preventDefault = function () { ev.preventDefault = orig; };
            return true;
          }
        }
      }
    }
  });
  return [plugin, handlers];
}

export function livePreviewPlugin(component, view, host) {
  const field = livePreviewDecorations(component, view, host);

  // find the block widget covering the line above/below the caret for arrow nav
  function blockWidgetAt(state, range, dir) {
    const line = state.doc.lineAt(range.head), next = line.number + (dir ? 1 : -1);
    if (next < 1 || next > state.doc.lines) return null;
    const target = state.doc.line(next);
    let ok = true, found = null;
    state.field(field).between(target.from, target.to, (from, to, spec) => {
      if (spec.spec && spec.spec.block) {
        if (found || from > target.from || to < target.to) { ok = false; return false; }
        if (!found) found = spec;
      }
    });
    if (!ok || !found) return null;
    if (!found.spec.block) return null;
    const col = range.head - line.from;
    return host.cmSelection.cursor(target.from + Math.min(target.length, col), range.assoc);
  }

  function moveSelection(editorView, additive, down) {
    const state = editorView.state, sel = state.selection;
    const next = host.cmSelection.create(sel.ranges.map((range) => {
      const resolve = (r) => {
        if (!additive && !r.empty) return host.cmSelection.cursor(down ? r.to : r.from);
        const vertical = editorView.moveVertically(r, down);
        let target = vertical.head !== r.head ? vertical : editorView.moveToLineBoundary(r, down);
        if (!down && !additive && sameLineAsDocEnd(editorView, r.head)) {
          const owner = editorView.state.field(host.cmOwnerField);
          if (metadataEditorActive(owner, host) && owner.metadataEditor.containerEl.isShown()) {
            owner.shiftFocusBefore();
            return target;
          }
        }
        const widget = blockWidgetAt(state, r, down);
        return widget && Math.abs(vertical.head - r.head) > Math.abs(widget.head - r.head) ? widget : target;
      };
      let s = resolve(range);
      if (additive) s = host.cmSelection.range(range.anchor, s.head, s.goalColumn);
      return s;
    }), sel.mainIndex);
    if (!next.eq(state.selection)) {
      editorView.dispatch(state.update({ selection: next, scrollIntoView: true, userEvent: "select" }));
    }
    return true;
  }

  const keymap = host.vimPrecedence.high(host.cmKeymapFacet.of([
    { key: "ArrowUp", run: (v) => moveSelection(v, false, false), shift: (v) => moveSelection(v, true, false) },
    { key: "ArrowDown", run: (v) => moveSelection(v, false, true), shift: (v) => moveSelection(v, true, true) }
  ]));
  const vimHook = host.vimPrecedence.low(host.cmViewPlugin.define((editorView) => {
    editorView.getNextPosUpDown = blockWidgetAt;
    return { destroy() { delete editorView.getNextPosUpDown; } };
  }));
  const mobile = [];
  if (host.Platform.isMobile) {
    const debounced = host.debounce(() => {
      const p = view.plugin(host.mobileCursorPlugin);
      if (p) {
        p.mousedown = false;
        view.dom.removeClass("dragging-mobile-cursor");
        view.dispatch({ effects: host.mobileCursorEffect.of() });
      }
    }, 700, true);
    mobile.push(host.cmView.updateListener.of((tr) => {
      if (tr.docChanged) debounced.run();
      else if (tr.transactions.some((t) => t.isUserEvent("select"))) {
        view.plugin(host.mobileCursorPlugin).mousedown = true;
        view.dom.addClass("dragging-mobile-cursor");
        debounced();
      }
    }));
  }
  const dragExts = mobileCursorExtensions(host);
  return host.combineExtensions(
    host.combineExtensions([host.mobileCursorPlugin, dragExts[0]], mobile.concat([dragExts[1]]), true),
    [host.livePreviewThemeA, host.livePreviewThemeB, field, keymap,
     host.mobileDragExtensions, host.propertiesLivePreview(component), vimHook,
     host.tableSyncExtension(component, field), host.tableWidget.cellSanitizerPlugin(component),
     host.tableWidget.detectSurroundingClick(field)],
    false
  );
}

// nP: properties-in-live-preview extension pair — a decoration field that
// hides the frontmatter block (JA replace) or marks it invalid (ZA mark +
// error badge), plus a transaction filter that keeps edits out of the
// frontmatter region unless it currently has a YAML error.
export function livePreviewProperties(component, view, host) {
  const cm = component.cm;
  let lastYaml = "", lastError = null;
  const validate = (text) => {
    if (text !== lastYaml) {
      lastYaml = text;
      try {
        const parsed = host.parseYaml(text) ?? {};
        if (typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new host.yamlParseError([0, 0], "BAD_COLLECTION_TYPE", "Frontmatter must be a valid object!");
        }
        lastError = null;
      } catch (err) { lastError = err; }
    }
    return lastError;
  };
  const field = host.cmStateField.define({
    create() { return host.cmDecoration.none; },
    update(deco, update) {
      const decos = [], doc = update.newDoc, end = docFrontmatterEnd(doc);
      let hide = end !== -1 && "source" !== component.app.vault.getConfig("propertiesInDocument");
      if (end !== -1) {
        const err = validate(doc.sliceString(3, end - 3));
        if (err) {
          hide = false;
          decos.push(host.livePreviewInvalidMark.range(0, end));
          if (err instanceof host.yamlParseError) {
            const pos = Math.clamp(err.pos[0] + 3, 4, end - 3);
            decos.push(host.cmDecoration.mark({
              class: "error-marker",
              attributes: { "aria-label": host.t.properties.labelInvalidYamlMarker() }
            }).range(pos, pos + 1));
          }
        }
      }
      if (hide) decos.push(host.livePreviewBlockReplace.range(0, end));
      return host.cmDecoration.set(decos, true);
    },
    provide(f) { return host.cmView.decorations.from(f); }
  });
  const filter = host.cmState.transactionFilter.of((tr) => {
    if (cm.composing || !host.notSetUserEvent(tr)) return tr;
    if ("source" === component.app.vault.getConfig("propertiesInDocument")) return tr;
    if (hasEffect([tr], host.metadataPropertyEffect)) {
      cm.dom.win.setTimeout(() => component.app.commands.executeCommandById("markdown:add-metadata-property"), 30);
      return tr;
    }
    const startDoc = tr.startState.doc, startEnd = docFrontmatterEnd(startDoc);
    if (startEnd === -1) return tr;
    if (validate(startDoc.sliceString(3, startEnd - 3))) return tr;
    let extra, newDoc = tr.newDoc, newEnd = docFrontmatterEnd(newDoc), docLen = newDoc.length;
    if (docLen === newEnd) { docLen++; extra = [{ insert: "\n", from: newEnd }]; }
    const sel = tr.newSelection;
    if (sel.ranges.some((r) => r.from <= startEnd || r.to <= startEnd)) {
      let touched = false;
      tr.changes.iterChangedRanges((a, b, c, d) => {
        if (a >= 3 && b < startEnd - 1) touched = true;
        if (c === d && b <= startEnd + 1) touched = true;
      }, true);
      if (touched) return [];
      const clamp = (p) => Math.clamp(p, startEnd + 1, docLen);
      const selection = host.cmSelection.create(sel.ranges.map((r) => host.cmSelection.range(clamp(r.anchor), clamp(r.head))), sel.mainIndex);
      return [tr, { changes: extra, selection, sequential: true }];
    }
    return tr;
  });
  return [field, filter];
}
