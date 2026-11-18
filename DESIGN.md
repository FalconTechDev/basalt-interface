# Basalt design language (stage 0)

Basalt is a dark-first, volcanic note app. The interface gets its own visual
language: warm near-black surfaces, a copper accent, square geometry and one
signature motif — the **chamfer** (a 45-degree cut corner, the basalt column).
The DOM, class names, existing CSS variable names and the plugin API do not
change. Everything below is expressed by overriding the existing variables
(listed per section) plus a small set of new `--bs-*` tokens defined in
`src-css/03-tokens.css`.

## 1. Colour system

### Neutrals — warm basalt ramp (12 steps)

The ramp is warm (hue ~30, near-zero chroma) so every grey carries a hint of
copper. Steps keep their Obsidian-derived roles:

| token | dark | light | role |
|---|---|---|---|
| `--color-base-00` | `#14110f` | `#ece7dd` | app background (`--background-primary`), `--interactive-normal` |
| `--color-base-05` | `#1a1512` | `#eae4d8` | `--background-secondary-alt` (light) |
| `--color-base-10` | `#1f1a15` | `#e4dccd` | `--background-primary-alt`, hover base |
| `--color-base-20` | `#251e18` | `#dcd2c3` | `--background-secondary` (panels, ribbon, tabs, status bar) |
| `--color-base-25` | `#2b231c` | `#d5c9b6` | form fields (dark) |
| `--color-base-30` | `#332a22` | `#cdbfae` | hairline borders, `--interactive-normal` (dark), `--background-secondary-alt` (dark) |
| `--color-base-35` | `#3d3227` | `#c0ae97` | `--interactive-hover` (dark), strong borders |
| `--color-base-40` | `#4f3d2c` | `#96795a` | focus borders, `--modal-border-color` |
| `--color-base-50` | `#8f8072` | `#655847` | `--text-faint` |
| `--color-base-60` | `#96836d` | `#5b4d40` | mid grey (graphs, misc) |
| `--color-base-70` | `#a79a8d` | `#4f4235` | `--text-muted` |
| `--color-base-100` | `#ece4db` | `#2a211a` | `--text-normal` |

Note: `src/basalt-ui.js` (APP_CSS/THEME_CSS) currently pins the shipped
surface hexes and text steps on `body.theme-*` at runtime — values there match
this ramp after the contrast pass (dark faint `#8f8072`, light faint `#655847`,
light muted `#5c4f42`, dark muted `#a79a8d`); component packages fold any
remaining literals into tokens.

Derived (already mapped, unchanged): `--background-primary/-alt/-secondary`,
`--background-modifier-border(-hover/-focus)`, `--interactive-hover/-normal`,
`--text-normal/-muted/-faint`, `--menu-background`, `--ribbon-background`,
`--status-bar-background`, `--tab-container-background`, `--modal-background`,
`--suggestion-background`, `--dropdown-*`.

### Accent — copper ramp

Accent is set per theme through `--accent-h/s/l` (plugins can still override via
`setAccentColor`, which writes the same properties on `<body>`):

- dark: `hsl(27, 50%, 57%)` = `#c98d5b` — the signature copper.
- light: `hsl(27, 50%, 34%)` = `#85502a` — deeper copper, ≥4.5:1 on paper.

Derived steps (existing formulas): `--color-accent-1` = hover/pressed lighten,
`--color-accent-2` = stronger; `--interactive-accent`/`-hover`,
`--text-accent`/`-hover`, `--link-color`, `--tag-*`, `--table-selection`,
`--text-selection`, callout accents all follow automatically.

New tokens (per theme, in `03-tokens.css`):

- `--bs-accent` = `var(--interactive-accent)`
- `--bs-accent-hover` = `var(--interactive-accent-hover)`
- `--bs-accent-press` = `color-mix(in srgb, var(--interactive-accent) 82%, #000)` (dark) / `color-mix(in srgb, var(--interactive-accent) 88%, #000)` (light)
- `--bs-accent-soft` = `color-mix(in srgb, var(--interactive-accent) 16%, transparent)` — tinted row/tag background
- `--bs-on-accent` = dark `#1f130a` on copper, light `#ffffff` on deep copper (= `--text-on-accent`)

### Semantic colours

Kept recognizable, harmonized with the warm ramp. Dark: blue `#5b9dff`,
cyan `#53dfdd`, green `#44cf6e`, orange `#e9973f`, pink `#fa99cd`,
purple `#a882ff`, red `#fb464c`, yellow `#e6c86a` (each with `-rgb` triplet).
Light: blue `#1f5fc9`, cyan `#00a8a5`, green `#07913f`, orange `#d96f00`,
pink `#c22a72`, purple `#6a48e0`, red `#d81f36`, yellow `#b89100`.
Mapped to `--color-*` (used by `--text-error/-success/-warning`, code
highlighting, callouts `--callout-*`, graph `--graph-node-*`, sync avatars).
`--text-highlight-bg-rgb` stays `255, 208, 0` (marker yellow).

## 2. Typography

Families (unchanged plumbing): UI `--font-interface` → Inter Variable (bundled,
`src/public/fonts`) with the system stack fallback `--font-default`; code
`--font-monospace`; reading text `--font-text`. Sizes stay where JS may measure
them; the scale is:

| role | token | value |
|---|---|---|
| UI large (view titles, hero) | `--font-ui-large` | 20px / 1.3 / 600 |
| UI medium (body UI, default) | `--font-ui-medium` | 15px / 1.4 / 400 |
| UI small (nav, tabs, lists) | `--font-ui-small` | 13px / 1.35 / 400 |
| UI smaller (status bar, metadata) | `--font-ui-smaller` | 12px / 1.3 / 400 |
| reading text | `--font-text-size` | 16px / `--line-height-normal` 1.5 |
| code | `--code-size` | `--font-smaller` (0.875em) |

Relative steps: `--font-small` 0.933em, `--font-smaller` 0.875em,
`--font-smallest` 0.8em. Weights: `--font-normal` 400, `--font-medium` 500,
`--font-semibold` 600, `--font-bold` 700; headings use `--h1..--h6-weight`
(700/680/660/640/620/600 with variable fonts). Heading scale unchanged:
h1 1.618em lh 1.2 ls -0.015em down to h6 1em; `--heading-spacing`
`calc(var(--p-spacing) * 2.5)`. Mono never goes below `--font-ui-smaller`.

## 3. Spacing — 4px base

`--size-4-N` = N×4px (4-1:4, 4-2:8, 4-3:12, 4-4:16, 4-5:20, 4-6:24, 4-8:32,
4-9:36, 4-10:40, 4-12:48, 4-16:64, 4-18:72); `--size-2-N` = N×2px for hairline
gaps. Component padding uses these tokens (`--nav-item-padding`,
`--menu-padding`, `--setting-items-padding`, `--callout-padding`). Optical
correction: icon-to-label gap is always `--size-4-2` (8px); dense rows use
`--size-4-1` (4px) vertical.

## 4. Radii & the chamfer

Square-ish scale — corners are nearly sharp; the chamfer is the signature:

| token | value | used by |
|---|---|---|
| `--radius-s` | 0px | rows, code blocks, small chips (`--nav-item-radius`, `--code-radius`, `--footnote-radius`, `--embed-*`) |
| `--radius-m` | 2px | menus, scrollbars, status bar (`--menu-radius`, `--scrollbar-radius`, `--status-bar-radius`) |
| `--radius-l` | 4px | modals, raised surfaces (`--modal-radius`, `--setting-items-radius`) |
| `--radius-xl` | 6px | large floating previews (`--tab-switcher-preview-radius`) |
| `--input-radius` | 4px | inputs, buttons (`--button-radius`) |
| `--corner-shape` | `bevel` | progressive 45° chamfer where `border-corner-shape` is supported (88 call sites); unsupported engines fall back to round |
| `--tag-corner-shape`, `--pill-radius` | `round` / `2em` | pills and tags stay pill-shaped deliberately |

Chamfer tokens for clip-path work (later packages): `--bs-cut-sm` 4px,
`--bs-cut-md` 8px, `--bs-cut-lg` 12px. Recipe: `clip-path: polygon(var(--bs-cut-md) 0, 100% 0, 100% calc(100% - var(--bs-cut-md)), calc(100% - var(--bs-cut-md)) 100%, 0 100%, 0 var(--bs-cut-md))` — cut ONE corner pair (top-left + bottom-right) or mirror for symmetry; never round.

## 5. Borders & hairlines

`--border-width` 1px everywhere; `--divider-width` 1px, hover 3px accent.
Hairlines use `--background-modifier-border` = `--color-base-30`
(dark `#332a22`, light `#cdbfae`) — visible but quiet. Emphasis borders use
`--background-modifier-border-hover` (`--color-base-35`) and focus
`--background-modifier-border-focus` (`--color-base-40`). Tables:
`--table-border-width` 1px, `--table-selection-border-width` 2px accent.
No border-radius fights: borders are square, radius comes only from §4.

## 6. Elevation

Three shadow steps (`--shadow-xs/-s/-l`), warm-tinted, border-first: surfaces
are separated by hairlines; shadows only for floating layers (menus
`--menu-shadow: var(--shadow-s)`, modals `--modal-shadow`, popovers,
`--raised-shadow: var(--shadow-xs)`, `--tab-stacked-shadow`).

- dark: xs `0 1px 2px rgba(0,0,0,.5), 0 4px 16px rgba(0,0,0,.4)`;
  s adds `0 12px 32px rgba(0,0,0,.35)`; l `0 24px 64px rgba(0,0,0,.4)`.
- light: same geometry with `rgba(42,33,26,…)` at .06–.10 alpha.

Inputs keep inset shadows (`--input-shadow`, `--input-shadow-hover`) tuned per
theme. `--background-modifier-box-shadow`: `rgba(0,0,0,.3)` dark /
`rgba(42,33,26,.1)` light.

## 7. Motion

Durations (`--anim-duration-*`): superfast 60ms, fast 120ms, moderate 220ms,
slow 420ms, none 0. Easings (`--anim-motion-*`): smooth
`cubic-bezier(.45,.05,.55,.95)` for state fades, swing `cubic-bezier(0,.55,.45,1)`
for reveals, jumpy kept for playful micro-motion, delay curve unchanged.
New aliases for component work: `--bs-dur-instant` 60ms, `--bs-dur-fast` 120ms,
`--bs-dur-normal` 200ms, `--bs-dur-slow` 360ms; `--bs-ease-standard`
`cubic-bezier(.2,0,0,1)`, `--bs-ease-emphasized` `cubic-bezier(.3,0,.2,1)`.
Nothing loops; hover/press transitions use fast/instant only.

## 8. Density & layout

Desktop density: `--header-height` 40px, `--titlebar-height` 30px,
`--input-height` 30px, `--status-bar` font `--font-ui-smaller`,
`--nav-item-size` `--font-ui-small`, `--file-line-width` 700px reading column,
`--bases-table-row-height` 30px, `--bases-header-height` 40px,
`--ribbon-width` 44px, `--dialog-width` 560px, `--modal-width` 90vw /
`--modal-max-width` 1100px. Mobile tokens (`--touch-size-*`, `--is-mobile`)
unchanged.

## 9. Iconography

Icons are stroke-only on a 24 viewBox, `stroke: currentColor`,
`stroke-width` from `--icon-*-stroke-width` (m/l 1.75px, s/xs 2px, xl 1.25px),
`stroke-linecap: square`, `stroke-linejoin: miter` — matching the basalt icon
language (only horizontals, verticals, exact 45° diagonals, 2-unit chamfers).
Sizes: `--icon-xs` 14, `--icon-s`/`--icon-m` 16–18, `--icon-l` 18,
`--icon-xl` 32. Colors: `--icon-color` `--text-muted`, hover/focused
`--text-normal`, active `--text-accent`; `--icon-opacity` .85 → 1 on hover.
The Lucide table is being replaced by the own icon set (parallel task); this
layer only fixes size/stroke tokens.

## 10. Focus, selection, scrollbars

- Focus ring: `--focus-ring-color` = copper `light-dark(#8a5a26, #e0a96f)`,
  `--focus-ring-outline` `2px solid`; input focus adds
  `--input-border-width-focus` 2px + `--background-modifier-border-focus`.
- Text selection: `--text-selection` = accent @ .2 (dark .33);
  `--text-highlight-bg` marker yellow `rgba(255,208,0,.4)`.
- Caret: `--caret-color` = `--text-normal`.
- Scrollbars: 12px (`--scrollbar-width/height`), thumb
  `rgba(--mono-rgb-100, .1/.2)` on `rgba(--mono-rgb-100, .05)` track,
  `--scrollbar-radius` `--radius-l`.
- `color-scheme: light dark` per theme; `--csstools-color-scheme--dark` kept
  for pdf.js.

## 11. Component recipes (exact values)

**Buttons** (`--button-radius` = `--input-radius` 4px): primary =
`--interactive-accent` bg + `--bs-on-accent` text + `--bs-cut-md` chamfer
(clip-path, top-left/bottom-right cut); hover `--interactive-accent-hover`;
press `--bs-accent-press`; disabled opacity .45, no shadow. Secondary/ghost =
transparent bg, `--text-muted` → `--text-normal` on `--background-modifier-hover`,
1px `--background-modifier-border`. Danger = `--color-red` family.
Ghost icon buttons: `--clickable-icon-radius` `--radius-s`, hover bg
`--background-modifier-hover`, icon `--icon-color` → `--text-normal`.

**Inputs**: `--input-height` 30px, `--input-padding` `--size-4-1 --size-4-2`,
radius 4px, bg `--background-modifier-form-field`, border
`--input-border-width` 1px `--background-modifier-border`, shadow
`--input-shadow`; hover border `-hover`; focus border 2px accent +
`--background-modifier-border-focus`; placeholder `--text-faint`.

**Toggles**: track `--toggle-width` 40px / `--toggle-s-width` 34px, height via
thumb 18/15px, radius `--toggle-radius` 18px (pill is intentional), on-state
`--interactive-accent`, thumb `--toggle-thumb-color` white (dark theme) /
`#fff` (light); border `--toggle-border-width` 2px
`--background-modifier-border-hover`.

**Dropdowns/menus**: bg `--menu-background` (`--background-secondary` dark /
`--interactive-normal` light), border `--menu-border-color`
`--background-modifier-border-hover`, radius `--radius-m` 2px, padding
`--menu-padding` `--size-2-3`, shadow `--shadow-s`, item height ~28px,
selected item `--bs-accent-soft` bg + `--text-accent` text or inset
`box-shadow: inset 2px 0 0 var(--interactive-accent)` (Basalt pattern already
used in settings nav).

**Tabs**: container `--tab-container-background` `--background-secondary`,
active tab `--tab-background-active` `--background-primary` blending into the
pane, text `--tab-text-color` `--text-muted` (inactive tabs sit on the darker tab rail — faint failed 4.5:1) → active `--text-muted`,
current `--text-normal`, highlighted `--text-accent`; `--tab-radius` s,
`--tab-radius-active` 6px 6px 0 0, divider `--tab-divider-color`
`--background-modifier-border-hover`.

**View header**: `--header-height` 40px, title `--font-ui-medium` 600
`--text-normal`, actions `--clickable-icon` 18px icons; border-bottom 1px
`--background-modifier-border` (Basalt override already applies).

**Sidebar / file explorer**: width free, bg `--background-primary` (or
`--background-secondary` for ribbon), `--nav-item-padding`
`--size-4-1 --size-4-2 --size-4-1 --size-4-6`, radius `--radius-s` 0,
color `--nav-item-color` `--text-muted` → hover/active `--text-normal`,
selected bg `hsla(accent,.15)` + `--text-normal`, heading
`--nav-heading-weight` 500 `--text-normal`, indent guides
`--indentation-guide-color` `rgba(--mono-rgb-100,.12)`.

**Menus (context)**: as dropdowns + `--menu-scroll-mask` fade, separators
`--divider-color`, destructive items `--text-error`.

**Modals**: bg `--modal-background` `--background-primary`, border 1px
`--modal-border-color` (`--color-base-40`), radius `--radius-l` 4px +
`--bs-cut-md` chamfer on the frame (settings already does `--bs-cut:12px`),
shadow `--shadow-l` or none + strong border (Basalt prefers border), header
`--modal-header-height` auto, width `--modal-width` 90vw max 1100px.

**Tooltips/notices**: tooltip bg `--background-modifier-message`-style dark
plate `rgba(20,16,13,.92)` + 1px `--background-modifier-border-hover`,
radius `--radius-m`, text `--text-normal` 12px; notices top-center,
`--layer-notice` 60, accent bar `inset 3px 0 0 var(--interactive-accent)` for
warnings, `--color-red` for errors.

**Search bar / command palette**: input as Inputs; result rows as nav items;
active result `--bs-accent-soft` + `--text-normal`; palette modal per Modals
with `--prompt-width` 700px.

**Settings rows**: group heading `--setting-group-heading-size`
`--font-ui-medium` 600 `--text-normal`; items container
`--setting-items-background` `--background-primary-alt`, radius `--radius-l`,
padding `--setting-items-padding` `--size-4-5`; row label
`--font-ui-small` `--text-normal`, description `--text-muted`, control right.

**Status bar**: bg `--status-bar-background` `--background-secondary`, top
border `--status-bar-border-width`, text `--status-bar-text-color`
`--text-muted` 12px, items gap `--size-4-2`.

**Canvas chrome**: bg `--canvas-background` `--background-primary`, dot grid
`--canvas-dot-pattern` `--color-base-30`, controls `--canvas-controls-radius`
`--radius-s`, icon `--icon-s`; cards label `--canvas-card-label-color`
`--text-faint`.

**Graph controls**: panel `--background-secondary` + hairline, node
`--graph-node` `--text-muted`, focused `--text-accent`, tags `--color-green`,
attachments `--color-yellow`, unresolved `--text-faint`, lines
`--graph-line` `--color-base-35`, labels `--graph-text` `--text-normal`,
controls width `--graph-controls-width` 240px, radius `--radius-m`.

**Scrollbars**: §10 — 12px, hairline-track thumbs, `--radius-l`.

**Code blocks / callouts / tables (reading view)**: code bg
`--code-background` `--background-primary-alt`, border
`--code-border-color` `--background-modifier-border`, radius
`--code-radius` (`--radius-s`), inline code `--background-modifier-hover`;
callouts `--callout-radius` `--radius-s`, padding `--callout-padding`,
per-type color from `--callout-*` semantic tokens, bg tint
`color-mix(in srgb, <callout-rgb> 8%, transparent)`; tables §5 — header
`--table-header-color` `--text-normal` +200 weight, row hover
`--table-row-background-hover`, selection `--table-selection` accent @ .1
with 2px `--table-selection-border-color` accent frame.

## 12. What must not change

Class names, selectors, DOM structure, the plugin API (`setIcon`, `addIcon`,
`setAccentColor`, theme variables), every existing variable NAME (only values
change), sizes JS measures (`--header-height`, `--input-height`, row heights),
`--font-*`/`--size-*` names. New tokens are additive (`--bs-*`).
