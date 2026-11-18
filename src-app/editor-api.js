// Public `Editor` API (cP): the document/method surface plugins call on a
// markdown editor — line access, selections, block toggles (heading,
// blockquote, bullet/number/check lists), callout/codeblock/math insertion,
// list-aware newline continuation and text expansion.
// The low-level editor primitives (getLine, replaceRange, transaction, exec,
// posAtCoords, ...) live on the concrete CodeMirror-backed editor and are
// reached through `this`.

function pos(line, ch) {
  if (ch === undefined) ch = 0;
  return { line, ch };
}

function posPlus(point, offset) {
  return { line: point.line, ch: point.ch + offset };
}

function samePos(a, b) {
  return a.line === b.line && a.ch === b.ch;
}

function unique(list) {
  return Array.from(new Set(list));
}

const compareLineNumbers = (a, b) => a - b;

// /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/ — blockquote + list marker.
const LIST_LINE = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/;
// /^([>\s]*)(#{1,6} )?(.*)/ — heading.
const HEADING_LINE = /^([>\s]*)(#{1,6} )?(.*)/;
// /^\s{0,3}>(\s*)/ — leading blockquote marker.
const BLOCKQUOTE_PREFIX = /^\s{0,3}>(\s*)/;

// CJK/full-width bracket expansion for wikilinks.
const EXPANDERS = [
  { regex: /(！)?【【$/, replace: (match) => (match[1] ? "![[" : "[[") },
  { regex: /】】$/, replace: () => "]]" },
  { regex: /【【$/, replace: () => "[[" },
];

// Width of the blockquote prefix on a line, in characters (tabs expanded).
function blockquoteIndent(line) {
  const match = line.match(BLOCKQUOTE_PREFIX);
  if (!match) return 0;
  let width = match[0].length - match[1].length;
  let rest = match[1];
  while (rest.startsWith("    ")) rest = rest.substring(4);
  if (rest.startsWith(" ")) width += 1;
  return width;
}

export function defineEditor() {
  function Editor() {}

  Editor.prototype.getDoc = function () {
    return this;
  };

  Editor.prototype.setLine = function (line, text) {
    this.replaceRange(text, pos(line, 0), pos(line, this.getLine(line).length));
  };

  Editor.prototype.somethingSelected = function () {
    return !!this.getSelection();
  };

  Editor.prototype.setCursor = function (line, ch) {
    if (Number.isNumber(line)) return this.setSelection({ line, ch });
    return this.setSelection(line);
  };

  Editor.prototype.posAtMouse = function (event) {
    return this.posAtCoords(event.clientX, event.clientY);
  };

  Editor.prototype.insertText = function (text) {
    const lastLine = this.lineCount() - 1;
    let end = pos(lastLine, this.getLine(lastLine).length);
    this.replaceRange(text, end);
    const newLast = this.lineCount() - 1;
    end = pos(newLast, this.getLine(newLast).length);
    this.setSelection(end);
  };

  // Applies `lineFn`/`changeFn` to every selected line (or its deduped,
  // sorted line set). `skipBlank` skips empty lines in multi-selection.
  Editor.prototype.processLines = function (lineFn, changeFn, skipBlank) {
    if (skipBlank === undefined) skipBlank = true;
    const selections = this.listSelections();
    const lines = unique(selections.reduce((acc, sel) => {
      const from = Math.min(sel.anchor.line, sel.head.line);
      const to = Math.max(sel.anchor.line, sel.head.line);
      for (let i = from; i <= to; i++) acc.push(i);
      return acc;
    }, [])).sort(compareLineNumbers);
    const mapped = [];
    for (let i = 0; i < lines.length; i++) {
      const lineNo = lines[i];
      const lineText = this.getLine(lineNo);
      if (skipBlank && lines.length > 1 && !lineText.trim()) mapped.push(null);
      else mapped.push(lineFn(lineNo, lineText));
    }
    const changes = [];
    for (let i = 0; i < lines.length; i++) {
      const lineNo = lines[i];
      const mappedValue = mapped[i];
      const lineText = this.getLine(lineNo);
      if (!skipBlank || mappedValue !== null) {
        const change = changeFn(lineNo, lineText, mappedValue);
        if (change) changes.push(change);
      }
    }
    if (changes.length === 0) return;
    if (selections.length === 1) {
      const change = changes[0];
      const sel = selections[0];
      const anchor = sel.anchor;
      if (anchor.ch === 0 && samePos(anchor, sel.head) && anchor.line === change.from.line) {
        const delta = change.text.length - (change.to ? change.to.ch - change.from.ch : 0);
        anchor.ch += delta;
        if (anchor.ch < 0) anchor.ch = 0;
        this.transaction({ changes, selection: { from: anchor } });
        return;
      }
    }
    this.transaction({ changes });
  };

  Editor.prototype.setHeading = function (level) {
    this.processLines(
      (lineNo, text) => text.match(HEADING_LINE),
      (lineNo, text, match) => {
        const prefix = level === 0 ? "" : Array(level).fill("#").join("") + " ";
        return { from: pos(lineNo, match[1].length), to: pos(lineNo, text.length - match[3].length), text: prefix };
      },
    );
  };

  Editor.prototype.toggleBlockquote = function () {
    let allQuoted = false; // `e` in the original: becomes true once any line has a quote prefix
    this.processLines(
      (lineNo, text) => {
        const indent = blockquoteIndent(text);
        if (indent === 0) allQuoted = true;
        return indent;
      },
      (lineNo, text, indent) => {
        const width = indent;
        if (allQuoted && width === 0) return { from: pos(lineNo, 0), text: "> " };
        if (allQuoted) return undefined;
        return { from: pos(lineNo, 0), to: pos(lineNo, width), text: "" };
      },
      false,
    );
  };

  Editor.prototype.toggleBulletList = function () {
    let hasNonBullet = false;
    this.processLines(
      (lineNo, text) => {
        const match = text.match(LIST_LINE);
        if (!match[3] || match[4] || match[6]) hasNonBullet = true;
        return match;
      },
      (lineNo, text, match) => {
        if (!match) return null;
        return { from: pos(lineNo, 0), to: pos(lineNo, match[0].length), text: match[1] + (hasNonBullet ? "- " : "") };
      },
    );
  };

  Editor.prototype.toggleNumberList = function () {
    let hasNonNumber = false;
    this.processLines(
      (lineNo, text) => {
        const match = text.match(LIST_LINE);
        if (!match[4]) hasNonNumber = true;
        return match;
      },
      (lineNo, text, match) => {
        if (!match) return null;
        return { from: pos(lineNo, 0), to: pos(lineNo, match[0].length), text: match[1] + (hasNonNumber ? "1. " : "") };
      },
    );
  };

  Editor.prototype.toggleCheckList = function (check) {
    let state = 3;
    this.processLines(
      (lineNo, text) => {
        const match = text.match(LIST_LINE);
        if (state > 2 && match[6] === " ") state = 2;
        if (state > 1 && !match[6]) state = 1;
        if (check && state > 0 && !match[3]) state = 0;
        return match;
      },
      (lineNo, text, match) => {
        if (!match) return null;
        const marker = match[0];
        const prefix = match[1];
        const checkChar = match[3];
        const change = { from: pos(lineNo, 0), to: pos(lineNo, marker.length), text: text.substr(0, marker.length) };
        const base = prefix + (checkChar || "- ");
        change.text = base;
        if (state === 1) {
          if (!match[6]) change.text = base + "[ ] ";
        } else if (state === 2) {
          change.text = base + "[x] ";
        } else if (state === 3) {
          change.text = check ? base : base + "[ ] ";
        }
        return change;
      },
    );
  };

  Editor.prototype.insertCallout = function () {
    const from = this.getCursor("from");
    const to = this.getCursor("to");
    if (!samePos(from, to) || this.getLine(from.line).substring(0, from.ch).trim()) {
      const changes = [];
      let marker = "> [!NOTE]\n> ";
      const selection = { from: pos(from.line, 4), to: pos(from.line, 8) };
      if (from.line > 0 && this.getLine(from.line - 1)) {
        marker = "\n" + marker;
        selection.from.line += 1;
        selection.to.line += 1;
      }
      changes.push({ from: pos(from.line, 0), text: marker });
      for (let line = from.line + 1; line <= to.line; line++) {
        changes.push({ from: pos(line, 0), text: "> " });
      }
      if (to.line < this.lineCount() - 1 && this.getLine(to.line + 1)) {
        changes.push({ from: pos(to.line + 1, 0), text: "\n" });
      }
      this.transaction({ changes, selection });
    } else {
      this.transaction({
        changes: [{ from, to, text: "\n> [!NOTE] Title\n> Contents\n" }],
        selection: { from: pos(from.line + 1, 4), to: pos(from.line + 1, 8) },
      });
    }
  };

  Editor.prototype.insertCodeblock = function () {
    this.insertBlock("```", "```");
  };

  Editor.prototype.insertMathBlock = function () {
    this.insertBlock("$$", "$$");
  };

  Editor.prototype.indentList = function () {
    this.exec("indentMore");
  };

  Editor.prototype.unindentList = function () {
    this.exec("indentLess");
  };

  // Enter inside/at the edge of a markdown list continues the list marker,
  // handling blockquote prefixes, ordered renumbering and checkboxes.
  Editor.prototype.newlineAndIndentContinueMarkdownList = function () {
    const self = this;
    const selections = this.listSelections();
    const changes = [];
    const trySelection = (sel) => {
      const head = sel.head;
      if (sel.head.line !== sel.anchor.line || sel.head.ch !== sel.anchor.ch) return false;
      const lineText = self.getLine(head.line);
      const match = LIST_LINE.exec(lineText);
      if (!match || !match[0]) return false;
      let marker = match[0];
      let prefix = match[1];
      let markerGroup = match[2];
      let listMarker = match[3];
      let number = match[4];
      let delimiter = match[5];
      let checkState = match[6];
      const markerLength = marker.length;
      if (head.ch < markerLength || (!markerGroup && !prefix)) return false;
      if (!markerGroup) {
        // Bullet: look upwards for an enclosing ordered item of same width.
        for (let line = head.line - 1; line >= 0; line--) {
          const above = self.getLine(line);
          const aboveMatch = LIST_LINE.exec(above);
          if (aboveMatch[2] && aboveMatch[0].length === markerLength) {
            marker = aboveMatch[0];
            prefix = aboveMatch[1];
            markerGroup = aboveMatch[2];
            listMarker = aboveMatch[3];
            number = aboveMatch[4];
            delimiter = aboveMatch[5];
            checkState = aboveMatch[6];
            break;
          }
          if (aboveMatch[0].length < markerLength) break;
        }
      }
      const rest = lineText.substr(markerLength);
      if (rest.trim() === "") {
        if (!prefix) {
          changes.push({ text: "", from: pos(head.line), to: head });
          return true;
        }
        if (prefix.endsWith(">") || prefix.endsWith("> ")) {
          if (markerGroup) {
            changes.push({ text: "", from: pos(head.line, prefix.length), to: head });
            return true;
          }
          const trim = prefix.endsWith(">") ? 1 : 2;
          if (head.line > 0) {
            if (self.getLine(head.line - 1) === prefix) {
              changes.push(
                { text: "", from: pos(head.line - 1, prefix.length - trim), to: pos(head.line - 1, prefix.length) },
                { text: "", from: pos(head.line, prefix.length - trim), to: pos(head.line, prefix.length) },
              );
              return true;
            }
          }
          const parent = prefix.substr(0, prefix.length - trim);
          changes.push({ text: "\n" + parent, from: pos(head.line, prefix.length - trim), to: pos(head.line, prefix.length) });
          return true;
        }
        if (prefix.endsWith("\t")) {
          changes.push({ text: "", from: pos(head.line, prefix.length - 1), to: pos(head.line, prefix.length) });
          return true;
        }
        let spaces = 0;
        while (spaces < 4 && prefix.charAt(prefix.length - spaces - 1) === " ") spaces++;
        if (spaces > 0) {
          changes.push({ text: "", from: pos(head.line, prefix.length - spaces), to: pos(head.line, prefix.length) });
          return true;
        }
        changes.push({ text: "", from: pos(head.line), to: pos(head.line, prefix.length) });
        return true;
      }
      if (!markerGroup) {
        changes.push({ text: lineText.charAt(head.ch - 1) + "\n" + prefix, from: pos(head.line, head.ch - 1), to: head });
        return true;
      }
      let next = listMarker;
      if (number) next = parseInt(number, 10) + 1 + delimiter;
      if (checkState) next += "[ ] ";
      const trailing = LIST_LINE.exec(lineText.substring(head.ch));
      if (trailing && trailing[3]) next = "";
      changes.push({ text: lineText.charAt(head.ch - 1) + "\n" + prefix + next, from: pos(head.line, head.ch - 1), to: head });
      if (trailing && trailing[1]) {
        changes.push({ text: "", from: head, to: pos(head.line, head.ch + trailing[1].length) });
      }
      return true;
    };
    for (let i = 0; i < selections.length; i++) {
      if (!trySelection(selections[i])) return this.exec("newlineAndIndent");
    }
    this.transaction({ changes }, "input.type");
  };

  // Enter that only preserves leading whitespace (indent continuation).
  Editor.prototype.newlineAndIndentOnly = function () {
    const self = this;
    const selections = this.listSelections();
    const changes = [];
    const trySelection = (sel) => {
      const head = sel.head;
      if (sel.head.line !== sel.anchor.line || sel.head.ch !== sel.anchor.ch) return false;
      const lineText = self.getLine(head.line);
      const match = LIST_LINE.exec(lineText);
      if (!match || !match[0]) return false;
      const marker = match[0];
      const prefix = match[1];
      const markerGroup = match[2];
      if (head.ch < marker.length) return false;
      changes.push({
        text: lineText.charAt(head.ch - 1) + "\n" + prefix + (markerGroup ? markerGroup.replace(/\t/g, "    ").replace(/./g, " ") : ""),
        from: pos(head.line, head.ch - 1),
        to: head,
      });
      return true;
    };
    for (let i = 0; i < selections.length; i++) {
      if (!trySelection(selections[i])) return this.newlineOnly();
    }
    this.transaction({ changes });
  };

  Editor.prototype.newlineOnly = function () {
    this.transaction({ replaceSelection: "\n" });
  };

  // Expands trailing CJK brackets into wikilink syntax.
  Editor.prototype.expandText = function () {
    const anchor = this.getCursor("anchor");
    const head = this.getCursor("head");
    if (anchor.line === head.line && anchor.ch === head.ch) {
      const before = this.getLine(anchor.line).substr(0, anchor.ch);
      for (let i = 0; i < EXPANDERS.length; i++) {
        const expander = EXPANDERS[i];
        const match = before.match(expander.regex);
        if (match) {
          const length = match[0].length;
          const replacement = expander.replace(match);
          this.replaceRange(replacement, posPlus(anchor, -length), anchor);
          break;
        }
      }
    }
  };

  return Editor;
}
