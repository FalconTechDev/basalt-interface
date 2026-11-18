// Start window: pick or create a vault. It talks to the main process through the channels in src/main.js.
(() => {
	'use strict';
	const { ipcRenderer, shell } = require('electron');
	const path = require('path');

	const ru = (localStorage.getItem('language') || navigator.language || 'en').toLowerCase().startsWith('ru');
	const t = (en, rus) => (ru ? rus : en);
	const root = document.getElementById('app');

	const el = (tag, props, ...kids) => {
		const node = document.createElement(tag);
		for (const k in props || {}) {
			if (k === 'class') node.className = props[k];
			else if (k === 'on') for (const ev in props.on) node.addEventListener(ev, props.on[ev]);
			else if (k in node) node[k] = props[k];
			else node.setAttribute(k, props[k]);
		}
		for (const kid of kids) if (kid != null) node.append(kid);
		return node;
	};

	const state = { creating: false, error: '', location: ipcRenderer.sendSync('get-default-vault-path') ? path.dirname(ipcRenderer.sendSync('get-default-vault-path')) : '', name: 'My vault' };

	function open(p, create) {
		const err = ipcRenderer.sendSync('vault-open', p, !!create);
		if (err) { state.error = String(err); render(); return; }
		window.close();
	}

	function vaultRows() {
		const vaults = ipcRenderer.sendSync('vault-list') || {};
		const items = Object.keys(vaults).map((id) => ({ id, ...vaults[id] })).sort((a, b) => (b.ts || 0) - (a.ts || 0));
		if (!items.length) return [el('div', { class: 'empty' }, t('No vaults yet. Create one or open a folder.', 'Хранилищ пока нет. Создайте новое или откройте папку.'))];
		return items.map((v) => el('div', { class: 'row', on: { click: () => open(v.path, false) } },
			el('div', { class: 'main' }, el('div', { class: 'name' }, path.basename(v.path)), el('div', { class: 'path', title: v.path }, v.path)),
			el('button', {
				class: 'x', title: t('Remove from the list', 'Убрать из списка'),
				on: { click: (e) => { e.stopPropagation(); if (!ipcRenderer.sendSync('vault-remove', v.path)) state.error = t('Close the vault window first.', 'Сначала закройте окно этого хранилища.'); else state.error = ''; render(); } },
			}, '×')));
	}

	async function choose(then) {
		const picked = await ipcRenderer.invoke('pick-folder', state.location);
		if (picked) then(picked);
	}

	function createForm() {
		const name = el('input', { type: 'text', value: state.name, on: { input: (e) => { state.name = e.target.value; } } });
		const loc = el('input', { type: 'text', value: state.location, on: { input: (e) => { state.location = e.target.value; } } });
		const submit = () => {
			const n = state.name.trim();
			if (!n || /[\\/:*?"<>|]/.test(n)) { state.error = t('Use a plain folder name.', 'Введите простое имя папки.'); render(); return; }
			open(path.join(state.location, n), true);
		};
		return el('form', { class: 'create' + (state.creating ? ' open' : ''), on: { submit: (e) => { e.preventDefault(); submit(); } } },
			el('label', null, t('Vault name', 'Название хранилища'), name),
			el('label', null, t('Location', 'Расположение'), el('div', { class: 'pathrow' }, loc, el('button', { class: 'btn', type: 'button', on: { click: () => choose((p) => { state.location = p; render(); }) } }, t('Choose…', 'Выбрать…')))),
			el('div', null, el('button', { class: 'btn primary', type: 'submit' }, t('Create', 'Создать'))));
	}

	function render() {
		const version = ipcRenderer.sendSync('version');
		root.replaceChildren(el('div', { class: 'page' },
			el('div', { class: 'brand' }, el('img', { src: 'basalt-logo.png', alt: '' }), el('div', null, el('h1', null, 'Basalt'), el('small', null, t('Version ', 'Версия ') + version))),
			el('h2', null, t('Recent vaults', 'Недавние хранилища')),
			el('div', { class: 'list' }, ...vaultRows()),
			el('h2', null, t('Start', 'Начать')),
			el('div', { class: 'actions' },
				el('button', { class: 'big', on: { click: () => { state.creating = !state.creating; state.error = ''; render(); } } }, el('span', { class: 'ico' }, '+'), t('Create a new vault', 'Создать хранилище')),
				el('button', { class: 'big', on: { click: () => choose((p) => open(p, false)) } }, el('span', { class: 'ico' }, '↗'), t('Open a folder as vault', 'Открыть папку как хранилище')),
				el('button', { class: 'big', on: { click: () => { ipcRenderer.sendSync('sandbox'); window.close(); } } }, el('span', { class: 'ico' }, '□'), t('Open the sandbox', 'Открыть песочницу')),
				el('button', { class: 'big', on: { click: () => ipcRenderer.sendSync('help') } }, el('span', { class: 'ico' }, '?'), t('Help', 'Справка'))),
			createForm(),
			el('div', { class: 'err' }, state.error),
			el('div', { class: 'foot' }, el('span', null, t('Your notes stay as plain files in the folder you pick.', 'Заметки остаются обычными файлами в выбранной папке.')))));
	}
	render();
})();
