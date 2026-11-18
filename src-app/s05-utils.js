// s05 slice: small application helpers — position/range mapping, markdown
// inline-text extraction, frontmatter link scanning, filename validation,
// action tracking, animation-tree lookup, loaders, footnote ids, cssclasses,
// system info, vault listing (mobile) and the titlebar double-click handler.
import { env } from "./env.js";
import { baseName, isLocalLink, lastSegment } from "./path.js";
import { frontmatterStrings } from "./frontmatter.js";
import { anyRefMatch } from "./metadata-helpers.js";
import { chromeVersion } from "./text.js";

// mdast position {line, column, offset} -> editor-style {line, col, offset}
// with 1-based line/column converted to 0-based.
export function s05Point(position) {
  return { line: position.line - 1, col: position.column - 1, offset: position.offset };
}

export function s05Range(range) {
  return { start: s05Point(range.start), end: s05Point(range.end) };
}

export function s05HasPosition(node) {
  return node.hasOwnProperty("position");
}

export function s05HasKey(node) {
  return node.hasOwnProperty("key");
}

// Render an mdast subtree as plain text, preserving list/table structure.
export function s05InlineText(node) {
  if (!node) return "";
  const type = node.type;
  if (type === "html") return "";
  if (type === "iembed") return node.href;
  if (type === "listItem") {
    const parts = s05ChildrenText(node.children);
    return parts.length === 1 ? parts[0] + "\n" : parts.join("\n");
  }
  if (type === "tag") return node.tag;
  if (type === "comment") return "";
  let text = node.value || node.alt || node.title ||
    (node.hasOwnProperty("children") && s05ChildrenText(node.children).join("")) || "";
  if (type === "list" && node.start !== undefined && node.start !== null) {
    text = node.start + ". " + text;
  }
  if (type === "paragraph" || type === "break" || type === "heading" || type === "code") {
    text += "\n";
  } else if (text.endsWith("\n")) {
    text = text.substring(0, text.length - 1);
  }
  if (type === "tableCell") text += " ";
  if (type === "tableRow") text += "\n";
  return text;
}

export function s05ChildrenText(children) {
  const out = [];
  if (!children) return out;
  for (const child of children) out.push(s05InlineText(child));
  return out;
}

const MD_LINK = /^(!?\[)(.*?)(]\(\s*)((<[^>]*?>|[^ "]+?)(\s+([^ ]+|"[^"]+"|'[^']+'|\([^']+\)))?)(\s*\))$/;

// Collect every [[wikilink]] / [md](url) reference inside a frontmatter value,
// keyed by the dotted path to the value.
export function s05FrontmatterLinks(frontmatter) {
  const links = [];
  const visit = (prefix, key, value) => {
    const path = prefix ? prefix + "." + key : key;
    if (typeof value === "string") {
      if (value.startsWith("[[") && value.endsWith("]]")) {
        const parsed = env().iE(value.substring(2, value.length - 2));
        links.push({ key: path, link: parsed.href, original: value, displayText: parsed.title });
      }
      if (value.startsWith("[") && value.endsWith(")")) {
        const match = value.match(MD_LINK);
        if (match) {
          let url = match[5];
          if (url.startsWith("<") && url.endsWith(">")) {
            url = url.slice(1, -1).trim();
          }
          if (isLocalLink(url)) {
            let href = url;
            try { href = decodeURI(url); } catch (e) { /* keep raw */ }
            links.push({ key: path, link: href, original: value, displayText: match[2] });
          }
        }
      }
    } else {
      walk(path, value);
    }
  };
  const walk = (prefix, value) => {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) visit(prefix, String(i), value[i]);
    } else if (typeof value === "object") {
      for (const key in value) {
        if (value.hasOwnProperty(key)) visit(prefix, key, value[key]);
      }
    }
  };
  walk("", frontmatter);
  return links;
}

// True when the cached metadata for `node` references the given file(s).
export function s05HasRef(node, target) {
  return !!node && (anyRefMatch(node.links, target) === true || anyRefMatch(node.embeds, target) === true);
}

// Plain-text heading for outline/TOC use; `heading` is the cache heading
// object, falls back to its raw heading string.
export function s05HeadingText(heading) {
  const text = s05InlineText(env().Kx(heading.heading));
  return text || heading.heading;
}

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function s05AssertValidFileName(name) {
  if (env().Ul) {
    const last = name.charAt(name.length - 1);
    if (last === "." || last === " ") {
      throw new Error("File names cannot end with a dot or a space.");
    }
    const base = baseName(name);
    if (WINDOWS_RESERVED.test(base)) {
      throw new Error("File name is forbidden: " + base);
    }
  }
  if (name.split("/").some((segment) => env().UT.test(segment))) {
    throw new Error("File name cannot contain any of the following characters: " + env().qT);
  }
}

export function s05IsValidFileName(name) {
  try {
    s05AssertValidFileName(name);
    return true;
  } catch (e) {
    return false;
  }
}

// Probe whether the filesystem adapter supports permission checks; caches the
// result in the shared flag so the check runs at most once.
export async function s05CheckFilePermissions() {
  try {
    await env().Dm.checkPerms();
    env().kD = true;
  } catch (e) {
    env().kD = false;
  }
  return env().kD;
}

export function s05TrackAction(key) {
  env().aD.push({ key, ts: performance.now() });
}

// Look up a node in the shared animation-name tree by dotted path.
export function s05LookupAnimNode(path) {
  let node = env().lD;
  if (path) {
    for (const segment of path.split(".")) {
      if (!node.children.hasOwnProperty(segment)) return null;
      node = node.children[segment];
    }
  }
  return node;
}

export function s05AnimDuration(path) {
  const node = s05LookupAnimNode(path);
  return node?.duration ?? 0;
}

export function s05CreateLoaderCube(parent) {
  const el = env().createDiv("loader-cube");
  for (let i = 1; i <= 9; i++) {
    el.createDiv({ cls: "sk-cube sk-cube" + i });
  }
  if (parent) parent.appendChild(el);
  return el;
}

export function s05CreateLoaderSpinner(parent) {
  const el = env().createDiv("loader-spinner");
  env().tv(el, "loader-2");
  if (parent) parent.appendChild(el);
  return el;
}

// Show a spinner for the duration of `task()` and always remove it after.
export async function s05WithLoader(parent, task) {
  const spinner = s05CreateLoaderSpinner(parent);
  try {
    return await task();
  } finally {
    spinner.detach();
  }
}

const NON_WORD = /\W/;

// Index of the first non-word character at or after `from`, or -1.
export function s05FindBreakIndex(text, from) {
  const length = text.length;
  for (let i = from; i < length; i += 1) {
    if (NON_WORD.test(text[i])) return i;
  }
  return -1;
}

const FOOTNOTE_PREFIX = "[inline";

// Next free numeric footnote id (ids starting with "[inline" are ignored).
export function s05NextFootnoteId(node) {
  let max = 0;
  if (node?.footnotes) {
    for (const footnote of node.footnotes) {
      if (!footnote.id.startsWith(FOOTNOTE_PREFIX) && /^\d+$/.test(footnote.id)) {
        const value = parseInt(footnote.id, 10);
        if (value > max) max = value;
      }
    }
  }
  return max + 1;
}

// `cssclasses` frontmatter entry as a filtered list of single-token classes.
export function s05CssClasses(frontmatter) {
  if (!frontmatter) return null;
  const value = frontmatterStrings(frontmatter, /^cssclasses$/i);
  return value ? value.filter((cls) => !!cls && !cls.includes(" ")) : null;
}

// Human-readable system/vault diagnostic block for bug reports.
export async function s05SystemInfo() {
  let out = "SYSTEM INFO:\n";
  const platform = env().Yl;
  if (platform.isDesktopApp) {
    out += "\tBasalt version: " + platform.version + "\n";
    out += "\tInstaller version: " + platform.build + "\n";
    out += "\tOperating system: " + platform.osName + " " + platform.osVersion + "\n";
  }
  if (platform.isMobileApp) {
    out += "\tBasalt version: " + platform.version + " (" + platform.build + ")\n";
    out += "\tAPI version: " + env().gte + "\n";
    out += "\tOperating system: " + platform.osName + " " + platform.osVersion +
      " (" + platform.manufacturer + " " + platform.model + ")\n";
    if (platform.isAndroidApp) {
      out += "\tWebview version: " + chromeVersion(navigator.userAgent) + "\n";
    }
  }
  const login = env().Hw.token ? "logged in" : "not logged in";
  out += "\tLogin status: " + login + "\n";
  out += "\tLanguage: " + env().sm() + "\n";
  if (env().Hw.token) {
    out += "\tCatalyst license: " + (env().Hw.license || "none") + "\n";
  }
  if (platform.isDesktopApp) {
    let insider = "";
    env().Of((electron) => {
      insider = electron.ipcRenderer.sendSync("insider-build", null) ? "on" : "off";
      out += "\tInsider build toggle: " + insider + "\n";
    });
  }
  return out;
}

// List every vault visible to the mobile shell. On iOS this merges the iCloud
// root (when configured) with the documents adapter; on Android it merges
// permission-gated local roots; other platforms get an empty list.
export async function s05MobileVaultList() {
  const out = [];
  const collect = async (adapter, subdir, prefix, isICloud, exclude) => {
    let entries;
    try {
      entries = await adapter.readdir(subdir);
    } catch (e) {
      console.error(e);
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(".") || (exclude && exclude.contains(name))) continue;
      if (entry.type === "directory") {
        out.push({ name, location: prefix + name, storageType: isICloud ? "iCloud" : "local" });
      }
    }
  };
  if (env().Mm) {
    if (env().yD) await collect(env().yD, env().wD, "icloud/", true);
    await collect(env().vD, "", "documents/");
  } else if (env().Sm) {
    if (await s05CheckFilePermissions()) {
      const rootUri = env().vD.getUri("") + "/";
      const names = [];
      for (const dir of env().gD) {
        try {
          const uri = env().bD.getUri(dir);
          if (uri.startsWith(rootUri)) {
            const rel = uri.substr(rootUri.length);
            if (!rel.contains("/")) names.push(decodeURIComponent(rel));
          }
          if ((await env().bD.stat(dir)).type === "directory") {
            out.push({ location: dir, name: lastSegment(dir), storageType: "local" });
          }
        } catch (e) {
          console.error(e);
        }
      }
      await collect(env().vD, "", "", false, names);
    }
  }
  return out;
}

// macOS-only: double-clicking the titlebar area toggles minimise/maximise per
// the system preference, unless the click landed on an interactive control.
export function s05TitlebarDoubleClick(element) {
  const platform = env().Yl;
  if (!(platform.isMacOS && platform.isDesktopApp)) return;
  element.addEventListener("dblclick", (event) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!target.instanceOf(HTMLElement)) return;
    if (target.closest(".clickable-icon") ||
        target.closest(".workspace-tab-header-inner-close-button") ||
        (target.closest(".workspace-tab-header") && target.closest(".workspace-split.mod-sidedock"))) {
      return;
    }
    const win = element.win.electronWindow;
    if (!win.isMaximizable) return;
    env().Of((electron) => {
      const action = electron.remote.systemPreferences.getUserDefault("AppleActionOnDoubleClick", "string");
      if (action === "Minimize") {
        win.minimize();
      } else if (action === "Maximize" || action === "") {
        if (win.isMaximized()) win.unmaximize(); else win.maximize();
      }
    });
  });
}

// Wheel events over a horizontally scrollable element: translate vertical
// wheel delta into horizontal scrolling.
export function s05WheelScroll(event) {
  if (!event.deltaY) return;
  const target = event.currentTarget;
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    target.scrollLeft += event.deltaX;
  } else {
    target.scrollLeft += event.deltaY;
  }
  event.preventDefault();
}
