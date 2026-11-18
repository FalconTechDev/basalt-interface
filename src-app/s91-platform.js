// s91 platform glue: the lazy node `require` shim, Electron IPC helpers
// (file read, URL fetch, PDF printing, context menu), macOS vibrancy and
// webview detection, plus the dev/version flag initializers and snapshots.
import { randomHex } from "./misc.js";
import { env } from "./env.js";

// webcrypto subtle handle captured at startup (was `xf`).
export function s91CryptoSubtle() {
  return window.crypto.subtle;
}

// The renderer's node require, captured at startup (was `Lf`).
export function s91WindowRequire() {
  return window.require;
}

// require("x") when the node bridge is present, else undefined (was `If`).
export function s91Require(name) {
  const req = env().s91require;
  return req ? req(name) : undefined;
}

// Run `cb` with the electron module when it can be required (was `Of`).
export function s91WithElectron(cb) {
  const electron = s91Require("electron");
  if (electron) cb(electron);
}

// Read a file through node fs when it exists, else null (was `Ff`).
export async function s91ReadFileIfExists(file) {
  const fs = s91Require("fs");
  if (fs && fs.existsSync(file)) return await fs.promises.readFile(file);
  return null;
}

// Fetch a URL through the main process (was `Nf`).
export function s91FetchUrl(url) {
  return new Promise((resolve, reject) => {
    const electron = s91Require("electron");
    if (!electron) throw new Error("Not electron");
    const ipc = electron.ipcRenderer;
    const channel = randomHex(16);
    ipc.once(channel, (event, message) => {
      if (message.body) resolve(message);
      else reject(message.error);
    });
    ipc.send("request-url", channel, url);
  });
}

// Ask the main process to print the webContents to PDF (was `jf`).
export function s91PrintToPdf(electron, options) {
  return new Promise((resolve) => {
    const ipc = electron.ipcRenderer;
    ipc.once("print-to-pdf", resolve);
    ipc.send("print-to-pdf", options);
  });
}

// True on macOS (was `Uf`).
export function s91IsMacOS() {
  return "darwin" === process.platform;
}

// macOS-only window chrome: transparent background + optional sidebar vibrancy (was `Wf`).
export function s91SetVibrancy(win, sidebar) {
  if ("darwin" === process.platform) {
    win.setBackgroundColor("#00000000");
    if (sidebar) win.setVibrancy("sidebar");
    else win.setVibrancy(null);
  }
}

// True for <webview> elements (was `_f`).
export function s91IsWebviewElement(el) {
  return "WebViewElement" === el.constructor.name;
}

// Right-click menu info over IPC for trusted events on electron windows (was `Gf`).
export async function s91ContextMenuInfo(evt) {
  const win = evt.win;
  const electron = window.electron;
  if (!electron || !evt.isTrusted) return null;
  evt.stopPropagation();
  evt.stopImmediatePropagation();
  return await new Promise((resolve) => {
    const timer = win.setTimeout(() => resolve(null), 1000);
    const ipc = electron.ipcRenderer;
    ipc.once("context-menu", (event, result) => {
      win.clearTimeout(timer);
      resolve(result);
    });
    ipc.send("context-menu");
  });
}

// Initial values for the dev flag / electron version / major version vars;
// the inherited startup callback overwrites them when electron is present.
export function s91DevFlagInit() {
  return false;
}
export function s91ElectronVersionInit() {
  return "0.0.0";
}
export function s91ElectronMajorInit() {
  return 0;
}

// Point-in-time copies taken after the startup callback ran.
export function s91DevFlagSnapshot(value) {
  return value;
}
export function s91VersionSnapshot(value) {
  return value;
}
export function s91MajorSnapshot(value) {
  return value;
}
