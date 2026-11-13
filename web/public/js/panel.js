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
    whsent: ['Сообщение отправлено', false],
    msgsaved: ['Заготовка сохранена', false],
    msgsched: ['Сообщение запланировано', false],
    msgtest: ['Тестовое сообщение отправлено', false],
    msgfail: ['Не удалось отправить: причина указана в записи', true],
    msgpast: ['Все даты этой записи уже прошли — измените её', true],
    msgnoright: ['Для вебхука нужно право «Управлять вебхуками»', true],
    whfail: [reasons[params.get('reason')] || 'Не удалось выполнить действие', true],
    logfail: ['Не удалось создать темы. Проверьте права бота в этом форуме', true]
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
  function post(f) { return fetch(f.action || location.href, { method: 'POST', body: new URLSearchParams(new FormData(f)), credentials: 'same-origin' }); }
  // Saves the other edited forms in the background, then submits this one normally.
  function submitAll(main) {
    var others = dirty.filter(function (f) { return f !== main; });
    submitting = true;
    Promise.all(others.map(post)).catch(function () {}).then(function () { main.requestSubmit ? main.requestSubmit() : main.submit(); });
  }
  // The bar appears by itself on any change, wherever the page is scrolled, so a settings form needs no own "Save" button
  // at its very end. Buttons that do something else (add, publish, delete) stay.
  forms.forEach(function (f) {
    Array.prototype.forEach.call(f.querySelectorAll('button[type=submit], button:not([type])'), function (b) {
      if (/^\s*(Сохранить|Save)/i.test(b.textContent) && !b.classList.contains('btn-danger')) b.classList.add('sb-replaced');
    });
  });
  forms.forEach(function (f) {
    f.addEventListener('input', function () { mark(f); });
    f.addEventListener('change', function () { mark(f); });
    f.addEventListener('submit', function (e) {
      if (submitting) return;
      var others = dirty.filter(function (x) { return x !== f; });
      if (others.length && !f.__allAsked) {
        e.preventDefault();
        window.darkConfirm('В другом блоке на этой странице есть несохранённые изменения. Сохранить их тоже?', { ok: 'Сохранить всё', cancel: 'Только этот блок', danger: false }).then(function (all) {
          if (all) { submitAll(f); return; }
          f.__allAsked = true; submitting = true; f.requestSubmit ? f.requestSubmit() : f.submit();
        });
        return;
      }
      submitting = true;
    });
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

// --- Welcome: live preview of the message.
(function () {
  var input = document.getElementById('welcomeMessage');
  var out = document.getElementById('welcomePreview');
  if (!input || !out) return;
  var server = out ? out.getAttribute('data-server') || '' : '';
  function esc(t) { return t.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function render() {
    out.innerHTML = esc(input.value)
      .replace(/\{user\}/g, '<span class="mention">@Новый участник</span>')
      .replace(/\{name\}/g, 'Новый участник')
      .replace(/\{count\}/g, '128')
      .replace(/\{server\}/g, esc(server))
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\n/g, '<br>');
  }
  input.addEventListener('input', render);
  render();
})();
