# Component restyle plan — Basalt design language (stage 0 output)

Spec: `F:\orch\design\DESIGN.md`. Tokens already live in `src-css/03-tokens.css`
(built into `src/app.css`); the runtime basalt overrides in `src/basalt-ui.js`
(APP_CSS/THEME_CSS) currently pin the same palette — packages should move any
remaining hardcoded basalt literals into tokens as they touch a component.

Verification for EVERY package: `node build-css.mjs`, then headless runtime via
`tools/test-runtime.ps1` (worktree, ports 9960+, unique scratch) and
`node F:\orch\design\check.mjs --port <p> --shots <dir>` must stay green
(15/15), plus before/after screenshots in your own shots dir. NEVER open a
visible window; kill the runtime and delete scratch after each run.

Must not change (all packages): class names, selectors, DOM structure, the
plugin API, any existing variable NAME, sizes JS measures (`--header-height`,
`--input-height`, row heights, `--icon-*` sizes), `--font-*`/`--size-*` names.
New hooks are additive `--bs-*` tokens only. Where DESIGN.md gives a recipe,
express it with the existing variables; add a `--bs-*` token only if a value
is missing.

Each package owns its numbered file AND every `src-css/overrides-*/<same>.css`
file — no overlaps between packages.

## WP1 — Base document & typography
Files: `09-base.css`, `16-utilities.css` + `overrides-*/09-base.css`, `overrides-*/16-utilities.css`
Body text color/selection/caret already come from tokens; restyle headings
(h1–h6 weights/sizes per DESIGN.md §2, heading anchor hover, heading-formatting
color), paragraphs/spacing (`--p-spacing`), lists (markers `--list-marker-color`,
bullet radius → square-ish 0/2px, indent guides), blockquotes (2px accent bar,
`--blockquote-*`), hr (`--hr-color`/`--hr-thickness` 1px hairline), inline title,
metadata block basics. Keep `.cm-*` out — that is WP2.

## WP2 — Editor (CodeMirror live preview)
Files: `12-editor.css` + `overrides-*/12-editor.css`
CM theme `.cm-s-basalt`: caret `--caret-color`, selection `--text-selection`,
active line `--background-modifier-hover`-level tint, gutter colors
`--text-faint`/`--text-muted`, search matches `--bs-accent-soft`, syntax colors
already map to `--code-*`/`--color-*` tokens — verify each `.cm-*` color var
resolves to a basalt value, widget/chrome (fold gutters, tooltips inside editor)
per DESIGN.md. Do NOT touch widget geometry CM measures.

## WP3 — Workspace chrome (splits, leaves, drag)
Files: `10-workspace.css` + `overrides-*/10-workspace.css`
Split borders/dividers (`--divider-*`), leaf tabs container edges, drag ghost
(`--drag-ghost-*` → dark plate + copper accent border), workspace ribbon
background `--ribbon-background`, leaf header borders, empty-pane styling
(`.pane-empty` — must keep ≥4.5:1, currently `--text-faint`-level), mobile frame
edges. No layout/size changes.

## WP4 — Sidebar & file explorer
Files: `13-sidebar.css` + `overrides-*/13-sidebar.css`
Nav items per DESIGN.md §11: padding `--nav-item-padding`, radius `--radius-s`,
hover `--background-modifier-hover`, selected `--bs-accent-soft` + inset
`box-shadow: inset 2px 0 0 var(--interactive-accent)` (pattern already in
basalt-ui), headings `--nav-heading-*`, tags `--nav-tag-*`, folder chevrons
`--collapse-icon-color`, indent guides `--indentation-guide-color`, scrollbar
inside sidebar per §10. Keep row heights.

## WP5 — Tabs
Files: `15-tabs.css` + `overrides-*/15-tabs.css`
Tab bar container `--tab-container-background`, active tab blending into pane
(`--tab-background-active`), text steps `--tab-text-color*` (inactive = muted,
per token change), `--tab-radius`/`--tab-radius-active` (6px 6px 0 0 top),
dividider `--tab-divider-color`, close button hover, stacked tabs
`--tab-stacked-*`, tab switcher preview `--tab-switcher-*` + `--radius-xl`.

## WP6 — Menus & context menus
Files: `08-menus.css` + `overrides-*/08-menus.css`
Menu surface per DESIGN.md: `--menu-background`, 1px `--menu-border-color`,
`--radius-m` 2px + optional `--bs-cut-sm` chamfer via clip-path on
`.menu-container` (basalt-ui already chamfers `.menu` — unify, don't
double-clip), item height ~28px, hover `--background-modifier-hover`, selected
`--bs-accent-soft` or accent text, separators `--divider-color`, destructive
`--text-error`, scroll mask `--menu-scroll-mask`, submenu arrow icons.

## WP7 — Overlays: modals, prompts, suggest, tooltips, notices, services
Files: `07-modals.css`, `17-suggest.css`, `14-tooltips.css`, `06-services.css` + all `overrides-*/` of those
Modals per DESIGN.md §11: `--modal-*` tokens, `--radius-l` + `--bs-cut-md`
chamfer (settings already uses `--bs-cut:12px` — align to `--bs-cut-md` or keep
12px as `--bs-cut-lg`, pick one and document), header/body/footer paddings,
close button (basalt-ui supplies `.modal-close-button:empty` — keep), buttons
inside modals get chamfer recipe. Prompts/suggest/palette (`--prompt-*`,
`--suggestion-*`, `.bpal`/`.bss` already chamfered in basalt-ui — restyle
insides: input, items, kbd hints ≥4.5:1). Tooltips `--tooltip`-ish vars +
notices (`.notice` accent bar per severity). Services = misc overlays
(popovers `--popover-*`, hover popovers, PDF-ish chrome if present).

## WP8 — Forms, inputs, toggles, sliders
Files: `20-forms.css` + `overrides-*/20-forms.css`
Inputs per DESIGN.md §11: `--input-height` 30px, `--input-radius` 4px (or
`--bs-cut-sm` chamfer), `--input-shadow`/hover/focus states, focus ring
`--focus-ring-outline` + `--background-modifier-border-focus`. Toggles
`--toggle-*` (pill track intentional), checkboxes `--checkbox-*` (radius 2px),
sliders `--slider-*` (thumb accent `--interactive-accent`, track
`--background-modifier-border`), dropdowns `--dropdown-*` (arrow icon, padding),
textareas, selects, date inputs, searchable dropdowns. `.mod-settings` layout is WP7 scope;
only the form controls inside it are styled via the shared input rules here —
no `.mod-settings`-specific selectors in this package.

## WP9 — Reading view, code & typographic elements
Files: `19-preview.css`, `22-code.css`, `11-elements.css` + all `overrides-*/` of those
Preview typography: headings already tokenized — verify rendering, links
`--link-*` (accent, underline thickness, unresolved `--link-unresolved-*`),
inline code `--code-*` on `--background-modifier-hover`, code blocks
`--code-background`/`--code-border-*`/`--code-radius`, callouts `--callout-*`
(radius s, per-type `--color-*` accents, 8% tint bg), tables `--table-*`
(hairlines, header weight +200, selection 2px accent frame, row hover),
footnotes `--footnote-*`, embeds `--embed-*` (2px accent start border),
images/media chrome, horizontal rule `--hr-*`, mark/highlight
`--text-highlight-bg`, frontmatter/property widgets `--metadata-*`.

## WP10 — Graph view
Files: `18-graph.css` + `overrides-*/18-graph.css`
Graph colors are tokenized (`--graph-*`) — restyle controls panel
(`--graph-controls-width`, `--background-secondary` surface, `--radius-m`),
filter UI (inputs WP8 look), legend, zoom controls (`.graph-controls` buttons →
ghost icon buttons per DESIGN.md), node tag colors stay semantic. Canvas
itself is engine-drawn — only DOM chrome here.

## WP11 — Canvas
Files: `21-canvas.css` + `overrides-*/21-canvas.css`
Canvas chrome per DESIGN.md §11: dot grid `--canvas-dot-pattern`, controls
`.canvas-control-group`/`.canvas-card-menu` (basalt-ui already chamfers —
verify unified), node labels `--canvas-card-label-color` (must stay ≥4.5:1 —
currently `--text-faint`; if it fails check.mjs bump to `--text-muted` via a
`--bs-*` token, don't hardcode), edges/selection colors `--canvas-color*`,
card menus, minimap if present.

## WP12 — Data views & platform leftovers
Files: `23-bases.css`, `24-mobile.css`, `04-print.css`, `25-animations.css`,
`05-scrollbars.css`, `01-pdf-viewer.css` + all
`overrides-*/` of those
Bases/tables views: `--bases-*` tokens (header 40px, rows 30px, group headings,
cards `--bases-cards-*` radius→`--radius-m` + chamfer option, selection
`--bases-table-cell-*`). Mobile (`--is-mobile`/`--is-tablet`/`--is-phone`):
touch targets `--touch-size-*` unchanged, mobile menus/headers per recipes.
Print: `04-print.css` keep paper-white overrides, just verify tokens don't
leak wrong colors. Animations: `25-animations.css` retune durations to
`--anim-duration-*`/`--bs-dur-*` values. Scrollbars `05-scrollbars.css`:
webkit scrollbar chrome per §10 (12px, thumb `rgba(--mono-rgb-100,*)`, radius
`--radius-l`). PDF viewer `01-pdf-viewer.css`: viewer chrome colors → tokens,
annotation layer keep functional colors.
