// TableCellEditor: the nested CodeMirror editor used for editing a single
// table cell. Extends the app CodeMirror editor component, syncs vim mode with
// the parent editor, and routes cell navigation keys (arrows/tab/enter) into
// the owning table widget's cell API.

import { inherit, methods } from "./inherit.js";

// lZ: current vim mode name from a CM5 adapter state, "" when vim is off.
function vimModeOf(cm5, host) {
  const vim = cm5.state.vim;
  return vim && vim.mode != null ? vim.mode : "";
}

// sZ: push the parent editor's vim mode into the cell editor (or vice versa).
function syncVimMode(cm5, from, to, host) {
  if (from !== to) {
    if (String(from).includes("insert")) host.vimApi.enterInsertMode(cm5);
    else host.vimApi.exitInsertMode(cm5, true);
  }
}

export function defineTableCellEditor(host) {
  const readOnlyCompartment = new host.cmCompartmentClass();
  const Base = host.CodeMirrorEditor;

  function TableCellEditor(component, containerEl, table, cell) {
    const self = Base.call(this, component.app, containerEl, component.owner) || this;
    self.editorEl.removeClass("markdown-source-view");
    self.sourceMode = false;
    self.table = table;
    self.cell = cell;
    self.set(host.parseTableCellText(cell.text).result);
    const vimMain = component.cm.plugin(host.vimKeymapClass);
    const vimCell = self.cm.plugin(host.vimKeymapClass);
    if (vimMain && vimCell) {
      self.containerEl.win.setTimeout(() => {
        syncVimMode(vimCell.cm, vimModeOf(vimMain.cm, host), vimModeOf(vimCell.cm, host), host);
        vimCell.cm.on("vim-mode-change", () => {
          syncVimMode(vimMain.cm, vimModeOf(vimCell.cm, host), vimModeOf(vimMain.cm, host), host);
        });
      }, 0);
    }
    if (host.Platform.isIosApp) containerEl.createSpan({ attr: { contenteditable: "true" } });
    containerEl.dataset.ignoreSwipe = "true";
    return self;
  }
  inherit(TableCellEditor, Base);

  methods(TableCellEditor, {
    onunload() {
      Base.prototype.onunload.call(this);
      this.destroy();
    },

    onUpdate(update, prev) {
      Base.prototype.onUpdate.call(this, update, prev);
      for (const tr of update.transactions) {
        if ((!tr.docChanged && !tr.selection) || tr.annotation(host.tableUpdateAnnotation) || tr.isUserEvent("set")) continue;
        this.table.dispatchUpdate(this, tr);
      }
    },

    buildLocalExtensions() {
      const self = this;
      const exts = Base.prototype.buildLocalExtensions.call(this);
      exts.push(host.tableCellLanguage);

      // i: vim "get next table position" — move between cells on arrow keys.
      const nextTablePos = (editorView, range, dir) => {
        const state = editorView.state, doc = state.doc, line = doc.lineAt(range.head);
        if (dir === "up" || dir === "down") {
          const next = line.number + (dir === "down" ? 1 : -1);
          if (next > 1 && next < doc.lines) return false;
        } else {
          const pos = range.head + (dir === "end" ? 1 : -1);
          if (pos >= 0 && pos < line.length) return false;
        }
        self.table.trimCell(self.cell);
        self.containerEl.win.setTimeout(() => {
          if (dir === "up") moveUp();
          else if (dir === "down") moveDown();
          else if (dir === "start") moveStart(editorView);
          else if (dir === "end") moveEnd(editorView);
        }, 10);
        return true;
      };

      const moveUp = () => {
        const table = self.table, cell = self.cell, above = table.getCellAbove(cell);
        if (above) table.placeCursorInCell(above, "last-line");
        else table.placeCursorAround("before");
      };
      const moveDown = () => {
        const table = self.table, cell = self.cell, below = table.getCellBelow(cell);
        if (below) table.placeCursorInCell(below, "start");
        else table.placeCursorAround("after");
      };
      // a: flip start/end when the target cell's text direction differs.
      const flipForRtl = (view, cellWidget, pos) => {
        const rtl = view.textDirection === host.textDirectionEnum.RTL;
        const cellRtl = host.textDirectionOf(cellWidget.text) === "rtl";
        if (rtl === cellRtl) return pos;
        return pos === "end" ? "start" : "end";
      };
      const moveStart = (view) => {
        const table = self.table, cell = self.cell, next = table.getNextCell(cell, "start");
        if (next) table.placeCursorInCell(next, flipForRtl(view, next, "end"));
        else table.placeCursorAround("before");
      };
      const moveEnd = (view) => {
        const table = self.table, cell = self.cell, next = table.getNextCell(cell, "end");
        if (next) table.placeCursorInCell(next, flipForRtl(view, next, "start"));
        else table.placeCursorAround("after");
      };

      // c: plain arrow navigation inside the cell (no selection).
      const navCell = (view, dir) => {
        const state = view.state, sel = state.selection, doc = state.doc;
        if (sel.ranges.length > 1) return false;
        const table = self.table, cell = self.cell;
        const head = table.selectionHead;
        if (head) {
          const bounds = table.getSelectionBounds();
          const minRow = bounds.minRow, minCol = bounds.minCol, maxRow = bounds.maxRow, maxCol = bounds.maxCol;
          table.deselectCells();
          table.trimCell(cell);
          switch (dir) {
            case "up": case "start": return table.placeCursorInCell(table.getCellAt(minRow, minCol), "start"), true;
            case "down": case "end": return table.placeCursorInCell(table.getCellAt(maxRow, maxCol), "end"), true;
          }
        }
        const main = sel.main;
        if (main.from !== main.to) return false;
        const rtlDiffers = view.textDirection !== view.textDirectionAt(main.head);
        table.trimCell(cell);
        switch (dir) {
          case "up": {
            const v = view.moveVertically(main, false);
            if (view.coordsAtPos(main.from).top !== view.coordsAtPos(v.from).top) return false;
            moveUp(); return true;
          }
          case "down": {
            const v = view.moveVertically(main, true);
            if (view.coordsAtPos(main.from).top !== view.coordsAtPos(v.from).top) return false;
            moveDown(); return true;
          }
          case "start":
            if (main.from !== 0) return false;
            if (rtlDiffers) moveEnd(view); else moveStart(view);
            return true;
          case "end":
            if (main.to !== doc.length) return false;
            if (rtlDiffers) moveStart(view); else moveEnd(view);
            return true;
        }
      };

      // u: shift-arrow cell selection.
      const selectCell = (view, dir) => {
        const state = view.state, sel = state.selection, doc = state.doc;
        if (sel.ranges.length > 1) return false;
        const table = self.table, cell = self.cell;
        const head = table.selectionHead, anchor = table.selectionAnchor;
        const cur = head || cell;
        const row = cur.row, col = cur.col, main = sel.main;
        let target;
        switch (dir) {
          case "up":
            if (!head && view.moveToLineBoundary(main, false, true).from !== 0) return false;
            target = table.getCellAt(row - 1, col); break;
          case "down":
            if (!head && view.moveToLineBoundary(main, true, true).from !== doc.length) return false;
            target = table.getCellAt(row + 1, col); break;
          case "start":
            if (!head && main.head !== 0) return false;
            target = table.getCellAt(row, col - 1); break;
          case "end":
            if (!head && main.head !== doc.length) return false;
            target = table.getCellAt(row, col + 1); break;
        }
        if (target) { table.selectCells(anchor || cell, target); target.scrollIntoView(); }
        return true;
      };

      const redoCell = () => { host.cmRedo(self.table.editor.cm); return true; };
      const deleteSelection = (dir) => {
        const table = self.table;
        if (table.selectionHead) { table.deleteSelection(dir); return true; }
        return false;
      };

      if (self.app.isVimEnabled()) {
        exts.push(host.vimPrecedence.low(host.cmViewPlugin.define((editorView) => {
          editorView.getNextTablePos = nextTablePos;
          return { destroy() { delete editorView.getNextTablePos; } };
        })));
      }

      // f: map left/right to start/end honoring text direction.
      const dirFor = (view, which) => {
        const rtl = view.textDirectionAt(view.state.selection.main.head) === host.textDirectionEnum.RTL;
        if (rtl) return which === "left" ? "end" : "start";
        return which === "left" ? "start" : "end";
      };
      // d: run a command on the parent editor after focusing it (mac cmd keys).
      const onParent = (cmd) => () => {
        const mainCm = self.table.editor.cm;
        mainCm.focus();
        return cmd(mainCm);
      };

      exts.push(host.vimPrecedence.high(host.cmKeymapFacet.of([
        { key: "ArrowUp", run: (v) => navCell(v, "up"), shift: (v) => selectCell(v, "up") },
        { key: "ArrowDown", run: (v) => navCell(v, "down"), shift: (v) => selectCell(v, "down") },
        { key: "ArrowRight", run: (v) => navCell(v, dirFor(v, "right")) },
        { key: "Mod-ArrowRight", run: (v) => navCell(v, dirFor(v, "right")) },
        { key: "ArrowLeft", run: (v) => navCell(v, dirFor(v, "left")), shift: (v) => selectCell(v, dirFor(v, "left")) },
        { key: "Mod-ArrowLeft", run: (v) => navCell(v, dirFor(v, "left")) },
        { key: "Mod-z", run: () => { host.cmUndo(self.table.editor.cm); return true; }, preventDefault: true },
        { key: "Mod-y", mac: "Mod-Shift-z", run: redoCell, preventDefault: true },
        { linux: "Ctrl-Shift-z", run: redoCell, preventDefault: true },
        { key: "Mod-Shift-z", run: redoCell, preventDefault: true },
        { key: "Delete", run: () => deleteSelection(1) },
        { key: "Backspace", run: () => deleteSelection(-1) },
        { mac: "Cmd-ArrowUp", run: onParent(host.cmdGoStart), shift: onParent(host.selectDocStart) },
        { mac: "Ctrl-ArrowUp", run: onParent(host.pageUp), shift: onParent(host.selectPageUp) },
        { mac: "Cmd-ArrowDown", run: onParent(host.cmdGoEnd), shift: onParent(host.selectDocEnd) },
        { mac: "Ctrl-ArrowDown", run: onParent(host.pageDown), shift: onParent(host.selectPageDown) },
        { key: "PageUp", run: onParent(host.pageUp), shift: onParent(host.selectPageUp) },
        { key: "PageDown", run: onParent(host.pageDown), shift: onParent(host.selectPageDown) },
        { key: "Mod-Home", run: onParent(host.cmdGoStart), shift: onParent(host.selectDocStart) },
        { key: "Mod-End", run: onParent(host.cmdGoEnd), shift: onParent(host.selectDocEnd) }
      ])));

      // focus whole cell content on Tab/Enter navigation.
      const focusCell = (cellWidget) => {
        self.table.setCellFocus(cellWidget.row, cellWidget.col, (view) =>
          host.cmSelection.create([host.cmSelection.range(0, view.state.doc.length)]));
      };
      exts.push(host.cmKeymapFacet.of([
        {
          key: "Tab",
          run() {
            const table = self.table, cell = self.cell;
            const next = table.getNextCell(cell, "end");
            table.trimCell(cell);
            if (next) focusCell(next); else table.insertRow(table.rows.length, 0);
            return true;
          },
          shift() {
            const table = self.table, cell = self.cell;
            const prev = table.getNextCell(cell, "start");
            table.trimCell(cell);
            if (prev) focusCell(prev); else table.insertRow(0, table.alignments.length - 1);
            return true;
          }
        },
        {
          key: "Enter",
          run() {
            const table = self.table, cell = self.cell;
            table.trimCell(cell);
            if (cell.row === table.rows.length - 1) table.insertRow(cell.row + 1, cell.col);
            else {
              const below = table.getCellBelow(cell);
              if (below) focusCell(below);
            }
            return true;
          }
        }
      ]));

      exts.push(host.vimPrecedence.high(host.cmView.domEventHandlers({
        copy(event) { return self.table.copySelection(event); },
        cut(event) { return self.table.copySelection(event, true); },
        paste(event) { return self.table.pasteSelection(event); },
        blur(event) {
          const table = self.table, app = self.app, containerEl = self.containerEl;
          const suggest = self.editorSuggest, cell = self.cell, editor = table.editor;
          table.trimCell(cell);
          if (host.Platform.isMobile) app.mobileToolbar.update();
          suggest.close();
          containerEl.win.setTimeout(() => {
            if (!editor.activeCM.hasFocus) editor.cm.contentDOM.dispatchEvent(event);
          });
          return true;
        }
      })));

      exts.push(readOnlyCompartment.of(host.cmState.readOnly.of(false)));
      return exts;
    },

    setReadonly(readonly) {
      this.cm.dispatch({ effects: readOnlyCompartment.reconfigure(host.cmState.readOnly.of(readonly)) });
    },

    onContextMenu(event, target) {
      const cell = this.cell;
      if (!this.table.selectedCells.contains(cell)) Base.prototype.onContextMenu.call(this, event, target);
    },

    onMenu(menu) {
      Base.prototype.onMenu.call(this, menu);
      this.table.onContextMenu(this.cell, menu);
    }
  });

  return TableCellEditor;
}
