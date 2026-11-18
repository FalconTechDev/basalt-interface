// The left / right side docks of the workspace: a split that can collapse (animated) and be dragged to a new width.
import { inherit } from "./inherit.js";
import { runTransition, cancelTransition } from "./animation.js";

/** Narrowest a side dock may be dragged to before it counts as "collapsed". */
export const MIN_SIDEDOCK_WIDTH = 200;
/** Dragging below this width (px) collapses the dock. */
const COLLAPSE_BELOW = 50;
const DEFAULT_WIDTH = 300;
/** Timing of the collapse / expand slide. */
const SLIDE = { duration: 140, fn: "var(--anim-motion-swing)" };

export function defineWorkspaceSidedock(host) {
  function WorkspaceSidedock(workspace, direction, side, id) {
    const self = host.WorkspaceSplit.call(this, workspace, direction, id) || this;
    self.size = DEFAULT_WIDTH;
    self.collapsed = false;
    self.emptyStateEl = null;
    self.side = side;
    self.containerEl.addClass("mod-sidedock");
    self.containerEl.addClass(`mod-${side}-split`);
    self.workspace.containerEl.addClass(`is-${side}-sidedock-open`);
    if (side === "left") new host.VaultProfile(workspace.app, self.containerEl);
    self.resizeHandleEl.addEventListener("mousedown", self.onSidedockResizeStart.bind(self));
    self.emptyStateEl = self.containerEl.createDiv("workspace-sidedock-empty-state", (el) => {
      el.createEl("p", { cls: "u-muted", text: host.t.interface.emptySidebar() });
    });
    self.setSize(self.size);
    return self;
  }
  inherit(WorkspaceSidedock, host.WorkspaceSplit);

  WorkspaceSidedock.prototype.serialize = function () {
    const data = host.WorkspaceSplit.prototype.serialize.call(this);
    data.width = this.size;
    if (this.collapsed) data.collapsed = true;
    return data;
  };

  WorkspaceSidedock.prototype.setSize = function (px) {
    this.size = px;
    this.containerEl.style.width = `${px}px`;
  };

  WorkspaceSidedock.prototype.toggle = function () {
    if (this.collapsed) this.expand();
    else this.collapse();
  };

  /** The ribbon of this side (only the left and right docks have one). */
  WorkspaceSidedock.prototype.ribbonOfSide = function () {
    if (this.side === "left") return this.workspace.leftRibbon;
    if (this.side === "right") return this.workspace.rightRibbon;
    return null;
  };

  WorkspaceSidedock.prototype.collapse = function () {
    if (this.collapsed) return;
    this.collapsed = true;
    const { workspace, side, containerEl, resizeHandleEl, children } = this;
    workspace.containerEl.removeClass(`is-${side}-sidedock-open`);
    containerEl.addClass("is-sidedock-collapsed");
    const ribbon = this.ribbonOfSide();
    if (ribbon) ribbon.setCollapsedState(true);

    if (workspace.layoutReady) {
      // slide the width to 0 while the children keep their width, so their content does not reflow
      const width = `${this.size}px`;
      const childEls = children.map((child) => child.containerEl);
      for (const el of childEls) el.style.minWidth = width;
      cancelTransition(containerEl, true);
      containerEl.style.overflow = "hidden";
      runTransition(containerEl, new host.Transition(SLIDE).addProp("width", width, "0"), () => {
        containerEl.hide();
        containerEl.style.overflow = "";
        for (const el of childEls) el.style.minWidth = "";
        workspace.requestResize();
      });
    } else {
      containerEl.hide();
      containerEl.style.width = "0";
    }

    // focus must not stay in a hidden pane
    const active = workspace.activeLeaf;
    if (active && active.getRoot() === this) workspace.setActiveLeaf(workspace.getMostRecentLeaf(workspace.rootSplit), { focus: true });
    workspace.requestSaveLayout();
    workspace.updateFrameless();
    resizeHandleEl.style.opacity = "0";
  };

  WorkspaceSidedock.prototype.expand = function () {
    if (!this.collapsed) return;
    this.collapsed = false;
    const { workspace, side, containerEl, resizeHandleEl, children } = this;
    workspace.containerEl.addClass(`is-${side}-sidedock-open`);
    containerEl.removeClass("is-sidedock-collapsed");
    const ribbon = this.ribbonOfSide();
    if (ribbon) ribbon.setCollapsedState(false);

    const width = `${this.size}px`;
    const childEls = children.map((child) => child.containerEl);
    for (const el of childEls) el.style.minWidth = width;
    containerEl.show();
    cancelTransition(containerEl, true);
    containerEl.style.overflow = "hidden";
    runTransition(containerEl, new host.Transition(SLIDE).addProp("width", "0", width), () => {
      containerEl.style.overflow = "";
      for (const el of childEls) el.style.minWidth = "";
      workspace.requestResize();
    });
    workspace.requestSaveLayout();
    workspace.updateFrameless();
    resizeHandleEl.style.opacity = "1";
  };

  /** Drag of the dock's edge: resizes, collapses when pulled in far enough, expands again when pulled out. */
  WorkspaceSidedock.prototype.onSidedockResizeStart = function (downEvent) {
    if (downEvent.button !== 0) return;
    const win = downEvent.win;
    this.app.disableCssTransition();
    const onMove = (event) => {
      const x = event.clientX;
      let width = MIN_SIDEDOCK_WIDTH;
      const rect = this.containerEl.getBoundingClientRect();
      if (this.side === "left") {
        width = x - rect.x;
        width += this.resizeHandleEl.offsetWidth / 2;
      } else if (this.side === "right") {
        width = this.workspace.containerEl.clientWidth - x;
        width += this.resizeHandleEl.offsetWidth / 2;
      }
      if (!this.collapsed && width < COLLAPSE_BELOW) {
        this.collapse();
      } else if (this.collapsed && width >= MIN_SIDEDOCK_WIDTH) {
        this.expand();
      } else if (!this.collapsed) {
        const available = this.workspace.containerEl.clientWidth;
        this.setSize(Math.clamp(width, MIN_SIDEDOCK_WIDTH, Math.max(MIN_SIDEDOCK_WIDTH, 0.8 * available)));
      }
      event.preventDefault();
    };
    const onUp = (event) => {
      if (event.button !== 0) return;
      win.removeEventListener("mousemove", onMove);
      win.removeEventListener("mouseup", onUp);
      document.body.removeClass("is-grabbing");
      this.app.enableCssTransition();
      this.workspace.requestSaveLayout();
      this.workspace.requestResize();
    };
    win.addEventListener("mousemove", onMove);
    win.addEventListener("mouseup", onUp);
    document.body.addClass("is-grabbing");
  };

  /** An empty dock collapses and shows its placeholder (the right ribbon goes away with it). */
  WorkspaceSidedock.prototype.recomputeChildrenDimensions = function () {
    host.WorkspaceSplit.prototype.recomputeChildrenDimensions.call(this);
    if (this.children.length === 0) {
      this.collapse();
      this.emptyStateEl.show();
      if (this.side === "right") this.workspace.rightRibbon.hide();
    } else {
      this.emptyStateEl.hide();
      if (this.side === "right") this.workspace.rightRibbon.show();
    }
  };

  return WorkspaceSidedock;
}
