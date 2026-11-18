// s16 slice: the settings modal — a phone-style vertical tab strip on the left and the
// active tab's content on the right, with swipe-to-go-back on phones.
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { runTransition } from "./animation.js";

/** vte: SettingsModal. */
export function defineSettingsModal(host) {
  const Base = host.Modal;
  function SettingsModal(app) {
    const self = Base.call(this, app) || this;
    self.settingTabs = [];
    self.pluginTabs = [];
    self.activeTab = null;
    self.activeTabCloseable = null;
    self.feedbackBanner = null;
    self.lastTabId = "";
    self.modalEl.addClass("mod-settings", "mod-sidebar-layout");
    self.updateModalTitle();
    self.contentEl.addClass("vertical-tabs-container");
    self.tabHeadersEl = self.contentEl.createDiv("vertical-tab-header", (headerEl) => {
      if (host.Platform.isPhone) self.feedbackBanner = new host.s16FeedbackBanner(self.app, headerEl);
      headerEl.createDiv("vertical-tab-header-group", (group) => {
        group.createDiv({ cls: "vertical-tab-header-group-title", text: host.i18n.setting.options() });
        self.tabContainer = group.createDiv("vertical-tab-header-group-items");
        self.tabContainer.setAttr("data-section", "options");
      });
      headerEl.createDiv("vertical-tab-header-group", (group) => {
        self.corePluginTabHeaderGroup = group.createDiv({ cls: "vertical-tab-header-group-title", text: host.i18n.setting.builtinPlugins() });
        self.corePluginTabHeaderGroup.hide();
        self.corePluginTabContainer = group.createDiv("vertical-tab-header-group-items");
        self.corePluginTabContainer.setAttr("data-section", "core-plugins");
      });
      headerEl.createDiv("vertical-tab-header-group", (group) => {
        self.communityPluginTabHeaderGroup = group.createDiv({ cls: "vertical-tab-header-group-title", text: host.i18n.setting.thirdPartyPlugin.name() });
        self.communityPluginTabHeaderGroup.hide();
        self.communityPluginTabContainer = group.createDiv("vertical-tab-header-group-items");
        self.communityPluginTabContainer.setAttr("data-section", "community-plugins");
      });
    });
    self.tabContentContainer = env().createDiv("vertical-tab-content-container");

    self.addSettingTab(new host.s16TabAbout(app, self));
    self.addSettingTab(new host.s16TabEditor(app, self));
    if (host.Platform.isMobile) self.addSettingTab(new host.s16MobileTab(app, self));
    self.addSettingTab(new host.s16TabFiles(app, self));
    self.addSettingTab(new host.s16TabAppearance(app, self));
    self.addSettingTab(new host.s16TabHotkeys(app, self));
    self.addSettingTab(new host.KeychainTab(app, self));
    self.addSettingTab(new host.s16TabPlugins(app, self));
    self.addSettingTab(new host.s16TabCommunity(app, self));

    if (host.Platform.isMobile) {
      host.onSwipe(self.contentEl, (swipe) => {
        if (swipe.points !== 1 || swipe.direction !== "x" || !self.activeTab) return;
        if (swipe.touch.clientX > 40) return;
        const tabEl = self.activeTab.containerEl;
        self.contentEl.prepend(self.tabHeadersEl);
        host.restoreScrollPositions(self.tabHeadersEl);
        swipe.registerCallback({
          move: (x) => {
            const width = tabEl.offsetWidth;
            const ratio = Math.clamp((x - swipe.startX) / width, 0, 1);
            tabEl.style.transform = `translateX(${ratio * width}px)`;
          },
          cancel: () => {
            tabEl.style.transform = "";
            self.tabHeadersEl.detach();
          },
          finish: (x, y, velocity) => {
            const width = tabEl.offsetWidth;
            const ratio = Math.clamp((x - swipe.startX) / width, 0, 1);
            if (0.5 * velocity < width / 2) {
              runTransition(tabEl, new host.Transition({ duration: 150 * ratio }).addProp("transform", null, "translateX(0)", ""), () => {
                self.tabHeadersEl.detach();
              });
            } else {
              runTransition(tabEl, new host.Transition({ duration: 100 * (1 - ratio), fn: "ease-out" }).addProp("transform", null, `translateX(${width}px)`, ""), () => {
                tabEl.detach();
                self.closeActiveTab();
              });
            }
          },
        });
      });
    }
    return self;
  }
  inherit(SettingsModal, Base);
  const proto = SettingsModal.prototype;

  proto.updateModalTitle = function (tab) {
    this.titleEl.empty();
    if (tab) this.titleEl.setText(tab.name);
    else this.titleEl.setText(host.i18n.interface.settings());
  };

  proto.addSettingTab = function (tab) {
    const self = this;
    if (!tab.navEl) {
      tab.navEl = env().createDiv("vertical-tab-nav-item tappable", (navEl) => {
        navEl.setAttr("data-setting-id", tab.id);
        if (tab.icon) navEl.createDiv("vertical-tab-nav-item-icon", (icon) => host.setIcon(icon, tab.icon));
        navEl.createDiv({ cls: "vertical-tab-nav-item-title", text: tab.name });
        navEl.createDiv("vertical-tab-nav-item-chevron", (chevron) => host.setIcon(chevron, "lucide-chevron-right"));
        navEl.addEventListener("click", () => self.openTab(tab));
      });
    }
    if (this.isPluginSettingTab(tab)) this.pluginTabs.push(tab);
    else {
      this.settingTabs.push(tab);
      this.tabContainer.appendChild(tab.navEl);
    }
    this.updatePluginSection();
  };

  proto.removeSettingTab = function (tab) {
    this.pluginTabs.remove(tab);
    this.settingTabs.remove(tab);
    const active = this.activeTab;
    if (active && active === tab) this.closeActiveTab();
    this.updatePluginSection();
  };

  proto.isPluginSettingTab = function (tab) {
    return tab instanceof host.PluginInstanceSettingTab || tab instanceof host.PluginSettingTab;
  };

  proto.updatePluginSection = function () {
    const core = this.pluginTabs.filter((tab) => tab instanceof host.PluginInstanceSettingTab);
    const community = this.pluginTabs.filter((tab) => tab instanceof host.PluginSettingTab);
    core.sort((a, b) => host.compareStrings(a.name, b.name));
    this.corePluginTabHeaderGroup.toggle(core.length > 0);
    this.corePluginTabContainer.setChildrenInPlace(core.map((tab) => tab.navEl));
    community.sort((a, b) => host.compareStrings(a.name, b.name));
    this.communityPluginTabHeaderGroup.toggle(community.length > 0);
    this.communityPluginTabContainer.setChildrenInPlace(community.map((tab) => tab.navEl));
  };

  proto.openTab = function (tab) {
    const self = this;
    const activeTab = this.activeTab;
    const contentEl = this.contentEl;
    const tabContentContainer = this.tabContentContainer;
    const tabHeadersEl = this.tabHeadersEl;
    tabContentContainer.empty();
    host.unregisterOpenModal(this.activeTabCloseable);
    this.updateModalTitle(tab);
    if (activeTab) {
      activeTab.navEl.removeClass("is-active");
      activeTab.hide();
    }
    this.activeTab = tab;
    this.lastTabId = tab.id;
    tab.navEl.addClass("is-active");
    this.activeTabCloseable = { close: this.closeActiveTab.bind(this) };
    host.registerOpenModal(this.activeTabCloseable);
    tabContentContainer.appendChild(tab.containerEl);
    this.titleEl.createDiv({ cls: "clickable-icon modal-setting-back-button mod-raised", prepend: true }, (back) => {
      back.addEventListener("click", () => self.closeActiveTab());
      host.setIcon(back, "lucide-arrow-left");
    });
    if (host.Platform.isPhone && !activeTab) {
      host.saveScrollPositions(tabHeadersEl);
      host.s16SlidePanes(contentEl, tabContentContainer, "right");
    } else {
      contentEl.appendChild(tabContentContainer);
    }
    tab.display();
  };

  proto.closeActiveTab = function () {
    const self = this;
    const tab = this.activeTab;
    const contentEl = this.contentEl;
    const tabContentContainer = this.tabContentContainer;
    const tabHeadersEl = this.tabHeadersEl;
    if (!tab) return;
    const finish = () => {
      tabContentContainer.empty();
      tab.navEl.removeClass("is-active");
      tab.hide();
      self.updateModalTitle();
      host.unregisterOpenModal(self.activeTabCloseable);
      self.activeTabCloseable = null;
    };
    if (host.Platform.isPhone && contentEl.isShown() && tab.containerEl.isShown()) {
      host.s16SlidePanes(contentEl, tabHeadersEl, "left", finish);
    } else {
      contentEl.setChildrenInPlace([tabHeadersEl]);
      finish();
    }
    host.restoreScrollPositions(tabHeadersEl);
    this.activeTab = null;
  };

  proto.openTabById = function (id) {
    for (const tab of this.settingTabs) {
      if (tab.id === id) {
        this.openTab(tab);
        return tab;
      }
    }
    for (const tab of this.pluginTabs) {
      if (tab.id === id) {
        this.openTab(tab);
        return tab;
      }
    }
    return null;
  };

  proto.onOpen = function () {
    Base.prototype.onOpen.call(this);
    if (!host.Platform.isPhone) this.openTabById(this.lastTabId) || this.openTab(this.settingTabs[0]);
    if (host.Platform.isPhone && this.feedbackBanner) this.feedbackBanner.show();
  };

  proto.onClose = function () {
    Base.prototype.onClose.call(this);
    this.closeActiveTab();
  };

  proto.animateOpen = async function () {
    return;
  };

  proto.animateClose = async function () {
    return;
  };

  return SettingsModal;
}
