// g05 clean-room: generic ![[...]] embeds — media embeds (image/audio/video),
// the generic file embed, the fallback embed, the extension->creator registry,
// the video file view and the markdown note embed.
//
// The class bodies are shared with the s11 slice's factories (same observable
// contract, already clean-room); this module owns the manifest-wired exports
// and guarantees each factory runs once, in dependency order, through the kit
// cache below.
import { env } from "./env.js";
import { s11MediaEmbed, s11ImageEmbed, s11AudioEmbed, s11VideoEmbed, s11VideoView } from "./s11-media.js";
import { s11FileEmbed, s11FallbackEmbed, s11EmbedRegistry, s11MarkdownEmbed, s11ShowInlineError } from "./s11-embed.js";

/** Per-key cache so repeated factory calls return the same constructor. */
const ng05EmbedKit = {};
function ng05EmbedClass(host, key, make) {
  return ng05EmbedKit[key] || (ng05EmbedKit[key] = make(host));
}

/** `var QZ` — view type key shared by the video view and the view registry. */
export const ng05VideoViewType = "video";

/** `var ZZ` — per-element embed nesting depth map read by the embed loader. */
export const ng05EmbedDepths = new WeakMap();

/** `$Z` entry — wide error tooltip on an element, optionally auto-hidden. */
export function ng05ShowEmbedError(el, text, autoHide) {
  s11ShowInlineError(el, text, autoHide);
}

// The media base must exist before the typed embeds derive from it; the kit
// cache makes the pre-call idempotent.
function ng05MediaBase(host) {
  return ng05EmbedClass(host, "media", () => s11MediaEmbed(host));
}

/** `eJ` — base class of the media embeds; canvas code instanceof-checks it. */
export function ng05MediaEmbedClass(host) {
  return ng05MediaBase(host);
}

/** `tJ` — image embed registered for imageExtensions. */
export function ng05ImageEmbedClass(host) {
  ng05MediaBase(host);
  return ng05EmbedClass(host, "image", () => s11ImageEmbed(host));
}

/** `nJ` — audio embed registered for audioExtensions. */
export function ng05AudioEmbedClass(host) {
  ng05MediaBase(host);
  return ng05EmbedClass(host, "audio", () => s11AudioEmbed(host));
}

/** `iJ` — video embed registered for videoExtensions. */
export function ng05VideoEmbedClass(host) {
  ng05MediaBase(host);
  return ng05EmbedClass(host, "videoEmbed", () => s11VideoEmbed(host));
}

/** `rJ` — generic file embed used when no extension creator matches. */
export function ng05FileEmbedClass(host) {
  return ng05EmbedClass(host, "file", () => s11FileEmbed(host));
}

/** `oJ` — fallback embed for unresolved link targets. */
export function ng05FallbackEmbedClass(host) {
  return ng05EmbedClass(host, "fallback", () => s11FallbackEmbed(host));
}

/** `aJ` — app.embedRegistry: extension -> embed creator map + plugin API. */
export function ng05EmbedRegistryClass(host) {
  // The markdown creator closes over the markdown embed class slot; building
  // it here (idempotent) keeps the slot populated before any embed loads.
  ng05EmbedClass(host, "markdown", () => s11MarkdownEmbed(host));
  return ng05EmbedClass(host, "registry", () => s11EmbedRegistry(host));
}

/** `XZ` — the "video" file view registered for videoExtensions. */
export function ng05VideoViewClass(host) {
  return ng05EmbedClass(host, "videoView", () => s11VideoView(host));
}

/** `lJ` — the markdown note embed (![[note]], ![[note#heading]]). */
export function ng05MarkdownEmbedClass(host) {
  return ng05EmbedClass(host, "markdown", () => s11MarkdownEmbed(host));
}
