// Markdown formatting detection for the editor (selection.format, toggle commands).
//
// Own re-implementation of the small helpers that used to sit in the inherited
// application scope: the format spec table, whitespace trimming, cursor placement
// and the per-line syntax-tree scan that reports which markdown formats apply
// uniformly across a range. Behaviour is kept identical to the original; the
// lezer/codemirror primitives it needs are read lazily through env().

import { env } from "./env.js";

// Maps each markdown format to the syntax node type that represents it and the
// characters used to write it inline. `nodeType` values are the names Obsidian's
// lezer markdown parser gives its inline nodes.
export const s90FormatSpecs = {
	bold: { nodeType: "strong", surroundingChars: "**", altSurroundingChars: "__" },
	italic: { nodeType: "em", surroundingChars: "*", altSurroundingChars: "_" },
	code: { nodeType: "inline-code", surroundingChars: "`" },
	highlight: { nodeType: "highlight", surroundingChars: "==" },
	strikethrough: { nodeType: "strikethrough", surroundingChars: "~~" },
	comment: { nodeType: "comment", surroundingChars: "%%" },
	math: { nodeType: "math", surroundingChars: "$" },
};

// Node type names used while scanning a range, keyed by format name. Separate
// from s90FormatSpecs because detection works on lezer node names, not on the
// characters users type.
const S90_NODE_TYPES = {
	italic: "em",
	code: "inline-code",
	comment: "comment",
	bold: "strong",
	highlight: "highlight",
	strikethrough: "strikethrough",
	math: "math",
};

const S90_HEADING_RE = /\bheader-(\d)\b/;

function s90ClearAll(map) {
	for (const key in map) delete map[key];
}

// Trims whitespace from both ends of a document range.
export function s90TrimWhitespace(state, range) {
	let from = range.from;
	let to = range.to;
	while (from < to && /\s+/.test(state.sliceDoc(from, from + 1))) from++;
	while (to > from && /\s+/.test(state.sliceDoc(to - 1, to))) to--;
	return { from, to };
}

// Places a syntax cursor at `pos`. Inside a table cell the cursor stays on the
// "before" side so callers inspect the node that ends at pos; everywhere else
// (top level or inside a table) it moves to the "after" side.
export function s90CursorToContentSide(cursor, pos) {
	cursor.moveTo(pos, -1);
	const cls = cursor.node.parent ? cursor.node.type.prop(env().Zd) ?? "" : "";
	if (!(cursor.node.parent && !cls.contains("table"))) cursor.moveTo(pos, 1);
}

// Scans the syntax tree across the lines touched by `range` and reports which
// markdown formats are uniformly present, plus heading information.
export function s90DetectFormatting(state, range) {
	const { tp, Lu, $d, ff, mf } = env();
	const cursor = tp(state).cursor(Lu.ExcludeBuffers);
	const candidates = { ...S90_NODE_TYPES };
	let sawUnformatted = false;
	let uniformHeading = true;
	let headingLevel;
	const firstLine = state.doc.lineAt(range.from);
	const lastLine = state.doc.lineAt(range.to);
	const multiLine = firstLine.number !== lastLine.number;

	for (let lineNo = firstLine.number; lineNo <= lastLine.number; lineNo++) {
		const line = state.doc.line(lineNo);
		if ((range.from < line.from || range.to > line.to) && ff(state, line)) continue;
		const content = mf(state, lineNo);
		if (multiLine && content.from === content.to) continue;
		const scanFrom = Math.max(content.from, range.from);
		const scanTo = Math.min(content.to, range.to);
		s90CursorToContentSide(cursor, scanFrom);
		let nodeEnd = cursor.from;
		if (!cursor.node.parent) s90ClearAll(candidates);
		for (;;) {
			const classes = new Set((cursor.node.type.prop($d) || "").split(" "));
			for (const key in candidates) {
				if (!Object.prototype.hasOwnProperty.call(candidates, key)) continue;
				if (classes.has("formatting")) continue;
				sawUnformatted = true;
				if (!classes.has(candidates[key])) delete candidates[key];
			}
			if (uniformHeading) {
				const m = S90_HEADING_RE.exec(cursor.node.type.prop($d) || "");
				const level = m ? Number(m[1]) : 0;
				if (headingLevel !== undefined && headingLevel !== level) uniformHeading = false;
				headingLevel = level;
			}
			if (nodeEnd < cursor.from) s90ClearAll(candidates);
			nodeEnd = cursor.to;
			if (nodeEnd >= scanTo || !cursor.next()) break;
		}
		if (nodeEnd < scanTo) s90ClearAll(candidates);
	}

	if (!sawUnformatted) s90ClearAll(candidates);

	if (candidates.math) {
		while (cursor.prevSibling()) {
			const classes = new Set((cursor.node.type.prop($d) || "").split(" "));
			if (classes.has("format-math-begin")) {
				if (classes.has("math-block")) delete candidates.math;
				break;
			}
		}
	}

	return {
		headingLevel: headingLevel ?? 0,
		uniformHeading,
		bold: !!candidates.bold,
		italic: !!candidates.italic,
		code: !!candidates.code,
		comment: !!candidates.comment,
		highlight: !!candidates.highlight,
		strikethrough: !!candidates.strikethrough,
		math: !!candidates.math,
	};
}
