// Daily-notes slice helpers (s14): the small pieces of the daily-notes plugin that were still
// inherited — the default date format, the i18n alias and two helpers used by its settings tab
// and note lookup.
//
//   d8  default moment format ("YYYY-MM-DD")
//   f8  i18n object for the daily-notes plugin (alias of t.plugins.dailyNotes)
//   m8  path of `file` relative to `folder`'s prefix, or null when outside it
//   g8  validates a user-supplied moment format; returns an error message or ""
import { env } from "./env.js";
import { lastSegment } from "./path.js";

/** Default moment format for daily notes (was `d8`). */
export const S14_DEFAULT_DATE_FORMAT = "YYYY-MM-DD";

/**
 * Path of `file` relative to `folder`'s prefix, or null when the file is not inside the folder.
 * Used to derive the moment a daily note inside a folder tree refers to (was `m8`).
 */
export function s14DailyNoteRelPath(folder, file) {
  const prefix = folder.getParentPrefix();
  return file.path.startsWith(prefix) ? file.path.slice(prefix.length) : null;
}

/**
 * Checks a moment format string the way the settings tab does: returns "" when usable, otherwise
 * the localized error message to show under the input (was `g8`).
 */
export function s14ValidateDateFormat(format) {
  if (!format) return "";
  const t = env();
  const i18n = t.gm.plugins.dailyNotes;
  if (format.startsWith("/")) return i18n.msgInvalidDateFormat();
  const sample = window.moment().format(format);
  if (t.UT.test(lastSegment(sample))) return t.gm.plugins.fileExplorer.msgInvalidCharacters() + t.qT;
  return window.moment(sample, format, true).isValid() ? "" : i18n.msgInvalidDateFormat();
}
