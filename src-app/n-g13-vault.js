// g13: clean-room vault model — TAbstractFile/TFile/TFolder, the Vault event
// emitter with config persistence, and the desktop FileSystemAdapter with
// watch/reconcile. Replaces the inherited vault implementation; FileManager
// itself lives in s20-filemanager.js.

import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { normalizePath, parentPath, lastSegment, baseName, joinNameExt, extensionOf, isHiddenPath, withoutExtension, linkPath } from "./path.js";
import { s05IsValidFileName } from "./s05-utils.js";

// Per-file cached text; invisible to plugins (WeakMap, not an own property).
const ng13TextCache = new WeakMap();

const NG13_MD_EXT = "md";
const NG13_CONTROL_CHARS = /[\u0000-\u001f]/g;
const NG13_TYPED_NAME = /.[A-Za-z][A-Za-z0-9]*$/;

function ng13NodeRequire(name) {
  try {
    return typeof window !== "undefined" && window.require ? window.require(name) : null;
  } catch (e) {
    return null;
  }
}

function ng13Sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ng13ToArrayBuffer(raw) {
  if (raw == null) return raw;
  if (raw instanceof ArrayBuffer) return raw;
  if (ArrayBuffer.isView(raw)) {
    return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  }
  if (typeof raw === "string") return new TextEncoder().encode(raw).buffer;
  return raw;
}

// ===========================================================================
// File classes (ES5-constructible, as inherited code calls them with .call)
// ===========================================================================

function ng13DefineFileClasses() {
  function TAbstractFile(vault, path) {
    this.vault = vault;
    this.path = path;
    this.parent = null;
    this.name = "";
    if (path) this.setName(path);
  }

  TAbstractFile.prototype.setName = function (path) {
    this.name = lastSegment(path);
  };

  TAbstractFile.prototype.setPath = function (path) {
    this.path = path;
    this.setName(path);
  };

  TAbstractFile.prototype.getParentPrefix = function () {
    const parent = this.parent;
    if (!parent || parent.path === "/") return "";
    return parent.path + "/";
  };

  TAbstractFile.prototype.getNewPathAfterRename = function (name) {
    let newName = String(name == null ? "" : name).replace(NG13_CONTROL_CHARS, " ").trim();
    const parent = this.parent;
    if (!parent) return "";
    if (parent.path === "/") return newName;
    return parent.path + "/" + newName;
  };

  function TFile(vault, path) {
    TAbstractFile.call(this, vault, path);
    this.stat = null;
    this.saving = false;
    this.basename = "";
    this.extension = "";
    if (path) this.setName(path);
  }
  inherit(TFile, TAbstractFile);

  TFile.prototype.setName = function (path) {
    TAbstractFile.prototype.setName.call(this, path);
    const dot = this.name.lastIndexOf(".");
    if (dot <= 0 || dot === this.name.length - 1) {
      this.basename = this.name;
      this.extension = "";
    } else {
      this.basename = this.name.slice(0, dot);
      this.extension = this.name.slice(dot + 1);
    }
  };

  TFile.prototype.getShortName = function () {
    return this.extension === NG13_MD_EXT ? this.basename : this.name;
  };

  TFile.prototype.getNewPathAfterRename = function (name) {
    let newName = String(name == null ? "" : name).replace(NG13_CONTROL_CHARS, " ").trim();
    // Quirk kept from the observable contract: a trailing "any char + ASCII
    // letter + alphanumerics" is treated as already typed and kept verbatim.
    if (!NG13_TYPED_NAME.test(newName)) {
      newName = joinNameExt(newName, this.extension);
    }
    const parent = this.parent;
    if (!parent) return "";
    if (parent.path === "/") return newName;
    return parent.path + "/" + newName;
  };

  // TFile.cache: store text only when it fits the vault cache limit.
  TFile.prototype.cache = function (text) {
    if (text != null && text.length <= this.vault.cacheLimit) {
      ng13TextCache.set(this, text);
    } else {
      ng13TextCache.delete(this);
    }
  };

  TFile.prototype.updateCacheLimit = function () {
    const cached = ng13TextCache.get(this);
    if (cached != null && cached.length > this.vault.cacheLimit) {
      ng13TextCache.delete(this);
    }
  };

  function TFolder(vault, path) {
    TAbstractFile.call(this, vault, path);
    this.children = [];
  }
  inherit(TFolder, TAbstractFile);

  TFolder.prototype.isRoot = function () {
    return this.path === "/";
  };

  TFolder.prototype.getFileCount = function () {
    let count = 0;
    const walk = (folder) => {
      for (const child of folder.children) {
        if (child instanceof ng13TFolder) walk(child);
        else count++;
      }
    };
    walk(this);
    return count;
  };

  TFolder.prototype.getFolderCount = function () {
    let count = 0;
    const walk = (folder) => {
      for (const child of folder.children) {
        if (child instanceof ng13TFolder) {
          count++;
          walk(child);
        }
      }
    };
    walk(this);
    return count + (this.isRoot() ? 0 : 1);
  };

  return { TAbstractFile, TFile, TFolder };
}

const ng13Classes = ng13DefineFileClasses();
const ng13TAbstractFile = ng13Classes.TAbstractFile;
const ng13TFile = ng13Classes.TFile;
const ng13TFolder = ng13Classes.TFolder;

/** Registry used by sibling own modules: fileClass("TFile") etc. */
export function fileClass(name) {
  switch (name) {
    case "TAbstractFile": return ng13TAbstractFile;
    case "TFile": return ng13TFile;
    case "TFolder": return ng13TFolder;
    default: return null;
  }
}

// ===========================================================================
// Vault
// ===========================================================================

const APPEARANCE_KEYS = new Set([
  "theme", "accentColor", "baseFontSize", "baseFontSizeAction",
  "interfaceFontFamily", "textFontFamily", "monospaceFontFamily",
  "showInlineTitle", "showViewHeader", "showRibbon", "showStatusBar",
  "floatingNavigation", "slidingSidebar", "autoFullScreen", "translucency",
  "nativeMenus", "cssTheme", "enabledCssSnippets", "spellcheckLanguages",
  "mobileQuickRibbonItem", "tabSize", "vimMode", "foldHeading", "foldIndent",
]);

export function createVault(EventsClass) {
  function Vault(adapter) {
    EventsClass.call(this);
    this.adapter = adapter;
    this.fileMap = {};
    this.config = {};
    this.configDir = ".basalt";
    this.configTs = 0;
    this.cacheLimit = 65536;
    this._insensitiveIndex = null;
    const root = new ng13TFolder(this, "/");
    root.parent = null;
    this.root = root;
    this.fileMap["/"] = root;
    this.requestSaveConfig = debounceCall(() => this.saveConfig(), 1000);
    this.reloadConfig = debounceCall(() => this.reloadConfigNow(), 500);
    if (adapter && typeof adapter.watch === "function") {
      adapter._hiddenAllow = (rel) => rel.indexOf(this.configDir + "/") === 0;
      adapter.watch((event, ...args) => this.onChange(event, ...args));
    }
    this.setupConfig();
  }
  inherit(Vault, EventsClass);
  const proto = Vault.prototype;

  // ---------- lookup ----------

  proto.getAbstractFileByPath = function (path) {
    if (path == null) return null;
    const normalized = normalizePath(path);
    const key = normalized === "/" ? "/" : normalized;
    return this.fileMap[key] || null;
  };

  proto.getFileByPath = function (path) {
    const item = this.getAbstractFileByPath(path);
    return item instanceof ng13TFile ? item : null;
  };

  proto.getFolderByPath = function (path) {
    const item = this.getAbstractFileByPath(path);
    return item instanceof ng13TFolder ? item : null;
  };

  proto._insensitiveLookup = function () {
    if (!this._insensitiveIndex) {
      const index = new Map();
      for (const path in this.fileMap) {
        if (!this.fileMap.hasOwnProperty(path)) continue;
        const folded = path.toLowerCase();
        if (!index.has(folded)) index.set(folded, path);
      }
      this._insensitiveIndex = index;
    }
    return this._insensitiveIndex;
  };

  proto.getAbstractFileByPathInsensitive = function (path) {
    const direct = this.getAbstractFileByPath(path);
    if (direct) return direct;
    const folded = normalizePath(path).toLowerCase();
    const hit = this._insensitiveLookup().get(folded);
    return hit ? this.fileMap[hit] : null;
  };

  proto.isEmpty = function () {
    for (const key in this.fileMap) {
      if (this.fileMap.hasOwnProperty(key) && key !== "/") return false;
    }
    return true;
  };

  proto.getAllLoadedFiles = function () {
    const out = [];
    for (const path in this.fileMap) {
      if (!this.fileMap.hasOwnProperty(path)) continue;
      const item = this.fileMap[path];
      if (item instanceof ng13TFile) out.push(item);
    }
    return out;
  };

  proto.getAllFolders = function (includeRoot) {
    const out = [];
    for (const path in this.fileMap) {
      if (!this.fileMap.hasOwnProperty(path)) continue;
      const item = this.fileMap[path];
      if (!(item instanceof ng13TFolder)) continue;
      if (!includeRoot && item.isRoot()) continue;
      out.push(item);
    }
    return out;
  };

  proto.getMarkdownFiles = function () {
    const out = [];
    Vault.recurseChildren(this.root, (item) => {
      if (item instanceof ng13TFile && item.extension === NG13_MD_EXT) out.push(item);
    });
    return out;
  };

  proto.getFiles = function () {
    const out = [];
    Vault.recurseChildren(this.root, (item) => {
      if (item instanceof ng13TFile) out.push(item);
    });
    return out;
  };

  proto.getName = function () {
    return this.adapter && typeof this.adapter.getName === "function" ? this.adapter.getName() : "";
  };

  // ---------- paths ----------

  proto.getAvailablePath = function (name, ext) {
    let candidate = joinNameExt(name, ext);
    let n = 1;
    while (this._pathTakenInsensitive(candidate)) {
      const dot = candidate.lastIndexOf(".");
      const base = dot > 0 ? candidate.slice(0, dot) : candidate;
      const suffix = dot > 0 ? candidate.slice(dot) : "";
      candidate = base + " " + n + suffix;
      n++;
    }
    return candidate;
  };

  proto._pathTakenInsensitive = function (path) {
    const folded = path.toLowerCase();
    for (const key in this.fileMap) {
      if (this.fileMap.hasOwnProperty(key) && key.toLowerCase() === folded) return true;
    }
    return false;
  };

  proto.checkForDuplicate = function (item, name) {
    const target = this.fileMap[item.getNewPathAfterRename(name)];
    return !!target && target !== item;
  };

  proto.checkPath = function (path) {
    const normalized = normalizePath(path);
    if (typeof env().KT === "function") {
      const checked = env().KT(normalized);
      return typeof checked === "string" ? checked : normalized;
    }
    if (env().UT && env().UT.test(lastSegment(normalized))) {
      throw new Error("File name cannot contain any of the following characters: " + (env().qT || ""));
    }
    return normalized;
  };

  // ---------- adapter <-> model sync ----------

  proto.onChange = function (event, path, arg3, arg4) {
    this._insensitiveIndex = null;
    // adapter emits: renamed -> (newPath, oldPath, stat); others -> (path, stat)
    const oldPath = event === "renamed" ? arg3 : undefined;
    const stat = event === "renamed" ? arg4 : arg3;
    if (event === "raw") {
      this.trigger("raw", path);
      if (typeof path === "string" && path.indexOf(this.configDir + "/") === 0) {
        const inner = path.substring(this.configDir.length + 1);
        if (inner === "app.json" || inner === "appearance.json") this.reloadConfig();
        if (this.adapter && typeof this.adapter.watchHiddenRecursive === "function") {
          this.adapter.watchHiddenRecursive(path);
        }
      }
      return;
    }
    if (event === "closed") {
      this.trigger("closed");
      return;
    }
    const normalized = this._normalizeModelPath(path);
    if (event === "renamed") {
      const from = this._normalizeModelPath(oldPath);
      this._applyRename(from, normalized);
      return;
    }
    if (!normalized) return;
    if (isHiddenPath(normalized)) {
      if (event === "file-created" || event === "folder-created") return;
      if (event === "modified") return;
      this._removePath(normalized);
      return;
    }
    switch (event) {
      case "file-created":
        this._addFile(normalized, stat);
        break;
      case "folder-created":
        this._addFolder(normalized);
        break;
      case "modified":
        this._applyModified(normalized, stat);
        break;
      case "file-removed":
      case "folder-removed":
        this._removePath(normalized);
        break;
      default:
        break;
    }
  };

  proto._normalizeModelPath = function (path) {
    if (path == null || path === "") return "/";
    const normalized = normalizePath(path);
    return normalized === "/" ? "/" : normalized;
  };

  proto._parentFor = function (path) {
    if (path === "/") return null;
    const parentPathStr = parentPath(path);
    const key = parentPathStr === "" ? "/" : parentPathStr;
    let parent = this.fileMap[key];
    if (!parent) {
      // adapter scans parents first, but be tolerant: materialise missing folders
      parent = new ng13TFolder(this, key === "" ? "/" : key);
      parent.parent = this._parentFor(key === "" ? "/" : key);
      if (parent.parent) parent.parent.children.push(parent);
      this.fileMap[key === "" ? "/" : key] = parent;
      this.trigger("create", parent);
    }
    return parent;
  };

  proto._addFile = function (path, stat) {
    if (this.fileMap[path]) return;
    const file = new ng13TFile(this, path);
    file.stat = stat || { ctime: 0, mtime: 0, size: 0 };
    const parent = this._parentFor(path);
    if (parent) {
      file.parent = parent;
      parent.children.push(file);
    }
    this.fileMap[path] = file;
    this.trigger("create", file);
  };

  proto._addFolder = function (path) {
    if (this.fileMap[path]) return;
    const folder = new ng13TFolder(this, path);
    const parent = this._parentFor(path);
    if (parent) {
      folder.parent = parent;
      parent.children.push(folder);
    }
    this.fileMap[path] = folder;
    this.trigger("create", folder);
  };

  proto._applyModified = function (path, stat) {
    const item = this.fileMap[path];
    if (!(item instanceof ng13TFile)) return;
    item.stat = stat || item.stat || { ctime: 0, mtime: 0, size: 0 };
    if (!item.saving) ng13TextCache.delete(item);
    this.trigger("modify", item);
  };

  proto._unlink = function (item) {
    const parent = item.parent;
    if (parent && parent.children) {
      const index = parent.children.indexOf(item);
      if (index >= 0) parent.children.splice(index, 1);
    }
    item.parent = null;
  };

  proto._removePath = function (path) {
    // collect the item and every descendant still in the model
    const doomed = [];
    for (const key in this.fileMap) {
      if (!this.fileMap.hasOwnProperty(key)) continue;
      if (key === path || (path !== "/" && key.indexOf(path + "/") === 0)) doomed.push(key);
    }
    doomed.sort((a, b) => b.length - a.length); // deepest first
    for (const key of doomed) {
      const item = this.fileMap[key];
      if (!item) continue;
      this._unlink(item);
      delete this.fileMap[key];
      this.trigger("delete", item);
    }
  };

  proto._applyRename = function (from, to) {
    if (from === to) return;
    const item = this.fileMap[from];
    if (!item) return;
    if (isHiddenPath(to)) {
      this._removePath(from);
      return;
    }
    // descendants move with the item
    const moved = [];
    for (const key in this.fileMap) {
      if (this.fileMap.hasOwnProperty(key) && key.indexOf(from + "/") === 0) moved.push(key);
    }
    const oldPath = item.path;
    delete this.fileMap[from];
    item.setPath(to);
    this.fileMap[to] = item;
    // re-parent when the parent path changed
    const newParentPath = to === "/" ? null : (parentPath(to) === "" ? "/" : parentPath(to));
    if (item.parent && item.parent.path !== newParentPath) {
      this._unlink(item);
      const parent = this._parentFor(to);
      if (parent) {
        item.parent = parent;
        parent.children.push(item);
      }
    }
    for (const key of moved) {
      const child = this.fileMap[key];
      const childNew = to + key.substring(from.length);
      delete this.fileMap[key];
      child.setPath(childNew);
      this.fileMap[childNew] = child;
    }
    this.trigger("rename", item, oldPath);
  }

  // ---------- exists / create / delete / trash / rename ----------

  proto.exists = async function (path, caseSensitive) {
    try {
      return await this.adapter.exists(normalizePath(path), caseSensitive);
    } catch (e) {
      return false;
    }
  };

  proto._waitForModel = async function (path, kind) {
    for (let i = 0; i < 40; i++) {
      const item = this.fileMap[path];
      if (item && (kind === "folder" ? item instanceof ng13TFolder : item instanceof ng13TFile)) return item;
      await ng13Sleep(10);
    }
    return this.fileMap[path] || null;
  };

  proto.create = async function (path, data) {
    const normalized = this.checkPath(path);
    if (await this.adapter.exists(normalized)) throw new Error("File already exists.");
    await this.adapter.write(normalized, data == null ? "" : data);
    const item = await this._waitForModel(normalized, "file");
    if (!item) this._addFile(normalized, null);
    return this.fileMap[normalized] || null;
  };

  proto.createBinary = async function (path, data) {
    const normalized = this.checkPath(path);
    if (await this.adapter.exists(normalized)) throw new Error("File already exists.");
    await this.adapter.writeBinary(normalized, data);
    return this._waitForModel(normalized, "file");
  };

  proto.createFolder = async function (path) {
    const normalized = this.checkPath(path);
    if (await this.adapter.exists(normalized)) throw new Error("Folder already exists.");
    await this.adapter.mkdir(normalized);
    const item = await this._waitForModel(normalized, "folder");
    if (!item) this._addFolder(normalized);
    return this.fileMap[normalized] || null;
  };

  proto.delete = async function (item, force) {
    if (!item || item.isRoot && item.isRoot()) return;
    if (item instanceof ng13TFile) {
      await this.adapter.remove(item.path);
    } else if (item instanceof ng13TFolder) {
      await this.adapter.rmdir(item.path, !!force);
    }
  };

  proto.trash = async function (item, system) {
    if (!item || (item.isRoot && item.isRoot())) return;
    if (system) {
      const done = await this.adapter.trashSystem(item.path);
      if (done) return;
    }
    await this.adapter.trashLocal(item.path);
  };

  proto.rename = async function (item, newPath) {
    if (!item) return;
    const normalized = this.checkPath(newPath);
    if (normalized === item.path) return;
    // The watcher may deliver the rename event before a duplicate caller
    // reaches us; if the source is already gone and the target exists, the
    // rename has effectively already happened.
    const srcExists = await this.adapter.exists(item.path).catch(() => false);
    if (!srcExists) {
      const dstExists = await this.adapter.exists(normalized).catch(() => false);
      if (dstExists) return;
    }
    await this.adapter.rename(item.path, normalized);
  };

  proto.copy = async function (item, newPath) {
    if (!item) return null;
    const normalized = this.normalizePathCopy(newPath);
    await this.adapter.copy(item.path, normalized);
    return this._waitForModel(normalized, item instanceof ng13TFolder ? "folder" : "file");
  };

  proto.normalizePathCopy = function (path) {
    return normalizePath(path).normalize("NFC");
  };

  // ---------- reading / writing ----------

  proto.read = async function (file) {
    let text = await this.adapter.read(file.path);
    if (text.charCodeAt(0) === 0xfeff) text = text.substring(1);
    ng13TextCache.set(file, text);
    return text;
  };

  proto.cachedRead = async function (file) {
    return ng13TextCache.has(file) ? ng13TextCache.get(file) : null;
  };

  proto.readBinary = async function (file) {
    const raw = await this.adapter.readBinary(file.path);
    const buffer = ng13ToArrayBuffer(raw);
    if (file.extension === NG13_MD_EXT && buffer && buffer.byteLength <= this.cacheLimit) {
      const text = new TextDecoder().decode(buffer);
      if (text.charCodeAt(0) === 0xfeff) {
        ng13TextCache.set(file, text.substring(1));
      } else {
        ng13TextCache.set(file, text);
      }
    }
    return buffer;
  };

  proto.readRaw = async function (path) {
    return this.adapter.read(normalizePath(path));
  };

  proto.getResourcePath = function (file) {
    return this.adapter.getResourcePath(file.path);
  };

  proto.modify = async function (file, data, options) {
    file.saving = true;
    try {
      await this.adapter.write(file.path, data);
      if (data != null && data.length <= this.cacheLimit) {
        ng13TextCache.set(file, data);
      }
      if (options && typeof options.immediate === "function") options.immediate();
    } catch (e) {
      ng13TextCache.delete(file);
      throw e;
    } finally {
      file.saving = false;
    }
  };

  proto.modifyBinary = async function (file, data) {
    file.saving = true;
    try {
      await this.adapter.writeBinary(file.path, data);
      ng13TextCache.delete(file);
    } finally {
      file.saving = false;
    }
  };

  proto.append = async function (file, data, options) {
    file.saving = true;
    try {
      await this.adapter.append(file.path, data);
      ng13TextCache.delete(file);
      if (options && typeof options.immediate === "function") options.immediate();
    } finally {
      file.saving = false;
    }
  };

  proto.appendBinary = async function (file, data) {
    file.saving = true;
    try {
      await this.adapter.appendBinary(file.path, data);
      ng13TextCache.delete(file);
    } finally {
      file.saving = false;
    }
  };

  proto.process = async function (file, fn, options) {
    file.saving = true;
    try {
      const result = await this.adapter.process(file.path, fn);
      if (typeof result === "string" && result.length <= this.cacheLimit) {
        ng13TextCache.set(file, result);
      }
      if (options && options.immediate !== undefined) {
        // restore immediate semantics: cache stays as set above
      }
      return result;
    } finally {
      file.saving = false;
    }
  };

  proto.updateConfigDir = function () {};

  // ---------- file iteration ----------

  proto.iterateFiles = async function* (files, useCache) {
    for await (const file of files) {
      let content = "";
      if (file.extension === NG13_MD_EXT) {
        content = useCache ? await this.cachedRead(file) : null;
        if (content == null) content = await this.read(file);
      }
      yield { file, content };
    }
  };

  proto.generateFiles = async function* (files, useCache) {
    for await (const file of files) {
      let content = "";
      if (file.extension === NG13_MD_EXT || file.extension === "canvas") {
        content = useCache ? await this.cachedRead(file) : null;
        if (content == null) content = await this.read(file);
      }
      yield { file, content };
    }
  };

  // ---------- attachments ----------

  proto.getAvailablePathForAttachments = async function (name, ext, note) {
    const safe = normalizePath(name).substring(0, 250);
    const folderPath = this.getConfig("attachmentFolderPath");
    let folderPrefix = "";
    if (folderPath === "." || folderPath === "./") {
      folderPrefix = note && note.parent ? note.parent.getParentPrefix() : "";
    } else if (folderPath && folderPath.startsWith("./")) {
      const parentPrefix = note && note.parent ? (note.parent.path === "/" ? "" : note.parent.path + "/") : "";
      folderPrefix = parentPrefix + folderPath.substring(2) + "/";
    } else if (folderPath) {
      folderPrefix = folderPath + "/";
    }
    let folder = folderPrefix ? this.getFolderByPathInsensitiveSafe(folderPrefix.replace(/\/$/, "")) : null;
    if (!folder && folderPrefix) {
      try {
        folder = await this.createFolder(folderPrefix.replace(/\/$/, ""));
      } catch (e) {
        folder = null;
      }
    }
    if (folder instanceof ng13TFolder) {
      return this.getAvailablePath(folderPrefix + safe, ext);
    }
    return this.getAvailablePath(safe, ext);
  };

  proto.getFolderByPathInsensitiveSafe = function (path) {
    const direct = this.getFolderByPath(path);
    if (direct) return direct;
    const folded = path.toLowerCase();
    for (const key in this.fileMap) {
      if (this.fileMap.hasOwnProperty(key) && this.fileMap[key] instanceof ng13TFolder && key.toLowerCase() === folded) {
        return this.fileMap[key];
      }
    }
    return null;
  };

  // ---------- config ----------

  proto.setConfigDir = function (dir) {
    const candidate = String(dir == null ? "" : dir);
    this.configDir = Vault.validateConfigDir(candidate) ? candidate : ".basalt";
  };

  proto.getConfig = function (key) {
    let value = this.config[key];
    if (value === undefined) value = env().PC ? env().PC[key] : undefined;
    if (value !== null && typeof value === "object") {
      try { value = JSON.parse(JSON.stringify(value)); } catch (e) { /* keep */ }
    }
    return value;
  };

  proto.setConfig = function (key, value) {
    const current = this.config[key];
    if (value === undefined) {
      if (!(key in this.config)) return;
      delete this.config[key];
    } else {
      if (JSON.stringify(current) === JSON.stringify(value)) return;
      this.config[key] = value;
    }
    this.requestSaveConfig();
    this.trigger("config-changed", key);
  };

  proto.getConfigFile = function (name) {
    return this.configDir + "/" + name + ".json";
  };

  proto.readJson = async function (path) {
    try {
      const text = await this.adapter.read(path);
      return JSON.parse(text);
    } catch (e) {
      return e && e.code === "ENOENT" ? null : undefined;
    }
  };

  proto.writeJson = async function (path, data) {
    try {
      await this.adapter.write(path, JSON.stringify(data, undefined, 2));
    } catch (e) { /* silent */ }
  };

  proto.deleteConfigJson = async function (name) {
    try {
      await this.adapter.remove(this.getConfigFile(name));
    } catch (e) { /* silent */ }
  };

  proto.readConfigJson = function (name) {
    return this.readJson(this.getConfigFile(name));
  };

  proto.writeConfigJson = function (name, data) {
    return this.writeJson(this.getConfigFile(name), data);
  };

  proto.readPluginData = function (pluginId) {
    return this.readJson(this.configDir + "/plugins/" + pluginId + "/data.json");
  };

  proto.writePluginData = function (pluginId, data) {
    return this.writeJson(this.configDir + "/plugins/" + pluginId + "/data.json", data);
  };

  proto.saveConfig = async function () {
    const appConfig = {};
    const appearanceConfig = {};
    for (const key in this.config) {
      if (!this.config.hasOwnProperty(key)) continue;
      if (APPEARANCE_KEYS.has(key)) appearanceConfig[key] = this.config[key];
      else appConfig[key] = this.config[key];
    }
    await this.writeJson(this.getConfigFile("app"), appConfig);
    await this.writeJson(this.getConfigFile("appearance"), appearanceConfig);
    this.configTs = Date.now();
  };

  proto.setupConfig = async function () {
    const appearance = (await this.readConfigJson("appearance")) || {};
    const app = (await this.readConfigJson("app")) || {};
    const merged = Object.assign({}, appearance, app);
    if (merged.editorFontFamily && !merged.textFontFamily) {
      merged.textFontFamily = merged.editorFontFamily;
      delete merged.editorFontFamily;
    }
    this.config = merged;
    await this.copyObsidianSettings();
    this.requestSaveConfig();
  };

  proto.copyObsidianSettings = async function () {
    try {
      if (await this.adapter.exists(".obsidian")) {
        const targetExists = await this.adapter.exists(this.configDir);
        if (!targetExists) {
          await this.adapter.copy(".obsidian", this.configDir);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  proto.reloadConfigNow = async function () {
    const appStat = await this.adapter.stat(this.getConfigFile("app")).catch(() => null);
    const attStat = await this.adapter.stat(this.getConfigFile("appearance")).catch(() => null);
    const newest = Math.max(appStat ? appStat.mtime : 0, attStat ? attStat.mtime : 0);
    if (!(newest > this.configTs)) return;
    this.configTs = newest;
    const appearance = (await this.readConfigJson("appearance")) || {};
    const app = (await this.readConfigJson("app")) || {};
    const merged = Object.assign({}, appearance, app);
    const old = this.config;
    this.config = {};
    for (const key in merged) {
      if (merged.hasOwnProperty(key)) this.config[key] = merged[key];
    }
    const keys = new Set([...Object.keys(old), ...Object.keys(this.config)]);
    for (const key of keys) {
      if (JSON.stringify(old[key]) !== JSON.stringify(this.config[key])) {
        this.trigger("config-changed", key);
      }
    }
  };

  // ---------- recursion ----------

  Vault.recurseChildren = function (start, visit) {
    if (!start) return;
    const stack = [start];
    while (stack.length) {
      const item = stack.pop();
      visit(item);
      if (item instanceof ng13TFolder && item.children) {
        for (let i = item.children.length - 1; i >= 0; i--) stack.push(item.children[i]);
      }
    }
  };

  proto.recurseChildren = function (start, visit) {
    Vault.recurseChildren(start, visit);
  };

  proto.getRoot = function () {
    return this.root;
  };

  proto.load = async function () {
    await this.setupConfig();
    if (this.adapter && typeof this.adapter.listAll === "function") {
      await this.adapter.listAll();
    }
  };

  // ---------- misc ----------

  proto.resolveFileUrl = function (url) {
    if (!env().Yl || !env().Yl.isDesktopApp || !url) return null;
    const prefix = env().Yl.resourcePathPrefix || "file:///";
    if (!url.startsWith(prefix)) return null;
    const rest = url.substring(prefix.length);
    const urlMod = ng13NodeRequire("url");
    if (!urlMod) return null;
    try {
      const full = urlMod.fileURLToPath(prefix + rest);
      return this.resolveFilePath(full);
    } catch (e) {
      return null;
    }
  };

  proto.resolveFilePath = function (fullPath) {
    if (!env().Yl || !env().Yl.isDesktopApp) return null;
    const adapter = this.adapter;
    if (!adapter || typeof adapter.getBasePath !== "function") return null;
    const base = adapter.getBasePath();
    if (!fullPath || !fullPath.startsWith(base)) return null;
    const rel = fullPath.substring(base.length).replace(/\\/g, "/").replace(/^\/+/, "");
    return this.getFileByPath(rel === "" ? "/" : rel);
  };

  Vault.validateConfigDir = function (dir) {
    return dir !== "." && String(dir).startsWith(".") && !(env().UT && env().UT.test(dir));
  };

  return Vault;
}

// ===========================================================================
// FileSystemAdapter (desktop)
// ===========================================================================

export function createFileSystemAdapter() {
  function FileSystemAdapter(basePath) {
    this.basePath = basePath;
    this.files = {};
    this.handlers = [];
    this.watchers = new Map();
    this._pendingRel = new Set();
    this._flushScheduled = false;
    this._hiddenAllow = null;
    this.promise = Promise.resolve();
    this.fs = ng13NodeRequire("fs");
    this.path = ng13NodeRequire("path");
    this.url = ng13NodeRequire("url");
    const electron = ng13NodeRequire("electron");
    this.ipcRenderer = electron && electron.ipcRenderer ? electron.ipcRenderer : null;
    try {
      this.btime = ng13NodeRequire("btime");
    } catch (e) {
      this.btime = null;
    }
    this.insensitive = this._probeInsensitive();
    this.recursiveWatch = this._supportsRecursiveWatch();
  }

  const proto = FileSystemAdapter.prototype;

  proto._probeInsensitive = function () {
    if (env().Yl && (env().Yl.isMacOS || env().Yl.isWin)) return true;
    if (!this.fs) return false;
    try {
      const probe = this.path.join(this.basePath, ".BASALTTEST");
      const lower = this.path.join(this.basePath, ".basalttest");
      this.fs.writeFileSync(probe, "");
      const insensitive = this.fs.existsSync(lower);
      try { this.fs.unlinkSync(probe); } catch (e) {}
      try { this.fs.unlinkSync(lower); } catch (e) {}
      return insensitive;
    } catch (e) {
      return false;
    }
  };

  proto._supportsRecursiveWatch = function () {
    if (!this.fs || !this.fs.watch) return false;
    return env().Yl && (env().Yl.isMacOS || env().Yl.isWin);
  };

  // ---------- queue ----------

  proto.queue = function (task) {
    const run = this.promise.then(() => this._withTimeout(task));
    this.promise = run.catch(() => {});
    return run;
  };

  proto._withTimeout = function (task) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("File system operation timed out.")), 60000);
      Promise.resolve()
        .then(task)
        .then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
    });
  };

  // ---------- path mapping ----------

  proto.getName = function () {
    return lastSegment(this.basePath);
  };

  proto.getBasePath = function () {
    return this.basePath;
  };

  proto.getRealPath = function (path) {
    // translate through the files table so symlinked realpaths resolve
    const normalized = normalizePath(path);
    if (this.files[normalized] && this.files[normalized].realpath) {
      return this.files[normalized].realpath;
    }
    let dir = parentPath(normalized);
    while (dir) {
      if (this.files[dir] && this.files[dir].realpath && this.files[dir].realpath !== dir) {
        return this.files[dir].realpath + "/" + normalized.substring(dir.length + 1);
      }
      dir = parentPath(dir);
    }
    return normalized;
  };

  proto.getFullPath = function (path) {
    const real = this.getRealPath(path);
    return real === "" || real === "/" ? this.basePath : this.path.join(this.basePath, real);
  };

  proto.getResourcePath = function (path) {
    const full = this.getFullPath(path);
    let href = this.url ? this.url.pathToFileURL(full).href : "file:///" + full;
    const prefix = (env().Yl && env().Yl.resourcePathPrefix) || "file:///";
    if (href.indexOf("file:///") === 0) href = href.substring(8);
    else if (href.indexOf("file://") === 0) href = "%5C%5C" + href.substring(7);
    const entry = this.files[normalizePath(path)];
    const stamp = entry && entry.mtime ? entry.mtime : Date.now();
    return prefix + href + "?" + stamp;
  };

  proto.getFilePath = function (path) {
    const full = this.getFullPath(path);
    return this.url ? this.url.pathToFileURL(full).toString() : "file:///" + full;
  };

  // ---------- low-level fs ----------

  proto._normalize = function (path) {
    const normalized = normalizePath(path);
    return normalized === "/" ? "" : normalized;
  };

  proto.exists = async function (path, caseSensitive) {
    return this.queue(async () => {
      const normalized = this._normalize(path);
      const full = normalized === "" ? this.basePath : this.path.join(this.basePath, normalized);
      try {
        await this.fs.promises.access(full);
        return true;
      } catch (e) {
        if (caseSensitive === false && this.insensitive) {
          const folded = normalized.toLowerCase();
          for (const key in this.files) {
            if (this.files.hasOwnProperty(key) && key.toLowerCase() === folded) return true;
          }
        }
        return false;
      }
    });
  };

  proto.read = async function (path) {
    return this.queue(() => this._readFull(path));
  };

  // Unqueued read used inside queue tasks (process) — never call read() there.
  proto._readFull = async function (path) {
    try {
      return await this.fs.promises.readFile(this.getFullPath(path), "utf8");
    } catch (e) {
      this.queue(() => this._reconcile(this._normalize(path))).catch(() => {});
      throw e;
    }
  };

  proto.readBinary = async function (path) {
    return this.queue(async () => {
      try {
        const buffer = await this.fs.promises.readFile(this.getFullPath(path));
        return ng13ToArrayBuffer(buffer);
      } catch (e) {
        this.queue(() => this._reconcile(this._normalize(path))).catch(() => {});
        throw e;
      }
    });
  };

  proto._applyWriteOptions = async function (fullPath, options) {
    if (!options) return;
    try {
      if (options.ctime && this.btime) {
        await this.btime.write(fullPath, options.ctime);
      }
      const times = [];
      if (options.mtime) times.push(new Date(options.mtime * 1000));
      if (times.length === 2 || times.length === 1) {
        const atime = times[0];
        const mtime = times[1] || times[0];
        await this.fs.promises.utimes(fullPath, atime, mtime);
      }
    } catch (e) { /* best effort */ }
    if (typeof options.immediate === "function") {
      try { options.immediate(); } catch (e) {}
    }
  };

  proto._reconcileAfter = async function (path) {
    try {
      await this._reconcile(this._normalize(path));
    } catch (e) { /* reconcile is best effort */ }
  };

  proto.changeFile = async function (path, change, options) {
    const normalized = this._normalize(path);
    const full = normalized === "" ? this.basePath : this.path.join(this.basePath, normalized);
    await change(full);
    await this._applyWriteOptions(full, options);
    await this._reconcileAfter(normalized);
  };

  proto.write = async function (path, data, options) {
    return this.queue(() => this.changeFile(path, async (full) => {
      await this.fs.promises.writeFile(full, data);
    }, options));
  };

  proto.writeBinary = async function (path, data, options) {
    return this.queue(() => this.changeFile(path, async (full) => {
      await this.fs.promises.writeFile(full, data);
    }, options));
  };

  proto.append = async function (path, data, options) {
    return this.queue(() => this.changeFile(path, async (full) => {
      await this.fs.promises.appendFile(full, data);
    }, options));
  };

  proto.appendBinary = async function (path, data, options) {
    return this.queue(() => this.changeFile(path, async (full) => {
      await this.fs.promises.appendFile(full, data);
    }, options));
  };

  proto.process = async function (path, transform, options) {
    return this.queue(async () => {
      const normalized = this._normalize(path);
      const current = await this._readFull(normalized);
      const result = await transform(current);
      if (result === current) return current;
      await this.changeFile(normalized, async (full) => {
        await this.fs.promises.writeFile(full, result);
      }, options);
      return result;
    });
  };

  // ---------- structure ----------

  proto.mkdir = async function (path) {
    return this.queue(async () => {
      const normalized = this._normalize(path);
      if (normalized === "") return;
      const full = this.path.join(this.basePath, normalized);
      await this.fs.promises.mkdir(full, { recursive: true });
      await this._reconcileAfter(normalized);
    });
  };

  proto.remove = async function (path) {
    return this.queue(async () => {
      const normalized = this._normalize(path);
      const full = normalized === "" ? this.basePath : this.path.join(this.basePath, normalized);
      await this.fs.promises.unlink(full);
      await this._reconcileAfter(normalized);
    });
  };

  proto.rmdir = async function (path, recursive) {
    return this.queue(async () => {
      const normalized = this._normalize(path);
      const full = normalized === "" ? this.basePath : this.path.join(this.basePath, normalized);
      if (recursive) {
        await this.fs.promises.rm(full, { recursive: true, force: false, maxRetries: 5 });
      } else {
        await this.fs.promises.rmdir(full);
      }
      await this._reconcileAfter(normalized);
    });
  };

  proto.trashSystem = async function (path) {
    return this.queue(async () => {
      if (!this.ipcRenderer) return false;
      try {
        const full = this.getFullPath(path);
        const ok = this.ipcRenderer.sendSync("trash", full);
        if (ok) await this._reconcileAfter(this._normalize(path));
        return !!ok;
      } catch (e) {
        return false;
      }
    });
  };

  proto.trashLocal = async function (path) {
    return this.queue(async () => {
      const normalized = this._normalize(path);
      const trashDir = this.path.join(this.basePath, ".trash");
      await this.fs.promises.mkdir(trashDir, { recursive: true });
      const name = lastSegment(normalized);
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let target = this.path.join(trashDir, name);
      let n = 1;
      while (this.fs.existsSync(target)) {
        n++;
        target = this.path.join(trashDir, stem + " " + n + ext);
      }
      const from = normalized === "" ? this.basePath : this.path.join(this.basePath, normalized);
      await this.fs.promises.rename(from, target);
      await this._reconcile(".trash");
      await this._reconcileAfter(normalized);
    });
  };

  proto.rename = async function (from, to) {
    return this.queue(async () => {
      const src = this._normalize(from);
      const dst = this._normalize(to);
      if (src === dst) return;
      const dstExists = await this._pathExistsOnDisk(dst);
      const pureCaseChange = src.toLowerCase() === dst.toLowerCase() && this.insensitive;
      if (dstExists && !pureCaseChange) {
        throw new Error("Destination file already exists!");
      }
      const srcFull = src === "" ? this.basePath : this.path.join(this.basePath, src);
      const dstFull = dst === "" ? this.basePath : this.path.join(this.basePath, dst);
      await this.fs.promises.rename(srcFull, dstFull);
      // update the files table: remap the entry and every descendant
      const moved = [];
      for (const key in this.files) {
        if (this.files.hasOwnProperty(key) && (key === src || key.indexOf(src + "/") === 0)) moved.push(key);
      }
      const stat = await this._statPath(dst).catch(() => null);
      // emit the top-level rename first so consumers move the whole subtree
      // before per-descendant events arrive (those then no-op)
      moved.sort((a, b) => (a === src ? -1 : b === src ? 1 : 0));
      for (const key of moved) {
        const entry = this.files[key];
        delete this.files[key];
        const nk = dst + key.substring(src.length);
        entry.realpath = nk;
        this.files[nk] = entry;
        if (key === src) this._emit("renamed", nk, key, stat);
      }
      for (const key of moved) {
        if (key === src) continue;
        const nk = dst + key.substring(src.length);
        this._emit("renamed", nk, key, stat);
      }
      if (this.files[dst] && this.files[dst].type === "folder" && !this.recursiveWatch) {
        this.watchHiddenRecursive(dst);
      }
      await this._reconcileAfter(dst);
    });
  };

  proto.copy = async function (from, to) {
    return this.queue(() => this._copyRec(this._normalize(from), this._normalize(to)));
  };

  proto._copyRec = async function (src, dst) {
    const srcFull = this.path.join(this.basePath, src);
    const dstFull = dst === "" ? this.basePath : this.path.join(this.basePath, dst);
    const stat = await this.fs.promises.stat(srcFull);
    if (stat.isDirectory()) {
      await this.fs.promises.mkdir(dstFull, { recursive: true });
      for (const child of await this.fs.promises.readdir(srcFull)) {
        await this._copyRec(src + "/" + child, dst + "/" + child);
      }
    } else {
      await this.fs.promises.copyFile(srcFull, dstFull, this.fs.constants ? this.fs.constants.COPYFILE_EXCL : 0);
    }
    await this._reconcile(dst);
  };

  proto.copyRecursive = function (from, to) {
    return this.copy(from, to);
  };

  proto.update = async function (path) {
    return this.queue(() => this._reconcile(this._normalize(path)));
  };

  // ---------- queries ----------

  proto._pathExistsOnDisk = async function (path) {
    const full = path === "" ? this.basePath : this.path.join(this.basePath, path);
    try {
      await this.fs.promises.access(full);
      return true;
    } catch (e) {
      return false;
    }
  };

  proto.stat = async function (path) {
    return this.queue(async () => {
      const normalized = this._normalize(path);
      const entry = this.files[normalized];
      const full = normalized === "" ? this.basePath : this.path.join(this.basePath, normalized);
      try {
        const st = await this.fs.promises.stat(full);
        return {
          type: st.isDirectory() ? "folder" : "file",
          ctime: Math.round(st.birthtimeMs != null ? st.birthtimeMs : st.ctimeMs),
          mtime: Math.round(st.mtimeMs),
          size: st.size,
        };
      } catch (e) {
        if (e && e.code === "ENOENT") return null;
        throw e;
      }
    });
  };

  proto.list = async function (path) {
    return this.queue(async () => {
      const normalized = this._normalize(path);
      const full = normalized === "" ? this.basePath : this.path.join(this.basePath, normalized);
      const folders = [];
      const files = [];
      let entries;
      try {
        entries = await this.fs.promises.readdir(full, { withFileTypes: true });
      } catch (e) {
        if (e && e.code === "ENOENT") return { folders, files };
        throw e;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const child = normalized === "" ? entry.name : normalized + "/" + entry.name;
        if (entry.isDirectory()) folders.push(child);
        else files.push(child);
      }
      folders.sort();
      files.sort();
      return { folders, files };
    });
  };

  // ---------- watching ----------

  proto._emit = function (event, ...args) {
    for (const handler of this.handlers.slice()) {
      try {
        handler(event, ...args);
      } catch (e) {
        setTimeout(() => { throw e; }, 0);
      }
    }
  };

  proto.watch = function (handler) {
    if (this.handlers.length) this.stopWatch();
    this.handlers.push(handler);
    this.startWatchPath("");
    this.queue(() => this.listAll()).catch(() => {});
  };

  proto.startWatchPath = function (path) {
    if (!this.fs || !this.fs.watch) return;
    const normalized = this._normalize(path);
    const full = normalized === "" ? this.basePath : this.path.join(this.basePath, normalized);
    if (this.watchers.has(normalized)) return;
    try {
      const watcher = this.fs.watch(full, { persistent: false, recursive: this.recursiveWatch }, (eventType, filename) => {
        this.onFileChange(eventType, filename, normalized);
      });
      this.watchers.set(normalized, watcher);
    } catch (e) {
      // path may not exist yet; reconcile will pick it up later
    }
  };

  proto.stopWatchPath = function (path) {
    const normalized = this._normalize(path);
    const watcher = this.watchers.get(normalized);
    if (watcher) {
      try { watcher.close(); } catch (e) {}
      this.watchers.delete(normalized);
    }
  };

  proto.stopWatch = function () {
    for (const watcher of this.watchers.values()) {
      try { watcher.close(); } catch (e) {}
    }
    this.watchers.clear();
  };

  proto.watchHiddenRecursive = function (path) {
    if (this.recursiveWatch) return;
    const normalized = this._normalize(path);
    this.startWatchPath(normalized);
    // also watch each existing subdirectory once
    this.fs.promises.readdir(normalized === "" ? this.basePath : this.path.join(this.basePath, normalized), { withFileTypes: true })
      .then((entries) => {
        for (const entry of entries) {
          if (entry.isDirectory()) this.startWatchPath(normalized === "" ? entry.name : normalized + "/" + entry.name);
        }
      })
      .catch(() => {});
  };

  proto.onFileChange = function (eventType, filename, watchedDir) {
    if (!filename) return;
    let rel = String(filename).replace(/\\/g, "/");
    if (watchedDir) rel = watchedDir === "" ? rel : watchedDir + "/" + rel;
    rel = rel.replace(/\/+/g, "/");
    // Dot-directories (.basalt cache, .trash) are never modelled; their
    // constant writes are what flooded the reconcile queue. Config files
    // inside the config dir stay allowed so external edits still reload.
    if (isHiddenPath(rel) && !(this._hiddenAllow && this._hiddenAllow(rel))) return;
    // Coalesce bursts: cache writes under hidden dirs fire dozens of events per
    // save; queueing one reconcile per event starves real reads behind the flood.
    this._pendingRel.add(rel);
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    setTimeout(() => {
      this._flushScheduled = false;
      const pending = Array.from(this._pendingRel);
      this._pendingRel.clear();
      for (const p of pending) {
        this.queue(() => this._reconcile(this._normalize(p))).catch(() => {});
      }
    }, 50);
  };

  proto.listAll = async function () {
    this.files = {};
    this.files[""] = { type: "folder", realpath: "" };
    await this._scanDir("");
    this.startWatchPath("");
  };

  // Scan a directory into the files table, emitting created/modified events for
  // every entry discovered (the initial listAll is what populates the vault).
  proto._scanDir = async function (dir) {
    const full = dir === "" ? this.basePath : this.path.join(this.basePath, dir);
    let entries;
    try {
      entries = await this.fs.promises.readdir(full, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const child = dir === "" ? entry.name : dir + "/" + entry.name;
      if (entry.isDirectory()) {
        const isNew = !this.files[child];
        this.files[child] = { type: "folder", realpath: child };
        if (isNew) this._emit("folder-created", child);
        await this._scanDir(child);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const stat = await this._statEntry(full, entry.name).catch(() => null);
        const described = this._describeFile(child, stat);
        this.files[child] = described;
        this._emitFileCreatedOrModified(child, described);
      }
    }
  };

  proto._statEntry = async function (dirFull, name) {
    return this.fs.promises.stat(this.path.join(dirFull, name));
  };

  proto._statPath = async function (path) {
    const full = path === "" ? this.basePath : this.path.join(this.basePath, path);
    return this.fs.promises.stat(full);
  };

  proto._describeFile = function (path, stat) {
    return {
      type: "file",
      realpath: path,
      ctime: stat ? Math.round(stat.birthtimeMs != null ? stat.birthtimeMs : stat.ctimeMs) : undefined,
      mtime: stat ? Math.round(stat.mtimeMs) : undefined,
      size: stat ? stat.size : undefined,
    };
  };

  // ---------- reconcile ----------

  proto.reconcileFile = function (path) {
    return this.queue(() => this._reconcile(this._normalize(path)));
  };

  // Internal reconcile; must only run inside a queue slot (it recurses and is
  // called from write/copy/rename paths that already hold the queue).
  proto._reconcile = async function (path) {
    const normalized = this._normalize(path);
    this._emit("raw", normalized);
    if (normalized === "") return;
    if (isHiddenPath(normalized)) {
      await this._removeEntry(normalized);
      return;
    }
    // ensure the parent chain exists first
    const parent = parentPath(normalized);
    if (parent) await this._reconcile(parent);
    const full = this.path.join(this.basePath, normalized);
    let stat;
    try {
      stat = await this.fs.promises.lstat(full);
    } catch (e) {
      if (e && e.code === "ENOENT") {
        await this._removeEntry(normalized);
        return;
      }
      throw e;
    }
    // case-sensitivity verification on insensitive disks
    if (this.insensitive) {
      const dir = parentPath(normalized);
      const dirFull = dir === "" ? this.basePath : this.path.join(this.basePath, dir);
      try {
        const names = await this.fs.promises.readdir(dirFull);
        const base = lastSegment(normalized);
        const found = names.some((n) => n.normalize("NFC") === base.normalize("NFC") || n.toLowerCase() === base.toLowerCase());
        if (!found) {
          await this._removeEntry(normalized);
          return;
        }
      } catch (e) { /* fall through */ }
    }
    if (stat.isSymbolicLink()) {
      try {
        const real = await this.fs.promises.realpath(full);
        const rel = this.path.relative(this.basePath, real).replace(/\\/g, "/");
        if (!rel || rel.startsWith("..")) return; // dangling/outside link
        const targetStat = await this.fs.promises.stat(real);
        if (targetStat.isDirectory()) {
          const isNew = !this.files[normalized];
          this.files[normalized] = { type: "folder", realpath: rel };
          if (isNew) this._emit("folder-created", normalized);
          await this._scanDir(normalized);
        } else {
          const entry = this._describeFile(normalized, targetStat);
          entry.realpath = rel;
          this.files[normalized] = entry;
          this._emitFileCreatedOrModified(normalized, entry);
        }
      } catch (e) { /* dangling link: ignore */ }
      return;
    }
    if (stat.isDirectory()) {
      const isNew = !this.files[normalized];
      this.files[normalized] = { type: "folder", realpath: normalized };
      if (isNew) this._emit("folder-created", normalized);
      await this._scanDir(normalized);
      return;
    }
    const entry = this._describeFile(normalized, stat);
    this.files[normalized] = entry;
    this._emitFileCreatedOrModified(normalized, entry);
  };

  proto._upsertEntry = function (path, entry) {
    const existing = this.files[path];
    this.files[path] = entry;
    return !existing;
  };

  proto._emitFileCreatedOrModified = function (path, entry) {
    const previous = this._lastStat && this._lastStat[path];
    if (!previous) {
      this._emit("file-created", path, entry);
    } else if (previous.mtime !== entry.mtime || previous.size !== entry.size) {
      this._emit("modified", path, entry);
    }
    if (!this._lastStat) this._lastStat = {};
    this._lastStat[path] = { mtime: entry.mtime, size: entry.size };
  };

  proto._removeEntry = async function (path) {
    if (path === "") {
      this._emit("closed");
      return;
    }
    const entry = this.files[path];
    if (!entry) return;
    const wasFolder = entry.type === "folder";
    // unconfirmed deletion: re-check once after a short delay
    await ng13Sleep(100);
    const stillThere = await this._pathExistsOnDisk(path);
    if (stillThere) return;
    // cascade descendants
    const doomed = [];
    for (const key in this.files) {
      if (this.files.hasOwnProperty(key) && key.indexOf(path + "/") === 0) doomed.push(key);
    }
    doomed.sort((a, b) => b.length - a.length);
    for (const key of doomed) {
      const kind = this.files[key] && this.files[key].type === "folder" ? "folder-removed" : "file-removed";
      delete this.files[key];
      if (this._lastStat) delete this._lastStat[key];
      this._emit(kind, key);
    }
    delete this.files[path];
    if (this._lastStat) delete this._lastStat[path];
    this._emit(wasFolder ? "folder-removed" : "file-removed", path);
    if (!this.recursiveWatch) this.stopWatchPath(path);
  };

  // ---------- statics ----------

  FileSystemAdapter.readLocalFile = function (path) {
    const fs = ng13NodeRequire("fs");
    if (!fs) return null;
    try {
      return fs.readFileSync(path);
    } catch (e) {
      return null;
    }
  };

  FileSystemAdapter.mkdir = async function (path) {
    const fs = ng13NodeRequire("fs");
    if (!fs) return;
    await fs.promises.mkdir(path, { recursive: true });
  };

  return FileSystemAdapter;
}

// ===========================================================================
// FileManager method replacements (mI.*). `this` is the FileManager instance.
// ===========================================================================

function fmTFolder() { return fileClass("TFolder"); }
function fmTFile() { return fileClass("TFile"); }
function fmI18n() { return env().gm; }

export function fmMarkdownNewFileParent(sourcePath) {
  const vault = this.vault;
  const location = vault.getConfig("newFileLocation");
  let folder;
  if (location === "folder") {
    folder = vault.getAbstractFileByPath(vault.getConfig("newFileFolderPath"));
    if (folder instanceof fmTFolder()) return folder;
  } else if (location === "current") {
    folder = vault.getAbstractFileByPath(parentPath(sourcePath));
    if (folder instanceof fmTFolder()) return folder;
  }
  return vault.getRoot();
}

export function fmNewFileParent(sourcePath, nameOrExt) {
  const extension = (nameOrExt && extensionOf(nameOrExt)) || "md";
  let creator = this.fileParentCreatorByType[extension];
  if (!creator) {
    console.error("No file creator assigned to create file with extension " + extension + ". Falling back to Markdown file creator.");
    creator = this.fileParentCreatorByType.md;
  }
  return creator(sourcePath);
}

export function fmRegisterFileParentCreator(extension, creator) {
  this.fileParentCreatorByType[extension] = creator;
}

export function fmUnregisterFileCreator(extension) {
  delete this.fileParentCreatorByType[extension];
}

export function fmCanCreateFileWithExt(extension) {
  return this.fileParentCreatorByType.hasOwnProperty(extension || "md");
}

export function fmCreateNewMarkdownFileFromLinktext(linktext, sourcePath) {
  if (!ng13IsValidFileName(linktext)) {
    throw new Error(fmI18n().plugins.fileExplorer.msgInvalidCharacters() + (env().qT || ""));
  }
  let parent = null;
  if (!linktext.contains("/")) parent = this.getNewFileParent(sourcePath, linktext);
  return this.createNewMarkdownFile(parent, linktext);
}

export function fmCreateNewMarkdownFile(parent, name, template) {
  return this.createNewFile(parent, name, "md", template);
}

export function fmCreateNewFile(parent, name, extension, template) {
  const vault = this.vault;
  if (!parent) parent = vault.getRoot();
  if (!extension) extension = (name && extensionOf(name)) || "md";
  if (!this.fileParentCreatorByType.hasOwnProperty(extension)) extension = "md";
  const prefix = parent.getParentPrefix();
  let availablePath;
  if (name) {
    name = name.trim();
    if (extensionOf(name) === extension) name = withoutExtension(name);
    name = normalizePath(name);
    availablePath = vault.getAvailablePath(prefix + name, extension);
  } else {
    const untitled = fmI18n().plugins.fileExplorer.labelUntitledFile();
    availablePath = vault.getAvailablePath(prefix + untitled, extension);
  }
  const folderPath = parentPath(availablePath);
  const fileName = lastSegment(availablePath);
  const folder = (async () => {
    if (folderPath && folderPath !== "/") {
      const existing = vault.getAbstractFileByPathInsensitive(folderPath);
      if (existing instanceof fmTFolder()) return existing;
      return vault.createFolder(folderPath);
    }
    return vault.getRoot();
  })();
  return folder.then((f) => vault.create(f.getParentPrefix() + fileName, template || ""));
}

export function fmCreateNewFolder(parent) {
  const prefix = !parent || parent.isRoot() ? "" : parent.path + "/";
  const untitled = fmI18n().plugins.fileExplorer.labelUntitledFolder();
  const path = this.vault.getAvailablePath(prefix + untitled);
  return this.vault.createFolder(path).then((folder) => {
    const item = this.vault.getAbstractFileByPath(path);
    return item instanceof fmTFolder() ? item : folder;
  });
}

export function fmRenameFile(file, newPath) {
  return this.runAsyncLinkUpdate(() => this.vault.rename(file, newPath));
}

export function fmRunAsyncLinkUpdate(callback) {
  if (this.inProgressUpdates) {
    this.inProgressUpdates.push(callback);
    return Promise.resolve();
  }
  return this.updateQueue.queue(async () => {
    const app = this.app;
    const metadataCache = app.metadataCache;
    const vault = app.vault;
    await new Promise((resolve) => metadataCache.onCleanCache(resolve));
    const updates = [];
    metadataCache.iterateAllRefs((sourcePath, reference) => {
      const link = linkPath(reference.link);
      if (!link) return;
      const sourceFile = vault.getAbstractFileByPath(sourcePath);
      if (!(sourceFile instanceof fmTFile())) return;
      const resolved = metadataCache.getLinkpathDest(link, sourcePath);
      if (resolved.length > 0) {
        updates.push({
          sourceFile,
          reference,
          resolvedFile: resolved[0],
          resolvedPaths: resolved.map((file) => file.path),
        });
      }
    });
    try {
      this.inProgressUpdates = [];
      await callback(updates);
      while (this.inProgressUpdates.length > 0) {
        const pending = this.inProgressUpdates;
        this.inProgressUpdates = [];
        await Promise.all(pending.map((fn) => fn(updates)));
      }
    } finally {
      this.inProgressUpdates = null;
    }
    await this.updateAllLinks(updates);
  });
}

export function fmTrashFile(file) {
  const trashOption = this.app.vault.getConfig("trashOption");
  if (trashOption === "system") return this.app.vault.trash(file, true);
  if (trashOption === "local") return this.app.vault.trash(file, false);
  if (trashOption === "none") return this.app.vault.delete(file, true);
  return this.app.vault.trash(file, false);
}

export function fmGetAvailablePathForAttachment(name, sourcePath) {
  const app = this.app;
  const vault = app.vault;
  const workspace = app.workspace;
  const base = baseName(name);
  const extension = extensionOf(name);
  let folder = null;
  if (sourcePath) {
    const target = vault.getAbstractFileByPath(sourcePath);
    if (target instanceof fmTFolder()) folder = target;
  }
  if (!folder) folder = workspace.getActiveFile();
  return vault.getAvailablePathForAttachments(base, extension, folder);
}

function ng13IsValidFileName(name) {
  try {
    return s05IsValidFileName(name);
  } catch (e) {
    return typeof name === "string" && name.trim().length > 0 && name.indexOf("/") === -1;
  }
}
