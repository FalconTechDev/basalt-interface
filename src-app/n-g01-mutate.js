// g01 clean-room: file/folder mutation + version-diff CLI commands.
import { fileClass } from "./vault.js";
import { normalizePath } from "./path.js";
import { ng01UnescapeContent, ng01Stamp } from "./n-g01-util.js";
import { frontmatterBounds } from "./notes-utils.js";
import { applyTemplateVars } from "./notes-utils.js";

/** Unwraps a `vault.process`-style edit: reads, transforms, writes when changed. */
async function ng01ProcessFile(vault, file, fn) {
  const text = await vault.cachedRead(file);
  const next = fn(text);
  if (next !== text) await vault.modify(file, next);
  return next;
}

export function ng01RegisterMutate(cli, host) {
  const app = cli.app;
  const vault = app.vault;

  cli.registerHandler("create", "Create a file", {
    name: { value: "<name>", description: "File name (no slashes)" },
    path: { value: "<dir>", description: "Parent folder path" },
    content: { value: "<text>", description: "Initial contents (\\n \\t escapes)" },
    template: { value: "<name>", description: "Template to apply" },
    overwrite: { description: "Overwrite existing file" },
    open: { description: "Open the file after creating" },
    newtab: { description: "Open in a new tab" },
  }, async (args) => {
    const name = String(args.name || "");
    if (name.includes("/")) throw `Invalid name: ${name}`;
    let dir = args.path !== undefined && args.path !== "" ? normalizePath(String(args.path)) : "";
    if (dir === "/") dir = "";
    let ext = "md";
    let base = name;
    const dot = name.lastIndexOf(".");
    if (dot > 0) { ext = name.slice(dot + 1); base = name.slice(0, dot); }
    const relPath = (dir ? dir + "/" : "") + name;
    let content = "";
    if (args.template !== undefined) {
      const plugin = app.internalPlugins.getEnabledPluginById("templates");
      if (!plugin || !plugin.resolveTemplateFile) throw "Templates plugin is not enabled.";
      const tpl = plugin.resolveTemplateFile(String(args.template));
      if (typeof tpl === "string") throw tpl;
      const raw = await vault.cachedRead(tpl);
      content = applyTemplateVars(raw, { title: base }, { dateFormat: plugin.options && plugin.options.dateFormat, timeFormat: plugin.options && plugin.options.timeFormat });
    } else if (args.content !== undefined) {
      content = ng01UnescapeContent(args.content);
    }
    const existing = vault.getAbstractFileByPath(relPath);
    if (existing) {
      if (!args.overwrite) throw `File "${relPath}" already exists.`;
      await vault.modify(existing, content);
      if (args.open) await app.workspace.getLeaf(args.newtab ? "tab" : undefined).openFile(existing, { active: true });
      return `Overwrote: ${existing.path}`;
    }
    const parent = dir ? vault.getAbstractFileByPath(dir) : vault.getRoot();
    const file = await app.fileManager.createNewFile(parent instanceof fileClass("TFolder") ? parent : vault.getRoot(), base, ext, content);
    if (args.open) await app.workspace.getLeaf(args.newtab ? "tab" : undefined).openFile(file, { active: true });
    return `Created: ${file.path}`;
  });

  const fileTarget = (args) => cli.tryResolveFile(args, false);

  cli.registerHandler("append", "Append to a file", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    content: { value: "<text>", description: "Text to append", required: true },
    inline: { description: "Append without newline" },
  }, async (args) => {
    const file = fileTarget(args);
    const content = ng01UnescapeContent(args.content);
    await ng01ProcessFile(vault, file, (text) => text + (args.inline ? "" : "\n") + content);
    return `Appended to: ${file.path}`;
  });

  cli.registerHandler("prepend", "Prepend to a file", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    content: { value: "<text>", description: "Text to prepend", required: true },
    inline: { description: "Prepend without newline" },
  }, async (args) => {
    const file = fileTarget(args);
    const content = ng01UnescapeContent(args.content);
    await ng01ProcessFile(vault, file, (text) => {
      const start = frontmatterBounds(text).contentStart;
      return text.substring(0, start) + content + (args.inline ? "" : "\n") + text.substring(start);
    });
    return `Prepended to: ${file.path}`;
  });

  cli.registerHandler("move", "Move or rename a file/folder", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    to: { value: "<path>", description: "Destination path", required: true },
  }, async (args) => {
    const file = fileTarget(args);
    let dest = normalizePath(String(args.to)).replace(/^\/+|\/+$/g, "");
    if (!dest.includes(".")) {
      const dir = dest ? dest + "/" : "";
      dest = dir + file.name;
    }
    if (vault.getAbstractFileByPath(dest)) throw `"${dest}" already exists.`;
    const from = file.path;
    await app.fileManager.renameFile(file, dest);
    return `Moved: ${from} -> ${dest}`;
  });

  cli.registerHandler("rename", "Rename a file (keep folder)", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    name: { value: "<name>", description: "New name", required: true },
  }, async (args) => {
    const file = fileTarget(args);
    let newName = String(args.name);
    if (!newName.includes(".")) newName = newName + "." + (file.extension || "md");
    const parent = file.parent && file.parent.path && file.parent.path !== "/" ? file.parent.path + "/" : "";
    const dest = normalizePath(parent + newName);
    if (vault.getAbstractFileByPath(dest)) throw `"${dest}" already exists.`;
    const from = file.path;
    await app.fileManager.renameFile(file, dest);
    return `Renamed: ${from} -> ${dest}`;
  });

  cli.registerHandler("delete", "Delete a file/folder", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    permanent: { description: "Delete permanently instead of trashing" },
  }, async (args) => {
    const file = fileTarget(args);
    if (args.permanent) {
      await vault.delete(file);
      return `Deleted permanently: ${file.path}`;
    }
    await vault.trash(file, true);
    return `Moved to trash: ${file.path}`;
  });

  // ------------------------------------------------------------ diff

  cli.registerHandler("diff", "Show version diff for a file", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    from: { value: "<n>", description: "Version number (default 1)" },
    to: { value: "<n>", description: "Version number (default current)" },
    filter: { value: "local|sync", description: "History source filter" },
  }, async (args) => {
    const file = fileTarget(args);
    const entries = await ng01CollectHistory(app, host, file.path, args.filter);
    if (entries.length === 0) return `No version history found for ${file.path}`;
    if (args.from === undefined && args.to === undefined) {
      const lines = [`${file.path} — ${entries.length} versions`];
      entries.forEach((e, i) => {
        lines.push(`${String(i + 1).padStart(4)}${e.source.padEnd(6)}${ng01Stamp(e.ts)}  ${String(e.size).padStart(10)}B  [${e.device || "local"}]`);
      });
      return lines.join("\n");
    }
    const fromIdx = args.from !== undefined ? parseInt(args.from, 10) - 1 : 0;
    const toIdx = args.to !== undefined ? parseInt(args.to, 10) - 1 : entries.length; // entries.length = current
    if (fromIdx < 0 || fromIdx >= entries.length || (args.to !== undefined && (toIdx < 0 || toIdx >= entries.length))) {
      throw `Invalid version. Available: 1-${entries.length}`;
    }
    const oldEntry = entries[fromIdx];
    const oldText = await ng01HistoryContent(app, oldEntry);
    const newText = args.to !== undefined ? await ng01HistoryContent(app, entries[toIdx]) : await vault.cachedRead(file);
    const oldLabel = `${file.path} (${oldEntry.source} #${fromIdx + 1}, ${ng01Stamp(oldEntry.ts)})`;
    return cli.formatDiff(oldText, newText, oldLabel, `${file.path} (current)`);
  });
}

/** Local IndexedDB backups + sync-plugin history, merged newest-first. */
async function ng01CollectHistory(app, host, path, filter) {
  const out = [];
  const want = filter ? String(filter).toLowerCase() : "";
  if (!want || want === "local") {
    try {
      if (host.Platform.supportsIndexedDb !== false && typeof indexedDB !== "undefined") {
        const db = await new Promise((res, rej) => {
          const req = indexedDB.open(app.appId + "-backup");
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
          req.onupgradeneeded = () => req.transaction.abort();
        });
        const versions = await new Promise((res, rej) => {
          try {
            const tx = db.transaction("backups", "readonly");
            const req = tx.objectStore("backups").index("path").getAll(path);
            req.onsuccess = () => res(req.result || []);
            req.onerror = () => rej(req.error);
          } catch (e) { rej(e); }
        });
        db.close();
        for (const v of versions) {
          const data = typeof v.data === "string" ? v.data : "";
          out.push({ source: "Local", ts: v.ts || 0, size: data.length, device: "", data });
        }
      }
    } catch (e) {}
  }
  if (!want || want === "sync") {
    try {
      const sync = app.internalPlugins.getEnabledPluginById("sync");
      if (sync && sync.getHistory) {
        const items = await sync.getHistory(path, null);
        for (const item of items || []) {
          out.push({ source: "Sync", ts: item.ts || item.time || 0, size: item.size || 0, uid: item.uid, data: null });
        }
      }
    } catch (e) {}
  }
  return out.sort((a, b) => b.ts - a.ts);
}

async function ng01HistoryContent(app, entry) {
  if (entry.data != null) return entry.data;
  try {
    const sync = app.internalPlugins.getEnabledPluginById("sync");
    if (sync && sync.getContentForVersion && entry.uid) {
      const buf = await sync.getContentForVersion(entry.uid);
      if (buf) {
        if (typeof buf === "string") return buf;
        if (buf instanceof Uint8Array || ArrayBuffer.isView(buf)) return new TextDecoder().decode(buf);
        if (buf instanceof ArrayBuffer) return new TextDecoder().decode(buf);
      }
    }
  } catch (e) {}
  return "";
}
