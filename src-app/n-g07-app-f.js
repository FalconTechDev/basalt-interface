// Clean-room app helpers (g07, part F): style/class mirroring into pop-out
// windows. Returns a cleanup function that stops the observers.
import { env } from "./env.js";

const ng07MirroredClasses = ["is-frameless", "is-focused", "is-fullscreen"];
const ng07SkippedVars = new Set(["--zoom-factor", "--keyboard-height"]);

function ng07SyncClasses(srcBody, dstBody, isTop) {
  for (const cls of ng07MirroredClasses) dstBody.classList.toggle(cls, srcBody.classList.contains(cls));
  if (isTop) dstBody.classList.add("is-popout-window");
}

function ng07SyncVars(srcDoc, dstDoc) {
  const srcStyle = srcDoc.documentElement && srcDoc.documentElement.style;
  const dstStyle = dstDoc.documentElement && dstDoc.documentElement.style;
  if (!srcStyle || !dstStyle) return;
  for (let i = 0; i < srcStyle.length; i++) {
    const name = srcStyle[i];
    if (ng07SkippedVars.has(name)) continue;
    dstStyle.setProperty(name, srcStyle.getPropertyValue(name), srcStyle.getPropertyPriority(name));
  }
  const fs = srcDoc.documentElement.style.fontSize;
  if (fs) dstDoc.documentElement.style.fontSize = fs;
}

/** `vZ` — mirror document styles, body classes and CSS vars into `popoutWindow`. */
export function s10MirrorStyles(popoutWindow, extraNodes, host) {
  const srcDoc = env().activeDocument || document;
  const dstDoc = popoutWindow.document;
  if (!dstDoc) return () => {};

  const cloneStyleNodes = () => {
    for (const node of extraNodes || []) {
      if (node && node.nodeType === 1) dstDoc.head.appendChild(node.cloneNode(true));
    }
    for (const sheet of srcDoc.styleSheets) {
      try {
        const css = [...sheet.cssRules].map((r) => r.cssText).join("\n");
        const style = dstDoc.createElement("style");
        style.textContent = css;
        dstDoc.head.appendChild(style);
      } catch (e) {
        const link = dstDoc.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        dstDoc.head.appendChild(link);
      }
    }
    for (const link of srcDoc.querySelectorAll('link[rel="stylesheet"]')) {
      const clone = link.cloneNode(true);
      dstDoc.head.appendChild(clone);
    }
  };

  cloneStyleNodes();
  ng07SyncClasses(srcDoc.body, dstDoc.body, true);
  ng07SyncVars(srcDoc, dstDoc);

  const observer = new MutationObserver(() => {
    ng07SyncClasses(srcDoc.body, dstDoc.body, true);
    ng07SyncVars(srcDoc, dstDoc);
  });
  observer.observe(srcDoc.head, { childList: true, subtree: true });
  observer.observe(srcDoc.body, { attributes: true, attributeFilter: ["class"] });

  const onFocus = () => ng07SyncClasses(srcDoc.body, dstDoc.body, true);
  srcDoc.defaultView && srcDoc.defaultView.addEventListener("focuschange", onFocus);

  return () => {
    observer.disconnect();
    if (srcDoc.defaultView) srcDoc.defaultView.removeEventListener("focuschange", onFocus);
  };
}
