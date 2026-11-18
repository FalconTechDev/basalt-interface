// s20: link/autocomplete suggestion pieces.
//   zI  headingBlockSuggestions: `#`-path aware heading suggestions for one file
//   qI  blockSuggestions: `^block` id suggestions inside one file's block cache
//   jI  renderSectionSuggestion: draws one suggestion row (file/alias/linktext/heading/bases-view/block)
//   UI  applyLinkSuggestion: computes the editor replacement for the chosen suggestion
//   RI  suggestionPathSubpath: the {path, subpath} a suggestion inserts
//   WI  LinkSuggestManager: file/alias/display/heading/block/base-view suggestions for `[[…`
//   BI  score-descending comparator (var)
//   VI  the empty "none" suggestion (var)

import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { prepareFuzzyFinder, prepareSimpleFinder, renderMatches, containsAllWords } from "./search-simple.js";
import { parseLinktext, lastSegment, extensionOf, escapeLinkChars, withoutMd } from "./path.js";
import { linkSafeHeading, parseImageSize } from "./text.js";
import { frontmatterAliases } from "./frontmatter.js";
import { matchPenalty, randomHex } from "./misc.js";
import { batchedAsync } from "./metadata-helpers.js";

// `TFile` is provided by s20-links.js (same flat module scope).

/** The "no match" suggestion row. */
export const s20NoMatch = { type: "none", matches: null, score: 0 };

/** Orders suggestions by descending score. */
export const s20ScoreDescending = (a, b) => b.score - a.score;

/** Async-iterates an array one item at a time (the shape the batched helpers expect). */
async function* s20AsyncItems(items) {
  for (const item of items) yield item;
}

// =====================================================================================================================
// Heading and block suggestions
// =====================================================================================================================

/**
 * Heading suggestions for `query` (a `#`-separated heading path) inside `headings` of `file`.
 * `context` is the suggest session (isCancelled); `path` is the link path the suggestions attach to.
 */
export async function s20HeadingSuggestions(context, file, headings, path, query, host) {
  if (!headings || headings.length === 0) return [];
  const segments = query.split("#").filter((segment) => !!segment);
  if (query.endsWith("#")) segments.push("");
  let prefix = "#" + segments.slice(0, segments.length - 1).join("#");
  if (!prefix.endsWith("#")) prefix += "#";
  const out = [];
  let matched = 0;
  let level = 0;
  for await (const heading of batchedAsync(s20AsyncItems(headings), { maxDelay: 0 })) {
    if (heading.level <= level || matched >= segments.length) break;
    if (context.isCancelled()) break;
    const text = heading.heading.toLowerCase();
    if (matched === segments.length - 1) {
      const needle = segments[matched];
      if (needle === "") {
        out.push({
          type: "heading",
          file,
          path,
          subpath: prefix + linkSafeHeading(heading.heading),
          level: heading.level,
          heading: heading.heading,
          score: 0,
          matches: null,
        });
      } else {
        const found = fuzzyMatchJs(prepareQuery(needle), heading.heading);
        if (found) {
          out.push({
            type: "heading",
            file,
            path,
            subpath: prefix + linkSafeHeading(heading.heading),
            level: heading.level,
            heading: heading.heading,
            score: found.score,
            matches: found.matches,
          });
        }
      }
    } else if (text === segments[matched].toLowerCase()) {
      matched++;
      level = heading.level;
    }
  }
  return out;
}

/** Block-id suggestions for `query` inside `blocks` ({ content, blocks }) of `file` at `path`. */
export async function s20BlockSuggestions(context, file, path, blocks, query, host) {
  if (!blocks) return [];
  const content = blocks.content;
  const words = query.toLowerCase().split(" ");
  const out = [];
  for await (const block of batchedAsync(s20AsyncItems(blocks.blocks), { maxDelay: 0 })) {
    if (context.isCancelled()) break;
    const display = containsAllWords(words, block.display.toLowerCase());
    let score = matchPenalty(display);
    let idMatch = null;
    const id = block.node.id;
    if (id && String.isString(id)) {
      idMatch = containsAllWords(words, id.toLowerCase());
      if (idMatch) score = 0;
    }
    if (display || idMatch) {
      out.push({
        type: "block",
        file,
        path,
        content,
        display: block.display,
        node: block.node,
        score,
        matches: display,
        idMatch,
      });
    }
  }
  return out;
}

// =====================================================================================================================
// Suggestion row rendering
// =====================================================================================================================

/**
 * Renders one suggestion into `el`. `showNote` (n) adds the file path under heading/block rows.
 * Suggestion kinds: none / file / alias / linktext / bases-view / heading / block.
 */
export function s20RenderSectionSuggestion(suggestion, el, showNote, host) {
  el.addClass("mod-complex");
  const content = el.createDiv("suggestion-content");
  const aux = el.createDiv("suggestion-aux");
  const title = content.createDiv("suggestion-title");
  const note = content.createDiv("suggestion-note");
  const matches = suggestion.matches;
  if (showNote && (suggestion.type === "heading" || suggestion.type === "block")) {
    note.setText(withoutMd(suggestion.file.path));
  }
  if (suggestion.downranked) el.addClass("mod-downranked");
  if (suggestion.type === "none") {
    title.setText(host.t.editor.linkSuggestion.labelNoMatchFound());
  } else if (suggestion.type === "file") {
    const path = suggestion.path;
    const name = lastSegment(path);
    const dir = path.substr(0, path.length - name.length);
    renderMatches(note, dir, matches);
    renderMatches(title, name, matches, -dir.length);
  } else if (suggestion.type === "alias") {
    let icon = "lucide-forward";
    note.setText(suggestion.path);
    if (host.imageExtensions.includes(extensionOf(suggestion.path)) && parseImageSize(suggestion.alias)) {
      icon = "lucide-scaling";
      title.setText(host.t.editor.linkSuggestion.labelImageSize({ size: suggestion.alias }));
    } else if (suggestion.alias) {
      renderMatches(title, suggestion.alias, matches);
    } else {
      title.createSpan({ cls: "suggestion-empty-suggestion", text: host.t.editor.linkSuggestion.labelNoAlias() });
    }
    aux.createSpan({ cls: "suggestion-flair" }, (flair) => {
      host.setIcon(flair, icon);
      host.setTooltip(flair, host.t.interface.tooltip.alias());
    });
  } else if (suggestion.type === "linktext") {
    renderMatches(title, suggestion.path, matches);
  } else if (suggestion.type === "heading") {
    if (suggestion.heading) renderMatches(title, suggestion.heading, matches);
    else title.createSpan({ cls: "suggestion-empty-suggestion", text: host.t.editor.linkSuggestion.labelNoHeading() });
    if (suggestion.level > 0) aux.createSpan({ cls: "suggestion-flair", text: "H" + suggestion.level });
  } else if (suggestion.type === "bases-view") {
    renderMatches(title, suggestion.viewName, matches);
    host.setIcon(aux.createSpan("suggestion-flair"), suggestion.icon);
  } else if (suggestion.type === "block") {
    renderMatches(title, suggestion.display, matches);
    const id = suggestion.node.id;
    if (id && String.isString(id)) {
      if (note.getText().trim()) note.appendText(" > ");
      renderMatches(note, id, suggestion.idMatch);
    }
  }
}

// =====================================================================================================================
// Applying a suggestion
// =====================================================================================================================

/**
 * Computes the editor replacement for accepting `suggestion`.
 * Parameters mirror the original call: (app, suggestion, keepText, tailText, cursor, end, sourcePath, key, mode).
 * `keepText` is re-inserted for the "none" row; `tailText` is the text after the cursor up to `]]`.
 */
export function s20ApplyLinkSuggestion(app, suggestion, keepText, tailText, cursor, end, sourcePath, key, mode, host) {
  let blockId = null;
  let alias = "";
  let display = "";
  let selStart = end;
  let selEnd = end;
  const markdownLinks = mode === "markdown" && app.vault.getConfig("useMarkdownLinks");
  const wikiMode = !markdownLinks;
  let replacement = "";
  let linkText = "";
  const pathFor = (file, path) => {
    if (path !== null) {
      if (wikiMode || !path || file.extension !== "md" || path.endsWith(".md")) return path;
      return path + ".md";
    }
    return file.path === sourcePath ? "" : app.metadataCache.fileToLinktext(file, sourcePath, wikiMode);
  };
  if (suggestion.type === "none") {
    if (key === "Enter" || key === "Tab") linkText = keepText;
  } else if (suggestion.type === "file") {
    display = suggestion.file.basename;
    linkText = app.metadataCache.fileToLinktext(suggestion.file, sourcePath, wikiMode);
  } else if (suggestion.type === "alias") {
    alias = display = suggestion.alias;
    const parsed = parseLinktext(suggestion.path);
    let link = parsed.path;
    const subpath = parsed.subpath;
    if (suggestion.file) link = app.metadataCache.fileToLinktext(suggestion.file, sourcePath, wikiMode);
    linkText = link + subpath;
  } else if (suggestion.type === "linktext") {
    display = suggestion.path;
    linkText = suggestion.path;
  } else if (suggestion.type === "bases-view") {
    const path = pathFor(suggestion.file, suggestion.path);
    display = suggestion.viewName;
    linkText = path + suggestion.subpath;
  } else if (suggestion.type === "heading") {
    const path = pathFor(suggestion.file, suggestion.path);
    display = suggestion.heading;
    linkText = path + suggestion.subpath;
  } else if (suggestion.type === "block") {
    display = "";
    const path = pathFor(suggestion.file, suggestion.path);
    const node = suggestion.node;
    if (node.id) linkText = path + "#^" + node.id;
    else linkText = path + "#^" + (blockId = randomHex(6));
  }
  const tail = tailText.match(/^(\s*)(\|)?(.*?)(]])/);
  if (tail && !tail[0].contains("[[")) {
    if (tail[2] && !alias) {
      alias = tail[3];
      if (!display) display = alias;
    }
    end += tail[0].length;
  }
  if (!alias && suggestion.type === "file") {
    const ext = suggestion.file.extension;
    if (!host.imageExtensions.includes(ext) && linkText.contains("/")) alias = display;
  }
  if (markdownLinks && key !== "#" && key !== "^") {
    replacement = "[" + display + "](" + escapeLinkChars(linkText) + ")";
    selStart = selEnd = display ? cursor + replacement.length : cursor + 1;
  } else {
    if (key === "#") {
      linkText += "#";
      if (suggestion.type === "file" && host.pdfExtensions.includes(suggestion.file.extension)) linkText += "page=";
    } else if (key === "^") {
      linkText += "^";
    }
    if (alias) linkText += "|" + alias;
    const close = linkText.endsWith("]]") ? "" : "]]";
    const full = (replacement = "[[" + linkText + close);
    const at = cursor + full.length - 2;
    if (key === "Tab") {
      if (alias) {
        selStart = at - alias.length;
        selEnd = at;
      } else {
        selStart = selEnd = at;
      }
    } else {
      selStart = selEnd = key === "#" || key === "^" || key === "|" ? (alias ? at - alias.length - 1 : at) : cursor + full.length;
    }
  }
  return { replacement, start: cursor, end, selectionStart: selStart, selectionEnd: selEnd, blockId };
}

/** The { path, subpath } a suggestion contributes to the inserted link. */
export function s20SuggestionPathSubpath(suggestion) {
  let path = "";
  let subpath = "";
  if (suggestion.type === "block") {
    path = suggestion.file.path;
    subpath = "#^" + suggestion.node.id;
  } else if (suggestion.type === "heading") {
    path = suggestion.file.path;
    subpath = "#" + linkSafeHeading(suggestion.heading);
  } else if (suggestion.type === "file" || suggestion.type === "alias") {
    path = suggestion.file.path;
    subpath = "";
  } else if (suggestion.type === "linktext") {
    const parsed = parseLinktext(suggestion.path);
    path = parsed.path;
    subpath = parsed.subpath;
  }
  return { path, subpath };
}

// =====================================================================================================================
// The suggest manager behind `[[…` completion
// =====================================================================================================================

/** Shifts every match range of `matches` right by `offset`. */
function s20ShiftMatches(matches, offset) {
  if (!matches) return;
  for (const range of matches) {
    range[0] += offset;
    range[1] += offset;
  }
}

/** File-suggestion matcher: basename first (matches shifted to full-path coordinates), then full path at a penalty. */
function s20FileMatch(match, path) {
  const name = lastSegment(path);
  const hit = match(name);
  if (hit) {
    s20ShiftMatches(hit.matches, path.length - name.length);
    return hit;
  }
  const full = match(path);
  if (full) full.score -= 1;
  return full;
}

/**
 * Produces suggestions for the text typed inside `[[…` (or `![[…`).
 * `context` is the suggest session; `getSourcePath` resolves the file links are relative to.
 */
export function defineS20LinkSuggestManager(host) {
  function LinkSuggestManager(app, getSourcePath) {
    this.runnable = null;
    this.mode = "file";
    this.global = false;
    this.fileSuggestions = null;
    this.app = app;
    this.getSourcePath = getSourcePath;
  }
  const proto = LinkSuggestManager.prototype;

  proto.getInstructions = function () {
    if (this.mode === "file") {
      return [
        { command: host.t.editor.linkSuggestion.labelTypeHash(), purpose: host.t.editor.linkSuggestion.labelLinkHeading() },
        { command: host.t.editor.linkSuggestion.labelTypeBlock(), purpose: host.t.editor.linkSuggestion.labelLinkBlock() },
        { command: host.t.editor.linkSuggestion.labelTypePipe(), purpose: host.t.editor.linkSuggestion.labelChangeDisplayText() },
      ];
    }
    return [{ command: "↵", purpose: host.t.editor.linkSuggestion.labelAccept() }];
  };

  proto.getSuggestionsAsync = async function (context, query) {
    let display = null;
    const pipe = query.indexOf("|");
    if (pipe !== -1) {
      display = query.substr(pipe + 1);
      query = query.substr(0, pipe);
    }
    if (display === null) {
      if (query.startsWith("##")) {
        query = query.substr(2);
        this.mode = "heading";
        this.global = true;
        return this.getGlobalHeadingSuggestions(context, query);
      }
      if (query.startsWith("^^")) {
        query = query.substr(2);
        this.mode = "block";
        this.global = true;
        return this.getGlobalBlockSuggestions(context, query);
      }
    }
    this.global = false;
    const parsed = parseLinktext(query);
    const path = parsed.path;
    const subpath = parsed.subpath;
    if (display !== null) {
      this.mode = "display";
      return this.getDisplaySuggestions(context, path, subpath, display);
    }
    if (subpath) {
      if (subpath.startsWith("#^")) {
        const id = subpath.substr(2);
        this.mode = "block";
        return this.getBlockSuggestions(context, path, id);
      }
      this.mode = "heading";
      return this.getHeadingSuggestions(context, path, subpath);
    }
    const caret = path.lastIndexOf("^");
    if (caret !== -1) {
      const id = path.substr(caret + 1);
      const clean = path.substr(0, caret);
      this.mode = "block";
      return this.getBlockSuggestions(context, clean, id);
    }
    this.mode = "file";
    return this.getFileSuggestions(context, path);
  };

  proto.getDisplaySuggestions = function (context, path, subpath, display) {
    const metadataCache = this.app.metadataCache;
    const sourcePath = this.getSourcePath();
    const file = metadataCache.getFirstLinkpathDest(path, sourcePath);
    const out = [];
    if (file) {
      const cache = metadataCache.getFileCache(file);
      const aliases = frontmatterAliases(cache && cache.frontmatter);
      if (aliases && aliases.length > 0) {
        const prepared = prepareQuery(display);
        for (const alias of aliases) {
          const found = fuzzyMatchJs(prepared, alias);
          if (found) {
            out.push({ type: "alias", alias, file, path: path + subpath, score: found.score, matches: found.matches });
          }
        }
      }
    }
    if (out.length > 0) return out;
    return [{ type: "alias", file: null, path: path + subpath, alias: display, score: 0, matches: [[0, display.length]] }];
  };

  proto.getHeadingSuggestions = async function (context, path, subpath) {
    const metadataCache = this.app.metadataCache;
    const sourcePath = this.getSourcePath();
    const file = metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (file && file.extension === "base") {
      const basesPlugin = this.app.internalPlugins.getEnabledPluginById("bases");
      const prepared = prepareQuery(subpath.slice(1));
      const out = [];
      const content = await this.app.vault.cachedRead(file);
      const parsedBase = content ? host.parseYaml(content) : null;
      const views = parsedBase && parsedBase.views;
      let list = [];
      if (views && Array.isArray(views)) {
        list = views
          .map((view) => ({ name: view && view.name, type: view && view.type }))
          .filter((view) => String.isString(view.name) && String.isString(view.type));
      }
      for (const view of list) {
        const found = fuzzyMatchJs(prepared, view.name);
        if (found) {
          const registration = basesPlugin ? basesPlugin.getRegistration(view.type) : null;
          const icon = registration && registration.icon !== null && registration.icon !== undefined ? registration.icon : "lucide-file-question";
          out.push({
            type: "bases-view",
            file,
            path,
            subpath: "#" + linkSafeHeading(view.name),
            viewName: view.name,
            icon,
            score: found.score,
            matches: found.matches,
          });
        }
      }
      return out;
    }
    if (!file || file.extension !== "md") return [];
    const cache = metadataCache.getFileCache(file);
    const headings = await s20HeadingSuggestions(context, file, cache && cache.headings, path, subpath, host);
    if (headings.length > 0) return headings;
    return [{ type: "heading", file: null, path, subpath, score: 0, heading: subpath.slice(1), level: 0, matches: [[0, subpath.length]] }];
  };

  proto.getGlobalHeadingSuggestions = async function (context, query) {
    const metadataCache = this.app.metadataCache;
    const out = [];
    const prepared = prepareQuery(query);
    const files = metadataCache.getCachedFiles();
    for (let i = 0; i < files.length; i++) {
      const path = files[i];
      if (context.isCancelled()) break;
      if (metadataCache.isUserIgnored(path)) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile()) || file.extension !== "md") continue;
      const cache = metadataCache.getCache(file);
      if (!cache || !cache.headings || cache.headings.length === 0) continue;
      for await (const heading of batchedAsync(s20AsyncItems(cache.headings), { maxDelay: 0 })) {
        if (context.isCancelled()) break;
        const found = fuzzyMatchJs(prepared, heading.heading);
        if (found) {
          out.push({
            type: "heading",
            file,
            path: null,
            subpath: "#" + linkSafeHeading(heading.heading),
            level: heading.level,
            heading: heading.heading,
            score: found.score,
            matches: found.matches,
          });
        }
      }
    }
    return out;
  };

  proto.getBlockSuggestions = async function (context, path, id) {
    const metadataCache = this.app.metadataCache;
    const sourcePath = this.getSourcePath();
    const file = metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (!file || file.extension !== "md") return [];
    const cache = await metadataCache.blockCache.getForFile(context, file);
    return s20BlockSuggestions(context, file, path, cache, id, host);
  };

  proto.getGlobalBlockSuggestions = async function (context, query) {
    const metadataCache = this.app.metadataCache;
    const sourcePath = this.getSourcePath();
    const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
    const words = query.toLowerCase().split(" ");
    const out = [];
    for await (const entry of batchedAsync(metadataCache.blockCache.getAll(context), { batchSize: 1, maxDelay: 0 })) {
      if (context.isCancelled()) break;
      const file = entry.file;
      const content = entry.content;
      if (file.extension !== "md") continue;
      for (const block of entry.blocks) {
        const hit = this.matchBlock(sourceFile, file, block, null, content, words);
        if (hit) out.push(hit);
      }
    }
    return out;
  };

  proto.matchBlock = function (sourceFile, file, block, path, content, words) {
    if (
      this.sourcePosition &&
      file === sourceFile &&
      block.node.position.start.line - 1 <= this.sourcePosition.line &&
      block.node.position.end.line - 1 >= this.sourcePosition.line
    ) {
      return null;
    }
    const display = containsAllWords(words, block.display.toLowerCase());
    let score = matchPenalty(display);
    let idMatch = null;
    const id = block.node.id;
    if (id && String.isString(id)) {
      idMatch = containsAllWords(words, id.toLowerCase());
      if (idMatch) score = 0;
    }
    if (!display && !idMatch) return null;
    return { type: "block", file, path, content, display: block.display, node: block.node, score, matches: display, idMatch };
  };

  proto.getFileSuggestions = async function (context, query) {
    const metadataCache = this.app.metadataCache;
    let suggestions = this.fileSuggestions;
    if (!suggestions) suggestions = this.fileSuggestions = metadataCache.getLinkSuggestions();
    const out = [];
    if (query === "") {
      for (const suggestion of suggestions) {
        const file = suggestion.file;
        if (!file) {
          out.push({ type: "linktext", path: suggestion.path, score: 0, matches: null });
          continue;
        }
        if (metadataCache.isUserIgnored(file.path)) continue;
        if (suggestion.alias) {
          out.push({ type: "alias", alias: suggestion.alias, file, path: suggestion.path, score: file.stat.mtime, matches: null });
        } else {
          out.push({ type: "file", file, path: suggestion.path, score: file.stat.mtime, matches: null });
        }
      }
      return out.sort(s20ScoreDescending);
    }
    const match = suggestions.length < 10000 ? prepareFuzzyFinder(query) : prepareSimpleFinder(query);
    for await (const suggestion of batchedAsync(s20AsyncItems(suggestions), { maxDelay: 0 })) {
      if (context.isCancelled()) break;
      const file = suggestion.file;
      const alias = suggestion.alias;
      if (file) {
        const ignored = metadataCache.isUserIgnored(file.path);
        if (alias) {
          const hit = match(alias);
          if (hit) out.push({ type: "alias", alias, file: suggestion.file, path: suggestion.path, score: hit.score + (ignored ? -10 : 0), matches: hit.matches, downranked: ignored });
        } else {
          const hit = s20FileMatch(match, suggestion.path);
          if (hit) out.push({ type: "file", file: suggestion.file, path: suggestion.path, score: hit.score + (ignored ? -10 : 0), matches: hit.matches, downranked: ignored });
        }
      } else {
        const hit = match(suggestion.path);
        if (hit) out.push({ type: "linktext", path: suggestion.path, score: hit.score, matches: hit.matches });
      }
    }
    return out;
  };

  return LinkSuggestManager;
}
