// g01 clean-room: vault / file inspection CLI commands.
import { fileClass } from "./vault.js";
import { ng01Collator, ng01Kv, ng01FolderPrefix, ng01InFolder, ng01IsFsAdapter } from "./n-g01-util.js";

const ng01TFolder = () => fileClass("TFolder");
const ng01IsFolder = (node) => node instanceof ng01TFolder();

export function ng01RegisterVault(cli, host) {
  const app = cli.app;

  cli.registerHandler("vault", "Vault information", {
    info: { value: "name|path|files|folders|size", description: "Return only this value" },
  }, (args) => {
    const vault = app.vault;
    const files = vault.getFiles();
    let folders = 0;
    const walk = (node) => {
      for (const child of node.children || []) {
        if (ng01IsFolder(child)) { folders++; walk(child); }
      }
    };
    walk(vault.getRoot());
    let size = 0;
    for (const f of files) size += (f.stat && f.stat.size) || 0;
    const fsAdapter = ng01IsFsAdapter(app);
    const rows = [
      ["name", vault.getName()],
      ["path", fsAdapter ? app.vault.adapter.getBasePath() : ""],
      ["files", String(files.length)],
      ["folders", String(folders)],
      ["size", String(size)],
    ].filter((r) => !(r[0] === "path" && !fsAdapter));
    if (args.info !== undefined) {
      const hit = rows.find((r) => r[0] === String(args.info));
      return hit ? hit[1] : "";
    }
    return ng01Kv(rows);
  });

  cli.registerHandler("files", "List vault files", {
    folder: { value: "<path>", description: "Only files under this folder" },
    ext: { value: "<ext>", description: "Only this extension" },
    total: { description: "Return file count" },
  }, (args) => {
    const folder = ng01FolderPrefix(args.folder);
    let ext = args.ext !== undefined ? String(args.ext) : "";
    if (ext.startsWith(".")) ext = ext.slice(1);
    let paths = app.vault.getFiles().map((f) => f.path);
    if (folder) paths = paths.filter((p) => ng01InFolder(p, folder));
    if (ext) paths = paths.filter((p) => {
      const name = p.split("/").pop();
      const dot = name.lastIndexOf(".");
      return dot > 0 && name.slice(dot + 1) === ext;
    });
    paths.sort(ng01Collator.compare);
    if (args.total) return String(paths.length);
    return paths.join("\n");
  });

  cli.registerHandler("folders", "List vault folders", {
    folder: { value: "<path>", description: "Start folder (default: vault root)" },
    total: { description: "Return folder count" },
  }, (args) => {
    let start = app.vault.getRoot();
    if (args.folder !== undefined && args.folder !== "") {
      const found = app.vault.getAbstractFileByPath(ng01FolderPrefix(args.folder));
      if (!found) throw `Folder "${args.folder}" not found.`;
      if (!ng01IsFolder(found)) throw `"${args.folder}" is not a folder.`;
      start = found;
    }
    const out = [];
    const walk = (node) => {
      out.push(node.path === "/" ? "/" : node.path);
      for (const child of node.children || []) if (ng01IsFolder(child)) walk(child);
    };
    walk(start);
    if (args.total) return String(out.length);
    return out.join("\n");
  });

  cli.registerHandler("file", "File information", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
  }, (args) => {
    const file = cli.tryResolveFile(args, false);
    const stat = file.stat || {};
    return ng01Kv([
      ["path", file.path],
      ["name", file.name],
      ["extension", file.extension || ""],
      ["size", String(stat.size || 0)],
      ["created", String(stat.ctime || 0)],
      ["modified", String(stat.mtime || 0)],
    ]);
  });

  cli.registerHandler("folder", "Folder information", {
    path: { value: "<path>", description: "Folder path", required: true },
    info: { value: "files|folders|size", description: "Return only this value" },
  }, (args) => {
    const cleaned = String(args.path).replace(/\/+$/, "");
    const folder = app.vault.getAbstractFileByPath(cleaned === "" ? "/" : cleaned);
    if (!folder) throw `Folder "${args.path}" not found.`;
    if (!ng01IsFolder(folder)) throw `"${args.path}" is not a folder.`;
    let files = 0, folders = 0, size = 0;
    const walk = (node) => {
      for (const child of node.children || []) {
        if (ng01IsFolder(child)) { folders++; walk(child); }
        else { files++; size += (child.stat && child.stat.size) || 0; }
      }
    };
    walk(folder);
    const rows = [["path", folder.path === "/" ? "/" : folder.path], ["files", String(files)], ["folders", String(folders)], ["size", String(size)]];
    if (args.info !== undefined) {
      const hit = rows.find((r) => r[0] === String(args.info));
      return hit ? hit[1] : "";
    }
    return ng01Kv(rows);
  });

  cli.registerHandler("vaults", "List vaults (desktop)", {
    total: { description: "Return vault count" },
    verbose: { description: "TSV basename/path output" },
  }, (args) => {
    if (!host.Platform.isDesktopApp || !window.electron) throw "This command is only available on desktop.";
    const list = window.electron.ipcRenderer.sendSync("vault-list") || [];
    const sorted = list.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (args.total) return String(sorted.length);
    if (args.verbose) {
      return sorted.map((v) => `${v.basename || v.name || ""}\t${v.path || ""}`).join("\n");
    }
    return sorted.map((v) => v.basename || v.name || v.path || "").join("\n");
  });

  cli.registerHandler("recents", "Recently opened files", {
    total: { description: "Return count" },
  }, (args) => {
    const paths = app.workspace.getLastOpenFiles();
    if (args.total) return String(paths.length);
    if (paths.length === 0) return "No recent files.";
    return paths.join("\n");
  });

  cli.registerHandler("read", "Read file contents", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
  }, async (args) => {
    const file = cli.tryResolveFile(args, false);
    return app.vault.cachedRead(file);
  });

  cli.registerHandler("open", "Open a file", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    newtab: { description: "Open in a new tab" },
  }, async (args) => {
    const file = cli.tryResolveFile(args, false);
    await app.workspace.getLeaf(args.newtab ? "tab" : undefined).openFile(file, { active: true });
    return `Opened: ${file.path}`;
  });

  const randomFile = (folder) => {
    let files = app.vault.getMarkdownFiles();
    const f = ng01FolderPrefix(folder);
    if (f) files = files.filter((file) => ng01InFolder(file.path, f));
    if (files.length === 0) return null;
    return files[Math.floor(Math.random() * files.length)];
  };

  cli.registerHandler("random", "Open a random note", {
    folder: { value: "<path>", description: "Restrict to folder" },
    newtab: { description: "Open in a new tab" },
  }, async (args) => {
    const file = randomFile(args.folder);
    if (!file) throw "No markdown files found.";
    await app.workspace.getLeaf(args.newtab ? "tab" : undefined).openFile(file, { active: true });
    return `Opened: ${file.path}`;
  });

  cli.registerHandler("random:read", "Read a random note", {
    folder: { value: "<path>", description: "Restrict to folder" },
  }, async (args) => {
    const file = randomFile(args.folder);
    if (!file) throw "No markdown files found.";
    return `${file.path}\n\n${await app.vault.cachedRead(file)}`;
  });

  cli.registerHandler("backlinks", "Files linking to a file", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    counts: { description: "Include link counts" },
    total: { description: "Return total link count" },
    format: { value: "json|tsv|csv", description: "Output format" },
  }, (args) => {
    const file = cli.tryResolveFile(args, false);
    const rows = [];
    let total = 0;
    for (const sourcePath of Object.keys(app.metadataCache.resolvedLinks)) {
      const dests = app.metadataCache.resolvedLinks[sourcePath];
      const count = dests[file.path];
      if (count) { rows.push({ file: sourcePath, count }); total += count; }
    }
    rows.sort((a, b) => ng01Collator.compare(a.file, b.file));
    if (args.total) return String(total);
    const withCount = args.counts !== undefined;
    const headers = withCount ? ["file", "count"] : ["file"];
    const body = rows.map((r) => withCount ? [r.file, String(r.count)] : [r.file]);
    return cli.formatTable(headers, body, args.format);
  });

  cli.registerHandler("unresolved", "Unresolved links", {
    total: { description: "Return entry count" },
    counts: { description: "Include occurrence counts" },
    verbose: { description: "Include source files" },
    format: { value: "json|tsv|csv", description: "Output format" },
  }, (args) => {
    const agg = {};
    for (const sourcePath of Object.keys(app.metadataCache.unresolvedLinks)) {
      const links = app.metadataCache.unresolvedLinks[sourcePath];
      for (const link of Object.keys(links)) {
        const entry = agg[link] || (agg[link] = { link, count: 0, sources: new Set() });
        entry.count += links[link];
        entry.sources.add(sourcePath);
      }
    }
    const rows = Object.keys(agg).map((k) => agg[k]).sort((a, b) => ng01Collator.compare(a.link, b.link));
    if (args.total) return String(rows.length);
    const withCount = args.counts !== undefined;
    const withSources = args.verbose !== undefined;
    const headers = ["link"].concat(withCount ? ["count"] : [], withSources ? ["sources"] : []);
    const body = rows.map((r) => {
      const row = [r.link];
      if (withCount) row.push(String(r.count));
      if (withSources) row.push(Array.from(r.sources).sort(ng01Collator.compare).join(", "));
      return row;
    });
    return cli.formatTable(headers, body, args.format);
  });

  const graphFlags = {
    total: { description: "Return file count" },
    all: { description: "Accepted for compatibility" },
  };
  const incoming = new Set();
  for (const sourcePath of Object.keys(app.metadataCache.resolvedLinks)) {
    for (const dest of Object.keys(app.metadataCache.resolvedLinks[sourcePath])) incoming.add(dest);
  }
  cli.registerHandler("orphans", "Files with no incoming links", graphFlags, (args) => {
    const paths = app.vault.getFiles().map((f) => f.path).filter((p) => !incoming.has(p)).sort(ng01Collator.compare);
    if (args.total) return String(paths.length);
    return paths.length ? paths.join("\n") : "No orphan files found.";
  });
  cli.registerHandler("deadends", "Files with no outgoing links", graphFlags, (args) => {
    const paths = app.vault.getFiles().map((f) => f.path).filter((p) => {
      const dests = app.metadataCache.resolvedLinks[p];
      return !dests || Object.keys(dests).length === 0;
    }).sort(ng01Collator.compare);
    if (args.total) return String(paths.length);
    return paths.length ? paths.join("\n") : "No dead-end files found.";
  });
}
