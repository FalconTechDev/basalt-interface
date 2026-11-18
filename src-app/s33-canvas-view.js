// Canvas file view (r8) and the canvas plugin settings tab (s8).
//
// The view is a TextFileView whose document is the .canvas JSON; it owns the interactive
// canvas controller (`y5` in the bundle, reached through env) and serialises through the
// shared canvasSerialize helper. The settings tab edits the plugin's options object.
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { newlinesBefore } from "./text.js";
import { s13KeyNames } from "./s13-geom.js";
import { s33CanvasViewType, s33CanvasStrings } from "./s33-canvas-edge.js";

export function defineS33CanvasView(host) {
  const t = () => host.t;

  /** View for ".canvas" files: JSON document model + interactive canvas surface. */
  function CanvasView(leaf, plugin) {
    const self = host.TextFileView.call(this, leaf) || this;
    self.icon = "lucide-layout-dashboard";
    self.hoverPopover = null;
    self.isPlaintext = false;
    self.plugin = plugin;
    self.canvas = new (env().y5)(self);
    const scope = (self.scope = new host.Scope(self.app.scope));
    const editable = (evt) => host.isEditableTarget(evt.targetNode);
    scope.register(["Mod"], "z", (evt) => { if (!editable(evt)) { evt.preventDefault(); self.canvas.undo(); } });
    scope.register(["Mod"], "a", (evt) => { if (!editable(evt)) self.canvas.selectAll(); });
    const redo = (evt) => { if (!editable(evt)) { evt.preventDefault(); self.canvas.redo(); } };
    scope.register(["Mod", "Shift"], "z", redo);
    scope.register(["Mod"], "y", redo);
    scope.register(["Shift"], "1", (evt) => { if (!editable(evt)) self.canvas.zoomToFit(); });
    scope.register(["Shift"], "2", (evt) => { if (!editable(evt)) self.canvas.zoomToSelection(); });
    for (const [mods, key, dir] of [
      [[], "ArrowRight", "right"], [["Shift"], "ArrowRight", "right"],
      [[], "ArrowLeft", "left"], [["Shift"], "ArrowLeft", "left"],
      [[], "ArrowUp", "up"], [["Shift"], "ArrowUp", "up"],
      [[], "ArrowDown", "down"], [["Shift"], "ArrowDown", "down"],
    ]) {
      scope.register(mods, key, (evt) => { if (!editable(evt)) { evt.preventDefault(); self.canvas.nudgeSelection(evt, dir); } });
    }
    return self;
  }
  inherit(CanvasView, host.TextFileView);
  const proto = CanvasView.prototype;

  proto.setState = async function (state, result) {
    await host.TextFileView.prototype.setState.call(this, state, result);
    if (state.viewState) this.canvas.setState(state.viewState);
  };

  proto.getState = function () {
    const state = host.TextFileView.prototype.getState.call(this);
    state.viewState = this.canvas.getState();
    return state;
  };

  proto.setEphemeralState = function (state) {
    host.TextFileView.prototype.setEphemeralState.call(this, state);
    if (state.focus) this.canvas.wrapperEl.focus({ preventScroll: true });
    if (state.match !== undefined) {
      const canvas = this.canvas;
      const match = state.match;
      const nodeId = match.nodeId;
      const content = match.content;
      const matches = match.matches;
      const node = nodeId && canvas.nodes.get(nodeId);
      if (node) {
        canvas.selectOnly(node);
        canvas.panIntoView(node.getBBox());
        if (node instanceof canvas.TextNode && node.child instanceof canvas.MarkdownEmbed && matches.length > 0) {
          const offset = newlinesBefore(content, matches[0][0]);
          node.child.previewMode.renderer.applyScrollDelayed(offset, { center: true, highlight: true });
        }
      }
    }
  };

  proto.onResize = function () { this.canvas.onResize(); };

  proto.getViewType = function () { return s33CanvasViewType; };

  proto.getViewData = function () { return host.canvasSerialize(this.canvas.data); };

  proto.setViewData = function (data, clear) {
    const canvas = this.canvas;
    if (clear) this.clear();
    if (data) {
      canvas.setData(JSON.parse(data));
      if (clear) {
        canvas.zoomToFitQueued = true;
        canvas.onResize();
      }
    } else {
      canvas.createPlaceholder();
      canvas.requestFrame();
    }
    if (clear) {
      const local = this.getLocalData();
      if (local && local.hasOwnProperty("readonly") && typeof local.readonly === "boolean") {
        canvas.setReadonly(local.readonly);
      }
    }
  };

  proto.clear = function () { this.canvas.clear(); };

  proto.onOpen = async function () {
    this.canvas.load();
    return await host.TextFileView.prototype.onOpen.call(this);
  };

  proto.onClose = async function () {
    await host.TextFileView.prototype.onClose.call(this);
    this.canvas.unload();
  };

  proto.handleCut = function (evt) { this.canvas.handleCut(evt); };
  proto.handleCopy = function (evt) { this.canvas.handleCopy(evt); };
  proto.handlePaste = function (evt) { this.canvas.handlePaste(evt); };

  proto.onPaneMenu = function (menu, leaf) {
    host.TextFileView.prototype.onPaneMenu.call(this, menu, leaf);
    const view = this;
    if (host.Platform.isDesktopApp) {
      menu.addItem((item) =>
        item.setSection("action").setTitle(s33CanvasStrings().actionExportPng()).setIcon("lucide-image").onClick(() => view.canvas.generateHDImage()),
      );
    }
  };

  proto.getLocalData = function () {
    return this.plugin.localDataManager.load(this.file);
  };

  proto.saveLocalData = function () {
    const data = {};
    if (this.canvas.readonly) data.readonly = true;
    this.plugin.localDataManager.save(this.file, Object.keys(data).length === 0 ? null : data);
  };

  return CanvasView;
}

// ---- canvas settings tab (s8) -----------------------------------------------------------------

export function defineS33CanvasSettingsTab(host) {
  const canvasT = () => host.t.plugins.canvas;

  /** Plugin settings: default canvas location, wheel/drag behaviour, labels, grid, zoom. */
  function CanvasSettingsTab(app, plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, app, plugin) || this;
    self.icon = "layout-dashboard";
    self.instance = instance;
    return self;
  }
  inherit(CanvasSettingsTab, host.PluginInstanceSettingTab);
  const proto = CanvasSettingsTab.prototype;

  proto.display = function () {
    const self = this;
    const containerEl = this.containerEl;
    containerEl.empty();
    const options = this.instance.options;
    const t = host.t;
    let folderSetting;
    let slider;
    let extraButton;
    let locationDropdown;
    const syncFolderVisibility = () => {
      folderSetting.settingEl.toggle(locationDropdown.getValue() === "folder");
    };
    const syncExtraVisibility = (zoomBreakpoint) => {
      extraButton.extraSettingsEl.toggleVisibility(zoomBreakpoint !== 0);
    };
    new host.SettingGroup(containerEl)
      .addSetting((setting) =>
        setting.setName(canvasT().optionNewCanvasLocation()).addDropdown((dropdown) => {
          locationDropdown = dropdown;
          dropdown
            .addOption("root", t.setting.file.optionChoiceVaultRoot())
            .addOption("current", t.setting.file.optionChoiceCurrentFolder())
            .addOption("folder", t.setting.file.optionChoiceSpecifiedFolder())
            .setValue(options.newFileLocation || "root")
            .onChange((value) => {
              options.newFileLocation = value;
              self.plugin.saveData(options);
              syncFolderVisibility();
            });
        }),
      )
      .addSetting((setting) => {
        folderSetting = setting;
        return setting
          .setName(canvasT().optionNewCanvasFolderPath())
          .setDesc(canvasT().optionNewCanvasFolderPathDescription())
          .addText((text) => {
            text
              .setPlaceholder(t.setting.folderPathExamplePlaceholder())
              .setValue(options.newFileFolderPath === "/" ? "" : options.newFileFolderPath)
              .onChange((value) => {
                options.newFileFolderPath = value;
                self.plugin.saveData(options);
              });
            new host.FolderPathSuggest(self.app, text.inputEl, false, true);
          });
      })
      .addSetting((setting) =>
        setting.setName(canvasT().optionWheelBehavior()).addDropdown((dropdown) =>
          dropdown
            .addOption("pan", canvasT().labelPan())
            .addOption("zoom", canvasT().labelZoom())
            .setValue(options.defaultWheelBehavior || "pan")
            .onChange((value) => {
              options.defaultWheelBehavior = value;
              self.plugin.saveData(options);
            }),
        ),
      )
      .addSetting((setting) =>
        setting.setName(canvasT().optionModDragBehavior({ key: s13KeyNames(["Mod", "Drag"], host) })).addDropdown((dropdown) =>
          dropdown
            .addOption("menu", canvasT().optionShowMenu())
            .addOption("card", canvasT().actionAddCard())
            .addOption("note", canvasT().actionAddNote())
            .addOption("media", canvasT().actionAddMedia())
            .addOption("webpage", canvasT().actionAddWebsite())
            .addOption("group", canvasT().actionCreateGroup())
            .setValue(options.defaultModDragBehavior || "menu")
            .onChange((value) => {
              options.defaultModDragBehavior = value;
              self.plugin.saveData(options);
            }),
        ),
      )
      .addSetting((setting) =>
        setting.setName(canvasT().optionNodeLabel()).addDropdown((dropdown) =>
          dropdown
            .addOption("always", canvasT().labelAlways())
            .addOption("hover", canvasT().labelHover())
            .addOption("never", canvasT().labelNever())
            .setValue(options.cardLabelVisibility || "always")
            .onChange((value) => {
              options.cardLabelVisibility = value;
              self.plugin.saveData(options);
              self.instance.rerenderCanvases();
            }),
        ),
      )
      .addSetting((setting) =>
        setting.setName(canvasT().optionSnapToGrid()).setDesc(canvasT().optionSnapToGridDesc()).addToggle((toggle) =>
          toggle.setValue(options.snapToGrid).onChange((value) => {
            options.snapToGrid = value;
            self.plugin.saveData(options);
          }),
        ),
      )
      .addSetting((setting) =>
        setting.setName(canvasT().optionSnapToObjects()).setDesc(canvasT().optionSnapToObjectsDesc()).addToggle((toggle) =>
          toggle.setValue(options.snapToObjects).onChange((value) => {
            options.snapToObjects = value;
            self.plugin.saveData(options);
          }),
        ),
      )
      .addSetting((setting) =>
        setting
          .setName(canvasT().optionZoomBreakpoint())
          .setDesc(canvasT().optionZoomBreakpointDesc())
          .addExtraButton((button) => {
            extraButton = button;
            return button.setIcon("lucide-rotate-ccw").setTooltip(t.setting.hotkeys.tooltipRestoreDefault()).onClick(() => slider.setValue(0));
          })
          .addSlider((s) => {
            slider = s;
            s.setLimits(-0.7, 2.3999999999999995, 0.01)
              .setValue(options.zoomBreakpoint || 0)
              .onChange((value) => {
                options.zoomBreakpoint = value;
                self.plugin.saveData(options);
                syncExtraVisibility(value);
              });
          })
      );
    syncFolderVisibility();
    syncExtraVisibility(options.zoomBreakpoint || 0);
    if (window.__fpSettings) window.__fpSettings(containerEl, options, self.plugin, self.instance, host.Setting);
  };

  return CanvasSettingsTab;
}
