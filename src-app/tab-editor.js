// The "Editor" settings tab: default tab view / editing mode, display toggles, behaviour toggles,
// spellcheck languages (Electron session), tab size and the Vim-mode confirmation flow.
// The spellcheck dictionary dialog is included; the language-name table stays a host binding.
import { inherit } from "./inherit.js";
import { hostEnv } from "./env.js";
import { stringCollator } from "./misc.js";

export function defineSpellcheckDictionaryModal(host) {
  /** Lists the words in the OS spell-checker dictionary; each can be removed. */
  function SpellcheckDictionaryModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.titleEl.setText(host.t.setting.editor.spellcheckDict());
    return self;
  }
  inherit(SpellcheckDictionaryModal, host.Modal);
  const proto = SpellcheckDictionaryModal.prototype;

  proto.onOpen = function () { this.rerender(); };
  proto.onClose = function () { this.contentEl.empty(); };

  proto.rerender = async function () {
    const self = this;
    const containerEl = this.contentEl;
    containerEl.empty();
    await hostEnv().Of((electron) => {
      const session = electron.remote.getCurrentWebContents().session;
      return session.listWordsInSpellCheckerDictionary().then((words) => {
        words.sort(stringCollator.compare);
        const listEl = containerEl.createDiv("spellchecker-dictionary-container");
        for (const word of words) {
          const item = listEl.createDiv("spellchecker-dictionary-item");
          const remove = item.createDiv("spellchecker-dictionary-remove-button");
          host.setIcon(remove, "lucide-x");
          host.setTooltip(remove, "Remove from dictionary");
          remove.addEventListener("click", () => {
            session.removeWordFromSpellCheckerDictionary(word);
            self.rerender();
          });
          item.createDiv({ cls: "spellchecker-dictionary-word", text: word });
        }
        if (words.length === 0) containerEl.createEl("p", { text: host.t.setting.editor.spellcheckDictEmpty() });
      });
    });
  };

  return SpellcheckDictionaryModal;
}

export function defineEditorTab(host) {
  const env = () => hostEnv();
  const editorI18n = () => host.t.setting.editor;

  /** Settings tab id "editor". */
  function EditorTab(app, setting) {
    const self = host.SettingTab.apply(this, arguments) || this;
    self.name = editorI18n().name();
    self.id = "editor";
    self.icon = "pen-line";
    self.passedVimTest = false;
    return self;
  }
  inherit(EditorTab, host.SettingTab);
  const proto = EditorTab.prototype;

  proto.display = function () {
    const self = this;
    const app = this.app;
    const vault = app.vault;
    const containerEl = this.containerEl;
    const i18nEditor = editorI18n();
    containerEl.empty();

    new host.SettingGroup(containerEl)
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionOpenTabInForeground())
          .setDesc(i18nEditor.optionOpenTabInForegroundDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("focusNewTab")).onChange((value) => vault.setConfig("focusNewTab", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionDefaultNewTabView())
          .setDesc(i18nEditor.optionDefaultNewTabViewDescription())
          .addDropdown((dropdown) => {
            dropdown
              .addOption("source", i18nEditor.optionDefaultNewTabViewEditing())
              .addOption("preview", i18nEditor.optionDefaultNewTabViewReading())
              .setValue(vault.getConfig("defaultViewMode"))
              .onChange((value) => vault.setConfig("defaultViewMode", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionDefaultEditingMode())
          .setDesc(i18nEditor.optionDefaultEditingModeDescription())
          .addDropdown((dropdown) => {
            dropdown
              .addOption("live-preview", i18nEditor.optionDefaultEditingModeLivePreview())
              .addOption("source", i18nEditor.optionDefaultEditingModeSource())
              .setValue(vault.getConfig("livePreview") ? "live-preview" : "source")
              .onChange((value) => {
                vault.setConfig("livePreview", value === "live-preview");
                for (const leaf of app.workspace.getLeavesOfType("markdown")) {
                  const state = leaf.getViewState();
                  state.state.source = value !== "live-preview";
                  leaf.setViewState(state);
                }
              });
          });
      })
      .addSetting((setting) => {
        const plugin = app.internalPlugins.plugins["editor-status"];
        setting
          .setName(host.t.plugins.editorStatus.name())
          .setDesc(host.t.plugins.editorStatus.desc())
          .addToggle((toggle) => {
            toggle.setValue(plugin.enabled).onChange((enabled) => (enabled ? plugin.enable(true) : plugin.disable(true)));
          });
      });

    new host.SettingGroup(containerEl)
      .setHeading(i18nEditor.sectionDisplay())
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionReadableLineLength())
          .setDesc(i18nEditor.optionReadableLineDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("readableLineLength")).onChange((value) => vault.setConfig("readableLineLength", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionStrictLineBreak())
          .setDesc(i18nEditor.optionStrictLineBreakDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("strictLineBreaks")).onChange((value) => vault.setConfig("strictLineBreaks", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionPropertiesInDocument())
          .setDesc(i18nEditor.optionPropertiesInDocumentDescription())
          .addDropdown((dropdown) => {
            dropdown
              .addOption("visible", i18nEditor.optionPropertiesVisible())
              .addOption("hidden", i18nEditor.optionPropertiesHidden())
              .addOption("source", i18nEditor.optionPropertiesSource())
              .setValue(vault.getConfig("propertiesInDocument"))
              .onChange((value) => vault.setConfig("propertiesInDocument", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionFoldHeading())
          .setDesc(i18nEditor.optionFoldHeadingDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("foldHeading")).onChange((value) => vault.setConfig("foldHeading", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionFoldIndent())
          .setDesc(i18nEditor.optionFoldIndentDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("foldIndent")).onChange((value) => vault.setConfig("foldIndent", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionShowLineNumber())
          .setDesc(i18nEditor.optionShowLineNumberDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("showLineNumber")).onChange((value) => vault.setConfig("showLineNumber", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionIndentationGuide())
          .setDesc(i18nEditor.optionIndentationGuideDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("showIndentGuide")).onChange((value) => vault.setConfig("showIndentGuide", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionRtl())
          .setDesc(i18nEditor.optionRtlDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("rightToLeft")).onChange((value) => vault.setConfig("rightToLeft", value));
          });
      });

    const behavior = new host.SettingGroup(containerEl).setHeading(i18nEditor.sectionBehavior());
    let spellcheckSetting = null;
    behavior.addSetting((setting) => {
      spellcheckSetting = setting;
      setting.setName(i18nEditor.optionSpellcheck()).setDesc(i18nEditor.optionSpellcheckDescription());
      if (host.Platform.isDesktopApp) {
        setting.addExtraButton((button) => {
          button.onClick(() => new host.SpellcheckDictionaryModal(app).open());
        });
      }
      setting.addToggle((toggle) => {
        toggle.setValue(vault.getConfig("spellcheck")).onChange((value) => vault.setConfig("spellcheck", value));
      });
    });

    if (host.Platform.isDesktopApp) {
      env().Of((electron) => {
        const session = electron.remote.getCurrentWebContents().session;
        behavior.addSetting((setting) => {
          setting.setName(i18nEditor.spellcheckLanguages()).setDesc(i18nEditor.spellcheckLanguagesDescription());
          if (host.isMacLike) {
            setting.setDesc(i18nEditor.spellcheckLanguagesMacDescription());
            return;
          }
          const paintLanguages = () => {
            setting.clear();
            const available = session.availableSpellCheckerLanguages;
            let languages = app.getSpellcheckLanguages();
            const box = setting.controlEl.createDiv("setting-command-hotkeys");
            if (languages) {
              const rows = languages.map((lang) => ({
                lang,
                display: available.contains(lang) ? env().ym(lang) : env().ym(lang) + " (Not available)",
              }));
              rows.sort((a, b) => stringCollator.compare(a.display, b.display));
              for (const row of rows) {
                box.createSpan({ cls: "setting-hotkey", text: row.display }).createSpan("setting-hotkey-icon", (icon) => {
                  host.setIcon(icon, "lucide-x");
                  icon.addEventListener("click", () => {
                    app.setSpellcheckLanguages(languages.filter((lang) => lang !== row.lang));
                    paintLanguages();
                  });
                });
              }
              const reset = setting.controlEl.createSpan("clickable-icon setting-restore-hotkey-button");
              host.setIcon(reset, "lucide-rotate-ccw");
              reset.addEventListener("click", () => {
                app.setSpellcheckLanguages(null);
                paintLanguages();
              });
            } else {
              box.createSpan({ cls: "setting-hotkey", text: env().ym(electron.remote.app.getLocale()) });
            }
            setting.addDropdown((dropdown) => {
              dropdown.selectEl.style.width = "80px";
              dropdown.addOption("", "+");
              const options = available.map((lang) => ({ lang, display: env().ym(lang) }));
              options.sort((a, b) => stringCollator.compare(a.display, b.display));
              for (const option of options) dropdown.addOption(option.lang, option.display);
              dropdown.onChange((value) => {
                if (!value) return;
                if (!languages) languages = [electron.remote.app.getLocale()];
                if (languages.contains(value)) {
                  paintLanguages();
                  return;
                }
                languages.push(value);
                app.setSpellcheckLanguages(languages);
                paintLanguages();
              });
            });
          };
          paintLanguages();
        });
      });
    }

    behavior
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionAutoPairBrackets())
          .setDesc(i18nEditor.optionAutoPairBracketsDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("autoPairBrackets")).onChange((value) => vault.setConfig("autoPairBrackets", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionAutoPairMarkdown())
          .setDesc(i18nEditor.optionAutoPairMarkdownDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("autoPairMarkdown")).onChange((value) => vault.setConfig("autoPairMarkdown", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionSmartIndentLists())
          .setDesc(i18nEditor.optionSmartIndentListsDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("smartIndentList")).onChange((value) => vault.setConfig("smartIndentList", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionUseTabs())
          .setDesc(i18nEditor.optionUseTabsDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("useTab")).onChange((value) => vault.setConfig("useTab", value));
          });
      })
      .addSetting((setting) => {
        let slider = null;
        setting
          .setName(i18nEditor.optionTabSize())
          .setDesc(i18nEditor.optionTabSizeDescription())
          .addExtraButton((button) => {
            button.setIcon("lucide-rotate-ccw").setTooltip(host.t.setting.hotkeys.tooltipRestoreDefault()).onClick(() => {
              vault.setConfig("tabSize", 4);
              slider.setValue(4);
            });
          })
          .addSlider((s) => {
            slider = s.setLimits(2, 8, 1).setDynamicTooltip().setValue(vault.getConfig("tabSize")).onChange((value) => vault.setConfig("tabSize", value));
          });
      });

    new host.SettingGroup(containerEl)
      .setHeading(host.t.setting.about.optionAdvanced())
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionAutoConvertHtml())
          .setDesc(i18nEditor.optionAutoConvertHtmlDescription())
          .addToggle((toggle) => {
            toggle.setValue(vault.getConfig("autoConvertHtml")).onChange((value) => vault.setConfig("autoConvertHtml", value));
          });
      })
      .addSetting((setting) => {
        setting
          .setName(i18nEditor.optionVimKeyBindings())
          .setDesc(createFragment((frag) => {
            frag.appendText(i18nEditor.optionVimKeyBindingsDescription());
            if (host.Platform.isMobile) {
              frag.createEl("br");
              frag.appendText(i18nEditor.optionVimKeyBindingsMobile());
            }
          }))
          .addToggle((toggle) => {
            toggle.setValue(app.isVimEnabled()).onChange((value) => {
              if (!self.passedVimTest && value === true) {
                if (host.Platform.isMobile) {
                  if (value) localStorage.setItem("vim", "true");
                  else localStorage.removeItem("vim");
                  app.workspace.updateOptions();
                } else {
                  toggle.setValue(false);
                  self.startVimTest(toggle);
                }
              } else {
                vault.setConfig("vimMode", value);
              }
            });
          });
      });
  };

  proto.startVimTest = function (toggle) {
    const self = this;
    const i18nEditor = editorI18n();
    const content = createFragment();
    let input = null;
    const check = () => {
      const answer = input.value.toLowerCase();
      if (answer === "") {
        new host.Notice(i18nEditor.msgVimModePleaseEnterCommand());
      } else if (answer.startsWith(":q")) {
        self.passedVimTest = true;
        toggle.setValue(true);
        modal.close();
        new host.Notice(i18nEditor.msgVimModeEnabled());
      } else {
        new host.Notice(i18nEditor.msgVimModeNotEnabled());
      }
    };
    content.createEl("p", { cls: "mod-warning", text: i18nEditor.labelVimWarning() });
    content.createEl("p", { text: i18nEditor.labelVimTest() });
    content.createEl("p", { cls: "form-field" }, (field) => {
      field.createEl("label", { cls: "input-label", text: i18nEditor.labelVimYourAnswer() });
      input = field.createEl("input", { type: "text" });
      input.setAttribute("placeholder", i18nEditor.placeholderEnterCommand());
      input.addEventListener("keydown", (event) => {
        if (!event.isComposing && event.key === "Enter") check();
      });
    });
    const modal = new host.ButtonModal(this.app)
      .setTitle(i18nEditor.labelConfirmEnableVim())
      .setContent(content)
      .addButton("mod-cta", i18nEditor.buttonConfirmEnableVim(), () => {
        check();
        return true;
      })
      .addCancelButton();
    modal.open();
    input.focus();
  };

  return EditorTab;
}
