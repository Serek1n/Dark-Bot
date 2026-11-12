// The modules in the panel: the "Модули ▾" menu (open, close, filter) and every module switch — in the menu, the phone
// menu, a module's header, the home page and the modules page. A switch saves at once; switching a module off first
// says what stops working and offers to switch off the modules that need it (Магазин without Экономика).
(function () {
  'use strict';
  var bar = document.getElementById('topbar');
  if (!bar) return;
  var guild = bar.getAttribute('data-guild');
  var menu = document.getElementById('modsMenu');
  var opener = document.querySelector('[data-mods-open]');
  var dataEl = document.getElementById('mods-data');
  var MODS = [];
  try { MODS = JSON.parse(dataEl ? dataEl.textContent : '[]'); } catch (_) { MODS = []; }
  var byKey = {};
  MODS.forEach(function (m) { byKey[m.key] = m; });

  // ---- the menu ----
  function place() {
    if (!menu || menu.hidden) return;
    var r = bar.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom) + 'px';
  }
  function openMenu() {
    if (!menu) return;
    menu.hidden = false; opener.setAttribute('aria-expanded', 'true'); place();
    var f = menu.querySelector('[data-mods-filter]'); if (f && matchMedia('(pointer: fine)').matches) f.focus();
    document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esc, true);
  }
  function closeMenu(back) {
    if (!menu || menu.hidden) return;
    menu.hidden = true; opener.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc, true);
    if (back) opener.focus();
  }
  function outside(e) { if (!menu.contains(e.target) && !opener.contains(e.target) && !e.target.closest('.ask')) closeMenu(false); }
  function esc(e) { if (e.key === 'Escape' && !document.querySelector('.ask')) { e.preventDefault(); closeMenu(true); } }
  if (opener && menu) {
    opener.addEventListener('click', function () { if (menu.hidden) openMenu(); else closeMenu(false); });
    window.addEventListener('resize', place);
    var filter = menu.querySelector('[data-mods-filter]');
    if (filter) filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      menu.querySelectorAll('[data-mod-row]').forEach(function (row) {
        row.hidden = Boolean(q) && row.getAttribute('data-mod-name').indexOf(q) < 0;
      });
      menu.querySelectorAll('.mm-col').forEach(function (col) {
        col.hidden = !col.querySelector('[data-mod-row]:not([hidden])');
      });
    });
  }

  // ---- switching ----
  function post(key, on, also) {
    var body = new URLSearchParams();
    body.set('on', on ? '1' : '0');
    (also || []).forEach(function (k) { body.append('also', k); });
    return fetch('/dashboard/' + guild + '/modules/' + encodeURIComponent(key), {
      method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, body: body
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function reflect(key, on) {
    if (byKey[key]) byKey[key].on = on;
    document.querySelectorAll('[data-mod-switch="' + key + '"]').forEach(function (i) { i.checked = on; });
    document.querySelectorAll('[data-mod-row="' + key + '"]').forEach(function (r) { r.classList.toggle('is-on', on); r.classList.toggle('is-off', !on); });
    document.querySelectorAll('[data-mod-pill="' + key + '"]').forEach(function (p) { p.textContent = on ? 'Включён' : 'Выключен'; p.classList.toggle('off', !on); });
    var count = MODS.filter(function (m) { return m.on; }).length;
    document.querySelectorAll('[data-mods-count]').forEach(function (c) { c.textContent = count; });
  }

  function toast(text, bad) {
    var t = document.createElement('div');
    t.className = 'toast' + (bad ? ' error' : '');
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }

  // What switching it off means, and the modules that need it (only those that are on).
  function askOff(m) {
    var extra = document.createElement('div');
    extra.className = 'mod-ask';
    var cmds = (m.commands || []).filter(function (c) { return !/[A-Z]/.test(c); });
    var ul = document.createElement('ul');
    function li(text, keep) { var x = document.createElement('li'); x.textContent = text; if (keep) x.className = 'keep'; ul.appendChild(x); }
    li(cmds.length ? 'Перестанут работать команды: ' + cmds.map(function (c) { return '/' + c; }).join(', ') : 'Бот перестанет это выполнять на всём сервере');
    li('Настройки и данные сохранятся — после включения всё вернётся', true);
    extra.appendChild(ul);
    var deps = MODS.filter(function (d) { return d.on && d.switchable && (d.depends || []).indexOf(m.key) >= 0; });
    if (deps.length) {
      var box = document.createElement('div'); box.className = 'mod-deps';
      var cap = document.createElement('b'); cap.textContent = 'Эти модули используют его:'; box.appendChild(cap);
      deps.forEach(function (d) {
        var l = document.createElement('label'); var c = document.createElement('input');
        c.type = 'checkbox'; c.checked = true; c.value = d.key;
        l.appendChild(c); l.appendChild(document.createTextNode(' Выключить и «' + d.title + '»'));
        box.appendChild(l);
      });
      extra.appendChild(box);
    }
    var ask = window.darkConfirm || function () { return Promise.resolve(window.confirm('Выключить модуль «' + m.title + '»?')); };
    return ask('Выключить модуль «' + m.title + '»?', { ok: 'Выключить', extra: extra }).then(function (yes) {
      if (!yes) return null;
      return Array.prototype.filter.call(extra.querySelectorAll('.mod-deps input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
    });
  }

  function change(key, on, reload, input) {
    var m = byKey[key] || { key: key, title: input ? input.getAttribute('data-mod-title') : key, commands: [] };
    var go = on ? Promise.resolve([]) : askOff(m);
    return go.then(function (also) {
      if (also === null) { if (input) input.checked = !on; return; }
      document.querySelectorAll('[data-mod-switch="' + key + '"]').forEach(function (i) { i.disabled = true; });
      return post(key, on, also).then(function (res) {
        (res.changed || [key]).forEach(function (k) { reflect(k, k === key ? on : false); });
        if (reload) { location.reload(); return; }
        toast(on ? 'Модуль «' + m.title + '» включён' : 'Модуль «' + m.title + '» выключен');
      }).catch(function () {
        if (input) input.checked = !on;
        toast('Не удалось сохранить. Обновите страницу и попробуйте ещё раз', true);
      }).then(function () {
        document.querySelectorAll('[data-mod-switch="' + key + '"]').forEach(function (i) { i.disabled = false; });
      });
    });
  }

  document.addEventListener('change', function (e) {
    var i = e.target;
    if (!i.matches || !i.matches('input[data-mod-switch]')) return;
    var key = i.getAttribute('data-mod-switch');
    // the page of this very module changes with it (the "switched off" notice), so it is reloaded
    var reload = i.hasAttribute('data-mod-reload') || bar.getAttribute('data-page-mods') && (' ' + bar.getAttribute('data-page-mods') + ' ').indexOf(' ' + key + ' ') >= 0;
    change(key, i.checked, reload, i);
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-mod-enable]');
    if (!b) return;
    b.disabled = true;
    change(b.getAttribute('data-mod-enable'), true, true, null);
  });
})();
