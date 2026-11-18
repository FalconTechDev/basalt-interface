// The "Page preview" core plugin: shows the hover preview (HoverPopover) when the pointer rests on a
// link, unless the "require modifier" setting for that hover source is on. A settings tab exposes one
// toggle per registered hover-link source.
//
// Replaces the inherited pieces:
//   f7  PagePreviewPlugin      -> definePagePreviewPlugin
//   m7  PagePreviewSettingTab  -> definePagePreviewSettingTab (base: instance setting tab)

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { ng12PublishHoverMove } from "./n-g12-s09-core.js";
import { s04ModifierDisplayNames } from "./s04-menu.js";

const PLUGIN_ID = "page-preview";
const pagePreviewT = (host) => host.t.plugins.pagePreview;

// The plugin and its settings tab are declared at different bundle positions; they reach each
// other through this registry.
const pagePreviewParts = {};

/** The settings tab: one "require modifier" toggle per workspace hover-link source. */
export function definePagePreviewSettingTab(host) {
  function PagePreviewSettingTab(app, plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, app, plugin) || this;
    self.icon = "scan-eye";
    self.instance = instance;
    return self;
  }
  inherit(PagePreviewSettingTab, host.PluginInstanceSettingTab);
  const proto = PagePreviewSettingTab.prototype;

  proto.display = function () {
    const self = this;
    const containerEl = this.containerEl;
    containerEl.empty();
    const group = new host.SettingGroup(containerEl).setHeading(
      pagePreviewT(host).labelRequireMod({ key: s04ModifierDisplayNames(host.isMacLike).Mod })
    );
    const overrides = this.instance.overrides;
    const sources = this.app.workspace.hoverLinkSources;
    const addToggle = (id) => {
      const source = sources[id];
      let value = overrides[id];
      if (!Object.hasOwn(overrides, id)) value = source.defaultMod;
      group.addSetting((setting) =>
        setting
          .setName(source.display)
          .addToggle((toggle) =>
            toggle.setValue(value).onChange((checked) => {
              if (checked === source.defaultMod) delete overrides[id];
              else overrides[id] = checked;
              self.plugin.saveData(overrides);
            })
          )
      );
    };
    for (const id in sources) addToggle(id);
  };

  pagePreviewParts.PagePreviewSettingTab = PagePreviewSettingTab;
  return PagePreviewSettingTab;
}

/** The plugin: hover-link listener that decides when to open the page preview. */
export function definePagePreviewPlugin(host) {
  class PagePreviewPlugin {
    constructor() {
      this.id = PLUGIN_ID;
      this.name = pagePreviewT(host).name();
      this.description = pagePreviewT(host).desc();
      this.defaultOn = true;
      this.overrides = {};
    }

    init(app) {
      this.app = app;
    }

    async onEnable(app, plugin) {
      plugin.registerEvent(app.workspace.on("hover-link", this.onHoverLink, this));
      this.overrides = Object.assign({}, await plugin.loadData());
      plugin.addSettingTab(new pagePreviewParts.PagePreviewSettingTab(app, plugin, this));
      const unfolded = this.app.loadLocalStorage("page-preview-unfold-properties");
      host.EmbedFileView.collapseProperties = !unfolded;
    }

    onHoverLink(payload) {
      const self = this;
      const event = payload.event;
      const source = payload.source;
      const hoverParent = payload.hoverParent;
      const targetEl = payload.targetEl;
      const linktext = payload.linktext;
      const sourcePath = payload.sourcePath === undefined ? "" : payload.sourcePath;
      const state = payload.state;
      if (host.isTouchSyntheticMouse(event)) return;
      const related = event.relatedTarget;
      if (related && related.instanceOf(HTMLElement) && !related.isShown()) return;
      let requireMod = true;
      if (Object.hasOwn(this.overrides, source)) requireMod = this.overrides[source];
      else if (this.app.workspace.hoverLinkSources.hasOwnProperty(source)) {
        requireMod = this.app.workspace.hoverLinkSources[source].defaultMod;
      }
      ng12PublishHoverMove(event);
      if (requireMod && !host.Keymap.isModifier(event, "Mod")) {
        if (!targetEl) return;
        const doc = event.doc;
        let done = false;
        const cleanup = () => {
          done = true;
          dismiss.cancel();
          doc.removeEventListener("keydown", onKeydown);
          doc.removeEventListener("mouseover", onMouseover);
          doc.removeEventListener("mouseleave", onMouseleave);
          doc.removeEventListener("mousemove", dismiss);
          doc.removeEventListener("click", cleanup);
        };
        const onKeydown = (keyEvent) => {
          if (done) return;
          if (!targetEl || doc.body.contains(targetEl)) {
            if (keyEvent.key.startsWith("Arrow") || keyEvent.key.length === 1) cleanup();
            else if (host.Keymap.isModifier(keyEvent, "Mod")) {
              cleanup();
              self.onLinkHover(hoverParent, targetEl, linktext, sourcePath, state);
            }
          } else {
            cleanup();
          }
        };
        const dismiss = debounceCall(() => cleanup(), 2000, true);
        const onMouseover = (mouseEvent) => {
          if (done) return;
          if (targetEl === mouseEvent.target || targetEl.contains(mouseEvent.target)) return;
          cleanup();
        };
        const onMouseleave = (mouseEvent) => {
          if (done) return;
          if (mouseEvent.target === doc) cleanup();
        };
        doc.addEventListener("keydown", onKeydown);
        doc.addEventListener("mouseleave", onMouseleave);
        doc.addEventListener("mouseover", onMouseover);
        doc.addEventListener("mousemove", dismiss);
        doc.addEventListener("click", cleanup);
        return;
      }
      this.onLinkHover(hoverParent, targetEl, linktext, sourcePath, state);
    }

    async onLinkHover(hoverParent, targetEl, linktext, sourcePath, state) {
      const self = this;
      const existing = hoverParent.hoverPopover;
      if (existing && existing.state !== host.PopoverState.Hidden && targetEl && existing.targetEl === targetEl) return;
      const popover = await host.HoverPopover.create({
        app: this.app,
        hoverParent,
        targetEl,
        linktext,
        sourcePath,
        state,
      });
      if (popover) {
        popover.register(() => {
          self.app.saveLocalStorage("page-preview-unfold-properties", !host.EmbedFileView.collapseProperties);
        });
      }
    }
  }
  return PagePreviewPlugin;
}
