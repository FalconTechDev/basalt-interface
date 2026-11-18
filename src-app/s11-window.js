// Window-level bootstrap helpers: focus styling, the enhance.js injector for child
// windows and the Electron bridge that pop-out windows need.
import { env } from "./env.js";



/**
 * Tracks window focus and toggles "is-focused" on the document body. On the desktop
 * app the focus state comes from the Electron window; elsewhere from DOM events.
 * Original: function gZ(win)
 */
export function s11TrackWindowFocus(win) {
  const doc = win.document;
  let update;
  if (env().Yl.isDesktopApp && win.electronWindow) {
    update = () => doc.body.toggleClass("is-focused", win.electronWindow.isFocused());
    win.addEventListener("focuschange", update);
  } else {
    update = () => doc.body.toggleClass("is-focused", doc.hasFocus());
    win.addEventListener("focus", update);
    win.addEventListener("blur", update);
  }
  update();
}

/**
 * Evaluates enhance.js inside another window (used for iframe embed editors).
 * Original: function yZ(win)
 */
export function s11InstallEnhance(win) {
  const src = window.globalEnhance.toString();
  win.eval.call(win, "(" + src + ")()\n//# sourceURL=enhance.js");
}

/**
 * Gives a pop-out window access to Electron: remote module, current window handle,
 * file:-URL interception in window.open and the custom titlebar for frameless
 * windows. Walks to the top-level window to find `require`.
 * Original: function bZ(win)
 */
export function s11AttachElectron(win) {
  let top = win;
  while (top !== top.parent && top.parent !== null) top = top.parent;
  const req = top.require;
  if (!req) return;
  const electron = req("electron");
  if (!electron) return;
  win.electron = electron;
  if (!electron.remote) {
    try {
      electron.remote = req("@electron/remote");
    } catch (e) {
      console.error(e);
    }
  }
  win.electronWindow = electron.remote.getCurrentWindow();
  const origOpen = win.open;
  win.open = function (url) {
    if (typeof url === "string" && url.indexOf("file:") === 0) {
      electron.ipcRenderer.send("open-url", url);
      return null;
    }
    return origOpen.apply(this, arguments);
  };
  if (win.parent === win) s11InstallTitlebar(win);
}

/** Frameless/native titlebar setup for the main window (original inner function of bZ). */
function s11InstallTitlebar(win) {
  const style = win.electron.ipcRenderer.sendSync("frame") || "hidden";
  win.titlebarStyle = style;
  if (style !== "native") {
    win.frameDom = new (env().BD)(win.electronWindow, win);
    if (style === "hidden") win.document.body.addClass("is-hidden-frameless");
  }
}
