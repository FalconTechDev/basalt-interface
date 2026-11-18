// Plugin-API search helpers built on the fuzzy matcher: the "simple" (all words must occur) search, match rendering and
// link sub-path resolution (headings, blocks, footnotes) used by wiki links like [[Note#Heading]] and [[Note#^block]].
import { prepareQuery, matchScore, fuzzyMatchJs } from "./search.js";
import { plainHeading } from "./text.js";

/** Sorts [start, end] spans by start and merges the overlapping ones (in place for the sort; returns the merged list). */
export function mergeSpans(spans) {
  if (spans.length === 0) return spans;
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const last = merged[merged.length - 1];
    if (last[1] < spans[i][0]) merged.push(spans[i]);
    else if (last[1] < spans[i][1]) last[1] = spans[i][1];
  }
  return merged;
}

/**
 * Finds every occurrence of every word in `text` (case-insensitively; `words` are already lower case, empty ones are skipped).
 * Returns the merged match spans, or null when some word does not occur at all.
 */
export function containsAllWords(words, text) {
  const lower = text.toLowerCase();
  const spans = [];
  for (const word of words) {
    if (!word) continue;
    let found = false;
    let from = -1;
    while ((from = lower.indexOf(word, from)) !== -1) {
      found = true;
      spans.push([from, from + word.length]);
      from += word.length + 1;
    }
    if (!found) return null;
  }
  return mergeSpans(spans);
}

/** { score, matches } for a "simple" match of the words of `query` in `text`, or null. */
export function simpleMatch(words, query, text) {
  const spans = containsAllWords(words, text);
  return spans ? { score: matchScore(spans, query.length, text.length, 0), matches: spans } : null;
}

/** prepareFuzzySearch(query) -> (text) => { score, matches } | null  (typo-tolerant, in-order letters) */
export function prepareFuzzyFinder(query) {
  const prepared = prepareQuery(query);
  return (text) => fuzzyMatchJs(prepared, text);
}

/** prepareSimpleSearch(query) -> (text) => { score, matches } | null  (every space-separated word must occur) */
export function prepareSimpleFinder(query) {
  const words = query.toLowerCase().split(" ");
  return (text) => simpleMatch(words, query, text);
}

/** A node for `text` with the [start, end] ranges of `ranges` (shifted by `offset`) wrapped in highlight spans. */
function highlightedFragment(text, ranges, offset = 0) {
  if (!ranges || ranges.length === 0) return document.createTextNode(text);
  const fragment = document.createDocumentFragment();
  let done = 0; // text before this index has been emitted
  for (let i = 0; done < text.length && i < ranges.length; i++) {
    let start = ranges[i][0] + offset;
    const end = ranges[i][1] + offset;
    if (end <= 0) continue;
    if (start >= text.length) break;
    if (start < 0) start = 0;
    if (start !== done) fragment.appendText(text.substring(done, start));
    fragment.createSpan({ cls: "suggestion-highlight", text: text.substring(start, end) });
    done = end;
  }
  if (done < text.length) fragment.appendText(text.substring(done));
  return fragment;
}

/** renderMatches(el, text, ranges, offset): appends `text` to `el` with the matched ranges highlighted. */
export function renderMatches(el, text, ranges, offset = 0) {
  el.appendChild(highlightedFragment(text, ranges, offset));
}

/** renderResults(el, text, result, offset): like renderMatches, taking the `{ matches }` of a search result (or null). */
export function renderResults(el, text, result, offset = 0) {
  renderMatches(el, text, result ? result.matches : null, offset);
}

/**
 * Resolves the part after "#" of a link inside a cached file (`cache`: headings, blocks, listItems, footnotes).
 * "^id" -> a block, "[^id]" -> a footnote, otherwise a (nested) heading path "A#B#C"; the result carries the start / end positions
 * to scroll to and select, or null when nothing matches.
 */
export function resolveSubpath(cache, subpath) {
  if (!cache || !subpath) return null;
  const parts = subpath.split("#").filter((part) => !!part);
  if (!parts || parts.length === 0) return null;

  if (parts.length === 1) {
    const only = parts[0];
    if (only.startsWith("^")) {
      const id = only.substr(1).toLowerCase();
      const blocks = cache.blocks;
      if (blocks && blocks.hasOwnProperty(id)) {
        for (const key in blocks) {
          if (key.toLowerCase() === id && blocks.hasOwnProperty(key)) {
            const block = blocks[key];
            let list = null;
            if (cache.listItems) {
              for (const item of cache.listItems) {
                if (item.id && item.id.toLowerCase() === id) { list = item; break; }
              }
            }
            return { type: "block", block, list, start: block.position.start, end: block.position.end };
          }
        }
      }
    } else if (only.startsWith("[^")) {
      const id = only.slice(2, -1);
      if (cache.footnotes) {
        for (const footnote of cache.footnotes) {
          if (footnote.id === id) return { type: "footnote", footnote, start: footnote.position.start, end: footnote.position.end };
        }
      }
    }
  }

  const headings = cache.headings;
  if (!headings || headings.length === 0) return null;
  // walk the headings in order: each part of the path must be found at a deeper level than the previous one;
  // the section ends at the next heading of the same or a higher level
  let matched = 0;
  let level = 0;
  let found = null;
  let next = null;
  for (const heading of headings) {
    if (found && heading.level <= level) {
      next = heading;
      break;
    }
    if (!found && heading.level > level && plainHeading(heading.heading).toLowerCase() === plainHeading(parts[matched]).toLowerCase()) {
      matched++;
      level = heading.level;
      if (matched === parts.length) found = heading;
    }
  }
  return found ? { type: "heading", current: found, next, start: found.position.start, end: next ? next.position.start : null } : null;
}
