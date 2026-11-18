// s04: own implementation of the Capacitor filesystem bridge (was `pk`).
//
// Wraps the native `Dm` plugin (env-bound) with the directory/URI bookkeeping
// the vault adapter needs. Binary writes above the inline threshold are
// streamed to disk in 1 MiB base64 chunks so large files do not blow the IPC
// payload limit. `window.FS` keeps exposing this class for compatibility.

import { env } from "./env.js";
import { collapseSlashes } from "./path.js";

/** Chunk size for streamed binary writes (was `hk`). */
const S04_FS_CHUNK = 5 * 1024 * 1024;
/** Per-append chunk size for large binary writes. */
const S04_FS_APPEND_CHUNK = 1024 * 1024;

/** Normalizes plugin errors so missing files carry an ENOENT code (was `uk`). */
async function s04FsCall(promise) {
  try {
    return await promise;
  } catch (error) {
    const message = error.message;
    if (message && (message.includes("does not exist") || message.includes("there is no such file"))) {
      error.code = "ENOENT";
    }
    throw error;
  }
}

/** Uint8Array/ArrayBuffer -> base64 (was `Ef`/`Mf`). */
function s04FsBytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.byteLength; i++) binary += String.fromCharCode(view[i]);
  return window.btoa(binary);
}

/** Own implementation of the Capacitor filesystem bridge. */
export function s04CapacitorFs(host) {
  class CapacitorFs {
    constructor(dir) {
      this.uri = "";
      this.dir = dir;
    }

    async init() {
      const result = await env().Dm.getUri({ directory: this.dir, path: "" });
      this.uri = result.uri;
    }

    watch(path) {
      return env().Dm.startWatch({ directory: this.dir, path });
    }

    verifyIcloud(path) {
      return env().Dm.verifyIcloud({ path });
    }

    async read(path) {
      const result = await s04FsCall(env().Dm.readFile({ directory: this.dir, path, encoding: "utf8" }));
      return result.data;
    }

    async readBinary(path) {
      const stat = await s04FsCall(this.stat(path));
      if (stat.size < S04_FS_CHUNK) {
        const result = await s04FsCall(env().Dm.readFile({ directory: this.dir, path }));
        return host.base64ToBuffer(result.data);
      }
      const response = await fetch(this.getUri(path));
      return response.arrayBuffer();
    }

    write(path, data) {
      return s04FsCall(env().Dm.writeFile({ directory: this.dir, path, data, encoding: "utf8" }));
    }

    writeBinary(path, data) {
      return s04FsCall(this.writeBinaryInternal(path, data, false));
    }

    appendBinary(path, data) {
      return s04FsCall(this.writeBinaryInternal(path, data, true));
    }

    async writeBinaryInternal(path, data, append) {
      const dir = this.dir;
      if (data.byteLength < S04_FS_CHUNK) {
        if (append) {
          await env().Dm.appendFile({ directory: dir, path, data: s04FsBytesToBase64(data) });
        } else {
          await env().Dm.writeFile({ directory: dir, path, data: s04FsBytesToBase64(data) });
        }
        return;
      }
      if (!append) await env().Dm.writeFile({ directory: dir, path, data: "" });
      try {
        let offset = 0;
        while (offset < data.byteLength) {
          const length = Math.min(S04_FS_APPEND_CHUNK, data.byteLength - offset);
          const chunk = new Uint8Array(data, offset, length);
          await env().Dm.appendFile({ directory: dir, path, data: s04FsBytesToBase64(chunk) });
          offset += length;
        }
      } catch (error) {
        if (!append) await env().Dm.deleteFile({ directory: dir, path });
        throw error;
      }
    }

    append(path, data) {
      return s04FsCall(env().Dm.appendFile({ directory: this.dir, path, data, encoding: "utf8" }));
    }

    mkdir(path) {
      return s04FsCall(env().Dm.mkdir({ directory: this.dir, path, recursive: true }));
    }

    async readdir(path) {
      const result = await s04FsCall(env().Dm.readdir({ directory: this.dir, path }));
      return result.files;
    }

    stat(path) {
      return s04FsCall(env().Dm.stat({ directory: this.dir, path }));
    }

    watchAndStatAll(path) {
      return s04FsCall(env().Dm.watchAndStatAll({ directory: this.dir, path }));
    }

    async exists(path) {
      try {
        await this.stat(path);
        return true;
      } catch (error) {
        return false;
      }
    }

    setTimes(path, ctime, mtime) {
      return s04FsCall(env().Dm.setTimes({ directory: this.dir, path, ctime, mtime }));
    }

    rmdir(path) {
      return s04FsCall(env().Dm.rmdir({ directory: this.dir, path, recursive: true }));
    }

    delete(path) {
      return s04FsCall(env().Dm.deleteFile({ directory: this.dir, path }));
    }

    rename(from, to) {
      return s04FsCall(env().Dm.rename({ directory: this.dir, from, to }));
    }

    copy(from, to) {
      return s04FsCall(env().Dm.copy({ directory: this.dir, from, to }));
    }

    open(path) {
      return s04FsCall(env().Dm.open({ directory: this.dir, path }));
    }

    trash(path) {
      return s04FsCall(env().Dm.trash({ directory: this.dir, path }));
    }

    getNativeUri(path) {
      path = collapseSlashes(path);
      let uri = this.uri;
      if (path === "/") return uri;
      if (!uri.endsWith("/")) uri += "/";
      return uri + path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    }

    getUri(path) {
      let uri = this.getNativeUri(path);
      if (uri.startsWith("file://")) uri = host.s04CapacitorCore.Ii.convertFileSrc(uri);
      return uri;
    }
  }

  return CapacitorFs;
}
