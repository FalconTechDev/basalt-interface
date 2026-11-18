// g11 clean-room: search matcher tree. A SearchTarget carries the strings of one file
// (content / filename / filepath / propertyName / tag pseudo-keys) plus the file cache;
// every matcher answers match(target) with a tri-state: a result object (ranges per key),
// null (definite no-match) or undefined (no opinion). Results merge through
// ng11MergeMatchResults; the parser lives in n-g11-query.js.

import { inherit,methods } from "./inherit.js";

/** Registry every matcher/query class is published to (instanceof checks across modules). */
export const ng11SearchClasses = {};

/** Lazily ensures the matcher classes exist (called by the parser entry points). */
export function ng11EnsureMatcherSet(host) { return ng11EnsureMatchers(host); }

// Data key under which a [key:value] context stashes the raw property value for
// the TRUE/FALSE/EMPTY and </> matchers.
const NG11_PROP_VALUE = "ng11-prop-value";

/** Escapes every regex metacharacter so `text` matches literally. */
export function ng11EscapeRegExpQuery(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Concatenates the range lists of `from` before those of `into`, per result key. */
export function ng11MergeMatchResults(into, from) {
  if (!into) return from;
  if (!from) return into;
  for (const key of Object.keys(from)) {
    if (key === "properties") {
      const props = from.properties || [];
      into.properties = props.concat(into.properties || []);
      continue;
    }
    const ranges = from[key];
    if (!ranges || !ranges.length) continue;
    into[key] = ranges.concat(into[key] || []);
  }
  return into;
}

// ---- regex caches (two objects keyed by pattern source; cleared ~60 s after last use) ----
const ng11RegexCacheSensitive = new Map();
const ng11RegexCacheInsensitive = new Map();
let ng11RegexResetTimer = null;

/** Drops both regex caches; scheduled lazily after matches. */
export function ng11ResetRegexCaches() {
  ng11RegexCacheSensitive.clear();
  ng11RegexCacheInsensitive.clear();
}

function ng11ScheduleRegexReset() {
  if (ng11RegexResetTimer) clearTimeout(ng11RegexResetTimer);
  ng11RegexResetTimer = setTimeout(ng11ResetRegexCaches, 60000);
}

/** Global+multiline RegExp for `source`, `gm` or `gmi` depending on case sensitivity. */
export function ng11CachedRegExp(source, caseSensitive) {
  ng11ScheduleRegexReset();
  const cache = caseSensitive ? ng11RegexCacheSensitive : ng11RegexCacheInsensitive;
  let re = cache.get(source);
  if (!re) {
    re = new RegExp(source, caseSensitive ? "gm" : "gmi");
    cache.set(source, re);
  }
  re.lastIndex = 0;
  return re;
}

/** All [start,end) match ranges of `re` in `text`; zero-length matches are skipped.
 *  With `wholeWord`, only matches whose first capture group is non-empty count and the
 *  reported range is the capture extent. */
export function ng11RegexMatchRanges(re, text, wholeWord) {
  const ranges = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (wholeWord) {
      const g = m[1];
      if (g === undefined || g.length === 0) continue;
      const start = m.index + m[0].indexOf(g);
      ranges.push([start, start + g.length]);
    } else {
      ranges.push([m.index, m.index + m[0].length]);
    }
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return ranges;
}

/** Whole-word regex source around `text` (boundaries from the host word-char source). */
export function ng11WholeWordPattern(text, host) {
  if (!text) return "";
  const wc = (host && host.WordCharSource) || "A-Za-z0-9_";
  const esc = ng11EscapeRegExpQuery(text);
  const firstWord = new RegExp("^[" + wc + "]").test(text[0]);
  const lastWord = new RegExp("[" + wc + "]$").test(text[text.length - 1]);
  let src = "(" + esc + ")";
  if (firstWord) src = "(?:^|[^" + wc + "])" + src;
  if (lastWord) src = src + "(?![" + wc + "])";
  else src = src + "()";
  return src;
}

/** Extensions whose content is not searched (host-provided searchable list). */
export function ng11ExtensionWithoutContent(extension, host) {
  return !host.SearchableExtensions.includes(extension);
}

// ---- SearchTarget -------------------------------------------------------------------------------

function ng11EnsureClasses(host) {
  if (!ng11SearchClasses.SearchTarget) ng11BuildMatchers(host);
  return ng11SearchClasses;
}

/** The strings of one searchable unit plus the file cache they were taken from. */
function SearchTarget(strings, original, keys, caseSensitive) {
  this.strings = strings;
  this.original = original || strings;
  this.keys = keys;
  this.caseSensitive = !!caseSensitive;
  this.cache = null;
  this.data = new Map();
}
methods(SearchTarget, {
  clone() {
    const copy = new SearchTarget(this.strings.slice(), this.original.slice(), this.keys.slice(), this.caseSensitive);
    copy.cache = this.cache;
    for (const [k, v] of this.data) copy.data.set(k, v);
    return copy;
  },
  cloneForPropertyContent(content) {
    const copy = new SearchTarget([content], [content], ["content"], this.caseSensitive);
    copy.cache = this.cache;
    return copy;
  },
  setData(key, value) { this.data.set(key, value); },
  getData(key) { return this.data.get(key); },
  deleteData(key) { this.data.delete(key); },
});

// ---- matcher plumbing ---------------------------------------------------------------------------

/** Adds `ranges` under `key` of `result` (created on demand). */
function ng11Push(result, key, ranges) {
  if (!ranges || !ranges.length) return result;
  if (!result) result = {};
  const list = result[key] || (result[key] = []);
  for (const r of ranges) list.push(r);
  return result;
}

/** Runs `fn(string)` per searchable string; merges non-empty results. */
function ng11MatchStrings(target, fn) {
  let result = null;
  const strings = target.strings;
  for (let i = 0; i < strings.length; i++) {
    const r = fn(strings[i], target.keys[i], i);
    if (r) result = ng11MergeMatchResults(result, r);
  }
  return result;
}

/** Base class of every matcher. */
function SearchMatcherBase() {
  this.matchedTokens = [];
  this._span = null; // [startTokenIndex, endTokenIndex) in the query token list
}
methods(SearchMatcherBase, {
  match() { return undefined; },
  getInfo() { return ""; },
  requiredInputs() { return {}; },
  getContext(pos) {
    if (!this._tokens) return null;
    let idx = -1;
    for (let i = 0; i < this._tokens.length; i++) {
      const t = this._tokens[i];
      if (t.pos <= pos && pos <= ng11TokenEndOf(t)) { idx = i; break; }
      if (t.pos > pos) break;
    }
    if (idx < 0) return null;
    const stack = [];
    const found = ng11DeepestContext(this, idx, stack);
    if (!found) return null;
    return { matcherStack: stack, token: this._tokens[idx] };
  },
});

function ng11TokenEndOf(token) {
  if (typeof token.end === "number") return token.end;
  return token.pos + token.content.length + (token.type === "quote" || token.type === "regex" ? 2 : 0);
}

/** Children a matcher exposes for context descent, in evaluation order. */
function ng11MatcherChildren(node) {
  if (node.matcher) return [node.matcher];
  if (node.matchers) return node.matchers;
  if (node.key) return [node.key, node.value].filter(Boolean);
  return [];
}

function ng11SpanCovers(node, idx) {
  if (!node._span) return true;
  return node._span[0] <= idx && idx < node._span[1];
}

/** Depth-first search for the deepest matcher whose token span covers `idx`. */
function ng11DeepestContext(node, idx, stack) {
  if (!ng11SpanCovers(node, idx)) return null;
  stack.push(node);
  for (const child of ng11MatcherChildren(node)) {
    if (ng11SpanCovers(child, idx)) {
      if (ng11DeepestContext(child, idx, stack)) return true;
    }
  }
  return true;
}

/** Base of matchers that wrap exactly one inner matcher (.matcher). */
function WrappedMatcher(matcher) {
  const self = SearchMatcherBase.call(this) || this;
  self.matcher = matcher;
  return self;
}
inherit(WrappedMatcher, SearchMatcherBase);
methods(WrappedMatcher, {
  requiredInputs() { return this.matcher.requiredInputs(); },
  getInfo() { return this.matcher.getInfo(); },
});

/** Base of matchers that re-run their inner matcher over pieces of the content (.matcher). */
function SplitContentMatcher(matcher) {
  const self = WrappedMatcher.call(this, matcher) || this;
  return self;
}
inherit(SplitContentMatcher, WrappedMatcher);

/** Base of n-ary matchers (.matchers). */
function MultiMatcher(matchers) {
  const self = SearchMatcherBase.call(this) || this;
  self.matchers = matchers || [];
  return self;
}
inherit(MultiMatcher, SearchMatcherBase);
methods(MultiMatcher, {
  requiredInputs() {
    const inputs = {};
    for (const m of this.matchers) Object.assign(inputs, m.requiredInputs());
    return inputs;
  },
});

// ---- leaf matchers ------------------------------------------------------------------------------

/** `/regex/` token: global regex over every searchable string of the target. */
function RegexMatcher(pattern) {
  const self = SearchMatcherBase.call(this) || this;
  self.regex = pattern;
  self.text = pattern;
  return self;
}
inherit(RegexMatcher, SearchMatcherBase);
methods(RegexMatcher, {
  match(target) {
    if (!this.regex) return null;
    return ng11MatchStrings(target, (text, key) => {
      if (text === "") return null;
      const ranges = ng11RegexMatchRanges(ng11CachedRegExp(this.regex, target.caseSensitive), text);
      return ranges.length ? { [key]: ranges } : null;
    });
  },
  getInfo() { return "/" + this.regex + "/"; },
  requiredInputs() { return { content: true }; },
});

/** Bare word: regex-escaped RegexMatcher. */
function TextMatcher(text) {
  const self = RegexMatcher.call(this, ng11EscapeRegExpQuery(text)) || this;
  self.text = text;
  self.source = ng11EscapeRegExpQuery(text);
  return self;
}
inherit(TextMatcher, RegexMatcher);
methods(TextMatcher, {
  getInfo() { return this.text; },
});

/** `"..."` token: whole-word on content, exact on propertyName, substring elsewhere. */
function QuotedTextMatcher(text) {
  const self = SearchMatcherBase.call(this) || this;
  self.text = text;
  return self;
}
inherit(QuotedTextMatcher, SearchMatcherBase);
methods(QuotedTextMatcher, {
  match(target) {
    if (this.text === "") return undefined;
    const host = ng11MatcherHost;
    const wc = (host && host.WordCharSource) || "A-Za-z0-9_";
    return ng11MatchStrings(target, (text, key) => {
      if (key === "content") {
        const source = ng11WholeWordPattern(this.text, { WordCharSource: wc });
        if (!source) return null;
        const ranges = ng11RegexMatchRanges(ng11CachedRegExp(source, target.caseSensitive), text, true);
        return ranges.length ? { content: ranges } : null;
      }
      if (key === "propertyName") {
        return text.toLowerCase() === this.text.toLowerCase() ? { propertyName: [[0, text.length]] } : null;
      }
      const idx = target.caseSensitive ? text.indexOf(this.text) : text.toLowerCase().indexOf(this.text.toLowerCase());
      return idx >= 0 ? { [key]: [[idx, idx + this.text.length]] } : null;
    });
  },
  getInfo() { return '"' + this.text + '"'; },
  requiredInputs() { return { content: true }; },
});

/** Matches every non-empty-string key with a zero-width range at 0 (empty alternative). */
function EmptyMatcher() {
  return SearchMatcherBase.call(this) || this;
}
inherit(EmptyMatcher, SearchMatcherBase);
methods(EmptyMatcher, {
  match(target) {
    let result = null;
    for (let i = 0; i < target.keys.length; i++) {
      const text = target.strings[i];
      if (text && text.length) result = ng11Push(result, target.keys[i], [[0, 0]]);
    }
    return result === null ? null : result;
  },
  getInfo() { return ""; },
});

/** TRUE / FALSE / EMPTY: compares the raw property value stashed by [key:value]. */
function BooleanMatcher(expected) {
  const self = SearchMatcherBase.call(this) || this;
  self.expected = expected; // true | false | "empty"
  return self;
}
inherit(BooleanMatcher, SearchMatcherBase);
methods(BooleanMatcher, {
  match(target) {
    const value = target.getData(NG11_PROP_VALUE);
    let hit = false;
    if (this.expected === "empty") hit = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    else if (this.expected === true) hit = value === true || value === "true" || value === 1 || value === "1";
    else hit = value === false || value === "false" || value === 0 || value === "0";
    return hit ? { content: [[0, String(value ?? "").length]] } : null;
  },
  getInfo() { return String(this.expected).toUpperCase(); },
});

/** `>` / `<` prefix: lexical compare of the stashed property value vs operand text. */
function CompareMatcher(type, text) {
  const self = SearchMatcherBase.call(this) || this;
  self.type = type;
  self.text = text;
  return self;
}
inherit(CompareMatcher, SearchMatcherBase);
methods(CompareMatcher, {
  match(target) {
    const value = target.getData(NG11_PROP_VALUE);
    if (value === undefined || value === null) return null;
    const s = String(value);
    const ok = this.type === ">" ? s > this.text : s < this.text;
    return ok ? { content: [[0, s.length]] } : null;
  },
  getInfo() { return this.type + this.text; },
});

/** `-x`: definite no-match whenever the inner matcher produces any result. */
function NotMatcher(matcher) {
  const self = WrappedMatcher.call(this, matcher) || this;
  return self;
}
inherit(NotMatcher, WrappedMatcher);
methods(NotMatcher, {
  match(target) {
    const result = this.matcher.match(target);
    if (result === undefined) return undefined;
    return result ? null : {};
  },
  getInfo() { return "-" + this.matcher.getInfo(); },
});

/** `match-case:` / `ignore-case:`: clone target with the case flag overridden. */
function CaseMatcher(matcher, caseSensitive) {
  const self = WrappedMatcher.call(this, matcher) || this;
  self.caseSensitive = caseSensitive;
  return self;
}
inherit(CaseMatcher, WrappedMatcher);
methods(CaseMatcher, {
  match(target) {
    const clone = target.clone();
    clone.caseSensitive = this.caseSensitive;
    return this.matcher.match(clone);
  },
  getInfo() { return (this.caseSensitive ? "match-case:" : "ignore-case:") + this.matcher.getInfo(); },
});

/** Restricts the inner match to one key of the target (path/file/content). */
function KeyMatcher(matcher, key, required) {
  const self = WrappedMatcher.call(this, matcher) || this;
  self.key = key;
  self.required = required;
  return self;
}
inherit(KeyMatcher, WrappedMatcher);
methods(KeyMatcher, {
  match(target) {
    const idx = target.keys.indexOf(this.key);
    if (idx < 0) return this.required ? null : undefined;
    const clone = target.clone();
    clone.strings = [target.strings[idx]];
    clone.original = [target.original[idx]];
    clone.keys = [this.key];
    const inner = this.matcher.match(clone);
    if (inner === undefined) return undefined;
    return inner === null ? null : inner;
  },
  requiredInputs() {
    const inputs = this.matcher.requiredInputs();
    if (!this.required) return {};
    return inputs;
  },
  getInfo() { return this.matcher.getInfo(); },
});

function PathMatcher(matcher) { return KeyMatcher.call(this, matcher, "filepath", false) || this; }
inherit(PathMatcher, KeyMatcher);
function FileMatcher(matcher) { return KeyMatcher.call(this, matcher, "filename", false) || this; }
inherit(FileMatcher, KeyMatcher);
function ContentMatcher(matcher) { return KeyMatcher.call(this, matcher, "content", true) || this; }
inherit(ContentMatcher, KeyMatcher);
methods(ContentMatcher, { requiredInputs() { return { content: true }; } });

/** `[key]` / `[key:value]`: frontmatter property matcher. */
function PropertyMatcher(keyMatcher, valueMatcher) {
  const self = SearchMatcherBase.call(this) || this;
  self.key = keyMatcher;
  self.value = valueMatcher || null;
  return self;
}
inherit(PropertyMatcher, SearchMatcherBase);
methods(PropertyMatcher, {
  match(target) {
    const frontmatter = target.cache && target.cache.frontmatter;
    if (!frontmatter) return null;
    const properties = [];
    let any = false;
    for (const propName of Object.keys(frontmatter)) {
      const value = frontmatter[propName];
      // key sub-matcher against the property name (pseudo-key "propertyName")
      const keyTarget = new SearchTarget([propName], [propName], ["propertyName"], target.caseSensitive);
      keyTarget.cache = target.cache;
      const keyResult = this.key.match(keyTarget);
      if (!keyResult) continue;
      if (!this.value) {
        properties.push({ key: propName, pos: [0, propName.length] });
        any = true;
        continue;
      }
      const values = Array.isArray(value) ? value : [value];
      for (let i = 0; i < values.length; i++) {
        const raw = values[i];
        const text = raw === undefined || raw === null ? "" : String(raw);
        const valueTarget = target.cloneForPropertyContent(text);
        valueTarget.setData(NG11_PROP_VALUE, raw);
        const valueResult = this.value.match(valueTarget);
        if (!valueResult) continue;
        const entry = { key: propName, pos: [0, text.length] };
        if (Array.isArray(value)) entry.subkey = [i];
        properties.push(entry);
        any = true;
      }
    }
    return any ? { properties } : null;
  },
  getInfo() {
    return "[" + this.key.getInfo() + (this.value ? ":" + this.value.getInfo() : "") + "]";
  },
});

/** `tag:` operator: matches vault tags, frontmatter tags and inline tag positions. */
function TagMatcher(matcher) {
  const self = WrappedMatcher.call(this, matcher) || this;
  if (self.matcher instanceof TextMatcher && !self.matcher.text.startsWith("#")) {
    self.matcher = new TextMatcher("#" + self.matcher.text);
  }
  return self;
}
inherit(TagMatcher, WrappedMatcher);
methods(TagMatcher, {
  match(target) {
    const cache = target.cache;
    const source = this.matcher instanceof TextMatcher
      ? "^" + ng11EscapeRegExpQuery(this.matcher.text) + "($|/)"
      : null;
    let result = null;
    // inline tags recorded by the metadata cache
    if (cache && cache.tags) {
      const re = source ? ng11CachedRegExp(source, true) : null;
      for (const tag of cache.tags) {
        const name = "#" + String(tag.tag || "").replace(/^#+/, "");
        let hit = false;
        if (source) {
          re.lastIndex = 0;
          hit = re.test(name);
        } else {
          const t = target.clone();
          t.strings = [name]; t.original = [name]; t.keys = ["tag"];
          hit = !!this.matcher.match(t);
        }
        if (hit && tag.position) {
          const s = tag.position.start.offset, e = tag.position.end.offset;
          result = ng11Push(result, "content", [[s, e]]);
        }
      }
    }
    // frontmatter tags (key "tags", case-insensitive)
    const frontmatter = cache && cache.frontmatter;
    if (frontmatter && frontmatter.tags) {
      const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
      for (const raw of tags) {
        const name = "#" + String(raw).replace(/^#/, "");
        let hit = false;
        if (source) {
          const re = ng11CachedRegExp(source, true);
          re.lastIndex = 0;
          hit = re.test(name);
        } else {
          const t = new SearchTarget([name], [name], ["tag"], false);
          hit = !!this.matcher.match(t);
        }
        if (hit) result = ng11Push(result, "properties", [{ key: "tags", pos: [0, String(raw).length] }]);
      }
    }
    // the tag pseudo-key itself
    const tagIdx = target.keys.indexOf("tag");
    if (tagIdx >= 0) {
      const t = target.clone();
      t.strings = [target.strings[tagIdx]];
      t.original = [target.original[tagIdx]];
      t.keys = ["tag"];
      const inner = this.matcher.match(t);
      if (inner) result = ng11MergeMatchResults(result, inner);
      else if (inner === null && !result) return null;
    }
    return result === null ? (source ? null : undefined) : result;
  },
  getInfo() { return "tag:" + this.matcher.getInfo(); },
  requiredInputs() { return { content: true }; },
});

/** Base of matchers that re-run the inner matcher over content pieces with offset shifting. */
function SplitContentMatcherBase(matcher) {
  const self = SplitContentMatcher.call(this, matcher) || this;
  return self;
}
inherit(SplitContentMatcherBase, SplitContentMatcher);
methods(SplitContentMatcherBase, {
  /** Yields [text, offset] pieces of the target content. */
  pieces(target) { return [[target.strings[target.keys.indexOf("content")] || "", 0]]; },
  match(target) {
    const contentIdx = target.keys.indexOf("content");
    if (contentIdx < 0) return null;
    const content = target.strings[contentIdx];
    let sawUndefined = false;
    let ranges = null;
    for (const [piece, offset] of this.pieces(target, content)) {
      const clone = target.cloneForPropertyContent(piece);
      clone.caseSensitive = target.caseSensitive;
      const inner = this.matcher.match(clone);
      if (inner === undefined) { sawUndefined = true; continue; }
      if (inner === null) continue;
      const list = inner.content || [];
      for (const [s, e] of list) {
        if (!ranges) ranges = [];
        ranges.push([s + offset, e + offset]);
      }
      // non-content keys are ignored: pieces only produce content ranges
    }
    if (ranges && ranges.length) return { content: ranges };
    if (ranges) return { content: [[0, 0]] } ;
    return sawUndefined ? undefined : null;
  },
  requiredInputs() { return { content: true }; },
});

/** `line:` — inner match per \n-split line, ranges shifted by line offset. */
function LineMatcher(matcher) {
  const self = SplitContentMatcherBase.call(this, matcher) || this;
  return self;
}
inherit(LineMatcher, SplitContentMatcherBase);
methods(LineMatcher, {
  pieces(target, content) {
    const out = [];
    let offset = 0;
    const lines = content.split("\n");
    for (const line of lines) {
      out.push([line, offset]);
      offset += line.length + 1;
    }
    return out;
  },
  getInfo() { return "line:(" + this.matcher.getInfo() + ")"; },
});

/** `block:` — inner match per document block (non-list sections + list items). */
function BlockMatcher(matcher) {
  const self = SplitContentMatcherBase.call(this, matcher) || this;
  return self;
}
inherit(BlockMatcher, SplitContentMatcherBase);
methods(BlockMatcher, {
  pieces(target, content) {
    const cache = target.cache;
    if (!cache) return [[content, 0]];
    const out = [];
    const covered = [];
    if (cache.sections) {
      for (const sec of cache.sections) {
        if (sec.type === "list") continue;
        const s = sec.position.start.offset, e = sec.position.end.offset;
        out.push([content.slice(s, e), s]);
        covered.push([s, e]);
      }
    }
    if (cache.listItems) {
      for (const item of cache.listItems) {
        const s = item.position.start.offset, e = item.position.end.offset;
        out.push([content.slice(s, e), s]);
        covered.push([s, e]);
      }
    }
    if (!out.length) return [[content, 0]];
    // gaps between covered ranges still count as blocks
    covered.sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [s, e] of covered) {
      if (s > cursor) out.push([content.slice(cursor, s), cursor]);
      cursor = Math.max(cursor, e);
    }
    if (cursor < content.length) out.push([content.slice(cursor), cursor]);
    return out;
  },
  getInfo() { return "block:(" + this.matcher.getInfo() + ")"; },
});

/** `section:` — inner match per heading section, recursing into deeper sub-sections. */
function SectionMatcher(matcher) {
  const self = SplitContentMatcherBase.call(this, matcher) || this;
  return self;
}
inherit(SectionMatcher, SplitContentMatcherBase);
methods(SectionMatcher, {
  pieces(target, content) {
    const cache = target.cache;
    const headings = cache && cache.headings;
    if (!headings || !headings.length) return [[content, 0]];
    // build top-level sections: preamble + each heading run until next same-or-higher heading
    const sections = [];
    const firstOffset = headings[0].position.start.offset;
    if (firstOffset > 0) sections.push({ start: 0, end: firstOffset, children: 0 });
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      let end = content.length;
      let j = i + 1;
      while (j < headings.length && headings[j].level > h.level) j++;
      if (j < headings.length) end = headings[j].position.start.offset;
      sections.push({ start: h.position.start.offset, end, level: h.level, children: j - i - 1 });
      i = j - 1;
    }
    // flatten: deeper headings are matched through recursion in match() via pieces of children
    const out = [];
    for (const sec of sections) {
      out.push([content.slice(sec.start, sec.end), sec.start]);
    }
    return out;
  },
  getInfo() { return "section:(" + this.matcher.getInfo() + ")"; },
});

/** `task:` / `task-todo:` / `task-done:` — inner match per task list item. */
function TaskMatcher(matcher, completed) {
  const self = SplitContentMatcherBase.call(this, matcher) || this;
  self.completed = completed; // true | false | undefined (any)
  return self;
}
inherit(TaskMatcher, SplitContentMatcherBase);
methods(TaskMatcher, {
  pieces(target, content) {
    const cache = target.cache;
    if (!cache || !cache.listItems) return [];
    const out = [];
    for (const item of cache.listItems) {
      if (!item.task) continue;
      const t = item.task;
      const done = typeof t === "string" ? /[xX]/.test(t) : !!(t && t.completed);
      if (this.completed !== undefined && done !== this.completed) continue;
      const s = item.position.start.offset, e = item.position.end.offset;
      out.push([content.slice(s, e), s]);
    }
    return out;
  },
  match(target) {
    const pieces = this.pieces(target, target.strings[target.keys.indexOf("content")] || "");
    if (!pieces.length) return null;
    // quoted-empty operand matches every task
    if (this.matcher instanceof QuotedTextMatcher && this.matcher.text === "") {
      return { content: pieces.map(([p, o]) => [o, o + p.length]) };
    }
    return SplitContentMatcherBase.prototype.match.call(this, target);
  },
  getInfo() {
    const name = this.completed === true ? "task-done" : this.completed === false ? "task-todo" : "task";
    return name + ":(" + this.matcher.getInfo() + ")";
  },
});

/** AND group: every child must produce a defined result; results merge. */
function AndGroup(matchers) {
  const self = MultiMatcher.call(this, matchers) || this;
  return self;
}
inherit(AndGroup, MultiMatcher);
methods(AndGroup, {
  match(target) {
    let result = {};
    let sawUndefined = false;
    for (const m of this.matchers) {
      const r = m.match(target);
      if (r === null) return null;
      if (r === undefined) { sawUndefined = true; continue; }
      result = ng11MergeMatchResults(result, r);
    }
    if (sawUndefined && !Object.keys(result).length) return undefined;
    return result;
  },
  getInfo() { return this.matchers.map((m) => m.getInfo()).join(" "); },
});

/** OR group: first defined result wins; defined results merge. */
function OrGroup(matchers) {
  const self = MultiMatcher.call(this, matchers) || this;
  return self;
}
inherit(OrGroup, MultiMatcher);
methods(OrGroup, {
  match(target) {
    let result = null;
    let sawUndefined = false;
    for (const m of this.matchers) {
      const r = m.match(target);
      if (r === undefined) { sawUndefined = true; continue; }
      if (r === null) continue;
      result = ng11MergeMatchResults(result, r);
    }
    if (result !== null) return result;
    return sawUndefined ? undefined : null;
  },
  getInfo() { return this.matchers.map((m) => m.getInfo()).join(" OR "); },
});

// ---- builder -----------------------------------------------------------------------------------

let ng11MatcherHost = null;
let ng11MatchersBuilt = false;

/** Builds every matcher class once (dependency order) and publishes them to ng11SearchClasses.
 *  The host facade is refreshed on every call so late binding always wins. */
export function ng11EnsureMatchers(host) {
  if (host) ng11MatcherHost = host;
  if (!ng11MatchersBuilt) ng11BuildMatchers(ng11MatcherHost);
  return ng11SearchClasses;
}

function ng11BuildMatchers(host) {
  if (ng11MatchersBuilt) return;
  ng11MatchersBuilt = true;
  ng11MatcherHost = host || ng11MatcherHost;
  const C = ng11SearchClasses;
  C.SearchTarget = SearchTarget;
  C.SearchMatcherBase = SearchMatcherBase;
  C.WrappedMatcher = WrappedMatcher;
  C.SplitContentMatcher = SplitContentMatcherBase;
  C.MultiMatcher = MultiMatcher;
  C.AndGroup = AndGroup;
  C.OrGroup = OrGroup;
  C.RegexMatcher = RegexMatcher;
  C.TextMatcher = TextMatcher;
  C.QuotedTextMatcher = QuotedTextMatcher;
  C.EmptyMatcher = EmptyMatcher;
  C.BooleanMatcher = BooleanMatcher;
  C.CompareMatcher = CompareMatcher;
  C.NotMatcher = NotMatcher;
  C.CaseMatcher = CaseMatcher;
  C.PathMatcher = PathMatcher;
  C.FileMatcher = FileMatcher;
  C.ContentMatcher = ContentMatcher;
  C.PropertyMatcher = PropertyMatcher;
  C.TagMatcher = TagMatcher;
  C.LineMatcher = LineMatcher;
  C.BlockMatcher = BlockMatcher;
  C.SectionMatcher = SectionMatcher;
  C.TaskMatcher = TaskMatcher;
}

// The manifest factories: each returns the class from the shared registry. `host` is the
// __basaltHost facade; it is stored once and only dereferenced inside methods (lazy).
function ng11Cls(name) {
  return function (host) {
    ng11EnsureClasses(host);
    return ng11SearchClasses[name];
  };
}

export const ng11DefineSearchTarget = ng11Cls("SearchTarget");
export const ng11DefineSearchMatcherBase = ng11Cls("SearchMatcherBase");
export const ng11DefineWrappedMatcher = ng11Cls("WrappedMatcher");
export const ng11DefineSplitContentMatcher = ng11Cls("SplitContentMatcher");
export const ng11DefineMultiMatcher = ng11Cls("MultiMatcher");
export const ng11DefineCaseMatcher = ng11Cls("CaseMatcher");
export const ng11DefinePathMatcher = ng11Cls("PathMatcher");
export const ng11DefineFileMatcher = ng11Cls("FileMatcher");
export const ng11DefineContentMatcher = ng11Cls("ContentMatcher");
export const ng11DefineNotMatcher = ng11Cls("NotMatcher");
export const ng11DefineRegexMatcher = ng11Cls("RegexMatcher");
export const ng11DefineQuotedTextMatcher = ng11Cls("QuotedTextMatcher");
export const ng11DefineTextMatcher = ng11Cls("TextMatcher");
export const ng11DefineEmptyMatcher = ng11Cls("EmptyMatcher");
export const ng11DefineCompareMatcher = ng11Cls("CompareMatcher");
export const ng11DefineBooleanMatcher = ng11Cls("BooleanMatcher");
export const ng11DefinePropertyMatcher = ng11Cls("PropertyMatcher");
export const ng11DefineLineMatcher = ng11Cls("LineMatcher");
export const ng11DefineBlockMatcher = ng11Cls("BlockMatcher");
export const ng11DefineSectionMatcher = ng11Cls("SectionMatcher");
export const ng11DefineTaskMatcher = ng11Cls("TaskMatcher");
export const ng11DefineTagMatcher = ng11Cls("TagMatcher");
export const ng11DefineAndGroup = ng11Cls("AndGroup");
export const ng11DefineOrGroup = ng11Cls("OrGroup");
