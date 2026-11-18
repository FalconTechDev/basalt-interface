// s20: frontmatter helpers.
//   vI  mergeFrontmatter: run `mutate` on the parsed frontmatter of `text` and write it back
//   gI  linkUpdateForRename: the metadataCache link update produced when `resolvedFile` moved
//   yI  deepMerge: merges `patch` into `target` (arrays concat+unique, objects recurse)
//   bI  splitFrontmatter: { content, frontmatter } of a note
//   wI  frontmatterText: an object serialised as a `---` block ("" when empty)
//   kI  setFrontmatter: replaces the frontmatter of `text` with `frontmatter`

import { frontmatterBounds } from "./notes-utils.js";
import { parseLinktext } from "./path.js";
import { s20RewriteLinkText, s20WikiLinkPattern } from "./s20-links.js";

/**
 * Parses the frontmatter of `text`, hands the object to `mutate`, and serialises it back.
 * An emptied object removes the block; a missing one is prepended.
 */
export function s20MergeFrontmatter(text, mutate, host) {
  const bounds = frontmatterBounds(text);
  let data = bounds.exists ? host.parseYaml(bounds.frontmatter) : {};
  if (!data || typeof data !== "object") data = {};
  mutate(data);
  if (Object.keys(data).length === 0) return bounds.exists ? text.slice(bounds.contentStart) : text;
  const yaml = host.yamlStringify(data);
  return bounds.exists ? text.slice(0, bounds.from) + yaml + text.slice(bounds.to) : "---\n" + yaml + "---\n" + text;
}

function samePaths(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * For a link `change` record ({ reference, sourceFile, resolvedPaths, resolvedFile }) checks whether the
 * rename changed where the link resolves; returns the update to apply or undefined.
 */
export function s20LinkUpdateForRename(change, metadataCache, host) {
  const reference = change.reference;
  const sourceFile = change.sourceFile;
  const resolvedPaths = change.resolvedPaths;
  const sourcePath = sourceFile.path;
  const parsed = parseLinktext(reference.link);
  const linkPath = parsed.path;
  const subpath = parsed.subpath;
  const now = metadataCache.getLinkpathDest(linkPath, sourcePath).map((file) => file.path);
  if (now.length === 0 || samePaths(resolvedPaths, now)) return undefined;
  const wiki = s20WikiLinkPattern.test(reference.original);
  const newLink = metadataCache.fileToLinktext(change.resolvedFile, sourcePath, wiki) + subpath;
  if (reference.link === newLink) return undefined;
  return { sourcePath, reference, change: s20RewriteLinkText(reference, newLink, host) };
}

/** Recursive merge of `patch` into `target`: arrays concatenate (deduped), plain objects recurse, scalars overwrite. */
export function s20DeepMerge(target, patch) {
  if (Object.keys(patch).length === 0) return;
  for (const key in patch) {
    if (!patch.hasOwnProperty(key)) continue;
    const current = target.hasOwnProperty(key) ? target[key] : undefined;
    const value = patch[key];
    if (current) {
      if (Array.isArray(current) && Array.isArray(value)) target[key] = current.concat(value).unique();
      else if (typeof current === "object" && value !== null && typeof value === "object") s20DeepMerge(current, value);
      else if (value !== null) target[key] = value;
    } else {
      target[key] = value;
    }
  }
}

/** Splits `text` into { content, frontmatter } where frontmatter is the parsed object ({} when absent/invalid). */
export function s20SplitFrontmatter(text, host) {
  let frontmatter = {};
  const bounds = frontmatterBounds(text);
  const content = text.slice(bounds.contentStart);
  if (bounds.frontmatter) frontmatter = host.parseYaml(bounds.frontmatter);
  return { content, frontmatter };
}

/** Serialises a frontmatter object as a `---` fenced yaml block; "" for an empty/missing object. */
export function s20FrontmatterText(frontmatter, host) {
  let text = "";
  if (frontmatter && Object.keys(frontmatter).length > 0) {
    const yaml = host.yamlStringify(frontmatter).trim();
    text = "---\n" + yaml + "\n---\n";
  }
  return text;
}

/** Replaces whatever frontmatter `text` has with `frontmatter` (removing it when empty). */
export function s20SetFrontmatter(text, frontmatter, host) {
  const block = s20FrontmatterText(frontmatter, host);
  const contentStart = frontmatterBounds(text).contentStart;
  return block + text.slice(contentStart);
}
