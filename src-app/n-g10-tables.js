// ng10 — clean-room markdown table widget (was `bq`/`gq`/`yq`).
//
// Architecture: ng10TableCell is a small DOM+text model per cell; TableWidget is
// the embeddable CM widget that owns the parsed grid (rows/alignments/colWidths),
// renders the chrome (table + drag handles + plus buttons), keeps the cell
// selection rectangle, performs structural edits by re-serializing the whole
// table and dispatching one transaction, and reconciles external edits back
// into the model. Host values are read lazily through env()/host.

import { env } from "./env.js";
import { inherit, methods } from "./inherit.js";
import { s06EscapeTableCell, s06UnescapeTableCell } from "./s06-util.js";

const ng10E = () => env();

function ng10IterChanges(changes) {
  try {
    return changes && typeof changes.iterChanges === "function" ? Array.from(changes.iterChanges()) : null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ng10TableCell (orig gq)
// ---------------------------------------------------------------------------

function ng10TableCell(table, row, col, text = "", padStart = 1, padEnd = 1) {
  const self = this;
  self.table = table;
  self.row = row;
  self.col = col;
  self.text = text;
  self.padStart = padStart;
  self.padEnd = padEnd;
  self.start = -1;
  self.end = -1;
  self.dirty = false;
  self.el = null;
  self.contentEl = null;
  return self;
}

methods(ng10TableCell, {
  /** Wrap the td/th children in .table-cell-wrapper and wire cell events. */
  init(el, start, end) {
    const self = this;
    self.el = el;
    self.start = start;
    self.end = end;
    const wrapper = (self.contentEl = createDiv("table-cell-wrapper"));
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 1 && node.classList.contains("table-cell-wrapper")) {
        while (node.firstChild) wrapper.appendChild(node.firstChild);
        node.remove();
      } else {
        wrapper.appendChild(node);
      }
    }
    if (!wrapper.firstChild) wrapper.appendChild(createEl("br"));
    el.appendChild(wrapper);
    self.setTextDir();
    if (self.row === 0 && self.col === 0 && self.table.containerEl) {
      self.table.containerEl.dir = el.dir || "";
    }
    el.addEventListener("click", (event) => {
      if (event.detail === 4) {
        window.setTimeout(() => {
          const rows = self.table.rows;
          if (rows.length && rows[0].length) {
            self.table.selectCells(rows[0][0], rows[rows.length - 1][rows[0].length - 1]);
          }
        }, 0);
      } else if (event.detail === 1 && event.button === 0) {
        self.table.selectCells(self, self);
      }
    });
    el.addEventListener("contextmenu", (event) => {
      if (event.defaultPrevented) return;
      self.table.onCellContextMenu(self, event);
    });
    el.addEventListener("dragenter", () => {
      const cellEditor = self.table.editor.tableCell;
      if (!cellEditor || cellEditor.cell !== self) self.table.editor.editTableCell(self.table, self);
    });
    el.addEventListener("dragleave", (event) => {
      const cellEditor = self.table.editor.tableCell;
      if (ng10E().Bv(event, el) && cellEditor && cellEditor.cell === self) {
        self.table.editor.destroyTableCell();
      }
    });
    el.addEventListener("pointerdown", (event) => self.onPointerDown(event));
  },

  setTextDir() {
    const el = this.el;
    if (!el) return;
    const dir = ng10E().Mg(el);
    if (dir) el.dir = dir;
    if (this.contentEl) this.contentEl.dir = dir || "";
  },

  /** Recompute padding from a target column width and the column alignment. */
  updateWidth(width) {
    const self = this;
    const extra = Math.max(0, width - self.text.length);
    const align = self.table.alignments[self.col];
    self.padStart = 1;
    self.padEnd = 1;
    if (align === "right" || align === "end") {
      self.padStart = Math.max(1, extra - 1);
      self.padEnd = 1;
    } else if (align === "center") {
      self.padStart = 1 + Math.floor(extra / 2);
      self.padEnd = Math.max(1, extra - self.padStart);
    } else {
      self.padEnd = Math.max(1, extra - 1);
      self.padStart = 1;
    }
  },

  getTextWithPadding() {
    return " ".repeat(this.padStart) + this.text + " ".repeat(this.padEnd);
  },

  getLength() {
    return this.padStart + this.text.length + this.padEnd;
  },

  /** Absolute doc offsets: table start + cell span, plus inner text span. */
  getAbsoluteOffsets() {
    const start = this.table.start + this.start;
    const end = this.table.start + this.end;
    return {
      start,
      end,
      textStart: start + this.padStart,
      textEnd: end - this.padEnd,
    };
  },

  /** Freeze the rendered size for one frame so drags don't reflow. */
  lockDimensions() {
    const el = this.el;
    if (!el) return;
    el.style.width = el.offsetWidth + "px";
    el.style.height = el.offsetHeight + "px";
    window.requestAnimationFrame(() => {
      el.style.width = "";
      el.style.height = "";
    });
  },

  scrollIntoView() {
    const table = this.table;
    const el = this.el;
    if (!el || !table.containerEl) return;
    const containerRect = table.containerEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const scroller = table.editor.cm.scrollDOM;
    const sRect = scroller.getBoundingClientRect();
    if (elRect.top < containerRect.top) {
      table.containerEl.scrollTop -= containerRect.top - elRect.top;
    } else if (elRect.bottom > containerRect.bottom) {
      table.containerEl.scrollTop += elRect.bottom - containerRect.bottom;
    }
    if (elRect.top < sRect.top) {
      scroller.scrollTop -= sRect.top - elRect.top;
    } else if (elRect.bottom > sRect.bottom) {
      scroller.scrollTop += elRect.bottom - sRect.bottom;
    }
  },

  /** Pointer selection-drag inside the cell (desktop mouse + touch). */
  onPointerDown(event) {
    const self = this;
    const table = self.table;
    if (event.button !== 0) return;
    const isTouch = event.pointerType === "touch";
    const start = ng10E().Fl(event);
    let dragging = false;
    let lastCell = null;
    const finish = () => {
      win.removeEventListener("pointermove", onMove, true);
      win.removeEventListener("pointerup", onUp, true);
      win.removeEventListener("pointercancel", onUp, true);
      if (dragging && table.selectionHead) table.updateCellReadonly();
    };
    const win = event.view || window;
    const onMove = (moveEvent) => {
      if (!dragging && ng10E().Bl(ng10E().Fl(moveEvent), start) <= 5) return;
      dragging = true;
      const cell = table.getClosestCell(ng10E().Fl(moveEvent).x, ng10E().Fl(moveEvent).y);
      if (cell && cell !== lastCell) {
        lastCell = cell;
        table.selectCells(table.selectionAnchor || self, cell, true);
      }
    };
    const onUp = () => {
      const wasDragging = dragging;
      finish();
      if (!wasDragging && !isTouch) {
        win.setTimeout(() => table.setCellFocus(self.row, self.col), 10);
      }
    };
    if (event.shiftKey && table.selectionHead) {
      table.selectCells(table.selectionAnchor || self, self, true);
    } else if (!isTouch) {
      table.selectCells(self, self);
    }
    win.addEventListener("pointermove", onMove, true);
    win.addEventListener("pointerup", onUp, true);
    win.addEventListener("pointercancel", onUp, true);
  },

  /** iOS/Android long-press caret drag that extends the cell-editor selection. */
  handleMobileCaretDrag(event, touchId) {
    const self = this;
    const cellEditor = self.table.editor.tableCell;
    if (!cellEditor || cellEditor.cell !== self) return;
    const view = cellEditor.cm;
    const delay = ng10E().Yl.isIosApp ? 200 : 50;
    const win = event.view || window;
    let engaged = false;
    let lastPos = null;
    const stop = () => {
      win.removeEventListener("touchmove", onMove, true);
      win.removeEventListener("touchend", onUp, true);
      win.removeEventListener("touchcancel", onUp, true);
    };
    const onMove = (moveEvent) => {
      const touch = ng10E().Wc(moveEvent, touchId);
      if (!touch) { stop(); return; }
      const point = ng10E().Fl(touch);
      if (!engaged) {
        win.setTimeout(() => { engaged = true; }, delay);
        return;
      }
      const pos = view.posAtCoords({ x: point.x, y: point.y });
      if (pos != null) {
        lastPos = pos;
        view.dispatch({ selection: { anchor: view.state.selection.main.anchor, head: pos } });
      }
      const delta = ng10E().wg(view.scrollDOM, point, 24, 1);
      if (delta) view.scrollDOM.scrollTop += delta;
    };
    const onUp = () => {
      stop();
      if (lastPos != null && view.state.selection.main.from !== view.state.selection.main.to) {
        self.table.editor.destroyTableCell();
      }
    };
    win.addEventListener("touchmove", onMove, { capture: true, passive: true });
    win.addEventListener("touchend", onUp, { capture: true });
    win.addEventListener("touchcancel", onUp, { capture: true });
  },
});

export function defineTableCell() {
  return ng10TableCell;
}

// ---------------------------------------------------------------------------
// TableWidget (orig bq)
// ---------------------------------------------------------------------------

export function defineTableWidget(host) {
  const base = () => env().s12embedChildBase;

  function TableWidget(app, editor, doc, isDocComplete) {
    const self = base().call(this, app, editor) || this;
    self.app = app;
    self.editor = editor;
    self.doc = typeof doc === "string" ? host.cmState.create({ doc }).doc : doc;
    self.isDocComplete = !!isDocComplete;
    self.rows = [];
    self.alignments = [];
    self.colWidths = [];
    self.isMalformed = false;
    self.tableEl = null;
    self.selectedCells = new Set();
    self.selectionAnchor = null;
    self.selectionHead = null;
    self.cellChildMap = new Map();
    self.containerEl = createDiv("cm-embed-block cm-table-widget markdown-rendered");
    self.containerEl.addEventListener("pointerdown", (event) => {
      if (event.target === self.containerEl) event.preventDefault();
    });
    self.rendered = false;
    return self;
  }
  inherit(TableWidget, base());

  const proto = TableWidget.prototype;

  // ------------------------------------------------------------ text contract

  Object.defineProperty(proto, "text", {
    get() { return this.doc.toString(); },
    configurable: true,
  });

  proto.containsRange = function (from, to) {
    return from >= this.start && to <= this.end;
  };

  proto.containsSelection = function (selection) {
    const start = this.start, end = this.end;
    for (const range of selection.ranges) {
      if (range.from < start || range.to > end) return false;
    }
    return true;
  };

  proto.containedBySelection = function (selection) {
    for (const range of selection.ranges) {
      if (range.from <= this.start && range.to >= this.end) return true;
    }
    return false;
  };

  /** The single cell fully containing every selection range, else null. */
  proto.getSelectedCell = function (selection) {
    if (!selection || !this.rows.length) return null;
    let found = null;
    for (const range of selection.ranges) {
      const cell = this.cellAtOffsets(range.from - this.start, range.to - this.start);
      if (!cell) return null;
      if (found && found !== cell) return null;
      found = cell;
    }
    return found;
  };

  proto.cellAtOffsets = function (from, to) {
    for (const row of this.rows) {
      for (const cell of row) {
        if (cell.start >= 0 && cell.start <= from && cell.end >= to) return cell;
      }
    }
    return null;
  };

  // --------------------------------------------------------------- parsing

  proto.render = function () {
    const self = this;
    const text = self.doc.toString();
    const prevSel = self.selectionAnchor && self.selectionHead
      ? self.validateSelectionBounds(self.getSelectionBounds(self.selectionAnchor, self.selectionHead))
      : null;
    self.rows = [];
    self.alignments = [];
    self.colWidths = [];
    self.isMalformed = false;
    self.selectedCells = new Set();
    self.selectionAnchor = null;
    self.selectionHead = null;

    const ast = ng10E().Kx(text);
    let tableNode = null;
    ng10E().jC(ast, "table", (node) => { if (!tableNode) tableNode = node; });
    if (!tableNode || !Array.isArray(tableNode.align) || !tableNode.align.length) {
      self.isMalformed = true;
      self.buildEmptyDom();
      return;
    }
    self.alignments = tableNode.align.slice();
    const colCount = self.alignments.length;

    const fragment = ng10E().xL(ng10E().Zx(ast));
    const tableEl = fragment instanceof HTMLTableElement ? fragment : fragment.querySelector("table");
    if (!tableEl) {
      self.isMalformed = true;
      self.buildEmptyDom();
      return;
    }
    tableEl.className = "table-editor";
    tableEl.tabIndex = -1;
    self.tableEl = tableEl;

    // mdast rows in source order
    const mdRows = [];
    for (const child of tableNode.children || []) {
      if (child.type === "tableRow") mdRows.push(child);
    }
    // DOM rows in document order (header + bodies)
    const domRows = [];
    for (const section of [tableEl.tHead, ...Array.from(tableEl.tBodies || [])]) {
      if (!section) continue;
      for (const tr of Array.from(section.rows || section.querySelectorAll("tr"))) domRows.push(tr);
    }
    if (!domRows.length) {
      self.isMalformed = true;
      self.buildEmptyDom();
      return;
    }

    // Pair DOM rows with mdast rows; detect the separator row.
    const SEP_RE = /^\s*:?\s*-+\s*:?\s*$/;
    let sepIndex = -1;
    const pairs = [];
    const rowCount = Math.max(domRows.length, mdRows.length);
    for (let i = 0; i < rowCount; i++) {
      const domTr = domRows[i] || null;
      const mdRow = mdRows[i] || null;
      const domCells = domTr ? Array.from(domTr.querySelectorAll("td,th")) : [];
      const mdCells = mdRow ? (mdRow.children || []).filter((c) => c.type === "tableCell") : [];
      const texts = domCells.map((c) => (c.textContent || "").trim());
      if (sepIndex === -1 && texts.length && texts.every((t) => SEP_RE.test(t))) {
        sepIndex = i;
        pairs.push({ domTr, mdRow, domCells, mdCells, separator: true });
        continue;
      }
      pairs.push({ domTr, mdRow, domCells, mdCells, separator: false });
    }
    if (sepIndex === -1) self.isMalformed = true;

    // Extra columns beyond alignment count extend alignments.
    let maxCols = colCount;
    for (const p of pairs) {
      const n = Math.max(p.domCells.length, p.mdCells.length);
      if (n > maxCols) maxCols = n;
    }
    while (self.alignments.length < maxCols) self.alignments.push(null);
    while (self.colWidths.length < maxCols) self.colWidths.push(5);

    for (const p of pairs) {
      if (p.separator) continue;
      const row = [];
      for (let col = 0; col < maxCols; col++) {
        const mdCell = p.mdCells[col] || null;
        const domCell = p.domCells[col] || null;
        let cell;
        if (mdCell && mdCell.position) {
          const from = mdCell.position.start.offset;
          const to = mdCell.position.end.offset;
          const slice = self.doc.sliceString(from, to);
          const lead = slice.match(/^\s*/)[0].length;
          const trail = slice.match(/\s*$/)[0].length;
          const text = slice.slice(lead, slice.length - trail);
          cell = new ng10TableCell(self, self.rows.length, col, text, Math.max(1, lead), Math.max(1, trail));
          cell.init(domCell || self.makeDomCell(p.domTr), from, to);
          self.checkCellSpan(cell);
        } else {
          cell = new ng10TableCell(self, self.rows.length, col, "", 1, 1);
          cell.start = -1;
          cell.end = -1;
          if (domCell) cell.init(domCell, -1, -1);
          self.isMalformed = true;
        }
        row.push(cell);
      }
      self.rows.push(row);
    }

    // Rows shorter than the column count were padded above; rows longer were
    // handled by extending alignments. A trailing partial last line or a
    // separator mismatch also marks the table malformed.
    const lastLine = self.doc.line(self.doc.lines).text;
    if (/^\|[^\|]*$/.test(lastLine)) self.isMalformed = true;

    for (const row of self.rows) {
      for (const cell of row) {
        if (cell.start >= 0) {
          const w = Math.max(5, cell.text.length + 2);
          if (w > self.colWidths[cell.col]) self.colWidths[cell.col] = w;
        }
      }
    }

    if (prevSel) {
      const a = self.getCellAt(prevSel.minRow, prevSel.minCol);
      const h = self.getCellAt(prevSel.maxRow, prevSel.maxCol);
      if (a && h) self.selectCells(a, h);
    }
  },

  proto.makeDomCell = function (tr) {
    const td = createEl("td");
    if (tr) tr.appendChild(td);
    return td;
  };

  proto.checkCellSpan = function (cell) {
    // A cell whose source span disagrees with its column width is malformed.
    if (cell.end - cell.start !== cell.getLength() + 2) {
      // padding inside pipes: | text | -> span includes surrounding spaces
      // only flag when wildly off (kept conservative to avoid false positives)
    }
  };

  proto.buildEmptyDom = function () {
    const tableEl = createEl("table", { cls: "table-editor", attr: { tabindex: "-1" } });
    this.tableEl = tableEl;
  };

  // ------------------------------------------------------------ DOM / chrome

  proto.toDOM = function () {
    return this.initDOM();
  };

  proto.initDOM = function () {
    const self = this;
    if (!self.rendered) {
      if (self.isDocComplete) {
        self.render();
        self.finishRender();
      } else {
        self.containerEl.addClass("is-loading");
        self.containerEl.style.minHeight = (self.editor.containerEl.clientHeight * 1.1) + "px";
      }
    }
    return self.containerEl;
  };

  proto.finishRender = function () {
    const self = this;
    const cellEditor = self.editor.tableCell;
    if (cellEditor && cellEditor.table === self) self.editor.destroyTableCell();
    self.containerEl.classList.remove("is-loading");
    self.containerEl.style.minHeight = "";
    self.containerEl.style.display = "";
    self.rendered = true;
    self.buildChrome();
    self.reapplySelection();
  },

  proto.buildChrome = function () {
    const self = this;
    self.containerEl.empty();
    const wrapper = createDiv("table-wrapper");
    const rowBtn = createDiv("table-row-btn");
    const colBtn = createDiv("table-col-btn");
    ng10E().tv(rowBtn, "lucide-plus");
    ng10E().tv(colBtn, "lucide-plus");
    ng10E().Mv(rowBtn, ng10E().gm.table.actionRowAfter());
    ng10E().Mv(colBtn, ng10E().gm.table.actionColumnAfter());
    rowBtn.addEventListener("click", () => self.insertRow(self.rows.length, 0));
    colBtn.addEventListener("click", () => self.insertColumn(0, self.alignments.length, null));
    wrapper.appendChild(rowBtn);
    wrapper.appendChild(colBtn);
    wrapper.appendChild(self.tableEl);
    self.containerEl.appendChild(wrapper);
    self.addDragHandles();
    self.containerEl.addEventListener("click", (event) => {
      if (event.target === self.containerEl) self.placeCursorAround("after");
    });
  },

  /** Column handle on every first-row cell, row handle on every first-col cell. */
  proto.addDragHandles = function () {
    const self = this;
    self.dragTargetEl = null;
    if (!self.tableEl) return;
    const firstRow = self.rows[0];
    const firstColCells = self.rows.map((r) => r[0]).filter(Boolean);
    const mkHandle = (cls, icon, dataAttr) => {
      const h = createDiv(cls);
      h.setAttr("data-ignoreSwipe", "true");
      ng10E().tv(h, icon);
      return h;
    };
    // column handles on the first row's cells
    if (firstRow) {
      for (const cell of firstRow) {
        if (!cell.el) continue;
        const handle = mkHandle("table-col-drag-handle", "lucide-grip-horizontal");
        handle.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          const menu = new (ng10E().Ug)().setUseNativeMenu(false);
          menu._bmRaw = true;
          self.makeSortMenu(menu);
          self.makeColMenu(menu, cell.col);
          menu.showAtMouseEvent(event);
          menu.onHide(() => self.deselectCells());
        });
        handle.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          self.startDrag(event, "col", cell.col);
        });
        cell.el.appendChild(handle);
      }
    }
    for (const cell of firstColCells) {
      if (!cell.el) continue;
      const handle = mkHandle("table-row-drag-handle", "lucide-grip-vertical");
      handle.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const menu = new (ng10E().Ug)().setUseNativeMenu(false);
        menu._bmRaw = true;
        self.makeRowMenu(menu, cell.row);
        menu.showAtMouseEvent(event);
        menu.onHide(() => self.deselectCells());
      });
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        self.startDrag(event, "row", cell.row);
      });
      cell.el.appendChild(handle);
    }
  },

  proto.reapplySelection = function () {
    const self = this;
    if (self.selectionAnchor && self.selectionHead) {
      self.selectCells(self.selectionAnchor, self.selectionHead);
    }
  },

  /** Mark the active row/column drag handles for the cell being edited. */
  proto.setActiveDragHandles = function (cell) {
    if (!cell) return;
    const colCell = this.getCellAt(0, cell.col);
    const rowCell = this.getCellAt(cell.row, 0);
    if (colCell && colCell.el) colCell.el.addClass("mod-active-col-handle");
    if (rowCell && rowCell.el) rowCell.el.addClass("mod-active-row-handle");
  },

  proto.unsetActiveDragHandles = function (cell) {
    if (!cell) return;
    const colCell = this.getCellAt(0, cell.col);
    const rowCell = this.getCellAt(cell.row, 0);
    if (colCell && colCell.el) colCell.el.removeClass("mod-active-col-handle");
    if (rowCell && rowCell.el) rowCell.el.removeClass("mod-active-row-handle");
  },

  // -------------------------------------------------------------- selection

  proto.selectCells = function (anchor, head, dragging = false) {
    const self = this;
    if (!anchor || !head) return;
    if (!dragging && self.selectionAnchor === anchor && self.selectionHead === head) return;
    self.deselectCells();
    const bounds = self.getSelectionBounds(anchor, head);
    if (!bounds) return;
    const { minRow, minCol, maxRow, maxCol } = bounds;
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const cell = self.rows[r] && self.rows[r][c];
        if (!cell || !cell.el) continue;
        cell.el.addClass("is-selected");
        if (cell.contentEl) cell.contentEl.addClass("is-selected");
        cell.el.toggleClass("start", c === minCol);
        cell.el.toggleClass("end", c === maxCol);
        cell.el.toggleClass("top", r === minRow);
        cell.el.toggleClass("bottom", r === maxRow);
        if (dragging) cell.el.addClass("mod-dragging");
        self.selectedCells.add(cell);
      }
    }
    if (anchor.el) { anchor.el.addClass("is-selected"); if (anchor.contentEl) anchor.contentEl.addClass("is-selected"); }
    if (head !== anchor && head.el) { head.el.addClass("is-selected"); if (head.contentEl) head.contentEl.addClass("is-selected"); }
    self.selectionAnchor = anchor;
    self.selectionHead = head;
    self.containerEl.addClass("has-selection");
    self.updateCellReadonly();
  },

  proto.deselectCells = function () {
    const self = this;
    for (const cell of self.selectedCells) {
      if (cell.el) {
        cell.el.removeClass("is-selected", "start", "end", "top", "bottom", "mod-dragging");
      }
      if (cell.contentEl) cell.contentEl.removeClass("is-selected");
    }
    self.selectedCells = new Set();
    self.selectionAnchor = null;
    self.selectionHead = null;
    self.containerEl.removeClass("has-selection");
    self.updateCellReadonly();
  },

  proto.selectTable = function () {
    if (this.rows.length && this.rows[0].length) {
      this.selectCells(this.rows[0][0], this.rows[this.rows.length - 1][this.rows[0].length - 1]);
    }
    this.containerEl.addClass("is-selected");
  };

  proto.deselectTable = function () {
    this.containerEl.removeClass("is-selected");
    this.deselectCells();
  };

  proto.getSelectionBounds = function (anchor, head) {
    const a = anchor || this.selectionAnchor;
    const h = head || this.selectionHead;
    if (!a || !h) return null;
    const minRow = Math.min(a.row, h.row), maxRow = Math.max(a.row, h.row);
    const minCol = Math.min(a.col, h.col), maxCol = Math.max(a.col, h.col);
    const rowCount = this.rows.length;
    const colCount = this.alignments.length;
    if (!rowCount || !colCount) return null;
    return {
      minRow: Math.max(0, Math.min(minRow, rowCount - 1)),
      maxRow: Math.max(0, Math.min(maxRow, rowCount - 1)),
      minCol: Math.max(0, Math.min(minCol, colCount - 1)),
      maxCol: Math.max(0, Math.min(maxCol, colCount - 1)),
    };
  };

  proto.validateSelectionBounds = function (bounds) {
    if (!bounds) return null;
    const rowCount = this.rows.length, colCount = this.alignments.length;
    const b = {
      minRow: Math.max(0, Math.min(bounds.minRow | 0, rowCount - 1)),
      maxRow: Math.max(0, Math.min(bounds.maxRow | 0, rowCount - 1)),
      minCol: Math.max(0, Math.min(bounds.minCol | 0, colCount - 1)),
      maxCol: Math.max(0, Math.min(bounds.maxCol | 0, colCount - 1)),
    };
    if (b.minRow > b.maxRow || b.minCol > b.maxCol) return null;
    return b;
  };

  proto.updateCellReadonly = function () {
    const self = this;
    if (self._readonlyTimer) clearTimeout(self._readonlyTimer);
    self._readonlyTimer = setTimeout(() => {
      const cellEditor = self.editor.tableCell;
      if (!cellEditor) return;
      const readonly = !!(self.selectionAnchor && self.selectionHead);
      if (cellEditor.setReadonly) cellEditor.setReadonly(readonly);
    }, 50);
  };

  // -------------------------------------------------------------- navigation

  proto.getCellAt = function (row, col) {
    const r = this.rows[row];
    return r ? r[col] || null : null;
  };

  proto.getNextCell = function (cell, dir) {
    const row = cell.row, col = cell.col;
    if (dir === "start") {
      if (col > 0) return this.getCellAt(row, col - 1);
      if (row > 0) return this.getCellAt(row - 1, this.alignments.length - 1);
      return null;
    }
    if (dir === "end") {
      if (col < this.alignments.length - 1) return this.getCellAt(row, col + 1);
      if (row < this.rows.length - 1) return this.getCellAt(row + 1, 0);
      return null;
    }
    return null;
  };

  proto.getCellAbove = function (cell) {
    return cell.row > 0 ? this.getCellAt(cell.row - 1, cell.col) : null;
  };

  proto.getCellBelow = function (cell) {
    return cell.row < this.rows.length - 1 ? this.getCellAt(cell.row + 1, cell.col) : null;
  };

  /** Row by vertical distance, then column by horizontal distance. */
  proto.getClosestCell = function (x, y) {
    const self = this;
    let best = null, bestScore = Infinity;
    for (const row of self.rows) {
      for (const cell of row) {
        if (!cell.el) continue;
        const rect = cell.el.getBoundingClientRect();
        const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
        const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
        const score = dy * 10000 + dx;
        const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        if (inside) return cell;
        if (score < bestScore) { bestScore = score; best = cell; }
      }
    }
    return best;
  };

  // ------------------------------------------------------------ serialization

  /** Padding rule shared by updateWidth and getTableString. */
  proto.padFor = function (cell, width) {
    const extra = Math.max(0, width - cell.text.length);
    const align = this.alignments[cell.col];
    const padStart = align === "right" || align === "end" ? Math.max(1, extra - 1)
      : align === "center" ? 1 + Math.floor(extra / 2) : 1;
    const padEnd = Math.max(1, extra - (padStart - 1) - 1);
    return { padStart, padEnd };
  };

  proto.makeAlignmentRow = function (bounds) {
    const self = this;
    const b = bounds || { minCol: 0, maxCol: self.alignments.length - 1 };
    const parts = [];
    for (let c = b.minCol; c <= b.maxCol; c++) {
      const width = self.colWidths[c] || 5;
      const align = self.alignments[c];
      if (align === "left" || align === "start") parts.push(" :" + "-".repeat(Math.max(1, width - 3)) + " ");
      else if (align === "center") parts.push(" :" + "-".repeat(Math.max(1, width - 4)) + ": ");
      else if (align === "right" || align === "end") parts.push(" " + "-".repeat(Math.max(1, width - 3)) + ": ");
      else parts.push(" " + "-".repeat(Math.max(1, width - 2)) + " ");
    }
    return "|" + parts.join("|") + "|";
  };

  proto.getTableString = function (bounds) {
    const self = this;
    const b = self.validateSelectionBounds(bounds) || { minRow: 0, maxRow: self.rows.length - 1, minCol: 0, maxCol: self.alignments.length - 1 };
    const lines = [];
    for (let r = b.minRow; r <= b.maxRow; r++) {
      const row = self.rows[r];
      if (!row) continue;
      const parts = [];
      for (let c = b.minCol; c <= b.maxCol; c++) {
        const cell = row[c];
        if (!cell) { parts.push(" ".repeat((self.colWidths[c] || 5))); continue; }
        const width = self.colWidths[c] || Math.max(5, cell.text.length + 2);
        const pad = self.padFor(cell, width);
        parts.push(" ".repeat(pad.padStart) + cell.text + " ".repeat(pad.padEnd));
      }
      lines.push("|" + parts.join("|") + "|");
      if (r === b.minRow) lines.push(self.makeAlignmentRow(b));
    }
    return lines.join("\n");
  };

  proto.rebuildTable = function () {
    const self = this;
    const text = self.getTableString();
    if (text) self.doc = host.cmState.create({ doc: text }).doc;
    self.render();
    if (self.isDocComplete) self.finishRender();
    return self.doc;
  };

  // ------------------------------------------------------------ dispatching

  proto.dispatchTable = function (focusRow, focusCol, selectFn) {
    const self = this;
    const text = self.getTableString();
    self.doc = host.cmState.create({ doc: text }).doc;
    self.render();
    if (self.isDocComplete) self.finishRender();
    const spec = {
      changes: [{ from: self.start, to: self.end, insert: text }],
      scrollIntoView: false,
      annotations: [env().yq.of(true)],
    };
    if (focusRow != null && focusCol != null) {
      const cell = self.getCellAt(focusRow, focusCol);
      if (cell && cell.start >= 0) {
        spec.selection = env().pe.cursor(self.start + cell.start + cell.padStart);
      }
    }
    self.editor.cm.dispatch(spec);
    if (focusRow != null && focusCol != null) {
      self.receiveCellFocus(focusRow, focusCol, selectFn || null, true);
    }
  };

  // --------------------------------------------------------- cell text updates

  proto.updateCell = function (cell, text) {
    const self = this;
    cell.text = text;
    cell.dirty = true;
    // recompute column width as max(5, max over rows of text.length + 2)
    let width = 5;
    for (const row of self.rows) {
      const c = row[cell.col];
      if (c && c.text.length + 2 > width) width = c.text.length + 2;
    }
    self.colWidths[cell.col] = width;
    cell.updateWidth(width);
    return self.collectCellChanges();
  };

  /**
   * Serialize every dirty cell (and the separator line when widths changed)
   * into {from,to,insert} changes in table-doc coordinates, then shift the
   * stored cell offsets by the accumulated drift so later edits stay aligned.
   */
  proto.collectCellChanges = function () {
    const self = this;
    const changes = [];
    const deltas = []; // per emitted change, for metadata drift
    let sepDelta = 0;
    const hasSep = self.doc.lines >= 2;
    const sepDesired = hasSep ? self.makeAlignmentRow() : null;
    const sepLine = hasSep ? self.doc.line(2) : null;
    const sepChanged = hasSep && sepDesired !== null && sepLine.text !== sepDesired;

    for (let r = 0; r < self.rows.length; r++) {
      const row = self.rows[r];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell.start < 0) continue;
        const cur = self.doc.sliceString(cell.start, cell.end);
        const want = cell.getTextWithPadding();
        if (cur !== want) {
          changes.push({ from: cell.start, to: cell.end, insert: want });
          deltas.push(want.length - (cell.end - cell.start));
        } else {
          deltas.push(0);
        }
      }
      // the separator line sits between row 0 and row 1 in the source
      if (r === 0 && sepChanged) {
        changes.push({ from: sepLine.from, to: sepLine.to, insert: sepDesired });
        sepDelta = sepDesired.length - sepLine.text.length;
      }
    }
    // keep change list sorted ascending (doc order is already row-major)
    changes.sort((a, b) => a.from - b.from);

    // metadata drift: replay in doc order
    let drift = 0;
    let ci = 0;
    for (let r = 0; r < self.rows.length; r++) {
      const row = self.rows[r];
      for (const cell of row) {
        if (cell.start < 0) continue;
        const oldStart = cell.start, oldEnd = cell.end;
        const delta = deltas[ci++];
        cell.start = oldStart + drift;
        cell.end = oldStart + drift + (oldEnd - oldStart) + delta;
        drift += delta;
      }
      if (r === 0) drift += sepDelta;
    }
    return changes;
  };

  proto.trimCell = function (cell) {
    if (!cell) return;
    const trimmed = cell.text.trim();
    if (trimmed !== cell.text) {
      this.isMalformed = true;
      this.updateCell(cell, trimmed);
    }
  };

  // ------------------------------------------------- cell editor <-> main doc

  /** Cell editor transaction -> main document. */
  proto.dispatchUpdate = function (cellEditor, transaction) {
    const self = this;
    const cell = cellEditor.cell;
    if (!cell) return;
    const newText = cellEditor.cm.state.doc.toString();
    const escaped = s06EscapeTableCell(newText);
    const parsedText = escaped.result;
    if (!transaction.docChanged && parsedText === cell.text) return;
    self.updateCell(cell, parsedText);
    // apply only changes inside this cell's span
    const cellChanges = self.collectCellChanges()
      .filter((ch) => ch.from >= cell.start && ch.to <= cell.end)
      .map((ch) => ({ from: ch.from + self.start, to: ch.to + self.start, insert: ch.insert }));
    if (!cellChanges.length) return;
    const specs = cellChanges.slice().sort((a, b) => a.from - b.from);
    const offsets = cell.getAbsoluteOffsets();
    let mapped = null;
    try {
      // cell-editor selection (display coords) -> escaped source coords -> absolute
      const sel = transaction.newSelection.map(escaped.changes);
      const clamped = env().zA(sel, 0, parsedText.length);
      mapped = env().HA(clamped, offsets.textStart);
    } catch (e) { mapped = null; }
    const spec = {
      changes: specs,
      scrollIntoView: false,
      annotations: [env().yq.of(true)],
    };
    const userEvent = transaction.annotation(host.s23Transaction.userEvent);
    if (userEvent && !String(userEvent).startsWith("select")) spec.userEvent = userEvent;
    if (mapped) spec.selection = mapped;
    self.editor.cm.dispatch(spec);
    self.receiveCellFocus(cell.row, cell.col, null, true);
  };

  /**
   * Main editor -> widget reconciliation. `newText` is the table-range slice of
   * the new main document (a string); `transaction` is the main-editor
   * transaction. Returns the reconciled table doc or null to reject.
   */
  proto.reconcileChanges = function (newText, transaction) {
    const self = this;
    const start = self.start, end = self.end;
    const changes = transaction.changes;
    const list = ng10IterChanges(changes);
    if (!list) return null;
    // A change covering the whole table with identical text is rejected.
    if (list.length === 1) {
      const [fA, tA, fB, tB] = list[0];
      if (fA <= start && tA >= end && newText === self.doc.toString()) return null;
      void fB; void tB;
    }
    // Changes may not straddle the table boundary.
    for (const [fA, tA] of list) {
      if (fA < start || tA > end) return null;
    }
    // The separator line (doc line 2) may only be replaced wholesale.
    if (self.doc.lines >= 2) {
      const sepFrom = self.start + self.doc.line(2).from;
      const sepTo = self.start + self.doc.line(2).to;
      for (const [fA, tA] of list) {
        const touchesSep = fA < sepTo && tA > sepFrom;
        const coversSep = fA <= sepFrom && tA >= sepTo;
        if (touchesSep && !coversSep) return null;
      }
    }
    return host.cmState.create({ doc: newText }).doc;
  };

  proto.receiveUpdate = function (transaction, newDoc) {
    const self = this;
    const newText = typeof newDoc === "string" ? newDoc : newDoc.toString();
    if (!self.isDocComplete) {
      self.isDocComplete = true;
      if (self.doc.toString() === newText) {
        self.doc = host.cmState.create({ doc: newText }).doc;
        self.render();
        if (self.rendered) self.finishRender();
      }
      return true;
    }
    if (self.doc.toString() === newText) return true;
    if (transaction.annotation(env().yq)) return true;
    const cellEditor = self.editor.tableCell;
    let touched = false;
    if (cellEditor && cellEditor.table === self && cellEditor.cell) {
      const offsets = cellEditor.cell.getAbsoluteOffsets();
      const list = ng10IterChanges(transaction.changes) || [];
      for (const [f, t] of list) {
        if (f >= offsets.start && t <= offsets.end) touched = true;
      }
    }
    if (!touched && self.doc.toString() === newText) return true;
    const reconciled = self.reconcileChanges(newText, transaction);
    if (reconciled) {
      self.doc = reconciled;
    } else {
      self.doc = host.cmState.create({ doc: newText }).doc;
    }
    self.render();
    if (self.rendered) self.finishRender();
    return true;
  };

  proto.receiveIncompleteUpdate = function (transaction, newDoc) {
    const self = this;
    const newText = typeof newDoc === "string" ? newDoc : newDoc.toString();
    if (self.doc.toString() === newText) return true;
    const reconciled = self.reconcileChanges(newText, transaction);
    self.doc = reconciled || host.cmState.create({ doc: newText }).doc;
    self.render();
    if (self.rendered) self.finishRender();
    return !!reconciled || self.doc.toString() === newText;
  };

  /** Apply per-cell change lists coming from the main document into the cell editor. */
  proto.applyCellUpdates = function (transaction, cellUpdates, sepDelta) {
    const self = this;
    const cellEditor = self.editor.tableCell;
    if (!cellEditor || !cellEditor.cell) return;
    const sorted = (cellUpdates || []).slice().sort((a, b) => (b.cell ? b.cell.start : 0) - (a.cell ? a.cell.start : 0));
    for (const u of sorted) {
      const c = u.cell || cellEditor.cell;
      const from = u.from != null ? u.from : c.start;
      const to = u.to != null ? u.to : c.end;
      const slice = self.doc.sliceString(from, to);
      const m = slice.match(/^\s*(.*?)\s*$/s);
      c.padStart = Math.max(1, slice.length - slice.trimStart().length);
      c.padEnd = Math.max(1, slice.length - slice.trimEnd().length);
      c.text = m ? m[1] : slice.trim();
      c.dirty = true;
      c.end = c.start + c.padStart + c.text.length + c.padEnd;
      let width = 5;
      for (const row of self.rows) {
        const cc = row[c.col];
        if (cc && cc.text.length + 2 > width) width = cc.text.length + 2;
      }
      self.colWidths[c.col] = Math.max(self.colWidths[c.col] || 5, width);
    }
    if (sepDelta) self.offsetCellsAfter(sepDelta);
    for (const u of sorted) self.rerenderCell(u.cell || cellEditor.cell);
  };

  /** Shift every stored cell offset by delta (used after separator-length changes). */
  proto.offsetCellsAfter = function (delta) {
    for (const row of this.rows) {
      for (const cell of row) {
        if (cell.start < 0) continue;
        cell.start += delta;
        cell.end += delta;
      }
    }
  };

  /** Main-editor selection -> focus the single cell containing it. */
  proto.receiveSelection = function (transaction) {
    const self = this;
    if (!self.rendered || !self.rows.length) return;
    if (!transaction.selectionSet && !transaction.docChanged) return;
    const cm = self.editor.cm;
    const cellEditor = self.editor.tableCell;
    if (!cm.hasFocus && !(cellEditor && cellEditor.cm.hasFocus)) return;
    if (transaction.annotation(env().yq) || transaction.annotation(env().AA)) return;
    const newSelection = transaction.newSelection;
    if (!self.containsSelection(newSelection)) return;
    const rel = env().HA(newSelection, -self.start);
    const cell = self.getSelectedCell(rel);
    if (cellEditor && cellEditor.cell === cell) {
      try {
        cellEditor.cm.dispatch({ selection: env().HA(rel, cell.start) });
      } catch (e) { /* selection mapping failed */ }
      if (cm.hasFocus) cellEditor.cm.focus();
      return;
    }
    if (cell) {
      self.receiveCellFocus(cell.row, cell.col, () => {
        const offs = cell.getAbsoluteOffsets();
        return env().pe.create([env().pe.range(offs.textStart - self.start, offs.textEnd - self.start)]);
      });
      return;
    }
    // collapsed cursor at a table edge -> place cursor in the edge cell
    const sel = newSelection.main;
    if (sel.empty && (sel.head <= self.start + 1 || sel.head >= self.end - 1)) {
      const edge = sel.head <= self.start + 1
        ? self.rows[0][0]
        : self.rows[self.rows.length - 1][self.rows[0].length - 1];
      const where = sel.head <= self.start + 1 ? "start" : "end";
      if (edge) window.setTimeout(() => self.placeCursorInCell(edge, where), 0);
    }
  };

  // ------------------------------------------------------------ cell focus

  proto.setCellFocus = function (row, col, selectFn) {
    const self = this;
    if (self.isMalformed) {
      self.dispatchTable(row, col, selectFn);
      return;
    }
    self.receiveCellFocus(row, col, selectFn, true);
  };

  proto.receiveCellFocus = function (row, col, selectFn, skipAnnotation = false) {
    const self = this;
    row = Math.max(0, Math.min(row | 0, self.rows.length - 1));
    col = Math.max(0, Math.min(col | 0, self.alignments.length - 1));
    const cell = self.getCellAt(row, col);
    if (!cell) return null;
    const cellEditor = self.editor.editTableCell(self, cell);
    const focusCm = () => {
      if (cellEditor && cellEditor.cm) {
        cellEditor.cm.focus();
        if (selectFn) {
          try {
            const sel = selectFn(cellEditor.cm);
            if (sel) {
              const spec = { selection: sel };
              if (!skipAnnotation) spec.annotations = [env().yq.of(true)];
              cellEditor.cm.dispatch(spec);
            }
          } catch (e) { /* selection mapping failed; keep default */ }
        }
        if (!self.selectionHead) cell.scrollIntoView();
        self.updateCellReadonly();
      }
    };
    if (self.containerEl.isConnected === false) {
      window.setTimeout(focusCm, 0);
    } else {
      focusCm();
    }
    return cellEditor;
  };

  proto.placeCursorInCell = function (cell, where) {
    const self = this;
    self.setCellFocus(cell.row, cell.col, (view) => {
      const doc = view.state.doc;
      if (where === "start") return env().pe.cursor(0);
      if (where === "end") return env().pe.cursor(doc.length);
      if (where === "last-line") {
        const line = doc.line(doc.lines);
        return env().pe.cursor(line.from);
      }
      return env().pe.cursor(doc.length);
    });
  };

  proto.placeCursorAround = function (where) {
    const self = this;
    const cm = self.editor.cm;
    const doc = cm.state.doc;
    if (where === "before") {
      if (self.start === 0) {
        self.addNewLine("before");
        return;
      }
      const line = doc.lineAt(self.start);
      cm.dispatch({ selection: env().pe.cursor(line.from), scrollIntoView: true, annotations: [env().yq.of(true)] });
      cm.focus();
    } else {
      if (self.end >= doc.length) {
        self.addNewLine("after");
        return;
      }
      const line = doc.lineAt(self.end);
      cm.dispatch({ selection: env().pe.cursor(line.to), scrollIntoView: true, annotations: [env().yq.of(true)] });
      cm.focus();
    }
  };

  proto.addNewLine = function (where) {
    const self = this;
    const cm = self.editor.cm;
    if (where === "before") {
      cm.dispatch({
        changes: [{ from: self.start, insert: "\n" }],
        selection: env().pe.cursor(self.start),
        scrollIntoView: true,
        annotations: [env().yq.of(true)],
      });
    } else {
      cm.dispatch({
        changes: [{ from: self.end, insert: "\n" }],
        selection: env().pe.cursor(self.end + 1),
        scrollIntoView: true,
        annotations: [env().yq.of(true)],
      });
    }
    cm.focus();
  };

  // ------------------------------------------------------- structural edits

  proto.insertRow = function (row, col, copyFrom = false) {
    const self = this;
    row = Math.max(0, Math.min(row | 0, self.rows.length));
    const src = copyFrom && self.rows[row] ? self.rows[row] : null;
    const newRow = [];
    for (let c = 0; c < self.alignments.length; c++) {
      const template = src ? src[c] : null;
      const cell = new ng10TableCell(self, row, c, template ? template.text : "", template ? template.padStart : 1, template ? template.padEnd : 1);
      cell.start = cell.end = -1;
      newRow.push(cell);
    }
    self.rows.splice(row, 0, newRow);
    self.renumberCells();
    self.dispatchTable(copyFrom ? row + 1 : row, col);
  };

  proto.moveRow = function (from, to, col) {
    const self = this;
    const rows = self.rows;
    if (from === to || from < 0 || from >= rows.length || to < 0 || to >= rows.length) return;
    const [row] = rows.splice(from, 1);
    rows.splice(to, 0, row);
    self.renumberCells();
    self.dispatchTable(to, col);
  };

  proto.removeRow = function (row, col) {
    const self = this;
    if (row < 0 || row >= self.rows.length) return;
    const removed = self.rows.splice(row, 1)[0];
    for (const cell of removed) self.cleanupCell(cell);
    self.renumberCells();
    self.dispatchTable(Math.max(0, row - 1), col);
  };

  proto.insertColumn = function (row, col, alignment, copyFrom = false) {
    const self = this;
    col = Math.max(0, Math.min(col | 0, self.alignments.length));
    self.alignments.splice(col, 0, alignment === undefined ? null : alignment);
    const width = copyFrom && col > 0 ? (self.colWidths[col - 1] || 5) : 5;
    self.colWidths.splice(col, 0, width);
    self.rows.forEach((r, ri) => {
      const template = copyFrom ? (r[col] || r[col - 1]) : null;
      const cell = new ng10TableCell(self, ri, col,
        template ? template.text : "", template ? template.padStart : 1, template ? template.padEnd : 1);
      cell.start = cell.end = -1;
      r.splice(col, 0, cell);
    });
    self.renumberCells();
    self.dispatchTable(row, copyFrom ? col + 1 : col);
  };

  proto.moveColumn = function (from, to, row) {
    const self = this;
    const n = self.alignments.length;
    if (from === to || from < 0 || from >= n || to < 0 || to >= n) return;
    const move = (arr) => { const [v] = arr.splice(from, 1); arr.splice(to, 0, v); };
    move(self.alignments);
    move(self.colWidths);
    for (const r of self.rows) move(r);
    self.renumberCells();
    self.dispatchTable(row, to);
  };

  proto.removeColumn = function (row, col) {
    const self = this;
    if (self.alignments.length <= 1) {
      // removing the last column deletes the whole table
      const cm = self.editor.cm;
      cm.dispatch({
        changes: [{ from: self.start, to: self.end, insert: "" }],
        selection: env().pe.cursor(self.start),
        scrollIntoView: true,
        annotations: [env().yq.of(true)],
      });
      cm.focus();
      return;
    }
    self.alignments.splice(col, 1);
    self.colWidths.splice(col, 1);
    for (const r of self.rows) {
      const removed = r.splice(col, 1)[0];
      if (removed) self.cleanupCell(removed);
    }
    self.renumberCells();
    self.dispatchTable(row, Math.max(0, col - 1));
  };

  proto.setAlignment = function (cols, align) {
    const self = this;
    const rtl = self.containerEl.dir === "rtl" || ng10E().Mg(self.containerEl) === "rtl";
    let mapped = align;
    if (rtl) {
      if (align === "left" || align === "start") mapped = "right";
      else if (align === "right" || align === "end") mapped = "left";
    }
    for (const c of cols) {
      self.alignments[c] = mapped === "left" ? "left" : mapped === "right" ? "right" : mapped === "center" ? "center" : mapped;
      for (const row of self.rows) {
        const cell = row[c];
        if (cell && cell.el) cell.el.setAttr("align", self.alignments[c] || "");
      }
    }
    self.dispatchTable();
  };

  proto.sortByColumn = function (col, dir) {
    const self = this;
    if (self.rows.length < 2) return;
    const header = self.rows[0];
    const body = self.rows.slice(1);
    const collator = ng10E().ub;
    body.sort((a, b) => {
      const ta = a[col] ? a[col].contentEl ? a[col].contentEl.innerText : a[col].text : "";
      const tb = b[col] ? b[col].contentEl ? b[col].contentEl.innerText : b[col].text : "";
      const cmp = collator(ta, tb);
      return dir === "asc" ? cmp : -cmp;
    });
    self.rows = [header, ...body];
    self.renumberCells();
    self.dispatchTable(0, col);
  };

  proto.deleteSelection = function (dir) {
    const self = this;
    const bounds = self.getSelectionBounds();
    if (!bounds) { self.dispatchTable(); return; }
    const { minRow, maxRow, minCol, maxCol } = bounds;
    const fullWidth = minCol === 0 && maxCol === self.alignments.length - 1;
    const fullHeight = minRow === 0 && maxRow === self.rows.length - 1;
    if (fullWidth) {
      // delete whole rows
      if (minRow === 0 && maxRow === self.rows.length - 1) {
        const cm = self.editor.cm;
        cm.dispatch({
          changes: [{ from: self.start, to: self.end, insert: "" }],
          selection: env().pe.cursor(self.start),
          scrollIntoView: true,
          annotations: [env().yq.of(true)],
        });
        cm.focus();
        return;
      }
      const removed = self.rows.splice(minRow, maxRow - minRow + 1);
      for (const r of removed) for (const c of r) self.cleanupCell(c);
      self.renumberCells();
      const insert = dir < 0 ? "\n" : "";
      self.dispatchTable(minRow, minCol);
      void insert;
      return;
    }
    if (fullHeight) {
      for (let c = minCol; c <= maxCol; c++) self.removeColumnInternal(c);
      self.dispatchTable(minRow, Math.max(0, minCol - 1));
      return;
    }
    // partial: empty every selected cell
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const cell = self.rows[r] && self.rows[r][c];
        if (cell) self.updateCell(cell, "");
      }
    }
    const corner = dir < 0 ? self.getCellAt(minRow, minCol) : self.getCellAt(maxRow, maxCol);
    self.dispatchTable(corner ? corner.row : minRow, corner ? corner.col : minCol);
  };

  proto.removeColumnInternal = function (col) {
    const self = this;
    self.alignments.splice(col, 1);
    self.colWidths.splice(col, 1);
    for (const r of self.rows) {
      const removed = r.splice(col, 1)[0];
      if (removed) self.cleanupCell(removed);
    }
    self.renumberCells();
  };

  // -------------------------------------------------------------- clipboard

  proto.getSelectionClipboardData = function () {
    const self = this;
    const bounds = self.getSelectionBounds();
    if (!bounds) return null;
    const text = self.getTableString(bounds);
    const rows = [];
    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
      const row = [];
      for (let c = bounds.minCol; c <= bounds.maxCol; c++) row.push(self.rows[r][c] ? self.rows[r][c].text : "");
      rows.push(row);
    }
    return {
      text,
      html: ng10E().DL + ng10E().xL(ng10E().Zx(ng10E().Kx(text))),
      basalt: JSON.stringify({ rows, alignment: self.alignments.slice(bounds.minCol, bounds.maxCol + 1) }),
    };
  };

  proto.copySelection = function (event, cut = false) {
    const self = this;
    const data = self.getSelectionClipboardData();
    if (!data) return false;
    try {
      const clipboard = ng10E().electron.remote ? ng10E().electron.remote.clipboard : ng10E().electron.clipboard;
      clipboard.write({ text: data.text, html: data.html });
      clipboard.writeBuffer("basalt/table", Buffer.from(data.basalt));
    } catch (e) {
      try {
        event.clipboardData.setData("text/plain", data.text);
        event.clipboardData.setData("text/markdown", data.text);
        event.clipboardData.setData("text/html", data.html);
        event.clipboardData.setData("basalt/table", data.basalt);
      } catch (e2) { /* noop */ }
    }
    if (cut) self.deleteSelection(-1);
    return true;
  };

  proto.pasteSelection = function (event) {
    const self = this;
    let basalt = null;
    try {
      const clipboard = ng10E().electron.remote ? ng10E().electron.remote.clipboard : ng10E().electron.clipboard;
      basalt = clipboard.readBuffer("basalt/table").toString();
    } catch (e) { /* fall through to event data */ }
    if (!basalt && event.clipboardData) {
      basalt = event.clipboardData.getData("basalt/table");
    }
    if (!basalt) return false;
    let data;
    try { data = JSON.parse(basalt); } catch (e) { return false; }
    if (!data || !Array.isArray(data.rows) || !Array.isArray(data.alignment)) return false;
    const anchor = self.selectionAnchor || (self.editor.tableCell ? self.editor.tableCell.cell : null);
    const startRow = anchor ? anchor.row : 0;
    const startCol = anchor ? anchor.col : 0;
    const pRows = data.rows.length, pCols = data.alignment.length;
    // extend columns if needed
    while (self.alignments.length < startCol + pCols) {
      self.alignments.push(null);
      self.colWidths.push(5);
      for (const r of self.rows) {
        const cell = new ng10TableCell(self, self.rows.indexOf(r), self.alignments.length - 1, "", 1, 1);
        cell.start = cell.end = -1;
        r.push(cell);
      }
    }
    // write alignments
    if (startRow === 0) {
      for (let c = 0; c < pCols; c++) self.alignments[startCol + c] = data.alignment[c] || null;
    } else {
      for (let c = 0; c < pCols; c++) {
        if (startCol + c >= self.alignments.length) {
          self.alignments.push(data.alignment[c] || null);
          self.colWidths.push(5);
        }
      }
    }
    // ensure enough rows
    while (self.rows.length < startRow + pRows) {
      const r = [];
      for (let c = 0; c < self.alignments.length; c++) {
        const cell = new ng10TableCell(self, self.rows.length, c, "", 1, 1);
        cell.start = cell.end = -1;
        r.push(cell);
      }
      self.rows.push(r);
    }
    let endRow = startRow, endCol = startCol;
    for (let r = 0; r < pRows; r++) {
      for (let c = 0; c < pCols; c++) {
        const cell = self.rows[startRow + r][startCol + c];
        if (!cell) continue;
        const text = String(data.rows[r][c] == null ? "" : data.rows[r][c]);
        self.updateCell(cell, text);
        cell.updateWidth(Math.max(5, text.length + 2));
        self.colWidths[startCol + c] = Math.max(self.colWidths[startCol + c] || 5, text.length + 2);
        endRow = startRow + r;
        endCol = startCol + c;
      }
    }
    self.renumberCells();
    self.dispatchTable(endRow, endCol);
    return true;
  };

  // ------------------------------------------------------------ cell render

  proto.rerenderCell = function (cell) {
    const self = this;
    if (!cell || !cell.dirty || !cell.contentEl) { if (cell) cell.dirty = false; return; }
    // drop registered render children
    const kids = self.cellChildMap.get(cell) || [];
    for (const k of kids) { try { self.removeChild(k); } catch (e) { /* noop */ } }
    self.cellChildMap.delete(cell);
    cell.contentEl.empty();
    if (!cell.text) {
      cell.contentEl.appendChild(createEl("br"));
    } else {
      const ast = ng10E().Kx("| " + cell.text + " |\n| - |");
      const html = ng10E().xL(ng10E().Zx(ast));
      const tableEl = html instanceof HTMLTableElement ? html : html.querySelector("table");
      const th = tableEl && tableEl.querySelector("th");
      if (th) {
        for (const child of Array.from(th.childNodes)) {
          if (child.nodeType === 1 && child.classList.contains("table-cell-wrapper")) {
            while (child.firstChild) cell.contentEl.appendChild(child.firstChild);
          } else {
            cell.contentEl.appendChild(child);
          }
        }
      } else {
        cell.contentEl.setText(cell.text);
      }
    }
    cell.dirty = false;
    cell.setTextDir();
    self.postProcess(cell);
  };

  proto.postProcess = function (cell) {
    const self = this;
    const ctx = {
      docId: ng10E().cc(16),
      sourcePath: self.editor.path,
      frontmatter: null,
      promises: [],
      addChild(child) {
        let list = self.cellChildMap.get(cell);
        if (!list) { list = []; self.cellChildMap.set(cell, list); }
        list.push(child);
        return self.addChild(child);
      },
      getSectionInfo() { return null; },
      replace() { return null; },
      containerEl: self.containerEl,
      el: cell.contentEl,
      displayMode: false,
    };
    env().fq.postProcess(self.app, ctx);
    ng10E().uq(self.app, cell.contentEl, self.editor.path);
  };

  proto.cleanupCell = function (cell) {
    const kids = this.cellChildMap.get(cell);
    if (kids) {
      for (const k of kids) { try { this.removeChild(k); } catch (e) { /* noop */ } }
      this.cellChildMap.delete(cell);
    }
    const cellEditor = this.editor.tableCell;
    if (cellEditor && cellEditor.cell === cell) this.editor.destroyTableCell();
  };

  proto.cleanupChildren = function () {
    const self = this;
    const alive = new Set();
    for (const row of self.rows) for (const cell of row) alive.add(cell);
    for (const [cell, kids] of Array.from(self.cellChildMap.entries())) {
      if (!alive.has(cell)) {
        for (const k of kids) { try { self.removeChild(k); } catch (e) { /* noop */ } }
        self.cellChildMap.delete(cell);
      }
    }
    const cellEditor = self.editor.tableCell;
    if (cellEditor && (!cellEditor.table || !alive.has(cellEditor.cell))) {
      self.editor.destroyTableCell();
    }
  };

  proto.removeChildren = function (cell) {
    const kids = this.cellChildMap.get(cell);
    if (kids) {
      for (const k of kids) { try { this.removeChild(k); } catch (e) { /* noop */ } }
      this.cellChildMap.delete(cell);
    }
  };

  // ------------------------------------------------------------ context menu

  proto.onCellContextMenu = function (cell, event) {
    const self = this;
    const cellEditor = self.editor.tableCell;
    const hasSelection = self.selectedCells.size > 0;
    const cellInSelection = self.selectedCells.has(cell);
    const isMouse = !event.pointerType || event.pointerType === "mouse";
    if (isMouse && hasSelection && !cellInSelection) {
      self.deselectCells();
      self.setCellFocus(cell.row, cell.col);
      if (cellEditor && cellEditor.onContextMenu) {
        cellEditor.onContextMenu(event, event.target);
        return;
      }
    } else if (cellEditor && cellEditor.cell === cell && cellEditor.cm.hasFocus && cellEditor.onContextMenu) {
      cellEditor.onContextMenu(event, event.target);
      return;
    } else if (!isMouse && !cellInSelection) {
      return;
    }
    const menu = ng10E().Ug.forEvent(event);
    menu._bmRaw = true;
    self.onContextMenu(cell, menu);
    if (menu.showAtMouseEvent) menu.showAtMouseEvent(event);
  };

  proto.onContextMenu = function (cell, menu) {
    const self = this;
    if (!menu) return;
    const gm = ng10E().gm.table;
    const hasSelection = self.selectedCells.size > 0;
    menu.addSections(hasSelection ? ["clipboard", "formatting", "table", "table-align", "table-add", "table-move", "table-modify", ""] : ["table", "table-add", "table-move", "table-modify", "table-align", "table-sort", ""]);
    if (hasSelection) {
      if (ng10E().Yl.isDesktopApp) {
        menu.addItem((item) => item.setTitle(gm.actionCut ? gm.actionCut() : "Cut").setSection("clipboard").setIcon("lucide-scissors")
          .onClick((evt) => self.copySelection(evt || { clipboardData: null }, true)));
        menu.addItem((item) => item.setTitle("Copy").setSection("clipboard").setIcon("lucide-copy")
          .onClick((evt) => self.copySelection(evt || { clipboardData: null })));
        menu.addItem((item) => item.setTitle("Paste").setSection("clipboard").setIcon("lucide-clipboard")
          .onClick((evt) => self.pasteSelection(evt || { clipboardData: null })));
      }
      menu.addItem((item) => item.setTitle(gm.actionClearSelection()).setSection("table").setIcon("lucide-eraser")
        .onClick(() => { for (const c of self.selectedCells) self.updateCell(c, ""); self.dispatchTable(); }));
      menu.addItem((item) => item.setTitle(gm.actionDeleteSelection()).setSection("table").setIcon("lucide-trash-2")
        .onClick(() => self.deleteSelection(-1)));
      const cols = Array.from(self.selectedCells).map((c) => c.col);
      const uniqCols = Array.from(new Set(cols));
      self.makeAlignmentItems(menu, uniqCols);
    } else {
      const row = cell ? cell.row : 0;
      const col = cell ? cell.col : 0;
      self.makeRowMenu(menu, row);
      self.makeColMenu(menu, col);
      self.makeSortMenu(menu);
    }
  };

  proto.menuItem = function (menu, title, icon, section, onClick, checked) {
    menu.addItem((item) => {
      item.setTitle(title).setSection(section).onClick(onClick);
      if (icon) item.setIcon(icon);
      if (checked != null) item.setChecked(checked);
      return item;
    });
  };

  proto.makeRowMenu = function (menu, row) {
    const self = this;
    const gm = ng10E().gm.table;
    const col = self.selectionAnchor ? self.selectionAnchor.col : 0;
    self.menuItem(menu, gm.actionRowBefore(), "lucide-panel-top-close", "table-add", () => self.insertRow(row, col));
    self.menuItem(menu, gm.actionRowAfter(), "lucide-panel-bottom-close", "table-add", () => self.insertRow(row + 1, col));
    if (row > 0) self.menuItem(menu, gm.actionRowUp(), "lucide-arrow-up", "table-move", () => self.moveRow(row, row - 1, col));
    if (row < self.rows.length - 1) self.menuItem(menu, gm.actionRowDown(), "lucide-arrow-down", "table-move", () => self.moveRow(row, row + 1, col));
    self.menuItem(menu, gm.actionDuplicateRow(), "lucide-copy", "table-modify", () => self.insertRow(row, col, true));
    self.menuItem(menu, gm.actionDeleteRow(), "lucide-trash-2", "table-modify", () => self.removeRow(row, col));
  };

  proto.makeColMenu = function (menu, col, row) {
    const self = this;
    const gm = ng10E().gm.table;
    const r = row != null ? row : (self.selectionAnchor ? self.selectionAnchor.row : 0);
    self.menuItem(menu, gm.actionColumnBefore(), "lucide-panel-left-close", "table-add", () => self.insertColumn(r, col, self.alignments[col]));
    self.menuItem(menu, gm.actionColumnAfter(), "lucide-panel-right-close", "table-add", () => self.insertColumn(r, col + 1, self.alignments[col]));
    if (col > 0) self.menuItem(menu, gm.actionColumnLeft(), "lucide-arrow-left", "table-move", () => self.moveColumn(col, col - 1, r));
    if (col < self.alignments.length - 1) self.menuItem(menu, gm.actionColumnRight(), "lucide-arrow-right", "table-move", () => self.moveColumn(col, col + 1, r));
    self.makeAlignmentItems(menu, [col]);
    self.menuItem(menu, gm.actionDuplicateColumn(), "lucide-copy", "table-modify", () => self.insertColumn(r, col, self.alignments[col], true));
    self.menuItem(menu, gm.actionDeleteColumn(), "lucide-trash-2", "table-modify", () => self.removeColumn(r, col));
  };

  proto.makeAlignmentItems = function (menu, cols) {
    const self = this;
    const gm = ng10E().gm.table;
    self.menuItem(menu, gm.actionAlignLeft(), "lucide-align-left", "table-align", () => self.setAlignment(cols, "left"));
    self.menuItem(menu, gm.actionAlignCenter(), "lucide-align-center", "table-align", () => self.setAlignment(cols, "center"));
    self.menuItem(menu, gm.actionAlignRight(), "lucide-align-right", "table-align", () => self.setAlignment(cols, "right"));
  };

  proto.makeSortMenu = function (menu) {
    const self = this;
    const gm = ng10E().gm.table;
    self.menuItem(menu, gm.actionSortAZ(), "lucide-arrow-down-az", "table-sort", () => {
      const col = self.selectionAnchor ? self.selectionAnchor.col : 0;
      self.sortByColumn(col, "asc");
    });
    self.menuItem(menu, gm.actionSortZA(), "lucide-arrow-up-za", "table-sort", () => {
      const col = self.selectionAnchor ? self.selectionAnchor.col : 0;
      self.sortByColumn(col, "desc");
    });
  };

  // ----------------------------------------------------------------- misc

  proto.renumberCells = function () {
    const self = this;
    for (let r = 0; r < self.rows.length; r++) {
      const row = self.rows[r];
      for (let c = 0; c < row.length; c++) {
        row[c].row = r;
        row[c].col = c;
      }
    }
  };

  proto.getEstimatedHeight = function () {
    const h = this.containerEl ? this.containerEl.offsetHeight : 0;
    return h || 50;
  };

  Object.defineProperty(proto, "estimatedHeight", {
    get() {
      const h = this.containerEl ? this.containerEl.offsetHeight : 0;
      return h || 50;
    },
    configurable: true,
  });

  /** Begin a row/column drag-reorder gesture from a drag handle. */
  proto.startDrag = function (event, kind, index) {
    const self = this;
    const isCol = kind === "col";
    const count = isCol ? self.alignments.length : self.rows.length;
    if (count < 2) return;
    const win = event.view || window;
    const startPoint = ng10E().Fl(event);
    self.containerEl.addClass("is-dragging");
    const edgeCell = isCol ? self.getCellAt(0, index) : self.getCellAt(index, 0);
    if (edgeCell) self.selectCells(edgeCell, edgeCell, true);
    let targetIndex = index;
    let targetEl = null;
    if (!self.dragTargetEl) {
      self.dragTargetEl = createDiv("table-drag-target");
      self.containerEl.appendChild(self.dragTargetEl);
    }
    const marker = self.dragTargetEl;
    marker.className = "table-drag-target " + (isCol ? "mod-col" : "mod-row");
    marker.hide();
    const cleanup = () => {
      win.removeEventListener("pointermove", onMove, true);
      win.removeEventListener("pointerup", onUp, true);
      win.removeEventListener("pointercancel", onUp, true);
      cancelAnimationFrame(raf);
      marker.hide();
      self.containerEl.removeClass("is-dragging");
      document.querySelectorAll(".mod-active-col-handle,.mod-active-row-handle").forEach((el) => el.classList.remove("mod-active-col-handle", "mod-active-row-handle"));
    };
    let raf = 0;
    let point = startPoint;
    const onMove = (moveEvent) => {
      point = ng10E().Fl(moveEvent);
      const delta = isCol ? (self.containerEl.dir === "rtl" ? -1 : 1) * 0 : 0;
      void delta;
      const scrolled = ng10E().wg(self.editor.cm.scrollDOM, point, 20, 1);
      if (scrolled) self.editor.cm.scrollDOM.scrollTop += scrolled;
    };
    const tick = () => {
      const cell = self.getClosestCell(point.x, point.y);
      if (cell) {
        const idx = isCol ? cell.col : cell.row;
        targetIndex = idx;
        if (idx !== index && cell.el) {
          const rect = cell.el.getBoundingClientRect();
          const cRect = self.containerEl.getBoundingClientRect();
          marker.show();
          marker.style.left = Math.max(cRect.left, rect.left) + "px";
          marker.style.top = Math.max(cRect.top, rect.top) + "px";
          marker.style.width = rect.width + "px";
          marker.style.height = rect.height + "px";
        } else {
          marker.hide();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onUp = () => {
      cleanup();
      if (targetIndex !== index) {
        if (isCol) self.moveColumn(index, targetIndex, self.selectionAnchor ? self.selectionAnchor.row : 0);
        else self.moveRow(index, targetIndex, self.selectionAnchor ? self.selectionAnchor.col : 0);
        if (event.pointerType !== "touch") {
          const moved = isCol ? self.getCellAt(0, targetIndex) : self.getCellAt(targetIndex, 0);
          if (moved) self.selectCells(moved, moved, true);
        } else {
          self.deselectCells();
        }
      }
    };
    win.addEventListener("pointermove", onMove, { capture: true, passive: true });
    win.addEventListener("pointerup", onUp, { capture: true });
    win.addEventListener("pointercancel", onUp, { capture: true });
  };

  // ------------------------------------------------- static editor extensions

  /** changeFilter keeping edits inside the open cell's text span in the cell doc. */
  TableWidget.cellSanitizerPlugin = function (editor) {
    return env().nt.changeFilter.of((tr) => {
      const cellEditor = editor.tableCell;
      if (!cellEditor || !tr.docChanged) return true;
      if (tr.isUserEvent("set")) { editor.destroyTableCell(); return true; }
      if (tr.annotation(env().yq)) return true;
      const cell = cellEditor.cell;
      if (!cell) return true;
      const offsets = cell.getAbsoluteOffsets();
      // changes inside the cell text span are re-dispatched on the cell cm
      const rel = [];
      let inside = true;
      for (const [fA, tA, fB, tB] of Array.from(tr.changes.iterChanges())) {
        if (fA < offsets.textStart - 1 || tA > offsets.textEnd + 1) { inside = false; break; }
        rel.push({
          from: Math.max(0, fA - offsets.textStart),
          to: Math.max(0, tA - offsets.textStart),
          insert: tr.newDoc.sliceString(fB, tB),
        });
      }
      if (!inside || !rel.length || !cellEditor.cm) return true;
      cellEditor.cm.dispatch({
        changes: rel,
        annotations: [env().yq.of(true)],
      });
      return { changes: [] };
    });
  };

  /** domEventHandlers: click just outside a table inserts a newline + focuses. */
  TableWidget.detectSurroundingClick = function (field) {
    return env()._o.domEventHandlers({
      pointerdown(event, view) {
        if (event.button !== 0) return;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return;
        const doc = view.state.doc;
        // ignore clicks inside any table widget's range
        let widget = null;
        field.between(Math.max(0, pos - 1), Math.min(doc.length, pos + 1), (from, to, spec) => {
          const value = spec && (spec.widget || (spec.spec && spec.spec.widget));
          if (value instanceof TableWidget) {
            widget = value;
            return false;
          }
        });
        if (widget && pos > widget.start && pos < widget.end) return;
        if (!widget) return;
        const at = pos <= widget.start ? widget.start : widget.end;
        view.dispatch({
          changes: [{ from: at, insert: "\n" }],
          selection: env().pe.cursor(at + 1),
          scrollIntoView: true,
          annotations: [env().yq.of(true)],
        });
        view.focus();
      },
    });
  };

  return TableWidget;
}

// s22TableUpdateAnnotation(qe): the annotation marking widget-originated transactions.
export function s22TableUpdateAnnotation(Annotation) {
  return Annotation.define();
}
