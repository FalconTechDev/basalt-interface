// g01 clean-room: metadata CLI commands — aliases, tags, tasks, properties.
import { frontmatterAliases, frontmatterTags } from "./frontmatter.js";
import { frontmatterBounds } from "./notes-utils.js";
import { ng01Collator, ng01Lines, ng01Kv } from "./n-g01-util.js";

/** Live frontmatter object parsed from the file's current text (cache may lag writes). */
async function ng01LiveFrontmatter(app, host, file) {
  const text = await app.vault.cachedRead(file);
  const bounds = frontmatterBounds(text);
  if (!bounds.exists || !bounds.frontmatter) return null;
  return host.parseYaml(bounds.frontmatter) || {};
}

function ng01FileCache(app, file) {
  return app.metadataCache.getFileCache(file) || {};
}

function ng01FileTags(cache) {
  const out = [];
  const fm = frontmatterTags(cache.frontmatter);
  if (fm) for (const t of fm) out.push(t);
  if (cache.tags) for (const t of cache.tags) out.push(t.tag);
  return out;
}

/** Today's daily note file via the daily-notes core plugin; null when unavailable. */
async function ng01DailyFile(app) {
  const plugin = app.internalPlugins.getEnabledPluginById("daily-notes");
  if (!plugin) return null;
  let p = null;
  try {
    if (plugin.getDailyNotePath) p = await plugin.getDailyNotePath(window.moment());
    else if (plugin.getDailyNote) { const f = await plugin.getDailyNote(); p = f && f.path; }
  } catch (e) { return null; }
  return p ? app.vault.getAbstractFileByPath(p) : null;
}

/** Resolves file/path/active/daily args to a single file for metadata commands. */
async function ng01MetaFile(cli, app, args) {
  if (args.daily !== undefined) {
    const file = await ng01DailyFile(app);
    if (!file) throw "Daily note not found. Enable the daily-notes plugin.";
    return file;
  }
  return cli.tryResolveFile(args, args.file !== undefined || args.path !== undefined || args.active !== undefined);
}

export function ng01RegisterMetaQueries(cli, host) {
  const app = cli.app;

  // ------------------------------------------------------------ aliases

  cli.registerHandler("aliases", "List aliases", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    active: { description: "Use the active file" },
    total: { description: "Return alias count" },
    verbose: { description: "One row per alias/path pair" },
  }, (args) => {
    const perFile = args.file !== undefined || args.path !== undefined || args.active !== undefined;
    if (perFile) {
      const file = cli.tryResolveFile(args, true);
      const aliases = frontmatterAliases(ng01FileCache(app, file).frontmatter) || [];
      if (aliases.length === 0) return "No aliases found.";
      if (args.verbose) return aliases.map((a) => `${a}\t${file.path}`).join("\n");
      if (args.total) return String(aliases.length);
      return aliases.join("\n");
    }
    const map = new Map();
    for (const file of app.vault.getMarkdownFiles()) {
      const aliases = frontmatterAliases(ng01FileCache(app, file).frontmatter);
      if (!aliases) continue;
      for (const a of aliases) {
        if (!map.has(a)) map.set(a, []);
        map.get(a).push(file.path);
      }
    }
    const entries = Array.from(map.entries()).sort((a, b) => ng01Collator.compare(a[0], b[0]));
    if (entries.length === 0) return "No aliases found.";
    if (args.verbose) {
      const rows = [];
      for (const [alias, paths] of entries) {
        for (const p of paths.slice().sort(ng01Collator.compare)) rows.push(`${alias}\t${p}`);
      }
      return rows.join("\n");
    }
    if (args.total) return String(entries.length);
    return entries.map(([alias, paths]) => `${alias}\t${paths.slice().sort(ng01Collator.compare).join(", ")}`).join("\n");
  });

  // ------------------------------------------------------------ tags

  const renderTags = (rows, args) => {
    if (args.sort === "count") rows.sort((a, b) => b.count - a.count || ng01Collator.compare(a.tag, b.tag));
    else rows.sort((a, b) => ng01Collator.compare(a.tag, b.tag));
    if (args.total) return String(rows.length);
    if (args.format === "json") {
      const out = rows.map((r) => (args.counts !== undefined ? { tag: r.tag, count: r.count } : { tag: r.tag }));
      return JSON.stringify(out, null, 2);
    }
    if (args.counts !== undefined) {
      const sep = args.format === "csv" ? "," : "\t";
      return rows.map((r) => `${r.tag}${sep}${r.count}`).join("\n");
    }
    return rows.map((r) => r.tag).join("\n");
  };

  cli.registerHandler("tags", "List tags", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    active: { description: "Use the active file" },
    total: { description: "Return tag count" },
    counts: { description: "Include counts" },
    sort: { value: "name|count", description: "Sort order" },
    format: { value: "json|tsv|csv", description: "Output format" },
  }, (args) => {
    if (args.file !== undefined || args.path !== undefined || args.active !== undefined) {
      const file = cli.tryResolveFile(args, true);
      const counts = new Map();
      for (const tag of ng01FileTags(ng01FileCache(app, file))) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
      const rows = Array.from(counts.entries()).map(([tag, count]) => ({ tag, count }));
      if (rows.length === 0) return "No tags found.";
      return renderTags(rows, args);
    }
    const tags = app.metadataCache.getTags();
    const rows = Object.keys(tags).map((tag) => ({ tag, count: tags[tag] }));
    if (rows.length === 0) return "No tags found.";
    return renderTags(rows, args);
  });

  cli.registerHandler("tag", "Files with a tag", {
    name: { value: "<tag>", description: "Tag name", required: true },
    total: { description: "Return occurrence count" },
    verbose: { description: "Prefix with tag and count" },
  }, (args) => {
    let name = String(args.name);
    if (!name.startsWith("#")) name = "#" + name;
    const count = app.metadataCache.getTags()[name] || 0;
    if (count === 0) throw `Tag "${name}" not found.`;
    const lower = name.toLowerCase();
    const files = [];
    for (const file of app.vault.getMarkdownFiles()) {
      if (ng01FileTags(ng01FileCache(app, file)).some((t) => t.toLowerCase() === lower)) files.push(file.path);
    }
    files.sort(ng01Collator.compare);
    if (args.total) return String(count);
    const body = files.join("\n");
    if (args.verbose) return `${name}\t${count}\n${body}`;
    return body;
  });

  // ------------------------------------------------------------ tasks

  const taskStatus = (item, args) => {
    if (args.status !== undefined) return item.task === String(args.status);
    if (args.done !== undefined) return item.task !== " ";
    if (args.todo !== undefined) return item.task === " ";
    return true;
  };

  cli.registerHandler("tasks", "List tasks", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    active: { description: "Use the active file" },
    daily: { description: "Use today's daily note" },
    total: { description: "Return task count" },
    done: { description: "Only done tasks" },
    todo: { description: "Only todo tasks" },
    status: { value: "<c>", description: "Exact status character" },
    verbose: { description: "Group output by file" },
    format: { value: "json|tsv|csv", description: "Output format" },
  }, async (args) => {
    let files;
    if (args.file !== undefined || args.path !== undefined || args.active !== undefined || args.daily !== undefined) {
      files = [await ng01MetaFile(cli, app, args)];
    } else {
      files = app.vault.getMarkdownFiles();
    }
    const rows = [];
    for (const file of files) {
      const items = (ng01FileCache(app, file).listItems || []).filter((i) => i.task);
      if (items.length === 0) continue;
      const lines = await app.vault.cachedRead(file).then(ng01Lines);
      for (const item of items) {
        if (!taskStatus(item, args)) continue;
        const line = item.position && item.position.start ? item.position.start.line : 0;
        rows.push({ file: file.path, line: line + 1, status: item.task, text: (lines[line] || "").trim() });
      }
    }
    rows.sort((a, b) => ng01Collator.compare(a.file, b.file) || a.line - b.line);
    if (args.total) return String(rows.length);
    if (args.verbose !== undefined) {
      const groups = new Map();
      for (const r of rows) {
        if (!groups.has(r.file)) groups.set(r.file, []);
        groups.get(r.file).push(`${r.line}\t${r.text}`);
      }
      return Array.from(groups.entries()).map(([p, ls]) => p + "\n" + ls.join("\n")).join("\n\n");
    }
    if (args.format !== undefined) {
      return cli.formatTable(["status", "text", "file", "line"],
        rows.map((r) => [r.status, r.text, r.file, String(r.line)]), args.format);
    }
    return rows.map((r) => r.text).join("\n");
  });

  cli.registerHandler("task", "Inspect or update a task line", {
    ref: { value: "<path:line>", description: "Task reference" },
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    daily: { description: "Use today's daily note" },
    line: { value: "<n>", description: "1-based line number" },
    status: { value: "<c>", description: "Set status character" },
    done: { description: "Mark done" },
    todo: { description: "Mark todo" },
    toggle: { description: "Toggle done/todo" },
  }, async (args) => {
    let file = null;
    let lineNo = NaN;
    if (args.ref !== undefined) {
      const ref = String(args.ref);
      const idx = ref.lastIndexOf(":");
      if (idx <= 0) throw `Invalid ref format. Expected path:line (e.g., "Note.md:5")`;
      const p = ref.slice(0, idx);
      lineNo = parseInt(ref.slice(idx + 1), 10);
      file = app.vault.getAbstractFileByPath(p);
      if (!file) throw `File "${p}" not found.`;
    } else {
      file = await ng01MetaFile(cli, app, args);
      lineNo = parseInt(args.line, 10);
      if (isNaN(lineNo)) throw "Missing required parameter: line\nUsage: task file=<name> line=<n>";
    }
    if (isNaN(lineNo) || lineNo < 1) throw "Missing required parameter: line\nUsage: task ref=<path:line>";
    const content = await app.vault.cachedRead(file);
    const lines = ng01Lines(content);
    const idx = lineNo - 1;
    if (idx >= lines.length) throw `Line ${lineNo} is out of range. File has ${lines.length} lines.`;
    const raw = lines[idx];
    const match = raw.match(/^(\s*(?:[-*]|\d+\.)\s*)\[([^\]])\](.*)$/);
    if (!match) throw `Line ${lineNo} is not a task.`;
    const oldStatus = match[2];
    const text = match[3].trim();
    let newStatus = null;
    if (args.status !== undefined) {
      const s = String(args.status);
      if (s.length !== 1) throw "Status must be a single character.";
      newStatus = s;
    } else if (args.done !== undefined) newStatus = "x";
    else if (args.todo !== undefined) newStatus = " ";
    else if (args.toggle !== undefined) newStatus = oldStatus === " " ? "x" : oldStatus === "x" ? " " : "x";
    const statusOut = newStatus === null ? oldStatus : `[${oldStatus}] → [${newStatus}]`;
    const report = ng01Kv([
      ["file", file.path],
      ["line", String(lineNo)],
      ["status", statusOut],
      ["text", text],
    ]);
    if (newStatus === null) return report;
    lines[idx] = match[1] + "[" + newStatus + "]" + match[3];
    await app.vault.modify(file, lines.join("\n") + (content.endsWith("\n") ? "\n" : ""));
    return report;
  });

  // ------------------------------------------------------------ properties

  cli.registerHandler("properties", "List properties", {
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    active: { description: "Use the active file" },
    name: { value: "<key>", description: "Single property name" },
    total: { description: "Return property count" },
    sort: { value: "name|count", description: "Sort order" },
    counts: { description: "name/count lines" },
    format: { value: "yaml|json|tsv", description: "Per-file output format" },
  }, async (args) => {
    if (args.file !== undefined || args.path !== undefined || args.active !== undefined) {
      const file = cli.tryResolveFile(args, true);
      const fm = await ng01LiveFrontmatter(app, host, file);
      if (!fm || Object.keys(fm).length === 0) return "No frontmatter found.";
      if (args.format === "json") return JSON.stringify(fm, null, 2);
      if (args.format === "tsv") {
        return Object.keys(fm).map((k) => {
          const v = fm[k];
          const text = Array.isArray(v) ? v.join(", ") : (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v));
          return `${k}\t${text}`;
        }).join("\n");
      }
      return host.yamlStringify(fm).trim();
    }
    const mgr = app.metadataTypeManager;
    const infos = mgr && mgr.getAllProperties ? mgr.getAllProperties() : app.metadataCache.getAllPropertyInfos();
    const keys = Object.keys(infos);
    if (args.name !== undefined) {
      const lower = String(args.name).toLowerCase();
      for (const k of keys) {
        if (k.toLowerCase() === lower || (infos[k].name || "").toLowerCase() === lower) return String(infos[k].occurrences || 0);
      }
      return "0";
    }
    if (args.format === "json") {
      const rows = keys.map((k) => ({ name: infos[k].name || k, type: infos[k].widget || "", count: infos[k].occurrences || 0 }));
      return JSON.stringify(rows, null, 2);
    }
    let sorted = keys.slice();
    if (args.sort === "count") sorted.sort((a, b) => (infos[b].occurrences || 0) - (infos[a].occurrences || 0) || ng01Collator.compare(a, b));
    else sorted.sort(ng01Collator.compare);
    if (args.total) return String(sorted.length);
    if (args.counts !== undefined) return sorted.map((k) => `${infos[k].name || k}\t${infos[k].occurrences || 0}`).join("\n");
    return sorted.map((k) => infos[k].name || k).join("\n");
  });

  const propTarget = (args) => cli.tryResolveFile(args, true);
  const propName = (fm, name) => Object.keys(fm || {}).find((k) => k.toLowerCase() === String(name).toLowerCase());

  cli.registerHandler("property:read", "Read a frontmatter property", {
    name: { value: "<key>", description: "Property name", required: true },
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    active: { description: "Use the active file" },
  }, async (args) => {
    const file = propTarget(args);
    const fm = await ng01LiveFrontmatter(app, host, file);
    const key = propName(fm, args.name);
    if (key === undefined) throw `Property "${args.name}" not found.`;
    const v = fm[key];
    if (v === "" || v === null || v === undefined) return "(empty)";
    if (Array.isArray(v)) return v.length ? v.join("\n") : "(empty)";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });

  cli.registerHandler("property:remove", "Remove a frontmatter property", {
    name: { value: "<key>", description: "Property name", required: true },
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    active: { description: "Use the active file" },
  }, async (args) => {
    const file = propTarget(args);
    await app.fileManager.processFrontMatter(file, (data) => {
      const key = propName(data, args.name);
      if (key !== undefined) delete data[key];
    });
    return `Removed: ${args.name}`;
  });

  cli.registerHandler("property:set", "Set a frontmatter property", {
    name: { value: "<key>", description: "Property name", required: true },
    value: { value: "<v>", description: "Value", required: true },
    type: { value: "text|list|number|checkbox|date|datetime", description: "Property type" },
    file: { value: "<name>", description: "File name" },
    path: { value: "<path>", description: "File path" },
    active: { description: "Use the active file" },
  }, async (args) => {
    const file = propTarget(args);
    const name = String(args.name);
    const raw = String(args.value);
    const widgets = { text: "text", list: "multitext", number: "number", checkbox: "checkbox", date: "date", datetime: "datetime" };
    const type = args.type !== undefined ? String(args.type) : "";
    if (type && !widgets[type]) throw `Invalid type: ${type}`;
    let value;
    if (raw.length > 1 && raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        value = Array.isArray(parsed) ? parsed : raw;
      } catch (e) { value = raw; }
    } else if (type === "number") {
      value = Number(raw);
      if (isNaN(value)) throw `Invalid number: ${raw}`;
    } else if (type === "checkbox") {
      value = raw === "true" || raw === "1";
    } else if (type === "list") {
      value = raw.split(",").map((s) => s.trim());
    } else if (type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw `Invalid date: ${raw}`;
      value = raw;
    } else if (type === "datetime") {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)) throw `Invalid datetime: ${raw}`;
      value = raw;
    } else {
      value = raw;
    }
    await app.fileManager.processFrontMatter(file, (data) => { data[name] = value; });
    if (type) {
      const mgr = app.metadataTypeManager;
      if (mgr && mgr.setType) await mgr.setType(name, widgets[type]);
    }
    return `Set ${name}: ${raw}`;
  });
}
