// Reading well-known properties (tags, aliases ...) out of parsed frontmatter.

const hasOwn = Object.prototype.hasOwnProperty;

/** Value of a frontmatter key given as exact name or as a regex matched against the keys; null if absent. */
export function frontmatterEntry(frontmatter, key) {
  if (!frontmatter) return null;
  if (typeof key === "string") return hasOwn.call(frontmatter, key) ? frontmatter[key] : null;
  for (const name in frontmatter) {
    if (hasOwn.call(frontmatter, name) && key.test(name)) return frontmatter[name];
  }
  return null;
}

/** A string or list-of-strings property as a trimmed string array (non-strings in lists are dropped); null otherwise. */
export function frontmatterStrings(frontmatter, key) {
  const value = frontmatterEntry(frontmatter, key);
  if (!value) return null;
  if (typeof value === "string") return [value.trim()];
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").map((v) => v.trim());
  return null;
}

/** The `tags` property as "#tag" strings (entries with spaces or empty ones are dropped). */
export function frontmatterTags(frontmatter) {
  if (!frontmatter) return null;
  const tags = frontmatterStrings(frontmatter, /^tags$/i);
  if (!tags) return tags;
  const kept = tags.filter((t) => !!t && !t.includes(" "));
  for (let i = 0; i < kept.length; i++) {
    if (kept[i].charAt(0) !== "#") kept[i] = "#" + kept[i];
  }
  return kept;
}

/** The `aliases` property without blank entries. */
export function frontmatterAliases(frontmatter) {
  const aliases = frontmatterStrings(frontmatter, /^aliases$/i);
  return aliases ? aliases.map((a) => a.trim()).filter((a) => !!a) : null;
}
