// g01 clean-room: the CLI controller — dispatch pipeline, handler registry,
// meta commands and the shared rendering helpers (formatTable, tryResolveFile,
// formatDiff, ascii trees).
import { env } from "./env.js";
import { ng01DefineTable, ng01CommandScore } from "./n-g01-table.js";
import { ng01DescribeOptions, ng01Collator, ng01PadEnd, ng01Kv, ng01Lines } from "./n-g01-util.js";
import { prepareFuzzyFinder } from "./search-simple.js";
import { ng01RegisterVault } from "./n-g01-vault.js";
import { ng01RegisterMutate } from "./n-g01-mutate.js";
import { ng01RegisterMetaQueries } from "./n-g01-meta.js";
import { ng01RegisterWorkspace } from "./n-g01-ws.js";
import { ng01RegisterPlugins } from "./n-g01-plugins.js";
import { ng01RegisterDev } from "./n-g01-dev.js";
let Ng01HostRef = null;

const NG01_USAGE_SORT = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });

export function ng01DefineCli(host) {
  Ng01HostRef = host;
  const TableClass = ng01DefineTable();

  class Ng01Cli {
    constructor(app) {
      this.app = app;
      this.handlers = new Map();
    }

    // ------------------------------------------------------------ registry

    registerHandler(id, description, flags, handler) {
      if (this.handlers.has(id)) throw new Error(`Command "${id}" is already registered as a handler.`);
      this.handlers.set(id, { handler, description, flags: flags || undefined });
    }

    unregisterHandler(id, handler) {
      const entry = this.handlers.get(id);
      if (!entry) return;
      if (handler !== undefined && entry.handler !== handler) return;
      this.handlers.delete(id);
    }

    // ------------------------------------------------------------ init

    init() {
      const self = this;
      window.handleCli = (argv) => self.handleCli(argv);
      ng01RegisterMeta(self);
      ng01RegisterVault(self, host);
      ng01RegisterMutate(self, host);
      ng01RegisterMetaQueries(self, host);
      ng01RegisterWorkspace(self, host);
      ng01RegisterPlugins(self, host);
      if (host.Platform.isDesktopApp && window.electron) ng01RegisterDev(self, host);
      this.app.workspace.onLayoutReady(() => {
        const queue = window.cliQueue;
        window.cliQueue = null;
        if (queue) {
          for (const item of queue) {
            Promise.resolve(self.handleCli(item.argv)).then(item.resolve, item.reject);
          }
        }
      });
    }

    // ------------------------------------------------------------ dispatch

    async handleCli(argv) {
      console.log("Received CLI command", argv);
      argv = argv || [];
      let id = argv[0];
      if (!id || id === "--help") id = "help";
      const args = {};
      for (let i = 1; i < argv.length; i++) {
        const token = argv[i];
        const eq = token.indexOf("=");
        if (eq >= 0) args[token.slice(0, eq)] = token.slice(eq + 1);
        else args[token] = "true";
      }
      let entry = this.handlers.get(id);
      if (!entry) {
        const colon = id.lastIndexOf(":");
        if (colon > 0) {
          const prefix = id.slice(0, colon);
          const suffix = id.slice(colon + 1);
          const prefixEntry = this.handlers.get(prefix);
          if (prefixEntry && prefixEntry.flags && Object.prototype.hasOwnProperty.call(prefixEntry.flags, suffix)) {
            id = prefix;
            args[suffix] = "true";
            entry = prefixEntry;
          }
        }
      }
      if (!entry) {
        const suggestions = ng01CommandScore(id, Array.from(this.handlers.keys()));
        throw `Command "${id}" not found.` +
          (suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : " It may require a plugin to be enabled.");
      }
      const flags = entry.flags;
      if (flags && flags.format && flags.format.value && args.format === undefined) {
        for (const opt of flags.format.value.split("|")) {
          if (args[opt] !== undefined || args["--" + opt] !== undefined) {
            args.format = opt;
            delete args[opt];
            delete args["--" + opt];
            break;
          }
        }
      }
      if (flags) {
        const missing = [];
        for (const key of Object.keys(flags)) {
          const f = flags[key];
          if (f && f.required && args[key] === undefined) {
            missing.push(f.value ? `${key}=${f.value}` : key);
          }
        }
        if (missing.length) {
          throw `Missing required parameter: ${missing.join(", ")}\nUsage: ${id} ${ng01DescribeOptions(flags)}`.trimEnd();
        }
      }
      const copy = args["--copy"] === "true";
      if (copy) delete args["--copy"];
      const result = await entry.handler(args);
      if (copy && result) await navigator.clipboard.writeText(String(result));
      return result;
    }

    // ------------------------------------------------------------ shared helpers

    formatTable(headers, rows, format) {
      if (format === "json") {
        const out = [];
        for (const row of rows) {
          const obj = {};
          for (let i = 0; i < headers.length; i++) {
            const cell = row[i];
            obj[headers[i]] = cell === null || cell === undefined ? "" : cell;
          }
          out.push(obj);
        }
        return JSON.stringify(out, null, 2);
      }
      const body = rows.map((row) => {
        const padded = row.slice();
        while (padded.length < headers.length) padded.push("");
        return padded;
      });
      const table = new TableClass(headers, body);
      if (format === "csv") return table.toCSV(false);
      return table.toTSV(false);
    }

    tryResolveFile(args, useActive = true) {
      const vault = this.app.vault;
      if (args.path !== undefined && args.path !== "") {
        const path = String(args.path);
        const file = vault.getAbstractFileByPath(path);
        if (!file) throw `File "${path}" not found.`;
        if (file instanceof host.TFolder) throw `"${path}" is a folder, not a file.`;
        return file;
      }
      if (args.file !== undefined && args.file !== "") {
        const dest = this.app.metadataCache.getFirstLinkpathDest(String(args.file), "");
        if (!dest) throw `File "${args.file}" not found.`;
        return dest;
      }
      if (useActive) {
        const active = this.app.workspace.getActiveFile();
        if (!active) throw "No active file. Use file=<name> or path=<path> to specify a file.";
        return active;
      }
      throw "Missing required parameter: file or path";
    }

    formatDiff(oldText, newText, oldLabel, newLabel) {
      if (!oldText.endsWith("\n")) oldText += "\n";
      if (!newText.endsWith("\n")) newText += "\n";
      const dmp = new (env().dA)();
      const op = env().XD;
      const diffs = dmp.diff_lineMode(oldText, newText);
      dmp.diff_cleanupSemantic(diffs);
      const lines = [`--- ${oldLabel}`, `+++ ${newLabel}`];
      for (const [kind, text] of diffs) {
        const parts = ng01Lines(text);
        for (const part of parts) {
          if (kind === op.DIFF_INSERT) lines.push("+ " + part);
          else if (kind === op.DIFF_DELETE) lines.push("- " + part);
          else lines.push("  " + part);
        }
      }
      return lines.join("\n");
    }

    formatAsciiTree(nodes, prefix = "") {
      const out = [];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const last = i === nodes.length - 1;
        const connector = last ? "└── " : "├── ";
        out.push(prefix + connector + node.label);
        const children = node.children;
        if (children && children.length) {
          out.push(this.formatAsciiTree(children, prefix + (last ? "    " : "│   ")));
        }
      }
      return out.filter((s) => s !== "").join("\n");
    }

    formatAsciiTreeWithRoot(root, children) {
      if (!children || children.length === 0) return String(root);
      return String(root) + "\n" + this.formatAsciiTree(children);
    }
  }

  return Ng01Cli;
}

// ============================================================ meta commands

function ng01RegisterMeta(cli) {
  const app = cli.app;

  cli.registerHandler("help", "Show CLI help", {
    command: { value: "<command>", description: "Show help for a specific command" },
  }, (args) => {
    const filter = ng01HelpFilter(args);
    if (filter) return ng01HelpFiltered(cli, filter);
    return ng01HelpAll(cli);
  });

  cli.registerHandler("__completions", "Command completions (JSON)", null, () => {
    const out = {};
    for (const [id, entry] of cli.handlers) {
      if (id.startsWith("__")) continue;
      const value = { usage: ng01DescribeOptions(entry.flags), description: entry.description };
      if (entry.flags) {
        const flags = {};
        for (const key of Object.keys(entry.flags)) {
          const f = entry.flags[key];
          flags[key] = { ...f, description: f.required ? f.description + " (required)" : f.description };
        }
        value.flags = flags;
      }
      out[id] = value;
    }
    return JSON.stringify(out);
  });

  cli.registerHandler("__commands", "App commands (JSON)", null, () => {
    return JSON.stringify(app.commands.listCommands().map((c) => ({ id: c.id, name: c.name })));
  });

  cli.registerHandler("__files", "Vault file paths (JSON)", {
    query: { description: "Fuzzy filter" },
    limit: { value: "<n>", description: "Max results (default 20)" },
  }, (args) => {
    const all = app.vault.getFiles().map((f) => f.path);
    const limit = args.limit !== undefined ? parseInt(args.limit, 10) : 20;
    const max = isNaN(limit) ? 20 : limit;
    let paths;
    if (args.query) {
      const match = prepareFuzzyFinder(String(args.query));
      const scored = [];
      for (const p of all) {
        const r = match(p);
        if (r) scored.push({ p, score: r.score });
      }
      scored.sort((a, b) => b.score - a.score || ng01Collator.compare(a.p, b.p));
      paths = scored.map((x) => x.p);
    } else {
      const recent = app.workspace.getLastOpenFiles().filter((p) => all.includes(p));
      const rest = all.filter((p) => !recent.includes(p)).sort(ng01Collator.compare);
      paths = recent.concat(rest);
    }
    return JSON.stringify(paths.slice(0, max));
  });

  cli.registerHandler("commands", "List command ids", {
    filter: { value: "<prefix>", description: "Keep ids starting with prefix" },
  }, (args) => {
    let ids = app.commands.listCommands().map((c) => c.id);
    if (args.filter) ids = ids.filter((id) => id.startsWith(args.filter));
    return ids.sort(NG01_USAGE_SORT.compare).join("\n");
  });

  cli.registerHandler("command", "Run an app command", {
    id: { value: "<command-id>", description: "Command id", required: true },
  }, (args) => {
    const id = String(args.id);
    if (!app.commands.findCommand(id)) {
      throw `Command "${id}" not found. Use "commands" to list available command IDs.`;
    }
    if (!app.commands.executeCommandById(id)) throw `Failed to execute: ${id}`;
    return `Executed: ${id}`;
  });

  cli.registerHandler("version", "App version", null, () => {
    return `${Ng01HostRef.Platform.version} (installer ${Ng01HostRef.Platform.build})`;
  });
}

function ng01HelpFilter(args) {
  if (args.command !== undefined && args.command !== "true") return String(args.command);
  for (const key of Object.keys(args)) {
    if (args[key] === "true") return key;
  }
  return "";
}

function ng01IsDevId(id) {
  return id.startsWith("dev:") || id === "devtools" || id === "eval";
}

function ng01HelpEntry(cli, id, entry) {
  let text = "  " + ng01PadEnd(id, 22) + entry.description + "\n";
  if (entry.flags) {
    for (const key of Object.keys(entry.flags)) {
      const f = entry.flags[key];
      const name = f.value ? key + "=" + f.value : key;
      text += "    " + ng01PadEnd(name, 20) + "- " + f.description + (f.required ? " (required)" : "") + "\n";
    }
  }
  return text + "\n";
}

function ng01HelpAll(cli) {
  const normal = [];
  const dev = [];
  for (const [id, entry] of cli.handlers) {
    if (id.startsWith("__")) continue;
    (ng01IsDevId(id) ? dev : normal).push([id, entry]);
  }
  normal.sort((a, b) => NG01_USAGE_SORT.compare(a[0], b[0]));
  dev.sort((a, b) => NG01_USAGE_SORT.compare(a[0], b[0]));
  let text =
    "Basalt CLI\n\n" +
    "Usage: basalt <command> [options]\n\n" +
    "Options:\n" +
    "  vault=<name>    Run the command against a different vault when the CLI was started with --vault.\n\n" +
    "Notes:\n" +
    "  File arguments accept file=<name> (wikilink resolution), path=<path> (vault-relative)\n" +
    "  or fall back to the active file. Quote values containing spaces as name=\"My Note\";\n" +
    "  use \\n and \\t escapes inside content values.\n\n";
  for (const [id, entry] of normal) text += ng01HelpEntry(cli, id, entry);
  if (dev.length) {
    text += "Developer:\n";
    for (const [id, entry] of dev) text += ng01HelpEntry(cli, id, entry);
  }
  return text;
}

function ng01HelpFiltered(cli, filter) {
  const matches = [];
  for (const [id, entry] of cli.handlers) {
    if (id === filter || id.startsWith(filter + ":")) matches.push([id, entry]);
  }
  if (matches.length === 0) {
    const suggestions = ng01CommandScore(filter, Array.from(cli.handlers.keys()));
    return `No commands matching "${filter}".` + (suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : "");
  }
  matches.sort((a, b) => NG01_USAGE_SORT.compare(a[0], b[0]));
  return matches.map(([id, entry]) => ng01HelpEntry(cli, id, entry)).join("");
}
