// s22 slice: constants, matcher placeholders, embed URL handling and the iframe
// message bridge. Replaces inherited top-level declarations; names are s22-prefixed
// because all own modules share one flat scope inside the bundle.
import { env } from "./env.js";

// Search target fields the query parser knows about.
export const s22SearchFields = ["filename", "filepath", "content", "propertyName", "tag"];

// Placeholder matcher objects: stand-ins for matcher types that carry no behaviour of
// their own (they only mark "this slot is occupied" for the query UI).
export function s22NoopMatcher() {}
export function s22NewNoopMatcher() { return new s22NoopMatcher(); }

// Three distinct empty objects the bundle kept as separate singletons (tH, nH, sq).
export const s22BlankObjectA = {};
export const s22BlankObjectB = {};
export const s22BlankObjectC = {};
export const s22Nothing = null;

// Default sort field used by the file-explorer style sort UI.
export const s22DefaultSortField = "filepath";

// Sort mode pairs offered by the sort menu, in display order.
export const s22SortModePairs = [
  ["alphabetical", "alphabeticalReverse"],
  ["byModifiedTime", "byModifiedTimeReverse"],
  ["byCreatedTime", "byCreatedTimeReverse"],
];

// Localised labels for the sort modes (built lazily so `gm` is resolved at use time).
export function s22SortLabels() {
  const gm = env().gm;
  return {
    alphabetical: gm.plugins.fileExplorer.labelSortAToZ,
    alphabeticalReverse: gm.plugins.fileExplorer.labelSortZToA,
    byModifiedTime: gm.plugins.fileExplorer.labelSortNewToOld,
    byModifiedTimeReverse: gm.plugins.fileExplorer.labelSortOldToNew,
    byCreatedTime: gm.plugins.fileExplorer.labelSortCreatedNewToOld,
    byCreatedTimeReverse: gm.plugins.fileExplorer.labelSortCreatedOldToNew,
  };
}

// Sort comparators for file-like objects { basename, stat: { mtime, ctime } }.
export function s22SortComparators() {
  const ub = env().ub;
  const out = {
    alphabetical: (a, b) => ub(a.basename, b.basename),
    byModifiedTime: (a, b) => b.stat.mtime - a.stat.mtime,
    byCreatedTime: (a, b) => b.stat.ctime - a.stat.ctime,
  };
  // reverse modes delegate to the forward ones, like the original did
  out.alphabeticalReverse = (a, b) => -out.alphabetical(a, b);
  out.byModifiedTimeReverse = (a, b) => -out.byModifiedTime(a, b);
  out.byCreatedTimeReverse = (a, b) => -out.byCreatedTime(a, b);
  return out;
}

// Paragraph boundary used when scanning preview text for blank-line splits.
export const s22ParagraphBreak = /\r?\n\r?\n/y;

// Markdown render flags object; inherited code mutates the fields after init
// (progressiveRender / listBullet are disabled for bots and old webviews).
export const s22RenderFlags = { progressiveRender: true, asyncParse: true, listBullet: true };

// Windows that already have the iframe message bridge installed (one listener per window).
export const s22FrameBridgeSeen = new WeakSet();

// Installs a "message" listener on `win` that re-dispatches messages coming from
// same-window iframes as "framemessage" CustomEvents on the iframe element.
export function s22InstallFrameBridge(win) {
  if (s22FrameBridgeSeen.has(win)) return;
  s22FrameBridgeSeen.add(win);
  win.addEventListener("message", (event) => {
    const frames = win.document.body.findAll("iframe");
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (frame.contentWindow === event.source) {
        frame.dispatchEvent(new CustomEvent("framemessage", { bubbles: false, detail: event }));
        return;
      }
    }
  });
}

// ---- embed URL detection (youtube-nocookie / twitter embeds) ----
export const s22YoutubeUrl = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)(?:\/(?:[\w\-]+\?(?:.*?\&)*v=|embed\/|v\/)?)([\w\-]+)(?:\??&?(?:t|start)=([0-9]+))?(?:\S+)?$/;
export const s22TweetUrl = /^(?:https?:\/\/)?(?:mobile\.)?(?:twitter|x)\.com\/.+\/(\d+)/;

// Normalises a supported embed URL to the iframe src, or null when unsupported.
export function s22NormalizeEmbedUrl(url) {
  if (!url || typeof url !== "string") return null;
  let m = url.match(s22YoutubeUrl);
  if (m) {
    url = "https://www.youtube-nocookie.com/embed/" + m[1];
    if (m[2]) url += "?start=" + m[2];
    return url;
  }
  m = url.match(s22TweetUrl);
  if (m) {
    const dark = document.body.hasClass("theme-dark");
    return "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=" + (dark ? "dark" : "light") + "&id=" + m[1];
  }
  return null;
}

// Builds the sandboxed iframe used for external embeds; twitter gets extra sizing
// handling through the twttr.embed resize message.
export function s22CreateEmbedFrame(src) {
  const frame = env().createEl("iframe", "external-embed mod-receives-events");
  frame.setAttr("sandbox", "allow-forms allow-presentation allow-same-origin allow-popups-to-escape-sandbox allow-scripts allow-modals allow-popups");
  frame.setAttr("allow", "fullscreen");
  frame.setAttr("frameborder", "0");
  frame.setAttr("referrerpolicy", "strict-origin-when-cross-origin");
  frame.src = src;
  if (src.includes("platform.twitter.com")) {
    frame.setAttr("scrolling", "no");
    frame.addEventListener("framemessage", (event) => {
      const detail = event.detail;
      if (!detail) return;
      const data = detail.data;
      if (!data) return;
      const inner = data["twttr.embed"];
      if (inner && inner.method === "twttr.private.resize") {
        const height = inner.params[0].height;
        if (Number.isNumber(height)) frame.style.height = String(Math.min(1000, height)) + "px";
      }
    });
    s22InstallFrameBridge(frame.win);
    frame.onWindowMigrated(() => s22InstallFrameBridge(frame.win));
  }
  return frame;
}
