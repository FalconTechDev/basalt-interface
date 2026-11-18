// g01 clean-room: workspace / tabs / hotkey introspection + tab:open.
import { env } from "./env.js";

function ng01LeafLabel(leaf, ids) {
  let type = "empty";
  try { type = leaf.view ? leaf.view.getViewType() : "empty"; } catch (e) {}
  let text = "";
  try { text = leaf.getDisplayText() || ""; } catch (e) {}
  return `[${type}] ${text}` + (ids ? `\t${leaf.id}` : "");
}

function ng01NodeLabel(node, ids) {
  if (node.type === "leaf") return ng01LeafLabel(node, ids);
  let label = node.type;
  if (node.direction) label += ":" + node.direction;
  if (ids && node.id) label += ` (${node.id})`;
  return label;
}

function ng01MapNode(node, ids) {
  const children = (node.children || []).map((c) => ng01MapNode(c, ids));
  return { label: ng01NodeLabel(node, ids), children };
}

/** Finds a tabs/split container node by id across all root splits. */
function ng01FindGroupNode(ws, id) {
  const roots = [ws.rootSplit, ws.leftSplit, ws.rightSplit, ws.floatingSplit];
  const visit = (node) => {
    if (!node || !node.children) return null;
    if (node.id === id) return node;
    for (const child of node.children) {
      const hit = visit(child);
      if (hit) return hit;
    }
    return null;
  };
  for (const root of roots) {
    const hit = visit(root);
    if (hit) return hit;
  }
  return null;
}

export function ng01RegisterWorkspace(cli, host) {
  const app = cli.app;
  const ws = app.workspace;

  cli.registerHandler("tabs", "List open tabs", {
    ids: { description: "Include leaf ids" },
  }, (args) => {
    const lines = [];
    const ids = args.ids !== undefined;
    ws.iterateAllLeaves((leaf) => {
      lines.push(ng01LeafLabel(leaf, ids));
    });
    return lines.join("\n");
  });

  cli.registerHandler("workspace", "Workspace layout tree", {
    ids: { description: "Include node ids" },
  }, (args) => {
    const ids = args.ids !== undefined;
    const areas = [];
    const push = (name, split) => {
      if (!split) return;
      if (name === "floating" && (!split.children || split.children.length === 0)) return;
      const children = (split.children || []).map((c) => ng01MapNode(c, ids));
      areas.push(cli.formatAsciiTreeWithRoot(name, children));
    };
    push("main", ws.rootSplit);
    push("left", ws.leftSplit);
    push("right", ws.rightSplit);
    push("floating", ws.floatingSplit);
    return areas.join("\n\n");
  });

  cli.registerHandler("tab:open", "Open a new tab", {
    group: { value: "<id>", description: "Group/node id (see workspace ids)" },
    file: { value: "<path>", description: "File path to open" },
    view: { value: "<type>", description: "View type to open" },
  }, async (args) => {
    let leaf = null;
    if (args.group !== undefined) {
      const node = ng01FindGroupNode(ws, String(args.group));
      if (!node) throw `Group "${args.group}" not found. Use "workspace ids=true" to list group ids.`;
      let target = node.type === "tabs" ? node : null;
      if (!target) {
        const findTabs = (n) => {
          if (n.type === "tabs") return n;
          for (const c of n.children || []) { const t = findTabs(c); if (t) return t; }
          return null;
        };
        target = findTabs(node);
      }
      if (!target) throw `Group "${args.group}" has no tab container.`;
      leaf = ws.createLeafInParent(target, target.children.length);
    } else {
      leaf = ws.getLeaf("tab");
    }
    if (args.file !== undefined) {
      const path = String(args.file);
      const file = app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof host.TFile)) throw `File "${path}" not found.`;
      await leaf.openFile(file, { active: true });
      if (args.view !== undefined) await leaf.setViewState({ type: String(args.view), state: {} });
      return `Opened: ${file.path}`;
    }
    if (args.view !== undefined) {
      await leaf.setViewState({ type: String(args.view), state: {} });
      return `Opened view: ${args.view}`;
    }
    return "Opened new tab";
  });

  // ------------------------------------------------------------ hotkeys

  cli.registerHandler("hotkeys", "List command hotkeys", {
    total: { description: "Return count" },
    verbose: { description: "Add custom/default column" },
    all: { description: "Accepted for compatibility" },
    format: { value: "json|tsv|csv", description: "Output format" },
  }, (args) => {
    const rows = [];
    for (const cmd of app.commands.listCommands()) {
      const custom = app.hotkeyManager.getHotkeys(cmd.id);
      const fallback = app.hotkeyManager.getDefaultHotkeys(cmd.id);
      const effective = custom && custom.length ? custom : fallback;
      if (!effective || !effective.length) continue;
      const text = effective.map((h) => host.formatHotkey(h)).join(", ");
      const source = custom && custom.length ? "custom" : "default";
      rows.push(args.verbose !== undefined ? [cmd.id, text, source] : [cmd.id, text]);
    }
    rows.sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base", numeric: true }));
    if (args.total) return String(rows.length);
    const headers = args.verbose !== undefined ? ["id", "hotkey", "source"] : ["id", "hotkey"];
    return cli.formatTable(headers, rows, args.format);
  });

  cli.registerHandler("hotkey", "Hotkeys for one command", {
    id: { value: "<command-id>", description: "Command id", required: true },
    verbose: { description: "Append (custom)/(default)" },
  }, (args) => {
    const id = String(args.id);
    if (!app.commands.findCommand(id)) throw `Command "${id}" not found.`;
    const custom = app.hotkeyManager.getHotkeys(id);
    const fallback = app.hotkeyManager.getDefaultHotkeys(id);
    const effective = custom && custom.length ? custom : fallback;
    if (!effective || !effective.length) return "(none)";
    const text = effective.map((h) => host.formatHotkey(h)).join(", ");
    if (args.verbose !== undefined) return text + (custom && custom.length ? " (custom)" : " (default)");
    return text;
  });
}
