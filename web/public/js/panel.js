// Scripts of the panel pages. They used to sit inside the templates; the page policy (Content-Security-Policy) now
// allows only scripts from files, so a script slipped into a page by some future mistake would not run.
// Each block checks that its page is open.

// --- Toasts after an action: the address carries a code (?saved, ?invalid…), the text is shown here.
(function () {
  var params = new URLSearchParams(location.search);
  // Error texts by code; the link only carries the code, so it cannot be used to show someone else's words.
  var reasons = {}; try { reasons = JSON.parse((document.getElementById('page-errors') || {}).textContent || '{}'); } catch (e) { /* no texts */ }
  function needText(list) {
    var names = { view: 'Просмотр канала', send: 'Отправлять сообщения', embed: 'Встраивать ссылки', history: 'Читать историю сообщений', react: 'Добавлять реакции', connect: 'Подключаться', manage: 'Управлять каналами', move: 'Перемещать участников', files: 'Прикреплять файлы' };
    var parts = String(list || '').split(',');
    if (parts.indexOf('gone') >= 0) return 'Канал не найден — возможно, его удалили. Настройка не изменена';
    var need = parts.map(function (k) { return names[k]; }).filter(Boolean).map(function (n) { return '«' + n + '»'; });
    return 'Бот не сможет работать в этом канале: не хватает прав ' + need.join(', ') + '. Выдайте их боту в настройках канала — канал не сохранён';
  }
  var kinds = {
    saved: ['Изменения сохранены', false],
    achlimit: ['Своих достижений не больше 100 — удалите ненужные', true],
    granted: ['Достижение выдано', false],
    already: ['У участника уже есть это достижение — второй раз не выдаётся', true],
    taken: ['Достижение забрано', false],
    deleted: ['Удалено', false],
    invalid: ['Не удалось сохранить: проверьте заполнение полей', true],
    revoked: ['Роль снята', false],
    refunded: ['Покупка возвращена: деньги у покупателя', false],
    gwended: ['Розыгрыш завершён', false],
    gwreroll: ['Победители выбраны заново', false],
    nobot: ['Бот сейчас не в сети — попробуйте через минуту', true],
    revokefail: ['Discord не дал снять роль: проверьте, что роль бота выше', true],
    badterm: ['Не понял срок действия: напишите, например, 10д, 12ч или 1мес (от 1 минуты до 366 дней)', true],
    started: ['Выдача ролей запущена', false],
    running: ['Выдача ролей уже идёт', true],
    nomessage: ['Сообщение не найдено в выбранном канале', true],
    notesent: ['Запись об обновлении отправлена в канал', false],
    rolenotallowed: ['Эту роль выдавать нельзя: у бота нет права «Управлять ролями», роль выше роли бота или вашей, управляется интеграцией либо даёт права модерации', true],
    noperm: [needText(params.get('need')), true],
    isbot: ['У ботов нет профиля, уровня и баланса — выберите участника', true],
    notmember: ['Этого пользователя нет на сервере', true],
    toomany: ['Достигнут предел записей для сервера', true],
    badchannel: ['Выберите канал этого сервера', true],
    badlogin: ['Неверный логин Twitch: латиница, цифры и _, от 3 до 25 символов', true],
    granted: ['Баланс участника обновлён', false],
    seasonend: ['Сезон завершён: монеты обнулены, значки выданы', false],
    split: ['Деньги из казны разданы', false],
    trgive: ['Розыгрыш из казны запущен', false],
    trvote: ['Голосование опубликовано в канале событий', false],
    tr_treasury: ['В казне не хватает денег', true],
    tr_nobody: ['За неделю никто не был активен — раздавать некому', true],
    tr_small: ['Сумма слишком мала: на каждого не выйдет и монеты', true],
    tr_channel: ['Нужен канал событий, и модуль «События бота» должен быть включён', true],
    tr_post: ['Бот не смог написать в канал событий: проверьте его права', true],
    tr_two: ['Для голосования отметьте хотя бы два варианта', true],
    tr_closed: ['Эта цель уже закрыта', true],
    goalmade: ['Сбор открыт: карточка цели в канале событий', false],
    goal_max: ['Открыто максимум целей — дождитесь окончания или отмените одну', true],
    goal_channel: ['Нужен канал событий, и модуль «События бота» должен быть включён', true],
    goalfund: ['Деньги из казны вложены в цель', false],
    goalcancel: ['Цель отменена, вложения вернулись', false],
    dealdone: ['Сделка закрыта', false],
    codes: ['Коды выпущены', false],
    revoked: ['Код отозван', false],
    holdback: ['Перевод вернулся отправителю', false],
    lifted: ['Наказание снято', false],
    musicok: ['Готово', false],
    notplaying: ['Сейчас ничего не играет', true],
    imported: ['Плейлист импортирован', false],
    unwarned: ['Предупреждение снято и осталось в истории', false],
    already: ['Это уже сделано раньше', true],
    reportclosed: ['Жалоба отклонена', false],
    notmember: ['Участника нет на сервере', true],
    example: ['Пример отправлен в канал события', false],
    adjusted: ['Уровень участника изменён', false],
    baduser: ['Укажите корректный ID участника', true],
    logready: ['Форум логов готов: темы созданы', false],
    logoff: ['Логи отключены', false],
    lognoforum: ['Выберите именно форум — обычные каналы не подходят', true],
    logperm: ['Не хватает прав у бота: нужны «Управлять каналами» и «Управлять вебхуками»', true],
    rules: ['Правила наказаний сохранены', false],
    created: ['Вебхук создан', false],
    wpanel: ['Панель управления вебхуками размещена', false],
    vpanel: ['Панель управления комнатами размещена', false],
    lookpanel: ['Сохранено — панель комнаты на сервере обновлена', false],
    whsent: ['Сообщение отправлено', false],
    msgsaved: ['Заготовка сохранена', false],
    sscreated: ['Счётчик создан — его название будет обновляться само', false],
    ssremoved: ['Счётчик убран', false],
    ssrefresh: ['Названия счётчиков обновлены', false],
    ssperm: ['У бота нет права «Управлять каналами»', true],
    ssmax: ['Не больше 10 счётчиков на сервер', true],
    ssfail: ['Discord не дал создать канал — попробуйте позже', true],
    msgsched: ['Сообщение запланировано', false],
    msgtest: ['Тестовое сообщение отправлено', false],
    msgfail: ['Не удалось отправить: причина указана в записи', true],
    msgpast: ['Все даты этой записи уже прошли — измените её', true],
    msgnoright: ['Для вебхука нужно право «Управлять вебхуками»', true],
    whfail: [reasons[params.get('reason')] || 'Не удалось выполнить действие', true],
    reset: ['Стандартные значения восстановлены', false],
    logfail: ['Не удалось создать темы. Проверьте права бота в этом форуме', true]
  };
  // the same texts for a form saved in the background: its answer carries the same codes (?saved, ?invalid, ?noperm…).
  // Returns { shown, bad }: whether a code was found and whether it was an error.
  window.darkFlashParams = function (p) {
    for (var k in kinds) {
      if (!p.has(k)) continue;
      var text = k === 'noperm' ? needText(p.get('need')) : k === 'whfail' ? (reasons[p.get('reason')] || kinds[k][0]) : kinds[k][0];
      var x = document.createElement('div');
      x.className = 'toast' + (kinds[k][1] ? ' error' : '');
      x.setAttribute('role', 'status');
      x.textContent = text;
      document.body.appendChild(x);
      setTimeout(function () { x.remove(); }, text.length > 90 ? 8000 : 3600);
      return { shown: true, bad: kinds[k][1] };
    }
    return { shown: false, bad: false };
  };
  for (var key in kinds) {
    if (!params.has(key)) continue;
    var t = document.createElement('div');
    t.className = 'toast' + (kinds[key][1] ? ' error' : '');
    t.setAttribute('role', 'status');
    t.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' +
      (kinds[key][1] ? 'M10 6V11M10 14H10.01' : 'M4.5 10.5L8.2 14L15.5 6') + '"/></svg><span></span>';
    t.lastChild.textContent = kinds[key][0];
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, kinds[key][0].length > 90 ? 8000 : 3600);
    params.delete(key);
    params.delete('need');
    var q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    break;
  }
})();

// --- The save bar: appears once a settings form is edited, saves all edited blocks, warns before leaving with unsaved changes.
// Shows a "save" bar once any settings form is edited, and warns before leaving with unsaved changes.
// The forms come after the sidebar in the page, so wait until they exist.
document.addEventListener('DOMContentLoaded', function () {
  var bar = document.getElementById('saveBar');
  var forms = Array.prototype.filter.call(document.querySelectorAll('.content form[method=post]'), function (f) {
    return f.querySelector('input:not([type=hidden]):not([type=file]), select, textarea') && !f.hasAttribute('data-no-guard');
  });
  // Every edited form is remembered: saving one block must not silently drop changes made in another.
  var dirty = [], submitting = false;
  function mark(f) { if (dirty.indexOf(f) < 0) dirty.push(f); bar.classList.add('show'); bar.inert = false; bar.removeAttribute('inert'); document.body.classList.add('has-save-bar'); }
  function unmark(f) {
    var i = dirty.indexOf(f); if (i >= 0) dirty.splice(i, 1);
    if (!dirty.length) { bar.classList.remove('show'); bar.inert = true; bar.setAttribute('inert', ''); document.body.classList.remove('has-save-bar'); }
  }
  // Every settings form is saved without leaving the page. A form marked data-api goes as JSON to the settings API
  // (web/routes/dashboard/api.js, errors under the fields). Any other one is sent in the background exactly as the
  // browser would send it, to its usual address; the answer is the page the server leads to:
  //  - the same page: the codes in its address give the message; the fields take the values the server kept (it may
  //    have trimmed or corrected one). If the page now has more or fewer rows or cards (something was added or
  //    removed), it is simply opened — it was already saved, nothing is sent twice;
  //  - another page (a new item opens its own page): that page is opened.
  // A form with a file goes the usual way.
  var syncing = false;
  // the form's address from its attribute: a field named «action» would hide form.action
  function actionOf(f) { return new URL(f.getAttribute('action') || location.href, location.href).href; }
  function shape(root) { return root ? root.querySelectorAll('tr, li, .card, .rule-cfg, .pf-row, .mini-row, .im-item').length : 0; }
  function formSave(f) {
    if (f.reportValidity && !f.reportValidity()) return Promise.resolve(false);
    var btns = f.querySelectorAll('button[type=submit], button:not([type])');
    btns.forEach(function (b) { b.disabled = true; }); f.classList.add('is-saving');
    var before = shape(document.querySelector('main.content'));
    var index = Array.prototype.filter.call(document.querySelectorAll('form'), function (x) { return actionOf(x) === actionOf(f); }).indexOf(f);
    return fetch(actionOf(f), { method: 'POST', body: new URLSearchParams(new FormData(f)), credentials: 'same-origin', headers: { accept: 'text/html' } })
      .then(function (r) {
        var u = new URL(r.url);
        if (!r.ok) throw new Error('status ' + r.status);
        if (!r.redirected || u.pathname !== location.pathname) { submitting = true; location.href = r.redirected ? r.url : location.href; return 'away'; }
        return r.text().then(function (html) { return { u: u, doc: new DOMParser().parseFromString(html, 'text/html') }; });
      })
      .then(function (x) {
        if (x === 'away') return true;
        var flag = window.darkFlashParams ? window.darkFlashParams(x.u.searchParams) : { shown: false, bad: false };
        if (shape(x.doc.querySelector('main.content')) !== before) { submitting = true; location.href = x.u.href; return true; }
        var twin = Array.prototype.filter.call(x.doc.querySelectorAll('form'), function (y) { return new URL(y.getAttribute('action') || x.u.pathname, x.u).href.split('?')[0] === actionOf(f).split('?')[0]; })[index];
        if (twin) {
          syncing = true;
          var seen = {};
          Array.prototype.forEach.call(twin.elements, function (src) {
            if (!src.name) return;
            var list = f.querySelectorAll('[name=' + JSON.stringify(src.name) + ']');
            var i = seen[src.name] = (seen[src.name] || 0); seen[src.name]++;
            var dst = src.type === 'checkbox' || src.type === 'radio' ? Array.prototype.filter.call(list, function (d) { return d.value === src.value; })[0] : list[i];
            if (!dst || dst.type === 'file') return;
            if (dst.type === 'checkbox' || dst.type === 'radio') dst.checked = src.hasAttribute('checked');
            else if (dst.tagName === 'SELECT') { var sel = src.querySelector('option[selected]'); if (sel) dst.value = sel.value; }
            else if (dst.tagName === 'TEXTAREA') dst.value = src.textContent;
            else if (dst.type !== 'hidden') dst.value = src.getAttribute('value') || '';
          });
          syncing = false;
        }
        if (!flag.shown && window.darkToast) window.darkToast('Изменения сохранены', false);
        return !flag.bad;
      })
      .catch(function () { if (window.darkToast) window.darkToast('Не удалось сохранить: нет связи с панелью или ошибка сервера', true); return false; })
      .then(function (ok) { btns.forEach(function (b) { b.disabled = false; }); f.classList.remove('is-saving'); return ok; });
  }
  function post(f) {
    var go = f.hasAttribute('data-api') && window.darkApiSave ? window.darkApiSave(f) : formSave(f);
    return go.then(function (ok) { if (ok) unmark(f); return ok; });
  }
  var classic = function (f) { return f.hasAttribute('data-drawer') || f.querySelector('input[type=file]'); };
  // Saves every edited form, the last one last.
  function submitAll(main) {
    var list = dirty.filter(function (f) { return f !== main; }).concat(main && dirty.indexOf(main) < 0 ? [] : [main]).filter(Boolean);
    if (list.some(classic)) { // a form that must go the usual way: the others first, then it
      var plain = list.filter(function (f) { return !classic(f); });
      Promise.all(plain.map(post)).then(function () { var c = list.filter(classic)[0]; submitting = true; c.requestSubmit ? c.requestSubmit() : c.submit(); });
      return;
    }
    list.reduce(function (p, f) { return p.then(function () { return post(f); }); }, Promise.resolve());
  }
  // The bar appears by itself on any change, wherever the page is scrolled, so a settings form needs no own "Save" button
  // at its very end. Buttons that do something else (add, publish, delete) stay.
  forms.forEach(function (f) {
    Array.prototype.forEach.call(f.querySelectorAll('button[type=submit], button:not([type])'), function (b) {
      if (/^\s*(Сохранить|Save)/i.test(b.textContent) && !b.classList.contains('btn-danger')) b.classList.add('sb-replaced');
    });
    // a row of buttons whose only button went to the bar: no empty strip with a line
    Array.prototype.forEach.call(f.querySelectorAll('.set-actions'), function (row) {
      var rest = Array.prototype.filter.call(row.children, function (c) { return !c.classList.contains('sb-replaced'); });
      row.classList.toggle('is-empty', rest.length === 0);
    });
  });
  forms.forEach(function (f) {
    f.addEventListener('input', function () { if (!syncing) mark(f); });
    f.addEventListener('change', function () { if (!syncing) mark(f); });
    f.addEventListener('submit', function (e) {
      if (submitting || classic(f)) { submitting = true; return; }
      e.preventDefault();
      if (dirty.indexOf(f) < 0) dirty.push(f);
      submitAll(f);
    });
  });
  // fields that belong to a form from another card (the form="…" attribute) mark that form as edited too
  ['input', 'change'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { var f = e.target && e.target.form; if (f && forms.indexOf(f) >= 0 && !f.contains(e.target)) mark(f); });
  });
  document.getElementById('sbSave').addEventListener('click', function () { if (dirty.length) submitAll(dirty[dirty.length - 1]); });
  document.getElementById('sbReset').addEventListener('click', function () { submitting = true; location.reload(); });
  window.addEventListener('beforeunload', function (e) { if (dirty.length && !submitting) { e.preventDefault(); e.returnValue = ''; } });
});

// --- Import of levels from another bot (Уровни → Импорт).
(function () {
  var btn = document.getElementById('importBtn');
  if (!btn) return;
  var input = document.getElementById('importFile');
  var status = document.getElementById('importStatus');
  btn.addEventListener('click', function () {
    var file = input.files[0];
    if (!file) { status.textContent = 'Выберите файл.'; return; }
    status.textContent = 'Читаю файл…';
    file.text().then(function (text) {
      var users;
      try { users = JSON.parse(text); } catch (e) { status.textContent = 'Это не JSON-файл.'; return; }
      btn.disabled = true;
      status.textContent = 'Импортирую…';
      return fetch(btn.getAttribute('data-url'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: users })
      }).then(function (r) {
        return r.text().then(function (body) {
          var data = null;
          try { data = JSON.parse(body); } catch (e) {}
          if (data && data.ok) {
            status.textContent = 'Готово: импортировано ' + data.imported + ', пропущено ' + data.skipped + '.';
          } else if (data) {
            status.textContent = 'Ошибка: ' + data.error;
          } else if (r.status === 413) {
            status.textContent = 'Файл слишком большой для nginx (увеличьте client_max_body_size, см. README).';
          } else if (r.redirected || r.status === 401 || r.status === 403) {
            status.textContent = 'Сессия истекла или нет прав (HTTP ' + r.status + '). Обновите страницу и войдите заново.';
          } else {
            status.textContent = 'Сервер ответил HTTP ' + r.status + '. Проверьте pm2 logs dark-web.';
          }
        });
      });
    }).catch(function (e) { status.textContent = 'Не удалось связаться с сервером: ' + (e && e.message ? e.message : e); })
      .then(function () { btn.disabled = false; });
  });
})();

// --- Automod: "Сейчас: …" lines in plain words and the list of special punishments.
// "Сейчас: …" under the word and link filters says in plain words what will happen with the current ticks and lists.
(function () {
  var form = document.getElementById('am-words') && document.querySelector('form.plain');
  if (!form) return;
  var box = function (k) { return form.querySelector('[data-am="' + k + '"]'); };
  var lines = function (ta) { return ta.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };
  var list = function (a) { var shown = a.slice(0, 5).map(function (x) { return '«' + x + '»'; }).join(', '); return a.length > 5 ? shown + ' и ещё ' + (a.length - 5) : shown; };
  function update() {
    var words = lines(document.getElementById('am-words')); var prof = box('profanity').checked;
    var w = !words.length && !prof ? 'Сейчас слова не проверяются.'
      : 'Сейчас удаляются сообщения ' + (prof ? 'с матом' : '') + (prof && words.length ? ' и ' : '') + (words.length ? 'со словами ' + list(words) : '') + '.';
    document.getElementById('am-words-now').textContent = w;
    var allow = lines(document.getElementById('am-allow')); var links = box('links').checked; var inv = box('invites').checked;
    var l;
    if (links) l = allow.length ? 'Сейчас удаляются все ссылки, кроме ссылок на ' + list(allow) + '.' : 'Сейчас удаляются все ссылки — исключений нет.';
    else if (inv) l = 'Сейчас удаляются только приглашения на другие серверы. Остальные ссылки разрешены.';
    else l = 'Сейчас ссылки не проверяются.';
    document.getElementById('am-links-now').textContent = l;
    document.getElementById('am-allow-wrap').classList.toggle('am-idle', !links);
  }
  form.addEventListener('input', update); form.addEventListener('change', update); update();

  // Special punishments: only rules that have one are shown; "Добавить" opens a rule, "Убрать" clears and hides it.
  var add = document.getElementById('pr-add'); var none = document.querySelector('.pr-empty');
  var acts = { delete: 'только удалить сообщение', warn: 'удалить и предупредить', mute: 'удалить и замутить' };
  function summary(d) {
    var k = d.getAttribute('data-rule');
    var a = d.querySelector('[name="rule_' + k + '_action"]').value; var m = d.querySelector('[name="rule_' + k + '_mute"]').value;
    var ch = d.querySelectorAll('[name="rule_' + k + '_ch"]:checked').length; var ro = d.querySelectorAll('[name="rule_' + k + '_roles"]:checked').length;
    var parts = [];
    if (a) parts.push(acts[a] + (a === 'mute' && m ? ' на ' + m + ' мин' : '')); else if (m) parts.push('мут на ' + m + ' мин');
    if (ch) parts.push('не действует в ' + ch + ' кан.');
    if (ro) parts.push('не действует для ' + ro + ' рол.');
    d.querySelector('.pr-sum').textContent = parts.length ? parts.join(' · ') : 'настройте ниже';
  }
  function syncAdd() {
    var shown = document.querySelectorAll('.rule-cfg:not([hidden])').length;
    none.hidden = shown > 0;
    Array.prototype.forEach.call(add.options, function (o) { if (!o.value) return; var d = document.querySelector('.rule-cfg[data-rule="' + o.value + '"]'); o.hidden = o.disabled = !d.hidden; });
  }
  add.addEventListener('change', function () {
    var d = document.querySelector('.rule-cfg[data-rule="' + add.value + '"]'); if (!d) return;
    d.hidden = false; d.open = true; add.value = ''; syncAdd(); d.querySelector('select').focus();
  });
  Array.prototype.forEach.call(document.querySelectorAll('.rule-cfg'), function (d) {
    d.addEventListener('input', function () { summary(d); }); d.addEventListener('change', function () { summary(d); });
    d.querySelector('.pr-remove').addEventListener('click', function () {
      d.querySelectorAll('select').forEach(function (x) { x.value = ''; });
      d.querySelectorAll('input[type=number]').forEach(function (x) { x.value = ''; });
      d.querySelectorAll('input[type=checkbox]').forEach(function (x) { x.checked = false; });
      d.querySelectorAll('.ms-x').forEach(function (x) { x.click(); });
      summary(d); d.open = false; d.hidden = true; syncAdd();
      form.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  syncAdd();
})();

// Achievement editor: the amount for counted conditions, the role for "has a role", nothing for "by hand".
(function () {
  var sel = document.querySelector('[data-ach-cond]');
  if (!sel) return;
  var value = document.querySelector('[data-ach-show="value"]');
  var role = document.querySelector('[data-ach-show="role"]');
  function sync() {
    var v = sel.value;
    if (value) value.hidden = v === 'manual' || v === 'role';
    if (role) role.hidden = v !== 'role';
  }
  sel.addEventListener('change', sync);
  sync();
})();

// Module tabs on a narrow screen scroll sideways: bring the open tab into view and show a fade where more tabs hide.
(function () {
  var tabs = document.querySelector('.mh-tabs');
  if (!tabs) return;
  var on = tabs.querySelector('a.on');
  if (on && tabs.scrollWidth > tabs.clientWidth) tabs.scrollLeft = Math.max(0, on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2);
  function edges() {
    tabs.classList.toggle('more-left', tabs.scrollLeft > 4);
    tabs.classList.toggle('more-right', tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 4);
  }
  tabs.addEventListener('scroll', edges, { passive: true });
  window.addEventListener('resize', edges);
  edges();
})();
