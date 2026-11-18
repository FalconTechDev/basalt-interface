// Small reading-mode helpers that the renderer and preview view call: unresolved-link marking,
// query-block embeds, embed depth lookup, the properties editor getter and the embed loader.
// The plain functions receive `__basaltHost` as their last argument (manifest entries with "host": true);
// the embed loader is a class entry and gets it from its factory like every other own class.
import { linkPath, parseLinktext } from "./path.js";

/** Marks every rendered internal link whose target does not resolve with "is-unresolved".
 *  `getHref` defaults to the renderer's own linktext extractor. */
export function updateUnresolvedLinks(app, el, sourcePath, getHref, host) {
  if (getHref === undefined) getHref = host.internalLinkHref;
  const links = el.findAll("a.internal-link");
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const href = getHref(link, el);
    if (href) link.toggleClass("is-unresolved", app.metadataCache.isUnresolved(linkPath(href), sourcePath));
  }
}

/** Replaces `el` with a query block: header (search icon + query) and a results container
 *  driven by the query-results component. Returns that component. */
export function renderQueryEmbed(app, query, el, sourcePath, host) {
  const box = createDiv("internal-query");
  el.replaceWith(box);
  box.createDiv("internal-query-header", (header) => {
    header.createSpan("internal-query-header-icon", (icon) => host.setIcon(icon, "lucide-search"));
    header.createSpan({ cls: "internal-query-header-title", text: query });
  });
  const resultsEl = box.createDiv("search-result-container");
  return new host.QueryResults(app, resultsEl, query, sourcePath);
}

/** Depth of the nearest embed container above `el` (0 when there is none). */
export function embedDepthAt(el, host) {
  for (; el; el = el.parentElement) {
    if (host.embedDepths.has(el)) return host.embedDepths.get(el);
  }
  return 0;
}

/** The metadata editor of the active markdown view, falling back to the properties plugin's
 *  ensured view for the active file. Resolves to null when neither is available. */
export async function propertiesPlugin(app, host) {
  const editor = host.activePropertiesEditor(app.workspace);
  if (editor) return editor;
  const file = app.workspace.getActiveFile();
  if (file && file.extension === "md") {
    const plugin = app.internalPlugins.getEnabledPluginById("properties");
    if (plugin) {
      const view = await plugin.ensurePropertiesView(file);
      if (view) return view.metadataEditor;
    }
  }
  return null;
}

/** `EmbedLoader.load(ctx)` resolves the linktext to a file, asks the embed registry for a
 *  specialised embed (nesting at most 5 deep) and falls back to the generic file embed or,
 *  for unresolved targets, the link embed. The depth is stored on the container so nested
 *  content can query it with `embedDepthAt`. */
export function defineEmbedLoader(host) {
  function EmbedLoader() {}
  EmbedLoader.load = function (ctx) {
    const app = ctx.app;
    const containerEl = ctx.containerEl;
    const linktext = ctx.linktext;
    const sourcePath = ctx.sourcePath;
    ctx.depth = ctx.depth + 1;
    containerEl.empty();
    let embed = null;
    const { path, subpath } = parseLinktext(linktext);
    const dest = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (dest) {
      const creator = app.embedRegistry.getEmbedCreator(dest);
      if (creator && ctx.depth <= 5) embed = creator(ctx, dest, subpath);
      if (!embed) embed = new host.FileEmbed(ctx, dest, subpath);
    }
    if (!embed) embed = new host.FallbackEmbed(ctx);
    containerEl.addClass("is-loaded");
    host.embedDepths.set(containerEl, ctx.depth);
    return embed;
  };
  return EmbedLoader;
}
