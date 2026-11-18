// s05 slice: desktop chrome and mobile drawer pieces.
// - BD: frameless-window titlebar (minimize/maximize/close, zoom factor, macOS
//   traffic-light positioning, fullscreen/maximized body classes)
// - DD: vault profile switcher in the left drawer (FunctionExpression -> factory)
// - _D: mobile left drawer header with vault picker + file/folder counts
// - GD: mobile right drawer header with file name + info renderers
import { env } from "./env.js";
import { s05TitlebarDoubleClick, s05MobileVaultList } from "./s05-utils.js";
import { floatOr } from "./text.js";

const MAXIMIZE_SVG = '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12"><rect width="9" height="9" x="1.5" y="1.5" fill="none" stroke="currentColor"></rect></svg>';
const RESTORE_SVG = '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 3.5H8.5V10.5H1.5V3.5Z" stroke="currentColor"/> <path d="M4 2H10V8H9V9H11V1H3V3H4V2Z" fill="currentColor"/></svg>';
const MINIMIZE_SVG = '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12"><rect fill="currentColor" width="10" height="1" x="1" y="6"></rect></svg>';
const CLOSE_SVG = '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12"> <path fill="currentColor" fill-rule="evenodd" d="M10.052 10.968 1.03 1.93l.849-.848 9.023 9.037-.849.848Z"/><path fill="currentColor" fill-rule="evenodd" d="M1.023 10.112 10.06 1.09l.848.85-9.037 9.023-.848-.85Z"/></svg>';

// Frameless titlebar injected at the top of the window document.
export function defineTitlebar(host) {
  return class Titlebar {
    constructor(eWin, win) {
      this.requestUpdateStatus = env().debounce(this.updateStatus.bind(this), 50, true);
      this.eWin = eWin;
      this.win = win;
      this.isMac = window.process.platform === "darwin";
      const doc = win.document;
      const body = doc.body;
      body.addClass("is-frameless");
      const bar = this.titleBarEl = doc.createElement("div");
      bar.className = "titlebar";
      body.insertBefore(bar, body.firstChild);
      const inner = this.titleBarInnerEl = bar.createDiv("titlebar-inner");
      this.titleBarTextEl = inner.createDiv({ cls: "titlebar-text", text: "Basalt" });
      win.addEventListener("resize", this.requestUpdateStatus.bind(this));
      let titleEl = doc.head.find("title");
      if (!titleEl) titleEl = doc.head.createEl("title");
      new MutationObserver(this.updateTitle.bind(this)).observe(titleEl, { subtree: true, characterData: true, childList: true });
      this.leftButtonContainerEl = inner.createDiv("titlebar-button-container mod-left");
      const right = inner.createDiv("titlebar-button-container mod-right");
      this.updateStatus();
      this.updateTitle();
      if (!this.isMac) {
        if (eWin.minimizable) {
          const btn = right.createDiv({ cls: "titlebar-button mod-minimize", onclick: () => eWin.minimize() });
          btn.innerHTML = MINIMIZE_SVG;
          Promise.resolve().then(() => host.setTooltip(btn, env().gm.interface.window.minimize()));
        }
        if (eWin.maximizable) {
          const btn = right.createDiv({ cls: "titlebar-button mod-maximize", onclick: () => { eWin.isMaximized() ? eWin.unmaximize() : eWin.maximize(); swapIcon(); } });
          const swapIcon = () => {
            if (win.closed) return;
            if (eWin.isMaximized()) {
              btn.innerHTML = RESTORE_SVG;
              host.setTooltip(btn, env().gm.interface.window.restoreDown());
            } else {
              btn.innerHTML = MAXIMIZE_SVG;
              host.setTooltip(btn, env().gm.interface.window.maximize());
            }
          };
          btn.innerHTML = MAXIMIZE_SVG;
          Promise.resolve().then(() => swapIcon());
          win.addEventListener("resize", swapIcon);
        }
        if (eWin.closable) {
          const btn = right.createDiv({ cls: "titlebar-button mod-close", onclick: () => eWin.close() });
          btn.innerHTML = CLOSE_SVG;
          Promise.resolve().then(() => host.setTooltip(btn, env().gm.interface.window.closeWindow()));
        }
      }
      s05TitlebarDoubleClick(inner);
    }

    updateTitle() {
      this.titleBarTextEl.setText(this.win.document.title);
    }

    updateStatus() {
      const win = this.win;
      const eWin = this.eWin;
      if (win.closed) return;
      const zoom = eWin.webContents.getZoomFactor();
      const body = win.document.body;
      body.toggleClass("is-fullscreen", eWin.isFullScreen());
      body.toggleClass("is-maximized", eWin.isMaximized());
      body.style.setProperty("--zoom-factor", String(zoom));
      if (this.isMac && win.titlebarStyle === "hidden") {
        const offsetX = floatOr(getComputedStyle(body).getPropertyValue("--traffic-lights-offset-x"), 40);
        let offsetY = floatOr(getComputedStyle(body).getPropertyValue("--traffic-lights-offset-y"), 40);
        if (offsetY === 0) offsetY = 40;
        const place = (value) => {
          const pos = Math.floor(value * zoom / 2 - 8);
          return pos < -5 ? 0 : pos;
        };
        const x = place(offsetX) + 2;
        const y = place(offsetY);
        const setPos = eWin.setWindowButtonPosition || eWin.setTrafficLightPosition;
        setPos({ x, y });
      }
    }
  };
}

// Vault profile row at the top of the left drawer: shows the vault name,
// a hover tooltip with file/folder counts and a right-click/left-click menu
// for switching vaults.
export function s05VaultProfile(host) {
  return function VaultProfile(app, containerEl) {
    this.app = app;
    if (!env().Yl.isDesktopApp) return;
    const vaultName = app.vault.getName();
    let basePath = "";
    if (app.vault.adapter instanceof env().Eu) {
      basePath = app.vault.adapter.getBasePath();
    }
    const path = window.require("path");
    containerEl.createDiv("workspace-sidedock-vault-profile", (profile) => {
      profile.createDiv("workspace-drawer-vault-switcher", (row) => {
        row.createDiv("workspace-drawer-vault-switcher-icon", (icon) => env().tv(icon, "lucide-chevrons-up-down"));
        const nameEl = row.createDiv({ cls: "workspace-drawer-vault-name", text: vaultName });
        row.addEventListener("mouseover", () => {
          const vault = app.vault;
          const files = env().gm.nouns.fileWithCount({ count: vault.getRoot().getFileCount() });
          const folders = env().gm.nouns.folderWithCount({ count: vault.getRoot().getFolderCount() });
          const tip = basePath + "\n\n" + files + ", " + folders;
          host.displayTooltip(nameEl, tip, { placement: "top", gap: 24, horizontalParent: row, delay: env().lv });
        });
        row.addEventListener("mouseleave", () => host.hideTooltip());
        row.addEventListener("click", (event) => {
          if (row.hasClass("has-active-menu")) return;
          const current = env().electron.ipcRenderer.sendSync("vault").path;
          const registry = env().electron.ipcRenderer.sendSync("vault-list");
          const menu = env().Ug.forEvent(event);
          const addVault = (key) => {
            if (!Object.hasOwn(registry, key)) return;
            const entry = registry[key];
            const name = path.basename(entry.path);
            const isCurrent = current === entry.path;
            menu.addItem((item) => item.setTitle(name).setChecked(isCurrent).onClick(() => {
              if (isCurrent) return;
              if (window.electron.ipcRenderer.sendSync("vault-open", entry.path, false) !== true) {
                new (env().fb)(env().gm.interface.startScreen.msgErrorFailedToOpenVault());
              }
            }));
          };
          for (const key in registry) addVault(key);
          menu.addSeparator().addItem((item) => item.setTitle(env().gm.interface.manageVaults()).setIcon("open-vault").onClick(() => app.openVaultChooser()))
            .setParentElement(row);
        });
        row.addEventListener("contextmenu", (event) => {
          const menu = env().Ug.forEvent(event);
          menu.addSections(["title", "open", "action", "", "danger"]);
          menu.setParentElement(row)
            .addItem((item) => item.setTitle(env().Yl.isMacOS ? env().gm.plugins.openWithDefaultApp.actionShowInFolderMac() : env().gm.plugins.openWithDefaultApp.actionShowInFolder()).setIcon("lucide-arrow-up-right").onClick(() => app.showInFolder("")))
            .addItem((item) => item.setTitle(env().gm.interface.menu.copyPath()).setIcon("lucide-clipboard").onClick(() => {
              env().Ec(basePath);
              new (env().fb)(env().gm.interface.copied({ context: "generic" }));
            }));
        });
      });
      profile.createDiv({ cls: "workspace-drawer-vault-actions" }, (actions) => {
        actions.createSpan("clickable-icon", (icon) => {
          env().tv(icon, "help");
          icon.addEventListener("click", () => app.openHelp());
        });
        actions.createSpan("clickable-icon", (icon) => {
          env().tv(icon, "lucide-settings");
          icon.addEventListener("click", () => app.setting.open());
        });
      });
    });
  };
}

// Mobile left drawer: vault name + switcher, file/folder counts, settings and
// pin header buttons. Extends the shared mobile drawer base (WD).
let drawerBase = null;
function mobileDrawerBase(host) {
  if (!drawerBase) drawerBase = defineMobileDrawer(host);
  return drawerBase;
}

export function defineFilesDrawer(host) {
  const Base = mobileDrawerBase(host);
  return class FilesDrawer extends Base {
    constructor(app, ...rest) {
      super(app, "left", ...rest);
      this.fileCountEl = null;
      this.requestUpdateInfo = env().debounce(() => this.updateInfo(), 100);
      const vault = this.app.vault;
      this.headerEl.createDiv("workspace-drawer-header-left", (left) => {
        left.createDiv({ cls: "workspace-drawer-header-name" }, (nameBox) => {
          nameBox.createEl("label", "workspace-drawer-header-switcher", (label) => {
            label.createSpan({ cls: "workspace-drawer-header-name-text", text: vault.getName() });
            label.createSpan("workspace-drawer-header-name-chevron", (chevron) => env().tv(chevron, "lucide-chevron-down"));
            const select = label.createEl("select", "", (selectEl) => (async () => {
              const manage = selectEl.createEl("option", { text: env().gm.interface.manageVaults(), value: "manage-vaults" });
              const selected = localStorage.getItem("mobile-selected-vault");
              const vaults = await s05MobileVaultList();
              for (const vaultInfo of vaults) {
                let name = vaultInfo.name;
                if (vaultInfo.storageType === "iCloud") name += " (iCloud)";
                const option = selectEl.createEl("option", { text: name, value: vaultInfo.location });
                if (selected === vaultInfo.location) option.selected = true;
              }
              selectEl.appendChild(manage);
            })());
            select.addEventListener("change", () => {
              const value = select.value;
              if (value === "manage-vaults") {
                this.app.openVaultChooser();
              } else {
                window.localStorage.setItem("mobile-selected-vault", value);
                location.reload();
              }
            });
          });
        });
        left.createDiv("workspace-drawer-header-info", (info) => {
          this.fileCountEl = info.createDiv();
          this.updateInfo();
        });
      });
      this.addHeaderButton("lucide-settings", () => this.app.setting.open()).addClass("mod-settings");
      this.pinIconEl = this.addHeaderButton("pin", () => this.togglePinned());
      this.pinIconEl.addClass("mod-pin");
      this.containerEl.addClass("mod-left");
      this.component.registerEvent(vault.on("create", this.requestUpdateInfo));
      this.component.registerEvent(vault.on("delete", this.requestUpdateInfo));
    }

    updateInfo() {
      const vault = this.app.vault;
      const files = env().gm.nouns.fileWithCount({ count: vault.getRoot().getFileCount() });
      const folders = env().gm.nouns.folderWithCount({ count: vault.getRoot().getFolderCount() });
      this.fileCountEl.setText(files + ", " + folders);
    }
  };
}

// Mobile right drawer: current file name plus plugin-supplied info renderers.
export function defineInfoDrawer(host) {
  const Base = mobileDrawerBase(host);
  return class InfoDrawer extends Base {
    constructor(app, third) {
      super(app, "right", third);
      this.fileNameEl = null;
      this.fileInfoElToRenderer = [];
      const header = this.headerEl;
      const infos = app.mobileFileInfos;
      header.createDiv("workspace-drawer-header-left", (left) => {
        left.createDiv({ cls: "workspace-drawer-header-name" }, (nameBox) => {
          this.fileNameEl = nameBox.createDiv({ cls: "workspace-drawer-header-name-text", text: env().gm.interface.noFile() });
        });
        left.createDiv("workspace-drawer-header-info", (info) => {
          for (const renderer of infos) {
            const el = info.createDiv("workspace-drawer-header-info-item");
            this.fileInfoElToRenderer.push({ el, renderer: renderer.renderCallback });
          }
        });
      });
      this.containerEl.addClass("mod-right");
      this.component.registerEvent(this.app.vault.on("rename", (file) => {
        if (file instanceof env().$T) {
          const active = this.app.workspace.getActiveFile();
          if (file === active) this.updateName(active);
        }
      }));
      this.component.registerEvent(app.on("quick-preview", this.onQuickPreview, this));
      this.component.registerEvent(app.on("file-open", this.onFileOpen, this));
      this.pinIconEl = this.addHeaderButton("pin", () => this.togglePinned());
      this.pinIconEl.addClass("mod-pin");
    }

    onFileOpen(file) {
      this.updateName(file);
      this.updateInfo();
    }

    onQuickPreview(file) {
      if (this.app.workspace.getActiveFile() === file) this.updateInfo();
    }

    updateName(file) {
      const name = file ? file.getShortName() : env().gm.interface.noFile();
      this.fileNameEl.setText(name);
    }

    updateInfo() {
      for (const entry of this.fileInfoElToRenderer) {
        entry.renderer(entry.el);
      }
    }
  };
}

// Mobile drawer base: a sidedock with swipe-to-open/close, backdrop, tab
// strip and pin support. Extended by the files (_D) and info (GD) drawers.
export function defineMobileDrawer(host) {
  if (drawerBase) return drawerBase;
  const Base = host.WorkspaceParent;
  const SWIPE_DURATION = env().UD;
  drawerBase = class MobileDrawer extends Base {
    constructor(workspace, side, id) {
      super(workspace, id);
      this.type = "mobile-drawer";
      this.children = [];
      this.allowSingleChild = true;
      this.autoManageDOM = false;
      this.currentTab = 0;
      this.isPinned = false;
      this.tabOptionsCollapsed = true;
      this.containerEl = null;
      this.backdropEl = null;
      this.innerEl = null;
      this.headerEl = null;
      this.tabContainerEl = null;
      this.activeTabContentEl = null;
      this.pinIconEl = null;
      this.side = side;
      this.collapsed = true;
      const containerEl = this.containerEl = createDiv("workspace-drawer");
      containerEl.hide();
      const innerEl = this.innerEl = containerEl.createDiv("workspace-drawer-inner");
      this.backdropEl = createDiv("workspace-drawer-backdrop", (backdrop) => {
        backdrop.addEventListener("click", this.collapse.bind(this));
        backdrop.style.opacity = "0";
      });
      this.headerEl = innerEl.createDiv("workspace-drawer-header");
      const tabContainerEl = this.tabContainerEl = innerEl.createDiv("workspace-drawer-tab-container");
      const activeTabEl = this.activeTabEl = tabContainerEl.createDiv("workspace-drawer-active-tab-container");
      this.tabsContainerEl = activeTabEl.createDiv("workspace-drawer-tab-options");
      this.activeTabHeaderEl = this.tabsContainerEl.createDiv("workspace-tab-header workspace-drawer-tab-select", (header) => {
        header.setAttr("data-ignore-swipe", true);
        header.createDiv("workspace-tab-header-inner", (inner) => {
          this.activeTabHeaderIconEl = inner.createSpan("workspace-tab-header-inner-icon");
          this.activeTabHeaderTitleEl = inner.createSpan("workspace-tab-header-inner-title");
          inner.createDiv("workspace-tab-header-inner-chevron", (chevron) => env().tv(chevron, "lucide-chevrons-up-down"));
        });
        header.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          const child = this.children[this.currentTab];
          if (child) child.onOpenTabHeaderMenu(event, header);
        });
      });
      this.tabsListEl = this.tabsContainerEl.createDiv("workspace-drawer-tab-options-list");
      this.tabsListEl.on("click", ".workspace-tab-header", (event, target) => {
        const index = this.children.findIndex((child) => child.tabHeaderEl === target);
        if (index !== -1) {
          this.selectTabIndex(index);
          if (!env().Yl.isPhone && !this.isPinned) this.workspace.setActiveLeaf(this.children[index], { focus: true });
          this.setTabOptionsCollapsed(true);
        }
      });
      this.activeTabContentEl = activeTabEl.createDiv("workspace-drawer-active-tab-content");
      this.setupTabSelectTouchHandler();
      const direction = side === "left" ? 1 : -1;
      this.component.registerEvent(workspace.on("swipe", (event) => {
        if (!(this.workspace.layoutReady && !this.isPinned && !(event.points > 1 || event.direction !== "x"))) return;
        if (env().Yl.isPhone) {
          const safeBottom = parseFloat(getComputedStyle(document.body).getPropertyValue("--safe-area-inset-bottom"));
          if (window.innerHeight - event.startY < safeBottom) return;
        }
        const self = this;
        const drawer = self.containerEl;
        const backdrop = self.backdropEl;
        const rootSplit = self.workspace.rootSplit.containerEl;
        const navbar = self.app.mobileNavbar.containerEl;
        env().vl(drawer); env().vl(backdrop); env().vl(rootSplit); env().vl(navbar);
        const leftSplit = self.workspace.leftSplit;
        const rightSplit = self.workspace.rightSplit;
        const leftCollapsed = leftSplit.collapsed || (leftSplit instanceof MobileDrawer && leftSplit.isPinned);
        const rightCollapsed = rightSplit.collapsed || (rightSplit instanceof MobileDrawer && rightSplit.isPinned);
        const bothCollapsed = leftCollapsed && rightCollapsed &&
          ((side === "left" && event.x > event.startX) || (side === "right" && event.x < event.startX));
        const sliding = env().Yl.isPhone && self.app.vault.getConfig("slidingSidebar");
        if (sliding) navbar.style.transition = "none";
        if (self.collapsed) {
          if (!bothCollapsed) return;
          self.collapsed = false;
          self.onExpand();
          env().Lv();
          self.workspace.app.mobileNavbar?.restoreNavigation();
          drawer.show();
          self.fixIosEvent();
          self.workspace.containerEl.appendChild(backdrop);
          const width = drawer.offsetWidth;
          const travel = width * direction;
          event.registerCallback({
            move: (moveEvent) => {
              const progress = Math.clamp((moveEvent - event.startX) * direction / width, 0, 1);
              const rest = 1 - progress;
              drawer.style.transform = "translateX(" + -rest * travel + "px)";
              backdrop.style.opacity = String(progress);
              if (sliding) {
                rootSplit.style.transform = "translateX(" + progress * travel + "px)";
                navbar.style.transform = "translateX(" + progress * travel + "px)";
              }
            },
            cancel: () => {
              if (sliding) navbar.style.transition = "";
              drawer.style.transform = "";
              rootSplit.style.transform = "";
              navbar.style.transform = "";
              drawer.hide();
              backdrop.detach();
              self.collapsed = true;
            },
            finish: (finishEvent, _velocity, velocityX) => {
              if (sliding) navbar.style.transition = "";
              const progress = Math.clamp((finishEvent - event.startX) * direction / width, 0, 1);
              const rest = 1 - progress;
              if (velocityX * direction > width / 2) {
                const duration = SWIPE_DURATION * rest;
                env().yl(drawer, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", "translateX(" + -rest * travel + "px)", "translateX(0)", ""));
                env().yl(backdrop, new (env().dl)({ duration, fn: "ease-out" }).addProp("opacity", String(progress), "1", ""));
                if (sliding) {
                  env().yl(rootSplit, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", null, "translateX(" + travel + "px)"));
                  env().yl(navbar, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", null, "translateX(" + travel + "px)"));
                }
              } else {
                self.collapsed = true;
                self.onCollapse();
                const duration = SWIPE_DURATION * progress;
                env().yl(drawer, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", null, "translateX(" + -travel + "px)", ""), () => drawer.hide());
                env().yl(backdrop, new (env().dl)({ duration, fn: "ease-out" }).addProp("opacity", null, "0"), () => backdrop.detach());
                if (sliding) {
                  env().yl(rootSplit, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", null, "translateX(0px)", ""));
                  env().yl(navbar, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", null, "translateX(0px)", ""));
                }
              }
            },
          });
        } else {
          const width = drawer.offsetWidth;
          const travel = width * direction;
          event.registerCallback({
            move: (moveEvent) => {
              const progress = Math.clamp(-(moveEvent - event.startX) * direction / width, 0, 1);
              const rest = 1 - progress;
              drawer.style.transform = "translateX(" + -progress * travel + "px)";
              backdrop.style.opacity = String(rest);
              if (sliding) {
                rootSplit.style.transform = "translateX(" + rest * travel + "px)";
                navbar.style.transform = "translateX(" + rest * travel + "px)";
              }
            },
            cancel: () => {
              if (sliding) navbar.style.transition = "";
              drawer.style.transform = "";
              backdrop.style.opacity = "1";
              if (sliding) {
                rootSplit.style.transform = "translateX(" + travel + "px)";
                navbar.style.transform = "translateX(" + travel + "px)";
              }
            },
            finish: (finishEvent, _velocity, velocityX) => {
              if (sliding) navbar.style.transition = "";
              const progress = Math.clamp(-(finishEvent - event.startX) * direction / width, 0, 1);
              const rest = 1 - progress;
              if (-velocityX * direction < width / 2) {
                const duration = SWIPE_DURATION * progress;
                env().yl(drawer, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", null, "translateX(0)", ""));
                env().yl(backdrop, new (env().dl)({ duration, fn: "ease-out" }).addProp("opacity", null, "1", ""));
                if (sliding) {
                  env().yl(rootSplit, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", null, "translateX(" + travel + "px)"));
                  env().yl(navbar, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", null, "translateX(" + travel + "px)"));
                }
              } else {
                self.collapsed = true;
                self.onCollapse();
                const duration = SWIPE_DURATION * rest;
                env().yl(drawer, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", "translateX(" + -progress * travel + "px)", "translateX(" + -travel + "px)", ""), () => drawer.hide());
                env().yl(backdrop, new (env().dl)({ duration, fn: "ease-out" }).addProp("opacity", String(rest), "0"), () => backdrop.detach());
                if (sliding) {
                  env().yl(rootSplit, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", null, "translateX(0px)", ""));
                  env().yl(navbar, new (env().dl)({ duration, fn: "ease-out" }).addProp("transform", null, "translateX(0px)", ""));
                }
              }
            },
          });
        }
      }));
      workspace.on("resize", () => {
        if (env().Yl.isPhone && this.isPinned) this.setPinned(false);
      });
    }

    serialize() {
      const data = super.serialize();
      data.currentTab = this.currentTab;
      if (this.isPinned) data.pinned = true;
      return data;
    }

    insertChild(index, node) {
      super.insertChild(index, node);
      if (node instanceof env().jD) node.tabHeaderEl.style.width = "";
    }

    removeChild(node) {
      const index = this.children.indexOf(node);
      const current = this.currentTab;
      const active = this.children[current];
      node.tabHeaderEl.removeClass("is-active");
      super.removeChild(node);
      if (this.children.length > 0 && index === current) {
        this.currentTab = Math.min(index, this.children.length - 1);
        this.workspace.onLayoutChange(this);
      } else {
        this.currentTab = this.children.indexOf(active);
      }
    }

    setTabOptionsCollapsed(collapsed) {
      this.tabOptionsCollapsed = collapsed;
      this.tabsContainerEl.toggleClass("is-collapsed", collapsed);
    }

    setupTabSelectTouchHandler() {
      this.tabsContainerEl.addEventListener("pointerdown", (event) => {
        if (!this.activeTabHeaderEl.contains(event.targetNode)) return;
        host.dragWithThreshold(event, () => {
          const wasCollapsed = this.tabOptionsCollapsed;
          if (wasCollapsed) {
            event.preventDefault();
            this.setTabOptionsCollapsed(false);
          }
          let dragging = false;
          let activeHeader = null;
          let lastHeader = null;
          const headers = this.children.map((child) => child.tabHeaderEl);
          return {
            move: (moveEvent) => {
              let header = null;
              const x = moveEvent.clientX;
              const y = moveEvent.clientY;
              const target = document.elementFromPoint(x, y);
              if (target) {
                for (let i = 0; i < headers.length; i++) {
                  if (headers[i].contains(target)) { header = headers[i]; break; }
                }
              }
              if (lastHeader !== header) {
                if (lastHeader) lastHeader.removeClass("is-swiping");
                if (header && navigator.vibrate) navigator.vibrate(0);
                lastHeader = header;
              }
              if (header) {
                if (!dragging) {
                  dragging = true;
                  this.tabsContainerEl.addClass("has-swipe");
                }
                activeHeader = headers.indexOf(header);
                header.addClass("is-swiping");
              }
            },
            end: (endEvent) => {
              if (dragging && activeHeader !== null) {
                endEvent.preventDefault();
                this.selectTabIndex(activeHeader);
                if (!env().Yl.isPhone && this.isPinned === false) {
                  this.workspace.setActiveLeaf(this.children[activeHeader], { focus: true });
                }
                this.setTabOptionsCollapsed(true);
              } else if (!dragging && !wasCollapsed) {
                endEvent.preventDefault();
                this.setTabOptionsCollapsed(true);
              }
            },
            cleanup: () => {
              if (lastHeader) lastHeader.removeClass("is-swiping");
              lastHeader = null;
              this.tabsContainerEl.removeClass("has-swipe");
            },
          };
        }, 0);
      });
    }

    expand() {
      if (this.collapsed) {
        this.collapsed = false;
        this.onExpand();
        env().Lv();
        this.workspace.app.mobileNavbar?.restoreNavigation();
        const backdrop = this.backdropEl;
        const drawer = this.containerEl;
        const rootSplit = this.workspace.rootSplit.containerEl;
        const navbar = this.app.mobileNavbar.containerEl;
        const duration = SWIPE_DURATION;
        const travel = drawer.offsetWidth * (this.side === "left" ? -1 : 1);
        env().yl(backdrop, new (env().dl)({ duration, fn: "linear" }).addProp("opacity", "0", "1", ""));
        env().yl(drawer, new (env().dl)({ duration }).addProp("transform", "translateX(" + travel + "px)", "translateX(0)", ""));
        if (env().Yl.isPhone && this.app.vault.getConfig("slidingSidebar")) {
          env().yl(rootSplit, new (env().dl)({ duration }).addProp("transform", null, "translateX(" + -travel + "px)"));
          env().yl(navbar, new (env().dl)({ duration }).addProp("transform", null, "translateX(" + -travel + "px)"));
        }
      }
    }

    fixIosEvent() {
      if (!env().Yl.isIosApp) return;
      const el = this.containerEl;
      el.show();
      el.offsetHeight;
      el.hide();
      el.offsetHeight;
      el.show();
    }

    onExpand() {
      this.workspace.containerEl.addClass("is-" + this.side + "-sidedock-open");
    }

    collapse() {
      if (this.isPinned || this.collapsed) return;
      this.collapsed = true;
      env().Lv();
      this.onCollapse();
      const backdrop = this.backdropEl;
      const drawer = this.containerEl;
      const rootSplit = this.workspace.rootSplit.containerEl;
      const navbar = this.app.mobileNavbar.containerEl;
      const duration = SWIPE_DURATION;
      const travel = drawer.offsetWidth * (this.side === "left" ? -1 : 1);
      env().yl(drawer, new (env().dl)({ duration }).addProp("transform", "translateX(0px)", "translateX(" + travel + "px)", ""), () => drawer.hide());
      env().yl(backdrop, new (env().dl)({ duration }).addProp("opacity", "1", "0"), () => backdrop.detach());
      if (env().Yl.isPhone && this.app.vault.getConfig("slidingSidebar")) {
        env().yl(rootSplit, new (env().dl)({ duration }).addProp("transform", null, "translateX(0px)", ""));
        env().yl(navbar, new (env().dl)({ duration }).addProp("transform", null, "translateX(0px)", ""));
      } else {
        rootSplit.style.transform = "";
        navbar.style.transform = "";
      }
    }

    onCollapse() {
      const workspace = this.workspace;
      const side = this.side;
      const active = workspace.activeLeaf;
      const container = workspace.containerEl;
      const rootSplit = workspace.rootSplit;
      container.removeClass("is-" + side + "-sidedock-open");
      if (active && active.getRoot() === this) {
        workspace.setActiveLeaf(workspace.getMostRecentLeaf(rootSplit));
      }
    }

    toggle() {
      if (this.collapsed) this.expand(); else this.collapse();
    }

    selectTabIndex(index) {
      this.currentTab = index;
      this.recomputeChildrenDimensions();
      this.workspace.requestSaveLayout();
      this.workspace.requestResize();
    }

    selectTab(leaf) {
      const index = this.children.indexOf(leaf);
      if (index !== -1) this.selectTabIndex(index);
    }

    recomputeChildrenDimensions() {
      const self = this;
      const inner = this.innerEl;
      const children = this.children;
      const header = this.headerEl;
      const activeTabContent = this.activeTabContentEl;
      const tabContainer = this.tabContainerEl;
      const optionsCollapsed = this.tabOptionsCollapsed;
      this.currentTab = Math.clamp(this.currentTab, 0, children.length - 1);
      const current = children[this.currentTab];
      if (current) {
        activeTabContent.setChildrenInPlace([current.containerEl]);
      } else {
        activeTabContent.empty();
      }
      this.updateCurrentTab();
      const headers = children.map((child, index) => {
        const el = child.tabHeaderEl;
        el.draggable = false;
        el.toggleClass("is-active", index === self.currentTab);
        return el;
      });
      this.tabsListEl.setChildrenInPlace(headers);
      this.tabsContainerEl.toggleClass("is-collapsed", optionsCollapsed);
      if (this.side === "left") {
        const ribbon = this.workspace.leftRibbon.containerEl;
        ribbon.removeClass("workspace-ribbon");
        ribbon.addClass("workspace-drawer-ribbon");
        inner.setChildrenInPlace([ribbon, header, tabContainer]);
      } else if (this.side === "right") {
        inner.setChildrenInPlace([header, tabContainer]);
      }
    }

    updateCurrentTab() {
      const current = this.children[this.currentTab];
      if (current) {
        env().tv(this.activeTabHeaderIconEl, current.getIcon());
        this.activeTabHeaderTitleEl.setText(current.getDisplayText());
      } else {
        env().tv(this.activeTabHeaderIconEl, "lucide-square-dashed");
        this.activeTabHeaderTitleEl.setText(env().gm.interface.emptyState.empty());
      }
    }

    openLeaf(leaf) {
      const index = this.children.indexOf(leaf);
      if (index !== -1) this.selectTabIndex(index);
    }

    addHeaderButton(icon, onclick) {
      return this.headerEl.createDiv("clickable-icon workspace-drawer-header-icon mod-raised", (el) => {
        env().tv(el, icon);
        el.addEventListener("click", onclick);
      });
    }

    setPinned(pinned) {
      if (!env().Yl.canPinSidebar) pinned = false;
      if (this.isPinned === pinned) return;
      this.isPinned = pinned;
      this.containerEl.toggleClass("is-pinned", pinned);
      this.backdropEl.toggle(!pinned);
      if (pinned) this.expand(); else this.collapse();
      this.workspace.requestUpdateLayout();
    }

    togglePinned() {
      this.setPinned(!this.isPinned);
    }
  };
  return drawerBase;
}
