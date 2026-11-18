// s10 constants: small top-level values of the application scope (cache timings, file names,
// operator tables, event lists, regular expressions and shared sets/arrays).
// Every export is prefixed s10 so the flat own-module scope stays collision-free.

// Sliding-window pane geometry used by the publish view (min width and per-pane offset, px).
export const s10PublishPaneMinWidth = 700;
export const s10PublishPaneOffset = 36;

// Style/script file names the publish flow loads into remote pages.
export const s10BasaltCssName = "basalt.css";
export const s10PublishCssName = "publish.css";
export const s10PublishJsName = "publish.js";

// Matches the per-size favicon files the publish site emits (favicon-<size>(x<scale>).png).
export const s10FaviconPattern = /^favicon-([0-9]+)(x[0-9]+)?.png$/i;

// View type id of the Bases database view.
export const s10BasesViewType = "bases";

// Comparison operators offered by the bases filter editor, and the subset used for ordering.
export const s10FilterCompareOps = ["==", "!=", "<", ">", "<=", ">="];
export const s10FilterOrderOps = ["<", ">", "<=", ">="];

// Characters that may not appear inside a wikilink target, kept as a display string.
export const s10WikiLinkChars = ["#", ":", "|", "^", "%%", "[[", "]]"].join(" ");

// CSS custom properties and body classes mirrored into popout windows.
export const s10PopoutStyleVars = ["--zoom-factor", "--keyboard-height"];
export const s10PopoutBodyClasses = ["is-frameless", "is-focused", "is-fullscreen"];

// DOM events re-dispatched from a popout window onto the main window.
export const s10ForwardedEvents = [
  "fullscreenchange", "click", "contextmenu", "auxclick", "keydown", "keyup",
  "mousedown", "mouseup", "mousemove", "copy", "paste", "cut", "drag",
  "dragstart", "dragover", "dragend", "dragenter", "dragleave", "drop", "open-url",
];

// Leading whitespace/blockquote-marker run used by the markdown indent commands.
export const s10LinePrefix = /^[\s>]+/;

// Key combinations the editor leaves to the OS or to other handlers.
export const s10UnboundEditorKeys = new Set([
  "Alt-ArrowUp", "Shift-Alt-ArrowUp", "Alt-ArrowDown", "Shift-Alt-ArrowDown",
  "Alt-l", "Alt-v", "Ctrl-m",
]);

// The shared extension list the markdown editor builds up with .push() calls.
export const s10EditorExtensions = [];

// History store array consumed by the editor history field.
export const s10CmHistoryStore = [];
