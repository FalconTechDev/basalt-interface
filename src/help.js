// Help window: a short guide to Basalt. The text is kept here, in English and Russian.
(() => {
	'use strict';
	const { shell } = require('electron');
	const ru = (localStorage.getItem('language') || navigator.language || 'en').toLowerCase().startsWith('ru');
	const pick = (x) => (ru ? x.ru : x.en);

	const SECTIONS = [
		{
			h: { en: 'Getting started', ru: 'Начало' },
			p: [
				{ en: 'A vault is a folder. Your notes, canvases and files stay as plain files in it; nothing is locked into the app.', ru: 'Хранилище — это папка. Заметки, холсты и файлы остаются обычными файлами, ничего не заперто в приложении.' },
				{ en: 'Create a vault or open any folder from the start window. The sandbox is a small vault with examples.', ru: 'Создайте хранилище или откройте любую папку в стартовом окне. Песочница — небольшое хранилище с примерами.' },
			],
		},
		{
			h: { en: 'Notes and links', ru: 'Заметки и ссылки' },
			ul: [
				{ en: 'Notes are Markdown. Link notes with <b>[[Note name]]</b>; tags look like <b>#tag</b>.', ru: 'Заметки — это Markdown. Ссылки между заметками: <b>[[Название]]</b>, теги: <b>#тег</b>.' },
				{ en: 'The side panels show backlinks, outgoing links, tags and the outline of the open note.', ru: 'Боковые панели показывают обратные и исходящие ссылки, теги и структуру открытой заметки.' },
				{ en: 'The first lines between <b>---</b> are properties of the note.', ru: 'Первые строки между <b>---</b> — свойства заметки.' },
			],
		},
		{
			h: { en: 'Search', ru: 'Поиск' },
			ul: [
				{ en: '<b>Quick search</b> finds notes by words, with typos and word starts. Filters: <b>path:</b> <b>file:</b> <b>tag:</b> <b>ext:</b>.', ru: '<b>Быстрый поиск</b> находит заметки по словам, с опечатками и по началу слова. Фильтры: <b>path:</b> <b>file:</b> <b>tag:</b> <b>ext:</b>.' },
				{ en: '<b>Find in files</b> searches the text of every file and can replace in all matches, with a confirmation.', ru: '<b>Поиск по файлам</b> ищет по тексту всех файлов и умеет заменять во всех совпадениях, с подтверждением.' },
			],
		},
		{
			h: { en: 'Graph', ru: 'Граф' },
			ul: [
				{ en: 'The graph shows notes and their links in 2D or 3D. <b>Files</b> shows folders and files, <b>Code</b> shows functions, imports and calls.', ru: 'Граф показывает заметки и связи в 2D или 3D. <b>Файлы</b> — папки и файлы, <b>Код</b> — функции, импорты и вызовы.' },
				{ en: 'Search finds names and text. Right click a node to hide it, focus on it, pin it or mark it with a colour.', ru: 'Поиск находит имена и текст. Правый клик по узлу: скрыть, показать только его окружение, закрепить, пометить цветом.' },
				{ en: 'The gear opens the settings of the graph.', ru: 'Шестерёнка открывает настройки графа.' },
			],
		},
		{
			h: { en: 'Canvas', ru: 'Холст' },
			ul: [
				{ en: 'A canvas is an endless board of cards (notes, pictures, web pages, code) joined by links.', ru: 'Холст — бесконечная доска с карточками (заметки, картинки, страницы, код), соединёнными связями.' },
				{ en: 'Press <b>Alt+D</b> to draw by hand; a pause at the end of a stroke straightens the shape.', ru: '<b>Alt+D</b> включает рисование от руки; пауза в конце штриха выравнивает фигуру.' },
				{ en: 'The minimap in the corner shows the whole board.', ru: 'Мини-карта в углу показывает всю доску.' },
			],
		},
		{
			h: { en: 'Terminal and running code', ru: 'Терминал и запуск кода' },
			ul: [
				{ en: 'The terminal opens in a tab, under the editor or on a canvas card.', ru: 'Терминал открывается во вкладке, под редактором или на карточке холста.' },
				{ en: '<b>F5</b> runs the open code file; code blocks have a run button. Runs are limited in time and isolated by process.', ru: '<b>F5</b> запускает открытый файл с кодом; у блоков кода есть кнопка запуска. Запуск ограничен по времени и выполняется в отдельном процессе.' },
			],
		},
		{
			h: { en: 'History and sync', ru: 'История и синхронизация' },
			ul: [
				{ en: 'The <b>action log</b> records almost every change; you can undo one action or roll the vault back to a moment.', ru: '<b>Журнал действий</b> записывает почти каждое изменение; можно отменить одно действие или вернуть хранилище к моменту.' },
				{ en: 'Sync uses git: connect a repository in the settings. Your edits are committed and pushed, others are pulled; conflicts stop syncing until you resolve them.', ru: 'Синхронизация работает через git: подключите репозиторий в настройках. Ваши правки коммитятся и отправляются, чужие забираются; конфликт останавливает синхронизацию, пока вы его не решите.' },
			],
		},
		{
			h: { en: 'Command line', ru: 'Командная строка' },
			ul: [
				{ en: '<b>basalt-cli</b> is a shell with completion; <b>basalt &lt;command&gt;</b> runs one command in the running app.', ru: '<b>basalt-cli</b> — оболочка с автодополнением; <b>basalt &lt;команда&gt;</b> выполняет одну команду в запущенном приложении.' },
				{ en: 'A local API for scripts listens on 127.0.0.1 and needs a token (Settings, About).', ru: 'Локальный API для скриптов слушает 127.0.0.1 и требует токен (Настройки, О программе).' },
			],
		},
		{
			h: { en: 'Plugins', ru: 'Плагины' },
			ul: [
				{ en: 'Install plugins from GitHub in the catalog (Settings, Plugins). WebAssembly plugins run isolated and get only the permissions you approve.', ru: 'Плагины ставятся из GitHub в каталоге (Настройки, Плагины). Плагины на WebAssembly изолированы и получают только разрешённое вами.' },
			],
		},
	];

	const KEYS = [
		['Ctrl+O', { en: 'Quick switcher: open a note or file by name', ru: 'Быстрый переход: открыть заметку или файл по имени' }],
		['Ctrl+Shift+O', { en: 'Quick search in notes', ru: 'Быстрый поиск по заметкам' }],
		['Ctrl+P', { en: 'Command palette', ru: 'Палитра команд' }],
		['Ctrl+Shift+F', { en: 'Find in files', ru: 'Поиск по файлам' }],
		['Ctrl+N', { en: 'New note', ru: 'Новая заметка' }],
		['Ctrl+G', { en: 'Graph', ru: 'Граф' }],
		['Alt+D', { en: 'Draw on a canvas', ru: 'Рисование на холсте' }],
		['F5', { en: 'Run the open code file', ru: 'Запустить открытый файл с кодом' }],
		['Ctrl+Z / Ctrl+Y', { en: 'Undo / redo', ru: 'Отменить / повторить' }],
	];

	const page = document.createElement('div');
	page.className = 'page help';
	const brand = document.createElement('div');
	brand.className = 'brand';
	brand.innerHTML = '<img src="basalt-logo.png" alt=""><div><h1>Basalt</h1><small></small></div>';
	brand.querySelector('small').textContent = pick({ en: 'Help', ru: 'Справка' });
	page.append(brand);

	for (const s of SECTIONS) {
		const h = document.createElement('h2');
		h.textContent = pick(s.h);
		page.append(h);
		for (const p of s.p || []) { const e = document.createElement('p'); e.innerHTML = pick(p); page.append(e); }
		if (s.ul) { const ul = document.createElement('ul'); for (const li of s.ul) { const e = document.createElement('li'); e.innerHTML = pick(li); ul.append(e); } page.append(ul); }
	}
	const kh = document.createElement('h2');
	kh.textContent = pick({ en: 'Keyboard shortcuts', ru: 'Горячие клавиши' });
	const grid = document.createElement('div');
	grid.className = 'keys';
	for (const [k, d] of KEYS) { const a = document.createElement('kbd'); a.textContent = k; const b = document.createElement('span'); b.textContent = pick(d); grid.append(a, b); }
	const note = document.createElement('p');
	note.textContent = pick({ en: 'Shortcuts also work on the Russian keyboard layout and can be changed in Settings, Hotkeys.', ru: 'Горячие клавиши работают и на русской раскладке; их можно изменить в Настройки, Горячие клавиши.' });
	page.append(kh, grid, note);
	document.getElementById('app').append(page);
	page.addEventListener('click', (e) => { const a = e.target.closest('a[href]'); if (a) { e.preventDefault(); shell.openExternal(a.href); } });
})();
