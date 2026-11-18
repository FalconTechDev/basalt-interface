// Clean-room app helpers (g07, part A): publish xhr/response status probes,
// preload-style promotion, file-name validation and the error tooltip.
import { env } from "./env.js";

const ng07ExplorerT = () => env().gm.plugins.fileExplorer;

/** `mX` — does an xhr-like object carry a usable obs-status response header? */
export function s10XhrHasObsStatus(xhr) {
  if (!xhr || typeof xhr.getResponseHeader !== "function") return true;
  const header = xhr.getResponseHeader("obs-status");
  return header !== null && header !== undefined;
}

/** `vX` — same probe for a fetch Response; missing headers count as present. */
export function s10ResponseHasObsStatus(response) {
  if (!response || !response.headers || typeof response.headers.get !== "function") return true;
  const header = response.headers.get("obs-status");
  return header !== null && header !== undefined;
}

/** `gX` — turn deferred stylesheet preloads into real stylesheet links. */
export function s10PromotePreloadStyles() {
  const doc = env().activeDocument || document;
  const links = doc.querySelectorAll('link[rel="preload"][as="style"]');
  for (const link of links) {
    link.rel = "stylesheet";
    link.onload = null;
    link.removeAttribute("onload");
  }
  const placeholders = doc.querySelectorAll(".preload");
  for (const node of placeholders) node.remove();
}

/** `LX` — localized validation for a new/renamed vault item name; "" means ok. */
export function s10ValidateFileName(app, item, name, allowEmpty, host) {
  const t = ng07ExplorerT();
  const forbidden = env().UT;
  forbidden.lastIndex = 0;
  if (forbidden.test(name)) return t.msgInvalidCharacters() + env().qT;
  if (name === "") return allowEmpty ? "" : t.msgEmptyFileName();
  if (name.startsWith(".")) return t.msgBadDotfile();
  if (app && app.vault && typeof app.vault.checkForDuplicate === "function" && item && app.vault.checkForDuplicate(item, name)) {
    return t.msgFileAlreadyExists();
  }
  return "";
}

/** `IX` — wide red tooltip used for inline validation errors. */
export function s10ShowErrorTooltip(el, message, host) {
  host.displayTooltip(el, message, { classes: ["mod-wide", "mod-error"] });
}
