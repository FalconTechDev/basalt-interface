// Slice s28 — the graph view: the internal "graph" plugin, the global and local graph ItemViews,
// the graph data engine (query parsing, node collection, timelapse progression) and the four
// collapsible control sections (filter, colour groups, display, forces).
//
// Replaces the bundle items bJ, kJ, EJ, xJ, TJ, DJ, AJ, PJ, LJ, IJ, OJ, wJ, CJ, yJ and the
// small constants fJ/FJ/NJ. The PIXI renderer, the worker layout and the search/query stack are
// already own code (s09-graph.js, search-*.js); this module is the view + engine glue on top.

import { env } from "./env.js";
import { debounceCall } from "./timing.js";
import { idleOrTimeout, collectTags } from "./metadata-helpers.js";
import { extensionOf } from "./path.js";
import { makeHotkey } from "./text.js";
import { hideTooltip } from "./tooltip.js";
import { sliderCurve, sliderCurveInverse, hslToRgb, rgbToInt } from "./misc.js";
import { runSearchOverFiles } from "./n-g11-view.js";
import { extensionWithoutContent } from "./n-g11-query.js";
import { s09GraphDefaults, s09GraphNodeData, s09GraphLocalData, s09GraphRenderer } from "./s09-graph.js";
import { fileClass } from "./vault.js";

// Classes produced by the factories below; later factories reach earlier ones through here.
const s28Graph = {};

// host is passed to every factory; s28HostT is bound by the first one that runs (all share it).
let s28HostT = null;
function s28BindHost(host) {
  s28HostT = host;
  return host;
}

const graphStrings = () => s28HostT.t.plugins.graphView;
const graphSearchStrings = () => s28HostT.t.plugins.search;
const s28IsBoolean = (value) => typeof value === "boolean";

// View type names kept as bundle constants (fJ/wJ/CJ): the global-search plugin and other
// inherited code still read them, so they stay exported under their original values.
export const s28SearchViewType = "search";
export const s28GraphViewType = "graph";
export const s28LocalGraphViewType = "localgraph";

/** `yJ` — the graph view's i18n string table. */
export function s28GraphStrings(host) {
  return host.t.plugins.graphView;
}

/** `NJ` — the bookmarks plugin's i18n string table (kept for the inherited readers). */
export function s28BookmarkStrings(host) {
  return host.t.plugins.bookmarks;
}

/** `FJ` — the non-enumerable parent link the bookmark tree maintains (dead binding upstream). */
export const s28BookmarkParentSymbol = Symbol("parent");

/** `PJ` — display-section defaults. */
export const s28GraphDisplayDefaults = {
  showArrow: false, textFadeMultiplier: 0, nodeSizeMultiplier: 1, lineSizeMultiplier: 1,
};

/** `IJ` — force-section defaults (slider positions mapped through the curve helpers). */
export const s28GraphForceDefaults = {
  centerStrength: sliderCurveInverse(0.1, 0.01),
  repelStrength: 10,
  linkStrength: sliderCurveInverse(1, 0.01),
  linkDistance: 250,
};

/** True for paths whose extension carries no searchable text (attachments in graph terms). */
function s28IsAttachmentPath(path) {
  return extensionWithoutContent(extensionOf(path));
}

// =====================================================================================================================
// The collapsible control-section base (TJ): a tree item with a header and per-option listeners.
// =====================================================================================================================

export function s28GraphControlSection(host) {
  s28BindHost(host);
  const CollapsibleItem = env().XL;

  class GraphControlSection extends CollapsibleItem {
    constructor(engine, name, title) {
      super();
      this.engine = engine;
      this.optionListeners = {};
      this.el.addClass("graph-control-section", "mod-" + name);
      this.setCollapsible(true);
      this.setCollapsed(true, false);
      this.innerEl.createEl("header", { cls: "graph-control-section-header", text: title });
      this.optionListeners["collapse-" + name] = (value) => {
        if (value !== undefined && s28IsBoolean(value)) this.setCollapsed(value, false);
        return this.collapsed;
      };
    }

    onSelfClick(event) {
      this.toggleCollapsed(true);
    }

    async updateCollapsed(animate) {
      await super.updateCollapsed(animate);
      this.engine.onOptionsChange();
    }

    /** Feeds every stored option value that has a listener into the section's controls. */
    setOptions(options) {
      const listeners = this.optionListeners;
      for (const name in options) {
        if (Object.hasOwn(options, name) && Object.hasOwn(listeners, name)) listeners[name](options[name]);
      }
    }

    /** Collects the current control values; only listeners that return something contribute. */
    getOptions(out) {
      const listeners = this.optionListeners;
      for (const name in listeners) {
        if (Object.hasOwn(listeners, name)) {
          const value = listeners[name]();
          if (value !== undefined) out[name] = value;
        }
      }
    }
  }

  s28Graph.ControlSection = GraphControlSection;
  return GraphControlSection;
}

// =====================================================================================================================
// Filter section (DJ): the node search field plus the local-graph-only toggles.
// =====================================================================================================================

export function s28GraphFilterSection(host) {
  s28BindHost(host);
  const Base = s28Graph.ControlSection || s28GraphControlSection(host);

  class GraphFilterSection extends Base {
    constructor(engine, isLocalGraph) {
      super(engine, "filter", graphStrings().labelFilters());
      engine.controlsEl.appendChild(this.el);
      this.searchSetting = null;
      const childrenEl = this.childrenEl;
      const self = this;

      const searchSetting = (this.searchSetting = new host.Setting(childrenEl).addSearch((setting) => {
        return setting
          .setPlaceholder(graphStrings().promptFilterNodes())
          .setValue("")
          .onChange(() => engine.requestUpdateSearch())
          .then((component) => {
            self.search = component;
            host.setTooltip(component.clearButtonEl, graphSearchStrings().tooltipClearSearch());
            self.optionListeners.search = (value) => {
              if (value !== undefined) {
                component.setValue(value);
                engine.requestUpdateSearch();
              }
              return component.getValue();
            };
            component.inputEl.addEventListener("keydown", (event) => {
              if (!event.isComposing && event.key === "Enter") engine.updateSearch();
            });
            env().hJ.attach(engine.app, component.inputEl, false);
          });
      }));
      searchSetting.settingEl.addClass("mod-search-setting");

      if (isLocalGraph) {
        new host.Setting(childrenEl)
          .setName(graphStrings().optionDepth())
          .setTooltip(graphStrings().optionDepthDescription())
          .setClass("mod-local-jumps")
          .setClass("mod-slider")
          .addSlider((slider) =>
            slider
              .setLimits(1, 5, 1)
              .setValue(engine.options.localJumps)
              .setDynamicTooltip()
              .setInstant(true)
              .registerOptionListener(this.optionListeners, "localJumps")
              .onChange((value) => {
                engine.options.localJumps = value;
                engine.render();
                engine.onOptionsChange();
              }),
          );
        new host.Setting(childrenEl)
          .setName(graphStrings().optionBacklinks())
          .setTooltip(graphStrings().optionBacklinksDescription())
          .setClass("mod-toggle")
          .addToggle((toggle) =>
            toggle
              .setValue(engine.options.localBacklinks)
              .registerOptionListener(this.optionListeners, "localBacklinks")
              .onChange((value) => {
                engine.options.localBacklinks = value;
                engine.render();
                engine.onOptionsChange();
              }),
          );
        new host.Setting(childrenEl)
          .setName(graphStrings().optionForelinks())
          .setTooltip(graphStrings().optionForelinksDescription())
          .setClass("mod-toggle")
          .addToggle((toggle) =>
            toggle
              .setValue(engine.options.localForelinks)
              .registerOptionListener(this.optionListeners, "localForelinks")
              .onChange((value) => {
                engine.options.localForelinks = value;
                engine.render();
                engine.onOptionsChange();
              }),
          );
        new host.Setting(childrenEl)
          .setName(graphStrings().optionNeighborLinks())
          .setTooltip(graphStrings().optionNeighborLinksDescription())
          .setClass("mod-toggle")
          .addToggle((toggle) =>
            toggle
              .setValue(engine.options.localInterlinks)
              .registerOptionListener(this.optionListeners, "localInterlinks")
              .onChange((value) => {
                engine.options.localInterlinks = value;
                engine.render();
                engine.onOptionsChange();
              }),
          );
      }

      new host.Setting(childrenEl)
        .setName(graphStrings().optionShowTags())
        .setTooltip(graphStrings().optionShowTagsDescription())
        .setClass("mod-toggle")
        .addToggle((toggle) =>
          toggle
            .setValue(engine.options.showTags)
            .registerOptionListener(this.optionListeners, "showTags")
            .onChange((value) => {
              engine.options.showTags = value;
              engine.render();
              engine.onOptionsChange();
            }),
        );
      new host.Setting(childrenEl)
        .setName(graphStrings().optionShowAttachments())
        .setTooltip(graphStrings().optionShowAttachmentsDescription())
        .setClass("mod-toggle")
        .addToggle((toggle) =>
          toggle
            .setValue(engine.options.showAttachments)
            .registerOptionListener(this.optionListeners, "showAttachments")
            .onChange((value) => {
              engine.options.showAttachments = value;
              engine.render();
              engine.onOptionsChange();
            }),
        );
      new host.Setting(childrenEl)
        .setName(graphStrings().optionShowExistingFilesOnly())
        .setTooltip(graphStrings().optionShowExistingFilesOnlyDescription())
        .setClass("mod-toggle")
        .addToggle((toggle) =>
          toggle
            .setValue(engine.options.hideUnresolved)
            .registerOptionListener(this.optionListeners, "hideUnresolved")
            .onChange((value) => {
              engine.options.hideUnresolved = value;
              engine.render();
              engine.onOptionsChange();
            }),
        );
      if (!isLocalGraph) {
        new host.Setting(childrenEl)
          .setName(graphStrings().optionShowOrphans())
          .setTooltip(graphStrings().optionShowOrphansDescription())
          .setClass("mod-toggle")
          .addToggle((toggle) =>
            toggle
              .setValue(engine.options.showOrphans)
              .registerOptionListener(this.optionListeners, "showOrphans")
              .onChange((value) => {
                engine.options.showOrphans = value;
                engine.render();
                engine.onOptionsChange();
              }),
          );
      }
      return this;
    }

    startSearch() {
      this.searchSetting.settingEl.addClass("is-loading");
    }

    stopSearch() {
      this.searchSetting.settingEl.removeClass("is-loading");
    }

    setDefaultOptions() {
      this.setOptions(s09GraphDefaults);
    }
  }

  s28Graph.FilterSection = GraphFilterSection;
  return GraphFilterSection;
}

// =====================================================================================================================
// Colour-groups section (AJ): query+colour rows with drag reorder and a "new group" button.
// =====================================================================================================================

export function s28GraphColorSection(host) {
  s28BindHost(host);
  const Base = s28Graph.ControlSection || s28GraphControlSection(host);

  class GraphColorSection extends Base {
    constructor(engine) {
      super(engine, "color-groups", graphStrings().labelGroups());
      engine.controlsEl.appendChild(this.el);
      const self = this;
      this.groups = [];

      this.optionListeners.colorGroups = (value) => {
        if (Array.isArray(value)) {
          this.setColorQueries(value);
          this.engine.requestUpdateSearch();
        }
        return this.getColoredQueries();
      };
      this.setColorQueries([]);
      return this;
    }

    getColoredQueries() {
      const queries = [];
      for (const group of this.groups) {
        queries.push({ query: group.query.getValue(), color: { a: 1, rgb: group.color.getValueInt() } });
      }
      return queries;
    }

    setColorQueries(entries) {
      const self = this;
      const childrenEl = this.childrenEl;
      childrenEl.empty();
      const groups = (this.groups = []);
      const container = childrenEl.createDiv({ cls: "graph-color-groups-container" });

      const addGroup = (entry) => {
        const row = container.createDiv("graph-color-group");
        const query = new host.TextComponent(row)
          .setPlaceholder(graphStrings().placeholderEnterQuery())
          .setValue(entry.query)
          .onChange(() => self.engine.requestUpdateSearch())
          .then((component) => env().hJ.attach(self.engine.app, component.inputEl, false));
        const color = new host.ColorComponent(row)
          .setValueInt(entry.color ? entry.color.rgb : 0)
          .onChange(() => self.engine.updateSearch());
        const picker = color.colorPickerEl;
        host.setTooltip(picker, graphStrings().tooltipClickToChangeDragToReorder());
        const group = { el: row, query, color };
        picker.addEventListener("mousedown", (event) => self.onDragOption(event, group));
        row.createDiv("clickable-icon", (icon) => {
          host.setIcon(icon, "lucide-x");
          host.setTooltip(icon, graphStrings().tooltipDeleteGraph());
          icon.addEventListener("click", () => {
            groups.remove(group);
            row.detach();
            self.engine.updateSearch();
          });
        });
        groups.push(group);
      };

      for (const entry of entries) addGroup(entry);

      childrenEl.createDiv("graph-color-button-container", (buttonWrap) => {
        buttonWrap.createEl("button", { cls: "mod-cta", text: graphStrings().buttonNewGroup() }, (button) => {
          button.addEventListener("click", () => {
            const rgb = rgbToInt(hslToRgb({
              h: 40 * self.groups.length,
              s: self.engine.app.customCss.isDarkMode() ? 70 : 60,
              l: 60,
            }));
            addGroup({ query: "", color: { a: 1, rgb } });
            self.engine.updateSearch();
          });
        });
      });
    }

    /** Drag-to-reorder: past a 5px threshold a ghost follows the pointer and rows slide aside. */
    onDragOption(event, group) {
      if (event.button !== 0) return;
      const self = this;
      const startX = event.clientX;
      const startY = event.clientY;
      const row = group.el;
      const rect = row.getBoundingClientRect();
      const offsetX = event.clientX - rect.x;
      const offsetY = event.clientY - rect.y;
      let ghost = null;

      const onMove = (moveEvent) => {
        moveEvent.preventDefault();
        const doc = self.el.doc;
        if (ghost === null) {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
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
        const dropIndex = self.getDropIndex(moveEvent);
        row.detach();
        hideTooltip();
        if (ghost) {
          ghost.style.left = moveEvent.clientX - offsetX + "px";
          ghost.style.top = moveEvent.clientY - offsetY + "px";
        }
        for (let i = 0; i < self.groups.length; i++) {
          const other = self.groups[i];
          other.el.style.top = i < dropIndex ? "0" : other.el.offsetHeight + "px";
        }
      };
      const onUp = (upEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (ghost) {
          ghost.detach();
          document.body.removeClass("is-grabbing");
          self.childrenEl.removeClass("is-grabbing");
          const dropIndex = self.getDropIndex(upEvent);
          self.groups.splice(dropIndex, 0, group);
          self.setColorQueries(self.getColoredQueries());
          self.engine.updateSearch();
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }

    getDropIndex(event) {
      const y = event.clientY;
      for (let i = 0; i < this.groups.length; i++) {
        const rect = this.groups[i].el.getBoundingClientRect();
        if (y < rect.top + rect.height / 2) return i;
      }
      return this.groups.length;
    }
  }

  s28Graph.ColorSection = GraphColorSection;
  return GraphColorSection;
}

// =====================================================================================================================
// Display section (LJ): arrow toggle, fade/size/thickness sliders and the timelapse button.
// =====================================================================================================================

export function s28GraphDisplaySection(host) {
  s28BindHost(host);
  const Base = s28Graph.ControlSection || s28GraphControlSection(host);

  class GraphDisplaySection extends Base {
    constructor(engine) {
      super(engine, "display", graphStrings().labelDisplay());
      engine.controlsEl.appendChild(this.el);
      const childrenEl = this.childrenEl;
      const self = this;

      new host.Setting(childrenEl)
        .setName(graphStrings().optionShowArrows())
        .setTooltip(graphStrings().optionShowArrowsDescription())
        .setClass("mod-toggle")
        .addToggle((toggle) =>
          toggle
            .registerOptionListener(this.optionListeners, "showArrow")
            .onChange((value) => {
              engine.renderer.setRenderOptions({ showArrow: value });
              engine.onOptionsChange();
            }),
        );
      new host.Setting(childrenEl)
        .setName(graphStrings().optionTextFade())
        .setClass("mod-slider")
        .addSlider((slider) =>
          slider
            .setLimits(-3, 3, 0.1)
            .setDynamicTooltip()
            .setInstant(true)
            .registerOptionListener(this.optionListeners, "textFadeMultiplier")
            .onChange((value) => {
              engine.renderer.setRenderOptions({ textFadeMultiplier: value });
              engine.onOptionsChange();
            }),
        );
      new host.Setting(childrenEl)
        .setName(graphStrings().optionNodeSize())
        .setClass("mod-slider")
        .addSlider((slider) =>
          slider
            .setLimits(0.1, 5, "any")
            .setDynamicTooltip()
            .setInstant(true)
            .registerOptionListener(this.optionListeners, "nodeSizeMultiplier")
            .onChange((value) => {
              engine.renderer.setRenderOptions({ nodeSizeMultiplier: value });
              engine.onOptionsChange();
            }),
        );
      new host.Setting(childrenEl)
        .setName(graphStrings().optionLinkThickness())
        .setClass("mod-slider")
        .addSlider((slider) =>
          slider
            .setLimits(0.1, 5, "any")
            .setDynamicTooltip()
            .setInstant(true)
            .registerOptionListener(this.optionListeners, "lineSizeMultiplier")
            .onChange((value) => {
              engine.renderer.setRenderOptions({ lineSizeMultiplier: value });
              engine.onOptionsChange();
            }),
        );
      if (!(engine.view instanceof s28Graph.LocalGraphView)) {
        new host.Setting(childrenEl).addButton((button) =>
          button
            .setButtonText(graphStrings().buttonAnimateTimelapse())
            .setCta()
            .onClick(() => engine.renderProgression()),
        );
      }
      return this;
    }

    setDefaultOptions() {
      this.setOptions(s28GraphDisplayDefaults);
    }
  }

  s28Graph.DisplaySection = GraphDisplaySection;
  return GraphDisplaySection;
}

// =====================================================================================================================
// Forces section (OJ): the four d3-force sliders.
// =====================================================================================================================

export function s28GraphForceSection(host) {
  s28BindHost(host);
  const Base = s28Graph.ControlSection || s28GraphControlSection(host);

  class GraphForceSection extends Base {
    constructor(engine) {
      super(engine, "forces", graphStrings().labelForces());
      engine.controlsEl.appendChild(this.el);
      const childrenEl = this.childrenEl;

      const slider = (name, limits, map, key) =>
        new host.Setting(childrenEl)
          .setName(name)
          .setClass("mod-slider")
          .addSlider((component) =>
            component
              .setLimits(...limits)
              .setDynamicTooltip()
              .setInstant(true)
              .registerOptionListener(this.optionListeners, key)
              .onChange((value) => {
                engine.renderer.setForces(map(value));
                engine.onOptionsChange();
              }),
          );

      slider(graphStrings().optionCenterForce(), [0, 1, "any"], (v) => ({ centerStrength: sliderCurve(v, 0.01) }), "centerStrength");
      slider(graphStrings().optionRepelForce(), [0, 20, "any"], (v) => ({ repelStrength: v * v * v }), "repelStrength");
      slider(graphStrings().optionLinkForce(), [0, 1, "any"], (v) => ({ linkStrength: sliderCurve(v, 0.01) }), "linkStrength");
      slider(graphStrings().optionLinkDistance(), [30, 500, 1], (v) => ({ linkDistance: v }), "linkDistance");
      return this;
    }

    setDefaultOptions() {
      this.setOptions(s28GraphForceDefaults);
    }
  }

  s28Graph.ForceSection = GraphForceSection;
  return GraphForceSection;
}

// =====================================================================================================================
// The graph data engine (xJ): owns the options, the search query pipeline and the node collection
// that feeds the renderer. One instance per graph view.
// =====================================================================================================================

/** Collects {nodes, numLinks} from the metadata cache for the current options and query filter. */
function s28CollectGraphData(metaCache, options, includeNode, progression) {
  const resolvedLinks = metaCache.resolvedLinks;
  const unresolvedLinks = metaCache.unresolvedLinks;
  const vault = metaCache.vault;
  const showAttachments = options.showAttachments;
  const hideUnresolved = options.hideUnresolved;
  const showTags = options.showTags;
  const tagNames = {};
  if (showTags) {
    const allTags = metaCache.getTags();
    for (const tag in allTags) {
      if (Object.hasOwn(allTags, tag)) tagNames[tag.toLowerCase()] = tag;
    }
  }
  const nodes = {};
  let numLinks = 0;
  let files = metaCache.getCachedFiles();
  if (progression) {
    const times = {};
    for (const path of files) {
      const file = vault.getAbstractFileByPath(path);
      times[path] = file instanceof fileClass("TFile") ? Math.min(file.stat.ctime, file.stat.mtime) : 1 / 0;
    }
    files = files.slice().sort((a, b) => times[a] - times[b]);
  }
  let boundaryFile = "";
  for (const path of files) {
    const isAttachment = s28IsAttachmentPath(path);
    if (!showAttachments && isAttachment) continue;
    const kind = isAttachment ? "attachment" : "";
    const verdict = includeNode(path, kind);
    if (!verdict || metaCache.isUserIgnored(path)) continue;
    const node = (nodes[path] = s09GraphNodeData(kind));
    const links = node.links;
    if (options.showOrphans) {
      if (numLinks === progression) boundaryFile = path;
      numLinks++;
    }
    if (!s28IsBoolean(verdict)) node.color = verdict;

    if (Object.hasOwn(resolvedLinks, path)) {
      const targets = resolvedLinks[path];
      for (const target in targets) {
        if (!Object.hasOwn(targets, target)) continue;
        const targetIsAttachment = s28IsAttachmentPath(target);
        if (!showAttachments && targetIsAttachment) continue;
        const targetKind = targetIsAttachment ? "attachment" : "";
        if (includeNode(target, targetKind)) {
          if (!progression || numLinks < progression) links[target] = true;
          else if (numLinks === progression) boundaryFile = target;
          numLinks++;
        }
      }
    }
    if (!hideUnresolved && Object.hasOwn(unresolvedLinks, path)) {
      const targets = unresolvedLinks[path];
      for (const target in targets) {
        if (!Object.hasOwn(targets, target)) continue;
        if (includeNode(target, "unresolved")) {
          if (!progression || numLinks < progression) {
            links[target] = true;
            if (!Object.hasOwn(nodes, target)) nodes[target] = s09GraphNodeData("unresolved");
          } else if (numLinks === progression) boundaryFile = target;
          numLinks++;
        }
      }
    }
    if (showTags) {
      const cache = metaCache.getCache(path);
      const tags = collectTags(cache);
      if (tags && tags.length > 0) {
        for (const tag of tags) {
          if (includeNode(tag, "tag")) {
            const display = tagNames[tag.toLowerCase()] || tag;
            if (!progression || numLinks < progression) links[display] = true;
            else if (numLinks === progression) boundaryFile = path;
            numLinks++;
            if (!Object.hasOwn(nodes, display)) nodes[display] = s09GraphNodeData("tag");
          }
        }
      }
    }
  }
  if (progression && boundaryFile) {
    const index = files.indexOf(boundaryFile);
    if (index !== -1) {
      for (let i = index + 1; i < files.length; i++) delete nodes[files[i]];
    }
  }
  return { nodes, numLinks };
}

/** Drops nodes that neither link to an existing node nor are linked to (the !showOrphans pass). */
function s28PruneOrphanNodes(data) {
  const nodes = data.nodes;
  const linked = {};
  for (const id in nodes) {
    if (!Object.hasOwn(nodes, id)) continue;
    const links = nodes[id].links;
    for (const other in links) {
      if (Object.hasOwn(links, other) && id !== other) linked[other] = true;
    }
  }
  for (const id in nodes) {
    if (!Object.hasOwn(nodes, id)) continue;
    const links = nodes[id].links;
    let hasOutgoing = false;
    for (const other in links) {
      if (Object.hasOwn(links, other) && Object.hasOwn(nodes, other) && id !== other) {
        hasOutgoing = true;
        break;
      }
    }
    if (!hasOutgoing && !linked[id]) delete nodes[id];
  }
}

class GraphEngine {
  constructor(app, view, renderer) {
    this.options = Object.assign({}, s09GraphDefaults);
    this.searchQueries = null;
    this.fileFilter = {};
    this.hasFilter = false;
    this.queue = null;
    this.onOptionsChange = debounceCall(() => view.onOptionsChange(), 100, true);
    this.lastHoverLink = null;
    this.hoverPopover = null;
    this.requestUpdateSearch = debounceCall(this.updateSearch.bind(this), 250, true);
    this.progression = 0;
    this.progressionSpeed = 20;
    this.currentFocusFile = "";
    this.app = app;
    this.view = view;
    this.renderer = renderer;
    renderer.onNodeClick = this.onNodeClick.bind(this);
    renderer.onNodeRightClick = this.onNodeRightClick.bind(this);
    renderer.onNodeHover = this.onNodeHover.bind(this);
    renderer.onNodeUnhover = this.onNodeUnhover.bind(this);

    const controlsEl = (this.controlsEl = renderer.containerEl.createDiv("graph-controls"));
    controlsEl.dataset.ignoreSwipe = "true";
    controlsEl.createDiv("clickable-icon graph-controls-button mod-close", (el) => {
      s28HostT.setIcon(el, "lucide-x");
      s28HostT.setTooltip(el, s28HostT.t.interface.menu.close());
      el.addEventListener("click", () => {
        controlsEl.addClass("is-close");
        this.onOptionsChange();
      });
    });
    controlsEl.createDiv("clickable-icon graph-controls-button mod-open", (el) => {
      s28HostT.setIcon(el, "lucide-settings");
      s28HostT.setTooltip(el, graphStrings().tooltipOpenGraphSettings());
      el.addEventListener("click", () => {
        controlsEl.removeClass("is-close");
        this.onOptionsChange();
      });
    });
    if (!(view instanceof s28Graph.LocalGraphView)) {
      controlsEl.createDiv("clickable-icon graph-controls-button mod-animate", (el) => {
        s28HostT.setIcon(el, "lucide-wand-2");
        s28HostT.setTooltip(el, graphStrings().tooltipStartTimelapseAnimation());
        el.addEventListener("click", () => this.renderProgression());
      });
    }
    controlsEl.createDiv({ cls: "clickable-icon graph-controls-button mod-reset" }, (el) => {
      s28HostT.setIcon(el, "lucide-rotate-ccw");
      s28HostT.setTooltip(el, s28HostT.t.interface.tooltipRestoreDefaultSettings());
      el.addEventListener("click", () => {
        this.filterOptions.setDefaultOptions();
        this.colorGroupOptions.setColorQueries([]);
        this.displayOptions.setDefaultOptions();
        this.forceOptions.setDefaultOptions();
      });
    });

    this.filterOptions = new (s28Graph.FilterSection || s28GraphFilterSection(s28HostT))(this, view instanceof s28Graph.LocalGraphView);
    this.colorGroupOptions = new (s28Graph.ColorSection || s28GraphColorSection(s28HostT))(this);
    this.displayOptions = new (s28Graph.DisplaySection || s28GraphDisplaySection(s28HostT))(this);
    this.forceOptions = new (s28Graph.ForceSection || s28GraphForceSection(s28HostT))(this);
    this.filterOptions.setDefaultOptions();
    this.colorGroupOptions.setColorQueries([]);
    this.displayOptions.setDefaultOptions();
    this.forceOptions.setDefaultOptions();
  }

  load() {
    const app = this.app;
    const view = this.view;
    const vault = app.vault;
    const metaCache = app.metadataCache;
    const workspace = app.workspace;
    view.registerEvent(vault.on("create", this.onFileChanged, this));
    view.registerEvent(vault.on("modify", this.onFileChanged, this));
    view.registerEvent(vault.on("rename", this.recomputeFile, this));
    view.registerEvent(metaCache.on("resolve", this.recomputeFile, this));
    view.registerEvent(workspace.on("css-change", this.onCssChange, this));
    view.registerEvent(workspace.on("file-open", this.onFileOpen, this));

    let lastScale = 0;
    view.registerInterval(
      window.setInterval(() => {
        if (this.renderer.targetScale !== lastScale) {
          lastScale = this.renderer.targetScale;
          this.onOptionsChange();
        }
      }, 2000),
    );

    const keyToAction = { 38: "up", 40: "down", 37: "left", 39: "right", 187: "zoomin", 189: "zoomout" };
    const onKey = (event) => {
      const renderer = this.renderer;
      renderer.keyboardActions.shift = s28HostT.Keymap.isModEvent(event, "Shift");
      const isDown = event.type === "keydown";
      if (isDown) {
        const doc = this.view.containerEl.doc;
        if (event.repeat || event.defaultPrevented || workspace.activeLeaf !== view.leaf || doc.activeElement !== doc.body) return;
      }
      if (Object.hasOwn(keyToAction, event.which)) {
        const action = keyToAction[event.which];
        renderer.keyboardActions[action] = isDown;
        renderer.changed();
      }
    };
    view.registerDomEvent(window, "keydown", onKey);
    view.registerDomEvent(window, "keyup", onKey);
  }

  onCssChange() {
    this.renderer.testCSS();
  }

  /** Rebuilds the query list from the filter text plus every colour group's query. */
  updateSearch() {
    const queries = [];
    const text = this.filterOptions.search.getValue();
    if (text) queries.push({ query: text, color: null });
    for (const coloured of this.colorGroupOptions.getColoredQueries()) queries.push(coloured);
    this.setQuery(queries);
    this.onOptionsChange();
  }

  /** Parses the raw queries into SearchQuery objects and streams the vault through them. */
  setQuery(rawQueries) {
    const self = this;
    if (this.queue) {
      this.queue.cancel();
      this.queue = null;
    }
    this.hasFilter = false;
    const queries = [];
    const requiredInputs = {};
    for (const raw of rawQueries) {
      let query = new (env().BH)(this.app, raw.query, false);
      if (!query.matcher) query = null;
      if (query) {
        queries.push({ query, color: raw.color });
        if (query.requiredInputs) Object.assign(requiredInputs, query.requiredInputs);
        if (!raw.color) this.hasFilter = true;
      }
    }
    if (queries.length === 0) {
      this.searchQueries = null;
      this.fileFilter = {};
      return this.render();
    }
    const fileFilter = (this.fileFilter = {});
    const queue = (this.queue = new (env().wb)({
      onStart: () => this.filterOptions.startSearch(),
      onStop: () => {
        this.render();
        this.filterOptions.stopSearch();
      },
      onCancel: () => {
        this.queue = null;
        this.filterOptions.stopSearch();
      },
    }));
    queue.addList(this.app.vault.getFiles());
    let lastRender = performance.now();
    let dirty = true;
    runSearchOverFiles(
      this.app,
      requiredInputs,
      queue,
      (file, content) => {
        let included = true;
        let colour = null;
        for (const entry of queries) {
          const result = entry.query.match(file, content);
          if (!result && !entry.color) {
            included = false;
            break;
          }
          if (result && entry.color) {
            colour = entry.color;
            break;
          }
        }
        fileFilter[file.path] = included ? colour || true : false;
      },
      {
        beforePause: (now) => {
          if (now < lastRender + 333) return;
          lastRender = now;
          if (dirty) {
            this.render();
            dirty = false;
          }
        },
      },
    );
  }

  /** Builds the node set and pushes it to the renderer; returns the link count. */
  render() {
    const app = this.app;
    const view = this.view;
    const renderer = this.renderer;
    const queries = this.searchQueries;
    const fileFilter = this.fileFilter;
    const options = this.options;
    const isLocal = view instanceof s28Graph.LocalGraphView;
    if (!isLocal || options.localFile) {
      if (isLocal) this.progression = 0;
      const includeNode = (path, kind) => {
        if (!queries) return true;
        if (kind === "") {
          if (path === options.localFile) return true;
          return Object.hasOwn(fileFilter, path) ? fileFilter[path] : !this.hasFilter;
        }
        if (kind === "tag") {
          return queries.every((entry) => !!entry.color || !!entry.query.matchTag(path));
        }
        if (kind === "attachment") {
          return queries.every((entry) => !!entry.color || !!entry.query.matchFilepath(path));
        }
        return true;
      };
      let data = s28CollectGraphData(app.metadataCache, options, includeNode, this.progression);
      const numLinks = data.numLinks;
      if (options.localFile) data = s09GraphLocalData(data, options);
      if (!options.showOrphans) s28PruneOrphanNodes(data);
      const focused = data.nodes[this.currentFocusFile];
      if (focused) focused.type = "focused";
      renderer.setData(data);
      return numLinks;
    }
    renderer.setData({ nodes: {} });
  }

  /** Timelapse: grows the node set one "second of layout" at a time until the whole graph is in. */
  async renderProgression() {
    this.progression = 1;
    const numLinks = this.render();
    this.progressionSpeed = Math.clamp(0.5 * Math.sqrt(numLinks), 5, 100);
    const start = Date.now();
    for (;;) {
      if (this.progression <= 0) return;
      const seen = this.progression;
      await new Promise((resolve) => idleOrTimeout(resolve, 0));
      if (seen !== this.progression) return;
      const next = 1 + Math.floor((this.progressionSpeed * (Date.now() - start)) / 1000);
      if (next !== this.progression) {
        this.progression = next;
        this.render();
      }
    }
  }

  onFileChanged(file) {
    if (file.extension !== "md") this.recomputeFile(file);
  }

  recomputeFile(file) {
    const queue = this.queue;
    if (queue) queue.add(file);
  }

  onFileOpen(file) {
    const path = file ? file.path : "";
    if (path !== this.currentFocusFile) {
      this.currentFocusFile = path;
      this.render();
    }
  }

  onNodeClick(event, linkText, type) {
    const app = this.app;
    if (type !== "tag") {
      app.workspace.openLinkText(linkText, "", s28HostT.Keymap.isModEvent(event));
    } else {
      const search = app.internalPlugins.getEnabledPluginById("global-search");
      if (search) search.openGlobalSearch("tag:" + linkText);
    }
  }

  onNodeRightClick(event, linkText, type) {
    const app = this.app;
    if (type !== "tag") {
      const file = app.metadataCache.getFirstLinkpathDest(linkText, "");
      if (file && event.instanceOf(MouseEvent)) {
        const menu = new s28HostT.Menu()
          .addSections(["title", "open", "action", "info", "info.copy", "view", "view.linked", "system", "", "danger"]);
        menu.setSectionSubmenu("view.linked", {
          title: s28HostT.t.interface.menu.openLinkedView(),
          icon: "lucide-link",
        });
        menu.addItem((item) =>
          item.setSection("title").setTitle(file.getShortName()).setIsLabel(true).titleEl.addClass("u-muted", "u-small"),
        );
        menu.addItem((item) =>
          item
            .setSection("open")
            .setTitle(s28HostT.t.interface.menu.openInNewTab())
            .setIcon("lucide-file-plus")
            .onClick((clickEvent) =>
              app.workspace.getLeaf(s28HostT.Keymap.isModEvent(clickEvent) || true).openLinkText(linkText, ""),
            ),
        );
        app.workspace.trigger("file-menu", menu, file, "graph-context-menu", this.view.leaf);
        menu.addItem((item) =>
          item
            .setSection("danger")
            .setTitle(s28HostT.t.interface.menu.deleteFile())
            .setIcon("lucide-trash-2")
            .setWarning(true)
            .onClick(() => app.fileManager.promptForDeletion(file)),
        );
        menu.showAtMouseEvent(event);
      }
    } else {
      const search = app.internalPlugins.getEnabledPluginById("global-search");
      if (search) search.openGlobalSearch("tag:" + linkText);
    }
  }

  onNodeHover(event, linkText, type) {
    this.onNodeUnhover();
    if (!event.instanceOf(MouseEvent)) return;
    if (type === "" || type === "focused" || type === "attachment") {
      const popover = this.hoverPopover;
      if (popover && popover.state !== env().VQ.Hidden && this.lastHoverLink === linkText) {
        popover.onTarget = true;
        popover.transition();
        return;
      }
      this.lastHoverLink = linkText;
      this.app.workspace.trigger("hover-link", {
        event,
        source: "graph",
        hoverParent: this,
        targetEl: null,
        linktext: linkText,
      });
    }
  }

  onNodeUnhover() {
    const popover = this.hoverPopover;
    if (popover) {
      popover.onTarget = false;
      popover.transition();
    }
  }

  getOptions() {
    const options = {};
    this.filterOptions.getOptions(options);
    this.colorGroupOptions.getOptions(options);
    this.displayOptions.getOptions(options);
    this.forceOptions.getOptions(options);
    options.scale = this.renderer.targetScale;
    options.close = this.controlsEl.hasClass("is-close");
    return options;
  }

  setOptions(options) {
    if (!options) return;
    this.filterOptions.setOptions(options);
    this.colorGroupOptions.setOptions(options);
    this.displayOptions.setOptions(options);
    this.forceOptions.setOptions(options);
    if (options.scale) this.renderer.zoomTo(options.scale);
    if (options.close) this.controlsEl.toggleClass("is-close", options.close);
    this.render();
  }
}

/** Factory form of the engine class for the manifest (the class itself is shared, not per-call). */
export function s28GraphEngine(host) {
  s28BindHost(host);
  s28Graph.Engine = GraphEngine;
  return GraphEngine;
}

// =====================================================================================================================
// The global graph view (kJ).
// =====================================================================================================================

export function s28GraphView(host) {
  s28BindHost(host);

  class GraphView extends host.ItemView {
    constructor(leaf) {
      super(leaf);
      this.icon = "lucide-git-fork";
      this.navigation = true;
      this.renderer = new (s09GraphRenderer())(this.contentEl, !host.Platform.isIosApp, true);
      this.dataEngine = new GraphEngine(this.app, this, this.renderer);
    }

    getDisplayText() {
      return graphStrings().name();
    }

    onload() {
      this.registerEvent(this.app.metadataCache.on("resolved", this.update, this));
      this.dataEngine.load();
      const plugin = this.app.internalPlugins.getPluginById("graph").instance;
      this.dataEngine.setOptions(plugin.options);
      this.dataEngine.requestUpdateSearch.run();
      this.update();
    }

    getViewType() {
      return s28GraphViewType;
    }

    async onClose() {
      this.renderer.destroy();
    }

    onResize() {
      this.renderer.onResize();
    }

    showSearch() {
      const filterOptions = this.dataEngine.filterOptions;
      this.dataEngine.controlsEl.removeClass("is-close");
      filterOptions.setCollapsed(false, true);
      filterOptions.search.autoSelect();
    }

    onPaneMenu(menu, source) {
      super.onPaneMenu(menu, source);
      const self = this;
      menu.addItem((item) =>
        item
          .setSection("action")
          .setTitle(graphStrings().actionCopyScreenshot())
          .setIcon("lucide-image")
          .onClick(async () => {
            try {
              const canvas = self.renderer.getTransparentScreenshot();
              await self.renderer.copyToClipboard(canvas, "image/png");
              new host.Notice(graphStrings().msgScreenshotCopied());
            } catch (error) {
              new host.Notice(error.toString());
            }
          }),
      );
    }

    update() {
      this.dataEngine.render();
    }

    onOptionsChange() {
      if (!this._loaded) return;
      const plugin = this.app.internalPlugins.getPluginById("graph").instance;
      plugin.options = this.dataEngine.getOptions();
      plugin.saveOptions();
    }
  }

  s28Graph.GraphView = GraphView;
  return GraphView;
}

// =====================================================================================================================
// The local graph view (EJ): a FileView bound to the active file.
// =====================================================================================================================

export function s28LocalGraphView(host) {
  s28BindHost(host);
  const LinkPaneView = env().gJ;

  class LocalGraphView extends LinkPaneView {
    constructor(leaf) {
      super(leaf);
      this.icon = "lucide-git-fork";
      this.renderedFile = null;
      this.renderer = new (s09GraphRenderer())(this.contentEl, !host.Platform.isIosApp, true);
      this.engine = new GraphEngine(this.app, this, this.renderer);
    }

    getDisplayText() {
      if (!this.file || host.Platform.isMobile) return graphStrings().name();
      return graphStrings().tabTitle({ displayText: super.getDisplayText() });
    }

    getViewType() {
      return s28LocalGraphViewType;
    }

    canAcceptExtension() {
      return true;
    }

    getState() {
      const state = super.getState();
      state.options = this.engine.getOptions();
      return state;
    }

    async setState(state, result) {
      if (state.options) this.engine.setOptions(state.options);
      return super.setState(state, result);
    }

    load() {
      super.load();
      this.registerEvent(this.app.metadataCache.on("resolved", this.update, this));
      this.engine.load();
    }

    async onClose() {
      this.renderer.destroy();
    }

    onFileChanged(file) {
      if (file === this.file) this.requestUpdate();
    }

    onResize() {
      this.renderer.onResize();
    }

    update() {
      const file = this.file;
      const renderer = this.renderer;
      const engine = this.engine;
      if (this.renderedFile !== file) {
        renderer.resetPan();
        this.renderedFile = file;
      }
      const options = engine.options;
      renderer.highlightNode = null;
      options.localFile = file ? file.path : null;
      engine.render();
    }

    onPaneMenu(menu, source) {
      super.onPaneMenu(menu, source);
      const self = this;
      menu.addItem((item) =>
        item
          .setSection("action")
          .setTitle(graphStrings().actionCopyScreenshot())
          .setIcon("lucide-image")
          .onClick(async () => {
            try {
              const canvas = self.renderer.getTransparentScreenshot();
              await self.renderer.copyToClipboard(canvas, "image/png");
              new host.Notice(graphStrings().msgScreenshotCopied());
            } catch (error) {
              new host.Notice(error.toString());
            }
          }),
      );
    }

    onOptionsChange() {
      this.app.workspace.requestSaveLayout();
    }
  }

  s28Graph.LocalGraphView = LocalGraphView;
  return LocalGraphView;
}

// =====================================================================================================================
// The internal "graph" plugin (bJ): ribbon icon, commands, the two view types and the file menu entry.
// =====================================================================================================================

export function s28GraphPlugin(host) {
  s28BindHost(host);
  const TFile = fileClass("TFile");

  class GraphPlugin {
    constructor() {
      this.id = "graph";
      this.name = graphStrings().name();
      this.description = graphStrings().desc();
      this.defaultOn = true;
    }

    init(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      plugin.registerRibbonItem(graphStrings().actionOpen(), "lucide-git-fork", this.openGraphView.bind(this));
      plugin.registerGlobalCommand({
        id: "graph:open",
        name: graphStrings().actionOpen(),
        icon: "lucide-git-fork",
        callback: this.openGraphView.bind(this),
        hotkeys: [makeHotkey(["Mod"], "G")],
      });
      plugin.registerGlobalCommand({
        id: "graph:open-local",
        name: graphStrings().actionOpenLocal(),
        icon: "lucide-git-fork",
        checkCallback: this.openLocalGraph.bind(this),
      });
      plugin.registerGlobalCommand({
        id: "graph:animate",
        name: graphStrings().actionTimelapse(),
        icon: "lucide-wand",
        checkCallback: (checking) => {
          const view = this.app.workspace.getActiveViewOfType(s28Graph.GraphView);
          if (view) {
            if (!checking) view.dataEngine.renderProgression();
            return true;
          }
        },
      });
      plugin.registerViewType(s28GraphViewType, (leaf) => new (s28Graph.GraphView || s28GraphView(host))(leaf));
      plugin.registerViewType(s28LocalGraphViewType, (leaf) => new (s28Graph.LocalGraphView || s28LocalGraphView(host))(leaf));
    }

    async onEnable(app, plugin) {
      plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
      this.options = (await plugin.loadData()) || {};
      app.workspace.registerHoverLinkSource("graph", { display: this.name, defaultMod: true });
    }

    onDisable(app) {
      app.workspace.unregisterHoverLinkSource("graph");
    }

    async onExternalSettingsChange() {
      this.options = (await this.plugin.loadData()) || {};
    }

    onFileMenu(menu, file, source, leaf) {
      if (!(file instanceof TFile) || !leaf || file.extension !== "md" || source === "sidebar-context-menu") return;
      const self = this;
      menu.addItem((item) =>
        item
          .setSection("view.linked")
          .setTitle(graphStrings().actionOpenLocal())
          .setIcon("lucide-git-fork")
          .onClick(async () => {
            await self.app.workspace
              .splitLeafOrActive(leaf, "vertical")
              .setViewState({ type: s28LocalGraphViewType, active: true, group: leaf, state: { file: file.path } });
          }),
      );
    }

    openGraphView(event) {
      this.app.workspace
        .getLeaf(s28HostT.Keymap.isModEvent(event != null ? event : this.app.lastEvent))
        .setViewState({ type: s28GraphViewType, active: true, state: {} });
    }

    openLocalGraph(checking) {
      const workspace = this.app.workspace;
      const file = workspace.getActiveFile();
      if (!file) return;
      if (!checking) {
        workspace.splitActiveLeaf("vertical").setViewState({
          type: s28LocalGraphViewType,
          active: true,
          group: workspace.activeLeaf,
          state: { file: file.path },
        });
      }
      return true;
    }

    saveOptions() {
      this.plugin.saveData(this.options);
    }
  }

  s28Graph.Plugin = GraphPlugin;
  return GraphPlugin;
}
