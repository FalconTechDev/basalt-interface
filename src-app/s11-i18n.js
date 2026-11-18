// Lazily-evaluated i18n string tables. The bundle keeps aliases like `DZ = gm.pdf`;
// own code resolves the same tables through env() at call time.
import { env } from "./env.js";

export function s11PdfStrings() { return env().gm.pdf; }
export function s11SearchStrings() { return env().gm.plugins.search; }
export function s11GraphStrings() { return env().gm.plugins.graphView; }
export function s11BookmarkStrings() { return env().gm.plugins.bookmarks; }
export function s11WebViewerStrings() { return env().gm.plugins.webViewer; }
