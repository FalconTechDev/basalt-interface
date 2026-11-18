// g12 clean-room: publish site toolkit, core part.
// Option keys/defaults, the shared link-hover tracker, the published-site
// link index (cache/aliases/permalinks), subpath resolution and graph data.
import { env } from "./env.js";
import { s09GraphNodeData } from "./s09-graph.js";

const ng12Has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// ---- option keys (declarator strings) ----
export const ng12PubOptIndexFile = "indexFile";
export const ng12PubOptSiteName = "siteName";
export const ng12PubOptLogo = "logo";
export const ng12PubOptNoindex = "noindex";
export const ng12PubOptDefaultTheme = "defaultTheme";
export const ng12PubOptShowThemeToggle = "showThemeToggle";
export const ng12PubOptShowNavigation = "showNavigation";
export const ng12PubOptShowGraph = "showGraph";
export const ng12PubOptShowOutline = "showOutline";
export const ng12PubOptShowSearch = "showSearch";
export const ng12PubOptGoogleAnalytics = "googleAnalytics";
export const ng12PubOptHideTitle = "hideTitle";
export const ng12PubOptReadableLineLength = "readableLineLength";
export const ng12PubOptStrictLineBreaks = "strictLineBreaks";
export const ng12PubOptShowHoverPreview = "showHoverPreview";
export const ng12PubOptShowBacklinks = "showBacklinks";
export const ng12PubOptSlidingWindowMode = "slidingWindowMode";
export const ng12PubOptNavigationOrdering = "navigationOrdering";
export const ng12PubOptNavigationHiddenItems = "navigationHiddenItems";

/** Fresh default value per option key (was the body of `dQ`). */
export function ng12PublishDefaults() {
  return {
    indexFile: "",
    siteName: "",
    logo: "",
    noindex: false,
    defaultTheme: "light",
    showThemeToggle: false,
    showNavigation: true,
    showGraph: true,
    showOutline: false,
    showSearch: false,
    googleAnalytics: "",
    hideTitle: false,
    readableLineLength: true,
    strictLineBreaks: false,
    showHoverPreview: false,
    showBacklinks: false,
    slidingWindowMode: false,
    navigationOrdering: [],
    navigationHiddenItems: [],
  };
}

/** getConfig helper shared by the published-site views: stored value or default. */
export function ng12PublishConfig(site, key) {
  const options = site.options || {};
  return options[key] !== undefined ? options[key] : ng12PublishDefaults()[key];
}

// ---- link-hover tracker (module-level shared state) ----
// The four declarator bindings below are the live shared arrays/placeholders;
// the timer id and pointer position live in private state (the pointer is also
// mirrored into ng12PublishHoverPointRef.value, which the code actually reads).
export const ng12PublishHiddenHovers = [];
export const ng12PublishActiveHovers = [];
export const ng12PublishHoverTimer = 0;
export const ng12PublishHoverPoint = null;
export const ng12PublishHoverPointRef = { value: null };

let ng12HoverTimerId = 0;

function ng12HoverWin() {
  return env().activeWindow || window;
}

function ng12HoverDoc() {
  return env().activeDocument || document;
}

export function ng12PublishHoverMove(e) {
  ng12PublishHoverPointRef.value = {
    x: e.clientX,
    y: e.clientY,
    doc: e.doc || (e.win && e.win.document) || ng12HoverDoc(),
  };
}

export function ng12PublishHoverTick() {
  const actives = ng12PublishActiveHovers;
  if (actives.length === 0) {
    const win = ng12HoverWin();
    win.removeEventListener("click", ng12PublishHoverClick, true);
    win.removeEventListener("contextmenu", ng12PublishHoverClick, true);
    win.removeEventListener("mousemove", ng12PublishHoverMove);
    if (ng12HoverTimerId) win.clearInterval(ng12HoverTimerId);
    ng12HoverTimerId = 0;
    ng12PublishHoverPointRef.value = null;
    return;
  }
  const point = ng12PublishHoverPointRef.value;
  if (!point) return;
  const el = point.doc.elementFromPoint(point.x, point.y);
  for (const hover of actives) hover.detect(el);
  for (const hover of actives) hover.transition();
}

export function ng12PublishHoverClick(e) {
  for (const hover of ng12PublishHiddenHovers) hover.hide();
  const target = e.targetNode;
  const stale = [];
  for (const hover of ng12PublishActiveHovers) {
    if (hover.isFocused) continue;
    const hoverEl = hover.hoverEl;
    if (target && hoverEl && hoverEl.contains && hoverEl.contains(target)) continue;
    let insideChild = false;
    for (const child of hover.childHovers || []) {
      const childEl = child.hoverEl;
      if (target && childEl && childEl.contains && childEl.contains(target)) { insideChild = true; break; }
    }
    if (!insideChild) stale.push(hover);
  }
  const win = e.win || ng12HoverWin();
  win.setTimeout(() => {
    for (const hover of stale) hover.hide();
  }, 5);
}

export function ng12PublishHoverStart() {
  if (ng12HoverTimerId) return;
  const win = ng12HoverWin();
  win.addEventListener("click", ng12PublishHoverClick, true);
  win.addEventListener("contextmenu", ng12PublishHoverClick, true);
  win.addEventListener("mousemove", ng12PublishHoverMove);
  ng12HoverTimerId = win.setInterval(ng12PublishHoverTick, 500);
}

// ---- published-site link index (was `KY`) ----
let ng12SiteCacheClass = null;

/** Factory: returns the PublishSiteCache class (memoized per module instance). */
export function ng12PublishSiteCache(host) {
  if (ng12SiteCacheClass) return ng12SiteCacheClass;

  class Ng12SiteIndex {
    constructor() {
      this.cache = {};
      this.uniqueFiles = new (env().sc)();
      this.aliases = {};
      this.permalinks = {};
    }

    async load(cache) {
      this.cache = cache || {};
      this.uniqueFiles = new (env().sc)();
      this.aliases = {};
      this.permalinks = {};
      const paths = Object.keys(this.cache);
      for (const path of paths) {
        this.uniqueFiles.add(env().nu(path).toLowerCase(), path);
      }
      for (const path of paths) {
        const entry = this.cache[path];
        if (!entry || !entry.frontmatter) continue;
        const normalized = env().wT(entry) || entry;
        const aliases = env().nT(normalized.frontmatter || entry.frontmatter);
        if (aliases) {
          for (const alias of aliases) this.aliases[String(alias).toLowerCase()] = path;
        }
        const permalink = entry.frontmatter.permalink;
        if (typeof permalink === "string") {
          this.permalinks[permalink.startsWith("/") ? permalink.slice(1) : permalink] = path;
        }
      }
      return this;
    }

    getCache(path) {
      return ng12Has(this.cache, path) ? this.cache[path] : null;
    }

    has(path) {
      return ng12Has(this.cache, path);
    }

    getLinktextDest(linktext, sourcePath) {
      const parsed = env().MT(linktext);
      return this.getLinkpathDest(parsed && parsed.path !== undefined ? parsed.path : env().ET(linktext), sourcePath);
    }

    getLinkpathDest(path, sourcePath) {
      if (path === "" && sourcePath !== undefined && this.has(sourcePath)) return sourcePath;
      let candidates = this._getLinkpathDest(path, sourcePath);
      if (candidates.length > 0) return candidates[0];
      candidates = this._getLinkpathDest(path + ".md", sourcePath);
      if (candidates.length > 0) return candidates[0];
      const lower = String(path).toLowerCase();
      if (this.aliases[lower] !== undefined) return this.aliases[lower];
      const base = env().nu(path);
      if (this.aliases[base] !== undefined) return this.aliases[base];
      return null;
    }

    // Ordered candidate list for a link path (may be relative); first entry wins.
    _getLinkpathDest(path, sourcePath) {
      const lower = String(path).toLowerCase();
      const base = env().nu(lower);
      const candidates = this.uniqueFiles.get(base);
      if (!candidates || candidates.length === 0) return [];
      const folder = String(env().iu(sourcePath || "")).toLowerCase();

      if (path.startsWith("./") || path.startsWith("../")) {
        let rest = path;
        let dir = folder;
        if (rest.startsWith("./../")) rest = rest.slice(2);
        else if (rest.startsWith("./")) rest = rest.slice(2);
        while (rest.startsWith("../")) {
          rest = rest.slice(3);
          dir = env().iu(dir);
        }
        const target = (dir ? dir + "/" : "") + rest;
        const wanted = target.toLowerCase();
        return candidates.filter((candidate) => candidate.toLowerCase() === wanted);
      }

      for (const candidate of candidates) {
        if (candidate.toLowerCase() === lower) return [candidate];
      }
      const withFolder = [];
      const withoutFolder = [];
      for (const candidate of candidates) {
        const cl = candidate.toLowerCase();
        if (cl.endsWith(lower) && cl.startsWith(folder)) withFolder.push(candidate);
        else withoutFolder.push(candidate);
      }
      const byLength = (a, b) => a.length - b.length;
      withFolder.sort(byLength);
      withoutFolder.sort(byLength);
      return withFolder.concat(withoutFolder);
    }
  }

  ng12SiteCacheClass = Ng12SiteIndex;
  return Ng12SiteIndex;
}

// ---- subpath -> location (was `oX`) ----
export function ng12PublishResolveSub(text, entry, subpath) {
  if (subpath && entry && entry.footnotes === undefined && /^#\[\^.*\]$/.test(subpath)) {
    const parsed = env().fT(text);
    entry.footnotes = parsed ? parsed.footnotes : undefined;
  }
  return env().FT(entry, subpath);
}

// ---- graph data (was `OQ`) ----
export async function ng12PublishGraphData(cache, options) {
  const nodes = {};
  const showAttachments = !!(options && options.showAttachments);
  const hideUnresolved = !!(options && options.hideUnresolved);
  const showTags = !!(options && options.showTags);
  const isMd = (path) => env().su(path) === "md";

  for (const path of Object.keys(cache.cache)) {
    if (!isMd(path) && !showAttachments) continue;
    const entry = cache.cache[path];
    const node = (nodes[path] = s09GraphNodeData());
    const links = node.links;
    env().ST(entry, (ref) => {
      const target = env().ET(ref.link);
      const dest = cache.getLinktextDest(target, path);
      if (dest) {
        if (showAttachments || isMd(dest)) links[dest] = true;
      } else if (hideUnresolved) {
        links[target] = true;
        if (!nodes[target]) nodes[target] = s09GraphNodeData("unresolved");
      }
    });
    if (showTags) {
      const tags = env().DT(entry);
      if (tags) {
        for (const tag of tags) {
          links[tag] = true;
          if (!nodes[tag]) nodes[tag] = s09GraphNodeData("tag");
        }
      }
    }
  }
  return { nodes };
}
