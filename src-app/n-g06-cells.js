// ng06 table building blocks: the cell base constructor, column width state,
// the row/group classes and the header/body/summary cells used by the table
// view (defineS50BasesTableView, another slice).
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { parsePropertyId } from "./text.js";
import { ng06Div, ng06Icon, ng06T } from "./n-g06-shared.js";
import { s13BasesTableI18n } from "./s13-consts.js";

/** Per-column width bookkeeping: header-measured, content-measured and user-set widths. */
export function ng06DefineColumnWidth() {
  function ColumnWidth() {
    this.headerWidth = 0;
    this.contentWidth = 0;
    this.customWidth = 0;
  }
  ColumnWidth.prototype.getWidth = function (min, max) {
    if (this.customWidth) return Math.min(max, Math.max(min, this.customWidth));
    return Math.min(max, Math.max(min, Math.max(this.headerWidth, this.contentWidth)));
  };
  return ColumnWidth;
}

/**
 * Cell base constructor (`var j4`): builds the `.bases-td` element, records the
 * view/property and registers the element -> cell mapping the table view uses.
 * Used directly (`CellBase.call(this, view, prop)`) and as an inherit parent.
 */
export function ng06CellBase(view, prop) {
  const self = this;
  self.view = view;
  self.prop = prop;
  self.el = ng06Div("bases-td");
  if (prop != null) self.el.setAttr("data-property", prop);
  if (view && view.cellLookup) view.cellLookup.set(self.el, self);
  return self;
}

/** Shared horizontal virtualization for rows of absolutely positioned cells. */
function ng06VirtualizeCells(cells, widths, from, to) {
  let x = 0;
  const keep = [];
  for (let i = 0; i < cells.length; i++) {
    const w = widths[i] || 0;
    const cell = cells[i];
    if (x + w > from && x < to) {
      cell.el.setCssStyles({ insetInlineStart: x + "px", width: w + "px" });
      keep.push(cell.el);
    } else {
      cell.el.detach();
    }
    x += w;
  }
  return keep;
}

/** `var q4` — one `bases-tr` row shell: element plus its cell list. */
export function ng06DefineTableRow() {
  function TableRow(view) {
    const self = this;
    self.view = view;
    self.cells = [];
    self.el = ng06Div("bases-tr");
    return self;
  }
  TableRow.prototype.virtualize = function (widths, from, to) {
    this.el.setChildrenInPlace(ng06VirtualizeCells(this.cells, widths, from, to));
  };
  return TableRow;
}

/** `var U4` — a table group: optional heading, optional group summary, tbody of rows. */
export function ng06DefineTableGroup(host) {
  function TableGroup(view) {
    const self = this;
    self.view = view;
    self.tableEl = ng06Div("bases-table");
    self.tbodyEl = ng06Div("bases-tbody");
    self.rows = [];
    self.summaryRow = new (host.s13SummaryRow)(view, "group");
    return self;
  }
  TableGroup.prototype.render = function (columns, group) {
    const view = this.view;
    const entries = group.entries || [];
    const rows = [];
    for (let i = 0; i < entries.length; i++) {
      let row = this.rows[i];
      if (!row) row = this.rows[i] = new (host.s13EntryRow)(view);
      row.render(entries[i], columns);
      rows.push(row);
    }
    if (this.rows.length > entries.length) {
      for (let i = entries.length; i < this.rows.length; i++) this.rows[i].el.detach();
      this.rows.length = entries.length;
    }
    this.tbodyEl.setChildrenInPlace(rows.map((r) => r.el));
    const children = [];
    const heading = view.createGroupHeadingEl(group);
    if (heading) children.push(heading);
    if (this.summaryRow.shouldDisplay()) {
      this.summaryRow.render(columns, entries);
      children.push(this.summaryRow.el);
    }
    children.push(this.tbodyEl);
    this.tableEl.setChildrenInPlace(children);
  };
  TableGroup.prototype.virtualize = function (width, widths, from, to) {
    this.tableEl.setCssStyles({ width: width + "px" });
    if (this.summaryRow.shouldDisplay()) this.summaryRow.virtualize(widths, from, to);
  };
  return TableGroup;
}

/** `var W4` — header row: one HeaderCell per property. */
export function ng06DefineHeaderRow(host) {
  function HeaderRow(view) {
    const self = host.s13TableRow.call(this, view) || this;
    self.el.addClass("bases-thead-row");
    return self;
  }
  inherit(HeaderRow, host.s13TableRow);
  HeaderRow.prototype.render = function (properties) {
    const cells = [];
    for (const prop of properties) {
      let cell = this.cells.find((c) => c.prop === prop);
      if (!cell) {
        cell = new (host.s13HeaderCell)(this.view, prop);
        this.cells.push(cell);
      }
      cell.render(prop);
      cells.push(cell);
    }
    const keep = new Set(properties);
    this.cells = this.cells.filter((c) => keep.has(c.prop));
    this.el.setChildrenInPlace(cells.map((c) => c.el));
  };
  HeaderRow.prototype.virtualize = function (widths, from, to) {
    this.el.setChildrenInPlace(ng06VirtualizeCells(this.cells, widths, from, to));
  };
  return HeaderRow;
}

/** `var G4` — body row: one BodyCell per property for a single entry. */
export function ng06DefineEntryRow(host) {
  function EntryRow(view) {
    const self = host.s13TableRow.call(this, view) || this;
    self.entry = null;
    return self;
  }
  inherit(EntryRow, host.s13TableRow);
  EntryRow.prototype.render = function (entry, properties) {
    this.entry = entry;
    const cells = [];
    for (const prop of properties) {
      let cell = this.cells.find((c) => c.prop === prop);
      if (!cell) {
        cell = new (host.s13BodyCell)(this.view, prop);
        this.cells.push(cell);
      }
      cell.render(entry);
      cells.push(cell);
    }
    const keep = new Set(properties);
    this.cells = this.cells.filter((c) => keep.has(c.prop));
    this.el.setChildrenInPlace(cells.map((c) => c.el));
  };
  EntryRow.prototype.virtualize = function (widths, from, to) {
    this.el.setChildrenInPlace(ng06VirtualizeCells(this.cells, widths, from, to));
  };
  return EntryRow;
}

/** `var Y4` — summary row (group or footer): one SummaryCell per property. */
export function ng06DefineSummaryRow(host) {
  function SummaryRow(view, location) {
    const self = host.s13TableRow.call(this, view) || this;
    self.location = location || "group";
    self.el.addClass("bases-table-group-summary-row");
    return self;
  }
  inherit(SummaryRow, host.s13TableRow);
  SummaryRow.prototype.shouldDisplay = function () {
    const config = this.view.config;
    if (!config || !config.summaries) return false;
    const order = config.getOrder();
    const keys = Object.keys(config.summaries);
    if (!keys.some((k) => order.includes(k))) return false;
    const groups = this.view.data && this.view.data.groupedData;
    return (groups && groups.length > 1) || this.location === "footer";
  };
  SummaryRow.prototype.render = function (properties, entries) {
    const cells = [];
    for (const prop of properties) {
      let cell = this.cells.find((c) => c.prop === prop);
      if (!cell) {
        cell = new (host.s13SummaryCell)(this.view, prop);
        this.cells.push(cell);
      }
      cell.render(prop, entries);
      cells.push(cell);
    }
    const keep = new Set(properties);
    this.cells = this.cells.filter((c) => keep.has(c.prop));
    this.el.setChildrenInPlace(cells.map((c) => c.el));
  };
  SummaryRow.prototype.virtualize = function (widths, from, to) {
    this.el.setChildrenInPlace(ng06VirtualizeCells(this.cells, widths, from, to));
  };
  return SummaryRow;
}

/** `var _4` — header cell: label, type icon, sort glyph, resizer and the column context menu. */
export function ng06DefineHeaderCell(host) {
  function HeaderCell(view, prop) {
    const self = ng06CellBase.call(this, view, prop) || this;
    self.innerEl = self.el.createDiv("bases-table-header");
    const label = self.innerEl.createDiv("bases-table-header-label");
    self.iconEl = label.createDiv("bases-table-header-icon");
    self.nameEl = label.createDiv("bases-table-header-name");
    self.sortEl = label.createDiv("bases-table-header-sort");
    self.innerEl.createDiv("bases-table-header-resizer");
    self.el.draggable = true;
    self.el.on("contextmenu", (e) => self.showMenu(e));
    self.el.on("click", (e) => {
      if (env().Yl.isMobile && e.detail === 1) self.showMenu(e);
    });
    return self;
  }
  inherit(HeaderCell, ng06CellBase);

  HeaderCell.prototype.render = function (propertyId) {
    this.prop = propertyId;
    this.el.setAttr("data-property", propertyId);
    const view = this.view;
    const config = view.config;
    const parsed = parsePropertyId(propertyId);
    this.el.toggleClass("mod-formula", parsed.type === "formula");
    this.el.toggleClass("mod-implicit", parsed.type === "file");
    this.nameEl.setText(config ? config.getDisplayName(propertyId) : parsed.name);
    // type icon
    if (parsed.type === "formula") ng06Icon(this.iconEl, "lucide-square-function");
    else if (parsed.type === "file") ng06Icon(this.iconEl, "lucide-info");
    else {
      try {
        const info = view.app.metadataTypeManager.getPropertyInfo(parsed.name);
        ng06Icon(this.iconEl, info && info.widget ? view.app.metadataTypeManager.getWidget(info.widget).icon : "lucide-info");
      } catch (e) { ng06Icon(this.iconEl, "lucide-info"); }
    }
    // sort glyph
    this.sortEl.empty();
    const sort = config && config.getSort ? config.getSort() : [];
    const entry = sort.find((s) => s.property === propertyId);
    if (entry) {
      this.el.setAttr("data-sort", entry.direction);
      ng06Icon(this.sortEl.createSpan(), entry.direction === "ASC" ? "lucide-chevron-up" : "lucide-chevron-down");
    } else {
      this.el.removeAttribute("data-sort");
    }
  };

  HeaderCell.prototype.showMenu = function (event) {
    const self = this;
    const view = this.view;
    const config = view.config;
    const queryController = view.queryController;
    const prop = this.prop;
    const parsed = parsePropertyId(prop);
    const menu = host.Menu.forEvent(event).addSections(["action", "sort", "", "danger"]);
    const t = s13BasesTableI18n();
    menu.addItem((item) => item
      .setSection("action").setTitle(t.actionHideColumn()).setIcon("lucide-eye-off")
      .onClick(() => {
        const order = config.getOrder().filter((p) => p !== prop);
        config.setOrder(order);
      }));
    menu.addItem((item) => item
      .setSection("danger").setTitle(parsed.type === "formula" ? t.actionEditFormula() : t.actionEditProperty())
      .setIcon("lucide-edit-3")
      .onClick(() => {
        const name = parsed.name;
        const menu2 = new (host.s13BasesMenu)(view.app, self.el, ng06T().titleEditProperty({ name }));
        menu2.scrollEl.createDiv("bases-toolbar-menu-container", (bar) => {
          const header = bar.createDiv("bases-toolbar-menu-container-header");
          header.createDiv("menu-title").createDiv({ cls: "menu-title-inner", text: ng06T().titleEditProperty({ name }) });
          const btn = header.createDiv("clickable-icon");
          const actions = new (host.s13PropActionsMenu)(queryController, prop, false);
          btn.addEventListener("click", (e) => actions.showActions(e, btn));
          ng06Icon(btn, "lucide-more-vertical");
          bar.appendChild(actions.containerEl);
        });
        menu2.setAutoDestroy(self.el);
        menu2.onClose(() => view.focus());
        menu2.setOpen(true);
      }));
    menu.addItem((item) => item
      .setSection("action").setTitle(t.actionSelectSummary()).setIcon("lucide-calculator")
      .onClick(() => {
        const entries = [];
        for (const g of view.data.groupedData) for (const e of g.entries) entries.push(e);
        const values = entries.map((e) => { try { return e.getValue(prop); } catch (err) { return null; } });
        const summary = new (host.s13SummaryValues)(view.app, values.filter((v) => v != null));
        new (host.s13SummaryMenuController)(queryController, config, prop, summary, self.el);
      }));
    if (host.s13IsGroupable(prop, queryController)) {
      menu.addItem((item) => item
        .setSection("action").setTitle(t.actionGroupBy()).setIcon("lucide-group")
        .onClick(() => config.setGroupBy({ property: prop, direction: "ASC" })));
    }
    const current = (config.getSort() || []).find((s) => s.property === prop);
    menu.addItem((item) => item
      .setSection("sort").setTitle(t.actionSortAZ()).setIcon("lucide-arrow-down-wide-narrow")
      .setChecked(current && current.direction === "ASC")
      .onClick(() => config.setSortProperty(prop, "ASC")));
    menu.addItem((item) => item
      .setSection("sort").setTitle(t.actionSortZA()).setIcon("lucide-arrow-up-narrow-wide")
      .setChecked(current && current.direction === "DESC")
      .onClick(() => config.setSortProperty(prop, "DESC")));
    if (current) {
      menu.addItem((item) => item
        .setSection("sort").setTitle(t.actionSortDefault()).setIcon("lucide-eraser").setWarning(true)
        .onClick(() => config.setSortProperty(prop, "NONE")));
    }
    if (parsed.type === "note") {
      const name = parsed.name;
      const widgets = view.app.metadataTypeManager.registeredTypeWidgets;
      const info = view.app.metadataTypeManager.getPropertyInfo(name);
      const currentType = info && info.widget;
      menu.addItem((item) => item
        .setSection("action.changeType").setTitle(env().gm.properties.optionPropertyType()).setIcon("lucide-info"));
      for (const widgetName of Object.keys(widgets)) {
        const widget = widgets[widgetName];
        const reserved = widget.reservedKeys;
        const disabled = Array.isArray(reserved) && reserved.length > 0 && !reserved.includes(name);
        menu.addItem((item) => item
          .setSection("action.changeType").setTitle(widget.name()).setIcon(widget.icon)
          .setChecked(widgetName === currentType).setDisabled(disabled)
          .onClick(() => view.app.metadataTypeManager.setType(name, widgetName)));
      }
    }
    menu.showAtMouseEvent(event);
  };
  return HeaderCell;
}

/** `var K4` — editable body cell: hosts the property renderer/editor. */
export function ng06DefineBodyCell(host) {
  function BodyCell(view, prop) {
    const self = ng06CellBase.call(this, view, prop) || this;
    self.renderer = null;
    return self;
  }
  inherit(BodyCell, ng06CellBase);
  BodyCell.prototype.render = function (entry) {
    const inner = this.el.createDiv("bases-table-cell");
    if (this.renderer) this.renderer.destroy && this.renderer.destroy();
    this.renderer = this.view.createRenderer(this.prop, inner);
    this.renderer.render ? this.renderer.render(entry) : null;
    inner.on("click", (e) => {
      if (e.defaultPrevented) return;
      const editor = this.renderer && this.renderer.propertyEditor;
      if (editor && editor.type !== "checkbox") editor.focus();
    });
  };
  return BodyCell;
}

/** `var Q4` — summary/aggregate cell with the summary picker. */
export function ng06DefineSummaryCell(host) {
  function SummaryCell(view, prop) {
    const self = ng06CellBase.call(this, view, prop) || this;
    self.entries = null;
    self.innerEl = self.el.createDiv("bases-table-summary-cell");
    const btn = self.innerEl.createDiv("summary-expand-button clickable-icon");
    ng06Icon(btn, "lucide-chevrons-up-down");
    self.contentEl = self.innerEl.createDiv("summary-content");
    self.menu = null;
    btn.on("click", (e) => { e.preventDefault(); self.toggleMenu(e); });
    self.el.on("click", (e) => { if (e.target === self.el || e.target === self.contentEl) self.toggleMenu(e); });
    return self;
  }
  inherit(SummaryCell, ng06CellBase);

  SummaryCell.prototype.toggleMenu = function (event) {
    if (this.menu && this.menu.isOpen && this.menu.isOpen()) { this.menu.close(); return; }
    this.menu = null;
    const view = this.view;
    const config = view.config;
    const prop = this.prop;
    const entries = this.entries || [];
    const values = [];
    for (const entry of entries) {
      try {
        const v = entry.getValue(prop);
        if (v != null) values.push(v);
      } catch (e) { /* skip unreadable */ }
    }
    const summary = new (host.s13SummaryValues)(view.app, values);
    const ctl = new (host.s13SummaryMenuController)(view.queryController, config, prop, summary, this.el);
    this.menu = ctl;
  };

  SummaryCell.prototype.render = function (propertyId, entries) {
    this.prop = propertyId;
    this.entries = entries;
    const view = this.view;
    const config = view.config;
    const key = config && config.getSummaryKey ? config.getSummaryKey(propertyId) : null;
    let value = null;
    if (key) {
      try { value = view.data && view.data.getSummaryValue ? view.data.getSummaryValue(view.queryController, entries, propertyId, key) : null; } catch (e) { value = null; }
    }
    if (key === this.lastKey && env().gW.equals(this.lastValue, value)) return;
    this.lastKey = key;
    this.lastValue = value;
    this.contentEl.empty();
    if (key) {
      this.contentEl.createDiv({ cls: "summary-function-name", text: key });
      const valueEl = this.contentEl.createDiv("summary-function-value");
      if (value == null || value === host.s13BasesValueEmpty.value) {
        valueEl.setText(env().gm.properties.labelNoValue());
      } else if (typeof value.renderTo === "function") {
        value.renderTo(valueEl, view.app.renderContext);
      } else {
        valueEl.setText(String(value));
      }
    } else {
      this.contentEl.createSpan({ cls: "placeholder", text: s13BasesTableI18n().labelSummary() });
    }
  };
  return SummaryCell;
}

/** `var R4` — clipboard payload reader for table paste (see spec 3.7). */
export function ng06DefinePasteData() {
  function PasteData(clipboard, cell, range) {
    this.plainValue = null;
    this.rawValues = null;
    this.tableValues = null;
    const text = clipboard && clipboard.getData ? clipboard.getData("text/plain") : "";
    if (text) this.plainValue = text;
    const cellsJson = clipboard && clipboard.getData ? safeJson(clipboard.getData("basalt/bases-cells")) : null;
    if (cellsJson && Array.isArray(cellsJson)) this.rawValues = cellsJson;
    const tableJson = clipboard && clipboard.getData ? safeJson(clipboard.getData("basalt/table")) : null;
    if (tableJson && Array.isArray(tableJson.rows)) this.tableValues = tableJson.rows;
    if (!this.tableValues && this.plainValue && this.plainValue.includes("\t")) {
      this.tableValues = this.plainValue.split("\n").map((line) => line.split("\t"));
    }
    if (!this.rawValues && !this.tableValues && cell && range == null && cell.top < cell.bottom && this.plainValue && this.plainValue.includes("\n")) {
      this.tableValues = this.plainValue.split("\n").map((line) => [line]);
    }
    if (range == null && cell) { this._cell = cell; this._range = null; }
    else { this._cell = cell; this._range = range; }
  }
  function safeJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }
  PasteData.prototype.isEmpty = function () {
    return !this.rawValues && !this.tableValues && !this.plainValue;
  };
  PasteData.prototype.isPlainValue = function () {
    return !this.rawValues && !this.tableValues;
  };
  PasteData.prototype.getBounds = function (cell, range) {
    const rowCount = this.tableValues ? Math.max(1, this.tableValues.length) : 1;
    const colCount = this.tableValues && this.tableValues[0] ? Math.max(1, this.tableValues[0].length) : 1;
    const bounds = {
      groupIdx: cell.groupIdx,
      top: cell.row,
      bottom: cell.row + rowCount - 1,
      start: cell.column,
      end: cell.column + colCount - 1,
    };
    if (range) {
      bounds.top = Math.min(range.top, bounds.top);
      bounds.bottom = Math.max(range.bottom, bounds.bottom);
      bounds.start = Math.min(range.start, bounds.start);
      bounds.end = Math.max(range.end, bounds.end);
    }
    return bounds;
  };
  PasteData.prototype.read = function (rowOffset, colOffset) {
    if (this.rawValues) {
      const rows = this.rawValues.length;
      const cols = rows > 0 && this.rawValues[0] ? this.rawValues[0].length : 0;
      const r = rows > 1 ? rowOffset : 0;
      const c = cols > 1 ? colOffset : 0;
      const cellData = this.rawValues[r] && this.rawValues[r][c];
      if (cellData && cellData.type === "note") return cellData.data;
      return undefined;
    }
    if (this.tableValues) {
      const rows = this.tableValues.length;
      const cols = rows > 0 && this.tableValues[0] ? this.tableValues[0].length : 0;
      const r = rows > 1 ? rowOffset : 0;
      const c = cols > 1 ? colOffset : 0;
      const row = this.tableValues[r];
      return row ? row[c] : undefined;
    }
    return this.plainValue;
  };
  return PasteData;
}
