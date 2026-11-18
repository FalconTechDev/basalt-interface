// Canvas plugin (i8): view-type registration, global commands, ribbon item, file-menu entry,
// rename/delete handling, the canvas metadata index (e8), local data manager (n8) and the
// link updater hookup (t8). The view/embed/settings classes it instantiates are still the
// inherited ones until their own ports land; they are reached through the host map.
import { debounceCall } from "./timing.js";
import { parentPath } from "./path.js";
import { boxOfRect } from "./misc.js";
import { fileClass } from "./vault.js";

const CanvasViewType = (host) => host.CanvasViewType;
const CanvasView = (host) => host.CanvasViewClass;
const JumpToGroupModal = (host) => host.JumpToGroupModal;
const GroupNode = (host) => host.GroupNodeClass;
const CanvasEmbed = (host) => host.CanvasEmbedRenderer;
const CanvasSettingsTab = (host) => host.CanvasSettingsTab;
const RenameQueue = (host) => host.RenameQueue;
const canvasI18n = (host) => host.canvasI18n;
const cvTFolder = () => fileClass("TFolder");

export function defineCanvasPlugin(host) {
  class CanvasPlugin {
    constructor() {
      this.id = "canvas";
      this.name = canvasI18n(host).name();
      this.description = canvasI18n(host).desc();
      this.defaultOn = true;
      this.options = {};
      this.renames = [];
      this.renameQueue = new (RenameQueue(host))();
      this.requestProcessRename = debounceCall(() => {
        const batch = this.renames;
        this.renames = [];
        this.renameQueue.queue(async () => {
          const I18n = canvasI18n(host);
          const moved = batch.map((r) => r[0]);
          const dirty = [];
          const all = this.index.getAll();
          for (const path in all) {
            if (!Object.hasOwn(all, path)) continue;
            const entry = all[path];
            for (const embed of entry.embeds) {
              if (moved.contains(embed.file)) {
                dirty.push(path);
                break;
              }
            }
          }
          if (dirty.length === 0) return;
          const notice = new host.Notice(I18n.msgUpdatingLinks({ count: dirty.length }));
          notice.containerEl.addClass("is-loading");
          const vault = this.app.vault;
          let updated = 0;
          for (const path of dirty) {
            const file = vault.getAbstractFileByPath(path);
            if (!(file instanceof host.TFile)) continue;
            await vault.process(file, (text) => {
              if (!text) return text;
              const data = JSON.parse(text);
              for (const node of data.nodes) {
                if (node.type === "file") {
                  for (const [oldPath, newPath] of batch) {
                    if (node.file === oldPath) { node.file = newPath; updated++; }
                  }
                } else if (node.type === "group") {
                  for (const [oldPath, newPath] of batch) {
                    if (node.background === oldPath) { node.background = newPath; updated++; }
                  }
                }
              }
              return host.canvasSerialize(data);
            });
          }
          if (updated > 0) {
            notice.containerEl.removeClass("is-loading");
            notice.containerEl.addClass("mod-success");
            notice.setMessage(I18n.msgUpdatedLinks({ count: updated }));
          }
        });
      }, 500, true);
    }

    init(app, plugin) {
      const self = this;
      this.app = app;
      this.plugin = plugin;
      const viewType = CanvasViewType(host);
      plugin.registerViewType(viewType, (leaf) => new (CanvasView(host))(leaf, self));

      plugin.registerGlobalCommand({
        id: "canvas:new-file",
        name: canvasI18n(host).commandCreateNewCanvas(),
        icon: "lucide-layout-dashboard",
        callback: async () => {
          const active = this.app.workspace.getActiveFile()?.path;
          const parent = this.getNewFileParent(active);
          const file = await this.createNewCanvasFile(parent);
          await app.workspace.getLeaf().openFile(file, { eState: { rename: "all" } });
        },
      });

      if (host.Platform.isDesktopApp) {
        plugin.registerGlobalCommand({
          id: "canvas:export-as-image",
          name: canvasI18n(host).actionExportPng(),
          icon: "lucide-image",
          checkCallback: (checking) => {
            const view = this.app.workspace.getActiveViewOfType(CanvasView(host));
            if (!view) return false;
            if (!checking) view.canvas.generateHDImage();
            return true;
          },
        });
      }

      plugin.registerGlobalCommand({
        id: "canvas:jump-to-group",
        name: canvasI18n(host).actionJumpToGroup(),
        icon: "lucide-move",
        checkCallback: (checking) => {
          const view = this.app.workspace.getActiveViewOfType(CanvasView(host));
          if (!view) return false;
          if (!checking) {
            new (JumpToGroupModal(host))(view, (item) => {
              const box = boxOfRect(item);
              view.canvas.zoomToBbox(box);
            }).open();
          }
          return true;
        },
      });

      plugin.registerGlobalCommand({
        id: "canvas:convert-to-file",
        name: canvasI18n(host).commandConvertToFile(),
        icon: "lucide-file-input",
        checkCallback: (checking) => {
          const view = this.app.workspace.getActiveViewOfType(CanvasView(host));
          if (!view) return false;
          const selection = view.canvas.selection;
          if (selection.size === 1) {
            const node = selection.values().next().value;
            if (node instanceof (GroupNode(host))) {
              if (!checking) node.convertToFile();
              return true;
            }
          }
          return false;
        },
      });

      plugin.registerRibbonItem(
        canvasI18n(host).commandCreateNewCanvas(),
        "lucide-layout-dashboard",
        async (evt) => {
          const active = this.app.workspace.getActiveFile()?.path;
          const parent = this.getNewFileParent(active);
          const file = await this.createNewCanvasFile(parent);
          await app.workspace.getLeaf(host.Keymap.isModEvent(evt)).openFile(file, { active: true, eState: { rename: "all" } });
        },
      );

      this.index = plugin.addChild(new (canvas.MetadataExtractor)(app));
      this.localDataManager = new (canvas.DataCache)(app);
    }

    async onEnable(app, plugin) {
      plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
      plugin.registerEvent(app.vault.on("rename", this.onRename, this));
      plugin.registerEvent(app.vault.on("delete", this.onDelete, this));
      app.metadataCache.linkUpdaters[host.CANVAS_EXTENSION] = new (canvas.LinkUpdater)(app, this);
      plugin.register(() => { delete app.metadataCache.linkUpdaters[host.CANVAS_EXTENSION]; });
      app.viewRegistry.registerExtensions([host.CANVAS_EXTENSION], CanvasViewType(host));
      app.embedRegistry.registerExtension(host.CANVAS_EXTENSION, (m, el, ctx) => new (CanvasEmbed(host))(m, el, ctx));
      app.fileManager.registerFileParentCreator(host.CANVAS_EXTENSION, this.getNewFileParent.bind(this));
      this.options = Object.assign({ snapToObjects: true, snapToGrid: true }, await plugin.loadData());
      plugin.addSettingTab(new (CanvasSettingsTab(host))(app, plugin, this));
    }

    onDisable(app) {
      app.viewRegistry.unregisterExtensions([host.CANVAS_EXTENSION]);
      app.embedRegistry.unregisterExtension(host.CANVAS_EXTENSION);
      app.fileManager.unregisterFileCreator(host.CANVAS_EXTENSION);
    }

    async onExternalSettingsChange() {
      this.options = (await this.plugin.loadData()) || {};
      this.rerenderCanvases();
    }

    onUserDisable(app) {
      app.workspace.detachLeavesOfType(CanvasViewType(host));
    }

    onDelete(file) {
      if (file instanceof host.TFile && file.extension === host.CANVAS_EXTENSION) {
        this.localDataManager.handleDelete(file);
      }
    }

    onRename(file, oldPath) {
      if (file instanceof host.TFile && file.extension === host.CANVAS_EXTENSION) {
        this.localDataManager.handleRename(oldPath, file);
        this.renames.push([oldPath, file.path]);
        this.requestProcessRename();
      }
    }

    onFileMenu(menu, file, source) {
      if (source !== "file-explorer-context-menu" || !(file instanceof cvTFolder())) return;
      const self = this;
      menu.addItem((item) =>
        item
          .setSection("action-primary")
          .setIcon("lucide-layout-dashboard")
          .setTitle(canvasI18n(host).actionNewCanvas())
          .onClick(async (evt) => {
            const created = await self.createNewCanvasFile(file);
            await self.app.workspace.getLeaf(host.Keymap.isModEvent(evt)).openFile(created, { eState: { rename: "all" } });
          }),
      );
    }

    getNewFileParent(sourcePath) {
      const vault = this.app.vault;
      const { newFileLocation, newFileFolderPath } = this.options;
      if (newFileLocation === "folder") {
        if (newFileFolderPath != null) {
          const folder = vault.getAbstractFileByPath(newFileFolderPath);
          if (folder instanceof cvTFolder()) return folder;
        }
      } else if (sourcePath && newFileLocation === "current") {
        const parent = parentPath(sourcePath);
        const folder = vault.getAbstractFileByPath(parent);
        if (folder instanceof cvTFolder()) return folder;
      }
      return vault.getRoot();
    }

    createNewCanvasFile(folder, name, contents) {
      return this.app.fileManager.createNewFile(folder, name, host.CANVAS_EXTENSION, contents);
    }

    saveOptions() {
      this.plugin.saveData(this.options);
    }

    rerenderCanvases() {
      const leaves = this.app.workspace.getLeavesOfType(CanvasViewType(host));
      for (const leaf of leaves) {
        const view = leaf.view;
        if (view instanceof CanvasView(host)) view.canvas.rerenderViewport();
      }
    }
  }

  return CanvasPlugin;
}
