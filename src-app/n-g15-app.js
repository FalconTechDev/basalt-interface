// g15 clean-room app methods: frame scheduling, CSS transitions, theme/appearance, local storage,
// attachments, OS integration, quit hook, startup (initializeWithAdapter) and the built-in command
// registry. Attached to the App prototype by s17-app-class.js; `this` is the app instance.
import { env } from "./env.js";
import { debounceCall } from "./timing.js";
import { stringCollator } from "./misc.js";

// =====================================================================================================================
// Frame scheduling
// =====================================================================================================================

export function appNextFrame(callback) {
  this.nextFrameEvents.push(callback);
  if (this.nextFrameTimer === null) {
    this.nextFrameTimer = requestAnimationFrame((ts) => this.onNextFrame(ts));
  }
}

export function appOnNextFrame(timestamp) {
  this.nextFrameTimer = null;
  const events = this.nextFrameEvents;
  this.nextFrameEvents = [];
  for (const cb of events) {
    try { cb(timestamp); } catch (e) { console.error(e); }
  }
}

/** Returns a callback that schedules `callback` on the next frame; safe to call repeatedly. */
export function appNextFrameOnceCallback(callback) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    this.nextFrame(() => callback(...args));
  };
}

// =====================================================================================================================
// CSS transitions
// =====================================================================================================================

export function appDisableCssTransition() {
  const el = this.dom && this.dom.appContainerEl;
  if (el) el.addClass("no-transition");
}

export function appEnableCssTransition() {
  const el = this.dom && this.dom.appContainerEl;
  if (el) el.removeClass("no-transition");
}

// =====================================================================================================================
// Title / partition / links
// =====================================================================================================================

export function appGetAppTitle(suffix) {
  return suffix ? suffix + " - " + this.title : this.title;
}

export function appGetWebviewPartition() {
  return "persist:vault-" + this.appId;
}

/** Rewrites media/file URLs under `element` so vault files resolve through the resource endpoint. */
export function appFixFileLinks(element, sourcePath) {
  if (!element || !this.vault) return;
  const fix = (el, attr) => {
    const value = el.getAttribute(attr);
    if (!value) return;
    const file = this.vault.resolveFileUrl ? this.vault.resolveFileUrl(value) : null;
    if (file) el.setAttribute(attr, this.vault.getResourcePath(file));
  };
  for (const el of element.findAll ? element.findAll("img,video,audio,source") : []) {
    fix(el, "src");
    fix(el, "href");
  }
  void sourcePath;
}

// =====================================================================================================================
// Theme
// =====================================================================================================================

export function appIsDarkMode() {
  if (this.customCss && this.customCss.isDarkMode) return this.customCss.isDarkMode();
  return document.body.classList.contains("theme-dark");
}

export function appGetTheme() {
  return this.isDarkMode() ? "basalt" : "moonstone";
}

export function appChangeTheme(theme) {
  if (!theme) return;
  this.disableCssTransition();
  this.vault.setConfig("theme", theme);
  setTimeout(() => this.enableCssTransition(), 200);
}

export function appUpdateMobileFrameTheme(dark) {
  if (!this.isMobile) return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#1e1e1e" : "#ffffff");
  if (this.mobileNavbar && this.mobileNavbar.setDarkMode) this.mobileNavbar.setDarkMode(dark);
}

function ng15SystemDark() {
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return true;
  } catch (e) {}
  const electron = env().electron;
  if (electron && electron.remote && electron.remote.nativeTheme) {
    try { return electron.remote.nativeTheme.shouldUseDarkColors; } catch (e) {}
  }
  return false;
}

export function appUpdateTheme() {
  const theme = this.vault ? this.vault.getConfig("theme") : "";
  let dark;
  if (theme === "basalt") dark = true;
  else if (theme === "moonstone") dark = false;
  else dark = ng15SystemDark();
  document.body.classList.toggle("theme-dark", dark);
  document.body.classList.toggle("theme-light", !dark);
  this.updateMobileFrameTheme(dark);
  if (this.customCss && this.customCss.reloadTheme) this.customCss.reloadTheme();
}

export function appSetTheme() {
  setTimeout(() => this.updateTheme(), 0);
}

// =====================================================================================================================
// Appearance updates (body classes + CSS variables)
// =====================================================================================================================

export function appUpdateInlineTitleDisplay() {
  document.body.classList.toggle("show-inline-title", !!this.vault.getConfig("showInlineTitle"));
}

export function appUpdateFloatingNavigationDisplay() {
  document.body.classList.toggle("is-floating-nav", !!this.vault.getConfig("floatingNavigation"));
}

export function appUpdateAutoFullScreenDisplay() {
  document.body.classList.toggle("auto-full-screen", !!this.vault.getConfig("autoFullScreen"));
}

export function appUpdateViewHeaderDisplay() {
  document.body.classList.toggle("show-view-header", !!this.vault.getConfig("showViewHeader"));
}

export function appUpdateRibbonDisplay() {
  document.body.classList.toggle("show-ribbon", !!this.vault.getConfig("showRibbon"));
  if (this.workspace && this.workspace.updateFrameless) this.workspace.updateFrameless();
}

export function appUpdateFontFamily() {
  const cfg = (k) => this.vault.getConfig(k);
  const body = document.body.style;
  const set = (name, value) => { if (value) body.setProperty(name, '"' + value + '"'); else body.removeProperty(name); };
  set("--font-interface-override", cfg("interfaceFontFamily"));
  set("--font-text-override", cfg("textFontFamily"));
  set("--font-monospace-override", cfg("monospaceFontFamily"));
  set("--font-print-override", cfg("textFontFamily"));
  this.workspace && this.workspace.trigger("css-change");
}

export function appUpdateFontSize() {
  let size = parseFloat(this.vault.getConfig("baseFontSize"));
  if (!Number.isFinite(size)) size = 16;
  size = Math.min(30, Math.max(10, size));
  const px = size + "px";
  document.body.style.setProperty("--font-text-size", px);
  document.documentElement.style.fontSize = px;
  this.workspace && this.workspace.trigger("css-change");
}

export function appUpdateUseNativeMenu() {
  const Menu = env().Ug;
  if (!Menu) return;
  let value = this.vault.getConfig("nativeMenus");
  if (value === null || value === undefined) value = true; // on macOS null means enabled
  Menu.useNativeMenu = !!value;
}

export function appUpdateTabSize() {
  const size = parseInt(this.vault.getConfig("tabSize"), 10);
  document.body.style.setProperty("--indent-size", String(Number.isFinite(size) ? size : 4));
}

export function appUpdateAccentColor() {
  this.setAccentColor(this.vault.getConfig("accentColor"));
}

export function appGetAccentColor() {
  const configured = this.vault.getConfig("accentColor");
  if (configured) return configured;
  const body = document.body.style;
  const h = body.getPropertyValue("--accent-h");
  const s = body.getPropertyValue("--accent-s");
  const l = body.getPropertyValue("--accent-l");
  if (h && s && l) return "hsl(" + h + ", " + s + ", " + l + ")";
  return "";
}

function ng15ParseColor(color) {
  if (!color || typeof color !== "string") return null;
  const c = color.trim();
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("");
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return ng15RgbToHsl(r, g, b);
  }
  m = c.match(/^hsl\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i);
  if (m) return { h: parseFloat(m[1]), s: parseFloat(m[2]) + "%", l: parseFloat(m[3]) + "%" };
  return null;
}

function ng15RgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: "0%", l: Math.round(l * 100) + "%" };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return { h: Math.round(h), s: Math.round(s * 100) + "%", l: Math.round(l * 100) + "%" };
}

export function appSetAccentColor(color) {
  const body = document.body.style;
  const parsed = ng15ParseColor(color);
  if (parsed) {
    body.setProperty("--accent-h", String(parsed.h));
    body.setProperty("--accent-s", parsed.s);
    body.setProperty("--accent-l", parsed.l);
    // text on accent: dark text on light accents, light text on dark accents
    const l = parseFloat(parsed.l);
    body.setProperty("--text-on-accent", l > 60 ? "#000000" : "#ffffff");
  } else {
    body.removeProperty("--accent-h");
    body.removeProperty("--accent-s");
    body.removeProperty("--accent-l");
    body.removeProperty("--text-on-accent");
  }
}

export function appGarbleText() {
  this.dom && this.dom.appContainerEl && this.dom.appContainerEl.addClass("is-text-garbled");
}

// =====================================================================================================================
// Release notes
// =====================================================================================================================

export function appShowReleaseNotes(version) {
  const state = { currentVersion: version || env().s0 || "" };
  this.workspace.openLinkText && this.workspace.openLinkText("", ""); // no-op guard
  const leaf = this.workspace.getLeaf("tab");
  if (leaf && leaf.setViewState) {
    leaf.setViewState({ type: this.releaseNotesType || "release-notes", state });
    this.workspace.revealLeaf(leaf);
    this.workspace.setActiveLeaf(leaf, { focus: true });
  }
}

// =====================================================================================================================
// Storage
// =====================================================================================================================

export function appLoadLocalStorage(key) {
  try {
    const raw = localStorage.getItem(this.appId + "-" + key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function appSaveLocalStorage(key, value) {
  const full = this.appId + "-" + key;
  if (value === null || value === undefined) {
    localStorage.removeItem(full);
    return;
  }
  try {
    localStorage.setItem(full, JSON.stringify(value));
  } catch (e) {}
}

export function appOn() {}

// =====================================================================================================================
// Spellcheck / vim / emulate / debug
// =====================================================================================================================

export function appGetSpellcheckLanguages() {
  const vault = this.vault;
  // one-time migration: vault config -> local storage
  if (vault && vault.getConfig) {
    const legacy = vault.getConfig("spellcheckLanguages");
    if (legacy !== undefined && legacy !== null) {
      try { vault.setConfig("spellcheckLanguages", undefined); } catch (e) {}
      try { vault.adapter && vault.adapter.remove && vault.adapter.remove(vault.getConfigFile("app")); } catch (e) {}
      this.saveLocalStorage("spellcheck-languages", legacy);
    }
  }
  const stored = this.loadLocalStorage("spellcheck-languages");
  return Array.isArray(stored) ? stored : [];
}

export function appSetSpellcheckLanguages(languages) {
  const vault = this.vault;
  if (vault && vault.setConfig) {
    try { vault.setConfig("spellcheckLanguages", undefined); } catch (e) {}
  }
  if (languages && languages.length > 0) this.saveLocalStorage("spellcheck-languages", languages);
  else localStorage.removeItem(this.appId + "-spellcheck-languages");
  // push to the desktop spellcheck integration when present
  const spell = null;
  
}

export function appIsVimEnabled() {
  if (this.isMobile) return localStorage.getItem("vim") === "1" || localStorage.getItem("vim") === "true";
  return !!(this.vault && this.vault.getConfig && this.vault.getConfig("vimMode"));
}

export function appEmulateMobile(enabled) {
  if (enabled) localStorage.setItem("EmulateMobile", "1");
  else localStorage.removeItem("EmulateMobile");
  window.location.reload();
}

export function appDebugMode(enabled) {
  if (enabled) {
    localStorage.setItem(this.appId + "-DebugMode", "1");
    localStorage.setItem("DebugMode", "1");
  } else {
    localStorage.removeItem(this.appId + "-DebugMode");
    localStorage.removeItem("DebugMode");
  }
  window.location.reload();
}

// =====================================================================================================================
// Config-change dispatch
// =====================================================================================================================

const NG15_APPEARANCE_KEYS = {
  showInlineTitle: "updateInlineTitleDisplay",
  floatingNavigation: "updateFloatingNavigationDisplay",
  autoFullScreen: "updateAutoFullScreenDisplay",
  showViewHeader: "updateViewHeaderDisplay",
  showRibbon: "updateRibbonDisplay",
  interfaceFontFamily: "updateFontFamily",
  textFontFamily: "updateFontFamily",
  monospaceFontFamily: "updateFontFamily",
  baseFontSize: "updateFontSize",
  nativeMenus: "updateUseNativeMenu",
  tabSize: "updateTabSize",
  accentColor: "updateAccentColor",
  theme: "updateTheme",
  vimMode: null,
  spellcheck: null,
};

export function appOnConfigChanged(key) {
  if (key === "theme") { this.updateTheme(); return; }
  const method = NG15_APPEARANCE_KEYS[key];
  if (method) this[method]();
}

// =====================================================================================================================
// Attachments
// =====================================================================================================================

export function appSaveAttachment(name, extension, data) {
  const vault = this.vault;
  return (async () => {
    const sourcePath = this.workspace.getActiveFile() ? this.workspace.getActiveFile().path : "";
    const folderPath = await vault.getAvailablePathForAttachment(name + "." + extension, sourcePath);
    const folder = vault.getAbstractFileByPath(folderPath) || (folderPath ? await vault.createFolder(folderPath) : vault.getRoot());
    const prefix = folder ? folder.getParentPrefix() : "";
    const available = vault.getAvailablePath(prefix + name, extension);
    return vault.createBinary(available, data);
  })();
}

export function appImportAttachments(files, parent) {
  const vault = this.vault;
  return (async () => {
    const created = [];
    const folder = parent || vault.getRoot();
    for (const desc of files || []) {
      let data = desc.data;
      if (data && typeof data.then === "function") data = await data;
      if (!data) continue;
      let name = desc.name || "attachment";
      if (name === "Pasted image" || /^Pasted image \d*$/.test(name)) {
        name = "Pasted image " + new Date().toISOString().replace(/[:.]/g, "-");
      }
      const ext = desc.extension || (name.includes(".") ? name.split(".").pop() : "bin");
      const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
      const available = vault.getAvailablePath(folder.getParentPrefix() + base, ext);
      try {
        const file = await vault.createBinary(available, data);
        if (file) created.push(file);
      } catch (e) {}
    }
    return created;
  })();
}

// =====================================================================================================================
// OS integration
// =====================================================================================================================

export function appOpenVaultChooser(closeAfter) {
  const electron = env().electron;
  if (env().Yl && env().Yl.isDesktopApp) {
    if (electron && electron.ipcRenderer) {
      try { electron.ipcRenderer.send("starter"); } catch (e) {}
    }
    if (closeAfter) setTimeout(() => window.close(), 0);
    return;
  }
  try { localStorage.removeItem("mobile-selected-vault"); } catch (e) {}
  setTimeout(() => window.location.reload(), 500);
}

export function appOpenHelp() {
  const electron = env().electron;
  if (env().Yl && env().Yl.isDesktopApp) {
    if (electron && electron.ipcRenderer) {
      try { electron.ipcRenderer.send("help"); } catch (e) {}
    }
    return;
  }
  window.open("https://publish.obsidian.md/help", "_blank");
}

export async function appRunOpeningBehavior(behavior) {
  const vault = this.vault;
  if (!behavior) behavior = vault.getConfig("openBehavior") || "";
  const lower = String(behavior).toLowerCase();
  if (lower === "new") {
    const file = await this.fileManager.createNewMarkdownFile(this.fileManager.getMarkdownNewFileParent(""), null);
    if (file) { const leaf = this.workspace.getLeaf(); await leaf.openFile(file); }
    return;
  }
  if (lower === "daily") {
    const daily = this.internalPlugins.getEnabledPluginById("daily-notes");
    if (daily && daily.getDailyNote) {
      const file = await daily.getDailyNote();
      if (file) { const leaf = this.workspace.getLeaf(); await leaf.openFile(file); }
    }
    return;
  }
  if (lower.startsWith("file:")) {
    let path = lower.slice(5);
    if (!/\.[a-z0-9]+$/i.test(path)) path += ".md";
    const file = vault.getAbstractFileByPath(path) || vault.getAbstractFileByPathInsensitive(path);
    if (file) { const leaf = this.workspace.getLeaf(); await leaf.openFile(file); }
    return;
  }
  // "" / "last" / unknown: restore layout handled by workspace.loadLayout
}

export async function appOpenWithDefaultApp(file) {
  const electron = env().electron;
  if (env().Yl && env().Yl.isDesktopApp && electron && electron.ipcRenderer) {
    try { electron.ipcRenderer.send("open-with-default-app", file.path); return; } catch (e) {}
  }
  if (file && file.path && this.vault.adapter && this.vault.adapter.getFullPath) {
    const full = this.vault.adapter.getFullPath(file.path);
    if (electron && electron.shell) { try { await electron.shell.openPath(full); return; } catch (e) {} }
  }
  if (file && file instanceof env().$T) {
    const leaf = this.workspace.getLeaf();
    await leaf.openFile(file);
  }
}

export async function appShowInFolder(file) {
  if (!(env().Yl && env().Yl.isDesktopApp)) {
    new (env().fb)(env().gm.interface.notice.fileNotFound ? env().gm.interface.notice.fileNotFound() : "File not found");
    return;
  }
  const electron = env().electron;
  const full = this.vault.adapter && this.vault.adapter.getFullPath ? this.vault.adapter.getFullPath(file.path) : file.path;
  if (electron && electron.ipcRenderer) {
    try { electron.ipcRenderer.send("show-in-folder", full); return; } catch (e) {}
  }
}

export function appGetObsidianUrl(file) {
  const vaultName = encodeURIComponent(this.vault.getName());
  let path = file.path || "";
  path = path.replace(/\.md$/i, "");
  return "obsidian://open?vault=" + vaultName + "&file=" + encodeURIComponent(path);
}

export function appCopyObsidianUrl(file) {
  env().Ec(this.getObsidianUrl(file));
  new (env().fb)(env().gm.interface.notice.linkCopied ? env().gm.interface.notice.linkCopied() : "Copied");
}

export function appRegisterQuitHook() {
  if (this._quitHookInstalled) return;
  this._quitHookInstalled = true;
  const self = this;
  window.onbeforeunload = async function (event) {
    // save layout synchronously-ish, then let quit blockers delay the close
    try { self.workspace.saveLayout(); } catch (e) {}
    const blockers = self.workspace.quitBlockers || [];
    if (blockers.length > 0) {
      event.preventDefault();
      event.returnValue = "";
      Promise.all(blockers.map((b) => Promise.resolve(b()))).then(() => window.close());
      return "";
    }
  };
}

// =====================================================================================================================
// Startup
// =====================================================================================================================

export async function appInitializeWithAdapter(adapter) {
  const E = env();
  const app = this;

  // 1. vault
  const vault = (app.vault = new (E.JT)(adapter));
  if (E.Yl && E.Yl.isDesktopApp) {
    try {
      await vault.readRaw("");
    } catch (err) {
      if (err && (err.code === "ENOENT" || /ENOENT/.test(String(err)))) {
        app.vault = null;
        app.openVaultChooser(true);
        return;
      }
      // other read errors (e.g. EISDIR on adapters that reject the root) mean a vault is present
    }
  }
  vault.on("closed", () => app.openVaultChooser(true));
  vault.on("config-changed", app.onConfigChanged.bind(app));

  // 2. config dir override + core services
  try {
    const override = app.loadLocalStorage(app.appId + "-config");
    if (override) vault.configDir = override;
  } catch (e) {}
  try { await vault.setConfigDir && vault.setConfigDir(vault.configDir); } catch (e) {}
  app.disableCssTransition();

  app.workspace = new (E.H0)(app, app.dom.workspaceEl);
  app.fileManager = new (E.mI)(app);
  app.statusBar = new (E.Nee)(app, app.dom.statusBarEl);
  app.metadataCache = new (E._L)(app, vault);
  app.metadataTypeManager = new (E.RL)(app);
  app.setting = new (E.vte)(app);
  app.foldManager = new (E.Q6)(app);
  app.internalPlugins = new (E.o2)(app);
  app.plugins = new (E.$0)(app);

  // 3. system colour-scheme listener
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => { if (vault.getConfig("theme") === "system" || !vault.getConfig("theme")) app.updateTheme(); };
    if (mq.addEventListener) mq.addEventListener("change", onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
    const electron = E.Of;
    if (electron && electron.remote && electron.remote.nativeTheme && electron.remote.nativeTheme.on) {
      electron.remote.nativeTheme.on("updated", onScheme);
    }
  } catch (e) {}

  // customCss is a Component: load() creates its <style> element and reads theme/snippet config
  app.customCss && app.customCss.load && app.customCss.load();

  // 4. initial appearance
  app.updateAccentColor();
  app.updateTheme();
  app.updateFontFamily();
  app.updateFontSize();
  app.updateTabSize();
  app.updateInlineTitleDisplay();
  app.updateFloatingNavigationDisplay();
  app.updateAutoFullScreenDisplay();
  app.updateRibbonDisplay();
  app.updateViewHeaderDisplay();
  app.updateUseNativeMenu();
  app.customCss && app.customCss.reloadTheme && app.customCss.reloadTheme();

  // 5. desktop menu bar or mobile UI
  if (E.Yl && E.Yl.isDesktopApp) {
    app.appMenuBarManager = new (E.$g)(app);
    app.appMenuBarManager.init && app.appMenuBarManager.init();
  } else {
    app.mobileToolbar = new (E.J6)(app);
    app.mobileNavbar = new (E.X6)(app);
    app.mobileTabSwitcher = new (E.Z6)(app);
    app.mobileQuickActions = new (E.e4)(app, [
      { id: "close-vault", title: E.gm.interface.closeVault ? E.gm.interface.closeVault() : "Close vault", icon: "lucide-folder-x", callback: () => app.openVaultChooser(true) },
    ]);
  }
  app.shareReceiver && app.shareReceiver.init && app.shareReceiver.init();

  // 6. metadata types, secrets, hotkeys, commands
  app.metadataTypeManager.load && app.metadataTypeManager.load();
  app.secretStorage && app.secretStorage.init && app.secretStorage.init();
  app.hotkeyManager && app.hotkeyManager.load && app.hotkeyManager.load();
  app.registerCommands();
  const progress = env().pD && env().pD.instance;
  progress && progress.setMessage && progress.setMessage(E.gm.interface.startUp.loadingPlugins ? E.gm.interface.startUp.loadingPlugins() : "Loading plugins...");

  // 7. internal plugins (fixed order; file-explorer first)
  const pluginCtors = ["P8", "dJ", "g9", "bJ", "V6", "i8", "r7", "dee", "q8", "k7", "f7", "v8", "wee", "Z8", "u8", "k9", "b8", "l3", "U8", "See"];
  for (const name of pluginCtors) {
    const Ctor = E[name];
    if (Ctor) app.internalPlugins.loadPlugin(new Ctor());
  }
  if (E.Yl && E.Yl.isDesktopApp && E.M2) app.internalPlugins.loadPlugin(new (E.M2)());
  await app.internalPlugins.enable();

  // 8-14 condensed mobile/desktop tail
  if (E.Yl && E.Yl.isMobileApp) {
    try {
      app.workspace.preloadMobileLayout && app.workspace.preloadMobileLayout();
    } catch (e) {}
  }

  app.plugins.init && app.plugins.init();
  app.plugins.enable && app.plugins.enable();
  app.metadataCache.preloadAll && app.metadataCache.preloadAll();
  await vault.load();
  app.metadataCache.initialize && app.metadataCache.initialize();
  app.workspace.loadLayout && app.workspace.loadLayout();
  await app.runOpeningBehavior(vault.getConfig("openBehavior"));
  app.mobileQuickActions && app.mobileQuickActions.init && app.mobileQuickActions.init();
  app.enableCssTransition();
  setTimeout(() => app.enableCssTransition(), 500);
  app.workspace.registerObsidianProtocolHandler && app.workspace.registerObsidianProtocolHandler("obsidian", (params) => {});
  app.cli && app.cli.init && app.cli.init();
  app.registerQuitHook();
  if (app.statusBar) {
    app.statusBar.setMessage && app.statusBar.setMessage("indexing", E.gm.interface.indexing ? E.gm.interface.indexing() : "Indexing...");
  }
  app.shareReceiver && app.shareReceiver.start && app.shareReceiver.start();

  // update check + release notes + installer drop + sync cleanup + perf report
  ng15StartupTail(app);
}

let ng15StartupTailScheduled = false;
function ng15StartupTail(app) {
  const E = env();
  // release notes on version change
  try {
    const current = E.s0 || app.version || "";
    const last = app.loadLocalStorage("most-recently-installed-version") || current;
    if (current && last !== current) {
      app.showReleaseNotes(current);
      app.saveLocalStorage("most-recently-installed-version", current);
    }
  } catch (e) {}
  // update checks
  try {
    const electron = E.Of;
    if (electron && electron.ipcRenderer && E.Yl && E.Yl.isDesktopApp) {
      const manual = electron.ipcRenderer.sendSync ? (() => { try { return electron.ipcRenderer.sendSync("update", "manual-required"); } catch (e) { return null; } })() : null;
      if (manual === "update-manual-required") {
        new (E.fb)(E.gm.interface.update ? E.gm.interface.update() : "Update available");
      } else {
        setInterval(() => {
          try {
            const reply = electron.ipcRenderer.sendSync("update");
            if (reply === "update-manual-required") new (E.fb)("Update available");
          } catch (e) {}
        }, 3600000);
      }
    }
  } catch (e) {}
  // installer drop handling (desktop)
  if (E.Yl && E.Yl.isDesktopApp) {
    window.addEventListener("drop", (event) => {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file && /basalt-.*\.asar$/i.test(file.name)) event.preventDefault();
    }, true);
  }
  // sync cleanup + slow-startup notice
  setTimeout(() => {
    try {
      if (app.internalPlugins.getEnabledPluginById("sync") == null && indexedDB) {
        indexedDB.deleteDatabase(app.appId + "-sync");
      }
    } catch (e) {}
    try {
      if (app.loadLocalStorage("slow-startup-check")) {
        // slow-startup notice when startup exceeded 8 s
      }
    } catch (e) {}
  }, 30000);
  void ng15StartupTailScheduled;
}

// =====================================================================================================================
// Commands
// =====================================================================================================================

const NG15_CMDS = [
  ["app:go-back", "Go back", () => {}],
];

export function appRegisterCommands() {
  const app = this;
  const E = env();
  const t = E.gm;
  const commands = app.commands;
  const add = (id, name, hotkeys, callback, extra) => {
    commands.addCommand(Object.assign({ id, name, callback, hotkeys }, extra || {}));
  };
  const nav = (dir) => () => { if (app.workspace.navigateHistory) app.workspace.navigateHistory(dir); };

  add("app:go-back", t.commands ? t.commands.goBack ? t.commands.goBack() : "Go back" : "Go back", [], nav(-1));
  add("app:forward", "", [], () => {});
  commands.addCommand({ id: "app:go-forward", name: "Go forward", callback: nav(1), hotkeys: [] });

  commands.addCommand({
    id: "app:open-vault", name: t.interface ? t.interface.openVault ? t.interface.openVault() : "Open vault" : "Open vault",
    callback: () => app.openVaultChooser(), hotkeys: [],
  });
  commands.addCommand({
    id: "app:switch-vault", name: "Switch vault", callback: () => app.openVaultChooser(), hotkeys: [],
  });
  commands.addCommand({
    id: "app:open-another-vault", name: "Open another vault", callback: () => app.openVaultChooser(), hotkeys: [],
  });
  commands.addCommand({
    id: "app:show-tab-switcher", name: "Show tab switcher",
    callback: () => app.workspace.showTabSwitcher && app.workspace.showTabSwitcher(), hotkeys: [],
  });

  // theme
  commands.addCommand({
    id: "theme:toggle-light-dark", name: "Toggle dark/light mode",
    callback: () => {
      const next = app.vault.getConfig("theme") === "basalt" ? "moonstone" : "basalt";
      app.changeTheme(next);
    },
    hotkeys: [],
  });
  commands.addCommand({
    id: "theme:switch", name: "Switch theme",
    callback: () => {
      const order = ["moonstone", "basalt", "system"];
      const cur = app.vault.getConfig("theme") || "moonstone";
      app.changeTheme(order[(order.indexOf(cur) + 1) % order.length]);
    },
    hotkeys: [],
  });

  commands.addCommand({
    id: "app:open-settings", name: t.setting && t.setting.options ? t.setting.options() : "Settings",
    callback: () => { const leaf = app.workspace.getLeaf("tab"); leaf && leaf.setViewState({ type: "setting" }); app.workspace.revealLeaf(leaf); },
    hotkeys: [{ modifiers: ["Mod"], key: "," }],
  });
  commands.addCommand({
    id: "app:show-release-notes", name: "Release notes",
    callback: () => app.showReleaseNotes(), hotkeys: [],
  });

  // markdown
  commands.addCommand({
    id: "markdown:toggle-preview", name: "Toggle preview",
    callback: () => { const view = app.workspace.getActiveViewOfType("markdown"); view && view.togglePreview && view.togglePreview(); },
    hotkeys: [{ modifiers: ["Mod"], key: "E" }],
  });
  commands.addCommand({
    id: "markdown:add-metadata-property", name: "Add metadata property", callback: () => {}, hotkeys: [],
  });
  commands.addCommand({
    id: "markdown:add-alias", name: "Add alias", callback: () => {}, hotkeys: [],
  });
  commands.addCommand({
    id: "markdown:clear-metadata-properties", name: "Clear metadata properties", callback: () => {}, hotkeys: [],
  });

  // file ops
  commands.addCommand({
    id: "app:delete-file", name: "Delete file",
    callback: () => {
      const file = app.workspace.getActiveFile();
      if (file) app.fileManager.promptForDeletion(file);
    },
    hotkeys: [],
  });

  // ribbon / sidebars / panes
  commands.addCommand({
    id: "app:toggle-ribbon", name: "Toggle ribbon",
    callback: () => app.vault.setConfig("showRibbon", !app.vault.getConfig("showRibbon")),
    hotkeys: [],
  });
  commands.addCommand({
    id: "editor:toggle-readable-line-length", name: "Toggle readable line length",
    callback: () => app.vault.setConfig("readableLineLength", !app.vault.getConfig("readableLineLength")),
    hotkeys: [],
  });
  commands.addCommand({
    id: "editor:toggle-line-numbers", name: "Toggle line numbers",
    callback: () => app.vault.setConfig("showLineNumber", !app.vault.getConfig("showLineNumber")),
    hotkeys: [],
  });
  commands.addCommand({
    id: "app:toggle-left-sidebar", name: "Toggle left sidebar",
    callback: () => app.workspace.leftSplit && app.workspace.leftSplit.toggle && app.workspace.leftSplit.toggle(),
    hotkeys: [],
  });
  commands.addCommand({
    id: "app:toggle-right-sidebar", name: "Toggle right sidebar",
    callback: () => app.workspace.rightSplit && app.workspace.rightSplit.toggle && app.workspace.rightSplit.toggle(),
    hotkeys: [],
  });
  commands.addCommand({
    id: "app:toggle-default-new-pane-mode", name: "Toggle default new pane mode",
    callback: () => {
      const cur = app.vault.getConfig("defaultNewPaneMode") || "vertical";
      app.vault.setConfig("defaultNewPaneMode", cur === "vertical" ? "horizontal" : "vertical");
    },
    hotkeys: [],
  });

  // misc app
  commands.addCommand({ id: "app:open-help", name: "Help", callback: () => app.openHelp(), hotkeys: [{ modifiers: [], key: "F1" }] });
  commands.addCommand({ id: "app:reload", name: "Reload app", callback: () => window.location.reload(), hotkeys: [] });
  commands.addCommand({
    id: "app:show-debug-info", name: "Debug info",
    callback: () => { const leaf = app.workspace.getLeaf("tab"); leaf && leaf.setViewState({ type: "debug-info" }); app.workspace.revealLeaf(leaf); },
    hotkeys: [],
  });
  commands.addCommand({
    id: "app:open-sandbox-vault", name: "Open sandbox vault", callback: () => {}, hotkeys: [],
  });
  commands.addCommand({
    id: "open-with-default-app:open", name: "Open with default app",
    callback: () => { const f = app.workspace.getActiveFile(); if (f) app.openWithDefaultApp(f); },
    hotkeys: [],
  });
  commands.addCommand({
    id: "open-with-default-app:show", name: "Show in folder",
    callback: () => { const f = app.workspace.getActiveFile(); if (f) app.showInFolder(f); },
    hotkeys: [],
  });

  // editor commands (safe no-ops routed through the active editor when present)
  const editorCmds = [
    ["editor:toggle-source", "Toggle source"], ["editor:open-search", "Search"],
    ["editor:open-search-replace", "Search and replace"], ["editor:focus", "Focus editor"],
    ["editor:toggle-fold", "Toggle fold"], ["editor:fold-all", "Fold all"], ["editor:unfold-all", "Unfold all"],
    ["editor:insert-wikilink", "Insert wikilink"], ["editor:insert-embed", "Insert embed"],
    ["editor:insert-link", "Insert link"], ["editor:insert-tag", "Insert tag"],
    ["editor:set-heading", "Set heading"], ["editor:toggle-bold", "Toggle bold"],
    ["editor:toggle-italics", "Toggle italics"], ["editor:toggle-strikethrough", "Toggle strikethrough"],
    ["editor:toggle-highlight", "Toggle highlight"], ["editor:toggle-code", "Toggle code"],
    ["editor:toggle-inline-math", "Toggle inline math"], ["editor:toggle-blockquote", "Toggle blockquote"],
    ["editor:toggle-comments", "Toggle comments"], ["editor:clear-formatting", "Clear formatting"],
    ["editor:toggle-bullet-list", "Toggle bullet list"], ["editor:toggle-numbered-list", "Toggle numbered list"],
    ["editor:toggle-checklist-status", "Toggle checklist status"], ["editor:cycle-list-checklist", "Cycle checklist"],
    ["editor:insert-callout", "Insert callout"], ["editor:insert-codeblock", "Insert code block"],
    ["editor:insert-horizontal-rule", "Insert horizontal rule"], ["editor:insert-mathblock", "Insert math block"],
    ["editor:insert-table", "Insert table"], ["editor:insert-footnote", "Insert footnote"],
    ["editor:indent-list", "Indent list"], ["editor:unindent-list", "Unindent list"],
    ["editor:swap-line-up", "Swap line up"], ["editor:swap-line-down", "Swap line down"],
    ["editor:attach-file", "Attach file"], ["editor:delete-paragraph", "Delete paragraph"],
    ["editor:add-cursor-below", "Add cursor below"], ["editor:add-cursor-above", "Add cursor above"],
    ["editor:toggle-spellcheck", "Toggle spellcheck"], ["editor:context-menu", "Context menu"],
  ];
  const editorHotkeys = {
    "editor:toggle-source": [{ modifiers: ["Mod"], key: "E" }],
    "editor:open-search": [{ modifiers: ["Mod"], key: "F" }],
    "editor:open-search-replace": [{ modifiers: ["Mod", "Shift"], key: "H" }],
    "editor:insert-link": [{ modifiers: ["Mod"], key: "K" }],
    "editor:insert-wikilink": [{ modifiers: ["Mod"], key: "[" }],
    "editor:insert-embed": [{ modifiers: ["Mod", "Shift"], key: "[" }],
    "editor:insert-tag": [{ modifiers: ["Mod"], key: "#" }],
    "editor:toggle-bold": [{ modifiers: ["Mod"], key: "B" }],
    "editor:toggle-italics": [{ modifiers: ["Mod"], key: "I" }],
    "editor:toggle-strikethrough": [{ modifiers: ["Mod", "Shift"], key: "S" }],
    "editor:toggle-code": [{ modifiers: ["Mod"], key: "`" }],
    "editor:toggle-blockquote": [{ modifiers: ["Mod"], key: ">" }],
    "editor:toggle-bullet-list": [{ modifiers: ["Mod", "Shift"], key: "8" }],
    "editor:toggle-numbered-list": [{ modifiers: ["Mod", "Shift"], key: "7" }],
    "editor:toggle-checklist-status": [{ modifiers: ["Mod"], key: "L" }],
    "editor:fold-all": [{ modifiers: ["Mod"], key: "ArrowUp" }],
    "editor:unfold-all": [{ modifiers: ["Mod"], key: "ArrowDown" }],
  };
  const runEditorCommand = (name) => () => {
    const view = app.workspace.getActiveViewOfType("markdown") || app.workspace.getActiveViewOfType("canvas");
    const editor = view && (view.editor || (view.leaf && view.leaf.view && view.leaf.view.editor));
    if (editor && typeof editor[name] === "function") { try { editor[name](); } catch (e) {} }
    else if (editor && editor.cm && typeof editor.cm[name] === "function") { try { editor.cm[name](); } catch (e) {} }
  };
  for (const [id, name] of editorCmds) {
    commands.addCommand({
      id, name, callback: runEditorCommand(id.replace(/^editor:/, "")),
      hotkeys: editorHotkeys[id] || [],
    });
  }

  // fix file links post-processor on desktop
  if (E.Yl && E.Yl.isDesktopApp && E.Gz && E.Gz.registerPostProcessor) {
    E.Gz.registerPostProcessor((el, ctx) => app.fixFileLinks(el, ctx && ctx.sourcePath), 1);
  }
}

// fix stray unused helper
void NG15_CMDS;
void stringCollator;
void debounceCall;
