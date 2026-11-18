// Daily-notes helpers: the folder-relative path suffix (m8) and the date-format
// validator used by the settings tab (g8). The format constant and locale alias are
// declarator replacements (d8/f8) defined alongside the other slice constants.
import { lastSegment } from "./path.js";
import { s33DailyNotesStrings, s33FileExplorerStrings } from "./s33-canvas-edge.js";

/** Path of `file` relative to the daily-notes folder prefix, or null when outside it. */
export function s33DailyNoteSuffix(folder, file) {
  const prefix = folder.getParentPrefix();
  return file.path.startsWith(prefix) ? file.path.slice(prefix.length) : null;
}

/**
 * Validates a moment format string for daily-note filenames. Returns "" when usable,
 * otherwise a localized error message (leading "/", invalid filename characters or an
 * unparseable format all reject the value).
 */
export function s33ValidateDateFormat(format, host) {
  if (!format) return "";
  const sample = window.moment().format(format);
  if (format.startsWith("/")) return s33DailyNotesStrings().msgInvalidDateFormat();
  if (host.invalidCharsPattern.test(lastSegment(sample))) {
    return s33FileExplorerStrings().msgInvalidCharacters() + host.invalidCharsList;
  }
  return window.moment(sample, format, true).isValid() ? "" : s33DailyNotesStrings().msgInvalidDateFormat();
}
