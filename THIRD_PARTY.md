# Third-party components

| Component | Where | License |
|---|---|---|
| Electron | runtime | MIT |
| xterm.js (+ addon-fit) | `src/vendor/` | MIT |
| portable-pty | `pty-helper` | MIT |
| serde_json, crossterm | `cli` | MIT / Apache-2.0 |
| yaml-rust2 | `markdown-engine` (front matter) | MIT / Apache-2.0 |
| Rust standard library, wasm-bindgen-free engines | engines | MIT / Apache-2.0 |
| Inno Setup | installer build | Inno Setup License |
| Inherited application code (`src/app.js`, `src/app.css`, `src/main.js`, starter/help pages, language files) | `src/` | original terms of that application; **not** under this project's MIT license; being replaced, see `docs/CORE-REWRITE.md` |
| Source Code Pro (4 faces) | `src/public/fonts/source-code-pro-*.ttf` | SIL Open Font License 1.1 |
| Inter Variable (regular + italic) | `src/public/fonts/inter-variable*.woff2` | SIL Open Font License 1.1 |
| Flow Circular | `src/public/fonts/flow-circular.woff2` | SIL Open Font License 1.1 (HYPD/flow-typeface) |
| pdf.js viewer chrome styles | `src-css/01-pdf-viewer.css` | Apache-2.0 (Mozilla pdf.js), rewritten |
| CodeMirror 5 + addons (incl. vim mode, dialogs, search) | bundled inside `src/app.js` | MIT (Marijn Haverbeke / CodeMirror contributors) |
| CodeMirror 6 + @codemirror/* (state, view, commands, autocomplete, language, search) | bundled inside `src/app.js` | MIT (Marijn Haverbeke / CodeMirror contributors) |
| Lezer + @lezer/* (parser, common, highlight, markdown) | bundled inside `src/app.js` | MIT (Marijn Haverbeke / CodeMirror contributors) |
| HyperMD-style markdown inline helpers | bundled inside `src/app.js` | MIT (the-simian / HyperMD contributors) |
| moment.js | bundled inside `src/app.js` | MIT (Tim Wood, Iskren Chernev, Moment.js contributors) |
| yaml (eemeli) | bundled inside `src/app.js` | ISC (Eemeli Aro) |
| tslib helpers | bundled inside `src/app.js` | Apache-2.0 (Microsoft) |
| pdf.js rules | bundled inside `src/app.js` | Apache-2.0 (Mozilla) |

| CodeMirror 6 + Lezer | inside inherited `src/app.js` (editor) | MIT |
| CodeMirror 5 modes (incl. `hypermd`) | inside inherited `src/app.js` (`CodeMirror.getMode`) | MIT |
| diff-match-patch | inside inherited `src/app.js` (`dA`) | Apache-2.0 |
| DOMPurify | inside inherited `src/app.js` (publish sanitizing) | Apache-2.0 / MPL-2.0 |

| tslib (`__awaiter` helper, webpack module 9547 inside `src/app.js`) | `src/app.js` | 0BSD |

| CodeMirror 5 + addons (vim, search, dialog, markdown mode) | `src/lib/codemirror/` | MIT |
| CodeMirror 6 / @codemirror/* and @lezer/* (state, view, language, incremental parser) | inside `src/app.js` | MIT |
| Lezer parser runtime (stack, mixed stream, node props, style tables) | inside `src/app.js` | MIT |
| moment.js | inside `src/app.js`, `src/lib/moment.min.js` | MIT |
| yaml (eemeli) | inside `src/app.js` | ISC |
| tslib helpers (`__awaiter`, `__generator`) | inside `src/app.js` | 0BSD |
| i18next | `src/lib/i18next.min.js` | MIT |
| PIXI.js 7.2.4 | `src/lib/pixi.min.js` | MIT |
| Mermaid | `src/lib/mermaid.min.js` | MIT |
| Prism | `src/lib/prism.min.js` | MIT |
| Turndown | `src/lib/turndown.js` | MIT |
| Mozilla Readability | `src/lib/readability.js` | Apache-2.0 |
| d3 | inside `src/app.js` (graph/canvas helpers) | ISC |
| Fuse.js | inside `src/app.js` (search ranking) | Apache-2.0 |
| CryptoJS (`enc.Hex`, `HmacSHA256`; webpack modules 1126/5897/1928 inside `src/app.js`) | inside `src/app.js` (publish password signing) | MIT (Evan Vosberg / Crypto++ project) |

| DOMPurify 3.0.1 (HTML sanitizer inside `src/app.js`) | `src/app.js` application scope | Apache-2.0 OR MPL-2.0 |
| Turndown (HTML → Markdown inside `src/app.js`) | `src/app.js` application scope | MIT |
| CodeMirror 6 packages (`@codemirror/state`, `-view`, `-commands`, `-language`, Lezer; inside `src/app.js`) | `src/app.js` application scope | MIT |

| @codemirror/lint + lint theme (diagnostics panel, gutter markers, tooltips) | inside `src/app.js` bundle (slice s11 items) | MIT |
| @codemirror/merge rebase/change-set helpers (collab module) | inside `src/app.js` bundle (slice s11 items) | MIT |

Public plugin list used by the plugin catalog is read from a public GitHub repository at run time; plugins installed from it keep their own licenses.
| CodeMirror 6, Lezer, @codemirror/* language & lint packages | bundled editor modules in `src/app.js` (webpack module namespaces; consumed via `src-app` env bindings) | MIT |
| tslib helpers (`__awaiter`, `__generator`, `__spreadArray`, ...) | `src/app.js` bundle helpers | Apache-2.0 |
| moment, yaml, pdf.js, capacitor bridges | bundled vendor modules in `src/app.js` / `src/lib` | respective upstream licenses (MIT / Apache-2.0) |
| @replit/codemirror-vim + @replit/codemirror-search-panel (CM6 vim mode, search panel, inside `src/app.js`) | `src/app.js` application scope | MIT |

| Lucide icons | table inside `src/app.js` (icon set used by the interface) | ISC License, Copyright (c) for portions Lucide Contributors; portions derived from Feather (MIT, Cole Bemis). Licence text: https://github.com/lucide-icons/lucide/blob/main/LICENSE |
