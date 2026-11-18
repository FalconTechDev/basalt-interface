// Mobile shell pieces: the tab-switcher item and switcher, the bottom toolbar, the
// share-intent handler and the audio recorder plugin.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { floatOr, ellipsize } from "./text.js";
import { lastSegment, baseName, extensionOf } from "./path.js";
import { runTransition } from "./animation.js";
import { s13AudioMime } from "./s13-consts.js";

// Cross-factory class references; only touched from method bodies at runtime.
let S13MobileTabItem = null;

const s13Div = (...args) => env().createDiv(...args);
const i18nMobile = () => env().gm.interface.mobile;

/** One tab preview tile inside the mobile tab switcher. */
export function defineS13MobileTabItem(host) {
  function MobileTabItem(leaf, switcher) {
    const self = this;
    this.app = leaf.app;
    this.leaf = leaf;
    this.switcher = switcher;
    this.containerEl = s13Div("mobile-tab", (el) => {
      const preview = el.createDiv("mobile-tab-preview");
      const pin = preview.createDiv("mobile-tab-pin", (pinEl) => {
        host.setIcon(pinEl, "lucide-pin");
        pinEl.addEventListener("click", (event) => {
          event.preventDefault();
          self.leaf.setPinned(false);
        });
      });
      const close = preview.createDiv("close-button", (closeEl) => {
        host.setIcon(closeEl, "lucide-x");
        closeEl.addEventListener("click", (event) => {
          event.preventDefault();
          self.containerEl.detach();
          self.leaf.detach();
        });
      });
      pin.toggle(leaf.pinned);
      close.toggle(!leaf.pinned);
      leaf.on("pinned-change", () => {
        pin.toggle(self.leaf.pinned);
        close.toggle(!self.leaf.pinned);
      });
      self.previewImgEl = preview.createEl("img", "mobile-tab-preview-embed");
      host.setIcon(self.placeholderEl = preview.createDiv("mobile-tab-preview-empty"), leaf.getIcon());
      self.previewImgEl.src = switcher.cacheDir + "leaf-" + leaf.id + ".png?" + Date.now();
      self.previewImgEl.addEventListener("error", () => self.togglePlaceholder(true));
      self.previewImgEl.addEventListener("load", () => self.togglePlaceholder(leaf.view instanceof host.EmptyView));
      self.titleEl = el.createDiv({ cls: "mobile-tab-title", text: leaf.getDisplayText() });
      el.addEventListener("click", (event) => {
        if (!event.defaultPrevented) {
          event.preventDefault();
          self.onClick();
        }
      });
      el.addEventListener("contextmenu", (event) => {
        if (!event.defaultPrevented) {
          event.preventDefault();
          leaf.onOpenTabHeaderMenu(event, el);
        }
      });
    });
  }

  MobileTabItem.prototype.togglePlaceholder = function (show) {
    this.placeholderEl.toggle(show);
    this.previewImgEl.toggle(!show);
  };

  MobileTabItem.prototype.onClick = function () {
    this.app.workspace.setActiveLeaf(this.leaf);
    this.switcher.hide();
  };

  MobileTabItem.prototype.render = function () {
    const el = this.containerEl;
    const leaf = this.leaf;
    el.removeClass("is-active");
    this.titleEl.setText(leaf.getDisplayText());
  };

  S13MobileTabItem = MobileTabItem;
  return MobileTabItem;
}

/** Full-screen overlay listing open tabs with live screenshot previews. */
export function defineS13TabSwitcher(host) {
  function TabSwitcher(app) {
    const self = this;
    this.cacheDir = "";
    this.tabPreviewLookup = new WeakMap();
    this.isVisible = false;
    this.requestRender = debounceCall(() => self.render(), 100);
    this.app = app;
    this.containerEl = s13Div("mobile-tab-switcher");
    this.scrollEl = this.containerEl.createDiv("mobile-tab-switcher-scroll");
    this.innerScrollEl = this.scrollEl.createDiv("mobile-tab-switcher-inner-scroll");
    const menuBar = this.menuBarEl = this.containerEl.createDiv("mobile-tab-switcher-menubar");
    menuBar.createDiv("mobile-tab-switcher-menu-spacer", (el) => {
      el.createDiv({ cls: "clickable-icon" }, (icon) => {
        host.setIcon(icon, "lucide-plus");
        icon.addEventListener("click", () => {
          app.commands.executeCommandById("workspace:new-tab");
          self.hide();
        });
      });
    });
    menuBar.createDiv({ cls: "mobile-tab-switcher-menu-button tappable" }, (el) => {
      self.tabCountEl = el.createSpan();
      host.setIcon(el.createSpan("mobile-tab-switcher-menu-button-chevron"), "lucide-chevron-down");
    }).addEventListener("click", (event) => self.showTabManagementMenu(event));
    menuBar.createDiv("mobile-tab-switcher-menu-spacer", (el) => {
      el.createDiv({ cls: "clickable-icon", text: env().gm.dialogue.buttonDone() }, (done) => {
        done.addEventListener("click", () => self.hide());
      });
    });
    this.setupCacheDir();
    if (host.Platform.isMobileApp && env().xm) {
      env().xm.addListener("screenshotSaved", (event) => {
        const uri = host.s13CapacitorModule.Ii.convertFileSrc(event.uri);
        const images = self.innerScrollEl.findAll("img");
        for (const img of images) {
          if (img.src.startsWith(uri)) {
            img.src = uri + "?" + Date.now();
            return;
          }
        }
      });
    }
    app.workspace.on("layout-change", this.onLayoutChange, this);
  }

  TabSwitcher.prototype.onLayoutChange = function () {
    if (this.isVisible) this.requestRender();
  };

  TabSwitcher.prototype.setupCacheDir = async function () {
    const app = this.app;
    if (host.Platform.isMobileApp && env().Dm) {
      const result = await env().Dm.getUri({
        path: app.appId + "/tab-preview",
        directory: host.s13CapacitorDirectory.Cache,
      });
      this.cacheDir = host.s13CapacitorModule.Ii.convertFileSrc(result.uri);
      if (!this.cacheDir.endsWith("/")) this.cacheDir += "/";
    }
  };

  TabSwitcher.prototype.render = function () {
    const self = this;
    const app = this.app;
    const lookup = this.tabPreviewLookup;
    let count = 0;
    app.workspace.iterateRootLeaves(() => { count++; });
    const renderGroup = (group) => {
      const container = self.innerScrollEl.createDiv("mobile-tab-group-container");
      for (const child of group.children) {
        const wrapper = container.createDiv("mobile-tab-wrapper");
        let item = lookup.get(child);
        if (item == null) {
          item = new S13MobileTabItem(child, self);
          lookup.set(child, item);
        }
        item.render();
        wrapper.append(item.containerEl);
      }
      return container;
    };
    const groups = [];
    const walk = (split) => {
      for (const child of split.children) {
        if (child instanceof host.WorkspaceTabs) groups.push(renderGroup(child));
        else if (child instanceof host.WorkspaceSplit) walk(child);
      }
    };
    walk(app.workspace.rootSplit);
    this.innerScrollEl.setChildrenInPlace(groups);
    this.tabCountEl.setText(env().gm.nouns.tabsWithCount({ count }));
    const active = app.workspace.getMostRecentLeaf();
    if (active) {
      const item = this.tabPreviewLookup.get(active);
      if (item != null) item.containerEl.addClass("is-active");
    }
  };

  TabSwitcher.prototype.show = async function () {
    this.isVisible = true;
    host.s13OverlayPush(this);
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (leaf && host.Platform.isMobileApp && env().xm) {
      const view = leaf.view;
      let target = view.containerEl;
      if (view instanceof host.ItemView && view.contentEl.isShown()) target = view.contentEl;
      document.body.addClass("is-screenshotting");
      await env().sleep(16);
      setTimeout(() => document.body.removeClass("is-screenshotting"), 100);
      const rect = target.getBoundingClientRect();
      const shotRect = rect.width > 0 && rect.height > 0
        ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        : undefined;
      try {
        await env().xm.takeScreenshot({
          path: this.app.appId + "/tab-preview/leaf-" + leaf.id + ".png",
          rect: shotRect,
        });
      } catch (error) {
        console.error(error);
      }
    }
    this.render();
    document.body.appendChild(this.containerEl);
    const active = this.app.workspace.getMostRecentLeaf();
    if (active) {
      this.tabPreviewLookup.get(active)?.containerEl.scrollIntoView({ block: "nearest" });
    }
    runTransition(this.containerEl, new host.Transition({ duration: 90, fn: "var(--anim-motion-swing)" })
      .addProp("opacity", "0", "1", "")
      .addProp("transform", "scale(1.1)", "scale(1)", ""));
  };

  TabSwitcher.prototype.showTabManagementMenu = function (event) {
    const self = this;
    const menu = host.Menu.forEvent(event);
    menu.addSections(["open", "danger"]);
    menu.addItem((item) => item.setTitle(env().gm.commands.newTab()).setIcon("lucide-plus").setSection("open").onClick(() => {
      self.app.commands.executeCommandById("workspace:new-tab");
    })).addItem((item) => item.setTitle(env().gm.commands.undoCloseTab()).setSection("open").setIcon("lucide-undo-2").setDisabled(!self.app.workspace.hasUndoHistory()).onClick(() => {
      self.app.commands.executeCommandById("workspace:undo-close-pane");
    }));
    const leaf = this.app.workspace.getMostRecentLeaf();
    const siblings = leaf ? leaf.parent.children.slice() : [];
    if (siblings.length > 1) {
      menu.addItem((item) => item.setTitle(env().gm.interface.menu.closeTabsWithCount({ count: siblings.length })).setIcon("lucide-archive-x").setDisabled(!leaf).setSection("danger").setWarning(true).onClick(() => {
        if (leaf) for (const sibling of siblings) sibling.detach();
      }));
    }
    if (!this.isVisible) {
      menu.addItem((item) => item.setTitle(env().gm.interface.menu.close()).setSection("danger").setDisabled(!leaf).setWarning(true).setIcon("lucide-x").onClick(() => {
        leaf?.detach();
      }));
    }
  };

  TabSwitcher.prototype.hide = function () {
    const el = this.containerEl;
    this.isVisible = false;
    host.s13OverlayPop(this);
    runTransition(el, new host.Transition({ duration: 90, fn: host.s13EaseStandard })
      .addProp("opacity", "1", "0", "")
      .addProp("transform", "scale(1)", "scale(1.1)", ""), () => el.detach());
  };

  TabSwitcher.prototype.close = function () {
    this.hide();
  };

  return TabSwitcher;
}

/** The floating bottom toolbar shown on mobile while editing. */
export function defineS13MobileToolbar(host) {
  function MobileToolbar(app) {
    const self = this;
    this.isVisible = false;
    this.lastKeyboardHeight = 0;
    this.hasKeyboardVisible = false;
    this.isMultiWindowMode = false;
    this.lastCommandIds = "";
    this.app = app;
    this.spacerEl = s13Div("mobile-toolbar-spacer");
    const wrapperEl = this.wrapperEl = s13Div("mobile-toolbar");
    const containerEl = this.containerEl = wrapperEl.createDiv("mobile-toolbar-options-container");
    const listWrap = this.optionsContainerListEl = containerEl.createDiv("mobile-toolbar-options-list-container mod-raised");
    this.optionsListEl = listWrap.createDiv("mobile-toolbar-options-list");
    if (host.Platform.isIosApp && host.Platform.isMobile) {
      containerEl.createDiv("mobile-toolbar-floating-options mod-raised", (el) => {
        el.createDiv("mobile-toolbar-option", (option) => {
          host.setIcon(option, "keyboard-toggle");
          option.addEventListener("mousedown", (event) => event.preventDefault());
          option.addEventListener("click", (event) => {
            app.commands.executeCommandById("editor:toggle-keyboard", event);
            event.preventDefault();
          });
        });
      });
    }
    this.update = debounceCall(this.update.bind(this), 0, true);
    window.addEventListener("keyboardWillHide", (event) => {
      self.animateToKeyboardHeight();
      if (!event.hasPhysicalKeyboard) {
        self.hasKeyboardVisible = false;
        if (host.Platform.isAndroidApp) self.update();
      }
    });
    window.addEventListener("keyboardWillShow", () => {
      self.animateToKeyboardHeight();
      self.hasKeyboardVisible = true;
      if (host.Platform.isAndroidApp) self.update();
    });
    window.addEventListener("focusout", () => self.update());
    window.addEventListener("focusin", () => self.update());
    if (host.Platform.isAndroidApp) {
      window.addEventListener("multiWindowModeChanged", (event) => {
        self.isMultiWindowMode = event.isMultiWindowMode;
        self.update();
      });
      if (env().Im) {
        env().Im.isMultiWindowMode().then((result) => {
          self.isMultiWindowMode = result.isMultiWindowMode;
          self.update();
        });
      }
    }
  }

  MobileToolbar.prototype.compileToolbar = function () {
    const app = this.app;
    const listEl = this.optionsListEl;
    const commands = app.vault.getConfig("mobileToolbarCommands");
    const serialized = JSON.stringify(commands);
    if (serialized === this.lastCommandIds) return;
    listEl.empty();
    const registry = app.commands;
    for (const id of commands) {
      const command = registry.findCommand(id);
      if (!command) continue;
      listEl.createDiv("mobile-toolbar-option", (option) => {
        const icon = command.icon || "question-mark-glyph";
        host.setIcon(option, icon);
        option.addEventListener("click", (event) => {
          registry.executeCommandById(id, event);
          event.preventDefault();
        });
        option.addEventListener("mousedown", (event) => event.preventDefault());
      });
    }
    this.lastCommandIds = serialized;
  };

  MobileToolbar.prototype.update = function () {
    this.lastKeyboardHeight = floatOr(getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height"), 0);
    const app = this.app;
    const visible = this.isVisible;
    let editing = app.workspace.activeEditor?.editor.hasFocus();
    if (host.Platform.isAndroidApp && editing) {
      editing = this.hasKeyboardVisible || this.isMultiWindowMode;
    }
    if (editing) {
      if (!visible) this.show();
    } else if (visible) {
      this.hide();
    }
  };

  MobileToolbar.prototype.animateToKeyboardHeight = function () {
    if (!this.isVisible) return;
    const el = this.wrapperEl;
    const height = floatOr(getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height"), 0);
    const delta = height - this.lastKeyboardHeight + "px";
    this.lastKeyboardHeight = height;
    if (host.Platform.isIosApp) {
      runTransition(el, new host.Transition({ duration: 300, fn: "cubic-bezier(.12,0,.44,.99)" })
        .addProp("transform", "translateY(" + delta + ")", ""));
    }
    if (host.Platform.isAndroidApp) {
      runTransition(el, new host.Transition({ duration: 350, fn: "cubic-bezier(.22,.25,0,1)" })
        .addProp("transform", "translateY(" + delta + ")", ""));
    }
  };

  MobileToolbar.prototype.show = function () {
    if (this.app.vault.getConfig("mobileToolbarCommands").length === 0) {
      this.hide();
      return;
    }
    this.app.mobileNavbar.hide();
    if (this.isVisible) return;
    this.isVisible = true;
    this.compileToolbar();
    const app = this.app;
    app.dom.appContainerEl.appendChild(this.spacerEl);
    app.dom.appContainerEl.appendChild(this.wrapperEl);
    document.body.addClass("mod-toolbar-open");
  };

  MobileToolbar.prototype.hide = function () {
    this.isVisible = false;
    this.spacerEl.detach();
    this.wrapperEl.detach();
    this.app.mobileNavbar.show();
    document.body.removeClass("mod-toolbar-open");
  };

  return MobileToolbar;
}

/** Handles content shared into the app from other apps (mobile share sheet). */
export function defineS13ShareIntent(host) {
  function ShareIntent(app) {
    this.app = app;
  }

  ShareIntent.prototype.setupNative = function () {
    const self = this;
    if (env().Em && env().xm) {
      env().xm.addListener("appShareIntent", async (intent) => {
        env().Lv();
        if (intent.type === "text") await self.handleShareText(intent.text);
        else if (intent.type === "files") await self.handleShareFiles(intent.files);
      });
    }
  };

  ShareIntent.prototype.setupWorkspace = function () {
    const app = this.app;
    const workspace = app.workspace;
    workspace.on("receive-text-menu", (menu, text) => {
      const view = workspace.getActiveViewOfType(host.MarkdownView);
      if (!view) return;
      menu.addItem((item) => item.setSection("options").setTitle(i18nMobile().actionInsertTextIntoFile({ filename: view.file.basename })).setIcon("lucide-file").onClick(() => {
        const insert = "\n" + text + "\n";
        if (view.getMode() === "preview") app.fileManager.insertIntoFile(view.file, insert);
        else view.editor.insertText(insert);
      }));
      menu.addItem((item) => item.setSection("options").setTitle(i18nMobile().actionChooseFileToInsert()).setIcon("lucide-navigation").onClick(() => {
        new host.s13FilePickerModal(app, text).open();
      }));
    });
    workspace.on("receive-files-menu", (menu, files) => {
      const view = workspace.getActiveViewOfType(host.MarkdownView);
      if (!view) return;
      menu.addItem((item) => item.setTitle(i18nMobile().actionInsertLinkIntoFile({ filename: view.file.basename })).setIcon("lucide-file").onClick(() => {
        const links = files.map((file) => {
          const link = app.fileManager.generateMarkdownLink(file, view.file.path);
          return host.s13IsMediaFile(file.extension) ? "!" + link : link;
        });
        view.editor.insertText("\n" + links.join("\n") + "\n");
      }));
    });
  };

  ShareIntent.prototype.handleShareText = async function (text) {
    const menu = new host.Menu().addSections(["title", "options", "danger"])
      .addItem((item) => item.setSection("title").setTitle(ellipsize(text, 300)).setIcon("lucide-list-end").setIsLabel(true).titleEl.addClass("u-muted", "u-small"))
      .addItem((item) => item.setSection("options").setTitle(i18nMobile().actionInsertTextDesc()).removeIcon().setIsLabel(true).titleEl.addClass("u-muted", "u-small"));
    this.app.workspace.trigger("receive-text-menu", menu, text);
    menu.addItem((item) => item.setSection("danger").setTitle(env().gm.dialogue.buttonCancel()).setIcon("lucide-x").onClick(() => null))
      .showAtPosition({ x: 0, y: 0 });
  };

  ShareIntent.prototype.handleShareFiles = async function (files) {
    const self = this;
    new host.Menu()
      .addItem((item) => item.setTitle(env().createFragment((frag) => {
        for (const file of files) frag.createDiv({ text: file.name });
      })).removeIcon().setIsLabel(true).titleEl.addClass("u-muted", "u-small"))
      .addSeparator()
      .addItem((item) => item.setTitle(i18nMobile().actionImport()).setIcon("lucide-files").onClick(() => self.importFiles(files)))
      .addItem((item) => item.setTitle(env().gm.dialogue.buttonCancel()).setIcon("lucide-x").onClick(() => null))
      .showAtPosition({ x: 0, y: 0 });
  };

  ShareIntent.prototype.importFiles = async function (files) {
    const imported = [];
    const notice = new host.Notice(i18nMobile().msgImporting(), 0);
    let done = 0;
    const vault = this.app.vault;
    for (const file of files) {
      try {
        if (files.length > 1) notice.setMessage(i18nMobile().msgImporting() + " (" + done + "/" + files.length + ")");
        const response = await fetch(host.s13CapacitorModule.Ii.convertFileSrc(file.uri));
        const buffer = await response.arrayBuffer();
        const name = file.name || lastSegment(file.uri);
        const base = baseName(name);
        const ext = extensionOf(name);
        let path;
        if (ext === "md") {
          path = vault.getAvailablePath(base, ext);
        } else {
          path = await vault.getAvailablePathForAttachments(base, ext, this.app.workspace.getActiveFile());
        }
        const created = await vault.createBinary(path, buffer);
        imported.push(created);
        done++;
      } catch (error) {
        notice.hide();
        new host.Notice(i18nMobile().msgFailedToImportFile({ filename: file.name }));
        new host.Notice(ellipsize(error.toString(), 100));
        return;
      }
    }
    notice.hide();
    const menu = new host.Menu()
      .addItem((item) => item.setTitle(i18nMobile().msgImportSuccess()).removeIcon().setIsLabel(true))
      .addSeparator();
    menu.addItem((item) => item.setTitle(env().gm.dialogue.buttonDone()).setIcon("lucide-check").onClick(() => null));
    this.app.workspace.trigger("receive-files-menu", menu, imported);
    menu.showAtPosition({ x: 0, y: 0 });
  };

  return ShareIntent;
}

/** Records microphone audio and saves it as a note attachment. */
export function defineS13AudioRecorder(host) {
  function AudioRecorder() {
    this.id = "audio-recorder";
    this.name = env().gm.plugins.audioRecorder.name();
    this.description = env().gm.plugins.audioRecorder.desc();
    this.app = null;
    this.plugin = null;
    this.recording = false;
    this.recorder = null;
    this.extension = "";
  }

  AudioRecorder.prototype.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerRibbonItem(env().gm.plugins.audioRecorder.actionToggle(), "lucide-mic", this.onRecordAudio.bind(this));
    plugin.registerGlobalCommand({
      id: "audio-recorder:start",
      name: env().gm.plugins.audioRecorder.actionStart(),
      icon: "lucide-play-circle",
      checkCallback: (checking) => {
        if (this.recording) return false;
        if (!checking) this.onStartRecording();
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "audio-recorder:stop",
      name: env().gm.plugins.audioRecorder.actionStop(),
      icon: "lucide-stop-circle",
      checkCallback: (checking) => {
        if (!this.recording) return false;
        if (!checking) this.onStopRecording();
        return true;
      },
    });
  };

  AudioRecorder.prototype.checkPermission = async function () {
    if (host.Platform.isDesktopApp && host.s13PlatformOs === "macOS") {
      const electron = env().If("electron");
      if (!electron) {
        this.showRecordingMessage(env().gm.plugins.audioRecorder.msgAccessDenied(), true);
        return false;
      }
      const prefs = electron.remote.systemPreferences;
      const status = prefs.getMediaAccessStatus("microphone");
      if (["denied", "restricted", "unknown"].includes(status)) {
        this.showRecordingMessage(env().gm.plugins.audioRecorder.msgAccessDenied(), true);
        return false;
      }
      if (status === "not-determined") {
        this.showRecordingMessage(env().gm.plugins.audioRecorder.msgPendingGrant(), false);
        return await prefs.askForMediaAccess("microphone");
      }
      return status === "granted";
    }
    return true;
  };

  AudioRecorder.prototype.onRecordAudio = async function () {
    if (!(await this.checkPermission())) return;
    if (this.recording) this.onStopRecording();
    else await this.onStartRecording();
  };

  AudioRecorder.prototype.onStartRecording = async function () {
    if (host.s13IsIos && !navigator.mediaDevices) {
      new host.Notice("This functionality requires iOS 14.5.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      await this.startRecording(stream);
    } catch (error) {
      if (error.message.includes("Requested device not found") && this.plugin.addedButtonEls.length > 0) {
        const message = env().gm.plugins.audioRecorder.msgNoMicrophone();
        this.showRecordingMessage(message, true);
      } else {
        if (error.message.includes("denied")) new host.Notice(error.message);
        console.error(error);
      }
      return;
    }
    this.recording = true;
    this.plugin.addedButtonEls.forEach((el) => {
      host.setIcon(el, "lucide-mic");
      el.addClass("is-active");
    });
  };

  AudioRecorder.prototype.onStopRecording = function () {
    this.recording = false;
    this.recorder.stop();
    this.plugin.addedButtonEls.forEach((el) => el.removeClass("is-active"));
  };

  AudioRecorder.prototype.startRecording = function (stream) {
    const self = this;
    const chunks = [];
    let mime = 'audio/webm;codecs="opus"';
    this.extension = "webm";
    if (MediaRecorder.isTypeSupported(s13AudioMime)) {
      mime = s13AudioMime;
      this.extension = "m4a";
    }
    this.recorder = new MediaRecorder(stream, { mimeType: mime });
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    this.recorder.addEventListener("stop", async () => {
      this.recorder = null;
      stream.getTracks().forEach((track) => track.stop());
      let blob = new Blob(chunks, { type: mime });
      if (this.extension === "webm") {
        try {
          blob = await host.s13AudioConverter()(blob);
        } catch (error) {
          console.error(error);
        }
      }
      const buffer = await blob.arrayBuffer();
      await self.saveRecording(buffer);
      keepAwake?.release();
    });
    this.recorder.start();
    let keepAwake = null;
    if (env().Em) keepAwake = host.s13KeepAwake();
  };

  AudioRecorder.prototype.saveRecording = async function (buffer) {
    const app = this.app;
    const workspace = app.workspace;
    const name = "Recording " + window.moment().format("YYYYMMDDHHmmss");
    const activeFile = workspace.getActiveFile();
    const view = workspace.getActiveViewOfType(host.MarkdownView);
    const path = await app.vault.getAvailablePathForAttachments(name, this.extension, activeFile);
    const file = await app.vault.createBinary(path, buffer);
    if (view) {
      const link = app.fileManager.generateMarkdownLink(file, view.file.path);
      view.editor.replaceSelection("\n!" + link + "\n");
    } else {
      await workspace.getUnpinnedLeaf().openFile(file, { active: true });
    }
  };

  AudioRecorder.prototype.showRecordingMessage = function (message, isError) {
    if (this.plugin.addedButtonEls.length > 0) {
      host.displayTooltip(this.plugin.addedButtonEls[0], message, {
        placement: "right",
        classes: isError ? ["mod-error"] : [],
      });
    }
  };

  return AudioRecorder;
}
