// g01 clean-room: the CLI table value type, the command-suggestion scorer and the
// memoized community-catalogue fetchers.

export const ng01CommunityPluginsUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
export const ng01CommunityPluginStatsUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugin-stats.json";

/** Generic memoizer: success TTL + shorter error TTL + shared in-flight promise. */
function ng01Memoize(fetcher, ttlMs, errTtlMs) {
  if (errTtlMs === undefined) errTtlMs = ttlMs;
  let result = null;
  let until = 0;
  let pending = null;
  return function call() {
    if (pending) return pending;
    if (result !== null && until > Date.now()) return Promise.resolve(result);
    pending = (async () => {
      until = Date.now() + errTtlMs;
      try {
        result = await fetcher();
      } catch (e) {
        pending = null;
        until = 0;
        throw e;
      }
      until = Date.now() + ttlMs;
      pending = null;
      setTimeout(() => { if (until > Date.now()) result = null; }, ttlMs);
      return result;
    })();
    return pending;
  };
}

// The app HTTP helper (`request`) is a flat-scope function owned by community.js;
// rawFileUrl/pickCompatibleVersion come from the same module.
async function ng01Http(options) {
  if (typeof options === "string") options = { url: options };
  return request(options);
}

export const ng01CommunityPlugins = ng01Memoize(async () => {
  const list = await ng01Http(ng01CommunityPluginsUrl).then((r) => r.json);
  if (!Array.isArray(list)) throw new Error("Failed to parse community plugins.");
  return list;
}, 3e5, 6e4);

export const ng01CommunityPluginStats = ng01Memoize(async () => {
  const stats = await ng01Http(ng01CommunityPluginStatsUrl);
  return stats.json;
}, 3e5, 6e4);

// ---------------------------------------------------------------- table

function ng01CsvCell(cell, sep) {
  cell = String(cell);
  if (cell.indexOf('"') >= 0 || cell.indexOf("\n") >= 0 || cell.indexOf("\r") >= 0 || (sep && cell.indexOf(sep) >= 0)) {
    return '"' + cell.replace(/"/g, '""') + '"';
  }
  return cell;
}

/** The table value type: header + body rows with text/csv/tsv/markdown/clipboard renderers. */
export function ng01DefineTable() {
  return class Ng01Table {
    constructor(header, body) {
      this.header = header || [];
      this.body = body || [];
    }

    toCSV(includeHeader = true) { return this.toText(",", includeHeader); }
    toTSV(includeHeader = true) { return this.toText("\t", includeHeader); }

    toText(separator, includeHeader = true) {
      const rows = includeHeader ? [this.header].concat(this.body) : this.body;
      return rows.map((row) => row.map((cell) => ng01CsvCell(cell, separator)).join(separator)).join("\n");
    }

    toMarkdown(includeHeader = true) {
      const escape = (cell) => String(cell).replace(/\|/g, "\\|");
      const header = this.header.map(escape);
      const body = this.body.map((row) => row.map(escape));
      const cols = header.length;
      const widths = [];
      for (let c = 0; c < cols; c++) {
        let w = header[c].length;
        for (const row of body) if (row[c] !== undefined && row[c].length > w) w = row[c].length;
        widths.push(w + 2);
      }
      const renderRow = (row) => {
        let line = "|";
        for (let c = 0; c < cols; c++) {
          const cell = row[c] === undefined ? "" : row[c];
          const pad = widths[c] - cell.length;
          const left = Math.floor(pad / 2);
          line += " ".repeat(left) + cell + " ".repeat(pad - left) + " |";
        }
        return line;
      };
      const lines = [];
      if (includeHeader) {
        lines.push(renderRow(header));
        let sep = "|";
        for (let c = 0; c < cols; c++) sep += " " + "-".repeat(widths[c] - 2) + " |";
        lines.push(sep);
        for (const row of body) lines.push(renderRow(row));
      } else {
        for (const row of body) lines.push(renderRow(row));
      }
      return lines.join("\n");
    }

    toObsidianTableClipboard() {
      return JSON.stringify({ header: this.header, rows: this.body, alignment: new Array(this.header.length).fill(null) });
    }
  };
}

// ---------------------------------------------------------------- scorer

function ng01Levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}

/** Ranked "did you mean" suggestions: prefix=0, contains=1, else bounded Levenshtein. */
export function ng01CommandScore(query, candidates, limit = 3) {
  const q = String(query).toLowerCase();
  const scored = [];
  for (const candidate of candidates) {
    const name = String(candidate);
    const lower = name.toLowerCase();
    let score;
    if (lower.startsWith(q)) score = 0;
    else if (lower.indexOf(q) >= 0) score = 1;
    else {
      const d = ng01Levenshtein(q, lower);
      if (d > 3) continue;
      score = d;
    }
    scored.push({ name, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((x) => x.name);
}
