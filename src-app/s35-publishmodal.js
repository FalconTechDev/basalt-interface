// The publish plugin's "review changes" dialog: the modal that hosts the
// site-management sections (offline, no account, manage sites, site options,
// filters, review changes, upload progress, slug editor, passwords, custom
// domain). Faithful port of the inherited class; the section classes and the
// publish API helpers are earlier own modules reached lazily through env().

import { inherit } from "./inherit.js";
import { env } from "./env.js";


// Publish changes modal (was `z7`).
export function s35PublishChangesModal(host) {
  const Base = host.Modal;
  const i18n = () => host.i18n.plugins.publish;

  function PublishChangesModal(app, plugin) {
    const self = Base.call(this, app) || this;
    self.offlineSection = null;
    self.noAccountSection = null;
    self.manageSitesSection = null;
    self.siteOptionsSection = null;
    self.siteFiltersSection = null;
    self.reviewChangesSection = null;
    self.uploadProgressSection = null;
    self.editSiteSlugSection = null;
    self.listPasswordSection = null;
    self.addPasswordSection = null;
    self.configureCustomDomainSection = null;
    self.errorMessageEl = null;
    self.loaderEl = null;
    self.currentSection = null;
    self.autoLoadSection = null;
    self.plugin = plugin;
    self.modalEl.addClass("mod-publish", "mod-lg", "mod-scrollable-content");
    self.setTitleText(i18n().actionPublishChanges());
    self.contentEl.createDiv("message-container", (container) => {
      self.errorMessageEl = container.createDiv("message mod-error");
      self.errorMessageEl.hide();
    });
    self.offlineSection = new (env().U7)(self);
    self.loaderEl = env().dD(self.contentEl);
    self.loaderEl.hide();
    self.noAccountSection = new (env().W7)(self);
    self.manageSitesSection = new (env()._7)(self);
    self.siteOptionsSection = new (env().G7)(self);
    self.siteFiltersSection = new (env().K7)(self);
    self.reviewChangesSection = new (env().J7)(self);
    self.uploadProgressSection = new (env().e9)(self);
    self.editSiteSlugSection = new (env().t9)(self);
    self.listPasswordSection = new (env().n9)(self);
    self.addPasswordSection = new (env().i9)(self);
    self.configureCustomDomainSection = new (env().r9)(self);
    return self;
  }
  inherit(PublishChangesModal, Base);
  const proto = PublishChangesModal.prototype;

  proto.handleError = function (error) {
    console.error(error);
    this.loaderEl.hide();
    if (error instanceof env().p9) {
      if (error.code === "AUTHFAIL") {
        this.openSection(this.manageSitesSection);
        this.showError(i18n().msgNoPermissionToPublishToSite());
      } else if (error.code === "NET") {
        this.showError(i18n().msgNetworkError() + error.message);
      } else {
        this.showError(error.message);
      }
    } else {
      this.showError(i18n().msgSomethingWentWrong() + " " + (error.message || error.toString()));
    }
  };

  proto.showError = function (message) {
    this.errorMessageEl.setText(message);
    this.errorMessageEl.show();
  };

  proto.hideError = function () {
    this.errorMessageEl.hide();
  };

  proto.onOpen = async function () {
    this.closeSection();
    this.loaderEl.show();
    const account = env().Hw;
    if (!account.token) {
      try {
        await env().Sw(account);
      } catch (error) {
        if (error.message === "Not logged in") return this.openSection(this.noAccountSection);
        return this.openSection(this.offlineSection);
      }
    }
    if (this.plugin.siteId) {
      if (this.autoLoadSection) {
        const section = this.autoLoadSection;
        this.autoLoadSection = null;
        return this.openSection(section);
      }
      return this.openReviewChanges();
    }
    return this.openSection(this.manageSitesSection);
  };

  proto.autoLoad = function (section) {
    this.autoLoadSection = section;
  };

  proto.onClose = function () {};

  proto.deleteSite = async function (siteId) {
    await env().Nw(env().Hw.token, siteId);
    if (this.plugin.siteId === siteId) await this.plugin.setup(null, null);
    await this.openSection(this.manageSitesSection);
  };

  proto.deleteSiteShare = async function (siteId, shareId) {
    await env().Bw(env().Hw.token, siteId, shareId);
    if (this.plugin.siteId === siteId) await this.plugin.setup(null, null);
    await this.openSection(this.manageSitesSection);
  };

  proto.acceptSiteShare = async function (siteId, code) {
    await env().gw("/publish/share/accept", { token: env().Hw.token, code });
    if (this.plugin.siteId === siteId) await this.plugin.setup(null, null);
    await this.openSection(this.manageSitesSection);
  };

  proto.openReviewChanges = function () {
    return this.openSection(this.reviewChangesSection);
  };

  proto.openManageSites = function () {
    return this.openSection(this.manageSitesSection);
  };

  proto.editSlug = async function (site, slug) {
    this.editSiteSlugSection.setSiteInfo(site);
    this.editSiteSlugSection.setExistingSlug(slug);
    await this.openSection(this.editSiteSlugSection);
  };

  proto.uploadChanges = function (changes) {
    this.uploadProgressSection.addChanges(changes);
    return this.openSection(this.uploadProgressSection);
  };

  proto.showPasswords = async function () {
    const section = this.listPasswordSection;
    try {
      this.currentSection.hide();
      this.loaderEl.show();
      const passwords = (await this.plugin.apiGetPassword()).pass;
      section.setPasswords(passwords);
      section.updateDisplay();
      await this.openSection(section);
    } catch (error) {
      this.handleError(error);
    }
  };

  proto.openAddPassword = function () {
    return this.openSection(this.addPasswordSection);
  };

  proto.setTitleText = function (text) {
    this.titleEl.setText(text);
  };

  proto.closeSection = function () {
    this.errorMessageEl.hide();
    if (this.currentSection) this.currentSection.hide();
    this.currentSection = null;
  };

  proto.openSection = async function (section) {
    this.closeSection();
    if (section.title) this.setTitleText(section.title);
    this.currentSection = section;
    this.loaderEl.show();
    await section.show();
    this.loaderEl.hide();
  };

  return PublishChangesModal;
}
