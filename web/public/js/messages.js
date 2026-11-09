// The «Сообщения» page: the message builder with a Discord-like preview, drafts, the schedule form and the tools.
(function () {
  'use strict';
  var dataEl = document.getElementById('msg-data');
  if (!dataEl) return;
  var D = JSON.parse(dataEl.textContent);
  var base = '/dashboard/' + D.guildId + '/messages';
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var DRAFT_KEY = 'dark-msg-draft-' + D.guildId;

  // ---------- state ----------
  var blankEmbed = function () { return { author: { name: '', url: '', icon_url: '' }, title: '', url: '', description: '', color: '', fields: [], image: { url: '' }, thumbnail: { url: '' }, footer: { text: '', icon_url: '' }, timestamp: '' }; };
  var state = { kind: 'classic', blocks: [], content: '', username: '', avatar_url: '', mentions: 'none', embeds: [], buttons: [] };
  var savedId = 0; var scheduleId = 0; var loadedRef = '';

  function normalizeEmbed(e) {
    var b = blankEmbed(); e = e || {};
    b.title = e.title || ''; b.url = e.url || ''; b.description = e.description || '';
    b.color = typeof e.color === 'number' ? '#' + ('000000' + e.color.toString(16)).slice(-6) : (e.color || '');
    if (e.author) { b.author.name = e.author.name || ''; b.author.url = e.author.url || ''; b.author.icon_url = e.author.icon_url || ''; }
    if (e.footer) { b.footer.text = e.footer.text || ''; b.footer.icon_url = e.footer.icon_url || ''; }
    b.image.url = (e.image && e.image.url) || ''; b.thumbnail.url = (e.thumbnail && e.thumbnail.url) || '';
    b.timestamp = e.timestamp || '';
    b.fields = (e.fields || []).map(function (f) { return { name: f.name || '', value: f.value || '', inline: Boolean(f.inline) }; });
    return b;
  }
  /** Any Discord message JSON (ours, Discord's, other builders') → the editor's state. */
  // ---------- Discord components (the "Компоненты" format): blocks in the editor ⇄ Discord JSON ----------
  var V2 = 1 << 15;
  var BLOCKS = { text: 'Текст', sep: 'Разделитель', gallery: 'Галерея картинок', section: 'Текст с картинкой или кнопкой', buttons: 'Кнопки-ссылки', container: 'Контейнер' };
  function blankBlock(t) {
    if (t === 'text') return { t: t, content: '' };
    if (t === 'sep') return { t: t, divider: true, spacing: '1' };
    if (t === 'gallery') return { t: t, items: [{ url: '', desc: '' }] };
    if (t === 'section') return { t: t, text: '', acc: 'thumb', url: '', label: '' };
    if (t === 'buttons') return { t: t, items: [{ label: '', url: '' }] };
    return { t: 'container', color: '', spoiler: false, children: [{ t: 'text', content: '' }] };
  }
  function blockFrom(c) {
    if (!c) return null;
    if (c.type === 10) return { t: 'text', content: c.content || '' };
    if (c.type === 14) return { t: 'sep', divider: c.divider !== false, spacing: String(c.spacing === 2 ? 2 : 1) };
    if (c.type === 12) return { t: 'gallery', items: (c.items || []).map(function (i) { return { url: (i.media && i.media.url) || '', desc: i.description || '' }; }) };
    if (c.type === 9) {
      var acc = c.accessory || {};
      return { t: 'section', text: (c.components || []).map(function (x) { return x.content || ''; }).join('\n'), acc: acc.type === 2 ? 'button' : 'thumb', url: acc.type === 2 ? (acc.url || '') : ((acc.media && acc.media.url) || ''), label: acc.label || '' };
    }
    if (c.type === 1) return { t: 'buttons', items: (c.components || []).filter(function (b) { return b.type === 2 && b.url; }).map(function (b) { return { label: b.label || '', url: b.url }; }) };
    if (c.type === 17) return { t: 'container', color: typeof c.accent_color === 'number' ? '#' + ('000000' + c.accent_color.toString(16)).slice(-6) : '', spoiler: Boolean(c.spoiler), children: (c.components || []).map(blockFrom).filter(Boolean) };
    return null;
  }
  function blockTo(b) {
    if (b.t === 'text') return { type: 10, content: b.content };
    if (b.t === 'sep') return { type: 14, divider: Boolean(b.divider), spacing: b.spacing === '2' ? 2 : 1 };
    if (b.t === 'gallery') return { type: 12, items: b.items.filter(function (i) { return i.url; }).map(function (i) { var o = { media: { url: i.url } }; if (i.desc) o.description = i.desc; return o; }) };
    if (b.t === 'section') return { type: 9, components: [{ type: 10, content: b.text }], accessory: b.acc === 'button' ? { type: 2, style: 5, label: b.label, url: b.url } : { type: 11, media: { url: b.url } } };
    if (b.t === 'buttons') return { type: 1, components: b.items.filter(function (i) { return i.label || i.url; }).map(function (i) { return { type: 2, style: 5, label: i.label, url: i.url }; }) };
    var o = { type: 17, spoiler: Boolean(b.spoiler), components: b.children.map(blockTo) };
    if (hexOk(b.color)) o.accent_color = parseInt(b.color.replace('#', ''), 16);
    return o;
  }
  function countBlocks(list) { return list.reduce(function (n, b) { return n + 1 + (b.t === 'container' ? countBlocks(b.children) : 0) + (b.t === 'section' ? 2 : 0) + (b.t === 'buttons' ? b.items.length : 0); }, 0); }
  function isV2(m) { return Boolean(m && (m.v2 || (m.flags & V2) || (m.components || []).some(function (c) { return c && c.type !== 1; }))); }

  function fromMessage(m) {
    m = m || {};
    if (isV2(m)) {
      return { kind: 'v2', blocks: (m.components || []).map(blockFrom).filter(Boolean), content: '', username: m.username || '', avatar_url: m.avatar_url || '', mentions: ['none', 'users', 'roles', 'everyone'].indexOf(m.mentions) >= 0 ? m.mentions : 'none', embeds: [], buttons: [] };
    }
    var buttons = [];
    (m.components || []).forEach(function (row) { (row.components || []).forEach(function (b) { if (b.type === 2 && (b.style === 5 || b.url)) buttons.push({ label: b.label || '', url: b.url || '' }); }); });
    return { kind: 'classic', blocks: [], content: m.content || '', username: m.username || '', avatar_url: m.avatar_url || '', mentions: ['none', 'users', 'roles', 'everyone'].indexOf(m.mentions) >= 0 ? m.mentions : 'none', embeds: (m.embeds || []).slice(0, 10).map(normalizeEmbed), buttons: buttons.slice(0, 25) };
  }
  /** The state → the message the server checks (empty parts left out). */
  function toMessage() {
    if (state.kind === 'v2') {
      var v = { v2: true, flags: V2, components: state.blocks.map(blockTo), mentions: state.mentions };
      if (mode() === 'webhook') { v.username = state.username; v.avatar_url = state.avatar_url; }
      return v;
    }
    var embeds = state.embeds.map(function (e) {
      var o = {};
      if (e.title) o.title = e.title; if (e.url) o.url = e.url; if (e.description) o.description = e.description; if (e.color) o.color = e.color;
      if (e.author.name) o.author = { name: e.author.name, url: e.author.url, icon_url: e.author.icon_url };
      if (e.footer.text) o.footer = { text: e.footer.text, icon_url: e.footer.icon_url };
      if (e.image.url) o.image = { url: e.image.url }; if (e.thumbnail.url) o.thumbnail = { url: e.thumbnail.url };
      if (e.timestamp) o.timestamp = e.timestamp;
      var fields = e.fields.filter(function (f) { return f.name || f.value; });
      if (fields.length) o.fields = fields;
      return o;
    });
    var rows = [];
    state.buttons.filter(function (b) { return b.label || b.url; }).forEach(function (b, i) { if (i % 5 === 0) rows.push({ type: 1, components: [] }); rows[rows.length - 1].components.push({ type: 2, style: 5, label: b.label, url: b.url }); });
    var msg = { content: state.content, embeds: embeds, components: rows, mentions: state.mentions };
    if (mode() === 'webhook') { msg.username = state.username; msg.avatar_url = state.avatar_url; }
    return msg;
  }
  function readTarget() {
    return { mode: mode(), channelId: $('#m-channel').value, webhookId: $('#m-hook').value, url: $('#m-hookurl').value.trim(), threadId: $('#m-thread').value.trim(), threadName: $('#m-threadname').value.trim() };
  }
  function setTarget(t) {
    t = t || {};
    if (t.mode === 'webhook' && D.canWebhook) $('input[name="m-mode"][value="webhook"]').checked = true; else $('input[name="m-mode"][value="channel"]').checked = true;
    if (t.channelId && $('#m-channel option[value="' + t.channelId + '"]')) $('#m-channel').value = t.channelId;
    $('#m-hook').value = t.webhookId && $('#m-hook option[value="' + t.webhookId + '"]') ? t.webhookId : '';
    $('#m-hookurl').value = t.url || '';
    $('#m-thread').value = t.threadId || ''; $('#m-threadname').value = t.threadName || '';
    syncMode();
  }
  var mode = function () { var r = $('input[name="m-mode"]:checked'); return r ? r.value : 'channel'; };

  // ---------- small helpers ----------
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>\u0022\u0027]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
  function getPath(obj, path) { return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj); }
  function setPath(obj, path, v) { var ks = path.split('.'); var last = ks.pop(); var o = ks.reduce(function (x, k) { return x[k]; }, obj); o[last] = v; }
  function status(el, text, bad, html) { el.className = 'msg-status' + (bad ? ' bad' : text ? ' good' : ''); if (html) el.innerHTML = html; else el.textContent = text || ''; }
  function api(path, body, method) {
    return fetch(base + path, { method: method || 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) {
        if (r.status === 429) return { ok: false, error: 'Слишком много действий подряд. Подождите минуту.' };
        return r.json().catch(function () { return { ok: false, error: 'Сервер ответил с ошибкой (' + r.status + ').' }; });
      })
      .catch(function () { return { ok: false, error: 'Нет связи с панелью. Проверьте интернет.' }; });
  }
  var hexOk = function (v) { return /^#?[0-9a-f]{6}$/i.test(v || ''); };
  function localInput(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return ''; var p = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }

  // ---------- editor: embeds and buttons ----------
  var embedsBox = $('#m-embeds'); var buttonsBox = $('#m-buttons');
  function input(k, label, opts) {
    opts = opts || {};
    var v = getPath(state, k);
    var id = 'f-' + k.replace(/\./g, '-');
    var tag = opts.area ? '<textarea id="' + id + '" data-k="' + k + '" rows="' + (opts.rows || 3) + '"' + (opts.max ? ' maxlength="' + opts.max + '"' : '') + ' placeholder="' + esc(opts.ph || '') + '">' + esc(v) + '</textarea>'
      : '<input type="' + (opts.type || 'text') + '" id="' + id + '" data-k="' + k + '" value="' + esc(opts.type === 'datetime-local' ? localInput(v) : v) + '"' + (opts.max ? ' maxlength="' + opts.max + '"' : '') + ' placeholder="' + esc(opts.ph || '') + '" />';
    return '<div class="' + (opts.cls || '') + '"><label for="' + id + '">' + esc(label) + (opts.max ? ' <span class="muted" data-counter="' + k + '"></span>' : '') + '</label>' + tag + '</div>';
  }
  function renderEmbeds() {
    embedsBox.innerHTML = state.embeds.map(function (e, i) {
      var p = 'embeds.' + i + '.';
      var fields = e.fields.map(function (f, j) {
        var q = p + 'fields.' + j + '.';
        return '<div class="me-field"><div class="two-col">' + input(q + 'name', 'Название поля', { max: 256 }) + input(q + 'value', 'Значение', { max: 1024, area: true, rows: 2 }) + '</div>' +
          '<div class="msg-inline"><label class="msg-check"><input type="checkbox" data-k="' + q + 'inline" ' + (f.inline ? 'checked' : '') + ' /> в строку</label>' +
          '<button type="button" class="btn-link" data-act="field-up" data-e="' + i + '" data-f="' + j + '">↑</button><button type="button" class="btn-link" data-act="field-down" data-e="' + i + '" data-f="' + j + '">↓</button>' +
          '<button type="button" class="btn-link danger" data-act="field-del" data-e="' + i + '" data-f="' + j + '">Удалить поле</button></div></div>';
      }).join('');
      return '<details class="card me-embed" open style="border-left-color:' + (hexOk(e.color) ? (e.color[0] === '#' ? e.color : '#' + e.color) : 'var(--hairline)') + '">' +
        '<summary><b>Эмбед ' + (i + 1) + '</b><span class="muted"> ' + esc(e.title || e.author.name || '') + '</span>' +
        '<span class="me-tools"><button type="button" class="btn-link" data-act="embed-up" data-e="' + i + '">↑</button><button type="button" class="btn-link" data-act="embed-down" data-e="' + i + '">↓</button>' +
        '<button type="button" class="btn-link" data-act="embed-copy" data-e="' + i + '">Копия</button><button type="button" class="btn-link danger" data-act="embed-del" data-e="' + i + '">Удалить</button></span></summary>' +
        '<div class="me-group"><h3>Автор</h3><div class="two-col">' + input(p + 'author.name', 'Имя', { max: 256 }) + input(p + 'author.url', 'Ссылка', { ph: 'https://' }) + '</div>' + input(p + 'author.icon_url', 'Иконка (ссылка https)', { ph: 'https://' }) + '</div>' +
        '<div class="me-group"><h3>Содержание</h3><div class="two-col">' + input(p + 'title', 'Заголовок', { max: 256 }) + input(p + 'url', 'Ссылка заголовка', { ph: 'https://' }) + '</div>' +
        input(p + 'description', 'Описание', { area: true, rows: 4, max: 4096 }) +
        '<div class="me-color"><label for="f-' + i + '-color">Цвет полосы</label><div class="msg-inline"><input type="color" data-color="' + i + '" value="' + (hexOk(e.color) ? (e.color[0] === '#' ? e.color : '#' + e.color) : '#9a93ff') + '" aria-label="Цвет" />' +
        '<input type="text" id="f-' + i + '-color" data-k="' + p + 'color" value="' + esc(e.color) + '" placeholder="#e3a857" maxlength="7" class="me-hex" /></div></div></div>' +
        '<div class="me-group"><h3>Поля <span class="muted">' + e.fields.length + ' / 25</span></h3>' + fields +
        '<button type="button" class="btn btn-secondary" data-act="field-add" data-e="' + i + '" ' + (e.fields.length >= 25 ? 'disabled' : '') + '>+ Поле</button></div>' +
        '<div class="me-group"><h3>Картинки</h3><div class="two-col">' + input(p + 'image.url', 'Большая картинка', { ph: 'https://' }) + input(p + 'thumbnail.url', 'Миниатюра справа', { ph: 'https://' }) + '</div></div>' +
        '<div class="me-group"><h3>Подпись</h3><div class="two-col">' + input(p + 'footer.text', 'Текст подписи', { max: 2048 }) + input(p + 'footer.icon_url', 'Иконка подписи', { ph: 'https://' }) + '</div>' +
        '<div class="msg-inline">' + input(p + 'timestamp', 'Метка времени', { type: 'datetime-local' }) + '<button type="button" class="btn-link" data-act="ts-now" data-e="' + i + '">сейчас</button><button type="button" class="btn-link" data-act="ts-clear" data-e="' + i + '">убрать</button></div></div>' +
        '</details>';
    }).join('');
    $('[data-act="add-embed"]').disabled = state.embeds.length >= 10;
    counters();
  }
  function renderButtons() {
    if (!state.buttons.length) { buttonsBox.innerHTML = ''; $('[data-act="add-button"]').disabled = false; return; }
    buttonsBox.innerHTML = '<div class="card"><h2>Кнопки-ссылки <span class="muted">' + state.buttons.length + ' / 25</span></h2><div class="hint">По 5 кнопок в ряд. Кнопки открывают ссылку и работают без бота.</div>' +
      state.buttons.map(function (b, i) {
        return '<div class="me-button">' + input('buttons.' + i + '.label', 'Текст', { max: 80 }) + input('buttons.' + i + '.url', 'Ссылка', { ph: 'https://' }) +
          '<button type="button" class="btn-link danger" data-act="button-del" data-b="' + i + '" aria-label="Удалить кнопку">✕</button></div>';
      }).join('') + '</div>';
    $('[data-act="add-button"]').disabled = state.buttons.length >= 25;
  }
  function counters() {
    $$('[data-counter]').forEach(function (el) {
      var k = el.getAttribute('data-counter'); var v = String(getPath(state, k) || '');
      var input = $('[data-k="' + k + '"]'); var max = input && input.maxLength > 0 ? input.maxLength : 0;
      el.textContent = max ? v.length + ' / ' + max : '';
    });
    var total = state.embeds.reduce(function (n, e) { return n + e.title.length + e.description.length + e.author.name.length + e.footer.text.length + e.fields.reduce(function (m, f) { return m + f.name.length + f.value.length; }, 0); }, 0);
    var t = $('#m-total');
    if (!t) { t = document.createElement('div'); t.id = 'm-total'; t.className = 'hint'; embedsBox.parentNode.insertBefore(t, embedsBox.nextSibling); }
    t.textContent = state.embeds.length ? 'Символов во всех эмбедах: ' + total + ' / 6000' : '';
    t.classList.toggle('bad', total > 6000);
  }
  var blocksBox = $('#m-blocks');
  function addBar(listPath, inContainer) {
    return Object.keys(BLOCKS).filter(function (t) { return !(inContainer && t === 'container'); }).map(function (t) {
      return '<button type="button" class="btn btn-secondary v2-add-btn" data-act="v2-add" data-list="' + listPath + '" data-type="' + t + '">+ ' + esc(BLOCKS[t]) + '</button>';
    }).join('');
  }
  function blockHtml(b, path, inContainer) {
    var tools = '<span class="me-tools"><button type="button" class="btn-link" data-act="v2-up" data-path="' + path + '" aria-label="Выше">↑</button><button type="button" class="btn-link" data-act="v2-down" data-path="' + path + '" aria-label="Ниже">↓</button><button type="button" class="btn-link danger" data-act="v2-del" data-path="' + path + '">Удалить</button></span>';
    var body = '';
    if (b.t === 'text') body = input(path + '.content', 'Текст (разметка Discord)', { area: true, rows: 3, max: 4000 });
    else if (b.t === 'sep') body = '<div class="msg-inline"><label class="msg-check"><input type="checkbox" data-k="' + path + '.divider" ' + (b.divider ? 'checked' : '') + ' /> линия</label><label class="msg-select-inline">Отступ <select data-k="' + path + '.spacing"><option value="1" ' + (b.spacing !== '2' ? 'selected' : '') + '>маленький</option><option value="2" ' + (b.spacing === '2' ? 'selected' : '') + '>большой</option></select></label></div>';
    else if (b.t === 'gallery') {
      body = b.items.map(function (it, i) { return '<div class="v2-item">' + input(path + '.items.' + i + '.url', 'Картинка ' + (i + 1) + ' (ссылка https)', { ph: 'https://' }) + input(path + '.items.' + i + '.desc', 'Подпись', { max: 1024 }) + '<button type="button" class="btn-link danger" data-act="v2-item-del" data-path="' + path + '.items.' + i + '" aria-label="Убрать">✕</button></div>'; }).join('') +
        (b.items.length < 10 ? '<button type="button" class="btn btn-secondary" data-act="v2-item-add" data-list="' + path + '.items" data-type="img">+ Картинка</button>' : '');
    } else if (b.t === 'section') {
      body = input(path + '.text', 'Текст', { area: true, rows: 3, max: 4000 }) +
        '<div class="two-col"><div><label>Справа от текста</label><select data-k="' + path + '.acc"><option value="thumb" ' + (b.acc !== 'button' ? 'selected' : '') + '>картинка</option><option value="button" ' + (b.acc === 'button' ? 'selected' : '') + '>кнопка-ссылка</option></select></div>' +
        input(path + '.url', b.acc === 'button' ? 'Ссылка кнопки' : 'Картинка (ссылка https)', { ph: 'https://' }) + '</div>' +
        (b.acc === 'button' ? input(path + '.label', 'Текст кнопки', { max: 80 }) : '');
    } else if (b.t === 'buttons') {
      body = b.items.map(function (it, i) { return '<div class="v2-item">' + input(path + '.items.' + i + '.label', 'Текст', { max: 80 }) + input(path + '.items.' + i + '.url', 'Ссылка', { ph: 'https://' }) + '<button type="button" class="btn-link danger" data-act="v2-item-del" data-path="' + path + '.items.' + i + '" aria-label="Убрать">✕</button></div>'; }).join('') +
        (b.items.length < 5 ? '<button type="button" class="btn btn-secondary" data-act="v2-item-add" data-list="' + path + '.items" data-type="btn">+ Кнопка</button>' : '');
    } else if (b.t === 'container') {
      body = '<div class="msg-inline"><div class="me-color"><label>Цвет полосы</label><div class="msg-inline"><input type="color" data-vcolor="' + path + '" value="' + (hexOk(b.color) ? b.color : '#9a93ff') + '" aria-label="Цвет" /><input type="text" class="me-hex" data-k="' + path + '.color" value="' + esc(b.color) + '" placeholder="без цвета" maxlength="7" /></div></div>' +
        '<label class="msg-check"><input type="checkbox" data-k="' + path + '.spoiler" ' + (b.spoiler ? 'checked' : '') + ' /> под спойлером</label></div>' +
        '<div class="v2-children">' + b.children.map(function (c, i) { return blockHtml(c, path + '.children.' + i, true); }).join('') + '</div>' +
        '<div class="v2-add v2-add-in">' + addBar(path + '.children', true) + '</div>';
    }
    return '<div class="card v2-block v2-' + b.t + '"' + (b.t === 'container' && hexOk(b.color) ? ' style="border-left-color:' + b.color + '"' : '') + '><div class="v2-head"><b>' + esc(BLOCKS[b.t]) + '</b>' + tools + '</div>' + body + '</div>';
  }
  function renderBlocks() {
    if (!blocksBox) return;
    blocksBox.innerHTML = state.blocks.length ? state.blocks.map(function (b, i) { return blockHtml(b, 'blocks.' + i, false); }).join('') : '<div class="card v2-empty">Пока нет блоков. Добавьте первый ниже — например, «Контейнер» с текстом и картинкой.</div>';
    var root = $('.v2-root-add .v2-add'); if (root) root.innerHTML = addBar('blocks', false);
    var n = countBlocks(state.blocks); var cnt = $('#m-v2-count');
    if (cnt) { cnt.textContent = 'Компонентов: ' + n + ' / 40'; cnt.classList.toggle('bad', n > 40); }
  }
  function syncFormat() {
    var k = state.kind === 'v2' ? 'v2' : 'classic';
    var r = $('input[name="m-kind"][value="' + k + '"]'); if (r) r.checked = true;
    $$('[data-kind-show]').forEach(function (el) { el.hidden = el.getAttribute('data-kind-show') !== k; });
  }
  function renderAll() {
    $('#m-content').value = state.content; $('#m-username').value = state.username; $('#m-avatar').value = state.avatar_url;
    var men = $('#m-mentions'); men.value = state.mentions; if (men.value !== state.mentions) { men.value = 'none'; state.mentions = 'none'; }
    renderEmbeds(); renderButtons(); renderBlocks(); syncFormat(); preview(); keepDraft();
  }
  function syncMode() {
    var m = mode();
    $$('[data-show]').forEach(function (el) { el.hidden = el.getAttribute('data-show') !== m; });
    var ch = $('#m-channel').selectedOptions[0];
    var forum = m === 'channel' && ch && (ch.getAttribute('data-type') === '15' || ch.getAttribute('data-type') === '16');
    $('#m-threadname').placeholder = forum ? 'Обязательно для форума, если не указана ветка' : 'Название публикации';
    preview();
  }

  // ---------- preview: Discord's look ----------
  var ANSI_FG = { 30: '#4f545c', 31: '#dc322f', 32: '#859900', 33: '#b58900', 34: '#268bd2', 35: '#d33682', 36: '#2aa198', 37: '#ffffff' };
  var ANSI_BG = { 40: '#002b36', 41: '#cb4b16', 42: '#586e75', 43: '#657b83', 44: '#839496', 45: '#6c71c4', 46: '#93a1a1', 47: '#fdf6e3' };
  function ansiHtml(text) {
    var out = ''; var st = {}; var parts = String(text).split(/\u001b\[([\d;]*)m/);
    for (var i = 0; i < parts.length; i++) {
      if (i % 2) {
        (parts[i] || '0').split(';').forEach(function (c) {
          c = +c;
          if (c === 0) st = {}; else if (c === 1) st.b = 1; else if (c === 4) st.u = 1; else if (ANSI_FG[c]) st.fg = ANSI_FG[c]; else if (ANSI_BG[c]) st.bg = ANSI_BG[c];
        });
      } else if (parts[i]) {
        var css = (st.fg ? 'color:' + st.fg + ';' : '') + (st.bg ? 'background:' + st.bg + ';' : '') + (st.b ? 'font-weight:700;' : '') + (st.u ? 'text-decoration:underline;' : '');
        out += css ? '<span style="' + css + '">' + esc(parts[i]) + '</span>' : esc(parts[i]);
      }
    }
    return out;
  }
  function channelName(id) { var c = D.channels.filter(function (x) { return x.id === id; })[0]; return c ? c.name : 'канал'; }
  /** Discord markdown, safely: everything is escaped first, only known marks become tags. */
  function md(src, opts) {
    opts = opts || {};
    var keep = [];
    var hold = function (html) { keep.push(html); return '\u0000' + (keep.length - 1) + '\u0000'; };
    var s = String(src || '');
    s = s.replace(/\u0060{3}(?:([\w+-]{1,15})\n)?([\s\S]*?)\u0060{3}/g, function (_, lang, code) { return hold('<pre class="dm-code">' + (lang === 'ansi' ? ansiHtml(code.replace(/\n$/, '')) : esc(code.replace(/\n$/, ''))) + '</pre>'); });
    s = s.replace(/\u0060([^\u0060\n]+)\u0060/g, function (_, code) { return hold('<code class="dm-inline">' + esc(code) + '</code>'); });
    s = esc(s);
    s = s.replace(/&lt;t:(-?\d{1,12})(?::([tTdDfFR]))?&gt;/g, function (_, t, f) { var d = new Date(t * 1000); return hold('<span class="dm-time">' + esc(f === 'R' ? d.toLocaleString() : f === 'd' || f === 'D' ? d.toLocaleDateString() : f === 't' || f === 'T' ? d.toLocaleTimeString() : d.toLocaleString()) + '</span>'); });
    s = s.replace(/&lt;(a?):(\w{2,32}):(\d{15,25})&gt;/g, function (_, a, name, id) { return hold('<img class="dm-emoji" alt=":' + name + ':" src="https://cdn.discordapp.com/emojis/' + id + '.' + (a ? 'gif' : 'png') + '?size=48" />'); });
    s = s.replace(/&lt;@!?(\d{15,25})&gt;/g, function () { return hold('<span class="dm-mention">@участник</span>'); });
    s = s.replace(/&lt;@&amp;(\d{15,25})&gt;/g, function () { return hold('<span class="dm-mention">@роль</span>'); });
    s = s.replace(/&lt;#(\d{15,25})&gt;/g, function (_, id) { return hold('<span class="dm-mention">#' + esc(channelName(id)) + '</span>'); });
    s = s.replace(/@(everyone|here)/g, function (_, w) { return hold('<span class="dm-mention">@' + w + '</span>'); });
    if (opts.links !== false) {
      s = s.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, function (_, t, u) { return hold('<a href="' + u + '" target="_blank" rel="noopener noreferrer nofollow">' + t + '</a>'); });
      s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,:;\u0022\u0027)\]])/g, function (_, pre, u) { return pre + hold('<a href="' + u + '" target="_blank" rel="noopener noreferrer nofollow">' + u + '</a>'); });
    }
    s = s.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<b><i>$1</i></b>').replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>').replace(/__([\s\S]+?)__/g, '<u>$1</u>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>').replace(/~~([\s\S]+?)~~/g, '<s>$1</s>')
      .replace(/\|\|([\s\S]+?)\|\|/g, '<span class="dm-spoiler" tabindex="0">$1</span>');
    var lines = s.split('\n'); var html = ''; var quote = [];
    var flush = function () { if (quote.length) { html += '<blockquote class="dm-quote">' + quote.join('<br>') + '</blockquote>'; quote = []; } };
    lines.forEach(function (line, i) {
      var q = /^&gt; ?(.*)$/.exec(line);
      if (q) { quote.push(q[1]); return; }
      flush();
      var h = opts.headings === false ? null : /^(#{1,3}) (.+)$/.exec(line);
      var sub = /^-# (.+)$/.exec(line); var li = /^\s*[-*] (.+)$/.exec(line);
      if (h) html += '<div class="dm-h' + h[1].length + '">' + h[2] + '</div>';
      else if (sub) html += '<div class="dm-sub">' + sub[1] + '</div>';
      else if (li) html += '<div class="dm-li">' + li[1] + '</div>';
      else html += line + (i < lines.length - 1 ? '<br>' : '');
    });
    flush();
    return html.replace(/\u0000(\d+)\u0000/g, function (_, n) { return keep[+n]; });
  }
  var safeImg = function (u) { return /^https:\/\/[^\s\u0022<>]+$/i.test(u || '') ? esc(u) : ''; };
  var raf = 0;
  function preview() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; drawPreview(); }); }
  var linkIcon = ' <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4H16V9M16 4L9 11M14 12V16H4V6H8"/></svg>';
  function v2Html(list) {
    return list.map(function (b) {
      if (b.t === 'text') return b.content ? '<div class="dv-text">' + md(b.content) + '</div>' : '';
      if (b.t === 'sep') return '<div class="dv-sep' + (b.spacing === '2' ? ' big' : '') + (b.divider ? ' line' : '') + '"></div>';
      if (b.t === 'gallery') {
        var imgs = b.items.filter(function (i) { return safeImg(i.url); });
        return imgs.length ? '<div class="dv-gallery n' + Math.min(imgs.length, 4) + '">' + imgs.map(function (i) { return '<img src="' + safeImg(i.url) + '" alt="' + esc(i.desc) + '" />'; }).join('') + '</div>' : '';
      }
      if (b.t === 'section') {
        var acc = b.acc === 'button' ? '<span class="dm-button">' + esc(b.label || 'Кнопка') + linkIcon + '</span>' : (safeImg(b.url) ? '<img class="dv-thumb" src="' + safeImg(b.url) + '" alt="" />' : '');
        return '<div class="dv-section"><div class="dv-text">' + md(b.text) + '</div>' + acc + '</div>';
      }
      if (b.t === 'buttons') {
        var items = b.items.filter(function (i) { return i.label || i.url; });
        return items.length ? '<div class="dm-buttons">' + items.map(function (i) { return '<span class="dm-button">' + esc(i.label || 'Кнопка') + linkIcon + '</span>'; }).join('') + '</div>' : '';
      }
      if (b.t === 'container') return '<div class="dv-container' + (b.spoiler ? ' spoiler' : '') + '" style="border-left-color:' + (hexOk(b.color) ? b.color : 'transparent') + '">' + v2Html(b.children) + '</div>';
      return '';
    }).join('');
  }
  function drawPreview() {
    var hook = mode() === 'webhook';
    var hookName = hook ? ($('#m-hook').selectedOptions[0] && $('#m-hook').value ? $('#m-hook').selectedOptions[0].textContent.split(' · ')[0] : 'Вебхук') : D.botName;
    var name = hook && state.username ? state.username : hookName;
    var avatar = hook && safeImg(state.avatar_url) ? safeImg(state.avatar_url) : '';
    var now = new Date(); var hm = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    var html = '<div class="dm-msg"><div class="dm-avatar">' + (avatar ? '<img src="' + avatar + '" alt="" />' : '<span>' + esc(name.slice(0, 1).toUpperCase()) + '</span>') + '</div><div class="dm-body">' +
      '<div class="dm-head"><b>' + esc(name) + '</b><span class="dm-tag">' + (hook ? 'ВЕБХУК' : 'БОТ') + '</span><span class="dm-when">Сегодня в ' + hm + '</span></div>';
    if (state.kind === 'v2') {
      html += v2Html(state.blocks) || '<div class="dm-empty">Добавьте блок — здесь появится сообщение.</div>';
      html += '</div></div>';
      $('#m-preview').innerHTML = html;
      $$('#m-preview img').forEach(function (img) { img.addEventListener('error', function () { img.classList.add('dm-broken'); }); });
      return;
    }
    if (state.content) html += '<div class="dm-content">' + md(state.content) + '</div>';
    state.embeds.forEach(function (e) {
      var color = hexOk(e.color) ? (e.color[0] === '#' ? e.color : '#' + e.color) : '#202225';
      var thumb = safeImg(e.thumbnail.url);
      html += '<div class="dm-embed" style="border-left-color:' + color + '"><div class="dm-embed-grid' + (thumb ? ' has-thumb' : '') + '"><div class="dm-embed-main">';
      if (e.author.name) html += '<div class="dm-author">' + (safeImg(e.author.icon_url) ? '<img src="' + safeImg(e.author.icon_url) + '" alt="" />' : '') + (/^https?:\/\//.test(e.author.url) ? '<a href="' + esc(e.author.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(e.author.name) + '</a>' : '<span>' + esc(e.author.name) + '</span>') + '</div>';
      if (e.title) html += '<div class="dm-title">' + (/^https?:\/\//.test(e.url) ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + md(e.title, { links: false, headings: false }) + '</a>' : md(e.title, { links: false, headings: false })) + '</div>';
      if (e.description) html += '<div class="dm-desc">' + md(e.description) + '</div>';
      var fields = e.fields.filter(function (f) { return f.name || f.value; });
      if (fields.length) {
        html += '<div class="dm-fields">';
        fields.forEach(function (f) {
          html += '<div class="dm-field' + (f.inline ? ' inline' : '') + '"><div class="dm-fname">' + md(f.name, { links: false, headings: false }) + '</div><div class="dm-fvalue">' + md(f.value, { headings: false }) + '</div></div>';
        });
        html += '</div>';
      }
      if (safeImg(e.image.url)) html += '<img class="dm-image" src="' + safeImg(e.image.url) + '" alt="" />';
      if (e.footer.text || e.timestamp) {
        var ts = e.timestamp ? new Date(e.timestamp) : null;
        html += '<div class="dm-footer">' + (safeImg(e.footer.icon_url) && e.footer.text ? '<img src="' + safeImg(e.footer.icon_url) + '" alt="" />' : '') + '<span>' + esc(e.footer.text) + (e.footer.text && ts && !isNaN(ts) ? ' • ' : '') + (ts && !isNaN(ts) ? esc(ts.toLocaleString([], { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })) : '') + '</span></div>';
      }
      html += '</div>' + (thumb ? '<img class="dm-thumb" src="' + thumb + '" alt="" />' : '') + '</div></div>';
    });
    var btns = state.buttons.filter(function (b) { return b.label || b.url; });
    if (btns.length) {
      html += '<div class="dm-buttons">';
      btns.forEach(function (b, i) { if (i && i % 5 === 0) html += '<span class="dm-break"></span>'; html += '<span class="dm-button">' + esc(b.label || 'Кнопка') + ' <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4H16V9M16 4L9 11M14 12V16H4V6H8"/></svg></span>'; });
      html += '</div>';
    }
    if (!state.content && !state.embeds.length) html += '<div class="dm-empty">Напишите текст или добавьте эмбед — здесь появится сообщение.</div>';
    html += '</div></div>';
    $('#m-preview').innerHTML = html;
    $$('#m-preview img').forEach(function (img) { img.addEventListener('error', function () { img.classList.add('dm-broken'); }); });
  }

  // ---------- draft kept in this browser ----------
  var draftTimer = 0;
  function keepDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ state: state, target: readTarget(), savedId: savedId, name: $('#m-savename').value })); } catch (e) { /* storage off */ } }, 300);
  }

  // ---------- events ----------
  var editor = $('#msg-editor');
  editor.addEventListener('input', function (ev) {
    var el = ev.target; var k = el.getAttribute('data-k');
    if (el.hasAttribute('data-vcolor')) {
      var vp = el.getAttribute('data-vcolor'); setPath(state, vp + '.color', el.value);
      var vh = $('[data-k="' + vp + '.color"]'); if (vh) vh.value = el.value;
      el.closest('.v2-block').style.borderLeftColor = el.value;
    } else if (el.hasAttribute('data-color')) {
      var i = +el.getAttribute('data-color'); state.embeds[i].color = el.value; var hex = $('[data-k="embeds.' + i + '.color"]'); if (hex) hex.value = el.value;
      el.closest('.me-embed').style.borderLeftColor = el.value;
    } else if (k) {
      var v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'datetime-local') v = el.value ? new Date(el.value).toISOString() : '';
      setPath(state, k, v);
      if (/^blocks\..*\.color$/.test(k)) { var vb = el.closest('.v2-block'); if (vb && hexOk(v)) { vb.style.borderLeftColor = v[0] === '#' ? v : '#' + v; var vpick = vb.querySelector('[data-vcolor]'); if (vpick) vpick.value = v[0] === '#' ? v : '#' + v; } }
      if (/^embeds\.\d+\.color$/.test(k) && hexOk(v)) { var picker = $('[data-color="' + k.split('.')[1] + '"]'); if (picker) picker.value = v[0] === '#' ? v : '#' + v; el.closest('.me-embed').style.borderLeftColor = v[0] === '#' ? v : '#' + v; }
    }
    if (el.id === 'm-ref') syncRef();
    counters(); preview(); keepDraft();
  });
  editor.addEventListener('change', function (ev) {
    if (ev.target.name === 'm-mode' || ev.target.id === 'm-channel' || ev.target.id === 'm-hook') syncMode();
    if (ev.target.name === 'm-kind') {
      state.kind = ev.target.value === 'v2' ? 'v2' : 'classic';
      if (state.kind === 'v2' && !state.blocks.length && (state.content || state.embeds.length)) {
        // the text and the first embed are carried over, so switching does not mean starting again
        var c = blankBlock('container'); c.children = [];
        if (state.content) c.children.push({ t: 'text', content: state.content });
        state.embeds.slice(0, 1).forEach(function (e) { if (e.title || e.description) c.children.push({ t: 'text', content: (e.title ? '### ' + e.title + '\n' : '') + e.description }); if (hexOk(e.color)) c.color = e.color[0] === '#' ? e.color : '#' + e.color; if (e.image.url) c.children.push({ t: 'gallery', items: [{ url: e.image.url, desc: '' }] }); });
        if (c.children.length) state.blocks = [c];
      }
      renderBlocks(); syncFormat(); preview();
    }
    if (ev.target.getAttribute('data-k') && /\.acc$/.test(ev.target.getAttribute('data-k'))) { setPath(state, ev.target.getAttribute('data-k'), ev.target.value); renderBlocks(); }
    var k = ev.target.getAttribute('data-k');
    if (k && ev.target.tagName === 'SELECT') { setPath(state, k, ev.target.value); preview(); }
    keepDraft();
  });
  function syncRef() { var has = Boolean($('#m-ref').value.trim()); $('[data-act="edit"]').hidden = !has; }

  function move(list, i, d) { var j = i + d; if (j < 0 || j >= list.length) return; var t = list[i]; list[i] = list[j]; list[j] = t; }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act], [data-tab], [data-open-saved], [data-edit-schedule]');
    if (!b) return;
    if (b.hasAttribute('data-tab')) { showTab(b.getAttribute('data-tab')); history.replaceState(null, '', '#' + b.getAttribute('data-tab')); return; }
    if (b.hasAttribute('data-open-saved')) { openSaved(+b.getAttribute('data-open-saved')); return; }
    if (b.hasAttribute('data-edit-schedule')) { editSchedule(+b.getAttribute('data-edit-schedule')); return; }
    var a = b.getAttribute('data-act'); var e = +b.getAttribute('data-e'); var f = +b.getAttribute('data-f');
    if (b.tagName === 'BUTTON' && b.closest('summary')) ev.preventDefault();
    switch (a) {
      case 'v2-add': {
        var list = getPath(state, b.getAttribute('data-list'));
        if (countBlocks(state.blocks) >= 40) { status($('#m-status'), 'В сообщении может быть не больше 40 компонентов.', true); return; }
        list.push(blankBlock(b.getAttribute('data-type'))); renderBlocks(); break;
      }
      case 'v2-item-add': { var il = getPath(state, b.getAttribute('data-list')); il.push(b.getAttribute('data-type') === 'img' ? { url: '', desc: '' } : { label: '', url: '' }); renderBlocks(); break; }
      case 'v2-del': case 'v2-item-del': case 'v2-up': case 'v2-down': {
        var pth = b.getAttribute('data-path').split('.'); var idx = +pth.pop(); var arr = getPath(state, pth.join('.'));
        if (a === 'v2-up') move(arr, idx, -1); else if (a === 'v2-down') move(arr, idx, 1); else arr.splice(idx, 1);
        renderBlocks(); break;
      }
      case 'add-embed': if (state.embeds.length < 10) { state.embeds.push(blankEmbed()); renderEmbeds(); } break;
      case 'embed-del': state.embeds.splice(e, 1); renderEmbeds(); break;
      case 'embed-up': move(state.embeds, e, -1); renderEmbeds(); break;
      case 'embed-down': move(state.embeds, e, 1); renderEmbeds(); break;
      case 'embed-copy': if (state.embeds.length < 10) { state.embeds.splice(e + 1, 0, JSON.parse(JSON.stringify(state.embeds[e]))); renderEmbeds(); } break;
      case 'field-add': if (state.embeds[e].fields.length < 25) { state.embeds[e].fields.push({ name: '', value: '', inline: false }); renderEmbeds(); } break;
      case 'field-del': state.embeds[e].fields.splice(f, 1); renderEmbeds(); break;
      case 'field-up': move(state.embeds[e].fields, f, -1); renderEmbeds(); break;
      case 'field-down': move(state.embeds[e].fields, f, 1); renderEmbeds(); break;
      case 'ts-now': state.embeds[e].timestamp = new Date().toISOString(); renderEmbeds(); break;
      case 'ts-clear': state.embeds[e].timestamp = ''; renderEmbeds(); break;
      case 'add-button': if (state.buttons.length < 25) { state.buttons.push({ label: '', url: '' }); renderButtons(); } break;
      case 'button-del': state.buttons.splice(+b.getAttribute('data-b'), 1); renderButtons(); break;
      case 'clear': if (confirm('Очистить редактор?')) { state = fromMessage({}); savedId = 0; $('#m-savename').value = ''; $('#m-ref').value = ''; syncRef(); syncSaveButtons(); renderAll(); status($('#m-status'), ''); } return;
      case 'send': send(false); return;
      case 'edit': send(true); return;
      case 'load': loadMessage(); return;
      case 'save': saveDraft(false); return;
      case 'save-new': saveDraft(true); return;
      case 'export': $('#m-json').value = JSON.stringify(toMessage(), null, 2); return;
      case 'import': importJson(); return;
      case 'add-date': addDate(''); return;
      case 'date-del': b.parentNode.remove(); return;
      case 'schedule': saveSchedule(); return;
      case 'schedule-cancel': resetSchedule(); return;
      case 'ansi-add': ansiAdd(false); return;
      case 'ansi-newline': ansiAdd(true); return;
      case 'ansi-del': pieces.splice(+b.getAttribute('data-i'), 1); drawAnsi(); return;
      case 'ansi-clear': pieces = []; drawAnsi(); return;
      case 'ansi-copy': copy($('#a-code').value, b); return;
      case 'ansi-insert': if (!pieces.length) return; if (state.kind === 'v2') state.blocks.push({ t: 'text', content: $('#a-code').value }); else state.content = (state.content ? state.content + '\n' : '') + $('#a-code').value; renderAll(); showTab('editor'); return;
      case 'hook-info': hookInfo(); return;
      default: return;
    }
    preview(); keepDraft();
  });
  function copy(text, btn) {
    var done = function () { var t = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(function () { btn.textContent = t; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {}); else { var ta = $('#a-code'); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { /* no clipboard */ } }
  }

  // ---------- send / edit / load ----------
  function send(edit) {
    var st = $('#m-status');
    if (edit && !confirm('Заменить уже отправленное сообщение этим?')) return;
    status(st, 'Отправляю…');
    api('/send', { target: readTarget(), message: toMessage(), messageRef: edit ? $('#m-ref').value.trim() : '' }).then(function (r) {
      if (!r.ok) return status(st, r.error, true);
      status(st, '', false, esc(r.edited ? 'Сообщение изменено.' : 'Отправлено.') + ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc('Открыть в Discord') + '</a>');
      if (!edit) { $('#m-ref').value = r.url; syncRef(); }
    });
  }
  function loadMessage() {
    var st = $('#m-status'); var ref = $('#m-ref').value.trim();
    if (!ref) return status(st, 'Вставьте ID или ссылку сообщения.', true);
    status(st, 'Загружаю…');
    api('/load', { target: readTarget(), messageRef: ref }).then(function (r) {
      if (!r.ok) return status(st, r.error, true);
      var keep = { username: state.username, avatar_url: state.avatar_url, mentions: state.mentions };
      state = fromMessage(r.message);
      if (!state.username) state.username = keep.username; state.avatar_url = keep.avatar_url; state.mentions = keep.mentions;
      renderAll(); syncRef();
      status(st, 'Сообщение загружено. Измените его и нажмите «Изменить сообщение» — или «Отправить», чтобы отправить копию.');
    });
  }
  function importJson() {
    var st = $('#m-status'); var raw = $('#m-json').value.trim();
    var data;
    try { data = JSON.parse(raw); } catch (e) { return status(st, 'Это не JSON: проверьте скобки и кавычки.', true); }
    if (data && data.messages && data.messages[0] && data.messages[0].data) data = data.messages[0].data; // export of other builders
    if (data && data.message && !data.content && !data.embeds) data = data.message;
    if (!data || typeof data !== 'object') return status(st, 'В JSON нет сообщения.', true);
    var keepMentions = state.mentions;
    state = fromMessage(data); if (!data.mentions) state.mentions = keepMentions;
    renderAll(); status(st, 'JSON загружен в редактор.');
  }

  // ---------- drafts ----------
  function syncSaveButtons() { $('[data-act="save"]').textContent = savedId ? 'Сохранить изменения' : 'Сохранить'; $('[data-act="save-new"]').hidden = !savedId; }
  function saveDraft(asNew) {
    var st = $('#m-status'); var name = $('#m-savename').value.trim();
    if (!name) { $('#m-savename').focus(); return status(st, 'Дайте заготовке название.', true); }
    api('/saved', { id: asNew ? 0 : savedId, name: name, state: { message: toMessage(), target: readTarget() } }).then(function (r) {
      if (!r.ok) return status(st, r.error, true);
      savedId = r.id; syncSaveButtons(); keepDraft();
      location.href = (D.page || base) + '?msgsaved=1#saved';
    });
  }
  function openSaved(id) {
    api('/saved/' + id, undefined, 'GET').then(function (r) {
      if (!r.ok) return alert(r.error);
      state = fromMessage(r.state.message || {}); setTarget(r.state.target || {});
      savedId = r.id; $('#m-savename').value = r.name; syncSaveButtons();
      renderAll(); showTab('editor'); history.replaceState(null, '', '#editor');
      status($('#m-status'), 'Открыта заготовка «' + r.name + '».');
    });
  }

  // ---------- schedule ----------
  var kindSel = $('#s-kind');
  function syncKind() { var k = kindSel.value; $$('[data-kind]').forEach(function (el) { el.hidden = el.getAttribute('data-kind').split(' ').indexOf(k) < 0; }); if (k === 'once' && !$('#s-dates').children.length) addDate(''); }
  kindSel.addEventListener('change', syncKind);
  function addDate(v) {
    if ($('#s-dates').children.length >= 20) return;
    var row = document.createElement('div'); row.className = 'msg-inline';
    row.innerHTML = '<input type="datetime-local" class="s-date" value="' + esc(v) + '" /><button type="button" class="btn-link danger" data-act="date-del" aria-label="Убрать дату">✕</button>';
    $('#s-dates').appendChild(row);
  }
  function readRule() {
    var k = kindSel.value;
    if (k === 'once') return { kind: k, dates: $$('.s-date').map(function (i) { return i.value; }).filter(Boolean) };
    if (k === 'hours') return { kind: k, every: +$('#s-every').value, start: $('#s-start').value };
    if (k === 'weekly') return { kind: k, time: $('#s-time').value, days: $$('input[name="s-day"]:checked').map(function (i) { return +i.value; }) };
    if (k === 'monthly') return { kind: k, time: $('#s-time').value, day: +$('#s-day').value };
    return { kind: k, time: $('#s-time').value };
  }
  function saveSchedule() {
    var st = $('#s-status'); var name = $('#s-name').value.trim();
    if (!name) { $('#s-name').focus(); return status(st, 'Дайте записи название.', true); }
    status(st, 'Сохраняю…');
    api('/schedule', { id: scheduleId, name: name, message: toMessage(), target: readTarget(), rule: readRule(), timezone: $('#s-tz').value }).then(function (r) {
      if (!r.ok) return status(st, r.error, true);
      location.href = (D.page || base) + '?msgsched=1#schedule';
    });
  }
  function resetSchedule() {
    scheduleId = 0; $('#s-name').value = ''; $('#m-sched-title').textContent = 'Новая запись'; $('[data-act="schedule"]').textContent = 'Запланировать'; $('[data-act="schedule-cancel"]').hidden = true;
    $('#s-dates').innerHTML = ''; kindSel.value = 'once'; syncKind(); status($('#s-status'), '');
  }
  function editSchedule(id) {
    api('/schedule/' + id, undefined, 'GET').then(function (r) {
      if (!r.ok) return alert(r.error);
      scheduleId = r.id; state = fromMessage(r.message); setTarget(r.target); renderAll();
      if (r.target.mode === 'webhook' && r.hasUrl) status($('#m-status'), 'Ссылка вебхука сохранена в записи. Оставьте поле пустым, чтобы не менять её.');
      $('#s-name').value = r.name; $('#s-tz').value = r.timezone; kindSel.value = r.rule.kind || 'once';
      $('#s-dates').innerHTML = ''; (r.rule.dates || []).forEach(addDate);
      if (r.rule.time) $('#s-time').value = r.rule.time; if (r.rule.every) $('#s-every').value = r.rule.every; if (r.rule.start) $('#s-start').value = r.rule.start; if (r.rule.day) $('#s-day').value = r.rule.day;
      $$('input[name="s-day"]').forEach(function (i) { i.checked = (r.rule.days || []).indexOf(+i.value) >= 0; });
      syncKind();
      $('#m-sched-title').textContent = 'Изменить: ' + r.name; $('[data-act="schedule"]').textContent = 'Сохранить изменения'; $('[data-act="schedule-cancel"]').hidden = false;
      status($('#s-status'), 'Сообщение записи открыто во вкладке «Редактор»: правьте его там, затем вернитесь сюда и сохраните.');
      $('#m-sched').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ---------- tools ----------
  var pieces = [];
  function ansiAdd(newline) {
    if (newline) { pieces.push({ nl: true }); drawAnsi(); return; }
    var t = $('#a-text').value; if (!t) return $('#a-text').focus();
    pieces.push({ text: t.replace(/\u0060/g, 'ˋ'), fg: $('#a-fg').value, bg: $('#a-bg').value, b: $('#a-bold').checked, u: $('#a-under').checked });
    $('#a-text').value = ''; $('#a-text').focus(); drawAnsi();
  }
  function ansiCode() {
    var body = pieces.map(function (p) {
      if (p.nl) return '\n';
      var codes = [p.b ? 1 : 0, p.u ? 4 : 0, p.fg, p.bg].filter(Boolean);
      return codes.length ? '\u001b[' + codes.join(';') + 'm' + p.text + '\u001b[0m' : p.text;
    }).join('');
    return '```ansi\n' + body + '\n```';
  }
  function drawAnsi() {
    $('#a-pieces').innerHTML = pieces.map(function (p, i) {
      return '<span class="ansi-piece">' + (p.nl ? '↵' : esc(p.text)) + '<button type="button" class="btn-link danger" data-act="ansi-del" data-i="' + i + '" aria-label="Убрать">✕</button></span>';
    }).join('');
    var code = pieces.length ? ansiCode() : '';
    $('#a-code').value = code;
    $('#a-preview').innerHTML = code ? md(code) : '<div class="dm-empty">Добавьте кусок текста — здесь появится результат.</div>';
  }
  function hookInfo() {
    var out = $('#w-out'); var url = $('#w-url').value.trim();
    if (!url) return $('#w-url').focus();
    out.textContent = 'Проверяю…';
    api('/webhook-info', { url: url }).then(function (r) {
      if (!r.ok) { out.innerHTML = '<div class="msg-error">' + esc(r.error) + '</div>'; return; }
      var i = r.info; var row = function (k, v) { return '<div><span class="muted">' + esc(k) + '</span><b>' + v + '</b></div>'; };
      out.innerHTML = '<div class="msg-hookcard">' + (i.avatar ? '<img src="' + esc(i.avatar) + '" alt="" />' : '') + '<div class="msg-hookrows">' +
        row('Имя', esc(i.name)) + row('ID', '<code>' + esc(i.id) + '</code>') +
        row('Сервер', i.sameGuild ? esc('этот сервер') : esc('другой сервер') + ' <code>' + esc(i.guildId) + '</code>') +
        row('Канал', i.sameGuild ? '#' + esc(channelName(i.channelId)) : '<code>' + esc(i.channelId) + '</code>') +
        row('Создан', esc(new Date(i.createdAt).toLocaleString())) +
        row('Кем', i.applicationId ? esc('приложением') + ' <code>' + esc(i.applicationId) + '</code>' : esc('участником')) + '</div></div>';
    });
  }

  // ---------- tabs and start ----------
  function showTab(name) {
    if (!$('[data-pane="' + name + '"]')) name = $('[data-pane="hooks"]') ? 'hooks' : 'editor';
    $$('[data-tab]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false'); });
    $$('[data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== name; });
  }
  var restored = null;
  try { restored = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { restored = null; }
  if (restored && restored.state) {
    state = fromMessage({}); Object.keys(state).forEach(function (k) { if (restored.state[k] !== undefined) state[k] = restored.state[k]; });
    state.embeds = (state.embeds || []).map(normalizeEmbed);
    setTarget(restored.target); savedId = restored.savedId || 0; $('#m-savename').value = restored.name || '';
  }
  syncSaveButtons(); syncMode(); syncKind(); renderAll(); drawAnsi(); syncRef();
  var params = new URLSearchParams(location.search);
  void params; showTab((location.hash || '#').slice(1));
})();
