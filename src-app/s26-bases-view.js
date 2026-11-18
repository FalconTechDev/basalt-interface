// Slice s26 — `var h$` BasesView: the abstract base every Bases view type
// (table, cards, ...) derives from. Owns the property renderers, the
// frontmatter edit transactions with undo/redo, grouping headings, table
// export and clipboard copy.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { keyIgnoringCase, parsePropertyId } from "./text.js";
import { emptyToNull } from "./misc.js";
import { s09BasesStrings } from "./s09-formula.js";
import { s09ValueTypeName } from "./s09-query.js";
import { debounceCall } from "./timing.js";

const s26DeepClone = (v) => JSON.parse(JSON.stringify(v));

/** `var h$` — BasesView base class (public API `BasesView`). */
export function s26BasesView(host) {
  const Base = host.Component;
  function BasesView(queryController) {
    const self = Base.call(this) || this;
    self.allProperties = [];
    self.undoStack = [];
    self.redoStack = [];
    self.app = queryController.app;
    self.queryController = queryController;
    return self;
  }
  inherit(BasesView, Base);

  BasesView.prototype.getViewActions = function () { return []; };

  BasesView.prototype.createFileForView = async function (file, extra) {
    return this.queryController.newItemMenu.open(file, extra);
  };

  BasesView.prototype.onResize = function () {};
  BasesView.prototype.focus = function () {};
  BasesView.prototype.setEphemeralState = function (state) {};
  BasesView.prototype.getEphemeralState = function () { return {}; };

  // Runs `fn(changes)` collecting {file,start,end} frontmatter edits; commits the
  // transaction (view refresh + undo bookkeeping) only when a change really wrote.
  BasesView.prototype.createTransaction = async function (fn) {
    const transaction = { changes: [], state: this.getEphemeralState() };
    await fn(transaction.changes);
    const wrote = transaction.changes.some((change) => JSON.stringify(change.start) !== JSON.stringify(change.end));
    if (!wrote) return;
    this.queryController.requestNotifyView();
    this.redoStack = [];
    this.undoStack.push(transaction);
  };

  BasesView.prototype.createGroupHeadingEl = function (group) {
    if (!group.key) return null;
    const app = this.app, config = this.config;
    const el = env().createDiv("bases-group-heading");
    if (config.groupBy) el.createDiv({ cls: "bases-group-property", text: config.getDisplayName(config.groupBy.property) });
    const valueEl = el.createDiv("bases-group-value");
    if (env().gW.equals(group.key, env().bW.value)) valueEl.setText(s09BasesStrings().labelGroupKeyNone());
    else group.key.renderTo(valueEl, app.renderContext);
    return el;
  };

  BasesView.prototype.updateProperty = async function (file, prop, value) {
    const app = this.app;
    value = emptyToNull(value);
    await this.createTransaction(async (changes) => {
      await app.fileManager.processFrontMatter(file, (frontmatter) => {
        const key = keyIgnoringCase(frontmatter, prop);
        changes.push({ file, start: s26DeepClone(frontmatter), end: frontmatter });
        if (!Object.hasOwn(frontmatter, key) && value == null) return frontmatter;
        frontmatter[key] = value;
        return frontmatter;
      });
    });
  };

  BasesView.prototype.undoTransaction = async function () {
    if (this.undoStack.length === 0) return;
    const transaction = this.undoStack.pop();
    this.redoStack.push(transaction);
    this.setEphemeralState(transaction.state);
    const apply = async (change) => {
      await this.app.fileManager.processFrontMatter(change.file, (frontmatter) => {
        if (JSON.stringify(frontmatter) === JSON.stringify(change.end)) Object.assign(frontmatter, change.start);
        return frontmatter;
      });
    };
    for (const change of transaction.changes) await apply(change);
  };

  BasesView.prototype.redoTransaction = async function () {
    if (this.redoStack.length === 0) return;
    const transaction = this.redoStack.pop();
    this.undoStack.push(transaction);
    this.setEphemeralState(transaction.state);
    const apply = async (change) => {
      await this.app.fileManager.processFrontMatter(change.file, (frontmatter) => {
        if (JSON.stringify(frontmatter) === JSON.stringify(change.start)) Object.assign(frontmatter, change.end);
        return frontmatter;
      });
    };
    for (const change of transaction.changes) await apply(change);
  };

  BasesView.prototype.exportTable = function () {
    const data = this.data, config = this.config;
    const header = data.properties.map((prop) => config.getDisplayName(prop));
    const rows = data.data.map((entry) =>
      data.properties.map((prop) => {
        try {
          const value = entry.getValue(prop);
          return value == null || value === env().bW.value ? "" : value.toString();
        } catch (e) { return ""; }
      }));
    return new host.s13TableExport(header, rows);
  };

  BasesView.prototype.copyToClipboard = function () {
    const table = this.exportTable();
    const tsv = table.toTSV(), markdown = table.toMarkdown();
    const payload = {
      "text/plain": tsv,
      "text/markdown": markdown,
      "text/html": host.treeToHtml(host.markdownTree(markdown)),
      "basalt/table": table.toObsidianTableClipboard(),
    };
    const doc = env().activeDocument;
    const textarea = doc.createElement("textarea");
    textarea.value = payload["text/plain"] || Object.values(payload)[0];
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    doc.body.appendChild(textarea);
    let ok = false;
    try {
      doc.addEventListener("copy", function onCopy(e) {
        e.preventDefault();
        for (const type of Object.keys(payload)) e.clipboardData?.setData(type, payload[type]);
      }, { once: true });
      textarea.focus({ preventScroll: true });
      textarea.select();
      ok = doc.execCommand("copy");
    } catch (e) { console.error("Copy failed:", e); }
    textarea.remove();
    const message = ok ? env().gm.interface.copied({ context: "generic" }) : env().gm.interface.copy_failed();
    new host.Notice(message);
  };

  // Picks the renderer for a property: file links for `file.name`, the metadata
  // widget for note properties, the formula renderer for everything else.
  BasesView.prototype.createRenderer = function (prop, type) {
    if (prop === "file.name") return new (env().f$)(this, prop, type);
    if (parsePropertyId(prop).type === "note") return new (env().d$)(this, prop, type);
    return new (env().m$)(this, prop, type);
  };

  return BasesView;
}
