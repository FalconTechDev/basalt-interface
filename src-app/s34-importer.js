// The "Format converter" (markdown importer) core plugin: a modal that rewrites Markdown produced
// by other apps (Roam Research, Bear, Zettelkasten-style UIDs) into Basalt's format, plus a
// frontmatter migration for tags/aliases/cssclasses.
//
// Replaces the inherited pieces:
//   U8  MarkdownImporterPlugin -> defineMarkdownImporterPlugin
//   X8  ImporterModal          -> defineImporterModal      (base: Modal)
//   j8  gm.plugins.markdownFormatImporter -> declarator __basaltHost.t.plugins.markdownFormatImporter
//   W8/_8/G8/K8/Y8/Q8          -> the converter regexes now live inside defineImporterModal;
//                                the top-level literals become null (nothing else referenced them).

import { inherit } from "./inherit.js";
import { frontmatterBounds } from "./notes-utils.js";
import { keyIgnoringCase } from "./text.js";

/** i18next is configured to treat "{{" as a placeholder; descriptions that must show "{{[[TODO]]}}"
 *  literally are fetched with alternate interpolation markers. */
const TODO_INTERPOLATION = { interpolation: { prefix: "{{{{", suffix: "}}}}" } };

// The modal and plugin factories run at different positions in the bundle; the plugin reaches
// the modal class through this registry (populated by defineImporterModal).
const importerModalParts = {};

/** Renames an object key while keeping the position of the entry in iteration order. */
function renameKeyInPlace(obj, from, to) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    delete obj[key];
    obj[key === from ? to : key] = value;
  }
}

/** Rewrites the frontmatter of `text` through `mutate(data)` and serializes it back. */
function updateFrontmatterText(host, text, mutate) {
  const bounds = frontmatterBounds(text);
  let data = bounds.exists ? host.parseYaml(bounds.frontmatter) : {};
  if (!data || typeof data !== "object") data = {};
  mutate(data);
  if (Object.keys(data).length === 0) return bounds.exists ? text.slice(bounds.contentStart) : text;
  const yaml = host.yamlStringify(data);
  return bounds.exists ? text.slice(0, bounds.from) + yaml + text.slice(bounds.to) : "---\n" + yaml + "---\n" + text;
}

/** Runs `fn` for every element of `items`, yielding a microtask between elements (keeps the UI alive). */
async function* eachItem(items) {
  for (const item of items) yield await Promise.resolve(item);
}

// =====================================================================================================================
// The conversion modal
// =====================================================================================================================

/** Modal listing the available conversions; runs them file by file over the whole vault. */
export function defineImporterModal(host) {
  const t = () => host.t.plugins.markdownFormatImporter;

  /** Roam "#tag"/"#[[tag]]" -> "[[tag]]"; numeric "#123" anchors are left alone, "#[[x]]" loses its '#'. */
  const ROAM_TAG = /(^|\s)#([^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+)/g;
  const ROAM_TAG_WIKILINK = /\B#(\[\[[\w \t]*?\]\])/g;
  /** Roam "^^highlight^^" -> "==highlight==". */
  const ROAM_HIGHLIGHT = /\^\^(\S(.*?\S)?)\^\^/g;
  /** Bear "::highlight::" -> "==highlight==". */
  const BEAR_HIGHLIGHT = /::(\S(.*?\S)?)::/g;
  /** "{{[[TODO]]}}"/{{[[DONE]]}}" task markers -> "[ ]"/"[x]". */
  const ROAM_TODO = /\{\{\[\[(TODO|DONE)\]\]\}\}/g;
  /** "[[12345]]" Zettelkasten uid links. */
  const ZETTEL_ID = /\[\[(\d+?)\]\]/g;

  function ImporterModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.converters = [];
    const contentEl = self.contentEl;
    const converters = self.converters;
    self.titleEl.setText(t().name());
    const optionsEl = (self.conversionsEl = contentEl.createDiv());

    const allDigits = (s) => {
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code < 48 || code > 57) return false;
      }
      return true;
    };

    const conversions = [
      {
        name: t().optionRoamTagFixer(),
        description: t().optionRoamTagFixerDescription(),
        convert(app, file, text, stats) {
          text = text.replace(ROAM_TAG, (match, prefix, tag) => {
            if (allDigits(tag)) return match;
            stats.replaced++;
            return prefix + "[[" + tag + "]]";
          });
          return text.replace(ROAM_TAG_WIKILINK, (match, inner) => {
            stats.replaced++;
            return inner;
          });
        },
      },
      {
        name: t().optionRoamHighlightFixer(),
        description: t().optionRoamHighlightFixerDescription(),
        convert(app, file, text, stats) {
          return text.replace(ROAM_HIGHLIGHT, (match, inner) => {
            stats.replaced++;
            return "==" + inner + "==";
          });
        },
      },
      {
        name: t().optionRoamTodoConverter(),
        description: t().optionRoamTodoConverterDescription(TODO_INTERPOLATION),
        convert(app, file, text, stats) {
          return text.replace(ROAM_TODO, (match, word) => {
            stats.replaced++;
            return word === "TODO" ? "[ ]" : "[x]";
          });
        },
      },
      {
        name: t().optionBearHighlightFixer(),
        description: t().optionBearHighlightFixerDescription(),
        convert(app, file, text, stats) {
          return text.replace(BEAR_HIGHLIGHT, (match, inner) => {
            stats.replaced++;
            return "==" + inner + "==";
          });
        },
      },
      {
        name: t().zettelkastenLinkFixer(),
        description: t().zettelkastenLinkFixerDescription(),
        convert(app, file, text, stats) {
          return text.replace(ZETTEL_ID, (match, id) => {
            for (const candidate of app.vault.getAllLoadedFiles()) {
              if (candidate instanceof host.TFile && candidate.basename.contains(id)) {
                stats.replaced++;
                return "[[" + app.metadataCache.fileToLinktext(candidate, file.path) + "]]";
              }
            }
            return match;
          });
        },
      },
      {
        name: t().zettelkastenLinkBeautifier(),
        description: t().zettelkastenLinkBeautifierDescription(),
        convert(app, file, text, stats) {
          return text.replace(ZETTEL_ID, (match, id) => {
            for (const candidate of app.vault.getAllLoadedFiles()) {
              if (candidate instanceof host.TFile && candidate.basename.contains(id)) {
                stats.replaced++;
                const name = candidate.basename.replace(id, "").trim();
                return "[[" + app.metadataCache.fileToLinktext(candidate, file.path) + "|" + name + "]]";
              }
            }
            return match;
          });
        },
      },
      {
        name: t().frontmatterMigration(),
        description: t().frontmatterMigrationDescription(),
        convert(app, file, text, stats) {
          let changed = false;
          const migrated = updateFrontmatterText(host, text, (data) => {
            // aliases / alias
            const aliasesKey = keyIgnoringCase(data, "aliases");
            if (!Object.hasOwn(data, aliasesKey)) {
              for (const key in data) {
                if (Object.hasOwn(data, key) && key.toLowerCase() === "alias") {
                  renameKeyInPlace(data, key, aliasesKey);
                  changed = true;
                  break;
                }
              }
            }
            if (Object.hasOwn(data, aliasesKey)) {
              const value = data[aliasesKey];
              if (String.isString(value)) {
                data[aliasesKey] = value.split(/[,\n]/).map((s) => s.trim()).filter((s) => !!s);
                changed = true;
              }
            }
            // tags / tag
            const tagsKey = keyIgnoringCase(data, "tags");
            if (!Object.hasOwn(data, tagsKey)) {
              for (const key in data) {
                if (Object.hasOwn(data, key) && key.toLowerCase() === "tag") {
                  renameKeyInPlace(data, key, tagsKey);
                  changed = true;
                  break;
                }
              }
            }
            if (Object.hasOwn(data, tagsKey)) {
              const value = data[tagsKey];
              if (String.isString(value)) {
                data[tagsKey] = value.split(/[ ,\n]/).filter((s) => !!s);
                changed = true;
              }
            }
            // cssclasses / cssclass
            const cssKey = keyIgnoringCase(data, "cssclasses");
            if (!Object.hasOwn(data, cssKey)) {
              for (const key in data) {
                if (Object.hasOwn(data, key) && key.toLowerCase() === "cssclass") {
                  renameKeyInPlace(data, key, cssKey);
                  changed = true;
                  break;
                }
              }
            }
            if (Object.hasOwn(data, cssKey)) {
              const value = data[cssKey];
              if (String.isString(value)) {
                data[cssKey] = value.split(/[ ,\n]/).filter((s) => !!s);
                changed = true;
              }
            }
          });
          return changed ? migrated : text;
        },
      },
    ];

    const addToggle = (conversion) => {
      new host.Setting(optionsEl)
        .setName(conversion.name)
        .setDesc(conversion.description)
        .addToggle((toggle) => {
          toggle.setValue(false);
          converters.push({ toggle, conversion });
        });
    };
    for (const conversion of conversions) addToggle(conversion);

    optionsEl.createEl("p", { cls: "setting-message mod-warning", text: t().msgAllFilesWarning() });
    optionsEl.createEl("p", { cls: "setting-message mod-warning", text: t().msgOverrideFilesWarning() });
    optionsEl.createDiv("modal-button-container").createEl("button", { cls: "mod-cta", text: t().labelStartConversion() })
      .addEventListener("click", self.onProcess.bind(self));

    const resultEl = (self.resultEl = createDiv());
    self.statusEl = resultEl.createEl("p", "u-center-text");
    self.processedEl = resultEl.createDiv("changelog-item mod-success");
    self.modifiedEl = resultEl.createDiv("changelog-item mod-highlighted");
    self.replacedEl = resultEl.createDiv("changelog-item mod-highlighted");
    self.failedEl = resultEl.createDiv("changelog-item mod-failed");
    self.renderStats({ processed: 0, modified: 0, replaced: 0, failed: 0 });
    const buttonEl = resultEl.createDiv("modal-button-container");
    self.cancelEl = buttonEl.createEl("button", { cls: "mod-warning", text: t().labelStop() });
    self.cancelEl.addEventListener("click", self.onCancel.bind(self));
    self.goBackEl = buttonEl.createEl("button", { cls: "", text: t().labelGoBack() });
    self.goBackEl.addEventListener("click", self.onGoBack.bind(self));
    self.doneEl = buttonEl.createEl("button", { cls: "mod-cta", text: t().labelDone() });
    self.doneEl.addEventListener("click", self.close.bind(self));
    return self;
  }
  inherit(ImporterModal, host.Modal);
  const proto = ImporterModal.prototype;

  proto.onProcess = function () {
    const chosen = [];
    for (const entry of this.converters) {
      if (entry.toggle.getValue()) chosen.push(entry.conversion);
    }
    if (chosen.length === 0) return;
    this.runnable = new host.Runnable({
      onCancel: () => {
        this.cancelEl.hide();
        this.statusEl.setText(t().labelCancelling());
      },
    });
    this.conversionsEl.detach();
    this.contentEl.append(this.resultEl);
    this.cancelEl.show();
    this.goBackEl.hide();
    this.doneEl.hide();
    this.statusEl.setText(t().labelProcessing());
    this.process(chosen);
  };

  proto.onCancel = function () {
    this.runnable?.cancel();
  };

  proto.onGoBack = function () {
    this.resultEl.detach();
    this.contentEl.append(this.conversionsEl);
    for (const entry of this.converters) entry.toggle.setValue(false);
  };

  proto.onFinish = function (stats) {
    this.renderStats(stats);
    this.cancelEl.hide();
    this.goBackEl.show();
    this.statusEl.setText(t().labelFinished());
    this.doneEl.show();
  };

  proto.renderStats = function (stats) {
    this.processedEl.setText(t().labelProcessedFiles());
    this.processedEl.setAttribute("data-label", String(stats.processed));
    this.modifiedEl.setText(t().labelModifiedFiles());
    this.modifiedEl.setAttribute("data-label", String(stats.modified));
    this.replacedEl.setText(t().labelTotalReplacements());
    this.replacedEl.setAttribute("data-label", String(stats.replaced));
    this.failedEl.toggle(stats.failed > 0);
    this.failedEl.setText(t().labelFailed());
    this.failedEl.setAttribute("data-label", String(stats.failed));
  };

  proto.onClose = function () {
    this.onCancel();
    this.onGoBack();
  };

  /** Applies every chosen conversion to every markdown file, one file at a time. */
  proto.process = async function (conversions) {
    const app = this.app;
    const runnable = this.runnable;
    const stats = { processed: 0, modified: 0, replaced: 0, failed: 0 };
    const files = app.vault.getMarkdownFiles();
    const changed = [];
    try {
      for await (const file of eachItem(files)) {
        if (runnable.isCancelled()) {
          this.onFinish(stats);
          app.fileManager.notifyForBulkUndo(changed);
          break;
        }
        try {
          await app.vault.process(
            file,
            (content) => {
              let next = content;
              for (const conversion of conversions) next = conversion.convert(app, file, next, stats);
              if (next !== content) {
                stats.modified++;
                changed.push({ file, mtime: file.stat.mtime, content });
              }
              return next;
            },
            { mtime: file.stat.mtime + 1 }
          );
        } catch (error) {
          stats.failed++;
          console.error(error);
        }
        stats.processed++;
        if (runnable.isCancelled()) {
          this.onFinish(stats);
          app.fileManager.notifyForBulkUndo(changed);
          break;
        }
        this.renderStats(stats);
        if (stats.processed % 10 === 0) await host.sleep(0);
      }
    } finally {
      this.onFinish(stats);
      app.fileManager.notifyForBulkUndo(changed);
    }
  };

  importerModalParts.Modal = ImporterModal;
  return ImporterModal;
}

/** Ribbon item + global command opening the converter modal. */
export function defineMarkdownImporterPlugin(host) {
  const t = () => host.t.plugins.markdownFormatImporter;

  class MarkdownImporterPlugin {
    constructor() {
      this.id = "markdown-importer";
      this.name = t().name();
      this.description = t().desc();
    }

    init(app, plugin) {
      this.app = app;
      plugin.registerRibbonItem(t().actionOpen(), "lucide-binary", this.onOpen.bind(this));
      plugin.registerGlobalCommand({
        id: "markdown-importer:open",
        name: t().actionOpen(),
        icon: "lucide-download",
        callback: this.onOpen.bind(this),
      });
    }

    onOpen() {
      new importerModalParts.Modal(this.app).open();
      return false;
    }
  }
  return MarkdownImporterPlugin;
}
