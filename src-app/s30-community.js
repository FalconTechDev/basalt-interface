// Slice s30 — community-plugin trust prompt and small app declarators.
//
// Faithful port of the trust-author folder modal shown before enabling
// community plugins, the deprecation-manifest url/data holders, the plugin
// sort-label map, and the drag/drop indicator element plus its positioning
// updater used by the file tree.

import { inherit } from "./inherit.js";
import { env } from "./env.js";

const s30Ce = () => env();

// J0 — i18n table for the trust prompt (gm.setting.thirdPartyPlugin).
export function s30ThirdPartyPluginI18n() {
  return s30Ce().gm.setting.thirdPartyPlugin;
}

// e2 — url of the community-plugin deprecation manifest on the release host.
export function s30DeprecationManifestUrl(ty) {
  return ty("obsidianmd/obsidian-releases", "community-plugin-deprecation.json");
}

// t2 — deprecation manifest payload; replaced by the fetched JSON at runtime.
export const s30DeprecationManifestData = {};

// n2 — labels for the community-plugin sort dropdown.
export function s30PluginSortLabels() {
  const t = s30Ce().gm.setting.thirdPartyPlugin;
  return {
    download: t.labelByPopularity,
    release: t.labelByReleased,
    alphabetical: t.labelAlphabetical,
    update: t.labelByUpdated,
  };
}

// u2 — the single drop-indicator element reused by tree drag operations.
export function s30DropIndicatorEl() {
  return s30Ce().createDiv("drop-indicator is-active");
}

// h2 — debounced position updater for the drop indicator.
export function s30PositionDropIndicator(el, debounce) {
  return debounce(function (e) {
    const x = e.x, y = e.y, placement = e.placement;
    el.style.left = x + "px";
    el.style.top = y + ("after" === placement ? 1 : -1) - 2 + "px";
  }, 0);
}

// Z0 — "trust author" modal gating community plugins for untrusted folders.
let s30Community = null;
let s30CommunityHost = null;

function s30CommunityClasses(host) {
  if (host) s30CommunityHost = host;
  if (s30Community) return s30Community;
  const H = s30CommunityHost || {};

  function TrustFolderModal(app) {
    const self = H.DialogModal.call(this, app) || this;
    const J = s30ThirdPartyPluginI18n();
    self.modalEl.addClass("mod-lg", "mod-trust-folder");
    self.setTitle(J.labelTrustAuthor());
    self.contentEl.createEl("p", { text: J.labelTrustAuthorDescription_1() });
    self.contentEl.createEl("p", { text: J.labelTrustAuthorDescription_2() });
    self.contentEl.createEl("p", { text: J.labelTrustAuthorDescription_3() });
    self.buttonContainerEl.createEl("button", {
      text: J.buttonEnablePlugins(),
      onclick: async function () {
        self.close();
        await self.app.plugins.setEnable(true);
        self.app.setting.open();
        self.app.setting.openTabById("community-plugins");
      },
    });
    self.buttonContainerEl.createEl("button", {
      text: J.buttonDontTrustAuthor(),
      onclick: async function () {
        self.close();
        await self.app.plugins.setEnable(false);
        self.app.setting.open();
        self.app.setting.openTabById("community-plugins");
      },
    });
    return self;
  }
  inherit(TrustFolderModal, H.DialogModal);

  s30Community = { Z0: TrustFolderModal };
  return s30Community;
}

export function defineTrustFolderModal(host) {
  return s30CommunityClasses(host).Z0;
}
