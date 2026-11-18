// Graph view: the global/local graph ItemViews, the force-directed engine that
// collects nodes from the metadata cache, the collapsible option sections and
// the internal "graph" plugin that registers the views and commands.
// The renderer itself (AQ) and the search/query helpers are app-scope names
// reached through env()/host.
import { env } from "./env.js";
import { s11Inherit } from "./s11-media.js";
import { s11GraphStrings } from "./s11-i18n.js";

// Graph option defaults; the manifest declarators PJ/IJ point at these.
export const s11ViewTypeGraph = "graph";
export const s11ViewTypeLocalGraph = "localgraph";
export const s11GraphParentSymbol = Symbol("parent");
export const s11GraphDisplayDefaults = { showArrow: false, textFadeMultiplier: 0, nodeSizeMultiplier: 1, lineSizeMultiplier: 1 };
export function s11GraphForceDefaults() {
  return { centerStrength: env().SJ(0.1, 0.01), repelStrength: 10, linkStrength: env().SJ(1, 0.01), linkDistance: 250 };
}

// Module slots filled by the factories below.
let S11GraphView = null, S11LocalGraphView = null, S11GraphEngine = null,
    S11ControlSection = null, S11FilterOptions = null, S11ColorOptions = null,
    S11DisplayOptions = null, S11ForceOptions = null;

// ---- option-section base (original: TJ; parent reached via env) ----
export function s11GraphControlSection() {
  function GraphControlSection(engine, section, title) {
    const self = env().XL.call(this) || this;
    self.engine = null;
    self.optionListeners = {};
    self.engine = engine;
    self.el.addClass("graph-control-section", `mod-${section}`);
    self.setCollapsible(true);
    self.setCollapsed(true, false);
    self.innerEl.createEl("header", { cls: "graph-control-section-header", text: title });
    self.optionListeners[`collapse-${section}`] = (value) => {
      if (value !== undefined && isBoolean(value)) self.setCollapsed(value, false);
      return self.collapsed;
    };
    return self;
  }
  s11Inherit(GraphControlSection, env().XL);
  const proto = GraphControlSection.prototype;
  proto.onSelfClick = function () { return this.toggleCollapsed(true); };
  proto.updateCollapsed = async function (collapsed) {
    await env().XL.prototype.updateCollapsed.call(this, collapsed);
    this.engine.onOptionsChange();
  };
  proto.setOptions = function (options) {
    const listeners = this.optionListeners;
    for (const key in options) {
      if (options.hasOwnProperty(key) && listeners.hasOwnProperty(key)) listeners[key](options[key]);
    }
  };
  proto.getOptions = function (out) {
    const listeners = this.optionListeners;
    for (const key in listeners) {
      if (listeners.hasOwnProperty(key)) {
        const value = listeners[key]();
        if (value !== undefined) out[key] = value;
      }
    }
  };
  S11ControlSection = GraphControlSection;
  return GraphControlSection;
}

// ---- filter section (original: DJ) ----
export function s11GraphFilterOptions(host) {
  function GraphFilterOptions(engine, isLocal) {
    const self = S11ControlSection.call(this, engine, "filter", s11GraphStrings().labelFilters()) || this;
    self.searchSetting = null;
    engine.controlsEl.appendChild(self.el);
    const childrenEl = self.childrenEl;
    const searchSetting = (self.searchSetting = new host.Setting(childrenEl).addSearch((setting) =>
      setting.setPlaceholder(s11GraphStrings().promptFilterNodes()).setValue("")
        .onChange(() => self.engine.requestUpdateSearch())
        .then((component) => {
          self.search = component;
          host.setTooltip(component.clearButtonEl, host.t.plugins.search.tooltipClearSearch());
          self.optionListeners.search = (value) => {
            if (value !== undefined) { component.setValue(value); self.engine.requestUpdateSearch(); }
            return component.getValue();
          };
          component.inputEl.addEventListener("keydown", (evt) => {
            if (evt.isComposing || evt.key !== "Enter") return;
            self.engine.updateSearch();
          });
          env().hJ.attach(engine.app, component.inputEl, false);
        })));
    searchSetting.settingEl.addClass("mod-search-setting");
    if (isLocal) {
      new host.Setting(childrenEl).setName(s11GraphStrings().optionDepth()).setTooltip(s11GraphStrings().optionDepthDescription())
        .setClass("mod-local-jumps").setClass("mod-slider").addSlider((slider) =>
          slider.setLimits(1, 5, 1).setValue(engine.options.localJumps).setDynamicTooltip().setInstant(true)
            .registerOptionListener(self.optionListeners, "localJumps")
            .onChange((value) => { engine.options.localJumps = value; engine.render(); engine.onOptionsChange(); }));
      new host.Setting(childrenEl).setName(s11GraphStrings().optionBacklinks()).setTooltip(s11GraphStrings().optionBacklinksDescription())
        .setClass("mod-toggle").addToggle((toggle) =>
          toggle.setValue(engine.options.localBacklinks)
            .registerOptionListener(self.optionListeners, "localBacklinks")
            .onChange((value) => { engine.options.localBacklinks = value; engine.render(); engine.onOptionsChange(); }));
      new host.Setting(childrenEl).setName(s11GraphStrings().optionForelinks()).setTooltip(s11GraphStrings().optionForelinksDescription())
        .setClass("mod-toggle").addToggle((toggle) =>
          toggle.setValue(engine.options.localForelinks)
            .registerOptionListener(self.optionListeners, "localForelinks")
            .onChange((value) => { engine.options.localForelinks = value; engine.render(); engine.onOptionsChange(); }));
      new host.Setting(childrenEl).setName(s11GraphStrings().optionNeighborLinks()).setTooltip(s11GraphStrings().optionNeighborLinksDescription())
        .setClass("mod-toggle").addToggle((toggle) =>
          toggle.setValue(engine.options.localInterlinks)
            .registerOptionListener(self.optionListeners, "localInterlinks")
            .onChange((value) => { engine.options.localInterlinks = value; engine.render(); engine.onOptionsChange(); }));
      new host.Setting(childrenEl).setName(s11GraphStrings().optionShowTags()).setTooltip(s11GraphStrings().optionShowTagsDescription())
        .setClass("mod-toggle").addToggle((toggle) =>
          toggle.setValue(engine.options.showTags)
            .registerOptionListener(self.optionListeners, "showTags")
            .onChange((value) => { engine.options.showTags = value; engine.render(); engine.onOptionsChange(); }));
      new host.Setting(childrenEl).setName(s11GraphStrings().optionShowAttachments()).setTooltip(s11GraphStrings().optionShowAttachmentsDescription())
        .setClass("mod-toggle").addToggle((toggle) =>
          toggle.setValue(engine.options.showAttachments)
            .registerOptionListener(self.optionListeners, "showAttachments")
            .onChange((value) => { engine.options.showAttachments = value; engine.render(); engine.onOptionsChange(); }));
      new host.Setting(childrenEl).setName(s11GraphStrings().optionShowExistingFilesOnly()).setTooltip(s11GraphStrings().optionShowExistingFilesOnlyDescription())
        .setClass("mod-toggle").addToggle((toggle) =>
          toggle.setValue(engine.options.hideUnresolved)
            .registerOptionListener(self.optionListeners, "hideUnresolved")
            .onChange((value) => { engine.options.hideUnresolved = value; engine.render(); engine.onOptionsChange(); }));
    } else {
      new host.Setting(childrenEl).setName(s11GraphStrings().optionShowOrphans()).setTooltip(s11GraphStrings().optionShowOrphansDescription())
        .setClass("mod-toggle").addToggle((toggle) =>
          toggle.setValue(engine.options.showOrphans)
            .registerOptionListener(self.optionListeners, "showOrphans")
            .onChange((value) => { engine.options.showOrphans = value; engine.render(); engine.onOptionsChange(); }));
    }
    return self;
  }
  s11Inherit(GraphFilterOptions, S11ControlSection);
  const proto = GraphFilterOptions.prototype;
  proto.startSearch = function () { this.searchSetting.settingEl.addClass("is-loading"); };
  proto.stopSearch = function () { this.searchSetting.settingEl.removeClass("is-loading"); };
  proto.setDefaultOptions = function () { this.setOptions(env().wQ); };
  S11FilterOptions = GraphFilterOptions;
  return GraphFilterOptions;
}

// ---- color groups section (original: AJ) ----
export function s11GraphColorOptions(host) {
  function GraphColorOptions(engine) {
    const self = S11ControlSection.call(this, engine, "color-groups", s11GraphStrings().labelGroups()) || this;
    engine.controlsEl.appendChild(self.el);
    self.optionListeners.colorGroups = (value) => {
      if (Array.isArray(value)) { self.setColorQueries(value); self.engine.requestUpdateSearch(); }
      return self.getColoredQueries();
    };
    self.setColorQueries([]);
    return self;
  }
  s11Inherit(GraphColorOptions, S11ControlSection);
  const proto = GraphColorOptions.prototype;
  proto.getColoredQueries = function () {
    const out = [];
    for (const group of this.groups) {
      out.push({ query: group.query.getValue(), color: { a: 1, rgb: group.color.getValueInt() } });
    }
    return out;
  };
  proto.setColorQueries = function (queries) {
    const self = this, childrenEl = this.childrenEl, groups = (this.groups = []);
    childrenEl.empty();
    const container = childrenEl.createDiv({ cls: "graph-color-groups-container" });
    const addGroup = (spec) => {
      const row = container.createDiv("graph-color-group");
      const query = new host.TextComponent(row).setPlaceholder(s11GraphStrings().placeholderEnterQuery())
        .setValue(spec.query).onChange(() => self.engine.requestUpdateSearch())
        .then((component) => env().hJ.attach(self.engine.app, component.inputEl, false));
      const color = new host.ColorComponent(row).setValueInt(spec.color ? spec.color.rgb : 0)
        .onChange(() => self.engine.updateSearch());
      const picker = color.colorPickerEl;
      host.setTooltip(picker, s11GraphStrings().tooltipClickToChangeDragToReorder());
      const group = { el: row, query, color };
      picker.addEventListener("mousedown", (evt) => self.onDragOption(evt, group));
      row.createDiv("clickable-icon", (el) => {
        host.setIcon(el, "lucide-x");
        host.setTooltip(el, s11GraphStrings().tooltipDeleteGraph());
        el.addEventListener("click", () => {
          groups.remove(group);
          row.detach();
          self.engine.updateSearch();
        });
      });
      groups.push(group);
    };
    for (const spec of queries) addGroup(spec);
    childrenEl.createDiv("graph-color-button-container", (el) => {
      el.createEl("button", { cls: "mod-cta", text: s11GraphStrings().buttonNewGroup() }, (btn) => {
        btn.addEventListener("click", () => {
          const hsl = { h: 40 * self.groups.length, s: self.engine.app.customCss.isDarkMode() ? 70 : 60, l: 60 };
          addGroup({ query: "", color: { a: 1, rgb: env().Rk(env().Lk(hsl)) } });
          self.engine.updateSearch();
        });
      });
    });
  };
  proto.onDragOption = function (evt, group) {
    const self = this;
    if (evt.button !== 0) return;
    const startX = evt.clientX, startY = evt.clientY;
    const row = group.el, rect = row.getBoundingClientRect();
    const offsetX = evt.clientX - rect.x, offsetY = evt.clientY - rect.y;
    let ghost = null;
    const onMove = (moveEvt) => {
      moveEvt.preventDefault();
      const x = moveEvt.clientX, y = moveEvt.clientY, doc = self.el.doc;
      if (ghost === null) {
        const dx = x - startX, dy = y - startY;
        if (dx * dx + dy * dy < 25) return;
        const width = row.offsetWidth;
        self.groups.remove(group);
        ghost = row.cloneNode(true);
        ghost.addClass("drag-ghost");
        ghost.style.width = width + "px";
        doc.body.appendChild(ghost);
        document.body.addClass("is-grabbing");
        self.childrenEl.addClass("is-grabbing");
      }
      const dropIndex = self.getDropIndex(moveEvt);
      row.detach();
      host.hideTooltip();
      if (ghost) {
        ghost.style.left = rect.x - offsetX + "px";
        ghost.style.top = y - offsetY + "px";
      }
      for (let i = 0; i < self.groups.length; i++) {
        const other = self.groups[i];
        other.el.style.top = i < dropIndex ? "0" : `${other.el.offsetHeight}px`;
      }
    };
    const onUp = (upEvt) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!ghost) return;
      ghost.detach();
      document.body.removeClass("is-grabbing");
      self.childrenEl.removeClass("is-grabbing");
      const dropIndex = self.getDropIndex(upEvt);
      self.groups.splice(dropIndex, 0, group);
      self.setColorQueries(self.getColoredQueries());
      self.engine.updateSearch();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  proto.getDropIndex = function (evt) {
    const y = evt.clientY;
    let index = 0;
    for (; index < this.groups.length; index++) {
      const rect = this.groups[index].el.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) return index;
    }
    return index;
  };
  S11ColorOptions = GraphColorOptions;
  return GraphColorOptions;
}

// ---- display section (original: LJ) ----
export function s11GraphDisplayOptions(host) {
  function GraphDisplayOptions(engine) {
    const self = S11ControlSection.call(this, engine, "display", s11GraphStrings().labelDisplay()) || this;
    engine.controlsEl.appendChild(self.el);
    const childrenEl = self.childrenEl;
    const slider = (nameKey, listener, limits, apply) => {
      const setting = new host.Setting(childrenEl).setName(s11GraphStrings()[nameKey]()).setClass("mod-slider");
      setting.addSlider((s) =>
        s.setLimits(...limits).setDynamicTooltip().setInstant(true)
          .registerOptionListener(self.optionListeners, listener)
          .onChange((value) => { apply(value); engine.onOptionsChange(); }));
    };
    new host.Setting(childrenEl).setName(s11GraphStrings().optionShowArrows()).setTooltip(s11GraphStrings().optionShowArrowsDescription())
      .setClass("mod-toggle").addToggle((toggle) =>
        toggle.registerOptionListener(self.optionListeners, "showArrow")
          .onChange((value) => { engine.renderer.setRenderOptions({ showArrow: value }); engine.onOptionsChange(); }));
    slider("optionTextFade", "textFadeMultiplier", [-3, 3, 0.1],
      (value) => engine.renderer.setRenderOptions({ textFadeMultiplier: value }));
    slider("optionNodeSize", "nodeSizeMultiplier", [0.1, 5, "any"],
      (value) => engine.renderer.setRenderOptions({ nodeSizeMultiplier: value }));
    slider("optionLinkThickness", "lineSizeMultiplier", [0.1, 5, "any"],
      (value) => engine.renderer.setRenderOptions({ lineSizeMultiplier: value }));
    if (!(engine.view instanceof S11LocalGraphView)) {
      new host.Setting(childrenEl).addButton((button) =>
        button.setButtonText(s11GraphStrings().buttonAnimateTimelapse()).setCta()
          .onClick(() => engine.renderProgression()));
    }
    return self;
  }
  s11Inherit(GraphDisplayOptions, S11ControlSection);
  const proto = GraphDisplayOptions.prototype;
  proto.setDefaultOptions = function () { this.setOptions(s11GraphDisplayDefaults); };
  S11DisplayOptions = GraphDisplayOptions;
  return GraphDisplayOptions;
}

// ---- forces section (original: OJ) ----
export function s11GraphForceOptions(host) {
  function GraphForceOptions(engine) {
    const self = S11ControlSection.call(this, engine, "forces", s11GraphStrings().labelForces()) || this;
    engine.controlsEl.appendChild(self.el);
    const childrenEl = self.childrenEl;
    const forceSlider = (nameKey, limits, listener, apply) =>
      new host.Setting(childrenEl).setName(s11GraphStrings()[nameKey]()).setClass("mod-slider")
        .addSlider((s) =>
          s.setLimits(...limits).setDynamicTooltip().setInstant(true)
            .registerOptionListener(self.optionListeners, listener)
            .onChange((value) => { apply(value); engine.onOptionsChange(); }));
    forceSlider("optionCenterForce", [0, 1, "any"], "centerStrength",
      (value) => engine.renderer.setForces({ centerStrength: env().MJ(value, 0.01) }));
    forceSlider("optionRepelForce", [0, 20, "any"], "repelStrength",
      (value) => engine.renderer.setForces({ repelStrength: value * value * value }));
    forceSlider("optionLinkForce", [0, 1, "any"], "linkStrength",
      (value) => engine.renderer.setForces({ linkStrength: env().MJ(value, 0.01) }));
    forceSlider("optionLinkDistance", [30, 500, 1], "linkDistance",
      (value) => engine.renderer.setForces({ linkDistance: value }));
    return self;
  }
  s11Inherit(GraphForceOptions, S11ControlSection);
  const proto = GraphForceOptions.prototype;
  proto.setDefaultOptions = function () { this.setOptions(s11GraphForceDefaults()); };
  S11ForceOptions = GraphForceOptions;
  return GraphForceOptions;
}

// ---- engine (original: xJ) ----
export function s11GraphEngine(host) {
  function GraphEngine(app, view, renderer) {
    const self = this;
    this.options = Object.assign({}, env().wQ);
    this.searchQueries = null;
    this.fileFilter = {};
    this.hasFilter = false;
    this.queue = null;
    this.onOptionsChange = host.debounce(() => self.view.onOptionsChange(), 100, true);
    this.lastHoverLink = null;
    this.hoverPopover = null;
    this.requestUpdateSearch = host.debounce(self.updateSearch.bind(self), 250, true);
    this.progression = 0;
    this.progressionSpeed = 20;
    this.currentFocusFile = "";
    this.app = app;
    this.view = view;
    this.renderer = renderer;
    renderer.onNodeClick = self.onNodeClick.bind(self);
    renderer.onNodeRightClick = self.onNodeRightClick.bind(self);
    renderer.onNodeHover = self.onNodeHover.bind(self);
    renderer.onNodeUnhover = self.onNodeUnhover.bind(self);
    const controlsEl = (this.controlsEl = renderer.containerEl.createDiv("graph-controls"));
    controlsEl.dataset.ignoreSwipe = "true";
    controlsEl.createDiv("clickable-icon graph-controls-button mod-close", (el) => {
      host.setIcon(el, "lucide-x");
      host.setTooltip(el, host.t.interface.menu.close());
      el.addEventListener("click", () => { controlsEl.addClass("is-close"); self.onOptionsChange(); });
    });
    controlsEl.createDiv("clickable-icon graph-controls-button mod-open", (el) => {
      host.setIcon(el, "lucide-settings");
      host.setTooltip(el, s11GraphStrings().tooltipOpenGraphSettings());
      el.addEventListener("click", () => { controlsEl.removeClass("is-close"); self.onOptionsChange(); });
    });
    if (!(view instanceof S11LocalGraphView)) {
      controlsEl.createDiv("clickable-icon graph-controls-button mod-animate", (el) => {
        host.setIcon(el, "lucide-wand-2");
        host.setTooltip(el, s11GraphStrings().tooltipStartTimelapseAnimation());
        el.addEventListener("click", () => self.renderProgression());
      });
    }
    controlsEl.createDiv({ cls: "clickable-icon graph-controls-button mod-reset" }, (el) => {
      host.setIcon(el, "lucide-rotate-ccw");
      host.setTooltip(el, host.t.interface.tooltipRestoreDefaultSettings());
      el.addEventListener("click", () => {
        self.filterOptions.setDefaultOptions();
        self.colorGroupOptions.setColorQueries([]);
        self.displayOptions.setDefaultOptions();
        self.forceOptions.setDefaultOptions();
      });
    });
    this.filterOptions = new S11FilterOptions(this, view instanceof S11LocalGraphView);
    this.colorGroupOptions = new S11ColorOptions(this);
    this.displayOptions = new S11DisplayOptions(this);
    this.forceOptions = new S11ForceOptions(this);
    this.filterOptions.setDefaultOptions();
    this.colorGroupOptions.setColorQueries([]);
    this.displayOptions.setDefaultOptions();
    this.forceOptions.setDefaultOptions();
  }
  const proto = GraphEngine.prototype;
  proto.load = function () {
    const self = this, app = this.app, view = this.view;
    const vault = app.vault, workspace = app.workspace, metadataCache = app.metadataCache;
    view.registerEvent(vault.on("create", this.onFileChanged, this));
    view.registerEvent(vault.on("modify", this.onFileChanged, this));
    view.registerEvent(vault.on("rename", this.recomputeFile, this));
    view.registerEvent(metadataCache.on("resolve", this.recomputeFile, this));
    view.registerEvent(workspace.on("css-change", this.onCssChange, this));
    view.registerEvent(workspace.on("file-open", this.onFileOpen, this));
    let lastScale = 0;
    view.registerInterval(window.setInterval(() => {
      if (this.renderer.targetScale !== lastScale) {
        lastScale = this.renderer.targetScale;
        this.onOptionsChange();
      }
    }, 2000));
    const keys = { 38: "up", 40: "down", 37: "left", 39: "right", 187: "zoomin", 189: "zoomout" };
    const onKey = (evt) => {
      const renderer = self.renderer;
      renderer.keyboardActions.shift = host.Keymap.isModifier(evt, "Shift");
      const isDown = evt.type === "keydown";
      if (isDown) {
        const doc = self.view.containerEl.doc;
        if (evt.repeat || evt.defaultPrevented || workspace.activeLeaf !== view.leaf || doc.activeElement !== doc.body) return;
      }
      if (keys.hasOwnProperty(evt.which)) {
        const action = keys[evt.which];
        renderer.keyboardActions[action] = isDown;
        renderer.changed();
      }
    };
    view.registerDomEvent(window, "keydown", onKey);
    view.registerDomEvent(window, "keyup", onKey);
  };
  proto.onCssChange = function () { this.renderer.testCSS(); };
  proto.updateSearch = function () {
    let queries = [];
    const text = this.filterOptions.search.getValue();
    if (text) queries.push({ query: text, color: null });
    queries = queries.concat(this.colorGroupOptions.getColoredQueries());
    this.setQuery(queries);
    this.onOptionsChange();
  };
  proto.setQuery = function (queries) {
    const self = this;
    if (this.queue) { this.queue.cancel(); this.queue = null; }
    this.hasFilter = false;
    const searchQueries = [], requiredInputs = {};
    for (const spec of queries) {
      let query = new (env().BH)(this.app, spec.query, false);
      if (!query.matcher) query = null;
      if (query) {
        searchQueries.push({ query, color: spec.color });
        if (query.requiredInputs) Object.assign(requiredInputs, query.requiredInputs);
        if (!spec.color) this.hasFilter = true;
      }
    }
    if (searchQueries.length === 0) {
      this.searchQueries = null;
      this.fileFilter = {};
      return this.render();
    }
    this.searchQueries = searchQueries;
    const fileFilter = (this.fileFilter = {});
    const queue = (this.queue = new (env().wb)({
      onStart: () => self.filterOptions.startSearch(),
      onStop: () => { self.render(); self.filterOptions.stopSearch(); },
      onCancel: () => { self.queue = null; self.filterOptions.stopSearch(); },
    }));
    const app = this.app;
    queue.addList(app.vault.getFiles());
    let lastRender = performance.now(), changed = true;
    env().VH(app, requiredInputs, queue, (file, type) => {
      let matches = true, color = null;
      for (const entry of searchQueries) {
        const result = entry.query.match(file, type);
        if (!result && !entry.color) { matches = false; break; }
        if (result && entry.color) { color = entry.color; break; }
      }
      fileFilter[file.path] = !!matches && (color || true);
      changed = changed || matches;
    }, {
      beforePause: (now) => {
        if (now < lastRender + 333) return;
        lastRender = now;
        if (changed) self.render();
        changed = false;
      },
    });
  };
  proto.render = function () {
    const app = this.app, view = this.view, renderer = this.renderer;
    const options = this.options, queries = this.searchQueries, filter = this.fileFilter;
    const isLocal = view instanceof S11LocalGraphView;
    let result, numLinks;
    if (!isLocal || options.localFile) {
      if (isLocal) this.progression = 0;
      const collect = (cache, opts, predicate, limit) => {
        const resolved = cache.resolvedLinks, unresolved = cache.unresolvedLinks;
        const vault = cache.vault, showAttachments = opts.showAttachments;
        const tagDisplay = {};
        if (opts.showTags) {
          const tags = cache.getTags();
          for (const tag in tags) if (tags.hasOwnProperty(tag)) tagDisplay[tag.toLowerCase()] = tag;
        }
        const nodes = {};
        let count = 0, current = "";
        const files = cache.getCachedFiles();
        if (limit) {
          const times = {};
          for (const path of files) {
            const f = vault.getAbstractFileByPath(path);
            times[path] = f instanceof env().$T ? Math.min(f.stat.ctime, f.stat.mtime) : Infinity;
          }
          files.sort((a, b) => times[a] - times[b]);
        }
        for (const path of files) {
          const isAttachment = env().Qy(path);
          if (!showAttachments && isAttachment) continue;
          const type = isAttachment ? "attachment" : "";
          const verdict = predicate(path, type);
          if (!verdict || cache.isUserIgnored(path)) continue;
          const node = (nodes[path] = env().kQ(type));
          const links = node.links;
          if (opts.showOrphans && (count === limit && (current = path), count++)) { /* counted below */ }
          if (!isBoolean(verdict)) node.color = verdict;
          if (resolved.hasOwnProperty(path)) {
            const targets = resolved[path];
            for (const target in targets) {
              if (!targets.hasOwnProperty(target)) continue;
              const targetIsAttachment = env().Qy(target);
              if (!showAttachments && targetIsAttachment) continue;
              if (!predicate(target, targetIsAttachment ? "attachment" : "")) continue;
              if (!limit || count < limit) links[target] = true;
              else if (count === limit) current = path;
              count++;
            }
          }
          if (!isLocal && unresolved.hasOwnProperty(path)) {
            const targets = unresolved[path];
            for (const target in targets) {
              if (!targets.hasOwnProperty(target)) continue;
              if (!predicate(target, "unresolved")) continue;
              if (!limit || count < limit) {
                links[target] = true;
                if (!nodes.hasOwnProperty(target)) nodes[target] = env().kQ("unresolved");
              } else if (count === limit) current = path;
              count++;
            }
          }
          if (opts.showTags) {
            const fileTags = env().DT(cache.getCache(path));
            if (fileTags && fileTags.length > 0) {
              for (const tag of fileTags) {
                if (!predicate(tag, "tag")) continue;
                const display = tagDisplay[tag.toLowerCase()] || tag;
                if (!limit || count < limit) links[display] = true;
                else if (count === limit) current = path;
                count++;
                if (!nodes.hasOwnProperty(display)) nodes[display] = env().kQ("tag");
              }
            }
          }
        }
        if (limit && current) {
          const index = files.indexOf(current);
          if (index !== -1) for (let i = index + 1; i < files.length; i++) delete nodes[files[i]];
        }
        return { nodes, numLinks: count };
      };
      result = collect(app.metadataCache, options, (path, type) => {
        if (!queries) return true;
        if (type === "") return path === options.localFile || (filter.hasOwnProperty(path) ? filter[path] : !this.hasFilter);
        if (type === "tag") return queries.every((q) => !!q.color || !!q.query.matchTag(path));
        if (type !== "attachment") return true;
        return queries.every((q) => !!q.color || !!q.query.matchFilepath(path));
      }, this.progression);
      numLinks = result.numLinks;
      if (options.localFile) result = env().PQ(result, options);
      if (!options.showOrphans) {
        const nodes = result.nodes, linked = {};
        for (const id in nodes) {
          if (nodes.hasOwnProperty(id)) {
            const links = nodes[id].links;
            for (const target in links) if (links.hasOwnProperty(target) && id !== target) linked[target] = true;
          }
        }
        for (const id in nodes) {
          if (nodes.hasOwnProperty(id)) {
            const links = nodes[id].links;
            let hasLink = false;
            for (const target in links) {
              if (links.hasOwnProperty(target) && nodes.hasOwnProperty(target) && id !== target) { hasLink = true; break; }
            }
            if (!hasLink && !linked[id]) delete nodes[id];
          }
        }
      }
      if (this.currentFocusFile) {
        const node = result.nodes[this.currentFocusFile];
        if (node) node.type = "focused";
      }
      renderer.setData(result);
    } else {
      renderer.setData({ nodes: {} });
      return;
    }
    return numLinks;
  };
  proto.renderProgression = async function () {
    this.progression = 1;
    const count = this.render();
    this.progressionSpeed = Math.clamp(0.5 * Math.sqrt(count), 5, 100);
    const start = Date.now();
    while (this.progression > 0) {
      const before = this.progression;
      await new Promise((resolve) => env().Pc(resolve, 0));
      if (before !== this.progression) continue;
      const next = 1 + Math.floor(this.progressionSpeed * (Date.now() - start) / 1000);
      if (next === this.progression) continue;
      this.progression = next;
      this.render();
    }
  };
  proto.onFileChanged = function (file) {
    if (file.extension !== "md") this.recomputeFile(file);
  };
  proto.recomputeFile = function (file) {
    const queue = this.queue;
    if (queue) queue.add(file);
  };
  proto.onFileOpen = function (leaf) {
    const path = leaf ? leaf.path : "";
    if (path !== this.currentFocusFile) {
      this.currentFocusFile = path;
      this.render();
    }
  };
  proto.onNodeClick = function (evt, linktext, type) {
    const app = this.app;
    if (type !== "tag") {
      app.workspace.openLinkText(linktext, "", host.Keymap.isModEvent(evt));
    } else {
      const search = app.internalPlugins.getEnabledPluginById("global-search");
      if (search) search.openGlobalSearch("tag:" + linktext);
    }
  };
  proto.onNodeRightClick = function (evt, linktext, type) {
    const self = this, app = this.app;
    if (type !== "tag") {
      const file = app.metadataCache.getFirstLinkpathDest(linktext, "");
      if (file && evt.instanceOf(MouseEvent)) {
        const menu = new host.Menu().addSections(["title", "open", "action", "info", "info.copy", "view", "view.linked", "system", "", "danger"]);
        menu.setSectionSubmenu("view.linked", { title: host.t.interface.menu.openLinkedView(), icon: "lucide-link" });
        menu.addItem((item) => item.setSection("title").setTitle(file.getShortName()).setIsLabel(true).titleEl.addClass("u-muted", "u-small"));
        menu.addItem((item) => item.setSection("open").setTitle(host.t.interface.menu.openInNewTab()).setIcon("lucide-file-plus")
          .onClick(async (clickEvt) => {
            await this.app.workspace.getLeaf(host.Keymap.isModEvent(clickEvt) || true).openLinkText(linktext, "");
          }));
        app.workspace.trigger("file-menu", menu, file, "graph-context-menu", this.view.leaf);
        menu.addItem((item) => item.setSection("danger").setTitle(host.t.interface.menu.deleteFile()).setIcon("lucide-trash-2")
          .setWarning(true).onClick(() => self.app.fileManager.promptForDeletion(file)));
        menu.showAtMouseEvent(evt);
      }
    } else {
      const search = app.internalPlugins.getEnabledPluginById("global-search");
      if (search) search.openGlobalSearch("tag:" + linktext);
    }
  };
  proto.onNodeHover = function (evt, linktext, type) {
    this.onNodeUnhover();
    if (!evt.instanceOf(MouseEvent)) return;
    const self = this, app = self.app;
    const popover = self.hoverPopover, last = self.lastHoverLink;
    if (type === "" || type === "focused" || type === "attachment") {
      if (popover && popover.state !== host.PopoverState.Hidden && last === linktext) {
        popover.onTarget = true;
        return popover.transition();
      }
      self.lastHoverLink = linktext;
      app.workspace.trigger("hover-link", { event: evt, source: "graph", hoverParent: self, targetEl: null, linktext });
    }
  };
  proto.onNodeUnhover = function () {
    const popover = this.hoverPopover;
    if (popover) { popover.onTarget = false; popover.transition(); }
  };
  proto.getOptions = function () {
    const options = {};
    this.filterOptions.getOptions(options);
    this.colorGroupOptions.getOptions(options);
    this.displayOptions.getOptions(options);
    this.forceOptions.getOptions(options);
    options.scale = this.renderer.targetScale;
    options.close = this.controlsEl.hasClass("is-close");
    return options;
  };
  proto.setOptions = function (options) {
    if (!options) return;
    this.filterOptions.setOptions(options);
    this.colorGroupOptions.setOptions(options);
    this.displayOptions.setOptions(options);
    this.forceOptions.setOptions(options);
    if (options.scale) this.renderer.zoomTo(options.scale);
    if (options.close) this.controlsEl.toggleClass("is-close", options.close);
    this.render();
  };
  S11GraphEngine = GraphEngine;
  return GraphEngine;
}

// ---- global graph view (original: kJ) ----
export function s11GraphView(host) {
  function GraphView(leaf) {
    const self = host.ItemView.call(this, leaf) || this;
    self.icon = "lucide-git-fork";
    self.navigation = true;
    const renderer = (self.renderer = new (env().AQ)(self.contentEl, !host.Platform.isIosApp, true));
    self.dataEngine = new S11GraphEngine(self.app, self, renderer);
    return self;
  }
  s11Inherit(GraphView, host.ItemView);
  const proto = GraphView.prototype;
  proto.getDisplayText = function () { return s11GraphStrings().name(); };
  proto.onload = function () {
    this.registerEvent(this.app.metadataCache.on("resolved", this.update, this));
    this.dataEngine.load();
    const plugin = this.app.internalPlugins.getPluginById("graph").instance;
    this.dataEngine.setOptions(plugin.options);
    this.dataEngine.requestUpdateSearch.run();
    this.update();
  };
  proto.getViewType = function () { return s11ViewTypeGraph; };
  proto.onClose = async function () { this.renderer.destroy(); };
  proto.onResize = function () { this.renderer.onResize(); };
  proto.showSearch = function () {
    const filter = this.dataEngine.filterOptions;
    this.dataEngine.controlsEl.removeClass("is-close");
    filter.setCollapsed(false, true);
    filter.search.autoSelect();
  };
  proto.onPaneMenu = function (menu, leaf) {
    host.ItemView.prototype.onPaneMenu.call(this, menu, leaf);
    const self = this;
    menu.addItem((item) => item.setSection("action").setTitle(s11GraphStrings().actionCopyScreenshot()).setIcon("lucide-image")
      .onClick(async () => {
        try {
          const shot = self.renderer.getTransparentScreenshot();
          await env().AQ.copyToClipboard(shot, "image/png");
          new host.Notice(s11GraphStrings().msgScreenshotCopied());
        } catch (e) {
          new host.Notice(e.toString());
        }
      }));
  };
  proto.update = function () { this.dataEngine.render(); };
  proto.onOptionsChange = function () {
    if (!this._loaded) return;
    const plugin = this.app.internalPlugins.getPluginById("graph").instance;
    plugin.options = this.dataEngine.getOptions();
    plugin.saveOptions();
  };
  GraphView.VIEW_TYPE = s11ViewTypeGraph;
  S11GraphView = GraphView;
  return GraphView;
}

// ---- local graph view (original: EJ) ----
export function s11LocalGraphView(host) {
  function LocalGraphView(leaf) {
    const self = host.ItemView.call(this, leaf) || this;
    self.icon = "lucide-git-fork";
    self.renderedFile = null;
    const renderer = (self.renderer = new (env().AQ)(self.contentEl, !host.Platform.isIosApp, true));
    self.engine = new S11GraphEngine(self.app, self, renderer);
    return self;
  }
  s11Inherit(LocalGraphView, host.ItemView);
  const proto = LocalGraphView.prototype;
  proto.getDisplayText = function () {
    if (!this.file || host.Platform.isMobile) return s11GraphStrings().name();
    return s11GraphStrings().tabTitle({ displayText: host.ItemView.prototype.getDisplayText.call(this) });
  };
  proto.getViewType = function () { return s11ViewTypeLocalGraph; };
  proto.canAcceptExtension = function () { return true; };
  proto.getState = function () {
    const state = host.ItemView.prototype.getState.call(this);
    state.options = this.engine.getOptions();
    return state;
  };
  proto.setState = async function (state, result) {
    if (state.options) this.engine.setOptions(state.options);
    return host.ItemView.prototype.setState.call(this, state, result);
  };
  proto.load = function () {
    host.ItemView.prototype.load.call(this);
    this.registerEvent(this.app.metadataCache.on("resolved", this.update, this));
    this.engine.load();
  };
  proto.onClose = async function () { this.renderer.destroy(); };
  proto.onFileChanged = function (file) { if (file === this.file) this.requestUpdate(); };
  proto.onResize = function () { this.renderer.onResize(); };
  proto.update = function () {
    const file = this.file, renderer = this.renderer, engine = this.engine;
    if (this.renderedFile !== file) {
      renderer.resetPan();
      this.renderedFile = file;
    }
    const options = engine.options;
    renderer.highlightNode = null;
    options.localFile = file ? file.path : null;
    engine.render();
  };
  proto.onPaneMenu = function (menu, leaf) {
    host.ItemView.prototype.onPaneMenu.call(this, menu, leaf);
    const self = this;
    menu.addItem((item) => item.setSection("action").setTitle(s11GraphStrings().actionCopyScreenshot()).setIcon("lucide-image")
      .onClick(async () => {
        try {
          const shot = self.renderer.getTransparentScreenshot();
          await env().AQ.copyToClipboard(shot, "image/png");
          new host.Notice(s11GraphStrings().msgScreenshotCopied());
        } catch (e) {
          new host.Notice(e.toString());
        }
      }));
  };
  LocalGraphView.VIEW_TYPE = s11ViewTypeLocalGraph;
  S11LocalGraphView = LocalGraphView;
  return LocalGraphView;
}

// ---- graph plugin (original: bJ) ----
export function s11GraphPlugin(host) {
  function GraphPlugin() {
    this.id = "graph";
    this.name = s11GraphStrings().name();
    this.description = s11GraphStrings().desc();
    this.defaultOn = true;
    this.app = null;
    this.plugin = null;
    this.options = {};
  }
  const proto = GraphPlugin.prototype;
  proto.init = function (app, plugin) {
    const self = this;
    this.app = app;
    this.plugin = plugin;
    plugin.registerRibbonItem(s11GraphStrings().actionOpen(), "lucide-git-fork", this.openGraphView.bind(this));
    plugin.registerGlobalCommand({
      id: "graph:open", name: s11GraphStrings().actionOpen(), icon: "lucide-git-fork",
      callback: this.openGraphView.bind(this), hotkeys: [env().Fb(["Mod"], "G")],
    });
    plugin.registerGlobalCommand({
      id: "graph:open-local", name: s11GraphStrings().actionOpenLocal(), icon: "lucide-git-fork",
      checkCallback: this.openLocalGraph.bind(this),
    });
    plugin.registerGlobalCommand({
      id: "graph:animate", name: s11GraphStrings().actionTimelapse(), icon: "lucide-wand",
      checkCallback: (checking) => {
        const view = self.app.workspace.getActiveViewOfType(S11GraphView);
        if (view) {
          if (!checking) view.dataEngine.renderProgression();
          return true;
        }
        return false;
      },
    });
    plugin.registerViewType(s11ViewTypeGraph, (leaf) => new S11GraphView(leaf));
    plugin.registerViewType(s11ViewTypeLocalGraph, (leaf) => new S11LocalGraphView(leaf));
  };
  proto.onEnable = async function (app, plugin) {
    plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
    this.options = (await plugin.loadData()) || {};
    app.workspace.registerHoverLinkSource("graph", { display: this.name, defaultMod: true });
  };
  proto.onDisable = function (app) {
    app.workspace.unregisterHoverLinkSource("graph");
  };
  proto.onExternalSettingsChange = async function () {
    this.options = (await this.plugin.loadData()) || {};
  };
  proto.onFileMenu = function (menu, file, source, leaf) {
    const self = this;
    if (file instanceof env().$T && leaf && file.extension === "md" && source !== "sidebar-context-menu") {
      menu.addItem((item) => item.setSection("view.linked").setTitle(s11GraphStrings().actionOpenLocal()).setIcon("lucide-git-fork")
        .onClick(async () => {
          await this.app.workspace.splitLeafOrActive(leaf, "vertical").setViewState({
            type: s11ViewTypeLocalGraph, active: true, group: leaf, state: { file: file.path },
          });
        }));
    }
  };
  proto.openGraphView = function (evt) {
    this.app.workspace.getLeaf(host.Keymap.isModEvent(evt ?? this.app.lastEvent)).setViewState({ type: s11ViewTypeGraph, active: true, state: {} });
  };
  proto.openLocalGraph = function (evt) {
    const workspace = this.app.workspace, file = workspace.getActiveFile();
    if (!file) return false;
    if (!evt) workspace.splitActiveLeaf("vertical").setViewState({ type: s11ViewTypeLocalGraph, active: true, group: workspace.activeLeaf, state: { file: file.path } });
    return true;
  };
  proto.saveOptions = function () { this.plugin.saveData(this.options); };
  return GraphPlugin;
}


