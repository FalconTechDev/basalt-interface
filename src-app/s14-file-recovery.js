// File-recovery settings tab and footnote list item (s14).
//
//   F8  FileRecoverySettingsTab — interval/keep-days/history/clear settings (extends Y0)
//   H8  FootnoteListItem       — one footnote row with an embedded editable link (extends jm)
import { env } from "./env.js";

// F8 — file-recovery plugin settings.
export function s14FileRecoverySettingsTab() {
  const e = env();
  return class FileRecoverySettingsTab extends e.Y0 {
    constructor(app, plugin, instance) {
      super(app, plugin);
      this.icon = "history";
      this.instance = instance;
    }

    display() {
      const tab = this;
      const container = this.containerEl;
      container.empty();
      const group = new e.qk(container);
      if (e.Yl.supportsIndexedDb) {
        const options = this.instance.options;
        const fr = e.gm.plugins.fileRecovery;
        group
          .addSetting((setting) =>
            setting
              .setName(fr.optionInterval())
              .setDesc(fr.optionIntervalDescription())
              .addText((text) =>
                text.setValue(String(options.intervalMinutes)).onChange((value) => {
                  const minutes = parseFloat(value);
                  if (!isNaN(minutes) && minutes >= 0) {
                    options.intervalMinutes = minutes;
                    this.plugin.saveData(options);
                  }
                })
              )
          )
          .addSetting((setting) =>
            setting
              .setName(fr.optionKeep())
              .setDesc(fr.optionKeepDescription())
              .addText((text) =>
                text.setValue(String(options.keepDays)).onChange((value) => {
                  const days = parseFloat(value);
                  if (!isNaN(days) && days >= 1) {
                    options.keepDays = days;
                    this.plugin.saveData(options);
                  }
                })
              )
          )
          .addSetting((setting) =>
            setting
              .setName(fr.optionOpenHistory())
              .setDesc(fr.optionOpenHistoryDescription())
              .addButton((button) => button.setButtonText(fr.buttonViewHistory()).setCta().onClick(() => this.instance.openModal()))
          )
          .addSetting((setting) =>
            setting
              .setName(fr.optionClear())
              .setDesc(fr.optionClearDescription())
              .addButton((button) =>
                button
                  .setButtonText(fr.buttonClearHistory())
                  .setWarning()
                  .onClick(() => {
                    new e.nb(this.app)
                      .setTitle(fr.optionClear())
                      .setContent(
                        createFragment((frag) => {
                          frag.createEl("p", { cls: "mod-warning", text: fr.labelClearWarning() });
                        })
                      )
                      .addButton("mod-warning", fr.buttonClearHistory(), () => {
                        this.instance.clearData();
                        new e.fb(fr.msgClearComplete());
                      })
                      .addCancelButton()
                      .open();
                  })
              )
          );
      } else {
        group.addSetting((setting) =>
          setting.setName(e.gm.interface.msgIndexedDbNotSupported()).setDesc(e.gm.interface.msgIndexedDbIOS())
        );
      }
    }
  };
}

// H8 — one row of the footnotes pane: id badge + embedded editable footnote link.
export function s14FootnoteListItem() {
  const e = env();
  return class FootnoteListItem extends e.jm {
    constructor(app, file, footnoteId, index, positions = []) {
      super();
      this.app = app;
      this.file = file;
      this.footnoteId = footnoteId;
      this.footRefPositions = positions;
      const row = (this.containerEl = createDiv("footnote-list-item")).createDiv("footnote");
      this.idEl = row.createDiv({ cls: "footnote-id", text: String(index + 1) }, (el) => {
        el.toggleClass("mod-no-occurrences", !positions.length);
      });
      this.contentEl = row.createDiv("footnote-content");
    }

    onload() {
      this.renderEmbed();
    }

    onunload() {
      this.containerEl.detach();
    }

    async renderEmbed() {
      const app = this.app;
      const file = this.file;
      const contentEl = this.contentEl;
      const rowEl = this.containerEl;
      const footnoteId = this.footnoteId;
      const linktext = "#[^".concat(footnoteId, "]");
      const holder = contentEl.createDiv();
      const embed = (this.embed = this.addChild(
        new e.lJ({ app, linktext, sourcePath: file.path, containerEl: holder, depth: 0 }, file, linktext)
      ));
      embed.editable = true;
      rowEl.addEventListener("click", (ev) => {
        if (embed.editorEl.isShown()) return;
        const setEditing = (editing) => rowEl.toggleClass("is-editing", editing);
        setEditing(true);
        embed.showEditor(e.Fl(ev));
        embed.editMode.register(() => setEditing(false));
        embed.editMode.registerDomEvent(rowEl.win, "click", (click) => {
          if (!rowEl.contains(click.targetNode)) {
            setEditing(false);
            embed.showPreview();
          }
        });
      });
      await embed.loadFile();
    }

    update(index, positions = []) {
      const idEl = this.idEl;
      this.footRefPositions = positions;
      idEl.toggleClass("mod-no-occurrences", !positions.length);
      const text = String(index + 1);
      if (idEl.textContent !== text) {
        idEl.empty();
        idEl.setText(text);
      }
    }

    onResize() {
      this.embed?.previewMode?.renderer.onResize();
    }
  };
}
