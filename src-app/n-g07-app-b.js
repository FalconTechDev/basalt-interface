// Clean-room app helpers (g07, part B): three-way merge via diff-match-patch.
import { env } from "./env.js";

/** `FX` — diff base→other, turn the result into patches and apply them to theirs. */
export function s10MergeText(base, other, theirs, host) {
  const dmp = new (env().dA)();
  const diffs = dmp.diff_main(base, other);
  dmp.diff_cleanupSemantic(diffs);
  if (diffs.length > 200) dmp.diff_cleanupEfficiency(diffs);
  const patches = dmp.patch_make(base, diffs);
  const applied = dmp.patch_apply(patches, theirs);
  return Array.isArray(applied) ? applied[0] : applied;
}
