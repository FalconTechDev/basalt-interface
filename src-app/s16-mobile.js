// s16 slice: mobile toolbar settings — the quick-action (pull-down) command picker and
// the settings tab that configures the mobile toolbar button list.
import { inherit } from "./inherit.js";

/** dte: picker for the command bound to the mobile pull-down gesture. */
export function defineQuickActionSuggest(host) {
  const Base = host.FuzzySuggestModal;
  function QuickActionSuggest(app, callback) {
    const self = Base.call(this, app) || this;
    self.emptyStateText = host.i18n.plugins.commandPalette.labelNoCommands();
    self.callback = callback;
    self.setPlaceholder(host.i18n.setting.mobileToolbar.placeholderSelectQuickAction());
    return self;
  }
  inherit(QuickActionSuggest, Base);
  const proto = QuickActionSuggest.prototype;

  proto.getItems = function () {
    return [null].concat(Object.values(this.app.commands.commands));
  };

  proto.getItemText = function (item) {
    return item ? item.name : host.i18n.setting.mobileToolbar.quickActionDisabled();
  };

  proto.onChooseItem = function (item) {
    this.app.vault.setConfig("mobilePullAction", item ? item.id : "");
    if (this.callback) this.callback();
  };

  return QuickActionSuggest;
}

/** fte: the "Mobile toolbar" settings tab (also registers the quick-action config command). */
export function defineMobileToolbarTab(host) {
  const Base = host.SettingTab;
  const t = () => host.i18n.setting.mobileToolbar;

  function MobileToolbarTab(app, plugin) {
    const self = Base.call(this, app, plugin) || this;
    self.name = t().name();
    self.id = "mobile";
    self.icon = "wrench";
    app.commands.addCommand({
      id: "mobile:quick-action",
      name: t().optionConfigureQuickAction(),
      icon: "lucide-terminal-square",
      checkCallback: (checking) => {
        if (!host.Platform.isMobile) return false;
        if (!checking) new host.s16QuickActionModal(app).open();
        return true;
      },
    });
    return self;
  }
  inherit(MobileToolbarTab, Base);

  MobileToolbarTab.prototype.display = function () {
    const self = this;
    const app = this.app;
    const containerEl = this.containerEl;
    containerEl.empty();
    const pullAction = app.vault.getConfig("mobilePullAction");
    const pullCommand = app.commands.findCommand(pullAction);

    new host.SettingGroup(containerEl).addSetting((setting) => setting
      .setName(t().optionConfigureQuickAction())
      .setDesc(t().optionConfigureQuickActionDescription({ command: pullCommand ? pullCommand.name : t().quickActionDisabled() }))
      .addButton((button) => button
        .setButtonText(t().buttonConfigure())
        .onClick(() => new host.s16QuickActionModal(app, () => self.display()).open())));

    const allCommands = app.commands.commands;
    const editorCommands = app.commands.editorCommands;
    let toolbarCommands = app.vault.getConfig("mobileToolbarCommands");
    const addable = Object.keys(editorCommands).filter((id) => !toolbarCommands.contains(id));
    const persist = () => {
      app.vault.setConfig("mobileToolbarCommands", toolbarCommands);
      self.display();
    };

    const enabledGroup = new host.SettingGroup(containerEl);
    if (toolbarCommands) {
      enabledGroup.setHeading(t().manageToolbarOptions());
      const listEl = enabledGroup.listEl.createDiv();
      toolbarCommands = toolbarCommands.filter((id) => allCommands[id]);
      const renderEnabled = (id) => {
        const command = allCommands[id];
        listEl.createDiv("mobile-option-setting-item", (row) => {
          row.createSpan("mobile-option-setting-item-remove-icon", (icon) => {
            host.setIcon(icon, "lucide-minus-circle");
            icon.addEventListener("click", () => {
              if (toolbarCommands.contains(id)) {
                toolbarCommands.remove(id);
                persist();
              }
            });
          });
          row.createSpan("mobile-option-setting-item-option-icon", (icon) => host.setIcon(icon, command.icon || "question-mark-glyph"));
          row.createSpan({ cls: "mobile-option-setting-item-name", text: command.name });
          row.createDiv("clickable-icon mobile-option-setting-item-option-icon mobile-option-setting-drag-icon", (handle) => {
            host.setIcon(handle, "lucide-menu");
            host.setTooltip(handle, host.i18n.interface.dragToRearrange());
            host.makeDragReorderable(handle, row, listEl, 5, () => null, (to) => {
              toolbarCommands.remove(id);
              toolbarCommands.splice(to, 0, id);
              persist();
            });
          });
        });
      };
      for (const id of toolbarCommands) renderEnabled(id);
    }

    if (addable.length > 0) {
      const moreGroup = new host.SettingGroup(containerEl);
      moreGroup.setHeading(t().optionMoreToolbarOptions());
      const renderAddable = (id) => {
        const command = allCommands[id];
        moreGroup.listEl.createDiv("mobile-option-setting-item", (row) => {
          row.createSpan("mobile-option-setting-item-add-icon", (icon) => {
            host.setIcon(icon, "lucide-plus-circle");
            icon.addEventListener("click", () => {
              if (!toolbarCommands.contains(id)) {
                toolbarCommands.push(id);
                persist();
              }
            });
          });
          row.createSpan("mobile-option-setting-item-option-icon", (icon) => host.setIcon(icon, command.icon || "question-mark-glyph"));
          row.createSpan({ text: command.name });
        });
      };
      for (const id of addable) renderAddable(id);
    }

    const searchable = Object.keys(allCommands)
      .filter((id) => !editorCommands[id] && !toolbarCommands.contains(id))
      .map((id) => allCommands[id]);
    enabledGroup.addSearch((search) => search
      .setPlaceholder(host.i18n.plugins.commandPalette.promptTypeCommand())
      .then(() => new host.s16CommandSuggest(app, search.inputEl, searchable, (command) => {
        const id = command.id;
        if (!toolbarCommands.contains(id)) {
          toolbarCommands.push(id);
          persist();
        }
      })));
  };

  return MobileToolbarTab;
}
