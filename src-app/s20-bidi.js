// s20: bidirectional-text support for the editor.
//   LI  textDirection: strip a leading list marker, then detect ltr/rtl/auto
//   II  the three `dir` mark decorations (auto / rtl / ltr)
//   OI  bidiDecorations: per-viewport-block direction decorations for an EditorView
//   FI  the CodeMirror view plugin that keeps them up to date

/** End offset of a leading `---` frontmatter block in a Text doc, or -1. */
function s20FrontmatterEnd(doc) {
  let end = -1;
  if (doc.line(1).text === "---") {
    for (let n = 2; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (line.text === "---") {
        end = line.to;
        break;
      }
    }
  }
  return end;
}

/** Direction of `text`: a leading blockquote/list marker is ignored first. */
export function s20TextDirection(text, host) {
  const marker = host.listLinePattern.exec(text);
  if (marker && marker[0]) text = text.slice(marker[0].length);
  return host.textDirectionOf(text);
}

/** The mark decorations applied for each direction value. */
export function s20BidiMarks(host) {
  return {
    auto: host.cmDecoration.line({ attributes: { dir: "auto" } }),
    rtl: host.cmDecoration.line({ attributes: { dir: "rtl" } }),
    ltr: host.cmDecoration.line({ attributes: { dir: "ltr" } }),
  };
}

/** Direction decorations for every visible line block of `view` (frontmatter excluded). */
export function s20BidiDecorations(view, host) {
  const doc = view.state.doc;
  const frontmatterEnd = s20FrontmatterEnd(doc);
  const marks = s20BidiMarks(host);
  const ranges = new host.s20CmRangeSet();
  let direction = "auto";
  const blocks = view.viewportLineBlocks;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.from < frontmatterEnd) continue;
    let dir = s20TextDirection(doc.sliceString(block.from, block.to), host);
    if (dir === "auto") dir = direction;
    ranges.add(block.from, block.from, marks[dir]);
    direction = dir;
  }
  return ranges.finish();
}

/** The view plugin: recomputes decorations when the doc or viewport changes. */
export function defineS20BidiPlugin(host) {
  return host.cmViewPlugin.define(
    (view) => ({
      deco: s20BidiDecorations(view, host),
      update(update) {
        if (update.docChanged || update.viewportChanged || update.heightChanged) {
          this.deco = s20BidiDecorations(update.view, host);
        }
      },
    }),
    { decorations: (plugin) => plugin.deco },
  );
}
