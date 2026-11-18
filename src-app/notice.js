// Notice: the toast messages in the corner of the window.
import { runTransition } from "./animation.js";

/** window -> the .notice-container element that stacks the notices of that window */
const containers = new WeakMap();

export function defineNotice(host) {
  /** Shows `message` (text or a DocumentFragment) for `duration` ms (0 = until clicked / hidden). */
  function Notice(message, duration = 4000) {
    this.timerId = -1;
    this.buttonContainerEl = null;
    const win = (this.win = activeWindow);
    let container = containers.get(win);
    if (!container) {
      container = createDiv("notice-container");
      containers.set(win, container);
    }
    if (!container.isShown()) win.document.body.appendChild(container);

    const el = (this.containerEl = container.createDiv("notice"));
    this.messageEl = this.noticeEl = el.createDiv({ cls: "notice-message", text: message });
    // slide in: start off to the side (phones: below) and let the transition bring it to its place
    const offscreen = host.Platform.isMobile ? "translateY(100%)" : "translateX(350px)";
    runTransition(el, new host.Transition().addProp("transform", offscreen, "", ""));
    this.setAutoHide(duration);
    el.addEventListener("click", () => this.hide());
    if (host.Platform.isPhone) {
      host.swipeToDismiss(el, el, null, () => {
        el.detach();
        this.hide();
      });
    }
  }

  Notice.prototype.setMessage = function (message) {
    this.messageEl.setText(message);
    return this;
  };

  /** Hides after `ms`; while the pointer is over the notice the timer is held, and one second after it leaves the notice goes. */
  Notice.prototype.setAutoHide = function (ms) {
    const el = this.containerEl;
    if (this.timerId !== -1) {
      this.win.clearTimeout(this.timerId);
      this.timerId = -1;
    }
    if (ms) {
      let hovered = false;
      const hideUnlessHovered = () => { if (!hovered) this.hide(); };
      this.timerId = this.win.setTimeout(hideUnlessHovered, ms);
      el.addEventListener("mouseenter", () => { hovered = true; });
      el.addEventListener("mouseleave", () => {
        hovered = false;
        this.win.setTimeout(hideUnlessHovered, 1000);
      });
    }
    return this;
  };

  /** A call-to-action button below the message; clicking it hides the notice and then runs `callback`. */
  Notice.prototype.addButton = function (label, callback) {
    if (!this.buttonContainerEl) this.buttonContainerEl = this.containerEl.createDiv("notice-button-container");
    this.buttonContainerEl.createDiv({ cls: "notice-cta", text: label }).addEventListener("click", (event) => {
      this.hide();
      callback(event);
    });
    return this;
  };

  /** Fades the notice out (and closes the gap it leaves), then removes it; the container goes when it is empty. */
  Notice.prototype.hide = function () {
    const { containerEl: el, win } = this;
    if (this.timerId != -1) win.clearTimeout(this.timerId);
    const remove = () => {
      el.detach();
      const container = containers.get(this.win);
      if (container && container.childElementCount === 0) container.detach();
    };
    if (!el.isShown()) {
      remove();
    } else if (host.Platform.isMobile) {
      runTransition(el, new host.Transition({ duration: 150 }).addProp("transform", "scale(1, 1)", "scale(0.85, 0.85)", "").addProp("opacity", "1", "0", ""), remove);
    } else {
      const style = getComputedStyle(el);
      let gap = -el.offsetHeight;
      const margin = parseInt(style.marginBottom);
      if (!isNaN(margin)) gap -= margin;
      runTransition(el, new host.Transition({ duration: 120 }).addProp("opacity", "1", "0").addProp("margin-top", "0px", gap + "px"), remove);
    }
  };

  return Notice;
}
