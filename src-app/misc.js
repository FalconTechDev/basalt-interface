// Small numeric, array, date, colour, binary and geometry helpers.

// ---------- numbers ----------

/** Smaller of two (the second one when they compare equal or are unordered). */
export function smaller(a, b) { return a < b ? a : b; }
/** Larger of two (the second one when they compare equal or are unordered). */
export function larger(a, b) { return a > b ? a : b; }

/** Perceptual-slider mapping: (t^(1-x) - t) / (1 - t). */
export function sliderCurve(x, t) { return (Math.pow(t, 1 - x) - t) / (1 - t); }
/** Inverse of sliderCurve. */
export function sliderCurveInverse(x, t) { return 1 - Math.log(x * (1 - t) + t) / Math.log(t); }

/** [0, 1/n, 2/n, ... 1]. */
export function unitSteps(n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(i / n);
  return out;
}

/** Random lowercase hex string of the given length. */
export function randomHex(length) {
  let out = "";
  for (let i = 0; i < length; i++) out += ((16 * Math.random()) | 0).toString(16);
  return out;
}

// ---------- arrays ----------

/** Array.isArray(v) ? v : [v]. */
export function asArray(v) { return Array.isArray(v) ? v : [v]; }

/** Distinct values, first occurrence wins. */
export function distinct(list) { return Array.from(new Set(list)); }

/** Moves list[from] to index `to` in place and returns the list. */
export function moveItem(list, from, to) {
  const item = list[from];
  list.splice(from, 1);
  list.splice(to, 0, item);
  return list;
}

/** Removes and returns the first item matching the predicate, null when none. */
export function takeFirst(list, test) {
  const at = list.findIndex((x) => test(x));
  return at < 0 ? null : list.splice(at, 1)[0];
}

/** Binary search with a three-way probe (0 found, <0 look left, >0 look right); the item or null. */
export function binaryFind(list, probe) {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const item = list[mid];
    const way = probe(item);
    if (way === 0) return item;
    if (way < 0) hi = mid - 1; else lo = mid + 1;
  }
  return null;
}

/** True when the value is an array of strings (null/undefined entries ignored when `lenient`). */
export function isStringArray(value, lenient = false) {
  if (!Array.isArray(value)) return false;
  const items = lenient ? value.filter((v) => v != null) : value;
  return items.every((v) => typeof v === "string");
}

/** Concatenation that avoids copying when one side is empty. */
export function joinLists(a, b) {
  if (!a.length) return b;
  return b.length ? a.concat(b) : a;
}

/** Window of an undo history: the last `keep` entries before index `at`, plus `entry`. */
export function pushHistory(history, at, keep, entry) {
  const from = at + 1 > keep + 20 ? at - keep - 1 : 0;
  const out = history.slice(from, at);
  out.push(entry);
  return out;
}

/** Shallow list equality using ===. */
export function sameItems(a, b) {
  return a == b || (a.length == b.length && a.every((x, i) => x === b[i]));
}

/** List equality with a custom comparer. */
export function sameItemsBy(a, b, eq) {
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
  return true;
}

/** Sorts items by their index in `order` (unknown ids go last). */
export function sortByOrder(items, order) {
  const rank = new Map(order.map((id, i) => [id, i]));
  return items.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

/** Penalty for a match list used when ordering suggestions. */
export function matchPenalty(matches) {
  return matches ? -(matches.length + (matches.length > 0 ? matches[0][0] / 10 : 0)) : 0;
}

// ---------- dates ----------

/** Two digits, zero padded. */
export function twoDigits(n) { return String(n).padStart(2, "0"); }
const two = twoDigits;

/** "2024-03-07" in local time. */
export function localDate(d) {
  return `${String(d.getFullYear()).padStart(4, "0")}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** "09:05:03" in local time. */
export function localTime(d) {
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}


// ---------- colour ----------

/** Hex byte "0a". */
export function hexByte(n) {
  const h = n.toString(16);
  return h.length === 1 ? "0" + h : h;
}

/** {r,g,b} -> "#rrggbb". */
export function rgbToHex({ r, g, b }) { return "#" + hexByte(r) + hexByte(g) + hexByte(b); }

/** {r,g,b} -> 0xrrggbb. */
export function rgbToInt({ r, g, b }) { return (r << 16) | (g << 8) | b; }

/** True for colours that need dark text on top. */
export function isLightColor({ r, g, b }) { return (299 * r + 587 * g + 114 * b) / 1000 >= 150; }

function hueToChannel(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + 6 * (q - p) * t;
  if (t < 0.5) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** {h: 0-360, s: 0-100, l: 0-100} -> {r,g,b} (0-255). */
export function hslToRgb({ h, s, l }) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s == 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToChannel(p, q, h + 1 / 3);
    g = hueToChannel(p, q, h);
    b = hueToChannel(p, q, h - 1 / 3);
  }
  return { r: Math.round(255 * r), g: Math.round(255 * g), b: Math.round(255 * b) };
}

/** {r,g,b} (0-255) -> {h,s,l} with integer degrees / percents. */
export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const l = (hi + lo) / 2;
  let h, s;
  if (hi == lo) {
    h = s = 0;
  } else {
    const d = hi - lo;
    s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo);
    switch (hi) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(360 * h), s: Math.round(100 * s), l: Math.round(100 * l) };
}

const HEX_COLOR = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;
const RGB_TRIPLE = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/i;

/** "#aabbcc" / "aabbcc" -> {r,g,b}, null if not a hex colour. */
export function parseHexColor(text) {
  const m = HEX_COLOR.exec(text);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

/** "12, 34, 56" -> "#0c2238"; anything else is returned unchanged. */
export function rgbTripleToHex(text) {
  const m = text.match(RGB_TRIPLE);
  return m ? rgbToHex({ r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) }) : text;
}

// ---------- binary ----------

/** "00ff10" -> ArrayBuffer. */
export function hexToBuffer(hex) {
  const n = hex.length / 2;
  const buf = new ArrayBuffer(n);
  const view = new Uint8Array(buf);
  for (let i = 0; i < n; i++) view[i] = parseInt(hex.substr(2 * i, 2), 16);
  return buf;
}

/** ArrayBuffer -> "00ff10". */
export function bufferToHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] >>> 4).toString(16) + (bytes[i] & 15).toString(16);
  return out;
}

/** String made of the given char codes. */
export function stringFromCodes(codes) { return String.fromCharCode.apply(String, Array.from(codes)); }

/** Big-endian signed 32-bit read. */
export function readInt32BE(bytes, at) { return (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]; }
/** Little-endian signed 32-bit read. */
export function readInt32LE(bytes, at) { return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24); }

/** Copy of exactly the bytes a typed array views. */
export function ownBuffer(view) { return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength); }

/** Fills with zero, returns the array. */
export function zeroFill(list) {
  for (let i = 0; i < list.length; i++) list[i] = 0;
  return list;
}

/** dst[i] ^= src[i]. */
export function xorInto(dst, src) { for (let i = 0; i < src.length; i++) dst[i] ^= src[i]; }

/** Clears the top bit of two bytes (ed25519-style clamp helper). */
export function clearTopBits(bytes) {
  bytes[bytes.length - 8] &= 127;
  bytes[bytes.length - 4] &= 127;
}

/** fs.Stats -> {ctime, mtime, size} (birth time in ms). */
export function statFromNode(st) { return { ctime: Math.round(st.birthtimeMs), mtime: Math.round(st.mtimeMs), size: st.size }; }
/** Capacitor-style stat -> {ctime, mtime, size}. */
export function statFromCapacitor(st) { return { ctime: Math.round(st.ctime), mtime: Math.round(st.mtime), size: st.size }; }

// ---------- geometry ----------

export const point = (x, y) => ({ x, y });
export const rect = (x, y, width, height) => ({ x, y, width, height });
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const rectAt = (origin, size) => rect(origin.x, origin.y, size.width, size.height);
export const pointOfEvent = (e) => point(e.clientX, e.clientY);
export const box = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });
export const boxOfPoints = (a, b) => box(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
export const boxOfRect = (r) => box(r.x, r.y, r.x + r.width, r.y + r.height);
export const rectOfBox = (b) => rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
export const boxContains = (a, b) => a.minX <= b.minX && a.minY <= b.minY && a.maxX >= b.maxX && a.maxY >= b.maxY;
export const boxCenter = (b) => point((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
export const centeredOrigin = (p, size) => point(p.x - size.width / 2, p.y - size.height / 2);
export const boxX = (p) => p.x;
export const boxY = (p) => p.y;

/** Smallest box around many boxes (an inverted infinite box for none). */
export function boxUnion(boxes) {
  const out = box(Infinity, Infinity, -Infinity, -Infinity);
  for (const b of boxes) {
    out.minX = Math.min(out.minX, b.minX);
    out.minY = Math.min(out.minY, b.minY);
    out.maxX = Math.max(out.maxX, b.maxX);
    out.maxY = Math.max(out.maxY, b.maxY);
  }
  return out;
}

/** The box grown by `by` on every side. */
export function boxGrow(b, by) { return box(b.minX - by, b.minY - by, b.maxX + by, b.maxY + by); }

/** Four corners plus centre of a box. */
export function boxPoints(b) {
  const { minX, minY, maxX, maxY } = b;
  return [point(minX, minY), point(minX, maxY), point(maxX, minY), point(maxX, maxY), point((minX + maxX) / 2, (minY + maxY) / 2)];
}

/** Midpoint of one side ("top" | "right" | "bottom" | "left") of a box; undefined for other names. */
export function sideMidpoint(b, side) {
  switch (side) {
    case "top": return point((b.minX + b.maxX) / 2, b.minY);
    case "right": return point(b.maxX, (b.minY + b.maxY) / 2);
    case "bottom": return point((b.minX + b.maxX) / 2, b.maxY);
    case "left": return point(b.minX, (b.minY + b.maxY) / 2);
  }
}

/** `p` moved `by` pixels out of a side. */
export function pushOut(side, p, by) {
  switch (side) {
    case "left": return { x: p.x - by, y: p.y };
    case "right": return { x: p.x + by, y: p.y };
    case "top": return { x: p.x, y: p.y - by };
    case "bottom": return { x: p.x, y: p.y + by };
  }
}

/** Distinct, sorted (x then y) corner/centre points of many boxes. */
export function sortedBoxPoints(boxes) {
  const all = [].concat(...boxes.map(boxPoints));
  all.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const out = [];
  let prev = null;
  for (const p of all) {
    if (prev && prev.x === p.x && prev.y === p.y) continue;
    prev = p;
    out.push(p);
  }
  return out;
}

/** Bezier edge between two anchor points leaving through the given sides. */
export function bezierEdge(from, fromSide, to, toSide) {
  const dist = distance(from, to);
  const reach = Math.min(Math.max(dist / 2, 70), 150);
  const c1 = pushOut(fromSide, from, reach);
  const c2 = pushOut(toSide, to, reach);
  return { from, to, cp1: c1, cp2: c2, path: `M${from.x},${from.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${to.x},${to.y}` };
}

/** Sorts an array in place by a numeric key. */
export function sortByKey(list, key) { list.sort((a, b) => key(a) - key(b)); }

/** Sorts search hits by descending score. */
export function sortHitsByScore(hits) { hits.sort((a, b) => b.match.score - a.match.score); }

/** Adds an offset to every [from, to] pair, in place. */
export function shiftRanges(ranges, by) {
  if (ranges) for (const r of ranges) { r[0] += by; r[1] += by; }
}

// ---------- clipboard / urls ----------

/** True when `value` parses as an absolute URL. */
export function isUrl(value) {
  if (!value) return false;
  try { new URL(value); } catch (e) { return false; }
  return true;
}

/** Copies `text` to the clipboard (execCommand fallback where the async API is missing). */
export function copyText(text) {
  if (navigator.clipboard && navigator.permissions) {
    navigator.clipboard.writeText(text);
  } else {
    const area = activeDocument.createElement("textarea");
    area.value = text;
    area.style.top = "0";
    area.style.left = "0";
    area.style.position = "fixed";
    activeDocument.body.appendChild(area);
    try {
      area.focus({ preventScroll: true });
      area.select();
      activeDocument.execCommand("copy");
    } catch (e) {}
    activeDocument.body.removeChild(area);
  }
}

/** Runs `callback` now when `el` is already laid out, otherwise once it is inserted (and shown). */
export function focusWhenShown(el, callback) {
  if (el.isShown()) callback();
  else el.onNodeInserted(callback, true);
}

/** Locale-aware "sort" comparator used for user-visible name lists. */
export const stringCollator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });
