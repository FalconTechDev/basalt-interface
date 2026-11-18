// s29: hotkey settings filter chip and its status-filter title map (were w0/k0).
//
// The chip is the removable pill above the hotkey list; the map translates filter ids to their
// localized titles. Both are only referenced by the inherited hotkey tab glue.

export function defineHotkeyFilterChip(host) {
  const hotkeysI18n = () => host.t.setting.hotkeys;

  function HotkeyFilterChip(containerEl) {
    this.value = null;
    const self = this;
    this.el = createDiv({ cls: "hotkey-filter" }, (el) => {
      self.innerEl = el.createDiv({ cls: "hotkey-filter-inner", text: hotkeysI18n().labelShowAll() });
      self.removeEl = el.createDiv("hotkey-filter-remove-button", (button) => {
        host.setIcon(button, "lucide-x");
        host.setTooltip(button, host.t.interface.menu.close());
      });
    });
    if (containerEl) containerEl.appendChild(this.el);
  }
  const proto = HotkeyFilterChip.prototype;

  proto.setValue = function (value) { this.value = value; return this; };
  proto.setTitle = function (title) { this.innerEl.setText(title); return this; };
  proto.onRemove = function (callback) { this.handleRemove = callback; this.removeEl.addEventListener("click", () => this.remove()); return this; };
  proto.remove = function () {
    this.value = null;
    if (this.el.isShown()) {
      this.el.detach();
      if (this.handleRemove) this.handleRemove();
    }
  };
  return HotkeyFilterChip;
}

/** Status-filter id -> localized title (was k0). Values are the i18n functions themselves. */
export function s29HotkeyFilterTitles(host) {
  const i18n = host.t.setting.hotkeys;
  return {
    "show-all": i18n.labelShowAll,
    "show-assigned": i18n.labelShowAssigned,
    "show-user-assigned": i18n.labelShowUserAssigned,
    "show-unassigned": i18n.labelShowUnassigned,
  };
}
