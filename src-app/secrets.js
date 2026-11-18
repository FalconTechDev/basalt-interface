// The secrets ("keychain") feature: the tab in the settings dialog, the small dialogs and components used to create and
// pick secrets, the callout and the button-footer modal they share, and the SecretStorage service with its desktop
// (Electron safeStorage) and mobile (Capacitor preferences) backends.
//
// Storage keys are part of the on-disk format and stay byte-identical: "secrets" (legacy plaintext),
// "secrets-encrypted" (safeStorage-encrypted JSON), "secrets-meta" (last-access times) and
// "secrets-encryption-warning-dismissed" (the nag flag in localStorage).
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";

const LEGACY_SECRETS_KEY = "secrets";
const ENCRYPTED_SECRETS_KEY = "secrets-encrypted";
const SECRETS_META_KEY = "secrets-meta";
const WARNING_DISMISSED_KEY = "secrets-encryption-warning-dismissed";

export function defineSecretsButtonModal(host) {
  /** A Modal with a footer button row: addButton (async, shows a spinner, closes on falsy result), addCancelButton, addCheckbox. */
  function ButtonModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.containerEl.addClass("mod-confirmation");
    self.buttonContainerEl = self.modalEl.createDiv("modal-button-container");
    return self;
  }
  inherit(ButtonModal, host.Modal);
  const proto = ButtonModal.prototype;
  proto.addCheckbox = function (label, onClick) {
    this.buttonContainerEl.createEl("label", { cls: "mod-checkbox" }, (el) => {
      el.createEl("input", { attr: { tabindex: -1 }, type: "checkbox" }).addEventListener("click", onClick);
      el.appendText(label);
    });
    return this;
  };
  proto.addButton = function (cls, text, onClick) {
    const classes = Array.isArray(cls) ? cls : [cls];
    const button = this.buttonContainerEl.createEl("button", { cls: classes.join(" "), text });
    button.addEventListener("click", async (event) => {
      button.addClass("mod-loading");
      try {
        const keepOpen = await onClick(event);
        if (!keepOpen) this.close();
      } finally {
        button.removeClass("mod-loading");
      }
    });
    return this;
  };
  proto.addCancelButton = function (onClick) {
    return this.addButton("mod-cancel", host.t.dialogue.buttonCancel(), () => { if (onClick) onClick(); });
  };
  proto.onClose = function () { host.hideTooltip(); };
  return ButtonModal;
}

export function defineCallout(host) {
  /** An inline notice box inside a settings page: icon + title + content, coloured by `type`. */
  function Callout(containerEl) {
    this.iconEl = null;
    const callout = (this.calloutEl = containerEl.createDiv("callout"));
    const title = (this.titleEl = callout.createDiv("callout-title"));
    this.titleInnerEl = title.createDiv("callout-title-inner");
    this.contentEl = callout.createDiv("callout-content");
  }
  const proto = Callout.prototype;
  proto.setTitle = function (title) { this.titleInnerEl.setText(title); return this; };
  proto.setContent = function (content) { this.contentEl.setText(content); return this; };
  proto.setIcon = function (icon) {
    if (!this.iconEl) {
      this.iconEl = this.titleEl.createDiv("callout-icon");
      this.titleEl.insertBefore(this.iconEl, this.titleInnerEl);
    }
    host.setIcon(this.iconEl, icon);
    return this;
  };
  proto.setType = function (type) { this.calloutEl.dataset.callout = type; return this; };
  return Callout;
}

export function defineSecretChooser(host) {
  /** The suggestion list used to pick a stored secret: radio row, masked value with a reveal button, delete button. */
  function SecretChooser(app, containerEl, scope, onChange) {
    this.app = app;
    this.onChange = onChange;
    this.chooser = new host.SuggestionList(this, containerEl, scope).shouldSelectOnHover(false);
  }
  const proto = SecretChooser.prototype;
  proto.setValue = function (value, suggestions) {
    this.value = value;
    this.chooser.setSuggestions(suggestions);
  };
  proto.renderSuggestion = function (value, el) {
    const self = this;
    const selected = value === this.value;
    el.addClasses(["mod-complex", "suggestion-secret-key"]);
    const radio = el.createEl("input", { attr: { type: "radio" } });
    const content = el.createDiv("suggestion-content");
    const aux = el.createDiv("suggestion-aux");
    const title = content.createDiv("suggestion-title");
    const secretText = aux.createDiv("suggestion-secret-text");
    let revealed = false;
    const eye = aux.createDiv("clickable-icon");
    const paint = () => {
      if (revealed) {
        secretText.setText(self.app.secretStorage.peekSecret(value));
        host.setIcon(eye, "lucide-eye");
      } else {
        secretText.setText("•••••••");
        host.setIcon(eye, "lucide-eye-off");
      }
    };
    eye.addEventListener("click", (event) => {
      event.preventDefault();
      revealed = !revealed;
      paint();
    });
    paint();
    const del = aux.createDiv("clickable-icon");
    host.setIcon(del, "lucide-trash-2");
    del.addEventListener("click", (event) => {
      event.preventDefault();
      if (self.app.secretStorage.deleteSecret(value)) {
        if (self.value === value) {
          self.value = "";
          self.onChange("");
        }
        self.chooser.setSuggestions(self.app.secretStorage.listSecrets());
      }
    });
    radio.checked = selected;
    title.setText(value);
    if (selected) content.createDiv({ cls: "flair", text: host.t.dialogue.labelSelected() });
  };
  proto.selectSuggestion = function (value) {
    this.value = value;
    this.onChange(value);
    this.chooser.renderSuggestions();
  };
  return SecretChooser;
}

export function defineSecretEditModal(host) {
  /** Create or rename a secret: id + value form, password visibility toggle, validation through tooltips. */
  function SecretEditModal(app, existingId, onSuccess) {
    const self = host.ButtonModal.call(this, app) || this;
    self.existingId = existingId;
    self.onSuccess = onSuccess;
    self.currentId = "";
    self.secretValue = "";
    self.setTitle(existingId ? host.keychainI18n.actionEditSecret() : host.keychainI18n.actionAddSecret());
    if (existingId) {
      self.currentId = existingId;
      const stored = app.secretStorage.peekSecret(existingId);
      if (stored !== null) self.secretValue = stored;
    }
    self.contentEl.createEl("form", { attr: { id: "secret-form" } }, (form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        self.handleSubmit();
      });
      let secretInput = null;
      new host.Setting(form)
        .setName(host.keychainI18n.labelSecretId())
        .setDesc(host.keychainI18n.optionSecretIdDescription())
        .addText((text) => {
          self.nameComponent = text;
          text.inputEl.autocapitalize = "off";
          text.setValue(self.currentId).setPlaceholder(host.keychainI18n.placeholderSecretId()).onChange((value) => { self.currentId = value; });
        });
      new host.Setting(form)
        .setName(host.keychainI18n.labelSecretValue())
        .setDesc(host.keychainI18n.optionSecretValueDescription())
        .addExtraButton((button) => {
          button.setIcon("lucide-eye-off").setTooltip(host.keychainI18n.actionShowSecretValue()).onClick(() => {
            const wasPassword = secretInput.type === "password";
            secretInput.type = wasPassword ? "text" : "password";
            button.setIcon(wasPassword ? "lucide-eye" : "lucide-eye-off");
            button.setTooltip(wasPassword ? host.keychainI18n.actionHideSecretValue() : host.keychainI18n.actionShowSecretValue());
          });
        })
        .addText((text) => {
          self.secretComponent = text;
          secretInput = text.inputEl;
          secretInput.type = "password";
          secretInput.setAttribute("autocomplete", "off");
          text.setValue(self.secretValue).setPlaceholder("sk-...").onChange((value) => { self.secretValue = value; });
        });
    });
    self.buttonContainerEl.createEl("button", { cls: "mod-cta", text: host.t.dialogue.buttonSave(), type: "submit", attr: { form: "secret-form" } });
    self.addCancelButton();
    return self;
  }
  inherit(SecretEditModal, host.ButtonModal);
  const proto = SecretEditModal.prototype;
  proto.handleSubmit = function () {
    if (this.saveSecret()) this.close();
  };
  proto.saveSecret = function () {
    const existingId = this.existingId;
    const currentId = this.currentId;
    const secretValue = this.secretValue;
    const fail = (input, message) => { host.displayTooltip(input, message, { classes: ["mod-error"] }); return false; };
    if (existingId !== currentId && this.app.secretStorage.peekSecret(currentId) !== null) return fail(this.nameComponent.inputEl, host.keychainI18n.msgErrorSecretIdExists());
    if (!this.app.secretStorage.validateId(currentId)) return fail(this.nameComponent.inputEl, host.keychainI18n.msgErrorSecretIdInvalid());
    if (secretValue === "") return fail(this.secretComponent.inputEl, host.keychainI18n.msgErrorSecretValueEmpty());
    if (existingId && existingId !== currentId) this.app.secretStorage.deleteSecret(existingId);
    try {
      this.app.secretStorage.setSecret(currentId, secretValue);
      this.onSuccess(currentId);
      return true;
    } catch (error) {
      if (error instanceof Error) host.displayTooltip(this.nameComponent.inputEl, error.message, { classes: ["mod-error"] });
      return false;
    }
  };
  return SecretEditModal;
}

export function defineEncryptionInfoModal(host) {
  /** Explains why secrets cannot be encrypted on this system (safeStorage unavailable). */
  function EncryptionInfoModal(app) {
    const self = host.ButtonModal.call(this, app) || this;
    self.setTitle(host.t.setting.keychain.labelEncryptionNotAvailable());
    self.modalEl.addClass("mod-lg", "mod-scrollable-content", "mod-plugin-debug");
    self.contentEl.createEl("p", { text: host.t.setting.keychain.msgEncryptionProvidedByOS() });
    if (host.Platform.isLinux) {
      self.contentEl.createEl("p", { text: host.t.setting.keychain.msgLinuxSecretStores() });
      self.contentEl.createEl("ul", {}, (list) => {
        list.createEl("li", { text: "gnome-keyring" });
        list.createEl("li", { text: "kwallet" });
        list.createEl("li", { text: "kwallet5" });
        list.createEl("li", { text: "kwallet6" });
      });
    }
    self.addButton("mod-cancel", host.t.dialogue.buttonDone(), () => {});
    return self;
  }
  inherit(EncryptionInfoModal, host.ButtonModal);
  return EncryptionInfoModal;
}

export function defineSecretPickerModal(host) {
  /** Searchable list of stored secrets with an "add secret" shortcut; resolves through the onSave callback. */
  function SecretPickerModal(app, settingValue, onSave) {
    const self = host.ButtonModal.call(this, app) || this;
    self.settingValue = settingValue;
    self.modalEl.addClass("mod-secret", "mod-scrollable-content", "mod-lg");
    self.setTitle(host.t.setting.keychain.labelSelectSecret());
    const headerEl = self.headerEl;
    const contentEl = self.contentEl;
    let query = "";
    let value = settingValue != null ? settingValue : "";
    let chooser = null;
    const refresh = () => {
      const secrets = self.app.secretStorage.listSecrets();
      const prepared = prepareQuery(query);
      chooser.setValue(value, secrets.filter((id) => fuzzyMatchJs(prepared, id)));
    };
    const toolbar = headerEl.createDiv("suggestion-filter-toolbar");
    new host.SearchComponent(toolbar)
      .setPlaceholder(host.t.setting.keychain.placeholderSearchSecret())
      .onChange((text) => { query = text; refresh(); });
    contentEl.addClass("keychain-list-results");
    chooser = new host.SecretChooser(app, contentEl, self.scope, (picked) => { value = picked; });
    refresh();
    self.addButton("mod-secondary", host.t.setting.keychain.buttonAddSecret(), () => {
      self.close();
      new host.SecretEditModal(self.app, null, (id) => { value = id; self.open(); refresh(); }).open();
    });
    self.addButton("mod-cta", host.t.dialogue.buttonSave(), () => { onSave(value); self.close(); });
    self.addCancelButton();
    return self;
  }
  inherit(SecretPickerModal, host.ButtonModal);
  return SecretPickerModal;
}

export function defineSecretComponent(host) {
  /** Setting row control that links a config value to a stored secret (masked display, picker on click). */
  function SecretComponent(app, containerEl) {
    const self = host.BaseComponent.call(this) || this;
    self.settingKey = "";
    self.app = app;
    self.warningEl = containerEl.createDiv({ cls: "clickable-icon mod-warning" });
    host.setIcon(self.warningEl, "lucide-alert-triangle");
    host.setTooltip(self.warningEl, host.t.setting.keychain.msgSecretsNotEncryptedShort());
    self.warningEl.toggle(!app.secretStorage.isEncryptionAvailable());
    self.warningEl.addEventListener("click", () => new host.EncryptionInfoModal(app).open());
    self.valueEl = containerEl.createDiv();
    self.buttonEl = containerEl.createEl("button", { text: host.t.setting.keychain.buttonLink() });
    self.buttonEl.addEventListener("click", () => {
      if (self.disabled) return;
      const done = (key) => {
        self.setValue(key);
        if (self.changeCallback) self.changeCallback.call(self, key);
      };
      if (app.secretStorage.listSecrets().length > 0) new host.SecretPickerModal(app, self.settingKey, done).open();
      else new host.SecretEditModal(app, "", done).open();
    });
    return self;
  }
  inherit(SecretComponent, host.BaseComponent);
  const proto = SecretComponent.prototype;
  proto.setValue = function (key) {
    const self = this;
    this.settingKey = key;
    this.valueEl.empty();
    const secret = key ? this.app.secretStorage.peekSecret(key) : null;
    if (secret !== null) {
      this.valueEl.createSpan("setting-hotkey", (row) => {
        const masked = row.createSpan({ cls: "setting-password", text: "•••••••" });
        let revealed = false;
        masked.addEventListener("click", () => {
          revealed = !revealed;
          masked.setText(revealed ? secret : "•••••••");
        });
        row.createSpan("setting-hotkey-icon", (icon) => {
          host.setIcon(icon, "lucide-x");
          icon.addEventListener("click", () => {
            self.setValue(null);
            self.changeCallback(null);
          });
        });
        self.buttonEl.setText(host.t.dialogue.buttonChange());
      });
    } else {
      this.buttonEl.setText(host.t.setting.keychain.buttonLink());
    }
    return this;
  };
  proto.onChange = function (callback) { this.changeCallback = callback; return this; };
  return SecretComponent;
}

export function defineKeychainTab(host) {
  /** Settings page listing the stored secrets with search, add, edit and delete. */
  function KeychainTab(app, setting) {
    const self = host.SettingTab.call(this, app, setting) || this;
    self.name = host.keychainI18n.name();
    self.id = "keychain";
    self.icon = "key-round";
    return self;
  }
  inherit(KeychainTab, host.SettingTab);
  KeychainTab.prototype.display = function () {
    const tab = this;
    const containerEl = this.containerEl;
    containerEl.empty();
    if (!this.app.secretStorage.isEncryptionAvailable()) {
      new host.Callout(containerEl)
        .setType("warning")
        .setIcon("lucide-alert-triangle")
        .setTitle(host.keychainI18n.labelEncryptionNotAvailable())
        .setContent(createFragment((fragment) => {
          fragment.createEl("p", { text: host.t.setting.keychain.msgEncryptionProvidedByOS() });
          fragment.createEl("a", { text: host.t.interface.buttonLearnMore() }, (link) => {
            link.addEventListener("click", () => new host.EncryptionInfoModal(tab.app).open());
          });
        }));
    }
    const group = new host.SettingGroup(containerEl)
      .setHeading(host.keychainI18n.secrets())
      .addExtraButton((button) => button
        .setIcon("lucide-plus")
        .setTooltip(host.keychainI18n.actionAddSecret())
        .onClick(() => new host.SecretEditModal(tab.app, null, () => tab.display()).open()));
    group.listEl.addClass("secrets-list");
    const secrets = this.app.secretStorage.listSecrets();
    let filter = "";
    const render = () => {
      group.listEl.empty();
      const shown = filter ? secrets.filter((id) => id.toLowerCase().includes(filter.toLowerCase())) : secrets;
      if (shown.length === 0) {
        group.addSetting((setting) => setting.setName(filter ? host.t.setting.thirdPartyPlugin.labelNoResultsFound() : host.keychainI18n.keychainEmptyState()));
      }
      for (const id of shown) {
        const lastAccess = tab.app.secretStorage.getLastAccess(id);
        group.addSetting((setting) => setting
          .setName(id)
          .setDesc(lastAccess !== null ? window.moment(lastAccess).fromNow(false) : host.keychainI18n.msgNeverAccessed())
          .addExtraButton((button) => button
            .setIcon("lucide-pen-line")
            .setTooltip(host.keychainI18n.actionEditSecret())
            .onClick(() => new host.SecretEditModal(tab.app, id, () => tab.display()).open()))
          .addExtraButton((button) => button
            .setIcon("lucide-trash-2")
            .setTooltip(host.t.dialogue.buttonDelete())
            .onClick(() => { if (tab.app.secretStorage.deleteSecret(id)) tab.display(); })));
      }
    };
    if (secrets.length > 0) {
      group.addSearch((search) => search
        .setPlaceholder(host.keychainI18n.placeholderSearchSecret())
        .onChange((value) => { filter = value; render(); }));
    }
    render();
  };
  return KeychainTab;
}

export function defineSecretStorageBase() {
  /** Shared base of the secret stores: migrates the pre-encryption "secrets" localStorage blob. */
  function SecretStorageBase(app) {
    this.app = app;
  }
  SecretStorageBase.prototype.migrate = function () {
    const legacy = this.app.loadLocalStorage(LEGACY_SECRETS_KEY);
    if (legacy) {
      this.app.saveLocalStorage(LEGACY_SECRETS_KEY, null);
      return legacy;
    }
    return null;
  };
  return SecretStorageBase;
}

export function defineDesktopSecretStore(host) {
  /** Desktop backend: the secrets map is JSON-encrypted with Electron safeStorage and kept in localStorage. */
  function DesktopSecretStore(app) {
    const self = host.SecretStorageBase.call(this, app) || this;
    self.safeStorage = window.electron.remote.safeStorage;
    return self;
  }
  inherit(DesktopSecretStore, host.SecretStorageBase);
  const proto = DesktopSecretStore.prototype;
  proto.isEncryptionAvailable = function () { return this.safeStorage.isEncryptionAvailable(); };
  proto.getSelectedStorageBackend = function () { return this.safeStorage.getSelectedStorageBackend(); };
  proto.encrypt = function (text) {
    return this.isEncryptionAvailable() ? this.safeStorage.encryptString(text).toString("base64") : text;
  };
  proto.decrypt = function (text) {
    if (!this.isEncryptionAvailable()) return text;
    return this.safeStorage.decryptString(Buffer.from(text, "base64"));
  };
  proto.load = async function () {
    const migrated = this.migrate();
    const secrets = migrated != null ? migrated : {};
    const raw = this.app.loadLocalStorage(ENCRYPTED_SECRETS_KEY);
    if (raw && typeof raw === "string") {
      try {
        Object.assign(secrets, JSON.parse(this.decrypt(raw)));
      } catch (error) {
        console.error("Failed to decrypt secrets:", error);
      }
    }
    if (migrated) await this.save(secrets);
    else if (raw && Object.keys(secrets).length === 0) await this.save(secrets);
    return secrets;
  };
  proto.save = async function (secrets) {
    if (Object.keys(secrets).length === 0) this.app.saveLocalStorage(ENCRYPTED_SECRETS_KEY, null);
    else this.app.saveLocalStorage(ENCRYPTED_SECRETS_KEY, this.encrypt(JSON.stringify(secrets)));
  };
  return DesktopSecretStore;
}

export function defineMobileSecretStore(host) {
  /** Mobile backend: the secrets map is plaintext JSON in Capacitor preferences (the OS keychain does the protection). */
  function MobileSecretStore(app) {
    return host.SecretStorageBase.call(this, app) || this;
  }
  inherit(MobileSecretStore, host.SecretStorageBase);
  const proto = MobileSecretStore.prototype;
  proto.load = async function () {
    const migrated = this.migrate();
    const secrets = migrated != null ? migrated : {};
    const raw = await host.secureStoreNative.get(ENCRYPTED_SECRETS_KEY);
    if (raw !== null && typeof raw === "string") {
      try {
        Object.assign(secrets, JSON.parse(raw));
      } catch (error) {
        console.error("Failed to decrypt secrets:", error);
      }
    }
    if (migrated) await this.save(secrets);
    return secrets;
  };
  proto.save = async function (secrets) {
    if (Object.keys(secrets).length === 0) await host.secureStoreNative.remove(ENCRYPTED_SECRETS_KEY);
    else await host.secureStoreNative.set(ENCRYPTED_SECRETS_KEY, JSON.stringify(secrets));
  };
  return MobileSecretStore;
}

export function defineSecretStorage(host) {
  /** app.secretStorage: the in-memory secret map plus last-access metadata, persisted through the platform backend. */
  function SecretStorage(app) {
    const self = this;
    self.app = app;
    self.secrets = {};
    self.secretsMeta = {};
    self.saveMeta = debounceCall(() => { self.app.saveLocalStorage(SECRETS_META_KEY, self.secretsMeta); }, 5000);
    self.adapter = self.setupStorage();
  }
  const proto = SecretStorage.prototype;
  proto.load = async function () {
    this.secretsMeta = this.app.loadLocalStorage(SECRETS_META_KEY) || {};
    if (this.adapter) {
      try {
        this.secrets = await this.adapter.load();
      } catch (error) {
        console.error("Failed to load secrets:", error);
        this.secrets = {};
      }
    }
    if (!this.app.loadLocalStorage(WARNING_DISMISSED_KEY) && this.listSecrets().length > 0 && !this.isEncryptionAvailable()) {
      new host.Notice(host.t.setting.keychain.msgSecretsNotEncrypted(), 0)
        .addButton(host.t.interface.buttonLearnMore(), () => new host.EncryptionInfoModal(this.app).open())
        .addButton(host.t.setting.keychain.buttonDismissWarning(), () => { this.app.saveLocalStorage(WARNING_DISMISSED_KEY, "1"); });
    }
  };
  proto.isEncryptionAvailable = function () {
    return !(this.adapter instanceof host.DesktopSecretStore) || this.adapter.isEncryptionAvailable();
  };
  proto.setupStorage = function () {
    if (host.Platform.isDesktopApp) return new host.DesktopSecretStore(this.app);
    if (host.Platform.isMobileApp) return new host.MobileSecretStore(this.app);
    return null;
  };
  proto.recordAccess = function (id) {
    const now = Date.now();
    if (!Object.hasOwn(this.secretsMeta, id)) this.secretsMeta[id] = {};
    if (now - (this.getLastAccess(id) ?? 0) > 3e5) {
      this.secretsMeta[id].lastAccess = now;
      this.saveMeta();
    }
  };
  proto.getLastAccess = function (id) {
    if (!Object.hasOwn(this.secretsMeta, id)) return null;
    const lastAccess = this.secretsMeta[id].lastAccess;
    return lastAccess !== null && lastAccess !== undefined ? lastAccess : null;
  };
  proto.validateId = function (id) { return /^[a-z0-9-]+$/.test(id) && id.length <= 64; };
  proto.setSecret = function (id, value) {
    if (!this.adapter) throw new Error("Secure storage is not available.");
    if (!this.validateId(id)) throw new Error(host.t.setting.keychain.msgErrorSecretIdInvalid());
    this.secrets[id] = value;
    this.adapter.save(this.secrets);
  };
  proto.peekSecret = function (id) { return Object.hasOwn(this.secrets, id) ? this.secrets[id] : null; };
  proto.getSecret = function (id) { this.recordAccess(id); return this.peekSecret(id); };
  proto.listSecrets = function () { return Object.keys(this.secrets); };
  proto.deleteSecret = function (id) {
    if (!Object.hasOwn(this.secrets, id)) return false;
    delete this.secrets[id];
    if (this.adapter) this.adapter.save(this.secrets);
    return true;
  };
  return SecretStorage;
}
