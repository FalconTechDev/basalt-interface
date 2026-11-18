// StatusBar: the strip at the bottom of the window. It only hands out item elements;
// each feature fills its own item (text, icons, segments) through the returned div.

export function defineStatusBar() {
  function StatusBar(app, containerEl) {
    this.app = app;
    this.containerEl = containerEl;
  }

  /** A new empty status-bar item appended to the bar; the caller styles and fills it. */
  StatusBar.prototype.registerStatusBarItem = function () {
    return this.containerEl.createDiv("status-bar-item");
  };

  return StatusBar;
}
