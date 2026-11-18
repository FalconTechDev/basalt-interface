// The "Note composer" core plugin: merge one note into another, or extract a selection /
// a whole heading into a new note.
//
// Replaces the inherited pieces:
//   Z8  NoteComposerPlugin        -> defineNoteComposerPlugin
//   J8  MergeFileSuggest          -> defineMergeFileSuggest   (base: quick-switcher modal)
//   e7  ExtractFileSuggest        -> defineExtractFileSuggest (base: quick-switcher modal)
//   t7  NoteComposerSettingTab    -> defineNoteComposerSettingTab (base: plugin setting tab)
//   $8  gm.plugins.noteComposer   -> declarator __basaltHost.t.plugins.noteComposer
//
// Options persisted through the plugin instance: askBeforeMerging, replacementText ("link" |
// "embed" | "none") and an optional template file whose {{content}}/{{fromTitle}}/{{newTitle}}/
// {{date:...}} variables are expanded on merge/extract.

import { inherit } from "./inherit.js";
import { firstHeadingText } from "./path.js";
import { applyTemplateVars } from "./notes-utils.js";

const composerT = (host) => host.t.plugins.noteComposer;

// The plugin and the suggest/settings factories run at different bundle positions; they reach
// each other through this registry.
const composerParts = {};

const REPLACEMENT_LINK = "link";
const REPLACEMENT_EMBED = "embed";
const REPLACEMENT_NONE = "none";

/** Modal asking which file the current note should be merged into (or a new file created). */
export function defineMergeFileSuggest(host) {
  function MergeFileSuggest(app, composer) {
    const self = host.s13QuickSwitcherModalBase.call(this, app) || this;
    self.currentFile = null;
    self.emptyStateText = composerT(host).labelNoFiles();
    self.composer = composer;
    self.shouldShowNonImageAttachments = false;
    self.shouldShowImages = false;
    self.shouldShowNonAttachments = false;
    self.setPlaceholder(composerT(host).promptSelectFileToMerge());
    self.setInstructions([
      { command: "↑↓", purpose: composerT(host).instructionNavigate() },
      { command: "↵", purpose: composerT(host).instructionMerge() },
      { command: host.isMacLike ? "cmd ↵" : "ctrl ↵", purpose: composerT(host).instructionCreateNew() },
      { command: "shift ↵", purpose: composerT(host).instructionMergeAtTop() },
      { command: "esc", purpose: composerT(host).instructionDismiss() },
    ]);
    self.scope.register(["Shift"], "Enter", (event) => { self.selectActiveSuggestion(event); return false; });
    self.scope.register(["Mod"], "Enter", (event) => { self.selectActiveSuggestion(event); return false; });
    return self;
  }
  inherit(MergeFileSuggest, host.s13QuickSwitcherModalBase);
  const proto = MergeFileSuggest.prototype;

  proto.setCurrentFile = function (file) {
    this.currentFile = file;
  };

  proto.onChooseSuggestion = async function (suggestion, evt) {
    const app = this.app;
    const input = this.inputEl.value;
    let target;
    // Mod+Enter or no suggestion: create a new file from the typed name.
    if (host.Keymap.isModifier(evt, "Mod") || !suggestion || suggestion.type === "unresolved") {
      const linktext = suggestion && suggestion.type === "unresolved" ? suggestion.linktext : input;
      const parent = app.fileManager.getNewFileParent(this.currentFile.path, linktext);
      try {
        target = await app.fileManager.createNewMarkdownFile(parent, linktext);
      } catch (error) {
        new host.Notice(error.toString());
        return;
      }
    } else if (suggestion.type === "bookmark") {
      if (suggestion.item.type === "file") {
        const file = app.vault.getAbstractFileByPath(suggestion.item.path);
        if (file instanceof host.TFile) target = file;
      }
    } else {
      target = suggestion.file;
    }
    if (!target || target === this.currentFile) return;
    const source = this.currentFile;
    const composer = this.composer;
    let skipConfirm = false;
    const doMerge = async () => {
      if (skipConfirm) {
        composer.options.askBeforeMerging = false;
        composer.pluginInstance.saveData(composer.options);
      }
      await this.mergeFile(target, source, evt.shiftKey ? "prepend" : "append");
    };
    if (composer.options.askBeforeMerging) {
      const content = document.createDocumentFragment();
      content.createEl("p", {
        text: composerT(host).labelConfirmFileMerge({ file: source.basename, destination: target.basename }),
      });
      const modal = new host.ButtonModal(app).setTitle(composerT(host).labelMergeFile()).setContent(content);
      if (!host.Platform.isMobile) {
        modal.addCheckbox(host.t.dialogue.labelDoNotAskAgain(), (cb) => {
          skipConfirm = cb.target.checked;
        });
      }
      modal
        .addButton("mod-warning", composerT(host).buttonMerge(), () => doMerge())
        .addCancelButton()
        .open();
    } else {
      await doMerge();
    }
  };

  /** Reads the source, expands the template, writes into the target, trashes the source, opens the target. */
  proto.mergeFile = async function (target, source, position = "append") {
    const app = this.app;
    const fileManager = app.fileManager;
    const content = await app.vault.read(source);
    const merged = await this.composer.applyTemplate(content, source.basename, target.basename);
    await fileManager.runAsyncLinkUpdate(async (links) => {
      await fileManager.insertIntoFile(target, merged, position);
      await fileManager.trashFile(source);
      if (links) {
        for (const link of links) {
          if (link.resolvedFile === source) {
            link.resolvedFile = target;
            link.resolvedPaths = [];
          }
        }
      }
    });
    await app.workspace.getLeaf().openFile(target);
  };

  composerParts.MergeFileSuggest = MergeFileSuggest;
  return MergeFileSuggest;
}

/** Modal asking which file the current selection (or heading) should be extracted into. */
export function defineExtractFileSuggest(host) {
  function ExtractFileSuggest(app, editor, composer, heading) {
    const self = host.s13QuickSwitcherModalBase.call(this, app) || this;
    self.defaultValue = "";
    self.allowCreateNewFile = true;
    self.editor = editor;
    self.composer = composer;
    self.shouldShowUnresolved = true;
    self.shouldShowNonImageAttachments = false;
    self.shouldShowImages = false;
    self.shouldShowNonAttachments = false;
    if (!heading) {
      const firstLine = editor.getSelection().split("\n");
      if (firstLine.length > 0) heading = firstHeadingText(firstLine[0]);
    }
    self.defaultValue = heading || "";
    self.setPlaceholder(composerT(host).promptSelectFileToMerge());
    self.setInstructions([
      { command: "↑↓", purpose: composerT(host).instructionNavigate() },
      { command: "↵", purpose: composerT(host).instructionAppend() },
      { command: host.isMacLike ? "cmd ↵" : "ctrl ↵", purpose: composerT(host).instructionCreateNew() },
      { command: "shift ↵", purpose: composerT(host).instructionPrepend() },
      { command: "esc", purpose: composerT(host).instructionDismiss() },
    ]);
    self.scope.register(["Shift"], "Enter", (event) => { self.selectActiveSuggestion(event); return false; });
    self.scope.register(["Mod"], "Enter", (event) => { self.selectActiveSuggestion(event); return false; });
    return self;
  }
  inherit(ExtractFileSuggest, host.s13QuickSwitcherModalBase);
  const proto = ExtractFileSuggest.prototype;

  proto.onOpen = function () {
    host.s13QuickSwitcherModalBase.prototype.onOpen.call(this);
    this.inputEl.value = this.defaultValue;
    this.updateSuggestions();
  };

  proto.setCurrentFile = function (file) {
    this.currentFile = file;
  };

  proto.onChooseSuggestion = async function (suggestion, evt) {
    const app = this.app;
    const selection = this.editor.getSelection();
    const createNew = host.Keymap.isModifier(evt, "Mod");
    const source = this.currentFile;
    let target;
    try {
      if (createNew || !suggestion) {
        target = await app.fileManager.createNewMarkdownFileFromLinktext(this.inputEl.value, source.path);
      } else if (suggestion.type === "unresolved") {
        target = await app.fileManager.createNewMarkdownFileFromLinktext(suggestion.linktext, source.path);
      } else if (suggestion.type === "file" || suggestion.type === "alias") {
        target = suggestion.file;
      }
    } catch (error) {
      new host.Notice(error.toString());
      return;
    }
    const content = await this.composer.applyTemplate(selection, source.basename, target.basename);
    await app.fileManager.insertIntoFile(target, content, evt.shiftKey ? "prepend" : "append");
    const link = app.fileManager.generateMarkdownLink(target, source.path);
    const mode = this.composer.options.replacementText;
    if (mode === REPLACEMENT_EMBED) this.editor.replaceSelection("!" + link);
    else if (mode === REPLACEMENT_NONE) this.editor.replaceSelection("");
    else this.editor.replaceSelection(link);
  };

  composerParts.ExtractFileSuggest = ExtractFileSuggest;
  return ExtractFileSuggest;
}

/** Settings tab: replacement text after extraction, template file, merge confirmation. */
export function defineNoteComposerSettingTab(host) {
  function NoteComposerSettingTab(app, plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, app, plugin) || this;
    self.icon = "merge";
    self.instance = instance;
    return self;
  }
  inherit(NoteComposerSettingTab, host.PluginInstanceSettingTab);
  const proto = NoteComposerSettingTab.prototype;

  proto.display = function () {
    const self = this;
    const containerEl = this.containerEl;
    containerEl.empty();
    const options = this.instance.options;
    new host.SettingGroup(containerEl)
      .addSetting((setting) =>
        setting
          .setName(composerT(host).optionSplitReplacementText())
          .setDesc(composerT(host).optionSplitReplacementTextDescription())
          .addDropdown((dropdown) => {
            dropdown
              .addOption(REPLACEMENT_LINK, composerT(host).optionChoiceSplitReplacementTextLink())
              .addOption(REPLACEMENT_EMBED, composerT(host).optionChoiceSplitReplacementTextEmbed())
              .addOption(REPLACEMENT_NONE, composerT(host).optionChoiceSplitReplacementTextNone())
              .setValue(options.replacementText || REPLACEMENT_LINK)
              .onChange((value) => {
                options.replacementText = value;
                self.plugin.saveData(options);
              });
          })
      )
      .addSetting((setting) =>
        setting
          .setName(composerT(host).optionTemplateFile())
          .setDesc(composerT(host).optionTemplateFileDescription({ interpolation: { prefix: "{{{{", suffix: "}}}}" } }))
          .addText((text) => {
            text
              .setPlaceholder(host.t.setting.filePathExamplePlaceholder())
              .setValue(options.template)
              .onChange((value) => {
                options.template = value.trim();
                self.plugin.saveData(options);
              });
            new host.MarkdownFileSuggest(self.app, text.inputEl);
          })
      )
      .addSetting((setting) =>
        setting
          .setName(composerT(host).optionConfirmFileMerge())
          .setDesc(composerT(host).optionConfirmFileMergeDescription())
          .addToggle((toggle) => {
            toggle
              .setValue(options.askBeforeMerging)
              .onChange((value) => {
                options.askBeforeMerging = value;
                self.plugin.saveData(options);
              });
          })
      );
  };

  composerParts.NoteComposerSettingTab = NoteComposerSettingTab;
  return NoteComposerSettingTab;
}

/** The plugin shell: registers the three commands, the file/editor menu entries and the settings tab. */
export function defineNoteComposerPlugin(host) {
  const t = composerT(host);

  class NoteComposerPlugin {
    constructor() {
      this.id = "note-composer";
      this.name = t.name();
      this.description = t.desc();
      this.defaultOn = true;
      this.options = {};
      this.app = null;
      this.pluginInstance = null;
    }

    init(app, plugin) {
      const self = this;
      this.app = app;
      this.pluginInstance = plugin;
      plugin.registerGlobalCommand({
        id: "note-composer:merge-file",
        name: t.commandMergeFile(),
        icon: "lucide-git-merge",
        checkCallback: (checking) => {
          const file = self.app.workspace.getActiveFile();
          if (file && file.extension === "md") {
            if (!checking) {
              const modal = new composerParts.MergeFileSuggest(self.app, self);
              modal.setCurrentFile(file);
              modal.open();
            }
            return true;
          }
        },
      });
      plugin.registerGlobalCommand({
        id: "note-composer:split-file",
        name: t.commandSplitFile(),
        icon: "lucide-scissors",
        editorCheckCallback: (checking, editor, ctx) => {
          if (ctx.file && editor.somethingSelected()) {
            if (!checking) {
              const modal = new composerParts.ExtractFileSuggest(self.app, editor, self);
              modal.setCurrentFile(ctx.file);
              modal.open();
            }
            return true;
          }
        },
      });
      plugin.registerGlobalCommand({
        id: "note-composer:extract-heading",
        name: t.commandExtractHeading(),
        icon: "lucide-scissors",
        editorCheckCallback: (checking, editor, ctx) => {
          if (!ctx.file) return;
          const line = editor.getCursor().line;
          if (firstHeadingText(editor.getLine(line)) !== null) {
            if (!checking) self.extractHeading(ctx.file, editor);
            return true;
          }
        },
      });
    }

    async onEnable(app, wrapper) {
      this.options = (await wrapper.loadData()) || { askBeforeMerging: true };
      wrapper.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
      wrapper.registerEvent(app.workspace.on("editor-menu", this.onEditorMenu, this));
      wrapper.addSettingTab(new composerParts.NoteComposerSettingTab(app, wrapper, this));
    }

    async onExternalSettingsChange() {
      this.options = (await this.pluginInstance.loadData()) || {};
    }

    onFileMenu(menu, file, source) {
      if (source === "link-context-menu") return;
      if (!(file instanceof host.TFile) || file.extension !== "md") return;
      const self = this;
      menu.addItem((item) =>
        item
          .setSection("action")
          .setTitle(t.actionMergeFile())
          .setIcon("lucide-git-merge")
          .onClick(() => {
            const modal = new composerParts.MergeFileSuggest(self.app, self);
            modal.setCurrentFile(file);
            modal.open();
          })
      );
    }

    onEditorMenu(menu, editor, ctx) {
      const file = ctx.file;
      if (!file) return;
      const self = this;
      if (editor.getSelection().trim()) {
        menu.addItem((item) =>
          item
            .setTitle(t.commandSplitFile())
            .setIcon("lucide-git-branch-plus")
            .setSection("selection")
            .onClick(() => {
              const modal = new composerParts.ExtractFileSuggest(self.app, editor, self);
              modal.setCurrentFile(file);
              modal.open();
            })
        );
      }
      const line = editor.getCursor().line;
      if (firstHeadingText(editor.getLine(line)) !== null) {
        menu.addItem((item) =>
          item
            .setTitle(t.commandExtractHeading())
            .setSection("action")
            .setIcon("lucide-git-branch-plus")
            .onClick(() => self.extractHeading(file, editor))
        );
      }
    }

    /** Selects the whole section under the cursor's heading, then opens the extract modal for it. */
    extractHeading(file, editor) {
      const line = editor.getCursor().line;
      const section = this.getSelectionUnderHeading(file, editor, line);
      if (section) {
        editor.setSelection(section.start, section.end);
        const modal = new composerParts.ExtractFileSuggest(this.app, editor, this, section.heading);
        modal.setCurrentFile(file);
        modal.open();
      } else {
        new host.Notice(t.msgFailToFindHeading());
      }
    }

    /** Finds the heading at `line` and the line range of its section (up to the next same-or-higher heading). */
    getSelectionUnderHeading(file, editor, line) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) return null;
      const headings = cache.headings;
      if (!headings || headings.length === 0) return null;
      let heading = null;
      let level = 0;
      let next = null;
      for (const candidate of headings) {
        if (heading && candidate.level <= level) {
          next = candidate;
          break;
        }
        if (!heading && candidate.position.start.line === line) {
          level = candidate.level;
          heading = candidate;
        }
      }
      if (!heading) return null;
      let end;
      if (next) {
        end = next.position.start.line - 1;
        while (editor.getLine(end).trim() === "" && end > line) end--;
      } else {
        end = editor.lineCount() - 1;
      }
      return {
        heading: heading.heading.trim(),
        start: { line, ch: 0 },
        end: { line: end, ch: editor.getLine(end).length },
      };
    }

    /** Expands the configured template file's variables against the merge/extract context. */
    async applyTemplate(content, fromTitle, newTitle) {
      const template = this.options.template;
      if (!template) return content;
      const app = this.app;
      const dest = app.metadataCache.getFirstLinkpathDest(template, "");
      if (!dest) {
        new host.Notice(t.msgFailToFetchTemplate({ template }));
        return content;
      }
      let templateText = await app.vault.cachedRead(dest);
      if (!templateText) return content;
      if (!templateText.contains("{{content}}")) templateText += "\n\n{{content}}";
      return applyTemplateVars(templateText, { fromTitle, newTitle, content });
    }
  }
  return NoteComposerPlugin;
}
