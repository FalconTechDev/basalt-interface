// g03 clean-room: Basalt Sync mobile onboarding wizard screens.
// Independent reimplementation per specs/g03.md section 3.23.
// Screen classes resolve each other lazily through ng03ScreenRegistry at
// construction time, so factory definition order does not matter.
import { hostEnv } from "./env.js";
import { inherit } from "./inherit.js";
import { account, AccountError, acctListVaults, acctSignup, acctSignIn, acctSignOut, acctForgetPassword, acctResendConfirmation, acctSignupMobileSync, acctCreateVault, acctVaultRegions } from "./account.js";
import { deriveVaultKeyhash, randomSaltHex, SYNCABLE_FEATURE_TYPES, MEDIA_FEATURE_TYPES } from "./vault-crypto.js";

function ng03E() { return hostEnv(); }
function ng03Sm() { return ng03E().gm.interface.startScreen.mobile; }
function ng03ScrIi() { return ng03E().gm.interface; }

function ng03T(key, vars) {
  const table = ng03Sm();
  const fn = table && table[key];
  if (typeof fn === "function") return vars === undefined ? fn() : fn(vars);
  return key;
}
function ng03IiT(key, vars) {
  const table = ng03ScrIi();
  const fn = table && table[key];
  if (typeof fn === "function") return vars === undefined ? fn() : fn(vars);
  return key;
}
function ng03AcctT(key, vars) {
  const acct = ng03E().gm.account || {};
  const fn = acct[key];
  if (typeof fn === "function") return vars === undefined ? fn() : fn(vars);
  return key;
}
function ng03PubT(key, vars) {
  const pub = (ng03E().gm.plugins || {}).publish || {};
  const fn = pub[key];
  if (typeof fn === "function") return vars === undefined ? fn() : fn(vars);
  return key;
}

// Lazily-populated screen registry: key -> constructor.
const ng03ScreenRegistry = { base: null };
let ng03Host = null;
function ng03FieldCls() {
  if (!ng03ScreenRegistry.fieldCls) ng03ScreenRegistry.fieldCls = ng03DefineSyncField(ng03Host);
  return ng03ScreenRegistry.fieldCls;
}
function ng03RadioCls() {
  if (!ng03ScreenRegistry.radioCls) ng03ScreenRegistry.radioCls = ng03DefineSyncRadioGroup(ng03Host);
  return ng03ScreenRegistry.radioCls;
}
function ng03Go(controller, key, args) {
  const Cls = ng03ScreenRegistry[key];
  if (!Cls) throw new Error("Sync screen not defined: " + key);
  const screen = new Cls(controller, ...(args || []));
  return controller.goTo(screen);
}
function ng03New(key, controller, args) {
  const Cls = ng03ScreenRegistry[key];
  if (!Cls) throw new Error("Sync screen not defined: " + key);
  return new Cls(controller, ...(args || []));
}

function ng03Logo() {
  const img = createEl("img", { cls: "logo", attr: { src: "basalt-logo.png" } });
  img.style.width = "64px";
  img.style.height = "64px";
  return img;
}

function ng03Cta(text, onClick) {
  const btn = createEl("button", { cls: "mod-cta", text });
  btn.addEventListener("click", onClick);
  return btn;
}
function ng03Btn(text, onClick) {
  const btn = createEl("button", { text });
  btn.addEventListener("click", onClick);
  return btn;
}
function ng03Desc(parent, key, vars) {
  const text = ng03T(key, vars);
  if (text && text !== key) parent.createDiv("mobile-onboarding-description").setText(text);
}

// ---------------------------------------------------------------------------
// SyncField: label + help + one input-ish widget inside a form-field div.
// ---------------------------------------------------------------------------

export function ng03DefineSyncField(host) {
  function SyncField(form) {
    this.el = form.createDiv("form-field");
    this.labelEl = this.el.createEl("label");
    this.helpEl = null;
    this.inputEl = null;
    return this;
  }
  SyncField.prototype.setName = function (name) { this.labelEl.setText(name); return this; };
  SyncField.prototype.setHelp = function (help) {
    if (this.helpEl) this.helpEl.detach();
    if (help) this.helpEl = this.el.createDiv("form-field-help", { text: help });
    return this;
  };
  SyncField.prototype._bind = function (input) {
    this.inputEl = input;
    return this;
  };
  SyncField.prototype.addText = function (configure) {
    const input = this.el.createEl("input", { type: "text" });
    if (configure) configure({
      setValue(v) { input.value = v == null ? "" : v; },
      setPlaceholder(p) { input.placeholder = p; },
      onChange(cb) { input.addEventListener("input", () => cb(input.value)); },
    });
    return this._bind(input);
  };
  SyncField.prototype.addPassword = function (configure) {
    const input = this.el.createEl("input", { type: "password" });
    if (configure) configure({
      setValue(v) { input.value = v == null ? "" : v; },
      setPlaceholder(p) { input.placeholder = p; },
      onChange(cb) { input.addEventListener("input", () => cb(input.value)); },
    });
    return this._bind(input);
  };
  SyncField.prototype.addDropdown = function (configure) {
    const select = this.el.createEl("select", { cls: "dropdown" });
    if (configure) configure({
      addOption(value, label) { const o = select.createEl("option", { text: label }); o.value = value; },
      setValue(v) { select.value = v; },
      onChange(cb) { select.addEventListener("change", () => cb(select.value)); },
    });
    return this._bind(select);
  };
  SyncField.prototype.addToggle = function (configure) {
    const label = this.el.createEl("label", { cls: "checkbox-container" });
    const input = label.createEl("input", { type: "checkbox" });
    if (configure) configure({
      setValue(v) { input.checked = !!v; label.toggleClass("is-enabled", !!v); },
      onChange(cb) { input.addEventListener("change", () => { label.toggleClass("is-enabled", input.checked); cb(input.checked); }); },
    });
    return this._bind(input);
  };
  SyncField.prototype.addButton = function (configure) {
    const btn = this.el.createEl("button");
    if (configure) configure({
      setButtonText(t) { btn.setText(t); },
      setCta() { btn.addClass("mod-cta"); },
      onClick(cb) { btn.addEventListener("click", cb); },
    });
    return this;
  };
  SyncField.prototype.getValue = function () { return this.inputEl ? this.inputEl.value : ""; };
  SyncField.prototype.setValue = function (v) { if (this.inputEl) this.inputEl.value = v == null ? "" : v; };
  return SyncField;
}

// SyncRadioGroup: selectable rows.
export function ng03DefineSyncRadioGroup(host) {
  function SyncRadioGroup(parent, onChange) {
    this.el = parent.createDiv("mobile-onboarding-radio-group");
    this.options = [];
    this.value = undefined;
    this.onChange = onChange || (() => {});
    return this;
  }
  SyncRadioGroup.prototype.addOption = function (configure) {
    const row = this.el.createDiv("mobile-onboarding-radio-option");
    row.tabIndex = 0;
    const btn = row.createDiv("mobile-onboarding-radio-button");
    const content = row.createDiv("mobile-onboarding-radio-content");
    const option = { row, btn, content, value: undefined, selected: false };
    const api = {
      setValue(v) { option.value = v; },
      setTitle(t) { content.setText(t); },
      setDescription(d) { content.createDiv("mobile-onboarding-radio-description u-muted").setText(d); },
      setFlair(f) { content.createDiv("mobile-onboarding-radio-flair").setText(f); },
    };
    if (configure) configure(api);
    const pick = () => this.setValue(option.value);
    row.addEventListener("click", pick);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
    });
    this.options.push(option);
    return api;
  };
  SyncRadioGroup.prototype.setValue = function (value) {
    for (const opt of this.options) {
      const sel = opt.value === value;
      opt.selected = sel;
      opt.row.toggleClass("is-selected", sel);
      opt.btn.toggleClass("is-selected", sel);
    }
    this.value = value;
    this.onChange(value);
  };
  SyncRadioGroup.prototype.getValue = function () { return this.value; };
  return SyncRadioGroup;
}

export function ng03DefineSyncRadioOption(host) {
  // Standalone option row (manifest parity); groups build their own rows.
  function SyncRadioOption(parent) {
    const row = parent.createDiv("mobile-onboarding-radio-option");
    row.tabIndex = 0;
    row.createDiv("mobile-onboarding-radio-button");
    const content = row.createDiv("mobile-onboarding-radio-content");
    row.classList.toggle("is-selected", false);
    return content;
  }
  return SyncRadioOption;
}

// ---------------------------------------------------------------------------
// SyncScreenBase (oC)
// ---------------------------------------------------------------------------

export function ng03DefineSyncScreenBase(host) {
  ng03Host = host;
  ng03RegisterScreenHelpers(host);
  function SyncScreenBase(controller) {
    this.controller = controller;
    this.requiresAuth = false;
    this.contentEl = createDiv("mobile-onboarding-screen");
    this.titleEl = this.contentEl.createEl("h1", { text: this.getTitle() });
    this.formEl = this.contentEl.createEl("form", { attr: { id: "form" } });
    this.formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      const cta = this.formEl.querySelector("button.mod-cta");
      if (cta) cta.click();
    });
    this.footerEl = this.contentEl.createDiv("footer");
    const version = this.footerEl.createDiv("mod-version");
    const v = hostEnv().gte;
    version.setText(typeof v === "string" ? v : (v && (v.version || v)) || "");
    return this;
  }
  SyncScreenBase.prototype.getTitle = function () { return ""; };
  SyncScreenBase.prototype.onClose = function () {};
  ng03ScreenRegistry.base = SyncScreenBase;
  return SyncScreenBase;
}

// Screen factory helper: returns (host) => class.
function ng03ScreenFactory(def) {
  return function (host) {
    ng03Host = host;
    function Screen(controller) {
      const args = Array.prototype.slice.call(arguments, 1);
      const Base = ng03ScreenRegistry.base;
      if (!Base) throw new Error("SyncScreenBase is not defined");
      const self = Base.call(this, controller) || this;
      self.requiresAuth = !!def.requiresAuth;
      self._args = args;
      if (def.render) def.render.call(self, self.formEl, self, ...args);
      return self;
    }
    inherit(Screen, ng03ScreenRegistry.base || function () {});
    Screen.prototype.getTitle = function () {
      if (def.titleKey) return ng03T(def.titleKey, def.titleVars);
      return def.title || "";
    };
    if (def.onClose) Screen.prototype.onClose = def.onClose;
    ng03ScreenRegistry[def.key] = Screen;
    return Screen;
  };
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export const ng03DefineSyncStartScreen = ng03ScreenFactory({
  key: "start",
  titleKey: "labelStartScreen",
  render(form, self) {
    self.contentEl.insertBefore(ng03Logo(), form);
    ng03Desc(self.contentEl, "labelStartScreenDescription");
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03IiT("create"), () => ng03Go(self.controller, "intro")));
    bar.appendChild(ng03Btn(ng03T("useExistingVault"), () => ng03Go(self.controller, "connectMethod")));
    // footer language picker
    const langs = hostEnv().Jf || [];
    const names = hostEnv().Zf || {};
    const current = hostEnv().sm ? hostEnv().sm() : "";
    const sel = self.footerEl.createEl("select", { cls: "dropdown" });
    for (const code of langs) {
      const o = sel.createEl("option", { text: names[code] || code });
      o.value = code;
      if (code === current) o.selected = true;
    }
    sel.addEventListener("change", () => {
      if (hostEnv().lm) hostEnv().lm(sel.value);
      window.location.reload();
    });
  },
});

export const ng03DefineSyncIntroScreen = ng03ScreenFactory({
  key: "intro",
  titleKey: "labelSyncIntro",
  render(form, self) {
    self.contentEl.insertBefore(ng03Logo(), form);
    ng03Desc(self.contentEl, "labelSyncIntroDescription");
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03T("skip"), () => ng03Go(self.controller, "createVault", ["none"])));
    bar.appendChild(ng03Btn(ng03T("setUpSync"), () => ng03Go(self.controller, "syncMethod")));
  },
});

export const ng03DefineCreateVaultScreen = ng03ScreenFactory({
  key: "createVault",
  titleKey: "labelVaultCreate",
  render(form, self, mode, existing) {
    self.mode = mode;
    self.existing = existing;
    self.requiresAuth = mode === "basalt-sync";
    const Field = ng03FieldCls();
    const nameField = new Field(form).setName(ng03T("vaultName")).addText({});
    nameField.inputEl.placeholder = ng03T("vaultNamePlaceholder");
    const storage = hostEnv().Sm;
    let locationRadio = null;
    let deviceStorage = true;
    if (storage) {
      const RadioGroup = ng03RadioCls();
      locationRadio = new RadioGroup(form, (v) => { deviceStorage = v === "device"; });
      const granted = hostEnv().kD;
      locationRadio.addOption((o) => {
        o.setValue("device");
        o.setTitle(ng03T("deviceStorage"));
        o.setFlair(ng03T("recommended"));
        if (!granted) o.setDescription(ng03T("storagePermissionWarning"));
      });
      locationRadio.addOption((o) => {
        o.setValue("app");
        o.setTitle(ng03T("appStorage"));
      });
      locationRadio.setValue("device");
    }
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03IiT("create"), async () => {
      const name = nameField.getValue().trim();
      if (!name) { new ng03Host.Notice(ng03T("msgNameRequired")); return; }
      if (mode === "basalt-sync") {
        ng03Go(self.controller, existing ? "syncSettings" : "syncSetup", existing ? [name, null, existing] : [name, null]);
        return;
      }
      if (mode === "none") {
        self.controller.createVault(name, null, false);
        return;
      }
      // external storage / icloud paths
      let path = null;
      let isICloud = mode === "icloud";
      if (storage && !isICloud) {
        if (deviceStorage) {
          // ensure permission then pick a directory
          const perm = ng03ScreenRegistry.storagePermCls;
          if (!hostEnv().kD) {
            await ng03Go(self.controller, "storagePermission", [() => {}]);
          }
          try {
            const picker = hostEnv().Dm;
            const chosen = picker && picker.choose ? await picker.choose() : null;
            if (!chosen || chosen.canceled || chosen.error === "canceled") return;
            path = chosen.path || chosen;
            const isDir = self.controller.isDirectory ? await self.controller.isDirectory(path) : true;
            if (!isDir) { new ng03Host.Notice(ng03T("msgInvalidVault")); return; }
          } catch (e) { return; }
        }
      }
      self.controller.createVault(name, path, isICloud);
    }));
  },
});

export const ng03DefineSyncSetupScreen = ng03ScreenFactory({
  key: "syncSetup",
  titleKey: "labelSyncSetup",
  requiresAuth: true,
  render(form, self, name, path) {
    self.args = [name, path];
    const Field = ng03FieldCls();
    const nameField = new Field(form).setName(ng03T("vaultName")).addText({});
    nameField.inputEl.value = name || "";
    nameField.inputEl.readOnly = true;
    let region = "";
    const regionField = new Field(form).setName(ng03T("region"));
    const select = regionField.el.createEl("select", { cls: "dropdown" });
    const auto = select.createEl("option", { text: ng03T("regionAutomatic") });
    auto.value = "";
    acctVaultRegions(account.token, "").then((regions) => {
      for (const r of regions || []) {
        const o = select.createEl("option", { text: r.name || r });
        o.value = r.name || r;
      }
    }).catch(() => {});
    select.addEventListener("change", () => { region = select.value; });
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03IiT("continue"), () => {
      const v = nameField.getValue().trim();
      if (!v) { new ng03Host.Notice(ng03T("msgVaultNameCannotBeEmpty") || ng03AcctT("msgVaultNameCannotBeEmpty")); return; }
      ng03Go(self.controller, "encryption", [v, path, region]);
    }));
  },
});

export const ng03DefineEncryptionScreen = ng03ScreenFactory({
  key: "encryption",
  titleKey: "labelRemoteVaultCreate",
  requiresAuth: true,
  render(form, self, name, path, region) {
    const RadioGroup = ng03RadioCls();
    let custom = true;
    let password = "";
    const radio = new RadioGroup(form, (v) => {
      custom = v === "custom";
      passwordField.el.toggle(custom);
    });
    radio.addOption((o) => { o.setValue("custom"); o.setTitle(ng03T("encryptionCustom")); o.setFlair(ng03T("recommended")); });
    radio.addOption((o) => { o.setValue("managed"); o.setTitle(ng03T("encryptionManaged")); });
    radio.setValue("custom");
    const Field = ng03FieldCls();
    const passwordField = new Field(form).setName(ng03T("password")).addPassword({
      onChange: (v) => { password = v; },
    });
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03IiT("create"), async () => {
      const v = (name || "").trim();
      if (!v) { new ng03Host.Notice(ng03T("msgVaultNameCannotBeEmpty") || ng03AcctT("msgVaultNameCannotBeEmpty")); return; }
      if (custom && !password) { new ng03Host.Notice(ng03T("msgPleaseEnterPassword") || ng03AcctT("msgPleaseEnterPassword")); return; }
      try {
        let keyhash = "", salt = "";
        if (custom) {
          salt = randomSaltHex();
          keyhash = await deriveVaultKeyhash(password, salt, 3);
        }
        const vault = await acctCreateVault(account.token, v, keyhash, salt, region || "", 3);
        if (custom) vault.password = password;
        ng03Go(self.controller, "syncSettings", [v, path, vault]);
      } catch (e) {
        new ng03Host.Notice(e && e.error ? e.error : (e && e.message || String(e)));
      }
    }));
  },
});

export const ng03DefineSyncSettingsScreen = ng03ScreenFactory({
  key: "syncSettings",
  titleKey: "labelSyncSettings",
  requiresAuth: true,
  render(form, self, name, path, vault) {
    self.vault = vault;
    // feature tables
    const table = form.createDiv("feature-table");
    const head = table.createDiv("feature-row feature-header");
    head.createDiv("feature-cell").setText(ng03T("feature"));
    head.createDiv("feature-cell").setText(ng03T("synced"));
    for (const type of SYNCABLE_FEATURE_TYPES) {
      const row = table.createDiv("feature-row");
      row.createDiv("feature-cell").setText(ng03T("feature-" + type) || type);
      row.createDiv("feature-cell").setText("✓");
    }
    const row2 = table.createDiv("feature-row");
    row2.createDiv("feature-cell").setText(ng03T("excludedFolders") || "Excluded folders");
    row2.createDiv("feature-cell").setText(ng03T("none") || "None");
    for (const type of MEDIA_FEATURE_TYPES) {
      const row = table.createDiv("feature-row");
      row.createDiv("feature-cell").setText(ng03T("feature-" + type) || type);
      row.createDiv("feature-cell").setText("✓");
    }
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03IiT("start"), () => {
      self.controller.createVault(name, path, false, vault);
    }));
  },
});

export const ng03DefineAuthChoiceScreen = ng03ScreenFactory({
  key: "authChoice",
  titleKey: "labelSignInOrSignUp",
  render(form, self) {
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03T("signUp"), () => ng03Go(self.controller, "emailEntry")));
    bar.appendChild(ng03Btn(ng03T("signIn"), () => ng03Go(self.controller, "signIn")));
  },
});

export const ng03DefineRemoteVaultOptionsScreen = ng03ScreenFactory({
  key: "remoteVaultOptions",
  titleKey: "labelRemoteVaultOptions",
  requiresAuth: true,
  render(form, self, vaultsRes) {
    self.vaultsRes = vaultsRes;
    ng03Desc(form, "labelRemoteVaultOptionsDescription");
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03T("create"), () => ng03Go(self.controller, "createVault", ["basalt-sync"])));
    bar.appendChild(ng03Btn(ng03T("choose"), () => ng03Go(self.controller, "vaultList", [vaultsRes])));
    self.footerEl.createDiv("button-container").appendChild(
      ng03Btn(ng03IiT("logOut"), async () => {
        try { await acctSignOut(account); } catch (e) { /* ignore */ }
        self.controller.backToLogin();
      }));
  },
});

export const ng03DefineVaultListScreen = ng03ScreenFactory({
  key: "vaultList",
  titleKey: "labelRemoteVaultSelection",
  requiresAuth: true,
  render(form, self, res) {
    const data = res && res.vaults ? res : { vaults: [], shared: [], limit: 0 };
    const own = data.vaults || [];
    const shared = data.shared || [];
    ng03Desc(form, "labelRemoteVaultSelectionDescription", { email: account.email });
    const list = form.createDiv("modal-list");
    const renderRow = (vault) => {
      const row = list.createDiv("list-item tappable");
      row.createDiv("list-item-part title").setText(vault.name || vault.uid);
      const desc = [];
      if (vault.region) desc.push(vault.region);
      if (vault.size != null) desc.push(vault.size);
      if (vault.created) desc.push(new Date(vault.created).toLocaleString());
      row.createDiv("list-item-part description u-muted").setText(desc.join(" · "));
      row.addEventListener("click", () => ng03Go(self.controller, "createVault", ["basalt-sync", vault]));
      return row;
    };
    for (const v of own) list.appendChild(renderRow(v));
    if (shared.length) {
      list.createDiv("list-item-heading").setText(ng03T("labelVaultsSharedWithYou"));
      for (const v of shared) list.appendChild(renderRow(v));
    }
    form.createDiv("button-container").appendChild(
      ng03Cta(ng03T("create"), () => ng03Go(self.controller, "createVault", ["basalt-sync"])));
  },
});

// ---- auth screens ------------------------------------------------------------

function ng03EmailField(self, form, initial) {
  const Field = ng03FieldCls();
  const field = new Field(form).setName(ng03T("email")).addText({});
  field.inputEl.value = initial || "";
  field.inputEl.type = "email";
  return field;
}

export const ng03DefineSignInScreen = ng03ScreenFactory({
  key: "signIn",
  titleKey: "labelSignIn",
  render(form, self, email) {
    const emailField = ng03EmailField(self, form, email);
    const Field = ng03FieldCls();
    let password = "";
    const passField = new Field(form).setName(ng03T("password")).addPassword({ onChange: (v) => { password = v; } });
    const mfaField = new Field(form).setName(ng03T("mfaCode")).addText({});
    mfaField.el.hide();
    mfaField.inputEl.setAttribute("inputmode", "numeric");
    mfaField.inputEl.maxLength = 6;
    mfaField.inputEl.autocomplete = "one-time-code";
    const errorEl = form.createDiv("message mod-error");
    errorEl.hide();
    const showError = (msg) => { errorEl.setText(msg); errorEl.show(); };
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03IiT("signIn"), async () => {
      const em = emailField.getValue().trim();
      const pw = passField.getValue();
      const mfa = mfaField.getValue().trim();
      if (!em || !em.includes("@")) return showError(ng03AcctT("messageInvalidEmail") || ng03AcctT("errorEmailInvalid"));
      if (!pw) return showError(ng03AcctT("messagePasswordRequired") || ng03AcctT("errorPasswordRequired"));
      if (mfa && !/^\d{6}$/.test(mfa)) return showError(ng03AcctT("mfaMustBe6Digits") || "MFA must be 6 digits");
      try {
        await acctSignIn(account, em, pw, mfa || undefined);
        const res = await acctListVaults(account.token);
        emailField.setValue(""); passField.setValue(""); mfaField.setValue("");
        mfaField.el.hide();
        if (res.limit === 0) {
          await acctSignupMobileSync(account.token);
          ng03Go(self.controller, "emailVerification", [account.email]);
        } else if ((res.vaults && res.vaults.length) || (res.shared && res.shared.length)) {
          ng03Go(self.controller, "remoteVaultOptions", [res]);
        } else {
          ng03Go(self.controller, "createVault", ["basalt-sync"]);
        }
      } catch (e) {
        if (e instanceof AccountError) {
          const msg = e.error || "";
          if (msg.indexOf("2FA code is incorrect") >= 0) showError(ng03AcctT("mfaVerificationFailed"));
          else if (msg.indexOf("2FA code") >= 0) {
            mfaField.el.show();
            emailField.el.hide();
            passField.el.hide();
          } else showError(msg || ng03AcctT("errGeneric"));
        } else {
          showError(ng03AcctT("messageLoginFailed") || (e && e.message) || String(e));
        }
      }
    }));
    self.footerEl.createDiv("button-container").appendChild(
      ng03Btn(ng03T("forgotPassword"), () => ng03Go(self.controller, "forgotPassword", [emailField.getValue()])));
  },
});

export const ng03DefineForgotPasswordScreen = ng03ScreenFactory({
  key: "forgotPassword",
  titleKey: "labelForgotPassword",
  render(form, self, email) {
    const emailField = ng03EmailField(self, form, email);
    const errorEl = form.createDiv("message mod-error");
    errorEl.hide();
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03IiT("send"), async () => {
      const em = emailField.getValue().trim();
      if (!em || !em.includes("@")) { errorEl.setText(ng03AcctT("messageInvalidEmail") || "Invalid email"); errorEl.show(); return; }
      try {
        await acctForgetPassword(em);
        new ng03Host.Notice(ng03AcctT("msgPasswordReset", { email: em }) || "Reset sent");
        self.controller.backToLogin();
      } catch (e) {
        if (e instanceof AccountError) { errorEl.setText(e.error || ""); errorEl.show(); }
        else self.controller.showError(e && e.message || String(e));
      }
    }));
  },
});

export const ng03DefineEmailEntryScreen = ng03ScreenFactory({
  key: "emailEntry",
  titleKey: "labelEmailEntry",
  render(form, self) {
    const emailField = ng03EmailField(self, form);
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03IiT("continue"), () => {
      const em = emailField.getValue().trim();
      if (!em) self.controller.showError(ng03AcctT("messageEmptyEmail") || "Email required");
      else ng03Go(self.controller, "signup", [em]);
    }));
  },
});

export const ng03DefineSignupScreen = ng03ScreenFactory({
  key: "signup",
  titleKey: "labelSignup",
  render(form, self, email) {
    const Field = ng03FieldCls();
    const emailField = ng03EmailField(self, form, email);
    let name = "", password = "";
    new Field(form).setName(ng03T("name")).addText({ onChange: (v) => { name = v; } });
    new Field(form).setName(ng03T("password")).addPassword({ onChange: (v) => { password = v; } });
    const errorEl = form.createDiv("message mod-error");
    errorEl.hide();
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03IiT("signUp"), async () => {
      const em = emailField.getValue().trim();
      if (!em) { errorEl.setText(ng03AcctT("messageEmptyEmail") || "Email required"); errorEl.show(); return; }
      try {
        await acctSignup(em, password, name, "buy_sync");
        ng03Go(self.controller, "emailVerification", [em]);
      } catch (e) {
        if (e instanceof AccountError) { errorEl.setText(e.error || ""); errorEl.show(); }
        else { errorEl.setText(ng03AcctT("messageSignupFailed") || (e && e.message) || String(e)); errorEl.show(); }
      }
    }));
  },
});

export const ng03DefineEmailVerificationScreen = ng03ScreenFactory({
  key: "emailVerification",
  titleKey: "emailVerification",
  render(form, self, email) {
    self.email = email;
    ng03Desc(form, "emailVerificationDescription", { email });
    const bar = form.createDiv("button-container");
    const resend = ng03Btn(ng03T("resendEmail"), async () => {
      resend.setAttribute("aria-disabled", "true");
      try {
        await acctResendConfirmation(email, "buy_sync");
        new ng03Host.Notice(ng03AcctT("msgNewEmailSuccess") || "Sent");
      } catch (e) {
        new ng03Host.Notice(ng03AcctT("msgNewEmailFailure") || (e && e.message) || String(e));
      } finally {
        resend.removeAttribute("aria-disabled");
      }
    });
    bar.appendChild(resend);
    bar.appendChild(ng03Btn(ng03IiT("logOut"), async () => {
      try { await acctSignOut(account); } catch (e) { /* ignore */ }
      self.controller.backToLogin();
    }));
  },
});

// ---- sync method / connect method --------------------------------------------

export const ng03DefineSyncMethodScreen = ng03ScreenFactory({
  key: "syncMethod",
  titleKey: "labelSyncMethodSelection",
  render(form, self) {
    const RadioGroup = ng03RadioCls();
    let choice = hostEnv().Yl && hostEnv().Yl.isIosApp ? "icloud" : "basalt-sync";
    const radio = new RadioGroup(form, (v) => {
      choice = v;
      cta.setText(v === "basalt-sync" ? ng03T("continueBasaltSync") : v === "icloud" ? ng03T("continueICloud") : ng03T("continueOther"));
    });
    radio.addOption((o) => { o.setValue("basalt-sync"); o.setTitle(ng03T("basaltSync")); o.setFlair(ng03T("recommended")); });
    if (hostEnv().Yl && hostEnv().Yl.isIosApp) {
      radio.addOption((o) => { o.setValue("icloud"); o.setTitle(ng03T("iCloud")); });
    }
    radio.addOption((o) => { o.setValue("other"); o.setTitle(ng03T("other")); });
    radio.setValue(choice);
    const bar = form.createDiv("button-container");
    const cta = ng03Cta(ng03T("continue"), async () => {
      if (choice === "basalt-sync") {
        if (account.token) {
          try {
            const res = await acctListVaults(account.token);
            if (res.limit !== 0) {
              if ((res.vaults && res.vaults.length) || (res.shared && res.shared.length)) {
                ng03Go(self.controller, "remoteVaultOptions", [res]);
              } else {
                ng03Go(self.controller, "createVault", ["basalt-sync"]);
              }
            } else {
              await acctSignupMobileSync(account.token);
              ng03Go(self.controller, "emailVerification", [account.email]);
            }
          } catch (e) {
            new ng03Host.Notice(ng03T("msgErrorFailedToFetch") || (e && e.message) || String(e));
          }
        } else {
          ng03Go(self.controller, "authChoice");
        }
      } else if (choice === "icloud") {
        ng03Go(self.controller, "createVault", ["icloud"]);
      } else {
        ng03Go(self.controller, "otherSync");
      }
    });
    bar.appendChild(cta);
    if (hostEnv().Yl && hostEnv().Yl.isIosApp) {
      const extra = form.createDiv("button-container");
      extra.appendChild(ng03Btn(ng03T("learnAboutOtherSync"), () => ng03Go(self.controller, "otherSync")));
      extra.appendChild(ng03Btn(ng03T("skip"), () => ng03Go(self.controller, "createVault", ["none"])));
    }
  },
});

export const ng03DefineConnectMethodScreen = ng03ScreenFactory({
  key: "connectMethod",
  titleKey: "labelSyncRestore",
  render(form, self) {
    const RadioGroup = ng03RadioCls();
    const storage = !!hostEnv().Sm;
    const ios = hostEnv().Yl && hostEnv().Yl.isIosApp;
    let choice = "basalt-sync";
    const radio = new RadioGroup(form, (v) => {
      choice = v;
      cta.setText(v === "local" ? ng03T("continueLocal") : v === "basalt-sync" ? ng03T("continueBasaltSync") : v === "icloud" ? ng03T("continueICloud") : ng03T("continueOther"));
    });
    radio.addOption((o) => { o.setValue("basalt-sync"); o.setTitle(ng03T("basaltSync")); o.setFlair(ng03T("recommended")); });
    if (storage) radio.addOption((o) => { o.setValue("local"); o.setTitle(ng03T("localStorage")); });
    if (ios) radio.addOption((o) => { o.setValue("icloud"); o.setTitle(ng03T("iCloud")); });
    radio.addOption((o) => { o.setValue("other"); o.setTitle(ng03T("other")); });
    radio.setValue("basalt-sync");
    const bar = form.createDiv("button-container");
    const cta = ng03Cta(ng03T("continue"), async () => {
      if (choice === "local") {
        if (!hostEnv().kD) {
          await ng03Go(self.controller, "storagePermission", [() => {}]);
        }
        try {
          const picker = hostEnv().Dm;
          const chosen = picker && picker.choose ? await picker.choose() : null;
          if (!chosen || chosen.canceled || chosen.error === "canceled") return;
          const path = chosen.path || chosen;
          if (chosen.isRoot) { new ng03Host.Notice(ng03T("msgCannotUseRoot") || "Root not allowed"); return; }
          const isDir = self.controller.isDirectory ? await self.controller.isDirectory(path) : true;
          if (!isDir) { new ng03Host.Notice(ng03T("msgInvalidVault") || "Invalid vault"); return; }
          self.controller.openVault(path, true);
        } catch (e) { /* picker cancelled */ }
      } else if (choice === "basalt-sync") {
        if (account.token) {
          try {
            const res = await acctListVaults(account.token);
            if ((res.vaults && res.vaults.length) || (res.shared && res.shared.length)) {
              ng03Go(self.controller, "remoteVaultOptions", [res]);
            } else {
              ng03Go(self.controller, "createVault", ["basalt-sync"]);
            }
          } catch (e) {
            new ng03Host.Notice(ng03T("msgErrorFailedToFetch") || (e && e.message) || String(e));
          }
        } else {
          ng03Go(self.controller, "signIn");
        }
      } else if (choice === "icloud") {
        ng03Go(self.controller, ios ? "iCloudMissing" : "iCloudUnsupported");
      } else {
        ng03Go(self.controller, "otherSync");
      }
    });
    bar.appendChild(cta);
  },
});

export const ng03DefineOtherSyncScreen = ng03ScreenFactory({
  key: "otherSync",
  titleKey: "labelSyncOther",
  render(form, self) {
    ng03Desc(form, "labelSyncOtherDescription");
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03T("create"), () => ng03Go(self.controller, "createVault", ["none"])));
    const learn = ng03Btn(ng03T("learnMore"), () => {
      window.open("https://github.com/FalconTechDev/basalt", "_blank");
    });
    bar.appendChild(learn);
  },
});

// ---- iCloud / storage screens ------------------------------------------------

export const ng03DefineICloudMissingScreen = ng03ScreenFactory({
  key: "iCloudMissing",
  title: "iCloud",
  render(form, self) {
    const box = self.contentEl.createDiv("mobile-onboarding-description");
    box.createDiv().setText(ng03T("iCloudMissingReason1") || "");
    box.createDiv().setText(ng03T("iCloudMissingReason2") || "");
  },
});

export const ng03DefineICloudUnsupportedScreen = ng03ScreenFactory({
  key: "iCloudUnsupported",
  titleKey: "iCloudUnsupported",
  render(form, self) {
    ng03Desc(form, "iCloudUnsupportedDescription");
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Btn(ng03T("learnMore"), () => window.open("https://github.com/FalconTechDev/basalt", "_blank")));
  },
});

export const ng03DefineStoragePermissionScreen = ng03ScreenFactory({
  key: "storagePermission",
  titleKey: "allowFileAccess",
  render(form, self, callback) {
    self.callback = callback;
    ng03Desc(form, "storagePermissionDesc1");
    ng03Desc(form, "storagePermissionDesc2");
    ng03Desc(form, "storagePermissionDesc3");
    const bar = form.createDiv("button-container");
    bar.appendChild(ng03Cta(ng03T("allow"), async () => {
      try {
        const picker = hostEnv().Dm;
        if (picker && picker.requestPerms) await picker.requestPerms();
        if (hostEnv().CD) await hostEnv().CD();
      } catch (e) { /* ignore */ }
      self.controller.back();
    }));
    bar.appendChild(ng03Btn(ng03IiT("cancel"), () => self.controller.back()));
  },
  onClose() {
    if (this.callback) this.callback();
  },
});

// Register helper classes into the registry for screens that build widgets.
export function ng03RegisterScreenHelpers(host) {
  ng03Host = host;
  ng03ScreenRegistry.fieldCls = ng03DefineSyncField(host);
  ng03ScreenRegistry.radioCls = ng03DefineSyncRadioGroup(host);
  return { Field: ng03ScreenRegistry.fieldCls, RadioGroup: ng03ScreenRegistry.radioCls };
}
