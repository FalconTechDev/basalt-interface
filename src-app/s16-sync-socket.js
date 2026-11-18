// s16 slice: the sync WebSocket client — handshake, heartbeat, request/response and
// binary data channels, plus the pull/push/list/history/restore/user/purge/size calls.
import { extensionOf, lastSegment } from "./path.js";
import { s16WebSocket, s16UrlClass, s16UrlHostnameGetter, s16EndsWith, s16CloseCodes } from "./s16-constants.js";

const CHUNK_SIZE = 2 * 1024 * 1024; // server push/pull pieces are 2 MiB
const REQUEST_TIMEOUT = 60000;
const HEARTBEAT_INTERVAL = 20000;
const HEARTBEAT_PING_AFTER = 10000;
const HEARTBEAT_DROP_AFTER = 120000;

function s16Deferred() {
  const d = { promise: null, resolve: null, reject: null };
  d.promise = new Promise((resolve, reject) => {
    d.resolve = resolve;
    d.reject = reject;
  });
  return d;
}

function closeCodeText(code) {
  if (code >= 0 && code <= 999) return "(Unused)";
  if (code >= 1016) {
    if (code <= 1999) return "(For WebSocket standard)";
    if (code <= 2999) return "(For WebSocket extensions)";
    if (code <= 3999) return "(For libraries and frameworks)";
    if (code <= 4999) return "(For applications)";
  }
  return Object.prototype.hasOwnProperty.call(s16CloseCodes, code) ? s16CloseCodes[code] : "(Unknown)";
}

/** hee: SyncSocket — one websocket to the sync server with JSON control + binary data frames. */
export function defineSyncSocket(host) {
  function SyncSocket(encryptionProvider) {
    this.socket = null;
    this.queue = new host.SerialTaskQueue();
    this.notifyQueue = new host.SerialTaskQueue();
    this.perFileMax = 208666624;
    this.userId = -1;
    this.justPushed = null;
    this.encryptionProvider = encryptionProvider;
  }

  const proto = SyncSocket.prototype;

  proto.isConnecting = function () {
    const socket = this.socket;
    return socket && socket.readyState === s16WebSocket.CONNECTING;
  };

  proto.isConnected = function () {
    const socket = this.socket;
    return socket && socket.readyState === s16WebSocket.OPEN;
  };

  proto.hasConnection = function () {
    return !!this.socket;
  };

  /**
   * Opens the socket and performs the init handshake. Resolves once the server accepted
   * the login (`res:"ok"`); rejects with a descriptive error otherwise.
   */
  proto.connect = function (url, token, id, version, initial, device, onReady, onPush) {
    return (async () => {
      if (this.hasConnection()) return;
      this.onReady = onReady;
      this.onPush = onPush;
      const keyHash = this.encryptionProvider.keyHash;
      await new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          this.disconnect();
          reject(error);
        };
        const parsed = new s16UrlClass(url);
        const hostName = s16UrlHostnameGetter.call(parsed);
        if (!s16EndsWith.call(hostName, ".basalt.md") && hostName !== "127.0.0.1") {
          return reject(new Error("Unable to connect to server."));
        }
        const socket = this.socket = new s16WebSocket(parsed);
        socket.binaryType = "arraybuffer";
        socket.onclose = (event) => {
          if (event.code === 1006) fail(new Error("Unable to connect to server."));
          else fail(new Error("Disconnected. Code: " + event.code + " " + closeCodeText(event.code)));
        };
        socket.onopen = () => {
          this.lastMessageTs = Date.now();
          this.heartbeat = window.setInterval(() => {
            const idle = Date.now() - this.lastMessageTs;
            if (idle > HEARTBEAT_DROP_AFTER) this.disconnect();
            else if (idle > HEARTBEAT_PING_AFTER) this.send({ op: "ping" });
          }, HEARTBEAT_INTERVAL);
          this.send({
            op: "init",
            token,
            id,
            keyhash: keyHash,
            version,
            initial,
            device,
            encryption_version: this.encryptionProvider.encryptionVersion,
          });
        };
        socket.onmessage = (event) => {
          const data = event.data;
          if (typeof data !== "string") return fail(new Error("Server returned binary"));
          let message;
          try {
            message = JSON.parse(data);
          } catch (error) {
            console.error(error);
            return fail(new Error("Server JSON failed to parse: " + data));
          }
          if (message.op === "pong") return;
          if (message.status === "err" || message.res === "err") return fail(new Error("Failed to authenticate: " + message.msg));
          if (message.res !== "ok") return fail(new Error("Did not respond to login request: " + data));
          if (Object.prototype.hasOwnProperty.call(message, "perFileMax")) {
            const perFileMax = message.perFileMax;
            if (!Number.isInteger(perFileMax) || isNaN(perFileMax) || perFileMax < 0) {
              return fail(new Error("Unexpected value from server for max file size"));
            }
            this.perFileMax = perFileMax;
          }
          if (message.userId) this.userId = message.userId;
          resolve();
          settled = true;
          socket.onmessage = this.onMessage.bind(this);
          socket.onclose = this.disconnect.bind(this);
          socket.onerror = this.disconnect.bind(this);
        };
      });
    })();
  };

  proto.disconnect = function () {
    if (this.socket) this.socket.close();
    this.socket = null;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    const error = new Error("Disconnected");
    if (this.responsePromise) {
      this.responsePromise.reject(error);
      this.responsePromise = null;
    }
    if (this.dataPromise) {
      this.dataPromise.reject(error);
      this.dataPromise = null;
    }
  };

  /** Downloads a file body: JSON pieces metadata, then `size` binary chunks, decrypted. */
  proto.pull = function (uid) {
    return (async () => {
      return this.queue.queue(async () => {
        this.lastNetworkRequestTs = Date.now();
        const meta = await this.request({ op: "pull", uid });
        if (meta.deleted) return null;
        const size = meta.size;
        const pieces = meta.pieces;
        const buffer = new ArrayBuffer(size);
        let offset = 0;
        for (let i = 0; i < pieces; i++) {
          const chunk = await this.dataResponse();
          new Uint8Array(buffer, offset, chunk.byteLength).set(new Uint8Array(chunk));
          offset += chunk.byteLength;
        }
        let data = buffer;
        if (buffer.byteLength > 0) data = await this.encryptionProvider.decrypt(buffer);
        return data;
      });
    })();
  };

  /** Uploads a file: metadata request, then the (encrypted) content in binary pieces. */
  proto.push = function (path, relatedPath, folder, deleted, ctime, mtime, hash, content) {
    return (async () => {
      return this.queue.queue(async () => {
        this.lastNetworkRequestTs = Date.now();
        const encPath = await this.encryptionProvider.deterministicEncodeStr(path);
        let encRelated = null;
        if (relatedPath) encRelated = await this.encryptionProvider.deterministicEncodeStr(relatedPath);
        const ext = folder ? "" : extensionOf(lastSegment(path));
        if (folder || deleted) {
          this.justPushed = { path: encPath, folder, deleted, mtime: 0, hash: "" };
          await this.request({ op: "push", path: encPath, relatedpath: encRelated, extension: ext, hash: "", ctime: 0, mtime: 0, folder, deleted });
          return;
        }
        if (content.byteLength > 0) content = await this.encryptionProvider.encrypt(content);
        let encHash = null;
        if (hash) encHash = await this.encryptionProvider.deterministicEncodeStr(hash);
        const size = content.byteLength;
        const pieces = Math.ceil(size / CHUNK_SIZE);
        this.justPushed = { path: encPath, folder, deleted, mtime, hash: encHash };
        const meta = await this.request({
          op: "push",
          path: encPath,
          relatedpath: encRelated,
          extension: ext,
          hash: encHash,
          ctime,
          mtime,
          folder,
          deleted,
          size,
          pieces,
        });
        if (meta.res === "ok") {
          this.justPushed = null;
          return;
        }
        for (let i = 0; i < pieces; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(CHUNK_SIZE, size - start);
          this.sendBinary(new Uint8Array(content, start, end));
          await this.response();
        }
        this.justPushed = null;
      });
    })();
  };

  /** Lists remotely deleted paths (decrypting each path). */
  proto.listDeleted = function () {
    return (async () => {
      return this.queue.queue(async () => {
        const result = await this.request({ op: "deleted", suppressrenames: true });
        const items = result.items;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          item.path = await this.encryptionProvider.deterministicDecodeStr(item.path);
        }
        return items;
      });
    })();
  };

  /** Version history for one path; decrypts path and relatedpath of every entry. */
  proto.listHistory = function (path, last) {
    return (async () => {
      return this.queue.queue(async () => {
        const encPath = await this.encryptionProvider.deterministicEncodeStr(path);
        const result = await this.request({ op: "history", path: encPath, last });
        const items = result.items;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          item.path = await this.encryptionProvider.deterministicDecodeStr(item.path);
          if (item.relatedpath) item.relatedpath = await this.encryptionProvider.deterministicDecodeStr(item.relatedpath);
        }
        return result;
      });
    })();
  };

  proto.restore = function (uid) {
    return this.queue.queue(() => this.request({ op: "restore", uid }));
  };

  proto.getUsernames = function () {
    return this.queue.queue(() => this.request({ op: "usernames" }));
  };

  proto.purge = function () {
    return this.queue.queue(() => this.request({ op: "purge" }));
  };

  proto.size = function () {
    return this.queue.queue(() => this.request({ op: "size" }));
  };

  /** Server-initiated push: decrypts path/hash, flags echoes of our own just-pushed file. */
  proto.onServerPush = function (message) {
    const justPushed = this.justPushed;
    if (justPushed
      && justPushed.path === message.path
      && justPushed.folder === message.folder
      && justPushed.deleted === message.deleted
      && justPushed.mtime === message.mtime
      && justPushed.hash === message.hash) {
      this.justPushed = null;
      message.wasJustPushed = true;
    }
    return this.notifyQueue.queue(async () => {
      message.path = await this.encryptionProvider.deterministicDecodeStr(message.path);
      if (message.hash) message.hash = await this.encryptionProvider.deterministicDecodeStr(message.hash);
      this.onPush(message);
    });
  };

  proto.response = function () {
    return (this.responsePromise = s16Deferred()).promise;
  };

  proto.dataResponse = function () {
    return (this.dataPromise = s16Deferred()).promise;
  };

  /** Sends a JSON request and waits for its response (rejects after `timeout` ms). */
  proto.request = function (message, timeout) {
    timeout = timeout === undefined ? REQUEST_TIMEOUT : timeout;
    return (async () => {
      const deferred = this.responsePromise = s16Deferred();
      this.send(message);
      const timeoutError = new Error("Timeout");
      const timer = window.setTimeout(() => deferred.reject(timeoutError), timeout);
      try {
        const response = await deferred.promise;
        clearTimeout(timer);
        if (response.err) throw new Error(response.err);
        return response;
      } catch (error) {
        if (error === timeoutError) this.disconnect();
        throw error;
      }
    })();
  };

  proto.onMessage = function (event) {
    this.lastMessageTs = Date.now();
    if (typeof event.data === "string") {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        console.log(event.data);
        this.disconnect();
        return;
      }
      const op = message.op;
      if (op === "pong") return;
      if (op === "ready") {
        this.onReady(message.version);
        return;
      }
      if (op === "push") {
        this.onServerPush(message);
        return;
      }
      const deferred = this.responsePromise;
      if (deferred) {
        this.responsePromise = null;
        deferred.resolve(message);
      }
    } else {
      const deferred = this.dataPromise;
      if (deferred) {
        this.dataPromise = null;
        deferred.resolve(event.data);
      }
    }
  };

  proto.send = function (message) {
    this.socket.send(JSON.stringify(message));
  };

  proto.sendBinary = function (data) {
    this.socket.send(data);
  };

  return SyncSocket;
}
