// s22 slice: search-view helpers — showSearch capability check, the editor
// formatting menu builder and the matched-range span renderer.
import { env } from "./env.js";


/** True when the view exposes a showSearch() method (search can be opened on it). */
export function s22HasSearch(view) {
  const show = view.showSearch;
  return !!(show && typeof show === "function");
}

/**
 * Builds the formatting submenu used by editor context menus and the format pill.
 * `menu` is a Menu, `editor` the markdown editor wrapper, `state` the current
 * formatting state ({bold, italic, ...}) and `section` the menu section prefix.
 */
export function s22FormattingMenu(menu, editor, state, section) {
  const gm = env().gm;
  menu.setShowMacWritingTools(true);
  menu.addSections([section + ".basic", section + ".advanced", section + ".danger"]);
  menu.addItem((item) => {
    item
      .setSection(section)
      .setTitle(gm.interface.formatting.labelFormatting())
      .setIcon("lucide-paintbrush")
      .setSubmenu()
      .addItem((sub) =>
        sub
          .setSection(section + ".basic")
          .setTitle(gm.interface.formatting.toggleBold())
          .setChecked(state.bold)
          .setIcon("lucide-bold")
          .onClick(() => editor.toggleMarkdownFormatting("bold"))
      )
      .addItem((sub) =>
        sub
          .setSection(section + ".basic")
          .setTitle(gm.interface.formatting.toggleItalics())
          .setChecked(state.italic)
          .setIcon("lucide-italic")
          .onClick(() => editor.toggleMarkdownFormatting("italic"))
      )
      .addItem((sub) =>
        sub
          .setSection(section + ".basic")
          .setTitle(gm.interface.formatting.toggleStrikethrough())
          .setChecked(state.strikethrough)
          .setIcon("lucide-strikethrough")
          .onClick(() => editor.toggleMarkdownFormatting("strikethrough"))
      )
      .addItem((sub) =>
        sub
          .setSection(section + ".basic")
          .setTitle(gm.interface.formatting.toggleHighlight())
          .setChecked(state.highlight)
          .setIcon("lucide-highlighter")
          .onClick(() => editor.toggleMarkdownFormatting("highlight"))
      )
      .addItem((sub) =>
        sub
          .setSection(section + ".advanced")
          .setTitle(gm.interface.formatting.toggleCode())
          .setChecked(state.code)
          .setIcon("lucide-code-2")
          .onClick(() => editor.toggleMarkdownFormatting("code"))
      )
      .addItem((sub) =>
        sub
          .setSection(section + ".advanced")
          .setTitle(gm.interface.formatting.toggleMath())
          .setChecked(state.math)
          .setIcon("lucide-sigma")
          .onClick(() => editor.toggleMarkdownFormatting("math"))
      )
      .addItem((sub) =>
        sub
          .setSection(section + ".advanced")
          .setTitle(gm.interface.formatting.toggleComments())
          .setChecked(state.comment)
          .setIcon("lucide-percent")
          .onClick(() => editor.toggleComment())
      )
      .addItem((sub) =>
        sub
          .setSection(section + ".danger")
          .setTitle(gm.interface.formatting.clear())
          .setIcon("lucide-eraser")
          .onClick(() => editor.clearMarkdownFormatting())
      );
    return item;
  });
}

/**
 * Renders `text` into `el` as plain spans, wrapping every [start,end) range of
 * `matches` (clipped to [from,to)) in a `.search-result-file-matched-text` span.
 * Same output as renderMatchRanges, with the bundle's argument order
 * (el, text, matches, from, to).
 */
export function s22RenderMatchSpans(el, text, matches, from, to) {
  renderMatchRanges(el, text, from, to, matches);
}
