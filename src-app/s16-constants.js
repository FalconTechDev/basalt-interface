// s16 slice: small declarators and helpers — worker sources, lookup tables, platform
// bindings, version constants and the AppContainer element builder. Everything here is
// either a literal table or a thin binding; the real logic lives in the feature modules.
import { isOlderVersion } from "./text.js";

/** Name the sync worker is registered under. */
export const s16SyncWorkerName = "sync";

/** The WebSocket constructor as the platform exposes it. */
export const s16WebSocket = window.WebSocket;

/** The URL constructor (its `hostname` getter is lifted separately below). */
export const s16UrlClass = window.URL;

/** Unbound `URL.prototype.hostname` getter, used to read a url's host without `new URL`. */
export const s16UrlHostnameGetter = Object.getOwnPropertyDescriptor(window.URL.prototype, "hostname").get;

/** Unbound `String.prototype.endsWith`, kept so callers can `.call` it on any string. */
export const s16EndsWith = String.prototype.endsWith;

// WebSocket close code → human-readable reason (sync socket disconnect errors).
export const s16CloseCodes = {
  1000: "Disconnected",
  1001: "Going Away",
  1002: "Protocol Error",
  1003: "Unsupported Data",
  1004: "(For future)",
  1005: "No Status Received",
  1006: "Disconnected",
  1007: "Invalid frame payload data",
  1008: "Policy Violation",
  1009: "Message too big",
  1010: "Missing Extension",
  1011: "Internal Error",
  1012: "Service Restart",
  1013: "Try Again Later",
  1014: "Bad Gateway",
  1015: "TLS Handshake",
};

/** `window.process.platform` when the preload bridge exposes one (undefined in a plain browser). */
export const s16PlatformTag = window.process && window.process.platform;

/** View type id of the tag pane side leaf. */
export const s16TagViewType = "tag";

/** Sort orders offered by the tag pane, as [id, i18n-key-suffix] pairs. */
export const s16TagSortModes = [
  ["alphabetical", "alphabeticalReverse"],
  ["frequency", "frequencyReverse"],
];

/** localStorage key recording that the mobile "rate us" prompt already ran. */
export const s16MobileFeedbackFlag = "didProvideMobileFeedback";

/** Plugin API version the bundle reports to plugins (`apiVersion` / `requireApiVersion`). */
export const s16ApiVersion = "1.12.7";

/** Minimum installer version that may apply an update without a manual download. */
export const s16InstallerMinVersion = "28.2.3";

/** Default timestamp format for unique-note file names. */
export const s16UniqueNoteFormat = "YYYYMMDDHHmm";

/** i18n keys of the built-in colour themes, in picker order. */
export const s16ThemeList = [
  { id: "basalt", nameI18n: "dark-theme" },
  { id: "moonstone", nameI18n: "light-theme" },
  { id: "system", nameI18n: "system-theme" },
];

/** PNG signature bytes checked before decoding an embedded image. */
export const s16PngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

/** The four bytes that open a PNG `IHDR` chunk. */
export const s16PngIHDR = [73, 72, 68, 82];

/** PNG chunk ids the metadata reader knows how to skip or use. */
export const s16PngChunkIds = ["ic07", "ic13", "ic08", "ic14", "ic09", "ic10"];

/** Font names probed for coverage; the probe result is cached in `s16FontProbeCache`. */
export const s16SystemFontList = [
  "Arial", "Arial Black", "Bahnschrift", "Calibri", "Cambria", "Cambria Math", "Candara",
  "Comic Sans MS", "Consolas", "Constantia", "Corbel", "Courier New", "Ebrima",
  "Franklin Gothic Medium", "Gabriola", "Gadugi", "Georgia", "HoloLens MDL2 Assets",
  "Impact", "Ink Free", "Javanese Text", "Leelawadee UI", "Lucida Console",
  "Lucida Sans Unicode", "Malgun Gothic", "Marlett", "Microsoft Himalaya",
  "Microsoft JhengHei", "Microsoft New Tai Lue", "Microsoft PhagsPa",
  "Microsoft Sans Serif", "Microsoft Tai Le", "Microsoft YaHei", "Microsoft Yi Baiti",
  "MingLiU-ExtB", "Mongolian Baiti", "MS Gothic", "MV Boli", "Myanmar Text",
  "Nirmala UI", "Palatino Linotype", "Segoe MDL2 Assets", "Segoe Print", "Segoe Script",
  "Segoe UI", "Segoe UI Historic", "Segoe UI Emoji", "Segoe UI Symbol", "SimSun",
  "Sitka", "Sylfaen", "Symbol", "Tahoma", "Times New Roman", "Trebuchet MS",
  "Verdana", "Webdings", "Wingdings", "Yu Gothic", "American Typewriter",
  "Andale Mono", "Arial Narrow", "Arial Rounded MT Bold", "Arial Unicode MS",
  "Avenir", "Avenir Next", "Avenir Next Condensed", "Baskerville", "Big Caslon",
  "Bodoni 72", "Bodoni 72 Oldstyle", "Bodoni 72 Smallcaps", "Bradley Hand",
  "Brush Script MT", "Chalkboard", "Chalkboard SE", "Chalkduster", "Charter", "Cochin",
  "Copperplate", "Courier", "Didot", "DIN Alternate", "DIN Condensed", "Futura",
  "Geneva", "Gill Sans", "Helvetica", "Helvetica Neue", "Herculanum",
  "Hoefler Text", "Lucida Grande", "Luminari", "Marker Felt", "Menlo",
  "Noteworthy", "Optima", "Palatino", "Papyrus", "Phosphate", "Rockwell",
  "Savoye LET", "SignPainter", "Skia", "Snell Roundhand", "Times",
  "Trattatello", "Zapfino",
];

/** Names already measured during a font probe run, so each family is drawn once. */
export const s16FontProbeSeen = new Set();

/** A promise that is already resolved, used where a microtask tick is enough. */
export const s16SettledPromise = Promise.resolve();

/** True when `version` does not require an API newer than the running build (reads the live binding). */
export function s16CheckApiVersion(version, host) {
  return !isOlderVersion(host.s16ApiVersion, version);
}

/** Resolves true when the font can draw the probe string (false for missing/blocked fonts). */
export function s16FontAvailable(name) {
  return (async () => {
    if (name === "") return true;
    await document.fonts.ready;
    return document.fonts.check(`12px "${name}"`);
  })();
}

/** The root element builder: app container, workspace row and status-bar strip. */
export function s16AppContainer(hostEl) {
  this.appContainerEl = hostEl.createDiv("app-container");
  this.horizontalMainContainerEl = this.appContainerEl.createDiv("horizontal-main-container");
  this.workspaceEl = this.horizontalMainContainerEl.createDiv("workspace");
  this.statusBarEl = this.appContainerEl.createDiv("status-bar");
}
