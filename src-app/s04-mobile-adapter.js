// s04: own implementation of the mobile (Capacitor) data adapter (was `vk`).
//
// It presents the vault as a DataAdapter over the Capacitor filesystem plugin
// (`this.fs`, the bridge created by the `pk` module). Files are tracked in a
// `realpath` map so a directory can be materialised lazily by reconcile; all
// mutating operations run through a serial promise queue.

import { env } from "./env.js";
import { lastSegment, parentPath, isHiddenPath, withoutExtension, extensionOf, collapseSlashes, plainSpaces, normalizePath } from "./path.js";
import { statFromCapacitor } from "./misc.js";

/** Own implementation of the Capacitor filesystem data adapter. */
export function s04CapacitorAdapter(host) {
  class CapacitorAdapter {
    constructor(basePath, fs) {
      this.fs = fs;
      this.basePath = basePath;
      this.files = {};
      this.promise = Promise.resolve();
      this.handler = null;
      this.insensitive = false;
      // Platform adapters may override testInsensitive; on the base class it
      // is a resolved no-op.
      this.testInsensitive();
    }

    async testInsensitive() {}

    getName() {
      return lastSegment(this.basePath);
    }

    async watchAndList() {
      this.files = {};
      this.files["/"] = { type: "folder", realpath: "/" };
      try {
        const tree = await this.fs.watchAndStatAll(this.basePath);
        if (tree.children) {
          for (const child of tree.children) this.quickList("", child);
        }
      } catch (error) {
        console.error("Failed to run quick list", error);
        await this.fs.watch(this.basePath);
        await this.listRecursive("");
      }
    }

    quickList(prefix, node) {
      const name = node.name;
      const path = collapseSlashes(prefix === "" ? name : prefix + "/" + name);
      const normalized = normalizePath(path);
      this.trigger("raw", normalized);
      if (isHiddenPath(normalized)) return;
      if (node.type === "file") {
        this.reconcileFileChanged(path, normalized, node);
      } else if (node.type === "directory") {
        if (this.files.hasOwnProperty(normalized)) return;
        this.files[normalized] = { type: "folder", realpath: path };
        this.trigger("folder-created", normalized);
      }
    }

    async listRecursive(prefix) {
      const full = this.getFullRealPath(prefix);
      const entries = await this.fs.readdir(full);
      const pending = [];
      for (const entry of entries) pending.push(this.listRecursiveChild(prefix, entry));
      await Promise.all(pending);
    }

    async listRecursiveChild(prefix, entry) {
      const path = collapseSlashes(prefix === "" ? entry.name : prefix + "/" + entry.name);
      const normalized = normalizePath(path);
      this.trigger("raw", normalized);
      if (isHiddenPath(normalized)) return this.reconcileDeletion(path, normalized);
      if (entry.type === "file") {
        this.reconcileFileChanged(path, normalized, entry);
      } else if (entry.type === "directory") {
        await this.reconcileFolderCreation(path, normalized);
      }
    }

    mkdir(path) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(path);
        try {
          await self.fs.mkdir(full);
        } catch (error) {
          if (error.message !== "Directory exists") throw error;
        }
        await self.reconcileInternalFile(path);
      });
    }

    trashSystem(path) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(path);
        try {
          await self.fs.trash(full);
        } catch (error) {
          return false;
        }
        await self.reconcileInternalFile(path);
        return true;
      });
    }

    trashLocal(path) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(path);
        const trash = self.getFullPath(".trash");
        try {
          await self.fs.mkdir(trash);
        } catch (error) {
          if (error.message !== "Directory exists") throw error;
        }
        const name = lastSegment(full);
        const stem = withoutExtension(name);
        const ext = extensionOf(name);
        let target = trash + "/" + stem;
        if (ext) target = target + "." + ext;
        let count = 1;
        while (await self._exists(target)) {
          count++;
          target = trash + "/" + stem + " " + count;
          if (ext) target = target + "." + ext;
        }
        await self.fs.rename(full, target);
        await self.reconcileInternalFile(path);
      });
    }

    rmdir(path) {
      const self = this;
      return this.queue(async function () {
        await self.fs.rmdir(self.getFullPath(path));
        await self.reconcileInternalFile(path);
      });
    }

    read(path) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(path);
        try {
          return await self.fs.read(full);
        } catch (error) {
          self.queue(function () { return self.reconcileInternalFile(path); });
          throw error;
        }
      });
    }

    readBinary(path) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(path);
        try {
          return await self.fs.readBinary(full);
        } catch (error) {
          self.queue(function () { return self.reconcileInternalFile(path); });
          throw error;
        }
      });
    }

    write(path, data, options) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(path);
        try {
          await self.fs.write(full, data);
          if (options && (options.ctime || options.mtime)) await self.fs.setTimes(full, options.ctime, options.mtime);
          if (options && options.immediate) options.immediate();
        } catch (error) {
          await self.reconcileInternalFile(path);
          throw error;
        }
      });
    }

    writeBinary(path, data, options) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(path);
        try {
          await self.fs.writeBinary(full, data);
          if (options && (options.ctime || options.mtime)) await self.fs.setTimes(full, options.ctime, options.mtime);
          if (options && options.immediate) options.immediate();
        } catch (error) {
          await self.reconcileInternalFile(path);
          throw error;
        }
      });
    }

    append(path, data, options) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(path);
        try {
          await self.fs.append(full, data);
          if (options && (options.ctime || options.mtime)) await self.fs.setTimes(full, options.ctime, options.mtime);
          if (options && options.immediate) options.immediate();
        } catch (error) {
          await self.reconcileInternalFile(path);
          throw error;
        }
      });
    }

    appendBinary(path, data, options) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(path);
        try {
          await self.fs.appendBinary(full, data);
          if (options && (options.ctime || options.mtime)) await self.fs.setTimes(full, options.ctime, options.mtime);
          if (options && options.immediate) options.immediate();
        } catch (error) {
          await self.reconcileInternalFile(path);
          throw error;
        }
      });
    }

    process(path, fn, options) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(path);
        const contents = await self.fs.read(full);
        const next = fn(contents);
        if (next === contents) return contents;
        try {
          await self.fs.write(full, next);
          if (options && (options.ctime || options.mtime)) await self.fs.setTimes(full, options.ctime, options.mtime);
          if (options && options.immediate) options.immediate();
        } catch (error) {
          await self.reconcileInternalFile(path);
          throw error;
        }
        return next;
      });
    }

    getResourcePath(path) {
      return this.fs.getUri(this.getFullPath(path));
    }

    getNativePath(path) {
      return this.fs.getNativeUri(this.getFullPath(path));
    }

    open(path) {
      return this.fs.open(this.getFullPath(path));
    }

    remove(path) {
      const self = this;
      return this.queue(async function () {
        await self.fs.delete(self.getFullPath(path));
        await self.reconcileInternalFile(path);
      });
    }

    update(path) {
      const self = this;
      return this.queue(async function () {
        await self.reconcileInternalFile(path);
      });
    }

    rename(oldPath, newPath) {
      const self = this;
      return (async function () {
        if (oldPath === newPath) return;
        await self.queue(async function () {
          const oldFull = self.getFullPath(oldPath);
          const newFull = self.getFullPath(newPath);
          if (await self._exists(newFull, false) && (!self.insensitive || oldPath.toLowerCase() !== newPath.toLowerCase())) {
            throw new Error("Destination file already exists!");
          }
          const entry = self.files[oldPath];
          const oldReal = entry ? entry.realpath : null;
          await self.fs.rename(oldFull, newFull);
          if (!entry) return;
          delete self.files[oldPath];
          const newReal = self.getRealPath(newPath);
          entry.realpath = newReal;
          self.files[newPath] = entry;
          self.trigger("renamed", newPath, oldPath);
          if (entry.type === "folder") {
            for (const key in self.files) {
              if (!self.files.hasOwnProperty(key) || !key.startsWith(oldPath + "/")) continue;
              const suffix = key.slice(oldPath.length);
              const movedKey = newPath + suffix;
              const moved = self.files[key];
              delete self.files[key];
              moved.realpath = newReal + moved.realpath.slice(oldReal.length);
              self.files[movedKey] = moved;
              self.trigger("renamed", movedKey, key);
            }
          }
        });
      })();
    }

    copy(oldPath, newPath) {
      const self = this;
      return (async function () {
        await self.queue(async function () {
          await self.fs.copy(self.getFullPath(oldPath), self.getFullPath(newPath));
          await self.reconcileInternalFile(newPath);
        });
      })();
    }

    exists(path, strict) {
      const self = this;
      return this.queue(function () {
        return self._exists(self.getFullPath(path), strict);
      });
    }

    async _exists(fullPath, strict) {
      try {
        await this.fs.stat(fullPath);
      } catch (error) {
        return false;
      }
      if (strict && this.insensitive) {
        const dir = parentPath(fullPath);
        const name = lastSegment(fullPath);
        const entries = await this.fs.readdir(dir);
        if (entries.map((e) => e.name).indexOf(name) === -1) return false;
      }
      return true;
    }

    stat(path) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(path);
        try {
          const st = await self.fs.stat(full);
          if (st.type === "file") return Object.assign({ type: "file" }, statFromCapacitor(st));
          if (st.type === "directory") return Object.assign({ type: "folder" }, statFromCapacitor(st));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        return null;
      });
    }

    list(prefix) {
      const self = this;
      return this.queue(async function () {
        const full = self.getFullPath(prefix);
        const entries = await self.fs.readdir(full);
        const result = { folders: [], files: [] };
        for (const entry of entries) {
          const path = collapseSlashes(prefix === "" ? entry.name : prefix + "/" + entry.name);
          const normalized = normalizePath(path);
          if (entry.type === "file") result.files.push(normalized);
          if (entry.type === "directory") result.folders.push(normalized);
        }
        return result;
      });
    }

    async watch(handler) {
      await this.stopWatch();
      this.handler = handler;
      await env().Dm.addListener("change", (event) => {
        const raw = normalizePath(event.path);
        const relative = normalizePath(raw.substr(this.basePath.length));
        this.onFileChange(relative);
      });
      const self = this;
      return this.queue(async function () {
        await self.watchAndList();
      });
    }

    async stopWatch() {
      try {
        await env().Dm.stopWatch();
      } catch (error) {
        // ignore
      }
      this.handler = null;
    }

    onFileChange(path) {
      const self = this;
      if (!path) return;
      path = normalizePath(path);
      setTimeout(function () {
        const normalized = normalizePath(path);
        self.queue(function () {
          return self.reconcileFile(path, normalized, false);
        });
      }, 0);
    }

    reconcileInternalFile(path) {
      const self = this;
      return this.queue(async function () {
        return self.reconcileFile(self.getRealPath(path), path);
      });
    }

    async reconcileFile(realPath, path, remove = true) {
      this.trigger("raw", path);
      if (isHiddenPath(path)) return this.reconcileDeletion(realPath, path, remove);
      const parent = parentPath(path);
      if (parent && parent !== "/" && !this.files[path]) {
        await this.reconcileFile(parentPath(realPath), parent, remove);
      }
      try {
        const full = this.getFullRealPath(realPath);
        if (this.insensitive) {
          const dir = parentPath(full);
          const name = lastSegment(path);
          const entries = await this.fs.readdir(dir);
          if (entries.map((e) => plainSpaces(e.name).normalize("NFC")).indexOf(name) === -1) {
            return this.reconcileDeletion(realPath, path, remove);
          }
        }
        const st = await this.fs.stat(full);
        if (st.type === "file") {
          this.reconcileFileChanged(realPath, path, st);
        } else if (st.type === "directory") {
          await this.reconcileFolderCreation(realPath, path);
        }
      } catch (error) {
        if (error.code === "ENOENT") await this.reconcileDeletion(realPath, path, remove);
        else console.error(error);
      }
    }

    reconcileFileChanged(realPath, path, stat) {
      const entry = this.files[path];
      if (!entry) {
        this.reconcileFileCreation(realPath, path, stat);
        return;
      }
      entry.realpath = realPath;
      if (entry.type !== "file") return;
      if (entry.mtime !== Math.round(stat.mtime) || entry.size !== stat.size) {
        entry.mtime = Math.round(stat.mtime);
        entry.size = stat.size;
        const info = statFromCapacitor(stat);
        this.trigger("modified", path, path, info);
      }
    }

    reconcileFileCreation(realPath, path, stat) {
      const info = statFromCapacitor(stat);
      if (this.files[path]) return;
      const entry =
        stat.type === "file"
          ? {
              type: "file",
              realpath: realPath,
              ctime: Math.round(stat.ctime),
              mtime: Math.round(stat.mtime),
              size: stat.size,
            }
          : stat.type === "directory"
            ? { type: "folder", realpath: realPath }
            : undefined;
      this.files[path] = entry;
      this.trigger("file-created", path, path, info);
    }

    async reconcileFolderCreation(realPath, path) {
      if (!this.files.hasOwnProperty(path)) {
        this.files[path] = { type: "folder", realpath: realPath };
        this.trigger("folder-created", path);
        await this.listRecursive(realPath);
      } else {
        this.files[path].realpath = realPath;
      }
    }

    async reconcileDeletion(realPath, path, remove = true) {
      if (path === "/") {
        this.trigger("closed", path);
        return;
      }
      const entry = this.files[path];
      if (!entry) return;
      if (!remove) {
        const self = this;
        setTimeout(function () {
          self.queue(function () {
            return self.reconcileFile(realPath, path);
          });
        }, 100);
        return;
      }
      if (entry.type === "folder") {
        for (const key in this.files) {
          if (this.files.hasOwnProperty(key) && key.startsWith(path + "/")) this.removeFile(key);
        }
      }
      this.removeFile(path);
    }

    trigger(event, path, oldPath, stat) {
      if (this.handler) this.handler(event, path, oldPath, stat);
    }

    getRealPath(path) {
      let current = path;
      while (current) {
        if (this.files.hasOwnProperty(current)) {
          const suffix = path.substr(current.length);
          return this.files[current].realpath + suffix;
        }
        current = parentPath(current);
      }
      return path;
    }

    getFullPath(path) {
      return this.getFullRealPath(this.getRealPath(path));
    }

    getFullRealPath(path) {
      return this.basePath + "/" + path;
    }

    queue(fn) {
      const result = this.promise.then(fn, fn);
      this.promise = result;
      return result;
    }

    removeFile(path) {
      const entry = this.files[path];
      delete this.files[path];
      if (!entry) return;
      if (entry.type === "file") this.trigger("file-removed", path);
      else if (entry.type === "folder") this.trigger("folder-removed", path);
    }
  }

  return CapacitorAdapter;
}
