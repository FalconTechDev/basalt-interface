// Clean-room app helpers (g07, part D): folder containment, movable-file
// filtering and the link-updating move.
import { env } from "./env.js";

function ng07IsHost(x) {
  return !!x && typeof x === "object" && (typeof x.displayTooltip === "function" || x.TFile !== undefined);
}

/**
 * `g$` — true when `entry` is a proper, non-root ancestor folder of `folder`.
 * Accepts both (entry, folder, host) and (app, entry, folder, host) call shapes.
 */
export function s10FolderContains(a, b, c, d) {
  let entry = a, folder = b;
  if (d !== undefined || ng07IsHost(c)) { entry = b; folder = c; }
  if (!entry || !folder || entry === folder) return false;
  if (typeof entry.isRoot === "function" && entry.isRoot()) return false;
  const ep = entry.path, fp = folder.path;
  if (typeof ep !== "string" || typeof fp !== "string" || !ep || !fp) return false;
  return fp.startsWith(ep + "/");
}

/** `b$` — deduplicated files that may be moved into `folder`. */
export function s10MovableFiles(files, folder, host) {
  const seen = new Set();
  const out = [];
  for (const file of files || []) {
    if (!file || seen.has(file.path)) continue;
    seen.add(file.path);
    if (file === folder || s10FolderContains(file, folder, host)) continue;
    out.push(file);
  }
  return out;
}

/** `v$` — move files into `folder`, updating links, skipping ones already inside. */
export function s10MoveFilesAndUpdateLinks(app, files, folder, host) {
  const run = async () => {
    const fm = app && app.fileManager;
    for (const file of files || []) {
      const fp = folder && folder.path;
      if (fp && typeof file.path === "string" && (file.path === fp || file.path.startsWith(fp + "/"))) continue;
      if (!app.vault || typeof app.vault.getAvailablePath !== "function" || typeof app.vault.rename !== "function") continue;
      const prefix = folder && typeof folder.getParentPrefix === "function" ? folder.getParentPrefix() : "";
      const base = file.extension ? file.basename : file.name;
      const target = app.vault.getAvailablePath(prefix + base, file.extension);
      if (target && target !== file.path) await app.vault.rename(file, target);
    }
  };
  const fm = app && app.fileManager;
  if (fm && typeof fm.runAsyncLinkUpdate === "function") return fm.runAsyncLinkUpdate(run);
  return run();
}
