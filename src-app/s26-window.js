// Slice s26 — per-window bootstrap helpers: focus tracking, enhancement injection and
// the Electron/frameless-titlebar attach. These run once for the main window and again
// for every pop-out window (and for sandboxed embed iframes).

/** `function gZ` — keeps `is-focused` on the body in sync with window focus.
 *  Desktop reads the Electron window's focus state through the `focuschange` IPC event;
 *  everywhere else plain focus/blur listeners are used. */
export function s26TrackWindowFocus(win, host) {
  const doc = win.document;
  let update = () => doc.body.toggleClass("is-focused", doc.hasFocus());
  if (host.Platform.isDesktopApp && win.electronWindow) {
    update = () => doc.body.toggleClass("is-focused", win.electronWindow.isFocused());
    win.addEventListener("focuschange", update);
  } else {
    win.addEventListener("focus", update);
    win.addEventListener("blur", update);
  }
  update();
}

/** `function yZ` — evaluates the enhancement script inside another window (pop-outs and
 *  embed iframes). The function source is taken from THIS window's `globalEnhance`
 *  (installed by enhance.js) and eval'd in the target window. */
export function s26InstallEnhancements(win) {
  const src = window.globalEnhance.toString();
  win.eval.call(win, "(" + src + ")()\n//# sourceURL=enhance.js");
}

/** `function bZ` — attaches Electron plumbing to a window: finds the top-level window's
 *  `require`, wires `electron`/`electronWindow`, redirects `file:` links through the
 *  main process (`open-url` IPC), and installs the frameless titlebar on the top window. */
export function s26AttachElectron(win, host) {
  let top = win;
  while (top !== top.parent && top.parent !== null) top = top.parent;
  const req = top.require;
  if (!req) return;
  const electron = req("electron");
  if (!electron) return;
  win.electron = electron;
  if (!electron.remote) {
    try { electron.remote = req("@electron/remote"); }
    catch (e) { console.error(e); }
  }
  win.electronWindow = electron.remote.getCurrentWindow();
  const origOpen = win.open;
  win.open = function (url, target, features) {
    if (typeof url === "string" && url.indexOf("file:") === 0) {
      electron.ipcRenderer.send("open-url", url);
      return null;
    }
    return origOpen.apply(this, arguments);
  };
  if (win.parent === win) {
    const style = electron.ipcRenderer.sendSync("frame") || "hidden";
    win.titlebarStyle = style;
    if (style !== "native") {
      win.frameDom = new host.Titlebar(win.electronWindow, win);
      if (style === "hidden") win.document.body.addClass("is-hidden-frameless");
    }
  }
}
