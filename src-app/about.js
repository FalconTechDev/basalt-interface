// The About settings tab: version and update controls, auto-update / insider-build toggles, the
// language picker, the help link, the account / Catalyst / commercial-licence sections and the
// advanced section (startup check, CLI registration).
//
// Store and site URLs already point at Basalt; the update flow talks to the Electron main process
// over ipcRenderer ("update", "check-update", "disable-update", "relaunch", "insider-build", "cli",
// "register-cli") exactly as before.

import { inherit } from "./inherit.js";
import { hostEnv } from "./env.js";
import { account, acctUserInfo, acctSignOut, acctValidateBusinessKey } from "./account.js";

const aboutEnv = () => hostEnv();

const WIKI = "https://github.com/FalconTechDev/basalt/wiki";
const REPO = "https://github.com/FalconTechDev/basalt";
const RELEASES = "https://github.com/FalconTechDev/basalt/releases";

export function defineAboutTab(host) {
  /** Settings tab id "about"; draws itself in display() and refreshes the account rows afterwards. */
  function AboutTab() {
    const self = host.SettingTab.apply(this, arguments) || this;
    self.name = aboutEnv().gm.setting.about.name();
    self.id = "about";
    self.icon = "circle-user";
    return self;
  }
  inherit(AboutTab, host.SettingTab);
  const proto = AboutTab.prototype;

  proto.display = function () {
    const self = this;
    const e = aboutEnv();
    const Yl = e.Yl;
    const gm = e.gm;
    const aboutI18n = gm.setting.about;
    const containerEl = this.containerEl;
    containerEl.empty();

    let updateState = "";
    let updateChecking = false;
    let updateDisabled = false;
    e.Of((electron) => {
      updateState = electron.ipcRenderer.sendSync("update");
      updateChecking = electron.ipcRenderer.sendSync("check-update");
      updateDisabled = electron.ipcRenderer.sendSync("disable-update");
    });

    const setting = this.app.setting;
    const group = new host.SettingGroup(containerEl);

    if (Yl.isDesktopApp) {
      if (updateChecking) {
        const poll = () => {
          e.Of((electron) => { updateChecking = electron.ipcRenderer.sendSync("check-update"); });
          if (updateChecking) setTimeout(poll, 1000);
          else self.display();
        };
        setTimeout(poll, 300);
      }

      let versionSetting = null;
      group.addSetting((s) => {
        versionSetting = s;
        s.setName(aboutI18n.labelVersion({ version: Yl.version })).setDesc(createFragment((frag) => {
          frag.appendText(aboutI18n.labelInstallVersion({ version: Yl.build }));
          frag.createEl("br");
          if (updateState === "update-downloaded") {
            frag.appendText(aboutI18n.labelNewVersionReady());
            frag.createEl("br");
            frag.createEl("a", { text: aboutI18n.labelReadChangelog(), attr: { href: RELEASES, target: "_blank", rel: "noopener" } });
          } else if (updateState === "update-manual-required" || e.gy(e.zf, e.yte)) {
            frag.createEl("b", { text: aboutI18n.labelManualUpdateRequired() });
            frag.appendText(" ");
            frag.createEl("a", { text: gm.dialogue.buttonDownload(), attr: { href: e.fy(), target: "_blank", rel: "noopener" } });
          } else {
            frag.createEl("a", { text: aboutI18n.labelReadChangelog(), attr: { href: RELEASES, target: "_blank", rel: "noopener" } });
          }
        }));
      });
      if (updateState === "update-downloaded") {
        versionSetting.addButton((b) => b.setCta().setButtonText(aboutI18n.buttonRelaunch()).onClick(() => {
          e.Of((electron) => electron.ipcRenderer.sendSync("relaunch"));
        }));
      } else {
        versionSetting.addButton((b) => b.setCta().setButtonText(aboutI18n.buttonCheckForUpdates()).setLoading(updateChecking).onClick(() => {
          e.Of((electron) => electron.ipcRenderer.send("check-update", true));
          self.display();
        }));
      }

      group.addSetting((s) => s.setName(aboutI18n.optionAutoUpdate()).setDesc(aboutI18n.optionAutoUpdateDescription()).addToggle((toggle) => toggle
        .setValue(!updateDisabled)
        .onChange((value) => {
          e.Of((electron) => electron.ipcRenderer.sendSync("disable-update", !value));
          setTimeout(() => self.display(), 500);
        })));

      if (account.license) {
        let insider = false;
        e.Of((electron) => { insider = electron.ipcRenderer.sendSync("insider-build", null); });
        group.addSetting((s) => s.setName(aboutI18n.optionInsiderBuild()).setDesc(aboutI18n.optionInsiderBuildDescription()).addToggle((toggle) => toggle
          .setValue(insider)
          .onChange((value) => { e.Of((electron) => electron.ipcRenderer.sendSync("insider-build", value)); })));
      } else {
        window.electron.ipcRenderer.send("insider-build", false);
      }
    } else if (e.Em) {
      group.addSetting((s) => s.setName(aboutI18n.labelVersion({ version: e.gte }) + " (" + Yl.build + ")"));
    }

    const currentLanguage = e.sm();
    let selectedLanguage = currentLanguage;
    let relaunchButton = null;
    group.addSetting((s) => s
      .setName(aboutI18n.optionLanguage())
      .setDesc(createFragment((frag) => {
        frag.appendText(aboutI18n.optionLanguageDescription());
        frag.createEl("br");
        if (!Yl.isMobile) frag.createEl("a", { text: aboutI18n.labelAddOwnLanguage(), attr: { href: WIKI, target: "_blank", rel: "noopener" } });
      }))
      .addButton((b) => {
        relaunchButton = b;
        b.setCta().setButtonText(aboutI18n.buttonRelaunch()).onClick(() => {
          e.lm(selectedLanguage);
          window.location.reload();
        });
        b.buttonEl.hide();
      })
      .addDropdown((d) => {
        d.onChange((value) => {
          selectedLanguage = value;
          relaunchButton.buttonEl.toggle(currentLanguage !== selectedLanguage);
        });
        for (const code of e.Jf) d.addOption(code, e.Zf[code]);
        d.setValue(currentLanguage);
      }));

    group.addSetting((s) => s.setName(aboutI18n.optionGetHelp()).setDesc(aboutI18n.optionGetHelpDescription()).addButton((b) => b
      .setButtonText(aboutI18n.buttonOpen())
      .onClick(() => {
        setting.close();
        self.app.openHelp();
      })));

    const accountGroup = new host.SettingGroup(containerEl).setHeading(gm.setting.account.name());
    accountGroup.addSetting((s) => { self.accountSetting = s; });
    accountGroup.addSetting((s) => { self.catalystSetting = s; });
    accountGroup.addSetting((s) => { self.commercialLicenseSetting = s; });

    const advancedGroup = new host.SettingGroup(containerEl);
    advancedGroup.setHeading(aboutI18n.optionAdvanced());
    advancedGroup.addSetting((s) => s
      .setName(aboutI18n.optionCheckSlowStartup())
      .setDesc(aboutI18n.optionCheckSlowStartupDescription())
      .addExtraButton((b) => b.setIcon("lucide-timer").setTooltip(aboutI18n.buttonCheckStartup()).onClick(() => {
        new host.SlowStartupCheck(self.app).open();
      }))
      .addToggle((toggle) => toggle
        .setValue(self.app.loadLocalStorage("slow-startup-check"))
        .onChange((value) => {
          if (value) self.app.saveLocalStorage("slow-startup-check", "1");
          else self.app.saveLocalStorage("slow-startup-check", null);
        })));

    if (Yl.isDesktopApp && window.electron) {
      advancedGroup.addSetting((s) => s
        .setName(aboutI18n.optionCli())
        .setDesc(aboutI18n.optionCliDescription())
        .addToggle((toggle) => toggle
          .setValue(window.electron.ipcRenderer.sendSync("cli", null))
          .onChange(async (value) => {
            window.electron.ipcRenderer.sendSync("cli", value);
            if (!value) return;
            const modal = new host.ButtonModal(self.app);
            modal.setTitle(aboutI18n.optionRegisterPath());
            modal.setContent(aboutI18n.optionRegisterPathDescription());
            const errorEl = modal.contentEl.createDiv({ cls: "message-container", prepend: true }).createDiv("message mod-error");
            errorEl.hide();
            modal.buttonContainerEl.createEl("a", { cls: "mod-secondary", text: gm.interface.buttonLearnMore(), attr: { href: WIKI, target: "_blank", rel: "noopener" } });
            modal.addButton("mod-cancel", gm.dialogue.buttonSkip(), () => {});
            modal.addButton("mod-cta", aboutI18n.buttonRegister(), async () => {
              errorEl.hide();
              const result = await window.electron.ipcRenderer.invoke("register-cli");
              if (result.success) {
                new host.Notice(result.message);
                return;
              }
              errorEl.setText(result.message);
              errorEl.show();
              return true;
            }).open();
          })));
    }

    this.updateAccountSettings();
    (async () => {
      try {
        await acctUserInfo(account);
        await acctValidateBusinessKey(account);
      } finally {
        this.updateAccountSettings();
      }
    })();
  };

  proto.updateAccountSettings = function () {
    const self = this;
    const e = aboutEnv();
    const Yl = e.Yl;
    const gm = e.gm;
    const accountI18n = gm.setting.account;
    const aboutI18n = gm.setting.about;

    this.accountSetting.clear();
    this.catalystSetting.clear();
    this.commercialLicenseSetting.clear();

    if (account.email) {
      this.accountSetting
        .setName(accountI18n.optionYourAccount())
        .setDesc(accountI18n.optionYourAccountDesc({ name: account.name, email: account.email }));
      if (!Yl.isAndroidApp) {
        this.accountSetting.addButton((b) => b.setButtonText(gm.interface.buttonManage()).onClick(() => {
          window.open(REPO);
        }));
      }
      this.accountSetting.addButton((b) => b
        .setButtonText(accountI18n.buttonLogOut())
        .setClass("mod-destructive")
        .onClick(async () => {
          b.buttonEl.addClass("mod-loading");
          try {
            await acctSignOut(account);
            self.display();
          } catch (err) {
            b.buttonEl.removeClass("mod-loading");
            new host.Notice(err.message).containerEl.addClass("mod-error");
          }
        }));

      if (account.license) {
        const tier = account.license;
        this.catalystSetting
          .setName(aboutI18n.optionCatalyst())
          .setDesc(aboutI18n.optionCatalystDesc({ tier }));
        if (tier !== "vip" && !Yl.isAndroidApp) {
          this.catalystSetting.addButton((b) => b.setButtonText(accountI18n.buttonUpgradeCatalyst()).onClick(() => {
            window.open(REPO);
          }));
        }
      } else {
        this.catalystSetting
          .setName(aboutI18n.optionCatalyst())
          .setDesc(createFragment((frag) => {
            frag.appendText(aboutI18n.optionCatalystDescNoLicense());
            frag.createEl("br");
            if (!Yl.isAndroidApp) frag.createEl("a", { text: gm.interface.buttonLearnMore(), attr: { href: WIKI, target: "_blank", rel: "noopener" } });
          }));
        if (!Yl.isAndroidApp) {
          this.catalystSetting.addButton((b) => b.setButtonText(accountI18n.buttonPurchase()).setCta().onClick(() => {
            window.open(REPO);
          }));
        }
      }
      this.catalystSetting.settingEl.show();
    } else {
      this.accountSetting
        .setName(accountI18n.optionYourAccount())
        .setDesc(accountI18n.optionYourAccountDescNoLogin())
        .addButton((b) => b.setButtonText(accountI18n.labelLogIn()).onClick(() => {
          new host.LoginModal(self.app).setCloseCallback(() => self.display()).open();
        }))
        .addButton((b) => b.setButtonText(accountI18n.labelSignUp()).onClick(() => {
          if (Yl.isIosApp && e.Tm) e.Tm.open({ url: REPO });
          else window.open(REPO);
        }));
      this.catalystSetting.settingEl.hide();
    }

    if (account.key) {
      const key = account.key;
      const validation = account.keyValidation;
      const licenseSetting = this.commercialLicenseSetting;
      let desc = aboutI18n.labelYourCommercialLicenseKey({ key });
      if (validation === "valid") {
        desc += " " + aboutI18n.labelCommercialLicenseInfo({
          company: account.company,
          seats: account.seats,
          expiry: window.moment(account.expiry).format("MMMM D, YYYY"),
        });
      }
      licenseSetting.setName(aboutI18n.labelCommercialLicense()).setDesc(desc);
      if (validation === "valid") {
        licenseSetting.addButton((b) => b.setButtonText(aboutI18n.buttonRemoveCommercialLicense()).onClick(() => {
          account.setKey(null);
          self.display();
        }));
      } else if (validation) {
        licenseSetting.descEl.createEl("p", { text: aboutI18n.labelInvalidCommercialLicense() + validation });
        licenseSetting.addButton((b) => b.setButtonText(aboutI18n.buttonActivate()).setCta().onClick(() => {
          new host.LicenseModal(self.app).setCloseCallback(() => self.display()).open();
        }));
      } else {
        licenseSetting.descEl.createEl("p", { text: aboutI18n.labelValidatingCommercialLicense() });
      }
    } else {
      this.commercialLicenseSetting
        .setName(accountI18n.optionCommercialLicense())
        .setDesc(createFragment((frag) => {
          frag.appendText(accountI18n.optionCommercialLicenseDesc());
          frag.createEl("br");
          if (!Yl.isAndroidApp) frag.createEl("a", { text: gm.interface.buttonLearnMore(), attr: { href: WIKI, target: "_blank", rel: "noopener" } });
        }))
        .addButton((b) => b.setButtonText(aboutI18n.buttonActivate()).setCta().onClick(() => {
          new host.LicenseModal(self.app).setCloseCallback(() => self.display()).open();
        }));
      if (!Yl.isAndroidApp) {
        this.commercialLicenseSetting.addButton((b) => b.setButtonText(accountI18n.buttonPurchase()).onClick(() => {
          window.open(REPO);
        }));
      }
    }
  };

  return AboutTab;
}
