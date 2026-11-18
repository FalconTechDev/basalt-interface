// MetadataCache (app.metadataCache): the link/tag/backlink index. File metadata is computed in
// worker.js; results are cached in memory and persisted to IndexedDB ("<appId>-cache", v19).
// Link resolution runs on a low-priority queue so typing stays responsive.
import { debounceCall } from "./timing.js";
import { lastSegment, parentPath, withoutExtension, extensionOf, linkPath, dropMdSuffix } from "./path.js";
import { isStringArray } from "./misc.js";
import { frontmatterAliases } from "./frontmatter.js";
import { inferPropertyWidget } from "./metadata-types.js";
import { fileClass } from "./vault.js";
import { SerialTaskQueue, RefMultimap, LinkQueue, BlockCache, batchedAsync, iterateIdbBatches, contentHash, collectTags, sharesLinkTarget, linkPosToPos, forEachLinkField, escapeRegExp, positionToArray, deserializeMetadata, anyMetadataRef, tagValid, applyLinkUpdates, isOutdatedMetadata } from "./metadata-helpers.js";
import { inherit } from "./inherit.js";

const CLEANUP_INTERVAL = 6e5; // orphaned metadata sweep, 10 min
const INDEX_NOTICE_DELAY = 1e3;
const SLOW_INDEX_NOTICE = 1e4;
const POST_INIT_CLEANUP = 6e4;

const runMicrotask = window.queueMicrotask || window.setTimeout;
const decodeBuffer = (buffer) => new TextDecoder().decode(new Uint8Array(buffer));
const deepCloneJson = (value) => JSON.parse(JSON.stringify(value));

/** zL: a scalar frontmatter value worth indexing (single line, not huge). */
function isScalarPropertyString(value) {
  return value.trim().length !== 0 && !value.includes("\n") && !(value.length > 100 && value.includes(" "));
}

const byPathLength = (a, b) => a.path.length - b.path.length;

export function defineMetadataCache(host) {
  const TFileClass = fileClass("TFile");

  /**
   * app.metadataCache. `transactionSave` is created by _preload once IndexedDB is open; every
   * cache mutation goes through it so the on-disk copy stays in sync.
   */
  function MetadataCache(app, vault) {
    host.Events.call(this);
    this.worker = null;
    this.inProgressTaskCount = 0;
    this.db = null;
    this.fileCache = {};
    this.metadataCache = {};
    this.workQueue = new SerialTaskQueue();
    this.uniqueFileLookup = new RefMultimap();
    this.didFinish = debounceCall(() => this.trigger("finished"), 10, true);
    this.initialized = false;
    this.linkUpdaters = {};
    this.resolvedLinks = {};
    this.unresolvedLinks = {};
    this.linkResolverQueue = null;
    this.onCleanCacheCallbacks = [];
    this.workerResolve = null;
    this.userIgnoreFilters = null;
    this.userIgnoreFiltersString = "";
    this.userIgnoreFilterCache = {};
    this.app = app;
    this.vault = vault;
    this.worker = new Worker("worker.js", { name: "Metadata Cache Worker" });
    this.worker.onmessage = this.onReceiveMessageFromWorker.bind(this);
    this.blockCache = new BlockCache(app);
    this.linkResolver();
    this.on("finished", this.checkCleanCache, this);
    this.on("resolved", this.checkCleanCache, this);
  }
  inherit(MetadataCache, host.Events);

  /** Every note path + frontmatter alias, for the link suggester. */
  MetadataCache.prototype.getLinkSuggestions = function () {
    const suggestions = [];
    const seen = {};
    const unresolved = this.unresolvedLinks;
    const files = this.vault.getFiles();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!this.isSupportedFile(file)) continue;
      const path = file.extension === "md" ? withoutExtension(file.path) : file.path;
      seen[path] = true;
      suggestions.push({ file, path });
      const cache = this.getFileCache(file);
      if (cache) {
        const aliases = frontmatterAliases(cache.frontmatter);
        if (aliases) for (const alias of aliases) suggestions.push({ file, path, alias });
      }
    }
    for (const linkpath in unresolved) {
      if (unresolved.hasOwnProperty(linkpath)) {
        const perFile = unresolved[linkpath];
        for (const target in perFile) {
          if (perFile.hasOwnProperty(target)) {
            let key = target;
            if (key.length > 500) key = key.substring(0, 500);
            if (!seen[key]) {
              seen[key] = true;
              suggestions.push({ file: null, path: key });
            }
          }
        }
      }
    }
    return suggestions;
  };

  /** tag -> occurrence count, with parent tags implied by their children. */
  MetadataCache.prototype.getTags = function () {
    const fileCache = this.fileCache;
    const metadataCache = this.metadataCache;
    const counts = {};
    const add = (tag) => {
      if (tag.endsWith("/")) tag = tag.slice(0, -1);
      if (tagValid(tag)) {
        counts[tag] = (counts[tag] || 0) + 1;
        const parts = tag.split("/");
        const top = parts[parts.length - 1];
        if (top !== tag) add(tag.substr(0, tag.length - top.length - 1));
      }
    };
    for (const path in fileCache) {
      if (fileCache.hasOwnProperty(path) && !this.isUserIgnored(path)) {
        const meta = metadataCache[fileCache[path].hash];
        if (meta) {
          const tags = collectTags(meta);
          if (tags) for (const tag of tags) add(tag);
        }
      }
    }
    const byLower = {};
    for (const tag in counts) {
      if (counts.hasOwnProperty(tag)) {
        const lower = tag.toLowerCase();
        const count = counts[tag];
        if (byLower.hasOwnProperty(lower)) {
          const entry = byLower[lower];
          entry.count += count;
          if (count > entry.max) {
            entry.max = count;
            entry.tag = tag;
          }
        } else {
          byLower[lower] = { tag, count, max: count };
        }
      }
    }
    const result = {};
    for (const lower in byLower) {
      if (byLower.hasOwnProperty(lower)) {
        const entry = byLower[lower];
        result[entry.tag] = entry.count;
      }
    }
    return result;
  };

  MetadataCache.prototype.isUnresolved = function (linktext, sourcePath) {
    return !!this.initialized && !this.getFirstLinkpathDest(linktext, sourcePath);
  };

  MetadataCache.prototype.getFirstLinkpathDest = function (linktext, sourcePath) {
    const dests = this.getLinkpathDest(linktext, sourcePath);
    return dests.length > 0 ? dests[0] : null;
  };

  /**
   * Candidate files for a link. Resolution order: exact basename (when the link has an
   * extension), basename + ".md", unique matches, path-relative "./"/"../" forms, then suffix
   * matches preferring files in the source's folder.
   */
  MetadataCache.prototype.getLinkpathDest = function (linktext, sourcePath) {
    if (linktext === "" && sourcePath) {
      const file = this.vault.getAbstractFileByPath(sourcePath);
      if (file instanceof TFileClass) return [file];
    }
    let lower = linktext.toLowerCase();
    let name = lastSegment(lower);
    let matches = null;
    if (name.includes(".")) matches = this.uniqueFileLookup.get(name);
    if (!matches) {
      lower = (linktext + ".md").toLowerCase();
      name = lastSegment(lower);
      matches = this.uniqueFileLookup.get(name);
    }
    if (!matches) return [];
    if (name === lower && matches.length === 1) return matches.slice();
    let sourceDir = parentPath(sourcePath).toLowerCase();
    if (lower.startsWith("./") || lower.startsWith("../")) {
      if (lower.startsWith("./../")) lower = lower.substr(2);
      if (lower.startsWith("./")) {
        if (sourceDir !== "") sourceDir += "/";
        lower = sourceDir + lower.substring(2);
      } else {
        while (lower.startsWith("../")) {
          lower = lower.substr(3);
          sourceDir = parentPath(sourceDir);
        }
        if (sourceDir !== "") sourceDir += "/";
        lower = sourceDir + lower;
      }
      for (const file of matches) {
        if (file.path.toLowerCase() === lower) return [file];
      }
    }
    if (lower.startsWith("/")) lower = lower.substr(1);
    for (const file of matches) {
      if (file.path.toLowerCase() === lower) return [file];
    }
    if (linktext.startsWith("/")) return [];
    const sameDir = [];
    const otherDir = [];
    for (const file of matches) {
      const path = file.path.toLowerCase();
      if (path.endsWith(lower)) (path.startsWith(sourceDir) ? sameDir : otherDir).push(file);
    }
    sameDir.sort(byPathLength);
    otherDir.sort(byPathLength);
    return sameDir.concat(otherDir);
  };

  /** path -> array of link records (links + embeds) for every cached file. */
  MetadataCache.prototype.getLinks = function () {
    const result = {};
    for (const path in this.fileCache) {
      if (this.fileCache.hasOwnProperty(path)) {
        let links = [];
        const hash = this.fileCache[path].hash;
        const meta = this.metadataCache[hash];
        if (meta) {
          if (meta.links) links = links.concat(meta.links);
          if (meta.embeds) links = links.concat(meta.embeds);
        }
        result[path] = links;
      }
    }
    return result;
  };

  MetadataCache.prototype.getFileCache = function (file) {
    return this.getCache(file.path);
  };

  /** Parsed metadata for a path, {} for non-markdown files, null when not cached. */
  MetadataCache.prototype.getCache = function (path) {
    if (!this.fileCache.hasOwnProperty(path)) return null;
    if (extensionOf(lastSegment(path)) !== "md") return {};
    const hash = this.fileCache[path].hash;
    return this.metadataCache[hash] || null;
  };

  MetadataCache.prototype.getFileInfo = function (path) {
    return this.fileCache[path];
  };

  MetadataCache.prototype.getCachedFiles = function () {
    return Object.keys(this.fileCache);
  };

  /** Visits every link/embed/frontmatter-link record of every cached file; cb may return true to stop early. */
  MetadataCache.prototype.iterateAllRefs = function (callback) {
    const visit = (path) => {
      if (!Object.hasOwn(this.fileCache, path)) return;
      const hash = this.fileCache[path].hash;
      anyMetadataRef(this.metadataCache[hash], (ref) => callback(path, ref));
    };
    for (const path in this.fileCache) visit(path);
    const updaters = this.linkUpdaters;
    for (const updater of Object.values(updaters)) updater.iterateReferences(callback);
  };

  MetadataCache.prototype.iterateRefsForFile = function (file, callback) {
    const updater = this.linkUpdaters[file.extension];
    if (updater) updater.iterateReferencesForFile(file.path, callback);
    else {
      const cache = this.getFileCache(file);
      if (cache) anyMetadataRef(cache, callback);
    }
  };

  /** Rewrites internal links after files moved (FileManager passes path -> new content). */
  MetadataCache.prototype.updateInternalLinks = async function (changes) {
    const updaters = this.linkUpdaters;
    const self = this;
    const apply = async (path) => {
      const file = self.vault.getAbstractFileByPath(path);
      if (file instanceof TFileClass) {
        const extension = file.extension;
        const update = changes.get(path);
        if (Object.hasOwn(updaters, extension)) await updaters[extension].applyUpdates(file, update);
        else await self.vault.process(file, (content) => applyLinkUpdates(content, update));
      }
      return "continue";
    };
    const keys = changes.keys();
    for (const path of keys) await apply(path);
  };

  /** path -> RefMultimap of files linking to `file`. */
  MetadataCache.prototype.getBacklinksForFile = function (file) {
    const self = this;
    const backlinks = new RefMultimap();
    this.iterateAllRefs((sourcePath, ref) => {
      const linkpath = linkPath(ref.link);
      const dest = self.getFirstLinkpathDest(linkpath, sourcePath);
      if (dest && dest === file) backlinks.add(sourcePath, ref);
    });
    return backlinks;
  };

  /** The wikilink text that resolves to `file` from `sourcePath` under the configured link format. */
  MetadataCache.prototype.fileToLinktext = function (file, sourcePath, useMd = true) {
    const format = this.vault.getConfig("newLinkFormat");
    const mdPath = file.extension === "md" && useMd ? withoutExtension(file.path) : file.path;
    if (format === "absolute") return mdPath;
    if (format === "relative") {
      let prefix = "";
      let dir = parentPath(sourcePath);
      while (dir !== "" && dir !== "/" && mdPath.indexOf(dir + "/") !== 0) {
        prefix = "../" + prefix;
        dir = parentPath(dir);
      }
      return mdPath.indexOf(dir + "/") === 0 ? prefix + mdPath.substr(dir.length + 1) : prefix + mdPath;
    }
    const short = file.extension === "md" && useMd ? file.basename : file.name;
    const linkpath = linkPath(short);
    const dests = this.getLinkpathDest(linkpath, sourcePath);
    if (dests && dests.length === 1 && dests[0] === file) return short;
    return file.extension === "md" && useMd ? withoutExtension(file.path) : file.path;
  };

  MetadataCache.prototype.watchVaultChanges = function () {
    const vault = this.vault;
    vault.on("create", this.onCreate.bind(this));
    vault.on("modify", this.computeFileMetadataAsync.bind(this));
    vault.on("delete", this.onDelete.bind(this));
    vault.on("rename", this.onRename.bind(this));
    vault.on("config-changed", this.onConfigChanged.bind(this));
  };

  /** Returns the in-flight (or cached) preload promise; resolves once IndexedDB is read. */
  MetadataCache.prototype.preload = function () {
    if (this.initialized) return;
    if (!this.preloadPromise) this.preloadPromise = this._preload();
    return this.preloadPromise;
  };

  /** Opens "<appId>-cache" v19 (file + metadata stores) and hydrates both in-memory caches. */
  MetadataCache.prototype._preload = async function () {
    const fileCache = this.fileCache;
    const metadataCache = this.metadataCache;
    let db;
    try {
      db = this.db = await host.openMetadataDb(this.app.appId + "-cache", 19, {
        upgrade: (database) => {
          if (database.objectStoreNames.contains("file")) database.deleteObjectStore("file");
          if (database.objectStoreNames.contains("metadata")) database.deleteObjectStore("metadata");
          database.createObjectStore("file");
          database.createObjectStore("metadata");
        },
      });
      this.transactionSave = makeTransactionSave(db, ["file", "metadata"]);
    } catch (error) {
      console.error("Failed to load cache, unable to open IndexedDB", error);
      return;
    }
    try {
      const tx = db.transaction(["file", "metadata"], "readonly");
      const keys = await tx.objectStore("file").getAllKeys();
      const values = await tx.objectStore("file").getAll();
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = values[i];
        if (key && value) fileCache[key] = value;
      }
      await iterateIdbBatches(tx.objectStore("metadata"), 300, (keys, values) => {
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          const value = values[i];
          if (key && value) {
            if (isOutdatedMetadata(value)) {
              db.transaction("metadata", "readwrite", { durability: "relaxed" }).objectStore("metadata").put(deepCloneJson(value), key);
            }
            metadataCache[key] = deserializeMetadata(value);
          }
        }
      });
    } catch (error) {
      console.error("Failed to load cache", error);
    }
  };

  MetadataCache.prototype.initialize = async function () {
    await this.preload();
    this.preloadPromise = null;
    const fileCache = this.fileCache;
    const metadataCache = this.metadataCache;
    setInterval(this.cleanupDeletedCache.bind(this), CLEANUP_INTERVAL);
    const files = {};
    const loaded = this.vault.getAllLoadedFiles();
    for (const file of loaded) {
      if (file instanceof TFileClass) {
        this.uniqueFileLookup.add(file.name.toLowerCase(), file);
        files[file.path] = file;
      }
    }
    for (const path in fileCache) {
      if (fileCache.hasOwnProperty(path)) {
        const file = files[path];
        const entry = fileCache[path];
        if (file) {
          if (metadataCache.hasOwnProperty(entry.hash)) {
            if (file.stat.mtime !== entry.mtime || file.stat.size !== entry.size) this.computeFileMetadataAsync(file);
            else this.queueFileForLinkResolution(file);
          } else {
            this.computeFileMetadataAsync(file);
          }
        } else {
          this.deletePath(path);
        }
      }
    }
    for (const path in files) {
      if (files.hasOwnProperty(path) && !fileCache.hasOwnProperty(path)) this.computeFileMetadataAsync(files[path]);
    }
    this.initialized = true;
    this.watchVaultChanges();
    this.updateUserIgnoreFilters();
    this.trigger("finished");
    setTimeout(() => this.cleanupDeletedCache(), POST_INIT_CLEANUP);
  };

  /** Wipes the persisted metadata store (keeps file mtimes). */
  MetadataCache.prototype.clear = async function () {
    const db = this.db;
    if (db) {
      await db.clear("metadata");
      await db.clear("file");
    }
  };

  /** Progress-bar notice shown while the initial index is still filling in. */
  MetadataCache.prototype.showIndexingNotice = function () {
    const self = this;
    const bar = host.createEl("progress");
    const content = host.createFragment((el) => {
      el.createSpan({ text: host.i18n.interface.msgIndexing() });
      el.createEl("br");
      el.createSpan({ cls: "u-small", text: host.i18n.interface.msgIndexingDesc() });
      el.append(bar);
    });
    const total = Object.keys(this.metadataCache).length;
    const target = total + this.inProgressTaskCount;
    bar.max = target;
    bar.value = total;
    let notice;
    let interval;
    const startTimer = window.setTimeout(() => {
      if (self.inProgressTaskCount <= 0) return;
      notice = new host.Notice(content, 0);
      interval = window.setInterval(() => {
        if (notice.containerEl.offsetParent) bar.value = Math.max(0, target - self.inProgressTaskCount);
        else window.clearInterval(interval);
      }, 300);
    }, INDEX_NOTICE_DELAY);
    this.onCleanCache(() => {
      window.clearTimeout(startTimer);
      window.clearInterval(interval);
      if (notice) {
        notice.setMessage(host.i18n.interface.msgIndexingComplete());
        notice.containerEl.addClass("mod-success");
        setTimeout(() => notice.hide(), 3000);
      }
    });
  };

  /**
   * Background consumer of the link-resolution queue: pulls files off the queue in batches
   * (Cb paces itself) and resolves their outgoing links until the queue drains.
   */
  MetadataCache.prototype.linkResolver = function () {
    const self = this;
    const iterable = batchedAsync(
      (this.linkResolverQueue = new LinkQueue({
        onStop: () => self.trigger("resolved"),
        onCancel: () => {
          self.linkResolverQueue = null;
        },
      })).generator()
    );
    (async () => {
      for await (const item of iterable) {
        if (!item) continue;
        self.resolveLinks(item.path);
        self.trigger("resolve", item);
      }
    })();
  };

  MetadataCache.prototype.queueFileForLinkResolution = function (file) {
    this.linkResolverQueue.add(file);
  };

  /** Recomputes resolvedLinks/unresolvedLinks for one file from its cached refs. */
  MetadataCache.prototype.resolveLinks = function (path) {
    if (!this.getCache(path)) return;
    const resolved = {};
    const unresolved = {};
    const file = this.app.vault.getFileByPath(path);
    this.iterateRefsForFile(file, (ref) => {
      const linkpath = linkPath(ref.link);
      const dest = this.getFirstLinkpathDest(linkpath, path);
      if (dest) resolved[dest.path] = (resolved[dest.path] || 0) + 1;
      else {
        const key = dropMdSuffix(linkpath);
        unresolved[key] = (unresolved[key] || 0) + 1;
      }
    });
    this.resolvedLinks[path] = resolved;
    this.unresolvedLinks[path] = unresolved;
  };

  MetadataCache.prototype.onCleanCache = function (callback) {
    if (this.isCacheClean()) callback();
    else this.onCleanCacheCallbacks.push(callback);
  };

  MetadataCache.prototype.checkCleanCache = function () {
    while (this.onCleanCacheCallbacks.length > 0 && this.isCacheClean()) {
      const callback = this.onCleanCacheCallbacks.shift();
      try {
        callback();
      } catch (error) {
        console.error(error);
      }
    }
  };

  MetadataCache.prototype.isCacheClean = function () {
    return (
      this.inProgressTaskCount === 0 &&
      this.linkResolverQueue.items.length === 0 &&
      !this.linkResolverQueue.runnable.isRunning()
    );
  };

  /** Schedules link re-resolution for files whose link targets may have been renamed/deleted. */
  MetadataCache.prototype.updateRelatedLinks = function (paths) {
    const variants = [];
    const lower = paths.map((path) => path.toLowerCase());
    for (const path of lower) {
      if (path.endsWith(".md")) variants.push(path.substring(0, path.length - 3));
      variants.push(path);
    }
    const resolved = this.resolvedLinks;
    const unresolved = this.unresolvedLinks;
    const cached = this.getCachedFiles();
    for (const path of cached) {
      if (sharesLinkTarget(lower, resolved[path]) || sharesLinkTarget(variants, unresolved[path])) {
        const file = this.vault.getFileByPath(path);
        if (file) this.queueFileForLinkResolution(file);
      }
    }
  };

  MetadataCache.prototype.onCreate = function (file) {
    this.computeFileMetadataAsync(file);
    if (file && file instanceof TFileClass) this.updateRelatedLinks([file.name]);
  };

  /**
   * (Re)indexes one file: skips when mtime+size+hash are unchanged, otherwise reads the file,
   * hashes it, asks the worker for metadata and queues link resolution. Returns the queued
   * promise when work was scheduled.
   */
  MetadataCache.prototype.computeFileMetadataAsync = function (file) {
    if (!file || !(file instanceof TFileClass)) return;
    const self = this;
    this.uniqueFileLookup.add(file.name.toLowerCase(), file);
    const stat = file.stat;
    const path = file.path;
    let cacheEntry = null;
    if (file.extension === "md") {
      if (this.fileCache.hasOwnProperty(path)) cacheEntry = this.fileCache[path];
      let uptodate = false;
      if (cacheEntry) {
        const sameStat = cacheEntry.mtime === stat.mtime && cacheEntry.size === stat.size;
        const hasMeta = cacheEntry.hash && this.metadataCache.hasOwnProperty(cacheEntry.hash);
        uptodate = sameStat && hasMeta;
      } else {
        cacheEntry = { mtime: 0, size: 0, hash: "" };
        this.saveFileCache(path, cacheEntry);
      }
      if (!uptodate) {
        this.inProgressTaskCount++;
        return this.workQueue.queue(async () => {
          try {
            await (async () => {
              const buffer = await self.vault.readBinary(file);
              const text = decodeBuffer(buffer);
              const hash = await contentHash(buffer);
              cacheEntry.mtime = stat.mtime;
              cacheEntry.size = stat.size;
              cacheEntry.hash = hash;
              self.saveFileCache(path, cacheEntry);
              let meta = self.metadataCache[hash];
              if (meta) {
                self.queueFileForLinkResolution(file);
                self.trigger("changed", file, text, meta);
                return;
              }
              const slowTimer = setTimeout(() => {
                new host.Notice("Indexing taking a long time for " + file.path);
              }, SLOW_INDEX_NOTICE);
              try {
                meta = await self.work(buffer);
              } finally {
                clearTimeout(slowTimer);
              }
              if (meta) {
                self.saveMetaCache(hash, meta);
                self.queueFileForLinkResolution(file);
                self.trigger("changed", file, text, meta);
              } else {
                console.log("Metadata failed to parse", file);
              }
            })();
          } catch (error) {
            console.error(error);
          } finally {
            self.inProgressTaskCount--;
            if (self.inProgressTaskCount === 0) self.didFinish();
          }
        });
      }
      this.queueFileForLinkResolution(file);
    } else {
      this.saveFileCache(path, { mtime: stat.mtime, size: stat.size, hash: "" });
    }
  };

  MetadataCache.prototype.onDelete = function (file) {
    if (file && file instanceof TFileClass) {
      this.uniqueFileLookup.remove(file.name.toLowerCase(), file);
      this.trigger("deleted", file, this.getFileCache(file));
      this.deletePath(file.path);
    }
  };

  MetadataCache.prototype.deletePath = function (path) {
    delete this.resolvedLinks[path];
    delete this.unresolvedLinks[path];
    this.saveFileCache(path, null);
    this.updateRelatedLinks([lastSegment(path)]);
    this.queueFileForLinkResolution(null);
    if (this.inProgressTaskCount === 0) this.didFinish();
  };

  MetadataCache.prototype.onRename = function (oldFile, newPath) {
    if (!(oldFile && oldFile instanceof TFileClass)) return;
    const oldPath = oldFile.path;
    const lookup = this.uniqueFileLookup;
    const resolved = this.resolvedLinks;
    const unresolved = this.unresolvedLinks;
    const fileCache = this.fileCache;
    lookup.remove(lastSegment(newPath).toLowerCase(), oldFile);
    lookup.add(oldFile.name.toLowerCase(), oldFile);
    if (resolved.hasOwnProperty(newPath)) {
      resolved[oldPath] = resolved[newPath];
      delete resolved[newPath];
    }
    if (unresolved.hasOwnProperty(newPath)) {
      unresolved[oldPath] = unresolved[newPath];
      delete unresolved[newPath];
    }
    if (fileCache.hasOwnProperty(newPath)) {
      this.saveFileCache(oldPath, fileCache[newPath]);
      this.saveFileCache(newPath, null);
    }
    const newBase = lastSegment(newPath);
    const oldBase = lastSegment(oldPath);
    if (oldBase !== newBase) this.updateRelatedLinks([newBase, oldBase]);
    else this.updateRelatedLinks([newBase]);
    this.queueFileForLinkResolution(null);
  };

  /** fileCache[path] = entry (or delete when null); persisted via transactionSave when open. */
  MetadataCache.prototype.saveFileCache = function (path, entry) {
    if (entry) this.fileCache[path] = entry;
    else delete this.fileCache[path];
    if (this.transactionSave) return this.transactionSave("file", path, entry);
  };

  /** Stores parsed metadata under its content hash; serializes position fields for IndexedDB. */
  MetadataCache.prototype.saveMetaCache = function (hash, meta) {
    if (meta) {
      this.metadataCache[hash] = meta;
      if (!this.transactionSave) return;
      const copy = deepCloneJson(meta);
      if (copy.frontmatterPosition) {
        copy.frontmatterPos = positionToArray(copy.frontmatterPosition);
        delete copy.frontmatterPosition;
      }
      forEachLinkField(copy, linkPosToPos);
      return this.transactionSave("metadata", hash, copy);
    }
    delete this.metadataCache[hash];
    if (this.transactionSave) return this.transactionSave("metadata", hash, null);
  };

  /** Sends one metadata payload to the worker; only one outstanding request allowed. */
  MetadataCache.prototype.work = function (payload) {
    if (this.workerResolve) throw new Error("Work queue must be sequential!");
    return new Promise((resolve) => {
      this.workerResolve = resolve;
      this.worker.postMessage({ metadataCache: payload }, [payload]);
    });
  };

  /** Recomputes metadata for an already-read payload through the serial work queue. */
  MetadataCache.prototype.computeMetadataAsync = function (payload) {
    const self = this;
    return this.workQueue.queue(async () => {
      try {
        return await self.work(payload);
      } catch (error) {
        console.error(error);
      }
    });
  };

  MetadataCache.prototype.onReceiveMessageFromWorker = function (event) {
    if (this.workerResolve) {
      this.workerResolve(event.data);
      this.workerResolve = null;
    }
  };

  /** Drops metadata entries whose file is gone from fileCache. */
  MetadataCache.prototype.cleanupDeletedCache = function () {
    const fileCache = this.fileCache;
    const metadataCache = this.metadataCache;
    const live = {};
    for (const path in fileCache) {
      if (fileCache.hasOwnProperty(path)) live[fileCache[path].hash] = true;
    }
    for (const hash in metadataCache) {
      if (metadataCache.hasOwnProperty(hash) && !live[hash]) this.saveMetaCache(hash, null);
    }
  };

  MetadataCache.prototype.onConfigChanged = function (key) {
    if (key === "userIgnoreFilters") this.updateUserIgnoreFilters();
  };

  /** Rebuilds the ignore-filter regex list when the vault config changes. */
  MetadataCache.prototype.updateUserIgnoreFilters = function () {
    const filters = this.app.vault.getConfig("userIgnoreFilters");
    const serialized = JSON.stringify(filters);
    if (this.userIgnoreFiltersString === serialized) return;
    this.userIgnoreFiltersString = serialized;
    this.userIgnoreFilterCache = {};
    if (filters) {
      const list = (this.userIgnoreFilters = []);
      for (const raw of filters) {
        const filter = raw.trim();
        if (filter.length === 0) continue;
        try {
          if (filter.length > 2 && filter.startsWith("/") && filter.endsWith("/")) {
            list.push(new RegExp(filter.substring(1, filter.length - 1), "i"));
          } else {
            list.push(new RegExp("^" + escapeRegExp(filter), "i"));
          }
        } catch (error) {
          console.error("Bad regex for user ignore filter", error);
        }
      }
    } else {
      this.userIgnoreFilters = null;
    }
  };

  MetadataCache.prototype.isSupportedFile = function (file) {
    const app = this.app;
    return !!app.vault.getConfig("showUnsupportedFiles") || app.viewRegistry.isExtensionRegistered(file.extension);
  };

  MetadataCache.prototype.isUserIgnored = function (path) {
    const filters = this.userIgnoreFilters;
    const cache = this.userIgnoreFilterCache;
    if (!filters) return false;
    if (Object.hasOwn(cache, path)) return cache[path];
    let ignored = false;
    for (const filter of filters) {
      if (filter.test(path)) {
        ignored = true;
        break;
      }
    }
    cache[path] = ignored;
    return ignored;
  };

  /** Lowercased property name -> {name, widget, occurrences} across all frontmatter. */
  MetadataCache.prototype.getAllPropertyInfos = function () {
    const fileCache = this.fileCache;
    const metadataCache = this.metadataCache;
    const result = {};
    const assigned = this.app.metadataTypeManager.assignedWidgets;
    for (const key in assigned) {
      if (Object.hasOwn(assigned, key)) {
        const entry = assigned[key];
        result[key] = { name: entry.name, widget: entry.widget, occurrences: 0 };
      }
    }
    for (const path in fileCache) {
      if (Object.hasOwn(fileCache, path) && !this.isUserIgnored(path)) {
        const meta = metadataCache[fileCache[path].hash];
        if (meta) {
          const frontmatter = meta.frontmatter;
          if (frontmatter) {
            for (const key in frontmatter) {
              if (Object.hasOwn(frontmatter, key)) {
                const value = frontmatter[key];
                const lower = key.toLowerCase();
                if (Object.hasOwn(result, lower)) {
                  const entry = result[lower];
                  entry.occurrences++;
                  if (!entry.widget && value != null) entry.widget = inferPropertyWidget(value);
                } else {
                  result[lower] = { name: key, occurrences: 1, widget: value != null ? inferPropertyWidget(value) : undefined };
                }
              }
            }
          }
        }
      }
    }
    return Object.fromEntries(
      Object.entries(result).map(([key, info]) => [key, { ...info, widget: info.widget != null ? info.widget : "text" }])
    );
  };

  /** Sorted unique scalar values of one frontmatter key across the vault. */
  MetadataCache.prototype.getFrontmatterPropertyValuesForKey = function (key) {
    if (!key) return [];
    const fileCache = this.fileCache;
    const metadataCache = this.metadataCache;
    const values = new Set();
    for (const path in fileCache) {
      if (Object.hasOwn(fileCache, path) && !this.isUserIgnored(path)) {
        const meta = metadataCache[fileCache[path].hash];
        if (meta) {
          const frontmatter = meta.frontmatter;
          if (frontmatter && frontmatter.hasOwnProperty(key)) {
            const value = frontmatter[key];
            if (isStringArray(value)) {
              for (const item of value) if (isScalarPropertyString(item)) values.add(item);
            } else if (typeof value === "string" && isScalarPropertyString(value)) {
              values.add(value);
            }
          }
        }
      }
    }
    return Array.from(values).sort(host.compareStrings);
  };

  return MetadataCache;
}

/**
 * Builds the transactionSave(store,key,value) writer used once IndexedDB is open: reuses the
 * current readwrite transaction until the microtask checkpoint, then opens a fresh one.
 */
function makeTransactionSave(db, stores) {
  let tx = null;
  return function (store, key, value) {
    if (tx) {
      try {
        const objectStore = tx.objectStore(store);
        return value ? objectStore.put(value, key) : objectStore.delete(key);
      } catch {
        // stale transaction: fall through and open a new one
      }
    }
    const fresh = db.transaction(stores, "readwrite", { durability: "relaxed" });
    tx = fresh;
    runMicrotask(() => {
      if (tx === fresh) tx = null;
    });
    const objectStore = fresh.objectStore(store);
    return value ? objectStore.put(value, key) : objectStore.delete(key);
  };
}
