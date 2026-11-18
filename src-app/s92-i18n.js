// i18n plumbing that used to live in the inherited bundle scope (slice s92).
//
// Owns: the "language" localStorage key and the en/ru UI language table, the detected
// current/stored language helpers, the i18next resource bundle flattening, the lazy
// translation proxy (gm/t), the locale display-name lookup (ym), and the small
// Electron helpers around spellcheck languages, clipboard and reveal-in-folder.
//
// Everything the rest of the app sees keeps the original contract: same storage key,
// same i18next calls, same proxy shape, same display strings.
import { env } from "./env.js";
import { toKebab } from "./text.js";

/** localStorage key holding the chosen UI language (was Xf = "language"). */
export const s92LanguageStorageKey = "language";

/** The fallback UI language (was $f = "en"). */
export const s92FallbackLanguage = "en";

/** Human-readable labels for the supported UI languages (was Zf). */
export const s92LanguageNames = { en: "English", ru: "Русский" };

/** Sorted list of supported language codes (was Jf = Object.keys(Zf).sort()). */
export const s92SupportedLanguages = Object.keys(s92LanguageNames).sort();

/** Locale-code -> moment-locale aliases; starts empty, other code may fill it (was em = {}). */
export const s92LocaleAliasMap = {};

/** RTL language codes consulted by applyLanguage (was tm = []). */
export const s92RtlLanguages = [];

/** i18next interpolation override used by option descriptions (was nm). */
export const s92InterpolationOverride = { interpolation: { prefix: "{{{{", suffix: "}}}}" } };

/** i18next namespace for the app strings (was im = "default"). */
export const s92ResourceNamespace = "default";

/** Resolved once the bundle finished its own deferred setup (was um = Promise.resolve()). */
export const s92InitReady = Promise.resolve();

function s92IsString(v) {
  return typeof v === "string" || v instanceof String;
}

/** The app's translation strings as a flat kebab-cased resource bundle (was om). */
let s92ResourceBundle = null;
export function s92I18nResourceBundle() {
  if (s92ResourceBundle) return s92ResourceBundle;
  const flatten = (node) => {
    const out = {};
    for (const key in node) {
      if (!node.hasOwnProperty(key)) continue;
      const flat = toKebab(key);
      const value = node[key];
      out[flat] = s92IsString(value) ? value : flatten(value);
    }
    return out;
  };
  s92ResourceBundle = flatten(window.BASALT_I18N || {});
  return s92ResourceBundle;
}

/** Flattens the Russian bundle, folding `_plural0/1/2` suffixes onto the kebab base key. */
function s92FlattenRuBundle(node) {
  const out = {};
  for (const key in node) {
    if (!node.hasOwnProperty(key)) continue;
    const plural = /^(.*)_plural([012])$/.exec(key);
    const flat = plural ? toKebab(plural[1]) + "_" + plural[2] : toKebab(key);
    const value = node[key];
    out[flat] = s92IsString(value) ? value : s92FlattenRuBundle(value);
  }
  return out;
}

/**
 * Registers the app string bundles with i18next: the default (English) bundle under
 * "en", plus the Russian bundle under "ru" when present, switching to it right away
 * when it is the detected UI language (was am).
 */
export function s92RegisterDefaultBundle() {
  i18next.addResourceBundle(s92FallbackLanguage, s92ResourceNamespace, s92I18nResourceBundle());
  if (window.BASALT_I18N_RU) {
    i18next.addResourceBundle("ru", s92ResourceNamespace, s92FlattenRuBundle(window.BASALT_I18N_RU));
    if (s92CurrentLanguage() === "ru") i18next.changeLanguage("ru");
  }
}

/** The UI language to use right now: stored choice or detected (was sm). */
export function s92CurrentLanguage() {
  const stored = localStorage.getItem(s92LanguageStorageKey);
  return stored && s92SupportedLanguages.includes(stored) ? stored : s92DetectLanguage();
}

/** Persists a UI language choice; a plain "en" on an English system is not stored (was lm). */
export function s92StoreLanguage(lang) {
  if (lang === s92FallbackLanguage && s92DetectLanguage() === s92FallbackLanguage) {
    localStorage.removeItem(s92LanguageStorageKey);
  } else {
    localStorage.setItem(s92LanguageStorageKey, lang);
  }
}

/** Picks a supported language from the OS locale (was cm). */
export function s92DetectLanguage() {
  const locale = navigator.language;
  if (s92SupportedLanguages.includes(locale)) return locale;
  const base = locale.split("-")[0];
  return s92SupportedLanguages.includes(base) ? base : s92FallbackLanguage;
}

// -- lazy translation proxy (was gm / the `t` host export) --------------------

function s92I18nNode(prefix, target) {
  const cache = {};
  return new Proxy(target, {
    get(node, key) {
      if (cache.hasOwnProperty(key)) return cache[key];
      const kebab = toKebab(key);
      return (cache[key] = s92I18nNode(prefix + kebab + ".", function (first, second) {
        return s92IsString(first)
          ? i18next.t(prefix + kebab + "." + first, second)
          : i18next.t(prefix + kebab, first);
      }));
    },
  });
}

/** The root of the lazy `t` proxy tree, e.g. `t.editor.printModal` (was gm). */
export function s92CreateI18nProxy() {
  return s92I18nNode("", i18next.t.bind(i18next));
}

// -- Electron helpers ---------------------------------------------------------

/** Restricts the spell checker to the given languages on non-Apple desktops (was Kf). */
export function s92ApplySpellcheckerLanguages(languages) {
  if (env().jl || !window.electron) return;
  const session = window.electron.remote.getCurrentWebContents().session;
  const available = session.availableSpellCheckerLanguages;
  if (!languages || languages.length === 0) {
    languages = [window.electron.remote.app.getLocale()];
  }
  const picked = languages.filter((lang) => available.contains(lang));
  session.setSpellCheckerLanguages(picked);
}

/** Opens the containing folder of a path in the OS file manager (was Yf). */
export function s92RevealInFolder(path) {
  if (window.electron) window.electron.remote.shell.showItemInFolder(path);
}

/** The clipboard object for the running Electron version (was Qf). */
export function s92ClipboardBridge() {
  return env().qf < 40 ? window.electron.clipboard : window.electron.remote.clipboard;
}
