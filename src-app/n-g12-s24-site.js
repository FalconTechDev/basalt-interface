// g12 clean-room: the published-site descriptor — identity, scheme, URL
// builders, options with s09 defaults, cache wiring, password token and the
// signed path suffix. No DOM here; safe to import standalone.
import { env } from "./env.js";
import { ng12PublishSiteCache, ng12PublishDefaults } from "./n-g12-s09-core.js";
import { extensionOf, lastSegment, withoutMd, parseLinktext, linkPath } from "./path.js";
import { formEncodePath } from "./text.js";

const ng12Loopback = (host) =>
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|$)/i.test(host || "");

let ng12MemoryStore = null;
function ng12Storage() {
  try {
    const probe = "__ng12_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch (e) {
    if (!ng12MemoryStore) ng12MemoryStore = new Map();
    return {
      getItem: (k) => (ng12MemoryStore.has(k) ? ng12MemoryStore.get(k) : null),
      setItem: (k, v) => ng12MemoryStore.set(k, String(v)),
      removeItem: (k) => ng12MemoryStore.delete(k),
    };
  }
}

let ng12PublishSiteClass = null;
export function ng12PublishSite() {
  if (ng12PublishSiteClass) return ng12PublishSiteClass;

  class Ng12PublishSite {
    constructor(publish, siteInfo) {
      publish = publish || {};
      siteInfo = siteInfo || (typeof window !== "undefined" ? window.siteInfo : null) || {};
      this.id = siteInfo.uid || siteInfo.id;
      const rawHost = siteInfo.host || "";
      this.slug = siteInfo.slug || "";
      this.customUrl = siteInfo.customurl || "";
      this.status = siteInfo.status;
      this.options = siteInfo.options || {};
      this.isLocalHost = ng12Loopback(rawHost);
      this.host = (this.isLocalHost ? "http://" : "https://") + rawHost;
      this.origin = this.host;
      this._suffixCache = null;

      // password token persisted per site id; session fallback when storage throws
      try {
        this.hpw = ng12Storage().getItem(this.id);
      } catch (e) {
        this.hpw = null;
      }

      // link index used by URL builders and the page renderer
      this.cache = new (ng12PublishSiteCache())();

      const slug = encodeURIComponent(this.slug);
      this.pathprefix = this.customUrl
        ? "https://" + this.customUrl + "/"
        : this.origin + "/" + slug + "/";
      this.publicOrigin = this.customUrl ? "https://" + this.customUrl : this.origin;

      // event plumbing (tiny local emitter; the app also triggers on itself)
      this._events = {};
    }

    on(name, cb) {
      (this._events[name] = this._events[name] || []).push(cb);
      return this;
    }

    off(name, cb) {
      const list = this._events[name];
      if (list) {
        const i = list.indexOf(cb);
        if (i >= 0) list.splice(i, 1);
      }
      return this;
    }

    trigger(name, ...args) {
      for (const cb of (this._events[name] || []).slice()) cb(...args);
      return this;
    }

    getConfig(key) {
      const value = this.options ? this.options[key] : undefined;
      if (value !== undefined) return value;
      return ng12PublishDefaults()[key];
    }

    getSiteName() {
      const name = this.options && this.options.siteName;
      return name || this.slug;
    }

    getSiteLogoUrl() {
      return (this.options && this.options.logo) || "";
    }

    isCustomDomain() {
      return !!this.customUrl;
    }

    /** Public href for a vault path: prefix + form-encoded segments, ".md" stripped. */
    getPublicHref(path) {
      path = String(path || "");
      // frontmatter permalink wins (leading "/" tolerated, stored slash-less)
      const permalink = this.cache && this.cache.permalinks
        ? this._permalinkFor(path)
        : null;
      let rel;
      if (permalink) {
        rel = permalink;
      } else {
        rel = withoutMd(path);
        rel = formEncodePath(rel, "/");
      }
      return this.pathprefix + rel;
    }

    _permalinkFor(path) {
      // permalinks map: pretty path -> vault path; invert lazily
      if (!this._prettyByPath) {
        this._prettyByPath = {};
        const map = this.cache.permalinks || {};
        for (const pretty of Object.keys(map)) {
          this._prettyByPath[map[pretty]] = pretty;
        }
      }
      return this._prettyByPath[path] || null;
    }

    /** Credentialed backend URL for raw file bytes (media, markdown fetches). */
    getInternalUrl(path) {
      const rel = String(path || "")
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/");
      return this.origin + "/access/" + encodeURIComponent(this.id) + "/" + rel;
    }

    getPathSuffix() {
      if (this._suffixCache) return this._suffixCache;
      const pw = this.hpw;
      if (!pw) {
        this._suffixCache = "";
        return "";
      }
      const ts = Date.now();
      let sig = "";
      try {
        const hasher = env().GY ? env().GY() : null;
        const enc = env().WY ? env().WY() : null;
        if (hasher && enc && hasher.update) {
          hasher.update(String(pw));
          sig = enc.stringify(hasher);
        } else {
          sig = "sig";
        }
      } catch (e) {
        sig = "sig";
      }
      this._suffixCache = "?ts=" + ts + "&sig=" + sig;
      return this._suffixCache;
    }

    async loadMarkdownFile(path) {
      return env().ajaxPromise({
        url: this.getInternalUrl(path) + this.getPathSuffix(),
        withCredentials: true,
      });
    }

    /** Homepage path per contract: indexFile config, else index.md, else first md key. */
    getIndexPath() {
      const cache = this.cache && this.cache.cache ? this.cache.cache : {};
      const configured = this.getConfig("indexFile");
      if (configured && cache[configured]) return configured;
      if (cache["index.md"]) return "index.md";
      for (const path of Object.keys(cache)) {
        if (extensionOf(path) === "md") return path;
      }
      return "index.md";
    }
  }

  ng12PublishSiteClass = Ng12PublishSite;
  return Ng12PublishSite;
}
