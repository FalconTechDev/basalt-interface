// s22 slice: weak-map compatibility shim and worker helpers.
// Rz picks window.WeakMap when present and falls back to a property-keyed map;
// Bz is a one-request-at-a-time RPC channel over a Worker; Vz/Hz build Workers
// from same-origin URLs or fetched blob URLs.
import { env } from "./env.js";


// ---- weak map fallback (used when window.WeakMap is missing) ----

/** Boxed WeakMap with the get/set/has/delete surface the app relies on. */
function S22WeakMapBox() {
  this.map = new WeakMap();
}
S22WeakMapBox.prototype.get = function (key) { return this.map.get(key); };
S22WeakMapBox.prototype.set = function (key, value) { this.map.set(key, value); return this; };
S22WeakMapBox.prototype.has = function (key) { return this.map.has(key); };
S22WeakMapBox.prototype.delete = function (key) { return this.map.delete(key); };

let s22WeakKeyCounter = 0;

/** Property-keyed stand-in for environments without WeakMap. */
function S22WeakMapFallback() {
  this._ = "_weakmap_" + s22WeakKeyCounter++;
}
S22WeakMapFallback.prototype.get = function (key) {
  return this.has(key) ? key[this._] : undefined;
};
S22WeakMapFallback.prototype.set = function (key, value) {
  Object.defineProperty(key, this._, { configurable: true, value });
  return this;
};
S22WeakMapFallback.prototype.has = function (key) {
  return Object.hasOwnProperty.call(key, this._);
};
S22WeakMapFallback.prototype.delete = function (key) {
  return this.has(key) && delete key[this._];
};

/** Creates the weak map flavour the runtime supports. */
export function s22CreateWeakMap() {
  return window.WeakMap ? new S22WeakMapBox() : new S22WeakMapFallback();
}

/** Class-IIFE replacements for the bundle's Oz/Nz weak-map classes. */
export function defineWeakMapBox() { return S22WeakMapBox; }
export function defineWeakMapFallback() { return S22WeakMapFallback; }

// ---- worker RPC ----

/** One in-flight request per channel; submit() resolves with the next worker message. */
export function defineWorkerChannel(host) {
  function WorkerChannel(worker) {
    this.promise = null;
    this.worker = worker;
    this.worker.onmessage = this.onReceiveMessageFromWorker.bind(this);
  }
  WorkerChannel.prototype.onReceiveMessageFromWorker = function (event) {
    if (this.promise) {
      const deferred = this.promise;
      this.promise = null;
      deferred.resolve(event.data);
    }
  };
  WorkerChannel.prototype.submit = function (message, transfer) {
    if (this.promise) return null;
    this.promise = env().gb();
    this.worker.postMessage(message, transfer);
    return this.promise.promise;
  };
  return WorkerChannel;
}

/** Fetches `url` and spins up a Worker from the response as a blob. */
export async function s22WorkerFromUrl(url, options) {
  const text = await env().ajaxPromise({ url });
  return new Worker(window.URL.createObjectURL(new Blob([text])), options);
}

/**
 * Creates a Worker for `url`: cross-origin (or unloadable) URLs go through the
 * blob route without options, everything else tries a direct Worker first.
 */
export async function s22CreateWorker(url, options) {
  try {
    if (new URL(url, document.baseURI).origin !== location.origin) return await s22WorkerFromUrl(url);
  } catch (e) { /* unparsable url: try direct */ }
  try {
    return new Worker(url, options);
  } catch (e) {
    return await s22WorkerFromUrl(url);
  }
}
