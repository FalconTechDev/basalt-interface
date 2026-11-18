// s16 slice: the interface-font settings — a font-name suggest backed by a canvas probe
// of every installed family (desktop via IPC, mobile via the Capacitor fonts plugin,
// plus a built-in list), and the modal that edits the ordered custom font list.
import { inherit } from "./inherit.js";
import { idleOrTimeout } from "./metadata-helpers.js";
import { s16FontAvailable, s16SystemFontList, s16FontProbeSeen } from "./s16-constants.js";

// Shared probe state: the cache array fills asynchronously while suggest instances read it.
let s16FontCache = null;
let s16FontProbeDone = Promise.resolve();

/** Kicks off (once) the installed-font probe and returns the live cache array. */
function probeInstalledFonts(host) {
  if (s16FontCache) return s16FontCache;
  s16FontCache = ["Inter", "Source Code Pro"];
  const ctx = document.createElement("canvas").getContext("2d");
  const sample = "abcdefghijklmnopqrstuvwxyz0123456789";
  ctx.font = "72px monospace";
  const baseWidth = ctx.measureText(sample).width;

  const probe = async (names) => {
    let probed = 0;
    for (const name of names) {
      if (s16FontProbeSeen.has(name)) continue;
      s16FontProbeSeen.add(name);
      ctx.font = `72px ${name}, monospace`;
      if (ctx.measureText(sample).width !== baseWidth) s16FontCache.push(name);
      if (++probed % 10 === 0) await new Promise((resolve) => idleOrTimeout(resolve, 0));
    }
    s16FontCache.sort();
  };

  s16FontProbeDone = (async () => {
    const tasks = [];
    if (host.Platform.isDesktopApp) {
      try {
        const fonts = await host.electronBridge("get-fonts").getFonts();
        tasks.push(probe(fonts));
      } catch (error) { /* fonts API unavailable */ }
    }
    if (host.Platform.isMobileApp) {
      try {
        const result = await host.capacitorApp.getFonts();
        tasks.push(probe(result.fonts));
      } catch (error) { /* fonts API unavailable */ }
    }
    tasks.push(probe(s16SystemFontList));
    await Promise.all(tasks);
  })();
  return s16FontCache;
}

/** qee: input suggest listing every font family the probe has found so far. */
export function defineFontSuggest(host) {
  const Base = host.AbstractInputSuggest;
  function FontSuggest(app, textInputEl) {
    const self = Base.call(this, app, textInputEl) || this;
    self.fonts = function () { return probeInstalledFonts(host); };
    return self;
  }
  inherit(FontSuggest, Base);
  const proto = FontSuggest.prototype;

  proto.renderSuggestion = function (text, el) {
    el.setText(text);
    el.style.fontFamily = text;
  };

  proto.getSuggestions = function (query) {
    const results = [];
    query = query.toLowerCase();
    if (!query) results.push("Inter");
    for (const name of this.fonts()) {
      if (name.toLowerCase().contains(query)) results.push(name);
    }
    return results;
  };

  proto.selectSuggestion = function (text, event) {
    this.setValue(text);
    this.textInputEl.trigger("input");
    this.close();
    Base.prototype.selectSuggestion.call(this, text, event);
  };

  return FontSuggest;
}

/** zee: modal listing the custom interface fonts with add/remove/reorder and validity badges. */
export function defineFontListModal(host) {
  const Base = host.ButtonModal;
  const t = () => host.i18n.setting.appearance;

  function FontListModal(app, title, values, callback) {
    const self = Base.call(this, app) || this;
    self.setTitle(title);
    self.values = values;
    self.descEl = self.contentEl.createDiv();
    self.fontListEl = self.contentEl.createDiv("setting-font-list");

    let extraButton = null;
    let textInput = null;
    let suggest = null;
    const addCurrent = () => {
      const value = textInput.getValue();
      if (value && !self.values.contains(value)) {
        self.values.push(value);
        self.display();
      }
      textInput.setValue("");
      extraButton.extraSettingsEl.hide();
    };

    new host.Setting(self.contentEl)
      .setName(t().labelFontName())
      .addExtraButton((button) => button
        .setIcon("lucide-alert-circle")
        .setTooltip(t().msgFontNotFound())
        .then((component) => {
          extraButton = component;
          component.extraSettingsEl.addClass("mod-warning");
          component.extraSettingsEl.hide();
        }))
      .addText((text) => {
        textInput = text;
        text.setPlaceholder(t().optionFontPlaceholder());
        text.onChange(async (value) => {
          const available = await s16FontAvailable(value);
          extraButton.extraSettingsEl.toggle(!available);
        });
        const inputEl = text.inputEl;
        inputEl.addEventListener("focus", () => {
          self.modalEl.style.transition = "unset";
          host.nextFrame(() => { self.modalEl.style.transition = ""; });
          if (!suggest) {
            suggest = new host.s16FontSuggest(app, inputEl);
            suggest.onSelect((value, event) => {
              addCurrent();
              if (event instanceof MouseEvent) inputEl.blur();
            });
            s16FontProbeDone.then(() => suggest.onInputChange());
          }
        });
        inputEl.addEventListener("keydown", (event) => {
          if (!event.isComposing && event.key === "Enter") addCurrent();
        });
      })
      .addButton((button) => button
        .setButtonText(host.i18n.interface.buttonAdd())
        .onClick(addCurrent));

    self.addButton("mod-cta", host.i18n.dialogue.buttonSave(), () => {
      self.close();
      callback(self.values);
    });
    self.addCancelButton();
    return self;
  }
  inherit(FontListModal, Base);
  const proto = FontListModal.prototype;

  proto.onOpen = function () {
    this.display();
  };

  proto.display = function () {
    const self = this;
    const descEl = this.descEl;
    const listEl = this.fontListEl;
    const values = this.values;
    if (values.length === 0) descEl.setText(t().labelNoCustomFontSet());
    else descEl.setText(t().labelFontApplied());
    listEl.empty();
    const render = (name) => {
      listEl.createDiv("mobile-option-setting-item", (row) => {
        row.createSpan({ cls: "mobile-option-setting-item-name", text: name }).style.fontFamily = name;
        const badge = row.createSpan("mobile-option-setting-item-option-icon");
        s16FontAvailable(name).then((available) => {
          if (available) {
            badge.addClass("mod-success");
            host.setIcon(badge, "lucide-check-circle-2");
            host.setTooltip(badge, t().msgFontFound());
          } else {
            badge.addClass("mod-warning");
            host.setIcon(badge, "lucide-alert-circle");
            host.setTooltip(badge, t().msgFontNotFound());
          }
        });
        row.createDiv("clickable-icon mobile-option-setting-item-option-icon", (remove) => {
          host.setIcon(remove, "lucide-x");
          host.setTooltip(remove, host.i18n.interface.deleteActionShortName());
          remove.addEventListener("click", () => {
            values.remove(name);
            self.display();
          });
        });
        row.createDiv("clickable-icon mobile-option-setting-item-option-icon mobile-option-setting-drag-icon", (handle) => {
          host.setIcon(handle, "lucide-menu");
          host.setTooltip(handle, host.i18n.interface.dragToRearrange());
          host.makeDragReorderable(row, row, listEl, 5, () => null, (to) => {
            values.remove(name);
            values.splice(to, 0, name);
            self.display();
          });
        });
      });
    };
    for (const name of values) render(name);
  };

  return FontListModal;
}
