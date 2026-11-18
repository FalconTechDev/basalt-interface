// s20: link-text helpers.
//   fI  wikilink pattern used when rewriting a link after a rename
//   jL  writes `value` at the nested path `keys` inside `obj` (mutates `keys`)
//   TL  dragLinkText: the markdown link text dropped onto the editor for a drag payload
//   WL  rewriteLinkText: updates one link reference when its target file was renamed

import { parseLinktext, linkPath, escapeLinkChars, plainSpaces, displayName, withoutMd, baseName } from "./path.js";
import { linkSafeHeading } from "./text.js";
import { s05IsValidFileName } from "./s05-utils.js";
import { fileClass } from "./vault.js";

const TFile = () => fileClass("TFile");

/** Matches a whole `[[target|alias]]` (or `![[...]])`) wikilink. */
export const s20WikiLinkPattern = /^(!?\[\[)(.*?)(\|(.*))?(]])$/;

/**
 * Sets `obj[path[0]][path[1]]... = value`, creating nothing on the way.
 * `keys` is consumed (shifted) while descending.
 */
export function s20SetDeepValue(obj, keys, value) {
  while (obj && keys.length) {
    const key = keys.shift();
    if (Array.isArray(obj)) {
      const index = parseInt(key);
      if (isNaN(index) || index < 0 || index >= obj.length) return;
      if (!keys.length) {
        obj[index] = value;
        return;
      }
      obj = obj[index];
    } else {
      if (typeof obj !== "object") return;
      if (!keys.length) {
        obj[key] = value;
        return;
      }
      obj = obj[key];
    }
  }
}

/**
 * Markdown link text for a drag payload `data` dropped at `sourcePath`.
 * `markdownLinks` (i) makes image files embed with a leading `!`.
 */
export function s20DragLinkText(app, data, sourcePath, markdownLinks, host) {
  const fileManager = app.fileManager;
  const vault = app.vault;
  function linkFor(file, subpath, alias) {
    const text = fileManager.generateMarkdownLink(file, sourcePath, subpath, alias);
    return markdownLinks && host.isImageExtension(file.extension) ? "!" + text : text;
  }
  if (data.type === "file") return [linkFor(data.file)];
  if (data.type === "files") {
    const out = [];
    for (const file of data.files) {
      if (file instanceof TFile()) out.push(linkFor(file));
    }
    return out;
  }
  if (data.type === "link") {
    if (data.file) {
      const subpath = parseLinktext(data.linktext).subpath;
      return [linkFor(data.file, subpath)];
    }
    return [data.linktext];
  }
  if (data.type === "heading") {
    const subpath = "#" + linkSafeHeading(data.heading.heading);
    return [linkFor(data.file, subpath)];
  }
  if (data.type === "bookmarks") {
    const out = [];
    for (const entry of data.items) {
      const item = entry.item;
      if (item.type === "file") {
        const file = vault.getAbstractFileByPath(item.path);
        if (file instanceof TFile()) out.push(linkFor(file, item.subpath, item.title));
      }
    }
    return out;
  }
  return [];
}

/**
 * Rewrites the link `ref` ({ original, link }) so it points at `newPath` instead of the renamed file.
 * Returns the new link text (the `original` field rewritten), or `ref.original` unchanged.
 */
export function s20RewriteLinkText(ref, newPath, host) {
  const original = ref.original;
  const link = ref.link;
  const wiki = original.match(s20WikiLinkPattern);
  let result;
  let alias;
  if (wiki) {
    const bang = wiki[1];
    const target = wiki[2];
    const pipePart = wiki[4];
    alias = pipePart === undefined ? "" : pipePart;
    const tail = wiki[5];
    if (alias) {
      const pipe = /\\\|/.test(original) ? "\\|" : "|";
      if (target.contains("/")) {
        const trimmed = alias.trim();
        if (baseName(target) === trimmed) alias = baseName(linkPath(newPath));
      }
      result = bang + newPath + pipe + alias + tail;
    } else {
      result = bang + newPath + tail;
    }
  } else {
    const md = original.match(host.s20MdLinkPattern);
    const destination = !md || !md[5].startsWith("<") ? escapeLinkChars(newPath) : "<" + newPath + ">";
    if (md) {
      let text = md[2];
      const plain = plainSpaces(text).trim();
      const oldDisplay = displayName(linkPath(link));
      if (plain === oldDisplay) text = displayName(linkPath(newPath));
      else if (plain.contains("/") && plain === withoutMd(linkPath(link))) text = withoutMd(linkPath(newPath));
      result = md[1] + text + md[3] + destination + (md[6] ?? "") + md[8];
    } else {
      result = "[](".concat(destination, ")");
      if (original.startsWith("!")) result = "!" + result;
    }
  }
  return result;
}
