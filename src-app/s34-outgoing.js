// The "Outgoing links" core plugin: a side-pane view listing the links leaving the current note
// plus its unlinked mentions (the view itself is the shared outgoing-link pane, already own code).
//
// Replaces the inherited pieces:
//   r7  OutgoingLinksPlugin -> defineOutgoingLinksPlugin
//   n7  "outgoing-link"      -> declarator "outgoing-link"
//   i7  gm.plugins.outgoingLinks -> declarator __basaltHost.t.plugins.outgoingLinks
//   s7/l7                    -> dead inherited tree-row constructors (nothing references them);
//                               declarators become null.

import { anyMetadataRef } from "./metadata-helpers.js";
import { parseLinktext } from "./path.js";

const s34OutgoingViewType = "outgoing-link";
const outgoingT = (host) => host.t.plugins.outgoingLinks;

/** Plugin shell: view type, open commands, file-menu entry and the "links" CLI command. */
export function defineOutgoingLinksPlugin(host) {
  class OutgoingLinksPlugin {
    constructor() {
      this.id = "outgoing-link";
      this.name = outgoingT(host).name();
      this.description = outgoingT(host).desc();
      this.defaultOn = true;
    }

    init(app, plugin) {
      const self = this;
      this.app = app;
      this.plugin = plugin;
      plugin.registerViewType(s34OutgoingViewType, (leaf) => new host.OutgoingLinkView(leaf));
      plugin.registerGlobalCommand({
        id: "outgoing-links:open",
        name: outgoingT(host).actionShow(),
        icon: "lucide-link",
        callback: () => {
          self.app.workspace.ensureSideLeaf(s34OutgoingViewType, "right", { active: true });
        },
      });
      plugin.registerGlobalCommand({
        id: "outgoing-links:open-for-current",
        name: outgoingT(host).actionOpenForCurrent(),
        icon: "lucide-link",
        checkCallback: this.openForCurrentFile.bind(this),
      });
    }

    onEnable(app, wrapper) {
      wrapper.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
      wrapper.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
      wrapper.registerCliHandler(
        "links",
        "List outgoing links from a file",
        {
          file: { value: "<name>", description: "File name" },
          path: { value: "<path>", description: "File path" },
          total: { description: "Return link count" },
        },
        (args) => {
          const file = app.cli.tryResolveFile(args);
          const cache = app.metadataCache.getFileCache(file);
          if (!cache) return "No links found.";
          const targets = new Set();
          const sourcePath = file.path;
          anyMetadataRef(cache, (ref) => {
            const link = parseLinktext(ref.link).path;
            const dest = app.metadataCache.getFirstLinkpathDest(link, sourcePath);
            targets.add(dest ? dest.path : link + " (unresolved)");
          });
          if (args.total) return String(targets.size);
          if (targets.size === 0) return "No links found.";
          return Array.from(targets).sort().join("\n");
        }
      );
    }

    onUserEnable() {
      this.initLeaf();
    }

    onUserDisable(app) {
      app.workspace.detachLeavesOfType(s34OutgoingViewType);
    }

    initLeaf() {
      this.app.workspace.ensureSideLeaf(s34OutgoingViewType, "right", { reveal: false });
    }

    onFileMenu(menu, file, source, leaf) {
      if (host.Platform.isMobile) return;
      if (!(file instanceof host.TFile) || !leaf || file.extension !== "md") return;
      if (source === "sidebar-context-menu") return;
      const self = this;
      menu.addItem((item) =>
        item
          .setSection("view.linked")
          .setTitle(outgoingT(host).actionOpen())
          .setIcon("links-going-out")
          .onClick(async () => {
            await self.app.workspace.splitLeafOrActive(leaf, "horizontal").setViewState({
              type: s34OutgoingViewType,
              active: true,
              group: leaf,
              state: { file: file.path },
            });
          })
      );
    }

    openForCurrentFile(checking) {
      if (host.Platform.isPhone) return false;
      const workspace = this.app.workspace;
      const file = workspace.getActiveFile();
      if (file) {
        if (!checking) {
          workspace.splitActiveLeaf("vertical").setViewState({
            type: s34OutgoingViewType,
            active: true,
            group: workspace.activeLeaf,
            state: { file: file.path },
          });
        }
        return true;
      }
    }
  }
  return OutgoingLinksPlugin;
}
