// Slice s50 — `var H4` Bases table view: the virtualized table that renders query
// results as rows of editable cells. Owns column measurement, row virtualization,
// cell/area selection with keyboard navigation, clipboard copy/paste transactions,
// header click-to-sort, column resize and column drag-reordering.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ellipsize, floatOr, keyIgnoringCase, parsePropertyId } from "./text.js";
import { moveItem } from "./misc.js";
import { ng15OffsetBox, ng15IsEditableNode } from "./n-g15-tree.js";
import { s13VisibleRect, s13ScrollWatch } from "./s13-geom.js";
import { s13CellRange, s13ExtendRange } from "./s13-spatial.js";
import { s13ViewTable, s13BasesTableI18n } from "./s13-consts.js";

const s50Div = (...args) => env().createDiv(...args);

/** True when `el` lays out left-to-right (the directional check the view drags depend on). */
function s50IsLtr(el) {
  return getComputedStyle(el).direction !== "rtl";
}

/** Scrolls `el` just enough for the content-space rect {left,right,top,bottom} to be fully visible. */
function s50ScrollRectIntoView(el, rect) {
  const clientWidth = el.clientWidth;
  const clientHeight = el.clientHeight;
  const scrollLeft = el.scrollLeft;
  const scrollTop = el.scrollTop;
  const maxLeft = Math.max(0, el.scrollWidth - clientWidth);
  const maxTop = Math.max(0, el.scrollHeight - clientHeight);
  const clampAxis = (pos, from, to, size, max) => {
    if (from >= pos && to <= pos + size) return pos;
    const before = from;
    const after = to - size;
    const pick = Math.abs(before - pos) <= Math.abs(after - pos) ? before : after;
    return Math.clamp(pick, 0, max);
  };
  const left = clampAxis(scrollLeft, rect.left, rect.right, clientWidth, maxLeft);
  const top = clampAxis(scrollTop, rect.top, rect.bottom, clientHeight, maxTop);
  if (left !== scrollLeft || top !== scrollTop) el.scrollTo({ left, top, behavior: "auto" });
}

/** Keeps the just-shown context menu from also receiving this contextmenu event. */
function s50SwallowContextMenu(event) {
  event.stopPropagation();
  const target = event.target;
  if (!target) return;
  const type = event.type;
  const swallow = (ev) => ev.stopImmediatePropagation();
  target.win.setTimeout(() => target.removeEventListener(type, swallow), 0);
  target.addEventListener(type, swallow);
}

/** `var H4` — the Bases "table" view (public API `BasesTableView`). */
export function defineS50BasesTableView(host) {
  function TableView(controller, scrollEl) {
    const self = host.s13BasesViewBase.call(this, controller) || this;
    self.type = s13ViewTable;
    self.groups = [];
    self.rows = [];
    self.unusedRows = [];
    self.columnInfo = {};
    self.lastViewport = null;
    self.lastScroll = { left: 0, top: 0 };
    self.pendingScroll = null;
    self.cellLookup = new WeakMap();
    self.activeCell = null;
    self.activeCellEl = s50Div("bases-table-active-cell");
    self.selectionEl = s50Div("bases-table-selection");
    self.minColWidth = 100;
    self.maxColWidth = 600;
    self.scrollEl = scrollEl;
    const theadEl = self.theadEl = scrollEl.createDiv("bases-thead");
    self.header = new host.s13HeaderRow(self);
    theadEl.appendChild(self.header.el);
    const containerEl = self.containerEl = scrollEl.createDiv({
      cls: "bases-table-container is-loading",
      attr: { tabIndex: 0 },
    });
    self.footerSummary = new host.s13SummaryRow(self, "footer");
    scrollEl.appendChild(self.footerSummary.el);
    self.footerSummary.el.addClass("bases-table-footer");

    theadEl.on("click", ".bases-table-header-resizer", (e) => e.preventDefault());
    theadEl.on("dblclick", ".bases-table-header-resizer", self.onTableHeaderResizerDblclick.bind(self));
    theadEl.on("dragstart", ".bases-thead .bases-td", self.onTableHeaderDragstart.bind(self));
    containerEl.on("pointerdown", ".bases-td", self.onTableSelectionStart.bind(self), { capture: true });
    containerEl.on("contextmenu", ".bases-td", self.onTableCellContextmenu.bind(self), { capture: true });
    if (!host.Platform.isMobile) theadEl.on("click", ".bases-thead .bases-td", self.onTableHeaderClick.bind(self));

    containerEl.addEventListener("focusin", (e) => {
      if (self.activeCell) return;
      const active = self.containerEl.doc.activeElement;
      if (active === self.containerEl) return;
      if (!self.activeCell) {
        const cell = self.getCellFromDom(active);
        if (cell && cell instanceof host.s13BodyCell) self.activeCell = self.getCellIndex(cell);
      }
      self.selection = null;
      self.updateVirtualDisplay();
    });

    containerEl.addEventListener("open-link", (e) => self.handleOpenLink(e));
    containerEl.addEventListener("copy", (e) => self.handleCopy(e));
    containerEl.addEventListener("paste", (e) => self.handlePaste(e));
    containerEl.addEventListener("keyup", (e) => {
      if (e.key === "Shift") self.containerEl.removeClass("is-selecting");
    });
    containerEl.addEventListener("keydown", (e) => self.handleKeydown(e));
    return self;
  }
  inherit(TableView, host.s13BasesViewBase);

  TableView.prototype.onload = function () {
    const self = this;
    this.scrollWatcher = s13ScrollWatch(this.containerEl, () => self.updateVirtualDisplay());
    this.registerEvent(this.app.workspace.on("css-change", this.updateVirtualDisplay, this));
  };

  TableView.prototype.onunload = function () {
    this.scrollWatcher?.call(this);
    this.scrollWatcher = null;
  };

  TableView.prototype.onResize = function () {
    this.updateVirtualDisplay();
  };

  TableView.prototype.focus = function () {
    this.containerEl.focus({ preventScroll: true });
  };

  /** Finds the {groupIdx,row,column} position of a rendered cell, or null. */
  TableView.prototype.getCellIndex = function (cell) {
    const groups = this.data.groupedData;
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      const column = row.cells.indexOf(cell);
      if (column !== -1) {
        for (let g = 0; g < groups.length; g++) {
          const rowIndex = groups[g].entries.indexOf(row.entry);
          if (rowIndex !== -1) return { groupIdx: g, row: rowIndex, column };
        }
      }
    }
    return null;
  };

  /** The content-space rectangle a cell occupies (used to keep it visible while navigating). */
  TableView.prototype.getCellRect = function (cell) {
    const groupIdx = cell.groupIdx;
    const column = cell.column;
    const row = cell.row;
    const scrollRect = this.scrollEl.getBoundingClientRect();
    const scrollTop = this.scrollEl.scrollTop;
    const bodyRect = this.groups[groupIdx].tbodyEl.getBoundingClientRect();
    const baseHeight = this.getRowBaseHeight();
    const rowHeight = baseHeight * this.getRowHeightMult();
    const rowTop = bodyRect.top - scrollRect.top + scrollTop + row * rowHeight;
    let left = 0;
    for (let i = 0; i < column; i++) {
      left += this.columnInfo[this.data.properties[i]].getWidth(this.minColWidth, this.maxColWidth);
    }
    const right = left + this.columnInfo[this.data.properties[column]].getWidth(this.minColWidth, this.maxColWidth);
    return {
      top: rowTop - baseHeight,
      bottom: rowTop + rowHeight + (this.footerSummary.shouldDisplay() ? baseHeight : 0),
      left,
      right,
    };
  };

  /** Maps a pointer position to the nearest cell of one group (used while drag-selecting). */
  TableView.prototype.getClosestCellIndexWithinGroup = function (event, groupIdx) {
    const rect = this.containerEl.getBoundingClientRect();
    const scale = rect.width / this.containerEl.offsetWidth;
    const bodyTop = this.groups[groupIdx].tbodyEl.getBoundingClientRect().top;
    const y = (event.clientY - bodyTop) / scale;
    const edge = s50IsLtr(this.containerEl) ? rect.left : rect.right;
    const distance = Math.abs((event.clientX - edge) / scale);
    const rowHeight = this.getRowBaseHeight() * this.getRowHeightMult();
    const row = Math.floor(y / rowHeight);
    const infos = this.columnInfo;
    const properties = this.data.properties;
    let column = -1;
    let acc = 0;
    for (let i = 0; i < properties.length; i++) {
      const info = infos[properties[i]];
      if (info) acc += info.getWidth(this.minColWidth, this.maxColWidth);
      if (acc > distance) {
        column = i;
        break;
      }
    }
    if (column === -1) column = properties.length - 1;
    return {
      groupIdx,
      row: Math.clamp(row, 0, this.data.groupedData[groupIdx].entries.length - 1),
      column,
    };
  };

  /** Right-click on a selected range: offer copy/clear/delete plus the regular file menu. */
  TableView.prototype.onTableCellContextmenu = function (e, t) {
    const self = this;
    if (e.defaultPrevented || !this.selection) return;
    const cell = this.getCellFromDom(t);
    if (!(cell instanceof host.s13BodyCell)) return;
    const range = this.selection;
    const index = this.getCellIndex(cell);
    if (!index) return;
    if (index.groupIdx !== range.groupIdx || range.top > index.row || index.row > range.bottom ||
        range.start > index.column || index.column > range.end) return;
    e.preventDefault();
    s50SwallowContextMenu(e);
    const group = this.data.groupedData[range.groupIdx];
    const files = [];
    for (let row = range.top; row <= range.bottom; row++) files.push(group.entries[row].file);
    if (files.length === 0) return;
    const menu = host.Menu.forEvent(e).addSections([
      "title", "open", "selection", "clipboard", "info", "info.copy",
      "action", "view", "system", "", "danger",
    ]);
    if (host.Platform.isDesktopApp && e.win.electron) {
      const contents = e.win.electron.remote.getCurrentWebContents();
      menu.addItem((item) => item
        .setSection("clipboard")
        .setTitle(env().gm.interface.menu.copy())
        .setIcon("lucide-copy")
        .onClick(() => contents?.copy()));
      menu.addItem((item) => item
        .setSection("clipboard")
        .setTitle(env().gm.interface.menu.paste())
        .setIcon("lucide-clipboard-check")
        .onClick(() => contents?.paste()));
    }
    menu.addItem((item) => item
      .setSection("danger")
      .setTitle(s13BasesTableI18n().actionClearSelection())
      .setIcon("lucide-eraser")
      .setWarning(true)
      .onClick(() => self.clearSelectedCells()));
    menu.addItem((item) => item
      .setSection("danger")
      .setTitle(env().gm.plugins.fileExplorer.menuOptDelete())
      .setIcon("lucide-trash-2")
      .setWarning(true)
      .onClick(async () => {
        for (const file of files) {
          if (await self.app.vault.exists(file.path)) await self.app.fileManager.promptForDeletion(file);
        }
      }));
    if (files.length === 1) {
      this.app.workspace.trigger("file-menu", menu, files[0], "bases-context-menu", null);
    } else {
      this.app.workspace.trigger("files-menu", menu, files, "bases-context-menu", null);
    }
  };

  /** Pointer-down on a cell: move the caret, extend the selection with shift, start drag-select. */
  TableView.prototype.onTableSelectionStart = function (e, t) {
    const self = this;
    if (this.selection && e.button === 2) e.preventDefault();
    if (e.defaultPrevented || e.button !== 0 || e.pointerType === "touch") return;
    if (!(e.shiftKey || !e.targetNode.instanceOf(HTMLElement) || !e.targetNode.draggable)) return;
    const cell = this.getCellFromDom(t);
    if (!(cell instanceof host.s13BodyCell)) return;
    const index = this.getCellIndex(cell);
    if (!index) return;
    if (cell.el.contains(e.doc.activeElement)) {
      this.selection = null;
      this.activeCell = index;
      this.updateVirtualDisplay();
      return;
    }
    let anchor = index;
    if (e.shiftKey && this.activeCell && index.groupIdx === this.activeCell.groupIdx) {
      this.selection = s13ExtendRange(null, this.activeCell, index);
      anchor = this.activeCell;
      this.updateVirtualDisplay();
    } else {
      this.selection = null;
      this.activeCell = index;
      this.updateVirtualDisplay();
    }
    let moved = false;
    host.trackPointer(e, () => ({
      move: (ev) => {
        const bounds = self.containerEl.parentElement.getBoundingClientRect();
        if (ev.clientX > bounds.right || ev.clientX < bounds.left || ev.clientY > bounds.bottom || ev.clientY < bounds.top) return;
        const target = self.getClosestCellIndexWithinGroup(ev, anchor.groupIdx);
        if (!moved && !(anchor.row === target.row && anchor.column === target.column)) {
          moved = true;
          host.blurAndClearSelection();
          self.containerEl.focus({ preventScroll: true });
        }
        if (moved) {
          const top = Math.max(Math.min(anchor.row, target.row), 0);
          const bottom = Math.max(anchor.row, target.row);
          const range = {
            groupIdx: anchor.groupIdx,
            top,
            bottom,
            start: Math.min(anchor.column, target.column),
            end: Math.max(anchor.column, target.column),
          };
          if (JSON.stringify(range) !== JSON.stringify(self.selection)) {
            self.selection = range;
            self.updateVirtualDisplay();
          }
        }
      },
    }), 0);
  };

  /** Header drag: resize when the press landed on the resizer, reorder the column otherwise. */
  TableView.prototype.onTableHeaderDragstart = function (e, t) {
    if (e.defaultPrevented) return;
    const cell = this.getCellFromDom(t);
    if (!(cell instanceof host.s13HeaderCell)) return;
    const prop = cell.prop;
    this.app.dragManager.onDragStart(e, null);
    const target = e.targetNode;
    if (target.instanceOf(HTMLElement) && target.matches(".bases-table-header-resizer")) {
      const info = this.columnInfo[prop];
      if (!info) return;
      const isLtr = s50IsLtr(cell.el);
      target.addClass("is-active");
      const startX = e.clientX;
      const savedWidth = info.customWidth;
      const baseWidth = cell.el.offsetWidth;
      let raf = 0;
      const schedule = () => {
        if (!raf) raf = e.win.requestAnimationFrame(() => { raf = 0; this.updateVirtualDisplay(); });
      };
      const onDrag = (ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        info.customWidth = Math.round(baseWidth + (ev.clientX - startX) * (isLtr ? 1 : -1));
        schedule();
      };
      const onDragEnd = () => {
        cleanup();
        info.customWidth = savedWidth;
        schedule();
      };
      const onDrop = (ev) => {
        ev.preventDefault();
        cleanup();
        this.saveColumnSizes();
      };
      const cleanup = () => {
        window.removeEventListener("dragover", onDrag, { capture: true });
        window.removeEventListener("dragenter", onDrag, { capture: true });
        window.removeEventListener("drop", onDrop, { capture: true });
        window.removeEventListener("dragend", onDragEnd);
        target.removeClass("is-active");
      };
      window.addEventListener("dragover", onDrag, { capture: true });
      window.addEventListener("dragenter", onDrag, { capture: true });
      window.addEventListener("drop", onDrop, { capture: true });
      window.addEventListener("dragend", onDragEnd);
      return;
    }

    const properties = this.data.properties;
    const from = properties.indexOf(cell.prop);
    let to = from;
    const indicator = this.scrollEl.createDiv("table-drag-target mod-col");
    indicator.setCssStyles({ top: "0", transition: "all 75ms ease-in" });
    const onDragOver = (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      const isLtr = s50IsLtr(this.containerEl);
      const rect = this.containerEl.getBoundingClientRect();
      const pos = isLtr ? ev.clientX - rect.left : rect.right - ev.clientX;
      if (!indicator.isShown()) this.containerEl.appendChild(indicator);
      const scrollWidth = this.containerEl.scrollWidth;
      const half = floatOr(this.containerEl.getCssPropertyValue("--table-drop-indicator-half-width"), 2);
      to = 0;
      let left = 0;
      let past = true;
      for (const prop of properties) {
        const info = this.columnInfo[prop];
        if (info) {
          const width = info.getWidth(this.minColWidth, this.maxColWidth);
          if (pos < left + (past ? width : 0)) break;
          left += width;
        }
        to++;
        if (prop === cell.prop) past = false;
      }
      if (to === properties.length) left = scrollWidth - half;
      indicator.setCssStyles({
        insetInlineStart: Math.max(left, half) + "px",
        height: rect.height + "px",
      });
    };
    const onDragEnd = () => cleanup();
    const onDrop = (ev) => {
      ev.preventDefault();
      cleanup();
      if (to > from) to--;
      if (to !== from) {
        moveItem(properties, from, to);
        this.config.setOrder(properties);
      }
    };
    const cleanup = () => {
      window.removeEventListener("dragover", onDragOver, { capture: true });
      window.removeEventListener("dragenter", onDragOver, { capture: true });
      window.removeEventListener("drop", onDrop, { capture: true });
      window.removeEventListener("dragend", onDragEnd);
      indicator.detach();
    };
    window.addEventListener("dragover", onDragOver, { capture: true });
    window.addEventListener("dragenter", onDragOver, { capture: true });
    window.addEventListener("drop", onDrop, { capture: true });
    window.addEventListener("dragend", onDragEnd);
  };

  TableView.prototype.setEphemeralState = function (state) {
    const scroll = state.scroll;
    if (scroll && typeof scroll === "object") this.pendingScroll = scroll;
    let changed = false;
    if (Object.hasOwn(state, "selection")) {
      const selection = state.selection;
      this.selection = selection && typeof selection === "object" ? selection : null;
      changed = true;
    }
    if (Object.hasOwn(state, "activeCell")) {
      const activeCell = state.activeCell;
      this.focus();
      this.activeCell = activeCell && typeof activeCell === "object" ? activeCell : null;
      changed = true;
    }
    if (changed) this.updateVirtualDisplay();
  };

  TableView.prototype.getEphemeralState = function () {
    const state = {};
    state.scroll = this.lastScroll;
    state.selection = this.selection;
    state.activeCell = this.activeCell;
    return state;
  };

  TableView.prototype.onTableHeaderClick = function (e, t) {
    if (!e.defaultPrevented && e.button === 0) {
      const cell = this.getCellFromDom(t);
      if (cell) {
        e.preventDefault();
        this.config.setSortProperty(cell.prop, "TOGGLE");
      }
    }
  };

  TableView.prototype.onTableHeaderResizerDblclick = function (e, t) {
    if (e.button === 0) {
      const cell = this.getCellFromDom(t);
      if (cell) {
        const info = this.columnInfo[cell.prop];
        if (info) {
          e.preventDefault();
          info.customWidth = 0;
          info.contentWidth = 0;
          this.updateVirtualDisplay();
          this.saveColumnSizes();
        }
      }
    }
  };

  /** Clears every note property inside the current selection (or the active cell). */
  TableView.prototype.clearSelectedCells = async function () {
    const range = this.selection ?? s13CellRange(this.activeCell);
    if (!range) return;
    const top = range.top;
    const bottom = range.bottom;
    const start = range.start;
    const end = range.end;
    const groupIdx = range.groupIdx;
    const group = this.data.groupedData[groupIdx];
    const self = this;
    await this.createTransaction(async (changes) => {
      for (let rowIndex = top; rowIndex <= bottom; rowIndex++) {
        const entry = group.entries[rowIndex];
        await self.app.fileManager.processFrontMatter(entry.file, (frontmatter) => {
          changes.push({ file: entry.file, start: Object.assign({}, frontmatter), end: frontmatter });
          for (let col = start; col <= end; col++) {
            const parsed = parsePropertyId(self.data.properties[col]);
            if (parsed.type === "note") frontmatter[keyIgnoringCase(frontmatter, parsed.name)] = null;
          }
        });
      }
    });
  };

  TableView.prototype.onDataUpdated = function () {
    this.containerEl.removeClass("is-loading");
    this.pendingScroll = this.lastScroll;
    this.display();
  };

  TableView.prototype.display = function () {
    const properties = this.data.properties;
    const sizes = this.config.get("columnSize");
    if (sizes && typeof sizes === "object") {
      for (const prop of properties) {
        if (Object.hasOwn(sizes, prop)) {
          const width = sizes[prop];
          if (width && Number.isNumber(width)) {
            let info = this.columnInfo[prop];
            if (!info) info = this.columnInfo[prop] = new host.s13ColumnWidth();
            info.customWidth = width;
          }
        }
      }
    }
    const self = this;
    host.s13ReconcileCells(this.groups, this.data.groupedData,
      () => true,
      () => new host.s13TableGroup(self),
      (group, entry) => group.render(properties, entry));
    this.header.render(properties);
    this.footerSummary.render(properties, this.data.data);
    this.updateVirtualDisplay();
  };

  /** Row height multiplier from the "rowHeight" view option ("" = 1). */
  TableView.prototype.getRowHeightMult = function () {
    let mult = 1;
    switch (this.config.get("rowHeight")) {
      case "medium": mult = 2; break;
      case "tall": mult = 4; break;
      case "extra": mult = 8; break;
    }
    return mult;
  };

  TableView.prototype.getRowBaseHeight = function () {
    return floatOr(this.containerEl.getCssPropertyValue("--bases-table-row-height"), 30);
  };

  /** Re-lays out every group, measures columns that have no saved width, renders the visible rows. */
  TableView.prototype.updateVirtualDisplay = function () {
    const self = this;
    const data = this.data;
    const config = this.config;
    const containerEl = this.containerEl;
    if (!(data && config && containerEl.isShown())) return;
    const footerSummary = this.footerSummary;
    const groups = this.groups;
    const header = this.header;
    const rows = this.rows;
    const scrollEl = this.scrollEl;
    const theadEl = this.theadEl;
    const unusedRows = this.unusedRows;
    const columnInfo = this.columnInfo;
    const lastViewport = this.lastViewport;
    const properties = data.properties;

    let activeEl = null;
    const docActive = containerEl.doc.activeElement;
    if (containerEl.contains(docActive) && containerEl !== docActive) activeEl = docActive;

    let activeCell = this.activeCell;
    let selection = this.selection;
    if (activeCell && (activeCell.groupIdx >= data.groupedData.length ||
        activeCell.column > properties.length - 1 ||
        activeCell.row > data.groupedData[activeCell.groupIdx].entries.length - 1)) {
      activeCell = this.activeCell = null;
    }
    if (selection && (selection.groupIdx >= data.groupedData.length ||
        selection.end > properties.length - 1 ||
        selection.bottom > data.groupedData[selection.groupIdx].entries.length - 1)) {
      selection = this.selection = null;
    }

    containerEl.setChildrenInPlace(groups.map((group) => group.tableEl));

    // Columns without a custom or measured width get a throwaway cell holding the
    // longest rendered value, so scrollWidth reveals the natural width.
    let measuringRow = null;
    const measuringCells = [];
    for (const prop of properties) {
      let info = columnInfo[prop];
      if (!info) info = columnInfo[prop] = new host.s13ColumnWidth();
      if (!info.customWidth && !info.contentWidth) {
        let bestEntry = null;
        let bestText = "";
        for (const group of data.groupedData) {
          for (const entry of group.entries) {
            try {
              const value = entry.getValue(prop);
              const text = (value == null ? undefined : value.toString()) || "";
              if (text.length > bestText.length) {
                bestText = text;
                bestEntry = entry;
              }
            } catch (e) { /* unreadable value */ }
          }
        }
        if (bestEntry) {
          if (!measuringRow) measuringRow = groups[0].tbodyEl.createDiv("bases-tr");
          const cell = new host.s13BodyCell(this, prop);
          measuringRow.appendChild(cell.el);
          cell.render(bestEntry);
          cell.el.style.contain = "strict";
          cell.el.addClass("is-measuring");
          measuringCells.push(cell);
        }
      }
    }

    const groupGap = floatOr(containerEl.getCssPropertyValue("--bases-table-group-gap"), 10);
    const rowMult = this.getRowHeightMult();
    const rowBase = this.getRowBaseHeight();
    const rowHeight = rowBase * rowMult;
    this.minColWidth = floatOr(containerEl.getCssPropertyValue("--bases-table-column-min-width"), 40);
    this.maxColWidth = floatOr(containerEl.getCssPropertyValue("--bases-table-column-max-width"), 300);
    const isLtr = s50IsLtr(containerEl);

    for (const group of groups) {
      const tableRect = group.tableEl.getBoundingClientRect();
      const bodyRect = group.tbodyEl.getBoundingClientRect();
      group.selfHeight = tableRect.bottom - tableRect.top - bodyRect.height;
      group.childStart = bodyRect.top - tableRect.top;
    }

    if (groups.length > 0) {
      for (const cell of header.cells) {
        if (cell.el.isShown()) {
          const info = columnInfo[cell.prop];
          if (info) info.headerWidth = cell.innerEl.scrollWidth;
        }
      }
    }
    if (measuringRow) {
      for (const cell of measuringCells) {
        const info = columnInfo[cell.prop];
        if (info) info.contentWidth = cell.renderer.el.scrollWidth;
      }
    }

    const widths = [];
    let totalWidth = 0;
    let allAuto = true;
    for (let i = 0; i < properties.length; i++) {
      const info = columnInfo[properties[i]];
      if (info) {
        const width = widths[i] = info.getWidth(this.minColWidth, this.maxColWidth);
        totalWidth += width;
        if (i === properties.length - 1 && info.customWidth) allAuto = false;
      }
    }
    const availWidth = containerEl.parentElement.clientWidth - 1;
    if (allAuto && properties.length > 0 && totalWidth < availWidth) {
      const extra = availWidth - totalWidth;
      widths[widths.length - 1] += extra;
      totalWidth += extra;
    }

    const containerRect = containerEl.getBoundingClientRect();
    const scrollTop = scrollEl.scrollTop;
    const scrollLeft = scrollEl.scrollLeft;
    const viewport = s13VisibleRect(containerEl);
    this.lastViewport = Object.assign({}, viewport);
    if (lastViewport) {
      const marginX = Math.min(viewport.right - viewport.left, window.innerWidth / 2);
      const marginY = Math.min(viewport.bottom - viewport.top, window.innerHeight / 2, 10 * rowBase);
      if (viewport.left < lastViewport.left) viewport.left -= Math.min(lastViewport.left - viewport.left, marginX);
      if (viewport.right > lastViewport.right) viewport.right += Math.min(viewport.right - lastViewport.right, marginX);
      if (viewport.top < lastViewport.top) viewport.top -= Math.min(lastViewport.top - viewport.top, marginY);
      if (viewport.bottom > lastViewport.bottom) viewport.bottom += Math.min(viewport.bottom - lastViewport.bottom, marginY);
    }
    if (activeEl) {
      const box = ng15OffsetBox(activeEl, containerEl);
      if (box.left < viewport.left) viewport.left = box.left;
      if (box.top < viewport.top) viewport.top = box.top;
      const right = box.left + activeEl.offsetWidth;
      if (right > viewport.right) viewport.right = right;
      const bottom = box.top + activeEl.offsetHeight;
      if (bottom > viewport.bottom) viewport.bottom = bottom;
    }

    containerEl.toggleClass("mod-multiline", rowMult > 1);
    if (measuringRow) measuringRow.detach();

    const visibleRows = [];
    let offsetY = 0;
    const visFrom = isLtr ? viewport.left : containerRect.width - viewport.right;
    const visTo = isLtr ? viewport.right : containerRect.width - viewport.left;
    for (let gi = 0; gi < data.groupedData.length; gi++) {
      const group = groups[gi];
      const entries = data.groupedData[gi].entries;
      const groupTop = offsetY;
      const bodyTop = groupTop + group.childStart;
      const bodyHeight = entries.length * rowHeight;
      const bodyBottom = bodyTop + bodyHeight;
      group.tableEl.setCssStyles({ top: groupTop + "px", width: totalWidth + "px" });
      group.tbodyEl.setCssStyles({ height: bodyHeight + "px" });
      group.tbodyEl.setCssProps({ "--bases-table-row-height": rowHeight + "px" });
      if (bodyTop <= viewport.bottom && bodyBottom >= viewport.top) {
        const firstRow = Math.floor(Math.max(viewport.top - bodyTop, 0) / rowHeight);
        const lastRow = entries.length - Math.floor(Math.max(bodyBottom - viewport.bottom, 0) / rowHeight);
        const rowEls = [];
        for (let rowIndex = firstRow; rowIndex < lastRow; rowIndex++) {
          const entry = entries[rowIndex];
          const found = rows.findIndex((row) => row.entry.file === entry.file);
          let row;
          if (found !== -1) {
            row = rows[found];
            rows.splice(found, 1);
          } else {
            row = unusedRows.length ? unusedRows.pop() : new host.s13EntryRow(self);
          }
          visibleRows.push(row);
          row.render(entry, properties);
          row.virtualize(widths, visFrom, visTo);
          row.el.setCssStyles({ top: rowIndex * rowHeight + "px", width: totalWidth + "px" });
          rowEls.push(row.el);
        }
        if (activeCell && activeCell.groupIdx === gi) {
          const left = widths.slice(0, activeCell.column).reduce((a, b) => a + b, 0);
          const rowTop = activeCell.row * rowHeight;
          const insetStart = activeCell.column === 0 ? 1 : 0;
          const insetTop = activeCell.row === 0 ? 1 : 0;
          this.activeCellEl.toggleClass("mod-selection", !!selection);
          this.activeCellEl.setCssStyles({
            insetBlockStart: rowTop + insetTop + "px",
            insetInlineStart: left + insetStart + "px",
            width: widths[activeCell.column] - 1 - insetStart + "px",
            height: rowHeight - 1 - insetTop + "px",
          });
          rowEls.push(this.activeCellEl);
        }
        if (selection && selection.groupIdx === gi) {
          const left = widths.slice(0, selection.start).reduce((a, b) => a + b, 0);
          const width = widths.slice(selection.start, selection.end + 1).reduce((a, b) => a + b, 0);
          const top = selection.top * rowHeight;
          const height = (selection.bottom - selection.top + 1) * rowHeight;
          this.selectionEl.setCssStyles({
            insetBlockStart: top + "px",
            insetInlineStart: left + "px",
            width: width + "px",
            height: height + "px",
          });
          rowEls.push(this.selectionEl);
        }
        group.tbodyEl.setChildrenInPlace(rowEls);
      }
      group.virtualize(totalWidth, widths, visFrom, visTo);
      offsetY += group.selfHeight + bodyHeight;
      if (gi < data.groupedData.length - 1) offsetY += groupGap;
    }

    for (const row of rows) row.el.detach();
    this.rows = visibleRows;
    this.unusedRows = rows.concat(unusedRows);
    if (this.unusedRows.length > 10) this.unusedRows.length = 10;

    header.virtualize(widths, visFrom, visTo);
    theadEl.setCssStyles({ width: totalWidth + "px" });
    const children = [theadEl, containerEl];
    if (footerSummary.shouldDisplay()) {
      children.push(footerSummary.el);
      footerSummary.el.setCssStyles({ width: totalWidth + "px" });
      footerSummary.virtualize(widths, visFrom, visTo);
    }
    scrollEl.setChildrenInPlace(children);

    if (activeEl && containerEl.doc.activeElement !== activeEl) {
      activeEl.focus();
      const cell = this.getCellFromDom(activeEl);
      if (cell instanceof host.s13BodyCell) this.activeCell = this.getCellIndex(cell);
    }
    if (!containerEl.style.height) queueMicrotask(() => self.updateVirtualDisplay());
    containerEl.setCssStyles({ width: totalWidth + "px", height: offsetY + "px" });
    if (this.pendingScroll) {
      scrollEl.scrollTop = offsetY * this.pendingScroll.top;
      scrollEl.scrollLeft = totalWidth * this.pendingScroll.left;
      this.lastScroll = this.pendingScroll;
      this.pendingScroll = null;
    } else {
      this.lastScroll = { top: scrollTop / offsetY, left: scrollLeft / totalWidth };
    }
  };

  TableView.prototype.saveColumnSizes = function () {
    const columnInfo = this.columnInfo;
    const sizes = {};
    for (const prop of this.data.properties) {
      if (Object.hasOwn(columnInfo, prop)) {
        const info = columnInfo[prop];
        if (info.customWidth) sizes[prop] = info.customWidth;
      }
    }
    this.config.set("columnSize", sizes);
  };

  TableView.prototype.getCellFromDom = function (el) {
    const td = el.closest(".bases-td");
    return td ? this.cellLookup.get(td) : null;
  };

  /** open-link inside the table: route internal links through the workspace, external ones to the OS. */
  TableView.prototype.handleOpenLink = function (e) {
    if (this.selection) return;
    const entry = this.data.groupedData[this.activeCell.groupIdx].entries[this.activeCell.row];
    const row = this.rows.find((r) => r.entry === entry);
    const cell = row?.cells[this.activeCell.column];
    if (!cell) return;
    const links = Array.from(cell.el.querySelectorAll(".internal-link, .external-link"))
      .map((el) => ({
        href: el.getAttr("href") || el.getAttr("data-href"),
        type: el.hasClass("internal-link") ? "internal" : "external",
      }))
      .filter((link) => !!link.href);
    if (links.length === 0) return;
    e.preventDefault();
    const open = (link) => {
      if (link.type === "internal") {
        this.app.workspace.openLinkText(link.href, entry.file.path, e.detail.paneType);
      } else {
        window.open(link.href, "_blank");
      }
    };
    if (links.length === 1) {
      open(links[0]);
      return;
    }
    const menu = new host.Menu();
    for (const link of links) {
      menu.addItem((item) => item.setTitle(ellipsize(link.href, 100)).onClick(() => open(link)));
    }
    const rect = cell.el.getBoundingClientRect();
    menu.showAtPosition({ x: rect.x, y: rect.bottom });
  };

  /** Copy: the selected cells as TSV/markdown plus the typed-cell JSON the paste side reads back. */
  TableView.prototype.handleCopy = function (e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const range = this.selection ?? s13CellRange(this.activeCell);
    if (!range) return;
    const top = range.top;
    const bottom = range.bottom;
    const start = range.start;
    const end = range.end;
    const groupIdx = range.groupIdx;
    const properties = this.data.properties;
    const header = properties.slice(start, end + 1).map((prop) => this.config.getDisplayName(prop));
    const cellData = [];
    const rows = [];
    const group = this.data.groupedData[groupIdx];
    for (let rowIndex = top; rowIndex <= bottom; rowIndex++) {
      const entry = group.entries[rowIndex];
      const types = [];
      const values = [];
      for (let col = start; col <= end; col++) {
        const prop = properties[col];
        const parsed = parsePropertyId(prop);
        types.push({
          type: parsed.type,
          data: parsed.type === "note" ? entry.getRawProperty(parsed.name) : undefined,
        });
        let text = "";
        try {
          const value = entry.getValue(prop);
          text = value == null || value === env().bW.value ? "" : value.toString();
        } catch (err) { /* unreadable value */ }
        values.push(text);
      }
      cellData.push(types);
      rows.push(values);
    }
    const table = new host.s13TableExport(header, rows);
    e.clipboardData.setData("text/plain", table.toTSV(false));
    e.clipboardData.setData("text/markdown", table.toMarkdown());
    e.clipboardData.setData("basalt/table", table.toObsidianTableClipboard());
    e.clipboardData.setData("basalt/bases-cells", JSON.stringify(cellData));
  };

  /** Paste: write the clipboard payload into the note properties covering the target range. */
  TableView.prototype.handlePaste = async function (e) {
    if (e.defaultPrevented || ng15IsEditableNode(this.containerEl.doc.activeElement)) return;
    if (!this.activeCell) return;
    e.preventDefault();
    const paste = new host.s13PasteData(e.clipboardData, this.selection);
    if (paste.isEmpty()) return;
    const bounds = paste.getBounds(this.activeCell, this.selection);
    this.selection = bounds;
    this.updateVirtualDisplay();
    const top = bounds.top;
    const bottom = bounds.bottom;
    const start = bounds.start;
    const end = bounds.end;
    const groupIdx = bounds.groupIdx;
    const group = this.data.groupedData[groupIdx];
    const lastRow = group.entries.length - 1;
    const lastCol = this.data.properties.length - 1;
    const self = this;
    await this.createTransaction(async (changes) => {
      for (let rowIndex = top; rowIndex <= Math.min(bottom, lastRow); rowIndex++) {
        const entry = group.entries[rowIndex];
        await self.app.fileManager.processFrontMatter(entry.file, (frontmatter) => {
          changes.push({ file: entry.file, start: Object.assign({}, frontmatter), end: frontmatter });
          for (let col = start; col <= Math.min(end, lastCol); col++) {
            const parsed = parsePropertyId(self.data.properties[col]);
            if (parsed.type !== "note") continue;
            const key = keyIgnoringCase(frontmatter, parsed.name);
            if (paste.isPlainValue()) {
              const value = paste.plainValue;
              if (Object.hasOwn(frontmatter, key)) {
                const existing = frontmatter[key];
                if (Array.isArray(existing)) {
                  existing.push(value);
                  continue;
                }
              }
              frontmatter[key] = value;
            } else {
              const value = paste.read(rowIndex - top, start);
              if (value === undefined) continue;
              frontmatter[key] = value;
            }
          }
        });
      }
    });
  };

  /** Keyboard navigation, selection extension, editing shortcuts and undo/redo. */
  TableView.prototype.handleKeydown = function (e) {
    if (e.isComposing || e.defaultPrevented) return;
    const data = this.data;
    const properties = data.properties;
    if (!this.activeCell && e.key.match(/^(Arrow|Page|Home|Tab|End)/)) {
      e.preventDefault();
      this.activeCell = { groupIdx: 0, column: 0, row: 0 };
      this.updateVirtualDisplay();
      return;
    }
    if (e.key === "Shift" && this.containerEl.isActiveElement()) {
      this.containerEl.addClass("is-selecting");
      return;
    }
    if (!this.activeCell) return;
    let row = this.activeCell.row;
    let column = this.activeCell.column;
    let groupIdx = this.activeCell.groupIdx;
    const lastCol = properties.length - 1;
    const lastGroup = data.groupedData.length - 1;

    if (e.key === "Tab") {
      e.preventDefault();
      this.containerEl.focus({ preventScroll: true });
      if (e.shiftKey) {
        if (column === 0) {
          if (row === 0) {
            if (groupIdx === 0) return;
            groupIdx--;
            row = data.groupedData[groupIdx].entries.length - 1;
          } else row--;
          column = lastCol;
        } else column--;
      } else if (column === lastCol) {
        if (row === data.groupedData[groupIdx].entries.length - 1) {
          if (groupIdx === lastGroup) return;
          groupIdx++;
          row = 0;
        } else row++;
        column = 0;
      } else column++;
      this.selection = null;
      this.activeCell = { row, column, groupIdx };
      s50ScrollRectIntoView(this.scrollEl, this.getCellRect(this.activeCell));
      this.updateVirtualDisplay();
      return;
    }

    if (ng15IsEditableNode(e.targetNode)) return;

    // Mod+Shift+Arrow: grow the selection to the group/data edge in that direction.
    if (e.key === "ArrowDown" && host.Keymap.isModifier(e, "Mod") && e.shiftKey) {
      e.preventDefault();
      this.selection = {
        groupIdx,
        top: row,
        bottom: data.groupedData[groupIdx].entries.length - 1,
        start: this.selection?.start ?? column,
        end: this.selection?.end ?? column,
      };
      this.updateVirtualDisplay();
      return;
    }
    if (e.key === "ArrowUp" && host.Keymap.isModifier(e, "Mod") && e.shiftKey) {
      e.preventDefault();
      this.selection = {
        groupIdx,
        top: 0,
        bottom: row,
        start: this.selection?.start ?? column,
        end: this.selection?.end ?? column,
      };
      this.updateVirtualDisplay();
      return;
    }
    if (e.key === "ArrowLeft" && host.Keymap.isModifier(e, "Mod") && e.shiftKey) {
      e.preventDefault();
      this.selection = {
        groupIdx,
        top: this.selection?.top ?? row,
        bottom: this.selection?.bottom ?? row,
        start: 0,
        end: column,
      };
      this.updateVirtualDisplay();
      return;
    }
    if (e.key === "ArrowRight" && host.Keymap.isModifier(e, "Mod") && e.shiftKey) {
      e.preventDefault();
      this.selection = {
        groupIdx,
        top: this.selection?.top ?? row,
        bottom: this.selection?.bottom ?? row,
        start: column,
        end: lastCol,
      };
      this.updateVirtualDisplay();
      return;
    }

    if (!e.key.match(/^(Arrow|Page|Home|End)/) || e.metaKey || e.ctrlKey) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (this.selection) return;
        const group = data.groupedData[this.activeCell.groupIdx];
        const entry = group.entries[this.activeCell.row];
        const viewRow = this.rows.find((r) => r.entry === entry);
        if (viewRow) {
          const cell = viewRow.cells[this.activeCell.column];
          if (!cell) return;
          const parsed = parsePropertyId(cell.prop);
          if (parsed.type === "formula" && cell.renderer instanceof host.s13PropValueRenderer) {
            cell.renderer.showFormulaEditor();
          } else if (parsed.type === "note" && cell.renderer instanceof host.s13PropEditorRenderer) {
            const editor = cell.renderer.propertyEditor;
            if (editor) {
              if (editor.type === "checkbox") {
                const raw = entry.getRawProperty(parsed.name);
                editor.setValue(!raw);
                this.updateProperty(entry.file, parsed.name, !raw);
              } else {
                editor.focus("end");
              }
            }
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.selection = null;
        this.updateVirtualDisplay();
      } else if (e.key === " " && e.ctrlKey) {
        e.preventDefault();
        if (!this.activeCell) return;
        const groupIdx2 = this.activeCell.groupIdx;
        const range = this.selection ?? s13CellRange(this.activeCell);
        this.selection = {
          top: 0,
          bottom: data.groupedData[groupIdx2].entries.length - 1,
          start: range.start,
          end: range.end,
          groupIdx: groupIdx2,
        };
        this.updateVirtualDisplay();
      } else if (e.key === " " && e.shiftKey) {
        e.preventDefault();
        if (!this.activeCell) return;
        const range = this.selection ?? s13CellRange(this.activeCell);
        this.selection = {
          top: range.top,
          bottom: range.bottom,
          start: 0,
          end: properties.length - 1,
          groupIdx: this.activeCell.groupIdx,
        };
        this.updateVirtualDisplay();
      } else if (e.key === "a" && host.Keymap.isModifier(e, "Mod")) {
        e.preventDefault();
        if (this.activeCell) {
          const groupIdx2 = this.activeCell.groupIdx;
          this.selection = {
            top: 0,
            start: 0,
            end: properties.length - 1,
            bottom: data.groupedData[groupIdx2].entries.length - 1,
            groupIdx: groupIdx2,
          };
        }
        this.updateVirtualDisplay();
      } else if (e.key === "z" && host.Keymap.isModifier(e, "Mod") && e.shiftKey) {
        e.preventDefault();
        this.redoTransaction();
      } else if (e.key === "z" && host.Keymap.isModifier(e, "Mod")) {
        e.preventDefault();
        this.undoTransaction();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        this.clearSelectedCells();
      }
      return;
    }

    // Arrow/Page/Home/End navigation (without meta/ctrl).
    e.preventDefault();
    const pageRows = () => {
      const rect = s13VisibleRect(this.containerEl);
      const rowHeight = this.getRowBaseHeight() * this.getRowHeightMult();
      return Math.floor((rect.bottom - rect.top) / rowHeight);
    };
    const extend = e.shiftKey;
    if (e.key === "ArrowDown" || e.key === "PageDown") {
      const steps = e.key === "PageDown" ? pageRows() : 1;
      for (let s = 0; s < steps; s++) {
        const lastRow = data.groupedData[groupIdx].entries.length - 1;
        if (row < lastRow) row++;
        else {
          if (extend) break;
          if (groupIdx >= lastGroup) break;
          row = 0;
          groupIdx++;
        }
      }
    }
    if (e.key === "ArrowUp" || e.key === "PageUp") {
      const steps = e.key === "PageUp" ? pageRows() : 1;
      for (let s = 0; s < steps; s++) {
        if (row > 0) row--;
        else {
          if (extend) break;
          if (groupIdx <= 0) break;
          groupIdx--;
          row = data.groupedData[groupIdx].entries.length - 1;
        }
      }
    } else if (e.key === "ArrowRight") {
      column = host.Keymap.isModifier(e, "Mod") ? lastCol : Math.min(column + 1, lastCol);
    } else if (e.key === "End") {
      column = lastCol;
    } else if (e.key === "ArrowLeft") {
      column = host.Keymap.isModifier(e, "Mod") ? 0 : Math.max(column - 1, 0);
    } else if (e.key === "Home") {
      column = 0;
    }
    this.selection = extend ? s13ExtendRange(this.selection, this.activeCell, { row, column, groupIdx }) : null;
    this.activeCell = { row, column, groupIdx };
    s50ScrollRectIntoView(this.scrollEl, this.getCellRect(this.activeCell));
    this.updateVirtualDisplay();
  };

  TableView.getViewOptions = function () {
    const tableI18n = s13BasesTableI18n();
    return [
      {
        displayName: tableI18n.labelRowHeight(),
        type: "dropdown",
        key: "rowHeight",
        options: {
          "": tableI18n.optionShort(),
          medium: tableI18n.optionMedium(),
          tall: tableI18n.optionTall(),
          extra: tableI18n.optionExtraTall(),
        },
      },
    ];
  };

  return TableView;
}
