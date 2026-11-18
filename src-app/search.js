// Quick-switcher style fuzzy matching in plain JS (the same scoring also exists in app-core, see rust.js).

const SEPARATOR = /[ -⁯⸀-⹿\\'!"#$%&()*+,\-.\/:;<=>?@\[\]^_`{|}~]/;
const SPACE = /\s/;
const CJK = /[ༀ-࿿぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;

/** Splits a query into word tokens (separators and CJK characters become tokens of their own) plus the letters for fuzzy mode. */
export function prepareQuery(query) {
  const lower = query.toLowerCase();
  const tokens = [];
  let start = 0;
  for (let i = 0; i < lower.length; i++) {
    const ch = lower.charAt(i);
    if (SPACE.test(ch)) {
      if (start !== i) tokens.push(lower.substring(start, i));
      start = i + 1;
    } else if (SEPARATOR.test(ch) || CJK.test(ch)) {
      if (start !== i) tokens.push(lower.substring(start, i));
      tokens.push(ch);
      start = i + 1;
    }
  }
  if (start !== lower.length) tokens.push(lower.substring(start, lower.length));
  return { query, tokens, fuzzy: lower.split("").filter((c) => c !== " ") };
}

/** Score of a set of matched spans: fewer, tighter, earlier matches in shorter text rank higher. */
export function matchScore(spans, queryLength, textLength, camelBreaks) {
  if (spans.length === 0) return 0;
  let score = 0;
  score -= Math.max(0, spans.length - 1);
  score -= camelBreaks / 10;
  const first = spans[0][0];
  score -= (spans[spans.length - 1][1] - first + 1 - queryLength) / 100;
  score -= first / 1000;
  score -= textLength / 1e4;
  return score;
}

function matchPieces(pieces, query, text, fuzzy) {
  if (pieces.length === 0) return null;
  const lower = text.toLowerCase();
  let camel = 0;
  let from = 0;
  const spans = [];
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    const at = lower.indexOf(piece, from);
    if (at === -1) return null;
    const ch = text.charAt(at);
    if (at > 0 && !SEPARATOR.test(ch) && !CJK.test(ch)) {
      const prev = text.charAt(at - 1);
      const humpAfterLower = ch.toLowerCase() !== ch && prev.toLowerCase() !== prev;
      const wordStart = ch.toUpperCase() !== ch && !SEPARATOR.test(prev) && !SPACE.test(prev) && !CJK.test(prev);
      if (humpAfterLower || wordStart) {
        if (fuzzy) {
          if (at !== from) { from += piece.length; i--; continue; }
        } else {
          camel += 1;
        }
      }
    }
    const last = spans[spans.length - 1];
    if (!last || last[1] < at) spans.push([at, at + piece.length]); else last[1] = at + piece.length;
    from = at + piece.length;
  }
  return { matches: spans, score: matchScore(spans, query.length, lower.length, camel) };
}

/** Result of matching one text against a prepared query: {score, matches:[[from,to]...]} or null. */
export function fuzzyMatchJs(prepared, text) {
  if (prepared.query === "") return { score: 0, matches: [] };
  return matchPieces(prepared.tokens, prepared.query, text, false) || matchPieces(prepared.fuzzy, prepared.query, text, true);
}
