// Clean-room app helpers (g07, part E): CM6 line-range edits, vim mode sync
// and DOM event forwarding for pop-out windows.
import { env } from "./env.js";

/** `B$` — run `callback(line, changes)` for every doc line touching the selection. */
export function s10ChangeByLineRange(state, callback, host) {
  const collected = [];
  const sel = state.selection;
  for (const range of sel.ranges) {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    for (let n = first.number; n <= last.number; n++) callback(state.doc.line(n), collected);
  }
  if (!collected.length) return {};
  const specs = collected.map((c) => ({ from: c.from, to: c.to === undefined ? c.from : c.to, insert: c.insert || "" }));
  const changeSet = state.changes(specs);
  return { changes: changeSet, selection: sel.map(changeSet) };
}

function ng07VimCm(editor) {
  return editor && editor.cm ? editor.cm : editor;
}

/** `sZ` — push a vim mode transition into the editor's vim keymap. */
export function s10VimModeSync(editor, oldMode, newMode, host) {
  if (oldMode === newMode || !host.vimApi) return;
  const cm = ng07VimCm(editor);
  const mode = String(newMode || "");
  if (mode.includes("insert")) host.vimApi.enterInsertMode(cm);
  else host.vimApi.exitInsertMode(cm, true);
}

/** `lZ` — current vim mode name ("" when vim is off). */
export function s10VimModeName(editor) {
  const cm = ng07VimCm(editor);
  const vim = cm && cm.state && cm.state.vim;
  return vim && vim.mode != null ? vim.mode : "";
}

const ng07Forwarded = ["keydown", "keyup", "keypress", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend", "paste", "copy", "cut"];

/** `fZ` — clone a DOM event so handlers can prevent/stop it on both sides. */
export function s10ForwardDomEvent(event) {
  if (!event) return event;
  const clone = new Event(event.type, {
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    composed: event.composed,
  });
  for (const key of ["target", "currentTarget"]) {
    try { Object.defineProperty(clone, key, { value: event[key], configurable: true }); } catch (e) { /* read-only */ }
  }
  for (const name of ["preventDefault", "stopPropagation", "stopImmediatePropagation"]) {
    const original = event[name] && event[name].bind(event);
    clone[name] = function () {
      if (original) original();
      Event.prototype[name] && Event.prototype[name].call(clone);
    };
  }
  return clone;
}

/** `mZ` — re-dispatch input events from a pop-out window into the main window. */
export function s10ForwardInputEvents(win) {
  if (!win || win === window) return;
  const main = env().activeWindow || window;
  for (const type of ng07Forwarded) {
    win.addEventListener(type, (event) => {
      const forwarded = s10ForwardDomEvent(event);
      main.dispatchEvent(forwarded);
    }, true);
  }
}
