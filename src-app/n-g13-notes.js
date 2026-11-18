// g13: clean-room notes utilities — template variable substitution, frontmatter
// bounds scanning, pane-type/daily-format validators, the word-count pattern +
// worker source, and the four built-in plugins (templates, daily notes, random
// note, word count).

import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { normalizePath, parentPath, lastSegment, baseName, extensionOf, withoutExtension, joinNameExt, isLocalLink, isHiddenPath } from "./path.js";
import { fileClass } from "./n-g13-vault.js";
import { s33ValidateDateFormat } from "./s33-daily-notes.js";

const MarkdownFile = () => fileClass("TFile");
const MarkdownFolder = () => fileClass("TFolder");

const NG13_DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const NG13_DEFAULT_TIME_FORMAT = "HH:mm";
const NG13_DAILY_FORMATS = [NG13_DEFAULT_DATE_FORMAT, "YYYY.MM.DD", "YYYY/MM/DD", "YYYY/MM/YYYY-MM-DD"];

const ng13Collator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true }).compare;

function ng13Moment() {
  return (typeof window !== "undefined" && window.moment) || globalThis.moment;
}

// i18n lookup with an English fallback so tests see stable strings.
function ng13T(host, section, key, fallback) {
  try {
    const table = host.t && host.t.plugins && host.t.plugins[section];
    const value = table && table[key];
    if (typeof value === "function") return value();
    if (typeof value === "string") return value;
  } catch (e) { /* fall through */ }
  return fallback;
}

// ===========================================================================
// Pure helpers
// ===========================================================================

const NG13_PLACEHOLDER = /\{\{([^{}]+)\}\}/g;

/**
 * Substitute {{key}} placeholders (case-insensitive, custom values first) then
 * {{date}}/{{time}} and {{date:fmt}}/{{time:fmt}} using the current moment.
 */
export function applyTemplateVars(text, values, options) {
  const source = String(text == null ? "" : text);
  const opts = options || {};
  const moment = ng13Moment();
  const custom = new Map();
  if (values && typeof values === "object") {
    for (const key of Object.keys(values)) custom.set(key.toLowerCase(), values[key]);
  }
  let out = source.replace(NG13_PLACEHOLDER, (whole, inner) => {
    const trimmed = String(inner).trim();
    const colon = trimmed.indexOf(":");
    const name = (colon < 0 ? trimmed : trimmed.substring(0, colon)).toLowerCase();
    if (custom.has(name)) return String(custom.get(name));
    if (name === "date" || name === "time") {
      if (!moment) return whole;
      const fmt = colon < 0 ? "" : trimmed.substring(colon + 1).trim();
      const fallback = name === "date"
        ? (opts.dateFormat || NG13_DEFAULT_DATE_FORMAT)
        : (opts.timeFormat || NG13_DEFAULT_TIME_FORMAT);
      const format = fmt || fallback;
      try {
        return moment().format(format);
      } catch (e) {
        return whole;
      }
    }
    return whole;
  });
  return out;
}

/**
 * Locate a leading frontmatter block. Returns {exists, contentStart, from, to,
 * frontmatter}; exists=false yields the zeroed shape.
 */
export function frontmatterBounds(text) {
  const empty = { exists: false, contentStart: 0, from: 0, to: 0, frontmatter: "" };
  const source = String(text == null ? "" : text);
  if (!source.startsWith("---")) return empty;
  const after = source.charAt(3);
  if (after !== "\n" && after !== "\r") return empty;
  // first line must be exactly "---"
  let lineEnd = source.indexOf("\n");
  if (lineEnd === -1) return empty;
  const firstLine = source.substring(0, lineEnd).replace(/\r$/, "");
  if (firstLine !== "---") return empty;
  const innerStart = lineEnd + 1;
  // scan for a closing "---" that begins a line and ends the line
  let pos = innerStart;
  while (pos <= source.length) {
    const idx = source.indexOf("\n---", pos);
    if (idx === -1) break;
    const markerStart = idx + 1;
    let markerEnd = markerStart + 3;
    if (source.charAt(markerEnd) === "\r") markerEnd++;
    const afterMarker = source.charAt(markerEnd);
    if (afterMarker === "\n" || markerEnd === source.length) {
      const contentStart = afterMarker === "\n" ? markerEnd + 1 : markerEnd;
      return {
        exists: true,
        frontmatter: source.substring(innerStart, markerStart - 1),
        from: 0,
        to: markerEnd,
        contentStart,
      };
    }
    pos = markerStart + 3;
  }
  return empty;
}

/** Split note text into body content and parsed frontmatter. */
export function splitTemplateContent(text) {
  const bounds = frontmatterBounds(text);
  const content = bounds.exists ? String(text).substring(bounds.contentStart) : String(text);
  let frontmatter;
  if (bounds.exists && bounds.frontmatter) {
    try {
      frontmatter = env().mA ? env().mA(bounds.frontmatter) : undefined;
    } catch (e) {
      frontmatter = undefined;
    }
  }
  return { content, frontmatter };
}

/** Only booleans and the exact strings tab/window/split pass through. */
export function paneTypeArg(v) {
  return v === true || v === false || v === "tab" || v === "window" || v === "split" ? v : false;
}

/** Text after the leading frontmatter block, or the input unchanged. */
export function stripFrontmatter(text) {
  const bounds = frontmatterBounds(text);
  return bounds.exists ? String(text).substring(bounds.contentStart) : String(text);
}

/** "" when the format is usable, otherwise a localized error string. */
export function validateDailyFormat(format) {
  if (!format) return "";
  return s33ValidateDateFormat(format, {
    invalidCharsPattern: env().UT,
    invalidCharsList: env().qT || "",
  });
}

const NG13_WORD_LETTERS = "\\p{L}\\p{N}";

/** Fresh global regex matching one "word" (digits w/ separators or letter runs). */
export function wordCountPattern(host) {
  void host;
  return new RegExp("\\d[\\d.,]*|[" + NG13_WORD_LETTERS + "][" + NG13_WORD_LETTERS + "'’\"\\-–—]*|\\w", "gu");
}

/** Web-worker source counting matches of the same pattern. */
export function wordCountWorkerSource(host) {
  const pattern = wordCountPattern(host).source;
  return (
    "function countWords(text){const re=new RegExp(" + JSON.stringify(pattern) + ",\"gu\");" +
    "let n=0,m;while((m=re.exec(text))!==null){n++;if(m[0]===\"\")re.lastIndex++;}return n;}" +
    "self.onmessage=function(e){self.postMessage(countWords(String(e.data||\"\")));};"
  );
}

// ===========================================================================
// Templates plugin
// ===========================================================================

export function defineTemplateSuggestModal(host) {
  function TemplateSuggestModal(app, plugin, files) {
    const self = host.FuzzySuggestModal.call(this, app) || this;
    self.plugin = plugin;
    self.files = files || [];
    self.setPlaceholder(ng13T(host, "templates", "promptTypeTemplate", "Type a template name"));
    return self;
  }
  inherit(TemplateSuggestModal, host.FuzzySuggestModal);
  const proto = TemplateSuggestModal.prototype;

  proto.getItems = function () { return this.files; };
  proto.getItemText = function (file) {
    const prefix = this.plugin.templateFolderPrefix();
    return file.path.substring(prefix.length).replace(/\.md$/i, "");
  };
  proto.onChooseItem = function (file) {
    this.plugin.insertTemplate(file);
  };
  proto.onChooseSuggestion = proto.onChooseItem;
  return TemplateSuggestModal;
}

export function defineTemplatesPlugin(host) {
  function TemplatesPlugin() {
    this.id = "templates";
    this.name = ng13T(host, "templates", "name", "Templates");
    this.description = ng13T(host, "templates", "desc", "Insert templates into the active note.");
    this.defaultOn = true;
    this.options = {};
    this.app = null;
    this.plugin = null;
  }
  const proto = TemplatesPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const self = this;
    plugin.loadData().then((data) => {
      self.options = data && typeof data === "object" ? data : {};
    });
  };

  proto.templateFolderPrefix = function () {
    const folder = this.options.folder;
    return folder ? normalizePath(folder).replace(/\/$/, "") + "/" : "";
  };

  proto.onEnable = function (app, plugin) {
    const self = this;
    plugin.registerRibbonItem(ng13T(host, "templates", "actionInsertTemplate", "Insert template"), "lucide-files", () => self.onInsertTemplate());
    plugin.registerGlobalCommand({
      id: "insert-template",
      name: ng13T(host, "templates", "actionInsertTemplate", "Insert template"),
      icon: "lucide-files",
      callback: () => self.onInsertTemplate(),
    });
    plugin.registerGlobalCommand({
      id: "insert-current-date",
      name: ng13T(host, "templates", "actionInsertCurrentDate", "Insert current date"),
      icon: "lucide-calendar-days",
      editorCallback: (editor) => self.insertCurrentDate(editor),
    });
    plugin.registerGlobalCommand({
      id: "insert-current-time",
      name: ng13T(host, "templates", "actionInsertCurrentTime", "Insert current time"),
      icon: "lucide-clock",
      editorCallback: (editor) => self.insertCurrentTime(editor),
    });
    plugin.addSettingTab(new (defineTemplatesSettingTab(host))(app, this, plugin));
    plugin.registerCliHandler("templates", "List templates", { total: { description: "Return template count" } }, (args) => self.cliList(args));
    plugin.registerCliHandler("template:read", "Read template content", {
      name: { description: "Template name", required: true },
      resolve: { description: "Apply template variables", type: "boolean" },
      title: { description: "Title value for {{title}}" },
      paneType: { description: "Pane type" },
    }, (args) => self.cliRead(args));
    plugin.registerCliHandler("template:insert", "Insert template into active file", {
      name: { description: "Template name", required: true },
      resolve: { description: "Apply template variables", type: "boolean" },
      title: { description: "Title value for {{title}}" },
      paneType: { description: "Pane type" },
    }, async (args) => self.cliInsert(args));
  };

  proto.onExternalSettingsChange = function () {
    const self = this;
    this.plugin.loadData().then((data) => {
      self.options = data && typeof data === "object" ? data : {};
    });
  };

  proto.resolveTemplateFile = function (name) {
    const self = this;
    const fail = (msg) => msg;
    if (!name) return fail(ng13T(host, "templates", "msgUsageName", 'Usage: provide a template "name".'));
    const folderOption = this.options.folder;
    if (!folderOption) return fail(ng13T(host, "templates", "msgNoFolderSet", "No template folder configured."));
    const folderPath = normalizePath(folderOption);
    const folder = this.app.vault.getFolderByPath(folderPath) || this.app.vault.getAbstractFileByPathInsensitive(folderPath);
    if (!(folder instanceof MarkdownFolder())) {
      return fail(ng13T(host, "templates", "msgFailFolderNotFound", "Template folder not found: ") + folderOption);
    }
    const wanted = String(name);
    const direct = folderPath + "/" + wanted + ".md";
    const hit = this.app.vault.getFileByPath(direct);
    if (hit instanceof MarkdownFile()) return hit;
    const prefix = folderPath + "/";
    const lower = wanted.toLowerCase();
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
    for (const file of files) {
      const rel = file.path.substring(prefix.length).replace(/\.md$/i, "");
      if (rel.toLowerCase() === lower) return file;
    }
    return 'Template "' + wanted + '" not found.';
  };

  proto._collectTemplates = function () {
    const folderOption = this.options.folder;
    if (!folderOption) return { error: ng13T(host, "templates", "msgNoFolderSet", "No template folder configured.") };
    const folderPath = normalizePath(folderOption);
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!(folder instanceof MarkdownFolder())) {
      return { error: ng13T(host, "templates", "msgFailFolderNotFound", "Template folder not found: ") + folderOption };
    }
    const prefix = folderPath + "/";
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
    files.sort((a, b) => ng13Collator(a.path, b.path));
    return { files, prefix };
  };

  proto.onInsertTemplate = function () {
    const collected = this._collectTemplates();
    if (collected.error) {
      new host.Notice(collected.error);
      return;
    }
    if (!collected.files || collected.files.length === 0) {
      new host.Notice(ng13T(host, "templates", "msgNoTemplatesFound", "No templates found."));
      return;
    }
    new (defineTemplateSuggestModal(host))(this.app, this, collected.files).open();
  };

  proto._activeMarkdownView = function () {
    const app = this.app;
    const view = app.workspace.getActiveViewOfType && app.workspace.getActiveViewOfType(host.MarkdownView);
    if (view && view.editor) return view;
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view && leaf.view.editor && leaf.view.file) return leaf.view;
    }
    return null;
  };

  proto.insertTemplate = function (file) {
    const view = this._activeMarkdownView();
    if (!view || !view.editor) return;
    const editor = view.editor;
    void this.app.vault.cachedRead(file).then(async (cached) => {
      const raw = cached != null ? cached : await this.app.vault.read(file);
      const { content, frontmatter } = splitTemplateContent(raw);
      const activeFile = view.file;
      const vars = {
        title: activeFile ? activeFile.basename : "",
      };
      const options = {
        dateFormat: this.options.dateFormat || NG13_DEFAULT_DATE_FORMAT,
        timeFormat: this.options.timeFormat || NG13_DEFAULT_TIME_FORMAT,
      };
      let text = applyTemplateVars(content, vars, options);
      let fmText = "";
      if (frontmatter !== undefined && boundsHasFrontmatter(raw)) {
        const bounds = frontmatterBounds(raw);
        fmText = bounds.frontmatter;
      }
      const cursor = editor.getCursor();
      const atStart = cursor && cursor.line === 0 && cursor.ch === 0;
      if (!atStart && fmText) {
        // body only; frontmatter goes to the metadata editor when available
        let parsed;
        try {
          parsed = env().mA ? env().mA(fmText) : undefined;
        } catch (e) {
          parsed = undefined;
        }
        if (parsed === undefined && fmText.trim() !== "") {
          new host.Notice(ng13T(host, "templates", "msgFailInvalidTemplateProperties", "Invalid template properties."));
          return;
        }
        if (host.hasMetadataEditor && host.hasMetadataEditor(view) && parsed) {
          try {
            const me = view.metadataEditor || (host.activePropertiesEditor && host.activePropertiesEditor());
            if (me && typeof me.setProperties === "function") me.setProperties(parsed);
            else if (me && typeof me.addProperties === "function") me.addProperties(parsed);
          } catch (e) { /* metadata editor is best effort */ }
        }
      } else if (atStart && fmText) {
        text = applyTemplateVars(raw, vars, options);
      }
      editor.replaceSelection(text);
    });
  };

  proto.insertCurrentDate = function (editor) {
    const moment = ng13Moment();
    if (!moment) return;
    editor.replaceSelection(moment().format(this.options.dateFormat || NG13_DEFAULT_DATE_FORMAT));
  };

  proto.insertCurrentTime = function (editor) {
    const moment = ng13Moment();
    if (!moment) return;
    editor.replaceSelection(moment().format(this.options.timeFormat || NG13_DEFAULT_TIME_FORMAT));
  };

  proto.insertText = function (editor, text) {
    editor.replaceSelection(text);
  };

  proto.onInsertTemplateKey = null;

  // ---- CLI ----

  proto.cliList = function (args) {
    const collected = this._collectTemplates();
    if (collected.error) throw collected.error;
    if (!collected.files.length) throw ng13T(host, "templates", "msgNoTemplatesFound", "No templates found.");
    if (args && (args.total === true || args.total === "true" || args.total === "")) {
      return String(collected.files.length);
    }
    return collected.files.map((f) => f.path.substring(collected.prefix.length).replace(/\.md$/i, "")).join("\n");
  };

  proto.cliRead = function (args) {
    const name = args && args.name;
    if (!name) throw ng13T(host, "templates", "msgUsageName", 'Usage: provide a template "name".');
    const resolved = this.resolveTemplateFile(name);
    if (typeof resolved === "string") throw resolved;
    return this.app.vault.cachedRead(resolved).then(async (cached) => {
      const raw = cached != null ? cached : await this.app.vault.read(resolved);
      if (args && (args.resolve === true || args.resolve === "true" || args.resolve === "")) {
        return applyTemplateVars(raw, { title: (args && args.title) || "" }, {
          dateFormat: this.options.dateFormat || NG13_DEFAULT_DATE_FORMAT,
          timeFormat: this.options.timeFormat || NG13_DEFAULT_TIME_FORMAT,
        });
      }
      return raw;
    });
  };

  proto.cliInsert = async function (args) {
    const view = this._activeMarkdownView();
    if (!view || !view.editor) throw ng13T(host, "templates", "msgNoActiveEditor", "No active editor.");
    const name = args && args.name;
    if (!name) throw ng13T(host, "templates", "msgUsageName", 'Usage: provide a template "name".');
    const resolved = this.resolveTemplateFile(name);
    if (typeof resolved === "string") throw resolved;
    const raw = await this.app.vault.read(resolved);
    const vars = { title: view.file ? view.file.basename : "" };
    const options = {
      dateFormat: this.options.dateFormat || NG13_DEFAULT_DATE_FORMAT,
      timeFormat: this.options.timeFormat || NG13_DEFAULT_TIME_FORMAT,
    };
    view.editor.replaceSelection(applyTemplateVars(raw, vars, options));
    return "Inserted template: " + resolved.basename;
  };

  return TemplatesPlugin;
}

function boundsHasFrontmatter(text) {
  return frontmatterBounds(text).exists;
}

export function defineTemplatesSettingTab(host) {
  function TemplatesSettingTab(app, pluginInstance, wrapper) {
    const self = host.PluginInstanceSettingTab.call(this, app, wrapper) || this;
    self.icon = "files";
    self.pluginInstance = pluginInstance;
    return self;
  }
  inherit(TemplatesSettingTab, host.PluginInstanceSettingTab);
  const proto = TemplatesSettingTab.prototype;

  proto.display = function () {
    const self = this;
    const inst = this.pluginInstance;
    this.containerEl.empty();
    const group = new host.SettingGroup(this.containerEl);
    const save = () => inst.plugin.saveData(inst.options);

    group.addSetting((setting) => {
      setting.setName(ng13T(host, "templates", "settingFolder", "Template folder location"))
        .setDesc(ng13T(host, "templates", "settingFolderDesc", "Folder with template notes."));
      setting.addText((text) => {
        text.setPlaceholder(ng13T(host, "templates", "settingFolderPathExamplePlaceholder", "Folder path, e.g. Templates"))
          .setValue(inst.options.folder || "")
          .onChange((value) => {
            inst.options.folder = value.trim();
            save();
          });
        new host.FolderPathSuggest(self.app, text.inputEl, false, false);
      });
    });

    const sample = this.containerEl.createDiv("u-pop");
    group.addSetting((setting) => {
      setting.setName(ng13T(host, "templates", "optionTemplateDateFormat", "Template date format"));
      setting.addMomentFormat((component) => {
        component.setDefaultFormat(NG13_DEFAULT_DATE_FORMAT)
          .setSampleEl(sample)
          .setValue(inst.options.dateFormat || NG13_DEFAULT_DATE_FORMAT)
          .onChange((value) => {
            inst.options.dateFormat = value.trim();
            save();
          });
      });
    });

    group.addSetting((setting) => {
      setting.setName(ng13T(host, "templates", "optionTemplateTimeFormat", "Template time format"));
      setting.addMomentFormat((component) => {
        component.setDefaultFormat(NG13_DEFAULT_TIME_FORMAT)
          .setSampleEl(sample)
          .setValue(inst.options.timeFormat || NG13_DEFAULT_TIME_FORMAT)
          .onChange((value) => {
            inst.options.timeFormat = value.trim();
            save();
          });
      });
    });
  };

  return TemplatesSettingTab;
}

// ===========================================================================
// Daily notes plugin
// ===========================================================================

export function defineDailyNotesSettingTab(host) {
  function DailyNotesSettingTab(app, pluginInstance, wrapper) {
    const self = host.PluginInstanceSettingTab.call(this, app, wrapper) || this;
    self.icon = "calendar";
    self.pluginInstance = pluginInstance;
    return self;
  }
  inherit(DailyNotesSettingTab, host.PluginInstanceSettingTab);
  const proto = DailyNotesSettingTab.prototype;

  proto.display = function () {
    const self = this;
    const inst = this.pluginInstance;
    this.containerEl.empty();
    const group = new host.SettingGroup(this.containerEl);
    const save = () => inst.plugin.saveData(inst.options);
    const T = () => ({
      format: ng13T(host, "dailyNotes", "optionDateFormat", "Date format"),
      custom: ng13T(host, "dailyNotes", "optionCustomFormat", "Custom format"),
      folder: ng13T(host, "dailyNotes", "optionFolder", "Folder"),
      template: ng13T(host, "dailyNotes", "optionTemplate", "Template"),
    });
    const t = T();

    group.addSetting((setting) => {
      setting.setName(t.format).setDesc(ng13T(host, "dailyNotes", "optionDateFormatDesc", "Format for daily note file names."));
      setting.addDropdown((dropdown) => {
        for (const fmt of NG13_DAILY_FORMATS) {
          dropdown.addOption(fmt, ng13Moment() ? ng13Moment().format(fmt) : fmt);
        }
        dropdown.addOption("custom", t.custom);
        dropdown.setValue(NG13_DAILY_FORMATS.includes(inst.options.format) ? inst.options.format : "custom");
        dropdown.onChange((value) => {
          if (value === "custom") {
            inst.options.format = inst.options.customFormat || "";
          } else {
            inst.options.format = value;
          }
          save();
          self.display();
        });
      });
    });

    if (!NG13_DAILY_FORMATS.includes(inst.options.format)) {
      group.addSetting((setting) => {
        setting.setName(t.custom);
        setting.addText((text) => {
          const component = text.setPlaceholder(NG13_DEFAULT_DATE_FORMAT)
            .setValue(inst.options.format || "")
            .onChange((value) => {
              const trimmed = value.trim();
              const error = validateDailyFormat(trimmed);
              if (error) {
                text.inputEl.addClass("mod-error");
                host.setTooltip(text.inputEl, error);
                return;
              }
              text.inputEl.removeClass("mod-error");
              inst.options.format = trimmed;
              inst.options.customFormat = trimmed;
              save();
            });
          void component;
        });
      });
    }

    group.addSetting((setting) => {
      setting.setName(t.folder);
      setting.addText((text) => {
        text.setPlaceholder(ng13T(host, "dailyNotes", "settingFolderPathExamplePlaceholder", "Folder path"))
          .setValue(inst.options.folder || "")
          .onChange((value) => {
            inst.options.folder = value.trim();
            save();
          });
        new host.FolderSuggest(self.app, text.inputEl);
      });
    });

    group.addSetting((setting) => {
      setting.setName(t.template);
      setting.addText((text) => {
        text.setPlaceholder("template.md")
          .setValue(inst.options.template || "")
          .onChange((value) => {
            inst.options.template = value.trim();
            save();
          });
        new host.MarkdownFileSuggest(self.app, text.inputEl);
      });
    });
  };

  return DailyNotesSettingTab;
}

export function defineDailyNotesPlugin(host) {
  function DailyNotesPlugin() {
    this.id = "daily-notes";
    this.name = ng13T(host, "dailyNotes", "name", "Daily notes");
    this.description = ng13T(host, "dailyNotes", "desc", "Open a daily note.");
    this.defaultOn = true;
    this.options = {};
    this.app = null;
    this.plugin = null;
  }
  const proto = DailyNotesPlugin.prototype;
  const T = (key, fallback) => ng13T(host, "dailyNotes", key, fallback);

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const self = this;
    plugin.loadData().then((data) => {
      self.options = data && typeof data === "object" ? data : {};
    });
  };

  proto.onEnable = function (app, plugin) {
    const self = this;
    plugin.registerRibbonItem(T("actionOpenDailyNote", "Open today's daily note"), "lucide-calendar", (event) => self.onOpenDailyNote(event));
    plugin.registerGlobalCommand({
      id: "daily-notes",
      name: T("actionOpenDailyNote", "Open today's daily note"),
      icon: "lucide-calendar-days",
      callback: () => self.openDailyNote(),
    });
    plugin.registerGlobalCommand({
      id: "daily-notes:goto-prev",
      name: T("actionOpenPreviousDailyNote", "Open previous daily note"),
      icon: "lucide-arrow-left",
      checkCallback: (checking) => {
        if (typeof self.getCurrentFileDateTimestamp() !== "number") return false;
        if (!checking) self.gotoPreviousExisting(self.getCurrentFileDateTimestamp());
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "daily-notes:goto-next",
      name: T("actionOpenNextDailyNote", "Open next daily note"),
      icon: "lucide-arrow-right",
      checkCallback: (checking) => {
        if (typeof self.getCurrentFileDateTimestamp() !== "number") return false;
        if (!checking) self.gotoNextExisting(self.getCurrentFileDateTimestamp());
        return true;
      },
    });
    plugin.registerEvent(app.workspace.on("receive-text-menu", (menu, text) => {
      menu.addItem((item) => item.setTitle(T("msgInsertDailyNote", "Insert today's daily note"))
        .setIcon("lucide-calendar-check")
        .setSection("options")
        .onClick(async () => {
          const note = await self.getDailyNote();
          if (!note) return;
          const content = await app.vault.read(note);
          const view = self._activeMarkdownView();
          if (view && view.editor) {
            view.editor.replaceSelection(content.endsWith("\n") ? content : content + "\n");
          }
          await app.workspace.getLeaf().openFile(note);
          try { await app.workspace.getLeaf().view.setState({ mode: "source" }, { history: false }); } catch (e) {}
        }));
    }));
    plugin.registerEvent(app.workspace.on("receive-files-menu", (menu, files) => {
      menu.addItem((item) => item.setTitle(T("msgInsertDailyNoteLink", "Insert link to today's daily note"))
        .setIcon("lucide-calendar-check")
        .setSection("options")
        .onClick(async () => {
          const note = await self.getDailyNote();
          if (!note) return;
          const view = self._activeMarkdownView();
          if (!view || !view.editor) return;
          const links = files.map((f) => {
            const link = "[[" + f.path + "]]";
            return host.isAttachmentExtension && host.isAttachmentExtension(extensionOf(f.path)) ? "!" + link : link;
          });
          view.editor.replaceSelection(links.join(" "));
        }));
    }));
    const onDailyProtocol = (params) => self.onProtocol(params);
    app.workspace.registerObsidianProtocolHandler("daily", onDailyProtocol);
    plugin.register(() => app.workspace.unregisterObsidianProtocolHandler("daily", onDailyProtocol));
    const quickActions = app.mobileQuickActions;
    if (quickActions) {
      quickActions.registerQuickAction("daily", {
        title: T("shortName", "Daily note"),
        iconName: "calendar",
        callback: () => self.openDailyNote(),
      });
      plugin.register(() => quickActions.unregisterQuickAction("daily"));
    }
    plugin.addSettingTab(new (defineDailyNotesSettingTab(host))(app, this, plugin));

    plugin.registerCliHandler("daily", "Open daily note", { paneType: { description: "Pane type (tab|split|window)" } }, async (args) => {
      const note = await self.getDailyNote();
      if (!note) throw "Failed to open daily note.";
      await self._openNote(note, paneTypeArg(args && args.paneType));
      return "Opened: " + note.path;
    });
    plugin.registerCliHandler("daily:path", "Get daily note path", null, () => self.cliPath());
    plugin.registerCliHandler("daily:read", "Read daily note contents", null, async () => {
      const note = await self.getDailyNote();
      if (!note) throw "Failed to open daily note.";
      return app.vault.read(note);
    });
    const appendFlags = {
      content: { description: "Content to add", required: true },
      inline: { description: "Do not add trailing newline", type: "boolean" },
      open: { description: "Open the note", type: "boolean" },
      paneType: { description: "Pane type" },
    };
    const appendOrPrepend = (mode) => async (args) => {
      const note = await self.getDailyNote();
      if (!note) throw "Failed to open daily note.";
      let content = args && args.content != null ? String(args.content) : "";
      content = content.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
      if (!content && !(args && args.content === "")) {
        if (!args || args.content == null) throw 'Missing required argument "content".';
      }
      await self._insertIntoDaily(note, content, mode === "prepend", !!(args && args.inline));
      if (args && (args.open === true || args.open === "true" || args.open === "")) {
        await self._openNote(note, paneTypeArg(args.paneType));
      }
      return "Added to: " + note.path;
    };
    plugin.registerCliHandler("daily:append", "Append content to daily note", appendFlags, appendOrPrepend("append"));
    plugin.registerCliHandler("daily:prepend", "Prepend content to daily note", appendFlags, appendOrPrepend("prepend"));
  };

  proto.onDisable = function () {};

  proto.onExternalSettingsChange = function () {
    const self = this;
    this.plugin.loadData().then((data) => {
      self.options = data && typeof data === "object" ? data : {};
    });
  };

  // ---- date helpers ----

  proto.getFormat = function () {
    return this.options.format || NG13_DEFAULT_DATE_FORMAT;
  };

  proto._formatName = function (date) {
    const moment = ng13Moment();
    const format = this.getFormat();
    try {
      return moment(date || new Date()).format(format).trim();
    } catch (e) {
      new host.Notice(T("msgFailFormat", "Invalid daily note date format."));
      console.error(e);
      return "";
    }
  };

  proto.getFolder = function () {
    const app = this.app;
    const folderOption = this.options.folder;
    if (folderOption) {
      const folder = app.vault.getFolderByPath(normalizePath(folderOption)) ||
        app.vault.getAbstractFileByPathInsensitive(normalizePath(folderOption));
      return folder instanceof MarkdownFolder() ? folder : null;
    }
    try {
      const parent = app.fileManager && app.fileManager.getNewFileParent ? app.fileManager.getNewFileParent("") : null;
      if (parent instanceof MarkdownFolder()) return parent;
    } catch (e) { /* fall through */ }
    return app.vault.root || null;
  };

  proto.getDailyNotePath = function (date, folder) {
    const name = this._formatName(date);
    if (!name) return "";
    const target = folder || this.getFolder();
    if (!target) return "";
    return target.getParentPrefix() + name + ".md";
  };

  proto.getDailyNote = async function (date) {
    const app = this.app;
    const folder = this.getFolder();
    if (!folder) {
      new host.Notice(T("msgFailFolder", "Failed to find daily notes folder."));
      return undefined;
    }
    const path = this.getDailyNotePath(date, folder);
    if (!path) return undefined;
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing) {
      if (existing instanceof MarkdownFile() && existing.extension === "md") return existing;
      return undefined;
    }
    // non-md item at the path blocks creation
    const anyItem = app.vault.getAbstractFileByPathInsensitive(path);
    if (anyItem && !(anyItem instanceof MarkdownFile() && anyItem.extension === "md")) return undefined;
    let content = "";
    if (this.options.template) {
      const dest = app.metadataCache && app.metadataCache.getFirstLinkpathDest
        ? app.metadataCache.getFirstLinkpathDest(this.options.template, null)
        : null;
      if (!dest) {
        new host.Notice(T("msgFailTemplateFile", "Failed to find daily note template."));
      } else {
        const raw = await app.vault.read(dest);
        content = applyTemplateVars(raw, { title: baseName(path).replace(/\.md$/i, "") }, {});
      }
    }
    try {
      return await app.fileManager.createNewMarkdownFile(folder, baseName(path).replace(/\.md$/i, ""), content);
    } catch (e) {
      new host.Notice(String(e));
      return undefined;
    }
  };

  proto.getDailyNotePathBeforeAppLoads = function (date) {
    const app = this.app;
    const name = this._formatName(date);
    if (!name) return "";
    let prefix = "";
    const folderOption = this.options.folder;
    if (folderOption) {
      const folderPath = normalizePath(folderOption);
      app.vault.adapter.exists(folderPath).then((exists) => {
        if (!exists) new host.Notice(T("msgFailFolder", "Failed to find daily notes folder."));
      });
      prefix = folderPath.replace(/\/$/, "") + "/";
    } else {
      const cfg = app.vault.getConfig ? app.vault.getConfig("newFileLocation") : "";
      const cfgFolder = app.vault.getConfig ? app.vault.getConfig("newFileFolderPath") : "";
      if (cfg === "folder" && cfgFolder) {
        prefix = normalizePath(cfgFolder).replace(/\/$/, "") + "/";
      }
    }
    return (prefix + name + ".md").trim();
  };

  proto.getDailyNoteTemplateBeforeAppLoads = async function (title) {
    const app = this.app;
    const template = this.options.template;
    if (!template) return "";
    let path = template;
    if (!path.endsWith(".md")) path += ".md";
    const exists = await app.vault.adapter.exists(path);
    if (!exists) return "";
    const raw = await app.vault.adapter.read(path);
    return applyTemplateVars(raw, { title: title || "" }, {});
  };

  proto.iterateDailyNotes = function (visit) {
    const folder = this.getFolder();
    if (!folder) {
      new host.Notice(T("msgMissingFolder", "Daily notes folder is missing."));
      return;
    }
    const moment = ng13Moment();
    const format = this.getFormat();
    const prefix = folder.getParentPrefix();
    const walk = (item) => {
      if (!(item instanceof MarkdownFolder())) return;
      for (const child of item.children) {
        if (child instanceof MarkdownFolder()) {
          walk(child);
        } else if (child instanceof MarkdownFile() && child.extension === "md") {
          const rel = child.path.startsWith(prefix) ? child.path.substring(prefix.length) : child.name;
          const name = withoutExtension(rel);
          const parsed = moment(name, format, true);
          if (parsed && parsed.isValid()) {
            visit(child, parsed.valueOf());
          }
        }
      }
    };
    walk(folder);
  };

  proto.getCurrentFileDateTimestamp = function () {
    const app = this.app;
    const file = app.workspace.getActiveFile && app.workspace.getActiveFile();
    if (!file || !(file instanceof MarkdownFile()) || file.extension !== "md") return null;
    const folder = this.getFolder();
    if (!folder) return null;
    const prefix = folder.getParentPrefix();
    if (!file.path.startsWith(prefix)) return null;
    const name = withoutExtension(file.path.substring(prefix.length));
    const moment = ng13Moment();
    const parsed = moment(name, this.getFormat(), true);
    return parsed && parsed.isValid() ? parsed.valueOf() : null;
  };

  proto._dailyNoteEntries = function () {
    const entries = [];
    this.iterateDailyNotes((file, ts) => entries.push({ file, ts }));
    entries.sort((a, b) => a.ts - b.ts);
    return entries;
  };

  proto.gotoPreviousExisting = function (ts) {
    const entries = this._dailyNoteEntries().filter((e) => e.ts < ts);
    const target = entries.length ? entries[entries.length - 1] : null;
    if (!target) {
      new host.Notice(T("msgNoPrevious", "No previous daily note found."));
      return;
    }
    this._openNote(target.file, false);
  };

  proto.gotoNextExisting = function (ts) {
    const entries = this._dailyNoteEntries().filter((e) => e.ts > ts);
    const target = entries.length ? entries[0] : null;
    if (!target) {
      new host.Notice(T("msgNoNext", "No next daily note found."));
      return;
    }
    this._openNote(target.file, false);
  };

  proto._openNote = async function (file, paneType) {
    const app = this.app;
    const leaf = app.workspace.getLeaf(paneType === "tab" || paneType === true ? "tab" : paneType === "split" ? "split" : paneType === "window" ? "window" : false);
    await leaf.openFile(file);
    try { await leaf.view.setState({ mode: "source" }, { history: false }); } catch (e) {}
  };

  proto.openDailyNote = async function (event) {
    const note = await this.getDailyNote();
    if (!note) return;
    const leaf = this.app.workspace.getLeaf(host.Keymap.isModEvent(event || this.app.lastEvent) ? "tab" : false);
    await leaf.openFile(note);
    try { await leaf.view.setState({ mode: "source" }, { history: false }); } catch (e) {}
  };

  proto.onOpenDailyNote = function (event) {
    this.openDailyNote(event);
  };

  proto._activeMarkdownView = function () {
    const app = this.app;
    const view = app.workspace.getActiveViewOfType && app.workspace.getActiveViewOfType(host.MarkdownView);
    if (view && view.editor) return view;
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view && leaf.view.editor && leaf.view.file) return leaf.view;
    }
    return null;
  };

  proto._insertIntoDaily = async function (note, content, prepend, inline) {
    const addition = content + (inline ? "" : "\n");
    const existing = await this.app.vault.read(note);
    let next;
    if (prepend) {
      const bounds = frontmatterBounds(existing);
      if (bounds.exists) {
        next = existing.substring(0, bounds.contentStart) + addition + existing.substring(bounds.contentStart);
      } else {
        next = addition + existing;
      }
    } else {
      next = existing + (existing.endsWith("\n") || existing === "" ? "" : "\n") + addition;
    }
    await this.app.vault.modify(note, next);
  };

  proto.cliPath = function () {
    const path = this.getDailyNotePathBeforeAppLoads();
    if (!path) throw "Failed to resolve daily note path.";
    return path;
  };

  proto.onProtocol = async function (params) {
    const app = this.app;
    let content = params && params.content ? decodeURIComponent(params.content) : "";
    if (params && params.clipboard) {
      try {
        const text = await navigator.clipboard.readText();
        content = text;
      } catch (e) { /* clipboard unavailable */ }
    }
    const note = await this.getDailyNote();
    if (!note) return;
    if (content) {
      await this._insertIntoDaily(note, content, !!(params && params.prepend), false);
    }
    if (!(params && params.silent)) {
      await this._openNote(note, paneTypeArg(params && params.paneType));
    }
    if (app.workspace.handleXCallback) app.workspace.handleXCallback();
  };

  return DailyNotesPlugin;
}

// ===========================================================================
// Random note plugin
// ===========================================================================

export function defineRandomNotePlugin(host) {
  function RandomNotePlugin() {
    this.id = "random-note";
    this.name = ng13T(host, "randomNote", "name", "Random note");
    this.description = ng13T(host, "randomNote", "desc", "Open a random note.");
    this.defaultOn = false;
    this.app = null;
    this.plugin = null;
  }
  const proto = RandomNotePlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
  };

  proto.onEnable = function (app, plugin) {
    const self = this;
    plugin.registerRibbonItem(ng13T(host, "randomNote", "actionOpenRandomNote", "Open random note"), "lucide-dice", (event) => self.onRandomNote(event));
    plugin.registerGlobalCommand({
      id: "random-note:random-note",
      name: ng13T(host, "randomNote", "actionOpenRandomNote", "Open random note"),
      icon: "lucide-dice",
      callback: (event) => self.onRandomNote(event),
    });
  };

  proto.onRandomNote = function (event) {
    const files = this.app.vault.getMarkdownFiles();
    if (!files.length) return;
    const file = files[Math.floor(Math.random() * files.length)];
    const mod = host.Keymap.isModEvent(event || this.app.lastEvent);
    const leaf = this.app.workspace.getLeaf(mod ? "tab" : false);
    leaf.openFile(file);
  };

  return RandomNotePlugin;
}

// ===========================================================================
// Word count plugin
// ===========================================================================

export function defineWordCountPlugin(host) {
  function WordCountPlugin() {
    this.id = "word-count";
    this.name = ng13T(host, "wordCount", "name", "Word count");
    this.description = ng13T(host, "wordCount", "desc", "Show word and character count in the status bar.");
    this.defaultOn = true;
    this.app = null;
    this.plugin = null;
    this.wordCount = 0;
    this.charCount = 0;
    this.wordEl = null;
    this.charEl = null;
    this.worker = null;
    this._pending = null;
  }
  const proto = WordCountPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    // hasStatusBarItem/mobileFileInfo are collected by the wrapper before onEnable
    plugin.registerStatusBarItem();
    plugin.registerMobileFileInfo(() => {
      try {
        return host.t.nouns.wordWithCount(this.wordCount) + ", " + host.t.nouns.characterWithCount(this.charCount);
      } catch (e) {
        return this.wordCount + ", " + this.charCount;
      }
    });
  };

  proto._countableFile = function () {
    const file = this.app.workspace.getActiveFile && this.app.workspace.getActiveFile();
    if (!file) return null;
    if (file.extension === "md") return file;
    const view = this.app.workspace.getActiveViewOfType && this.app.workspace.getActiveViewOfType(host.PlaintextView);
    if (view && view.file === file) return file;
    return null;
  };

  proto._ensureWorker = function () {
    if (this.worker) return this.worker;
    const source = wordCountWorkerSource(host);
    const blob = new Blob([source], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url);
    const self = this;
    this.worker.onmessage = (event) => {
      self.wordCount = event.data;
      self._render();
    };
    return this.worker;
  };

  proto._scheduleCount = function (text) {
    const self = this;
    if (this._pending) clearTimeout(this._pending);
    this._pending = setTimeout(() => {
      self._pending = null;
      try {
        self._ensureWorker().postMessage(text);
      } catch (e) {
        // worker unavailable: count synchronously
        const re = wordCountPattern(host);
        let n = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          n++;
          if (m[0] === "") re.lastIndex++;
        }
        self.wordCount = n;
        self._render();
      }
    }, 200);
  };

  proto._render = function () {
    if (this.wordEl) this.wordEl.setText(String(this.wordCount));
    if (this.charEl) this.charEl.setText(String(this.charCount));
  };

  proto.onEnable = function (app, plugin) {
    const self = this;
    plugin.registerEvent(app.workspace.on("file-open", () => self.onFileOpen()));
    plugin.registerEvent(app.workspace.on("quick-preview", () => self.onFileOpen()));
    plugin.registerEvent(app.workspace.on("editor-selection-change", () => self.onSelectionChange()));

    // build the two-segment status bar item lazily on first enable render
    const render = () => {
      const el = plugin.statusBarEl;
      if (!el || self.wordEl) return;
      self.wordEl = el.createSpan({ cls: "status-bar-item-segment" });
      self.charEl = el.createSpan({ cls: "status-bar-item-segment" });
      el.hide();
    };
    // statusBarEl is created by the wrapper after onEnable; defer one tick
    setTimeout(render, 0);
    setTimeout(render, 50);

    plugin.registerCliHandler("wordcount", "Count words and characters", {
      file: { description: "File path" },
      path: { description: "File path" },
      words: { description: "Only word count", type: "boolean" },
      characters: { description: "Only character count", type: "boolean" },
    }, async (args) => self.cliCount(args));
  };

  proto.onDisable = function () {
    if (this.worker) {
      try { this.worker.terminate(); } catch (e) {}
      this.worker = null;
    }
    if (this._pending) clearTimeout(this._pending);
    this._pending = null;
  };

  proto._updateStatusVisibility = function () {
    const el = this.plugin && this.plugin.statusBarEl;
    if (!el) return;
    if (this.wordCount > 0 || this.charCount > 0) el.show();
    else el.hide();
  };

  proto._setCounts = function (words, chars) {
    this.wordCount = words;
    this.charCount = chars;
    this._render();
    this._updateStatusVisibility();
  };

  proto.onFileOpen = async function () {
    const file = this._countableFile();
    if (!file) {
      this._setCounts(0, 0);
      return;
    }
    const raw = await this.app.vault.read(file);
    const text = stripFrontmatter(raw);
    this.charCount = text.length;
    this._scheduleCount(text);
    this._render();
    this._updateStatusVisibility();
  };

  proto.onSelectionChange = async function () {
    const file = this._countableFile();
    if (!file) return;
    const view = this.app.workspace.getActiveViewOfType && this.app.workspace.getActiveViewOfType(host.MarkdownView);
    const editor = view && view.editor;
    if (!editor) return this.onFileOpen();
    let selection = "";
    try {
      selection = editor.getSelection ? editor.getSelection() : "";
    } catch (e) { selection = ""; }
    if (selection) {
      const text = stripFrontmatter(selection);
      this.charCount = text.length;
      const re = wordCountPattern(host);
      let n = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        n++;
        if (m[0] === "") re.lastIndex++;
      }
      this._setCounts(n, text.length);
    } else {
      await this.onFileOpen();
    }
  };

  proto.cliCount = async function (args) {
    const app = this.app;
    let file = null;
    const wanted = args && (args.file || args.path);
    if (wanted) {
      file = app.vault.getAbstractFileByPath(normalizePath(wanted));
    } else {
      file = app.workspace.getActiveFile && app.workspace.getActiveFile();
    }
    if (!(file instanceof MarkdownFile())) throw "wordcount: not a markdown file.";
    const raw = await app.vault.read(file);
    const text = stripFrontmatter(raw);
    const re = wordCountPattern(host);
    let words = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      words++;
      if (m[0] === "") re.lastIndex++;
    }
    const chars = text.length;
    if (args && (args.words === true || args.words === "true" || args.words === "")) return String(words);
    if (args && (args.characters === true || args.characters === "true" || args.characters === "")) return String(chars);
    return "words: " + words + "\ncharacters: " + chars;
  };

  return WordCountPlugin;
}
