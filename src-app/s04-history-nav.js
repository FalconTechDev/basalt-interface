// s04: own implementation of the editor history navigation button (was `Gg`).
//
// Renders a back/forward button for a leaf's navigation history. A plain click
// steps one entry; Cmd/Ctrl-click duplicates the leaf first. Right-click (or a
// long-press / downward drag on touch) opens a menu jumping straight to any
// recorded history entry.

/** Creates a history back/forward button bound to `getLeaf`. */
export function s04HistoryNavButton(app, getLeaf, direction, host) {
  const isBackward = direction === "backward";
  return host.createEl("button", "clickable-icon", (button) => {
    button.ariaDisabled = "true";
    host.setTooltip(button, isBackward ? host.t.commands.navigateBack() : host.t.commands.navigateForward());

    button.onClickEvent(async (event) => {
      if (event.button === 2) return;
      const withDuplicate = host.keyModifiers.isModEvent(event);
      let leaf = getLeaf();
      if (withDuplicate) leaf = await app.workspace.duplicateLeaf(getLeaf(), withDuplicate);
      await leaf.history.go(isBackward ? -1 : 1);
    });

    const openHistoryMenu = (forwardMouseUp) => {
      const history = isBackward ? getLeaf().history.backHistory : getLeaf().history.forwardHistory;
      const menu = new host.Menu();
      const addEntry = (index) => {
        menu.addItem((item) =>
          item
            .setTitle(host.truncateText(history[index].title, 50))
            .setIcon(history[index].icon)
            .onClick(async (clickEvent) => {
              const withDuplicate = host.keyModifiers.isModEvent(clickEvent);
              let leaf = getLeaf();
              if (withDuplicate) leaf = await app.workspace.duplicateLeaf(getLeaf(), withDuplicate);
              let steps = history.length - index;
              if (isBackward) steps = 0 - steps;
              await leaf.history.go(steps);
            })
        );
      };
      for (let index = history.length - 1; index >= 0; index--) addEntry(index);
      host.hideTooltip();
      const rect = button.getBoundingClientRect();
      menu.showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true });
      if (forwardMouseUp) {
        menu.dom.addEventListener("mouseup", (event) => {
          const target = event.targetNode;
          setTimeout(() => {
            for (const item of menu.items) {
              if (item instanceof host.MenuItem && item.dom.contains(target)) {
                item.handleEvent(event);
                return;
              }
            }
          });
        });
      }
    };

    button.addEventListener("contextmenu", () => openHistoryMenu(false));

    // Long-press (or downward drag) also opens the history menu on touch.
    (function attachPress(buttonEl, open) {
      buttonEl.addEventListener("mousedown", (downEvent) => {
        const timer = window.setTimeout(() => {
          cleanup();
          open();
        }, 400);
        const cleanup = () => {
          window.removeEventListener("mouseup", onUp);
          window.removeEventListener("mousemove", onMove);
          window.clearTimeout(timer);
        };
        const onUp = () => cleanup();
        const onMove = (moveEvent) => {
          const dx = moveEvent.clientX - downEvent.clientX;
          const dy = moveEvent.clientY - downEvent.clientY;
          if (dx * dx + dy * dy > 25) {
            cleanup();
            if (dy > 0 && dy > Math.abs(dx)) open();
          }
        };
        window.addEventListener("mouseup", onUp);
        window.addEventListener("mousemove", onMove);
      });
    })(button, () => openHistoryMenu(true));
  });
}
