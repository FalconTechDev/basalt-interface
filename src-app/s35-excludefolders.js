// Base class for the "manage excluded folders" style modal: a suggest input
// plus the current list with per-row remove buttons (was `V7`). Subclasses
// supply getPaths/setPaths; the sync settings tab supplies the concrete one.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { normalizePath } from "./path.js";


// Folder-suggestion modal base (was `V7`).
export function s35FolderSuggestBase(host) {
  const Base = host.DialogModal;
  const i18n = host.i18n;

  function FolderSuggestBase(app, name, desc, labelI18nKey) {
    const self = Base.call(this, app) || this;
    self.settingTab = null;
    self.displayEl = null;
    self.labelI18nKey = labelI18nKey;
    const contentEl = self.contentEl;
    self.displayEl = contentEl.createEl("p");
    new host.Setting(contentEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        const inputEl = text.inputEl;
        const suggest = new (env().PI)(
          app,
          inputEl,
          (item) => !self.getPaths().contains(item.path),
          true,
        );
        const select = async () => {
          const value = normalizePath(inputEl.value);
          if (!value) return;
          inputEl.value = "";
          const paths = self.getPaths();
          paths.push(value);
          await self.setPaths(paths);
          self.updateDisplay();
        };
        suggest.onSelect(select);
        inputEl.addEventListener("keydown", (event) => {
          if (event.isComposing || event.key !== "Enter") return;
          select();
        });
      });
    self.addButton("", i18n.dialogue.buttonDone(), self.close.bind(self));
    return self;
  }
  inherit(FolderSuggestBase, Base);
  const proto = FolderSuggestBase.prototype;

  proto.onOpen = function () {
    Base.prototype.onOpen.call(this);
    this.updateDisplay();
  };

  proto.onClose = function () {
    this.settingTab.display();
  };

  proto.updateDisplay = function () {
    const self = this;
    const paths = this.getPaths();
    const el = this.displayEl;
    el.empty();
    const folders = i18n.nouns.folderWithCount({ count: paths.length });
    el.setText(i18n(this.labelI18nKey, { folders }));
    for (const path of paths) {
      const row = el.createDiv("sync-exclude-folder");
      const remove = row.createDiv("sync-exclude-folder-remove clickable-icon");
      host.setIcon(remove, "lucide-x");
      host.setTooltip(remove, i18n.plugins.sync.tooltipRemoveExcludedFolder());
      remove.addEventListener("click", async () => {
        const next = self.getPaths().remove(path);
        await self.setPaths(next);
        self.updateDisplay();
      });
      row.createSpan("clickable-icon", (span) => {
        host.setIcon(span, "lucide-folder-open");
      });
      row.createDiv({ cls: "sync-exclude-folder-name" }, (nameEl) => {
        nameEl.createSpan({ text: path });
      });
    }
  };

  return FolderSuggestBase;
}
