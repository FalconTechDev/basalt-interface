// The "Footnotes" core plugin: a side-pane view listing every footnote of the current note.
//
// Replaces the inherited pieces:
//   q8  FootnotesPlugin            -> defineFootnotesPlugin
//   z8  FootnotesView              -> defineFootnotesView   (base: the shared link-pane view)
//   H8  FootnoteItem (embed row)   -> defineFootnoteItem
//   V8  "footnotes" view type      -> declarator "footnotes"
//   B8  gm.plugins.footnotesPane   -> declarator __basaltHost.t.plugins.footnotesPane
//
// Each row embeds the matching "[^id]" definition through the regular EmbedFileView,
// so clicking a row lets the user edit the definition inline.

import { inherit } from "./inherit.js";
import { pointOfEvent } from "./misc.js";
import { resolveSubpath } from "./search-simple.js";
import { s05ExtractSubpath } from "./s05-markdown.js";

const s34FootnotesViewType = "footnotes";
/** Definition ids minted for inline (non-reference) footnotes carry this marker. */
const INLINE_ID_PREFIX = "[inline";

// The plugin and the view factories run at different positions in the bundle; the plugin reaches
// the view class through this registry (populated by defineFootnotesView).
const footnotesParts = {};

/** One row of the footnotes list: a numbered badge plus an editable embed of the definition. */
export function defineFootnoteItem(host) {
  function FootnoteItem(app, file, footnoteId, index, footRefPositions = []) {
    const self = host.Component.call(this) || this;
    self.app = app;
    self.file = file;
    self.footnoteId = footnoteId;
    self.footRefPositions = footRefPositions;
    const footnoteEl = (self.containerEl = createDiv("footnote-list-item")).createDiv("footnote");
    self.idEl = footnoteEl.createDiv(
      { cls: "footnote-id", text: String(index + 1) },
      (el) => el.toggleClass("mod-no-occurrences", footRefPositions.length === 0)
    );
    self.contentEl = footnoteEl.createDiv("footnote-content");
    return self;
  }
  inherit(FootnoteItem, host.Component);
  const proto = FootnoteItem.prototype;

  proto.onload = function () {
    this.renderEmbed();
  };

  proto.onunload = function () {
    this.containerEl.detach();
  };

  /** Lazily builds the "[^id]" embed once the file content is available. */
  proto.renderEmbed = async function () {
    const app = this.app;
    const file = this.file;
    const contentEl = this.contentEl;
    const containerEl = this.containerEl;
    const footnoteId = this.footnoteId;
    const linktext = "#[^" + footnoteId + "]";
    const embedContainer = contentEl.createDiv();
    const embed = (this.embed = this.addChild(
      new host.EmbedFileView({ app, linktext, sourcePath: file.path, containerEl: embedContainer, depth: 0 }, file, linktext)
    ));
    embed.editable = true;
    containerEl.addEventListener("click", (event) => {
      if (embed.editorEl.isShown()) return;
      const setEditing = (editing) => containerEl.toggleClass("is-editing", editing);
      setEditing(true);
      embed.showEditor(pointOfEvent(event));
      embed.editMode.register(() => setEditing(false));
      embed.editMode.registerDomEvent(containerEl.win, "click", (e) => {
        if (!containerEl.contains(e.targetNode)) {
          setEditing(false);
          embed.showPreview();
        }
      });
    });
    await embed.loadFile();
  };

  /** Refreshes the badge number and the "no occurrences" marker. */
  proto.update = function (index, footRefPositions = []) {
    const idEl = this.idEl;
    this.footRefPositions = footRefPositions;
    idEl.toggleClass("mod-no-occurrences", footRefPositions.length === 0);
    const text = String(index + 1);
    if (idEl.textContent !== text) {
      idEl.empty();
      idEl.setText(text);
    }
  };

  proto.onResize = function () {
    this.embed?.previewMode?.renderer.onResize();
  };

  footnotesParts.FootnoteItem = FootnoteItem;
  return FootnoteItem;
}

/** The side-pane view: sorts the note's footnotes by first reference and renders one FootnoteItem each. */
export function defineFootnotesView(host) {
  const footnotesT = () => host.t.plugins.footnotesPane;

  function FootnotesView(leaf) {
    const self = host.LinkPaneView.call(this, leaf) || this;
    self.icon = "lucide-file-signature";
    self.hoverPopover = null;
    self.cache = new Map();
    const listWrapperEl = (self.listWrapperEl = self.contentEl.createDiv("footnotes-view"));
    self.listEl = listWrapperEl.createDiv("footnotes-list", (el) => el.hide());
    self.emptyEl = listWrapperEl.createDiv({ cls: "pane-empty", text: footnotesT().labelNoFootnotes() }, (el) => el.hide());
    return self;
  }
  inherit(FootnotesView, host.LinkPaneView);
  const proto = FootnotesView.prototype;

  proto.onload = function () {
    this.registerEvent(this.app.metadataCache.on("resolve", this.onCacheUpdate, this));
    this.requestUpdate();
  };

  proto.onunload = function () {
    this.cache.clear();
  };

  proto.getDisplayText = function () {
    return footnotesT().shortName();
  };

  proto.getViewType = function () {
    return s34FootnotesViewType;
  };

  proto.canAcceptExtension = function () {
    return true;
  };

  proto.onResize = function () {
    for (const item of this.cache.values()) item.onResize();
  };

  proto.onCacheUpdate = function (file) {
    if (file === this.file) this.update();
  };

  proto.clearCache = function () {
    for (const item of this.cache.values()) this.removeChild(item);
    this.cache.clear();
  };

  /** Drops cached rows whose footnote id is no longer present. */
  proto.cleanCache = function (footnotes) {
    const cache = this.cache;
    const keep = new Set(footnotes.map((f) => f.id));
    for (const id of Array.from(cache.keys())) {
      if (!keep.has(id)) {
        const item = cache.get(id);
        cache.delete(id);
        item.containerEl.detach();
        this.removeChild(item);
      }
    }
  };

  /** Returns the row for `footnote`, rebuilding it when the definition text changed. */
  proto.renderFootnote = async function (footnote, index, positions) {
    const app = this.app;
    const cache = this.cache;
    const file = this.file;
    const content = await app.vault.cachedRead(file);
    const fileCache = app.metadataCache.getFileCache(file);
    const refPositions = positions?.[footnote.id];
    if (cache.has(footnote.id)) {
      const item = cache.get(footnote.id);
      const subpath = resolveSubpath(fileCache, "#[^" + footnote.id + "]");
      if (subpath) {
        const text = s05ExtractSubpath(content, fileCache, subpath).content;
        if (item.embed.text === text) {
          item.update(index, refPositions);
          return item;
        }
      }
      item.containerEl.detach();
      cache.delete(footnote.id);
      this.removeChild(item);
    }
    const item = this.addChild(new footnotesParts.FootnoteItem(app, file, footnote.id, index, refPositions));
    cache.set(footnote.id, item);
    return item;
  };

  proto.update = async function () {
    const cache = this.cache;
    const app = this.app;
    const file = this.file;
    const listEl = this.listEl;
    const emptyEl = this.emptyEl;
    const fileCache = file ? app.metadataCache.getFileCache(file) : null;
    const hasFootnotes = !!fileCache?.footnotes?.length;
    listEl.toggle(hasFootnotes);
    emptyEl.toggle(!hasFootnotes);
    if (!hasFootnotes) {
      this.clearCache();
      return;
    }
    // Do not tear the list down while a definition is being edited inline.
    for (const item of cache.values()) {
      if (item.embed.editMode) return;
    }
    // Group reference positions by footnote id; inline footnotes (ids starting with "[inline")
    // get their definition position appended so they sort correctly too.
    const positionsById = {};
    if (fileCache.footnoteRefs?.length) {
      for (const ref of fileCache.footnoteRefs) {
        (positionsById[ref.id] ??= []).push(ref.position);
      }
    }
    if (fileCache.footnotes?.length) {
      for (const footnote of fileCache.footnotes) {
        if (footnote.id.startsWith(INLINE_ID_PREFIX)) (positionsById[footnote.id] ??= []).push(footnote.position);
      }
    }
    // Definitions are listed in order of first reference; unreferenced ones keep cache order at the end.
    const sorted = fileCache.footnotes.slice().sort((a, b) => {
      const pa = positionsById[a.id];
      const pb = positionsById[b.id];
      if (pa?.length && pb?.length) return pa[0].start.offset - pb[0].start.offset;
      return pa?.length ? -1 : 1;
    });
    const els = [];
    for (let i = 0; i < sorted.length; i++) {
      const item = await this.renderFootnote(sorted[i], i, positionsById);
      els.push(item.containerEl);
    }
    listEl.setChildrenInPlace(els);
    this.cleanCache(sorted);
  };

  footnotesParts.FootnotesView = FootnotesView;
  return FootnotesView;
}

/** The plugin shell: registers the view type and the "open footnotes" command. */
export function defineFootnotesPlugin(host) {
  const footnotesT = () => host.t.plugins.footnotesPane;

  class FootnotesPlugin {
    constructor() {
      this.id = "footnotes";
      this.name = footnotesT().name();
      this.description = footnotesT().desc();
      this.defaultOn = false;
    }

    init(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      plugin.registerViewType(s34FootnotesViewType, (leaf) => new footnotesParts.FootnotesView(leaf));
      plugin.registerGlobalCommand({
        id: "footnotes:open",
        name: footnotesT().actionShow(),
        icon: "lucide-file-signature",
        callback: () => {
          this.app.workspace.ensureSideLeaf(s34FootnotesViewType, "right", { active: true });
        },
      });
    }

    onUserEnable() {
      this.initLeaf();
    }

    initLeaf() {
      this.app.workspace.ensureSideLeaf(s34FootnotesViewType, "right", { reveal: false });
    }
  }
  return FootnotesPlugin;
}
