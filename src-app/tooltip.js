// Tooltips: every element with an `aria-label` shows it after the pointer rests on it. One tooltip exists at a time, the next one
// shows without delay when it comes right after the previous one was hidden.
//
// Public pieces (plugin API names in brackets): showTooltip [displayTooltip], hideTooltip, setElementTooltip [setTooltip],
// setDynamicTooltip, installTooltipHandlers (per document, listens on <body>).

const DEFAULT_GAP = 8;
const TOP_EXTRA_GAP = 5;       // a top tooltip sits a bit higher than the plain gap
const QUICK_FOLLOW_MS = 100;   // within this time after one tooltip hid, the next shows at once
const DEFAULT_DELAY = 1000;    // used when an element has no data-tooltip-delay

let current = null;            // the tooltip element on screen
let currentTarget = null;      // the element it belongs to
let delayTimer = null;
let lastHidden = 0;            // Date.now() of the last hide
/** element -> function that computes its tooltip text each time it is shown */
const dynamicText = new WeakMap();

function cancelDelay() {
  if (delayTimer) {
    clearTimeout(delayTimer);
    delayTimer = null;
  }
}

/** Elements can opt out with the CSS custom property --no-tooltip: true. */
function tooltipsDisabledFor(el) {
  return getComputedStyle(el).getPropertyValue("--no-tooltip").trim() === "true";
}

/** Removes the tooltip (and a pending one). */
export function hideTooltip() {
  cancelDelay();
  if (current) {
    lastHidden = Date.now();
    current.detach();
    current = null;
    currentTarget = null;
  }
}

/**
 * Shows `text` next to `el`. options: placement "bottom" | "top" | "left" | "right", classes, gap, horizontalParent (align to this
 * element's width instead), delay (ms before it appears; skipped when a tooltip was just visible).
 */
export function displayTooltip(el, text, options) {
  if (!text) return;
  options = options || {};
  const placement = options.placement === undefined ? "bottom" : options.placement;
  const classes = options.classes === undefined ? [] : options.classes;
  const gap = options.gap === undefined ? DEFAULT_GAP : options.gap;
  const horizontalParent = options.horizontalParent;
  const delay = options.delay === undefined ? 0 : options.delay;

  if (delay > 0 && (current || Date.now() > lastHidden + QUICK_FOLLOW_MS)) {
    cancelDelay();
    options.delay = 0;
    delayTimer = window.setTimeout(() => displayTooltip(el, text, options), delay);
    return;
  }
  if (!el.isShown()) return;

  const doc = el.doc;
  const rect = el.getBoundingClientRect();
  let { top, left, width } = rect;
  const height = rect.height;
  if (horizontalParent) {
    const parentRect = horizontalParent.getBoundingClientRect();
    left = parentRect.left;
    width = parentRect.width;
  }
  if (current && currentTarget === el) {
    current.setText(text);
  } else {
    hideTooltip();
    current = createDiv({ cls: "tooltip", text });
  }
  const arrow = current.createDiv("tooltip-arrow");

  // anchor point of the tooltip: (x, y) = where the arrow tip points
  let y = 0;
  let x = 0;
  if (placement === "bottom") {
    y = top + height + gap;
    x = left + width / 2;
  } else if (placement === "right") {
    y = top + height / 2;
    x = left + width + gap;
    classes.push("mod-right");
  } else if (placement === "left") {
    y = top + height / 2;
    x = left - gap;
    classes.push("mod-left");
  } else if (placement === "top") {
    y = top - gap - TOP_EXTRA_GAP;
    x = left + width / 2;
    classes.push("mod-top");
  }
  current.addClasses(classes);
  current.style.top = "0px";
  current.style.left = "0px";
  current.style.width = "";
  current.style.height = "";
  if (!current.parentNode) doc.body.appendChild(current);

  // measure it, then move the anchor so the box lies inside the window
  const box = current.getBoundingClientRect();
  const halfWidth = placement === "bottom" || placement === "top" ? box.width / 2 : box.width;
  const halfHeight = placement === "right" || placement === "left" ? box.height / 2 : box.height;
  if (placement === "left") x -= halfWidth;
  else if (placement === "top") y -= halfHeight;
  const viewHeight = doc.body.clientHeight;
  const viewWidth = doc.body.clientWidth;
  if (y + halfHeight > viewHeight) y = viewHeight - halfHeight - gap;
  y = Math.max(y, gap);
  if (placement === "top" || placement === "bottom") {
    if (x + halfWidth > viewWidth) {
      // too far right: slide left and keep the arrow on the target
      const shift = x + halfWidth + gap - viewWidth;
      x -= shift;
      arrow.style.left = "initial";
      arrow.style.right = halfWidth - shift - gap / 2 + "px";
    } else if (x - gap - halfWidth < 0) {
      const shift = -(x - gap - halfWidth);
      x += shift;
      arrow.style.right = "initial";
      arrow.style.left = halfWidth - shift - gap / 2 + "px";
    }
    x = Math.max(x, gap);
  }
  current.style.top = y + "px";
  current.style.left = x + "px";
  current.style.width = box.width + "px";
  current.style.height = box.height + "px";
  currentTarget = el;
}

/** Stores placement / classes / delay on the element as data attributes (read again when the tooltip is shown by hover). */
export function applyTooltipOptions(el, options) {
  const { placement, classes, delay } = options || {};
  if (placement && placement !== "bottom") el.setAttribute("data-tooltip-position", placement);
  if (classes) el.setAttribute("data-tooltip-classes", classes.join(" "));
  if (delay) el.setAttribute("data-tooltip-delay", String(delay));
}

/** setTooltip(el, text, options): gives the element its tooltip (aria-label); updates the visible one when it is showing. */
export function setElementTooltip(el, text, options) {
  el.setAttribute("aria-label", text);
  applyTooltipOptions(el, options);
  if (currentTarget === el) displayTooltip(el, text, options);
}

/** Like setElementTooltip, but `getText(el)` is asked each time the tooltip is about to show. */
export function setDynamicTooltip(el, getText, options) {
  el.setAttribute("aria-label", "");
  dynamicText.set(el, getText);
  applyTooltipOptions(el, options);
  if (currentTarget === el) displayTooltip(el, getText(el), options);
}

/** Shows the tooltip of `el` as its attributes describe it. */
export function showTooltipFromAttributes(el) {
  cancelDelay();
  let text = el.getAttribute("aria-label") || "";
  if (dynamicText.has(el)) text = dynamicText.get(el)(el);
  let placement = "bottom";
  if (el.hasAttribute("data-tooltip-position")) placement = el.getAttribute("data-tooltip-position");
  let classes = [];
  if (el.hasAttribute("data-tooltip-classes")) classes = (el.getAttribute("data-tooltip-classes") || "").split(" ");
  let delay = DEFAULT_DELAY;
  if (el.hasAttribute("data-tooltip-delay")) {
    delay = parseInt(el.getAttribute("data-tooltip-delay") || "");
    if (isNaN(delay)) delay = DEFAULT_DELAY;
  }
  displayTooltip(el, text, { placement, classes, delay });
}

/** Installs the hover listeners on a document: entering an element with aria-label shows its tooltip, leaving hides it. */
export function installTooltipHandlers(doc) {
  const body = (doc || document).body;
  body.on("pointerover", "[aria-label]", onTooltipPointerOver);
  body.on("pointerout", "[aria-label]", onTooltipPointerOut);
  body.addEventListener("pointerup", hideTooltip);
}

// The two pointer predicates live in the application scope (the second one tracks touch input); initTooltips receives them.
let pointerEntered = null;
let isTouchSyntheticMouse = null;

/** Called once at the place of the old tooltip state variable (see manifest "classes"): gives the handlers their helpers; returns null. */
export function initTooltips(host) {
  pointerEntered = host.pointerEntered;
  isTouchSyntheticMouse = host.isTouchSyntheticMouse;
  return null;
}

export function onTooltipPointerOver(event, el) {
  if (event.pointerType === "touch" || !pointerEntered(event, el)) return;
  if (isTouchSyntheticMouse(event) || tooltipsDisabledFor(el)) return;
  showTooltipFromAttributes(el);
}

export function onTooltipPointerOut(event, el) {
  if (event.pointerType === "touch" || !pointerEntered(event, el) || isTouchSyntheticMouse(event)) return;
  hideTooltip();
  // moving from one labelled element into another (or into a child of one): show the new tooltip right away
  const next = event.relatedTarget;
  if (!next || !next.matchParent) return;
  const labelled = next.matchParent("[aria-label]");
  if (labelled && labelled.instanceOf(HTMLElement)) {
    if (tooltipsDisabledFor(labelled)) return;
    showTooltipFromAttributes(labelled);
  }
}

export function cancelTooltipDelay() { cancelDelay(); }
export function tooltipsDisabled(el) { return tooltipsDisabledFor(el); }
