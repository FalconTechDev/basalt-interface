// Constants and lazy plugin-i18n references of the bases/canvas/mobile slices.
// The `gm.*` objects are the app's lazy translation proxies; they are read through env()
// at the same program point the original `var X = gm.plugins...` statements ran, so the
// captured values are identical.
import { env } from "./env.js";

// ---------- view / property kind tags ----------

export const s13ViewCards = "cards";
export const s13ViewList = "list";
export const s13ViewTable = "table";
export const s13ViewBase = "base";
export const s13PropBullet = "bullet";
export const s13PropSeparator = "separator";
export const s13PropIndentProperties = "indentProperties";
export const s13PropMarkers = "markers";
export const s13AudioMime = "audio/mp4";
export const s13BookmarksId = "bookmarks";

// ---------- numeric tuning constants ----------

export const s13RowHeightDefault = 400;
export const s13ZoomDefault = 0.7;
export const s13ZoomStep = 0.01;
export const s13ZoomOffset = 0.93;
export const s13ZoomPanOffset = -1.7;

// ---------- lazy i18n/plugin object accessors ----------

/** The bases plugin's shared i18n table (gm.plugins.bases). */
export function s13BasesI18n() { return env().gm.plugins.bases; }
/** gm.plugins.bases.cards */
export function s13BasesCardsI18n() { return env().gm.plugins.bases.cards; }
/** gm.plugins.bases.list */
export function s13BasesListI18n() { return env().gm.plugins.bases.list; }
/** gm.plugins.bases.table */
export function s13BasesTableI18n() { return env().gm.plugins.bases.table; }
/** gm.plugins.bookmarks */
export function s13BookmarksI18n() { return env().gm.plugins.bookmarks; }
/** gm.plugins.canvas */
export function s13CanvasI18n() { return env().gm.plugins.canvas; }
/** gm.plugins.fileExplorer */
export function s13FileExplorerI18n() { return env().gm.plugins.fileExplorer; }
/** gm.plugins.quickSwitcher */
export function s13QuickSwitcherI18n() { return env().gm.plugins.quickSwitcher; }
/** gm.interface */
export function s13InterfaceI18n() { return env().gm.interface; }
