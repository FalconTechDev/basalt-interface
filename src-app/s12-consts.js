// s12 constants: small top-level data of the application scope — view-type names, storage keys,
// i18n label tables, regular expressions, CodeMirror marks/effects and the plugin require maps.
// Everything here is data or a tiny factory; the classes that consume it live in the other s12 modules.
//
// Own modules never name minified identifiers: application values come from env() (envBind) or the
// host object passed to the class factories.

import { env } from "./env.js";

const s12gm = () => env().gm;
const cmDecoration = () => env().s12cmDecoration;
const cmStateField = () => env().s12cmStateField;
const cmStateEffect = () => env().s12cmStateEffect;
const debounce = () => env().debounce;
const s12CreateDiv = (...args) => env().createDiv(...args);

// =====================================================================================================================
// Secrets / storage keys
// =====================================================================================================================

export function s12SecretsWarningKey() { return "secrets-encryption-warning-dismissed"; }
export function s12SecretsDirName() { return "secrets"; }
export function s12SecretsEncryptedName() { return "secrets-encrypted"; }
export function s12SecretsMetaName() { return "secrets-meta"; }

// =====================================================================================================================
// Release notes / workspace layout file names
// =====================================================================================================================

export function s12ReleaseNotesViewType() { return "release-notes"; }
export function s12ReleaseNotesRepo() { return "obsidianmd/obsidian-docs"; }
export function s12WorkspaceLayoutFile() { return "workspace.json"; }
export function s12WorkspaceMobileLayoutFile() { return "workspace-mobile.json"; }

// =====================================================================================================================
// CodeMirror 6 compatibility shim (tree.iterate warning + plugin field defaults)
// =====================================================================================================================

export function s12CmIterateErrorDetail() {
  return "See the stack trace to find the faulty plugin and file an issue with the plugin author. \nDetails: https://discuss.codemirror.net/t/release-0-20-0/4302";
}

/** Wraps a lezer Tree.iterate enter/leave callback with the legacy-syntax warning. */
export function s12CmIterateCompat(inner) {
  return function (spec) {
    console.error(new Error("[CM6] tree.iterate has changed syntax.\n".concat(s12CmIterateErrorDetail())));
    return inner.call(this, spec.type, spec.from, spec.to);
  };
}

/** The shared empty field config used for PluginField.define/decorations/atomicRanges/scrollMargins. */
export function s12CmEmptyFieldConfig() {
  return { from() {} };
}

// =====================================================================================================================
// Plugin require() maps (the names plugins see through require("@codemirror/...")).
// The module objects themselves are bound through env (s12req*).
// =====================================================================================================================

export function s12PluginRequireMap() {
  const e = env();
  return {
    obsidian: e.s12reqObsidian,
    "@codemirror/autocomplete": e.s12reqAutocomplete,
    "@codemirror/collab": e.s12reqCollab,
    "@codemirror/commands": e.s12reqCommands,
    "@codemirror/language": e.s12reqLanguage,
    "@codemirror/lint": e.s12reqLint,
    "@codemirror/search": e.s12reqSearch,
    "@codemirror/state": e.s12reqState,
    "@codemirror/text": e.s12reqState,
    "@codemirror/view": e.s12reqView,
    "@lezer/common": e.s12reqLezerCommon,
    "@lezer/lr": e.s12reqLezerLr,
    "@lezer/highlight": e.s12reqLezerHighlight,
  };
}

export function s12PluginDeprecatedRequireMap() {
  const e = env();
  return {
    "@codemirror/closebrackets": e.s12reqAutocomplete,
    "@codemirror/comment": e.s12reqCommands,
    "@codemirror/fold": e.s12reqLanguage,
    "@codemirror/gutter": e.s12reqView,
    "@codemirror/highlight": e.s12reqLanguage,
    "@codemirror/history": e.s12reqCommands,
    "@codemirror/matchbrackets": e.s12reqLanguage,
    "@codemirror/panel": e.s12reqView,
    "@codemirror/rangeset": e.s12reqState,
    "@codemirror/rectangular-selection": e.s12reqView,
    "@codemirror/stream-parser": e.s12reqLanguage,
    "@codemirror/tooltip": e.s12reqView,
  };
}

// =====================================================================================================================
// Source-map stripping helpers used by the plugin loader
// =====================================================================================================================

export function s12InlineSourcemapPattern() {
  return /^\/\/[@#] sourceMappingURL=data:application\/json(?:;charset[:=][^;]+)?;base64,.*$/gm;
}

export function s12NoSourcemapMarker() { return "\n/* nosourcemap */"; }

// =====================================================================================================================
// Web viewer core plugin data
// =====================================================================================================================

export function s12WebviewerViewType() { return "webviewer"; }
export function s12WebviewerHistoryViewType() { return "webviewer-history"; }
export function s12DefaultSearchEngineKey() { return "duckduckgo"; }
export function s12WebviewerEmptyPageUrl() { return "data:text/plain,"; }

export function s12WebviewerSearchEngines() {
  return {
    duckduckgo: { display: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
    brave: { display: "Brave", url: "https://search.brave.com/search?q=%s" },
    bing: { display: "Bing", url: "https://www.bing.com/search?q=%s" },
    google: { display: "Google", url: "https://www.google.com/search?q=%s" },
    custom: { display: "custom" },
  };
}

export function s12WebviewerDefaultOptions() {
  return { openExternalURLs: true, enableAdblocking: true };
}

/** Empty options object used as a default for the web viewer plugin data. */
export function s12EmptyWebviewerOptions() { return {}; }

/** Tags a <webview> must never load (used when sanitising reader-mode / saved HTML). */
export function s12WebviewTagBlocklist() {
  return ["script", "style", "link", "meta", "object", "embed", "webview"];
}

// =====================================================================================================================
// Tree drag drop indicator (u2 element + h2 debounced positioner + p2/d2 state slots)
// =====================================================================================================================

let s12dropIndicatorEl = null;

export function s12DropIndicatorElement() {
  s12dropIndicatorEl = s12CreateDiv("drop-indicator is-active");
  return s12dropIndicatorEl;
}

export function s12DropIndicatorUpdater() {
  return debounce()((info) => {
    const x = info.x, y = info.y, placement = info.placement;
    s12dropIndicatorEl.style.left = x + "px";
    s12dropIndicatorEl.style.top = (y + (placement === "after" ? 1 : -1) - 2) + "px";
  }, 0);
}

export function s12NullDropState() { return null; }

// =====================================================================================================================
// Callout type tables (live preview + suggest)
// =====================================================================================================================

export function s12CalloutTypeLabels() {
  const t = s12gm().callout.type;
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

/** Every callout type name the editor accepts: the labelled ones plus the extra aliases. */
export function s12CalloutTypeNames() {
  const extra = ["abstract", "summary", "tldr", "todo", "hint", "check", "done", "question", "faq", "help",
    "caution", "attention", "failure", "fail", "missing", "danger", "error", "bug", "example", "cite"];
  return [...Object.keys(s12CalloutTypeLabels()), ...extra];
}

// =====================================================================================================================
// Community plugin sort labels + hotkey filter labels
// =====================================================================================================================

export function s12PluginSortLabels() {
  const t = s12gm().setting.thirdPartyPlugin;
  return {
    download: t.labelByPopularity,
    release: t.labelByReleased,
    alphabetical: t.labelAlphabetical,
    update: t.labelByUpdated,
  };
}

export function s12HotkeyFilterLabels() {
  const t = s12gm().setting.hotkeys;
  return {
    "show-all": t.labelShowAll,
    "show-assigned": t.labelShowAssigned,
    "show-user-assigned": t.labelShowUserAssigned,
    "show-unassigned": t.labelShowUnassigned,
  };
}

// =====================================================================================================================
// Live-preview CodeMirror decorations
// =====================================================================================================================

let s12postprocessFx = null;

/** Creates (once per call site) the state-effect type used to ask live preview to rebuild decorations. */
export function s12CmPostprocessEffect() {
  s12postprocessFx = cmStateEffect().define();
  return s12postprocessFx;
}

/** Schedules a decoration refresh on the given editor view (used by focus/blur and post-processor hooks). */
export function s12cmRefreshDispatch(view) {
  view.dom.win.setTimeout(() => view.dispatch({ effects: s12postprocessFx.of() }), 10);
}

/** The live-preview refresh effect instance created by the G2 declarator (null until then). */
export function s12cmPostprocessFxRef() { return s12postprocessFx; }

let s12mouseDownPlugin = null;

/** The view plugin whose instance tracks whether the mouse button is held down. */
export function s12CmMouseDownPlugin() {
  s12mouseDownPlugin = env().s12cmViewPlugin.define(() => ({ mousedown: false }));
  return s12mouseDownPlugin;
}

/** The shared mouse-down plugin instance (same object the K2 declarator installed). */
export function s12cmMousePluginInstance() { return s12mouseDownPlugin; }

export function s12cmEmptyReplace() { return cmDecoration().replace({}); }
export function s12CmUnderlineMark() {
  return cmDecoration().mark({ class: "cm-underline", attributes: { tabIndex: "-1", draggable: "true" } });
}
export function s12CmTransparentMark() { return cmDecoration().mark({ class: "cm-transparent" }); }
export function s12CmUnresolvedMark() { return cmDecoration().mark({ class: "is-unresolved" }); }
export function s12CmListBulletMark() { return cmDecoration().mark({ class: "list-bullet" }); }
export function s12CmListNumberMark() { return cmDecoration().mark({ class: "list-number" }); }

/** State field remembering whether the mouse button is down (used by selection normalisation). */
export function s12CmMouseDownField() {
  return cmStateField().define(() => ({ mousedown: false }));
}

/** The set of inline syntax tags that get live-preview widgets. */
export function s12LivepreviewSyntaxTags() {
  return new Set(["em", "strong", "inline-code", "strikethrough", "highlight", "link", "image",
    "hmd-internal-link", "hmd-embed", "formatting-link", "footref"]);
}

/** Matches an opening code fence line (``` or ~~~ with optional language). */
export function s12CodeblockFencePattern() {
  return /^\s*(~~~+|```+)[ \t]*([\w\/+#-]*)[^\n`]*$/;
}

// =====================================================================================================================
// Misc view-type names
// =====================================================================================================================

export function s12BacklinkViewType() { return "backlink"; }
export function s12MarkdownViewTypeName() { return "markdown"; }
export function s12DeprecationIndexUrl() {
  return env().s12githubRaw("obsidianmd/obsidian-releases", "community-plugin-deprecation.json");
}
/** Registers the "SecureStorage" capacitor plugin (web = localStorage, ios/android = native module 9804). */
export function s12RegisterSecureStorage() {
  const e = env();
  const req = e.s12webpackRequire;
  let self = null;
  const load = (id) => () => Promise.resolve().then(req.bind(req, id));
  self = e.s12capacitor.F3("SecureStorage", {
    web: async () => new (await load(3357)()).SecureStorageWeb(),
    ios: async () => new (await load(9804)()).SecureStorageNative(self),
    android: async () => new (await load(9804)()).SecureStorageNative(self),
  });
  return self;
}

// =====================================================================================================================
// Small application functions
// =====================================================================================================================

/** Validates a leaf "type" option: boolean or one of the container keywords; returns the value or false. */
export function s12leafTypeOrFalse(e) {
  return !(!isBoolean(e) && "tab" !== e && "window" !== e && "split" !== e) && e;
}

/** Throws (and shows a notice) when a desktop-only feature is used on an old Electron or non-desktop build. */
export function s12requireDesktopApp() {
  const e = env();
  if (!e.Yl.isDesktopApp) {
    const msg = e.gm.interface.msgDesktopOnlyFeature();
    throw new e.fb(msg), new Error(msg);
  }
  if (e.qf < 13) {
    const msg2 = e.gm.interface.msgUpgradeInstaller();
    throw new e.fb(msg2), new Error(msg2);
  }
}

/** Invokes a registered command's checkCallback/callback, or logs when the command has neither. */
export function s12runCommandCallback(cmd) {
  if (cmd.checkCallback) cmd.checkCallback(false);
  else if (cmd.callback) cmd.callback();
  else console.error("Command ".concat(cmd, " did not provide a callback"));
}

/**
 * Rewrites a markdown image/embed link so its size annotation matches `size`.
 * Handles both ![[wiki]] and ![alt](url) forms; a trailing "|WxH" segment is replaced or appended.
 */
export function s12appendImageSizeText(linkText, size) {
  const isImageDimension = env().s12isImageDimension;
  const appendSize = (text) => {
    if (!text || isImageDimension(text)) return size === undefined ? "" : String(size);
    const suffix = size === undefined ? "" : "|".concat(size);
    const bar = text.lastIndexOf("|");
    if (bar !== -1 && isImageDimension(text.slice(bar + 1))) return text.slice(0, bar) + suffix;
    return text + suffix;
  };
  const e = env();
  let m = linkText.match(e.s12wikilinkPattern);
  if (m) {
    const sized = appendSize(m[4] != null ? m[4] : "");
    return "![[" + m[2] + (sized ? "|" + sized : "") + "]]";
  }
  m = linkText.match(e.s12mdLinkPattern);
  if (m) {
    const s = m[1], l = m[2], c = m[3], u = m[4], h = m[8];
    return s + appendSize(l) + c + u + h;
  }
  return linkText;
}

/** Live-preview extension factory: refreshes decorations whenever the properties post-processor changes. */
export function s12PropertiesLivePreviewPlugin(plugin) {
  return env().s12cmViewPlugin.define((view) => {
    const off = plugin.app.workspace.on("post-processor-change", () => s12cmRefreshDispatch(view));
    return { destroy() { off.e.offref(off); } };
  });
}
