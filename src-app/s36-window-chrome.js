// Window chrome: the Basalt logo button placed in the titlebar's left button
// container. Runs once per window — the main window and every pop-out — early
// in startup, before the workspace exists. On macOS the native traffic lights
// already sit there, so only the status refresh still runs.
//
// The full-colour mark is shipped as a plain file (src/basalt-titlebar.png)
// instead of a data URI so the bundle does not carry ~40 KB of base64; the
// wireframe variant is a small stroke SVG drawn in currentColor.

import { env } from "./env.js";

const LOGO_FILE = "basalt-titlebar.png";

// Outline of the same mark, stroked so it follows the titlebar text colour.
const WIREFRAME_PATH =
  "M172.7 461.6c73.6-149.1 2.1-217-43.7-246.9m72 96.7c71.6-17.3 141-16.3 189.8 88.5" +
  "m-114-96.3c-69.6-174 44.6-181 16.3-273.6m97.7 370c1.6-3 3.3-5.8 5.1-8.6 20-29.9 34.2-53.2" +
  " 41.4-65.3a16 16 0 0 0-1.2-17.7 342.1 342.1 0 0 1-40.2-66.1c-10.9-26-12.5-66.5-12.6-86.2" +
  " 0-7.4-2.4-14.7-7-20.6l-81.8-104a32 32 0 0 0-1.4-1.5m97.7 370a172.8 172.8 0 0 0-18 59" +
  "c-2.9 21.5-24 38.4-45 32.6-30-8.3-64.5-21.1-95.7-23.5l-47.8-3.6c-7.7-.6-15-4-20.3-9.5" +
  "l-82.3-84.8c-9-9.2-11.4-23-6.2-34.8 0 0 51-111.8 52.8-117.7l.7-3M293.1 30a31.5 31.5 0 0 0-44.4-2.3" +
  "l-97.4 87.5c-5.4 5-9 11.5-10 18.8-3.7 24.5-9.7 68-12.3 80.7";

function logoSvg(size, attrs, inner) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 512 512");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  for (const k in attrs) svg.setAttribute(k, attrs[k]);
  svg.innerHTML = inner;
  return svg;
}

/**
 * @param {object} win window-like host: { frameDom, document, electron }
 */
export function s36WindowChrome(win) {
  const { Yl } = env();
  const frame = win.frameDom;
  if (!frame) return;
  const frag = win.document.createDocumentFragment();
  if (!Yl.isMacOS) {
    const btn = frag.createDiv("titlebar-button mod-logo");
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => win.electron.ipcRenderer.send("render-menu"));
    btn.addEventListener("contextmenu", () => win.electron.ipcRenderer.send("render-menu"));

    const full = logoSvg(18, {}, `<image href="${LOGO_FILE}" x="82" y="0" width="348" height="512"/>`);
    full.classList.add("logo-full");
    const wire = logoSvg(
      18,
      { fill: "none", stroke: "currentColor", "stroke-width": "32", "stroke-linecap": "round", "stroke-linejoin": "round" },
      `<path d="${WIREFRAME_PATH}"/>`
    );
    wire.classList.add("logo-wireframe");
    btn.appendChild(full);
    btn.appendChild(wire);
  }
  frame.leftButtonContainerEl.appendChild(frag);
  frame.updateStatus();
}
