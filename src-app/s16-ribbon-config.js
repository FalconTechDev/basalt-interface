// s16 slice: the ribbon configuration modal — pick the mobile quick-ribbon item and
// reorder/hide the ribbon entries (phone layout only shows the quick item).
import { inherit } from "./inherit.js";

const t = (host) => host.i18n.setting.appearance;

/** ete: RibbonConfigModal. */
export function defineRibbonConfigModal(host) {
  const Base = host.Modal;
  function RibbonConfigModal(app) {
    const self = Base.call(this, app) || this;
    self.modalEl.addClass("mod-lg");
    self.setTitle(host.i18n.setting.appearance.labelModalConfiguration());
    return self;
  }
  inherit(RibbonConfigModal, Base);

  RibbonConfigModal.prototype.onOpen = function () {
    this.render();
  };

  RibbonConfigModal.prototype.render = function () {
    const self = this;
    const contentEl = this.contentEl;
    const ribbon = this.app.workspace.leftRibbon;
    contentEl.empty();

    if (host.Platform.isPhone) {
      const setting = new host.Setting(contentEl)
        .setName(host.i18n.setting.appearance.optionMobileQuickRibbonItem())
        .setDesc(host.i18n.setting.appearance.optionMobileQuickRibbonItemDesc());
      let iconEl = null;
      const current = this.app.vault.getConfig("mobileQuickRibbonItem");
      setting.addExtraButton((button) => {
        iconEl = button.extraSettingsEl;
        host.setIcon(iconEl, "lucide-menu");
      });
      setting.addDropdown((dropdown) => {
        dropdown.addOption("", host.i18n.setting.appearance.optionMobileQuickRibbonDefault());
        for (const item of ribbon.items) {
          dropdown.addOption(item.id, item.title);
          if (item.id === current) {
            dropdown.setValue(current);
            host.setIcon(iconEl, item.icon);
          }
        }
        dropdown.onChange((value) => {
          self.app.vault.setConfig("mobileQuickRibbonItem", value);
          self.render();
        });
      });
      contentEl.createEl("hr");
    }

    contentEl.createEl("p", { text: host.i18n.setting.appearance.labelModalConfigurationDesc() });

    const listEl = contentEl.createDiv("");
    const renderItem = (item) => {
      const row = listEl.createDiv("mobile-option-setting-item");
      if (item.hidden) {
        row.hide();
        return;
      }
      row.createSpan("mobile-option-setting-item-remove-icon", (icon) => {
        host.setIcon(icon, "lucide-minus-circle");
        icon.addEventListener("click", () => {
          item.hidden = true;
          ribbon.onChange(true);
          self.render();
        });
      });
      row.createSpan("mobile-option-setting-item-option-icon", (icon) => host.setIcon(icon, item.icon));
      row.createSpan({ cls: "mobile-option-setting-item-name", text: item.title });
      row.createDiv("clickable-icon mobile-option-setting-item-option-icon mobile-option-setting-drag-icon", (handle) => {
        host.setIcon(handle, "lucide-menu");
        host.setTooltip(handle, host.i18n.interface.dragToRearrange());
        host.makeDragReorderable(handle, row, listEl, 5, () => null, (to) => {
          ribbon.items.remove(item);
          ribbon.items.splice(to, 0, item);
          ribbon.onChange(true);
        });
      });
    };
    for (const item of ribbon.items) renderItem(item);

    const hidden = ribbon.items.filter((item) => item.hidden);
    if (hidden.length > 0) {
      const hiddenGroup = new host.SettingGroup(contentEl).setHeading(host.i18n.setting.appearance.labelAdditionalRibbonItems());
      const renderHidden = (item) => {
        hiddenGroup.listEl.createDiv("mobile-option-setting-item", (row) => {
          row.createSpan("mobile-option-setting-item-add-icon", (icon) => {
            host.setIcon(icon, "lucide-plus-circle");
            icon.addEventListener("click", () => {
              item.hidden = false;
              ribbon.onChange(true);
              self.render();
            });
          });
          row.createSpan("mobile-option-setting-item-option-icon", (icon) => host.setIcon(icon, item.icon));
          row.createSpan({ cls: "mobile-option-setting-item-name", text: item.title });
        });
      };
      for (const item of hidden) renderHidden(item);
    }

    contentEl.createDiv("modal-button-container", (buttons) => {
      buttons.createEl("button", { cls: "mod-cta", text: host.i18n.dialogue.buttonDone() }, (button) => {
        button.addEventListener("click", self.close.bind(self));
      });
    });
  };

  return RibbonConfigModal;
}
