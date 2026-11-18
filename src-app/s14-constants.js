// Small core-plugin constants and builders (s14).
//
// Declarator replacements for the tiny inherited items that the core plugins share:
//   plugin ids / view-type strings, the markdown-importer regexes, the file-recovery
//   defaults, the properties sort tables, the file-explorer nav templates and the
//   outgoing-link tree-item constructors.
// Bundle names are read lazily through env() so declaration order never matters.
import { env } from "./env.js";

export const S14_FILE_EXPLORER_PLUGIN_ID = "file-explorer";
export const S14_OUTLINE_PLUGIN_ID = "outline";
export const S14_OUTGOING_LINK_PLUGIN_ID = "outgoing-link";
export const S14_FOOTNOTES_PLUGIN_ID = "footnotes";
export const S14_ALL_PROPERTIES_VIEW_TYPE = "all-properties";
export const S14_FILE_PROPERTIES_VIEW_TYPE = "file-properties";

// Markdown-importer inline patterns (were W8, _8, G8, K8, Y8, Q8).
export const S14_RE_INLINE_FIELD = /\^\^(\S(.*?\S)?)\^\^/g;
export const S14_RE_INLINE_HIGHLIGHT = /::(\S(.*?\S)?)::/g;
export const S14_RE_BLOCK_REF = /\[\[(\d+?)\]\]/g;
export const S14_RE_HASHTAG = /(^|\s)\#([^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]+)/g;
export const S14_RE_TAG_LINK = /\B\#(\[\[[\w \t]*?\]\])/g;
export const S14_RE_TODO = /\{\{\[\[(TODO|DONE)\]\]\}\}/g;

// File-recovery defaults (was L8).
export const S14_FILE_RECOVERY_DEFAULTS = { intervalMinutes: 5, keepDays: 7 };

// Properties sort modes (was b7).
export const S14_PROPERTIES_SORT_MODES = [
  ["alphabetical", "alphabeticalReverse"],
  ["frequency", "frequencyReverse"],
];

// Properties view sort labels (was w7); reads the plugin's i18n strings lazily.
export function s14PropertiesSortLabels() {
  const p = env().gm.plugins.properties;
  return {
    alphabetical: p.labelSortByNameAToZ,
    alphabeticalReverse: p.labelSortByNameZToA,
    frequency: p.labelSortByFrequencyHighToLow,
    frequencyReverse: p.labelSortByFrequencyLowToHigh,
  };
}

// File-explorer nav item templates (were C8, M8): memoized DOM factories via Sg().
export function s14NavFileTemplate() {
  return env().Sg(() => {
    const el = createDiv("tree-item nav-file");
    el.createDiv("tree-item-self nav-file-title tappable is-clickable").createDiv("tree-item-inner nav-file-title-content");
    return el;
  });
}

export function s14NavFolderTemplate() {
  return env().Sg(() => {
    const el = createDiv("tree-item nav-folder");
    el.createDiv("tree-item-self nav-folder-title is-clickable").createDiv("tree-item-inner nav-folder-title-content");
    el.createDiv("tree-item-children nav-folder-children");
    return el;
  });
}

// Outgoing-link tree group (was s7): the collapsible parent row that owns the link items.
export function s14OutgoingLinkGroup(el) {
  this.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
  this.vChildren = new (env().UH)(this);
  this.pusherEl = env().JH();
  this.el = el;
  this.childrenEl = el;
}

// Outgoing-link tree leaf (was l7): builds the clickable "link to note" row.
// Args: parent tree item, linktext, display title, positional subref, sourcePath, target file.
export function s14OutgoingLinkItem(parent, linktext, title, subref, sourcePath, targetFile) {
  const e = env();
  this.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
  this.invalidated = false;
  this.sourcePath = sourcePath;
  const app = parent.app;
  const selfEl = (this.el = createDiv("tree-item-self is-clickable outgoing-link-item"));
  const iconEl = selfEl.createSpan("tree-item-icon");
  let icon = "lucide-link";
  let rowTitle = title;
  let subtext = "";
  if (targetFile) {
    if (subref) {
      const pos = e.FT(app.metadataCache.getFileCache(targetFile), subref);
      if (pos) {
        if (pos.type === "heading") {
          icon = "heading-glyph";
          rowTitle = pos.current.heading;
          subtext = title;
        } else if (pos.type === "block") {
          icon = "lucide-layout-list";
          rowTitle = pos.block.id;
          subtext = title;
        }
      } else {
        icon = "lucide-file-question";
        rowTitle = subref;
        subtext = title;
      }
    } else {
      icon = "lucide-link";
      if (targetFile.parent.path !== "/") subtext = e.iu(targetFile.path);
    }
  } else {
    icon = "lucide-file-plus";
    e.Mv(selfEl, e.gm.plugins.outgoingLinks.tooltipNotCreated());
  }
  e.tv(iconEl, icon);
  const inner = selfEl.createDiv({ cls: "tree-item-inner" });
  inner.createDiv({ cls: "tree-item-inner-text", text: rowTitle });
  if (subtext) inner.createDiv({ cls: "tree-item-inner-subtext", text: subtext });
  selfEl.onClickEvent((ev) => {
    if (ev.button === 0 || ev.button === 1) app.workspace.openLinkText(linktext, sourcePath, e.Bg.isModEvent(ev));
  });
  selfEl.addEventListener("contextmenu", (ev) => {
    const menu = new e.Ug().addSections(["title", "open", "action", "view", "info", "", "danger"]);
    if (app.workspace.handleLinkContextMenu(menu, linktext, sourcePath)) {
      ev.preventDefault();
      menu.setParentElement(selfEl).showAtMouseEvent(ev);
    }
  });
  selfEl.addEventListener("mouseover", (ev) => {
    if (!ev.defaultPrevented && e.Lc(ev, selfEl)) {
      ev.preventDefault();
      app.workspace.trigger("hover-link", { event: ev, source: "search", hoverParent: parent, targetEl: selfEl, linktext, sourcePath });
    }
  });
  if (targetFile) {
    const dragManager = app.dragManager;
    dragManager.handleDrag(selfEl, (ev) => dragManager.dragFile(ev, targetFile));
  }
}
