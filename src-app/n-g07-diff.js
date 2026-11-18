// Clean-room app helpers (g07, part C): the `.diff-view` renderer.
// Pipeline: line-mode diff -> semantic cleanup -> pair deletes with inserts ->
// word-mode highlights inside changed pairs -> fold long unchanged runs.
import { env } from "./env.js";

const ng07Op = () => env().XD;

function ng07SplitLines(text) {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function ng07LineEl(doc, cls, text) {
  const el = doc.createElement("div");
  el.className = "diff-line" + (cls ? " " + cls : "");
  el.textContent = text;
  return el;
}

/** Word-level spans for one changed pair: removals struck, insertions marked. */
function ng07ChangedEl(doc, dmp, oldLine, newLine) {
  const row = doc.createElement("div");
  row.className = "diff-line mod-changed";
  const diffs = dmp.diff_main(oldLine, newLine);
  dmp.diff_cleanupSemantic(diffs);
  const frag = doc.createDocumentFragment();
  for (const [kind, text] of diffs) {
    if (!text) continue;
    const span = doc.createElement("span");
    if (kind === ng07Op().DIFF_DELETE) span.className = "diff-line-removed";
    else if (kind === ng07Op().DIFF_INSERT) span.className = "diff-line-added";
    span.textContent = text;
    frag.appendChild(span);
  }
  row.appendChild(frag);
  return row;
}

/** `RX` — renders old vs new text as a `.diff-view` element with foldable context. */
export function s10RenderDiffView(oldText, newText, host) {
  const doc = env().activeDocument || document;
  const dmp = new (env().dA)();
  const op = ng07Op();
  const a = oldText.endsWith("\n") ? oldText : oldText + "\n";
  const b = newText.endsWith("\n") ? newText : newText + "\n";
  const diffs = dmp.diff_lineMode(a, b);
  dmp.diff_cleanupSemantic(diffs);

  // flatten to typed lines, then pair each delete-run with the insert-run after it
  const seq = [];
  for (const [kind, text] of diffs) {
    const k = kind === op.DIFF_DELETE ? "del" : kind === op.DIFF_INSERT ? "ins" : "eq";
    for (const line of ng07SplitLines(text)) seq.push({ kind: k, text: line });
  }

  const root = doc.createElement("div");
  root.className = "diff-view";
  const KEEP_HEAD = 3, KEEP_TAIL = 3, FOLD_MIN = 9;

  let i = 0;
  while (i < seq.length) {
    if (seq[i].kind === "eq") {
      let j = i;
      while (j < seq.length && seq[j].kind === "eq") j++;
      const run = j - i;
      if (run <= FOLD_MIN) {
        for (let k = i; k < j; k++) root.appendChild(ng07LineEl(doc, "", seq[k].text));
      } else {
        const hidden = run - KEEP_HEAD - KEEP_TAIL;
        for (let k = i; k < i + KEEP_HEAD; k++) root.appendChild(ng07LineEl(doc, "", seq[k].text));
        const fold = doc.createElement("div");
        fold.className = "diff-collapsed";
        fold.textContent = hidden + " lines folded";
        const middle = seq.slice(i + KEEP_HEAD, j - KEEP_TAIL);
        fold.addEventListener("click", () => {
          for (const it of middle) fold.before(ng07LineEl(doc, "", it.text));
          fold.remove();
        });
        root.appendChild(fold);
        for (let k = j - KEEP_TAIL; k < j; k++) root.appendChild(ng07LineEl(doc, "", seq[k].text));
      }
      i = j;
      continue;
    }
    // changed region: gather del run then ins run
    const dels = [], inss = [];
    while (i < seq.length && seq[i].kind === "del") dels.push(seq[i++].text);
    while (i < seq.length && seq[i].kind === "ins") inss.push(seq[i++].text);
    const pairs = Math.min(dels.length, inss.length);
    for (let k = 0; k < pairs; k++) root.appendChild(ng07ChangedEl(doc, dmp, dels[k], inss[k]));
    for (let k = pairs; k < dels.length; k++) root.appendChild(ng07LineEl(doc, "mod-left", dels[k]));
    for (let k = pairs; k < inss.length; k++) root.appendChild(ng07LineEl(doc, "mod-right", inss[k]));
  }
  return root;
}
