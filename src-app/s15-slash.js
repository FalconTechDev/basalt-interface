// Own Basalt implementation of the Slash-command core plugin.
//
// Registers an editor suggest that triggers on "/query" text, lists matching
// commands from the command palette plugin and executes the picked command.
// The trigger pattern is kept as data (replaces C9) and the plugin/suggest
// classes keep their observable behaviour.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { sortHitsByScore } from "./misc.js";
import { prepareFuzzyFinder } from "./search-simple.js";
import { renderResults } from "./search-simple.js";

const SH = () => env();

/** Trigger pattern for slash commands: a slash followed by non-space text (replaces C9). */
export const s15SlashCommandPattern = /(^|\s)\/([^\s\/]*)$/;

let slashCache = null;

function buildSlashClasses() {
  const EditorSuggest = SH().NI;

  // -- E9: slash command suggest ------------------------------------------------
  function SlashCommandSuggest(app) {
    const self = EditorSuggest.apply(this, arguments) || this;
    return self;
  }
  inherit(SlashCommandSuggest, EditorSuggest);

  SlashCommandSuggest.prototype.onTrigger = function (cursor, editor, file) {
    if (!file) return null;
    const line = cursor.line;
    const before = editor.getLine(line).substr(0, cursor.ch);
    const match = before.match(s15SlashCommandPattern);
    if (!match) return null;
    const startCh = match.index + match[1].length;
    const query = match[2];
    return {
      start: { line, ch: startCh },
      end: { line, ch: cursor.ch },
      query,
    };
  };

  SlashCommandSuggest.prototype.selectSuggestion = function (suggestion, evt) {
    const context = this.context;
    this.close();
    if (!context) return;
    context.editor.replaceRange("", context.start, context.end);
    SH().K6(suggestion.item);
  };

  SlashCommandSuggest.prototype.getSuggestions = function (context) {
    const commands = this.app.internalPlugins.getPluginById("command-palette").instance.getCommands();
    const finder = prepareFuzzyFinder(context.query);
    const hits = [];
    for (const command of commands) {
      const match = finder(command.name);
      if (match) hits.push({ match, item: command });
    }
    sortHitsByScore(hits);
    return hits;
  };

  SlashCommandSuggest.prototype.renderSuggestion = function (suggestion, el) {
    el.addClass("mod-complex");
    const content = el.createSpan("suggestion-content");
    const aux = el.createSpan("suggestion-aux");
    const title = content.createDiv("suggestion-title");
    const command = suggestion.item;
    const name = command.name;
    const sep = name.indexOf(": ");
    if (sep !== -1) {
      const prefix = name.slice(0, sep);
      const rest = name.slice(sep + 2);
      renderResults(title.createSpan("suggestion-prefix"), prefix, suggestion.match);
      renderResults(title.createSpan(), rest, suggestion.match, -(sep + 2));
    } else {
      renderResults(title.createSpan(), name, suggestion.match);
    }
    const hotkeyManager = this.app.hotkeyManager;
    const hotkeys = hotkeyManager.getHotkeys(command.id);
    const defaults = hotkeyManager.getDefaultHotkeys(command.id);
    if (hotkeys) {
      for (const hotkey of hotkeys) {
        aux.createEl("kbd", { cls: "suggestion-hotkey", text: SH().Rb(hotkey) });
      }
    } else if (defaults) {
      for (const hotkey of defaults) {
        aux.createEl("kbd", { cls: "suggestion-hotkey", text: SH().Rb(hotkey) });
      }
    }
    const palette = this.app.internalPlugins.getPluginById("command-palette").instance;
    const pinned = palette.options.pinned;
    if (pinned && pinned.contains(command.id)) {
      aux.createSpan({ cls: "suggestion-flair" }, (span) => {
        SH().tv(span, "lucide-pin");
      });
    }
  };

  // -- k9: slash-command plugin -------------------------------------------------
  function SlashCommandPlugin() {
    this.id = "slash-command";
    this.name = SH().gm.plugins.slashCommand.name();
    this.description = SH().gm.plugins.slashCommand.desc();
    this.defaultOn = false;
  }
  SlashCommandPlugin.prototype.init = function (app, manifest) {
    this.suggest = new SlashCommandSuggest(app);
  };
  SlashCommandPlugin.prototype.onEnable = function (app, manifest) {
    app.workspace.editorSuggest.addSuggest(this.suggest);
  };
  SlashCommandPlugin.prototype.onDisable = function (app, manifest) {
    app.workspace.editorSuggest.removeSuggest(this.suggest);
  };

  return { E9: SlashCommandSuggest, k9: SlashCommandPlugin };
}

let slashBuilt = null;
function slashClasses() {
  if (!slashBuilt) slashBuilt = buildSlashClasses();
  return slashBuilt;
}

export function defineSlashCommandSuggest(host) {
  return slashClasses().E9;
}
export function defineSlashCommandPlugin(host) {
  return slashClasses().k9;
}
