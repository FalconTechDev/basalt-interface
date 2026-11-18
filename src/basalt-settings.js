// Basalt settings window: our own, replaces the inherited one. Sections on the left, search across all settings, live changes.
// Modules that still have their own inherited pages (canvas, sync, daily notes...) are reachable from "Модули"; they open in the old window.
(() => {
  "use strict";
  const css = document.createElement("style");
  css.textContent = `
    .bset { width: min(1100px, 94vw); max-width: none; height: min(720px, 88vh); padding: 0; display: flex; flex-direction: row; overflow: hidden; }
    .bset-nav { flex: 0 0 230px; background: var(--background-secondary); border-right: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; padding: 14px 10px; gap: 2px; overflow: auto; }
    .bset-hks { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; justify-content: flex-end; } .bset-hk { display: inline-flex; align-items: center; gap: 4px; } .bset-hk-x { display: inline-flex; width: 14px; height: 14px; cursor: pointer; color: var(--text-faint); } .bset-hk-x:hover { color: var(--text-normal); } .bset-hk-x svg { width: 12px; height: 12px; }
    .bset-ni { display: inline-flex; width: 16px; height: 16px; flex: none; } .bset-ni svg { width: 16px; height: 16px; }
    .bset-find { margin-bottom: 8px; } .bset-find input { width: 100%; }
    .bset-nav button.bset-n { text-align: left; justify-content: flex-start; background: transparent; box-shadow: none; clip-path: none; border-radius: var(--bs-r); padding: 7px 12px; color: var(--text-muted); height: auto; display: flex; align-items: center; gap: 10px; }
    .bset-nav button.bset-n:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .bset-nav button.bset-n.is-on { background: color-mix(in srgb, var(--interactive-accent) 18%, transparent); color: var(--text-normal); box-shadow: inset 2px 0 0 var(--interactive-accent); }
    .bset-nav svg { width: 16px; height: 16px; flex: none; color: var(--interactive-accent); }
    .bset-main { flex: 1; min-width: 0; overflow: auto; padding: 22px 34px 34px; }
    .bset-main h2 { margin: 0 0 14px; font-size: 20px; }
    .bset-main h3 { margin: 22px 0 6px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--text-faint); font-weight: 600; }
    .bset-row { display: flex; align-items: center; gap: 18px; padding: 11px 0; border-bottom: 1px solid var(--background-modifier-border); }
    .bset-row .bset-t { flex: 1; min-width: 0; } .bset-row .bset-t b { display: block; font-weight: 500; } .bset-row .bset-t small { display: block; color: var(--text-muted); margin-top: 2px; line-height: 1.4; }
    .bset-row .bset-c { display: flex; align-items: center; gap: 8px; flex: none; }
    .bset-row input[type=text], .bset-row select { min-width: 190px; }
    .bset-val { min-width: 46px; text-align: right; color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .bset-hk { display: inline-block; padding: 2px 8px; margin-right: 4px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); font-family: var(--font-monospace); font-size: 11px; border-radius: 4px; color: var(--text-muted); }
    .bset-hk.is-rec { border-color: var(--interactive-accent); color: var(--interactive-accent); }
    .bset-empty { color: var(--text-faint); padding: 24px 0; }
    .bset-back { background: transparent; box-shadow: none; clip-path: none; padding: 4px 8px; margin: 0 0 6px -8px; color: var(--text-muted); height: auto; } .bset-back:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
    .bset-legacy .setting-item { display: flex; align-items: center; gap: 18px; padding: 11px 0; border-top: 0; border-bottom: 1px solid var(--background-modifier-border); } .bset-legacy .setting-item-info { flex: 1; } .bset-legacy .setting-item-control { display: flex; gap: 8px; align-items: center; flex: none; } .bset-legacy .setting-item-name { font-weight: 500; } .bset-legacy .setting-item-description { color: var(--text-muted); font-size: var(--font-ui-small); margin-top: 2px; } .bset-legacy .setting-item.setting-item-heading { border: 0; margin-top: 16px; } .bset-legacy .setting-item-heading .setting-item-name { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--text-faint); } .bset-legacy, .bset-legacy .vertical-tab-content, .bset-legacy > div { padding: 0 !important; max-width: 100%; }
    .bset-card { display: inline-flex; flex-direction: column; gap: 4px; width: 210px; margin: 0 10px 10px 0; padding: 12px 14px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);  cursor: pointer; vertical-align: top; }
    .bset-card:hover { border-color: var(--interactive-accent); } .bset-card small { color: var(--text-muted); }
  `;
  document.head.appendChild(css);

  const ICON = {
    gen: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    look: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2 2 2 0 0 1 2-2h2a4 4 0 0 0 4-4A10 10 0 0 0 12 2z"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
    mods: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    about: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cfg = (k) => app.vault.getConfig(k), setCfg = (k, v) => app.vault.setConfig(k, v);

  // ---- control builders: every one returns the element for the right side of a row
  const toggle = (get, set) => { const w = document.createElement("div"); w.className = "checkbox-container" + (get() ? " is-enabled" : ""); const i = document.createElement("input"); i.type = "checkbox"; i.tabIndex = 0; w.appendChild(i); w.addEventListener("click", () => { const v = !w.classList.contains("is-enabled"); w.classList.toggle("is-enabled", v); set(v); }); return w; };
  const select = (opts, get, set) => { const s = document.createElement("select"); s.className = "dropdown"; for (const [v, l] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = l; s.appendChild(o); } s.value = get(); s.addEventListener("change", () => set(s.value)); return s; };
  const text = (get, set, ph) => { const i = document.createElement("input"); i.type = "text"; i.value = get() || ""; i.placeholder = ph || ""; i.spellcheck = false; i.addEventListener("change", () => set(i.value.trim())); return i; };
  const slider = (min, max, step, get, set, fmt) => { const f = document.createDocumentFragment(), r = document.createElement("input"), v = document.createElement("span"); r.type = "range"; r.className = "slider"; r.min = min; r.max = max; r.step = step; r.value = get(); v.className = "bset-val"; v.textContent = fmt(+r.value); r.addEventListener("input", () => { v.textContent = fmt(+r.value); }); r.addEventListener("change", () => set(+r.value)); f.append(r, v); return f; };
  const button = (label, fn, cls) => { const b = document.createElement("button"); b.textContent = label; if (cls) b.className = cls; b.addEventListener("click", fn); return b; };
  const num = (get, set, min, max) => { const i = document.createElement("input"); i.type = "number"; i.min = min; i.max = max; i.value = get(); i.style.width = "70px"; i.addEventListener("change", () => set(Math.max(min, Math.min(max, +i.value || min)))); return i; };

  function build(S) {
    const sec = [];
    const add = (id, title, icon, fn) => sec.push({ id, title, icon, fn });
    const row = (host, title, desc, ctl) => { const r = document.createElement("div"); r.className = "bset-row"; r.dataset.q = (title + " " + (desc || "")).toLowerCase(); r.innerHTML = '<div class="bset-t"><b></b><small></small></div><div class="bset-c"></div>'; r.querySelector("b").textContent = title; const sm = r.querySelector("small"); if (desc) sm.textContent = desc; else sm.remove(); r.querySelector(".bset-c").append(...(Array.isArray(ctl) ? ctl : [ctl])); host.appendChild(r); return r; };
    const head = (host, t) => { const h = document.createElement("h3"); h.textContent = t; host.appendChild(h); };

    add("general", "Общие", "gen", (h) => {
      const sc = window.__bsUiScale;
      if (sc) row(h, "Масштаб интерфейса", "Размер всего текста и элементов. Уменьшите, если всё кажется крупным, или увеличьте для лучшей читаемости.", [slider(70, 150, 5, () => Math.round(sc.get() * 100), (v) => sc.set(v / 100), (v) => v + "%"), button("Сбросить", () => { sc.set(sc.DEF); S.render(); })]);
      row(h, "Язык", "Применяется после перезагрузки окна.", select([["ru", "Русский"], ["en", "English"]], () => { const l = localStorage.getItem("language") || (navigator.language || "ru").split("-")[0]; return l === "ru" ? "ru" : "en"; }, (v) => { localStorage.setItem("language", v); window.__bsConfirm("Перезагрузить окно, чтобы применить язык?").then((ok) => { if (ok) location.reload(); }); }));
      row(h, "Папка хранилища", app.vault.adapter.basePath, button("Открыть в Проводнике", () => window.require("electron").shell.openPath(app.vault.adapter.basePath)));
      row(h, "Показывать ленту слева", "Узкая полоса значков слева.", toggle(() => cfg("showRibbon") !== false, (v) => { setCfg("showRibbon", v); }));
      row(h, "Подтверждать удаление файлов", null, toggle(() => cfg("promptDelete") !== false, (v) => setCfg("promptDelete", v)));
    });

    add("look", "Оформление", "look", (h) => {
      row(h, "Тема", "Тёмная, светлая или как в системе.", select([["system", "Как в системе"], ["basalt", "Тёмная"], ["moonstone", "Светлая"]], () => cfg("theme") || "system", (v) => app.changeTheme(v)));
      row(h, "Акцентный цвет", "Цвет выделения, кнопок и активных элементов.", [(() => { const i = document.createElement("input"); i.type = "color"; i.value = (cfg("accentColor") || "#b07a52"); i.addEventListener("input", () => app.setAccentColor(i.value)); return i; })(), button("Сбросить", () => { app.setAccentColor(""); S.render(); })]);
      row(h, "Размер текста в заметках", null, slider(12, 26, 1, () => cfg("baseFontSize") || 16, (v) => { setCfg("baseFontSize", v); app.updateFontSize(); }, (v) => v + " px"));
      head(h, "Шрифты");
      for (const [k, t] of [["interfaceFontFamily", "Шрифт интерфейса"], ["textFontFamily", "Шрифт текста"], ["monospaceFontFamily", "Моноширинный шрифт"]]) row(h, t, "Название шрифта, установленного в системе. Пусто: по умолчанию.", text(() => cfg(k), (v) => { setCfg(k, v); app.updateFontFamily(); }, "по умолчанию"));
      head(h, "CSS-сниппеты");
      const sn = (app.customCss && app.customCss.snippets) || [];
      if (!sn.length) row(h, "Сниппетов нет", "Положите .css файлы в папку .basalt/snippets хранилища.", button("Обновить", () => { app.customCss.readSnippets && app.customCss.readSnippets(); S.render(); }));
      for (const name of sn) row(h, name, null, toggle(() => app.customCss.enabledSnippets && app.customCss.enabledSnippets.has(name), (v) => app.customCss.setCssEnabledStatus(name, v)));
    });

    add("editor", "Редактор", "edit", (h) => {
      const t = (k, title, desc, def) => row(h, title, desc, toggle(() => (cfg(k) === undefined || cfg(k) === null ? !!def : !!cfg(k)), (v) => setCfg(k, v)));
      row(h, "Режим по умолчанию", "Как открываются заметки.", select([["source", "Редактирование"], ["preview", "Чтение"]], () => cfg("defaultViewMode") || "source", (v) => setCfg("defaultViewMode", v)));
      t("readableLineLength", "Ограничивать ширину строки", "Текст не растягивается на весь экран.", true);
      t("showInlineTitle", "Название заметки над текстом", null, true);
      t("showLineNumber", "Номера строк", null, false);
      t("spellcheck", "Проверка орфографии", null, true);
      t("autoPairBrackets", "Автозакрытие скобок и кавычек", null, true);
      t("foldHeading", "Сворачивание заголовков", null, true);
      t("strictLineBreaks", "Строгие переносы строк", "Одиночный перенос строки в тексте показывается как перенос.", false);
      t("vimMode", "Режим Vim", null, false);
      row(h, "Размер табуляции", null, num(() => cfg("tabSize") || 4, (v) => setCfg("tabSize", v), 1, 12));
      t("useTab", "Табуляция вместо пробелов", null, true);
    });

    add("files", "Файлы и ссылки", "files", (h) => {
      row(h, "Где создавать новые заметки", null, select([["root", "В корне хранилища"], ["current", "В папке открытого файла"], ["folder", "В указанной папке"]], () => cfg("newFileLocation") || "root", (v) => setCfg("newFileLocation", v)));
      row(h, "Папка для новых заметок", "Для варианта «в указанной папке».", text(() => cfg("newFileFolderPath"), (v) => setCfg("newFileFolderPath", v), "Заметки"));
      row(h, "Папка для вложений", "Куда падают вставленные картинки и файлы. «/» — корень.", text(() => cfg("attachmentFolderPath"), (v) => setCfg("attachmentFolderPath", v || "/"), "/"));
      row(h, "Обновлять ссылки при переименовании", null, toggle(() => !!cfg("alwaysUpdateLinks"), (v) => setCfg("alwaysUpdateLinks", v)));
      row(h, "Ссылки в формате Markdown", "[текст](файл.md) вместо [[файл]].", toggle(() => !!cfg("useMarkdownLinks"), (v) => setCfg("useMarkdownLinks", v)));
      row(h, "Путь в ссылках", null, select([["shortest", "Кратчайший"], ["relative", "Относительный"], ["absolute", "Полный"]], () => cfg("newLinkFormat") || "shortest", (v) => setCfg("newLinkFormat", v)));
      row(h, "Удаляемые файлы", null, select([["system", "В корзину системы"], ["local", "В папку .trash"], ["none", "Удалять насовсем"]], () => cfg("trashOption") || "system", (v) => setCfg("trashOption", v)));
      row(h, "Показывать файлы неподдерживаемых типов", null, toggle(() => !!cfg("showUnsupportedFiles"), (v) => setCfg("showUnsupportedFiles", v)));
    });

    add("keys", "Горячие клавиши", "keys", (h) => {
      const hm = app.hotkeyManager, wrap = document.createElement("div"); h.appendChild(wrap);
      const fmt = (k) => [...(k.modifiers || []).map((m) => ({ Mod: "Ctrl", Ctrl: "Ctrl", Meta: "Win", Alt: "Alt", Shift: "Shift" }[m] || m)), (k.key || "").length === 1 ? k.key.toUpperCase() : ({ ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", " ": "Пробел", Backspace: "⌫", Delete: "Del", Enter: "Enter" }[k.key] || k.key)].join(" + ");
      const norm = (k) => [...(k.modifiers || []).map((m) => (m === "Ctrl" ? "Mod" : m)).sort(), (k.key || "").length === 1 ? k.key.toUpperCase() : k.key].join("+");
      const list = () => Object.values(app.commands.commands).filter((c) => c && c.name).sort((a, b) => a.name.localeCompare(b.name));
      const draw = () => {
        wrap.textContent = "";
        const q = (S.query || "").toLowerCase();
        let shown = 0;
        for (const c of list()) {
          if (q && !c.name.toLowerCase().includes(q)) continue;
          if (!q && !(hm.getHotkeys(c.id) || hm.getDefaultHotkeys(c.id) || []).length && shown > 150) continue;
          if (++shown > 220) break;
          const keys = hm.getHotkeys(c.id) || hm.getDefaultHotkeys(c.id) || [];
          const eff = (id) => hm.getHotkeys(id) || hm.getDefaultHotkeys(id) || [];
          const same = (x, y) => norm(x) === norm(y);
          const icon = (el, n) => { try { window.__bsApi.setIcon(el, n); } catch (e) { el.textContent = "×"; } return el; };
          const holder = document.createElement("span"); holder.className = "bset-hks";
          const store = (id, ks) => { hm.setHotkeys(id, ks); hm.bake && hm.bake(); hm.save && hm.save(); };
          const paint = () => {
            holder.textContent = ""; const ks = eff(c.id);
            if (!ks.length) { const n = document.createElement("small"); n.style.color = "var(--text-faint)"; n.textContent = "отключено"; holder.appendChild(n); }
            ks.forEach((k) => { const chip = document.createElement("span"); chip.className = "bset-hk"; const t = document.createElement("span"); t.textContent = fmt(k); const x = icon(document.createElement("span"), "lucide-x"); x.className = "bset-hk-x"; x.title = "Убрать это сочетание"; x.addEventListener("click", () => { store(c.id, eff(c.id).filter((y) => !same(y, k))); paint(); }); chip.append(t, x); holder.appendChild(chip); });
          };
          paint();
          // add one more combination (the old ones stay); one that is already used by another command is taken from it
          const rec = icon(button("", () => {
            const tag = document.createElement("span"); tag.className = "bset-hk is-rec"; tag.textContent = "нажмите сочетание…"; holder.appendChild(tag);
            const on = (e) => {
              if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
              e.preventDefault(); e.stopPropagation(); document.removeEventListener("keydown", on, true);
              if (e.key === "Escape") return paint();
              const mods = []; if (e.ctrlKey) mods.push("Mod"); if (e.metaKey) mods.push("Meta"); if (e.altKey) mods.push("Alt"); if (e.shiftKey) mods.push("Shift");
              const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit[0-9]$/.test(e.code) ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key;
              const nk = { modifiers: mods, key };
              const taken = [];
              for (const o of list()) { if (o.id === c.id) continue; const ks = eff(o.id); if (ks.some((y) => same(y, nk))) { store(o.id, ks.filter((y) => !same(y, nk))); taken.push(o.name); } }
              if (!eff(c.id).some((y) => same(y, nk))) store(c.id, [...eff(c.id), nk]);
              if (taken.length) new window.__bsApi.Notice("«" + fmt(nk) + "» теперь только у «" + c.name + "»; снято у: " + taken.join(", "), 6000);
              draw();
            };
            document.addEventListener("keydown", on, true);
          }), "lucide-plus"); rec.title = "Добавить сочетание"; rec.className = "clickable-icon";
          const off = icon(button("", () => { store(c.id, []); paint(); }), "lucide-ban"); off.title = "Отключить все сочетания"; off.className = "clickable-icon";
          const reset = icon(button("", () => { hm.removeHotkeys && hm.removeHotkeys(c.id); hm.bake && hm.bake(); hm.save && hm.save(); paint(); }), "lucide-rotate-ccw"); reset.title = "Вернуть по умолчанию"; reset.className = "clickable-icon";
          row(wrap, c.name, null, [holder, rec, off, reset]);
        }
        if (!shown) wrap.innerHTML = '<div class="bset-empty">Команды не найдены</div>';
      };
      h.__redraw = draw; draw();
    });

    add("mini", "Мини-функции", "mini", (h) => {
      const mf = window.__bsMiniFeatures; if (!mf) { row(h, "Мини-функции", "Модуль не загружен.", document.createElement("span")); return; }
      head(h, "Картинки");
      mf.section(h, row, toggle, select, text);
    });

    add("plugins", "Плагины", "plug", (h) => {
      row(h, "Каталог плагинов", "Установка из GitHub и из публичного списка сообщества. Плагины на Wasm изолированы.", button("Открыть каталог", () => window.__bsCatalog && window.__bsCatalog.open(), "mod-cta"));
      head(h, "Установленные");
      const man = (app.plugins && app.plugins.manifests) || {};
      const ids = Object.keys(man);
      if (!ids.length) row(h, "Плагинов нет", "Установите их из каталога.", document.createElement("span"));
      for (const id of ids) row(h, man[id].name || id, `${man[id].version || ""} ${man[id].description || ""}`, [toggle(() => app.plugins.enabledPlugins.has(id), (v) => (v ? app.plugins.enablePluginAndSave(id) : app.plugins.disablePluginAndSave(id)))]);
      head(h, "Встроенные модули");
      row(h, "Включение и выключение встроенных модулей", "Холст, ежедневные заметки, шаблоны и другие.", button("Открыть", () => S.legacy("plugins")));
    });

    add("modules", "Модули", "mods", (h) => {
      const tabs = (app.setting.pluginTabs || []);
      const view = document.createElement("div"); view.className = "bset-embed";
      const grid = document.createElement("div");
      const note = document.createElement("div"); note.className = "bset-empty"; note.textContent = ""; grid.appendChild(note);
      const openTab = (t) => {
        grid.style.display = "none"; view.textContent = ""; view.style.display = "";
        const back = document.createElement("button"); back.className = "bset-back"; back.textContent = "Модули"; try { const ic = document.createElement("span"); window.__bsApi.setIcon(ic, "lucide-arrow-left"); back.prepend(ic); } catch (e) { /* ok */ } back.addEventListener("click", () => { try { t.hide && t.hide(); } catch (e) { /* ok */ } view.style.display = "none"; grid.style.display = ""; });
        const title = document.createElement("h2"); title.textContent = t.name; view.append(back, title);
        const box = document.createElement("div"); box.className = "bset-legacy vertical-tab-content"; view.appendChild(box);
        // the module draws its own page into a container; it is placed here and restyled by .bset-legacy
        try { const c = t.containerEl || document.createElement("div"); c.textContent = ""; box.appendChild(c); t.display(); } catch (e) { box.textContent = "Не удалось показать страницу: " + e.message; }
      };
      for (const t of tabs) row(grid, t.name || t.id, "", button("Открыть", () => openTab(t)));
      view.style.display = "none"; h.append(grid, view);
      if (pendingTab) { const t = tabs.find((x) => x.id === pendingTab); pendingTab = null; if (t) openTab(t); }
    });

    add("about", "О программе", "about", (h) => {
      row(h, "Basalt", "Версия 0.1.0", button("GitHub", () => window.require("electron").shell.openExternal("https://github.com/FalconTechDev/basalt")));
      if (window.__bsUpdate) row(h, "Обновления", "Проверка новой версии на GitHub.", [button("Проверить сейчас", () => window.__bsUpdate.check(true)), toggle(() => window.__bsUpdate.auto(), (v) => window.__bsUpdate.setAuto(v))]);
      head(h, "Автоматизация");
      const info = window.__bsApiInfo;
      row(h, "Локальный API", info ? `http://127.0.0.1:${info.port}` : "не запущен", info ? button("Скопировать токен", () => { navigator.clipboard.writeText(info.token); new window.__bsApi.Notice("Токен скопирован"); }) : document.createElement("span"));
      row(h, "Командная строка", "Команда basalt-cli в терминале: оболочка со списком команд. basalt-cli daemon start запускает Basalt без окна.", document.createElement("span"));
      head(h, "Данные");
      row(h, "Журнал действий", "Что и где менялось в хранилище.", button("Открыть", () => window.__vaultSyncFeed && window.__vaultSyncFeed()));
      row(h, "Папка настроек хранилища", ".basalt внутри хранилища: темы, плагины, горячие клавиши.", button("Показать", () => window.require("electron").shell.openPath(app.vault.adapter.basePath + "/.basalt")));
    });
    return sec;
  }

  let open = null, stockOpen = null;
  let pendingTab = null;
  function show(startId) {
    if (open) { open.go(startId); return; }
    const wrap = document.createElement("div"); wrap.className = "modal-container mod-dim";
    wrap.innerHTML = '<div class="modal-bg"></div><div class="modal bset"><div class="modal-close-button"></div><div class="bset-nav"><div class="bset-find"><input type="text" placeholder="Поиск по настройкам…" spellcheck="false"></div></div><div class="bset-main"></div></div>';
    const nav = wrap.querySelector(".bset-nav"), main = wrap.querySelector(".bset-main"), input = wrap.querySelector("input");
    const prev = document.activeElement; const S = { query: "", cur: "general", render: () => draw(), legacy: (id) => { close(); try { window.__bsStock = true; app.setting.open(); app.setting.openTabById(id); } finally { setTimeout(() => { window.__bsStock = false; }, 300); } } };
    const secs = build(S);
    const btns = secs.map((s) => { const b = document.createElement("button"); b.className = "bset-n"; b.innerHTML = "<i class=\"bset-ni\"></i><span></span>"; { const L = { gen: "settings", look: "palette", edit: "pen-line", files: "folder", keys: "keyboard", mods: "blocks", mini: "wand-sparkles", plug: "plug", about: "info" }[s.icon]; try { window.__bsApi.setIcon(b.firstChild, "lucide-" + L); } catch (e) { b.firstChild.innerHTML = svg(s.icon); } } b.lastChild.textContent = s.title; b.addEventListener("click", () => { S.query = ""; input.value = ""; S.cur = s.id; draw(); }); nav.appendChild(b); return [s.id, b]; });
    function draw() {
      const q = input.value.trim().toLowerCase(); S.query = q; main.textContent = "";
      btns.forEach(([id, b]) => b.classList.toggle("is-on", !q && id === S.cur));
      const shown = q ? secs : secs.filter((s) => s.id === S.cur);
      for (const s of shown) {
        const box = document.createElement("div"); const h2 = document.createElement("h2"); h2.textContent = s.title; box.appendChild(h2);
        const body = document.createElement("div"); box.appendChild(body); s.fn(body);
        if (q) { let any = false; body.querySelectorAll(".bset-row, .bset-card").forEach((r) => { const hit = (r.dataset.q || "").includes(q); r.style.display = hit ? "" : "none"; any = any || hit; }); body.querySelectorAll("h3").forEach((h) => { h.style.display = "none"; }); if (!any) continue; }
        main.appendChild(box);
      }
      if (!main.children.length) main.innerHTML = '<div class="bset-empty">Ничего не найдено</div>';
    }
    input.addEventListener("input", draw);
    const close = () => { wrap.remove(); open = null; document.removeEventListener("keydown", key, true); try { prev && prev.focus && prev.focus(); } catch (e) { /* gone */ } };
    const key = (e) => { if (e.key === "Escape" && !document.querySelector(".bset-hk.is-rec")) { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener("keydown", key, true);
    wrap.querySelector(".modal-close-button").addEventListener("click", close); wrap.querySelector(".modal-bg").addEventListener("click", close);
    document.body.appendChild(wrap); open = { go: (id) => { S.cur = id || S.cur; draw(); } }; if (startId) S.cur = startId; draw(); input.focus();
  }

  const t = setInterval(() => {
    if (!(window.app && app.setting && app.commands && app.workspace && app.workspace.layoutReady && window.__bsApi)) return;
    clearInterval(t);
    stockOpen = app.setting.open.bind(app.setting);
    // every way into the settings (command, gear, status bar) opens ours; the old window only for the pages that are not ported
    app.setting.open = function (...a) { if (window.__bsStock) return stockOpen(...a); show(); };
    const c = app.commands.commands["app:open-settings"]; if (c) { delete c.checkCallback; c.callback = () => show(); }
    // a module asking for its own page (the sync status bar, a command) lands on it, not on the first page
    const stockById = app.setting.openTabById.bind(app.setting);
    app.setting.openTabById = function (id) { if (window.__bsStock) return stockById(id); const t = (app.setting.pluginTabs || []).find((x) => x.id === id); if (t) { pendingTab = id; show("modules"); return; } return stockById(id); };
    window.__bsSettings = { show };
  }, 600);
})();
