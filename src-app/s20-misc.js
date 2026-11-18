// s20: small top-level values and helpers of the application scope.
//   SL  DOMPurify options used when sanitising rendered HTML
//   DL  the HTML comment prefix written before generated content
//   LL/IL/OL/FL  accepted date / date-time shapes (daily notes, templates)
//   VL  path-length comparator for suggestion sorting
//   ML  keeps only the allowed tokens of a space/newline separated attribute
//   xL  sanitise an HTML string and return it as a DOM fragment

// DOMPurify options: allow iframes (embeds), keep a few embed attributes, drop <style>.
export const s20SanitizeOptions = {
  ALLOW_UNKNOWN_PROTOCOLS: true,
  RETURN_DOM_FRAGMENT: true,
  FORBID_TAGS: ["style"],
  ADD_TAGS: ["iframe"],
  ADD_ATTR: ["frameborder", "allowfullscreen", "allow", "sandbox", "data-tooltip-position"],
};

export const s20HtmlCommentPrefix = "<!-- basalt -->";

export const s20DayFormats = ["YYYY-MM-DD"];

export const s20DateTimeFormats = [
  "YYYY-MM-DD[T]HH:mm:ss",
  "YYYY-MM-DD[T]HH:mm",
  "YYYY-MM-DD HH:mm:ss",
  "YYYY-MM-DD HH:mm",
];

export const s20DayPattern = /^\d{4}-[01]\d-[0-3]\d$/;

export const s20DateTimePattern = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/;

/** Shorter paths sort first (used for file suggestion ordering). */
export const s20PathLengthCompare = (a, b) => a.path.length - b.path.length;

/** Removes every token of `attr` that is not a key of `allowed`; rewrites the attribute only when it changed. */
export function s20FilterClasses(el, attr, separator, allowed) {
  const current = el.getAttribute(attr);
  const kept = [];
  const parts = current.split(separator);
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i].trim().toLowerCase();
    if (allowed.hasOwnProperty(token) && allowed[token]) kept.push(token);
  }
  const next = kept.join(separator);
  if (next !== current) el.setAttribute(attr, next);
}

/** Sanitise `html` with the shared DOMPurify instance and import the result as a document fragment. */
export function s20SanitizeHtml(html, host) {
  return document.importNode(host.s20Dompurify.sanitize(html, s20SanitizeOptions), true);
}
