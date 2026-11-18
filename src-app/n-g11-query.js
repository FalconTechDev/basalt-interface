// g11 clean-room: the search query language. tokenizeQuery turns the raw query into
// tokens; buildMatcher recursive-descends them into a matcher tree (see n-g11-matchers.js
// for the matcher protocol); SearchQuery binds a parsed tree to the vault (app) and runs
// it against one file at a time. The operator table is data-driven (ng11DefineSearchOperators).

import { methods } from "./inherit.js";
import { lastSegment } from "./path.js";
import { ng11SearchClasses,ng11MergeMatchResults,ng11CachedRegExp,ng11EnsureMatchers,ng11ExtensionWithoutContent,ng11EscapeRegExpQuery,ng11ResetRegexCaches,ng11RegexMatchRanges,ng11WholeWordPattern,ng11DefineSearchTarget,ng11DefineSearchMatcherBase,ng11DefineWrappedMatcher,ng11DefineSplitContentMatcher,ng11DefineMultiMatcher,ng11DefineCaseMatcher,ng11DefinePathMatcher,ng11DefineFileMatcher,ng11DefineContentMatcher,ng11DefineNotMatcher,ng11DefineRegexMatcher,ng11DefineQuotedTextMatcher,ng11DefineTextMatcher,ng11DefineEmptyMatcher,ng11DefineCompareMatcher,ng11DefineBooleanMatcher,ng11DefinePropertyMatcher,ng11DefineLineMatcher,ng11DefineBlockMatcher,ng11DefineSectionMatcher,ng11DefineTaskMatcher,ng11DefineTagMatcher,ng11DefineAndGroup,ng11DefineOrGroup } from "./n-g11-matchers.js";

const NG11_WORD_STOP = new Set(["[", "]", "(", ")", ":", ">", "<"]);
const NG11_KEYWORDS = { TRUE: "true", FALSE: "false", EMPTY: "empty", OR: "or" };

/** Scans `query` into {type, content, pos, end} tokens. */
export function ng11TokenizeQuery(query) {
  const tokens = [];
  const n = query.length;
  let i = 0;
  const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
  const tokenStart = () => i === 0 || isSpace(query[i - 1]) || NG11_WORD_STOP.has(query[i - 1]);
  while (i < n) {
    const c = query[i];
    if (isSpace(c)) { i++; continue; }
    const pos = i;
    if (c === '"') {
      i++;
      let text = "";
      while (i < n && query[i] !== '"') {
        if (query[i] === "\\" && i + 1 < n) { text += query[i + 1]; i += 2; continue; }
        text += query[i]; i++;
      }
      if (i < n) i++; // closing quote
      tokens.push({ type: "quote", content: text, pos, end: i });
      continue;
    }
    if (c === "/" && tokenStart()) {
      i++;
      let pattern = "";
      while (i < n && query[i] !== "/") {
        if (query[i] === "\\" && i + 1 < n) {
          const nxt = query[i + 1];
          if (nxt === "/") { pattern += "/"; i += 2; continue; }
          pattern += query[i] + nxt; i += 2; continue;
        }
        pattern += query[i]; i++;
      }
      if (i < n) i++; // closing slash
      tokens.push({ type: "regex", content: pattern, pos, end: i });
      continue;
    }
    if (c === "-") {
      tokens.push({ type: "not", content: "-", pos, end: ++i });
      continue;
    }
    if (NG11_WORD_STOP.has(c)) {
      const type = c === "[" || c === "]" ? "bracket" : c === "(" || c === ")" ? "parenthesis"
        : c === ":" ? "colon" : c === ">" ? "greaterthan" : "lessthan";
      tokens.push({ type, content: c, pos, end: ++i });
      continue;
    }
    // bare word: until whitespace or a stop char ('/' may continue a word mid-token)
    let word = "";
    while (i < n && !isSpace(query[i]) && !NG11_WORD_STOP.has(query[i])) {
      word += query[i]; i++;
    }
    const kw = NG11_KEYWORDS[word];
    tokens.push({ type: kw || "text", content: word, pos, end: i });
  }
  return tokens;
}

/** Offset just past `token`. */
export function ng11TokenEnd(token) {
  if (typeof token.end === "number") return token.end;
  return token.pos + token.content.length + (token.type === "quote" || token.type === "regex" ? 2 : 0);
}

function ng11CheckToken(state, type) {
  const t = state.tokens[state.pos];
  return !!t && t.type === type;
}

function ng11Peek(state) {
  return state.tokens[state.pos] || null;
}

function ng11ParseError(token) {
  if (!token) return new Error("Failed to parse, error at end of query");
  return new Error(`Failed to parse, error at ${token.pos} "${token.content}"`);
}

/** Annotates a matcher with the token span it was built from (powers getContext). */
function ng11Annotate(matcher, state, startIdx) {
  if (!matcher) return matcher;
  matcher._span = [startIdx, state.pos];
  matcher._tokens = state.tokens;
  matcher.matchedTokens = state.tokens.slice(startIdx, state.pos);
  return matcher;
}

function ng11EmptyTextMatcher() {
  return new ng11SearchClasses.TextMatcher("");
}

/** Operator-name candidate: a `text` token immediately followed by a `colon` token. */
function ng11OperatorName(state) {
  if (state.bracketDepth > 0) return null;
  const t = ng11Peek(state);
  if (!t || t.type !== "text") return null;
  const next = state.tokens[state.pos + 1];
  if (!next || next.type !== "colon") return null;
  return t.content.toLowerCase();
}

function ng11ApplyOperator(name, inner, op) {
  const C = ng11SearchClasses;
  if (op.caseSensitive !== undefined) return new C.CaseMatcher(inner, op.caseSensitive);
  if (op.key === "filepath") return new C.PathMatcher(inner);
  if (op.key === "filename") return new C.FileMatcher(inner);
  if (op.key === "content") return new C.ContentMatcher(inner);
  if (op.wrap === "line") return new C.LineMatcher(inner);
  if (op.wrap === "block") return new C.BlockMatcher(inner);
  if (op.wrap === "section") return new C.SectionMatcher(inner);
  if (op.wrap === "task") return new C.TaskMatcher(inner, op.completed);
  if (op.tag) return new C.TagMatcher(inner);
  return inner;
}

/** Nearest enclosing exclusive operator that `opName` may not nest inside. */
function ng11ExclusiveConflict(state, op) {
  if (!op.exclusive) return null;
  for (let i = state.exclusive.length - 1; i >= 0; i--) {
    const open = state.exclusive[i];
    if (open.name !== op._name || !op.allowSelf) return open.name;
  }
  return null;
}

/**
 * parsePrimary: named operator `word:`, `[property]`, literals, `( group )`,
 * booleans, `-`, `>`, `<`. Returns matcher | null when no primary can start here.
 */
export function ng11ParsePrimary(state) {
  const C = ng11SearchClasses;
  const startIdx = state.pos;
  const token = ng11Peek(state);
  if (!token) return null;

  // named operator: `name:` (not inside brackets)
  const opName = ng11OperatorName(state);
  if (opName) {
    const op = state.operators[opName];
    if (!op) throw new Error(`Operator "${opName}" not recognized`);
    const conflict = ng11ExclusiveConflict(state, Object.assign({ _name: opName }, op));
    if (conflict) {
      throw new Error(`Operator "${opName}" cannot be nested within "${conflict}"`);
    }
    state.pos += 2; // word + colon
    if (op.exclusive) state.exclusive.push({ name: opName });
    let inner = null;
    try {
      inner = ng11ParsePrimary(state);
    } finally {
      if (op.exclusive) state.exclusive.pop();
    }
    if (!inner) inner = ng11EmptyTextMatcher();
    return ng11Annotate(ng11ApplyOperator(opName, inner, op), state, startIdx);
  }

  switch (token.type) {
    case "bracket": {
      if (token.content !== "[") return null; // ']' cannot start a primary
      if (state.bracketDepth > 0) throw new Error("Property cannot be nested within a property.");
      state.pos++;
      state.bracketDepth++;
      let key = null, value = null;
      try {
        key = ng11ParseOrExpression(state);
        if (ng11CheckToken(state, "colon")) {
          state.pos++;
          value = ng11ParseOrExpression(state);
        }
      } finally {
        state.bracketDepth--;
      }
      if (ng11CheckToken(state, "bracket") && ng11Peek(state).content === "]") state.pos++;
      if (!key) key = ng11EmptyTextMatcher();
      return ng11Annotate(new C.PropertyMatcher(key, value), state, startIdx);
    }
    case "text":
      state.pos++;
      return ng11Annotate(new C.TextMatcher(token.content), state, startIdx);
    case "quote":
      state.pos++;
      return ng11Annotate(new C.QuotedTextMatcher(token.content), state, startIdx);
    case "regex": {
      try { new RegExp(token.content); }
      catch (e) {
        console.log(e);
        throw new Error("Failed to parse regular expression. " + (e && e.message ? e.message : e));
      }
      state.pos++;
      return ng11Annotate(new C.RegexMatcher(token.content), state, startIdx);
    }
    case "parenthesis": {
      if (token.content !== "(") return null;
      state.pos++;
      const inner = ng11ParseOrExpression(state);
      if (ng11CheckToken(state, "parenthesis") && ng11Peek(state).content === ")") state.pos++;
      return ng11Annotate(inner || new C.EmptyMatcher(), state, startIdx);
    }
    case "true": case "false": case "empty": {
      state.pos++;
      const expected = token.type === "empty" ? "empty" : token.type === "true";
      return ng11Annotate(new C.BooleanMatcher(expected), state, startIdx);
    }
    case "not": {
      state.pos++;
      const inner = ng11ParsePrimary(state);
      return ng11Annotate(new C.NotMatcher(inner || ng11EmptyTextMatcher()), state, startIdx);
    }
    case "greaterthan": case "lessthan": {
      const type = token.content;
      state.pos++;
      const inner = ng11ParsePrimary(state);
      if (!inner) return null;
      if (!(inner instanceof C.TextMatcher) && !(inner instanceof C.QuotedTextMatcher)) {
        throw new Error(`"${type}" operator cannot be applied to matcher ${inner.getInfo()}`);
      }
      return ng11Annotate(new C.CompareMatcher(type, inner.text), state, startIdx);
    }
    default:
      throw ng11ParseError(token);
  }
}

/** Implicit AND: a run of primaries. */
export function ng11ParseAndSequence(state) {
  const C = ng11SearchClasses;
  const startIdx = state.pos;
  const matchers = [];
  for (;;) {
    const t = ng11Peek(state);
    if (!t || t.type === "or" || t.type === "colon") break;
    if (t.type === "parenthesis" && t.content === ")") break;
    if (t.type === "bracket" && t.content === "]") break;
    const m = ng11ParsePrimary(state);
    if (!m) break;
    matchers.push(m);
  }
  if (!matchers.length) return null;
  const result = matchers.length === 1 ? matchers[0] : new C.AndGroup(matchers);
  return ng11Annotate(result, state, startIdx);
}

/** `OR` groups: the loosest precedence level. */
export function ng11ParseOrExpression(state) {
  const C = ng11SearchClasses;
  const startIdx = state.pos;
  const branches = [];
  for (;;) {
    const seq = ng11ParseAndSequence(state);
    branches.push(seq || new C.EmptyMatcher());
    if (!ng11CheckToken(state, "or")) break;
    state.pos++;
  }
  if (branches.length === 1) return branches[0];
  return ng11Annotate(new C.OrGroup(branches), state, startIdx);
}

/** tokens + operator table -> root matcher | null (empty query). */
export function ng11BuildMatcher(tokens, operators) {
  if (!tokens || !tokens.length) return null;
  ng11EnsureMatchers(ng11QueryHost);
  const C = ng11SearchClasses;
  const state = { tokens, pos: 0, operators, bracketDepth: 0, exclusive: [] };
  const matcher = ng11ParseOrExpression(state);
  if (state.pos < tokens.length) throw ng11ParseError(tokens[state.pos]);
  return matcher;
}

// ---- operator table ------------------------------------------------------------------------------

/** The named-operator table consumed by the parser (manifest declarator RH). */
export function ng11DefineSearchOperators(host) {
  return {
    "match-case": { caseSensitive: true },
    "ignore-case": { caseSensitive: false },
    path: { key: "filepath", exclusive: true },
    file: { key: "filename", exclusive: true },
    content: { key: "content", exclusive: true },
    line: { wrap: "line", exclusive: true },
    block: { wrap: "block", exclusive: true },
    section: { wrap: "section", exclusive: true, allowSelf: true },
    task: { wrap: "task", exclusive: true },
    "task-todo": { wrap: "task", exclusive: true, completed: false },
    "task-done": { wrap: "task", exclusive: true, completed: true },
    tag: { tag: true, exclusive: true },
  };
}

// ---- SearchQuery ---------------------------------------------------------------------------------

let ng11QueryHost = null;

/** Parsed query bound to the app: .matcher root, .requiredInputs, match*(file,...). */
function SearchQuery(app, query, caseSensitive, ops) {
  const C = ng11SearchClasses;
  ng11EnsureMatchers(ng11QueryHost);
  this.app = app;
  this.query = query;
  this.caseSensitive = !!caseSensitive;
  const host = ng11QueryHost;
  const operators = ops || (host && host.SearchOperators) || ng11DefineSearchOperators(host);
  const tokens = ng11TokenizeQuery(String.isString(query) ? query : "");
  this.matcher = ng11BuildMatcher(tokens, operators);
  this.requiredInputs = this.matcher ? this.matcher.requiredInputs() : {};
}
methods(SearchQuery, {
  _target(strings, keys) {
    const C = ng11SearchClasses;
    return new C.SearchTarget(strings, strings.slice(), keys, this.caseSensitive);
  },
  /** Runs the root matcher; undefined -> {}, ranges span-merged per key. */
  _match(target) {
    if (!this.matcher) return null;
    ng11CachedRegExp("", true); // schedules the regex-cache reset
    let result = this.matcher.match(target);
    if (result === undefined) result = {};
    if (result === null) return null;
    for (const key of Object.keys(result)) {
      if (key === "properties") continue;
      result[key] = ng11MergeRanges(result[key]);
    }
    return result;
  },
  match(file, content) {
    const app = this.app;
    const ext = file.extension || "";
    if (ext === "canvas") {
      const plugin = app.internalPlugins && app.internalPlugins.getEnabledPluginById("canvas");
      if (plugin) {
        let json = null;
        try { json = JSON.parse(content); } catch (e) { json = null; }
        if (json && Array.isArray(json.nodes)) {
          const index = plugin.index && plugin.index.get(file);
          const caches = (index && index.caches) || {};
          const out = {};
          let any = false;
          for (const node of json.nodes) {
            if (node.type !== "text" || typeof node.text !== "string") continue;
            const target = this._target([node.text], ["content"]);
            target.cache = caches[node.id] || null;
            const r = this.matcher ? this.matcher.match(target) : null;
            if (r && r.content && r.content.length) {
              out["canvas-" + node.id] = ng11MergeRanges(r.content);
              any = true;
            }
          }
          // the file row itself: filename hits are kept, content is empty
          const selfTarget = this._target(["", file.name, file.path], ["content", "filename", "filepath"]);
          const selfResult = this.matcher ? this.matcher.match(selfTarget) : null;
          if (selfResult && selfResult.filename && selfResult.filename.length) {
            out.filename = selfResult.filename;
            any = true;
          }
          return any ? out : null;
        }
      }
    }
    const host = ng11QueryHost;
    const keys = ["filename", "filepath"];
    if (ext === "md" || !ng11ExtensionWithoutContent(ext, host)) keys.push("content");
    const strings = keys.map((k) => (k === "content" ? content || "" : k === "filename" ? file.name : file.path));
    const target = this._target(strings, keys);
    if (ext === "md" && app.metadataCache) target.cache = app.metadataCache.getFileCache(file);
    return this._match(target);
  },
  matchContent(content) {
    return this._match(this._target([content], ["content"]));
  },
  matchTag(tag) {
    return this._match(this._target([tag], ["tag"]));
  },
  matchFilepath(path) {
    return this._match(this._target([lastSegment(path)], ["filename"]));
  },
});

/** Sorts [s,e) ranges and merges overlapping/adjacent spans. */
function ng11MergeRanges(ranges) {
  if (!ranges || ranges.length < 2) return ranges || [];
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [sorted[0].slice()];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const r = sorted[i];
    if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push(r.slice());
  }
  return out;
}

/** Manifest class factory: builds the matcher classes once, then publishes SearchQuery. */
export function ng11DefineSearchQuery(host) {
  ng11QueryHost = host;
  ng11EnsureMatchers(host);
  const C = ng11SearchClasses;
  if (!C.SearchQuery) C.SearchQuery = SearchQuery;
  return C.SearchQuery;
}

// ---- contract-name aliases (manifest `use` / sibling imports) --------------------------------------

export const searchClasses = ng11SearchClasses;
export const escapeRegExpQuery = ng11EscapeRegExpQuery;
export const mergeMatchResults = ng11MergeMatchResults;
export const resetRegexCaches = ng11ResetRegexCaches;
export const cachedRegExp = ng11CachedRegExp;
export const regexMatchRanges = ng11RegexMatchRanges;
export const wholeWordPattern = (text) => ng11WholeWordPattern(text, ng11QueryHost);
export const extensionWithoutContent = (extension) => ng11ExtensionWithoutContent(extension, ng11QueryHost);
export const tokenizeQuery = ng11TokenizeQuery;
export const tokenEnd = ng11TokenEnd;
export const checkToken = ng11CheckToken;
export const parsePrimary = ng11ParsePrimary;
export const parseAndSequence = ng11ParseAndSequence;
export const parseOrExpression = ng11ParseOrExpression;
export const buildMatcher = ng11BuildMatcher;
export const defineSearchOperators = ng11DefineSearchOperators;
export const defineSearchQuery = ng11DefineSearchQuery;
export const defineSearchTarget = ng11DefineSearchTarget;
export const defineSearchMatcherBase = ng11DefineSearchMatcherBase;
export const defineWrappedMatcher = ng11DefineWrappedMatcher;
export const defineSplitContentMatcher = ng11DefineSplitContentMatcher;
export const defineMultiMatcher = ng11DefineMultiMatcher;
export const defineCaseMatcher = ng11DefineCaseMatcher;
export const definePathMatcher = ng11DefinePathMatcher;
export const defineFileMatcher = ng11DefineFileMatcher;
export const defineContentMatcher = ng11DefineContentMatcher;
export const defineNotMatcher = ng11DefineNotMatcher;
export const defineRegexMatcher = ng11DefineRegexMatcher;
export const defineQuotedTextMatcher = ng11DefineQuotedTextMatcher;
export const defineTextMatcher = ng11DefineTextMatcher;
export const defineEmptyMatcher = ng11DefineEmptyMatcher;
export const defineCompareMatcher = ng11DefineCompareMatcher;
export const defineBooleanMatcher = ng11DefineBooleanMatcher;
export const definePropertyMatcher = ng11DefinePropertyMatcher;
export const defineLineMatcher = ng11DefineLineMatcher;
export const defineBlockMatcher = ng11DefineBlockMatcher;
export const defineSectionMatcher = ng11DefineSectionMatcher;
export const defineTaskMatcher = ng11DefineTaskMatcher;
export const defineTagMatcher = ng11DefineTagMatcher;
export const defineAndGroup = ng11DefineAndGroup;
export const defineOrGroup = ng11DefineOrGroup;
