// ViewHeader: the header row some panes put above their content (bookmarks, tags, file explorer):
// a nav-buttons container on the left where views add their own buttons, plus a sort menu helper.

export function defineViewHeader(host) {
  function ViewHeader(app, containerEl) {
    this.app = app;
    const headerEl = this.navHeaderEl = containerEl.createDiv({ cls: "nav-header", prepend: true });
    this.navButtonsEl = headerEl.createDiv("nav-buttons-container");
  }

  /** Adds an icon button with a tooltip; returns the button element. */
  ViewHeader.prototype.addNavButton = function (icon, tooltip, onClick, extraClass) {
    const button = this.navButtonsEl.createDiv("clickable-icon nav-action-button");
    if (extraClass) button.addClass(extraClass);
    button.addEventListener("click", onClick);
    host.setIcon(button, icon);
    host.setTooltip(button, tooltip);
    return button;
  };

  /**
   * A sort button whose menu lists `groups` (arrays of sort keys). `labels` maps a key to its title function
   * (a plain `labelOf(key)` function is also accepted), `current()` is the active key and `onPick(key)` runs
   * when one is chosen. A separator closes each group.
   */
  ViewHeader.prototype.addSortButton = function (groups, labels, onPick, current) {
    const labelOf = typeof labels === "function" ? labels : (key) => labels[key]();
    return this.addNavButton("lucide-sort-asc", host.t.plugins.fileExplorer.actionChangeSort(), (event) => {
      event.preventDefault();
      const button = event.currentTarget;
      if (button.classList.contains("has-active-menu")) return;
      const menu = new host.Menu().setNoIcon();
      const active = current();
      for (const group of groups) {
        for (const key of group) {
          const title = labelOf(key);
          menu.addItem((item) => item
            .setTitle(title)
            .setChecked(key === active)
            .onClick(() => onPick(key)));
        }
        menu.addSeparator();
      }
      menu.setParentElement(button).showAtMouseEvent(event);
    });
  };

  return ViewHeader;
}
