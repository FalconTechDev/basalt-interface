// s22 slice: markdown preview post-processing — code/mermaid/math/embed element
// matching for the preview recycler, plus the mermaid renderer itself.
// Replaces inherited top-level functions and class-IIFE declarators.
import { env } from "./env.js";
import { s22LoadMermaidLib } from "./s22-lazy.js";


// ---- element <-> source-text maps (WeakMap so elements can be keyed directly) ----
// Xz in the bundle: code element -> its markdown source (used by codeText/codeTexts).
export const s22MermaidTextMap = new WeakMap();
// eq in the bundle: math element -> its TeX source.
export const s22MathTextMap = new WeakMap();

/** Source text of a code/mermaid element, cached on first read. */
export function s22CodeBlockText(el) {
  if (s22MermaidTextMap.has(el)) return s22MermaidTextMap.get(el);
  let text = el.getText();
  if (text.endsWith("\n")) text = text.substring(0, text.length - 1);
  s22MermaidTextMap.set(el, text);
  return text;
}

/** First "language-xxx" class of a code element, without the prefix. */
export function s22CodeLanguage(el) {
  return el.className.split(" ").filter((c) => c.startsWith("language-")).first();
}

/** Finds a rendered code block matching language + source inside the given sections. */
export function s22FindCodeBlock(sections, language, text) {
  for (const section of sections) {
    const blocks = section.el.findAll('code[class*="language-"].is-loaded');
    for (const block of blocks) {
      if (text === s22MermaidTextMap.get(block) && language === s22CodeLanguage(block)) return block;
    }
  }
  return null;
}

/** Finds a rendered math element matching source text and block/inline kind. */
export function s22FindMath(sections, text, isBlock) {
  for (const section of sections) {
    const maths = section.el.findAll(".math.is-loaded");
    for (const math of maths) {
      if (text === s22MathTextMap.get(math) && math.classList.contains("math-block") === isBlock) return math;
    }
  }
  return null;
}

/** True when every named attribute has the same value on both elements. */
export function s22SameAttributes(a, b, names) {
  for (const name of names) {
    if (a.getAttr(name) !== b.getAttr(name)) return false;
  }
  return true;
}

/** Finds a rendered internal embed matching the candidate's src/size/alt. */
export function s22FindInternalEmbed(sections, el) {
  for (const section of sections) {
    const embeds = section.el.findAll(".internal-embed.is-loaded");
    for (const embed of embeds) {
      if (s22SameAttributes(el, embed, ["src", "width", "height", "alt"])) return embed;
    }
  }
  return null;
}

/** Finds a fully loaded img matching src; copies width/height/alt onto it. */
export function s22FindImage(sections, img, source) {
  for (const section of sections) {
    const images = section.el.findAll("img");
    for (const image of images) {
      if (image.instanceOf(HTMLImageElement) && image.complete && source === image.src) {
        image.setAttr("width", img.getAttr("width"));
        image.setAttr("height", img.getAttr("height"));
        image.setAttr("alt", img.getAttr("alt"));
        return image;
      }
    }
  }
  return null;
}

/** Renders a callout icon: inline SVG markup, or a plain glyph via the icon font. */
export function s22RenderCalloutIcon(el, icon) {
  if (icon.startsWith("'") && icon.endsWith("'")) {
    icon = icon.substring(1, icon.length - 1).replace(/\\'/g, "'");
  } else if (icon.startsWith('"')) {
    try {
      const parsed = JSON.parse(icon);
      if (String.isString(parsed)) icon = parsed;
    } catch (e) { /* keep the raw text */ }
  }
  if (icon.startsWith("<svg")) {
    const svg = env().xL(icon).firstChild;
    if (svg && svg.instanceOf(SVGSVGElement)) {
      svg.setAttrs({ width: 16, height: 16, fill: "currentColor", stroke: "currentColor" });
      el.empty();
      el.appendChild(svg);
    }
  } else {
    env().tv(el, icon);
  }
}

/** data-href (or href) of a link element when it belongs to this preview. */
export function s22InternalLinkHref(el, section) {
  const href = el.getAttr("data-href") || el.getAttr("href");
  return href && env().Gz.belongsToMe(el, section) ? href : null;
}

/** Calls `cb` with the first child element when it is a heading. */
export function s22FirstHeading(el, cb) {
  const first = el.firstChild;
  if (first && first.instanceOf(HTMLHeadingElement)) cb(first);
}

/** Calls `cb` for every <li> that has a nested <ul>/<ol>. */
export function s22NestedListItems(el, cb) {
  const items = el.findAll("li");
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const nested = item.findAll("ul, ol");
    if (nested && nested.length > 0) cb(item);
  }
}

/** Element-array equality used by the table widget's incremental updates. */
export function s22RangesEqual(a, b) {
  if (a.length === b.length) return a.eq(b);
  if (a.length < b.length) return b.slice(0, a.length).eq(a);
  return a.slice(0, b.length).eq(b);
}

/**
 * Parses markdown into per-section html + source positions (the preview
 * recycler's unit of work). Each top-level node becomes one section; heading
 * nodes keep their depth as `level`, everything else gets level 7.
 */
export function s22ParseMarkdownSections(text) {
  const tree = env().Kx(text);
  const defs = { definitions: env().oT(tree) };
  const sections = [];
  const children = tree.children;
  const frontmatter = env().$x(tree);
  tree.children = [null];
  for (let idx = 0; idx < children.length; idx++) {
    const node = children[idx];
    let level = 7;
    if (node.type === "heading") level = node.depth || 1;
    env().jC(node, ["checklist", "listItem", "code"], (child) => {
      const data = (child.data = child.data || {});
      (data.hProperties = data.hProperties || {})["data-line"] = String(child.position.start.line - node.position.start.line);
    });
    tree.children[0] = node;
    const html = env().Zx(tree, defs);
    sections.push({ html, pos: env().hT(node.position), level });
  }
  return { sections, frontmatter };
}

// ---- mermaid rendering ----

/** Source text stored on a rendered mermaid block (used for recycler matching). */
export function s22FindMermaid(sections, text) {
  for (const section of sections) {
    const blocks = section.el.findAll(".mermaid");
    for (const block of blocks) {
      if (text === s22CodeBlockText(block)) return block;
    }
  }
  return null;
}

/** Renders one mermaid code element; replaces it with the generated SVG. */
export async function s22RenderMermaidDiagram(containerEl, codeEl) {
  const text = s22CodeBlockText(codeEl);
  const parent = codeEl.parentElement;
  const doc = codeEl.doc;
  let width = parent.clientWidth;
  if (width === 0) width = containerEl.clientWidth;
  if (width === 0) width = containerEl.win.innerWidth;
  const id = "m" + env().cc(16);
  const holder = document.body.createDiv("mermaid");
  holder.style.width = width + "px";
  holder.style.visibility = "hidden";
  holder.style.position = "absolute";
  try {
    const result = await mermaid.render(id, text, holder);
    const svg = result.svg;
    holder.detach();
    const rendered = env().createDiv("mermaid");
    rendered.innerHTML = svg;
    parent.replaceWith(rendered);
    s22MermaidTextMap.set(rendered, text);
    s22FixMermaidLinks(rendered, id);
  } catch (err) {
    const stale = doc.getElementById("d" + id);
    if (stale) stale.detach();
    holder.detach();
    console.error(err);
    codeEl.empty();
    codeEl.appendText("Error parsing Mermaid diagram!\n\n" + (err.str || err.message));
  }
}

/** Rewrites internal links and marker ids inside a rendered mermaid SVG. */
function s22FixMermaidLinks(root, idPrefix) {
  if (!(root instanceof Element)) return;
  // foreignObject labels become real links
  let labels = root.findAll('[*|class*="internal-link"] > g.label foreignObject > div');
  for (const label of labels) {
    const href = label.textContent;
    if (href) {
      label.empty();
      label.createEl("a", { cls: "internal-link", href, text: href });
    }
  }
  // collect every node once, then fix SVG anchor hrefs without a baseVal
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    stack.push(...Array.from(node.childNodes));
    if (node instanceof SVGAElement && node.href && !node.href.baseVal) {
      node.href.baseVal = node.getAttr("href");
    }
  }
  // uniquify marker ids referenced from the <style> block
  const style = root.find("style");
  if (!style) return;
  let css = style.innerHTML;
  const original = css;
  const markers = root.findAll("marker");
  for (const marker of markers) {
    const markerId = marker.id;
    if (!markerId) continue;
    const unique = idPrefix + "-" + markerId;
    marker.id = unique;
    for (const attr of ["marker-start", "marker-end"]) {
      const users = root.findAll("[" + attr + '="url(#' + markerId + ')"]');
      for (const user of users) user.setAttr(attr, "url(#" + unique + ")");
    }
    css = css.replace(new RegExp("#" + env().oc(markerId) + "(?!\\w|-)", "g"), "#" + unique);
  }
  if (css !== original) style.innerHTML = css;
}

/** Renders every mermaid code element inside `codeEls` once the library is loaded. */
export async function s22RenderMermaidBlocks(containerEl, codeEls) {
  await s22LoadMermaidLib().promise;
  const pending = [];
  for (const codeEl of codeEls) {
    if (codeEl.isShown() || containerEl.isShown()) pending.push(s22RenderMermaidDiagram(containerEl, codeEl));
    else codeEl.onNodeInserted(() => s22RenderMermaidDiagram(containerEl, codeEl), true);
  }
  if (pending.length > 0) await Promise.all(pending);
}
