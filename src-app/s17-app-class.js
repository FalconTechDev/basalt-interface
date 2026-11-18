// Basalt app shell: constructor, mobile-emulation listeners, startup progress flow and the static
// config-dir lookup. The prototype methods themselves live in app.js and are attached below.
import { appNextFrame, appOnNextFrame, appNextFrameOnceCallback, appInitializeWithAdapter, appOnConfigChanged, appRegisterCommands, appDisableCssTransition, appEnableCssTransition, appGetAppTitle, appGetWebviewPartition, appFixFileLinks, appGetTheme, appIsDarkMode, appChangeTheme, appUpdateTheme, appUpdateMobileFrameTheme, appUpdateInlineTitleDisplay, appUpdateFloatingNavigationDisplay, appUpdateAutoFullScreenDisplay, appUpdateViewHeaderDisplay, appUpdateRibbonDisplay, appUpdateFontFamily, appUpdateFontSize, appUpdateUseNativeMenu, appUpdateTabSize, appShowReleaseNotes, appUpdateAccentColor, appGetAccentColor, appSetAccentColor, appGarbleText, appImportAttachments, appSaveAttachment, appOpenVaultChooser, appOpenHelp, appRunOpeningBehavior, appOpenWithDefaultApp, appShowInFolder, appGetObsidianUrl, appCopyObsidianUrl, appRegisterQuitHook, appLoadLocalStorage, appSaveLocalStorage, appOn, appSetTheme, appEmulateMobile, appDebugMode, appGetSpellcheckLanguages, appSetSpellcheckLanguages, appIsVimEnabled } from "./n-g15-app.js";

export const s17IframeAllowlist = {
  "encrypted-media": true,
  fullscreen: true,
  gamepad: true,
  hid: true,
  "idle-detection": true,
  "oversized-images": true,
  "picture-in-picture": true,
  "sync-xhr": true,
};

export const s17IframeSandbox = {
  "allow-forms": true,
  "allow-modals": true,
  "allow-popups": true,
  "allow-presentation": true,
  "allow-same-origin": true,
  "allow-scripts": true,
};

export const s17EmulateMobileKey = "EmulateMobile";
export const s17DebugModeKey = "DebugMode";

function s17TouchById(event, identifier) {
  const touches = event.changedTouches;
  for (let i = 0; i < touches.length; i++) if (touches[i].identifier === identifier) return touches[i];
  return null;
}

function s17StartupButtons(host, app, prominent) {
  const i18n = host.i18n.interface.startUp;
  return function (el) {
    el.createDiv("progress-bar-button-container", (box) => {
      const reloadAttrs = prominent ? { cls: "mod-cta", text: i18n.buttonReloadApp() } : { text: i18n.buttonReloadApp() };
      box.createEl("button", reloadAttrs, (button) => {
        button.onClickEvent(() => window.location.reload());
      });
      if (app.plugins && app.plugins.isEnabled()) {
        box.createEl("button", { cls: "mod-cta", text: i18n.buttonReloadAppInSafeMode() }, (button) => {
          button.onClickEvent(async () => {
            await app.plugins.setEnable(false);
            window.location.reload();
          });
        });
      }
      const vaultAttrs = prominent ? { cls: "mod-cta", text: i18n.buttonOpenAnotherVault() } : { text: i18n.buttonOpenAnotherVault() };
      box.createEl("button", vaultAttrs, (button) => {
        button.onClickEvent(() => app.openVaultChooser());
      });
    });
  };
}

async function s17Startup(host, app, adapter) {
  const overlay = host.progressOverlay;
  const splash = host.s17SplashScreen;
  const watchdog = setTimeout(() => {
    overlay.setContext(s17StartupButtons(host, app, false)).show();
  }, 20000);
  try {
    overlay.setMessage(host.i18n.interface.startUp.loadingObsidian()).show();
    await app.initializeWithAdapter(adapter);
    overlay.hide();
  } catch (error) {
    console.error(error);
    overlay
      .setMessage(host.i18n.interface.startUp.obsidianLoadError() + " " + (error ? error.toString() : "unknown"))
      .show();
    overlay.setContext(s17StartupButtons(host, app, true));
  } finally {
    clearTimeout(watchdog);
    if (host.Platform.isMobileApp && splash) {
      await window.nextFrame();
      splash.hide({ fadeOutDuration: 0 });
    }
  }
}

async function s17PersistStorage() {
  try {
    const storage = navigator.storage;
    if (storage && storage.persist) await storage.persist();
  } catch (error) {
    console.log("Failed to persist local storages");
  }
}

export function s17CreateApp(host) {
  const mobileTapSelector = "a, button, .tappable, .is-clickable, .clickable-icon, .text-icon-button, .suggestion-item";
  const mobileTapClass = "mobile-tap";

  function App(adapter, appId) {
    const platform = host.Platform;
    this.appMenuBarManager = null;
    this.embedRegistry = new host.s17EmbedRegistry();
    this.viewRegistry = new host.s17ViewRegistry();
    this.nextFrameEvents = [];
    this.nextFrameTimer = null;
    this.isMobile = false;
    this.mobileToolbar = null;
    this.mobileNavbar = null;
    this.mobileTabSwitcher = null;
    this.mobileQuickActions = null;
    this.lastEvent = null;
    console.log("%cBasalt Developer Console", "color:#7f6df2; font-size:40px; font-weight:bold;");

    const bodyEl = document.body;
    this.title = document.title;
    this.appId = appId;
    this.keymap = host.Keymap.init();
    this.scope = this.keymap.getRootScope();
    this.commands = new host.s17Commands(this);
    this.hotkeyManager = new host.s17HotkeyManager(this);
    this.dragManager = new host.s17DragManager(this);
    this.dom = new host.s17AppDom(bodyEl);
    this.customCss = new host.s17CustomCss(this);
    this.shareReceiver = new host.s17ShareReceiver(this);
    this.renderContext = new host.s17RenderContext(this);
    this.secretStorage = new host.SecretStorage(this);
    window.__bsApi = {
      ItemView: host.ItemView,
      Modal: host.Modal,
      Notice: host.Notice,
      Menu: host.Menu,
      setIcon: host.setIcon,
      Setting: host.Setting,
    };
    this.cli = new host.s17Cli(this);
    bodyEl.addClass("basalt-app");

    if (this.loadLocalStorage(s17DebugModeKey) === "1") {
      host.s17SetBasaltDebug(true);
      new host.Notice("Basalt debug mode enabled.");
      console.debug("[Basalt] Debug mode enabled. Run `app.debugMode(false)` to disable.");
    }

    if (!platform.isMobile && localStorage.getItem(s17EmulateMobileKey)) {
      platform.isMobile = true;
      platform.isDesktop = false;
      platform.hasPhysicalKeyboard = false;
      bodyEl.addClass("emulate-mobile");
    }
    if (platform.isMobile) {
      {
        let mobileTapEl = null;
        bodyEl.on("mouseover", mobileTapSelector, (event, target) => {
          if (host.pointerEntered(event, target) && !host.isTouchSyntheticMouse(event)) {
            if (mobileTapEl) mobileTapEl.removeClass(mobileTapClass);
            mobileTapEl = target;
            target.addClass(mobileTapClass);
          }
        });
        bodyEl.on("mouseout", mobileTapSelector, (event, target) => {
          if (!host.isTouchSyntheticMouse(event) && host.pointerEntered(event, target)) {
            if (mobileTapEl) mobileTapEl.removeClass(mobileTapClass);
          }
        });
        document.addEventListener(
          "touchstart",
          (event) => {
            if (event.touches.length !== 1) return;
            const targetNode = event.targetNode;
            let tapEl = null;
            if (targetNode.instanceOf(Element)) {
              tapEl = targetNode.matchParent(mobileTapSelector) || (targetNode.instanceOf(HTMLElement) ? targetNode : targetNode.parentElement);
            }
            if (!tapEl) return;
            const startedAt = event.timeStamp;
            const startTouch = event.touches[0];
            const identifier = startTouch.identifier;
            let fired = false;
            const showTimer = window.setTimeout(() => {
              if (!fired) tapEl.addClass(mobileTapClass);
            }, 10);
            const finish = (finishEvent) => {
              fired = true;
              removeListeners();
              const elapsed = finishEvent.timeStamp - startedAt;
              window.setTimeout(() => tapEl.removeClass(mobileTapClass), Math.max(10, 300 - elapsed));
            };
            const move = (moveEvent) => {
              const touch = s17TouchById(moveEvent, identifier);
              if (!touch || fired) return;
              const dx = touch.clientX - startTouch.clientX;
              const dy = touch.clientY - startTouch.clientY;
              if (dx * dx + dy * dy > 25) finish(moveEvent);
            };
            const end = (endEvent) => {
              for (let i = 0; i < endEvent.changedTouches.length; i++) {
                if (endEvent.changedTouches[i].identifier === identifier) {
                  finish(endEvent);
                  return;
                }
              }
            };
            const removeListeners = () => {
              document.removeEventListener("touchmove", move);
              document.removeEventListener("touchcancel", finish);
              document.removeEventListener("touchend", finish);
            };
            document.addEventListener("touchmove", move);
            document.addEventListener("touchcancel", finish);
            document.addEventListener("touchend", finish);
          },
          true
        );
      }

      if (window.frameDom) window.frameDom.titleBarEl.hide();

    const tabletQuery = window.matchMedia("(min-width: 600px) and (min-height: 600px)");
    const updateDeviceClass = () => {
      if (platform.mobileSoftKeyboardVisible) return;
      platform.isTablet = tabletQuery.matches;
      platform.isPhone = !tabletQuery.matches;
      document.body.toggleClass("is-tablet", platform.isTablet);
      document.body.toggleClass("is-phone", platform.isPhone);
    };
    tabletQuery.addEventListener("change", host.debounce(updateDeviceClass, 10));
      updateDeviceClass();
    }

    const keyboard = host.keyboard;
    if (keyboard) keyboard.hasPhysicalKeyboard().then((result) => { platform.hasPhysicalKeyboard = result.hasPhysicalKeyboard; });

    this.isMobile = platform.isMobile;
    if (platform.isMobile) bodyEl.addClass("is-mobile");
    if (!platform.isMacOS) document.body.addClass("styled-scrollbars");

    if (platform.isIosApp) {
      document.body.style["-webkit-touch-callout"] = "none";
      const win = window;
      win.addEventListener("touchstart", (event) => {
        if (event.touches.length > 1 || event.defaultPrevented) return;
        const touch = event.touches[0];
        const target = event.targetNode;
        const startX = touch.clientX;
        const startY = touch.clientY;
        const identifier = touch.identifier;
        let delay = 800;
        if (target instanceof Element && target.matchParent('[draggable="true"]')) delay = 1200;
        const timer = win.setTimeout(() => {
          cancel();
          target.dispatchEvent(
            new MouseEvent("contextmenu", {
              button: 0,
              buttons: 0,
              ctrlKey: event.ctrlKey,
              altKey: event.altKey,
              metaKey: event.metaKey,
              shiftKey: event.shiftKey,
              screenX: touch.screenX,
              screenY: touch.screenY,
              bubbles: true,
              cancelable: true,
              clientX: startX,
              clientY: startY,
            })
          ) || navigator.vibrate(200);
        }, delay);
        const cancel = () => {
          win.removeEventListener("touchcancel", onEnd, true);
          win.removeEventListener("touchend", onEnd, true);
          win.removeEventListener("touchmove", onMove, true);
          win.removeEventListener("dragstart", onDrag, true);
          win.clearTimeout(timer);
          host.s17SetTouchCancel(null);
        };
        const onMove = (moveEvent) => {
          for (let i = 0; i < moveEvent.changedTouches.length; i++) {
            const changed = moveEvent.changedTouches[i];
            if (changed.identifier !== identifier) continue;
            const dx = changed.clientX - startX;
            const dy = changed.clientY - startY;
            if (dx * dx + dy * dy > 25) cancel();
            return;
          }
        };
        const onEnd = (endEvent) => {
          for (let i = 0; i < endEvent.changedTouches.length; i++) {
            if (endEvent.changedTouches[i].identifier === identifier) {
              cancel();
              return;
            }
          }
        };
        const onDrag = (dragEvent) => {
          const dragTarget = dragEvent.targetNode;
          if (dragTarget && (dragTarget === target || dragTarget.contains(target))) cancel();
        };
        win.addEventListener("touchcancel", onEnd, true);
        win.addEventListener("touchend", onEnd, true);
        win.addEventListener("touchmove", onMove, true);
        win.addEventListener("dragstart", onDrag, true);
        host.s17SetTouchCancel(cancel);
      });
    }

    if (window.ServiceWorkerContainer) {
      window.ServiceWorkerContainer.prototype.register = function () {
        return new Promise(() => {});
      };
    }

    s17Startup(host, this, adapter);
    s17PersistStorage();
  }

  function getOverrideConfigDir(appId) {
    const dir = localStorage.getItem(appId + "-config");
    return typeof dir === "string" ? dir : null;
  }

  App.getOverrideConfigDir = getOverrideConfigDir;
  App.prototype.nextFrame = appNextFrame;
  App.prototype.onNextFrame = appOnNextFrame;
  App.prototype.nextFrameOnceCallback = appNextFrameOnceCallback;
  App.prototype.initializeWithAdapter = appInitializeWithAdapter;
  App.prototype.onConfigChanged = appOnConfigChanged;
  App.prototype.registerCommands = appRegisterCommands;
  App.prototype.disableCssTransition = appDisableCssTransition;
  App.prototype.enableCssTransition = appEnableCssTransition;
  App.prototype.getAppTitle = appGetAppTitle;
  App.prototype.getWebviewPartition = appGetWebviewPartition;
  App.prototype.fixFileLinks = appFixFileLinks;
  App.prototype.getTheme = appGetTheme;
  App.prototype.isDarkMode = appIsDarkMode;
  App.prototype.changeTheme = appChangeTheme;
  App.prototype.updateTheme = appUpdateTheme;
  App.prototype.updateMobileFrameTheme = appUpdateMobileFrameTheme;
  App.prototype.updateInlineTitleDisplay = appUpdateInlineTitleDisplay;
  App.prototype.updateFloatingNavigationDisplay = appUpdateFloatingNavigationDisplay;
  App.prototype.updateAutoFullScreenDisplay = appUpdateAutoFullScreenDisplay;
  App.prototype.updateViewHeaderDisplay = appUpdateViewHeaderDisplay;
  App.prototype.updateRibbonDisplay = appUpdateRibbonDisplay;
  App.prototype.updateFontFamily = appUpdateFontFamily;
  App.prototype.updateFontSize = appUpdateFontSize;
  App.prototype.updateUseNativeMenu = appUpdateUseNativeMenu;
  App.prototype.updateTabSize = appUpdateTabSize;
  App.prototype.showReleaseNotes = appShowReleaseNotes;
  App.prototype.updateAccentColor = appUpdateAccentColor;
  App.prototype.getAccentColor = appGetAccentColor;
  App.prototype.setAccentColor = appSetAccentColor;
  App.prototype.garbleText = appGarbleText;
  App.prototype.importAttachments = appImportAttachments;
  App.prototype.saveAttachment = appSaveAttachment;
  App.prototype.openVaultChooser = appOpenVaultChooser;
  App.prototype.openHelp = appOpenHelp;
  App.prototype.runOpeningBehavior = appRunOpeningBehavior;
  App.prototype.openWithDefaultApp = appOpenWithDefaultApp;
  App.prototype.showInFolder = appShowInFolder;
  App.prototype.getObsidianUrl = appGetObsidianUrl;
  App.prototype.copyObsidianUrl = appCopyObsidianUrl;
  App.prototype.registerQuitHook = appRegisterQuitHook;
  App.prototype.loadLocalStorage = appLoadLocalStorage;
  App.prototype.saveLocalStorage = appSaveLocalStorage;
  App.prototype.on = appOn;
  App.prototype.setTheme = appSetTheme;
  App.prototype.emulateMobile = appEmulateMobile;
  App.prototype.debugMode = appDebugMode;
  App.prototype.getSpellcheckLanguages = appGetSpellcheckLanguages;
  App.prototype.setSpellcheckLanguages = appSetSpellcheckLanguages;
  App.prototype.isVimEnabled = appIsVimEnabled;

  return App;
}
