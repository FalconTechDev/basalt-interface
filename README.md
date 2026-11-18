# Basalt interface pack

Everything that makes up the interface, from the repository (branch main), in one place. The Electron main process (src/main.js, stub/main.js) and the engines are NOT here: they are already our own code.

## Map
- `src-css/` — the SOURCE of all styles: `03-tokens.css` (theme variables: the design language), numbered files = components (01-pdf-viewer ... 25-animations), `overrides-*/` = layers that must stay after other components. `build-css.mjs` builds them into `src/app.css` (`node build-css.mjs`, needs `npm i postcss` in tools/).
- `src/app.css` — the built stylesheet the app loads.
- `src/index.html` — the page shell and the order in which scripts load.
- `src/basalt-*.js` — Basalt's own interface scripts (titlebar, tabs, home page, palette, search, settings, graphs, terminal, git, canvas preview, menus...). `basalt-ui.js` injects the runtime theme/CSS overrides.
- `src/starter.*`, `src/help.*` — the start window and the help window.
- `src/public/fonts` — Inter and the other bundled fonts (SIL OFL).
- `src/i18n.js`, `src/i18n-ru.js` — the interface strings (English tree, Russian tree).
- `src-app/` — the readable source of the application code that builds the DOM: views, modals, menus, settings tabs, editor and canvas UI, ribbon, status bar, workspace. Modules `n-*` are the clean-room rewrites (already ours); the rest is still being redone. These are spliced into `src/app.js` by `build-app.mjs` (see `docs/APP-MAP.md`). To change what a screen looks like you edit the module that creates its DOM plus the css of that component.
- `DESIGN.md` — the design language (tokens, type, spacing, recipes per component). `COMPONENT-PLAN.md` — how the restyle was split into packages. `shots/` — screenshots of the current look (dark and light).

## Rules of the game
Class names, CSS variable names and the plugin API are contracts (community themes and plugins rely on them); you may restyle freely but renaming them breaks compatibility. The icon set is Lucide (ISC licence, see THIRD_PARTY.md).
