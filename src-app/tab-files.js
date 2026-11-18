// The "Files and links" settings tab plus the small suggest classes and the ignore-filters dialog it
// uses: default open action, new-note / attachment locations, link format, trash options, excluded
// files and the advanced section (config folder, URI callbacks, reindex).
import { inherit } from "./inherit.js";
import { hostEnv } from "./env.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { withoutExtension } from "./path.js";
import { sortHitsByScore } from "./misc.js";
import { renderMatches } from "./search-simple.js";

const PATH_SUGGESTION_LIMIT = 100;

export function defineFilePathSuggest(host) {
  /** File-path suggestions for a text field: fuzzy match over every loaded file, ".md" shown without extension. */
  function FilePathSuggest(app, textInputEl) {
    const self = host.AbstractInputSuggest.call(this, app, textInputEl) || this;
    return self;
  }
  inherit(FilePathSuggest, host.AbstractInputSuggest);
  const proto = FilePathSuggest.prototype;

  proto.renderSuggestion = function (result, el) {
    el.addClass("mod-nowrap");
    const file = result.item;
    renderMatches(el, file.extension === "md" ? withoutExtension(file.path) : file.path, result.match.matches);
  };

  proto.getSuggestions = function (query) {
    const results = [];
    const prepared = prepareQuery(query);
    const files = this.app.vault.getAllLoadedFiles();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (results.length >= PATH_SUGGESTION_LIMIT) break;
      if (file instanceof host.TFile && this.filePredicate(file)) {
        const match = fuzzyMatchJs(prepared, file.path);
        if (match) results.push({ item: file, match });
      }
    }
    sortHitsByScore(results);
    return results;
  };

  proto.filePredicate = function () { return true; };

  proto.selectSuggestion = function (result) {
    const file = result.item;
    const value = file.extension === "md" ? withoutExtension(file.path) : file.path;
    this.setValue(value);
    this.textInputEl.trigger("input");
    this.textInputEl.trigger("change");
    this.close();
  };

  return FilePathSuggest;
}

export function defineFolderPathSuggest(host) {
  /** Folder-path suggestions for a text field; `allowNullSelection` adds a "+ current value" row. */
  function FolderPathSuggest(app, textInputEl, allowNullSelection = false, includeRoot = false) {
    const self = host.AbstractInputSuggest.call(this, app, textInputEl) || this;
    self.allowNullSelection = allowNullSelection;
    self.includeRoot = includeRoot;
    return self;
  }
  inherit(FolderPathSuggest, host.AbstractInputSuggest);
  const proto = FolderPathSuggest.prototype;

  proto.renderSuggestion = function (result, el) {
    if (result) renderMatches(el, result.item.path, result.match.matches);
    else el.setText("+ " + this.getValue());
  };

  proto.getSuggestions = function (query) {
    const prepared = prepareQuery(query);
    const results = [];
    const folders = this.app.vault.getAllFolders(this.includeRoot);
    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];
      if (results.length >= PATH_SUGGESTION_LIMIT) break;
      if (this.filePredicate(folder)) {
        const match = fuzzyMatchJs(prepared, folder.path);
        if (match) results.push({ item: folder, match });
      }
    }
    sortHitsByScore(results);
    if (this.allowNullSelection && query) results.push(null);
    return results;
  };

  proto.filePredicate = function () { return true; };

  proto.selectSuggestion = function (result) {
    if (result) {
      this.setValue(result.item.path);
      this.textInputEl.trigger("input");
    }
    this.close();
    host.AbstractInputSuggest.prototype.selectSuggestion.call(this, result);
  };

  return FolderPathSuggest;
}

export function defineIgnoreFiltersModal(host) {
  /** Dialog for the user ignore-filter list ("Files and links" -> excluded files). */
  function IgnoreFiltersModal(app, values, onSave) {
    const self = host.ButtonModal.call(this, app) || this;
    const i18nFile = host.t.setting.file;
    self.setTitle(i18nFile.optionExcludedFiles());
    self.values = values;
    self.descEl = self.contentEl.createEl("p");
    self.listEl = self.contentEl.createDiv();
    let input = null;
    const addFilter = () => {
      const value = input.getValue();
      if (!value.trim()) {
        host.displayTooltip(input.inputEl, i18nFile.messageEmptyFilter(), { classes: ["mod-error"] });
        setTimeout(() => host.hideTooltip(), 2000);
        return;
      }
      self.values.push(value);
      self.display();
      input.setValue("");
    };
    new host.Setting(self.contentEl)
      .setName(i18nFile.labelExcludedFilter())
      .addText((text) => {
        input = text;
        text.setPlaceholder(i18nFile.placeholderExcludedFilter());
        const el = text.inputEl;
        el.addEventListener("keydown", (event) => {
          if (!event.isComposing && event.key === "Enter") addFilter();
        });
        new host.FolderPathSuggestTab(app, el, true, false).onSelect((result) => {
          if (result) input.setValue(result.item.path + "/");
          addFilter();
        });
      })
      .addButton((button) => {
        button.setButtonText(host.t.interface.buttonAdd()).onClick(addFilter);
      });
    self.addButton("mod-cta", host.t.dialogue.buttonSave(), () => {
      self.close();
      onSave(self.values);
    });
    self.addCancelButton();
    return self;
  }
  inherit(IgnoreFiltersModal, host.ButtonModal);
  const proto = IgnoreFiltersModal.prototype;

  proto.onOpen = function () { this.display(); };

  proto.display = function () {
    const self = this;
    const i18nFile = host.t.setting.file;
    const listEl = this.listEl;
    const descEl = this.descEl;
    const values = this.values;
    if (values.length === 0) descEl.setText(i18nFile.labelNoExcludedFiltersApplied());
    else descEl.setText(i18nFile.labelExcludedFiltersApplied());
    listEl.empty();
    for (const value of values) {
      listEl.createDiv("mobile-option-setting-item", (row) => {
        row.createSpan({ cls: "mobile-option-setting-item-name", text: value }, (nameEl) => {
          if (value.length > 2 && value.startsWith("/") && value.endsWith("/")) {
            nameEl.createSpan({ text: "Regex", cls: "flair mod-flat" });
          }
        });
        row.createDiv("clickable-icon mobile-option-setting-item-option-icon", (icon) => {
          host.setIcon(icon, "lucide-x");
          host.setTooltip(icon, host.t.interface.deleteActionShortName());
          icon.addEventListener("click", () => {
            values.remove(value);
            self.display();
          });
        });
      });
    }
  };

  return IgnoreFiltersModal;
}

/** Persists the chosen config directory (mobile preferences backend; no-op on desktop). */
export function saveConfigDirPreference(app, dir) {
  const prefs = hostEnv().Fm;
  if (!prefs) return Promise.resolve();
  const key = app.appId + "-config";
  return dir ? prefs.set({ key, value: dir }) : prefs.remove({ key });
}

export function defineFilesLinksTab(host) {
  const env = () => hostEnv();
  const i18n = () => host.t.setting.file;

  const DELETE_OPTIONS = () => [
    { value: "system", description: i18n().optionChoiceSystemTrash() },
    { value: "local", description: i18n().optionChoiceVaultTrash() },
    { value: "none", description: i18n().optionChoicePermanentDelete() },
  ];
  const DELETE_ATTACHMENT_OPTIONS = () => [
    { value: "ask", description: i18n().optionChoiceAskEveryTime() },
    { value: "always", description: i18n().optionChoiceAlways() },
    { value: "never", description: i18n().optionChoiceNever() },
  ];
  const NEW_NOTE_LOCATION_OPTIONS = () => [
    { value: "root", description: i18n().optionChoiceVaultRoot() },
    { value: "current", description: i18n().optionChoiceCurrentFolder() },
    { value: "folder", description: i18n().optionChoiceSpecifiedFolder() },
  ];
  const NEW_LINK_FORMAT_OPTIONS = () => [
    { value: "shortest", description: i18n().optionChoiceShortestLinktext() },
    { value: "relative", description: i18n().optionChoiceRelativePath() },
    { value: "absolute", description: i18n().optionChoiceAbsolutePath() },
  ];
  const NEW_ATTACHMENT_LOCATION_OPTIONS = () => [
    { value: "root", description: i18n().optionChoiceVaultRoot() },
    { value: "current", description: i18n().optionChoiceCurrentFolder() },
    { value: "subfolder", description: i18n().optionChoiceSubdirectory() },
    { value: "folder", description: i18n().optionChoiceSpecifiedFolder() },
  ];

  /** Settings tab id "file". */
  function FilesLinksTab(app, setting) {
    const self = host.SettingTab.apply(this, arguments) || this;
    self.name = i18n().name();
    self.id = "file";
    self.icon = "folder-cog";
    return self;
  }
  inherit(FilesLinksTab, host.SettingTab);
  const proto = FilesLinksTab.prototype;

  proto.display = function () {
    const self = this;
    const app = this.app;
    const vault = app.vault;
    const containerEl = this.containerEl;
    const i18nFile = i18n();
    containerEl.empty();

    const group = new host.SettingGroup(containerEl);

    // ---- default open action ----
    let openPathSetting = null;
    let openPathDropdown = null;
    let openPathText = null;
    const syncOpenBehavior = () => {
      let value = openPathDropdown.getValue();
      if (value === "file") value = "file:" + openPathText.getValue();
      vault.setConfig("openBehavior", value);
    };
    const syncOpenVisibility = () => openPathSetting.settingEl.toggle(openPathDropdown.getValue() === "file");

    group
      .addSetting((setting) => {
        setting
          .setName(i18nFile.optionDefaultOpenAction())
          .setDesc(i18nFile.optionDefaultOpenActionDescription())
          .addDropdown((dropdown) => {
            openPathDropdown = dropdown;
            dropdown
              .addOption("", i18nFile.optionChoiceLastOpened())
              .addOption("new", i18nFile.optionChoiceNewNote())
              .addOption("file", i18nFile.optionChoiceSpecificFile());
            if (app.internalPlugins.getEnabledPluginById("daily-notes")) {
              dropdown.addOption("daily", i18nFile.optionChoiceDailyNote());
            }
            dropdown.onChange(() => {
              syncOpenVisibility();
              syncOpenBehavior();
            });
          });
      })
      .addSetting((setting) => {
        openPathSetting = setting;
        setting
          .setName(i18nFile.optionDefaultOpenFilePath())
          .setDesc(i18nFile.optionDefaultOpenFilePathDescription())
          .addText((text) => {
            openPathText = text;
            text.onChange(syncOpenBehavior);
            new host.FilePathSuggest(app, text.inputEl);
          });
      });

    // restore the saved open behavior
    let openBehavior = vault.getConfig("openBehavior");
    if (openBehavior.startsWith("file:")) {
      openPathText.setValue(openBehavior.substring(5));
      openBehavior = "file";
    }
    openPathDropdown.setValue(openBehavior);
    syncOpenVisibility();

    // ---- new note location ----
    let newFileLocationDropdown = null;
    let newFileFolderText = null;
    const syncNewFileVisibility = () => newFileFolderText.settingEl.toggle(newFileLocationDropdown.getValue() === "folder");
    group
      .addSetting((setting) => {
        setting
          .setName(i18nFile.optionNewNoteLocation())
          .setDesc(i18nFile.optionNewNoteLocationDescription())
          .addDropdown((dropdown) => {
            newFileLocationDropdown = dropdown;
            dropdown.onChange((value) => {
              vault.setConfig("newFileLocation", value);
              syncNewFileVisibility();
            });
            for (const option of NEW_NOTE_LOCATION_OPTIONS()) dropdown.addOption(option.value, option.description);
            dropdown.setValue(vault.getConfig("newFileLocation"));
          });
      })
      .addSetting((setting) => {
        newFileFolderText = setting;
        setting
          .setName(i18nFile.optionNewFileFolderPath())
          .setDesc(i18nFile.optionNewFileFolderPathDescription())
          .addText((text) => {
            const value = vault.getConfig("newFileFolderPath");
            text
              .setPlaceholder(host.t.setting.folderPathExamplePlaceholder())
              .setValue(value === "/" ? "" : value)
              .onChange((v) => vault.setConfig("newFileFolderPath", v));
            new host.FolderPathSuggestTab(app, text.inputEl, false, true);
          });
      });
    syncNewFileVisibility();

    // ---- attachment location ----
    let attachmentDropdown = null;
    let attachmentFolderText = null;
    let attachmentSubfolderText = null;
    let attachmentFolderComponent = null;
    let attachmentSubfolderComponent = null;
    const defaultAttachmentFolder = i18nFile.optionNewAttachmentLocationDefault();
    const syncAttachmentVisibility = () => {
      const value = attachmentDropdown.getValue();
      attachmentFolderText.settingEl.toggle(value === "folder");
      attachmentSubfolderText.settingEl.toggle(value === "subfolder");
    };
    const effectiveAttachmentPath = () => {
      const value = attachmentDropdown.getValue();
      if (value === "root") return "/";
      if (value === "folder") return attachmentFolderComponent.getValue() || defaultAttachmentFolder;
      if (value === "current") return "./";
      if (value === "subfolder") return "./" + (attachmentSubfolderComponent.getValue() || defaultAttachmentFolder);
      return "";
    };
    group
      .addSetting((setting) => {
        setting
          .setName(i18nFile.optionNewAttachmentLocation())
          .setDesc(i18nFile.optionNewAttachmentLocationDescription())
          .addDropdown((dropdown) => {
            attachmentDropdown = dropdown;
            dropdown.onChange(() => {
              syncAttachmentVisibility();
              vault.setConfig("attachmentFolderPath", effectiveAttachmentPath());
            });
            for (const option of NEW_ATTACHMENT_LOCATION_OPTIONS()) dropdown.addOption(option.value, option.description);
          });
      })
      .addSetting((setting) => {
        attachmentFolderText = setting;
        setting
          .setName(i18nFile.optionAttachmentFolderPath())
          .setDesc(i18nFile.optionAttachmentFolderPathDescription())
          .addText((text) => {
            attachmentFolderComponent = text;
            text.setPlaceholder(defaultAttachmentFolder).onChange(() => vault.setConfig("attachmentFolderPath", effectiveAttachmentPath()));
            new host.FolderPathSuggestTab(app, text.inputEl, false, true);
          });
      })
      .addSetting((setting) => {
        attachmentSubfolderText = setting;
        setting
          .setName(i18nFile.optionAttachmentSubfolderPath())
          .setDesc(i18nFile.optionAttachmentSubfolderPathDescription())
          .addText((text) => {
            attachmentSubfolderComponent = text;
            text.setPlaceholder(defaultAttachmentFolder).onChange(() => vault.setConfig("attachmentFolderPath", effectiveAttachmentPath()));
          });
      });

    // restore the saved attachment folder into the dropdown + fields
    const restoreAttachment = (path) => {
      if (path === "/") {
        attachmentDropdown.setValue("root");
      } else if (path === "." || path === "./") {
        attachmentDropdown.setValue("current");
      } else if (path.startsWith("./")) {
        const sub = path.slice(2);
        attachmentDropdown.setValue("subfolder");
        attachmentSubfolderComponent.setValue(sub !== defaultAttachmentFolder ? sub : "");
      } else {
        attachmentDropdown.setValue("folder");
        attachmentFolderComponent.setValue(path !== defaultAttachmentFolder ? path : "");
      }
    };
    restoreAttachment(vault.getConfig("attachmentFolderPath"));
    syncAttachmentVisibility();

    // ---- links ----
    new host.SettingGroup(containerEl)
      .setHeading(i18nFile.optionLinks())
      .addSetting((setting) => {
        setting
          .setName(i18nFile.optionLinkAutocompletedFormat())
          .setDesc(i18nFile.optionLinkAutocompletedFormatDescription())
          .addDropdown((dropdown) => {
            dropdown.onChange((value) => vault.setConfig("newLinkFormat", value));
            for (const option of NEW_LINK_FORMAT_OPTIONS()) dropdown.addOption(option.value, option.description);
            dropdown.setValue(vault.getConfig("newLinkFormat"));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nFile.optionAlwaysUpdateLinks())
          .setDesc(i18nFile.optionAlwaysUpdateLinksDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("alwaysUpdateLinks")).onChange((value) => vault.setConfig("alwaysUpdateLinks", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nFile.optionUseWikiLinks())
          .setDesc(i18nFile.optionUseWikiLinksDescription())
          .addToggle((toggle) => {
            toggle.setValue(!vault.getConfig("useMarkdownLinks")).onChange((value) => vault.setConfig("useMarkdownLinks", !value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nFile.optionShowUnsupportedFiles())
          .setDesc(i18nFile.optionShowUnsupportedFilesDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("showUnsupportedFiles")).onChange((value) => vault.setConfig("showUnsupportedFiles", value));
          });
      });

    // ---- trash ----
    new host.SettingGroup(containerEl)
      .setHeading(i18nFile.optionTrash())
      .addSetting((setting) => {
        setting
          .setName(i18nFile.optionConfirmFileDeletion())
          .setDesc(i18nFile.optionConfirmFileDeletionDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("promptDelete")).onChange((value) => vault.setConfig("promptDelete", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nFile.optionDeleteUnlinkedAttachments())
          .setDesc(i18nFile.optionDeleteUnlinkedAttachmentsDescription())
          .addDropdown((dropdown) => {
            dropdown.onChange((value) => vault.setConfig("deleteUnlinkedAttachments", value));
            for (const option of DELETE_ATTACHMENT_OPTIONS()) dropdown.addOption(option.value, option.description);
            dropdown.setValue(vault.getConfig("deleteUnlinkedAttachments"));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nFile.optionDeleteDestination())
          .setDesc(i18nFile.optionDeleteDestinationDescription())
          .addDropdown((dropdown) => {
            dropdown.onChange((value) => vault.setConfig("trashOption", value));
            for (const option of DELETE_OPTIONS()) dropdown.addOption(option.value, option.description);
            dropdown.setValue(vault.getConfig("trashOption"));
          });
      });

    // ---- advanced ----
    const aboutI18n = host.t.setting.about;
    const appId = app.appId;
    const storedConfigDir = localStorage.getItem(appId + "-config") || "";
    let pendingConfigDir = storedConfigDir;
    let excludedFilesSetting = null;
    let relaunchButton = null;
    const refreshExcludedFilesDesc = () => {
      excludedFilesSetting.setDesc(createFragment((frag) => {
        frag.appendText(i18nFile.optionExcludedFilesDesc());
        const filters = vault.getConfig("userIgnoreFilters");
        if (filters && filters.length > 0) {
          const list = frag.createEl("ul");
          for (const filter of filters) {
            list.createEl("li", "", (item) => {
              item.createSpan({ text: filter }, (nameEl) => {
                if (filter.length > 2 && filter.startsWith("/") && filter.endsWith("/")) {
                  nameEl.createSpan({ text: "Regex", cls: "flair mod-flat" });
                }
              });
            });
          }
        }
      }));
    };

    new host.SettingGroup(containerEl)
      .setHeading(aboutI18n.optionAdvanced())
      .addSetting((setting) => {
        excludedFilesSetting = setting;
        setting
          .setName(i18nFile.optionExcludedFiles())
          .addButton((button) => {
            button.setButtonText(host.t.interface.buttonManage()).onClick(() => {
              const filters = vault.getConfig("userIgnoreFilters") || [];
              new host.IgnoreFiltersModal(app, filters, (values) => {
                vault.setConfig("userIgnoreFilters", values.length === 0 ? null : values);
                refreshExcludedFilesDesc();
              }).open();
            });
          });
      })
      .addSetting((setting) => {
        setting
          .setName(aboutI18n.optionConfigLocation())
          .setDesc(aboutI18n.optionConfigLocationDescription())
          .addButton((button) => {
            relaunchButton = button;
            button.setCta().setButtonText(aboutI18n.buttonRelaunch()).onClick(async () => {
              localStorage.setItem(appId + "-config", pendingConfigDir);
              await saveConfigDirPreference(app, pendingConfigDir);
              window.location.reload();
            });
            button.buttonEl.hide();
          })
          .addText((text) => {
            text
              .setPlaceholder(".obsidian")
              .setValue(storedConfigDir)
              .onChange((value) => {
                if (!value || env().JT.validateConfigDir(value)) {
                  host.hideTooltip();
                  pendingConfigDir = value;
                  relaunchButton.buttonEl.toggle(value !== storedConfigDir);
                } else {
                  host.displayTooltip(text.inputEl, aboutI18n.optionConfigLocationWarning(), { placement: "left", classes: ["mod-error"] });
                }
              });
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nFile.optionUriCallbacks())
          .setDesc(createFragment((frag) => {
            frag.appendText(i18nFile.optionUriCallbacksDesc() + " ");
            frag.createEl("a", { href: "https://github.com/FalconTechDev/basalt/wiki", text: host.t.interface.buttonLearnMore(), attr: { target: "_blank" } });
          }))
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("uriCallbacks")).onChange((value) => vault.setConfig("uriCallbacks", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(host.t.setting.editor.optionReindexVault())
          .setDesc(createFragment((frag) => {
            frag.createSpan({ cls: "mod-warning", text: host.t.setting.editor.optionReindexVaultDescription() });
            frag.createEl("br");
            frag.createEl("a", { href: "https://github.com/FalconTechDev/basalt/wiki", text: host.t.interface.buttonLearnMore(), attr: { target: "_blank" } });
          }))
          .addButton((button) => {
            button.setButtonText(host.t.setting.editor.labelReindex()).setClass("mod-destructive").onClick(async () => {
              await app.metadataCache.clear();
              window.location.reload();
            });
          });
      });
    refreshExcludedFilesDesc();
  };

  return FilesLinksTab;
}
