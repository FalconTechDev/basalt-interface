// s04: own implementations of the application's small HTTP/URL helpers.
//
// Replaces the inherited request pipeline: the data-URL parser, the response
// wrapper, the platform-specific request core (Capacitor Http, Electron IPC or
// fetch), the promise-with-async-getters wrapper used as `request()`, the
// GitHub URL builders and the theme version picker.
//
// Platform details that stay inherited are read lazily through env(): the
// Capacitor bridge (Em/xm/Sm), the require shim (If), the Electron IPC request
// (Nf) and the app version (gte).

import { env } from "./env.js";

// ---------------------------------------------------------------- URL query helpers (was `ry`)

function s04EncodeUrlQuery(params) {
  if (!params) return "";
  const parts = [];
  for (const key in params) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
    const value = params[key];
    if (!value) continue;
    if (value === true) parts.push(encodeURIComponent(key));
    else parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
  }
  return parts.join("&");
}

function s04DecodeUrlQuery(text) {
  const out = {};
  if (!text || text.trim() === "") return out;
  const pairs = text.split("&");
  for (let i = 0; i < pairs.length; i++) {
    const kv = pairs[i].split("=");
    if (kv.length >= 1 && kv[0]) {
      const key = decodeURIComponent(kv[0]);
      out[key] = kv.length === 2 ? decodeURIComponent(kv[1]) : "";
    }
  }
  return out;
}

/** Query-string codec plus addQuery/decodeUrl helpers (the `ry` object). */
export function s04UrlQuery() {
  function Query() {}
  Query.encodeUrlQuery = s04EncodeUrlQuery;
  Query.decodeUrlQuery = s04DecodeUrlQuery;
  Query.decodeUrl = function (url) {
    if (!url) url = "";
    const hashParts = url.split("#");
    const hash = hashParts.length > 1 ? hashParts[1] : "";
    const pathParts = hashParts[0].split("?");
    const query = pathParts.length > 1 ? pathParts[1] : "";
    return { path: pathParts[0], query: s04DecodeUrlQuery(query), hash: s04DecodeUrlQuery(hash) };
  };
  Query.addQuery = function (url, params) {
    return url + (url.includes("?") ? "&" : "?") + s04EncodeUrlQuery(params);
  };
  return Query;
}

// ---------------------------------------------------------------- data: URLs (was `oy`, `ay`)

// Own equivalent of the inherited data-URL matcher: scheme, optional MIME
// type with parameters, optional ";base64" marker, then the payload.
export const s04DataUrlPattern = /^data:([a-z]+\/[a-z0-9-+.]+(;[a-z0-9-.!#$%*+.{}|~`]+=[a-z0-9-.!#$%*+.{}()_|~`]+)*)?(;base64)?,([a-z0-9!$&',()*+;=\-._~:@\/?%\s<>]*?)$/i;

function s04Base64ToArrayBuffer(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function s04TextToArrayBuffer(text) {
  return ownBuffer(new TextEncoder().encode(text));
}

function s04BytesToBase64(bytes) {
  const chars = [];
  for (let i = 0; i < bytes.byteLength; i++) chars.push(String.fromCharCode(bytes[i]));
  return window.btoa(chars.join(""));
}

/** Parses a `data:` URL into {contentType, properties, isBase64, data, arrayBuffer}. */
export function s04ParseDataUrl(url) {
  const match = url.trim().match(s04DataUrlPattern);
  if (!match) return null;
  const typeParts = (match[1] || "text/plain;charset=us-ascii").split(";").map((p) => p.toLowerCase());
  const contentType = typeParts[0];
  const properties = {};
  const params = typeParts.slice(1);
  for (let i = 0; i < params.length; i++) {
    const kv = params[i].split("=");
    properties[kv[0]] = kv[1];
  }
  const isBase64 = !!match[match.length - 2];
  const data = match[match.length - 1] || "";
  return {
    contentType,
    properties,
    isBase64,
    data,
    get arrayBuffer() {
      return isBase64 ? s04Base64ToArrayBuffer(data) : s04TextToArrayBuffer(data);
    },
  };
}

// ---------------------------------------------------------------- response wrapper (was `ly`)

/** Error thrown for HTTP status >= 400 (unless `throw: false`). */
class S04RequestError extends Error {
  constructor(message, status, headers) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/** Factory used by the manifest `classes` entry for `sy`. */
export function s04RequestErrorClass() {
  return S04RequestError;
}

export function s04WrapResponse(opts, status, headers, body) {
  if ((opts.throw ?? true) && status >= 400) {
    throw new S04RequestError("Request failed, status " + status, status, headers);
  }
  return {
    status,
    headers,
    arrayBuffer: body,
    get json() {
      return JSON.parse(new TextDecoder().decode(body));
    },
    get text() {
      return new TextDecoder().decode(body);
    },
  };
}

// ---------------------------------------------------------------- request core (was `cy`)

export async function s04RequestCore(opts) {
  const { Em, xm, If, Nf } = env();
  if (typeof opts === "string") opts = { url: opts };
  if (Em) {
    let body = opts.body;
    let binary = false;
    if (body instanceof ArrayBuffer) {
      body = s04BytesToBase64(new Uint8Array(body));
      binary = true;
    }
    const res = await xm.requestUrl({
      url: opts.url,
      method: opts.method,
      contentType: opts.contentType,
      headers: opts.headers,
      body,
      binary,
    });
    return s04WrapResponse(opts, res.status, res.headers, s04Base64ToArrayBuffer(res.body));
  }
  if (If("electron")) {
    const res = await Nf(opts);
    return s04WrapResponse(opts, res.status, res.headers, res.body);
  }
  const reqHeaders = opts.contentType ? { "Content-Type": opts.contentType } : null;
  const res = await fetch(opts.url, { method: opts.method, headers: reqHeaders, body: opts.body });
  const buf = await res.arrayBuffer();
  const headerMap = {};
  res.headers.forEach((value, key) => {
    headerMap[key] = value;
  });
  return s04WrapResponse(opts, res.status, headerMap, buf);
}

// ---------------------------------------------------------------- promise wrapper (was `uy`, `hy`, `py`, `dy`)

// Adds async arrayBuffer/json/text getters to a promise of a wrapped response.
export function s04LazyResponse(promise) {
  const target = promise;
  Object.defineProperty(target, "arrayBuffer", {
    get() {
      return (async () => (await promise).arrayBuffer)();
    },
  });
  Object.defineProperty(target, "json", {
    get() {
      return (async () => (await promise).json)();
    },
  });
  Object.defineProperty(target, "text", {
    get() {
      return (async () => (await promise).text)();
    },
  });
  return target;
}

/** Raw request: promise of the wrapped response (was `hy`). */
export function s04RawRequest(opts) {
  return s04LazyResponse(s04RequestCore(opts));
}

/** Text-only request helper (was `py`). */
export async function s04RequestText(opts) {
  return (await s04RequestCore(opts)).text;
}

/** The public `request()`: lazy async getters, errors propagate (was `dy`). */
export function s04Request(opts) {
  const inner = (async () => {
    try {
      return await s04RequestCore(opts);
    } catch (err) {
      if (err instanceof S04RequestError && err.status === 404) throw err;
      throw err;
    }
  })();
  return s04LazyResponse(inner);
}

// ---------------------------------------------------------------- GitHub URL helpers (was `Jg`, `ey`, `ty`, `ny`, `iy`, `fy`)

const S04_GITHUB_WEB = "https://github.com/";
const S04_GITHUB_RAW = "https://raw.githubusercontent.com/";

/** Raw-content URL for a repo file (was `ty`). */
export function s04RawFileUrl(repo, file, ref) {
  return S04_GITHUB_RAW + repo + "/" + (ref || "HEAD") + "/" + file;
}

/** Repo web URL (was `ny`). */
export function s04RepoUrl(repo) {
  return S04_GITHUB_WEB + repo;
}

/** Release-asset download URL (was `iy`). */
export function s04ReleaseUrl(repo, tag, file) {
  return S04_GITHUB_WEB + repo + "/releases/download/" + tag + "/" + file;
}

/** Project page URL with platform query for the download button (was `fy`). */
export function s04ProjectUrl() {
  const { Yl, Sm } = env();
  const base = "https://github.com/FalconTechDev/basalt";
  if (Yl.isDesktopApp) {
    const platform = window.process.platform;
    const os = platform === "win32" ? "win" : platform === "darwin" ? "mac" : "linux";
    return s04EncodeUrlQueryPair(base, { os, arch: window.process.arch });
  }
  if (Yl.isMobileApp) {
    return s04EncodeUrlQueryPair(base, { os: Sm ? "android" : "ios" });
  }
  return base;
}

function s04EncodeUrlQueryPair(url, params) {
  return url + (url.includes("?") ? "&" : "?") + s04EncodeUrlQuery(params);
}

// ---------------------------------------------------------------- theme version picker (was `Zy`)

/**
 * Picks the newest theme version compatible with the running app.
 * `repo` is the theme's repo slug, `manifest` its parsed manifest.json.
 * Returns the manifest version, a versions.json pick, or null.
 */
export async function s04ThemeVersion(repo, manifest) {
  const { gte } = env();
  let version = manifest.version || null;
  const minAppVersion = manifest.minAppVersion;
  if (!gte || !minAppVersion || !isOlderVersion(gte, minAppVersion)) return version;
  try {
    version = null;
    const versions = await s04Request(s04RawFileUrl(repo, "versions.json")).json;
    if (versions) {
      for (const candidate in versions) {
        if (!Object.prototype.hasOwnProperty.call(versions, candidate)) continue;
        if (isOlderVersion(gte, versions[candidate]) || (version && !isOlderVersion(version, candidate))) continue;
        version = candidate;
      }
    }
    return version;
  } catch (err) {
    return null;
  }
}
