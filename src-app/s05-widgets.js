// s05 slice: UI widgets and vault-chooser suggesters.
// - unified-diff builder used by `diff` CLI output
// - singleton progress bar overlay
// - vault switcher / vault select / mobile vault select suggestion modals
import { env } from "./env.js";
import { s05MobileVaultList } from "./s05-utils.js";

// Accumulates diff lines and renders them as unified-diff hunks.
export function defineDiffBuilder() {
  return class DiffBuilder {
    constructor() {
      this.diffs = [];
      this.start1 = 0;
      this.start2 = 0;
      this.length1 = 0;
      this.length2 = 0;
    }

    toString() {
      const marker = env().XD;
      const lines = ["@@ -" +
        (this.length1 === 0 ? this.start1 + ",0" :
         this.length1 === 1 ? this.start1 + 1 : this.start1 + 1 + "," + this.length1) +
        " +" +
        (this.length2 === 0 ? this.start2 + ",0" :
         this.length2 === 1 ? this.start2 + 1 : this.start2 + 1 + "," + this.length2) +
        " @@\n"];
      for (let i = 0; i < this.diffs.length; i++) {
        let prefix;
        switch (this.diffs[i][0]) {
          case marker.DIFF_INSERT: prefix = "+"; break;
          case marker.DIFF_DELETE: prefix = "-"; break;
          case marker.DIFF_EQUAL: prefix = " "; break;
        }
        lines[i + 1] = prefix + encodeURI(this.diffs[i][1]) + "\n";
      }
      return lines.join("").replace(/%20/g, " ");
    }
  };
}

// Singleton progress bar prepended to the document body.
export function defineProgressBar() {
  return class ProgressBar {
    constructor(doc = env().activeDocument) {
      this.doc = doc;
      const container = this.containerEl = env().createDiv("progress-bar-container");
      const bar = container.createDiv({ cls: "progress-bar" });
      this.messageEl = bar.createDiv({ cls: "progress-bar-message u-center-text" });
      bar.createDiv("progress-bar-indicator", (indicator) => {
        indicator.createDiv("progress-bar-line");
        this.lineEl = indicator.createDiv("progress-bar-subline");
        this.line1El = indicator.createDiv("progress-bar-subline mod-increase");
        this.line2El = indicator.createDiv("progress-bar-subline mod-decrease");
      });
      this.contextEl = bar.createDiv("progress-bar-context");
      container.addEventListener("click", (event) => event.preventDefault());
      this.setUnknownProgress();
    }

    static get instance() {
      if (!ProgressBar._instance) ProgressBar._instance = new ProgressBar();
      return ProgressBar._instance;
    }

    show() {
      this.doc.body.prepend(this.containerEl);
      this.doc.body.addClass("in-progress");
      this.containerEl.style.opacity = "";
      return this;
    }

    hide() {
      this.containerEl.remove();
      this.doc.body.removeClass("in-progress");
      return this;
    }

    setMessage(text) {
      this.messageEl.setText(text);
      return this;
    }

    setUnknownProgress() {
      this.lineEl.hide();
      this.line1El.show();
      this.line2El.show();
      return this;
    }

    setProgress(done, total) {
      this.lineEl.show();
      this.line1El.hide();
      this.line2El.hide();
      const percent = (done / total * 100).toFixed(4);
      this.lineEl.style.width = percent + "%";
      return this;
    }

    clearContext() {
      this.contextEl.empty();
      return this;
    }

    setContext(builder) {
      this.contextEl.empty();
      builder(this.contextEl);
      return this;
    }
  };
}

// Base vault picker: lists vaults via the vault-list IPC and opens the chosen
// one. Subclasses customise where the list comes from.
let VaultSuggestClass = null;

function vaultSuggestClass(host) {
  if (VaultSuggestClass) return VaultSuggestClass;
  const Base = host.FuzzySuggestModal;
  VaultSuggestClass = class VaultSuggest extends Base {
    constructor(app) {
      super(app);
      this.items = [];
      this.setPlaceholder(env().gm.commands.changeVault());
      this.setInstructions([
        { command: "↑↓", purpose: env().gm.plugins.commandPalette.instructionNavigate() },
        { command: "↵", purpose: env().gm.plugins.commandPalette.instructionUse() },
        { command: "esc", purpose: env().gm.plugins.commandPalette.instructionDismiss() },
      ]);
    }

    onOpen() {
      super.onOpen();
      this.loadVaults();
    }

    getItems() {
      return this.items;
    }

    getItemText(item) {
      return item.name;
    }

    renderSuggestion(itemEl, suggestion) {
      super.renderSuggestion(itemEl, suggestion);
      if (itemEl.item.isCurrentVault) {
        suggestion.createSpan({ cls: "flair mod-pop", text: env().gm.setting.appearance.labelCurrentlyActive() });
      }
    }
  };
  return VaultSuggestClass;
}

export function defineVaultSuggest(host) {
  return vaultSuggestClass(host);
}

// Desktop vault switcher: reads the vault registry over IPC.
export function defineVaultSwitcher(host) {
  const Base = vaultSuggestClass(host);
  return class VaultSwitcher extends Base {
    constructor(app, switchVault = true) {
      super(app);
      this.switchVault = switchVault;
    }

    loadVaults() {
      const path = window.require("path");
      const current = env().electron.ipcRenderer.sendSync("vault").path;
      const registry = env().electron.ipcRenderer.sendSync("vault-list");
      for (const key in registry) {
        if (Object.hasOwn(registry, key)) {
          const entry = registry[key];
          const name = path.basename(entry.path);
          const isCurrent = current === entry.path;
          this.items.push({ path: entry.path, name, isCurrentVault: isCurrent });
        }
      }
      this.updateSuggestions();
    }

    onChooseItem(item) {
      if (item.isCurrentVault) return;
      const opened = window.electron.ipcRenderer.sendSync("vault-open", item.path, false);
      if (opened === true) {
        if (this.switchVault) window.close();
      } else {
        new (env().fb)(env().gm.interface.startScreen.msgErrorFailedToOpenVault());
      }
    }
  };
}

// Mobile vault picker: vaults come from the mobile filesystem adapters and the
// selection is persisted in localStorage before reloading.
export function defineMobileVaultSelect(host) {
  const Base = vaultSuggestClass(host);
  return class MobileVaultSelect extends Base {
    loadVaults() {
      return (async () => {
        const selected = localStorage.getItem("mobile-selected-vault");
        const vaults = await s05MobileVaultList();
        for (let i = 0; i < vaults.length; i++) {
          const vault = vaults[i];
          let name = vault.name;
          if (vault.storageType === "iCloud") name += " (iCloud)";
          this.items.push({ path: vault.location, name, isCurrentVault: selected === vault.location });
        }
        this.updateSuggestions();
      })();
    }

    onChooseItem(item) {
      if (item.isCurrentVault) return;
      window.localStorage.setItem("mobile-selected-vault", item.path);
      location.reload();
    }
  };
}
