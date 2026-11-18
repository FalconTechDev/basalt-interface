// s16 slice: the unique-note-creator core plugin ("zk-prefixer") and its settings tab.
// Creates timestamped notes, supports {{title}} templates, a `unique:` protocol handler,
// a CLI command and a mobile quick action.
import { inherit } from "./inherit.js";
import { normalizePath } from "./path.js";
import { applyTemplateVars, paneTypeArg } from "./notes-utils.js";
import { s16UniqueNoteFormat } from "./s16-constants.js";

const NOTE_FORMAT_UNITS = ["m", "h", "d", "w", "M", "y"];

/** See: UniqueNotePlugin. */
export function defineUniqueNotePlugin(host) {
  function UniqueNotePlugin() {
    this.id = "zk-prefixer";
    this.name = host.i18n.plugins.uniqueNoteCreator.name();
    this.description = host.i18n.plugins.uniqueNoteCreator.desc();
    this.app = null;
    this.plugin = null;
    this.options = {};
  }

  const proto = UniqueNotePlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerRibbonItem(host.i18n.plugins.uniqueNoteCreator.actionCreateNote(), "sheets-in-box", this.onCreateNote.bind(this));
    plugin.registerGlobalCommand({
      id: "zk-prefixer",
      name: host.i18n.plugins.uniqueNoteCreator.actionCreateNote(),
      icon: "box-glyph",
      callback: this.onCreateNote.bind(this),
    });
    plugin.registerGlobalCommand({
      id: "insert-unique-link",
      name: host.i18n.plugins.uniqueNoteCreator.actionAddLink(),
      icon: "lucide-link",
      editorCallback: this.addUniqueLink.bind(this),
    });
  };

  proto.onEnable = async function (app, plugin) {
    this.options = (await plugin.loadData()) || {};
    plugin.addSettingTab(new host.s16UniqueNoteSettingsTab(app, plugin, this));
    plugin.registerCliHandler(
      "unique",
      "Create unique note",
      {
        name: { value: "<text>", description: "Note name" },
        content: { value: "<text>", description: "Initial content" },
        paneType: { value: "tab|split|window", description: "Pane type to open in" },
        open: { description: "Open file after creating" },
      },
      async (args) => {
        const name = args.name;
        const noteName = this.getUniquePath(name);
        if (!noteName) throw new Error("Failed to generate unique filename.");
        let parent;
        if (this.options.folder && String.isString(this.options.folder)) {
          const folder = app.vault.getFolderByPath(normalizePath(this.options.folder));
          if (!folder) throw new Error(`Folder "${this.options.folder}" not found.`);
          parent = folder;
        } else {
          parent = app.fileManager.getNewFileParent("", noteName);
        }
        let content = (args.content || "").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
        if (content || !this.options.template) {
          // keep the raw content
        } else {
          const templateFile = app.metadataCache.getFirstLinkpathDest(this.options.template, "");
          if (!templateFile) throw new Error(`Template file "${this.options.template}" not found.`);
          const raw = await app.vault.cachedRead(templateFile);
          content = applyTemplateVars(raw, { title: noteName }, {});
        }
        const file = await app.fileManager.createNewMarkdownFile(parent, noteName, content);
        if (args.open) await app.workspace.getLeaf(paneTypeArg(args.paneType)).openFile(file, { active: true });
        return file.path;
      },
    );

    const onProtocol = async (args) => {
      const file = await this.onCreateNote();
      const app = this.app;
      let content = args.content;
      if (args.clipboard) content = await navigator.clipboard.readText();
      if (content) await app.fileManager.insertIntoFile(file, content, "append");
      if (!args.silent) await app.workspace.getLeaf(paneTypeArg(args.paneType)).openFile(file, { active: true, state: { mode: "source" } });
      app.workspace.handleXCallback(args, file);
    };
    this.app.workspace.registerObsidianProtocolHandler("unique", onProtocol);
    plugin.register(() => this.app.workspace.unregisterObsidianProtocolHandler("unique", onProtocol));

    const quickActions = this.app.mobileQuickActions;
    if (quickActions) {
      quickActions.registerQuickAction("unique", {
        title: host.i18n.plugins.uniqueNoteCreator.labelQuickAction(),
        iconName: "tray.full",
        callback: () => this.onCreateNote(),
      });
      plugin.register(() => quickActions.unregisterQuickAction("unique"));
    }
  };

  proto.onExternalSettingsChange = async function () {
    this.options = (await this.plugin.loadData()) || {};
  };

  /** First unused `format [ + " " + name]` timestamp; bumps by the smallest unit that changes it. */
  proto.getUniquePath = function (name) {
    name = name === undefined ? "" : name;
    const files = this.app.vault.getAllLoadedFiles();
    const exists = (candidate) => {
      for (const file of files) {
        if (file instanceof host.TFile && file.name.startsWith(candidate)) return true;
      }
      return false;
    };
    const now = window.moment();
    const format = this.getFormat();
    let result = now.format(format);
    if (name) result = result + " " + name;
    if (exists(result)) {
      let unit = "";
      for (const candidate of NOTE_FORMAT_UNITS) {
        if (now.clone().add(1, candidate).format(format) !== result) {
          unit = candidate;
          break;
        }
      }
      if (!unit) {
        new host.Notice(host.i18n.plugins.uniqueNoteCreator.msgFailedToGenerate({ format }));
        return null;
      }
      const cursor = now.clone();
      let next;
      while (exists((next = cursor.add(1, unit).format(format)))) { /* keep bumping */ }
      result = next;
    }
    return result;
  };

  proto.onCreateNote = async function (event) {
    const app = this.app;
    const options = this.options;
    const noteName = this.getUniquePath();
    if (!noteName) return;
    const leaf = app.workspace.getLeaf(host.Keymap.isModEvent(event || app.lastEvent));
    let parent;
    if (options.folder && String.isString(options.folder)) {
      const folder = app.vault.getFolderByPath(normalizePath(options.folder));
      if (!folder) {
        new host.Notice(host.i18n.plugins.uniqueNoteCreator.msgFolderNotFound({ folderOption: options.folder }));
        return;
      }
      parent = folder;
    } else {
      parent = app.fileManager.getNewFileParent("", noteName);
    }
    let file;
    try {
      if (options.template) {
        const templateFile = app.metadataCache.getFirstLinkpathDest(options.template, "");
        if (!templateFile) {
          new host.Notice(host.i18n.plugins.uniqueNoteCreator.msgTemplateFileNotFound({ template: options.template }));
          return;
        }
        const raw = await app.vault.cachedRead(templateFile);
        const content = applyTemplateVars(raw, { title: noteName }, {});
        file = await app.fileManager.createNewMarkdownFile(parent, noteName, content);
      } else {
        file = await app.fileManager.createNewMarkdownFile(parent, noteName);
      }
    } catch (error) {
      new host.Notice(error.toString());
      return;
    }
    await leaf.openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "end" } });
    return file;
  };

  /** Wraps the current selection in [[unique-note-name]] inside the editor. */
  proto.addUniqueLink = function (editor) {
    const state = editor.cm.state;
    const changes = state.changeByRange((range) => {
      const linkText = "[[";
      const selected = state.sliceDoc(range.from, range.to);
      const noteName = this.getUniquePath(selected);
      if (!noteName) return { range };
      const insert = linkText + noteName + "]]";
      const newRange = range.empty
        ? host.cmSelection.cursor(range.from + 2 + noteName.length)
        : host.cmCursorRange(range, range.from + 2, range.from + 2 + noteName.length);
      return { changes: { from: range.from, to: range.to, insert }, range: newRange };
    });
    changes.userEvent = "input.autocomplete";
    editor.cm.dispatch(changes);
  };

  proto.getFormat = function () {
    const format = this.options.format;
    return format && String.isString(format) ? format : s16UniqueNoteFormat;
  };

  return UniqueNotePlugin;
}

/** xee: the plugin's settings tab (folder, template file, id format). */
export function defineUniqueNoteSettingsTab(host) {
  const Base = host.PluginInstanceSettingTab;
  function UniqueNoteSettingsTab(app, plugin, instance) {
    const self = Base.call(this, app, plugin, instance) || this;
    self.icon = "sheets-in-box";
    self.instance = instance;
    return self;
  }
  inherit(UniqueNoteSettingsTab, Base);

  UniqueNoteSettingsTab.prototype.display = function () {
    const self = this;
    const containerEl = this.containerEl;
    containerEl.empty();
    const options = this.instance.options;
    const intro = document.createDocumentFragment();
    intro.appendText(host.i18n.plugins.dailyNotes.labelReferToSyntax());
    intro.createEl("a", {
      text: host.i18n.plugins.dailyNotes.labelSyntaxLink(),
      attr: { href: "https://momentjs.com/docs/#/displaying/format/", target: "_blank" },
    });
    intro.createEl("br");
    intro.appendText(host.i18n.plugins.dailyNotes.labelSyntaxLivePreview());
    const sampleEl = intro.createEl("b", "u-pop");

    new host.SettingGroup(containerEl)
      .addSetting((setting) => setting
        .setName(host.i18n.plugins.uniqueNoteCreator.optionNewFileLocation())
        .setDesc(host.i18n.plugins.uniqueNoteCreator.optionNewFileLocationDescription())
        .addText((text) => {
          text.setPlaceholder(host.i18n.setting.folderPathExamplePlaceholder())
            .setValue(options.folder)
            .onChange((value) => {
              options.folder = value.trim();
              self.plugin.saveData(options);
            });
          new host.FolderSuggest(self.app, text.inputEl, false, true);
        }))
      .addSetting((setting) => setting
        .setName(host.i18n.plugins.uniqueNoteCreator.optionTemplateFile())
        .setDesc(host.i18n.plugins.uniqueNoteCreator.optionTemplateFileDescription())
        .addText((text) => {
          text.setPlaceholder(host.i18n.plugins.uniqueNoteCreator.optionTemplateFilePlaceholder())
            .setValue(options.template)
            .onChange((value) => {
              options.template = value.trim();
              self.plugin.saveData(options);
            });
          new host.FilePathSuggest(self.app, text.inputEl);
        }))
      .addSetting((setting) => setting
        .setName(host.i18n.plugins.uniqueNoteCreator.optionIdFormat())
        .setDesc(intro)
        .addMomentFormat((format) => format
          .setSampleEl(sampleEl)
          .setDefaultFormat(s16UniqueNoteFormat)
          .setValue(options.format)
          .onChange((value) => {
            options.format = value.trim();
            self.plugin.saveData(options);
          })));
  };

  return UniqueNoteSettingsTab;
}
