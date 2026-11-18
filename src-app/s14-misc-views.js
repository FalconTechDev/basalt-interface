// Note-composer settings tab and outline heading tree item (s14).
//
//   t7  NoteComposerSettingsTab — plugin settings: split replacement, template file, merge confirm
//   h7  OutlineHeadingItem       — collapsible heading row inside the outline tree
import { env } from "./env.js";

// t7 — extends PluginInstanceSettingTab (Y0).
export function s14NoteComposerSettingsTab() {
  const e = env();
  return class NoteComposerSettingsTab extends e.Y0 {
    constructor(app, plugin, instance) {
      super(app, plugin);
      this.icon = "merge";
      this.instance = instance;
    }

    display() {
      const tab = this;
      const container = this.containerEl;
      container.empty();
      const options = this.instance.options;
      const nc = e.gm.plugins.noteComposer;
      new e.qk(container)
        .addSetting((setting) =>
          setting
            .setName(nc.optionSplitReplacementText())
            .setDesc(nc.optionSplitReplacementTextDescription())
            .addDropdown((dropdown) =>
              dropdown
                .addOption("link", nc.optionChoiceSplitReplacementTextLink())
                .addOption("embed", nc.optionChoiceSplitReplacementTextEmbed())
                .addOption("none", nc.optionChoiceSplitReplacementTextNone())
                .setValue(options.replacementText || "link")
                .onChange((value) => {
                  options.replacementText = value;
                  this.plugin.saveData(options);
                })
            )
        )
        .addSetting((setting) =>
          setting
            .setName(nc.optionTemplateFile())
            .setDesc(nc.optionTemplateFileDescription(e.nm))
            .addText((text) => {
              text.setPlaceholder(e.gm.setting.filePathExamplePlaceholder()).setValue(options.template).onChange((value) => {
                options.template = value.trim();
                this.plugin.saveData(options);
              });
              new e.TI(this.app, text.inputEl);
            })
        )
        .addSetting((setting) =>
          setting
            .setName(nc.optionConfirmFileMerge())
            .setDesc(nc.optionConfirmFileMergeDescription())
            .addToggle((toggle) =>
              toggle.setValue(options.askBeforeMerging).onChange((value) => {
                options.askBeforeMerging = value;
                this.plugin.saveData(options);
              })
            )
        );
    }
  };
}

// h7 — outline heading row (was `h7=function(e){...}(XL)`).
export function s14OutlineHeadingItem() {
  const e = env();
  return class OutlineHeadingItem extends e.XL {
    constructor(view, tree, heading) {
      super();
      this.pusherEl = e.JH();
      this.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
      this.vChildren = new e.UH(this);
      this.view = view;
      this.tree = tree;
      this.heading = heading;
      this.setClickable(true);
      this.setCollapsible(false);
      this.headingText = e.OT(this.heading);
      this.innerEl.setText(this.headingText);
    }

    onSelfClick() {
      const view = this.view;
      const leaf = view.findCorrespondingLeaf();
      const state = { line: this.heading.position.start.line };
      let target;
      if (leaf) {
        view.leaf.workspace.setActiveLeaf(leaf, { focus: true });
        leaf.view.setEphemeralState(state);
        target = leaf;
      } else {
        const app = view.app;
        const file = view.file;
        target = app.workspace.getLeaf();
        target.openFile(file, { eState: state });
      }
      return target;
    }

    async updateCollapsed(collapsed) {
      if (!this.collapsed) this.tree.handleCollapseAll?.(false);
      await super.updateCollapsed(collapsed);
      this.tree.infinityScroll.invalidate(this);
    }
  };
}
