// s16 slice: the "rate the app" feedback banner shown at the bottom of the window on
// mobile/desktop once the vault is old enough and big enough to have an opinion.
import { runTransition } from "./animation.js";
import { ng15AnimateCollapse } from "./n-g15-tree.js";
import { s16MobileFeedbackFlag } from "./s16-constants.js";

const MIN_VAULT_AGE_MS = 15552e6; // ~180 days
const MIN_FILE_COUNT = 50;

/** lte: FeedbackBanner. */
export function defineFeedbackBanner(host) {
  function FeedbackBanner(app, parentEl) {
    this.app = app;
    this.parentEl = parentEl;
    this.containerEl = parentEl.createDiv({ cls: "feedback-banner-container" });
    this.containerEl.hide();
    this.bannerEl = this.containerEl.createDiv({ cls: "feedback-banner" }, (el) => {
      el.createDiv({ cls: "feedback-banner-title", text: host.i18n.interface.mobile.feedback.labelFeedback() });
      el.createDiv({ cls: "feedback-banner-content" }, (content) => {
        content.createDiv({ cls: "feedback-banner-body", text: host.i18n.interface.mobile.feedback.labelFeedbackDesc() });
        content.createEl("button", { text: host.i18n.interface.mobile.feedback.actionRate() })
          .addEventListener("click", () => this.submitRating());
      });
      el.createDiv({ cls: "feedback-banner-dismiss-button", text: host.i18n.interface.mobile.feedback.actionDismiss() })
        .addEventListener("click", () => {
          localStorage.setItem(s16MobileFeedbackFlag, "1");
          this.hide();
        });
    });
  }

  FeedbackBanner.prototype.show = async function () {
    if (await this.shouldShow()) this.containerEl.show();
  };

  FeedbackBanner.prototype.shouldShow = async function () {
    if (host.s16DevBuild) return true;
    const app = this.app;
    if (!navigator.onLine) return false;
    if (localStorage.getItem(s16MobileFeedbackFlag)) return false;
    const licensed = host.s16License.license
      || app.internalPlugins.getEnabledPluginById("sync")?.getRemoteVaultId();
    if (!licensed) return false;
    if (host.Platform.isIosApp && !(await host.capacitorApp.isInstalledFromStore())) return false;
    if (app.vault.getRoot().getFileCount() < MIN_FILE_COUNT) return false;
    const configDir = app.vault.configDir;
    const stat = await app.vault.adapter.stat(configDir);
    return Date.now() - stat.ctime < MIN_VAULT_AGE_MS ? false : true;
  };

  FeedbackBanner.prototype.hide = async function () {
    this.containerEl.setCssStyles({ height: this.containerEl.offsetHeight + "px" });
    const bannerEl = this.bannerEl;
    runTransition(bannerEl, new host.Transition({ duration: 150, fn: "cubic-bezier(0.45,0.05,0.55,0.95)" })
      .addProp("transform", "", "scale(0.01)", ""), () => null);
    await host.sleep(70);
    await ng15AnimateCollapse(this.containerEl);
    this.containerEl.hide();
  };

  FeedbackBanner.prototype.submitRating = async function () {
    localStorage.setItem(s16MobileFeedbackFlag, "1");
    await host.s16ReviewApi.requestReview();
    await host.sleep(400);
    await this.hide();
  };

  return FeedbackBanner;
}
