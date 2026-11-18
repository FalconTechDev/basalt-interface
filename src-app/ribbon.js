// The ribbon: the strip of icon buttons next to a side dock. Plugins add buttons (addRibbonItemButton); the user can reorder them
// by dragging and hide them through the context menu. Order and visibility are part of the saved layout.

export function defineWorkspaceRibbon(host) {
  return class WorkspaceRibbon {
    constructor(workspace, side) {
      /** { id, icon, title, callback, hidden, buttonEl } in display order; items whose plugin is gone keep id + hidden only */
      this.items = [];
      this.workspace = workspace;
      this.ribbonItemsEl = null;
      this.ribbonSettingEl = null;
      const el = (this.containerEl = createDiv("workspace-ribbon side-dock-ribbon"));
      el.addClass(`mod-${side}`);
      if (side === "left") {
        this.ribbonItemsEl = el.createDiv("side-dock-actions");
        this.ribbonSettingEl = el.createDiv("side-dock-settings");
        if (!host.Platform.isMobile) host.scrollWithPointer(el);
      }
      el.addEventListener("contextmenu", this.onContextMenu.bind(this));
    }

    /** Restores hidden flags and order from a saved layout ({ hiddenItems: { id: hidden } }, key order = display order). */
    load(data) {
      if (data.hasOwnProperty("hiddenItems")) {
        const hidden = data.hiddenItems;
        for (const item of this.items) {
          const flag = hidden[item.id];
          item.hidden = flag !== null && flag !== undefined ? flag : false;
        }
        const order = Object.keys(hidden);
        this.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      }
      this.onChange(false);
    }

    serialize() {
      const hiddenItems = {};
      for (const item of this.items) hiddenItems[item.id] = item.hidden;
      return { hiddenItems };
    }

    /** Adds (or re-adds, keeping its place and hidden flag) a button; returns its element. */
    addRibbonItemButton(id, icon, title, callback) {
      const button = this.makeRibbonItemButton(icon, title, callback);
      host.makeDragReorderable(
        button, button, this.ribbonItemsEl, 5,
        () => null,
        (slot) => {
          // `slot` counts only the buttons that are in the DOM; translate it into an index of `items`
          let index = 0;
          let seen = 0;
          for (index = 0; index < this.items.length && seen !== slot; index++) if (this.items[index].buttonEl) seen++;
          const item = this.items.find((entry) => entry.id === id);
          this.items.remove(item);
          this.items.splice(index, 0, item);
          this.onChange(true);
        },
      );
      let item = this.items.find((entry) => entry.id === id);
      if (item) {
        item.title = title;
        item.icon = icon;
        item.callback = callback;
      } else {
        item = { id, icon, title, callback, hidden: false };
        this.items.push(item);
      }
      item.buttonEl = button;
      this.onChange(false);
      return button;
    }

    /** Forgets the button of a removed action but keeps the slot (so it comes back at the same place). */
    removeRibbonAction(id) {
      for (const item of this.items) {
        if (item.id === id) {
          delete item.buttonEl;
          delete item.callback;
          break;
        }
      }
    }

    setCollapsedState(collapsed) { this.containerEl.toggleClass("is-collapsed", collapsed); }
    hide() { this.containerEl.addClass("is-hidden"); }
    show() { this.containerEl.removeClass("is-hidden"); }

    /** Re-renders: shows the visible buttons in order; `save` also persists the layout. */
    onChange(save) {
      const buttons = [];
      for (const item of this.items) {
        const button = item.buttonEl;
        if (button) {
          button.toggle(!item.hidden);
          buttons.push(button);
        }
      }
      this.ribbonItemsEl.setChildrenInPlace(buttons);
      if (save) this.workspace.requestSaveLayout();
    }

    makeRibbonItemButton(icon, title, callback) {
      const button = createDiv("clickable-icon side-dock-ribbon-action");
      button.onClickEvent(callback);
      host.setTooltip(button, title, { delay: host.TOOLTIP_DELAY, placement: "right" });
      host.setIcon(button, icon);
      return button;
    }

    /** Right click on the empty part of the ribbon: a checklist of all buttons plus "hide ribbon". */
    onContextMenu(event) {
      if (event.target !== this.containerEl) return;
      const menu = new host.Menu();
      for (const item of this.items) {
        if (!item.buttonEl) continue;
        menu.addItem((entry) => entry
          .setSection("order")
          .setTitle(item.title)
          .setIcon(item.icon)
          .setChecked(!item.hidden)
          .onClick(() => {
            item.hidden = !item.hidden;
            this.onChange(true);
          }));
      }
      menu.addItem((entry) => entry
        .setSection("ribbon")
        .setTitle(host.t.interface.optionHideRibbon())
        .setIcon("lucide-panel-left-close")
        .onClick(() => { this.workspace.app.vault.setConfig("showRibbon", false); }));
      menu.showAtMouseEvent(event);
    }
  };
}
